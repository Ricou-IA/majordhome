// Test de cohérence de src/apps/thermique/data/climat.json
// Source des valeurs : C:\Thermique\Base de données - Coordonnées des départements.txt
// (base de données du logiciel historique, colonne "T Hiver").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const climat = JSON.parse(readFileSync('src/apps/thermique/data/climat.json', 'utf8'));

test('structure : ≥95 départements métropole, tranches d’altitude croissantes', () => {
  const depts = Object.keys(climat.thetaBase);
  assert.ok(depts.length >= 95, `${depts.length} départements`);
  for (const [dept, tranches] of Object.entries(climat.thetaBase)) {
    assert.ok(Array.isArray(tranches) && tranches.length >= 1, dept);
    for (const t of tranches) {
      assert.ok(typeof t.altMax === 'number' || t.altMax === null, dept);
      assert.ok(t.thetaE >= -30 && t.thetaE <= 0, `${dept}: θe=${t.thetaE} hors plage`);
    }
    for (let i = 1; i < tranches.length; i++) {
      assert.ok(tranches[i].thetaE <= tranches[i - 1].thetaE, `${dept}: θe doit baisser avec l'altitude`);
    }
    // dernière tranche = ouverte (altMax null)
    assert.equal(tranches[tranches.length - 1].altMax, null, `${dept}: dernière tranche doit être ouverte`);
  }
});

test('valeurs de contrôle lues dans la source', () => {
  const at = (dept, alt) => {
    const tr = climat.thetaBase[dept].find((t) => t.altMax === null || alt <= t.altMax);
    return tr.thetaE;
  };
  assert.equal(at('75', 50), climat._ancres['75']);   // Paris
  assert.equal(at('67', 150), climat._ancres['67']);  // Strasbourg
  assert.equal(at('06', 10), climat._ancres['06']);   // Nice littoral
  assert.equal(at('81', 140), climat._ancres['81']);  // Tarn (org pilote)
  assert.ok(at('67', 150) < at('06', 10), 'Strasbourg plus froid que Nice');
});
