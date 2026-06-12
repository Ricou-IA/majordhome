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
import { getMajordhomeOrgId } from '@/lib/serviceHelpers';
import { googleCalendarService } from '@services/googleCalendar.service';
import { leadsService } from '@services/leads.service';


// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Types de RDV avec couleurs FullCalendar
 */
export const APPOINTMENT_TYPES = [
  { value: 'rdv_agency', label: 'RDV Commercial', color: '#F59E0B', bgClass: 'bg-amber-500' },
  { value: 'rdv_technical', label: 'Visite Technique', color: '#3B82F6', bgClass: 'bg-blue-500' },
  { value: 'installation', label: 'Installation', color: '#8B5CF6', bgClass: 'bg-violet-500' },
  { value: 'maintenance', label: 'Entretien', color: '#10B981', bgClass: 'bg-emerald-500' },
  { value: 'service', label: 'SAV', color: '#EF4444', bgClass: 'bg-red-500' },
  { value: 'other', label: 'Autre', color: '#6B7280', bgClass: 'bg-gray-500' },
];

/**
 * Règles d'assignation par type de RDV
 * - commercial: Responsable + Commercial (multi-select 1-2)
 * - technician: Techniciens (multi-select 1-2)
 * - all: Tous les membres (multi-select illimité)
 */
export const COMMERCIAL_TYPES = ['rdv_agency', 'rdv_technical'];
export const TECHNICIAN_TYPES = ['installation', 'maintenance', 'service'];
// 'other' → all members

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
// ORG ID MAPPING — imported from @/lib/serviceHelpers
// ============================================================================

// ============================================================================
// CYCLE DE VIE CARTE <-> RDV (Bloc A)
// ============================================================================

const RDV_PLANIFIE_STATUS_ID = 'e23d04b8-da2e-4477-8e1c-b92868b682ae';

// display_order par status_id (pipeline) — garde forward-only
const STATUS_DISPLAY_ORDER = {
  'ea926b9a-521c-4012-a60b-85b6f7e5c09c': 1, // Nouveau
  '4b1b967d-1c70-4510-8095-60a27e20e244': 2, // Contacté
  'e23d04b8-da2e-4477-8e1c-b92868b682ae': 3, // RDV planifié
  '47937391-5ffa-4804-9b5d-72f3fec6f4fe': 4, // Devis envoyé
  'c717780c-0ba7-4bf1-9e1e-5f014c1e9e2f': 5, // Gagné
  'e0419cea-d0fe-4be5-aba4-56197b2fd4fb': 6, // Perdu
};

// ordre des états chantier — garde forward-only installation
const CHANTIER_ORDER = { gagne: 1, commande_a_faire: 2, commande_recue: 3, planification: 4, realise: 5 };

const VT_TYPES = ['rdv_technical', 'rdv_agency'];

/**
 * Prise de RDV : avance la carte liée en colonne « planifiée » (forward-only).
 * Ne descend jamais une carte plus avancée, ne touche pas une carte clôturée.
 */
async function syncCardStateOnCreate(appt) {
  if (!appt) return;

  // Entretien / SAV -> planifie
  if (appt.intervention_id) {
    const { error } = await supabase
      .from('majordhome_interventions')
      .update({ workflow_status: 'planifie', updated_at: new Date().toISOString() })
      .eq('id', appt.intervention_id)
      .not('workflow_status', 'in', '(realise,facture)');
    if (error) console.error('[appointments] syncCreate entretien error:', error);
    return;
  }
  if (!appt.lead_id) return;

  // Visite Technique -> pipeline « RDV planifié » si en amont
  if (VT_TYPES.includes(appt.appointment_type)) {
    const { data: lead } = await supabase
      .from('majordhome_leads').select('status_id').eq('id', appt.lead_id).maybeSingle();
    const order = STATUS_DISPLAY_ORDER[lead?.status_id] ?? 99;
    if (order < 3) {
      const { error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: appt.lead_id,
        p_updates: { status_id: RDV_PLANIFIE_STATUS_ID, updated_at: new Date().toISOString() },
      });
      if (error) console.error('[appointments] syncCreate VT lead error:', error);
    }
    return;
  }

  // Installation -> chantier « planification » si en amont
  if (appt.appointment_type === 'installation') {
    const { data: lead } = await supabase
      .from('majordhome_leads').select('chantier_status').eq('id', appt.lead_id).maybeSingle();
    const order = CHANTIER_ORDER[lead?.chantier_status] ?? 0;
    if (lead?.chantier_status && order < CHANTIER_ORDER.planification) {
      const { error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: appt.lead_id,
        p_updates: { chantier_status: 'planification', updated_at: new Date().toISOString() },
      });
      if (error) console.error('[appointments] syncCreate install lead error:', error);
    }
  }
}

/**
 * Recalcule l'état d'une carte entretien selon la présence d'un RDV actif :
 * >=1 RDV actif -> planifie, 0 -> a_planifier. Ne touche pas les états terminaux.
 */
async function recomputeEntretienWorkflow(interventionId) {
  if (!interventionId) return;
  const { count } = await supabase
    .from('majordhome_appointments')
    .select('id', { count: 'exact', head: true })
    .eq('intervention_id', interventionId)
    .not('status', 'in', '(cancelled,no_show)');
  const nextStatus = count && count > 0 ? 'planifie' : 'a_planifier';
  const { error } = await supabase
    .from('majordhome_interventions')
    .update({ workflow_status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', interventionId)
    .not('workflow_status', 'in', '(realise,facture)');
  if (error) console.error('[appointments] recomputeEntretien error:', error);
}

/**
 * Suppression / annulation de RDV : recalcule l'état de la carte entretien liée
 * (retour en « À planifier » si c'était le dernier RDV actif). Pipeline/chantier :
 * no-op (le marqueur « à replanifier » est dérivé de has_active_rdv=false dans les vues).
 * À appeler APRÈS la suppression / le changement de statut.
 */
async function syncCardStateOnDelete(appt) {
  if (!appt?.intervention_id) return;
  await recomputeEntretienWorkflow(appt.intervention_id);
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

      // Cycle de vie carte <-> RDV : avance la carte liée en « planifié » (forward-only)
      await syncCardStateOnCreate(appointment);

      // Fire-and-forget Google Calendar sync
      googleCalendarService.syncAppointment('create', appointment, {
        technicianIds,
        assignedCommercialId: appointmentData.assigned_commercial_id,
        orgId: coreOrgId,
      }).catch(() => {});

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
      // Re-planification avec changement de cible (type / liens carte) : lire l'état
      // actuel AVANT l'update pour pouvoir refluer l'ancienne carte après coup.
      // Drag & drop / éditions simples (date, heure, notes) : previous reste null, no-op.
      let previous = null;
      if ('appointment_type' in updates || 'intervention_id' in updates || 'lead_id' in updates) {
        const { data: prev } = await supabase
          .from('majordhome_appointments')
          .select('appointment_type, intervention_id, lead_id')
          .eq('id', appointmentId)
          .maybeSingle();
        previous = prev || null;
      }

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

      // Sync lead.appointment_date si la date a changé (drag&drop, édition modale)
      if ('scheduled_date' in updates && appointment?.lead_id) {
        leadsService
          .updateLead(appointment.lead_id, { appointment_date: updates.scheduled_date })
          .catch((err) => console.error('[appointments] sync lead.appointment_date error:', err));
      }

      // Reflux carte entretien si le statut du RDV a changé (annulation / réactivation)
      if ('status' in updates && appointment?.intervention_id) {
        await recomputeEntretienWorkflow(appointment.intervention_id);
      }

      // Changement de cible (re-typage) : reflux de l'ancienne carte entretien si le
      // RDV ne pointe plus dessus, puis avancée forward-only de la nouvelle cible.
      if (previous) {
        const targetChanged =
          previous.appointment_type !== appointment?.appointment_type ||
          previous.intervention_id !== appointment?.intervention_id ||
          previous.lead_id !== appointment?.lead_id;
        if (targetChanged) {
          if (previous.intervention_id && previous.intervention_id !== appointment?.intervention_id) {
            await recomputeEntretienWorkflow(previous.intervention_id);
          }
          await syncCardStateOnCreate(appointment);
        }
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

      // Fire-and-forget Google Calendar sync
      // For drag & drop (moveAppointment), technicianIds is undefined — load existing ones
      let syncTechIds = technicianIds;
      if (syncTechIds === undefined) {
        const { data: existingTechs } = await supabase
          .from('majordhome_appointment_technicians')
          .select('technician_id')
          .eq('appointment_id', appointmentId);
        syncTechIds = existingTechs?.map(t => t.technician_id) || [];
      }

      googleCalendarService.syncAppointment('update', appointment, {
        technicianIds: syncTechIds,
        assignedCommercialId: updates.assigned_commercial_id || appointment.assigned_commercial_id,
        orgId: appointment.org_id,
      }).catch(() => {});

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
      // Load appointment + technicians BEFORE deleting (needed for Google Calendar sync)
      const { data: appointment } = await supabase
        .from('majordhome_appointments')
        .select('*')
        .eq('id', appointmentId)
        .single();

      const { data: techs } = await supabase
        .from('majordhome_appointment_technicians')
        .select('technician_id')
        .eq('appointment_id', appointmentId);

      // Load sync records BEFORE delete (CASCADE will remove them)
      const { data: syncRecords } = await supabase
        .from('majordhome_google_calendar_sync')
        .select('user_id, google_event_id, google_calendar_id')
        .eq('appointment_id', appointmentId);

      // Supprimer les techniciens d'abord (FK)
      await supabase
        .from('majordhome_appointment_technicians')
        .delete()
        .eq('appointment_id', appointmentId);

      // Le schéma majordhome n'est pas exposé via PostgREST → passer par la vue publique
      // (auto-updatable car mirror 1:1 de majordhome.appointments, RLS DELETE OK)
      const { error } = await supabase
        .from('majordhome_appointments')
        .delete()
        .eq('id', appointmentId);

      if (error) {
        console.error('[appointments] deleteAppointment error:', error);
        return { error };
      }

      // Cycle de vie : reflux de la carte entretien en « À planifier » si dernier RDV
      await syncCardStateOnDelete(appointment);

      // Fire-and-forget Google Calendar sync (delete event)
      // Pass sync records since CASCADE already deleted them from DB
      if (appointment && syncRecords?.length) {
        googleCalendarService.syncAppointment('delete', appointment, {
          technicianIds: techs?.map(t => t.technician_id) || [],
          assignedCommercialId: appointment.assigned_commercial_id,
          orgId: appointment.org_id,
          existingSyncRecords: syncRecords,
        }).catch(() => {});
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

  /**
   * RDV d'un jour donné (enrichis de technician_ids) pour alimenter les colonnes
   * du DayResourceGrid. Filtre org_id, exclut annulés/no_show.
   * NB : la vue majordhome_appointments est un miroir simple (auto-updatable) qui
   * n'agrège PAS les techs — on fait une 2ᵉ requête sur la jointure et on merge
   * (même pattern que useAppointments / getAppointmentById).
   */
  async getTeamDayAvailability({ coreOrgId, date }) {
    try {
      const orgId = await getMajordhomeOrgId(coreOrgId);
      const { data, error } = await supabase
        .from('majordhome_appointments')
        .select('id, subject, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, client_name, client_first_name, assigned_commercial_id')
        .eq('org_id', orgId)
        .eq('scheduled_date', date)
        .not('status', 'in', '(cancelled,no_show)')
        .order('scheduled_start', { ascending: true });
      if (error) { console.error('[appointments] getTeamDayAvailability error:', error); return { data: null, error }; }

      const rows = data || [];
      if (rows.length === 0) return { data: [], error: null };

      // Techniciens par RDV via la table de jointure, puis merge en technician_ids[].
      const ids = rows.map(r => r.id);
      const { data: techLinks } = await supabase
        .from('majordhome_appointment_technicians')
        .select('appointment_id, technician_id')
        .in('appointment_id', ids);
      const byAppt = new Map();
      (techLinks || []).forEach(t => {
        const arr = byAppt.get(t.appointment_id) || [];
        arr.push(t.technician_id);
        byAppt.set(t.appointment_id, arr);
      });
      const enriched = rows.map(r => ({ ...r, technician_ids: byAppt.get(r.id) || [] }));
      return { data: enriched, error: null };
    } catch (err) {
      console.error('[appointments] getTeamDayAvailability error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Crée N appointments (1 par créneau) en réutilisant createAppointment
   * (donc même syncCardStateOnCreate + sync Google par appointment).
   * slots[] = [{ date, startTime, endTime, duration, technicianIds, subject?, notes? }]
   * shared = { coreOrgId, appointment_type, lead_id?, intervention_id?, client_id?,
   *            client_name?, client_first_name?, client_phone?, client_email?,
   *            address?, city?, postal_code?, assigned_commercial_id?, description?, subjectPrefix? }
   * Retourne { data: [appointments...], error } — error = 1ère erreur rencontrée (best-effort, ne rollback pas les précédents).
   */
  async createAppointmentBatch(slots, shared) {
    const created = [];
    for (const slot of slots) {
      const { data, error } = await this.createAppointment({
        coreOrgId: shared.coreOrgId,
        technicianIds: slot.technicianIds || [],
        appointment_type: shared.appointment_type,
        subject: slot.subject || shared.subjectPrefix || null,
        scheduled_date: slot.date,
        scheduled_start: slot.startTime,
        scheduled_end: slot.endTime || null,
        duration_minutes: slot.duration || 60,
        lead_id: shared.lead_id || null,
        intervention_id: shared.intervention_id || null,
        client_id: shared.client_id || null,
        client_name: shared.client_name || null,
        client_first_name: shared.client_first_name || null,
        client_phone: shared.client_phone || null,
        client_email: shared.client_email || null,
        address: shared.address || null,
        city: shared.city || null,
        postal_code: shared.postal_code || null,
        assigned_commercial_id: shared.assigned_commercial_id || null,
        description: shared.description || null,
        status: 'scheduled',
        priority: 'normal',
        internal_notes: slot.notes || null,
      });
      if (error) return { data: created, error };
      created.push(data);
    }
    return { data: created, error: null };
  },

  /**
   * Retire UN technicien d'un RDV (annulation ressource, pas de trace conservée).
   * Le RDV reste actif → pas de reflux de carte (has_active_rdv inchangé).
   * Re-sync Google pour refléter le retrait.
   */
  async removeAppointmentTechnician(appointmentId, technicianId) {
    if (!appointmentId || !technicianId) throw new Error('[appointments] appointmentId & technicianId requis');
    try {
      const { error } = await supabase
        .from('majordhome_appointment_technicians')
        .delete()
        .eq('appointment_id', appointmentId)
        .eq('technician_id', technicianId);
      if (error) { console.error('[appointments] removeAppointmentTechnician error:', error); return { error }; }

      // Re-sync Google avec la liste de techs restante (fire-and-forget).
      const { data: appointment } = await supabase
        .from('majordhome_appointments').select('*').eq('id', appointmentId).maybeSingle();
      const { data: remaining } = await supabase
        .from('majordhome_appointment_technicians').select('technician_id').eq('appointment_id', appointmentId);
      if (appointment) {
        googleCalendarService.syncAppointment('update', appointment, {
          technicianIds: remaining?.map(t => t.technician_id) || [],
          assignedCommercialId: appointment.assigned_commercial_id,
          orgId: appointment.org_id,
        }).catch(() => {});
      }
      return { error: null };
    } catch (err) {
      console.error('[appointments] removeAppointmentTechnician error:', err);
      return { error: err };
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
