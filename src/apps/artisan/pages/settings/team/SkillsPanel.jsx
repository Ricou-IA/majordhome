// src/apps/artisan/pages/settings/team/SkillsPanel.jsx
// ============================================================================
// Grille de compétences d'un technicien, cochée comme des droits :
// lignes = types d'équipement actifs de l'org groupés par catégorie,
// colonnes = rôles (Entretien / Pose). Coché = compétent ; rien coché pour un
// rôle = jamais proposé (plus de « vide = polyvalent »).
//
// Chaque coche envoie l'ENSEMBLE recalculé (membre × rôle) à la RPC
// team_member_set_skills : atomique, un type hors org fait tout échouer. Le
// cache n'est jamais mis à jour de façon optimiste — après succès on relit ;
// après échec la case revient d'elle-même à l'état réel et un toast l'explique.
// La colonne Pose est stockée mais consommée par rien (planification des
// installations à venir) : l'écran le dit.
// Spec : docs/superpowers/specs/2026-09-12-referentiel-equipements-tarifs-competences-design.md §6.2
// ============================================================================
import { useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { useTeamSkills, useSetTeamMemberSkills } from '@hooks/useTeamSkills';
import { grouperTypesParCategorie } from '@/lib/equipmentReferential';
import { SKILL_ROLES } from '@/lib/tournee/competences.js';

const SKILL_ROLE_LABELS = { entretien: 'Entretien', pose: 'Pose' };
const ROLE_HINTS = {
  entretien: 'Filtre les tournées et le CTA « Trouver le créneau optimisé ».',
  pose: 'Pas encore utilisée par l\'application (planification des installations à venir).',
};

/** Message d'erreur lisible pour l'admin (jamais l'erreur Postgres brute). */
function messageErreur(err) {
  const code = err?.code;
  if (code === '42501') return 'Droits insuffisants : seul un org_admin peut modifier les compétences.';
  if (code === '23514') return 'Un type ne fait pas partie de votre organisation : rien n\'a été enregistré.';
  return err?.message || 'Erreur lors de l\'enregistrement des compétences';
}

/**
 * @param {{ teamMember: { id: string, display_name: string }, onClose: () => void, canEdit: boolean }} props
 */
export function SkillsPanel({ teamMember, onClose, canEdit }) {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const { equipmentTypes, index, isLoading: refLoading } = useEquipmentReferential();
  const memberIds = useMemo(() => [teamMember.id], [teamMember.id]);
  const { skillsByMember, isLoading: skillsLoading } = useTeamSkills(orgId, memberIds);
  const { setSkills } = useSetTeamMemberSkills(orgId);
  const [savingRole, setSavingRole] = useState(null);

  const competences = skillsByMember.get(teamMember.id) || { entretien: new Set(), pose: new Set() };
  const groupes = useMemo(() => grouperTypesParCategorie(index, equipmentTypes), [index, equipmentTypes]);
  const totalTypes = equipmentTypes.length;

  const enregistrer = async (role, prochainSet) => {
    if (!canEdit || savingRole) return;
    setSavingRole(role);
    try {
      const result = await setSkills({ teamMemberId: teamMember.id, role, equipmentTypeIds: [...prochainSet] });
      if (result?.error) toast.error(messageErreur(result.error));
    } catch (err) {
      toast.error(messageErreur(err));
    } finally {
      setSavingRole(null);
    }
  };

  const toggleType = (role, typeId) => {
    const next = new Set(competences[role]);
    if (next.has(typeId)) next.delete(typeId); else next.add(typeId);
    enregistrer(role, next);
  };
  const toggleGroupe = (role, types) => {
    const next = new Set(competences[role]);
    const tous = types.every((t) => next.has(t.id));
    for (const t of types) { if (tous) next.delete(t.id); else next.add(t.id); }
    enregistrer(role, next);
  };
  const toggleTout = (role) => {
    const tous = totalTypes > 0 && equipmentTypes.every((t) => competences[role].has(t.id));
    enregistrer(role, tous ? new Set() : new Set(equipmentTypes.map((t) => t.id)));
  };

  const loading = refLoading || skillsLoading;
  const rienEntretien = !loading && competences.entretien.size === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Compétences de ${teamMember.display_name}`}
      >
        <div className="flex items-start justify-between px-6 pt-6 pb-3 border-b border-secondary-200">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Compétences — {teamMember.display_name}</h2>
            <p className="text-sm text-secondary-500">
              Coché = compétent. Rien coché pour un rôle = jamais proposé.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary-100 rounded" aria-label="Fermer">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {rienEntretien && (
          <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Aucune compétence Entretien cochée : ce technicien n&apos;est jamais proposé en tournée.</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-primary-600 animate-spin" /></div>
          ) : totalTypes === 0 ? (
            <p className="text-sm text-secondary-500 text-center py-8">
              Aucun type d&apos;équipement actif — créez-les dans Paramètres → Tarification.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary-500 border-b border-secondary-200">
                  <th className="py-2 pr-3 font-medium">Type d&apos;équipement</th>
                  {SKILL_ROLES.map((role) => (
                    <th key={role} className="py-2 px-2 font-medium text-center w-32">
                      <div>{SKILL_ROLE_LABELS[role]}</div>
                      <div className="text-xs font-normal text-secondary-400">{competences[role].size}/{totalTypes}</div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => toggleTout(role)}
                          disabled={!!savingRole}
                          className="text-xs text-primary-600 hover:underline disabled:opacity-50"
                        >
                          {competences[role].size === totalTypes ? 'tout décocher' : 'tout cocher'}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupes.map((groupe) => (
                  <GroupeRows
                    key={groupe.category?.id ?? 'sans-categorie'}
                    groupe={groupe}
                    competences={competences}
                    canEdit={canEdit}
                    savingRole={savingRole}
                    onToggleType={toggleType}
                    onToggleGroupe={toggleGroupe}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-secondary-200 text-xs text-secondary-500 space-y-0.5">
          {SKILL_ROLES.map((role) => (
            <p key={role}><span className="font-medium text-secondary-700">{SKILL_ROLE_LABELS[role]}</span> — {ROLE_HINTS[role]}</p>
          ))}
          {!canEdit && <p className="text-secondary-400">Lecture seule : seul un administrateur modifie les compétences.</p>}
        </div>
      </div>
    </div>
  );
}

function GroupeRows({ groupe, competences, canEdit, savingRole, onToggleType, onToggleGroupe }) {
  return (
    <>
      <tr className="bg-secondary-50">
        <td className="py-1.5 pr-3 font-semibold text-secondary-800">{groupe.label}</td>
        {SKILL_ROLES.map((role) => {
          const tous = groupe.types.every((t) => competences[role].has(t.id));
          const aucun = groupe.types.every((t) => !competences[role].has(t.id));
          return (
            <td key={role} className="py-1.5 px-2 text-center">
              <input
                type="checkbox"
                checked={tous}
                ref={(el) => { if (el) el.indeterminate = !tous && !aucun; }}
                disabled={!canEdit || !!savingRole}
                onChange={() => onToggleGroupe(role, groupe.types)}
                title={`Tout ${groupe.label} — ${SKILL_ROLE_LABELS[role]}`}
              />
            </td>
          );
        })}
      </tr>
      {groupe.types.map((t) => (
        <tr key={t.id} className="border-b border-secondary-100 last:border-0">
          <td className="py-1.5 pl-4 pr-3 text-secondary-800">{t.label}</td>
          {SKILL_ROLES.map((role) => (
            <td key={role} className="py-1.5 px-2 text-center">
              <input
                type="checkbox"
                checked={competences[role].has(t.id)}
                disabled={!canEdit || !!savingRole}
                onChange={() => onToggleType(role, t.id)}
                aria-label={`${t.label} — ${SKILL_ROLE_LABELS[role]}`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default SkillsPanel;
