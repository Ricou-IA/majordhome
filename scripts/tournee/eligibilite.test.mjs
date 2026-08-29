// scripts/tournee/eligibilite.test.mjs
// Tests du score d'éligibilité (src/lib/tournee/eligibilite.js).
// Run : node --test scripts/tournee/eligibilite.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ecartMois, scoreEligibilite, ecartSigne, estEnRetard, retardStatus,
} from '../../src/lib/tournee/eligibilite.js';

const HIVER = [11, 12, 1, 2, 3];
const base = {
  toleranceMois: 2,
  moisCreux: HIVER,
  moisDefavorables: [],
  estSaisonnier: false,
};

test('ecartMois — distance circulaire, décembre vers janvier = 1', () => {
  assert.equal(ecartMois(6, 6), 0);
  assert.equal(ecartMois(12, 1), 1);
  assert.equal(ecartMois(1, 12), 1);
  assert.equal(ecartMois(1, 7), 6, 'maximum = 6 mois');
  assert.equal(ecartMois(11, 2), 3);
});

test('score maximal sur le plateau de tolérance', () => {
  const a = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 6 });
  const b = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 8 });
  assert.equal(a.score, b.score, 'plateau : anniversaire et +2 mois valent pareil');
  assert.equal(a.dansTolerance, true);
  assert.equal(b.dansTolerance, true);
});

test('décroissance progressive hors tolérance, jamais un mur', () => {
  const dans = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 8 });
  const hors1 = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 9 });
  const hors2 = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 10 });
  assert.ok(hors1.score < dans.score, 'au-dela de la tolerance, le score baisse');
  assert.ok(hors2.score < hors1.score, 'et continue de baisser');
  assert.ok(hors2.score > 0, 'mais reste proposable — pas une interdiction');
  assert.equal(hors1.dansTolerance, false);
});

test('mois défavorable : pénalise fortement sans annuler', () => {
  const favorable = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 6, moisDefavorables: HIVER });
  const defavorable = scoreEligibilite({ ...base, moisAnniversaire: 1, moisCible: 1, moisDefavorables: HIVER });
  assert.ok(defavorable.score > 0, 'possible pendant la periode de chauffe');
  assert.ok(defavorable.score < favorable.score * 0.5, 'mais fortement penalise');
  assert.equal(defavorable.saisonDefavorable, true);
});

test('poêle anniversaire janvier : octobre et avril battent janvier', () => {
  const p = { ...base, moisAnniversaire: 1, moisDefavorables: HIVER, estSaisonnier: true };
  const janvier = scoreEligibilite({ ...p, moisCible: 1 });
  const avril = scoreEligibilite({ ...p, moisCible: 4 });
  const octobre = scoreEligibilite({ ...p, moisCible: 10 });
  assert.ok(avril.score > janvier.score, 'avril bat janvier malgre 3 mois d ecart');
  assert.ok(octobre.score > janvier.score, 'octobre aussi');
});

test('bonus creux : un type sans contrainte est poussé vers l hiver', () => {
  const pac = { ...base, moisAnniversaire: 6, moisDefavorables: [], estSaisonnier: false };
  const enHiver = scoreEligibilite({ ...pac, moisCible: 1 });
  const enEte = scoreEligibilite({ ...pac, moisCible: 6 });
  assert.equal(enHiver.bonusCreux, true);
  assert.equal(enEte.bonusCreux, false);
  assert.ok(enHiver.score > 0.5, 'la PAC reste attractive en hiver malgre l ecart a l anniversaire');
});

test('bonus creux jamais appliqué à un type saisonnier', () => {
  const poele = scoreEligibilite({
    ...base, moisAnniversaire: 6, moisCible: 1, moisDefavorables: HIVER, estSaisonnier: true,
  });
  assert.equal(poele.bonusCreux, false);
});

// --- I1 (revue finale) — retardataires : notion ORIENTÉE, pas une distance ---

test('ecartSigne — même magnitude que ecartMois, direction en plus', () => {
  for (let a = 1; a <= 12; a += 1) {
    for (let c = 1; c <= 12; c += 1) {
      assert.equal(Math.abs(ecartSigne(a, c)), ecartMois(a, c), `a=${a} c=${c}`);
    }
  }
});

test('estEnRetard — anniversaire à venir n est jamais un retard (I1.1)', () => {
  // Anniversaire en décembre, on est en août : 4 mois d écart, mais la
  // fenêtre n est pas encore ouverte. L ancien test symétrique
  // (ecartMois(...) >= 2) l aurait compté comme retardataire à tort.
  assert.equal(estEnRetard(12, 8, 2), false);
});

test('estEnRetard — même écart de 4 mois, mais anniversaire passé : vrai retard', () => {
  // Anniversaire en avril, on est en août.
  assert.equal(estEnRetard(4, 8, 2), true);
});

test('estEnRetard — jamais vrai en même temps que dansTolerance, sur les 144 combinaisons (I1.2)', () => {
  for (let anniversaire = 1; anniversaire <= 12; anniversaire += 1) {
    for (let cible = 1; cible <= 12; cible += 1) {
      const { dansTolerance } = scoreEligibilite({
        ...base, moisAnniversaire: anniversaire, moisCible: cible, toleranceMois: 2,
      });
      const enRetard = estEnRetard(anniversaire, cible, 2);
      assert.ok(!(dansTolerance && enRetard), `chevauchement au mois ${anniversaire}->${cible}`);
    }
  }
});

test('estEnRetard — la tolérance vient du paramètre, jamais d une constante en dur (I1.3)', () => {
  // Anniversaire en mai, cible en août : 3 mois d écart, dans le passé.
  assert.equal(estEnRetard(5, 8, 2), true, 'tolérance 2 : 3 mois d écart, hors fenêtre');
  assert.equal(estEnRetard(5, 8, 4), false, 'tolérance 4 : 3 mois d écart, encore dans la fenêtre');
});

test('retardStatus — sans date anniversaire, toujours "sans_date" (I1.4)', () => {
  assert.equal(retardStatus(null, 8, 2), 'sans_date');
});

test('retardStatus — distingue en retard, dans la fenêtre et pas encore dû', () => {
  assert.equal(retardStatus(4, 8, 2), 'en_retard');
  assert.equal(retardStatus(8, 8, 2), null, 'dans la fenêtre : pas retardataire');
  assert.equal(retardStatus(12, 8, 2), null, 'anniversaire à venir : pas retardataire');
});
