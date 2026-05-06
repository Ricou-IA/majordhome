/**
 * chantierSlots.service.js — Majord'home Artisan
 * ============================================================================
 * Service TRANSITOIRE pour exposer les slots chantier (interventions enfants)
 * sur le planning équipe.
 *
 * À supprimer en Phase 1 quand les slots seront migrés vers `appointments`.
 *
 * @version 1.0.0 - Phase 0 quick fix
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, getMajordhomeOrgId } from '@/lib/serviceHelpers';

export const chantierSlotsService = {
  /**
   * Récupère les slots chantier dans une fenêtre de dates.
   *
   * @param {Object} params
   * @param {string} params.coreOrgId - ID core.organizations (depuis useAuth)
   * @param {string} params.startDate - Date début (YYYY-MM-DD)
   * @param {string} params.endDate - Date fin (YYYY-MM-DD)
   * @returns {Promise<{ data: Array, error: Error|null }>}
   */
  async getChantierSlots({ coreOrgId, startDate, endDate }) {
    if (!coreOrgId || !startDate || !endDate) {
      return { data: [], error: null };
    }

    return withErrorHandling(async () => {
      // NOTE : la vue expose `org_id` issu de `leads.org_id` qui pointe sur core.organizations.id
      // (cf. CLAUDE.md "Leads utilisent directement core.organizations.id").
      // On ne passe donc pas par getMajordhomeOrgId pour le filtre — on utilise le coreOrgId direct.
      const { data, error } = await supabase
        .from('majordhome_intervention_slots')
        .select('*')
        .eq('org_id', coreOrgId)
        .gte('slot_date', startDate)
        .lte('slot_date', endDate)
        .order('slot_date', { ascending: true })
        .order('slot_start_time', { ascending: true });

      if (error) throw error;
      return data || [];
    }, 'chantierSlots.getChantierSlots');
  },

  /**
   * Convertit un slot en event FullCalendar.
   * Couleur teal/cyan + titre "🔨 Chantier {client} J{X}/{N}".
   */
  toCalendarEvent(slot) {
    const fullName = [slot.chantier_client_name, slot.chantier_client_first_name]
      .filter(Boolean)
      .join(' ') || 'Chantier';

    const dayLabel = slot.chantier_total_days > 1
      ? ` J${slot.chantier_day_index}/${slot.chantier_total_days}`
      : '';

    const startStr = slot.slot_start_time
      ? `${slot.slot_date}T${slot.slot_start_time}`
      : slot.slot_date;
    const endStr = slot.slot_end_time
      ? `${slot.slot_date}T${slot.slot_end_time}`
      : null;

    return {
      id: `chantier-slot-${slot.id}`,
      title: `🔨 ${fullName}${dayLabel}`,
      start: startStr,
      end: endStr,
      backgroundColor: '#0D9488',
      borderColor: '#0D9488',
      textColor: '#FFFFFF',
      extendedProps: {
        appointment_kind: 'chantier_slot',
        slot_id: slot.id,
        parent_lead_id: slot.parent_lead_id,
        client_name: slot.chantier_client_name,
        client_first_name: slot.chantier_client_first_name,
        address: slot.chantier_address,
        postal_code: slot.chantier_postal_code,
        city: slot.chantier_city,
        technician_ids: slot.technician_ids || [],
        technician_names: slot.technician_names || [],
        day_index: slot.chantier_day_index,
        total_days: slot.chantier_total_days,
        notes: slot.slot_notes,
      },
    };
  },
};

export default chantierSlotsService;
