-- ============================================================================
-- process_web_entretien : suppression des signatures sans p_org_id
-- ============================================================================
--
-- Ces surcharges portaient l'org Mayer en dur. Elles n'ont ete conservees que
-- le temps du redeploiement du site vitrine (commit 7594d33 cote site), pour
-- que le formulaire ne casse pas dans l'intervalle — et cette precaution a
-- servi : la premiere verification post-deploiement montrait encore l'ancien
-- chemin emprunte, le temps que Vercel propage.
--
-- Bascule verifiee en production avant suppression, par 3 soumissions reelles :
--   - nouvelle fonction empruntee (cle `contract_locked` dans les metadonnees)
--   - org resolue correctement depuis le parametre
--   - code postal 12000 facture en Zone 2 (30 EUR) et non Hors Zone (60 EUR)
--   - contrat signe a 999 EUR NON ecrase par une soumission a 5000 EUR ;
--     la demande remonte en intervention taguee « Contrat existant »
--   - donnees de test purgees ensuite
--
-- ⚠ POURQUOI SUPPRIMER PLUTOT QUE LAISSER : PostgREST resout les surcharges par
-- les parametres nommes recus. Un appel omettant p_org_id — variable
-- d'environnement absente, regression, nouveau site mal configure — serait
-- retombe SILENCIEUSEMENT sur la version Mayer-en-dur, et aurait cree les
-- contrats d'un autre client chez Mayer. Une erreur franche vaut mieux qu'un
-- repli invisible.
-- ============================================================================

DROP FUNCTION IF EXISTS public.process_web_entretien(
  text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text);

DROP FUNCTION IF EXISTS majordhome.process_web_entretien(
  text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text);
