/**
 * territoire.service.js
 * Service de données territoriales pour la carte CRM
 *
 * Pattern identique à clients.service.js : orgId explicite dans chaque requête.
 *
 * @version 2.0.0
 */

import { supabase } from '@/lib/supabaseClient';

// ============================================================================
// SERVICE
// ============================================================================

export const territoireService = {
  /**
   * Clients géocodés (ont lat/lng)
   */
  async getGeocodedClients(orgId) {
    try {
      if (!orgId) throw new Error('orgId requis');

      const { data, error } = await supabase
        .from('majordhome_clients')
        .select(`
          id, display_name, first_name, last_name,
          address, postal_code, city,
          latitude, longitude,
          phone, email,
          client_category, client_number,
          has_active_contract, is_archived
        `)
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

      if (error) throw error;

      const points = (data || []).map(c => ({
        id: c.id,
        type: c.has_active_contract ? 'client_contrat' : 'client',
        lat: Number(c.latitude),
        lng: Number(c.longitude),
        label: c.display_name || `${c.last_name || ''} ${c.first_name || ''}`.trim(),
        city: c.city,
        postalCode: c.postal_code,
        phone: c.phone,
        email: c.email,
        clientNumber: c.client_number,
        hasContract: c.has_active_contract,
        category: c.client_category,
      }));

      return { data: points, error: null };
    } catch (error) {
      console.error('[territoire] getGeocodedClients error:', error);
      return { data: null, error };
    }
  },

  /**
   * Leads géocodés (via coordonnées du client lié)
   */
  async getGeocodedLeads(orgId) {
    try {
      if (!orgId) throw new Error('orgId requis');

      const { data, error } = await supabase
        .schema('majordhome')
        .from('leads')
        .select('id, first_name, last_name, company, address, postal_code, city, status, estimated_amount, source, client_id')
        .eq('org_id', orgId);

      if (error) throw error;

      const clientIds = (data || []).filter(l => l.client_id).map(l => l.client_id);

      let clientCoords = {};
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('majordhome_clients')
          .select('id, latitude, longitude')
          .eq('org_id', orgId)
          .in('id', clientIds)
          .not('latitude', 'is', null);

        if (clients) {
          clientCoords = clients.reduce((acc, c) => {
            acc[c.id] = { lat: Number(c.latitude), lng: Number(c.longitude) };
            return acc;
          }, {});
        }
      }

      const points = (data || [])
        .filter(l => l.client_id && clientCoords[l.client_id])
        .map(l => ({
          id: l.id,
          type: 'lead',
          lat: clientCoords[l.client_id].lat,
          lng: clientCoords[l.client_id].lng,
          label: `${l.last_name || ''} ${l.first_name || ''}`.trim() || l.company || 'Lead',
          city: l.city,
          postalCode: l.postal_code,
          status: l.status,
          amount: l.estimated_amount ? Number(l.estimated_amount) : undefined,
          source: l.source,
        }));

      return { data: points, error: null };
    } catch (error) {
      console.error('[territoire] getGeocodedLeads error:', error);
      return { data: null, error };
    }
  },

  /**
   * Clients NON géocodés (pour batch)
   */
  async getUngeocodedClients(orgId) {
    try {
      if (!orgId) throw new Error('orgId requis');

      const { data, count, error } = await supabase
        .from('majordhome_clients')
        .select('id, address, postal_code, city', { count: 'exact' })
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .is('latitude', null)
        .not('postal_code', 'is', null)
        .not('city', 'is', null);

      if (error) throw error;

      return { data: data || [], count: count || 0, error: null };
    } catch (error) {
      console.error('[territoire] getUngeocodedClients error:', error);
      return { data: null, count: null, error };
    }
  },

  /**
   * Stats territoire (même pattern que getClientStats dans clients.service.js)
   */
  async getTerritoireStats(orgId) {
    try {
      if (!orgId) throw new Error('orgId requis');

      // Total clients non archivés
      const { count: total, error: err1 } = await supabase
        .from('majordhome_clients')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('is_archived', false);

      if (err1) throw err1;

      // Clients géocodés
      const { count: geocoded, error: err2 } = await supabase
        .from('majordhome_clients')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .not('latitude', 'is', null);

      if (err2) throw err2;

      return {
        data: {
          total: total || 0,
          geocoded: geocoded || 0,
          notGeocoded: (total || 0) - (geocoded || 0),
          coverage: total ? Math.round(((geocoded || 0) / total) * 100) : 0,
        },
        error: null,
      };
    } catch (error) {
      console.error('[territoire] getTerritoireStats error:', error);
      return { data: null, error };
    }
  },
};

export default territoireService;
