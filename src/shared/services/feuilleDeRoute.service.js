/**
 * feuilleDeRoute.service.js — Données de la feuille de route d'une journée
 * ============================================================================
 * Deux lectures, consommées par `useFeuilleDeRoute` :
 *   - les RDV du jour (toute l'équipe) avec techniciens et coordonnées — le
 *     filtre sur la personne et l'ordre vivent dans `src/lib/feuilleDeRoute.js` ;
 *   - les trajets de l'itinéraire (Mapbox Directions, un appel), avec repli
 *     vol d'oiseau SIGNALÉ (`estime: true`) — jamais un échec muet.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { getMajordhomeOrgId, withErrorHandling } from '@/lib/serviceHelpers';
import { MAPBOX_CONFIG } from '@/lib/mapbox';
import { logger } from '@lib/logger';
import { urlDirections, lireDirections, estimerTroncons } from '@/lib/feuilleDeRoute';

export const feuilleDeRouteService = {
  /**
   * RDV d'une journée (hors annulés) + `technician_ids` + `lat`/`lng`
   * (coordonnées du client, sinon du lead).
   * @param {{ coreOrgId: string, date: string }} p
   */
  async getRdvsDuJour({ coreOrgId, date }) {
    return withErrorHandling(async () => {
      const orgId = await getMajordhomeOrgId(coreOrgId);
      const { data: rows, error } = await supabase
        .from('majordhome_appointments')
        .select('id, appointment_type, status, scheduled_date, scheduled_start, scheduled_end, subject, description, client_id, lead_id, client_name, client_first_name, client_phone, address, postal_code, city, grand_secteur, target_invoiced, assigned_commercial_id')
        .eq('org_id', orgId)
        .eq('scheduled_date', date)
        .not('status', 'in', '(cancelled,no_show)')
        .order('scheduled_start', { ascending: true });
      if (error) throw error;
      if (!rows?.length) return [];

      const ids = rows.map((r) => r.id);
      const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
      const leadIds = [...new Set(rows.filter((r) => !r.client_id && r.lead_id).map((r) => r.lead_id))];
      const [liens, clients, leads] = await Promise.all([
        supabase.from('majordhome_appointment_technicians')
          .select('appointment_id, technician_id').in('appointment_id', ids),
        clientIds.length
          ? supabase.from('majordhome_clients').select('id, latitude, longitude')
            .eq('org_id', coreOrgId).in('id', clientIds)
          : { data: [], error: null },
        leadIds.length
          ? supabase.from('majordhome_leads').select('id, latitude, longitude')
            .eq('org_id', coreOrgId).in('id', leadIds)
          : { data: [], error: null },
      ]);
      if (liens.error) throw liens.error;
      if (clients.error) throw clients.error;
      if (leads.error) throw leads.error;

      const techs = new Map();
      for (const l of liens.data || []) {
        if (!techs.has(l.appointment_id)) techs.set(l.appointment_id, []);
        techs.get(l.appointment_id).push(l.technician_id);
      }
      const coordClient = new Map((clients.data || []).map((c) => [c.id, c]));
      const coordLead = new Map((leads.data || []).map((l) => [l.id, l]));
      return rows.map((r) => {
        const co = (r.client_id && coordClient.get(r.client_id)) || (r.lead_id && coordLead.get(r.lead_id)) || null;
        return {
          ...r,
          technician_ids: techs.get(r.id) || [],
          lat: co?.latitude ?? null,
          lng: co?.longitude ?? null,
        };
      });
    }, 'feuilleDeRoute.getRdvsDuJour');
  },

  /**
   * Trajets entre points consécutifs. Ne renvoie jamais d'erreur bloquante :
   * Mapbox indisponible ⇒ estimation vol d'oiseau, `estime: true`.
   * @param {Array<{ lat: number, lng: number }>} points  cf. pointsItineraire
   * @returns {Promise<{ data: { troncons, geometry, estime }, error: null }>}
   */
  async calculerTroncons(points) {
    const url = urlDirections(points, MAPBOX_CONFIG.accessToken);
    if (url) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const lu = lireDirections(await res.json(), points.length);
        if (lu) return { data: { ...lu, estime: false }, error: null };
        throw new Error('réponse Directions inattendue');
      } catch (err) {
        logger.warn('[feuilleDeRoute] Mapbox Directions indisponible — repli vol d’oiseau', err);
      }
    }
    return { data: { troncons: estimerTroncons(points), geometry: null, estime: true }, error: null };
  },
};
