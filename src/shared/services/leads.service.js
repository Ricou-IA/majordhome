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
 * Utilise des RPC SECURITY DEFINER pour les ÉCRITURES :
 * - update_majordhome_lead(p_lead_id, p_updates)
 * - get_majordhome_lead_raw(p_lead_id)
 * - create_majordhome_lead(p_data)
 * - create_majordhome_lead_activity(p_data)
 *
 * Le schéma majordhome n'est PAS exposé dans PostgREST,
 * donc .schema('majordhome') provoque des erreurs 406.
 *
 * @version 3.0.0 - Lead→Client auto-conversion sur "Devis envoyé"
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { clientsService } from '@/shared/services/clients.service';

// ============================================================================
// CONSTANTES
// ============================================================================

/**
 * Types d'activité pour lead_activities
 */
export const LEAD_ACTIVITY_TYPES = {
  LEAD_CREATED: 'lead_created',
  STATUS_CHANGED: 'status_changed',
  NOTE: 'note',
  LEAD_ASSIGNED: 'lead_assigned',
  LEAD_CONVERTED: 'lead_converted',
  PHONE_CALL: 'phone_call',
  EMAIL_SENT: 'email_sent',
  EMAIL_RECEIVED: 'email_received',
};

/**
 * Labels d'activité en français
 */
export const ACTIVITY_LABELS = {
  lead_created: 'Lead créé',
  status_changed: 'Statut modifié',
  note: 'Note ajoutée',
  lead_assigned: 'Lead assigné',
  lead_converted: 'Converti en client',
  phone_call: 'Appel téléphonique',
  email_sent: 'Email envoyé',
  email_received: 'Email reçu',
};

/**
 * Icônes/couleurs par type d'activité (pour la timeline)
 */
export const ACTIVITY_CONFIG = {
  lead_created: { icon: 'Plus', color: 'bg-emerald-100 text-emerald-700' },
  status_changed: { icon: 'ArrowRight', color: 'bg-blue-100 text-blue-700' },
  note: { icon: 'MessageSquare', color: 'bg-gray-100 text-gray-700' },
  lead_assigned: { icon: 'UserPlus', color: 'bg-violet-100 text-violet-700' },
  lead_converted: { icon: 'CheckCircle', color: 'bg-emerald-100 text-emerald-700' },
  phone_call: { icon: 'Phone', color: 'bg-amber-100 text-amber-700' },
  email_sent: { icon: 'Mail', color: 'bg-blue-100 text-blue-700' },
  email_received: { icon: 'MailOpen', color: 'bg-blue-100 text-blue-700' },
};

// ============================================================================
// HELPERS INTERNES
// ============================================================================

/**
 * Transforme un lead brut (vue plate) en objet structuré avec `statuses` et `sources`
 * pour compatibilité avec les composants existants (LeadCard, LeadKanban, etc.)
 */
function enrichLead(row) {
  if (!row) return null;
  return {
    ...row,
    // Objet imbriqué `statuses` pour compat composants
    statuses: {
      id: row.status_id,
      label: row.status_label,
      color: row.status_color,
      display_order: row.status_display_order,
      is_final: row.status_is_final,
      is_won: row.status_is_won,
    },
    // Objet imbriqué `sources` pour compat composants
    sources: row.source_id ? {
      id: row.source_id,
      name: row.source_name,
      color: row.source_color,
    } : null,
  };
}

/**
 * Transforme une activité brute (vue plate) avec old/new status objets
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
  // DONNÉES DE RÉFÉRENCE (vues publiques, lecture seule)
  // ==========================================================================

  /**
   * Récupère les sources d'acquisition actives
   */
  async getSources() {
    try {
      const { data, error } = await supabase
        .from('majordhome_sources')
        .select('id, name, description, color, is_active')
        .eq('is_active', true)
        .order('name');

      if (error) {
        console.error('[leads] getSources error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[leads] getSources error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Récupère les statuts du pipeline ordonnés
   */
  async getStatuses() {
    try {
      const { data, error } = await supabase
        .from('majordhome_statuses')
        .select('id, label, description, display_order, color, is_final, is_won')
        .order('display_order');

      if (error) {
        console.error('[leads] getStatuses error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[leads] getStatuses error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Récupère les commerciaux (profils) de l'organisation pour l'assignation
   * @param {string} orgId - ID de l'organisation (core.organizations.id)
   */
  async getCommercials(orgId) {
    try {
      if (!orgId) {
        console.warn('[leads] getCommercials: orgId manquant, retour vide');
        return { data: [], error: null };
      }

      // 1. Récupérer les user_id des membres actifs de l'org
      const { data: members, error: membersError } = await supabase
        .from('organization_members')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('status', 'active');

      if (membersError) {
        console.error('[leads] getCommercials members error:', membersError);
        return { data: null, error: membersError };
      }

      if (!members || members.length === 0) {
        return { data: [], error: null };
      }

      // 2. Récupérer les profils de ces membres uniquement
      const userIds = members.map((m) => m.user_id);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds)
        .order('full_name');

      if (error) {
        console.error('[leads] getCommercials error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[leads] getCommercials error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // CRUD LEADS
  // ==========================================================================

  /**
   * Récupère la liste des leads avec filtres et pagination
   * La vue majordhome_leads inclut déjà les colonnes status_label, source_name, etc.
   */
  async getLeads({ orgId, filters = {}, limit = 25, offset = 0 }) {
    if (!orgId) throw new Error('[leads] orgId requis');

    try {
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

      // Filtre par commercial assigné
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

      // Filtre par date de création
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

      if (error) {
        console.error('[leads] getLeads error:', error);
        return { data: null, count: 0, error };
      }

      // Enrichir avec objets statuses/sources imbriqués
      const enriched = (data || []).map(enrichLead);
      return { data: enriched, count: count || 0, error: null };
    } catch (err) {
      console.error('[leads] getLeads error:', err);
      return { data: null, count: 0, error: err };
    }
  },

  /**
   * Récupère un lead par ID (vue enrichie)
   */
  async getLeadById(leadId) {
    if (!leadId) throw new Error('[leads] leadId requis');

    try {
      const { data, error } = await supabase
        .from('majordhome_leads')
        .select('*')
        .eq('id', leadId)
        .single();

      if (error) {
        console.error('[leads] getLeadById error:', error);
        return { data: null, error };
      }

      return { data: enrichLead(data), error: null };
    } catch (err) {
      console.error('[leads] getLeadById error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Crée un nouveau lead via RPC create_majordhome_lead
   * La RPC insère dans majordhome.leads et retourne la vue enrichie
   */
  async createLead({ orgId, userId, ...leadData }) {
    if (!orgId) throw new Error('[leads] orgId requis');

    try {
      const insertData = {
        org_id: orgId,
        ...leadData,
        created_date: leadData.created_date || new Date().toISOString().split('T')[0],
      };

      const { data, error } = await supabase.rpc('create_majordhome_lead', {
        p_data: insertData,
      });

      if (error) {
        console.error('[leads] createLead error:', error);
        return { data: null, error };
      }

      // La RPC retourne un array (SETOF), prendre le premier
      const created = Array.isArray(data) ? data[0] : data;

      // Créer l'activité "lead_created"
      if (created) {
        await this._createActivity({
          leadId: created.id,
          orgId,
          userId,
          type: LEAD_ACTIVITY_TYPES.LEAD_CREATED,
          description: `Lead créé : ${created.first_name || ''} ${created.last_name || ''}`.trim(),
        });
      }

      return { data: enrichLead(created), error: null };
    } catch (err) {
      console.error('[leads] createLead error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Met à jour un lead via RPC update_majordhome_lead
   * La RPC écrit dans majordhome.leads et retourne la vue enrichie
   */
  async updateLead(leadId, updates = {}) {
    if (!leadId) throw new Error('[leads] leadId requis');

    try {
      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          ...updates,
          updated_at: new Date().toISOString(),
        },
      });

      if (error) {
        console.error('[leads] updateLead error:', error);
        return { data: null, error };
      }

      // La RPC retourne un array (SETOF), prendre le premier
      const updated = Array.isArray(data) ? data[0] : data;
      return { data: enrichLead(updated), error: null };
    } catch (err) {
      console.error('[leads] updateLead error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Suppression logique d'un lead via RPC
   */
  async softDeleteLead(leadId) {
    if (!leadId) throw new Error('[leads] leadId requis');

    try {
      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          is_deleted: true,
          updated_at: new Date().toISOString(),
        },
      });

      if (error) {
        console.error('[leads] softDeleteLead error:', error);
        return { data: null, error };
      }

      const updated = Array.isArray(data) ? data[0] : data;
      return { data: updated, error: null };
    } catch (err) {
      console.error('[leads] softDeleteLead error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // GESTION STATUTS
  // ==========================================================================

  /**
   * Change le statut d'un lead et crée une activité
   * Utilise get_majordhome_lead_raw pour lire les données brutes,
   * et update_majordhome_lead pour écrire
   */
  async updateLeadStatus(leadId, newStatusId, userId, extra = {}) {
    if (!leadId || !newStatusId) throw new Error('[leads] leadId et newStatusId requis');

    try {
      // Récupérer l'ancien statut + call_count via RPC (lecture directe table)
      const { data: rawLead, error: rawError } = await supabase.rpc('get_majordhome_lead_raw', {
        p_lead_id: leadId,
      });

      if (rawError) {
        console.error('[leads] updateLeadStatus get_raw error:', rawError);
      }

      const currentLead = Array.isArray(rawLead) ? rawLead[0] : rawLead;
      const oldStatusId = currentLead?.status_id;

      // Récupérer le label du nouveau statut (vue publique, lecture OK)
      const { data: newStatus } = await supabase
        .from('majordhome_statuses')
        .select('label')
        .eq('id', newStatusId)
        .single();

      const newStatusLabel = newStatus?.label;

      // Préparer les updates
      const updates = {
        status_id: newStatusId,
        updated_at: new Date().toISOString(),
      };

      // Auto-set dates selon le statut cible
      const now = new Date().toISOString();
      const today = now.split('T')[0];

      if (newStatusLabel === 'Contacté') {
        updates.last_call_date = now;
        updates.call_count = (currentLead?.call_count || 0) + 1;
      } else if (newStatusLabel === 'RDV planifié') {
        if (extra.appointmentDate) {
          updates.appointment_date = extra.appointmentDate;
        }
        if (extra.appointmentId) {
          updates.appointment_id = extra.appointmentId;
        }
      } else if (newStatusLabel === 'Devis envoyé') {
        updates.quote_sent_date = today;
      } else if (newStatusLabel === 'Gagné') {
        updates.won_date = today;
      }

      // Si perdu, enregistrer la raison
      if (extra.lostReason) {
        updates.lost_reason = extra.lostReason;
      }

      // Mettre à jour via RPC
      const { data, error: updateError } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: updates,
      });

      if (updateError) {
        console.error('[leads] updateLeadStatus error:', updateError);
        return { data: null, error: updateError };
      }

      const updatedLead = Array.isArray(data) ? data[0] : data;

      // Récupérer le label de l'ancien statut pour la description de l'activité
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

      // Créer l'activité
      await this._createActivity({
        leadId,
        orgId: updatedLead?.org_id || currentLead?.org_id,
        userId,
        type: LEAD_ACTIVITY_TYPES.STATUS_CHANGED,
        description: `Statut : ${oldLabel} → ${newLabel}${extra.lostReason ? ` (${extra.lostReason})` : ''}`,
        oldStatusId,
        newStatusId,
      });

      // Auto-conversion lead → client sur "Devis envoyé" (si pas déjà lié)
      let clientCreated = null;
      if (newStatusLabel === 'Devis envoyé' && !currentLead?.client_id) {
        console.log('[leads] updateLeadStatus: auto-conversion lead → client (Devis envoyé)');
        const convResult = await this.convertLeadToClient(
          leadId,
          updatedLead?.org_id || currentLead?.org_id,
          userId,
        );
        if (convResult?.data?.client && !convResult.data.skipped) {
          clientCreated = convResult.data.client;
        }
      }

      return { data: enrichLead(updatedLead), error: null, clientCreated };
    } catch (err) {
      console.error('[leads] updateLeadStatus error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Assigne un lead à un commercial via RPC
   */
  async assignLead(leadId, assignedUserId, currentUserId) {
    if (!leadId) throw new Error('[leads] leadId requis');

    try {
      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          assigned_user_id: assignedUserId,
          updated_at: new Date().toISOString(),
        },
      });

      if (error) {
        console.error('[leads] assignLead error:', error);
        return { data: null, error };
      }

      const updated = Array.isArray(data) ? data[0] : data;

      // Activité
      if (updated) {
        await this._createActivity({
          leadId,
          orgId: updated.org_id,
          userId: currentUserId,
          type: LEAD_ACTIVITY_TYPES.LEAD_ASSIGNED,
          description: assignedUserId
            ? `Lead assigné à un commercial`
            : 'Lead désassigné',
        });
      }

      return { data: enrichLead(updated), error: null };
    } catch (err) {
      console.error('[leads] assignLead error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Enregistre un appel (incrémente call_count, met à jour last_call_date, crée activité)
   */
  async logCall(leadId, { orgId, userId, description = 'Appel téléphonique' }) {
    if (!leadId) throw new Error('[leads] leadId requis');

    try {
      // Récupérer call_count actuel via RPC
      const { data: rawLead } = await supabase.rpc('get_majordhome_lead_raw', {
        p_lead_id: leadId,
      });

      const current = Array.isArray(rawLead) ? rawLead[0] : rawLead;

      // Écriture via RPC
      const { data, error } = await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          last_call_date: new Date().toISOString(),
          call_count: (current?.call_count || 0) + 1,
          updated_at: new Date().toISOString(),
        },
      });

      if (error) {
        console.error('[leads] logCall error:', error);
        return { data: null, error };
      }

      const updated = Array.isArray(data) ? data[0] : data;

      // Créer activité phone_call
      await this._createActivity({
        leadId,
        orgId,
        userId,
        type: LEAD_ACTIVITY_TYPES.PHONE_CALL,
        description,
      });

      return { data: enrichLead(updated), error: null };
    } catch (err) {
      console.error('[leads] logCall error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // ACTIVITÉS (TIMELINE)
  // ==========================================================================

  /**
   * Récupère les activités d'un lead (vue enrichie avec old/new status)
   */
  async getLeadActivities(leadId, { limit = 50 } = {}) {
    if (!leadId) return { data: [], error: null };

    try {
      const { data, error } = await supabase
        .from('majordhome_lead_activities')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[leads] getLeadActivities error:', error);
        return { data: null, error };
      }

      // Enrichir avec objets old_status/new_status imbriqués
      const enriched = (data || []).map(enrichActivity);
      return { data: enriched, error: null };
    } catch (err) {
      console.error('[leads] getLeadActivities error:', err);
      return { data: null, error: err };
    }
  },

  /**
   * Ajoute une note à un lead
   */
  async addLeadNote(leadId, { orgId, userId, description }) {
    if (!leadId || !description) throw new Error('[leads] leadId et description requis');

    try {
      const result = await this._createActivity({
        leadId,
        orgId,
        userId,
        type: LEAD_ACTIVITY_TYPES.NOTE,
        description,
      });

      return result;
    } catch (err) {
      console.error('[leads] addLeadNote error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // CONVERSION LEAD → CLIENT
  // ==========================================================================

  /**
   * Convertit un lead en client CRM via clientsService.createClient
   * Appelé automatiquement sur "Devis envoyé" si pas de client_id,
   * ou manuellement via le bouton "Convertir en client" (si Gagné).
   * Si client_id existe déjà → skip (retourne skipped: true).
   */
  async convertLeadToClient(leadId, orgId, userId) {
    if (!leadId || !orgId) throw new Error('[leads] leadId et orgId requis');

    try {
      // 1. Récupérer le lead (vue enrichie, lecture OK)
      const { data: lead, error: leadError } = await this.getLeadById(leadId);
      if (leadError || !lead) throw leadError || new Error('Lead introuvable');

      // 2. Si déjà lié à un client → skip
      if (lead.client_id) {
        console.log('[leads] convertLeadToClient: client_id déjà présent, skip');
        return { data: { lead, client: null, skipped: true }, error: null };
      }

      // 3. Créer le client via clientsService (crée core.projects + majordhome.clients + activité)
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

      if (clientError) {
        console.error('[leads] convertLeadToClient - createClient error:', clientError);
        return { data: null, error: clientError };
      }

      // 4. Mettre à jour le lead avec client_id + converted_date + project_id
      await supabase.rpc('update_majordhome_lead', {
        p_lead_id: leadId,
        p_updates: {
          client_id: client.id,
          converted_date: new Date().toISOString().split('T')[0],
          project_id: client.project_id || null,
          updated_at: new Date().toISOString(),
        },
      });

      // 5. Créer l'activité lead_converted
      const clientName = client.display_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
      await this._createActivity({
        leadId,
        orgId,
        userId,
        type: LEAD_ACTIVITY_TYPES.LEAD_CONVERTED,
        description: `Converti en client : ${clientName}${client.client_number ? ` (${client.client_number})` : ''}`,
        metadata: { client_id: client.id },
      });

      return { data: { lead, client, skipped: false }, error: null };
    } catch (err) {
      console.error('[leads] convertLeadToClient error:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // HELPERS INTERNES
  // ==========================================================================

  /**
   * Crée une entrée dans lead_activities via RPC
   * @private
   */
  async _createActivity({ leadId, orgId, userId, type, description, oldStatusId, newStatusId, metadata }) {
    try {
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

      if (error) {
        console.error('[leads] _createActivity error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (err) {
      console.error('[leads] _createActivity error:', err);
      return { data: null, error: err };
    }
  },

  // ============================================================================
  // Recherche légère de leads (pour EventModal / recherche unifiée)
  // ============================================================================
  async searchLeads(orgId, query, limit = 10) {
    try {
      if (!orgId || !query || query.length < 2) {
        return { data: [], error: null };
      }

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

      return { data: results, error: null };
    } catch (error) {
      console.error('[leads] searchLeads:', error);
      return { data: null, error };
    }
  },
};

export default leadsService;
