/**
 * PermissionsEditor.jsx - Majord'home Artisan
 * ============================================================================
 * Page d'édition de la matrice de permissions (org_admin uniquement).
 * Grille : lignes = resources × actions, colonnes = rôles standard éditables
 * + un profil « maison » par colonne (bouton (+), spec 2026-10-06).
 *
 * Un profil maison démarre avec les droits de son modèle (chaîne : surcharge du
 * profil → surcharge du modèle → défaut app) ; chaque case peut en diverger.
 *
 * @version 2.0.0 - profils maison (tranche 2)
 * ============================================================================
 */

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { usePermissions } from '@hooks/usePermissions';
import { useOrgRoles } from '@hooks/useOrgRoles';
import { permissionsService } from '@services/permissions.service';
import { ACTIONS, EDITABLE_ROLES, ROLE_LABELS } from '@lib/permissions';
import { REGISTRY, resolvePermission } from '@lib/permissionsRegistry';
import { permissionColumns } from '@/lib/orgRoles';
import {
  Shield,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Check,
  X,
  Plus,
  MoreHorizontal,
  Pencil,
  EyeOff,
  Eye,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { permissionKeys } from '@hooks/usePermissions';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { OrgRoleModal } from './permissions/OrgRoleModal';

const orgRoleErrorMessage = (err, fallback) =>
  (err?.code === '42501' ? 'Réservé à l’administrateur' : fallback);

// =============================================================================
// COMPOSANT — menu d'en-tête d'un profil maison (renommer / désactiver / supprimer)
// =============================================================================

function OrgRoleHeaderMenu({ orgRole, open, onToggle, onRename, onDeactivate, onDelete }) {
  return (
    <div className="relative inline-block ml-1 align-middle">
      <button
        type="button"
        onClick={onToggle}
        className="p-1 rounded hover:bg-secondary-100 text-secondary-400 hover:text-secondary-700"
        title={`Options du profil ${orgRole.label}`}
        aria-label={`Options du profil ${orgRole.label}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-secondary-200 bg-white shadow-lg text-left">
          <button type="button" onClick={onRename} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-700 hover:bg-secondary-50">
            <Pencil className="w-3.5 h-3.5" /> Renommer
          </button>
          <button type="button" onClick={onDeactivate} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-secondary-700 hover:bg-secondary-50">
            <EyeOff className="w-3.5 h-3.5" /> Désactiver
          </button>
          <button type="button" onClick={onDelete} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" /> Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PAGE
// =============================================================================

export default function PermissionsEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { permissionMap, permissionRows, isLoading, error } = usePermissions(orgId);
  const {
    orgRoles, activeOrgRoles, memberOrgRoleByUser,
    createOrgRole, updateOrgRole, deleteOrgRole, isMutating,
  } = useOrgRoles(orgId);

  // null | { mode: 'create' } | { mode: 'rename', orgRole }
  const [modal, setModal] = useState(null);
  const [menuFor, setMenuFor] = useState(null);     // id du profil dont le menu est ouvert
  const [deleteFor, setDeleteFor] = useState(null); // profil à supprimer (ConfirmDialog)

  const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label]));
  const overrideSet = new Set(
    (permissionRows || []).map((r) => `${r.role}:${r.resource}:${r.action}`)
  );
  const columns = permissionColumns(EDITABLE_ROLES, ROLE_LABELS, activeOrgRoles);
  const inactiveOrgRoles = orgRoles.filter((r) => !r.is_active);
  const membersOf = (orgRole) =>
    [...memberOrgRoleByUser.values()].filter((m) => m.org_role_id === orgRole.id).length;

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  // roleKey = rôle standard OU code d'un profil maison (org_upsert_role_permission accepte les deux)
  const handleToggle = useCallback(
    async (roleKey, resource, action, currentValue) => {
      const newValue = !currentValue;

      // Optimistic update
      queryClient.setQueryData(permissionKeys.org(orgId), (old) => {
        if (!old) return old;
        const newRows = old.rows.map((row) => {
          if (row.role === roleKey && row.resource === resource && row.action === action) {
            return { ...row, allowed: newValue };
          }
          return row;
        });
        // Si la row n'existe pas encore, l'ajouter
        const exists = newRows.some(
          (r) => r.role === roleKey && r.resource === resource && r.action === action
        );
        if (!exists) {
          newRows.push({ org_id: orgId, role: roleKey, resource, action, allowed: newValue });
        }
        return {
          rows: newRows,
          map: { ...old.map, [`${roleKey}:${resource}:${action}`]: newValue },
        };
      });

      // Persist
      const { error: updateError } = await permissionsService.updatePermission(
        orgId,
        roleKey,
        resource,
        action,
        newValue
      );

      if (updateError) {
        toast.error('Erreur lors de la mise à jour');
        // Rollback
        queryClient.invalidateQueries({ queryKey: permissionKeys.org(orgId) });
      }
    },
    [orgId, queryClient]
  );

  const handleModalSubmit = async ({ label, baseRole }) => {
    try {
      if (modal?.mode === 'rename') {
        await updateOrgRole({ orgRoleId: modal.orgRole.id, label });
        toast.success('Profil renommé');
      } else {
        await createOrgRole({ label, baseRole });
        toast.success('Profil créé — réglez ses cases dans sa colonne');
      }
      setModal(null);
    } catch (err) {
      toast.error(orgRoleErrorMessage(err, 'Erreur lors de l’enregistrement du profil'));
    }
  };

  const handleSetActive = async (orgRole, isActive) => {
    setMenuFor(null);
    try {
      await updateOrgRole({ orgRoleId: orgRole.id, isActive });
      toast.success(isActive
        ? `Profil « ${orgRole.label} » réactivé`
        : `Profil « ${orgRole.label} » désactivé — ses membres agissent comme leur modèle`);
    } catch (err) {
      toast.error(orgRoleErrorMessage(err, 'Erreur lors de la mise à jour du profil'));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteFor) return;
    try {
      const res = await deleteOrgRole(deleteFor.id);
      toast.success(`Profil supprimé (${res?.members_reset ?? 0} membre(s) remis sur le modèle)`);
      setDeleteFor(null);
    } catch (err) {
      toast.error(orgRoleErrorMessage(err, 'Erreur lors de la suppression du profil'));
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
              <Shield className="w-7 h-7 text-primary-600" />
              Droits d&apos;accès
            </h1>
            <p className="text-sm text-secondary-600 mt-1">
              Configurez les permissions par rôle. L&apos;administrateur a toujours accès à tout.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Ajouter un profil
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
            <p>Erreur lors du chargement des permissions : {error.message}</p>
          </div>
        </div>
      )}

      {/* Matrice */}
      {!isLoading && !error && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-secondary-200">
                <th className="text-left py-3 px-4 text-sm font-semibold text-secondary-800 min-w-[200px]">
                  Resource / Action
                </th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-center py-3 px-3 text-sm font-semibold text-secondary-800 min-w-[120px]"
                  >
                    {col.label}
                    {col.orgRole && (
                      <OrgRoleHeaderMenu
                        orgRole={col.orgRole}
                        open={menuFor === col.orgRole.id}
                        onToggle={() => setMenuFor(menuFor === col.orgRole.id ? null : col.orgRole.id)}
                        onRename={() => { setMenuFor(null); setModal({ mode: 'rename', orgRole: col.orgRole }); }}
                        onDeactivate={() => handleSetActive(col.orgRole, false)}
                        onDelete={() => { setMenuFor(null); setDeleteFor(col.orgRole); }}
                      />
                    )}
                    {col.sub && (
                      <span className="block text-xs font-normal text-secondary-400">{col.sub}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(REGISTRY).map(([resourceKey, def]) => {
                const actionKeys = Object.keys(def.actions);
                return actionKeys.map((actionKey, actionIdx) => (
                  <tr
                    key={`${resourceKey}-${actionKey}`}
                    className={`border-b border-secondary-100 ${actionIdx === 0 ? 'border-t-2 border-t-secondary-200' : ''}`}
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        {actionIdx === 0 && (
                          <span className="text-sm font-semibold text-secondary-900">{def.label}</span>
                        )}
                        {actionIdx > 0 && <span className="w-[1px]" />}
                        <span className="text-sm text-secondary-500 ml-4">
                          {ACTION_LABEL[actionKey] || actionKey}
                        </span>
                      </div>
                    </td>
                    {columns.map((col) => {
                      const allowed = resolvePermission(permissionMap, col.role, resourceKey, actionKey, col.code);
                      const isOverride = overrideSet.has(`${col.key}:${resourceKey}:${actionKey}`);
                      const origin = isOverride ? ' (surcharge)' : (col.code ? ' (hérité du modèle)' : ' (défaut app)');
                      return (
                        <td key={col.key} className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => handleToggle(col.key, resourceKey, actionKey, allowed)}
                            className={`relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                              allowed
                                ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                                : 'bg-secondary-100 text-secondary-400 hover:bg-secondary-200'
                            } ${isOverride ? 'ring-2 ring-amber-400' : ''}`}
                            title={`${col.label} : ${allowed ? 'autorisé' : 'refusé'}${origin}`}
                          >
                            {allowed ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Profils désactivés : hors menus et hors grille, réactivables */}
      {!isLoading && !error && inactiveOrgRoles.length > 0 && (
        <div className="card">
          <p className="text-sm font-medium text-secondary-800 mb-2">Profils désactivés</p>
          <ul className="space-y-2">
            {inactiveOrgRoles.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-secondary-700">
                  {r.label}
                  <span className="ml-2 text-xs text-secondary-400">d’après {ROLE_LABELS[r.base_role] || r.base_role} · {membersOf(r)} membre(s)</span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSetActive(r, true)}
                    disabled={isMutating}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-secondary-300 text-secondary-700 hover:border-primary-400 hover:text-primary-700 disabled:opacity-50"
                  >
                    <Eye className="w-3.5 h-3.5" /> Réactiver
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteFor(r)}
                    disabled={isMutating}
                    className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
                    title="Supprimer ce profil"
                    aria-label={`Supprimer le profil ${r.label}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Info */}
      <div className="card bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium">Comment fonctionnent les permissions</p>
            <ul className="mt-1 space-y-1 text-blue-700">
              <li>
                <strong>Voir</strong> — Accès à la page et aux données
              </li>
              <li>
                <strong>Créer</strong> — Possibilité de créer de nouveaux éléments
              </li>
              <li>
                <strong>Modifier</strong> — Modifier tous les éléments
              </li>
              <li>
                <strong>Modifier (les siens)</strong> — Modifier uniquement ses propres éléments
              </li>
              <li>
                <strong>Supprimer</strong> — Supprimer des éléments
              </li>
              <li>
                <strong>Assigner</strong> — Assigner un commercial à un lead
              </li>
              <li>
                <strong>Anneau ambre</strong> — réglage spécifique à cette organisation (surcharge). Sans anneau = défaut commun à toutes les organisations.
              </li>
              <li>
                <strong>Profil maison</strong> — colonne ajoutée par « Ajouter un profil » : démarre avec les droits de son modèle, chaque case peut en diverger (anneau ambre). Hors de cette grille, l&apos;application le traite comme son modèle.
              </li>
            </ul>
            <p className="mt-2 text-blue-600 italic">
              L&apos;administrateur a toujours accès à tout, indépendamment de cette matrice.
            </p>
          </div>
        </div>
      </div>

      <OrgRoleModal
        open={!!modal}
        onClose={() => setModal(null)}
        onSubmit={handleModalSubmit}
        initial={modal?.mode === 'rename' ? modal.orgRole : null}
        isSaving={isMutating}
      />

      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={(open) => { if (!open) setDeleteFor(null); }}
        title="Supprimer ce profil ?"
        description={deleteFor
          ? `« ${deleteFor.label} » sera supprimé. ${membersOf(deleteFor)} membre(s) le portent : ils reprendront les droits du modèle (${ROLE_LABELS[deleteFor.base_role] || deleteFor.base_role}). Les cases réglées pour ce profil seront perdues.`
          : ''}
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        loading={isMutating}
      />
    </div>
  );
}
