import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GROUPES_MENU, SEUIL_MENU_GROUPE, grouperMenu, pageDansEntree, etatDuGroupe, lirePreferencesMenu,
  PRIORITE_BARRE, raccourcisBarre, libelleDeBarre, cleMenuReplie,
} from '../src/lib/menuGroupes.js';

const entree = (href, groupe) => ({ href, groupe });
const MENU_COMPLET = [
  entree('/', 'quotidien'), entree('/planning', 'quotidien'),
  entree('/clients', 'ventes'), entree('/territoire', 'outils'), entree('/pipeline', 'ventes'),
  entree('/chantiers', 'terrain'), entree('/contrats', 'ventes'), entree('/entretiens', 'terrain'),
  entree('/mailing', 'ventes'), entree('/solaire', 'etudes'),
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
  assert.deepEqual(groupes.map((g) => g.cle), ['quotidien', 'ventes', 'terrain', 'outils', 'etudes']);
  assert.deepEqual(groupes[1].items.map((i) => i.href), ['/clients', '/pipeline', '/contrats', '/mailing']);
  assert.deepEqual(groupes[2].items.map((i) => i.href), ['/chantiers', '/entretiens']);
});

test('grouperMenu : Prospection et Cédants ont leur groupe « Développement », entre Outils et Études', () => {
  const groupes = grouperMenu([...MENU_COMPLET, entree('/cedants', 'developpement'), entree('/prospection', 'developpement')]);
  assert.deepEqual(groupes.map((g) => g.cle), ['quotidien', 'ventes', 'terrain', 'outils', 'developpement', 'etudes']);
  const developpement = groupes.find((g) => g.cle === 'developpement');
  assert.equal(developpement.titre, 'Développement');
  assert.deepEqual(developpement.items.map((i) => i.href), ['/cedants', '/prospection']);
  assert.deepEqual(etatDuGroupe(developpement), { ouvert: false, force: false });
  assert.deepEqual(etatDuGroupe(developpement, { pathname: '/prospection' }), { ouvert: true, force: true });
});

test('grouperMenu : aucune entrée perdue — groupe inconnu ou absent = premier groupe ; groupe vide absent', () => {
  const items = [...MENU_COMPLET.filter((i) => i.groupe !== 'outils'), entree('/nouveau'), entree('/autre', 'inconnu')];
  const groupes = grouperMenu(items);
  assert.equal(groupes.reduce((n, g) => n + g.items.length, 0), items.length);
  assert.deepEqual(groupes[0].items.map((i) => i.href), ['/', '/planning', '/nouveau', '/autre']);
  assert.ok(!groupes.some((g) => g.cle === 'outils'));
});

test('pageDansEntree : l’accueil ne vaut que pour lui-même, une fiche vaut pour sa liste', () => {
  assert.equal(pageDansEntree(entree('/'), '/'), true);
  assert.equal(pageDansEntree(entree('/'), '/clients'), false);
  assert.equal(pageDansEntree(entree('/clients'), '/clients/123'), true);
  assert.equal(pageDansEntree(entree('/chantiers'), '/chantier-gaillac'), false);
  assert.equal(pageDansEntree(entree('/solaire'), '/solaire/historique'), true);
});

test('etatDuGroupe : défaut du groupe, choix de la personne, page affichée toujours visible', () => {
  const [, ventes, , outils] = grouperMenu(MENU_COMPLET);
  const sansTitre = grouperMenu(MENU_COMPLET)[0];
  assert.deepEqual(etatDuGroupe(sansTitre, { preferences: { quotidien: false } }), { ouvert: true, force: true });
  assert.deepEqual(etatDuGroupe(ventes), { ouvert: true, force: false });
  assert.deepEqual(etatDuGroupe(outils), { ouvert: false, force: false });
  assert.deepEqual(etatDuGroupe(outils, { preferences: { outils: true } }), { ouvert: true, force: false });
  assert.deepEqual(etatDuGroupe(ventes, { preferences: { ventes: false } }), { ouvert: false, force: false });
  assert.deepEqual(etatDuGroupe(ventes, { preferences: { ventes: false }, pathname: '/clients/42' }), { ouvert: true, force: true });
  assert.deepEqual(etatDuGroupe(outils, { pathname: '/territoire' }), { ouvert: true, force: true });
});

test('GROUPES_MENU : six groupes, « Outils » à la place de « Marketing », replié par défaut', () => {
  assert.deepEqual(GROUPES_MENU.map((g) => g.cle),
    ['quotidien', 'ventes', 'terrain', 'outils', 'developpement', 'etudes']);
  assert.equal(GROUPES_MENU.find((g) => g.cle === 'outils').titre, 'Outils');
  assert.equal(GROUPES_MENU.find((g) => g.cle === 'outils').replie, true);
});

test('cleMenuReplie : une clé de stockage par utilisateur', () => {
  assert.equal(cleMenuReplie('u-1'), 'mdh-menu-replie:u-1');
  assert.notEqual(cleMenuReplie('u-1'), cleMenuReplie('u-2'));
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

test('raccourcisBarre : trois pages du quotidien à côté de « Créer », quatre sans lui', () => {
  const hrefs = (liste) => liste.map((item) => item.href);
  assert.deepEqual(hrefs(raccourcisBarre(MENU_COMPLET, { avecCreer: true })), ['/', '/planning', '/clients']);
  assert.deepEqual(hrefs(raccourcisBarre(MENU_COMPLET)), ['/', '/planning', '/clients', '/entretiens']);
});

test('raccourcisBarre : une page fermée à la personne laisse sa place à la suivante', () => {
  const hrefs = (liste) => liste.map((item) => item.href);
  const sansClients = MENU_COMPLET.filter((item) => item.href !== '/clients');
  assert.deepEqual(hrefs(raccourcisBarre(sansClients, { avecCreer: true })), ['/', '/planning', '/entretiens']);
  // Entreprise sans CRM : ses propres pages, dans l'ordre du menu.
  const horsPriorite = [entree('/maintenance', 'terrain'), entree('/solaire', 'etudes')];
  assert.deepEqual(hrefs(raccourcisBarre(horsPriorite)), ['/maintenance', '/solaire']);
  assert.deepEqual(raccourcisBarre([]), []);
});

test('raccourcisBarre : rend les entrées du menu elles-mêmes, et chaque page prioritaire existe au menu', () => {
  assert.equal(raccourcisBarre(MENU_COMPLET)[0], MENU_COMPLET[0]);
  const source = readFileSync(new URL('../src/layouts/AppLayout.jsx', import.meta.url), 'utf8');
  for (const href of PRIORITE_BARRE) {
    assert.ok(source.includes(`href: '${href}',`), `page prioritaire absente du menu : ${href}`);
  }
});

test('libelleDeBarre : « Accueil » pour la première page, le nom de son entrée pour les autres', () => {
  assert.equal(libelleDeBarre({ href: '/', name: 'Dashboard' }), 'Accueil');
  assert.equal(libelleDeBarre({ href: '/planning', name: 'Planning' }), 'Planning');
});
