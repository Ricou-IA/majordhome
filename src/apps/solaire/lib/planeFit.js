// src/apps/solaire/lib/planeFit.js
// Ajustement d'un plan (moindres carrés) sur un nuage de points (x=Est, y=Nord, z=altitude,
// en mètres) puis conversion en pente/orientation PVGIS. Sert à dériver la géométrie d'un pan
// de toit depuis le MNS IGN LiDAR HD (élévation), à l'intérieur d'un polygone tracé.
// PUR : aucun import React/réseau — testé via node --test.
import { googleAzimuthToPvgisAspect } from './pvEngine.js';

const DEG = 180 / Math.PI;

/** Ajuste z = a·x + b·y + c (moindres carrés, centré pour la stabilité numérique). → { a, b, c } ou null. */
export function fitPlane(points) {
  const n = points.length;
  if (n < 3) return null;
  let mx = 0, my = 0, mz = 0;
  for (const p of points) { mx += p.x; my += p.y; mz += p.z; }
  mx /= n; my /= n; mz /= n;
  let Sxx = 0, Sxy = 0, Syy = 0, Sxz = 0, Syz = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my, dz = p.z - mz;
    Sxx += dx * dx; Sxy += dx * dy; Syy += dy * dy; Sxz += dx * dz; Syz += dy * dz;
  }
  const det = Sxx * Syy - Sxy * Sxy;
  if (Math.abs(det) < 1e-9) return null;
  const a = (Syy * Sxz - Sxy * Syz) / det;
  const b = (Sxx * Syz - Sxy * Sxz) / det;
  const c = mz - a * mx - b * my;
  return { a, b, c };
}

/** Normalise un angle en degrés sur [0, 360). */
function norm360(d) { return ((d % 360) + 360) % 360; }

/**
 * Gradient du plan (a,b ; x=Est, y=Nord) → pente + orientation.
 * Le gradient (a,b) pointe vers le HAUT ; la pente descend vers -(a,b) = l'orientation du pan.
 * Boussole 0=N,90=E,180=S,270=O ; PVGIS aspect S=0,E=-90,O=+90,N=±180.
 */
export function planeToOrientation({ a, b }) {
  const pitchDeg = Math.atan(Math.hypot(a, b)) * DEG;
  const azimuthCompass = norm360(Math.atan2(-a, -b) * DEG); // atan2(Est, Nord) de la descente
  const aspectPvgis = googleAzimuthToPvgisAspect(azimuthCompass); // = normalizeDeg(azimuth - 180)
  const pitchPercent = Math.tan(pitchDeg / DEG) * 100;
  return { pitchDeg, pitchPercent, azimuthCompass, aspectPvgis };
}

/**
 * Ajuste un pan de toit : plan + orientation + RMS résiduel, avec 1 passe de rejet d'outliers
 * (cheminées, végétation, bord). → { a, b, c, pitchDeg, pitchPercent, azimuthCompass, aspectPvgis,
 *   residualRms, nPoints } ou null.
 */
export function fitRoofPlane(points) {
  let pts = points.filter((p) => Number.isFinite(p.z));
  let plane = fitPlane(pts);
  if (!plane) return null;
  const resid = (p, pl) => p.z - (pl.a * p.x + pl.b * p.y + pl.c);
  const rmsOf = (arr, pl) => Math.sqrt(arr.reduce((s, p) => s + resid(p, pl) ** 2, 0) / arr.length);
  let rms = rmsOf(pts, plane);
  // Rejet des points dont le résidu dépasse 2·RMS (une passe), si ça vaut le coup.
  if (rms > 0.05) {
    const kept = pts.filter((p) => Math.abs(resid(p, plane)) <= 2 * rms);
    if (kept.length >= 3 && kept.length < pts.length) {
      pts = kept;
      plane = fitPlane(pts) || plane;
      rms = rmsOf(pts, plane);
    }
  }
  return { ...plane, ...planeToOrientation(plane), residualRms: rms, nPoints: pts.length };
}
