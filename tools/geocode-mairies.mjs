/**
 * geocode-mairies.mjs — Géocode les mairies importées (one-shot).
 * Lit docs/imports/mairies-tarn-81.csv, déduplique par ville (1ʳᵉ occurrence = fiche
 * importée, on saute la ligne DOUBLON), géocode via api-adresse.data.gouv.fr (gratuit,
 * sans clé), et écrit un UPDATE SQL (clé = city) dans docs/imports/_geo_update.sql.
 * Le SQL est ensuite appliqué via le MCP Supabase (l'anon key locale ne peut pas écrire).
 *
 * Usage : node tools/geocode-mairies.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CSV = 'docs/imports/mairies-tarn-81.csv';
const OUT = 'docs/imports/_geo_update.sql';
const API = 'https://api-adresse.data.gouv.fr/search/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const raw = readFileSync(CSV, 'utf8').replace(/^\uFEFF/, ''); // strip BOM
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
lines.shift(); // header

// Dédup par ville (1ʳᵉ occurrence), skip DOUBLON
const seen = new Set();
const rows = [];
for (const line of lines) {
  const c = line.split(';');
  const adresse = (c[3] || '').trim();
  const cp = (c[4] || '').trim();
  const ville = (c[5] || '').trim();
  const remarque = (c[7] || '').trim();
  if (!ville || /DOUBLON/i.test(remarque)) continue;
  if (seen.has(ville)) continue;
  seen.add(ville);
  rows.push({ ville, q: `${adresse} ${cp} ${ville}`.trim() });
}

console.log(`Villes uniques à géocoder : ${rows.length}`);

const ok = [];
const fail = [];
for (const r of rows) {
  try {
    const url = `${API}?limit=1&q=${encodeURIComponent(r.q)}`;
    const res = await fetch(url);
    if (!res.ok) { fail.push({ ...r, why: `HTTP ${res.status}` }); await sleep(120); continue; }
    const data = await res.json();
    const f = data.features?.[0];
    const score = f?.properties?.score ?? 0;
    if (!f || score < 0.3) { fail.push({ ...r, why: `score ${score}` }); await sleep(120); continue; }
    const [lng, lat] = f.geometry.coordinates;
    ok.push({ ville: r.ville, lat, lng, score, label: f.properties.label });
  } catch (e) {
    fail.push({ ...r, why: e.message });
  }
  await sleep(120); // rate limit doux
}

// Génère le SQL : UPDATE ... FROM (VALUES ...) keyed sur city
const values = ok
  .map((o) => `(${sqlStr(o.ville)}, ${o.lat}, ${o.lng})`)
  .join(',\n  ');

const sql = `-- Géocodage mairies Tarn (api-adresse.data.gouv.fr) — ${ok.length} villes
UPDATE majordhome.clients c
SET latitude = v.lat, longitude = v.lng, geocoded_at = now()
FROM (VALUES
  ${values}
) AS v(city, lat, lng)
WHERE c.import_source = 'pdf_mairies_tarn_2026' AND c.city = v.city;
`;
writeFileSync(OUT, sql, 'utf8');

console.log(`OK : ${ok.length} | Échecs : ${fail.length}`);
if (fail.length) console.log('Échecs:', fail.map((f) => `${f.ville} (${f.why})`).join(', '));
console.log(`SQL écrit dans ${OUT}`);
