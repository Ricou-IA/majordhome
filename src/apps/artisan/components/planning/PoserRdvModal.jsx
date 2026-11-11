/**
 * PoserRdvModal.jsx — ouvrir la fenêtre unique « Nouveau RDV » (EventModal) depuis une fiche
 * ou une carte : création seule, client pré-rempli, carte rattachée par `attachContext`.
 * Point d'entrée unique des écrans qui posent un RDV hors du planning (fiche Entretien / SAV,
 * glisser-déposer kanban, fiche contrat, chantier, lead, appel sortant) — jamais une copie
 * de ce câblage dans un écran. Rendue dans un portail : au-dessus de la fiche qui l'ouvre.
 */

import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import { EventModal } from './EventModal';

// Chemins d'édition d'EventModal, sans objet en création
const rien = async () => {};
const refus = async () => false;

/**
 * @param {object} p
 * @param {object|null} p.client      client pré-rempli ({ id, last_name, first_name, phone, email, address, postal_code, city })
 * @param {string} p.orgId            org CORE
 * @param {Array} [p.members]         équipe (team_members)
 * @param {object} p.attachContext    rattachement et options de la carte (cf. EventModal)
 * @param {(slots: object[], created: object[]) => Promise<void>|void} [p.onCreated]
 * @param {() => void} p.onClose
 */
export function PoserRdvModal({ client, orgId, members = [], attachContext, onCreated = null, onClose }) {
  const { user } = useAuth();
  return createPortal(
    <EventModal
      isOpen
      mode="create"
      prefillClient={client}
      members={members || []}
      orgId={orgId}
      userId={user?.id}
      attachContext={attachContext}
      onCreated={onCreated}
      onClose={onClose}
      onSave={refus}
      onDelete={rien}
      onCancel={rien}
    />,
    document.body,
  );
}

export default PoserRdvModal;
