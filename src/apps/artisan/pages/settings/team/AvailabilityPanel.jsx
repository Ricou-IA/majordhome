// src/apps/artisan/pages/settings/team/AvailabilityPanel.jsx
// ============================================================================
// Horaires de travail d'un membre (team_members.default_availability) : 7 jours,
// case « travaillé » + début / fin. Ces horaires bornent le moteur de tournées
// (amplitude, jours travaillés), les créneaux de l'agent téléphonique et les
// alertes de conflit du planning.
//
// Enregistrement en un geste (bouton), jamais par champ : la RPC
// team_member_set_availability remplace les 7 jours d'un coup, valide et
// renvoie ce qu'elle a stocké. Erreurs de saisie affichées par jour avant envoi.
// ============================================================================
import { useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useSetTeamMemberAvailability } from '@hooks/useTeamAvailability';
import { JOURS_SEMAINE, versFormulaire, erreursHoraires, versPayload } from '@/lib/workingHours';

/** Message lisible pour l'admin (jamais l'erreur Postgres brute). */
function messageErreur(err) {
  const code = err?.code;
  if (code === '42501') return 'Droits insuffisants : seul un administrateur peut modifier les horaires.';
  if (code === '22023') return `Horaires refusés : ${err.message}`;
  if (code === 'P0002') return 'Ce membre n\'existe plus.';
  return err?.message || 'Erreur lors de l\'enregistrement des horaires';
}

/**
 * @param {{ teamMember: { id: string, display_name: string, default_availability: object }, onClose: () => void, canEdit: boolean }} props
 */
export function AvailabilityPanel({ teamMember, onClose, canEdit }) {
  const { organization } = useAuth();
  const { setAvailability, isSaving } = useSetTeamMemberAvailability(organization?.id);
  const initial = useMemo(() => versFormulaire(teamMember.default_availability), [teamMember.default_availability]);
  const [form, setForm] = useState(initial);

  const erreurs = erreursHoraires(form);
  const valide = Object.keys(erreurs).length === 0;
  const modifie = JSON.stringify(versPayload(form)) !== JSON.stringify(versPayload(initial));

  const majJour = (key, patch) => setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));

  const enregistrer = async () => {
    if (!canEdit || !valide || !modifie || isSaving) return;
    try {
      await setAvailability({ teamMemberId: teamMember.id, availability: versPayload(form) });
      toast.success(`Horaires de ${teamMember.display_name} enregistrés`);
      onClose();
    } catch (err) {
      toast.error(messageErreur(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Horaires de travail de ${teamMember.display_name}`}
      >
        <div className="flex items-start justify-between px-6 pt-6 pb-3 border-b border-secondary-200">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Horaires de travail — {teamMember.display_name}</h2>
            <p className="text-sm text-secondary-500">
              Bornent les tournées, les créneaux proposés par l&apos;agent téléphonique et le planning.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary-500 border-b border-secondary-200">
                <th className="py-2 pr-3 font-medium">Jour</th>
                <th className="py-2 px-2 font-medium text-center">Travaillé</th>
                <th className="py-2 px-2 font-medium">Début</th>
                <th className="py-2 px-2 font-medium">Fin</th>
              </tr>
            </thead>
            <tbody>
              {JOURS_SEMAINE.map(({ key, label }) => {
                const j = form[key];
                const erreur = erreurs[key];
                return (
                  <tr key={key} className="border-b border-secondary-100 last:border-0 align-top">
                    <td className="py-2 pr-3 text-secondary-800">
                      {label}
                      {erreur && <p className="text-xs text-red-600 mt-0.5">{erreur}</p>}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={j.active}
                        disabled={!canEdit || isSaving}
                        onChange={(e) => majJour(key, { active: e.target.checked })}
                        aria-label={`${label} travaillé`}
                      />
                    </td>
                    {['start', 'end'].map((champ) => (
                      <td key={champ} className="py-2 px-2">
                        <input
                          type="time"
                          step={300}
                          value={j[champ]}
                          disabled={!canEdit || isSaving || !j.active}
                          onChange={(e) => majJour(key, { [champ]: e.target.value })}
                          aria-label={`${label} — ${champ === 'start' ? 'début' : 'fin'}`}
                          className={`w-28 text-sm border rounded-lg px-2 py-1 bg-white disabled:opacity-40 ${
                            erreur ? 'border-red-400' : 'border-secondary-300'
                          }`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-secondary-200">
          <p className="text-xs text-secondary-400">
            {canEdit ? 'Un jour non coché n\'est jamais planifié.' : 'Lecture seule : seul un administrateur modifie les horaires.'}
          </p>
          {canEdit && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg border border-secondary-300 text-secondary-700 hover:bg-secondary-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={enregistrer}
                disabled={!valide || !modifie || isSaving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Enregistrer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AvailabilityPanel;
