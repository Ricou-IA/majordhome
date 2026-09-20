-- supabase/migrations/20260827_1_storage_bucket_certificats.sql
-- ============================================================================
-- Regression du cutover (2026-08-11) — bucket Storage `certificats` manquant.
--
-- La migration 20260809_2_storage_buckets_et_policies.sql a transcrit l'etat de
-- prod de l'ancien projet... en oubliant le bucket `certificats` (45 objets a
-- l'epoque). Son controle final comptait 6 buckets / 23 policies, c'est-a-dire
-- SA PROPRE liste : il ne pouvait donc pas detecter une absence dans l'inventaire.
-- Le script migrate-storage.mjs portait la meme liste de 6 — les PDF existants
-- sont restes sur l'ancien projet.
--
-- Effet observe en prod du 2026-08-11 au 2026-08-27 : `certificats.uploadPdf`
-- echoue (bucket inexistant), CertificatWizard leve avant `savService.markRealise`
-- → le certificat est cree et signe en base mais sans PDF, et l'entretien reste
-- « planifie » dans le kanban. Mesure : 39/48 certificats avec PDF avant le
-- cutover, 0/9 apres.
--
-- Ce fichier RETABLIT la definition d'origine, relevee sur l'ancien projet
-- (odspcxgafcqxjzrarsqf) : bucket prive, 10 Mo, pdf/png/jpeg, et 4 policies sur
-- le motif `contracts` (org_id en 1er segment de path, compare en uuid).
--
-- Idempotent : rejouable sans effet de bord.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificats', 'certificats', false, 10485760, array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Policies — path `${orgId}/${clientId}/${annee}/${certificatId}.pdf`
-- ---------------------------------------------------------------------------
drop policy if exists certificats_org_select on storage.objects;
create policy certificats_org_select on storage.objects for select to authenticated
using (
  bucket_id = 'certificats'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists certificats_org_insert on storage.objects;
create policy certificats_org_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'certificats'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists certificats_org_update on storage.objects;
create policy certificats_org_update on storage.objects for update to authenticated
using (
  bucket_id = 'certificats'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'certificats'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists certificats_org_delete on storage.objects;
create policy certificats_org_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'certificats'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- 3. Controle : le bucket existe et porte bien ses 4 policies.
-- ---------------------------------------------------------------------------
do $$
declare
  n_buckets  int;
  n_policies int;
begin
  select count(*) into n_buckets from storage.buckets where id = 'certificats';

  select count(*) into n_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual,'') || coalesce(with_check,'')) like '%certificats%';

  raise notice 'storage certificats : % bucket, % policies', n_buckets, n_policies;

  if n_buckets <> 1 then
    raise exception 'bucket certificats absent';
  end if;
  if n_policies <> 4 then
    raise exception 'bucket certificats : % policies au lieu de 4', n_policies;
  end if;
end $$;
