// scripts/fetch-pvgis-fixture.mjs
// Génère une fixture PVGIS de référence (production horaire pour 1 kWc, 8760 h alignées)
// pour faire tourner le simulateur autoconso 100% côté navigateur, sans l'edge pvgis-proxy.
// Gaillac (Mayer), pente 30°, plein sud, année 2020 (bissextile → alignTo8760 retire le 29 févr.).
// Le simulateur multiplie ensuite par la puissance kWc choisie.
// Run : node scripts/fetch-pvgis-fixture.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { pvgisToProdHourly } from '../src/apps/solaire/lib/pvgisHourly.js';

const LAT = 43.90, LON = 1.90, ANGLE = 30, ASPECT = 0;
const url = 'https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?' + new URLSearchParams({
  lat: String(LAT), lon: String(LON), startyear: '2020', endyear: '2020',
  pvcalculation: '1', peakpower: '1', loss: '14', angle: String(ANGLE), aspect: String(ASPECT), outputformat: 'json',
});
console.log('Fetch PVGIS seriescalc Gaillac 1 kWc…');
const { outputs } = await fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
const { prodHourly, year } = pvgisToProdHourly(outputs.hourly, 1); // 1 kWc → kWh/h

const annual = prodHourly.reduce((a, b) => a + b, 0);
console.log('Année', year, '| pas', prodHourly.length, '| production', annual.toFixed(0), 'kWh/an/kWc');

mkdirSync(new URL('../src/apps/solaire/data/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../src/apps/solaire/data/pvgis-gaillac-1kwc.json', import.meta.url),
  JSON.stringify({
    source: 'PVGIS v5.2 seriescalc',
    location: 'Gaillac (81)', lat: LAT, lon: LON, angle: ANGLE, aspect: ASPECT,
    year, unit: 'kWh/h pour 1 kWc (multiplier par la puissance installée)',
    annualKwhPerKwc: Math.round(annual),
    hourly: prodHourly.map((x) => Math.round(x * 1000) / 1000),
  }, null, 0) + '\n'
);
console.log('Fixture écrite : scripts/fixtures/pvgis-gaillac-1kwc.json');
