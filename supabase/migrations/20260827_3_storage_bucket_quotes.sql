-- supabase/migrations/20260827_3_storage_bucket_quotes.sql
-- ============================================================================
-- Bucket Storage `quotes` — CRÉATION (et non rétablissement).
--
-- `src/shared/services/devis.service.js` appelle `supabase.storage.from('quotes')`
-- depuis le commit 98d50d1 du 2026-03-24 : `uploadQuotePdf` (path
-- `${orgId}/${quoteId}.pdf`) et `getQuotePdfUrl`. Deux appelants vivants dans
-- `DevisModal.jsx`, monté par le pipeline (`LeadModal`) et par la fiche client
-- (`TabContrat`) — le bouton « Générer PDF » est inconditionnel.
--
-- Or le bucket n'existe NI sur le projet courant (ejqqqwudmizqisdkxohw) NI sur
-- l'ancien (odspcxgafcqxjzrarsqf), vérifié le 2026-08-27. Ce n'est donc PAS une
-- régression du cutover comme l'était `certificats` (20260827_1) : il n'a jamais
-- existé, et « Générer PDF » sur un devis natif échoue depuis ~5 mois.
--
-- Aucun PDF n'a été perdu. `quotes.quote_pdf_path` n'a qu'un seul écrivain —
-- `saveQuotePdfPath`, appelé par `uploadQuotePdf` APRÈS un upload réussi — donc
-- il est resté NULL partout, et le bouton de téléchargement, conditionné à ce
-- champ, n'a jamais pu s'afficher. Contrairement à `certificats`, l'échec était
-- VISIBLE (toast d'erreur) et n'a corrompu aucune donnée en base.
--
-- Définition alignée sur `contracts` / `certificats` : bucket privé, 10 Mo,
-- org_id en 1er segment de path comparé en uuid. Restreint à `application/pdf`,
-- seul type que ce flux écrit (`uploadQuotePdf` force ce contentType) — là où
-- `contracts` accepte aussi png/jpeg pour des pièces jointes qu'il ne produit pas.
--
-- L'org_id du path vient de `useAuth().organization.id`, soit l'org CORE, celle
-- que comparent les policies : pas de piège org core (3c68…) vs org majordhome
-- (7825…) ici.
--
-- Idempotent : rejouable sans effet de bord.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quotes', 'quotes', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Policies — path `${orgId}/${quoteId}.pdf`
-- ---------------------------------------------------------------------------
drop policy if exists quotes_org_select on storage.objects;
create policy quotes_org_select on storage.objects for select to authenticated
using (
  bucket_id = 'quotes'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists quotes_org_insert on storage.objects;
create policy quotes_org_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'quotes'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

-- UPDATE requis : `uploadQuotePdf` uploade en `upsert: true` (regénérer le PDF
-- d'un devis écrase l'objet existant au même path).
drop policy if exists quotes_org_update on storage.objects;
create policy quotes_org_update on storage.objects for update to authenticated
using (
  bucket_id = 'quotes'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'quotes'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

drop policy if exists quotes_org_delete on storage.objects;
create policy quotes_org_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'quotes'
  and ((storage.foldername(name))[1])::uuid in (
    select om.org_id from core.organization_members om where om.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- 3. Contrôle : le bucket existe et porte bien ses 4 policies.
--    Le filtre `like '%quotes%'` ne peut pas confondre avec un autre bucket :
--    aucun des 7 autres (contracts, interventions, product-documents,
--    product-images, project-recordings, technical-visits, certificats) ne
--    contient cette sous-chaîne.
-- ---------------------------------------------------------------------------
do $$
declare
  n_buckets  int;
  n_policies int;
begin
  select count(*) into n_buckets from storage.buckets where id = 'quotes';

  select count(*) into n_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual,'') || coalesce(with_check,'')) like '%quotes%';

  raise notice 'storage quotes : % bucket, % policies', n_buckets, n_policies;

  if n_buckets <> 1 then
    raise exception 'bucket quotes absent';
  end if;
  if n_policies <> 4 then
    raise exception 'bucket quotes : % policies au lieu de 4', n_policies;
  end if;
end $$;
