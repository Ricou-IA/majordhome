> **⚠️ REMPLACÉ — non implémenté.** Approche `lead_split` (« 1 lead = 1 chantier ») abandonnée au profit de l'entité `majordhome.chantiers` (un chantier par devis validé, gestes Détacher / Grouper), en prod le 2026-10-01 (migrations `20260930_16..18`). Conservé pour l'analyse du problème (cas GOUIN, 12 chantiers / 74 multi-devis).

# Chantier : séparation en chantiers distincts — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre de séparer une carte chantier qui porte plusieurs devis validés en deux cartes (deux leads), et poser une fois la question « même chantier ou chantiers distincts ? » sur les cartes concernées.

**Architecture:** Le modèle « 1 lead = 1 chantier » est conservé : la séparation est une RPC SECURITY DEFINER `lead_split` (inverse de `lead_merge`) qui crée un second lead pour le même client et y déplace devis, révisions, réceptions de lignes et jours d'installation choisis. La question est mémorisée par `lead_pennylane_quotes.scope_confirmed_at`, exposée par `lead_quote_stats` → `majordhome_chantiers.quotes_to_arbitrate`. Côté front : un module pur `chantierSplit.js` calcule le résumé et les erreurs, un dialogue `SplitChantierDialog` les affiche, la fiche chantier porte le bandeau et le lien.

**Tech Stack:** PostgreSQL (Supabase, migrations versionnées + harnais `scripts/migration-rehearsal/`), React 18 + TanStack Query v5, Tailwind, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-30-chantier-separation-devis-design.md`

## Global Constraints

- Charte multi-tenant (CLAUDE.md) : toute RPC SECURITY DEFINER → `REVOKE EXECUTE … FROM PUBLIC, anon` immédiatement ; garde d'autorisation **positive** (`IS NOT TRUE`), `auth.uid() IS NULL` refusé en première instruction.
- Vues : `CREATE OR REPLACE VIEW` n'accepte l'ajout de colonnes qu'**en fin de liste** ; `WITH (security_invoker = true)` conservé.
- « Gagner un lead » = UNIQUEMENT `lead_mark_won_with_quote` — la RPC de séparation l'appelle, ne recopie rien.
- Aucune allowlist de statut Pennylane recopiée : toujours `majordhome.quote_status_bucket()`.
- Mutations React Query : `mutationFn` déballe via `unwrapResult()` ; appelants en try/catch + toast.
- Cache keys : uniquement celles de `src/shared/hooks/cacheKeys.js`, `orgId` en 1ᵉʳ paramètre.
- Modules purs (`src/lib/*.js`) : aucun import React/Supabase/alias ; test `node --test` inscrit dans `audit:quality`.
- Toute migration structurelle est répétée sur le harnais (`scripts/migration-rehearsal/`) avant livraison ; le harnais est un sous-ensemble déclaré, on **étend** `snapshot.mjs`, on ne contourne pas.
- Travail sur `C:\Dev\Frontend-Majordhome`, branche `main`, pas de worktree. Vérification par `npx vite build` (jamais les preview tools). Commit à la fin de chaque tâche, **jamais de push** sans demande d'Eric. Application de la migration en prod (MCP `apply_migration`, projet `ejqqqwudmizqisdkxohw`) **seulement sur accord explicite d'Eric** (tâche 4).
- Interface et messages en français ; code en anglais, sauf les modules purs qui suivent la convention existante (`installOrder.js` : noms français).

---

### Task 1 : module pur `chantierSplit.js`

**Files:**
- Create: `src/lib/chantierSplit.js`
- Create: `scripts/chantier-split.test.mjs`
- Modify: `package.json:13` (script `audit:quality`)

**Interfaces:**
- Produces: `resumeSeparation(donnees, selection)` et `commandeSuitParDefaut(plannedOrder, nbJoursSelectionnes)` (signatures ci-dessous), consommées par `SplitChantierDialog` (tâche 6).

- [ ] **Step 1 : écrire le test qui échoue**

```js
// scripts/chantier-split.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeSeparation, commandeSuitParDefaut } from '../src/lib/chantierSplit.js';

// Cas GOUIN (prod, 2026-09-30) : borne facturée, PAC acceptée, variante PAC expirée.
const borne = { id: 'q-borne', is_validated: true, quote_amount_ht: '1260.76', quote_label: 'D-2026-09430' };
const pac = { id: 'q-pac', is_validated: true, quote_amount_ht: '11540', quote_label: 'D-2026-09466' };
const pacExpiree = { id: 'q-pac-old', is_validated: false, quote_amount_ht: '10240.34', quote_label: 'D-2026-09483' };
const quotes = [borne, pac, pacExpiree];
const j18 = { id: 'a-18', scheduled_date: '2026-09-18', technician_ids: ['t1'] };
const j03 = { id: 'a-03', scheduled_date: '2026-11-03', technician_ids: ['t1', 't2'] };
const j04 = { id: 'a-04', scheduled_date: '2026-11-04', technician_ids: ['t1', 't2'] };
const j05 = { id: 'a-05', scheduled_date: '2026-11-05', technician_ids: ['t1', 't2'] };
const appointments = [j18, j03, j04, j05];
const plannedOrder = { teamSize: 2, days: 3 };

test('resumeSeparation : GOUIN — la PAC et ses 3 jours partent, la borne reste', () => {
  const r = resumeSeparation({ quotes, appointments, plannedOrder }, {
    quoteIds: ['q-pac', 'q-pac-old'], appointmentIds: ['a-03', 'a-04', 'a-05'], moveOrder: true,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.origine.montant, 1260.76);
  assert.deepEqual(r.origine.devis.map((q) => q.id), ['q-borne']);
  assert.deepEqual(r.origine.jours.map((a) => a.id), ['a-18']);
  assert.equal(r.origine.commande, null);
  assert.equal(r.nouveau.montant, 11540);
  assert.deepEqual(r.nouveau.devis.map((q) => q.id), ['q-pac', 'q-pac-old']);
  assert.deepEqual(r.nouveau.jours.map((a) => a.id), ['a-03', 'a-04', 'a-05']);
  assert.deepEqual(r.nouveau.commande, plannedOrder);
});

test('resumeSeparation : le montant ne compte que les devis validés', () => {
  const r = resumeSeparation({ quotes, appointments, plannedOrder }, { quoteIds: ['q-pac', 'q-pac-old'] });
  assert.equal(r.nouveau.montant, 11540);
});

test('resumeSeparation : sélection vide → erreur', () => {
  const r = resumeSeparation({ quotes, appointments, plannedOrder }, { quoteIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Sélectionnez au moins un devis.']);
});

test('resumeSeparation : seulement un devis non validé sélectionné → erreur', () => {
  const r = resumeSeparation({ quotes, appointments, plannedOrder }, { quoteIds: ['q-pac-old'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Le nouveau chantier doit emporter au moins un devis validé.']);
});

test('resumeSeparation : tous les devis validés partent → erreur (ce n’est pas une séparation)', () => {
  const r = resumeSeparation({ quotes, appointments, plannedOrder }, { quoteIds: ['q-borne', 'q-pac'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Au moins un devis validé doit rester sur le chantier d’origine.']);
});

test('resumeSeparation : sans jour sélectionné, ok ; la commande reste à l’origine si moveOrder est faux', () => {
  const r = resumeSeparation({ quotes, appointments, plannedOrder }, { quoteIds: ['q-pac'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.nouveau.jours, []);
  assert.deepEqual(r.origine.commande, plannedOrder);
  assert.equal(r.nouveau.commande, null);
});

test('resumeSeparation : commande non renseignée → null des deux côtés', () => {
  const r = resumeSeparation({ quotes, appointments, plannedOrder: { teamSize: null, days: null } }, { quoteIds: ['q-pac'], moveOrder: true });
  assert.equal(r.origine.commande, null);
  assert.equal(r.nouveau.commande, null);
});

test('resumeSeparation : ne mute pas les entrées', () => {
  const copie = JSON.stringify({ quotes, appointments });
  resumeSeparation({ quotes, appointments, plannedOrder }, { quoteIds: ['q-pac'], appointmentIds: ['a-03'] });
  assert.equal(JSON.stringify({ quotes, appointments }), copie);
});

test('commandeSuitParDefaut : vrai quand les jours sélectionnés égalent la commande', () => {
  assert.equal(commandeSuitParDefaut({ teamSize: 2, days: 3 }, 3), true);
  assert.equal(commandeSuitParDefaut({ teamSize: 2, days: 3 }, 1), false);
  assert.equal(commandeSuitParDefaut({ teamSize: 2, days: 3 }, 0), false);
  assert.equal(commandeSuitParDefaut({ teamSize: null, days: null }, 3), false);
  assert.equal(commandeSuitParDefaut(null, 3), false);
});
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue**

Run: `node --test scripts/chantier-split.test.mjs`
Expected: échec `Cannot find module '.../src/lib/chantierSplit.js'`.

- [ ] **Step 3 : écrire le module**

```js
// src/lib/chantierSplit.js
/**
 * chantierSplit.js — séparation d'un chantier en deux cartes.
 * ============================================================================
 * Module PUR (aucun import React / Supabase) : testé par `scripts/chantier-split.test.mjs`
 * (inclus dans `audit:quality`).
 *
 * Une carte chantier qui porte plusieurs devis validés peut être séparée : les
 * devis et les jours d'installation cochés partent sur un NOUVEAU lead du même
 * client (RPC `lead_split`). Ce module calcule ce que chaque côté garde et les
 * erreurs qui interdisent la séparation — mêmes règles que la RPC.
 *
 * Spec : docs/superpowers/specs/2026-09-30-chantier-separation-devis-design.md
 * ============================================================================
 */

/** Montant d'une liste de devis : validés uniquement (même définition que la carte). */
function montantValide(devis) {
  return devis
    .filter((q) => q?.is_validated)
    .reduce((somme, q) => somme + (Number(q.quote_amount_ht) || 0), 0);
}

/** Commande « personnes × jours » telle que portée par la carte, ou null si vide. */
function commandeOuNull(plannedOrder) {
  const teamSize = Number(plannedOrder?.teamSize) || null;
  const days = Number(plannedOrder?.days) || null;
  return teamSize || days ? plannedOrder : null;
}

/**
 * Résumé de la séparation : ce que chaque côté garde, et les erreurs bloquantes.
 * @param {{quotes: Array<{id: string, is_validated: boolean, quote_amount_ht: number|string}>,
 *          appointments: Array<{id: string}>,
 *          plannedOrder?: {teamSize?: number|null, days?: number|null}|null}} donnees
 * @param {{quoteIds?: string[], appointmentIds?: string[], moveOrder?: boolean}} selection
 * @returns {{ok: boolean, erreurs: string[],
 *   origine: {devis: Array, montant: number, jours: Array, commande: object|null},
 *   nouveau: {devis: Array, montant: number, jours: Array, commande: object|null}}}
 */
export function resumeSeparation(donnees, selection = {}) {
  const quotes = Array.isArray(donnees?.quotes) ? donnees.quotes : [];
  const appointments = Array.isArray(donnees?.appointments) ? donnees.appointments : [];
  const devisChoisis = new Set(selection.quoteIds || []);
  const joursChoisis = new Set(selection.appointmentIds || []);
  const moveOrder = selection.moveOrder === true;

  const nouveauDevis = quotes.filter((q) => devisChoisis.has(q.id));
  const origineDevis = quotes.filter((q) => !devisChoisis.has(q.id));
  const nouveauJours = appointments.filter((a) => joursChoisis.has(a.id));
  const origineJours = appointments.filter((a) => !joursChoisis.has(a.id));

  const erreurs = [];
  if (nouveauDevis.length === 0) {
    erreurs.push('Sélectionnez au moins un devis.');
  } else if (!nouveauDevis.some((q) => q.is_validated)) {
    erreurs.push('Le nouveau chantier doit emporter au moins un devis validé.');
  }
  if (!origineDevis.some((q) => q.is_validated)) {
    erreurs.push('Au moins un devis validé doit rester sur le chantier d’origine.');
  }

  const commande = commandeOuNull(donnees?.plannedOrder);
  return {
    ok: erreurs.length === 0,
    erreurs,
    origine: { devis: origineDevis, montant: montantValide(origineDevis), jours: origineJours, commande: moveOrder ? null : commande },
    nouveau: { devis: nouveauDevis, montant: montantValide(nouveauDevis), jours: nouveauJours, commande: moveOrder ? commande : null },
  };
}

/**
 * La commande suit-elle le nouveau chantier par défaut ? Oui quand le nombre de
 * jours cochés est exactement celui de la commande (cas GOUIN : 3 jours de
 * novembre = la commande 2 × 3). L'utilisateur peut toujours décocher.
 * @param {{teamSize?: number|null, days?: number|null}|null} plannedOrder
 * @param {number} nbJoursSelectionnes
 * @returns {boolean}
 */
export function commandeSuitParDefaut(plannedOrder, nbJoursSelectionnes) {
  const days = Number(plannedOrder?.days) || null;
  return days != null && nbJoursSelectionnes > 0 && nbJoursSelectionnes === days;
}
```

- [ ] **Step 4 : lancer le test, vérifier qu'il passe**

Run: `node --test scripts/chantier-split.test.mjs`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5 : inscrire le test dans `audit:quality`**

Dans `package.json`, ligne 13, insérer `scripts/chantier-split.test.mjs` juste après `scripts/install-order.test.mjs` dans la liste `node --test …`. Vérifier : `npm run audit:quality` → `# fail 0` et aucun fichier mort signalé.

- [ ] **Step 6 : commit**

```bash
git add src/lib/chantierSplit.js scripts/chantier-split.test.mjs package.json
git commit -m "feat(chantiers): module pur de séparation d'un chantier (résumé + règles)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : migration `20260930_11_lead_split.sql`

**Files:**
- Create: `supabase/migrations/20260930_11_lead_split.sql`

**Interfaces:**
- Produces : colonnes `lead_pennylane_quotes.scope_confirmed_at timestamptz`, `scope_confirmed_by uuid` ; `majordhome.lead_quote_stats.unconfirmed_validated_count bigint` (dernière colonne) ; `public.majordhome_chantiers.quotes_to_arbitrate bigint` (dernière colonne) ; `public.majordhome_lead_pennylane_quotes.quote_subject text`, `.scope_confirmed_at timestamptz` (deux dernières colonnes) ; RPC `public.lead_quotes_confirm_scope(p_lead_id uuid) RETURNS jsonb {confirmed}` ; RPC `public.lead_split(p_lead_id uuid, p_quote_ids uuid[], p_appointment_ids uuid[] DEFAULT '{}', p_move_planned_order boolean DEFAULT false, p_equipment_type_id uuid DEFAULT NULL) RETURNS jsonb {new_lead_id, origin_lead_id, counts:{quotes, appointments, line_receptions}}`.
- Codes d'erreur (lus par le front, tâche 5) : `unauthenticated`/`role_required`/`cross_org` → `42501` ; `lead_not_found`/`lead_deleted` → `P0002` ; `invalid_selection`/`not_a_chantier`/`quote_not_on_lead`/`no_validated_quote_selected`/`no_validated_quote_remaining`/`appointment_not_on_lead`/`equipment_type_not_in_org` → `22023`.

- [ ] **Step 1 : écrire la migration**

```sql
-- supabase/migrations/20260930_11_lead_split.sql
-- ============================================================================
-- Séparation d'un chantier en chantiers distincts (Eric, 2026-09-30).
-- 1 lead = 1 chantier reste vrai : séparer = créer un second lead pour le même
-- client et y déplacer devis + jours d'installation (inverse de lead_merge).
-- La question « même chantier ou chantiers distincts ? » est mémorisée par
-- lead_pennylane_quotes.scope_confirmed_at, exposée par lead_quote_stats →
-- majordhome_chantiers.quotes_to_arbitrate.
-- Spec : docs/superpowers/specs/2026-09-30-chantier-separation-devis-design.md
-- Vues : colonnes ajoutées EN FIN de liste (CREATE OR REPLACE n'accepte rien
-- d'autre) ; définitions recopiées de 20260922_1 / 20260820_1.
-- ============================================================================

-- ── 1. Colonnes ────────────────────────────────────────────────────────────
ALTER TABLE majordhome.lead_pennylane_quotes
  ADD COLUMN IF NOT EXISTS scope_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS scope_confirmed_by uuid;

COMMENT ON COLUMN majordhome.lead_pennylane_quotes.scope_confirmed_at IS
  'Question « même chantier ou chantier distinct ? » tranchée pour ce devis (NULL = pas encore). 2026-09-30.';

-- ── 2. Stats devis par lead : + devis validés non tranchés ─────────────────
CREATE OR REPLACE VIEW majordhome.lead_quote_stats
WITH (security_invoker = true) AS
SELECT
  lpq.lead_id,
  lpq.org_id,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'pending')   AS pending_count,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'validated') AS accepted_count,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'refused')   AS refused_count,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'pending')   AS pending_sum,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'validated') AS accepted_sum,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'refused')   AS refused_sum,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'validated'
                     AND lpq.scope_confirmed_at IS NULL) AS unconfirmed_validated_count
FROM majordhome.lead_pennylane_quotes lpq
WHERE lpq.ejected_at IS NULL
GROUP BY lpq.lead_id, lpq.org_id;

GRANT SELECT ON majordhome.lead_quote_stats TO authenticated, service_role;

-- ── 3. Vue chantiers : + quotes_to_arbitrate ───────────────────────────────
CREATE OR REPLACE VIEW public.majordhome_chantiers WITH (security_invoker = true) AS
SELECT l.id,
    l.org_id,
    l.first_name,
    l.last_name,
    l.company_name,
    l.email,
    l.phone,
    l.address,
    l.postal_code,
    l.city,
    l.order_amount_ht,
    l.estimated_revenue,
    l.chantier_status,
    l.equipment_order_status,
    l.materials_order_status,
    l.estimated_date,
    l.planification_date,
    l.chantier_notes,
    l.won_date,
    l.client_id,
    l.project_id,
    l.assigned_user_id,
    l.equipment_type_id,
    l.pv_reception_path,
    l.updated_at,
    l.created_at,
    pet.label AS equipment_type_label,
    pet.category AS equipment_type_category,
    i.id AS intervention_id,
    i.status AS intervention_status,
    l.pennylane_quote_id,
    COALESCE(( SELECT lqs.accepted_sum
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0::numeric) AS linked_quotes_amount_ht,
    rdv.next_rdv_date,
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv,
    COALESCE(( SELECT lqs.accepted_count
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0::bigint) AS validated_quotes_count,
    l.planned_team_size,
    l.planned_days,
    -- Devis validés dont la question « même chantier ? » n'est pas tranchée,
    -- seulement quand il y a de quoi trancher (≥ 2 devis validés).
    COALESCE(( SELECT CASE WHEN lqs.accepted_count >= 2 THEN lqs.unconfirmed_validated_count ELSE 0 END
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0::bigint) AS quotes_to_arbitrate
   FROM majordhome.leads l
     LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = l.equipment_type_id
     LEFT JOIN majordhome.interventions i ON i.lead_id = l.id AND i.parent_id IS NULL
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.lead_id = l.id AND a.appointment_type = 'installation'::text AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE l.chantier_status IS NOT NULL AND l.is_deleted = false;

-- ── 4. Vue des devis rattachés : + objet du devis (miroir) + tranché ───────
CREATE OR REPLACE VIEW public.majordhome_lead_pennylane_quotes
WITH (security_invoker = true) AS
SELECT
  lpq.id,
  lpq.org_id,
  lpq.lead_id,
  lpq.pennylane_quote_id,
  lpq.pennylane_customer_id,
  lpq.pennylane_client_id,
  lpq.quote_amount_ht,
  lpq.quote_label,
  lpq.quote_date,
  lpq.quote_status,
  COALESCE(pq.pdf_url, lpq.pdf_url) AS pdf_url,
  lpq.assigned_at,
  lpq.ejected_at,
  lpq.ejected_reason,
  lpq.created_at,
  lpq.is_winning_quote,
  l.last_name AS lead_last_name,
  l.first_name AS lead_first_name,
  l.status_id AS lead_status_id,
  l.client_id,
  c.client_number,
  c.last_name AS client_last_name,
  c.first_name AS client_first_name,
  c.pennylane_account_number AS client_pl_number,
  majordhome.quote_status_bucket(lpq.quote_status) = 'validated' AS is_validated,
  pq.pdf_invoice_subject AS quote_subject,
  lpq.scope_confirmed_at
FROM majordhome.lead_pennylane_quotes lpq
JOIN majordhome.leads l ON l.id = lpq.lead_id
LEFT JOIN majordhome.clients c ON c.id = l.client_id
LEFT JOIN majordhome.pennylane_quotes pq
  ON pq.org_id = lpq.org_id
 AND pq.pennylane_quote_id = lpq.pennylane_quote_id;

-- ── 5. RPC : « Même chantier » ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_quotes_confirm_scope(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
  v_n int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org FROM majordhome.leads
   WHERE id = p_lead_id AND COALESCE(is_deleted, false) = false;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Garde POSITIVE (jamais « IF NOT … » : NULL ouvrirait la porte)
  IF (EXISTS (SELECT 1 FROM core.organization_members om
               WHERE om.org_id = v_org AND om.user_id = v_user)) IS NOT TRUE THEN
    RAISE EXCEPTION 'cross_org' USING ERRCODE = '42501';
  END IF;

  UPDATE majordhome.lead_pennylane_quotes
     SET scope_confirmed_at = now(), scope_confirmed_by = v_user
   WHERE lead_id = p_lead_id
     AND ejected_at IS NULL
     AND scope_confirmed_at IS NULL
     AND majordhome.quote_status_bucket(quote_status) = 'validated';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
    VALUES (p_lead_id, v_user, 'quotes_scope_confirmed',
            v_n || ' devis validé' || CASE WHEN v_n > 1 THEN 's' ELSE '' END || ' confirmé'
              || CASE WHEN v_n > 1 THEN 's' ELSE '' END || ' sur le même chantier',
            jsonb_build_object('confirmed', v_n), v_org);
  END IF;

  RETURN jsonb_build_object('confirmed', v_n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lead_quotes_confirm_scope(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_quotes_confirm_scope(uuid) TO authenticated, service_role;

-- ── 6. RPC : séparer en chantier distinct ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.lead_split(
  p_lead_id uuid,
  p_quote_ids uuid[],
  p_appointment_ids uuid[] DEFAULT '{}'::uuid[],
  p_move_planned_order boolean DEFAULT false,
  p_equipment_type_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_src majordhome.leads%ROWTYPE;
  v_quote_ids uuid[] := ARRAY(SELECT DISTINCT q FROM unnest(COALESCE(p_quote_ids, '{}'::uuid[])) q);
  v_appt_ids  uuid[] := ARRAY(SELECT DISTINCT a FROM unnest(COALESCE(p_appointment_ids, '{}'::uuid[])) a);
  v_moved_pl_ids bigint[];
  v_new_id uuid;
  v_nouveau_status uuid;
  v_n int;
  v_n_receptions int := 0;
  v_win record;   -- devis validé déplacé le plus récent (tie-break pennylane_quote_id DESC)
  v_rest record;  -- devis validé restant le plus récent
  v_counts jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF p_lead_id IS NULL OR cardinality(v_quote_ids) = 0 THEN
    RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_src FROM majordhome.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF COALESCE(v_src.is_deleted, false) THEN RAISE EXCEPTION 'lead_deleted' USING ERRCODE = 'P0002'; END IF;
  IF v_src.chantier_status IS NULL THEN RAISE EXCEPTION 'not_a_chantier' USING ERRCODE = '22023'; END IF;

  -- Garde POSITIVE : admin ou chef d'équipe de l'org du lead
  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_src.org_id AND user_id = v_user LIMIT 1;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'role_required' USING ERRCODE = '42501';
  END IF;

  -- Devis : tous rattachés à ce lead, non éjectés
  SELECT count(*) INTO v_n FROM majordhome.lead_pennylane_quotes q
   WHERE q.id = ANY (v_quote_ids) AND q.lead_id = p_lead_id AND q.ejected_at IS NULL;
  IF v_n <> cardinality(v_quote_ids) THEN
    RAISE EXCEPTION 'quote_not_on_lead' USING ERRCODE = '22023';
  END IF;

  -- Au moins un devis validé part…
  SELECT q.id, q.pennylane_quote_id, q.quote_date, q.quote_amount_ht INTO v_win
    FROM majordhome.lead_pennylane_quotes q
   WHERE q.lead_id = p_lead_id AND q.ejected_at IS NULL AND q.id = ANY (v_quote_ids)
     AND majordhome.quote_status_bucket(q.quote_status) = 'validated'
   ORDER BY q.quote_date DESC NULLS LAST, q.pennylane_quote_id DESC
   LIMIT 1;
  IF v_win.id IS NULL THEN
    RAISE EXCEPTION 'no_validated_quote_selected' USING ERRCODE = '22023';
  END IF;
  -- … et au moins un devis validé reste (sinon ce n'est pas une séparation)
  SELECT q.id, q.pennylane_quote_id, q.quote_amount_ht INTO v_rest
    FROM majordhome.lead_pennylane_quotes q
   WHERE q.lead_id = p_lead_id AND q.ejected_at IS NULL AND NOT (q.id = ANY (v_quote_ids))
     AND majordhome.quote_status_bucket(q.quote_status) = 'validated'
   ORDER BY q.quote_date DESC NULLS LAST, q.pennylane_quote_id DESC
   LIMIT 1;
  IF v_rest.id IS NULL THEN
    RAISE EXCEPTION 'no_validated_quote_remaining' USING ERRCODE = '22023';
  END IF;

  -- Jours d'installation : du lead, actifs
  IF cardinality(v_appt_ids) > 0 THEN
    SELECT count(*) INTO v_n FROM majordhome.appointments a
     WHERE a.id = ANY (v_appt_ids) AND a.lead_id = p_lead_id
       AND a.appointment_type = 'installation'
       AND a.status NOT IN ('cancelled', 'no_show');
    IF v_n <> cardinality(v_appt_ids) THEN
      RAISE EXCEPTION 'appointment_not_on_lead' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Type d'équipement du nouveau chantier : même org
  IF p_equipment_type_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM majordhome.pricing_equipment_types t
        WHERE t.id = p_equipment_type_id AND t.org_id = v_src.org_id) THEN
    RAISE EXCEPTION 'equipment_type_not_in_org' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_nouveau_status FROM majordhome.statuses WHERE display_order = 1 LIMIT 1;

  -- ============== Nouveau lead : identité du client, rien de la commande ==============
  -- Non recopiés : external_* (attribution Meta Ads), notes, compteurs d'appels,
  -- PV de réception, statuts d'appro.
  INSERT INTO majordhome.leads (
    org_id, first_name, last_name, company_name, email, phone, phone_secondary,
    address, address_complement, postal_code, city, latitude, longitude, geocoded_at, zone,
    client_id, project_id, assigned_user_id, source_id, status_id, equipment_type_id,
    created_date, planned_team_size, planned_days
  ) VALUES (
    v_src.org_id, v_src.first_name, v_src.last_name, v_src.company_name, v_src.email, v_src.phone, v_src.phone_secondary,
    v_src.address, v_src.address_complement, v_src.postal_code, v_src.city, v_src.latitude, v_src.longitude, v_src.geocoded_at, v_src.zone,
    v_src.client_id, v_src.project_id, v_src.assigned_user_id, v_src.source_id, v_nouveau_status, p_equipment_type_id,
    CURRENT_DATE,
    CASE WHEN p_move_planned_order THEN v_src.planned_team_size END,
    CASE WHEN p_move_planned_order THEN v_src.planned_days END
  ) RETURNING id INTO v_new_id;

  -- ============== Déplacements ==============
  SELECT array_agg(pennylane_quote_id) INTO v_moved_pl_ids
    FROM majordhome.lead_pennylane_quotes WHERE id = ANY (v_quote_ids);

  UPDATE majordhome.lead_pennylane_quotes SET lead_id = v_new_id WHERE id = ANY (v_quote_ids);
  UPDATE majordhome.lead_quote_revisions  SET lead_id = v_new_id WHERE lead_quote_id = ANY (v_quote_ids);
  UPDATE majordhome.chantier_line_receptions SET chantier_id = v_new_id
   WHERE chantier_id = p_lead_id AND pennylane_quote_id = ANY (v_moved_pl_ids);
  GET DIAGNOSTICS v_n_receptions = ROW_COUNT;
  UPDATE majordhome.appointments SET lead_id = v_new_id WHERE id = ANY (v_appt_ids);

  -- ============== Gain du nouveau lead : seule voie, non dupliquée ==============
  PERFORM public.lead_mark_won_with_quote(v_src.org_id, v_new_id, v_win.pennylane_quote_id);

  UPDATE majordhome.leads SET
    won_date = COALESCE(v_win.quote_date, CURRENT_DATE),
    chantier_status = CASE WHEN cardinality(v_appt_ids) > 0 THEN 'planification' ELSE 'gagne' END,
    planification_date = CASE WHEN cardinality(v_appt_ids) > 0 THEN CURRENT_DATE END,
    order_amount_ht = v_win.quote_amount_ht,
    pennylane_quote_id = v_win.pennylane_quote_id,
    updated_at = now()
  WHERE id = v_new_id;

  -- ============== Origine ==============
  IF v_src.pennylane_quote_id IS NOT NULL AND v_src.pennylane_quote_id = ANY (v_moved_pl_ids) THEN
    UPDATE majordhome.leads
       SET pennylane_quote_id = v_rest.pennylane_quote_id, order_amount_ht = v_rest.quote_amount_ht
     WHERE id = p_lead_id;
  END IF;
  IF p_move_planned_order THEN
    UPDATE majordhome.leads SET planned_team_size = NULL, planned_days = NULL WHERE id = p_lead_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM majordhome.lead_pennylane_quotes
                  WHERE lead_id = p_lead_id AND ejected_at IS NULL AND is_winning_quote = true) THEN
    UPDATE majordhome.lead_pennylane_quotes SET is_winning_quote = true WHERE id = v_rest.id;
  END IF;

  -- La question est tranchée des deux côtés
  UPDATE majordhome.lead_pennylane_quotes
     SET scope_confirmed_at = now(), scope_confirmed_by = v_user
   WHERE lead_id IN (p_lead_id, v_new_id) AND ejected_at IS NULL AND scope_confirmed_at IS NULL
     AND majordhome.quote_status_bucket(quote_status) = 'validated';

  -- ============== Activités sur les deux leads ==============
  v_counts := jsonb_build_object(
    'quotes', cardinality(v_quote_ids),
    'appointments', cardinality(v_appt_ids),
    'line_receptions', v_n_receptions);

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id) VALUES
    (p_lead_id, v_user, 'lead_split',
     'Séparation : ' || cardinality(v_quote_ids) || ' devis et ' || cardinality(v_appt_ids)
       || ' jour(s) d''installation déplacés vers un chantier distinct',
     jsonb_build_object('role', 'origin', 'other_lead_id', v_new_id,
                        'quote_ids', to_jsonb(v_quote_ids), 'appointment_ids', to_jsonb(v_appt_ids), 'counts', v_counts),
     v_src.org_id),
    (v_new_id, v_user, 'lead_split',
     'Chantier distinct créé par séparation (' || cardinality(v_quote_ids) || ' devis, '
       || cardinality(v_appt_ids) || ' jour(s) d''installation)',
     jsonb_build_object('role', 'new', 'other_lead_id', p_lead_id,
                        'quote_ids', to_jsonb(v_quote_ids), 'appointment_ids', to_jsonb(v_appt_ids), 'counts', v_counts),
     v_src.org_id);

  RETURN jsonb_build_object('new_lead_id', v_new_id, 'origin_lead_id', p_lead_id, 'counts', v_counts);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lead_split(uuid, uuid[], uuid[], boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_split(uuid, uuid[], uuid[], boolean, uuid) TO authenticated, service_role;
```

- [ ] **Step 2 : relecture ciblée**

Vérifier à l'œil, ligne par ligne, que : (a) les trois vues recopient exactement les colonnes des migrations `20260922_1` (chantiers) et `20260820_1` (lead_pennylane_quotes) avant les ajouts en fin ; (b) `lead_mark_won_with_quote` est bien appelée **après** le déplacement des devis (elle cherche le devis sur `lead_id = v_new_id`) ; (c) les deux `REVOKE … FROM PUBLIC, anon` sont présents.

- [ ] **Step 3 : commit**

```bash
git add supabase/migrations/20260930_11_lead_split.sql
git commit -m "feat(db): RPC lead_split + lead_quotes_confirm_scope, question « même chantier ? » mémorisée

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : répétition sur le harnais

**Files:**
- Modify: `scripts/migration-rehearsal/snapshot.mjs:26-106` (listes TABLES / FUNCTIONS / TRIGGER_TABLES / VIEWS)
- Modify: `scripts/migration-rehearsal/assert-baseline.sql:19-101` (§1 : fonctions, triggers, vues)
- Create: `scripts/migration-rehearsal/assert-lead-split.sql`

**Interfaces:**
- Consumes : migration de la tâche 2.

- [ ] **Step 1 : étendre le sous-ensemble photographié**

Dans `snapshot.mjs`, `TABLES` :
- remplacer la ligne `clients` par la même liste de colonnes **plus** `'client_number', 'pennylane_account_number'` (la vue `majordhome_lead_pennylane_quotes` les cite) ;
- remplacer la ligne `lead_pennylane_quotes` par `{ schema: 'majordhome', table: 'lead_pennylane_quotes', columns: null, data: false }, // 20260930_11 : lead_split déplace des lignes entières` ;
- ajouter après elle :
```js
  { schema: 'majordhome', table: 'pennylane_quotes', columns: ['org_id', 'pennylane_quote_id', 'quote_number', 'pdf_url', 'pdf_invoice_subject'], data: false }, // 20260930_11 : vue majordhome_lead_pennylane_quotes
  { schema: 'majordhome', table: 'lead_quote_revisions', columns: null, data: false }, // 20260930_11 : re-parentées par lead_split
  { schema: 'majordhome', table: 'chantier_line_receptions', columns: null, data: false }, // 20260930_11 : re-parentées par lead_split
  { schema: 'majordhome', table: 'lead_activities', columns: null, data: false }, // 20260930_11 : activités lead_split / quotes_scope_confirmed
  { schema: 'majordhome', table: 'statuses', columns: null }, // 20260930_11 : lead_split lit « Nouveau », lead_mark_won_with_quote lit « Gagné »
```
`FUNCTIONS` : ajouter
```js
  // 20260930_11 : lead_split appelle lead_mark_won_with_quote ; trigger invariant des devis
  'public.lead_mark_won_with_quote(uuid, uuid, bigint)',
  'majordhome.lead_pennylane_quotes_invariant_winning()',
```
`TRIGGER_TABLES` : ajouter `'majordhome.lead_pennylane_quotes'`.
`VIEWS` : ajouter `'public.majordhome_lead_pennylane_quotes'` en fin de liste (après `majordhome_entretien_sav`).

- [ ] **Step 2 : ré-aligner `assert-baseline.sql` §1**

Dans la liste des fonctions (`VALUES (...)`), ajouter `('public.lead_mark_won_with_quote(uuid, uuid, bigint)'), ('majordhome.lead_pennylane_quotes_invariant_winning()')`. Ajouter, après la boucle des triggers de `contracts`, une boucle identique pour `majordhome.lead_pennylane_quotes` avec `('trg_lead_pennylane_quotes_invariant_winning', 'majordhome.lead_pennylane_quotes_invariant_winning()')`. Dans la liste des vues, ajouter `('public.majordhome_lead_pennylane_quotes', true)`.

- [ ] **Step 3 : photographier la prod et vérifier la baseline**

Run:
```bash
node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local
node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-baseline.sql
```
Expected : `[rehearsal] OK` avec le NOTICE `baseline OK`. Si `schema-generated.sql` échoue sur un objet manquant (ex. une vue qui cite une table absente), **étendre** la liste, ne pas contourner.

- [ ] **Step 4 : écrire les assertions**

```sql
-- scripts/migration-rehearsal/assert-lead-split.sql — vérifie 20260930_11_lead_split.sql.
-- A. structure ; B. fonctionnel sur une fixture GOUIN reconstituée (rollback à la fin).

DO $$
DECLARE n int; v_col text;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'majordhome' AND table_name = 'lead_pennylane_quotes'
     AND column_name IN ('scope_confirmed_at', 'scope_confirmed_by');
  IF n <> 2 THEN RAISE EXCEPTION 'colonnes scope_confirmed_* attendues 2, trouvé %', n; END IF;

  SELECT column_name INTO v_col FROM information_schema.columns
   WHERE table_schema = 'majordhome' AND table_name = 'lead_quote_stats' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_col <> 'unconfirmed_validated_count' THEN RAISE EXCEPTION 'lead_quote_stats : dernière colonne % ≠ unconfirmed_validated_count', v_col; END IF;

  SELECT column_name INTO v_col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_col <> 'quotes_to_arbitrate' THEN RAISE EXCEPTION 'majordhome_chantiers : dernière colonne % ≠ quotes_to_arbitrate', v_col; END IF;

  SELECT column_name INTO v_col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'majordhome_lead_pennylane_quotes' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_col <> 'scope_confirmed_at' THEN RAISE EXCEPTION 'majordhome_lead_pennylane_quotes : dernière colonne % ≠ scope_confirmed_at', v_col; END IF;

  SELECT count(*) INTO n FROM pg_class c
   WHERE c.relname IN ('lead_quote_stats', 'majordhome_chantiers', 'majordhome_lead_pennylane_quotes')
     AND c.relkind = 'v' AND 'security_invoker=true' = ANY (c.reloptions);
  IF n <> 3 THEN RAISE EXCEPTION 'security_invoker attendu sur 3 vues, trouvé %', n; END IF;

  IF has_function_privilege('anon', 'public.lead_split(uuid, uuid[], uuid[], boolean, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lead_split exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.lead_split(uuid, uuid[], uuid[], boolean, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lead_split non exécutable par authenticated'; END IF;
  IF has_function_privilege('anon', 'public.lead_quotes_confirm_scope(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'lead_quotes_confirm_scope exécutable par anon'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.lead_quote_stats', 'SELECT') THEN
    RAISE EXCEPTION 'service_role sans SELECT sur lead_quote_stats'; END IF;

  RAISE NOTICE 'assert-lead-split A (structure) : OK';
END $$;

BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mdh   uuid := '7825fe43-cacb-4feb-b783-6ea3f1ccff77';
  v_chef uuid; v_tech uuid; v_etranger uuid; v_client uuid; v_gagne uuid;
  v_lead uuid; v_q_borne uuid; v_q_pac uuid; v_q_old uuid;
  v_a18 uuid; v_a03 uuid; v_a04 uuid; v_a05 uuid;
  v_res jsonb; v_new uuid; v_row record; ok boolean;
BEGIN
  SELECT om.user_id INTO v_chef FROM core.organization_members om
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin', 'team_leader') LIMIT 1;
  IF v_chef IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer'; END IF;
  SELECT om.user_id INTO v_tech FROM core.organization_members om
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role NOT IN ('org_admin', 'team_leader') LIMIT 1;
  IF v_tech IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre Mayer non chef'; END IF;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om
   WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
     AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre d''une autre org'; END IF;
  SELECT id INTO v_client FROM majordhome.clients WHERE org_id = v_mayer LIMIT 1;
  SELECT id INTO v_gagne FROM majordhome.statuses WHERE display_order = 5;

  -- Fixture GOUIN : 1 lead, 3 devis (borne facturée gagnante, PAC acceptée, PAC expirée), 4 jours
  INSERT INTO majordhome.leads (org_id, first_name, last_name, city, postal_code, client_id, status_id,
                                won_date, chantier_status, planned_team_size, planned_days,
                                equipment_order_status, materials_order_status, pennylane_quote_id, order_amount_ht)
  VALUES (v_mayer, 'BATISTE', 'GOUIN', 'Castelnau-de-Lévis', '81150', v_client, v_gagne,
          '2026-09-03', 'planification', 2, 3, 'recu', 'recu', 1001, 1260.76)
  RETURNING id INTO v_lead;
  INSERT INTO majordhome.lead_pennylane_quotes (org_id, lead_id, pennylane_quote_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote)
  VALUES (v_mayer, v_lead, 1001, 1260.76, 'D-2026-09430', '2026-09-03', 'invoiced', true) RETURNING id INTO v_q_borne;
  INSERT INTO majordhome.lead_pennylane_quotes (org_id, lead_id, pennylane_quote_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote)
  VALUES (v_mayer, v_lead, 1002, 11540, 'D-2026-09466', '2026-09-30', 'accepted', false) RETURNING id INTO v_q_pac;
  INSERT INTO majordhome.lead_pennylane_quotes (org_id, lead_id, pennylane_quote_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote)
  VALUES (v_mayer, v_lead, 1003, 10240.34, 'D-2026-09483', '2026-09-24', 'expired', false) RETURNING id INTO v_q_old;
  INSERT INTO majordhome.appointments (org_id, lead_id, scheduled_date, scheduled_start, scheduled_end, appointment_type, status, subject)
  VALUES (v_mdh, v_lead, '2026-09-18', '08:00', '13:30', 'installation', 'scheduled', 'Installation - GOUIN') RETURNING id INTO v_a18;
  INSERT INTO majordhome.appointments (org_id, lead_id, scheduled_date, scheduled_start, scheduled_end, appointment_type, status, subject)
  VALUES (v_mdh, v_lead, '2026-11-03', '08:00', '17:00', 'installation', 'scheduled', 'Installation - GOUIN') RETURNING id INTO v_a03;
  INSERT INTO majordhome.appointments (org_id, lead_id, scheduled_date, scheduled_start, scheduled_end, appointment_type, status, subject)
  VALUES (v_mdh, v_lead, '2026-11-04', '08:00', '17:00', 'installation', 'scheduled', 'Installation - GOUIN') RETURNING id INTO v_a04;
  INSERT INTO majordhome.appointments (org_id, lead_id, scheduled_date, scheduled_start, scheduled_end, appointment_type, status, subject)
  VALUES (v_mdh, v_lead, '2026-11-05', '08:00', '17:00', 'installation', 'scheduled', 'Installation - GOUIN') RETURNING id INTO v_a05;

  -- (0) Avant : la carte a 2 devis validés non tranchés
  SELECT quotes_to_arbitrate, validated_quotes_count INTO v_row FROM public.majordhome_chantiers WHERE id = v_lead;
  IF v_row.quotes_to_arbitrate <> 2 OR v_row.validated_quotes_count <> 2 THEN
    RAISE EXCEPTION '(0) quotes_to_arbitrate=% validated=%', v_row.quotes_to_arbitrate, v_row.validated_quotes_count; END IF;

  -- (1) Refus : technicien
  PERFORM set_config('request.jwt.claim.sub', v_tech::text, false);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.lead_split(v_lead, ARRAY[v_q_pac], ARRAY[v_a03], true, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(1) un technicien a pu séparer'; END IF;
  RESET ROLE;

  -- (2) Refus : membre d'une autre org
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.lead_split(v_lead, ARRAY[v_q_pac], '{}', false, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(2) cross-org accepté'; END IF;
  ok := false;
  BEGIN PERFORM public.lead_quotes_confirm_scope(v_lead);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(2b) confirm_scope cross-org accepté'; END IF;
  RESET ROLE;

  -- (3) Refus : sélections invalides (chef d'équipe / admin)
  PERFORM set_config('request.jwt.claim.sub', v_chef::text, false);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN PERFORM public.lead_split(v_lead, ARRAY[v_q_old], '{}', false, NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3a) séparation sans devis validé acceptée'; END IF;
  ok := false;
  BEGIN PERFORM public.lead_split(v_lead, ARRAY[v_q_borne, v_q_pac], '{}', false, NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3b) origine vidée de ses devis validés acceptée'; END IF;
  ok := false;
  BEGIN PERFORM public.lead_split(v_lead, ARRAY[v_q_pac], ARRAY[gen_random_uuid()], false, NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3c) RDV étranger accepté'; END IF;

  -- (4) Séparation GOUIN : PAC + variante expirée + 3 jours de novembre, commande suit
  v_res := public.lead_split(v_lead, ARRAY[v_q_pac, v_q_old], ARRAY[v_a03, v_a04, v_a05], true, NULL);
  v_new := (v_res->>'new_lead_id')::uuid;
  IF v_new IS NULL OR (v_res->'counts'->>'quotes')::int <> 2 OR (v_res->'counts'->>'appointments')::int <> 3 THEN
    RAISE EXCEPTION '(4) retour inattendu : %', v_res; END IF;

  SELECT linked_quotes_amount_ht, validated_quotes_count, chantier_status, planned_team_size, planned_days,
         quotes_to_arbitrate, pennylane_quote_id, order_amount_ht, equipment_order_status
    INTO v_row FROM public.majordhome_chantiers WHERE id = v_lead;
  IF v_row.linked_quotes_amount_ht <> 1260.76 OR v_row.validated_quotes_count <> 1 OR v_row.chantier_status <> 'planification'
     OR v_row.planned_team_size IS NOT NULL OR v_row.planned_days IS NOT NULL OR v_row.quotes_to_arbitrate <> 0
     OR v_row.pennylane_quote_id <> 1001 OR v_row.order_amount_ht <> 1260.76 OR v_row.equipment_order_status <> 'recu' THEN
    RAISE EXCEPTION '(4) origine : %', to_jsonb(v_row); END IF;

  SELECT linked_quotes_amount_ht, validated_quotes_count, chantier_status, planned_team_size, planned_days,
         quotes_to_arbitrate, pennylane_quote_id, order_amount_ht, won_date, client_id, last_name, planification_date
    INTO v_row FROM public.majordhome_chantiers WHERE id = v_new;
  IF v_row.linked_quotes_amount_ht <> 11540 OR v_row.validated_quotes_count <> 1 OR v_row.chantier_status <> 'planification'
     OR v_row.planned_team_size <> 2 OR v_row.planned_days <> 3 OR v_row.quotes_to_arbitrate <> 0
     OR v_row.pennylane_quote_id <> 1002 OR v_row.order_amount_ht <> 11540 OR v_row.won_date <> '2026-09-30'
     OR v_row.client_id <> v_client OR v_row.last_name <> 'GOUIN'
     OR v_row.planification_date <> CURRENT_DATE THEN
    RAISE EXCEPTION '(4) nouveau : %', to_jsonb(v_row); END IF;

  SELECT status_id INTO v_row FROM majordhome.leads WHERE id = v_new;
  IF v_row.status_id <> v_gagne THEN RAISE EXCEPTION '(4) nouveau lead non Gagné'; END IF;

  -- Une requête par compte : un record avec deux count() porterait deux champs « count », ambigus.
  SELECT count(*) INTO v_row FROM majordhome.appointments WHERE lead_id = v_new AND id IN (v_a03, v_a04, v_a05);
  IF v_row.count <> 3 THEN RAISE EXCEPTION '(4) RDV déplacés : % au nouveau (attendu 3)', v_row.count; END IF;
  SELECT count(*) INTO v_row FROM majordhome.appointments WHERE lead_id = v_lead AND id = v_a18;
  IF v_row.count <> 1 THEN RAISE EXCEPTION '(4) le 18/09 a quitté l''origine'; END IF;

  SELECT bool_and(is_winning_quote) INTO v_row FROM majordhome.lead_pennylane_quotes WHERE id = v_q_pac;
  IF NOT v_row.bool_and THEN RAISE EXCEPTION '(4) la PAC n''est pas gagnante sur le nouveau lead'; END IF;
  SELECT bool_and(is_winning_quote) INTO v_row FROM majordhome.lead_pennylane_quotes WHERE id = v_q_borne;
  IF NOT v_row.bool_and THEN RAISE EXCEPTION '(4) la borne a perdu son flag gagnant'; END IF;
  SELECT count(*) INTO v_row FROM majordhome.lead_pennylane_quotes
   WHERE id IN (v_q_borne, v_q_pac) AND scope_confirmed_at IS NOT NULL AND scope_confirmed_by = v_chef;
  IF v_row.count <> 2 THEN RAISE EXCEPTION '(4) scope_confirmed_at non posé des deux côtés (%)', v_row.count; END IF;
  SELECT count(*) INTO v_row FROM majordhome.lead_activities WHERE lead_id IN (v_lead, v_new) AND activity_type = 'lead_split';
  IF v_row.count <> 2 THEN RAISE EXCEPTION '(4) activités lead_split : % (attendu 2)', v_row.count; END IF;

  -- (5) « Même chantier » sur une carte à 2 devis validés
  INSERT INTO majordhome.lead_pennylane_quotes (org_id, lead_id, pennylane_quote_id, quote_amount_ht, quote_label, quote_date, quote_status)
  VALUES (v_mayer, v_new, 1004, 640.40, 'D-2026-09499', '2026-10-01', 'accepted');
  SELECT quotes_to_arbitrate INTO v_row FROM public.majordhome_chantiers WHERE id = v_new;
  IF v_row.quotes_to_arbitrate <> 1 THEN RAISE EXCEPTION '(5) nouveau devis : quotes_to_arbitrate=% (attendu 1)', v_row.quotes_to_arbitrate; END IF;
  v_res := public.lead_quotes_confirm_scope(v_new);
  IF (v_res->>'confirmed')::int <> 1 THEN RAISE EXCEPTION '(5) confirmed=% (attendu 1)', v_res->>'confirmed'; END IF;
  SELECT quotes_to_arbitrate INTO v_row FROM public.majordhome_chantiers WHERE id = v_new;
  IF v_row.quotes_to_arbitrate <> 0 THEN RAISE EXCEPTION '(5) après confirmation : quotes_to_arbitrate=%', v_row.quotes_to_arbitrate; END IF;
  v_res := public.lead_quotes_confirm_scope(v_new);
  IF (v_res->>'confirmed')::int <> 0 THEN RAISE EXCEPTION '(5) seconde confirmation non idempotente'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-lead-split B (fonctionnel) : OK';
END $$;
ROLLBACK;
```

- [ ] **Step 5 : répéter la migration**

Run:
```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260930_11_lead_split.sql --assert scripts/migration-rehearsal/assert-lead-split.sql
```
Expected : les deux NOTICE `assert-lead-split A … OK` / `B … OK` puis `[rehearsal] OK`. En cas d'échec : corriger la migration (ou la fixture si c'est elle qui est fausse, par exemple une colonne NOT NULL d'`appointments` oubliée), relancer jusqu'au vert. Ne jamais affaiblir une assertion pour passer.

- [ ] **Step 6 : commit**

```bash
git add scripts/migration-rehearsal/snapshot.mjs scripts/migration-rehearsal/assert-baseline.sql scripts/migration-rehearsal/assert-lead-split.sql
git commit -m "test(rehearsal): répétition de lead_split (fixture GOUIN, refus, même chantier)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : application en prod (checkpoint Eric)

**Files:** aucun.

- [ ] **Step 1 : demander l'accord**

Message à Eric : « Migration `20260930_11_lead_split.sql` répétée sur le harnais (assertions A/B vertes). J'applique en prod ? » — **attendre un oui explicite**.

- [ ] **Step 2 : appliquer**

MCP Supabase `apply_migration` (projet `ejqqqwudmizqisdkxohw`, nom `20260930_11_lead_split`, contenu du fichier).

- [ ] **Step 3 : auditer l'effet réel (jamais en relisant le texte)**

MCP `execute_sql` :
```sql
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('lead_split', 'lead_quotes_confirm_scope');
SELECT id, last_name, quotes_to_arbitrate FROM public.majordhome_chantiers WHERE quotes_to_arbitrate > 0 ORDER BY last_name;
```
Expected : `anon_exec = false`, `auth_exec = true` pour les deux ; **12 cartes** avec `quotes_to_arbitrate > 0` (BERNA, BESOMBES, CAPPAROS, CHENE, COTTERAU, DELMAS, FRENCH COUNTRY, GOUIN, LITCHMAN, OBIERTI, VEOLIA ENERGIE FRANCE, VEOLIA ENVIRONNEMENT). Tout écart se rapporte à Eric avant de continuer.

---

### Task 5 : service et hooks

**Files:**
- Modify: `src/shared/services/chantiers.service.js:105-120` (remplacer `getChantierByClientId`) et fin de l'objet (nouvelles méthodes)
- Modify: `src/shared/hooks/useChantiers.js`
- Modify: `src/shared/services/pennylane.service.js:1202` (select de `getLinkedQuotesByLead`)
- Modify: `src/shared/services/leads.service.js:64-75` (`ACTIVITY_CONFIG`)
- Modify: `src/apps/artisan/components/pipeline/LeadActivityTimeline.jsx:37-47` (`ICON_MAP`)

**Interfaces:**
- Produces : `chantiersService.getChantiersByClientId(clientId) → { data: Array, error }`, `chantiersService.confirmQuotesScope(leadId) → { data: {confirmed}, error }`, `chantiersService.splitChantier(leadId, { quoteIds, appointmentIds, moveOrder, equipmentTypeId }) → { data: {new_lead_id, origin_lead_id, counts}, error }` ; hook `useChantierMutations()` expose en plus `splitChantier(leadId, options)`, `confirmQuotesScope(leadId)`, `isSplitting`, `isConfirmingScope` (mutateAsync : résout avec `data`, rejette sur erreur).
- Les lignes de `useLinkedPennylaneQuotes` portent en plus `quote_subject` et `scope_confirmed_at`.

- [ ] **Step 1 : service chantiers**

Remplacer `getChantierByClientId` (lignes 105-120) par :

```js
  /**
   * Chantiers liés à un client (via lead.client_id), le plus récent d'abord.
   * Un client peut en porter plusieurs (séparation, spec 2026-09-30) : liste, pas `.limit(1)`.
   */
  async getChantiersByClientId(clientId) {
    if (!clientId) return { data: [], error: null };
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_chantiers')
        .select('*')
        .eq('client_id', clientId)
        .order('won_date', { ascending: false });
      if (error) throw error;
      return data || [];
    }, 'chantiers.getChantiersByClientId');
  },
```

Ajouter avant la section `PV DE RÉCEPTION` :

```js
  // ==========================================================================
  // SÉPARATION (spec 2026-09-30)
  // ==========================================================================

  /**
   * « Même chantier » : tranche la question pour les devis validés non encore
   * tranchés du lead. RPC membership-checked. Retourne { confirmed }.
   */
  async confirmQuotesScope(leadId) {
    if (!leadId) throw new Error('[chantiers] leadId requis');
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('lead_quotes_confirm_scope', { p_lead_id: leadId });
      if (error) throw error;
      return data;
    }, 'chantiers.confirmQuotesScope');
  },

  /**
   * Sépare le chantier : les devis (ids `lead_pennylane_quotes`) et les jours
   * d'installation (ids `appointments`) cochés partent sur un nouveau lead du
   * même client (RPC lead_split, org_admin / team_leader).
   * Retourne { new_lead_id, origin_lead_id, counts: { quotes, appointments, line_receptions } }.
   */
  async splitChantier(leadId, { quoteIds, appointmentIds = [], moveOrder = false, equipmentTypeId = null }) {
    if (!leadId) throw new Error('[chantiers] leadId requis');
    if (!Array.isArray(quoteIds) || quoteIds.length === 0) throw new Error('[chantiers] quoteIds requis');
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('lead_split', {
        p_lead_id: leadId,
        p_quote_ids: quoteIds,
        p_appointment_ids: appointmentIds,
        p_move_planned_order: moveOrder === true,
        p_equipment_type_id: equipmentTypeId || null,
      });
      if (error) throw error;
      return data;
    }, 'chantiers.splitChantier');
  },
```

- [ ] **Step 2 : hook**

Dans `useChantiers.js`, remplacer l'import des keys par :
```js
import { chantierKeys, leadKeys, kanbanCardKeys, appointmentKeys, pennylaneKeys } from '@hooks/cacheKeys';
```
Ajouter dans `useChantierMutations`, après `pvMutation` :
```js
  // Séparation / « même chantier » (spec 2026-09-30) : la RPC touche leads,
  // devis rattachés, RDV et cartes du pipeline → invalidation croisée.
  const invalidateSplit = useCallback(() => {
    invalidateChantiers();
    queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
  }, [queryClient, orgId, invalidateChantiers]);

  const splitMutation = useMutation({
    mutationFn: ({ leadId, ...options }) => unwrapResult(chantiersService.splitChantier(leadId, options)),
    onSuccess: invalidateSplit,
  });

  const confirmScopeMutation = useMutation({
    mutationFn: ({ leadId }) => unwrapResult(chantiersService.confirmQuotesScope(leadId)),
    onSuccess: invalidateSplit,
  });
```
et dans l'objet retourné :
```js
    splitChantier: useCallback(
      (leadId, options) => splitMutation.mutateAsync({ leadId, ...options }),
      [splitMutation]
    ),
    confirmQuotesScope: useCallback(
      (leadId) => confirmScopeMutation.mutateAsync({ leadId }),
      [confirmScopeMutation]
    ),
    isSplitting: splitMutation.isPending,
    isConfirmingScope: confirmScopeMutation.isPending,
```

- [ ] **Step 3 : select des devis rattachés**

`pennylane.service.js:1202` — ajouter `, quote_subject, scope_confirmed_at` en fin de la chaîne `.select('id, lead_id, … pdf_url')`.

- [ ] **Step 4 : activités de la timeline**

`leads.service.js` `ACTIVITY_CONFIG` — ajouter :
```js
  lead_split: { icon: 'GitBranch', color: 'bg-amber-100 text-amber-700' },
  quotes_scope_confirmed: { icon: 'CheckCircle', color: 'bg-emerald-100 text-emerald-700' },
```
`LeadActivityTimeline.jsx` — importer `GitBranch` depuis `lucide-react` (dans l'import existant) et l'ajouter à `ICON_MAP`.

- [ ] **Step 5 : vérifier**

Run: `npm run lint:errors` puis `npx vite build`
Expected : 0 erreur, build OK. `grep -rn "getChantierByClientId" src` ne doit plus rien remonter sauf `TabInterventions.jsx:152` (corrigé en tâche 7).

- [ ] **Step 6 : commit**

```bash
git add src/shared/services/chantiers.service.js src/shared/hooks/useChantiers.js src/shared/services/pennylane.service.js src/shared/services/leads.service.js src/apps/artisan/components/pipeline/LeadActivityTimeline.jsx
git commit -m "feat(chantiers): service + hook de séparation et de confirmation « même chantier »

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : dialogue de séparation et fiche chantier

**Files:**
- Create: `src/apps/artisan/components/chantiers/SplitChantierDialog.jsx`
- Modify: `src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx`
- Modify: `src/apps/artisan/components/chantiers/ChantierModal.jsx:382-389` (props passées à la section)

**Interfaces:**
- Consumes : `resumeSeparation`, `commandeSuitParDefaut` (tâche 1) ; `useChantierMutations().splitChantier / confirmQuotesScope` (tâche 5) ; lignes de `useLinkedPennylaneQuotes` avec `id`, `is_validated`, `quote_amount_ht`, `quote_number_pl`, `quote_label`, `quote_status`, `quote_subject` ; RDV de `useChantierAppointments` avec `id`, `scheduled_date`, `scheduled_start`, `scheduled_end`, `technician_ids`, `technician_names`.
- Produces : `<SplitChantierDialog open onOpenChange chantier quotes appointments plannedOrder onSplit />` ; `ChantierReceptionSection` accepte deux props de plus : `installAppointments` (Array) et `plannedOrder` ({teamSize, days}).

- [ ] **Step 1 : le dialogue**

```jsx
/**
 * SplitChantierDialog.jsx — « Séparer en chantier distinct »
 * ============================================================================
 * Une carte chantier qui porte plusieurs devis validés peut être séparée : on
 * coche les devis et les jours d'installation qui partent, l'app crée une
 * seconde carte pour le même client (RPC lead_split). Retour arrière = bouton
 * « Fusionner » de la fiche lead. Les règles (au moins un devis validé de chaque
 * côté) vivent dans le module pur src/lib/chantierSplit.js.
 * Spec : docs/superpowers/specs/2026-09-30-chantier-separation-devis-design.md
 * ============================================================================
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { GitBranch } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useChantierMutations } from '@hooks/useChantiers';
import { usePricingData } from '@hooks/usePricing';
import { resumeSeparation, commandeSuitParDefaut } from '@/lib/chantierSplit';
import { libelleCommande } from '@/lib/installOrder';
import { formatEuro } from '@/lib/utils';

const PL_STATUS_LABELS = {
  pending: 'En attente',
  draft: 'Brouillon',
  expired: 'Expiré',
  refused: 'Refusé',
  denied: 'Refusé',
  canceled: 'Annulé',
};

const RPC_ERRORS = {
  role_required: 'Action réservée aux administrateurs et chefs d’équipe',
  no_validated_quote_selected: 'Le nouveau chantier doit emporter au moins un devis validé',
  no_validated_quote_remaining: 'Au moins un devis validé doit rester sur le chantier d’origine',
  quote_not_on_lead: 'Un devis coché n’est plus rattaché à ce chantier — rafraîchis la page',
  appointment_not_on_lead: 'Un jour coché n’est plus sur ce chantier — rafraîchis la page',
  lead_deleted: 'Ce chantier est supprimé',
};

function messageErreur(err) {
  const msg = err?.message || '';
  const code = Object.keys(RPC_ERRORS).find((k) => msg.includes(k));
  return code ? RPC_ERRORS[code] : 'Séparation impossible';
}

function dateCourte(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Colonne({ titre, cote }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
      <p className="font-semibold text-gray-900">{titre}</p>
      <p>{formatEuro(cote.montant)} · {cote.devis.length} devis · {cote.jours.length} jour{cote.jours.length > 1 ? 's' : ''}</p>
      {cote.commande && <p>Commande {libelleCommande(cote.commande)}</p>}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {boolean} props.open
 * @param {Function} props.onOpenChange
 * @param {Object} props.chantier - ligne de majordhome_chantiers (id = lead)
 * @param {Array} props.quotes - devis rattachés (useLinkedPennylaneQuotes)
 * @param {Array} props.appointments - jours d'installation actifs (useChantierAppointments)
 * @param {{teamSize?: number|null, days?: number|null}} props.plannedOrder
 * @param {Function} [props.onSplit] - ({ new_lead_id }) après séparation réussie
 */
export function SplitChantierDialog({ open, onOpenChange, chantier, quotes = [], appointments = [], plannedOrder, onSplit }) {
  const { splitChantier, isSplitting } = useChantierMutations();
  const { equipmentTypes } = usePricingData();
  const [quoteIds, setQuoteIds] = useState([]);
  const [appointmentIds, setAppointmentIds] = useState([]);
  const [moveOrder, setMoveOrder] = useState(false);
  const [moveOrderTouched, setMoveOrderTouched] = useState(false);
  const [equipmentTypeId, setEquipmentTypeId] = useState('');

  useEffect(() => {
    if (!open) {
      setQuoteIds([]);
      setAppointmentIds([]);
      setMoveOrder(false);
      setMoveOrderTouched(false);
      setEquipmentTypeId('');
    }
  }, [open, chantier?.id]);

  // La commande suit le nouveau chantier par défaut quand les jours cochés = jours commandés.
  useEffect(() => {
    if (!moveOrderTouched) setMoveOrder(commandeSuitParDefaut(plannedOrder, appointmentIds.length));
  }, [appointmentIds.length, plannedOrder, moveOrderTouched]);

  const resume = useMemo(
    () => resumeSeparation({ quotes, appointments, plannedOrder }, { quoteIds, appointmentIds, moveOrder }),
    [quotes, appointments, plannedOrder, quoteIds, appointmentIds, moveOrder],
  );

  const toggle = (setter) => (id) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleConfirm = async () => {
    if (!resume.ok) return;
    try {
      const result = await splitChantier(chantier.id, {
        quoteIds,
        appointmentIds,
        moveOrder,
        equipmentTypeId: equipmentTypeId || null,
      });
      toast.success(`Chantier séparé : ${result?.counts?.quotes ?? 0} devis et ${result?.counts?.appointments ?? 0} jour(s) sur la nouvelle carte`);
      onOpenChange(false);
      onSplit?.(result);
    } catch (err) {
      console.error('[SplitChantierDialog] split error:', err);
      toast.error(messageErreur(err));
    }
  };

  const nom = `${chantier?.last_name || ''} ${chantier?.first_name || ''}`.trim() || 'ce chantier';
  const commande = libelleCommande(plannedOrder);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Séparer en chantier distinct"
      description={`Les devis et les jours cochés partent sur une nouvelle carte « ${nom} ». Le reste demeure sur celle-ci. Une séparation faite par erreur s'annule par « Fusionner » depuis la fiche lead.`}
      confirmLabel={isSplitting ? 'Séparation…' : 'Séparer'}
      cancelLabel="Annuler"
      variant="default"
      size="lg"
      loading={isSplitting}
      confirmDisabled={!resume.ok}
      onConfirm={handleConfirm}
    >
      <div className="mt-4 space-y-4">
        <section className="space-y-1.5">
          <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
            <GitBranch className="h-4 w-4 text-gray-500" />
            Devis qui partent
          </p>
          {quotes.map((q) => {
            const label = q.quote_number_pl || q.quote_label || `#${q.pennylane_quote_id}`;
            return (
              <label key={q.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm cursor-pointer">
                <input type="checkbox" checked={quoteIds.includes(q.id)} onChange={() => toggle(setQuoteIds)(q.id)} />
                <span className="font-medium text-gray-900">{label}</span>
                {q.quote_subject && <span className="text-gray-500 truncate">· {q.quote_subject}</span>}
                {!q.is_validated && <span className="text-gray-400">· {PL_STATUS_LABELS[q.quote_status] || q.quote_status}</span>}
                <span className="ml-auto font-semibold tabular-nums">{formatEuro(Number(q.quote_amount_ht) || 0)}</span>
              </label>
            );
          })}
        </section>

        {appointments.length > 0 && (
          <section className="space-y-1.5">
            <p className="text-sm font-medium text-gray-700">Jours d’installation qui partent</p>
            {appointments.map((a) => (
              <label key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm cursor-pointer">
                <input type="checkbox" checked={appointmentIds.includes(a.id)} onChange={() => toggle(setAppointmentIds)(a.id)} />
                <span className="font-medium text-gray-900">{dateCourte(a.scheduled_date)}</span>
                {a.scheduled_start && <span className="text-gray-500">{a.scheduled_start.slice(0, 5)}{a.scheduled_end ? ` – ${a.scheduled_end.slice(0, 5)}` : ''}</span>}
                <span className="ml-auto text-xs text-gray-500">{a.technician_ids?.length ?? 0} pers.</span>
              </label>
            ))}
          </section>
        )}

        {commande && (
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={moveOrder}
              onChange={(e) => { setMoveOrderTouched(true); setMoveOrder(e.target.checked); }}
            />
            La commande {commande} part avec le nouveau chantier
          </label>
        )}

        <label className="block text-sm text-gray-700">
          <span className="block mb-1">Type d’équipement du nouveau chantier <span className="text-gray-400">(facultatif)</span></span>
          <select
            value={equipmentTypeId}
            onChange={(e) => setEquipmentTypeId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {equipmentTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Colonne titre="Chantier d’origine" cote={resume.origine} />
          <Colonne titre="Nouveau chantier" cote={resume.nouveau} />
        </div>

        {resume.erreurs.length > 0 && (
          <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
            {resume.erreurs.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
      </div>
    </ConfirmDialog>
  );
}

export default SplitChantierDialog;
```

- [ ] **Step 2 : bandeau, boutons et dialogue dans `ChantierReceptionSection`**

Imports à ajouter en tête du fichier :
```jsx
import { AlertTriangle, GitBranch } from 'lucide-react'; // à fusionner avec l'import lucide existant (Package, ExternalLink, X)
import { SplitChantierDialog } from './SplitChantierDialog';
```
Signature : `export function ChantierReceptionSection({ chantier, onUpdated, disabled = false, installAppointments = [], plannedOrder = { teamSize: null, days: null } })`.

Dans le corps, après `const { organization } = useAuth();` :
```jsx
  const { effectiveRole } = useAuth();
  const canSplit = ['org_admin', 'team_leader'].includes(effectiveRole);
  const { confirmQuotesScope, isConfirmingScope } = useChantierMutations();
  const [showSplit, setShowSplit] = useState(false);
  const validatedCount = quotes.filter((q) => q.is_validated).length;
  const toArbitrate = Number(chantier?.quotes_to_arbitrate) > 0;

  const handleSameChantier = async () => {
    try {
      await confirmQuotesScope(chantier.id);
      onUpdated?.();
      toast.success('Devis confirmés sur le même chantier');
    } catch (err) {
      console.error('[ChantierReceptionSection] confirmQuotesScope error:', err);
      toast.error('Impossible d’enregistrer la réponse');
    }
  };
```
(Attention : `useAuth()` est déjà appelé une fois pour `organization` — fusionner en un seul `const { organization, effectiveRole } = useAuth();`.)

Dans le JSX, juste **avant** le bloc `{quotes.length > 0 && (` des devis rattachés :
```jsx
      {/* Question « même chantier ? » : posée une fois, mémorisée côté DB */}
      {toArbitrate && !disabled && canSplit && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2">
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Ce chantier porte {validatedCount} devis validés. Même chantier ou chantiers distincts ?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSameChantier}
              disabled={isConfirmingScope}
              className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-800 font-medium hover:bg-amber-100 disabled:opacity-50"
            >
              Même chantier
            </button>
            <button
              type="button"
              onClick={() => setShowSplit(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700"
            >
              Séparer…
            </button>
          </div>
        </div>
      )}
```
Juste **après** ce même bloc des devis rattachés (après son `)}`), le lien permanent :
```jsx
      {!toArbitrate && !disabled && canSplit && validatedCount >= 2 && (
        <button
          type="button"
          onClick={() => setShowSplit(true)}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium"
        >
          <GitBranch className="w-3.5 h-3.5" />
          Séparer en chantier distinct
        </button>
      )}

      <SplitChantierDialog
        open={showSplit}
        onOpenChange={setShowSplit}
        chantier={chantier}
        quotes={quotes}
        appointments={installAppointments}
        plannedOrder={plannedOrder}
        onSplit={() => onUpdated?.()}
      />
```

- [ ] **Step 3 : `ChantierModal` passe les jours et la commande**

Lignes 385-389 : 
```jsx
              <ChantierReceptionSection
                chantier={chantier}
                onUpdated={onUpdated}
                disabled={!canEditChantier}
                installAppointments={installAppointments}
                plannedOrder={plannedOrder}
              />
```
Après une séparation, `onUpdated` (= `refresh` du kanban) recharge la liste ; la modale lit `modalChantier` dans la liste fraîche (montant, jours et badge se mettent à jour). Les RDV de la section Installation sont rechargés par l'invalidation `appointmentKeys.all` du hook.

- [ ] **Step 4 : vérifier**

Run: `npm run lint:errors` puis `npx vite build`
Expected : 0 erreur, build OK. Relire `ChantierReceptionSection.jsx` : un seul appel `useAuth()`, `useState` importé, `toast` déjà importé.

- [ ] **Step 5 : commit**

```bash
git add src/apps/artisan/components/chantiers/SplitChantierDialog.jsx src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx src/apps/artisan/components/chantiers/ChantierModal.jsx
git commit -m "feat(chantiers): « Même chantier ou chantiers distincts ? » + dialogue de séparation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : badge sur la carte et fiche client

**Files:**
- Modify: `src/apps/artisan/components/chantiers/ChantierCard.jsx:122-130`
- Modify: `src/apps/artisan/pages/client-detail/TabInterventions.jsx:141-208` (`ChantierSummary`)

**Interfaces:**
- Consumes : `chantier.quotes_to_arbitrate` (vue), `chantiersService.getChantiersByClientId` (tâche 5).

- [ ] **Step 1 : badge « N devis à trancher »**

Remplacer la ligne 3 de la carte (bloc `{/* Ligne 3 … */}`) par :
```jsx
        {/* Ligne 3 : Type équipement + question « même chantier ? » — toujours rendue
            (hauteur réservée) pour uniformiser la taille des cartes */}
        <div className="mt-1.5 h-[22px] flex items-center gap-1.5 min-w-0">
          {chantier.equipment_type_label && (
            <span className="inline-block text-xs px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium truncate">
              {chantier.equipment_type_label}
            </span>
          )}
          {Number(chantier.quotes_to_arbitrate) > 0 && (
            <span
              className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold shrink-0"
              title="Plusieurs devis validés : même chantier ou chantiers distincts ?"
            >
              {chantier.quotes_to_arbitrate} devis à trancher
            </span>
          )}
        </div>
```

- [ ] **Step 2 : un bloc par chantier dans la fiche client**

Remplacer le composant `ChantierSummary` (lignes 141-208) par les deux composants ci-dessous. Le JSX de la carte est celui d'aujourd'hui, seuls le titre (prop `titre`) et la boucle changent.

```jsx
/**
 * Carte chantier (lecture seule) de la fiche client.
 */
const ChantierSummaryCard = ({ chantier, titre }) => {
  const statusConfig = getChantierStatusConfig(chantier.chantier_status);
  const orderLabels = { na: 'N/A', commande: 'Commandé', recu: 'Reçu' };

  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
      <div className="flex items-center gap-2">
        <HardHat className="w-4 h-4 text-amber-600" />
        <h4 className="text-sm font-semibold text-amber-900">{titre}</h4>
        <span
          className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium text-white"
          style={{ backgroundColor: statusConfig.color }}
        >
          {statusConfig.label}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {chantier.won_date && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Gagné le :</span> {formatDateFR(chantier.won_date)}
          </p>
        )}
        {chantier.estimated_date && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Date estimée :</span> {formatDateFR(chantier.estimated_date)}
          </p>
        )}
        {chantier.equipment_order_status && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Équipement :</span> {orderLabels[chantier.equipment_order_status] || '—'}
          </p>
        )}
        {chantier.materials_order_status && (
          <p className="text-secondary-600">
            <span className="text-secondary-400">Matériaux :</span> {orderLabels[chantier.materials_order_status] || '—'}
          </p>
        )}
      </div>
      {chantier.chantier_notes && (
        <p className="text-xs text-secondary-500 italic">{chantier.chantier_notes}</p>
      )}
    </div>
  );
};

/**
 * Section chantiers (lecture seule) — un client peut en porter plusieurs
 * (séparation d'un chantier, spec 2026-09-30) : un bloc par chantier.
 */
const ChantierSummary = ({ clientId }) => {
  const [chantiers, setChantiers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    const load = async () => {
      try {
        const { data } = await chantiersService.getChantiersByClientId(clientId);
        setChantiers(data || []);
      } catch (err) {
        console.error('[ChantierSummary] load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [clientId]);

  if (loading) return null;
  if (chantiers.length === 0) return null;

  return (
    <div className="space-y-3">
      {chantiers.map((c, i) => (
        <ChantierSummaryCard
          key={c.id}
          chantier={c}
          titre={chantiers.length > 1 ? `Chantier ${i + 1}/${chantiers.length}` : 'Chantier en cours'}
        />
      ))}
    </div>
  );
};
```

- [ ] **Step 3 : vérifier**

Run: `npm run audit:quality` puis `npx vite build`
Expected : 0 erreur, `# fail 0`, aucun fichier mort, build OK. `grep -rn "getChantierByClientId" src` → aucun résultat.

- [ ] **Step 4 : commit**

```bash
git add src/apps/artisan/components/chantiers/ChantierCard.jsx src/apps/artisan/pages/client-detail/TabInterventions.jsx
git commit -m "feat(chantiers): badge « devis à trancher » sur la carte, plusieurs chantiers par client

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : vérification de bout en bout et remise

**Files:**
- Modify: `.claude/proposed-updates.md` (nouvelle entrée PENDING)

- [ ] **Step 1 : preuve automatisée**

Run :
```bash
npm run audit:quality
npx vite build
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260930_11_lead_split.sql --assert scripts/migration-rehearsal/assert-lead-split.sql
```
Expected : tout vert. Rapporter les sorties telles quelles (pas de « ça passe » sans la ligne `# fail 0`).

- [ ] **Step 2 : test manuel par Eric (prod, sur son serveur de dev)**

Lui donner la liste, dans cet ordre :
1. Kanban Chantiers : 12 cartes portent « 2 devis à trancher » (FRENCH COUNTRY : 4).
2. GOUIN → Séparer… : cocher D-2026-09466 et D-2026-09483, les 3 jours de novembre, la case « commande 2 pers. × 3 j » est pré-cochée → Séparer. Attendu : carte borne 1 261 € avec le 18/09, carte PAC 11 540 € avec les 3 jours et « commande 2 pers. × 3 j », plus de badge sur les deux ; pipeline : deux cartes Gagné GOUIN.
3. BERNA → « Même chantier » : le badge disparaît, la timeline du lead porte « 2 devis validés confirmés sur le même chantier ».
4. Fiche client GOUIN, onglet Interventions : deux blocs chantier.
5. Planning : les 3 jours de novembre sont toujours là, mêmes techniciens, même couleur.

- [ ] **Step 3 : proposition pour le CLAUDE.md**

Ajouter à `.claude/proposed-updates.md` une entrée `PENDING` (titre « Chantier : plusieurs devis, séparation en cartes distinctes ») proposant, pour la section « Module Pennylane quote-driven », le texte :
> **Chantier distinct = lead distinct** (2026-09-30). Une carte à ≥ 2 devis validés pose la question « même chantier ou chantiers distincts ? » (`quotes_to_arbitrate`, mémorisée par `lead_pennylane_quotes.scope_confirmed_at`). Séparer = RPC `lead_split` (org_admin / team_leader, inverse de `lead_merge`, gain du nouveau lead par `lead_mark_won_with_quote`), règles dans le module pur `src/lib/chantierSplit.js`. Même chantier par défaut ; aucune séparation automatique.

Ne **pas** éditer `CLAUDE.md` directement.

- [ ] **Step 4 : signaler le reliquat**

Dans la note de fin : `fetchQuoteNumbersByIds` (`pennylane.service.js:645`) appelle encore l'API Pennylane en direct pour les numéros de devis alors que le miroir `pennylane_quotes.quote_number` les porte — à instruire à part (règle « le miroir local est la source de lecture »), pas dans ce lot.
