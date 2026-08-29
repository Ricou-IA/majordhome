# Optimisation des tournées d'entretien — Plan d'implémentation (tranches 1 & 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Proposer, pour une journée creuse d'un technicien, les entretiens dus qui coûtent le moins de trajet à insérer — et permettre de les poser en un geste.

**Architecture:** Un moteur JavaScript **pur** (`src/lib/tournee/`, aucun import de React/Supabase/alias) porte toutes les règles : durée d'intervention, éligibilité saisonnière, séquencement optimal de la journée, coût d'insertion d'un candidat. Les services l'alimentent en données (contrats dus, trajets Mapbox mis en cache) et l'UI l'appelle. Le moteur sera réutilisé tel quel par les edge functions des tranches 3-4, d'où l'exigence de pureté.

**Tech Stack:** React 18 + Vite, TanStack Query v5, Supabase (PostgreSQL), Mapbox Matrix API, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md`

## Global Constraints

- **Pureté du moteur** : les fichiers de `src/lib/tournee/` n'importent que d'autres modules purs, avec extension `.js` explicite (contrainte Deno). Jamais `@/`, React, Supabase.
- **Multi-tenant** : toute mutation Supabase filtre explicitement `org_id`. Toute nouvelle table `majordhome.*` a RLS activée + policies scopées `org_id` + `GRANT SELECT … TO service_role` si lue via une vue publique. Toute vue `public.majordhome_*` est créée `WITH (security_invoker = true)`.
- **RPC** : toute nouvelle fonction `SECURITY DEFINER` reçoit `REVOKE EXECUTE … FROM PUBLIC, anon` — `PUBLIC` obligatoire, sinon le REVOKE ne retire rien. Gardes en autorisation positive : `IF (autorisé) IS NOT TRUE THEN refuser`.
- **Cache keys** : convention P0.11, `all: (orgId) => [domain, orgId]`, orgId en 1ᵉʳ paramètre partout, déclarées dans `src/shared/hooks/cacheKeys.js`.
- **Services** : retournent `{ data, error }`, ne throwent jamais au caller ; `{ error }` destructuré sur toute mutation.
- **Logs** : `import { logger } from '@lib/logger'`, jamais `console.*`.
- **Lint** : `npm run lint` doit rester à 0 warning (`--max-warnings 0`).
- **Temps** : toutes les heures du moteur sont des **minutes depuis minuit** (entier). Aucune `Date` dans le moteur.
- **Org Mayer** : core `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`, majordhome via `getMajordhomeOrgId()`.

## Périmètre

Ce plan couvre les **tranches 1 et 2** de la spec. Les tranches 3 (réservation web) et 4 (cron mail) sont des sous-systèmes indépendants et feront l'objet de plans séparés — les tables `entretien_booking_tokens` et les colonnes `contracts.relance_count` / `last_relance_at` ne sont donc **pas** créées ici (YAGNI).

## File Structure

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/20260829_1_tournees_socle.sql` | Colonnes durée + budget + `travel_cache` + seed Mayer |
| `src/lib/tournee/duree.js` | Durée d'un équipement, d'un contrat, construction des fallbacks |
| `src/lib/tournee/eligibilite.js` | Score maturité × saison, fenêtre anniversaire |
| `src/lib/tournee/geo.js` | Filtre de proximité à vol d'oiseau, barycentre |
| `src/lib/tournee/sequence.js` | Séquencement exact d'une journée (budget, amplitude, pause, fenêtres promises) |
| `src/lib/tournee/insertion.js` | Coût marginal d'insertion d'un candidat |
| `scripts/tournee/*.test.mjs` | Tests des cinq modules ci-dessus |
| `src/shared/services/trajets.service.js` | Mapbox Matrix + cache `travel_cache` |
| `src/shared/services/tournees.service.js` | Contrats dus, journées de l'horizon, assemblage |
| `src/shared/hooks/useTournees.js` | Hooks React Query |
| `src/apps/artisan/components/tournees/TourneesTab.jsx` | Onglet : liste des journées de l'horizon |
| `src/apps/artisan/components/tournees/RemplirJourneePanel.jsx` | Panneau de remplissage d'une journée |
| `src/apps/artisan/components/tournees/AlertesTournees.jsx` | Journées sous-remplies, retardataires, équipements à typer |

---

## TRANCHE 1 — Socle de données et moteur pur

### Task 1: Migration socle (colonnes, cache trajets, seed Mayer)

**Files:**
- Create: `supabase/migrations/20260829_1_tournees_socle.sql`

**Interfaces:**
- Produces: colonnes `pricing_equipment_types.duration_base_minutes`, `.duration_per_extra_unit_minutes`, `.unfavorable_months` ; `team_members.daily_work_minutes`, `.include_in_routing` ; table `majordhome.travel_cache` + vue `public.majordhome_travel_cache`.

- [ ] **Step 1: Écrire la migration**

```sql
-- 20260829_1_tournees_socle.sql
-- Socle de l'optimisation des tournées d'entretien.
-- Spec : docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md
--
-- 1) Durée d'intervention par type d'équipement (même mécanique que le prix :
--    base + N unités au-delà de `included_units`).
-- 2) Mois défavorables par type (préférence, jamais interdiction — cf. spec 3.3).
-- 3) Budget de travail journalier par technicien, distinct de l'amplitude
--    `default_availability` qui, elle, borne OÙ placer un RDV.
-- 4) Cache des temps de trajet : condition de fonctionnement, pas optimisation
--    (quota Mapbox Matrix = 100 000 éléments/mois).

-- ── 1 & 2 ──────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.pricing_equipment_types
  ADD COLUMN IF NOT EXISTS duration_base_minutes            integer,
  ADD COLUMN IF NOT EXISTS duration_per_extra_unit_minutes  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unfavorable_months               smallint[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN majordhome.pricing_equipment_types.duration_base_minutes IS
  'Durée d''entretien de base en minutes. NULL = type non entretenu (travaux, prestations).';
COMMENT ON COLUMN majordhome.pricing_equipment_types.duration_per_extra_unit_minutes IS
  'Minutes ajoutées par unité au-delà de included_units (ex. +30 min par split).';
COMMENT ON COLUMN majordhome.pricing_equipment_types.unfavorable_months IS
  'Mois (1-12) où l''entretien est déconseillé (appareil chaud). Préférence pénalisante, jamais un filtre.';

-- ── 3 ──────────────────────────────────────────────────────────────────────
ALTER TABLE majordhome.team_members
  ADD COLUMN IF NOT EXISTS daily_work_minutes  integer NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS include_in_routing  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN majordhome.team_members.daily_work_minutes IS
  'Budget de travail journalier (trajets + interventions, pause exclue). Distinct de l''amplitude default_availability.';
COMMENT ON COLUMN majordhome.team_members.include_in_routing IS
  'false = ressource hors optimisation des tournées (sous-traitant organisé hors outil).';

-- ── 4 ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS majordhome.travel_cache (
  org_id       uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  from_key     text        NOT NULL,
  to_key       text        NOT NULL,
  minutes      integer     NOT NULL,
  km           numeric(7,2),
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, from_key, to_key)
);

COMMENT ON TABLE majordhome.travel_cache IS
  'Temps de trajet voiture entre deux points, clés = "lat,lng" arrondis à 3 décimales (~100 m).';

ALTER TABLE majordhome.travel_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS travel_cache_select ON majordhome.travel_cache;
CREATE POLICY travel_cache_select ON majordhome.travel_cache FOR SELECT
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

DROP POLICY IF EXISTS travel_cache_insert ON majordhome.travel_cache;
CREATE POLICY travel_cache_insert ON majordhome.travel_cache FOR INSERT
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

DROP POLICY IF EXISTS travel_cache_update ON majordhome.travel_cache;
CREATE POLICY travel_cache_update ON majordhome.travel_cache FOR UPDATE
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE ON majordhome.travel_cache TO service_role;

DROP VIEW IF EXISTS public.majordhome_travel_cache;
CREATE VIEW public.majordhome_travel_cache
  WITH (security_invoker = true) AS
  SELECT org_id, from_key, to_key, minutes, km, computed_at
  FROM majordhome.travel_cache;

GRANT SELECT, INSERT, UPDATE ON public.majordhome_travel_cache TO authenticated;

-- ── Seed Mayer ─────────────────────────────────────────────────────────────
-- Durées validées avec Eric le 2026-08-29. Mois défavorables = combustion
-- (appareil devant être froid) : novembre à mars.
WITH d(code, base, per_unit, unfavorable) AS (VALUES
  ('poele_granules_elec',       90,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('poele_bois_insert',         60,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('pac_air_air',               60, 30, ARRAY[]::smallint[]),
  ('chaudiere_granules',       150,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('pac_air_eau',               90,  0, ARRAY[]::smallint[]),
  ('gainable',                  90,  0, ARRAY[]::smallint[]),
  ('ballon_thermo',             90,  0, ARRAY[]::smallint[]),
  ('chaudiere_bois',           150,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('poele_granules_sans_elec',  90,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('poele_hydro',              150,  0, ARRAY[11,12,1,2,3]::smallint[]),
  ('chauffe_eau_solaire',       90,  0, ARRAY[]::smallint[]),
  ('panneau_photovoltaique',    90,  0, ARRAY[]::smallint[])
)
UPDATE majordhome.pricing_equipment_types pet
   SET duration_base_minutes           = d.base,
       duration_per_extra_unit_minutes = d.per_unit,
       unfavorable_months              = d.unfavorable,
       updated_at                      = now()
  FROM d
 WHERE pet.code = d.code
   AND pet.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';

-- Mohammed est un renfort ponctuel, organisé hors outil (spec §9).
UPDATE majordhome.team_members
   SET include_in_routing = false
 WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
   AND trim(first_name) ILIKE 'Mohammed';
```

- [ ] **Step 2: Appliquer et vérifier l'effet réel**

Appliquer via le MCP Supabase (`apply_migration`, projet `ejqqqwudmizqisdkxohw`), puis vérifier — **jamais en relisant le texte de la migration** :

```sql
SELECT code, duration_base_minutes, duration_per_extra_unit_minutes, unfavorable_months
FROM majordhome.pricing_equipment_types
WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' AND is_active
ORDER BY duration_base_minutes NULLS FIRST;
```

Attendu : 12 lignes renseignées, `TRAV_ELEC` et `prestation_diverses` à NULL.

```sql
SELECT display_name, daily_work_minutes, include_in_routing FROM majordhome.team_members
WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' AND role = 'technician';
```

Attendu : Antoine et Ludovic à `true`, Mohammed à `false`, tous à 480.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260829_1_tournees_socle.sql && git commit -m "feat(tournees): socle DB - durees par type, budget technicien, cache trajets"
```

---

### Task 2: `duree.js` — durée d'intervention

**Files:**
- Create: `src/lib/tournee/duree.js`
- Test: `scripts/tournee/duree.test.mjs`

**Interfaces:**
- Produces:
  - `dureeEquipement(equipement, type, fallbackMinutes) → number`
  - `dureeContrat(equipements, typesById, fallbacks) → number`
  - `construireFallbacks(parc, typesById, defautMinutes = 90) → { parCategorie: Record<string,number>, defaut: number }`
  - Formes attendues : `equipement = { equipment_type_id, category, unit_count }` ; `type = { duration_base_minutes, duration_per_extra_unit_minutes, included_units }` ; `typesById` est une `Map`.

- [ ] **Step 1: Écrire les tests**

```js
// scripts/tournee/duree.test.mjs
// Run : node --test scripts/tournee/duree.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dureeEquipement, dureeContrat, construireFallbacks } from '../../src/lib/tournee/duree.js';

const T_POELE_GRAN = { duration_base_minutes: 90, duration_per_extra_unit_minutes: 0, included_units: 1 };
const T_POELE_BOIS = { duration_base_minutes: 60, duration_per_extra_unit_minutes: 0, included_units: 1 };
const T_PAC_AIR_AIR = { duration_base_minutes: 60, duration_per_extra_unit_minutes: 30, included_units: 1 };
const T_CHAUD_BOIS = { duration_base_minutes: 150, duration_per_extra_unit_minutes: 0, included_units: 1 };

test('dureeEquipement — type simple, unit_count ignoré', () => {
  assert.equal(dureeEquipement({ unit_count: 1 }, T_POELE_GRAN, 90), 90);
  assert.equal(dureeEquipement({ unit_count: 3 }, T_POELE_GRAN, 90), 90);
});

test('dureeEquipement — multi-split : +30 par unité AU-DELÀ de included_units', () => {
  assert.equal(dureeEquipement({ unit_count: 1 }, T_PAC_AIR_AIR, 90), 60,  'mono-split = 1h');
  assert.equal(dureeEquipement({ unit_count: 2 }, T_PAC_AIR_AIR, 90), 90,  'bi-split = 1h30');
  assert.equal(dureeEquipement({ unit_count: 3 }, T_PAC_AIR_AIR, 90), 120, 'tri-split = 2h');
});

test('dureeEquipement — unit_count absent vaut 1', () => {
  assert.equal(dureeEquipement({}, T_PAC_AIR_AIR, 90), 60);
});

test('dureeEquipement — type absent ou sans durée → fallback', () => {
  assert.equal(dureeEquipement({ unit_count: 1 }, null, 90), 90);
  assert.equal(dureeEquipement({ unit_count: 1 }, { duration_base_minutes: null }, 150), 150);
});

test('dureeContrat — somme des équipements', () => {
  const types = new Map([['a', T_POELE_GRAN], ['b', T_PAC_AIR_AIR]]);
  const equipements = [
    { equipment_type_id: 'a', category: 'poele', unit_count: 1 },
    { equipment_type_id: 'b', category: 'pac_air_air', unit_count: 2 },
  ];
  assert.equal(dureeContrat(equipements, types, { parCategorie: {}, defaut: 90 }), 180);
});

test('dureeContrat — équipement non typé → fallback de SA catégorie', () => {
  const types = new Map();
  const fallbacks = { parCategorie: { poele: 90, chaudiere_bois: 150 }, defaut: 90 };
  assert.equal(dureeContrat([{ category: 'chaudiere_bois' }], types, fallbacks), 150);
  assert.equal(dureeContrat([{ category: 'poele' }], types, fallbacks), 90);
  assert.equal(dureeContrat([{ category: 'inconnue' }], types, fallbacks), 90);
});

test('dureeContrat — contrat vide = 0', () => {
  assert.equal(dureeContrat([], new Map(), { parCategorie: {}, defaut: 90 }), 0);
});

test('construireFallbacks — durée du type DOMINANT de chaque catégorie', () => {
  // Parc : 3 poêles granulés (90) + 1 poêle bois (60) → dominant poele = 90.
  //        2 chaudières bois (150) → dominant chaudiere_bois = 150.
  const typesById = new Map([['g', T_POELE_GRAN], ['b', T_POELE_BOIS], ['c', T_CHAUD_BOIS]]);
  const parc = [
    { equipment_type_id: 'g', category: 'poele' },
    { equipment_type_id: 'g', category: 'poele' },
    { equipment_type_id: 'g', category: 'poele' },
    { equipment_type_id: 'b', category: 'poele' },
    { equipment_type_id: 'c', category: 'chaudiere_bois' },
    { equipment_type_id: 'c', category: 'chaudiere_bois' },
  ];
  const fb = construireFallbacks(parc, typesById, 90);
  assert.equal(fb.parCategorie.poele, 90);
  assert.equal(fb.parCategorie.chaudiere_bois, 150);
  assert.equal(fb.defaut, 90);
});

test('construireFallbacks — catégorie sans aucun équipement typé est absente', () => {
  const fb = construireFallbacks([{ category: 'vmc' }], new Map(), 90);
  assert.equal(fb.parCategorie.vmc, undefined);
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `node --test scripts/tournee/duree.test.mjs`
Attendu : ÉCHEC — `Cannot find module '.../src/lib/tournee/duree.js'`

- [ ] **Step 3: Implémenter**

```js
// src/lib/tournee/duree.js
// ============================================================================
// Durée d'intervention d'un entretien. Module PUR (aucun import) — exécutable
// par Node, Vite et Deno. Testé : node --test scripts/tournee/duree.test.mjs
//
// La durée suit exactement la même mécanique que le PRIX (base + unités
// au-delà de `included_units`), sur les mêmes colonnes de
// `majordhome.pricing_equipment_types`. Une seule source de vérité par type.
// ============================================================================

/**
 * Durée d'un équipement. `type` peut être absent (équipement non typé) ou sans
 * durée renseignée : on retombe alors sur `fallbackMinutes`, jamais sur 0 —
 * une durée nulle ferait déborder la journée en silence.
 */
export function dureeEquipement(equipement, type, fallbackMinutes) {
  const base = type?.duration_base_minutes;
  if (base == null) return fallbackMinutes;
  const perUnit = type.duration_per_extra_unit_minutes || 0;
  const included = type.included_units ?? 1;
  const count = equipement?.unit_count || 1;
  return base + Math.max(0, count - included) * perUnit;
}

/** Durée totale d'un contrat = somme de ses équipements. */
export function dureeContrat(equipements, typesById, fallbacks) {
  return (equipements || []).reduce((total, eq) => {
    const type = eq.equipment_type_id ? typesById.get(eq.equipment_type_id) : null;
    const fallback = fallbacks?.parCategorie?.[eq.category] ?? fallbacks?.defaut ?? 0;
    return total + dureeEquipement(eq, type, fallback);
  }, 0);
}

/**
 * Fallback par catégorie = durée du type DOMINANT (le plus fréquent) de cette
 * catégorie dans le parc réel. Un fallback uniforme sous-estimerait les
 * chaudières bois d'une heure et ferait déborder leur journée.
 * Les catégories sans aucun équipement typé restent absentes → `defaut`.
 */
export function construireFallbacks(parc, typesById, defautMinutes = 90) {
  const comptes = new Map(); // category -> Map(typeId -> n)
  for (const eq of parc || []) {
    if (!eq.equipment_type_id || !eq.category) continue;
    if (!comptes.has(eq.category)) comptes.set(eq.category, new Map());
    const parType = comptes.get(eq.category);
    parType.set(eq.equipment_type_id, (parType.get(eq.equipment_type_id) || 0) + 1);
  }

  const parCategorie = {};
  for (const [category, parType] of comptes) {
    let dominantId = null;
    let meilleur = -1;
    // Tri par id à égalité de compte : rend le résultat déterministe.
    for (const id of [...parType.keys()].sort()) {
      const n = parType.get(id);
      if (n > meilleur) { meilleur = n; dominantId = id; }
    }
    const duree = typesById.get(dominantId)?.duration_base_minutes;
    if (duree != null) parCategorie[category] = duree;
  }

  return { parCategorie, defaut: defautMinutes };
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node --test scripts/tournee/duree.test.mjs`
Attendu : 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournee/duree.js scripts/tournee/duree.test.mjs && git commit -m "feat(tournees): moteur - calcul de duree d intervention"
```

---

### Task 3: `eligibilite.js` — score maturité × saison

**Files:**
- Create: `src/lib/tournee/eligibilite.js`
- Test: `scripts/tournee/eligibilite.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `ecartMois(moisA, moisB) → number` (distance circulaire 0-6)
  - `scoreEligibilite({ moisAnniversaire, moisCible, moisDefavorables, toleranceMois, moisCreux, estSaisonnier }) → { score, dansTolerance, saisonDefavorable, bonusCreux }`
  - `score` ∈ [0, 1.3] ; 0 signifie « à ne pas proposer », jamais « interdit ».

- [ ] **Step 1: Écrire les tests**

```js
// scripts/tournee/eligibilite.test.mjs
// Run : node --test scripts/tournee/eligibilite.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ecartMois, scoreEligibilite } from '../../src/lib/tournee/eligibilite.js';

const HIVER = [11, 12, 1, 2, 3];
const base = {
  toleranceMois: 2,
  moisCreux: HIVER,
  moisDefavorables: [],
  estSaisonnier: false,
};

test('ecartMois — distance circulaire, décembre↔janvier = 1', () => {
  assert.equal(ecartMois(6, 6), 0);
  assert.equal(ecartMois(12, 1), 1);
  assert.equal(ecartMois(1, 12), 1);
  assert.equal(ecartMois(1, 7), 6, 'maximum = 6 mois');
  assert.equal(ecartMois(11, 2), 3);
});

test('score maximal sur le plateau de tolérance', () => {
  const a = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 6 });
  const b = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 8 });
  assert.equal(a.score, b.score, 'plateau : anniversaire et +2 mois valent pareil');
  assert.equal(a.dansTolerance, true);
  assert.equal(b.dansTolerance, true);
});

test('décroissance progressive hors tolérance, jamais un mur', () => {
  const dans = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 8 });
  const hors1 = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 9 });
  const hors2 = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 10 });
  assert.ok(hors1.score < dans.score, 'au-delà de la tolérance, le score baisse');
  assert.ok(hors2.score < hors1.score, 'et continue de baisser');
  assert.ok(hors2.score > 0, 'mais reste proposable — pas une interdiction');
  assert.equal(hors1.dansTolerance, false);
});

test('mois défavorable : pénalise fortement sans annuler', () => {
  const favorable = scoreEligibilite({ ...base, moisAnniversaire: 6, moisCible: 6, moisDefavorables: HIVER });
  const defavorable = scoreEligibilite({ ...base, moisAnniversaire: 1, moisCible: 1, moisDefavorables: HIVER });
  assert.ok(defavorable.score > 0, 'possible pendant la periode de chauffe');
  assert.ok(defavorable.score < favorable.score * 0.5, 'mais fortement penalise');
  assert.equal(defavorable.saisonDefavorable, true);
});

test('poêle anniversaire janvier : octobre et avril battent janvier', () => {
  const p = { ...base, moisAnniversaire: 1, moisDefavorables: HIVER };
  const janvier = scoreEligibilite({ ...p, moisCible: 1 });
  const avril = scoreEligibilite({ ...p, moisCible: 4 });
  const octobre = scoreEligibilite({ ...p, moisCible: 10 });
  assert.ok(avril.score > janvier.score, 'avril bat janvier malgré 3 mois d ecart');
  assert.ok(octobre.score > janvier.score, 'octobre aussi');
});

test('bonus creux : un type sans contrainte est poussé vers l hiver', () => {
  const pac = { ...base, moisAnniversaire: 6, moisDefavorables: [], estSaisonnier: false };
  const enHiver = scoreEligibilite({ ...pac, moisCible: 1 });
  const enEte = scoreEligibilite({ ...pac, moisCible: 6 });
  assert.equal(enHiver.bonusCreux, true);
  assert.equal(enEte.bonusCreux, false);
  // L'hiver est à 5 mois de l'anniversaire mais le bonus compense en partie.
  assert.ok(enHiver.score > 0.5, 'la PAC reste attractive en hiver');
});

test('bonus creux jamais appliqué à un type saisonnier', () => {
  const poele = scoreEligibilite({
    ...base, moisAnniversaire: 6, moisCible: 1, moisDefavorables: HIVER, estSaisonnier: true,
  });
  assert.equal(poele.bonusCreux, false);
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `node --test scripts/tournee/eligibilite.test.mjs`
Attendu : ÉCHEC — module introuvable

- [ ] **Step 3: Implémenter**

```js
// src/lib/tournee/eligibilite.js
// ============================================================================
// Score d'éligibilité d'un contrat à une date. Module PUR.
// Testé : node --test scripts/tournee/eligibilite.test.mjs
//
// Deux pénalités CONTINUES, jamais une intersection d'ensembles (cf. spec §3.3) :
//   - maturité : distance à la date anniversaire, plateau sur ± toleranceMois ;
//   - saison   : un mois défavorable pénalise fortement, sans annuler.
// Un poêle d'anniversaire janvier ressort ainsi naturellement en octobre ou
// avril, sans règle d'exception à maintenir.
// ============================================================================

const PENALITE_PAR_MOIS_HORS_TOLERANCE = 0.18;
const PLANCHER_MATURITE = 0.1;
const FACTEUR_SAISON_DEFAVORABLE = 0.25;
const BONUS_MOIS_CREUX = 1.3;

/** Distance circulaire entre deux mois (1-12), de 0 à 6. */
export function ecartMois(moisA, moisB) {
  const brut = Math.abs(moisA - moisB);
  return Math.min(brut, 12 - brut);
}

/**
 * @param {number} moisAnniversaire  1-12
 * @param {number} moisCible         1-12
 * @param {number[]} moisDefavorables  mois où l'appareil doit être froid
 * @param {number} toleranceMois     plateau autour de l'anniversaire (défaut 2)
 * @param {number[]} moisCreux       mois structurellement vides en entretien
 * @param {boolean} estSaisonnier    le type a-t-il des contraintes de saison
 */
export function scoreEligibilite({
  moisAnniversaire,
  moisCible,
  moisDefavorables = [],
  toleranceMois = 2,
  moisCreux = [],
  estSaisonnier = false,
}) {
  const ecart = ecartMois(moisAnniversaire, moisCible);
  const dansTolerance = ecart <= toleranceMois;

  const maturite = dansTolerance
    ? 1
    : Math.max(PLANCHER_MATURITE, 1 - (ecart - toleranceMois) * PENALITE_PAR_MOIS_HORS_TOLERANCE);

  const saisonDefavorable = moisDefavorables.includes(moisCible);
  const facteurSaison = saisonDefavorable ? FACTEUR_SAISON_DEFAVORABLE : 1;

  // Un type sans contrainte de saison est poussé vers les mois creux : les y
  // laisser libère avril-octobre pour la combustion, qui n'a que sept mois.
  const bonusCreux = !estSaisonnier && moisCreux.includes(moisCible);
  const facteurCreux = bonusCreux ? BONUS_MOIS_CREUX : 1;

  return {
    score: maturite * facteurSaison * facteurCreux,
    dansTolerance,
    saisonDefavorable,
    bonusCreux,
  };
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node --test scripts/tournee/eligibilite.test.mjs`
Attendu : 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournee/eligibilite.js scripts/tournee/eligibilite.test.mjs && git commit -m "feat(tournees): moteur - score eligibilite maturite x saison"
```

---

### Task 4: `geo.js` — filtre de proximité

**Files:**
- Create: `src/lib/tournee/geo.js`
- Test: `scripts/tournee/geo.test.mjs`

**Interfaces:**
- Consumes: `haversineKm` de `src/lib/sectorClustering.js` (module pur existant, réexporté ici pour que le moteur ait un point d'entrée unique).
- Produces:
  - `cleCoord({ lat, lng }) → string` — clé de cache, 3 décimales (~100 m)
  - `barycentre(points) → { lat, lng } | null`
  - `filtreProximite(candidats, centre, rayonKm) → candidats[]`
  - Forme des candidats : `{ lat, lng, ... }` (les autres champs sont préservés).

- [ ] **Step 1: Écrire les tests**

```js
// scripts/tournee/geo.test.mjs
// Run : node --test scripts/tournee/geo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleCoord, barycentre, filtreProximite, haversineKm } from '../../src/lib/tournee/geo.js';

const GAILLAC = { lat: 43.9019, lng: 1.8981 };
const ALBI = { lat: 43.9298, lng: 2.1480 };

test('cleCoord — 3 décimales, stable et symétrique en format', () => {
  assert.equal(cleCoord({ lat: 43.90194, lng: 1.89812 }), '43.902,1.898');
  assert.equal(cleCoord({ lat: 43.9019449, lng: 1.8981 }), cleCoord({ lat: 43.90189, lng: 1.89814 }),
    'deux points a moins de 100 m partagent la meme cle');
});

test('cleCoord — coordonnées absentes → null', () => {
  assert.equal(cleCoord({ lat: null, lng: 1.9 }), null);
  assert.equal(cleCoord(null), null);
});

test('barycentre — moyenne des points, null si vide', () => {
  const b = barycentre([{ lat: 43.9, lng: 1.9 }, { lat: 43.9, lng: 2.1 }]);
  assert.ok(Math.abs(b.lat - 43.9) < 1e-9);
  assert.ok(Math.abs(b.lng - 2.0) < 1e-9);
  assert.equal(barycentre([]), null);
});

test('barycentre — ignore les points sans coordonnées', () => {
  const b = barycentre([{ lat: 43.9, lng: 1.9 }, { lat: null, lng: null }]);
  assert.ok(Math.abs(b.lat - 43.9) < 1e-9);
});

test('filtreProximite — garde ce qui est dans le rayon', () => {
  const candidats = [
    { id: 'proche', ...GAILLAC },
    { id: 'loin', ...ALBI },        // ~20 km
    { id: 'sanscoord', lat: null, lng: null },
  ];
  const dans = filtreProximite(candidats, GAILLAC, 25).map((c) => c.id);
  assert.deepEqual(dans.sort(), ['loin', 'proche']);

  const serre = filtreProximite(candidats, GAILLAC, 5).map((c) => c.id);
  assert.deepEqual(serre, ['proche']);
});

test('filtreProximite — centre null → aucun filtrage (tout passe sauf sans coords)', () => {
  const candidats = [{ id: 'a', ...GAILLAC }, { id: 'b', lat: null, lng: null }];
  assert.deepEqual(filtreProximite(candidats, null, 25).map((c) => c.id), ['a']);
});

test('haversineKm réexporté et cohérent', () => {
  const d = haversineKm(GAILLAC, ALBI);
  assert.ok(d > 18 && d < 22, `attendu ~20 km, obtenu ${d}`);
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `node --test scripts/tournee/geo.test.mjs`
Attendu : ÉCHEC — module introuvable

- [ ] **Step 3: Implémenter**

```js
// src/lib/tournee/geo.js
// ============================================================================
// Géométrie du moteur de tournées. Module PUR.
// Testé : node --test scripts/tournee/geo.test.mjs
//
// Premier étage du calcul de distance : le filtre à vol d'oiseau est gratuit et
// instantané, il fait passer ~416 contrats à ~25 candidats avant tout appel
// Mapbox (dont le quota est la vraie ressource rare).
// ============================================================================

import { haversineKm } from '../sectorClustering.js';

export { haversineKm };

const aDesCoords = (p) =>
  p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

/**
 * Clé de cache d'un point : 3 décimales ≈ 100 m. Deux clients d'une même rue
 * partagent la même clé, ce qui est exactement l'effet recherché.
 */
export function cleCoord(point) {
  if (!aDesCoords(point)) return null;
  return `${Number(point.lat).toFixed(3)},${Number(point.lng).toFixed(3)}`;
}

/** Barycentre des points géolocalisés. `null` si aucun. */
export function barycentre(points) {
  const valides = (points || []).filter(aDesCoords);
  if (valides.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of valides) {
    lat += Number(p.lat);
    lng += Number(p.lng);
  }
  return { lat: lat / valides.length, lng: lng / valides.length };
}

/**
 * Candidats à ≤ rayonKm du centre. Un candidat sans coordonnées est toujours
 * écarté : sans position, aucun coût de trajet n'est calculable, et le laisser
 * passer produirait une tournée dont la durée est fausse.
 */
export function filtreProximite(candidats, centre, rayonKm) {
  const avecCoords = (candidats || []).filter(aDesCoords);
  if (!aDesCoords(centre)) return avecCoords;
  return avecCoords.filter((c) => haversineKm(centre, c) <= rayonKm);
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node --test scripts/tournee/geo.test.mjs`
Attendu : 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournee/geo.js scripts/tournee/geo.test.mjs && git commit -m "feat(tournees): moteur - filtre de proximite et cles de cache"
```

---

### Task 5: `sequence.js` — séquencement exact de la journée

C'est le cœur du moteur. Il ordonne dépôt → arrêts → dépôt en respectant quatre contraintes : budget de travail, amplitude horaire, pause méridienne, fenêtres promises aux clients.

**Files:**
- Create: `src/lib/tournee/sequence.js`
- Test: `scripts/tournee/sequence.test.mjs`

**Interfaces:**
- Consumes: rien (la matrice de trajets est injectée en paramètre).
- Produces:
  - `sequencerTournee({ depotKey, arrets, trajet, amplitude, budgetMinutes, pause }) → { faisable, raison, ordre, planning, chargeMinutes, finMinutes, pauseHorsFenetre }`
  - `arrets` : `[{ id, key, dureeMinutes, fenetre?: { debut, fin } }]` — `key` est une clé `cleCoord`, les temps sont en minutes depuis minuit.
  - `trajet` : `(fromKey, toKey) => number` (minutes) — fonction injectée, doit être totale sur les clés fournies.
  - `amplitude` : `{ debut, fin }` en minutes depuis minuit.
  - `pause` : `{ minutes, fenetre: [debut, fin] }`.
  - `planning` : `[{ id, arriveeMinutes, departMinutes, rang }]`, `rang` 1-indexé.
  - `raison` ∈ `'budget' | 'amplitude' | 'fenetre' | null`.
  - `MAX_ARRETS_EXACT = 8`

- [ ] **Step 1: Écrire les tests**

```js
// scripts/tournee/sequence.test.mjs
// Run : node --test scripts/tournee/sequence.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sequencerTournee, MAX_ARRETS_EXACT } from '../../src/lib/tournee/sequence.js';

// Géographie de test, en minutes de trajet. D = dépôt.
// A et B sont voisins (5 min) ; C est à l'opposé (40 min de D, 45 de A/B).
const MATRICE = {
  'D|A': 20, 'A|D': 20, 'D|B': 22, 'B|D': 22, 'D|C': 40, 'C|D': 40,
  'A|B': 5,  'B|A': 5,  'A|C': 45, 'C|A': 45, 'B|C': 44, 'C|B': 44,
};
const trajet = (a, b) => (a === b ? 0 : MATRICE[`${a}|${b}`] ?? 999);

const AMPLITUDE = { debut: 8 * 60, fin: 18 * 60 };
const PAUSE = { minutes: 30, fenetre: [12 * 60, 14 * 60] };
const ctx = { depotKey: 'D', trajet, amplitude: AMPLITUDE, budgetMinutes: 480, pause: PAUSE };

const arret = (id, key, dureeMinutes, fenetre) => ({ id, key, dureeMinutes, fenetre });

test('tournée vide — faisable, charge nulle', () => {
  const r = sequencerTournee({ ...ctx, arrets: [] });
  assert.equal(r.faisable, true);
  assert.equal(r.chargeMinutes, 0);
  assert.deepEqual(r.ordre, []);
});

test('un seul arrêt — aller-retour au dépôt compté', () => {
  const r = sequencerTournee({ ...ctx, arrets: [arret('a', 'A', 90)] });
  assert.equal(r.faisable, true);
  assert.equal(r.chargeMinutes, 20 + 90 + 20, 'trajet aller + intervention + retour');
  assert.equal(r.planning[0].rang, 1);
  assert.equal(r.planning[0].arriveeMinutes, 8 * 60 + 20);
});

test('trouve le VRAI optimum, pas un ordre d arrivée', () => {
  // Ordre fourni volontairement mauvais : A, C, B → 20+45+44+22 = 131 de trajet.
  // Optimum : A, B, C (ou C, B, A) → 20+5+44+40 = 109.
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 60), arret('c', 'C', 60), arret('b', 'B', 60)],
  });
  assert.equal(r.faisable, true);
  const trajets = r.chargeMinutes - 180;
  assert.equal(trajets, 109, `attendu 109 min de trajet, obtenu ${trajets}`);
  const ids = r.ordre.join(',');
  assert.ok(ids === 'a,b,c' || ids === 'c,b,a', `ordre inattendu : ${ids}`);
});

test('pause méridienne insérée dans sa fenêtre', () => {
  // 3 × 2h : la journée traverse forcément midi.
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 120), arret('b', 'B', 120), arret('c', 'C', 120)],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, true);
  assert.equal(r.pauseHorsFenetre, false);
  // La pause décale les arrêts d'après : la fin dépasse la somme brute.
  const brut = 8 * 60 + r.chargeMinutes;
  assert.equal(r.finMinutes, brut + 30, 'la pause allonge la journee sans compter dans la charge');
});

test('budget dépassé — infaisable avec raison', () => {
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 150), arret('b', 'B', 150), arret('c', 'C', 150)],
    budgetMinutes: 480, // 450 d intervention + 109 de trajet = 559 > 480
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'budget');
});

test('amplitude dépassée — infaisable', () => {
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 240), arret('c', 'C', 240)],
    amplitude: { debut: 8 * 60, fin: 15 * 60 },
    budgetMinutes: 900,
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'amplitude');
});

test('fenêtre promise respectée — l ordre s y plie', () => {
  // C promis en début de matinée alors que l optimum géographique le mettrait
  // en dernier : la promesse gagne.
  const r = sequencerTournee({
    ...ctx,
    arrets: [
      arret('a', 'A', 60),
      arret('b', 'B', 60),
      arret('c', 'C', 60, { debut: 8 * 60, fin: 9 * 60 + 30 }),
    ],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, true);
  assert.equal(r.ordre[0], 'c', 'la fenetre promise impose le premier passage');
  const planC = r.planning.find((p) => p.id === 'c');
  assert.ok(planC.arriveeMinutes <= 9 * 60 + 30);
});

test('fenêtre impossible à tenir — infaisable', () => {
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('c', 'C', 60, { debut: 8 * 60, fin: 8 * 60 + 10 })], // 40 min de trajet
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'fenetre');
});

test('attente si on arrive avant l ouverture de la fenêtre', () => {
  const r = sequencerTournee({
    ...ctx,
    arrets: [arret('a', 'A', 60, { debut: 10 * 60, fin: 11 * 60 })],
    budgetMinutes: 600,
  });
  assert.equal(r.faisable, true);
  assert.equal(r.planning[0].arriveeMinutes, 10 * 60, 'on patiente jusqu a l ouverture');
});

test('déterminisme — même entrée, même sortie', () => {
  const arrets = [arret('a', 'A', 60), arret('b', 'B', 60), arret('c', 'C', 60)];
  const r1 = sequencerTournee({ ...ctx, arrets, budgetMinutes: 600 });
  const r2 = sequencerTournee({ ...ctx, arrets: [...arrets].reverse(), budgetMinutes: 600 });
  assert.equal(r1.chargeMinutes, r2.chargeMinutes, 'l ordre d entree ne change pas l optimum');
});

test('au-delà de MAX_ARRETS_EXACT — repli heuristique, toujours faisable', () => {
  const arrets = Array.from({ length: MAX_ARRETS_EXACT + 2 }, (_, i) =>
    arret(`x${i}`, i % 2 === 0 ? 'A' : 'B', 20));
  const r = sequencerTournee({ ...ctx, arrets, budgetMinutes: 900 });
  assert.equal(r.ordre.length, arrets.length, 'tous les arrets sont places');
  assert.equal(r.methode, 'heuristique');
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `node --test scripts/tournee/sequence.test.mjs`
Attendu : ÉCHEC — module introuvable

- [ ] **Step 3: Implémenter**

```js
// src/lib/tournee/sequence.js
// ============================================================================
// Séquencement d'une journée de tournée. Module PUR.
// Testé : node --test scripts/tournee/sequence.test.mjs
//
// Avec 4-5 entretiens par jour, l'espace des ordres possibles est minuscule
// (5 arrêts = 120 ordres, 8 = 40 320) : on les énumère TOUS et on retourne le
// vrai optimum. Pas d'heuristique, pas d'approximation — le repli
// plus-proche-voisin n'existe que comme garde-fou au-delà de 8 arrêts.
//
// Le temps est en minutes depuis minuit, partout. Aucune `Date` ici : c'est ce
// qui rend le module testable et réutilisable côté Deno.
//
// Vocabulaire :
//   charge = trajets + interventions (ce que borne `budgetMinutes`)
//   fin    = heure de retour au dépôt, pause incluse (ce que borne l'amplitude)
// La pause n'est pas du travail : elle allonge la journée sans consommer le
// budget.
// ============================================================================

export const MAX_ARRETS_EXACT = 8;

function* permutations(items) {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i += 1) {
    const reste = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(reste)) yield [items[i], ...p];
  }
}

/**
 * Déroule une journée dans un ordre donné et retourne son coût, ou `null` si
 * une contrainte est violée (avec la raison).
 */
function simuler(ordre, { depotKey, trajet, amplitude, budgetMinutes, pause }) {
  let t = amplitude.debut;
  let charge = 0;
  let pausePrise = false;
  let pauseHorsFenetre = false;
  const planning = [];
  let position = depotKey;

  const [pauseDebut, pauseFin] = pause?.fenetre ?? [0, 0];
  const pauseMinutes = pause?.minutes ?? 0;

  for (let i = 0; i < ordre.length; i += 1) {
    const arret = ordre[i];

    const dureeTrajet = trajet(position, arret.key);
    t += dureeTrajet;
    charge += dureeTrajet;

    // La pause se prend à la première opportunité après l'ouverture de sa
    // fenêtre — c'est-à-dire entre deux arrêts, jamais au milieu d'un.
    if (!pausePrise && pauseMinutes > 0 && t >= pauseDebut) {
      t += pauseMinutes;
      pausePrise = true;
      if (t - pauseMinutes > pauseFin) pauseHorsFenetre = true;
    }

    if (arret.fenetre) {
      if (t < arret.fenetre.debut) t = arret.fenetre.debut; // on patiente
      if (t > arret.fenetre.fin) return { echec: 'fenetre' };
    }

    const arriveeMinutes = t;
    t += arret.dureeMinutes;
    charge += arret.dureeMinutes;
    planning.push({ id: arret.id, arriveeMinutes, departMinutes: t, rang: i + 1 });

    position = arret.key;
  }

  if (ordre.length > 0) {
    const retour = trajet(position, depotKey);
    t += retour;
    charge += retour;
  }

  // Journée trop courte pour que la pause soit tombée dans sa fenêtre : on la
  // prend quand même (le technicien mange plus tard), sans invalider la tournée.
  if (!pausePrise && pauseMinutes > 0 && ordre.length > 0 && t > pauseDebut) {
    t += pauseMinutes;
    pauseHorsFenetre = true;
  }

  if (charge > budgetMinutes) return { echec: 'budget' };
  if (t > amplitude.fin) return { echec: 'amplitude' };

  return { charge, finMinutes: t, planning, pauseHorsFenetre };
}

/** Repli au-delà de MAX_ARRETS_EXACT : plus proche voisin, sans garantie. */
function plusProcheVoisin(arrets, depotKey, trajet) {
  const restants = [...arrets];
  const ordre = [];
  let position = depotKey;
  while (restants.length > 0) {
    let meilleurIdx = 0;
    let meilleur = Infinity;
    for (let i = 0; i < restants.length; i += 1) {
      const d = trajet(position, restants[i].key);
      if (d < meilleur) { meilleur = d; meilleurIdx = i; }
    }
    const [choisi] = restants.splice(meilleurIdx, 1);
    ordre.push(choisi);
    position = choisi.key;
  }
  return ordre;
}

export function sequencerTournee({
  depotKey,
  arrets = [],
  trajet,
  amplitude,
  budgetMinutes,
  pause = { minutes: 0, fenetre: [0, 0] },
}) {
  const ctx = { depotKey, trajet, amplitude, budgetMinutes, pause };

  if (arrets.length === 0) {
    return {
      faisable: true, raison: null, ordre: [], planning: [],
      chargeMinutes: 0, finMinutes: amplitude.debut, pauseHorsFenetre: false,
      methode: 'exact',
    };
  }

  if (arrets.length > MAX_ARRETS_EXACT) {
    const ordre = plusProcheVoisin(arrets, depotKey, trajet);
    const sim = simuler(ordre, ctx);
    if (sim.echec) {
      return {
        faisable: false, raison: sim.echec, ordre: ordre.map((a) => a.id),
        planning: [], chargeMinutes: null, finMinutes: null,
        pauseHorsFenetre: false, methode: 'heuristique',
      };
    }
    return {
      faisable: true, raison: null, ordre: ordre.map((a) => a.id),
      planning: sim.planning, chargeMinutes: sim.charge, finMinutes: sim.finMinutes,
      pauseHorsFenetre: sim.pauseHorsFenetre, methode: 'heuristique',
    };
  }

  // Tri d'entrée par id : rend l'énumération déterministe, donc le résultat
  // indépendant de l'ordre dans lequel les candidats arrivent.
  const tries = [...arrets].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  let meilleur = null;
  let dernierEchec = null;

  for (const ordre of permutations(tries)) {
    const sim = simuler(ordre, ctx);
    if (sim.echec) { dernierEchec = sim.echec; continue; }
    if (!meilleur || sim.charge < meilleur.charge) {
      meilleur = { ...sim, ordre };
    }
  }

  if (!meilleur) {
    return {
      faisable: false, raison: dernierEchec, ordre: [], planning: [],
      chargeMinutes: null, finMinutes: null, pauseHorsFenetre: false,
      methode: 'exact',
    };
  }

  return {
    faisable: true,
    raison: null,
    ordre: meilleur.ordre.map((a) => a.id),
    planning: meilleur.planning,
    chargeMinutes: meilleur.charge,
    finMinutes: meilleur.finMinutes,
    pauseHorsFenetre: meilleur.pauseHorsFenetre,
    methode: 'exact',
  };
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node --test scripts/tournee/sequence.test.mjs`
Attendu : 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournee/sequence.js scripts/tournee/sequence.test.mjs && git commit -m "feat(tournees): moteur - sequencement exact de la journee"
```

---

### Task 6: `insertion.js` — coût marginal d'un candidat

**Files:**
- Create: `src/lib/tournee/insertion.js`
- Test: `scripts/tournee/insertion.test.mjs`

**Interfaces:**
- Consumes: `sequencerTournee` de `./sequence.js`
- Produces:
  - `coutInsertion(tourneeActuelle, candidat, ctx) → { minutes, faisable, raison, sequenceApres } | null`
  - `classerCandidats(tourneeActuelle, candidats, ctx, { scoreParId }) → [{ candidat, coutMinutes, scoreFinal, sequenceApres }]` trié par `scoreFinal` décroissant.
  - `ctx` a la même forme que le paramètre de `sequencerTournee` (hors `arrets`).

- [ ] **Step 1: Écrire les tests**

```js
// scripts/tournee/insertion.test.mjs
// Run : node --test scripts/tournee/insertion.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coutInsertion, classerCandidats } from '../../src/lib/tournee/insertion.js';

const MATRICE = {
  'D|A': 20, 'A|D': 20, 'D|B': 22, 'B|D': 22, 'D|C': 40, 'C|D': 40,
  'A|B': 5,  'B|A': 5,  'A|C': 45, 'C|A': 45, 'B|C': 44, 'C|B': 44,
};
const trajet = (a, b) => (a === b ? 0 : MATRICE[`${a}|${b}`] ?? 999);
const ctx = {
  depotKey: 'D', trajet,
  amplitude: { debut: 8 * 60, fin: 18 * 60 },
  budgetMinutes: 480,
  pause: { minutes: 30, fenetre: [12 * 60, 14 * 60] },
};
const arret = (id, key, dureeMinutes) => ({ id, key, dureeMinutes });

test('insertion dans une journée vide = aller-retour + intervention', () => {
  const r = coutInsertion([], arret('a', 'A', 60), ctx);
  assert.equal(r.faisable, true);
  assert.equal(r.minutes, 20 + 60 + 20);
});

test('un voisin de la tournée coûte moins qu un client isolé', () => {
  const tournee = [arret('a', 'A', 60)];
  const voisin = coutInsertion(tournee, arret('b', 'B', 60), ctx);   // B est à 5 min de A
  const isole = coutInsertion(tournee, arret('c', 'C', 60), ctx);    // C est à l opposé
  assert.ok(voisin.minutes < isole.minutes,
    `voisin ${voisin.minutes} devrait couter moins que isole ${isole.minutes}`);
});

test('le coût exclut la durée d intervention identique — c est bien le DÉTOUR qui départage', () => {
  const tournee = [arret('a', 'A', 60)];
  const b = coutInsertion(tournee, arret('b', 'B', 60), ctx);
  // Avant : 20 + 60 + 20 = 100. Après (A puis B) : 20+60+5+60+22 = 167.
  assert.equal(b.minutes, 67, 'soit 60 d intervention + 7 de detour reel');
});

test('candidat qui ne rentre pas dans le budget → non faisable', () => {
  const tournee = [arret('a', 'A', 240), arret('b', 'B', 180)];
  const r = coutInsertion(tournee, arret('c', 'C', 120), ctx);
  assert.equal(r.faisable, false);
  assert.equal(r.raison, 'budget');
  assert.equal(r.minutes, null);
});

test('classerCandidats — trie par score, écarte les infaisables', () => {
  const tournee = [arret('a', 'A', 60)];
  const candidats = [arret('c', 'C', 60), arret('b', 'B', 60)];
  const classe = classerCandidats(tournee, candidats, ctx, { scoreParId: { b: 1, c: 1 } });
  assert.equal(classe.length, 2);
  assert.equal(classe[0].candidat.id, 'b', 'a score egal, le moins couteux passe devant');
});

test('classerCandidats — un score d éligibilité élevé peut compenser un détour', () => {
  const tournee = [arret('a', 'A', 60)];
  const candidats = [arret('c', 'C', 60), arret('b', 'B', 60)];
  // C est loin mais très mûr, B est proche mais hors saison.
  const classe = classerCandidats(tournee, candidats, ctx, { scoreParId: { b: 0.1, c: 1 } });
  assert.equal(classe[0].candidat.id, 'c');
});

test('classerCandidats — candidat infaisable absent du classement', () => {
  const tournee = [arret('a', 'A', 400)];
  const classe = classerCandidats(tournee, [arret('c', 'C', 120)], ctx, { scoreParId: { c: 1 } });
  assert.equal(classe.length, 0);
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `node --test scripts/tournee/insertion.test.mjs`
Attendu : ÉCHEC — module introuvable

- [ ] **Step 3: Implémenter**

```js
// src/lib/tournee/insertion.js
// ============================================================================
// Coût marginal d'insertion d'un candidat dans une tournée. Module PUR.
// Testé : node --test scripts/tournee/insertion.test.mjs
//
// C'est LE critère de la spec (§3.1) : on ne demande pas « ce client est-il
// dans le bon secteur » mais « combien de minutes ajoute-t-il à la journée ».
// Comme le séquenceur est exact, la différence des deux optima est le vrai
// coût marginal — pas une estimation.
// ============================================================================

import { sequencerTournee } from './sequence.js';

export function coutInsertion(tourneeActuelle, candidat, ctx) {
  const avant = sequencerTournee({ ...ctx, arrets: tourneeActuelle });
  const apres = sequencerTournee({ ...ctx, arrets: [...tourneeActuelle, candidat] });

  if (!apres.faisable) {
    return { minutes: null, faisable: false, raison: apres.raison, sequenceApres: null };
  }

  const base = avant.faisable ? avant.chargeMinutes : 0;
  return {
    minutes: apres.chargeMinutes - base,
    faisable: true,
    raison: null,
    sequenceApres: apres,
  };
}

/**
 * Classe les candidats faisables. Le score final combine l'éligibilité
 * (maturité × saison, cf. eligibilite.js) et l'efficacité géographique :
 * un candidat très mûr mérite un détour, un candidat hors saison ne le mérite
 * pas — c'est ce qui évite de remplir une tournée avec les seuls voisins.
 */
export function classerCandidats(tourneeActuelle, candidats, ctx, { scoreParId = {} } = {}) {
  const resultats = [];

  for (const candidat of candidats || []) {
    const cout = coutInsertion(tourneeActuelle, candidat, ctx);
    if (!cout.faisable) continue;

    const eligibilite = scoreParId[candidat.id] ?? 1;
    // Le coût est ramené en [0,1] : 60 min de détour divise l'attrait par deux.
    const efficacite = 60 / (60 + Math.max(0, cout.minutes - candidat.dureeMinutes));

    resultats.push({
      candidat,
      coutMinutes: cout.minutes,
      detourMinutes: cout.minutes - candidat.dureeMinutes,
      scoreFinal: eligibilite * efficacite,
      sequenceApres: cout.sequenceApres,
    });
  }

  return resultats.sort(
    (a, b) => b.scoreFinal - a.scoreFinal || a.coutMinutes - b.coutMinutes,
  );
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `node --test scripts/tournee/insertion.test.mjs`
Attendu : 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournee/insertion.js scripts/tournee/insertion.test.mjs && git commit -m "feat(tournees): moteur - cout d insertion et classement des candidats"
```

---

### Task 7: Verrou de pureté du moteur

Le moteur doit rester importable par Deno. Un `import { logger } from '@lib/logger'` ajouté par distraction casserait les tranches 3-4 **sans qu'aucun test ne le signale** — le front, lui, résoudrait l'alias sans broncher.

**Files:**
- Create: `scripts/tournee/purete.test.mjs`

**Interfaces:**
- Consumes: les fichiers de `src/lib/tournee/`.
- Produces: rien (test de garde).

- [ ] **Step 1: Écrire le test**

```js
// scripts/tournee/purete.test.mjs
// Run : node --test scripts/tournee/purete.test.mjs
//
// Garde-fou : le moteur de tournées est destiné à être injecté tel quel dans le
// bundle des edge functions (Deno). Tout import d'alias Vite, de React ou de
// Supabase le rendrait inutilisable côté serveur — et rien d'autre ne le
// détecterait, puisque le front résout ces alias sans erreur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOSSIER = join(process.cwd(), 'src', 'lib', 'tournee');
const INTERDITS = [/from\s+['"]@/, /from\s+['"]react/, /from\s+['"]@supabase/];

test('aucun fichier du moteur n importe d alias, de React ou de Supabase', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.js'));
  assert.ok(fichiers.length > 0, 'le dossier du moteur ne doit pas etre vide');

  for (const fichier of fichiers) {
    const source = readFileSync(join(DOSSIER, fichier), 'utf8');
    for (const motif of INTERDITS) {
      assert.equal(motif.test(source), false, `${fichier} contient un import interdit (${motif})`);
    }
  }
});

test('tous les imports relatifs portent une extension .js (contrainte Deno)', () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.js'));
  for (const fichier of fichiers) {
    const source = readFileSync(join(DOSSIER, fichier), 'utf8');
    const imports = source.match(/from\s+['"](\.[^'"]+)['"]/g) || [];
    for (const imp of imports) {
      assert.match(imp, /\.js['"]$/, `${fichier} : import sans extension .js → ${imp}`);
    }
  }
});
```

- [ ] **Step 2: Lancer la suite complète du moteur**

Run: `node --test scripts/tournee/*.test.mjs`
Attendu : 43 tests PASS (9 durée + 7 éligibilité + 7 géo + 11 séquence + 7 insertion + 2 pureté)

- [ ] **Step 3: Vérifier le lint**

Run: `npm run lint`
Attendu : 0 error, 0 warning

- [ ] **Step 4: Commit**

```bash
git add scripts/tournee/purete.test.mjs && git commit -m "test(tournees): verrou de purete du moteur pour reutilisation Deno"
```

---

## TRANCHE 2 — Onglet Tournées (back-office)

### Task 8: Paramétrage des durées dans Settings → Types d'équipement

**Files:**
- Modify: `src/apps/artisan/pages/settings/PricingSettings.jsx` (colonne « Durée » du tableau, champs de `EquipmentTypeModal`)
- Modify: `src/shared/services/pricing.service.js` (payload create/update du type)

**Interfaces:**
- Consumes: colonnes créées en Task 1.
- Produces: les 3 champs éditables → alimentent `duree.js` et `eligibilite.js`.

- [ ] **Step 1: Étendre le payload du service**

Dans `pricing.service.js`, aux endroits qui écrivent sur `majordhome_pricing_equipment_types` (create et update), ajouter au payload :

```js
duration_base_minutes: payload.duration_base_minutes ?? null,
duration_per_extra_unit_minutes: payload.duration_per_extra_unit_minutes ?? 0,
unfavorable_months: payload.unfavorable_months ?? [],
```

⚠️ Écrire via la **vue publique** `majordhome_pricing_equipment_types`, jamais via `.schema('majordhome')` (renvoie `PGRST106 Invalid schema`).

- [ ] **Step 2: Ajouter la colonne « Durée » au tableau**

Dans `EquipmentTypesPanel`, après la colonne « Tarif unitaire » :

```jsx
<th className="py-2 pr-3 font-medium text-center">Durée</th>
```

```jsx
<td className="py-2 pr-3 text-center">
  {type.duration_base_minutes == null ? (
    <span className="text-secondary-400">—</span>
  ) : (
    <>
      {type.duration_base_minutes} min
      {type.duration_per_extra_unit_minutes > 0 && ` +${type.duration_per_extra_unit_minutes}/${type.unit_label || 'unité'}`}
    </>
  )}
</td>
```

- [ ] **Step 3: Ajouter les champs au modal**

Dans `EquipmentTypeModal`, étendre l'état initial :

```js
duration_base_minutes: type?.duration_base_minutes ?? '',
duration_per_extra_unit_minutes: type?.duration_per_extra_unit_minutes ?? 0,
unfavorable_months: type?.unfavorable_months ?? [],
```

Et le formulaire : un champ nombre « Durée d'entretien (min) » (vide = type non entretenu), un champ nombre « + par unité supplémentaire (min) » visible seulement si `has_unit_pricing`, et 12 cases à cocher « Mois déconseillés » avec le libellé d'aide :

> Mois où l'appareil doit être froid. **Préférence, pas interdiction** : ces mois ne sont jamais proposés spontanément, mais restent réservables par le client et forçables en interne.

- [ ] **Step 4: Vérifier manuellement**

Run: `npx vite build`
Attendu : build OK.

Puis dans l'app : `/settings/pricing` → Types d'équipement → ouvrir « Poêle à granulés (électronique) » → vérifier 90 min et les 5 mois cochés ; modifier à 95, enregistrer, rouvrir → 95 persisté ; remettre 90.

- [ ] **Step 5: Commit**

```bash
git add src/apps/artisan/pages/settings/PricingSettings.jsx src/shared/services/pricing.service.js && git commit -m "feat(tournees): edition des durees et mois deconseilles par type d equipement"
```

---

### Task 9: Paramétrage du technicien dans Settings → Équipe

**Files:**
- Modify: `src/apps/artisan/pages/settings/TeamManagement.jsx`
- Modify: `src/shared/services/permissions.service.js` (ou le service qui écrit `team_members` — repérer le caller de `calendar_color` et suivre le même chemin)

**Interfaces:**
- Consumes: colonnes créées en Task 1.
- Produces: `daily_work_minutes` et `include_in_routing` éditables.

- [ ] **Step 1: Repérer le chemin d'écriture existant**

Run: `grep -rn "calendar_color" src/shared/services/ src/apps/artisan/pages/settings/TeamManagement.jsx`

Suivre exactement le même chemin (RPC ou vue publique) pour les deux nouvelles colonnes — ne pas introduire une seconde voie d'écriture.

- [ ] **Step 2: Ajouter les deux contrôles**

Sur la ligne de chaque membre technicien :
- un champ nombre « Budget journalier (min) », défaut 480, aide : « Trajets + interventions, pause exclue. Distinct des horaires ci-contre, qui bornent seulement les heures de placement. » ;
- un interrupteur « Inclure dans l'optimisation des tournées », aide : « Décocher pour un renfort ponctuel organisé hors outil. »

- [ ] **Step 3: Vérifier manuellement**

Run: `npx vite build`

Dans l'app : `/settings/team` → Mohammed doit apparaître décoché, Antoine et Ludovic cochés à 480. Modifier Antoine à 450, recharger, vérifier la persistance, remettre 480.

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/pages/settings/TeamManagement.jsx src/shared/services/permissions.service.js && git commit -m "feat(tournees): budget journalier et inclusion dans les tournees par technicien"
```

---

### Task 10: `trajets.service.js` — Mapbox Matrix avec cache

**Files:**
- Create: `src/shared/services/trajets.service.js`
- Test: `scripts/tournee/trajets-matrice.test.mjs` (teste uniquement la partie pure : assemblage de la matrice)

**Interfaces:**
- Consumes: `cleCoord` de `@/lib/tournee/geo.js`, `MAPBOX_CONFIG` de `@lib/mapbox`, `supabase` de `@lib/supabaseClient`.
- Produces:
  - `construireMatrice(paires) → (fromKey, toKey) => number` (pur, exporté pour test)
  - `trajetsService.chargerMatrice({ orgId, points }) → { data: Map<string, number>, error }` — clés `"from|to"`, valeurs en minutes.
  - Comportement de repli : si Mapbox échoue, estime par haversine × 1,4 à 50 km/h et marque `estime: true`.

- [ ] **Step 1: Écrire le test de la partie pure**

```js
// scripts/tournee/trajets-matrice.test.mjs
// Run : node --test scripts/tournee/trajets-matrice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construireMatrice, estimerParVolDOiseau } from '../../src/lib/tournee/matrice.js';

test('construireMatrice — lookup symétrique par clés', () => {
  const trajet = construireMatrice(new Map([['A|B', 12], ['B|A', 13]]));
  assert.equal(trajet('A', 'B'), 12);
  assert.equal(trajet('B', 'A'), 13);
});

test('construireMatrice — même point = 0', () => {
  const trajet = construireMatrice(new Map());
  assert.equal(trajet('A', 'A'), 0);
});

test('construireMatrice — paire absente : repli explicite, jamais 0', () => {
  const trajet = construireMatrice(new Map(), { defautMinutes: 45 });
  assert.equal(trajet('A', 'B'), 45,
    'une paire inconnue doit couter cher, sinon le moteur croit le trajet gratuit');
});

test('estimerParVolDOiseau — 20 km → ~34 min (facteur route 1,4 à 50 km/h)', () => {
  const min = estimerParVolDOiseau(20);
  assert.ok(min > 30 && min < 38, `attendu ~34, obtenu ${min}`);
});
```

- [ ] **Step 2: Vérifier que le test échoue**

Run: `node --test scripts/tournee/trajets-matrice.test.mjs`
Attendu : ÉCHEC — `src/lib/tournee/matrice.js` introuvable

- [ ] **Step 3: Créer le module pur `matrice.js`**

```js
// src/lib/tournee/matrice.js
// ============================================================================
// Assemblage de la matrice de trajets. Module PUR (le fetch Mapbox vit dans
// trajets.service.js). Testé : node --test scripts/tournee/trajets-matrice.test.mjs
// ============================================================================

const FACTEUR_ROUTE = 1.4;    // le réseau routier rallonge le vol d'oiseau
const VITESSE_KMH = 50;       // moyenne rurale Tarn, trajets courts inclus
const DEFAUT_PAIRE_INCONNUE = 60;

/**
 * @param {Map<string, number>} paires clés "from|to" → minutes
 * @param {number} defautMinutes coût d'une paire absente. Volontairement élevé :
 *   retourner 0 ferait croire au séquenceur que le trajet est gratuit et
 *   produirait des tournées impossibles — un échec silencieux.
 */
export function construireMatrice(paires, { defautMinutes = DEFAUT_PAIRE_INCONNUE } = {}) {
  return (fromKey, toKey) => {
    if (fromKey === toKey) return 0;
    const v = paires.get(`${fromKey}|${toKey}`);
    return v == null ? defautMinutes : v;
  };
}

/** Repli quand Mapbox est indisponible ou hors quota. */
export function estimerParVolDOiseau(km) {
  return Math.round((km * FACTEUR_ROUTE) / VITESSE_KMH * 60);
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `node --test scripts/tournee/trajets-matrice.test.mjs`
Attendu : 4 tests PASS

- [ ] **Step 5: Écrire le service**

```js
// src/shared/services/trajets.service.js
// ============================================================================
// Temps de trajet entre points, avec cache persistant.
//
// Le cache n'est PAS une optimisation : le quota gratuit Mapbox Matrix est de
// 100 000 éléments/mois, et une matrice tournée × candidats en consomme ~200.
// Sans cache, le moteur serait muet au bout de quelques centaines de calculs.
// ============================================================================

import { supabase } from '@lib/supabaseClient';
import { MAPBOX_CONFIG } from '@lib/mapbox';
import { logger } from '@lib/logger';
import { cleCoord, haversineKm } from '@/lib/tournee/geo.js';
import { estimerParVolDOiseau } from '@/lib/tournee/matrice.js';

const MAX_COORDS_MAPBOX = 25;

export const trajetsService = {
  /**
   * Retourne toutes les paires (from,to) entre `points`.
   * @param {Array<{lat:number,lng:number}>} points
   * @returns {{ data: Map<string,number>, estime: boolean, error: any }}
   */
  async chargerMatrice({ orgId, points }) {
    const cles = [...new Set(points.map(cleCoord).filter(Boolean))];
    const paires = new Map();
    if (cles.length < 2) return { data: paires, estime: false, error: null };

    // 1) Cache
    const { data: cache, error: cacheError } = await supabase
      .from('majordhome_travel_cache')
      .select('from_key, to_key, minutes')
      .eq('org_id', orgId)
      .in('from_key', cles)
      .in('to_key', cles);
    if (cacheError) logger.warn('[trajets] lecture cache impossible', cacheError);
    for (const r of cache || []) paires.set(`${r.from_key}|${r.to_key}`, r.minutes);

    // 2) Paires manquantes
    const manquantes = [];
    for (const a of cles) {
      for (const b of cles) {
        if (a !== b && !paires.has(`${a}|${b}`)) manquantes.push([a, b]);
      }
    }
    if (manquantes.length === 0) return { data: paires, estime: false, error: null };

    // 3) Mapbox Matrix par lots de 25 coordonnées
    const token = MAPBOX_CONFIG.accessToken;
    let estime = false;
    if (!token) {
      logger.warn('[trajets] token Mapbox absent — repli vol d oiseau');
      estime = true;
    } else {
      for (let i = 0; i < cles.length; i += MAX_COORDS_MAPBOX) {
        const lot = cles.slice(i, i + MAX_COORDS_MAPBOX);
        if (lot.length < 2) continue;
        const coords = lot.map((k) => { const [lat, lng] = k.split(','); return `${lng},${lat}`; }).join(';');
        try {
          const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?annotations=duration&access_token=${token}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const aEcrire = [];
          json.durations?.forEach((ligne, li) => {
            ligne.forEach((sec, ci) => {
              if (li === ci || sec == null) return;
              const minutes = Math.round(sec / 60);
              paires.set(`${lot[li]}|${lot[ci]}`, minutes);
              aEcrire.push({ org_id: orgId, from_key: lot[li], to_key: lot[ci], minutes });
            });
          });
          if (aEcrire.length) {
            const { error } = await supabase
              .from('majordhome_travel_cache')
              .upsert(aEcrire, { onConflict: 'org_id,from_key,to_key' });
            if (error) logger.warn('[trajets] ecriture cache impossible', error);
          }
        } catch (err) {
          logger.warn('[trajets] Mapbox indisponible — repli vol d oiseau', err);
          estime = true;
        }
      }
    }

    // 4) Ce qui manque encore est estimé — et l'UI doit le dire (cf. spec §10).
    if (estime) {
      const parCle = new Map(points.filter(cleCoord).map((p) => [cleCoord(p), p]));
      for (const [a, b] of manquantes) {
        if (paires.has(`${a}|${b}`)) continue;
        const pa = parCle.get(a);
        const pb = parCle.get(b);
        if (pa && pb) paires.set(`${a}|${b}`, estimerParVolDOiseau(haversineKm(pa, pb)));
      }
    }

    return { data: paires, estime, error: null };
  },
};
```

- [ ] **Step 6: Vérifier**

Run: `npx vite build` puis `npm run lint`
Attendu : build OK, 0 warning.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tournee/matrice.js scripts/tournee/trajets-matrice.test.mjs src/shared/services/trajets.service.js && git commit -m "feat(tournees): service trajets Mapbox Matrix avec cache persistant"
```

---

### Task 11: `tournees.service.js` — contrats dus et journées de l'horizon

**Files:**
- Create: `src/shared/services/tournees.service.js`

**Interfaces:**
- Consumes: `entretiensService`, `appointmentsService`, `trajetsService`, moteur `src/lib/tournee/*`.
- Produces:
  - `tourneesService.getContratsDus({ orgId, coreOrgId }) → { data: Candidat[], error }` où `Candidat = { contractId, clientId, clientName, ville, lat, lng, dureeMinutes, moisAnniversaire, moisDefavorables, estSaisonnier, typesNonRenseignes }`
  - `tourneesService.getJourneesHorizon({ coreOrgId, orgId, joursAvant = 15, joursApres = 45 }) → { data: Journee[], error }` où `Journee = { date, technicienId, technicienNom, arrets: [...], chargeMinutes, budgetMinutes, amplitude, estAmorcee }`
  - `tourneesService.proposerPourJournee({ journee, candidats, orgId, reglages }) → { data: [{ candidat, coutMinutes, detourMinutes, scoreFinal, sequenceApres }], estime, error }`

- [ ] **Step 1: Écrire le service**

```js
// src/shared/services/tournees.service.js
// ============================================================================
// Assemblage des données pour le moteur de tournées. Le service ne décide rien :
// il charge, normalise, appelle le moteur pur et rend le résultat.
// Spec : docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md
// ============================================================================

import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';
import { getMajordhomeOrgId } from '@lib/serviceHelpers';
import { getOrgHeadquarters } from '@lib/territoire-config';
import { trajetsService } from '@services/trajets.service';
import { dureeContrat, construireFallbacks } from '@/lib/tournee/duree.js';
import { scoreEligibilite } from '@/lib/tournee/eligibilite.js';
import { cleCoord, barycentre, filtreProximite } from '@/lib/tournee/geo.js';
import { construireMatrice } from '@/lib/tournee/matrice.js';
import { classerCandidats } from '@/lib/tournee/insertion.js';

export const REGLAGES_DEFAUT = {
  horizon_ferme_jours: 15,
  tolerance_anniversaire_mois: 2,
  pause_minutes: 30,
  pause_fenetre: [12, 14],
  rayon_filtre_km: 25,
  fenetre_promise_minutes: 90,
  mois_creux: [11, 12, 1, 2, 3],
};

export function construireReglages(settings) {
  return { ...REGLAGES_DEFAUT, ...(settings?.tournees || {}) };
}

const hhmmEnMinutes = (s) => {
  const [h, m] = String(s || '08:00').split(':').map(Number);
  return h * 60 + (m || 0);
};

export const tourneesService = {
  /**
   * Contrats actifs sans visite enregistrée cette année, enrichis de leur durée
   * d'intervention et de leurs contraintes de saison.
   */
  async getContratsDus({ orgId }) {
    try {
      const [{ data: contrats, error: cErr }, { data: types, error: tErr }] = await Promise.all([
        supabase.from('majordhome_contracts')
          .select('id, client_id, client_name, client_city, client_postal_code, start_date, current_year_visit_status')
          .eq('org_id', orgId).eq('status', 'active'),
        supabase.from('majordhome_pricing_equipment_types')
          .select('id, code, category, duration_base_minutes, duration_per_extra_unit_minutes, included_units, unfavorable_months')
          .eq('org_id', orgId),
      ]);
      if (cErr) return { data: [], error: cErr };
      if (tErr) return { data: [], error: tErr };

      const dus = (contrats || []).filter((c) => c.current_year_visit_status !== 'completed');
      if (dus.length === 0) return { data: [], error: null };

      const clientIds = [...new Set(dus.map((c) => c.client_id).filter(Boolean))];
      const [{ data: clients }, { data: liens }] = await Promise.all([
        supabase.from('majordhome_clients').select('id, latitude, longitude').in('id', clientIds),
        supabase.from('majordhome_contract_equipments')
          .select('contract_id, equipment_id').in('contract_id', dus.map((c) => c.id)),
      ]);

      const equipIds = [...new Set((liens || []).map((l) => l.equipment_id))];
      const { data: equipements } = equipIds.length
        ? await supabase.from('majordhome_equipments')
            .select('id, category, unit_count, equipment_type_id').in('id', equipIds)
        : { data: [] };

      const typesById = new Map((types || []).map((t) => [t.id, t]));
      const equipById = new Map((equipements || []).map((e) => [e.id, e]));
      const coordsById = new Map((clients || []).map((c) => [c.id, c]));

      const fallbacks = construireFallbacks(equipements || [], typesById, 90);

      const parContrat = new Map();
      for (const l of liens || []) {
        if (!parContrat.has(l.contract_id)) parContrat.set(l.contract_id, []);
        const eq = equipById.get(l.equipment_id);
        if (eq) parContrat.get(l.contract_id).push(eq);
      }

      const candidats = dus.map((c) => {
        const eqs = parContrat.get(c.id) || [];
        const co = coordsById.get(c.client_id);
        const moisDefavorables = [...new Set(eqs.flatMap((e) => {
          const t = e.equipment_type_id ? typesById.get(e.equipment_type_id) : null;
          return t?.unfavorable_months || [];
        }))];
        return {
          contractId: c.id,
          clientId: c.client_id,
          clientName: c.client_name,
          ville: c.client_city,
          lat: co?.latitude ?? null,
          lng: co?.longitude ?? null,
          dureeMinutes: dureeContrat(eqs, typesById, fallbacks),
          moisAnniversaire: c.start_date ? new Date(c.start_date).getMonth() + 1 : null,
          moisDefavorables,
          estSaisonnier: moisDefavorables.length > 0,
          typesNonRenseignes: eqs.filter((e) => !e.equipment_type_id).length,
        };
      });

      return { data: candidats, error: null };
    } catch (error) {
      logger.error('[tournees] getContratsDus', error);
      return { data: [], error };
    }
  },

  /**
   * Journées de l'horizon par technicien inclus dans l'optimisation.
   * `estAmorcee` = la journée contient déjà au moins un entretien : au-delà de
   * l'horizon ferme, seules ces journées sont proposables (spec §3.2).
   */
  async getJourneesHorizon({ coreOrgId, joursApres = 45 }) {
    try {
      const orgId = await getMajordhomeOrgId(coreOrgId);
      const debut = new Date();
      const fin = new Date();
      fin.setDate(fin.getDate() + joursApres);
      const iso = (d) => d.toISOString().slice(0, 10);

      const [{ data: membres, error: mErr }, { data: rdvs, error: rErr }] = await Promise.all([
        supabase.from('majordhome_team_members')
          .select('id, display_name, calendar_color, default_availability, daily_work_minutes, include_in_routing')
          .eq('org_id', orgId).eq('role', 'technician').eq('include_in_routing', true),
        supabase.from('majordhome_appointments')
          .select('id, scheduled_date, scheduled_start, duration_minutes, appointment_type, client_name, address, city, postal_code')
          .eq('org_id', orgId).gte('scheduled_date', iso(debut)).lte('scheduled_date', iso(fin))
          .not('status', 'in', '(cancelled,no_show)'),
      ]);
      if (mErr) return { data: [], error: mErr };
      if (rErr) return { data: [], error: rErr };

      const ids = (rdvs || []).map((r) => r.id);
      const { data: liens } = ids.length
        ? await supabase.from('majordhome_appointment_technicians')
            .select('appointment_id, technician_id').in('appointment_id', ids)
        : { data: [] };
      const techsParRdv = new Map();
      for (const l of liens || []) {
        if (!techsParRdv.has(l.appointment_id)) techsParRdv.set(l.appointment_id, []);
        techsParRdv.get(l.appointment_id).push(l.technician_id);
      }

      const JOURS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const journees = [];
      for (let i = 0; i <= joursApres; i += 1) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const date = iso(d);
        const jour = JOURS[d.getDay()];
        for (const m of membres || []) {
          const dispo = m.default_availability?.[jour];
          if (!dispo?.active) continue;
          const duJour = (rdvs || []).filter(
            (r) => r.scheduled_date === date && (techsParRdv.get(r.id) || []).includes(m.id),
          );
          journees.push({
            date,
            technicienId: m.id,
            technicienNom: m.display_name,
            couleur: m.calendar_color,
            amplitude: { debut: hhmmEnMinutes(dispo.start), fin: hhmmEnMinutes(dispo.end) },
            budgetMinutes: m.daily_work_minutes || 480,
            rdvs: duJour,
            chargeMinutes: duJour.reduce((s, r) => s + (r.duration_minutes || 60), 0),
            estAmorcee: duJour.some((r) => r.appointment_type === 'maintenance'),
          });
        }
      }
      return { data: journees, error: null };
    } catch (error) {
      logger.error('[tournees] getJourneesHorizon', error);
      return { data: [], error };
    }
  },

  /**
   * Classement des candidats pour une journée donnée. Deux étages : filtre
   * haversine puis matrice Mapbox sur les seuls survivants (spec §4.2).
   */
  async proposerPourJournee({ journee, candidats, orgId, settings, maxCandidats = 20 }) {
    try {
      const reglages = construireReglages(settings);
      const depot = getOrgHeadquarters(settings);
      if (!depot) {
        return { data: [], estime: false, error: new Error('siege_non_configure') };
      }

      const arretsExistants = (journee.rdvs || [])
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => ({
          id: r.id, key: cleCoord(r), dureeMinutes: r.duration_minutes || 60,
        }));

      const centre = barycentre([
        ...(journee.rdvs || []).filter((r) => r.lat != null),
        depot,
      ]) || depot;

      const moisCible = Number(journee.date.slice(5, 7));
      const proches = filtreProximite(candidats, centre, reglages.rayon_filtre_km);

      const scores = {};
      const notes = proches.map((c) => {
        const s = c.moisAnniversaire
          ? scoreEligibilite({
              moisAnniversaire: c.moisAnniversaire,
              moisCible,
              moisDefavorables: c.moisDefavorables,
              toleranceMois: reglages.tolerance_anniversaire_mois,
              moisCreux: reglages.mois_creux,
              estSaisonnier: c.estSaisonnier,
            })
          : { score: 0.5, dansTolerance: false, saisonDefavorable: false, bonusCreux: false };
        scores[c.contractId] = s.score;
        return { ...c, eligibilite: s };
      })
        .sort((a, b) => b.eligibilite.score - a.eligibilite.score)
        .slice(0, maxCandidats);

      const points = [depot, ...arretsExistants.map((a) => {
        const [lat, lng] = a.key.split(',').map(Number);
        return { lat, lng };
      }), ...notes];
      const { data: paires, estime } = await trajetsService.chargerMatrice({ orgId, points });
      const trajet = construireMatrice(paires);

      const ctx = {
        depotKey: cleCoord(depot),
        trajet,
        amplitude: journee.amplitude,
        budgetMinutes: journee.budgetMinutes,
        pause: {
          minutes: reglages.pause_minutes,
          fenetre: [reglages.pause_fenetre[0] * 60, reglages.pause_fenetre[1] * 60],
        },
      };

      const classe = classerCandidats(
        arretsExistants,
        notes.map((c) => ({
          id: c.contractId, key: cleCoord(c), dureeMinutes: c.dureeMinutes, meta: c,
        })),
        ctx,
        { scoreParId: scores },
      );

      return { data: classe, estime, error: null };
    } catch (error) {
      logger.error('[tournees] proposerPourJournee', error);
      return { data: [], estime: false, error };
    }
  },
};
```

- [ ] **Step 2: Vérifier**

Run: `npx vite build` puis `npm run lint`
Attendu : build OK, 0 warning.

- [ ] **Step 3: Commit**

```bash
git add src/shared/services/tournees.service.js && git commit -m "feat(tournees): service d assemblage contrats dus et journees de l horizon"
```

---

### Task 12: Cache keys et hooks

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js`
- Create: `src/shared/hooks/useTournees.js`

**Interfaces:**
- Produces:
  - `tourneeKeys.all(orgId)`, `.contratsDus(orgId)`, `.journees(orgId, joursApres)`, `.propositions(orgId, date, technicienId)`
  - `useContratsDus(orgId)`, `useJourneesHorizon(coreOrgId, joursApres)`, `usePropositions({ journee, candidats, orgId, settings, enabled })`

- [ ] **Step 1: Ajouter la famille de clés**

À la fin de `cacheKeys.js`, en suivant la convention P0.11 :

```js
// --- Tournées d'entretien (optimisation de remplissage) ---
export const tourneeKeys = {
  all: (orgId) => ['tournees', orgId],
  contratsDus: (orgId) => [...tourneeKeys.all(orgId), 'contratsDus'],
  journees: (orgId, joursApres) => [...tourneeKeys.all(orgId), 'journees', joursApres],
  // La proposition dépend de la journée ET de son contenu : la clé inclut la
  // charge, sinon poser un RDV n'invaliderait pas le classement des candidats.
  propositions: (orgId, date, technicienId, chargeMinutes) => [
    ...tourneeKeys.all(orgId), 'propositions', date, technicienId, chargeMinutes,
  ],
};
```

- [ ] **Step 2: Écrire les hooks**

```js
// src/shared/hooks/useTournees.js
import { useQuery } from '@tanstack/react-query';
import { tourneesService } from '@services/tournees.service';
import { tourneeKeys } from './cacheKeys';

export { tourneeKeys };

export function useContratsDus(orgId) {
  return useQuery({
    queryKey: tourneeKeys.contratsDus(orgId),
    queryFn: async () => {
      const { data, error } = await tourneesService.getContratsDus({ orgId });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useJourneesHorizon(coreOrgId, orgId, joursApres = 45) {
  return useQuery({
    queryKey: tourneeKeys.journees(orgId, joursApres),
    queryFn: async () => {
      const { data, error } = await tourneesService.getJourneesHorizon({ coreOrgId, joursApres });
      if (error) throw error;
      return data;
    },
    enabled: !!coreOrgId && !!orgId,
    staleTime: 60 * 1000,
  });
}

export function usePropositions({ journee, candidats, orgId, settings, enabled = true }) {
  return useQuery({
    queryKey: tourneeKeys.propositions(
      orgId, journee?.date, journee?.technicienId, journee?.chargeMinutes,
    ),
    queryFn: async () => {
      const { data, estime, error } = await tourneesService.proposerPourJournee({
        journee, candidats, orgId, settings,
      });
      if (error) throw error;
      return { propositions: data, estime };
    },
    enabled: !!orgId && !!journee && !!candidats?.length && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 3: Vérifier**

Run: `npx vite build` puis `npm run lint`
Attendu : build OK, 0 warning.

- [ ] **Step 4: Commit**

```bash
git add src/shared/hooks/cacheKeys.js src/shared/hooks/useTournees.js && git commit -m "feat(tournees): cache keys et hooks React Query"
```

---

### Task 13: `TourneesTab.jsx` — liste des journées de l'horizon

**Files:**
- Create: `src/apps/artisan/components/tournees/TourneesTab.jsx`
- Modify: `src/apps/artisan/pages/Entretiens.jsx` (5ᵉ onglet)

**Interfaces:**
- Consumes: `useContratsDus`, `useJourneesHorizon`, `useOrgSettings`, `useAuth`.
- Produces: `<TourneesTab />`, monté sous `value="tournees"`.

- [ ] **Step 1: Créer le composant**

Structure attendue :
- Bandeau de tête : nombre de contrats dus, nombre de journées ouvertes, **avertissement si le siège n'est pas configuré** (« Configurez le siège dans Réglages → Organisation → Territoire pour activer le calcul des trajets ») — sans siège, aucun calcul n'est possible et il faut le dire, pas rester vide.
- Une carte par journée, groupées par date, triées par date puis par technicien. Chaque carte affiche : date en français (`formatDateFR`), nom du technicien avec sa pastille `calendar_color`, charge / budget sous forme de barre, nombre de RDV, badge « amorcée » si `estAmorcee`.
- Séparation visuelle entre l'horizon ferme (`≤ horizon_ferme_jours`, toutes les journées) et au-delà (**uniquement `estAmorcee === true`**, cf. spec §3.2).
- Clic sur une carte → ouvre `RemplirJourneePanel` (Task 14).

Filtrage impératif dans le rendu :

```jsx
const reglages = construireReglages(settings);
const limiteFerme = new Date();
limiteFerme.setDate(limiteFerme.getDate() + reglages.horizon_ferme_jours);
const limite = limiteFerme.toISOString().slice(0, 10);

const journeesVisibles = (journees || []).filter(
  (j) => j.date <= limite || j.estAmorcee,
);
```

- [ ] **Step 2: Brancher l'onglet**

Dans `Entretiens.jsx`, ajouter après l'onglet `programmation` :

```jsx
<TabsTrigger value="tournees" className="gap-2 data-[state=active]:bg-white">
  <Route className="w-4 h-4" />
  Tournées
</TabsTrigger>
```

```jsx
<TabsContent value="tournees" className="mt-6">
  <TourneesTab />
</TabsContent>
```

Importer `Route` depuis `lucide-react`. ⚠️ Ne pas importer `Map` de lucide dans ce fichier : il masquerait le constructeur global `Map`.

- [ ] **Step 3: Vérifier**

Run: `npx vite build`

Dans l'app : `/entretiens?tab=tournees` → la liste s'affiche, les journées au-delà de 15 jours sans entretien sont absentes, celles avec entretien sont présentes.

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/components/tournees/TourneesTab.jsx src/apps/artisan/pages/Entretiens.jsx && git commit -m "feat(tournees): onglet Tournees - journees de l horizon"
```

---

### Task 14: `RemplirJourneePanel.jsx` — proposition et pose des RDV

**Files:**
- Create: `src/apps/artisan/components/tournees/RemplirJourneePanel.jsx`

**Interfaces:**
- Consumes: `usePropositions`, `appointmentsService.createAppointmentBatch`, `entretiensService`.
- Produces: `<RemplirJourneePanel journee={} candidats={} onClose={} />`

- [ ] **Step 1: Créer le composant**

Comportement :
1. Appelle `usePropositions`. Pendant le chargement, un état explicite (« Calcul des trajets… »).
2. Liste les propositions : nom du client, ville, durée, **détour en minutes** (`detourMinutes`), heure de passage prévue (`sequenceApres.planning`), badges « hors saison » et « hors fenêtre anniversaire » quand applicable.
3. Cases à cocher. À chaque changement de sélection, **recalculer la séquence** avec les arrêts existants + les sélectionnés, via `sequencerTournee` importé directement — c'est le moteur pur, l'appel est instantané et local. Afficher le récapitulatif : heure de fin, charge totale / budget, ordre de passage.
4. Si `estime === true`, afficher un bandeau ambre : « Temps de trajet estimés (Mapbox indisponible) — les horaires peuvent varier. » Ne jamais masquer cette information.
5. Bouton « Poser N rendez-vous » → `appointmentsService.createAppointmentBatch(slots, shared)` avec :

```js
const slots = ordonnes.map((p) => ({
  date: journee.date,
  startTime: minutesEnHHMM(p.arriveeMinutes),
  endTime: minutesEnHHMM(p.departMinutes),
  duration: p.departMinutes - p.arriveeMinutes,
  technicianIds: [journee.technicienId],
  subject: `Entretien — ${p.meta.clientName}`,
}));

const shared = {
  coreOrgId,
  appointment_type: 'maintenance',
};
// puis, par slot : client_id, client_name, address, city, postal_code du candidat
```

⚠️ `createAppointmentBatch` est best-effort et ne rollback pas : en cas d'erreur partielle, afficher combien ont été posés et lesquels ont échoué. Ne jamais annoncer un succès global sur une pose partielle.

6. Après succès : invalider `tourneeKeys.all(orgId)`, `appointmentKeys.all(orgId)` et `interventionKeys.all(orgId)`, toast, fermeture.

- [ ] **Step 2: Vérifier de bout en bout**

Run: `npx vite build`

Dans l'app, sur une journée creuse réelle : ouvrir le panneau, vérifier que les candidats proposés sont géographiquement cohérents, cocher 3 clients, vérifier que l'heure de fin et l'ordre changent à chaque coche, poser les RDV, puis **vérifier dans le Planning** que les 3 RDV apparaissent aux bons horaires sur le bon technicien.

- [ ] **Step 3: Commit**

```bash
git add src/apps/artisan/components/tournees/RemplirJourneePanel.jsx && git commit -m "feat(tournees): panneau de remplissage d une journee"
```

---

### Task 15: `AlertesTournees.jsx` — les trois filets

**Files:**
- Create: `src/apps/artisan/components/tournees/AlertesTournees.jsx`
- Modify: `src/apps/artisan/components/tournees/TourneesTab.jsx` (montage en tête)

**Interfaces:**
- Consumes: `useContratsDus`, `useJourneesHorizon`.
- Produces: `<AlertesTournees journees={} candidats={} />`

Trois alertes, toutes issues de la spec §3.7 et §10 — leur absence transformerait des échecs en silences.

- [ ] **Step 1: Créer le composant**

```jsx
// Journées sous-remplies qui approchent : une graine isolée qui reste isolée
// jusqu'au jour J fait un aller-retour pour un seul client.
const sousRemplies = journees.filter((j) => {
  const dansSeptJours = joursEntre(aujourdhui, j.date) <= 7;
  return dansSeptJours && j.estAmorcee && j.chargeMinutes < j.budgetMinutes * 0.5;
});

// Retardataires : contrats en fin de fenêtre sans RDV. C'est la SEULE garantie
// que tout le monde ait son entretien — le mail n'en est pas une.
const retardataires = candidats.filter(
  (c) => c.moisAnniversaire && ecartMois(c.moisAnniversaire, moisCourant) >= 2,
);

// Équipements non typés : sans type, la durée est un fallback. Le compteur rend
// visible ce que le fallback masque.
const aTyper = candidats.reduce((n, c) => n + c.typesNonRenseignes, 0);
```

Rendu : trois cartes compactes, chacune avec son décompte, sa liste dépliable et son action (ouvrir la journée / ouvrir la fiche contrat / lien vers `/settings/pricing`). Une alerte à zéro n'est pas affichée.

⚠️ Si `candidats` est `undefined` (chargement ou échec), afficher un état de chargement — **jamais zéro**. Un « 0 retardataire » affiché sur une requête échouée est exactement le mensonge que ces alertes existent pour empêcher.

- [ ] **Step 2: Monter dans l'onglet et vérifier**

Run: `npx vite build`

Dans l'app : le compteur d'équipements à typer doit afficher **111** sur la base actuelle (spec §2). Si un autre nombre s'affiche, c'est que le comptage ne porte pas sur les seuls contrats dus — le vérifier avant de continuer.

- [ ] **Step 3: Lancer toute la suite**

Run: `node --test scripts/tournee/*.test.mjs` puis `npm run lint`
Attendu : 39 tests PASS, 0 warning.

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/components/tournees/ && git commit -m "feat(tournees): alertes journees sous-remplies retardataires et equipements a typer"
```

---

## Self-review

**Couverture de la spec :**

| Section spec | Tâche |
|---|---|
| §3.1 coût d'insertion | Task 6 |
| §3.2 journée-graine, 3 horizons | Task 11 (`estAmorcee`), Task 13 (filtrage) |
| §3.3 deux pénalités continues | Task 3 |
| §3.4 budget ≠ amplitude | Task 1, Task 5, Task 9 |
| §3.5 rang et fenêtre promise | Task 5 (`fenetre`, `rang`), Task 14 (affichage) |
| §3.6 mail cycle | **tranche 3-4, hors périmètre** |
| §3.7 filet retardataires | Task 15 |
| §4.1 moteur pur | Tasks 2-7, verrou en Task 7 |
| §4.2 deux étages + cache | Task 4 (haversine), Task 10 (Matrix + cache) |
| §4.3 advisory lock | **tranche 3, hors périmètre** (aucune écriture concurrente en back-office) |
| §5 modèle de données | Task 1 (moins les tables des tranches 3-4) |
| §6 paramétrage | Task 1 (seed), Task 8, Task 9 |
| §7.A back-office | Tasks 13-15 |
| §10 risques | Task 10 (repli estimé), Task 14 (bandeau), Task 15 (alertes) |

**Écart assumé** : `mois_creux` n'apparaît pas dans le bloc `settings.tournees` de la spec §6 — il y est ajouté ici avec le défaut `[11,12,1,2,3]`, nécessaire au bonus de la Task 3. À reporter dans la spec.

**Cohérence des types :** `cleCoord` produit `"lat,lng"` (3 décimales) et est la seule source de `key` dans tout le plan ; `trajet(from, to)` a la même signature en Tasks 5, 6, 10, 11 ; `dureeMinutes` porte le même nom du candidat à l'arrêt ; `scoreParId` est indexé par `contractId`, qui est aussi l'`id` de l'arrêt en Task 11.
