/**
 * FicheSavDepuisRdv.jsx
 * ============================================================================
 * Ouvre la fiche de la demande SAV rattachée à un RDV, par-dessus la fenêtre
 * du RDV (EventModal, z-40/50 ou z-[60]/[61] depuis une carte).
 * La carte est lue au montage ; illisible ou non SAV → on le dit et on ferme.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { savService } from '@services/sav.service';
import { appointmentKeys } from '@hooks/cacheKeys';
import { logger } from '@lib/logger';
import { EntretienSAVModal } from '@/apps/artisan/components/entretiens/EntretienSAVModal';

export function FicheSavDepuisRdv({ interventionId, onClose }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const queryClient = useQueryClient();
  const [carte, setCarte] = useState(null);

  useEffect(() => {
    let annule = false;
    (async () => {
      const { data, error } = await savService.getCardById(interventionId);
      if (annule) return;
      if (error || !data) {
        logger.error('[FicheSavDepuisRdv] carte SAV illisible:', error);
        toast.error('La demande SAV n\'a pas pu être ouverte');
        onClose();
        return;
      }
      if (data.intervention_type !== 'sav') {
        toast.info('Ce RDV n\'est pas rattaché à une demande SAV');
        onClose();
        return;
      }
      setCarte(data);
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interventionId]);

  if (!carte) return null;

  return createPortal(
    <div className="relative z-[70]">
      <EntretienSAVModal
        item={carte}
        onClose={onClose}
        onUpdated={() => {
          if (orgId) queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
        }}
      />
    </div>,
    document.body,
  );
}
