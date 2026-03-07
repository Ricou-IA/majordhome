/**
 * generate-postal-codes-geojson.mjs
 *
 * Script one-shot : génère le GeoJSON simplifié des codes postaux
 * pour les départements 31, 81, 82 à partir de l'API geo.api.gouv.fr
 *
 * Usage: node scripts/generate-postal-codes-geojson.mjs
 * Output: public/data/codes-postaux-31-81-82.geojson
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '../public/data');
const OUTPUT_FILE = resolve(OUTPUT_DIR, 'codes-postaux-31-81-82.geojson');

const DEPARTEMENTS = ['31', '81', '82'];

async function fetchCommunes(dep) {
  const url = `https://geo.api.gouv.fr/departements/${dep}/communes?format=geojson&geometry=contour`;
  console.log(`  Fetching dept ${dep}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for dept ${dep}`);
  const data = await res.json();
  console.log(`  Dept ${dep}: ${data.features.length} communes`);
  return data;
}

// Simple polygon union using coordinate merging
// For proper union we need @turf/turf
let turf;
try {
  turf = await import('@turf/turf');
} catch {
  console.error('ERROR: @turf/turf is required. Run: npm install @turf/turf');
  process.exit(1);
}

async function main() {
  console.log('=== Génération GeoJSON codes postaux ===\n');

  // 1. Fetch all communes
  const allCommunes = [];
  for (const dep of DEPARTEMENTS) {
    const geojson = await fetchCommunes(dep);
    allCommunes.push(...geojson.features);
  }
  console.log(`\nTotal: ${allCommunes.length} communes\n`);

  // 2. Group by postal code
  const byPostalCode = {};
  for (const commune of allCommunes) {
    const codes = commune.properties.codesPostaux || [];
    if (codes.length === 0) {
      // Fallback: use code commune as approximation
      const code = commune.properties.code;
      if (code) {
        const cp = code.substring(0, 2) + code.substring(2).padStart(3, '0');
        if (!byPostalCode[cp]) byPostalCode[cp] = [];
        byPostalCode[cp].push(commune);
      }
      continue;
    }
    for (const cp of codes) {
      if (!byPostalCode[cp]) byPostalCode[cp] = [];
      byPostalCode[cp].push(commune);
    }
  }

  const cpCodes = Object.keys(byPostalCode).sort();
  console.log(`Codes postaux trouvés: ${cpCodes.length}\n`);

  // 3. Dissolve communes per postal code
  const features = [];
  let errors = 0;

  for (const cp of cpCodes) {
    const communes = byPostalCode[cp];
    try {
      let merged;
      if (communes.length === 1) {
        merged = communes[0];
      } else {
        // Union all commune polygons for this postal code
        merged = communes[0];
        for (let i = 1; i < communes.length; i++) {
          try {
            const result = turf.union(
              turf.featureCollection([merged, communes[i]])
            );
            if (result) merged = result;
          } catch {
            // Skip bad geometry, keep what we have
          }
        }
      }

      // Simplify to reduce file size
      merged = turf.simplify(merged, { tolerance: 0.002, highQuality: true });

      // Set properties
      merged.properties = {
        postal_code: cp,
        department: cp.substring(0, 2),
      };

      features.push(merged);
    } catch (e) {
      errors++;
      console.warn(`  WARN: Failed to process CP ${cp}: ${e.message}`);
    }
  }

  console.log(`\nProcessed: ${features.length} postal codes (${errors} errors)\n`);

  // 4. Build FeatureCollection and write
  const fc = {
    type: 'FeatureCollection',
    features,
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const json = JSON.stringify(fc);
  writeFileSync(OUTPUT_FILE, json);

  const sizeMB = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
  console.log(`Written: ${OUTPUT_FILE}`);
  console.log(`Size: ${sizeMB} MB`);
  console.log(`Features: ${features.length} postal code polygons`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
