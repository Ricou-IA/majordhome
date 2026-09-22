# Hub de facturation — Phase 3 : avoir (annulation totale d'une facture émise) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une facture émise par Majord'home peut être annulée par un avoir : document `kind = 'credit_note'` numéroté dans la même série, montants négatifs miroir de l'original, PDF « AVOIR » archivé, importé dans Pennylane lié à la facture d'origine, la facture d'origine passe `cancelled` et la carte entretien redevient facturable.

**Architecture:** Une RPC SECURITY DEFINER `invoice_cancel_with_credit_note` fait tout côté base en une transaction (garde d'autorisation positive, copie négative de l'en-tête et des lignes, émission via `invoice_issue`, bascule de l'original en `cancelled`). L'index d'unicité « un entretien = une facture émise » ne compte plus que les factures `kind = 'invoice'`, donc un entretien annulé par avoir est refacturable. Le PDF réutilise `InvoicePDF` (titre AVOIR, mention « Avoir sur la facture N ») via `buildInvoicePdfModel` ; l'edge d'import passe `credited_invoice_id` (id Pennylane de l'original) quand il existe. Côté front, un hook unique enchaîne RPC → PDF → Storage → import (non bloquant) → carte remise « à facturer » ; un dialogue destructif porte l'action depuis la carte.

**Tech Stack:** PostgreSQL (migration versionnée répétée sur `scripts/migration-rehearsal/`), Deno edge, React 18 + TanStack Query v5, react-pdf, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md` (§ « Immuabilité : toute correction = avoir », § Modèle de données `kind`, `credited_invoice_id`, RPC `invoice_cancel_with_credit_note`, § Phases → 3). Phases 1-2 livrées (plans `2026-09-22-hub-facturation-phase1-…` et `…-phase2-…`). Pennylane : un avoir s'importe par `POST /customer_invoices/import` avec des montants NÉGATIFS et `credited_invoice_id` (doc `importcustomerinvoices`, vérifiée le 2026-09-23).

## Global Constraints

- **Multi-tenant** (CLAUDE.md) : la nouvelle RPC est SECURITY DEFINER, `IF auth.uid() IS NULL THEN refuser` en première instruction, garde POSITIVE `(v_role IN ('org_admin','team_leader')) IS NOT TRUE`, `REVOKE EXECUTE … FROM PUBLIC, anon`, `GRANT TO authenticated` ; vue `majordhome_invoices` recréée `WITH (security_invoker = true)` + REVOKE/GRANT restatés + `GRANT SELECT … TO service_role` ; front filtre `.eq('org_id', orgId)`.
- **Immuabilité** : l'original n'est jamais modifié sauf `status` → `cancelled` (seule transition autorisée par `invoices_guard_immutable`). L'avoir est une facture à part entière : émis par `invoice_issue` (même série `invoice_sequences`, même préfixe), figé ensuite. **Une seule annulation par facture** (`already_credited`), pas d'avoir partiel en phase 3.
- **Montants** : l'avoir est le miroir exact de l'original : chaque ligne `ht/tva/ttc/unit_price_ht × -1`, totaux et `vat_breakdown` négatifs ; les CHECK `ht + tva = ttc` et `total_ht + total_tva = total_ttc` restent vrais ; `quantity` reste positive. `invoice_issue` réconcilie en-tête et lignes comme pour une facture.
- **Carte** : après l'avoir, `interventions.invoice_id` et `invoiced_at` sont remis à NULL (la carte redevient facturable ; l'index unique ignore les factures `cancelled` et les avoirs). L'avoir garde `intervention_id` pour la traçabilité.
- **Pennylane** : import par l'edge existante `pennylane-invoice-import` avec `credited_invoice_id` = `pennylane_invoice_id` de l'original s'il est importé, sinon import sans lien + `warnings: ['credited_invoice_not_imported']`. L'import n'échoue jamais l'annulation.
- **PDF** : titre `AVOIR`, ligne « Avoir sur la facture N », montants négatifs, bloc Règlement remplacé par une mention d'avoir, pas de pénalités/escompte. Modèle PUR (`buildInvoicePdfModel`), `InvoicePDF.jsx` ne calcule rien.
- **Conventions** : services `{ data, error }` ; hooks `unwrapResult` ; `invoiceKeys` / `entretienSavKeys` / `pennylaneKeys` ; messages FR dans `INVOICE_RPC_MESSAGES` ; `npm run audit:quality` + `npx vite build` + `deno check` verts ; pas de preview tools. Migration / edge en prod = contrôleur après revue.
- **Harnais** : le snapshot local est antérieur à `20260922_1_planned_order.sql` → toujours répéter avec cette migration en tête, puis `20260923_1`, `_2`, `_3`, `_4`.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260923_4_invoices_credit_note.sql` (créer) | Index unique restreint à `kind='invoice'`, `invoice_issue` (garde restreinte), RPC `invoice_cancel_with_credit_note`, vue `majordhome_invoices` + `credited_number` |
| `scripts/migration-rehearsal/assert-invoices-credit-note.sql` (créer) | Structure + parcours : émettre → annuler → avoir numéroté, original cancelled, refacturation possible, 2ᵉ annulation refusée, brouillon refusé, cross-org refusé |
| `src/lib/invoiceDocumentModel.js` (modifier) | Modèle PDF d'un avoir (règlement/légal), messages `already_credited`, `credit_note_source_invalid`, `credited_invoice_not_imported` |
| `scripts/invoice-document-model.test.mjs` (modifier) | Tests avoir |
| `supabase/functions/pennylane-invoice-import/index.ts` (modifier) | `credited_invoice_id` pour un avoir, warning si l'original n'est pas importé |
| `src/shared/services/invoices.service.js` (modifier) | `cancelWithCreditNote(orgId, invoiceId, numberPrefix, reason)` |
| `src/shared/hooks/useInvoices.js` (modifier) | `useCancelInvoiceWithCreditNote(orgId)` |
| `src/apps/artisan/components/facturation/CancelInvoiceDialog.jsx` (créer) | Dialogue destructif « Annuler par avoir » (motif optionnel) |
| `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (modifier) | Bouton « Avoir » en mode hub sur une carte facturée |
| `docs/superpowers/specs/…-design.md`, `.claude/proposed-updates.md` (modifier) | Phase 3 livrée ; bullets |

---

### Task 1: Migration — avoir, index restreint, vue

**Files:**
- Create: `supabase/migrations/20260923_4_invoices_credit_note.sql`
- Create: `scripts/migration-rehearsal/assert-invoices-credit-note.sql`

**Interfaces:**
- Consumes: `invoice_issue(uuid, text)` (corps de `20260923_2`), `invoices_guard_immutable` (transition `issued → cancelled` autorisée), index `invoices_one_issued_per_intervention` (`20260923_2`), vue `majordhome_invoices` (`20260923_3` § 4).
- Produces: `public.invoice_cancel_with_credit_note(p_invoice_id uuid, p_number_prefix text DEFAULT 'F', p_reason text DEFAULT NULL) RETURNS jsonb` → `{ credit_note_id, number, credited_invoice_id, credited_number, total_ttc }` ; codes : `unauthenticated` (42501), `team_leader_required` (42501), `invoice_not_found` (P0002), `credit_note_source_invalid` (22023 — original non `issued` ou non `invoice`), `already_credited` (23505) ; index `invoices_one_issued_per_intervention` avec `kind = 'invoice'` ; vue `majordhome_invoices` avec `credited_number text` en DERNIÈRE colonne.

- [ ] **Step 1: Écrire la migration**

```sql
-- supabase/migrations/20260923_4_invoices_credit_note.sql
-- ============================================================================
-- Hub de facturation — phase 3 : avoir = annulation TOTALE d'une facture émise
-- (spec 2026-09-22 : « toute correction = avoir, facture négative référençant
-- l'originale »). Une seule annulation par facture, pas d'avoir partiel.
--   - L'index « un entretien = une facture émise » ne compte plus que les
--     factures kind='invoice' : un entretien annulé par avoir est refacturable.
--   - invoice_issue : même restriction sur sa garde explicite.
--   - invoice_cancel_with_credit_note : copie NÉGATIVE de l'en-tête et des lignes,
--     émission via invoice_issue (même série), original → cancelled. Tout ou rien.
--   - majordhome_invoices expose credited_number (PDF « Avoir sur la facture N »).
-- Répétée sur scripts/migration-rehearsal/ (assert-invoices-credit-note.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Index unique : au plus une FACTURE émise par intervention (les avoirs et
--    les factures annulées ne comptent pas)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS majordhome.invoices_one_issued_per_intervention;
CREATE UNIQUE INDEX invoices_one_issued_per_intervention
  ON majordhome.invoices (intervention_id)
  WHERE status = 'issued' AND kind = 'invoice' AND intervention_id IS NOT NULL;
COMMENT ON INDEX majordhome.invoices_one_issued_per_intervention IS
  'Un entretien = une FACTURE émise (kind=invoice). Un avoir (kind=credit_note) et une facture annulée (status=cancelled) ne comptent pas : après un avoir, l''entretien est refacturable.';

-- ----------------------------------------------------------------------------
-- 2. invoice_issue — corps identique à 20260923_2 ; la garde explicite ne vise
--    que les FACTURES (l'émission d'un avoir ne doit ni être bloquée, ni bloquer)
-- ----------------------------------------------------------------------------
-- (recopier ICI le corps complet de public.invoice_issue depuis
--  supabase/migrations/20260923_2_invoices_unique_issued_per_intervention.sql,
--  en remplaçant UNIQUEMENT la garde :
--
--    IF v_inv.intervention_id IS NOT NULL AND EXISTS (
--      SELECT 1 FROM majordhome.invoices
--       WHERE intervention_id = v_inv.intervention_id AND status = 'issued' AND id <> p_invoice_id
--    ) THEN
--
--  par :
--
--    IF v_inv.kind = 'invoice' AND v_inv.intervention_id IS NOT NULL AND EXISTS (
--      SELECT 1 FROM majordhome.invoices
--       WHERE intervention_id = v_inv.intervention_id AND status = 'issued' AND kind = 'invoice' AND id <> p_invoice_id
--    ) THEN
--
--  puis restater REVOKE EXECUTE … FROM PUBLIC, anon ; GRANT EXECUTE … TO authenticated.)

-- ----------------------------------------------------------------------------
-- 3. RPC — annulation par avoir (tout ou rien)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_cancel_with_credit_note(
  p_invoice_id uuid,
  p_number_prefix text DEFAULT 'F',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_src majordhome.invoices%ROWTYPE;
  v_credit_id uuid;
  v_issued jsonb;
  v_subject text;
  v_vat jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src FROM majordhome.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_src.org_id AND user_id = v_user LIMIT 1;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_leader_required' USING ERRCODE = '42501';
  END IF;
  IF v_src.status <> 'issued' OR v_src.kind <> 'invoice' THEN
    RAISE EXCEPTION 'credit_note_source_invalid' USING ERRCODE = '22023',
      DETAIL = format('status=%s kind=%s', v_src.status, v_src.kind);
  END IF;
  IF EXISTS (SELECT 1 FROM majordhome.invoices WHERE credited_invoice_id = p_invoice_id AND kind = 'credit_note' AND status = 'issued') THEN
    RAISE EXCEPTION 'already_credited' USING ERRCODE = '23505', DETAIL = v_src.number;
  END IF;

  v_subject := format('Avoir sur la facture %s', v_src.number)
    || CASE WHEN nullif(trim(p_reason), '') IS NOT NULL THEN ' — ' || left(trim(p_reason), 200) ELSE '' END;

  -- Ventilation TVA négative (base et montant × -1, taux inchangé)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'rate', (e->>'rate')::numeric,
           'base', -((e->>'base')::numeric),
           'amount', -((e->>'amount')::numeric))), '[]'::jsonb)
    INTO v_vat
    FROM jsonb_array_elements(COALESCE(v_src.vat_breakdown, '[]'::jsonb)) e;

  INSERT INTO majordhome.invoices (
    org_id, kind, credited_invoice_id, context, client_id, contract_id, intervention_id, customer,
    subject, currency, due_days, total_ht, total_tva, total_ttc, vat_breakdown, discount, created_by
  ) VALUES (
    v_src.org_id, 'credit_note', v_src.id, v_src.context, v_src.client_id, v_src.contract_id, v_src.intervention_id, v_src.customer,
    v_subject, v_src.currency, 0, -v_src.total_ht, -v_src.total_tva, -v_src.total_ttc, v_vat, NULL, v_user
  ) RETURNING id INTO v_credit_id;

  INSERT INTO majordhome.invoice_lines (
    invoice_id, org_id, position, kind, label, description, quantity, unit_price_ht, vat_rate,
    discount_percent, ht, tva, ttc, ledger_account_number, ledger_account_pl_id, metier_key,
    equipment_id, category_id, vat_code
  )
  SELECT v_credit_id, l.org_id, l.position, l.kind, l.label, l.description, l.quantity, -l.unit_price_ht, l.vat_rate,
         l.discount_percent, -l.ht, -l.tva, -l.ttc, l.ledger_account_number, l.ledger_account_pl_id, l.metier_key,
         l.equipment_id, l.category_id, l.vat_code
    FROM majordhome.invoice_lines l
   WHERE l.invoice_id = v_src.id
   ORDER BY l.position;

  -- Même série de numérotation, mêmes contrôles (totaux = lignes, préfixe figé)
  v_issued := public.invoice_issue(v_credit_id, p_number_prefix);

  -- L'original ne bouge que par cette transition (trigger invoices_guard_immutable)
  UPDATE majordhome.invoices SET status = 'cancelled' WHERE id = v_src.id;

  RETURN jsonb_build_object(
    'credit_note_id', v_credit_id,
    'number', v_issued->>'number',
    'credited_invoice_id', v_src.id,
    'credited_number', v_src.number,
    'total_ttc', -v_src.total_ttc
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_cancel_with_credit_note(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_cancel_with_credit_note(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Vue majordhome_invoices + credited_number (dernière colonne ; sous-requête
--    scalaire : la vue reste updatable sur les colonnes de base)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.majordhome_invoices;
CREATE VIEW public.majordhome_invoices WITH (security_invoker = true) AS
  SELECT i.*,
         (SELECT o.number FROM majordhome.invoices o WHERE o.id = i.credited_invoice_id) AS credited_number
    FROM majordhome.invoices i;

REVOKE ALL ON public.majordhome_invoices FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.majordhome_invoices TO authenticated;
GRANT SELECT ON public.majordhome_invoices TO service_role;
COMMENT ON VIEW public.majordhome_invoices IS
  'Miroir auto-updatable de majordhome.invoices (security_invoker, RLS org) + credited_number (numéro de la facture créditée par un avoir). Brouillon : UPDATE libre sauf colonnes d''émission ; émise : colonnes de suivi seulement ; INSERT via invoice_create_draft / invoice_cancel_with_credit_note.';
```

- [ ] **Step 2: Assertions**

```sql
-- assert-invoices-credit-note.sql — vérifie 20260923_4_invoices_credit_note.sql.
DO $$
DECLARE v_def text;
BEGIN
  SELECT indexdef INTO v_def FROM pg_indexes WHERE schemaname='majordhome' AND indexname='invoices_one_issued_per_intervention';
  IF v_def IS NULL OR v_def NOT LIKE '%kind = ''invoice''%' THEN RAISE EXCEPTION 'index invoices_one_issued_per_intervention sans kind=invoice : %', v_def; END IF;
  IF pg_get_functiondef('public.invoice_issue(uuid, text)'::regprocedure) NOT LIKE '%kind = ''invoice''%' THEN RAISE EXCEPTION 'invoice_issue : garde non restreinte aux factures'; END IF;
  IF has_function_privilege('anon', 'public.invoice_cancel_with_credit_note(uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_cancel_with_credit_note exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.invoice_cancel_with_credit_note(uuid, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_cancel_with_credit_note non exécutable par authenticated'; END IF;
  IF (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoices' ORDER BY ordinal_position DESC LIMIT 1) <> 'credited_number' THEN RAISE EXCEPTION 'majordhome_invoices : credited_number pas en dernière colonne'; END IF;
  IF (SELECT is_updatable FROM information_schema.views WHERE table_schema='public' AND table_name='majordhome_invoices') <> 'YES' THEN RAISE EXCEPTION 'majordhome_invoices non updatable'; END IF;
  IF NOT has_table_privilege('service_role', 'public.majordhome_invoices', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur majordhome_invoices'; END IF;
  RAISE NOTICE 'assert-invoices-credit-note A (structure) : OK';
END $$;

BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_etranger uuid; v_client uuid; v_project uuid; v_interv uuid;
  v_inv uuid; v_draft uuid; v_res jsonb; v_row record; v_year text := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::text;
  n int; ok boolean;
BEGIN
  SELECT om.user_id INTO v_membre FROM core.organization_members om JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin','team_leader') LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer avec profil'; END IF;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
     AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;
  IF v_etranger IS NULL THEN RAISE EXCEPTION 'fixture : aucun membre d''une autre org hors Mayer'; END IF;
  -- Fixture intervention (même approche que assert-invoices-unique.sql : reprendre son bloc d'insertion
  -- clients/interventions tel quel ici) → v_interv
  -- […]

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;

  -- (1) Facture émise sur l'intervention, 2 lignes, TVA 10 %
  v_inv := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'intervention_id', v_interv, 'subject', 'Entretien', 'due_days', 30,
      'total_ht', 92.73, 'total_tva', 9.27, 'total_ttc', 102.00,
      'vat_breakdown', '[{"rate":10,"base":92.73,"amount":9.27}]'::jsonb,
      'customer', jsonb_build_object('name', 'REHEARSAL Client')),
    jsonb_build_array(
      jsonb_build_object('position', 1, 'kind', 'contrat', 'label', 'Entretien poêle', 'quantity', 1, 'unit_price_ht', 81.8182, 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 81.82, 'tva', 8.18, 'ttc', 90.00),
      jsonb_build_object('position', 2, 'kind', 'piece', 'label', 'Joint', 'quantity', 2, 'unit_price_ht', 5.4545, 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 10.91, 'tva', 1.09, 'ttc', 12.00)));
  PERFORM public.invoice_issue(v_inv, 'F');

  -- (2) Annulation par avoir
  v_res := public.invoice_cancel_with_credit_note(v_inv, 'F', 'Erreur de tarif');
  IF v_res->>'number' <> 'F-' || v_year || '-00002' THEN RAISE EXCEPTION '(2) numéro d''avoir % inattendu', v_res->>'number'; END IF;
  SELECT status INTO v_row FROM public.majordhome_invoices WHERE id = v_inv;
  IF v_row.status <> 'cancelled' THEN RAISE EXCEPTION '(2) original non annulé (%)', v_row.status; END IF;
  SELECT kind, status, credited_invoice_id, credited_number, total_ht, total_tva, total_ttc, due_days, subject, vat_breakdown
    INTO v_row FROM public.majordhome_invoices WHERE id = (v_res->>'credit_note_id')::uuid;
  IF v_row.kind <> 'credit_note' OR v_row.status <> 'issued' OR v_row.credited_invoice_id <> v_inv THEN RAISE EXCEPTION '(2) avoir mal formé : %', to_jsonb(v_row); END IF;
  IF v_row.credited_number NOT LIKE 'F-%-00001' THEN RAISE EXCEPTION '(2) credited_number % inattendu', v_row.credited_number; END IF;
  IF v_row.total_ttc <> -102.00 OR v_row.total_ht <> -92.73 OR v_row.total_tva <> -9.27 OR v_row.due_days <> 0 THEN RAISE EXCEPTION '(2) totaux avoir : %', to_jsonb(v_row); END IF;
  IF v_row.subject NOT LIKE 'Avoir sur la facture F-%00001 — Erreur de tarif' THEN RAISE EXCEPTION '(2) objet % inattendu', v_row.subject; END IF;
  IF (v_row.vat_breakdown->0->>'amount')::numeric <> -9.27 THEN RAISE EXCEPTION '(2) ventilation TVA non négative : %', v_row.vat_breakdown; END IF;
  SELECT count(*), sum(ttc), min(quantity) INTO v_row FROM public.majordhome_invoice_lines WHERE invoice_id = (v_res->>'credit_note_id')::uuid;
  IF v_row.count <> 2 OR v_row.sum <> -102.00 OR v_row.min <= 0 THEN RAISE EXCEPTION '(2) lignes avoir : %', to_jsonb(v_row); END IF;

  -- (3) Deuxième annulation : refusée ; annuler l'avoir lui-même : refusé ; annuler un brouillon : refusé
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note(v_inv, 'F', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) facture annulée ré-annulable'; END IF;
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note((v_res->>'credit_note_id')::uuid, 'F', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) avoir annulable'; END IF;
  v_draft := public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note(v_draft, 'F', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(3) brouillon annulable'; END IF;

  -- (4) L'intervention est refacturable après l'avoir (index restreint aux factures émises)
  v_draft := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'intervention_id', v_interv, 'total_ht', 10, 'total_tva', 1, 'total_ttc', 11),
    jsonb_build_array(jsonb_build_object('label', 'Refacturation', 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 10, 'tva', 1, 'ttc', 11)));
  v_res := public.invoice_issue(v_draft, 'F');
  IF v_res->>'number' <> 'F-' || v_year || '-00003' THEN RAISE EXCEPTION '(4) refacturation : numéro % inattendu', v_res->>'number'; END IF;
  RESET ROLE;

  -- (5) Cross-org : refusé
  PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
  SET LOCAL ROLE authenticated;
  ok := false; BEGIN PERFORM public.invoice_cancel_with_credit_note(v_draft, 'F', NULL); EXCEPTION WHEN SQLSTATE '42501' THEN ok := true; WHEN SQLSTATE 'P0002' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '(5) annulation cross-org acceptée'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-invoices-credit-note B (fonctionnel) : OK';
END $$;
ROLLBACK;
```

(Le bloc « fixture intervention » se recopie depuis `assert-invoices-unique.sql`, qui insère déjà un client et une intervention minimale ; garder les mêmes colonnes.)

- [ ] **Step 3: Rejouer**

```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260922_1_planned_order.sql --migration supabase/migrations/20260923_1_invoices_hub.sql --migration supabase/migrations/20260923_2_invoices_unique_issued_per_intervention.sql --migration supabase/migrations/20260923_3_invoices_pennylane_import.sql --migration supabase/migrations/20260923_4_invoices_credit_note.sql --assert scripts/migration-rehearsal/assert-invoices.sql --assert scripts/migration-rehearsal/assert-invoices-unique.sql --assert scripts/migration-rehearsal/assert-invoices-import.sql --assert scripts/migration-rehearsal/assert-invoices-credit-note.sql
```

Expected : les 8 NOTICE « OK ». Note : `assert-invoices-unique.sql` (12) attend qu'une 2ᵉ émission sur la même intervention soit refusée — toujours vrai (les deux sont des factures) ; si une assertion existante compte les index par prédicat, l'adapter.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923_4_invoices_credit_note.sql scripts/migration-rehearsal/assert-invoices-credit-note.sql
git commit -m "feat(facturation): avoir — RPC invoice_cancel_with_credit_note, index unique restreint aux factures, credited_number (hub phase 3)"
```

---

### Task 2: Modèle pur — PDF d'avoir et messages

**Files:**
- Modify: `src/lib/invoiceDocumentModel.js`
- Test: `scripts/invoice-document-model.test.mjs`

**Interfaces:**
- Produces: pour `invoice.kind === 'credit_note'`, `buildInvoicePdfModel` renvoie `title: 'AVOIR'`, `creditedNumber`, `payment: [CREDIT_NOTE_PAYMENT_NOTE]`, `legal: []`, `discountLine: null`, montants négatifs formatés (`-102,00 €`) ; export `CREDIT_NOTE_PAYMENT_NOTE = 'Avoir à déduire de votre prochain règlement, ou remboursé sur simple demande.'` ; `INVOICE_RPC_MESSAGES` gagne `already_credited`, `credit_note_source_invalid`, `credited_invoice_not_imported`.

- [ ] **Step 1: Tests qui échouent**

```js
test('buildInvoicePdfModel : avoir — titre, facture créditée, montants négatifs, mention de règlement dédiée', () => {
  const avoir = { ...ISSUED, kind: 'credit_note', number: 'F-2026-00013', credited_number: 'F-2026-00012', subject: 'Avoir sur la facture F-2026-00012',
    total_ht: -92.73, total_tva: -9.27, total_ttc: -102, vat_breakdown: [{ rate: 10, base: -92.73, amount: -9.27 }], discount: null };
  const lines = LINES.map((l) => ({ ...l, unit_price_ht: -l.unit_price_ht, ht: -l.ht, tva: -l.tva, ttc: -l.ttc }));
  const pdf = buildInvoicePdfModel({ invoice: avoir, lines, company: COMPANY, invoicing: INVOICING });
  assert.equal(pdf.title, 'AVOIR');
  assert.equal(pdf.creditedNumber, 'F-2026-00012');
  assert.equal(pdf.totals.ttc, '-102,00 €');
  assert.equal(pdf.rows[0].ht, '-81,82 €');
  assert.deepEqual(pdf.vatRows, [{ rate: '10 %', base: '-92,73 €', amount: '-9,27 €' }]);
  assert.deepEqual(pdf.payment, [CREDIT_NOTE_PAYMENT_NOTE]);
  assert.deepEqual(pdf.legal, []);
  assert.equal(pdf.discountLine, null);
});

test('invoiceErrorMessage : codes de l’avoir', () => {
  assert.match(invoiceErrorMessage(new Error('already_credited')), /déjà.*avoir/i);
  assert.match(invoiceErrorMessage(new Error('credit_note_source_invalid')), /émise/i);
  assert.match(invoiceErrorMessage(new Error('credited_invoice_not_imported')), /Pennylane/);
});
```

(importer `CREDIT_NOTE_PAYMENT_NOTE` en tête du fichier de test.) Run → FAIL.

- [ ] **Step 2: Implémenter**

Dans `invoiceDocumentModel.js` :

```js
export const CREDIT_NOTE_PAYMENT_NOTE = 'Avoir à déduire de votre prochain règlement, ou remboursé sur simple demande.';
```

Dans `buildInvoicePdfModel`, après le calcul de `payment` et avant le `return`, ajouter :

```js
  const isCreditNote = invoice.kind === 'credit_note';
```

et dans l'objet renvoyé : `payment: isCreditNote ? [CREDIT_NOTE_PAYMENT_NOTE] : payment`, `legal: isCreditNote ? [] : [invoicing.latePenalty, invoicing.discountNote].filter(Boolean)`, `discountLine: isCreditNote ? null : discountLineOf(invoice.discount)`. Messages :

```js
  already_credited: 'Cette facture a déjà été annulée par un avoir.',
  credit_note_source_invalid: 'Seule une facture émise (et non annulée) peut être annulée par un avoir.',
  credited_invoice_not_imported: 'La facture d’origine n’est pas importée dans Pennylane : l’avoir y est importé sans lien.',
```

- [ ] **Step 3: Vérifier et committer**

`node --test scripts/invoice-document-model.test.mjs` → PASS.

```bash
git add src/lib/invoiceDocumentModel.js scripts/invoice-document-model.test.mjs
git commit -m "feat(facturation): modèle PDF d'avoir (mention de règlement, sans pénalités) + messages"
```

---

### Task 3: Edge — import d'un avoir lié à sa facture

**Files:**
- Modify: `supabase/functions/pennylane-invoice-import/index.ts`

**Interfaces:**
- Produces: pour une facture `kind === 'credit_note'` : payload d'import avec `credited_invoice_id` = `pennylane_invoice_id` de la facture `credited_invoice_id` (lue via `majordhome_invoices` filtrée org) quand il existe ; sinon pas de champ et `warnings` contient `'credited_invoice_not_imported'`. Montants négatifs tels qu'enregistrés. Réponse inchangée par ailleurs.

- [ ] **Step 1: Implémenter**

Après la résolution du client (étape 2) et avant le probe, ajouter :

```ts
    // Avoir (phase 3) : lié à sa facture d'origine côté Pennylane quand elle y est importée.
    let creditedPlId: number | null = null;
    const extraWarnings: string[] = [];
    if (invoice.kind === "credit_note" && invoice.credited_invoice_id) {
      const { data: src, error: srcErr } = await supabase
        .from("majordhome_invoices").select("pennylane_invoice_id").eq("id", invoice.credited_invoice_id).eq("org_id", orgId).maybeSingle();
      if (srcErr) return jsonResponse({ error: sanitizeError(srcErr, "lecture facture créditée") }, 500, req);
      if (src?.pennylane_invoice_id) creditedPlId = Number(src.pennylane_invoice_id);
      else extraWarnings.push("credited_invoice_not_imported");
    }
```

Dans le payload : `...(creditedPlId ? { credited_invoice_id: creditedPlId } : {}),`. Dans la construction finale de `warnings` : `const warnings: string[] = [...extraWarnings];`. Mettre à jour le commentaire d'en-tête (point 4 : « facture ou avoir (montants négatifs + credited_invoice_id) »).

- [ ] **Step 2: Vérifier et committer**

`deno check supabase/functions/pennylane-invoice-import/index.ts` → clean.

```bash
git add supabase/functions/pennylane-invoice-import/index.ts
git commit -m "feat(facturation): import Pennylane d'un avoir lié à sa facture d'origine (credited_invoice_id)"
```

(Déploiement v4 par le contrôleur après revue.)

---

### Task 4: Service, hook d'annulation, dialogue, carte

**Files:**
- Modify: `src/shared/services/invoices.service.js`
- Modify: `src/shared/hooks/useInvoices.js`
- Create: `src/apps/artisan/components/facturation/CancelInvoiceDialog.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx`

**Interfaces:**
- Consumes: RPC `invoice_cancel_with_credit_note` (Task 1), `getById` (renvoie désormais `credited_number`), `buildInvoicePdfModel` (Task 2), `generateInvoicePdfBlob`, `ensurePennylaneCustomer` / `importToPennylane`, `savService.updateFields`, `ConfirmDialog` (`variant="destructive"`), `invoicingSettings`, `buildCompanyInfo`, `downloadBlob`.
- Produces:
  - `invoicesService.cancelWithCreditNote(orgId, invoiceId, numberPrefix, reason) → { data: { credit_note_id, number, credited_number, total_ttc }, error }` (RPC via `supabase.rpc`, `extractRpcResult`).
  - `useCancelInvoiceWithCreditNote(orgId).mutateAsync({ invoiceId, interventionId, numberPrefix, reason, company, invoicing, renderPdf, pennylaneEnabled })` → `{ creditNoteId, number, creditedNumber, blob, pdfPath, importWarning }`. Ordre : RPC → carte remise à facturer (`updateFields(interventionId, { invoice_id: null, invoiced_at: null })`) → PDF → Storage → attach → import (non bloquant). Erreurs post-RPC portent `err.issued = { creditNoteId, number }` (l'avoir existe légalement).
  - `CancelInvoiceDialog({ item, orgId, open, onOpenChange, onDone })` : ConfirmDialog destructif, titre « Annuler la facture par un avoir », description (numéro de la facture lu via `getById`, montant), textarea « Motif (optionnel, porté sur l'avoir) », confirmation → hook, téléchargement du PDF de l'avoir, toasts.
  - Carte : en mode hub, quand `item.invoice_id` est posé et `isTeamLeaderOrAbove`, un bouton rouge ghost « Avoir » (icône `Undo2` de lucide) ouvre le dialogue ; après succès la carte redevient « Facturer » (invalidation).

- [ ] **Step 1: Service**

```js
async function cancelWithCreditNote(orgId, invoiceId, numberPrefix, reason) {
  const { data, error } = await supabase.rpc('invoice_cancel_with_credit_note', {
    p_invoice_id: invoiceId, p_number_prefix: numberPrefix, p_reason: reason || null,
  });
  if (error) throw error;
  return extractRpcResult(data);
}
```

+ export `cancelWithCreditNote: (orgId, invoiceId, numberPrefix, reason) => withErrorHandling(() => cancelWithCreditNote(orgId, invoiceId, numberPrefix, reason), 'invoices.cancelWithCreditNote'),` (`orgId` est reçu pour homogénéité et journalisation ; la RPC dérive l'org de la facture).

- [ ] **Step 2: Hook**

```js
/**
 * Annulation d'une facture émise par un avoir (phase 3). L'avoir est émis par la base
 * (même série), la carte redevient facturable, le PDF est archivé, l'import Pennylane
 * enchaîné sans jamais faire échouer l'annulation. Erreurs post-RPC : `err.issued`.
 */
export function useCancelInvoiceWithCreditNote(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, interventionId, numberPrefix, reason, company, invoicing, renderPdf, pennylaneEnabled }) => {
      const res = await unwrapResult(invoicesService.cancelWithCreditNote(orgId, invoiceId, numberPrefix, reason));
      const creditNoteId = res.credit_note_id;
      const number = res.number;
      const fail = (message) => { const e = new Error(message); e.issued = { creditNoteId, number }; return e; };
      if (interventionId) {
        const { error: cardError } = await savService.updateFields(interventionId, { invoice_id: null, invoiced_at: null });
        if (cardError) throw fail(`Avoir ${number} émis, mais la carte n’a pas pu être remise à facturer : ${invoiceErrorMessage(cardError, cardError.message || String(cardError))}`);
      }
      let pdfPath = null;
      let blob = null;
      try {
        const { invoice, lines } = await unwrapResult(invoicesService.getById(orgId, creditNoteId));
        blob = await renderPdf(buildInvoicePdfModel({ invoice, lines, company, invoicing }), company);
        pdfPath = await unwrapResult(invoicesService.uploadPdf(orgId, invoice, blob));
        await unwrapResult(invoicesService.attachPdf(orgId, creditNoteId, pdfPath));
      } catch (err) {
        throw fail(`Avoir ${number} émis et carte remise à facturer, mais le PDF n’a pas pu être archivé : ${invoiceErrorMessage(err, err?.message || String(err))}`);
      }
      let importWarning = null;
      if (pennylaneEnabled) {
        try {
          const { invoice } = await unwrapResult(invoicesService.getById(orgId, creditNoteId));
          if (!invoice.client_id) throw new Error('invoice_without_client');
          await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, invoice.client_id));
          const imported = await unwrapResult(invoicesService.importToPennylane(orgId, creditNoteId));
          if (Array.isArray(imported?.warnings) && imported.warnings.includes('credited_invoice_not_imported')) {
            importWarning = invoiceErrorMessage(new Error('credited_invoice_not_imported'));
          }
        } catch (err) {
          importWarning = `Avoir ${number} émis et archivé, mais pas encore importé dans Pennylane : ${invoiceErrorMessage(err, err?.message || String(err))}`;
        }
      }
      return { creditNoteId, number, creditedNumber: res.credited_number, blob, pdfPath, importWarning };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
    },
  });
}
```

(Le second `getById` évite de garder l'objet du premier hors de sa portée ; acceptable, ou réutiliser la variable en la déclarant avant le `try`.)

- [ ] **Step 3: Dialogue**

```jsx
// src/apps/artisan/components/facturation/CancelInvoiceDialog.jsx
// Annulation d'une facture émise par un avoir (hub phase 3). Destructif : l'avoir est un
// document légal numéroté, l'original passe « annulée », la carte redevient facturable.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useCancelInvoiceWithCreditNote } from '@hooks/useInvoices';
import { invoicesService } from '@services/invoices.service';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { invoicingSettings, invoiceErrorMessage } from '@/lib/invoiceDocumentModel';
import { generateInvoicePdfBlob } from './InvoicePDF';
import { formatEuro, downloadBlob } from '@/lib/utils';

export default function CancelInvoiceDialog({ item, orgId, open, onOpenChange, onDone }) {
  const { settings } = useOrgSettings();
  const cancel = useCancelInvoiceWithCreditNote(orgId);
  const [invoice, setInvoice] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reason, setReason] = useState('');
  const pennylaneEnabled = Boolean(settings?.pennylane?.enabled);

  useEffect(() => {
    if (!open || !item.invoice_id) return;
    let alive = true;
    setInvoice(null); setLoadError(null); setReason('');
    invoicesService.getById(orgId, item.invoice_id).then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) setLoadError(error?.message || 'Facture introuvable');
      else setInvoice(data.invoice);
    });
    return () => { alive = false; };
  }, [open, item.invoice_id, orgId]);

  const blocked = !invoice || invoice.status !== 'issued' || invoice.kind !== 'invoice';

  const handleConfirm = async () => {
    if (blocked || cancel.isPending) return;
    const invoicing = invoicingSettings(settings);
    try {
      const r = await cancel.mutateAsync({
        invoiceId: invoice.id, interventionId: item.id, numberPrefix: invoicing.numberPrefix, reason,
        company: buildCompanyInfo(settings), invoicing, renderPdf: generateInvoicePdfBlob, pennylaneEnabled,
      });
      if (r.blob) downloadBlob(r.blob, `${r.number}.pdf`);
      toast.success(`Avoir ${r.number} émis — facture ${r.creditedNumber} annulée, carte à refacturer`, {
        action: r.blob ? { label: 'Télécharger', onClick: () => downloadBlob(r.blob, `${r.number}.pdf`) } : undefined,
      });
      if (r.importWarning) toast.warning(r.importWarning, { duration: 15000 });
      onOpenChange(false);
      onDone?.();
    } catch (err) {
      toast.error(invoiceErrorMessage(err, 'L’avoir n’a pas pu être émis'), { duration: 15000 });
      if (err?.issued) { onOpenChange(false); onDone?.(); }
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Annuler la facture par un avoir"
      description={invoice
        ? `Facture ${invoice.number} (${formatEuro(invoice.total_ttc)} TTC) : un avoir du même montant sera émis dans la même série, la facture passera « annulée » et la carte redeviendra facturable. Irréversible.`
        : loadError || 'Chargement de la facture…'}
      confirmLabel="Émettre l’avoir"
      variant="destructive"
      onConfirm={handleConfirm}
      loading={cancel.isPending}
      confirmDisabled={blocked}
    >
      <div className="mt-4 space-y-2 text-sm">
        {invoice && invoice.status !== 'issued' && <p className="text-red-700">Cette facture n’est pas émise (statut {invoice.status}).</p>}
        <label className="block text-xs font-medium text-gray-600">Motif (optionnel, porté sur l’avoir)</label>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="Erreur de tarif, prestation non réalisée…" />
        {pennylaneEnabled && <p className="text-xs text-gray-500">L’avoir sera importé dans Pennylane, lié à la facture d’origine si elle y est.</p>}
      </div>
    </ConfirmDialog>
  );
}
```

- [ ] **Step 4: Carte**

Dans `EntretienSAVCard.jsx` : importer `Undo2` de lucide, `CancelInvoiceDialog` depuis `../facturation/CancelInvoiceDialog`, un état `const [cancelOpen, setCancelOpen] = useState(false);`. Juste après le fragment du bouton « Facturée » (dans le même groupe), quand `isHubMode && item.invoice_id && isTeamLeaderOrAbove` :

```jsx
              {isTeamLeaderOrAbove && isHubMode && item.invoice_id && (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setCancelOpen(true); }}
                    title="Annuler cette facture par un avoir"
                    className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50"
                  >
                    <Undo2 className="w-3 h-3" />
                    Avoir
                  </button>
                  {cancelOpen && (
                    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <CancelInvoiceDialog item={item} orgId={orgId} open={cancelOpen} onOpenChange={setCancelOpen} onDone={onRefresh} />
                    </div>
                  )}
                </>
              )}
```

(`onRefresh` : utiliser le même callback que `FacturerEntretienDialog` reçoit en `onCreated` dans ce fichier — vérifier son nom.)

- [ ] **Step 5: Vérifier et committer**

```bash
npm run audit:quality && npx vite build
```

Test manuel (Eric, org H&E) : facturer → « Avoir » → motif → l'avoir se télécharge (titre AVOIR, montants négatifs, « Avoir sur la facture N »), la carte redevient « Facturer », Pennylane montre l'avoir lié à la facture, refacturer → numéro suivant.

```bash
git add src/shared/services/invoices.service.js src/shared/hooks/useInvoices.js src/apps/artisan/components/facturation/CancelInvoiceDialog.jsx src/apps/artisan/components/entretiens/EntretienSAVCard.jsx
git commit -m "feat(facturation): annulation d'une facture par avoir depuis la carte (hub phase 3)"
```

---

### Task 5: Documentation

- Spec § Phases : `3. ✅ **Livrée le AAAA-MM-JJ** — avoir (annulation totale, même série, import lié). Plan : docs/superpowers/plans/2026-09-23-hub-facturation-phase3-avoir.md`.
- `.claude/proposed-updates.md`, entrée hub : titre « phases 1 à 3 », commits ajoutés, bullet : « **Avoir = `invoice_cancel_with_credit_note`** (team_leader+, annulation TOTALE, une seule par facture) : copie négative émise dans la même série, original `cancelled`, carte remise à facturer (`invoice_id`/`invoiced_at` NULL), import Pennylane avec `credited_invoice_id`. L'index unique « un entretien = une facture émise » ne compte que `kind='invoice'`. Pas d'avoir partiel. »

```bash
git add docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md .claude/proposed-updates.md
git commit -m "docs(facturation): phase 3 du hub livrée (avoir)"
```

---

## Hors périmètre, à signaler
- Rejeu de l'import d'un AVOIR (la carte ne le porte plus après annulation) : nécessite une page liste des factures (phase 4).
- Avoir partiel, avoir sur un avoir : non.
- Envoi client, rapprochement : phase 4.

## Self-review
- Spec : avoir = facture négative référençant l'originale ✓ (`kind`, `credited_invoice_id`, RPC) ; immuabilité (original → `cancelled` seulement) ✓ ; même série ✓ ; import PL négatif + `credited_invoice_id` ✓ (doc vérifiée) ; carte refacturable ✓ (index restreint).
- Noms : `invoice_cancel_with_credit_note(uuid, text, text)` T1 ↔ T4 ; `credited_number` T1 (vue) ↔ T2/T4 ; `credited_invoice_not_imported` T2 ↔ T3 ↔ T4 ; `CREDIT_NOTE_PAYMENT_NOTE` T2 ↔ test.
- Gabarits : recopie de `invoice_issue` (Task 1 § 2) et du bloc fixture (assertions) — sources nommées.
