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
