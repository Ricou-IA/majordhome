/**
 * AddInteractionModal.jsx - Majord'home Artisan
 * ============================================================================
 * Modale rapide pour ajouter une interaction à un lead MT-LT.
 *
 * Champs : canal, date, résumé (obligatoire), prochaine action (optionnelle).
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useEffect } from 'react';
import { X, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { CHANNEL_CONFIG } from './longTermUtils';

const CHANNEL_OPTIONS = ['phone', 'email', 'sms', 'meeting', 'note'];

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function AddInteractionModal({
  isOpen,
  onClose,
  onConfirm,
  loading = false,
  initialChannel = 'phone',
}) {
  const [channel, setChannel] = useState(initialChannel);
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(todayStr());
  const [nextAction, setNextAction] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      setChannel(initialChannel);
      setSummary('');
      setDate(todayStr());
      setNextAction('');
      setNextActionDate('');
    }
  }, [isOpen, initialChannel]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!summary.trim()) {
      toast.error('Le résumé est obligatoire');
      return;
    }
    try {
      await onConfirm({
        channel,
        summary: summary.trim(),
        createdAt: date ? new Date(`${date}T${new Date().toISOString().split('T')[1]}`).toISOString() : null,
        nextAction: nextAction.trim() || null,
        nextActionDate: nextActionDate || null,
      });
      onClose();
    } catch (err) {
      console.error('[AddInteractionModal] error:', err);
      toast.error('Erreur lors de l\'ajout');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Nouvelle interaction</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            disabled={loading}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Canal — pastilles */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Canal</label>
          <div className="flex flex-wrap gap-2">
            {CHANNEL_OPTIONS.map((value) => {
              const cfg = CHANNEL_CONFIG[value];
              const Icon = cfg.icon;
              const active = channel === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChannel(value)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    active
                      ? `${cfg.color} border-transparent ring-2 ring-offset-1 ring-gray-300`
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Résumé */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Résumé <span className="text-red-500">*</span>
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Ex: appelé, pas de réponse / mail relance projet rénovation envoyé..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            autoFocus
          />
        </div>

        {/* Date */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        {/* Prochaine action (optionnel) */}
        <details className="mb-4 group">
          <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-700 select-none">
            + Ajouter une prochaine action (optionnel)
          </summary>
          <div className="mt-3 space-y-2 pl-2 border-l-2 border-blue-100">
            <input
              type="text"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="Ex: rappeler M. Dupont après le 15/05"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <input
              type="date"
              value={nextActionDate}
              onChange={(e) => setNextActionDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </details>

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
            disabled={loading || !summary.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddInteractionModal;
