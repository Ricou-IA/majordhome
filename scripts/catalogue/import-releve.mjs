// ============================================================================
// Import d'un relevé fournisseur dans le catalogue majordhome.supplier_products.
// scripts/catalogue/data/<fichier>.json → SQL REJOUABLE dans scripts/catalogue/out/, qui appelle l'ÉCRIVAIN UNIQUE
// public.supplier_catalog_upsert (migrations 20261024_2 / _5 / 20261025_2) :
//   - libellé, prix de vente, catégorie, nature, marque, gamme posés à l'INSERT seulement (une correction du drawer
//     survit au ré-import) ; prix de vente par défaut (tarif public Tesla HT) ré-appliqué si l'article est encore à 0 ;
//   - article absent du relevé ⇒ is_active = false (marqué desactive_par_releve), jamais supprimé ; relevé incomplet
//     ou vide ⇒ refus ; photo posée si absente ; clé modèle recalculée (sauf saisie manuelle).
// La transformation relevé → lignes est l'adaptateur PUR de la PLATEFORME du fournisseur
// (src/lib/catalogue/suitecommerce.js | woocommerce.js, même code que l'edge supplier-catalog-sync), avec la
// correspondance des catégories `category_mapping` du fournisseur lue en base.
//
// Usage : node scripts/catalogue/import-releve.mjs --fournisseur "BAYWA R.E." --fichier scripts/catalogue/data/baywa-2026-10.json
//           [--org 3c68193e-…] [--version baywa_2026-10] [--plateforme suitecommerce|woocommerce] [--env .env.local]
//   --plateforme / --site : seulement pour un fournisseur pas encore créé en base (il est alors inséré).
//   puis : node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/catalogue/out/<version>.sql
// Relevé : scripts/catalogue/dump-<plateforme>.browser.js (console du navigateur connecté au site du fournisseur).
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articlesDepuisReleveSuitecommerce } from '../../src/lib/catalogue/suitecommerce.js';
import { articlesDepuisReleveWoocommerce } from '../../src/lib/catalogue/woocommerce.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const ADAPTATEURS = { suitecommerce: articlesDepuisReleveSuitecommerce, woocommerce: articlesDepuisReleveWoocommerce };
const PROJET = 'ejqqqwudmizqisdkxohw';

const nom = opt('--fournisseur');
const fichier = opt('--fichier');
if (!nom || !fichier) { console.error('--fournisseur "<nom en base>" et --fichier <relevé JSON> requis'); process.exit(2); }
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const VERSION = opt('--version', path.basename(fichier).replace(/\.json$/, '').replace(/-(\d{4}-\d{2})/, '_$1'));

/** Lecture de la ligne fournisseur en prod via l'API de management (SUPABASE_ACCESS_TOKEN de --env). */
async function lireFournisseur() {
  const envFichier = path.resolve(racine, opt('--env', '.env.local'));
  const env = Object.fromEntries(readFileSync(envFichier, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
  if (!env.SUPABASE_ACCESS_TOKEN) throw new Error(`SUPABASE_ACCESS_TOKEN absent de ${envFichier}`);
  const query = `select id, connector, site_url, category_mapping from majordhome.suppliers where org_id = '${ORG}' and name = '${nom.replace(/'/g, "''")}'`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJET}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const rows = await r.json();
  if (!r.ok || !Array.isArray(rows)) throw new Error(`lecture fournisseur : HTTP ${r.status} ${JSON.stringify(rows).slice(0, 300)}`);
  return rows[0] || null;
}

const fournisseur = await lireFournisseur();
const plateforme = fournisseur?.connector || opt('--plateforme');
const adaptateur = ADAPTATEURS[plateforme];
if (!adaptateur) {
  console.error(fournisseur ? `Fournisseur « ${nom} » sans plateforme connue (connector = ${fournisseur.connector})` : `Fournisseur « ${nom} » inconnu en base : passer --plateforme suitecommerce|woocommerce et --site <url>`);
  process.exit(2);
}

const releve = JSON.parse(readFileSync(path.resolve(racine, fichier), 'utf8'));
const { lignes, retenus, exclus, releve_at, categories_vues } = adaptateur(releve, { version: VERSION, mapping: fournisseur?.category_mapping || null });
const totalExclus = Object.values(exclus).reduce((a, b) => a + b, 0);
if (retenus + totalExclus !== releve.items.length) {
  throw new Error(`Décompte incohérent : ${retenus} retenus + ${totalExclus} exclus ≠ ${releve.items.length} articles`);
}
if (!retenus) throw new Error('Aucun article retenu : relevé vide ou tout exclu par la correspondance');

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const rows = JSON.stringify(lignes);
const meta = JSON.stringify({ categories_vues });
if (rows.includes('$rows$') || meta.includes('$meta$')) throw new Error('Balise $rows$/$meta$ présente dans les données');

const site = fournisseur?.site_url || opt('--site') || null;
const sql = `-- Import relevé ${VERSION} — ${retenus} articles retenus (${JSON.stringify(exclus)} exclus), fournisseur « ${nom} » (${plateforme}),
-- relevé du ${releve_at}. Rejouable. Généré par scripts/catalogue/import-releve.mjs ; ne jamais éditer à la main.
DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid; v_res jsonb;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(nom)};
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, connector, site_url, is_active)
    VALUES (v_org, ${q(nom)}, ${q(plateforme)}, ${q(site)}, true) RETURNING id INTO v_sup;
  END IF;
  v_res := public.supplier_catalog_upsert(v_org, v_sup, ${q(VERSION)}, $rows$${rows}$rows$::jsonb, $meta$${meta}$meta$::jsonb);
  RAISE NOTICE 'supplier_catalog_upsert ${VERSION} : %', v_res;
END $$;
`;

const OUT = path.join(racine, 'scripts', 'catalogue', 'out');
mkdirSync(OUT, { recursive: true });
const sortie = path.join(OUT, `${VERSION}.sql`);
writeFileSync(sortie, sql, 'utf8');

const parCategorie = {};
for (const l of lignes) parCategorie[`${l.category} · ${l.gamme}`] = (parCategorie[`${l.category} · ${l.gamme}`] || 0) + 1;
console.log(`${nom} (${plateforme}) — relevé du ${releve_at} : ${retenus} articles retenus, exclus ${JSON.stringify(exclus)}, ${categories_vues.length} catégories du site → ${path.relative(racine, sortie)}`);
console.table(parCategorie);
