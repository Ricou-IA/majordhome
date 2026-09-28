// Chargement du tarif réel MAYER002 (xlsx) sous la forme des articles de la vue majordhome_fum_articles,
// + calcul d'une configuration avec les fichiers de data/ — partagé par les tests sur tarif réel.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseDesignation } from './parseDesignation.mjs';
import { calculerMetre } from '../../../src/lib/fumisterie/index.js';
import { motifDependDuDiametre } from '../../../src/lib/fumisterie/articles.js';
import { buildFumisterieConfig } from '../../../src/lib/fumisterie/config.js';

const DATA = new URL('../data/', import.meta.url);
export const lireData = (f) => JSON.parse(readFileSync(new URL(f, DATA), 'utf8'));

let cache = null;
/** Le tarif réel, parsé comme à l'import (une seule lecture par process). */
export async function chargerTarif() {
  if (cache) return cache;
  const cell = (row, i) => { const v = row.getCell(i + 1).value; return v && typeof v === 'object' && 'result' in v ? v.result : v; };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(fileURLToPath(new URL('../../../docs/devis-fumisterie/MAYER002.xlsx', import.meta.url)));
  const ws = wb.getWorksheet('Tarif Juin26');
  const tarif = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const reference = String(cell(row, 0) ?? '').trim();
    if (!reference) return;
    const name = String(cell(row, 1) ?? '').trim();
    const attrs = parseDesignation({ reference, designation: name, famille_n1: String(cell(row, 2) ?? '') });
    tarif.push({ id: reference, reference, name, unit: String(cell(row, 8) ?? 'PC') === 'ML' ? 'ml' : 'pièce', is_active: !attrs.hors_perimetre,
      tarif_public: Number(cell(row, 10)), purchase_price_ht: Number(cell(row, 14)), ...attrs });
  });
  cache = tarif;
  return tarif;
}

export const MAPPING_COMPLET = ['cfg24-mapping.json', 'g4-mapping.json', 'tranche3-mapping.json'].flatMap(lireData);
export const GABARIT_FICHIER = { G1: 'gabarit-g1.json', G3: 'gabarit-g3.json', G3P: 'gabarit-g3p.json', G4: 'gabarit-g4.json', G4R: 'gabarit-g4r.json', G4P: 'gabarit-g4p.json', G4K: 'gabarit-g4k.json', G4F: 'gabarit-g4f.json', G5: 'gabarit-g5.json', G6: 'gabarit-g6.json' };

/** Comme fumisterieService.getArticles : Ø du relevé + sans Ø + gammes indépendantes du Ø. */
export function articlesPour(tarif, mapping, diametre) {
  const gammes = new Set(mapping.map((m) => m.gamme_tarif));
  const sansD = new Set(mapping.filter((m) => !motifDependDuDiametre(m.motif_code)).map((m) => m.gamme_tarif));
  return tarif.filter((a) => a.is_active && gammes.has(a.gamme_tarif) && (a.diametre_int === diametre || a.diametre_int == null || sansD.has(a.gamme_tarif)));
}

/** Calcule une configuration (code CFG-xx, gabarit) sur le tarif réel avec les réglages par défaut. */
export function calculerSurTarif(tarif, code, gabaritCode, releve, reglages = buildFumisterieConfig(null)) {
  return calculerMetre({ configuration: { code, gabarit_code: gabaritCode }, gabarit: lireData(GABARIT_FICHIER[gabaritCode]),
    composants: lireData(`cfg${code.slice(4)}-composants.json`), mapping: MAPPING_COMPLET, articles: articlesPour(tarif, MAPPING_COMPLET, releve.diametre), reglages, releve });
}
