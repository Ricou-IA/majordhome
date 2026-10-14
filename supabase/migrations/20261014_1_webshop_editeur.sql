-- 20261014_1_webshop_editeur.sql
-- Éditeur de catalogue + kanban des commandes
-- (spec docs/superpowers/specs/2026-10-13-webshop-editeur-catalogue-kanban-commandes-design.md).
-- 1. Catalogue : écritures org_admin seulement (lecture inchangée : membres).
--    Le site Mayer lit/écrit en service_role : non concerné par la RLS.
-- 2. Bucket public `webshop` : limites + policies sur le préfixe `${orgId}/`.
--    Les fichiers du script d'import du site (`products/…`, service_role) ne sont pas touchés.
-- 3. Vue des commandes : colonnes du modèle boutique (paiement, livraison) en fin de liste,
--    après `delivery_instructions` (20261013_3) — CREATE OR REPLACE n'accepte que l'ajout final.

-- ── 1. webshop_products ─────────────────────────────────────────────────
DROP POLICY IF EXISTS webshop_products_insert_org_members ON majordhome.webshop_products;
DROP POLICY IF EXISTS webshop_products_update_org_members ON majordhome.webshop_products;
DROP POLICY IF EXISTS webshop_products_delete_org_members ON majordhome.webshop_products;
DROP POLICY IF EXISTS webshop_products_insert_org_admin ON majordhome.webshop_products;
DROP POLICY IF EXISTS webshop_products_update_org_admin ON majordhome.webshop_products;
DROP POLICY IF EXISTS webshop_products_delete_org_admin ON majordhome.webshop_products;

CREATE POLICY webshop_products_insert_org_admin ON majordhome.webshop_products
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_products_update_org_admin ON majordhome.webshop_products
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_products_delete_org_admin ON majordhome.webshop_products
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'));

-- ── 1bis. webshop_categories (policy ALL « tout membre » → lecture membre / écriture admin) ──
DROP POLICY IF EXISTS webshop_categories_org ON majordhome.webshop_categories;
DROP POLICY IF EXISTS webshop_categories_select_org_members ON majordhome.webshop_categories;
DROP POLICY IF EXISTS webshop_categories_write_org_admin ON majordhome.webshop_categories;

CREATE POLICY webshop_categories_select_org_members ON majordhome.webshop_categories
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

CREATE POLICY webshop_categories_write_org_admin ON majordhome.webshop_categories
  FOR ALL TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- ── 2. Bucket webshop ───────────────────────────────────────────────────
UPDATE storage.buckets
   SET file_size_limit = 8388608,
       allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png']
 WHERE id = 'webshop';

DROP POLICY IF EXISTS webshop_images_org_select ON storage.objects;
DROP POLICY IF EXISTS webshop_images_org_admin_insert ON storage.objects;
DROP POLICY IF EXISTS webshop_images_org_admin_update ON storage.objects;
DROP POLICY IF EXISTS webshop_images_org_admin_delete ON storage.objects;

-- Lecture publique servie par le bucket public ; cette policy sert au remove() (lecture préalable).
CREATE POLICY webshop_images_org_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid()));

CREATE POLICY webshop_images_org_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_images_org_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_images_org_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- ── 3. Vue commandes (colonnes ajoutées EN FIN, security_invoker conservé) ──
CREATE OR REPLACE VIEW public.majordhome_webshop_orders WITH (security_invoker = true) AS
SELECT o.id, o.org_id, o.order_number, o.product_id, o.channel, o.order_type, o.status, o.quantity,
       o.unit_price_ttc, o.total_ttc, o.first_name, o.last_name, o.email, o.phone, o.address, o.postal_code,
       o.city, o.company_name, o.company_siret, o.company_contact, o.company_email, o.company_phone,
       o.comments, o.internal_notes, o.lead_id, o.client_id, o.source, o.carrier, o.tracking_number,
       o.shipped_at, o.delivered_at, o.external_data, o.created_at, o.updated_at,
       p.name AS product_name, p.slug AS product_slug, p.brand AS product_brand,
       ((l.first_name || ' '::text) || l.last_name) AS lead_name,
       o.delivery_instructions,
       o.pallet_delivery_mode, o.parcel_delivery_mode, o.pickup_point_id, o.pallet_slots,
       o.subtotal_ttc_cents, o.shipping_ttc_cents, o.total_ttc_cents, o.vat_breakdown,
       o.paid_at, o.expires_at, o.cancel_reason, o.sector_id, o.delivery_slot_id,
       o.delivery_slot_changed, o.needs_manual_planning,
       ds.delivery_date, s.label AS sector_label, pp.name AS pickup_point_name
  FROM majordhome.webshop_orders o
  LEFT JOIN majordhome.webshop_products p ON p.id = o.product_id
  LEFT JOIN majordhome.leads l ON l.id = o.lead_id
  LEFT JOIN majordhome.webshop_delivery_slots ds ON ds.id = o.delivery_slot_id
  LEFT JOIN majordhome.webshop_sectors s ON s.id = o.sector_id
  LEFT JOIN majordhome.webshop_pickup_points pp ON pp.id = o.pickup_point_id;
