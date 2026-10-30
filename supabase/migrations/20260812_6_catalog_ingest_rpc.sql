-- supabase/migrations/20260812_6_catalog_ingest_rpc.sql
-- ============================================================================
-- Ingestion FAB-DIS : identite des produits + RPC de chargement par lot.
-- Implemente l'algorithme d'UPSERT de la section 4 du cahier des charges.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Identite d'un produit
-- ---------------------------------------------------------------------------
-- `gtin` est unique mais NULLABLE : tous les articles fabricant n'en ont pas.
-- En base, NULL <> NULL, donc cette contrainte seule laisse passer autant de
-- doublons que de re-imports pour les articles sans GTIN. La seconde identite
-- d'un produit est le couple (marque, reference fabricant) — c'est elle qui
-- rend l'ingestion rejouable.
--
-- COALESCE(brand_id, 0) : sans marque renseignee, un index nu retomberait sur
-- le meme trou (NULL <> NULL) et laisserait a nouveau passer les doublons.
create unique index if not exists uniq_products_brand_ref
  on catalog.products (coalesce(brand_id, 0), manufacturer_ref);

-- ---------------------------------------------------------------------------
-- 2. RPC d'ingestion par lot
-- ---------------------------------------------------------------------------
create or replace function public.catalog_ingest_batch(
  p_products    jsonb,
  p_relations   jsonb default '[]'::jsonb,
  p_source_name text default null,
  p_source_file text default null
)
returns jsonb
language plpgsql
security definer
set search_path = catalog, public
as $$
declare
  v_item        jsonb;
  v_brand_id    bigint;
  v_product_id  bigint;
  v_gtin        text;
  v_ref         text;
  v_old_hash    text;
  v_new_hash    text;
  v_last_price  numeric(10,2);
  v_new_price   numeric(10,2);

  v_inserted    int := 0;
  v_updated     int := 0;
  v_prices      int := 0;
  v_embed_reset int := 0;
  v_relations   int := 0;
  v_rel_skipped int := 0;
  v_warnings    jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_products) <> 'array' then
    raise exception 'p_products doit etre un tableau JSON' using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------- produits
  for v_item in select * from jsonb_array_elements(p_products)
  loop
    v_ref := nullif(trim(v_item->>'manufacturer_ref'), '');
    if v_ref is null then
      v_warnings := v_warnings || to_jsonb('produit sans reference fabricant, ignore'::text);
      continue;
    end if;

    v_gtin := nullif(trim(v_item->>'gtin'), '');

    -- Marque : creee au besoin, jamais dupliquee.
    v_brand_id := null;
    if nullif(trim(v_item->>'brand_code'), '') is not null then
      insert into catalog.brands (brand_code, name)
      values (trim(v_item->>'brand_code'),
              coalesce(nullif(trim(v_item->>'brand_name'), ''), trim(v_item->>'brand_code')))
      on conflict (brand_code) do update set name = catalog.brands.name
      returning id into v_brand_id;
    end if;

    -- Le produit est cherche d'abord par GTIN (identite forte), puis par
    -- (marque, reference) : un fabricant peut ajouter un GTIN a un article
    -- qui n'en avait pas, et ce n'est pas un nouveau produit.
    v_product_id := null;
    if v_gtin is not null then
      select id into v_product_id from catalog.products where gtin = v_gtin;
    end if;
    if v_product_id is null then
      select id into v_product_id
      from catalog.products
      where coalesce(brand_id, 0) = coalesce(v_brand_id, 0)
        and manufacturer_ref = v_ref;
    end if;

    v_new_hash := nullif(v_item->>'ai_description_hash', '');

    if v_product_id is null then
      insert into catalog.products (
        gtin, brand_id, manufacturer_ref, label, description_text, unit,
        etim_class_code, etim_class_label, etim_features,
        technical_pdf_url, installation_manual_url, media,
        ai_description, ai_description_hash,
        source_name, source_file, imported_at
      ) values (
        v_gtin, v_brand_id, v_ref,
        left(coalesce(nullif(trim(v_item->>'label'), ''), v_ref), 255),
        nullif(v_item->>'description_text', ''),
        coalesce(nullif(v_item->>'unit', ''), 'PCE'),
        nullif(v_item->>'etim_class_code', ''),
        nullif(v_item->>'etim_class_label', ''),
        coalesce(v_item->'etim_features', '{}'::jsonb),
        nullif(v_item->>'technical_pdf_url', ''),
        nullif(v_item->>'installation_manual_url', ''),
        coalesce(v_item->'media', '{}'::jsonb),
        nullif(v_item->>'ai_description', ''),
        v_new_hash,
        p_source_name, p_source_file, now()
      )
      returning id into v_product_id;

      v_inserted := v_inserted + 1;

    else
      select ai_description_hash into v_old_hash
      from catalog.products where id = v_product_id;

      update catalog.products set
        gtin                    = coalesce(v_gtin, gtin),
        brand_id                = coalesce(v_brand_id, brand_id),
        label                   = left(coalesce(nullif(trim(v_item->>'label'), ''), label), 255),
        description_text        = coalesce(nullif(v_item->>'description_text', ''), description_text),
        unit                    = coalesce(nullif(v_item->>'unit', ''), unit),
        etim_class_code         = coalesce(nullif(v_item->>'etim_class_code', ''), etim_class_code),
        etim_class_label        = coalesce(nullif(v_item->>'etim_class_label', ''), etim_class_label),
        etim_features           = coalesce(v_item->'etim_features', etim_features),
        technical_pdf_url       = coalesce(nullif(v_item->>'technical_pdf_url', ''), technical_pdf_url),
        installation_manual_url = coalesce(nullif(v_item->>'installation_manual_url', ''), installation_manual_url),
        media                   = coalesce(v_item->'media', media),
        ai_description          = coalesce(nullif(v_item->>'ai_description', ''), ai_description),
        ai_description_hash     = coalesce(v_new_hash, ai_description_hash),
        is_active               = true,
        source_name             = coalesce(p_source_name, source_name),
        source_file             = coalesce(p_source_file, source_file),
        imported_at             = now(),
        -- Coeur de la section 4 : le vecteur n'est efface (donc a recalculer)
        -- que si le TEXTE technique a change. Un tarif qui bouge seul laisse
        -- l'empreinte intacte et ne coute aucun appel API.
        embedding               = case
                                    when v_new_hash is not null
                                     and v_new_hash is distinct from v_old_hash
                                    then null
                                    else embedding
                                  end
      where id = v_product_id;

      v_updated := v_updated + 1;
      if v_new_hash is not null and v_new_hash is distinct from v_old_hash then
        v_embed_reset := v_embed_reset + 1;
      end if;
    end if;

    -- ------------------------------------------------------------- prix
    -- Table d'historique : une ligne n'est ajoutee que si le tarif a change,
    -- sinon chaque import nocturne empilerait un doublon quotidien.
    v_new_price := nullif(v_item->>'public_price_ht', '')::numeric(10,2);
    if v_new_price is not null then
      select public_price_ht into v_last_price
      from catalog.product_prices
      where product_id = v_product_id
      order by valid_from desc
      limit 1;

      if v_last_price is null or v_last_price <> v_new_price then
        insert into catalog.product_prices (product_id, public_price_ht, currency)
        values (v_product_id, v_new_price, coalesce(nullif(v_item->>'currency', ''), 'EUR'));
        v_prices := v_prices + 1;
      end if;
    end if;
  end loop;

  -- --------------------------------------------------------------- relations
  for v_item in select * from jsonb_array_elements(coalesce(p_relations, '[]'::jsonb))
  loop
    -- Les deux extremites doivent exister : une relation vers un produit absent
    -- violerait la FK et ferait echouer tout le lot. On la compte et on avance.
    if not exists (select 1 from catalog.products where gtin = v_item->>'parent_gtin')
       or not exists (select 1 from catalog.products where gtin = v_item->>'child_gtin') then
      v_rel_skipped := v_rel_skipped + 1;
      continue;
    end if;

    insert into catalog.product_relations (parent_gtin, child_gtin, relation_type, quantity_required)
    values (
      v_item->>'parent_gtin',
      v_item->>'child_gtin',
      v_item->>'relation_type',
      coalesce(nullif(v_item->>'quantity_required', '')::int, 1)
    )
    on conflict (parent_gtin, child_gtin, relation_type)
      do update set quantity_required = excluded.quantity_required;

    v_relations := v_relations + 1;
  end loop;

  return jsonb_build_object(
    'products_inserted',      v_inserted,
    'products_updated',       v_updated,
    'prices_added',           v_prices,
    'embeddings_invalidated', v_embed_reset,
    'relations_upserted',     v_relations,
    'relations_skipped',      v_rel_skipped,
    'warnings',               v_warnings
  );
end $$;

comment on function public.catalog_ingest_batch(jsonb, jsonb, text, text) is
  'Ingestion FAB-DIS par lot (section 4). Idempotente : rejouer le meme fichier '
  'n''ajoute ni produit, ni ligne de prix, ni relation. service_role uniquement.';

-- ---------------------------------------------------------------------------
-- 3. Privileges
-- ---------------------------------------------------------------------------
-- La fonction ecrit dans un referentiel partage a partir d'un payload arbitraire,
-- sans rien deriver de auth.uid() : elle ne doit etre appelable ni par le
-- frontend, ni a plus forte raison par anon. PUBLIC est revoque explicitement —
-- PostgreSQL accorde EXECUTE a PUBLIC par defaut, et un REVOKE limite a anon
-- reussirait sans rien retirer.
revoke execute on function public.catalog_ingest_batch(jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.catalog_ingest_batch(jsonb, jsonb, text, text)
  to service_role;
