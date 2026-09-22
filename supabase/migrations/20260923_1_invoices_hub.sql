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
  -- v_status NULL = ligne fille d'un DELETE CASCADE sur invoices (le parent est déjà retiré au
  -- moment où ce trigger BEFORE DELETE s'exécute) : la policy invoices_delete_draft n'autorise
  -- ce DELETE parent que sur un brouillon, donc NULL ici = brouillon en cours de suppression,
  -- jamais une facture émise. Ne bloquer que sur un statut positivement non-brouillon.
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
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
