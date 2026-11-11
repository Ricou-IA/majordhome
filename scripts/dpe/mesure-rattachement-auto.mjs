// ============================================================================
// Mesure des seuils du rattachement AUTOMATIQUE d'un DPE à une fiche client (lecture seule, agrégats seulement).
// Plan : docs/superpowers/plans/2026-11-12-logement-monsieurdpe-fiche-client.md, tâche 1.
//
// Pour N clients tirés au hasard : géocodage IGN (score, type, clé BAN) → corpus par clé BAN → si un seul DPE,
// son dossier (méthode d'application) et son adresse brute ADEME, comparée à la fiche par memeAdresseQueLaFiche.
// La concordance d'adresse sert de VÉRITÉ approchée pour juger chaque seuil candidat. Aucune adresse n'est
// écrite ni affichée.
//
// Usage :
//   node scripts/dpe/mesure-rattachement-auto.mjs --env-mdh .env.local --env-dpe C:/Dev/DPE/site/.env.local \
//     --ref ejqqqwudmizqisdkxohw --core-org 3c68193e-783b-4aa9-bc0d-fb2ce21e99b1 [--n 200]
// ============================================================================
import { readFileSync } from 'node:fs';
import { memeAdresseQueLaFiche } from '../../src/lib/dpeApi.js';

function lireEnv(fichier) {
  const txt = readFileSync(fichier, 'utf8').replace(/^\uFEFF/, '');
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
}
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const coreOrg = opt('--core-org');
const n = Number(opt('--n') || 200);
if (!opt('--env-mdh') || !opt('--env-dpe') || !opt('--ref') || !/^[0-9a-f-]{36}$/i.test(coreOrg || '')) {
  console.error('Usage : --env-mdh <.env> --env-dpe <.env> --ref <ref> --core-org <uuid> [--n 200]');
  process.exit(2);
}
const token = lireEnv(opt('--env-mdh')).SUPABASE_ACCESS_TOKEN;
const dpe = lireEnv(opt('--env-dpe'));

const rSql = await fetch(`https://api.supabase.com/v1/projects/${opt('--ref')}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ read_only: true, query: `
    SELECT address, postal_code, city FROM majordhome.clients
    WHERE org_id = '${coreOrg}' AND coalesce(is_archived, false) = false
      AND coalesce(trim(address), '') <> '' AND coalesce(trim(postal_code), '') <> '' AND coalesce(trim(city), '') <> ''
    ORDER BY random() LIMIT ${n}` }),
});
if (!rSql.ok) { console.error('échantillon refusé', rSql.status); process.exit(1); }
const clients = await rSql.json();

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const json = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const corpus = (chemin) => json(`${dpe.DPE_CORPUS_URL}${chemin}`, { headers: { 'x-corpus-secret': dpe.DPE_CORPUS_SECRET } });

const lignes = [];
for (const c of clients) {
  const ligne = { candidats: null, score: null, type: null, fiabilite: null, derive: null, concordance: null, erreur: null };
  try {
    const g = await json(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(`${c.address} ${c.postal_code} ${c.city}`)}&limit=1`);
    // Une panne du géocodeur (504 vécu le 2026-11-12) n'est PAS une adresse non trouvée : on la compte en erreur.
    if (g.statut !== 200) { ligne.erreur = `geocodage ${g.statut}`; lignes.push(ligne); continue; }
    const p = g.corps?.features?.[0]?.properties;
    if (!p?.id) { ligne.candidats = 'non_geocode'; lignes.push(ligne); continue; }
    ligne.score = p.score; ligne.type = p.type;
    const b = await corpus(`/dossier-batiment?cle_ban=${encodeURIComponent(p.id)}`);
    if (b.statut !== 200) { ligne.erreur = `batiment ${b.statut}`; lignes.push(ligne); continue; }
    const liste = Array.isArray(b.corps?.data?.dpe) ? b.corps.data.dpe : [];
    ligne.candidats = liste.length;
    if (liste.length === 1) {
      ligne.fiabilite = liste[0].fiabilite_geocodage ?? null;
      const num = liste[0].identifiant_dpe;
      const d = await corpus(`/dossier/${num}`);
      ligne.derive = String(d.corps?.data?.dossier?.methode_application_dpe || '').toLowerCase().startsWith('dpe appartement généré');
      const a = await json(`https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines?qs=${encodeURIComponent(`numero_dpe:"${num}"`)}&select=adresse_brut,code_postal_brut,nom_commune_brut&size=1`);
      const r0 = a.corps?.results?.[0];
      if (r0) {
        const brut = [r0.adresse_brut, r0.code_postal_brut, r0.nom_commune_brut].filter(Boolean).join(' ');
        ligne.concordance = memeAdresseQueLaFiche(brut, c);
      }
    }
  } catch (e) {
    ligne.erreur = e?.name || 'erreur';
  }
  lignes.push(ligne);
  await pause(250);
}

const compte = (f) => lignes.filter(f).length;
const uniques = lignes.filter((l) => l.candidats === 1);
const tranche = (s) => (s == null ? 'aucun' : s >= 0.9 ? '>=0.90' : s >= 0.8 ? '0.80-0.90' : s >= 0.7 ? '0.70-0.80' : s >= 0.6 ? '0.60-0.70' : '<0.60');
const croise = {};
for (const l of uniques) {
  const k = `${tranche(l.score)} | ${l.type} | ${l.fiabilite} | derive=${l.derive}`;
  croise[k] ||= { n: 0, concordant: 0, discordant: 0, inconnu: 0 };
  croise[k].n += 1;
  if (l.concordance === true) croise[k].concordant += 1; else if (l.concordance === false) croise[k].discordant += 1; else croise[k].inconnu += 1;
}

// Seuils candidats : part retenue et discordances parmi les retenus.
const candidatsSeuils = [];
for (const min of [0.6, 0.7, 0.8, 0.9]) {
  for (const fiab of [['très fiable'], ['très fiable', 'fiable'], null]) {
    const retenus = uniques.filter((l) => !l.derive && l.type === 'housenumber' && l.score >= min && (fiab === null || fiab.includes(l.fiabilite)));
    candidatsSeuils.push({
      score_min: min, fiabilites: fiab ? fiab.join('+') : 'toutes',
      retenus: retenus.length, sur_uniques: uniques.length,
      discordants: retenus.filter((l) => l.concordance === false).length,
      sans_verite: retenus.filter((l) => l.concordance === null).length,
    });
  }
}

console.log(JSON.stringify({
  interroges: lignes.length,
  erreurs: compte((l) => l.erreur),
  detail_erreurs: Object.fromEntries([...new Set(lignes.map((l) => l.erreur).filter(Boolean))].map((e) => [e, compte((l) => l.erreur === e)])),
  non_geocodes: compte((l) => l.candidats === 'non_geocode'),
  candidats: { zero: compte((l) => l.candidats === 0), un: uniques.length, plusieurs: compte((l) => typeof l.candidats === 'number' && l.candidats > 1) },
  types_geocodage: Object.fromEntries([...new Set(lignes.map((l) => l.type))].map((t) => [t, compte((l) => l.type === t)])),
  fiabilites_uniques: Object.fromEntries([...new Set(uniques.map((l) => l.fiabilite))].map((f) => [f, uniques.filter((l) => l.fiabilite === f).length])),
  croisement_uniques: croise,
  seuils: candidatsSeuils,
}, null, 2));
