// Réinjection d'un métré dans un devis (src/apps/artisan/components/devis/metre/metreModel.js) :
// les lignes du métré précédent sont remplacées, jamais doublées ; les lignes posées à la main restent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remplacerLignesMetre, versLignesDevis, finDuChapitre, aConfirmerAvantAjout } from '../../src/apps/artisan/components/devis/metre/metreModel.js';

const moteur = [
  { article_id: 'a1', libelle: 'Élément droit 1000', reference: 'PTR1000', quantite: 4, prix_vente_ht: 100 },
  { article_id: 'a2', libelle: 'Collier', reference: 'COL150', quantite: 2, prix_vente_ht: 20 },
  { article_id: null, libelle: 'Solin', reference: '', quantite: 1, prix_vente_ht: null },
];
const chapitre = (titre) => ({ line_type: 'section_title', designation: titre });
const mo = { line_type: 'labor', designation: 'Pose du conduit', quantity: 1 };

test('sans métré précédent : les lignes sont ajoutées en fin de chapitre', () => {
  const lines = [chapitre('POÊLE'), chapitre('FUMISTERIE'), mo, chapitre('MAIN D\'ŒUVRE')];
  const { lines: r, retirees } = remplacerLignesMetre(lines, 1, null, versLignesDevis(moteur, 's', 'MODINOX'));
  assert.equal(retirees, 0);
  assert.deepEqual(r.map((l) => l.designation), ['POÊLE', 'FUMISTERIE', 'Pose du conduit', 'Élément droit 1000', 'Collier', 'Solin', 'MAIN D\'ŒUVRE']);
});

test('réinjection : les lignes du métré précédent sont remplacées, quantité retouchée comprise', () => {
  const premieres = versLignesDevis(moteur, 's', 'MODINOX');
  premieres[0] = { ...premieres[0], quantity: 6, unit_price_ht: 90 }; // retouchée à la main
  const lines = [chapitre('FUMISTERIE'), ...premieres, mo, chapitre('AUTRE')];
  const nouveau = [{ ...moteur[0], quantite: 5 }, moteur[1]];
  const { lines: r, retirees } = remplacerLignesMetre(lines, 0, moteur, versLignesDevis(nouveau, 's', 'MODINOX'));
  assert.equal(retirees, 3);
  assert.deepEqual(r.map((l) => [l.designation, l.quantity]), [['FUMISTERIE', undefined], ['Pose du conduit', 1], ['Élément droit 1000', 5], ['Collier', 2], ['AUTRE', undefined]]);
});

test('une ligne identique posée à la main en plus reste (chaque ligne du moteur ne retire qu\'une ligne)', () => {
  const lines = [chapitre('FUMISTERIE'), ...versLignesDevis(moteur, 's', 'X'), versLignesDevis([moteur[1]], 's', 'X')[0]];
  const { lines: r, retirees } = remplacerLignesMetre(lines, 0, moteur, []);
  assert.equal(retirees, 3);
  assert.deepEqual(r.map((l) => l.designation), ['FUMISTERIE', 'Collier']);
});

test('les lignes d\'un autre chapitre ne sont jamais retirées', () => {
  const lines = [chapitre('STOCK'), ...versLignesDevis([moteur[1]], 's', 'X'), chapitre('FUMISTERIE'), ...versLignesDevis(moteur, 's', 'X')];
  const { lines: r, retirees } = remplacerLignesMetre(lines, 2, moteur, []);
  assert.equal(retirees, 3);
  assert.deepEqual(r.map((l) => l.designation), ['STOCK', 'Collier', 'FUMISTERIE']);
});

test('une ligne enregistrée (référence nulle, espaces) se reconnaît', () => {
  const enBase = { line_type: 'product', supplier_product_id: null, designation: 'Solin ', reference: null, quantity: 1 };
  const { retirees } = remplacerLignesMetre([chapitre('FUMISTERIE'), enBase], 0, [moteur[2]], []);
  assert.equal(retirees, 1);
});

test('fin de chapitre : avant le chapitre suivant, ou en fin de devis', () => {
  const lines = [chapitre('A'), mo, chapitre('B'), mo, mo];
  assert.equal(finDuChapitre(lines, 0), 2);
  assert.equal(finDuChapitre(lines, 2), 5);
});

test('versLignesDevis : rien d’interne dans la description (elle s’imprime sur le devis client)', () => {
  const lignes = versLignesDevis([...moteur, { article_id: 'a3', libelle: 'Support', reference: 'S', quantite: 1, prix_vente_ht: 10, statut: 'provisoire', sous_libelle: '1 par plancher' }], 's', 'X');
  for (const l of lignes) assert.doesNotMatch(l.description, /CHIFFRER|provisoire/i);
  assert.equal(lignes[2].unit_price_ht, 0); // pièce sans article : 0 €, « à chiffrer » se lit sur le prix
  assert.equal(lignes[3].description, '1 par plancher');
});
test('versLignesDevis : la TVA du devis l’emporte sur celle du moteur', () => {
  const avecTva = moteur.map((l) => ({ ...l, tva: 20 }));
  assert.deepEqual(versLignesDevis(avecTva, 's', 'X', 5.5).map((l) => l.tva_rate), [5.5, 5.5, 5.5]);
  assert.deepEqual(versLignesDevis(avecTva, 's', 'X', 20).map((l) => l.tva_rate), [20, 20, 20]);
  assert.deepEqual(versLignesDevis(avecTva, 's', 'X').map((l) => l.tva_rate), [20, 20, 20]);
});
test('aConfirmerAvantAjout : pièces sans prix et alertes à accepter', () => {
  const resultat = { lignes: [...moteur, { article_id: 'a4', libelle: 'Té', quantite: 1, prix_vente_ht: 30, statut: 'provisoire' }],
    alertes: [{ niveau: 'warn', code: 'zone', message: 'Zone 1 non tenue' }, { niveau: 'warn', code: 'article_manquant', message: 'x' }, { niveau: 'info', code: 'i', message: 'y' }] };
  const c = aConfirmerAvantAjout(resultat);
  assert.deepEqual(c.sansPrix, ['Solin']);
  assert.deepEqual(c.aValider, ['Té']);
  assert.deepEqual(c.alertes.map((a) => a.code), ['zone']);
  assert.equal(c.vide, false);
  assert.equal(aConfirmerAvantAjout({ lignes: moteur.slice(0, 2), alertes: [] }).vide, true);
});
