// src/lib/permissionsRegistry.js
// ============================================================================
// Registre de permissions — SOURCE UNIQUE des défauts app-level.
// Consommé par : le front (can() après merge, Phase 3) ET le seed DB
// app_role_permissions (Phase 1) + le test de cohérence (Phase plus tard).
// Fichier PUR (aucun import) pour être importable par node et par Vite.
// org_admin n'apparaît jamais ici : il est bypass total partout.
// Ordre des tuples de défaut : [team_leader, commercial, technicien].
// ============================================================================

const d = ([tl, co, te]) => ({ team_leader: !!tl, commercial: !!co, technicien: !!te });

// scope d'une table : 'org' (org_id direct) | 'project' (via core.projects)
// | 'client' (via clients) | 'parent:<table>' (hérite) | 'reference' (lecture ouverte)
export const REGISTRY = {
  dashboard: { label: 'Dashboard', tables: {}, actions: {
    view: { sql: 'SELECT', default: d([1, 1, 1]) },
  } },
  clients: { label: 'Clients', tables: {
    clients: 'org', client_activities: 'org', equipments: 'project',
    contracts: 'org', contract_equipments: 'parent:contracts', contract_pricing_items: 'parent:contracts',
  }, actions: {
    view:   { sql: 'SELECT', default: d([1, 1, 1]) },
    create: { sql: 'INSERT', default: d([1, 1, 0]) },
    edit:   { sql: 'UPDATE', default: d([1, 1, 1]) },
    delete: { sql: 'DELETE', default: d([0, 0, 0]) },
  } },
  pipeline: { label: 'Pipeline', tables: {
    leads: 'org', lead_activities: 'org', lead_interactions: 'org',
  }, actions: {
    view:     { sql: 'SELECT', default: d([1, 1, 0]) },
    create:   { sql: 'INSERT', default: d([1, 1, 0]) },
    edit:     { sql: 'UPDATE', default: d([1, 0, 0]) },
    edit_own: { sql: 'UPDATE', default: d([1, 1, 0]) },
    delete:   { sql: 'DELETE', default: d([0, 0, 0]) },
    assign:   { sql: null,     default: d([1, 0, 0]) },
  } },
  chantiers: { label: 'Chantiers', tables: { chantier_line_receptions: 'org' }, actions: {
    view:     { sql: 'SELECT', default: d([1, 1, 1]) },
    edit:     { sql: 'UPDATE', default: d([1, 0, 0]) },
    edit_own: { sql: 'UPDATE', default: d([1, 1, 1]) },
  } },
  planning: { label: 'Planning', tables: {
    appointments: 'org', appointment_technicians: 'parent:appointments',
  }, actions: {
    view:   { sql: 'SELECT', default: d([1, 1, 1]) },
    create: { sql: 'INSERT', default: d([1, 1, 0]) },
  } },
  entretiens: { label: 'Entretiens', tables: {
    interventions: 'project', maintenance_visits: 'org', certificats: 'org',
  }, actions: {
    view:   { sql: 'SELECT', default: d([1, 1, 1]) },
    create: { sql: 'INSERT', default: d([1, 1, 1]) },
    edit:   { sql: 'UPDATE', default: d([1, 0, 1]) },
  } },
  // NOTE: asymétrie connue avec permissions.js (RESOURCES) : `sav` est ici mais pas
  // dans RESOURCES ; `cedants`/`prospection_commerciale` sont dans RESOURCES mais absents
  // ici (=> fail-closed). Le registre reflète la réalité DB actuelle. Réconciliation
  // (incl. fusion sav/entretiens + unification permissions.js) traitée en Phase 3 au câblage de can().
  sav: { label: 'SAV', tables: {}, actions: {
    view:   { sql: 'SELECT', default: d([1, 1, 1]) },
    create: { sql: 'INSERT', default: d([1, 0, 0]) },
    edit:   { sql: 'UPDATE', default: d([1, 0, 0]) },
  } },
  devis: { label: 'Devis', tables: {
    quotes: 'org', quote_lines: 'parent:quotes', quote_templates: 'org',
  }, actions: {
    view:   { sql: 'SELECT', default: d([1, 1, 0]) },
    create: { sql: 'INSERT', default: d([1, 1, 0]) },
    edit:   { sql: 'UPDATE', default: d([1, 1, 0]) },
    delete: { sql: 'DELETE', default: d([0, 0, 0]) }, // delta Eric : delete = admin only
  } },
  tasks: { label: 'Tâches', tables: { tasks: 'org', task_notes: 'parent:tasks' }, actions: {
    view:     { sql: 'SELECT', default: d([1, 1, 1]) },
    create:   { sql: 'INSERT', default: d([1, 1, 1]) },
    edit:     { sql: 'UPDATE', default: d([1, 0, 0]) },
    edit_own: { sql: 'UPDATE', default: d([0, 1, 0]) },
    delete:   { sql: 'DELETE', default: d([0, 0, 0]) }, // delta Eric : delete = admin only
    assign:   { sql: null,     default: d([1, 0, 0]) },
  } },
  territoire: { label: 'Territoire', tables: {}, actions: {
    view: { sql: 'SELECT', default: d([1, 1, 1]) },
  } },
  meta_ads: { label: 'Meta Ads', tables: { meta_ads_daily_stats: 'org' }, actions: {
    view: { sql: 'SELECT', default: d([0, 0, 0]) },
  } },
  voice_recorder: { label: 'Compte-rendu vocal (PWA)', tables: { voice_memos: 'org' }, actions: {
    use: { sql: null, default: d([1, 0, 0]) },
  } },
  settings: { label: 'Paramètres', tables: {}, actions: {
    view: { sql: null, default: d([0, 0, 0]) },
    edit: { sql: null, default: d([0, 0, 0]) },
  } },
  // cedants / prospection_commerciale : pas de défaut => fail-closed (false) pour les non-admin.
};

export const EDITABLE_ROLES = ['team_leader', 'commercial', 'technicien'];

/** Défaut app-level pour (role, resource, action). org_admin = toujours true. */
export function appDefault(role, resource, action) {
  if (role === 'org_admin') return true;
  const a = REGISTRY[resource]?.actions?.[action];
  return a ? a.default[role] === true : false; // fail-closed
}

/**
 * Résolution canonique : override per-org si présent, sinon défaut app, sinon false.
 * @param {Object|null} orgOverrideMap - map "role:resource:action" -> boolean (lignes role_permissions) (null => aucun override, on retombe sur appDefault)
 */
export function resolvePermission(orgOverrideMap, role, resource, action) {
  if (role === 'org_admin') return true;
  const key = `${role}:${resource}:${action}`;
  if (orgOverrideMap && Object.prototype.hasOwnProperty.call(orgOverrideMap, key)) {
    return orgOverrideMap[key] === true;
  }
  return appDefault(role, resource, action);
}

/** table DB -> { resource, scope } (première resource propriétaire). null si non gérée. */
export function tableScope(table) {
  for (const [resource, def] of Object.entries(REGISTRY)) {
    if (def.tables && Object.prototype.hasOwnProperty.call(def.tables, table)) {
      return { resource, scope: def.tables[table] };
    }
  }
  return null;
}

/** Itère tous les (role, resource, action, allowed) des défauts app (pour le seed DB). */
export function* iterAppDefaults() {
  for (const [resource, def] of Object.entries(REGISTRY)) {
    for (const [action, spec] of Object.entries(def.actions)) {
      for (const role of EDITABLE_ROLES) {
        yield { role, resource, action, allowed: spec.default[role] === true };
      }
    }
  }
}
