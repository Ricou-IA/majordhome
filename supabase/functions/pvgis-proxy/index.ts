// pvgis-proxy — relais CORS vers PVGIS v5.2 PVcalc (PVGIS n'envoie pas d'en-têtes CORS).
// verify_jwt:true + requireOrgMembership : réservé aux users authentifiés d'une org.
// peakpower=1 FORCÉ côté serveur : la production est linéaire en kWc, le front
// multiplie — 1 seul appel PVGIS par simulation (spec §7.1).
import { requireOrgMembership, jsonResponse, sanitizeError, buildCorsHeaders } from "../_shared/auth.ts";

const PVGIS_URL = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc";

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    const auth = await requireOrgMembership(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const lat = num(body.lat);
    const lon = num(body.lon);
    const loss = num(body.loss) ?? 14;
    const angle = num(body.angle) ?? 10;
    const aspect = num(body.aspect) ?? 0;

    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return jsonResponse({ error: "lat/lon invalides" }, 400, req);
    }
    if (loss < 0 || loss > 30 || angle < 0 || angle > 90 || aspect < -180 || aspect > 180) {
      return jsonResponse({ error: "Parametres hors bornes" }, 400, req);
    }

    const params = new URLSearchParams({
      lat: String(lat), lon: String(lon), peakpower: "1", loss: String(loss),
      angle: String(angle), aspect: String(aspect), outputformat: "json",
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${PVGIS_URL}?${params}`, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return jsonResponse({ error: `PVGIS a repondu ${res.status}`, detail }, 502, req);
    }

    const data = await res.json();
    const monthly = data?.outputs?.monthly?.fixed;
    const eY = data?.outputs?.totals?.fixed?.E_y;
    if (!Array.isArray(monthly) || monthly.length !== 12 || typeof eY !== "number") {
      return jsonResponse({ error: "Reponse PVGIS inattendue" }, 502, req);
    }

    const e_m = monthly.map((m: { E_m: number }) => m.E_m);
    return jsonResponse(
      { e_m, e_y: eY, params: { lat, lon, loss, angle, aspect, peakpower: 1 } },
      200, req,
    );
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return jsonResponse(
      { error: aborted ? "PVGIS ne repond pas (timeout)" : sanitizeError(err, "pvgis-proxy error") },
      aborted ? 504 : 500, req,
    );
  }
});
