/**
 * TrouverPieceButton.jsx — Bouton « Trouver une pièce » d'un appareil (fiche client, fiche SAV)
 * ============================================================================
 * Ne rend rien si le module `assistant` n'est pas ouvert pour l'organisation, ou si le rôle n'a pas le droit
 * `assistant_pieces:use`. Ouvre la fenêtre de recherche. Propose seulement : ni commande, ni devis.
 * ============================================================================
 */

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useCanAccess } from '@hooks/usePermissions';
import { moduleActif } from '@lib/modules';
import TrouverPieceModal from './TrouverPieceModal';

/** @param {{ equipment: object, interventionId?: string|null, className?: string }} p */
export default function TrouverPieceButton({ equipment, interventionId = null, className = '' }) {
  const { settings } = useOrgSettings();
  const { can } = useCanAccess();
  const [ouvert, setOuvert] = useState(false);

  if (!equipment?.id || !moduleActif(settings, 'assistant') || !can('assistant_pieces', 'use')) return null;

  return (
    <div className={className}>
      <button
        type="button" onClick={() => setOuvert(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-secondary-300 text-secondary-700 bg-white hover:bg-secondary-50 transition-colors"
      >
        <Search className="w-3.5 h-3.5" />Trouver une pièce
      </button>
      {ouvert && <TrouverPieceModal equipment={equipment} interventionId={interventionId} onClose={() => setOuvert(false)} />}
    </div>
  );
}
