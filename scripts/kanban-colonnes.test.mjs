import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  colonneRepliee, basculerColonne, lirePreferencesColonnes, cleColonnesRepliees,
} from '../src/lib/kanbanColonnes.js';

const DEFAUTS = ['gagne', 'perdu'];

test('colonneRepliee : une colonne repliable est repliée par défaut', () => {
  assert.equal(colonneRepliee('gagne', {}, DEFAUTS), true);
  assert.equal(colonneRepliee('perdu', {}, DEFAUTS), true);
});

test('colonneRepliee : le choix de l’utilisateur prime', () => {
  assert.equal(colonneRepliee('gagne', { gagne: false }, DEFAUTS), false);
  assert.equal(colonneRepliee('gagne', { gagne: true }, DEFAUTS), true);
  assert.equal(colonneRepliee('perdu', { gagne: false }, DEFAUTS), true);
});

test('colonneRepliee : une colonne non repliable ne se replie jamais', () => {
  assert.equal(colonneRepliee('nouveau', {}, DEFAUTS), false);
  assert.equal(colonneRepliee('nouveau', { nouveau: true }, DEFAUTS), false);
  assert.equal(colonneRepliee('gagne', {}, []), false);
  assert.equal(colonneRepliee('gagne', {}, undefined), false);
});

test('colonneRepliee : une préférence qui n’est pas un booléen est ignorée', () => {
  assert.equal(colonneRepliee('gagne', { gagne: 'non' }, DEFAUTS), true);
  assert.equal(colonneRepliee('gagne', null, DEFAUTS), true);
});

test('basculerColonne : déplie puis replie', () => {
  const ouvert = basculerColonne('gagne', {}, DEFAUTS);
  assert.deepEqual(ouvert, { gagne: false });
  assert.deepEqual(basculerColonne('gagne', ouvert, DEFAUTS), { gagne: true });
});

test('basculerColonne : garde les autres choix, ignore une colonne non repliable', () => {
  assert.deepEqual(basculerColonne('perdu', { gagne: false }, DEFAUTS), { gagne: false, perdu: false });
  const prefs = { gagne: false };
  assert.equal(basculerColonne('nouveau', prefs, DEFAUTS), prefs);
});

test('lirePreferencesColonnes : texte absent ou abîmé ⇒ aucune préférence', () => {
  assert.deepEqual(lirePreferencesColonnes(null), {});
  assert.deepEqual(lirePreferencesColonnes(''), {});
  assert.deepEqual(lirePreferencesColonnes('{pas du json'), {});
  assert.deepEqual(lirePreferencesColonnes('[true]'), {});
  assert.deepEqual(lirePreferencesColonnes('42'), {});
  assert.deepEqual(lirePreferencesColonnes('{"gagne":false,"perdu":"x","x":1}'), { gagne: false });
});

test('cleColonnesRepliees : clé propre à l’utilisateur', () => {
  assert.equal(cleColonnesRepliees('u1'), 'mdh-kanban-replie:u1');
});
