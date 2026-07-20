-- ============================================================================
-- Corbeille des suppressions définitives (hard-delete) — lead + client
-- ----------------------------------------------------------------------------
-- Contexte : les RPC god-mode `lead_hard_delete` / `client_hard_delete`
-- effaçaient la ligne + purgeaient les satellites en cascade SANS aucune trace
-- (contrairement à la fusion de doublons qui garde `duplicate_snapshot`).
-- Une suppression accidentelle (ex : carte lead Fathia Renou, 2026-07-08) était
-- donc irrécupérable sans restauration de backup complète.
--
-- Ce patch pose un filet : chaque hard-delete écrit un snapshot jsonb complet
-- (ligne + satellites) dans `majordhome.hard_delete_archive` AVANT la cascade.
-- Rétention 90 jours (purge cron). Un "recall" = ré-insertion depuis le snapshot.
--
-- Sûreté : le snapshot est un INSERT placé AVANT les DELETE, dans la même
-- transaction → un éventuel bug bloque la suppression (échec fort), il ne peut
-- jamais causer une perte silencieuse.
--
-- Appliqué en prod le 2026-07-08 via MCP (migrations
-- `hard_delete_archive_table` + `hard_delete_archive_snapshot_in_rpcs`).
-- ============================================================================

-- ── 1. Table d'archive ──────────────────────────────────────────────────────
create table if not exists majordhome.hard_delete_archive (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references core.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('lead','client')),
  entity_id uuid not null,
  entity_label text,
  snapshot jsonb not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);

create index if not exists idx_hard_delete_archive_org_time
  on majordhome.hard_delete_archive (org_id, deleted_at desc);
create index if not exists idx_hard_delete_archive_entity
  on majordhome.hard_delete_archive (entity_type, entity_id);

alter table majordhome.hard_delete_archive enable row level security;

drop policy if exists hda_select_org_admin on majordhome.hard_delete_archive;
create policy hda_select_org_admin on majordhome.hard_delete_archive
  for select to authenticated
  using (
    exists (
      select 1 from core.organization_members om
      where om.org_id = hard_delete_archive.org_id
        and om.user_id = auth.uid()
        and om.role = 'org_admin'
    )
  );

-- Vues security_invoker / edges pourraient lire l'archive plus tard (charte multi-tenant).
grant select on majordhome.hard_delete_archive to service_role;

-- Purge auto au-delà de 90 jours (quotidien 03:30 UTC)
select cron.schedule(
  'purge-hard-delete-archive',
  '30 3 * * *',
  $purge$ delete from majordhome.hard_delete_archive where deleted_at < now() - interval '90 days' $purge$
);

-- ── 2. Greffe du snapshot dans les 2 RPC (bodies identiques à l'existant, ────
--       seul le bloc INSERT majordhome.hard_delete_archive est ajouté avant les DELETE)

CREATE OR REPLACE FUNCTION public.lead_hard_delete(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_nb_appointments int := 0;
  v_nb_interactions int := 0;
  v_nb_activities int := 0;
  v_nb_mailing_logs int := 0;
  v_nb_pennylane_quotes int := 0;
  v_nb_technical_visits int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM majordhome.leads WHERE id = p_lead_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT role INTO v_role
  FROM core.organization_members
  WHERE org_id = v_org_id AND user_id = v_user
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_member_of_org' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'org_admin' THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_nb_appointments FROM majordhome.appointments WHERE lead_id = p_lead_id;
  SELECT COUNT(*) INTO v_nb_interactions FROM majordhome.lead_interactions WHERE lead_id = p_lead_id;
  SELECT COUNT(*) INTO v_nb_activities FROM majordhome.lead_activities WHERE lead_id = p_lead_id;
  SELECT COUNT(*) INTO v_nb_mailing_logs FROM majordhome.mailing_logs WHERE lead_id = p_lead_id;
  SELECT COUNT(*) INTO v_nb_pennylane_quotes FROM majordhome.lead_pennylane_quotes WHERE lead_id = p_lead_id;
  SELECT COUNT(*) INTO v_nb_technical_visits FROM majordhome.technical_visits WHERE lead_id = p_lead_id;

  -- ============== Snapshot corbeille (avant toute suppression) ==============
  INSERT INTO majordhome.hard_delete_archive(org_id, entity_type, entity_id, entity_label, snapshot, deleted_by)
  SELECT v_org_id, 'lead', p_lead_id,
    NULLIF(TRIM(COALESCE(l.last_name,'') || ' ' || COALESCE(l.first_name,'')), ''),
    jsonb_build_object(
      'schema_version', 1,
      'lead', to_jsonb(l),
      'appointments',          (SELECT jsonb_agg(to_jsonb(a)) FROM majordhome.appointments a          WHERE a.lead_id = p_lead_id),
      'lead_activities',       (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.lead_activities x       WHERE x.lead_id = p_lead_id),
      'lead_interactions',     (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.lead_interactions x     WHERE x.lead_id = p_lead_id),
      'lead_pennylane_quotes', (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.lead_pennylane_quotes x WHERE x.lead_id = p_lead_id),
      'technical_visits',      (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.technical_visits x      WHERE x.lead_id = p_lead_id),
      'mailing_logs',          (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.mailing_logs x          WHERE x.lead_id = p_lead_id)
    ),
    v_user
  FROM majordhome.leads l WHERE l.id = p_lead_id;

  -- 1. Hard delete des RDV liés (FK SET NULL par défaut, mais on veut les dégager du planning)
  DELETE FROM majordhome.appointments WHERE lead_id = p_lead_id;

  -- 2. Hard delete du lead (CASCADE -> lead_activities, lead_interactions, lead_pennylane_quotes,
  --    mailing_logs, technical_visits, chantier_line_receptions)
  DELETE FROM majordhome.leads WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'lead_id', p_lead_id,
    'org_id', v_org_id,
    'deleted', true,
    'counts', jsonb_build_object(
      'appointments', v_nb_appointments,
      'interactions', v_nb_interactions,
      'activities', v_nb_activities,
      'mailing_logs', v_nb_mailing_logs,
      'pennylane_quotes', v_nb_pennylane_quotes,
      'technical_visits', v_nb_technical_visits
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_hard_delete(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_iv_ids uuid[] := ARRAY[]::uuid[];
  v_nb_contracts int := 0;
  v_nb_interventions int := 0;
  v_nb_certificats int := 0;
  v_nb_appointments int := 0;
  v_nb_mailing_logs int := 0;
  v_nb_sms_logs int := 0;
  v_nb_client_activities int := 0;
  v_nb_leads_detached int := 0;
  v_nb_filleuls_detached int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO v_org_id FROM majordhome.clients WHERE id = p_client_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT role INTO v_role
  FROM core.organization_members
  WHERE org_id = v_org_id AND user_id = v_user
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_member_of_org' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'org_admin' THEN
    RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501';
  END IF;

  WITH RECURSIVE client_contracts AS (
    SELECT id FROM majordhome.contracts WHERE client_id = p_client_id
  ),
  iv(id) AS (
    SELECT id FROM majordhome.interventions
     WHERE client_id = p_client_id
        OR contract_id IN (SELECT id FROM client_contracts)
    UNION
    SELECT c.id FROM majordhome.interventions c
     JOIN iv ON c.parent_id = iv.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_iv_ids FROM iv;

  SELECT COUNT(*) INTO v_nb_contracts         FROM majordhome.contracts         WHERE client_id = p_client_id;
  v_nb_interventions := COALESCE(array_length(v_iv_ids, 1), 0);
  SELECT COUNT(*) INTO v_nb_certificats       FROM majordhome.certificats
     WHERE client_id = p_client_id
        OR intervention_id = ANY(v_iv_ids)
        OR contract_id IN (SELECT id FROM majordhome.contracts WHERE client_id = p_client_id);
  SELECT COUNT(*) INTO v_nb_appointments      FROM majordhome.appointments      WHERE client_id = p_client_id;
  SELECT COUNT(*) INTO v_nb_mailing_logs      FROM majordhome.mailing_logs      WHERE client_id = p_client_id;
  SELECT COUNT(*) INTO v_nb_sms_logs          FROM majordhome.sms_logs          WHERE client_id = p_client_id OR intervention_id = ANY(v_iv_ids);
  SELECT COUNT(*) INTO v_nb_client_activities FROM majordhome.client_activities WHERE client_id = p_client_id;
  SELECT COUNT(*) INTO v_nb_leads_detached    FROM majordhome.leads             WHERE client_id = p_client_id;
  SELECT COUNT(*) INTO v_nb_filleuls_detached FROM majordhome.clients           WHERE parrain_id = p_client_id;

  -- ============== Snapshot corbeille (avant toute suppression/détachement) ==============
  INSERT INTO majordhome.hard_delete_archive(org_id, entity_type, entity_id, entity_label, snapshot, deleted_by)
  SELECT v_org_id, 'client', p_client_id,
    NULLIF(TRIM(COALESCE(c.display_name, COALESCE(c.last_name,'') || ' ' || COALESCE(c.first_name,''))), ''),
    jsonb_build_object(
      'schema_version', 1,
      'client', to_jsonb(c),
      'contracts',         (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.contracts x         WHERE x.client_id = p_client_id),
      'interventions',     (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.interventions x     WHERE x.id = ANY(v_iv_ids)),
      'certificats',       (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.certificats x       WHERE x.client_id = p_client_id OR x.intervention_id = ANY(v_iv_ids) OR x.contract_id IN (SELECT id FROM majordhome.contracts WHERE client_id = p_client_id)),
      'appointments',      (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.appointments x      WHERE x.client_id = p_client_id),
      'client_activities', (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.client_activities x WHERE x.client_id = p_client_id),
      'mailing_logs',      (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.mailing_logs x      WHERE x.client_id = p_client_id),
      'sms_logs',          (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.sms_logs x          WHERE x.client_id = p_client_id OR x.intervention_id = ANY(v_iv_ids)),
      'service_requests',  (SELECT jsonb_agg(to_jsonb(x)) FROM majordhome.service_requests x  WHERE x.intervention_id = ANY(v_iv_ids)),
      'detached_lead_ids',    (SELECT jsonb_agg(id) FROM majordhome.leads   WHERE client_id  = p_client_id),
      'detached_filleul_ids', (SELECT jsonb_agg(id) FROM majordhome.clients WHERE parrain_id = p_client_id)
    ),
    v_user
  FROM majordhome.clients c WHERE c.id = p_client_id;

  -- ============== Purge des satellites NO ACTION (sinon DELETE bloqué) ==============
  DELETE FROM majordhome.service_requests WHERE intervention_id = ANY(v_iv_ids);
  DELETE FROM majordhome.sms_logs WHERE client_id = p_client_id OR intervention_id = ANY(v_iv_ids);
  DELETE FROM majordhome.certificats
   WHERE client_id = p_client_id
      OR intervention_id = ANY(v_iv_ids)
      OR contract_id IN (SELECT id FROM majordhome.contracts WHERE client_id = p_client_id);
  DELETE FROM majordhome.interventions WHERE id = ANY(v_iv_ids);
  UPDATE majordhome.leads SET client_id = NULL WHERE client_id = p_client_id;
  UPDATE majordhome.clients SET parrain_id = NULL WHERE parrain_id = p_client_id;

  -- ============== DELETE final ==============
  DELETE FROM majordhome.clients WHERE id = p_client_id;

  RETURN jsonb_build_object(
    'client_id', p_client_id,
    'org_id', v_org_id,
    'deleted', true,
    'counts', jsonb_build_object(
      'contracts', v_nb_contracts,
      'interventions', v_nb_interventions,
      'certificats', v_nb_certificats,
      'appointments', v_nb_appointments,
      'mailing_logs', v_nb_mailing_logs,
      'sms_logs', v_nb_sms_logs,
      'client_activities', v_nb_client_activities,
      'leads_detached', v_nb_leads_detached,
      'filleuls_detached', v_nb_filleuls_detached
    )
  );
END;
$function$;
