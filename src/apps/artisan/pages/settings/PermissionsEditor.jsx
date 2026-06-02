/**
 * PermissionsEditor.jsx - Majord'home Artisan
 * ============================================================================
 * Page d'édition de la matrice de permissions (org_admin uniquement).
 * Grille : lignes = resources × actions, colonnes = rôles éditables.
 *
 * @version 1.0.0 - Sprint 7 — Droits & Accès
 * ============================================================================
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { usePermissions } from '@hooks/usePermissions';
import { permissionsService } from '@services/permissions.service';
import { ACTIONS, EDITABLE_ROLES, ROLE_LABELS, hasPermission } from '@lib/permissions';
import { REGISTRY } from '@lib/permissionsRegistry';
import {
  Shield,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Check,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { permissionKeys } from '@hooks/usePermissions';

// =============================================================================
// PAGE
// =============================================================================

export default function PermissionsEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { permissionMap, permissionRows, isLoading, error } = usePermissions(orgId);

  const ACTION_LABEL = Object.fromEntries(ACTIONS.map((a) => [a.key, a.label]));
  const overrideSet = new Set(
    (permissionRows || []).map((r) => `${r.role}:${r.resource}:${r.action}`)
  );

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleToggle = useCallback(
    async (role, resource, action, currentValue) => {
      const newValue = !currentValue;

      // Optimistic update
      queryClient.setQueryData(permissionKeys.org(orgId), (old) => {
        if (!old) return old;
        const newRows = old.rows.map((row) => {
          if (row.role === role && row.resource === resource && row.action === action) {
            return { ...row, allowed: newValue };
          }
          return row;
        });
        // Si la row n'existe pas encore, l'ajouter
        const exists = newRows.some(
          (r) => r.role === role && r.resource === resource && r.action === action
        );
        if (!exists) {
          newRows.push({ org_id: orgId, role, resource, action, allowed: newValue });
        }
        return {
          rows: newRows,
          map: { ...old.map, [`${role}:${resource}:${action}`]: newValue },
        };
      });

      // Persist
      const { error: updateError } = await permissionsService.updatePermission(
        orgId,
        role,
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

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
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
            Droits d'accès
          </h1>
          <p className="text-sm text-secondary-600 mt-1">
            Configurez les permissions par rôle. L'administrateur a toujours accès à tout.
          </p>
        </div>
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
                {EDITABLE_ROLES.map((role) => (
                  <th
                    key={role}
                    className="text-center py-3 px-3 text-sm font-semibold text-secondary-800 min-w-[120px]"
                  >
                    {ROLE_LABELS[role]}
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
                    {EDITABLE_ROLES.map((role) => {
                      const allowed = hasPermission(permissionMap, role, resourceKey, actionKey);
                      const isOverride = overrideSet.has(`${role}:${resourceKey}:${actionKey}`);
                      return (
                        <td key={role} className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => handleToggle(role, resourceKey, actionKey, allowed)}
                            className={`relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                              allowed
                                ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                                : 'bg-secondary-100 text-secondary-400 hover:bg-secondary-200'
                            } ${isOverride ? 'ring-2 ring-amber-400' : ''}`}
                            title={`${ROLE_LABELS[role]} : ${allowed ? 'autorisé' : 'refusé'}${isOverride ? ' (surcharge org)' : ' (défaut app)'}`}
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
            </ul>
            <p className="mt-2 text-blue-600 italic">
              L'administrateur a toujours accès à tout, indépendamment de cette matrice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
