import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  demarrer, enCours, attendre, abonner, _vider, retenir, retenueJusqua, sansReponse, DELAI_APRES_COUPURE_MS,
} from '../src/lib/envoiEnCours.js';

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

// ── Coupure : la clé reste prise le temps que la vague peut-être en cours se termine ──

/** Horloge de test : l'heure se règle à la main, les minuteries ne partent que si on les déclenche. */
const horlogeDeTest = (debut = 1_000_000) => {
  const h = { t: debut, minuteries: [] };
  h.maintenant = () => h.t;
  h.planifier = (fn, ms) => { h.minuteries.push({ fn, ms }); };
  h.avancer = (ms) => { h.t += ms; };
  h.declencher = () => { for (const m of h.minuteries.splice(0)) m.fn(); };
  return h;
};

test('DELAI_APRES_COUPURE_MS : 3 minutes', () => {
  assert.equal(DELAI_APRES_COUPURE_MS, 3 * 60 * 1000);
});

test('retenir : après une coupure, la clé reste prise jusqu’à la fin du délai, puis se libère', async () => {
  _vider();
  const h = horlogeDeTest();
  const d = differe();
  demarrer('o:A', d.promesse);
  const echeance = retenir('o:A', h);
  assert.equal(echeance, h.t + DELAI_APRES_COUPURE_MS);
  d.resoudre();
  await attendre('o:A');
  assert.equal(enCours('o:A', h.maintenant()), true);
  assert.equal(retenueJusqua('o:A', h.maintenant()), echeance);
  assert.equal(demarrer('o:A', Promise.resolve(), h.maintenant()), false);
  h.avancer(DELAI_APRES_COUPURE_MS - 1);
  assert.equal(enCours('o:A', h.maintenant()), true);
  h.avancer(1);
  assert.equal(enCours('o:A', h.maintenant()), false);
  assert.equal(retenueJusqua('o:A', h.maintenant()), null);
  const vus = [];
  abonner(() => vus.push('prévenu'));
  assert.equal(h.minuteries[0].ms, DELAI_APRES_COUPURE_MS);
  h.declencher();
  assert.deepEqual(vus, ['prévenu']);
  assert.equal(demarrer('o:A', Promise.resolve(), h.maintenant()), true);
});

test('sans coupure (le serveur a répondu), la clé est libre dès la fin de l’envoi', async () => {
  _vider();
  const d = differe();
  demarrer('o:A', d.promesse);
  d.resoudre(false);
  await attendre('o:A');
  assert.equal(enCours('o:A'), false);
  assert.equal(retenueJusqua('o:A'), null);
});

test('sansReponse : coupure réseau, délai, relais ou passerelle ⇒ vrai ; réponse du serveur ⇒ faux', () => {
  assert.equal(sansReponse({ name: 'FunctionsFetchError' }), true);
  assert.equal(sansReponse({ name: 'FunctionsRelayError' }), true);
  assert.equal(sansReponse({ name: 'AbortError' }), true);
  assert.equal(sansReponse({ name: 'TimeoutError' }), true);
  assert.equal(sansReponse(new TypeError('Failed to fetch')), true);
  assert.equal(sansReponse({ name: 'FunctionsHttpError', context: { status: 504 } }), true);
  assert.equal(sansReponse({ name: 'FunctionsHttpError', context: { status: 502 } }), true);
  assert.equal(sansReponse({ name: 'FunctionsHttpError', context: { status: 409 } }), false);
  assert.equal(sansReponse({ name: 'FunctionsHttpError', context: { status: 500 } }), false);
  assert.equal(sansReponse(null), false);
});
