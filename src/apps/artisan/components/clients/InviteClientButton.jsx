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
import { clientKeys } from '@hooks/cacheKeys';
import { UserPlus, CheckCircle2, Loader2, Globe } from 'lucide-react';

export function InviteClientButton({ client }) {
  const [inviting, setInviting] = useState(false);
  const queryClient = useQueryClient();

  // Déjà invité
  if (client.auth_user_id) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1.5 rounded-lg">
        <Globe className="w-3.5 h-3.5" />
        Portail actif
      </span>
    );
  }

  // Pas d'email
  if (!client.email) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 bg-gray-100 px-2.5 py-1.5 rounded-lg cursor-not-allowed"
        title="Le client doit avoir un email pour être invité"
      >
        <UserPlus className="w-3.5 h-3.5" />
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
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(client.id) });
    } catch (err) {
      console.error('[InviteClientButton] error:', err);
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
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      {inviting ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <UserPlus className="w-3.5 h-3.5" />
      )}
      {inviting ? 'Envoi...' : 'Inviter au portail'}
    </button>
  );
}
