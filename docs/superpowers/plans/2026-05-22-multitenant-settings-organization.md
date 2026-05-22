# Settings → Organisation (multi-tenant) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire la page `/settings/organization` (3 onglets : Identité / Coordonnées / Territoire) qui permet à un `org_admin` de configurer 100% des champs `core.organizations.settings` nécessaires aux PDFs, emails et modules Territoire/GeoGrid, et neutraliser les fallbacks Mayer hardcodés dans les helpers de consommation.

**Architecture:** 1 page React avec sidebar gauche + 3 tabs composants distincts (hand-rolled, pas de schema-driver). Couche données partagée via `useOrgSettings` (React Query). Écriture côté DB via RPC SECURITY DEFINER `org_update_settings` qui vérifie le rôle `org_admin`. Helpers consommateurs (`orgBranding`, `mapbox`, `communesService`) refactorés pour fallback **neutre** au lieu de défauts Mayer.

**Tech Stack:** React 18 + Vite 5 + Tailwind, React Hook Form (forms simples avec validation inline), TanStack Query v5, Supabase JS, Mapbox GL JS, Radix UI primitives (déjà installé).

**Spec source :** `docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md`

**Vérification par tâche :** Pas de jest/vitest dans le repo. Les vérifications sont :
- `npm run lint:errors` (no new error)
- `npm run build` (passe)
- Smoke test manuel selon le critère d'acceptance correspondant
- Pre-commit hook lance `lint:errors` automatiquement

---

## File Structure

### Fichiers à CRÉER

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/<ts>_org_update_settings.sql` | RPC SECURITY DEFINER pour merge JSONB des settings (org_admin only) |
| `src/shared/services/orgSettings.service.js` | Lecture `core.organizations.settings` + appel RPC pour write |
| `src/shared/hooks/useOrgSettings.js` | Hook React Query : `{ settings, isLoading, save, isSaving }` |
| `src/lib/departments.js` | Liste statique 95 départements + DOM-TOM, helpers `getDepartmentByCode`, `getDepartmentLabel` |
| `src/apps/artisan/pages/settings/OrganizationSettings.jsx` | Page racine + sidebar gauche + routing entre 3 tabs (state local) |
| `src/apps/artisan/pages/settings/organization/IdentityTab.jsx` | Onglet Identité (9 champs branding/légal/RGE) + save |
| `src/apps/artisan/pages/settings/organization/ContactTab.jsx` | Onglet Coordonnées (7 champs adresse/contact/web) + save |
| `src/apps/artisan/pages/settings/organization/TerritoryTab.jsx` | Onglet Territoire (siège + Place ID + département + antennes) + save |
| `src/apps/artisan/pages/settings/organization/components/RgeCertificationsInput.jsx` | Chips input avec autocomplete pré-définie |
| `src/apps/artisan/pages/settings/organization/components/AddressSearch.jsx` | Autocomplete Mapbox Geocoding, debounce, retourne `{lat, lng, label, department_code}` |
| `src/apps/artisan/pages/settings/organization/components/DepartmentSelect.jsx` | Sélecteur 95 dépts + bouton "📍 Détecter depuis siège" |
| `src/apps/artisan/pages/settings/organization/components/CenterEditor.jsx` | Form siège ou antenne (label, address search, lat/lng manual, couleur, emoji) |

### Fichiers à MODIFIER

| Fichier | Modification |
|---|---|
| `src/shared/hooks/cacheKeys.js` | Ajouter `orgSettingsKeys` (P0.11 convention orgId-scoped) |
| `src/apps/artisan/routes.jsx` | Ajouter route `/settings/organization` (lazy load, `RouteGuard resource="settings"`) |
| `src/lib/orgBranding.js` | `MAYER_DEFAULTS` → `NEUTRAL_DEFAULTS`. `domain` calculé via `from_email.split('@')[1]`. `portalUrl` = constante app. |
| `src/lib/mapbox.js` | `getMapDefaultCenter()` : dérive du siège via `getOrgHeadquarters`, fallback centre France `[2.5, 46.5]` |
| `src/lib/territoire-config.js` | Ajouter helper `getCoverageDepartments(settings)` → `[settings.geogrid_target_department]` ou `[]` |
| `src/apps/artisan/components/geogrid/communesService.js` | `fetchCommunes` accepte `departmentCode` en paramètre (plus de hardcode "81") |
| `src/apps/artisan/components/geogrid/BenchmarkLauncher.jsx` | Passe `useAuth().organization.settings.geogrid_target_department` à `fetchCommunes` |

---

## Tasks

### Task 1 : RPC `org_update_settings` (DB)

**Files:**
- Create: `supabase/migrations/20260522_org_update_settings.sql`

- [ ] **Step 1 : Écrire la migration SQL**

```sql
-- supabase/migrations/20260522_org_update_settings.sql
-- RPC SECURITY DEFINER : merge JSONB des settings d'une org, réservée org_admin.

CREATE OR REPLACE FUNCTION public.org_update_settings(
  p_org_id uuid,
  p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_new_settings jsonb;
BEGIN
  -- 1. Membership check : user est bien membre de cette org
  SELECT role INTO v_role
  FROM core.organization_members
  WHERE user_id = v_user_id AND org_id = p_org_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Not a member of this org' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'org_admin' THEN
    RAISE EXCEPTION 'Only org_admin can edit settings (role=%)', v_role
      USING ERRCODE = '42501';
  END IF;

  -- 2. Shallow merge JSONB (|| opérateur 1er niveau seulement)
  --    Convention : l'UI envoie des patches plats au 1er niveau.
  --    Pour les sous-arbres (territoire_centers), l'UI envoie l'arbre entier.
  UPDATE core.organizations
  SET settings = COALESCE(settings, '{}'::jsonb) || p_patch,
      updated_at = NOW()
  WHERE id = p_org_id
  RETURNING settings INTO v_new_settings;

  RETURN v_new_settings;
END;
$$;

-- Sécurité : seuls les users authenticated peuvent appeler (anon bloqué).
-- La RPC elle-même vérifie ensuite le rôle org_admin via auth.uid().
REVOKE EXECUTE ON FUNCTION public.org_update_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_update_settings(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.org_update_settings IS
  'Merge JSONB shallow des settings d''une org. Réservée org_admin. Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §8.4';
```

- [ ] **Step 2 : Appliquer la migration sur prod via MCP Supabase**

Utiliser `mcp__08e883e6-2179-451d-9c85-f993466b02e1__apply_migration` avec :
- `name` : `org_update_settings`
- `query` : contenu du fichier `.sql` ci-dessus

- [ ] **Step 3 : Smoke test SQL (via MCP `execute_sql`)**

```sql
-- En tant que service_role (bypass des checks pour vérifier que la RPC existe et compile)
SELECT proname, prosecdef, proacl
FROM pg_proc
WHERE proname = 'org_update_settings';
-- Attendu : 1 ligne, prosecdef=true, proacl exclut anon
```

- [ ] **Step 4 : Test auth via le SQL Editor Supabase (impersonate un user)**

Pour confirmer que la RPC rejette un user non-admin. Exécuter en tant que team_leader/user :

```sql
SELECT public.org_update_settings(
  '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'::uuid,
  '{"_smoke_test": true}'::jsonb
);
-- Attendu : ERROR 42501 'Only org_admin can edit settings'
```

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/20260522_org_update_settings.sql
git commit -m "feat(db): add org_update_settings RPC (SECURITY DEFINER, org_admin only)"
```

---

### Task 2 : Service + Hook + Cache key

**Files:**
- Create: `src/shared/services/orgSettings.service.js`
- Create: `src/shared/hooks/useOrgSettings.js`
- Modify: `src/shared/hooks/cacheKeys.js`

- [ ] **Step 1 : Ajouter `orgSettingsKeys` dans `cacheKeys.js`**

Ajouter à la fin du fichier (après les autres exports) :

```javascript
// Settings de l'organisation — convention P0.11 (orgId scoped)
export const orgSettingsKeys = {
  all: (orgId) => ['orgSettings', orgId],
  byOrg: (orgId) => [...orgSettingsKeys.all(orgId)],
};
```

- [ ] **Step 2 : Créer le service `orgSettings.service.js`**

```javascript
// src/shared/services/orgSettings.service.js
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

/**
 * Service de lecture/écriture des settings d'une organisation.
 * Source : core.organizations.settings (JSONB).
 *
 * Lecture : SELECT direct (RLS scope user→org via security_invoker).
 * Écriture : RPC SECURITY DEFINER org_update_settings (check org_admin).
 *
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §8
 */
export const orgSettingsService = {
  /**
   * Charge les settings de l'org.
   * @param {string} orgId - core.organizations.id
   * @returns {Promise<{ data: object, error: Error|null }>}
   */
  async getSettings(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .schema('core')
        .from('organizations')
        .select('id, name, settings')
        .eq('id', orgId)
        .single();
      if (error) throw error;
      return data?.settings ?? {};
    }, 'orgSettings.getSettings');
  },

  /**
   * Met à jour les settings via la RPC (shallow merge JSONB).
   * Le patch est merge au 1er niveau ; pour territoire_centers (sous-arbre),
   * l'arbre entier est remplacé.
   * @param {string} orgId
   * @param {object} patch - sous-arbre JSONB à merger
   * @returns {Promise<{ data: object, error: Error|null }>}
   */
  async updateSettings(orgId, patch) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('org_update_settings', {
        p_org_id: orgId,
        p_patch: patch,
      });
      if (error) throw error;
      return data;
    }, 'orgSettings.updateSettings');
  },
};
```

- [ ] **Step 3 : Créer le hook `useOrgSettings.js`**

```javascript
// src/shared/hooks/useOrgSettings.js
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { orgSettingsService } from '@services/orgSettings.service';
import { orgSettingsKeys } from './cacheKeys';

/**
 * Hook React Query pour les settings de l'org courante.
 * - settings : objet (vide {} si rien configuré)
 * - save(patch) : merge le patch côté DB, retourne le nouveau settings
 * - isDirty est calculé localement par chaque consumer (form values vs initial)
 */
export function useOrgSettings() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: orgSettingsKeys.byOrg(orgId),
    queryFn: async () => {
      const { data, error } = await orgSettingsService.getSettings(orgId);
      if (error) throw error;
      return data ?? {};
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (patch) => {
      const { data, error } = await orgSettingsService.updateSettings(orgId, patch);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgSettingsKeys.byOrg(orgId) });
      // Le organization du AuthContext porte les settings — invalider aussi
      qc.invalidateQueries({ queryKey: ['auth', 'organization'] });
    },
  });

  return {
    settings: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
```

- [ ] **Step 4 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

Expected : pas de nouvelle erreur.

- [ ] **Step 5 : Commit**

```bash
git add src/shared/services/orgSettings.service.js \
        src/shared/hooks/useOrgSettings.js \
        src/shared/hooks/cacheKeys.js
git commit -m "feat(settings): add orgSettings service + useOrgSettings hook"
```

---

### Task 3 : Refacto `orgBranding.js` (MAYER → NEUTRAL)

**Files:**
- Modify: `src/lib/orgBranding.js`

- [ ] **Step 1 : Remplacer MAYER_DEFAULTS par NEUTRAL_DEFAULTS**

Réécriture complète de `src/lib/orgBranding.js` :

```javascript
/**
 * orgBranding.js — Helper multi-tenant pour le branding entreprise
 *
 * Construit l'objet `companyInfo` consommé par les PDFs et les composants email.
 *
 * Source : core.organizations.settings (chargé via useAuth().organization).
 * Fallback : valeurs **neutres** (pas Mayer) — les orgs sans settings voient
 * "Votre entreprise" / champs vides / couleur neutre, pas Mayer Énergie.
 *
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §9.1
 */

// portal_url est une constante app (singleton) tant qu'on n'a pas de sous-domaines par org.
const APP_PORTAL_URL = 'https://majordhome.vercel.app';

const NEUTRAL_DEFAULTS = {
  name: 'Votre entreprise',
  legalName: '',
  legalForm: '',
  capital: '',
  rcs: '',
  siret: '',
  tvaIntra: '',
  address: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  domain: '',                          // calculé via from_email.split('@')[1]
  websiteUrl: '',
  portalUrl: APP_PORTAL_URL,           // constante app
  unsubscribeLandingUrl: '',
  insurance: '',
  logoUrl: '',                         // pas de logo placeholder = pas d'<img>
  accentColor: '#64748b',              // slate-500 (neutre)
  rgeCertifications: [],
};

/**
 * Construit l'objet companyInfo depuis les settings de l'organisation.
 * Tout champ manquant retombe sur NEUTRAL_DEFAULTS (pas Mayer).
 *
 * @param {Object|null} settings - core.organizations.settings JSONB
 * @returns {Object} companyInfo prêt pour PDFs/emails
 */
export function buildCompanyInfo(settings) {
  const s = settings || {};
  const fromEmail = s.from_email || NEUTRAL_DEFAULTS.email;
  return {
    name: s.brand_name || NEUTRAL_DEFAULTS.name,
    legalName: s.legal_name || s.brand_name || NEUTRAL_DEFAULTS.legalName,
    legalForm: s.legal_form || NEUTRAL_DEFAULTS.legalForm,
    capital: s.capital || NEUTRAL_DEFAULTS.capital,
    rcs: s.rcs || NEUTRAL_DEFAULTS.rcs,
    siret: s.siret || NEUTRAL_DEFAULTS.siret,
    tvaIntra: s.tva_intra || NEUTRAL_DEFAULTS.tvaIntra,
    address: s.address || NEUTRAL_DEFAULTS.address,
    postalCode: s.postal_code || NEUTRAL_DEFAULTS.postalCode,
    city: s.city || NEUTRAL_DEFAULTS.city,
    phone: s.phone || NEUTRAL_DEFAULTS.phone,
    email: fromEmail,
    domain: fromEmail ? fromEmail.split('@')[1] || NEUTRAL_DEFAULTS.domain : NEUTRAL_DEFAULTS.domain,
    websiteUrl: s.website_url || NEUTRAL_DEFAULTS.websiteUrl,
    portalUrl: APP_PORTAL_URL,         // constante, jamais lu depuis settings
    unsubscribeLandingUrl: s.unsubscribe_landing_url || NEUTRAL_DEFAULTS.unsubscribeLandingUrl,
    insurance: s.insurance || NEUTRAL_DEFAULTS.insurance,
    logoUrl: s.logo_url || NEUTRAL_DEFAULTS.logoUrl,
    accentColor: s.accent_color || NEUTRAL_DEFAULTS.accentColor,
    rgeCertifications: Array.isArray(s.rge_certifications) ? s.rge_certifications : NEUTRAL_DEFAULTS.rgeCertifications,
  };
}

/** Adresse complète "rue – CP ville" pour les en-têtes / footers PDF */
export function formatFullAddress(company) {
  const parts = [];
  if (company.address) parts.push(company.address);
  if (company.postalCode || company.city) {
    parts.push(`${company.postalCode || ''} ${company.city || ''}`.trim());
  }
  return parts.join(' – ');
}

/** Mention légale standard pour les footers PDF */
export function buildLegalFooter(company) {
  const parts = [];
  if (company.legalName) parts.push(company.legalName);
  if (company.legalForm) parts.push(company.legalForm);
  if (company.capital) parts.push(`capital ${company.capital} €`);
  if (company.rcs) parts.push(company.rcs);
  const address = formatFullAddress(company);
  if (address) parts.push(address);
  if (company.email) parts.push(company.email);
  return parts.join(' — ');
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Smoke test manuel sur Mayer**

Ouvrir l'app en tant que Mayer admin, naviguer vers un client avec contrat → générer PDF Contrat → vérifier que le footer affiche bien Mayer Énergie + adresse Mayer + SIRET Mayer (= ses settings sont toujours lus correctement).

- [ ] **Step 4 : Commit**

```bash
git add src/lib/orgBranding.js
git commit -m "refactor(branding): MAYER_DEFAULTS → NEUTRAL_DEFAULTS in buildCompanyInfo"
```

---

### Task 4 : Refacto `mapbox.js` (`getMapDefaultCenter` dérive du siège)

**Files:**
- Modify: `src/lib/mapbox.js`

- [ ] **Step 1 : Réécrire `getMapDefaultCenter`**

```javascript
/**
 * mapbox.js
 * Configuration Mapbox GL pour le module Territoire
 */

import { getOrgHeadquarters } from './territoire-config';

// Centre géographique de la France métropolitaine (Bourges).
// Utilisé seulement si l'org n'a ni map_default_center ni siège configuré.
const NEUTRAL_FRANCE_CENTER = [2.5, 46.5];

export const MAPBOX_CONFIG = {
  accessToken: import.meta.env.VITE_MAPBOX_TOKEN || '',
  style: 'mapbox://styles/mapbox/outdoors-v12',
  defaultCenter: NEUTRAL_FRANCE_CENTER,  // utilisé seulement en dernier recours
  defaultZoom: 9,
  maxBounds: [
    [0.3, 42.9],  // SW (TODO multi-tenant : à dériver des départements de couverture)
    [2.9, 44.4],  // NE
  ],
};

/**
 * Centre par défaut de la Mapbox, par ordre de priorité :
 *   1. settings.map_default_center (override explicite, cas rare)
 *   2. position du siège (settings.territoire_centers[0])
 *   3. fallback centre France neutre
 *
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §9.2
 */
export function getMapDefaultCenter(settings) {
  const c = settings?.map_default_center;
  if (Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    return c;
  }
  const hq = getOrgHeadquarters(settings);
  if (hq) return [hq.lng, hq.lat];
  return NEUTRAL_FRANCE_CENTER;
}

export default MAPBOX_CONFIG;
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Smoke test sur Mayer**

Naviguer vers `/territoire` en tant que Mayer admin → la carte doit toujours s'ouvrir centrée sur Gaillac (parce que son siège est configuré dans `settings.territoire_centers`).

- [ ] **Step 4 : Commit**

```bash
git add src/lib/mapbox.js
git commit -m "refactor(mapbox): getMapDefaultCenter derives from headquarters"
```

---

### Task 5 : Créer `departments.js` + helper `getCoverageDepartments`

**Files:**
- Create: `src/lib/departments.js`
- Modify: `src/lib/territoire-config.js`

- [ ] **Step 1 : Créer `src/lib/departments.js`**

```javascript
/**
 * departments.js — Liste statique des départements français.
 * 95 métropolitains + Corse 2A/2B + DOM-TOM (971, 972, 973, 974, 976).
 *
 * Source : INSEE / data.gouv.fr 2026.
 * Format : { code: string, name: string }.
 */

export const FRENCH_DEPARTMENTS = [
  { code: '01', name: 'Ain' },
  { code: '02', name: 'Aisne' },
  { code: '03', name: 'Allier' },
  { code: '04', name: 'Alpes-de-Haute-Provence' },
  { code: '05', name: 'Hautes-Alpes' },
  { code: '06', name: 'Alpes-Maritimes' },
  { code: '07', name: 'Ardèche' },
  { code: '08', name: 'Ardennes' },
  { code: '09', name: 'Ariège' },
  { code: '10', name: 'Aube' },
  { code: '11', name: 'Aude' },
  { code: '12', name: 'Aveyron' },
  { code: '13', name: 'Bouches-du-Rhône' },
  { code: '14', name: 'Calvados' },
  { code: '15', name: 'Cantal' },
  { code: '16', name: 'Charente' },
  { code: '17', name: 'Charente-Maritime' },
  { code: '18', name: 'Cher' },
  { code: '19', name: 'Corrèze' },
  { code: '2A', name: 'Corse-du-Sud' },
  { code: '2B', name: 'Haute-Corse' },
  { code: '21', name: "Côte-d'Or" },
  { code: '22', name: "Côtes-d'Armor" },
  { code: '23', name: 'Creuse' },
  { code: '24', name: 'Dordogne' },
  { code: '25', name: 'Doubs' },
  { code: '26', name: 'Drôme' },
  { code: '27', name: 'Eure' },
  { code: '28', name: 'Eure-et-Loir' },
  { code: '29', name: 'Finistère' },
  { code: '30', name: 'Gard' },
  { code: '31', name: 'Haute-Garonne' },
  { code: '32', name: 'Gers' },
  { code: '33', name: 'Gironde' },
  { code: '34', name: 'Hérault' },
  { code: '35', name: 'Ille-et-Vilaine' },
  { code: '36', name: 'Indre' },
  { code: '37', name: 'Indre-et-Loire' },
  { code: '38', name: 'Isère' },
  { code: '39', name: 'Jura' },
  { code: '40', name: 'Landes' },
  { code: '41', name: 'Loir-et-Cher' },
  { code: '42', name: 'Loire' },
  { code: '43', name: 'Haute-Loire' },
  { code: '44', name: 'Loire-Atlantique' },
  { code: '45', name: 'Loiret' },
  { code: '46', name: 'Lot' },
  { code: '47', name: 'Lot-et-Garonne' },
  { code: '48', name: 'Lozère' },
  { code: '49', name: 'Maine-et-Loire' },
  { code: '50', name: 'Manche' },
  { code: '51', name: 'Marne' },
  { code: '52', name: 'Haute-Marne' },
  { code: '53', name: 'Mayenne' },
  { code: '54', name: 'Meurthe-et-Moselle' },
  { code: '55', name: 'Meuse' },
  { code: '56', name: 'Morbihan' },
  { code: '57', name: 'Moselle' },
  { code: '58', name: 'Nièvre' },
  { code: '59', name: 'Nord' },
  { code: '60', name: 'Oise' },
  { code: '61', name: 'Orne' },
  { code: '62', name: 'Pas-de-Calais' },
  { code: '63', name: 'Puy-de-Dôme' },
  { code: '64', name: 'Pyrénées-Atlantiques' },
  { code: '65', name: 'Hautes-Pyrénées' },
  { code: '66', name: 'Pyrénées-Orientales' },
  { code: '67', name: 'Bas-Rhin' },
  { code: '68', name: 'Haut-Rhin' },
  { code: '69', name: 'Rhône' },
  { code: '70', name: 'Haute-Saône' },
  { code: '71', name: 'Saône-et-Loire' },
  { code: '72', name: 'Sarthe' },
  { code: '73', name: 'Savoie' },
  { code: '74', name: 'Haute-Savoie' },
  { code: '75', name: 'Paris' },
  { code: '76', name: 'Seine-Maritime' },
  { code: '77', name: 'Seine-et-Marne' },
  { code: '78', name: 'Yvelines' },
  { code: '79', name: 'Deux-Sèvres' },
  { code: '80', name: 'Somme' },
  { code: '81', name: 'Tarn' },
  { code: '82', name: 'Tarn-et-Garonne' },
  { code: '83', name: 'Var' },
  { code: '84', name: 'Vaucluse' },
  { code: '85', name: 'Vendée' },
  { code: '86', name: 'Vienne' },
  { code: '87', name: 'Haute-Vienne' },
  { code: '88', name: 'Vosges' },
  { code: '89', name: 'Yonne' },
  { code: '90', name: 'Territoire de Belfort' },
  { code: '91', name: 'Essonne' },
  { code: '92', name: 'Hauts-de-Seine' },
  { code: '93', name: 'Seine-Saint-Denis' },
  { code: '94', name: 'Val-de-Marne' },
  { code: '95', name: "Val-d'Oise" },
  { code: '971', name: 'Guadeloupe' },
  { code: '972', name: 'Martinique' },
  { code: '973', name: 'Guyane' },
  { code: '974', name: 'La Réunion' },
  { code: '976', name: 'Mayotte' },
];

export function getDepartmentByCode(code) {
  if (!code) return null;
  return FRENCH_DEPARTMENTS.find((d) => d.code === code) ?? null;
}

export function getDepartmentLabel(code) {
  const d = getDepartmentByCode(code);
  return d ? `${d.code} — ${d.name}` : '';
}
```

- [ ] **Step 2 : Ajouter le helper `getCoverageDepartments` dans `territoire-config.js`**

À la fin du fichier `src/lib/territoire-config.js`, ajouter :

```javascript
/**
 * P0.13 follow-up — Multi-tenant : retourne la liste des départements
 * couverts par l'org pour le module GeoGrid et la carte CRM.
 *
 * Convention actuelle (itération 1) : 1 seul département principal
 * (settings.geogrid_target_department, singleton). Si non configuré,
 * fallback **neutre** : array vide → l'UI affichera "Configure ton
 * département principal".
 *
 * Itération future : transformer en multi-select via settings.coverage_departments.
 *
 * @param {Object|null} settings - core.organizations.settings
 * @returns {string[]} liste de codes département (ex: ['81'])
 */
export function getCoverageDepartments(settings) {
  const target = settings?.geogrid_target_department;
  if (target && typeof target === 'string') return [target];
  return [];
}
```

- [ ] **Step 3 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 4 : Commit**

```bash
git add src/lib/departments.js src/lib/territoire-config.js
git commit -m "feat(territoire): add departments.js + getCoverageDepartments helper"
```

---

### Task 6 : Refacto `communesService.js` paramétré + update consumers

**Files:**
- Modify: `src/apps/artisan/components/geogrid/communesService.js`
- Modify: `src/apps/artisan/components/geogrid/BenchmarkLauncher.jsx`
- (Audit any other consumer of `fetchCommunes`)

- [ ] **Step 1 : Identifier tous les consumers de `fetchCommunes`**

```bash
# Lister les fichiers qui importent fetchCommunes
grep -rn "fetchCommunes" src/ --include="*.jsx" --include="*.js"
```

Expected : au moins `BenchmarkLauncher.jsx` ; éventuellement `ScanConfigPanel.jsx`. Noter tous les fichiers.

- [ ] **Step 2 : Refacto `communesService.js`**

Lire le fichier actuel (`src/apps/artisan/components/geogrid/communesService.js`), repérer la constante hardcodée `'81'`, et remplacer la signature de `fetchCommunes` pour accepter un `departmentCode` :

```javascript
/**
 * communesService.js — Fetch des communes par département via geo.api.gouv.fr
 *
 * Mode GeoGrid "cities" : 1 scan par commune du département cible.
 * Cache LocalStorage 7 jours par code département.
 *
 * Multi-tenant : le département est passé par le caller (lu depuis
 * settings.geogrid_target_department via useAuth().organization.settings).
 * Cf docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md §9.4
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const CACHE_KEY_PREFIX = 'geogrid:communes';

/**
 * Récupère les communes d'un département (avec cache LocalStorage).
 * @param {string} departmentCode - Code à 2-3 chars ('81', '2A', '971')
 * @returns {Promise<{ data: Array<{ code, nom, codesPostaux, population, centre }>, error: Error|null }>}
 */
export async function fetchCommunes(departmentCode) {
  if (!departmentCode || !/^(\d{2,3}|2[AB])$/.test(departmentCode)) {
    return { data: [], error: new Error('Département non configuré') };
  }

  const cacheKey = `${CACHE_KEY_PREFIX}:${departmentCode}`;

  // 1. Try cache LocalStorage
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL_MS && Array.isArray(data)) {
        return { data, error: null };
      }
    }
  } catch (e) {
    // localStorage HS ou JSON corrompu → fallback fetch
  }

  // 2. Fetch API
  try {
    const url = `https://geo.api.gouv.fr/departements/${departmentCode}/communes?fields=code,nom,codesPostaux,population,centre&format=json&geometry=centre`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Cache succès
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) { /* quota plein, ignore */ }
    return { data, error: null };
  } catch (err) {
    return { data: [], error: err };
  }
}
```

**Note** : conserver toute autre fonction utilitaire pré-existante dans le fichier (sortBy population, filtering, etc.) — ne pas écraser sans vérifier.

- [ ] **Step 3 : Update `BenchmarkLauncher.jsx`**

Repérer l'appel actuel à `fetchCommunes()` (sans paramètre). Le remplacer par :

```jsx
import { useAuth } from '@contexts/AuthContext';

// dans le composant :
const { organization } = useAuth();
const departmentCode = organization?.settings?.geogrid_target_department;

// guard : si pas configuré, afficher un message dédié
if (!departmentCode) {
  return (
    <div className="p-4 border border-amber-200 bg-amber-50 rounded text-sm text-amber-800">
      Configure ton <strong>département principal</strong> dans Paramètres → Organisation → Territoire
      pour lancer un benchmark sur les communes.
    </div>
  );
}

// puis dans le code de fetch :
const { data, error } = await fetchCommunes(departmentCode);
```

- [ ] **Step 4 : Update les autres consumers identifiés à l'étape 1**

Pour chaque fichier listé par le `grep` de l'étape 1, faire le même changement : passer `organization?.settings?.geogrid_target_department` à `fetchCommunes`.

- [ ] **Step 5 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 6 : Smoke test sur Mayer**

⚠️ Cette étape suppose que **Mayer a déjà `settings.geogrid_target_department = '81'`** backfillé. Sinon, le smoke test échouera et il faut faire Task 15 avant.

Naviguer `/geogrid` → onglet Benchmarks → lancer un benchmark → vérifier que les communes du Tarn s'affichent comme avant.

- [ ] **Step 7 : Commit**

```bash
git add src/apps/artisan/components/geogrid/communesService.js \
        src/apps/artisan/components/geogrid/BenchmarkLauncher.jsx
# + autres consumers identifiés
git commit -m "refactor(geogrid): communesService accepts departmentCode param"
```

---

### Task 7 : Page shell `OrganizationSettings.jsx` + route + sidebar

**Files:**
- Create: `src/apps/artisan/pages/settings/OrganizationSettings.jsx`
- Modify: `src/apps/artisan/routes.jsx`

- [ ] **Step 1 : Créer le composant shell `OrganizationSettings.jsx`**

```jsx
// src/apps/artisan/pages/settings/OrganizationSettings.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { Building2, Phone, MapPinned, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import IdentityTab from './organization/IdentityTab';
import ContactTab from './organization/ContactTab';
import TerritoryTab from './organization/TerritoryTab';

const TABS = [
  { key: 'identity', label: 'Identité', icon: Building2, Component: IdentityTab },
  { key: 'contact', label: 'Coordonnées', icon: Phone, Component: ContactTab },
  { key: 'territory', label: 'Territoire', icon: MapPinned, Component: TerritoryTab },
];

export default function OrganizationSettings() {
  const { isOrgAdmin } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('identity');

  // Garde org_admin (en complément du RouteGuard côté routes.jsx)
  if (!isOrgAdmin) {
    toast.error("Accès réservé à l'administrateur de l'organisation");
    navigate('/settings');
    return null;
  }

  const ActiveComponent = TABS.find((t) => t.key === activeTab)?.Component;

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-1 text-sm text-secondary-500 hover:text-secondary-700 mb-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Paramètres
        </button>
        <h1 className="text-2xl font-bold text-secondary-900">Organisation</h1>
        <p className="text-secondary-600">
          Configure l'identité, les coordonnées et le territoire de ton entreprise.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar gauche */}
        <nav className="w-56 flex-shrink-0 space-y-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-secondary-600 hover:bg-secondary-50'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Contenu */}
        <div className="flex-1 min-w-0">
          {ActiveComponent && <ActiveComponent />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Créer les 3 fichiers stub des onglets**

Créer `src/apps/artisan/pages/settings/organization/IdentityTab.jsx` :

```jsx
export default function IdentityTab() {
  return (
    <div className="card">
      <p className="text-secondary-500">Onglet Identité — à implémenter (Task 12).</p>
    </div>
  );
}
```

Idem pour `ContactTab.jsx` et `TerritoryTab.jsx` (placeholder).

- [ ] **Step 3 : Ajouter la route `/settings/organization`**

Dans `src/apps/artisan/routes.jsx` :

```jsx
// 1) lazy import en haut du fichier (après les autres imports settings)
const OrganizationSettings = lazy(() => import('./pages/settings/OrganizationSettings'));

// 2) ajouter la route dans le tableau artisanRoutes, après settings/permissions :
{
  path: 'settings/organization',
  element: (
    <SuspenseWrapper>
      <RouteGuard resource="settings">
        <OrganizationSettings />
      </RouteGuard>
    </SuspenseWrapper>
  ),
},
```

- [ ] **Step 4 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 5 : Smoke test**

Naviguer `/settings` → cliquer "Organisation" → l'écran s'ouvre, sidebar gauche affiche 3 entries, navigation entre les 3 onglets fonctionne (chacun affiche le placeholder).

- [ ] **Step 6 : Commit**

```bash
git add src/apps/artisan/pages/settings/OrganizationSettings.jsx \
        src/apps/artisan/pages/settings/organization/IdentityTab.jsx \
        src/apps/artisan/pages/settings/organization/ContactTab.jsx \
        src/apps/artisan/pages/settings/organization/TerritoryTab.jsx \
        src/apps/artisan/routes.jsx
git commit -m "feat(settings): scaffold /settings/organization page + 3-tab sidebar"
```

---

### Task 8 : Composant `RgeCertificationsInput`

**Files:**
- Create: `src/apps/artisan/pages/settings/organization/components/RgeCertificationsInput.jsx`

- [ ] **Step 1 : Créer le composant chips**

```jsx
// src/apps/artisan/pages/settings/organization/components/RgeCertificationsInput.jsx
import { useState, useRef } from 'react';
import { X } from 'lucide-react';

const RGE_SUGGESTIONS = [
  'Qualibat',
  'QualiPAC',
  'QualiBois',
  'QualiPV',
  'QualiSol',
  'QualiForage',
  'Eco Artisan',
  'RGE Études',
];

const MAX_ITEM_LENGTH = 30;
const MAX_ITEMS = 20;

/**
 * Input chips pour settings.rge_certifications (array de strings).
 * Autocomplete sur RGE_SUGGESTIONS + saisie libre.
 *
 * @param {Object} props
 * @param {string[]} props.value - liste actuelle de certifications
 * @param {Function} props.onChange - (newList: string[]) => void
 * @param {boolean} [props.disabled]
 */
export default function RgeCertificationsInput({ value = [], onChange, disabled = false }) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef(null);

  const suggestions = RGE_SUGGESTIONS.filter(
    (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)
  );

  const addItem = (item) => {
    const trimmed = item.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_ITEM_LENGTH) return;
    if (value.includes(trimmed)) return;
    if (value.length >= MAX_ITEMS) return;
    onChange([...value, trimmed]);
    setInput('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const removeItem = (item) => {
    onChange(value.filter((v) => v !== item));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      removeItem(value[value.length - 1]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 min-h-[34px]">
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-700 text-xs font-medium rounded-md"
          >
            {item}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeItem(item)}
                className="hover:text-primary-900"
                aria-label={`Retirer ${item}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>

      {!disabled && value.length < MAX_ITEMS && (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_ITEM_LENGTH}
            placeholder="Tape une certification..."
            className="w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white border border-secondary-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((s) => (
                <li
                  key={s}
                  className="px-3 py-2 text-sm hover:bg-secondary-50 cursor-pointer"
                  onMouseDown={() => addItem(s)}
                >
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {value.length >= MAX_ITEMS && (
        <p className="text-xs text-secondary-500">
          Limite atteinte ({MAX_ITEMS} certifications maximum).
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/pages/settings/organization/components/RgeCertificationsInput.jsx
git commit -m "feat(settings): add RgeCertificationsInput chips component"
```

---

### Task 9 : Composant `AddressSearch` (Mapbox Geocoding)

**Files:**
- Create: `src/apps/artisan/pages/settings/organization/components/AddressSearch.jsx`

- [ ] **Step 1 : Créer le composant autocomplete Mapbox**

```jsx
// src/apps/artisan/pages/settings/organization/components/AddressSearch.jsx
import { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { MAPBOX_CONFIG } from '@lib/mapbox';

/**
 * Autocomplete Mapbox Geocoding pour saisir une adresse.
 * Debounce 300ms. Retourne { lat, lng, label, departmentCode } à la sélection.
 *
 * @param {Object} props
 * @param {string} [props.initialValue] - adresse formatée initiale (label affiché)
 * @param {Function} props.onSelect - (result) => void
 * @param {string} [props.placeholder]
 * @param {boolean} [props.disabled]
 */
export default function AddressSearch({ initialValue = '', onSelect, placeholder = '🔍 Rechercher une adresse...', disabled = false }) {
  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState(null);
  const debounceTimer = useRef(null);

  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!query || query.length < 3) {
      setSuggestions([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = MAPBOX_CONFIG.accessToken;
        if (!token) throw new Error('VITE_MAPBOX_TOKEN non configuré');
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=fr&language=fr&access_token=${token}&limit=5`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSuggestions(data.features || []);
      } catch (err) {
        setError(err.message || 'Recherche indisponible');
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [query]);

  const handleSelect = (feature) => {
    const [lng, lat] = feature.center;
    // Extraction du code département depuis le context Mapbox
    // context : [{ id: 'place...', short_code: '...' }, { id: 'region...', short_code: 'FR-XX' }, ...]
    let departmentCode = null;
    if (Array.isArray(feature.context)) {
      const region = feature.context.find((c) => c.id?.startsWith('region.') && c.short_code?.startsWith('FR-'));
      if (region?.short_code) {
        departmentCode = region.short_code.replace('FR-', '');
      }
    }
    setQuery(feature.place_name);
    setShowSuggestions(false);
    onSelect({
      lat,
      lng,
      label: feature.place_name,
      departmentCode,
    });
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full pl-10 pr-10 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-secondary-50"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400 animate-spin" />
        )}
      </div>

      {error && (
        <p className="mt-1 text-xs text-red-600">⚠️ {error} — utilise la saisie manuelle ci-dessous.</p>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border border-secondary-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((s) => (
            <li
              key={s.id}
              className="px-3 py-2 text-sm hover:bg-secondary-50 cursor-pointer border-b border-secondary-100 last:border-b-0"
              onMouseDown={() => handleSelect(s)}
            >
              {s.place_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/pages/settings/organization/components/AddressSearch.jsx
git commit -m "feat(settings): add AddressSearch component (Mapbox autocomplete)"
```

---

### Task 10 : Composant `DepartmentSelect`

**Files:**
- Create: `src/apps/artisan/pages/settings/organization/components/DepartmentSelect.jsx`

- [ ] **Step 1 : Créer le sélecteur de département**

```jsx
// src/apps/artisan/pages/settings/organization/components/DepartmentSelect.jsx
import { MapPin } from 'lucide-react';
import { FRENCH_DEPARTMENTS } from '@lib/departments';

/**
 * Sélecteur de département français (95 + DOM-TOM).
 * Bouton "📍 Détecter depuis siège" si onDetectFromHq fourni.
 *
 * @param {Object} props
 * @param {string} props.value - code département actuel (ex '81')
 * @param {Function} props.onChange - (code: string) => void
 * @param {Function} [props.onDetectFromHq] - callback pour auto-détection depuis lat/lng du siège
 * @param {boolean} [props.disabled]
 */
export default function DepartmentSelect({ value = '', onChange, onDetectFromHq, disabled = false }) {
  return (
    <div className="flex gap-2 items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-secondary-50"
      >
        <option value="">— Sélectionne un département —</option>
        {FRENCH_DEPARTMENTS.map((d) => (
          <option key={d.code} value={d.code}>
            {d.code} — {d.name}
          </option>
        ))}
      </select>
      {onDetectFromHq && (
        <button
          type="button"
          onClick={onDetectFromHq}
          disabled={disabled}
          className="flex items-center gap-1 px-3 py-2 text-xs text-primary-600 border border-primary-300 rounded-md hover:bg-primary-50 disabled:opacity-50"
        >
          <MapPin className="w-3 h-3" />
          Détecter depuis siège
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/pages/settings/organization/components/DepartmentSelect.jsx
git commit -m "feat(settings): add DepartmentSelect component"
```

---

### Task 11 : Composant `CenterEditor` (siège + antenne)

**Files:**
- Create: `src/apps/artisan/pages/settings/organization/components/CenterEditor.jsx`

- [ ] **Step 1 : Créer le formulaire centre réutilisable**

```jsx
// src/apps/artisan/pages/settings/organization/components/CenterEditor.jsx
import { useState } from 'react';
import AddressSearch from './AddressSearch';

const COLOR_PRESETS = [
  { value: '#f97316', name: 'Orange' },
  { value: '#ef4444', name: 'Rouge' },
  { value: '#10b981', name: 'Vert' },
  { value: '#3b82f6', name: 'Bleu' },
  { value: '#8b5cf6', name: 'Violet' },
  { value: '#f59e0b', name: 'Ambre' },
];

const EMOJI_PRESETS = ['🏢', '🏠', '🏭', '⚡', '📍'];

/**
 * Formulaire d'édition d'un centre (siège ou antenne).
 * Géré en controlled mode : le parent passe `value` et reçoit `onChange`.
 *
 * @param {Object} props
 * @param {Object} props.value - { label, lat, lng, color, emoji }
 * @param {Function} props.onChange - (newCenter) => void
 * @param {string} [props.labelHint] - texte d'aide sous "Nom"
 * @param {boolean} [props.disabled]
 */
export default function CenterEditor({ value, onChange, labelHint, disabled = false }) {
  const [manualMode, setManualMode] = useState(false);

  const update = (patch) => onChange({ ...value, ...patch });

  const handleAddressSelect = ({ lat, lng, label }) => {
    // Ne pas écraser le label custom si déjà saisi par l'user
    update({ lat, lng, label: value.label || label });
  };

  return (
    <div className="space-y-4">
      {/* Nom */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">
          Nom (affiché sur la carte)
        </label>
        <input
          type="text"
          value={value.label || ''}
          onChange={(e) => update({ label: e.target.value })}
          disabled={disabled}
          maxLength={80}
          placeholder="Ex: Siège Cimaj — Toulouse"
          className="w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {labelHint && <p className="mt-1 text-xs text-secondary-500">{labelHint}</p>}
      </div>

      {/* Adresse → géocodage */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">
          Rechercher une adresse
        </label>
        <AddressSearch
          initialValue=""
          onSelect={handleAddressSelect}
          disabled={disabled}
        />
      </div>

      {/* Coordonnées affichées + toggle saisie manuelle */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-secondary-500">
            {Number.isFinite(value.lat) && Number.isFinite(value.lng)
              ? `📍 ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}`
              : 'Aucune coordonnée'}
          </span>
          <button
            type="button"
            onClick={() => setManualMode(!manualMode)}
            className="text-xs text-primary-600 hover:underline"
            disabled={disabled}
          >
            {manualMode ? 'Cacher la saisie manuelle' : 'Saisie manuelle'}
          </button>
        </div>
        {manualMode && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="number"
              step="0.000001"
              value={value.lat ?? ''}
              onChange={(e) => update({ lat: parseFloat(e.target.value) || null })}
              placeholder="Latitude"
              disabled={disabled}
              className="px-3 py-2 border border-secondary-300 rounded-md text-sm"
            />
            <input
              type="number"
              step="0.000001"
              value={value.lng ?? ''}
              onChange={(e) => update({ lng: parseFloat(e.target.value) || null })}
              placeholder="Longitude"
              disabled={disabled}
              className="px-3 py-2 border border-secondary-300 rounded-md text-sm"
            />
          </div>
        )}
      </div>

      {/* Couleur */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">Couleur (sur la carte)</label>
        <div className="flex gap-2">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => update({ color: c.value })}
              disabled={disabled}
              title={c.name}
              className={`w-7 h-7 rounded-full transition-all ${value.color === c.value ? 'ring-2 ring-offset-2 ring-primary-500' : ''}`}
              style={{ backgroundColor: c.value }}
            />
          ))}
        </div>
      </div>

      {/* Emoji */}
      <div>
        <label className="block text-xs font-medium text-secondary-600 mb-1">Icône</label>
        <div className="flex gap-2">
          {EMOJI_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => update({ emoji: e })}
              disabled={disabled}
              className={`w-9 h-9 rounded-md border text-lg transition-colors ${value.emoji === e ? 'border-primary-500 bg-primary-50' : 'border-secondary-300 hover:bg-secondary-50'}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/pages/settings/organization/components/CenterEditor.jsx
git commit -m "feat(settings): add CenterEditor component (siège/antenne form)"
```

---

### Task 12 : `IdentityTab.jsx`

**Files:**
- Modify: `src/apps/artisan/pages/settings/organization/IdentityTab.jsx`

- [ ] **Step 1 : Implémenter l'onglet Identité complet**

Réécrire le fichier `src/apps/artisan/pages/settings/organization/IdentityTab.jsx` :

```jsx
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';
import RgeCertificationsInput from './components/RgeCertificationsInput';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

const LEGAL_FORMS = [
  'SAS',
  'SAS à associé unique',
  'SARL',
  'EURL',
  'SA',
  'SCI',
  'EI',
  'Autre',
];

const FIELDS = [
  'brand_name',
  'legal_name',
  'legal_form',
  'capital',
  'siret',
  'rcs',
  'tva_intra',
  'insurance',
  'rge_certifications',
];

// Formatage SIRET : groupes de 3 chiffres + 5 derniers
function formatSiret(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
}

function formatTva(raw) {
  const cleaned = (raw || '').replace(/\s/g, '').toUpperCase();
  if (!cleaned) return '';
  const withoutPrefix = cleaned.startsWith('FR') ? cleaned.slice(2) : cleaned;
  const digits = withoutPrefix.replace(/\D/g, '').slice(0, 11);
  if (!digits) return 'FR';
  if (digits.length <= 2) return `FR ${digits}`;
  return `FR ${digits.slice(0, 2)} ${digits.slice(2)}`;
}

function validate(form) {
  const errors = {};
  if (!form.brand_name?.trim()) errors.brand_name = 'Obligatoire';
  if (form.brand_name && form.brand_name.length > 80) errors.brand_name = 'Maximum 80 caractères';
  if (form.legal_name && form.legal_name.length > 120) errors.legal_name = 'Maximum 120 caractères';
  if (form.siret && !/^\d{3}\s?\d{3}\s?\d{3}\s?\d{5}$/.test(form.siret)) {
    errors.siret = 'Format attendu : 14 chiffres (ex: 100 288 224 00015)';
  }
  if (form.tva_intra && !/^FR\s?\d{2}\s?\d{9}$/.test(form.tva_intra)) {
    errors.tva_intra = 'Format attendu : FR + 2 chiffres + 9 chiffres';
  }
  if (form.insurance && form.insurance.length > 200) errors.insurance = 'Maximum 200 caractères';
  return errors;
}

function pickIdentityFields(settings) {
  const out = {};
  FIELDS.forEach((f) => {
    out[f] = settings[f] ?? (f === 'rge_certifications' ? [] : '');
  });
  return out;
}

export default function IdentityTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickIdentityFields({}));
  const [initial, setInitial] = useState(() => pickIdentityFields({}));

  useEffect(() => {
    const picked = pickIdentityFields(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrige les erreurs avant d\'enregistrer.');
      return;
    }
    try {
      await save(form);
      toast.success('Identité enregistrée');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const handleReset = () => setForm(initial);

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">
      {/* Section Branding */}
      <section>
        <h3 className={SECTION_TITLE}>Branding</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Nom commercial *</label>
            <input
              type="text"
              value={form.brand_name}
              onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
              maxLength={80}
              placeholder="Ex: Cimaj"
              className={INPUT_CLASS}
            />
            {errors.brand_name && <p className={ERROR_CLASS}>{errors.brand_name}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Raison sociale</label>
            <input
              type="text"
              value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
              maxLength={120}
              placeholder="Auto-rempli avec le nom commercial si vide"
              className={INPUT_CLASS}
            />
            {errors.legal_name && <p className={ERROR_CLASS}>{errors.legal_name}</p>}
          </div>
        </div>
      </section>

      {/* Section Mention légale */}
      <section>
        <h3 className={SECTION_TITLE}>Mention légale</h3>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={LABEL_CLASS}>Forme juridique</label>
            <select
              value={form.legal_form}
              onChange={(e) => setForm({ ...form, legal_form: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="">—</option>
              {LEGAL_FORMS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLASS}>Capital social (€)</label>
            <input
              type="text"
              value={form.capital}
              onChange={(e) => setForm({ ...form, capital: e.target.value })}
              placeholder="Ex: 6 000"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>SIRET</label>
            <input
              type="text"
              value={form.siret}
              onChange={(e) => setForm({ ...form, siret: formatSiret(e.target.value) })}
              placeholder="Ex: 100 288 224 00015"
              className={INPUT_CLASS}
            />
            {errors.siret && <p className={ERROR_CLASS}>{errors.siret}</p>}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className={LABEL_CLASS}>RCS</label>
            <input
              type="text"
              value={form.rcs}
              onChange={(e) => setForm({ ...form, rcs: e.target.value })}
              maxLength={80}
              placeholder="Ex: 100 288 224 R.C.S. Albi"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>N° TVA intracommunautaire</label>
            <input
              type="text"
              value={form.tva_intra}
              onChange={(e) => setForm({ ...form, tva_intra: formatTva(e.target.value) })}
              placeholder="Ex: FR 06 449776916"
              className={INPUT_CLASS}
            />
            {errors.tva_intra && <p className={ERROR_CLASS}>{errors.tva_intra}</p>}
          </div>
        </div>
        <div className="mt-4">
          <label className={LABEL_CLASS}>Mention assurance</label>
          <textarea
            value={form.insurance}
            onChange={(e) => setForm({ ...form, insurance: e.target.value })}
            maxLength={200}
            rows={2}
            placeholder="Ex: Couvert par une assurance responsabilité civile professionnelle"
            className={INPUT_CLASS}
          />
          {errors.insurance && <p className={ERROR_CLASS}>{errors.insurance}</p>}
        </div>
      </section>

      {/* Section Qualifications */}
      <section>
        <h3 className={SECTION_TITLE}>Qualifications RGE</h3>
        <RgeCertificationsInput
          value={form.rge_certifications}
          onChange={(newList) => setForm({ ...form, rge_certifications: newList })}
        />
      </section>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Smoke test sur Mayer**

Naviguer `/settings/organization` → onglet Identité → vérifier que les valeurs Mayer sont préremplies (brand_name = "Mayer Énergie", SIRET, RCS, etc.). Modifier le `capital` (genre "7 500"), enregistrer → toast "Identité enregistrée", recharger la page → la valeur persiste.

- [ ] **Step 4 : Commit**

```bash
git add src/apps/artisan/pages/settings/organization/IdentityTab.jsx
git commit -m "feat(settings): implement IdentityTab (branding/legal/RGE)"
```

---

### Task 13 : `ContactTab.jsx`

**Files:**
- Modify: `src/apps/artisan/pages/settings/organization/ContactTab.jsx`

- [ ] **Step 1 : Implémenter l'onglet Coordonnées complet**

Réécrire le fichier `src/apps/artisan/pages/settings/organization/ContactTab.jsx` :

```jsx
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings } from '@hooks/useOrgSettings';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const FIELDS = ['address', 'postal_code', 'city', 'phone', 'from_email', 'reply_to', 'website_url'];

function formatPhoneFR(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 10);
  const groups = [];
  for (let i = 0; i < digits.length; i += 2) {
    groups.push(digits.slice(i, i + 2));
  }
  return groups.join(' ');
}

function autoPrefixHttps(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

function validate(form) {
  const errors = {};
  if (!form.address?.trim()) errors.address = 'Obligatoire';
  if (form.address && form.address.length > 200) errors.address = 'Maximum 200 caractères';
  if (!form.postal_code?.trim()) errors.postal_code = 'Obligatoire';
  if (form.postal_code && !/^\d{5}$/.test(form.postal_code)) errors.postal_code = '5 chiffres attendus';
  if (!form.city?.trim()) errors.city = 'Obligatoire';
  if (form.city && form.city.length > 80) errors.city = 'Maximum 80 caractères';
  if (!form.phone?.trim()) errors.phone = 'Obligatoire';
  if (form.phone && form.phone.replace(/\D/g, '').length !== 10) errors.phone = 'Téléphone FR à 10 chiffres';
  if (!form.from_email?.trim()) errors.from_email = 'Obligatoire';
  if (form.from_email && !EMAIL_RE.test(form.from_email)) errors.from_email = 'Email invalide';
  if (form.reply_to && !EMAIL_RE.test(form.reply_to)) errors.reply_to = 'Email invalide';
  if (form.website_url && !URL_RE.test(form.website_url)) errors.website_url = 'URL invalide (https://...)';
  return errors;
}

function pickFields(settings) {
  const out = {};
  FIELDS.forEach((f) => {
    out[f] = settings[f] ?? '';
  });
  return out;
}

export default function ContactTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickFields({}));
  const [initial, setInitial] = useState(() => pickFields({}));

  useEffect(() => {
    const picked = pickFields(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrige les erreurs avant d\'enregistrer.');
      return;
    }
    try {
      // Auto-prefix https sur website_url juste avant save
      const payload = { ...form, website_url: autoPrefixHttps(form.website_url) };
      await save(payload);
      toast.success('Coordonnées enregistrées');
      setInitial(payload);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const handleReset = () => setForm(initial);

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">
      {/* Section Siège social */}
      <section>
        <h3 className={SECTION_TITLE}>Siège social</h3>
        <div>
          <label className={LABEL_CLASS}>Adresse *</label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            maxLength={200}
            placeholder="Ex: 26 Rue des Pyrénées"
            className={INPUT_CLASS}
          />
          {errors.address && <p className={ERROR_CLASS}>{errors.address}</p>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className={LABEL_CLASS}>Code postal *</label>
            <input
              type="text"
              value={form.postal_code}
              onChange={(e) => setForm({ ...form, postal_code: e.target.value.replace(/\D/g, '').slice(0, 5) })}
              placeholder="81600"
              className={INPUT_CLASS}
            />
            {errors.postal_code && <p className={ERROR_CLASS}>{errors.postal_code}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Ville *</label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              maxLength={80}
              placeholder="Gaillac"
              className={INPUT_CLASS}
            />
            {errors.city && <p className={ERROR_CLASS}>{errors.city}</p>}
          </div>
        </div>
      </section>

      {/* Section Contact */}
      <section>
        <h3 className={SECTION_TITLE}>Contact</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Téléphone *</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: formatPhoneFR(e.target.value) })}
              placeholder="05 63 33 23 14"
              className={INPUT_CLASS}
            />
            {errors.phone && <p className={ERROR_CLASS}>{errors.phone}</p>}
          </div>
          <div>
            <label className={LABEL_CLASS}>Email expéditeur *</label>
            <input
              type="email"
              value={form.from_email}
              onChange={(e) => setForm({ ...form, from_email: e.target.value })}
              placeholder="contact@cimaj.fr"
              className={INPUT_CLASS}
            />
            {errors.from_email && <p className={ERROR_CLASS}>{errors.from_email}</p>}
            <p className={HINT_CLASS}>Cet email doit être validé sur Resend pour l'envoi de campagnes.</p>
          </div>
        </div>
        <div className="mt-4">
          <label className={LABEL_CLASS}>Email de réponse (si différent)</label>
          <input
            type="email"
            value={form.reply_to}
            onChange={(e) => setForm({ ...form, reply_to: e.target.value })}
            placeholder="reply@cimaj.fr"
            className={INPUT_CLASS}
          />
          {errors.reply_to && <p className={ERROR_CLASS}>{errors.reply_to}</p>}
          <p className={HINT_CLASS}>Laisse vide pour utiliser l'email expéditeur.</p>
        </div>
      </section>

      {/* Section Présence web */}
      <section>
        <h3 className={SECTION_TITLE}>Présence web</h3>
        <div>
          <label className={LABEL_CLASS}>Site web</label>
          <input
            type="url"
            value={form.website_url}
            onChange={(e) => setForm({ ...form, website_url: e.target.value })}
            placeholder="https://www.cimaj.fr"
            className={INPUT_CLASS}
          />
          {errors.website_url && <p className={ERROR_CLASS}>{errors.website_url}</p>}
        </div>
      </section>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Smoke test**

Naviguer onglet Coordonnées sur Mayer → vérifier que les champs sont préremplis avec les valeurs Mayer. Tester la validation : entrer un code postal "1234" (4 chiffres) → erreur inline. Entrer un mauvais email → erreur. Bouton "Enregistrer" disabled. Corriger → save passe.

- [ ] **Step 4 : Commit**

```bash
git add src/apps/artisan/pages/settings/organization/ContactTab.jsx
git commit -m "feat(settings): implement ContactTab (adresse, contact, web)"
```

---

### Task 14 : `TerritoryTab.jsx`

**Files:**
- Modify: `src/apps/artisan/pages/settings/organization/TerritoryTab.jsx`

- [ ] **Step 1 : Implémenter l'onglet Territoire complet**

Réécrire le fichier `src/apps/artisan/pages/settings/organization/TerritoryTab.jsx` :

```jsx
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Plus, X } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { MAPBOX_CONFIG } from '@lib/mapbox';
import CenterEditor from './components/CenterEditor';
import DepartmentSelect from './components/DepartmentSelect';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';

const PLACE_ID_FINDER_URL = 'https://developers.google.com/maps/documentation/places/web-service/place-id';

function slugify(label) {
  return (label || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || `center_${Date.now()}`;
}

function defaultCenter() {
  return { label: '', lat: null, lng: null, color: '#3b82f6', emoji: '🏢' };
}

function defaultBranch() {
  return { label: '', lat: null, lng: null, color: '#ef4444', emoji: '📍' };
}

// settings.territoire_centers est un objet keyed : 1ère entry = siège.
// On normalise en { headquarters, branches: [] } pour l'UI.
function deserialize(settings) {
  const centers = settings?.territoire_centers;
  if (!centers || typeof centers !== 'object') {
    return {
      headquarters: defaultCenter(),
      branches: [],
      google_place_id: settings?.google_place_id || '',
      geogrid_target_department: settings?.geogrid_target_department || '',
    };
  }
  const entries = Object.entries(centers);
  const [, hq] = entries[0] || [null, defaultCenter()];
  const branches = entries.slice(1).map(([, c]) => c);
  return {
    headquarters: { ...defaultCenter(), ...hq },
    branches,
    google_place_id: settings?.google_place_id || '',
    geogrid_target_department: settings?.geogrid_target_department || '',
  };
}

// Reconstruit l'objet territoire_centers keyed (slug du label) à partir du state UI
function serializeTerritoireCenters(headquarters, branches) {
  const out = {};
  const hqKey = slugify(headquarters.label) || 'headquarters';
  out[hqKey] = headquarters;
  branches.forEach((b, idx) => {
    let key = slugify(b.label) || `branch_${idx}`;
    // Évite collision avec hqKey
    while (out[key]) key = `${key}_${idx + 1}`;
    out[key] = b;
  });
  return out;
}

function validate(state) {
  const errors = {};
  if (!state.headquarters.label?.trim()) errors.hq_label = 'Nom du siège obligatoire';
  if (!Number.isFinite(state.headquarters.lat) || !Number.isFinite(state.headquarters.lng)) {
    errors.hq_coords = 'Coordonnées du siège obligatoires (recherche adresse ou saisie manuelle)';
  }
  state.branches.forEach((b, idx) => {
    if (!b.label?.trim()) errors[`branch_label_${idx}`] = 'Nom de l\'antenne obligatoire';
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
      errors[`branch_coords_${idx}`] = 'Coordonnées de l\'antenne obligatoires';
    }
  });
  return errors;
}

export default function TerritoryTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [state, setState] = useState(() => deserialize({}));
  const [initial, setInitial] = useState(() => deserialize({}));
  const [editingBranchIdx, setEditingBranchIdx] = useState(null);

  useEffect(() => {
    const d = deserialize(settings);
    setState(d);
    setInitial(d);
  }, [settings]);

  const errors = useMemo(() => validate(state), [state]);
  const isDirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  const isValid = Object.keys(errors).length === 0;

  const handleSave = async () => {
    if (!isValid) {
      toast.error('Corrige les erreurs avant d\'enregistrer.');
      return;
    }
    try {
      const patch = {
        territoire_centers: serializeTerritoireCenters(state.headquarters, state.branches),
        google_place_id: state.google_place_id || null,
        geogrid_target_department: state.geogrid_target_department || null,
      };
      await save(patch);
      toast.success('Territoire enregistré');
      setInitial(state);
    } catch (err) {
      toast.error(err.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const handleReset = () => setState(initial);

  const handleDetectDepartment = async () => {
    const { lat, lng } = state.headquarters;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      toast.error('Configure d\'abord les coordonnées du siège');
      return;
    }
    try {
      const token = MAPBOX_CONFIG.accessToken;
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?country=fr&language=fr&types=region&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json();
      const region = data.features?.[0];
      const code = region?.properties?.short_code?.replace('FR-', '') || null;
      if (code) {
        setState({ ...state, geogrid_target_department: code });
        toast.success(`Département détecté : ${code}`);
      } else {
        toast.error('Impossible de détecter le département');
      }
    } catch (err) {
      toast.error('Erreur lors de la détection');
    }
  };

  const addBranch = () => {
    setState({ ...state, branches: [...state.branches, defaultBranch()] });
    setEditingBranchIdx(state.branches.length);
  };

  const updateBranch = (idx, updated) => {
    const newBranches = [...state.branches];
    newBranches[idx] = updated;
    setState({ ...state, branches: newBranches });
  };

  const removeBranch = (idx) => {
    setState({ ...state, branches: state.branches.filter((_, i) => i !== idx) });
    if (editingBranchIdx === idx) setEditingBranchIdx(null);
  };

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">

      {/* Section 1 : Siège */}
      <section className="bg-secondary-50 -m-4 p-4 rounded-lg">
        <h3 className={SECTION_TITLE}>
          1. Siège social
          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full normal-case font-medium">Obligatoire</span>
        </h3>
        <CenterEditor
          value={state.headquarters}
          onChange={(hq) => setState({ ...state, headquarters: hq })}
        />
        {errors.hq_label && <p className={ERROR_CLASS}>{errors.hq_label}</p>}
        {errors.hq_coords && <p className={ERROR_CLASS}>{errors.hq_coords}</p>}
      </section>

      {/* Section 2 : Référence Google */}
      <section>
        <h3 className={SECTION_TITLE}>
          2. Référence Google Business
          <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full normal-case font-medium">Recommandé</span>
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={state.google_place_id}
            onChange={(e) => setState({ ...state, google_place_id: e.target.value })}
            placeholder="ChIJ..."
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
          <a
            href={PLACE_ID_FINDER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 px-3 py-2 bg-blue-50 text-blue-700 text-xs font-medium rounded-md hover:bg-blue-100 inline-flex items-center gap-1"
          >
            Trouver <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className={HINT_CLASS}>
          ℹ️ Identifiant unique de ta fiche Google Business. Sert au <strong>suivi de positionnement local</strong> (module GeoGrid).
          Clique "Trouver" et cherche <strong>ton entreprise</strong> (pas l'adresse postale).
        </p>
      </section>

      {/* Section 3 : Département principal */}
      <section>
        <h3 className={SECTION_TITLE}>
          3. Département principal
          <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full normal-case font-medium">Recommandé</span>
        </h3>
        <DepartmentSelect
          value={state.geogrid_target_department}
          onChange={(code) => setState({ ...state, geogrid_target_department: code })}
          onDetectFromHq={handleDetectDepartment}
        />
        <p className={HINT_CLASS}>
          ℹ️ Zone de visibilité prioritaire. Sert au <strong>suivi SEO local</strong> (scans des communes du département).
          Détecté automatiquement depuis le siège, modifiable.
        </p>
      </section>

      {/* Section 4 : Antennes */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`${SECTION_TITLE} mb-0`}>
            4. Antennes commerciales
            <span className="ml-2 text-secondary-400 normal-case font-normal">(Optionnel)</span>
          </h3>
          <button
            type="button"
            onClick={addBranch}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary-50 text-primary-700 rounded-md hover:bg-primary-100"
          >
            <Plus className="w-3 h-3" /> Ajouter une antenne
          </button>
        </div>

        {state.branches.length === 0 ? (
          <div className="text-center text-secondary-400 text-sm py-6 border border-dashed border-secondary-200 rounded-md">
            Ajoute une antenne si tu as un commercial basé ailleurs qu'au siège.
          </div>
        ) : (
          <div className="space-y-3">
            {state.branches.map((b, idx) => {
              const isEditing = editingBranchIdx === idx;
              const branchErr = errors[`branch_label_${idx}`] || errors[`branch_coords_${idx}`];
              return (
                <div key={idx} className="border border-secondary-200 rounded-md">
                  <div className="flex items-center gap-2 p-3">
                    <span className="text-xl">{b.emoji || '📍'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-secondary-900 truncate">
                        {b.label || <span className="text-secondary-400 italic">Antenne sans nom</span>}
                      </div>
                      <div className="text-xs text-secondary-500">
                        {Number.isFinite(b.lat) && Number.isFinite(b.lng)
                          ? `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}`
                          : 'Pas de coordonnées'}
                      </div>
                      {branchErr && <p className="mt-1 text-xs text-red-600">{branchErr}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingBranchIdx(isEditing ? null : idx)}
                      className="px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 rounded"
                    >
                      {isEditing ? 'Fermer' : 'Éditer'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBranch(idx)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded"
                      aria-label="Supprimer l'antenne"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {isEditing && (
                    <div className="border-t border-secondary-200 p-3">
                      <CenterEditor value={b} onChange={(u) => updateBranch(idx, u)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={handleReset}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Vérifier lint + build**

```bash
npm run lint:errors
npm run build
```

- [ ] **Step 3 : Smoke test sur Mayer (siège)**

Naviguer onglet Territoire sur Mayer → vérifier que le siège est prérempli (label "Siège Mayer Énergie" ou similaire, lat/lng Gaillac, couleur orange ou bleue, emoji 🏢). Modifier le label, save → toast + reload → persiste.

- [ ] **Step 4 : Smoke test recherche adresse**

Ouvrir un onglet privé (ou nouvelle org Cimaj) → siège vide → taper "1 rue de Rivoli, Paris" dans la recherche d'adresse → suggestions Mapbox s'affichent → cliquer une → lat/lng remplies.

- [ ] **Step 5 : Smoke test antenne**

Cliquer "+ Ajouter une antenne" → un nouveau bloc apparaît, expandé. Remplir nom + adresse. Save. Reload. L'antenne persiste. Cliquer "X" sur l'antenne → disparaît, save → reload → disparue.

- [ ] **Step 6 : Smoke test département**

Cliquer "📍 Détecter depuis siège" sur Mayer → après reverse geocoding, le sélecteur affiche "81 — Tarn".

- [ ] **Step 7 : Smoke test Place ID**

Bouton "Trouver" ouvre la doc Google dans un nouvel onglet.

- [ ] **Step 8 : Commit**

```bash
git add src/apps/artisan/pages/settings/organization/TerritoryTab.jsx
git commit -m "feat(settings): implement TerritoryTab (siège + GMB + dept + antennes)"
```

---

### Task 15 : Backfill Mayer + smoke test global

**Files:**
- N/A (opération DB + tests)

- [ ] **Step 1 : Vérifier l'état actuel des settings Mayer**

Via MCP `execute_sql` :

```sql
SELECT
  id,
  name,
  settings ? 'brand_name'                   AS has_brand_name,
  settings ? 'siret'                        AS has_siret,
  settings ? 'address'                      AS has_address,
  settings ? 'from_email'                   AS has_from_email,
  settings ? 'territoire_centers'           AS has_territoire,
  settings ? 'geogrid_target_department'    AS has_target_dept,
  settings ? 'google_place_id'              AS has_place_id
FROM core.organizations
WHERE id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
```

Attendu : tous TRUE sauf `has_target_dept` (le nouveau champ à backfill).

- [ ] **Step 2 : Backfill `geogrid_target_department` pour Mayer**

Via MCP `apply_migration` ou `execute_sql` :

```sql
UPDATE core.organizations
SET settings = settings || jsonb_build_object('geogrid_target_department', '81'),
    updated_at = NOW()
WHERE id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND NOT (settings ? 'geogrid_target_department');
-- Idempotent : UPDATE ne fait rien si déjà présent
```

- [ ] **Step 3 : Re-vérifier Mayer**

Refaire le `SELECT` du Step 1 → toutes les colonnes doivent être TRUE.

- [ ] **Step 4 : Smoke test bout en bout sur Mayer (acceptance criteria spec §12)**

Suivre la checklist d'acceptance de la spec, items 1 → 12 :
1. `/settings` → cliquer "Organisation" → écran s'ouvre
2. Mayer : tous champs préremplis dans les 3 onglets
3. Modifier `brand_name` Mayer (ex "Mayer Énergie TEST") → save → reload → persiste → **remettre la valeur initiale "Mayer Énergie" et resave**
4. Générer un PDF contrat (depuis fiche client/contrat) → footer mentionne bien Mayer Énergie + adresse + SIRET
5. Validation : sur Coordonnées, saisir SIRET="1234" → erreur inline, save disabled
6. Territoire : tester recherche adresse + ajouter antenne fictive + supprimer
7. Test cross-tab : modifier Identité (champ capital) sans save → cliquer Territoire → revenir → modifs perdues (state local par tab, comportement attendu)
8. Test team_leader : se reconnecter en tant que team_leader → naviguer `/settings/organization` → redirect `/settings` + toast
9. Vérifier audit Supabase Advisor : 0 nouvel ERROR ajouté par la RPC

- [ ] **Step 5 : Smoke test GeoGrid (refacto communesService)**

Naviguer `/geogrid` → onglet Benchmarks → lancer un benchmark → vérifier que les communes du Tarn s'affichent (utilise désormais `settings.geogrid_target_department = '81'` au lieu du hardcode).

- [ ] **Step 6 : Commit final (changelog)**

```bash
git commit --allow-empty -m "chore(settings): /settings/organization complete (Task 1-15)

3 onglets Identité/Coordonnées/Territoire + neutralisation fallbacks Mayer
(orgBranding, mapbox) + geogrid département paramétré + backfill Mayer.

Spec: docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md
Plan: docs/superpowers/plans/2026-05-22-multitenant-settings-organization.md"
```

---

## Self-review du plan

**Spec coverage** ✅
- §5 Identité → Task 12
- §6 Coordonnées → Task 13
- §7 Territoire → Task 14 + composants Task 9/10/11
- §8 Data layer → Task 1 (RPC) + Task 2 (service/hook/cache)
- §9 Refacto helpers → Task 3 (orgBranding) + Task 4 (mapbox) + Task 5 (departments + getCoverageDepartments) + Task 6 (communesService)
- §10 Permissions → couvert dans Task 1 (RPC) + Task 7 (guard org_admin) + acceptance test Task 15
- §11 Edge cases → couverts inline dans chaque tab (validation, fallback Mapbox, etc.)
- §12 Acceptance → checklist dans Task 15
- §13 Files touchés → mappé dans "File Structure" ci-dessus
- §14 Migration notes → Task 1 + Task 15 (backfill)

**Placeholder scan** ✅ Aucun "TBD" ni "TODO" ni "à implémenter plus tard" dans les steps. Le seul "TODO" se trouve dans le commentaire de `mapbox.js maxBounds` ("à dériver des départements de couverture") qui est signalé comme dette explicite dans l'itération suivante (cohérent avec §15 de la spec).

**Type consistency** ✅
- `useOrgSettings()` retourne `{ settings, isLoading, error, save, isSaving }` — utilisé identiquement dans Task 12/13/14
- `orgSettingsService.getSettings/updateSettings` — signature cohérente
- `fetchCommunes(departmentCode)` — un seul paramètre, utilisé identiquement dans Task 6

**Scope check** ✅ Le plan reste centré sur Organisation. Aucune dérive vers Apparence / Notifications / Facturation. Les itérations futures sont listées en référence (§15 spec) mais pas attaquées ici.

---

## Execution Handoff

Plan complete et sauvegardé sur `docs/superpowers/plans/2026-05-22-multitenant-settings-organization.md`. Deux options d'exécution :

**1. Subagent-Driven (recommandé)** — je dispatch un fresh subagent par task, review entre chaque, itération rapide

**2. Inline Execution** — exécution dans cette session via executing-plans, batch avec checkpoints de review

Quelle approche tu préfères ?
