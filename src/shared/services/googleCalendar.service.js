/**
 * googleCalendar.service.js — Majord'home Artisan
 * ============================================================================
 * Service d'intégration Google Calendar.
 * Gère la connexion OAuth, la déconnexion, et le sync fire-and-forget
 * des appointments vers Google Calendar via Edge Functions Supabase.
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const AUTH_FUNCTION = `${SUPABASE_URL}/functions/v1/google-calendar-auth`;
const SYNC_FUNCTION = `${SUPABASE_URL}/functions/v1/google-calendar-sync`;

/**
 * Get current session token for Edge Function calls
 */
async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

export const googleCalendarService = {
  /**
   * Get the Google OAuth consent URL
   * Opens in a popup window for the user to authorize
   */
  async getAuthUrl(orgId) {
    const headers = await getAuthHeaders();
    const returnUrl = window.location.origin + '/profile';
    const res = await fetch(
      `${AUTH_FUNCTION}?action=auth-url&org_id=${encodeURIComponent(orgId)}&return_url=${encodeURIComponent(returnUrl)}`,
      { headers }
    );
    if (!res.ok) throw new Error('Failed to get auth URL');
    const data = await res.json();
    return data.url;
  },

  /**
   * Open Google OAuth popup and wait for completion
   * Returns a promise that resolves when the popup closes
   */
  async connectGoogle(orgId) {
    const url = await this.getAuthUrl(orgId);

    // Navigate directly — Google will redirect back to /profile?gcal=success
    window.location.href = url;
  },

  /**
   * Check if the current user has connected Google Calendar
   */
  async getConnectionStatus(orgId) {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${AUTH_FUNCTION}?action=status&org_id=${encodeURIComponent(orgId)}`,
      { headers }
    );
    if (!res.ok) throw new Error('Failed to check status');
    return await res.json();
  },

  /**
   * Disconnect Google Calendar for the current user
   */
  async disconnect(orgId) {
    const headers = await getAuthHeaders();
    const res = await fetch(`${AUTH_FUNCTION}?action=disconnect`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ org_id: orgId }),
    });
    if (!res.ok) throw new Error('Failed to disconnect');
    return await res.json();
  },

  /**
   * Sync an appointment to Google Calendar (fire-and-forget)
   * Called after appointment CRUD operations.
   * The Edge Function resolves technician_ids (team_members.id) and
   * commercial_id (commercials.id) to profile UUIDs internally.
   *
   * @param {'create'|'update'|'delete'|'cancel'} action
   * @param {Object} appointment - Full appointment object from DB
   * @param {Object} context - { technicianIds, assignedCommercialId, orgId, existingSyncRecords }
   */
  async syncAppointment(action, appointment, { technicianIds = [], assignedCommercialId = null, orgId, existingSyncRecords = null }) {
    if (!appointment?.id || !orgId) return;
    if (!technicianIds.length && !assignedCommercialId && !existingSyncRecords?.length) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(SYNC_FUNCTION, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action,
          appointment,
          technician_ids: technicianIds,
          assigned_commercial_id: assignedCommercialId,
          org_id: orgId,
          existing_sync_records: existingSyncRecords,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.warn('[gcal] Sync failed:', err);
      }
    } catch (err) {
      // Fire-and-forget — log but don't throw
      console.warn('[gcal] Sync error:', err);
    }
  },
};

export default googleCalendarService;
