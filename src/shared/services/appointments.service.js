/**
 * appointments.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion du planning et des rendez-vous.
 *
 * Utilise majordhome.appointments via la vue publique majordhome_appointments.
 * Les techniciens sont dans majordhome.team_members via majordhome_team_members.
 *
 * IMPORTANT: Les tables appointments et team_members utilisent org_id
 * provenant de majordhome.organizations (pas core.organizations).
 * La fonction getMajordhomeOrgId() résout le mapping.
 *
 * @version 1.0.0 - Sprint 2 Planning
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Types de RDV avec couleurs FullCalendar
 */
export const APPOINTMENT_TYPES = [
  { value: 'rdv_agency', label: 'RDV Agence', color: '#F59E0B', bgClass: 'bg-amber-500' },
  { value: 'rdv_technical', label: 'RDV Technique', color: '#3B82F6', bgClass: 'bg-blue-500' },
  { value: 'installation', label: 'Installation', color: '#8B5CF6', bgClass: 'bg-violet-500' },
  { value: 'maintenance', label: 'Entretien', color: '#10B981', bgClass: 'bg-emerald-500' },
  { value: 'service', label: 'SAV', color: '#EF4444', bgClass: 'bg-red-500' },
  { value: 'intervention', label: 'Intervention', color: '#6366F1', bgClass: 'bg-indigo-500' },
  { value: 'other', label: 'Autre', color: '#6B7280', bgClass: 'bg-gray-500' },
];

/**
 * Statuts de RDV
 */
export const APPOINTMENT_STATUSES = [
  { value: 'scheduled', label: 'Planifié', color: 'bg-blue-100 text-blue-700' },
  { value: 'confirmed', label: 'Confirmé', color: 'bg-green-100 text-green-700' },
  { value: 'in_progress', label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  { value: 'completed', label: 'Terminé', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'cancelled', label: 'Annulé', color: 'bg-red-100 text-red-700' },
  { value: 'no_show', label: 'Absent', color: 'bg-gray-100 text-gray-700' },
];

/**
 * Niveaux de priorité
 */
export const PRIORITIES = [
  { value: 'low', label: 'Basse', color: 'text-gray-500' },
  { value: 'normal', label: 'Normale', color: 'text-blue-500' },
  { value: 'high', label: 'Haute', color: 'text-orange-500' },
  { value: 'urgent', label: 'Urgente', color: 'text-red-500' },
];

/**
 * Retourne la config d'un type de RDV
 */
export function getAppointmentTypeConfig(type) {
  return APPOINTMENT_TYPES.find(t => t.value === type) || APPOINTMENT_TYPES[APPOINTMENT_TYPES.length - 1];
}

// ============================================================================
// CACHE ORG ID MAPPING
// ============================================================================

let orgIdCache = {};

/**
 * Résout core.organizations.id → majordhome.organizations.id
 * Les tables appointments et team_members utilisent majordhome.organizations.org_id
 */
async function getMajordhomeOrgId(coreOrgId) {
  if (!coreOrgId) throw new Error('[appointments] coreOrgId requis');

  // Cache hit
  if (orgIdCache[coreOrgId]) return orgIdCache[coreOrgId];

  const { data, error } = await supabase
    .from('majordhome_organizations')
    .select('id')
    .eq('core_org_id', coreOrgId)
    .single();

  if (error || !data) {
    console.error('[appointments] Impossible de résoudre org_id:', error);
    throw new Error('Organisation majordhome introuvable pour cet org_id');
  }

  orgIdCache[coreOrgId] = data.id;
  return data.id;
}

// ============================================================================
// SERVICE
// ============================================================================

export const appointmentsService = {
  // ==========================================================================
  // APPOINTMENTS - CRUD
  // ==========================================================================

  /**
   * Récupérer les RDV pour une période donnée
   * @param {Object} params
   * @param {string} params.coreOrgId - ID core.organizations
   * @param {string} params.startDate - Date début (YYYY-MM-DD)
   * @param {string} params.endDate - Date fin (YYYY-MM-DD)
   * @param {string} [params.technicianId] - Filtrer par technicien
   * @param {string} [params.appointmentType] - Filtrer par type
   * @param {string} [params.status] - Filtrer par statut
   */
  async getAppointments({ coreOrgId, startDate, endDate, technicianId, appointmentType, status }) {
    try {
      const orgId = await getMajordhomeOrgId(coreOrgId);

      let query = supabase
        .from('majordhome_appointments')
        .select('*')
        .eq('org_id', orgId)
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .order('scheduled_date', { ascending: true })
        .order('scheduled_start', { ascending: true });

      if (appointmentType) query = query.eq('appointment_type', appointmentType);
      if (status) query = query.eq('status', status);

      const { data, error } = await query;

      if (error) {
        console.error('[appointments] getAppointments error:', error);
        return { data: null, error };
      }

      // Si filtre technicien, on filtre côté client via appointment_technicians
      let filteredData = data;
      if (technicianId && data?.length > 0) {
        const appointmentIds = data.map(a => a.id);
        const { data: techLinks } = await supabase
          .from('majordhome_appointment_technicians')
          .select('appointment_id')
          .eq('technician_id', technicianId)
          .in('appointment_id', appointmentIds);

        if (techLinks) {
          const linkedIds = new Set(techLinks.map(t => t.appointment_id));
          filteredData = data.filter(a => linkedIds.has(a.id));
        }
      }

      return { data: filteredData, error: null };
    } catch (err) {
      console.error('[appointments] getAppointments error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Récupérer un RDV par ID avec ses techniciens
   */
  async getAppointmentById(appointmentId) {
    if (!appointmentId) throw new Error('[appointments] appointmentId requis');

    try {
      const { data: appointment, error } = await supabase
        .from('majordhome_appointments')
        .select('*')
        .eq('id', appointmentId)
        .single();

      if (error) return { data: null, error };

      // Charger les techniciens assignés
      const { data: technicians } = await supabase
        .from('majordhome_appointment_technicians')
        .select('technician_id')
        .eq('appointment_id', appointmentId);

      return {
        data: {
          ...appointment,
          technician_ids: technicians?.map(t => t.technician_id) || [],
        },
        error: null,
      };
    } catch (err) {
      console.error('[appointments] getAppointmentById error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Créer un nouveau RDV
   * @param {Object} appointmentData - Données du RDV
   * @param {string} appointmentData.coreOrgId - ID core.organizations
   * @param {string[]} [appointmentData.technicianIds] - IDs techniciens à assigner
   */
  async createAppointment({ coreOrgId, technicianIds = [], ...appointmentData }) {
    try {
      const orgId = await getMajordhomeOrgId(coreOrgId);

      const { data: appointment, error } = await supabase
        .from('majordhome_appointments')
        .insert({
          org_id: orgId,
          ...appointmentData,
        })
        .select()
        .single();

      if (error) {
        console.error('[appointments] createAppointment error:', error);
        return { data: null, error };
      }

      // Assigner les techniciens
      if (technicianIds.length > 0) {
        const techRows = technicianIds.map(techId => ({
          appointment_id: appointment.id,
          technician_id: techId,
          role: technicianIds[0] === techId ? 'lead' : 'assistant',
        }));

        await supabase
          .from('majordhome_appointment_technicians')
          .insert(techRows);
      }

      return { data: { ...appointment, technician_ids: technicianIds }, error: null };
    } catch (err) {
      console.error('[appointments] createAppointment error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Mettre à jour un RDV
   */
  async updateAppointment(appointmentId, { technicianIds, ...updates }) {
    if (!appointmentId) throw new Error('[appointments] appointmentId requis');

    try {
      const { data: appointment, error } = await supabase
        .from('majordhome_appointments')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', appointmentId)
        .select()
        .single();

      if (error) {
        console.error('[appointments] updateAppointment error:', error);
        return { data: null, error };
      }

      // Mettre à jour les techniciens si fournis
      if (technicianIds !== undefined) {
        // Supprimer les anciens
        await supabase
          .from('majordhome_appointment_technicians')
          .delete()
          .eq('appointment_id', appointmentId);

        // Insérer les nouveaux
        if (technicianIds.length > 0) {
          const techRows = technicianIds.map(techId => ({
            appointment_id: appointmentId,
            technician_id: techId,
            role: technicianIds[0] === techId ? 'lead' : 'assistant',
          }));

          await supabase
            .from('majordhome_appointment_technicians')
            .insert(techRows);
        }
      }

      return { data: { ...appointment, technician_ids: technicianIds }, error: null };
    } catch (err) {
      console.error('[appointments] updateAppointment error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Déplacer un RDV (drag & drop FullCalendar)
   */
  async moveAppointment(appointmentId, { scheduled_date, scheduled_start, scheduled_end, duration_minutes }) {
    return this.updateAppointment(appointmentId, {
      scheduled_date,
      scheduled_start,
      scheduled_end,
      duration_minutes,
    });
  },

  /**
   * Annuler un RDV
   */
  async cancelAppointment(appointmentId, reason = '') {
    return this.updateAppointment(appointmentId, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    });
  },

  /**
   * Supprimer un RDV
   */
  async deleteAppointment(appointmentId) {
    if (!appointmentId) throw new Error('[appointments] appointmentId requis');

    try {
      // Supprimer les techniciens d'abord (FK)
      await supabase
        .from('majordhome_appointment_technicians')
        .delete()
        .eq('appointment_id', appointmentId);

      const { error } = await supabase
        .from('majordhome_appointments')
        .delete()
        .eq('id', appointmentId);

      if (error) {
        console.error('[appointments] deleteAppointment error:', error);
        return { error };
      }

      return { error: null };
    } catch (err) {
      console.error('[appointments] deleteAppointment error:', err);
      return { error: err };
    }
  },

  // ==========================================================================
  // TEAM MEMBERS
  // ==========================================================================

  /**
   * Récupérer les techniciens de l'organisation
   */
  async getTeamMembers(coreOrgId) {
    try {
      const orgId = await getMajordhomeOrgId(coreOrgId);

      const { data, error } = await supabase
        .from('majordhome_team_members')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('display_name', { ascending: true });

      if (error) {
        console.error('[appointments] getTeamMembers error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[appointments] getTeamMembers error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Récupérer les techniciens assignés à un RDV
   */
  async getAppointmentTechnicians(appointmentId) {
    if (!appointmentId) return { data: [], error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_appointment_technicians')
        .select(`
          technician_id,
          role,
          confirmed,
          confirmed_at
        `)
        .eq('appointment_id', appointmentId);

      if (error) return { data: null, error };

      return { data: data || [], error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // HELPERS - Conversion FullCalendar
  // ==========================================================================

  /**
   * Convertit un appointment DB → event FullCalendar
   */
  toCalendarEvent(appointment) {
    const typeConfig = getAppointmentTypeConfig(appointment.appointment_type);

    // Construire les datetimes ISO
    const startStr = `${appointment.scheduled_date}T${appointment.scheduled_start}`;
    const endStr = appointment.scheduled_end
      ? `${appointment.scheduled_date}T${appointment.scheduled_end}`
      : null;

    return {
      id: appointment.id,
      title: appointment.subject || `${typeConfig.label} - ${[appointment.client_name, appointment.client_first_name].filter(Boolean).join(' ')}`,
      start: startStr,
      end: endStr,
      backgroundColor: typeConfig.color,
      borderColor: typeConfig.color,
      textColor: '#FFFFFF',
      extendedProps: {
        ...appointment,
        typeConfig,
      },
    };
  },

  /**
   * Convertit un event FullCalendar → données update DB
   */
  fromCalendarEvent(event) {
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : null;

    const pad = (n) => String(n).padStart(2, '0');

    return {
      scheduled_date: start.toISOString().split('T')[0],
      scheduled_start: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      scheduled_end: end ? `${pad(end.getHours())}:${pad(end.getMinutes())}` : null,
      duration_minutes: end ? Math.round((end - start) / 60000) : null,
    };
  },
};

export default appointmentsService;
