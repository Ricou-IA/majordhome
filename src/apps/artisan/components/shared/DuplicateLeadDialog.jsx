/**
 * DuplicateLeadDialog.jsx — « Ce prospect existe déjà »
 * ============================================================================
 * Dialogue partagé du filet anti-doublon de leads. Affiché au moment de créer
 * un lead (kanban « Nouveau lead ») ou un prospect walk-in (Planning) quand
 * findPotentialDuplicates trouve des leads actifs partageant téléphone / email
 * / nom+prénom.
 *
 * Présentationnel pur — les décisions remontent via callbacks :
 *   - onPrimaryAction(candidate) : lier/ouvrir la carte existante (CTA principal)
 *   - onCreateAnyway()           : créer malgré tout (jamais bloquant)
 *   - onCancel()                 : revenir au formulaire
 * ============================================================================
 */

import { AlertTriangle, ExternalLink } from 'lucide-react';
import { formatDateShortFR } from '@/lib/utils';

const REASON_LABELS = {
  phone: 'même téléphone',
  email: 'même email',
  name: 'même nom',
};

export function DuplicateLeadDialog({
  open,
  candidates = [],
  primaryActionLabel = null,
  onPrimaryAction = null,
  onCreateAnyway,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden">
        {/* En-tête avertissement */}
        <div className="flex items-start gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {candidates.length > 1 ? 'Ces prospects existent déjà' : 'Ce prospect existe déjà'}
            </p>
            <p className="text-sm text-amber-700">
              Une carte du pipeline correspond aux informations saisies — créer un
              doublon éclate le suivi (RDV et devis répartis sur deux cartes).
            </p>
          </div>
        </div>

        {/* Candidats */}
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
          {candidates.map((c) => (
            <div key={c.id} className="px-5 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {c.display_name || `${c.last_name || ''} ${c.first_name || ''}`.trim() || 'Sans nom'}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {[
                    c.status_label,
                    c.city,
                    c.created_at ? `créé le ${formatDateShortFR(c.created_at)}` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs text-amber-700">
                  {(c.matchReasons || []).map((r) => REASON_LABELS[r] || r).join(', ')}
                </p>
              </div>
              {primaryActionLabel && onPrimaryAction && (
                <button
                  type="button"
                  onClick={() => onPrimaryAction(c)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {primaryActionLabel}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer : créer quand même reste possible (homonymes légitimes) */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Retour
          </button>
          <button
            type="button"
            onClick={onCreateAnyway}
            className="px-4 py-2 text-sm text-amber-700 border border-amber-300 hover:bg-amber-50 rounded-lg transition-colors"
          >
            Créer quand même
          </button>
        </div>
      </div>
    </div>
  );
}

export default DuplicateLeadDialog;
