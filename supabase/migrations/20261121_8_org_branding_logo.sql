-- ============================================================================
-- 20261121_8 — Compartiment public `org-branding` : le logo de l'entreprise, téléversé depuis
-- Paramètres → Organisation → Identité (jusqu'ici `settings.logo_url` ne se réglait par aucun écran).
--
-- Public en LECTURE par son adresse : le logo s'affiche dans les e-mails, les pages ouvertes au client sans
-- compte (/rdv, /pv) et les PDF. Rien d'autre ne doit y être rangé.
-- Chemin : `${org_id}/logo-<horodatage>.<ext>` (org CORE). Écriture, remplacement et suppression : org_admin
-- de l'organisation du dossier. Lecture par la session : membres de l'organisation (nécessaire au remplacement).
-- 2 Mo, PNG / JPEG / WebP (pas de SVG : il peut porter du script).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-branding', 'org-branding', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists org_branding_member_select on storage.objects;
create policy org_branding_member_select on storage.objects for select to authenticated
using (
  bucket_id = 'org-branding'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists org_branding_admin_insert on storage.objects;
create policy org_branding_admin_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'org-branding'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid() and om.role = 'org_admin'
  )
);

drop policy if exists org_branding_admin_update on storage.objects;
create policy org_branding_admin_update on storage.objects for update to authenticated
using (
  bucket_id = 'org-branding'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid() and om.role = 'org_admin'
  )
)
with check (
  bucket_id = 'org-branding'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid() and om.role = 'org_admin'
  )
);

drop policy if exists org_branding_admin_delete on storage.objects;
create policy org_branding_admin_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'org-branding'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid() and om.role = 'org_admin'
  )
);
