// src/lib/communePopulation.js
// Population des communes (par code postal) via geo.api.gouv.fr, pour nommer les
// grands secteurs par la ville la plus importante. Cache localStorage org-scoped (TTL 30j).
// Dégradation gracieuse : si l'API échoue, retourne une map partielle/vide
// (le clustering retombe sur le nommage par nombre de contrats).
import { normalizeCity } from '@/lib/sectorClustering';

const API = 'https://geo.api.gouv.fr/communes';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 8;

const cacheKey = (orgId) => `commune-pop-v1:${orgId || 'default'}`;

function readCache(orgId) {
  try {
    const raw = localStorage.getItem(cacheKey(orgId));
    if (!raw) return { ts: 0, cps: {}, pops: {} };
    const c = JSON.parse(raw);
    if (!c.ts || Date.now() - c.ts > TTL_MS) return { ts: 0, cps: {}, pops: {} };
    return { ts: c.ts, cps: c.cps || {}, pops: c.pops || {} };
  } catch { return { ts: 0, cps: {}, pops: {} }; }
}

function writeCache(orgId, cache) {
  try {
    localStorage.setItem(cacheKey(orgId), JSON.stringify({ ts: Date.now(), cps: cache.cps, pops: cache.pops }));
  } catch { /* quota — non bloquant */ }
}

async function fetchCp(cp) {
  try {
    const res = await fetch(`${API}?codePostal=${cp}&fields=nom,population&format=json`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// Map<normalizeCity(nom), population> pour l'ensemble des CP fournis (cache + réseau).
export async function fetchCityPopulations(codePostaux, orgId) {
  const cps = [...new Set((codePostaux || [])
    .map((c) => String(c || '').trim())
    .filter((c) => /^\d{5}$/.test(c)))];

  const cache = readCache(orgId);
  const missing = cps.filter((cp) => !cache.cps[cp]);

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const lists = await Promise.all(chunk.map(fetchCp));
    chunk.forEach((cp, idx) => {
      cache.cps[cp] = true;
      for (const c of lists[idx]) {
        const key = normalizeCity(c.nom);
        const pop = Number(c.population) || 0;
        if (!cache.pops[key] || pop > cache.pops[key]) cache.pops[key] = pop;
      }
    });
  }
  if (missing.length) writeCache(orgId, cache);

  return new Map(Object.entries(cache.pops));
}
