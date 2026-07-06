// ign-mns-proxy — relaie le GeoTIFF d'élévation IGN LiDAR HD MNS (Modèle Numérique de Surface,
// altitude incl. toitures, 0,5 m, open data Licence Ouverte) au navigateur.
// verify_jwt:true + requireOrgMembership. Le proxy existe pour CORS + auth (pas de clé API :
// open data). Décodage/plane-fit côté navigateur (src/apps/solaire/lib/ignMns.js).
// Body { bboxL93:[minE,minN,maxE,maxN], width, height } — déjà en Lambert-93 (le navigateur
// fait la transfo WGS84→L93). Pas de cache en v1.
import { requireOrgMembership, jsonResponse, sanitizeError, buildCorsHeaders } from "../_shared/auth.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const WMS = "https://data.geopf.fr/wms-r";
const LAYER = "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93";

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function intInRange(v: unknown, lo: number, hi: number): number | null {
  const n = num(v);
  if (n === null || !Number.isInteger(n)) return null;
  return n >= lo && n <= hi ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  try {
    const auth = await requireOrgMembership(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const bbox = Array.isArray(body.bboxL93) ? body.bboxL93.map(num) : null;
    const width = intInRange(body.width, 8, 800);
    const height = intInRange(body.height, 8, 800);

    if (!bbox || bbox.length !== 4 || bbox.some((v: number | null) => v === null)) {
      return jsonResponse({ error: "bboxL93 invalide" }, 400, req);
    }
    if (width === null || height === null) {
      return jsonResponse({ error: "width/height doivent être des entiers dans [8, 800]" }, 400, req);
    }
    const [minE, minN, maxE, maxN] = bbox as number[];
    // Plage plausible Lambert-93 France métropolitaine (garde-fou anti-injection de bbox absurde).
    const eOk = (e: number) => e >= 0 && e <= 1_300_000;
    const nOk = (n: number) => n >= 6_000_000 && n <= 7_200_000;
    if (!eOk(minE) || !eOk(maxE) || !nOk(minN) || !nOk(maxN) || minE >= maxE || minN >= maxN) {
      return jsonResponse({ error: "bboxL93 hors emprise France métropolitaine (L93)" }, 400, req);
    }

    // WMS 1.3.0, CRS projeté EPSG:2154 → ordre d'axe BBOX = E,N (minE,minN,maxE,maxN).
    const url = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap`
      + `&LAYERS=${LAYER}&STYLES=&FORMAT=image/geotiff&CRS=EPSG:2154`
      + `&BBOX=${minE},${minN},${maxE},${maxN}&WIDTH=${width}&HEIGHT=${height}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return jsonResponse({ error: `IGN WMS ${res.status}`, detail }, 502, req);
    }

    const buf = await res.arrayBuffer();
    return jsonResponse({
      mnsTiff: encodeBase64(new Uint8Array(buf)),
      width,
      height,
      bboxL93: [minE, minN, maxE, maxN],
    }, 200, req);
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return jsonResponse(
      { error: aborted ? "IGN WMS ne répond pas (timeout)" : sanitizeError(err, "ign-mns-proxy error") },
      aborted ? 504 : 500, req,
    );
  }
});
