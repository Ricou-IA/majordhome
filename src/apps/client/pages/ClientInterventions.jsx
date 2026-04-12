/**
 * ClientInterventions.jsx - Portail Client
 * ============================================================================
 * Historique des interventions du client (read-only).
 * ============================================================================
 */

import { Link } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useProjectInterventions } from '@hooks/useInterventions';
import {
  ClipboardList, Calendar, User, ChevronRight, Loader2,
} from 'lucide-react';
import { formatDateFR } from '@/lib/utils';
import { INTERVENTION_STATUS_CONFIG as STATUS_CONFIG, INTERVENTION_TYPE_LABELS as TYPE_LABELS } from '../constants';

export default function ClientInterventions() {
  const { clientProjectId } = useAuth();
  const { interventions, isLoading } = useProjectInterventions(clientProjectId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  // Filtrer les enfants (certificats) — ne montrer que les parents
  const parentInterventions = (interventions || []).filter(i => !i.parent_id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Mes interventions</h1>

      {parentInterventions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <ClipboardList className="w-12 h-12 text-gray-300 mx-auto" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Aucune intervention</h2>
          <p className="mt-2 text-sm text-gray-500">
            Vos interventions apparaîtront ici après chaque passage de votre technicien.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {parentInterventions.map((intervention) => {
            const statusCfg = STATUS_CONFIG[intervention.status] || STATUS_CONFIG.scheduled;
            const StatusIcon = statusCfg.icon;
            const typeLabel = TYPE_LABELS[intervention.intervention_type] || intervention.intervention_type || 'Intervention';

            return (
              <Link
                key={intervention.id}
                to={`/client/interventions/${intervention.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-primary-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-amber-50 rounded-lg">
                      <ClipboardList className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{typeLabel}</h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                        {intervention.scheduled_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {formatDateFR(intervention.scheduled_date)}
                          </span>
                        )}
                        {intervention.technician_name && (
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            {intervention.technician_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${statusCfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusCfg.label}
                    </span>
                    <ChevronRight className="w-5 h-5 text-gray-300" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
