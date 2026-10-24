// ============================================================================
// Tarif ECOSTAL (bornes de recharge V2C : Trydan, Trydan Pro, Pole Pro, Denka — grille HESIA / V2C)
// scripts/catalogue/data/ecostal-<AAAA-MM>.json (transcription du PDF) → SQL REJOUABLE qui crée le fournisseur
// s'il manque puis appelle l'ÉCRIVAIN UNIQUE public.supplier_catalog_upsert (migration 20261024_2) :
//   - purchase_price_ht = prix de la grille (« Prix de vente » d'Ecostal = prix d'achat Mayer HT) ;
//   - selling_price_ht n'est JAMAIS écrit par l'import (0 à la création = « à renseigner », conservé ensuite) ;
//   - libellé posé à l'INSERT seulement ; article absent du fichier ⇒ is_active = false, jamais supprimé ;
//   - specs.canonical = caractéristiques transcrites + prix_tarif_ht + date du tarif ; merge niveau 1.
// Échoue bruyamment sur référence en double ou prix manquant (scripts/catalogue/ecostal.test.mjs pinne le fichier).
// Les fiches techniques se déposent ensuite avec scripts/catalogue/attach-fiches.mjs.
// Usage : node scripts/catalogue/import-tarif-ecostal.mjs [--fichier scripts/catalogue/data/ecostal-2026-04.json] [--org 3c68193e-…]
//   puis : node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/catalogue/out/ecostal_2026-04.sql
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lignesDepuisTarifEcostal } from './ecostal-tarif.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const fichier = opt('--fichier', 'scripts/catalogue/data/ecostal-2026-04.json');
const VERSION = opt('--version', `ecostal_${path.basename(fichier).replace(/^[a-z]+-/, '').replace(/\.json$/, '')}`);

const tarif = JSON.parse(readFileSync(path.resolve(racine, fichier), 'utf8'));
const { fournisseur, lignes } = lignesDepuisTarifEcostal(tarif, { version: VERSION });

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const rows = JSON.stringify(lignes);
if (rows.includes('$rows$')) throw new Error('Balise $rows$ présente dans les données');

const sql = `-- Import tarif ${VERSION} — ${lignes.length} articles, fournisseur « ${fournisseur.nom} », grille du ${tarif.tarif.date}.
-- Rejouable. Généré par scripts/catalogue/import-tarif-ecostal.mjs ; ne jamais éditer à la main.
DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid; v_res jsonb;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(fournisseur.nom)};
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, contact_name, contact_email, contact_phone, notes, is_active)
    VALUES (v_org, ${q(fournisseur.nom)}, ${q(fournisseur.contact_name)}, ${q(fournisseur.contact_email)}, ${q(fournisseur.contact_phone)}, ${q(fournisseur.notes)}, true)
    RETURNING id INTO v_sup;
  ELSE
    UPDATE majordhome.suppliers SET is_active = true, updated_at = now() WHERE id = v_sup;
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
console.log(`${fournisseur.nom} — grille du ${tarif.tarif.date} : ${lignes.length} articles → ${path.relative(racine, sortie)}`);
console.table(parGamme);
