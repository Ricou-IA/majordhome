/**
 * ReassignOrgRoleDialog — supprimer un profil « maison » qui a encore des membres.
 * ============================================================================
 * Chaque membre concerné est remis À LA MAIN sur un autre profil (rôle standard ou autre
 * profil maison) : sans cela il retomberait sur le modèle du profil supprimé, un choix que
 * personne n'a fait (Eric 2026-11-21). Le bouton reste fermé tant que chacun n'a pas son profil.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { SelectInput } from '@apps/artisan/components/FormFields';

/**
 * @param {object} p
 * @param {boolean} p.open
 * @param {{ id: string, label: string }|null} p.orgRole  profil à supprimer
 * @param {Array<{ userId: string, name: string }>} p.members  membres qui le portent
 * @param {Array<{ value: string, label: string }>} p.options  profils proposés (sans le profil supprimé)
 * @param {(choices: Object<string, string>) => void} p.onConfirm  userId → valeur d'option choisie
 * @param {() => void} p.onClose
 * @param {boolean} [p.loading]
 */
export function ReassignOrgRoleDialog({ open, orgRole, members, options, onConfirm, onClose, loading = false }) {
  const [choices, setChoices] = useState({});

  useEffect(() => { if (open) setChoices({}); }, [open, orgRole?.id]);

  if (!open || !orgRole) return null;

  const complet = members.every((m) => choices[m.userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={loading ? undefined : onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-secondary-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-600" />
            Supprimer « {orgRole.label} »
          </h2>
          <button type="button" onClick={onClose} disabled={loading} className="p-1.5 rounded-lg hover:bg-secondary-100 transition-colors">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>
        <p className="text-sm text-secondary-600 mb-4">
          {members.length > 1 ? `${members.length} membres portent` : '1 membre porte'} ce profil. Choisissez le profil
          de chacun avant la suppression ; les cases réglées pour « {orgRole.label} » seront perdues.
        </p>

        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-secondary-900 truncate">{m.name}</span>
              <div className="w-56 shrink-0">
                <SelectInput
                  value={choices[m.userId] || ''}
                  onChange={(v) => setChoices((c) => ({ ...c, [m.userId]: v }))}
                  options={options}
                  placeholder="Choisir un profil"
                  disabled={loading}
                />
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-end gap-3 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => onConfirm(choices)}
            disabled={!complet || loading}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Changer les profils et supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReassignOrgRoleDialog;
