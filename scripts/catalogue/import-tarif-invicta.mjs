// ============================================================================
// Import du tarif NET Invicta (poêles, foyers, inserts, accessoires) dans le catalogue, et CORRECTION des prix déjà
// en base. scripts/catalogue/data/invicta-tarif-AAAA-MM.json (transcrit par tarif-invicta-pdf.py, contrôlé par
// invicta-tarif.js) → UN fichier SQL rejouable, ATOMIQUE (un seul bloc DO : tout ou rien), qui :
//   1. appelle l'écrivain unique public.supplier_catalog_upsert : prix d'achat = net HT, prix public = brut HT,
//      remise ; nouvelles références créées ; références absentes du tarif DÉSACTIVÉES (jamais supprimées ; les
//      pièces détachées du fournisseur ne sont pas concernées depuis 20261111_2) ;
//   2. corrige le prix de vente HT des lignes ET des articles restés au prix public TTC (erreur de l'import de mars
//      2026 : le « Prix Publics Indicatifs TVA 20 % » avait été rangé comme prix de vente HT). Un prix de vente qui
//      n'est aucun des prix TTC connus a été ajusté à la main : il n'est PAS touché, il est compté ;
//   3. corrige prix d'achat / prix public / remise des références sorties du tarif (d'après l'ancien tarif) ;
//   4. pose le code-barres (EAN) là où il manque ;
//   5. vérifie avant de valider : plus aucune ligne au prix TTC, pièces détachées intactes — sinon tout est annulé.
// Usage : node scripts/catalogue/import-tarif-invicta.mjs --fichier scripts/catalogue/data/invicta-tarif-2026-03.json
//           [--ancien scripts/catalogue/data/invicta-tarif-2025-04.json] [--fournisseur INVICTA] [--org 3c68193e-…]
//           [--essai]  → fichier <version>_essai.sql : même bloc, annulé à la fin, compteurs dans le message d'erreur
//   puis : node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/catalogue/out/<version>.sql
// Chaque année : tarif-invicta-pdf.py sur le nouveau PDF → JSON → mettre à jour les chiffres pinnés du test → ici,
// avec --ancien = le JSON de l'année précédente.
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lignesDepuisTarifInvicta, correctionsDePrix } from './invicta-tarif.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const fichier = opt('--fichier');
if (!fichier) { console.error('--fichier <tarif JSON> requis'); process.exit(2); }
const NOM = opt('--fournisseur', 'INVICTA');
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const lire = (f) => JSON.parse(readFileSync(path.resolve(racine, f), 'utf8'));
const tarif = lire(fichier);
const ancien = opt('--ancien') ? lire(opt('--ancien')) : null;
const ESSAI = args.includes('--essai'); // essai à blanc : le bloc se termine par une exception qui annule tout et rend les compteurs
const version = `invicta-tarif_${path.basename(fichier).match(/(\d{4}-\d{2})/)?.[1] || 'inconnu'}`;

const { lignes, doublons, compteRendu } = lignesDepuisTarifInvicta(tarif, { version, marque: NOM });
const corrections = correctionsDePrix(tarif, ancien);

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const garde = (texte, balise) => { if (texte.includes(balise)) throw new Error(`Balise ${balise} présente dans les données`); return texte; };
const rows = garde(JSON.stringify(lignes), '$rows$');
const corr = garde(JSON.stringify(corrections), '$corr$');

const sql = `-- Tarif ${NOM} ${version} (${tarif.titre || ''}, valable du ${tarif.valable_du} au ${tarif.valable_au}) : ${compteRendu.references} références.
-- Correction des prix de vente HT restés au prix public TTC. Atomique et rejouable.
-- Généré par scripts/catalogue/import-tarif-invicta.mjs ; ne jamais éditer à la main.
DO $$
DECLARE
  v_org uuid := ${q(ORG)}; v_sup uuid; v_res jsonb;
  v_pieces_avant int; v_pieces_apres int;
  v_vente_lignes int := 0; v_vente_articles int := 0; v_ajustes int := 0; v_sortis int := 0; v_ean int := 0; v_reste int := 0;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(NOM)};
  IF v_sup IS NULL THEN RAISE EXCEPTION 'fournisseur introuvable'; END IF;
  SELECT count(*) INTO v_pieces_avant FROM majordhome.supplier_products WHERE supplier_id = v_sup AND category = 'piece_detachee' AND is_active;

  CREATE TEMP TABLE t_corr ON COMMIT DROP AS
    SELECT c.reference, c.vente_ht, c.achat_ht, c.remise_pct, c.ean, c.au_tarif,
           ARRAY(SELECT jsonb_array_elements_text(c.anciens_ttc)::numeric) AS anciens_ttc
    FROM jsonb_to_recordset($corr$${corr}$corr$::jsonb)
      AS c(reference text, vente_ht numeric, achat_ht numeric, remise_pct numeric, ean text, au_tarif boolean, anciens_ttc jsonb);
  CREATE INDEX ON t_corr (reference);
  ANALYZE t_corr;

  -- 1. Tarif courant : achat net, prix public brut, remise ; nouvelles références ; absentes désactivées.
  v_res := public.supplier_catalog_upsert(v_org, v_sup, ${q(version)}, $rows$${rows}$rows$::jsonb, '{}'::jsonb);
  RAISE NOTICE 'supplier_catalog_upsert ${version} : %', v_res - 'articles';

  -- 2. Prix de vente HT : seulement là où il est encore un prix public TTC (ligne, puis article jugé sur SON prix).
  SELECT count(*) INTO v_ajustes
  FROM majordhome.supplier_products p JOIN t_corr c ON c.reference = p.reference
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee'
    AND p.selling_price_ht <> 0 AND p.selling_price_ht <> c.vente_ht AND NOT (p.selling_price_ht = ANY (c.anciens_ttc));

  UPDATE majordhome.catalog_items ci SET selling_price_ht = c.vente_ht, updated_at = now()
  FROM majordhome.supplier_products p JOIN t_corr c ON c.reference = p.reference
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee'
    AND ci.id = p.catalog_item_id AND ci.org_id = v_org AND ci.selling_price_ht = ANY (c.anciens_ttc);
  GET DIAGNOSTICS v_vente_articles = ROW_COUNT;

  UPDATE majordhome.supplier_products p SET selling_price_ht = c.vente_ht, updated_at = now()
  FROM t_corr c
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee'
    AND p.reference = c.reference AND p.selling_price_ht = ANY (c.anciens_ttc);
  GET DIAGNOSTICS v_vente_lignes = ROW_COUNT;

  -- 3. Références sorties du tarif (désactivées à l'étape 1) : leurs prix d'achat / public / remise étaient faux aussi.
  UPDATE majordhome.supplier_products p
  SET purchase_price_ht = c.achat_ht, tarif_public = c.vente_ht, taux_remise = c.remise_pct, updated_at = now()
  FROM t_corr c
  WHERE NOT c.au_tarif AND p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee'
    AND p.reference = c.reference
    AND (p.purchase_price_ht IS DISTINCT FROM c.achat_ht OR p.tarif_public IS DISTINCT FROM c.vente_ht OR p.taux_remise IS DISTINCT FROM c.remise_pct);
  GET DIAGNOSTICS v_sortis = ROW_COUNT;

  -- 4. Code-barres, là où il manque (ligne et article).
  UPDATE majordhome.supplier_products p SET code_ean = c.ean
  FROM t_corr c
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.reference = c.reference AND c.ean ~ '^[0-9]{13}$'
    AND p.category IS DISTINCT FROM 'piece_detachee' AND COALESCE(p.code_ean, '') = '';
  GET DIAGNOSTICS v_ean = ROW_COUNT;
  UPDATE majordhome.catalog_items ci SET code_ean = c.ean
  FROM majordhome.supplier_products p JOIN t_corr c ON c.reference = p.reference
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee'
    AND ci.id = p.catalog_item_id AND ci.org_id = v_org AND c.ean ~ '^[0-9]{13}$' AND COALESCE(ci.code_ean, '') = '';

  -- 5. Vérifications : tout est annulé si l'une échoue.
  SELECT count(*) INTO v_reste
  FROM majordhome.supplier_products p JOIN t_corr c ON c.reference = p.reference
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee' AND p.selling_price_ht = ANY (c.anciens_ttc);
  IF v_reste > 0 THEN RAISE EXCEPTION 'il reste % ligne(s) au prix public TTC', v_reste; END IF;
  IF EXISTS (SELECT 1 FROM majordhome.supplier_products p JOIN t_corr c ON c.reference = p.reference
             WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.category IS DISTINCT FROM 'piece_detachee' AND c.au_tarif
               AND (p.purchase_price_ht <> c.achat_ht OR NOT p.is_active)) THEN
    RAISE EXCEPTION 'une ligne du tarif n''a pas son prix d''achat net ou est inactive';
  END IF;
  SELECT count(*) INTO v_pieces_apres FROM majordhome.supplier_products WHERE supplier_id = v_sup AND category = 'piece_detachee' AND is_active;
  IF v_pieces_apres <> v_pieces_avant THEN RAISE EXCEPTION 'pièces détachées touchées : % avant, % après', v_pieces_avant, v_pieces_apres; END IF;

  ${ESSAI ? "RAISE EXCEPTION 'ESSAI, rien n''est écrit —" : "RAISE NOTICE '"} prix de vente corrigés : % ligne(s), % article(s) ; ajustés à la main (non touchés) : % ; références sorties du tarif corrigées : % ; EAN posés : % ; écrivain : %',
    v_vente_lignes, v_vente_articles, v_ajustes, v_sortis, v_ean, v_res - 'articles' - 'categories_vues';
END $$;
`;
const OUT = path.join(racine, 'scripts', 'catalogue', 'out');
mkdirSync(OUT, { recursive: true });
const sortie = path.join(OUT, `${version}${ESSAI ? '_essai' : ''}.sql`);
writeFileSync(sortie, sql, 'utf8');
console.log(`${NOM} — ${tarif.titre || ''} (${tarif.valable_du} → ${tarif.valable_au})`);
console.table(compteRendu);
if (doublons.length) console.log(`Références répétées dans le PDF (une seule ligne gardée) : ${doublons.join(', ')}`);
console.log(`${corrections.length} références dans la table de correction (${corrections.filter((c) => !c.au_tarif).length} sorties du tarif) → ${path.relative(racine, sortie)}`);
