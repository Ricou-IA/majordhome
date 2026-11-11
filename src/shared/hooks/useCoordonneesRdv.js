/**
 * useCoordonneesRdv.js — lieu d'un RDV en cours de pose (fenêtre « Nouveau RDV ») pour le
 * parcours de la journée : client géocodé en base, sinon son adresse ou l'adresse saisie (BAN).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { geocodeAddress } from '@services/geocoding.service';
import { appointmentKeys } from '@hooks/cacheKeys';

/**
 * @param {object} p
 * @param {string} p.orgId          org CORE (`majordhome_clients.org_id`)
 * @param {string|null} p.clientId
 * @param {string|null} [p.address]
 * @param {string|null} [p.postalCode]
 * @param {string|null} [p.city]
 * @returns {{ coords: { lat: number, lng: number }|null, isLoading: boolean }}
 */
export function useCoordonneesRdv({ orgId, clientId, address, postalCode, city }) {
  const cle = clientId || [address, postalCode, city].filter(Boolean).join('|');
  const { data, isLoading } = useQuery({
    queryKey: appointmentKeys.rdvCoords(orgId, cle),
    queryFn: async () => {
      if (clientId) {
        const { data: c, error } = await supabase
          .from('majordhome_clients')
          .select('latitude, longitude, address, postal_code, city')
          .eq('org_id', orgId)
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (c?.latitude != null && c?.longitude != null) return { lat: Number(c.latitude), lng: Number(c.longitude) };
        if (c) return (await geocodeAddress(c.address, c.postal_code, c.city)) || null;
      }
      return (await geocodeAddress(address, postalCode, city)) || null;
    },
    enabled: !!orgId && !!cle,
    staleTime: 10 * 60_000,
  });
  return { coords: data || null, isLoading };
}

export default useCoordonneesRdv;
