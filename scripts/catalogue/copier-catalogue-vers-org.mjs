// ============================================================================
// Copie le catalogue d'un ou plusieurs fournisseurs d'une organisation vers une autre :
// fiche fournisseur, lignes fournisseur, articles Majord'home, appareils du fabricant
// (equipment_models), leur nomenclature (equipment_model_parts), leurs documents relevés
// (equipment_documents) et les fichiers Storage qu'ils citent (copie côté serveur).
//
// Première utilisation : INVICTA et DINAK de Mayer vers Cimaj (demande de Cimaj, Eric 2026-11-28).
//
// Ce qui NE part PAS (décision d'Eric) : les prix d'achat et remises de l'organisation source
// (purchase_price_ht = 0, taux_remise et purchase_price_at vides, `connector_config.pieces.remise_pct`
// retiré) ; ni contacts, ni compte client, ni notes, ni liens Pennylane ou plan comptable, ni
// références internes d'article (`code`), ni rattachement d'un appareil à un type d'équipement.
//
// Tout ou rien : la copie en base est UNE requête (une transaction) ; elle refuse si la destination
// a déjà un fournisseur du même nom. Les fichiers sont copiés ensuite, un par un, sans doublon
// (un fichier déjà présent est compté « déjà là ») : relancer avec --fichiers-seulement complète.
//
// Usage :
//   node scripts/catalogue/copier-catalogue-vers-org.mjs --de <org core> --vers <org core> --fournisseurs INVICTA,DINAK --essai
//   node scripts/catalogue/copier-catalogue-vers-org.mjs --de <org core> --vers <org core> --fournisseurs INVICTA,DINAK
//   node scripts/catalogue/copier-catalogue-vers-org.mjs --de … --vers … --fournisseurs … --fichiers-seulement
// --essai : la copie en base est jouée puis annulée (compteurs dans le message), aucun fichier copié.
// Fichier d'environnement : --env (défaut .env.local) avec DST_URL, DST_KEY (service_role), SUPABASE_ACCESS_TOKEN.
// ============================================================================
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REF = 'ejqqqwudmizqisdkxohw';
const BUCKET = 'product-documents';
const CONCURRENCE = 4;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const drapeau = (k) => args.includes(k);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DE = opt('--de');
const VERS = opt('--vers');
const NOMS = String(opt('--fournisseurs', '')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const ESSAI = drapeau('--essai');
const FICHIERS_SEULEMENT = drapeau('--fichiers-seulement');
if (!UUID.test(DE || '') || !UUID.test(VERS || '') || DE === VERS || !NOMS.length) {
  console.error('Usage : --de <org core> --vers <org core> --fournisseurs NOM1,NOM2 [--essai | --fichiers-seulement]');
  process.exit(2);
}
if (NOMS.some((n) => !/^[A-Z0-9 &'.\-/]+$/.test(n))) { console.error('Nom de fournisseur inattendu'); process.exit(2); }

const env = Object.fromEntries(readFileSync(opt('--env', '.env.local'), 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const { DST_URL, DST_KEY, SUPABASE_ACCESS_TOKEN } = env;
if (!DST_URL || !DST_KEY || !SUPABASE_ACCESS_TOKEN) { console.error('DST_URL, DST_KEY et SUPABASE_ACCESS_TOKEN requis'); process.exit(2); }
if (!DST_URL.includes(REF)) { console.error(`DST_URL ne pointe pas sur le projet ${REF}`); process.exit(2); }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`SQL HTTP ${r.status} : ${JSON.stringify(body).slice(0, 800)}`);
  return body;
}

const src = `'${DE}'::uuid`;
const dst = `'${VERS}'::uuid`;
const noms = `array[${NOMS.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')}]`;
// Préfixe des chemins Storage : `<org>/`. Seuls les chemins sont réécrits (jamais un autre texte).
const re = (expr) => `replace(${expr}, '${DE}/', '${VERS}/')`;

const COMPTEURS = `
  'fournisseurs', (select count(*) from majordhome.suppliers where id in (select new_id from cp_sup)),
  'lignes', (select count(*) from majordhome.supplier_products where id in (select new_id from cp_prod)),
  'lignes_source', (select count(*) from cp_prod),
  'articles', (select count(*) from majordhome.catalog_items where id in (select new_id from cp_art)),
  'articles_source', (select count(*) from cp_art),
  'appareils', (select count(*) from majordhome.equipment_models where id in (select new_id from cp_mod)),
  'appareils_source', (select count(*) from cp_mod),
  'nomenclature', (select count(*) from majordhome.equipment_model_parts where equipment_model_id in (select new_id from cp_mod)),
  'nomenclature_source', (select count(*) from majordhome.equipment_model_parts where equipment_model_id in (select old_id from cp_mod)),
  'documents', (select count(*) from majordhome.equipment_documents where equipment_model_id in (select new_id from cp_mod)),
  'documents_source', (select count(*) from majordhome.equipment_documents where equipment_model_id in (select old_id from cp_mod)),
  'documents_articles', (select count(*) from majordhome.product_documents where catalog_item_id in (select new_id from cp_art)),
  'achats_non_nuls', (select count(*) from majordhome.supplier_products where id in (select new_id from cp_prod) and (purchase_price_ht <> 0 or taux_remise is not null)),
  'chemins_source_restants', (select count(*) from majordhome.equipment_models where id in (select new_id from cp_mod)
      and (photo_path like '${DE}/%' or exploded_views::text like '%${DE}/%' or source::text like '%${DE}/%'))
    + (select count(*) from majordhome.equipment_documents where equipment_model_id in (select new_id from cp_mod) and storage_path like '${DE}/%')`;

const COPIE = `
create temp table cp_sup on commit drop as
  select s.id old_id, gen_random_uuid() new_id from majordhome.suppliers s where s.org_id = ${src} and upper(s.name) = any(${noms});
do $$ begin
  if (select count(*) from cp_sup) <> ${NOMS.length} then raise exception 'fournisseurs_introuvables : % trouvé(s) sur ${NOMS.length}', (select count(*) from cp_sup); end if;
  if exists (select 1 from majordhome.suppliers d where d.org_id = ${dst} and upper(d.name) = any(${noms})) then
    raise exception 'deja_present : la destination a déjà un fournisseur de ce nom';
  end if;
end $$;

insert into majordhome.suppliers (id, org_id, name, address, postal_code, city, siret, is_active, connector_config, category_mapping, auto_sync)
select c.new_id, ${dst}, s.name, s.address, s.postal_code, s.city, s.siret, s.is_active,
  case when jsonb_typeof(s.connector_config -> 'pieces') = 'object'
       then jsonb_build_object('pieces', (s.connector_config -> 'pieces') - 'remise_pct') else '{}'::jsonb end,
  s.category_mapping, false
from majordhome.suppliers s join cp_sup c on c.old_id = s.id;

create temp table cp_prod on commit drop as
  select p.id old_id, gen_random_uuid() new_id from majordhome.supplier_products p where p.supplier_id in (select old_id from cp_sup);
create temp table cp_art on commit drop as
  select x.old_id, gen_random_uuid() new_id from (
    select distinct p.catalog_item_id old_id from majordhome.supplier_products p
    where p.supplier_id in (select old_id from cp_sup) and p.catalog_item_id is not null) x;
create temp table cp_mod on commit drop as
  select m.id old_id, gen_random_uuid() new_id from majordhome.equipment_models m
  where m.org_id = ${src} and m.supplier_id in (select old_id from cp_sup);
create index on cp_prod (old_id); create index on cp_art (old_id); create index on cp_mod (old_id);
analyze cp_sup; analyze cp_prod; analyze cp_art; analyze cp_mod;

insert into majordhome.catalog_items (id, org_id, name, brand, model_key, code_ean, category, gamme, product_kind, unit,
  default_tva_rate, selling_price_ht, description, image_url, specs, is_active, origin)
select a.new_id, ${dst}, c.name, c.brand, c.model_key, c.code_ean, c.category, c.gamme, c.product_kind, c.unit,
  c.default_tva_rate, c.selling_price_ht, c.description, c.image_url, c.specs, c.is_active, c.origin
from majordhome.catalog_items c join cp_art a on a.old_id = c.id;

insert into majordhome.supplier_products (id, supplier_id, org_id, reference, name, description, category,
  purchase_price_ht, selling_price_ht, default_tva_rate, unit, is_active, code_famille, gamme, code_ean, tarif_public,
  taux_remise, diametre, fuel_type, brand, variant_label, image_url, image_source_url, specs, client_visible, product_kind,
  model_key, model_key_source, catalog_item_id, catalog_item_link_source, catalog_item_linked_at, purchase_price_at)
select cp.new_id, cs.new_id, ${dst}, p.reference, p.name, p.description, p.category,
  0, p.selling_price_ht, p.default_tva_rate, p.unit, p.is_active, p.code_famille, p.gamme, p.code_ean, p.tarif_public,
  null, p.diametre, p.fuel_type, p.brand, p.variant_label, p.image_url, p.image_source_url, p.specs, p.client_visible, p.product_kind,
  p.model_key, p.model_key_source, ca.new_id, p.catalog_item_link_source, case when ca.new_id is not null then now() end, null
from majordhome.supplier_products p
join cp_prod cp on cp.old_id = p.id
join cp_sup cs on cs.old_id = p.supplier_id
left join cp_art ca on ca.old_id = p.catalog_item_id;

update majordhome.catalog_items n set source_product_id = cp.new_id
from majordhome.catalog_items o join cp_art a on a.old_id = o.id join cp_prod cp on cp.old_id = o.source_product_id
where n.id = a.new_id;

insert into majordhome.equipment_models (id, org_id, supplier_id, brand, brand_key, source_id, reference, reference_key, name,
  model_name, model_name_key, category, lifecycle, photo_path, exploded_views, source, is_active, origin, review_status, specs, source_urls)
select cm.new_id, ${dst}, cs.new_id, m.brand, m.brand_key, m.source_id, m.reference, m.reference_key, m.name,
  m.model_name, m.model_name_key, m.category, m.lifecycle, ${re('m.photo_path')}, ${re('m.exploded_views::text')}::jsonb,
  ${re('m.source::text')}::jsonb, m.is_active, m.origin, m.review_status, m.specs, m.source_urls
from majordhome.equipment_models m join cp_mod cm on cm.old_id = m.id join cp_sup cs on cs.old_id = m.supplier_id;

insert into majordhome.equipment_model_parts (org_id, equipment_model_id, position, repere, supplier_product_id, quantity, notes, public_price_ht)
select ${dst}, cm.new_id, mp.position, mp.repere, cp.new_id, mp.quantity, mp.notes, mp.public_price_ht
from majordhome.equipment_model_parts mp join cp_mod cm on cm.old_id = mp.equipment_model_id join cp_prod cp on cp.old_id = mp.supplier_product_id;

insert into majordhome.equipment_documents (org_id, brand, model, brand_key, model_key, document_type, label, file_name,
  storage_path, file_size, mime_type, equipment_model_id, source, scope)
select ${dst}, d.brand, d.model, d.brand_key, d.model_key, d.document_type, d.label, d.file_name,
  ${re('d.storage_path')}, d.file_size, d.mime_type, cm.new_id, d.source, d.scope
from majordhome.equipment_documents d join cp_mod cm on cm.old_id = d.equipment_model_id;

insert into majordhome.product_documents (org_id, catalog_item_id, document_type, file_name, storage_path, file_size, mime_type)
select ${dst}, a.new_id, d.document_type, d.file_name,
  '${VERS}/articles/' || a.new_id || '/' || regexp_replace(d.storage_path, '^.*/', ''), d.file_size, d.mime_type
from majordhome.product_documents d join cp_art a on a.old_id = d.catalog_item_id
where d.org_id = ${src} and d.supplier_product_id is null;
`;

// Paires de fichiers à copier, relues en base après la copie (même calcul en mode --fichiers-seulement).
const PAIRES = `
with sup as (select id from majordhome.suppliers where org_id = ${dst} and upper(name) = any(${noms})),
mods as (select * from majordhome.equipment_models where org_id = ${dst} and supplier_id in (select id from sup)),
site as (
  select photo_path p from mods where photo_path is not null
  union select v ->> 'path' from mods, jsonb_array_elements(exploded_views) v where v ->> 'path' is not null
  union select d.storage_path from majordhome.equipment_documents d where d.equipment_model_id in (select id from mods)
),
arts as (select distinct catalog_item_id id from majordhome.supplier_products where supplier_id in (select id from sup) and catalog_item_id is not null)
select replace(p, '${VERS}/', '${DE}/') de, p vers from site where p like '${VERS}/%'
union
select o.storage_path, n.storage_path from majordhome.product_documents n
join majordhome.product_documents o on o.org_id = ${src} and regexp_replace(o.storage_path, '^.*/', '') = regexp_replace(n.storage_path, '^.*/', '')
where n.org_id = ${dst} and n.catalog_item_id in (select id from arts);`;

if (ESSAI) {
  const q = `begin;\n${COPIE}\ndo $$ begin raise exception 'ESSAI_ANNULE %', (select jsonb_build_object(${COMPTEURS})::text); end $$;`;
  try { await sql(q); console.error('Essai : la requête aurait dû être annulée et ne l\'a pas été'); process.exit(1); }
  catch (e) {
    const m = String(e.message).match(/ESSAI_ANNULE (\{.*?\})/);
    if (!m) { console.error(e.message); process.exit(1); }
    console.log('Essai (rien n\'est écrit) :', JSON.parse(m[1].replace(/\\"/g, '"')));
  }
  process.exit(0);
}

if (!FICHIERS_SEULEMENT) {
  const t0 = Date.now();
  const res = await sql(`begin;\n${COPIE}\ncreate temp table cp_bilan as select jsonb_build_object(${COMPTEURS}) b;\ncommit;\nselect b from cp_bilan;`);
  console.log(`Copie en base faite en ${((Date.now() - t0) / 1000).toFixed(1)} s :`, res?.[0]?.b ?? res);
}

const paires = await sql(PAIRES);
console.log(`${paires.length} fichiers à copier`);
const storage = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } }).storage.from(BUCKET);
const compte = { copies: 0, deja: 0, echecs: [] };
for (let i = 0; i < paires.length; i += CONCURRENCE) {
  await Promise.all(paires.slice(i, i + CONCURRENCE).map(async ({ de, vers }) => {
    const { error } = await storage.copy(de, vers);
    if (!error) compte.copies += 1;
    else if (/already exists|duplicate/i.test(error.message)) compte.deja += 1;
    else compte.echecs.push(`${de} : ${error.message}`);
  }));
  if ((i / CONCURRENCE) % 25 === 24) console.log(`  … ${Math.min(i + CONCURRENCE, paires.length)} / ${paires.length}`);
}
console.log(`Fichiers : ${compte.copies} copiés, ${compte.deja} déjà là, ${compte.echecs.length} en échec`);
if (compte.echecs.length) { console.log(compte.echecs.slice(0, 20).join('\n')); process.exit(1); }
