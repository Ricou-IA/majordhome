// ============================================================================
// Applique un ou plusieurs fichiers .sql en prod via l'API Management Supabase
// (POST /v1/projects/{ref}/database/query), PAS via le MCP execute_sql (SELECT-only,
// ne peut pas exécuter les migrations/seeds) ni via un appel MCP unitaire (limite ~250 Ko/appel
// alors qu'un morceau de seed ou d'import peut dépasser cette taille). Canal réservé aux fichiers
// déjà écrits sur disque (migrations versionnées, seeds, morceaux d'import) — jamais du SQL ad hoc.
// Usage :
//   node scripts/fumisterie/apply-sql.mjs --env <fichier .env avec SUPABASE_ACCESS_TOKEN> --ref <project_ref> <fichier.sql> [autre.sql…]
//   node scripts/fumisterie/apply-sql.mjs --env <fichier .env> --ref <project_ref> --dir <dossier> --match <sous-chaîne>
//     (PowerShell n'expand pas les globs : --dir + --match applique tous les .sql du dossier
//     dont le nom contient <sous-chaîne>, triés par ordre alphabétique de nom)
// Exemple :
//   node scripts/fumisterie/apply-sql.mjs --env C:/Dev/Frontend-Majordhome/.env.local --ref ejqqqwudmizqisdkxohw scripts/fumisterie/out/seed_configurations.sql
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function lireEnv(fichier) {
  const txt = readFileSync(fichier, 'utf8');
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const envFichier = opt('--env');
const ref = opt('--ref');
const dir = opt('--dir');
const match = opt('--match');

if (!envFichier || !ref) {
  console.error('Usage : node scripts/fumisterie/apply-sql.mjs --env <fichier .env> --ref <project_ref> <fichier.sql> [more.sql…]');
  console.error('    ou : node scripts/fumisterie/apply-sql.mjs --env <fichier .env> --ref <project_ref> --dir <dossier> --match <sous-chaîne>');
  process.exit(2);
}

const env = lireEnv(envFichier);
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error(`SUPABASE_ACCESS_TOKEN absent de ${envFichier}`);
  process.exit(2);
}

let fichiers = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--env' && args[i - 1] !== '--ref' && args[i - 1] !== '--dir' && args[i - 1] !== '--match');

if (dir) {
  if (!match) {
    console.error('--dir requiert --match (sous-chaîne du nom de fichier)');
    process.exit(2);
  }
  fichiers = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f.includes(match))
    .sort()
    .map((f) => path.join(dir, f));
}

if (!fichiers.length) {
  console.error('Aucun fichier .sql à appliquer (ni en arguments, ni via --dir/--match)');
  process.exit(2);
}

for (const fichier of fichiers) {
  const contenu = readFileSync(fichier, 'utf8');
  const debut = Date.now();
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: contenu }),
  });
  const ms = Date.now() - debut;
  if (!r.ok) {
    const txt = await r.text();
    console.error(`${fichier} : HTTP ${r.status} — ${txt.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`${fichier} (${contenu.length} octets) — ${ms} ms`);
}
