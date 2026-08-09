-- supabase/migrations/20260809_2_storage_buckets_et_policies.sql
-- ============================================================================
-- Prerequis n°2 du chantier 0 (projet Supabase dedie) — 2026-08-09.
--
-- Les 6 buckets Storage de Majord'home et leurs 22 policies avaient ete crees
-- a la main dans le dashboard : aucune migration ne les decrivait. Sur un
-- nouveau projet ils seraient arrives vides de regles — donc soit inaccessibles,
-- soit ouverts. Meme classe de probleme que les 5 edge functions non versionnees
-- (commit 889157a).
--
-- Ce fichier TRANSCRIT l'etat de production au 2026-08-09, il ne le corrige pas.
-- Deux anomalies relevees au passage sont signalees en commentaire ci-dessous et
-- reproduites telles quelles : les corriger ici melangerait « decrire l'existant »
-- et « changer le comportement ».
--
-- Idempotent : rejouable sans effet de bord.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('contracts',          'contracts',          false,  10485760, array['application/pdf','image/jpeg','image/png']),
  ('interventions',      'interventions',      false,  10485760, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('product-documents',  'product-documents',  false,  20971520, array['application/pdf','image/png','image/jpeg','image/webp']),
  ('product-images',     'product-images',     true,    5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('project-recordings', 'project-recordings', false, 524288000, array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm','audio/ogg']),
  ('technical-visits',   'technical-visits',   false,  10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Policies
-- ---------------------------------------------------------------------------

-- --- contracts : org_id en 1er segment de path, compare en uuid ------------
drop policy if exists contracts_org_select on storage.objects;
create policy contracts_org_select on storage.objects for select to authenticated
using (
  bucket_id = 'contracts'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists contracts_org_insert on storage.objects;
create policy contracts_org_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'contracts'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists contracts_org_update on storage.objects;
create policy contracts_org_update on storage.objects for update to authenticated
using (
  bucket_id = 'contracts'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'contracts'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists contracts_org_delete on storage.objects;
create policy contracts_org_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'contracts'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

-- --- product-documents : meme motif que contracts --------------------------
drop policy if exists product_documents_org_select on storage.objects;
create policy product_documents_org_select on storage.objects for select to authenticated
using (
  bucket_id = 'product-documents'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists product_documents_org_insert on storage.objects;
create policy product_documents_org_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-documents'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists product_documents_org_update on storage.objects;
create policy product_documents_org_update on storage.objects for update to authenticated
using (
  bucket_id = 'product-documents'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'product-documents'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists product_documents_org_delete on storage.objects;
create policy product_documents_org_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'product-documents'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

-- --- technical-visits : meme logique, mais comparaison en TEXT -------------
-- (variante de style, pas de bug : org_id::text au lieu de path::uuid)
drop policy if exists org_members_select_technical_visits on storage.objects;
create policy org_members_select_technical_visits on storage.objects for select to authenticated
using (
  bucket_id = 'technical-visits'
  and (storage.foldername(name))[1] in (
    select om.org_id::text from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists org_members_insert_technical_visits on storage.objects;
create policy org_members_insert_technical_visits on storage.objects for insert to authenticated
with check (
  bucket_id = 'technical-visits'
  and (storage.foldername(name))[1] in (
    select om.org_id::text from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists org_members_update_technical_visits on storage.objects;
create policy org_members_update_technical_visits on storage.objects for update to authenticated
using (
  bucket_id = 'technical-visits'
  and (storage.foldername(name))[1] in (
    select om.org_id::text from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists org_members_delete_technical_visits on storage.objects;
create policy org_members_delete_technical_visits on storage.objects for delete to authenticated
using (
  bucket_id = 'technical-visits'
  and (storage.foldername(name))[1] in (
    select om.org_id::text from core.organization_members om where om.user_id = auth.uid()
  )
);

-- --- interventions ---------------------------------------------------------
-- ⚠️ ANOMALIE 1 (transcrite telle quelle, NON corrigee ici).
-- La condition porte sur `storage.foldername(p.name)` — le NOM DU PROJET — et
-- non sur `storage.foldername(name)`, le chemin de l'objet. Elle compare donc
-- le 1er segment d'un nom de projet a l'uuid de ce projet, ce qui n'a pas de
-- sens et ne depend pas du fichier accede : la clause est vraie ou fausse pour
-- TOUS les objets du bucket a la fois, selon qu'il existe au moins un projet
-- dont le nom ressemble a son propre id.
-- A instruire separement : soit corriger en `(storage.foldername(name))[1]`,
-- soit aligner sur le motif org_id des autres buckets. Ne pas trancher dans une
-- migration dont le but est de decrire l'existant.
drop policy if exists org_members_select_interventions on storage.objects;
create policy org_members_select_interventions on storage.objects for select to authenticated
using (
  bucket_id = 'interventions'
  and exists (
    select 1
    from core.organization_members om
    join core.projects p on p.org_id = om.org_id
    where om.user_id = auth.uid()
      and (storage.foldername(p.name))[1] = p.id::text
  )
);

drop policy if exists org_members_insert_interventions on storage.objects;
create policy org_members_insert_interventions on storage.objects for insert to authenticated
with check (
  bucket_id = 'interventions'
  and exists (
    select 1
    from core.organization_members om
    join core.projects p on p.org_id = om.org_id
    where om.user_id = auth.uid()
      and (storage.foldername(p.name))[1] = p.id::text
  )
);

drop policy if exists org_members_update_interventions on storage.objects;
create policy org_members_update_interventions on storage.objects for update to authenticated
using (
  bucket_id = 'interventions'
  and exists (
    select 1
    from core.organization_members om
    join core.projects p on p.org_id = om.org_id
    where om.user_id = auth.uid()
      and (storage.foldername(p.name))[1] = p.id::text
  )
);

drop policy if exists org_members_delete_interventions on storage.objects;
create policy org_members_delete_interventions on storage.objects for delete to authenticated
using (
  bucket_id = 'interventions'
  and exists (
    select 1
    from core.organization_members om
    join core.projects p on p.org_id = om.org_id
    where om.user_id = auth.uid()
      and (storage.foldername(p.name))[1] = p.id::text
  )
);

-- --- product-images : seul bucket public -----------------------------------
drop policy if exists "Product images are publicly readable" on storage.objects;
create policy "Product images are publicly readable" on storage.objects for select to public
using (bucket_id = 'product-images');

drop policy if exists "Product images upload by org members" on storage.objects;
create policy "Product images upload by org members" on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and ((storage.foldername(name))[1])::uuid in (
    select organization_members.org_id from core.organization_members
    where organization_members.user_id = auth.uid()
  )
);

drop policy if exists "Product images update by org members" on storage.objects;
create policy "Product images update by org members" on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and ((storage.foldername(name))[1])::uuid in (
    select organization_members.org_id from core.organization_members
    where organization_members.user_id = auth.uid()
  )
);

drop policy if exists "Product images delete by org members" on storage.objects;
create policy "Product images delete by org members" on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and ((storage.foldername(name))[1])::uuid in (
    select organization_members.org_id from core.organization_members
    where organization_members.user_id = auth.uid()
  )
);

-- --- project-recordings ----------------------------------------------------
-- ⚠️ ANOMALIE 2 (transcrite telle quelle) : ce bucket derive l'org depuis
-- `core.profiles.org_id` et non depuis `core.organization_members`, contrairement
-- aux 5 autres. Un utilisateur membre de plusieurs orgs n'accede donc qu'aux
-- enregistrements de l'org portee par son profil. A aligner separement.
-- Pas de policy UPDATE ni DELETE pour `authenticated` : c'est l'etat de prod.
drop policy if exists recordings_select_own_org on storage.objects;
create policy recordings_select_own_org on storage.objects for select to authenticated
using (
  bucket_id = 'project-recordings'
  and (storage.foldername(name))[1] in (
    select p.org_id::text from core.profiles p where p.id = auth.uid()
  )
);

drop policy if exists recordings_insert_own_org on storage.objects;
create policy recordings_insert_own_org on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-recordings'
  and (storage.foldername(name))[1] in (
    select p.org_id::text from core.profiles p where p.id = auth.uid()
  )
);

drop policy if exists recordings_service_role on storage.objects;
create policy recordings_service_role on storage.objects for all to service_role
using (bucket_id = 'project-recordings')
with check (bucket_id = 'project-recordings');

-- ---------------------------------------------------------------------------
-- 3. Controle : 6 buckets, 22 policies. Echoue si le compte ne tombe pas juste.
-- ---------------------------------------------------------------------------
do $$
declare
  n_buckets  int;
  n_policies int;
begin
  select count(*) into n_buckets
  from storage.buckets
  where id in ('contracts','interventions','product-documents','product-images','project-recordings','technical-visits');

  select count(*) into n_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual,'') || coalesce(with_check,'')) ~
        '(contracts|interventions|product-documents|product-images|project-recordings|technical-visits)';

  raise notice 'storage : % buckets, % policies', n_buckets, n_policies;

  if n_buckets <> 6 then
    raise exception 'storage_buckets: % buckets au lieu de 6', n_buckets;
  end if;
  if n_policies <> 22 then
    raise exception 'storage_buckets: % policies au lieu de 22', n_policies;
  end if;
end $$;
