// scripts/migration-rehearsal/snapshot.mjs
// ============================================================================
// Photographie (LECTURE SEULE) du sous-ensemble de la base de prod nécessaire
// pour répéter une migration sur un cluster PostgreSQL local jetable.
//
//   node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local
//
// Lit DST_URL / DST_KEY (clé service_role) dans le fichier --env, interroge
// `public.exec_sql` (SELECT uniquement — la fonction refuse tout le reste) et
// écrit dans scripts/migration-rehearsal/scratch/ :
//   - schema-generated.sql : types enum, tables (colonnes réelles, defaults,
//     NOT NULL, PK/UNIQUE/CHECK/FK internes au sous-ensemble), fonctions,
//     triggers, vues, policies — tels qu'en prod ;
//   - data.json : les lignes des tables du sous-ensemble.
// Aucune écriture en prod : la seule RPC appelée est exec_sql avec des SELECT.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = path.join(HERE, 'scratch');

// Sous-ensemble : ordre = ordre de création (FK) et d'insertion.
// columns: null = toutes ; sinon liste explicite (le DDL est restreint à ces colonnes).
const TABLES = [
  { schema: 'core', table: 'organizations', columns: ['id', 'name', 'settings', 'created_at', 'updated_at'] },
  { schema: 'core', table: 'profiles', columns: ['id', 'app_role', 'email', 'full_name'] },
  { schema: 'core', table: 'organization_members', columns: null },
  { schema: 'core', table: 'projects', columns: ['id', 'org_id', 'name', 'status', 'identity'] },
  { schema: 'majordhome', table: 'organizations', columns: null },
  { schema: 'majordhome', table: 'pricing_zones', columns: null },
  { schema: 'majordhome', table: 'pricing_equipment_types', columns: null },
  { schema: 'majordhome', table: 'pricing_rates', columns: null },
  { schema: 'majordhome', table: 'team_members', columns: null },
  { schema: 'majordhome', table: 'clients', columns: ['id', 'org_id', 'project_id', 'email', 'first_name', 'last_name', 'display_name', 'phone', 'address', 'postal_code', 'city', 'lead_source', 'is_web_draft', 'created_at', 'updated_at'] },
  { schema: 'majordhome', table: 'equipments', columns: null },
  { schema: 'majordhome', table: 'contracts', columns: ['id', 'org_id', 'client_id', 'status', 'start_date', 'zone_id', 'amount', 'subtotal', 'discount_percent', 'source', 'notes', 'contract_number', 'created_at', 'updated_at'], data: false },
  { schema: 'majordhome', table: 'contract_equipments', columns: null, data: false },
  { schema: 'majordhome', table: 'contract_pricing_items', columns: ['id', 'contract_id', 'equipment_type_id', 'zone_id', 'equipment_id', 'quantity', 'base_price', 'unit_price', 'line_total', 'created_at'], data: false },
  { schema: 'majordhome', table: 'interventions', columns: ['id', 'project_id', 'client_id', 'contract_id', 'equipment_id', 'intervention_type', 'status', 'workflow_status', 'includes_entretien', 'tags', 'metadata', 'scheduled_date', 'scheduled_time_start', 'scheduled_time_end', 'technician_id', 'technician_name', 'created_at'], data: false },
  { schema: 'majordhome', table: 'certificats', columns: ['id', 'org_id', 'equipment_id', 'equipement_type', 'type_document', 'tva_taux', 'created_at'] },
];

const FUNCTIONS = [
  'majordhome.handle_updated_at()',
  'majordhome.calculate_next_maintenance()',
  'majordhome.update_client_on_equipment_change()',
  'majordhome.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)',
  'public.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)',
  'public.team_member_set_routing_settings(uuid, integer, boolean, text[])',
];

// Triggers utilisateur à reproduire (ceux qui interagissent avec la migration).
const TRIGGER_TABLES = ['majordhome.equipments'];

const VIEWS = [
  'majordhome.v_planning',
  'majordhome.v_equipments_maintenance',
  'public.majordhome_equipments',
  'public.majordhome_pricing_equipment_types',
  'public.majordhome_team_members',
  'public.majordhome_client_equipment_kinds',
  'public.majordhome_pricing_zones',
  'public.majordhome_organizations',
];

// Policies reproduites : celles qui ne dépendent d'aucune fonction absente du
// sous-ensemble (equipments.* référencent role_can/project_org_id → exclues).
const POLICY_TABLES = ['pricing_zones', 'pricing_equipment_types', 'team_members'];

function lireEnv(fichier) {
  const txt = fs.readFileSync(fichier, 'utf8');
  return Object.fromEntries(txt.split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

const args = process.argv.slice(2);
const envIdx = args.indexOf('--env');
if (envIdx === -1 || !args[envIdx + 1]) {
  console.error('Usage : node scripts/migration-rehearsal/snapshot.mjs --env <fichier .env avec DST_URL/DST_KEY>');
  process.exit(2);
}
const env = lireEnv(args[envIdx + 1]);
const URL_ = env.DST_URL;
const KEY = env.DST_KEY;
if (!URL_ || !KEY) { console.error('DST_URL / DST_KEY absents du fichier env'); process.exit(2); }

async function sql(query) {
  const r = await fetch(`${URL_}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query_text: query.trim() }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`exec_sql ${r.status}: ${txt.slice(0, 400)}`);
  const parsed = JSON.parse(txt);
  if (parsed && !Array.isArray(parsed) && parsed.error) throw new Error(`exec_sql: ${parsed.error} (${parsed.detail || ''}) — ${query.slice(0, 120)}`);
  return parsed;
}
const one = async (query) => (await sql(query))[0]?.x ?? null;

const qid = (s) => `"${s.replace(/"/g, '""')}"`;
const rel = (t) => `${qid(t.schema)}.${qid(t.table)}`;

async function colonnes(t) {
  const rows = await one(`
    select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
             'notnull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid), 'typtype', ty.typtype,
             'typname', ty.typname, 'typschema', tn.nspname, 'generated', a.attgenerated) order by a.attnum) as x
    from pg_attribute a
    join pg_type ty on ty.oid = a.atttypid join pg_namespace tn on tn.oid = ty.typnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = '${t.schema}.${t.table}'::regclass and a.attnum > 0 and not a.attisdropped`);
  const list = rows || [];
  return t.columns ? t.columns.map((c) => { const col = list.find((x) => x.name === c); if (!col) throw new Error(`${t.schema}.${t.table}.${c} introuvable`); return col; }) : list;
}

async function contraintes(t) {
  return (await one(`
    select json_agg(json_build_object('name', conname, 'type', contype, 'def', pg_get_constraintdef(oid),
             'cols', (select array_agg(attname order by k) from unnest(conkey) with ordinality as u(attnum, k) join pg_attribute a on a.attrelid = conrelid and a.attnum = u.attnum),
             'reftable', case when contype = 'f' then confrelid::regclass::text end) order by contype, conname) as x
    from pg_constraint where conrelid = '${t.schema}.${t.table}'::regclass`)) || [];
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const ddl = [];
  const enums = new Map();
  const tableSet = new Set(TABLES.map((t) => `${t.schema}.${t.table}`));
  const keptCols = new Map();

  ddl.push('-- schema-generated.sql — GÉNÉRÉ par scripts/migration-rehearsal/snapshot.mjs, ne pas éditer.');
  ddl.push(`-- Source : ${URL_} le ${new Date().toISOString()}`);

  // 1. Colonnes + enums
  const tablesDdl = [];
  for (const t of TABLES) {
    const cols = await colonnes(t);
    keptCols.set(`${t.schema}.${t.table}`, new Set(cols.map((c) => c.name)));
    for (const c of cols) if (c.typtype === 'e') enums.set(`${c.typschema}.${c.typname}`, null);
    const cons = await contraintes(t);
    const lignes = cols.map((c) => {
      let def = c.default ? ` DEFAULT ${c.default}` : '';
      if (c.generated === 's') def = ''; // GENERATED : recréé ci-dessous en expression simple si connu
      return `  ${qid(c.name)} ${c.type}${c.notnull ? ' NOT NULL' : ''}${def}`;
    });
    const consLignes = [];
    for (const k of cons) {
      const colsOk = (k.cols || []).every((c) => keptCols.get(`${t.schema}.${t.table}`).has(c));
      if (!colsOk) continue;
      if (k.type === 'f') {
        const ref = k.reftable.includes('.') ? k.reftable : `public.${k.reftable}`;
        if (!tableSet.has(ref)) continue;
        // colonnes référencées présentes dans le sous-ensemble ?
        const m = k.def.match(/REFERENCES [^(]+\(([^)]+)\)/);
        const refCols = m ? m[1].split(',').map((s) => s.trim().replace(/"/g, '')) : [];
        if (!refCols.every((c) => keptCols.get(ref)?.has(c))) continue;
      }
      consLignes.push(`  CONSTRAINT ${qid(k.name)} ${k.def}`);
    }
    tablesDdl.push(`CREATE TABLE ${rel(t)} (\n${[...lignes, ...consLignes].join(',\n')}\n);`);
    // Colonne GENERATED connue : team_members.display_name
    if (t.table === 'team_members' && cols.some((c) => c.name === 'display_name' && c.generated === 's')) {
      tablesDdl.push(`ALTER TABLE ${rel(t)} DROP COLUMN display_name;`);
      tablesDdl.push(`ALTER TABLE ${rel(t)} ADD COLUMN display_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;`);
    }
  }
  for (const key of enums.keys()) {
    const [s, n] = key.split('.');
    const labels = await one(`select json_agg(e.enumlabel order by e.enumsortorder) as x from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace ns on ns.oid = t.typnamespace where ns.nspname = '${s}' and t.typname = '${n}'`);
    ddl.push(`CREATE TYPE ${qid(s)}.${qid(n)} AS ENUM (${labels.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')});`);
  }
  // Séquences citées par les defaults
  const seqs = new Set();
  for (const d of tablesDdl) for (const m of d.matchAll(/nextval\('([^']+)'::regclass\)/g)) seqs.add(m[1]);
  for (const s of seqs) ddl.push(`CREATE SEQUENCE IF NOT EXISTS ${s};`);
  ddl.push(...tablesDdl);

  // 2. Fonctions
  for (const f of FUNCTIONS) {
    const def = await one(`select pg_get_functiondef('${f}'::regprocedure) as x`);
    if (def) ddl.push(`${def};`);
  }

  // 3. Triggers
  for (const tbl of TRIGGER_TABLES) {
    const trs = await one(`select json_agg(json_build_object('def', pg_get_triggerdef(oid), 'fn', tgfoid::regproc::text)) as x from pg_trigger where tgrelid = '${tbl}'::regclass and not tgisinternal`) || [];
    for (const tr of trs) ddl.push(`${tr.def};`);
  }

  // 4. Vues (+ security_invoker)
  for (const v of VIEWS) {
    const [s, n] = v.split('.');
    const def = await one(`select pg_get_viewdef('${v}'::regclass, true) as x`);
    const opts = await one(`select array_to_string(c.reloptions, ', ') as x from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = '${s}' and c.relname = '${n}'`);
    ddl.push(`CREATE VIEW ${qid(s)}.${qid(n)}${opts ? ` WITH (${opts})` : ''} AS\n${def}`);
  }

  // 5. Policies + RLS
  for (const tbl of POLICY_TABLES) {
    ddl.push(`ALTER TABLE majordhome.${tbl} ENABLE ROW LEVEL SECURITY;`);
    const pols = await one(`select json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'permissive', permissive, 'qual', qual, 'check', with_check) order by policyname) as x from pg_policies where schemaname = 'majordhome' and tablename = '${tbl}'`) || [];
    for (const p of pols) {
      const roles = (p.roles || []).map((r) => (r === 'public' ? 'PUBLIC' : qid(r))).join(', ');
      const using = p.qual ? ` USING (${p.qual})` : '';
      const check = p.check ? ` WITH CHECK (${p.check})` : '';
      ddl.push(`CREATE POLICY ${qid(p.name)} ON majordhome.${tbl} AS ${p.permissive === 'PERMISSIVE' ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${p.cmd} TO ${roles}${using}${check};`);
    }
  }
  fs.writeFileSync(path.join(SCRATCH, 'schema-generated.sql'), ddl.join('\n\n') + '\n');

  // 6. Données
  const data = {};
  for (const t of TABLES) {
    if (t.data === false) { data[`${t.schema}.${t.table}`] = []; continue; }
    const cols = [...keptCols.get(`${t.schema}.${t.table}`)].map(qid).join(', ');
    const rows = await one(`select json_agg(t) as x from (select ${cols} from ${rel(t)}) t`);
    data[`${t.schema}.${t.table}`] = rows || [];
    console.log(`${t.schema}.${t.table}: ${(rows || []).length} lignes`);
  }
  fs.writeFileSync(path.join(SCRATCH, 'data.json'), JSON.stringify(data));
  console.log(`Écrit : ${path.join(SCRATCH, 'schema-generated.sql')}, data.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
