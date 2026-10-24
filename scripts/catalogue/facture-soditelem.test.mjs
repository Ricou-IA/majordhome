// node --test scripts/catalogue/facture-soditelem.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parserFactureSoditelem, corrigerGlyphesSoditelem } from './facture-soditelem.js';
import { ligne, page } from './mots-fixture.mjs';

/** Relevé SODITELEM minimal, géométrie relevée sur les PDF réels (abscisses des colonnes). */
function releve({ type = 'FACTURE' } = {}) {
  return [page(1,
    ligne(214, [10, type]),
    ligne(237, [10, 'N°'], [28, '585650'], [100, 'DU'], [124, '31/08/26'], [214, 'Client'], [256, ':'], [268, 'G00100']),
    ligne(261, [16, 'Code'], [46, 'article'], [131, 'DESIGNATION'], [251, 'Qté'], [293, 'Prix'], [323, 'de'], [341, 'base'], [371, 'R1%'], [395, 'R2%'], [426, 'P.U.net'], [492, 'H.T.']),
    ligne(272, [16, 'BL'], [40, 'n°'], [58, '539011'], [106, 'du'], [130, '17/08/26'], [190, 'Réf'], [214, 'doc:ANNULE']),
    ligne(283, [16, 'GRE3NGR2321'], [424, '178.0000']),
    ligne(285, [112, 'UI'], [124, 'PULAR'], [149, '12'], [162, 'A1'], [308, '178.0000']),
    ligne(294, [16, 'BL'], [40, 'n°'], [58, '539012'], [106, 'du'], [130, '17/08/26'], [190, 'Réf'], [214, 'doc:OBIERTI']),
    ligne(305, [16, 'LEG050416'], [436, '4.3046'], [508, '4.30']),
    ligne(307, [112, 'FICHE'], [137, '2P+T'], [158, 'FR'], [260, '1.00'], [316, '6.9993'], [365, '25.00'], [391, '18.00']),
    ligne(316, [16, 'SAPSEL.3.425R'], [436, '0.0712'], [508, '7.12']),
    ligne(318, [112, 'Collier'], [145, '280x4,5'], [179, 'noir'], [200, '100'], [216, 'pièce'], [252, '100.00'], [316, '0.0890'], [365, '20.00']),
    ligne(327, [431, 'DEEE'], [461, ':'], [509, '1.75']),
    ligne(338, [16, 'CBMCLI02380'], [424, '153.7770'], [496, '153.78']),
    ligne(340, [112, 'VacuomΦtre'], [158, 'digital'], [260, '1.00'], [308, '236.5800'], [365, '35.00']),
    ligne(349, [352, 'Frais'], [388, 'de'], [406, 'port'], [514, '35.00']),
    ligne(618, [406, 'F.F'], [526, '2.00']),
    ligne(665, [28, 'Dont'], [58, 'frais'], [94, 'de'], [112, 'port'], [142, 'H.T.:'], [250, 'Dont'], [280, 'D3E'], [304, ':'], [340, '1.75'], [406, 'TOTAL'], [442, 'H.T'], [466, 'NET'], [520, '168.95']),
    ligne(676, [406, 'MONTANT'], [454, 'TVA(20%)'], [526, '33.79']),
    ligne(698, [388, 'TOTAL'], [431, 'T.T.C.€'], [521, '202.74']),
    ligne(733, [66, 'Z.A'], [78, 'DE'], [89, 'PIC']),
  )];
}

test('facture : numéro, date, lignes à deux lignes de base, remises R1/R2, DEEE, BL annulé, totaux réconciliés', () => {
  const doc = parserFactureSoditelem(releve());
  assert.deepEqual(doc.anomalies, []);
  assert.equal(doc.type, 'facture');
  assert.equal(doc.numero, '585650');
  assert.equal(doc.date, '2026-08-31');
  assert.equal(doc.lignes.length, 3);
  const [fiche, collier, vacuo] = doc.lignes;
  assert.equal(fiche.code, 'LEG050416');
  assert.equal(fiche.designation, 'FICHE 2P+T FR');
  assert.deepEqual(fiche.remises, [25, 18]);
  assert.equal(fiche.prix_base, 6.9993);
  assert.equal(fiche.prix_unitaire_net, 4.3046);
  assert.equal(fiche.montant_ht, 4.3);
  assert.deepEqual(fiche.bl, { numero: '539012', date: '2026-08-17', ref: 'OBIERTI' });
  assert.equal(collier.quantite, 100);
  assert.equal(collier.prix_unitaire_net, 0.0712);
  assert.equal(collier.deee, 1.75);
  assert.equal(vacuo.designation, 'Vacuomètre digital');
  assert.equal(vacuo.deee, null);
  assert.deepEqual(doc.annules, [{ code: 'GRE3NGR2321', designation: 'UI PULAR 12 A1', bl: { numero: '539011', date: '2026-08-17', ref: 'ANNULE' } }]);
  assert.deepEqual(doc.totaux, { frais_fixes: 2, port: null, deee: 1.75, total_ht: 168.95, ttc: 202.74 });
});

test('avoir : type avoir, mêmes colonnes', () => {
  const doc = parserFactureSoditelem(releve({ type: 'AVOIR' }));
  assert.equal(doc.type, 'avoir');
  assert.equal(doc.lignes.length, 3);
});

test('un total qui ne retombe pas sur les lignes est une anomalie, comme un P.U. net ≠ base − remises', () => {
  const pages = releve();
  const total = pages[0].words.find((w) => w.t === '168.95');
  total.t = '170.00';
  const doc = parserFactureSoditelem(pages);
  assert.ok(doc.anomalies.some((a) => a.includes('≠ TOTAL H.T NET 170')), doc.anomalies.join(' | '));
  const pages2 = releve();
  pages2[0].words.find((w) => w.t === '4.3046').t = '5.0000';
  const doc2 = parserFactureSoditelem(pages2);
  assert.ok(doc2.anomalies.some((a) => a.startsWith('LEG050416 : prix de base')), doc2.anomalies.join(' | '));
});

test('glyphes DOS de la police SODITELEM', () => {
  assert.equal(corrigerGlyphesSoditelem('VΘrification pompe α vide, coude 90░'), 'Vérification pompe à vide, coude 90°');
});
