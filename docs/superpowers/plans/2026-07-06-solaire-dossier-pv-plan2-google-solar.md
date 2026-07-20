# Dossier PV — Google Solar (Tranche 1 · Plan 2/4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrichir la géolocalisation de l'app Solaire avec Google Solar : `buildingInsights` auto-remplit pente/orientation/surface dans `Step1Localisation` (repli manuel silencieux si 404/hors couverture), `dataLayers` produit une heatmap de flux (image d'offre), le tout via un edge `google-solar-proxy` (clé edge-only) calqué sur `pvgis-proxy`, avec cache write-through + garde-fou quota calqués GeoGrid, et persistance de la géométrie dans `pv_dossiers.roof_geometry`.

**Architecture:** Un edge Deno `google-solar-proxy` (`verify_jwt:true` + `requireOrgMembership`) est l'unique porteur de la clé `GOOGLE_SOLAR_API_KEY`. Il lit/écrit un cache `majordhome.google_solar_cache` (write-through, coût marginal 0 sur ré-simulation d'une même adresse), applique un hard cap mensuel/journalier par SKU, et pour la heatmap rasterise le GeoTIFF flux + masque toit en PNG persisté dans Storage. Côté front : une lib pure `googleSolar.js` (invoke edge, parse, fallback), la conversion azimut Google→PVGIS ajoutée à `pvEngine.js` (pure, testée), l'auto-remplissage dans `Step1Localisation` (repli manuel intact), un affichage `FluxHeatmap`, et la persistance `roof_geometry` déclenchée à la sauvegarde de simulation (lazy creation du dossier, socle Plan 1 déjà livré).

**Tech Stack:** Supabase Edge Functions (Deno), `geotiff` (esm.sh) + `fast-png` (esm.sh) pour la rasterisation, React Query v5, `@turf/turf` (déjà installé), Mapbox non requis en Plan 2 (cadastre = Plan 3), Storage `product-documents`, tests purs `node --test`.

**Spec source:** `docs/superpowers/specs/2026-07-06-solaire-chainage-dossier-pv-tranche1-design.md` §5 (5.1 buildingInsights, 5.2 dataLayers/flux, 5.3 cache/quota/coût) + §7 (fichiers) + §8 (sécurité) + §9 (risques : 2 spikes). **Le cadastre IGN (§5.4) est explicitement HORS de ce plan (= Plan 3).**

---

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `src/apps/solaire/lib/pvEngine.js` | + `googleAzimuthToPvgisAspect()` + `degreesToPercent()` (purs, testés) | Modify |
| `scripts/pv-engine.test.mjs` | + tests des 2 helpers (4 cardinaux + pan plat + deg→%) | Modify |
| `scripts/_spike_google_solar_coverage.mjs` | Sonde throwaway couverture Gaillac (imageryQuality réel) | Create (throwaway) |
| `sql/migration_google_solar_cache.sql` | Table cache + vue publique `security_invoker` + RLS + GRANTs | Create |
| `src/shared/hooks/cacheKeys.js` | + famille `googleSolarKeys` (orgId 1er param) | Modify |
| `supabase/functions/google-solar-proxy/geotiff.ts` | Module rasterisation GeoTIFF flux + masque → PNG (spike) | Create |
| `supabase/functions/google-solar-proxy/index.ts` | Edge : auth, cache, Google BI + DL, quota cap, upload flux | Create |
| `supabase/config.toml` | + entrée `[functions.google-solar-proxy] verify_jwt = true` | Modify |
| `src/apps/solaire/lib/googleSolar.js` | Lib front : invoke edge, parse BI, fallback 404, invoke flux | Create |
| `src/shared/services/googleSolar.service.js` | Lecture quota mensuel (vue cache) | Create |
| `src/shared/hooks/useGoogleSolar.js` | Hook `useGoogleSolarQuota(orgId)` | Create |
| `src/apps/solaire/lib/wizardState.js` | + `roofGeometry` dans le state + action `SET_ROOF_GEOMETRY` | Modify |
| `src/apps/solaire/components/dossier/FluxHeatmap.jsx` | Affichage image flux persistée (signed URL) | Create |
| `src/apps/solaire/components/Step1Localisation.jsx` | Auto-remplissage toiture Google Solar + bannière + flux | Modify |
| `src/apps/solaire/pages/Simulateur.jsx` | Persistance `roof_geometry` au save (lazy dossier) | Modify |

**Dépendances entre tâches :** Task 2 (helpers purs) et Task 4 (cache keys) sont indépendantes. Task 3 (migration) + Task 6/7 (edge) + Task 1 (spike) nécessitent un **checkpoint Eric** (prod partagée / clé Google / déploiement). Task 8-11 (front) consomment le contrat de l'edge et peuvent être écrites/commitées avant le déploiement (elles échoueront seulement à l'exécution runtime tant que l'edge n'est pas déployé — comportement fallback géré).

---

## Task 0 : CHECKPOINT Eric — provisionner la clé Google Solar

**Files:** aucun (prérequis d'infra).

- [ ] **Step 1 : Demander à Eric de provisionner la clé**

Actions côté Eric (Google Cloud + Supabase), à confirmer AVANT toute tâche edge/spike :
1. Dans le projet GCP **Towercontrol** (compte `eric.pudebat@gmail.com`, celui de GeoGrid) : activer l'API **Solar API** (`solar.googleapis.com`).
2. Créer une clé API **restreinte à la Solar API uniquement** (API restrictions → Solar API). Pas de restriction de referrer HTTP (appel serveur depuis l'edge).
3. Poser le secret côté Supabase Edge Functions : `GOOGLE_SOLAR_API_KEY=<clé>` (via Dashboard → Edge Functions → Secrets, ou MCP).

- [ ] **Step 2 : Confirmer la disponibilité**

Ne pas continuer les tâches 1, 6, 7 (spikes + edge live) tant qu'Eric n'a pas confirmé la clé posée. Les tâches 2, 3 (fichier), 4, 5, 8, 9, 10, 11 (code) peuvent avancer sans la clé.

---

## Task 1 : Spike couverture Gaillac (throwaway, valide fallback-first + enum imageryQuality)

> **Risque spec §9.1 + §9.3.** But : mesurer empiriquement le taux de couverture Google Solar sur des adresses réelles de Gaillac et **lire les valeurs réelles de `imageryQuality`** (doc Google contradictoire LOW vs BASE). N'engage PAS le design (fallback-first déjà décidé). Script **throwaway** : appelle Google en direct (hors edge) avec la clé en variable d'env locale — ne committe JAMAIS la clé.

**Files:**
- Create: `scripts/_spike_google_solar_coverage.mjs` (préfixe `_spike_` = throwaway, restera pour re-sonde)

- [ ] **Step 1 : Écrire la sonde**

Create `scripts/_spike_google_solar_coverage.mjs` :
```js
// scripts/_spike_google_solar_coverage.mjs — THROWAWAY (spike §9.1/§9.3).
// Sonde la couverture Google Solar sur des adresses réelles de Gaillac + lit imageryQuality.
// Usage : GOOGLE_SOLAR_API_KEY=xxx node scripts/_spike_google_solar_coverage.mjs
// NE COMMITTE JAMAIS LA CLÉ. Résultats à coller dans le message de commit / la note de fin.
const KEY = process.env.GOOGLE_SOLAR_API_KEY;
if (!KEY) { console.error('GOOGLE_SOLAR_API_KEY manquante'); process.exit(1); }

// 8 adresses tests Gaillac (mix centre-ville / périurbain / rural Tarn).
const ADDRESSES = [
  'Place de la Libération, Gaillac',
  '1 Avenue Charles de Gaulle, Gaillac',
  'Route de Cordes, Gaillac',
  'Rue Portal, Gaillac',
  'Chemin de Lavignac, Gaillac',
  '2 Rue de Verdun, Gaillac',
  'Avenue Georges Pompidou, Gaillac',
  'Lieu-dit Brens, 81600',
];

async function geocode(q) {
  const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`);
  const j = await r.json();
  const f = j.features?.[0];
  return f ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: f.properties.label } : null;
}

async function probe(lat, lon, requiredQuality) {
  const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest`
    + `?location.latitude=${lat}&location.longitude=${lon}`
    + `&requiredQuality=${requiredQuality}&key=${KEY}`;
  const r = await fetch(url);
  if (r.status === 404) return { status: 404 };
  if (!r.ok) return { status: r.status, body: (await r.text()).slice(0, 200) };
  const j = await r.json();
  const seg = (j.solarPotential?.roofSegmentStats ?? [])
    .slice().sort((a, b) => (b.stats?.areaMeters2 ?? 0) - (a.stats?.areaMeters2 ?? 0))[0];
  return {
    status: 200,
    imageryQuality: j.imageryQuality,
    segments: j.solarPotential?.roofSegmentStats?.length ?? 0,
    dominant: seg ? { pitch: seg.pitchDegrees, azimuth: seg.azimuthDegrees, area: seg.stats?.areaMeters2 } : null,
  };
}

for (const q of ADDRESSES) {
  const g = await geocode(q);
  if (!g) { console.log(`❌ géocodage échoué : ${q}`); continue; }
  // Sonde MEDIUM (défaut spec rural Tarn) puis HIGH pour comparer.
  const med = await probe(g.lat, g.lon, 'MEDIUM');
  const high = await probe(g.lat, g.lon, 'HIGH');
  console.log(JSON.stringify({ q: g.label, medium: med, high }, null, 0));
}
```

- [ ] **Step 2 : Lancer la sonde (nécessite la clé — checkpoint Task 0)**

Run: `GOOGLE_SOLAR_API_KEY=<clé> node scripts/_spike_google_solar_coverage.mjs`
Expected: 8 lignes JSON. **Observer** : taux de 404 (rural), valeurs réelles de `imageryQuality` (HIGH/MEDIUM/LOW/BASE ?), écart MEDIUM vs HIGH.

- [ ] **Step 3 : Consigner les résultats (décision de design)**

Coller le résumé (taux couverture, valeurs `imageryQuality` observées) dans le message de commit ci-dessous. **Décision** : si `imageryQuality` renvoie une valeur inattendue (ex. `BASE`), noter la liste exacte des valeurs — elle borne tout affichage front (Task 10) et le `requiredQuality` par défaut (Task 6, `MEDIUM`). Aucune modification de code si le fallback-first tient (attendu).

- [ ] **Step 4 : Commit**

```bash
git add scripts/_spike_google_solar_coverage.mjs
git commit -m "chore(solaire): spike couverture Google Solar Gaillac (imageryQuality réel)

Résultats sonde: <couverture X/8, imageryQuality observés: ...>"
```

---

## Task 2 : Helpers purs `googleAzimuthToPvgisAspect` + `degreesToPercent` (TDD)

> **Spec §5.1 conversion azimut + cas pan plat ; §9.5 convention normalisation.** Convention PVGIS : Sud=0, Est=−90, Ouest=+90, Nord=±180. Google : 0=N, 90=E, 180=S, horaire, 0–360. `aspect = normalizeDeg(azimuth − 180)` sur `[-180, +180)`.

**Files:**
- Modify: `src/apps/solaire/lib/pvEngine.js` (insérer après `orientationToAspect`, l. ~20)
- Modify: `scripts/pv-engine.test.mjs` (ajouter des `test(...)`)

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `scripts/pv-engine.test.mjs`, ajouter à l'import (l. 7-12) les 2 nouveaux symboles :
```js
import {
  percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount,
  spreadAnnualToMonthly, evMonthlyConsumption, simultaneityCoeff, costFromGrid,
  computeMonthly, yearlyEconomy, monthlyPayment,
  buildYearlyTable, optimize, buildScenarios, defaultScenarioKwc,
  googleAzimuthToPvgisAspect, degreesToPercent,
} from '../src/apps/solaire/lib/pvEngine.js';
```

Puis ajouter à la fin du fichier :
```js
test('googleAzimuthToPvgisAspect — 4 cardinaux (Google 0=N,90=E,180=S,270=O)', () => {
  assert.equal(googleAzimuthToPvgisAspect(180), 0);    // Sud → 0
  assert.equal(googleAzimuthToPvgisAspect(90), -90);   // Est → -90
  assert.equal(googleAzimuthToPvgisAspect(270), 90);   // Ouest → +90
  assert.equal(googleAzimuthToPvgisAspect(0), -180);   // Nord → -180 (intervalle demi-ouvert [-180,+180))
  assert.equal(googleAzimuthToPvgisAspect(360), -180); // 360 ≡ 0 ≡ Nord
});

test('googleAzimuthToPvgisAspect — cas intermédiaires normalisés', () => {
  assert.equal(googleAzimuthToPvgisAspect(135), -45);  // Sud-Est
  assert.equal(googleAzimuthToPvgisAspect(225), 45);   // Sud-Ouest
});

test('degreesToPercent — inverse de percentToDegrees', () => {
  assert.equal(degreesToPercent(45), 100);             // 45° = 100 %
  assert.ok(Math.abs(degreesToPercent(0)) < 1e-9);     // plat = 0 %
  // aller-retour ~stable
  assert.ok(Math.abs(degreesToPercent(percentToDegrees(30)) - 30) < 1e-6);
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `node --test scripts/pv-engine.test.mjs`
Expected: FAIL — `googleAzimuthToPvgisAspect is not a function` / `degreesToPercent is not a function`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Dans `src/apps/solaire/lib/pvEngine.js`, insérer juste après `orientationToAspect` (après la ligne 20) :
```js
/** Normalise un angle en degrés sur l'intervalle demi-ouvert [-180, +180). */
function normalizeDeg(deg) {
  let d = ((deg + 180) % 360 + 360) % 360 - 180; // ramène dans [-180, +180)
  if (Object.is(d, -0)) d = 0;
  return d;
}

/**
 * Azimut Google Solar (0=N, 90=E, 180=S, 270=O ; horaire 0–360)
 * → aspect PVGIS (S=0, E=-90, O=+90, N=±180). Nord = -180 (intervalle demi-ouvert).
 */
export function googleAzimuthToPvgisAspect(azimuthDeg) {
  return normalizeDeg(azimuthDeg - 180);
}

/** Pente en degrés → pente en % (langage BTP). Inverse de percentToDegrees. */
export function degreesToPercent(deg) {
  return Math.tan((deg * Math.PI) / 180) * 100;
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `node --test scripts/pv-engine.test.mjs`
Expected: PASS (tous les tests existants + les 3 nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/solaire/lib/pvEngine.js scripts/pv-engine.test.mjs
git commit -m "feat(solaire): helpers purs googleAzimuthToPvgisAspect + degreesToPercent (testés 4 cardinaux + pan plat)"
```

---

## Task 3 : Migration `google_solar_cache` (table + vue + RLS + GRANTs)

> **Spec §5.3 + §8.** Pattern de référence : `sql/migration_pv_dossiers.sql` (RLS membre org, vue `security_invoker` mono-table auto-updatable, GRANT service_role). Ici le cache est **partagé par org, pas par dossier** ; l'edge (service_role) écrit via la vue publique (write-through, comme `majordhome_pennylane_customer_lookup`).

**Files:**
- Create: `sql/migration_google_solar_cache.sql`

- [ ] **Step 1 : Écrire le fichier de migration**

Create `sql/migration_google_solar_cache.sql` :
```sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Google Solar — cache write-through (tranche 1, plan 2/4). Spec §5.3.
-- Un toit est stable → coût marginal 0 pour toute ré-simulation sur la même adresse.
-- Cache partagé PAR ORG (pas par dossier). Écrit par l'edge google-solar-proxy (service_role),
-- lu par le front pour le quota (vue security_invoker). Pas de TTL (donnée quasi statique).
-- Pattern : miroir RLS/vue de majordhome.pv_dossiers (charte multi-tenant CLAUDE.md).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Migration 1 : google_solar_cache_create ─────────────────────────────────────────────────────
CREATE TABLE majordhome.google_solar_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),

  -- clé de cache = coord arrondies 5 décimales "lat_lon" (lookup AVANT tout appel Google).
  building_key text NOT NULL,
  building_name text,               -- solarPotential name Google (traçabilité), nullable

  building_insights jsonb,          -- réponse parsée { imageryQuality, segments:[...], dominant:{...} }
  imagery_quality text,             -- HIGH|MEDIUM|LOW|BASE (valeur réelle Google, cf. spike Task 1)
  flux_image_path text,             -- chemin Storage product-documents du PNG flux, nullable

  fetched_at timestamptz,           -- dernier fetch Building Insights (compteur quota SKU BI)
  flux_fetched_at timestamptz,      -- dernier fetch Data Layers/flux (compteur quota SKU DL)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT google_solar_cache_org_key_uq UNIQUE (org_id, building_key)
);

CREATE INDEX idx_gsc_org_fetched ON majordhome.google_solar_cache(org_id, fetched_at);
CREATE INDEX idx_gsc_org_flux    ON majordhome.google_solar_cache(org_id, flux_fetched_at);

ALTER TABLE majordhome.google_solar_cache ENABLE ROW LEVEL SECURITY;

-- SELECT = membre de l'org (le front lit pour le quota ; l'edge service_role bypasse la RLS).
CREATE POLICY gsc_select ON majordhome.google_solar_cache
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

-- Pas d'écriture directe depuis le front : INSERT/UPDATE réservés au service_role (edge write-through).
GRANT SELECT ON majordhome.google_solar_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE ON majordhome.google_solar_cache TO service_role;

-- ── Migration 2 : google_solar_cache_public_view ────────────────────────────────────────────────
-- Miroir simple mono-table (pas de JOIN) → auto-updatable ; l'edge écrit via cette vue.
CREATE VIEW public.majordhome_google_solar_cache
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.google_solar_cache;

GRANT SELECT ON public.majordhome_google_solar_cache TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.majordhome_google_solar_cache TO service_role;
```

- [ ] **Step 2 : CHECKPOINT Eric — appliquer la migration (prod Supabase partagée)**

⚠️ **Prod partagée avec d'autres apps** (charte CLAUDE.md). NE PAS appliquer sans le feu vert d'Eric. Une fois validé, appliquer via MCP Supabase `apply_migration` en 2 migrations nommées : `google_solar_cache_create`, `google_solar_cache_public_view`.

- [ ] **Step 3 : Vérifier l'application (MCP `execute_sql`)**

```sql
SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.google_solar_cache'::regclass;              -- → true
SELECT count(*) FROM pg_policies WHERE schemaname='majordhome' AND tablename='google_solar_cache';       -- → 1
SELECT has_table_privilege('service_role','majordhome.google_solar_cache','INSERT');                     -- → true
SELECT has_table_privilege('service_role','majordhome.google_solar_cache','SELECT');                     -- → true
SELECT is_insertable_into FROM information_schema.tables
  WHERE table_schema='public' AND table_name='majordhome_google_solar_cache';                            -- → YES
```
Expected: `true`, `1`, `true`, `true`, `YES`.

- [ ] **Step 4 : Commit la copie versionnée**

```bash
git add sql/migration_google_solar_cache.sql
git commit -m "feat(solaire): migration google_solar_cache (cache write-through org-scopé + vue security_invoker)"
```

---

## Task 4 : Cache keys `googleSolarKeys`

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` (après la famille `pvDossierKeys`, l. ~345)

- [ ] **Step 1 : Ajouter la famille de clés**

Dans `src/shared/hooks/cacheKeys.js`, juste après le bloc `pvDossierKeys`, insérer :
```js
// --- Google Solar (cache/quota) ---
export const googleSolarKeys = {
  all: (orgId) => ['googleSolar', orgId],
  quota: (orgId) => [...googleSolarKeys.all(orgId), 'quota'],
};
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Expected: build OK (clé seulement déclarée).

- [ ] **Step 3 : Commit**

```bash
git add src/shared/hooks/cacheKeys.js
git commit -m "feat(solaire): cache keys googleSolarKeys (orgId 1er param)"
```

---

## Task 5 : Spike GeoTIFF → PNG (module `geotiff.ts` de l'edge)

> **Risque spec §9.4.** Dépendance de rasterisation côté edge (décode GeoTIFF flux float + masque toit, colorise, exporte PNG). But : valider la chaîne technique Deno tôt. **Repli acceptable T1** : si le spike traîne, livrer d'abord le `building_insights` (Task 6) et brancher la heatmap (Task 7) juste après — **sans bloquer le CERFA**. La palette de flux DOIT être la **rampe officielle Google** (récupérée depuis le repo `googlemaps/solar-potential`, `src/lib/solar.ts` → `palettes.annualFlux`) ; une rampe fallback documentée est fournie en attendant.

**Files:**
- Create: `supabase/functions/google-solar-proxy/geotiff.ts`

- [ ] **Step 1 : Récupérer la palette officielle Google (spike)**

Ouvrir `https://github.com/googlemaps/solar-potential/blob/main/src/lib/solar.ts` et relever `palettes.annualFlux` (liste de hex). La coller dans `FLUX_RAMP` ci-dessous (remplacer le fallback). Si inaccessible : garder le fallback (viridis-like) et le noter dans le commit.

- [ ] **Step 2 : Écrire le module de rasterisation**

Create `supabase/functions/google-solar-proxy/geotiff.ts` :
```ts
// geotiff.ts — rasterisation heatmap de flux Google Solar (spec §5.2).
// Décode le GeoTIFF annualFlux (float32 mono-bande, kWh/kW/an) + le masque toit (mono-bande 0/1),
// colorise avec la rampe officielle Google, applique le masque (transparent hors toit) → PNG.
import { fromArrayBuffer } from "https://esm.sh/geotiff@2.1.3";
import { encode as encodePng } from "https://esm.sh/fast-png@6.2.0";

// Rampe annualFlux — REMPLACER par palettes.annualFlux du repo googlemaps/solar-potential (spike Step 1).
// Fallback documenté (dégradé violet→ambre, lisible sur imagerie) tant que l'exacte n'est pas relevée.
const FLUX_RAMP: [number, number, number][] = [
  [0x31, 0x1B, 0x92], [0x49, 0x27, 0xB0], [0x5E, 0x35, 0xB1], [0x7E, 0x57, 0xC2],
  [0xB3, 0x9D, 0xDB], [0xFF, 0xEC, 0xB3], [0xFF, 0xD5, 0x4F], [0xFF, 0xB3, 0x00],
  [0xFF, 0x6F, 0x00], [0xE6, 0x51, 0x00],
];

// Flux annuel typique 0..~1800 kWh/kW/an ; borne haute paramétrable (spike peut affiner).
const DEFAULT_MAX_FLUX = 1800;

async function readBand(buf: ArrayBuffer): Promise<{ data: ArrayLike<number>; width: number; height: number }> {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return { data: rasters[0] as ArrayLike<number>, width: image.getWidth(), height: image.getHeight() };
}

function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (FLUX_RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = FLUX_RAMP[i];
  const b = FLUX_RAMP[Math.min(i + 1, FLUX_RAMP.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Colorise le flux + applique le masque toit → PNG (Uint8Array). Transparent hors toit. */
export async function colorizeFluxToPng(
  fluxBuf: ArrayBuffer,
  maskBuf: ArrayBuffer,
  maxFlux = DEFAULT_MAX_FLUX,
): Promise<Uint8Array> {
  const flux = await readBand(fluxBuf);
  const mask = await readBand(maskBuf);
  const { width, height, data } = flux;
  // flux et masque partagent le pixelSizeMeters de la réponse dataLayers → mêmes dimensions.
  const n = width * height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const m = mask.data[i] ?? 0;
    if (!m) { out[i * 4 + 3] = 0; continue; } // hors toit → transparent
    const [r, g, b] = ramp((data[i] as number) / maxFlux);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return encodePng({ width, height, data: out, channels: 4, depth: 8 });
}
```

- [ ] **Step 3 : Validation technique (dans l'edge, à la 1ʳᵉ exécution live de Task 7)**

Ce module n'est testable qu'avec un vrai GeoTIFF (URLs Google éphémères). Sa validation réelle se fait au 1ᵉʳ appel `data_layers` de l'edge (Task 7 Step 4) : vérifier que le PNG uploadé s'ouvre et montre une heatmap plausible cantonnée à la toiture. **Si le décodage `geotiff@2.1.3` échoue en Deno** (import ou readRasters) : essayer `https://esm.sh/geotiff@2.1.3?target=deno`, sinon `https://cdn.skypack.dev/geotiff`. Consigner la version qui marche.

- [ ] **Step 4 : Commit**

```bash
git add supabase/functions/google-solar-proxy/geotiff.ts
git commit -m "feat(solaire): module geotiff edge (flux Google Solar + masque toit → PNG)"
```

---

## Task 6 : Edge `google-solar-proxy` — branche `building_insights` (+ cache + quota)

> **Spec §5.1 + §5.3 + §8.** Miroir de `supabase/functions/pvgis-proxy/index.ts` : `verify_jwt:true`, `requireOrgMembership`, CORS, timeout, `sanitizeError`. `auth.supabase` est le client **service_role** (bypasse RLS) → sert au cache write-through et au Storage. Clé Google jamais exposée au client.

**Files:**
- Create: `supabase/functions/google-solar-proxy/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1 : Écrire l'edge (branche building_insights + squelette data_layers)**

Create `supabase/functions/google-solar-proxy/index.ts` :
```ts
// google-solar-proxy — relais Google Solar API (clé edge-only). Spec §5.
// verify_jwt:true + requireOrgMembership. Cache write-through majordhome.google_solar_cache
// (coût marginal 0 sur ré-sim d'une même adresse). Hard cap mensuel/journalier par SKU.
// mode: 'building_insights' (géométrie toit) | 'data_layers' (heatmap flux) | 'both'.
import { requireOrgMembership, jsonResponse, sanitizeError, buildCorsHeaders } from "../_shared/auth.ts";
import { colorizeFluxToPng } from "./geotiff.ts";

const SOLAR = "https://solar.googleapis.com/v1";
const KEY = Deno.env.get("GOOGLE_SOLAR_API_KEY") || "";
const CACHE_VIEW = "majordhome_google_solar_cache";
const BUCKET = "product-documents";

// Paliers gratuits Google (spec §5.1/§5.2) + cap journalier anti-emballement (≈ palier/30).
const LIMITS = {
  building_insights: { monthly: 10000, daily: 350 },
  data_layers: { monthly: 1000, daily: 40 },
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildingKeyOf(lat: number, lon: number): string {
  return `${lat.toFixed(5)}_${lon.toFixed(5)}`;
}

class QuotaError extends Error {}

// Compte les fetchs Google réels (cache misses) du mois/jour en cours pour un SKU.
async function enforceCap(supabase: any, orgId: string, kind: "building_insights" | "data_layers") {
  const col = kind === "data_layers" ? "flux_fetched_at" : "fetched_at";
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { count: m } = await supabase.from(CACHE_VIEW).select("id", { count: "exact", head: true })
    .eq("org_id", orgId).gte(col, monthStart);
  if ((m ?? 0) >= LIMITS[kind].monthly) throw new QuotaError(`quota_monthly_${kind}`);
  const { count: d } = await supabase.from(CACHE_VIEW).select("id", { count: "exact", head: true })
    .eq("org_id", orgId).gte(col, dayStart);
  if ((d ?? 0) >= LIMITS[kind].daily) throw new QuotaError(`quota_daily_${kind}`);
}

// Parse la réponse buildingInsights → { imageryQuality, name, segments[], dominant }.
function parseBuildingInsights(j: any) {
  const stats = (j.solarPotential?.roofSegmentStats ?? []).map((s: any) => ({
    pitch_deg: s.pitchDegrees ?? null,
    azimuth_google_deg: s.azimuthDegrees ?? null,
    area_m2: s.stats?.areaMeters2 ?? null,
    center: s.center ?? null,
  }));
  const dominant = stats.slice().sort((a: any, b: any) => (b.area_m2 ?? 0) - (a.area_m2 ?? 0))[0] ?? null;
  return { imageryQuality: j.imageryQuality ?? null, name: j.name ?? null, segments: stats, dominant };
}

async function readCache(supabase: any, orgId: string, key: string) {
  const { data } = await supabase.from(CACHE_VIEW).select("*")
    .eq("org_id", orgId).eq("building_key", key).maybeSingle();
  return data ?? null;
}

async function upsertCache(supabase: any, orgId: string, key: string, patch: Record<string, unknown>) {
  const existing = await readCache(supabase, orgId, key);
  if (existing) {
    await supabase.from(CACHE_VIEW).update({ ...patch, updated_at: new Date().toISOString() })
      .eq("org_id", orgId).eq("building_key", key);
  } else {
    await supabase.from(CACHE_VIEW).insert({ org_id: orgId, building_key: key, ...patch });
  }
}

async function fetchGeoTiff(url: string): Promise<ArrayBuffer> {
  const withKey = url + (url.includes("?") ? "&" : "?") + "key=" + KEY;
  const res = await fetch(withKey);
  if (!res.ok) throw new Error(`geoTiff ${res.status}`);
  return await res.arrayBuffer();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    const auth = await requireOrgMembership(req);
    if (!auth.ok) return auth.response;
    const { orgId, supabase } = auth; // supabase = service_role (bypasse RLS, écrit cache + storage)

    if (!KEY) return jsonResponse({ error: "GOOGLE_SOLAR_API_KEY absente" }, 500, req);

    const body = await req.json().catch(() => ({}));
    const mode: string = body.mode || "building_insights";
    const lat = num(body.lat);
    const lon = num(body.lon);
    const requiredQuality: string = body.requiredQuality || "MEDIUM";
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return jsonResponse({ error: "lat/lon invalides" }, 400, req);
    }

    const key = buildingKeyOf(lat, lon);
    let cache = await readCache(supabase, orgId, key);
    const result: Record<string, unknown> = {};

    // ── Building Insights (géométrie toit) ──────────────────────────────────────────────
    if (mode === "building_insights" || mode === "both") {
      if (cache?.building_insights) {
        result.buildingInsights = cache.building_insights;
        result.imageryQuality = cache.imagery_quality;
      } else {
        await enforceCap(supabase, orgId, "building_insights");
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        let res: Response;
        try {
          res = await fetch(
            `${SOLAR}/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lon}`
            + `&requiredQuality=${requiredQuality}&key=${KEY}`,
            { signal: ctrl.signal },
          );
        } finally { clearTimeout(timer); }

        if (res.status === 404) {
          // Cas nominal (spec §5.3) : pas de bâtiment / qualité insuffisante → repli manuel côté front.
          return jsonResponse({ notFound: true }, 200, req);
        }
        if (!res.ok) {
          const detail = (await res.text().catch(() => "")).slice(0, 300);
          return jsonResponse({ error: `Google BI ${res.status}`, detail }, 502, req);
        }
        const parsed = parseBuildingInsights(await res.json());
        await upsertCache(supabase, orgId, key, {
          building_insights: parsed, imagery_quality: parsed.imageryQuality,
          building_name: parsed.name, fetched_at: new Date().toISOString(),
        });
        cache = await readCache(supabase, orgId, key);
        result.buildingInsights = parsed;
        result.imageryQuality = parsed.imageryQuality;
      }
    }

    // ── Data Layers (heatmap flux) — branche complétée en Task 7 ─────────────────────────
    if (mode === "data_layers" || mode === "both") {
      result.fluxImagePath = cache?.flux_image_path ?? null;
      // (Task 7 : fetch dataLayers + geoTiff + colorizeFluxToPng + upload + upsertCache)
    }

    return jsonResponse(result, 200, req);
  } catch (err) {
    if (err instanceof QuotaError) {
      return jsonResponse({ error: "Quota Google Solar atteint", code: err.message }, 429, req);
    }
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return jsonResponse(
      { error: aborted ? "Google Solar ne répond pas (timeout)" : sanitizeError(err, "google-solar-proxy error") },
      aborted ? 504 : 500, req,
    );
  }
});
```

- [ ] **Step 2 : Ajouter l'entrée `config.toml`**

Dans `supabase/config.toml`, à côté de `[functions.pvgis-proxy]`, ajouter :
```toml
# Solaire — proxy Google Solar (clé edge-only, cache write-through)
[functions.google-solar-proxy]
verify_jwt = true
```

- [ ] **Step 3 : CHECKPOINT Eric — déployer l'edge (prod partagée)**

⚠️ Ne pas déployer sans le feu vert d'Eric. Déployer via MCP Supabase `deploy_edge_function` (name `google-solar-proxy`, `verify_jwt:true`), en incluant **les deux fichiers** : `index.ts` ET `../_shared/auth.ts` (résolution du bundler) ET `./geotiff.ts`.

- [ ] **Step 4 : Vérifier la branche building_insights en live**

Depuis le front authentifié (ou via un appel `functions.invoke` de test), sur une adresse Gaillac **couverte** (issue du spike Task 1) : `invoke('google-solar-proxy', { body: { mode:'building_insights', lat, lon } })`. Attendu : `{ buildingInsights: { dominant:{pitch_deg,azimuth_google_deg,area_m2}, segments:[...] }, imageryQuality:'MEDIUM'|... }`. Sur une adresse non couverte : `{ notFound: true }`. Vérifier qu'une **2ᵉ** invocation identique ne rappelle PAS Google (ligne de cache présente : `SELECT building_key, fetched_at FROM majordhome_google_solar_cache`).

- [ ] **Step 5 : Commit**

```bash
git add supabase/functions/google-solar-proxy/index.ts supabase/config.toml
git commit -m "feat(solaire): edge google-solar-proxy — building_insights + cache write-through + quota cap"
```

---

## Task 7 : Edge `google-solar-proxy` — branche `data_layers` (heatmap flux PNG)

> **Spec §5.2.** Complète la branche `data_layers` : fetch `dataLayers:get` (vue `IMAGERY_AND_ANNUAL_FLUX_LAYERS`), récupère `annualFluxUrl` + `maskUrl` (GeoTIFF, expirent 1 h), rasterise via `colorizeFluxToPng`, persiste le PNG dans Storage `${orgId}/solaire/flux/${buildingKey}.png` (cache-scopé, PAS dossier-scopé — cf. décision ci-dessous), écrit `flux_image_path` + `flux_fetched_at` dans le cache.

> **Conflit tranché (spec §5.2 vs §5.3, ne pas moyenner)** : la spec §5.2 propose un chemin `dossiers/${dossierId}/flux.png`, mais le dossier n'existe pas encore à la géoloc (créé LAZY au save, §4.1) et le cache est **partagé par org, pas par dossier** (§5.3). **Décision : chemin cache-scopé `${orgId}/solaire/flux/${buildingKey}.png`** — réutilisable sur toute ré-sim de la même adresse, cohérent avec le cache. Le dossier copiera ce chemin dans `roof_geometry.flux_image_path` à sa création (Task 11).

**Files:**
- Modify: `supabase/functions/google-solar-proxy/index.ts` (branche data_layers)

- [ ] **Step 1 : Remplacer le squelette data_layers par l'implémentation complète**

Dans `index.ts`, remplacer le bloc :
```ts
    // ── Data Layers (heatmap flux) — branche complétée en Task 7 ─────────────────────────
    if (mode === "data_layers" || mode === "both") {
      result.fluxImagePath = cache?.flux_image_path ?? null;
      // (Task 7 : fetch dataLayers + geoTiff + colorizeFluxToPng + upload + upsertCache)
    }
```
par :
```ts
    // ── Data Layers (heatmap flux) ───────────────────────────────────────────────────────
    if (mode === "data_layers" || mode === "both") {
      if (cache?.flux_image_path) {
        result.fluxImagePath = cache.flux_image_path;
      } else {
        try {
          await enforceCap(supabase, orgId, "data_layers");
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20_000);
          let dlRes: Response;
          try {
            dlRes = await fetch(
              `${SOLAR}/dataLayers:get?location.latitude=${lat}&location.longitude=${lon}`
              + `&radiusMeters=50&view=IMAGERY_AND_ANNUAL_FLUX_LAYERS`
              + `&requiredQuality=${requiredQuality}&pixelSizeMeters=0.5&key=${KEY}`,
              { signal: ctrl.signal },
            );
          } finally { clearTimeout(timer); }

          if (dlRes.status === 404) {
            result.fluxImagePath = null; // pas de couche flux → offre sans heatmap (jamais bloquant)
          } else if (!dlRes.ok) {
            result.fluxImagePath = null;
            result.fluxError = `Google DL ${dlRes.status}`;
          } else {
            const dl = await dlRes.json();
            if (dl.annualFluxUrl && dl.maskUrl) {
              const [fluxBuf, maskBuf] = await Promise.all([
                fetchGeoTiff(dl.annualFluxUrl),
                fetchGeoTiff(dl.maskUrl),
              ]);
              const png = await colorizeFluxToPng(fluxBuf, maskBuf);
              const path = `${orgId}/solaire/flux/${key}.png`;
              const { error: upErr } = await supabase.storage.from(BUCKET)
                .upload(path, png, { contentType: "image/png", upsert: true });
              if (upErr) throw upErr;
              await upsertCache(supabase, orgId, key, {
                flux_image_path: path, flux_fetched_at: new Date().toISOString(),
              });
              result.fluxImagePath = path;
            } else {
              result.fluxImagePath = null;
            }
          }
        } catch (fluxErr) {
          // La heatmap ne bloque JAMAIS le parcours (spec §5.3). On log, on renvoie sans flux.
          if (fluxErr instanceof QuotaError) throw fluxErr; // le cap remonte en 429
          result.fluxImagePath = null;
          result.fluxError = sanitizeError(fluxErr, "flux error");
        }
      }
    }
```

- [ ] **Step 2 : CHECKPOINT Eric — redéployer l'edge**

Redéployer via MCP `deploy_edge_function` (mêmes 3 fichiers : `index.ts`, `../_shared/auth.ts`, `./geotiff.ts`).

- [ ] **Step 3 : Vérifier la heatmap en live + valider le module geotiff (Task 5 Step 3)**

`invoke('google-solar-proxy', { body: { mode:'data_layers', lat, lon } })` sur une adresse couverte. Attendu : `{ fluxImagePath: '<orgId>/solaire/flux/<key>.png' }`. **Ouvrir le PNG** (via signed URL Storage) : heatmap plausible, colorée, cantonnée à la toiture (transparent ailleurs). Si le décode `geotiff` a échoué → appliquer le repli d'import (Task 5 Step 3). Vérifier idempotence (2ᵉ appel → même path, pas de nouvel upload/fetch Google).

- [ ] **Step 4 : Commit**

```bash
git add supabase/functions/google-solar-proxy/index.ts
git commit -m "feat(solaire): edge google-solar-proxy — data_layers heatmap flux (GeoTIFF→PNG persisté)"
```

---

## Task 8 : Lib front `googleSolar.js` (invoke edge + parse + fallback)

> **Spec §5.1/§5.2/§7.** Pattern de référence : `src/apps/solaire/lib/pvgis.js` (`supabase.functions.invoke`, retour `{ data, error }`, `logger.error`). Applique la conversion azimut Google→PVGIS (Task 2) au segment dominant.

**Files:**
- Create: `src/apps/solaire/lib/googleSolar.js`

- [ ] **Step 1 : Écrire la lib**

Create `src/apps/solaire/lib/googleSolar.js` :
```js
// src/apps/solaire/lib/googleSolar.js
// Accès Google Solar via l'edge google-solar-proxy (clé edge-only). Repli manuel si 404/hors couverture.
import { supabase } from '@lib/supabaseClient';
import { logger } from '@lib/logger';
import { googleAzimuthToPvgisAspect } from './pvEngine';

/**
 * Géométrie de toiture Google Solar (buildingInsights).
 * → { data: { source:'google_solar'|'manual', imageryQuality, segments, dominant, fluxImagePath }, error }
 *   dominant = { pitch_deg, azimuth_google_deg, aspect_pvgis, area_m2 } ou null.
 *   source==='manual' (avec data non-null) = repli silencieux (404/hors couverture) : l'UI garde la saisie.
 */
export async function fetchBuildingInsights({ lat, lon, requiredQuality = 'MEDIUM' }) {
  try {
    const { data, error } = await supabase.functions.invoke('google-solar-proxy', {
      body: { mode: 'building_insights', lat, lon, requiredQuality },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.notFound) {
      return { data: { source: 'manual', imageryQuality: null, segments: [], dominant: null, fluxImagePath: null }, error: null };
    }
    const bi = data?.buildingInsights;
    const d = bi?.dominant
      ? {
          pitch_deg: bi.dominant.pitch_deg,
          azimuth_google_deg: bi.dominant.azimuth_google_deg,
          aspect_pvgis: bi.dominant.azimuth_google_deg != null
            ? googleAzimuthToPvgisAspect(bi.dominant.azimuth_google_deg)
            : 0,
          area_m2: bi.dominant.area_m2,
        }
      : null;
    // Cas pan plat (spec §5.1) : pente ~0 → ne pas propager l'azimut arbitraire, forcer Sud (aspect 0).
    if (d && (d.pitch_deg == null || d.pitch_deg < 1)) {
      d.pitch_deg = 0;
      d.aspect_pvgis = 0;
    }
    return {
      data: {
        source: 'google_solar',
        imageryQuality: data?.imageryQuality ?? bi?.imageryQuality ?? null,
        segments: bi?.segments ?? [],
        dominant: d,
        fluxImagePath: data?.fluxImagePath ?? null,
      },
      error: null,
    };
  } catch (err) {
    logger.error('[googleSolar] fetchBuildingInsights', err);
    // Échec réseau/quota → repli manuel silencieux, jamais bloquant (spec §5.3).
    return { data: { source: 'manual', imageryQuality: null, segments: [], dominant: null, fluxImagePath: null }, error: err };
  }
}

/** Heatmap de flux (dataLayers) → { data: { fluxImagePath: string|null }, error }. Non bloquant. */
export async function fetchFluxHeatmap({ lat, lon }) {
  try {
    const { data, error } = await supabase.functions.invoke('google-solar-proxy', {
      body: { mode: 'data_layers', lat, lon },
    });
    if (error) throw error;
    return { data: { fluxImagePath: data?.fluxImagePath ?? null }, error: null };
  } catch (err) {
    logger.error('[googleSolar] fetchFluxHeatmap', err);
    return { data: { fluxImagePath: null }, error: err };
  }
}
```

- [ ] **Step 2 : Vérifier le build**

Run: `npx vite build`
Expected: build OK.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/solaire/lib/googleSolar.js
git commit -m "feat(solaire): lib front googleSolar (buildingInsights + flux via edge, repli manuel)"
```

---

## Task 9 : Quota — service + hook `useGoogleSolarQuota`

> **Spec §5.3.** Miroir de `useGeoGridQuota` : compteur mensuel bornes UTC strictes, comptant **séparément** Building Insights (10k) et Data Layers (1k) depuis la vue cache.

**Files:**
- Create: `src/shared/services/googleSolar.service.js`
- Create: `src/shared/hooks/useGoogleSolar.js`

- [ ] **Step 1 : Écrire le service (lecture quota)**

Create `src/shared/services/googleSolar.service.js` :
```js
// src/shared/services/googleSolar.service.js
// Lecture du quota Google Solar du mois calendaire en cours (bornes UTC) depuis la vue cache.
// Compte les fetchs Google réels (cache misses) par SKU : Building Insights vs Data Layers.
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const CACHE_VIEW = 'majordhome_google_solar_cache';

export const googleSolarService = {
  async getMonthlyUsage(orgId) {
    return withErrorHandling(async () => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
      const [bi, dl] = await Promise.all([
        supabase.from(CACHE_VIEW).select('id', { count: 'exact', head: true })
          .eq('org_id', orgId).gte('fetched_at', monthStart),
        supabase.from(CACHE_VIEW).select('id', { count: 'exact', head: true })
          .eq('org_id', orgId).gte('flux_fetched_at', monthStart),
      ]);
      if (bi.error) throw bi.error;
      if (dl.error) throw dl.error;
      return {
        buildingInsightsUsed: bi.count ?? 0,
        dataLayersUsed: dl.count ?? 0,
        monthStart,
      };
    }, 'googleSolar.getMonthlyUsage');
  },
};
```

- [ ] **Step 2 : Écrire le hook**

Create `src/shared/hooks/useGoogleSolar.js` :
```js
// src/shared/hooks/useGoogleSolar.js
import { useQuery } from '@tanstack/react-query';
import { googleSolarService } from '@services/googleSolar.service';
import { googleSolarKeys } from './cacheKeys';

export { googleSolarKeys } from './cacheKeys';

// Paliers gratuits Google (spec §5.1/§5.2).
const BI_LIMIT = 10000;
const DL_LIMIT = 1000;

/** Consommation Google Solar du mois UTC en cours (informative). */
export function useGoogleSolarQuota(orgId) {
  return useQuery({
    queryKey: googleSolarKeys.quota(orgId),
    queryFn: async () => {
      const { data, error } = await googleSolarService.getMonthlyUsage(orgId);
      if (error) throw error;
      const bi = data?.buildingInsightsUsed || 0;
      const dl = data?.dataLayersUsed || 0;
      return {
        buildingInsightsUsed: bi,
        dataLayersUsed: dl,
        buildingInsightsLimit: BI_LIMIT,
        dataLayersLimit: DL_LIMIT,
        biPercentUsed: Math.round((bi / BI_LIMIT) * 100),
        dlPercentUsed: Math.round((dl / DL_LIMIT) * 100),
        monthStart: data?.monthStart,
      };
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3 : Vérifier le build**

Run: `npx vite build`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/shared/services/googleSolar.service.js src/shared/hooks/useGoogleSolar.js
git commit -m "feat(solaire): quota Google Solar (service + hook useGoogleSolarQuota, UTC, par SKU)"
```

---

## Task 10 : `Step1Localisation` — auto-remplissage toiture + `FluxHeatmap` + state

> **Spec §5.1 + §3 (repli SILENCIEUX).** À la géoloc, appeler `fetchBuildingInsights` : si couvert → auto-remplir pente(%)/orientation/surface + bannière « pré-rempli via Google Solar » + flux ; si 404/échec → **la saisie manuelle reste intacte** (aucun blocage). L'utilisateur peut toujours corriger à la main (l'auto-fill ne re-déclenche qu'au changement de coordonnées).

**Files:**
- Modify: `src/apps/solaire/lib/wizardState.js`
- Create: `src/apps/solaire/components/dossier/FluxHeatmap.jsx`
- Modify: `src/apps/solaire/components/Step1Localisation.jsx`

- [ ] **Step 1 : Ajouter `roofGeometry` au state du wizard**

Dans `src/apps/solaire/lib/wizardState.js` :

1. Dans `initialWizardState`, ajouter après la ligne `pvgis: null,` (l. 13) :
```js
    roofGeometry: null,     // { source, imageryQuality, segments, dominant, flux_image_path } — Google Solar
```

2. Dans `wizardReducer`, modifier `SET_LOCATION` (l. 22) pour invalider aussi la géométrie stale, et ajouter l'action `SET_ROOF_GEOMETRY` :
```js
    case 'SET_LOCATION': return { ...state, location: { ...state.location, ...action.patch }, pvgis: null, roofGeometry: null };
    case 'SET_ROOF_GEOMETRY': return { ...state, roofGeometry: action.value };
```

- [ ] **Step 2 : Créer le composant `FluxHeatmap`**

Create `src/apps/solaire/components/dossier/FluxHeatmap.jsx` :
```jsx
// src/apps/solaire/components/dossier/FluxHeatmap.jsx
// Affiche l'image de flux persistée (heatmap Google Solar) via une signed URL Storage.
import { useEffect, useState } from 'react';
import { Sun } from 'lucide-react';
import { storageService } from '@services/storage.service';
import { logger } from '@lib/logger';

const BUCKET = 'product-documents';

export default function FluxHeatmap({ fluxImagePath }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!fluxImagePath) { setUrl(null); return undefined; }
    storageService.getSignedUrl(BUCKET, fluxImagePath)
      .then(({ url: signed, error }) => {
        if (error) throw error;
        if (!cancelled) setUrl(signed);
      })
      .catch((err) => logger.warn('[solaire] flux signed url', err));
    return () => { cancelled = true; };
  }, [fluxImagePath]);

  if (!fluxImagePath || !url) return null;
  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-secondary-800">
        <Sun className="w-4 h-4 text-[#F5C542]" /> Ensoleillement de la toiture
      </div>
      <img src={url} alt="Heatmap de flux solaire annuel" className="w-full rounded-lg border border-secondary-200" />
      <p className="text-xs text-secondary-500">Flux solaire annuel (source : Google Solar).</p>
    </div>
  );
}
```

> **Note :** confirmer la signature de `storageService.getSignedUrl` — d'après la reconnaissance elle est `getSignedUrl(bucket, path)` et renvoie `{ url, error }`. Si elle renvoie `{ signedUrl }` ou `{ data }`, adapter la destructuration ici.

- [ ] **Step 3 : Câbler l'auto-remplissage dans `Step1Localisation`**

Dans `src/apps/solaire/components/Step1Localisation.jsx` :

1. Imports (compléter l'existant) :
```js
import { useState, useEffect, useRef } from 'react';
import { MapPin, LocateFixed, Loader2, AlertTriangle, ArrowRight, Check, Sparkles } from 'lucide-react';
import { percentToDegrees, orientationToAspect, maxPowerKwc, panelsCount, degreesToPercent } from '../lib/pvEngine';
import { fetchBuildingInsights, fetchFluxHeatmap } from '../lib/googleSolar';
import FluxHeatmap from './dossier/FluxHeatmap';
```

2. Signature : ajouter les props `roofGeometry` et `onRoofGeometry` :
```js
export default function Step1Localisation({ location, roof, config, roofGeometry, onLocation, onRoof, onRoofGeometry, onNext }) {
```

3. Après les `useState` existants, ajouter l'état d'auto-remplissage + l'effet Google Solar :
```js
  const [solarStatus, setSolarStatus] = useState('idle'); // idle|loading|filled|manual
  const solarFetchedRef = useRef(null);

  // Auto-remplissage toiture via Google Solar au changement de coordonnées (repli manuel si 404).
  useEffect(() => {
    if (location.lat == null || location.lon == null) return;
    const coordKey = `${location.lat.toFixed(5)},${location.lon.toFixed(5)}`;
    if (solarFetchedRef.current === coordKey) return; // déjà tenté pour ces coords
    solarFetchedRef.current = coordKey;
    let cancelled = false;
    setSolarStatus('loading');
    fetchBuildingInsights({ lat: location.lat, lon: location.lon }).then(({ data }) => {
      if (cancelled) return;
      if (!data || data.source === 'manual' || !data.dominant) {
        setSolarStatus('manual');
        return;
      }
      const d = data.dominant;
      onRoof({
        tiltPercent: Math.max(0, Math.round(degreesToPercent(d.pitch_deg))),
        orientation: Math.round(d.aspect_pvgis),
        surfaceM2: Math.round(d.area_m2),
      });
      onRoofGeometry({ ...data });
      setSolarStatus('filled');
      // Heatmap flux (non bloquant) — enrichit roofGeometry quand prête.
      fetchFluxHeatmap({ lat: location.lat, lon: location.lon }).then(({ data: flux }) => {
        if (!cancelled && flux?.fluxImagePath) {
          onRoofGeometry({ ...data, flux_image_path: flux.fluxImagePath });
        }
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.lat, location.lon]);
```

4. Bannière d'état : juste sous le bloc de confirmation de localisation (`{hasLocation && (...)}`, après sa `</div>` fermante, avant la fin de la card Localisation), insérer :
```jsx
        {hasLocation && solarStatus === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> Analyse de la toiture (Google Solar)…
          </div>
        )}
        {hasLocation && solarStatus === 'filled' && (
          <div className="flex items-center gap-2 text-sm text-[#1565C0] bg-blue-50 rounded-lg px-3 py-2">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            Toiture pré-remplie via Google Solar{roofGeometry?.imageryQuality ? ` (qualité ${roofGeometry.imageryQuality})` : ''} — ajustable ci-dessous.
          </div>
        )}
        {hasLocation && solarStatus === 'manual' && (
          <div className="flex items-center gap-2 text-sm text-secondary-600 bg-secondary-50 rounded-lg px-3 py-2">
            <MapPin className="w-4 h-4 flex-shrink-0" /> Bâtiment non couvert par Google Solar — saisie manuelle.
          </div>
        )}
```

5. Affichage de la heatmap : juste après la card « Toiture » (après sa `</div>` fermante), insérer :
```jsx
      {roofGeometry?.flux_image_path && <FluxHeatmap fluxImagePath={roofGeometry.flux_image_path} />}
```

- [ ] **Step 4 : Passer les nouvelles props depuis `Simulateur.jsx`**

Dans `src/apps/solaire/pages/Simulateur.jsx`, au rendu de `<Step1Localisation ... />` (l. 251-258), ajouter :
```jsx
        <Step1Localisation
          location={state.location}
          roof={state.roof}
          config={config}
          roofGeometry={state.roofGeometry}
          onLocation={(patch) => dispatch({ type: 'SET_LOCATION', patch })}
          onRoof={(patch) => dispatch({ type: 'SET_ROOF', patch })}
          onRoofGeometry={(value) => dispatch({ type: 'SET_ROOF_GEOMETRY', value })}
          onNext={() => goToStep(2)}
        />
```

- [ ] **Step 5 : Vérifier le build**

Run: `npx vite build`
Expected: build OK.

- [ ] **Step 6 : Commit**

```bash
git add src/apps/solaire/lib/wizardState.js src/apps/solaire/components/dossier/FluxHeatmap.jsx src/apps/solaire/components/Step1Localisation.jsx src/apps/solaire/pages/Simulateur.jsx
git commit -m "feat(solaire): Step1 auto-remplissage toiture Google Solar + heatmap flux (repli manuel intact)"
```

---

## Task 11 : Persistance `roof_geometry` dans `pv_dossiers` au save (lazy dossier)

> **Spec §4.1 + §5.1.** À la sauvegarde de simulation (`handleSave`), si une géométrie Google Solar existe : créer LAZY le dossier (socle Plan 1 : `ensureDossier` UPSERT sur `pv_simulation_id`) puis écrire `roof_geometry` via `patchBlock`. `createSimulation.mutateAsync` renvoie `{ id }` (vérifié : `pvService.create` → `.select('id').single()`). Non bloquant : un échec de persistance n'empêche pas le save.

**Files:**
- Modify: `src/apps/solaire/pages/Simulateur.jsx`

- [ ] **Step 1 : Importer le hook dossier + logger**

Dans `src/apps/solaire/pages/Simulateur.jsx`, ajouter aux imports :
```js
import { usePvDossierMutations } from '@hooks/usePvDossier';
import { logger } from '@lib/logger';
```

- [ ] **Step 2 : Instancier les mutations dossier**

Dans `SimulateurInner`, après `const { createSimulation } = usePvSimulationMutations();` (l. 49), ajouter :
```js
  const { ensureDossier, patchBlock } = usePvDossierMutations();
```

- [ ] **Step 3 : Persister `roof_geometry` après création de la simulation**

Dans `handleSave`, remplacer le corps `try` actuel (l. 133-152) par :
```js
    try {
      const sim = await createSimulation.mutateAsync({
        clientName,
        comment,
        clientAddress: state.location.address || null,
        lat: state.location.lat,
        lon: state.location.lon,
        inputs: {
          location: state.location,
          roof: state.roof,
          conso: state.conso,
          ev: state.ev,
          financing: state.financing,
          selectedKwc: results.selectedKwc,
        },
        pvgisMonthly: state.pvgis,
        results,
      });
      // Dossier PV write-once : la géométrie Google Solar rejoint le dossier dès sa création LAZY.
      if (state.roofGeometry && sim?.id) {
        try {
          const dossier = await ensureDossier.mutateAsync({ simulationId: sim.id });
          if (dossier?.id) {
            await patchBlock.mutateAsync({ id: dossier.id, patch: { roof_geometry: state.roofGeometry } });
          }
        } catch (dossierErr) {
          logger.warn('[solaire] roof_geometry non persisté (dossier)', dossierErr); // non bloquant
        }
      }
      clearDraft(userId);
      toast.success(`Simulation « ${clientName} » enregistrée`);
    } catch (err) {
      toast.error(`Échec de l'enregistrement : ${err.message}`);
      throw err;
    }
```

- [ ] **Step 4 : Vérifier le build**

Run: `npx vite build`
Expected: build OK.

- [ ] **Step 5 : Commit**

```bash
git add src/apps/solaire/pages/Simulateur.jsx
git commit -m "feat(solaire): persistance roof_geometry dans pv_dossiers à la sauvegarde (dossier lazy)"
```

---

## Task 12 : Vérification finale

- [ ] **Step 1 : Tests purs verts**

Run: `node --test scripts/pv-engine.test.mjs`
Expected: PASS (existants + `googleAzimuthToPvgisAspect` 4 cardinaux + pan plat + `degreesToPercent`).

- [ ] **Step 2 : Build production propre**

Run: `npx vite build`
Expected: build OK, aucun import cassé.

- [ ] **Step 3 : Lint sans nouvelle erreur**

Run: `npm run lint:errors`
Expected: 0 erreur.

- [ ] **Step 4 : Vérification live (nécessite Task 0/3/6/7 appliquées par Eric)**

Sur une adresse Gaillac **couverte** : la géoloc pré-remplit pente/orientation/surface (valeurs Google Solar), la bannière « pré-rempli via Google Solar (qualité …) » s'affiche, la heatmap de flux apparaît. Sur une adresse **non couverte** : repli manuel transparent, aucun blocage. Enregistrer la simulation → vérifier `SELECT roof_geometry, status FROM majordhome_pv_dossiers ORDER BY created_at DESC LIMIT 1` : `roof_geometry` peuplé, `status='offre'`. Ré-simuler la même adresse → aucun nouvel appel Google (cache : `SELECT building_key, fetched_at, flux_fetched_at FROM majordhome_google_solar_cache`).

- [ ] **Step 5 : Contrôle sécurité multi-tenant**

Confirmer : clé Google **jamais** dans un bundle front (`grep -ri GOOGLE_SOLAR_API_KEY src/` → 0 hit) ; toutes les requêtes cache filtrent `.eq('org_id', orgId)` ; edge en `verify_jwt:true` + `requireOrgMembership` ; PNG flux sous préfixe `${orgId}/`.

---

## Critères de succès (vérifiables)

- `node --test scripts/pv-engine.test.mjs` → vert (dont 4 cardinaux + pan plat + deg→%).
- `npx vite build` OK ; `npm run lint:errors` → 0 erreur.
- Adresse couverte : pré-remplissage pente/orientation/surface + heatmap, sans saisie manuelle.
- Adresse non couverte (404) : repli manuel transparent, parcours identique.
- Ré-simulation même adresse : coût Google marginal 0 (cache hit).
- `roof_geometry` persisté dans `pv_dossiers` à la sauvegarde ; `status='offre'`.
- Aucune fuite cross-org (clé edge-only, `.eq('org_id')`, RLS, préfixe Storage `${orgId}/`).
- CERFA/notice (Plan 4) **jamais** bloqués par un échec/absence Google Solar (géométrie ⇒ saisie manuelle ; flux absent ⇒ offre sans heatmap).

## Self-review (fait)

- **Couverture spec §5.1** buildingInsights + azimut→PVGIS + pan plat : Task 2 (helper testé) + Task 6 (edge parse dominant) + Task 8 (application) + Task 10 (auto-fill) ✓.
- **§5.2** dataLayers heatmap flux GeoTIFF→PNG persisté : Task 5 (module geotiff) + Task 7 (branche edge) + Task 10 (FluxHeatmap) ✓. Chemin cache-scopé (conflit §5.2 vs §5.3 **tranché**, pas moyenné, Task 7 note).
- **§5.3** cache write-through + quota + hard cap + 404 nominal + jamais bloquant : Task 3 (table) + Task 6 (cache read/write + `enforceCap` + `notFound`) + Task 9 (quota hook) ✓.
- **§8 sécurité** : clé edge-only (Task 0/6), RLS + vue security_invoker + GRANT service_role (Task 3), `verify_jwt:true`+`requireOrgMembership` (Task 6), `.eq('org_id')` (Task 6/9), préfixe Storage `${orgId}/` (Task 7) ✓.
- **§9 risques (2 spikes)** : couverture Gaillac (Task 1) ; GeoTIFF rasterisation (Task 5, validée live Task 7) ; enum imageryQuality (Task 1) ; convention azimut (Task 2, testée) ✓.
- **Hors scope confirmé** : cadastre IGN/GPU (§5.4) = Plan 3 ; CERFA/notice (§6) = Plan 4 ; Mapbox = Plan 3. Non couverts ici par design ✓.
- **Placeholders** : aucun — code SQL/TS/JS complet. Un seul point « à confirmer » explicite : signature `storageService.getSignedUrl` (Task 10 Step 2 note).
- **Cohérence de types** : `mode` ∈ {building_insights, data_layers, both} (edge) ↔ lib `fetchBuildingInsights`/`fetchFluxHeatmap` ✓ ; `dominant.{pitch_deg,azimuth_google_deg,area_m2}` (edge parse) ↔ lib conversion `aspect_pvgis` ✓ ; `roofGeometry` (wizardState) ↔ `SET_ROOF_GEOMETRY` ↔ prop Step1 ↔ `patchBlock({roof_geometry})` ✓ ; `googleSolarKeys.quota` (Task 4) ↔ hook (Task 9) ✓ ; cache colonnes `fetched_at`/`flux_fetched_at`/`flux_image_path`/`imagery_quality` (Task 3) ↔ edge upsert (Task 6/7) ↔ service quota (Task 9) ✓.
