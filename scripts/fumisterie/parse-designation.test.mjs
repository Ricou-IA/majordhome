import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignation, normaliserGamme } from './lib/parseDesignation.mjs';

const p = (designation, extra = {}) => parseDesignation({ reference: 'X', designation, famille_n1: '20', ...extra });

test('élément droit PTR30+ inox : gamme, type, diamètre, longueur, couleur par suffixe de gamme', () => {
  const r = p('PTR30+ I - ELT DROIT - D 150 - LG 1000');
  assert.equal(r.gamme_tarif, 'PTR30+ I');
  assert.equal(r.type_piece, 'element_droit');
  assert.equal(r.diametre_int, 150);
  assert.equal(r.longueur_mm, 1000);
  assert.equal(r.couleur, 'inox');
  assert.equal(r.parse_confidence, 1);
});

test('laqué noir : couleur noir, réglable avec plage', () => {
  const r = p('PTR30+ LAQ - ELT REGLABLE - D 150 - LG 320 A 500 - INOX NOIR');
  assert.equal(r.gamme_tarif, 'PTR30+ LAQ');
  assert.equal(r.type_piece, 'element_reglable');
  assert.equal(r.longueur_mm, 320);
  assert.equal(r.longueur_max_mm, 500);
  assert.equal(r.couleur, 'noir');
});

test('diamètre extérieur entre parenthèses, couronne coupe-feu galva', () => {
  const r = p('PTR30+ G - COURONNE COUPE FEU - D 150 ( D EXT 210 )');
  assert.equal(r.type_piece, 'couronne_coupe_feu');
  assert.equal(r.diametre_int, 150);
  assert.equal(r.diametre_ext, 210);
  assert.equal(r.couleur, 'galva');
});

test('coude : angle, avec ou sans symbole degré', () => {
  assert.equal(p('PTR30+ I - COUDE 30° - D 150').angle, 30);
  assert.equal(p('PTR30+ I - COUDE 30 - D 150').angle, 30);
  assert.equal(p('PTR30+ I - COUDE 30° - D 150').type_piece, 'coude');
});

test('solin : gamme sans la plage, pente min/max, diamètre du PTR', () => {
  const r = p('SOLIN 25 A 35° INOX - PTR D 150 - FUT HT 250 ARRIERE ', { famille_n1: '27' });
  assert.equal(r.gamme_tarif, 'SOLIN INOX');
  assert.equal(r.type_piece, 'solin');
  assert.equal(r.pente_min, 25);
  assert.equal(r.pente_max, 35);
  assert.equal(r.diametre_int, 150);
});

test('collier universel : gamme normalisée (point et espaces parasites), galva', () => {
  const a = p('COLLIER UNIVERSEL (SOUS TOIT) - D 150 (PLA100 & SP150/153) - GALVA');
  const b = p('COLLIER UNIVERSEL (SOUS TOIT.) - D 180 - GALVA');
  assert.equal(a.gamme_tarif, b.gamme_tarif);
  assert.equal(a.type_piece, 'collier_sous_toiture');
  assert.equal(a.diametre_int, 150);
  assert.equal(a.couleur, 'galva');
});

test('raccord simple paroi réduit : premier diamètre = 150', () => {
  const r = p('PTR30+ I - RACCORD SIMPLE PAROI REDUIT - D 150 / D 148 ( POUR TUYAU EMAILLE D 150 )');
  assert.equal(r.type_piece, 'raccord_simple_paroi');
  assert.equal(r.diametre_int, 150);
});

test('tuyau émaillé : type element_droit, noir, gamme avec espace final normalisée', () => {
  const r = p('EMAIL LIGNE +  - TUYAU - D 150 - LG 500 - NOIR - REF.NNO1501');
  assert.equal(r.gamme_tarif, 'EMAIL LIGNE +');
  assert.equal(r.type_piece, 'element_droit');
  assert.equal(r.couleur, 'noir');
  assert.equal(r.longueur_mm, 500);
});

test('sur mesure et hors périmètre', () => {
  assert.equal(p('PTR30+ LAQ - ELT DROIT - D 150 - LG 1000 - RAL : XXXX').sur_mesure, true);
  assert.equal(p('POLYLISSE 904L - FLEXIBLE - D 80', { famille_n1: '24' }).hors_perimetre, true);
  assert.equal(p('POLYPROP - TUYAU - D 80', { famille_n1: '22' }).hors_perimetre, true);
  assert.equal(p('PTR30+ I - ELT DROIT - D 150 - LG 1000').hors_perimetre, false);
});

test('type inconnu : confiance dégradée et note', () => {
  const r = p('DIVERS - BIDULE - D 150');
  assert.equal(r.type_piece, null);
  assert.equal(r.parse_confidence, 0.6);
  assert.match(r.parse_notes, /type_piece/);
});

test('normaliserGamme', () => {
  assert.equal(normaliserGamme(' PRH 6/10 '), 'PRH 6/10');
  assert.equal(normaliserGamme('COLLIER  UNIVERSEL (SOUS TOIT.)'), 'COLLIER UNIVERSEL (SOUS TOIT)');
});
