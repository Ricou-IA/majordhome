// ops/aspirateur/test/serveur.test.mjs — serveur HTTP, file par site, exécution d'un travail, découpage des envois.
// Run : cd ops/aspirateur && node --test test/serveur.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerServeur } from '../serveur.mjs';
import { creerFile, executerTravail, decouperLot } from '../travaux.mjs';
import { CodeErreur } from '../erreurs.mjs';

const CLE = 'cle-de-test-0123456789';
const UUID = '6f1c2f9e-1b7a-4c1e-9a7d-1f2e3d4c5b6a';
const travail = (over = {}) => ({
  aspiration_id: UUID, genre: 'aspiration', hote_site: 'pro.exemple.fr', url_depart: 'https://pro.exemple.fr/',
  acces: { identifiant: 'demo@exemple.fr', mot_de_passe: 'MotDePasse-123' }, compte_client: 'CLIENT-0042',
  champs: [{ key: 'etas_pct', label: 'Etas', type: 'number' }], recette: { schema: 1 }, marques: [], ...over,
});
const differe = () => { let resoudre; const promesse = new Promise((r) => { resoudre = r; }); return { promesse, resoudre }; };

async function avecServeur(file, fn) {
  const serveur = creerServeur({ cle: CLE, file });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  try { await fn(base); } finally { await new Promise((r) => serveur.close(r)); }
}

test('routes : santé, 404 ailleurs, clé exigée, corps validé, 202 sur un travail valide', async () => {
  const recus = [];
  await avecServeur({ soumettre: (t) => recus.push(t) }, async (base) => {
    assert.equal((await fetch(`${base}/sante`)).status, 200);
    assert.equal((await fetch(`${base}/autre`)).status, 404);
    assert.equal((await fetch(`${base}/travaux`, { method: 'GET', headers: { 'x-aspirateur-key': CLE } })).status, 404);
    const poster = (corps, cle = CLE) => fetch(`${base}/travaux`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cle ? { 'x-aspirateur-key': cle } : {}) }, body: typeof corps === 'string' ? corps : JSON.stringify(corps) });
    assert.equal((await poster(travail(), null)).status, 401);
    assert.equal((await poster(travail(), 'mauvaise')).status, 401);
    assert.equal((await poster('{pas du json')).status, 400);
    assert.equal((await poster(travail({ genre: 'autre' }))).status, 400);
    assert.equal((await poster(travail({ url_depart: 'http://pro.exemple.fr/' }))).status, 400);
    assert.equal((await poster(travail({ aspiration_id: 'x' }))).status, 400);
    assert.equal((await poster({ ...travail(), champs: 'x'.repeat(300_000) })).status, 413);
    assert.equal((await poster(travail())).status, 202);
    assert.equal(recus.length, 1);
  });
});

test('file : un travail à la fois par site, deux au plus en tout', async () => {
  const fins = new Map();
  const debuts = [];
  const file = creerFile({ maxTotal: 2, executer: async (t) => { debuts.push(t.aspiration_id); const d = differe(); fins.set(t.aspiration_id, d); await d.promesse; } });
  file.soumettre(travail({ aspiration_id: 'a', hote_site: 'x.fr' }));
  file.soumettre(travail({ aspiration_id: 'b', hote_site: 'x.fr' }));
  file.soumettre(travail({ aspiration_id: 'c', hote_site: 'y.fr' }));
  file.soumettre(travail({ aspiration_id: 'd', hote_site: 'z.fr' }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(debuts, ['a', 'c']);
  fins.get('a').resoudre();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(debuts, ['a', 'c', 'b']);
  fins.get('c').resoudre();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(debuts, ['a', 'c', 'b', 'd']);
});

test('decouperLot : morceaux sous la taille, un produit trop lourd seul', () => {
  const p = (n, taille) => ({ url: `u${n}`, documents: [{ contenu_base64: 'x'.repeat(taille) }] });
  const morceaux = decouperLot([p(1, 100), p(2, 100), p(3, 500), p(4, 50)], 300);
  assert.deepEqual(morceaux.map((m) => m.map((x) => x.url)), [['u1', 'u2'], ['u3'], ['u4']]);
});

function deps(over = {}) {
  const retours = [];
  const lignes = [];
  return {
    retours, lignes,
    d: {
      ouvrirNavigateur: async () => ({ fermer: async () => {} }),
      creerModele: () => ({}),
      envoyerRetour: async (corps) => { retours.push(corps); },
      sortie: { log: (l) => lignes.push(l), error: (l) => lignes.push(l) },
      apprendre: async () => ({ recette: { schema: 1 }, essai: [{ url: 'u', documents: [{ type: 'fiche_technique', contenu_base64: 'AAAA', empreinte: 'e' }] }] }),
      rejouer: async ({ surLot, journal }) => {
        journal.info('connexion', { mdp: 'MotDePasse-123' });
        await surLot([{ url: 'u1', marque: 'Invicta', documents: [] }, { url: 'u2', marque: 'Deville', documents: [] }]);
        return { compteurs: { trouves: 2, lus: 2, echecs: 0, documents: 0 }, echecs: [] };
      },
      ...over,
    },
  };
}

test('aspiration : lots filtrés par marque, puis fin « termine » ; journal sans mot de passe', async () => {
  const { d, retours, lignes } = deps();
  await executerTravail(travail({ marques: ['Deville'] }), d);
  assert.deepEqual(retours.map((r) => r.action), ['lot', 'fin']);
  assert.deepEqual(retours[0].produits.map((p) => p.url), ['u2']);
  assert.equal(retours[1].statut, 'termine');
  assert.deepEqual(retours[1].compteurs, { trouves: 2, lus: 2, echecs: 0, documents: 0 });
  assert.ok(lignes.join('\n').length > 0 && !lignes.join('\n').includes('MotDePasse-123'));
});

test('apprentissage réussi : recette et essai (sans contenu de document), pas de fin', async () => {
  const { d, retours } = deps();
  await executerTravail(travail({ genre: 'apprentissage', recette: null }), d);
  assert.deepEqual(retours.map((r) => r.action), ['recette']);
  assert.equal(retours[0].essai[0].documents[0].contenu_base64, undefined);
});

test('échec : fin « echec » avec le code, ou service_indisponible pour une erreur quelconque', async () => {
  const a = deps({ rejouer: async () => { throw new CodeErreur('site_protege'); } });
  await executerTravail(travail(), a.d);
  assert.deepEqual(a.retours.at(-1), { action: 'fin', aspiration_id: UUID, statut: 'echec', code: 'site_protege', compteurs: null, echecs: null });
  const b = deps({ apprendre: async () => { throw new Error('boum MotDePasse-123'); } });
  await executerTravail(travail({ genre: 'apprentissage' }), b.d);
  assert.equal(b.retours.at(-1).code, 'service_indisponible');
  assert.ok(!b.lignes.join('\n').includes('MotDePasse-123'));
  const c = deps({ ouvrirNavigateur: async () => { throw new Error('chromium absent'); } });
  await executerTravail(travail(), c.d);
  assert.equal(c.retours.at(-1).statut, 'echec');
});
