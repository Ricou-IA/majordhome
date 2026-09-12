# Référentiel équipements, tarifs et compétences — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer l'enum `majordhome.equipment_category` par un référentiel par org (catégorie → type), y accrocher les compétences techniciens par type × rôle, sans jamais couper le CTA « Trouver le créneau optimisé ».

**Architecture:** Deux migrations (M1 expansion additive, M2 contraction) répétées sur un cluster PostgreSQL local jetable alimenté par les données réelles (lecture seule) avant livraison ; moteur de tournées pur adapté (rôle + exigences type/catégorie) et recopié pour Deno ; front : services/hooks nouveaux (catégories, compétences), référentiel unique de libellés, écrans Settings (Catégories, grille de compétences), fiche client, certificat, pipeline.

**Tech Stack:** PostgreSQL 15 (Supabase) — cluster local PostgreSQL 18 (`initdb`/`postgres` scoop) pour la répétition ; React 18 + TanStack Query v5 ; Deno (edge `slots-propose`) ; `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-referentiel-equipements-tarifs-competences-design.md`

## Global Constraints

- Multi-tenant strict : toute table `majordhome.*` nouvelle = RLS + policies scopées org + `GRANT SELECT … TO service_role` + `REVOKE ALL … FROM anon` (les privilèges par défaut du schéma `majordhome` donnent `arwd` à `anon`/`authenticated`, aucun droit à `service_role`).
- Toute RPC SECURITY DEFINER : `REVOKE EXECUTE … FROM PUBLIC, anon` ; gardes en autorisation **positive** (`IS DISTINCT FROM`, `(x = ANY(...)) IS NOT TRUE`), `auth.uid() IS NULL` traité en première instruction.
- Vues `public.majordhome_*` : `WITH (security_invoker = true)`, miroirs simples (updatables) ; `CREATE OR REPLACE VIEW` n'ajoute une colonne qu'**en fin de liste** ; après un `DROP VIEW`, re-GRANT explicite.
- Moteur de tournées : `src/lib/tournee/*.js` = source unique, **jamais éditer** `supabase/functions/_shared/tournee/*` ; après modification : `npm run sync:tournee-engine` puis `node --test scripts/tournee/sync-engine.test.mjs`.
- Modules purs : aucun import React/Supabase/alias ; testés `node --test scripts/**/*.test.mjs`.
- Front : Tailwind only ; `logger` de `@lib/logger` (pas de `console.*` nouveau) ; cache keys centralisées (`cacheKeys.js`, `orgId` en 1ᵉʳ paramètre) ; `enabled: !!orgId`.
- Fichiers dette (`PricingSettings.jsx` 1055 LOC, `TeamManagement.jsx` 890, `pricing.service.js` 796, `appointments.service.js` 870, `clients.service.js` 1015) : **nouveau code dans des fichiers séparés**, jamais de décomposition embarquée.
- Codes de catégorie : `^[a-z0-9_]+$`, immuables après création. Codes de **types** : jamais réécrits à l'édition (le site vitrine en dépend).
- Sémantique compétences : **coché = compétent, rien coché = jamais proposé** ; `role` toujours explicite (`'entretien'` | `'pose'`), jamais de défaut.
- Chiffres de reprise attendus (prod 2026-09-12) : 7 catégories Mayer, 14/14 types résolus, 903 équipements catégorisés + 7 non catégorisés (`category_id IS NULL`), 84 compétences (3 techniciens × 14 types × 2 rôles), 0 violation de l'invariant « typé ⇒ catégorie du type ».

---

## Ordre de livraison

| Tranche | Tâches | Livrable |
|---|---|---|
| T0 | 1 | Cluster de répétition local (données réelles, lecture seule) |
| T1 | 2–3 | M1 écrite et répétée (comptages prouvés) |
| T2 | 4–7 | Moteur pur + edge : compétences par type × rôle |
| T3 | 8–10 | Services, hooks, référentiel de libellés |
| T4 | 11–15 | Écrans (Settings Tarification, Settings Équipe, fiche client, certificat, pipeline/mailing/portail) |
| T5 | 16 | M2 écrite et répétée (après M1, sur le même cluster) |
| T6 | 17–18 | Documentation, portes de qualité, commit |

Prod : M1 → déploiement front + edge dans la foulée → fenêtre ≥ 1 semaine → M2. Les migrations sont **appliquées par Eric** (MCP Supabase ou éditeur SQL) : cette session n'a pas de canal d'écriture vers la prod.

---

### Task 1: Cluster de répétition local (`scripts/migration-rehearsal/`)

**Files:**
- Create: `scripts/migration-rehearsal/README.md`
- Create: `scripts/migration-rehearsal/snapshot.mjs` — extrait de la prod (lecture seule, `exec_sql` SELECT + vues PostgREST) le sous-ensemble de données nécessaire → `scratch/snapshot.json` (ignoré par git)
- Create: `scripts/migration-rehearsal/schema.sql` — DDL minimal fidèle des tables touchées (types enum, colonnes, NOT NULL, FK, index, triggers `updated_at`), stub `auth.uid()`, rôles Supabase
- Create: `scripts/migration-rehearsal/run.mjs` — `initdb` + `postgres` sur un port libre, charge `schema.sql` + le snapshot, applique les migrations passées en argument, exécute un fichier d'assertions SQL, arrête le cluster
- Create: `scripts/migration-rehearsal/assert-m1.sql`, `assert-m2.sql` — assertions (`DO $$ … RAISE EXCEPTION … $$`)
- Modify: `.gitignore` — `scripts/migration-rehearsal/scratch/`

**Interfaces:**
- Produces: `node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local` ; `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/<fichier>.sql --assert scripts/migration-rehearsal/assert-m1.sql [--keep]`
- Le snapshot contient : `core.organizations`, `core.organization_members`, `core.profiles(id, app_role)`, `core.projects` (référencés par `equipments`/`clients`), `majordhome.organizations`, `team_members`, `pricing_zones`, `pricing_equipment_types`, `pricing_rates`, `equipments`, `clients(id, org_id, project_id, email)`.

- [ ] **Step 1: `schema.sql`** — types `majordhome.equipment_category` (11 valeurs, ordre prod), `equipment_status`, `contract_status` ; tables ci-dessus avec les colonnes réelles (cf. §2 de la spec et `scratchpad/prod/*`), plus `contracts`, `contract_equipments`, `contract_pricing_items`, `interventions` minimales (pour exécuter `process_web_entretien`) ; fonction `majordhome.handle_updated_at()` ; vues `public.majordhome_equipments`, `_pricing_equipment_types`, `_team_members`, `_client_equipment_kinds`, `majordhome.v_planning`, `majordhome.v_equipments_maintenance` (définitions prod) ; policies `pricing_zones`/`pricing_equipment_types`/`team_members` (texte prod) ; `CREATE ROLE anon/authenticated/service_role/baikal_reader NOLOGIN` ; `CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$ LANGUAGE sql STABLE;` ; `ALTER DEFAULT PRIVILEGES IN SCHEMA majordhome GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;` (reproduit l'ACL par défaut prod, pour que le `REVOKE` de M1 soit testé).
- [ ] **Step 2: `snapshot.mjs`** — lit `DST_URL`/`DST_KEY` du fichier `--env` ; pour chaque table, `POST /rest/v1/rpc/exec_sql` avec `select json_agg(t) from (select … from <table>) t` ; écrit `scratch/snapshot.json` `{ table: rows[] }` ; affiche les comptages.
- [ ] **Step 3: `run.mjs`** — `initdb -U postgres -A trust -E UTF8 scratch/pgdata` (si absent), `pg_ctl start -o "-p 55432 -c listen_addresses=localhost"`, `createdb rehearsal`, charge `schema.sql`, insère le snapshot (`INSERT … SELECT * FROM json_populate_recordset(null::majordhome.equipments, $1)` par table, ordre respectant les FK), applique chaque `--migration` via `psql -v ON_ERROR_STOP=1 --single-transaction`, puis `--assert`, puis `pg_ctl stop` (sauf `--keep`). Sortie : `OK`/`ECHEC` + les `RAISE NOTICE`.
- [ ] **Step 4: Vérifier le socle** — `node scripts/migration-rehearsal/snapshot.mjs --env …` puis `node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-baseline.sql` où `assert-baseline.sql` vérifie 910 équipements, 14 types, 7 team_members, enum à 11 valeurs. Attendu : `OK`.
- [ ] **Step 5: Commit** — `git add scripts/migration-rehearsal .gitignore && git commit -m "chore(db): cluster de répétition des migrations (données réelles, lecture seule)"`

### Task 2: M1 — expansion (`supabase/migrations/20260913_1_referentiel_equipements_expansion.sql`)

**Files:**
- Create: `supabase/migrations/20260913_1_referentiel_equipements_expansion.sql`

**Interfaces:**
- Produces (DB) : table `majordhome.equipment_categories`, vue `public.majordhome_equipment_categories` ; `pricing_equipment_types.category_id NOT NULL` (FK composite), `category` = code dénormalisé (trigger `pricing_equipment_types_sync_category_code`) ; `equipments.category_id` + trigger `equipments_sync_category` ; table `majordhome.team_member_skills`, vue `public.majordhome_team_member_skills`, RPC `public.team_member_set_skills(uuid, text, uuid[]) RETURNS SETOF uuid` ; vues `majordhome_pricing_equipment_types` et `majordhome_equipments` avec `category_id` en fin ; `majordhome_client_equipment_kinds.category` = code ; `process_web_entretien` sans enum.

- [ ] **Step 1: Écrire la migration** (sections 1→10 de la spec §7.1). Squelette des points non triviaux :

```sql
-- 1. Table + code immuable + RLS + vue
CREATE TABLE IF NOT EXISTS majordhome.equipment_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]+$'),
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  certificate_profile text NOT NULL DEFAULT 'generique'
    CHECK (certificate_profile IN ('combustion_bois','combustion_fossile','pac','ecs_thermo','ecs','aeraulique','generique')),
  default_vat_rate numeric(4,2) NOT NULL DEFAULT 20 CHECK (default_vat_rate >= 0 AND default_vat_rate < 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_categories_org_code_key UNIQUE (org_id, code),
  CONSTRAINT equipment_categories_id_org_key UNIQUE (id, org_id)
);
REVOKE ALL ON majordhome.equipment_categories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.equipment_categories TO authenticated;
GRANT SELECT ON majordhome.equipment_categories TO service_role;

-- 2. Semis dérivé des données (norm() = lower + non [a-z0-9_] → '_')
WITH corr(code, label, profile, vat) AS (VALUES
  ('poele','Poêle','combustion_bois',5.5), ('chaudiere_bois','Chaudière bois','combustion_bois',5.5),
  ('chaudiere_gaz','Chaudière gaz','combustion_fossile',10), ('chaudiere_fioul','Chaudière fioul','combustion_fossile',10),
  ('pac_air_air','PAC Air/Air','pac',5.5), ('pac_air_eau','PAC Air/Eau','pac',5.5), ('climatisation','Climatisation','pac',20),
  ('chauffe_eau_thermo','Chauffe-eau thermodynamique','ecs_thermo',10), ('ballon_ecs','Ballon ECS','ecs',10),
  ('vmc','VMC','aeraulique',10), ('energie','Énergie','generique',20)
), besoins AS (
  SELECT pet.org_id, regexp_replace(lower(btrim(COALESCE(NULLIF(pet.equipment_category,''), pet.category))), '[^a-z0-9_]', '_', 'g') AS code,
         min(pet.sort_order) AS sort_order
    FROM majordhome.pricing_equipment_types pet GROUP BY 1, 2
  UNION ALL
  SELECT p.org_id, e.category::text, 1000
    FROM majordhome.equipments e JOIN core.projects p ON p.id = e.project_id
   WHERE e.category <> 'autre' GROUP BY 1, 2
)
INSERT INTO majordhome.equipment_categories (org_id, code, label, sort_order, certificate_profile, default_vat_rate)
SELECT b.org_id, b.code, COALESCE(c.label, initcap(replace(b.code, '_', ' '))), min(b.sort_order),
       COALESCE(c.profile, 'generique'), COALESCE(c.vat, 20)
  FROM besoins b LEFT JOIN corr c ON c.code = b.code
 WHERE b.code <> ''
 GROUP BY b.org_id, b.code, c.label, c.profile, c.vat
ON CONFLICT (org_id, code) DO NOTHING;

-- 3. Types → category_id (échec fort si un type reste sans catégorie) puis famille → code
-- 4. Équipements : typés ← type ; non typés ← même code ; 'autre' → NULL
-- 5. Trigger equipments_sync_category (branche legacy enum, retirée en M2)
-- 6. team_member_skills + RLS (SELECT membre via majordhome.organizations.core_org_id) + vue + RPC
-- 7. Semis « tout coché » — SEULEMENT si l'org n'a encore aucune ligne (rejouable sans re-cocher)
-- 8. Vues (+ category_id en fin) ; client_equipment_kinds DROP/CREATE + GRANT
-- 9. process_web_entretien sans enum (INSERT sans `category`)
-- 10. RAISE NOTICE des comptages
```

- [ ] **Step 2: Répéter** — `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260913_1_referentiel_equipements_expansion.sql --assert scripts/migration-rehearsal/assert-m1.sql --keep`. `assert-m1.sql` vérifie : 7 catégories Mayer avec les profils/TVA attendus ; `count(*) … category_id IS NULL` = 0 sur les types ; 903 / 7 sur les équipements ; invariant typé = 0 ; 84 skills ; `pet.category` = code ; `has_function_privilege('anon', 'public.team_member_set_skills(uuid, text, uuid[])', 'EXECUTE')` = false ; `has_table_privilege('service_role', 'majordhome.equipment_categories', 'SELECT')` = true (idem skills) ; `has_table_privilege('anon', 'majordhome.team_member_skills', 'SELECT')` = false. Puis scénarios : (a) `SET request.jwt.claim.sub` = Eric → `team_member_set_skills(Antoine, 'entretien', [pac_air_air])` → 1 ligne ; (b) même appel avec un uuid étranger → `23514` ; (c) avec un membre non admin → `42501` ; (d) sans claim → `42501` ; (e) INSERT `equipments` avec un type → `category_id` dérivé et `category` = enum du code ; (f) INSERT sans type ni catégorie → `category = 'autre'`, `category_id NULL` ; (g) `process_web_entretien` nouveau client 1 poêle → équipement typé + catégorisé, contrat créé ; (h) rejouer M1 → aucune erreur, mêmes comptages.
- [ ] **Step 3: Rejouer M1 une 2ᵉ fois sur le même cluster** — attendu : aucun changement de comptage (idempotence).
- [ ] **Step 4: Commit** — `git commit -m "feat(db): référentiel catégories par org + compétences par type (M1 expansion, répétée localement)"`

### Task 3: Assertions et scénarios M1 (`assert-m1.sql`) — fait dans la tâche 2, listé pour traçabilité

### Task 4: Module pur `competences.js` + `techniciensEligibles(contrat, techniciens, role)`

**Files:**
- Create: `src/lib/tournee/competences.js`
- Modify: `src/lib/tournee/proposer-contrat.js`
- Test: `scripts/tournee/competences.test.mjs`, `scripts/tournee/proposer-contrat.test.mjs`

**Interfaces:**
- `SKILL_ROLES = ['entretien', 'pose']`, `estRoleValide(role) → boolean`
- `contrat.exigences: Array<{ typeId: string } | { categoryId: string }>` ; `technicien.competences: { entretien: string[], pose: string[] }` ; `typesParCategorie: Map<string, string[]>` (categoryId → typeIds)
- `techniciensEligibles(contrat, techniciens, role, { typesParCategorie })` ; `journeesCandidates({ …, role, typesParCategorie })` ; `proposerPourContrat({ …, role, typesParCategorie })` — `role` invalide → `throw new Error('role_competence_requis')`.

- [ ] **Step 1: Tests** (`competences.test.mjs`, `proposer-contrat.test.mjs`) : rôle absent → exception ; technicien à zéro case → jamais éligible même sans exigence ; exigence type satisfaite / non satisfaite ; exigence catégorie satisfaite par un type de la catégorie ; contrat sans équipement → tout technicien avec ≥ 1 case ; `raisonsRejet.competence` compte les non compétents ; `journeesCandidates` filtre par rôle.
- [ ] **Step 2: Implémenter** :

```js
// src/lib/tournee/competences.js
export const SKILL_ROLES = ['entretien', 'pose'];
export const estRoleValide = (role) => SKILL_ROLES.includes(role);
```

```js
// proposer-contrat.js
export function techniciensEligibles(contrat, techniciens, role, { typesParCategorie } = {}) {
  if (!estRoleValide(role)) throw new Error('role_competence_requis');
  const exigences = contrat?.exigences || [];
  const parCategorie = typesParCategorie || new Map();
  return (techniciens || []).filter((t) => {
    const types = new Set(t.competences?.[role] || []);
    if (types.size === 0) return false;                     // rien coché = jamais proposé
    return exigences.every((ex) => ex.typeId
      ? types.has(ex.typeId)
      : (parCategorie.get(ex.categoryId) || []).some((id) => types.has(id)));
  });
}
```

- [ ] **Step 3: `node --test scripts/tournee/competences.test.mjs scripts/tournee/proposer-contrat.test.mjs`** → PASS.
- [ ] **Step 4: Commit** — `feat(tournees): éligibilité par type × rôle (coché = compétent)`

### Task 5: Loaders (`chargerJournees` lit les compétences, `chargerContrat` calcule les exigences)

**Files:**
- Modify: `src/lib/tournee/loaders.js`, `src/lib/tournee/duree.js` (JSDoc seulement)
- Test: `scripts/tournee/loaders.test.mjs`, `scripts/tournee/duree.test.mjs`

**Interfaces:**
- `chargerJournees` : lit `majordhome_team_member_skills` (`team_member_id, equipment_type_id, role`) pour les membres chargés → `techniciens[].competences = { entretien: [...], pose: [...] }` (plus de `specialties`).
- `chargerContrat` : types `select('id, category_id, duration_base_minutes, duration_per_extra_unit_minutes, included_units')`, catégories `majordhome_equipment_categories` `select('id, code, label')` filtrées `org_id`, équipements `select('id, category_id, unit_count, equipment_type_id')` → `{ …, exigences, categories: [{ id, code, label }], typesParCategorie: Map }` ; replis `construireFallbacks` clés `category_id`.

- [ ] **Step 1: Tests** (mock client supabase chaînable comme dans `loaders.test.mjs` existant) : skills agrégées par rôle ; membre sans ligne → `{ entretien: [], pose: [] }` ; `chargerContrat` : équipement typé → `{ typeId }`, non typé catégorisé → `{ categoryId }`, non catégorisé → rien ; `typesParCategorie` construit depuis les types ; `categories` déduplique.
- [ ] **Step 2: Implémenter** ; `dureeContrat`/`construireFallbacks` : renommer la clé lue `eq.category` → `eq.category_id` (tests `duree.test.mjs` adaptés).
- [ ] **Step 3: `node --test scripts/tournee/*.test.mjs`** → PASS.
- [ ] **Step 4: Commit** — `feat(tournees): loaders — compétences par rôle, exigences type/catégorie`

### Task 6: Sync Deno + edge `slots-propose` (rôle `entretien`)

**Files:**
- Modify: `supabase/functions/slots-propose/index.ts` — `journeesCandidates({ …, role: 'entretien', typesParCategorie: contrat.typesParCategorie })`, `proposerPourContrat({ …, role: 'entretien', typesParCategorie: contrat.typesParCategorie })` ; réponse `contrat.categories` (objets `{ id, code, label }`), `contrat.exigences` non exposé.
- Generated: `supabase/functions/_shared/tournee/*` via `npm run sync:tournee-engine`

- [ ] **Step 1: `npm run sync:tournee-engine`** puis `node --test scripts/tournee/sync-engine.test.mjs` → PASS.
- [ ] **Step 2: Éditer l'edge** ; `deno check supabase/functions/slots-propose/index.ts` si Deno est disponible localement, sinon relecture stricte (l'edge est redéployée par Eric via MCP).
- [ ] **Step 3: Commit** — `feat(edge): slots-propose — compétences par type, rôle entretien`

### Task 7: Helper pur `src/lib/equipmentReferential.js`

**Files:**
- Create: `src/lib/equipmentReferential.js`
- Test: `scripts/equipment-referential.test.mjs`

**Interfaces:**
```js
export const CERTIFICATE_PROFILES = [
  { value: 'combustion_bois', label: 'Combustion bois', description: 'ramonage, brûleur, cendres, mesures de combustion' },
  { value: 'combustion_fossile', label: 'Combustion gaz / fioul', description: 'ramonage, brûleur, mesures de combustion' },
  { value: 'pac', label: 'PAC / climatisation', description: 'F-Gaz, mesures PAC' },
  { value: 'ecs_thermo', label: 'Chauffe-eau thermodynamique', description: 'F-Gaz, mesures ECS' },
  { value: 'ecs', label: 'Eau chaude sanitaire', description: 'mesures ECS' },
  { value: 'aeraulique', label: 'Aéraulique (VMC)', description: 'mesures aérauliques' },
  { value: 'generique', label: 'Générique', description: 'contrôles et nettoyage seulement' },
];
export const LABEL_NON_CATEGORISE = 'Non catégorisé';
export function indexReferentiel({ categories = [], equipmentTypes = [] })
  // → { categoriesById: Map, categoriesByCode: Map, typesById: Map, typesParCategorie: Map<catId, type[]>,
  //     categoriesOrdonnees: category[], labelCategorie(id), labelType(id), profilParCode(code) → profile|'generique',
  //     tvaParCode(code) → number|null }
export function grouperTypesParCategorie(index, types)  // → [{ category, types }] triés (sort_order, label)
export function libelleEquipement(equipement, index)     // → type.label || category.label || 'Équipement'
export function typeIdsParCategorie(index)               // → Map<catId, typeId[]> (forme attendue par le moteur)
```

- [ ] **Step 1: Tests** (tri, catégorie manquante → `LABEL_NON_CATEGORISE`, `profilParCode` inconnu → `'generique'`, `grouperTypesParCategorie` n'omet pas un type dont la catégorie est inactive).
- [ ] **Step 2: Implémenter**, `node --test scripts/equipment-referential.test.mjs` → PASS.
- [ ] **Step 3: Commit** — `feat(lib): référentiel équipements pur (index, libellés, regroupement)`

### Task 8: Services (`equipmentCategories.service.js`, `teamSkills.service.js`, adaptations)

**Files:**
- Create: `src/shared/services/equipmentCategories.service.js`
- Create: `src/shared/services/teamSkills.service.js`
- Modify: `src/shared/services/pricing.service.js` (`createEquipmentType`/`updateEquipmentType` : payload passe `category_id` ; rien d'autre), `equipments.service.js` (plus de `category`), `contracts.service.js` (suppression `_pricingCodeToEquipmentCategory`, `createEquipmentsFromPricingItems` sans `category`), `clients.service.js` (suppression `EQUIPMENT_CATEGORIES`, filtre `equipmentCategory`, `getPricingEquipmentTypes(orgId)` filtre org), `interventions.service.js` (`equipment_category_id`), `appointments.service.js` (plus de `p_specialties`)

**Interfaces:**
```js
// equipmentCategories.service.js — toutes via la vue majordhome_equipment_categories, { data, error }
getCategories(orgId, { activeOnly = true } = {})   // order sort_order, label
createCategory(orgId, payload)                      // payload sans org_id ; retourne la ligne
updateCategory(id, payload)                         // jamais `code` (immuable) : le service le retire du payload
deleteCategory(id)                                  // FK RESTRICT → error 23503 remontée telle quelle
// teamSkills.service.js
getTeamMemberSkills(teamMemberIds)                  // vue majordhome_team_member_skills .in('team_member_id', ids) → rows
setTeamMemberSkills(teamMemberId, role, equipmentTypeIds) // rpc team_member_set_skills → { data: uuid[], error }
```

- [ ] **Step 1: Écrire les deux services** (pattern `withErrorHandling` de `serviceHelpers.js`, `logger`).
- [ ] **Step 2: Adapter les services existants** — `equipments.service.addEquipment/updateEquipment` n'envoient plus `category` (description d'activité : `${brand} ${model}`.trim() || 'Équipement') ; `contracts.service.createEquipmentsFromPricingItems` : INSERT `{ project_id, equipment_type_id, unit_count, … }` sans `category` ; retirer `_pricingCodeToEquipmentCategory` ; `clients.service` : retirer `EQUIPMENT_CATEGORIES` et le bloc `equipmentCategory` (lignes ~117 et ~195-205) ; `getPricingEquipmentTypes(orgId)` ajoute `.eq('org_id', orgId)` ; `interventions.service` : `equipment_category_id = eqMap[…].category_id` ; `appointments.service.setTeamMemberRoutingSettings` : plus de `specialties` (signature `{ dailyWorkMinutes, includeInRouting }`).
- [ ] **Step 3: `npm run lint:errors`** → 0 erreur.
- [ ] **Step 4: Commit** — `feat(services): catégories d'équipement, compétences par type ; plus d'enum dérivé côté front`

### Task 9: Hooks (`cacheKeys`, `usePricing`, `useEquipmentReferential`, `useTeamSkills`, `useAppointments`, `useClients`)

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` — `pricingKeys.categories: (orgId, activeOnly) => [...pricingKeys.all(orgId), 'categories', activeOnly]` ; nouvelle famille `teamSkillKeys = { all: (orgId) => ['teamSkills', orgId], byMembers: (orgId, ids) => [...teamSkillKeys.all(orgId), 'members', ids] }`
- Modify: `src/shared/hooks/usePricing.js` — `usePricingData` : query supplémentaire `pricingKeys.categories(orgId, true)` → `categories` ; `usePricingAdmin` : query `pricingKeys.categories(orgId, false)` → `categories` + mutations `createCategory`, `updateCategory`, `deleteCategory` (`onSuccess: invalidateAll` — invalide aussi `pricingKeys.categories(*)` puisque préfixe `pricingKeys.all(orgId)`)
- Create: `src/shared/hooks/useEquipmentReferential.js` — `useEquipmentReferential()` → `{ categories, equipmentTypes, index, isLoading, error }` (catégories actives via `pricingKeys.categories(orgId, true)`, types actifs via `clientKeys.pricingTypes(orgId)` + `clientsService.getPricingEquipmentTypes(orgId)`, `index = useMemo(indexReferentiel)`)
- Create: `src/shared/hooks/useTeamSkills.js` — `useTeamSkills(orgId, teamMemberIds)` → `{ skillsByMember: Map<memberId, { entretien: Set, pose: Set }>, isLoading }` ; `useSetTeamMemberSkills(orgId)` → `{ setSkills({ teamMemberId, role, equipmentTypeIds }), isSaving }` (onSuccess : `invalidateQueries(teamSkillKeys.all(orgId))`)
- Modify: `src/shared/hooks/useAppointments.js` — `useSetTeamMemberRouting` : plus de `specialties` (mutation + fusion de cache)
- Modify: `src/shared/hooks/useClients.js` — retirer `equipmentCategory` du filtre par défaut

- [ ] **Step 1: Écrire / adapter** selon les interfaces ci-dessus.
- [ ] **Step 2: `npm run lint:errors`** → 0 erreur ; `npx vite build` → OK.
- [ ] **Step 3: Commit** — `feat(hooks): référentiel équipements, compétences techniciens`

### Task 10: Settings → Tarification : onglet Catégories + modale type

**Files:**
- Create: `src/apps/artisan/pages/settings/pricing/CategoriesTab.jsx` — `CategoriesPanel({ admin })` : tableau (ordre · code · libellé · gabarit · TVA · actif · nb types) + `CategoryModal` (code immuable après création, select gabarit depuis `CERTIFICATE_PROFILES` avec description, TVA `5.5/10/20` + saisie libre, actif, ordre). Suppression : `admin.deleteCategory` ; erreur `23503` → toast « Des types ou équipements utilisent cette catégorie : désactivez-la plutôt ».
- Modify: `src/apps/artisan/pages/settings/PricingSettings.jsx` — `TABS` : `{ key: 'categories', label: 'Catégories', icon: Layers }` avant `equipmentTypes` ; rendu `<CategoriesPanel admin={admin} />` ; `EquipmentTypesPanel` : colonne Catégorie = `admin.categories.find(c => c.id === type.category_id)?.label` ; `EquipmentTypeModal` : champ `category_id` **obligatoire** (select des catégories actives, message si aucune → lien onglet Catégories), payload `category_id` (plus `category`), et **le code n'est envoyé qu'à la création** (`code: form.code.trim()` sans `toUpperCase()`, absent du payload en édition, champ désactivé en édition) ; suppression de la constante `EQUIPMENT_CATEGORIES`.

- [ ] **Step 1: Implémenter** (mêmes helpers `ToolbarHeader`, `ActionButtons`, `ModalShell` — les exporter depuis `PricingSettings.jsx` ou les dupliquer dans `pricing/CategoriesTab.jsx` ? → **les extraire** dans `pages/settings/pricing/ui.jsx` (export nommé) et les importer des deux côtés, sans autre modification).
- [ ] **Step 2: `npx vite build` + `npm run lint:errors`**.
- [ ] **Step 3: Commit** — `feat(settings): catégories d'équipement par org ; catégorie obligatoire sur les types`

### Task 11: Settings → Équipe : grille de compétences

**Files:**
- Create: `src/apps/artisan/pages/settings/team/SkillsPanel.jsx` — modale/drawer `SkillsPanel({ teamMember, onClose })` : `useEquipmentReferential()` + `useTeamSkills(orgId, [teamMember.id])` + `useSetTeamMemberSkills(orgId)` ; lignes = types actifs groupés par catégorie (`grouperTypesParCategorie`), colonnes Entretien / Pose ; case « tout » par catégorie × colonne et par colonne ; chaque coche → `setSkills({ teamMemberId, role, equipmentTypeIds: nouvelEnsemble })` ; erreur → toast + retour visuel (le cache n'est mis à jour qu'après succès) ; bandeau « aucune compétence Entretien cochée : jamais proposé en tournée » ; mention Pose « pas encore utilisée par l'application ».
- Modify: `src/apps/artisan/pages/settings/TeamManagement.jsx` — colonne Compétences : pour un `teamMember` de `role === 'technician'` : bouton « Compétences » + compteur `Entretien n/N · Pose n/N` (via `useTeamSkills` sur tous les techniciens de la page) + pastille d'avertissement si `entretien.size === 0` ; autres rôles : « — » ; retirer `SpecialtiesEditor`, `specialtyLabel`, `handleSpecialtiesChange`, `onSpecialtiesChange` ; en-tête de colonne « Compétences — types d'équipement, par rôle ».
- Delete: `src/apps/artisan/pages/settings/team/SpecialtiesEditor.jsx`, `src/apps/artisan/pages/settings/team/specialtyLabels.js`

- [ ] **Step 1: Implémenter.**
- [ ] **Step 2: `npx vite build` + `npm run lint:errors`.**
- [ ] **Step 3: Commit** — `feat(equipe): grille de compétences par type × rôle (coché = compétent)`

### Task 12: Fiche client — `EquipmentFormModal`, `EquipmentList`

**Files:**
- Modify: `src/apps/artisan/components/clients/EquipmentFormModal.jsx` — `useEquipmentReferential()` à la place de `usePricingEquipmentTypes` ; optgroups via `grouperTypesParCategorie(index)` (libellé de catégorie) ; `handleSubmit` n'envoie plus `category` ; suppression de `CATEGORY_LABELS`.
- Modify: `src/apps/artisan/components/clients/EquipmentList.jsx` — libellé via `libelleEquipement(eq, index)` ; sous-titre catégorie `index.labelCategorie(eq.category_id)` ; tag « type à renseigner » si `!eq.equipment_type_id` ; retirer l'import `EQUIPMENT_CATEGORIES`.
- Modify: `src/apps/artisan/pages/client-detail/*` si un onglet passe `category` au modal (vérifier par grep `category:` dans `client-detail/`).

- [ ] **Step 1: Implémenter, build, lint.**
- [ ] **Step 2: Commit** — `feat(clients): équipements groupés par catégorie de l'org, type à renseigner visible`

### Task 13: Certificat — profils

**Files:**
- Modify: `src/apps/artisan/components/certificat/constants.js` — `SECTIONS_PAR_PROFIL` (7 clés, valeurs = lignes actuelles regroupées, `tvaDefaut` retiré → vient de la catégorie) ; `getNettoyageItems(profil)`, `getSteps(profil)`, `getTypeDocument(profil)` ; suppression de `EQUIPMENT_CATEGORY_LABELS` et `SECTIONS_PAR_EQUIPEMENT`.
- Modify: `CertificatWizard.jsx` — `const { index } = useEquipmentReferential()` ; `profil = index.profilParCode(formData.equipement_type)` ; TVA initiale `index.tvaParCode(code) ?? 20` ; bandeau si `formData.equipement_type` n'est pas un code connu (« catégorie inconnue de l'organisation : gabarit générique ») ; `steps = getSteps(profil)` ; `type_document: getTypeDocument(profil)`.
- Modify: `steps/StepEquipementType.jsx` — options = `index.categoriesOrdonnees` (value = `code`, label) ; équipement détecté : `index.labelCategorie(equipment.category_id)` ; parc client : `onChange('equipement_type', index.categoriesById.get(eq.category_id)?.code || '')`.
- Modify: `steps/StepInfosGenerales.jsx`, `steps/StepSignature.jsx`, `CertificatPDF.jsx`, `entretiens/CertificatEquipmentRow.jsx`, `pages/client-detail/TabInterventions.jsx` — libellé par `index.labelCategorie`/`categoriesByCode` ; le PDF reçoit `profil` et `libelleType` dans `data` (résolus par l'appelant avant `generateCertificatPdfBlob`).

- [ ] **Step 1: Implémenter** ; vérifier par grep qu'aucun `SECTIONS_PAR_EQUIPEMENT` / `EQUIPMENT_CATEGORY_LABELS` ne subsiste.
- [ ] **Step 2: build + lint.**
- [ ] **Step 3: Commit** — `feat(certificat): gabarit par profil de catégorie, TVA par défaut de la catégorie`

### Task 14: Pipeline, mailing, portail, planning — vocabulaire unique

**Files:**
- Modify: `components/pipeline/LeadStatusConfig.js` (retirer `EQUIPMENT_CATEGORY_LABELS`), `LeadFormSections.jsx`, `components/devis/CreateLeadFromQuoteModal.jsx`, `components/pipeline/FicheTechniquePdf.jsx`, `components/mailing/resources.js`, `components/mailing/SegmentBuilderDrawer.jsx` — regroupement par `grouperTypesParCategorie(index)` (les composants React via `useEquipmentReferential()` ; `resources.js` et `FicheTechniquePdf` reçoivent `categories` en paramètre depuis leur appelant, qui a le hook).
- Modify: `src/apps/client/constants.js` (retirer `EQUIPMENT_CATEGORY_LABELS`), `pages/ClientEquipements.jsx`, `pages/ClientContrat.jsx` — libellé via `useEquipmentReferential()`.
- Modify: `components/planning/TechnicianSelect.jsx` — retirer l'affichage `member.specialties`.

- [ ] **Step 1: Implémenter** ; grep final : `grep -rn "EQUIPMENT_CATEGORY_LABELS\|EQUIPMENT_CATEGORIES\|CATEGORY_LABELS\|specialties\|equipment_category\b" src` → uniquement les usages du référentiel.
- [ ] **Step 2: build + lint + `npm run audit:dead-code`** (seul `sequence.js` reste).
- [ ] **Step 3: Commit** — `refactor(front): un seul vocabulaire d'équipement, alimenté par le référentiel de l'org`

### Task 15: Fenêtre de transition — compatibilité vérifiée

- [ ] Vérifier par lecture que le front livré ne lit plus `equipments.category`, `pet.equipment_category`, `team_members.specialties` (grep), et n'écrit plus `category` sur `equipments` ni `pet` : c'est la condition pour que M2 soit sûre.

### Task 16: M2 — contraction (`supabase/migrations/20260920_1_referentiel_equipements_contraction.sql`)

**Files:**
- Create: `supabase/migrations/20260920_1_referentiel_equipements_contraction.sql`
- Modify: `scripts/migration-rehearsal/assert-m2.sql`

- [ ] **Step 1: Écrire** : DROP `v_planning`, `v_equipments_maintenance` ; DROP VIEW `majordhome_equipments` → `ALTER TABLE equipments DROP COLUMN category` → `DROP TYPE majordhome.equipment_category` → recréation de la vue (mêmes colonnes moins `category`, `category_id` en fin) + GRANT ; trigger `equipments_sync_category` sans branche legacy ; DROP VIEW `majordhome_pricing_equipment_types` → DROP COLUMN `equipment_category` → recréation + GRANT ; DROP VIEW `majordhome_team_members` → DROP COLUMN `specialties` → recréation + GRANT ; `DROP FUNCTION team_member_set_routing_settings(uuid, integer, boolean, text[])` + recréation à 3 paramètres (`RETURNS TABLE(daily_work_minutes integer, include_in_routing boolean)`, mêmes gardes, REVOKE PUBLIC/anon, GRANT authenticated).
- [ ] **Step 2: Répéter M1 puis M2** sur un cluster frais : `run.mjs --migration …expansion.sql --migration …contraction.sql --assert assert-m2.sql`. Assertions : `pg_type` sans `equipment_category` ; colonnes absentes ; vues présentes avec `security_invoker` ; `has_table_privilege('authenticated','public.majordhome_equipments','SELECT')` ; RPC à 3 paramètres exécutable par `authenticated`, pas par `anon` ; INSERT équipement typé → `category_id` dérivé ; `process_web_entretien` fonctionne.
- [ ] **Step 3: Commit** — `feat(db): contraction du référentiel (drop enum, famille, specialties) — M2 répétée`

### Task 17: Documentation

- [ ] `docs/DATABASE.md` : `equipment_categories`, `team_member_skills`, `equipments.category_id`, `pricing_equipment_types.category_id` + `category` (code dénormalisé), retrait de l'enum et de `specialties` (mention « après M2 »).
- [ ] `docs/MODULE_ENTRETIENS.md` : règle d'éligibilité par type × rôle, sémantique coché/non coché, replis.
- [ ] `.claude/proposed-updates.md` : entrée PENDING « Référentiel équipements & Tarification » (texte prêt à intégrer dans CLAUDE.md § Module Tarification), sans toucher CLAUDE.md.
- [ ] Spec : statut « validée par Eric le 2026-09-12 ; implémentation : ce plan ».
- [ ] Commit — `docs: référentiel équipements — DATABASE, MODULE_ENTRETIENS, proposition CLAUDE.md`

### Task 18: Portes de qualité finales

- [ ] `node --test scripts/tournee/*.test.mjs scripts/equipment-referential.test.mjs` → PASS.
- [ ] `npm run build` → OK ; `npm run lint:errors` → 0 ; `npm run audit:dead-code` → seul `sequence.js` (connu).
- [ ] Rapport à Eric : commits, ce qui est prouvé (répétition M1/M2, tests), ce qui reste à faire par lui (appliquer M1, déployer edge + front, fenêtre, M2), les commandes de contrôle SQL.
