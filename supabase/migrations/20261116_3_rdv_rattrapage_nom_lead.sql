-- ============================================================================
-- 20261116_3 — Rattrapage : RDV restés à l'ancien nom de leur lead
-- ============================================================================
-- MIGRATION DE DONNÉES, jouée une fois en production le 2026-11-16 (26 RDV,
-- 23 leads). NE JAMAIS REJOUER à la main : sans effet si tout est aligné, mais
-- elle n'a plus de raison d'être depuis `20261116_2` (le trigger
-- `trg_lead_rename_sync_appointments` tient les RDV à jour).
--
-- Même règle que le trigger, appliquée au passé : un RDV suit le nom actuel de
-- son lead seulement si le mouchard (`majordhome.audit_log`) prouve qu'il
-- portait le nom du lead AVANT un renommage (même nom, prénom identique ou
-- absent). Un RDV au nom d'une autre personne n'est pas touché. Les renommages
-- antérieurs au mouchard (2026-09-16) n'ont pas de preuve : ils restent tels
-- quels.
--
-- Le mouchard ne garde que les champs modifiés : l'ancien nom complet d'une
-- ligne se reconstitue avec le renommage suivant du même lead, sinon avec le
-- lead actuel.
-- Garde : plus de 40 RDV concernés = état inattendu, rien n'est écrit.
-- ============================================================================

DO $$
DECLARE
  v_n integer;
BEGIN
  WITH ren AS (
    SELECT g.id, g.record_id AS lead_id, l.org_id,
           btrim(coalesce(
             g.old_values->>'last_name',
             (SELECT n.old_values->>'last_name' FROM majordhome.audit_log n
               WHERE n.table_name = 'leads' AND n.action = 'UPDATE' AND n.record_id = g.record_id
                 AND n.id > g.id AND n.old_values ? 'last_name' ORDER BY n.id LIMIT 1),
             l.last_name, '')) AS old_last,
           btrim(coalesce(
             g.old_values->>'first_name',
             (SELECT n.old_values->>'first_name' FROM majordhome.audit_log n
               WHERE n.table_name = 'leads' AND n.action = 'UPDATE' AND n.record_id = g.record_id
                 AND n.id > g.id AND n.old_values ? 'first_name' ORDER BY n.id LIMIT 1),
             l.first_name, '')) AS old_first,
           btrim(coalesce(l.last_name, ''))  AS new_last,
           btrim(coalesce(l.first_name, '')) AS new_first
      FROM majordhome.audit_log g
      JOIN majordhome.leads l ON l.id = g.record_id AND l.is_deleted = false
     WHERE g.table_name = 'leads' AND g.action = 'UPDATE'
       AND (g.changed_fields @> ARRAY['last_name'] OR g.changed_fields @> ARRAY['first_name'])
  ), cand AS (
    SELECT DISTINCT ON (a.id) a.id, r.old_last, r.old_first, r.new_last, r.new_first
      FROM ren r
      JOIN majordhome.appointments a
        ON a.lead_id = r.lead_id
       AND a.org_id IN (SELECT o.id FROM majordhome.organizations o WHERE o.core_org_id = r.org_id)
     WHERE r.old_last <> '' AND r.new_last <> ''
       AND lower(btrim(a.client_name)) = lower(r.old_last)
       AND (btrim(coalesce(a.client_first_name, '')) = '' OR lower(btrim(a.client_first_name)) = lower(r.old_first))
       AND (a.client_name IS DISTINCT FROM r.new_last
            OR a.client_first_name IS DISTINCT FROM NULLIF(r.new_first, ''))
     ORDER BY a.id, r.id DESC
  ), garde AS (
    SELECT count(*) AS n FROM cand
  ), maj AS (
    UPDATE majordhome.appointments a
       SET client_name       = c.new_last,
           client_first_name = NULLIF(c.new_first, ''),
           subject = CASE
             WHEN a.subject IS NULL OR c.old_first = '' THEN a.subject
             WHEN position(c.old_first || ' ' || c.old_last IN a.subject) > 0
               THEN replace(a.subject, c.old_first || ' ' || c.old_last, btrim(c.new_first || ' ' || c.new_last))
             WHEN position(c.old_last || ' ' || c.old_first IN a.subject) > 0
               THEN replace(a.subject, c.old_last || ' ' || c.old_first, btrim(c.new_last || ' ' || c.new_first))
             ELSE a.subject
           END,
           updated_at = now()
      FROM cand c, garde
     WHERE a.id = c.id AND garde.n <= 40
    RETURNING a.id
  )
  SELECT (SELECT n FROM garde) INTO v_n FROM (SELECT count(*) FROM maj) x;

  IF v_n > 40 THEN
    RAISE EXCEPTION 'rattrapage refusé : % RDV concernés (26 attendus le 2026-11-16)', v_n;
  END IF;
  RAISE NOTICE 'rattrapage : % RDV réalignés sur le nom de leur lead', v_n;
END $$;

-- ----------------------------------------------------------------------------
-- Essai à blanc en production avant application (même bloc, annulé par une
-- exception) : 26 candidats, 26 RDV modifiés, 0 RDV modifié dont le nom ne soit
-- pas celui de son lead.
-- Appliquée en production et vérifiée le 2026-11-16 : 26 lignes au mouchard
-- (`majordhome.audit_log`, table_name = 'appointments',
-- changed_fields && ARRAY['client_name','client_first_name']) — 15 changements
-- de nom, 11 de prénom seul. Rejouer le SELECT de `cand` ci-dessus → 0 ligne.
-- ----------------------------------------------------------------------------
