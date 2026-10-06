// scripts/permissions-resolve.test.mjs — chaîne de résolution front = chaîne de role_can (spec profils maison § 4.1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePermission, appDefault } from '../src/lib/permissionsRegistry.js';

// Défauts du registre utilisés comme repères (si le registre change, adapter ici, pas la chaîne)
assert.equal(appDefault('technicien', 'pipeline', 'view'), false);
assert.equal(appDefault('technicien', 'clients', 'edit'), true);
assert.equal(appDefault('technicien', 'clients', 'create'), false);

test('sans profil maison : surcharge du rôle puis défaut (comportement inchangé)', () => {
  assert.equal(resolvePermission(null, 'technicien', 'pipeline', 'view'), false);
  assert.equal(resolvePermission({ 'technicien:pipeline:view': true }, 'technicien', 'pipeline', 'view'), true);
  assert.equal(resolvePermission({}, 'org_admin', 'pipeline', 'delete'), true);
});

test('surcharge du profil maison > surcharge du modèle > défaut du modèle', () => {
  const map = { 'secretaire:pipeline:view': true, 'technicien:pipeline:view': false };
  assert.equal(resolvePermission(map, 'technicien', 'pipeline', 'view', 'secretaire'), true);
  // pas de surcharge maison sur clients.create → surcharge du modèle
  assert.equal(resolvePermission({ 'technicien:clients:create': true }, 'technicien', 'clients', 'create', 'secretaire'), true);
  // ni maison ni modèle → défaut du modèle
  assert.equal(resolvePermission({}, 'technicien', 'clients', 'edit', 'secretaire'), true);
  assert.equal(resolvePermission({}, 'technicien', 'clients', 'create', 'secretaire'), false);
});

test('surcharge maison à false l’emporte même si le modèle dit true', () => {
  const map = { 'secretaire:clients:edit': false };
  assert.equal(resolvePermission(map, 'technicien', 'clients', 'edit', 'secretaire'), false);
});

test('org_admin reste bypass quel que soit le code', () => {
  assert.equal(resolvePermission({ 'secretaire:clients:delete': false }, 'org_admin', 'clients', 'delete', 'secretaire'), true);
});

test('code maison null / vide = pas de profil', () => {
  assert.equal(resolvePermission({ 'secretaire:pipeline:view': true }, 'technicien', 'pipeline', 'view', null), false);
  assert.equal(resolvePermission({ 'secretaire:pipeline:view': true }, 'technicien', 'pipeline', 'view', ''), false);
});
