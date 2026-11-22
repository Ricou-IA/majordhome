// Jetons de la direction artistique : échelles cuivre / pierre, statuts, activités.
// Le contraste est mesuré (WCAG 2.x), pas supposé.
import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../tailwind.config.js';

function luminance(hex) {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(hexA, hexB) {
  const [a, b] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const { primary, secondary, st, act } = config.theme.extend.colors;

test('échelles cuivre et pierre : valeurs de la direction artistique', () => {
  assert.equal(primary[600], '#C2532B');
  assert.equal(primary[700], '#A0421F');
  assert.equal(secondary[50], '#F7F5F1');
  assert.equal(secondary[500], '#736A5F');
});

test('contrastes du texte courant et du bouton d\'action', () => {
  assert.ok(contraste('#FFFFFF', primary[600]) >= 4.5);
  assert.ok(contraste(secondary[500], secondary[50]) >= 4.5);
  assert.ok(contraste(secondary[500], '#FFFFFF') >= 4.5);
});

test('chaque statut se lit sur son fond', () => {
  for (const ton of ['neutre', 'info', 'ok', 'attente', 'alerte']) {
    const c = contraste(st[ton], st[`${ton}-bg`]);
    assert.ok(c >= 4.5, `${ton} : ${c.toFixed(2)}:1`);
  }
});

test('chaque activité du planning a sa teinte et son fond', () => {
  for (const ton of ['pose', 'visite', 'entretien', 'sav']) {
    assert.match(act[ton], /^#[0-9A-F]{6}$/i);
    assert.match(act[`${ton}-bg`], /^#[0-9A-F]{6}$/i);
  }
});
