/**
 * InviteClientButton.jsx
 * ============================================================================
 * Bouton pour inviter un client sur le portail client.
 * Affiche un badge "Portail actif" si déjà invité.
 * ============================================================================
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@lib/supabaseClient';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { clientKeys } from '@hooks/cacheKeys';
import { UserPlus, Loader2, Globe } from 'lucide-react';
import { logger } from '@lib/logger';

export function InviteClientButton({ client }) {
  const [inviting, setInviting] = useState(false);
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  // Déjà invité
  if (client.auth_user_id) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1.5 rounded-lg">
        <Globe className="h-4 w-4" />
        Portail actif
      </span>
    );
  }

  // Pas d'email
  if (!client.email) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 text-body-sm font-semibold text-secondary-400 cursor-not-allowed mdh-tactile"
        title="Le client doit avoir un email pour être invité"
      >
        <UserPlus className="h-4 w-4" />
        Email requis
      </button>
    );
  }

  const handleInvite = async () => {
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-client', {
        body: { clientId: client.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success(`Invitation envoyée à ${client.email}`);
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(orgId, client.id) });
    } catch (err) {
      logger.error('[InviteClientButton] error:', err);
      const msg = err?.message || 'Erreur lors de l\'envoi de l\'invitation';
      toast.error(msg);
    } finally {
      setInviting(false);
    }
  };

  return (
    <button
      onClick={handleInvite}
      disabled={inviting}
      type="button"
      className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-secondary-300 bg-white px-3 text-body-sm font-semibold text-secondary-800 shadow-xs transition-colors hover:bg-secondary-50 disabled:opacity-50 mdh-tactile"
    >
      {inviting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <UserPlus className="h-4 w-4" />
      )}
      {inviting ? 'Envoi…' : 'Inviter au portail'}
    </button>
  );
}
