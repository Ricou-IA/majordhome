-- 20260928_3 — Un contrat qui devient actif rattache les cartes entretien restées sans contrat.
--
-- Cas DUBREUIL (CTR-00036, rattrapage 20260928_2) : une carte entretien créée pendant que le
-- contrat était résilié naît SANS contract_id (resolveCardForAppointment / ensureEntretienCard :
-- « carte dégradée »). La réactivation ne la rattachait pas ; or markRealise, la clôture par
-- les enfants et sync_intervention_from_visit travaillent tous par contract_id → entretien
-- réalisé, visite jamais enregistrée, contrat toujours « dû ».
--
-- 1. contract_activation_promote_cards rattache d'abord les cartes entretien racines NON
--    terminales du client sans contrat (un client = un contrat, contracts_client_id_key),
--    puis promeut « demande_contrat » → « a_planifier »
--    comme avant (une carte « demande_contrat » sans contrat est donc désormais promue aussi).
-- 2. Le trigger UPDATE ne dépend plus de « UPDATE OF status » : une réactivation par
--    effacement de end_date passe par auto_expire_contract_on_end_date (BEFORE) qui pose
--    status='active' sans que status figure dans le SET — un trigger « OF status » ne se
--    déclenche alors pas. Condition portée par le WHEN.
-- 3. Même traitement pour un contrat INSÉRÉ directement actif (carte posée avant le contrat).

CREATE OR REPLACE FUNCTION majordhome.contract_activation_promote_cards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  -- 1 contrat par client (contracts_client_id_key) : pas d'ambiguïté possible.
  IF NEW.client_id IS NOT NULL THEN
    UPDATE majordhome.interventions
       SET contract_id = NEW.id,
           updated_at  = now()
     WHERE client_id = NEW.client_id
       AND contract_id IS NULL
       AND parent_id IS NULL
       AND intervention_type = 'entretien'
       AND workflow_status NOT IN ('realise', 'facture');
  END IF;

  UPDATE majordhome.interventions
  SET workflow_status = 'a_planifier',
      updated_at = now()
  WHERE contract_id = NEW.id
    AND parent_id IS NULL
    AND intervention_type = 'entretien'
    AND workflow_status = 'demande_contrat';
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION majordhome.contract_activation_promote_cards() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contract_activation_promote_cards ON majordhome.contracts;
CREATE TRIGGER trg_contract_activation_promote_cards
  AFTER UPDATE ON majordhome.contracts
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active'::majordhome.contract_status)
  EXECUTE FUNCTION majordhome.contract_activation_promote_cards();

DROP TRIGGER IF EXISTS trg_contract_insert_active_attach_cards ON majordhome.contracts;
CREATE TRIGGER trg_contract_insert_active_attach_cards
  AFTER INSERT ON majordhome.contracts
  FOR EACH ROW
  WHEN (NEW.status = 'active'::majordhome.contract_status)
  EXECUTE FUNCTION majordhome.contract_activation_promote_cards();
