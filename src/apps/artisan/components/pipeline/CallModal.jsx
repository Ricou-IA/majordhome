/**
 * CallModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale compacte pour qualifier un appel téléphonique.
 * Champs : date de l'appel + résultat (Pas de réponse / À rappeler).
 * ============================================================================
 */

import { useState } from 'react';
import { X, Phone, PhoneOff, PhoneForwarded } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CALL_RESULTS = [
  { value: 'no_answer', label: 'Pas de réponse', icon: PhoneOff, color: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100' },
  { value: 'callback', label: 'À rappeler', icon: PhoneForwarded, color: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' },
];

export const CallModal = ({ isOpen, onClose, onConfirm, loading = false }) => {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [result, setResult] = useState('');

  const handleConfirm = () => {
    if (!result) return;
    onConfirm({ date, result });
  };

  const handleClose = () => {
    setResult('');
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
              <Phone className="h-4 w-4 text-amber-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Enregistrer un appel</h3>
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
          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Date de l'appel
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-colors"
            />
          </div>

          {/* Résultat */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Résultat de l'appel
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CALL_RESULTS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = result === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setResult(opt.value)}
                    className={`flex items-center gap-2 px-3 py-3 rounded-lg border text-sm font-medium transition-all
                      ${isSelected
                        ? `${opt.color} ring-2 ring-offset-1 ${opt.value === 'no_answer' ? 'ring-red-400' : 'ring-amber-400'}`
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
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
            disabled={!result || loading}
            className="min-h-[36px] bg-amber-600 hover:bg-amber-700 text-white"
          >
            {loading ? 'Enregistrement...' : 'Enregistrer l\'appel'}
          </Button>
        </div>
      </div>
    </>
  );
};
