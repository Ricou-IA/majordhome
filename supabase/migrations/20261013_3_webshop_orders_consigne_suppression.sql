-- ============================================================================
-- 20261013_3_webshop_orders_consigne_suppression.sql
--
-- 1. Consigne transporteur saisie par Mayer sur une commande (`delivery_instructions`),
--    distincte du commentaire du client (`comments`) et des notes internes
--    (`internal_notes`, jamais imprimées). Imprimée sur la feuille de route.
-- 2. Remplissage des tournées toujours juste : trigger qui recompte la (ou les) tournée(s)
--    d'une commande quand son statut, sa tournée, ses palettes ou son paiement changent,
--    ou quand elle est supprimée (annuler une commande dans Commandes libérait jusqu'ici
--    sa place… sans la rendre).
-- 3. Suppression définitive d'une commande (org_admin, « god mode ») : annulations et
--    commandes de test. Lignes supprimées par la cascade FK.
-- ============================================================================

ALTER TABLE majordhome.webshop_orders ADD COLUMN IF NOT EXISTS delivery_instructions text;
COMMENT ON COLUMN majordhome.webshop_orders.delivery_instructions IS
  'Consigne de livraison saisie par l''entreprise (Majord''home), imprimée sur la feuille de route du transporteur.';

-- Vues : colonne ajoutée en fin de liste (CREATE OR REPLACE n'autorise que l'ajout final)
CREATE OR REPLACE VIEW public.majordhome_webshop_orders WITH (security_invoker = true) AS
SELECT o.id, o.org_id, o.order_number, o.product_id, o.channel, o.order_type, o.status, o.quantity,
       o.unit_price_ttc, o.total_ttc, o.first_name, o.last_name, o.email, o.phone, o.address, o.postal_code,
       o.city, o.company_name, o.company_siret, o.company_contact, o.company_email, o.company_phone,
       o.comments, o.internal_notes, o.lead_id, o.client_id, o.source, o.carrier, o.tracking_number,
       o.shipped_at, o.delivered_at, o.external_data, o.created_at, o.updated_at,
       p.name AS product_name, p.slug AS product_slug, p.brand AS product_brand,
       ((l.first_name || ' '::text) || l.last_name) AS lead_name,
       o.delivery_instructions
  FROM majordhome.webshop_orders o
  LEFT JOIN majordhome.webshop_products p ON p.id = o.product_id
  LEFT JOIN majordhome.leads l ON l.id = o.lead_id;

CREATE OR REPLACE VIEW public.majordhome_webshop_orders_write WITH (security_invoker = true) AS
SELECT id, org_id, order_number, product_id, channel, order_type, status, quantity, unit_price_ttc, total_ttc,
       first_name, last_name, email, phone, address, postal_code, city, company_name, company_siret,
       company_contact, company_email, company_phone, comments, internal_notes, lead_id, client_id, source,
       carrier, tracking_number, shipped_at, delivered_at, external_data, created_at, updated_at,
       pallet_delivery_mode, parcel_delivery_mode, pickup_point_id, pallet_slots, subtotal_ttc_cents,
       shipping_ttc_cents, total_ttc_cents, vat_breakdown, stripe_checkout_session_id, stripe_payment_intent_id,
       paid_at, expires_at, cancel_reason, sector_id, requested_slot_id, delivery_slot_id, delivery_slot_changed,
       needs_manual_planning, geocoded_address, normalized_address, lat, lon,
       delivery_instructions
  FROM majordhome.webshop_orders;

-- ============================================================================
-- 2. Recomptage automatique des tournées
--    SECURITY DEFINER : déclenché par un UPDATE/DELETE d'utilisateur authentifié, il doit
--    pouvoir appeler webshop_slot_recount (non exécutable par authenticated).
-- ============================================================================
CREATE OR REPLACE FUNCTION majordhome.webshop_orders_recount_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.delivery_slot_id IS NOT NULL THEN PERFORM majordhome.webshop_slot_recount(OLD.delivery_slot_id); END IF;
    RETURN OLD;
  END IF;
  IF NEW.delivery_slot_id IS NOT NULL THEN PERFORM majordhome.webshop_slot_recount(NEW.delivery_slot_id); END IF;
  IF OLD.delivery_slot_id IS NOT NULL AND OLD.delivery_slot_id IS DISTINCT FROM NEW.delivery_slot_id THEN
    PERFORM majordhome.webshop_slot_recount(OLD.delivery_slot_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_orders_recount_slots() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS webshop_orders_recount_slots ON majordhome.webshop_orders;
CREATE TRIGGER webshop_orders_recount_slots
  AFTER UPDATE OF status, delivery_slot_id, pallet_slots, paid_at OR DELETE ON majordhome.webshop_orders
  FOR EACH ROW EXECUTE FUNCTION majordhome.webshop_orders_recount_slots();

-- ============================================================================
-- 3. Suppression définitive (org_admin de l'org de la commande)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.webshop_order_hard_delete(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order record;
  v_role text;
  v_items int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, org_id, order_number, delivery_slot_id INTO v_order
    FROM majordhome.webshop_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO v_role FROM core.organization_members WHERE org_id = v_order.org_id AND user_id = v_user;
  IF (v_role = 'org_admin') IS NOT TRUE THEN RAISE EXCEPTION 'org_admin_required' USING ERRCODE = '42501'; END IF;

  SELECT count(*) INTO v_items FROM majordhome.webshop_order_items WHERE order_id = p_order_id;
  DELETE FROM majordhome.webshop_orders WHERE id = p_order_id AND org_id = v_order.org_id; -- lignes : ON DELETE CASCADE ; tournée : trigger

  RETURN jsonb_build_object('order_number', v_order.order_number, 'items_deleted', v_items,
                            'slot_id', v_order.delivery_slot_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.webshop_order_hard_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webshop_order_hard_delete(uuid) TO authenticated;
