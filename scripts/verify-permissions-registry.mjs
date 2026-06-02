// scripts/verify-permissions-registry.mjs
// Vérifie la structure du registre + des cas de résolution clés.
// Lancement : node scripts/verify-permissions-registry.mjs
import { REGISTRY, EDITABLE_ROLES, resolvePermission, appDefault, tableScope, iterAppDefaults }
  from '../src/lib/permissionsRegistry.js';
import { hasPermission } from '../src/lib/permissions.js';

let failures = 0;
const assert = (cond, msg) => { if (!cond) { console.error('❌', msg); failures++; } };

// 1. Structure : chaque action a un défaut booléen pour chaque rôle éditable
for (const [resource, def] of Object.entries(REGISTRY)) {
  for (const [action, spec] of Object.entries(def.actions)) {
    for (const role of EDITABLE_ROLES) {
      assert(typeof spec.default[role] === 'boolean',
        `${resource}.${action}.${role} doit être booléen`);
    }
  }
}

// 2. Cas de résolution (défauts app, sans override)
assert(resolvePermission({}, 'technicien', 'clients', 'create') === false, 'tech clients.create = false');
assert(resolvePermission({}, 'technicien', 'clients', 'edit')   === true,  'tech clients.edit = true');
assert(resolvePermission({}, 'commercial', 'pipeline', 'create') === true, 'com pipeline.create = true');
assert(resolvePermission({}, 'technicien', 'clients', 'delete') === false, 'tech clients.delete = false');
assert(resolvePermission({}, 'team_leader', 'devis', 'delete')  === false, 'TL devis.delete = false (delta)');
assert(resolvePermission({}, 'org_admin', 'settings', 'edit')   === true,  'admin bypass');

// 3. Override per-org prime sur le défaut
assert(resolvePermission({ 'technicien:clients:create': true }, 'technicien', 'clients', 'create') === true,
  'override true prime sur défaut false');

// 4. Mapping table -> resource/scope
assert(tableScope('equipments')?.scope === 'project', 'equipments scope = project');
assert(tableScope('clients')?.resource === 'clients', 'clients -> clients');
assert(tableScope('inconnue') === null, 'table inconnue -> null');

// 5. iterAppDefaults : shape + valeurs de seed
const defaults = [...iterAppDefaults()];
assert(defaults.length > 0, 'iterAppDefaults émet des tuples');
assert(defaults.every(x => typeof x.allowed === 'boolean'), 'seed: allowed booléen');
assert(defaults.find(x => x.role==='team_leader' && x.resource==='clients' && x.action==='view')?.allowed === true, 'seed: TL clients.view = true');
assert(defaults.find(x => x.role==='technicien' && x.resource==='clients' && x.action==='delete')?.allowed === false, 'seed: tech clients.delete = false');

// 6. Override false prime sur défaut true
assert(resolvePermission({ 'team_leader:clients:view': false }, 'team_leader', 'clients', 'view') === false,
  'override false prime sur défaut true');

// 7. Aucune table enregistrée dans 2 resources
const tableIndex = {};
for (const [res, def] of Object.entries(REGISTRY)) {
  for (const tbl of Object.keys(def.tables || {})) {
    assert(!tableIndex[tbl], `table '${tbl}' dans 2 resources (${tableIndex[tbl]} & ${res})`);
    tableIndex[tbl] = res;
  }
}

// 8. hasPermission (permissions.js) délègue bien à resolvePermission
assert(hasPermission({}, 'technicien', 'clients', 'create') === false, 'hasPermission tech clients.create = false');
assert(hasPermission({}, 'technicien', 'clients', 'edit') === true, 'hasPermission tech clients.edit = true');
assert(hasPermission({ 'technicien:clients:create': true }, 'technicien', 'clients', 'create') === true, 'hasPermission respecte override');
assert(hasPermission({}, 'org_admin', 'settings', 'edit') === true, 'hasPermission admin bypass');

if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1); }
console.log('✅ Registre OK');
