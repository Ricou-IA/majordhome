// Compléments facultatifs du relevé : jamais exigés, jamais un 0 inventé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPLEMENTS, complementsDuGabarit, lireComplement } from '../../src/lib/fumisterie/complements.js';
import { validerReleve } from '../../src/lib/fumisterie/index.js';

test('lireComplement : vide, illisible ou hors plage → null ; 0 saisi reste 0', () => {
  assert.equal(lireComplement({ obstacleDistance: '' }, 'obstacleDistance'), null);
  assert.equal(lireComplement({}, 'obstacleDistance'), null);
  assert.equal(lireComplement({ obstacleDistance: 'abc' }, 'obstacleDistance'), null);
  assert.equal(lireComplement({ obstacleDistance: -2 }, 'obstacleDistance'), null);
  assert.equal(lireComplement({ obstacleDistance: 0 }, 'obstacleDistance'), 0);
  assert.equal(lireComplement({ obstacleDistance: '4,5' }, 'obstacleDistance'), 4.5);
  assert.equal(lireComplement({ sortieBuse: 'arriere' }, 'sortieBuse'), 'arriere');
  assert.equal(lireComplement({ sortieBuse: 'gauche' }, 'sortieBuse'), null);
  assert.equal(lireComplement({ x: 3 }, 'x'), null);
});

test('par gabarit : la ventouse a ses questions, la création intérieure les siennes', () => {
  const g6 = complementsDuGabarit('G6').map((c) => c.cle);
  const g1 = complementsDuGabarit('G1').map((c) => c.cle);
  assert.ok(g6.includes('batimentRecentOuErp') && g6.includes('hVerticalNotice'));
  assert.ok(!g1.includes('batimentRecentOuErp'));
  assert.ok(g1.includes('obstacleDistance') && g1.includes('hAcrotere'));
  assert.ok(complementsDuGabarit('G4').map((c) => c.cle).includes('angleBoisseau'));
  assert.ok(COMPLEMENTS.every((c) => c.libelle && c.groupe && c.gabarits.length));
});

test('un complément n\'est jamais exigé par la validation du relevé', () => {
  const gabarit = { troncons: [{ parametres: [{ cle: 'hBuse', libelle: 'Hauteur de buse', min: 0.3, max: 2 }] }] };
  assert.equal(validerReleve(gabarit, { hBuse: 1, obstacleDistance: '', sortieBuse: 'n importe quoi' }).ok, true);
});
