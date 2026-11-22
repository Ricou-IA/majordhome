-- 20261122_1 — Import des clients : suite de 20261121_13 (déjà appliquée en production le 2026-11-21).
--
-- 20261121_13 n'est pas modifiée : elle est en production. Cette migration remplace UNE fonction par
-- CREATE OR REPLACE (même signature, droits conservés ; REVOKE / GRANT réémis quand même) :
--
-- public.clients_import_remove(p_import_id, p_limit)
--   1. L'import ne passe à « retire » que lorsqu'il ne lui reste PLUS AUCUNE fiche. Avant, il y passait dès qu'il
--      ne restait plus rien de retirable : un import dont des fiches étaient conservées (contrat, intervention…)
--      disparaissait de la liste comme « Retiré », sans dire combien de fiches restaient, et ne pouvait plus être
--      retiré quand ces fiches se libéraient. Un import sans aucune fiche (interrompu avant le premier lot) passe à
--      « retire » au premier appel.
--   2. `counts` reçoit `retirees` (cumul de tous les appels) et `conservees` (fiches de l'import encore présentes et
--      non retirables maintenant) ; les autres clés de `counts` sont gardées. L'objet rendu ne change pas :
--      { retirees (cet appel), conservees, restantes }.
--   3. Allègement : `restantes` = retirables avant l'appel − fiches supprimées ; les retirables ne sont recalculés
--      (≈ 40 clés étrangères parcourues) que si ce reste vaut 0 — pour attraper une fiche libérée par celle qui vient
--      de partir (parrain dans le même import). Avant, ils l'étaient à chaque appel, deux fois par appel.
--
-- Mesuré sur le harnais le 2026-11-22 (assert-clients-import.sql, trigger d'audit actif, 17 clés étrangères vers
-- clients / projects photographiées, ~40 en prod) : import de 3 000 fiches, un appel p_limit 100 = 228 ms,
-- p_limit 200 = 457 ms ; un calcul des retirables sur 3 000 fiches = 19 ms (le coût est dans les suppressions et
-- leurs triggers). Plafond PostgREST : 8 s.

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.clients_import_remove(p_import_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_org       uuid;
  v_limit     integer := LEAST(GREATEST(coalesce(p_limit, 200), 1), 500);
  v_ret       uuid[];
  v_lot       uuid[];
  v_projets   uuid[];
  v_vises     integer;
  v_n         integer;
  v_total     integer;
  v_restantes integer;
  v_cumul     numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  v_org := majordhome.clients_import_org_admin(p_import_id);

  -- Verrous : l'import (pas de lot en parallèle) puis ses fiches et leurs projets — une écriture concurrente qui
  -- voudrait y rattacher un contrat, un lead… attend la fin du retrait (puis échoue sur la clé étrangère) au lieu
  -- d'être emportée en silence par une suppression en cascade.
  PERFORM 1 FROM majordhome.client_imports WHERE id = p_import_id FOR UPDATE;
  PERFORM 1 FROM majordhome.clients c JOIN core.projects p ON p.id = c.project_id
    WHERE c.import_id = p_import_id FOR UPDATE OF c, p;

  v_ret := majordhome.clients_import_retirables(p_import_id);
  v_lot := coalesce(v_ret[1:v_limit], '{}');
  v_vises := cardinality(v_lot);
  SELECT coalesce(array_agg(project_id), '{}') INTO v_projets
    FROM majordhome.clients WHERE id = ANY (v_lot) AND import_id = p_import_id AND org_id = v_org;

  -- Chaque suppression doit toucher exactement ce qui est visé : sinon tout est annulé (jamais un succès annoncé
  -- sur des fiches ou des projets restés en place).
  DELETE FROM majordhome.clients WHERE id = ANY (v_lot) AND import_id = p_import_id AND org_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM v_vises THEN
    RAISE EXCEPTION 'removal_incomplete' USING ERRCODE = 'P0001', DETAIL = format('fiches : %s supprimées sur %s', v_n, v_vises);
  END IF;
  DELETE FROM core.projects WHERE id = ANY (v_projets) AND org_id = v_org;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n IS DISTINCT FROM v_vises THEN
    RAISE EXCEPTION 'removal_incomplete' USING ERRCODE = 'P0001', DETAIL = format('projets : %s supprimés sur %s', v_n, v_vises);
  END IF;

  -- Reste à retirer = retirables d'avant moins ce qui vient de partir. À 0 seulement, on recompte : une fiche que
  -- retenait une fiche qui vient de partir (parrain dans le même import) est devenue retirable.
  v_restantes := cardinality(v_ret) - v_vises;
  IF v_restantes = 0 THEN
    v_restantes := cardinality(majordhome.clients_import_retirables(p_import_id));
  END IF;
  SELECT count(*) INTO v_total FROM majordhome.clients WHERE import_id = p_import_id AND org_id = v_org;

  -- Bilan du retrait dans counts (cumul des appels) ; « retire » seulement quand il ne reste aucune fiche.
  SELECT CASE WHEN jsonb_typeof(counts -> 'retirees') = 'number' THEN (counts ->> 'retirees')::numeric ELSE 0 END
    INTO v_cumul FROM majordhome.client_imports WHERE id = p_import_id;
  UPDATE majordhome.client_imports
     SET counts     = counts || jsonb_build_object('retirees', coalesce(v_cumul, 0) + v_vises, 'conservees', v_total - v_restantes),
         status     = CASE WHEN v_total = 0 THEN 'retire' ELSE status END,
         removed_at = CASE WHEN v_total = 0 THEN coalesce(removed_at, now()) ELSE removed_at END,
         removed_by = CASE WHEN v_total = 0 THEN coalesce(removed_by, v_uid) ELSE removed_by END
   WHERE id = p_import_id AND org_id = v_org;

  RETURN jsonb_build_object('retirees', v_vises, 'conservees', v_total - v_restantes, 'restantes', v_restantes);
END;
$$;

REVOKE ALL ON FUNCTION public.clients_import_remove(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clients_import_remove(uuid, integer) TO authenticated, service_role;

COMMENT ON COLUMN majordhome.client_imports.status IS
  'en_cours → termine (clients_import_finish) ; retire quand il ne reste plus aucune fiche de l''import (clients_import_remove).';
COMMENT ON COLUMN majordhome.client_imports.counts IS
  'Bilan de l''import : au départ lues, prevues, doublons_ecartes, ecartees ; à la fin importees ; après un retrait retirees (cumul) et conservees.';

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';
