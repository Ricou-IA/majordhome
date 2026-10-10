// scripts/planning-palette.test.mjs — palette de couleurs planning (src/lib/planningPalette.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANNING_PALETTE, RESERVED_INVOICED_COLOR,
  normalizeHex, isReservedColor, pickFreeColor, isLightColor, paletteLabel,
} from '../src/lib/planningPalette.js';

test('la palette est large, en #RRGGBB majuscule, sans doublon ni couleur réservée', () => {
  assert.ok(PLANNING_PALETTE.length >= 24, `attendu ≥ 24 teintes, reçu ${PLANNING_PALETTE.length}`);
  const hexs = PLANNING_PALETTE.map((c) => c.hex);
  for (const h of hexs) assert.match(h, /^#[0-9A-F]{6}$/);
  assert.equal(new Set(hexs).size, hexs.length, 'doublon dans la palette');
  for (const c of PLANNING_PALETTE) {
    assert.equal(isReservedColor(c.hex), false, `${c.label} (${c.hex}) est trop proche du violet facturé`);
    assert.ok(c.label, 'chaque teinte a un libellé');
  }
});

test('normalizeHex accepte les formes usuelles et refuse le reste', () => {
  assert.equal(normalizeHex('#ef4444'), '#EF4444');
  assert.equal(normalizeHex('ef4444'), '#EF4444');
  assert.equal(normalizeHex(' #EF4444 '), '#EF4444');
  assert.equal(normalizeHex('#abc'), '#AABBCC');
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex('rouge'), null);
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex(null), null);
});

test('isReservedColor protège le violet facturé et ses voisins, pas le bleu ni le rose', () => {
  assert.equal(isReservedColor(RESERVED_INVOICED_COLOR), true);
  assert.equal(isReservedColor('#6d28d9'), true, 'insensible à la casse');
  assert.equal(isReservedColor('#8B5CF6'), true, 'violet-500');
  assert.equal(isReservedColor('#A855F7'), true, 'purple-500');
  assert.equal(isReservedColor('#3B82F6'), false, 'bleu');
  assert.equal(isReservedColor('#6366F1'), false, 'indigo');
  assert.equal(isReservedColor('#D946EF'), false, 'fuchsia');
  assert.equal(isReservedColor('#64748B'), false, 'slate (gris bleuté, peu saturé)');
  assert.equal(isReservedColor('zut'), false, 'une valeur invalide n’est pas « réservée », elle est invalide');
});

test('pickFreeColor rend la première teinte libre, puis boucle quand tout est pris', () => {
  assert.equal(pickFreeColor([]), PLANNING_PALETTE[0].hex);
  const used = [PLANNING_PALETTE[0].hex.toLowerCase(), PLANNING_PALETTE[1].hex];
  assert.equal(pickFreeColor(used), PLANNING_PALETTE[2].hex, 'insensible à la casse');
  const toutes = PLANNING_PALETTE.map((c) => c.hex);
  assert.equal(pickFreeColor(toutes), PLANNING_PALETTE[0].hex, 'tout pris : on repart au début');
  assert.equal(pickFreeColor([...toutes, '#123456']), PLANNING_PALETTE[1].hex, 'boucle sur le nombre de couleurs prises');
});

test('isLightColor pilote la couleur du texte posé sur la pastille', () => {
  assert.equal(isLightColor('#FFFFFF'), true);
  assert.equal(isLightColor('#F59E0B'), true, 'ambre : texte sombre');
  assert.equal(isLightColor('#1D4ED8'), false, 'bleu foncé : texte blanc');
  assert.equal(isLightColor('#000000'), false);
  assert.equal(isLightColor('n/a'), false, 'invalide : on suppose un fond sombre (texte blanc, jamais invisible sur le fallback slate)');
});

test('paletteLabel nomme une teinte de la palette, sinon rend le code', () => {
  assert.equal(paletteLabel(PLANNING_PALETTE[0].hex.toLowerCase()), PLANNING_PALETTE[0].label);
  assert.equal(paletteLabel('#123456'), '#123456');
});
