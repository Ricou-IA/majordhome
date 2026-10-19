-- 20261019_2 — Une carte entretien SANS contrat qui perd son dernier RDV est retirée,
-- pas renvoyée en « À planifier ».
--
-- Cas FREITAS (2026-10-04) : un RDV « Autre » retypé « Entretien » a fabriqué une carte
-- entretien sans contrat (ensureEntretienCard, « carte dégradée ») ; la suppression du RDV
-- l'a fait refluer en « À planifier » (recomputeEntretienWorkflow) → un attendu sans
-- contrat dans le kanban. Règle Eric : pas d'entretien sans contrat (le suivi N+1 passe
-- toujours par un contrat), et un changement de type / une suppression de RDV ne crée
-- jamais d'attendu.
--
-- La policy DELETE d'interventions est réservée à l'org_admin : le retrait passe par cette
-- RPC, ouverte à tout membre de l'org (dérogation validée par Eric le 2026-10-04) mais
-- bornée à une carte VIDE :
--   entretien racine, sans contrat, ni Réalisé / Facturé / Demande de contrat,
--   aucun RDV actif, aucune facture, aucun SMS, aucune demande de service,
--   aucun certificat (carte ou enfants), enfants tous « planifie » (vierges).
-- Sinon : rien n'est supprimé, la raison est renvoyée et l'appelant garde l'ancien
-- comportement (retour en « À planifier »).

CREATE OR REPLACE FUNCTION public.entretien_card_release_orphan(p_intervention_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
DECLARE
  v_card record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.intervention_type, i.parent_id, i.contract_id, i.workflow_status, c.org_id
    INTO v_card
    FROM majordhome.interventions i
    JOIN majordhome.clients c ON c.id = i.client_id
   WHERE i.id = p_intervention_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_found');
  END IF;

  -- Autorisation positive : l'appelant est membre de l'org du client.
  IF (EXISTS (SELECT 1 FROM core.organization_members om
               WHERE om.user_id = auth.uid() AND om.org_id = v_card.org_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  IF v_card.intervention_type IS DISTINCT FROM 'entretien'
     OR v_card.parent_id IS NOT NULL
     OR v_card.contract_id IS NOT NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_orphan');
  END IF;

  IF v_card.workflow_status IN ('realise', 'facture', 'demande_contrat') THEN
    RETURN jsonb_build_object('released', false, 'reason', 'status_' || v_card.workflow_status);
  END IF;

  IF EXISTS (SELECT 1 FROM majordhome.appointments a
              WHERE a.intervention_id = v_card.id
                AND a.status NOT IN ('cancelled', 'no_show')) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'active_appointment');
  END IF;

  IF EXISTS (SELECT 1 FROM majordhome.invoices iv WHERE iv.intervention_id = v_card.id)
     OR EXISTS (SELECT 1 FROM majordhome.sms_logs s WHERE s.intervention_id = v_card.id)
     OR EXISTS (SELECT 1 FROM majordhome.service_requests sr WHERE sr.intervention_id = v_card.id) THEN
    RETURN jsonb_build_object('released', false, 'reason', 'linked_records');
  END IF;

  IF EXISTS (SELECT 1 FROM majordhome.certificats ce
               JOIN majordhome.interventions x ON x.id = ce.intervention_id
              WHERE x.id = v_card.id OR x.parent_id = v_card.id)
     OR EXISTS (SELECT 1 FROM majordhome.interventions ch
                 WHERE ch.parent_id = v_card.id
                   AND ch.workflow_status IS DISTINCT FROM 'planifie') THEN
    RETURN jsonb_build_object('released', false, 'reason', 'has_content');
  END IF;

  -- Enfants vierges : cascade FK parent_id. RDV annulés : FK SET NULL.
  DELETE FROM majordhome.interventions WHERE id = v_card.id;

  RETURN jsonb_build_object('released', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.entretien_card_release_orphan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entretien_card_release_orphan(uuid) TO authenticated;
