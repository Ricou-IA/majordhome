import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demarrer, enCours, attendre, abonner, _vider } from '../src/lib/envoiEnCours.js';

const differe = () => {
  let resoudre;
  let rejeter;
  const promesse = new Promise((res, rej) => { resoudre = res; rejeter = rej; });
  return { promesse, resoudre, rejeter };
};

test('demarrer : une entrée par clé, un second départ sur une clé occupée est refusé', async () => {
  _vider();
  const d = differe();
  assert.equal(demarrer('o:A', d.promesse), true);
  assert.equal(enCours('o:A'), true);
  assert.equal(demarrer('o:A', Promise.resolve()), false);
  assert.equal(enCours('o:B'), false);
  d.resoudre();
  await attendre('o:A');
  assert.equal(enCours('o:A'), false);
});

test('l’entrée disparaît quand la promesse est rejetée', async () => {
  _vider();
  const d = differe();
  demarrer('o:A', d.promesse);
  d.rejeter(new Error('panne'));
  await attendre('o:A'); // ne rejette jamais
  assert.equal(enCours('o:A'), false);
  assert.equal(demarrer('o:A', Promise.resolve()), true);
});

test('attendre : clé libre ⇒ résout tout de suite', async () => {
  _vider();
  await attendre('o:Z');
  assert.equal(enCours('o:Z'), false);
});

test('abonner : prévenu au départ et à la fin, désabonnement', async () => {
  _vider();
  const vus = [];
  const fin = abonner(() => vus.push(enCours('o:A')));
  const d = differe();
  demarrer('o:A', d.promesse);
  d.resoudre();
  await attendre('o:A');
  assert.deepEqual(vus, [true, false]);
  fin();
  demarrer('o:A', Promise.resolve());
  await attendre('o:A');
  assert.equal(vus.length, 2);
});

test('clé vide refusée', () => {
  _vider();
  assert.equal(demarrer('', Promise.resolve()), false);
  assert.equal(enCours(''), false);
});
