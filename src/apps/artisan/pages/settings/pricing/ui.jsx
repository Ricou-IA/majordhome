/**
 * pricing/ui.jsx — helpers d'interface partagés entre les onglets de
 * Settings → Tarification (PricingSettings.jsx et pricing/CategoriesTab.jsx).
 * Extraits tels quels de PricingSettings.jsx (2026-09) : aucune logique métier.
 */
import { Plus, Pencil, Trash2, X } from 'lucide-react';

export function ToolbarHeader({ title, count, onAdd, addLabel }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <p className="text-sm text-secondary-500">{count} {title.toLowerCase()}</p>
      <button onClick={onAdd} className="btn-primary btn-sm">
        <Plus className="w-4 h-4 mr-1" /> {addLabel}
      </button>
    </div>
  );
}

export function ActionButtons({ onEdit, onDelete }) {
  return (
    <div className="flex gap-1 justify-end">
      <button onClick={onEdit} className="p-1.5 hover:bg-primary-50 rounded" title="Modifier">
        <Pencil className="w-3.5 h-3.5 text-primary-500" />
      </button>
      <button onClick={onDelete} className="p-1.5 hover:bg-red-50 rounded" title="Supprimer">
        <Trash2 className="w-3.5 h-3.5 text-red-400" />
      </button>
    </div>
  );
}

export function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-secondary-900">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}

export const selectClass = 'block w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
