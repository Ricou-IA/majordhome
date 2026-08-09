-- supabase/migrations/20260809_1_gcal_hardening.sql
-- ============================================================================
-- Durcissement de la famille Google Calendar (2026-08-09).
--
-- Constats a l'origine (fonctions recuperees depuis la prod, commit 889157a —
-- elles n'etaient pas versionnees, donc jamais passees dans l'audit Sem 0) :
--
--  1. google-calendar-auth construisait du SQL en collant du texte :
--       SELECT id FROM majordhome.organizations WHERE core_org_id = '${orgId}'
--     puis l'envoyait a public.exec_sql via le client service_role. `orgId`
--     provenait du `state` OAuth, non signe donc ecrit par l'appelant → la
--     valeur pouvait cesser d'etre une donnee pour devenir une instruction,
--     executee avec les pleins pouvoirs sur une instance partagee.
--     → remplace par la RPC typee gcal_resolve_majordhome_org ci-dessous.
--
--  2. Les 5 RPC gcal_* prennent user_id / org_id dans leur payload SANS les
--     deriver d'auth.uid(). La charte multi-tenant reserve ce motif au
--     service_role. Or trois d'entre elles etaient executables par `anon`
--     (cle publique, presente dans le bundle frontend) :
--       - gcal_disconnect      → deconnecter l'agenda de n'importe qui
--       - gcal_upsert_sync     → ecrire des lignes de sync arbitraires
--       - gcal_resolve_core_org
--     et les deux autres par `authenticated` :
--       - gcal_upsert_token    → poser des jetons au nom d'un autre user
--       - gcal_update_token
--
-- Verification prealable : `grep -rn "gcal_" src` ne remonte AUCUN appel
-- frontend. Les 6 appels existants viennent des deux edge functions, qui
-- utilisent toutes deux le client admin (service_role). Le REVOKE ne casse
-- donc aucun chemin actif.
--
-- Rappel charte : REVOKE ... FROM anon SEUL ne retire rien — PostgreSQL
-- accorde EXECUTE a PUBLIC par defaut et anon en herite. PUBLIC est
-- obligatoire dans chaque REVOKE ci-dessous.
-- ============================================================================

-- 1. Resolution org core -> org majordhome, en remplacement de l'exec_sql.
--    Le parametre est traite comme une donnee, jamais comme une instruction.
create or replace function public.gcal_resolve_majordhome_org(p_core_org_id uuid)
returns uuid
language sql
stable
security definer
set search_path = majordhome, public
as $$
  select o.id
  from majordhome.organizations o
  where o.core_org_id = p_core_org_id
  limit 1;
$$;

comment on function public.gcal_resolve_majordhome_org(uuid) is
  'Resout l''org majordhome depuis l''org core. Remplace un appel exec_sql interpole dans google-calendar-auth (2026-08-09). service_role uniquement.';

revoke execute on function public.gcal_resolve_majordhome_org(uuid) from public, anon, authenticated;
grant  execute on function public.gcal_resolve_majordhome_org(uuid) to service_role;

-- 2. Fermeture des 5 RPC existantes : service_role uniquement.
revoke execute on function public.gcal_resolve_core_org(uuid) from public, anon, authenticated;
grant  execute on function public.gcal_resolve_core_org(uuid) to service_role;

revoke execute on function public.gcal_disconnect(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.gcal_disconnect(uuid, uuid) to service_role;

revoke execute on function public.gcal_upsert_token(uuid, uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant  execute on function public.gcal_upsert_token(uuid, uuid, text, text, timestamptz, text) to service_role;

revoke execute on function public.gcal_update_token(uuid, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.gcal_update_token(uuid, text, timestamptz) to service_role;

revoke execute on function public.gcal_upsert_sync(uuid, uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.gcal_upsert_sync(uuid, uuid, text, text, text, text, text, timestamptz) to service_role;

-- 3. Controle de l'effet REEL des revoke — a lire dans la sortie, ne pas se
--    fier au texte de la migration (echec silencieux classique : un REVOKE
--    qui ne retire rien reussit sans rien signaler).
do $$
declare
  r record;
  n_ouvertes int := 0;
begin
  for r in
    select p.proname,
           has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_peut,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_peut,
           has_function_privilege('service_role',  p.oid, 'EXECUTE') as sr_peut
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'gcal\_%'
  loop
    raise notice 'gcal % : anon=% authenticated=% service_role=%',
      rpad(r.proname, 32), r.anon_peut, r.auth_peut, r.sr_peut;
    if r.anon_peut or r.auth_peut then
      n_ouvertes := n_ouvertes + 1;
    end if;
    if not r.sr_peut then
      raise exception 'gcal_hardening: % n''est plus executable par service_role — les edge functions casseraient', r.proname;
    end if;
  end loop;

  if n_ouvertes > 0 then
    raise exception 'gcal_hardening: % fonction(s) encore ouverte(s) a anon ou authenticated', n_ouvertes;
  end if;
end $$;
