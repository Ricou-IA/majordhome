/**
 * ContractModalFooter.jsx
 * ============================================================================
 * Pied du wizard de création de contrat (CreateContractModal) : boutons
 * Annuler / Retour / Suivant / Créer selon l'étape. Présentationnel — extrait
 * de la modale pour la garder sous les 500 lignes.
 * ============================================================================
 */

import { ArrowLeft, ArrowRight, FileText, Loader2 } from 'lucide-react';

const SECONDARY = 'inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors';
const PRIMARY = 'inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

/**
 * @param {object} props
 * @param {0|1|2} props.step
 * @param {boolean} props.hasPreSelectedClient - la modale saute l'étape client
 * @param {boolean} props.canGoToStep1
 * @param {boolean} props.canGoToStep2
 * @param {number|null} props.total - total annuel à afficher à l'étape équipements (null = rien)
 * @param {boolean} props.isCreating
 * @param {boolean} props.isProposal - contrat `pending` (proposition)
 * @param {string|null} [props.submitLabel] - libellé du bouton final quand la création enchaîne autre chose (envoi)
 * @param {(step: number) => void} props.onStep
 * @param {() => void} props.onClose
 * @param {() => void} props.onSubmit
 */
export function ContractModalFooter({
  step, hasPreSelectedClient, canGoToStep1, canGoToStep2, total, isCreating, isProposal, submitLabel = null, onStep, onClose, onSubmit,
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
          <button type="button" onClick={() => onStep(1)} disabled={isCreating} className={SECONDARY}>
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          <button type="button" onClick={onSubmit} disabled={isCreating} className={PRIMARY}>
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Création...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                {submitLabel || (isProposal ? 'Créer la proposition' : 'Créer le contrat')}
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}

export default ContractModalFooter;
