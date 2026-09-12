// scripts/tournee/competences.test.mjs
// Compétences par type × rôle : rôles connus + règle d'éligibilité « coché = compétent ».
// Run : node --test scripts/tournee/competences.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_ROLES, estRoleValide, competencesVides } from '../../src/lib/tournee/competences.js';
import { techniciensEligibles } from '../../src/lib/tournee/proposer-contrat.js';

// Types (ids) : clim, gainable ∈ catégorie cat_clim ; poele_g, poele_b ∈ cat_poele
const TYPES_PAR_CATEGORIE = new Map([
  ['cat_clim', ['clim', 'gainable']],
  ['cat_poele', ['poele_g', 'poele_b']],
]);
const ANTOINE = { id: 'antoine', competences: { entretien: ['clim', 'poele_g'], pose: ['clim'] } };
const LUDOVIC = { id: 'ludovic', competences: { entretien: ['poele_g'], pose: [] } };
const VIDE = { id: 'vide', competences: competencesVides() };
const SANS_CHAMP = { id: 'sans' }; // membre jamais passé par la grille
const ids = (list) => list.map((t) => t.id);

test('rôles : entretien et pose seulement ; competencesVides couvre chaque rôle', () => {
  assert.deepEqual(SKILL_ROLES, ['entretien', 'pose']);
  assert.ok(estRoleValide('entretien') && estRoleValide('pose'));
  assert.ok(!estRoleValide('installation') && !estRoleValide(undefined) && !estRoleValide(null));
  assert.deepEqual(competencesVides(), { entretien: [], pose: [] });
});

test('un appel sans rôle (ou avec un rôle inconnu) est une erreur, jamais « entretien » implicite', () => {
  assert.throws(() => techniciensEligibles({ exigences: [] }, [ANTOINE]), /role_competence_requis/);
  assert.throws(() => techniciensEligibles({ exigences: [] }, [ANTOINE], 'installation'), /role_competence_requis/);
});

test('rien coché = jamais proposé, même sans exigence', () => {
  assert.deepEqual(ids(techniciensEligibles({ exigences: [] }, [ANTOINE, LUDOVIC, VIDE, SANS_CHAMP], 'entretien')), ['antoine', 'ludovic']);
  assert.deepEqual(ids(techniciensEligibles({ exigences: [] }, [ANTOINE, LUDOVIC, VIDE], 'pose')), ['antoine']);
});

test('exigence par type : le type exact doit être coché pour le rôle', () => {
  const clim = { exigences: [{ typeId: 'clim' }] };
  assert.deepEqual(ids(techniciensEligibles(clim, [ANTOINE, LUDOVIC], 'entretien')), ['antoine']);
  const deux = { exigences: [{ typeId: 'clim' }, { typeId: 'poele_g' }] };
  assert.deepEqual(ids(techniciensEligibles(deux, [ANTOINE, LUDOVIC], 'entretien')), ['antoine']);
  const gainable = { exigences: [{ typeId: 'gainable' }] };
  assert.deepEqual(ids(techniciensEligibles(gainable, [ANTOINE, LUDOVIC], 'entretien')), []);
});

test('exigence par catégorie (équipement non typé) : au moins un type de la catégorie coché', () => {
  const poele = { exigences: [{ categoryId: 'cat_poele' }], typesParCategorie: TYPES_PAR_CATEGORIE };
  assert.deepEqual(ids(techniciensEligibles(poele, [ANTOINE, LUDOVIC], 'entretien')), ['antoine', 'ludovic']);
  const clim = { exigences: [{ categoryId: 'cat_clim' }] };
  // typesParCategorie passé en option, et accepté aussi sous forme d'objet
  assert.deepEqual(ids(techniciensEligibles(clim, [ANTOINE, LUDOVIC], 'entretien', { typesParCategorie: TYPES_PAR_CATEGORIE })), ['antoine']);
  assert.deepEqual(ids(techniciensEligibles(clim, [ANTOINE, LUDOVIC], 'entretien', { typesParCategorie: { cat_clim: ['gainable', 'clim'] } })), ['antoine']);
  // catégorie inconnue de la table → personne (jamais un fail-open)
  assert.deepEqual(ids(techniciensEligibles({ exigences: [{ categoryId: 'cat_vmc' }], typesParCategorie: TYPES_PAR_CATEGORIE }, [ANTOINE], 'entretien')), []);
});

test('le rôle pose lit le jeu pose, indépendamment de l entretien', () => {
  const clim = { exigences: [{ typeId: 'clim' }] };
  assert.deepEqual(ids(techniciensEligibles(clim, [ANTOINE, LUDOVIC], 'pose')), ['antoine']);
  const poele = { exigences: [{ typeId: 'poele_g' }] };
  assert.deepEqual(ids(techniciensEligibles(poele, [ANTOINE, LUDOVIC], 'pose')), []);
});

test('les exigences vides ou malformées sont ignorées', () => {
  const c = { exigences: [null, {}, { typeId: 'clim' }] };
  assert.deepEqual(ids(techniciensEligibles(c, [ANTOINE, LUDOVIC], 'entretien')), ['antoine']);
});
