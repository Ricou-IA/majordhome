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

test('heuresChauffage : ≥96 clés (95 départements + duplication Corse 2A/2B), bornes plausibles [800, 6000]', () => {
  const heures = climat.heuresChauffage;
  assert.ok(heures, 'heuresChauffage doit exister');
  const depts = Object.keys(heures);
  assert.ok(depts.length >= 96, `${depts.length} départements`);
  for (const [dept, h] of Object.entries(heures)) {
    assert.ok(Number.isFinite(h) && h >= 800 && h <= 6000, `${dept}: heuresChauffage=${h} hors bornes [800, 6000]`);
  }
  assert.equal(heures['2A'], heures['2B'], 'Corse : 2A et 2B doivent porter la même valeur (source groupée sous "20")');

  // Ancres relues directement dans la source (colonne « Chauf / an (h) », dernière colonne) :
  //   dept 71 : "71\tSaône-et-Loire\t05\tMâcon\tEc\tH1\tV\t33\t-10\t40%\t5500"        -> 5500
  //   dept 81 : "81\tTarn\t15\tAlbi\tEc\tH2\tV\t33\t-5\t40%\t5200"                    -> 5200
  //   dept 67 : "67\tBas-Rhin\t01\tStrasbourg\tEb\tH1\tV\t30\t-15\t40%\t5500"          -> 5500
  assert.equal(heures['71'], 5500, 'dept 71 (Saône-et-Loire)');
  assert.equal(heures['81'], 5200, 'dept 81 (Tarn)');
  assert.equal(heures['67'], 5500, 'dept 67 (Bas-Rhin)');
});
