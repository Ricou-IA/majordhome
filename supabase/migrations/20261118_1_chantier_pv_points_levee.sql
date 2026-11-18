-- PV de réception complété : déclaration de l'entreprise, points confirmés par le client, devis
-- photographiés à la signature, réponse aux réserves, levée des réserves signée en ligne, gabarit
-- de points par type d'équipement, et réparation du dossier Storage `interventions`.
-- Spec : docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md
-- Prolonge 20261117_3_chantier_pv_en_ligne.sql (table, trigger, trois RPC, vues).
--
-- Comme le 17 : l'application n'écrit jamais dans `chantier_pv`. Toute écriture passe par des RPC
-- SECURITY DEFINER réservées à `service_role` (l'edge `chantier-pv`), qui rendent leurs refus
-- métier en `{ ok:false, code }` (jamais un RAISE : l'edge doit pouvoir dire ce qui ne va pas).
-- `chantier_pv` est vide en production au moment de cette migration (relevé du 2026-11-18).

-- ───────────────────────── Gabarit de réception par type d'équipement ─────────────────────────

ALTER TABLE majordhome.pricing_equipment_types
  ADD COLUMN reception_profile text NOT NULL DEFAULT 'generique';

ALTER TABLE majordhome.pricing_equipment_types
  ADD CONSTRAINT pricing_equipment_types_reception_profile_check
  CHECK (reception_profile IN ('poele_granules', 'poele_buches', 'pac_air_air', 'pac_air_eau', 'chauffe_eau', 'generique'));

COMMENT ON COLUMN majordhome.pricing_equipment_types.reception_profile IS
  'Gabarit des points du PV de réception (src/lib/pvPoints.js). Éditable dans Paramètres → Équipements → Types.';

-- Valeur de départ, pour toutes les organisations, d'après le code du type, le code de sa
-- catégorie et le profil de certificat de la catégorie (jamais d'après un identifiant d'org).
-- Ordre des cas = ordre de priorité :
--   * chaudière (code du type ou de la catégorie) : pas de gabarit chaudière ⇒ générique ;
--   * « hydro » : poêle hydro, bûches OU granulés, ambigu ⇒ générique (se règle dans les paramètres) ;
--   * combustion bois + « granul » ⇒ poêle à granulés ; + bois / bûche / insert ⇒ poêle à bûches ;
--   * profil PAC + « air_eau » ⇒ PAC air/eau ; + air_air / gainable / clim / split ⇒ PAC air/air
--     (une PAC d'un autre genre, géothermie par exemple, reste générique) ;
--   * profil ECS thermodynamique ⇒ chauffe-eau ;
--   * tout le reste ⇒ générique (valeur par défaut de la colonne).
-- Résultat attendu sur la production du 2026-11-18 (vérifié par assert-chantier-pv-points.sql) :
--   poele_granules_elec → poele_granules · poele_bois_insert → poele_buches · poele_hydro → generique
--   pac_air_air, gainable → pac_air_air · pac_air_eau → pac_air_eau
--   ballon_thermo, chauffe_eau_solaire → chauffe_eau
--   chaudiere_bois, chaudiere_granules, irve, panneau_photovoltaique, prestation_diverses, TRAV_ELEC → generique
UPDATE majordhome.pricing_equipment_types t
   SET reception_profile = CASE
         WHEN t.code ~* 'chaudi' OR c.code ~* 'chaudi'                                   THEN 'generique'
         WHEN t.code ~* 'hydro'                                                          THEN 'generique'
         WHEN c.certificate_profile = 'combustion_bois' AND t.code ~* 'granul'           THEN 'poele_granules'
         WHEN c.certificate_profile = 'combustion_bois' AND t.code ~* '(bois|buche|insert)' THEN 'poele_buches'
         WHEN c.certificate_profile = 'pac' AND (t.code ~* 'air_?eau' OR c.code ~* 'air_?eau') THEN 'pac_air_eau'
         WHEN c.certificate_profile = 'pac'
              AND (t.code ~* '(air_?air|gainable|clim|split)' OR c.code ~* '(air_?air|clim)') THEN 'pac_air_air'
         WHEN c.certificate_profile = 'ecs_thermo'                                       THEN 'chauffe_eau'
         ELSE 'generique'
       END
  FROM majordhome.equipment_categories c
 WHERE c.id = t.category_id AND c.org_id = t.org_id;

-- Vue recréée depuis sa définition de PRODUCTION (qui porte encore `equipment_category`, retirée
-- seulement par la contraction 20260920_1, non appliquée). `reception_profile` en FIN de liste
-- (CREATE OR REPLACE VIEW n'autorise l'ajout qu'en fin) ; security_invoker répété (un REPLACE sans
-- WITH l'efface). Le REPLACE conserve l'ACL (authenticated, service_role).
CREATE OR REPLACE VIEW public.majordhome_pricing_equipment_types WITH (security_invoker = true) AS
SELECT id, org_id, code, label, category, equipment_category, has_unit_pricing, unit_label,
       included_units, sort_order, is_active, created_at, updated_at, duration_base_minutes,
       duration_per_extra_unit_minutes, unfavorable_months, category_id, reception_profile
  FROM majordhome.pricing_equipment_types;

REVOKE ALL ON public.majordhome_pricing_equipment_types FROM PUBLIC, anon;

-- ───────────────────────── Colonnes du PV et du chantier ─────────────────────────

ALTER TABLE majordhome.chantier_pv
  -- préparation par l'entreprise (reprise possible tant que le client n'a pas signé)
  ADD COLUMN gabarit               text,
  ADD COLUMN points_entreprise     jsonb,   -- [{ cle, texte, reponse }]
  ADD COLUMN prepare_at            timestamptz,
  ADD COLUMN prepare_par           uuid,
  -- photographiés à la signature du client
  ADD COLUMN devis                 jsonb,   -- [{ libelle, date }]
  ADD COLUMN points_client         jsonb,   -- [{ cle, texte, confirme }]
  -- réponse de l'entreprise aux réserves
  ADD COLUMN reserves_reponse      text,
  ADD COLUMN reserves_echeance     date,
  ADD COLUMN reserves_repondu_at   timestamptz,
  ADD COLUMN reserves_repondu_par  uuid,
  -- demande puis signature de la levée des réserves
  ADD COLUMN levee_demandee_at     timestamptz,
  ADD COLUMN levee_sent_to         text,
  ADD COLUMN levee_sent_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN levee_signed_at       timestamptz,
  ADD COLUMN levee_signataire_nom  text,
  ADD COLUMN levee_signature_png   text;

-- Une levée n'existe que sur une réception avec réserves déjà signée, avec un nom et une image.
ALTER TABLE majordhome.chantier_pv
  ADD CONSTRAINT chantier_pv_levee_complete CHECK (
    levee_signed_at IS NULL
    OR (signed_at IS NOT NULL AND reception_type = 'avec_reserves'
        AND levee_signataire_nom IS NOT NULL AND levee_signature_png IS NOT NULL)
  );

COMMENT ON COLUMN majordhome.chantier_pv.info_recues IS
  'Ancienne case du 17 (avant les points du client). Plus écrite par la signature en ligne depuis 20261118_1.';

-- Table existante : le REVOKE du 17 vaut toujours (les colonnes ajoutées héritent de l'ACL de la
-- table). Filet rejoué pour le rôle de lecture de l'app voisine.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN
    REVOKE ALL ON majordhome.chantier_pv FROM baikal_reader;
  END IF;
END $$;

-- Chemin du PDF de levée des réserves archivé (`${orgId}/pv-levee/${chantierId}/…`).
ALTER TABLE majordhome.chantiers ADD COLUMN pv_levee_path text;

-- ───────────────────────── Trigger : ce qui est signé est figé ─────────────────────────

-- Après la signature du client : en plus du 17, le gabarit, la déclaration de l'entreprise, les
-- points du client et la photo des devis. Après la signature de la levée : la levée elle-même et
-- la réponse aux réserves qu'elle a constatée.
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

-- ───────────────────────── RPC (service_role seul) ─────────────────────────

-- Contexte étendu (signature inchangée) : en plus du 17, `gabarit_type` (gabarit du type du
-- chantier, null sans type), `devis` (devis validés non éjectés du chantier, par date ; [] sans
-- devis) et, dans `pv`, toutes les colonnes de préparation, réponse et levée.
-- « Devis validé » = majordhome.quote_status_bucket(), jamais une liste de statuts recopiée.
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
      'gabarit', pv.gabarit, 'points_entreprise', pv.points_entreprise,
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

-- Préparation par le bureau : gabarit retenu et déclaration de l'entreprise, point par point.
-- La base ne vérifie que la FORME (tableau non vide, chaque point avec une clé, un texte et une
-- réponse oui | non | sans_objet) : c'est l'edge qui reconstruit les textes depuis pvPoints.js
-- d'après les clés et refuse une clé étrangère au gabarit. Seuls cle / texte / reponse sont gardés.
-- Reprise permise tant que le client n'a pas signé (le client lit toujours la dernière version).
CREATE FUNCTION public.chantier_pv_preparer(p_chantier_id uuid, p_gabarit text, p_points jsonb, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_chantier majordhome.chantiers;
  v_points   jsonb;
  v_at       timestamptz;
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

  SELECT jsonb_agg(jsonb_build_object('cle', btrim(e->>'cle'), 'texte', btrim(e->>'texte'), 'reponse', e->>'reponse') ORDER BY i)
    INTO v_points
    FROM jsonb_array_elements(p_points) WITH ORDINALITY AS x(e, i);

  INSERT INTO majordhome.chantier_pv AS pv (chantier_id, org_id, gabarit, points_entreprise, prepare_at, prepare_par)
  VALUES (p_chantier_id, v_chantier.org_id, p_gabarit, v_points, now(), p_user)
  ON CONFLICT (chantier_id) DO UPDATE
    SET gabarit = EXCLUDED.gabarit,
        points_entreprise = EXCLUDED.points_entreprise,
        prepare_at = EXCLUDED.prepare_at,
        prepare_par = EXCLUDED.prepare_par,
        updated_at = now()
  RETURNING pv.prepare_at INTO v_at;

  RETURN jsonb_build_object('ok', true, 'prepare_at', v_at);
END;
$$;

-- Signature du client (signature inchangée). Nouveau : refus `pv_non_prepare` tant que
-- l'entreprise n'a pas déclaré ; enregistre les points du client (`points_client`, absent ⇒ []) et
-- photographie les devis validés du chantier. N'écrit plus les trois booléens du 17.
CREATE OR REPLACE FUNCTION public.chantier_pv_signer(p_chantier_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_chantier  majordhome.chantiers;
  v_pv        majordhome.chantier_pv;
  v_type      text := p_payload->>'reception_type';
  v_nom       text := btrim(COALESCE(p_payload->>'signataire_nom', ''));
  v_signature text := COALESCE(p_payload->>'signature_png', '');
  v_nature    text := NULLIF(btrim(COALESCE(p_payload->>'reserves_nature', '')), '');
  v_travaux   text := NULLIF(btrim(COALESCE(p_payload->>'reserves_travaux', '')), '');
  v_client    jsonb;
  v_devis     jsonb;
  v_passe     boolean := false;
BEGIN
  SELECT * INTO v_chantier FROM majordhome.chantiers c WHERE c.id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  SELECT * INTO v_pv FROM majordhome.chantier_pv pv WHERE pv.chantier_id = p_chantier_id FOR UPDATE;

  IF v_chantier.pv_reception_path IS NOT NULL OR v_pv.signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deja_signe');
  END IF;

  -- Garde positive : sans ligne, v_pv.points_entreprise est NULL ⇒ refus.
  IF (v_pv.points_entreprise IS NOT NULL) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pv_non_prepare');
  END IF;

  IF v_type IS NULL OR v_type NOT IN ('sans_reserves', 'avec_reserves') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'choix_requis');
  END IF;
  IF v_nom = '' OR length(v_nom) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'nom_requis');
  END IF;
  IF v_signature NOT LIKE 'data:image/png;base64,%' OR length(v_signature) < 200 OR length(v_signature) > 400000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'signature_requise');
  END IF;
  IF v_type = 'avec_reserves' AND v_nature IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'reserves_a_decrire');
  END IF;
  IF length(COALESCE(v_nature, '')) > 2000 OR length(COALESCE(v_travaux, '')) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'texte_trop_long');
  END IF;

  -- Points du client : seuls les objets sont gardés, réduits à cle / texte / confirme (booléen,
  -- vrai seulement si le client a coché). L'edge en est l'autorité (textes repris du module).
  IF jsonb_typeof(p_payload->'points_client') = 'array' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cle', e->>'cle', 'texte', e->>'texte',
             'confirme', COALESCE(e->'confirme' = 'true'::jsonb, false)) ORDER BY i), '[]'::jsonb)
      INTO v_client
      FROM jsonb_array_elements(p_payload->'points_client') WITH ORDINALITY AS x(e, i)
     WHERE jsonb_typeof(e) = 'object';
  ELSE
    v_client := '[]'::jsonb;
  END IF;

  -- Photo des devis validés au moment de la signature (même lecture que le contexte).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('libelle', q.quote_label, 'date', q.quote_date)
                            ORDER BY q.quote_date, q.pennylane_quote_id), '[]'::jsonb)
    INTO v_devis
    FROM majordhome.lead_pennylane_quotes q
   WHERE q.chantier_id = p_chantier_id AND q.ejected_at IS NULL
     AND majordhome.quote_status_bucket(q.quote_status) = 'validated';

  UPDATE majordhome.chantier_pv
     SET signed_at = now(),
         signataire_nom = v_nom,
         signature_png = v_signature,
         reception_type = v_type,
         reserves_nature = CASE WHEN v_type = 'avec_reserves' THEN v_nature END,
         reserves_travaux = CASE WHEN v_type = 'avec_reserves' THEN v_travaux END,
         points_client = v_client,
         devis = v_devis,
         updated_at = now()
   WHERE chantier_id = p_chantier_id;

  IF v_chantier.chantier_status = 'planification' THEN
    UPDATE majordhome.chantiers
       SET chantier_status = 'realise', updated_at = now()
     WHERE id = p_chantier_id;
    v_passe := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'passe_en_receptionne', v_passe,
    'avec_reserves', v_type = 'avec_reserves'
  );
END;
$$;

-- Réponse de l'entreprise aux réserves : ce qu'elle va faire et/ou la date d'engagement. Chacun
-- est facultatif, il en faut au moins un ; chaque enregistrement remplace les deux. La date ne
-- précède pas le jour de la signature (jour calendaire à Paris) ; une date passée est admise (on
-- consigne une reprise déjà faite). Modifiable tant que la levée n'est pas signée.
CREATE FUNCTION public.chantier_pv_repondre_reserves(p_chantier_id uuid, p_reponse text, p_echeance date, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_pv      majordhome.chantier_pv;
  v_reponse text := NULLIF(btrim(COALESCE(p_reponse, '')), '');
  v_at      timestamptz;
BEGIN
  PERFORM 1 FROM majordhome.chantiers c WHERE c.id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  SELECT * INTO v_pv FROM majordhome.chantier_pv pv WHERE pv.chantier_id = p_chantier_id FOR UPDATE;
  IF (v_pv.signed_at IS NOT NULL AND v_pv.reception_type = 'avec_reserves') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pas_de_reserves');
  END IF;
  IF v_pv.levee_signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'levee_deja_signee');
  END IF;
  IF v_reponse IS NULL AND p_echeance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'reponse_vide');
  END IF;
  IF length(COALESCE(v_reponse, '')) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'texte_trop_long');
  END IF;
  IF p_echeance IS NOT NULL AND p_echeance < (v_pv.signed_at AT TIME ZONE 'Europe/Paris')::date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'echeance_invalide');
  END IF;

  UPDATE majordhome.chantier_pv
     SET reserves_reponse = v_reponse,
         reserves_echeance = p_echeance,
         reserves_repondu_at = now(),
         reserves_repondu_par = p_user,
         updated_at = now()
   WHERE chantier_id = p_chantier_id
  RETURNING reserves_repondu_at INTO v_at;

  RETURN jsonb_build_object('ok', true, 'repondu_at', v_at);
END;
$$;

-- Demande de levée des réserves (e-mail parti, ou lien copié). `levee_demandee_at` = première
-- demande, jamais déplacée. Un destinataire non vide compte un envoi ; « Copier le lien » (sans
-- destinataire) note la demande sans compter d'envoi. `p_user` n'est pas stocké : la table n'a
-- pas de colonne pour l'auteur de la demande (le journal applicatif de l'edge le porte).
CREATE FUNCTION public.chantier_pv_marquer_levee(p_chantier_id uuid, p_sent_to text, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_pv  majordhome.chantier_pv;
  v_to  text := NULLIF(btrim(COALESCE(p_sent_to, '')), '');
  v_row majordhome.chantier_pv;
BEGIN
  PERFORM 1 FROM majordhome.chantiers c WHERE c.id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  SELECT * INTO v_pv FROM majordhome.chantier_pv pv WHERE pv.chantier_id = p_chantier_id FOR UPDATE;
  IF (v_pv.signed_at IS NOT NULL AND v_pv.reception_type = 'avec_reserves') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pas_de_reserves');
  END IF;
  IF v_pv.levee_signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'levee_deja_signee');
  END IF;

  UPDATE majordhome.chantier_pv
     SET levee_demandee_at = COALESCE(levee_demandee_at, now()),
         levee_sent_to = COALESCE(v_to, levee_sent_to),
         levee_sent_count = levee_sent_count + CASE WHEN v_to IS NOT NULL THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE chantier_id = p_chantier_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'levee_demandee_at', v_row.levee_demandee_at, 'levee_sent_count', v_row.levee_sent_count);
END;
$$;

-- Signature de la levée par le client : « je constate que les réserves sont levées ». Exige une
-- demande de levée ; mêmes bornes de nom et d'image que la signature du PV.
CREATE FUNCTION public.chantier_pv_signer_levee(p_chantier_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_pv        majordhome.chantier_pv;
  v_nom       text := btrim(COALESCE(p_payload->>'signataire_nom', ''));
  v_signature text := COALESCE(p_payload->>'signature_png', '');
BEGIN
  PERFORM 1 FROM majordhome.chantiers c WHERE c.id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  SELECT * INTO v_pv FROM majordhome.chantier_pv pv WHERE pv.chantier_id = p_chantier_id FOR UPDATE;
  IF (v_pv.signed_at IS NOT NULL AND v_pv.reception_type = 'avec_reserves') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'pas_de_reserves');
  END IF;
  IF v_pv.levee_signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'levee_deja_signee');
  END IF;
  IF (v_pv.levee_demandee_at IS NOT NULL) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'levee_non_demandee');
  END IF;
  IF v_nom = '' OR length(v_nom) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'nom_requis');
  END IF;
  IF v_signature NOT LIKE 'data:image/png;base64,%' OR length(v_signature) < 200 OR length(v_signature) > 400000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'signature_requise');
  END IF;

  UPDATE majordhome.chantier_pv
     SET levee_signed_at = now(),
         levee_signataire_nom = v_nom,
         levee_signature_png = v_signature,
         updated_at = now()
   WHERE chantier_id = p_chantier_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Charte : PUBLIC est obligatoire dans le REVOKE (sinon anon garde EXECUTE par héritage). Rejoué
-- aussi pour les deux fonctions remplacées (le REPLACE conserve l'ACL ; filet).
REVOKE ALL ON FUNCTION public.chantier_pv_contexte(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chantier_pv_signer(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chantier_pv_preparer(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chantier_pv_repondre_reserves(uuid, text, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chantier_pv_marquer_levee(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chantier_pv_signer_levee(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chantier_pv_contexte(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.chantier_pv_signer(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.chantier_pv_preparer(uuid, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chantier_pv_repondre_reserves(uuid, text, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chantier_pv_marquer_levee(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chantier_pv_signer_levee(uuid, jsonb) TO service_role;

-- ───────────────────────── Vues ─────────────────────────

-- Lecture du PV par le bureau : nouvelles colonnes en FIN de liste.
CREATE OR REPLACE VIEW public.majordhome_chantier_pv WITH (security_invoker = true) AS
SELECT pv.chantier_id, pv.org_id, pv.sent_at, pv.sent_to, pv.sent_by, pv.sent_count, pv.opened_at,
       pv.signed_at, pv.signataire_nom, pv.signature_png, pv.reception_type,
       pv.reserves_nature, pv.reserves_travaux, pv.info_recues, pv.notices_recues, pv.entretien_recues,
       pv.created_at, pv.updated_at,
       pv.gabarit, pv.points_entreprise, pv.prepare_at, pv.prepare_par,
       pv.devis, pv.points_client,
       pv.reserves_reponse, pv.reserves_echeance, pv.reserves_repondu_at, pv.reserves_repondu_par,
       pv.levee_demandee_at, pv.levee_sent_to, pv.levee_sent_count,
       pv.levee_signed_at, pv.levee_signataire_nom, pv.levee_signature_png
  FROM majordhome.chantier_pv pv;

REVOKE ALL ON public.majordhome_chantier_pv FROM PUBLIC, anon;

-- majordhome_chantiers : définition de 20261117_3 (celle de production), deux colonnes légères en
-- FIN de liste. L'image de la levée n'entre jamais dans la liste du board.
CREATE OR REPLACE VIEW public.majordhome_chantiers WITH (security_invoker = true) AS
SELECT c.id, c.org_id,
       l.first_name, l.last_name, l.company_name, l.email, l.phone, l.address, l.postal_code, l.city,
       l.order_amount_ht, l.estimated_revenue,
       c.chantier_status, c.equipment_order_status, c.materials_order_status,
       c.estimated_date, c.planification_date, c.chantier_notes, c.won_date,
       l.client_id, l.project_id, l.assigned_user_id, c.equipment_type_id, c.pv_reception_path,
       c.updated_at, c.created_at,
       pet.label    AS equipment_type_label,
       pet.category AS equipment_type_category,
       l.pennylane_quote_id,
       COALESCE(s.validated_sum, 0::numeric) AS linked_quotes_amount_ht,
       rdv.next_rdv_date,
       COALESCE(rdv.has_active_rdv, false)   AS has_active_rdv,
       COALESCE(s.validated_count, 0::bigint) AS validated_quotes_count,
       c.planned_team_size, c.planned_days,
       c.lead_id, c.label,
       COALESCE(s.quotes_count, 0::bigint)   AS quotes_count,
       COALESCE(s.validated_count > 0 AND s.invoiced_count = s.validated_count, false) AS is_invoiced,
       (SELECT count(*) FROM majordhome.chantiers c2 WHERE c2.lead_id = c.lead_id) AS lead_chantiers_count,
       COALESCE(c.realized_date, rdv.last_rdv_date) AS realized_date,
       pv.sent_at   AS pv_sent_at,
       pv.signed_at AS pv_signed_at,
       COALESCE(pv.signed_at IS NOT NULL AND pv.reception_type = 'avec_reserves', false) AS pv_avec_reserves,
       pv.levee_signed_at AS pv_reserves_levees_at,
       c.pv_levee_path
  FROM majordhome.chantiers c
  JOIN majordhome.leads l ON l.id = c.lead_id AND l.is_deleted = false
  LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = c.equipment_type_id
  LEFT JOIN majordhome.chantier_quote_stats s ON s.chantier_id = c.id
  LEFT JOIN majordhome.chantier_pv pv ON pv.chantier_id = c.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(min(a.scheduled_date) FILTER (WHERE a.scheduled_date >= CURRENT_DATE),
                    min(a.scheduled_date)) AS next_rdv_date,
           max(a.scheduled_date) AS last_rdv_date,
           bool_or(true) AS has_active_rdv
      FROM majordhome.appointments a
     WHERE a.chantier_id = c.id AND a.appointment_type = 'installation'
       AND a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text])
  ) rdv ON true;

REVOKE ALL ON public.majordhome_chantiers FROM PUBLIC, anon;

-- Miroir d'écriture : définition de production, `pv_levee_path` en fin. Reste un miroir simple
-- (auto-updatable) : jamais de JOIN ici.
CREATE OR REPLACE VIEW public.majordhome_chantiers_write WITH (security_invoker = true) AS
SELECT id, org_id, lead_id, client_id, label, chantier_status, equipment_order_status,
       materials_order_status, estimated_date, planification_date, won_date, chantier_notes,
       pv_reception_path, planned_team_size, planned_days, equipment_type_id, sort_order,
       created_at, updated_at, realized_date, pv_levee_path
  FROM majordhome.chantiers;

REVOKE ALL ON public.majordhome_chantiers_write FROM PUBLIC, anon;

-- ───────────────────────── Storage : dossier `interventions` ─────────────────────────

-- Les quatre règles d'origine ne sont jamais vraies (relevé du 2026-11-18) : ni le PV sur
-- tablette ni le PV en ligne ne peuvent être archivés. Remplacées par le motif de la charte, celui
-- de `certificats` (20260827_1) : premier segment du chemin = organisation dont l'appelant est
-- membre. Chemins : `${orgId}/pv-reception/${chantierId}/…`, `${orgId}/pv-levee/${chantierId}/…`.
-- Le dossier est vide : rien à déplacer.
DROP POLICY IF EXISTS org_members_select_interventions ON storage.objects;
DROP POLICY IF EXISTS org_members_insert_interventions ON storage.objects;
DROP POLICY IF EXISTS org_members_update_interventions ON storage.objects;
DROP POLICY IF EXISTS org_members_delete_interventions ON storage.objects;

DROP POLICY IF EXISTS interventions_org_select ON storage.objects;
CREATE POLICY interventions_org_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'interventions'
  AND ((storage.foldername(name))[1])::uuid IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS interventions_org_insert ON storage.objects;
CREATE POLICY interventions_org_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'interventions'
  AND ((storage.foldername(name))[1])::uuid IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS interventions_org_update ON storage.objects;
CREATE POLICY interventions_org_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'interventions'
  AND ((storage.foldername(name))[1])::uuid IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'interventions'
  AND ((storage.foldername(name))[1])::uuid IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS interventions_org_delete ON storage.objects;
CREATE POLICY interventions_org_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'interventions'
  AND ((storage.foldername(name))[1])::uuid IN (
    SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()
  )
);
