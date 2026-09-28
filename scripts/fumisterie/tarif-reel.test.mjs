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

// ---------------------------------------------------------------------------------------------
// Tranche 2 — gabarit G4 (tubage) sur le tarif réel. Les références pinnées ci-dessous sont celles
// qu'un tubage doit produire chez MODINOX ; une régression du parseur, du mapping ou des règles
// doit se voir ici, jamais en prod.
// ---------------------------------------------------------------------------------------------
import { motifDependDuDiametre } from '../../src/lib/fumisterie/articles.js';
const lireData = (f) => JSON.parse(readFileSync(new URL(`./data/${f}`, import.meta.url), 'utf8'));
const MAPPING_G4 = lireData('g4-mapping.json');
const GABARIT_G4 = lireData('gabarit-g4.json');
const GABARIT_G4R = lireData('gabarit-g4r.json');
/** Comme fumisterieService.getArticles : au Ø du relevé, plus les gammes dont le mapping ne dépend pas du Ø. */
const articlesG4 = (diametre) => {
  const gammes = new Set(MAPPING_G4.map((m) => m.gamme_tarif));
  const sansD = new Set(MAPPING_G4.filter((m) => !motifDependDuDiametre(m.motif_code)).map((m) => m.gamme_tarif));
  return TARIF.filter((a) => a.is_active && gammes.has(a.gamme_tarif) && (a.diametre_int === diametre || sansD.has(a.gamme_tarif)));
};
const calculerG4 = (code, releve) => {
  const rigide = code === 'CFG-35' || code === 'CFG-27';
  return calculerMetre({ configuration: { code, gabarit_code: rigide ? 'G4R' : 'G4' }, gabarit: rigide ? GABARIT_G4R : GABARIT_G4,
    composants: lireData(`${code.toLowerCase().replace('-', '')}-composants.json`), mapping: MAPPING_G4,
    articles: articlesG4(releve.diametre), reglages: buildFumisterieConfig(null), releve });
};

test('tarif réel — CFG-34 tubage flexible pellets Ø80, entrée plafond, kit d\'air : 10 lignes, 502,17 € HT d\'achat', () => {
  const r = calculerG4('CFG-34', { diametre: 80, finition: 'noir', hBuse: 0.9, entree: 'plafond', hsp1: 2.4, raccord: 'emaille_07', hConduit: 6.2, boisseau: 1, chapeau: 'standard', kit_air: 1 });
  assert.deepEqual(alertesCatalogue(r), []);
  assert.deepEqual(refs(r.lignes), [
    '2FLECHSI80×1', '2DIVKCIRN180×1', '2FLECGAI80×1', '2FLEPOLIXT1080C×7', '2FLEEMFI80×1',
    '2FLERADE8086×1', '2FLEPHV1N80NO×1', '2PELTUYA801000NO×1', '2PELTUYA80500NO×1', '2KITEAIR033×1',
  ]);
  assert.equal(r.totaux.achat_ht, 502.17);
  assert.equal(r.totaux.lignes_a_chiffrer, 0);
  assert.equal(r.lignes.find((l) => l.composant_code === 'gaine_polylisse').unite, 'ml');
});
test('tarif réel — CFG-26 tubage flexible bûches Ø150, entrée par le mur, chapeau plat : 8 lignes, 679,61 € HT', () => {
  const r = calculerG4('CFG-26', { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'mur', hsp1: 2.5, hEntree: 1.6, lHoriz: 0.45, raccord: 'emaille_12', hConduit: 7.3, boisseau: 3, chapeau: 'plat', kit_air: 0 });
  assert.deepEqual(alertesCatalogue(r), []);
  assert.deepEqual(refs(r.lignes), [
    '2FLECHPL150×1', '2DIVKCIRN3150×1', '2FLECGAI150×1', '2FLEPOLIXT10150C×8', '2FLEEMFI150×1',
    '2FLEADA1150NO×1', '2LEPCO90150NO×1', '2LEPTUYA1501000NO×1',
  ]);
  assert.equal(r.totaux.achat_ht, 679.61);
  // Entrée par le mur : ni RDE ni plaque ventilée, pas de kit d'air
  assert.ok(!r.lignes.some((l) => ['rde', 'plaque_ventilee', 'kit_entree_air'].includes(l.composant_code)));
});
test('tarif réel — CFG-35 tubage rigide pellets Ø80 (PRH 5/10) : tout se résout sauf la plaque ARP, à chiffrer et signalée', () => {
  const r = calculerG4('CFG-35', { diametre: 80, finition: 'noir', hBuse: 0.9, entree: 'plafond', hsp1: 2.4, hConduit: 6.2, boisseau: 2 });
  assert.deepEqual(refs(r.lignes), [
    '2PRWCHSI80×1', '2DIVKCIRN280×1', '2PRWTUYA801000×6', '2PRWTUYA80250×1', 'null×1',
    '2PRWTUYA801000×1', '2PRWTUYA80500×1', '2PRWRAFF80×1',
  ]);
  assert.equal(r.totaux.lignes_a_chiffrer, 1);
  assert.equal(r.totaux.achat_ht, 336.99);
  assert.ok(alertesCatalogue(r).some((a) => a.code === 'article_manquant' && /plaque ARP/i.test(a.message)));
});
test('tarif réel — CFG-27 tubage rigide bûches Ø150 (PRH 6/10), entrée par le mur : 8 lignes, 750,45 € HT, composé en 330', () => {
  const r = calculerG4('CFG-27', { diametre: 150, finition: 'noir', hBuse: 1.05, entree: 'mur', hsp1: 2.5, hEntree: 1.6, lHoriz: 0.45, hConduit: 7.3, boisseau: 4 });
  assert.deepEqual(alertesCatalogue(r), []);
  assert.deepEqual(refs(r.lignes), [
    '2PR6CHAR150×1', '2DIVKCIRN4150×1', '2PR6TUYA1501000×7', '2PR6TUYA150330×1',
    '2PR6CO90PURG150×1', '2PR6TAMPPCO150×1', '2PR6TUYA1501000×1', '2PR6MRAC150×1',
  ]);
  assert.equal(r.totaux.achat_ht, 750.45);
});
test('tarif réel — G4 aux autres Ø : Ø180 flexible et Ø130 rigide complets ; Ø100 acier peint / chapeau plat honnêtement à chiffrer', () => {
  const r180 = calculerG4('CFG-26', { diametre: 180, finition: 'noir', hBuse: 1.05, entree: 'plafond', hsp1: 2.5, raccord: 'emaille_12', hConduit: 8, boisseau: 6, chapeau: 'standard', kit_air: 0 });
  assert.deepEqual(alertesCatalogue(r180), []);
  assert.ok(refs(r180.lignes).includes('2FLEPHV6N180NO×1') && refs(r180.lignes).includes('2FLEPOLIXT10180C×8.5'));
  const r130 = calculerG4('CFG-35', { diametre: 130, finition: 'noir', hBuse: 0.9, entree: 'mur', hsp1: 2.4, hEntree: 1.2, lHoriz: 0.3, hConduit: 5, boisseau: 3 });
  assert.deepEqual(alertesCatalogue(r130), []);
  assert.ok(refs(r130.lignes).includes('2PR6CHAR130×1'));
  const r100 = calculerG4('CFG-34', { diametre: 100, finition: 'noir', hBuse: 0.9, entree: 'mur', hsp1: 2.4, hEntree: 1.2, lHoriz: 0.3, raccord: 'acier_peint', hConduit: 5, boisseau: 5, chapeau: 'plat', kit_air: 0 });
  assert.equal(r100.totaux.lignes_a_chiffrer, 3);
  assert.ok(refs(r100.lignes).includes('2FLEADA1100NO×1'));
});
