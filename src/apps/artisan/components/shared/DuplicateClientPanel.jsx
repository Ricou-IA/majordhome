/**
 * DuplicateClientPanel.jsx — « Ce client existe peut-être déjà »
 * ============================================================================
 * Bloc partagé du filet anti-doublon de CLIENTS (clientsService.findPotentialDuplicates).
 * Utilisé en ligne dans l'assistant de contrat et dans un dialogue
 * (DuplicateClientDialog) pour la fiche client et la requalification d'un lead.
 *
 * Rapprochement FORT (même téléphone / même email) : « Créer quand même »
 * demande une seconde confirmation explicite (décision Eric 2026-10-21) —
 * c'est presque toujours la même personne, et une fiche en double ouvre aussi
 * un second compte client dans Pennylane (ERNY).
 *
 * Présentationnel — les décisions remontent via callbacks :
 *   - onChoose(candidate) : utiliser la fiche existante (CTA principal)
 *   - onCreateAnyway()    : créer malgré tout
 *   - onCancel()          : optionnel, revenir au formulaire
 * ============================================================================
 */

import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { hasStrongDuplicate } from '@/lib/clientDuplicateMatch';

const REASON_LABELS = {
  phone: 'même téléphone',
  email: 'même e-mail',
  name: 'même nom et prénom',
  name_cp: 'même nom, même code postal',
};

function candidateName(c) {
  return c.display_name || `${c.last_name || ''} ${c.first_name || ''}`.trim() || 'Sans nom';
}

export function DuplicateClientPanel({
  candidates = [],
  chooseLabel = 'Utiliser cette fiche',
  onChoose,
  onCreateAnyway,
  onCancel = null,
}) {
  const [confirming, setConfirming] = useState(false);
  const strong = hasStrongDuplicate(candidates);

  if (!candidates.length) return null;

  const handleCreateAnyway = () => {
    if (strong && !confirming) {
      setConfirming(true);
      return;
    }
    onCreateAnyway();
  };

  return (
    <div className="space-y-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {strong
              ? (candidates.length > 1 ? 'Ces clients existent déjà' : 'Ce client existe déjà')
              : (candidates.length > 1 ? `${candidates.length} clients similaires` : 'Client similaire')}
          </p>
          <p className="text-sm text-amber-800">
            {strong
              ? 'Une fiche porte le même téléphone ou le même e-mail. Utilisez-la plutôt que d\'en créer une seconde.'
              : 'Vérifiez qu\'il ne s\'agit pas de la même personne avant de créer une fiche.'}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {candidates.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 px-3 py-2 bg-white rounded-lg border border-amber-200"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {candidateName(c)}
                {c.client_number && <span className="ml-1.5 text-xs font-normal text-gray-500">{c.client_number}</span>}
              </p>
              <p className="text-xs text-gray-600 truncate">
                {[c.address, [c.postal_code, c.city].filter(Boolean).join(' '), c.phone]
                  .filter(Boolean).join(' · ')}
                {c.has_active_contract && ' · Contrat actif'}
              </p>
              <p className={`text-xs ${c.isStrong ? 'font-medium text-amber-800' : 'text-amber-700'}`}>
                {(c.matchReasons || []).map((r) => REASON_LABELS[r] || r).join(', ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onChoose(c)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex-shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              {chooseLabel}
            </button>
          </div>
        ))}
      </div>

      {confirming ? (
        <div className="p-3 bg-white border border-red-200 rounded-lg space-y-2">
          <p className="text-sm text-red-800">
            Créer une seconde fiche pour un client qui a le même téléphone ou le même e-mail ?
            Le suivi (contrats, entretiens, devis, compte Pennylane) sera séparé entre deux fiches.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onCreateAnyway}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              Oui, c’est une autre personne
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-700 hover:bg-amber-100 rounded-lg transition-colors"
            >
              Retour
            </button>
          )}
          <button
            type="button"
            onClick={handleCreateAnyway}
            className="px-3 py-1.5 text-sm text-amber-800 border border-amber-300 hover:bg-amber-100 rounded-lg transition-colors"
          >
            Créer quand même
          </button>
        </div>
      )}
    </div>
  );
}

/** Variante dialogue (fiche client, requalification d'un lead). */
export function DuplicateClientDialog({ open, ...props }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl overflow-hidden">
        <DuplicateClientPanel {...props} />
      </div>
    </div>
  );
}

export default DuplicateClientPanel;
