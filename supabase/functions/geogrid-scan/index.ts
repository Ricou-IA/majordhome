import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress";

function generateGrid(centerLat: number, centerLng: number, radiusKm: number, gridSize: number) {
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const deltaLat = radiusKm / kmPerDegLat;
  const deltaLng = radiusKm / kmPerDegLng;
  const latMin = centerLat - deltaLat;
  const latMax = centerLat + deltaLat;
  const lngMin = centerLng - deltaLng;
  const lngMax = centerLng + deltaLng;
  const steps = gridSize > 1 ? gridSize - 1 : 1;
  const latStep = (latMax - latMin) / steps;
  const lngStep = (lngMax - lngMin) / steps;
  const points = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      points.push({
        row, col,
        lat: parseFloat((latMax - row * latStep).toFixed(6)),
        lng: parseFloat((lngMin + col * lngStep).toFixed(6)),
        label: null as string | null,
        code: null as string | null,
      });
    }
  }
  return points;
}

async function searchNearby(lat: number, lng: number, keyword: string, radiusM: number) {
  const resp = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: keyword,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      maxResultCount: 20,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Places API ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.places || [];
}

function normalizeName(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function findRank(places: any[], businessName: string, placeId: string): number | null {
  const nameNorm = normalizeName(businessName);
  for (let i = 0; i < places.length; i++) {
    if (placeId && places[i].id === placeId) return i + 1;
    const display = normalizeName(places[i].displayName?.text || "");
    if (nameNorm && display.includes(nameNorm)) return i + 1;
  }
  return null;
}

function extractTopPlaces(places: any[], businessName: string, placeId: string) {
  const nameNorm = normalizeName(businessName);
  return places.slice(0, 10).map((p, i) => {
    const name = p.displayName?.text || "";
    const isYou = (placeId && p.id === placeId) || (nameNorm && normalizeName(name).includes(nameNorm));
    return { rank: i + 1, name, address: p.formattedAddress || "", isYou };
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, x-app-name, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      mode = "grid",
      keyword,
      businessName,
      placeId = "",
      centerLat,
      centerLng,
      radiusKm = 5,
      gridSize = 7,
      searchRadiusM = 1000,
      orgId,
      points: customPoints = [],
    } = body;

    if (!keyword || !businessName || !centerLat || !centerLng || !orgId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ error: "GOOGLE_PLACES_API_KEY secret not configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (mode !== "grid" && mode !== "cities") {
      return new Response(JSON.stringify({ error: `Invalid mode: ${mode}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (mode === "cities" && (!Array.isArray(customPoints) || customPoints.length === 0)) {
      return new Response(JSON.stringify({ error: "Cities mode requires non-empty 'points' array" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const scanPoints = mode === "cities"
      ? customPoints.map((p: any, i: number) => ({
          row: i,
          col: 0,
          lat: p.lat,
          lng: p.lng,
          label: p.name || null,
          code: p.code || null,
        }))
      : generateGrid(centerLat, centerLng, radiusKm, gridSize);

    const results: any[] = [];
    let top3 = 0, top10 = 0, found = 0;

    for (let i = 0; i < scanPoints.length; i++) {
      const point = scanPoints[i];
      let rank: number | null = null;
      let totalResults = 0;
      let status = "ok";
      let topPlaces: any[] = [];

      try {
        const places = await searchNearby(point.lat, point.lng, keyword, searchRadiusM);
        totalResults = places.length;
        rank = findRank(places, businessName, placeId);
        topPlaces = extractTopPlaces(places, businessName, placeId);
      } catch (_e) {
        try {
          await sleep(1000);
          const places = await searchNearby(point.lat, point.lng, keyword, searchRadiusM);
          totalResults = places.length;
          rank = findRank(places, businessName, placeId);
          topPlaces = extractTopPlaces(places, businessName, placeId);
          status = "ok (retry)";
        } catch (e2) {
          status = `error: ${(e2 as Error).message}`;
        }
      }

      if (rank !== null) { found++; if (rank <= 3) top3++; if (rank <= 10) top10++; }
      results.push({
        row_idx: point.row,
        col_idx: point.col,
        lat: point.lat,
        lng: point.lng,
        rank,
        total_results: totalResults,
        status,
        places: topPlaces,
        point_label: point.label,
        point_code: point.code,
      });
      if (i < scanPoints.length - 1) await sleep(200);
    }

    const stats = { top3, top10, found, total: scanPoints.length, absent: scanPoints.length - found };
    const scanId = crypto.randomUUID();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { error: scanError } = await supabase
      .from("majordhome_geogrid_scans_write")
      .insert({
        id: scanId,
        org_id: orgId,
        business_name: businessName,
        place_id: placeId || null,
        keyword,
        center_lat: centerLat,
        center_lng: centerLng,
        radius_km: mode === "cities" ? null : radiusKm,
        grid_size: mode === "cities" ? null : gridSize,
        search_radius_m: searchRadiusM,
        stats,
        scan_mode: mode,
      });

    if (scanError) {
      return new Response(JSON.stringify({ error: `DB scan insert: ${scanError.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = results.map((r) => ({ ...r, scan_id: scanId }));
    const { error: resultsError } = await supabase.from("majordhome_geogrid_results_write").insert(rows);

    if (resultsError) {
      return new Response(JSON.stringify({ error: `DB results insert: ${resultsError.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ scanId, stats, results, mode }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
