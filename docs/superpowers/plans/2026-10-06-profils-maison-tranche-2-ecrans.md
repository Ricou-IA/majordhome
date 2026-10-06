# Profils maison par organisation — Tranche 2 (écrans) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les profils maison utilisables depuis l'app : bouton (+) et colonne par profil dans Droits d'accès, choix du profil dans Gestion de l'équipe et dans l'invitation, et `can()` qui applique la surcharge du profil porté par l'utilisateur connecté.

**Architecture:** Un module PUR `src/lib/orgRoles.js` porte toute la logique de présentation (options des menus, colonnes de la grille, libellé d'un membre, décodage d'un choix). Un service + un hook (`orgRoles.service.js`, `useOrgRoles`) encapsulent les vues `majordhome_org_roles` / `majordhome_member_org_roles` et les 4 RPC de la tranche 1. `AuthContext` expose `orgRole` (profil maison de l'utilisateur, ou `null`) ; `effectiveRole` reste le rôle standard et aucun des 16 fichiers qui le testent n'est touché. Les écrans existants gagnent une colonne / des options, sans refonte.

**Tech Stack:** React 18, TanStack Query v5, Supabase JS (vues + RPC), Tailwind, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-06-profils-maison-par-org-design.md` (§ 4.1 chaîne front, § 5 écrans, § 6 désactivation) — tranche 1 (base) livrée en prod le 2026-10-06 (`20261006_1`, `20261006_2`).

## Global Constraints

- `effectiveRole` (AuthContext, `computeEffectiveRole`) = rôle STANDARD, inchangé. Le profil maison est une donnée à côté : `orgRole = { id, code, label, baseRole } | null`.
- Cache keys : `orgRoleKeys.all(orgId)` en 1ᵉʳ paramètre (convention P0.11), dans `cacheKeys.js`.
- Mutations : `mutationFn` déballe via `unwrapResult(...)` ; côté appelant try/catch + toast, jamais de lecture de `{ error }`.
- Aucune logique métier dans le JSX : décodage des choix et construction des options dans `src/lib/orgRoles.js` (pur, testé).
- Vocabulaire écran : « Profil » (mot d'Eric) ; en code `orgRole`.
- Pas de composant > 500 LOC ; `TeamManagement.jsx` (≈1 000 LOC, dette connue) ne reçoit que le strict nécessaire — sa décomposition reste signalée, pas embarquée.
- Fichiers existants : conserver leurs fins de ligne (CRLF) — édition par script, pas par heredoc.
- Vérification : `npm run audit:quality` vert + `npx vite build` ; pas de preview tools (Eric a son serveur).

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/orgRoles.js` (créer) | PUR : `roleChoiceValue`, `parseRoleChoice`, `buildRoleOptions`, `memberRoleDisplay`, `permissionColumns`, `BASE_ROLE_HINTS` |
| `scripts/org-roles.test.mjs` (créer) + `package.json` | tests du module pur, ajoutés à `audit:quality` |
| `src/shared/hooks/cacheKeys.js` (modifier) | `orgRoleKeys` |
| `src/shared/services/orgRoles.service.js` (créer) | lectures (2 vues) + 4 RPC |
| `src/shared/hooks/useOrgRoles.js` (créer) | `useOrgRoles(orgId)` : listes + 4 mutations |
| `src/shared/services/auth.service.js` (modifier) | `getMemberOrgRole(userId, orgId)` |
| `src/contexts/AuthContext.jsx` (modifier) | état `orgRole`, chargé avec le profil, exposé dans `value` |
| `src/lib/permissions.js` (modifier) | `hasPermission(map, role, resource, action, orgRoleCode)` / `getResourcePermissions(..., orgRoleCode)` |
| `src/shared/hooks/usePermissions.js` (modifier) | `useCanAccess` passe `orgRole?.code` |
| `src/apps/artisan/pages/Settings.jsx` (modifier) | « Votre rôle : Secrétaire (d'après Responsable) » |
| `src/apps/artisan/pages/settings/permissions/OrgRoleModal.jsx` (créer) | création (libellé + modèle) et renommage |
| `src/apps/artisan/pages/settings/PermissionsEditor.jsx` (modifier) | colonnes dynamiques, (+), menu d'en-tête, profils désactivés |
| `src/apps/artisan/pages/settings/TeamManagement.jsx` (modifier) | badge, menu « Changer le rôle », invitation |

---

### Task 1 : Module pur `src/lib/orgRoles.js`

**Files:**
- Create: `src/lib/orgRoles.js`
- Create: `scripts/org-roles.test.mjs`
- Modify: `package.json` (`audit:quality` : ajouter `scripts/org-roles.test.mjs` après `scripts/permissions-resolve.test.mjs`)

**Interfaces (Produces):**
```js
export const ORG_ROLE_PREFIX = 'org:';
export const BASE_ROLES = ['team_leader', 'commercial', 'technicien'];
export const BASE_ROLE_HINTS = { team_leader: '…', commercial: '…', technicien: '…' };
export function roleChoiceValue(orgRole)                    // { id } -> 'org:<id>'
export function parseRoleChoice(value)                      // 'team_leader' -> { kind:'standard', role } | 'org:x' -> { kind:'org', orgRoleId:'x' } | autre -> null
export function buildRoleOptions(standardRoles, labels, orgRoles) // [{ value, label }] : standards puis profils ACTIFS (label + « (d'après X) »)
export function memberRoleDisplay(effectiveRole, orgRole, labels) // { label, sub } : sub = « d'après Responsable » si orgRole
export function permissionColumns(editableRoles, labels, orgRoles) // [{ key, role, code, label, sub, orgRole }] standards puis profils ACTIFS
```

- [x] **Step 1 : Écrire le test** `scripts/org-roles.test.mjs`

```js
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
```

- [x] **Step 2 : Lancer, vérifier l'échec** — `node --test scripts/org-roles.test.mjs` → FAIL (module absent).

- [x] **Step 3 : Écrire le module** `src/lib/orgRoles.js`

```js
// src/lib/orgRoles.js
// ============================================================================
// Profils « maison » — logique de PRÉSENTATION (module pur, aucun import).
// Un profil maison = libellé propre à l'org + modèle standard (base_role).
// Partout où le code teste un rôle, c'est le modèle qui est vu ; la grille Droits
// d'accès est la seule à distinguer le profil (spec 2026-10-06 § 2).
// Testé : node --test scripts/org-roles.test.mjs
// ============================================================================

export const ORG_ROLE_PREFIX = 'org:';
export const BASE_ROLES = ['team_leader', 'commercial', 'technicien'];

/** Ce que le modèle emporte HORS grille (gestes testés en dur dans le code). */
export const BASE_ROLE_HINTS = {
  team_leader: 'Hérite de tout ce que le code réserve aux responsables hors grille : avoirs, import Pennylane, envoi de factures, réglages d’équipe.',
  commercial: 'Vu comme un commercial par le planning (RDV commerciaux) et le pipeline ; aucun geste réservé aux responsables.',
  technicien: 'Vu comme un technicien par le planning (tournées, RDV techniques) ; profil le plus restreint hors grille.',
};

const apostrophe = '’';
const dApres = (labels, baseRole) => `d${apostrophe}après ${labels[baseRole] || baseRole}`;

export function roleChoiceValue(orgRole) {
  return `${ORG_ROLE_PREFIX}${orgRole.id}`;
}

export function parseRoleChoice(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith(ORG_ROLE_PREFIX)) {
    const orgRoleId = value.slice(ORG_ROLE_PREFIX.length);
    return orgRoleId ? { kind: 'org', orgRoleId } : null;
  }
  if (['org_admin', 'team_leader', 'commercial', 'technicien'].includes(value)) {
    return { kind: 'standard', role: value };
  }
  return null;
}

const actifs = (orgRoles) => (orgRoles || []).filter((r) => r.is_active !== false);

export function buildRoleOptions(standardRoles, labels, orgRoles) {
  return [
    ...standardRoles.map((role) => ({ value: role, label: labels[role] || role })),
    ...actifs(orgRoles).map((r) => ({ value: roleChoiceValue(r), label: `${r.label} (${dApres(labels, r.base_role)})` })),
  ];
}

export function memberRoleDisplay(effectiveRole, orgRole, labels) {
  if (orgRole) return { label: orgRole.label, sub: dApres(labels, orgRole.base_role) };
  return { label: labels[effectiveRole] || effectiveRole, sub: null };
}

export function permissionColumns(editableRoles, labels, orgRoles) {
  return [
    ...editableRoles.map((role) => ({ key: role, role, code: null, label: labels[role] || role, sub: null, orgRole: null })),
    ...actifs(orgRoles).map((r) => ({
      key: r.code, role: r.base_role, code: r.code, label: r.label, sub: dApres(labels, r.base_role), orgRole: r,
    })),
  ];
}
```

- [x] **Step 4 : Tests verts + `audit:quality`** — `node --test scripts/org-roles.test.mjs` → 5 pass ; ajouter au script `audit:quality` ; `npm run audit:quality` vert.

- [x] **Step 5 : Commit**
```bash
git add src/lib/orgRoles.js scripts/org-roles.test.mjs package.json
git commit -m "feat(droits): module pur orgRoles (options de menus, colonnes de grille, libellés)"
```

---

### Task 2 : Service, clés de cache, hook

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` (après `permissionKeys`)
- Create: `src/shared/services/orgRoles.service.js`
- Create: `src/shared/hooks/useOrgRoles.js`

**Interfaces (Produces):**
```js
// cacheKeys.js
export const orgRoleKeys = {
  all: (orgId) => ['orgRoles', orgId],
  list: (orgId) => [...orgRoleKeys.all(orgId), 'list'],
  members: (orgId) => [...orgRoleKeys.all(orgId), 'members'],
};
// orgRoles.service.js — tous retournent { data, error }
orgRolesService.listOrgRoles(orgId)                    // vue majordhome_org_roles, actifs ET inactifs, order label
orgRolesService.listMemberOrgRoles(orgId)              // vue majordhome_member_org_roles (user_id, org_role_id, code, label, base_role, is_active)
orgRolesService.createOrgRole({ orgId, label, baseRole })       // rpc org_role_create → ligne
orgRolesService.updateOrgRole({ orgRoleId, label, isActive })   // rpc org_role_update → ligne
orgRolesService.deleteOrgRole(orgRoleId)               // rpc org_role_delete → { members_reset, overrides_deleted }
orgRolesService.setMemberOrgRole({ orgId, userId, orgRoleId })  // rpc member_set_org_role → code | null
// useOrgRoles(orgId) → { orgRoles, activeOrgRoles, memberOrgRoleByUser (Map user_id → row), isLoading, error,
//                        createOrgRole, updateOrgRole, deleteOrgRole, setMemberOrgRole, isMutating }
```

- [x] **Step 1 : Clés** — dans `cacheKeys.js`, après le bloc `permissionKeys` :
```js
// Profils maison (org_roles / member_org_roles) — 20261006_1
export const orgRoleKeys = {
  all: (orgId) => ['orgRoles', orgId],
  list: (orgId) => [...orgRoleKeys.all(orgId), 'list'],
  members: (orgId) => [...orgRoleKeys.all(orgId), 'members'],
};
```

- [x] **Step 2 : Service** `src/shared/services/orgRoles.service.js`
```js
/**
 * orgRoles.service.js — profils « maison » d'une organisation
 * Lecture : vues majordhome_org_roles / majordhome_member_org_roles (security_invoker).
 * Écriture : RPC SECURITY DEFINER org_admin (20261006_2) — jamais d'écriture directe.
 */
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

export const orgRolesService = {
  async listOrgRoles(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_org_roles')
        .select('id, org_id, code, label, base_role, is_active, created_at, updated_at')
        .eq('org_id', orgId)
        .order('label');
      if (error) throw error;
      return data || [];
    }, 'orgRoles.listOrgRoles');
  },

  async listMemberOrgRoles(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_member_org_roles')
        .select('org_id, user_id, org_role_id, code, label, base_role, is_active')
        .eq('org_id', orgId);
      if (error) throw error;
      return data || [];
    }, 'orgRoles.listMemberOrgRoles');
  },

  async createOrgRole({ orgId, label, baseRole }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_role_create', { p_org_id: orgId, p_label: label, p_base_role: baseRole });
      if (error) throw error;
      return data;
    }, 'orgRoles.createOrgRole');
  },

  async updateOrgRole({ orgRoleId, label = null, isActive = null }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_role_update', { p_org_role_id: orgRoleId, p_label: label, p_is_active: isActive });
      if (error) throw error;
      return data;
    }, 'orgRoles.updateOrgRole');
  },

  async deleteOrgRole(orgRoleId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_role_delete', { p_org_role_id: orgRoleId });
      if (error) throw error;
      return data;
    }, 'orgRoles.deleteOrgRole');
  },

  /** orgRoleId null = retour à un rôle standard (l'appelant pose ensuite le standard via updateMemberRole). */
  async setMemberOrgRole({ orgId, userId, orgRoleId }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('member_set_org_role', { p_org_id: orgId, p_user_id: userId, p_org_role_id: orgRoleId });
      if (error) throw error;
      return data;
    }, 'orgRoles.setMemberOrgRole');
  },
};

export default orgRolesService;
```

- [x] **Step 3 : Hook** `src/shared/hooks/useOrgRoles.js`
```js
/**
 * useOrgRoles — profils « maison » d'une org (listes + mutations).
 * Contrat mutations : unwrapResult → mutateAsync résout avec data, rejette sur { error }.
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orgRolesService } from '@services/orgRoles.service';
import { unwrapResult } from '@/lib/serviceHelpers';
import { orgRoleKeys, permissionKeys, appointmentKeys } from '@hooks/cacheKeys';

export function useOrgRoles(orgId) {
  const queryClient = useQueryClient();

  const rolesQuery = useQuery({
    queryKey: orgRoleKeys.list(orgId),
    queryFn: () => orgRolesService.listOrgRoles(orgId),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    select: (r) => r?.data || [],
  });
  const membersQuery = useQuery({
    queryKey: orgRoleKeys.members(orgId),
    queryFn: () => orgRolesService.listMemberOrgRoles(orgId),
    enabled: !!orgId,
    staleTime: 60_000,
    select: (r) => r?.data || [],
  });

  const orgRoles = rolesQuery.data || [];
  const activeOrgRoles = useMemo(() => orgRoles.filter((r) => r.is_active), [orgRoles]);
  const memberOrgRoleByUser = useMemo(() => {
    const map = new Map();
    (membersQuery.data || []).forEach((m) => map.set(m.user_id, m));
    return map;
  }, [membersQuery.data]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: orgRoleKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: permissionKeys.all(orgId) }); // grille + membres (champs core réalignés)
    queryClient.invalidateQueries({ queryKey: appointmentKeys.teamMembers(orgId) }); // rôle planning resynchronisé
  };

  const createMutation = useMutation({
    mutationFn: ({ label, baseRole }) => unwrapResult(orgRolesService.createOrgRole({ orgId, label, baseRole })),
    onSuccess: invalidateAll,
  });
  const updateMutation = useMutation({
    mutationFn: ({ orgRoleId, label, isActive }) => unwrapResult(orgRolesService.updateOrgRole({ orgRoleId, label, isActive })),
    onSuccess: invalidateAll,
  });
  const deleteMutation = useMutation({
    mutationFn: (orgRoleId) => unwrapResult(orgRolesService.deleteOrgRole(orgRoleId)),
    onSuccess: invalidateAll,
  });
  const setMemberMutation = useMutation({
    mutationFn: ({ userId, orgRoleId }) => unwrapResult(orgRolesService.setMemberOrgRole({ orgId, userId, orgRoleId })),
    onSuccess: invalidateAll,
  });

  return {
    orgRoles,
    activeOrgRoles,
    memberOrgRoleByUser,
    isLoading: rolesQuery.isLoading || membersQuery.isLoading,
    error: rolesQuery.error || membersQuery.error,
    createOrgRole: createMutation.mutateAsync,
    updateOrgRole: updateMutation.mutateAsync,
    deleteOrgRole: deleteMutation.mutateAsync,
    setMemberOrgRole: setMemberMutation.mutateAsync,
    isMutating: createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || setMemberMutation.isPending,
  };
}

export default useOrgRoles;
```

- [x] **Step 4 : Lint** — `npx eslint src/shared/services/orgRoles.service.js src/shared/hooks/useOrgRoles.js src/shared/hooks/cacheKeys.js --max-warnings 0`. (Le hook sera consommé en Task 4/5 — même série de commits, pas de code mort à l'arrivée.)

- [x] **Step 5 : Commit**
```bash
git add src/shared/hooks/cacheKeys.js src/shared/services/orgRoles.service.js src/shared/hooks/useOrgRoles.js
git commit -m "feat(droits): service et hook des profils maison (vues + RPC 20261006_2)"
```

---

### Task 3 : `orgRole` dans AuthContext, `can()` applique la surcharge du profil

**Files:**
- Modify: `src/shared/services/auth.service.js` (nouvelle méthode après `getUserOrganization`)
- Modify: `src/contexts/AuthContext.jsx` (état + chargement + `value`)
- Modify: `src/lib/permissions.js:137-162` (`hasPermission`, `getResourcePermissions`)
- Modify: `src/shared/hooks/usePermissions.js:63-74` (`useCanAccess`)
- Modify: `src/apps/artisan/pages/Settings.jsx:36,66`

**Interfaces (Produces):**
- `authService.getMemberOrgRole(userId, orgId) → { orgRole: { id, code, label, baseRole } | null, error }` (profil ACTIF seulement, `maybeSingle`)
- `useAuth().orgRole` : `{ id, code, label, baseRole } | null`
- `hasPermission(permissionMap, role, resource, action, orgRoleCode = null)` ; `getResourcePermissions(permissionMap, role, resource, orgRoleCode = null)`

- [x] **Step 1 : auth.service** — après `getUserOrganization` :
```js
  /**
   * Profil « maison » ACTIF porté par l'utilisateur dans l'org (20261006_1), sinon null.
   * Vue security_invoker : RLS membre de l'org. Lecture seule.
   */
  async getMemberOrgRole(userId, orgId) {
    try {
      const { data, error } = await supabase
        .from('majordhome_member_org_roles')
        .select('org_role_id, code, label, base_role, is_active')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.is_active === false) return { orgRole: null, error: null };
      return { orgRole: { id: data.org_role_id, code: data.code, label: data.label, baseRole: data.base_role }, error: null };
    } catch (error) {
      console.error('[authService] getMemberOrgRole error:', error);
      return { orgRole: null, error };
    }
  },
```

- [x] **Step 2 : AuthContext** — `const [orgRole, setOrgRole] = useState(null);` après `membership` ; dans `loadUserData`, juste après `if (userMembership) setMembership(userMembership);` :
```js
      // Profil maison (20261006_1) : chargé APRÈS l'org, null si aucun / inactif / erreur.
      // En cas d'erreur l'écran retombe sur le modèle (plus large) — la base, elle,
      // applique toujours le profil via role_can : un geste non permis échouera bruyamment.
      if (userOrg?.id) {
        const roleResult = await authService.getMemberOrgRole(userId, userOrg.id);
        setOrgRole(roleResult.orgRole);
      } else {
        setOrgRole(null);
      }
```
Dans le `signOut` / reset d'état (là où `setMembership(null)` est appelé), ajouter `setOrgRole(null);`. Dans `value` : `effectiveRole, orgRole,`.

- [x] **Step 3 : permissions.js**
```js
export function hasPermission(permissionMap, role, resource, action, orgRoleCode = null) {
  // Délègue au registre : org_admin bypass, puis surcharge du profil maison (orgRoleCode),
  // puis surcharge per-org du rôle standard, puis défaut app-level.
  return resolvePermission(permissionMap, role, resource, action, orgRoleCode);
}

export function getResourcePermissions(permissionMap, role, resource, orgRoleCode = null) {
  const result = {};
  for (const a of ACTIONS) {
    result[a.key] = resolvePermission(permissionMap, role, resource, a.key, orgRoleCode);
  }
  return result;
}
```

- [x] **Step 4 : useCanAccess**
```js
  const { effectiveRole, orgRole, organization, user } = useAuth();
  …
  const can = useCallback(
    (resource, action) => {
      if (isLoading) return effectiveRole === 'org_admin';
      return hasPermission(permissionMap, effectiveRole, resource, action, orgRole?.code || null);
    },
    [permissionMap, effectiveRole, orgRole?.code, isLoading]
  );
```
et retourner `orgRole` à côté d'`effectiveRole`.

- [x] **Step 5 : Settings.jsx** — `const { organization, effectiveRole, orgRole, isOrgAdmin } = useAuth();` et
```jsx
Votre rôle : {orgRole ? `${orgRole.label} (d’après ${ROLE_LABELS[orgRole.baseRole] || orgRole.baseRole})` : (ROLE_LABELS[effectiveRole] || effectiveRole)}
```

- [x] **Step 6 : Lint + build** — `npx eslint <fichiers> --max-warnings 0 && npx vite build`.

- [x] **Step 7 : Commit**
```bash
git add src/shared/services/auth.service.js src/contexts/AuthContext.jsx src/lib/permissions.js src/shared/hooks/usePermissions.js src/apps/artisan/pages/Settings.jsx
git commit -m "feat(droits): useAuth().orgRole et can() appliquent la surcharge du profil maison"
```

---

### Task 4 : Droits d'accès — colonnes par profil, (+), menu d'en-tête, profils désactivés

**Files:**
- Create: `src/apps/artisan/pages/settings/permissions/OrgRoleModal.jsx`
- Modify: `src/apps/artisan/pages/settings/PermissionsEditor.jsx`

**Interfaces:**
- Consumes : `useOrgRoles(orgId)` (Task 2), `permissionColumns`, `BASE_ROLES`, `BASE_ROLE_HINTS` (Task 1), `resolvePermission` (tranche 1).
- Produces : `OrgRoleModal({ open, onClose, onSubmit, initial, isSaving })` — `initial` null = création (libellé + modèle), sinon renommage (libellé seul, modèle affiché non modifiable) ; `onSubmit({ label, baseRole })`.

- [x] **Step 1 : OrgRoleModal**
```jsx
/**
 * OrgRoleModal — créer ou renommer un profil « maison ».
 * Création : libellé + modèle (le modèle est immuable ensuite, spec § 7).
 * Renommage : libellé seul.
 */
import { useEffect, useState } from 'react';
import { X, Loader2, UserCog } from 'lucide-react';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { ROLE_LABELS } from '@lib/permissions';
import { BASE_ROLES, BASE_ROLE_HINTS } from '@/lib/orgRoles';

export function OrgRoleModal({ open, onClose, onSubmit, initial = null, isSaving = false }) {
  const [label, setLabel] = useState('');
  const [baseRole, setBaseRole] = useState('team_leader');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label || '');
    setBaseRole(initial?.base_role || 'team_leader');
    setError(null);
  }, [open, initial]);

  if (!open) return null;
  const isEdit = !!initial;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!label.trim()) { setError('Le nom du profil est requis'); return; }
    await onSubmit({ label: label.trim(), baseRole });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2">
            <UserCog className="w-5 h-5 text-primary-600" />
            {isEdit ? 'Renommer le profil' : 'Nouveau profil'}
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary-100 transition-colors">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Nom du profil" required error={error}>
            <TextInput value={label} onChange={(v) => { setLabel(v); setError(null); }} placeholder="Ex : Secrétaire" disabled={isSaving} />
          </FormField>

          <FormField label="Modèle de départ">
            {isEdit ? (
              <p className="text-sm text-secondary-700">
                {ROLE_LABELS[initial.base_role] || initial.base_role}
                <span className="block text-xs text-secondary-400">Le modèle ne se change pas : pour en changer, créez un autre profil.</span>
              </p>
            ) : (
              <div className="space-y-2">
                {BASE_ROLES.map((role) => (
                  <label key={role} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${baseRole === role ? 'border-primary-500 bg-primary-50' : 'border-secondary-200 hover:border-secondary-300'}`}>
                    <input type="radio" name="baseRole" value={role} checked={baseRole === role} onChange={() => setBaseRole(role)} disabled={isSaving} className="mt-1" />
                    <span>
                      <span className="block text-sm font-medium text-secondary-900">{ROLE_LABELS[role]}</span>
                      <span className="block text-xs text-secondary-500">{BASE_ROLE_HINTS[role]}</span>
                    </span>
                  </label>
                ))}
                <p className="text-xs text-secondary-500">
                  Le profil démarre avec les droits de son modèle ; vous ajustez ensuite ses cases dans la grille.
                  Hors de la grille, l’application le traite comme son modèle.
                </p>
              </div>
            )}
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors">
              Annuler
            </button>
            <button type="submit" disabled={isSaving} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'Renommer' : 'Créer le profil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OrgRoleModal;
```

- [x] **Step 2 : PermissionsEditor** — modifications :
  1. Imports : `useState`, `useOrgRoles`, `permissionColumns`, `resolvePermission` (depuis `@lib/permissionsRegistry`), `OrgRoleModal`, `ConfirmDialog`, icônes `Plus`, `MoreHorizontal`, `Pencil`, `EyeOff`, `Eye`, `Trash2`.
  2. État : `const { orgRoles, activeOrgRoles, memberOrgRoleByUser, createOrgRole, updateOrgRole, deleteOrgRole, isMutating } = useOrgRoles(orgId);` + `const [modal, setModal] = useState(null); // null | { mode:'create' } | { mode:'rename', orgRole }` + `const [menuFor, setMenuFor] = useState(null)` + `const [deleteFor, setDeleteFor] = useState(null)`.
  3. `const columns = permissionColumns(EDITABLE_ROLES, ROLE_LABELS, activeOrgRoles);` et `const inactiveOrgRoles = orgRoles.filter((r) => !r.is_active);`
  4. `handleToggle(roleKey, resource, action, currentValue)` : inchangé dans sa logique (la clé `roleKey` est le code maison ou le rôle standard ; `org_upsert_role_permission` accepte les deux).
  5. En-tête : `columns.map((col) => <th key={col.key}>…{col.label}{col.sub && <span className="block text-xs font-normal text-secondary-400">{col.sub}</span>}{col.orgRole && <menu …>}</th>)` + un dernier `<th>` avec le bouton `(+) Ajouter un profil` (`setModal({ mode: 'create' })`).
  6. Cellule : `const allowed = resolvePermission(permissionMap, col.role, resourceKey, actionKey, col.code); const isOverride = overrideSet.has(`${col.key}:${resourceKey}:${actionKey}`);` → bouton `onClick={() => handleToggle(col.key, resourceKey, actionKey, allowed)}`, `title` = `${col.label} : …${isOverride ? ' (surcharge)' : col.code ? ' (hérité du modèle)' : ' (défaut app)'}`.
  7. Menu d'en-tête d'un profil (bouton `MoreHorizontal`, petit panneau absolu) : « Renommer » → `setModal({ mode: 'rename', orgRole })` ; « Désactiver » → `updateOrgRole({ orgRoleId, isActive: false })` + toast ; « Supprimer » → `setDeleteFor(orgRole)`.
  8. Sous la grille, si `inactiveOrgRoles.length` : bloc « Profils désactivés » avec, par profil, son libellé + bouton « Réactiver » (`updateOrgRole({ orgRoleId, isActive: true })`) + bouton corbeille (`setDeleteFor`).
  9. `ConfirmDialog` destructive pour `deleteFor` : description = `« ${label} » sera supprimé. ${n} membre(s) le portent : ils reprendront les droits du modèle (${ROLE_LABELS[base]}). Les cases réglées pour ce profil seront perdues.` où `n = [...memberOrgRoleByUser.values()].filter((m) => m.org_role_id === deleteFor.id).length` ; `onConfirm` → `deleteOrgRole(deleteFor.id)` → `toast.success(`Profil supprimé (${res.members_reset} membre(s) remis sur le modèle)`)`.
  10. `OrgRoleModal` monté avec `onSubmit` : création → `createOrgRole({ label, baseRole })` + `toast.success('Profil créé — réglez ses cases dans la colonne')` ; renommage → `updateOrgRole({ orgRoleId, label })`. Tous en try/catch + `toast.error` (message : `err?.code === '42501' ? 'Réservé à l’administrateur' : 'Erreur lors de l’enregistrement du profil'`).
  11. Bloc « Comment fonctionnent les permissions » : ajouter `<li><strong>Profil maison</strong> — colonne ajoutée par (+) : démarre avec les droits de son modèle, chaque case peut en diverger (anneau ambre). Hors de cette grille, l’application le traite comme son modèle.</li>`.

- [x] **Step 3 : Lint + build**, puis **Commit**
```bash
git add src/apps/artisan/pages/settings/permissions/OrgRoleModal.jsx src/apps/artisan/pages/settings/PermissionsEditor.jsx
git commit -m "feat(droits): Droits d'accès — colonne par profil maison, bouton (+), renommer / désactiver / supprimer"
```

---

### Task 5 : Gestion de l'équipe — badge, menu « Changer le rôle », invitation

**Files:**
- Modify: `src/apps/artisan/pages/settings/TeamManagement.jsx` (`ROLE_OPTIONS`, `InviteModal`, `MemberRow`, page)

**Interfaces:**
- Consumes : `useOrgRoles(orgId)` (Task 2) ; `buildRoleOptions`, `parseRoleChoice`, `roleChoiceValue`, `memberRoleDisplay` (Task 1) ; `inviteMember` renvoie `data.user.id` (edge `create-user`).

- [x] **Step 1 : Page** — `const { activeOrgRoles, memberOrgRoleByUser, setMemberOrgRole } = useOrgRoles(orgId);` ; `const roleOptions = useMemo(() => buildRoleOptions(EFFECTIVE_ROLES, ROLE_LABELS, activeOrgRoles), [activeOrgRoles]);` ; supprimer la constante module `ROLE_OPTIONS` (remplacée) et passer `roleOptions` à `InviteModal` et `MemberRow`.

- [x] **Step 2 : MemberRow** — props `orgRole` (ligne de `memberOrgRoleByUser` ou null) et `roleOptions` :
  - badge : `const display = memberRoleDisplay(effectiveRole, orgRole, ROLE_LABELS);` → `{display.label}` + `{display.sub && <span className="block text-[10px] font-normal text-secondary-400">{display.sub}</span>}` (badge coloré par `effectiveRole`, le modèle).
  - select : `value={orgRole ? roleChoiceValue({ id: orgRole.org_role_id }) : effectiveRole}` ; options = `roleOptions` ; `onChange={(e) => onRoleChangeRequest(member, currentValue, e.target.value)}`.

- [x] **Step 3 : Confirmation de changement** — `handleRoleChangeConfirm` :
```js
    const { member, newRole } = roleChangeConfirm;
    const choice = parseRoleChoice(newRole);
    if (!choice) return;
    setUpdatingUserId(member.user_id);
    try {
      if (choice.kind === 'org') {
        const code = await setMemberOrgRole({ userId: member.user_id, orgRoleId: choice.orgRoleId });
        const r = activeOrgRoles.find((x) => x.id === choice.orgRoleId);
        toast.success(`${member.profile?.full_name || "L'utilisateur"} est maintenant ${r?.label || code}`);
      } else {
        const mapping = ROLE_DB_MAPPING[choice.role];
        if (!mapping) return;
        if (memberOrgRoleByUser.has(member.user_id)) {
          await setMemberOrgRole({ userId: member.user_id, orgRoleId: null }); // quitte le profil maison
        }
        const result = await updateRole({ userId: member.user_id, appRole: mapping.app_role, businessRole: mapping.business_role, membershipRole: mapping.membership_role });
        if (result?.error) { toast.error(result.error.message || 'Erreur lors du changement de rôle'); }
        else toast.success(`Rôle de ${member.profile?.full_name || "l'utilisateur"} changé en ${ROLE_LABELS[choice.role]}`);
      }
    } catch (err) {
      toast.error(err?.code === '42501' ? 'Réservé à l’administrateur' : (err.message || 'Erreur inattendue'));
    } finally { setUpdatingUserId(null); setRoleChangeConfirm(null); }
```
  Texte du `ConfirmDialog` : utiliser le libellé de l'option choisie (`roleOptions.find((o) => o.value === newRole)?.label`) au lieu de `ROLE_LABELS[newRole]`.

- [x] **Step 4 : InviteModal** — `options={roleOptions}` ; `handleInvite(form)` dans la page :
```js
  const handleInvite = async (form) => {
    const choice = parseRoleChoice(form.effectiveRole);
    const orgRole = choice?.kind === 'org' ? activeOrgRoles.find((r) => r.id === choice.orgRoleId) : null;
    const effectiveRole = orgRole ? orgRole.base_role : (choice?.role || 'technicien');
    const result = await inviteMember({ email: form.email, password: form.password, fullName: form.fullName, effectiveRole });
    if (result?.error || !orgRole) return result;
    const userId = result?.data?.user?.id;
    if (!userId) return { error: new Error('Compte créé, mais profil non posé (identifiant manquant) — réglez-le dans la liste') };
    try { await setMemberOrgRole({ userId, orgRoleId: orgRole.id }); }
    catch (err) { return { error: new Error(`Compte créé, mais profil non posé : ${err.message || 'erreur'} — réglez-le dans la liste`) }; }
    return result;
  };
```

- [x] **Step 5 : Lint + build + `audit:quality`**, puis **Commit**
```bash
git add src/apps/artisan/pages/settings/TeamManagement.jsx
git commit -m "feat(equipe): profils maison dans le badge, le menu Changer le rôle et l'invitation"
```

---

### Task 6 : Vérification de bout en bout et proposition CLAUDE.md

- [x] **Step 1** : `npm run audit:quality && npx vite build` verts ; `git push`.
- [ ] **Step 2** : Eric, en prod après déploiement Vercel — Droits d'accès : (+) → « Secrétaire » d'après Responsable → colonne apparaît sans anneau ; décocher une case → anneau ambre ; Gestion de l'équipe : Mathis → « Secrétaire (d'après Responsable) » → badge + sous-ligne ; `SELECT * FROM majordhome.member_org_roles` = 1 ligne ; `node scripts/permissions-coherence.mjs --env .env.local` → `1 profil(s) maison`.
- [x] **Step 3** : entrée `.claude/proposed-updates.md` (PENDING) : compléter l'entrée tranche 1 par « UI livrée tranche 2 : `useAuth().orgRole`, `useOrgRoles`, module pur `src/lib/orgRoles.js` ; `effectiveRole` reste le modèle ».

---

## Auto-revue

**Couverture spec** — § 4.1 front : Task 3 (`can()` passe le code). § 4.2 `member_set_org_role` + `updateMemberRole` : Task 5 step 3 (retour au standard = `setMemberOrgRole(null)` PUIS `updateRole`). § 5.1 colonnes, (+), menu Renommer/Désactiver/Supprimer avec décompte : Task 4. § 5.2 badge, menu, invitation, case Commercial indépendante : Task 5. § 6 désactivé = hors menus/grille + réactivation : Task 4 (bloc « Profils désactivés ») + Task 1 (`actifs()`). § 10.2 liste des gestes du modèle à la création : `BASE_ROLE_HINTS`. § 10.3 « Réinitialiser au modèle » : non livré (aucune RPC de suppression de surcharge) — signalé en fin de tranche.

**Placeholders** — aucun ; Task 4 step 2 décrit des modifications sur un fichier existant point par point avec le code des parties nouvelles.

**Noms** — `useOrgRoles` → `{ orgRoles, activeOrgRoles, memberOrgRoleByUser, createOrgRole, updateOrgRole, deleteOrgRole, setMemberOrgRole, isMutating }` ; `permissionColumns` → `{ key, role, code, label, sub, orgRole }` ; `parseRoleChoice` → `{ kind, role | orgRoleId }` ; `useAuth().orgRole` → `{ id, code, label, baseRole }` (camelCase, construit par `getMemberOrgRole`) alors que les lignes de vue restent en snake_case (`base_role`, `org_role_id`).
