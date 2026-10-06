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
  { schema: 'core', table: 'profiles', columns: null }, // toutes : public.profiles (vue regénérée) les référence toutes
  { schema: 'core', table: 'organization_members', columns: null },
  { schema: 'core', table: 'projects', columns: ['id', 'org_id', 'name', 'status', 'identity'] },
  { schema: 'majordhome', table: 'organizations', columns: null },
  { schema: 'majordhome', table: 'suppliers', columns: null, data: false }, // 20260929_1 : FK fum_composant_mapping
  { schema: 'majordhome', table: 'supplier_products', columns: null, data: false }, // 20260929_1 : FK fum_article_attrs + vue majordhome_fum_articles
  { schema: 'majordhome', table: 'quotes', columns: null, data: false }, // 20260929_1 : FK fum_metres
  { schema: 'majordhome', table: 'equipment_categories', columns: null }, // M1 (20260913_1) en prod : cible des FK pricing_equipment_types / equipments et de la vue client_equipment_kinds
  { schema: 'majordhome', table: 'pricing_zones', columns: null },
  { schema: 'majordhome', table: 'pricing_equipment_types', columns: null },
  { schema: 'majordhome', table: 'pricing_rates', columns: null },
  { schema: 'majordhome', table: 'team_members', columns: null },
  { schema: 'majordhome', table: 'commercials', columns: null }, // 20261005_1 : commercial_set_for_user (liste « Commercial assigné »)
  // auth_user_id : cité par les policies portail client (client_portal_select_own_*) des tables contracts/equipments/interventions
  { schema: 'majordhome', table: 'clients', columns: ['id', 'org_id', 'project_id', 'email', 'first_name', 'last_name', 'display_name', 'phone', 'phone_secondary', 'sms_optin', 'address', 'postal_code', 'city', 'lead_source', 'is_web_draft', 'auth_user_id', 'created_at', 'updated_at', 'client_number', 'pennylane_account_number', 'is_archived'] }, // 20260930_16 : lus par la vue majordhome_lead_pennylane_quotes ; is_archived : 20261004_1 (agent_verifier_client_candidats)
  { schema: 'majordhome', table: 'equipments', columns: null },
  // contracts / interventions / leads : toutes les colonnes (DDL seul), les vues
  // majordhome_entretien_sav / majordhome_chantiers (20260922_1) en citent des dizaines.
  { schema: 'majordhome', table: 'contracts', columns: null, data: false },
  { schema: 'majordhome', table: 'contract_equipments', columns: null, data: false },
  { schema: 'majordhome', table: 'contract_pricing_items', columns: ['id', 'contract_id', 'equipment_type_id', 'zone_id', 'equipment_id', 'quantity', 'base_price', 'unit_price', 'line_total', 'created_at'], data: false },
  { schema: 'majordhome', table: 'interventions', columns: null, data: false },
  { schema: 'majordhome', table: 'certificats', columns: ['id', 'org_id', 'equipment_id', 'intervention_id', 'equipement_type', 'type_document', 'tva_taux', 'pieces_remplacees', 'created_at'] },
  { schema: 'majordhome', table: 'leads', columns: null, data: false },
  { schema: 'majordhome', table: 'lead_pennylane_quotes', columns: null, data: false }, // 20260930_16 : chantier_id + trigger chantier_ensure_for_quote
  { schema: 'majordhome', table: 'appointments', columns: null, data: false }, // toutes les colonnes : auto_rdv_poser en écrit une vingtaine
  { schema: 'majordhome', table: 'appointment_technicians', columns: null, data: false },
  { schema: 'majordhome', table: 'pennylane_quotes', columns: ['org_id', 'pennylane_quote_id', 'quote_number', 'label', 'status', 'quote_date', 'pdf_url', 'pdf_invoice_subject'], data: false }, // 20260930_16 : libellé du chantier
  { schema: 'majordhome', table: 'chantiers', columns: null, data: false }, // 20261001_2 : realized_date (entité en prod depuis 20260930_16)
  { schema: 'majordhome', table: 'chantier_line_receptions', columns: null, data: false }, // 20260930_16 : chantier_id → majordhome.chantiers
  { schema: 'majordhome', table: 'lead_activities', columns: null, data: false }, // 20260930_17 : activités chantier_*
  { schema: 'majordhome', table: 'sms_logs', columns: ['id', 'intervention_id', 'campaign_name', 'sent_at'], data: false },
  { schema: 'majordhome', table: 'invoices', columns: ['id', 'import_status'], data: false }, // lue par la vue majordhome_entretien_sav (hub de facturation, 20260923_3)
  { schema: 'majordhome', table: 'maintenance_visits', columns: null, data: false }, // 20260928_1 : garde-fou date de visite (triggers ci-dessous)
  // 20260930_12..15 (droits app-level phases 4-6) : défauts app + surcharges par org AVEC données
  // (la purge se vérifie sur les vraies lignes), tasks pour ses policies role_can.
  { schema: 'majordhome', table: 'app_role_permissions', columns: null },
  { schema: 'majordhome', table: 'role_permissions', columns: null },
  { schema: 'majordhome', table: 'tasks', columns: null, data: false },
  { schema: 'majordhome', table: 'journees_secteur', columns: null, data: false }, // 20261004_3 : auto_rdv_poser (journée figée, étiquette déduite)
];

const FUNCTIONS = [
  'majordhome.handle_updated_at()',
  'majordhome.calculate_next_maintenance()',
  'majordhome.update_client_on_equipment_change()',
  'majordhome.equipments_sync_category()', // trigger equipments posé par M1 (20260913_1), en prod depuis le 2026-09-12
  'majordhome.equipment_unlinked_purge_children()', // trigger equipments posé par 20260922_2, en prod depuis le 2026-09-22
  'majordhome.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)',
  'public.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)',
  'public.team_member_set_routing_settings(uuid, integer, boolean, text[])',
  // 20260922_1 (commande personnes × jours) : vues chantiers / entretien_sav + RPC de patch lead
  'majordhome.project_org_id(uuid)',
  'majordhome.quote_status_bucket(text)',
  'public.update_majordhome_lead(uuid, jsonb)',
  // 20260922_3 : REVOKE PUBLIC/anon/authenticated — l'ACL de départ (anon/authenticated/service_role
  // = EXECUTE) est reproduite par les privilèges par défaut de bootstrap-pre.sql, comme en prod.
  'public.exec_sql(text)',
  // 20260928_1 : triggers de majordhome.maintenance_visits
  'public.sync_intervention_from_visit()',
  'majordhome.update_client_on_visit()',
  'majordhome.maintenance_visit_date_guard()', // posé par 20260928_1
  // 20260928_3 : triggers de majordhome.contracts
  'majordhome.auto_expire_contract_on_end_date()',
  'majordhome.update_client_on_contract_change()',
  'majordhome.contract_activation_promote_cards()',
  // 20260930_12..15 : arbitre des droits (RLS role_can). org_seed_permissions a été
  // supprimée en prod par 20260930_15 — ne plus la lister (le cast ::regprocedure échouerait).
  'majordhome.user_effective_role(uuid)',
  'majordhome.role_can(uuid, text, text)',
  // 20261006_1..2 (profils maison) : appelées par member_set_org_role / org_role_delete,
  // et org_upsert_role_permission doit traverser le trigger role_permissions_check_role.
  'core.update_member_role(uuid, uuid, text, text, text)',
  'public.update_member_role(uuid, uuid, text, text, text)',
  'public.team_member_sync_role_for_user(uuid, uuid)',
  'majordhome.planning_role_for(text, text, text)',
  'public.org_upsert_role_permission(uuid, text, text, text, boolean)',
  // 20260930_16..18 : entité chantier
  'majordhome.lead_pennylane_quotes_invariant_winning()',
  'majordhome.chantier_ensure_for_quote()', // trigger de prod sur lead_pennylane_quotes (20260930_16) : sans elle le schéma ne charge plus
  'public.lead_merge(uuid, uuid)', // recréée sans ses 16 tables satellites : plpgsql ne résout les tables qu'à l'exécution
];

// Triggers utilisateur à reproduire (ceux qui interagissent avec la migration).
const TRIGGER_TABLES = ['majordhome.equipments', 'majordhome.maintenance_visits', 'majordhome.contracts', 'majordhome.lead_pennylane_quotes'];

const VIEWS = [
  'public.profiles', // cible des sous-requêtes « nom de l'auteur » des vues majordhome_* (interactions prospects…)
  'majordhome.v_planning',
  'majordhome.v_equipments_maintenance',
  'public.majordhome_equipments',
  'public.majordhome_pricing_equipment_types',
  'public.majordhome_team_members',
  'public.majordhome_client_equipment_kinds',
  'public.majordhome_pricing_zones',
  'public.majordhome_organizations',
  // 20260922_1 : cibles du CREATE OR REPLACE (l'ordre compte : lead_quote_stats avant chantiers)
  'majordhome.lead_quote_stats',
  'public.majordhome_interventions',
  'majordhome.chantier_quote_stats', // 20261001_2 : lue par majordhome_chantiers (entité en prod)
  'public.majordhome_chantiers',
  'public.majordhome_chantiers_write',
  'public.majordhome_entretien_sav',
  // 20260930_16 : cibles du CREATE OR REPLACE
  'public.majordhome_lead_pennylane_quotes',
  'public.majordhome_appointments',
];

// Policies reproduites : celles qui ne dépendent d'aucune fonction absente du
// sous-ensemble. role_can / project_org_id / user_can_read_project sont dans FUNCTIONS
// (equipments/interventions restent exclues : user_can_read_project non listée).
const POLICY_TABLES = [
  'pricing_zones', 'pricing_equipment_types', 'team_members',
  // 20260930_13 : bascule des écritures sur role_can
  'leads', 'contracts', 'quotes', 'tasks',
  // 20260930_14 : purge des surcharges (lecture org / écriture org_admin)
  'role_permissions', 'app_role_permissions',
];

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
