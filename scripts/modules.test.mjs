// scripts/modules.test.mjs — registre des modules (src/lib/modules.js)
// node --test scripts/modules.test.mjs
//
// Le registre porte le découpage COMMERCIAL de Majord'home (socle + modules
// vendables) ; la page Paramètres l'affiche tel quel. Ce test garantit ce qui
// ne se voit pas à l'écran : pas de doublon, et surtout aucune tuile vers une
// route absente de routes.jsx (trois tuiles 404 ont vécu des mois, 2026-09-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MODULES, CATALOGUE, tuilesParametrage, moduleActif, modulesVisibles, peutOuvrirParametres, crmActif,
  modulesEffectifs, validerModules, accueilSansCrm, moduleDeRoute,
} from '../src/lib/modules.js';

const routesSource = readFileSync(new URL('../src/apps/artisan/routes.jsx', import.meta.url), 'utf8');
const routesDeclarees = new Set([...routesSource.matchAll(/path:\s*'(settings(?:\/[a-z-]+)?)'/g)].map((m) => `/${m[1]}`));

test('le socle est le premier module et chaque module a au moins une tuile', () => {
  assert.equal(MODULES[0].key, 'socle');
  for (const m of MODULES) {
    assert.ok(m.label, `module ${m.key} sans libellé`);
    assert.ok(m.tiles.length >= 1, `module ${m.key} sans tuile`);
  }
});

test('clés de modules, clés de tuiles et routes sont uniques', () => {
  const cles = MODULES.map((m) => m.key);
  assert.equal(new Set(cles).size, cles.length);
  const tuiles = tuilesParametrage();
  const clesTuiles = tuiles.map((t) => t.key);
  assert.equal(new Set(clesTuiles).size, clesTuiles.length);
  const hrefs = tuiles.map((t) => t.href);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test('chaque tuile est complète et pointe vers une route déclarée dans routes.jsx', () => {
  for (const t of tuilesParametrage()) {
    assert.ok(t.title && t.description && t.icon, `tuile ${t.key} incomplète`);
    assert.match(t.href, /^\/settings\/[a-z-]+$/, `tuile ${t.key} : href hors /settings/*`);
    assert.ok(routesDeclarees.has(t.href), `tuile ${t.key} → ${t.href} : aucune route dans routes.jsx (404 garanti)`);
  }
});

test('tuilesParametrage conserve l’ordre des modules et porte le module de chaque tuile', () => {
  const tuiles = tuilesParametrage();
  const ordreModules = [...new Set(tuiles.map((t) => t.module))];
  assert.deepEqual(ordreModules, MODULES.map((m) => m.key));
});

test('catalogue : clés uniques, CRM en tête, chaque module activable a un groupe de Paramètres (sauf le CRM)', () => {
  const cles = CATALOGUE.map((m) => m.key);
  assert.equal(new Set(cles).size, cles.length);
  assert.equal(cles[0], 'crm');
  for (const m of CATALOGUE) {
    assert.equal(typeof m.parDefaut, 'boolean', `${m.key} sans parDefaut`);
    assert.ok(m.label && m.description, `${m.key} incomplet`);
    if (m.key !== 'crm' && !m.sansReglage) assert.ok(MODULES.some((g) => g.key === m.key), `${m.key} sans groupe de Paramètres`);
  }
  assert.ok(!cles.includes('socle'), 'le socle n’est pas activable');
});

test('moduleActif : drapeau booléen explicite, sinon défaut du catalogue ; socle toujours ouvert', () => {
  assert.equal(moduleActif({}, 'socle'), true);
  assert.equal(moduleActif(null, 'crm'), true);
  assert.equal(moduleActif({}, 'solaire'), true, 'modules historiques ouverts par défaut (rien ne change pour Mayer)');
  assert.equal(moduleActif({}, 'communication'), false);
  assert.equal(moduleActif({}, 'maintenance'), false);
  assert.equal(moduleActif({ modules: { communication: true } }, 'communication'), true);
  assert.equal(moduleActif({ modules: { communication: 'true' } }, 'communication'), false, 'une chaîne n’ouvre rien');
  assert.equal(moduleActif({ modules: { solaire: false } }, 'solaire'), false);
  assert.equal(moduleActif({ modules: { inconnu: true } }, 'inconnu'), false, 'clé hors catalogue = fermée');
  assert.equal(crmActif({ modules: { crm: false } }), false);
});

test('modulesVisibles : un module fermé disparaît des Paramètres ; sans CRM seules les tuiles horsCrm du socle restent', () => {
  const cles = (s) => modulesVisibles(s, { isOrgAdmin: true }).map((m) => m.key);
  assert.deepEqual(cles({}), ['socle', 'entretiens', 'solaire', 'thermique']);
  assert.ok(cles({ modules: { maintenance: true } }).includes('maintenance'));
  assert.ok(!cles({ modules: { solaire: false } }).includes('solaire'));
  const s = { modules: { maintenance: true, crm: false, entretiens: false, solaire: false, thermique: false } };
  const tuiles = modulesVisibles(s, { isOrgAdmin: true }).flatMap((m) => m.tiles.map((t) => t.key));
  assert.deepEqual(tuiles.sort(), ['emails', 'maintenance', 'organization']);
  assert.deepEqual(modulesVisibles(s, { isOrgAdmin: false }), []);
});

test('modulesVisibles : la tuile Fournisseurs & catalogue suit le droit articles.edit (team_leader), le hub s’ouvre avec elle', () => {
  const canTeamLeader = (r, a) => r === 'articles' && (a === 'edit' || a === 'view');
  const canCommercial = (r, a) => r === 'articles' && a === 'view';
  const tuiles = (ctx) => modulesVisibles({}, ctx).flatMap((m) => m.tiles.map((t) => t.key));
  assert.deepEqual(tuiles({ isOrgAdmin: false, can: canTeamLeader }), ['suppliers'], 'un team_leader ne voit que la tuile gouvernée par articles.edit');
  assert.deepEqual(tuiles({ isOrgAdmin: false, can: canCommercial }), [], 'articles.view ne suffit pas');
  assert.deepEqual(tuiles({ isOrgAdmin: false }), [], 'sans `can`, une tuile à droit reste réservée à l’admin');
  assert.ok(tuiles({ isOrgAdmin: true }).includes('suppliers'));
  assert.equal(peutOuvrirParametres({}, { isOrgAdmin: false, can: canTeamLeader }), true);
  assert.equal(peutOuvrirParametres({}, { isOrgAdmin: false, can: canCommercial }), false);
});

test('modulesEffectifs : état de chaque module du catalogue, défauts appliqués', () => {
  assert.deepEqual(modulesEffectifs({ modules: { maintenance: true, crm: false } }), {
    crm: false, entretiens: true, communication: false, solaire: true, thermique: true, webshop: false, climatisation: false, cedants: false, prospection: false, geogrid: false, meta_ads: false, maintenance: true, dpe: false, assistant: false,
  });
});

test('validerModules : refuse objet vide, valeur non booléenne, clé hors catalogue', () => {
  assert.deepEqual(validerModules({ maintenance: true, crm: false }), { ok: true, modules: { maintenance: true, crm: false } });
  assert.equal(validerModules({}).erreur, 'invalid_body');
  assert.equal(validerModules(null).erreur, 'invalid_body');
  assert.equal(validerModules([true]).erreur, 'invalid_body');
  assert.equal(validerModules({ crm: 'false' }).erreur, 'invalid_body');
  assert.deepEqual(validerModules({ crm: true, inconnu: true, socle: false }), { ok: false, erreur: 'unknown_module', inconnues: ['inconnu', 'socle'] });
});

test('accueilSansCrm : premier module ouvert qui a un écran, sinon Paramètres', () => {
  assert.equal(accueilSansCrm({ modules: { crm: false, maintenance: true } }), '/entretiens');
  assert.equal(accueilSansCrm({ modules: { crm: false, entretiens: false, maintenance: true } }), '/solaire');
  assert.equal(accueilSansCrm({ modules: { crm: false, entretiens: false, solaire: false, thermique: false, maintenance: true } }), '/maintenance');
  assert.equal(accueilSansCrm({ modules: { crm: false, entretiens: false, solaire: false, thermique: false } }), '/settings');
});

test('moduleDeRoute : chaque route de routes.jsx appartient au socle ou à un module du catalogue', () => {
  const chemins = [...routesSource.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(chemins.length > 30, 'routes.jsx non lu');
  const cles = new Set(['socle', ...CATALOGUE.map((m) => m.key)]);
  for (const c of chemins) {
    assert.ok(cles.has(moduleDeRoute(c)), `route ${c} : module ${moduleDeRoute(c)} inconnu`);
  }
  assert.equal(moduleDeRoute('entretiens'), 'entretiens');
  assert.equal(moduleDeRoute('clients/:clientId/contrat/signer'), 'entretiens');
  assert.equal(moduleDeRoute('solaire/historique'), 'solaire');
  assert.equal(moduleDeRoute('settings/sms'), 'communication');
  assert.equal(moduleDeRoute('settings/emails'), 'socle');
  assert.equal(moduleDeRoute('maintenance'), 'maintenance');
  assert.equal(moduleDeRoute('webshop'), 'webshop');
  assert.equal(moduleDeRoute('settings/webshop'), 'webshop');
  assert.equal(moduleDeRoute('clim'), 'climatisation');
  assert.equal(moduleDeRoute('settings/clim'), 'climatisation');
  assert.equal(moduleDeRoute('cedants'), 'cedants');
  assert.equal(moduleDeRoute('prospection'), 'prospection');
  assert.equal(moduleDeRoute('geogrid'), 'geogrid');
  assert.equal(moduleDeRoute('meta-ads'), 'meta_ads');
  assert.equal(moduleDeRoute('mailing'), 'crm', 'le mailing reste dans la base commune');
  assert.equal(moduleDeRoute('clients/:id'), 'crm');
  assert.equal(moduleDeRoute('route-future-non-declaree'), 'crm', 'par défaut une route appartient au CRM');
});

test('Webshop et Climatisation sont des modules : fermés sans drapeau, ouverts sur drapeau, hors du socle', () => {
  assert.equal(moduleActif({}, 'webshop'), false);
  assert.equal(moduleActif({}, 'climatisation'), false);
  assert.equal(moduleActif({ modules: { webshop: true, climatisation: true } }, 'webshop'), true);
  assert.equal(moduleActif({ modules: { webshop: true, climatisation: true } }, 'climatisation'), true);
  const socle = MODULES.find((m) => m.key === 'socle').tiles.map((t) => t.key);
  assert.ok(!socle.includes('webshop') && !socle.includes('clim'), 'les deux tuiles ne sont plus dans le socle');
  const groupes = (settings) => modulesVisibles(settings, { isOrgAdmin: true }).map((m) => m.key);
  assert.ok(!groupes({}).includes('webshop') && !groupes({}).includes('climatisation'));
  assert.deepEqual(groupes({ modules: { webshop: true, climatisation: true } }).filter((k) => ['webshop', 'climatisation'].includes(k)), ['webshop', 'climatisation']);
});

test('Cédants, Prospection, GeoGrid et Meta Ads sont des modules fermés sans drapeau', () => {
  for (const k of ['cedants', 'prospection', 'geogrid', 'meta_ads']) {
    assert.equal(moduleActif({}, k), false, k);
    assert.equal(moduleActif({ modules: { [k]: true } }, k), true, k);
  }
});

test('une tuile « si » ne s’affiche que si son réglage sert : Plan comptable seulement avec Pennylane', () => {
  const tuiles = (settings) => modulesVisibles(settings, { isOrgAdmin: true }).flatMap((m) => m.tiles.map((t) => t.key));
  assert.ok(!tuiles({}).includes('plan-comptable'));
  assert.ok(!tuiles({ pennylane: { enabled: false } }).includes('plan-comptable'));
  assert.ok(tuiles({ pennylane: { enabled: true } }).includes('plan-comptable'));
  assert.ok(tuiles({}).includes('pennylane'), 'la tuile Facturation, qui porte le lien Pennylane, reste visible');
});
