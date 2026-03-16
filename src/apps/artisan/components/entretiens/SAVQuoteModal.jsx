/**
 * SAVQuoteModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale compacte déclenchée au drag vers "Devis envoyé".
 * Champs : montant HT du devis + date d'envoi.
 * Pattern identique à QuoteModal.jsx du pipeline.
 *
 * @version 1.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState } from 'react';
import { X, FileText, Euro } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SAVQuoteModal({ isOpen, onClose, onConfirm, loading = false, clientName = '' }) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');

  const handleConfirm = () => {
    onConfirm({ date, amount: amount ? parseFloat(amount) : null });
  };

  const handleClose = () => {
    setAmount('');
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
            <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <FileText className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Devis envoyé</h3>
              {clientName && (
                <p className="text-xs text-gray-500">{clientName}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Montant */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Montant du devis HT
            </label>
            <div className="relative">
              <Euro className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ex : 350"
                autoFocus
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
              />
            </div>
          </div>

          {/* Date d'envoi */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Date d'envoi
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <Button variant="ghost" size="sm" onClick={handleClose} className="min-h-[36px]">
            Annuler
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
            className="min-h-[36px] bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? 'Enregistrement...' : 'Valider le devis'}
          </Button>
        </div>
      </div>
    </>
  );
}

export default SAVQuoteModal;
