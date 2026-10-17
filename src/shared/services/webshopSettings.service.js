/**
 * webshopSettings.service.js - Majord'home Artisan
 * ============================================================================
 * Settings → Webshop : listes de livraison de la boutique.
 *   - lectures : vues majordhome_webshop_sectors / _sector_postcodes /
 *     _shipping_rates / _pickup_points, filtrées explicitement par org_id
 *     (org CORE, comme le site) ;
 *   - écritures : RPC SECURITY DEFINER de 20261017_2 (org_admin, garde en base).
 *     Les tables n'ont pas de vue d'écriture : jamais d'INSERT/UPDATE direct.
 * Les réglages scalaires (settings.webshop) passent par useOrgSettings().
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const SECTOR_COLS = 'id, org_id, code, label, depot, max_stops, max_minutes, max_km, slot_price_ttc_cents, slots_per_cycle, recurrence, is_active';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const webshopSettingsService = {
  async getSectors(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_sectors')
        .select(SECTOR_COLS)
        .eq('org_id', orgId)
        .order('code');
      if (error) throw error;
      return data || [];
    }, 'webshopSettings.getSectors');
  },

  async getSectorPostcodes(orgId, sectorId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_sector_postcodes')
        .select('postal_code, insee_code, commune')
        .eq('org_id', orgId)
        .eq('sector_id', sectorId)
        .order('postal_code')
        .order('commune');
      if (error) throw error;
      return data || [];
    }, 'webshopSettings.getSectorPostcodes');
  },

  async getShippingRates(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_shipping_rates')
        .select('id, label, min_weight_kg, max_weight_kg, price_ttc, is_active')
        .eq('org_id', orgId)
        .order('min_weight_kg');
      if (error) throw error;
      return data || [];
    }, 'webshopSettings.getShippingRates');
  },

  async getPickupPoints(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_pickup_points')
        .select('id, slug, name, address, opening_hours, accepts, is_active')
        .eq('org_id', orgId)
        .order('name');
      if (error) throw error;
      return data || [];
    }, 'webshopSettings.getPickupPoints');
  },

  /** Crée (sans id) ou met à jour partiellement (avec id) un secteur. Renvoie son id. */
  async upsertSector(orgId, sector) {
    return withErrorHandling(
      () => rpc('webshop_sector_upsert', { p_org_id: orgId, p_sector: sector }),
      'webshopSettings.upsertSector',
    );
  },

  /** Remplace atomiquement les codes postaux d'un secteur. Renvoie le nombre de lignes écrites. */
  async setSectorPostcodes(sectorId, rows) {
    return withErrorHandling(
      () => rpc('webshop_sector_set_postcodes', { p_sector_id: sectorId, p_rows: rows }),
      'webshopSettings.setSectorPostcodes',
    );
  },

  /** Régénère les créneaux à venir (hors fenêtre de fermeture). Renvoie `{ supprimes, crees }`. */
  async regenerateFutureSlots(orgId) {
    return withErrorHandling(
      () => rpc('webshop_regenerate_future_slots', { p_org_id: orgId }),
      'webshopSettings.regenerateFutureSlots',
    );
  },

  /** `price_ttc` en EUROS. */
  async upsertShippingRate(orgId, rate) {
    return withErrorHandling(
      () => rpc('webshop_shipping_rate_upsert', { p_org_id: orgId, p_rate: rate }),
      'webshopSettings.upsertShippingRate',
    );
  },

  async deleteShippingRate(rateId) {
    return withErrorHandling(
      () => rpc('webshop_shipping_rate_delete', { p_rate_id: rateId }),
      'webshopSettings.deleteShippingRate',
    );
  },

  /** Pas de suppression d'un point de retrait : `is_active=false`. */
  async upsertPickupPoint(orgId, point) {
    return withErrorHandling(
      () => rpc('webshop_pickup_point_upsert', { p_org_id: orgId, p_point: point }),
      'webshopSettings.upsertPickupPoint',
    );
  },
};
