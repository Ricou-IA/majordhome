// scripts/tournee/etiquetage.test.mjs — étiquetage des journées vides par secteur
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { besoinParSecteur, journeesAEtiqueter, secteursAReouvrir } from '../../src/lib/tournee/etiquetage.js';

const reglages = { auto_rdv: { capacite_cible: 4, marge_pct: 20, duree_moyenne_minutes: 90, seuil_reouverture_pct: 75 } };

test('besoinParSecteur : arrondi au-dessus avec marge, capacité amorcée et étiquettes vides déduites', () => {
  // 10 dus × 1,2 = 12 contrats à placer → 3 journées de 4
  assert.deepEqual([...besoinParSecteur({ dusParSecteur: new Map([['Albi', 10]]), reglages })], [['Albi', 3]]);
  // une journée amorcée avec 3 h de reste (2 places de 90 min) + une étiquette vide (4 places) → 12 − 6 = 6 → 2 journées
  const besoin = besoinParSecteur({
    dusParSecteur: new Map([['Albi', 10]]),
    journeesAmorcees: [{ secteur: 'Albi', chargeMinutes: 300, budgetMinutes: 480 }],
    etiquettesVides: [{ secteur: 'Albi' }],
    reglages,
  });
  assert.deepEqual([...besoin], [['Albi', 2]]);
  // capacité suffisante → 0, jamais négatif
  assert.deepEqual([...besoinParSecteur({ dusParSecteur: new Map([['Gaillac', 2]]), etiquettesVides: [{ secteur: 'Gaillac' }], reglages })], [['Gaillac', 0]]);
});

test('journeesAEtiqueter : plus proches d’abord, techniciens alternés, secteur le plus demandeur servi en premier, bornes respectées', () => {
  const journeesVides = [
    { date: '2026-10-30', technicienId: 'b' }, { date: '2026-10-27', technicienId: 'a' }, { date: '2026-10-27', technicienId: 'b' },
    { date: '2026-10-29', technicienId: 'a' }, { date: '2026-11-03', technicienId: 'a' }, { date: '2026-10-01', technicienId: 'a' },
  ];
  const out = journeesAEtiqueter({ journeesVides, besoin: new Map([['Gaillac', 1], ['Albi', 2]]), bornes: { debut: '2026-10-03', fin: '2026-10-31' } });
  assert.deepEqual(out, [
    { date: '2026-10-27', technicienId: 'a', secteur: 'Albi' },
    { date: '2026-10-27', technicienId: 'b', secteur: 'Gaillac' },
    { date: '2026-10-29', technicienId: 'a', secteur: 'Albi' },
  ]);
});

test('journeesAEtiqueter : besoin nul ou aucune journée → rien', () => {
  assert.deepEqual(journeesAEtiqueter({ journeesVides: [{ date: '2026-10-10', technicienId: 'a' }], besoin: new Map([['Albi', 0]]), bornes: { debut: '2026-10-01', fin: '2026-10-31' } }), []);
  assert.deepEqual(journeesAEtiqueter({ journeesVides: [], besoin: new Map([['Albi', 2]]), bornes: { debut: '2026-10-01', fin: '2026-10-31' } }), []);
});

test('secteursAReouvrir : un secteur dont toutes les journées étiquetées sont à ≥ 75 %', () => {
  const j = [
    { secteur: 'Albi', chargeMinutes: 400, budgetMinutes: 480 },
    { secteur: 'Albi', chargeMinutes: 380, budgetMinutes: 480 },
    { secteur: 'Gaillac', chargeMinutes: 400, budgetMinutes: 480 },
    { secteur: 'Gaillac', chargeMinutes: 100, budgetMinutes: 480 },
  ];
  assert.deepEqual(secteursAReouvrir({ journeesEtiquetees: j, reglages }), ['Albi']);
  assert.deepEqual(secteursAReouvrir({ journeesEtiquetees: [], reglages }), []);
});
