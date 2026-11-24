import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ligneSaisie, saisieDevisAPerdre } from '../src/lib/devisFermeture.js';

const chapitre = { line_type: 'section_title', designation: 'Équipement' };
const vide = { line_type: 'product', designation: '  ', unit_price_ht: 0 };
const saisie = { line_type: 'product', designation: 'Poêle', unit_price_ht: 0 };
const prix = { line_type: 'product', designation: '', unit_price_ht: 120 };

test('un chapitre ou une ligne vide ne sont pas une saisie', () => {
  assert.equal(ligneSaisie(chapitre), false);
  assert.equal(ligneSaisie(vide), false);
  assert.equal(ligneSaisie(saisie), true);
  assert.equal(ligneSaisie(prix), true);
});

test('rien à perdre sans modification', () => {
  assert.equal(saisieDevisAPerdre({ touche: false, lines: [saisie], subject: 'Pose' }), false);
});

test('une ligne saisie ou un objet modifiés sont à perdre', () => {
  assert.equal(saisieDevisAPerdre({ touche: true, lines: [chapitre, vide] }), false);
  assert.equal(saisieDevisAPerdre({ touche: true, lines: [chapitre, saisie] }), true);
  assert.equal(saisieDevisAPerdre({ touche: true, lines: [], subject: 'Pose PAC' }), true);
});
