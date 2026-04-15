/**
 * equipments.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des équipements clients.
 *
 * Extrait de clients.service.js pour séparation des responsabilités.
 * Les équipements sont liés aux clients via project_id (FK core.projects).
 *
 * @version 1.0.0
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

// ============================================================================
// SERVICE ÉQUIPEMENTS
// ============================================================================

export const equipmentsService = {
  /**
   * Récupère les équipements d'un client via son project_id
   */
  async getClientEquipments(clientId) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[equipmentsService] clientId est requis');

      // Récupérer le project_id
      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients')
        .select('project_id')
        .eq('id', clientId)
        .single();

      if (clientError) throw clientError;

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .select('*')
        .eq('project_id', client.project_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    }, 'equipments.getClientEquipments');
  },

  /**
   * Ajoute un équipement à un client
   */
  async addEquipment(clientId, equipmentData = {}) {
    return withErrorHandling(async () => {
      if (!clientId) throw new Error('[equipmentsService] clientId est requis');

      // Récupérer le project_id
      const { data: client, error: clientError } = await supabase
        .from('majordhome_clients')
        .select('project_id, org_id')
        .eq('id', clientId)
        .single();

      if (clientError) throw clientError;

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .insert({
          project_id: client.project_id,
          category: equipmentData.category,
          equipment_type_id: equipmentData.equipmentTypeId || null,
          brand: equipmentData.brand,
          model: equipmentData.model,
          serial_number: equipmentData.serialNumber,
          install_date: equipmentData.installDate,
          warranty_end_date: equipmentData.warrantyEndDate,
          maintenance_frequency_months: equipmentData.maintenanceFrequency,
          contract_type: equipmentData.contractType,
          contract_tarif: equipmentData.contractTarif,
          contract_start_date: equipmentData.contractStartDate,
          contract_status: equipmentData.contractStatus || 'none',
          installation_year: equipmentData.installationYear ? parseInt(equipmentData.installationYear) : null,
          installation_type: equipmentData.installationType || null,
          supplier_product_id: equipmentData.supplierProductId || null,
          unit_count: equipmentData.unitCount ? parseInt(equipmentData.unitCount) : 1,
          notes: equipmentData.notes,
        })
        .select()
        .single();

      if (error) throw error;

      // Ajouter activité timeline
      await supabase
        .from('majordhome_client_activities')
        .insert({
          client_id: clientId,
          org_id: client.org_id,
          activity_type: 'equipment_added',
          title: 'Équipement ajouté',
          description: `${equipmentData.brand || ''} ${equipmentData.model || ''} (${equipmentData.category || ''})`.trim(),
          reference_type: 'equipment',
          reference_id: data.id,
          is_system: true,
        });

      return data;
    }, 'equipments.addEquipment');
  },

  /**
   * Met à jour un équipement
   */
  async updateEquipment(equipmentId, updates = {}) {
    return withErrorHandling(async () => {
      if (!equipmentId) throw new Error('[equipmentsService] equipmentId est requis');

      const updateData = {};
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.equipmentTypeId !== undefined) updateData.equipment_type_id = updates.equipmentTypeId || null;
      if (updates.brand !== undefined) updateData.brand = updates.brand;
      if (updates.model !== undefined) updateData.model = updates.model;
      if (updates.serialNumber !== undefined) updateData.serial_number = updates.serialNumber;
      if (updates.installDate !== undefined) updateData.install_date = updates.installDate;
      if (updates.warrantyEndDate !== undefined) updateData.warranty_end_date = updates.warrantyEndDate;
      if (updates.maintenanceFrequency !== undefined) updateData.maintenance_frequency_months = updates.maintenanceFrequency;
      if (updates.lastMaintenanceDate !== undefined) updateData.last_maintenance_date = updates.lastMaintenanceDate;
      if (updates.nextMaintenanceDue !== undefined) updateData.next_maintenance_due = updates.nextMaintenanceDue;
      if (updates.contractType !== undefined) updateData.contract_type = updates.contractType;
      if (updates.contractTarif !== undefined) updateData.contract_tarif = updates.contractTarif;
      if (updates.contractStartDate !== undefined) updateData.contract_start_date = updates.contractStartDate;
      if (updates.contractStatus !== undefined) updateData.contract_status = updates.contractStatus;
      if (updates.installationYear !== undefined) updateData.installation_year = updates.installationYear ? parseInt(updates.installationYear) : null;
      if (updates.installationType !== undefined) updateData.installation_type = updates.installationType || null;
      if (updates.supplierProductId !== undefined) updateData.supplier_product_id = updates.supplierProductId || null;
      if (updates.unitCount !== undefined) updateData.unit_count = updates.unitCount ? parseInt(updates.unitCount) : 1;
      if (updates.notes !== undefined) updateData.notes = updates.notes;
      if (updates.status !== undefined) updateData.status = updates.status;

      const { data, error } = await supabase
        .from('majordhome_equipments')
        .update(updateData)
        .eq('id', equipmentId)
        .select()
        .single();

      if (error) throw error;
      return data;
    }, 'equipments.updateEquipment');
  },

  /**
   * Supprime un équipement
   */
  async deleteEquipment(equipmentId) {
    return withErrorHandling(async () => {
      if (!equipmentId) throw new Error('[equipmentsService] equipmentId est requis');

      const { error } = await supabase
        .from('majordhome_equipments')
        .delete()
        .eq('id', equipmentId);

      if (error) throw error;
      return true;
    }, 'equipments.deleteEquipment');
  },
};

export default equipmentsService;
