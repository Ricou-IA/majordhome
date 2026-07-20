-- ============================================================================
-- Migration : durcissement RLS des ECRITURES de la grille tarifaire -> org_admin
-- ----------------------------------------------------------------------------
-- Les tables majordhome.pricing_* avaient des policies INSERT/UPDATE/DELETE au
-- niveau membre (org_id IN org_members). L'UI /settings/pricing restreint deja
-- a org_admin, mais la base ne l'imposait pas -> defense en profondeur manquante.
-- Ici : INSERT/UPDATE/DELETE reserves aux org_admin. SELECT reste au niveau
-- membre (les formulaires contrat lisent les tarifs cote team_leader/commercial).
-- ALTER POLICY en place = atomique, aucune fenetre sans policy.
-- role verifie : core.organization_members.role IN ('org_admin','team_leader','member').
-- ============================================================================

-- ZONES
ALTER POLICY pricing_zones_insert ON majordhome.pricing_zones
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_zones_update ON majordhome.pricing_zones
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_zones_delete ON majordhome.pricing_zones
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- EQUIPMENT TYPES
ALTER POLICY pricing_equipment_types_insert ON majordhome.pricing_equipment_types
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_equipment_types_update ON majordhome.pricing_equipment_types
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_equipment_types_delete ON majordhome.pricing_equipment_types
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- RATES
ALTER POLICY pricing_rates_insert ON majordhome.pricing_rates
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_rates_update ON majordhome.pricing_rates
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_rates_delete ON majordhome.pricing_rates
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- DISCOUNTS
ALTER POLICY pricing_discounts_insert ON majordhome.pricing_discounts
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_discounts_update ON majordhome.pricing_discounts
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_discounts_delete ON majordhome.pricing_discounts
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- EXTRAS
ALTER POLICY pricing_extras_insert ON majordhome.pricing_extras
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_extras_update ON majordhome.pricing_extras
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
ALTER POLICY pricing_extras_delete ON majordhome.pricing_extras
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));
