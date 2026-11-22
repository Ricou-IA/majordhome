/**
 * ContractModalFooter.jsx
 * ============================================================================
 * Pied du wizard de création de contrat (CreateContractModal) : boutons
 * Annuler / Retour / Suivant / Créer selon l'étape. Présentationnel — extrait
 * de la modale pour la garder sous les 500 lignes.
 * ============================================================================
 */

import { ArrowLeft, ArrowRight, FileText, Loader2, Send } from 'lucide-react';

const SECONDARY = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors';
const OUTLINE = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';
const PRIMARY = 'inline-flex items-center gap-2 px-5 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

/**
 * @param {object} props
 * @param {0|1|2} props.step
 * @param {boolean} props.hasPreSelectedClient - la modale saute l'étape client
 * @param {boolean} props.canGoToStep1
 * @param {boolean} props.canGoToStep2
 * @param {number|null} props.total - total annuel à afficher à l'étape équipements (null = rien)
 * @param {boolean} props.isCreating
 * @param {boolean} props.isProposal - contrat `pending` (proposition)
 * @param {boolean} [props.isSending] - la proposition est créée, son envoi est en cours
 * @param {() => void} [props.onSubmitAndSend] - proposition : la créer puis l'envoyer au client
 * @param {(step: number) => void} props.onStep
 * @param {() => void} props.onClose
 * @param {() => void} props.onSubmit
 */
export function ContractModalFooter({
  step, hasPreSelectedClient, canGoToStep1, canGoToStep2, total, isCreating, isProposal, isSending = false, onStep, onClose, onSubmit, onSubmitAndSend,
}) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
      {step === 0 && (
        <>
          <button type="button" onClick={onClose} className={SECONDARY}>Annuler</button>
          <button type="button" onClick={() => onStep(1)} disabled={!canGoToStep1} className={PRIMARY}>
            Suivant
            <ArrowRight className="w-4 h-4" />
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <button type="button" onClick={() => (hasPreSelectedClient ? onClose() : onStep(0))} className={SECONDARY}>
            <ArrowLeft className="w-4 h-4" />
            {hasPreSelectedClient ? 'Annuler' : 'Retour'}
          </button>
          <div className="flex items-center gap-3">
            {total != null && (
              <span className="text-sm font-semibold text-gray-900">{total.toFixed(2)} €</span>
            )}
            <button type="button" onClick={() => onStep(2)} disabled={!canGoToStep2} className={PRIMARY}>
              Suivant
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <button type="button" onClick={() => onStep(1)} disabled={isCreating || isSending} className={SECONDARY}>
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          {isCreating || isSending ? (
            <span className={`${PRIMARY} opacity-70`} role="status">
              <Loader2 className="w-4 h-4 animate-spin" />
              {isSending ? 'Envoi de la proposition…' : 'Création…'}
            </span>
          ) : isProposal && onSubmitAndSend ? (
            // Créer seule laisse la proposition en attente dans Contrats ; envoyer la crée et l'envoie.
            <div className="flex items-center gap-2">
              <button type="button" onClick={onSubmit} className={OUTLINE}>
                <FileText className="w-4 h-4" />
                Créer la proposition
              </button>
              <button type="button" onClick={onSubmitAndSend} className={PRIMARY}>
                <Send className="w-4 h-4" />
                Envoyer la proposition
              </button>
            </div>
          ) : (
            <button type="button" onClick={onSubmit} className={PRIMARY}>
              <FileText className="w-4 h-4" />
              {isProposal ? 'Créer la proposition' : 'Créer le contrat'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default ContractModalFooter;
