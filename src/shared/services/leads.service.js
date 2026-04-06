/**
 * leads.service.js - Majord'home Artisan
 * ============================================================================
 * Service de gestion des leads du pipeline commercial.
 *
 * Utilise les vues publiques pour les LECTURES enrichies :
 * - majordhome_leads (enrichie avec status_label, source_name, etc.)
 * - majordhome_sources
 * - majordhome_statuses
 * - majordhome_lead_activities (enrichie avec old/new status labels)
 *
 * Utilise des RPC SECURITY DEFINER pour les ECRITURES :
 * - update_majordhome_lead(p_lead_id, p_updates)
 * - get_majordhome_lead_raw(p_lead_id)
 * - create_majordhome_lead(p_data)
 * - create_majordhome_lead_activity(p_data)
 *
 * Le schema majordhome n'est PAS expose dans PostgREST,
 * donc .schema('majordhome') provoque des erreurs 406.
 *
 * @version 3.2.0 - withErrorHandling refactor
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, withErrorHandlingCount } from '@/lib/serviceHelpers';
import { clientsService } from '@services/clients.service';
import { technicalVisitService } from '@services/technicalVisit.service';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Types d'activite pour lead_activities
 */
export const LEAD_ACTIVITY_TYPES = {
  LEAD_CREATED: 'lead_created',
  STATUS_CHANGED: 'status_changed',
  NOTE: 'note',
  LEAD_ASSIGNED: 'lead_assigned',
  LEAD_CONVERTED: 'lead_converted',
  PHONE_CALL: 'phone_call',
  FOLLOWUP: 'followup',
  EMAIL_SENT: 'email_sent',
  EMAIL_RECEIVED: 'email_received',
};

/**
 * Icones/couleurs par type d'activite (pour la timeline)
 */
export const ACTIVITY_CONFIG = {
  lead_created: { icon: 'Plus', color: 'bg-emerald-100 text-emerald-700' },
  status_changed: { icon: 'ArrowRight', color: 'bg-blue-100 text-blue-700' },
  note: { icon: 'MessageSquare', color: 'bg-gray-100 text-gray-700' },
  lead_assigned: { icon: 'UserPlus', color: 'bg-violet-100 text-violet-700' },
  lead_converted: { icon: 'CheckCircle', color: 'bg-emerald-100 text-emerald-700' },
  phone_call: { icon: 'Phone', color: 'bg-amber-100 text-amber-700' },
  followup: { icon: 'PhoneForwarded', color: 'bg-purple-100 text-purple-700' },
  email_sent: { icon: 'Mail', color: 'bg-blue-100 text-blue-700' },
  email_received: { icon: 'MailOpen', color: 'bg-blue-100 text-blue-700' },
};

// ============================================================================
// HELPERS INTERNES
// ============================================================================

/**
 * Transforme un lead brut (vue plate) en objet structure avec `statuses` et `sources`
 * pour compatibilite avec les composants existants (LeadCard, LeadKanban, etc.)
 */
function enrichLead(row) {
  if (!row) return null;
  return {
    ...row,
    // Objet imbrique `statuses` pour compat composants
    statuses: {
      id: row.status_id,
      label: row.status_label,
      color: row.status_color,
      display_order: row.status_display_order,
      is_final: row.status_is_final,
      is_won: row.status_is_won,
    },
    // Objet imbrique `sources` pour compat composants
    sources: row.source_id ? {
      id: row.source_id,
      name: row.source_name,
      color: row.source_color,
    } : null,
  };
}

/**
 * Transforme une activite brute (vue plate) avec old/new status objets
 */
function enrichActivity(row) {
  if (!row) return null;
  return {
    ...row,
    old_status: row.old_status_id ? {
      id: row.old_status_id,
      label: row.old_status_label,
      color: row.old_status_color,
    } : null,
    new_status: row.new_status_id ? {
      id: row.new_status_id,
      label: row.new_status_label,
      color: row.new_status_color,
    } : null,
  };
}

// ============================================================================
// SERVICE PRINCIPAL
// ============================================================================

export const leadsService = {
  // ==========================================================================
  // DONNEES DE REFERENCE (vues publiques, lecture seule)
  // ==========================================================================

  /**
   * Recupere les sources d'acquisition actives
   */
  async getSources() {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_sources')
        .select('id, name, description, color, is_active')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data;
    }, 'leads.getSources');
  },

  /**
   * Recupere les statuts du pipeline ordonnes
   */
  async getStatuses() {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_statuses')
        .select('id, label, description, display_order, color, is_final, is_won')
        .order('display_order');

      if (error) throw error;
      return data;
    }, 'leads.getStatuses');
  },

  /**
   * Recupere les commerciaux de l'organisation pour l'assignation
   * Source : table majordhome.commercials (vue majordhome_commercials)
   * @param {string} orgId - ID de l'organisation (core.organizations.id)
   */
  async getCommercials(orgId) {
    if (!orgId) {
      console.warn('[leads] getCommercials: orgId manquant, retour vide');
      return { data: [], error: null };
    }

    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_commercials')
        .select('id, full_name, email, zone, profile_id, is_active, app_role')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('full_name');

      if (error) throw error;
      return data;
    }, 'leads.getCommercials');
  },

  // ==========================================================================
  // CRUD LEADS
  // ==========================================================================

  /**
   * Recupere la liste des leads avec filtres et pagination
   * La vue majordhome_leads inclut deja les colonnes status_label, source_name, etc.
   */
  async getLeads({ orgId, filters = {}, limit = 25, offset = 0 }) {
    if (!orgId) throw new Error('[leads] orgId requis');

    return withErrorHandlingCount(async () => {
      let query = supabase
        .from('majordhome_leads')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .eq('is_deleted', false);

      // Filtre par statut
      if (filters.statusId) {
        query = query.eq('status_id', filters.statusId);
      }

      // Filtre par source
      if (filters.sourceId) {
        query = query.eq('source_id', filters.sourceId);
      }

      // Filtre par commercial assigne
      if (filters.assignedUserId) {
        query = query.eq('assigned_user_id', filters.assignedUserId);
      }

      // Recherche textuelle
      if (filters.search) {
        const term = `%${filters.search}%`;
        query = query.or(
          `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone.ilike.${term},city.ilike.${term}`
        );
      }

      // Filtre par date de creation
      if (filters.dateFrom) {
        query = query.gte('created_date', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('created_date', filters.dateTo);
      }

      // Tri
      const orderBy = filters.orderBy || 'created_date';
      const ascending = filters.ascending ?? false;
      query = query.order(orderBy, { ascending });

      // Pagination
      query = query.range(offset, offset + limit - 1);

      const { data, count, error } = await query;

      if (error) throw error;

      // Enrichir avec objets statuses/sources imbriques
      const enriched = (data || []).map(enrichLead);
      return { data: enriched, count: count || 0 };
    }, 'leads.getLeads');
  },

  /**
   * Recupere un lead par ID (vue enrichie)
   */
  async getLeadById(leadId) {
    if (!leadId) throw new Error('[leads] leadId requis');

    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (error) throw error;
      return enrichLead(data);
    }, 'leads.getLeadById');
  },

  /**
   * Cree un nouveau lead via RPC create_majordhome_lead
   * La RPC insere dans majordhome.leads et retourne la vue enrichie
   */
  async createLead({ orgId, userId, ...leadData }) {
    if (!orgId) throw new Error('[leads] orgId requis');

    return withErrorHandling(async () => {
      // Normalize name casing
      if (leadData.last_name) leadData.last_name = leadData.last_name.toUpperCase();
      if (leadData.first_name) leadData.first_name = leadData.first_name.toUpperCase();

      const insertData = {
        org_id: orgId,
        ...leadData,
        created_date: leadData.created_date || new Date().toISOString().split('T')[0],
      };

      const { data, error } = await supabase.rpc('create_majordhome_lead', {
        p_data: insertData,
      });

      if (error) throw error;

      // La RPC retourne un array (SETOF), prendre le premier
      const created = Array.isArray(data) ? data[0] : data;

      // Creer l'activite "lead_created"
      if (created) {
        await this._createActivity({
          leadId: created.id,
          orgId,
          userId,
          type: LEAD_ACTIVITY_TYPES.LEAD_CREATED,
          description: `Lead cree : ${created.last_name || ''} ${created.first_name || ''}`.trim(),
        });
      }

      return enrichLead(created);
    }, 'leads.createLead');
  },

  /**
   * Met a jour un lead via RPC update_majordhome_lead
   * La RPC ecrit dans majordhome.leads et retourne la vue enrichie
   */
  async updateLead(leadId, updates = {}) {
    if (!leadId) throw new Error('[leads] leadId requis');

    return withErrorHandling(async () => {
      // Normalize name casing
      if (updates.last_name) updates.last_name = updates.last_name.toUpperCase();
      if (updates.first_name) updates.first_name = updates.first_name.toUpperCase();

      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          ...updates,
          updated_at: new Date().toISOString(),
        },
      });

      if (error) throw error;

      // La RPC retourne un array (SETOF), prendre le premier
      const updated = Array.isArray(data) ? data[0] : data;
      return enrichLead(updated);
    }, 'leads.updateLead');
  },

  /**
   * Suppression logique d'un lead via RPC
   */
  async softDeleteLead(leadId) {
    if (!leadId) throw new Error('[leads] leadId requis');

    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          is_deleted: true,
          updated_at: new Date().toISOString(),
        },
      });

      if (error) throw error;

      const updated = Array.isArray(data) ? data[0] : data;
      return updated;
    }, 'leads.softDeleteLead');
  },

  // ==========================================================================
  // GESTION STATUTS
  // ==========================================================================

  /**
   * Change le statut d'un lead et cree une activite
   * Utilise get_majordhome_lead_raw pour lire les donnees brutes,
   * et update_majordhome_lead pour ecrire
   *
   * NOTE: Returns { data, error, clientCreated } — extra property for consumer compat
   */
  async updateLeadStatus(leadId, newStatusId, userId, extra = {}) {
    if (!leadId || !newStatusId) throw new Error('[leads] leadId et newStatusId requis');

    const result = await withErrorHandling(async () => {
      // Recuperer l'ancien statut + call_count via RPC (lecture directe table)
      const { data: rawLead, error: rawError } = await supabase.rpc('get_majordhome_lead_raw', {
        p_lead_id: leadId,
      });

      if (rawError) throw rawError;

      const currentLead = Array.isArray(rawLead) ? rawLead[0] : rawLead;
      const oldStatusId = currentLead?.status_id;

      // Recuperer le label du nouveau statut (vue publique, lecture OK)
      const { data: newStatus } = await supabase
        .from('majordhome_statuses')
        .select('label')
        .eq('id', newStatusId)
        .single();

      const newStatusLabel = newStatus?.label;

      // Preparer les updates
      const updates = {
        status_id: newStatusId,
        updated_at: new Date().toISOString(),
      };

      // Auto-set dates selon le statut cible
      const now = new Date().toISOString();
      const today = now.split('T')[0];

      if (newStatusLabel === 'Contact\u00e9') {
        updates.last_call_date = extra.callDate || now;
        updates.call_count = (currentLead?.call_count || 0) + 1;
        if (extra.callResult) updates.last_call_result = extra.callResult;
      } else if (newStatusLabel === 'RDV planifi\u00e9') {
        if (extra.appointmentDate) {
          updates.appointment_date = extra.appointmentDate;
        }
        if (extra.appointmentId) {
          updates.appointment_id = extra.appointmentId;
        }
      } else if (newStatusLabel === 'Devis envoy\u00e9') {
        updates.quote_sent_date = extra.quoteSentDate || today;
        if (extra.quoteAmount != null) updates.order_amount_ht = extra.quoteAmount;
      } else if (newStatusLabel === 'Gagn\u00e9') {
        updates.won_date = today;
        updates.chantier_status = 'gagne';

        // Verrouiller la fiche technique terrain (fire-and-forget)
        technicalVisitService.getByLeadId(leadId).then(({ data: visit }) => {
          if (visit?.id) {
            technicalVisitService.lock(visit.id, userId).catch((err) =>
              console.error('[leads] lock technical visit error:', err)
            );
          }
        });
      }

      // Si perdu, enregistrer la raison
      if (extra.lostReason) {
        updates.lost_reason = extra.lostReason;
      }

      // Mettre a jour via RPC
      const { data, error: updateError } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: updates,
      });

      if (updateError) throw updateError;

      const updatedLead = Array.isArray(data) ? data[0] : data;

      // Recuperer le label de l'ancien statut pour la description de l'activite
      let oldLabel = '?';
      if (oldStatusId) {
        const { data: oldStatus } = await supabase
          .from('majordhome_statuses')
          .select('label')
          .eq('id', oldStatusId)
          .single();
        oldLabel = oldStatus?.label || '?';
      }
      const newLabel = newStatusLabel || '?';

      // Creer l'activite
      await this._createActivity({
        leadId,
        orgId: updatedLead?.org_id || currentLead?.org_id,
        userId,
        type: LEAD_ACTIVITY_TYPES.STATUS_CHANGED,
        description: `Statut : ${oldLabel} \u2192 ${newLabel}${extra.lostReason ? ` (${extra.lostReason})` : ''}`,
        oldStatusId,
        newStatusId,
      });

      return { lead: enrichLead(updatedLead), clientCreated: null };
    }, 'leads.updateLeadStatus');

    // Spread clientCreated to top-level for consumer compat
    // (LeadModal accesses result.clientCreated directly)
    return {
      data: result.data?.lead ?? null,
      error: result.error,
      clientCreated: result.data?.clientCreated ?? null,
    };
  },

  /**
   * Assigne un lead a un commercial via RPC
   */
  async assignLead(leadId, assignedUserId, currentUserId) {
    if (!leadId) throw new Error('[leads] leadId requis');

    return withErrorHandling(async () => {
      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          assigned_user_id: assignedUserId,
          updated_at: new Date().toISOString(),
        },
      });

      if (error) throw error;

      const updated = Array.isArray(data) ? data[0] : data;

      // Activite
      if (updated) {
        await this._createActivity({
          leadId,
          orgId: updated.org_id,
          userId: currentUserId,
          type: LEAD_ACTIVITY_TYPES.LEAD_ASSIGNED,
          description: assignedUserId
            ? `Lead assigne a un commercial`
            : 'Lead desassigne',
        });
      }

      return enrichLead(updated);
    }, 'leads.assignLead');
  },

  /**
   * Enregistre un appel (incremente call_count, met a jour last_call_date, cree activite)
   */
  async logCall(leadId, { orgId, userId, result, callDate, description }) {
    if (!leadId) throw new Error('[leads] leadId requis');

    // Description auto selon le resultat
    const resultLabels = { no_answer: 'Pas de r\u00e9ponse', callback: '\u00c0 rappeler' };
    const desc = description || (result ? `Appel \u2014 ${resultLabels[result] || result}` : 'Appel t\u00e9l\u00e9phonique');

    return withErrorHandling(async () => {
      // Recuperer call_count actuel via RPC
      const { data: rawLead } = await supabase.rpc('get_majordhome_lead_raw', {
        p_lead_id: leadId,
      });

      const current = Array.isArray(rawLead) ? rawLead[0] : rawLead;

      // Ecriture via RPC
      const updates = {
        last_call_date: callDate ? `${callDate}T${new Date().toISOString().split('T')[1]}` : new Date().toISOString(),
        call_count: (current?.call_count || 0) + 1,
        updated_at: new Date().toISOString(),
      };
      if (result) updates.last_call_result = result;

      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: updates,
      });

      if (error) throw error;

      const updated = Array.isArray(data) ? data[0] : data;

      // Creer activite phone_call
      await this._createActivity({
        leadId,
        orgId,
        userId,
        type: LEAD_ACTIVITY_TYPES.PHONE_CALL,
        description: desc,
      });

      return enrichLead(updated);
    }, 'leads.logCall');
  },

  /**
   * Enregistrer une relance (suivi devis envoye)
   */
  async logFollowup(leadId, { orgId, userId, result, callDate, description }) {
    if (!leadId) throw new Error('[leads] leadId requis');

    const resultLabels = { no_answer: 'Pas de r\u00e9ponse', callback: '\u00c0 rappeler', reached: 'Joint' };
    const desc = description || (result ? `Relance \u2014 ${resultLabels[result] || result}` : 'Relance t\u00e9l\u00e9phonique');

    return withErrorHandling(async () => {
      const { data: rawLead } = await supabase.rpc('get_majordhome_lead_raw', {
        p_lead_id: leadId,
      });

      const current = Array.isArray(rawLead) ? rawLead[0] : rawLead;

      const updates = {
        last_followup_date: callDate ? `${callDate}T${new Date().toISOString().split('T')[1]}` : new Date().toISOString(),
        followup_count: (current?.followup_count || 0) + 1,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: updates,
      });

      if (error) throw error;

      const updated = Array.isArray(data) ? data[0] : data;

      await this._createActivity({
        leadId,
        orgId,
        userId,
        type: LEAD_ACTIVITY_TYPES.FOLLOWUP,
        description: desc,
      });

      return enrichLead(updated);
    }, 'leads.logFollowup');
  },

  // ==========================================================================
  // ACTIVITES (TIMELINE)
  // ==========================================================================

  /**
   * Recupere les activites d'un lead (vue enrichie avec old/new status)
   */
  async getLeadActivities(leadId, { limit = 50 } = {}) {
    if (!leadId) return { data: [], error: null };

    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_lead_activities')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Enrichir avec objets old_status/new_status imbriques
      const enriched = (data || []).map(enrichActivity);
      return enriched;
    }, 'leads.getLeadActivities');
  },

  /**
   * Ajoute une note a un lead
   */
  async addLeadNote(leadId, { orgId, userId, description }) {
    if (!leadId || !description) throw new Error('[leads] leadId et description requis');

    return withErrorHandling(async () => {
      const result = await this._createActivity({
        leadId,
        orgId,
        userId,
        type: LEAD_ACTIVITY_TYPES.NOTE,
        description,
      });

      if (result.error) throw result.error;
      return result.data;
    }, 'leads.addLeadNote');
  },

  // ==========================================================================
  // CONVERSION LEAD -> CLIENT
  // ==========================================================================

  /**
   * Convertit un lead en client CRM via clientsService.createClient
   * Appele automatiquement sur "Gagne" si pas de client_id,
   * ou manuellement via le bouton "Convertir en client".
   * Si client_id existe deja -> skip (retourne skipped: true).
   */
  async convertLeadToClient(leadId, orgId, userId) {
    if (!leadId || !orgId) throw new Error('[leads] leadId et orgId requis');

    return withErrorHandling(async () => {
      // 1. Recuperer le lead (vue enrichie, lecture OK)
      const { data: lead, error: leadError } = await this.getLeadById(leadId);
      if (leadError || !lead) throw leadError || new Error('Lead introuvable');

      // 2. Si deja lie a un client -> skip
      if (lead.client_id) {
        return { lead, client: null, skipped: true };
      }

      // 3. Creer le client via clientsService (cree core.projects + majordhome.clients + activite)
      const clientCategory = lead.company_name ? 'entreprise' : 'particulier';
      const { data: client, error: clientError } = await clientsService.createClient({
        orgId,
        firstName: lead.first_name,
        lastName: lead.last_name,
        companyName: lead.company_name || null,
        email: lead.email,
        phone: lead.phone,
        phoneSecondary: lead.phone_secondary,
        address: lead.address,
        addressComplement: lead.address_complement,
        postalCode: lead.postal_code,
        city: lead.city,
        clientCategory,
        leadSource: lead.source_name || null,
        notes: lead.notes,
        createdBy: userId,
      });

      if (clientError) throw clientError;

      // 4. Mettre a jour le lead avec client_id + converted_date + project_id
      await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          client_id: client.id,
          converted_date: new Date().toISOString().split('T')[0],
          project_id: client.project_id || null,
          updated_at: new Date().toISOString(),
        },
      });

      // 5. Creer l'activite lead_converted
      const clientName = client.display_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
      await this._createActivity({
        leadId,
        orgId,
        userId,
        type: LEAD_ACTIVITY_TYPES.LEAD_CONVERTED,
        description: `Converti en client : ${clientName}${client.client_number ? ` (${client.client_number})` : ''}`,
        metadata: { client_id: client.id },
      });

      return { lead, client, skipped: false };
    }, 'leads.convertLeadToClient');
  },

  // ==========================================================================
  // HELPERS INTERNES
  // ==========================================================================

  /**
   * Cree une entree dans lead_activities via RPC
   * @private
   */
  async _createActivity({ leadId, orgId, userId, type, description, oldStatusId, newStatusId, metadata }) {
    return withErrorHandling(async () => {
      const activityData = {
        lead_id: leadId,
        org_id: orgId || null,
        user_id: userId || null,
        activity_type: type,
        description,
      };

      if (oldStatusId) activityData.old_status_id = oldStatusId;
      if (newStatusId) activityData.new_status_id = newStatusId;
      if (metadata) activityData.metadata = metadata;

      const { data, error } = await supabase.rpc('create_majordhome_lead_activity', {
        p_data: activityData,
      });

      if (error) throw error;
      return data;
    }, 'leads._createActivity');
  },

  // ============================================================================
  // Recherche legere de leads (pour EventModal / recherche unifiee)
  // ============================================================================
  async searchLeads(orgId, query, limit = 10) {
    if (!orgId || !query || query.length < 2) {
      return { data: [], error: null };
    }

    return withErrorHandling(async () => {
      const term = `%${query}%`;
      const { data, error } = await supabase
        .from('majordhome_leads')
        .select('id, first_name, last_name, email, phone, city, postal_code, address, client_id, status_label, source_name, status_color')
        .eq('org_id', orgId)
        .eq('is_deleted', false)
        .or(`first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone.ilike.${term},city.ilike.${term}`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const results = (data || []).map(l => ({
        ...l,
        display_name: `${l.last_name || ''} ${l.first_name || ''}`.trim(),
      }));

      return results;
    }, 'leads.searchLeads');
  },

  /**
   * Reordonne les leads dans une colonne kanban (persiste sort_order)
   * @param {string[]} leadIds - IDs dans l'ordre souhaite
   */
  async reorderLeads(leadIds) {
    if (!leadIds?.length) return { error: null };

    return withErrorHandling(async () => {
      const { error } = await supabase.rpc('reorder_leads', {
        p_lead_ids: leadIds,
      });
      if (error) throw error;
      return null;
    }, 'leads.reorderLeads');
  },
};

export default leadsService;
