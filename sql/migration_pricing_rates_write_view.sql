-- ============================================================================
-- Migration : vue-miroir writable pour la grille tarifaire (pricing_rates)
-- ----------------------------------------------------------------------------
-- Contexte : les ecritures de Settings -> Tarification echouaient en
--   PGRST106 "Invalid schema: majordhome" (HTTP 406) car pricing.service.js
--   ecrivait via .schema('majordhome').from('pricing_*'). Or le schema
--   majordhome n'est PAS expose par PostgREST (durcissement Sem 0 : seules
--   public/core/... le sont). Pattern impose : ecrire via une vue publique.
--
--   - pricing_zones / _equipment_types / _extras / _discounts :
--       leurs vues publiques majordhome_pricing_* sont DEJA des miroirs
--       simples updatable (is_insertable_into=YES, security_invoker=true) ->
--       aucune migration, le service repointe juste dessus.
--   - pricing_rates :
--       la vue publique majordhome_pricing_rates est JOINee (zones +
--       equipment_types) donc non-insertable -> on ajoute ce miroir plat
--       writable, exactement comme majordhome_contract_pricing_items_write.
--
-- RLS : les tables majordhome.pricing_* portent des policies CRUD scopees
--   org_id IN (org_members) ; security_invoker=true les applique sur la vue.
--   Grants authenticated = SELECT/INSERT/UPDATE/DELETE (deja presents sur la
--   table). UNIQUE (org_id, zone_id, equipment_type_id) sur la table support
--   l'upsert onConflict.
-- ============================================================================

CREATE OR REPLACE VIEW public.majordhome_pricing_rates_write
WITH (security_invoker = true) AS
SELECT id, org_id, zone_id, equipment_type_id, price, unit_price, created_at, updated_at
FROM majordhome.pricing_rates;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_pricing_rates_write TO authenticated;
