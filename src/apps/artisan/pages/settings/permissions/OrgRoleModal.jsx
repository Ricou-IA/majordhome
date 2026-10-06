/**
 * OrgRoleModal — créer ou renommer un profil « maison ».
 * ============================================================================
 * Création : libellé + modèle (le modèle est immuable ensuite, spec § 7).
 * Renommage : libellé seul.
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { X, Loader2, UserCog } from 'lucide-react';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { ROLE_LABELS } from '@lib/permissions';
import { BASE_ROLES, BASE_ROLE_HINTS } from '@/lib/orgRoles';

export function OrgRoleModal({ open, onClose, onSubmit, initial = null, isSaving = false }) {
  const [label, setLabel] = useState('');
  const [baseRole, setBaseRole] = useState('team_leader');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.label || '');
    setBaseRole(initial?.base_role || 'team_leader');
    setError(null);
  }, [open, initial]);

  if (!open) return null;
  const isEdit = !!initial;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!label.trim()) {
      setError('Le nom du profil est requis');
      return;
    }
    await onSubmit({ label: label.trim(), baseRole });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2">
            <UserCog className="w-5 h-5 text-primary-600" />
            {isEdit ? 'Renommer le profil' : 'Nouveau profil'}
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary-100 transition-colors">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Nom du profil" required error={error}>
            <TextInput
              value={label}
              onChange={(v) => { setLabel(v); setError(null); }}
              placeholder="Ex : Secrétaire"
              disabled={isSaving}
            />
          </FormField>

          <FormField label="Modèle de départ">
            {isEdit ? (
              <p className="text-sm text-secondary-700">
                {ROLE_LABELS[initial.base_role] || initial.base_role}
                <span className="block text-xs text-secondary-400">
                  Le modèle ne se change pas : pour en changer, créez un autre profil.
                </span>
              </p>
            ) : (
              <div className="space-y-2">
                {BASE_ROLES.map((role) => (
                  <label
                    key={role}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                      baseRole === role ? 'border-primary-500 bg-primary-50' : 'border-secondary-200 hover:border-secondary-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="baseRole"
                      value={role}
                      checked={baseRole === role}
                      onChange={() => setBaseRole(role)}
                      disabled={isSaving}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium text-secondary-900">{ROLE_LABELS[role]}</span>
                      <span className="block text-xs text-secondary-500">{BASE_ROLE_HINTS[role]}</span>
                    </span>
                  </label>
                ))}
                <p className="text-xs text-secondary-500">
                  Le profil démarre avec les droits de son modèle ; vous ajustez ensuite ses cases dans la grille.
                  Hors de la grille, l’application le traite comme son modèle.
                </p>
              </div>
            )}
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'Renommer' : 'Créer le profil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default OrgRoleModal;
