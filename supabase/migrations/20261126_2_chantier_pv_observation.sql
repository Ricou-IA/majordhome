-- 20261126_2_chantier_pv_observation.sql — observation libre de l'installateur sur le PV de réception
-- Eric 2026-11-26 : « il faut prévoir un champ saisissable par l'installateur, pour faire une
-- observation / une remarque ». Saisie dans « Préparer le PV » avec la déclaration, lue par le
-- client avant de signer, imprimée dans le PDF, figée avec la signature comme le reste.
--
-- Compatible avec l'edge `chantier-pv` déjà en ligne : `p_observation` a une valeur par défaut,
-- l'appel à quatre arguments nommés continue de marcher (l'observation reste alors vide). L'ancienne
-- signature est SUPPRIMÉE avant la nouvelle : deux fonctions de même nom feraient un appel ambigu.
-- Règles du texte : `normaliserObservation` de src/lib/pvPoints.js (bords retirés, vide = NULL,
-- 2 000 caractères au plus) ; la base les répète en garde.

ALTER TABLE majordhome.chantier_pv
  ADD COLUMN observation text,
  ADD CONSTRAINT chantier_pv_observation_longueur CHECK (observation IS NULL OR char_length(observation) <= 2000);

COMMENT ON COLUMN majordhome.chantier_pv.observation IS
  'Observation libre de l''installateur, jointe à sa déclaration (préparation). Figée à la signature du client.';

-- ───────────────────────── Ce qui est signé est figé : l'observation aussi ─────────────────────────

CREATE OR REPLACE FUNCTION majordhome.chantier_pv_signature_figee() RETURNS trigger
LANGUAGE plpgsql
SET search_path = majordhome, public
AS $$
BEGIN
  IF OLD.signed_at IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pv_signe' USING HINT = 'Un PV de réception signé ne se supprime pas.';
  END IF;
  IF NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.signataire_nom IS DISTINCT FROM OLD.signataire_nom
     OR NEW.signature_png IS DISTINCT FROM OLD.signature_png
     OR NEW.reception_type IS DISTINCT FROM OLD.reception_type
     OR NEW.reserves_nature IS DISTINCT FROM OLD.reserves_nature
     OR NEW.reserves_travaux IS DISTINCT FROM OLD.reserves_travaux
     OR NEW.info_recues IS DISTINCT FROM OLD.info_recues
     OR NEW.notices_recues IS DISTINCT FROM OLD.notices_recues
     OR NEW.entretien_recues IS DISTINCT FROM OLD.entretien_recues
     OR NEW.gabarit IS DISTINCT FROM OLD.gabarit
     OR NEW.points_entreprise IS DISTINCT FROM OLD.points_entreprise
     OR NEW.observation IS DISTINCT FROM OLD.observation
     OR NEW.points_client IS DISTINCT FROM OLD.points_client
     OR NEW.devis IS DISTINCT FROM OLD.devis
     OR NEW.chantier_id IS DISTINCT FROM OLD.chantier_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'pv_signe' USING HINT = 'Un PV de réception signé ne se modifie pas.';
  END IF;
  IF OLD.levee_signed_at IS NOT NULL
     AND (NEW.levee_signed_at IS DISTINCT FROM OLD.levee_signed_at
          OR NEW.levee_signataire_nom IS DISTINCT FROM OLD.levee_signataire_nom
          OR NEW.levee_signature_png IS DISTINCT FROM OLD.levee_signature_png
          OR NEW.reserves_reponse IS DISTINCT FROM OLD.reserves_reponse
          OR NEW.reserves_echeance IS DISTINCT FROM OLD.reserves_echeance) THEN
    RAISE EXCEPTION 'pv_signe' USING HINT = 'Une levée des réserves signée ne se modifie pas.';
  END IF;
  RETURN NEW;
END;
$$;

-- ───────────────────────── Préparation : déclaration + observation ─────────────────────────

DROP FUNCTION public.chantier_pv_preparer(uuid, text, jsonb, uuid);

CREATE FUNCTION public.chantier_pv_preparer(
  p_chantier_id uuid, p_gabarit text, p_points jsonb, p_user uuid, p_observation text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_chantier    majordhome.chantiers;
  v_points      jsonb;
  v_at          timestamptz;
  v_observation text := NULLIF(btrim(p_observation), '');
BEGIN
  -- Verrou du chantier : sérialise préparation et signature (une signature ne lit jamais une
  -- déclaration à moitié réécrite).
  SELECT * INTO v_chantier FROM majordhome.chantiers c WHERE c.id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  IF v_chantier.pv_reception_path IS NOT NULL
     OR EXISTS (SELECT 1 FROM majordhome.chantier_pv pv WHERE pv.chantier_id = p_chantier_id AND pv.signed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deja_signe');
  END IF;

  -- Garde positive : la déclaration est acceptée seulement si elle est un tableau non vide dont
  -- TOUS les éléments sont valides (un NULL n'ouvre rien). CASE et non AND : l'ordre d'évaluation
  -- d'un AND n'est pas garanti, et jsonb_array_length lève une erreur sur un non-tableau.
  IF (CASE WHEN jsonb_typeof(p_points) IS DISTINCT FROM 'array' THEN false
           WHEN jsonb_array_length(p_points) = 0 THEN false
           ELSE
        (SELECT count(*)
           FROM jsonb_array_elements(p_points) e
          WHERE jsonb_typeof(e) = 'object'
            AND jsonb_typeof(e->'cle') = 'string' AND btrim(e->>'cle') <> ''
            AND jsonb_typeof(e->'texte') = 'string' AND btrim(e->>'texte') <> ''
            AND jsonb_typeof(e->'reponse') = 'string' AND e->>'reponse' IN ('oui', 'non', 'sans_objet'))
        = jsonb_array_length(p_points)
      END) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'declaration_incomplete');
  END IF;

  IF (p_gabarit IN ('poele_granules', 'poele_buches', 'pac_air_air', 'pac_air_eau', 'chauffe_eau', 'generique')) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'gabarit_inconnu');
  END IF;

  IF (v_observation IS NULL OR char_length(v_observation) <= 2000) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'texte_trop_long');
  END IF;

  SELECT jsonb_agg(jsonb_build_object('cle', btrim(e->>'cle'), 'texte', btrim(e->>'texte'), 'reponse', e->>'reponse') ORDER BY i)
    INTO v_points
    FROM jsonb_array_elements(p_points) WITH ORDINALITY AS x(e, i);

  INSERT INTO majordhome.chantier_pv AS pv (chantier_id, org_id, gabarit, points_entreprise, observation, prepare_at, prepare_par)
  VALUES (p_chantier_id, v_chantier.org_id, p_gabarit, v_points, v_observation, now(), p_user)
  ON CONFLICT (chantier_id) DO UPDATE
    SET gabarit = EXCLUDED.gabarit,
        points_entreprise = EXCLUDED.points_entreprise,
        observation = EXCLUDED.observation,
        prepare_at = EXCLUDED.prepare_at,
        prepare_par = EXCLUDED.prepare_par,
        updated_at = now()
  RETURNING pv.prepare_at INTO v_at;

  RETURN jsonb_build_object('ok', true, 'prepare_at', v_at);
END;
$$;

REVOKE ALL ON FUNCTION public.chantier_pv_preparer(uuid, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chantier_pv_preparer(uuid, text, jsonb, uuid, text) TO service_role;

-- ───────────────────────── Contexte lu par l'edge : l'observation en plus ─────────────────────────

CREATE OR REPLACE FUNCTION public.chantier_pv_contexte(p_chantier_id uuid, p_marquer_ouverture boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_marquer_ouverture IS TRUE THEN
    UPDATE majordhome.chantier_pv
       SET opened_at = now(), updated_at = now()
     WHERE chantier_id = p_chantier_id AND opened_at IS NULL;
  END IF;

  SELECT jsonb_build_object(
    'chantier_id', c.id,
    'org_id', c.org_id,
    'statut', c.chantier_status,
    'libelle', c.label,
    'equipement', pet.label,
    'gabarit_type', pet.reception_profile,
    'pv_archive', c.pv_reception_path IS NOT NULL,
    'client', jsonb_build_object(
      'id', l.client_id,
      'lead_id', l.id,
      'prenom', l.first_name,
      'nom', l.last_name,
      'email', COALESCE(NULLIF(btrim(l.email), ''), NULLIF(btrim(cl.email), '')),
      'adresse', l.address,
      'code_postal', l.postal_code,
      'ville', l.city
    ),
    'poses', COALESCE((
      SELECT jsonb_agg(d ORDER BY d)
        FROM (SELECT DISTINCT a.scheduled_date AS d
                FROM majordhome.appointments a
               WHERE a.chantier_id = c.id AND a.appointment_type = 'installation'
                 AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])) jours
    ), '[]'::jsonb),
    'devis', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('libelle', q.quote_label, 'date', q.quote_date)
                       ORDER BY q.quote_date, q.pennylane_quote_id)
        FROM majordhome.lead_pennylane_quotes q
       WHERE q.chantier_id = c.id AND q.ejected_at IS NULL
         AND majordhome.quote_status_bucket(q.quote_status) = 'validated'
    ), '[]'::jsonb),
    'settings', COALESCE(o.settings, '{}'::jsonb),
    'pv', CASE WHEN pv.chantier_id IS NULL THEN NULL ELSE jsonb_build_object(
      'sent_at', pv.sent_at, 'sent_to', pv.sent_to, 'sent_count', pv.sent_count,
      'opened_at', pv.opened_at, 'signed_at', pv.signed_at,
      'signataire_nom', pv.signataire_nom, 'signature_png', pv.signature_png,
      'reception_type', pv.reception_type,
      'reserves_nature', pv.reserves_nature, 'reserves_travaux', pv.reserves_travaux,
      'info_recues', pv.info_recues, 'notices_recues', pv.notices_recues, 'entretien_recues', pv.entretien_recues,
      'gabarit', pv.gabarit, 'points_entreprise', pv.points_entreprise, 'observation', pv.observation,
      'prepare_at', pv.prepare_at, 'prepare_par', pv.prepare_par,
      'devis', pv.devis, 'points_client', pv.points_client,
      'reserves_reponse', pv.reserves_reponse, 'reserves_echeance', pv.reserves_echeance,
      'reserves_repondu_at', pv.reserves_repondu_at, 'reserves_repondu_par', pv.reserves_repondu_par,
      'levee_demandee_at', pv.levee_demandee_at, 'levee_sent_to', pv.levee_sent_to,
      'levee_sent_count', pv.levee_sent_count,
      'levee_signed_at', pv.levee_signed_at, 'levee_signataire_nom', pv.levee_signataire_nom,
      'levee_signature_png', pv.levee_signature_png
    ) END
  )
  INTO v
  FROM majordhome.chantiers c
  JOIN majordhome.leads l ON l.id = c.lead_id AND l.is_deleted = false
  JOIN core.organizations o ON o.id = c.org_id
  LEFT JOIN majordhome.clients cl ON cl.id = l.client_id
  LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = c.equipment_type_id
  LEFT JOIN majordhome.chantier_pv pv ON pv.chantier_id = c.id
  WHERE c.id = p_chantier_id;

  RETURN v;
END;
$$;

-- ───────────────────────── Vue lue par le bureau : `observation` en FIN de liste ─────────────────────────

CREATE OR REPLACE VIEW public.majordhome_chantier_pv WITH (security_invoker = true) AS
SELECT chantier_id, org_id, sent_at, sent_to, sent_by, sent_count, opened_at, signed_at, signataire_nom,
       signature_png, reception_type, reserves_nature, reserves_travaux, info_recues, notices_recues,
       entretien_recues, created_at, updated_at, gabarit, points_entreprise, prepare_at, prepare_par, devis,
       points_client, reserves_reponse, reserves_echeance, reserves_repondu_at, reserves_repondu_par,
       levee_demandee_at, levee_sent_to, levee_sent_count, levee_signed_at, levee_signataire_nom,
       levee_signature_png, observation
  FROM majordhome.chantier_pv pv;

REVOKE ALL ON public.majordhome_chantier_pv FROM PUBLIC, anon;
