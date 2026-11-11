/**
 * PartsToSavQuote.jsx — Des pièces choisies sur la fiche client vers un devis SAV
 * ============================================================================
 * Enchaînement : demande SAV (celle déjà ouverte pour le client, passée par l'appelant, sinon créée ici avec la
 * description pré-remplie) → fenêtre de devis fléchée vers cette demande, les pièces rangées sous le chapitre
 * « PIÈCES » de la famille « Dépannage / SAV ». Aucun lead n'est créé (src/lib/savDevis.js).
 * Fermer la fenêtre de devis sans enregistrer rend la main à la liste : la sélection de pièces est gardée par
 * l'appelant tant que le devis n'existe pas, et la demande SAV créée entre-temps sera reprise au clic suivant.
 * ============================================================================
 */

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { savService } from '@services/sav.service';
import { buildDefaultSections } from '@services/devis.service';
import { buildDevisConfig, famillesActives, tvaFamille } from '@/lib/devisConfig';
import { lignesDevisAvecPieces, descriptionSavDepuisPieces } from '@/lib/catalogue/nomenclature';
import { leadDepuisCarteSav } from '@/lib/savDevis';
import { logger } from '@lib/logger';
import { CreateSAVModal } from '../entretiens/CreateSAVModal';
import CreateDevisModal from '../devis/CreateDevisModal';

/**
 * @param {object} p
 * @param {object} p.client fiche client (id, display_name, project_id…)
 * @param {object} p.equipment équipement dont viennent les pièces
 * @param {Array<{ ligne: object, quantite: number }>} p.choix pièces choisies
 * @param {object|null} [p.carteOuverte] demande SAV déjà ouverte pour ce client (ligne de `majordhome_entretien_sav`)
 * @param {() => void} p.onClose fin de l'enchaînement (abandon ou devis créé)
 * @param {() => void} [p.onQuoteCreated] le devis existe : l'appelant vide la sélection
 */
export function PartsToSavQuote({ client, equipment, choix, carteOuverte = null, onClose, onQuoteCreated }) {
  const { settings } = useOrgSettings();
  const config = useMemo(() => buildDevisConfig(settings), [settings]);
  const [carte, setCarte] = useState(carteOuverte);
  const [lecture, setLecture] = useState(false);
  const savCree = useRef(false); // la fenêtre SAV appelle onClose juste après onCreated : ce n'est pas un abandon

  const devis = useMemo(() => {
    const famille = famillesActives(config).find((f) => f.key === 'sav')?.label || '';
    const sections = famille ? buildDefaultSections(famille, config) : [];
    return { famille, lignes: lignesDevisAvecPieces(sections, choix, tvaFamille(config, famille)) };
  }, [config, choix]);

  const surSavCree = async (created) => {
    savCree.current = true;
    setLecture(true);
    const { data, error } = await savService.getCardById(created?.id);
    setLecture(false);
    if (error || !data) {
      // La demande existe quoi qu'il arrive : on le dit, et le clic suivant la reprendra
      logger.error('[PartsToSavQuote] lecture de la demande créée:', error);
      toast.warning('Demande SAV créée, mais la fenêtre de devis n\'a pas pu s\'ouvrir : cliquez de nouveau sur « Créer un devis SAV »');
      onClose();
      return;
    }
    setCarte(data);
  };

  if (carte) {
    return createPortal(
      <CreateDevisModal
        lead={leadDepuisCarteSav(carte)}
        interventionId={carte.id}
        initialFamily={devis.famille}
        initialLines={devis.lignes}
        onClose={onClose}
        onCreated={() => onQuoteCreated?.()}
      />,
      document.body,
    );
  }

  if (lecture) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="status" aria-label="Ouverture du devis">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>,
      document.body,
    );
  }

  return (
    <CreateSAVModal
      isOpen
      onClose={() => { if (!savCree.current) onClose(); }}
      onCreated={surSavCree}
      prefillClient={client}
      prefillEquipmentId={equipment?.id || null}
      prefillDescription={descriptionSavDepuisPieces(equipment, choix)}
      allowSchedule={false}
      suite={`La fenêtre de devis s'ouvre ensuite avec ${choix.length > 1 ? `les ${choix.length} pièces choisies` : 'la pièce choisie'}.`}
    />
  );
}

export default PartsToSavQuote;
