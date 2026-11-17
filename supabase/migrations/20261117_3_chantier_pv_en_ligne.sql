-- PV de réception signé en ligne par le client.
-- Spec : docs/superpowers/specs/2026-11-17-chantier-apres-vente-pv-en-ligne-design.md
--
-- Constat (2026-11-17) : aucun des 67 chantiers réceptionnés n'a de PV — la signature sur
-- tablette n'est presque jamais faite sur place. Le bureau envoie désormais un lien au client,
-- qui signe sur son téléphone (page sans compte, edge `chantier-pv`).
--
-- La réponse du client (choix, réserves, nom, image de la signature) est LA donnée de référence ;
-- le PDF en est un rendu, produit à la demande. L'application n'écrit jamais dans la table :
-- trois RPC réservées à `service_role` (l'edge), appelées après vérification du jeton du lien.

-- ───────────────────────── Table ─────────────────────────

CREATE TABLE majordhome.chantier_pv (
  chantier_id      uuid PRIMARY KEY REFERENCES majordhome.chantiers(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES core.organizations(id),
  -- envoi du lien
  sent_at          timestamptz,
  sent_to          text,
  sent_by          uuid,
  sent_count       integer NOT NULL DEFAULT 0,
  opened_at        timestamptz,
  -- signature du client
  signed_at        timestamptz,
  signataire_nom   text,
  signature_png    text,
  reception_type   text CHECK (reception_type IN ('sans_reserves', 'avec_reserves')),
  reserves_nature  text,
  reserves_travaux text,
  info_recues      boolean,
  notices_recues   boolean,
  entretien_recues boolean,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chantier_pv_signature_complete CHECK (
    signed_at IS NULL
    OR (signataire_nom IS NOT NULL AND signature_png IS NOT NULL AND reception_type IS NOT NULL)
  )
);

COMMENT ON TABLE majordhome.chantier_pv IS
  'PV de réception en ligne : envoi du lien et signature du client. Écrite par les seules RPC chantier_pv_* (service_role).';

ALTER TABLE majordhome.chantier_pv ENABLE ROW LEVEL SECURITY;

-- Lecture : membres de l'organisation (même règle que majordhome.chantiers). Aucune policy d'écriture.
CREATE POLICY chantier_pv_select_org_members ON majordhome.chantier_pv
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = (SELECT auth.uid())));

REVOKE ALL ON majordhome.chantier_pv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON majordhome.chantier_pv TO authenticated, service_role;

-- L'ACL par défaut du schéma ouvre les nouvelles tables au rôle de lecture d'une app voisine :
-- une image de signature n'a rien à y faire.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baikal_reader') THEN
    REVOKE ALL ON majordhome.chantier_pv FROM baikal_reader;
  END IF;
END $$;

-- Une signature ne se réécrit pas et ne se supprime pas (y compris par la cascade d'un chantier
-- supprimé : la suppression du chantier est alors refusée).
CREATE FUNCTION majordhome.chantier_pv_signature_figee() RETURNS trigger
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
     OR NEW.chantier_id IS DISTINCT FROM OLD.chantier_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'pv_signe' USING HINT = 'Un PV de réception signé ne se modifie pas.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chantier_pv_signature_figee
  BEFORE UPDATE OR DELETE ON majordhome.chantier_pv
  FOR EACH ROW EXECUTE FUNCTION majordhome.chantier_pv_signature_figee();

-- ───────────────────────── RPC (service_role seul) ─────────────────────────

-- Tout ce dont l'edge a besoin pour un chantier : identité, objet, client, jours de pose, réglages
-- de l'organisation, état du PV. NULL si le chantier n'existe pas (ou si son lead est supprimé).
-- `p_marquer_ouverture` : note la première ouverture du lien par le client.
CREATE FUNCTION public.chantier_pv_contexte(p_chantier_id uuid, p_marquer_ouverture boolean DEFAULT false)
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
    'settings', COALESCE(o.settings, '{}'::jsonb),
    'pv', CASE WHEN pv.chantier_id IS NULL THEN NULL ELSE jsonb_build_object(
      'sent_at', pv.sent_at, 'sent_to', pv.sent_to, 'sent_count', pv.sent_count,
      'opened_at', pv.opened_at, 'signed_at', pv.signed_at,
      'signataire_nom', pv.signataire_nom, 'signature_png', pv.signature_png,
      'reception_type', pv.reception_type,
      'reserves_nature', pv.reserves_nature, 'reserves_travaux', pv.reserves_travaux,
      'info_recues', pv.info_recues, 'notices_recues', pv.notices_recues, 'entretien_recues', pv.entretien_recues
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

-- Note un envoi du lien au client (e-mail parti). Crée la ligne au premier envoi.
CREATE FUNCTION public.chantier_pv_marquer_envoi(p_chantier_id uuid, p_sent_to text, p_sent_by uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_org uuid;
  v_row majordhome.chantier_pv;
BEGIN
  SELECT c.org_id INTO v_org FROM majordhome.chantiers c WHERE c.id = p_chantier_id;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  INSERT INTO majordhome.chantier_pv AS pv (chantier_id, org_id, sent_at, sent_to, sent_by, sent_count)
  VALUES (p_chantier_id, v_org, now(), NULLIF(btrim(p_sent_to), ''), p_sent_by, 1)
  ON CONFLICT (chantier_id) DO UPDATE
    SET sent_at = now(),
        sent_to = EXCLUDED.sent_to,
        sent_by = EXCLUDED.sent_by,
        sent_count = pv.sent_count + 1,
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'sent_at', v_row.sent_at, 'sent_count', v_row.sent_count);
END;
$$;

-- Enregistre la signature du client. Refus métier = retour { ok:false, code } (jamais un RAISE :
-- l'edge doit pouvoir dire au client ce qui ne va pas). Un chantier Planifié passe en Réceptionné
-- (le trigger chantiers_freeze_realized_date fige alors la date de réalisation) ; un PV avec
-- réserves est une réception comme une autre.
CREATE FUNCTION public.chantier_pv_signer(p_chantier_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE
  v_chantier  majordhome.chantiers;
  v_type      text := p_payload->>'reception_type';
  v_nom       text := btrim(COALESCE(p_payload->>'signataire_nom', ''));
  v_signature text := COALESCE(p_payload->>'signature_png', '');
  v_nature    text := NULLIF(btrim(COALESCE(p_payload->>'reserves_nature', '')), '');
  v_travaux   text := NULLIF(btrim(COALESCE(p_payload->>'reserves_travaux', '')), '');
  v_passe     boolean := false;
BEGIN
  SELECT * INTO v_chantier FROM majordhome.chantiers c WHERE c.id = p_chantier_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'chantier_introuvable');
  END IF;

  IF v_chantier.pv_reception_path IS NOT NULL
     OR EXISTS (SELECT 1 FROM majordhome.chantier_pv pv WHERE pv.chantier_id = p_chantier_id AND pv.signed_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deja_signe');
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

  INSERT INTO majordhome.chantier_pv AS pv (
    chantier_id, org_id, signed_at, signataire_nom, signature_png, reception_type,
    reserves_nature, reserves_travaux, info_recues, notices_recues, entretien_recues
  ) VALUES (
    p_chantier_id, v_chantier.org_id, now(), v_nom, v_signature, v_type,
    CASE WHEN v_type = 'avec_reserves' THEN v_nature END,
    CASE WHEN v_type = 'avec_reserves' THEN v_travaux END,
    COALESCE((p_payload->>'info_recues')::boolean, false),
    COALESCE((p_payload->>'notices_recues')::boolean, false),
    COALESCE((p_payload->>'entretien_recues')::boolean, false)
  )
  ON CONFLICT (chantier_id) DO UPDATE
    SET signed_at = EXCLUDED.signed_at,
        signataire_nom = EXCLUDED.signataire_nom,
        signature_png = EXCLUDED.signature_png,
        reception_type = EXCLUDED.reception_type,
        reserves_nature = EXCLUDED.reserves_nature,
        reserves_travaux = EXCLUDED.reserves_travaux,
        info_recues = EXCLUDED.info_recues,
        notices_recues = EXCLUDED.notices_recues,
        entretien_recues = EXCLUDED.entretien_recues,
        updated_at = now();

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

-- Charte : PUBLIC est obligatoire dans le REVOKE (sinon anon garde EXECUTE par héritage).
REVOKE ALL ON FUNCTION public.chantier_pv_contexte(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chantier_pv_marquer_envoi(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chantier_pv_signer(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chantier_pv_contexte(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.chantier_pv_marquer_envoi(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.chantier_pv_signer(uuid, jsonb) TO service_role;

-- ───────────────────────── Vues ─────────────────────────

-- Lecture du PV par le bureau (produire le PDF depuis l'enregistrement).
CREATE VIEW public.majordhome_chantier_pv WITH (security_invoker = true) AS
SELECT pv.chantier_id, pv.org_id, pv.sent_at, pv.sent_to, pv.sent_by, pv.sent_count, pv.opened_at,
       pv.signed_at, pv.signataire_nom, pv.signature_png, pv.reception_type,
       pv.reserves_nature, pv.reserves_travaux, pv.info_recues, pv.notices_recues, pv.entretien_recues,
       pv.created_at, pv.updated_at
  FROM majordhome.chantier_pv pv;

REVOKE ALL ON public.majordhome_chantier_pv FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.majordhome_chantier_pv TO authenticated, service_role;

-- majordhome_chantiers : trois colonnes légères en FIN de liste (CREATE OR REPLACE VIEW n'autorise
-- l'ajout qu'en fin). L'image de la signature n'entre jamais dans la liste du board.
-- security_invoker répété : un REPLACE sans WITH efface l'option.
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
       COALESCE(pv.signed_at IS NOT NULL AND pv.reception_type = 'avec_reserves', false) AS pv_avec_reserves
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

-- Charte : aucune vue majordhome_* ouverte à anon (le REPLACE conserve l'ACL ; filet).
REVOKE ALL ON public.majordhome_chantiers FROM PUBLIC, anon;
