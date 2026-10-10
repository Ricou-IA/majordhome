/**
 * TeamManagement.jsx - Majord'home Artisan
 * ============================================================================
 * Page de gestion de l'équipe (org_admin uniquement).
 *
 * Source unique : core.organization_members + profiles
 * Synthèse en lecture seule (une ligne par membre, cliquable) ; toute l'édition
 * vit dans la modale `team/MemberModal.jsx` (rôle, commercial, couleur,
 * planification, budget, horaires, compétences). Les handlers (RPC + toasts)
 * restent ici, la modale ne fait que les appeler.
 * Changement de rôle avec confirmation (ConfirmDialog).
 * Invitation de nouveaux membres via Edge Function create-user.
 *
 * @version 4.0.0 — synthèse + modale par membre (2026-10-10)
 * ============================================================================
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useOrgMembers } from '@hooks/usePermissions';
import { useLeadCommercials, useSetLeadCommercial } from '@hooks/useLeads';
import { useOrgRoles } from '@hooks/useOrgRoles';
import { buildRoleOptions, parseRoleChoice, memberRoleDisplay } from '@/lib/orgRoles';
import { useTeamMembers, useSetTeamMemberColor, useSetTeamMemberRouting, useEnsureTeamMember } from '@hooks/useAppointments';
import { logger } from '@lib/logger';
import {
  EFFECTIVE_ROLES,
  ROLE_LABELS,
  ROLE_DB_MAPPING,
  computeEffectiveRole,
} from '@lib/permissions';
import {
  Users,
  ArrowLeft,
  Shield,
  Loader2,
  AlertCircle,
  UserPlus,
  X,
  Eye,
  EyeOff,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { FormField, TextInput, SelectInput } from '@apps/artisan/components/FormFields';
import { resumeHoraires } from '@/lib/workingHours';
import { pickFreeColor, normalizeHex } from '@/lib/planningPalette';
import { useTeamSkills } from '@hooks/useTeamSkills';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import { MemberModal, MemberAvatar } from './team/MemberModal';
import {
  getRoleColor, PLANIFICATION_OPTIONS, PLANIFICATION_HELP, planificationDe, formatBudget, DAILY_WORK_MINUTES_HELP,
} from './team/memberPresentation';

// =============================================================================
// HELPERS
// =============================================================================

// Erreurs RPC `team_member_set_routing_settings` traduites en français — jamais le
// message Postgres brut à l'écran. 22023 = confirmé (p_daily_work_minutes hors
// [60, 1440]) ; 42501 = garde org_admin, même convention que team_member_set_calendar_color
// (filet défensif, pas explicitement confirmé pour cette RPC).
const ROUTING_SETTINGS_ERROR_MESSAGES = {
  '22023': 'Le budget journalier doit être compris entre 60 et 1440 minutes (1h à 24h).',
  '42501': 'Seul un administrateur peut modifier ces réglages.',
};

const routingSettingsErrorMessage = (error, fallback) =>
  ROUTING_SETTINGS_ERROR_MESSAGES[error?.code] || fallback;

// =============================================================================
// COMPOSANT — InviteModal
// =============================================================================

function InviteModal({ open, onClose, onInvite, isInviting, roleOptions }) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    effectiveRole: 'technicien',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});

  const updateField = (field) => (value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: null }));
  };

  const validate = () => {
    const errs = {};
    if (!form.fullName.trim()) errs.fullName = 'Le nom est requis';
    if (!form.email.trim()) errs.email = "L'email est requis";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      errs.email = 'Email invalide';
    if (!form.password) errs.password = 'Le mot de passe est requis';
    else if (form.password.length < 6)
      errs.password = '6 caractères minimum';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    const result = await onInvite(form);
    if (result?.error) {
      toast.error(result.error.message || "Erreur lors de l'invitation");
    } else {
      toast.success(`${form.fullName.trim()} a été invité avec succès`);
      setForm({ fullName: '', email: '', password: '', effectiveRole: 'technicien' });
      setErrors({});
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-secondary-900 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary-600" />
            Inviter un membre
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary-100 transition-colors"
          >
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Nom complet" required error={errors.fullName}>
            <TextInput
              value={form.fullName}
              onChange={updateField('fullName')}
              placeholder="Ex : Jean Dupont"
              disabled={isInviting}
            />
          </FormField>

          <FormField label="Email" required error={errors.email}>
            <TextInput
              type="email"
              value={form.email}
              onChange={updateField('email')}
              placeholder="jean.dupont@exemple.fr"
              disabled={isInviting}
            />
          </FormField>

          <FormField label="Mot de passe temporaire" required error={errors.password}>
            <div className="relative">
              <TextInput
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={updateField('password')}
                placeholder="Min. 6 caractères"
                disabled={isInviting}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary-400 hover:text-secondary-600"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </FormField>

          <FormField label="Rôle">
            <SelectInput
              value={form.effectiveRole}
              onChange={updateField('effectiveRole')}
              options={roleOptions}
            />
          </FormField>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isInviting}
              className="px-4 py-2 text-sm font-medium text-secondary-700 bg-white border border-secondary-300 rounded-lg hover:bg-secondary-50 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isInviting}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {isInviting && <Loader2 className="w-4 h-4 animate-spin" />}
              Inviter
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// COMPOSANT — MemberRow (synthèse, lecture seule, cliquable)
// =============================================================================

function MemberRow({ member, teamMember, orgRole, isCurrentUser, isCommercial, skillsSummary, onOpen }) {
  const effectiveRole = computeEffectiveRole(member.profile, { role: member.role });
  // Profil maison : libellé propre, sous-ligne « d'après <modèle> » ; le badge garde la couleur du modèle.
  const roleDisplay = memberRoleDisplay(effectiveRole, orgRole, ROLE_LABELS);
  const name = member.profile?.full_name || member.profile?.email || 'Utilisateur';
  const planification = teamMember ? planificationDe(teamMember.include_in_routing) : null;
  const jamaisPropose = skillsSummary && skillsSummary.entretien === 0;

  const open = () => onOpen(member.user_id);

  return (
    <tr
      className="group border-b border-secondary-100 last:border-0 hover:bg-secondary-50/70 cursor-pointer transition-colors"
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      tabIndex={0}
      role="button"
      aria-label={`Ouvrir la fiche de ${name}`}
    >
      {/* Membre : avatar de SA couleur planning */}
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-3">
          <MemberAvatar name={member.profile?.full_name} color={teamMember?.calendar_color} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-secondary-900 truncate">
              {name}
              {isCurrentUser && <span className="ml-2 text-xs font-normal text-secondary-400">(vous)</span>}
            </p>
            <p className="text-xs text-secondary-500 truncate">{member.profile?.email || ''}</p>
          </div>
        </div>
      </td>

      {/* Rôle + tag commercial */}
      <td className="py-3.5 px-4">
        <div className="flex flex-col items-start gap-1">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${getRoleColor(effectiveRole)}`}>
            <Shield className="w-3 h-3" />
            {roleDisplay.label}
          </span>
          {roleDisplay.sub && <span className="text-[11px] text-secondary-400">{roleDisplay.sub}</span>}
          {isCommercial && (
            <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full bg-secondary-100 text-secondary-700" title="Figure dans la liste « Commercial assigné » des leads">
              Assignable aux leads
            </span>
          )}
        </div>
      </td>

      {/* Planification + budget */}
      <td className="py-3.5 px-4">
        {!teamMember ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-secondary-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> ressource planning…</span>
        ) : (
          <div className="text-sm text-secondary-800">
            <p title={PLANIFICATION_HELP[planification]}>
              {PLANIFICATION_OPTIONS.find((o) => o.value === planification).label}
            </p>
            <p className="text-xs text-secondary-500" title={DAILY_WORK_MINUTES_HELP}>
              Budget {formatBudget(teamMember.daily_work_minutes)} / jour
            </p>
          </div>
        )}
      </td>

      {/* Horaires */}
      <td className="py-3.5 px-4">
        {teamMember ? (
          <span className="text-sm text-secondary-700">{resumeHoraires(teamMember.default_availability)}</span>
        ) : (
          <span className="text-xs text-secondary-400">—</span>
        )}
      </td>

      {/* Compétences (techniciens) */}
      <td className="py-3.5 px-4">
        {!teamMember || teamMember.role !== 'technician' ? (
          <span className="text-xs text-secondary-400" title="Seuls les techniciens ont une grille de compétences">—</span>
        ) : jamaisPropose ? (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium text-red-600"
            title="Aucune compétence Entretien cochée : jamais proposé en tournée"
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Jamais proposé en tournée
          </span>
        ) : skillsSummary ? (
          <span className="text-sm text-secondary-700 whitespace-nowrap">
            Entretien {skillsSummary.entretien}/{skillsSummary.total}
            <span className="text-secondary-400"> · </span>
            Pose {skillsSummary.pose}/{skillsSummary.total}
          </span>
        ) : (
          <span className="text-xs text-secondary-400">…</span>
        )}
      </td>

      {/* Action */}
      <td className="py-3.5 px-4 text-right">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-secondary-200 text-secondary-600 group-hover:border-primary-400 group-hover:text-primary-700 transition-colors">
          <Pencil className="w-3.5 h-3.5" /> Modifier
        </span>
      </td>
    </tr>
  );
}

// =============================================================================
// PAGE
// =============================================================================

export default function TeamManagement() {
  const navigate = useNavigate();
  const { organization, user, isOrgAdmin } = useAuth();
  const orgId = organization?.id;

  const {
    members, isLoading, error,
    updateRole, isUpdatingRole,
    inviteMember, isInviting,
  } = useOrgMembers(orgId);

  // Couleurs planning : team_members reliés aux membres par user_id.
  const { members: teamMembers, isLoading: isLoadingTeam } = useTeamMembers(orgId);
  const { setColor } = useSetTeamMemberColor(orgId);
  const { setRoutingSettings } = useSetTeamMemberRouting(orgId);
  const { ensureTeamMember } = useEnsureTeamMember(orgId);
  // Profils maison : options des menus (standards + profils actifs), profil porté par membre.
  const { activeOrgRoles, memberOrgRoleByUser, setMemberOrgRole } = useOrgRoles(orgId);
  const roleOptions = useMemo(
    () => buildRoleOptions(EFFECTIVE_ROLES, ROLE_LABELS, activeOrgRoles),
    [activeOrgRoles],
  );
  const roleOptionLabel = (value) => roleOptions.find((o) => o.value === value)?.label || value;
  // Liste « Commercial assigné » des leads : un membre y figure s'il a une ligne
  // active dans majordhome.commercials (reliée par profile_id).
  const { commercials } = useLeadCommercials(orgId);
  const { setCommercial } = useSetLeadCommercial(orgId);
  const commercialUserIds = useMemo(
    () => new Set(commercials.map((c) => c.profile_id).filter(Boolean)),
    [commercials],
  );
  const [savingCommercialId, setSavingCommercialId] = useState(null);
  // Compétences (type × rôle) des techniciens : compteurs sur la ligne, grille dans la modale.
  const technicianIds = useMemo(
    () => (teamMembers || []).filter((t) => t.role === 'technician').map((t) => t.id),
    [teamMembers],
  );
  const { skillsByMember } = useTeamSkills(orgId, technicianIds);
  const { equipmentTypes: activeTypes } = useEquipmentReferential();
  // Membre ouvert dans la modale : on garde l'id et on relit les données vivantes
  // à chaque rendu, pour que la modale reflète ce qu'elle vient d'enregistrer.
  const [editingUserId, setEditingUserId] = useState(null);
  const tmByUser = useMemo(() => {
    const map = new Map();
    (teamMembers || []).forEach((t) => { if (t.user_id) map.set(t.user_id, t); });
    return map;
  }, [teamMembers]);
  const [savingColorId, setSavingColorId] = useState(null);
  // Scopé par membre (même modèle que savingColorId ci-dessus) : un flag global
  // aurait désactivé les champs de TOUS les techniciens pendant l'enregistrement
  // d'une seule ligne, et `disabled` sur un input focalisé force un blur — un
  // admin en train de saisir le budget d'un autre membre aurait vu son brouillon
  // validé prématurément (fix round 1, 2026-08-29).
  const [savingRoutingId, setSavingRoutingId] = useState(null);

  // ---------------------------------------------------------------------------
  // Ressource planning auto : un membre invité n'a pas de ligne team_members
  // (create-user ne crée que profile + membership) → pas de couleur, absent du
  // planning. On la crée ici (RPC idempotente, org_admin only) avec une couleur
  // libre de la palette. Couvre les invitations ET les comptes créés hors app.
  // ---------------------------------------------------------------------------
  const ensuredRef = useRef(new Set());
  useEffect(() => {
    if (!isOrgAdmin || !orgId || isLoading || isLoadingTeam) return;

    const missing = members.filter(
      (m) => m.user_id && !tmByUser.has(m.user_id) && !ensuredRef.current.has(m.user_id)
    );
    if (missing.length === 0) return;

    const used = new Set(
      (teamMembers || []).map((t) => normalizeHex(t.calendar_color)).filter(Boolean)
    );

    (async () => {
      for (const m of missing) {
        ensuredRef.current.add(m.user_id);
        const color = pickFreeColor(used);
        used.add(color);

        try {
          await ensureTeamMember({ userId: m.user_id, color });
        } catch (error) {
          logger.error('[TeamManagement] ensureTeamMember failed', m.user_id, error);
          toast.error(
            `Ressource planning non créée pour ${m.profile?.full_name || 'ce membre'}`
          );
        }
      }
    })();
  }, [
    isOrgAdmin, orgId, isLoading, isLoadingTeam,
    members, teamMembers, tmByUser, ensureTeamMember,
  ]);

  const [updatingUserId, setUpdatingUserId] = useState(null);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Confirm dialog state for role change
  const [roleChangeConfirm, setRoleChangeConfirm] = useState(null);
  // { member, oldRole, newRole }

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  /**
   * Ouvre le dialog de confirmation quand le select change
   */
  const handleRoleChangeRequest = (member, oldRole, newRole) => {
    if (oldRole === newRole) return;
    setRoleChangeConfirm({ member, oldRole, newRole });
  };

  /**
   * Exécute le changement de rôle après confirmation
   */
  const handleRoleChangeConfirm = async () => {
    if (!roleChangeConfirm) return;

    const { member, newRole } = roleChangeConfirm;
    const choice = parseRoleChoice(newRole);
    if (!choice) return;
    const name = member.profile?.full_name || "l'utilisateur";

    setUpdatingUserId(member.user_id);

    try {
      if (choice.kind === 'org') {
        // Profil maison : la RPC pose le profil ET aligne les champs core sur le modèle
        const code = await setMemberOrgRole({ userId: member.user_id, orgRoleId: choice.orgRoleId });
        const picked = activeOrgRoles.find((r) => r.id === choice.orgRoleId);
        toast.success(`${name} est maintenant ${picked?.label || code}`);
      } else {
        const mapping = ROLE_DB_MAPPING[choice.role];
        if (!mapping) return;
        if (memberOrgRoleByUser.has(member.user_id)) {
          // Quitte le profil maison avant de poser le standard
          await setMemberOrgRole({ userId: member.user_id, orgRoleId: null });
        }
        const result = await updateRole({
          userId: member.user_id,
          appRole: mapping.app_role,
          businessRole: mapping.business_role,
          membershipRole: mapping.membership_role,
        });

        if (result?.error) {
          toast.error(result.error.message || 'Erreur lors du changement de rôle');
        } else {
          toast.success(`Rôle de ${name} changé en ${ROLE_LABELS[choice.role]}`);
        }
      }
    } catch (err) {
      toast.error(err?.code === '42501' ? 'Réservé à l’administrateur' : (err.message || 'Erreur inattendue'));
    } finally {
      setUpdatingUserId(null);
      setRoleChangeConfirm(null);
    }
  };

  /**
   * Invite un nouveau membre
   */
  const handleInvite = async (form) => {
    // Profil maison choisi : le compte est créé avec le MODÈLE, puis le profil est posé.
    const choice = parseRoleChoice(form.effectiveRole);
    const orgRole = choice?.kind === 'org' ? activeOrgRoles.find((r) => r.id === choice.orgRoleId) : null;
    const effectiveRole = orgRole ? orgRole.base_role : (choice?.role || 'technicien');
    const result = await inviteMember({
      email: form.email,
      password: form.password,
      fullName: form.fullName,
      effectiveRole,
    });
    if (result?.error || !orgRole) return result;

    const userId = result?.data?.user?.id;
    if (!userId) {
      return { error: new Error('Compte créé, mais profil non posé (identifiant manquant) — réglez-le dans la liste') };
    }
    try {
      await setMemberOrgRole({ userId, orgRoleId: orgRole.id });
    } catch (err) {
      return { error: new Error(`Compte créé, mais profil non posé : ${err?.message || 'erreur'} — réglez-le dans la liste`) };
    }
    return result;
  };

  /**
   * Inscrit / retire un membre de la liste « Commercial assigné » des leads.
   * Retirer ne désassigne rien : les leads déjà attribués gardent leur commercial.
   */
  const handleCommercialChange = async (member, active) => {
    setSavingCommercialId(member.user_id);
    const name = member.profile?.full_name || 'Ce membre';
    try {
      await setCommercial({ userId: member.user_id, active });
      toast.success(
        active
          ? `${name} est assignable aux leads`
          : `${name} n'est plus proposé à l'assignation des leads`
      );
    } catch (err) {
      logger.error('[TeamManagement] setCommercial failed', err);
      toast.error('Erreur lors de la mise à jour de la liste des commerciaux');
    } finally {
      setSavingCommercialId(null);
    }
  };

  /**
   * Change la couleur planning d'un membre (team_member.calendar_color).
   */
  const handleColorChange = async (teamMemberId, color) => {
    setSavingColorId(teamMemberId);
    try {
      await setColor({ teamMemberId, color });
      toast.success('Couleur mise à jour');
    } catch (err) {
      logger.error('[TeamManagement] setColor failed', err);
      toast.error('Erreur lors du changement de couleur');
    } finally {
      setSavingColorId(null);
    }
  };

  /**
   * Change le budget de travail journalier d'un membre (team_member.daily_work_minutes).
   * RPC `team_member_set_routing_settings` — patch partiel, n'envoie que ce champ
   * (l'autre reste inchangé côté DB via COALESCE). Hors [60, 1440] → erreur Postgres
   * 22023, traduite en français par `routingSettingsErrorMessage` (jamais affichée brute).
   */
  const handleDailyBudgetChange = async (teamMemberId, minutes) => {
    setSavingRoutingId(teamMemberId);
    try {
      await setRoutingSettings({ teamMemberId, dailyWorkMinutes: minutes });
      toast.success('Budget journalier mis à jour');
    } catch (err) {
      toast.error(routingSettingsErrorMessage(err, "Erreur lors de l'enregistrement du budget journalier"));
    } finally {
      setSavingRoutingId(null);
    }
  };

  /**
   * Inclut/exclut un membre de l'optimisation des tournées (team_member.include_in_routing).
   * Même RPC combinée, patch partiel (seul ce champ est envoyé).
   */
  const handleIncludeInRoutingChange = async (teamMemberId, include) => {
    setSavingRoutingId(teamMemberId);
    try {
      await setRoutingSettings({ teamMemberId, includeInRouting: include });
      toast.success(include ? 'Planifié par la machine' : 'Planifié à la main (sous-traitant ponctuel)');
    } catch (err) {
      toast.error(routingSettingsErrorMessage(err, 'Erreur lors de la mise à jour de la planification'));
    } finally {
      setSavingRoutingId(null);
    }
  };

  // ===========================================================================
  // DÉRIVÉS POUR LA MODALE
  // ===========================================================================

  const skillsSummaryFor = (tm) => (tm && tm.role === 'technician' && skillsByMember.has(tm.id)
    ? {
      entretien: skillsByMember.get(tm.id).entretien.size,
      pose: skillsByMember.get(tm.id).pose.size,
      total: activeTypes.length,
    }
    : null);

  // Données vivantes du membre ouvert (null si la liste a changé sous nos pieds).
  const editingMember = editingUserId ? members.find((m) => m.user_id === editingUserId) : null;
  const editingTeamMember = editingMember ? tmByUser.get(editingMember.user_id) : undefined;
  // Couleurs déjà portées par les AUTRES membres (hex normalisé → nom).
  const colorOwners = useMemo(() => {
    const map = new Map();
    (teamMembers || []).forEach((t) => {
      if (t.user_id === editingUserId) return;
      const hex = normalizeHex(t.calendar_color);
      if (hex && !map.has(hex)) map.set(hex, t.display_name);
    });
    return map;
  }, [teamMembers, editingUserId]);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-lg hover:bg-secondary-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-secondary-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-secondary-900 flex items-center gap-3">
              <Users className="w-7 h-7 text-primary-600" />
              Gestion de l&apos;équipe
            </h1>
            <p className="text-sm text-secondary-600 mt-1">
              Gérez les membres et leurs rôles dans l&apos;organisation. Cliquez sur un membre pour le modifier.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Inviter un membre
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card bg-red-50 border-red-200">
          <div className="flex items-center gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>Erreur lors du chargement des membres : {error.message}</p>
          </div>
        </div>
      )}

      {/* Membres */}
      {!isLoading && !error && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-secondary-200">
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">
                  Membre
                  <span className="block text-xs font-normal text-secondary-400">La pastille porte sa couleur planning</span>
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">Rôle</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">
                  Planification
                  <span className="block text-xs font-normal text-secondary-400">Qui pose ses rendez-vous · budget</span>
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">
                  Horaires
                  <span className="block text-xs font-normal text-secondary-400">Jours et heures travaillés</span>
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">
                  Compétences
                  <span className="block text-xs font-normal text-secondary-400">Entretien · Pose, sur les types actifs</span>
                </th>
                <th className="py-3 px-4"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const tm = tmByUser.get(member.user_id);
                return (
                  <MemberRow
                    key={member.user_id}
                    member={member}
                    teamMember={tm}
                    orgRole={memberOrgRoleByUser.get(member.user_id) || null}
                    isCurrentUser={member.user_id === user?.id}
                    isCommercial={commercialUserIds.has(member.user_id)}
                    skillsSummary={skillsSummaryFor(tm)}
                    onOpen={setEditingUserId}
                  />
                );
              })}
            </tbody>
          </table>

          {members.length === 0 && (
            <div className="py-8 text-center text-secondary-500 text-sm">
              Aucun membre trouvé
            </div>
          )}
        </div>
      )}

      {/* Info rôles */}
      <div className="card bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">À propos des rôles</p>
            <ul className="mt-1 space-y-1 text-blue-700">
              <li><strong>Administrateur</strong> — Accès complet, gestion des paramètres et de l&apos;équipe</li>
              <li><strong>Responsable</strong> — Vision globale, supervision de l&apos;équipe</li>
              <li><strong>Commercial</strong> — Pipeline, ses leads et chantiers, planning</li>
              <li><strong>Technicien</strong> — Clients, chantiers planifiés, entretiens, planning</li>
              <li><strong>Profil maison</strong> — créé dans Droits d&apos;accès à partir d&apos;un modèle ; hors de la grille des droits, l&apos;application le traite comme son modèle</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* MODALS                                                            */}
      {/* ================================================================= */}

      {/* Invite Modal */}
      <InviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onInvite={handleInvite}
        isInviting={isInviting}
        roleOptions={roleOptions}
      />

      {/* Fiche membre (édition) */}
      {editingMember && (
        <MemberModal
          member={editingMember}
          teamMember={editingTeamMember}
          orgRole={memberOrgRoleByUser.get(editingMember.user_id) || null}
          roleOptions={roleOptions}
          canEdit={isOrgAdmin}
          isCurrentUser={editingMember.user_id === user?.id}
          isUpdatingRole={isUpdatingRole || updatingUserId === editingMember.user_id}
          onRoleChangeRequest={handleRoleChangeRequest}
          isCommercial={commercialUserIds.has(editingMember.user_id)}
          onCommercialChange={handleCommercialChange}
          isCommercialSaving={savingCommercialId === editingMember.user_id}
          onColorChange={handleColorChange}
          isColorSaving={!!editingTeamMember && savingColorId === editingTeamMember.id}
          onDailyBudgetChange={handleDailyBudgetChange}
          onIncludeInRoutingChange={handleIncludeInRoutingChange}
          isRoutingSaving={!!editingTeamMember && savingRoutingId === editingTeamMember.id}
          colorOwners={colorOwners}
          onClose={() => setEditingUserId(null)}
        />
      )}

      {/* Confirm Role Change Dialog — s'affiche au-dessus de la fiche membre */}
      <ConfirmDialog
        open={!!roleChangeConfirm}
        onOpenChange={(open) => { if (!open) setRoleChangeConfirm(null); }}
        title="Changer le rôle"
        description={
          roleChangeConfirm
            ? `Voulez-vous changer le rôle de ${roleChangeConfirm.member.profile?.full_name || "l'utilisateur"} de "${roleOptionLabel(roleChangeConfirm.oldRole)}" en "${roleOptionLabel(roleChangeConfirm.newRole)}" ?`
            : ''
        }
        confirmLabel="Confirmer le changement"
        variant="default"
        onConfirm={handleRoleChangeConfirm}
        loading={updatingUserId === roleChangeConfirm?.member?.user_id}
      />
    </div>
  );
}
