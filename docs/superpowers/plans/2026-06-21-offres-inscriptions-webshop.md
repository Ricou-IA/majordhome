# Offres & Inscriptions (capture campagne → dashboard Webshop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capturer les inscriptions de n'importe quelle offre (campagne) dans une table générique et les afficher dans un nouveau sous-onglet « Inscriptions » du Webshop, en self-service.

**Architecture:** Une offre = une campagne Mailing (`mail_campaigns.key`). La page du site appelle une RPC publique `inscription_record` (SECURITY DEFINER, org **dérivée de la campagne**, alignée sur l'org **core** comme `clients`) → INSERT dans `majordhome.campaign_inscriptions` (1 ligne = 1 inscription, champs libres en `data` jsonb) + dédoublonnage/création client + parrainage. Le front lit la vue publique `majordhome_campaign_inscriptions` (RLS org-scopée) et exporte en CSV.

**Tech Stack:** PostgreSQL/Supabase (RLS, SECURITY DEFINER, vue `security_invoker`), React 18 + Vite, Tailwind, lucide-react, Sonner. Spec source : [docs/superpowers/specs/2026-06-21-offres-inscriptions-webshop-design.md](../specs/2026-06-21-offres-inscriptions-webshop-design.md).

**Modèle de vérification (conventions maison) :** pas de preview tools (Eric a son serveur de dev) → on vérifie par `npx vite build`. Logique pure testée par `node --test scripts/*.test.mjs`. La RPC est vérifiée par un smoke-test SQL (échec-avant / succès-après) via le MCP Supabase. Lint guard : `npm run lint:errors` (lancé par le pre-commit hook ; ne doit produire **aucune** erreur).

---

## File Structure

| Fichier | Responsabilité |
|---------|----------------|
| `supabase/migrations/20260621_campaign_inscriptions.sql` | table + index + RLS + grants + vue publique + RPC `inscription_record` |
| `src/lib/csv.js` | helper **pur** `toCsv(rows, columns)` (échappement RFC-4180) — testable, réutilisable |
| `scripts/csv.test.mjs` | tests `node --test` du helper CSV |
| `src/shared/services/inscriptions.service.js` | lecture des inscriptions (vue publique, filtre org) |
| `src/apps/artisan/components/webshop/InscriptionsTab.jsx` | sous-onglet : liste + filtre campagne + détail + export CSV |
| `src/apps/artisan/pages/Webshop.jsx` | montage du 3ᵉ onglet « Inscriptions » |

**Déviation assumée vs spec §8.2 (Posture #5 — on choisit et on le dit) :** le module Webshop n'utilise PAS React Query (`OrdersTab`/`ProductsTab` = `useState`/`useEffect` + service direct). On s'aligne sur ce pattern local pour `InscriptionsTab` → **pas de hook React Query ni d'entrée `cacheKeys`** (plus simple, cohérent avec le module édité). Le `.eq('org_id', orgId)` reste appliqué (défense en profondeur, charte).

---

## Task 1: Migration DB — table, vue, RPC

**Files:**
- Create: `supabase/migrations/20260621_campaign_inscriptions.sql`

- [ ] **Step 1: Smoke-test « échec avant » (la table n'existe pas encore)**

Exécuter via MCP Supabase (`execute_sql`, project `odspcxgafcqxjzrarsqf`) :
```sql
SELECT * FROM public.majordhome_campaign_inscriptions LIMIT 1;
```
Attendu : ERREUR `relation "public.majordhome_campaign_inscriptions" does not exist`.

- [ ] **Step 2: Écrire le fichier de migration**

Contenu **complet** de `supabase/migrations/20260621_campaign_inscriptions.sql` :
```sql
-- 20260621_campaign_inscriptions.sql
-- Système générique d'inscriptions par campagne (offres) -> dashboard Webshop.
-- Charte multi-tenant : RLS + GRANT service_role + vue security_invoker + RPC SECDEF (org derivee de la campagne).
-- Org alignee sur CORE (comme majordhome.clients / mail_campaigns), PAS getMajordhomeOrgId().

-- 1) Table -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.campaign_inscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES core.organizations(id),
  campaign_key         text NOT NULL,
  client_id            uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  lead_id              uuid,
  first_name           text,
  last_name            text,
  email                text,
  phone                text,
  address              text,
  postal_code          text,
  city                 text,
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  parrainage_code_used text,
  parrain_id           uuid,
  source               text,
  from_token           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_inscriptions_org_campaign
  ON majordhome.campaign_inscriptions (org_id, campaign_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_inscriptions_email
  ON majordhome.campaign_inscriptions (email);

-- 2) RLS ---------------------------------------------------------------------
ALTER TABLE majordhome.campaign_inscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaign_inscriptions_select_org_members ON majordhome.campaign_inscriptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
                 WHERE om.org_id = campaign_inscriptions.org_id AND om.user_id = auth.uid()));

CREATE POLICY campaign_inscriptions_delete_org_members ON majordhome.campaign_inscriptions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
                 WHERE om.org_id = campaign_inscriptions.org_id AND om.user_id = auth.uid()));
-- Pas de policy INSERT/UPDATE -> ecriture uniquement via la RPC SECURITY DEFINER.

-- 3) Grants ------------------------------------------------------------------
-- Lecture front via la vue security_invoker -> authenticated a besoin de SELECT sur la table.
GRANT SELECT, DELETE ON majordhome.campaign_inscriptions TO authenticated;
-- Charte : table lue via vue publique -> service_role SELECT explicite (edge functions).
GRANT SELECT ON majordhome.campaign_inscriptions TO service_role;

-- 4) Vue publique (miroir simple + JOIN label campagne / nom client) ---------
CREATE OR REPLACE VIEW public.majordhome_campaign_inscriptions
WITH (security_invoker = true) AS
SELECT
  i.id, i.org_id, i.campaign_key, i.client_id, i.lead_id,
  i.first_name, i.last_name, i.email, i.phone,
  i.address, i.postal_code, i.city,
  i.data, i.parrainage_code_used, i.parrain_id, i.source, i.from_token, i.created_at,
  mc.label        AS campaign_label,
  c.display_name  AS client_display_name,
  c.client_number AS client_number
FROM majordhome.campaign_inscriptions i
LEFT JOIN majordhome.mail_campaigns mc ON mc.key = i.campaign_key AND mc.org_id = i.org_id
LEFT JOIN majordhome.clients c        ON c.id  = i.client_id;

GRANT SELECT ON public.majordhome_campaign_inscriptions TO anon, authenticated, service_role;

-- 5) RPC de capture (endpoint public ; org derivee de la campagne, jamais du payload) --
CREATE OR REPLACE FUNCTION public.inscription_record(
  p_campaign_key text,
  p_payload      jsonb,
  p_token        text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'majordhome', 'core', 'extensions'
AS $function$
DECLARE
  v_org         uuid;
  v_org_count   int;
  v_first       text := NULLIF(trim(p_payload->>'first_name'), '');
  v_last        text := NULLIF(trim(p_payload->>'last_name'), '');
  v_email       text := NULLIF(lower(trim(p_payload->>'email')), '');
  v_phone       text := NULLIF(trim(p_payload->>'phone'), '');
  v_address     text := NULLIF(trim(p_payload->>'address'), '');
  v_postal      text := NULLIF(trim(p_payload->>'postal_code'), '');
  v_city        text := NULLIF(trim(p_payload->>'city'), '');
  v_source      text := NULLIF(trim(p_payload->>'source'), '');
  v_parr_code   text := NULLIF(trim(p_payload->>'parrainage_code'), '');
  v_data        jsonb;
  v_clean_phone text;
  v_client_id   uuid;
  v_is_new      boolean := false;
  v_parrain_id  uuid;
  v_project_id  uuid;
  v_display     text;
  v_insc_id     uuid;
  v_now         timestamptz := now();
BEGIN
  -- 1) org derivee de la campagne (jamais du payload -> anon-safe)
  SELECT count(*) INTO v_org_count FROM majordhome.mail_campaigns WHERE key = p_campaign_key;
  IF v_org_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'campagne_inconnue');
  ELSIF v_org_count > 1 THEN
    RETURN json_build_object('success', false, 'error', 'campagne_ambigue');
  END IF;
  SELECT org_id INTO v_org FROM majordhome.mail_campaigns WHERE key = p_campaign_key;

  -- 2) validation minimale
  IF v_first IS NULL OR v_last IS NULL OR (v_email IS NULL AND v_phone IS NULL) THEN
    RETURN json_build_object('success', false, 'error', 'champs_obligatoires_manquants');
  END IF;

  -- 3) data = payload moins les cles de contact connues
  v_data := (p_payload - 'first_name' - 'last_name' - 'email' - 'phone'
                       - 'address' - 'postal_code' - 'city' - 'source' - 'parrainage_code');

  -- 4) parrainage (optionnel)
  IF v_parr_code IS NOT NULL THEN
    SELECT id INTO v_parrain_id FROM majordhome.clients
    WHERE upper(parrainage_code) = upper(v_parr_code) AND org_id = v_org AND is_archived = false
    LIMIT 1;
  END IF;

  -- 5) resolution client : dedoublonnage email/phone, sinon creation (parite pellets)
  --    (Lot 2 : si p_token fourni, resoudre le client via clients.campaign_link_token ici.)
  v_clean_phone := regexp_replace(COALESCE(v_phone, ''), '[^0-9+]', '', 'g');

  SELECT id INTO v_client_id FROM majordhome.clients
  WHERE org_id = v_org AND is_archived = false
    AND ((v_email IS NOT NULL AND lower(email) = v_email)
      OR (v_clean_phone <> '' AND regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = v_clean_phone))
  LIMIT 1;

  IF v_client_id IS NULL THEN
    v_is_new := true;
    v_display := upper(v_first || ' ' || v_last);

    INSERT INTO core.projects (org_id, name, status, created_at, updated_at)
    VALUES (v_org, v_display, 'active', v_now, v_now)
    RETURNING id INTO v_project_id;

    -- NOTE: client_number OMIS volontairement -> DEFAULT sequence (gotcha DB).
    INSERT INTO majordhome.clients (
      first_name, last_name, email, phone, address, postal_code, city,
      org_id, project_id, display_name, parrain_id, parrainage_code, created_at, updated_at
    ) VALUES (
      v_first, v_last, v_email, v_phone, v_address, v_postal, v_city,
      v_org, v_project_id, v_display, v_parrain_id,
      upper(substring(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6)),
      v_now, v_now
    ) RETURNING id INTO v_client_id;
  END IF;

  -- 6) insert inscription (TOUJOURS)
  INSERT INTO majordhome.campaign_inscriptions (
    org_id, campaign_key, client_id, first_name, last_name, email, phone,
    address, postal_code, city, data, parrainage_code_used, parrain_id, source, from_token
  ) VALUES (
    v_org, p_campaign_key, v_client_id, v_first, v_last, v_email, v_phone,
    v_address, v_postal, v_city, COALESCE(v_data, '{}'::jsonb), v_parr_code, v_parrain_id, v_source,
    (p_token IS NOT NULL)
  ) RETURNING id INTO v_insc_id;

  RETURN json_build_object(
    'success', true,
    'inscription_id', v_insc_id,
    'client_id', v_client_id,
    'is_new_client', v_is_new,
    'parrain_found', v_parrain_id IS NOT NULL
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.inscription_record(text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.inscription_record(text, jsonb, text) TO anon, authenticated;

-- 6) reload PostgREST (nouvelle table + vue exposees)
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Appliquer la migration**

Via MCP Supabase `apply_migration` (name: `campaign_inscriptions`, query = contenu du fichier). Additif uniquement (CREATE), sûr sur l'instance partagée.
Attendu : succès, pas d'erreur.

- [ ] **Step 4: Smoke-test « succès après » + nettoyage (pas de pollution prod)**

Exécuter via `execute_sql` (la campagne `decouverte_de_la_buche_compresse` existe déjà) :
```sql
-- a) capture
SELECT public.inscription_record(
  'decouverte_de_la_buche_compresse',
  '{"first_name":"TEST","last_name":"SMOKE","email":"smoke@example.invalid","postal_code":"81000","city":"ALBI","source":"smoke","quantite":2}'::jsonb
) AS rpc_result;
```
Attendu : `{"success":true,"inscription_id":"…","client_id":"…","is_new_client":true,"parrain_found":false}`.
```sql
-- b) visible dans la vue + data jsonb conservee
SELECT campaign_key, campaign_label, first_name, city, data, client_number
FROM public.majordhome_campaign_inscriptions WHERE email = 'smoke@example.invalid';
```
Attendu : 1 ligne, `campaign_label` = libellé de la campagne, `data` = `{"quantite": 2}`, `client_number` non nul (CLI-xxxxx).
```sql
-- c) privilege charte
SELECT has_table_privilege('service_role', 'majordhome.campaign_inscriptions', 'SELECT') AS sr_select;
```
Attendu : `true`.
```sql
-- d) NETTOYAGE (supprime inscription + client + projet de test)
DELETE FROM majordhome.campaign_inscriptions WHERE email = 'smoke@example.invalid';
WITH del AS (
  DELETE FROM majordhome.clients WHERE email = 'smoke@example.invalid' RETURNING project_id
)
DELETE FROM core.projects WHERE id IN (SELECT project_id FROM del);
```
Attendu : DELETE 1 (inscription), DELETE 1 (client+projet). Vérifier ensuite que `SELECT count(*) FROM majordhome.campaign_inscriptions WHERE email='smoke@example.invalid'` = 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260621_campaign_inscriptions.sql
git commit -m "feat(webshop): table+RPC inscriptions campagne (inscription_record, RLS, vue)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Helper CSV pur (`toCsv`) — TDD

**Files:**
- Create: `src/lib/csv.js`
- Test: `scripts/csv.test.mjs`

- [ ] **Step 1: Écrire le test qui échoue**

Contenu complet de `scripts/csv.test.mjs` :
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/lib/csv.js';

test('toCsv — entete + ligne simple', () => {
  const out = toCsv([{ a: 1, b: 'x' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
  assert.equal(out, 'A,B\r\n1,x');
});

test('toCsv — echappe virgule, guillemet, retour ligne', () => {
  const out = toCsv([{ a: 'hello, "world"\nl2' }], [{ key: 'a', label: 'A' }]);
  assert.equal(out, 'A\r\n"hello, ""world""\nl2"');
});

test('toCsv — null/undefined -> vide, objet -> json', () => {
  const out = toCsv(
    [{ a: null, b: undefined, c: { q: 2 } }],
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]
  );
  assert.equal(out, 'A,B,C\r\n,,"{""q"":2}"');
});

test('toCsv — sans lignes -> entete seule', () => {
  assert.equal(toCsv([], [{ key: 'a', label: 'A' }]), 'A');
});
```

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `node --test scripts/csv.test.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/csv.js'`.

- [ ] **Step 3: Implémenter le helper**

Contenu complet de `src/lib/csv.js` :
```js
/**
 * csv.js — conversion generique d'un tableau d'objets en CSV (RFC 4180).
 * Separateur virgule, fin de ligne CRLF. Champs contenant , " ou saut de ligne -> entoures de "",
 * guillemets internes doubles. null/undefined -> chaine vide ; objets -> JSON.stringify.
 *
 * @param {Array<object>} rows
 * @param {Array<{key: string, label: string}>} columns
 * @returns {string}
 */
export function toCsv(rows, columns) {
  const esc = (val) => {
    if (val === null || val === undefined) return '';
    const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => esc(row[c.key])).join(',')).join('\r\n');
  return body ? header + '\r\n' + body : header;
}
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `node --test scripts/csv.test.mjs`
Expected: PASS (4 tests, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv.js scripts/csv.test.mjs
git commit -m "feat(lib): helper pur toCsv + tests node:test" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Service de lecture des inscriptions

**Files:**
- Create: `src/shared/services/inscriptions.service.js`

- [ ] **Step 1: Écrire le service**

Contenu complet de `src/shared/services/inscriptions.service.js` :
```js
/**
 * inscriptions.service.js - Majord'home Artisan
 * ============================================================================
 * Module Offres/Inscriptions : lecture des inscriptions aux campagnes (offres).
 * Lecture via la vue publique majordhome_campaign_inscriptions (RLS security_invoker).
 * Ecriture = uniquement cote site via la RPC public.inscription_record (hors app).
 * Org : core (alignee sur clients/mail_campaigns) - filtre explicite (defense en profondeur).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

export const inscriptionsService = {
  /**
   * Liste des inscriptions (vue enrichie : campaign_label, client_display_name).
   * @param {object} params
   * @param {string} params.orgId - org core (obligatoire, defense en profondeur)
   * @param {string} [params.campaignKey] - filtre campagne exact
   */
  async getInscriptions({ orgId, campaignKey } = {}) {
    return withErrorHandling(async () => {
      let query = supabase
        .from('majordhome_campaign_inscriptions')
        .select('*')
        .order('created_at', { ascending: false });

      if (orgId) query = query.eq('org_id', orgId);
      if (campaignKey) query = query.eq('campaign_key', campaignKey);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }, 'inscriptions.getInscriptions');
  },
};

export default inscriptionsService;
```

- [ ] **Step 2: Vérifier le build**

Run: `npx vite build`
Expected: build OK, aucune erreur d'import (`@services`, `@lib` résolus).

- [ ] **Step 3: Commit**

```bash
git add src/shared/services/inscriptions.service.js
git commit -m "feat(webshop): inscriptions.service (lecture vue campaign_inscriptions)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Sous-onglet « Inscriptions »

**Files:**
- Create: `src/apps/artisan/components/webshop/InscriptionsTab.jsx`

- [ ] **Step 1: Écrire le composant**

Contenu complet de `src/apps/artisan/components/webshop/InscriptionsTab.jsx` :
```jsx
/**
 * InscriptionsTab.jsx - Webshop
 * ============================================================================
 * Sous-onglet « Inscriptions » : inscriptions aux offres (campagnes).
 * Filtre par campagne, detail contact + champs libres (data jsonb), export CSV.
 * Pattern aligne sur OrdersTab (useState/useEffect + service direct, pas React Query).
 * ============================================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Megaphone, RefreshCw, Loader2, Download, ChevronDown, ChevronUp,
  Phone, Mail, MapPin, Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { inscriptionsService } from '@services/inscriptions.service';
import { toCsv } from '@lib/csv';

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const formatDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function InscriptionRow({ insc }) {
  const [expanded, setExpanded] = useState(false);
  const extra = insc.data && typeof insc.data === 'object' ? Object.entries(insc.data) : [];

  return (
    <div className="bg-white border border-secondary-200 rounded-xl overflow-hidden">
      <div
        className="grid grid-cols-12 gap-2 items-center px-4 py-3 cursor-pointer hover:bg-secondary-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="col-span-3">
          <p className="font-medium text-sm text-secondary-900">{insc.first_name} {insc.last_name}</p>
          <p className="text-xs text-secondary-500">{insc.postal_code} {insc.city}</p>
        </div>
        <div className="col-span-4 min-w-0">
          <p className="text-sm text-secondary-700 truncate">{insc.email || insc.phone || '—'}</p>
          {insc.client_id && (
            <p className="text-xs text-emerald-700">Client CRM lié{insc.client_number ? ` (${insc.client_number})` : ''}</p>
          )}
        </div>
        <div className="col-span-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
            {insc.campaign_label || insc.campaign_key}
          </span>
        </div>
        <div className="col-span-1 text-right text-xs text-secondary-500">{formatDate(insc.created_at)}</div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp className="w-4 h-4 text-secondary-400" /> : <ChevronDown className="w-4 h-4 text-secondary-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-secondary-100 bg-secondary-50/50 px-4 py-4 grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400">Contact</p>
            {insc.phone && (
              <p className="text-sm text-secondary-600 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /><a href={`tel:${insc.phone}`} className="hover:text-primary-600">{insc.phone}</a>
              </p>
            )}
            {insc.email && (
              <p className="text-sm text-secondary-600 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /><a href={`mailto:${insc.email}`} className="hover:text-primary-600">{insc.email}</a>
              </p>
            )}
            {insc.address && (
              <p className="text-sm text-secondary-600 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />{insc.address}, {insc.postal_code} {insc.city}
              </p>
            )}
            {insc.parrainage_code_used && (
              <p className="text-xs text-secondary-500 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />Parrainage : {insc.parrainage_code_used}{insc.parrain_id ? ' (parrain trouvé)' : ''}
              </p>
            )}
            <p className="text-xs text-secondary-400">Inscrit le {formatDateTime(insc.created_at)} · source : {insc.source || '—'}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-400">Détails de l'offre</p>
            {extra.length === 0 ? (
              <p className="text-sm text-secondary-400 italic">Aucun champ supplémentaire</p>
            ) : (
              <dl className="text-sm space-y-0.5">
                {extra.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-secondary-500">{k} :</dt>
                    <dd className="text-secondary-800">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InscriptionsTab() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState('all');

  const load = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    const { data, error } = await inscriptionsService.getInscriptions({ orgId });
    setIsLoading(false);
    if (error) {
      toast.error('Erreur de chargement des inscriptions');
      return;
    }
    setRows(data);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const campaigns = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.campaign_key)) {
        map.set(r.campaign_key, { key: r.campaign_key, label: r.campaign_label || r.campaign_key, count: 0 });
      }
      map.get(r.campaign_key).count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => campaignFilter === 'all' || r.campaign_key === campaignFilter),
    [rows, campaignFilter]
  );

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error('Aucune inscription à exporter');
      return;
    }
    const csv = toCsv(filtered, [
      { key: 'campaign_label', label: 'Campagne' },
      { key: 'first_name', label: 'Prénom' },
      { key: 'last_name', label: 'Nom' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Téléphone' },
      { key: 'address', label: 'Adresse' },
      { key: 'postal_code', label: 'CP' },
      { key: 'city', label: 'Ville' },
      { key: 'parrainage_code_used', label: 'Parrainage' },
      { key: 'source', label: 'Source' },
      { key: 'created_at', label: 'Inscrit le' },
      { key: 'data', label: 'Détails' },
    ]);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscriptions-${campaignFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCampaignFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            campaignFilter === 'all'
              ? 'bg-secondary-900 text-white border-secondary-900'
              : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
          }`}
        >
          Toutes ({rows.length})
        </button>
        {campaigns.map((c) => (
          <button
            key={c.key}
            onClick={() => setCampaignFilter(c.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              campaignFilter === c.key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-secondary-600 border-secondary-200 hover:border-secondary-400'
            }`}
          >
            {c.label} ({c.count})
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            onClick={load}
            className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 text-primary-600 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-secondary-200 rounded-xl">
          <Megaphone className="w-10 h-10 text-secondary-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-secondary-600">Aucune inscription</p>
          <p className="text-xs text-secondary-400 mt-1">Les inscriptions aux offres (campagnes) apparaîtront ici.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((insc) => <InscriptionRow key={insc.id} insc={insc} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le build**

Run: `npx vite build`
Expected: build OK (le composant n'est pas encore monté, mais doit compiler — imports résolus).

- [ ] **Step 3: Commit**

```bash
git add src/apps/artisan/components/webshop/InscriptionsTab.jsx
git commit -m "feat(webshop): sous-onglet InscriptionsTab (liste, filtre campagne, export CSV)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Montage du 3ᵉ onglet dans Webshop.jsx

**Files:**
- Modify: `src/apps/artisan/pages/Webshop.jsx`

- [ ] **Step 1: Importer le composant**

Après la ligne d'import du service webshop (lignes 34-40), ajouter :
```jsx
import InscriptionsTab from '@/apps/artisan/components/webshop/InscriptionsTab';
```

- [ ] **Step 2: Ajouter le bouton d'onglet**

Dans le bloc `{/* Tabs */}` (après le bouton « Produits & tarifs », avant la fermeture du `</div>` de la barre d'onglets, vers la ligne 561), ajouter :
```jsx
        <button
          onClick={() => setTab('inscriptions')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'inscriptions'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-secondary-500 hover:text-secondary-700'
          }`}
        >
          Inscriptions
        </button>
```

- [ ] **Step 3: Brancher le rendu**

Remplacer la ligne 563 :
```jsx
      {tab === 'orders' ? <OrdersTab /> : <ProductsTab />}
```
par :
```jsx
      {tab === 'orders' ? <OrdersTab /> : tab === 'products' ? <ProductsTab /> : <InscriptionsTab />}
```

- [ ] **Step 4: Vérifier le build + lint**

Run: `npx vite build`
Expected: build OK.
Run: `npm run lint:errors`
Expected: 0 erreur.

- [ ] **Step 5: Vérification manuelle (Eric — serveur de dev)**

- Webshop affiche un 3ᵉ onglet « Inscriptions ».
- Onglet vide au départ (« Aucune inscription »).
- Insérer une inscription de test via le MCP (`inscription_record('decouverte_de_la_buche_compresse', '{"first_name":"DEMO","last_name":"WEB","email":"demo-web@example.invalid","quantite":1}')`) → après « Rafraîchir », la ligne apparaît, scopée à l'org d'Eric, sous le bon libellé de campagne ; le dépliant montre `quantite: 1` ; « Export CSV » télécharge un fichier ouvrable dans Excel (accents OK via BOM).
- **Nettoyer** la ligne de démo (mêmes DELETE qu'au Task 1 Step 4d, email `demo-web@example.invalid`).

- [ ] **Step 6: Commit**

```bash
git add src/apps/artisan/pages/Webshop.jsx
git commit -m "feat(webshop): monte le 3e onglet Inscriptions" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (rempli)

**1. Spec coverage :**
- §6.1 table `campaign_inscriptions` → Task 1. ✓
- §6.2 vue `majordhome_campaign_inscriptions` (security_invoker, JOIN label/client) → Task 1. ✓
- §7 RPC `inscription_record` (org dérivée, dédoublonnage, parrainage, data jsonb) → Task 1. ✓
- §8.1 service lecture (`.eq('org_id')`) → Task 3. ✓
- §8.3 sous-onglet Webshop (filtre campagne, détail, CSV) → Tasks 4-5. ✓
- §10 sécurité (RLS, grant service_role, anon EXECUTE RPC, défense en profondeur) → Task 1 + Task 3. ✓
- §8.2 hook/cacheKeys React Query → **délibérément non implémenté** (déviation documentée : alignement pattern Webshop). ✓
- Lot 2 (token prefill, form generator) + bug org Webshop → **hors scope** (non planifié, par design). ✓

**2. Placeholder scan :** aucun TBD/TODO ; tout le code est complet (migration, helper+tests, service, composant, edits). ✓

**3. Type consistency :** `toCsv(rows, columns:[{key,label}])` défini Task 2, consommé Task 4 avec la même signature. `inscriptionsService.getInscriptions({orgId, campaignKey})` défini Task 3, appelé Task 4 avec `{orgId}`. Champs de la vue (`campaign_label`, `client_number`, `data`, `parrainage_code_used`, `parrain_id`…) définis Task 1, consommés Task 4. RPC retour `{success, inscription_id, client_id, is_new_client, parrain_found}` cohérent migration ↔ smoke-test. ✓

---

## Dépendance hors-repo (à faire côté site mayer-energie.fr)

La page d'offre doit appeler (clé anon) :
```js
await supabase.rpc('inscription_record', {
  p_campaign_key: '<mail_campaigns.key>',   // ex. 'decouverte_de_la_buche_compresse'
  p_payload: { first_name, last_name, email, phone, address, postal_code, city, source: 'website', /* + champs offre -> data */ }
});
```
Pré-requis : la campagne existe dans Mailing avec cette `key`. Pas couvert par ce plan (hors repo app).
