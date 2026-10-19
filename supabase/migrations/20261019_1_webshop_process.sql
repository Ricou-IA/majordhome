-- ============================================================================
-- 20261019_1_webshop_process.sql — Webshop étape 2 : journal des actions du process et
-- événements de tournée (spec docs/superpowers/specs/2026-10-17-webshop-parametrage-livraison-process-design.md).
--
--   1. majordhome.webshop_order_actions : une ligne par action (e-mail client, ordre colis)
--      déclenchée pour une commande, un envoi (colis | palette) et un événement. Statut
--      sent | failed | skipped. Index unique partiel : une action `sent` pour
--      (commande, envoi, événement, action) ne repart JAMAIS (aller-retour de carte, double
--      clic, tournée marquée deux fois). Écrit UNIQUEMENT par l'edge (service_role) via
--      webshop_order_action_record ; lu par les membres de l'org via la vue publique.
--   2. webshop_delivery_slots.departed_at / delivered_at + RPC webshop_slot_mark_event
--      (team_leader+, garde webshop_slot_guard) : « tournée partie » / « tournée livrée ».
--      Pas de nouveau statut : livrée ⇒ status = 'shipped'.
--   3. Défauts SQL régénérés (clé `process`).
-- Org des tables webshop = org CORE.
-- Répétée sur scripts/migration-rehearsal/ (assert-webshop-process.sql).
-- ============================================================================

-- ---------- 1. Journal des actions -------------------------------------------
CREATE TABLE IF NOT EXISTS majordhome.webshop_order_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES core.organizations(id),
  order_id      uuid NOT NULL REFERENCES majordhome.webshop_orders(id) ON DELETE CASCADE,
  -- NOT NULL : fait partie de la clé d'unicité (un NULL la rendrait inopérante).
  envoi         text NOT NULL CHECK (envoi IN ('colis', 'palette')),
  evenement     text NOT NULL CHECK (evenement IN ('confirmee', 'transmise_fournisseur', 'expediee', 'livree',
                                                   'tournee_partie', 'tournee_livree')),
  action        text NOT NULL CHECK (action IN ('email_client', 'ordre_colis')),
  gabarit       text,
  status        text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error_code    text,
  error_message text,
  recipient     text,
  slot_id       uuid REFERENCES majordhome.webshop_delivery_slots(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS webshop_order_actions_sent_once
  ON majordhome.webshop_order_actions (order_id, envoi, evenement, action)
  WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS webshop_order_actions_org_idx ON majordhome.webshop_order_actions (org_id);

ALTER TABLE majordhome.webshop_order_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON majordhome.webshop_order_actions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON majordhome.webshop_order_actions FROM authenticated;
GRANT SELECT ON majordhome.webshop_order_actions TO authenticated, service_role;

DROP POLICY IF EXISTS webshop_order_actions_select_org_members ON majordhome.webshop_order_actions;
CREATE POLICY webshop_order_actions_select_org_members ON majordhome.webshop_order_actions
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

CREATE OR REPLACE VIEW public.majordhome_webshop_order_actions WITH (security_invoker = true) AS
SELECT id, org_id, order_id, envoi, evenement, action, gabarit, status, error_code, error_message,
       recipient, slot_id, created_at, updated_at
  FROM majordhome.webshop_order_actions;
REVOKE ALL ON public.majordhome_webshop_order_actions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.majordhome_webshop_order_actions FROM authenticated;
GRANT SELECT ON public.majordhome_webshop_order_actions TO authenticated, service_role;

-- Enregistre le résultat d'une action. service_role only (prend org_id dans le payload).
--   - commande inconnue → order_not_found ; org ≠ org de la commande → org_mismatch ;
--     tournée d'une autre org → slot_org_mismatch ;
--   - une ligne `sent` existe pour la clé → already_sent (rien n'est écrit) ;
--   - une ligne `failed` / `skipped` existe pour la clé → elle est mise à jour (rejeu) ;
--   - sinon insertion. Retourne l'id de la ligne.
CREATE OR REPLACE FUNCTION public.webshop_order_action_record(
  p_org_id uuid, p_order_id uuid, p_envoi text, p_evenement text, p_action text, p_gabarit text,
  p_status text, p_error_code text, p_error_message text, p_recipient text, p_slot_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $$
DECLARE
  v_order_org uuid;
  v_id uuid;
BEGIN
  -- Verrou sur la commande : deux enregistrements concurrents de la même commande se suivent.
  SELECT org_id INTO v_order_org FROM majordhome.webshop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF (v_order_org = p_org_id) IS NOT TRUE THEN RAISE EXCEPTION 'org_mismatch' USING ERRCODE = '42501'; END IF;
  IF p_slot_id IS NOT NULL
     AND (SELECT s.org_id = p_org_id FROM majordhome.webshop_delivery_slots s WHERE s.id = p_slot_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'slot_org_mismatch' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM majordhome.webshop_order_actions
              WHERE order_id = p_order_id AND envoi = p_envoi AND evenement = p_evenement
                AND action = p_action AND status = 'sent') THEN
    RAISE EXCEPTION 'already_sent' USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_id FROM majordhome.webshop_order_actions
   WHERE order_id = p_order_id AND envoi = p_envoi AND evenement = p_evenement
     AND action = p_action AND status IN ('failed', 'skipped')
   ORDER BY updated_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE majordhome.webshop_order_actions
       SET gabarit = p_gabarit, status = p_status, error_code = p_error_code,
           error_message = p_error_message, recipient = p_recipient, slot_id = p_slot_id,
           updated_at = now()
     WHERE id = v_id;
  ELSE
    INSERT INTO majordhome.webshop_order_actions
      (org_id, order_id, envoi, evenement, action, gabarit, status, error_code, error_message, recipient, slot_id)
    VALUES
      (p_org_id, p_order_id, p_envoi, p_evenement, p_action, p_gabarit, p_status, p_error_code, p_error_message, p_recipient, p_slot_id)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'already_sent' USING ERRCODE = '23505';
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_order_action_record(uuid, uuid, text, text, text, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webshop_order_action_record(uuid, uuid, text, text, text, text, text, text, text, text, uuid)
  TO service_role;

-- Vrai si l'action a déjà été envoyée pour (commande, envoi, événement, action). service_role only.
CREATE OR REPLACE FUNCTION public.webshop_order_action_already_sent(
  p_order_id uuid, p_envoi text, p_evenement text, p_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $$
  SELECT EXISTS (SELECT 1 FROM majordhome.webshop_order_actions
                  WHERE order_id = p_order_id AND envoi = p_envoi AND evenement = p_evenement
                    AND action = p_action AND status = 'sent');
$$;
REVOKE EXECUTE ON FUNCTION public.webshop_order_action_already_sent(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webshop_order_action_already_sent(uuid, text, text, text) TO service_role;

-- ---------- 2. Événements de tournée -----------------------------------------
ALTER TABLE majordhome.webshop_delivery_slots
  ADD COLUMN IF NOT EXISTS departed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Miroir simple (auto-updatable) : les 2 colonnes EN FIN de liste.
CREATE OR REPLACE VIEW public.majordhome_webshop_delivery_slots WITH (security_invoker = true) AS
SELECT id, org_id, sector_id, delivery_date, status, capacity_slots, capacity_stops, used_slots,
       used_stops, closed_at, close_reason, route_sheet_sent_at, km_estimated, km_actual,
       created_at, updated_at, status_note, route_sheet_request_id, route_sheet_requested_at,
       departed_at, delivered_at
  FROM majordhome.webshop_delivery_slots;

-- « partie » : tournée fermée (closed) ⇒ departed_at posé ; « livree » : tournée partie ⇒
-- delivered_at + status 'shipped'. Idempotent : un événement déjà posé renvoie first_time = false
-- sans rien vérifier d'autre (une « partie » rejouée après la livraison n'échoue pas).
-- Tournée annulée : refusée. Les actions client (e-mails palette) sont l'affaire de l'edge.
CREATE OR REPLACE FUNCTION public.webshop_slot_mark_event(p_slot_id uuid, p_event text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'majordhome', 'public', 'pg_temp'
AS $$
DECLARE
  v_slot majordhome.webshop_delivery_slots;
  v_first boolean := false;
BEGIN
  v_slot := majordhome.webshop_slot_guard(p_slot_id);

  IF p_event = 'partie' THEN
    IF v_slot.departed_at IS NULL THEN
      IF v_slot.status <> 'closed' THEN
        RAISE EXCEPTION 'slot_not_closed' USING ERRCODE = '22023', DETAIL = v_slot.status;
      END IF;
      UPDATE majordhome.webshop_delivery_slots SET departed_at = now(), updated_at = now() WHERE id = p_slot_id;
      v_first := true;
    END IF;
  ELSIF p_event = 'livree' THEN
    IF v_slot.delivered_at IS NULL THEN
      IF v_slot.departed_at IS NULL THEN
        RAISE EXCEPTION 'slot_not_departed' USING ERRCODE = '22023';
      END IF;
      IF v_slot.status = 'cancelled' THEN
        RAISE EXCEPTION 'slot_cancelled' USING ERRCODE = '22023';
      END IF;
      UPDATE majordhome.webshop_delivery_slots
         SET delivered_at = now(), status = 'shipped', updated_at = now()
       WHERE id = p_slot_id;
      v_first := true;
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023', DETAIL = p_event;
  END IF;

  RETURN jsonb_build_object('slot_id', p_slot_id, 'event', p_event, 'first_time', v_first);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_slot_mark_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_slot_mark_event(uuid, text) TO authenticated;

-- ---------- 3. Défauts (GÉNÉRÉ — ne pas éditer à la main) -------------------
-- GÉNÉRÉ par scripts/gen-webshop-reglages-sql.mjs depuis src/lib/webshop/reglages.js — ne pas éditer à la main.
CREATE OR REPLACE FUNCTION majordhome.webshop_reglages_defaut()
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $f$
  SELECT $defaut${"site_url":"","emails":{"interne":[]},"depots":[{"code":"castanet","libelle":"Dépôt Castanet-Tolosan","adresse":"Castanet-Tolosan"}],"palette":{"transporteur":{"nom":"","emails":[],"note":""},"envoi_auto":true,"heure_envoi":18,"delai_fermeture_jours":2,"horizon_semaines":12,"ancre_cycle":"2026-01-05","capacite_emplacements":10,"prix_emplacement_defaut_cents":5500,"tva_pct":10,"max_emplacements_panier":10},"colis":{"prestataire":{"nom":"","mode":"email","emails":[],"note":""},"tva_pct":20,"max_qty_ligne":20},"process":{"transitions":{"confirmee":{"email_client":null,"ordre_colis":false},"transmise_fournisseur":{"email_client":null,"ordre_colis":false},"expediee":{"email_client":"webshop_expedition_colis","ordre_colis":false},"livree":{"email_client":"webshop_livraison_colis","ordre_colis":false}},"tournee":{"partie":{"email_client":"webshop_expedition_palette"},"livree":{"email_client":"webshop_livraison_palette"}}}}$defaut$::jsonb;
$f$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_reglages_defaut() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_reglages_defaut() TO service_role;
