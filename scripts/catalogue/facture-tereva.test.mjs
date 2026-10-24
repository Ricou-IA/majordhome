// node --test scripts/catalogue/facture-tereva.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parserFactureTereva, estReference, UNITES_FACTURATION } from './facture-tereva.js';
import { ligne, ligneEspacee, page } from './mots-fixture.mjs';

/** Relevé DocuWare (lettres espacées) : abscisses relevées sur les PDF réels. */
function docuware() {
  return [page(1,
    ligneEspacee(196, [29, 'FACTURE'], [77, '26010462407'], [148, 'DU'], [165, '31/07/2026']),
    ligneEspacee(216, [16, 'NUMERO'], [305, 'U'], [435, 'PRIX UNITAIRE'], [515, 'MONTANT']),
    ligneEspacee(225, [17, 'ARTICLE'], [306, 'F'], [456, 'NET'], [509, 'HORS TAXES']),
    ligneEspacee(258, [65, 'V.CDE:'], [136, 'MARTIN'], [254, '- - - - -']),
    ligneEspacee(267, [71, '8/07/26'], [118, 'BL'], [136, 'CGX230'], [462, 'DFMC']),
    ligneEspacee(276, [17, '2040463'], [65, 'COLLIERS INCOLORES 3,6 X 292'], [266, '100'], [308, '3'], [462, '9,33'], [539, '9,33'], [574, '2']),
    ligneEspacee(285, [65, 'L-3.5-300']),
    ligneEspacee(294, [17, '4467946'], [65, 'MONOSPLIT MURAO PREM.BLC 4200W'], [278, '1'], [308, '1'], [373, '**PROMO**'], [450, '1102,90'], [515, '1.102,90'], [574, '2']),
    ligneEspacee(303, [65, '873978 + 872154']),
    ligneEspacee(312, [65, 'ECO-PARTICIPATION DEEE'], [278, '1'], [462, '9,44'], [539, '9,44'], [574, '2']),
    ligneEspacee(321, [17, '511791Z'], [65, 'COQUILLE ANTI-BRUIT'], [278, '2'], [308, '1'], [456, '24,17'], [533, '48,34'], [574, '2']),
    ligneEspacee(330, [65, 'POLYETHYLENE - LE RLX']),
    ligneEspacee(339, [17, '4000425'], [65, 'SAC DE PELLETS 15 KG'], [272, '10'], [308, '1'], [462, '5,54'], [533, '55,40'], [574, '1']),
    ligneEspacee(348, [231, 'TOTAL BL'], [515, '1.225,41']),
    ligne(728, [64, 'MARCHANDISES'], [148, 'PPE'], [196, '69,00']),
    ligne(737, [148, 'F.G.'], [201, '9,90']),
    ligne(746, [237, '2'], [273, '20,00'], [344, '1.239,43'], [433, '247,89']),
    ligne(755, [148, 'DEEE'], [196, '9,44']),
    ligne(764, [83, '1.215,97'], [504, '1.487,32'], [557, 'EUR']),
  )];
}

test('DocuWare : commande, BL, unités de facturation, promo, éco-participation, références, totaux réconciliés', () => {
  const doc = parserFactureTereva(docuware());
  assert.deepEqual(doc.anomalies, []);
  assert.equal(doc.format, 'docuware');
  assert.equal(doc.type, 'facture');
  assert.equal(doc.numero, '26010462407');
  assert.equal(doc.date, '2026-07-31');
  assert.equal(doc.lignes.length, 4);
  const [colliers, split, coquille, pellets] = doc.lignes;
  assert.equal(colliers.quantite, 100);
  assert.equal(colliers.uf, '3');
  assert.equal(colliers.unite, 'pièce');
  assert.equal(colliers.prix_unitaire_net, 0.0933); // 9,33 € les cent
  assert.equal(colliers.ref_fabricant, 'L-3.5-300');
  assert.deepEqual(colliers.bl, { numero: 'CGX230', date: '2026-07-08', commande: 'MARTIN' });
  assert.equal(split.prix_unitaire_net, 1102.9);
  assert.equal(split.montant_ht, 1102.9);
  assert.equal(split.promo, true);
  assert.equal(split.eco, 9.44);
  assert.equal(split.ref_fabricant, '873978 + 872154');
  assert.equal(coquille.code, '511791Z');
  assert.equal(coquille.complement, 'POLYETHYLENE - LE RLX');
  assert.equal(coquille.ref_fabricant, null);
  assert.equal(pellets.tva_taux, 10);
  assert.deepEqual(doc.totaux, { marchandises_ht: 1215.97, frais: { PPE: 69, 'F.G.': 9.9, DEEE: 9.44 }, total_ht: 1239.43, ttc: 1487.32 });
});

test('DocuWare : un TOTAL BL qui ne retombe pas sur ses lignes est une anomalie', () => {
  const pages = docuware();
  const mots = pages[0].words.filter((w) => w.y0 === 348 && w.x0 > 500);
  mots.forEach((w) => { w.t = '9'; });
  const doc = parserFactureTereva(pages);
  assert.ok(doc.anomalies.some((a) => a.startsWith('BL CGX230 : somme des lignes')), doc.anomalies.join(' | '));
});

/** Facture électronique (rendu normalisé) : nom + valeurs sur deux lignes de base à 1 pt, code en dessous. */
function eInvoice({ type = 'Facture commerciale' } = {}) {
  return [page(1,
    ligne(170, [18, 'Numéro'], [126, '26010589076']),
    ligne(186, [18, 'Date'], [44, 'd’émission'], [126, '30/09/2026']),
    ligne(219, [18, 'Type'], [44, 'de'], [59, 'vente'], [126, type]),
    ligne(565, [24, 'Produits'], [283, 'Qté'], [344, 'Prix'], [366, 'u.'], [378, 'HT'], [441, 'TVA'], [463, '(%)'], [530, 'Total'], [558, 'HT']),
    ligne(580, [24, 'OUATE'], [60, 'BLANCHE'], [110, 'MICRO']),
    ligne(581, [290, '1.0'], [358, '10,93'], [385, '€'], [461, '20.0'], [538, '10,93'], [565, '€']),
    ligne(596, [24, '4125429']),
    ligne(609, [26, '2'], [34, 'PLIS'], [57, '-'], [63, '21X23']),
    ligne(636, [26, 'TOTAL'], [59, 'BL'], [85, '10.93']),
    ligne(651, [24, 'KIT'], [42, 'PREMIUM'], [91, '8'], [100, 'OUTILS']),
    ligne(652, [290, '1.0'], [342, '1'], [348, '699,90'], [385, '€'], [461, '20.0'], [524, '1'], [530, '704,49'], [565, '€']),
    ligne(666, [24, '4563178']),
    ligne(680, [28, '**PROMO**']),
    ligne(707, [26, 'DCK853P4-QW'], [101, '+'], [109, 'DCR009-XJ']),
    ligne(720, [26, 'ECO-PARTICIPATION'], [127, 'DEEE'], [168, '4.59']),
    ligne(735, [24, 'ENCEINTE'], [76, 'BLUETOOTH']),
    ligne(736, [290, '1.0'], [361, '0,00'], [385, '€'], [461, '20.0'], [541, '0,00'], [565, '€']),
    ligne(750, [24, '4217010']),
    ligne(764, [26, 'IP67'], [49, '5W']),
    ligne(778, [26, 'TOTAL'], [59, 'BL'], [81, '1704.49']),
    ligne(803, [18, 'RCS'], [34, 'N°'], [44, 'SIREN']),
  ), page(2,
    ligne(109, [24, 'Sous-total'], [523, '1'], [530, '715,42'], [565, '€']),
    ligne(167, [359, 'Total'], [382, 'HT'], [533, '1'], [538, '814,32'], [566, '€']),
    ligne(209, [359, 'Total'], [390, 'TTC'], [521, '2'], [530, '177,18'], [564, '€']),
    ligne(510, [24, 'Total'], [50, 'montant'], [94, 'net'], [113, 'des'], [133, 'lignes'], [527, '1'], [533, '715,42'], [565, '€']),
    ligne(527, [24, 'Total'], [50, 'frais'], [535, '98,90'], [565, '€']),
    ligne(579, [24, 'Frais'], [49, 'de'], [63, 'port'], [535, '89,00'], [565, '€']),
    ligne(596, [24, 'Frais'], [49, 'Fixe'], [541, '9,90'], [565, '€']),
  )];
}

test('facture électronique : numéro, date, articles avec code, promo, éco incluse dans le total de ligne, compléments', () => {
  const doc = parserFactureTereva(eInvoice());
  assert.deepEqual(doc.anomalies, []);
  assert.equal(doc.format, 'e-invoice');
  assert.equal(doc.type, 'facture');
  assert.equal(doc.numero, '26010589076');
  assert.equal(doc.date, '2026-09-30');
  assert.equal(doc.lignes.length, 3);
  const [ouate, kit, enceinte] = doc.lignes;
  assert.equal(ouate.code, '4125429');
  assert.equal(ouate.designation, 'OUATE BLANCHE MICRO');
  assert.equal(ouate.prix_unitaire_net, 10.93);
  assert.equal(ouate.complement, '2 PLIS - 21X23');
  assert.equal(kit.code, '4563178');
  assert.equal(kit.prix_unitaire_net, 1699.9);
  assert.equal(kit.montant_ht, 1704.49);
  assert.equal(kit.eco, 4.59);
  assert.equal(kit.promo, true);
  assert.equal(kit.ref_fabricant, 'DCK853P4-QW + DCR009-XJ');
  assert.equal(enceinte.prix_unitaire_net, 0);
  assert.equal(enceinte.complement, 'IP67 5W');
  assert.equal(enceinte.ref_fabricant, null);
  assert.deepEqual(doc.totaux, { marchandises_ht: 1715.42, frais: { Total: 98.9, Port: 89, 'F.G.': 9.9 }, total_ht: 1814.32, ttc: 2177.18 });
});

test('facture électronique : un avoir est reconnu comme tel', () => {
  const doc = parserFactureTereva(eInvoice({ type: 'Avoir' }));
  assert.equal(doc.type, 'avoir');
  assert.equal(doc.lignes.length, 3);
});

test('références fabricant vs compléments ; table des unités de facturation', () => {
  assert.equal(estReference(['0601072900']), true);
  assert.equal(estReference(['873978', '+', '872154']), true);
  assert.equal(estReference(['L-3.5-300']), true);
  assert.equal(estReference(['IP67', '5W']), false);
  assert.equal(estReference(['POLYETHYLENE', '-', 'LE', 'RLX']), false);
  assert.equal(estReference(['LONGUEUR', 'DE', '2,00', 'METRE(S)']), false);
  assert.deepEqual(UNITES_FACTURATION.B, { unite: 'm', diviseur: 1000 });
  assert.deepEqual(UNITES_FACTURATION[3], { unite: 'pièce', diviseur: 100 });
});
