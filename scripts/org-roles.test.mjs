// scripts/org-roles.test.mjs — logique de présentation des profils « maison » (src/lib/orgRoles.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roleChoiceValue, parseRoleChoice, buildRoleOptions, memberRoleDisplay, permissionColumns, BASE_ROLES,
} from '../src/lib/orgRoles.js';

const LABELS = { org_admin: 'Administrateur', team_leader: 'Responsable', commercial: 'Commercial', technicien: 'Technicien' };
const SECRETAIRE = { id: 'r1', code: 'secretaire', label: 'Secrétaire', base_role: 'team_leader', is_active: true };
const ARCHIVE = { id: 'r2', code: 'archive', label: 'Archivé', base_role: 'commercial', is_active: false };

test('roleChoiceValue / parseRoleChoice font l’aller-retour', () => {
  assert.equal(roleChoiceValue(SECRETAIRE), 'org:r1');
  assert.deepEqual(parseRoleChoice('org:r1'), { kind: 'org', orgRoleId: 'r1' });
  assert.deepEqual(parseRoleChoice('team_leader'), { kind: 'standard', role: 'team_leader' });
  assert.equal(parseRoleChoice('org:'), null);
  assert.equal(parseRoleChoice('patron'), null);
  assert.equal(parseRoleChoice(''), null);
});

test('buildRoleOptions : standards puis profils actifs seulement', () => {
  const opts = buildRoleOptions(['org_admin', 'team_leader'], LABELS, [SECRETAIRE, ARCHIVE]);
  assert.deepEqual(opts, [
    { value: 'org_admin', label: 'Administrateur' },
    { value: 'team_leader', label: 'Responsable' },
    { value: 'org:r1', label: 'Secrétaire (d’après Responsable)' },
  ]);
  assert.deepEqual(buildRoleOptions(['technicien'], LABELS, []), [{ value: 'technicien', label: 'Technicien' }]);
  assert.deepEqual(buildRoleOptions(['technicien'], LABELS, null), [{ value: 'technicien', label: 'Technicien' }]);
});

test('memberRoleDisplay : libellé du profil, sous-ligne du modèle', () => {
  assert.deepEqual(memberRoleDisplay('team_leader', SECRETAIRE, LABELS), { label: 'Secrétaire', sub: 'd’après Responsable' });
  assert.deepEqual(memberRoleDisplay('technicien', null, LABELS), { label: 'Technicien', sub: null });
  assert.deepEqual(memberRoleDisplay('inconnu', null, LABELS), { label: 'inconnu', sub: null });
});

test('permissionColumns : standards puis profils actifs, chacun avec son modèle', () => {
  const cols = permissionColumns(['team_leader', 'commercial', 'technicien'], LABELS, [SECRETAIRE, ARCHIVE]);
  assert.equal(cols.length, 4);
  assert.deepEqual(cols[0], { key: 'team_leader', role: 'team_leader', code: null, label: 'Responsable', sub: null, orgRole: null });
  assert.deepEqual(cols[3], { key: 'secretaire', role: 'team_leader', code: 'secretaire', label: 'Secrétaire', sub: 'd’après Responsable', orgRole: SECRETAIRE });
});

test('BASE_ROLES = les 3 modèles autorisés en base', () => {
  assert.deepEqual(BASE_ROLES, ['team_leader', 'commercial', 'technicien']);
});
