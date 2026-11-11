/**
 * EquipmentModelPicker.jsx — « Choisir le modèle fabricant » d'un équipement client
 * ============================================================================
 * Propose d'abord les modèles qui ressemblent à ce qui est saisi sur l'équipement (référence fabricant, nom),
 * puis toute la marque, avec une recherche libre. Rien n'est choisi d'office : l'utilisateur clique. Le choix est
 * enregistré sur l'équipement (par l'appelant) et se change ou se retire.
 * Règles de classement : src/lib/catalogue/nomenclature.js (pur, testé).
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Loader2, Check, Unlink } from 'lucide-react';
import { useEquipmentModelsForBrand } from '@hooks/useEquipmentModels';
import { classerModeles, filtrerModeles } from '@/lib/catalogue/nomenclature';

const LIMITE = 60;

function LigneModele({ modele, actuel, suggere, onChoisir, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChoisir(modele)}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg border transition-colors disabled:opacity-50 ${
        actuel ? 'border-primary-400 bg-primary-50' : 'border-transparent hover:bg-secondary-50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-secondary-900 truncate">{modele.model_name || modele.name}</p>
        <p className="text-xs text-secondary-500 truncate">
          {modele.brand} · réf. {modele.reference}{modele.category ? ` · ${modele.category}` : ''}
        </p>
      </div>
      {suggere && !actuel && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 flex-shrink-0">Ressemble</span>}
      {actuel && <span className="inline-flex items-center gap-1 text-xs text-primary-700 flex-shrink-0"><Check className="w-3.5 h-3.5" />Actuel</span>}
    </button>
  );
}

/**
 * @param {{ equipment: object, currentModelId?: string|null, isSaving?: boolean,
 *   onSelect: (modelId: string|null) => void, onClose: () => void }} p
 */
export default function EquipmentModelPicker({ equipment, currentModelId = null, isSaving = false, onSelect, onClose }) {
  const [recherche, setRecherche] = useState('');
  const { modeles, marqueReconnue, isLoading, error } = useEquipmentModelsForBrand(equipment?.brand, true);

  const classes = useMemo(() => classerModeles(modeles, equipment), [modeles, equipment]);
  const suggeres = useMemo(() => classes.filter((c) => c.score > 0).slice(0, 8).map((c) => c.modele), [classes]);
  const idsSuggeres = useMemo(() => new Set(suggeres.map((m) => m.id)), [suggeres]);
  const filtres = useMemo(() => filtrerModeles(modeles, recherche), [modeles, recherche]);
  const affiches = filtres.slice(0, LIMITE);
  const saisi = [equipment?.brand, equipment?.model].filter(Boolean).join(' ') || 'marque et modèle non renseignés';

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Choisir le modèle fabricant">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[88vh] flex flex-col m-4">
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-secondary-900">Choisir le modèle fabricant</h3>
            <p className="text-xs text-secondary-500 truncate">Équipement saisi : {saisi}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer"><X className="w-5 h-5 text-secondary-500" /></button>
        </div>

        <div className="px-5 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
            <input
              type="text" autoFocus value={recherche} onChange={(e) => setRecherche(e.target.value)}
              placeholder="Nom du modèle ou référence fabricant (ex. Oxana, P601314)"
              className="w-full pl-10 pr-4 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          {!isLoading && !error && modeles.length > 0 && !marqueReconnue && (
            <p className="mt-2 text-xs text-secondary-500">
              Aucun modèle relevé pour la marque « {equipment?.brand || '—'} » : la liste montre toutes les marques relevées.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {isLoading && <div className="flex items-center justify-center py-10 text-secondary-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {error && <p className="px-2 py-6 text-sm text-red-700">Les modèles n&apos;ont pas pu être chargés. Fermez et réessayez.</p>}
          {!isLoading && !error && modeles.length === 0 && (
            <p className="px-2 py-6 text-sm text-secondary-500">Aucun modèle fabricant n&apos;a encore été relevé. Les pièces détachées sont disponibles pour les marques dont le site a été relevé (Invicta aujourd&apos;hui).</p>
          )}
          {!isLoading && !error && modeles.length > 0 && (
            <>
              {!recherche.trim() && suggeres.length > 0 && (
                <div className="mb-3">
                  <p className="px-2 pb-1 text-xs font-medium text-secondary-500 uppercase tracking-wide">D&apos;après ce qui est saisi</p>
                  {suggeres.map((m) => (
                    <LigneModele key={`s-${m.id}`} modele={m} suggere actuel={m.id === currentModelId} onChoisir={(x) => onSelect(x.id)} disabled={isSaving} />
                  ))}
                </div>
              )}
              <p className="px-2 pb-1 text-xs font-medium text-secondary-500 uppercase tracking-wide">
                {recherche.trim() ? `${filtres.length} modèle${filtres.length > 1 ? 's' : ''} trouvé${filtres.length > 1 ? 's' : ''}` : `Tous les modèles (${modeles.length})`}
              </p>
              {affiches.map((m) => (
                <LigneModele key={m.id} modele={m} suggere={idsSuggeres.has(m.id)} actuel={m.id === currentModelId} onChoisir={(x) => onSelect(x.id)} disabled={isSaving} />
              ))}
              {filtres.length > affiches.length && (
                <p className="px-2 py-2 text-xs text-secondary-500">{affiches.length} modèles affichés sur {filtres.length} : précisez la recherche pour voir les autres.</p>
              )}
              {modeles.length >= 1000 && (
                <p className="px-2 py-2 text-xs text-amber-900">La liste est limitée aux 1 000 premiers modèles : un modèle peut manquer. Prévenez l&apos;administrateur.</p>
              )}
              {filtres.length === 0 && <p className="px-2 py-6 text-sm text-secondary-500">Aucun modèle ne correspond à « {recherche} ».</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t">
          {currentModelId ? (
            <button type="button" onClick={() => onSelect(null)} disabled={isSaving} className="inline-flex items-center gap-1.5 text-sm text-secondary-600 hover:text-red-700 disabled:opacity-50">
              <Unlink className="w-4 h-4" />Retirer le modèle
            </button>
          ) : <span />}
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">Fermer</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
