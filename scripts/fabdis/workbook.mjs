/**
 * scripts/fabdis/workbook.mjs — Lecture d'un classeur FAB-DIS (couche I/O)
 * ============================================================================
 * Seul endroit du pipeline qui touche au disque et a exceljs. Le parsing et
 * l'assemblage restent dans parser.mjs, module pur et teste.
 *
 * Les onglets sont retrouves par ALIAS (cf. SHEET_SPECS[...].sheetAliases) et
 * non par nom exact : selon les fabricants on rencontre « B01_COMMERCE »,
 * « B01 », « Commerce »… Un onglet attendu mais introuvable est signale dans
 * le rapport, il n'interrompt pas la lecture des autres.
 * ============================================================================
 */

import ExcelJS from 'exceljs';

import { SHEET_SPECS, normalizeHeader, parseSheet } from './parser.mjs';

/**
 * Convertit une cellule exceljs en valeur simple.
 * Les cellules riches (formule, lien hypertexte, texte enrichi) arrivent sous
 * forme d'objet : les laisser telles quelles ferait ecrire « [object Object] »
 * en base.
 * @param {unknown} value
 * @returns {string|number|null}
 */
export function cellToValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.text !== undefined) return value.text;           // lien hypertexte
    if (value.result !== undefined) return value.result;       // formule
    if (Array.isArray(value.richText)) {
      return value.richText.map((rt) => rt.text || '').join('');
    }
    if (value.hyperlink) return value.hyperlink;
    return null;
  }
  return String(value);
}

/**
 * Retrouve une feuille par ses alias de nom.
 * @param {import('exceljs').Workbook} workbook
 * @param {string[]} aliases
 * @returns {import('exceljs').Worksheet|null}
 */
function findSheet(workbook, aliases) {
  for (const sheet of workbook.worksheets) {
    if (aliases.includes(normalizeHeader(sheet.name))) return sheet;
  }
  return null;
}

/** Extrait une feuille en tableau de tableaux (en-tete en position 0). */
function sheetToRows(sheet) {
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values est 1-indexe : la position 0 est toujours undefined.
    rows.push((row.values || []).slice(1).map(cellToValue));
  });
  return rows;
}

/**
 * Lit un classeur FAB-DIS et retourne les enregistrements par onglet.
 *
 * @param {string} filePath chemin du .xlsx
 * @returns {Promise<{sheets: Record<string, object[]>, report: object}>}
 *   `report` recense, par onglet : lignes retenues, lignes ignorees, colonnes
 *   non reconnues et colonnes requises manquantes. Il est destine a etre
 *   affiche : c'est lui qui evite l'import silencieusement incomplet.
 */
export async function readFabdisWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = {};
  const report = { file: filePath, sheets: {}, missingSheets: [] };

  for (const [sheetKey, spec] of Object.entries(SHEET_SPECS)) {
    const sheet = findSheet(workbook, spec.sheetAliases);
    if (!sheet) {
      report.missingSheets.push(sheetKey);
      sheets[sheetKey] = [];
      continue;
    }

    const rows = sheetToRows(sheet);
    const parsed = parseSheet(rows, spec);
    sheets[sheetKey] = parsed.records;
    report.sheets[sheetKey] = {
      sheetName: sheet.name,
      rows: Math.max(rows.length - 1, 0),
      kept: parsed.records.length,
      skipped: parsed.skipped,
      unknownColumns: parsed.unknownColumns,
      missingColumns: parsed.missingColumns,
    };
  }

  return { sheets, report };
}

/**
 * Rend le rapport de lecture lisible en console.
 * @param {object} report sortie de readFabdisWorkbook
 * @returns {string}
 */
export function formatReport(report) {
  const lines = [`Fichier : ${report.file}`];

  for (const [key, r] of Object.entries(report.sheets)) {
    lines.push(`  ${key} (« ${r.sheetName} ») : ${r.kept}/${r.rows} lignes retenues`);
    if (r.skipped > 0) lines.push(`      ${r.skipped} ligne(s) ignoree(s), champ requis vide`);
    if (r.missingColumns.length) {
      lines.push(`      ONGLET REJETE — colonne(s) requise(s) introuvable(s) : ${r.missingColumns.join(', ')}`);
      lines.push('      → completer les alias dans SHEET_SPECS (scripts/fabdis/parser.mjs)');
    }
    if (r.unknownColumns.length) {
      lines.push(`      colonne(s) non reconnue(s), donnee non importee : ${r.unknownColumns.join(', ')}`);
    }
  }

  if (report.missingSheets.length) {
    lines.push(`  Onglet(s) absent(s) du classeur : ${report.missingSheets.join(', ')}`);
  }

  return lines.join('\n');
}
