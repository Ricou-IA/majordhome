/**
 * FicheInterventionCarte.jsx
 * ============================================================================
 * Ouvre, depuis la fiche client, la fiche Entretien / SAV d'une intervention
 * (la même que celle du kanban). La carte est lue au montage dans
 * `majordhome_entretien_sav` ; illisible ou absente → on le dit et on ferme.
 * Après une modification, la carte est relue : la fiche suit ce qui a changé.
 * ============================================================================
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { savService } from '@services/sav.service';
import { logger } from '@lib/logger';
import { EntretienSAVModal } from '@/apps/artisan/components/entretiens/EntretienSAVModal';

/**
 * @param {object} props
 * @param {string} props.interventionId
 * @param {() => void} props.onClose
 * @param {() => void} [props.onUpdated] - la carte a changé (l'appelant rafraîchit sa liste)
 */
export function FicheInterventionCarte({ interventionId, onClose, onUpdated }) {
  const [carte, setCarte] = useState(null);

  const lire = useCallback(async () => {
    const { data, error } = await savService.getCardById(interventionId);
    if (error || !data) {
      logger.error('[FicheInterventionCarte] carte illisible:', interventionId, error);
      return null;
    }
    return data;
  }, [interventionId]);

  useEffect(() => {
    let annule = false;
    (async () => {
      const data = await lire();
      if (annule) return;
      if (!data) {
        toast.error('Cette fiche n\'a pas pu être ouverte');
        onClose();
        return;
      }
      setCarte(data);
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne relit qu'au changement d'intervention
  }, [interventionId]);

  if (!carte) return null;

  return (
    <EntretienSAVModal
      item={carte}
      onClose={onClose}
      onUpdated={async () => {
        onUpdated?.();
        const data = await lire();
        if (data) setCarte(data);
      }}
    />
  );
}

export default FicheInterventionCarte;
