// google-solar-proxy — relais Google Solar API (clé edge-only). Spec §5.
// verify_jwt:true + requireOrgMembership. Cache write-through majordhome.google_solar_cache
// (coût marginal 0 sur ré-sim d'une même adresse). Hard cap mensuel/journalier par SKU.
// mode: 'building_insights' (géométrie toit) | 'data_layers' (heatmap flux) | 'both'.
import { requireOrgMembership, jsonResponse, sanitizeError, buildCorsHeaders } from "../_shared/auth.ts";
// NB : la rasterisation GeoTIFF (./geotiff.ts) est DIFFÉRÉE — l'import esm.sh de `geotiff`
// tire `node:vm`, indisponible dans le runtime Edge Supabase (spike §9.4). Le module reste
// dans le repo ; la branche data_layers ci-dessous sert le cache ou renvoie null (jamais bloquant).

const SOLAR = "https://solar.googleapis.com/v1";
const KEY = Deno.env.get("GOOGLE_SOLAR_API_KEY") || "";
const CACHE_VIEW = "majordhome_google_solar_cache";

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

    // ── Data Layers (heatmap flux) — DIFFÉRÉ (spike GeoTIFF §9.4) ─────────────────────────
    // La rasterisation GeoTIFF côté edge est bloquée par `node:vm` (runtime Deno Supabase).
    // On sert le flux s'il est déjà en cache, sinon null → l'offre s'affiche sans heatmap
    // (jamais bloquant, spec §5.3). Réactivation quand la voie de rasterisation est trouvée.
    if (mode === "data_layers" || mode === "both") {
      result.fluxImagePath = cache?.flux_image_path ?? null;
      result.fluxDeferred = true;
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
