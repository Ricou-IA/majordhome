// ============================================================================
// Catalogue d'ACHATS d'un fournisseur depuis ses factures Pennylane (SODITELEM, TEREVA…).
// Chaîne : telecharger-factures-pennylane.mjs (PDF + index) → pdf-mots.py (mots positionnés, JSON) → parseur PUR du
// fournisseur (scripts/catalogue/facture-soditelem.js | facture-tereva.js) ou transcription d'un relevé scanné
// (scripts/catalogue/data/factures-transcrites/<fournisseur>-<numéro>.json, même forme) → catalogueDepuisAchats
// (dernier prix net payé par référence, historique dans specs.canonical) → SQL REJOUABLE qui crée le fournisseur s'il
// manque (avec son pennylane_supplier_id) puis appelle l'ÉCRIVAIN UNIQUE public.supplier_catalog_upsert avec
// p_meta.desactiver_absents = false (migration 20261025_4) : un article non racheté ce mois-ci reste au catalogue.
// Contrôles (échec bruyant, aucun SQL écrit) : chaque facture réconcilie ses lignes avec ses propres totaux
// (parseurs), le numéro lu = numéro Pennylane, et le HT du relevé est comparé au HT Pennylane (écart > 0,05 € =
// avertissement : Pennylane suppose 20 % de TVA partout, les pellets sont à 10 %). Un relevé scanné sans
// transcription est listé, pas ignoré en silence. Les avoirs ne font pas de prix.
// Usage : node scripts/catalogue/import-achats-pennylane.mjs --fournisseur TEREVA --pennylane-id 276027202 --parseur tereva
//           [--org 3c68193e-…] [--version achats_tereva_2026-09] [--dry-run]
//   puis : node scripts/fumisterie/apply-sql.mjs --env .env.local --ref ejqqqwudmizqisdkxohw scripts/catalogue/out/<version>.sql
// Prérequis : python -I scripts/catalogue/pdf-mots.py pour chaque PDF (dossier out/factures/mots/, fait par ce script
// si le JSON manque et que python est disponible).
// ============================================================================
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parserFactureSoditelem } from './facture-soditelem.js';
import { parserFactureTereva } from './facture-tereva.js';
import { catalogueDepuisAchats } from './achats.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');

const PARSEURS = { soditelem: parserFactureSoditelem, tereva: parserFactureTereva };
/** Coordonnées de l'agence qui livre Mayer, telles qu'imprimées sur les relevés (posées à la création du fournisseur seulement). */
const FICHES = {
  SODITELEM: { contact_phone: '05 63 81 70 16', address: 'ZA de Roumagnac, 16 rue des Pyrénées', postal_code: '81600', city: 'Gaillac', notes: 'Agence de Gaillac. Catalogue = articles achetés, au dernier prix net facturé (relevés mensuels Pennylane).' },
  TEREVA: { contact_phone: '05 63 48 15 20', address: 'Rue François Arago', postal_code: '81000', city: 'Albi', notes: 'Agence d’Albi. Catalogue = articles achetés, au dernier prix net facturé (relevés mensuels Pennylane).' },
};

const nom = opt('--fournisseur');
const plId = Number(opt('--pennylane-id'));
const parseurNom = opt('--parseur', (nom || '').toLowerCase());
const parseur = PARSEURS[parseurNom];
if (!nom || !plId || !parseur) { console.error('--fournisseur <NOM> --pennylane-id <id Pennylane> --parseur soditelem|tereva requis'); process.exit(2); }
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');

const DOSSIER = path.join(racine, 'scripts', 'catalogue', 'out', 'factures');
const MOTS = path.join(DOSSIER, 'mots');
const TRANSCRITES = path.join(racine, 'scripts', 'catalogue', 'data', 'factures-transcrites');
const index = JSON.parse(readFileSync(path.join(DOSSIER, 'index.json'), 'utf8')).filter((e) => e.supplier_id === plId);
if (index.length === 0) { console.error(`aucune facture du fournisseur ${plId} dans ${path.relative(racine, DOSSIER)}/index.json`); process.exit(2); }
const transcriptions = existsSync(TRANSCRITES)
  ? readdirSync(TRANSCRITES).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(TRANSCRITES, f), 'utf8')))
  : [];

function motsDe(entree) {
  const base = path.basename(entree.pdf, '.pdf');
  const dossierPdf = path.basename(path.dirname(entree.pdf));
  const fichier = path.join(MOTS, `${dossierPdf}__${base}.json`);
  if (!existsSync(fichier)) {
    mkdirSync(MOTS, { recursive: true });
    const r = spawnSync('python', ['-I', path.join(racine, 'scripts', 'catalogue', 'pdf-mots.py'), path.join(racine, entree.pdf), fichier], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`pdf-mots.py sur ${entree.pdf} : ${r.stderr}`);
  }
  return JSON.parse(readFileSync(fichier, 'utf8')).pages;
}

const documents = [];
const sansTexte = [];
const avertissements = [];
const erreurs = [];
for (const entree of index) {
  const pages = motsDe(entree);
  let doc;
  if (pages.every((p) => p.words.length === 0)) {
    doc = transcriptions.find((t) => t.pennylane_id === entree.id);
    if (!doc) {
      const jumeau = index.find((e) => e.id !== entree.id && e.invoice_number && e.invoice_number === entree.invoice_number);
      if (jumeau) avertissements.push(`${entree.label} (${entree.filename}) : scan sans couche texte, doublon Pennylane de « ${jumeau.label} » (original lu)`);
      else sansTexte.push(`${entree.label} (${entree.filename}) : scan sans couche texte, pas de transcription → relevé NON importé`);
      continue;
    }
  } else {
    doc = parseur(pages);
  }
  doc.pennylane_id = entree.id;
  doc.pennylane_label = entree.label;
  if (doc.anomalies.length) erreurs.push(...doc.anomalies.map((a) => `${entree.label} : ${a}`));
  if (doc.numero && entree.invoice_number && doc.numero !== entree.invoice_number) erreurs.push(`${entree.label} : numéro lu ${doc.numero} ≠ Pennylane ${entree.invoice_number}`);
  const ht = doc.totaux?.total_ht;
  const htPl = entree.amount_before_tax != null ? Math.abs(Number(entree.amount_before_tax)) : null;
  if (ht != null && htPl != null && Math.abs(ht - htPl) > 0.05) avertissements.push(`${entree.label} : HT du relevé ${ht} ≠ HT Pennylane ${htPl} (TVA réduite ou OCR Pennylane)`);
  documents.push(doc);
}

// Un même relevé peut figurer deux fois dans Pennylane (scan + original) : on garde une lecture par numéro.
const parNumero = new Map();
for (const d of documents) {
  const cle = d.numero || `pl:${d.pennylane_id}`;
  if (!parNumero.has(cle)) parNumero.set(cle, d);
  else avertissements.push(`${d.pennylane_label} : doublon Pennylane du relevé ${cle}, ignoré`);
}
const uniques = [...parNumero.values()];

const dernier = uniques.filter((d) => d.type === 'facture').map((d) => d.date).sort().pop();
const VERSION = opt('--version', `achats_${parseurNom}_${(dernier || '').slice(0, 7)}`);
const { lignes, rapport } = catalogueDepuisAchats(uniques, { version: VERSION });

console.log(`${nom} (Pennylane ${plId}) — ${uniques.length} relevés lus (${rapport.factures} factures, ${rapport.avoirs_ignores.length} avoirs), ${rapport.lignes_lues} lignes → ${rapport.articles} articles, dernier achat ${rapport.dernier_achat}`);
for (const a of avertissements) console.log(`  ~ ${a}`);
for (const s of sansTexte) console.log(`  ! ${s}`);
for (const e of rapport.lignes_ecartees) console.log(`  - écartée : ${e}`);
if (rapport.articles_offerts) console.log(`  · ${rapport.articles_offerts} article(s) seulement vus à 0 € (offerts dans un pack)`);
for (const e of erreurs) console.log(`  ✗ ${e}`);
if (erreurs.length) { console.error(`\n${erreurs.length} anomalie(s) de lecture : aucun SQL écrit.`); process.exit(1); }

const OUT = path.join(racine, 'scripts', 'catalogue', 'out');
mkdirSync(OUT, { recursive: true });
const rapportFichier = path.join(OUT, `${VERSION}_rapport.json`);
writeFileSync(rapportFichier, JSON.stringify({ fournisseur: nom, pennylane_supplier_id: plId, version: VERSION, rapport, avertissements, sans_texte: sansTexte, factures: uniques.map((d) => ({ pennylane_id: d.pennylane_id, type: d.type, numero: d.numero, date: d.date, format: d.format ?? 'pdf', lignes: d.lignes.length, total_ht: d.totaux?.total_ht ?? null })), articles: lignes }, null, 2), 'utf8');

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const rows = JSON.stringify(lignes);
if (rows.includes('$rows$')) throw new Error('Balise $rows$ présente dans les données');
const fiche = FICHES[nom] ?? {};
const sql = `-- Catalogue d'achats ${VERSION} — ${lignes.length} articles, fournisseur « ${nom} » (Pennylane ${plId}), ${rapport.factures} factures jusqu'au ${rapport.dernier_achat}.
-- Rejouable. Généré par scripts/catalogue/import-achats-pennylane.mjs ; ne jamais éditer à la main.
DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid; v_res jsonb;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = ${q(nom)};
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, contact_phone, address, postal_code, city, notes, pennylane_supplier_id, is_active)
    VALUES (v_org, ${q(nom)}, ${q(fiche.contact_phone)}, ${q(fiche.address)}, ${q(fiche.postal_code)}, ${q(fiche.city)}, ${q(fiche.notes)}, ${q(String(plId))}, true)
    RETURNING id INTO v_sup;
  ELSE
    -- pennylane_supplier_id est une colonne TEXT : littéral quoté, sinon COALESCE(text, integer) refuse le rejeu.
    UPDATE majordhome.suppliers SET is_active = true, pennylane_supplier_id = COALESCE(pennylane_supplier_id, ${q(String(plId))}), updated_at = now() WHERE id = v_sup;
  END IF;
  v_res := public.supplier_catalog_upsert(v_org, v_sup, ${q(VERSION)}, $rows$${rows}$rows$::jsonb,
                                          '{"desactiver_absents": false, "source": "factures_pennylane"}'::jsonb);
  RAISE NOTICE 'supplier_catalog_upsert ${VERSION} : %', v_res;
END $$;
`;
const sortie = path.join(OUT, `${VERSION}.sql`);
if (!DRY) writeFileSync(sortie, sql, 'utf8');
console.log(`\n${DRY ? '(dry-run) ' : ''}${lignes.length} articles → ${path.relative(racine, sortie)} ; rapport ${path.relative(racine, rapportFichier)}`);
