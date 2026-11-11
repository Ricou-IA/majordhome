// Tests du relevé et de l'adaptateur des pièces détachées Invicta.
// node --test scripts/catalogue/invicta-pieces.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appareilDepuisApi, controlerReleve } from './invicta-pieces-releve.js';
import { piecesDepuisReleveInvicta, nomModele, lotsParModele, CATEGORIE_PIECE } from './invicta-pieces.js';
import { CATEGORIE_PIECE_DETACHEE, exclurePiecesDetachees, referenceLigneArticle, remisePiecesValide, connectorConfigAvecPieces } from '../../src/lib/catalogue/piecesDetachees.js';

// Réponse réduite de GET products/{publicId} (forme relevée sur le site le 2026-11-11).
const PRODUIT_API = {
  id: '95294d12-c001-4052-8923-885490eb853a', publicId: 'tyYFO8q732', reference: 'P601314', name: 'POELE OXANA - P601314',
  lifecycleStage: 'OnSale',
  image: { url: 'https://cdn/photo-763', fileId: 'f0', variants: [
    { role: 'Display', width: 153, height: 160, url: 'https://cdn/photo-153', fileId: 'f1' },
    { role: 'Zoom', width: 763, height: 800, url: 'https://cdn/photo-763', fileId: 'f2' },
  ] },
  gallery: { explodedViews: [{ url: 'https://cdn/vue-692', fileId: 'v0', variants: [
    { role: 'Display', width: 141, height: 160, url: 'https://cdn/vue-141', fileId: 'v1' },
    { role: 'Zoom', width: 692, height: 787, url: 'https://cdn/vue-692', fileId: 'v2' },
  ] }] },
  items: [
    { reference: '23', quantity: 5, notes: '', item: { publicId: 'hle8yJBfXb', reference: 'AS700180A', name: 'KIT ATTACHES VITRE', price: 13.65, taxRate: 0.2, weight: 0.015, unitCode: 'PCE', isPurchasable: true, isBundle: true, isVirtualKit: true, onlyAvailableInBundle: false, lifecycleStage: 'OnSale', replacementProduct: null, stockAvailable: null, image: null } },
    { reference: '7-14', quantity: 1, notes: '(Boitier Insertion SOFT)', item: { publicId: 'p2', reference: 'F670671B', name: 'TAQUE', price: 51.2, taxRate: 0.2, weight: 4, unitCode: 'PCE', isPurchasable: true, isBundle: false, isVirtualKit: false, onlyAvailableInBundle: false, lifecycleStage: 'Discontinued', replacementProduct: { id: 'x', publicId: 'y', reference: 'F670807B', name: 'TAQUE FABRILOR SERIE 700', description: '<p>DIM</p>' }, stockAvailable: 3, image: { url: 'https://cdn/piece', fileId: 'i0', variants: [] } } },
  ],
};
const DOCS_API = [{ id: 'd1', type: 'Notice', label: 'Notice', fileKey: 'k1', publicFileKey: 'k1', displayOrder: 0 }];

test('appareilDepuisApi garde repère, quantité, remarque et la pièce', () => {
  const a = appareilDepuisApi(PRODUIT_API, DOCS_API, 'Poêles');
  assert.equal(a.reference, 'P601314');
  assert.equal(a.categorie, 'Poêles');
  assert.equal(a.items[0].repere, '23');
  assert.equal(a.items[0].quantity, 5);
  assert.equal(a.items[0].piece.reference, 'AS700180A');
  assert.equal(a.items[0].piece.price, 13.65);
  assert.equal(a.items[0].piece.isVirtualKit, true);
  assert.equal(a.items[1].repere, '7-14');
  assert.equal(a.items[1].notes, '(Boitier Insertion SOFT)');
  assert.deepEqual(a.items[1].piece.remplacement, { reference: 'F670807B', name: 'TAQUE FABRILOR SERIE 700' });
  assert.equal(a.items[1].piece.image_url, 'https://cdn/piece');
  assert.equal(a.vues_eclatees.length, 1);
  assert.deepEqual(a.vues_eclatees[0], { url: 'https://cdn/vue-692', fileId: 'v2', width: 692, height: 787 });
  assert.equal(a.photo.width, 763);
  assert.equal(a.documents[0].type, 'Notice');
  assert.equal(a.documents[0].fileKey, 'k1');
});

test('appareilDepuisApi : appareil sans image, sans vue, sans pièce', () => {
  const a = appareilDepuisApi({ id: 'i', publicId: 'p', reference: 'P1', name: 'X - P1' }, [], 'Foyers');
  assert.equal(a.photo, null);
  assert.deepEqual(a.vues_eclatees, []);
  assert.deepEqual(a.items, []);
});

test('controlerReleve refuse un rayon incomplet', () => {
  const r = controlerReleve({ categories: [{ publicId: 'x', name: 'Poêles', total: 3 }], appareils: [{ categorie: 'Poêles', reference: 'P1', items: [] }] });
  assert.equal(r.ok, false);
  assert.match(r.erreurs[0], /Poêles : 1 \/ 3/);
});

test('controlerReleve refuse un appareil non lu (session expirée)', () => {
  const r = controlerReleve({ categories: [{ name: 'Poêles', total: 1 }], appareils: [{ categorie: 'Poêles', reference: 'P601314', erreur: 'HTTP 401 (session expirée ? reconnectez-vous)' }] });
  assert.equal(r.ok, false);
  assert.match(r.erreurs[0], /P601314/);
  assert.match(r.erreurs[0], /401/);
});

test('controlerReleve refuse un relevé sans rayon et accepte un relevé complet', () => {
  assert.equal(controlerReleve({ categories: [], appareils: [] }).ok, false);
  assert.equal(controlerReleve({ categories: [{ name: 'Poêles', total: 1 }], appareils: [{ categorie: 'Poêles', reference: 'P1', items: [] }] }).ok, true);
});

// Le script de console recopie les fonctions du module : la copie doit être identique à la source.
test('dump-invicta-pieces.browser.js recopie invictaPiecesReleve.js à l\'identique', () => {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const source = readFileSync(new URL('./invicta-pieces-releve.js', import.meta.url), 'utf8');
  const script = norm(readFileSync(new URL('./dump-invicta-pieces.browser.js', import.meta.url), 'utf8'));
  for (const nom of ['plusGrandeVariante', 'appareilDepuisApi', 'controlerReleve']) {
    const m = source.match(new RegExp(`export function ${nom}\\([\\s\\S]*?\\n}\\n`));
    assert.ok(m, `fonction ${nom} introuvable dans la source`);
    assert.ok(script.includes(norm(m[0].replace('export function', 'function'))), `copie de ${nom} différente de la source`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Adaptateur : relevé → pièces, modèles, nomenclature
// ---------------------------------------------------------------------------------------------------------------
const piece = (reference, price, extra = {}) => ({
  publicId: reference, reference, name: `PIECE ${reference}`, price, taxRate: 0.2, weight: 1, unitCode: 'PCE', isPurchasable: true,
  isBundle: false, isVirtualKit: false, onlyAvailableInBundle: false, lifecycleStage: 'OnSale', stockAvailable: 4, image_url: null,
  remplacement: null, ...extra,
});
const appareil = (reference, name, items) => ({
  id: `id-${reference}`, publicId: `pub-${reference}`, reference, name, categorie: 'Poêles', lifecycleStage: 'OnSale', photo: null,
  vues_eclatees: [], documents: [], items,
});
const releveDe = (appareils) => ({
  source: 'https://pieces-detachees.invicta-group.fr/api/1.0.0/ (session connectée)', fetched_at: '2026-11-11T10:00:00.000Z',
  manufacturer: { publicId: 'VdklLfh0Fp', name: 'Invicta' }, categories: [{ publicId: 'c', name: 'Poêles', total: appareils.length }], appareils,
});
const FIXTURE = () => releveDe([
  appareil('P601314', 'POELE OXANA - P601314', [
    { repere: '30', quantity: 1, notes: '', piece: piece('F670108B', 79.84) },
    { repere: '7-14', quantity: 2, notes: '(noir)', piece: piece('KIT1', 13.65, { isBundle: true, isVirtualKit: true }) },
  ]),
  appareil('P601354', 'POELE REMETEA 6KW - P601354', [
    { repere: '4', quantity: 1, notes: '', piece: piece('F670108B', 79.84) },
    { repere: '5', quantity: 1, notes: '', piece: piece('OLD1', 20, { lifecycleStage: 'Discontinued', remplacement: { reference: 'NEW1', name: 'N' } }) },
    { repere: '6', quantity: 1, notes: '', piece: piece('GRATIS', null, { isPurchasable: false, unitCode: 'MTR', lifecycleStage: 'UntilEndOfStock' }) },
  ]),
]);
const OPTS = { version: 'invicta-pieces_2026-11-11', remisePct: 30, referencesTarif: [] };

test('une pièce partagée sort une seule fois, la nomenclature garde chaque ligne', () => {
  const r = piecesDepuisReleveInvicta(FIXTURE(), OPTS);
  assert.equal(r.pieces.length, 4);
  assert.equal(r.nomenclature.length, 5);
  assert.deepEqual(r.nomenclature[1], { modele_source_id: 'pub-P601314', modele_reference: 'P601314', position: 2, repere: '7-14', piece_reference: 'KIT1', quantity: 2, notes: '(noir)', prix_public: 13.65 });
  assert.equal(r.nomenclature[2].position, 1);
  assert.equal(r.compteRendu.appareils, 2);
});

test('prix : public = vente par défaut, achat = public moins la remise', () => {
  const p = piecesDepuisReleveInvicta(FIXTURE(), OPTS).pieces.find((x) => x.reference === 'F670108B');
  assert.equal(p.tarif_public, 79.84);
  assert.equal(p.selling_price_ht_defaut, 79.84);
  assert.equal(p.purchase_price_ht, 55.89);
  assert.equal(p.taux_remise, 30);
  assert.equal(p.category, CATEGORIE_PIECE);
  assert.equal(p.product_kind, 'accessory');
  assert.equal(p.brand, 'Invicta');
  assert.equal(p.unit, 'pièce');
  assert.equal(p.specs.source_version, 'invicta-pieces_2026-11-11');
});

test('remise absente ou non numérique : achat = public, avertissement, jamais NaN', () => {
  for (const remisePct of [undefined, null, '', 'abc', -5, 100]) {
    const r = piecesDepuisReleveInvicta(FIXTURE(), { ...OPTS, remisePct });
    const p = r.pieces.find((x) => x.reference === 'F670108B');
    assert.equal(p.taux_remise, 0);
    assert.equal(p.purchase_price_ht, 79.84);
    assert.match(r.compteRendu.avertissements.join(' '), /remise absente/);
    assert.ok(r.pieces.every((x) => Number.isFinite(x.purchase_price_ht)));
  }
});

test('même référence à deux prix selon l’appareil : pièce sans prix au catalogue, prix gardé sur chaque ligne', () => {
  const rel = FIXTURE();
  rel.appareils[1].items[0].piece.price = 81;
  const r = piecesDepuisReleveInvicta(rel, OPTS);
  const p = r.pieces.find((x) => x.reference === 'F670108B');
  assert.equal(p.tarif_public, 0);
  assert.equal(p.purchase_price_ht, 0);
  assert.equal(p.selling_price_ht_defaut, 0);
  assert.equal(p.specs.canonical.prix_selon_appareil, true);
  assert.deepEqual(r.nomenclature.filter((l) => l.piece_reference === 'F670108B').map((l) => l.prix_public), [79.84, 81]);
  assert.equal(r.compteRendu.prix_selon_appareil, 1);
  assert.equal(r.compteRendu.sans_prix, 1);
});

test('référence déjà au tarif : pas réécrite, comptée, toujours dans la nomenclature', () => {
  const r = piecesDepuisReleveInvicta(FIXTURE(), { ...OPTS, referencesTarif: ['F670108B'] });
  assert.equal(r.pieces.some((p) => p.reference === 'F670108B'), false);
  assert.equal(r.compteRendu.deja_au_tarif, 1);
  assert.deepEqual(r.compteRendu.references_deja_au_tarif, ['F670108B']);
  assert.equal(r.nomenclature.filter((l) => l.piece_reference === 'F670108B').length, 2);
});

test('pièce avec un prix sur un appareil et sans prix sur un autre : le prix réel est gardé', () => {
  const rel = FIXTURE();
  rel.appareils[1].items[0].piece.price = null;
  const r = piecesDepuisReleveInvicta(rel, OPTS);
  const p = r.pieces.find((x) => x.reference === 'F670108B');
  assert.equal(p.tarif_public, 79.84);
  assert.equal(p.purchase_price_ht, 55.89);
  assert.equal(p.specs.canonical.prix_selon_appareil, false);
  assert.deepEqual(r.nomenclature.filter((l) => l.piece_reference === 'F670108B').map((l) => l.prix_public), [79.84, null]);
  assert.equal(r.compteRendu.prix_selon_appareil, 0);
});

test('appareil sans aucune pièce : compté et nommé', () => {
  const rel = FIXTURE();
  rel.appareils.push(appareil('P999', 'POELE VIDE - P999', []));
  const c = piecesDepuisReleveInvicta(rel, OPTS).compteRendu;
  assert.equal(c.appareils_sans_piece, 1);
  assert.deepEqual(c.references_sans_piece, ['P999']);
});

test('pièce sans prix ou non achetable : relevée à 0, non vendue seule', () => {
  const r = piecesDepuisReleveInvicta(FIXTURE(), OPTS);
  const p = r.pieces.find((x) => x.reference === 'GRATIS');
  assert.equal(p.purchase_price_ht, 0);
  assert.equal(p.selling_price_ht_defaut, 0);
  assert.equal(p.specs.canonical.vendue_seule, false);
  assert.equal(p.unit, 'mtr');
  assert.equal(p.specs.canonical.cycle_de_vie, 'fin_de_stock');
  assert.equal(r.compteRendu.sans_prix, 1);
});

test('cycle de vie, remplacement, kit', () => {
  const r = piecesDepuisReleveInvicta(FIXTURE(), OPTS);
  const old = r.pieces.find((x) => x.reference === 'OLD1');
  assert.equal(old.specs.canonical.cycle_de_vie, 'arretee');
  assert.equal(old.specs.canonical.remplacee_par, 'NEW1');
  assert.equal(r.pieces.find((x) => x.reference === 'KIT1').specs.canonical.kit, true);
  assert.equal(r.pieces.find((x) => x.reference === 'F670108B').specs.canonical.cycle_de_vie, 'en_vente');
  assert.deepEqual([r.compteRendu.arretees, r.compteRendu.remplacees, r.compteRendu.kits], [1, 1, 1]);
  assert.equal(r.compteRendu.somme_prix_public, 113.49);
});

test('relevé vide, sans version ou appareil en double : erreur', () => {
  assert.throws(() => piecesDepuisReleveInvicta(releveDe([]), OPTS), /vide/);
  assert.throws(() => piecesDepuisReleveInvicta(FIXTURE(), { remisePct: 30 }), /version/);
  const rel = FIXTURE(); rel.appareils[1].publicId = 'pub-P601314';
  assert.throws(() => piecesDepuisReleveInvicta(rel, OPTS), /double/);
  // même référence fabricant, deux appareils du site : acceptés tous les deux
  const rel2 = FIXTURE(); rel2.appareils[1].reference = 'P601314';
  assert.equal(piecesDepuisReleveInvicta(rel2, OPTS).modeles.length, 2);
});

test('nomModele', () => {
  assert.equal(nomModele('POELE OXANA - P601314', 'P601314'), 'OXANA');
  assert.equal(nomModele('POELE A GRANULES THERA - P614044', 'P614044'), 'THERA');
  assert.equal(nomModele('POELE PELETS SOFIA BLANC - P618970', 'P618970'), 'SOFIA BLANC');
  assert.equal(nomModele('ADELIE - C07720.XX', 'C07720.XX'), 'ADELIE');
  assert.equal(nomModele('POELE - P1', 'P1'), 'POELE');
  assert.equal(nomModele('MODELE SANS REFERENCE', 'P9'), 'MODELE SANS REFERENCE');
});

test('modèle : nom nettoyé, source, vues', () => {
  const m = piecesDepuisReleveInvicta(FIXTURE(), OPTS).modeles[1];
  assert.equal(m.model_name, 'REMETEA 6KW');
  assert.equal(m.brand, 'Invicta');
  assert.deepEqual(m.source, { site: 'https://pieces-detachees.invicta-group.fr', publicId: 'pub-P601354', version: 'invicta-pieces_2026-11-11' });
});

test('lotsParModele ne coupe jamais un modèle', () => {
  const r = piecesDepuisReleveInvicta(FIXTURE(), OPTS);
  assert.deepEqual(lotsParModele([], [], 60), []);
  const lots = lotsParModele(r.modeles, r.nomenclature, 1);
  assert.equal(lots.length, 2);
  assert.equal(lots[0].parts.length, 2);
  assert.equal(lots[1].parts.length, 3);
  assert.ok(lots[1].parts.every((l) => l.modele_reference === 'P601354'));
  assert.equal(lotsParModele(r.modeles, r.nomenclature, 60).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Règles d'écran : devis et fiche fournisseur
// ---------------------------------------------------------------------------------------------------------------
test('exclurePiecesDetachees : écartées des chapitres équipement et option seulement', () => {
  assert.equal(exclurePiecesDetachees('equipement'), true);
  assert.equal(exclurePiecesDetachees('option'), true);
  assert.equal(exclurePiecesDetachees('libre'), false);
  assert.equal(exclurePiecesDetachees('stock'), false);
  assert.equal(exclurePiecesDetachees(undefined), false);
  assert.equal(CATEGORIE_PIECE_DETACHEE, CATEGORIE_PIECE);
});

test('referenceLigneArticle : référence interne, sinon référence fournisseur pour une pièce', () => {
  const refs = { l1: ' F670108B ' };
  assert.equal(referenceLigneArticle({ code: 'ME-12', category: 'piece_detachee', source_product_id: 'l1' }, refs), 'ME-12');
  assert.equal(referenceLigneArticle({ code: null, category: 'piece_detachee', source_product_id: 'l1' }, refs), 'F670108B');
  assert.equal(referenceLigneArticle({ code: '', category: 'poele', source_product_id: 'l1' }, refs), '');
  assert.equal(referenceLigneArticle({ category: 'piece_detachee', source_product_id: 'l2' }, refs), '');
  assert.equal(referenceLigneArticle({ category: 'piece_detachee', source_product_id: 'l1' }), '');
  assert.equal(referenceLigneArticle(null), '');
});

test('remisePiecesValide et connectorConfigAvecPieces', () => {
  assert.equal(remisePiecesValide('30'), 30);
  assert.equal(remisePiecesValide('27,5'), 27.5);
  assert.equal(remisePiecesValide(0), 0);
  for (const v of ['', null, undefined, 'abc', -1, 100, '120']) assert.equal(remisePiecesValide(v), null);
  const pieces = { remise_pct: 30, marque_site: 'VdklLfh0Fp', site: 'https://x' };
  // le réglage des pièces survit à l'enregistrement de la fiche, avec la remise saisie
  assert.deepEqual(connectorConfigAvecPieces({}, pieces, '25'), { pieces: { ...pieces, remise_pct: 25 } });
  assert.deepEqual(connectorConfigAvecPieces({ sca_path: '/a', site_id: '1' }, pieces, '30'), { sca_path: '/a', site_id: '1', pieces });
  // saisie invalide : la remise en place est gardée
  assert.deepEqual(connectorConfigAvecPieces({}, pieces, 'abc'), { pieces });
  // pas de réglage de pièces : rien n'est inventé
  assert.deepEqual(connectorConfigAvecPieces({ sca_path: '/a' }, null, '30'), { sca_path: '/a' });
  assert.deepEqual(connectorConfigAvecPieces({}, undefined, ''), {});
});

// ---------------------------------------------------------------------------------------------------------------
// Relevé RÉEL du 2026-11-11 (470 appareils Invicta) : chiffres pinnés. Tout changement de l'adaptateur doit les
// laisser identiques, ou être expliqué.
// ---------------------------------------------------------------------------------------------------------------
test('relevé réel du 2026-11-11 : compteurs et somme des prix publics', () => {
  const rel = JSON.parse(readFileSync(new URL('./data/invicta-pieces-2026-11-11.json', import.meta.url), 'utf8'));
  assert.equal(controlerReleve(rel).ok, true);
  const r = piecesDepuisReleveInvicta(rel, { version: 'invicta-pieces_2026-11-11', remisePct: 30, referencesTarif: [] });
  const c = r.compteRendu;
  assert.equal(c.appareils, 470);
  assert.equal(c.pieces, 1771);
  assert.equal(c.lignes_nomenclature, 13974);
  assert.equal(c.somme_prix_public, 462562.87);
  assert.equal(c.prix_selon_appareil, 50);
  assert.equal(c.sans_prix, 2);
  assert.equal(c.arretees, 168);
  assert.equal(c.remplacees, 80);
  assert.equal(c.kits, 295);
  assert.deepEqual(c.avertissements, []);
  // cohérence interne
  const refs = new Set(r.pieces.map((p) => p.reference));
  assert.equal(refs.size, r.pieces.length);
  assert.ok(r.pieces.every((p) => p.reference && p.name && Number.isFinite(p.purchase_price_ht) && p.purchase_price_ht <= p.tarif_public));
  assert.ok(r.nomenclature.every((l) => refs.has(l.piece_reference)));
  assert.equal(new Set(r.modeles.map((m) => m.source.publicId)).size, 470);
  assert.ok(r.modeles.every((m) => m.model_name));
  // repère 30 de l'Oxana (vu à l'écran sur le site le 2026-11-11)
  const oxana = r.nomenclature.filter((l) => l.modele_reference === 'P601314');
  assert.equal(oxana.length, 22);
  assert.deepEqual(oxana.filter((l) => l.repere === '30').map((l) => [l.piece_reference, l.prix_public]), [['F670108B', 79.84]]);
  assert.equal(r.pieces.find((p) => p.reference === 'F670108B').purchase_price_ht, 55.89);
});
