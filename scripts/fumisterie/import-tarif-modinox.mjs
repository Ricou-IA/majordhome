// ============================================================================
// Tarif MODINOX/ALTEMA (docs/devis-fumisterie/MAYER002.xlsx, onglet « Tarif Juin26 »)
// → SQL d'upsert REJOUABLE dans majordhome.supplier_products (fournisseur « MODINOX / ALTEMA »)
//   + majordhome.fum_article_attrs, en morceaux appliqués via le MCP Supabase (execute_sql).
// Prix : selling_price_ht = tarif_public = « TARIF 06/26 » ; purchase_price_ht = « Prix pour client »
// (prix net Mayer, remises incluses — JAMAIS recalculé). Un article absent du fichier passe
// is_active=false (jamais supprimé). Échoue bruyamment sur colonne manquante ou prix vide.
// Usage : node scripts/fumisterie/import-tarif-modinox.mjs [--org 3c68193e-...] [--version modinox_2026-06]
// ============================================================================
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesignation } from './lib/parseDesignation.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const VERSION = opt('--version', 'modinox_2026-06');
const XLSX = path.join(racine, 'docs', 'devis-fumisterie', 'MAYER002.xlsx');
const OUT = path.join(racine, 'scripts', 'fumisterie', 'out');
const TAILLE_CHUNK = 800;

const COLONNES = ['Références articles', 'Désignation Article', 'Famille N1', 'Libellé Fam. N1', 'Famille N2',
  'Libellé Fam. N2', 'Famille N3', 'Famille N4', 'Unité de vente', 'EAN', 'TARIF 06/26', 'Remise à la famille',
  "Remise à l'article", 'Prix net', 'Prix pour client'];

const q = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
// Arrondi à 4 décimales avant sérialisation : évite le bruit flottant IEEE-754 (ex. 87.24000000000001)
// dans le SQL généré — purchase_price_ht/tarif_public doivent porter le prix exact enregistré.
const n = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 'NULL' : String(Math.round(Number(v) * 10000) / 10000));
const cell = (row, i) => { const v = row.getCell(i + 1).value; return v && typeof v === 'object' && 'result' in v ? v.result : v; };
const normaliser = (s) => String(s ?? '').normalize('NFC').trim();

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(XLSX);
const ws = wb.getWorksheet('Tarif Juin26');
if (!ws) throw new Error('Onglet « Tarif Juin26 » introuvable');
const entete = COLONNES.map((_, i) => normaliser(cell(ws.getRow(1), i)));
const colonnesNormalisees = COLONNES.map((c) => normaliser(c));
let enteteDivergente = false;
colonnesNormalisees.forEach((c, i) => {
  if (entete[i] !== c) {
    throw new Error(`Colonne ${i + 1} attendue « ${COLONNES[i]} », lue « ${cell(ws.getRow(1), i)} »`);
  }
  if (String(cell(ws.getRow(1), i) ?? '').trim() !== COLONNES[i]) enteteDivergente = true;
});

const lignes = [];
const rapport = { total: 0, horsPerimetre: 0, surMesure: 0, ml: 0, nonParse: [], sansPrix: [], enteteDivergente };
ws.eachRow((row, idx) => {
  if (idx === 1) return;
  const ref = String(cell(row, 0) ?? '').trim();
  if (!ref) return;
  rapport.total++;
  const designation = String(cell(row, 1) ?? '').trim();
  const l = {
    reference: ref, designation,
    famille_n1: String(cell(row, 2) ?? ''), libelle_n1: cell(row, 3), famille_n2: String(cell(row, 4) ?? ''), libelle_n2: cell(row, 5),
    famille_n3: cell(row, 6) == null ? null : String(cell(row, 6)), famille_n4: cell(row, 7) == null ? null : String(cell(row, 7)),
    unite: String(cell(row, 8) ?? 'PC'), ean: cell(row, 9) == null ? null : String(cell(row, 9)),
    tarif_public: Number(cell(row, 10)), prix_client: Number(cell(row, 14)), taux_remise: cell(row, 11),
  };
  if (!Number.isFinite(l.tarif_public) || !Number.isFinite(l.prix_client)) { rapport.sansPrix.push(ref); return; }
  l.attrs = parseDesignation(l);
  if (l.attrs.hors_perimetre) rapport.horsPerimetre++;
  if (l.attrs.sur_mesure) rapport.surMesure++;
  if (l.unite === 'ML') rapport.ml++;
  if (l.attrs.parse_confidence < 1) rapport.nonParse.push(`${ref} | ${designation} | ${l.attrs.parse_notes}`);
  lignes.push(l);
});
if (rapport.sansPrix.length) throw new Error(`${rapport.sansPrix.length} lignes sans prix : ${rapport.sansPrix.slice(0, 10).join(', ')}`);

mkdirSync(OUT, { recursive: true });
const gammeAffichee = (l) => l.attrs.gamme_tarif;
const uniteApp = (u) => (u === 'ML' ? 'ml' : 'pièce');
const morceaux = [];
for (let i = 0; i < lignes.length; i += TAILLE_CHUNK) morceaux.push(lignes.slice(i, i + TAILLE_CHUNK));

morceaux.forEach((chunk, k) => {
  const sql = [];
  sql.push(`-- Import tarif ${VERSION} — partie ${k + 1}/${morceaux.length} (${chunk.length} articles). Rejouable.`);
  sql.push(`DO $$
DECLARE v_org uuid := '${ORG}'; v_sup uuid;
BEGIN
  SELECT id INTO v_sup FROM majordhome.suppliers WHERE org_id = v_org AND name = 'MODINOX / ALTEMA';
  IF v_sup IS NULL THEN
    INSERT INTO majordhome.suppliers (org_id, name, notes, is_active) VALUES (v_org, 'MODINOX / ALTEMA', 'Conduits de fumée — tarif importé par scripts/fumisterie/import-tarif-modinox.mjs', true) RETURNING id INTO v_sup;
  END IF;
  -- ⚠️ Ne JAMAIS concaténer deux fichiers de chunk dans un seul appel execute_sql :
  -- la temp table t_imp n'est droppée qu'au COMMIT (ON COMMIT DROP), un 2ᵉ CREATE TEMP TABLE
  -- dans la même transaction échouerait sur "relation t_imp already exists".
  CREATE TEMP TABLE t_imp (reference text, name text, code_famille text, gamme text, code_ean text, tarif_public numeric, taux_remise numeric,
    purchase_price_ht numeric, unit text, diametre text,
    famille_n1 text, libelle_n1 text, famille_n2 text, libelle_n2 text, famille_n3 text, famille_n4 text, gamme_tarif text, type_piece text,
    diametre_int int, diametre_ext int, longueur_mm int, longueur_max_mm int, angle int, pente_min int, pente_max int, couleur text, version text,
    sur_mesure bool, hors_perimetre bool, parse_confidence numeric, parse_notes text) ON COMMIT DROP;
  INSERT INTO t_imp VALUES`);
  sql.push(chunk.map((l) => `(${[q(l.reference), q(l.designation), q(l.famille_n2), q(gammeAffichee(l)), q(l.ean), n(l.tarif_public), n(l.taux_remise),
    n(l.prix_client), q(uniteApp(l.unite)), l.attrs.diametre_int == null ? 'NULL' : q(String(l.attrs.diametre_int)),
    q(l.famille_n1), q(l.libelle_n1), q(l.famille_n2), q(l.libelle_n2), q(l.famille_n3), q(l.famille_n4), q(l.attrs.gamme_tarif), q(l.attrs.type_piece),
    n(l.attrs.diametre_int), n(l.attrs.diametre_ext), n(l.attrs.longueur_mm), n(l.attrs.longueur_max_mm), n(l.attrs.angle), n(l.attrs.pente_min), n(l.attrs.pente_max),
    q(l.attrs.couleur), q(l.attrs.version), l.attrs.sur_mesure, l.attrs.hors_perimetre, n(l.attrs.parse_confidence), q(l.attrs.parse_notes)].join(',')})`).join(',\n') + ';');
  sql.push(`
  UPDATE majordhome.supplier_products p SET name = t.name, code_famille = t.code_famille, gamme = t.gamme, code_ean = t.code_ean,
    tarif_public = t.tarif_public, taux_remise = t.taux_remise, purchase_price_ht = t.purchase_price_ht, selling_price_ht = t.tarif_public,
    unit = t.unit, diametre = t.diametre, category = 'fumisterie', product_kind = 'main', is_active = NOT t.hors_perimetre, updated_at = now()
  FROM t_imp t WHERE p.supplier_id = v_sup AND p.reference = t.reference;
  INSERT INTO majordhome.supplier_products (supplier_id, org_id, reference, name, category, code_famille, gamme, code_ean, tarif_public, taux_remise,
    purchase_price_ht, selling_price_ht, default_tva_rate, unit, diametre, product_kind, is_active)
  SELECT v_sup, v_org, t.reference, t.name, 'fumisterie', t.code_famille, t.gamme, t.code_ean, t.tarif_public, t.taux_remise,
    t.purchase_price_ht, t.tarif_public, 20, t.unit, t.diametre, 'main', NOT t.hors_perimetre
  FROM t_imp t WHERE NOT EXISTS (SELECT 1 FROM majordhome.supplier_products p WHERE p.supplier_id = v_sup AND p.reference = t.reference);
  INSERT INTO majordhome.fum_article_attrs (supplier_product_id, org_id, famille_n1, libelle_n1, famille_n2, libelle_n2, famille_n3, famille_n4,
    gamme_tarif, type_piece, diametre_int, diametre_ext, longueur_mm, longueur_max_mm, angle, pente_min, pente_max, couleur, version,
    sur_mesure, hors_perimetre, parse_confidence, parse_notes, source_version)
  SELECT p.id, v_org, t.famille_n1, t.libelle_n1, t.famille_n2, t.libelle_n2, t.famille_n3, t.famille_n4,
    t.gamme_tarif, t.type_piece, t.diametre_int, t.diametre_ext, t.longueur_mm, t.longueur_max_mm, t.angle, t.pente_min, t.pente_max, t.couleur, t.version,
    t.sur_mesure, t.hors_perimetre, t.parse_confidence, t.parse_notes, '${VERSION}'
  FROM t_imp t JOIN majordhome.supplier_products p ON p.supplier_id = v_sup AND p.reference = t.reference
  ON CONFLICT (supplier_product_id) DO UPDATE SET famille_n1 = EXCLUDED.famille_n1, libelle_n1 = EXCLUDED.libelle_n1, famille_n2 = EXCLUDED.famille_n2,
    libelle_n2 = EXCLUDED.libelle_n2, famille_n3 = EXCLUDED.famille_n3, famille_n4 = EXCLUDED.famille_n4, gamme_tarif = EXCLUDED.gamme_tarif,
    type_piece = EXCLUDED.type_piece, diametre_int = EXCLUDED.diametre_int, diametre_ext = EXCLUDED.diametre_ext, longueur_mm = EXCLUDED.longueur_mm,
    longueur_max_mm = EXCLUDED.longueur_max_mm, angle = EXCLUDED.angle, pente_min = EXCLUDED.pente_min, pente_max = EXCLUDED.pente_max,
    couleur = EXCLUDED.couleur, version = EXCLUDED.version, sur_mesure = EXCLUDED.sur_mesure, hors_perimetre = EXCLUDED.hors_perimetre,
    parse_confidence = EXCLUDED.parse_confidence, parse_notes = EXCLUDED.parse_notes, source_version = EXCLUDED.source_version, updated_at = now();
END $$;`);
  writeFileSync(path.join(OUT, `modinox_2026_part${String(k + 1).padStart(2, '0')}.sql`), sql.join('\n'), 'utf8');
});

// Dernière partie : désactiver les articles MODINOX absents du fichier
writeFileSync(path.join(OUT, 'modinox_2026_part99_desactivation.sql'), `-- Articles MODINOX absents du tarif ${VERSION} → is_active=false (jamais supprimés)
UPDATE majordhome.supplier_products p SET is_active = false, updated_at = now()
FROM majordhome.suppliers s
WHERE s.id = p.supplier_id AND s.org_id = '${ORG}' AND s.name = 'MODINOX / ALTEMA' AND p.is_active
  AND NOT EXISTS (SELECT 1 FROM majordhome.fum_article_attrs a WHERE a.supplier_product_id = p.id AND a.source_version = '${VERSION}');
`, 'utf8');

writeFileSync(path.join(OUT, 'rapport-import.md'), `# Rapport d'import ${VERSION}

- Lignes lues : ${rapport.total} · morceaux SQL : ${morceaux.length}
- En-tête : ${rapport.enteteDivergente ? 'divergence accents/espaces normalisée avant comparaison (voir COLONNES du script)' : 'identique à COLONNES'}
- Hors périmètre (gaz/fioul/charbon, famille 22) → is_active=false : ${rapport.horsPerimetre}
- Sur mesure (jamais chiffrés automatiquement) : ${rapport.surMesure}
- Unité ML (prix au mètre) : ${rapport.ml}
- Lignes à confiance < 1 : ${rapport.nonParse.length}

## Lignes non entièrement parsées
${rapport.nonParse.map((l) => `- ${l}`).join('\n')}
`, 'utf8');
console.log(`${lignes.length} articles → ${morceaux.length} morceaux dans ${path.relative(racine, OUT)} ; ${rapport.nonParse.length} lignes à confiance < 1`);
