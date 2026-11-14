/**
 * planningCa.service.js - Majord'home Artisan
 * ============================================================================
 * Données du CA HT programmé du Planning : pour les affaires affichées
 * (chantiers des installations, interventions des entretiens), TOUTES leurs
 * journées posées — plage affichée ou non — et leur montant HT.
 * Lecture seule. Les règles de calcul sont dans src/lib/planningCa.js.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, getMajordhomeOrgId } from '@/lib/serviceHelpers';
import { getChantierAmount } from '@services/chantiers.service';
import { montantHtContrat } from '@/lib/planningCa';

/** Taille d'un lot d'identifiants passé à `.in()` (longueur d'URL PostgREST). */
const LOT = 100;

/**
 * Exécute une requête `.in()` par lots et réunit les lignes. Rejette à la première erreur.
 * @param {string[]} ids
 * @param {(lot: string[]) => PromiseLike<{ data: any[]|null, error: any }>} requete
 * @returns {Promise<any[]>}
 */
async function parLots(ids, requete) {
  const lots = [];
  for (let i = 0; i < ids.length; i += LOT) lots.push(ids.slice(i, i + LOT));
  const pages = await Promise.all(lots.map(async (lot) => {
    const { data, error } = await requete(lot);
    if (error) throw error;
    return data || [];
  }));
  return pages.flat();
}

const COLONNES_RDV = 'id, appointment_type, scheduled_date, status, chantier_id, intervention_id';

export const planningCaService = {
  /**
   * @param {object} p
   * @param {string} p.coreOrgId  org CORE (chantiers, contrats, catégories) — l'org majordhome des RDV en est dérivée
   * @param {string[]} [p.chantierIds]  chantiers des installations affichées
   * @param {string[]} [p.interventionIds]  interventions des entretiens affichés
   * @returns {Promise<{ data: { rdvs: object[], montants: Array<[string, number]> }|null, error: Error|null }>}
   *   `rdvs` : tous les RDV de ces affaires (pour indexerJours) ; `montants` : clé d'affaire → montant HT.
   */
  async getAffaires({ coreOrgId, chantierIds = [], interventionIds = [] }) {
    return withErrorHandling(async () => {
      if (!coreOrgId) throw new Error('[planningCaService] coreOrgId est requis');
      const mdhOrgId = await getMajordhomeOrgId(coreOrgId);

      const [posesChantier, posesEntretien, chantiers, interventions] = await Promise.all([
        parLots(chantierIds, (lot) => supabase.from('majordhome_appointments').select(COLONNES_RDV)
          .eq('org_id', mdhOrgId).eq('appointment_type', 'installation').in('chantier_id', lot)),
        parLots(interventionIds, (lot) => supabase.from('majordhome_appointments').select(COLONNES_RDV)
          .eq('org_id', mdhOrgId).eq('appointment_type', 'maintenance').in('intervention_id', lot)),
        parLots(chantierIds, (lot) => supabase.from('majordhome_chantiers')
          .select('id, validated_quotes_count, linked_quotes_amount_ht, order_amount_ht, estimated_revenue')
          .eq('org_id', coreOrgId).in('id', lot)),
        // Pas de colonne org sur la vue : les ids viennent de RDV déjà filtrés par org, la RLS fait le reste.
        parLots(interventionIds, (lot) => supabase.from('majordhome_interventions')
          .select('id, contract_id').in('id', lot)),
      ]);

      const montants = chantiers.map((c) => [`chantier:${c.id}`, getChantierAmount(c)]);

      // Entretien : montant du contrat (TTC) → HT par la TVA de la catégorie de ses équipements.
      const contractIds = [...new Set(interventions.map((i) => i.contract_id).filter(Boolean))];
      if (contractIds.length > 0) {
        const [contrats, liens, { data: categories, error: catErr }] = await Promise.all([
          parLots(contractIds, (lot) => supabase.from('majordhome_contracts')
            .select('id, amount').eq('org_id', coreOrgId).in('id', lot)),
          parLots(contractIds, (lot) => supabase.from('majordhome_contract_equipments')
            .select('contract_id, equipment_id').in('contract_id', lot)),
          supabase.from('majordhome_equipment_categories').select('id, default_vat_rate').eq('org_id', coreOrgId),
        ]);
        if (catErr) throw catErr;
        const equipIds = [...new Set(liens.map((l) => l.equipment_id).filter(Boolean))];
        const equipements = await parLots(equipIds, (lot) => supabase.from('majordhome_equipments')
          .select('id, category_id').in('id', lot));

        const tauxParCategorie = new Map((categories || []).map((c) => [c.id, c.default_vat_rate]));
        const tauxParEquipement = new Map(equipements.map((e) => [e.id, tauxParCategorie.get(e.category_id) ?? null]));
        const tauxParContrat = new Map();
        for (const l of liens) {
          if (!tauxParContrat.has(l.contract_id)) tauxParContrat.set(l.contract_id, []);
          tauxParContrat.get(l.contract_id).push(tauxParEquipement.get(l.equipment_id) ?? null);
        }
        const contratParId = new Map(contrats.map((c) => [c.id, c]));
        for (const i of interventions) {
          const contrat = contratParId.get(i.contract_id);
          if (!contrat) continue;
          montants.push([`entretien:${i.id}`, montantHtContrat(contrat.amount, tauxParContrat.get(contrat.id) || [])]);
        }
      }

      return { rdvs: [...posesChantier, ...posesEntretien], montants };
    }, 'planningCa.getAffaires');
  },
};
