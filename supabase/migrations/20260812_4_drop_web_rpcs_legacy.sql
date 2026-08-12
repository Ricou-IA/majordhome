-- ============================================================================
-- Suppression des signatures sans p_org_id (create_website_lead, create_aide_lead,
-- inscrire_prospect_pellets)
-- ============================================================================
--
-- Elles portaient l'org Mayer en dur et n'etaient conservees que le temps du
-- redeploiement du site vitrine (commit 7424b4d cote site).
--
-- ⚠ DECOUVERTE EN VOULANT LES NEUTRALISER : elles etaient ouvertes a `anon` et
-- `authenticated`. Toute personne disposant de la cle publique — presente dans
-- le bundle navigateur — pouvait creer des leads et des clients pellets.
--
-- Et la tentative de neutralisation par `REVOKE EXECUTE ... FROM service_role`
-- n'a RIEN retire : EXECUTE etait accorde a PUBLIC, dont tous les roles
-- heritent. C'est precisement le piege documente dans la charte multi-tenant —
-- constate ici en verifiant l'effet par has_function_privilege plutot qu'en
-- relisant la commande. Le REVOKE avait pourtant reussi sans rien signaler.
--
-- La suppression regle les deux problemes d'un geste : plus d'exposition, et
-- plus de repli silencieux — un appel omettant p_org_id echoue desormais au
-- lieu de retomber sur une version qui ecrit chez Mayer.
--
-- Verifie apres coup : 0 fonction du site avec un UUID Mayer en dur,
-- 0 fonction du site executable par anon, formulaire de contact teste en
-- production (lead cree avec la bonne org, puis purge).
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_website_lead(
  text, text, text, text, text, text, text, text, uuid, uuid, text, jsonb, uuid);

DROP FUNCTION IF EXISTS public.create_aide_lead(
  text, text, text, text, text, text, text, text, uuid, uuid, uuid, text, jsonb, uuid);

DROP FUNCTION IF EXISTS public.inscrire_prospect_pellets(
  text, text, text, text, text, text, boolean);
