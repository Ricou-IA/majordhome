// scripts/migration-rehearsal/run.mjs
// ============================================================================
// Répète une ou plusieurs migrations sur un cluster PostgreSQL LOCAL jetable
// alimenté par le snapshot (scripts/migration-rehearsal/snapshot.mjs).
//
//   node scripts/migration-rehearsal/run.mjs \
//     --migration supabase/migrations/20260913_1_referentiel_equipements_expansion.sql \
//     [--migration supabase/migrations/20260920_1_...contraction.sql] \
//     [--assert scripts/migration-rehearsal/assert-m1.sql]... [--keep] [--port 55432]
//
// Étapes : initdb (si besoin) → démarrage → base `rehearsal` recréée →
// bootstrap-pre.sql → schema-generated.sql → bootstrap-post.sql → données →
// migrations (chacune en --single-transaction, ON_ERROR_STOP) → assertions →
// arrêt (sauf --keep : le cluster reste up pour inspection, `psql -p <port> -U postgres rehearsal`).
// Binaires : ceux de psql sur le PATH (scoop postgresql).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(HERE, '..', '..');
const SCRATCH = path.join(HERE, 'scratch');
const PGDATA = path.join(SCRATCH, 'pgdata');
const LOG = path.join(SCRATCH, 'postgres.log');

const args = process.argv.slice(2);
const opt = (name) => { const out = []; for (let i = 0; i < args.length; i += 1) if (args[i] === name && args[i + 1]) out.push(args[++i]); return out; };
const migrations = opt('--migration');
const asserts = opt('--assert');
const keep = args.includes('--keep');
const port = Number(opt('--port')[0] || 55432);
const DB = 'rehearsal';

function binDir() {
  const w = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['psql'], { encoding: 'utf8' });
  const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  if (!first) throw new Error('psql introuvable sur le PATH');
  return path.dirname(first);
}
const BIN = binDir();
const exe = (name) => path.join(BIN, process.platform === 'win32' ? `${name}.exe` : name);

function run(cmd, cmdArgs, { input, env, allowFail = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', input, env: { ...process.env, PGCLIENTENCODING: 'UTF8', ...(env || {}) } });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${path.basename(cmd)} ${cmdArgs.join(' ')}\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}
const psqlArgs = (db, extra = []) => ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-h', 'localhost', '-p', String(port), '-U', 'postgres', '-d', db, ...extra];
const psqlFile = (db, file, single = false) => run(exe('psql'), psqlArgs(db, [...(single ? ['--single-transaction'] : []), '-f', file]));

function demarrer() {
  if (!fs.existsSync(path.join(PGDATA, 'PG_VERSION'))) {
    fs.mkdirSync(SCRATCH, { recursive: true });
    run(exe('initdb'), ['-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale', '-D', PGDATA]);
  }
  const status = run(exe('pg_ctl'), ['status', '-D', PGDATA], { allowFail: true });
  if (status.status !== 0) {
    // stdio ignoré : le serveur lancé par pg_ctl hérite sinon des tubes de
    // spawnSync, qui attend leur fermeture — et donc l'arrêt du serveur.
    const r = spawnSync(exe('pg_ctl'), ['start', '-w', '-D', PGDATA, '-l', LOG, '-o', `-p ${port} -c listen_addresses=localhost`],
      { stdio: 'ignore', env: { ...process.env } });
    if (r.status !== 0) throw new Error(`pg_ctl start a échoué (voir ${LOG})`);
  }
}
function arreter() { run(exe('pg_ctl'), ['stop', '-D', PGDATA, '-m', 'fast'], { allowFail: true }); }

function chargerDonnees() {
  const data = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'data.json'), 'utf8'));
  // Colonnes GENERATED : jamais insérées (erreur sinon).
  const gen = run(exe('psql'), psqlArgs(DB, ['-A', '-t', '-c',
    "select n.nspname||'.'||c.relname||'.'||a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attgenerated <> '' and n.nspname in ('core','majordhome')"]));
  const generated = new Set((gen.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  for (const [table, rows] of Object.entries(data)) {
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]).filter((c) => !generated.has(`${table}.${c}`));
    const [schema, name] = table.split('.');
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const sql = `INSERT INTO "${schema}"."${name}" (${colList}) SELECT ${colList} FROM json_populate_recordset(null::"${schema}"."${name}", $$${JSON.stringify(rows).replace(/\$\$/g, '')}$$::json);`;
    const tmp = path.join(SCRATCH, `_load_${schema}_${name}.sql`);
    fs.writeFileSync(tmp, `SET session_replication_role = replica;\n${sql}\n`); // triggers coupés pendant le chargement (données déjà cohérentes)
    psqlFile(DB, tmp);
    fs.unlinkSync(tmp);
    console.log(`  ${table}: ${rows.length}`);
  }
}

function main() {
  console.log(`[rehearsal] cluster ${PGDATA} port ${port}`);
  demarrer();
  try {
    run(exe('psql'), psqlArgs('postgres', ['-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]));
    run(exe('psql'), psqlArgs('postgres', ['-c', `CREATE DATABASE ${DB} TEMPLATE template0 ENCODING 'UTF8'`]));
    console.log('[rehearsal] bootstrap + schéma');
    psqlFile(DB, path.join(HERE, 'bootstrap-pre.sql'));
    psqlFile(DB, path.join(SCRATCH, 'schema-generated.sql'));
    psqlFile(DB, path.join(HERE, 'bootstrap-post.sql'));
    console.log('[rehearsal] données');
    chargerDonnees();
    for (const m of migrations) {
      const f = path.isAbsolute(m) ? m : path.join(RACINE, m);
      console.log(`[rehearsal] migration ${path.basename(f)}`);
      const r = run(exe('psql'), psqlArgs(DB, ['--single-transaction', '-f', f]));
      if (r.stderr) console.log(r.stderr.trim());
    }
    for (const a of asserts) {
      const f = path.isAbsolute(a) ? a : path.join(RACINE, a);
      console.log(`[rehearsal] assertions ${path.basename(f)}`);
      const r = run(exe('psql'), psqlArgs(DB, ['-f', f]));
      if (r.stderr) console.log(r.stderr.trim());
      if (r.stdout.trim()) console.log(r.stdout.trim());
    }
    console.log('[rehearsal] OK');
  } catch (e) {
    console.error('[rehearsal] ECHEC\n' + e.message);
    process.exitCode = 1;
  } finally {
    if (!keep) arreter(); else console.log(`[rehearsal] cluster conservé : psql -h localhost -p ${port} -U postgres ${DB}`);
  }
}
main();
