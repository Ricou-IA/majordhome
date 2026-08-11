-- ============================================================================
-- process_web_entretien : fermeture de l'acces anon
-- ============================================================================
--
-- CONTEXTE (2026-08-11)
-- Cette fonction cree client + contrat + intervention en SECURITY DEFINER. Elle
-- existe en DEUX copies (majordhome et public), et les deux etaient executables
-- par `anon` : toute personne disposant de la cle publique — presente dans le
-- bundle navigateur — pouvait creer des contrats sans authentification.
--
-- Aucun appelant legitime : `grep -rn process_web_entretien src/ supabase/`
-- ne remonte rien, et le workflow N8N qui l'utilise passe par une connexion
-- Postgres privilegiee, pas par anon. Le revoke est donc sans impact.
--
-- ⚠ `PUBLIC` n'est PAS optionnel : PostgreSQL accorde EXECUTE a PUBLIC par
-- defaut sur toute fonction creee, et anon en herite. Un `REVOKE ... FROM anon`
-- seul reussirait sans rien retirer — echec silencieux, la commande ne signale
-- rien. Auditer l'effet reel via has_function_privilege, jamais en relisant le
-- texte de la migration.
--
-- ⚠ RESTE A FAIRE : l'ANCIEN projet (odspcxgafcqxjzrarsqf) porte la meme
-- ouverture, et c'est LUI que le formulaire du site alimente encore via N8N.
-- Le meme revoke y est requis — sous reserve de confirmer que le site
-- n'appelle pas la RPC en direct avec la cle anon.
--
-- Le duplicat majordhome/public reste a instruire : une seule des deux devrait
-- survivre. Hors perimetre de ce correctif de securite.
-- ============================================================================

revoke execute on function majordhome.process_web_entretien(
  text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text
) from public, anon, authenticated;

revoke execute on function public.process_web_entretien(
  text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text
) from public, anon, authenticated;

-- Conserve pour la future edge `web-entretien-subscribe`, qui appellera la RPC
-- avec des PARAMETRES (et non par concatenation de chaine, comme le fait le
-- workflow N8N aujourd'hui).
grant execute on function public.process_web_entretien(
  text, text, text, text, text, text, text, text, jsonb,
  numeric, numeric, integer, numeric, text, jsonb, text
) to service_role;
