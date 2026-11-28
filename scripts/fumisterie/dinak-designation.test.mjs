// Attributs DINAK lus dans les désignations (scripts/fumisterie/lib/dinak-designation.js), sur l'extrait
// RÉEL du tarif de Mayer (scripts/fumisterie/data/dinak-extrait-2026-11.json, 4 165 articles des gammes
// du périmètre, dont 183 des gammes ajoutées le 2026-11-28 : DEKO PELLETS, DEKO PELLETS 1,2 mm, DINAFLEX ISOLÉ, DINASOUCHE). Les comptes sont figés : une règle changée qui les déplace doit être expliquée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parserDinak } from './lib/dinak-designation.js';

const { articles } = JSON.parse(readFileSync(new URL('./data/dinak-extrait-2026-11.json', import.meta.url), 'utf8'));
const parse = articles.map((a) => ({ a, p: parserDinak(a) }));
const trouver = (gamme, ref) => parse.find((x) => x.a.gamme === gamme && x.a.reference === ref).p;

test('extrait réel : 4 165 articles, aucune désignation non reconnue en silence', () => {
  assert.equal(articles.length, 4165);
  const non = parse.filter((x) => !x.p.type_piece).map((x) => x.a.name);
  assert.deepEqual(non, [], `non reconnues : ${non.slice(0, 10).join(' | ')}`);
});

const NOUVELLES = ['DEKO PELLETS', 'DEKO PELLETS 1,2 mm', 'DINAFLEX ISOLÉ', 'DINASOUCHE'];
const compter = (liste) => { const c = {}; for (const { p } of liste) c[p.type_piece] = (c[p.type_piece] || 0) + 1; return c; };

test("comptes par type figés (gammes d'origine : inchangés par l'ajout des nouvelles gammes)", () => {
  assert.deepEqual(compter(parse.filter((x) => !NOUVELLES.includes(x.a.gamme))), { accessoire: 449, chapeau_anti_refouleur: 48, chapeau_pare_pluie: 50, collet_solin: 64, collier_jonction: 45,
    collier_jonction_special: 33, collier_mural: 326, collier_sous_toiture: 43, coude: 202, coude_special: 98, element_droit: 198,
    element_inspection: 36, element_reglable: 109, element_special: 27, flexible: 39, plaque_autre: 171, plaque_ecart_feu: 29,
    plaque_ecart_feu_ventilee: 29, plaque_proprete: 66, plaque_signaletique: 33, plaque_ventilee: 23, raccord_adaptation_long: 15,
    raccord_autre: 535, raccord_femelle: 27, raccord_simple_paroi: 15, reduction: 134, rosace: 58, rosace_special: 52, solin: 76, solin_autre: 311,
    support: 103, tampon: 122, te: 71, te_special: 133, terminal: 212 });
});

test('comptes par type figés (gammes ajoutées le 2026-11-28)', () => {
  assert.deepEqual(compter(parse.filter((x) => NOUVELLES.includes(x.a.gamme))), { accessoire: 26, collier_mural: 6, coude: 10, coude_special: 4,
    element_droit: 16, element_inspection: 4, element_reglable: 6, plaque_autre: 4, plaque_proprete: 8, raccord_autre: 56, reduction: 3,
    rosace: 8, rosace_special: 8, souche: 8, tampon: 4, te: 2, te_special: 10 });
});

test('concentrique : le Ø « 80/125 » donne le Ø intérieur et le Ø extérieur', () => {
  const p = trouver('DIFLUX PELLETS', '03010800REP');
  assert.equal(p.diametre_int, 80);
  assert.equal(p.diametre_ext, 125);
});

test('pièces du conduit DW BOIS Ø150 : longueur, plage du réglable, angle, pente, couleur', () => {
  assert.deepEqual(pick(trouver('DW BOIS 316L / 304', '030115020DW')), { type_piece: 'element_droit', diametre_int: 150, longueur_mm: 940, couleur: 'inox' });
  assert.deepEqual(pick(trouver('DW BOIS BLACK', '032115025DWN')), { type_piece: 'element_droit', diametre_int: 150, longueur_mm: 270, couleur: 'noir' });
  const reg = trouver('DW BOIS 316L / 304', '030115023DW');
  assert.equal(reg.type_piece, 'element_reglable'); assert.equal(reg.longueur_mm, 350); assert.equal(reg.longueur_max_mm, 530);
  const coude = trouver('DW BOIS 316L / 304', '030115040DW');
  assert.equal(coude.type_piece, 'coude'); assert.equal(coude.angle, 45);
  const solin = trouver('DW BOIS 316L / 304', '039020185FL');
  assert.equal(solin.type_piece, 'solin'); assert.equal(solin.pente_min, 5); assert.equal(solin.pente_max, 30);
  assert.equal(trouver('DW BOIS 316L / 304', '030115012DW').type_piece, 'chapeau_anti_refouleur');
  assert.equal(trouver('DW BOIS 316L / 304', '032915824').type_piece, 'collier_sous_toiture');
  assert.equal(trouver('DW BOIS 316L / 304', '030115143DE').type_piece, 'raccord_simple_paroi');
  assert.equal(trouver('DW BOIS 316L / 304', '030115147DE').type_piece, 'raccord_adaptation_long');
  const deko = trouver('DEKO BOIS 1,2 mm', '039A15024D1N');
  assert.equal(deko.type_piece, 'element_droit'); assert.equal(deko.longueur_mm, 450); assert.equal(deko.couleur, 'noir');
});

function pick(p) { return { type_piece: p.type_piece, diametre_int: p.diametre_int, longueur_mm: p.longueur_mm, couleur: p.couleur }; }
