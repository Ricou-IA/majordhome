-- 20260808_1 — Fermeture de 10 RPC SECURITY DEFINER accessibles sans authentification.
--
-- Applique a la main en production le 2026-08-08. Cette migration REJOUE la
-- correction pour qu'elle survive a une recreation de fonction, a un rejeu du
-- depot sur une nouvelle instance, ou a un audit qui ne lirait que le code.
-- Idempotente : sur une base deja corrigee, elle ne change rien.
--
-- ============================================================================
-- CE QUI S'EST PASSE
-- ============================================================================
-- Ces 10 fonctions portent une garde de membership dite "tolerante" :
--
--     IF v_user IS NOT NULL AND NOT EXISTS (… org_members … user_id = v_user …)
--     THEN RAISE EXCEPTION 'Acces refuse';
--
-- Lue litteralement : « si je sais qui tu es, je verifie tes droits ; si je ne
-- sais pas qui tu es, passe ». Le controle d'acces se DESACTIVE quand
-- auth.uid() est NULL — c'est un fail-open, l'inverse d'un fail-safe.
--
-- Pour un utilisateur connecte, la garde fonctionne (auth.uid() non NULL, il ne
-- peut pas viser une autre org). Pour service_role, le contournement est voulu
-- (les crons doivent ecrire). Mais pour `anon` — la cle PUBLIQUE, presente dans
-- le bundle JS servi au navigateur — la garde s'ouvrait entierement : un
-- appelant non authentifie fournissait le p_org_id de son choix.
--
-- Sept de ces fonctions prennent l'org en parametre ou la derivent d'un objet
-- fourni (find_or_create_client, assign_pennylane_quote_to_lead,
-- eject_pennylane_quote…), donc l'ecriture cross-org etait atteignable.
--
-- POURQUOI PERSONNE NE L'AVAIT VU : `anon` n'avait aucun GRANT direct. Son
-- droit venait de PUBLIC, a qui PostgreSQL accorde EXECUTE par defaut sur toute
-- fonction creee. Un `REVOKE … FROM anon` — le geste prescrit par la charte a
-- l'epoque — REUSSIT SANS RIEN RETIRER dans ce cas : aucune erreur, aucun
-- avertissement, et has_function_privilege('anon', …) reste true.
--
-- D'ou la double revocation ci-dessous (PUBLIC *et* anon) et les GRANT
-- explicites de restauration : PUBLIC retire, il faut re-accorder nommement aux
-- deux appelants legitimes, sinon on couperait l'application et les crons.
--
-- La charte multi-tenant (CLAUDE.md) a ete corrigee en consequence :
-- « REVOKE FROM PUBLIC, anon », et auditer via pg_proc, jamais en relisant une
-- migration. Meme cause, meme jour, sur gtm_get_secret (depot Agent Marketing,
-- instance partagee) qui exposait tout le Vault.
--
-- NON TRAITE ICI (arbitrage a part, cf. fil du 2026-08-08) : le fail-open
-- lui-meme. Ces 10 fonctions restent contournables par service_role — ce qui
-- est le comportement actuel dont dependent les crons. Les refermer suppose de
-- dedoubler chaque fonction (une frontend a garde stricte, une serveur a org en
-- parametre), sur du code en production : chantier dedie, pas au fil de l'eau.
-- ============================================================================

DO $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.prosecdef
      AND p.proname IN (
        'assign_pennylane_quote_to_lead',
        'eject_pennylane_quote',
        'find_or_create_client',
        'mail_segment_compile_safe',
        'mail_single_client_sql',
        'create_majordhome_task',
        'create_majordhome_task_note',
        'update_majordhome_task',
        'create_majordhome_technical_visit',
        'update_majordhome_technical_visit'
      )
  LOOP
    -- PUBLIC d'abord : c'est lui qui portait le droit d'anon.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    -- Restauration explicite des deux appelants legitimes (front + crons).
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;

  RAISE NOTICE '20260808_1 : % fonction(s) fermee(s) a anon/PUBLIC', n;
END $$;

-- Controle : doit renvoyer 0 ligne. Toute ligne = une fonction encore ouverte.
DO $$
DECLARE v_restant integer;
BEGIN
  SELECT count(*) INTO v_restant
  FROM pg_proc p
  JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
  WHERE nsp.nspname = 'public'
    AND p.proname IN (
      'assign_pennylane_quote_to_lead','eject_pennylane_quote','find_or_create_client',
      'mail_segment_compile_safe','mail_single_client_sql','create_majordhome_task',
      'create_majordhome_task_note','update_majordhome_task',
      'create_majordhome_technical_visit','update_majordhome_technical_visit')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_restant > 0 THEN
    RAISE EXCEPTION '20260808_1 : % fonction(s) encore ouverte(s) a anon', v_restant;
  END IF;
  RAISE NOTICE '20260808_1 : controle OK, aucune fonction ouverte a anon';
END $$;
