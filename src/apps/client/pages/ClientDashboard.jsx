/**
 * ClientDashboard.jsx - Portail Client
 * ============================================================================
 * Page d'accueil du portail client. Résumé : infos, contrat, équipements.
 * ============================================================================
 */

import { Link } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useClient } from '@hooks/useClients';
import { useClientContract } from '@hooks/useContracts';
import {
  FileText, Wrench, ClipboardList, CheckCircle2, AlertCircle, Loader2, Clock,
} from 'lucide-react';
import { formatDateFR } from '@/lib/utils';
import logoMayer from '@/assets/logo-mayer.png';

export default function ClientDashboard() {
  const { clientId, clientRecord } = useAuth();
  const { client, isLoading } = useClient(clientId);
  const { contract, isLoading: contractLoading } = useClientContract(clientId);

  if (isLoading || contractLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  const displayName = clientRecord
    ? `${clientRecord.first_name || ''} ${clientRecord.last_name || ''}`.trim()
    : 'Client';

  const equipmentCount = client?.equipments?.length || 0;
  const interventionCount = client?.interventions?.length || 0;

  return (
    <div className="space-y-3">
      {/* En-tête bienvenue */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Bonjour, {displayName}
          </h1>
          <p className="mt-1 text-gray-500">
            Bienvenue sur votre espace client Mayer Energie.
          </p>
        </div>
        <img
          src={logoMayer}
          alt="Mayer Energie"
          className="hidden lg:block h-48 w-auto object-contain mr-[8%]"
        />
      </div>

      {/* Logo + Cards résumé */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Contrat */}
        <Link
          to="/client/contrat"
          className="bg-white rounded-xl border border-gray-200 p-6 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-start justify-between">
            <div className="p-2 bg-primary-50 rounded-lg">
              <FileText className="w-5 h-5 text-primary-600" />
            </div>
            {contract?.status === 'active' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                Actif
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                <AlertCircle className="w-3 h-3" />
                {contract ? 'Inactif' : 'Aucun'}
              </span>
            )}
          </div>
          <h3 className="mt-4 font-semibold text-gray-900">Mon contrat</h3>
          <p className="mt-1 text-sm text-gray-500">
            {contract?.status === 'active'
              ? `Prochaine visite : ${contract.next_maintenance_date ? formatDateFR(contract.next_maintenance_date) : 'non planifiée'}`
              : 'Consulter les détails de votre contrat'}
          </p>
        </Link>

        {/* Equipements */}
        <Link
          to="/client/equipements"
          className="bg-white rounded-xl border border-gray-200 p-6 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-start justify-between">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Wrench className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-2xl font-bold text-gray-900">{equipmentCount}</span>
          </div>
          <h3 className="mt-4 font-semibold text-gray-900">Mes équipements</h3>
          <p className="mt-1 text-sm text-gray-500">
            {equipmentCount > 0
              ? `${equipmentCount} équipement${equipmentCount > 1 ? 's' : ''} enregistré${equipmentCount > 1 ? 's' : ''}`
              : 'Aucun équipement enregistré'}
          </p>
        </Link>

        {/* Interventions */}
        <Link
          to="/client/interventions"
          className="bg-white rounded-xl border border-gray-200 p-6 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-start justify-between">
            <div className="p-2 bg-amber-50 rounded-lg">
              <ClipboardList className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-2xl font-bold text-gray-900">{interventionCount}</span>
          </div>
          <h3 className="mt-4 font-semibold text-gray-900">Mes interventions</h3>
          <p className="mt-1 text-sm text-gray-500">
            {interventionCount > 0
              ? `${interventionCount} intervention${interventionCount > 1 ? 's' : ''}`
              : 'Aucune intervention'}
          </p>
        </Link>
      </div>

      {/* Informations personnelles */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Mes informations</h2>

        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Nom</span>
            <p className="font-medium text-gray-900">
              {client?.first_name} {client?.last_name}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Email</span>
            <p className="font-medium text-gray-900">{client?.email || '-'}</p>
          </div>
          <div>
            <span className="text-gray-500">Téléphone</span>
            <p className="font-medium text-gray-900">{client?.phone || '-'}</p>
          </div>
          <div>
            <span className="text-gray-500">Adresse</span>
            <p className="font-medium text-gray-900">
              {client?.address ? `${client.address}, ${client.postal_code} ${client.city}` : '-'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
