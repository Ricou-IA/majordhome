/**
 * prospects.service.js — Majord'home Prospection
 * ============================================================================
 * Service CRUD pour les prospects (Cédants + Commercial).
 * Lecture via vue publique majordhome_prospects.
 * Écriture via schema majordhome.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { clientsService } from './clients.service';

const DEFAULT_LIMIT = 25;

// ============================================================================
// SERVICE
// ============================================================================

export const prospectsService = {
  // ==========================================================================
  // LECTURE — LISTE
  // ==========================================================================

  async getProspects({
    orgId,
    module,
    search = '',
    statut = null,
    departement = null,
    priorite = null,
    scoreMin = null,
    scoreMax = null,
    orderBy = 'created_at',
    ascending = false,
    limit = DEFAULT_LIMIT,
    offset = 0,
  } = {}) {
    try {
      if (!orgId) throw new Error('[prospectsService] orgId requis');
      if (!module) throw new Error('[prospectsService] module requis');

      let query = supabase
        .from('majordhome_prospects')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .eq('module', module);

      // Filtre statut
      if (statut) {
        query = query.eq('statut', statut);
      }

      // Filtre département
      if (departement) {
        query = query.eq('departement', departement);
      }

      // Filtre priorité
      if (priorite) {
        query = query.eq('priorite', priorite);
      }

      // Filtre score
      if (scoreMin != null) {
        query = query.gte('score', scoreMin);
      }
      if (scoreMax != null) {
        query = query.lte('score', scoreMax);
      }

      // Recherche texte (raison sociale, siren, commune, dirigeant)
      if (search && search.trim().length >= 2) {
        const term = search.trim();
        query = query.or(
          `raison_sociale.ilike.%${term}%,siren.ilike.%${term}%,commune.ilike.%${term}%,dirigeant_nom.ilike.%${term}%`
        );
      }

      // Tri + pagination
      query = query.order(orderBy, { ascending });
      query = query.range(offset, offset + limit - 1);

      const { data, count, error } = await query;
      return { data: data || [], count: count || 0, error };
    } catch (err) {
      console.error('[prospectsService] getProspects:', err);
      return { data: [], count: 0, error: err };
    }
  },

  // ==========================================================================
  // LECTURE — DETAIL
  // ==========================================================================

  async getProspectById(prospectId) {
    try {
      const { data, error } = await supabase
        .from('majordhome_prospects')
        .select('*')
        .eq('id', prospectId)
        .single();

      return { data, error };
    } catch (err) {
      console.error('[prospectsService] getProspectById:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // CREATION (avec dédoublonnage silencieux)
  // ==========================================================================

  async createProspect(prospectData) {
    try {
      const { data, error } = await supabase
        .schema('majordhome')
        .from('prospects')
        .upsert(prospectData, {
          onConflict: 'org_id,module,siren',
          ignoreDuplicates: true,
        })
        .select()
        .single();

      // Si ignoreDuplicates=true et doublon, data peut être null
      if (!data && !error) {
        return { data: null, duplicate: true, error: null };
      }

      return { data, duplicate: false, error };
    } catch (err) {
      console.error('[prospectsService] createProspect:', err);
      return { data: null, duplicate: false, error: err };
    }
  },

  // ==========================================================================
  // MISE A JOUR
  // ==========================================================================

  async updateProspect(prospectId, updates) {
    try {
      const updateData = { ...updates };
      // Exclure les champs computed de la vue
      delete updateData.created_by_name;
      delete updateData.assigned_to_name;
      delete updateData.id;

      const { data, error } = await supabase
        .from('majordhome_prospects')
        .update(updateData)
        .eq('id', prospectId)
        .select()
        .single();

      return { data, error };
    } catch (err) {
      console.error('[prospectsService] updateProspect:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // SUPPRESSION
  // ==========================================================================

  async deleteProspect(prospectId) {
    try {
      const { error } = await supabase
        .from('majordhome_prospects')
        .delete()
        .eq('id', prospectId);

      return { success: !error, error };
    } catch (err) {
      console.error('[prospectsService] deleteProspect:', err);
      return { success: false, error: err };
    }
  },

  // ==========================================================================
  // CHANGEMENT DE STATUT (+ interaction auto)
  // ==========================================================================

  async updateStatus(prospectId, newStatus, userId, { contenu = null } = {}) {
    try {
      // 1. Lire le statut actuel
      const { data: current, error: readErr } = await supabase
        .from('majordhome_prospects')
        .select('statut')
        .eq('id', prospectId)
        .single();

      if (readErr) return { data: null, error: readErr };

      const ancienStatut = current.statut;

      // 2. Mettre à jour le statut
      const { data, error: updateErr } = await supabase
        .from('majordhome_prospects')
        .update({ statut: newStatus })
        .eq('id', prospectId)
        .select()
        .single();

      if (updateErr) return { data: null, error: updateErr };

      // 3. Créer l'interaction
      await supabase
        .schema('majordhome')
        .from('prospect_interactions')
        .insert({
          prospect_id: prospectId,
          type: 'status_changed',
          contenu: contenu || `Statut : ${ancienStatut} → ${newStatus}`,
          ancien_statut: ancienStatut,
          nouveau_statut: newStatus,
          created_by: userId,
        });

      return { data, error: null };
    } catch (err) {
      console.error('[prospectsService] updateStatus:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // INTERACTIONS (timeline)
  // ==========================================================================

  async getInteractions(prospectId) {
    try {
      const { data, error } = await supabase
        .from('majordhome_prospect_interactions')
        .select('*')
        .eq('prospect_id', prospectId)
        .order('created_at', { ascending: false });

      return { data: data || [], error };
    } catch (err) {
      console.error('[prospectsService] getInteractions:', err);
      return { data: [], error: err };
    }
  },

  async addInteraction(prospectId, { type, contenu, metadata, userId }) {
    try {
      const { data, error } = await supabase
        .schema('majordhome')
        .from('prospect_interactions')
        .insert({
          prospect_id: prospectId,
          type,
          contenu,
          metadata: metadata || {},
          created_by: userId,
        })
        .select()
        .single();

      return { data, error };
    } catch (err) {
      console.error('[prospectsService] addInteraction:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // STATISTIQUES
  // ==========================================================================

  async getStats(orgId, module) {
    try {
      const { data, error } = await supabase
        .from('majordhome_prospects')
        .select('statut, priorite, score', { count: 'exact' })
        .eq('org_id', orgId)
        .eq('module', module);

      if (error) return { data: null, error };

      // Agréger
      const stats = {
        total: data.length,
        byStatus: {},
        prioriteA: 0,
        prioriteB: 0,
        avgScore: 0,
        converted: 0,
      };

      let scoreSum = 0;
      for (const row of data) {
        stats.byStatus[row.statut] = (stats.byStatus[row.statut] || 0) + 1;
        if (row.priorite === 'A') stats.prioriteA++;
        if (row.priorite === 'B') stats.prioriteB++;
        scoreSum += row.score || 0;
        if (row.statut === 'converti' || row.statut === 'acquis') stats.converted++;
      }
      stats.avgScore = data.length > 0 ? Math.round(scoreSum / data.length) : 0;

      return { data: stats, error: null };
    } catch (err) {
      console.error('[prospectsService] getStats:', err);
      return { data: null, error: err };
    }
  },

  // ==========================================================================
  // BATCH CHECK SIREN (pour le screener)
  // ==========================================================================

  async getExistingSirens(orgId, module, sirens) {
    try {
      if (!sirens?.length) return { data: [], error: null };

      const { data, error } = await supabase
        .from('majordhome_prospects')
        .select('siren')
        .eq('org_id', orgId)
        .eq('module', module)
        .in('siren', sirens);

      return { data: (data || []).map((d) => d.siren), error };
    } catch (err) {
      console.error('[prospectsService] getExistingSirens:', err);
      return { data: [], error: err };
    }
  },

  // ==========================================================================
  // CONVERSION → CLIENT (Commercial uniquement)
  // ==========================================================================

  async convertToClient(prospectId, orgId, userId) {
    try {
      // 1. Récupérer le prospect
      const { data: prospect, error: fetchErr } = await supabase
        .from('majordhome_prospects')
        .select('*')
        .eq('id', prospectId)
        .single();

      if (fetchErr || !prospect) {
        return { data: null, error: fetchErr || new Error('Prospect non trouvé') };
      }

      if (prospect.converted_client_id) {
        return { data: null, error: new Error('Prospect déjà converti') };
      }

      // 2. Créer le client via clientsService
      const clientPayload = {
        orgId,
        lastName: prospect.raison_sociale,
        firstName: prospect.dirigeant_prenoms || '',
        company: prospect.raison_sociale,
        address: prospect.adresse || '',
        postalCode: prospect.code_postal || '',
        city: prospect.commune || '',
        phone: prospect.contact_telephone || '',
        email: prospect.contact_email || '',
        clientCategory: 'entreprise',
        notes: `Converti depuis prospection. SIREN: ${prospect.siren}`,
        latitude: prospect.latitude,
        longitude: prospect.longitude,
      };

      const { data: client, error: createErr } = await clientsService.createClient(clientPayload);
      if (createErr) return { data: null, error: createErr };

      // 3. Mettre à jour le prospect
      await supabase
        .from('majordhome_prospects')
        .update({
          statut: 'converti',
          converted_client_id: client.id,
        })
        .eq('id', prospectId);

      // 4. Ajouter l'interaction
      await supabase
        .schema('majordhome')
        .from('prospect_interactions')
        .insert({
          prospect_id: prospectId,
          type: 'converted',
          contenu: `Converti en client : ${prospect.raison_sociale}`,
          ancien_statut: prospect.statut,
          nouveau_statut: 'converti',
          metadata: { client_id: client.id },
          created_by: userId,
        });

      return { data: { prospect, client }, error: null };
    } catch (err) {
      console.error('[prospectsService] convertToClient:', err);
      return { data: null, error: err };
    }
  },
};
