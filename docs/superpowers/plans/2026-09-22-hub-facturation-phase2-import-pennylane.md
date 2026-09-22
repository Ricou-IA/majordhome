# Hub de facturation — Phase 2 : import Pennylane, statuts, rejeu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une facture émise par Majord'home (phase 1) est importée dans Pennylane telle quelle (notre numéro, notre PDF, nos lignes et montants au centime) dans le journal de ventes principal, avec un statut d'import visible sur la carte et un rejeu en un clic quand l'archivage du PDF ou l'import a échoué.

**Architecture:** Une edge function `pennylane-invoice-import` (`verify_jwt:true`, `requireOrgMembership` team_leader+, org Pennylane activée) lit la facture et ses lignes avec le client admin, télécharge le PDF du bucket `invoices`, le dépose chez Pennylane (`/file_attachments` multipart) puis appelle `POST /customer_invoices/import` (idempotent : `pennylane_invoice_id` déjà posé ⇒ rien n'est renvoyé). Le résultat est écrit par la RPC `invoice_set_import_result` (service_role only) dans les colonnes de suivi de `invoices` (autorisées par le trigger d'immuabilité) et dans `pennylane_sync` (type `invoice`). Côté front, la chaîne d'émission enchaîne l'import après l'archivage sans jamais faire échouer l'émission ; un hook de rejeu régénère le PDF manquant et/ou relance l'import depuis la carte. La vue `majordhome_entretien_sav` expose `invoice_import_status` pour piloter le bouton de rejeu.

**Tech Stack:** PostgreSQL (migration versionnée répétée sur `scripts/migration-rehearsal/`), Deno edge function (helper `_shared/auth.ts`), Pennylane API v2 (`file_attachments`, `customer_invoices/import`), React 18 + TanStack Query v5, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md` (§ Flux étape 3 « Importer », § Phases → phase 2). Phase 1 livrée : `docs/superpowers/plans/2026-09-22-hub-facturation-phase1-emission-locale.md`.

## Global Constraints

- **Multi-tenant** (CLAUDE.md) : la RPC `invoice_set_import_result` prend un `invoice_id` sans dériver l'org d'`auth.uid()` ⇒ `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, `GRANT TO service_role` uniquement ; l'edge vérifie la membership (`requireOrgMembership(req, { orgId: body.org_id, requiredRole: 'team_leader', orgSettingsFilter: pennylane.enabled })`) et lit la facture avec `.eq('org_id', orgId)`. Vues recréées `WITH (security_invoker = true)`, `GRANT SELECT … TO service_role`. Toute écriture de l'edge lit `{ error }` et répond 5xx explicite.
- **Pennylane** : l'edge parle à Pennylane directement avec `PENNYLANE_API_TOKEN` (le proxy JSON ne fait pas de multipart). Journal = journal de ventes principal, **aucun** `PUT /ledger_entries` (refusé, phase 0). `invoice_number` = notre numéro, `external_reference` = id de la facture Majord'home (unique). Montants en CHAÎNES, `quantity` en NOMBRE, `raw_currency_unit_price` ≤ 6 décimales, code TVA `FR_200 | FR_100 | FR_55 | exempt` (`FR_55`, pas `FR_055`). Client Pennylane = mapping `pennylane_sync` type `client` (créé par `pennylaneService.getOrCreateCustomer` côté front AVANT l'appel de l'edge) ; l'edge ne prend jamais un `customer_id` du payload.
- **Une facture émise ne change pas** : seules `pdf_path`, `pennylane_*`, `import_status`, `import_error`, `import_attempted_at` bougent. L'import n'échoue jamais l'émission : un import raté = `import_status='error'` + message, rejouable.
- **Idempotence** : `pennylane_invoice_id` non null ⇒ l'edge répond `already: true` sans rien créer ; `external_reference` = id facture (Pennylane refuse un doublon, 422 « already been taken »).
- **Conventions** : services `{ data, error }` via `withErrorHandling` ; hooks `unwrapResult` ; cache keys `invoiceKeys`, `entretienSavKeys`, `pennylaneKeys` ; `logger` (pas de console.*) ; Tailwind ; UI en français ; `npm run audit:quality` et `npx vite build` verts ; pas de preview tools (Eric a son serveur). `supabase/config.toml` versionne `verify_jwt` de chaque edge. Déploiement de l'edge et application de la migration en prod = contrôleur, après revue.
- **Vue `majordhome_entretien_sav`** : `CREATE OR REPLACE VIEW` n'accepte une nouvelle colonne qu'EN FIN de liste ; la définition courante est celle de `supabase/migrations/20260922_1_planned_order.sql` (vérifiée identique à la prod le 2026-09-22, dernière colonne `i.planned_days`). `interventions.invoice_id` est un `text` qui porte soit un id Pennylane (chiffres) soit un uuid de facture Majord'home : le cast en uuid doit être protégé par un `CASE` sur le format.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260923_3_invoices_pennylane_import.sql` (créer) | `invoice_lines.vat_code`, `invoices.import_attempted_at`, `invoice_create_draft` (recopie + `vat_code`), RPC `invoice_set_import_result`, vues `majordhome_invoices` / `_invoice_lines` recréées, `majordhome_entretien_sav` + `invoice_import_status` |
| `scripts/migration-rehearsal/assert-invoices-import.sql` (créer) | Assertions structure + fonctionnel (résultat d'import posé par service_role, refusé sur brouillon, refusé à anon/authenticated) |
| `src/lib/invoiceDocumentModel.js` (modifier) | `vat_code` sur les lignes du brouillon ; codes d'erreur de l'import dans `INVOICE_RPC_MESSAGES` |
| `scripts/invoice-document-model.test.mjs` (modifier) | Tests `vat_code` + nouveaux messages |
| `supabase/functions/pennylane-invoice-import/index.ts` (créer) | Edge d'import (PDF → file_attachments → customer_invoices/import → RPC résultat + pennylane_sync) |
| `supabase/config.toml` (modifier) | `[functions.pennylane-invoice-import] verify_jwt = true` |
| `src/shared/services/invoices.service.js` (modifier) | `importToPennylane(orgId, invoiceId)`, `ensurePennylaneCustomer(orgId, clientId)` |
| `src/shared/hooks/useInvoices.js` (modifier) | Import enchaîné dans `useIssueEntretienInvoice` (non bloquant) ; `useRetryInvoiceExport(orgId)` |
| `src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx` (modifier) | Passe `pennylane: { enabled, clientId }`, toasts import |
| `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (modifier) | Bouton de rejeu quand `invoice_import_status` ∈ `pending | error` |
| `docs/superpowers/specs/2026-09-22-…-design.md`, `.claude/proposed-updates.md` (modifier) | Phase 2 livrée ; bullets ajoutés à l'entrée PENDING du hub |

---

### Task 1: Migration — `vat_code`, suivi d'import, RPC résultat, vue carte

**Files:**
- Create: `supabase/migrations/20260923_3_invoices_pennylane_import.sql`
- Create: `scripts/migration-rehearsal/assert-invoices-import.sql`

**Interfaces:**
- Consumes: `20260923_1_invoices_hub.sql` (corps de `invoice_create_draft` à recopier, sections 9 des vues), `20260923_2` (inchangée), `20260922_1_planned_order.sql` (définition courante de `majordhome_entretien_sav`), rôle `service_role` du harnais.
- Produces: colonnes `majordhome.invoice_lines.vat_code text`, `majordhome.invoices.import_attempted_at timestamptz` ; RPC `public.invoice_set_import_result(p_invoice_id uuid, p_status text, p_pennylane_invoice_id bigint DEFAULT NULL, p_pennylane_ledger_entry_id bigint DEFAULT NULL, p_error text DEFAULT NULL) RETURNS jsonb` (service_role only) ; `invoice_create_draft` accepte `vat_code` par ligne ; vues `majordhome_invoices` / `majordhome_invoice_lines` avec les nouvelles colonnes ; `majordhome_entretien_sav.invoice_import_status text` (dernière colonne).

- [ ] **Step 1: Écrire la migration**

```sql
-- supabase/migrations/20260923_3_invoices_pennylane_import.sql
-- ============================================================================
-- Hub de facturation — phase 2 : import de la facture émise dans Pennylane
-- (spec 2026-09-22, § Flux étape 3). Journal de ventes principal (décision Eric
-- 2026-09-22 soir), aucun déplacement d'écriture.
--   - invoice_lines.vat_code : code TVA Pennylane figé à la création (FR_200…),
--     pour que l'edge n'ait pas à recopier la table de correspondance du modèle.
--   - invoices.import_attempted_at : dernière tentative (succès ou échec).
--   - invoice_set_import_result : SEULE voie d'écriture du résultat d'import
--     (service_role only : prend un invoice_id sans auth.uid()).
--   - majordhome_entretien_sav.invoice_import_status : pilote le bouton de rejeu.
-- Répétée sur scripts/migration-rehearsal/ (assert-invoices-import.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colonnes
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.invoice_lines ADD COLUMN IF NOT EXISTS vat_code text;
COMMENT ON COLUMN majordhome.invoice_lines.vat_code IS
  'Code TVA Pennylane figé à la création du brouillon (FR_200, FR_100, FR_55, exempt) — VAT_CODES de src/lib/entretienInvoiceModel.js. NULL = 20 % par défaut à l''import.';

ALTER TABLE majordhome.invoices ADD COLUMN IF NOT EXISTS import_attempted_at timestamptz;
COMMENT ON COLUMN majordhome.invoices.import_attempted_at IS
  'Dernière tentative d''import Pennylane (succès ou échec), posée par invoice_set_import_result.';

-- ----------------------------------------------------------------------------
-- 2. invoice_create_draft — corps identique à 20260923_1 + vat_code par ligne
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_create_draft(p_invoice jsonb, p_lines jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_id uuid;
  v_line jsonb;
  v_count int := 0;
  v_header_ht numeric(12,2);
  v_header_tva numeric(12,2);
  v_header_ttc numeric(12,2);
  v_sum_ht numeric(12,2);
  v_sum_tva numeric(12,2);
  v_sum_ttc numeric(12,2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := (p_invoice->>'org_id')::uuid;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_org AND user_id = v_user LIMIT 1;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_leader_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'lines_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO majordhome.invoices (
    org_id, kind, context, client_id, contract_id, intervention_id, customer, subject, currency,
    due_days, total_ht, total_tva, total_ttc, vat_breakdown, discount, created_by
  ) VALUES (
    v_org,
    COALESCE(p_invoice->>'kind', 'invoice'),
    COALESCE(p_invoice->>'context', 'contrat'),
    (p_invoice->>'client_id')::uuid,
    (p_invoice->>'contract_id')::uuid,
    (p_invoice->>'intervention_id')::uuid,
    COALESCE(p_invoice->'customer', '{}'::jsonb),
    p_invoice->>'subject',
    COALESCE(p_invoice->>'currency', 'EUR'),
    COALESCE((p_invoice->>'due_days')::int, 30),
    COALESCE((p_invoice->>'total_ht')::numeric, 0),
    COALESCE((p_invoice->>'total_tva')::numeric, 0),
    COALESCE((p_invoice->>'total_ttc')::numeric, 0),
    COALESCE(p_invoice->'vat_breakdown', '[]'::jsonb),
    p_invoice->'discount',
    v_user
  ) RETURNING id, total_ht, total_tva, total_ttc INTO v_id, v_header_ht, v_header_tva, v_header_ttc;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_count := v_count + 1;
    INSERT INTO majordhome.invoice_lines (
      invoice_id, org_id, position, kind, label, description, quantity, unit_price_ht, vat_rate,
      discount_percent, ht, tva, ttc, ledger_account_number, ledger_account_pl_id, metier_key,
      equipment_id, category_id, vat_code
    ) VALUES (
      v_id, v_org,
      COALESCE((v_line->>'position')::int, v_count),
      COALESCE(v_line->>'kind', 'libre'),
      v_line->>'label',
      v_line->>'description',
      COALESCE((v_line->>'quantity')::numeric, 1),
      COALESCE((v_line->>'unit_price_ht')::numeric, 0),
      COALESCE((v_line->>'vat_rate')::numeric, 20),
      COALESCE((v_line->>'discount_percent')::numeric, 0),
      COALESCE((v_line->>'ht')::numeric, 0),
      COALESCE((v_line->>'tva')::numeric, 0),
      COALESCE((v_line->>'ttc')::numeric, 0),
      v_line->>'ledger_account_number',
      (v_line->>'ledger_account_pl_id')::bigint,
      v_line->>'metier_key',
      (v_line->>'equipment_id')::uuid,
      (v_line->>'category_id')::uuid,
      v_line->>'vat_code'
    );
  END LOOP;

  SELECT sum(ht), sum(tva), sum(ttc) INTO v_sum_ht, v_sum_tva, v_sum_ttc
    FROM majordhome.invoice_lines WHERE invoice_id = v_id;
  IF v_sum_ht IS DISTINCT FROM v_header_ht
     OR v_sum_tva IS DISTINCT FROM v_header_tva
     OR v_sum_ttc IS DISTINCT FROM v_header_ttc
  THEN
    RAISE EXCEPTION 'totals_mismatch' USING ERRCODE = '22023',
      DETAIL = format('en-tête (ht=%s, tva=%s, ttc=%s) ≠ somme des lignes (ht=%s, tva=%s, ttc=%s)',
        v_header_ht, v_header_tva, v_header_ttc, v_sum_ht, v_sum_tva, v_sum_ttc);
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPC — résultat d'import (service_role only : invoice_id dans le payload)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_set_import_result(
  p_invoice_id uuid,
  p_status text,
  p_pennylane_invoice_id bigint DEFAULT NULL,
  p_pennylane_ledger_entry_id bigint DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_status NOT IN ('pending', 'imported', 'error') THEN
    RAISE EXCEPTION 'invalid_import_status' USING ERRCODE = '22023', DETAIL = p_status;
  END IF;
  SELECT status INTO v_status FROM majordhome.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'issued' THEN
    RAISE EXCEPTION 'invoice_not_issued' USING ERRCODE = '42501', DETAIL = v_status;
  END IF;
  IF p_status = 'imported' AND p_pennylane_invoice_id IS NULL THEN
    RAISE EXCEPTION 'pennylane_invoice_id_required' USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.invoices
     SET import_status = p_status,
         import_error = CASE WHEN p_status = 'error' THEN left(p_error, 2000) ELSE NULL END,
         import_attempted_at = now(),
         pennylane_invoice_id = COALESCE(p_pennylane_invoice_id, pennylane_invoice_id),
         pennylane_ledger_entry_id = COALESCE(p_pennylane_ledger_entry_id, pennylane_ledger_entry_id)
   WHERE id = p_invoice_id;

  RETURN jsonb_build_object('id', p_invoice_id, 'import_status', p_status,
    'pennylane_invoice_id', p_pennylane_invoice_id, 'import_attempted_at', now());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_set_import_result(uuid, text, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_set_import_result(uuid, text, bigint, bigint, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Vues miroirs recréées (SELECT * est figé à la création : nouvelles colonnes)
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.majordhome_invoices;
CREATE VIEW public.majordhome_invoices WITH (security_invoker = true) AS
  SELECT * FROM majordhome.invoices;

DROP VIEW IF EXISTS public.majordhome_invoice_lines;
CREATE VIEW public.majordhome_invoice_lines WITH (security_invoker = true) AS
  SELECT * FROM majordhome.invoice_lines;

REVOKE ALL ON public.majordhome_invoices, public.majordhome_invoice_lines FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.majordhome_invoices TO authenticated;
GRANT SELECT ON public.majordhome_invoice_lines TO authenticated;
GRANT SELECT ON public.majordhome_invoices, public.majordhome_invoice_lines TO service_role;

COMMENT ON VIEW public.majordhome_invoices IS
  'Miroir auto-updatable de majordhome.invoices (security_invoker, RLS org). Lecture front ; sur un brouillon, UPDATE libre sauf status/number/year/issued_at/invoice_date/due_at réservés à la RPC invoice_issue ; sur une facture émise, UPDATE limité aux colonnes de suivi (pdf_path, pennylane_*, import_*) ; INSERT via invoice_create_draft ; résultat d''import via invoice_set_import_result (service_role).';
COMMENT ON VIEW public.majordhome_invoice_lines IS
  'Miroir de majordhome.invoice_lines (security_invoker, RLS org). Lecture front ; écriture via invoice_create_draft.';

-- ----------------------------------------------------------------------------
-- 5. majordhome_entretien_sav + invoice_import_status (EN FIN de liste)
--    Définition recopiée de 20260922_1_planned_order.sql (= prod au 2026-09-22),
--    seule la dernière colonne est ajoutée. `interventions.invoice_id` (text)
--    porte un id Pennylane (chiffres) ou un uuid Majord'home : le cast est
--    protégé par le CASE (un cast direct casserait TOUTE la vue).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.majordhome_entretien_sav WITH (security_invoker = true) AS
 SELECT i.id,
    -- … recopier ICI, à l'identique, TOUTES les colonnes et les jointures de la
    -- définition de 20260922_1_planned_order.sql (de `i.project_id` à `i.planned_days`
    -- inclus, puis FROM / LEFT JOIN / WHERE), en insérant la ligne suivante
    -- juste après `i.planned_days,` et avant `FROM majordhome.interventions i` :
    --
    --    CASE WHEN i.invoice_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    --         THEN ( SELECT inv.import_status FROM majordhome.invoices inv WHERE inv.id = i.invoice_id::uuid)
    --         ELSE NULL::text END AS invoice_import_status
    -- …
```

Le bloc « 5. » ci-dessus est un gabarit : l'implémenteur ouvre `supabase/migrations/20260922_1_planned_order.sql`, copie intégralement le `CREATE OR REPLACE VIEW public.majordhome_entretien_sav …;` qui s'y trouve (le bloc va de `SELECT i.id,` jusqu'au `;` final après le `WHERE`), et insère la colonne `invoice_import_status` en dernière position exactement comme indiqué. Aucune autre ligne ne change.

- [ ] **Step 2: Écrire les assertions**

```sql
-- assert-invoices-import.sql — vérifie 20260923_3_invoices_pennylane_import.sql.
-- Un écart lève une exception → run.mjs sort en ECHEC.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; v_last text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='invoice_lines' AND column_name='vat_code') THEN
    RAISE EXCEPTION 'invoice_lines.vat_code absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='invoices' AND column_name='import_attempted_at') THEN
    RAISE EXCEPTION 'invoices.import_attempted_at absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoices' AND column_name='import_attempted_at') THEN
    RAISE EXCEPTION 'vue majordhome_invoices sans import_attempted_at (non recréée)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='majordhome_invoice_lines' AND column_name='vat_code') THEN
    RAISE EXCEPTION 'vue majordhome_invoice_lines sans vat_code (non recréée)'; END IF;
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema='public' AND table_name='majordhome_entretien_sav' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'invoice_import_status' THEN RAISE EXCEPTION 'majordhome_entretien_sav : dernière colonne % au lieu de invoice_import_status', v_last; END IF;
  SELECT count(*) INTO n FROM pg_class c WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN ('majordhome_invoices','majordhome_invoice_lines','majordhome_entretien_sav') AND c.reloptions::text LIKE '%security_invoker=true%';
  IF n <> 3 THEN RAISE EXCEPTION 'security_invoker attendu sur 3 vues, trouvé %', n; END IF;
  IF has_function_privilege('anon', 'public.invoice_set_import_result(uuid, text, bigint, bigint, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_set_import_result exécutable par anon'; END IF;
  IF has_function_privilege('authenticated', 'public.invoice_set_import_result(uuid, text, bigint, bigint, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_set_import_result exécutable par authenticated'; END IF;
  IF NOT has_function_privilege('service_role', 'public.invoice_set_import_result(uuid, text, bigint, bigint, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_set_import_result non exécutable par service_role'; END IF;
  IF pg_get_functiondef('public.invoice_create_draft(jsonb, jsonb)'::regprocedure) NOT LIKE '%vat_code%' THEN RAISE EXCEPTION 'invoice_create_draft n''insère pas vat_code'; END IF;
  RAISE NOTICE 'assert-invoices-import A (structure) : OK';
END $$;

-- ── B. Fonctionnel (rollback) ──────────────────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_id uuid; v_draft uuid; v_res jsonb; v_row record; ok boolean; n int;
BEGIN
  SELECT om.user_id INTO v_membre FROM core.organization_members om JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin','team_leader') LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer avec profil'; END IF;

  -- (1) Brouillon avec vat_code, émis, comme team_leader
  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;
  v_id := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'total_ht', 10, 'total_tva', 1, 'total_ttc', 11),
    jsonb_build_array(jsonb_build_object('label', 'Entretien', 'vat_rate', 10, 'vat_code', 'FR_100', 'ht', 10, 'tva', 1, 'ttc', 11)));
  SELECT vat_code INTO v_row FROM public.majordhome_invoice_lines WHERE invoice_id = v_id;
  IF v_row.vat_code <> 'FR_100' THEN RAISE EXCEPTION '(1) vat_code % au lieu de FR_100', v_row.vat_code; END IF;
  PERFORM public.invoice_issue(v_id, 'F');
  v_draft := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  -- (2) authenticated ne peut pas poser un résultat d'import
  ok := false;
  BEGIN
    PERFORM public.invoice_set_import_result(v_id, 'imported', 123, 456, NULL);
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(2) authenticated a posé un résultat d''import'; END IF;
  RESET ROLE;

  -- (3) service_role : succès puis échec, colonnes de suivi ; brouillon refusé
  SET LOCAL ROLE service_role;
  v_res := public.invoice_set_import_result(v_id, 'imported', 123, 456, NULL);
  SELECT import_status, import_error, import_attempted_at, pennylane_invoice_id, pennylane_ledger_entry_id INTO v_row
    FROM majordhome.invoices WHERE id = v_id;
  IF v_row.import_status <> 'imported' OR v_row.pennylane_invoice_id <> 123 OR v_row.pennylane_ledger_entry_id <> 456
     OR v_row.import_attempted_at IS NULL OR v_row.import_error IS NOT NULL THEN
    RAISE EXCEPTION '(3) résultat imported mal posé : %', to_jsonb(v_row); END IF;
  v_res := public.invoice_set_import_result(v_id, 'error', NULL, NULL, 'Pennylane 422 : test');
  SELECT import_status, import_error, pennylane_invoice_id INTO v_row FROM majordhome.invoices WHERE id = v_id;
  IF v_row.import_status <> 'error' OR v_row.import_error NOT LIKE 'Pennylane 422%' OR v_row.pennylane_invoice_id <> 123 THEN
    RAISE EXCEPTION '(3) résultat error mal posé : %', to_jsonb(v_row); END IF;
  ok := false;
  BEGIN
    PERFORM public.invoice_set_import_result(v_draft, 'imported', 1, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(3) résultat posé sur un brouillon'; END IF;
  ok := false;
  BEGIN
    PERFORM public.invoice_set_import_result(v_id, 'bogus', NULL, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(3) statut invalide accepté'; END IF;
  RESET ROLE;

  -- (4) La vue carte expose le statut pour un invoice_id uuid, NULL pour un id Pennylane
  SELECT count(*) INTO n FROM public.majordhome_entretien_sav WHERE invoice_import_status IS NOT NULL;
  RAISE NOTICE '(4) % carte(s) avec statut d''import (0 attendu sur le snapshot : interventions sans données)', n;

  RAISE NOTICE 'assert-invoices-import B (fonctionnel) : OK';
END $$;
ROLLBACK;
```

Si `SET LOCAL ROLE service_role` échoue sur le harnais (rôle absent de `bootstrap-pre.sql`), ajouter dans `bootstrap-pre.sql` la création du rôle `service_role` (`CREATE ROLE service_role NOLOGIN BYPASSRLS;`) à côté des autres rôles Supabase — vérifier d'abord avec `grep -n service_role scripts/migration-rehearsal/bootstrap-pre.sql`.

- [ ] **Step 3: Rejouer**

```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260923_1_invoices_hub.sql --migration supabase/migrations/20260923_2_invoices_unique_issued_per_intervention.sql --migration supabase/migrations/20260923_3_invoices_pennylane_import.sql --assert scripts/migration-rehearsal/assert-invoices.sql --assert scripts/migration-rehearsal/assert-invoices-unique.sql --assert scripts/migration-rehearsal/assert-invoices-import.sql
```

Expected : les six NOTICE « OK » (A et B des trois fichiers), `run.mjs` en succès. Si la recréation de `majordhome_entretien_sav` échoue en « cannot change name of view column », la colonne n'est pas en dernière position ou une colonne intermédiaire diffère de la définition en prod : recopier à nouveau depuis `20260922_1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923_3_invoices_pennylane_import.sql scripts/migration-rehearsal/assert-invoices-import.sql scripts/migration-rehearsal/bootstrap-pre.sql
git commit -m "feat(facturation): suivi d'import Pennylane — vat_code, import_attempted_at, RPC invoice_set_import_result, statut sur la carte (hub phase 2)"
```

(L'application en prod est faite par le contrôleur après revue.)

---

### Task 2: Modèle pur — `vat_code` et messages d'import

**Files:**
- Modify: `src/lib/invoiceDocumentModel.js`
- Test: `scripts/invoice-document-model.test.mjs`

**Interfaces:**
- Consumes: lignes de `buildEntretienInvoice` (`vatCode` = `'FR_200' | 'FR_100' | 'FR_55' | 'exempt' | null`).
- Produces: chaque ligne de `buildInvoiceDraft().lines` porte `vat_code: string|null` ; `INVOICE_RPC_MESSAGES` gagne `customer_not_synced`, `pdf_missing`, `invoice_not_issued`, `pennylane_import_failed`, `pennylane_disabled`, `already_imported`.

- [ ] **Step 1: Tests qui échouent**

Dans `scripts/invoice-document-model.test.mjs`, ajouter `vatCode: 'FR_100'` aux deux lignes de la fixture `MODEL` (à côté de `vatPercent: 10`), puis dans le test « buildInvoiceDraft : en-tête + lignes persistables » ajouter `vat_code: 'FR_100'` à l'objet attendu `lines[0]` (après `discount_percent`), et un test :

```js
test('buildInvoiceDraft : vat_code figé depuis le modèle, null si absent', () => {
  const { lines } = buildInvoiceDraft({ model: MODEL, orgId: 'o', client: CLIENT, dueDays: 30 });
  assert.equal(lines[0].vat_code, 'FR_100');
  const sans = { ...MODEL, lines: [{ ...MODEL.lines[0], vatCode: undefined }] };
  assert.equal(buildInvoiceDraft({ model: sans, orgId: 'o', client: CLIENT, dueDays: 30 }).lines[0].vat_code, null);
});

test('invoiceErrorMessage : codes de l’import Pennylane', () => {
  assert.match(invoiceErrorMessage(new Error('customer_not_synced')), /client.*Pennylane/i);
  assert.match(invoiceErrorMessage(new Error('pdf_missing')), /PDF/);
  assert.match(invoiceErrorMessage(new Error('pennylane_import_failed (étape import)')), /Pennylane/);
});
```

Run: `node --test scripts/invoice-document-model.test.mjs` → FAIL (`vat_code` undefined / messages non mappés).

- [ ] **Step 2: Implémenter**

Dans `buildInvoiceDraft`, après `category_id: l.categoryId ?? null,` :

```js
      // Code TVA Pennylane figé (VAT_CODES du modèle d'entretien) : l'edge d'import le
      // relit tel quel, sans recopier la table de correspondance côté Deno.
      vat_code: l.vatCode ?? null,
```

Dans `INVOICE_RPC_MESSAGES`, ajouter :

```js
  customer_not_synced: 'Le client n’a pas encore de fiche Pennylane : rejouez l’import depuis la carte (elle sera créée).',
  pdf_missing: 'Le PDF de la facture n’est pas archivé : rejouez l’export depuis la carte.',
  invoice_not_issued: 'Cette facture n’est pas émise : rien à importer.',
  pennylane_import_failed: 'Pennylane a refusé l’import de la facture : voir le détail et rejouer depuis la carte.',
  pennylane_disabled: 'Pennylane n’est pas activé pour cette organisation.',
  already_imported: 'Cette facture est déjà importée dans Pennylane.',
```

- [ ] **Step 3: Vérifier et committer**

Run: `node --test scripts/invoice-document-model.test.mjs` → tous PASS.

```bash
git add src/lib/invoiceDocumentModel.js scripts/invoice-document-model.test.mjs
git commit -m "feat(facturation): vat_code figé sur les lignes du brouillon + messages d'import Pennylane"
```

---

### Task 3: Edge function `pennylane-invoice-import`

**Files:**
- Create: `supabase/functions/pennylane-invoice-import/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `requireOrgMembership`, `jsonResponse`, `corsHeaders`, `sanitizeError` de `../_shared/auth.ts` ; vues `majordhome_invoices`, `majordhome_invoice_lines`, `majordhome_pennylane_sync` (service_role SELECT ; INSERT/UPDATE sur `pennylane_sync`) ; RPC `invoice_set_import_result` ; bucket `invoices` ; env `PENNYLANE_API_TOKEN`, `PENNYLANE_BASE_URL`.
- Produces: `POST` body `{ invoice_id: uuid, org_id: uuid }` → `201 { ok: true, pennylane_invoice_id, ledger_entry_id, public_file_url, sync_warning? }` ; `200 { ok: true, already: true, pennylane_invoice_id }` ; erreurs `400 | 401/403 (auth) | 404 invoice_not_found | 409 invoice_not_issued | 409 pdf_missing | 409 customer_not_synced | 502 { error: 'pennylane_import_failed', step, detail }` — toute erreur Pennylane pose `import_status='error'` via la RPC avant de répondre.

- [ ] **Step 1: Écrire l'edge**

```ts
// supabase/functions/pennylane-invoice-import/index.ts
// ============================================================================
// Hub de facturation — phase 2 : importe dans Pennylane une facture ÉMISE par
// Majord'home (spec 2026-09-22, § Flux étape 3). Journal de ventes principal :
// aucun déplacement d'écriture (refusé par l'API, phase 0).
//   1. facture + lignes (client admin, filtre org) ; déjà importée ⇒ already
//   2. client Pennylane = mapping pennylane_sync type client (jamais du payload)
//   3. PDF archivé (bucket invoices) → POST /file_attachments (multipart)
//   4. POST /customer_invoices/import : notre numéro, external_reference = id
//      facture (unique), lignes et montants au centime tels qu'enregistrés
//   5. résultat → RPC invoice_set_import_result (service_role) + pennylane_sync
// Toute écriture lit { error } ; un échec Pennylane est ENREGISTRÉ (import_status
// = error + message) puis répondu 502 : visible et rejouable, jamais silencieux.
// Auth : verify_jwt + requireOrgMembership(team_leader+, org Pennylane activée).
// ============================================================================
import { requireOrgMembership, jsonResponse, corsHeaders, sanitizeError } from "../_shared/auth.ts";

const PENNYLANE_API_TOKEN = Deno.env.get("PENNYLANE_API_TOKEN") || "";
const PENNYLANE_BASE_URL = Deno.env.get("PENNYLANE_BASE_URL") || "https://app.pennylane.com/api/external/v2";
const INVOICES_BUCKET = "invoices";

interface Body { invoice_id?: string; org_id?: string }

async function pl(method: string, path: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { Authorization: `Bearer ${PENNYLANE_API_TOKEN}`, Accept: "application/json" };
  const init: RequestInit = { method, headers };
  if (form) init.body = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(`${PENNYLANE_BASE_URL}${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** Montant Pennylane = chaîne à 2 décimales. */
const money = (n: unknown) => Number(n ?? 0).toFixed(2);
/** PU HT ≤ 6 décimales, sans zéros de queue (schéma PL, vécu 2026-09-22). */
const unitPrice = (n: unknown) => Number(n ?? 0).toFixed(6).replace(/\.?0+$/, "") || "0";
const plError = (data: unknown) => (typeof data === "string" ? data : JSON.stringify(data ?? {})).slice(0, 1500);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return jsonResponse({ error: "Corps JSON invalide" }, 400); }
  if (!body.invoice_id || !body.org_id) return jsonResponse({ error: "invoice_id et org_id sont requis" }, 400);

  const auth = await requireOrgMembership(req, {
    orgId: body.org_id,
    requiredRole: "team_leader",
    orgSettingsFilter: (s) => (s.pennylane as { enabled?: boolean } | undefined)?.enabled === true,
  });
  if (!auth.ok) return auth.response;
  if (!PENNYLANE_API_TOKEN) return jsonResponse({ error: "PENNYLANE_API_TOKEN manquant" }, 500);
  const { supabase, orgId, userId } = auth;

  const recordResult = async (status: "imported" | "error", plId: number | null, ledgerId: number | null, error: string | null) => {
    const { error: rpcError } = await supabase.rpc("invoice_set_import_result", {
      p_invoice_id: body.invoice_id, p_status: status, p_pennylane_invoice_id: plId,
      p_pennylane_ledger_entry_id: ledgerId, p_error: error,
    });
    return rpcError ? sanitizeError(rpcError, "invoice_set_import_result failed") : null;
  };

  try {
    // 1. Facture + lignes
    const { data: invoice, error: invErr } = await supabase
      .from("majordhome_invoices").select("*").eq("id", body.invoice_id).eq("org_id", orgId).maybeSingle();
    if (invErr) return jsonResponse({ error: sanitizeError(invErr, "lecture facture") }, 500);
    if (!invoice) return jsonResponse({ error: "invoice_not_found" }, 404);
    if (invoice.status !== "issued") return jsonResponse({ error: "invoice_not_issued", status: invoice.status }, 409);
    if (invoice.pennylane_invoice_id) {
      return jsonResponse({ ok: true, already: true, pennylane_invoice_id: invoice.pennylane_invoice_id }, 200);
    }
    if (!invoice.pdf_path) return jsonResponse({ error: "pdf_missing" }, 409);

    const { data: lines, error: linesErr } = await supabase
      .from("majordhome_invoice_lines").select("*").eq("invoice_id", invoice.id).eq("org_id", orgId).order("position");
    if (linesErr) return jsonResponse({ error: sanitizeError(linesErr, "lecture lignes") }, 500);
    if (!lines || lines.length === 0) return jsonResponse({ error: "lines_required" }, 409);

    // 2. Client Pennylane (mapping posé par le front via getOrCreateCustomer)
    const { data: sync, error: syncErr } = await supabase
      .from("majordhome_pennylane_sync").select("pennylane_id")
      .eq("org_id", orgId).eq("entity_type", "client").eq("local_id", invoice.client_id).maybeSingle();
    if (syncErr) return jsonResponse({ error: sanitizeError(syncErr, "lecture mapping client") }, 500);
    if (!sync?.pennylane_id) return jsonResponse({ error: "customer_not_synced" }, 409);

    // 3. PDF archivé → Pennylane
    const { data: file, error: dlErr } = await supabase.storage.from(INVOICES_BUCKET).download(invoice.pdf_path);
    if (dlErr || !file) {
      const msg = `pdf_download_failed: ${sanitizeError(dlErr, "download")}`;
      await recordResult("error", null, null, msg);
      return jsonResponse({ error: "pdf_missing", detail: msg }, 409);
    }
    const form = new FormData();
    const filename = `${invoice.number}.pdf`;
    form.append("file", new Blob([await file.arrayBuffer()], { type: "application/pdf" }), filename);
    form.append("filename", filename);
    const up = await pl("POST", "/file_attachments", undefined, form);
    if (up.status >= 300) {
      const detail = plError(up.data);
      await recordResult("error", null, null, `file_attachment ${up.status}: ${detail}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "file_attachment", status: up.status, detail }, 502);
    }
    const fileAttachmentId = (up.data as { id?: number })?.id;

    // 4. Import : montants ENREGISTRÉS, jamais recalculés
    const payload = {
      file_attachment_id: fileAttachmentId,
      date: invoice.invoice_date,
      deadline: invoice.due_at || invoice.invoice_date,
      customer_id: Number(sync.pennylane_id),
      currency: "EUR",
      currency_amount_before_tax: money(invoice.total_ht),
      currency_amount: money(invoice.total_ttc),
      currency_tax: money(invoice.total_tva),
      label: invoice.subject || invoice.number,
      invoice_number: invoice.number,
      external_reference: invoice.id,
      invoice_lines: lines.map((l: Record<string, unknown>) => ({
        label: l.description ? `${l.label} — ${l.description}` : l.label,
        quantity: Number(l.quantity),
        unit: "piece",
        raw_currency_unit_price: unitPrice(l.unit_price_ht),
        vat_rate: (l.vat_code as string) || "FR_200",
        currency_amount: money(l.ttc),
        currency_tax: money(l.tva),
        ...(l.ledger_account_pl_id ? { ledger_account_id: Number(l.ledger_account_pl_id) } : {}),
      })),
    };
    const imported = await pl("POST", "/customer_invoices/import", payload);
    console.log(`[pennylane-invoice-import] ${imported.status} invoice=${invoice.number} by ${userId} (org ${orgId}) → ${JSON.stringify(imported.data).slice(0, 1500)}`);
    if (imported.status >= 300) {
      const detail = plError(imported.data);
      await recordResult("error", null, null, `import ${imported.status}: ${detail}`);
      return jsonResponse({ error: "pennylane_import_failed", step: "import", status: imported.status, detail }, 502);
    }
    const plInvoice = imported.data as { id?: number; ledger_entry?: { id?: number }; public_file_url?: string; file_url?: string };
    if (!plInvoice?.id) {
      await recordResult("error", null, null, "import: réponse Pennylane sans id");
      return jsonResponse({ error: "pennylane_import_failed", step: "import", detail: "réponse sans id" }, 502);
    }
    const ledgerEntryId = plInvoice.ledger_entry?.id ?? null;

    // 5. Résultat (la facture Pennylane EXISTE désormais : tout échec ici est répondu avec son id)
    const rpcFail = await recordResult("imported", plInvoice.id, ledgerEntryId, null);
    if (rpcFail) {
      console.error(`[pennylane-invoice-import] invoice_set_import_result failed for ${invoice.number} (PL ${plInvoice.id}): ${rpcFail}`);
      return jsonResponse({ error: "import_recorded_failed", pennylane_invoice_id: plInvoice.id, detail: rpcFail }, 500);
    }
    const { error: upsertErr } = await supabase.from("majordhome_pennylane_sync").upsert({
      org_id: orgId, entity_type: "invoice", local_id: invoice.id,
      pennylane_id: plInvoice.id, pennylane_number: invoice.number, external_reference: invoice.id,
      sync_status: "synced", last_synced_at: new Date().toISOString(),
      metadata: { source: "hub", intervention_id: invoice.intervention_id, public_file_url: plInvoice.public_file_url ?? null, file_url: plInvoice.file_url ?? null, ledger_entry_id: ledgerEntryId },
    }, { onConflict: "org_id,entity_type,local_id" });
    const syncWarning = upsertErr ? sanitizeError(upsertErr, "pennylane_sync upsert") : null;
    if (syncWarning) console.error(`[pennylane-invoice-import] pennylane_sync upsert failed for ${invoice.number}: ${syncWarning}`);

    return jsonResponse({
      ok: true, pennylane_invoice_id: plInvoice.id, ledger_entry_id: ledgerEntryId,
      public_file_url: plInvoice.public_file_url ?? null, ...(syncWarning ? { sync_warning: syncWarning } : {}),
    }, 201);
  } catch (err) {
    console.error("[pennylane-invoice-import] Error:", err);
    return jsonResponse({ error: sanitizeError(err, "Internal error") }, 500);
  }
});
```

- [ ] **Step 2: `config.toml`**

Ajouter, à la suite de l'entrée `[functions.pennylane-ledger-push]` :

```toml
[functions.pennylane-invoice-import]
verify_jwt = true
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/pennylane-invoice-import/index.ts`
Expected : aucune erreur de type (les imports `jsr:`/`npm:` du helper se résolvent avec le réseau ; une erreur purement réseau se note dans le rapport, une erreur de type se corrige).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/pennylane-invoice-import/index.ts supabase/config.toml
git commit -m "feat(facturation): edge pennylane-invoice-import — import de la facture émise (PDF + montants figés) dans le journal de ventes"
```

(Déploiement par le contrôleur via `deploy_edge_function` — fichiers `index.ts` + `../_shared/auth.ts` — après revue.)

---

### Task 4: Service et hooks — import enchaîné, rejeu

**Files:**
- Modify: `src/shared/services/invoices.service.js`
- Modify: `src/shared/hooks/useInvoices.js`

**Interfaces:**
- Consumes: edge `pennylane-invoice-import` (Task 3) ; `pennylaneService.getOrCreateCustomer(client, orgId)` et `pennylaneService.getSyncRecord(orgId, 'client', clientId)` (exportés, `{ data, error }`) ; `clientsService.getClientById(clientId)` (`{ data, error }`) ; `invoiceErrorMessage` (Task 2) ; `buildInvoicePdfModel`.
- Produces:
  - `invoicesService.ensurePennylaneCustomer(orgId, clientId) → { data: pennylaneCustomerId, error }`
  - `invoicesService.importToPennylane(orgId, invoiceId) → { data: { ok, already?, pennylane_invoice_id, public_file_url? }, error }` (l'erreur porte `.code` = `error` de l'edge et `.step`).
  - `useIssueEntretienInvoice(orgId).mutateAsync({ …, pennylane: { enabled: boolean, clientId: string } | null })` → `{ invoiceId, number, pdfPath, blob, pennylaneInvoiceId: number|null, importWarning: string|null }`.
  - `useRetryInvoiceExport(orgId).mutateAsync({ invoiceId, clientId, company, invoicing, renderPdf, pennylaneEnabled })` → `{ number, pdfRegenerated: boolean, imported: boolean, alreadyImported: boolean }`.

- [ ] **Step 1: Service**

Ajouter les imports en tête de `invoices.service.js` :

```js
import { pennylaneService } from './pennylane.service';
import { clientsService } from './clients.service';
```

Puis, avant `export const invoicesService` :

```js
/**
 * Garantit la fiche Pennylane du client (mapping `pennylane_sync` type client) AVANT
 * l'import : l'edge ne prend jamais un customer_id du payload, elle relit le mapping.
 */
async function ensurePennylaneCustomer(orgId, clientId) {
  const { data: existing, error: syncError } = await pennylaneService.getSyncRecord(orgId, 'client', clientId);
  if (syncError) throw syncError;
  if (existing?.pennylane_id) return existing.pennylane_id;
  const { data: client, error: clientError } = await clientsService.getClientById(clientId);
  if (clientError) throw clientError;
  if (!client) throw new Error('Client introuvable');
  const { data: customerId, error } = await pennylaneService.getOrCreateCustomer(client, orgId);
  if (error) throw error;
  return customerId;
}

/** Appelle l'edge d'import ; l'erreur remonte le code de l'edge (`customer_not_synced`…) et l'étape. */
async function importToPennylane(orgId, invoiceId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Non authentifié');
  const { data, error } = await supabase.functions.invoke('pennylane-invoice-import', { body: { invoice_id: invoiceId, org_id: orgId } });
  if (error) {
    let detail = null;
    try { detail = await error.context?.json?.(); } catch { /* corps illisible */ }
    const err = new Error(detail?.error ? `${detail.error}${detail.step ? ` (étape ${detail.step})` : ''}${detail.detail ? ` — ${detail.detail}` : ''}` : error.message);
    err.code = detail?.error || null;
    err.step = detail?.step || null;
    throw err;
  }
  return data;
}
```

et dans l'objet exporté :

```js
  ensurePennylaneCustomer: (orgId, clientId) => withErrorHandling(() => ensurePennylaneCustomer(orgId, clientId), 'invoices.ensurePennylaneCustomer'),
  importToPennylane: (orgId, invoiceId) => withErrorHandling(() => importToPennylane(orgId, invoiceId), 'invoices.importToPennylane'),
```

Vérifier que `clientsService.getClientById` existe avec cette signature (`grep -n "getClientById" src/shared/services/clients.service.js`) ; sinon utiliser la méthode équivalente du service.

- [ ] **Step 2: Hook d'émission — import non bloquant**

Dans `useInvoices.js`, ajouter l'import `pennylaneKeys` depuis `./cacheKeys`. Dans `useIssueEntretienInvoice`, étendre la signature de `mutationFn` avec `pennylane = null` et, après le bloc PDF (avant `return`), ajouter :

```js
      // Import Pennylane (phase 2) : jamais bloquant — la facture est émise et archivée,
      // un import raté se rejoue depuis la carte (import_status = error + message).
      let pennylaneInvoiceId = null;
      let importWarning = null;
      if (pennylane?.enabled && pennylane.clientId) {
        try {
          await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, pennylane.clientId));
          const imported = await unwrapResult(invoicesService.importToPennylane(orgId, invoiceId));
          pennylaneInvoiceId = imported?.pennylane_invoice_id ?? null;
        } catch (err) {
          importWarning = `Facture ${number} émise et archivée, mais pas encore importée dans Pennylane (à rejouer depuis la carte) : ${invoiceErrorMessage(err, err?.message || String(err))}`;
        }
      }
      return { invoiceId, number, pdfPath, blob, pennylaneInvoiceId, importWarning };
```

Dans `onSettled`, ajouter `queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });`.

- [ ] **Step 3: Hook de rejeu**

Ajouter dans `useInvoices.js` :

```js
/**
 * Rejeu de l'export d'une facture ÉMISE : régénère et archive le PDF s'il manque, puis
 * importe dans Pennylane si l'org l'a activé et que la facture n'y est pas encore.
 * Idempotent : rien n'est recréé pour ce qui existe déjà.
 * @param {string} orgId  org CORE
 */
export function useRetryInvoiceExport(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * @param {object} p
     * @param {string} p.invoiceId
     * @param {string|null} p.clientId
     * @param {object} p.company  `buildCompanyInfo(settings)`
     * @param {object} p.invoicing  `invoicingSettings(settings)`
     * @param {(pdfModel: object, company: object) => Promise<Blob>} p.renderPdf
     * @param {boolean} p.pennylaneEnabled
     */
    mutationFn: async ({ invoiceId, clientId, company, invoicing, renderPdf, pennylaneEnabled }) => {
      const { invoice, lines } = await unwrapResult(invoicesService.getById(orgId, invoiceId));
      if (invoice.status !== 'issued') throw new Error('invoice_not_issued');
      let pdfRegenerated = false;
      if (!invoice.pdf_path) {
        const pdfModel = buildInvoicePdfModel({ invoice, lines, company, invoicing });
        const blob = await renderPdf(pdfModel, company);
        const pdfPath = await unwrapResult(invoicesService.uploadPdf(orgId, invoice, blob));
        await unwrapResult(invoicesService.attachPdf(orgId, invoiceId, pdfPath));
        pdfRegenerated = true;
      }
      let imported = false;
      let alreadyImported = Boolean(invoice.pennylane_invoice_id);
      if (pennylaneEnabled && !alreadyImported) {
        if (!clientId) throw new Error('customer_not_synced');
        await unwrapResult(invoicesService.ensurePennylaneCustomer(orgId, clientId));
        const res = await unwrapResult(invoicesService.importToPennylane(orgId, invoiceId));
        alreadyImported = Boolean(res?.already);
        imported = !alreadyImported;
      }
      return { number: invoice.number, pdfRegenerated, imported, alreadyImported };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
    },
  });
}
```

- [ ] **Step 4: Vérifier et committer**

Run: `npm run lint:errors && npx vite build` → vert (le hook de rejeu n'a pas encore d'appelant : `audit:dead-code` ne raisonne qu'au fichier, `useInvoices.js` est déjà importé — OK).

```bash
git add src/shared/services/invoices.service.js src/shared/hooks/useInvoices.js
git commit -m "feat(facturation): import Pennylane enchaîné après l'émission (non bloquant) + hook de rejeu PDF/import"
```

---

### Task 5: Dialogue et carte — import après émission, bouton de rejeu

**Files:**
- Modify: `src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx`

**Interfaces:**
- Consumes: `useIssueEntretienInvoice` (param `pennylane`), `useRetryInvoiceExport` (Task 4) ; `item.invoice_import_status` (Task 1, vue) ; `buildCompanyInfo`, `invoicingSettings`, `generateInvoicePdfBlob`, `invoiceErrorMessage`.
- Produces: en mode hub avec Pennylane activé, l'émission enchaîne l'import ; toast succès « Facture N émise, archivée et importée dans Pennylane » ou warning (`importWarning`, 15 s) ; sur la carte, bouton ambre « Import Pennylane à rejouer » quand `invoice_import_status ∈ pending | error`.

- [ ] **Step 1: Dialogue**

Dans l'appel `issueInvoice.mutateAsync({ … })` de la branche hub, ajouter :

```js
          pennylane: pennylaneEnabled ? { enabled: true, clientId: item.client_id } : null,
```

(`pennylaneEnabled` est déjà dérivé de `settings` dans ce fichier depuis la phase 1.) Après le `downloadBlob`, remplacer le `toast.success(...)` par :

```js
        toast.success(
          issued.pennylaneInvoiceId
            ? `Facture ${issued.number} émise, archivée et importée dans Pennylane`
            : `Facture ${issued.number} émise et archivée`,
          { action: issued.blob ? { label: 'Télécharger', onClick: () => downloadBlob(issued.blob, `${issued.number}.pdf`) } : undefined },
        );
        if (issued.importWarning) toast.warning(issued.importWarning, { duration: 15000 });
```

Dans la description du dialogue en mode hub, remplacer « Rien n'est envoyé à Pennylane (phase 2). » par : `${pennylaneEnabled ? 'La facture est ensuite importée telle quelle dans Pennylane (journal de ventes).' : 'Pennylane n’est pas activé : pas d’import.'}`.

- [ ] **Step 2: Carte — bouton de rejeu**

Dans `EntretienSAVCard.jsx`, importer `useRetryInvoiceExport` depuis `@hooks/useInvoices`, `buildCompanyInfo` depuis `@/lib/orgBranding`, `invoicingSettings, invoiceErrorMessage` depuis `@/lib/invoiceDocumentModel`, `generateInvoicePdfBlob` depuis `../facturation/InvoicePDF`, `RefreshCw` depuis `lucide-react`. À côté des hooks existants :

```js
  const retryExport = useRetryInvoiceExport(orgId);
  const needsExportRetry = isHubMode && !!item.invoice_id && (item.invoice_import_status === 'pending' || item.invoice_import_status === 'error');
```

Juste après le bouton « Facturée » (même groupe de boutons), ajouter :

```jsx
              {isTeamLeaderOrAbove && needsExportRetry && pennylaneEnabled && (
                <button
                  type="button"
                  disabled={retryExport.isPending}
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const r = await retryExport.mutateAsync({
                        invoiceId: item.invoice_id,
                        clientId: item.client_id,
                        company: buildCompanyInfo(settings),
                        invoicing: invoicingSettings(settings),
                        renderPdf: generateInvoicePdfBlob,
                        pennylaneEnabled,
                      });
                      toast.success(
                        r.alreadyImported && !r.imported
                          ? `Facture ${r.number} déjà importée dans Pennylane`
                          : `Facture ${r.number}${r.pdfRegenerated ? ' — PDF régénéré,' : ''} importée dans Pennylane`,
                      );
                    } catch (err) {
                      toast.error(invoiceErrorMessage(err), { duration: 15000 });
                    }
                  }}
                  title={item.invoice_import_status === 'error' ? 'L’import Pennylane a échoué : rejouer' : 'Import Pennylane non fait : rejouer'}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${retryExport.isPending ? 'animate-spin' : ''}`} />
                  {retryExport.isPending ? 'Import…' : 'Import Pennylane à rejouer'}
                </button>
              )}
```

`settings`, `pennylaneEnabled`, `isHubMode`, `orgId`, `isTeamLeaderOrAbove` existent déjà dans ce composant (phase 1) — vérifier les noms exacts avant d'écrire.

- [ ] **Step 3: Vérifier**

```bash
npm run audit:quality && npx vite build
```

Expected : vert. Test manuel par Eric (org H&E, Pennylane activé sur H&E ou test sur Mayer avec une carte de petit montant) : émettre → toast « importée dans Pennylane », facture visible dans Pennylane avec notre numéro et notre PDF, écriture en VT ; couper le réseau ou désactiver Pennylane pour provoquer un échec → carte avec bouton ambre → rejouer → succès. Requête de contrôle :

```sql
SELECT number, import_status, import_error, pennylane_invoice_id, pennylane_ledger_entry_id, import_attempted_at
  FROM majordhome.invoices ORDER BY created_at DESC LIMIT 3;
```

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx src/apps/artisan/components/entretiens/EntretienSAVCard.jsx
git commit -m "feat(facturation): import Pennylane après émission + bouton de rejeu sur la carte (hub phase 2)"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md`
- Modify: `.claude/proposed-updates.md`

- [ ] **Step 1: Spec** — remplacer la ligne `2. Import + statuts + rejeu (…)` du § Phases par `2. ✅ **Livrée le AAAA-MM-JJ** — import Pennylane (edge \`pennylane-invoice-import\`, journal de ventes principal), statuts \`import_status\`, rejeu PDF/import depuis la carte. Plan : docs/superpowers/plans/2026-09-22-hub-facturation-phase2-import-pennylane.md`.

- [ ] **Step 2: Proposition CLAUDE.md** — dans l'entrée `## [2026-09-22 14:30] Hub de facturation — phase 1 (émission locale)` de `.claude/proposed-updates.md`, renommer le titre en `Hub de facturation — phases 1 et 2 (émission locale, import Pennylane)`, ajouter les commits de la phase 2 à la ligne **Commit**, et ajouter à la fin de la liste **Proposition** :

```markdown
- **Import Pennylane = edge `pennylane-invoice-import`** (team_leader+, org Pennylane activée) : PDF archivé → `/file_attachments` → `POST /customer_invoices/import` avec NOTRE numéro, `external_reference` = id facture, montants ENREGISTRÉS (jamais recalculés), journal de ventes principal (le déplacement d'écriture est refusé par l'API). Résultat écrit UNIQUEMENT par la RPC `invoice_set_import_result` (service_role) : `import_status` ∈ `pending | imported | error` + `import_error` + `import_attempted_at`. L'import n'échoue jamais l'émission : un échec est enregistré et rejoué depuis la carte (`useRetryInvoiceExport`, qui régénère aussi un PDF manquant). Le client Pennylane vient du mapping `pennylane_sync` type `client`, posé côté front (`ensurePennylaneCustomer`) — l'edge ne prend jamais un `customer_id` du payload.
- `invoice_lines.vat_code` = code TVA Pennylane figé à la création (l'edge ne recopie pas `VAT_CODES`). `majordhome_entretien_sav.invoice_import_status` pilote le bouton de rejeu (cast `invoice_id::uuid` protégé par un CASE : la colonne porte aussi des ids Pennylane).
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md .claude/proposed-updates.md
git commit -m "docs(facturation): phase 2 du hub livrée (import Pennylane, statuts, rejeu)"
```

---

## Hors périmètre, à signaler

- Secret Pennylane unique (`PENNYLANE_API_TOKEN` instance) : multi-org réel = chantier « secrets par org » (mémoire SaaS).
- Envoi de la facture au client (Pennylane `send_by_email` ou Resend) : décision Eric, phase 4.
- Rapprochement automatisé (factures PL sans `external_reference` Majord'home, montants divergents) : phase 4.
- `pennylane_sync` type `invoice` a désormais deux conventions de `local_id` : intervention (chemin Pennylane-crée, phase 2026-09-21) et facture Majord'home (hub). `metadata.source = 'hub'` les distingue ; à unifier si un lecteur commun apparaît.

## Self-review

- **Spec phase 2** : import (T3) ✓, `external_reference` = id facture ✓, PDF déposé ✓, montants exacts ✓, idempotent ✓ (`pennylane_invoice_id` + `external_reference` unique côté PL), statuts (T1 RPC + colonnes) ✓, rejeu (T4 hook + T5 bouton) ✓, jamais silencieux (résultat enregistré avant de répondre 502 ; toast warning) ✓. Journal VT sans déplacement ✓.
- **Cohérence des noms** : `invoice_set_import_result(uuid, text, bigint, bigint, text)` identique T1 / T3 / assertions ; `vat_code` T1 (colonne + RPC) / T2 (modèle) / T3 (edge) ; `importToPennylane` / `ensurePennylaneCustomer` T4 → T5 ; `useRetryInvoiceExport` T4 → T5 ; `invoice_import_status` T1 → T5 ; codes d'erreur T2 ↔ T3 (`customer_not_synced`, `pdf_missing`, `invoice_not_issued`, `pennylane_import_failed`).
- **Placeholders** : le seul gabarit est la recopie de la vue `majordhome_entretien_sav` (Task 1 § 5), dont la source exacte est nommée.
