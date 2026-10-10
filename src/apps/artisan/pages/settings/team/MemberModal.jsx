// src/apps/artisan/pages/settings/team/MemberModal.jsx
// ============================================================================
// Modale d'édition d'UN membre (Settings → Équipe). La page ne garde qu'une
// synthèse en lecture seule ; tout ce qui s'édite vit ici, en 3 onglets :
//   - Profil & planning : rôle, assignable aux leads, couleur, planification,
//     budget journalier — chaque champ s'enregistre IMMÉDIATEMENT (une RPC par
//     champ, comme l'ancienne édition inline : pas de sauvegarde partielle).
//   - Horaires : AvailabilityForm (geste explicite « Enregistrer les horaires »).
//   - Compétences : SkillsForm (techniciens seulement, chaque coche enregistre).
// Un seul niveau de modale : jamais deux empilées. Les handlers (RPC + toasts)
// restent dans TeamManagement, la modale ne fait que les appeler.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { X, Shield, Loader2, Mail, Info } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SelectInput } from '@apps/artisan/components/FormFields';
import { ROLE_LABELS, computeEffectiveRole } from '@lib/permissions';
import { memberRoleDisplay, roleChoiceValue } from '@/lib/orgRoles';
import { FALLBACK_COLOR, isLightColor } from '@/lib/planningPalette';
import { MemberColorPicker } from './MemberColorPicker';
import { AvailabilityForm } from './AvailabilityForm';
import { SkillsForm } from './SkillsForm';
import {
  getRoleColor, getInitials, PLANIFICATION_OPTIONS, PLANIFICATION_HELP, planificationDe,
  DAILY_WORK_MINUTES_HELP, formatBudget,
} from './memberPresentation';

/** Avatar coloré de la couleur planning de la personne (gris si pas de ressource planning). */
export function MemberAvatar({ name, color, size = 'md' }) {
  const bg = color || FALLBACK_COLOR;
  const dim = size === 'lg' ? 'w-12 h-12 text-base' : 'w-10 h-10 text-sm';
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center shrink-0 font-semibold border border-black/10`}
      style={{ backgroundColor: bg, color: isLightColor(bg) ? '#0F172A' : '#FFFFFF' }}
      title={color ? `Couleur planning ${color}` : 'Pas encore de couleur planning'}
    >
      {getInitials(name)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Champs du profil
// ---------------------------------------------------------------------------

function DailyBudgetInput({ value, onSave, disabled }) {
  const [draft, setDraft] = useState(String(value ?? 480));
  useEffect(() => { setDraft(String(value ?? 480)); }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n <= 0) { setDraft(String(value ?? 480)); return; }
    if (n !== value) onSave(n);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min="60"
        max="1440"
        step="15"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        disabled={disabled}
        className="w-24 px-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
      />
      <span className="text-sm text-secondary-500">min</span>
      <span className="text-xs text-secondary-400">soit {formatBudget(parseInt(draft, 10) || value)}</span>
    </div>
  );
}

function Section({ title, help, children }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-secondary-900">{title}</h3>
        {help && <p className="text-xs text-secondary-500">{help}</p>}
      </div>
      {children}
    </section>
  );
}

function PlanningPending() {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-secondary-500">
      <Loader2 className="w-4 h-4 animate-spin" /> Ressource planning en cours de création…
    </p>
  );
}

// ---------------------------------------------------------------------------
// Modale
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {object} props.member               core.organization_members + profile
 * @param {object|undefined} props.teamMember majordhome.team_members (absent tant que la ressource n'est pas créée)
 * @param {object|null} props.orgRole         profil maison porté, le cas échéant
 * @param {Array} props.roleOptions
 * @param {boolean} props.canEdit             org_admin
 * @param {boolean} props.isCurrentUser
 * @param {boolean} props.isUpdatingRole
 * @param {Function} props.onRoleChangeRequest (member, currentChoice, nextChoice)
 * @param {boolean} props.isCommercial
 * @param {Function} props.onCommercialChange (member, active)
 * @param {boolean} props.isCommercialSaving
 * @param {Function} props.onColorChange      (teamMemberId, hex)
 * @param {boolean} props.isColorSaving
 * @param {Function} props.onDailyBudgetChange (teamMemberId, minutes)
 * @param {Function} props.onIncludeInRoutingChange (teamMemberId, include)
 * @param {boolean} props.isRoutingSaving
 * @param {Map<string,string>} props.colorOwners hex → nom (autres membres)
 * @param {Function} props.onClose
 */
export function MemberModal({
  member, teamMember, orgRole, roleOptions, canEdit, isCurrentUser, isUpdatingRole,
  onRoleChangeRequest, isCommercial, onCommercialChange, isCommercialSaving,
  onColorChange, isColorSaving, onDailyBudgetChange, onIncludeInRoutingChange, isRoutingSaving,
  colorOwners, onClose,
}) {
  const name = member.profile?.full_name || member.profile?.email || 'Utilisateur';
  const effectiveRole = computeEffectiveRole(member.profile, { role: member.role });
  const roleDisplay = memberRoleDisplay(effectiveRole, orgRole, ROLE_LABELS);
  const currentChoice = orgRole ? roleChoiceValue({ id: orgRole.org_role_id }) : effectiveRole;
  const isTechnician = teamMember?.role === 'technician';
  const [tab, setTab] = useState('profil');
  // Un technicien qui change de rôle perd l'onglet Compétences : on revient au profil.
  useEffect(() => { if (tab === 'competences' && !isTechnician) setTab('profil'); }, [tab, isTechnician]);

  useEffect(() => {
    // Radix (ConfirmDialog) fait preventDefault sur l'Escape qu'il consomme : on ne ferme pas la fiche en même temps.
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const planification = useMemo(() => planificationDe(teamMember?.include_in_routing), [teamMember?.include_in_routing]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Membre ${name}`}
      >
        {/* En-tête */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-secondary-200">
          <div className="flex items-center gap-3 min-w-0">
            <MemberAvatar name={member.profile?.full_name} color={teamMember?.calendar_color} size="lg" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-secondary-900 truncate">
                {name}
                {isCurrentUser && <span className="ml-2 text-xs font-normal text-secondary-400">(vous)</span>}
              </h2>
              <p className="text-sm text-secondary-500 inline-flex items-center gap-1.5 truncate">
                <Mail className="w-3.5 h-3.5 shrink-0" /> {member.profile?.email || ''}
              </p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${getRoleColor(effectiveRole)}`}>
                  <Shield className="w-3 h-3" /> {roleDisplay.label}
                </span>
                {roleDisplay.sub && <span className="text-[11px] text-secondary-400">{roleDisplay.sub}</span>}
                {isCommercial && (
                  <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full bg-secondary-100 text-secondary-700">Assignable aux leads</span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary-100 shrink-0" aria-label="Fermer">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
          <div className="px-6 pt-3">
            <TabsList className="w-full justify-start gap-1 bg-secondary-100/80 p-1">
              <TabsTrigger value="profil" className="data-[state=active]:bg-white">Profil &amp; planning</TabsTrigger>
              <TabsTrigger value="horaires" className="data-[state=active]:bg-white" disabled={!teamMember}>Horaires</TabsTrigger>
              {isTechnician && (
                <TabsTrigger value="competences" className="data-[state=active]:bg-white">Compétences</TabsTrigger>
              )}
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <TabsContent value="profil" className="mt-0 space-y-6">
              <Section title="Rôle" help="Détermine les droits dans l’application et le rôle planning (qui peut être assigné à quel type de rendez-vous).">
                {isCurrentUser ? (
                  <p className="text-sm text-secondary-400 italic">Vous ne pouvez pas changer votre propre rôle.</p>
                ) : canEdit ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={currentChoice}
                      onChange={(e) => onRoleChangeRequest(member, currentChoice, e.target.value)}
                      disabled={isUpdatingRole}
                      className="text-sm border border-secondary-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
                    >
                      {roleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {isUpdatingRole && <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />}
                  </div>
                ) : (
                  <p className="text-sm text-secondary-700">{roleDisplay.label}</p>
                )}
              </Section>

              <Section title="Commercial" help="Figure dans la liste « Commercial assigné » des leads. Retirer ne désassigne rien : les leads déjà attribués gardent leur commercial.">
                <label className="inline-flex items-center gap-2 text-sm text-secondary-800">
                  <input
                    type="checkbox"
                    checked={isCommercial}
                    onChange={(e) => onCommercialChange(member, e.target.checked)}
                    disabled={!canEdit || isCommercialSaving}
                    className="h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                  />
                  Assignable aux leads
                  {isCommercialSaving && <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />}
                </label>
              </Section>

              <Section title="Couleur planning" help="La couleur de la personne sur le calendrier (le violet est réservé aux rendez-vous facturés).">
                {!teamMember ? <PlanningPending /> : (
                  <MemberColorPicker
                    color={teamMember.calendar_color}
                    onPick={(hex) => onColorChange(teamMember.id, hex)}
                    disabled={!canEdit || isColorSaving}
                    owners={colorOwners}
                  />
                )}
              </Section>

              <Section title="Planification" help="Qui pose ses rendez-vous.">
                {!teamMember ? <PlanningPending /> : (
                  <div className="max-w-sm">
                    <SelectInput
                      value={planification}
                      onChange={(next) => next && next !== planification && onIncludeInRoutingChange(teamMember.id, next === 'machine')}
                      options={PLANIFICATION_OPTIONS}
                      disabled={!canEdit || isRoutingSaving}
                    />
                    <p className="mt-1 text-xs text-secondary-400">{PLANIFICATION_HELP[planification]}</p>
                  </div>
                )}
              </Section>

              <Section title="Budget journalier" help={DAILY_WORK_MINUTES_HELP}>
                {!teamMember ? <PlanningPending /> : canEdit ? (
                  <DailyBudgetInput
                    value={teamMember.daily_work_minutes}
                    onSave={(minutes) => onDailyBudgetChange(teamMember.id, minutes)}
                    disabled={isRoutingSaving}
                  />
                ) : (
                  <p className="text-sm text-secondary-700">{teamMember.daily_work_minutes ?? 480} min ({formatBudget(teamMember.daily_work_minutes)})</p>
                )}
              </Section>
            </TabsContent>

            <TabsContent value="horaires" className="mt-0">
              {teamMember && <AvailabilityForm teamMember={teamMember} canEdit={canEdit} />}
            </TabsContent>

            {isTechnician && (
              <TabsContent value="competences" className="mt-0">
                <SkillsForm teamMember={teamMember} canEdit={canEdit} />
              </TabsContent>
            )}
          </div>
        </Tabs>

        {/* Pied */}
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-secondary-200">
          <p className="inline-flex items-center gap-1.5 text-xs text-secondary-400">
            <Info className="w-3.5 h-3.5" />
            {tab === 'horaires'
              ? 'Les horaires s’enregistrent avec le bouton ci-dessus.'
              : 'Chaque modification est enregistrée aussitôt.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-secondary-300 text-secondary-700 hover:bg-secondary-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

export default MemberModal;
