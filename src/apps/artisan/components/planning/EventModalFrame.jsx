/**
 * EventModalFrame.jsx — en-tête et pied de la modale RDV (présentation seule).
 */
import { X, Save, Loader2, Trash2, Ban, CalendarDays } from 'lucide-react';
import { MODAL_FOOTER_PHONE } from '@/lib/modalClasses';
import { MenuActions } from '@/components/ui/menu-actions';

/** En-tête : pastille de la couleur du type, titre, client du RDV en édition. */
export function EventModalHeader({ typeConfig, title, subtitle, onClose }) {
  return (
    <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-secondary-200 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: typeConfig.color + '20' }}
        >
          <CalendarDays className="w-5 h-5" style={{ color: typeConfig.color }} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-secondary-900 truncate">{title}</h2>
          {subtitle && (
            <p className="text-sm text-secondary-500 truncate">{subtitle}</p>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-2 text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 rounded-lg transition-colors flex-shrink-0"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

/**
 * Pied : menu « … » (annuler / supprimer le RDV, édition au repos), Retour / Fermer, bouton principal.
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
    <div className={`flex items-center justify-between max-sm:flex-wrap max-sm:gap-y-2 px-4 sm:px-6 py-4 border-t border-secondary-200 bg-secondary-50 shrink-0 ${MODAL_FOOTER_PHONE}`}>
      {/* Annuler / supprimer le RDV (édition au repos) : menu « … » à gauche, jamais à côté de
          Fermer ou Enregistrer. Chaque entrée ouvre sa confirmation (EventConfirmations). */}
      <div className="flex items-center">
        {showDangerActions && (
          <MenuActions
            libelle="Autres actions sur le RDV"
            align="start"
            actions={[
              { label: 'Annuler le RDV', icon: Ban, onClick: onRequestCancel },
              { separateur: true },
              { label: 'Supprimer le RDV', icon: Trash2, danger: true, onClick: onRequestDelete },
            ]}
          />
        )}
      </div>

      {/* Actions principales */}
      <div className="flex items-center gap-3 max-sm:ml-auto">
        {inAssistantMode ? (
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-200 rounded-lg transition-colors"
          >
            Retour
          </button>
        ) : (
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-200 rounded-lg transition-colors"
          >
            Fermer
          </button>
        )}
        {!isCancelled && (
          usesAssistant ? (
            <button
              onClick={onAssistantSubmit}
              disabled={assistantDisabled}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
