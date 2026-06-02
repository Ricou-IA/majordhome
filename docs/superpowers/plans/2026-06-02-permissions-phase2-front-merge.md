# Permissions — Phase 2 : Merge front (registre ⊕ overrides) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Brancher le front sur le registre : `can()` résout **override per-org ⊕ défaut app** (au lieu de per-org seul), et l'écran « Droits d'accès » se rend **depuis le registre** avec un indicateur défaut/surcharge.

**Architecture:** `src/lib/permissions.js::hasPermission` délègue à `resolvePermission` du registre (Phase 1). `PermissionsEditor.jsx` itère `REGISTRY` au lieu de `RESOURCES`/`getActionsForResource`. La RLS n'est PAS encore branchée (Phase 3) — seul le gating UI change. Impact prod minimal : Mayer a déjà ses rows (overrides) qui priment ; les deltas delete restent à `true` pour Mayer jusqu'au nettoyage (Phase 5).

**Tech Stack:** React/Vite JS ESM. Vérif : `node scripts/verify-permissions-registry.mjs`, `npm run lint:errors`, + comparaison contrôleur old-vs-new pour Mayer (SQL+node).

**Spec source:** `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md` (§6)

---

## File Structure
- **Modify** `src/lib/permissions.js` — `hasPermission` + `getResourcePermissions` délèguent au registre.
- **Modify** `src/apps/artisan/pages/settings/PermissionsEditor.jsx` — rendu depuis `REGISTRY` + indicateur surcharge.
- **Modify** `scripts/verify-permissions-registry.mjs` — assertion que `hasPermission` (permissions.js) == `resolvePermission`.

---

## Task 1 — `permissions.js` registry-aware

**Files:** Modify `src/lib/permissions.js`, `scripts/verify-permissions-registry.mjs`

- [ ] **Step 1 : Importer le registre en tête de `permissions.js`**

Ajouter après le bloc de commentaire d'en-tête (avant les constantes), un import RELATIF (pour rester importable par node) :
```js
import { resolvePermission } from './permissionsRegistry.js';
```

- [ ] **Step 2 : Remplacer le corps de `hasPermission`**

Remplacer :
```js
export function hasPermission(permissionMap, role, resource, action) {
  // Sécurité : org_admin = accès total (même si DB corrompu)
  if (role === 'org_admin') return true;

  const key = `${role}:${resource}:${action}`;
  return permissionMap[key] === true;
}
```
par :
```js
export function hasPermission(permissionMap, role, resource, action) {
  // Délègue au registre : org_admin bypass, sinon override per-org (permissionMap)
  // s'il existe, sinon défaut app-level. permissionMap = map des overrides per-org.
  return resolvePermission(permissionMap, role, resource, action);
}
```

- [ ] **Step 3 : Rendre `getResourcePermissions` registry-aware**

Remplacer la boucle qui lit `permissionMap[key] === true` par un appel à `resolvePermission` (garder le raccourci org_admin) :
```js
export function getResourcePermissions(permissionMap, role, resource) {
  const result = {};
  for (const a of ACTIONS) {
    result[a.key] = resolvePermission(permissionMap, role, resource, a.key);
  }
  return result;
}
```
(org_admin est déjà géré par `resolvePermission` → on peut retirer le bloc spécial org_admin, ou le garder ; `resolvePermission` renvoie déjà true pour org_admin.)

- [ ] **Step 4 : Ajouter une assertion croisée dans le verifier**

Dans `scripts/verify-permissions-registry.mjs`, ajouter `hasPermission` à un nouvel import depuis `../src/lib/permissions.js` et asserter qu'il est cohérent avec `resolvePermission` :
```js
import { hasPermission } from '../src/lib/permissions.js';
// ... (à la fin, avant le if(failures))
// 8. hasPermission (permissions.js) délègue bien à resolvePermission
assert(hasPermission({}, 'technicien', 'clients', 'create') === false, 'hasPermission tech clients.create = false');
assert(hasPermission({}, 'technicien', 'clients', 'edit') === true, 'hasPermission tech clients.edit = true');
assert(hasPermission({ 'technicien:clients:create': true }, 'technicien', 'clients', 'create') === true, 'hasPermission respecte override');
assert(hasPermission({}, 'org_admin', 'settings', 'edit') === true, 'hasPermission admin bypass');
```

- [ ] **Step 5 : Vérifier**

Run: `node scripts/verify-permissions-registry.mjs` → `✅ Registre OK`, exit 0.
Run: `npm run lint:errors` → exit 0 (pas de nouvelle erreur).
(NE PAS lancer `vite build` — refacto concurrent possible.)

- [ ] **Step 6 : Commit (pathspec)**

```bash
git add src/lib/permissions.js scripts/verify-permissions-registry.mjs
git commit -m "feat(droits): hasPermission resout override+defaut app (merge front)" -- src/lib/permissions.js scripts/verify-permissions-registry.mjs
```

---

## Task 2 — `PermissionsEditor.jsx` depuis le registre + indicateur surcharge

**Files:** Modify `src/apps/artisan/pages/settings/PermissionsEditor.jsx`

- [ ] **Step 1 : Adapter les imports**

Remplacer l'import depuis `@lib/permissions` pour : retirer `RESOURCES`, garder `ACTIONS, EDITABLE_ROLES, ROLE_LABELS, hasPermission`, et AJOUTER l'import du registre :
```js
import { ACTIONS, EDITABLE_ROLES, ROLE_LABELS, hasPermission } from '@lib/permissions';
import { REGISTRY } from '@lib/permissionsRegistry';
```

- [ ] **Step 2 : Map des labels d'action + set des surcharges**

Dans le composant, après `const { permissionMap, permissionRows, isLoading, error } = usePermissions(orgId);`, ajouter :
```js
const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label]));
const overrideSet = new Set(
  (permissionRows || []).map((r) => `${r.role}:${r.resource}:${r.action}`)
);
```

- [ ] **Step 3 : Supprimer `getActionsForResource`**

Retirer toute la fonction `getActionsForResource` (les actions viennent désormais du registre).

- [ ] **Step 4 : Rendre la matrice depuis le registre**

Remplacer `{RESOURCES.map((resource) => { const actions = getActionsForResource(resource.key); return actions.map((action, actionIdx) => ( ... ))})}` par une itération sur `REGISTRY`. Chaque resource = `[key, def]` ; ses actions = `Object.keys(def.actions)` :
```jsx
{Object.entries(REGISTRY).map(([resourceKey, def]) => {
  const actionKeys = Object.keys(def.actions);
  return actionKeys.map((actionKey, actionIdx) => (
    <tr
      key={`${resourceKey}-${actionKey}`}
      className={`border-b border-secondary-100 ${actionIdx === 0 ? 'border-t-2 border-t-secondary-200' : ''}`}
    >
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-2">
          {actionIdx === 0 && (
            <span className="text-sm font-semibold text-secondary-900">{def.label}</span>
          )}
          {actionIdx > 0 && <span className="w-[1px]" />}
          <span className="text-sm text-secondary-500 ml-4">
            {ACTION_LABEL[actionKey] || actionKey}
          </span>
        </div>
      </td>
      {EDITABLE_ROLES.map((role) => {
        const allowed = hasPermission(permissionMap, role, resourceKey, actionKey);
        const isOverride = overrideSet.has(`${role}:${resourceKey}:${actionKey}`);
        return (
          <td key={role} className="py-2.5 px-3 text-center">
            <button
              onClick={() => handleToggle(role, resourceKey, actionKey, allowed)}
              className={`relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                allowed
                  ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                  : 'bg-secondary-100 text-secondary-400 hover:bg-secondary-200'
              } ${isOverride ? 'ring-2 ring-amber-400' : ''}`}
              title={`${ROLE_LABELS[role]} : ${allowed ? 'autorisé' : 'refusé'}${isOverride ? ' (surcharge org)' : ' (défaut app)'}`}
            >
              {allowed ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            </button>
          </td>
        );
      })}
    </tr>
  ));
})}
```

- [ ] **Step 5 : Ajouter la légende défaut/surcharge**

Dans le bloc info bleu en bas (`Comment fonctionnent les permissions`), ajouter une ligne :
```jsx
<li>
  <strong>Anneau ambre</strong> — réglage spécifique à cette organisation (surcharge). Sans anneau = défaut commun à toutes les organisations.
</li>
```

- [ ] **Step 6 : Vérifier**

Run: `npm run lint:errors` → exit 0 (valide JSX/imports ; ne PAS lancer vite build).
Vérif visuelle déléguée à Eric (il a son serveur de dev).

- [ ] **Step 7 : Commit (pathspec)**

```bash
git add src/apps/artisan/pages/settings/PermissionsEditor.jsx
git commit -m "feat(droits): editeur permissions rendu depuis le registre + indicateur surcharge" -- src/apps/artisan/pages/settings/PermissionsEditor.jsx
```

---

## Self-Review
- §6 spec (merge front : getPermissions/can lit défauts⊕overrides ; éditeur depuis registre) → Tasks 1-2 ✅.
- Pas de placeholder ; tout le code fourni.
- `permissions.js` import RELATIF (`./permissionsRegistry.js`) pour rester node-importable (le verifier l'importe).
- Cohérence types : `hasPermission(permissionMap, role, resource, action)` signature inchangée ; `resolvePermission(orgOverrideMap, role, resource, action)` (Phase 1) reçoit `permissionMap` comme map d'overrides.
- **Reset to default (suppression d'override)** : hors scope Phase 2 (toggling crée/maj un override ; revenir au défaut = follow-up avec `deletePermission`). Noté.
- **Impact Mayer** : à vérifier en exécution — comparer pour Mayer `resolvePermission(map,…)` (new) vs `map[key]===true` (old) sur tous (role,resource,action) du registre ; diffs attendus = uniquement les combos sans row Mayer dont le défaut diffère (devrait être nul ou intentionnel).

## Execution
Subagent-driven. Implémenteur unique pour Tasks 1-2 (cohésif), puis revue spec + qualité.
