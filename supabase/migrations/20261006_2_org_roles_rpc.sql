-- =============================================================================
-- 20261006_2_org_roles_rpc — profils maison : les 4 RPC d'écriture (org_admin)
-- =============================================================================
-- Spec § 4.2. Seuls écrivains de majordhome.org_roles / member_org_roles.
-- member_set_org_role pose le profil ET réaligne les champs core sur le MODÈLE
-- (invariant § 3.2 : tout le code en dur voit le modèle), puis resynchronise le
-- rôle planning comme le fait permissions.service.updateMemberRole.
-- =============================================================================

-- ── garde commune ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION majordhome.org_roles_require_admin(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'core', 'public'
AS $function$
DECLARE v_role text;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = auth.uid() AND org_id = p_org_id;
  IF (v_role = 'org_admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'org_admin_required (role=%)', v_role USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION majordhome.org_roles_require_admin(uuid) FROM PUBLIC, anon;

-- ── org_role_create ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_role_create(p_org_id uuid, p_label text, p_base_role text)
RETURNS majordhome.org_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_label text := NULLIF(trim(p_label), '');
  v_base  text;
  v_code  text;
  v_i     int := 1;
  v_row   majordhome.org_roles;
BEGIN
  PERFORM majordhome.org_roles_require_admin(p_org_id);
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'label_required' USING ERRCODE = '22023';
  END IF;
  IF p_base_role NOT IN ('team_leader', 'commercial', 'technicien') THEN
    RAISE EXCEPTION 'invalid_base_role (%)', p_base_role USING ERRCODE = '22023';
  END IF;

  -- code : translittération (unaccent) → minuscules → [a-z0-9_] → bornes nettoyées
  v_base := trim(both '_' from regexp_replace(lower(public.unaccent(v_label)), '[^a-z0-9]+', '_', 'g'));
  IF v_base = '' OR v_base IN ('org_admin', 'team_leader', 'commercial', 'technicien') THEN
    v_base := 'profil_' || v_base;
  END IF;
  v_code := v_base;
  WHILE EXISTS (SELECT 1 FROM majordhome.org_roles WHERE org_id = p_org_id AND code = v_code) LOOP
    v_i := v_i + 1;
    v_code := v_base || '_' || v_i;
  END LOOP;

  INSERT INTO majordhome.org_roles (org_id, code, label, base_role)
  VALUES (p_org_id, v_code, v_label, p_base_role)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.org_role_create(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_role_create(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_role_create(uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.org_role_create(uuid, text, text) IS
  'Crée un profil maison (libellé + modèle standard). org_admin only. Code dérivé du libellé, suffixé si pris, jamais un code standard.';

-- ── org_role_update ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_role_update(p_org_role_id uuid, p_label text DEFAULT NULL, p_is_active boolean DEFAULT NULL)
RETURNS majordhome.org_roles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_row majordhome.org_roles;
BEGIN
  SELECT * INTO v_row FROM majordhome.org_roles WHERE id = p_org_role_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_role_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM majordhome.org_roles_require_admin(v_row.org_id);
  IF p_label IS NOT NULL AND NULLIF(trim(p_label), '') IS NULL THEN
    RAISE EXCEPTION 'label_required' USING ERRCODE = '22023';
  END IF;

  UPDATE majordhome.org_roles
     SET label      = COALESCE(NULLIF(trim(p_label), ''), label),
         is_active  = COALESCE(p_is_active, is_active),
         updated_at = now()
   WHERE id = p_org_role_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.org_role_update(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_role_update(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_role_update(uuid, text, boolean) TO authenticated;
COMMENT ON FUNCTION public.org_role_update(uuid, text, boolean) IS
  'Renomme / (dés)active un profil maison (NULL = inchangé). org_admin only. Le code et le modèle sont immuables (spec § 7).';

-- ── org_role_delete ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_role_delete(p_org_role_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_row       majordhome.org_roles;
  v_members   int;
  v_overrides int;
BEGIN
  SELECT * INTO v_row FROM majordhome.org_roles WHERE id = p_org_role_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_role_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM majordhome.org_roles_require_admin(v_row.org_id);

  SELECT count(*) INTO v_members FROM majordhome.member_org_roles WHERE org_role_id = v_row.id;
  -- surcharges : pas de FK possible sur un code texte → purge explicite
  DELETE FROM majordhome.role_permissions WHERE org_id = v_row.org_id AND role = v_row.code;
  GET DIAGNOSTICS v_overrides = ROW_COUNT;
  -- assignations : CASCADE de la FK ; les champs core des membres portent déjà le modèle
  DELETE FROM majordhome.org_roles WHERE id = v_row.id;

  RETURN jsonb_build_object('members_reset', v_members, 'overrides_deleted', v_overrides);
END;
$function$;
REVOKE ALL ON FUNCTION public.org_role_delete(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_role_delete(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.org_role_delete(uuid) TO authenticated;
COMMENT ON FUNCTION public.org_role_delete(uuid) IS
  'Supprime un profil maison : purge ses surcharges role_permissions, ses porteurs retombent sur le modèle. org_admin only. Irréversible.';

-- ── member_set_org_role ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.member_set_org_role(p_org_id uuid, p_user_id uuid, p_org_role_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'core', 'public'
AS $function$
DECLARE
  v_row       majordhome.org_roles;
  v_is_member boolean;
BEGIN
  PERFORM majordhome.org_roles_require_admin(p_org_id);
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM core.organization_members WHERE org_id = p_org_id AND user_id = p_user_id
  ) INTO v_is_member;
  IF v_is_member IS NOT TRUE THEN
    RAISE EXCEPTION 'not_an_org_member' USING ERRCODE = '42501';
  END IF;

  -- retour à un rôle standard : on retire la ligne, l'appelant pose le standard (update_member_role)
  IF p_org_role_id IS NULL THEN
    DELETE FROM majordhome.member_org_roles WHERE org_id = p_org_id AND user_id = p_user_id;
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM majordhome.org_roles WHERE id = p_org_role_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_role_not_found' USING ERRCODE = '42501'; -- profil inconnu OU d'une autre org : même refus
  END IF;

  INSERT INTO majordhome.member_org_roles (org_id, user_id, org_role_id)
  VALUES (p_org_id, p_user_id, v_row.id)
  ON CONFLICT (org_id, user_id) DO UPDATE SET org_role_id = EXCLUDED.org_role_id;

  -- invariant § 3.2 : les champs core portent le MODÈLE (= ROLE_DB_MAPPING de src/lib/permissions.js)
  CASE v_row.base_role
    WHEN 'team_leader' THEN PERFORM core.update_member_role(p_org_id, p_user_id, 'team_leader', NULL, 'team_leader');
    WHEN 'commercial'  THEN PERFORM core.update_member_role(p_org_id, p_user_id, 'user', 'Commercial', 'member');
    WHEN 'technicien'  THEN PERFORM core.update_member_role(p_org_id, p_user_id, 'user', 'Technicien', 'member');
  END CASE;
  -- rôle planning (team_members.role) suit le modèle ; no-op sans ressource planning
  PERFORM public.team_member_sync_role_for_user(p_org_id, p_user_id);

  RETURN v_row.code;
END;
$function$;
REVOKE ALL ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.member_set_org_role(uuid, uuid, uuid) IS
  'Pose (ou retire si NULL) le profil maison d''un membre et aligne ses champs core sur le modèle + rôle planning. org_admin only.';
