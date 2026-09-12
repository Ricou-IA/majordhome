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
  // Précision BAN (housenumber | street | locality | municipality) — posée par la
  // RPC geocode_apply_client_coordinates dans clients.address_precision (2026-09-12).
  precision?: string;
}

// Un appel BAN unitaire, borné à 8 s. Retourne la 1re feature si son score passe
// le seuil, sinon null (échec réseau compris).
async function banSearch(params: URLSearchParams): Promise<{ lat: number; lng: number; type: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${GOUV_SEARCH}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const f = data?.features?.[0];
    const score = f?.properties?.score ?? 0;
    if (!f || score < SCORE_MIN) return null;
    const [lng, lat] = f.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, type: String(f.properties?.type ?? "") };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// Géocode une adresse en deux étages : l'adresse exacte, puis — si elle n'est
// pas reconnue mais qu'un code postal existe — la COMMUNE (centroïde, précision
// « municipality »). Une adresse mal saisie ne bloque plus le calcul des
// tournées : « le code postal suffit dans 99 % des cas » (décision 2026-09-12).
// Retourne lat/lng null seulement si même la commune est inconnue.
async function geocodeOne(c: PendingClient): Promise<ApplyRow> {
  const echec: ApplyRow = { id: c.id, lat: null, lng: null };
  const q = [c.address, c.postal_code, c.city].filter(Boolean).join(" ").trim();

  if (q.length >= 5) {
    const params = new URLSearchParams({ q, limit: "1" });
    if (c.postal_code) params.set("postcode", c.postal_code);
    const exact = await banSearch(params);
    if (exact) return { id: c.id, lat: exact.lat, lng: exact.lng, precision: exact.type || undefined };
  }

  if (c.postal_code && /^\d{5}$/.test(c.postal_code)) {
    const params = new URLSearchParams({ q: c.city || c.postal_code, type: "municipality", postcode: c.postal_code, limit: "1" });
    const commune = await banSearch(params);
    if (commune) return { id: c.id, lat: commune.lat, lng: commune.lng, precision: "municipality" };
  }
  return echec;
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
