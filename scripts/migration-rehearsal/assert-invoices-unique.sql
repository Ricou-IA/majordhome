-- assert-invoices-unique.sql — vérifie 20260923_2_invoices_unique_issued_per_intervention.sql
-- (finding F1 de la revue finale : deux factures ÉMISES sur la même intervention).
-- Couvre : structure (index unique partiel), puis parcours fonctionnel en rôle
-- authenticated : 1ʳᵉ émission sur une intervention → OK, 2ᵉ brouillon sur la MÊME
-- intervention → émission refusée SQLSTATE 23505 (`intervention_already_invoiced`).

-- ── A. Structure ───────────────────────────────────────────────────────────
DO $$
DECLARE def text;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
   WHERE schemaname = 'majordhome' AND tablename = 'invoices' AND indexname = 'invoices_one_issued_per_intervention';
  IF def IS NULL THEN RAISE EXCEPTION 'index invoices_one_issued_per_intervention absent'; END IF;
  IF def NOT LIKE '%UNIQUE%' THEN RAISE EXCEPTION 'index % pas UNIQUE', def; END IF;
  IF def NOT LIKE '%(intervention_id)%' THEN RAISE EXCEPTION 'index % ne porte pas (intervention_id)', def; END IF;
  IF def NOT LIKE '%WHERE%status = ''issued''%' THEN RAISE EXCEPTION 'index % sans prédicat status=issued', def; END IF;
  IF def NOT LIKE '%intervention_id IS NOT NULL%' THEN RAISE EXCEPTION 'index % sans prédicat intervention_id IS NOT NULL', def; END IF;

  RAISE NOTICE 'assert-invoices-unique A (structure) : OK';
END $$;

-- ── B. Parcours fonctionnel (rollback à la fin) ────────────────────────────
BEGIN;
DO $$
DECLARE
  v_mayer uuid := '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
  v_membre uuid; v_role text;
  v_client_id uuid; v_project_id uuid;
  v_intervention_id uuid;
  v_id uuid; v_id2 uuid;
  v_res jsonb;
  ok boolean;
BEGIN
  -- Fixture : un org_admin/team_leader Mayer avec profil (même fixture qu'assert-invoices.sql).
  SELECT om.user_id, om.role INTO v_membre, v_role FROM core.organization_members om
    JOIN core.profiles p ON p.id = om.user_id
   WHERE om.org_id = v_mayer AND om.user_id IS NOT NULL AND om.role IN ('org_admin', 'team_leader') LIMIT 1;
  IF v_membre IS NULL THEN RAISE EXCEPTION 'fixture : aucun org_admin/team_leader Mayer avec profil'; END IF;

  -- Fixture : une intervention réelle. Le sous-ensemble de répétition ne charge PAS les
  -- données de majordhome.interventions (DDL seul, data: false) — on en insère une, adossée
  -- à un client Mayer existant (majordhome.clients EST chargée avec ses données).
  SELECT c.id, c.project_id INTO v_client_id, v_project_id
    FROM majordhome.clients c WHERE c.org_id = v_mayer LIMIT 1;
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'fixture : aucun client Mayer'; END IF;
  INSERT INTO majordhome.interventions (project_id, client_id)
  VALUES (v_project_id, v_client_id)
  RETURNING id INTO v_intervention_id;

  PERFORM set_config('request.jwt.claim.sub', v_membre::text, false);
  SET LOCAL ROLE authenticated;

  -- (1) 1ʳᵉ facture sur cette intervention : brouillon + émission → OK
  v_id := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'intervention_id', v_intervention_id, 'total_ht', 10, 'total_tva', 2, 'total_ttc', 12),
    jsonb_build_array(jsonb_build_object('label', 'Entretien', 'ht', 10, 'tva', 2, 'ttc', 12)));
  v_res := public.invoice_issue(v_id, 'F');
  IF v_res->>'number' IS NULL THEN RAISE EXCEPTION '(1) 1ʳᵉ facture non émise'; END IF;

  -- (2) 2ᵉ brouillon sur la MÊME intervention, émission refusée (23505)
  v_id2 := public.invoice_create_draft(
    jsonb_build_object('org_id', v_mayer, 'intervention_id', v_intervention_id, 'total_ht', 5, 'total_tva', 1, 'total_ttc', 6),
    jsonb_build_array(jsonb_build_object('label', 'Doublon', 'ht', 5, 'tva', 1, 'ttc', 6)));
  ok := false;
  BEGIN
    PERFORM public.invoice_issue(v_id2, 'F');
  EXCEPTION WHEN SQLSTATE '23505' THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION '(2) 2ᵉ facture émise sur la même intervention acceptée'; END IF;

  -- (3) Le brouillon refusé reste un brouillon, supprimable (pas de facture fantôme laissée)
  DELETE FROM majordhome.invoices WHERE id = v_id2 AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION '(3) brouillon refusé introuvable ou déjà émis'; END IF;

  RESET ROLE;
  RAISE NOTICE 'assert-invoices-unique B (fonctionnel) : OK';
END $$;
ROLLBACK;
