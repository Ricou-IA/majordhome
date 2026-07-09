import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilieBatiment } from '../../src/apps/thermique/lib/reconciliationEmprise.js';

const rect = (x1, y1, x2, y2) => [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }];
// Emprise 20 m² / 18 m ; 2 pièces qui totalisent 20 m² et 18 m de mur ext → cohérent.
const saisieOk = {
  niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, emprise: { polygone: rect(0, 0, 500, 400) } }],
  pieces: [
    { id: 'a', niveauId: 'rdc', chauffee: true, longueur: 250, largeur: 400, mlMurExterieur: 900 },
    { id: 'b', niveauId: 'rdc', chauffee: true, longueur: 250, largeur: 400, mlMurExterieur: 900 },
  ],
};

test('réconciliation cohérente : pas d\'alerte', () => {
  const r = reconcilieBatiment(saisieOk, { seuilPct: 0.10 });
  assert.equal(r.alerteGlobale, false);
  assert.equal(r.parNiveau[0].surfaceEmprise, 20);
  assert.equal(r.parNiveau[0].surfacePieces, 20);
});

test('réconciliation surface incohérente (> seuil) : alerte', () => {
  const s = { ...saisieOk, pieces: [{ id: 'a', niveauId: 'rdc', chauffee: true, longueur: 250, largeur: 400, mlMurExterieur: 900 }] };
  const r = reconcilieBatiment(s, { seuilPct: 0.10 });
  assert.equal(r.alerteGlobale, true);          // 10 m² vs 20 m² = 50 % d'écart
  assert.ok(r.parNiveau[0].alerte);
});

test('réconciliation emprise vide : pas d\'alerte (garde-fou seulement si emprise renseignée)', () => {
  const s = { niveaux: [{ id: 'rdc', nom: 'RDC', rang: 0, emprise: { polygone: [] } }], pieces: saisieOk.pieces };
  const r = reconcilieBatiment(s, { seuilPct: 0.10 });
  assert.equal(r.alerteGlobale, false);
});
