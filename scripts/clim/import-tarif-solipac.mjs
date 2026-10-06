// ============================================================================
// Tarif SOLIPAC (climatisation Hitachi airHome, régulation Airzone, liaisons cuivre)
// scripts/clim/data/solipac-<version>.json → SQL d'upsert REJOUABLE dans majordhome.supplier_products
// (fournisseur « SOLIPAC », category = 'climatisation'), appliqué par scripts/fumisterie/apply-sql.mjs.
//
// Règles (décisions Eric 2026-10-06) :
//   - purchase_price_ht = prix net Solipac + éco-participation DEEE (la DEEE est en sus sur leurs devis).
//   - selling_price_ht n'est JAMAIS écrit par l'import : il est saisi à la main dans Settings → Fournisseurs.
//     Un article nouveau part à 0 (NOT NULL) = « prix de vente à renseigner » ; un article existant garde le sien.
//   - Le prix « par 3 / P.U dans lot de 3 » est le prix unitaire (condition commerciale).
//   - specs.canonical porte les caractéristiques (kW, sorties, diamètres) + source_version ; merge JSONB,
//     les clés posées à la main dans le drawer produit sont conservées.
//   - Un article absent du fichier passe is_active=false (jamais supprimé). Échoue bruyamment sur prix manquant
//     ou référence en double.
// Usage : node scripts/clim/import-tarif-solipac.mjs [--org 3c68193e-...] [--version solipac_2026-10]
//   puis : node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/clim/out/<version>.sql
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const VERSION = opt('--version', 'solipac_2026-10');
const DATA = path.join(racine, 'scripts', 'clim', 'data', `${VERSION.replace('_', '-')}.json`);
const OUT = path.join(racine, 'scripts', 'clim', 'out');

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => {
  if (v == null || v === '' || Number.isNaN(Number(v))) return 'NULL';
  return String(Math.round(Number(v) * 10000) / 10000);
};
const centimes = (v) => Math.round(Number(v) * 100) / 100;

const fichier = JSON.parse(readFileSync(DATA, 'utf8'));
const { fournisseur, articles } = fichier;
if (!fournisseur?.nom || !Array.isArray(articles) || articles.length === 0) throw new Error(`Fichier ${DATA} incomplet`);

const vus = new Set();
const sansPrix = [];
for (const a of articles) {
  if (vus.has(a.reference)) throw new Error(`Référence en double : ${a.reference}`);
  vus.add(a.reference);
  if (!Number.isFinite(Number(a.prix_net)) || !Number.isFinite(Number(a.deee))) sansPrix.push(a.reference);
}
if (sansPrix.length) throw new Error(`${sansPrix.length} article(s) sans prix : ${sansPrix.join(', ')}`);

const lignes = articles.map((a) => {
  const specs = { canonical: { ...a.specs, prix_net_ht: centimes(a.prix_net), deee_ht: centimes(a.deee), code_solipac: a.code_solipac ?? null }, source_version: VERSION };
  const valeurs = [
    q(a.reference), q(a.name), q(a.gamme), q(a.brand), q(a.diametre),
    n(centimes(Number(a.prix_net) + Number(a.deee))), q(a.unit ?? 'pièce'), q(JSON.stringify(specs)),
  ];
  return `(${valeurs.join(',')})`;
});

const sql = `-- Import tarif ${VERSION} — ${articles.length} articles, fournisseur « ${fournisseur.nom} ». Rejouable.
-- Généré par scripts/clim/import-tarif-solipac.mjs ; ne jamais éditer à la main.
DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(fournisseur.nom)};
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, notes, is_active) VALUES (v_org, ${q(fournisseur.nom)}, ${q(fournisseur.notes)}, true) RETURNING id INTO v_sup;
  END IF;
  CREATE TEMP TABLE t_imp (reference text, name text, gamme text, brand text, diametre text, purchase_price_ht numeric, unit text, specs jsonb) ON COMMIT DROP;
  INSERT INTO t_imp VALUES
${lignes.join(',\n')};

  -- Mise à jour : prix d'achat, libellé, gamme, specs (merge). selling_price_ht volontairement absent.
  UPDATE majordhome.supplier_products p SET name = t.name, gamme = t.gamme, brand = t.brand, diametre = t.diametre,
    purchase_price_ht = t.purchase_price_ht, unit = t.unit, category = 'climatisation', product_kind = 'main',
    specs = COALESCE(p.specs, '{}'::jsonb) || t.specs, is_active = true, updated_at = now()
  FROM t_imp t WHERE p.supplier_id = v_sup AND p.reference = t.reference;

  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, category, gamme, brand, diametre,
    purchase_price_ht, selling_price_ht, default_tva_rate, unit, specs, product_kind, is_active)
  SELECT v_sup, v_org, t.reference, t.name, 'climatisation', t.gamme, t.brand, t.diametre,
    t.purchase_price_ht, 0, 20, t.unit, t.specs, 'main', true
  FROM t_imp t WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p WHERE p.supplier_id = v_sup AND p.reference = t.reference);

  -- Un article du fournisseur absent du fichier n'est plus au tarif : désactivé, jamais supprimé.
  UPDATE majordhome.supplier_products p SET is_active = false, updated_at = now()
  WHERE p.supplier_id = v_sup AND p.is_active AND NOT EXISTS (SELECT 1 FROM t_imp t WHERE t.reference = p.reference);
END $$;
`;

mkdirSync(OUT, { recursive: true });
const sortie = path.join(OUT, `${VERSION}.sql`);
writeFileSync(sortie, sql, 'utf8');

const parGamme = {};
for (const a of articles) parGamme[a.gamme] = (parGamme[a.gamme] || 0) + 1;
console.log(`${articles.length} articles → ${path.relative(racine, sortie)}`);
console.table(parGamme);
