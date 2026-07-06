import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chercheMateriaux, uParoiDepuisCouches, ajouteParoiBibliotheque, supprimeParoiBibliotheque,
} from '../../src/apps/thermique/lib/composeurParois.js';

const MATS = [
  { nom: 'Béton plein', famille: 'Bétons', lambda: 1.65 },
  { nom: 'Laine de verre', famille: 'Matériaux isolants manufacturés', lambda: 0.032 },
  { nom: 'Plaque de plâtre', famille: 'Plâtres', lambda: 0.25 },
  { nom: 'Béton cellulaire', famille: 'Blocs de béton cellulaire', lambda: 0.11 },
];

test('chercheMateriaux : préfixe insensible accents/casse', () => {
  assert.deepEqual(chercheMateriaux(MATS, 'béton').map((m) => m.nom), ['Béton plein', 'Béton cellulaire']);
  assert.deepEqual(chercheMateriaux(MATS, 'BETON').map((m) => m.nom), ['Béton plein', 'Béton cellulaire']);
});

test('chercheMateriaux : filtre famille optionnel', () => {
  assert.deepEqual(chercheMateriaux(MATS, 'béton', 'Bétons').map((m) => m.nom), ['Béton plein']);
});

test('chercheMateriaux : saisie vide → tout (jusqu\'à la limite)', () => {
  assert.equal(chercheMateriaux(MATS, '').length, 4);
});

test('uParoiDepuisCouches : mur 20cm béton + 12cm laine → U cohérent', () => {
  // R = 0.17 + 0.20/1.65 + 0.12/0.032 = 4.0412 → U ≈ 0.2475
  const { u, erreur } = uParoiDepuisCouches(
    [{ materiauNom: 'Béton plein', lambda: 1.65, e: 20 }, { materiauNom: 'Laine de verre', lambda: 0.032, e: 12 }],
    'murs',
  );
  assert.equal(erreur, null);
  assert.ok(Math.abs(u - 0.2475) < 0.001, `U=${u}`);
});

test('uParoiDepuisCouches : aucune couche → erreur douce (pas de throw)', () => {
  const { u, erreur } = uParoiDepuisCouches([], 'murs');
  assert.equal(u, null);
  assert.ok(typeof erreur === 'string');
});

test('uParoiDepuisCouches : couche invalide (lambda ≤ 0) → erreur douce', () => {
  const { u, erreur } = uParoiDepuisCouches([{ materiauNom: 'X', lambda: 0, e: 10 }], 'murs');
  assert.equal(u, null);
  assert.ok(typeof erreur === 'string');
});

test('ajouteParoiBibliotheque : ajoute une entrée avec id, refuse nom vide et u non fini', () => {
  const { bibliotheque, erreur } = ajouteParoiBibliotheque([], {
    nom: 'Mur agglo + LDV 12', famille: 'murs', u: 0.25,
    couches: [{ materiauNom: 'Agglo', lambda: 1.05, e: 20 }],
  }, 'id-1');
  assert.equal(erreur, null);
  assert.equal(bibliotheque.length, 1);
  assert.equal(bibliotheque[0].id, 'id-1');
  assert.equal(bibliotheque[0].couches.length, 1);
  assert.ok(ajouteParoiBibliotheque([], { nom: '  ', famille: 'murs', u: 0.25, couches: [] }, 'x').erreur !== null);
  assert.ok(ajouteParoiBibliotheque([], { nom: 'X', famille: 'murs', u: null, couches: [] }, 'y').erreur !== null);
});

test('supprimeParoiBibliotheque : retire par id, id inconnu inchangé', () => {
  const biblio = [{ id: 'a', nom: 'X', famille: 'murs', u: 1, couches: [] }];
  assert.deepEqual(supprimeParoiBibliotheque(biblio, 'a'), []);
  assert.equal(supprimeParoiBibliotheque(biblio, 'zzz').length, 1);
});
