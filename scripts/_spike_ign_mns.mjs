// scripts/_spike_ign_mns.mjs — THROWAWAY : vérifie que le WMS IGN LiDAR HD MNS renvoie
// un GeoTIFF d'ÉLÉVATION BRUTE (float, mètres) et non une image ombrée. Zone test : Gaillac (81).
// Usage : node scripts/_spike_ign_mns.mjs
import { fromArrayBuffer } from 'geotiff';

// Petite emprise (~80 m) dans la dalle LiDAR HD 0609_6314 (Gaillac), en Lambert-93 (EPSG:2154).
const bbox = '609400,6313400,609480,6313480'; // minE,minN,maxE,maxN
const url = 'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
  + '&LAYERS=IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'
  + '&STYLES=&FORMAT=image/geotiff&CRS=EPSG:2154'
  + `&BBOX=${bbox}&WIDTH=160&HEIGHT=160`;

const res = await fetch(url);
console.log('HTTP', res.status, '·', res.headers.get('content-type'));
const buf = await res.arrayBuffer();
console.log('bytes', buf.byteLength);
if (!res.ok) { console.log('body:', new TextDecoder().decode(buf).slice(0, 400)); process.exit(1); }

const tiff = await fromArrayBuffer(buf);
const img = await tiff.getImage();
const rasters = await img.readRasters();
const data = rasters[0];
console.log('dims', img.getWidth() + 'x' + img.getHeight(), '· bands', rasters.length,
  '· bitsPerSample', img.getBitsPerSample(), '· sampleFormat', img.getSampleFormat?.());
let min = Infinity, max = -Infinity, sum = 0, n = 0;
for (const v of data) { if (Number.isFinite(v) && v > -1000) { min = Math.min(min, v); max = Math.max(max, v); sum += v; n++; } }
console.log('ÉLÉVATION min/max/moy (m)', min.toFixed(2), '/', max.toFixed(2), '/', (sum / n).toFixed(2), '· pixels', n);
console.log('échantillon', Array.from(data.slice(0, 8)).map((v) => Number(v).toFixed(2)));
