/**
 * ClientEquipements.jsx - Portail Client
 * ============================================================================
 * Liste des equipements du client (read-only).
 * ============================================================================
 */

import { useAuth } from '@contexts/AuthContext';
import { useClientEquipments } from '@hooks/useClients';
import { Wrench, Calendar, Tag, Loader2 } from 'lucide-react';
import { formatDateFR } from '@/lib/utils';
import { EQUIPMENT_CATEGORY_LABELS as CATEGORY_LABELS } from '../constants';

export default function ClientEquipements() {
  const { clientId } = useAuth();
  const { equipments, isLoading } = useClientEquipments(clientId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Mes équipements</h1>

      {!equipments || equipments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Wrench className="w-12 h-12 text-gray-300 mx-auto" />
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Aucun équipement</h2>
          <p className="mt-2 text-sm text-gray-500">
            Vos equipements apparaîtront ici une fois enregistrés par votre technicien.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {equipments.map((eq) => (
            <div
              key={eq.id}
              className="bg-white rounded-xl border border-gray-200 p-5"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-50 rounded-lg shrink-0">
                  <Wrench className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900">
                    {eq.equipment_type_name || CATEGORY_LABELS[eq.equipment_category] || 'Equipement'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {[eq.brand, eq.model].filter(Boolean).join(' - ') || 'Marque/modèle non renseigné'}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                {eq.serial_number && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Tag className="w-3.5 h-3.5 text-gray-400" />
                    N° série : {eq.serial_number}
                  </div>
                )}
                {eq.install_date && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    Installé le {formatDateFR(eq.install_date)}
                  </div>
                )}
                {eq.installation_year && !eq.install_date && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    Année d'installation : {eq.installation_year}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
