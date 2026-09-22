# Hub de facturation — Phase 1 : émission locale (numérotation, PDF, archivage) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Majord'home émet lui-même la facture d'un entretien réalisé : numéro légal continu attribué par la base, lignes et totaux figés, PDF brandé avec les mentions obligatoires, archivé dans Storage, carte marquée facturée. Sans aucun appel Pennylane (phase 2).

**Architecture:** Un modèle PUR (`src/lib/invoiceDocumentModel.js`) transforme le modèle de facture d'entretien existant (`buildEntretienInvoice`) en brouillon persistable puis en modèle de rendu PDF. La base porte la vérité (tables `majordhome.invoices` / `invoice_lines` / `invoice_sequences`, RPC `invoice_create_draft` + `invoice_issue` SECURITY DEFINER, trigger d'immuabilité). Le front enchaîne dans un hook unique : brouillon → émission → marquage carte → PDF → Storage → `pdf_path`. Le mode « hub » se choisit dans Settings → Facturation à côté des modes Pennylane existants ; le chemin Pennylane actuel reste intact.

**Tech Stack:** PostgreSQL (Supabase, migrations versionnées répétées sur `scripts/migration-rehearsal/`), React 18 + TanStack Query v5, `@react-pdf/renderer` (socle `src/lib/pdfShared.jsx`), Supabase Storage, `node --test` pour les modules purs.

**Spec:** `docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md` (§ « Ce que Majord'home porte désormais », § « Modèle de données », § « Flux » étapes 1-2, § « Phases » → phase 1). Décision Eric 2026-09-22 soir : journal Pennylane dédié reporté, l'import (phase 2) ira dans le journal de ventes principal.

## Global Constraints

- **Multi-tenant** (CLAUDE.md § Multi-tenant & sécurité) : toute table `majordhome.*` naît avec RLS + policies scopées `org_id` ; toute vue `public.majordhome_*` est créée `WITH (security_invoker = true)` ; `GRANT SELECT ON majordhome.<table> TO service_role` ; tout RPC SECURITY DEFINER fait `REVOKE EXECUTE … FROM PUBLIC, anon` (le mot `PUBLIC` est obligatoire) ; garde d'autorisation POSITIVE (`IF (…) IS NOT TRUE THEN refuser`) avec `IF auth.uid() IS NULL THEN refuser` en première instruction ; toute mutation front filtre `.eq('org_id', orgId)`.
- **Bucket Storage** : path préfixé `${orgId}/…`, policies `((storage.foldername(name))[1])::uuid IN (org_members)`.
- **Numérotation** : séquence continue, sans trou, chronologique, par organisation et par année, attribuée par la base à l'émission (verrou ligne), jamais côté front. Format `${prefix}-${YYYY}-${NNNNN}` (ex. `F-2026-00123`).
- **Immuabilité** : une facture `issued` ne change plus (en-tête, lignes, totaux) ; seules `pdf_path`, `pennylane_*`, `import_status`, `import_error`, `updated_at`, et `status` vers `cancelled` restent modifiables.
- **Montants au centime** : par ligne `ht + tva = ttc` (arrondi 2 décimales), totaux = sommes des lignes ; le calcul est le nôtre, dans un module pur testé, identique en base, sur le PDF et (phase 2) dans l'import.
- **Mentions obligatoires du PDF** : identité (`buildCompanyInfo`), SIRET, TVA intracom, RCS, adresse, conditions de paiement, pénalités de retard, indemnité forfaitaire de recouvrement 40 €, escompte, mention RGE si certifications, bloc paiement IBAN/BIC. Tout vient de `core.organizations.settings` — rien de Mayer en dur, fallback neutre.
- **Toute nouvelle valeur de configuration org est éditable dans `/settings/*` AVANT d'être consommée** (préfixe, IBAN, BIC, conditions, pénalités, escompte → nouvel onglet Émission de `/settings/pennylane`). `org_update_settings` merge JSONB niveau 1 → toujours sauver l'objet `invoicing` COMPLET.
- **PDF / Helvetica** : pas de glyphes hors cp1252 (pas de flèches, `≥`, `−`), espaces fines U+202F normalisées ; formatters PDF-safe dans le modèle pur.
- **Hooks** : cache keys centralisées dans `cacheKeys.js` avec `orgId` en 1ᵉʳ paramètre ; `mutationFn` déballe les services via `unwrapResult()` ; appelant en try/catch + toast.
- **Qualité** : pas de composant > 500 LOC, `npm run audit:quality` vert (lint errors + tests node + dead code), `npx vite build` vert. **Ne jamais utiliser les preview tools** (Eric a son serveur).
- **Chirurgical** : le chemin Pennylane existant (`useCreateEntretienInvoice`, `createInvoiceFromEntretien`, modes `draft`/`final`) n'est pas modifié. Le bug repéré au passage (Settings → Facturation Pennylane, sélecteur « Pièces de rechange » stocke la chaîne `"undefined"` : `value={String(a.id)}` alors que les options portent `number`) est **hors périmètre** : signalé en fin de plan, pas embarqué.

---

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260923_1_invoices_hub.sql` (créer) | Tables `majordhome.invoice_sequences`, `invoices`, `invoice_lines` ; RLS ; triggers `updated_at` + immuabilité ; RPC `public.invoice_create_draft(jsonb, jsonb)` et `public.invoice_issue(uuid, text)` ; vues `public.majordhome_invoices` / `majordhome_invoice_lines` ; bucket `invoices` + policies |
| `scripts/migration-rehearsal/assert-invoices.sql` (créer) | Assertions structure + parcours fonctionnel (2 émissions → `00001`, `00002`, immuabilité, anon refusé, isolation cross-org) |
| `src/lib/entretienInvoiceModel.js` (modifier) | Chaque ligne porte en plus `ledgerAccountNumber`, `equipmentId`, `equipmentTypeId`, `categoryId` (axes analytiques du journal d'intégration) |
| `scripts/entretien-invoice-model.test.mjs` (modifier) | Test des 4 nouveaux champs |
| `src/lib/invoiceDocumentModel.js` (créer, PUR) | `INVOICING_DEFAULTS`, `invoicingSettings`, `validateIban`, `validateBic`, `splitTtc`, `buildInvoiceDraft`, `buildInvoicePdfModel`, `fmtEur` |
| `scripts/invoice-document-model.test.mjs` (créer) | Tests du module pur (ajouté à `audit:quality`) |
| `src/apps/artisan/pages/settings/pennylane/EmissionTab.jsx` (créer) | Onglet « Émission » : préfixe, IBAN, BIC, conditions, pénalités, escompte → `settings.invoicing` |
| `src/apps/artisan/pages/settings/PennylaneSettings.jsx` (modifier) | Page à 2 onglets : Émission / Pennylane |
| `src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx` (modifier) | Option de mode `hub` dans le sélecteur existant |
| `src/shared/hooks/useOrgSettings.js` (modifier) | `pennylaneInvoiceSettings` accepte `mode = 'hub'` |
| `src/lib/modules.js` (modifier) | Tuile `pennylane` renommée « Facturation » (route inchangée) |
| `src/apps/artisan/components/facturation/InvoicePDF.jsx` (créer) | `InvoiceDocument` react-pdf + `generateInvoicePdfBlob(pdfModel, company)` |
| `src/shared/services/invoices.service.js` (créer) | `createDraft`, `issue`, `getById`, `uploadPdf`, `attachPdf` (contrat `{ data, error }`) |
| `src/shared/hooks/cacheKeys.js` (modifier) | `invoiceKeys` |
| `src/shared/hooks/useInvoices.js` (créer) | `useIssueEntretienInvoice(orgId)` — la chaîne d'émission, point d'entrée unique |
| `src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx` (modifier) | Branche `hub` : émission locale + téléchargement du PDF |
| `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (modifier) | Bouton « Facturer » visible en mode hub sans Pennylane ; libellés |
| `package.json` (modifier) | `audit:quality` inclut le nouveau test |
| `.claude/proposed-updates.md` (modifier) | Entrée PENDING pour CLAUDE.md (règles du hub) |

---

### Task 1: Migration — tables, RLS, RPC d'émission, vues, bucket

**Files:**
- Create: `supabase/migrations/20260923_1_invoices_hub.sql`
- Create: `scripts/migration-rehearsal/assert-invoices.sql`

**Interfaces:**
- Consumes: `majordhome.handle_updated_at()` (trigger existant), `core.organization_members(org_id, user_id, role)`, `core.organizations`, `core.profiles`, `majordhome.clients/contracts/interventions/equipments/equipment_categories`, stub `auth.uid()` du harnais.
- Produces:
  - `public.invoice_create_draft(p_invoice jsonb, p_lines jsonb) RETURNS uuid` — clés de `p_invoice` : `org_id, kind, context, client_id, contract_id, intervention_id, customer (jsonb), subject, currency, due_days, total_ht, total_tva, total_ttc, vat_breakdown (jsonb), discount (jsonb|null), created_by` ; chaque élément de `p_lines` : `position, kind, label, description, quantity, unit_price_ht, vat_rate, discount_percent, ht, tva, ttc, ledger_account_number, ledger_account_pl_id, metier_key, equipment_id, category_id`.
  - `public.invoice_issue(p_invoice_id uuid, p_number_prefix text) RETURNS jsonb` → `{ "id", "number", "year", "invoice_date", "due_at", "issued_at" }`.
  - Vues `public.majordhome_invoices` (miroir updatable, `SELECT *`) et `public.majordhome_invoice_lines` (miroir, lecture).
  - Bucket `invoices` (privé, PDF, 10 Mo), policies `invoices_org_select/insert/update/delete`.

- [ ] **Step 1: Écrire la migration**

```sql
-- supabase/migrations/20260923_1_invoices_hub.sql
-- ============================================================================
-- Hub de facturation — phase 1 (spec 2026-09-22-majordhome-hub-facturation-
-- import-pennylane-design.md) : Majord'home émet, numérote, fige et archive ses
-- factures. Pennylane n'intervient pas ici (import en phase 2, journal de ventes
-- principal — décision Eric 2026-09-22 soir).
--
--   - invoice_sequences : compteur (org, année), verrouillé ligne à l'émission
--     → numéro continu, sans trou, chronologique. JAMAIS de MAX()+1.
--   - invoices : en-tête. `customer` = photo de l'identité client à l'émission
--     (une facture émise ne suit pas les modifications de la fiche).
--   - invoice_lines : journal d'intégration (compte comptable + axes métier).
--   - Immuabilité : trigger sur invoices (colonnes gelées) et invoice_lines
--     (aucune écriture sous une facture émise). Correction = avoir (phase 3).
--   - RPC invoice_create_draft / invoice_issue : SECURITY DEFINER, auth.uid()
--     NULL refusé, garde POSITIVE org_admin|team_leader, REVOKE PUBLIC/anon.
--   - Vues miroirs security_invoker ; GRANT SELECT service_role (régression
--     2026-05-27) ; bucket `invoices` préfixé org.
-- Répétée sur scripts/migration-rehearsal/ (assert-invoices.sql).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Séquences par (org, année)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.invoice_sequences (
  org_id      uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  year        integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (org_id, year)
);
COMMENT ON TABLE majordhome.invoice_sequences IS
  'Dernier numéro de facture attribué par organisation et par année. Incrémenté sous verrou par invoice_issue — jamais lu côté front.';

-- ----------------------------------------------------------------------------
-- 2. Factures
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.invoices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES core.organizations(id),
  number                    text,
  year                      integer,
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'cancelled')),
  kind                      text NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_note')),
  credited_invoice_id       uuid REFERENCES majordhome.invoices(id) ON DELETE RESTRICT,
  context                   text NOT NULL DEFAULT 'contrat',
  client_id                 uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  contract_id               uuid REFERENCES majordhome.contracts(id) ON DELETE SET NULL,
  intervention_id           uuid REFERENCES majordhome.interventions(id) ON DELETE SET NULL,
  customer                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject                   text,
  currency                  text NOT NULL DEFAULT 'EUR',
  due_days                  integer NOT NULL DEFAULT 30 CHECK (due_days BETWEEN 0 AND 120),
  invoice_date              date,
  due_at                    date,
  issued_at                 timestamptz,
  total_ht                  numeric(12,2) NOT NULL DEFAULT 0,
  total_tva                 numeric(12,2) NOT NULL DEFAULT 0,
  total_ttc                 numeric(12,2) NOT NULL DEFAULT 0,
  vat_breakdown             jsonb NOT NULL DEFAULT '[]'::jsonb,
  discount                  jsonb,
  pdf_path                  text,
  pennylane_invoice_id      bigint,
  pennylane_ledger_entry_id bigint,
  pennylane_journal_id      bigint,
  import_status             text NOT NULL DEFAULT 'pending' CHECK (import_status IN ('pending', 'imported', 'error')),
  import_error              text,
  created_by                uuid REFERENCES core.profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_org_number_key UNIQUE (org_id, number),
  CONSTRAINT invoices_issued_has_number CHECK (status = 'draft' OR (number IS NOT NULL AND issued_at IS NOT NULL AND invoice_date IS NOT NULL)),
  CONSTRAINT invoices_totals_consistent CHECK (total_ht + total_tva = total_ttc)
);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status_created ON majordhome.invoices (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON majordhome.invoices (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_intervention ON majordhome.invoices (intervention_id) WHERE intervention_id IS NOT NULL;

COMMENT ON TABLE majordhome.invoices IS
  'Factures émises par Majord''home (hub de facturation). Brouillon → émise (numéro par invoice_issue) → figée. `customer` = photo du client à l''émission. pdf_path = bucket invoices/${org}/${année}/${numéro}.pdf. Colonnes pennylane_* / import_* renseignées en phase 2.';

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON majordhome.invoices;
CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON majordhome.invoices
  FOR EACH ROW EXECUTE FUNCTION majordhome.handle_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Lignes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.invoice_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            uuid NOT NULL REFERENCES majordhome.invoices(id) ON DELETE CASCADE,
  org_id                uuid NOT NULL REFERENCES core.organizations(id),
  position              integer NOT NULL,
  kind                  text NOT NULL DEFAULT 'libre' CHECK (kind IN ('contrat', 'piece', 'libre')),
  label                 text NOT NULL,
  description           text,
  quantity              numeric(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_ht         numeric(12,4) NOT NULL DEFAULT 0,
  vat_rate              numeric(5,2) NOT NULL DEFAULT 20,
  discount_percent      numeric(7,4) NOT NULL DEFAULT 0,
  ht                    numeric(12,2) NOT NULL DEFAULT 0,
  tva                   numeric(12,2) NOT NULL DEFAULT 0,
  ttc                   numeric(12,2) NOT NULL DEFAULT 0,
  ledger_account_number text,
  ledger_account_pl_id  bigint,
  metier_key            text,
  equipment_id          uuid REFERENCES majordhome.equipments(id) ON DELETE SET NULL,
  category_id           uuid REFERENCES majordhome.equipment_categories(id) ON DELETE SET NULL,
  CONSTRAINT invoice_lines_invoice_position_key UNIQUE (invoice_id, position),
  CONSTRAINT invoice_lines_amounts_consistent CHECK (ht + tva = ttc)
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON majordhome.invoice_lines (invoice_id, position);

COMMENT ON TABLE majordhome.invoice_lines IS
  'Lignes d''une facture Majord''home = journal d''intégration : compte de vente (numéro + id Pennylane) et axes métier (type d''équipement, équipement, catégorie). Écriture uniquement via invoice_create_draft.';

-- ----------------------------------------------------------------------------
-- 4. Immuabilité d'une facture émise
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.invoices_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  -- Émise ou annulée : seules les colonnes de suivi bougent ; status ne peut aller que vers cancelled.
  IF NEW.number IS DISTINCT FROM OLD.number
     OR NEW.year IS DISTINCT FROM OLD.year
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.credited_invoice_id IS DISTINCT FROM OLD.credited_invoice_id
     OR NEW.context IS DISTINCT FROM OLD.context
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
     OR NEW.intervention_id IS DISTINCT FROM OLD.intervention_id
     OR NEW.customer IS DISTINCT FROM OLD.customer
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.due_days IS DISTINCT FROM OLD.due_days
     OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.total_ht IS DISTINCT FROM OLD.total_ht
     OR NEW.total_tva IS DISTINCT FROM OLD.total_tva
     OR NEW.total_ttc IS DISTINCT FROM OLD.total_ttc
     OR NEW.vat_breakdown IS DISTINCT FROM OLD.vat_breakdown
     OR NEW.discount IS DISTINCT FROM OLD.discount
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
  THEN
    RAISE EXCEPTION 'invoice_immutable' USING ERRCODE = '42501',
      DETAIL = format('Facture %s émise : en-tête figé, correction par avoir.', OLD.number);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'issued' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'invoice_immutable' USING ERRCODE = '42501',
      DETAIL = format('Facture %s : transition %s → %s interdite.', OLD.number, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_immutable ON majordhome.invoices;
CREATE TRIGGER trg_invoices_immutable
  BEFORE UPDATE ON majordhome.invoices
  FOR EACH ROW EXECUTE FUNCTION majordhome.invoices_guard_immutable();

CREATE OR REPLACE FUNCTION majordhome.invoice_lines_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_status text;
BEGIN
  SELECT status INTO v_status FROM majordhome.invoices WHERE id = v_invoice_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'invoice_immutable' USING ERRCODE = '42501',
      DETAIL = 'Lignes d''une facture émise : figées, correction par avoir.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_lines_immutable ON majordhome.invoice_lines;
CREATE TRIGGER trg_invoice_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON majordhome.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION majordhome.invoice_lines_guard_immutable();

-- ----------------------------------------------------------------------------
-- 5. RLS — membre de l'org en lecture ; écriture (pdf_path, suivi) et suppression
--    de brouillon : org_admin | team_leader. INSERT uniquement par RPC.
-- ----------------------------------------------------------------------------
ALTER TABLE majordhome.invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE majordhome.invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_select ON majordhome.invoices;
CREATE POLICY invoices_select ON majordhome.invoices
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS invoices_update ON majordhome.invoices;
CREATE POLICY invoices_update ON majordhome.invoices
  FOR UPDATE TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om
                    WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('org_admin', 'team_leader')))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om
                         WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('org_admin', 'team_leader')));

DROP POLICY IF EXISTS invoices_delete_draft ON majordhome.invoices;
CREATE POLICY invoices_delete_draft ON majordhome.invoices
  FOR DELETE TO authenticated
  USING (status = 'draft' AND org_id IN (SELECT om.org_id FROM core.organization_members om
                                          WHERE om.user_id = (SELECT auth.uid()) AND om.role IN ('org_admin', 'team_leader')));

DROP POLICY IF EXISTS invoice_lines_select ON majordhome.invoice_lines;
CREATE POLICY invoice_lines_select ON majordhome.invoice_lines
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));

-- invoice_sequences : aucune policy → invisible et inaccessible hors RPC (SECURITY DEFINER).

-- ----------------------------------------------------------------------------
-- 6. Privilèges tables — explicites (ACL par défaut du schéma : arwd à anon/authenticated)
-- ----------------------------------------------------------------------------
REVOKE ALL ON majordhome.invoice_sequences, majordhome.invoices, majordhome.invoice_lines FROM anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON majordhome.invoices TO authenticated;
GRANT SELECT ON majordhome.invoice_lines TO authenticated;
GRANT SELECT ON majordhome.invoice_sequences, majordhome.invoices, majordhome.invoice_lines TO service_role;

-- ----------------------------------------------------------------------------
-- 7. RPC — brouillon atomique (en-tête + lignes)
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
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := (p_invoice->>'org_id')::uuid;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'org_id_required' USING ERRCODE = '22023';
  END IF;
  -- Garde POSITIVE (jamais « IF NOT … » : NULL ouvrirait la porte)
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
  ) RETURNING id INTO v_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_count := v_count + 1;
    INSERT INTO majordhome.invoice_lines (
      invoice_id, org_id, position, kind, label, description, quantity, unit_price_ht, vat_rate,
      discount_percent, ht, tva, ttc, ledger_account_number, ledger_account_pl_id, metier_key,
      equipment_id, category_id
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
      (v_line->>'category_id')::uuid
    );
  END LOOP;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_create_draft(jsonb, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. RPC — émission : numéro sous verrou, date, échéance, gel
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_issue(p_invoice_id uuid, p_number_prefix text DEFAULT 'F')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_inv majordhome.invoices%ROWTYPE;
  v_role text;
  v_prefix text := upper(coalesce(nullif(trim(p_number_prefix), ''), 'F'));
  v_date date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_year int;
  v_n int;
  v_number text;
  v_lines int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_prefix !~ '^[A-Z][A-Z0-9]{0,5}$' THEN
    RAISE EXCEPTION 'invalid_prefix' USING ERRCODE = '22023', DETAIL = 'Préfixe : 1 à 6 caractères A-Z / 0-9, commence par une lettre.';
  END IF;

  SELECT * INTO v_inv FROM majordhome.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002'; END IF;

  SELECT role INTO v_role FROM core.organization_members
   WHERE org_id = v_inv.org_id AND user_id = v_user LIMIT 1;
  IF (v_role IN ('org_admin', 'team_leader')) IS NOT TRUE THEN
    RAISE EXCEPTION 'team_leader_required' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'draft' THEN
    RAISE EXCEPTION 'invoice_already_issued' USING ERRCODE = '42501', DETAIL = v_inv.number;
  END IF;
  SELECT count(*) INTO v_lines FROM majordhome.invoice_lines WHERE invoice_id = p_invoice_id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'lines_required' USING ERRCODE = '22023';
  END IF;

  v_year := extract(year FROM v_date)::int;
  -- Compteur (org, année) sous verrou ligne : continu, sans trou, chronologique.
  INSERT INTO majordhome.invoice_sequences (org_id, year, last_number)
  VALUES (v_inv.org_id, v_year, 1)
  ON CONFLICT (org_id, year) DO UPDATE SET last_number = majordhome.invoice_sequences.last_number + 1
  RETURNING last_number INTO v_n;
  v_number := format('%s-%s-%s', v_prefix, v_year, lpad(v_n::text, 5, '0'));

  UPDATE majordhome.invoices
     SET status = 'issued', number = v_number, year = v_year, invoice_date = v_date,
         due_at = v_date + (due_days || ' days')::interval, issued_at = now()
   WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'id', p_invoice_id, 'number', v_number, 'year', v_year,
    'invoice_date', v_date, 'due_at', (v_date + (v_inv.due_days || ' days')::interval)::date,
    'issued_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.invoice_issue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_issue(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Vues publiques — miroirs simples (updatable), security_invoker
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
  'Miroir auto-updatable de majordhome.invoices (security_invoker, RLS org). Lecture front ; UPDATE limité par trigger aux colonnes de suivi (pdf_path, pennylane_*, import_*) ; INSERT via invoice_create_draft.';
COMMENT ON VIEW public.majordhome_invoice_lines IS
  'Miroir de majordhome.invoice_lines (security_invoker, RLS org). Lecture front ; écriture via invoice_create_draft.';

-- ----------------------------------------------------------------------------
-- 10. Bucket Storage `invoices` — PDF archivés, path ${org_id}/${année}/${numéro}.pdf
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoices', 'invoices', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS invoices_org_select ON storage.objects;
CREATE POLICY invoices_org_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoices'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
);

DROP POLICY IF EXISTS invoices_org_insert ON storage.objects;
CREATE POLICY invoices_org_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoices'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
);

DROP POLICY IF EXISTS invoices_org_update ON storage.objects;
CREATE POLICY invoices_org_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'invoices'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
)
WITH CHECK (
  bucket_id = 'invoices'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
);

DROP POLICY IF EXISTS invoices_org_delete ON storage.objects;
CREATE POLICY invoices_org_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'invoices'
  AND ((storage.foldername(name))[1])::uuid IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'
  )
);
```

- [ ] **Step 2: Écrire les assertions du harnais**

Le harnais n'a pas de schéma `storage` : la section 10 de la migration doit être **sautée en répétition**. `run.mjs` joue le fichier tel quel ; ajouter en tête de `assert-invoices.sql` rien de spécial, mais dans `run.mjs` la migration est exécutée via `psql -f`. Le plus simple et le plus honnête : créer dans `scripts/migration-rehearsal/bootstrap-pre.sql` un stub minimal **si absent** (vérifier d'abord avec `grep -n "storage" scripts/migration-rehearsal/bootstrap-pre.sql`). S'il n'y a rien, ajouter à la fin de `bootstrap-pre.sql` :

```sql
-- Stub Storage (les migrations posent bucket + policies ; en répétition on ne teste que la syntaxe)
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
```

Puis le fichier d'assertions :

```sql
-- assert-invoices.sql — vérifie 20260923_1_invoices_hub.sql sur le cluster de répétition.
-- Un écart lève une exception → run.mjs sort en ECHEC.
-- Couvre : structure, RLS, privilèges, puis parcours fonctionnel en rôle authenticated :
-- brouillon → émission (numéro 00001 puis 00002), immuabilité, brouillon vide refusé,
-- anon refusé, isolation cross-org.

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE n int; r record;
BEGIN
  IF to_regclass('majordhome.invoice_sequences') IS NULL THEN RAISE EXCEPTION 'table invoice_sequences absente'; END IF;
  IF to_regclass('majordhome.invoices') IS NULL THEN RAISE EXCEPTION 'table invoices absente'; END IF;
  IF to_regclass('majordhome.invoice_lines') IS NULL THEN RAISE EXCEPTION 'table invoice_lines absente'; END IF;
  IF to_regclass('public.majordhome_invoices') IS NULL THEN RAISE EXCEPTION 'vue majordhome_invoices absente'; END IF;
  IF to_regclass('public.majordhome_invoice_lines') IS NULL THEN RAISE EXCEPTION 'vue majordhome_invoice_lines absente'; END IF;

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'majordhome' AND c.relname IN ('invoice_sequences', 'invoices', 'invoice_lines') AND c.relrowsecurity;
  IF n <> 3 THEN RAISE EXCEPTION 'RLS activée sur % table(s) au lieu de 3', n; END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'invoices';
  IF n <> 3 THEN RAISE EXCEPTION 'invoices : % policies au lieu de 3', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'invoice_lines';
  IF n <> 1 THEN RAISE EXCEPTION 'invoice_lines : % policies au lieu de 1', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'majordhome' AND tablename = 'invoice_sequences';
  IF n <> 0 THEN RAISE EXCEPTION 'invoice_sequences : % policies au lieu de 0', n; END IF;

  FOR r IN SELECT v.table_name, v.is_updatable, c.reloptions
             FROM information_schema.views v JOIN pg_class c ON c.relname = v.table_name
             JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = v.table_schema
            WHERE v.table_schema = 'public' AND v.table_name IN ('majordhome_invoices', 'majordhome_invoice_lines') LOOP
    IF r.reloptions::text NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'vue % sans security_invoker', r.table_name; END IF;
    IF r.is_updatable <> 'YES' THEN RAISE EXCEPTION 'vue % non updatable', r.table_name; END IF;
  END LOOP;

  -- Privilèges
  IF NOT has_table_privilege('service_role', 'majordhome.invoices', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur invoices'; END IF;
  IF NOT has_table_privilege('service_role', 'majordhome.invoice_lines', 'SELECT') THEN RAISE EXCEPTION 'service_role sans SELECT sur invoice_lines'; END IF;
  IF has_table_privilege('anon', 'majordhome.invoices', 'SELECT') THEN RAISE EXCEPTION 'anon lit invoices'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.invoices', 'INSERT') THEN RAISE EXCEPTION 'authenticated peut INSERT invoices (doit passer par la RPC)'; END IF;
  IF has_table_privilege('authenticated', 'majordhome.invoice_lines', 'UPDATE') THEN RAISE EXCEPTION 'authenticated peut UPDATE invoice_lines'; END IF;
  IF has_function_privilege('anon', 'public.invoice_create_draft(jsonb, jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_create_draft exécutable par anon'; END IF;
  IF has_function_privilege('anon', 'public.invoice_issue(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_issue exécutable par anon'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.invoice_issue(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'invoice_issue non exécutable par authenticated'; END IF;

  RAISE NOTICE 'assert-invoices A (structure) : OK';
END $$;

-- ── B. Parcours fonctionnel (rollback à la fin) ────────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_etranger uuid; v_role text;
  v_id uuid; v_id2 uuid; v_id3 uuid;
  v_res jsonb; v_res2 jsonb;
  v_year text := extract(year FROM (now() AT TIME ZONE 'Europe/Paris'))::text;
  v_inv record;
  n int; ok boolean;
BEGIN
  -- Fixture : un org_admin ou team_leader Mayer avec profil ; un membre d'une autre org
  SELECT om.user_id, om.role INTO v_membre, v_role FROM core.organization_members om
    JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin', 'team_leader') LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer avec profil'; END IF;
  SELECT om.user_id INTO v_etranger FROM core.organization_members om
    JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id <> v_mayer AND om.user_id IS NOT NULL
     AND om.user_id NOT IN (SELECT user_id FROM core.organization_members WHERE org_id = v_mayer AND user_id IS NOT NULL) LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;

  -- (1) Brouillon avec 2 lignes
  v_id := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'context', 'contrat', 'subject', 'Entretien test',
      'customer', jsonb_build_object('name', 'REHEARSAL Client', 'address', '1 rue Test', 'postal_code', '81600', 'city', 'Gaillac'),
      'due_days', 30, 'total_ht', 81.82, 'total_tva', 8.18, 'total_ttc', 90.00,
      'vat_breakdown', '[{"rate":10,"base":81.82,"amount":8.18}]'::jsonb),
    jsonb_build_array(
      jsonb_build_object('position', 1, 'kind', 'contrat', 'label', 'Entretien poêle', 'quantity', 1,
        'unit_price_ht', 81.8182, 'vat_rate', 10, 'ht', 81.82, 'tva', 8.18, 'ttc', 90.00, 'ledger_account_number', '70601'),
      jsonb_build_object('position', 2, 'kind', 'piece', 'label', 'Joint', 'quantity', 2,
        'unit_price_ht', 0, 'vat_rate', 10, 'ht', 0, 'tva', 0, 'ttc', 0)
    ));
  IF v_id IS NULL THEN RAISE EXCEPTION '(1) brouillon non créé'; END IF;
  SELECT count(*) INTO n FROM public.majordhome_invoice_lines WHERE invoice_id = v_id;
  IF n <> 2 THEN RAISE EXCEPTION '(1) % ligne(s) au lieu de 2', n; END IF;
  SELECT status, number INTO v_inv FROM public.majordhome_invoices WHERE id = v_id;
  IF v_inv.status <> 'draft' OR v_inv.number IS NOT NULL THEN RAISE EXCEPTION '(1) brouillon mal initialisé'; END IF;

  -- (2) Émission : numéro <prefix>-<année>-00001 (compteur vierge sur le cluster jetable)
  v_res := public.invoice_issue(v_id, 'F');
  IF v_res->>'number' <> 'F-' || v_year || '-00001' THEN RAISE EXCEPTION '(2) numéro % inattendu', v_res->>'number'; END IF;
  SELECT status, number, invoice_date, due_at, issued_at INTO v_inv FROM public.majordhome_invoices WHERE id = v_id;
  IF v_inv.status <> 'issued' OR v_inv.issued_at IS NULL THEN RAISE EXCEPTION '(2) facture non émise'; END IF;
  IF v_inv.due_at <> v_inv.invoice_date + 30 THEN RAISE EXCEPTION '(2) échéance % ≠ date + 30', v_inv.due_at; END IF;

  -- (3) Deuxième émission : 00002 (continuité)
  v_id2 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'total_ht', 10, 'total_tva', 2, 'total_ttc', 12),
    jsonb_build_array(jsonb_build_object('label', 'Ligne', 'ht', 10, 'tva', 2, 'ttc', 12)));
  v_res2 := public.invoice_issue(v_id2, 'F');
  IF v_res2->>'number' <> 'F-' || v_year || '-00002' THEN RAISE EXCEPTION '(3) numéro % inattendu', v_res2->>'number'; END IF;

  -- (4) Ré-émettre une facture émise : refusé
  ok := false;
  BEGIN
    PERFORM public.invoice_issue(v_id, 'F');
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(4) double émission acceptée'; END IF;

  -- (5) Immuabilité : total figé, lignes figées ; pdf_path modifiable
  ok := false;
  BEGIN
    UPDATE public.majordhome_invoices SET total_ttc = 91, total_ht = 82.82 WHERE id = v_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(5) total d''une facture émise modifié'; END IF;
  UPDATE public.majordhome_invoices SET pdf_path = v_mayer || '/' || v_year || '/F-' || v_year || '-00001.pdf' WHERE id = v_id;
  SELECT pdf_path INTO v_inv FROM public.majordhome_invoices WHERE id = v_id;
  IF v_inv.pdf_path IS NULL THEN RAISE EXCEPTION '(5) pdf_path non posé'; END IF;
  ok := false;
  BEGIN
    DELETE FROM public.majordhome_invoices WHERE id = v_id;
    -- policy delete = brouillons seulement : 0 ligne, pas d'erreur
    GET DIAGNOSTICS n = ROW_COUNT;
    ok := (n = 0);
  END;
  IF NOT ok THEN RAISE EXCEPTION '(5) une facture émise a été supprimée'; END IF;

  -- (6) Brouillon sans ligne : refusé
  ok := false;
  BEGIN
    PERFORM public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), '[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(6) brouillon vide accepté'; END IF;

  -- (7) Préfixe invalide : refusé
  v_id3 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  ok := false;
  BEGIN
    PERFORM public.invoice_issue(v_id3, 'f-1');
  EXCEPTION WHEN SQLSTATE '22023' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(7) préfixe invalide accepté'; END IF;
  -- brouillon supprimable par team_leader+
  DELETE FROM public.majordhome_invoices WHERE id = v_id3;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '(7) brouillon non supprimable'; END IF;
  RESET ROLE;

  -- (8) Isolation cross-org : un membre d'une autre org ne voit rien, ne peut pas émettre
  IF v_etranger IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_etranger::text, false);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.majordhome_invoices WHERE org_id = v_mayer;
    IF n <> 0 THEN RAISE EXCEPTION '(8) % facture(s) Mayer visibles par une autre org', n; END IF;
    ok := false;
    BEGIN
      PERFORM public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
    EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
    END;
    IF NOT ok THEN RAISE EXCEPTION '(8) brouillon Mayer créé par une autre org'; END IF;
    RESET ROLE;
  ELSE
    RAISE NOTICE '(8) aucun membre d''une autre org : test cross-org sauté';
  END IF;

  -- (9) Anonyme : refusé
  PERFORM set_config('request.jwt.claim.sub', '', false);
  SET LOCAL ROLE authenticated;
  ok := false;
  BEGIN
    PERFORM public.invoice_create_draft(jsonb_build_object('org_id', v_mayer), jsonb_build_array(jsonb_build_object('label', 'x')));
  EXCEPTION WHEN SQLSTATE '42501' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(9) brouillon créé sans auth.uid()'; END IF;
  RESET ROLE;

  RAISE NOTICE 'assert-invoices B (fonctionnel) : OK';
END $$;
ROLLBACK;
```

- [ ] **Step 3: Rejouer sur le harnais**

Photographier la prod si le snapshot date (`scratch/` vide ou > 1 jour) :

```bash
node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local
```

Puis :

```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260923_1_invoices_hub.sql --assert scripts/migration-rehearsal/assert-invoices.sql
```

Expected : `assert-invoices A (structure) : OK`, `assert-invoices B (fonctionnel) : OK`, sortie `run.mjs` en succès. Si `run.mjs` échoue sur `relation "storage.buckets" does not exist`, appliquer le stub Storage du Step 2 dans `bootstrap-pre.sql` et relancer.

- [ ] **Step 4: Appliquer en prod**

Via le connecteur Supabase MCP `apply_migration` (projet `ejqqqwudmizqisdkxohw`, nom `20260923_1_invoices_hub`) avec le contenu exact du fichier. Puis vérifier l'effet réel (jamais le texte) :

```sql
SELECT to_regclass('majordhome.invoices'), to_regclass('public.majordhome_invoices'),
       has_function_privilege('anon', 'public.invoice_issue(uuid, text)', 'EXECUTE') AS anon_issue,
       has_table_privilege('service_role', 'majordhome.invoices', 'SELECT') AS sr_select,
       (SELECT count(*) FROM storage.buckets WHERE id = 'invoices') AS bucket,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'invoices_org_%') AS bucket_policies;
```

Expected : `majordhome.invoices`, `majordhome_invoices`, `anon_issue = false`, `sr_select = true`, `bucket = 1`, `bucket_policies = 4`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260923_1_invoices_hub.sql scripts/migration-rehearsal/assert-invoices.sql scripts/migration-rehearsal/bootstrap-pre.sql
git commit -m "feat(facturation): tables invoices/invoice_lines/invoice_sequences, RPC invoice_create_draft + invoice_issue, bucket invoices (hub phase 1)"
```

---

### Task 2: Axes analytiques sur les lignes du modèle d'entretien

**Files:**
- Modify: `src/lib/entretienInvoiceModel.js` (fonction `pushLine`, boucle « 1 ligne par équipement », boucle pièces)
- Test: `scripts/entretien-invoice-model.test.mjs`

**Interfaces:**
- Produces: chaque élément de `model.lines` porte en plus `ledgerAccountNumber: string|null` (numéro paramétré, ex. `'70601'`), `equipmentId: string|null`, `equipmentTypeId: string|null`, `categoryId: string|null`. Les champs existants (`kind, label, description, quantity, vatPercent, vatCode, ledgerAccountId, grossTtc, netTtc, discountPercent, unitPriceHt`) sont inchangés. `toPennylaneInvoicePayload` ignore les nouveaux champs.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `scripts/entretien-invoice-model.test.mjs` :

```js
test('lignes : axes analytiques (compte par numéro, équipement, type, catégorie) pour le journal d’intégration', () => {
  const m = buildEntretienInvoice(dalous({
    pricing: pricingFor([EQ_POELE]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 12 }],
    ledgerAccounts: { byCategory: { 'cat-poele': '70601' }, parts: '7070', catalog: [] },
  }));
  const [eq, piece] = m.lines;
  assert.equal(eq.kind, 'contrat');
  assert.equal(eq.ledgerAccountNumber, '70601');
  assert.equal(eq.equipmentId, 'eq-1');
  assert.equal(eq.equipmentTypeId, 'type-poele');
  assert.equal(eq.categoryId, 'cat-poele');
  assert.equal(piece.kind, 'piece');
  assert.equal(piece.ledgerAccountNumber, '7070');
  assert.equal(piece.equipmentId, null);
  assert.equal(piece.equipmentTypeId, null);
  assert.equal(piece.categoryId, null);
});

test('lignes : compte non paramétré → ledgerAccountNumber null (et avertissement existant)', () => {
  const m = buildEntretienInvoice(dalous({ ledgerAccounts: {} }));
  assert.equal(m.lines[0].ledgerAccountNumber, null);
  assert.ok(m.warnings.some((w) => w.code === 'compte_manquant'));
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node --test scripts/entretien-invoice-model.test.mjs`
Expected: 2 tests FAIL (`ledgerAccountNumber` undefined).

- [ ] **Step 3: Implémenter**

Dans `pushLine`, ajouter les 4 champs avec défaut null :

```js
    lines.push({
      ...line,
      grossTtc,
      netTtc: round2(line.netTtc ?? grossTtc),
      discountPercent: line.discountPercent || 0,
      vatCode: vatCode || null,
      ledgerAccountId: line.ledgerAccountId ?? null,
      ledgerAccountNumber: line.ledgerAccountNumber ?? null,
      equipmentId: line.equipmentId ?? null,
      equipmentTypeId: line.equipmentTypeId ?? null,
      categoryId: line.categoryId ?? null,
      unitPriceHt: unitHt(grossTtc, line.quantity, line.vatPercent),
    });
```

Dans la boucle « 1 ligne par équipement », le numéro paramétré est `ledgerAccounts?.byCategory?.[catId]` ; passer à `pushLine` :

```js
    const ledgerNumber = catId ? (ledgerAccounts?.byCategory?.[catId] ?? null) : null;
    pushLine({
      kind: 'contrat',
      label,
      description: ref,
      quantity: 1,
      vatPercent,
      ledgerAccountId: ledgerForCategory(catId, catLabel, VAT_CODES[vatPercent] || null),
      ledgerAccountNumber: ledgerNumber ? String(ledgerNumber) : null,
      equipmentId: eq?.id ?? null,
      equipmentTypeId: typeId,
      categoryId: catId,
      grossTtc,
      netTtc,
      discountPercent: discount ? discount.percent : 0,
    });
```

Dans la boucle pièces :

```js
    pushLine({
      kind: 'piece',
      label: part.designation || 'Pièce de rechange',
      description: part.reference || null,
      quantity: qty,
      vatPercent: partsVat,
      ledgerAccountId: partsLedgerId,
      ledgerAccountNumber: ledgerAccounts?.parts ? String(ledgerAccounts.parts) : null,
      grossTtc: unitTtc * qty,
    });
```

Mettre à jour le JSDoc `@returns` de `buildEntretienInvoice` : `lines: Array<{ …, ledgerAccountNumber, equipmentId, equipmentTypeId, categoryId }>`.

- [ ] **Step 4: Vérifier le passage**

Run: `node --test scripts/entretien-invoice-model.test.mjs`
Expected: tous PASS (les anciens tests ne comparent pas les lignes par `deepEqual` complet ; si l'un d'eux le fait, ajouter les 4 clés null à son attendu).

- [ ] **Step 5: Commit**

```bash
git add src/lib/entretienInvoiceModel.js scripts/entretien-invoice-model.test.mjs
git commit -m "feat(facturation): lignes d'entretien portent compte par numéro, équipement, type et catégorie (axes du journal d'intégration)"
```

---

### Task 3: Module pur `invoiceDocumentModel.js` — réglages, brouillon persistable, modèle PDF

**Files:**
- Create: `src/lib/invoiceDocumentModel.js`
- Test: `scripts/invoice-document-model.test.mjs`
- Modify: `package.json` (script `audit:quality`)

**Interfaces:**
- Consumes: `buildEntretienInvoice` (Task 2 : `model.lines[].{kind,label,description,quantity,vatPercent,netTtc,discountPercent,ledgerAccountId,ledgerAccountNumber,equipmentId,equipmentTypeId,categoryId}`, `model.subject`, `model.discount`, `model.totalTtc`), `buildCompanyInfo` / `formatFullAddress` / `buildLegalFooter` de `src/lib/orgBranding.js` (module sans import React, importable en node).
- Produces:
  - `INVOICING_DEFAULTS` et `invoicingSettings(settings) → { numberPrefix, iban, bic, paymentTerms, latePenalty, discountNote }`.
  - `validateIban(raw) → { ok: boolean, value: string }`, `validateBic(raw) → { ok, value }`.
  - `splitTtc(ttc, vatPercent) → { ht, tva, ttc }` (2 décimales, `ht + tva === ttc`).
  - `fmtEur(n) → '1 234,56 €'` (espaces ordinaires, virgule).
  - `buildInvoiceDraft({ model, orgId, context, client, contractId, interventionId, dueDays }) → { invoice, lines }` prêts pour `invoice_create_draft`.
  - `buildInvoicePdfModel({ invoice, lines, company, invoicing }) → { title, number, dates: { invoice, due }, customer: string[], subject, rows: [...], vatRows: [...], totals: { ht, tva, ttc }, discountLine, payment: string[], legal: string[], footer, rge }` — chaînes déjà formatées, PDF-safe.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// scripts/invoice-document-model.test.mjs — hub de facturation (src/lib/invoiceDocumentModel.js)
// node --test scripts/invoice-document-model.test.mjs
//
// Ce que la facture émise par Majord'home DOIT garantir (spec 2026-09-22) : montants au centime
// (ht + tva = ttc par ligne et au total), photo du client, réglages d'émission avec défauts
// neutres, mentions obligatoires sur le PDF, aucun glyphe hors cp1252.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVOICING_DEFAULTS, invoicingSettings, validateIban, validateBic, splitTtc, fmtEur,
  buildInvoiceDraft, buildInvoicePdfModel,
} from '../src/lib/invoiceDocumentModel.js';
import { buildCompanyInfo } from '../src/lib/orgBranding.js';

const MODEL = {
  date: '2026-09-23', deadline: '2026-10-23', subject: 'Entretien de votre poêle à bois : Jollymec · Quadro',
  discount: { percent: 10, amount: 10, degressivitePercent: 10, exceptionalAmount: 0, commercialAmount: 0 },
  totalTtc: 102,
  lines: [
    { kind: 'contrat', label: 'Entretien poêle', description: 'Jollymec · Quadro', quantity: 1, vatPercent: 10,
      grossTtc: 100, netTtc: 90, discountPercent: 10, ledgerAccountId: 123, ledgerAccountNumber: '70601',
      equipmentId: 'eq-1', equipmentTypeId: 'type-poele', categoryId: 'cat-poele' },
    { kind: 'piece', label: 'Joint', description: 'REF-1', quantity: 2, vatPercent: 10,
      grossTtc: 12, netTtc: 12, discountPercent: 0, ledgerAccountId: null, ledgerAccountNumber: '7070',
      equipmentId: null, equipmentTypeId: null, categoryId: null },
  ],
  warnings: [], errors: [],
};
const CLIENT = { id: 'cl-1', display_name: 'Anna FERNANDEZ', first_name: 'Anna', last_name: 'FERNANDEZ',
  address: '3 impasse des Lilas', postal_code: '81600', city: 'Gaillac', email: 'anna@example.org', phone: '0612345678', client_number: 286 };

test('invoicingSettings : défauts neutres, préfixe forcé en majuscules', () => {
  assert.deepEqual(invoicingSettings({}), INVOICING_DEFAULTS);
  assert.equal(invoicingSettings({ invoicing: { number_prefix: 'fm' } }).numberPrefix, 'FM');
  assert.equal(invoicingSettings({ invoicing: { number_prefix: '' } }).numberPrefix, 'F');
  assert.equal(invoicingSettings({ invoicing: { iban: 'FR76 1234' } }).iban, 'FR76 1234');
});

test('validateIban / validateBic : normalisation + format', () => {
  assert.deepEqual(validateIban('fr76 3000 6000 0112 3456 7890 189'), { ok: true, value: 'FR76 3000 6000 0112 3456 7890 189' });
  assert.equal(validateIban('FR76').ok, false);
  assert.equal(validateIban('').ok, true); // vide = pas de bloc paiement, pas une erreur
  assert.deepEqual(validateBic('agrifrpp'), { ok: true, value: 'AGRIFRPP' });
  assert.deepEqual(validateBic('AGRIFRPP882'), { ok: true, value: 'AGRIFRPP882' });
  assert.equal(validateBic('AGRI').ok, false);
});

test('splitTtc : ht + tva = ttc au centime', () => {
  assert.deepEqual(splitTtc(90, 10), { ht: 81.82, tva: 8.18, ttc: 90 });
  assert.deepEqual(splitTtc(100, 20), { ht: 83.33, tva: 16.67, ttc: 100 });
  assert.deepEqual(splitTtc(12, 0), { ht: 12, tva: 0, ttc: 12 });
  for (const [ttc, r] of [[0.01, 20], [33.33, 5.5], [999.99, 10]]) {
    const s = splitTtc(ttc, r);
    assert.equal(Math.round((s.ht + s.tva) * 100), Math.round(s.ttc * 100));
  }
});

test('fmtEur : espaces ordinaires, virgule, deux décimales', () => {
  assert.equal(fmtEur(1234.5), '1 234,50 €');
  assert.equal(fmtEur(0), '0,00 €');
  assert.equal(fmtEur(-40), '-40,00 €');
  assert.ok(!/[\u202f\u00a0]/.test(fmtEur(1234567.89)));
});

test('buildInvoiceDraft : en-tête + lignes persistables, totaux = sommes des lignes', () => {
  const { invoice, lines } = buildInvoiceDraft({
    model: MODEL, orgId: 'org-1', context: 'contrat', client: CLIENT, contractId: 'ct-1', interventionId: 'iv-1', dueDays: 30,
  });
  assert.equal(invoice.org_id, 'org-1');
  assert.equal(invoice.kind, 'invoice');
  assert.equal(invoice.client_id, 'cl-1');
  assert.equal(invoice.contract_id, 'ct-1');
  assert.equal(invoice.intervention_id, 'iv-1');
  assert.equal(invoice.due_days, 30);
  assert.equal(invoice.subject, MODEL.subject);
  assert.deepEqual(invoice.customer, {
    name: 'Anna FERNANDEZ', address: '3 impasse des Lilas', postal_code: '81600', city: 'Gaillac',
    email: 'anna@example.org', phone: '0612345678', client_number: 286,
  });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], {
    position: 1, kind: 'contrat', label: 'Entretien poêle', description: 'Jollymec · Quadro', quantity: 1,
    unit_price_ht: 81.8182, vat_rate: 10, discount_percent: 10, ht: 81.82, tva: 8.18, ttc: 90,
    ledger_account_number: '70601', ledger_account_pl_id: 123, metier_key: 'type-poele', equipment_id: 'eq-1', category_id: 'cat-poele',
  });
  assert.equal(lines[1].quantity, 2);
  assert.equal(lines[1].unit_price_ht, 5.4545);
  assert.equal(lines[1].ttc, 12);
  assert.equal(invoice.total_ht, 92.73);
  assert.equal(invoice.total_tva, 9.27);
  assert.equal(invoice.total_ttc, 102);
  assert.deepEqual(invoice.vat_breakdown, [{ rate: 10, base: 92.73, amount: 9.27 }]);
  assert.deepEqual(invoice.discount, MODEL.discount);
});

test('buildInvoiceDraft : ventilation TVA multi-taux et client sans email', () => {
  const model = { ...MODEL, lines: [MODEL.lines[0], { ...MODEL.lines[1], vatPercent: 20 }] };
  const { invoice } = buildInvoiceDraft({ model, orgId: 'org-1', client: { ...CLIENT, email: null }, dueDays: 45 });
  assert.deepEqual(invoice.vat_breakdown, [{ rate: 10, base: 81.82, amount: 8.18 }, { rate: 20, base: 10, amount: 2 }]);
  assert.equal(invoice.total_ttc, 102);
  assert.equal(invoice.customer.email, null);
  assert.equal(invoice.due_days, 45);
});

test('buildInvoiceDraft : nom client = display_name, sinon "Prénom NOM"', () => {
  const { invoice } = buildInvoiceDraft({ model: MODEL, orgId: 'o', client: { first_name: 'Anna', last_name: 'FERNANDEZ' }, dueDays: 30 });
  assert.equal(invoice.customer.name, 'Anna FERNANDEZ');
});

const ISSUED = {
  id: 'inv-1', number: 'F-2026-00012', kind: 'invoice', status: 'issued', invoice_date: '2026-09-23', due_at: '2026-10-23',
  subject: 'Entretien de votre poêle', customer: { name: 'Anna FERNANDEZ', address: '3 impasse des Lilas', postal_code: '81600', city: 'Gaillac', client_number: 286 },
  total_ht: 92.73, total_tva: 9.27, total_ttc: 102, vat_breakdown: [{ rate: 10, base: 92.73, amount: 9.27 }],
  discount: { percent: 10, amount: 10, degressivitePercent: 10, exceptionalAmount: 0, commercialAmount: 0 },
};
const LINES = [
  { position: 1, kind: 'contrat', label: 'Entretien poêle', description: 'Jollymec · Quadro', quantity: 1, unit_price_ht: 81.8182, vat_rate: 10, discount_percent: 10, ht: 81.82, tva: 8.18, ttc: 90 },
  { position: 2, kind: 'piece', label: 'Joint', description: null, quantity: 2, unit_price_ht: 5.4545, vat_rate: 10, discount_percent: 0, ht: 10.91, tva: 1.09, ttc: 12 },
];
const COMPANY = buildCompanyInfo({ brand_name: 'Test Énergie', legal_name: 'TEST ENERGIE', legal_form: 'SAS', capital: '6 000', siret: '100 288 224 00015',
  rcs: '100 288 224 R.C.S. Albi', tva_intra: 'FR 06 449776916', address: '26 rue des Pyrénées', postal_code: '81600', city: 'Gaillac', phone: '05 63 00 00 00',
  from_email: 'contact@test.fr', rge_certifications: ['QualiBois'] });
const INVOICING = invoicingSettings({ invoicing: { iban: 'FR76 3000 6000 0112 3456 7890 189', bic: 'AGRIFRPP882' } });

test('buildInvoicePdfModel : en-tête, lignes, TVA, totaux, remise', () => {
  const pdf = buildInvoicePdfModel({ invoice: ISSUED, lines: LINES, company: COMPANY, invoicing: INVOICING });
  assert.equal(pdf.title, 'FACTURE');
  assert.equal(pdf.number, 'F-2026-00012');
  assert.deepEqual(pdf.dates, { invoice: '23/09/2026', due: '23/10/2026' });
  assert.deepEqual(pdf.customer, ['Anna FERNANDEZ', '3 impasse des Lilas', '81600 Gaillac', 'Client n° 286']);
  assert.equal(pdf.rows.length, 2);
  assert.deepEqual(pdf.rows[0], { label: 'Entretien poêle', description: 'Jollymec · Quadro', qty: '1', unitHt: '81,82 €', vat: '10 %', ht: '81,82 €' });
  assert.equal(pdf.rows[1].qty, '2');
  assert.equal(pdf.rows[1].unitHt, '5,45 €');
  assert.deepEqual(pdf.vatRows, [{ rate: '10 %', base: '92,73 €', amount: '9,27 €' }]);
  assert.deepEqual(pdf.totals, { ht: '92,73 €', tva: '9,27 €', ttc: '102,00 €' });
  assert.equal(pdf.discountLine, 'Remise 10 % appliquée sur les équipements (dégressivité 10 %) : -10,00 € TTC');
});

test('buildInvoicePdfModel : mentions obligatoires, paiement, RGE, pied de page', () => {
  const pdf = buildInvoicePdfModel({ invoice: ISSUED, lines: LINES, company: COMPANY, invoicing: INVOICING });
  assert.deepEqual(pdf.payment, [
    'Paiement à réception, au plus tard à la date d’échéance.',
    'IBAN : FR76 3000 6000 0112 3456 7890 189 — BIC : AGRIFRPP882',
  ]);
  assert.ok(pdf.legal.some((l) => l.includes('trois fois le taux d’intérêt légal')));
  assert.ok(pdf.legal.some((l) => l.includes('40 €')));
  assert.ok(pdf.legal.some((l) => l.includes('escompte')));
  assert.equal(pdf.rge, 'Certifications : QualiBois');
  assert.ok(pdf.footer.includes('TEST ENERGIE') && pdf.footer.includes('SIRET 100 288 224 00015') && pdf.footer.includes('TVA FR 06 449776916'));
});

test('buildInvoicePdfModel : sans IBAN → pas de ligne IBAN ; sans RGE → null ; avoir → AVOIR', () => {
  const pdf = buildInvoicePdfModel({ invoice: { ...ISSUED, kind: 'credit_note', credited_number: 'F-2026-00011' }, lines: LINES,
    company: buildCompanyInfo({}), invoicing: invoicingSettings({}) });
  assert.equal(pdf.title, 'AVOIR');
  assert.equal(pdf.creditedNumber, 'F-2026-00011');
  assert.equal(pdf.payment.length, 1);
  assert.equal(pdf.rge, null);
});

test('buildInvoicePdfModel : aucun glyphe hors cp1252 dans les chaînes rendues', () => {
  const pdf = buildInvoicePdfModel({ invoice: ISSUED, lines: LINES, company: COMPANY, invoicing: INVOICING });
  const all = JSON.stringify(pdf);
  assert.ok(!/[\u202f\u2212\u2192\u2265\u2264\u0394\u03b8\u03a6]/.test(all), 'glyphe interdit trouvé');
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `node --test scripts/invoice-document-model.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/invoiceDocumentModel.js'`.

- [ ] **Step 3: Implémenter le module**

```js
// src/lib/invoiceDocumentModel.js
// ============================================================================
// Hub de facturation — modèle PUR (aucun import React / Supabase) de la facture
// émise par Majord'home. Testé par scripts/invoice-document-model.test.mjs
// (inclus dans audit:quality). Spec :
// docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md
//
//  - `buildInvoiceDraft` : du modèle d'entretien (`buildEntretienInvoice`) vers
//    l'en-tête + les lignes persistables (RPC invoice_create_draft). Montants au
//    centime : ht + tva = ttc PAR LIGNE, totaux = sommes des lignes, ventilation TVA
//    par taux. `customer` = photo du client : une facture émise ne suit plus la fiche.
//  - `buildInvoicePdfModel` : de la facture ÉMISE (valeurs enregistrées, jamais
//    recalculées) vers les chaînes du PDF, formatées ici (PDF-safe : pas de
//    glyphes hors cp1252, espaces ordinaires) — le composant react-pdf ne
//    calcule et ne formate rien.
//  - Réglages d'émission `settings.invoicing` avec défauts neutres (jamais Mayer).
// ============================================================================
import { formatFullAddress, buildLegalFooter } from './orgBranding.js';

export const INVOICING_DEFAULTS = Object.freeze({
  numberPrefix: 'F',
  iban: '',
  bic: '',
  paymentTerms: 'Paiement à réception, au plus tard à la date d’échéance.',
  latePenalty: 'Pénalités de retard : trois fois le taux d’intérêt légal en vigueur, exigibles sans rappel. Indemnité forfaitaire pour frais de recouvrement : 40 €.',
  discountNote: 'Pas d’escompte pour paiement anticipé.',
});

/**
 * Réglages d'émission (`settings.invoicing`), avec défauts neutres.
 * @param {object} settings  core.organizations.settings
 * @returns {{ numberPrefix: string, iban: string, bic: string, paymentTerms: string, latePenalty: string, discountNote: string }}
 */
export function invoicingSettings(settings) {
  const s = settings?.invoicing || {};
  const prefix = String(s.number_prefix || '').trim().toUpperCase();
  const str = (v, d) => (typeof v === 'string' && v.trim() ? v : d);
  return {
    numberPrefix: /^[A-Z][A-Z0-9]{0,5}$/.test(prefix) ? prefix : INVOICING_DEFAULTS.numberPrefix,
    iban: typeof s.iban === 'string' ? s.iban : '',
    bic: typeof s.bic === 'string' ? s.bic : '',
    paymentTerms: str(s.payment_terms, INVOICING_DEFAULTS.paymentTerms),
    latePenalty: str(s.late_penalty, INVOICING_DEFAULTS.latePenalty),
    discountNote: str(s.discount_note, INVOICING_DEFAULTS.discountNote),
  };
}

/** IBAN : normalisé en majuscules par groupes de 4. Vide = OK (pas de bloc paiement). */
export function validateIban(raw) {
  const compact = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!compact) return { ok: true, value: '' };
  const ok = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact);
  return { ok, value: compact.replace(/(.{4})/g, '$1 ').trim() };
}

/** BIC : 8 ou 11 caractères. Vide = OK. */
export function validateBic(raw) {
  const value = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!value) return { ok: true, value: '' };
  return { ok: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value), value };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/** TTC → { ht, tva, ttc } au centime, avec ht + tva = ttc garanti. */
export function splitTtc(ttc, vatPercent) {
  const t = round2(ttc);
  const ht = round2(t / (1 + (Number(vatPercent) || 0) / 100));
  return { ht, tva: round2(t - ht), ttc: t };
}

/** `1 234,56 €` — espaces ORDINAIRES (Helvetica ne connaît pas U+202F), virgule décimale. */
export function fmtEur(n) {
  const v = round2(n);
  const sign = v < 0 ? '-' : '';
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
}

const fmtDateFr = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const fmtQty = (q) => String(round4(q)).replace('.', ',');
const fmtPct = (p) => `${String(round4(p)).replace('.', ',')} %`;

function customerSnapshot(client) {
  const c = client || {};
  const name = (c.display_name || `${c.first_name || ''} ${c.last_name || ''}`).trim() || 'Client';
  return {
    name,
    address: c.address || null,
    postal_code: c.postal_code || null,
    city: c.city || null,
    email: c.email || null,
    phone: c.phone || null,
    client_number: c.client_number ?? null,
  };
}

/**
 * En-tête + lignes persistables à partir du modèle d'entretien.
 * @param {object} p
 * @param {ReturnType<import('./entretienInvoiceModel.js').buildEntretienInvoice>} p.model
 * @param {string} p.orgId  org CORE
 * @param {string} [p.context]  clé de PENNYLANE_CHART_CONTEXTS (défaut 'contrat')
 * @param {object} p.client  fiche client (display_name, first_name, last_name, address, postal_code, city, email, phone, client_number, id)
 * @param {string|null} [p.contractId]
 * @param {string|null} [p.interventionId]
 * @param {number} p.dueDays
 * @returns {{ invoice: object, lines: object[] }}
 */
export function buildInvoiceDraft({ model, orgId, context = 'contrat', client, contractId = null, interventionId = null, dueDays }) {
  const byRate = new Map();
  let totalHt = 0;
  let totalTva = 0;
  let totalTtc = 0;
  const lines = (model?.lines || []).map((l, i) => {
    const { ht, tva, ttc } = splitTtc(l.netTtc, l.vatPercent);
    const rate = Number(l.vatPercent) || 0;
    const acc = byRate.get(rate) || { rate, base: 0, amount: 0 };
    acc.base = round2(acc.base + ht);
    acc.amount = round2(acc.amount + tva);
    byRate.set(rate, acc);
    totalHt = round2(totalHt + ht);
    totalTva = round2(totalTva + tva);
    totalTtc = round2(totalTtc + ttc);
    return {
      position: i + 1,
      kind: l.kind || 'libre',
      label: l.label,
      description: l.description || null,
      quantity: Number(l.quantity) || 1,
      unit_price_ht: round4(ht / (Number(l.quantity) || 1)),
      vat_rate: rate,
      discount_percent: Number(l.discountPercent) || 0,
      ht,
      tva,
      ttc,
      ledger_account_number: l.ledgerAccountNumber ?? null,
      ledger_account_pl_id: l.ledgerAccountId == null ? null : Number(l.ledgerAccountId),
      metier_key: l.equipmentTypeId ?? null,
      equipment_id: l.equipmentId ?? null,
      category_id: l.categoryId ?? null,
    };
  });
  const invoice = {
    org_id: orgId,
    kind: 'invoice',
    context,
    client_id: client?.id ?? null,
    contract_id: contractId,
    intervention_id: interventionId,
    customer: customerSnapshot(client),
    subject: model?.subject || null,
    currency: 'EUR',
    due_days: Number(dueDays) || 30,
    total_ht: totalHt,
    total_tva: totalTva,
    total_ttc: totalTtc,
    vat_breakdown: [...byRate.values()].sort((a, b) => a.rate - b.rate),
    discount: model?.discount || null,
  };
  return { invoice, lines };
}

function discountLineOf(discount) {
  if (!discount || !(Number(discount.amount) > 0)) return null;
  const causes = [
    discount.degressivitePercent > 0 ? `dégressivité ${fmtPct(discount.degressivitePercent)}` : null,
    discount.exceptionalAmount > 0 ? `remise exceptionnelle ${fmtEur(discount.exceptionalAmount)}` : null,
    discount.commercialAmount > 0 ? `remise commerciale ${fmtEur(discount.commercialAmount)}` : null,
  ].filter(Boolean).join(' + ') || 'montant du contrat';
  return `Remise ${fmtPct(discount.percent)} appliquée sur les équipements (${causes}) : -${fmtEur(discount.amount)} TTC`;
}

/**
 * Modèle de rendu du PDF à partir d'une facture ÉMISE (valeurs enregistrées).
 * @param {object} p
 * @param {object} p.invoice  ligne de majordhome_invoices (+ `credited_number` pour un avoir)
 * @param {object[]} p.lines  lignes de majordhome_invoice_lines, triées par position
 * @param {object} p.company  `buildCompanyInfo(settings)`
 * @param {ReturnType<typeof invoicingSettings>} p.invoicing
 */
export function buildInvoicePdfModel({ invoice, lines, company, invoicing }) {
  const cust = invoice.customer || {};
  const customer = [
    cust.name,
    cust.address,
    [cust.postal_code, cust.city].filter(Boolean).join(' ') || null,
    cust.client_number != null ? `Client n° ${cust.client_number}` : null,
  ].filter(Boolean);
  const rows = [...(lines || [])].sort((a, b) => a.position - b.position).map((l) => ({
    label: l.label,
    description: l.description || null,
    qty: fmtQty(l.quantity),
    unitHt: fmtEur(l.unit_price_ht),
    vat: fmtPct(l.vat_rate),
    ht: fmtEur(l.ht),
  }));
  const vatRows = (invoice.vat_breakdown || []).map((v) => ({ rate: fmtPct(v.rate), base: fmtEur(v.base), amount: fmtEur(v.amount) }));
  const payment = [invoicing.paymentTerms];
  const iban = validateIban(invoicing.iban);
  const bic = validateBic(invoicing.bic);
  if (iban.value) payment.push(`IBAN : ${iban.value}${bic.value ? ` — BIC : ${bic.value}` : ''}`);
  const footerParts = [buildLegalFooter(company)];
  if (company.siret) footerParts.push(`SIRET ${company.siret}`);
  if (company.tvaIntra) footerParts.push(`TVA ${company.tvaIntra}`);
  return {
    title: invoice.kind === 'credit_note' ? 'AVOIR' : 'FACTURE',
    number: invoice.number,
    creditedNumber: invoice.kind === 'credit_note' ? invoice.credited_number || null : null,
    dates: { invoice: fmtDateFr(invoice.invoice_date), due: fmtDateFr(invoice.due_at) },
    customer,
    subject: invoice.subject || null,
    rows,
    vatRows,
    totals: { ht: fmtEur(invoice.total_ht), tva: fmtEur(invoice.total_tva), ttc: fmtEur(invoice.total_ttc) },
    discountLine: discountLineOf(invoice.discount),
    payment,
    legal: [invoicing.latePenalty, invoicing.discountNote].filter(Boolean),
    rge: company.rgeCertifications?.length ? `Certifications : ${company.rgeCertifications.join(', ')}` : null,
    companyAddress: formatFullAddress(company),
    footer: footerParts.filter(Boolean).join(' — '),
  };
}
```

- [ ] **Step 4: Vérifier le passage**

Run: `node --test scripts/invoice-document-model.test.mjs`
Expected: tous PASS. Si `orgBranding.js` refuse de s'importer en node (import d'un module non pur), corriger l'import dans `invoiceDocumentModel.js` en recopiant `formatFullAddress`/`buildLegalFooter` **n'est pas** la solution : vérifier d'abord `node -e "import('./src/lib/orgBranding.js').then(m=>console.log(Object.keys(m)))"` — le fichier n'a aucun import, il doit passer.

- [ ] **Step 5: Ajouter le test à `audit:quality`**

Dans `package.json`, script `audit:quality`, ajouter ` scripts/invoice-document-model.test.mjs` après `scripts/entretien-invoice-model.test.mjs` :

```json
"audit:quality": "npm run lint:errors && node --test scripts/tournee/sync-engine.test.mjs scripts/modules.test.mjs scripts/audit-trail.test.mjs scripts/entretien-invoice-model.test.mjs scripts/invoice-document-model.test.mjs scripts/install-order.test.mjs && npm run audit:dead-code",
```

Run: `npm run audit:quality`
Expected: vert (le module n'a pas encore de caller : `audit:dead-code` le signalera peut-être — c'est attendu jusqu'à la Task 6, ne pas « corriger »).

- [ ] **Step 6: Commit**

```bash
git add src/lib/invoiceDocumentModel.js scripts/invoice-document-model.test.mjs package.json
git commit -m "feat(facturation): modèle pur de la facture émise (brouillon persistable, ventilation TVA, modèle PDF, réglages d'émission)"
```

---

### Task 4: Réglages d'émission dans Settings + mode « hub »

**Files:**
- Create: `src/apps/artisan/pages/settings/pennylane/EmissionTab.jsx`
- Modify: `src/apps/artisan/pages/settings/PennylaneSettings.jsx`
- Modify: `src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx` (sélecteur « Mode de création » + texte du bloc Journal)
- Modify: `src/shared/hooks/useOrgSettings.js` (`pennylaneInvoiceSettings`)
- Modify: `src/lib/modules.js` (tuile `pennylane`)

**Interfaces:**
- Consumes: `invoicingSettings`, `validateIban`, `validateBic`, `INVOICING_DEFAULTS` (Task 3) ; `useOrgSettings().{settings, save, isSaving, isLoading}` ; `SettingsPage` (props `tabs`, `tab`, `onTabChange`).
- Produces: `settings.invoicing = { number_prefix, iban, bic, payment_terms, late_penalty, discount_note }` ; `pennylaneInvoiceSettings(settings).mode ∈ 'draft' | 'final' | 'hub'`.

- [ ] **Step 1: `pennylaneInvoiceSettings` accepte `hub`**

Dans `src/shared/hooks/useOrgSettings.js`, remplacer :

```js
    mode: inv.mode === 'final' ? 'final' : PENNYLANE_INVOICE_DEFAULTS.mode,
```

par :

```js
    // 'draft' | 'final' = Pennylane crée la facture ; 'hub' = Majord'home émet, numérote et
    // archive (phase 1 du hub, spec 2026-09-22) — l'import Pennylane arrive en phase 2.
    mode: inv.mode === 'final' || inv.mode === 'hub' ? inv.mode : PENNYLANE_INVOICE_DEFAULTS.mode,
```

- [ ] **Step 2: Créer `EmissionTab.jsx`**

```jsx
// src/apps/artisan/pages/settings/pennylane/EmissionTab.jsx
// ============================================================================
// Réglages `settings.invoicing` : ce que Majord'home met sur les factures qu'il
// émet lui-même (mode « hub », spec 2026-09-22) — préfixe de numérotation,
// coordonnées bancaires, conditions de paiement, pénalités, escompte.
// `org_update_settings` merge le JSONB au niveau 1 → on renvoie TOUJOURS l'objet
// `invoicing` complet. Lecture côté métier : `invoicingSettings()` (module pur).
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { invoicingSettings, validateIban, validateBic, INVOICING_DEFAULTS } from '@/lib/invoiceDocumentModel';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

function pickForm(settings) {
  const s = invoicingSettings(settings);
  return {
    number_prefix: s.numberPrefix,
    iban: s.iban,
    bic: s.bic,
    payment_terms: s.paymentTerms,
    late_penalty: s.latePenalty,
    discount_note: s.discountNote,
  };
}

function validate(form) {
  const errors = {};
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(form.number_prefix)) errors.number_prefix = '1 à 6 caractères A-Z / 0-9, commence par une lettre';
  if (!validateIban(form.iban).ok) errors.iban = 'IBAN invalide (ex. FR76 3000 6000 0112 3456 7890 189)';
  if (!validateBic(form.bic).ok) errors.bic = 'BIC invalide (8 ou 11 caractères)';
  if (!form.payment_terms.trim()) errors.payment_terms = 'Obligatoire sur une facture';
  if (!form.late_penalty.trim()) errors.late_penalty = 'Mention légale obligatoire';
  return errors;
}

export default function EmissionTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickForm({}));
  const [initial, setInitial] = useState(() => pickForm({}));

  useEffect(() => {
    const picked = pickForm(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async () => {
    if (!isValid) return;
    try {
      const invoicing = {
        ...(settings?.invoicing || {}),
        number_prefix: form.number_prefix.trim().toUpperCase(),
        iban: validateIban(form.iban).value,
        bic: validateBic(form.bic).value,
        payment_terms: form.payment_terms.trim(),
        late_penalty: form.late_penalty.trim(),
        discount_note: form.discount_note.trim(),
      };
      await save({ invoicing });
      toast.success('Émission des factures enregistrée');
      setInitial(pickForm({ invoicing }));
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    }
  };

  if (isLoading) return <div className="card text-sm text-secondary-500">Chargement…</div>;

  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Numérotation</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Préfixe des numéros</label>
            <input type="text" value={form.number_prefix} onChange={(e) => setForm({ ...form, number_prefix: e.target.value.toUpperCase() })} className={INPUT_CLASS} maxLength={6} />
            {errors.number_prefix && <p className={ERROR_CLASS}>{errors.number_prefix}</p>}
            <p className={HINT_CLASS}>
              Numéro = préfixe-année-compteur, ex. {form.number_prefix || INVOICING_DEFAULTS.numberPrefix}-{new Date().getFullYear()}-00001. Le compteur repart à 1 chaque année,
              sans trou, attribué à l&apos;émission. Si Pennylane numérote aussi des factures (série « F »), choisissez un préfixe différent.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Coordonnées bancaires (bloc paiement du PDF)</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>IBAN</label>
            <input type="text" value={form.iban} onChange={set('iban')} onBlur={() => setForm((f) => ({ ...f, iban: validateIban(f.iban).value || f.iban }))} className={INPUT_CLASS} placeholder="FR76 …" />
            {errors.iban && <p className={ERROR_CLASS}>{errors.iban}</p>}
            <p className={HINT_CLASS}>Vide : la facture ne porte pas de bloc IBAN.</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>BIC</label>
            <input type="text" value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value.toUpperCase() })} className={INPUT_CLASS} placeholder="AGRIFRPP882" />
            {errors.bic && <p className={ERROR_CLASS}>{errors.bic}</p>}
          </div>
        </div>
      </section>

      <section>
        <h3 className={SECTION_TITLE}>Mentions de paiement</h3>
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLASS}>Conditions de paiement</label>
            <input type="text" value={form.payment_terms} onChange={set('payment_terms')} className={INPUT_CLASS} />
            {errors.payment_terms && <p className={ERROR_CLASS}>{errors.payment_terms}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Pénalités de retard et indemnité de recouvrement</label>
            <textarea rows={2} value={form.late_penalty} onChange={set('late_penalty')} className={INPUT_CLASS} />
            {errors.late_penalty && <p className={ERROR_CLASS}>{errors.late_penalty}</p>}
            <p className={HINT_CLASS}>Mention obligatoire entre professionnels (taux des pénalités + indemnité forfaitaire de 40 €).</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>Escompte</label>
            <input type="text" value={form.discount_note} onChange={set('discount_note')} className={INPUT_CLASS} />
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button type="button" onClick={() => setForm(initial)} disabled={!isDirty || isSaving} className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50">
          Annuler
        </button>
        <button type="button" onClick={handleSave} disabled={!isDirty || !isValid || isSaving} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50">
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Page à deux onglets**

Remplacer `src/apps/artisan/pages/settings/PennylaneSettings.jsx` par :

```jsx
// src/apps/artisan/pages/settings/PennylaneSettings.jsx
// Settings → Socle → Facturation (/settings/pennylane) : deux onglets.
//  - Émission : ce que Majord'home met sur les factures qu'il émet (préfixe, IBAN,
//    mentions) — hub de facturation phase 1 (spec 2026-09-22).
//  - Pennylane : activation de l'intégration, mode de création des factures
//    d'entretien (brouillon / finalisée / émise par Majord'home), comptes de vente.
import { useState } from 'react';
import { FileText, Receipt } from 'lucide-react';
import SettingsPage from './SettingsPage';
import EmissionTab from './pennylane/EmissionTab';
import FacturationTab from './pennylane/FacturationTab';

const TABS = [
  { key: 'emission', label: 'Émission', icon: FileText, Component: EmissionTab },
  { key: 'pennylane', label: 'Pennylane', icon: Receipt, Component: FacturationTab },
];

export default function PennylaneSettings() {
  const [tab, setTab] = useState('emission');
  const Active = TABS.find((t) => t.key === tab)?.Component || EmissionTab;
  return (
    <SettingsPage
      title="Facturation"
      description="Les factures émises par Majord'home (numérotation, mentions, coordonnées bancaires) et le lien avec Pennylane."
      tabs={TABS}
      tab={tab}
      onTabChange={setTab}
    >
      <Active />
    </SettingsPage>
  );
}
```

- [ ] **Step 4: Option `hub` dans `FacturationTab.jsx`**

Dans le `<select>` « Mode de création », après l'option `final` :

```jsx
              <option value="hub">Émise par Majord&apos;home — numéro et PDF Majord&apos;home (import Pennylane : phase 2)</option>
```

Remplacer le `<p className={HINT_CLASS}>` sous ce select par :

```jsx
            <p className={HINT_CLASS}>
              Brouillon : vous relisez et envoyez depuis Pennylane. Finalisée : document légal immédiat. Émise par Majord&apos;home :
              Majord&apos;home numérote, produit le PDF (onglet Émission) et l&apos;archive ; l&apos;import dans Pennylane viendra en phase 2 —
              en attendant, rien n&apos;est envoyé à Pennylane dans ce mode.
            </p>
```

Dans le bloc « Journal des factures Majordhome », remplacer le texte d'aide par :

```jsx
            <p className={HINT_CLASS}>
              Réglage conservé pour mémoire : Pennylane n&apos;accepte pas de déplacer l&apos;écriture d&apos;une facture par l&apos;API (vérifié le 22/09/2026),
              les factures tombent dans le journal de ventes principal. Un changement de journal se fait dans Pennylane, à la main ou en masse.
            </p>
```

- [ ] **Step 5: Tuile Paramètres**

Dans `src/lib/modules.js`, la tuile `pennylane` devient :

```js
      { key: 'pennylane', title: 'Facturation', description: 'Numérotation, mentions et coordonnées bancaires des factures ; lien Pennylane et comptes de vente', icon: 'Receipt', href: '/settings/pennylane', adminOnly: true },
```

- [ ] **Step 6: Vérifier**

```bash
node --test scripts/modules.test.mjs && npm run lint:errors && npx vite build
```

Expected : tests OK, lint sans erreur, build vert. Puis Eric vérifie sur son serveur : `/settings/pennylane` affiche deux onglets, l'onglet Émission enregistre (réseau : RPC `org_update_settings` avec `{ invoicing: {…} }` complet), le sélecteur de mode propose « Émise par Majord'home ».

- [ ] **Step 7: Commit**

```bash
git add src/apps/artisan/pages/settings/pennylane/EmissionTab.jsx src/apps/artisan/pages/settings/PennylaneSettings.jsx src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx src/shared/hooks/useOrgSettings.js src/lib/modules.js
git commit -m "feat(settings): onglet Émission des factures (préfixe, IBAN/BIC, mentions) + mode « émise par Majord'home »"
```

---

### Task 5: Document PDF de la facture

**Files:**
- Create: `src/apps/artisan/components/facturation/InvoicePDF.jsx`

**Interfaces:**
- Consumes: `buildInvoicePdfModel` (Task 3) → `pdfModel` ; `company` (`buildCompanyInfo`) ; `pdfShared.jsx` (`C`, `sharedStyles`, `CompanyHeader`, `accentOf`).
- Produces: `InvoiceDocument({ model, company })` (react-pdf `<Document>`) et `generateInvoicePdfBlob(pdfModel, company) → Promise<Blob>`.

- [ ] **Step 1: Écrire le composant**

```jsx
/* eslint-disable react-refresh/only-export-components -- module de rendu PDF (blob), rien n'est monté dans l'app */
// src/apps/artisan/components/facturation/InvoicePDF.jsx
// ============================================================================
// PDF d'une facture émise par Majord'home (hub de facturation phase 1, spec
// 2026-09-22). Ce composant NE CALCULE ET NE FORMATE RIEN : il dessine le modèle
// produit par `buildInvoicePdfModel` (src/lib/invoiceDocumentModel.js) — un
// chiffre du PDF absent de ce modèle est un bug du modèle, pas d'ici.
// Socle graphique commun : src/lib/pdfShared.jsx (Helvetica : glyphes cp1252 only).
// ============================================================================
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer';
import { C, sharedStyles, CompanyHeader, accentOf } from '@lib/pdfShared';

const s = StyleSheet.create({
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 4, marginBottom: 10 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  number: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  meta: { fontSize: 7.5, color: C.grisTxt, marginTop: 2 },
  blocks: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  block: { flex: 1, border: `0.7px solid ${C.grisBar}`, borderRadius: 4, padding: 7 },
  blockLabel: { fontSize: 6.5, color: C.grisTxt, marginBottom: 3 },
  blockLine: { fontSize: 8 },
  subject: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  th: { flexDirection: 'row', paddingVertical: 3, borderBottom: `0.7px solid ${C.grisBar}` },
  tr: { flexDirection: 'row', paddingVertical: 4, borderBottom: `0.4px solid ${C.grisClair}` },
  cLabel: { flex: 1 },
  cQty: { width: 34, textAlign: 'right' },
  cUnit: { width: 62, textAlign: 'right' },
  cVat: { width: 40, textAlign: 'right' },
  cHt: { width: 66, textAlign: 'right' },
  desc: { fontSize: 6.8, color: C.grisTxt, marginTop: 1 },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  totals: { width: 220 },
  totLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totLabel: { fontSize: 7.5, color: C.grisTxt },
  totValue: { fontSize: 7.5 },
  totTtc: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginTop: 3, borderTop: `0.9px solid ${C.noir}` },
  totTtcTxt: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  discount: { fontSize: 7, color: C.grisTxt, marginTop: 4, textAlign: 'right' },
  para: { fontSize: 7, marginTop: 3 },
  legal: { fontSize: 6.5, color: C.grisTxt, marginTop: 2 },
});

function Th({ children, style }) { return <Text style={[sharedStyles.th, style]}>{children}</Text>; }
function Td({ children, style }) { return <Text style={[sharedStyles.td, style]}>{children}</Text>; }

/** @param {{ model: ReturnType<import('@/lib/invoiceDocumentModel').buildInvoicePdfModel>, company: object }} p */
export function InvoiceDocument({ model, company }) {
  const accent = accentOf(company);
  return (
    <Document title={`${model.title} ${model.number}`} author={company.name}>
      <Page size="A4" style={sharedStyles.page}>
        <CompanyHeader company={company} />

        <View style={s.titleRow}>
          <View>
            <Text style={[s.title, { color: accent }]}>{model.title}</Text>
            {model.creditedNumber ? <Text style={s.meta}>Avoir sur la facture {model.creditedNumber}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.number}>N° {model.number}</Text>
            <Text style={s.meta}>Date : {model.dates.invoice}</Text>
            <Text style={s.meta}>Échéance : {model.dates.due}</Text>
          </View>
        </View>

        <View style={s.blocks}>
          <View style={s.block}>
            <Text style={s.blockLabel}>Émetteur</Text>
            <Text style={s.blockLine}>{company.legalName || company.name}</Text>
            {model.companyAddress ? <Text style={s.blockLine}>{model.companyAddress}</Text> : null}
            {company.siret ? <Text style={s.blockLine}>SIRET {company.siret}</Text> : null}
            {company.tvaIntra ? <Text style={s.blockLine}>TVA {company.tvaIntra}</Text> : null}
          </View>
          <View style={s.block}>
            <Text style={s.blockLabel}>Client</Text>
            {model.customer.map((line, i) => <Text key={i} style={s.blockLine}>{line}</Text>)}
          </View>
        </View>

        {model.subject ? <Text style={s.subject}>{model.subject}</Text> : null}

        <View style={s.th}>
          <Th style={s.cLabel}>Désignation</Th>
          <Th style={s.cQty}>Qté</Th>
          <Th style={s.cUnit}>PU HT</Th>
          <Th style={s.cVat}>TVA</Th>
          <Th style={s.cHt}>Total HT</Th>
        </View>
        {model.rows.map((r, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <View style={s.cLabel}>
              <Td>{r.label}</Td>
              {r.description ? <Text style={s.desc}>{r.description}</Text> : null}
            </View>
            <Td style={s.cQty}>{r.qty}</Td>
            <Td style={s.cUnit}>{r.unitHt}</Td>
            <Td style={s.cVat}>{r.vat}</Td>
            <Td style={s.cHt}>{r.ht}</Td>
          </View>
        ))}

        <View style={s.totalsRow}>
          <View style={s.totals}>
            <View style={s.totLine}><Text style={s.totLabel}>Total HT</Text><Text style={s.totValue}>{model.totals.ht}</Text></View>
            {model.vatRows.map((v, i) => (
              <View key={i} style={s.totLine}><Text style={s.totLabel}>TVA {v.rate} sur {v.base}</Text><Text style={s.totValue}>{v.amount}</Text></View>
            ))}
            <View style={s.totTtc}><Text style={s.totTtcTxt}>Total TTC</Text><Text style={s.totTtcTxt}>{model.totals.ttc}</Text></View>
            {model.discountLine ? <Text style={s.discount}>{model.discountLine}</Text> : null}
          </View>
        </View>

        <View style={{ marginTop: 14 }}>
          <Text style={[sharedStyles.sectionTitle, { color: accent }]}>Règlement</Text>
          {model.payment.map((p, i) => <Text key={i} style={s.para}>{p}</Text>)}
          {model.legal.map((l, i) => <Text key={i} style={s.legal}>{l}</Text>)}
          {model.rge ? <Text style={s.legal}>{model.rge}</Text> : null}
        </View>

        <View style={sharedStyles.footer} fixed>
          <Text style={sharedStyles.footerText}>{model.footer}</Text>
          <Text style={sharedStyles.pageNum} render={({ pageNumber, totalPages }) => `${model.number} — page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Blob PDF d'une facture émise. Point d'entrée unique du rendu. */
export async function generateInvoicePdfBlob(pdfModel, company) {
  return pdf(<InvoiceDocument model={pdfModel} company={company} />).toBlob();
}
```

- [ ] **Step 2: Vérifier le rendu hors navigateur**

Script jetable dans le scratchpad de session (harnais esbuild + `renderToStream`, cf. mémoire `reference_react_pdf_render_harness`). Créer `<scratchpad>/render-invoice.mjs` :

```js
import { build } from 'C:/Dev/Frontend-Majordhome/node_modules/esbuild/lib/main.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = 'C:/Dev/Frontend-Majordhome';
const out = path.join(process.cwd(), 'invoice-bundle.mjs');
await build({
  stdin: {
    contents: `
      import ReactPDF from '@react-pdf/renderer';
      import { InvoiceDocument } from '@apps/artisan/components/facturation/InvoicePDF.jsx';
      import { buildInvoicePdfModel, invoicingSettings } from '@lib/invoiceDocumentModel.js';
      import { buildCompanyInfo } from '@lib/orgBranding.js';
      const company = buildCompanyInfo({ brand_name: 'Test Énergie', legal_name: 'TEST ENERGIE', legal_form: 'SAS', capital: '6 000', siret: '100 288 224 00015', rcs: '100 288 224 R.C.S. Albi', tva_intra: 'FR 06 449776916', address: '26 rue des Pyrénées', postal_code: '81600', city: 'Gaillac', phone: '05 63 00 00 00', from_email: 'contact@test.fr', rge_certifications: ['QualiBois'] });
      const invoice = { number: 'F-2026-00012', kind: 'invoice', invoice_date: '2026-09-23', due_at: '2026-10-23', subject: 'Entretien de votre poêle à bois : Jollymec · Quadro', customer: { name: 'Anna FERNANDEZ', address: '3 impasse des Lilas', postal_code: '81600', city: 'Gaillac', client_number: 286 }, total_ht: 92.73, total_tva: 9.27, total_ttc: 102, vat_breakdown: [{ rate: 10, base: 92.73, amount: 9.27 }], discount: { percent: 10, amount: 10, degressivitePercent: 10, exceptionalAmount: 0, commercialAmount: 0 } };
      const lines = [{ position: 1, label: 'Entretien poêle', description: 'Jollymec · Quadro · N° 0160067', quantity: 1, unit_price_ht: 81.8182, vat_rate: 10, ht: 81.82, tva: 8.18, ttc: 90 }, { position: 2, label: 'Joint', quantity: 2, unit_price_ht: 5.4545, vat_rate: 10, ht: 10.91, tva: 1.09, ttc: 12 }];
      const model = buildInvoicePdfModel({ invoice, lines, company, invoicing: invoicingSettings({ invoicing: { iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP882' } }) });
      const stream = await ReactPDF.renderToStream(<InvoiceDocument model={model} company={company} />);
      const chunks = []; for await (const c of stream) chunks.push(c);
      process.stdout.write(Buffer.concat(chunks));
    `,
    resolveDir: REPO, loader: 'jsx',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: out, jsx: 'automatic',
  conditions: ['node'], mainFields: ['main', 'module'], nodePaths: [path.join(REPO, 'node_modules')],
  define: { 'import.meta.env': '{"PROD":false,"DEV":true}' },
  alias: { '@lib': path.join(REPO, 'src/lib'), '@apps': path.join(REPO, 'src/apps'), '@': path.join(REPO, 'src') },
  external: ['@react-pdf/renderer', 'react'],
});
console.log('bundle →', out);
```

```bash
cd <scratchpad> && node render-invoice.mjs && node invoice-bundle.mjs > facture-test.pdf && python -c "import fitz; d=fitz.open('facture-test.pdf'); d[0].get_pixmap(matrix=fitz.Matrix(1.7,1.7)).save('facture-test.png'); print(d.page_count, 'page(s)')"
```

Expected : `1 page(s)`, puis **lire** `facture-test.png` (outil Read) et vérifier : titre FACTURE + numéro, blocs Émetteur/Client, 2 lignes, TVA 10 % sur 92,73 €, Total TTC 102,00 €, ligne de remise, bloc Règlement avec IBAN, mentions pénalités/escompte/RGE, pied de page avec SIRET/TVA, **aucun glyphe cassé** (pas de « / » dans les montants). Envoyer le PNG à Eric (`SendUserFile`) comme preuve.

- [ ] **Step 3: Lint + build**

```bash
npm run lint:errors && npx vite build
```

Expected : vert (le composant n'est pas encore importé par l'app : `audit:dead-code` le listera jusqu'à la Task 6).

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/components/facturation/InvoicePDF.jsx
git commit -m "feat(facturation): PDF de facture émise par Majord'home (react-pdf, socle pdfShared, mentions obligatoires)"
```

---

### Task 6: Service, hook d'émission, branchement du dialogue « Facturer »

**Files:**
- Create: `src/shared/services/invoices.service.js`
- Modify: `src/shared/hooks/cacheKeys.js` (ajouter `invoiceKeys`)
- Create: `src/shared/hooks/useInvoices.js`
- Modify: `src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx`

**Interfaces:**
- Consumes: RPC `invoice_create_draft` / `invoice_issue` (Task 1), vues `majordhome_invoices` / `majordhome_invoice_lines`, bucket `invoices` ; `buildInvoiceDraft`, `buildInvoicePdfModel`, `invoicingSettings` (Task 3) ; `generateInvoicePdfBlob` (Task 5) ; `savService.updateFields(interventionId, { invoice_id, invoiced_at })` ; `storageService.uploadFile` ; `unwrapResult`, `withErrorHandling` (`src/lib/serviceHelpers.js`) ; `buildCompanyInfo` ; `downloadBlob`.
- Produces:
  - `invoicesService.createDraft({ invoice, lines }) → { data: uuid, error }`, `issue(invoiceId, numberPrefix) → { data: { id, number, year, invoice_date, due_at, issued_at }, error }`, `getById(orgId, invoiceId) → { data: { invoice, lines }, error }`, `uploadPdf(orgId, invoice, blob) → { data: path, error }`, `attachPdf(orgId, invoiceId, pdfPath) → { data, error }`.
  - `invoiceKeys = { all: (orgId) => ['invoices', orgId], detail: (orgId, id) => [...all, 'detail', id] }`.
  - `useIssueEntretienInvoice(orgId)` : `mutateAsync({ draft, numberPrefix, company, invoicing, renderPdf, interventionId, invoicedAt })` → `{ invoiceId, number, pdfPath, blob }` ; rejette avec un message explicite indiquant ce qui EST fait (facture émise / carte marquée) quand une étape aval échoue.

- [ ] **Step 1: Service**

```js
/**
 * invoices.service.js — factures émises par Majord'home (hub de facturation, phase 1)
 * ============================================================================
 * Lecture via les vues `majordhome_invoices` / `majordhome_invoice_lines`
 * (security_invoker, RLS org) ; écriture UNIQUEMENT via les RPC
 * `invoice_create_draft` (brouillon atomique) et `invoice_issue` (numéro sous
 * verrou, gel) ; `pdf_path` posé après émission (colonne de suivi autorisée par
 * le trigger d'immuabilité). PDF archivé dans le bucket `invoices` sous
 * `${orgId}/${année}/${numéro}.pdf`. Contrat : { data, error }, jamais throw.
 * ============================================================================
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, extractRpcResult } from '@/lib/serviceHelpers';
import { storageService } from './storage.service';

export const INVOICES_BUCKET = 'invoices';

async function createDraft({ invoice, lines }) {
  const { data, error } = await supabase.rpc('invoice_create_draft', { p_invoice: invoice, p_lines: lines });
  if (error) throw error;
  return extractRpcResult(data);
}

async function issue(invoiceId, numberPrefix) {
  const { data, error } = await supabase.rpc('invoice_issue', { p_invoice_id: invoiceId, p_number_prefix: numberPrefix });
  if (error) throw error;
  return extractRpcResult(data);
}

async function getById(orgId, invoiceId) {
  const { data: invoice, error } = await supabase
    .from('majordhome_invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) throw new Error('Facture introuvable');
  const { data: lines, error: linesError } = await supabase
    .from('majordhome_invoice_lines')
    .select('*')
    .eq('invoice_id', invoiceId)
    .eq('org_id', orgId)
    .order('position', { ascending: true });
  if (linesError) throw linesError;
  return { invoice, lines: lines || [] };
}

/** Chemin canonique du PDF archivé. */
export function invoicePdfPath(orgId, invoice) {
  return `${orgId}/${invoice.year}/${invoice.number}.pdf`;
}

async function uploadPdf(orgId, invoice, blob) {
  const path = invoicePdfPath(orgId, invoice);
  const { error } = await storageService.uploadFile(INVOICES_BUCKET, path, blob, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;
  return path;
}

async function attachPdf(orgId, invoiceId, pdfPath) {
  const { data, error } = await supabase
    .from('majordhome_invoices')
    .update({ pdf_path: pdfPath })
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .select('id, pdf_path')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Facture introuvable (pdf_path non posé)');
  return data;
}

export const invoicesService = {
  createDraft: (params) => withErrorHandling(() => createDraft(params), 'invoices.createDraft'),
  issue: (invoiceId, numberPrefix) => withErrorHandling(() => issue(invoiceId, numberPrefix), 'invoices.issue'),
  getById: (orgId, invoiceId) => withErrorHandling(() => getById(orgId, invoiceId), 'invoices.getById'),
  uploadPdf: (orgId, invoice, blob) => withErrorHandling(() => uploadPdf(orgId, invoice, blob), 'invoices.uploadPdf'),
  attachPdf: (orgId, invoiceId, pdfPath) => withErrorHandling(() => attachPdf(orgId, invoiceId, pdfPath), 'invoices.attachPdf'),
};
```

Vérifier la signature réelle de `extractRpcResult` dans `src/lib/serviceHelpers.js` avant d'écrire (`grep -n "export function extractRpcResult" -A 8 src/lib/serviceHelpers.js`) : si elle attend `{ data, error }` plutôt que `data`, l'appeler avec l'objet complet.

- [ ] **Step 2: Cache keys**

Dans `src/shared/hooks/cacheKeys.js`, après `pennylaneKeys` :

```js
// Factures émises par Majord'home (hub de facturation, phase 1)
export const invoiceKeys = {
  all: (orgId) => ['invoices', orgId],
  detail: (orgId, invoiceId) => [...invoiceKeys.all(orgId), 'detail', invoiceId],
};
```

- [ ] **Step 3: Hook — la chaîne d'émission**

```js
// src/shared/hooks/useInvoices.js
// ============================================================================
// Hub de facturation — chaîne d'émission d'une facture d'entretien, POINT
// D'ENTRÉE UNIQUE (spec 2026-09-22, flux étapes 1-2) :
//   brouillon (RPC) → émission = numéro (RPC) → carte marquée facturée →
//   PDF (react-pdf, fourni par l'appelant) → Storage → pdf_path.
// L'ordre compte : dès que le numéro est attribué la facture existe légalement,
// donc la carte est marquée AVANT le PDF ; un échec aval remonte un message qui
// dit ce qui EST fait (jamais « rien ne s'est passé » quand un numéro a été
// consommé). Contrat mutation : unwrapResult → mutateAsync rejette sur { error }.
// ============================================================================
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoicesService } from '@services/invoices.service';
import { savService } from '@services/sav.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { buildInvoicePdfModel } from '@/lib/invoiceDocumentModel';
import { invoiceKeys, entretienSavKeys } from './cacheKeys';

export { invoiceKeys };

/**
 * @param {string} orgId  org CORE
 */
export function useIssueEntretienInvoice(orgId) {
  const queryClient = useQueryClient();
  return useMutation({
    /**
     * @param {object} p
     * @param {{ invoice: object, lines: object[] }} p.draft  `buildInvoiceDraft(...)`
     * @param {string} p.numberPrefix
     * @param {object} p.company  `buildCompanyInfo(settings)`
     * @param {object} p.invoicing  `invoicingSettings(settings)`
     * @param {(pdfModel: object, company: object) => Promise<Blob>} p.renderPdf
     * @param {string} p.interventionId
     * @param {string|null} p.invoicedAt
     */
    mutationFn: async ({ draft, numberPrefix, company, invoicing, renderPdf, interventionId, invoicedAt }) => {
      const invoiceId = await unwrapResult(invoicesService.createDraft(draft));
      const issued = await unwrapResult(invoicesService.issue(invoiceId, numberPrefix));
      const number = issued.number;

      const { error: cardError } = await savService.updateFields(interventionId, {
        invoice_id: invoiceId,
        invoiced_at: invoicedAt || new Date().toISOString(),
      });
      if (cardError) {
        throw new Error(`Facture ${number} émise, mais la carte n’a pas pu être marquée facturée : ${cardError.message || cardError}`);
      }

      let pdfPath = null;
      let blob = null;
      try {
        const { invoice, lines } = await unwrapResult(invoicesService.getById(orgId, invoiceId));
        const pdfModel = buildInvoicePdfModel({ invoice, lines, company, invoicing });
        blob = await renderPdf(pdfModel, company);
        pdfPath = await unwrapResult(invoicesService.uploadPdf(orgId, invoice, blob));
        await unwrapResult(invoicesService.attachPdf(orgId, invoiceId, pdfPath));
      } catch (err) {
        throw new Error(`Facture ${number} émise et carte marquée, mais le PDF n’a pas pu être archivé : ${err?.message || err}`);
      }
      return { invoiceId, number, pdfPath, blob };
    },
    onSettled: () => {
      // Même en échec partiel, la carte et la facture ont pu changer : on rafraîchit.
      queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all(orgId) });
    },
  });
}
```

- [ ] **Step 4: Dialogue « Facturer » — branche hub**

Dans `FacturerEntretienDialog.jsx` :

Imports à ajouter :

```js
import { useIssueEntretienInvoice } from '@hooks/useInvoices';
import { buildInvoiceDraft, invoicingSettings } from '@/lib/invoiceDocumentModel';
import { buildCompanyInfo } from '@/lib/orgBranding';
import { generateInvoicePdfBlob } from '@/apps/artisan/components/facturation/InvoicePDF';
import { downloadBlob } from '@/lib/utils';
```

Après `const createInvoice = useCreateEntretienInvoice(orgId);` :

```js
  const issueInvoice = useIssueEntretienInvoice(orgId);
```

Après `const isDraft = invoiceSettings.mode === 'draft';` :

```js
  const isHub = invoiceSettings.mode === 'hub';
  const invoicing = invoicingSettings(settings);
```

Remplacer `const blocked = …` par :

```js
  const missingAddress = isHub && !(item.client_address && item.client_city);
  const blocked = !model || model.errors.length > 0 || model.lines.length === 0 || !item.client_id || missingAddress;
```

Remplacer `handleConfirm` par :

```js
  const handleConfirm = async () => {
    if (blocked || createInvoice.isPending || issueInvoice.isPending) return;
    if (isHub) {
      try {
        const draft = buildInvoiceDraft({
          model,
          orgId,
          context: 'contrat',
          client: {
            id: item.client_id,
            display_name: item.client_name,
            first_name: item.client_first_name,
            last_name: item.client_last_name,
            address: item.client_address,
            postal_code: item.client_postal_code,
            city: item.client_city,
            email: item.client_email,
            phone: item.client_phone,
            client_number: item.client_number ?? null,
          },
          contractId: contract?.id || null,
          interventionId: item.id,
          dueDays: invoiceSettings.deadlineDays,
        });
        const issued = await issueInvoice.mutateAsync({
          draft,
          numberPrefix: invoicing.numberPrefix,
          company: buildCompanyInfo(settings),
          invoicing,
          renderPdf: generateInvoicePdfBlob,
          interventionId: item.id,
          invoicedAt: item.invoiced_at || null,
        });
        if (issued.blob) downloadBlob(issued.blob, `${issued.number}.pdf`);
        toast.success(`Facture ${issued.number} émise et archivée`, {
          action: issued.blob ? { label: 'Télécharger', onClick: () => downloadBlob(issued.blob, `${issued.number}.pdf`) } : undefined,
        });
        onOpenChange(false);
        onCreated?.();
      } catch (err) {
        toast.error(err?.message || 'La facture n’a pas pu être émise', { duration: 15000 });
      }
      return;
    }
    try {
      const created = await createInvoice.mutateAsync({
        // … bloc existant inchangé …
```

(le reste du `try/catch` Pennylane existant reste tel quel).

Adapter le `<ConfirmDialog>` :

```jsx
      title={isHub ? 'Émettre la facture' : isDraft ? 'Créer le brouillon de facture' : 'Créer la facture'}
      description={
        isHub
          ? `${clientLabel}${contractNumber ? ` · ${contractNumber}` : ''} — Majord'home attribue le numéro (${invoicing.numberPrefix}-${new Date().getFullYear()}-…), génère le PDF et l'archive. Rien n'est envoyé à Pennylane (phase 2).`
          : `${clientLabel}${contractNumber ? ` · ${contractNumber}` : ''} — la facture sera créée sur Pennylane${isDraft ? ' en brouillon, à finaliser et envoyer depuis Pennylane' : ' et numérotée immédiatement'}.`
      }
      confirmLabel={isHub ? 'Émettre la facture' : isDraft ? 'Créer le brouillon' : 'Créer la facture'}
      loading={createInvoice.isPending || issueInvoice.isPending}
```

Ajouter, après le message `!item.client_id` :

```jsx
        {!isLoading && missingAddress && (
          <p className="flex items-start gap-2 text-red-700"><XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />Adresse du client incomplète : une facture doit porter l’adresse de facturation (fiche client).</p>
        )}
```

Dans le bloc `<div className="text-xs text-gray-600 space-y-0.5">`, remplacer la ligne « Journal » par :

```jsx
              {!isHub && invoiceSettings.journalId && (
                <div><span className="text-gray-500">Journal :</span> {invoiceSettings.journalCode || `#${invoiceSettings.journalId}`} (Pennylane refuse le déplacement, la facture tombe dans le journal de ventes principal)</div>
              )}
```

Et le pied « Mode et échéance : Paramètres → Facturation Pennylane. » devient « Mode, échéance et mentions : Paramètres → Facturation. »

`item.client_number` n'existe pas dans la vue `majordhome_entretien_sav` : le `?? null` suffit (photo client sans numéro) — ne pas étendre la vue pour ça.

- [ ] **Step 5: Carte — bouton visible en mode hub**

Dans `EntretienSAVCard.jsx`, repérer la ligne 77 :

```js
  const canPushInvoice = pennylaneEnabled && type === 'entretien';
```

et la remplacer par (ajouter l'import `import { useOrgSettings, pennylaneInvoiceSettings } from '@hooks/useOrgSettings';` si `pennylaneEnabled` vient d'un autre hook, garder ce hook et ajouter seulement `useOrgSettings`) :

```js
  const { settings } = useOrgSettings();
  const isHubMode = pennylaneInvoiceSettings(settings).mode === 'hub';
  // Mode hub : Majord'home émet lui-même, l'intégration Pennylane n'est pas requise.
  const canPushInvoice = (pennylaneEnabled || isHubMode) && type === 'entretien';
```

Puis les libellés du bouton (lignes ~267-275) :

```jsx
                    title={item.invoice_id ? (isHubMode ? 'Facture émise' : 'Facture créée sur Pennylane') : (isHubMode ? 'Émettre la facture' : 'Créer la facture sur Pennylane')}
```

- [ ] **Step 6: Vérifier**

```bash
npm run audit:quality && npx vite build
```

Expected : lint sans erreur, 6 fichiers de tests verts, **aucun fichier mort** (`InvoicePDF.jsx`, `invoiceDocumentModel.js`, `invoices.service.js`, `useInvoices.js`, `EmissionTab.jsx` sont tous consommés), build vert.

Test manuel par Eric sur l'org vierge H&E (ou Mayer avec mode `hub` ponctuellement) :
1. Paramètres → Facturation → Émission : préfixe, IBAN, mentions ; onglet Pennylane : mode « Émise par Majord'home ».
2. Carte entretien Réalisé → « Facturer » → « Émettre la facture » : le PDF se télécharge, toast « Facture F-2026-00001 émise et archivée », carte « Facturée ».
3. Vérifier en base (SQL Editor ou MCP) :

```sql
SELECT number, status, invoice_date, due_at, total_ht, total_tva, total_ttc, pdf_path, customer->>'name' AS client
  FROM majordhome.invoices ORDER BY created_at DESC LIMIT 3;
SELECT position, label, quantity, unit_price_ht, vat_rate, ht, tva, ttc, ledger_account_number, metier_key
  FROM majordhome.invoice_lines WHERE invoice_id = (SELECT id FROM majordhome.invoices ORDER BY created_at DESC LIMIT 1) ORDER BY position;
```

Expected : numéro `PREFIX-2026-00001`, `status = issued`, `pdf_path = <org>/2026/<numéro>.pdf`, lignes cohérentes (ht + tva = ttc), et le fichier présent dans Storage → `invoices`.
4. Deuxième émission → `00002`. Tenter un UPDATE de `total_ttc` dans le SQL Editor → `invoice_immutable`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/services/invoices.service.js src/shared/hooks/cacheKeys.js src/shared/hooks/useInvoices.js src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx src/apps/artisan/components/entretiens/EntretienSAVCard.jsx
git commit -m "feat(facturation): émission locale depuis la carte entretien — brouillon, numéro, PDF archivé, carte marquée (hub phase 1)"
```

---

### Task 7: Documentation et proposition CLAUDE.md

**Files:**
- Modify: `.claude/proposed-updates.md`
- Modify: `docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md` (§ Phases : phase 1 → « ✅ livrée (date) »)

- [ ] **Step 1: Entrée PENDING**

Ajouter à la fin de `.claude/proposed-updates.md` :

```markdown
## [AAAA-MM-JJ HH:mm] Hub de facturation — phase 1 (émission locale)
**Statut** : PENDING
**Commit** : <hash du commit de la Task 6>
**Contexte** : Majord'home émet ses factures d'entretien (mode « Émise par Majord'home » dans Settings → Facturation) : numéro légal par la base, lignes/totaux figés, PDF archivé dans le bucket `invoices`. Pennylane n'est pas appelé (import en phase 2, journal de ventes principal — le journal dédié est reporté, l'API ne permet pas de déplacer l'écriture d'une facture).
**Proposition** (nouvelle section « Module Facturation (hub) → spec 2026-09-22 ») :
- **Numéro de facture = RPC `invoice_issue` sous verrou** (`majordhome.invoice_sequences` par org × année, `${prefix}-${YYYY}-${NNNNN}`) : jamais calculé côté front, jamais `MAX()+1`. Préfixe = `settings.invoicing.number_prefix` (Settings → Facturation → Émission) ; distinct de la série Pennylane (« F ») tant que PL numérote aussi.
- **Une facture `issued` est figée par trigger** (`invoices_guard_immutable` + lignes) : seules `pdf_path`, `pennylane_*`, `import_*` bougent ; correction = avoir (phase 3). `customer` = photo du client à l'émission.
- **Chaîne d'émission = `useIssueEntretienInvoice` (point d'entrée unique)** : brouillon → numéro → carte marquée → PDF → Storage `invoices/${org}/${année}/${numéro}.pdf`. La carte est marquée AVANT le PDF (le numéro consommé fait exister la facture) ; tout échec aval dit ce qui EST fait.
- **Modèle PUR `src/lib/invoiceDocumentModel.js`** (`node --test scripts/invoice-document-model.test.mjs`, dans `audit:quality`) : montants au centime (`ht + tva = ttc` par ligne, totaux = sommes, ventilation par taux), modèle PDF préformaté (PDF-safe). `InvoicePDF.jsx` ne calcule ni ne formate rien.
- Réglages `settings.invoicing = { number_prefix, iban, bic, payment_terms, late_penalty, discount_note }` lus par `invoicingSettings()` (défauts neutres), objet sauvé COMPLET.
---
```

- [ ] **Step 2: Spec — phase 1 livrée**

Dans la spec, remplacer la ligne `1. Numérotation + tables + RPC d'émission + PDF + archivage (sans Pennylane).` par `1. ✅ **Livrée le AAAA-MM-JJ** — numérotation + tables + RPC d'émission + PDF + archivage (sans Pennylane). Plan : docs/superpowers/plans/2026-09-22-hub-facturation-phase1-emission-locale.md`.

- [ ] **Step 3: Commit**

```bash
git add .claude/proposed-updates.md docs/superpowers/specs/2026-09-22-majordhome-hub-facturation-import-pennylane-design.md
git commit -m "docs(facturation): phase 1 du hub livrée, proposition CLAUDE.md en attente"
```

---

## Hors périmètre, à signaler (ne pas embarquer)

- **Bug prod Settings → Facturation Pennylane, sélecteur « Pièces de rechange »** : `<option key={a.id} value={String(a.id)}>` alors que `accountOptions` porte `{ number, label }` → la valeur stockée est la chaîne `"undefined"` (vérifié en prod : `settings.pennylane.invoice.ledger_accounts.parts = "undefined"`). Correction : `value={a.number}` comme les catégories. À faire dans un commit dédié (spawn_task).
- **Vue `majordhome_entretien_sav` sans `client_number`** : la photo client des factures n'a pas le numéro client tant que la vue ne l'expose pas (ajout EN FIN de liste si un jour nécessaire).
- Phase 2 (import Pennylane + rejeu), phase 3 (avoir), phase 4 (e-invoicing, envoi, rapprochement) : plans séparés.

## Self-review (fait à la rédaction)

- **Couverture spec phase 1** : numérotation légale (Task 1 RPC + Task 4 préfixe) ✓ ; immuabilité (Task 1 triggers) ✓ ; mentions obligatoires (Task 3 modèle + Task 4 réglages + Task 5 PDF) ✓ ; montants au centime (Task 3 `splitTtc` + CHECK DB) ✓ ; archivage bucket `${orgId}/${année}/${numéro}.pdf` (Task 1 bucket + Task 6 `invoicePdfPath`) ✓ ; modèle de données (`invoices`, `invoice_lines` avec axes analytiques, `invoice_sequences`, RPC `invoice_issue`, trigger) ✓ ; flux étapes 1-2 (préparer → émettre) ✓. `invoice_cancel_with_credit_note` = phase 3, hors plan. Colonnes `pennylane_*` / `import_*` posées, inertes jusqu'à la phase 2.
- **Cohérence des noms** : `invoice_create_draft(p_invoice, p_lines)` / `invoice_issue(p_invoice_id, p_number_prefix)` identiques en SQL (Task 1), assertions (Task 1), service (Task 6). Champs de ligne `ledgerAccountNumber/equipmentId/equipmentTypeId/categoryId` (Task 2) → `ledger_account_number/equipment_id/metier_key/category_id` (Task 3 → Task 1). `invoicingSettings().numberPrefix` (Task 3) consommé Task 4 et Task 6. `generateInvoicePdfBlob(pdfModel, company)` (Task 5) = `renderPdf` du hook (Task 6).
- **Placeholders** : aucun « TODO / à compléter » ; chaque étape de code montre le code.
