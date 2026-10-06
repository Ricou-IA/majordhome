// scripts/permissions-coherence.mjs
// ============================================================================
// Cohérence registre ↔ base (droits app-level, phase 5) — spec 2026-06-02 § 8.3.
//
// Pour chaque table GOUVERNÉE (liste ci-dessous) et chaque action SQL de sa resource au
// registre (INSERT / UPDATE / DELETE), une policy `role_can(…, '<resource>', '<action>')`
// doit exister ; les policies d'écriture « tout membre » ne doivent plus exister ; et les
// défauts DB (`majordhome.app_role_permissions`) doivent être exactement ceux du registre.
// Les tables du registre pas encore basculées sont LISTÉES (avertissement), pas un échec :
// on bascule table par table, ce script dit où on en est.
//
//   node scripts/permissions-coherence.mjs --env C:/Dev/Frontend-Majordhome/.env.local   # prod, lecture seule (exec_sql)
//   node scripts/permissions-coherence.mjs --port 55432                                   # cluster de répétition (psql)
//
// ⚠️ La référence est la PROD (--env) : le cluster de répétition ne reproduit que les
// policies des tables listées dans POLICY_TABLES de snapshot.mjs — les autres y ressortent
// « AUCUNE policy » sans que ce soit vrai.
//
// Sortie 1 (échec) : défaut DB ≠ registre, table gouvernée sans policy role_can complète,
// policy d'écriture legacy restante. Rien n'est écrit, nulle part.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REGISTRY, iterAppDefaults } from '../src/lib/permissionsRegistry.js';

// Tables dont les écritures passent par role_can. Étendre à chaque bascule.
const GOVERNED = ['clients', 'equipments', 'interventions', 'contracts', 'leads', 'quotes', 'tasks'];
// Resource réellement citée par les policies quand elle diffère du registre.
// interventions : le registre (spec § 9) la range sous `entretiens` (double propriétaire
// entretiens|chantiers), la phase 3 de juin l'a branchée sur `clients` (edit = tous, delete =
// admin — même verdict que l'union prévue). Écart connu, à résorber en basculant les policies,
// pas en éditant le registre.
const POLICY_RESOURCE = { interventions: 'clients' };
// Actions UPDATE acceptées : edit OU edit_own (le « c'est le mien » est tenu par l'écran).
const SQL_ACTIONS = { INSERT: ['create', 'edit'], UPDATE: ['edit', 'edit_own'], DELETE: ['delete'] };

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

function lireEnv(fichier) {
  const txt = fs.readFileSync(fichier, 'utf8');
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

async function requeteur() {
  const envFile = opt('--env');
  const port = opt('--port');
  if (envFile) {
    const env = lireEnv(path.resolve(envFile));
    if (!env.DST_URL || !env.DST_KEY) throw new Error('DST_URL / DST_KEY absents du fichier env');
    return async (query) => {
      const r = await fetch(`${env.DST_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: { apikey: env.DST_KEY, Authorization: `Bearer ${env.DST_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query_text: query.trim() }),
      });
      const txt = await r.text();
      if (!r.ok) throw new Error(`exec_sql ${r.status}: ${txt.slice(0, 300)}`);
      const parsed = JSON.parse(txt);
      if (parsed && !Array.isArray(parsed) && parsed.error) throw new Error(`exec_sql: ${parsed.error}`);
      return parsed;
    };
  }
  if (port) {
    return async (query) => {
      const r = spawnSync('psql', ['-X', '-A', '-t', '-h', 'localhost', '-p', port, '-U', 'postgres', '-d', 'rehearsal',
        '-c', `SELECT coalesce(json_agg(t), '[]'::json) FROM (${query.trim().replace(/;\s*$/, '')}) t`], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      return JSON.parse(r.stdout.trim() || '[]');
    };
  }
  throw new Error('Usage : --env <fichier .env DST_URL/DST_KEY> | --port <port du cluster de répétition>');
}

const erreurs = [];
const avertissements = [];

async function main() {
  const sql = await requeteur();

  // 1. Défauts DB == registre (exactement : ni ligne en plus, ni en moins, ni valeur différente)
  const dbRows = await sql('SELECT role, resource, action, allowed FROM majordhome.app_role_permissions');
  const cle = (r) => `${r.role}:${r.resource}:${r.action}`;
  const db = new Map(dbRows.map((r) => [cle(r), r.allowed === true]));
  const reg = new Map([...iterAppDefaults()].map((r) => [cle(r), r.allowed]));
  for (const [k, v] of reg) {
    if (!db.has(k)) erreurs.push(`défaut absent en base : ${k} (attendu ${v})`);
    else if (db.get(k) !== v) erreurs.push(`défaut divergent : ${k} base=${db.get(k)} registre=${v}`);
  }
  for (const k of db.keys()) if (!reg.has(k)) erreurs.push(`défaut en base hors registre : ${k}`);

  // 2. Policies d'écriture des tables du registre
  const pols = await sql(`SELECT tablename, policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
    FROM pg_policies WHERE schemaname = 'majordhome' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')`);
  const parTable = new Map();
  for (const p of pols) { if (!parTable.has(p.tablename)) parTable.set(p.tablename, []); parTable.get(p.tablename).push(p); }

  const tablesRegistre = [];
  for (const [resource, def] of Object.entries(REGISTRY)) {
    for (const [table, scope] of Object.entries(def.tables || {})) {
      if (scope.startsWith('parent:') || scope === 'reference') continue;
      tablesRegistre.push({ table, resource });
    }
  }
  for (const { table, resource: resourceRegistre } of tablesRegistre) {
    const resource = POLICY_RESOURCE[table] || resourceRegistre;
    const policies = parTable.get(table) || [];
    const gouvernee = GOVERNED.includes(table);
    const actionsSql = Object.entries(REGISTRY[resource].actions).filter(([, s]) => s.sql).map(([a, s]) => ({ action: a, sql: s.sql }));
    for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
      const attendues = actionsSql.filter((a) => a.sql === cmd).map((a) => a.action);
      if (attendues.length === 0) continue;
      const surCmd = policies.filter((p) => p.cmd === cmd);
      const roleCan = surCmd.filter((p) => /role_can\(/.test(p.expr) && new RegExp(`'${resource}'`).test(p.expr)
        && SQL_ACTIONS[cmd].some((a) => new RegExp(`'${a}'`).test(p.expr)));
      const legacy = surCmd.filter((p) => !/role_can\(/.test(p.expr));
      if (gouvernee) {
        if (roleCan.length === 0) erreurs.push(`${table}.${cmd} : aucune policy role_can(…, '${resource}', …)`);
        if (legacy.length) erreurs.push(`${table}.${cmd} : policy legacy restante (${legacy.map((p) => p.policyname).join(', ')})`);
      } else if (roleCan.length === 0) {
        avertissements.push(`${table}.${cmd} (${resource}) : pas encore sur role_can — ${surCmd.length ? surCmd.map((p) => p.policyname).join(', ') : 'AUCUNE policy'}`);
      }
    }
  }
  for (const t of GOVERNED) if (!tablesRegistre.some((x) => x.table === t)) erreurs.push(`table gouvernée ${t} absente du registre`);

  // 3. Arbitre : jamais exécutable par anon
  const priv = await sql(`SELECT has_function_privilege('anon', 'majordhome.role_can(uuid, text, text)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'majordhome.role_can(uuid, text, text)', 'EXECUTE') AS auth`);
  if (priv[0]?.anon) erreurs.push('anon a EXECUTE sur majordhome.role_can');
  if (!priv[0]?.auth) erreurs.push('authenticated sans EXECUTE sur majordhome.role_can');

  // 4. Profils maison (20261006_1..2) : intégrité + role_can les consulte + ACL
  const present = await sql(`SELECT to_regclass('majordhome.org_roles') IS NOT NULL AS ok`);
  if (!present[0]?.ok) {
    erreurs.push('majordhome.org_roles absente : migration 20261006_1_org_roles non appliquée');
  }
  const orgRoles = present[0]?.ok ? await sql(`SELECT org_id, code, base_role FROM majordhome.org_roles`) : [];
  for (const r of orgRoles) {
    if (!['team_leader', 'commercial', 'technicien'].includes(r.base_role)) erreurs.push(`profil maison ${r.code} (${r.org_id}) : modèle invalide ${r.base_role}`);
    if (['org_admin', 'team_leader', 'commercial', 'technicien'].includes(r.code)) erreurs.push(`profil maison au code standard : ${r.code} (${r.org_id})`);
  }
  const codesParOrg = new Map();
  for (const r of orgRoles) { if (!codesParOrg.has(r.org_id)) codesParOrg.set(r.org_id, new Set()); codesParOrg.get(r.org_id).add(r.code); }
  const overrides = !present[0]?.ok ? [] : await sql(`SELECT org_id, role FROM majordhome.role_permissions
    WHERE role NOT IN ('org_admin', 'team_leader', 'commercial', 'technicien')`);
  for (const o of overrides) {
    if (!codesParOrg.get(o.org_id)?.has(o.role)) erreurs.push(`surcharge orpheline : role=${o.role} org=${o.org_id} (aucun profil maison de cette org)`);
  }
  const roleCanSrc = !present[0]?.ok ? [] : await sql(`SELECT prosrc FROM pg_proc WHERE oid = 'majordhome.role_can(uuid, text, text)'::regprocedure`);
  if (!/user_org_role_code/.test(roleCanSrc[0]?.prosrc || '')) erreurs.push('majordhome.role_can ne consulte pas user_org_role_code (profils maison ignorés en base)');
  const fnsMaison = ['majordhome.user_org_role_code(uuid)', 'public.org_role_create(uuid, text, text)', 'public.org_role_update(uuid, text, boolean)',
    'public.org_role_delete(uuid)', 'public.member_set_org_role(uuid, uuid, uuid)'];
  for (const f of fnsMaison) {
    const p = await sql(`SELECT has_function_privilege('anon', '${f}', 'EXECUTE') AS anon`);
    if (p[0]?.anon) erreurs.push(`anon a EXECUTE sur ${f}`);
  }
  console.log(`${orgRoles.length} profil(s) maison, ${overrides.length} surcharge(s) sur profil maison`);

  for (const a of avertissements) console.log('⚠️ ', a);
  for (const e of erreurs) console.error('❌', e);
  console.log(`\n${reg.size} défauts app, ${GOVERNED.length} tables gouvernées, ${avertissements.length} à basculer, ${erreurs.length} erreur(s)`);
  process.exit(erreurs.length ? 1 : 0);
}

main().catch((e) => { console.error(e.message || e); process.exit(2); });
