/**
 * contracts.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des contrats d'entretien.
 *
 * Lectures : vue enrichie majordhome_contracts (JOIN clients)
 * Écritures : vue simple majordhome_contracts_write (auto-updatable)
 * Table pivot : majordhome_contract_equipments (vue auto-updatable)
 *
 * @version 2.0.0 - Écritures via vue writable, ajout maintenance_month
 * @version 1.0.0 - Création table contracts dédiée
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Statuts de contrat (ENUM majordhome.contract_status)
 */
export const CONTRACT_STATUSES = [
  { value: 'active', label: 'Actif', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'pending', label: 'En attente', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'cancelled', label: 'Clos', color: 'bg-gray-100 text-gray-600 border-gray-200' },
  { value: 'archived', label: 'Archivé', color: 'bg-slate-100 text-slate-500 border-slate-200' },
];

/**
 * Fréquences de contrat (ENUM majordhome.contract_frequency)
 */
export const CONTRACT_FREQUENCIES = [
  { value: 'mensuel', label: 'Mensuel' },
  { value: 'trimestriel', label: 'Trimestriel' },
  { value: 'semestriel', label: 'Semestriel' },
  { value: 'annuel', label: 'Annuel' },
  { value: 'biannuel', label: 'Biannuel' },
];

/**
 * Mois de l'année pour le champ maintenance_month
 */
export const MAINTENANCE_MONTHS = [
  { value: 1, label: 'Janvier' },
  { value: 2, label: 'Février' },
  { value: 3, label: 'Mars' },
  { value: 4, label: 'Avril' },
  { value: 5, label: 'Mai' },
  { value: 6, label: 'Juin' },
  { value: 7, label: 'Juillet' },
  { value: 8, label: 'Août' },
  { value: 9, label: 'Septembre' },
  { value: 10, label: 'Octobre' },
  { value: 11, label: 'Novembre' },
  { value: 12, label: 'Décembre' },
];

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const contractsService = {
  // ==========================================================================
  // LECTURE
  // ==========================================================================

  /**
   * Récupère le contrat d'un client (1 client = max 1 contrat)
   * @param {string} clientId - UUID du client
   */
  async getContractByClientId(clientId) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[contractsService] clientId requis');
      const { data, error } = await supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'contracts.getContractByClientId');
  },

  /**
   * Récupère un contrat par ID
   */
  async getContractById(contractId) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');
      const { data, error } = await supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('id', contractId)
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.getContractById');
  },

  // ==========================================================================
  // CRÉATION
  // ==========================================================================

  /**
   * Crée un contrat pour un client
   */
  async createContract({
    orgId,
    clientId,
    status = 'active',
    workflowStatus = null,
    frequency = 'annuel',
    startDate = null,
    endDate = null,
    nextMaintenanceDate = null,
    maintenanceMonth = null,
    amount = null,
    estimatedTime = null,
    notes = null,
    zoneId = null,
    subtotal = null,
    discountPercent = null,
    source = 'manual',
  } = {}) {
    return withErrorHandling(async () => {
      if (!orgId || !clientId) throw new Error('[contractsService] orgId et clientId requis');
      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .insert({
          org_id: orgId,
          client_id: clientId,
          status,
          workflow_status: workflowStatus || null,
          frequency,
          start_date: startDate,
          end_date: endDate,
          next_maintenance_date: nextMaintenanceDate,
          maintenance_month: maintenanceMonth ? parseInt(maintenanceMonth) : null,
          amount: amount ? parseFloat(amount) : null,
          estimated_time: estimatedTime ? parseFloat(estimatedTime) : null,
          notes,
          zone_id: zoneId || null,
          subtotal: subtotal ? parseFloat(subtotal) : null,
          discount_percent: discountPercent ? parseFloat(discountPercent) : null,
          source: source || 'manual',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.createContract');
  },

  // ==========================================================================
  // MISE À JOUR
  // ==========================================================================

  /**
   * Met à jour un contrat
   */
  async updateContract(contractId, updates = {}) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');

      const updateData = {};
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.frequency !== undefined) updateData.frequency = updates.frequency;
      if (updates.startDate !== undefined) updateData.start_date = updates.startDate || null;
      if (updates.endDate !== undefined) updateData.end_date = updates.endDate || null;
      if (updates.nextMaintenanceDate !== undefined) updateData.next_maintenance_date = updates.nextMaintenanceDate || null;
      if (updates.maintenanceMonth !== undefined) updateData.maintenance_month = updates.maintenanceMonth ? parseInt(updates.maintenanceMonth) : null;
      if (updates.amount !== undefined) updateData.amount = updates.amount ? parseFloat(updates.amount) : null;
      if (updates.estimatedTime !== undefined) updateData.estimated_time = updates.estimatedTime ? parseFloat(updates.estimatedTime) : null;
      if (updates.notes !== undefined) updateData.notes = updates.notes || null;
      if (updates.workflow_status !== undefined) updateData.workflow_status = updates.workflow_status;
      updateData.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update(updateData)
        .eq('id', contractId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.updateContract');
  },

  // ==========================================================================
  // CLÔTURE
  // ==========================================================================

  /**
   * Clôturer un contrat (passe en cancelled avec raison)
   */
  async closeContract(contractId, reason) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');
      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update({
          status: 'cancelled',
          cancellation_reason: reason || null,
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', contractId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.closeContract');
  },

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  /**
   * Supprime un contrat
   */
  async deleteContract(contractId) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');
      const { error } = await supabase
        .from('majordhome_contracts_write')
        .delete()
        .eq('id', contractId);
      if (error) throw error;
      return { success: true };
    }, 'contracts.deleteContract');
  },

  // ==========================================================================
  // ÉQUIPEMENTS DU CONTRAT
  // ==========================================================================

  /**
   * Récupère les équipements liés à un contrat
   */
  async getContractEquipments(contractId) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');

      const { data: links, error: linksError } = await supabase
        .from('majordhome_contract_equipments')
        .select('equipment_id')
        .eq('contract_id', contractId);
      if (linksError) throw linksError;
      if (!links || links.length === 0) return [];

      const equipmentIds = links.map(l => l.equipment_id);
      const { data, error } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .in('id', equipmentIds)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }, 'contracts.getContractEquipments');
  },

  /**
   * Ajoute un équipement au contrat
   */
  async addEquipmentToContract(contractId, equipmentId) {
    return withErrorHandling(async () => {
      if (!contractId || !equipmentId) throw new Error('[contractsService] contractId et equipmentId requis');
      const { data, error } = await supabase
        .from('majordhome_contract_equipments')
        .insert({ contract_id: contractId, equipment_id: equipmentId })
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.addEquipmentToContract');
  },

  /**
   * Retire un équipement du contrat
   */
  async removeEquipmentFromContract(contractId, equipmentId) {
    return withErrorHandling(async () => {
      if (!contractId || !equipmentId) throw new Error('[contractsService] contractId et equipmentId requis');
      const { error } = await supabase
        .from('majordhome_contract_equipments')
        .delete()
        .eq('contract_id', contractId)
        .eq('equipment_id', equipmentId);
      if (error) throw error;
      return { success: true };
    }, 'contracts.removeEquipmentFromContract');
  },
  /**
   * Mappe un code pricing_equipment_types vers l'ENUM equipment_category.
   * L'ENUM DB est : pac_air_air, pac_air_eau, chaudiere_gaz, chaudiere_fioul,
   * chaudiere_bois, vmc, climatisation, chauffe_eau_thermo, ballon_ecs, poele, autre.
   * Les codes pricing sont plus fins (ex: poele_granules_elec) → on regroupe sur l'ENUM le plus proche.
   */
  _pricingCodeToEquipmentCategory(code) {
    if (!code) return 'autre';
    const c = String(code).toLowerCase();
    if (c.startsWith('poele')) return 'poele';
    if (c === 'pac_air_air') return 'pac_air_air';
    if (c === 'pac_air_eau') return 'pac_air_eau';
    if (c === 'gainable') return 'climatisation';
    if (c === 'chaudiere_gaz') return 'chaudiere_gaz';
    if (c === 'chaudiere_fioul') return 'chaudiere_fioul';
    if (c === 'chaudiere_bois' || c === 'chaudiere_granules') return 'chaudiere_bois';
    if (c === 'vmc') return 'vmc';
    if (c === 'ballon_thermo' || c === 'chauffe_eau_thermo') return 'chauffe_eau_thermo';
    if (c === 'chauffe_eau_solaire' || c === 'ballon_ecs') return 'ballon_ecs';
    return 'autre';
  },

  /**
   * Crée les équipements réels + liens contract_equipments à partir des pricing items sélectionnés.
   * Appelé après création du contrat pour alimenter la section "Équipements sous contrat".
   * @param {string} contractId
   * @param {string} clientId
   * @param {Array} pricingItems - [{ equipmentTypeId, equipmentTypeCode, label, quantity }]
   */
  async createEquipmentsFromPricingItems(contractId, clientId, pricingItems) {
    if (!contractId || !clientId || !pricingItems?.length) return { data: null, error: null };

    return withErrorHandling(async () => {
      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients')
        .select('project_id, org_id')
        .eq('id', clientId)
        .single();
      if (clientError) throw clientError;

      const equipmentIds = [];
      for (const item of pricingItems) {
        const qty = item.quantity || 1;
        const category = this._pricingCodeToEquipmentCategory(item.equipmentTypeCode);
        for (let i = 0; i < qty; i++) {
          const { data: eq, error: eqError } = await supabase
            .from('majordhome_equipments')
            .insert({
              project_id: client.project_id,
              category,
              equipment_type_id: item.equipmentTypeId || null,
              contract_status: 'active',
            })
            .select('id')
            .single();
          if (eqError) { console.warn('[contracts] equipment insert skipped:', eqError); continue; }
          equipmentIds.push(eq.id);
        }
      }

      if (equipmentIds.length > 0) {
        const links = equipmentIds.map((eqId) => ({ contract_id: contractId, equipment_id: eqId }));
        const { error: linkError } = await supabase.from('majordhome_contract_equipments').insert(links);
        if (linkError) console.warn('[contracts] links insert error:', linkError);
      }

      return equipmentIds;
    }, 'contracts.createEquipmentsFromPricingItems');
  },

  // ==========================================================================
  // SIGNATURE
  // ==========================================================================

  /**
   * Invalide la signature d'un contrat (après changement d'équipements).
   * Remet signed_at, signature et PDF à null pour forcer une re-signature.
   */
  async resetContractSignature(contractId) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');
      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update({
          signed_at: null,
          signature_client_base64: null,
          signature_client_nom: null,
          contract_pdf_path: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contractId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.resetContractSignature');
  },

  /**
   * Enregistre un contrat signé papier (upload scan/photo) — met à jour le PDF path + signed_at
   */
  async uploadSignedContract(contractId, pdfPath, signataireNom = null) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');
      const now = new Date().toISOString();
      const updateData = { contract_pdf_path: pdfPath, signed_at: now, updated_at: now };
      if (signataireNom) updateData.signature_client_nom = signataireNom;

      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update(updateData)
        .eq('id', contractId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.uploadSignedContract');
  },

  /**
   * Enregistre la signature client sur un contrat + met à jour le PDF path
   */
  async signContract(contractId, signatureBase64, signataireNom, pdfPath = null) {
    return withErrorHandling(async () => {
      if (!contractId) throw new Error('[contractsService] contractId requis');
      const now = new Date().toISOString();
      const updateData = {
        signature_client_base64: signatureBase64,
        signature_client_nom: signataireNom,
        signed_at: now,
        updated_at: now,
      };
      if (pdfPath) updateData.contract_pdf_path = pdfPath;

      const { data, error } = await supabase
        .from('majordhome_contracts_write')
        .update(updateData)
        .eq('id', contractId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'contracts.signContract');
  },
};

export default contractsService;
