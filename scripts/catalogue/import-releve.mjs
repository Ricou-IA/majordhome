// ============================================================================
// Import d'un relevé fournisseur (BayWa r.e., Domos Industries) dans le catalogue majordhome.supplier_products.
// scripts/catalogue/data/<fournisseur>-<AAAA-MM>.json → SQL REJOUABLE dans scripts/catalogue/out/, qui crée le
// fournisseur s'il manque puis appelle l'ÉCRIVAIN UNIQUE public.supplier_catalog_upsert (migration 20261024_2) :
//   - libellé et prix de vente posés à l'INSERT seulement (une correction du drawer survit au ré-import) ;
//   - prix de vente par défaut (tarif public Tesla HT) ré-appliqué si l'article est encore à 0 ;
//   - article absent du relevé ⇒ is_active = false, jamais supprimé ; relevé incomplet ou vide ⇒ refus.
// La transformation relevé → lignes est l'adaptateur PUR src/lib/catalogue/<fournisseur>.js (testé sur le relevé
// réel, même code que l'edge supplier-catalog-sync). Relevé : scripts/catalogue/dump-<fournisseur>.browser.js.
//
// Usage : node scripts/catalogue/import-releve.mjs --fournisseur baywa|domos --fichier scripts/catalogue/data/baywa-2026-10.json
//           [--org 3c68193e-…] [--version baywa_2026-10]
//   puis : node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/catalogue/out/<version>.sql
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articlesDepuisReleveBaywa } from '../../src/lib/catalogue/baywa.js';
import { articlesDepuisReleveDomos } from '../../src/lib/catalogue/domos.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

/** Fournisseurs connus : nom en base (UNIQUE (org_id, name)), connecteur, adaptateur. */
const FOURNISSEURS = {
  baywa: { nom: 'BAYWA R.E.', connector: 'baywa', notes: 'Grossiste solaire et stockage (solarshop.baywa-re.fr). Relevé API, cf. scripts/catalogue/dump-baywa.browser.js', adaptateur: articlesDepuisReleveBaywa },
  domos: { nom: 'DOMOS INDUSTRIES', connector: 'domos', notes: 'Grossiste solaire et stockage (webshop.domosindustries.com). Relevé manuel depuis le navigateur (Cloudflare), cf. scripts/catalogue/dump-domos.browser.js', adaptateur: articlesDepuisReleveDomos },
};

const cle = opt('--fournisseur');
const F = FOURNISSEURS[cle];
if (!F) { console.error(`--fournisseur requis : ${Object.keys(FOURNISSEURS).join(' | ')}`); process.exit(2); }
const fichier = opt('--fichier');
if (!fichier) { console.error('--fichier requis (relevé JSON)'); process.exit(2); }
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const VERSION = opt('--version', `${cle}_${path.basename(fichier).replace(/^[a-z]+-/, '').replace(/\.json$/, '')}`);

const releve = JSON.parse(readFileSync(path.resolve(racine, fichier), 'utf8'));
const { lignes, retenus, exclus, releve_at } = F.adaptateur(releve, { version: VERSION });
const totalExclus = Object.values(exclus).reduce((a, b) => a + b, 0);
if (retenus + totalExclus !== releve.items.length) {
  throw new Error(`Décompte incohérent : ${retenus} retenus + ${totalExclus} exclus ≠ ${releve.items.length} articles`);
}
if (!retenus) throw new Error('Aucun article retenu : relevé vide ou périmètre absent');

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const rows = JSON.stringify(lignes);
if (rows.includes('$rows$')) throw new Error('Balise $rows$ présente dans les données');

const sql = `-- Import relevé ${VERSION} — ${retenus} articles retenus (${JSON.stringify(exclus)} exclus), fournisseur « ${F.nom} »,
-- relevé du ${releve_at}. Rejouable. Généré par scripts/catalogue/import-releve.mjs ; ne jamais éditer à la main.
DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid; v_res jsonb;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(F.nom)};
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, notes, connector, is_active)
    VALUES (v_org, ${q(F.nom)}, ${q(F.notes)}, ${q(F.connector)}, true) RETURNING id INTO v_sup;
  ELSE
    UPDATE majordhome.suppliers SET connector = COALESCE(connector, ${q(F.connector)}), is_active = true WHERE id = v_sup;
  END IF;
  v_res := public.supplier_catalog_upsert(v_org, v_sup, ${q(VERSION)}, $rows$${rows}$rows$::jsonb);
  RAISE NOTICE 'supplier_catalog_upsert ${VERSION} : %', v_res;
END $$;
`;

const OUT = path.join(racine, 'scripts', 'catalogue', 'out');
mkdirSync(OUT, { recursive: true });
const sortie = path.join(OUT, `${VERSION}.sql`);
writeFileSync(sortie, sql, 'utf8');

const parGamme = {};
for (const l of lignes) parGamme[l.gamme] = (parGamme[l.gamme] || 0) + 1;
console.log(`${F.nom} — relevé du ${releve_at} : ${retenus} articles retenus, exclus ${JSON.stringify(exclus)} → ${path.relative(racine, sortie)}`);
console.table(parGamme);
