# Programmation entretiens — Grands secteurs + géocodage auto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le regroupement par code postal de l'onglet Programmation (Entretiens) par un regroupement en « grands secteurs » géographiques réels, et fiabiliser les coordonnées clients par un géocodage serveur automatique.

**Architecture :** Deux lots indépendants. **Lot A** (géocodage auto) ajoute un balayage serveur (edge `geocode-sweep` + cron pg_cron 30 min + 2 RPCs service_role) qui rattrape tous les chemins de création hors modale + les échecs + les ré-adressages → coordonnées ~100 %. **Lot B** (grands secteurs) ajoute une fonction pure de clustering (partition agglomérative sous contrainte de rayon 15 km, haversine, nommée par commune dominante), branchée dans le service `getContractsBySector` (annotation des secteurs CP) et rendue par `SectorGroupView` en niveau au-dessus des CP existants. Additif, sans carte.

**Tech Stack :** React 18 + Vite, Supabase (PostgreSQL, edge functions Deno, pg_cron, pg_net), API gratuite `api-adresse.data.gouv.fr`, tests `node:test`.

**Spec :** `docs/superpowers/specs/2026-06-17-programmation-grands-secteurs-design.md`

**Conventions projet à respecter :**
- Pas de preview tools — vérifier les builds via `npx vite build`.
- Migrations : fichier `supabase/migrations/20260617_N_<nom>.sql` **et** application via le MCP Supabase `apply_migration`.
- Edge : déploiement via le MCP Supabase `deploy_edge_function` (inclure `../_shared/auth.ts` dans le `files` array). `verify_jwt` versionné dans `supabase/config.toml`.
- RPC SECURITY DEFINER prenant des données sans dériver l'org d'`auth.uid()` → `REVOKE FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role`.
- Tests purs : `node --test scripts/<nom>.test.mjs`.

---

## File Structure

**Lot A — Géocodage auto**
- Create: `supabase/migrations/20260617_1_geocode_attempts_and_trigger.sql` — colonne `geocode_attempts` + MAJ trigger.
- Create: `supabase/migrations/20260617_2_geocode_sweep_rpcs.sql` — RPCs `geocode_fetch_pending_clients` + `geocode_apply_client_coordinates`.
- Create: `supabase/functions/geocode-sweep/index.ts` — edge cron de géocodage.
- Modify: `supabase/config.toml` — `[functions.geocode-sweep] verify_jwt = false`.
- Create: `supabase/migrations/20260617_3_geocode_sweep_cron.sql` — planification pg_cron 30 min.

**Lot B — Grands secteurs**
- Create: `src/lib/sectorClustering.js` — fonction pure de clustering (aucune dépendance React/Supabase).
- Create: `scripts/sector-clustering.test.mjs` — tests `node:test`.
- Modify: `src/shared/services/entretiens.service.js` — `getContractsBySector` : merge coords + annotation grand secteur.
- Modify: `src/apps/artisan/components/entretiens/SectorGroupView.jsx` — rendu hiérarchique grand secteur → CP → contrats.

`useContractSectors` (hook) et `Entretiens.jsx` sont **inchangés** : le service garde sa forme de retour (tableau de secteurs CP) enrichie de 3 champs (`grandSecteurId`, `grandSecteurName`, `grandSecteurOrder`).

---

## LOT A — Géocodage automatique

### Task A1 : Colonne `geocode_attempts` + MAJ trigger d'invalidation

**Files:**
- Create: `supabase/migrations/20260617_1_geocode_attempts_and_trigger.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260617_1_geocode_attempts_and_trigger.sql
-- Compteur anti-retry pour le balayage de géocodage + reset à 0 quand l'adresse change.

ALTER TABLE majordhome.clients
  ADD COLUMN IF NOT EXISTS geocode_attempts smallint NOT NULL DEFAULT 0;

-- Le trigger BEFORE UPDATE existant remet déjà lat/lng/geocoded_at à NULL quand
-- l'adresse change. On ajoute le reset du compteur (1 ligne) pour qu'un ré-adressage
-- relance le géocodage même après 3 échecs.
CREATE OR REPLACE FUNCTION majordhome.reset_geocode_on_address_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'majordhome', 'public', 'core', 'pg_temp'
AS $function$
BEGIN
  IF (
    COALESCE(NEW.address, '') IS DISTINCT FROM COALESCE(OLD.address, '') OR
    COALESCE(NEW.postal_code, '') IS DISTINCT FROM COALESCE(OLD.postal_code, '') OR
    COALESCE(NEW.city, '') IS DISTINCT FROM COALESCE(OLD.city, '')
  ) THEN
    NEW.latitude := NULL;
    NEW.longitude := NULL;
    NEW.geocoded_at := NULL;
    NEW.geocode_attempts := 0;
  END IF;
  RETURN NEW;
END;
$function$;
```

- [ ] **Step 2 : Appliquer via le MCP Supabase**

Outil : `apply_migration` (project_id `odspcxgafcqxjzrarsqf`, name `20260617_1_geocode_attempts_and_trigger`, query = contenu du fichier).

- [ ] **Step 3 : Vérifier la colonne + le trigger**

Outil : `execute_sql` :
```sql
select column_name, column_default from information_schema.columns
where table_schema='majordhome' and table_name='clients' and column_name='geocode_attempts';
```
Attendu : 1 ligne, default `0`.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260617_1_geocode_attempts_and_trigger.sql
git commit -m "feat(geocode): colonne geocode_attempts + reset au changement d'adresse"
```

---

### Task A2 : RPCs `geocode_fetch_pending_clients` + `geocode_apply_client_coordinates`

**Files:**
- Create: `supabase/migrations/20260617_2_geocode_sweep_rpcs.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260617_2_geocode_sweep_rpcs.sql
-- RPCs du balayage de géocodage. service_role only (prennent/écrivent des données
-- clients sans dériver l'org d'auth.uid()).

-- 1) Lire un lot de clients à géocoder
CREATE OR REPLACE FUNCTION public.geocode_fetch_pending_clients(p_limit int DEFAULT 100)
RETURNS TABLE (id uuid, address text, postal_code text, city text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = majordhome, public
AS $function$
  SELECT c.id, c.address, c.postal_code, c.city
  FROM majordhome.clients c
  WHERE c.geocoded_at IS NULL
    AND COALESCE(c.is_archived, false) = false
    AND COALESCE(c.postal_code, '') <> ''
    AND (COALESCE(c.address, '') <> '' OR COALESCE(c.city, '') <> '')
    AND COALESCE(c.geocode_attempts, 0) < 3
  ORDER BY c.created_at ASC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$function$;

REVOKE EXECUTE ON FUNCTION public.geocode_fetch_pending_clients(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geocode_fetch_pending_clients(int) TO service_role;

-- 2) Appliquer les coordonnées (et incrémenter le compteur de tentatives)
-- p_rows : [{ "id": uuid, "lat": number|null, "lng": number|null }]
-- COALESCE strict : on n'écrit lat/lng QUE si non nuls (jamais d'écrasement par NULL).
CREATE OR REPLACE FUNCTION public.geocode_apply_client_coordinates(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $function$
DECLARE
  r jsonb;
  n int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    IF (r->>'lat') IS NOT NULL AND (r->>'lng') IS NOT NULL THEN
      UPDATE majordhome.clients
        SET latitude = (r->>'lat')::numeric,
            longitude = (r->>'lng')::numeric,
            geocoded_at = now(),
            geocode_attempts = COALESCE(geocode_attempts, 0) + 1
      WHERE id = (r->>'id')::uuid;
      n := n + 1;
    ELSE
      UPDATE majordhome.clients
        SET geocode_attempts = COALESCE(geocode_attempts, 0) + 1
      WHERE id = (r->>'id')::uuid;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.geocode_apply_client_coordinates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.geocode_apply_client_coordinates(jsonb) TO service_role;
```

- [ ] **Step 2 : Appliquer via le MCP Supabase**

Outil : `apply_migration` (name `20260617_2_geocode_sweep_rpcs`).

- [ ] **Step 3 : Vérifier que le fetch renvoie bien les pending**

Outil : `execute_sql` :
```sql
select count(*) as pending from public.geocode_fetch_pending_clients(1000);
```
Attendu : un entier ≥ 0 (les ~19 clients NULL + d'éventuels autres). Pas d'erreur de permission (on l'exécute en service_role via le MCP).

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260617_2_geocode_sweep_rpcs.sql
git commit -m "feat(geocode): RPCs fetch_pending + apply_coordinates (service_role)"
```

---

### Task A3 : Edge function `geocode-sweep`

**Files:**
- Create: `supabase/functions/geocode-sweep/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1 : Écrire l'edge function**

```typescript
// supabase/functions/geocode-sweep/index.ts
// ============================================================================
// geocode-sweep — Balayage serveur de géocodage des clients (toutes orgs)
// ============================================================================
// Rattrape tout ce qui crée un client hors modale (cron Pennylane, N8N, imports),
// les échecs de géocodage, et les ré-adressages (geocoded_at remis à NULL par le
// trigger). Source de vérité : geocoded_at IS NULL + adresse exploitable.
//
// Pattern : pg_cron (30 min) → cette edge (verify_jwt:false, MDH_CRON_SECRET) →
//   1. geocode_fetch_pending_clients(limit)
//   2. géocodage via l'API CSV gouv (api-adresse.data.gouv.fr, gratuit)
//   3. geocode_apply_client_coordinates(rows)
//
// App-level cross-org : géocodage org-agnostique (adresse → coords).
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_CRON_SECRET.
// ============================================================================

import {
  requireSharedSecret,
  jsonResponse,
  buildCorsHeaders,
  getAdminClient,
  sanitizeError,
} from "../_shared/auth.ts";

const MDH_CRON_SECRET = Deno.env.get("MDH_CRON_SECRET") || "";
const GOUV_CSV = "https://api-adresse.data.gouv.fr/search/csv/";
const BATCH_LIMIT = 100;
const SCORE_MIN = 0.3;

interface PendingClient {
  id: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
}
interface ApplyRow {
  id: string;
  lat: number | null;
  lng: number | null;
}

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// Géocode un lot via l'API CSV gouv. Retourne 1 ApplyRow par client (lat/lng null si échec).
async function geocodeBatch(clients: PendingClient[]): Promise<ApplyRow[]> {
  const lines = ["id,adresse,postcode,city"];
  for (const c of clients) {
    const addr = (c.address || "").replace(/,/g, " ").replace(/"/g, "");
    const cp = c.postal_code || "";
    const city = (c.city || "").replace(/,/g, " ").replace(/"/g, "");
    lines.push(`${c.id},"${addr}",${cp},"${city}"`);
  }

  const form = new FormData();
  form.append("data", new Blob([lines.join("\n")], { type: "text/csv" }), "addresses.csv");
  form.append("columns", "adresse");
  form.append("postcode", "postcode");
  form.append("city_column", "city");
  form.append("result_columns", "result_score,latitude,longitude");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  // défaut : échec pour tous (lat/lng null) ; on remplit les succès ensuite
  const byId = new Map<string, ApplyRow>();
  for (const c of clients) byId.set(c.id, { id: c.id, lat: null, lng: null });

  try {
    const res = await fetch(GOUV_CSV, { method: "POST", body: form, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [...byId.values()];

    const text = await res.text();
    const rows = text.split("\n").slice(1);
    for (const line of rows) {
      if (!line.trim()) continue;
      const parts = parseCSVLine(line);
      const id = parts[0];
      const score = parseFloat(parts[parts.length - 3]) || 0;
      const lat = parseFloat(parts[parts.length - 2]);
      const lng = parseFloat(parts[parts.length - 1]);
      if (byId.has(id) && score >= SCORE_MIN && !isNaN(lat) && !isNaN(lng)) {
        byId.set(id, { id, lat, lng });
      }
    }
  } catch {
    clearTimeout(timeout);
  }
  return [...byId.values()];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authError = requireSharedSecret(req, MDH_CRON_SECRET, "MDH_CRON_SECRET");
  if (authError) return authError;

  try {
    const admin = getAdminClient();

    const { data: pending, error: fErr } = await admin.rpc("geocode_fetch_pending_clients", {
      p_limit: BATCH_LIMIT,
    });
    if (fErr) return jsonResponse({ error: sanitizeError(fErr, "fetch_pending failed") }, 500, req);

    const clients = (pending ?? []) as PendingClient[];
    if (clients.length === 0) {
      return jsonResponse({ processed: 0, geocoded: 0 }, 200, req);
    }

    const rows = await geocodeBatch(clients);

    const { error: aErr } = await admin.rpc("geocode_apply_client_coordinates", { p_rows: rows });
    if (aErr) return jsonResponse({ error: sanitizeError(aErr, "apply failed") }, 500, req);

    const geocoded = rows.filter((r) => r.lat != null && r.lng != null).length;
    return jsonResponse({ processed: clients.length, geocoded }, 200, req);
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "geocode-sweep failed") }, 500, req);
  }
});
```

- [ ] **Step 2 : Versionner `verify_jwt` dans `supabase/config.toml`**

Ajouter (en miroir des entrées existantes `verify_jwt = false`, ex. `mailing-scheduler`) :
```toml
[functions.geocode-sweep]
verify_jwt = false
```

- [ ] **Step 3 : Déployer via le MCP Supabase**

Outil : `deploy_edge_function` — function name `geocode-sweep`, `files` = `[{ name: "index.ts", content: <index.ts> }, { name: "../_shared/auth.ts", content: <contenu _shared/auth.ts> }]`.

- [ ] **Step 4 : Vérifier le déploiement (auth bloque sans secret)**

Outil : `execute_sql` (déclenche l'edge via pg_net avec le bon secret, pour valider qu'elle répond) :
```sql
select net.http_post(
  url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/geocode-sweep',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='mdh_cron_secret' limit 1)
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
) as request_id;
```
Puis, ~20 s plus tard, vérifier que des clients ont été géocodés :
```sql
select count(*) filter (where geocoded_at is not null) as geocoded,
       count(*) filter (where geocoded_at is null) as pending
from majordhome.clients
where coalesce(is_archived,false)=false and coalesce(postal_code,'')<>'';
```
Attendu : `pending` a diminué (les NULL géocodables sont passés en `geocoded`).

- [ ] **Step 5 : Commit**

```bash
git add supabase/functions/geocode-sweep/index.ts supabase/config.toml
git commit -m "feat(geocode): edge geocode-sweep (balayage serveur, API gouv CSV)"
```

---

### Task A4 : Cron pg_cron (30 min)

**Files:**
- Create: `supabase/migrations/20260617_3_geocode_sweep_cron.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- 20260617_3_geocode_sweep_cron.sql
-- Planifie geocode-sweep toutes les 30 min. Secret lu depuis vault (même pattern
-- que mailing-scheduler / pennylane-sync-quote-status).

SELECT cron.schedule(
  'geocode-sweep',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/geocode-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
```

- [ ] **Step 2 : Appliquer via le MCP Supabase**

Outil : `apply_migration` (name `20260617_3_geocode_sweep_cron`).

- [ ] **Step 3 : Vérifier que le job est planifié**

Outil : `execute_sql` :
```sql
select jobname, schedule, active from cron.job where jobname='geocode-sweep';
```
Attendu : 1 ligne, schedule `*/30 * * * *`, active `true`.

- [ ] **Step 4 : Commit**

```bash
git add supabase/migrations/20260617_3_geocode_sweep_cron.sql
git commit -m "feat(geocode): cron pg_cron geocode-sweep toutes les 30 min"
```

---

### Task A5 : Vérification backfill (couverture)

- [ ] **Step 1 : Laisser tourner 1-2 cycles puis mesurer la couverture**

Outil : `execute_sql` (population Programmation = clients sous contrat actif) :
```sql
select count(*)::int as clients_active_contract,
       count(c.latitude)::int as geocoded,
       round(100.0*count(c.latitude)/nullif(count(*),0),1) as pct_geocoded
from majordhome.clients c
where exists (select 1 from majordhome.contracts ct where ct.client_id=c.id and ct.status='active');
```
Attendu : `pct_geocoded` proche de 100 (vs 95,1 % au départ). Les seuls restants doivent être des adresses non matchables (`geocode_attempts >= 3`).

- [ ] **Step 2 : Aucun commit** (vérification seule).

---

## LOT B — Grands secteurs

### Task B1 : Fonction pure de clustering + tests (TDD)

**Files:**
- Create: `src/lib/sectorClustering.js`
- Test: `scripts/sector-clustering.test.mjs`

- [ ] **Step 1 : Écrire les tests (qui échouent)**

```javascript
// scripts/sector-clustering.test.mjs
// Tests du clustering des secteurs (src/lib/sectorClustering.js).
// Run : node --test scripts/sector-clustering.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, clusterSectorsByProximity } from '../src/lib/sectorClustering.js';

const contract = (city, lat, lng, status = 'pending') => ({
  id: `${city}-${lat}-${lng}-${Math.round((lat + lng) * 1e6)}`,
  client_city: city,
  client_latitude: lat,
  client_longitude: lng,
  current_year_visit_status: status,
});

// A=Gaillac, B=Marssac (~6 km de A), C=Albi (~32 km de A), D=Lacaune (isolé),
// E=sans coordonnées.
const buildSectors = () => ([
  { codePostal: '81600', commune: 'Gaillac', contracts: [
      contract('Gaillac', 43.90, 1.90), contract('Gaillac', 43.90, 1.90), contract('Gaillac', 43.901, 1.901) ] },
  { codePostal: '81150', commune: 'Marssac', contracts: [
      contract('Marssac-sur-Tarn', 43.90, 1.98), contract('Marssac-sur-Tarn', 43.901, 1.981) ] },
  { codePostal: '81000', commune: 'Albi', contracts: [
      contract('Albi', 43.90, 2.30), contract('Albi', 43.901, 2.301),
      contract('Albi', 43.902, 2.302), contract('Albi', 43.903, 2.303) ] },
  { codePostal: '81230', commune: 'Lacaune', contracts: [ contract('Lacaune', 43.70, 2.69) ] },
  { codePostal: '81999', commune: '', contracts: [
      { id: 'e1', client_city: '', client_latitude: null, client_longitude: null, current_year_visit_status: 'pending' },
      { id: 'e2', client_city: '', client_latitude: null, client_longitude: null, current_year_visit_status: 'pending' } ] },
]);

const cpsOf = (groups, name) => {
  const g = groups.find((x) => x.codePostals.includes(name));
  return g ? g.codePostals.slice().sort() : null;
};

test('haversineKm — points identiques = 0, ~8 km pour 0.1° de longitude à 43.9°', () => {
  assert.equal(haversineKm({ lat: 43.9, lng: 1.9 }, { lat: 43.9, lng: 1.9 }), 0);
  const d = haversineKm({ lat: 43.9, lng: 1.9 }, { lat: 43.9, lng: 2.0 });
  assert.ok(d > 7.8 && d < 8.2, `attendu ~8 km, obtenu ${d}`);
});

test('CP proches (≤ rayon) fusionnés en un seul grand secteur, nommé par commune dominante', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  assert.deepEqual(cpsOf(groups, '81600'), ['81150', '81600']);
  const g = groups.find((x) => x.codePostals.includes('81600'));
  assert.equal(g.name, 'Gaillac'); // 3 contrats Gaillac > 2 Marssac
});

test('CP éloigné = grand secteur singleton (jamais happé par un cluster lointain)', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  assert.deepEqual(cpsOf(groups, '81000'), ['81000']);
});

test('CP isolé géocodé = singleton (pas orphelin, pas dans Non localisé)', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  const g = groups.find((x) => x.codePostals.includes('81230'));
  assert.deepEqual(g.codePostals, ['81230']);
  assert.notEqual(g.id, 'non-localise');
});

test('CP sans coordonnées = bucket Non localisé, placé en dernier', () => {
  const groups = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  const last = groups[groups.length - 1];
  assert.equal(last.id, 'non-localise');
  assert.deepEqual(last.codePostals, ['81999']);
});

test('conservation : chaque CP apparaît exactement une fois (ni perte, ni doublon)', () => {
  const sectors = buildSectors();
  const groups = clusterSectorsByProximity(sectors, { radiusKm: 15 });
  const allCps = groups.flatMap((g) => g.codePostals).sort();
  const inputCps = sectors.map((s) => s.codePostal).sort();
  assert.deepEqual(allCps, inputCps);
  assert.equal(new Set(allCps).size, allCps.length); // aucun doublon
});

test('déterminisme : l\'ordre d\'entrée ne change pas le regroupement', () => {
  const a = clusterSectorsByProximity(buildSectors(), { radiusKm: 15 });
  const shuffled = buildSectors().reverse();
  const b = clusterSectorsByProximity(shuffled, { radiusKm: 15 });
  const norm = (gs) => gs.map((g) => g.codePostals.slice().sort().join(',')).sort();
  assert.deepEqual(norm(a), norm(b));
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run : `node --test scripts/sector-clustering.test.mjs`
Expected : FAIL (`Cannot find module '../src/lib/sectorClustering.js'`).

- [ ] **Step 3 : Écrire l'implémentation**

```javascript
// src/lib/sectorClustering.js
// ============================================================================
// Clustering des secteurs (codes postaux) en "grands secteurs" géographiques.
// Partition stricte (chaque CP dans exactement un groupe), agglomératif sous
// contrainte de rayon (haversine). Pure, sans dépendance React/Supabase →
// testable via `node --test scripts/sector-clustering.test.mjs`.
// ============================================================================

const EARTH_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function hasCoords(c) {
  return (
    c &&
    c.client_latitude != null &&
    c.client_longitude != null &&
    Number.isFinite(Number(c.client_latitude)) &&
    Number.isFinite(Number(c.client_longitude))
  );
}

function cpCentroid(contracts) {
  const pts = (contracts || []).filter(hasCoords);
  if (pts.length === 0) return null;
  let lat = 0, lng = 0;
  for (const c of pts) { lat += Number(c.client_latitude); lng += Number(c.client_longitude); }
  return { lat: lat / pts.length, lng: lng / pts.length };
}

function geocodedCount(sector) {
  return (sector.contracts || []).filter(hasCoords).length;
}

function pendingCount(sectors) {
  return sectors.reduce(
    (n, s) => n + (s.contracts || []).filter((c) => c.current_year_visit_status !== 'completed').length,
    0,
  );
}

// Centroïde pondéré par le nb de contrats géocodés de chaque CP.
function weightedCentroid(sectors) {
  let lat = 0, lng = 0, w = 0;
  for (const s of sectors) {
    if (!s._centroid) continue;
    const n = geocodedCount(s);
    if (n === 0) continue;
    lat += s._centroid.lat * n;
    lng += s._centroid.lng * n;
    w += n;
  }
  return w === 0 ? null : { lat: lat / w, lng: lng / w };
}

// Vrai si tous les CP du cluster restent à ≤ radiusKm du barycentre pondéré.
function radiusOk(sectors, radiusKm) {
  const c = weightedCentroid(sectors);
  if (!c) return false;
  return sectors.every((s) => haversineKm(c, s._centroid) <= radiusKm);
}

function dominantCommune(sectors) {
  const counts = new Map();
  for (const s of sectors) {
    for (const c of s.contracts || []) {
      const city = (c.client_city || s.commune || '').trim();
      if (!city) continue;
      counts.set(city, (counts.get(city) || 0) + 1);
    }
  }
  let best = null, bestN = -1;
  // tri alpha pour un tie-break déterministe
  for (const [city, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN) { best = city; bestN = n; }
  }
  return best || sectors[0].codePostal;
}

export function clusterSectorsByProximity(sectors, { radiusKm = 15 } = {}) {
  // tri d'entrée → déterminisme
  const input = [...(sectors || [])].sort((a, b) =>
    String(a.codePostal).localeCompare(String(b.codePostal)),
  );

  const localizable = [];
  const unlocalized = [];
  for (const s of input) {
    s._centroid = cpCentroid(s.contracts);
    (s._centroid ? localizable : unlocalized).push(s);
  }

  // chaque CP localisable = un cluster
  let clusters = localizable.map((s) => ({ sectors: [s], centroid: s._centroid }));

  // fusion agglomérative : paire la plus proche dont la fusion respecte le rayon
  for (;;) {
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = haversineKm(clusters[i].centroid, clusters[j].centroid);
        if (d >= best) continue;
        if (radiusOk([...clusters[i].sectors, ...clusters[j].sectors], radiusKm)) {
          best = d; bi = i; bj = j;
        }
      }
    }
    if (bi === -1) break;
    const merged = [...clusters[bi].sectors, ...clusters[bj].sectors];
    clusters.splice(bj, 1);
    clusters.splice(bi, 1, { sectors: merged, centroid: weightedCentroid(merged) });
  }

  const groups = clusters.map((cl) => {
    const codePostals = cl.sectors
      .map((s) => s.codePostal)
      .sort((a, b) => String(a).localeCompare(String(b)));
    return {
      id: codePostals.join('-'),
      name: dominantCommune(cl.sectors),
      codePostals,
      centroid: cl.centroid,
      visitsPending: pendingCount(cl.sectors),
    };
  });

  // grands secteurs ordonnés par charge à faire desc, puis nom
  groups.sort((a, b) => b.visitsPending - a.visitsPending || a.name.localeCompare(b.name));

  if (unlocalized.length) {
    groups.push({
      id: 'non-localise',
      name: 'Non localisé',
      codePostals: unlocalized
        .map((s) => s.codePostal)
        .sort((a, b) => String(a).localeCompare(String(b))),
      centroid: null,
      visitsPending: pendingCount(unlocalized),
    });
  }

  // nettoyage du champ interne posé sur les objets d'entrée
  for (const s of input) delete s._centroid;

  return groups;
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run : `node --test scripts/sector-clustering.test.mjs`
Expected : PASS (7 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/lib/sectorClustering.js scripts/sector-clustering.test.mjs
git commit -m "feat(secteurs): fonction pure clusterSectorsByProximity + tests"
```

---

### Task B2 : Brancher le clustering dans `getContractsBySector`

**Files:**
- Modify: `src/shared/services/entretiens.service.js` (fonction `getContractsBySector`, ~lignes 474-536)

- [ ] **Step 1 : Ajouter l'import en tête de fichier**

Près des autres imports de `entretiens.service.js` :
```javascript
import { clusterSectorsByProximity } from '@/lib/sectorClustering';
```

- [ ] **Step 2 : Remplacer le corps de `getContractsBySector`**

Remplacer la fonction entière par (merge des coordonnées via une 2ᵉ requête `majordhome_clients`, puis annotation des secteurs avec leur grand secteur) :
```javascript
  async getContractsBySector(orgId, { status = 'active' } = {}) {
    try {
      let query = supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('org_id', orgId)
        .order('client_postal_code', { ascending: true, nullsFirst: false })
        .order('client_name', { ascending: true, nullsFirst: false });

      if (status) {
        query = query.eq('status', status);
      } else {
        query = query.neq('status', 'archived');
      }

      const { data, error } = await query;

      if (error) {
        console.error('[entretiensService] getContractsBySector error:', error);
        return { data: [], error };
      }

      const contracts = data || [];

      // Rattacher les coordonnées client (la vue majordhome_contracts ne les expose
      // pas). Les ids sont déjà scopés à l'org via la requête contrats ci-dessus ;
      // la lecture clients est en plus scopée par RLS (security_invoker).
      const clientIds = [...new Set(contracts.map((c) => c.client_id).filter(Boolean))];
      const coordsMap = new Map();
      if (clientIds.length) {
        const { data: coordRows } = await supabase
          .from('majordhome_clients')
          .select('id, latitude, longitude')
          .in('id', clientIds);
        for (const r of coordRows || []) coordsMap.set(r.id, r);
      }

      // Grouper par code postal client
      const sectors = {};
      for (const contract of contracts) {
        const cp = contract.client_postal_code || 'Inconnu';
        const city = contract.client_city || '';
        const co = coordsMap.get(contract.client_id);
        contract.client_latitude = co?.latitude ?? null;
        contract.client_longitude = co?.longitude ?? null;

        if (!sectors[cp]) {
          sectors[cp] = {
            codePostal: cp,
            commune: city,
            contracts: [],
            totalContracts: 0,
            visitsDone: 0,
            visitsPending: 0,
          };
        }

        sectors[cp].contracts.push(contract);
        sectors[cp].totalContracts++;

        // Basé sur current_year_visit_status : visite enregistrée cette année = fait
        if (contract.current_year_visit_status === 'completed') {
          sectors[cp].visitsDone++;
        } else {
          sectors[cp].visitsPending++;
        }
      }

      // Trier par visites à faire (décroissant)
      const sortedSectors = Object.values(sectors).sort(
        (a, b) => b.visitsPending - a.visitsPending || a.codePostal.localeCompare(b.codePostal),
      );

      // Regroupement en grands secteurs géographiques (partition par CP, rayon 15 km).
      // On annote chaque secteur CP avec son grand secteur ; la forme de retour
      // (tableau de secteurs CP) reste inchangée pour le hook/la page.
      const groups = clusterSectorsByProximity(sortedSectors, { radiusKm: 15 });
      const cpToGroup = new Map();
      groups.forEach((g, idx) => {
        for (const cp of g.codePostals) cpToGroup.set(cp, { id: g.id, name: g.name, order: idx });
      });
      for (const sector of sortedSectors) {
        const g = cpToGroup.get(sector.codePostal) || {
          id: 'non-localise', name: 'Non localisé', order: groups.length,
        };
        sector.grandSecteurId = g.id;
        sector.grandSecteurName = g.name;
        sector.grandSecteurOrder = g.order;
      }

      return { data: sortedSectors, error: null };
    } catch (error) {
      console.error('[entretiensService] getContractsBySector exception:', error);
      return { data: [], error };
    }
  },
```

- [ ] **Step 3 : Vérifier le build**

Run : `npx vite build`
Expected : build OK (pas d'erreur d'import/syntaxe).

- [ ] **Step 4 : Commit**

```bash
git add src/shared/services/entretiens.service.js
git commit -m "feat(secteurs): merge coords + annotation grand secteur dans getContractsBySector"
```

---

### Task B3 : Rendu hiérarchique dans `SectorGroupView`

**Files:**
- Modify: `src/apps/artisan/components/entretiens/SectorGroupView.jsx`

- [ ] **Step 1 : Ajouter le sous-composant `GrandSecteurHeader`**

Juste après le composant `SectorHeader` (avant `ContractRow`), ajouter :
```jsx
function GrandSecteurHeader({ group, isExpanded, onToggle, canPlan, onPlanGroup, isPlanningDisabled, plannableCount }) {
  const completionPct =
    group.totalContracts > 0 ? Math.round((group.visitsDone / group.totalContracts) * 100) : 0;
  const isNonLocalise = group.id === 'non-localise';

  return (
    <div className="flex items-center gap-1 bg-gray-50">
      <button onClick={onToggle} className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0">
        <div className="flex-shrink-0 text-gray-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MapPin className={`h-4 w-4 flex-shrink-0 ${isNonLocalise ? 'text-gray-400' : 'text-indigo-500'}`} />
          <span className="font-semibold text-gray-900 truncate">{group.name}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {group.sectors.length} CP
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-8 text-right">{completionPct}%</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {group.visitsDone}
            </span>
            <span className="text-gray-300">|</span>
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Clock className="h-3.5 w-3.5" />
              {group.visitsPending}
            </span>
          </div>
        </div>
      </button>

      {canPlan && plannableCount > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPlanGroup?.(group); }}
          disabled={isPlanningDisabled}
          className="mr-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50 flex-shrink-0"
          title={`Programmer ${plannableCount} entretien${plannableCount > 1 ? 's' : ''} sur ce grand secteur`}
        >
          <Calendar className="h-3.5 w-3.5" />
          Planifier le grand secteur ({plannableCount})
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Ajouter l'état + le memo de regroupement dans `SectorGroupView`**

Dans le composant `SectorGroupView`, après la ligne `const [searchQuery, setSearchQuery] = useState('');`, ajouter l'état des groupes (par défaut tous dépliés → on suit les groupes *repliés*) :
```jsx
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
```

Après le `useMemo` `filteredSectors`, ajouter le regroupement par grand secteur :
```jsx
  // Regrouper les secteurs CP filtrés sous leur grand secteur
  const grandSecteurs = useMemo(() => {
    const map = new Map();
    for (const s of filteredSectors) {
      const key = s.grandSecteurId || 'non-localise';
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: s.grandSecteurName || 'Non localisé',
          order: s.grandSecteurOrder ?? 9999,
          sectors: [],
          totalContracts: 0,
          visitsDone: 0,
          visitsPending: 0,
        });
      }
      const g = map.get(key);
      g.sectors.push(s);
      g.totalContracts += s.totalContracts;
      g.visitsDone += s.visitsDone;
      g.visitsPending += s.visitsPending;
    }
    return [...map.values()].sort(
      (a, b) =>
        (a.id === 'non-localise' ? 1 : 0) - (b.id === 'non-localise' ? 1 : 0) ||
        a.order - b.order ||
        b.visitsPending - a.visitsPending ||
        a.name.localeCompare(b.name),
    );
  }, [filteredSectors]);

  const toggleGroup = (id) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
```

- [ ] **Step 3 : Mettre à jour `expandAll` / `collapseAll`**

Remplacer les deux fonctions existantes par :
```jsx
  const expandAll = () => {
    setExpandedSectors(new Set(filteredSectors.map((s) => s.codePostal)));
    setCollapsedGroups(new Set());
  };

  const collapseAll = () => {
    setExpandedSectors(new Set());
    setCollapsedGroups(new Set(grandSecteurs.map((g) => g.id)));
  };
```

- [ ] **Step 4 : Remplacer le bloc « Liste des secteurs »**

Remplacer le bloc de rendu `{filteredSectors.length > 0 && ( ... )}` (la `<div>` qui mappe `filteredSectors`) par un rendu à deux niveaux :
```jsx
      {/* Liste des grands secteurs → CP → contrats */}
      {grandSecteurs.length > 0 && (
        <div className="space-y-3">
          {grandSecteurs.map((group) => {
            const isGroupExpanded = searchQuery.trim() ? true : !collapsedGroups.has(group.id);
            const groupPlannable = group.sectors.reduce(
              (n, s) =>
                n +
                s.contracts.filter(
                  (c) => !plannedContractIds?.has(c.id) && c.current_year_visit_status !== 'completed',
                ).length,
              0,
            );
            return (
              <div key={group.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <GrandSecteurHeader
                  group={group}
                  isExpanded={isGroupExpanded}
                  onToggle={() => toggleGroup(group.id)}
                  canPlan={canPlan}
                  onPlanGroup={(g) =>
                    onPlanSector?.({
                      codePostal: g.name,
                      contracts: g.sectors.flatMap((s) =>
                        s.contracts.filter(
                          (c) =>
                            !plannedContractIds?.has(c.id) &&
                            c.current_year_visit_status !== 'completed',
                        ),
                      ),
                    })
                  }
                  isPlanningDisabled={isPlanningDisabled}
                  plannableCount={groupPlannable}
                />
                {isGroupExpanded && (
                  <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {group.sectors.map((sector) => {
                      const isExpanded = effectiveExpanded.has(sector.codePostal);
                      const plannableCount = sector.contracts.filter(
                        (c) =>
                          !plannedContractIds?.has(c.id) &&
                          c.current_year_visit_status !== 'completed',
                      ).length;
                      return (
                        <div key={sector.codePostal}>
                          <SectorHeader
                            sector={sector}
                            isExpanded={isExpanded}
                            onToggle={() => toggleSector(sector.codePostal)}
                            canPlan={canPlan}
                            onPlanSector={onPlanSector}
                            isPlanningDisabled={isPlanningDisabled}
                            plannableCount={plannableCount}
                          />
                          {isExpanded && (
                            <SectorContracts
                              contracts={sector.contracts}
                              onContractClick={onContractClick}
                              canPlan={canPlan}
                              onPlanContract={onPlanContract}
                              isPlanningDisabled={isPlanningDisabled}
                              plannedContractIds={plannedContractIds}
                              remindedClientIds={remindedClientIds}
                              onSendReminder={onSendReminder}
                              canSendReminder={canSendReminder}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
```

- [ ] **Step 5 : Afficher la commune sur chaque ligne contrat**

Dans `ContractRow`, après le nom du client (juste avant le bloc `{monthLabel && ...}`), ajouter la commune réelle du client :
```jsx
      {/* Commune réelle du client (résout l'ambiguïté CP multi-communes) */}
      {contract.client_city && (
        <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">
          {contract.client_city}
        </span>
      )}
```

- [ ] **Step 6 : Vérifier le build**

Run : `npx vite build`
Expected : build OK.

- [ ] **Step 7 : Commit**

```bash
git add src/apps/artisan/components/entretiens/SectorGroupView.jsx
git commit -m "feat(secteurs): regroupement grand secteur > CP > contrat dans la Programmation"
```

---

### Task B4 : Vérification fonctionnelle finale

- [ ] **Step 1 : Build complet**

Run : `npx vite build`
Expected : succès, aucun warning nouveau.

- [ ] **Step 2 : Revue manuelle (Eric, hors agent)**

Sur l'onglet Entretiens → Programmation :
- Les contrats sont regroupés sous des grands secteurs nommés par commune (ex. « Gaillac », « Albi »).
- Chaque ligne contrat affiche sa commune réelle.
- « Planifier le grand secteur (N) » programme tous les entretiens planifiables du groupe.
- Aucun contrat en double ; les éventuels CP sans coordonnées apparaissent sous « Non localisé ».

- [ ] **Step 3 : Aucun commit** (vérification seule).

---

## Self-Review (couverture spec → plan)

- **A.1 edge geocode-sweep** → Task A3 ✅
- **A.2 cron 30 min** → Task A4 ✅
- **A.3 RPCs service_role** → Task A2 ✅
- **A.4 geocode_attempts (minimal)** → Task A1 ✅
- **A.5 multi-tenant org-agnostique** → RPCs sans org dérivé, géocodage adresse→coords (Task A2/A3) ✅
- **A.6 backfill** → Task A5 ✅
- **B.1 fonction pure + tests** → Task B1 ✅
- **B.2 coords (alternative 2ᵉ requête, sans toucher la vue)** → Task B2 ✅
- **B.3 service/hook** → Task B2 (hook inchangé, annotation côté service) ✅
- **B.4 UI 3 niveaux + Planifier le grand secteur + commune par ligne** → Task B3 ✅
- **B.5 zéro doublon (test conservation) / zéro orphelin (Non localisé + singleton isolé)** → Task B1 tests ✅

Pas de placeholder, signatures cohérentes (`clusterSectorsByProximity`, `haversineKm`, champs `grandSecteurId/Name/Order`, `geocode_fetch_pending_clients`, `geocode_apply_client_coordinates`).
