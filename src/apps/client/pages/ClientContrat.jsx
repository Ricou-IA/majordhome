/**
 * ClientContrat.jsx - Portail Client
 * ============================================================================
 * Page contrat : details du contrat actif + equipements couverts (read-only).
 * ============================================================================
 */

import { useAuth } from '@contexts/AuthContext';
import { useClientContract, useContractEquipments } from '@hooks/useContracts';
import {
  FileText, CheckCircle2, XCircle, Clock, Wrench, Calendar, Loader2,
} from 'lucide-react';
import { formatDateFR, formatEuro } from '@/lib/utils';

const STATUS_CONFIG = {
  active: { label: 'Actif', color: 'text-green-700 bg-green-50', icon: CheckCircle2 },
  pending: { label: 'En attente', color: 'text-amber-700 bg-amber-50', icon: Clock },
  cancelled: { label: 'Résilié', color: 'text-red-700 bg-red-50', icon: XCircle },
  archived: { label: 'Archivé', color: 'text-gray-500 bg-gray-100', icon: XCircle },
};

const FREQUENCY_LABELS = {
  annual: 'Annuelle',
  biannual: 'Semestrielle',
  quarterly: 'Trimestrielle',
  monthly: 'Mensuelle',
};

export default function ClientContrat() {
  const { clientId } = useAuth();
  const { contract, isLoading } = useClientContract(clientId);
  const { equipments, isLoading: eqLoading } = useContractEquipments(contract?.id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <FileText className="w-12 h-12 text-gray-300 mx-auto" />
        <h2 className="mt-4 text-lg font-semibold text-gray-900">Aucun contrat</h2>
        <p className="mt-2 text-sm text-gray-500">
          Vous n'avez pas de contrat d'entretien actif. Contactez Mayer Energie pour en souscrire un.
        </p>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[contract.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Mon contrat d'entretien</h1>

      {/* Carte contrat */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Contrat {contract.frequency ? FREQUENCY_LABELS[contract.frequency] || contract.frequency : ''}
            </h2>
            {contract.contract_number && (
              <p className="text-sm text-gray-500 mt-0.5">N° {contract.contract_number}</p>
            )}
          </div>
          <span className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full ${statusCfg.color}`}>
            <StatusIcon className="w-4 h-4" />
            {statusCfg.label}
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              Date de début
            </span>
            <p className="mt-1 font-medium text-gray-900">
              {contract.start_date ? formatDateFR(contract.start_date) : '-'}
            </p>
          </div>

          <div>
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              Date de fin
            </span>
            <p className="mt-1 font-medium text-gray-900">
              {contract.end_date ? formatDateFR(contract.end_date) : '-'}
            </p>
          </div>

          <div>
            <span className="text-sm text-gray-500 flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              Prochaine visite
            </span>
            <p className="mt-1 font-medium text-gray-900">
              {contract.next_maintenance_date ? formatDateFR(contract.next_maintenance_date) : 'Non planifiée'}
            </p>
          </div>

          {contract.amount && (
            <div>
              <span className="text-sm text-gray-500">Montant annuel</span>
              <p className="mt-1 font-medium text-gray-900">{formatEuro(contract.amount)}</p>
            </div>
          )}

          {contract.frequency && (
            <div>
              <span className="text-sm text-gray-500">Fréquence</span>
              <p className="mt-1 font-medium text-gray-900">
                {FREQUENCY_LABELS[contract.frequency] || contract.frequency}
              </p>
            </div>
          )}
        </div>

        {contract.notes && (
          <div className="mt-6 pt-4 border-t border-gray-100">
            <span className="text-sm text-gray-500">Notes</span>
            <p className="mt-1 text-sm text-gray-700">{contract.notes}</p>
          </div>
        )}
      </div>

      {/* Équipements couverts */}
      {!eqLoading && equipments && equipments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-gray-400" />
            Équipements couverts ({equipments.length})
          </h2>
          <div className="divide-y divide-gray-100">
            {equipments.map((eq) => (
              <div key={eq.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">
                    {eq.equipment_type_name || eq.equipment_category || 'Equipement'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {[eq.brand, eq.model].filter(Boolean).join(' - ') || 'Marque/modèle non renseigné'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
