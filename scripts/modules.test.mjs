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
import { MODULES, tuilesParametrage, moduleActif, modulesVisibles, crmActif } from '../src/lib/modules.js';

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

test('moduleActif : socle toujours ouvert ; un module n’est ouvert que par settings.modules[key] === true', () => {
  assert.equal(moduleActif({}, 'socle'), true);
  assert.equal(moduleActif(null, 'socle'), true);
  assert.equal(moduleActif({}, 'communication'), false);
  assert.equal(moduleActif({ modules: { communication: true } }, 'communication'), true);
  assert.equal(moduleActif({ modules: { communication: 'true' } }, 'communication'), false);
  assert.equal(moduleActif({ modules: { communication: true } }, 'solaire'), false);
});

test('modulesVisibles : Maintenance opt-in, masqué tant que settings.modules.maintenance n’est pas vrai', () => {
  const cles = (s) => modulesVisibles(s, { isOrgAdmin: true }).map((m) => m.key);
  assert.ok(!cles({}).includes('maintenance'), 'Mayer (sans drapeau) ne doit pas voir Maintenance');
  assert.ok(cles({ modules: { maintenance: true } }).includes('maintenance'));
  assert.ok(cles({}).includes('entretiens'), 'les modules historiques restent visibles sans drapeau');
});

test('modulesVisibles : sans CRM, seules les tuiles horsCrm restent (Organisation, Emails, Maintenance)', () => {
  const s = { modules: { maintenance: true, crm: false } };
  const tuiles = modulesVisibles(s, { isOrgAdmin: true }).flatMap((m) => m.tiles.map((t) => t.key));
  assert.deepEqual(tuiles.sort(), ['emails', 'maintenance', 'organization']);
  assert.equal(crmActif(s), false);
  assert.equal(crmActif({}), true);
  assert.deepEqual(modulesVisibles(s, { isOrgAdmin: false }), []);
});
