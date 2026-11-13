/**
 * PartsToSavDemand.jsx — Des pièces choisies sur la fiche client vers la demande SAV du client
 * ============================================================================
 * Même enchaînement que `PartsToSavQuote`, mais qui s'arrête au rangement (pas de fenêtre de devis) :
 * demande SAV déjà ouverte pour le client (`savService.getOpenSavCardId`, une par client), sinon créée ici
 * (`CreateSAVModal`, description pré-remplie, appareil rattaché) ; puis les pièces sont rangées dans ses pièces
 * identifiées (`useRangerPiecesSurSav`, la quantité de la fiche client remplace celle déjà enregistrée).
 * Aucun voile pendant la lecture et le rangement : un toast suit l'opération. Tout échec se dit et la sélection est
 * gardée par l'appelant (`onRanged` n'est appelé qu'après un rangement réussi).
 * ============================================================================
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { savService } from '@services/sav.service';
import { useRangerPiecesSurSav } from '@hooks/useSavPieces';
import { descriptionSavDepuisPieces } from '@/lib/catalogue/nomenclature';
import { photoPiece, dedoublonnerPhotos, messagePiecesRangees } from '@/lib/catalogue/piecesIdentifiees';
import { logger } from '@lib/logger';
import { CreateSAVModal } from '../entretiens/CreateSAVModal';

/**
 * @param {object} p
 * @param {object} p.client fiche client (id, display_name, project_id…)
 * @param {object} p.equipment équipement dont viennent les pièces (id, equipment_model_id)
 * @param {Array<{ ligne: object, quantite: number }>} p.choix pièces choisies
 * @param {() => void} p.onClose fin de l'enchaînement (rangé, abandon ou échec)
 * @param {() => void} [p.onRanged] les pièces sont sur la demande : l'appelant vide la sélection
 */
export function PartsToSavDemand({ client, equipment, choix, onClose, onRanged }) {
  const { ranger } = useRangerPiecesSurSav();
  const [creer, setCreer] = useState(false);
  const demarre = useRef(false);
  const savCree = useRef(false); // la fenêtre SAV appelle onClose juste après onCreated : ce n'est pas un abandon

  const rangerSur = async (interventionId, { creee = false } = {}) => {
    const photos = dedoublonnerPhotos(choix.map((c) => photoPiece(
      c.ligne, { equipmentId: equipment.id, equipmentModelId: equipment.equipment_model_id }, c.quantite,
    )));
    const id = toast.loading('Pièces en cours d\'enregistrement sur la demande SAV…');
    try {
      const { count } = await ranger({ interventionId, photos });
      toast.success(messagePiecesRangees(count ?? photos.length), { id });
      onRanged?.();
    } catch (err) {
      logger.error('[PartsToSavDemand] rangement:', err);
      toast.error(creee
        ? 'Demande SAV créée, mais les pièces n\'ont pas pu y être mises : cliquez de nouveau sur « Mettre sur la demande SAV »'
        : 'Les pièces n\'ont pas pu être mises sur la demande SAV. Votre sélection est conservée, réessayez.', { id });
    } finally {
      onClose();
    }
  };

  useEffect(() => {
    if (demarre.current) return;
    demarre.current = true;
    (async () => {
      const { data: openId, error } = await savService.getOpenSavCardId(client.id);
      if (error) {
        logger.error('[PartsToSavDemand] demande SAV ouverte illisible:', error);
        toast.error('Les demandes SAV du client n\'ont pas pu être lues. Votre sélection est conservée, réessayez.');
        onClose();
        return;
      }
      if (openId) await rangerSur(openId);
      else setCreer(true);
    })();
    // Une seule lecture par enchaînement : l'appelant démonte le composant à la fin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const surSavCree = (created) => {
    savCree.current = true;
    setCreer(false);
    if (!created?.id) {
      toast.error('La demande SAV n\'a pas pu être lue après sa création. Votre sélection est conservée, réessayez.');
      onClose();
      return;
    }
    rangerSur(created.id, { creee: true });
  };

  if (!creer) return null;
  const n = choix.length;
  return (
    <CreateSAVModal
      isOpen
      onClose={() => { if (!savCree.current) onClose(); }}
      onCreated={surSavCree}
      prefillClient={client}
      prefillEquipmentId={equipment?.id || null}
      prefillDescription={descriptionSavDepuisPieces(equipment, choix)}
      allowSchedule={false}
      suite={n > 1 ? `Les ${n} pièces choisies seront mises sur cette demande.` : 'La pièce choisie sera mise sur cette demande.'}
    />
  );
}

export default PartsToSavDemand;
