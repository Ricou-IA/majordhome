/**
 * ClientDetail.jsx - Majord'home Artisan
 * ============================================================================
 * Page fiche client détaillée accessible via /clients/:id
 * Onglets : Informations | Contrat | Équipements | Interventions | Timeline
 *
 * Sous-composants extraits dans ./client-detail/
 * ============================================================================
 */

import { useState, useCallback } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft, User, FileText, Wrench, History, Mail, MessageSquare,
  Save, Loader2, AlertCircle, Lock, Unlock, Clock,
  Archive, ArchiveRestore,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient, useLinkedClients } from '@hooks/useClients';
import { formatDateFR } from '@/lib/utils';

// Sous-composants extraits
import { InviteClientButton } from '../components/clients/InviteClientButton';
import { ClientCategoryBadge } from './client-detail/ClientCategoryBadge';
import { TabInfo } from './client-detail/TabInfo';
import { TabEquipments } from './client-detail/TabEquipments';
import { TabInterventions } from './client-detail/TabInterventions';
import { TabTimeline } from './client-detail/TabTimeline';
import { TabContrat } from './client-detail/TabContrat';
import { TabMailings } from './client-detail/TabMailings';
import { TabSms } from './client-detail/TabSms';

const TABS = [
  { id: 'info', label: 'Informations', icon: User },
  { id: 'contract', label: 'Contrat', icon: FileText },
  { id: 'equipments', label: 'Équipements', icon: Wrench },
  { id: 'interventions', label: 'Interventions', icon: Wrench },
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'mailings', label: 'Mailings', icon: Mail },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
];

export default function ClientDetail() {
  const { id } = useParams();
  const { organization, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTab, setActiveTab] = useState(location.state?.tab || 'info');
  const [isLocked, setIsLocked] = useState(true);
  const [formData, setFormData] = useState({});
  const [initialData, setInitialData] = useState({});
  const [hasInitialized, setHasInitialized] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const {
    client, isLoading, error, updateClient, isUpdating,
    archiveClient, isArchiving, unarchiveClient, isUnarchiving, refresh,
  } = useClient(id);

  const { owner, tenants } = useLinkedClients(id, organization?.id);
  const isOwner = tenants.length > 0;
  const isTenant = !!owner;

  // Initialiser le formulaire quand le client est chargé
  if (client && !hasInitialized) {
    const data = {
      firstName: (client.first_name || '').toUpperCase(),
      lastName: (client.last_name || '').toUpperCase(),
      clientCategory: client.client_category || 'particulier',
      companyName: client.company_name || '',
      phone: client.phone || '',
      phoneSecondary: client.phone_secondary || '',
      email: client.email || '',
      mailOptin: client.mail_optin !== false,
      smsOptin: client.sms_optin !== false,
      address: client.address || '',
      addressComplement: client.address_complement || '',
      postalCode: client.postal_code || '',
      city: client.city || '',
      accessInstructions: client.access_instructions || '',
      housingType: client.housing_type || '',
      surface: client.surface || '',
      dpeNumber: client.dpe_number || '',
      leadSource: client.lead_source || '',
      notes: client.notes || '',
      internalNotes: client.internal_notes || '',
    };
    setFormData(data);
    setInitialData(data);
    setHasInitialized(true);
  }

  const handleToggleLock = useCallback(() => {
    if (!isLocked) {
      setFormData({ ...initialData });
    }
    setIsLocked(!isLocked);
  }, [isLocked, initialData]);

  const handleSave = async () => {
    if (!formData.lastName?.trim()) {
      toast.error('Le nom est requis');
      return;
    }

    const { data, error: err } = await updateClient({
      firstName: formData.firstName,
      lastName: formData.lastName,
      clientCategory: formData.clientCategory,
      companyName: formData.companyName,
      phone: formData.phone,
      phoneSecondary: formData.phoneSecondary,
      email: formData.email,
      mailOptin: formData.mailOptin,
      smsOptin: formData.smsOptin,
      address: formData.address,
      addressComplement: formData.addressComplement,
      postalCode: formData.postalCode,
      city: formData.city,
      accessInstructions: formData.accessInstructions,
      housingType: formData.housingType,
      surface: formData.surface,
      dpeNumber: formData.dpeNumber,
      leadSource: formData.leadSource,
      notes: formData.notes,
      internalNotes: formData.internalNotes,
    });

    if (err) {
      toast.error('Erreur lors de la sauvegarde');
      return;
    }

    setInitialData({ ...formData });
    setIsLocked(true);
    toast.success('Client mis à jour');
  };

  const handleArchive = async () => {
    const result = await archiveClient();
    if (result?.data && !result?.error) {
      toast.success('Client archivé');
      setShowArchiveConfirm(false);
      navigate('/clients');
    } else {
      toast.error("Erreur lors de l'archivage");
    }
  };

  const handleUnarchive = async () => {
    const result = await unarchiveClient();
    if (result?.data && !result?.error) {
      toast.success('Client désarchivé');
      refresh();
    } else {
      toast.error('Erreur lors de la désarchivage');
    }
  };

  // État de chargement
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto" />
          <p className="mt-3 text-sm text-secondary-500">Chargement du client...</p>
        </div>
      </div>
    );
  }

  // État erreur
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
          <p className="mt-4 text-lg font-medium text-secondary-700">Erreur</p>
          <p className="mt-1 text-sm text-secondary-500">{error?.message || 'Client introuvable'}</p>
          <Link to="/clients" className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg">
            <ArrowLeft className="w-4 h-4" />
            Retour à la liste
          </Link>
        </div>
      </div>
    );
  }

  if (!client) return null;

  const displayName = client.display_name || `${client.last_name || ''} ${client.first_name || ''}`.trim() || 'Client';
  const isArchived = client.is_archived === true;

  return (
    <div className="space-y-6">
      {/* Bannière client archivé */}
      {isArchived && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 text-amber-800">
            <Archive className="w-5 h-5" />
            <span className="text-sm font-medium">
              Ce client est archivé{client.archived_at ? ` depuis le ${formatDateFR(client.archived_at)}` : ''}
            </span>
          </div>
          <button
            onClick={handleUnarchive}
            disabled={isUnarchiving}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50"
          >
            {isUnarchiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArchiveRestore className="w-4 h-4" />}
            Désarchiver
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/clients" className="p-2 rounded-lg hover:bg-secondary-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-secondary-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-secondary-900">{displayName}</h1>
              <ClientCategoryBadge clientCategory={client.client_category} />
              {isOwner && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 border border-blue-200">Propriétaire</span>
              )}
              {isTenant && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700 border border-orange-200">Locataire</span>
              )}
              {client.has_active_contract && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 border border-green-200">Contrat actif</span>
              )}
            </div>
            <p className="text-secondary-500 mt-0.5">
              {client.client_number && (
                <span className="text-xs font-mono text-secondary-400 mr-2">{client.client_number}</span>
              )}
              {[client.city, client.postal_code].filter(Boolean).join(' ')}
              {client.email && ` • ${client.email}`}
              {client.updated_at && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-secondary-400">
                  <Clock className="w-3 h-3" />
                  MàJ {formatDateFR(client.updated_at)}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Portail client */}
          <InviteClientButton client={client} />

          {!isArchived && isLocked && (
            <button
              onClick={() => setShowArchiveConfirm(true)}
              className="p-2 rounded-lg text-secondary-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
              title="Archiver ce client"
            >
              <Archive className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={handleToggleLock}
            className={`p-2 rounded-lg transition-colors ${
              isLocked ? 'text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100' : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
            }`}
            title={isLocked ? 'Déverrouiller pour modifier' : 'Annuler les modifications'}
          >
            {isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
          </button>

          {!isLocked && (
            <button
              onClick={handleSave}
              disabled={isUpdating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Enregistrer
            </button>
          )}
        </div>
      </div>

      {/* Onglets */}
      <div className="border-b border-secondary-200">
        <nav className="flex gap-0">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            let badge = null;

            if (tab.id === 'equipments' && client.equipments_count > 0) {
              badge = client.equipments_count;
            } else if (tab.id === 'interventions' && client.interventions_count > 0) {
              badge = client.interventions_count;
            }

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive ? 'text-primary-600 border-primary-600' : 'text-secondary-500 border-transparent hover:text-secondary-700 hover:border-secondary-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {badge > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs bg-secondary-100 text-secondary-600 rounded-full">{badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Contenu des onglets */}
      <div className="bg-white rounded-lg border border-secondary-200 shadow-card p-6">
        {activeTab === 'info' && <TabInfo formData={formData} setFormData={setFormData} isLocked={isLocked} clientId={id} orgId={organization?.id} />}
        {activeTab === 'contract' && <TabContrat clientId={id} orgId={organization?.id} userId={user?.id} client={client} />}
        {activeTab === 'equipments' && <TabEquipments clientId={id} />}
        {activeTab === 'interventions' && <TabInterventions projectId={client.project_id} clientId={id} />}
        {activeTab === 'timeline' && <TabTimeline clientId={id} orgId={organization?.id} userId={user?.id} />}
        {activeTab === 'mailings' && <TabMailings clientId={id} />}
        {activeTab === 'sms' && <TabSms clientId={id} />}
      </div>

      {/* Modale confirmation archivage */}
      {showArchiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowArchiveConfirm(false)} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Archive className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-secondary-900">Archiver ce client ?</h3>
            </div>
            <p className="text-sm text-secondary-600 mb-6">
              Le client <strong>{displayName}</strong> sera archivé et ne sera plus visible dans la liste principale.
              Vous pourrez le retrouver en activant le filtre "Clients archivés".
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowArchiveConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-secondary-700 bg-secondary-100 hover:bg-secondary-200 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleArchive}
                disabled={isArchiving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {isArchiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                Archiver
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
