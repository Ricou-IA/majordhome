/**
 * EventConfirmations.jsx
 * ============================================================================
 * Sous-composants de confirmation : annulation et suppression de RDV
 * Extraits de EventModal.jsx
 * ============================================================================
 */

import { useState } from 'react';
import { Ban, Trash2, Loader2 } from 'lucide-react';
import { FormField, TextArea } from '@/apps/artisan/components/FormFields';

// ============================================================================
// ANNULATION
// ============================================================================

export function CancelConfirmation({ onConfirm, onBack, isSaving }) {
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <Ban className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800">Annuler ce rendez-vous ?</p>
          <p className="text-sm text-amber-600">Le RDV sera marqué comme annulé mais restera visible.</p>
        </div>
      </div>

      <FormField label="Motif d'annulation">
        <TextArea
          value={reason}
          onChange={setReason}
          placeholder="Indiquez le motif de l'annulation..."
          rows={3}
        />
      </FormField>

      <div className="flex items-center gap-3 justify-end">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Retour
        </button>
        <button
          onClick={() => onConfirm(reason)}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
          Confirmer l'annulation
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// SUPPRESSION
// ============================================================================

export function DeleteConfirmation({ appointmentSubject, onConfirm, onBack, isSaving }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
        <Trash2 className="w-5 h-5 text-red-600 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-red-800">Supprimer ce rendez-vous ?</p>
          <p className="text-sm text-red-600">
            {appointmentSubject
              ? `"${appointmentSubject}" sera définitivement supprimé.`
              : 'Ce rendez-vous sera définitivement supprimé.'
            }
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 justify-end">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Retour
        </button>
        <button
          onClick={onConfirm}
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Supprimer définitivement
        </button>
      </div>
    </div>
  );
}
