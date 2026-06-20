/**
 * TeamManagement.jsx - Majord'home Artisan
 * ============================================================================
 * Page de gestion de l'équipe (org_admin uniquement).
 *
 * Source unique : core.organization_members + profiles
 * Changement de rôle avec confirmation (ConfirmDialog).
 * Invitation de nouveaux membres via Edge Function create-user.
 *
 * @version 3.0.0 - Sprint 7 — Droits & Accès (invite + confirm)
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useOrgMembers } from '@hooks/usePermissions';
import { useTeamMembers, useSetTeamMemberColor } from '@hooks/useAppointments';
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
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { FormField, TextInput, SelectInput } from '@apps/artisan/components/FormFields';

// =============================================================================
// HELPERS
// =============================================================================

const getRoleColor = (role) => {
  switch (role) {
    case 'org_admin':   return 'bg-purple-100 text-purple-700';
    case 'team_leader': return 'bg-blue-100 text-blue-700';
    case 'commercial':  return 'bg-amber-100 text-amber-700';
    case 'technicien':  return 'bg-green-100 text-green-700';
    default:            return 'bg-secondary-100 text-secondary-700';
  }
};

const getInitials = (name) => {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const ROLE_OPTIONS = EFFECTIVE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

// Palette planning : couleurs distinctes et lisibles. Le violet #6D28D9 est
// volontairement EXCLU (réservé aux RDV facturés sur le calendrier).
const PLANNING_COLORS = [
  '#EF4444', '#F97316', '#F59E0B', '#10B981', '#0D9488',
  '#06B6D4', '#3B82F6', '#6366F1', '#DB2777', '#64748B',
];

// =============================================================================
// COMPOSANT — MemberColorPicker
// =============================================================================

function MemberColorPicker({ color, onPick, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-2 px-2 py-1 rounded-lg border border-secondary-300 hover:bg-secondary-50 transition-colors disabled:opacity-50"
        title="Changer la couleur planning"
      >
        <span className="w-4 h-4 rounded-full border border-black/10" style={{ backgroundColor: color || '#94A3B8' }} />
        <ChevronDown className={`w-3 h-3 text-secondary-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-secondary-200 rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1.5">
            {PLANNING_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onPick(c); setOpen(false); }}
                className={`w-6 h-6 rounded-full border-2 transition ${color === c ? 'border-secondary-900' : 'border-transparent hover:border-secondary-300'}`}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// COMPOSANT — InviteModal
// =============================================================================

function InviteModal({ open, onClose, onInvite, isInviting }) {
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
              options={ROLE_OPTIONS}
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
// COMPOSANT — MemberRow
// =============================================================================

function MemberRow({ member, teamMember, canEditColor, isCurrentUser, isUpdating, isUpdatingRole, onRoleChangeRequest, onColorChange, isColorSaving }) {
  const effectiveRole = computeEffectiveRole(member.profile, { role: member.role });

  return (
    <tr className="border-b border-secondary-100 last:border-0">
      {/* Membre */}
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center">
            <span className="text-sm font-medium text-white">
              {getInitials(member.profile?.full_name)}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-secondary-900">
              {member.profile?.full_name || member.profile?.email || 'Utilisateur'}
              {isCurrentUser && (
                <span className="ml-2 text-xs text-secondary-400">(vous)</span>
              )}
            </p>
            <p className="text-xs text-secondary-500">
              {member.profile?.email || ''}
            </p>
          </div>
        </div>
      </td>

      {/* Rôle actuel */}
      <td className="py-4 px-4">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${getRoleColor(effectiveRole)}`}>
          <Shield className="w-3 h-3" />
          {ROLE_LABELS[effectiveRole] || effectiveRole}
        </span>
      </td>

      {/* Changement de rôle */}
      <td className="py-4 px-4">
        {isCurrentUser ? (
          <span className="text-xs text-secondary-400 italic">
            Vous ne pouvez pas changer votre propre rôle
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={effectiveRole}
              onChange={(e) => onRoleChangeRequest(member, effectiveRole, e.target.value)}
              disabled={isUpdating || isUpdatingRole}
              className="text-sm border border-secondary-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
            >
              {EFFECTIVE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            {isUpdating && (
              <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />
            )}
          </div>
        )}
      </td>

      {/* Couleur planning */}
      <td className="py-4 px-4">
        {!teamMember ? (
          <span className="text-xs text-secondary-400">—</span>
        ) : canEditColor ? (
          <MemberColorPicker
            color={teamMember.calendar_color}
            onPick={(c) => onColorChange(teamMember.id, c)}
            disabled={isColorSaving}
          />
        ) : (
          <span
            className="inline-block w-4 h-4 rounded-full border border-black/10"
            style={{ backgroundColor: teamMember.calendar_color || '#94A3B8' }}
            title={teamMember.calendar_color || ''}
          />
        )}
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
  const { members: teamMembers } = useTeamMembers(orgId);
  const { setColor } = useSetTeamMemberColor(orgId);
  const tmByUser = useMemo(() => {
    const map = new Map();
    (teamMembers || []).forEach((t) => { if (t.user_id) map.set(t.user_id, t); });
    return map;
  }, [teamMembers]);
  const [savingColorId, setSavingColorId] = useState(null);

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
    const mapping = ROLE_DB_MAPPING[newRole];
    if (!mapping) return;

    setUpdatingUserId(member.user_id);

    try {
      const result = await updateRole({
        userId: member.user_id,
        appRole: mapping.app_role,
        businessRole: mapping.business_role,
        membershipRole: mapping.membership_role,
      });

      if (result?.error) {
        toast.error(result.error.message || 'Erreur lors du changement de rôle');
      } else {
        toast.success(
          `Rôle de ${member.profile?.full_name || "l'utilisateur"} changé en ${ROLE_LABELS[newRole]}`
        );
      }
    } catch (err) {
      toast.error(err.message || 'Erreur inattendue');
    } finally {
      setUpdatingUserId(null);
      setRoleChangeConfirm(null);
    }
  };

  /**
   * Invite un nouveau membre
   */
  const handleInvite = async (form) => {
    const result = await inviteMember({
      email: form.email,
      password: form.password,
      fullName: form.fullName,
      effectiveRole: form.effectiveRole,
    });
    return result;
  };

  /**
   * Change la couleur planning d'un membre (team_member.calendar_color).
   */
  const handleColorChange = async (teamMemberId, color) => {
    setSavingColorId(teamMemberId);
    try {
      const result = await setColor({ teamMemberId, color });
      if (result?.error) {
        toast.error('Erreur lors du changement de couleur');
      } else {
        toast.success('Couleur mise à jour');
      }
    } catch {
      toast.error('Erreur inattendue');
    } finally {
      setSavingColorId(null);
    }
  };

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
              Gestion de l'équipe
            </h1>
            <p className="text-sm text-secondary-600 mt-1">
              Gérez les membres et leurs rôles dans l'organisation
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
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">
                  Rôle actuel
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">
                  Changer le rôle
                </th>
                <th className="text-left py-3 px-4 text-sm font-medium text-secondary-600">
                  Couleur planning
                </th>
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
                    canEditColor={isOrgAdmin}
                    isCurrentUser={member.user_id === user?.id}
                    isUpdating={updatingUserId === member.user_id}
                    isUpdatingRole={isUpdatingRole}
                    onRoleChangeRequest={handleRoleChangeRequest}
                    onColorChange={handleColorChange}
                    isColorSaving={!!tm && savingColorId === tm.id}
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
              <li><strong>Administrateur</strong> — Accès complet, gestion des paramètres et de l'équipe</li>
              <li><strong>Responsable</strong> — Vision globale, supervision de l'équipe</li>
              <li><strong>Commercial</strong> — Pipeline, ses leads et chantiers, planning</li>
              <li><strong>Technicien</strong> — Clients, chantiers planifiés, entretiens, planning</li>
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
      />

      {/* Confirm Role Change Dialog */}
      <ConfirmDialog
        open={!!roleChangeConfirm}
        onOpenChange={(open) => { if (!open) setRoleChangeConfirm(null); }}
        title="Changer le rôle"
        description={
          roleChangeConfirm
            ? `Voulez-vous changer le rôle de ${roleChangeConfirm.member.profile?.full_name || "l'utilisateur"} de "${ROLE_LABELS[roleChangeConfirm.oldRole]}" en "${ROLE_LABELS[roleChangeConfirm.newRole]}" ?`
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
