/**
 * EventModalFrame.jsx — en-tête et pied de la modale RDV (présentation seule).
 */
import { X, Save, Loader2, Trash2, Ban, CalendarDays } from 'lucide-react';
import { MODAL_FOOTER_PHONE } from '@/lib/modalClasses';

/** En-tête : pastille de la couleur du type, titre, client du RDV en édition. */
export function EventModalHeader({ typeConfig, title, subtitle, onClose }) {
  return (
    <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: typeConfig.color + '20' }}
        >
          <CalendarDays className="w-5 h-5" style={{ color: typeConfig.color }} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{title}</h2>
          {subtitle && (
            <p className="text-sm text-gray-500 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

/**
 * Pied : actions danger (édition au repos), Retour / Fermer, bouton principal.
 * Bouton principal = assistant (créer / enregistrer le créneau / ajouter la suite)
 * ou chemin classique (Enregistrer / Créer le RDV).
 */
export function EventModalFooter({
  showDangerActions, onRequestCancel, onRequestDelete,
  inAssistantMode, onBack, onClose,
  isCancelled, usesAssistant, rescheduleMode, continuationMode,
  slotCount, assistantDisabled, batchSaving, onAssistantSubmit,
  isEdit, isSaving, onSave,
}) {
  return (
    /* Sous `sm`, quatre boutons ne tiennent pas sur 390 px : retour de ligne (sinon le panneau
       en overflow-hidden rogne le bouton principal), groupe principal gardé à droite. */
    <div className={`flex items-center justify-between max-sm:flex-wrap max-sm:gap-y-2 px-4 sm:px-6 py-4 border-t border-gray-200 bg-gray-50 shrink-0 ${MODAL_FOOTER_PHONE}`}>
      {/* Actions danger (mode edit seulement, hors re-planification) */}
      <div className="flex items-center gap-2">
        {showDangerActions && (
          <>
            <button
              onClick={onRequestCancel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
              title="Annuler le RDV"
            >
              <Ban className="w-4 h-4" />
              Annuler
            </button>
            <button
              onClick={onRequestDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 rounded-lg transition-colors"
              title="Supprimer le RDV"
            >
              <Trash2 className="w-4 h-4" />
              Supprimer
            </button>
          </>
        )}
      </div>

      {/* Actions principales */}
      <div className="flex items-center gap-3 max-sm:ml-auto">
        {inAssistantMode ? (
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Retour
          </button>
        ) : (
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Fermer
          </button>
        )}
        {!isCancelled && (
          usesAssistant ? (
            <button
              onClick={onAssistantSubmit}
              disabled={assistantDisabled}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {batchSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {rescheduleMode ? 'Enregistrement...' : (continuationMode ? 'Ajout...' : 'Création...')}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {rescheduleMode
                    ? 'Enregistrer le créneau'
                    : (continuationMode
                      ? (slotCount > 1 ? `Ajouter ${slotCount} RDV` : 'Ajouter la suite')
                      : 'Créer le RDV')}
                </>
              )}
            </button>
          ) : (
            <button
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {isEdit ? 'Enregistrer' : 'Créer le RDV'}
                </>
              )}
            </button>
          )
        )}
      </div>
    </div>
  );
}
