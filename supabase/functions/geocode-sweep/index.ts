// supabase/functions/geocode-sweep/index.ts
// ============================================================================
// geocode-sweep — Balayage serveur de géocodage des clients (toutes orgs)
// ============================================================================
// Rattrape tout ce qui crée un client hors modale (cron Pennylane, N8N, imports),
// les échecs de géocodage, et les ré-adressages (geocoded_at remis à NULL par le
// trigger). Source de vérité : geocoded_at IS NULL + adresse exploitable.
//
// Géocodage via l'endpoint unitaire éprouvé /search/ de api-adresse.data.gouv.fr
// (gratuit), en petits paquets concurrents pour rester poli.
//
// Pattern : pg_cron (30 min) → cette edge (verify_jwt:false, MDH_CRON_SECRET) →
//   1. geocode_fetch_pending_clients(limit)
//   2. géocodage unitaire
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
const GOUV_SEARCH = "https://api-adresse.data.gouv.fr/search/";
const BATCH_LIMIT = 100;
const SCORE_MIN = 0.3;
const CHUNK = 5;

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

// Géocode une adresse via l'endpoint unitaire gouv. Retourne lat/lng null si échec
// ou score < seuil.
async function geocodeOne(c: PendingClient): Promise<ApplyRow> {
  const q = [c.address, c.postal_code, c.city].filter(Boolean).join(" ").trim();
  if (q.length < 5) return { id: c.id, lat: null, lng: null };

  const params = new URLSearchParams({ q, limit: "1" });
  if (c.postal_code) params.set("postcode", c.postal_code);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${GOUV_SEARCH}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { id: c.id, lat: null, lng: null };

    const data = await res.json();
    const f = data?.features?.[0];
    const score = f?.properties?.score ?? 0;
    if (!f || score < SCORE_MIN) return { id: c.id, lat: null, lng: null };

    const [lng, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { id: c.id, lat: null, lng: null };
    return { id: c.id, lat, lng };
  } catch {
    clearTimeout(timeout);
    return { id: c.id, lat: null, lng: null };
  }
}

// Géocode le lot en petits paquets concurrents.
async function geocodeBatch(clients: PendingClient[]): Promise<ApplyRow[]> {
  const out: ApplyRow[] = [];
  for (let i = 0; i < clients.length; i += CHUNK) {
    const chunk = clients.slice(i, i + CHUNK);
    out.push(...(await Promise.all(chunk.map(geocodeOne))));
    if (i + CHUNK < clients.length) await new Promise((r) => setTimeout(r, 100));
  }
  return out;
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
