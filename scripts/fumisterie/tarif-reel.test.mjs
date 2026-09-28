// scripts/fumisterie/tarif-reel.test.mjs
// Le moteur contre le VRAI tarif (docs/devis-fumisterie/MAYER002.xlsx, onglet « Tarif Juin26 »),
// pas contre une fixture choisie à la main : c'est là que les résolutions ambiguës se cachent
// (raccord « inverse » et collier galva retenus par ordre alphabétique avant les motifs).
// Les articles sont reconstruits comme la vue majordhome_fum_articles (parseDesignation + prix).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { parseDesignation } from './lib/parseDesignation.mjs';
import { calculerMetre } from '../../src/lib/fumisterie/index.js';
import { buildFumisterieConfig } from '../../src/lib/fumisterie/config.js';

const lire = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const COMPOSANTS = lire('./data/cfg24-composants.json');
const MAPPING = lire('./data/cfg24-mapping.json');
const GABARIT = lire('./data/gabarit-g1.json');
const CONFIGURATION = { code: 'CFG-24', gabarit_code: 'G1', gamme_principale: 'PTR30' };
const RELEVE = { diametre: 150, finition: 'noir', hBuse: 1.05, hsp1: 2.5, epPl: 0.25, nbEtages: 1, hsp2: 2.5,
  hCombles: 1.4, pente: 35, epToit: 0.3, dFaitage: 1.6, angle: 30, decal: 0.4, hSortie: 1.6 };

const cell = (row, i) => { const v = row.getCell(i + 1).value; return v && typeof v === 'object' && 'result' in v ? v.result : v; };
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(fileURLToPath(new URL('../../docs/devis-fumisterie/MAYER002.xlsx', import.meta.url)));
const ws = wb.getWorksheet('Tarif Juin26');
const TARIF = [];
ws.eachRow((row, idx) => {
  if (idx === 1) return;
  const reference = String(cell(row, 0) ?? '').trim();
  if (!reference) return;
  const name = String(cell(row, 1) ?? '').trim();
  const attrs = parseDesignation({ reference, designation: name, famille_n1: String(cell(row, 2) ?? '') });
  TARIF.push({ id: reference, reference, name, unit: String(cell(row, 8) ?? 'PC') === 'ML' ? 'ml' : 'pièce', is_active: !attrs.hors_perimetre,
    tarif_public: Number(cell(row, 10)), purchase_price_ht: Number(cell(row, 14)), ...attrs });
});
/** Comme fumisterieService.getArticles : actifs, gammes du mapping, au Ø du relevé. */
const articlesPour = (diametre) => {
  const gammes = new Set(MAPPING.map((m) => m.gamme_tarif));
  return TARIF.filter((a) => a.is_active && gammes.has(a.gamme_tarif) && a.diametre_int === diametre);
};
const calculer = (releve) => calculerMetre({ configuration: CONFIGURATION, gabarit: GABARIT, composants: COMPOSANTS, mapping: MAPPING,
  articles: articlesPour(releve.diametre), reglages: buildFumisterieConfig(null), releve });
const refs = (lignes) => lignes.map((l) => `${l.reference}×${l.quantite}`);
const alertesCatalogue = (r) => r.alertes.filter((a) => a.code === 'article_ambigu' || a.code === 'article_manquant');

test('tarif réel — cas maquette Ø150 noir : les 14 bonnes références, 1 480,90 € HT d\'achat', () => {
  assert.ok(TARIF.length > 1000, `tarif lu : ${TARIF.length} lignes`);
  const r = calculer(RELEVE);
  assert.deepEqual(alertesCatalogue(r), []);
  assert.deepEqual(refs(r.lignes), [
    '2PTICHARN150NO×1', '2PTIELDR1501000NO×1', '2PTIELDR150500NO×1', '2PTIELDR150250NO×1', '2PTICOJO150NO×3',
    '2DIVS2535IN230KEI×1', '2DIVCTOS150×1', '2PTICO30150×2', '2PTIELDR1501000×5',
    '2PTIPPDR150×2', '2PTGCOCF150×2', '2PTIRASR150148×1', '2LEPTUYA1501000NO×1', '2LEPTUYA150500NO×1',
  ]);
  assert.equal(r.totaux.achat_ht, 1480.9);
  assert.equal(r.totaux.lignes_a_chiffrer, 0);
});

test('tarif réel — Ø180 inox : tout se résout, raccord simple paroi droit (pas de réduit émaillé en Ø180)', () => {
  const r = calculer({ ...RELEVE, diametre: 180, finition: 'inox' });
  assert.deepEqual(alertesCatalogue(r), []);
  assert.equal(r.totaux.lignes_a_chiffrer, 0);
  assert.ok(refs(r.lignes).includes('2PTIRASS180×1'), refs(r.lignes).join(' '));
  assert.ok(refs(r.lignes).includes('2PTICHARN180×1'));
});

test('tarif réel — réglables (intérieur et extérieur) : un seul article chacun', () => {
  // hSortie 1,35 m → 1000 + réglable (le motif accepte ELRE, sans {LG} : la référence porte la longueur max)
  assert.ok(refs(calculer({ ...RELEVE, hSortie: 1.35 }).lignes).includes('2PTIELRE150500NO×1'));
  assert.ok(refs(calculer({ ...RELEVE, nbEtages: 0, angle: 0 }).lignes).includes('2PTIELRE150500×1'));
  for (const finition of ['noir', 'inox']) {
    for (const hSortie of [1.35, 1.4, 1.8]) {
      const r = calculer({ ...RELEVE, finition, hSortie });
      assert.deepEqual(alertesCatalogue(r), [], `${finition} hSortie ${hSortie}`);
    }
  }
});
