// ============================================================================
// Mesure du rapprochement clients Majord'home ↔ corpus MonsieurDPE (lecture seule).
// Plan : docs/superpowers/plans/2026-11-11-lien-monsieurdpe-fiche-client.md, tâche 1.
//
// Tire N clients au hasard (adresse, code postal et ville renseignés) dans l'organisation
// donnée, interroge GET /dossier-batiment du corpus pour chacun, et n'imprime QUE des
// agrégats. Aucune adresse n'est écrite ni affichée : l'échantillon reste en mémoire.
//
// Usage :
//   node scripts/dpe/mesure-rapprochement.mjs --env-mdh .env.local --env-dpe C:/Dev/DPE/site/.env.local \
//     --ref ejqqqwudmizqisdkxohw --core-org 3c68193e-783b-4aa9-bc0d-fb2ce21e99b1 [--n 50]
// ============================================================================
import { readFileSync } from 'node:fs';

function lireEnv(fichier) {
  const txt = readFileSync(fichier, 'utf8').replace(/^\uFEFF/, '');
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
}

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const envMdh = opt('--env-mdh');
const envDpe = opt('--env-dpe');
const ref = opt('--ref');
const coreOrg = opt('--core-org');
const n = Number(opt('--n') || 50);

if (!envMdh || !envDpe || !ref || !/^[0-9a-f-]{36}$/i.test(coreOrg || '') || !Number.isInteger(n) || n < 1 || n > 200) {
  console.error('Usage : node scripts/dpe/mesure-rapprochement.mjs --env-mdh <.env> --env-dpe <.env> --ref <project_ref> --core-org <uuid> [--n 50]');
  process.exit(2);
}

const token = lireEnv(envMdh).SUPABASE_ACCESS_TOKEN;
const dpe = lireEnv(envDpe);
const corpusUrl = dpe.DPE_CORPUS_URL;
const corpusSecret = dpe.DPE_CORPUS_SECRET;
if (!token || !corpusUrl || !corpusSecret) {
  console.error('SUPABASE_ACCESS_TOKEN, DPE_CORPUS_URL ou DPE_CORPUS_SECRET absent des fichiers d\'environnement');
  process.exit(2);
}

// 1. L'échantillon, en mémoire seulement.
const sql = `
  SELECT c.address, c.postal_code, c.city
  FROM majordhome.clients c
  WHERE c.org_id = '${coreOrg}'
    AND coalesce(trim(c.address), '') <> '' AND coalesce(trim(c.postal_code), '') <> '' AND coalesce(trim(c.city), '') <> ''
  ORDER BY random() LIMIT ${n}`;
const rSql = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql, read_only: true }),
});
if (!rSql.ok) {
  console.error(`Lecture de l'échantillon refusée : HTTP ${rSql.status} ${(await rSql.text()).slice(0, 200)}`);
  process.exit(1);
}
const clients = await rSql.json();
console.log(`Échantillon : ${clients.length} clients`);

// 2. Le corpus, un client à la fois.
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const stats = { reponses: 0, http: {}, erreurs: 0, geocode: 0, batiment: 0, avecDpe: 0, repartition: { 0: 0, 1: 0, '2-5': 0, '6+': 0 }, indistinguables: 0, durees: [] };
const champsDpe = new Set();
const champsAdresse = new Set();
let exempleDpe = null;

for (const c of clients) {
  const adresse = `${c.address} ${c.postal_code} ${c.city}`.replace(/\s+/g, ' ').trim();
  const debut = Date.now();
  try {
    const r = await fetch(`${corpusUrl}/dossier-batiment?adresse=${encodeURIComponent(adresse)}`, {
      headers: { 'x-corpus-secret': corpusSecret },
      signal: AbortSignal.timeout(20_000),
    });
    stats.durees.push(Date.now() - debut);
    stats.http[r.status] = (stats.http[r.status] || 0) + 1;
    const corps = await r.json().catch(() => null);
    if (!r.ok || !corps || corps.error) { stats.erreurs += 1; continue; }
    stats.reponses += 1;
    const d = corps.data || {};
    if (d.adresse) { stats.geocode += 1; Object.keys(d.adresse).forEach((k) => champsAdresse.add(k)); }
    if (d.batiment) stats.batiment += 1;
    const liste = Array.isArray(d.dpe) ? d.dpe : [];
    if (liste.length > 0) stats.avecDpe += 1;
    stats.repartition[liste.length === 0 ? 0 : liste.length === 1 ? 1 : liste.length <= 5 ? '2-5' : '6+'] += 1;
    for (const ligne of liste) Object.keys(ligne).forEach((k) => champsDpe.add(k));
    if (liste.length > 1) {
      // Deux DPE que rien ne distingue hors numéro et date : même surface, même type.
      const cles = liste.map((l) => Object.entries(l)
        .filter(([k]) => !/identifiant|numero|date/i.test(k)).map(([, v]) => String(v)).join('|'));
      if (new Set(cles).size < cles.length) stats.indistinguables += 1;
    }
    if (!exempleDpe && liste[0]) {
      exempleDpe = Object.fromEntries(Object.entries(liste[0]).map(([k, v]) => [k, /identifiant|numero/i.test(k) ? '(masqué)' : v]));
    }
  } catch {
    stats.erreurs += 1;
  }
  await pause(300);
}

const tri = [...stats.durees].sort((a, b) => a - b);
const centile = (p) => (tri.length ? tri[Math.min(tri.length - 1, Math.floor(p * tri.length))] : null);
const pct = (x) => (clients.length ? `${Math.round((100 * x) / clients.length)} %` : '-');

console.log(JSON.stringify({
  interroges: clients.length,
  reponses_exploitables: stats.reponses,
  codes_http: stats.http,
  erreurs: stats.erreurs,
  adresse_geocodee: `${stats.geocode} (${pct(stats.geocode)})`,
  batiment_trouve: `${stats.batiment} (${pct(stats.batiment)})`,
  au_moins_un_dpe: `${stats.avecDpe} (${pct(stats.avecDpe)})`,
  repartition_nombre_de_dpe: stats.repartition,
  batiments_a_dpe_indistinguables: stats.indistinguables,
  duree_ms: { mediane: centile(0.5), p95: centile(0.95) },
  champs_adresse: [...champsAdresse].sort(),
  champs_par_dpe: [...champsDpe].sort(),
  exemple_dpe: exempleDpe,
}, null, 2));
