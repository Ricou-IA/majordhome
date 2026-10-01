# Chantier : une entité par devis accepté — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer « 1 lead = 1 chantier » par une table `majordhome.chantiers` : un chantier par devis accepté, regroupable ; devis et RDV d'installation rattachés au chantier ; « facturé » lu par chantier.

**Architecture:** Trois migrations versionnées (structure + reprise + vues ; trigger + RPC ; patch `lead_merge`), répétées sur le harnais `scripts/migration-rehearsal/` avec une fixture GOUIN. Côté front, le service chantiers écrit sur une vue miroir `majordhome_chantiers_write` (RLS `role_can`), les gestes Grouper / Détacher passent par RPC, un module pur `chantierSplit.js` porte les règles d'aperçu. Le pipeline (`majordhome_kanban_cards`, `lead_quote_stats`) ne change pas.

**Tech Stack:** PostgreSQL (Supabase, plpgsql, vues `security_invoker`), React 18 + TanStack Query v5, node:test.

**Spec:** `docs/superpowers/specs/2026-09-30-chantier-entite-par-devis-design.md` — les exécutants lisent la spec ET ce plan.

## Global Constraints

- Fichiers du repo en **CRLF** : éditer avec les outils Edit/Write, jamais `sed -i` ni script texte (vérifier `file <chemin>` après création : « CRLF line terminators »).
- Tout nouveau RPC SECURITY DEFINER : `REVOKE EXECUTE … FROM PUBLIC, anon` puis `GRANT … TO authenticated` ; garde POSITIVE (`IS NOT TRUE`), `auth.uid()` NULL refusé en première instruction.
- Toute nouvelle table `majordhome.*` : RLS activée + `GRANT SELECT … TO service_role` ; toute nouvelle vue `public.majordhome_*` : `WITH (security_invoker = true)`.
- Vue miroir simple = updatable ; jamais de LATERAL/window dans `majordhome_appointments` ; colonne ajoutée à une vue existante **en fin de liste**.
- Toute mutation Supabase côté front filtre `.eq('org_id', orgId)` et lit `{ error }`.
- Hooks : `mutationFn` déballe via `unwrapResult()` ; cache keys centralisées dans `cacheKeys.js` avec `orgId` en 1ᵉʳ paramètre.
- Aucune allowlist de statuts Pennylane recopiée : `majordhome.quote_status_bucket()` uniquement (le seul littéral toléré est `quote_status = 'invoiced'`, comme dans `target_invoiced` aujourd'hui).
- Ne rien committer sur `main` : commits sur la branche du worktree, `git push` seulement après accord d'Eric.
- Pas de preview tools : vérification par `node --test`, `npm run lint:errors`, `npx vite build`, harnais de répétition.
- Org Mayer : core `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1` ; l'org majordhome (celle des `appointments.org_id`) se lit dans `majordhome.organizations WHERE core_org_id = <core>`.

---

## Carte des fichiers

**Créés**
- `supabase/migrations/20260930_16_chantiers_entite.sql` — table, colonnes, reprise, vues, RLS, grants, audit.
- `supabase/migrations/20260930_17_chantiers_rpc.sql` — trigger `chantier_ensure_for_quote`, RPC `chantier_ensure_for_lead`, `chantier_group`, `chantier_detach`, `chantier_delete`.
- `supabase/migrations/20260930_18_lead_merge_chantiers.sql` — `lead_merge` re-parente les chantiers.
- `scripts/migration-rehearsal/fixture-chantiers.sql` — leads GOUIN / SANS DEVIS / RENOU, devis, RDV (jouée AVANT la migration via `--migration`).
- `scripts/migration-rehearsal/assert-chantiers.sql` — assertions §A structure + reprise, §B trigger + RPC, §C `lead_merge`.
- `src/lib/chantierSplit.js` + `scripts/chantier-split.test.mjs` — règles pures d'aperçu (détacher / grouper).
- `src/apps/artisan/components/chantiers/DetachChantierDialog.jsx`, `GroupChantiersDialog.jsx`.

**Modifiés**
- `scripts/migration-rehearsal/snapshot.mjs`, `assert-baseline.sql` — sous-ensemble étendu.
- `src/shared/hooks/cacheKeys.js`, `useChantiers.js`, `useAppointments.js`, `usePennylane.js`.
- `src/shared/services/chantiers.service.js`, `appointments.service.js`, `leads.service.js`, `pennylane.service.js`.
- `src/apps/artisan/components/chantiers/ChantierModal.jsx`, `ChantierCard.jsx`, `ChantierReceptionSection.jsx`.
- `src/apps/artisan/components/planning/EventModal.jsx` (« Programmer une suite » copie `chantier_id`).
- `src/apps/artisan/pages/PvReceptionSign.jsx`, `routes.jsx`, `client-detail/TabInterventions.jsx`.
- `src/lib/auditTrail.js` (libellés), `package.json` (`audit:quality`), `docs/DATABASE.md`, `.claude/proposed-updates.md`.

---

### Task 1 : Migration 1 — table `chantiers`, reprise, vues, RLS + fixture et harnais

**Files:**
- Create: `supabase/migrations/20260930_16_chantiers_entite.sql`
- Create: `scripts/migration-rehearsal/fixture-chantiers.sql`
- Create: `scripts/migration-rehearsal/assert-chantiers.sql` (§A)
- Modify: `scripts/migration-rehearsal/snapshot.mjs:26-106`
- Modify: `scripts/migration-rehearsal/assert-baseline.sql` (§1, listes FUNCTIONS / TRIGGER_TABLES / VIEWS)

**Interfaces:**
- Produces: table `majordhome.chantiers` ; colonnes `lead_pennylane_quotes.chantier_id`, `appointments.chantier_id` ; vue `majordhome.chantier_quote_stats(chantier_id, org_id, quotes_count, validated_count, invoiced_count, pending_count, validated_sum)` ; vue `public.majordhome_chantiers` (colonnes historiques + `lead_id, label, quotes_count, is_invoiced, lead_chantiers_count`) ; vue updatable `public.majordhome_chantiers_write` ; `public.majordhome_appointments.chantier_id` (fin de liste) et `target_invoiced` lu par chantier ; `public.majordhome_lead_pennylane_quotes.chantier_id` (fin de liste).

- [ ] **Step 1 : Étendre le sous-ensemble du harnais** (`snapshot.mjs`)

Dans `TABLES`, remplacer la ligne `lead_pennylane_quotes` et ajouter après `appointment_technicians` :

```js
  { schema: 'majordhome', table: 'lead_pennylane_quotes', columns: null, data: false }, // 20260930_16 : chantier_id + trigger chantier_ensure_for_quote
  { schema: 'majordhome', table: 'pennylane_quotes', columns: ['org_id', 'pennylane_quote_id', 'quote_number', 'label', 'status', 'quote_date', 'pdf_url', 'pdf_invoice_subject'], data: false }, // 20260930_16 : libellé du chantier
  { schema: 'majordhome', table: 'chantier_line_receptions', columns: null, data: false }, // 20260930_16 : chantier_id → majordhome.chantiers
  { schema: 'majordhome', table: 'lead_activities', columns: null, data: false }, // 20260930_17 : activités chantier_*
  { schema: 'majordhome', table: 'role_permissions', columns: null }, // role_can() (policies chantiers)
  { schema: 'majordhome', table: 'app_role_permissions', columns: null }, // role_can() défauts app-level
```

Dans `FUNCTIONS`, ajouter :

```js
  // 20260930_16..18 : entité chantier
  'majordhome.lead_pennylane_quotes_invariant_winning()',
  'majordhome.role_can(uuid, text, text)',
  'majordhome.user_effective_role(uuid)',
  'public.lead_merge(uuid, uuid)', // recréée sans ses 16 tables satellites : plpgsql ne résout les tables qu'à l'exécution
```

`TRIGGER_TABLES` devient :

```js
const TRIGGER_TABLES = ['majordhome.equipments', 'majordhome.maintenance_visits', 'majordhome.contracts', 'majordhome.lead_pennylane_quotes'];
```

Dans `VIEWS`, ajouter en fin :

```js
  // 20260930_16 : cibles du CREATE OR REPLACE
  'public.majordhome_lead_pennylane_quotes',
  'public.majordhome_appointments',
```

`POLICY_TABLES` : ajouter `'leads'` (les policies `leads_*_role_can` prouvent que `role_can` se charge).

- [ ] **Step 2 : Ré-aligner `assert-baseline.sql` §1**

Dans la liste `FOR r IN SELECT * FROM (VALUES …) AS t(fn)` des fonctions, ajouter les 4 lignes :

```sql
      ('majordhome.lead_pennylane_quotes_invariant_winning()'),
      ('majordhome.role_can(uuid, text, text)'),
      ('majordhome.user_effective_role(uuid)'),
      ('public.lead_merge(uuid, uuid)'),
```

Après le bloc « Triggers utilisateur de majordhome.contracts », ajouter :

```sql
  -- Triggers utilisateur de majordhome.lead_pennylane_quotes (TRIGGER_TABLES)
  PERFORM 1 FROM pg_trigger
   WHERE tgrelid = 'majordhome.lead_pennylane_quotes'::regclass AND NOT tgisinternal
     AND tgname = 'trg_lead_pennylane_quotes_invariant_winning'
     AND tgfoid = to_regprocedure('majordhome.lead_pennylane_quotes_invariant_winning()');
  IF NOT FOUND THEN RAISE EXCEPTION 'trigger invariant_winning absent sur majordhome.lead_pennylane_quotes'; END IF;
```

Dans le bloc des vues (`security_invoker`), ajouter `'public.majordhome_lead_pennylane_quotes'` et `'public.majordhome_appointments'` à la liste vérifiée (même forme que les entrées existantes).

- [ ] **Step 3 : Photographier la prod et vérifier la baseline**

```bash
node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local
node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-baseline.sql
```

Attendu : `assert-baseline : OK`. Si `role_can` échoue au chargement faute d'une table, l'ajouter à `TABLES` (ne pas contourner).

- [ ] **Step 4 : Écrire la fixture** `scripts/migration-rehearsal/fixture-chantiers.sql`

```sql
-- fixture-chantiers.sql — données de répétition pour 20260930_16..18 (jouée via --migration AVANT la migration).
-- Reproduit GOUIN (borne facturée + PAC acceptée + variante refusée, 4 RDV), un lead gagné SANS devis,
-- et RENOU (Perdu, vieux devis facturé, chantier_status NULL → ne doit produire aucun chantier).
DO $$
DECLARE
  v_org uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_mh_org uuid;
BEGIN
  SELECT id INTO v_mh_org FROM majordhome.organizations WHERE core_org_id = v_org;
  IF v_mh_org IS NULL THEN RAISE EXCEPTION 'org majordhome introuvable pour %', v_org; END IF;

  INSERT INTO majordhome.leads (id, org_id, first_name, last_name, chantier_status, planned_team_size, planned_days,
                                won_date, equipment_order_status, materials_order_status, is_deleted)
  VALUES ('11111111-1111-1111-1111-111111111111', v_org, 'BATISTE', 'GOUIN', 'planification', 2, 3,
          DATE '2026-09-01', 'recu', 'recu', false),
         ('22222222-2222-2222-2222-222222222222', v_org, 'SANS', 'DEVIS', NULL, NULL, NULL, DATE '2026-09-20', NULL, NULL, false),
         ('33333333-3333-3333-3333-333333333333', v_org, 'FATHIA', 'RENOU', NULL, NULL, NULL, NULL, NULL, NULL, false);

  INSERT INTO majordhome.pennylane_quotes (org_id, pennylane_quote_id, quote_number, label, status, quote_date, pdf_invoice_subject)
  VALUES (v_org, 28548694261760, 'D-2026-09430', 'D-2026-09430', 'invoiced', DATE '2026-09-03', 'Installation d''une Borne V2C Monophasé'),
         (v_org, 29572673601536, 'D-2026-09466', 'D-2026-09466', 'accepted', DATE '2026-09-30', 'Installation d''une pompe à chaleur DAIKIN'),
         (v_org, 30343886917632, 'D-2026-09483', 'D-2026-09483', 'denied',   DATE '2026-09-30', 'Variante PAC'),
         (v_org, 40000000000001, 'D-2026-09999', 'D-2026-09999', 'pending',  DATE '2026-10-01', 'Poêle à granulés'),
         (v_org, 20000000000001, 'D-2026-07336', 'D-2026-07336', 'invoiced', DATE '2026-07-01', 'Ramonage');

  INSERT INTO majordhome.lead_pennylane_quotes (id, org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at)
  VALUES ('aaaa0001-0000-0000-0000-000000000001', v_org, '11111111-1111-1111-1111-111111111111', 28548694261760, 1447384297472, 1260.76,  'D-2026-09430', DATE '2026-09-03', 'invoiced', true,  now()),
         ('aaaa0001-0000-0000-0000-000000000002', v_org, '11111111-1111-1111-1111-111111111111', 29572673601536, 1447384297472, 11540,    'D-2026-09466', DATE '2026-09-30', 'accepted', false, now()),
         ('aaaa0001-0000-0000-0000-000000000003', v_org, '11111111-1111-1111-1111-111111111111', 30343886917632, 1447384297472, 10240.34, 'D-2026-09483', DATE '2026-09-30', 'denied',   false, now()),
         ('aaaa0003-0000-0000-0000-000000000001', v_org, '33333333-3333-3333-3333-333333333333', 20000000000001, 99, 400, 'D-2026-07336', DATE '2026-07-01', 'invoiced', true, now());

  INSERT INTO majordhome.appointments (id, org_id, lead_id, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name)
  VALUES ('bbbb0001-0000-0000-0000-000000000001', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-09-18', TIME '08:00', TIME '13:30', 330, 'completed', 'GOUIN'),
         ('bbbb0001-0000-0000-0000-000000000002', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-11-03', TIME '08:00', TIME '17:00', 540, 'scheduled', 'GOUIN'),
         ('bbbb0001-0000-0000-0000-000000000003', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-11-04', TIME '08:00', TIME '17:00', 540, 'scheduled', 'GOUIN'),
         ('bbbb0001-0000-0000-0000-000000000004', v_mh_org, '11111111-1111-1111-1111-111111111111', 'installation', DATE '2026-11-05', TIME '08:00', TIME '17:00', 540, 'scheduled', 'GOUIN');

  INSERT INTO majordhome.chantier_line_receptions (id, org_id, chantier_id, pennylane_quote_id, line_label, quantity_received)
  VALUES ('cccc0001-0000-0000-0000-000000000001', v_org, '11111111-1111-1111-1111-111111111111', 29572673601536, 'Unité extérieure', 1);
END $$;
```

Si une colonne NOT NULL manque à l'un des INSERT (le schéma généré le dira à l'exécution), la renseigner dans la fixture avec une valeur neutre ; ne pas retirer de colonne de `snapshot.mjs`.

- [ ] **Step 5 : Écrire la migration** `supabase/migrations/20260930_16_chantiers_entite.sql`

```sql
-- supabase/migrations/20260930_16_chantiers_entite.sql
-- ============================================================================
-- Chantier = entité (spec 2026-09-30-chantier-entite-par-devis-design.md).
-- Règle Eric 2026-09-30 : un lead = N devis ; chaque devis accepté = 1 chantier,
-- regroupable. Cette migration pose la structure et REPREND l'existant tel quel
-- (1 chantier par lead à chantier_status, tous ses devis dessus) ; la règle
-- « un devis = un chantier » s'applique aux devis validés APRÈS (20260930_17).
--   1. majordhome.chantiers (RLS org, UPDATE via role_can chantiers.edit|edit_own)
--   2. lead_pennylane_quotes.chantier_id, appointments.chantier_id,
--      chantier_line_receptions.chantier_id → FK chantiers
--   3. reprise : 1 chantier par lead, devis validés + RDV installation rattachés
--   4. vues : chantier_quote_stats (quote_status_bucket, aucune allowlist),
--      majordhome_chantiers (DROP + CREATE, id = chantier), majordhome_chantiers_write
--      (miroir updatable), majordhome_appointments (target_invoiced par chantier,
--      chantier_id en fin), majordhome_lead_pennylane_quotes (chantier_id en fin)
--   5. audit (trigger mouchard si la fonction existe), grants service_role
-- Les colonnes chantier de `leads` restent en place (contraction ultérieure).
-- Répétée sur scripts/migration-rehearsal/ (fixture-chantiers.sql + assert-chantiers.sql §A).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.chantiers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES core.organizations(id),
  lead_id                uuid NOT NULL REFERENCES majordhome.leads(id) ON DELETE CASCADE,
  client_id              uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  label                  text,
  chantier_status        text NOT NULL DEFAULT 'gagne'
                         CHECK (chantier_status IN ('gagne', 'commande_a_faire', 'commande_recue', 'planification', 'realise', 'facture')),
  equipment_order_status text CHECK (equipment_order_status IN ('na', 'commande', 'recu')),
  materials_order_status text CHECK (materials_order_status IN ('na', 'commande', 'recu')),
  estimated_date         date,
  planification_date     date,
  won_date               date,
  chantier_notes         text,
  pv_reception_path      text,
  planned_team_size      smallint CHECK (planned_team_size BETWEEN 1 AND 20),
  planned_days           smallint CHECK (planned_days BETWEEN 1 AND 60),
  equipment_type_id      uuid REFERENCES majordhome.pricing_equipment_types(id) ON DELETE SET NULL,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chantiers_org_status ON majordhome.chantiers (org_id, chantier_status);
CREATE INDEX IF NOT EXISTS idx_chantiers_lead ON majordhome.chantiers (lead_id);
COMMENT ON TABLE majordhome.chantiers IS
  'Un chantier = une commande à exécuter (devis validés + jours d''installation). N chantiers par lead. Création par trigger chantier_ensure_for_quote / RPC chantier_ensure_for_lead ; gestes chantier_group / chantier_detach / chantier_delete. Écriture front via public.majordhome_chantiers_write.';

DROP TRIGGER IF EXISTS trg_chantiers_updated_at ON majordhome.chantiers;
CREATE TRIGGER trg_chantiers_updated_at
  BEFORE UPDATE ON majordhome.chantiers
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Colonnes de rattachement
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.lead_pennylane_quotes
  ADD COLUMN IF NOT EXISTS chantier_id uuid REFERENCES majordhome.chantiers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lead_pennylane_quotes_chantier ON majordhome.lead_pennylane_quotes (chantier_id) WHERE chantier_id IS NOT NULL;
COMMENT ON COLUMN majordhome.lead_pennylane_quotes.chantier_id IS
  'Chantier auquel le devis appartient. NULL = attaché au lead sans chantier (devis en attente / refusé, ou antérieur à la migration sur un lead sans chantier).';

ALTER TABLE majordhome.appointments
  ADD COLUMN IF NOT EXISTS chantier_id uuid REFERENCES majordhome.chantiers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_chantier ON majordhome.appointments (chantier_id) WHERE chantier_id IS NOT NULL;
COMMENT ON COLUMN majordhome.appointments.chantier_id IS
  'Chantier d''un RDV installation. lead_id reste renseigné (dérivé) pour les lecteurs historiques.';

-- ----------------------------------------------------------------------------
-- 3. Reprise : un chantier par lead à chantier_status, tout dessus
-- ----------------------------------------------------------------------------
INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, chantier_status, equipment_order_status, materials_order_status,
  estimated_date, planification_date, won_date, chantier_notes, pv_reception_path, planned_team_size, planned_days,
  equipment_type_id, sort_order, created_at, updated_at)
SELECT l.org_id, l.id, l.client_id, l.chantier_status, l.equipment_order_status, l.materials_order_status,
  l.estimated_date, l.planification_date, l.won_date, l.chantier_notes, l.pv_reception_path, l.planned_team_size, l.planned_days,
  l.equipment_type_id, COALESCE(l.sort_order, 0), COALESCE(l.won_date::timestamptz, l.created_at, now()), now()
FROM majordhome.leads l
WHERE l.chantier_status IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM majordhome.chantiers c WHERE c.lead_id = l.id);

UPDATE majordhome.lead_pennylane_quotes q
   SET chantier_id = c.id
  FROM majordhome.chantiers c
 WHERE c.lead_id = q.lead_id AND q.chantier_id IS NULL AND q.ejected_at IS NULL
   AND majordhome.quote_status_bucket(q.quote_status) = 'validated';

UPDATE majordhome.appointments a
   SET chantier_id = c.id
  FROM majordhome.chantiers c
 WHERE c.lead_id = a.lead_id AND a.chantier_id IS NULL AND a.appointment_type = 'installation';

-- chantier_line_receptions.chantier_id contenait des ids de LEAD → id du chantier ; orphelins mis à NULL avant la FK.
UPDATE majordhome.chantier_line_receptions r
   SET chantier_id = c.id
  FROM majordhome.chantiers c
 WHERE c.lead_id = r.chantier_id;
UPDATE majordhome.chantier_line_receptions r
   SET chantier_id = NULL
 WHERE r.chantier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM majordhome.chantiers c WHERE c.id = r.chantier_id);
ALTER TABLE majordhome.chantier_line_receptions
  DROP CONSTRAINT IF EXISTS chantier_line_receptions_chantier_id_fkey,
  ADD CONSTRAINT chantier_line_receptions_chantier_id_fkey
    FOREIGN KEY (chantier_id) REFERENCES majordhome.chantiers(id) ON DELETE CASCADE;

DO $$
DECLARE n_leads int; n_ch int; n_orph int;
BEGIN
  SELECT count(*) INTO n_leads FROM majordhome.leads WHERE chantier_status IS NOT NULL;
  SELECT count(*) INTO n_ch FROM majordhome.chantiers;
  IF n_ch < n_leads THEN RAISE EXCEPTION 'reprise : % chantiers pour % leads à chantier_status', n_ch, n_leads; END IF;
  SELECT count(*) INTO n_orph FROM majordhome.appointments a JOIN majordhome.leads l ON l.id = a.lead_id
   WHERE a.appointment_type = 'installation' AND l.chantier_status IS NOT NULL AND a.chantier_id IS NULL;
  IF n_orph > 0 THEN RAISE EXCEPTION 'reprise : % RDV installation sans chantier_id', n_orph; END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Vues
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW majordhome.chantier_quote_stats AS
SELECT chantier_id, org_id,
       count(*)                                                                             AS quotes_count,
       count(*) FILTER (WHERE majordhome.quote_status_bucket(quote_status) = 'validated')   AS validated_count,
       count(*) FILTER (WHERE quote_status = 'invoiced')                                    AS invoiced_count,
       count(*) FILTER (WHERE majordhome.quote_status_bucket(quote_status) = 'pending')     AS pending_count,
       sum(quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(quote_status) = 'validated') AS validated_sum
  FROM majordhome.lead_pennylane_quotes
 WHERE ejected_at IS NULL AND chantier_id IS NOT NULL
 GROUP BY chantier_id, org_id;
GRANT SELECT ON majordhome.chantier_quote_stats TO authenticated, service_role;

DROP VIEW IF EXISTS public.majordhome_chantiers;
CREATE VIEW public.majordhome_chantiers WITH (security_invoker = true) AS
SELECT c.id, c.org_id,
       l.first_name, l.last_name, l.company_name, l.email, l.phone, l.address, l.postal_code, l.city,
       l.order_amount_ht, l.estimated_revenue,
       c.chantier_status, c.equipment_order_status, c.materials_order_status,
       c.estimated_date, c.planification_date, c.chantier_notes, c.won_date,
       l.client_id, l.project_id, l.assigned_user_id, c.equipment_type_id, c.pv_reception_path,
       c.updated_at, c.created_at,
       pet.label    AS equipment_type_label,
       pet.category AS equipment_type_category,
       l.pennylane_quote_id,
       COALESCE(s.validated_sum, 0::numeric) AS linked_quotes_amount_ht,
       rdv.next_rdv_date,
       COALESCE(rdv.has_active_rdv, false)   AS has_active_rdv,
       COALESCE(s.validated_count, 0::bigint) AS validated_quotes_count,
       c.planned_team_size, c.planned_days,
       c.lead_id, c.label,
       COALESCE(s.quotes_count, 0::bigint)   AS quotes_count,
       COALESCE(s.validated_count > 0 AND s.invoiced_count = s.validated_count, false) AS is_invoiced,
       (SELECT count(*) FROM majordhome.chantiers c2 WHERE c2.lead_id = c.lead_id) AS lead_chantiers_count
  FROM majordhome.chantiers c
  JOIN majordhome.leads l ON l.id = c.lead_id AND l.is_deleted = false
  LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = c.equipment_type_id
  LEFT JOIN majordhome.chantier_quote_stats s ON s.chantier_id = c.id
  LEFT JOIN LATERAL (
    SELECT min(a.scheduled_date) AS next_rdv_date, bool_or(true) AS has_active_rdv
      FROM majordhome.appointments a
     WHERE a.chantier_id = c.id AND a.appointment_type = 'installation'
       AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])
  ) rdv ON true;
GRANT SELECT ON public.majordhome_chantiers TO authenticated, service_role;
COMMENT ON VIEW public.majordhome_chantiers IS
  'Chantiers (majordhome.chantiers × identité du lead). id = CHANTIER (plus le lead). Montant = devis validés du chantier (chantier_quote_stats). Lecture seule : écrire via majordhome_chantiers_write.';

DROP VIEW IF EXISTS public.majordhome_chantiers_write;
CREATE VIEW public.majordhome_chantiers_write WITH (security_invoker = true) AS
  SELECT * FROM majordhome.chantiers;
REVOKE ALL ON public.majordhome_chantiers_write FROM anon;
GRANT SELECT, UPDATE ON public.majordhome_chantiers_write TO authenticated;
GRANT SELECT ON public.majordhome_chantiers_write TO service_role;
COMMENT ON VIEW public.majordhome_chantiers_write IS
  'Miroir auto-updatable de majordhome.chantiers (security_invoker, RLS role_can chantiers.edit|edit_own). UPDATE front ; INSERT/DELETE par RPC.';

CREATE OR REPLACE VIEW public.majordhome_appointments WITH (security_invoker = true) AS
SELECT id, org_id, service_request_id, lead_id, client_name, client_phone, client_email, address, postal_code, city,
       scheduled_date, scheduled_start, scheduled_end, duration_minutes, scheduled_at, appointment_type, equipment_type,
       priority, status, subject, description, internal_notes, completion_notes, parts_used, photos_urls, signature_url,
       completed_at, is_billable, estimated_amount, final_amount, invoice_id, invoice_status, is_recurring, recurrence_rule,
       parent_appointment_id, google_event_id, google_calendar_id, google_synced_at, slack_message_ts, slack_channel_id,
       client_notified_at, reminder_24h_sent, reminder_1h_sent, source, created_at, updated_at, created_by, cancelled_at,
       cancellation_reason, client_id, client_first_name, assigned_commercial_id, intervention_id,
       CASE
         WHEN intervention_id IS NOT NULL THEN COALESCE((SELECT i.invoiced_at IS NOT NULL OR i.workflow_status = 'facture'::text
                                                            FROM majordhome.interventions i WHERE i.id = a.intervention_id), false)
         WHEN appointment_type = 'installation'::text AND chantier_id IS NOT NULL THEN EXISTS (
              SELECT 1 FROM majordhome.chantier_quote_stats s
               WHERE s.chantier_id = a.chantier_id AND s.validated_count > 0 AND s.invoiced_count = s.validated_count)
         ELSE false
       END AS target_invoiced,
       grand_secteur, time_flex_minutes, hour_confirmed_at, announced_start,
       chantier_id
  FROM majordhome.appointments a;

CREATE OR REPLACE VIEW public.majordhome_lead_pennylane_quotes WITH (security_invoker = true) AS
SELECT lpq.id, lpq.org_id, lpq.lead_id, lpq.pennylane_quote_id, lpq.pennylane_customer_id, lpq.pennylane_client_id,
       lpq.quote_amount_ht, lpq.quote_label, lpq.quote_date, lpq.quote_status,
       COALESCE(pq.pdf_url, lpq.pdf_url) AS pdf_url,
       lpq.assigned_at, lpq.ejected_at, lpq.ejected_reason, lpq.created_at, lpq.is_winning_quote,
       l.last_name AS lead_last_name, l.first_name AS lead_first_name, l.status_id AS lead_status_id, l.client_id,
       c.client_number, c.last_name AS client_last_name, c.first_name AS client_first_name,
       c.pennylane_account_number AS client_pl_number,
       majordhome.quote_status_bucket(lpq.quote_status) = 'validated'::text AS is_validated,
       lpq.chantier_id
  FROM majordhome.lead_pennylane_quotes lpq
  JOIN majordhome.leads l ON l.id = lpq.lead_id
  LEFT JOIN majordhome.clients c ON c.id = l.client_id
  LEFT JOIN majordhome.pennylane_quotes pq ON pq.org_id = lpq.org_id AND pq.pennylane_quote_id = lpq.pennylane_quote_id;

-- ----------------------------------------------------------------------------
-- 5. RLS, grants, audit
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.chantiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chantiers_select_org_members ON majordhome.chantiers;
CREATE POLICY chantiers_select_org_members ON majordhome.chantiers
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS chantiers_update_role_can ON majordhome.chantiers;
CREATE POLICY chantiers_update_role_can ON majordhome.chantiers
  FOR UPDATE TO authenticated
  USING (majordhome.role_can(org_id, 'chantiers', 'edit') OR majordhome.role_can(org_id, 'chantiers', 'edit_own'))
  WITH CHECK (majordhome.role_can(org_id, 'chantiers', 'edit') OR majordhome.role_can(org_id, 'chantiers', 'edit_own'));
-- Pas de policy INSERT / DELETE : création par trigger et RPC SECURITY DEFINER, suppression par RPC.

REVOKE ALL ON majordhome.chantiers FROM anon, authenticated;
GRANT SELECT, UPDATE ON majordhome.chantiers TO authenticated;
GRANT SELECT ON majordhome.chantiers TO service_role;

-- Mouchard : seulement si la fonction existe (absente du harnais de répétition, fail-safe en prod).
DO $$
BEGIN
  IF to_regprocedure('majordhome.audit_row_change()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_chantiers ON majordhome.chantiers';
    EXECUTE $t$CREATE TRIGGER trg_audit_chantiers AFTER INSERT OR DELETE OR UPDATE ON majordhome.chantiers
             FOR EACH ROW EXECUTE FUNCTION majordhome.audit_row_change('updated_at,sort_order')$t$;
  END IF;
END $$;
```

- [ ] **Step 6 : Écrire les assertions §A** `scripts/migration-rehearsal/assert-chantiers.sql`

```sql
-- assert-chantiers.sql — vérifie 20260930_16 (§A), 20260930_17 (§B), 20260930_18 (§C) sur le cluster
-- de répétition, après fixture-chantiers.sql. Un écart lève une exception → run.mjs sort en ECHEC.

-- ── §A Structure + reprise ────────────────────────────────────────────────────
DO $$
DECLARE n int; v_upd text; v_amount numeric; v_bool boolean; v_ch uuid;
BEGIN
  IF to_regclass('majordhome.chantiers') IS NULL THEN RAISE EXCEPTION 'table chantiers absente'; END IF;

  -- Reprise : 1 chantier par lead à chantier_status (GOUIN seulement dans la fixture ; RENOU et SANS DEVIS : aucun)
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : 1 chantier attendu, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
  IF n <> 0 THEN RAISE EXCEPTION 'RENOU / SANS DEVIS : aucun chantier attendu, trouvé %', n; END IF;

  SELECT id INTO v_ch FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes WHERE chantier_id = v_ch;
  IF n <> 2 THEN RAISE EXCEPTION 'GOUIN : 2 devis validés rattachés attendus, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes WHERE id = 'aaaa0001-0000-0000-0000-000000000003' AND chantier_id IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : le devis refusé ne doit pas être rattaché'; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments WHERE chantier_id = v_ch;
  IF n <> 4 THEN RAISE EXCEPTION 'GOUIN : 4 RDV rattachés attendus, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantier_line_receptions WHERE chantier_id = v_ch;
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : réception de ligne non re-parentée'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111'
     AND chantier_status = 'planification' AND planned_team_size = 2 AND planned_days = 3 AND equipment_order_status = 'recu';
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : colonnes chantier non recopiées'; END IF;

  -- Vue majordhome_chantiers
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_ch;
  IF v_amount <> 12800.76 THEN RAISE EXCEPTION 'GOUIN : montant attendu 12800.76, trouvé %', v_amount; END IF;
  IF v_bool THEN RAISE EXCEPTION 'GOUIN : is_invoiced doit être faux (PAC acceptée non facturée)'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_ch AND validated_quotes_count = 2 AND quotes_count = 2
     AND lead_chantiers_count = 1 AND has_active_rdv AND next_rdv_date = DATE '2026-09-18';
  IF n <> 1 THEN RAISE EXCEPTION 'GOUIN : colonnes dérivées de la vue incorrectes'; END IF;

  -- target_invoiced par chantier : rien de violet tant que la PAC n'est pas facturée
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_ch AND target_invoiced;
  IF n <> 0 THEN RAISE EXCEPTION 'target_invoiced : % RDV violets attendus 0', n; END IF;

  -- Miroirs updatable
  SELECT is_updatable INTO v_upd FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_appointments';
  IF v_upd IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'majordhome_appointments non updatable'; END IF;
  SELECT is_updatable INTO v_upd FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'majordhome_chantiers_write';
  IF v_upd IS DISTINCT FROM 'YES' THEN RAISE EXCEPTION 'majordhome_chantiers_write non updatable'; END IF;

  -- chantier_id en FIN de liste des deux vues étendues
  SELECT count(*) INTO n FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name IN ('majordhome_appointments', 'majordhome_lead_pennylane_quotes')
     AND c.column_name = 'chantier_id'
     AND c.ordinal_position = (SELECT max(ordinal_position) FROM information_schema.columns c2 WHERE c2.table_schema = c.table_schema AND c2.table_name = c.table_name);
  IF n <> 2 THEN RAISE EXCEPTION 'chantier_id doit être la dernière colonne des deux vues'; END IF;

  -- security_invoker
  SELECT count(*) INTO n FROM pg_class WHERE relnamespace = 'public'::regnamespace
     AND relname IN ('majordhome_chantiers', 'majordhome_chantiers_write', 'majordhome_appointments', 'majordhome_lead_pennylane_quotes')
     AND reloptions::text LIKE '%security_invoker=true%';
  IF n <> 4 THEN RAISE EXCEPTION 'security_invoker attendu sur 4 vues, trouvé %', n; END IF;

  -- RLS + ACL
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.chantiers'::regclass) THEN RAISE EXCEPTION 'RLS chantiers inactive'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'chantiers';
  IF n <> 2 THEN RAISE EXCEPTION 'policies chantiers attendues 2, trouvé %', n; END IF;
  IF has_table_privilege('anon', 'majordhome.chantiers', 'SELECT') THEN RAISE EXCEPTION 'anon lit chantiers'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.chantiers', 'INSERT') THEN RAISE EXCEPTION 'authenticated insère chantiers'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.chantiers', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur chantiers'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.majordhome_chantiers_write', 'UPDATE') THEN RAISE EXCEPTION 'authenticated sans UPDATE sur la vue write'; END IF;

  RAISE NOTICE 'assert-chantiers §A : OK';
END $$;
```

- [ ] **Step 7 : Répéter et boucler jusqu'au vert**

```bash
node scripts/migration-rehearsal/run.mjs --migration scripts/migration-rehearsal/fixture-chantiers.sql --migration supabase/migrations/20260930_16_chantiers_entite.sql --assert scripts/migration-rehearsal/assert-chantiers.sql
```

Attendu : `assert-chantiers §A : OK`. Une colonne NOT NULL inconnue de la fixture → compléter la fixture. Une relation absente → étendre `snapshot.mjs` puis re-snapshot.

- [ ] **Step 8 : Vérifier les fins de ligne et committer**

```bash
file supabase/migrations/20260930_16_chantiers_entite.sql scripts/migration-rehearsal/fixture-chantiers.sql scripts/migration-rehearsal/assert-chantiers.sql
git add supabase/migrations/20260930_16_chantiers_entite.sql scripts/migration-rehearsal/
git commit -m "feat(chantiers): table majordhome.chantiers, reprise 1 chantier par lead, vues par chantier (migration 20260930_16 + harnais)"
```

---

### Task 2 : Migration 2 — trigger `chantier_ensure_for_quote` et RPC `ensure_for_lead` / `group` / `detach` / `delete`

**Files:**
- Create: `supabase/migrations/20260930_17_chantiers_rpc.sql`
- Modify: `scripts/migration-rehearsal/assert-chantiers.sql` (ajouter §B)

**Interfaces:**
- Consumes: Task 1 (table, colonnes, vues).
- Produces: trigger `trg_chantier_ensure_for_quote` ; `public.chantier_ensure_for_lead(p_lead_id uuid) RETURNS uuid` ; `public.chantier_group(p_target_id uuid, p_source_ids uuid[]) RETURNS jsonb {target_id, counts{quotes, appointments, line_receptions}}` ; `public.chantier_detach(p_chantier_id uuid, p_quote_ids uuid[], p_appointment_ids uuid[], p_move_planned_order boolean, p_label text) RETURNS jsonb {new_chantier_id, origin_chantier_id, counts{…}}` ; `public.chantier_delete(p_chantier_id uuid) RETURNS jsonb {deleted_id, quotes_released}`. Erreurs : `unauthenticated` (42501), `not_authorized` (42501), `chantier_not_found` / `lead_not_found` (P0002), `invalid_selection`, `different_lead`, `invalid_quotes`, `no_validated_quote_selected`, `origin_would_be_empty`, `invalid_appointments`, `has_validated_quotes`, `has_appointments`, `has_pv` (22023).

- [ ] **Step 1 : Écrire la migration** `supabase/migrations/20260930_17_chantiers_rpc.sql`

```sql
-- supabase/migrations/20260930_17_chantiers_rpc.sql
-- ============================================================================
-- Entité chantier — création automatique et gestes (spec 2026-09-30-chantier-entite-par-devis).
--   - trigger chantier_ensure_for_quote : un devis qui DEVIENT validé sans chantier en crée un
--     (règle « chaque devis accepté = 1 chantier »). AFTER → voit le statut final posé par
--     l'invariant BEFORE ; déclenché aussi sur is_winning_quote (lead_mark_won_with_quote ne
--     SET que cette colonne, l'invariant force accepted). Transition seulement : les vieux
--     devis facturés sans chantier (RENOU…) ne créent rien, comme ensure_winning_quotes.
--   - chantier_ensure_for_lead : gain sans devis Pennylane (appel front updateLeadStatus).
--   - chantier_group / chantier_detach / chantier_delete : gestes humains, role_can chantiers.edit.
-- Toutes SECURITY DEFINER, auth.uid() NULL refusé, gardes POSITIVES, REVOKE PUBLIC/anon.
-- Répétée sur scripts/migration-rehearsal/ (assert-chantiers.sql §B).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Trigger : un devis validé sans chantier → un chantier
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.chantier_ensure_for_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_lead  majordhome.leads%ROWTYPE;
  v_label text;
  v_id    uuid;
BEGIN
  IF NEW.ejected_at IS NOT NULL OR NEW.chantier_id IS NOT NULL THEN RETURN NULL; END IF;
  IF majordhome.quote_status_bucket(NEW.quote_status) <> 'validated' THEN RETURN NULL; END IF;
  -- Transition réelle uniquement (un UPDATE qui laisse le devis validé ne crée rien).
  IF TG_OP = 'UPDATE' AND OLD.ejected_at IS NULL
     AND majordhome.quote_status_bucket(OLD.quote_status) = 'validated' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_lead FROM majordhome.leads WHERE id = NEW.lead_id;
  IF NOT FOUND OR COALESCE(v_lead.is_deleted, false) THEN RETURN NULL; END IF;

  SELECT NULLIF(trim(pq.pdf_invoice_subject), '') INTO v_label
    FROM majordhome.pennylane_quotes pq
   WHERE pq.org_id = NEW.org_id AND pq.pennylane_quote_id = NEW.pennylane_quote_id;

  INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, label, chantier_status, won_date, equipment_type_id)
  VALUES (NEW.org_id, NEW.lead_id, v_lead.client_id, v_label,
          CASE WHEN NEW.quote_status = 'invoiced' THEN 'facture' ELSE 'gagne' END,
          COALESCE(NEW.quote_date, current_date), v_lead.equipment_type_id)
  RETURNING id INTO v_id;

  -- chantier_id n'est pas dans la liste UPDATE OF du trigger : pas de récursion.
  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = v_id WHERE id = NEW.id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (NEW.lead_id, auth.uid(), 'chantier_created',
          'Chantier créé pour le devis ' || COALESCE(NEW.quote_label, NEW.pennylane_quote_id::text),
          jsonb_build_object('chantier_id', v_id, 'lead_quote_id', NEW.id, 'pennylane_quote_id', NEW.pennylane_quote_id),
          NEW.org_id);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_chantier_ensure_for_quote ON majordhome.lead_pennylane_quotes;
CREATE TRIGGER trg_chantier_ensure_for_quote
  AFTER INSERT OR UPDATE OF quote_status, ejected_at, is_winning_quote ON majordhome.lead_pennylane_quotes
  FOR EACH ROW EXECUTE FUNCTION majordhome.chantier_ensure_for_quote();

-- ----------------------------------------------------------------------------
-- 2. Gain sans devis : un chantier pour le lead s'il n'en a aucun
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_ensure_for_lead(p_lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_lead majordhome.leads%ROWTYPE;
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_lead FROM majordhome.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002'; END IF;
  IF (EXISTS (SELECT 1 FROM core.organization_members om WHERE om.org_id = v_lead.org_id AND om.user_id = v_user)) IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_id FROM majordhome.chantiers WHERE lead_id = p_lead_id ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, chantier_status, won_date, equipment_type_id)
  VALUES (v_lead.org_id, p_lead_id, v_lead.client_id, 'gagne', COALESCE(v_lead.won_date, current_date), v_lead.equipment_type_id)
  RETURNING id INTO v_id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (p_lead_id, v_user, 'chantier_created', 'Chantier créé (gain sans devis Pennylane)',
          jsonb_build_object('chantier_id', v_id), v_lead.org_id);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chantier_ensure_for_lead(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_ensure_for_lead(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Helpers privés : rang de statut, appro la moins avancée
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.chantier_status_rank(p_status text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  SELECT CASE p_status
    WHEN 'gagne' THEN 1 WHEN 'commande_a_faire' THEN 2 WHEN 'commande_recue' THEN 3
    WHEN 'planification' THEN 4 WHEN 'realise' THEN 5 WHEN 'facture' THEN 6 ELSE 0 END;
$function$;

CREATE OR REPLACE FUNCTION majordhome.order_status_min(p_a text, p_b text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  -- na < commande < recu ; NULL ignoré ('recu' seulement si tous 'recu').
  SELECT CASE
    WHEN p_a IS NULL THEN p_b
    WHEN p_b IS NULL THEN p_a
    WHEN p_a = 'na' OR p_b = 'na' THEN 'na'
    WHEN p_a = 'commande' OR p_b = 'commande' THEN 'commande'
    ELSE 'recu' END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Grouper : les sources rejoignent la cible (même lead), puis disparaissent
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_group(p_target_id uuid, p_source_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_t    majordhome.chantiers%ROWTYPE;
  v_s    majordhome.chantiers%ROWTYPE;
  v_sid  uuid;
  n int; n_q int := 0; n_a int := 0; n_r int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_target_id IS NULL OR p_source_ids IS NULL OR cardinality(p_source_ids) = 0 OR p_target_id = ANY (p_source_ids) THEN
    RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM majordhome.chantiers WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.role_can(v_t.org_id, 'chantiers', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  FOREACH v_sid IN ARRAY p_source_ids LOOP
    SELECT * INTO v_s FROM majordhome.chantiers WHERE id = v_sid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
    IF v_s.lead_id <> v_t.lead_id OR v_s.org_id <> v_t.org_id THEN
      RAISE EXCEPTION 'different_lead' USING ERRCODE = '22023';
    END IF;

    UPDATE majordhome.lead_pennylane_quotes SET chantier_id = p_target_id WHERE chantier_id = v_sid;
    GET DIAGNOSTICS n = ROW_COUNT; n_q := n_q + n;
    UPDATE majordhome.appointments SET chantier_id = p_target_id WHERE chantier_id = v_sid;
    GET DIAGNOSTICS n = ROW_COUNT; n_a := n_a + n;
    UPDATE majordhome.chantier_line_receptions SET chantier_id = p_target_id WHERE chantier_id = v_sid;
    GET DIAGNOSTICS n = ROW_COUNT; n_r := n_r + n;

    -- Complément additif : la cible garde ses valeurs, ses vides sont repris de la source.
    v_t.label              := COALESCE(NULLIF(v_t.label, ''), NULLIF(v_s.label, ''));
    v_t.planned_team_size  := COALESCE(v_t.planned_team_size, v_s.planned_team_size);
    v_t.planned_days       := COALESCE(v_t.planned_days, v_s.planned_days);
    v_t.estimated_date     := COALESCE(v_t.estimated_date, v_s.estimated_date);
    v_t.equipment_type_id  := COALESCE(v_t.equipment_type_id, v_s.equipment_type_id);
    v_t.pv_reception_path  := COALESCE(v_t.pv_reception_path, v_s.pv_reception_path);
    v_t.planification_date := LEAST(v_t.planification_date, v_s.planification_date);
    v_t.won_date           := LEAST(v_t.won_date, v_s.won_date);
    v_t.equipment_order_status := majordhome.order_status_min(v_t.equipment_order_status, v_s.equipment_order_status);
    v_t.materials_order_status := majordhome.order_status_min(v_t.materials_order_status, v_s.materials_order_status);
    IF majordhome.chantier_status_rank(v_s.chantier_status) > majordhome.chantier_status_rank(v_t.chantier_status) THEN
      v_t.chantier_status := v_s.chantier_status;
    END IF;
    IF NULLIF(v_s.chantier_notes, '') IS NOT NULL THEN
      v_t.chantier_notes := concat_ws(E'\n', NULLIF(v_t.chantier_notes, ''),
        '— groupé depuis ' || COALESCE(NULLIF(v_s.label, ''), v_sid::text) || ' —', v_s.chantier_notes);
    END IF;

    DELETE FROM majordhome.chantiers WHERE id = v_sid;
  END LOOP;

  UPDATE majordhome.chantiers SET
    label = v_t.label, planned_team_size = v_t.planned_team_size, planned_days = v_t.planned_days,
    estimated_date = v_t.estimated_date, equipment_type_id = v_t.equipment_type_id,
    pv_reception_path = v_t.pv_reception_path, planification_date = v_t.planification_date,
    won_date = v_t.won_date, equipment_order_status = v_t.equipment_order_status,
    materials_order_status = v_t.materials_order_status, chantier_status = v_t.chantier_status,
    chantier_notes = v_t.chantier_notes
  WHERE id = p_target_id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (v_t.lead_id, v_user, 'chantier_grouped',
          'Chantiers groupés : ' || cardinality(p_source_ids) || ' carte(s) réunie(s) (' || n_q || ' devis, ' || n_a || ' RDV)',
          jsonb_build_object('target_id', p_target_id, 'source_ids', to_jsonb(p_source_ids),
                             'counts', jsonb_build_object('quotes', n_q, 'appointments', n_a, 'line_receptions', n_r)),
          v_t.org_id);

  RETURN jsonb_build_object('target_id', p_target_id,
    'counts', jsonb_build_object('quotes', n_q, 'appointments', n_a, 'line_receptions', n_r));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chantier_group(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_group(uuid, uuid[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Détacher : des devis (+ RDV, + commande) partent dans un nouveau chantier
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_detach(
  p_chantier_id uuid, p_quote_ids uuid[], p_appointment_ids uuid[], p_move_planned_order boolean, p_label text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_c      majordhome.chantiers%ROWTYPE;
  v_appts  uuid[] := COALESCE(p_appointment_ids, '{}'::uuid[]);
  v_new    uuid;
  v_label  text;
  v_won    date;
  v_all_invoiced boolean;
  v_status text;
  n int; n_q int; n_a int; n_r int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_chantier_id IS NULL OR p_quote_ids IS NULL OR cardinality(p_quote_ids) = 0 THEN
    RAISE EXCEPTION 'invalid_selection' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_c FROM majordhome.chantiers WHERE id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.role_can(v_c.org_id, 'chantiers', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Validations
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes
   WHERE id = ANY (p_quote_ids) AND chantier_id = p_chantier_id AND ejected_at IS NULL;
  IF n <> cardinality(p_quote_ids) THEN RAISE EXCEPTION 'invalid_quotes' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes
   WHERE id = ANY (p_quote_ids) AND majordhome.quote_status_bucket(quote_status) = 'validated';
  IF n = 0 THEN RAISE EXCEPTION 'no_validated_quote_selected' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_pennylane_quotes
   WHERE chantier_id = p_chantier_id AND ejected_at IS NULL AND id <> ALL (p_quote_ids)
     AND majordhome.quote_status_bucket(quote_status) = 'validated';
  IF n = 0 THEN RAISE EXCEPTION 'origin_would_be_empty' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments
   WHERE id = ANY (v_appts) AND chantier_id = p_chantier_id AND appointment_type = 'installation'
     AND status <> ALL (ARRAY['cancelled', 'no_show']);
  IF n <> cardinality(v_appts) THEN RAISE EXCEPTION 'invalid_appointments' USING ERRCODE = '22023'; END IF;

  -- Libellé, date de gain, statut du nouveau chantier
  SELECT NULLIF(trim(pq.pdf_invoice_subject), ''), q.quote_date INTO v_label, v_won
    FROM majordhome.lead_pennylane_quotes q
    LEFT JOIN majordhome.pennylane_quotes pq ON pq.org_id = q.org_id AND pq.pennylane_quote_id = q.pennylane_quote_id
   WHERE q.id = ANY (p_quote_ids) AND majordhome.quote_status_bucket(q.quote_status) = 'validated'
   ORDER BY q.pennylane_quote_id DESC LIMIT 1;
  v_label := COALESCE(NULLIF(trim(p_label), ''), v_label);
  SELECT bool_and(quote_status = 'invoiced') INTO v_all_invoiced
    FROM majordhome.lead_pennylane_quotes
   WHERE id = ANY (p_quote_ids) AND majordhome.quote_status_bucket(quote_status) = 'validated';
  v_status := CASE WHEN v_all_invoiced THEN 'facture'
                   WHEN cardinality(v_appts) > 0 THEN 'planification'
                   ELSE 'gagne' END;

  INSERT INTO majordhome.chantiers (org_id, lead_id, client_id, label, chantier_status, planification_date, won_date,
                                    equipment_type_id, planned_team_size, planned_days)
  VALUES (v_c.org_id, v_c.lead_id, v_c.client_id, v_label, v_status,
          CASE WHEN v_status = 'planification' THEN current_date END,
          COALESCE(v_won, current_date), v_c.equipment_type_id,
          CASE WHEN p_move_planned_order THEN v_c.planned_team_size END,
          CASE WHEN p_move_planned_order THEN v_c.planned_days END)
  RETURNING id INTO v_new;

  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = v_new WHERE id = ANY (p_quote_ids);
  GET DIAGNOSTICS n_q = ROW_COUNT;
  UPDATE majordhome.chantier_line_receptions SET chantier_id = v_new
   WHERE chantier_id = p_chantier_id
     AND pennylane_quote_id IN (SELECT pennylane_quote_id FROM majordhome.lead_pennylane_quotes WHERE id = ANY (p_quote_ids));
  GET DIAGNOSTICS n_r = ROW_COUNT;
  UPDATE majordhome.appointments SET chantier_id = v_new WHERE id = ANY (v_appts);
  GET DIAGNOSTICS n_a = ROW_COUNT;
  IF p_move_planned_order THEN
    UPDATE majordhome.chantiers SET planned_team_size = NULL, planned_days = NULL WHERE id = p_chantier_id;
  END IF;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (v_c.lead_id, v_user, 'chantier_detached',
          'Chantier détaché : ' || n_q || ' devis, ' || n_a || ' RDV vers « ' || COALESCE(v_label, 'nouveau chantier') || ' »',
          jsonb_build_object('origin_chantier_id', p_chantier_id, 'new_chantier_id', v_new,
                             'quote_ids', to_jsonb(p_quote_ids), 'appointment_ids', to_jsonb(v_appts),
                             'moved_planned_order', p_move_planned_order),
          v_c.org_id);

  RETURN jsonb_build_object('new_chantier_id', v_new, 'origin_chantier_id', p_chantier_id,
    'counts', jsonb_build_object('quotes', n_q, 'appointments', n_a, 'line_receptions', n_r));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chantier_detach(uuid, uuid[], uuid[], boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_detach(uuid, uuid[], uuid[], boolean, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Supprimer un chantier vide (aucun devis validé, aucun RDV actif, pas de PV)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chantier_delete(p_chantier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_c    majordhome.chantiers%ROWTYPE;
  n_q int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_c FROM majordhome.chantiers WHERE id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'chantier_not_found' USING ERRCODE = 'P0002'; END IF;
  IF majordhome.role_can(v_c.org_id, 'chantiers', 'edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.lead_pennylane_quotes WHERE chantier_id = p_chantier_id AND ejected_at IS NULL
              AND majordhome.quote_status_bucket(quote_status) = 'validated') THEN
    RAISE EXCEPTION 'has_validated_quotes' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.appointments WHERE chantier_id = p_chantier_id
              AND status <> ALL (ARRAY['cancelled', 'no_show'])) THEN
    RAISE EXCEPTION 'has_appointments' USING ERRCODE = '22023';
  END IF;
  IF v_c.pv_reception_path IS NOT NULL THEN RAISE EXCEPTION 'has_pv' USING ERRCODE = '22023'; END IF;

  UPDATE majordhome.lead_pennylane_quotes SET chantier_id = NULL WHERE chantier_id = p_chantier_id;
  GET DIAGNOSTICS n_q = ROW_COUNT;
  DELETE FROM majordhome.chantiers WHERE id = p_chantier_id;

  INSERT INTO majordhome.lead_activities (lead_id, user_id, activity_type, description, metadata, org_id)
  VALUES (v_c.lead_id, v_user, 'chantier_deleted',
          'Chantier supprimé « ' || COALESCE(v_c.label, v_c.id::text) || ' » (' || n_q || ' devis non validés libérés)',
          jsonb_build_object('chantier_id', p_chantier_id, 'snapshot', to_jsonb(v_c)), v_c.org_id);

  RETURN jsonb_build_object('deleted_id', p_chantier_id, 'quotes_released', n_q);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.chantier_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chantier_delete(uuid) TO authenticated;
```

- [ ] **Step 2 : Ajouter les assertions §B** en fin de `assert-chantiers.sql`

```sql
-- ── §B Trigger + RPC (20260930_17) ─────────────────────────────────────────────
DO $$
DECLARE
  v_admin uuid; v_origin uuid; v_new uuid; v_ch2 uuid; v_lead2 uuid; v_res jsonb; n int; v_label text; v_status text;
  v_amount numeric; v_bool boolean;
BEGIN
  SELECT om.user_id INTO v_admin FROM core.organization_members om
   WHERE om.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' AND om.role = 'org_admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'aucun org_admin Mayer dans le snapshot'; END IF;
  SELECT id INTO v_origin FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';

  -- B1. Trigger : un devis en attente ne crée rien ; son passage en accepté crée un SECOND chantier
  INSERT INTO majordhome.lead_pennylane_quotes (id, org_id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, assigned_at)
  VALUES ('aaaa0001-0000-0000-0000-000000000009', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1', '11111111-1111-1111-1111-111111111111',
          40000000000001, 1447384297472, 4500, 'D-2026-09999', DATE '2026-10-01', 'pending', false, now());
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN RAISE EXCEPTION 'B1 : un devis en attente ne doit pas créer de chantier'; END IF;
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'accepted' WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : devis accepté → 2 chantiers attendus, trouvé %', n; END IF;
  SELECT c.id, c.label, c.chantier_status INTO v_ch2, v_label, v_status FROM majordhome.chantiers c
   JOIN majordhome.lead_pennylane_quotes q ON q.chantier_id = c.id WHERE q.id = 'aaaa0001-0000-0000-0000-000000000009';
  IF v_label <> 'Poêle à granulés' OR v_status <> 'gagne' THEN RAISE EXCEPTION 'B1 : label/statut du chantier créé (% / %)', v_label, v_status; END IF;
  SELECT count(*) INTO n FROM majordhome.lead_activities WHERE lead_id = '11111111-1111-1111-1111-111111111111' AND activity_type = 'chantier_created';
  IF n <> 1 THEN RAISE EXCEPTION 'B1 : activité chantier_created attendue'; END IF;
  -- Un UPDATE qui laisse le devis validé ne crée rien de plus (cron accepted → invoiced)
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'invoiced' WHERE id = 'aaaa0001-0000-0000-0000-000000000009';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 2 THEN RAISE EXCEPTION 'B1 : transition validé→validé ne doit rien créer'; END IF;
  -- RENOU : vieux devis facturé, retouché par le cron, toujours aucun chantier
  UPDATE majordhome.lead_pennylane_quotes SET quote_status = 'invoiced' WHERE id = 'aaaa0003-0000-0000-0000-000000000001';
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '33333333-3333-3333-3333-333333333333';
  IF n <> 0 THEN RAISE EXCEPTION 'B1 : RENOU ne doit pas recevoir de chantier rétroactif'; END IF;

  -- B2. Gardes : non authentifié, puis membre inconnu
  BEGIN
    PERFORM public.chantier_group(v_origin, ARRAY[v_ch2]);
    RAISE EXCEPTION 'B2 : chantier_group sans auth.uid() devait échouer';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.chantier_group(v_origin, ARRAY[v_ch2]);
    RAISE EXCEPTION 'B2 : chantier_group par un non-membre devait échouer';
  EXCEPTION WHEN sqlstate '42501' THEN NULL; END;

  -- B3. org_admin : détacher la PAC + 3 RDV de novembre + commande
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000003'::uuid], '{}'::uuid[], false, NULL);
    RAISE EXCEPTION 'B3 : détacher un devis refusé seul devait échouer';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN
    PERFORM public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000001'::uuid, 'aaaa0001-0000-0000-0000-000000000002'::uuid], '{}'::uuid[], false, NULL);
    RAISE EXCEPTION 'B3 : vider l''origine devait échouer';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  v_res := public.chantier_detach(v_origin, ARRAY['aaaa0001-0000-0000-0000-000000000002'::uuid],
             ARRAY['bbbb0001-0000-0000-0000-000000000002'::uuid, 'bbbb0001-0000-0000-0000-000000000003'::uuid, 'bbbb0001-0000-0000-0000-000000000004'::uuid],
             true, NULL);
  v_new := (v_res->>'new_chantier_id')::uuid;
  IF (v_res->'counts'->>'quotes')::int <> 1 OR (v_res->'counts'->>'appointments')::int <> 3 OR (v_res->'counts'->>'line_receptions')::int <> 1 THEN
    RAISE EXCEPTION 'B3 : compteurs de détachement %', v_res;
  END IF;
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_origin;
  IF v_amount <> 1260.76 OR NOT v_bool THEN RAISE EXCEPTION 'B3 : origine attendue 1260.76 facturée, trouvé % / %', v_amount, v_bool; END IF;
  SELECT linked_quotes_amount_ht, is_invoiced INTO v_amount, v_bool FROM public.majordhome_chantiers WHERE id = v_new;
  IF v_amount <> 11540 OR v_bool THEN RAISE EXCEPTION 'B3 : nouveau attendu 11540 non facturé, trouvé % / %', v_amount, v_bool; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_new AND chantier_status = 'planification'
     AND planned_team_size = 2 AND planned_days = 3 AND label = 'Installation d''une pompe à chaleur DAIKIN' AND won_date = DATE '2026-09-30';
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : nouveau chantier (statut / commande / libellé / won_date) incorrect'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_origin AND planned_team_size IS NULL AND planned_days IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : la commande devait quitter l''origine'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_origin AND target_invoiced;
  IF n <> 1 THEN RAISE EXCEPTION 'B3 : le RDV de la borne doit être violet'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_appointments WHERE chantier_id = v_new AND target_invoiced;
  IF n <> 0 THEN RAISE EXCEPTION 'B3 : les RDV de la PAC ne doivent pas être violets'; END IF;
  SELECT lead_chantiers_count INTO n FROM public.majordhome_chantiers WHERE id = v_new;
  IF n <> 3 THEN RAISE EXCEPTION 'B3 : lead_chantiers_count attendu 3, trouvé %', n; END IF;

  -- B4. Supprimer refusé (RDV / devis validé), puis grouper le tout → 1 chantier, commande revenue
  BEGIN
    PERFORM public.chantier_delete(v_new);
    RAISE EXCEPTION 'B4 : chantier_delete avec devis validé devait échouer';
  EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  v_res := public.chantier_group(v_origin, ARRAY[v_new, v_ch2]);
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '11111111-1111-1111-1111-111111111111';
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : après groupement 1 chantier attendu, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.appointments WHERE chantier_id = v_origin;
  IF n <> 4 THEN RAISE EXCEPTION 'B4 : 4 RDV attendus sur la cible, trouvé %', n; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE id = v_origin AND planned_team_size = 2 AND planned_days = 3 AND chantier_status = 'planification';
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : la cible doit reprendre commande et statut le plus avancé'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_chantiers WHERE id = v_origin AND validated_quotes_count = 3 AND linked_quotes_amount_ht = 17300.76;
  IF n <> 1 THEN RAISE EXCEPTION 'B4 : 3 devis validés / 17300.76 attendus sur la cible'; END IF;

  -- B5. Gain sans devis : ensure_for_lead crée, puis renvoie le même id
  v_lead2 := public.chantier_ensure_for_lead('22222222-2222-2222-2222-222222222222');
  IF v_lead2 <> public.chantier_ensure_for_lead('22222222-2222-2222-2222-222222222222') THEN RAISE EXCEPTION 'B5 : ensure_for_lead non idempotent'; END IF;
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '22222222-2222-2222-2222-222222222222' AND chantier_status = 'gagne';
  IF n <> 1 THEN RAISE EXCEPTION 'B5 : chantier sans devis attendu'; END IF;
  -- vide → supprimable
  v_res := public.chantier_delete(v_lead2);
  SELECT count(*) INTO n FROM majordhome.chantiers WHERE lead_id = '22222222-2222-2222-2222-222222222222';
  IF n <> 0 THEN RAISE EXCEPTION 'B5 : chantier_delete n''a pas supprimé'; END IF;

  -- B6. ACL des RPC
  IF has_function_privilege('anon', 'public.chantier_ensure_for_lead(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_group(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_detach(uuid, uuid[], uuid[], boolean, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.chantier_delete(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B6 : une RPC chantier est exécutable par anon';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RAISE NOTICE 'assert-chantiers §B : OK';
END $$;
```

- [ ] **Step 3 : Répéter**

```bash
node scripts/migration-rehearsal/run.mjs --migration scripts/migration-rehearsal/fixture-chantiers.sql --migration supabase/migrations/20260930_16_chantiers_entite.sql --migration supabase/migrations/20260930_17_chantiers_rpc.sql --assert scripts/migration-rehearsal/assert-chantiers.sql
```

Attendu : `§A : OK` puis `§B : OK`. Si `user_effective_role` échoue faute d'une colonne de `core.profiles`, la table est déjà complète (`columns: null`) ; si c'est `majordhome.role_permissions`, elle est ajoutée en Task 1 Step 1.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260930_17_chantiers_rpc.sql scripts/migration-rehearsal/assert-chantiers.sql
git commit -m "feat(chantiers): trigger un devis validé = un chantier, RPC ensure/group/detach/delete (20260930_17)"
```

---

### Task 3 : Migration 3 — `lead_merge` re-parente les chantiers

**Files:**
- Create: `supabase/migrations/20260930_18_lead_merge_chantiers.sql`
- Modify: `scripts/migration-rehearsal/assert-chantiers.sql` (§C)

- [ ] **Step 1 : Vérifier que le repo reflète la prod**

Dans le SQL Editor / MCP (lecture seule) : `SELECT pg_get_functiondef('public.lead_merge(uuid, uuid)'::regprocedure);` et comparer au corps de `supabase/migrations/20260916_2_lead_merge.sql`. Si le texte diffère ailleurs que par la mise en forme, partir du texte PROD.

- [ ] **Step 2 : Écrire la migration** : copie intégrale de `20260916_2_lead_merge.sql` (en-tête adapté : « 20260930_18 — lead_merge : re-parentage des chantiers ») avec trois modifications :

1. Dans le `jsonb_build_object` des compteurs, remplacer la ligne `'line_receptions', (SELECT count(*) FROM majordhome.chantier_line_receptions WHERE chantier_id = p_absorbed_id)` par :

```sql
    'chantiers',          (SELECT count(*) FROM majordhome.chantiers              WHERE lead_id = p_absorbed_id)
```

2. Dans le bloc « Re-parentage », remplacer `UPDATE majordhome.chantier_line_receptions SET chantier_id = p_survivor_id WHERE chantier_id = p_absorbed_id;` par :

```sql
  -- Les chantiers suivent le lead (les réceptions de lignes suivent leur chantier).
  UPDATE majordhome.chantiers               SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id;
```

3. Conserver en fin de fichier les `REVOKE EXECUTE … FROM PUBLIC, anon; GRANT … TO authenticated;` du fichier d'origine.

- [ ] **Step 3 : Assertions §C** en fin de `assert-chantiers.sql`

```sql
-- ── §C lead_merge (20260930_18) ────────────────────────────────────────────────
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.lead_merge(uuid, uuid)'::regprocedure) INTO v_def;
  IF v_def NOT LIKE '%UPDATE majordhome.chantiers%SET lead_id = p_survivor_id%' THEN
    RAISE EXCEPTION 'lead_merge ne re-parente pas majordhome.chantiers';
  END IF;
  IF v_def LIKE '%chantier_line_receptions SET chantier_id = p_survivor_id%' THEN
    RAISE EXCEPTION 'lead_merge re-parente encore chantier_line_receptions par lead';
  END IF;
  IF has_function_privilege('anon', 'public.lead_merge(uuid, uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'lead_merge exécutable par anon'; END IF;
  RAISE NOTICE 'assert-chantiers §C : OK';
END $$;
```

- [ ] **Step 4 : Répéter les trois migrations, puis committer**

```bash
node scripts/migration-rehearsal/run.mjs --migration scripts/migration-rehearsal/fixture-chantiers.sql --migration supabase/migrations/20260930_16_chantiers_entite.sql --migration supabase/migrations/20260930_17_chantiers_rpc.sql --migration supabase/migrations/20260930_18_lead_merge_chantiers.sql --assert scripts/migration-rehearsal/assert-chantiers.sql
git add supabase/migrations/20260930_18_lead_merge_chantiers.sql scripts/migration-rehearsal/assert-chantiers.sql
git commit -m "feat(chantiers): lead_merge re-parente les chantiers (20260930_18)"
```

---

### Task 4 : Module pur `chantierSplit.js` + tests

**Files:**
- Create: `src/lib/chantierSplit.js`
- Create: `scripts/chantier-split.test.mjs`
- Modify: `package.json:13` (`audit:quality` : ajouter `scripts/chantier-split.test.mjs` après `scripts/install-order.test.mjs`)

**Interfaces:**
- Produces: `STATUT_ORDRE` ; `resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds, appointmentIds, movePlannedOrder })` → `{ origine: { montant, jours, devis }, nouveau: { montant, jours, devis }, erreurs: string[], ok: boolean }` ; `commandeSuitParDefaut(plannedOrder, joursSelectionnes)` → boolean ; `resumeGroupement(cible, sources)` → `{ montant, devis, devisValides, statut }`. Entrées : `quotes` = lignes de `majordhome_lead_pennylane_quotes` (`id, is_validated, quote_amount_ht`), `appointments` = lignes RDV (`id, scheduled_date`), `cible`/`sources` = lignes de `majordhome_chantiers` (`linked_quotes_amount_ht, quotes_count, validated_quotes_count, chantier_status`).

- [ ] **Step 1 : Écrire les tests** `scripts/chantier-split.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resumeDetachement, commandeSuitParDefaut, resumeGroupement, STATUT_ORDRE,
} from '../src/lib/chantierSplit.js';

// Cas GOUIN : borne facturée (q1), PAC acceptée (q2), variante refusée (q3) ; 1 RDV de septembre, 3 de novembre.
const quotes = [
  { id: 'q1', is_validated: true, quote_amount_ht: '1260.76' },
  { id: 'q2', is_validated: true, quote_amount_ht: 11540 },
  { id: 'q3', is_validated: false, quote_amount_ht: 10240.34 },
];
const appointments = [
  { id: 'a1', scheduled_date: '2026-09-18' },
  { id: 'a2', scheduled_date: '2026-11-03' },
  { id: 'a3', scheduled_date: '2026-11-04' },
  { id: 'a4', scheduled_date: '2026-11-05' },
];
const plannedOrder = { teamSize: 2, days: 3 };

test('resumeDetachement : PAC + 3 jours → deux colonnes justes, ok', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q2'], appointmentIds: ['a2', 'a3', 'a4'], movePlannedOrder: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.nouveau, { montant: 11540, jours: 3, devis: 1 });
  assert.deepEqual(r.origine, { montant: 1260.76, jours: 1, devis: 2 });
});

test('resumeDetachement : le devis refusé peut accompagner sans compter dans le montant', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q2', 'q3'], appointmentIds: [], movePlannedOrder: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.nouveau, { montant: 11540, jours: 0, devis: 2 });
  assert.deepEqual(r.origine, { montant: 1260.76, jours: 4, devis: 1 });
});

test('resumeDetachement : sélection vide', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: [], appointmentIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Choisissez au moins un devis validé à détacher.']);
});

test('resumeDetachement : aucun devis validé sélectionné', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q3'], appointmentIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Choisissez au moins un devis validé à détacher.']);
});

test('resumeDetachement : l’origine doit garder un devis validé', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q1', 'q2'], appointmentIds: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Le chantier d’origine doit garder au moins un devis validé.']);
});

test('resumeDetachement : devis ou RDV inconnus du chantier', () => {
  const r = resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds: ['q2', 'zz'], appointmentIds: ['a2', 'nope'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.erreurs, ['Un devis sélectionné n’appartient pas à ce chantier.', 'Un jour sélectionné n’appartient pas à ce chantier.']);
});

test('resumeDetachement : deux RDV le même jour comptent pour un jour', () => {
  const r = resumeDetachement(
    { quotes, appointments: [...appointments, { id: 'a5', scheduled_date: '2026-11-03' }], plannedOrder },
    { quoteIds: ['q2'], appointmentIds: ['a2', 'a5'] },
  );
  assert.equal(r.nouveau.jours, 1);
});

test('commandeSuitParDefaut : vrai quand les jours sélectionnés valent planned_days', () => {
  assert.equal(commandeSuitParDefaut({ teamSize: 2, days: 3 }, 3), true);
  assert.equal(commandeSuitParDefaut({ teamSize: 2, days: 3 }, 1), false);
  assert.equal(commandeSuitParDefaut({ teamSize: null, days: null }, 3), false);
  assert.equal(commandeSuitParDefaut(null, 0), false);
});

test('resumeGroupement : montants et devis additionnés, statut le plus avancé', () => {
  const cible = { linked_quotes_amount_ht: '1260.76', quotes_count: 1, validated_quotes_count: 1, chantier_status: 'facture' };
  const s1 = { linked_quotes_amount_ht: 11540, quotes_count: 2, validated_quotes_count: 1, chantier_status: 'planification' };
  const s2 = { linked_quotes_amount_ht: 0, quotes_count: 0, validated_quotes_count: 0, chantier_status: 'gagne' };
  assert.deepEqual(resumeGroupement(cible, [s1, s2]), { montant: 12800.76, devis: 3, devisValides: 2, statut: 'facture' });
  assert.deepEqual(resumeGroupement(s2, [s1]), { montant: 11540, devis: 2, devisValides: 1, statut: 'planification' });
});

test('STATUT_ORDRE : gagne < … < facture', () => {
  assert.deepEqual(STATUT_ORDRE, ['gagne', 'commande_a_faire', 'commande_recue', 'planification', 'realise', 'facture']);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec** (`Cannot find module`)

```bash
node --test scripts/chantier-split.test.mjs
```

- [ ] **Step 3 : Écrire le module** `src/lib/chantierSplit.js`

```js
/**
 * chantierSplit.js — règles d'aperçu des gestes Grouper / Détacher d'un chantier.
 * ============================================================================
 * Module PUR (aucun import React / Supabase) : testé par `scripts/chantier-split.test.mjs`
 * (inclus dans `audit:quality`). Les RPC `chantier_detach` / `chantier_group` portent les
 * MÊMES règles côté base ; ce module ne fait que prévenir l'utilisateur avant l'appel.
 *
 * Spec : docs/superpowers/specs/2026-09-30-chantier-entite-par-devis-design.md
 * ============================================================================
 */

/** Ordre des statuts chantier (même rang que majordhome.chantier_status_rank). */
export const STATUT_ORDRE = ['gagne', 'commande_a_faire', 'commande_recue', 'planification', 'realise', 'facture'];

function montantDe(quotes) {
  return Math.round(
    quotes.filter((q) => q?.is_validated).reduce((acc, q) => acc + (Number(q.quote_amount_ht) || 0), 0) * 100,
  ) / 100;
}

function joursDe(appointments) {
  return new Set(appointments.map((a) => a?.scheduled_date).filter(Boolean)).size;
}

/**
 * Aperçu d'un détachement : ce qui reste sur l'origine, ce qui part dans le nouveau chantier.
 * @param {{quotes: Array<{id: string, is_validated?: boolean, quote_amount_ht?: number|string}>, appointments: Array<{id: string, scheduled_date?: string}>, plannedOrder?: {teamSize?: number|null, days?: number|null}|null}} chantier
 * @param {{quoteIds?: string[], appointmentIds?: string[], movePlannedOrder?: boolean}} selection
 * @returns {{origine: {montant: number, jours: number, devis: number}, nouveau: {montant: number, jours: number, devis: number}, erreurs: string[], ok: boolean}}
 */
export function resumeDetachement(chantier, selection) {
  const quotes = Array.isArray(chantier?.quotes) ? chantier.quotes : [];
  const appointments = Array.isArray(chantier?.appointments) ? chantier.appointments : [];
  const quoteIds = new Set(selection?.quoteIds || []);
  const appointmentIds = new Set(selection?.appointmentIds || []);
  const erreurs = [];

  const quotesConnus = new Set(quotes.map((q) => q.id));
  const apptsConnus = new Set(appointments.map((a) => a.id));
  if ([...quoteIds].some((id) => !quotesConnus.has(id))) erreurs.push('Un devis sélectionné n’appartient pas à ce chantier.');
  if ([...appointmentIds].some((id) => !apptsConnus.has(id))) erreurs.push('Un jour sélectionné n’appartient pas à ce chantier.');

  const partent = quotes.filter((q) => quoteIds.has(q.id));
  const restent = quotes.filter((q) => !quoteIds.has(q.id));
  if (erreurs.length === 0) {
    if (!partent.some((q) => q.is_validated)) erreurs.push('Choisissez au moins un devis validé à détacher.');
    else if (!restent.some((q) => q.is_validated)) erreurs.push('Le chantier d’origine doit garder au moins un devis validé.');
  }

  const apptsPartent = appointments.filter((a) => appointmentIds.has(a.id));
  const apptsRestent = appointments.filter((a) => !appointmentIds.has(a.id));
  return {
    origine: { montant: montantDe(restent), jours: joursDe(apptsRestent), devis: restent.length },
    nouveau: { montant: montantDe(partent), jours: joursDe(apptsPartent), devis: partent.length },
    erreurs,
    ok: erreurs.length === 0,
  };
}

/**
 * La commande « personnes × jours » suit par défaut quand les jours sélectionnés valent `planned_days`.
 * @param {{teamSize?: number|null, days?: number|null}|null|undefined} plannedOrder
 * @param {number} joursSelectionnes
 * @returns {boolean}
 */
export function commandeSuitParDefaut(plannedOrder, joursSelectionnes) {
  const days = Number(plannedOrder?.days) || 0;
  return days > 0 && Number(joursSelectionnes) === days;
}

/**
 * Aperçu d'un groupement : cible + sources réunies (mêmes règles que chantier_group).
 * @param {{linked_quotes_amount_ht?: number|string, quotes_count?: number|string, validated_quotes_count?: number|string, chantier_status?: string}} cible
 * @param {Array<typeof cible>} sources
 * @returns {{montant: number, devis: number, devisValides: number, statut: string}}
 */
export function resumeGroupement(cible, sources) {
  const tous = [cible, ...(Array.isArray(sources) ? sources : [])].filter(Boolean);
  const montant = Math.round(tous.reduce((acc, c) => acc + (Number(c.linked_quotes_amount_ht) || 0), 0) * 100) / 100;
  const devis = tous.reduce((acc, c) => acc + (Number(c.quotes_count) || 0), 0);
  const devisValides = tous.reduce((acc, c) => acc + (Number(c.validated_quotes_count) || 0), 0);
  const statut = tous.reduce(
    (best, c) => (STATUT_ORDRE.indexOf(c.chantier_status) > STATUT_ORDRE.indexOf(best) ? c.chantier_status : best),
    cible?.chantier_status || 'gagne',
  );
  return { montant, devis, devisValides, statut };
}
```

- [ ] **Step 4 : Vérifier le vert, ajouter à `audit:quality`, committer**

```bash
node --test scripts/chantier-split.test.mjs
```

Dans `package.json`, insérer ` scripts/chantier-split.test.mjs` juste après `scripts/install-order.test.mjs` dans la commande `audit:quality`.

```bash
git add src/lib/chantierSplit.js scripts/chantier-split.test.mjs package.json
git commit -m "feat(chantiers): module pur chantierSplit (aperçu détacher / grouper) + tests"
```

---

### Task 5 : Service chantiers, cache keys, hooks (écriture via `majordhome_chantiers_write`, devis par chantier)

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js:104` (appointmentKeys.chantier), `:117-121` (chantierKeys), `:300` (pennylaneKeys)
- Modify: `src/shared/services/chantiers.service.js` (réécriture des mutations)
- Modify: `src/shared/hooks/useChantiers.js`
- Modify: `src/shared/services/pennylane.service.js:1199-1222` + export `:1917`
- Modify: `src/shared/hooks/usePennylane.js:336-402`

**Interfaces:**
- Produces: `chantiersService.getChantiersByClientId(clientId)` → `{ data: Array, error }` ; mutations `(orgId, chantierId, …)` : `updateChantierStatus`, `updateOrderStatus`, `updateEstimatedDate`, `updateChantierNotes`, `updatePlannedOrder`, `updateLabel(orgId, chantierId, label)`, `uploadPvReception(orgId, chantierId, file)`, `updatePvReceptionPath(orgId, chantierId, path)` ; RPC : `ensureChantierForLead(leadId)`, `groupChantiers(targetId, sourceIds)`, `detachChantier({ chantierId, quoteIds, appointmentIds, movePlannedOrder, label })`, `deleteChantier(chantierId)` — toutes `{ data, error }`.
- Hook `useChantierMutations()` : mêmes noms côté composants avec `(chantierId, …)` (orgId injecté), plus `updateLabel`, `groupChantiers`, `detachChantier`, `deleteChantier`, `isGrouping`, `isDetaching`, `isDeleting`.
- `useLinkedPennylaneQuotes(leadId, { chantierId })` : filtre `chantier_id` quand fourni ; key `pennylaneKeys.linkedQuotesByChantier(orgId, chantierId)`.
- `pennylaneKeys.linkedQuotes(orgId)` = préfixe commun invalidé par les mutations.

- [ ] **Step 1 : Cache keys**

`appointmentKeys.chantier` : renommer le paramètre (`(orgId, chantierId) => [...appointmentKeys.all(orgId), 'chantier', chantierId]`). `chantierKeys` : ajouter `byClient: (orgId, clientId) => [...chantierKeys.all(orgId), 'client', clientId]`. `pennylaneKeys` : remplacer la ligne `linkedQuotesByLead` par :

```js
  linkedQuotes: (orgId) => [...pennylaneKeys.all(orgId), 'linked-quotes'],
  linkedQuotesByLead: (orgId, leadId) => [...pennylaneKeys.linkedQuotes(orgId), leadId],
  linkedQuotesByChantier: (orgId, chantierId) => [...pennylaneKeys.linkedQuotes(orgId), 'chantier', chantierId],
```

- [ ] **Step 2 : Service** — remplacer tout `chantiers.service.js` à partir de la section « SERVICE PRINCIPAL » (garder constantes et helpers ; dans `CHANTIER_TRANSITIONS`, `facture: []`). En-tête : « Un chantier = une commande à exécuter (table majordhome.chantiers). Lectures : vue majordhome_chantiers (id = chantier). Écritures : vue miroir majordhome_chantiers_write (RLS role_can) ; gestes par RPC. » Retirer l'import `leadsService`.

```js
/**
 * Patch d'un chantier par la vue miroir updatable. `.eq('org_id')` = défense en profondeur ;
 * 0 ligne renvoyée = chantier inconnu OU RLS refusée → on le DIT (jamais de succès silencieux).
 */
async function patchChantier(orgId, chantierId, patch) {
  if (!orgId) throw new Error('[chantiers] orgId requis');
  if (!chantierId) throw new Error('[chantiers] chantierId requis');
  const { data, error } = await supabase
    .from('majordhome_chantiers_write')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', chantierId)
    .eq('org_id', orgId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('[chantiers] chantier introuvable ou modification refusée');
  return data;
}

async function rpc(name, params, label) {
  return withErrorHandling(async () => {
    const { data, error } = await supabase.rpc(name, params);
    if (error) throw error;
    return data;
  }, label);
}

export const chantiersService = {
  async getChantiers({ orgId, limit = 200 }) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[chantiers] orgId requis');
      const { data, error } = await supabase
        .from('majordhome_chantiers').select('*').eq('org_id', orgId)
        .order('won_date', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    }, 'chantiers.getChantiers');
  },

  /** Tous les chantiers d'un client (un client peut en porter plusieurs). */
  async getChantiersByClientId(clientId) {
    if (!clientId) return { data: [], error: null };
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_chantiers').select('*').eq('client_id', clientId)
        .order('won_date', { ascending: false });
      if (error) throw error;
      return data || [];
    }, 'chantiers.getChantiersByClientId');
  },

  async updateChantierStatus(orgId, chantierId, newStatus) {
    const validStatuses = CHANTIER_STATUSES.map((s) => s.value);
    if (!validStatuses.includes(newStatus)) throw new Error(`[chantiers] Statut invalide: ${newStatus}`);
    return withErrorHandling(async () => {
      const patch = { chantier_status: newStatus };
      if (newStatus === 'planification') patch.planification_date = new Date().toISOString().split('T')[0];
      return patchChantier(orgId, chantierId, patch);
    }, 'chantiers.updateChantierStatus');
  },

  async updateOrderStatus(orgId, chantierId, { equipmentOrderStatus, materialsOrderStatus, currentChantierStatus }) {
    const patch = {};
    if (equipmentOrderStatus !== undefined) patch.equipment_order_status = equipmentOrderStatus;
    if (materialsOrderStatus !== undefined) patch.materials_order_status = materialsOrderStatus;
    const allReceived = equipmentOrderStatus && materialsOrderStatus &&
      shouldAutoTransitionToCommandeRecue(equipmentOrderStatus, materialsOrderStatus);
    let autoTransitioned = false;
    if (currentChantierStatus === 'commande_a_faire' && allReceived) { patch.chantier_status = 'commande_recue'; autoTransitioned = true; }
    else if (currentChantierStatus === 'commande_recue' && !allReceived) { patch.chantier_status = 'commande_a_faire'; autoTransitioned = true; }
    const result = await withErrorHandling(() => patchChantier(orgId, chantierId, patch), 'chantiers.updateOrderStatus');
    return { ...result, autoTransitioned };
  },

  updateEstimatedDate: (orgId, chantierId, estimatedDate) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { estimated_date: estimatedDate || null }), 'chantiers.updateEstimatedDate'),
  updateChantierNotes: (orgId, chantierId, notes) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { chantier_notes: notes || null }), 'chantiers.updateChantierNotes'),
  updateLabel: (orgId, chantierId, label) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { label: (label || '').trim() || null }), 'chantiers.updateLabel'),
  updatePlannedOrder: (orgId, chantierId, { teamSize, days }) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { planned_team_size: teamSize ?? null, planned_days: days ?? null }), 'chantiers.updatePlannedOrder'),

  async uploadPvReception(orgId, chantierId, file) {
    if (!chantierId || !file) throw new Error('[chantiers] chantierId et file requis');
    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    const storagePath = `pv-reception/${chantierId}/PV_Reception_${Date.now()}.${ext}`;
    const { error: uploadError } = await storageService.uploadFile('interventions', storagePath, file, { upsert: true, contentType: file.type });
    if (uploadError) return { data: null, error: uploadError };
    return withErrorHandling(() => patchChantier(orgId, chantierId, { pv_reception_path: storagePath }), 'chantiers.uploadPvReception');
  },
  updatePvReceptionPath: (orgId, chantierId, storagePath) =>
    withErrorHandling(() => patchChantier(orgId, chantierId, { pv_reception_path: storagePath }), 'chantiers.updatePvReceptionPath'),
  async getPvReceptionUrl(pdfPath) {
    if (!pdfPath) return { url: null, error: null };
    return storageService.getSignedUrl('interventions', pdfPath);
  },

  // ── Gestes (RPC SECURITY DEFINER, garde role_can chantiers.edit côté base) ──
  ensureChantierForLead: (leadId) => rpc('chantier_ensure_for_lead', { p_lead_id: leadId }, 'chantiers.ensureChantierForLead'),
  groupChantiers: (targetId, sourceIds) => rpc('chantier_group', { p_target_id: targetId, p_source_ids: sourceIds }, 'chantiers.groupChantiers'),
  detachChantier: ({ chantierId, quoteIds, appointmentIds = [], movePlannedOrder = false, label = null }) =>
    rpc('chantier_detach', { p_chantier_id: chantierId, p_quote_ids: quoteIds, p_appointment_ids: appointmentIds, p_move_planned_order: movePlannedOrder, p_label: label }, 'chantiers.detachChantier'),
  deleteChantier: (chantierId) => rpc('chantier_delete', { p_chantier_id: chantierId }, 'chantiers.deleteChantier'),
};

export default chantiersService;
```

- [ ] **Step 3 : Hook `useChantiers.js`** — réécrire `useChantierMutations` : `orgId` depuis `useAuth()`, chaque `mutationFn` = `unwrapResult(chantiersService.xxx(orgId, chantierId, …))`, invalidation :

```js
  const invalidateChantiers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: chantierKeys.all(orgId) });
  }, [queryClient, orgId]);
  // Grouper / détacher / supprimer déplacent devis et RDV : invalidation croisée.
  const invalidateCroisee = useCallback(() => {
    invalidateChantiers();
    queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: pennylaneKeys.linkedQuotes(orgId) });
    queryClient.invalidateQueries({ queryKey: leadKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: kanbanCardKeys.all(orgId) });
  }, [invalidateChantiers, queryClient, orgId]);
```

Imports : `import { chantierKeys, appointmentKeys, pennylaneKeys, leadKeys, kanbanCardKeys } from '@hooks/cacheKeys';`. Mutations ajoutées : `labelMutation` (`updateLabel`), `groupMutation`, `detachMutation`, `deleteMutation` (onSuccess `invalidateCroisee`). `orderMutation` : `mutationFn: ({ chantierId, ...params }) => chantiersService.updateOrderStatus(orgId, chantierId, params)` (garde le retour `{ data, error, autoTransitioned }`, lu par `ChantierReceptionSection`). Exposer : `updateChantierStatus(chantierId, newStatus)`, `updateOrderStatus(chantierId, params)`, `updateEstimatedDate`, `updateChantierNotes`, `updateLabel(chantierId, label)`, `updatePlannedOrder`, `uploadPvReception`, `groupChantiers(targetId, sourceIds)`, `detachChantier(params)`, `deleteChantier(chantierId)`, états `isUpdatingStatus`, `isUpdatingOrder`, `isUploadingPv`, `isGrouping`, `isDetaching`, `isDeleting`, `invalidate`.

- [ ] **Step 4 : Devis liés par chantier** — `pennylane.service.js` :

```js
async function getLinkedQuotesByLead(leadId, { chantierId = null } = {}) {
  let query = supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('id, lead_id, chantier_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, is_validated, assigned_at, pdf_url')
    .eq('lead_id', leadId)
    .is('ejected_at', null);
  if (chantierId) query = query.eq('chantier_id', chantierId);
  const { data, error } = await query
    .order('quote_date', { ascending: false, nullsFirst: false })
    .order('assigned_at', { ascending: true });
```

(suite inchangée). Export : `getLinkedQuotesByLead: (leadId, opts) => withErrorHandling(() => getLinkedQuotesByLead(leadId, opts), 'pennylane.getLinkedQuotesByLead')`.

`usePennylane.js` : `useLinkedPennylaneQuotes(leadId, { chantierId = null } = {})` avec `queryKey: chantierId ? pennylaneKeys.linkedQuotesByChantier(orgId, chantierId) : pennylaneKeys.linkedQuotesByLead(orgId, leadId)` et `pennylaneService.getLinkedQuotesByLead(leadId, { chantierId })`. Dans `useLinkedPennylaneQuotesMutations`, remplacer l'invalidation `linkedQuotesByLead(orgId, leadId)` par `pennylaneKeys.linkedQuotes(orgId)` et `['chantiers']` par `chantierKeys.all(orgId)` (import depuis cacheKeys).

- [ ] **Step 5 : Lint et commit**

```bash
npm run lint:errors
git add src/shared/hooks/cacheKeys.js src/shared/hooks/useChantiers.js src/shared/hooks/usePennylane.js src/shared/services/chantiers.service.js src/shared/services/pennylane.service.js
git commit -m "refactor(chantiers): service et hooks sur l'entité chantier (vue write, RPC grouper/détacher, devis par chantier)"
```

Le build casse volontairement à ce stade (les composants appellent encore les anciennes signatures) : il est rétabli en Task 7.

---

### Task 6 : RDV d'installation rattachés au chantier, gain sans devis

**Files:**
- Modify: `src/shared/services/appointments.service.js:146-190` (`syncCardStateOnCreate`), `:465-470` et `:503-506` (`updateAppointment`), `:863-864` (`createAppointmentBatch`)
- Modify: `src/shared/hooks/useAppointments.js:511-548` (`useChantierAppointments`)
- Modify: `src/shared/services/leads.service.js:482-484` (Gagné)
- Modify: `src/apps/artisan/components/planning/EventModal.jsx:1027-1031` (« Programmer une suite »)

**Interfaces:**
- Consumes: `chantiersService.ensureChantierForLead(leadId)` (Task 5) ; colonne `majordhome_appointments.chantier_id` (Task 1).
- Produces: `createAppointmentBatch(slots, shared)` accepte `shared.chantier_id` ; `useChantierAppointments(orgId, chantierId)` filtre `chantier_id`.

- [ ] **Step 1 : `syncCardStateOnCreate`** — remplacer la branche installation (et la placer AVANT `if (!appt.lead_id) return;`) :

```js
  // Installation -> chantier « planification » si en amont (clé = chantier, plus le lead)
  if (appt.appointment_type === 'installation') {
    if (!appt.chantier_id) return;
    const { data: chantier, error: readError } = await supabase
      .from('majordhome_chantiers').select('id, org_id, chantier_status').eq('id', appt.chantier_id).maybeSingle();
    if (readError) { console.error('[appointments] syncCreate install read error:', readError); return; }
    const order = CHANTIER_ORDER[chantier?.chantier_status] ?? 0;
    if (chantier && order < CHANTIER_ORDER.planification) {
      const now = new Date();
      const { data: patched, error } = await supabase
        .from('majordhome_chantiers_write')
        .update({ chantier_status: 'planification', planification_date: now.toISOString().split('T')[0], updated_at: now.toISOString() })
        .eq('id', chantier.id).eq('org_id', chantier.org_id)
        .select('id').maybeSingle();
      if (error || !patched) console.error('[appointments] syncCreate install chantier error:', error || 'aucune ligne (RLS ?)');
    }
    return;
  }
  if (!appt.lead_id) return;
```

Supprimer l'ancienne branche installation (lecture de `majordhome_leads.chantier_status` + `update_majordhome_lead`).

- [ ] **Step 2 : `createAppointmentBatch`** — après `lead_id: shared.lead_id || null,` ajouter `chantier_id: shared.chantier_id || null,` et compléter la JSDoc `shared = { …, lead_id?, chantier_id?, … }`. `createAppointment` propage déjà tout `appointmentData` dans l'INSERT : rien d'autre.

- [ ] **Step 3 : `updateAppointment`** — dans la détection `previous` (`'appointment_type' in updates || 'intervention_id' in updates || 'lead_id' in updates`) ajouter `|| 'chantier_id' in updates`, sélectionner `appointment_type, intervention_id, lead_id, chantier_id`, et dans `targetChanged` ajouter `|| previous.chantier_id !== appointment?.chantier_id`.

- [ ] **Step 4 : `useChantierAppointments(orgId, chantierId)`**

```js
export function useChantierAppointments(orgId, chantierId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: appointmentKeys.chantier(orgId, chantierId),
    queryFn: async () => {
      const mhOrg = await getMajordhomeOrgId(orgId);
      const { data, error } = await supabase
        .from('majordhome_appointments')
        .select('*')
        .eq('org_id', mhOrg)
        .eq('chantier_id', chantierId)
        .eq('appointment_type', 'installation')
        .not('status', 'in', '(cancelled,no_show)')
        .order('scheduled_date', { ascending: true })
        .order('scheduled_start', { ascending: true });
```

(reste identique ; JSDoc : « Appointments d'installation d'un chantier (chantier_id) »).

- [ ] **Step 5 : Gain sans devis** — `leads.service.js`, branche `Gagné` : supprimer `updates.chantier_status = 'gagne';`. Après l'appel `update_majordhome_lead` réussi (juste après `if (updateError) throw updateError;`), ajouter :

```js
      // Gagné : le lead a désormais un chantier (celui du devis PL s'il existe, sinon un chantier sans devis).
      if (newStatusLabel === 'Gagné') {
        const { error: chantierError } = await supabase.rpc('chantier_ensure_for_lead', { p_lead_id: leadId });
        if (chantierError) throw chantierError;
      }
```

- [ ] **Step 6 : « Programmer une suite »** — `EventModal.jsx`, dans le `createAppointmentBatch` de la suite, après `lead_id: appointment?.lead_id || null,` ajouter `chantier_id: appointment?.chantier_id || null,`.

- [ ] **Step 7 : Lint, commit**

```bash
npm run lint:errors
git add src/shared/services/appointments.service.js src/shared/hooks/useAppointments.js src/shared/services/leads.service.js src/apps/artisan/components/planning/EventModal.jsx
git commit -m "feat(chantiers): RDV d'installation rattachés au chantier, avancée de carte et gain sans devis par chantier"
```

---

### Task 7 : Modale chantier, section devis, PV, fiche client (clé = chantier)

**Files:**
- Modify: `src/apps/artisan/components/chantiers/ChantierModal.jsx`
- Modify: `src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx:102-103`
- Modify: `src/apps/artisan/pages/PvReceptionSign.jsx:34-60, 105-108, 166`
- Modify: `src/apps/artisan/routes.jsx:462`
- Modify: `src/apps/artisan/pages/client-detail/TabInterventions.jsx:144-204`
- Modify: `src/lib/auditTrail.js` (SUBJECTS + libellés)

**Interfaces:**
- Consumes: hooks Task 5 (`useChantierMutations` : signatures `(chantierId, …)`, `updateLabel`), `useChantierAppointments(orgId, chantierId)` (Task 6), `createAppointmentBatch` avec `chantier_id`.

- [ ] **Step 1 : `ChantierModal.jsx`**

1. Destructurer `updateLabel` dans `useChantierMutations()`. Le commentaire du hook RDV devient « Jours d'installation = appointments `installation` du chantier (chantier_id) ».
2. Dans `handleConfirmInstallation`, remplacer `lead_id: chantier.id,` par :

```js
        chantier_id: chantier.id,
        lead_id: chantier.lead_id,
```

3. Libellé éditable, sous le bloc `equipment_type_label` (dans « Infos client », visible hors technicien) :

```jsx
            {!isTechnicien && (
              <FormField label="Libellé du chantier">
                <TextInput
                  value={label}
                  onChange={setLabel}
                  onBlur={handleSaveLabel}
                  placeholder="Ex. Installation d'une pompe à chaleur"
                  disabled={!canEditChantier}
                />
              </FormField>
            )}
```

avec l'état et le handler à côté de `notes` :

```js
  const [label, setLabel] = useState(chantier?.label || '');
  useEffect(() => { setLabel(chantier?.label || ''); }, [chantier?.id, chantier?.label]);
  const handleSaveLabel = async () => {
    if ((label || '').trim() === (chantier.label || '')) return;
    try {
      await updateLabel(chantier.id, label);
      onUpdated?.();
    } catch {
      toast.error('Impossible d\'enregistrer le libellé');
    }
  };
```

Si `TextInput` ne propage pas `onBlur`, l'ajouter à `FormFields.jsx` (`onBlur` passé tel quel à l'`<input>`).

4. Dans le header, sous `{statusConfig.label}`, afficher le libellé : `{chantier.label && <p className="text-xs text-gray-500 truncate">{chantier.label}</p>}`.
5. Retirer le cas `archive` (`CHANTIER_TRANSITIONS.facture` est vide) : supprimer `if (t === 'archive') return true;` et le bloc `if (targetStatus === 'archive') { … }`, ainsi que l'import `Archive`.

- [ ] **Step 2 : `ChantierReceptionSection.jsx`** — devis du chantier :

```js
  const { linkedQuotes } = useLinkedPennylaneQuotes(chantier?.lead_id, { chantierId: chantier?.id });
  const { ejectQuote, isEjecting } = useLinkedPennylaneQuotesMutations(orgId, chantier?.lead_id);
```

Le libellé « Devis rattachés » devient « Devis de ce chantier ».

- [ ] **Step 3 : `PvReceptionSign.jsx`** — `useChantier(chantierId)` (paramètre renommé, `.eq('id', chantierId)`), `const { chantierId } = useParams();`, montant via `getChantierAmount(chantier)` (import depuis `@services/chantiers.service`), `chantiersService.updatePvReceptionPath(orgId, chantier.id, storagePath)`. `routes.jsx` : `path: 'chantiers/:chantierId/pv-reception'`.

- [ ] **Step 4 : `TabInterventions.jsx`** — `ChantierSummary` liste :

```jsx
const ChantierSummary = ({ clientId }) => {
  const [chantiers, setChantiers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    const load = async () => {
      try {
        const { data, error } = await chantiersService.getChantiersByClientId(clientId);
        if (error) throw error;
        setChantiers(data || []);
      } catch (err) {
        console.error('[ChantierSummary] load error:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [clientId]);

  if (loading || chantiers.length === 0) return null;
  const orderLabels = { na: 'N/A', commande: 'Commandé', recu: 'Reçu' };

  return (
    <div className="space-y-3">
      {chantiers.map((chantier) => {
        const statusConfig = getChantierStatusConfig(chantier.chantier_status);
        return (
          <div key={chantier.id} className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
            <div className="flex items-center gap-2">
              <HardHat className="w-4 h-4 text-amber-600" />
              <h4 className="text-sm font-semibold text-amber-900 truncate">
                {chantier.label ? `Chantier · ${chantier.label}` : 'Chantier'}
              </h4>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium text-white" style={{ backgroundColor: statusConfig.color }}>
                {statusConfig.label}
              </span>
            </div>
            {/* grille Gagné le / Date estimée / Équipement / Matériaux : reprendre le bloc existant tel quel */}
            {chantier.chantier_notes && <p className="text-xs text-secondary-500 italic">{chantier.chantier_notes}</p>}
          </div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 5 : `auditTrail.js`** — `SUBJECTS = { leads: 'Lead', appointments: 'RDV', chantiers: 'Chantier' }` ; dans la table des libellés de colonnes ajouter `label: 'Libellé du chantier'`, `chantier_id: 'Chantier lié'` ; dans la table des sources ajouter `chantier_group: 'groupement de chantiers'`, `chantier_detach: 'détachement de chantier'`, `chantier_delete: 'suppression de chantier'`, `chantier_ensure_for_lead: 'gain sans devis'`, `majordhome_chantiers_write: 'fiche chantier'`. Lancer `node --test scripts/audit-trail.test.mjs`.

- [ ] **Step 6 : Build, lint, commit**

```bash
npm run lint:errors
npx vite build
git add src/apps/artisan/components/chantiers/ChantierModal.jsx src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx src/apps/artisan/pages/PvReceptionSign.jsx src/apps/artisan/routes.jsx src/apps/artisan/pages/client-detail/TabInterventions.jsx src/lib/auditTrail.js src/apps/artisan/components/FormFields.jsx
git commit -m "feat(chantiers): modale, devis, PV et fiche client sur l'entité chantier (libellé éditable, un bloc par chantier)"
```

---

### Task 8 : Carte kanban (libellé, pastilles) + « Détacher en chantier distinct »

**Files:**
- Modify: `src/apps/artisan/components/chantiers/ChantierCard.jsx:100-115`
- Modify: `src/apps/artisan/components/chantiers/ChantierKanban.jsx:80-88` (recherche sur `label`)
- Create: `src/apps/artisan/components/chantiers/DetachChantierDialog.jsx`
- Modify: `src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx` (lien + dialogue)

**Interfaces:**
- Consumes: `resumeDetachement`, `commandeSuitParDefaut` (Task 4) ; `useChantierMutations().detachChantier` (Task 5) ; `useChantierAppointments` (Task 6) ; `useCanAccess().can('chantiers', 'edit')`.
- Produces: `<DetachChantierDialog chantier quotes appointments onClose onDetached />`.

- [ ] **Step 1 : `ChantierCard.jsx`** — sous la ligne 1 (nom + montant), ajouter :

```jsx
        {(chantier.label || Number(chantier.quotes_count) >= 2 || Number(chantier.validated_quotes_count) === 0) && (
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {chantier.label && <p className="text-xs text-gray-500 truncate">{chantier.label}</p>}
            {Number(chantier.quotes_count) >= 2 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold shrink-0" title="Devis groupés sur ce chantier">
                {chantier.quotes_count} devis
              </span>
            )}
            {Number(chantier.validated_quotes_count) === 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold shrink-0" title="Aucun devis validé sur ce chantier">
                sans devis validé
              </span>
            )}
          </div>
        )}
```

`ChantierKanban.searchFilter` : ajouter `chantier.label` aux `fields`.

- [ ] **Step 2 : `DetachChantierDialog.jsx`**

```jsx
/**
 * DetachChantierDialog.jsx — Majord'home Artisan
 * ============================================================================
 * « Détacher en chantier distinct » : des devis (+ jours d'installation, + commande)
 * quittent ce chantier pour une nouvelle carte du même lead. Aperçu par le module pur
 * chantierSplit (mêmes règles que la RPC chantier_detach) ; rien n'est écrit avant « Détacher ».
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { X, Loader2, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { formatEuro } from '@/lib/utils';
import { resumeDetachement, commandeSuitParDefaut } from '@/lib/chantierSplit';
import { useChantierMutations } from '@hooks/useChantiers';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';

function dateFR(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function DetachChantierDialog({ chantier, quotes = [], appointments = [], onClose, onDetached }) {
  const { detachChantier, isDetaching } = useChantierMutations();
  const [quoteIds, setQuoteIds] = useState([]);
  const [appointmentIds, setAppointmentIds] = useState([]);
  const [movePlannedOrder, setMovePlannedOrder] = useState(null); // null = suit le défaut
  const [label, setLabel] = useState('');

  const plannedOrder = { teamSize: chantier?.planned_team_size ?? null, days: chantier?.planned_days ?? null };
  const resume = useMemo(
    () => resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds, appointmentIds }),
    [quotes, appointments, plannedOrder.teamSize, plannedOrder.days, quoteIds, appointmentIds],
  );
  const moveByDefault = commandeSuitParDefaut(plannedOrder, resume.nouveau.jours);
  const move = movePlannedOrder ?? moveByDefault;
  const hasOrder = Boolean(plannedOrder.teamSize || plannedOrder.days);

  const toggle = (setter) => (id) => setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleDetach = async () => {
    if (!resume.ok) return;
    try {
      await detachChantier({ chantierId: chantier.id, quoteIds, appointmentIds, movePlannedOrder: hasOrder && move, label: label.trim() || null });
      toast.success('Chantier détaché');
      onDetached?.();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Impossible de détacher ce chantier');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-12 pb-8">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[calc(100vh-6rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Scissors className="w-4 h-4" /> Détacher en chantier distinct</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section className="space-y-2">
            <p className="text-xs font-semibold text-secondary-500 uppercase tracking-wider">Devis qui partent</p>
            {quotes.map((q) => (
              <label key={q.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm cursor-pointer ${q.is_validated ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-200'}`}>
                <input type="checkbox" checked={quoteIds.includes(q.id)} onChange={() => toggle(setQuoteIds)(q.id)} />
                <span className="font-medium text-gray-900">{q.quote_number_pl || q.quote_label}</span>
                {!q.is_validated && <span className="text-gray-400">· non validé</span>}
                <span className="ml-auto font-semibold tabular-nums">{formatEuro(Number(q.quote_amount_ht) || 0)}</span>
              </label>
            ))}
          </section>

          {appointments.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-secondary-500 uppercase tracking-wider">Jours d'installation qui partent</p>
              {appointments.map((a) => (
                <label key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 text-sm cursor-pointer">
                  <input type="checkbox" checked={appointmentIds.includes(a.id)} onChange={() => toggle(setAppointmentIds)(a.id)} />
                  <span className="font-medium text-gray-900">{dateFR(a.scheduled_date)}</span>
                  <span className="text-gray-500">{(a.scheduled_start || '').slice(0, 5)}{a.scheduled_end ? ` – ${a.scheduled_end.slice(0, 5)}` : ''}</span>
                  <span className="ml-auto text-xs text-gray-500">{(a.technician_ids || []).length} pers.</span>
                </label>
              ))}
            </section>
          )}

          {hasOrder && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={move} onChange={(e) => setMovePlannedOrder(e.target.checked)} />
              La commande {plannedOrder.teamSize ? `${plannedOrder.teamSize} pers.` : ''}{plannedOrder.teamSize && plannedOrder.days ? ' × ' : ''}{plannedOrder.days ? `${plannedOrder.days} j` : ''} part avec le nouveau chantier
            </label>
          )}

          <FormField label="Libellé du nouveau chantier (facultatif)">
            <TextInput value={label} onChange={setLabel} placeholder="Repris de l'objet du devis si vide" />
          </FormField>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {[['Chantier d’origine', resume.origine], ['Nouveau chantier', resume.nouveau]].map(([titre, r]) => (
              <div key={titre} className="p-3 rounded-lg border border-gray-200 bg-gray-50 space-y-1">
                <p className="font-semibold text-gray-900">{titre}</p>
                <p className="text-gray-600">{formatEuro(r.montant)} · {r.devis} devis · {r.jours} jour{r.jours > 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
          {resume.erreurs.length > 0 && (
            <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
              {resume.erreurs.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100">Annuler</button>
          <button type="button" onClick={handleDetach} disabled={!resume.ok || isDetaching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {isDetaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
            Détacher
          </button>
        </div>
      </div>
    </div>
  );
}

export default DetachChantierDialog;
```

Le dialogue affiche numéro + montant + statut de chaque devis (l'objet du devis n'est pas exposé par `majordhome_lead_pennylane_quotes` ; la RPC le reprend elle-même pour le libellé du nouveau chantier).

- [ ] **Step 3 : Brancher dans `ChantierReceptionSection.jsx`** — props supplémentaires `appointments = []` (passées par `ChantierModal` : `appointments={installAppointments}`) ; `const { can } = useCanAccess();` (`import { useCanAccess } from '@hooks/usePermissions'`) ; état `const [showDetach, setShowDetach] = useState(false);` ; sous la liste des devis :

```jsx
          {can('chantiers', 'edit') && quotes.filter((q) => q.is_validated).length >= 2 && (
            <button type="button" onClick={() => setShowDetach(true)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1">
              <Scissors className="w-3.5 h-3.5" /> Détacher en chantier distinct
            </button>
          )}
```

et en fin de composant `{showDetach && <DetachChantierDialog chantier={chantier} quotes={quotes} appointments={appointments} onClose={() => setShowDetach(false)} onDetached={onUpdated} />}`. Import `Scissors` de lucide.

- [ ] **Step 4 : Build, lint, commit**

```bash
npm run lint:errors && npx vite build
git add src/apps/artisan/components/chantiers/
git commit -m "feat(chantiers): carte avec libellé et pastilles, dialogue « Détacher en chantier distinct »"
```

---

### Task 9 : « Grouper avec… », « Supprimer ce chantier », docs, vérification finale

**Files:**
- Create: `src/apps/artisan/components/chantiers/GroupChantiersDialog.jsx`
- Modify: `src/apps/artisan/components/chantiers/ChantierModal.jsx` (boutons)
- Modify: `docs/DATABASE.md` (§ chantiers), `.claude/proposed-updates.md` (entrée PENDING pour le CLAUDE.md)

**Interfaces:**
- Consumes: `resumeGroupement` (Task 4), `useChantierMutations().groupChantiers / deleteChantier` (Task 5), `useChantiers(orgId)` pour lister les autres chantiers du lead, `ConfirmDialog` de `@/components/ui/confirm-dialog`.

- [ ] **Step 1 : `GroupChantiersDialog.jsx`**

```jsx
/**
 * GroupChantiersDialog.jsx — Majord'home Artisan
 * ============================================================================
 * « Grouper avec… » : d'autres chantiers du MÊME lead rejoignent celui-ci (devis, RDV,
 * réceptions), puis disparaissent. Aperçu par chantierSplit.resumeGroupement ; la RPC
 * chantier_group applique les mêmes règles (statut le plus avancé, vides complétés).
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { X, Loader2, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { formatEuro } from '@/lib/utils';
import { resumeGroupement } from '@/lib/chantierSplit';
import { useChantiers, useChantierMutations } from '@hooks/useChantiers';
import { getChantierStatusConfig, getChantierAmount } from '@services/chantiers.service';

export function GroupChantiersDialog({ chantier, onClose, onGrouped }) {
  const { organization } = useAuth();
  const { chantiers } = useChantiers(organization?.id);
  const { groupChantiers, isGrouping } = useChantierMutations();
  const [sourceIds, setSourceIds] = useState([]);

  const candidats = useMemo(
    () => chantiers.filter((c) => c.lead_id === chantier.lead_id && c.id !== chantier.id),
    [chantiers, chantier.lead_id, chantier.id],
  );
  const sources = candidats.filter((c) => sourceIds.includes(c.id));
  const apercu = resumeGroupement(chantier, sources);

  const handleGroup = async () => {
    if (sourceIds.length === 0) return;
    try {
      await groupChantiers(chantier.id, sourceIds);
      toast.success(sourceIds.length > 1 ? `${sourceIds.length} chantiers groupés` : 'Chantiers groupés');
      onGrouped?.();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Impossible de grouper ces chantiers');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-12 pb-8">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[calc(100vh-6rem)] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Layers className="w-4 h-4" /> Grouper avec…</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600">Les chantiers cochés rejoignent « {chantier.label || 'ce chantier'} » (devis, jours d'installation, réceptions) et disparaissent du kanban.</p>
          {candidats.length === 0 && <p className="text-sm text-gray-400">Aucun autre chantier sur ce lead.</p>}
          {candidats.map((c) => {
            const cfg = getChantierStatusConfig(c.chantier_status);
            return (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 text-sm cursor-pointer">
                <input type="checkbox" checked={sourceIds.includes(c.id)}
                  onChange={() => setSourceIds((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))} />
                <span className="font-medium text-gray-900 truncate">{c.label || 'Sans libellé'}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: cfg.color }}>{cfg.label}</span>
                <span className="ml-auto font-semibold tabular-nums shrink-0">{formatEuro(getChantierAmount(c))}</span>
              </label>
            );
          })}
          {sources.length > 0 && (
            <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-sm space-y-1">
              <p className="font-semibold text-gray-900">Résultat</p>
              <p className="text-gray-600">{formatEuro(apercu.montant)} · {apercu.devis} devis ({apercu.devisValides} validés) · statut « {getChantierStatusConfig(apercu.statut).label} »</p>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100">Annuler</button>
          <button type="button" onClick={handleGroup} disabled={sourceIds.length === 0 || isGrouping}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {isGrouping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            Grouper
          </button>
        </div>
      </div>
    </div>
  );
}

export default GroupChantiersDialog;
```

- [ ] **Step 2 : Boutons dans `ChantierModal.jsx`** — `const { can } = useCanAccess();` (import `@hooks/usePermissions`), `deleteChantier, isDeleting` depuis `useChantierMutations()`, états `showGroup`, `showDelete`. Dans le footer (avant `<div className="flex-1" />`), pour `can('chantiers', 'edit')` :

```jsx
              {can('chantiers', 'edit') && Number(chantier.lead_chantiers_count) >= 2 && (
                <button type="button" onClick={() => setShowGroup(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-100">
                  <Layers className="w-3.5 h-3.5" /> Grouper avec…
                </button>
              )}
              {can('chantiers', 'edit') && Number(chantier.validated_quotes_count) === 0 && !installAppointments.length && !pvPath && (
                <button type="button" onClick={() => setShowDelete(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-red-600 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" /> Supprimer ce chantier
                </button>
              )}
```

Le footer doit être rendu même sans transition (`allowedTransitions.length > 0 ||` ces deux conditions). Après la `CreateContractModal` :

```jsx
    {showGroup && <GroupChantiersDialog chantier={chantier} onClose={() => setShowGroup(false)} onGrouped={onUpdated} />}
    <ConfirmDialog
      open={showDelete}
      onOpenChange={setShowDelete}
      title="Supprimer ce chantier ?"
      description="Le chantier disparaît du kanban. Les devis non validés restent attachés au lead. Aucun devis validé, RDV ni PV ne sera perdu (la suppression est refusée s'il en reste)."
      confirmLabel={isDeleting ? 'Suppression…' : 'Supprimer'}
      cancelLabel="Annuler"
      variant="destructive"
      loading={isDeleting}
      onConfirm={async () => {
        try {
          await deleteChantier(chantier.id);
          toast.success('Chantier supprimé');
          onUpdated?.();
          onClose();
        } catch (err) {
          toast.error(err?.message || 'Suppression refusée');
        }
      }}
    />
```

Imports : `Layers, Trash2` (lucide), `GroupChantiersDialog`, `ConfirmDialog` (`@/components/ui/confirm-dialog`).

- [ ] **Step 3 : Docs**

`docs/DATABASE.md` § chantiers (lignes ~321-328) : remplacer la description des colonnes du lead par : table `majordhome.chantiers` (colonnes § 3.1 de la spec), `lead_pennylane_quotes.chantier_id`, `appointments.chantier_id`, vues `chantier_quote_stats` / `majordhome_chantiers` (id = chantier) / `majordhome_chantiers_write`, trigger `chantier_ensure_for_quote`, RPC `chantier_ensure_for_lead` / `chantier_group` / `chantier_detach` / `chantier_delete`, et une ligne « colonnes chantier de `leads` = legacy, plus écrites, contraction à venir ».

`.claude/proposed-updates.md` : ajouter une entrée PENDING « Module Chantiers — entité par devis (2026-09-30) » proposant pour le CLAUDE.md : un chantier = ligne de `majordhome.chantiers` (id ≠ lead) ; un devis validé sans chantier en crée un (trigger) ; RDV d'installation portent `chantier_id` ; écrire via `majordhome_chantiers_write` jamais via `update_majordhome_lead` ; `target_invoiced` par chantier ; ne jamais recopier l'allowlist (`chantier_quote_stats`).

- [ ] **Step 4 : Vérification finale**

```bash
npm run audit:quality
npx vite build
node scripts/migration-rehearsal/run.mjs --migration scripts/migration-rehearsal/fixture-chantiers.sql --migration supabase/migrations/20260930_16_chantiers_entite.sql --migration supabase/migrations/20260930_17_chantiers_rpc.sql --migration supabase/migrations/20260930_18_lead_merge_chantiers.sql --assert scripts/migration-rehearsal/assert-chantiers.sql
git status --short
```

Attendu : lint sans erreur, tests verts (dont `chantier-split`, `install-order`, `audit-trail`), `audit:dead-code` sans nouveau fichier orphelin, build OK, harnais `§A / §B / §C : OK`. Mesure de régression des mutations : `grep -rnE "mutationFn: .*=> *[a-zA-Z]+Service\.[a-zA-Z]+\(" src/shared/hooks | grep -v "unwrap("` ne doit remonter que `useGoogleCalendar` et `orderMutation` de `useChantiers` (retour composite `autoTransitioned`, lu par `ChantierReceptionSection` qui teste `res?.error`).

- [ ] **Step 5 : Commit et rapport à Eric**

```bash
git add src/apps/artisan/components/chantiers/GroupChantiersDialog.jsx src/apps/artisan/components/chantiers/ChantierModal.jsx docs/DATABASE.md .claude/proposed-updates.md
git commit -m "feat(chantiers): « Grouper avec… », suppression d'un chantier vide, docs"
```

Rapport : liste des commits, sortie du harnais, ce qui reste à Eric — appliquer les 3 migrations en prod (`apply_migration`, dans l'ordre 11 → 12 → 13), redéployer aucune edge (rien ne change côté edges), puis détacher GOUIN / VEOLIA ENERGIE / VEOLIA ENVIRONNEMENT depuis l'app et vérifier la couleur des RDV GOUIN au planning (borne violette, PAC en couleur d'équipe). **Ne pas pousser ni appliquer en prod sans son accord.**

---

## Auto-revue du plan (faite à la rédaction)

- **Couverture spec** : § 3 modèle → Task 1 ; § 4.1 trigger, § 4.2-4.5 RPC → Task 2 ; § 4.6 vue write → Task 1 + 5 ; § 5 vues → Task 1 ; § 6 reprise → Task 1 (fixture + assertions §A) ; § 7.1 module pur → Task 4 ; § 7.2 services/hooks → Task 5 + 6 ; § 7.3 composants → Task 7, 8, 9 ; § 7.4 droits → `can('chantiers','edit')` (Task 8, 9) et `role_can` (Task 1, 2) ; § 8 `lead_merge` → Task 3, hard deletes par FK (Task 1), mouchard (Task 1 + 7), Google Calendar rien ; § 10 vérification → Task 9.
- **Écart assumé avec la spec § 7.2** : `appointmentActivation.service.js` n'est pas modifié — aucun appelant ne crée d'installation par `EventModal` (vérifié : aucun `lockedType: 'installation'`), seule `ChantierModal` en crée, et elle pose `chantier_id` (Task 7). À reprendre le jour où le planning propose l'installation.
- **Écart assumé avec la spec § 3.1** : `chantiers.client_id` est recopié à la création mais la vue expose `l.client_id` (le lead reste l'autorité sur le lien client, il peut être posé après le gain).
- **Types** : `useChantierMutations` expose `(chantierId, …)` ; le service prend `(orgId, chantierId, …)` ; `useLinkedPennylaneQuotes(leadId, { chantierId })` ; `createAppointmentBatch(slots, { chantier_id, lead_id })` ; RPC noms/paramètres identiques entre Task 2 (SQL) et Task 5 (service).
