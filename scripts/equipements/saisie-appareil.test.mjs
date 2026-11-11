// Tests des règles pures de la saisie d'appareil (src/lib/equipements/saisieAppareil.js).
// node --test scripts/equipements/saisie-appareil.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  marqueDeReference, classerAppareils, classerArticles, saisieOrigine, champsRattachement, messageErreurAppareil,
  saisieModifiee, messageBaseLocale,
} from '../../src/lib/equipements/saisieAppareil.js';

test('saisieModifiee : seule une vraie modification compte (casse, espaces, ponctuation ignorées)', () => {
  assert.equal(saisieModifiee('INVICTA', 'invicta '), false);
  assert.equal(saisieModifiee('JOLLY MEC', 'jolly-mec'), false);
  assert.equal(saisieModifiee('INVICTA', 'DEVILLE'), true);
  assert.equal(saisieModifiee('ARATOS', 'ARATOS 8'), true);
  assert.equal(saisieModifiee('', 'X'), true);
});

test('messageBaseLocale : erreur de lecture ≠ rien trouvé', () => {
  assert.match(messageBaseLocale({ erreur: new Error('x'), nbFiches: 0, nbArticles: 0, brand: 'A', model: 'B' }), /n'a pas pu être lue/);
  assert.match(messageBaseLocale({ erreur: null, nbFiches: 0, nbArticles: 0, brand: 'EDILKAMIN', model: 'Kelly' }), /Rien de ressemblant.*EDILKAMIN Kelly/);
  assert.equal(messageBaseLocale({ erreur: null, nbFiches: 2, nbArticles: 0, brand: 'A', model: 'B' }), null);
  assert.match(messageBaseLocale({ erreur: new Error('x'), nbFiches: 2, nbArticles: 0, brand: 'A', model: 'B' }), /incomplète/);
});

test('messageErreurAppareil : plafond, délai, droits, contrôle, défaut', () => {
  assert.match(messageErreurAppareil({ code: 'quota', message: '20 recherches web par jour atteintes' }), /20 recherches web par jour atteintes.*tel quel/);
  assert.match(messageErreurAppareil({ code: 'delai' }), /trop de temps/);
  assert.match(messageErreurAppareil({ code: 'droit' }), /droit/i);
  assert.match(messageErreurAppareil({ message: 'fiche_fabricant' }), /relevée chez le fabricant/);
  assert.match(messageErreurAppareil({ message: 'fiche_fabricant_survit' }), /fabricant ne peut pas être absorbée/);
  assert.match(messageErreurAppareil({ message: 'org_admin_required' }), /administrateur/);
  assert.match(messageErreurAppareil(new Error('boom')), /n'a pas abouti.*tel quel/);
  assert.match(messageErreurAppareil(null), /n'a pas abouti/);
});

const MARQUES = [{ name: 'JOLLY MEC', brand_key: 'jollymec' }, { name: 'EDILKAMIN', brand_key: 'edilkamin' }, { name: 'MCZ', brand_key: 'mcz' }];

test('marqueDeReference : clé identique, faute d\'une lettre, rien', () => {
  assert.deepEqual(marqueDeReference('Jollymec ', MARQUES), { name: 'JOLLY MEC', exacte: true });
  assert.deepEqual(marqueDeReference('jolly-mec', MARQUES), { name: 'JOLLY MEC', exacte: true });
  assert.deepEqual(marqueDeReference('Efilkamin', MARQUES), { name: 'EDILKAMIN', exacte: false });
  assert.equal(marqueDeReference('MZC', MARQUES), null); // clé < 6 : pas de rapprochement approché
  assert.equal(marqueDeReference('', MARQUES), null);
  assert.equal(marqueDeReference('Palazzetti', MARQUES), null);
});

test('marqueDeReference : deux marques à une lettre près = pas de proposition', () => {
  const M = [{ name: 'ABCDEF', brand_key: 'abcdef' }, { name: 'ABCDEG', brand_key: 'abcdeg' }];
  assert.equal(marqueDeReference('abcdex', M), null);
});

const F = (id, model_name, extra = {}) => ({ id, model_name, name: `POELE ${model_name}`, reference: `P${id}`, is_active: true, merged_into: null, ...extra });

test('classerAppareils : fusionnées exclues, même type en tête, scores nuls retirés', () => {
  const fiches = [
    F('1', 'LODI 10', { equipment_type_id: 'A' }),
    F('2', 'LODI 10', { equipment_type_id: 'B' }),
    F('3', 'LODI 10', { equipment_type_id: 'B', merged_into: '2' }),
    F('4', 'OXANA'),
  ];
  assert.deepEqual(classerAppareils(fiches, { model: 'lodi 10', equipmentTypeId: 'B' }).map((f) => f.id), ['2', '1']);
  assert.deepEqual(classerAppareils(fiches, { model: '' }).map((f) => f.id), []);
});

test('classerArticles : nom ou code, au moins 3 caractères', () => {
  const articles = [{ id: 'a', name: 'ARATOS', code: 'P645344' }, { id: 'b', name: 'KAORI', code: null }];
  assert.deepEqual(classerArticles(articles, { model: 'ar' }), []);
  assert.deepEqual(classerArticles(articles, { model: 'aratos' }).map((a) => a.id), ['a']);
  assert.deepEqual(classerArticles(articles, { model: '645344' }).map((a) => a.id), ['a']);
});

test('champsRattachement et saisieOrigine', () => {
  assert.deepEqual(champsRattachement({ id: 'm1', brand: 'Invicta', model_name: 'ARATOS', catalog_source_product_id: 'sp1' }),
    { brand: 'INVICTA', model: 'ARATOS', equipmentModelId: 'm1', supplierProductId: 'sp1' });
  assert.equal(champsRattachement({ id: 'm2', brand: 'X', model_name: 'Y' }).supplierProductId, null);
  assert.deepEqual(saisieOrigine({ brand: 'invicta', model: 'aratos 8' }, 'saisie terrain', '2026-11-12'),
    { brand: 'invicta', model: 'aratos 8', le: '2026-11-12', par: 'saisie terrain' });
  assert.deepEqual(saisieOrigine({}, 'x', '2026-11-12'), { brand: null, model: null, le: '2026-11-12', par: 'x' });
});
