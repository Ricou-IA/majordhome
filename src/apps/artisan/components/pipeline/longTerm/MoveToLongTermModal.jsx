/**
 * MoveToLongTermModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale légère pour basculer un lead "Devis envoyé" en Projet MT-LT.
 * Demande uniquement des notes contextuelles libres (pas d'horizon, pas de date pivot).
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useEffect } from 'react';
import { Hourglass, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatEuro } from '@/lib/utils';

export function MoveToLongTermModal({
  isOpen,
  onClose,
  onConfirm,
  lead,
  loading = false,
}) {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (isOpen) setNotes('');
  }, [isOpen]);

  if (!isOpen || !lead) return null;

  const name = `${lead.last_name || ''} ${lead.first_name || ''}`.trim() || 'Sans nom';
  const amount = lead.order_amount_ht || lead.estimated_revenue || 0;

  const handleSubmit = async () => {
    try {
      await onConfirm(notes.trim() || null);
      toast.success('Lead basculé en Projet MT-LT');
      onClose();
    } catch (err) {
      console.error('[MoveToLongTermModal] error:', err);
      toast.error('Erreur lors du basculement');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Hourglass className="h-5 w-5 text-purple-600" />
            <h3 className="text-lg font-semibold text-gray-900">Passer en Projet MT-LT</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Carte d'identité du lead */}
        <div className="bg-gray-50 rounded-lg p-3 mb-4 border border-gray-200">
          <div className="flex items-center justify-between">
            <p className="font-medium text-gray-900">{name}</p>
            <span className={`text-sm font-semibold ${amount > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
              {formatEuro(amount)}
            </span>
          </div>
          {lead.city && (
            <p className="text-xs text-gray-500 mt-1">{lead.city}</p>
          )}
        </div>

        <p className="text-sm text-gray-600 mb-3">
          Le lead sortira du pipeline et apparaîtra dans l'onglet <strong>Suivi MT-LT</strong>.
          Vous pourrez ajouter des interactions et le ramener en Gagné à tout moment.
        </p>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Notes contextuelles <span className="text-gray-400 font-normal">(optionnel)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex: client doit boucler son financement, attente fin de chantier voisin, décision en famille..."
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none resize-none"
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

export default MoveToLongTermModal;
