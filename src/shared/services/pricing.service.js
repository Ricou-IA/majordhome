/**
 * pricing.service.js - Majord'home Artisan
 * ============================================================================
 * Service pour le moteur de tarification.
 *
 * Lectures via vues publiques (scopées par RLS via security_invoker + org_id) :
 *   - majordhome_pricing_zones
 *   - majordhome_pricing_equipment_types
 *   - majordhome_pricing_rates           (enrichie : JOIN zones + equipment_types)
 *   - majordhome_pricing_discounts
 *   - majordhome_pricing_extras
 *   - majordhome_contract_pricing_items  (enrichie : JOIN zones + equipment_types)
 *
 * Écritures via vues publiques writable (majordhome non exposé par PostgREST) :
 *   - majordhome_contract_pricing_items_write (INSERT/DELETE)
 *   - majordhome_contracts_write (UPDATE amount)
 *   - majordhome_pricing_zones / _equipment_types / _discounts / _extras (CRUD UI Tarification :
 *     vues de lecture déjà miroirs updatable, on écrit directement dessus)
 *   - majordhome_pricing_rates_write (CRUD UI Tarification : la vue _rates est JOINée donc
 *     non-updatable → miroir plat dédié, même pattern que _contract_pricing_items_write)
 *
 * @version 1.4.0 - Fix CRUD Tarification : écritures via vues publiques (plus de .schema('majordhome')
 *                  qui renvoyait PGRST106 — schema non exposé). Ajout vue _pricing_rates_write.
 * @version 1.3.0 - Pricing per-org (P0.0.6 reste) : ajout org_id partout + CRUD UI
 * @version 1.2.0 - Passage complet vues publiques (lecture + écriture, plus de .schema())
 * @version 1.1.0 - Passage aux vues publiques pour la lecture
 * @version 1.0.0 - Création moteur de tarification
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { equipmentCategoriesService } from './equipmentCategories.service';

// Re-export zone detection par temps de trajet (Phase unification contrats)
export { detectZoneForAddress, detectZoneByDuration } from '@/lib/zoneDetection';

// ============================================================================
// CONSTANTES
// ============================================================================

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

// Calcul tarifaire (lignes, dégressivité, présentation) : module PUR partagé avec
// la facture Pennylane — src/lib/contractPricing.js (2026-09-21). Ré-exporté ici pour
// les appelants historiques (ContractSign, ContractPdfSection, ContractPricingSection).
export { calculateLineTotal, calculateContractTotal, buildContractPresentation, computeContractLines } from '@/lib/contractPricing';

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const pricingService = {
  // ==========================================================================
  // LECTURE via vues publiques
  // ==========================================================================

  /**
   * Charge toutes les zones de tarification
   * @param {string} [orgId] - filtrer explicitement par org (défense en profondeur)
   * @param {object} [opts] - { activeOnly: true } pour ne charger que les actifs
   */
  async getZones(orgId, { activeOnly = true } = {}) {
    try {
      let q = supabase.from('majordhome_pricing_zones').select('*').order('sort_order');
      if (orgId) q = q.eq('org_id', orgId);
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;

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
  async getEquipmentTypes(orgId, { activeOnly = true } = {}) {
    try {
      let q = supabase.from('majordhome_pricing_equipment_types').select('*').order('sort_order');
      if (orgId) q = q.eq('org_id', orgId);
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;

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
  async getRates(orgId) {
    try {
      let q = supabase.from('majordhome_pricing_rates').select('*');
      if (orgId) q = q.eq('org_id', orgId);
      const { data, error } = await q;

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
  async getRatesForZone(zoneId, orgId) {
    try {
      if (!zoneId) throw new Error('[pricingService] zoneId requis');

      let q = supabase.from('majordhome_pricing_rates').select('*').eq('zone_id', zoneId);
      if (orgId) q = q.eq('org_id', orgId);
      const { data, error } = await q;

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
  async getDiscounts(orgId, { activeOnly = true } = {}) {
    try {
      let q = supabase.from('majordhome_pricing_discounts').select('*').order('min_equipments');
      if (orgId) q = q.eq('org_id', orgId);
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;

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
  async getExtras(orgId, { activeOnly = true } = {}) {
    try {
      let q = supabase.from('majordhome_pricing_extras').select('*').order('sort_order');
      if (orgId) q = q.eq('org_id', orgId);
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      console.error('[pricingService] getExtras ERREUR:', error);
      return { data: [], error };
    }
  },

  /**
   * Charge toutes les données de référence pricing en une fois
   * @param {string} [orgId] - filtrer explicitement par org (défense en profondeur)
   */
  async getAllPricingData(orgId) {
    try {
      const [zonesResult, typesResult, ratesResult, discountsResult, extrasResult, categoriesResult] =
        await Promise.all([
          this.getZones(orgId),
          this.getEquipmentTypes(orgId),
          this.getRates(orgId),
          this.getDiscounts(orgId),
          this.getExtras(orgId),
          // Catégories d'équipement (référentiel 2026-09) : niveau 1 des types.
          equipmentCategoriesService.getCategories(orgId),
        ]);

      // Vérifier les erreurs
      const errors = [zonesResult, typesResult, ratesResult, discountsResult, extrasResult, categoriesResult]
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
          categories: categoriesResult.data,
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

  // ==========================================================================
  // PRIX FORCÉS PAR LIGNE (override par équipement, sans migration)
  // --------------------------------------------------------------------------
  // Convention : une ligne `contract_pricing_items` avec `equipment_id` NON NULL
  // = prix manuel volontaire de cet équipement dans ce contrat. Le snapshot de
  // création (equipment_id NULL) reste inerte et n'est jamais lu ici. Le prix
  // forcé substitue uniquement le prix de base de la ligne ; la dégressivité et
  // le reste du mécanisme de calcul restent appliqués en aval (cf. computedPricing).
  // ==========================================================================

  /**
   * Charge les prix forcés par ligne d'un contrat.
   * @returns {Promise<{data: Object<string, number>, error}>} map equipment_id → prix forcé
   */
  async getContractLineOverrides(contractId) {
    try {
      if (!contractId) throw new Error('[pricingService] contractId requis');

      const { data, error } = await supabase
        .from('majordhome_contract_pricing_items')
        .select('equipment_id, line_total')
        .eq('contract_id', contractId)
        .not('equipment_id', 'is', null);

      if (error) throw error;

      const map = {};
      for (const row of data || []) {
        if (row.equipment_id != null) map[row.equipment_id] = parseFloat(row.line_total) || 0;
      }
      return { data: map, error: null };
    } catch (error) {
      console.error('[pricingService] getContractLineOverrides ERREUR:', error);
      return { data: {}, error };
    }
  },

  /**
   * Pose (ou met à jour) le prix forcé d'une ligne d'équipement.
   * Delete ciblé + insert (l'equipment_id est unique par contrat → 1 ligne max).
   * @param {string} contractId
   * @param {{equipmentId:string, equipmentTypeId:string, zoneId:string, basePrice?:number, unitPrice?:number, quantity?:number}} line
   * @param {number} forcedPrice
   */
  async setContractLineOverride(contractId, line, forcedPrice) {
    try {
      if (!contractId || !line?.equipmentId) {
        throw new Error('[pricingService] contractId et equipmentId requis');
      }
      if (!line.equipmentTypeId || !line.zoneId) {
        throw new Error('[pricingService] equipmentTypeId et zoneId requis (colonnes NOT NULL)');
      }
      const price = Math.round((parseFloat(forcedPrice) || 0) * 100) / 100;

      // Purge ciblée de l'override existant pour cet équipement (idempotent)
      const { error: delError } = await supabase
        .from('majordhome_contract_pricing_items_write')
        .delete()
        .eq('contract_id', contractId)
        .eq('equipment_id', line.equipmentId);
      if (delError) throw delError;

      const { data, error: insError } = await supabase
        .from('majordhome_contract_pricing_items_write')
        .insert({
          contract_id: contractId,
          equipment_id: line.equipmentId,
          equipment_type_id: line.equipmentTypeId,
          zone_id: line.zoneId,
          quantity: line.quantity || 1,
          base_price: line.basePrice ?? price,
          unit_price: line.unitPrice || 0,
          line_total: price,
        })
        .select()
        .single();
      if (insError) throw insError;

      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] setContractLineOverride ERREUR:', error);
      return { data: null, error };
    }
  },

  /**
   * Supprime le prix forcé d'une ligne (retour au prix grille).
   */
  async clearContractLineOverride(contractId, equipmentId) {
    try {
      if (!contractId || !equipmentId) {
        throw new Error('[pricingService] contractId et equipmentId requis');
      }
      const { error } = await supabase
        .from('majordhome_contract_pricing_items_write')
        .delete()
        .eq('contract_id', contractId)
        .eq('equipment_id', equipmentId);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[pricingService] clearContractLineOverride ERREUR:', error);
      return { error };
    }
  },

  // ==========================================================================
  // CRUD ADMIN (Settings → Tarification) — RLS policies filtrent par org_members
  // ==========================================================================

  /** ZONES */
  async createZone(orgId, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_zones')
        .insert({ ...payload, org_id: orgId })
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] createZone:', error);
      return { data: null, error };
    }
  },
  async updateZone(id, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_zones')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] updateZone:', error);
      return { data: null, error };
    }
  },
  async deleteZone(id) {
    try {
      const { error } = await supabase
        .from('majordhome_pricing_zones')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[pricingService] deleteZone:', error);
      return { error };
    }
  },

  /** EQUIPMENT TYPES */
  async createEquipmentType(orgId, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_equipment_types')
        .insert({
          ...payload,
          org_id: orgId,
          // Tournées (2026-08-29) : durée d'entretien + mois déconseillés
          // (duration_base_minutes / duration_per_extra_unit_minutes /
          // unfavorable_months) voyagent via `...payload` seul, JAMAIS forcés
          // ici (mineur, revue finale) — absents du payload, ils ne sont pas
          // envoyés et la DB applique son propre défaut (NULL / 0 / '{}').
          // Un forçage ici est inoffensif en création (rien à écraser) mais
          // devenait une régression silencieuse dès qu'`updateEquipmentType`
          // recopiait le même bloc pour un update PARTIEL (cf. plus bas).
        })
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] createEquipmentType:', error);
      return { data: null, error };
    }
  },
  async updateEquipmentType(id, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_equipment_types')
        .update({
          ...payload,
          // Idem createEquipmentType ci-dessus : ne JAMAIS forcer
          // duration_base_minutes / duration_per_extra_unit_minutes /
          // unfavorable_months à une valeur par défaut ici. Un update
          // PARTIEL qui omet ces champs (ex. l'écran ne touche que le prix)
          // ne doit PAS écraser une durée ou des mois déconseillés déjà
          // enregistrés — `...payload` seul : présent -> écrit tel quel
          // (y compris `null` explicite) ; absent -> colonne intouchée.
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] updateEquipmentType:', error);
      return { data: null, error };
    }
  },
  async deleteEquipmentType(id) {
    try {
      const { error } = await supabase
        .from('majordhome_pricing_equipment_types')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[pricingService] deleteEquipmentType:', error);
      return { error };
    }
  },

  /** RATES (upsert sur composite (org_id, zone_id, equipment_type_id)) */
  async upsertRate(orgId, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_rates_write')
        .upsert(
          { ...payload, org_id: orgId },
          { onConflict: 'org_id,zone_id,equipment_type_id' }
        )
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] upsertRate:', error);
      return { data: null, error };
    }
  },
  async deleteRate(id) {
    try {
      const { error } = await supabase
        .from('majordhome_pricing_rates_write')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[pricingService] deleteRate:', error);
      return { error };
    }
  },

  /** EXTRAS */
  async createExtra(orgId, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_extras')
        .insert({ ...payload, org_id: orgId })
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] createExtra:', error);
      return { data: null, error };
    }
  },
  async updateExtra(id, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_extras')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] updateExtra:', error);
      return { data: null, error };
    }
  },
  async deleteExtra(id) {
    try {
      const { error } = await supabase
        .from('majordhome_pricing_extras')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[pricingService] deleteExtra:', error);
      return { error };
    }
  },

  /** DISCOUNTS */
  async createDiscount(orgId, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_discounts')
        .insert({ ...payload, org_id: orgId })
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] createDiscount:', error);
      return { data: null, error };
    }
  },
  async updateDiscount(id, payload) {
    try {
      const { data, error } = await supabase
        .from('majordhome_pricing_discounts')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] updateDiscount:', error);
      return { data: null, error };
    }
  },
  async deleteDiscount(id) {
    try {
      const { error } = await supabase
        .from('majordhome_pricing_discounts')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('[pricingService] deleteDiscount:', error);
      return { error };
    }
  },

  /**
   * Met à jour le montant d'un contrat à partir de ses lignes tarifaires
   * @param {string} contractId
   * @param {object} pricing - { total, subtotal, discountPercent }
   * @param {string} zoneId
   * @param {boolean} forced - true = saisie manuelle admin (ne sera pas re-sync automatiquement)
   */
  /**
   * Remise exceptionnelle d'un contrat (€ TTC, après dégressivité — 2026-09-21).
   * Le montant se réaligne ensuite via l'auto-sync de ContractPricingSection
   * (amount = sous-total − dégressivité − remise exceptionnelle).
   */
  async updateContractExceptionalDiscount(contractId, value) {
    try {
      if (!contractId) throw new Error('[pricingService] contractId requis');
      const amount = Math.max(0, Math.round((parseFloat(value) || 0) * 100) / 100);
      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update({ exceptional_discount: amount, updated_at: new Date().toISOString() })
        .eq('id', contractId)
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('[pricingService] updateContractExceptionalDiscount ERREUR:', error);
      return { data: null, error };
    }
  },

  async updateContractAmount(contractId, pricing, zoneId, forced = false) {
    try {
      if (!contractId) throw new Error('[pricingService] contractId requis');

      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update({
          amount: pricing.total,
          subtotal: pricing.subtotal,
          discount_percent: pricing.discountPercent,
          zone_id: zoneId,
          amount_forced: forced,
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
