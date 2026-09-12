-- ============================================================================
-- 20260912_5 — « Journée pleine » : figeage automatique (spec 2026-09-12
-- « tournées — bloc contrat et journée pleine », R2)
-- ============================================================================
-- 1. RPC public.tournees_figer_journee(p_org_id, p_lignes) — écrit les heures
--    définitives d'une journée ordonnancée par l'edge `tournees-figer`.
--    SECURITY DEFINER, service_role ONLY : `p_org_id` vient du payload, sans
--    auth.uid() (posture serveur, cf. charte multi-tenant) → REVOKE FROM
--    PUBLIC, anon, authenticated. Tout ou rien : si un seul RDV n'est plus tel
--    que l'ordonnanceur l'a vu (déplacé, figé entre-temps, clos), rien n'est
--    écrit — l'ordre reposait sur lui.
-- 2. Cron pg_cron horaire (5h-19h UTC) → edge `tournees-figer`
--    (verify_jwt:false, MDH_CRON_SECRET depuis vault), même patron que
--    sms-rappel-rdv / geocode-sweep.
-- ============================================================================

create or replace function public.tournees_figer_journee(p_org_id uuid, p_lignes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = majordhome, public
as $$
declare
  v_ligne   jsonb;
  v_refuses text[] := '{}';
  v_now     timestamptz := now();
  v_count   int := 0;
begin
  if p_org_id is null or p_lignes is null or jsonb_typeof(p_lignes) <> 'array' then
    raise exception 'invalid_args';
  end if;

  -- 1. Chaque RDV doit être exactement tel que l'ordonnanceur l'a vu : même
  --    heure, encore adaptable, pas clos, d'un type concerné par la souplesse.
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    if not exists (
      select 1 from majordhome.appointments a
      where a.id = (v_ligne->>'id')::uuid
        and a.org_id = p_org_id
        and a.scheduled_start = (v_ligne->>'attendu')::time
        and a.hour_confirmed_at is null
        and coalesce(a.time_flex_minutes, -1) <> 0
        and a.status not in ('cancelled', 'completed', 'no_show')
        and a.appointment_type in ('maintenance', 'service')
    ) then
      v_refuses := array_append(v_refuses, v_ligne->>'id');
    end if;
  end loop;

  if coalesce(array_length(v_refuses, 1), 0) > 0 then
    return jsonb_build_object('figes', 0, 'refuses', to_jsonb(v_refuses));
  end if;

  -- 2. Heures définitives : le bloc suit le barème (R1), l'ancre = l'heure annoncée.
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    update majordhome.appointments a set
      scheduled_start   = (v_ligne->>'scheduled_start')::time,
      scheduled_end     = (v_ligne->>'scheduled_end')::time,
      duration_minutes  = (v_ligne->>'duration_minutes')::int,
      time_flex_minutes = 0,
      hour_confirmed_at = v_now,
      announced_start   = (v_ligne->>'scheduled_start')::time,
      updated_at        = v_now
    where a.id = (v_ligne->>'id')::uuid and a.org_id = p_org_id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('figes', v_count, 'refuses', '[]'::jsonb);
end
$$;

revoke execute on function public.tournees_figer_journee(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.tournees_figer_journee(uuid, jsonb) to service_role;

comment on function public.tournees_figer_journee(uuid, jsonb) is
  'Figeage d''une journée ordonnancée (edge tournees-figer). service_role only ; tout ou rien si un RDV a changé depuis l''ordonnancement.';

-- ---------------------------------------------------------------------------
-- Cron horaire. Idempotent : on retire une éventuelle planification homonyme.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('tournees-figer');
exception when others then
  null;
end
$$;

select cron.schedule(
  'tournees-figer',
  '20 5-19 * * *',
  $$
    select net.http_post(
      url := 'https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/tournees-figer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mdh_cron_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
