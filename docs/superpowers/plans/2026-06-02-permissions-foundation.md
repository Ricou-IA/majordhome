# Permissions — Phase 1 : Fondations (registre + socle DB) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poser la base canonique du modèle de droits — un registre JS (source unique des défauts app-level) + le socle DB (`app_role_permissions`, `user_effective_role`, `role_can`) — **sans changer aucun comportement utilisateur** (rien ne consomme encore `role_can`).

**Architecture:** Registre JS pur (`permissionsRegistry.js`) = défauts app-level + mapping resource→tables + résolveur. Côté DB : table `app_role_permissions` seedée depuis le registre, fonction `user_effective_role(org)` (miroir DB de `computeEffectiveRole`), et `role_can(org, resource, action)` qui résout *override per-org → défaut app → bypass admin → fail-closed*. Additif et inerte : aucune policy RLS ni `can()` ne l'appelle encore (vient en Phase 2/3).

**Tech Stack:** React/Vite (JS ESM), Supabase Postgres (RLS, SECURITY DEFINER), vérif par impersonation `execute_sql` + `node` + `vite build` (pas de runner de tests dans ce projet — décision : ne pas en introduire avant la PR du test de cohérence).

**Spec source:** `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`

---

## File Structure

- **Create** `src/lib/permissionsRegistry.js` — registre pur (REGISTRY, défauts, `resolvePermission`, `tableScope`). Aucun import (pour être importable par `node`).
- **Create** `scripts/verify-permissions-registry.mjs` — assertions structurelles + cas de résolution (lancé par `node`).
- **Create** `scripts/gen-app-role-permissions-sql.mjs` — génère le SQL de seed `app_role_permissions` depuis le registre (DRY : registre = source unique).
- **DB (via `apply_migration`)** — `app_role_permissions` + seed + `user_effective_role` + `role_can`. Aucun fichier repo (migrations appliquées via MCP, comme la Couche 1).

Pas de modification de `src/lib/permissions.js`, `usePermissions.js`, ni des policies RLS dans cette phase (Phase 2/3).

---

## PR1 — Registre (JS)

### Task 1 : Créer le registre

**Files:**
- Create: `src/lib/permissionsRegistry.js`

- [ ] **Step 1 : Écrire le registre**

```js
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
  // NOTE: `sav` partage la table `interventions` avec `entretiens` (réconciliation
  // entretiens/sav à traiter dans une phase ultérieure ; ici on garde les défauts existants).
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
 * @param {Object} orgOverrideMap - map "role:resource:action" -> boolean (lignes role_permissions)
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
```

- [ ] **Step 2 : Vérifier que ça compile (build)**

Run: `npx vite build`
Expected: build réussit (le fichier est importé par personne pour l'instant, donc tree-shaké — on valide juste la syntaxe au prochain step via node).

- [ ] **Step 3 : Commit**

```bash
git add src/lib/permissionsRegistry.js
git commit -m "feat(droits): registre de permissions (source unique des defauts app-level)"
```

### Task 2 : Script de vérification du registre

**Files:**
- Create: `scripts/verify-permissions-registry.mjs`

- [ ] **Step 1 : Écrire le script d'assertions**

```js
// scripts/verify-permissions-registry.mjs
// Vérifie la structure du registre + des cas de résolution clés.
// Lancement : node scripts/verify-permissions-registry.mjs
import { REGISTRY, EDITABLE_ROLES, resolvePermission, appDefault, tableScope }
  from '../src/lib/permissionsRegistry.js';

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

if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1); }
console.log('✅ Registre OK');
```

- [ ] **Step 2 : Lancer — doit échouer AVANT le registre (ordre des tâches)**

> Si Task 1 n'est pas faite, l'import échoue. Comme Task 1 précède, ce step sert de garde : on s'attend à un **succès** une fois Task 1 mergée.

Run: `node scripts/verify-permissions-registry.mjs`
Expected: `✅ Registre OK` (exit 0).

- [ ] **Step 3 : Casser volontairement un cas pour prouver que le script détecte (sanity)**

Modifier temporairement le script : changer `tech clients.edit = true` en attendre `false`.
Run: `node scripts/verify-permissions-registry.mjs`
Expected: `❌ tech clients.edit = true` + exit 1. **Puis remettre la valeur correcte.**

- [ ] **Step 4 : Commit**

```bash
git add scripts/verify-permissions-registry.mjs
git commit -m "test(droits): script de verification du registre de permissions"
```

---

## PR2 — Socle DB

> Les objets DB sont appliqués via le tool MCP `apply_migration` (comme la Couche 1), pas un fichier repo. Additif et inerte : rien ne les consomme encore.

### Task 3 : Table `app_role_permissions` + seed depuis le registre

**Files:**
- Create: `scripts/gen-app-role-permissions-sql.mjs`
- DB: migration `app_role_permissions_table_and_seed`

- [ ] **Step 1 : Écrire le générateur de SQL de seed**

```js
// scripts/gen-app-role-permissions-sql.mjs
// Émet le SQL de seed app_role_permissions depuis le registre (registre = source unique).
// Lancement : node scripts/gen-app-role-permissions-sql.mjs
import { iterAppDefaults } from '../src/lib/permissionsRegistry.js';

const rows = [...iterAppDefaults()]
  .map(r => `  ('${r.role}','${r.resource}','${r.action}',${r.allowed})`)
  .join(',\n');

console.log(`INSERT INTO majordhome.app_role_permissions (role, resource, action, allowed) VALUES
${rows}
ON CONFLICT (role, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;`);
```

- [ ] **Step 2 : Générer le SQL de seed**

Run: `node scripts/gen-app-role-permissions-sql.mjs`
Expected: un bloc `INSERT ... VALUES (...) ON CONFLICT ...` (≈ 80 lignes). **Copier ce bloc** pour l'étape suivante.

- [ ] **Step 3 : Appliquer la migration (table + RLS + seed généré)**

Via `apply_migration` (name: `app_role_permissions_table_and_seed`) :

```sql
CREATE TABLE IF NOT EXISTS majordhome.app_role_permissions (
  role     text    NOT NULL,
  resource text    NOT NULL,
  action   text    NOT NULL,
  allowed  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, resource, action)
);

ALTER TABLE majordhome.app_role_permissions ENABLE ROW LEVEL SECURITY;

-- Défauts lisibles par tout authentifié (role_can les lit en SECDEF de toute façon).
-- Écriture : aucune policy => seulement service_role/migrations (super-admin).
DROP POLICY IF EXISTS app_role_permissions_read ON majordhome.app_role_permissions;
CREATE POLICY app_role_permissions_read ON majordhome.app_role_permissions
  FOR SELECT USING (true);

GRANT SELECT ON majordhome.app_role_permissions TO authenticated, service_role;

-- <<< COLLER ICI le bloc INSERT généré au Step 2 >>>
```

- [ ] **Step 4 : Vérifier le seed**

Via `execute_sql` :
```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE allowed) AS allowed_true
FROM majordhome.app_role_permissions;

SELECT allowed FROM majordhome.app_role_permissions
WHERE role='technicien' AND resource='clients' AND action='create';   -- attendu: false
SELECT allowed FROM majordhome.app_role_permissions
WHERE role='technicien' AND resource='clients' AND action='edit';     -- attendu: true
SELECT allowed FROM majordhome.app_role_permissions
WHERE role='team_leader' AND resource='devis' AND action='delete';    -- attendu: false (delta)
```
Expected: `total` ≈ 80 ; les 3 valeurs = false / true / false.

### Task 4 : Fonction `user_effective_role`

**Files:**
- DB: migration `user_effective_role_fn`

- [ ] **Step 1 : Écrire la vérification (doit échouer — fonction absente)**

Via `execute_sql` :
```sql
BEGIN;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d37f2b59-d32e-4fdb-a348-28a8f22f9ea7","role":"authenticated"}', true);
SELECT majordhome.user_effective_role('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
ROLLBACK;
```
Expected: ERREUR `function majordhome.user_effective_role(uuid) does not exist`.

- [ ] **Step 2 : Appliquer la migration**

Via `apply_migration` (name: `user_effective_role_fn`) :
```sql
CREATE OR REPLACE FUNCTION majordhome.user_effective_role(p_org_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public
AS $$
  SELECT CASE
    WHEN om.role = 'org_admin'   OR p.app_role = 'org_admin'   THEN 'org_admin'
    WHEN om.role = 'team_leader' OR p.app_role = 'team_leader' THEN 'team_leader'
    WHEN lower(coalesce(p.business_role, '')) = 'commercial'   THEN 'commercial'
    ELSE 'technicien'
  END
  FROM core.organization_members om
  LEFT JOIN core.profiles p ON p.id = om.user_id
  WHERE om.user_id = auth.uid() AND om.org_id = p_org_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION majordhome.user_effective_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.user_effective_role(uuid) TO authenticated, service_role;
```

- [ ] **Step 3 : Vérifier (impersonation)**

Via `execute_sql`, en tant que Ludovic (membre) puis Eric (admin) :
```sql
-- Ludovic -> 'technicien'
BEGIN; SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d37f2b59-d32e-4fdb-a348-28a8f22f9ea7","role":"authenticated"}', true);
SELECT majordhome.user_effective_role('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1') AS r;
ROLLBACK;
-- Eric -> 'org_admin'
BEGIN; SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims','{"sub":"8a4907a3-f382-4707-bc38-2ff4832f873a","role":"authenticated"}', true);
SELECT majordhome.user_effective_role('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1') AS r;
ROLLBACK;
```
Expected: Ludovic → `technicien` ; Eric → `org_admin`.

### Task 5 : Fonction `role_can` (le résolveur)

**Files:**
- DB: migration `role_can_fn`

- [ ] **Step 1 : Vérification (doit échouer — fonction absente)**

Via `execute_sql` :
```sql
SELECT majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','clients','edit');
```
Expected: ERREUR `function majordhome.role_can(...) does not exist`.

- [ ] **Step 2 : Appliquer la migration**

Via `apply_migration` (name: `role_can_fn`) :
```sql
CREATE OR REPLACE FUNCTION majordhome.role_can(p_org_id uuid, p_resource text, p_action text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = majordhome, core, public
AS $$
DECLARE
  v_role text;
  v_allowed boolean;
BEGIN
  v_role := majordhome.user_effective_role(p_org_id);
  IF v_role IS NULL THEN RETURN false; END IF;       -- pas membre de l'org
  IF v_role = 'org_admin' THEN RETURN true; END IF;  -- bypass admin

  -- 1) override per-org
  SELECT allowed INTO v_allowed
  FROM majordhome.role_permissions
  WHERE org_id = p_org_id AND role = v_role AND resource = p_resource AND action = p_action;
  IF FOUND THEN RETURN v_allowed; END IF;

  -- 2) défaut app-level
  SELECT allowed INTO v_allowed
  FROM majordhome.app_role_permissions
  WHERE role = v_role AND resource = p_resource AND action = p_action;
  IF FOUND THEN RETURN v_allowed; END IF;

  RETURN false;  -- fail-closed
END;
$$;

REVOKE ALL ON FUNCTION majordhome.role_can(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION majordhome.role_can(uuid, text, text) TO authenticated, service_role;
```

- [ ] **Step 3 : Vérifier la résolution (impersonation Ludovic = technicien)**

Via `execute_sql` :
```sql
BEGIN; SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d37f2b59-d32e-4fdb-a348-28a8f22f9ea7","role":"authenticated"}', true);
SELECT
  majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','clients','edit')   AS edit_clients,   -- true
  majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','clients','create') AS create_clients, -- false
  majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','clients','delete') AS delete_clients, -- false
  majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','pipeline','view')  AS view_pipeline;  -- false
ROLLBACK;
```
Expected: `edit_clients=true`, `create_clients=false`, `delete_clients=false`, `view_pipeline=false`.

- [ ] **Step 4 : Vérifier l'override per-org (transaction jetable)**

Via `execute_sql` — on pose un override puis on teste, le tout en ROLLBACK (aucune écriture durable) :
```sql
BEGIN;
INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed)
VALUES ('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','technicien','clients','create',true)
ON CONFLICT (org_id,role,resource,action) DO UPDATE SET allowed=excluded.allowed;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d37f2b59-d32e-4fdb-a348-28a8f22f9ea7","role":"authenticated"}', true);
SELECT majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','clients','create') AS create_after_override; -- true
ROLLBACK;
```
Expected: `create_after_override=true` (l'override per-org prime sur le défaut app `false`). Le ROLLBACK annule l'override.

- [ ] **Step 5 : Vérifier le bypass admin + le non-membre**

Via `execute_sql` :
```sql
-- Eric (admin) : tout true
BEGIN; SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims','{"sub":"8a4907a3-f382-4707-bc38-2ff4832f873a","role":"authenticated"}', true);
SELECT majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','settings','edit') AS admin_settings_edit; -- true
ROLLBACK;
-- Membre d'une autre org : false (pas membre de Mayer)
BEGIN; SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims','{"sub":"4bbab25f-8e95-433d-93a3-459ef1cbcfd5","role":"authenticated"}', true);
SELECT majordhome.role_can('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1','clients','edit') AS crossorg_edit; -- false
ROLLBACK;
```
Expected: `admin_settings_edit=true`, `crossorg_edit=false`.

- [ ] **Step 6 : Commit les scripts générateurs (les objets DB sont déjà appliqués)**

```bash
git add scripts/gen-app-role-permissions-sql.mjs
git commit -m "feat(droits): socle DB permissions (app_role_permissions, user_effective_role, role_can)"
```

---

## Self-Review

**Spec coverage (Phase 1 uniquement) :**
- §4 Registre → Task 1 ✅
- §5 Défauts app-level (`app_role_permissions`) + résolution override→défaut→admin → Task 3 + Task 5 ✅
- §7 `user_effective_role` + `role_can` (SECDEF, REVOKE anon) → Tasks 4-5 ✅
- §10 Règles métier (delete=admin only deltas devis/tasks) → encodées dans le registre + seed ✅
- **Hors Phase 1 (Phases suivantes)** : merge front `getPermissions`/`PermissionsEditor` (§6), policies RLS d'écriture + union `interventions` (§7/§9), test de cohérence CI (§8), retrait `org_seed_permissions` + purge Mayer (§11 PR6). **Inertie garantie** : aucune policy/`can()` ne consomme `role_can` en Phase 1.

**Placeholder scan :** aucun TODO/TBD ; tout le code (registre, scripts, SQL) est complet ; les UUID de test sont réels (Ludovic `d37f2b59…`, Eric `8a4907a3…`, cross-org `4bbab25f…`, org Mayer `3c68193e…`).

**Type/consistance :** `resolvePermission`, `appDefault`, `tableScope`, `iterAppDefaults` définis en Task 1 et utilisés tels quels en Tasks 2-3 ; `role_can`/`user_effective_role` signatures cohérentes entre définition (Tasks 4-5) et vérifs.

**Risque clé :** `role_can` lit `role_permissions` + `app_role_permissions` en SECDEF (bypasse RLS) — OK, lecture seule. Aucun objet `core` modifié.

---

## Execution Handoff

Plan complet et sauvegardé dans `docs/superpowers/plans/2026-06-02-permissions-foundation.md`. Deux options d'exécution :

1. **Subagent-Driven (recommandé)** — je dispatche un subagent frais par task, revue entre les tasks, itération rapide.
2. **Inline Execution** — j'exécute les tasks dans cette session (executing-plans), exécution par lots avec checkpoints de revue.

Laquelle ?
