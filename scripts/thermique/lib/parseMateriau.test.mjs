import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMateriau } from './parseMateriau.js';

test('parse un matériau Th-U (eau à 10°C : λ=0.60)', () => {
  const contenu = '"Règles Th-U 2.5"\n"1 000"\n"0.60"\n"4190"\n""\n""\n""\n';
  const m = parseMateriau(contenu, 'eau à 10°C', 'Autres matériaux');
  assert.deepEqual(m, {
    nom: 'eau à 10°C', famille: 'Autres matériaux',
    lambda: 0.6, masseVolumique: 1000, capacite: 4190,
    source: 'Règles Th-U 2.5',
  });
});

test('parse un isolant fabricant (Foamglas : λ=0.036)', () => {
  const contenu = '"Doc Foamglas terrasses bois - www.foamglas.com"\n"100"\n"0.036"\n"1 000"\n"150"\n"150"\n"notes"\n';
  const m = parseMateriau(contenu, 'Foamglas T4', 'Matériaux isolants manufacturés');
  assert.equal(m.lambda, 0.036);
  assert.equal(m.masseVolumique, 100);
});

test('rejette un fichier sans lambda exploitable', () => {
  assert.equal(parseMateriau('"src"\n""\n""\n', 'x', 'f'), null);
});
