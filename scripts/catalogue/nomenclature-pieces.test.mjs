// Tests des règles du bloc « Pièces détachées » (src/lib/catalogue/nomenclature.js).
// node --test scripts/catalogue/nomenclature-pieces.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cle, reperesSaisis, filtrerParReperes, chercherDansNomenclature, trierParRepere, mentionsPiece, prixPublicPiece, prixVentePiece, prixAchatPiece, ligneDevisDepuisPiece,
  lignesDevisAvecPieces, descriptionSavDepuisPieces, listePiecesDisponible, liensFabricant, classerModeles, filtrerModeles, rangerDocumentsModele, titreDocumentModele,
} from '../../src/lib/catalogue/nomenclature.js';

const L = (extra = {}) => ({
  repere: '30', quantity: 1, notes: '', piece_reference: 'F670108B', piece_name: 'DEFLECTEUR INSERT 700/800', prix_public_ht: 79.84,
  selling_price_ht: 79.84, purchase_price_ht: 55.89, taux_remise: 30, unit: 'pièce', catalog_item_id: 'art-1', piece_active: true,
  cycle_de_vie: 'en_vente', remplacee_par: null, kit: false, vendue_seule: true, prix_selon_appareil: false, ...extra,
});

test('reperesSaisis et filtrerParReperes', () => {
  assert.deepEqual(reperesSaisis(' 12, 30;7  A2 '), ['12', '30', '7', 'a2']);
  const lignes = [L({ repere: '30' }), L({ repere: '7-14' }), L({ repere: '12' }), L({ repere: '30' }), L({ repere: 'A2' }), L({ repere: '' })];
  assert.equal(filtrerParReperes(lignes, '').length, 6);
  assert.equal(filtrerParReperes(lignes, '30').length, 2);            // un repère peut porter plusieurs variantes
  assert.deepEqual(filtrerParReperes(lignes, '9').map((l) => l.repere), ['7-14']); // repère dans une plage
  assert.deepEqual(filtrerParReperes(lignes, '14, 12').map((l) => l.repere), ['7-14', '12']);
  assert.deepEqual(filtrerParReperes(lignes, 'a2').map((l) => l.repere), ['A2']);
  assert.equal(filtrerParReperes(lignes, '15').length, 0);
  assert.equal(filtrerParReperes(lignes, '3').length, 0);              // « 3 » ne doit pas trouver « 30 »
  assert.deepEqual(filtrerParReperes(null, '3'), []);
});

test('mentionsPiece : arrêtée, remplacée, kit, non vendue seule, absente du relevé', () => {
  assert.deepEqual(mentionsPiece(L()), []);
  assert.deepEqual(mentionsPiece(L({ cycle_de_vie: 'arretee', remplacee_par: 'F670807B' })).map((m) => m.texte), ['Arrêtée', 'Remplacée par F670807B']);
  assert.deepEqual(mentionsPiece(L({ kit: true })).map((m) => [m.texte, m.ton]), [['Kit', 'info']]);
  assert.deepEqual(mentionsPiece(L({ vendue_seule: false, piece_active: false, cycle_de_vie: 'fin_de_stock' })).map((m) => m.cle), ['fin_de_stock', 'absente', 'non_vendue']);
  assert.deepEqual(mentionsPiece(null), []);
});

test('prix de vente et d’achat', () => {
  assert.equal(prixPublicPiece(L({ selling_price_ht: 95 })), 79.84);              // la colonne montre le prix PUBLIC, pas le prix ajusté
  assert.equal(prixPublicPiece(L({ prix_public_ht: 0 })), null);
  assert.equal(prixPublicPiece(L({ prix_public_ht: '13.65' })), 13.65);
  assert.equal(prixVentePiece(L()), 79.84);
  assert.equal(prixVentePiece(L({ selling_price_ht: 95 })), 95);                 // ajusté à la main au catalogue
  assert.equal(prixVentePiece(L({ selling_price_ht: 0 })), 79.84);
  // le prix de l'ARTICLE (ajusté dans la fiche article) prime sur celui de la ligne fournisseur
  assert.equal(prixVentePiece(L({ article_selling_price_ht: 45 })), 45);
  assert.equal(prixVentePiece(L({ article_selling_price_ht: 45, selling_price_ht: 95 })), 45);
  assert.equal(prixVentePiece(L({ article_selling_price_ht: 0, selling_price_ht: 95 })), 95);
  assert.equal(prixVentePiece(L({ catalog_item_id: null, article_selling_price_ht: 45 })), 79.84);
  // prix selon l'appareil : le prix de la ligne, jamais celui du catalogue (0)
  assert.equal(prixVentePiece(L({ prix_selon_appareil: true, selling_price_ht: 0, prix_public_ht: 13.65 })), 13.65);
  assert.equal(prixVentePiece(L({ prix_public_ht: null, selling_price_ht: 0 })), null);
  assert.equal(prixAchatPiece(L()), 55.89);
  assert.equal(prixAchatPiece(L({ prix_selon_appareil: true, purchase_price_ht: 0, prix_public_ht: 13.65 })), 9.56);
  // prix d'achat inconnu ET remise inconnue : pas de prix d'achat (jamais une marge de 0 % inventée)
  assert.equal(prixAchatPiece(L({ purchase_price_ht: 0, taux_remise: null })), null);
  assert.equal(prixAchatPiece(L({ purchase_price_ht: 0, taux_remise: 0 })), 79.84);
  assert.equal(prixAchatPiece(L({ purchase_price_ht: 0, prix_public_ht: null })), null);
});

test('ligneDevisDepuisPiece : référence fabricant, article ou ligne libre', () => {
  const l = ligneDevisDepuisPiece(L(), 2, 10);
  assert.equal(l.line_type, 'product');
  assert.equal(l.catalog_item_id, 'art-1');
  assert.equal(l.is_freeform, false);
  assert.equal(l.reference, 'F670108B');
  assert.equal(l.designation, 'DEFLECTEUR INSERT 700/800');
  assert.equal(l.quantity, 2);
  assert.equal(l.unit_price_ht, 79.84);
  assert.equal(l.purchase_price_ht, 55.89);
  assert.equal(l.tva_rate, 10);
  const libre = ligneDevisDepuisPiece(L({ catalog_item_id: null, prix_selon_appareil: true, prix_public_ht: 13.65, selling_price_ht: 0, purchase_price_ht: 0 }), 0, 20);
  assert.equal(libre.catalog_item_id, null);
  assert.equal(libre.is_freeform, true);
  assert.equal(libre.quantity, 1);
  assert.equal(libre.unit_price_ht, 13.65);
  assert.equal(ligneDevisDepuisPiece(L({ prix_public_ht: null, selling_price_ht: 0, purchase_price_ht: 0 }), 1, 20).unit_price_ht, 0); // à chiffrer
});

test('lignesDevisAvecPieces : pièces rangées sous le chapitre PIÈCES', () => {
  const titre = (designation) => ({ line_type: 'section_title', designation, quantity: 0, unit_price_ht: 0, tva_rate: 0 });
  const choix = [{ ligne: L(), quantite: 1 }, { ligne: L({ piece_reference: 'X2' }), quantite: 3 }];
  const sav = lignesDevisAvecPieces([titre('PIÈCES'), titre('MAIN D\'ŒUVRE'), titre('DÉPLACEMENT')], choix, 10);
  assert.deepEqual(sav.map((l) => l.line_type === 'section_title' ? l.designation : l.reference), ['PIÈCES', 'F670108B', 'X2', 'MAIN D\'ŒUVRE', 'DÉPLACEMENT']);
  const entretien = lignesDevisAvecPieces([titre('PRESTATIONS'), titre('Pièces')], choix, 10);
  assert.deepEqual(entretien.map((l) => l.designation).slice(0, 3), ['PRESTATIONS', 'Pièces', 'DEFLECTEUR INSERT 700/800']);
  const sansPieces = lignesDevisAvecPieces([titre('ÉQUIPEMENT'), titre('POSE')], choix, 10);
  assert.equal(sansPieces[1].reference, 'F670108B'); // pas de chapitre « pièces » : sous le premier
  assert.equal(lignesDevisAvecPieces([], choix, 10).length, 2);
  assert.equal(lignesDevisAvecPieces(null, [], 10).length, 0);
});

test('listePiecesDisponible : seule une fiche relevée chez le fabricant porte une liste de pièces', () => {
  assert.equal(listePiecesDisponible({ origin: 'releve_fabricant' }), true);
  assert.equal(listePiecesDisponible({ origin: 'web' }), false);
  assert.equal(listePiecesDisponible({ origin: 'catalogue' }), false);
  assert.equal(listePiecesDisponible({}), true); // fiche sans origine (avant le référentiel) : relevée
  assert.equal(listePiecesDisponible(null), true); // pas encore chargée : on ne cache rien
});

test('liensFabricant : notice, fiche, photo puis page du fabricant ; adresses non web écartées, sans doublon', () => {
  const page = 'https://jolly-mec.it/fr/produit/bridge-6-kw/12/';
  const liens = liensFabricant({
    source_urls: [page, 'https://autre.fr/x'],
    source: { liens: {
      photo: 'https://jolly-mec.it/p.jpg',
      notice: { url: 'https://jolly-mec.it/frontend/products/download/3030/', label: 'Manuel' },
      fiche: { url: 'javascript:alert(1)', label: 'Fiche produit' },
    } },
  });
  assert.deepEqual(liens, [
    { type: 'notice', label: 'Manuel', url: 'https://jolly-mec.it/frontend/products/download/3030/' },
    { type: 'photo', label: 'Photo', url: 'https://jolly-mec.it/p.jpg' },
    { type: 'page', label: 'Page du fabricant', url: page },
  ]);
  assert.deepEqual(liensFabricant({ source_urls: [page], source: { liens: { notice: { url: page, label: 'Notice' } } } }).map((l) => l.type), ['notice']);
  assert.deepEqual(liensFabricant({ source: { site: 'https://pieces.invicta' } }), []); // fiche relevée : rien
  assert.deepEqual(liensFabricant(null), []);
});

test('descriptionSavDepuisPieces : appareil puis quantité × désignation (référence)', () => {
  const choix = [{ ligne: L({ piece_name: 'VITRE POELE ARATOS', piece_reference: 'AX605344B' }), quantite: 1 }, { ligne: L({ piece_name: '', piece_reference: 'AV6306250' }), quantite: 2 }];
  assert.equal(descriptionSavDepuisPieces({ brand: 'INVICTA', model: 'ARATOS' }, choix),
    'Remplacement de pièces — INVICTA ARATOS : 1 × VITRE POELE ARATOS (AX605344B), 2 × AV6306250');
  assert.equal(descriptionSavDepuisPieces({ brand: null, model: ' ' }, [choix[0]]), 'Remplacement de pièces : 1 × VITRE POELE ARATOS (AX605344B)');
  assert.equal(descriptionSavDepuisPieces(null, []), 'Remplacement de pièces');
});

const M = (reference, model_name, extra = {}) => ({ id: reference + model_name, reference, model_name, name: `POELE ${model_name} - ${reference}`, is_active: true, ...extra });
const MODELES = [M('P611444', 'ANTAYA'), M('P601314', 'OXANA'), M('P618444', 'PYRA'), M('P641980', 'LODI 8'), M('P641987', 'LODI 8 WIFI'), M('P917044', 'SIAM'), M('P687644', 'FOYER 700 DO INVICTA EXPORT', { is_active: false })];

test('classerModeles : référence exacte, nom, contenance, premier mot', () => {
  const top = (model) => classerModeles(MODELES, { model })[0];
  assert.deepEqual([top('611444').modele.reference, top('611444').score], ['P611444', 100]);
  assert.deepEqual([top('p601314').modele.reference, top('p601314').score], ['P601314', 100]);
  assert.deepEqual([top('rustica p 917044').modele.reference, top('rustica p 917044').score], ['P917044', 100]);
  assert.deepEqual([top('Pyra').modele.reference, top('Pyra').score], ['P618444', 80]);
  const lodi = classerModeles(MODELES, { model: 'lodi' }).filter((c) => c.score > 0);
  assert.deepEqual(lodi.map((c) => [c.modele.reference, c.score]), [['P641980', 50], ['P641987', 50]]);
  assert.equal(classerModeles(MODELES, { model: 'lodi 10 wifi' }).filter((c) => c.score > 0).length, 2); // premier mot commun
  assert.equal(classerModeles(MODELES, { model: '' }).every((c) => c.score === 0), true);
  assert.equal(classerModeles(MODELES, { model: 'a6-a9' }).every((c) => c.score === 0), true);
  assert.equal(classerModeles(null, { model: 'x' }).length, 0);
  // une référence courte ne « matche » pas un modèle saisi qui la contient par hasard
  assert.equal(classerModeles([M('10', 'DIX')], { model: 'Serie 100 XL' })[0].score, 0);
  // à score égal : les modèles actifs d'abord
  assert.equal(classerModeles(MODELES, { model: '' }).at(-1).modele.reference, 'P687644');
});

test('filtrerModeles et cle', () => {
  assert.equal(cle('Jøtul F-370 é'), 'jtulf370e');
  assert.deepEqual(filtrerModeles(MODELES, 'lodi wifi').map((m) => m.reference), ['P641987']);
  assert.deepEqual(filtrerModeles(MODELES, '6014').map((m) => m.reference), []);
  assert.deepEqual(filtrerModeles(MODELES, '601314').map((m) => m.reference), ['P601314']);
  assert.equal(filtrerModeles(MODELES, '  ').length, MODELES.length);
});

test('rangerDocumentsModele : procédures à part, ordre des types, ordre d\u2019origine gardé', () => {
  const docs = [
    { id: 1, document_type: 'procedure', label: 'Mise en service' }, { id: 2, document_type: 'notice', label: 'Notice' },
    { id: 3, document_type: 'procedure', label: 'Kit Wifi' }, { id: 4, document_type: 'fiche_technique', label: 'datasheet' },
    { id: 5, document_type: 'autre', label: 'Schéma' }, { id: 6, document_type: 'vue_eclatee', label: 'Vue' }, { id: 7, document_type: 'inconnu' },
  ];
  const r = rangerDocumentsModele(docs);
  assert.deepEqual(r.principaux.map((d) => d.id), [2, 4, 6, 5, 7]);
  assert.deepEqual(r.procedures.map((d) => d.id), [1, 3]);
  assert.deepEqual(rangerDocumentsModele(null), { principaux: [], procedures: [] });
});

test('titreDocumentModele : libellé générique du site remplacé par le type', () => {
  const type = (t) => ({ fiche_technique: 'Fiche technique', notice: 'Notice technique', procedure: 'Procédure' })[t] || 'Document';
  assert.equal(titreDocumentModele({ document_type: 'fiche_technique', label: 'datasheet' }, type), 'Fiche technique');
  assert.equal(titreDocumentModele({ document_type: 'notice', label: 'Notice' }, type), 'Notice technique');
  assert.equal(titreDocumentModele({ document_type: 'notice', label: 'NOLA 8 (2)-LODI 8 (2)' }, type), 'NOLA 8 (2)-LODI 8 (2)');
  assert.equal(titreDocumentModele({ document_type: 'procedure', label: '' }, type), 'Procédure');
});

test('trierParRepere : ordre numérique, plages, non numériques puis sans repère, variantes dans l\u2019ordre d\u2019origine', () => {
  const l = (repere, id) => ({ repere, id });
  const tri = trierParRepere([l('35', 1), l('21', 2), l('10', 3), l('7-14', 4), l('2', 5), l('A2', 6), l('', 7), l('10', 8), l('100', 9), l(null, 10)]);
  assert.deepEqual(tri.map((x) => x.id), [5, 4, 3, 8, 2, 1, 9, 6, 7, 10]);
  assert.deepEqual(trierParRepere(null), []);
});

test('chercherDansNomenclature : repères ou référence / mot de la désignation', () => {
  const lignes = [
    L({ repere: '17', piece_reference: 'F610592B AM', piece_name: 'KIT "TAQUE ANCIEN MODELE"' }),
    L({ repere: '35', piece_reference: 'AT610109A', piece_name: 'REGISTRE AIR SECONDAIRE' }),
    L({ repere: '7-14', piece_reference: 'G300306J', piece_name: 'KIT ENS.FAC/POR. OXANA' }),
    L({ repere: 'A2', piece_reference: 'AI303008', piece_name: 'JOINT THERMOCORDE D8' }),
  ];
  const refs = (saisie) => chercherDansNomenclature(lignes, saisie).map((l) => l.piece_reference);
  assert.equal(refs('').length, 4);
  assert.deepEqual(refs('17'), ['F610592B AM']);
  assert.deepEqual(refs('17 35'), ['F610592B AM', 'AT610109A']);
  assert.deepEqual(refs('9'), ['G300306J']);                       // repère dans une plage
  assert.deepEqual(refs('a2'), ['AI303008']);                      // repère non numérique
  assert.deepEqual(refs('F610592B'), ['F610592B AM']);             // référence de la notice → ligne du site
  assert.deepEqual(refs('at610109a'), ['AT610109A']);
  assert.deepEqual(refs('taque'), ['F610592B AM']);
  assert.deepEqual(refs('thermocorde, 35'), ['AT610109A', 'AI303008']);
  assert.deepEqual(refs('zz'), []);                                // trop court pour un texte, pas un repère connu
  assert.deepEqual(chercherDansNomenclature(null, 'x'), []);
});
