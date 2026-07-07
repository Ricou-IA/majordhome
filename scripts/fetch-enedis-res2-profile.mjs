// scripts/fetch-enedis-res2-profile.mjs
// Génère la fixture talon Enedis RES2 normalisée (8760 h, Σ=1) pour le moteur solaire.
// Source : Enedis Open Data `conso-inf36` (agrégats ½h mesurés), profil résidentiel
// RES2 = foyer AVEC chauffage électrique (courbe hiver très marquée), plage P0 (≤36 kVA),
// année NON bissextile 2023 (→ 8760 h alignées moteur). Pendant de fetch-enedis-res1-profile.mjs.
// Méthode : pull export JSON → agrège les 2 pas ½h de chaque heure (Wh) → normalise.
// Run : node scripts/fetch-enedis-res2-profile.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const YEAR = 2023; // non bissextile → 8760 h
const HOURS = 8760;
const PROFIL = 'RES2 (+ RES2WE)';
const PLAGE = 'P0: Total <= 36 kVA';

const where =
  `profil like "RES2%" and plage_de_puissance_souscrite like "P0%" ` +
  `and horodate >= "${YEAR}-01-01" and horodate < "${YEAR + 1}-01-01"`;
const url =
  'https://opendata.enedis.fr/api/explore/v2.1/catalog/datasets/conso-inf36/exports/json?' +
  new URLSearchParams({ where, select: 'horodate,courbe_moyenne_ndeg1_ndeg2_wh', order_by: 'horodate' });

console.log('Fetch export Enedis RES2 P0', YEAR, '…');
const rows = await fetch(url).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
});
console.log('Lignes reçues :', rows.length, '(attendu ~17520 ½h)');

const yearStartMs = Date.UTC(YEAR, 0, 1, 0, 0, 0);
const hourly = new Array(HOURS).fill(0);
const filled = new Array(HOURS).fill(0);
let skipped = 0;
for (const row of rows) {
  const v = row.courbe_moyenne_ndeg1_ndeg2_wh;
  if (v == null) { skipped++; continue; }
  const idx = Math.floor((Date.parse(row.horodate) - yearStartMs) / 3600000);
  if (idx < 0 || idx >= HOURS) { skipped++; continue; }
  hourly[idx] += v;  // somme des 2 pas ½h → Wh/h
  filled[idx] += 1;
}

const missing = filled.filter((c) => c === 0).length;
const total = hourly.reduce((a, b) => a + b, 0);
if (total <= 0) throw new Error('Somme nulle — données inattendues');
const normalized = hourly.map((x) => x / total); // Σ = 1

console.log('Heures manquantes :', missing, '| lignes ignorées :', skipped, '| Σ avant normalisation (Wh) :', total);

mkdirSync(new URL('../src/apps/solaire/data/', import.meta.url), { recursive: true });
const outPath = new URL('../src/apps/solaire/data/enedis-res2-base-normalized.json', import.meta.url);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      source: 'Enedis Open Data conso-inf36 (agrégats ½h mesurés)',
      profil: PROFIL,
      plage: PLAGE,
      annee: YEAR,
      note: '8760 h, Σ(hourly)=1. Foyer avec chauffage électrique (RES2). Agrégation ½h→h (somme des 2 pas), normalisé. Horodate UTC.',
      hourly: normalized,
    },
    null,
    0
  ) + '\n'
);
console.log('Fixture écrite :', outPath.pathname, '| longueur :', normalized.length, '| Σ :', normalized.reduce((a, b) => a + b, 0).toFixed(6));
