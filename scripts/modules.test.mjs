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
  MODULES, CATALOGUE, tuilesParametrage, moduleActif, modulesVisibles, crmActif,
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
    if (m.key !== 'crm') assert.ok(MODULES.some((g) => g.key === m.key), `${m.key} sans groupe de Paramètres`);
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

test('modulesEffectifs : état de chaque module du catalogue, défauts appliqués', () => {
  assert.deepEqual(modulesEffectifs({ modules: { maintenance: true, crm: false } }), {
    crm: false, entretiens: true, communication: false, solaire: true, thermique: true, maintenance: true,
  });
});

test('validerModules : refuse objet vide, valeur non booléenne, clé hors catalogue', () => {
  assert.deepEqual(validerModules({ maintenance: true, crm: false }), { ok: true, modules: { maintenance: true, crm: false } });
  assert.equal(validerModules({}).erreur, 'invalid_body');
  assert.equal(validerModules(null).erreur, 'invalid_body');
  assert.equal(validerModules([true]).erreur, 'invalid_body');
  assert.equal(validerModules({ crm: 'false' }).erreur, 'invalid_body');
  assert.deepEqual(validerModules({ crm: true, geogrid: true, socle: false }), { ok: false, erreur: 'unknown_module', inconnues: ['geogrid', 'socle'] });
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
  assert.equal(moduleDeRoute('clients/:id'), 'crm');
  assert.equal(moduleDeRoute('route-future-non-declaree'), 'crm', 'par défaut une route appartient au CRM');
});
