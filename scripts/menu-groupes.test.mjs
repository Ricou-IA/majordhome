import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GROUPES_MENU, SEUIL_MENU_GROUPE, grouperMenu, pageDansEntree, etatDuGroupe, lirePreferencesMenu,
} from '../src/lib/menuGroupes.js';

const entree = (href, groupe) => ({ href, groupe });
const MENU_COMPLET = [
  entree('/', 'quotidien'), entree('/planning', 'quotidien'),
  entree('/clients', 'ventes'), entree('/territoire', 'ventes'), entree('/pipeline', 'ventes'),
  entree('/chantiers', 'terrain'), entree('/contrats', 'ventes'), entree('/entretiens', 'terrain'),
  entree('/mailing', 'marketing'), entree('/solaire', 'etudes'),
];

test('grouperMenu : un menu court reste une liste simple, dans son ordre', () => {
  const court = MENU_COMPLET.slice(0, SEUIL_MENU_GROUPE);
  const groupes = grouperMenu(court);
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].titre, null);
  assert.deepEqual(groupes[0].items, court);
  assert.deepEqual(grouperMenu([]), []);
});

test('grouperMenu : au-delà du seuil, groupes dans l’ordre, entrées dans leur rang d’origine', () => {
  const groupes = grouperMenu(MENU_COMPLET);
  assert.deepEqual(groupes.map((g) => g.cle), ['quotidien', 'ventes', 'terrain', 'marketing', 'etudes']);
  assert.deepEqual(groupes[1].items.map((i) => i.href), ['/clients', '/territoire', '/pipeline', '/contrats']);
  assert.deepEqual(groupes[2].items.map((i) => i.href), ['/chantiers', '/entretiens']);
});

test('grouperMenu : Prospection et Cédants ont leur groupe « Développement », entre Terrain et Marketing', () => {
  const groupes = grouperMenu([...MENU_COMPLET, entree('/cedants', 'developpement'), entree('/prospection', 'developpement')]);
  assert.deepEqual(groupes.map((g) => g.cle), ['quotidien', 'ventes', 'terrain', 'developpement', 'marketing', 'etudes']);
  const developpement = groupes.find((g) => g.cle === 'developpement');
  assert.equal(developpement.titre, 'Développement');
  assert.deepEqual(developpement.items.map((i) => i.href), ['/cedants', '/prospection']);
  assert.deepEqual(etatDuGroupe(developpement), { ouvert: false, force: false });
  assert.deepEqual(etatDuGroupe(developpement, { pathname: '/prospection' }), { ouvert: true, force: true });
});

test('grouperMenu : aucune entrée perdue — groupe inconnu ou absent = premier groupe ; groupe vide absent', () => {
  const items = [...MENU_COMPLET.filter((i) => i.groupe !== 'marketing'), entree('/nouveau'), entree('/autre', 'inconnu')];
  const groupes = grouperMenu(items);
  assert.equal(groupes.reduce((n, g) => n + g.items.length, 0), items.length);
  assert.deepEqual(groupes[0].items.map((i) => i.href), ['/', '/planning', '/nouveau', '/autre']);
  assert.ok(!groupes.some((g) => g.cle === 'marketing'));
});

test('pageDansEntree : l’accueil ne vaut que pour lui-même, une fiche vaut pour sa liste', () => {
  assert.equal(pageDansEntree(entree('/'), '/'), true);
  assert.equal(pageDansEntree(entree('/'), '/clients'), false);
  assert.equal(pageDansEntree(entree('/clients'), '/clients/123'), true);
  assert.equal(pageDansEntree(entree('/chantiers'), '/chantier-gaillac'), false);
  assert.equal(pageDansEntree(entree('/solaire'), '/solaire/historique'), true);
});

test('etatDuGroupe : défaut du groupe, choix de la personne, page affichée toujours visible', () => {
  const [, ventes, , marketing] = grouperMenu(MENU_COMPLET);
  const sansTitre = grouperMenu(MENU_COMPLET)[0];
  assert.deepEqual(etatDuGroupe(sansTitre, { preferences: { quotidien: false } }), { ouvert: true, force: true });
  assert.deepEqual(etatDuGroupe(ventes), { ouvert: true, force: false });
  assert.deepEqual(etatDuGroupe(marketing), { ouvert: false, force: false });
  assert.deepEqual(etatDuGroupe(marketing, { preferences: { marketing: true } }), { ouvert: true, force: false });
  assert.deepEqual(etatDuGroupe(ventes, { preferences: { ventes: false } }), { ouvert: false, force: false });
  assert.deepEqual(etatDuGroupe(ventes, { preferences: { ventes: false }, pathname: '/clients/42' }), { ouvert: true, force: true });
  assert.deepEqual(etatDuGroupe(marketing, { pathname: '/mailing' }), { ouvert: true, force: true });
});

test('lirePreferencesMenu : absent ou illisible = aucun choix, seules les valeurs vrai / faux sont gardées', () => {
  assert.deepEqual(lirePreferencesMenu(null), {});
  assert.deepEqual(lirePreferencesMenu('pas du json'), {});
  assert.deepEqual(lirePreferencesMenu('[true]'), {});
  assert.deepEqual(lirePreferencesMenu('{"ventes":false,"etudes":"oui","terrain":true}'), { ventes: false, terrain: true });
});

test('AppLayout : chaque entrée du menu porte un groupe connu', () => {
  const source = readFileSync(new URL('../src/layouts/AppLayout.jsx', import.meta.url), 'utf8');
  const bloc = source.slice(source.indexOf('const navigation = ['), source.indexOf('];', source.indexOf('const navigation = [')));
  const entrees = bloc.split('\n').filter((ligne) => /^\s*\{ name:/.test(ligne));
  assert.ok(entrees.length >= 10, 'entrées du menu introuvables dans AppLayout.jsx');
  const connus = GROUPES_MENU.map((g) => g.cle);
  for (const ligne of entrees) {
    const groupe = ligne.match(/groupe: '([a-z]+)'/)?.[1];
    assert.ok(connus.includes(groupe), `entrée sans groupe connu : ${ligne.trim()}`);
  }
});
