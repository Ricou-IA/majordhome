-- ============================================================================
-- 20260922_2 — Les certificats enfants suivent les équipements du contrat
-- ============================================================================
-- Constat (GOMES CTR-00821, 2026-09-22) : la carte entretien avait 4 équipements
-- à l'ouverture de la modale → 4 enfants « certificat par équipement » créés
-- (CertificatsSection, lazy create). Deux équipements supprimés de la fiche
-- client ensuite : `interventions.equipment_id` est passé à NULL (FK SET NULL,
-- 20260917_2) mais les deux enfants sont restés « Planifié ». Conséquences :
--   • la section Certificats compte 2/4 et n'affiche que 2 lignes (les lignes
--     sont dessinées depuis les équipements, les enfants orphelins sont invisibles) ;
--   • la clôture du parent (completeParentEntretien / self-heal) exige que TOUS
--     les enfants soient réalisés → la carte ne peut plus passer en Réalisé.
-- Même chose pour « Retirer du contrat » (DELETE contract_equipments) : l'enfant
-- garde son equipment_id mais l'équipement n'est plus dans le contrat.
-- 7 enfants orphelins en prod au 2026-09-22 (5 sous des cartes déjà Réalisé /
-- Facturé, 2 sous GOMES qui bloquent).
--
-- Règle : quand un équipement quitte un contrat (retrait du contrat OU
-- suppression de l'équipement), son certificat enfant est supprimé S'IL EST
-- VIERGE (workflow 'planifie', aucun certificat, même brouillon). Un enfant
-- réalisé / néant ou porteur d'un certificat est conservé : c'est une archive,
-- et le front l'affiche désormais « Équipement retiré du contrat ».
--
-- Côté DB, par trigger, pour la même raison que 20260918_1 : la policy DELETE
-- d'`interventions` exige clients.delete (org_admin seul) — un DELETE front
-- serait un no-op silencieux pour un team_leader. SECURITY DEFINER, owner
-- postgres, fail-safe (WARNING, jamais de blocage de la suppression métier).
--
-- Deux déclencheurs :
--   • BEFORE DELETE ON equipments — avant que la FK ne passe equipment_id à NULL
--     (l'enfant serait alors introuvable par équipement) ;
--   • AFTER DELETE ON contract_equipments — « Retirer du contrat » ; en cascade
--     d'une suppression d'équipement il ne trouve plus rien (déjà purgé), sans effet.
--
-- Critère de succès : DELETE contract_equipments (eq1) ⇒ enfant vierge d'eq1
-- supprimé ; DELETE equipments (eq2) ⇒ enfant vierge d'eq2 supprimé, la
-- suppression de l'équipement passe ; enfant avec certificat ⇒ conservé avec
-- equipment_id NULL ; enfant néant ⇒ conservé. Rattrapage des 7 orphelins.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Purge d'un enfant vierge pour un équipement (contrat précis ou tous)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.purge_blank_certificat_children(p_equipment_id uuid, p_contract_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_equipment_id IS NULL THEN RETURN 0; END IF;

  DELETE FROM majordhome.interventions c
   USING majordhome.interventions p
   WHERE c.parent_id = p.id
     AND c.equipment_id = p_equipment_id
     AND c.intervention_type = 'entretien'
     AND c.workflow_status = 'planifie'
     AND NOT EXISTS (SELECT 1 FROM majordhome.certificats ce WHERE ce.intervention_id = c.id)
     AND (p_contract_id IS NULL
          OR p.contract_id = p_contract_id
          -- Carte sans photo contract_id (contrat dérivé par la vue) : même client.
          OR (p.contract_id IS NULL
              AND p.client_id = (SELECT ct.client_id FROM majordhome.contracts ct WHERE ct.id = p_contract_id)));

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION majordhome.purge_blank_certificat_children(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Fonction trigger commune (equipments / contract_equipments)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.equipment_unlinked_purge_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $function$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'equipments' THEN
      PERFORM majordhome.purge_blank_certificat_children(OLD.id, NULL);
    ELSE
      PERFORM majordhome.purge_blank_certificat_children(OLD.equipment_id, OLD.contract_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'equipment_unlinked_purge_children (%): purge impossible (%)', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION majordhome.equipment_unlinked_purge_children() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_equipment_purge_certificat_children ON majordhome.equipments;
CREATE TRIGGER trg_equipment_purge_certificat_children
  BEFORE DELETE ON majordhome.equipments
  FOR EACH ROW
  EXECUTE FUNCTION majordhome.equipment_unlinked_purge_children();

DROP TRIGGER IF EXISTS trg_contract_equipment_purge_certificat_children ON majordhome.contract_equipments;
CREATE TRIGGER trg_contract_equipment_purge_certificat_children
  AFTER DELETE ON majordhome.contract_equipments
  FOR EACH ROW
  EXECUTE FUNCTION majordhome.equipment_unlinked_purge_children();

-- ----------------------------------------------------------------------------
-- 3. Rattrapage (idempotent) : enfants entretien vierges dont l'équipement a
--    disparu (NULL) ou n'est plus dans les équipements du contrat parent.
--    Garde : le contrat doit avoir des lignes contract_equipments (les contrats
--    legacy sans lignes reposent sur les équipements du client — pas de base
--    fiable pour juger, on n'y touche pas).
-- ----------------------------------------------------------------------------
DELETE FROM majordhome.interventions c
 USING majordhome.interventions p
 WHERE c.parent_id = p.id
   AND c.intervention_type = 'entretien'
   AND c.workflow_status = 'planifie'
   AND NOT EXISTS (SELECT 1 FROM majordhome.certificats ce WHERE ce.intervention_id = c.id)
   AND (c.equipment_id IS NULL
        OR (p.contract_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM majordhome.contract_equipments x WHERE x.contract_id = p.contract_id)
            AND NOT EXISTS (SELECT 1 FROM majordhome.contract_equipments x
                             WHERE x.contract_id = p.contract_id AND x.equipment_id = c.equipment_id)));
