-- ============================================================================
-- auth_user_id_by_email — retrouver un compte auth par email (service_role)
-- ============================================================================
-- Contexte : l'edge create-user réutilise un compte auth déjà inscrit (orphelin
-- d'une invitation ratée) au lieu de bloquer. Pour retrouver son id, elle passait
-- par auth.admin.listUsers() : sur l'instance partagée, GoTrue répond 500
-- (« Scan error on column confirmation_token: converting NULL to string is
-- unsupported ») dès que la page contient un compte créé par SQL avec des jetons
-- NULL — 5 comptes d'apps voisines au 2026-09-30, aucun de Majord'home.
-- Résultat : toute invitation d'un email déjà inscrit échouait en 500
-- (« Compte existant introuvable »), vécu sur lucas.taugourdeau@ (orphelin du
-- 2026-09-21, jour de la réécriture de l'edge).
--
-- Cette RPC lit auth.users directement, sans passer par GoTrue ni par une
-- pagination plafonnée à 1000 comptes.
-- Sécurité : SECURITY DEFINER sur auth.users → service_role UNIQUEMENT
-- (REVOKE PUBLIC, anon, authenticated — PUBLIC obligatoire, cf. CLAUDE.md).
-- plpgsql (pas sql) : le corps n'est pas résolu à la création, le harnais de
-- répétition n'ayant pas auth.users.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN NULL;
  END IF;

  SELECT u.id INTO v_id
  FROM auth.users u
  WHERE lower(u.email) = lower(btrim(p_email))
    AND u.deleted_at IS NULL
  ORDER BY u.created_at
  LIMIT 1;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;

COMMENT ON FUNCTION public.auth_user_id_by_email(text) IS
  'Id auth.users d''un email (NULL si inconnu). service_role only — utilisé par l''edge create-user pour réutiliser un compte orphelin sans passer par auth.admin.listUsers (KO sur l''instance partagée).';
