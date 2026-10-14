/**
 * FeuilleDeRoutePanel.jsx — Journée d'un technicien planifié à la main
 * ============================================================================
 * Slide-over ouvert par la puce « À la main » de l'en-tête du Planning : le
 * technicien est hors tournées (`include_in_routing = false`), la machine n'a
 * rien à lui proposer — on montre seulement sa feuille de route.
 * ============================================================================
 */

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { formatDateFR } from '@/lib/utils';
import { FeuilleDeRouteSection } from './FeuilleDeRouteSection';

/**
 * @param {{ journee: { date: string, technicienId: string, technicienNom: string, couleur?: string }, onClose: () => void }} props
 */
export function FeuilleDeRoutePanel({ journee, onClose }) {
  const person = useMemo(
    () => ({ displayName: journee.technicienNom, color: journee.couleur }),
    [journee.technicienNom, journee.couleur],
  );
  const memberIds = useMemo(() => [journee.technicienId], [journee.technicienId]);
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 truncate">{journee.technicienNom}</h3>
            <p className="text-sm text-gray-500">
              {formatDateFR(journee.date)}
              <span className="text-gray-400"> · planifiée à la main (hors tournées)</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <FeuilleDeRouteSection date={journee.date} memberIds={memberIds} person={person} />
        </div>
      </div>
    </>
  );
}
