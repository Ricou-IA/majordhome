/**
 * AcceptQuoteModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale compacte déclenchée au drag de "Devis envoyé" vers "Pièces commandées".
 * Confirme l'acceptation du devis avec date.
 * Affiche le montant du devis en lecture seule comme rappel.
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { formatEuro } from '@/lib/utils';

export function AcceptQuoteModal({ isOpen, onClose, onConfirm, loading = false, clientName = '', devisAmount = null }) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);

  const handleConfirm = () => {
    onConfirm({ date });
  };

  const handleClose = () => {
    setDate(new Date().toISOString().split('T')[0]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={handleClose} />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-full max-w-sm bg-white rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-secondary-900">Devis accepté</h3>
              {clientName && (
                <p className="text-xs text-secondary-500">{clientName}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-secondary-400 hover:text-secondary-600 rounded-lg hover:bg-secondary-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Montant rappel */}
          {devisAmount > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-green-700">Montant du devis</span>
              <span className="text-sm font-bold text-green-800">{formatEuro(devisAmount)}</span>
            </div>
          )}

          {/* Date d'acceptation */}
          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-1.5">
              Date d&apos;acceptation
            </label>
            <DateInput
              libelle="Date d'acceptation"
              value={date}
              onChange={(v) => setDate(v)}
              autoFocus
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-secondary-50 rounded-b-xl">
          <Button variant="ghost" size="sm" onClick={handleClose} className="min-h-[36px]">
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
            className="min-h-[36px] bg-amber-600 hover:bg-amber-700 text-white"
          >
            {loading ? 'Enregistrement...' : 'Confirmer l\'acceptation'}
          </Button>
        </div>
      </div>
    </>
  );
}

export default AcceptQuoteModal;
