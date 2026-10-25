// ============================================================================
// Prix publics d'un fournisseur → catalogue (SQL REJOUABLE). Décision d'Eric (2026-10-25) : « prix de vente = prix
// public pour l'instant, on fera une remise sur le devis » (même règle que le « Prix de base » Soditelem).
// Source : scripts/catalogue/data/prix-publics/<fournisseur>-<date>.json (relevé depuis le navigateur, cf. son _source),
// relu par le module pur prix-publics.js (prix ramenés à l'unité de la base, écartés rapportés).
// Le SQL, en une transaction :
//   1. les lignes ACTIVES du fournisseur aux références relevées passent par l'ÉCRIVAIN UNIQUE
//      public.supplier_catalog_upsert (desactiver_absents = false) avec LEURS valeurs actuelles (libellé, prix et date
//      d'achat, clé modèle de l'adaptateur) + tarif_public, taux_remise effectif (achat / public) et prix de vente par
//      défaut = prix public — la RPC ne pose ce dernier que sur une ligne encore à 0 ; specs.canonical.prix_public
//      garde le relevé (prix, date, page, conditionnement) ;
//   2. le prix de vente des ARTICLES Majord'home de ces lignes encore à 0 = prix public (le devis lit l'article) ;
//      un prix déjà saisi n'est jamais remplacé ;
//   3. une ligne dont le prix public est INFÉRIEUR à son prix d'achat est écartée (unité différente probable) et
//      listée par le SELECT final, avec les compteurs.
// Usage : node scripts/catalogue/import-prix-publics.mjs --releve scripts/catalogue/data/prix-publics/tereva-2026-10-25.json
//           [--org 3c68193e-…] [--dry-run]
//   puis : node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/catalogue/out/<version>.sql
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prixPublicsDuReleve } from './prix-publics.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const fichier = opt('--releve');
const org = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
if (!fichier) { console.error('Usage : node scripts/catalogue/import-prix-publics.mjs --releve <fichier.json> [--org <uuid>] [--dry-run]'); process.exit(2); }
if (!/^[0-9a-f-]{36}$/i.test(org)) { console.error('--org invalide'); process.exit(2); }

const releve = JSON.parse(readFileSync(path.resolve(racine, fichier), 'utf8'));
const { prix, ecartes } = prixPublicsDuReleve(releve);
const version = `prix_publics_${releve.fournisseur.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${releve.releve}`;
const lit = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

console.log(`${releve.fournisseur} — relevé du ${releve.releve} : ${prix.length} prix utilisables, ${ecartes.length} écarté(s)`);
ecartes.forEach((e) => console.log(`  écarté : ${e}`));

const valeurs = prix.map((p) => `    (${lit(p.reference)}, ${p.prix_public}, ${lit(p.url)}, ${lit(p.conditionnement)})`).join(',\n');
const sql = `-- ${version} — généré par scripts/catalogue/import-prix-publics.mjs depuis ${fichier.replace(/\\/g, '/')} (ne pas éditer)
-- ${prix.length} prix publics ; écartés : ${ecartes.length}
DO $$
DECLARE
  v_org uuid := ${lit(org)};
  v_sup uuid;
  v_rows jsonb;
  v_res jsonb;
  v_art int;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND upper(name) = ${lit(releve.fournisseur.toUpperCase())};
  IF v_sup IS NULL THEN RAISE EXCEPTION 'fournisseur % introuvable', ${lit(releve.fournisseur)}; END IF;

  CREATE TEMP TABLE t_prix_publics (reference text PRIMARY KEY, prix numeric NOT NULL, url text, conditionnement text) ON COMMIT DROP;
  INSERT INTO t_prix_publics VALUES
${valeurs};

  -- 1. lignes du fournisseur : leurs valeurs actuelles + prix public, remise effective, vente par défaut = prix public
  SELECT jsonb_agg(jsonb_build_object(
           'reference', p.reference, 'name', p.name,
           'purchase_price_ht', p.purchase_price_ht, 'purchase_price_at', p.purchase_price_at,
           'model_key', CASE WHEN p.model_key_source = 'cle' THEN p.model_key END,
           'tarif_public', t.prix,
           'taux_remise', CASE WHEN p.purchase_price_ht > 0 THEN round((1 - p.purchase_price_ht / t.prix) * 100, 2) END,
           'selling_price_ht_defaut', t.prix,
           'specs', jsonb_build_object('canonical', jsonb_build_object('prix_public', jsonb_build_object(
             'prix', t.prix, 'releve', ${lit(releve.releve)}, 'url', t.url, 'conditionnement', t.conditionnement)))))
    INTO v_rows
  FROM majordhome.supplier_products p
  JOIN t_prix_publics t ON t.reference = p.reference
  WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.is_active AND t.prix >= COALESCE(p.purchase_price_ht, 0);
  IF v_rows IS NULL THEN RAISE EXCEPTION 'aucune ligne active à mettre à jour'; END IF;
  v_res := public.supplier_catalog_upsert(v_org, v_sup, ${lit(version)}, v_rows,
             jsonb_build_object('desactiver_absents', false, 'source', 'prix_publics'));

  -- 2. articles Majord'home encore sans prix de vente : prix public (le devis lit l'article)
  UPDATE majordhome.catalog_items i
     SET selling_price_ht = round(t.prix, 2), updated_at = now()
    FROM majordhome.supplier_products p
    JOIN t_prix_publics t ON t.reference = p.reference
   WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.is_active AND p.catalog_item_id = i.id
     AND i.org_id = v_org AND i.selling_price_ht = 0 AND t.prix >= COALESCE(p.purchase_price_ht, 0);
  GET DIAGNOSTICS v_art = ROW_COUNT;

  CREATE TEMP TABLE t_prix_publics_bilan ON COMMIT PRESERVE ROWS AS
    SELECT v_res AS releve, v_art AS articles_mis_a_prix,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object('reference', p.reference, 'achat', p.purchase_price_ht, 'public', t.prix)), '[]'::jsonb)
              FROM majordhome.supplier_products p JOIN t_prix_publics t ON t.reference = p.reference
             WHERE p.supplier_id = v_sup AND p.org_id = v_org AND p.is_active AND t.prix < COALESCE(p.purchase_price_ht, 0)) AS ecartes_prix_inferieur;
END $$;
SELECT * FROM t_prix_publics_bilan;
`;
if (args.includes('--dry-run')) { console.log(sql.slice(0, 1500)); process.exit(0); }
mkdirSync(path.join(racine, 'scripts/catalogue/out'), { recursive: true });
const sortie = path.join(racine, 'scripts/catalogue/out', `${version}.sql`);
writeFileSync(sortie, sql);
console.log(`SQL écrit : ${path.relative(racine, sortie)}`);
