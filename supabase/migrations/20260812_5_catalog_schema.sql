-- supabase/migrations/20260812_5_catalog_schema.sql
-- ============================================================================
-- Socle du referentiel produit fabricant (Arpet.ai / Majord'home) — 2026-08-12.
--
-- Implemente la section 3 du cahier des charges (schema PostgreSQL + pgvector).
--
-- POURQUOI UN SCHEMA DEDIE, NON SCOPE PAR ORG
-- -------------------------------------------
-- Une PAC Atlantic 8 kW n'appartient a aucun artisan : c'est une donnee de
-- reference, mutualisee entre toutes les organisations. Ces tables n'ont donc
-- volontairement PAS de colonne org_id, contrairement a la regle qui vaut pour
-- tout `majordhome.*`. Ce n'est pas un oubli — c'est la nature de la donnee.
-- La contrepartie multi-tenant est stricte :
--   * lecture  : ouverte a `authenticated` (tout membre connecte), jamais anon
--   * ecriture : AUCUNE policy → seul `service_role` ecrit, via le pipeline ETL
-- Ce qui est propre a un artisan (prix negocie, remise, compte comptable) reste
-- dans `majordhome.supplier_products` et se relie ici par le GTIN.
--
-- ECARTS ASSUMES AU DOCUMENT (section 3), et leurs raisons
-- -------------------------------------------------------
--  1. `products.etim_features jsonb` — le document recupere les couples EF/EV
--     via l'API ETIM (section 2.2) mais ne prevoit aucune colonne pour les
--     stocker : toute la richesse technique serait perdue apres traduction.
--  2. `products.media jsonb` — le document ne garde que 2 URLs de B04_MEDIA ;
--     l'onglet en porte davantage (visuels HD, DoP, certificats CE).
--  3. `products.ai_description_hash` — la section 4 exige de ne PAS recalculer
--     l'embedding sur un simple changement de prix (« cout API IA : 0 EUR »).
--     Sans empreinte du texte source, ce test est impossible a faire.
--  4. `products.source_*` — tracabilite de l'ingestion (quel fichier, quand),
--     indispensable a un batch nocturne rejouable.
--  5. `id` en `bigint generated always as identity` plutot que `SERIAL`
--     (equivalent, forme non depreciee).
--
-- Idempotent : rejouable sans effet de bord.
-- ============================================================================

create schema if not exists catalog;

comment on schema catalog is
  'Referentiel produit fabricant (FAB-DIS / ETIM), mutualise entre organisations. '
  'Lecture authenticated, ecriture service_role uniquement.';

-- L'extension vector est deja installee sur cette instance, dans `public`.
-- Le type est donc qualifie `public.vector` partout : ne pas dependre du
-- search_path, qui varie selon le role qui execute la migration.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- 1. Marques / fabricants
-- ---------------------------------------------------------------------------
create table if not exists catalog.brands (
  id          bigint generated always as identity primary key,
  brand_code  varchar(50)  not null unique,
  name        varchar(100) not null,
  created_at  timestamptz  not null default now()
);

comment on column catalog.brands.brand_code is
  'Code fabricant stable (issu du FAB-DIS). Cle de rapprochement entre imports.';

-- ---------------------------------------------------------------------------
-- 2. Produits
-- ---------------------------------------------------------------------------
create table if not exists catalog.products (
  id                      bigint generated always as identity primary key,

  -- Identite
  gtin                    varchar(14) unique,
  brand_id                bigint references catalog.brands(id) on delete restrict,
  manufacturer_ref        varchar(100) not null,
  label                   varchar(255) not null,
  description_text        text,
  unit                    varchar(20) not null default 'PCE',

  -- Classification ETIM
  etim_class_code         varchar(50),
  etim_class_label        varchar(255),
  etim_features           jsonb not null default '{}'::jsonb,

  -- Documentation (B04_MEDIA)
  technical_pdf_url       text,
  installation_manual_url text,
  media                   jsonb not null default '{}'::jsonb,

  -- Recherche semantique (Arpet.ai)
  ai_description          text,
  ai_description_hash     text,
  embedding               public.vector(1536),

  -- Cycle de vie et tracabilite
  is_active               boolean not null default true,
  source_name             text,
  source_file             text,
  imported_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on column catalog.products.gtin is
  'Code EAN. Cle metier de rapprochement avec majordhome.supplier_products et '
  'cible des FK de catalog.product_relations. Nullable : certains articles '
  'fabricant n''en ont pas — ils ne peuvent alors pas porter de relation.';
comment on column catalog.products.etim_features is
  'Caracteristiques ETIM traduites : { "EF000008": {"label":"Puissance calorifique", '
  '"value":8, "unit":"kW"} }. Alimente par l''API ETIM a l''ingestion.';
comment on column catalog.products.ai_description_hash is
  'Empreinte du texte ayant servi a calculer `embedding`. Le batch nocturne ne '
  'regenere le vecteur que si cette empreinte change — un changement de prix '
  'seul ne declenche aucun appel API (section 4 du cahier des charges).';

create index if not exists idx_products_brand         on catalog.products(brand_id);
create index if not exists idx_products_etim_class    on catalog.products(etim_class_code);
create index if not exists idx_products_manufacturer  on catalog.products(manufacturer_ref);
create index if not exists idx_products_active        on catalog.products(is_active) where is_active;

-- Index vectoriel HNSW (section 3 du cahier des charges).
create index if not exists idx_products_embedding
  on catalog.products using hnsw (embedding public.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- 3. Historique des prix publics
-- ---------------------------------------------------------------------------
-- Table d'historique : on INSERE une ligne a chaque changement de tarif public,
-- on ne met jamais a jour l'existante. Le prix courant est la ligne la plus
-- recente (cf. vue publique plus bas).
create table if not exists catalog.product_prices (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references catalog.products(id) on delete cascade,
  public_price_ht numeric(10,2) not null,
  currency        varchar(3) not null default 'EUR',
  valid_from      timestamptz not null default now()
);

create index if not exists idx_product_prices_lookup
  on catalog.product_prices(product_id, valid_from desc);

-- ---------------------------------------------------------------------------
-- 4. Relations inter-produits (dependances, compatibilites, substitutions)
-- ---------------------------------------------------------------------------
-- Alimentee par C02_CORRESPONDANCE (accessoires, compatibilites multi-splits)
-- et C06_SUBSTITUTION (obsolescence). C'est la couche 2 du moteur d'assemblage
-- (section 5) : les accessoires obligatoires d'un equipement principal.
create table if not exists catalog.product_relations (
  id                bigint generated always as identity primary key,
  parent_gtin       varchar(14) not null references catalog.products(gtin) on delete cascade,
  child_gtin        varchar(14) not null references catalog.products(gtin) on delete cascade,
  relation_type     varchar(50) not null,
  quantity_required int not null default 1,
  created_at        timestamptz not null default now(),
  constraint unique_relation unique (parent_gtin, child_gtin, relation_type),
  constraint product_relations_type_check
    check (relation_type in ('MANDATORY','OPTIONAL','COMPATIBLE','SUBSTITUTION')),
  constraint product_relations_no_self check (parent_gtin <> child_gtin),
  constraint product_relations_qty_positive check (quantity_required > 0)
);

create index if not exists idx_product_relations_parent on catalog.product_relations(parent_gtin);
create index if not exists idx_product_relations_child  on catalog.product_relations(child_gtin);

-- ---------------------------------------------------------------------------
-- 5. Regles metier et reglementaires
-- ---------------------------------------------------------------------------
-- Couche 3 du moteur d'assemblage (section 5) et couche reglementaire
-- (section 6) : NF C 15-100, eligibilite MaPrimeRenov'/CEE, contraintes DTU.
create table if not exists catalog.business_rules (
  id                 bigint generated always as identity primary key,
  category           varchar(50) not null,
  trigger_etim_class varchar(50),
  condition_json     jsonb,
  action_json        jsonb,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_business_rules_trigger
  on catalog.business_rules(trigger_etim_class) where is_active;

comment on table catalog.business_rules is
  'Regles appliquees par le BACKEND, jamais par le LLM (principe d''isolation, '
  'section 1.2). condition_json ex. {"etas_min":111} ; action_json ex. '
  '{"add_mandatory_gtin":"3410...","warning_text":"..."}.';

-- ---------------------------------------------------------------------------
-- 6. RLS — lecture pour tout membre connecte, ecriture service_role uniquement
-- ---------------------------------------------------------------------------
alter table catalog.brands            enable row level security;
alter table catalog.products          enable row level security;
alter table catalog.product_prices    enable row level security;
alter table catalog.product_relations enable row level security;
alter table catalog.business_rules    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['brands','products','product_prices','product_relations','business_rules']
  loop
    -- Aucune policy d'ecriture n'est creee : `service_role` contourne la RLS,
    -- les utilisateurs front n'ont donc aucun moyen d'ecrire dans le referentiel.
    execute format('drop policy if exists %I on catalog.%I', t || '_select_authenticated', t);
    execute format(
      'create policy %I on catalog.%I for select to authenticated using (true)',
      t || '_select_authenticated', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------
-- `anon` n'a rien a faire ici : le referentiel n'est pas public.
revoke all on all tables in schema catalog from anon;
revoke all on schema catalog from anon;

grant usage on schema catalog to authenticated, service_role;

grant select on catalog.brands, catalog.products, catalog.product_prices,
                catalog.product_relations, catalog.business_rules
  to authenticated, service_role;

-- Les vues publiques ci-dessous sont en security_invoker : sans ce GRANT, les
-- edge functions qui les lisent echouent en 42501 silencieux (regle maison).
grant select on all tables in schema catalog to service_role;

-- ---------------------------------------------------------------------------
-- 8. Vues publiques (le schema `catalog` n'est pas expose via PostgREST)
-- ---------------------------------------------------------------------------
-- `embedding` est volontairement EXCLU : 1536 flottants par ligne rendraient
-- tout SELECT * du frontend inutilisable. La recherche vectorielle se fera par
-- RPC dediee, cote serveur.
create or replace view public.catalog_products
with (security_invoker = true) as
select
  p.id, p.gtin, p.brand_id, b.brand_code, b.name as brand_name,
  p.manufacturer_ref, p.label, p.description_text, p.unit,
  p.etim_class_code, p.etim_class_label, p.etim_features,
  p.technical_pdf_url, p.installation_manual_url, p.media,
  p.ai_description, p.is_active,
  (p.embedding is not null) as has_embedding,
  price.public_price_ht, price.currency, price.valid_from as price_valid_from,
  p.source_name, p.imported_at, p.created_at, p.updated_at
from catalog.products p
left join catalog.brands b on b.id = p.brand_id
left join lateral (
  select pp.public_price_ht, pp.currency, pp.valid_from
  from catalog.product_prices pp
  where pp.product_id = p.id
  order by pp.valid_from desc
  limit 1
) price on true;

comment on view public.catalog_products is
  'Referentiel produit + prix public courant. Lecture seule (LATERAL) : passer '
  'par les RPC d''ingestion pour ecrire.';

create or replace view public.catalog_brands
with (security_invoker = true) as
select b.id, b.brand_code, b.name, b.created_at,
       (select count(*) from catalog.products p where p.brand_id = b.id) as product_count
from catalog.brands b;

create or replace view public.catalog_product_relations
with (security_invoker = true) as
select r.id, r.parent_gtin, r.child_gtin, r.relation_type, r.quantity_required,
       child.label as child_label, child.manufacturer_ref as child_ref,
       r.created_at
from catalog.product_relations r
left join catalog.products child on child.gtin = r.child_gtin;

revoke all on public.catalog_products, public.catalog_brands,
               public.catalog_product_relations from anon;
grant select on public.catalog_products, public.catalog_brands,
                public.catalog_product_relations to authenticated, service_role;
