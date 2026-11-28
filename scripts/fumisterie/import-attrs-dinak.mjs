// ============================================================================
// Attributs de fumisterie DINAK (lus dans les désignations du tarif déjà importé dans supplier_products)
// + mapping des composants et équivalence de gamme (toutes les configurations couvertes) → SQL REJOUABLE, même circuit que MODINOX.
// N'APPLIQUE RIEN : le fichier produit (scripts/fumisterie/out/) se passe par scripts/fumisterie/apply-sql.mjs,
// sur le oui d'Eric. Lecture des articles : PostgREST, clé service_role de .env.local (DST_URL / DST_KEY).
// Une désignation non reconnue n'est pas importée et est LISTÉE (jamais devinée).
// Usage : node scripts/fumisterie/import-attrs-dinak.mjs [--org 3c68193e-...] [--fournisseur DINAK]
// ============================================================================
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parserDinak } from './lib/dinak-designation.js';

// Composants retirés des nomenclatures : leurs lignes de mapping DINAK partent aussi (la base suit le dépôt).
const COMPOSANTS_RETIRES = JSON.parse(readFileSync(new URL('./data/composants-retires.json', import.meta.url), 'utf8'));

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const NOM = opt('--fournisseur', 'DINAK');
const VERSION = 'dinak-2026-11';
const OUT = path.join(racine, 'scripts', 'fumisterie', 'out');
const lire = (f) => JSON.parse(readFileSync(path.join(racine, 'scripts', 'fumisterie', 'data', f), 'utf8'));
const GAMMES = lire('dinak-extrait-2026-11.json').gammes;
const MAPPING = lire('dinak-mapping.json');
const EQUIVALENCES = lire('equivalences-gammes.json').filter((e) => e.fournisseur === NOM);

const env = Object.fromEntries(readFileSync(path.join(racine, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
if (!env.DST_URL || !env.DST_KEY) throw new Error('DST_URL / DST_KEY absents de .env.local');
const rest = async (chemin) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${env.DST_URL}/rest/v1/${chemin}`, { headers: { apikey: env.DST_KEY, Authorization: `Bearer ${env.DST_KEY}`, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const page = await res.json(); out.push(...page);
    if (page.length < 1000) return out;
  }
};

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v)));
const tab = (l) => (l?.length ? `ARRAY[${l.map(Number).join(',')}]::integer[]` : 'NULL');

const fournisseurs = await rest(`majordhome_suppliers?org_id=eq.${ORG}&name=eq.${encodeURIComponent(NOM)}&select=id,name`);
if (fournisseurs.length !== 1) throw new Error(`${fournisseurs.length} fournisseur(s) « ${NOM} » dans l'organisation ${ORG}`);
const SUP = fournisseurs[0].id;
const articles = (await rest(`majordhome_supplier_products?supplier_id=eq.${SUP}&org_id=eq.${ORG}&is_active=eq.true&select=id,reference,name,gamme,diametre&order=id.asc`))
  .filter((a) => GAMMES.includes(a.gamme));
const parses = articles.map((a) => ({ a, p: parserDinak(a) }));
const reconnus = parses.filter((x) => x.p.type_piece);
const nonReconnus = parses.filter((x) => !x.p.type_piece);

const valeurs = reconnus.map(({ a, p }) => `(${q(a.id)}, ${q(ORG)}, ${q(p.gamme_tarif)}, ${q(p.type_piece)}, ${n(p.diametre_int)}, ${n(p.diametre_ext)}, ${n(p.longueur_mm)}, ${n(p.longueur_max_mm)}, ${n(p.angle)}, ${n(p.pente_min)}, ${n(p.pente_max)}, ${q(p.couleur)}, ${n(p.parse_confidence)}, ${q(p.parse_notes)}, ${q(VERSION)})`);
const sql = [
  `-- Attributs, mapping et équivalence DINAK — généré le ${new Date().toISOString()} par scripts/fumisterie/import-attrs-dinak.mjs`,
  `-- Organisation ${ORG}, fournisseur ${NOM} (${SUP}) : ${reconnus.length} attributs, ${nonReconnus.length} désignation(s) non reconnue(s) écartée(s).`,
  'BEGIN;',
  'INSERT INTO majordhome.fum_article_attrs (supplier_product_id, org_id, gamme_tarif, type_piece, diametre_int, diametre_ext, longueur_mm, longueur_max_mm, angle, pente_min, pente_max, couleur, parse_confidence, parse_notes, source_version) VALUES',
  valeurs.join(',\n'),
  `ON CONFLICT (supplier_product_id) DO UPDATE SET gamme_tarif = EXCLUDED.gamme_tarif, type_piece = EXCLUDED.type_piece, diametre_int = EXCLUDED.diametre_int, diametre_ext = EXCLUDED.diametre_ext,
  longueur_mm = EXCLUDED.longueur_mm, longueur_max_mm = EXCLUDED.longueur_max_mm, angle = EXCLUDED.angle, pente_min = EXCLUDED.pente_min, pente_max = EXCLUDED.pente_max,
  couleur = EXCLUDED.couleur, parse_confidence = EXCLUDED.parse_confidence, parse_notes = EXCLUDED.parse_notes, source_version = EXCLUDED.source_version, updated_at = now();`,
  `DELETE FROM majordhome.fum_composant_mapping WHERE org_id = ${q(ORG)} AND supplier_id = ${q(SUP)} AND ((composant_code, gamme_catalogue) IN (${MAPPING.map((m) => `(${q(m.composant_code)}, ${q(m.gamme_catalogue)})`).join(', ')}) OR composant_code IN (${COMPOSANTS_RETIRES.map(q).join(', ')}));`,
  'INSERT INTO majordhome.fum_composant_mapping (org_id, supplier_id, composant_code, gamme_catalogue, finition, gamme_tarif, type_piece, motif_code, priorite, statut, notes) VALUES',
  MAPPING.map((m) => `(${q(ORG)}, ${q(SUP)}, ${q(m.composant_code)}, ${q(m.gamme_catalogue)}, ${q(m.finition)}, ${q(m.gamme_tarif)}, ${q(m.type_piece)}, ${q(m.motif_code)}, ${n(m.priorite ?? 100)}, ${q(m.statut || 'catalogue')}, ${q(m.notes)})`).join(',\n') + ';',
  `DELETE FROM majordhome.fum_gamme_equivalences WHERE org_id = ${q(ORG)} AND supplier_id = ${q(SUP)} AND configuration_code IN (${[...new Set(EQUIVALENCES.map((e) => e.configuration_code))].map(q).join(', ')}) AND validee_le IS NULL;`,
  'INSERT INTO majordhome.fum_gamme_equivalences (org_id, configuration_code, gamme_catalogue, supplier_id, gamme_tarif, finition, longueurs_elements_mm, longueurs_raccordement_mm, reglable_min_mm, reglable_max_mm, notes, validee_par, validee_le) VALUES',
  EQUIVALENCES.map((e) => `(${q(ORG)}, ${q(e.configuration_code)}, ${q(e.gamme_catalogue)}, ${q(SUP)}, ${q(e.gamme_tarif)}, ${q(e.finition)}, ${tab(e.longueurs_elements_mm)}, ${tab(e.longueurs_raccordement_mm)}, ${n(e.reglable_min_mm)}, ${n(e.reglable_max_mm)}, ${q(e.notes)}, ${q(e.validee_par)}, ${q(e.validee_le)})`).join(',\n'),
  'ON CONFLICT DO NOTHING;', // une équivalence déjà VALIDÉE n'est ni supprimée ni remplacée
  'COMMIT;',
].join('\n');

mkdirSync(OUT, { recursive: true });
const fichier = path.join(OUT, `dinak-attrs_${new Date().toISOString().slice(0, 10)}.sql`);
writeFileSync(fichier, sql);
const parType = {};
for (const { p } of reconnus) parType[p.type_piece] = (parType[p.type_piece] || 0) + 1;
console.log(`${articles.length} articles DINAK du périmètre, ${reconnus.length} reconnus, ${nonReconnus.length} non reconnus.`);
console.log(parType);
if (nonReconnus.length) console.log('Non reconnus :', nonReconnus.map((x) => `${x.a.reference} ${x.a.name}`).join('\n'));
console.log(`SQL écrit (non appliqué) : ${fichier}`);
