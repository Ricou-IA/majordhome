-- 20260807_6 — Rendre visible le piège de upsert_pennylane_customer_lookup().
--
-- STRICTEMENT ADDITIVE (instance Supabase partagée en production) : aucun DROP,
-- aucune modification du corps de la fonction, aucun changement de comportement
-- pour l'appelant qui l'utilise réellement. On retire un privilège qui n'a
-- jamais été utilisable, et on écrit noir sur blanc pourquoi.
--
-- ============================================================================
-- LE PIÈGE
-- ============================================================================
-- public.upsert_pennylane_customer_lookup(p_org_id, p_payload) commence par :
--
--     IF NOT EXISTS (SELECT 1 FROM core.organization_members
--                    WHERE user_id = auth.uid() AND org_id = p_org_id)
--     THEN RAISE EXCEPTION 'not_org_member' USING ERRCODE = '42501';
--
-- Cette garde est correcte pour son appelant réel : le FRONTEND, où auth.uid()
-- porte l'utilisateur connecté (cacheUpsertCustomer dans pennylane.service.js,
-- fire-and-forget, write-through cache D.5).
--
-- Elle la rend en revanche STRUCTURELLEMENT INAPPELABLE côté serveur. Une edge
-- function s'authentifie avec SUPABASE_SERVICE_ROLE_KEY et sans session
-- utilisateur (cf. getAdminClient dans _shared/auth.ts) : auth.uid() vaut NULL,
-- la sous-requête ne matche jamais, l'appel échoue à 100 % en
-- 42501 not_org_member.
--
-- Or service_role disposait bien d'EXECUTE — non par décision explicite, mais
-- par le DEFAULT PRIVILEGE Supabase sur le schéma public : la migration
-- 20260526_9 ne révoque que PUBLIC et anon, service_role est donc resté sur la
-- fonction sans que personne ne l'ait choisi. Résultat : le GRANT annonce une
-- porte ouverte, et le 42501 renvoyé ressemble à un problème de droits alors
-- que la cause est un auth.uid() NULL. Une edge function a perdu du temps sur
-- ce diagnostic le 2026-08-07.
--
-- Le REVOKE ci-dessous ne casse rien (l'appel échouait déjà systématiquement),
-- mais transforme un échec incompréhensible en un refus net, au bon endroit.
--
-- ⚠️ L'ACL survit à un CREATE OR REPLACE, PAS à un DROP + CREATE. Si une
-- future migration recrée la fonction par DROP, le default privilege
-- service_role revient : re-jouer ce REVOKE.
--
-- ÉQUIVALENT SERVEUR (edge functions / crons) :
--   public.pennylane_customer_lookup_upsert_batch(uuid, jsonb)
--   — migration 20260807_5 : pas d'auth.uid(), org dérivée du paramètre,
--     service_role only, consommée par pennylane-quotes-sweep.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.upsert_pennylane_customer_lookup(uuid, jsonb)
  FROM service_role;

COMMENT ON FUNCTION public.upsert_pennylane_customer_lookup(uuid, jsonb) IS
  'D.5 write-through : upsert un customer PL dans le cache lookup. SECURITY '
  'DEFINER, check membership user × org_id. COALESCE strict : ne jamais '
  'écraser une valeur existante avec null/vide. '
  'ATTENTION — EXIGE UN CONTEXTE UTILISATEUR : la garde membership lit '
  'auth.uid(), NULL en service_role, donc 42501 not_org_member systématique '
  'hors session utilisateur. Appelant unique = le frontend '
  '(cacheUpsertCustomer, pennylane.service.js). Équivalent serveur pour edge '
  'functions et crons : pennylane_customer_lookup_upsert_batch(uuid, jsonb), '
  'service_role only. EXECUTE révoqué à service_role le 2026-08-07 pour que le '
  'refus soit explicite plutôt que trompeur (migration 20260807_6).';
