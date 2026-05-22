# Spec — Écran Settings → Organisation (multi-tenant)

> **Date** : 2026-05-22
> **Auteur** : Brainstorming Eric + Claude
> **Statut** : Validé pour implémentation
> **Itération** : 1/N — Organisation seulement. Apparence / Notifications / Facturation / Intégrations en specs séparées.

## 1. Contexte & motivation

Une 2ème entreprise (Cimaj) s'apprête à rejoindre l'instance Supabase Majord'home. La couche multi-tenant côté DB est prête à ~97% (cf. `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`) : RLS sur toutes les tables `majordhome.*`, vues `security_invoker`, storage `${orgId}/`, helper `_shared/auth.ts`, etc.

Côté UI, les ~30 champs de `core.organizations.settings` (branding, géo, intégrations) sont **consommés** par le code (`buildCompanyInfo`, `getOrgHeadquarters`, `getMapDefaultCenter`, etc.) mais **pas configurables via UI**. Aujourd'hui ils sont remplis par script SQL au provisioning.

Sur `/settings`, 4 tiles existent mais mènent à du vide : Organisation, Apparence, Notifications, Facturation. Cette spec couvre uniquement le tile **Organisation** comme première itération. Apparence/Notifications/Facturation et un éventuel nouveau tile Intégrations sont explicitement hors scope.

**Objectif** : permettre à l'owner d'une org (org_admin) de configurer 100% des champs `settings` nécessaires aux PDFs, aux emails et aux modules Territoire / GeoGrid via un écran `/settings/organization` à 3 onglets.

## 2. Scope

### Dans le scope
- Page `/settings/organization` (admin-only) avec sidebar gauche et 3 onglets : **Identité** / **Coordonnées** / **Territoire**
- ~25 champs `settings` exposés (cf. détails par onglet)
- 2 nouveaux champs DB : `settings.geogrid_target_department` (singleton, code département) + structuration claire de `settings.territoire_centers` (1ère entry = siège)
- Service `orgSettings.service.js` + hook `useOrgSettings` + cache key `orgSettingsKeys`
- RPC `public.org_update_settings(p_org_id, p_patch)` SECURITY DEFINER (org_admin only)
- Refacto helpers consommateurs : `orgBranding.js` (MAYER_DEFAULTS → NEUTRAL_DEFAULTS), `mapbox.js`, `communesService.js`
- Nouveau fichier `src/lib/departments.js` (liste statique 95 départements + DOM-TOM)

### Hors scope explicite
- Tiles **Apparence** (logo, couleurs, skeleton email), **Notifications**, **Facturation**, et nouveau tile **Intégrations** (GSC OAuth UI, flag Pennylane) — itérations suivantes
- Refacto `src/apps/artisan/components/mailing/resources.js` (fallback Mayer hardcodé) — itération Apparence
- Refacto `src/lib/zoneDetection.js` (fallback Mayer hardcodé, dette P0.13)
- Multi-sous-domaine par org (`cimaj.majordhome.app`) — `portal_url` reste une constante app
- Audit log des modifications de settings — YAGNI
- i18n — tout en français
- Backfill données Cimaj (clients, contrats…) — script SQL à part au moment du déploiement

## 3. Décisions UX validées en brainstorming

| Question | Décision |
|---|---|
| Persona cible | L'owner de chaque entreprise (UX accessible, langage métier, validation forte, **pas de jargon technique**) |
| Découverte | Édition libre tout de suite (pas de wizard, pas de bandeau "complétez votre profil") |
| Scope itération 1 | Organisation uniquement (3 onglets) |
| Sauvegarde | Bouton "Enregistrer" par onglet (cohérent avec PricingSettings) |
| Layout | Sidebar gauche (3 sections en menu vertical) + contenu à droite |
| Modèle territoire | 1 siège unique obligatoire + N antennes optionnelles |
| Fallbacks Mayer | **Fallback neutre** dans le code (MAYER_DEFAULTS → NEUTRAL_DEFAULTS) |
| Approche code | Hand-rolled (3 composants spécifiques), pas de schema-driver |

## 4. Architecture d'ensemble

```
/settings/organization
│
├─ <OrganizationSettings />              (page racine)
│   ├─ <Header />                        (titre + breadcrumb /settings → Organisation)
│   ├─ <SettingsSidebar />               (3 sections en menu vertical)
│   │    ▸ Identité
│   │    ▸ Coordonnées
│   │    ▸ Territoire
│   └─ <ActiveSection />                 (route param ou state local)
│        ├─ <IdentityTab />
│        ├─ <ContactTab />
│        └─ <TerritoryTab />
│
└─ Data layer (partagé entre les 3 onglets)
    └─ useOrgSettings()
        ├─ load  →  orgSettingsService.getSettings(orgId)
        │             →  SELECT settings FROM core.organizations
        │                (security_invoker, RLS scope user→org)
        └─ save  →  orgSettingsService.updateSettings(orgId, patch)
                      →  RPC public.org_update_settings(p_org_id, p_patch)
                         SECURITY DEFINER, check org_admin, shallow merge JSONB
```

**Choix structurants** :
- 1 page React, 3 sous-composants par onglet
- État local par onglet (form values + initial values) → permet save partielle + isolation
- `useOrgSettings()` retourne `{ settings, isLoading, save, isSaving }` ; `isDirty` est calculé localement dans chaque onglet
- RPC `org_update_settings` côté DB pour blinder le check `org_admin` (sinon `authenticated` pourrait écrire dans `core.organizations` via `.schema('core')`)
- Route guard `<RouteGuard resource="settings">` (déjà en place) + check `useAuth().isOrgAdmin` dans le composant racine

## 5. UI design — Onglet **Identité**

### Champs exposés

| Clé settings | Label UI | Type | Validation | Required | Notes |
|---|---|---|---|---|---|
| `brand_name` | Nom commercial | text | non-vide, ≤80 char | ✅ | Apparaît dans PDFs/emails |
| `legal_name` | Raison sociale | text | ≤120 char | – | Mention légale PDFs. Auto-fill avec brand_name si vide |
| `legal_form` | Forme juridique | select + saisie libre | – | – | Options : SAS, SAS à associé unique, SARL, EURL, SA, SCI, EI, Autre |
| `capital` | Capital social (€) | text | numérique, formaté "6 000" | – | Pour mention légale |
| `siret` | SIRET | text | regex `^\d{3}\s?\d{3}\s?\d{3}\s?\d{5}$` | – | Auto-format avec espaces tous les 3 chiffres |
| `rcs` | RCS | text | ≤80 char | – | Hint exemple "100 288 224 R.C.S. Albi" |
| `tva_intra` | N° TVA intracommunautaire | text | regex `^FR\s?\d{2}\s?\d{9}$` | – | Auto-upper case + auto-prefix "FR" |
| `insurance` | Mention assurance | textarea (2 lignes) | ≤200 char | – | Placeholder "Couvert par une assurance responsabilité civile professionnelle" |
| `rge_certifications` | Certifications RGE | **chips** | array<string>, ≤30 char/item, ≤20 items | – | Composant spécifique avec autocomplete |

### Composant spécifique — Chips RGE

- Autocomplete sur liste pré-définie : Qualibat, QualiPAC, QualiBois, QualiPV, QualiSol, QualiForage, Eco Artisan, RGE Études
- Saisie libre acceptée (Enter pour ajouter)
- × sur chaque chip pour retirer
- Cap : 20 items max, 30 char max par item

### Layout

3 sections visuelles (Branding / Mention légale / Qualifications) avec `<SectionTitle>` (déjà dans `FormFields.jsx`). Grilles responsive 1-2-3 colonnes. Bouton "Enregistrer" sticky en bas, "Annuler" revert au state initial.

```
┌─ Identité ─────────────────────────────────────────────────────────────┐
│  Branding                                                              │
│  [Nom commercial *] [Raison sociale]                                   │
│                                                                        │
│  Mention légale                                                        │
│  [Forme juridique] [Capital] [SIRET]                                   │
│  [RCS] [N° TVA intra]                                                  │
│  [Mention assurance (textarea)]                                        │
│                                                                        │
│  Qualifications                                                        │
│  [Chips RGE éditables]                                                 │
│                                                                        │
│  ─────                                                                 │
│  [Annuler]                                              [Enregistrer]  │
└────────────────────────────────────────────────────────────────────────┘
```

## 6. UI design — Onglet **Coordonnées**

### Champs exposés

| Clé settings | Label UI | Type | Validation | Required | Notes |
|---|---|---|---|---|---|
| `address` | Adresse | text | ≤200 char | ✅ | Rue + n° |
| `postal_code` | Code postal | text | regex `^\d{5}$` | ✅ | – |
| `city` | Ville | text | ≤80 char | ✅ | – |
| `phone` | Téléphone | text | format FR | ✅ | Auto-format `XX XX XX XX XX` à la frappe |
| `from_email` | Email expéditeur | text | regex email | ✅ | Hint "Cet email doit être validé sur Resend pour l'envoi de campagnes" |
| `reply_to` | Email de réponse | text | regex email | – | Si vide → fallback `from_email` |
| `website_url` | Site web | text | URL `https?://` | – | Auto-prefix `https://` |

### Champs NON exposés (décisions techniques)

- `domain` : calculé automatiquement côté `buildCompanyInfo()` via `from_email.split('@')[1]`. Pas de champ UI.
- `portal_url` : constante app `'https://majordhome.vercel.app'` tant qu'on n'a pas de sous-domaines par org. À exposer plus tard.
- `unsubscribe_landing_url` : reste avec fallback neutre dans le code, sera exposé dans le tile Apparence (itération suivante).

### Layout

3 sections (Siège social / Contact / Présence web). Cohérent avec Identité.

```
┌─ Coordonnées ──────────────────────────────────────────────────────────┐
│  Siège social                                                          │
│  [Adresse *]                                                           │
│  [Code postal *] [Ville *]                                             │
│                                                                        │
│  Contact                                                               │
│  [Téléphone *] [Email expéditeur *]                                    │
│  [Email de réponse (si différent)]                                     │
│  ℹ️ Laisse vide pour utiliser l'email expéditeur                       │
│                                                                        │
│  Présence web                                                          │
│  [Site web]                                                            │
│                                                                        │
│  ─────                                                                 │
│  [Annuler]                                              [Enregistrer]  │
└────────────────────────────────────────────────────────────────────────┘
```

## 7. UI design — Onglet **Territoire** (le plus riche)

### Structure de l'onglet — 4 sections

1. **Siège social** (obligatoire) — label, adresse géocodée, lat/lng, couleur (6 presets), emoji (5 presets), mini-map avec marker draggable
2. **Référence Google Business** (recommandé) — `google_place_id`, bouton "Trouver" qui ouvre le Place ID Finder Google
3. **Département principal** (recommandé) — `geogrid_target_department`, sélecteur 95 dépts + DOM-TOM, bouton "📍 Détecter depuis siège" (reverse geocoding)
4. **Antennes commerciales** (optionnel) — liste de cards éditables, [+ Ajouter une antenne], modal d'édition réutilise le formulaire siège

### Champs (1 par section)

| Section | Clé settings | Type | Required | Notes |
|---|---|---|---|---|
| Siège | `territoire_centers[1ère entry]` | object | ✅ | `{ lat, lng, label, color, emoji }` |
| Référence Google | `google_place_id` | text | – | Format libre (ex `ChIJ...`) |
| Département | `geogrid_target_department` | select | – | Code 2-3 char (`"81"`, `"2A"`, `"971"`) |
| Antennes | `territoire_centers[entries 2..N]` | object[] | – | Même shape que siège |

### Composant `<CenterEditor>` (réutilisé siège + antenne)

- Champ "Nom (affiché sur la carte)" — text
- Champ "Rechercher une adresse" — autocomplete Mapbox Geocoding
  - Au choix d'une suggestion : remplit lat/lng + ouvre mini-map centrée
  - Marker draggable pour fine-tune
  - Affichage `lat.toFixed(2), lng.toFixed(2)` en overlay
  - Fallback "Saisie manuelle" expandable (champs lat/lng numériques) si Mapbox down
- Palette **6 couleurs presets** : orange `#f97316`, red `#ef4444`, emerald `#10b981`, blue `#3b82f6`, violet `#8b5cf6`, amber `#f59e0b`
- **5 emojis presets** : 🏢 🏠 🏭 ⚡ 📍

### Composant `<AddressSearch>`

- Wrapper autour Mapbox Geocoding API (token via env `VITE_MAPBOX_TOKEN`, déjà en place)
- Debounce 300ms à la frappe
- Retourne `{ lat, lng, formatted_address, country_code, department_code }`
- Le `department_code` extrait depuis `address.context[].short_code` (locale `fr`) — sert au bouton "Détecter depuis siège"

### Composant `<DepartmentSelect>`

- Source : `src/lib/departments.js` (statique, 95 dépts + DOM-TOM)
- Format option : `"81 — Tarn"`, `"2A — Corse-du-Sud"`, `"971 — Guadeloupe"`
- Bouton adjacent "📍 Détecter depuis siège" : appelle `<AddressSearch>` reverse geocoding sur lat/lng du siège → pré-remplit

### Structure DB conservée

`settings.territoire_centers` reste un **objet keyed** (pas un array) pour compatibilité avec les helpers actuels.

```jsonc
{
  "territoire_centers": {
    "headquarters": { "lat": 43.91, "lng": 1.89, "label": "Siège Mayer", "color": "#f97316", "emoji": "🏢" },
    "branch_castres": { "lat": 43.6, "lng": 2.24, "label": "Antenne Castres", "color": "#ef4444", "emoji": "📍" }
  }
}
```

- Convention "1ère entry = siège" enforced par l'UI (le siège est toujours en `Object.values(...)[0]`).
- Les keys sont générées automatiquement (slugify du label) — l'owner ne les voit pas.
- `getOrgHeadquarters` (existant) lit déjà `Object.values(...)[0]`, RAS.

### `map_default_center` retiré du payload UI

Le helper `getMapDefaultCenter(settings)` est refactoré pour dériver automatiquement du siège (cf. section 9). L'owner ne saisit plus ce champ. La clé reste dans le JSONB pour permettre un override manuel via SQL si jamais nécessaire (cas rare).

## 8. Data layer

### 8.1 Service — `src/shared/services/orgSettings.service.js`

```javascript
export const orgSettingsService = {
  async getSettings(orgId) {
    const { data, error } = await supabase
      .schema('core')
      .from('organizations')
      .select('id, name, settings')
      .eq('id', orgId)
      .single();
    return { data: data?.settings ?? {}, error };
  },

  async updateSettings(orgId, patch) {
    const { data, error } = await supabase.rpc('org_update_settings', {
      p_org_id: orgId,
      p_patch: patch,
    });
    return { data, error };
  },
};
```

### 8.2 Hook — `src/shared/hooks/useOrgSettings.js`

```javascript
export function useOrgSettings() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: orgSettingsKeys.byOrg(orgId),
    queryFn: async () => {
      const { data, error } = await orgSettingsService.getSettings(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: (patch) => orgSettingsService.updateSettings(orgId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orgSettingsKeys.byOrg(orgId) });
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

`isDirty` est géré localement par chaque onglet (state form values + initial values, comparaison shallow).

### 8.3 Cache key — `src/shared/hooks/cacheKeys.js`

```javascript
// Convention P0.11 : orgId en 1er paramètre
export const orgSettingsKeys = {
  all: (orgId) => ['orgSettings', orgId],
  byOrg: (orgId) => [...orgSettingsKeys.all(orgId)],
};
```

### 8.4 RPC — `public.org_update_settings`

```sql
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
  -- 1. Membership check
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

  -- 2. Shallow merge JSONB (|| opérateur, 1er niveau seulement)
  --    Convention : l'UI envoie des patches plats au 1er niveau.
  --    Pour territoire_centers (objet imbriqué), l'UI envoie l'arbre entier.
  UPDATE core.organizations
  SET settings = COALESCE(settings, '{}'::jsonb) || p_patch,
      updated_at = NOW()
  WHERE id = p_org_id
  RETURNING settings INTO v_new_settings;

  RETURN v_new_settings;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.org_update_settings FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_update_settings TO authenticated;
```

**Justification du choix RPC** :
- Check `org_admin` centralisé (sinon il faut une policy RLS UPDATE par-champ, lourde)
- Pas d'écriture de colonnes sensibles (`id`, `name`, `created_at`) — la RPC ne touche que `settings`
- Pattern cohérent avec les autres RPCs SECURITY DEFINER du projet
- L'attaquant qui contourne le check JS frontend se prend un 403 propre côté DB

## 9. Refactoring des helpers consommateurs

### 9.1 `src/lib/orgBranding.js` — MAYER_DEFAULTS → NEUTRAL_DEFAULTS

```javascript
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
  domain: '',
  websiteUrl: '',
  portalUrl: 'https://majordhome.vercel.app',  // constante app
  unsubscribeLandingUrl: '',
  insurance: '',
  logoUrl: '',
  accentColor: '#64748b',
  rgeCertifications: [],
};

export function buildCompanyInfo(settings) {
  const s = settings || {};
  return {
    name: s.brand_name || NEUTRAL_DEFAULTS.name,
    legalName: s.legal_name || s.brand_name || NEUTRAL_DEFAULTS.legalName,
    domain: s.from_email?.split('@')[1] || NEUTRAL_DEFAULTS.domain,
    portalUrl: NEUTRAL_DEFAULTS.portalUrl,
    // ... reste
  };
}
```

**Effet pour Mayer** : ses settings sont déjà complets (migration P0.13), aucun fallback n'est utilisé → comportement identique.
**Effet pour Cimaj sans settings** : "Votre entreprise" + adresse vide + couleur slate + pas de logo.

### 9.2 `src/lib/mapbox.js` — `getMapDefaultCenter` dérive du siège

```javascript
import { getOrgHeadquarters } from './territoire-config';

const NEUTRAL_FRANCE_CENTER = [2.5, 46.5];

export function getMapDefaultCenter(settings) {
  // 1) override explicite (cas rare)
  const c = settings?.map_default_center;
  if (Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])) {
    return c;
  }
  // 2) déduit du siège (cas standard)
  const hq = getOrgHeadquarters(settings);
  if (hq) return [hq.lng, hq.lat];
  // 3) fallback neutre
  return NEUTRAL_FRANCE_CENTER;
}
```

### 9.3 `src/lib/territoire-config.js` — RAS

`getTerritoireCenters` et `getOrgHeadquarters` sont déjà neutres (P0.19). On confirme leur usage par l'UI Territoire.

La constante `TERRITOIRE_CONFIG.departements = ['31', '81', '82']` reste hardcodée pour l'instant. On ajoute un helper :

```javascript
export function getCoverageDepartments(settings) {
  const target = settings?.geogrid_target_department;
  if (target) return [target];
  return [];  // fallback neutre — l'UI affichera "Configure ton département principal"
}
```

**Pré-requis migration** : Mayer doit avoir `settings.geogrid_target_department = '81'` backfillé avant deploy, sinon sa carte CRM perd les codes postaux affichés (cf. section 14).

Itération future : transformer en multi-select avec champ dédié `settings.coverage_departments` (array).

### 9.4 `src/apps/artisan/components/geogrid/communesService.js` — paramétré

```javascript
// AVANT — département 81 hardcodé
const COMMUNES_API_URL = 'https://geo.api.gouv.fr/departements/81/communes';

// APRÈS — département en paramètre
export async function fetchCommunes(departmentCode) {
  if (!departmentCode || !/^(\d{2,3}|2[AB])$/.test(departmentCode)) {
    return { data: [], error: new Error('Département non configuré') };
  }
  const url = `https://geo.api.gouv.fr/departements/${departmentCode}/communes`;
  // ... reste du code (cache LocalStorage par dept, etc.)
}
```

Consumers (`BenchmarkLauncher.jsx` notamment) passent `useAuth().organization.settings.geogrid_target_department` à `fetchCommunes()`. Si null/undefined → message UI "Configure ton département principal dans Paramètres → Organisation → Territoire".

### 9.5 Nouveau fichier — `src/lib/departments.js`

```javascript
// Liste statique 95 départements métropolitains + Corse 2A/2B + DOM-TOM
export const FRENCH_DEPARTMENTS = [
  { code: '01', name: 'Ain' },
  { code: '02', name: 'Aisne' },
  // ... 95 entries
  { code: '2A', name: 'Corse-du-Sud' },
  { code: '2B', name: 'Haute-Corse' },
  { code: '971', name: 'Guadeloupe' },
  { code: '972', name: 'Martinique' },
  { code: '973', name: 'Guyane' },
  { code: '974', name: 'La Réunion' },
  { code: '976', name: 'Mayotte' },
];

export function getDepartmentByCode(code) {
  return FRENCH_DEPARTMENTS.find((d) => d.code === code) ?? null;
}

export function getDepartmentLabel(code) {
  const d = getDepartmentByCode(code);
  return d ? `${d.code} — ${d.name}` : '';
}
```

## 10. Permissions & sécurité

### Accès page
- `<RouteGuard resource="settings">` (déjà en place)
- Check `useAuth().isOrgAdmin` dans le composant racine → si pas admin, redirect `/settings` + toast "Accès réservé à l'administrateur"

### Écriture
- Front : appel uniquement via `supabase.rpc('org_update_settings', ...)`. Pas d'UPDATE direct sur `core.organizations`.
- DB : RPC vérifie `auth.uid() ∈ org_members WHERE role = 'org_admin'`. Renvoie 42501 sinon.
- GRANT : `REVOKE FROM PUBLIC, anon; GRANT TO authenticated`. Pas de service_role nécessaire.
- La RPC ne touche que `settings` — pas `id`, `name`, `created_at`.

### Validation inputs
- Tous les champs typés et validés côté client avant save (regex SIRET, email, URL)
- Pas de SQL dynamique, pas de templating string
- Chips RGE : cap ≤30 char/item, ≤20 items

### Concurrence
- Last-write-wins (acceptable au volume actuel)
- Pas de version/etag — à reconsidérer si admin team > 5 personnes

### Audit
- `core.organizations.updated_at` mis à jour par la RPC (en place)
- Pas de table d'audit dédiée — YAGNI

## 11. Edge cases

| Cas | Comportement |
|---|---|
| Org sans settings (Cimaj vide) | Écran s'ouvre avec placeholders, save crée le JSONB initial |
| Save réseau down | Toast erreur, state local préservé, pas d'invalidation cache, user peut retry |
| Geocoding Mapbox down | Message d'erreur sous le champ adresse, fallback saisie manuelle lat/lng |
| Suppression du siège | UI : bouton supprimer absent sur le siège. Si bypass : front bloque le save (siège présent obligatoire) |
| Doublons noms d'antennes | Autorisé (les noms ne sont pas des keys). Warning soft "Plusieurs antennes ont le même nom" |
| SIRET / TVA invalides | Inline error, save bloqué pour cet onglet |
| User non-admin tente d'accéder | Redirect `/settings` + toast |
| User non-admin appelle RPC directement | Réponse 403 propre |
| Switch d'org pendant édition | Cache change → re-fetch. Si dirty : confirm "Modifications non enregistrées" |
| Modification non-enregistrée + clic vers autre onglet | Confirm dialog |

## 12. Critères d'acceptance

1. Naviguer `/settings` → cliquer "Organisation" → l'écran s'ouvre sans 404
2. Pour Mayer : tous les champs sont pré-remplis avec ses valeurs actuelles
3. Pour Cimaj (org sans settings) : champs vides avec placeholders neutres
4. Pour Mayer : modifier `brand_name`, save, recharger → la valeur persiste
5. Pour Mayer : générer un PDF contrat après modif → utilise la nouvelle valeur
6. Onglet Coordonnées : SIRET avec mauvais format bloque le save avec error inline
7. Onglet Territoire : recherche adresse remplit lat/lng automatiquement
8. Onglet Territoire : ajouter puis supprimer une antenne, save, re-load → état correct
9. User `team_leader` qui tente d'accéder à `/settings/organization` → redirect
10. Modification non-enregistrée + clic vers un autre onglet → confirm dialog
11. Audit Supabase Advisor après ajout RPC → 0 nouvel ERROR (RPC bien REVOKE anon)
12. `npm run build` passe, `npm run lint:errors` n'introduit pas d'erreur nouvelle
13. Test E2E : Cimaj remplit son onglet Territoire → un scan GeoGrid utilise son `geogrid_target_department` (et non plus "81" hardcodé)

## 13. Fichiers touchés

| Fichier | Action |
|---|---|
| `src/apps/artisan/pages/settings/OrganizationSettings.jsx` | **Créer** — page racine + sidebar |
| `src/apps/artisan/pages/settings/organization/IdentityTab.jsx` | **Créer** |
| `src/apps/artisan/pages/settings/organization/ContactTab.jsx` | **Créer** |
| `src/apps/artisan/pages/settings/organization/TerritoryTab.jsx` | **Créer** |
| `src/apps/artisan/pages/settings/organization/components/RgeCertificationsInput.jsx` | **Créer** |
| `src/apps/artisan/pages/settings/organization/components/CenterEditor.jsx` | **Créer** |
| `src/apps/artisan/pages/settings/organization/components/AddressSearch.jsx` | **Créer** |
| `src/apps/artisan/pages/settings/organization/components/DepartmentSelect.jsx` | **Créer** |
| `src/shared/services/orgSettings.service.js` | **Créer** |
| `src/shared/hooks/useOrgSettings.js` | **Créer** |
| `src/shared/hooks/cacheKeys.js` | **Modifier** — ajout `orgSettingsKeys` |
| `src/apps/artisan/routes.jsx` | **Modifier** — ajout route `/settings/organization` |
| `src/lib/orgBranding.js` | **Modifier** — MAYER_DEFAULTS → NEUTRAL_DEFAULTS |
| `src/lib/mapbox.js` | **Modifier** — `getMapDefaultCenter` dérive du siège |
| `src/lib/territoire-config.js` | **Modifier** — ajout helper `getCoverageDepartments` |
| `src/lib/departments.js` | **Créer** — liste statique 95 dépts |
| `src/apps/artisan/components/geogrid/communesService.js` | **Modifier** — département en paramètre |
| `src/apps/artisan/components/geogrid/BenchmarkLauncher.jsx` | **Modifier** — passe settings.geogrid_target_department |
| (autres consumers de `communesService` si trouvés) | **Modifier** |
| `supabase/migrations/<timestamp>_org_update_settings.sql` | **Créer** — migration RPC |

## 14. Notes de migration

Au moment du déploiement, prévoir :
1. Appliquer la migration `org_update_settings` (RPC SECURITY DEFINER + REVOKE anon)
2. Vérifier que les settings Mayer contiennent bien les 22 champs branding (migration P0.13 déjà appliquée — confirmer)
3. **Backfill Mayer `geogrid_target_department = '81'`** — sinon sa carte CRM perd les codes postaux (cf. section 9.3 — fallback neutre `[]`)
4. **Backfill Mayer `territoire_centers`** — déjà fait par P0.13, confirmer présence du siège Gaillac
5. Backfill Cimaj : créer son entry `core.organizations.settings` avec au minimum `brand_name` (pour qu'elle ne voit pas "Votre entreprise" au 1er login). Script SQL séparé hors scope de cette spec.
6. Audit Supabase Advisor : confirmer 0 ERROR ajouté
7. Smoke test : ouvrir `/settings/organization` en tant qu'admin Cimaj → vérifier que tous les onglets fonctionnent

## 15. Itérations suivantes (référence)

Specs à venir, ordre indicatif :
1. **Apparence** — logo, accent_color, secondary_color, email_skeleton_html, email_tagline, unsubscribe_landing_url. Refacto `resources.js` (mailing) pour gérer fallback neutre.
2. **Intégrations** (nouveau tile) — flag Pennylane enabled, GSC OAuth UI ("Connecter Search Console"), token Pennylane par-org quand vault Supabase prêt.
3. **Notifications** — préférences user (à concevoir, pas vraiment multi-tenant).
4. **Facturation** — abonnement plateforme.
5. **Departments multi-sélection** — passer de singleton à array `coverage_departments` pour carte CRM.
6. **Refacto `zoneDetection.js`** — neutralisation du fallback Mayer hardcodé (dette P0.13).
