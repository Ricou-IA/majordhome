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
  { schema: 'majordhome', table: 'product_documents', columns: null, data: false }, // 20261025_2 : action `document` de l'edge supplier-catalog-sync (fiche technique rangée)
  { schema: 'majordhome', table: 'quotes', columns: null, data: false }, // 20260929_1 : FK fum_metres
  { schema: 'majordhome', table: 'equipment_categories', columns: null }, // M1 (20260913_1) en prod : cible des FK pricing_equipment_types / equipments et de la vue client_equipment_kinds
  { schema: 'majordhome', table: 'pricing_zones', columns: null },
  { schema: 'majordhome', table: 'pricing_equipment_types', columns: null },
  { schema: 'majordhome', table: 'pricing_rates', columns: null },
  { schema: 'majordhome', table: 'team_members', columns: null },
  { schema: 'majordhome', table: 'commercials', columns: null }, // 20261005_1 : commercial_set_for_user (liste « Commercial assigné »)
  // auth_user_id : cité par les policies portail client (client_portal_select_own_*) des tables contracts/equipments/interventions
  { schema: 'majordhome', table: 'clients', columns: ['id', 'org_id', 'project_id', 'email', 'first_name', 'last_name', 'display_name', 'phone', 'phone_secondary', 'sms_optin', 'address', 'postal_code', 'city', 'lead_source', 'is_web_draft', 'auth_user_id', 'created_at', 'updated_at', 'client_number', 'pennylane_account_number', 'is_archived', 'address_complement', 'company_name', 'client_category'] }, // client_category : 20261021_1 (find_or_create_client crée la fiche) // address_complement / company_name : 20261011_1 (push identité PL) // 20260930_16 : lus par la vue majordhome_lead_pennylane_quotes ; is_archived : 20261004_1 (agent_verifier_client_candidats)
  { schema: 'majordhome', table: 'equipments', columns: null },
  // contracts / interventions / leads : toutes les colonnes (DDL seul), les vues
  // majordhome_entretien_sav / majordhome_chantiers (20260922_1) en citent des dizaines.
  { schema: 'majordhome', table: 'contracts', columns: null, data: false },
  { schema: 'majordhome', table: 'contract_equipments', columns: null, data: false },
  { schema: 'majordhome', table: 'contract_pricing_items', columns: ['id', 'contract_id', 'equipment_type_id', 'zone_id', 'equipment_id', 'quantity', 'base_price', 'unit_price', 'line_total', 'created_at'], data: false },
  { schema: 'majordhome', table: 'interventions', columns: null, data: false },
  { schema: 'majordhome', table: 'certificats', columns: null }, // 20261010_1 : anomalies agrégées par majordhome_entretien_sav, FK interventions.source_certificat_id ; 20261012_1 : toutes les colonnes (vue majordhome_certificats regénérée)
  { schema: 'majordhome', table: 'statuses', columns: null }, // 20261012_3 : lead_search_for_attach (status_label) ; petite table, données incluses
  { schema: 'majordhome', table: 'sources', columns: null }, // 20261012_4 : lead_search (source_name) ; petite table, données incluses
  { schema: 'majordhome', table: 'leads', columns: null, data: false },
  { schema: 'majordhome', table: 'client_creation_audit', columns: null, data: false }, // 20261021_1 : find_or_create_client trace ses décisions (dont « ambiguous »)
  { schema: 'majordhome', table: 'dedup_candidates', columns: null, data: false }, // 20261021_1 : find_or_create_client y signale un e-mail partagé
  { schema: 'majordhome', table: 'lead_pennylane_quotes', columns: null, data: false }, // 20260930_16 : chantier_id + trigger chantier_ensure_for_quote
  { schema: 'majordhome', table: 'appointments', columns: null, data: false }, // toutes les colonnes : auto_rdv_poser en écrit une vingtaine
  { schema: 'majordhome', table: 'appointment_technicians', columns: null, data: false },
  { schema: 'majordhome', table: 'pennylane_quotes', columns: null, data: false }, // 20260930_16 : libellé du chantier ; 20261012_5 : toutes les colonnes (candidats du rattachement automatique)
  { schema: 'majordhome', table: 'pennylane_quote_dismissals', columns: null, data: false }, // 20261012_5 : un devis écarté n'est jamais rattaché automatiquement
  { schema: 'majordhome', table: 'chantiers', columns: null, data: false }, // 20261001_2 : realized_date (entité en prod depuis 20260930_16)
  { schema: 'majordhome', table: 'chantier_line_receptions', columns: null, data: false }, // 20260930_16 : chantier_id → majordhome.chantiers
  { schema: 'majordhome', table: 'lead_activities', columns: null, data: false }, // 20260930_17 : activités chantier_*
  { schema: 'majordhome', table: 'sms_logs', columns: ['id', 'intervention_id', 'campaign_name', 'sent_at'], data: false },
  { schema: 'majordhome', table: 'invoices', columns: null, data: false }, // lue par la vue majordhome_entretien_sav (20260923_3) ; toutes les colonnes : la vue majordhome_invoices (i.*) est photographiée depuis 20261010_1
  { schema: 'majordhome', table: 'service_requests', columns: ['id', 'intervention_id'], data: false }, // 20261019_2 : garde du retrait d'une carte entretien sans contrat
  { schema: 'majordhome', table: 'maintenance_visits', columns: null, data: false }, // 20260928_1 : garde-fou date de visite (triggers ci-dessous)
  // 20260930_12..15 (droits app-level phases 4-6) : défauts app + surcharges par org AVEC données
  // (la purge se vérifie sur les vraies lignes), tasks pour ses policies role_can.
  { schema: 'majordhome', table: 'app_role_permissions', columns: null },
  { schema: 'majordhome', table: 'role_permissions', columns: null },
  { schema: 'majordhome', table: 'org_roles', columns: null }, // 20261006_1 : profils maison
  { schema: 'majordhome', table: 'member_org_roles', columns: null },
  { schema: 'majordhome', table: 'tasks', columns: null, data: false },
  { schema: 'majordhome', table: 'journees_secteur', columns: null, data: false }, // 20261004_3 : auto_rdv_poser (journée figée, étiquette déduite)
  { schema: 'majordhome', table: 'pennylane_sync', columns: null }, // 20261011_1 : synchro identité client MDH ⇄ PL (saisies en attente)
  { schema: 'majordhome', table: 'pennylane_customer_lookup', columns: null }, // 20261011_1 : base de diff (identity_baseline_at)
  // 20261013_2 : tournées de livraison palettes (webshop) — petites tables, données incluses
  { schema: 'majordhome', table: 'webshop_sectors', columns: null },
  { schema: 'majordhome', table: 'webshop_sector_postcodes', columns: null }, // 20261017_1 : webshop_resolve_sector (consommé par le site) ; 20261017_2 : données (postcode_taken)
  { schema: 'majordhome', table: 'webshop_shipping_rates', columns: null }, // 20261017_2 : RPC d'édition de la grille colis
  { schema: 'majordhome', table: 'webshop_delivery_slots', columns: null },
  { schema: 'majordhome', table: 'webshop_products', columns: null }, // 20261013_3 : JOIN de la vue ; 20261014_1 : données pour l'assert droits
  { schema: 'majordhome', table: 'webshop_categories', columns: null }, // 20261014_1 : policies lecture membre / écriture admin
  { schema: 'majordhome', table: 'webshop_pickup_points', columns: null, data: false }, // 20261014_1 : JOIN de la vue majordhome_webshop_orders
  { schema: 'majordhome', table: 'webshop_orders', columns: null },
  { schema: 'majordhome', table: 'webshop_order_items', columns: null }, // 20261013_3 : cascade de webshop_order_hard_delete
];

const FUNCTIONS = [
  // 20261024_2 / 20261025_2 / 20261025_4 : catalogue fournisseur (écrivain unique) et secrets Vault par org — relus
  // de la prod pour répéter une migration qui ne fait que les remplacer (assert-catalogue-connexion.sql).
  'public.supplier_catalog_upsert(uuid, uuid, text, jsonb, jsonb)',
  'public.org_secret_set(uuid, text, text)',
  'public.org_secret_delete(uuid, text)',
  'public.org_secret_status(uuid, text)',
  'public.org_secret_read(uuid, text)',
  'majordhome.handle_updated_at()',
  'majordhome.calculate_next_maintenance()',
  'majordhome.update_client_on_equipment_change()',
  'majordhome.equipments_sync_category()', // trigger equipments posé par M1 (20260913_1), en prod depuis le 2026-09-12
  'majordhome.equipment_unlinked_purge_children()', // trigger equipments posé par 20260922_2, en prod depuis le 2026-09-22
  'majordhome.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)',
  'public.process_web_entretien(uuid, text, text, text, text, text, text, text, text, jsonb, numeric, numeric, integer, numeric, text, jsonb, text)',
  'public.team_member_set_routing_settings(uuid, integer, boolean, text[], jsonb, jsonb, boolean, boolean)', // 20261014_2
  'public.invoice_create_draft(jsonb, jsonb)', // 20261010_1 : client_note dans l'INSERT
  'majordhome.invoices_guard_immutable()', // 20261010_1 : client_note figée à l'émission
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
  // 20261006_1..2 en prod : objets des profils maison
  'majordhome.role_permissions_check_role()',
  'majordhome.user_org_role_code(uuid)',
  'majordhome.org_roles_require_admin(uuid)',
  'public.org_role_create(uuid, text, text)',
  'public.org_role_update(uuid, text, boolean)',
  'public.org_role_delete(uuid)',
  'public.member_set_org_role(uuid, uuid, uuid)',
  // 20260930_16..18 : entité chantier
  'majordhome.lead_pennylane_quotes_invariant_winning()',
  'majordhome.chantier_ensure_for_quote()', // trigger de prod sur lead_pennylane_quotes (20260930_16) : sans elle le schéma ne charge plus
  'public.lead_merge(uuid, uuid)',
  'public.pennylane_sync_update_client_fields(uuid, uuid, jsonb)', // 20261011_1 : écriture PL → client par le journal // recréée sans ses 16 tables satellites : plpgsql ne résout les tables qu'à l'exécution
  // 20261012_5 : rattachement automatique des devis (seuil = réglage d'org)
  'public.upsert_pennylane_lead(uuid, uuid, text, text, text, text, text, text, text, text, numeric, text)',
  'public.pennylane_sync_auto_attach_quote(uuid, uuid, bigint, bigint, numeric, text, date, text, text)',
  'public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric)',
  'majordhome.webshop_slot_recount(uuid)', // 20261013_2 (en prod) : appelée par le trigger de 20261013_3
  // 20261017_1 : réglages webshop lus par la base — définitions LIVE des fonctions remplacées
  'public.webshop_easter_sunday(integer)',
  'public.webshop_is_french_holiday(date)',
  // 20261017_1 en prod depuis le 2026-10-18 : webshop_cycle_week(date) appelle la variante à ancre
  // (fonction SQL, corps validé au chargement) ; réglages lus par la base, cités par les RPC.
  'majordhome.webshop_reglages_defaut()',
  'majordhome.webshop_reglage_entier(jsonb, integer, integer, integer)',
  'majordhome.webshop_reglage_date(jsonb, text)',
  'majordhome.webshop_jsonb_fusion(jsonb, jsonb)',
  'majordhome.webshop_reglages(uuid)',
  'majordhome.webshop_should_send(uuid, timestamptz)',
  'majordhome.webshop_close_due_slots_org(uuid, date)',
  'majordhome.webshop_run_daily_tours_at(timestamptz, date)',
  'public.webshop_cycle_week(date, date)',
  'public.webshop_cycle_week(date)',
  'public.webshop_insert_slots(uuid, jsonb)',
  'public.webshop_generate_slots(uuid, integer, date)',
  'public.webshop_close_due_slots(date)',
  'public.webshop_resolve_sector(uuid, text, text)',
  'public.webshop_apply_paid_order(uuid)',
  'public.webshop_run_daily_tours(date)',
  'majordhome.webshop_slot_guard(uuid)',
  'public.webshop_slot_set_status(uuid, text, text)',
  'public.webshop_slot_cancel(uuid, text)',
  'public.webshop_order_move_slot(uuid, uuid)',
  'public.webshop_slot_send_now(uuid)',
  'public.webshop_slot_send_result(uuid)',
  'public.find_or_create_client(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean)', // 20261021_1 : remplacée (rapprochement fort) ; signature prod relue le 2026-10-24 (14ᵉ paramètre boolean)
];

// Triggers utilisateur à reproduire (ceux qui interagissent avec la migration).
const TRIGGER_TABLES = ['majordhome.equipments', 'majordhome.maintenance_visits', 'majordhome.contracts', 'majordhome.lead_pennylane_quotes', 'majordhome.role_permissions'];

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
  'public.majordhome_certificats', // 20261012_1 : photo_plaque_path / photo_plaque_absence (colonnes en fin)
  'public.majordhome_quotes', // 20261010_1 : commentaire (vue JOIN, colonne en fin)
  'public.majordhome_quotes_write',
  'public.majordhome_suppliers', // 20261024_2 : connector / catalog_sync_* en fin (miroirs updatable) ; 20261025_2 : site_url, mapping, auto_sync…
  'public.majordhome_suppliers_write',
  'public.majordhome_supplier_products', // 20261025_2 : model_key / model_key_source en fin
  'public.majordhome_supplier_products_write',
  'public.majordhome_product_documents', // 20261025_2 : cible de l'action `document`
  'public.majordhome_product_documents_write',
  'public.majordhome_invoices', // 20261010_1 : client_note (i.* ⇒ DROP + CREATE)
  // 20260930_16 : cibles du CREATE OR REPLACE
  'public.majordhome_lead_pennylane_quotes',
  'public.majordhome_appointments',
  'public.majordhome_org_roles', // 20261006_1 : profils maison
  'public.majordhome_member_org_roles',
  'public.majordhome_webshop_delivery_slots', // 20261013_2 : colonnes de suivi en fin
  'public.majordhome_webshop_orders', // 20261013_3 : delivery_instructions en fin
  'public.majordhome_webshop_orders_write',
  'public.majordhome_webshop_products', // 20261014_1 : vue d'écriture du catalogue (assert droits)
  // 20261018_1 : miroirs SELECT * (security_invoker) par lesquels un membre écrivait en direct
  'public.majordhome_webshop_sectors',
  'public.majordhome_webshop_sector_postcodes',
  'public.majordhome_webshop_shipping_rates',
  'public.majordhome_webshop_pickup_points',
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
  'org_roles', 'member_org_roles', // 20261006_1
  'webshop_delivery_slots', 'webshop_orders', // 20261013_2
  'webshop_products', 'webshop_categories', // 20261014_1
  // 20261018_1 : écritures directes retirées (policy FOR ALL membres → SELECT membres)
  'webshop_sectors', 'webshop_sector_postcodes', 'webshop_shipping_rates', 'webshop_pickup_points',
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

  // 2. Fonctions (+ privilèges EXECUTE tels qu'en prod : sans ce rejeu, une fonction relue garde le défaut
  //    « EXECUTE à PUBLIC » du cluster et une assertion de charte échoue à tort — vécu sur org_secret_read, 2026-10-24)
  const ROLES_ACL = new Set(['anon', 'authenticated', 'service_role', 'postgres', 'baikal_reader']);
  for (const f of FUNCTIONS) {
    const def = await one(`select pg_get_functiondef('${f}'::regprocedure) as x`);
    if (!def) continue;
    ddl.push(`${def};`);
    const acl = await one(`select array_to_json(proacl) as x from pg_proc where oid = '${f}'::regprocedure`);
    if (!Array.isArray(acl)) continue; // proacl NULL = défaut PostgreSQL (EXECUTE à PUBLIC), rien à rejouer
    // Les ALTER DEFAULT PRIVILEGES du bootstrap ont déjà accordé EXECUTE aux rôles applicatifs à la création : on
    // repart de zéro (PUBLIC et rôles) avant de rejouer les GRANT effectifs de la prod.
    ddl.push(`REVOKE ALL ON FUNCTION ${f} FROM PUBLIC, anon, authenticated, service_role, baikal_reader;`);
    for (const item of acl) {
      const m = String(item).match(/^(.*?)=([^/]*)\//);
      if (!m || !m[2].includes('X')) continue;
      const grantee = m[1] === '' ? 'PUBLIC' : m[1].replace(/^"|"$/g, '');
      if (grantee !== 'PUBLIC' && !ROLES_ACL.has(grantee)) continue;
      ddl.push(`GRANT EXECUTE ON FUNCTION ${f} TO ${grantee === 'PUBLIC' ? 'PUBLIC' : qid(grantee)};`);
    }
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
