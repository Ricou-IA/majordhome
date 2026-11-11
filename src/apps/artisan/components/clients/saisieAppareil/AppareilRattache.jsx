/**
 * AppareilRattache.jsx — vignette de la fiche du référentiel à laquelle l'équipement est rattaché (formulaire).
 */

import { Package, X, AlertTriangle, Loader2 } from 'lucide-react';
import { useEquipmentModelImages } from '@hooks/useEquipmentModels';

/**
 * @param {{ fiche: object|null, isLoading?: boolean, onChanger: () => void, onRetirer: () => void }} p
 */
export default function AppareilRattache({ fiche, isLoading = false, onChanger, onRetirer }) {
  const { photo } = useEquipmentModelImages(fiche, !!fiche?.photo_path);
  if (isLoading || !fiche) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />Chargement de l&apos;appareil…
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/60">
      <div className="w-14 h-14 flex-shrink-0 rounded-md bg-white border border-gray-200 overflow-hidden flex items-center justify-center">
        {photo ? <img src={photo} alt="" className="w-full h-full object-contain" /> : <Package className="w-6 h-6 text-gray-300" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{fiche.brand} · {fiche.model_name}</p>
        <p className="text-xs text-gray-500 truncate">
          Réf. {fiche.reference}{fiche.lifecycle === 'arrete' ? ' · plus vendu' : ''}
        </p>
        {fiche.review_status === 'a_controler' && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-amber-800">
            <AlertTriangle className="w-3 h-3" />Indexation à venir dans la base
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <button type="button" onClick={onChanger} className="text-xs text-indigo-700 hover:text-indigo-900">Changer</button>
        <button type="button" onClick={onRetirer} className="inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-red-700">
          <X className="w-3 h-3" />Retirer
        </button>
      </div>
    </div>
  );
}
