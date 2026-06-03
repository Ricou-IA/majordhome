# Moteur de campagne d'appels sortants (cerveau) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le « cerveau » d'un assistant d'appels sortants : depuis la colonne « À planifier » du kanban entretien, lancer une file d'appels séquentielle qui filtre les non-aboutis, ouvre un screen-pop quand un humain décroche, et laisse l'humain closer en 1 clic (RDV / refusé / à rappeler).

**Architecture :** Un `CallProvider` abstrait émet des événements d'appel (`no_answer`, `voicemail`, `human_answered`, `transfer_accepted`, `transfer_missed`). En V1, un `MockCallProvider` simule ces événements (la téléphonie réelle = spec n°2). Un hook `useCallSession` consomme ces événements, met à jour les compteurs live, déclenche le screen-pop, et journalise via des RPCs `call_*`. Les gestes de close réutilisent les flux existants (`createAppointment`, `recordVisit`).

**Tech Stack :** React 18 + Vite 5, TanStack React Query v5, Supabase (RPCs SECURITY DEFINER + vues publiques `security_invoker`), Tailwind, Lucide, Sonner. **Pas de test runner** → vérification par `npx vite build`, `npm run lint:errors`, et simulation via `MockCallProvider`.

**Périmètre V1 :** kanban **entretien** uniquement. Le pipeline (leads chauds) et le volet audio réel sont des extensions documentées, hors V1.

---

## Vérification (lire avant de commencer)

Ce projet n'a pas de framework de test. Pour CHAQUE tâche, « vérifier » signifie :
- **Build** : `npx vite build` doit réussir (≈ 25-30 s).
- **Lint** : `npm run lint:errors` doit être clean (le pre-commit hook le relance de toute façon).
- **DB** : migrations appliquées via le MCP Supabase (`apply_migration`) puis un `SELECT` de contrôle via `execute_sql`.
- **Simulation** : à partir de la Phase 5, dérouler un scénario `MockCallProvider` dans le navigateur (pas de preview tools — serveur de dev local d'Eric) et observer compteurs + screen-pop + gestes.

Org cible Mayer (core) : `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`.

---

## File Structure

**Créés :**
- `supabase/migrations/20260603_call_campaign_brain.sql` — tables `call_sessions` / `call_attempts`, vues publiques, RPCs.
- `src/apps/artisan/components/appels/callProvider.js` — interface `CallProvider` + `MockCallProvider`.
- `src/apps/artisan/components/appels/callWindow.js` — helper `isWithinCallWindow`.
- `src/shared/services/callCampaigns.service.js` — service (RPCs + lectures de vues).
- `src/shared/hooks/useCallSession.js` — hook moteur (file + compteurs + événements).
- `src/apps/artisan/components/appels/PhoningPanel.jsx` — écran de phoning (dashboard live + screen-pop).
- `src/apps/artisan/components/appels/PhoningScreenPop.jsx` — fiche contact + 3 gestes rapides.
- `src/apps/artisan/components/appels/LancerAppelButton.jsx` — bouton + ouverture du PhoningPanel.

**Modifiés :**
- `src/shared/hooks/cacheKeys.js` — ajout `callSessionKeys`, `callAttemptKeys`.
- `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` — branchement `headerExtra` sur la colonne `a_planifier`.
- `src/shared/hooks/useEntretienSAV.js` — merge des stats d'appel (tag 📞 sur les cartes).
- `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` — affichage du tag 📞.

---

## Phase 1 — Base de données

### Task 1 : Migration `call_sessions` + `call_attempts` + vues + RPCs

**Files:**
- Create: `supabase/migrations/20260603_call_campaign_brain.sql`

- [ ] **Step 1 : Écrire la migration complète**

```sql
-- ============================================================================
-- 20260603_call_campaign_brain.sql
-- Moteur de campagne d'appels sortants (cerveau, niveau 0.5).
-- Spec : docs/superpowers/specs/2026-06-03-campagne-appels-sortants-moteur-design.md
-- ============================================================================

-- 1. TABLES -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS majordhome.call_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES core.organizations(id),
  kanban      text NOT NULL DEFAULT 'entretien',         -- 'entretien' | 'pipeline'
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,         -- { window_start, window_end, accroche }
  status      text NOT NULL DEFAULT 'active',             -- 'active' | 'paused' | 'done'
  started_by  uuid REFERENCES core.profiles(id),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

CREATE TABLE IF NOT EXISTS majordhome.call_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES core.organizations(id),
  session_id      uuid REFERENCES majordhome.call_sessions(id) ON DELETE SET NULL,
  intervention_id uuid REFERENCES majordhome.interventions(id) ON DELETE CASCADE,
  lead_id         uuid REFERENCES majordhome.leads(id) ON DELETE CASCADE,
  phone_dialed    text,
  result          text NOT NULL,   -- no_answer|voicemail|transferred_answered|transfer_missed|rdv_booked|refused|callback
  note            text,
  attempt_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES core.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- miroir : exactement une cible
  CONSTRAINT call_attempts_one_target CHECK (
    (intervention_id IS NOT NULL)::int + (lead_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT call_attempts_result_chk CHECK (
    result IN ('no_answer','voicemail','transferred_answered','transfer_missed','rdv_booked','refused','callback')
  )
);

CREATE INDEX IF NOT EXISTS idx_call_attempts_org           ON majordhome.call_attempts(org_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_intervention  ON majordhome.call_attempts(intervention_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead          ON majordhome.call_attempts(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_session       ON majordhome.call_attempts(session_id);

-- 2. RLS --------------------------------------------------------------------

ALTER TABLE majordhome.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.call_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_sessions_org ON majordhome.call_sessions
  FOR ALL USING (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()));

CREATE POLICY call_attempts_org ON majordhome.call_attempts
  FOR ALL USING (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()));

-- GRANT SELECT service_role (charte : vues security_invoker → edge/cron lisent via service_role)
GRANT SELECT ON majordhome.call_sessions TO service_role;
GRANT SELECT ON majordhome.call_attempts TO service_role;

-- 3. VUES PUBLIQUES (security_invoker) --------------------------------------

CREATE OR REPLACE VIEW public.majordhome_call_sessions
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.call_sessions;

CREATE OR REPLACE VIEW public.majordhome_call_attempts
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.call_attempts;

-- Stats agrégées par cible (mirror du pattern next_rdv_date)
CREATE OR REPLACE VIEW public.majordhome_call_attempt_stats
  WITH (security_invoker = true) AS
  SELECT
    org_id,
    intervention_id,
    lead_id,
    COUNT(*)                                   AS call_count,
    MAX(attempt_at)                            AS last_call_at,
    (ARRAY_AGG(result ORDER BY attempt_at DESC))[1] AS last_call_result
  FROM majordhome.call_attempts
  GROUP BY org_id, intervention_id, lead_id;

GRANT SELECT ON public.majordhome_call_sessions      TO authenticated, service_role;
GRANT SELECT ON public.majordhome_call_attempts      TO authenticated, service_role;
GRANT SELECT ON public.majordhome_call_attempt_stats TO authenticated, service_role;

-- 4. RPCs (SECURITY DEFINER, REVOKE anon, membership check) ------------------

-- 4a. Démarrer une session
CREATE OR REPLACE FUNCTION public.call_session_start(
  p_org_id uuid,
  p_kanban text,
  p_params jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public, core AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.organization_members
                 WHERE user_id = auth.uid() AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  INSERT INTO majordhome.call_sessions(org_id, kanban, params, started_by)
  VALUES (p_org_id, COALESCE(p_kanban,'entretien'), COALESCE(p_params,'{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 4b. Enregistrer une tentative
CREATE OR REPLACE FUNCTION public.call_attempt_record(
  p_org_id uuid,
  p_session_id uuid,
  p_intervention_id uuid,
  p_lead_id uuid,
  p_result text,
  p_phone text DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public, core AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.organization_members
                 WHERE user_id = auth.uid() AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  INSERT INTO majordhome.call_attempts(
    org_id, session_id, intervention_id, lead_id, phone_dialed, result, note, created_by)
  VALUES (p_org_id, p_session_id, p_intervention_id, p_lead_id, p_phone, p_result, p_note, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 4c. Contexte d'une carte entretien pour le screen-pop (contrat + client + année)
CREATE OR REPLACE FUNCTION public.call_get_card_context(
  p_intervention_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = majordhome, public, core AS $$
DECLARE v_org uuid; v_res jsonb;
BEGIN
  SELECT i.org_id INTO v_org FROM majordhome.interventions i WHERE i.id = p_intervention_id;
  IF v_org IS NULL OR NOT EXISTS (SELECT 1 FROM core.organization_members
                                  WHERE user_id = auth.uid() AND org_id = v_org) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT jsonb_build_object(
    'intervention_id', i.id,
    'client_id',       c.id,
    'client_name',     TRIM(COALESCE(c.last_name,'') || ' ' || COALESCE(c.first_name,'')),
    'client_phone',    c.phone,
    'contract_id',     ct.id,
    'contract_number', ct.contract_number,
    'visit_year',      EXTRACT(YEAR FROM now())::int
  ) INTO v_res
  FROM majordhome.interventions i
  LEFT JOIN majordhome.clients   c  ON c.id = i.client_id
  LEFT JOIN majordhome.contracts ct ON ct.client_id = i.client_id AND ct.status = 'active'
  WHERE i.id = p_intervention_id
  LIMIT 1;
  RETURN v_res;
END $$;

REVOKE EXECUTE ON FUNCTION public.call_session_start(uuid,text,jsonb)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.call_attempt_record(uuid,uuid,uuid,uuid,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.call_get_card_context(uuid)                     FROM anon;
GRANT  EXECUTE ON FUNCTION public.call_session_start(uuid,text,jsonb)              TO authenticated;
GRANT  EXECUTE ON FUNCTION public.call_attempt_record(uuid,uuid,uuid,uuid,text,text,text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.call_get_card_context(uuid)                     TO authenticated;
```

> **Note** : vérifier les noms de colonnes réels de `majordhome.contracts` (`status`, `contract_number`, `client_id`) et `majordhome.clients` (`phone`, `first_name`, `last_name`) avant d'appliquer — ajuster le RPC `call_get_card_context` si la réalité diffère. Source : voir la vue `majordhome_contracts` et `majordhome_clients`.

- [ ] **Step 2 : Appliquer la migration**

Via MCP Supabase `apply_migration` (name: `call_campaign_brain`, query: contenu du fichier).

- [ ] **Step 3 : Vérifier**

Via MCP `execute_sql` :
```sql
SELECT to_regclass('majordhome.call_attempts') IS NOT NULL AS has_table,
       has_table_privilege('service_role','majordhome.call_attempts','SELECT') AS svc_select;
SELECT * FROM public.majordhome_call_attempt_stats LIMIT 1;  -- doit renvoyer 0 ligne sans erreur
```
Attendu : `has_table = true`, `svc_select = true`, pas d'erreur sur la vue.

- [ ] **Step 4 : Lancer les advisors sécurité**

Via MCP `get_advisors(type: 'security')` — vérifier qu'aucun nouveau WARN critique n'apparaît sur les 2 tables / 3 vues / 3 RPCs.

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/20260603_call_campaign_brain.sql
git commit -m "feat(appels): tables call_sessions/call_attempts + vues + RPCs (cerveau)"
```

---

## Phase 2 — Provider abstrait + Mock

### Task 2 : `CallProvider` + `MockCallProvider`

**Files:**
- Create: `src/apps/artisan/components/appels/callProvider.js`

- [ ] **Step 1 : Écrire l'interface + le mock**

```javascript
/**
 * callProvider.js — Abstraction du fournisseur d'appels.
 * V1 : MockCallProvider (simulation). Spec n°2 : provider réel (Vapi/Telnyx + PBX).
 *
 * Événements émis (1 argument { contactId, ... }) :
 *   'dialing' | 'no_answer' | 'voicemail' | 'human_answered'
 *   | 'transfer_accepted' | 'transfer_missed' | 'session_done'
 */

export class CallProvider {
  constructor() { this._handlers = {}; }
  on(event, fn)  { (this._handlers[event] ||= new Set()).add(fn); return () => this.off(event, fn); }
  off(event, fn) { this._handlers[event]?.delete(fn); }
  _emit(event, payload) { this._handlers[event]?.forEach((fn) => fn(payload)); }

  // À implémenter par les sous-classes :
  start(_contacts, _params) { throw new Error('not_implemented'); }
  pause() {}
  resume() {}
  stop()  {}
  /** Appelé par l'UI quand l'humain a pris (ou non) le transfert. */
  resolveTransfer(_contactId, _accepted) {}
}

/**
 * MockCallProvider — rejoue un scénario déterministe pour développer/tester sans téléphonie.
 * outcomes : map optionnelle { [contactId]: 'no_answer'|'voicemail'|'human_answered' }
 *            défaut : alterne non_décroché / répondeur / décroché.
 */
export class MockCallProvider extends CallProvider {
  constructor({ outcomes = {}, stepMs = 800, transferTimeoutMs = 8000 } = {}) {
    super();
    this.outcomes = outcomes;
    this.stepMs = stepMs;
    this.transferTimeoutMs = transferTimeoutMs;
    this._queue = [];
    this._paused = false;
    this._stopped = false;
    this._timer = null;
    this._pendingTransfer = null; // { contactId, timer }
  }

  start(contacts) {
    this._queue = [...contacts];
    this._stopped = false;
    this._paused = false;
    this._next();
  }

  pause()  { this._paused = true;  clearTimeout(this._timer); }
  resume() { if (this._paused && !this._stopped) { this._paused = false; this._next(); } }
  stop()   { this._stopped = true; clearTimeout(this._timer); this._clearTransfer(); this._queue = []; }

  _defaultOutcome(i) { return ['no_answer', 'voicemail', 'human_answered'][i % 3]; }

  _next() {
    if (this._stopped || this._paused) return;
    if (this._queue.length === 0) { this._emit('session_done', {}); return; }
    const contact = this._queue.shift();
    const outcome = this.outcomes[contact.id] || this._defaultOutcome(contact._index ?? 0);
    this._emit('dialing', { contactId: contact.id });
    this._timer = setTimeout(() => {
      if (this._stopped || this._paused) return;
      if (outcome === 'human_answered') {
        this._emit('human_answered', { contactId: contact.id });
        // attend resolveTransfer() ; fallback si l'humain ne prend pas
        const t = setTimeout(() => {
          this._emit('transfer_missed', { contactId: contact.id });
          this._pendingTransfer = null;
          this._next();
        }, this.transferTimeoutMs);
        this._pendingTransfer = { contactId: contact.id, timer: t };
      } else {
        this._emit(outcome, { contactId: contact.id }); // no_answer | voicemail
        this._next();
      }
    }, this.stepMs);
  }

  resolveTransfer(contactId, accepted) {
    if (!this._pendingTransfer || this._pendingTransfer.contactId !== contactId) return;
    clearTimeout(this._pendingTransfer.timer);
    this._pendingTransfer = null;
    this._emit(accepted ? 'transfer_accepted' : 'transfer_missed', { contactId });
    // l'avancement de la file après close est piloté par le hook (advance())
  }

  /** Le hook appelle advance() après que l'humain a cliqué un geste de close. */
  advance() { this._next(); }

  _clearTransfer() { if (this._pendingTransfer) { clearTimeout(this._pendingTransfer.timer); this._pendingTransfer = null; } }
}
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Attendu : succès (le fichier est importé en Phase 3, mais il doit déjà parser).

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/appels/callProvider.js
git commit -m "feat(appels): CallProvider abstrait + MockCallProvider (simulation)"
```

### Task 3 : Helper `isWithinCallWindow`

**Files:**
- Create: `src/apps/artisan/components/appels/callWindow.js`

- [ ] **Step 1 : Écrire le helper**

```javascript
/**
 * callWindow.js — Garde-fou plages horaires d'appel.
 * Défaut légal : 9h-20h, pas le dimanche. Override via params.
 */
export function isWithinCallWindow(params = {}, now = new Date()) {
  const startH = Number.isFinite(params.window_start) ? params.window_start : 9;
  const endH   = Number.isFinite(params.window_end)   ? params.window_end   : 20;
  const day = now.getDay();          // 0 = dimanche
  const h   = now.getHours();
  if (day === 0) return false;
  return h >= startH && h < endH;
}

export const DEFAULT_CALL_WINDOW = { window_start: 9, window_end: 20 };
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build` → succès.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/appels/callWindow.js
git commit -m "feat(appels): helper plages horaires d'appel"
```

---

## Phase 3 — Service, cache keys, hook moteur

### Task 4 : cache keys

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` (ajouter à la fin, avant les éventuels re-exports)

- [ ] **Step 1 : Ajouter les familles**

```javascript
// --- Appels sortants (campagnes) ---
export const callSessionKeys = {
  all: (orgId) => ['call-sessions', orgId],
  detail: (orgId, id) => [...callSessionKeys.all(orgId), 'detail', id],
};

export const callAttemptKeys = {
  all: (orgId) => ['call-attempts', orgId],
  stats: (orgId) => [...callAttemptKeys.all(orgId), 'stats'],
  byIntervention: (orgId, interventionId) => [...callAttemptKeys.all(orgId), 'intervention', interventionId],
};
```

- [ ] **Step 2 : Vérifier**

Run: `npm run lint:errors` → clean.

- [ ] **Step 3 : Commit**

```bash
git add src/shared/hooks/cacheKeys.js
git commit -m "feat(appels): cache keys callSession/callAttempt"
```

### Task 5 : Service `callCampaigns.service.js`

**Files:**
- Create: `src/shared/services/callCampaigns.service.js`

- [ ] **Step 1 : Écrire le service** (pattern `withErrorHandling`, retour `{ data, error }`)

```javascript
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

export const callCampaignsService = {
  async startSession({ orgId, kanban = 'entretien', params = {} }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('call_session_start', {
        p_org_id: orgId, p_kanban: kanban, p_params: params,
      });
      if (error) throw error;
      return data; // session id (uuid)
    }, 'callCampaigns.startSession');
  },

  async recordAttempt({ orgId, sessionId, interventionId = null, leadId = null, result, phone = null, note = null }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('call_attempt_record', {
        p_org_id: orgId, p_session_id: sessionId,
        p_intervention_id: interventionId, p_lead_id: leadId,
        p_result: result, p_phone: phone, p_note: note,
      });
      if (error) throw error;
      return data; // attempt id
    }, 'callCampaigns.recordAttempt');
  },

  async getCardContext(interventionId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('call_get_card_context', { p_intervention_id: interventionId });
      if (error) throw error;
      return data; // { intervention_id, client_id, client_name, client_phone, contract_id, contract_number, visit_year }
    }, 'callCampaigns.getCardContext');
  },

  async getStats(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_call_attempt_stats')
        .select('intervention_id, lead_id, call_count, last_call_at, last_call_result')
        .eq('org_id', orgId);
      if (error) throw error;
      return data || [];
    }, 'callCampaigns.getStats');
  },
};
```

- [ ] **Step 2 : Vérifier** — `npx vite build` → succès (l'alias `@lib` doit résoudre).

- [ ] **Step 3 : Commit**

```bash
git add src/shared/services/callCampaigns.service.js
git commit -m "feat(appels): service callCampaigns (RPCs + stats)"
```

### Task 6 : Hook `useCallSession`

**Files:**
- Create: `src/shared/hooks/useCallSession.js`

- [ ] **Step 1 : Écrire le hook moteur**

```javascript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { callCampaignsService } from '@services/callCampaigns.service';
import { MockCallProvider } from '@apps/artisan/components/appels/callProvider';
import { isWithinCallWindow, DEFAULT_CALL_WINDOW } from '@apps/artisan/components/appels/callProvider'; // see note
import { callAttemptKeys } from '@hooks/cacheKeys';

const EMPTY_COUNTERS = { dialed: 0, no_answer: 0, voicemail: 0, transfers: 0 };

/**
 * useCallSession — pilote une file d'appels séquentielle (1 à la fois) via un CallProvider.
 * @param {{ orgId: string }} opts
 */
export function useCallSession({ orgId }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const providerRef = useRef(null);
  const sessionRef = useRef(null);      // session id
  const contactsRef = useRef([]);       // [{ id (interventionId), phone, name, ... }]
  const [status, setStatus] = useState('idle'); // idle|running|paused|popped|done
  const [counters, setCounters] = useState(EMPTY_COUNTERS);
  const [current, setCurrent] = useState(null);  // contact en screen-pop

  const findContact = useCallback((id) => contactsRef.current.find((c) => c.id === id) || null, []);

  const wireProvider = useCallback((provider) => {
    provider.on('dialing', () => setCounters((c) => ({ ...c, dialed: c.dialed + 1 })));

    provider.on('no_answer', async ({ contactId }) => {
      const c = findContact(contactId);
      setCounters((k) => ({ ...k, no_answer: k.no_answer + 1 }));
      await callCampaignsService.recordAttempt({
        orgId, sessionId: sessionRef.current, interventionId: contactId,
        result: 'no_answer', phone: c?.phone,
      });
    });

    provider.on('voicemail', async ({ contactId }) => {
      const c = findContact(contactId);
      setCounters((k) => ({ ...k, voicemail: k.voicemail + 1 }));
      await callCampaignsService.recordAttempt({
        orgId, sessionId: sessionRef.current, interventionId: contactId,
        result: 'voicemail', phone: c?.phone,
      });
    });

    provider.on('human_answered', ({ contactId }) => {
      setStatus('popped');
      setCurrent(findContact(contactId));
    });

    provider.on('transfer_missed', async ({ contactId }) => {
      const c = findContact(contactId);
      await callCampaignsService.recordAttempt({
        orgId, sessionId: sessionRef.current, interventionId: contactId,
        result: 'transfer_missed', phone: c?.phone,
      });
      setCurrent(null);
      setStatus('running');
    });

    provider.on('session_done', () => { setStatus('done'); setCurrent(null); });
  }, [orgId, findContact]);

  const start = useCallback(async (contacts, params = DEFAULT_CALL_WINDOW) => {
    if (!isWithinCallWindow(params)) {
      return { error: 'hors_plage_horaire' };
    }
    const { data: sessionId, error } = await callCampaignsService.startSession({ orgId, kanban: 'entretien', params });
    if (error) return { error };
    sessionRef.current = sessionId;
    contactsRef.current = contacts.map((c, i) => ({ ...c, _index: i }));
    const provider = new MockCallProvider({});
    providerRef.current = provider;
    wireProvider(provider);
    setCounters(EMPTY_COUNTERS);
    setStatus('running');
    provider.start(contactsRef.current);
    return { data: sessionId };
  }, [orgId, wireProvider]);

  const pause  = useCallback(() => { providerRef.current?.pause();  setStatus('paused'); }, []);
  const resume = useCallback(() => { providerRef.current?.resume(); setStatus('running'); }, []);
  const stop   = useCallback(() => { providerRef.current?.stop();   setStatus('idle'); setCurrent(null); }, []);

  /** Appelé par le screen-pop après que l'humain a pris l'appel. */
  const acceptTransfer = useCallback(() => {
    if (current) providerRef.current?.resolveTransfer(current.id, true);
    setCounters((k) => ({ ...k, transfers: k.transfers + 1 }));
  }, [current]);

  /** Close + avance la file. result ∈ rdv_booked|refused|callback */
  const closeCurrent = useCallback(async ({ result, note = null } = {}) => {
    const c = current;
    if (c) {
      await callCampaignsService.recordAttempt({
        orgId, sessionId: sessionRef.current, interventionId: c.id,
        result: result || 'callback', phone: c.phone, note,
      });
      queryClient.invalidateQueries({ queryKey: callAttemptKeys.stats(orgId) });
    }
    setCurrent(null);
    setStatus('running');
    providerRef.current?.advance();
  }, [current, orgId, queryClient]);

  useEffect(() => () => providerRef.current?.stop(), []);

  return useMemo(() => ({
    status, counters, current,
    start, pause, resume, stop, acceptTransfer, closeCurrent,
  }), [status, counters, current, start, pause, resume, stop, acceptTransfer, closeCurrent]);
}
```

> **Note d'import** : `isWithinCallWindow`/`DEFAULT_CALL_WINDOW` vivent dans `callWindow.js`, pas `callProvider.js`. Corriger l'import en :
> `import { isWithinCallWindow, DEFAULT_CALL_WINDOW } from '@apps/artisan/components/appels/callWindow';`
> Vérifier que l'alias `@apps` et `@services`/`@hooks`/`@contexts` existent (vite.config.js — ils existent : `@apps`, `@services`, `@hooks`, `@contexts`).

- [ ] **Step 2 : Vérifier** — `npx vite build` → succès. Corriger l'import noté ci-dessus avant de builder.

- [ ] **Step 3 : Commit**

```bash
git add src/shared/hooks/useCallSession.js
git commit -m "feat(appels): hook useCallSession (file séquentielle + événements)"
```

---

## Phase 4 — Bouton « Lancer l'appel »

### Task 7 : `LancerAppelButton` + branchement kanban

**Files:**
- Create: `src/apps/artisan/components/appels/LancerAppelButton.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` (passer `headerExtra` à `KanbanBoard`, ligne ~268)

- [ ] **Step 1 : Écrire le bouton**

```jsx
import { useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { PhoningPanel } from './PhoningPanel';

/**
 * Bouton affiché dans le header de la colonne "À planifier".
 * @param {{ items: Array, orgId: string }} props - items = cartes de la colonne
 */
export function LancerAppelButton({ items, orgId }) {
  const [open, setOpen] = useState(false);
  const callable = (items || []).filter((i) => i.client_phone);
  const disabled = callable.length === 0;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        disabled={disabled}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium
                   rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        title={disabled ? 'Aucune carte avec téléphone' : `Appeler ${callable.length} contact(s)`}
      >
        <PhoneCall className="h-4 w-4" />
        Lancer l'appel ({callable.length})
      </button>
      {open && (
        <PhoningPanel
          orgId={orgId}
          contacts={callable.map((i) => ({ id: i.id, phone: i.client_phone, name: i.client_name }))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2 : Brancher dans `EntretienSAVKanban.jsx`**

Ajouter l'import en tête : `import { LancerAppelButton } from '../appels/LancerAppelButton';`
Puis sur le `<KanbanBoard ... />` (≈ ligne 268), ajouter la prop :

```jsx
headerExtra={(column, items) =>
  column.id === 'a_planifier'
    ? <LancerAppelButton items={items} orgId={orgId} />
    : null
}
```

> Vérifier la signature exacte de `headerExtra` dans `KanbanBoard.jsx:80` : `headerExtra(column, items)` où `column.id` = la `value` de la colonne (`'a_planifier'`). Si la prop reçue est `column.value` et non `column.id`, adapter le test.

- [ ] **Step 3 : Vérifier** — `npx vite build` → succès. (PhoningPanel est créé en Task 8 ; pour builder cette tâche isolément, créer d'abord un stub minimal de PhoningPanel, ou enchaîner Task 8 avant de builder.)

- [ ] **Step 4 : Commit** (après Task 8 si build groupé)

```bash
git add src/apps/artisan/components/appels/LancerAppelButton.jsx src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx
git commit -m "feat(appels): bouton 'Lancer l'appel' sur la colonne À planifier"
```

---

## Phase 5 — Écran de phoning + screen-pop

### Task 8 : `PhoningScreenPop` (fiche + 3 gestes rapides)

**Files:**
- Create: `src/apps/artisan/components/appels/PhoningScreenPop.jsx`

Réutilise les flux existants :
- RDV : `appointmentsService.createAppointment({ coreOrgId, intervention_id, appointment_type:'maintenance', client_id, scheduled_date, ... })` ([appointments.service.js:288](../../../src/shared/services/appointments.service.js#L288)).
- Refus : `entretiensService.recordVisit({ contractId, orgId, year, status:'cancelled', visitDate:null, notes, userId })` ([entretiens.service.js:574](../../../src/shared/services/entretiens.service.js#L574)).

- [ ] **Step 1 : Écrire le composant**

```jsx
import { useEffect, useState } from 'react';
import { Phone, CalendarPlus, XCircle, PhoneForwarded } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { callCampaignsService } from '@services/callCampaigns.service';
import { appointmentsService } from '@services/appointments.service';
import { entretiensService } from '@services/entretiens.service';

/**
 * @param {{ contact:{id,phone,name}, orgId:string, onAccept:()=>void, onClosed:(p:{result,note})=>void }} props
 */
export function PhoningScreenPop({ contact, orgId, onAccept, onClosed }) {
  const { user, organization } = useAuth();
  const [ctx, setCtx] = useState(null);
  const [mode, setMode] = useState(null); // null | 'rdv' | 'refus'
  const [rdvDate, setRdvDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    callCampaignsService.getCardContext(contact.id).then(({ data }) => { if (alive) setCtx(data); });
    onAccept(); // l'humain a "pris" le transfert dès l'ouverture du pop
    return () => { alive = false; };
  }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const bookRdv = async () => {
    setBusy(true);
    const { error } = await appointmentsService.createAppointment({
      coreOrgId: orgId,
      intervention_id: contact.id,
      appointment_type: 'maintenance',
      client_id: ctx?.client_id,
      scheduled_date: rdvDate,
      client_name: contact.name,
      subject: `Entretien annuel — ${contact.name}`,
      status: 'scheduled',
      technicianIds: [],
    });
    setBusy(false);
    if (error) { toast.error('Erreur création RDV'); return; }
    toast.success('RDV planifié');
    onClosed({ result: 'rdv_booked' });
  };

  const refuse = async () => {
    if (!ctx?.contract_id) { toast.error('Contrat introuvable'); return; }
    setBusy(true);
    const { error } = await entretiensService.recordVisit({
      contractId: ctx.contract_id, orgId, year: ctx.visit_year,
      visitDate: null, status: 'cancelled', notes: note || null, userId: user?.id,
    });
    setBusy(false);
    if (error) { toast.error('Erreur enregistrement refus'); return; }
    toast.success('Refus enregistré');
    onClosed({ result: 'refused', note });
  };

  const callback = () => onClosed({ result: 'callback' });

  return (
    <div className="rounded-xl border bg-white shadow-lg p-5">
      <div className="flex items-center gap-2 text-emerald-700 mb-1">
        <PhoneForwarded className="h-5 w-5" /><span className="font-semibold">Appel transféré</span>
      </div>
      <h3 className="text-lg font-bold text-gray-900">{contact.name}</h3>
      <p className="text-sm text-gray-500 flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{contact.phone}</p>
      {ctx?.contract_number && <p className="text-xs text-gray-400 mt-0.5">Contrat {ctx.contract_number}</p>}

      {/* 3 gestes rapides */}
      <div className="grid grid-cols-3 gap-2 mt-4">
        <button onClick={() => setMode('rdv')}   className="flex flex-col items-center gap-1 p-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
          <CalendarPlus className="h-5 w-5" /><span className="text-xs font-medium">Caler le RDV</span>
        </button>
        <button onClick={() => setMode('refus')} className="flex flex-col items-center gap-1 p-3 rounded-lg border border-red-300 bg-red-50 text-red-700 hover:bg-red-100">
          <XCircle className="h-5 w-5" /><span className="text-xs font-medium">Refusé client</span>
        </button>
        <button onClick={callback}                className="flex flex-col items-center gap-1 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100">
          <PhoneForwarded className="h-5 w-5" /><span className="text-xs font-medium">À rappeler</span>
        </button>
      </div>

      {mode === 'rdv' && (
        <div className="mt-4 space-y-2 border-t pt-3">
          <label className="block text-sm font-medium text-gray-700">Date du RDV</label>
          <input type="date" value={rdvDate} onChange={(e) => setRdvDate(e.target.value)}
                 className="w-full px-3 py-2 border rounded-lg text-sm" />
          <button disabled={busy} onClick={bookRdv}
                  className="w-full py-2 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-50">
            {busy ? 'Enregistrement…' : 'Confirmer le RDV'}
          </button>
        </div>
      )}

      {mode === 'refus' && (
        <div className="mt-4 space-y-2 border-t pt-3">
          <label className="block text-sm font-medium text-gray-700">Motif du refus</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex : déménage, plus de poêle…" />
          <button disabled={busy} onClick={refuse}
                  className="w-full py-2 rounded-lg bg-red-600 text-white font-medium disabled:opacity-50">
            {busy ? 'Enregistrement…' : 'Confirmer le refus'}
          </button>
        </div>
      )}
    </div>
  );
}
```

> Vérifier la signature réelle de `recordVisit` (Task cartography : `{ contractId, orgId, year, visitDate, status, notes, userId }`) et de `createAppointment` (`{ coreOrgId, intervention_id, appointment_type, client_id, scheduled_date, ... }`). Aligner les noms de champs date/heure réels (`scheduled_date` vs `date`/`startTime`) en lisant `appointments.service.js:288-334` avant de coder.

- [ ] **Step 2 : Vérifier** — `npx vite build` → succès.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/appels/PhoningScreenPop.jsx
git commit -m "feat(appels): screen-pop fiche contact + 3 gestes (RDV/refus/à rappeler)"
```

### Task 9 : `PhoningPanel` (overlay dashboard live + screen-pop)

**Files:**
- Create: `src/apps/artisan/components/appels/PhoningPanel.jsx`

- [ ] **Step 1 : Écrire l'overlay**

```jsx
import { X, PhoneOff, Voicemail, PhoneForwarded, Loader2 } from 'lucide-react';
import { useCallSession } from '@hooks/useCallSession';
import { PhoningScreenPop } from './PhoningScreenPop';

/**
 * @param {{ contacts:Array<{id,phone,name}>, orgId:string, onClose:()=>void }} props
 */
export function PhoningPanel({ contacts, orgId, onClose }) {
  const session = useCallSession({ orgId });
  const { status, counters, current } = session;

  const handleStart = async () => {
    const { error } = await session.start(contacts);
    if (error === 'hors_plage_horaire') {
      // Sonner toast (importer toast si souhaité) — ici simple alerte UX
      alert("Hors plage d'appel autorisée (9h-20h, hors dimanche).");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl bg-gray-50 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b">
          <h2 className="text-base font-semibold">Phoning — {contacts.length} contact(s)</h2>
          <button onClick={() => { session.stop(); onClose(); }} className="p-1.5 text-gray-400 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Compteurs live */}
          <div className="grid grid-cols-4 gap-3">
            <Counter label="Appelés"       value={counters.dialed}    icon={Loader2} />
            <Counter label="Non décrochés" value={counters.no_answer} icon={PhoneOff} />
            <Counter label="Répondeurs"    value={counters.voicemail} icon={Voicemail} />
            <Counter label="Transferts"    value={counters.transfers} icon={PhoneForwarded} />
          </div>

          {/* Zone screen-pop / contrôles */}
          {status === 'popped' && current ? (
            <PhoningScreenPop
              contact={current}
              orgId={orgId}
              onAccept={session.acceptTransfer}
              onClosed={(p) => session.closeCurrent(p)}
            />
          ) : (
            <div className="text-center py-8">
              {status === 'idle' && (
                <button onClick={handleStart} className="px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700">
                  Démarrer la séquence
                </button>
              )}
              {status === 'running' && <p className="text-gray-500 animate-pulse">Composition en cours… (en veille — vous serez notifié quand ça décroche)</p>}
              {status === 'paused'  && <button onClick={session.resume} className="px-6 py-2.5 rounded-lg bg-blue-600 text-white">Reprendre</button>}
              {status === 'done'    && <p className="text-emerald-600 font-medium">Séquence terminée.</p>}
              {status === 'running' && <button onClick={session.pause} className="mt-3 text-sm text-gray-500 underline">Mettre en pause</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, icon: Icon }) {
  return (
    <div className="bg-white rounded-lg border p-3 text-center">
      <Icon className="h-4 w-4 mx-auto text-gray-400 mb-1" />
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier** — `npx vite build` → succès.

- [ ] **Step 3 : Simulation manuelle** (serveur de dev local d'Eric, pas de preview tools)

Ranger ≥3 cartes (avec téléphone) en « À planifier », cliquer « Lancer l'appel » → « Démarrer ». Observer : compteurs non-décroché/répondeur s'incrémentent ; au 3ᵉ (mock `human_answered`), le screen-pop s'ouvre ; cliquer « Caler le RDV » → confirmer → toast + la carte passe en « Planifié » (vérifier le kanban) ; la file reprend.

- [ ] **Step 4 : Commit**

```bash
git add src/apps/artisan/components/appels/PhoningPanel.jsx
git commit -m "feat(appels): panneau phoning (compteurs live + orchestration screen-pop)"
```

---

## Phase 6 — Tag 📞 sur les cartes entretien

### Task 10 : Merge des stats d'appel dans les cartes

**Files:**
- Modify: `src/shared/hooks/useEntretienSAV.js` (merger `getStats` par `intervention_id`)
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (afficher le tag)

- [ ] **Step 1 : Charger + merger les stats dans `useEntretienSAV`**

Dans `useEntretienSAV(orgId)`, ajouter une query stats et merger sur les items :

```javascript
import { callCampaignsService } from '@services/callCampaigns.service';
import { callAttemptKeys } from '@hooks/cacheKeys';

// … dans le hook, à côté de la query items :
const { data: callStats = [] } = useQuery({
  queryKey: callAttemptKeys.stats(orgId),
  queryFn: () => callCampaignsService.getStats(orgId),
  enabled: !!orgId,
  staleTime: 15_000,
  select: (r) => r?.data || r || [],
});

const statsByIntervention = useMemo(() => {
  const m = new Map();
  (callStats || []).forEach((s) => { if (s.intervention_id) m.set(s.intervention_id, s); });
  return m;
}, [callStats]);

const itemsWithCalls = useMemo(
  () => (items || []).map((it) => {
    const s = statsByIntervention.get(it.id);
    return s ? { ...it, call_count: s.call_count, last_call_at: s.last_call_at, last_call_result: s.last_call_result } : it;
  }),
  [items, statsByIntervention],
);
```

Retourner `items: itemsWithCalls` (au lieu de `items`). Vérifier les imports `useQuery`/`useMemo` déjà présents.

- [ ] **Step 2 : Afficher le tag dans `EntretienSAVCard.jsx`**

Dans le bloc des badges de la carte (à côté des autres tags), ajouter :

```jsx
{item.call_count > 0 && (
  <span className="text-xs flex items-center gap-0.5 text-amber-600"
        title={`${item.call_count} appel${item.call_count > 1 ? 's' : ''}${item.last_call_result === 'voicemail' ? ' · répondeur' : ''}`}>
    <Phone className="h-3 w-3" />{item.call_count}
  </span>
)}
{item.last_call_result === 'callback' && (
  <span className="text-xs flex items-center gap-0.5 text-amber-700" title="À rappeler">
    <PhoneForwarded className="h-3 w-3" />
  </span>
)}
```

Ajouter `Phone, PhoneForwarded` à l'import `lucide-react` du fichier s'ils manquent.

- [ ] **Step 3 : Vérifier** — `npx vite build` → succès ; en simulation, après un non-décroché, le tag 📞 apparaît sur la carte restée en « À planifier ».

- [ ] **Step 4 : Commit**

```bash
git add src/shared/hooks/useEntretienSAV.js src/apps/artisan/components/entretiens/EntretienSAVCard.jsx
git commit -m "feat(appels): tag 📞 (compteur d'appels) sur les cartes entretien"
```

---

## Self-Review (effectué)

- **Couverture spec** : déclenchement kanban (Task 7) · file séquentielle 1-à-la-fois (Task 2/6) · `call_attempts` + dérivation (Task 1/10) · écran phoning + compteurs (Task 9) · screen-pop + 3 gestes réutilisant les flux existants (Task 8) · refus = `recordVisit status='cancelled'` (Task 8) · garde-fou horaire (Task 3/6) · transfert loupé → fallback (Task 2/6) · marqueurs carte (Task 10). ✅
- **Hors V1 assumé** : pipeline leads chauds (provider/hook conçus kanban-agnostiques, branchement ultérieur) ; volet audio réel (spec n°2 remplace `MockCallProvider` par un provider réel sans toucher au hook/UI) ; re-tentatives auto (relance de batch manuelle en V1).
- **Cohérence types** : événements provider (`no_answer`/`voicemail`/`human_answered`/`transfer_accepted`/`transfer_missed`/`session_done`) identiques entre `callProvider.js` (Task 2) et `useCallSession.js` (Task 6). `result` enum identique entre la migration (Task 1) et `recordAttempt` (Task 5/6/8).
- **Points à confirmer à l'exécution** (signalés inline, non bloquants) : noms de colonnes `majordhome.contracts`/`clients` dans `call_get_card_context` ; signature exacte des champs date de `createAppointment` ; `column.id` vs `column.value` dans `headerExtra`.

---

## Dépendances inter-tâches

Task 1 (DB) → indépendante. Task 2/3 → indépendantes. Task 4 → indépendante. Task 5 dépend de 1. Task 6 dépend de 2/3/5. Task 7 dépend de 9 (stub possible). Task 8 dépend de 5 + services existants. Task 9 dépend de 6/8. Task 10 dépend de 5. Ordre conseillé : 1 → 2 → 3 → 4 → 5 → 6 → 8 → 9 → 7 → 10.
