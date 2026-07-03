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

test('cohérence lookup ↔ ancres (9 départements contre-lus dans la source)', () => {
  const at = (dept, alt) => {
    const tr = climat.thetaBase[dept].find((t) => t.altMax === null || alt <= t.altMax);
    return tr.thetaE;
  };
  for (const [dept, expected] of Object.entries(climat._ancres)) {
    assert.equal(at(dept, 100), expected, `${dept}: lookup ≠ ancre`);
  }
  assert.ok(at('67', 150) < at('06', 10), 'Strasbourg plus froid que Nice');
  // Invariant Corse : la source groupe 2A et 2B sous le numéro 20 (cf. _meta.note)
  assert.equal(climat.thetaBase['2A'][0].thetaE, climat.thetaBase['2B'][0].thetaE, 'Corse : 2A et 2B doivent porter la même valeur');
});
