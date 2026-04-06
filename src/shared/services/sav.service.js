/**
 * sav.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion du workflow Entretien & SAV (Kanban unifié).
 *
 * Un entretien = intervention type 'entretien' (visite annuelle contrat)
 * Un SAV = intervention type 'sav' (demande réparation client)
 *
 * Utilise la vue publique majordhome_entretien_sav pour les lectures.
 * Écritures via la vue auto-updatable majordhome_interventions.
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { entretiensService } from './entretiens.service';

// ============================================================================
// CONSTANTES — STATUTS & TRANSITIONS
// ============================================================================

export const ENTRETIEN_STATUSES = [
  { value: 'a_planifier', label: 'À planifier', color: '#3B82F6', display_order: 1 },
  { value: 'planifie',    label: 'Planifié',    color: '#8B5CF6', display_order: 2 },
  { value: 'realise',     label: 'Réalisé',     color: '#10B981', display_order: 3 },
  { value: 'facture',     label: 'Facturé',     color: '#6366F1', display_order: 4 },
];

export const SAV_STATUSES = [
  { value: 'demande',            label: 'Demande',           color: '#EF4444', display_order: 1 },
  { value: 'pieces_commandees',  label: 'Pièces commandées', color: '#F59E0B', display_order: 2 },
  { value: 'devis_envoye',       label: 'Devis envoyé',      color: '#3B82F6', display_order: 3 },
  { value: 'planifie',           label: 'Planifié',          color: '#8B5CF6', display_order: 4 },
  { value: 'realise',            label: 'Réalisé',           color: '#10B981', display_order: 5 },
];

/**
 * Colonnes Kanban unifiées (entretien + SAV)
 * Les cartes entretien n'apparaissent que dans : a_planifier, planifie, realise
 * Les cartes SAV apparaissent dans toutes les colonnes
 */
export const KANBAN_COLUMNS = [
  { value: 'demande',           label: 'Demande SAV',       color: '#EF4444', types: ['sav'] },
  { value: 'devis_envoye',      label: 'Devis envoyé',      color: '#3B82F6', types: ['sav'] },
  { value: 'pieces_commandees', label: 'Pièces commandées', color: '#F59E0B', types: ['sav'] },
  { value: 'a_planifier',       label: 'À planifier',       color: '#3B82F6', types: ['entretien', 'sav'] },
  { value: 'planifie',          label: 'Planifié',          color: '#8B5CF6', types: ['entretien', 'sav'] },
  { value: 'realise',           label: 'Réalisé',           color: '#10B981', types: ['entretien', 'sav'] },
];

export const ENTRETIEN_TRANSITIONS = {
  a_planifier: ['planifie'],
  planifie:    ['realise', 'a_planifier'],
  realise:     ['facture'],
  facture:     ['realise'],
};

export const SAV_TRANSITIONS = {
  demande:           ['devis_envoye', 'pieces_commandees', 'a_planifier'],
  devis_envoye:      ['pieces_commandees', 'demande'],
  pieces_commandees: ['a_planifier', 'devis_envoye'],
  a_planifier:       ['planifie'],
  planifie:          ['realise', 'a_planifier'],
  realise:           [],
};

export const PARTS_ORDER_STATUSES = [
  { value: 'commande',    label: 'Commandé' },
  { value: 'recu',        label: 'Reçu' },
];

export const DEVIS_STATUSES = [
  { value: 'envoye',  label: 'Envoyé' },
  { value: 'accepte', label: 'Accepté' },
  { value: 'refuse',  label: 'Refusé' },
];

// ============================================================================
// HELPERS
// ============================================================================

export function getStatusConfig(type, status) {
  const list = type === 'sav' ? SAV_STATUSES : ENTRETIEN_STATUSES;
  return list.find(s => s.value === status) || list[0];
}

export function getTransitions(type, currentStatus) {
  const map = type === 'sav' ? SAV_TRANSITIONS : ENTRETIEN_TRANSITIONS;
  return map[currentStatus] || [];
}

export function getKanbanColumnConfig(columnValue) {
  return KANBAN_COLUMNS.find(c => c.value === columnValue) || KANBAN_COLUMNS[0];
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const savService = {
  // ==========================================================================
  // LECTURE
  // ==========================================================================

  /**
   * Récupère tous les items entretien + SAV d'une organisation
   */
  async getEntretiensSAV({ orgId, limit = 300 }) {
    if (!orgId) throw new Error('[sav] orgId requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_entretien_sav')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[sav] getEntretiensSAV error:', error);
        return { data: null, error };
      }

      return { data: data || [], error: null };
    } catch (err) {
      console.error('[sav] getEntretiensSAV error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Stats dashboard : compteurs par type et statut
   */
  async getStats(orgId) {
    if (!orgId) throw new Error('[sav] orgId requis');

    try {
      // 1) Contrats actifs avec statut visite année en cours
      const { data: contracts, error: contractsError } = await supabase
        .from('majordhome_contracts')
        .select('id, current_year_visit_status, amount')
        .eq('org_id', orgId)
        .eq('status', 'active');

      if (contractsError) {
        console.error('[sav] getStats contracts error:', contractsError);
        return { data: null, error: contractsError };
      }

      // 2) Interventions kanban (entretiens + SAV) pour l'année en cours
      const { data: interventions, error: intError } = await supabase
        .from('majordhome_entretien_sav')
        .select('intervention_type, workflow_status, contract_id')
        .eq('org_id', orgId);

      if (intError) {
        console.error('[sav] getStats interventions error:', intError);
        return { data: null, error: intError };
      }

      const items = interventions || [];
      const allContracts = contracts || [];

      // Set des contrats ayant un entretien planifié (non réalisé) dans le kanban
      const plannedContractIds = new Set();
      let savCount = 0;
      let entretienPlanifie = 0;

      for (const item of items) {
        if (item.intervention_type === 'sav') {
          // Tout SAV dans le kanban compte (géré cette année)
          savCount++;
        }
        if (item.intervention_type === 'entretien' && item.workflow_status === 'planifie') {
          entretienPlanifie++;
          if (item.contract_id) plannedContractIds.add(item.contract_id);
        }
        if (item.intervention_type === 'entretien' && item.workflow_status === 'a_planifier') {
          if (item.contract_id) plannedContractIds.add(item.contract_id);
        }
      }

      // Compteurs basés sur les contrats
      let entretienRealise = 0;
      let entretienAFaire = 0;
      let caAFaire = 0;
      let caRealise = 0;

      for (const c of allContracts) {
        const amt = Number(c.amount) || 0;
        if (c.current_year_visit_status === 'completed') {
          entretienRealise++;
          caRealise += amt;
        } else {
          // Pas de visite cette année → à faire
          // Si pas dans le kanban → "à faire" (non planifié)
          if (!plannedContractIds.has(c.id)) {
            entretienAFaire++;
            caAFaire += amt;
          }
        }
      }

      const stats = {
        entretien_a_faire: entretienAFaire,       // Contrats sans visite ET sans entretien planifié
        entretien_planifie: entretienPlanifie,     // Entretiens dans le kanban en statut planifié
        entretien_realise: entretienRealise,       // Contrats avec visite complétée cette année
        sav_en_cours: savCount,                    // Nombre total de SAV gérés cette année
        ca_a_faire: caAFaire,                      // CA théorique des entretiens à faire
        ca_realise: caRealise,                     // CA théorique des entretiens réalisés
      };

      return { data: stats, error: null };
    } catch (err) {
      console.error('[sav] getStats error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // CRÉATION
  // ==========================================================================

  /**
   * Créer un entretien (visite annuelle programmée depuis un contrat)
   * projectId est obligatoire (NOT NULL + RLS via projects.org_id)
   * Anti-doublon : refuse si un entretien actif (non réalisé) existe déjà pour ce contrat
   */
  async createEntretien({ orgId, clientId, contractId, projectId, scheduledDate, createdBy }) {
    if (!orgId || !clientId || !projectId) {
      throw new Error('[sav] orgId, clientId et projectId requis');
    }

    try {
      // Anti-doublon : vérifier s'il existe déjà un entretien non réalisé pour ce contrat
      if (contractId) {
        const { data: existing } = await supabase
          .from('majordhome_entretien_sav')
          .select('id, workflow_status')
          .eq('contract_id', contractId)
          .eq('intervention_type', 'entretien')
          .neq('workflow_status', 'realise')
          .limit(1);

        if (existing && existing.length > 0) {
          console.warn('[sav] createEntretien: entretien actif déjà existant pour contrat', contractId);
          return { data: null, error: { message: 'Un entretien est déjà en cours pour ce contrat' } };
        }
      }

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .insert({
          project_id: projectId,
          client_id: clientId,
          contract_id: contractId || null,
          intervention_type: 'entretien',
          workflow_status: 'a_planifier',
          scheduled_date: scheduledDate || null,
          status: 'scheduled',
          created_by: createdBy || null,
          tags: ['Contrat'],
        })
        .select()
        .single();

      if (error) {
        console.error('[sav] createEntretien error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[sav] createEntretien error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Créer un SAV (demande de réparation)
   * projectId est obligatoire (NOT NULL + RLS via projects.org_id)
   */
  async createSAV({ orgId, clientId, contractId, projectId, savDescription, savOrigin, createdBy }) {
    if (!orgId || !clientId || !projectId) {
      throw new Error('[sav] orgId, clientId et projectId requis');
    }

    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .insert({
          project_id: projectId,
          client_id: clientId,
          contract_id: contractId || null,
          intervention_type: 'sav',
          workflow_status: 'demande',
          scheduled_date: null,
          sav_description: savDescription || null,
          sav_origin: savOrigin || 'appel_client',
          status: 'scheduled',
          created_by: createdBy || null,
        })
        .select()
        .single();

      if (error) {
        console.error('[sav] createSAV error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[sav] createSAV error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // MUTATIONS
  // ==========================================================================

  /**
   * Mettre à jour le workflow_status (transition kanban)
   */
  async updateWorkflowStatus(interventionId, newStatus) {
    if (!interventionId || !newStatus) throw new Error('[sav] interventionId et newStatus requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update({ workflow_status: newStatus })
        .eq('id', interventionId)
        .select()
        .single();

      if (error) {
        console.error('[sav] updateWorkflowStatus error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[sav] updateWorkflowStatus error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Mettre à jour le statut commande pièces
   */
  async updatePartsOrderStatus(interventionId, status) {
    if (!interventionId) throw new Error('[sav] interventionId requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update({ parts_order_status: status || null })
        .eq('id', interventionId)
        .select()
        .single();

      if (error) {
        console.error('[sav] updatePartsOrderStatus error:', error);
      }

      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] updatePartsOrderStatus error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Mettre à jour le devis (montant + statut)
   */
  async updateDevis(interventionId, { amount, status }) {
    if (!interventionId) throw new Error('[sav] interventionId requis');

    try {
      const updates = {};
      if (amount !== undefined) updates.devis_amount = amount;
      if (status !== undefined) updates.devis_status = status;

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update(updates)
        .eq('id', interventionId)
        .select()
        .single();

      if (error) {
        console.error('[sav] updateDevis error:', error);
      }

      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] updateDevis error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Mettre à jour les notes
   */
  async updateNotes(interventionId, notes) {
    if (!interventionId) throw new Error('[sav] interventionId requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update({ report_notes: notes || null })
        .eq('id', interventionId)
        .select()
        .single();

      if (error) {
        console.error('[sav] updateNotes error:', error);
      }

      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] updateNotes error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Mettre à jour la description SAV
   */
  async updateSavDescription(interventionId, description) {
    if (!interventionId) throw new Error('[sav] interventionId requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update({ sav_description: description || null })
        .eq('id', interventionId)
        .select()
        .single();

      if (error) {
        console.error('[sav] updateSavDescription error:', error);
      }

      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] updateSavDescription error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Sauvegarde groupée de tous les champs éditables d'un item SAV/Entretien.
   * Utilisé par le bouton "Enregistrer" de la modale.
   * Ne met à jour que les champs fournis (partial update).
   */
  async updateFields(interventionId, fields) {
    if (!interventionId) throw new Error('[sav] interventionId requis');

    try {
      const updates = {};
      if (fields.sav_description !== undefined) updates.sav_description = fields.sav_description || null;
      if (fields.report_notes !== undefined) updates.report_notes = fields.report_notes || null;
      if (fields.devis_amount !== undefined) updates.devis_amount = fields.devis_amount;
      if (fields.devis_status !== undefined) updates.devis_status = fields.devis_status || null;
      if (fields.parts_order_status !== undefined) updates.parts_order_status = fields.parts_order_status || null;
      if (fields.includes_entretien !== undefined) updates.includes_entretien = !!fields.includes_entretien;

      if (Object.keys(updates).length === 0) {
        return { data: null, error: null };
      }

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update(updates)
        .eq('id', interventionId)
        .select()
        .single();

      if (error) {
        console.error('[sav] updateFields error:', error);
      }

      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] updateFields error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // CERTIFICATS MULTI-ÉQUIPEMENTS (interventions enfants)
  // ==========================================================================

  /**
   * Récupérer les interventions enfants d'un parent + données équipement
   */
  async getChildInterventions(parentId) {
    try {
      const { data: children, error } = await supabase
        .from('majordhome_interventions')
        .select('id, parent_id, equipment_id, workflow_status, status, created_at')
        .eq('parent_id', parentId)
        .order('created_at');

      if (error) {
        console.error('[sav] getChildInterventions error:', error);
        return { data: null, error };
      }

      if (!children || children.length === 0) {
        return { data: [], error: null };
      }

      // Fetch equipment details for all children in one query
      const equipmentIds = children
        .map((c) => c.equipment_id)
        .filter(Boolean);

      let equipmentMap = {};
      if (equipmentIds.length > 0) {
        const { data: equipments } = await supabase
          .from('majordhome_equipments')
          .select('id, category, brand, model, serial_number, equipment_type_id')
          .in('id', equipmentIds);

        if (equipments) {
          equipmentMap = Object.fromEntries(equipments.map((e) => [e.id, e]));
        }
      }

      const enriched = children.map((child) => ({
        ...child,
        equipment: equipmentMap[child.equipment_id] || null,
      }));

      return { data: enriched, error: null };
    } catch (err) {
      console.error('[sav] getChildInterventions error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Créer les interventions enfants (1 par équipement du contrat)
   * @param {string} parentId - ID de l'intervention parent
   * @param {Array} equipments - Liste d'équipements [{ id, ... }]
   * @param {Object} ctx - { projectId, clientId, contractId }
   */
  async createChildInterventions(parentId, equipments, { projectId, clientId, contractId }) {
    try {
      const rows = equipments.map((eq) => ({
        parent_id: parentId,
        equipment_id: eq.id,
        project_id: projectId,
        client_id: clientId,
        contract_id: contractId,
        intervention_type: 'entretien',
        workflow_status: 'planifie',
        status: 'scheduled',
      }));

      const { data, error } = await supabase
        .from('majordhome_interventions')
        .insert(rows)
        .select('id, equipment_id, workflow_status, status');

      if (error) {
        console.error('[sav] createChildInterventions error:', error);
      }

      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] createChildInterventions error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Marquer un enfant comme NÉANT (pas d'intervention sur cet équipement)
   */
  async markChildNeant(childId) {
    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update({ workflow_status: 'realise', status: 'cancelled' })
        .eq('id', childId)
        .select()
        .single();

      if (error) console.error('[sav] markChildNeant error:', error);
      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] markChildNeant error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Annuler le NÉANT sur un enfant (revient à « à faire »)
   */
  async unmarkChildNeant(childId) {
    try {
      const { data, error } = await supabase
        .from('majordhome_interventions')
        .update({ workflow_status: 'planifie', status: 'scheduled' })
        .eq('id', childId)
        .select()
        .single();

      if (error) console.error('[sav] unmarkChildNeant error:', error);
      return { data, error: error || null };
    } catch (err) {
      console.error('[sav] unmarkChildNeant error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Vérifier si tous les enfants sont traités et clôturer le parent
   * - Transition parent → realise
   * - Insert maintenance_visit (chaînage annuel)
   * - Sauvegarde report_notes du parent
   */
  async completeParentEntretien(parentId, orgId, reportNotes) {
    try {
      // 1) Vérifier tous les enfants
      const { data: children, error: childErr } = await supabase
        .from('majordhome_interventions')
        .select('id, workflow_status')
        .eq('parent_id', parentId);

      if (childErr) {
        console.error('[sav] completeParentEntretien childErr:', childErr);
        return { data: null, error: childErr };
      }

      const allDone = children && children.length > 0 &&
        children.every((c) => c.workflow_status === 'realise');

      if (!allDone) {
        return { data: { allDone: false }, error: null };
      }

      // 2) Lire le parent pour récupérer scheduled_date + infos technicien
      const { data: parent } = await supabase
        .from('majordhome_interventions')
        .select('contract_id, scheduled_date, technician_id, technician_name, created_by')
        .eq('id', parentId)
        .single();

      // Date d'intervention = scheduled_date du parent (planification) ou date du jour
      const today = new Date().toISOString().split('T')[0];
      const visitDate = parent?.scheduled_date || today;

      // 3) Transition parent → realise + notes + scheduled_date cohérente
      const updates = {
        workflow_status: 'realise',
        status: 'completed',
        report_notes: reportNotes || null,
        scheduled_date: visitDate,
        updated_at: new Date().toISOString(),
      };

      const { error: parentErr } = await supabase
        .from('majordhome_interventions')
        .update(updates)
        .eq('id', parentId);

      if (parentErr) {
        console.error('[sav] completeParentEntretien parentErr:', parentErr);
        return { data: null, error: parentErr };
      }

      // 4) Insert maintenance_visit (chaînage annuel) avec la bonne date
      if (parent?.contract_id) {
        const currentYear = new Date().getFullYear();
        await entretiensService.recordVisit({
          contractId: parent.contract_id,
          orgId,
          year: currentYear,
          visitDate,
          status: 'completed',
          technicianId: parent.technician_id,
          technicianName: parent.technician_name,
          notes: reportNotes || null,
          userId: parent.created_by,
        });
      }

      return { data: { allDone: true }, error: null };
    } catch (err) {
      console.error('[sav] completeParentEntretien error:', err);
      return { data: null, error: err };
    }
  },
};

export default savService;
