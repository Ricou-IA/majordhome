/**
 * pricing.service.js - Majord'home Artisan
 * ============================================================================
 * Service pour le moteur de tarification.
 *
 * Lectures via vues publiques :
 *   - majordhome_pricing_zones
 *   - majordhome_pricing_equipment_types
 *   - majordhome_pricing_rates           (enrichie : JOIN zones + equipment_types)
 *   - majordhome_pricing_discounts
 *   - majordhome_pricing_extras
 *   - majordhome_contract_pricing_items  (enrichie : JOIN zones + equipment_types)
 *
 * Écritures via vues publiques writable :
 *   - majordhome_contract_pricing_items_write (INSERT/DELETE)
 *   - majordhome_contracts_write (UPDATE amount)
 *
 * @version 1.2.0 - Passage complet vues publiques (lecture + écriture, plus de .schema())
 * @version 1.1.0 - Passage aux vues publiques pour la lecture
 * @version 1.0.0 - Création moteur de tarification
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

// Re-export zone detection par temps de trajet (Phase unification contrats)
export { detectZoneForAddress, detectZoneByDuration } from '@/lib/zoneDetection';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Catégories visuelles pour regrouper les types d'équipements
 */
export const EQUIPMENT_TYPE_CATEGORIES = [
  { value: 'poeles', label: 'Poêles & Inserts' },
  { value: 'chaudieres', label: 'Chaudières' },
  { value: 'climatisation', label: 'Climatisation & PAC' },
  { value: 'eau_chaude', label: 'Eau chaude & Solaire' },
  { value: 'energie', label: 'Énergie' },
];

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Détecte la zone tarifaire à partir d'un code postal
 */
export function detectZoneFromPostalCode(postalCode, zones) {
  if (!postalCode || !zones?.length) return null;

  const dept = postalCode.substring(0, 2);

  // Chercher une zone dont les departments contiennent le département
  const matched = zones.find(
    (z) => z.departments?.includes(dept) && z.is_active
  );

  if (matched) return matched;

  // Fallback : zone par défaut (HZ)
  return zones.find((z) => z.is_default && z.is_active) || null;
}

/**
 * Calcule le prix d'une ligne tarifaire.
 * Le zoneSupplement (déplacement) est ajouté une fois par ligne d'équipement.
 * Note : les splits (unit_pricing) comptent comme 1 seul équipement pour la remise.
 */
export function calculateLineTotal(rate, equipType, quantity = 1, zoneSupplement = 0) {
  if (!rate) return 0;

  const basePrice = parseFloat(rate.price) || 0;
  const supplement = parseFloat(zoneSupplement) || 0;

  if (equipType?.has_unit_pricing) {
    const unitPrice = parseFloat(rate.unit_price) || 0;
    const included = equipType.included_units || 0;
    const extra = Math.max(0, quantity - included);
    return basePrice + extra * unitPrice + supplement;
  }

  return basePrice + supplement;
}

/**
 * Calcule le montant total d'un contrat à partir des lignes tarifaires.
 * Accepte les deux formats : camelCase (frontend) et snake_case (DB).
 */
export function calculateContractTotal(items, discounts = []) {
  if (!items?.length) return { subtotal: 0, discountPercent: 0, discountAmount: 0, total: 0 };

  // Supporter camelCase (lineTotal) et snake_case (line_total)
  const subtotal = items.reduce((sum, item) => {
    const val = item.lineTotal ?? item.line_total ?? 0;
    return sum + (parseFloat(val) || 0);
  }, 0);

  // Nombre d'équipements (1 item = 1 équipement pour la remise)
  const equipmentCount = items.reduce((count, item) => {
    const val = item.lineTotal ?? item.line_total ?? 0;
    if (parseFloat(val) <= 0) return count;
    return count + 1;
  }, 0);

  // Trouver la remise applicable (plus grande remise dont le seuil est atteint)
  const applicableDiscount = discounts
    .filter((d) => d.is_active !== false && equipmentCount >= d.min_equipments)
    .sort((a, b) => b.min_equipments - a.min_equipments)[0];

  const discountPercent = applicableDiscount?.discount_percent || 0;
  const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;

  return { subtotal, discountPercent, discountAmount, total };
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const pricingService = {
  // ==========================================================================
  // LECTURE via vues publiques
  // ==========================================================================

  /**
   * Charge toutes les zones de tarification
   */
  async getZones() {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_zones')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getZones ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Charge tous les types d'équipements
   */
  async getEquipmentTypes() {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_equipment_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getEquipmentTypes ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Charge la grille tarifaire complète (vue enrichie avec zones + types)
   */
  async getRates() {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_rates')
        .select('*');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getRates ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Charge les tarifs pour une zone donnée
   */
  async getRatesForZone(zoneId) {
    try {
      if (!zoneId) throw new Error('[pricingService] zoneId requis');

      const { data, error } = await supabase
        .from('majordhome_pricing_rates')
        .select('*')
        .eq('zone_id', zoneId);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getRatesForZone ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Charge les remises volume
   */
  async getDiscounts() {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_discounts')
        .select('*')
        .eq('is_active', true)
        .order('min_equipments');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getDiscounts ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Charge les options supplémentaires
   */
  async getExtras() {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_extras')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getExtras ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Charge toutes les données de référence pricing en une fois
   */
  async getAllPricingData() {
    try {
      const [zonesResult, typesResult, ratesResult, discountsResult, extrasResult] =
        await Promise.all([
          this.getZones(),
          this.getEquipmentTypes(),
          this.getRates(),
          this.getDiscounts(),
          this.getExtras(),
        ]);

      // Vérifier les erreurs
      const errors = [zonesResult, typesResult, ratesResult, discountsResult, extrasResult]
        .filter((r) => r.error)
        .map((r) => r.error);

      if (errors.length > 0) {
        console.error('[pricingService] getAllPricingData - erreurs:', errors);
        throw errors[0];
      }

      return {
        data: {
          zones: zonesResult.data,
          equipmentTypes: typesResult.data,
          rates: ratesResult.data,
          discounts: discountsResult.data,
          extras: extrasResult.data,
        },
        error: null,
      };
    } catch (error) {
      console.error('[pricingService] getAllPricingData ERREUR:', error);
      return { data: null, error };
    }
  },

  // ==========================================================================
  // CONTRACT PRICING ITEMS
  // ==========================================================================

  /**
   * Récupère les lignes tarifaires d'un contrat (vue enrichie)
   */
  async getContractPricingItems(contractId) {
    try {
      if (!contractId) throw new Error('[pricingService] contractId requis');

      const { data, error } = await supabase
        .from('majordhome_contract_pricing_items')
        .select('*')
        .eq('contract_id', contractId)
        .order('created_at');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getContractPricingItems ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Sauvegarde les lignes tarifaires d'un contrat (remplace toutes les lignes existantes)
   * Écriture directe via schéma majordhome
   */
  async saveContractPricingItems(contractId, items) {
    try {
      if (!contractId) throw new Error('[pricingService] contractId requis');

      // Supprimer les anciennes lignes (vue writable publique)
      const { error: deleteError } = await supabase
        .from('majordhome_contract_pricing_items_write')
        .delete()
        .eq('contract_id', contractId);

      if (deleteError) throw deleteError;

      // Insérer les nouvelles lignes
      if (items && items.length > 0) {
        const rows = items.map((item) => ({
          contract_id: contractId,
          equipment_type_id: item.equipmentTypeId,
          zone_id: item.zoneId,
          quantity: item.quantity || 1,
          base_price: item.basePrice,
          unit_price: item.unitPrice || 0,
          line_total: item.lineTotal,
          equipment_id: item.equipmentId || null,
        }));

        const { data, error: insertError } = await supabase
          .from('majordhome_contract_pricing_items_write')
          .insert(rows)
          .select();

        if (insertError) throw insertError;
        return { data, error: null };
      }

      return { data: [], error: null };
    } catch (error) {
      console.error('[pricingService] saveContractPricingItems ERREUR:', error);
      return { data: null, error };
    }
  },

  /**
   * Met à jour le montant d'un contrat à partir de ses lignes tarifaires
   */
  async updateContractAmount(contractId, pricing, zoneId) {
    try {
      if (!contractId) throw new Error('[pricingService] contractId requis');

      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update({
          amount: pricing.total,
          subtotal: pricing.subtotal,
          discount_percent: pricing.discountPercent,
          zone_id: zoneId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contractId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] updateContractAmount ERREUR:', error);
      return { data: null, error };
    }
  },
};

export default pricingService;
