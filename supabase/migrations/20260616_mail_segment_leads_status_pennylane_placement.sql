-- 2026-06-16 — Aligne le filtre "statut lead" de mail_segment_compile sur le PLACEMENT Pennylane.
--
-- Problème : un segment mailing "Devis envoyé" (audience leads) filtrait sur leads.status_id, qui
-- reste figé sur "Devis envoyé" même quand le devis Pennylane bascule accepted (-> Gagné) ou refused
-- (-> Perdu). Conséquence : on pouvait relancer par mail des leads déjà signés ou déjà perdus, et le
-- compte ne correspondait pas au Kanban (placement Pennylane). Cf. majordhome_kanban_cards.
--
-- Fix : pour les statuts pilotés par les devis PL (Devis envoyé / Gagné / Perdu), l'appartenance est
-- désormais dérivée de public.majordhome_kanban_cards (quote_status fait foi), MT-LT inclus (la vue
-- kanban inclut les long-terme ; seul l'écran Pipeline les masque). Les statuts amont
-- (Nouveau / Contacté / RDV planifié) conservent leads.status_id (la vue kanban n'émet pas la
-- colonne "nouveau", et amont = pas de devis PL donc status_id canonique).
--
-- Méthode : on part de la définition LIVE (pg_get_functiondef) et on ne remplace chirurgicalement
-- que 2 fragments (déclarations + clause statut leads) — aucun risque sur les autres branches.
-- Garde-fous : la migration s'annule si un remplacement ne s'applique pas.
-- NB : appliquée en prod via MCP le 2026-06-16 (la définition de base de mail_segment_compile vit
-- côté DB, pas dans le repo). Ce fichier sert de trace git. Non idempotent (échoue proprement si
-- relancé sur une fonction déjà migrée : les cibles n'existent plus).

DO $do$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef('public.mail_segment_compile(jsonb,text,uuid)'::regprocedure) INTO v_src;

  -- 1) Variables DECLARE additionnelles
  v_src := replace(v_src,
$decl_old$  v_int integer;
BEGIN$decl_old$,
$decl_new$  v_int integer;
  v_upstream_ids uuid[];
  v_pl_keys text[];
  v_status_clause text;
BEGIN$decl_new$);

  -- 2) Clause statut leads : status_id -> placement Pennylane pour Devis envoyé/Gagné/Perdu
  v_src := replace(v_src,
$st_old$    v_uuids := ARRAY(SELECT jsonb_array_elements_text(v_base->'status_ids')::uuid);
    IF array_length(v_uuids, 1) > 0 THEN v_where := array_append(v_where, format('l.status_id = ANY(%L::uuid[])', v_uuids)); END IF;$st_old$,
$st_new$    v_uuids := ARRAY(SELECT jsonb_array_elements_text(v_base->'status_ids')::uuid);
    IF array_length(v_uuids, 1) > 0 THEN
      IF p_org_id IS NOT NULL THEN
        SELECT
          COALESCE(array_agg(s.id) FILTER (WHERE s.label NOT IN ('Devis envoyé','Gagné','Perdu')), '{}'::uuid[]),
          COALESCE(array_agg(CASE s.label WHEN 'Devis envoyé' THEN 'devis_envoye' WHEN 'Gagné' THEN 'gagne' WHEN 'Perdu' THEN 'perdu' END) FILTER (WHERE s.label IN ('Devis envoyé','Gagné','Perdu')), '{}'::text[])
        INTO v_upstream_ids, v_pl_keys
        FROM majordhome.statuses s WHERE s.id = ANY(v_uuids);
      ELSE
        v_upstream_ids := v_uuids;
        v_pl_keys := '{}'::text[];
      END IF;
      v_status_clause := '';
      IF array_length(v_upstream_ids, 1) > 0 THEN
        v_status_clause := format('l.status_id = ANY(%L::uuid[])', v_upstream_ids);
      END IF;
      IF array_length(v_pl_keys, 1) > 0 THEN
        IF v_status_clause <> '' THEN v_status_clause := v_status_clause || ' OR '; END IF;
        v_status_clause := v_status_clause || format('l.id IN (SELECT kc.lead_id FROM public.majordhome_kanban_cards kc WHERE kc.org_id = %L AND kc.column_key = ANY(%L::text[]))', p_org_id, v_pl_keys);
      END IF;
      IF v_status_clause <> '' THEN
        v_where := array_append(v_where, '(' || v_status_clause || ')');
      END IF;
    END IF;$st_new$);

  -- 3) Garde-fous : annulation bruyante si un remplacement n'a pas pris
  IF position('v_upstream_ids uuid[]' in v_src) = 0 THEN
    RAISE EXCEPTION 'DECLARE non remplacé — cible introuvable, migration annulée';
  END IF;
  IF position('majordhome_kanban_cards' in v_src) = 0 THEN
    RAISE EXCEPTION 'Clause statut non remplacée — cible introuvable, migration annulée';
  END IF;

  EXECUTE v_src;
END
$do$;
