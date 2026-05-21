import { useQuery } from '@tanstack/react-query';
import { supabase } from '@lib/supabaseClient';
import { useAuth } from '@contexts/AuthContext';
import { useState, useEffect } from 'react';
import { useDebounce } from '@hooks/useDebounce';
import { escapePostgrestSearchTerm } from '@lib/postgrestUtils';

/**
 * Returns today's appointments for the current user (assigned_commercial_id),
 * with a flag `has_voice_memo` if a voice_memo was already created today
 * for this appointment's client.
 */
export function useTodaysAppointments() {
  const { user, organization } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;
  const today = new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: ['voice', 'todays-appointments', orgId, userId, today],
    queryFn: async () => {
      if (!orgId || !userId) return [];

      const { data: appointments, error: aptErr } = await supabase
        .from('majordhome_appointments')
        .select(
          'id, scheduled_date, scheduled_start, scheduled_end, ' +
            'client_id, client_name, client_first_name, client_phone, ' +
            'address, postal_code, city, status, subject, lead_id'
        )
        .eq('org_id', orgId)
        .eq('assigned_commercial_id', userId)
        .eq('scheduled_date', today)
        .order('scheduled_start', { ascending: true });

      if (aptErr) throw new Error(aptErr.message);
      if (!appointments || appointments.length === 0) return [];

      const clientIds = [...new Set(appointments.map((a) => a.client_id).filter(Boolean))];

      let memoMap = new Map();
      if (clientIds.length > 0) {
        const { data: memos } = await supabase
          .from('majordhome_voice_memos')
          .select('client_id, lead_id, status, created_at')
          .in('client_id', clientIds)
          .gte('created_at', `${today}T00:00:00Z`)
          .order('created_at', { ascending: false });

        for (const m of memos || []) {
          if (m.client_id && !memoMap.has(m.client_id)) {
            memoMap.set(m.client_id, m);
          }
        }
      }

      return appointments.map((a) => ({
        ...a,
        has_voice_memo: a.client_id ? memoMap.has(a.client_id) : false,
        voice_memo: a.client_id ? memoMap.get(a.client_id) : null,
      }));
    },
    enabled: !!orgId && !!userId,
    staleTime: 60_000,
  });
}

/**
 * Fuzzy search clients in the current org. Searches across display_name, phone, city.
 * Debounced 250ms.
 */
export function useClientSearch(query, { limit = 10 } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const debouncedQuery = useDebounce(query, 250);

  return useQuery({
    queryKey: ['voice', 'client-search', orgId, debouncedQuery, limit],
    queryFn: async () => {
      if (!orgId || !debouncedQuery || debouncedQuery.trim().length < 2) return [];

      const q = debouncedQuery.trim();
      // P0.26 : escape pour eviter injection PostgREST (virgule/parentheses/etc.)
      // + strip wildcards SQL `%_` pour eviter pattern abusif.
      const safeQ = escapePostgrestSearchTerm(q).replace(/[%_]/g, '');
      if (!safeQ || safeQ.length < 2) return [];
      const phoneDigits = q.replace(/\D/g, '');

      let queryBuilder = supabase
        .from('majordhome_clients')
        .select(
          'id, display_name, first_name, last_name, phone, email, ' +
            'address, postal_code, city, client_number, has_active_contract'
        )
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .limit(limit);

      // Recherche multi-champs : nom OU ville. Téléphone si chiffres.
      const orFilters = [
        `display_name.ilike.%${safeQ}%`,
        `last_name.ilike.%${safeQ}%`,
        `first_name.ilike.%${safeQ}%`,
        `city.ilike.%${safeQ}%`,
      ];
      if (phoneDigits.length >= 4) {
        orFilters.push(`phone.ilike.%${phoneDigits}%`);
      }

      const { data, error } = await queryBuilder.or(orFilters.join(','));

      if (error) throw new Error(error.message);
      return data || [];
    },
    enabled: !!orgId && !!debouncedQuery && debouncedQuery.trim().length >= 2,
    staleTime: 30_000,
  });
}

/**
 * Wrapper hook for the recorder context state.
 * Returns the selected context (rdv/client/prospect/note) and helpers to update it.
 */
export function useVoiceContextState() {
  const [context, setContext] = useState(null);

  const selectAppointment = (appointment) => {
    setContext({
      type: 'rdv',
      memo_type: 'rdv_terrain',
      client_id: appointment.client_id,
      appointment_id: appointment.id,
      label: `${appointment.client_name || ''}${appointment.client_first_name ? ' ' + appointment.client_first_name : ''} · ${appointment.city || '—'}`.trim(),
      detail: `RDV ${appointment.scheduled_start || ''} ${appointment.subject ? '· ' + appointment.subject : ''}`.trim(),
    });
  };

  const selectExistingClient = (client) => {
    setContext({
      type: 'client',
      memo_type: 'rdv_terrain',
      client_id: client.id,
      label: client.display_name,
      detail: [client.client_number, client.city].filter(Boolean).join(' · '),
    });
  };

  const selectNewProspect = (prospect) => {
    // prospect = { first_name, last_name, phone, city }
    setContext({
      type: 'prospect',
      memo_type: 'rdv_terrain',
      client_id: null, // créé après confirmation Philippe
      prospect_data: prospect,
      label: `${prospect.last_name || 'Prospect'} ${prospect.first_name || ''}`.trim(),
      detail: [prospect.phone, prospect.city].filter(Boolean).join(' · '),
    });
  };

  const selectNoteLibre = () => {
    setContext({
      type: 'note',
      memo_type: 'note_libre',
      client_id: null,
      label: 'Note libre',
      detail: 'Pas de client lié',
    });
  };

  const reset = () => setContext(null);

  return {
    context,
    selectAppointment,
    selectExistingClient,
    selectNewProspect,
    selectNoteLibre,
    reset,
  };
}
