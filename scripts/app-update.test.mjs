// Tests du suivi de mise à jour de l'application (src/lib/appUpdate.js).
// node --test scripts/app-update.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerSuiviMiseAJour } from '../src/lib/appUpdate.js';

/** Faux `navigator.serviceWorker` : contrôleur, écouteurs, registration.update() compté. */
function fauxServiceWorker({ controleur = {}, registration = { update: async () => {} } } = {}) {
  const ecouteurs = new Set();
  const sw = {
    controller: controleur,
    misesAJour: 0,
    addEventListener: (type, fn) => { if (type === 'controllerchange') ecouteurs.add(fn); },
    removeEventListener: (type, fn) => { ecouteurs.delete(fn); },
    getRegistration: async () => {
      if (!registration) return undefined;
      return { update: async () => { sw.misesAJour += 1; return registration.update(); } };
    },
    changerControleur: () => { sw.controller = {}; for (const fn of ecouteurs) fn(); },
    nbEcouteurs: () => ecouteurs.size,
  };
  return sw;
}

test('nouvelle version : le contrôleur change sur une page déjà contrôlée', () => {
  const sw = fauxServiceWorker();
  let appels = 0;
  const suivi = creerSuiviMiseAJour({ serviceWorker: sw, onPrete: () => { appels += 1; } });
  assert.equal(suivi.prete(), false);
  sw.changerControleur();
  assert.equal(suivi.prete(), true);
  assert.equal(appels, 1);
  // Un second déploiement pendant que la page est ouverte ne re-signale pas.
  sw.changerControleur();
  assert.equal(appels, 1);
});

test('première installation : prendre le contrôle n’est pas une mise à jour', () => {
  const sw = fauxServiceWorker({ controleur: null });
  let appels = 0;
  const suivi = creerSuiviMiseAJour({ serviceWorker: sw, onPrete: () => { appels += 1; } });
  sw.changerControleur();
  assert.equal(suivi.prete(), false);
  assert.equal(appels, 0);
  // La version suivante, elle, en est une.
  sw.changerControleur();
  assert.equal(suivi.prete(), true);
  assert.equal(appels, 1);
});

test('verifier : interroge le serveur, pas plus d’une fois par intervalle', async () => {
  const sw = fauxServiceWorker();
  let maintenant = 1_000_000;
  const suivi = creerSuiviMiseAJour({ serviceWorker: sw, maintenant: () => maintenant, intervalleMs: 600_000 });
  await suivi.verifier();
  await suivi.verifier();
  assert.equal(sw.misesAJour, 1);
  maintenant += 599_000;
  await suivi.verifier();
  assert.equal(sw.misesAJour, 1);
  maintenant += 2_000;
  await suivi.verifier();
  assert.equal(sw.misesAJour, 2);
});

test('verifier : hors ligne ou sans service worker enregistré, rien ne casse', async () => {
  const horsLigne = fauxServiceWorker({ registration: { update: async () => { throw new Error('offline'); } } });
  await creerSuiviMiseAJour({ serviceWorker: horsLigne }).verifier();
  const sansEnregistrement = fauxServiceWorker({ registration: null });
  await creerSuiviMiseAJour({ serviceWorker: sansEnregistrement }).verifier();
  assert.equal(sansEnregistrement.misesAJour, 0);
});

test('arreter : retire l’écouteur', () => {
  const sw = fauxServiceWorker();
  let appels = 0;
  const suivi = creerSuiviMiseAJour({ serviceWorker: sw, onPrete: () => { appels += 1; } });
  assert.equal(sw.nbEcouteurs(), 1);
  suivi.arreter();
  assert.equal(sw.nbEcouteurs(), 0);
  sw.changerControleur();
  assert.equal(appels, 0);
});
