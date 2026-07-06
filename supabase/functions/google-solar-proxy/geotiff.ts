// geotiff.ts — rasterisation heatmap de flux Google Solar (spec §5.2).
// Décode le GeoTIFF annualFlux (float32 mono-bande, kWh/kW/an) + le masque toit (mono-bande 0/1),
// colorise avec la rampe officielle Google, applique le masque (transparent hors toit) → PNG.
import { fromArrayBuffer } from "https://esm.sh/geotiff@2.1.3";
import { encode as encodePng } from "https://esm.sh/fast-png@6.2.0";

// Rampe annualFlux — `ironPalette` officielle de googlemaps-samples/js-solar-potential
// (src/routes/colors.ts, Apache-2.0). C'est la palette exacte utilisée par le layer
// annualFlux du sample Google Solar, avec min=0 / max=1800 (src/routes/layer.ts).
const FLUX_RAMP: [number, number, number][] = [
  [0x00, 0x00, 0x0A], [0x91, 0x00, 0x9C], [0xE6, 0x46, 0x16], [0xFE, 0xB4, 0x00],
  [0xFF, 0xFF, 0xF6],
];

// Flux annuel typique 0..~1800 kWh/kW/an ; borne haute alignée sur le sample Google (max=1800).
const DEFAULT_MAX_FLUX = 1800;

async function readBand(buf: ArrayBuffer): Promise<{ data: ArrayLike<number>; width: number; height: number }> {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return { data: rasters[0] as ArrayLike<number>, width: image.getWidth(), height: image.getHeight() };
}

function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (FLUX_RAMP.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = FLUX_RAMP[i];
  const b = FLUX_RAMP[Math.min(i + 1, FLUX_RAMP.length - 1)];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Colorise le flux + applique le masque toit → PNG (Uint8Array). Transparent hors toit. */
export async function colorizeFluxToPng(
  fluxBuf: ArrayBuffer,
  maskBuf: ArrayBuffer,
  maxFlux = DEFAULT_MAX_FLUX,
): Promise<Uint8Array> {
  const flux = await readBand(fluxBuf);
  const mask = await readBand(maskBuf);
  const { width, height, data } = flux;
  // flux et masque partagent le pixelSizeMeters de la réponse dataLayers → mêmes dimensions.
  const n = width * height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const m = mask.data[i] ?? 0;
    if (!m) { out[i * 4 + 3] = 0; continue; } // hors toit → transparent
    const [r, g, b] = ramp((data[i] as number) / maxFlux);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return encodePng({ width, height, data: out, channels: 4, depth: 8 });
}
