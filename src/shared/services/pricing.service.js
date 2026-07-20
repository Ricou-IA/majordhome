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

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

/**
 * Construit la présentation tarifaire (lignes équipement + remises) cohérente avec
 * le montant RÉELLEMENT facturé, qu'il soit calculé depuis la grille ou forcé par
 * un admin. Garantit toujours que la somme des lignes (± remises) retombe sur le total.
 *
 * Trois cas :
 *  - billable ≈ computedTotal (calcul grille standard) :
 *      lignes au prix grille + dégressivité éventuelle, pas de remise commerciale.
 *  - billable < computedTotal (forçage à la BAISSE) :
 *      lignes au prix grille + ligne "Remise commerciale" = computedTotal − billable.
 *  - billable > computedTotal (forçage à la HAUSSE) :
 *      les prix d'articles sont MAJORÉS au prorata de leur prix grille pour que la
 *      somme des lignes = montant facturé. Pas de remise négative ni de dégressivité
 *      affichée (absorbées dans les prix de ligne). Un équipement unique forcé à 350 €
 *      voit simplement sa ligne passer à 350 €.
 *
 * @param {{items:Array, subtotal:number, discountPercent:number, discountAmount:number, total:number}|null} computedPricing
 * @param {number} billableTotal - montant facturé (forcé ou calculé)
 * @returns {{equipmentLines:Array, subtotal:number, discountPercent:number, discountAmount:number, extraDiscountAmount:number, total:number}}
 */
export function buildContractPresentation(computedPricing, billableTotal) {
  const items = computedPricing?.items || [];
  const computedTotal = computedPricing?.total || 0;
  const billable = round2(billableTotal);

  // Index des lignes réellement chiffrées (lineTotal > 0) — les lignes "Sur devis"
  // (lineTotal = 0) restent inchangées et ne reçoivent jamais de prix redistribué.
  const pricedIndexes = items
    .map((it, i) => ((parseFloat(it.lineTotal) || 0) > 0 ? i : -1))
    .filter((i) => i >= 0);

  // --- Forçage à la hausse : majorer les lignes pour que leur somme = montant facturé ---
  if (pricedIndexes.length > 0 && billable > computedTotal + 0.01) {
    const baseSum = pricedIndexes.reduce((s, i) => s + parseFloat(items[i].lineTotal), 0);
    const remainderIdx = pricedIndexes[pricedIndexes.length - 1]; // absorbe l'arrondi
    let allocated = 0;
    const equipmentLines = items.map((it, i) => {
      if (!pricedIndexes.includes(i)) return it; // ligne "Sur devis" : inchangée
      if (i === remainderIdx) return { ...it, lineTotal: round2(billable - allocated) };
      const price = round2(billable * (parseFloat(it.lineTotal) / baseSum));
      allocated += price;
      return { ...it, lineTotal: price };
    });
    return {
      equipmentLines,
      subtotal: billable,
      discountPercent: 0,
      discountAmount: 0,
      extraDiscountAmount: 0,
      total: billable,
    };
  }

  // --- Calcul standard / forçage à la baisse : remise commerciale absorbe l'écart ---
  const extraDiscountAmount = billable < computedTotal - 0.01 ? round2(computedTotal - billable) : 0;
  return {
    equipmentLines: items,
    subtotal: computedPricing?.subtotal || 0,
    discountPercent: computedPricing?.discountPercent || 0,
    discountAmount: computedPricing?.discountAmount || 0,
    extraDiscountAmount,
    total: billable,
  };
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
      const [zonesResult, typesResult, ratesResult, discountsResult, extrasResult] =
        await Promise.all([
          this.getZones(orgId),
          this.getEquipmentTypes(orgId),
          this.getRates(orgId),
          this.getDiscounts(orgId),
          this.getExtras(orgId),
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
        .insert({ ...payload, org_id: orgId })
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
        .update(payload)
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
