/**
 * pricing/ui.jsx — helpers d'interface partagés entre les onglets de
 * Settings → Tarification (PricingSettings.jsx et pricing/CategoriesTab.jsx).
 * Extraits tels quels de PricingSettings.jsx (2026-09) : aucune logique métier.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { MenuActions } from '@/components/ui/menu-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

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

/**
 * Crayon (Modifier) seul sur la ligne ; Supprimer est dans le menu « … » et passe par une
 * confirmation dans l'app (plus de window.confirm). `onDelete` est la suppression elle-même
 * (asynchrone, elle dit son résultat par un toast) : elle n'est appelée qu'après « Supprimer ».
 * `refusSuppression` (texte) : la suppression est impossible, le menu le dit au lieu d'ouvrir
 * la confirmation (ex. catégorie encore utilisée par des types).
 */
export function ActionButtons({ onEdit, onDelete, nom, refusSuppression = null }) {
  const [demande, setDemande] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const confirmer = async () => {
    setEnCours(true);
    try { await onDelete?.(); } finally { setEnCours(false); setDemande(false); }
  };
  return (
    <div className="flex gap-1 justify-end items-center">
      <button type="button" onClick={onEdit} className="p-1.5 hover:bg-primary-50 rounded" title="Modifier" aria-label={nom ? `Modifier ${nom}` : 'Modifier'}>
        <Pencil className="w-3.5 h-3.5 text-primary-500" />
      </button>
      {onDelete && (
        <MenuActions
          libelle={nom ? `Autres actions sur ${nom}` : 'Autres actions'}
          className="h-7 w-7"
          actions={[{
            label: 'Supprimer', icon: Trash2, danger: true,
            onClick: () => (refusSuppression ? toast.error(refusSuppression) : setDemande(true)),
          }]}
        />
      )}
      <ConfirmDialog
        open={demande}
        onOpenChange={(o) => { if (!enCours) setDemande(o); }}
        title={nom ? `Supprimer « ${nom} » ?` : 'Supprimer cet élément ?'}
        description="Cette suppression est définitive."
        confirmLabel={enCours ? 'Suppression…' : 'Supprimer'}
        loading={enCours}
        onConfirm={confirmer}
      />
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
