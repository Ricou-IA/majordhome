// ops/aspirateur/test/navigateur.test.mjs — navigateur borné au site, politesse, protections, masquage des secrets.
// Run : cd ops/aspirateur && node --test test/navigateur.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirNavigateur } from '../navigateur.mjs';
import { masquerSecrets, creerJournal } from '../journal.mjs';
import { demarrerSite, IDENTIFIANT, MOT_DE_PASSE } from './fixtures/site-exemple.mjs';

let site;
before(async () => { site = await demarrerSite(); });
after(async () => { await site.fermer(); });

const ouvrir = (opts = {}) => ouvrirNavigateur({ hoteSite: site.hote, delaiMs: 200, modeTest: true, secrets: [IDENTIFIANT, MOT_DE_PASSE], ...opts });

test('masquerSecrets : sans casse, secrets courts ignorés ; le journal masque aussi les données', () => {
  assert.equal(masquerSecrets('Bonjour DEMO@exemple.fr !', [IDENTIFIANT, 'ab']), 'Bonjour *** !');
  const lignes = [];
  const j = creerJournal([MOT_DE_PASSE], { log: (l) => lignes.push(l), error: (l) => lignes.push(l) });
  j.info('connexion', { mdp: MOT_DE_PASSE });
  assert.ok(lignes[0].includes('***') && !lignes[0].includes(MOT_DE_PASSE));
});

test('une requête vers un autre hôte est interrompue et comptée, sans être une page vue', async () => {
  const nav = await ouvrir();
  try {
    await nav.aller(`${site.url}/produit/1`);
    assert.equal(nav.pagesVues, 1);
    assert.ok(nav.bloquees >= 1, 'le pixel vers evil.example doit être bloqué');
    await assert.rejects(nav.aller('https://evil.example/'), /hors du site/);
    assert.equal(nav.pagesVues, 1);
  } finally { await nav.fermer(); }
});

test('politesse : deux pages espacées du délai au moins', async () => {
  const nav = await ouvrir({ delaiMs: 400 });
  try {
    // délai mesuré d'un début de requête au suivant : deux pages prennent donc au moins le délai en tout
    const t0 = Date.now();
    await nav.aller(`${site.url}/produit/1`);
    await nav.aller(`${site.url}/produit/2`);
    assert.ok(Date.now() - t0 >= 390, `écart ${Date.now() - t0} ms`);
  } finally { await nav.fermer(); }
});

test('lecture : texte, sélecteurs, attributs absolus', async () => {
  const nav = await ouvrir();
  try {
    await nav.aller(`${site.url}/produit/1`);
    assert.equal(await nav.texte('.ref'), 'P613744');
    assert.equal(await nav.texte('.absent'), null);
    assert.deepEqual(await nav.attributs('a.fiche', 'href'), [`${site.url}/docs/fiche-1.pdf`]);
    const p = await nav.lirePage();
    assert.equal(p.titre, 'Châtel');
    assert.match(p.texte, /Etas 66 %/);
  } finally { await nav.fermer(); }
});

test('captcha détecté', async () => {
  const nav = await ouvrir();
  try {
    await nav.aller(`${site.url}/captcha`);
    assert.equal(await nav.estProtege(), true);
    await nav.aller(`${site.url}/produit/1`);
    assert.equal(await nav.estProtege(), false);
  } finally { await nav.fermer(); }
});

test('le texte d’une page ne révèle pas l’identifiant', async () => {
  const nav = await ouvrir();
  try {
    await nav.aller(`${site.url}/login`);
    await nav.remplir('#email', IDENTIFIANT);
    await nav.remplir('#password', 'faux');
    await nav.cliquer('button[type=submit]');
    const p = await nav.lirePage();
    assert.match(p.texte, /Utilisateur \*\*\* inconnu/);
    assert.ok(!p.texte.includes(IDENTIFIANT));
  } finally { await nav.fermer(); }
});

test('session : connexion puis page réservée ; sansSession ne porte pas le cookie ; téléchargement vérifié', async () => {
  const nav = await ouvrir();
  try {
    await nav.aller(`${site.url}/login`);
    await nav.remplir('#email', IDENTIFIANT);
    await nav.remplir('#password', MOT_DE_PASSE);
    await nav.cliquer('button[type=submit]');
    assert.equal(await nav.texte('.mon-compte'), 'Bonjour');
    const r = await nav.aller(`${site.url}/produit/3`);
    assert.equal(r.statut, 200);
    const anonyme = await nav.sansSession();
    try {
      const r2 = await anonyme.aller(`${site.url}/produit/3`);
      assert.match(r2.url, /\/login$/);
    } finally { await anonyme.fermer(); }
    const pdf = await nav.telecharger(`${site.url}/docs/fiche-1.pdf`);
    assert.equal(pdf.octets.subarray(0, 5).toString(), '%PDF-');
    await assert.rejects(nav.telecharger('https://evil.example/x.pdf'), /hors du site/);
  } finally { await nav.fermer(); }
});
