// src/apps/solaire/components/SaveSimulationModal.jsx
// Modale d'enregistrement d'une simulation (nom client requis, commentaire optionnel).
import { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { FormField, TextArea, inputClass } from '@apps/artisan/components/FormFields';

export default function SaveSimulationModal({ open, onClose, onSave, isSaving }) {
  const [clientName, setClientName] = useState('');
  const [comment, setComment] = useState('');

  if (!open) return null;

  const handleSubmit = async () => {
    if (!clientName.trim()) return;
    await onSave({ clientName: clientName.trim(), comment: comment.trim() });
    setClientName('');
    setComment('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-secondary-900">Enregistrer la simulation</h3>
          <button onClick={onClose} className="p-1 rounded-md text-secondary-400 hover:bg-secondary-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <FormField label="Nom du client" required>
          <input
            className={inputClass}
            value={clientName}
            placeholder="M. et Mme Dupont"
            onChange={(e) => setClientName(e.target.value)}
            autoFocus
          />
        </FormField>

        <FormField label="Commentaire">
          <TextArea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Contexte du RDV, remarques…"
            rows={3}
          />
        </FormField>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-secondary-200 text-secondary-700 font-medium hover:bg-secondary-50"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!clientName.trim() || isSaving}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}
