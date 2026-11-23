/**
 * ClientDetail.jsx - Majord'home Artisan
 * ============================================================================
 * Page fiche client détaillée accessible via /clients/:id
 * Onglets (src/lib/ficheClientOnglets.js) : Résumé | Contrat | Équipements |
 * Interventions | Devis et factures | Échanges. « Modifier » ouvre le formulaire complet
 * (TabInfo) dans un panneau latéral ; la page reste montée dessous.
 *
 * Sous-composants extraits dans ./client-detail/
 * ============================================================================
 */

import { useState, useCallback, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, AlertCircle, Archive, ArchiveRestore } from 'lucide-react';
import { CreateSAVModal } from '../components/entretiens/CreateSAVModal';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useClient, useLinkedClients } from '@hooks/useClients';
import { useTeamMembers, appointmentKeys } from '@hooks/useAppointments';
import { useCanAccess } from '@hooks/usePermissions';
import { appointmentsService } from '@services/appointments.service';
import { formatDateFR } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EventModal } from '../components/planning/EventModal';

// Sous-composants extraits
import { ClientInvestigationPanel } from '../components/clients/ClientInvestigationPanel';
import { EnTeteFicheClient } from './client-detail/EnTeteFicheClient';
import { TabResume } from './client-detail/TabResume';
import { PanneauModifierClient } from './client-detail/PanneauModifierClient';
import { TabEquipments } from './client-detail/TabEquipments';
import { TabInterventions } from './client-detail/TabInterventions';
import { TabContrat } from './client-detail/TabContrat';
import { TabDevisFactures } from './client-detail/TabDevisFactures';
import { TabEchanges } from './client-detail/TabEchanges';
import { logger } from '@lib/logger';
import { emailRefuse, EMAIL_INVALIDE_MESSAGE } from '@/lib/emailUtils';
import { ONGLETS, LIBELLE_ONGLET, ongletDeDepart } from '@/lib/ficheClientOnglets';
import { champsModifies, casseTitre } from '@/lib/clientsAffichage';

export default function ClientDetail() {
  const { id } = useParams();
  const { organization, user, effectiveRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = effectiveRole === 'org_admin';

  const [activeTab, setActiveTab] = useState(() => ongletDeDepart(location.state?.tab));
  const [modificationOuverte, setModificationOuverte] = useState(false);
  const [formData, setFormData] = useState({});
  const [initialData, setInitialData] = useState({});
  const [hasInitialized, setHasInitialized] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [appointmentModal, setAppointmentModal] = useState({ open: false });
  const [isCreatingAppointment, setIsCreatingAppointment] = useState(false);
  const [showHardDelete, setShowHardDelete] = useState(false);
  const [hardDeleteCounts, setHardDeleteCounts] = useState(null);
  const [showInvestigation, setShowInvestigation] = useState(false);
  const [equipmentDraft, setEquipmentDraft] = useState(null);

  const { can } = useCanAccess();
  const canCreateAppointment = can('planning', 'create');
  // Ouvrir une demande SAV sans repasser par le kanban (Eric 2026-11-11)
  const canCreateSAV = can('sav', 'create');
  const [savOpen, setSavOpen] = useState(false);
  const queryClient = useQueryClient();

  const {
    client, isLoading, error, updateClient, isUpdating,
    archiveClient, isArchiving, unarchiveClient, isUnarchiving, refresh,
    hardDeleteClient, isHardDeleting,
  } = useClient(id);

  const { members } = useTeamMembers(organization?.id);

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

  // Le n° DPE est aussi écrit côté serveur (rattachement MonsieurDPE, cf. ClientLogementDpe) : le formulaire,
  // initialisé une seule fois, doit suivre. Sans ça, un enregistrement de la fiche renverrait l'ANCIEN numéro et
  // détacherait le DPE en silence. Une saisie en cours (numéro modifié par l'utilisateur) n'est pas écrasée.
  const savedDpeNumber = client?.dpe_number || '';
  useEffect(() => {
    if (!hasInitialized) return;
    setInitialData((prev) => (prev && prev.dpeNumber !== savedDpeNumber ? { ...prev, dpeNumber: savedDpeNumber } : prev));
    setFormData((prev) => {
      if (!prev || prev.dpeNumber === savedDpeNumber) return prev;
      const enCoursDeSaisie = modificationOuverte && prev.dpeNumber !== (initialData?.dpeNumber ?? '');
      return enCoursDeSaisie ? prev : { ...prev, dpeNumber: savedDpeNumber };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne réagit qu'au numéro enregistré
  }, [savedDpeNumber, hasInitialized]);

  // Quitter le panneau sans enregistrer : la saisie revient à la fiche enregistrée.
  const handleAbandonModification = useCallback(() => {
    setFormData({ ...initialData });
    setModificationOuverte(false);
  }, [initialData]);

  // Pré-remplissage depuis l'investigation bâtiment. On ouvre le panneau au lieu
  // d'enregistrer : la donnée DPE peut être fausse ou porter sur un autre
  // logement du même immeuble, elle passe donc par une relecture humaine.
  const handleApplyInvestigation = useCallback((patch) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    setModificationOuverte(true);
    setShowInvestigation(false);
    toast.success('Champs pré-remplis depuis le DPE — vérifiez puis Enregistrer');
  }, []);

  // Équipement repéré dans le DPE : on bascule sur l'onglet Équipements, qui
  // ouvre sa modale d'ajout pré-remplie. Atterrir sur la liste plutôt que dans
  // un panneau permet de voir tout de suite ce qui est déjà recensé — et évite
  // de dupliquer ici la création d'équipement.
  const handleCreateEquipmentFromDpe = useCallback((draft) => {
    setShowInvestigation(false);
    setActiveTab('equipements');
    setEquipmentDraft(draft);
  }, []);

  // Rend true si la fiche est enregistrée (le panneau ne se ferme qu'alors).
  const handleSave = async () => {
    if (!formData.lastName?.trim()) {
      toast.error('Le nom est requis');
      return false;
    }
    if (emailRefuse(formData.email, initialData?.email)) {
      toast.error(EMAIL_INVALIDE_MESSAGE);
      return false;
    }

    try {
      await updateClient({
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
    } catch (err) {
      logger.error('[ClientDetail] Erreur sauvegarde:', err);
      toast.error('Erreur lors de la sauvegarde');
      return false;
    }

    setInitialData({ ...formData });
    toast.success('Client mis à jour');
    return true;
  };

  const handleArchive = async () => {
    try {
      await archiveClient();
      toast.success('Client archivé');
      setShowArchiveConfirm(false);
      navigate('/clients');
    } catch (err) {
      logger.error('[ClientDetail] Erreur archivage:', err);
      toast.error("Erreur lors de l'archivage");
    }
  };

  const handleCreateAppointment = async (formDataRdv) => {
    try {
      setIsCreatingAppointment(true);
      const { error: err } = await appointmentsService.createAppointment({
        coreOrgId: organization?.id,
        ...formDataRdv,
      });
      if (err) {
        toast.error('Erreur lors de la création du RDV');
        return false;
      }
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists(organization?.id) });
      toast.success('RDV créé avec succès');
      setAppointmentModal({ open: false });
      return true;
    } catch {
      toast.error('Une erreur est survenue');
      return false;
    } finally {
      setIsCreatingAppointment(false);
    }
  };

  const handleUnarchive = async () => {
    try {
      await unarchiveClient();
      toast.success('Client désarchivé');
      refresh();
    } catch (err) {
      logger.error('[ClientDetail] Erreur désarchivage:', err);
      toast.error('Erreur lors du désarchivage');
    }
  };

  // ===== HARD DELETE (org_admin only) — god mode, nettoyage de base =====

  // Pré-compte ce qui sera détruit pour l'afficher dans la confirmation.
  const handleOpenHardDelete = async () => {
    setShowHardDelete(true);
    setHardDeleteCounts(null);
    try {
      const [contractsRes, intervRes, certifRes, apptRes, mailRes, smsRes] = await Promise.all([
        supabase.from('majordhome_contracts').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('majordhome_interventions').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('majordhome_certificats').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('majordhome_appointments').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('majordhome_mailing_logs').select('id', { count: 'exact', head: true }).eq('client_id', id),
        supabase.from('majordhome_sms_logs').select('id', { count: 'exact', head: true }).eq('client_id', id),
      ]);
      setHardDeleteCounts({
        contracts: contractsRes.count ?? 0,
        interventions: intervRes.count ?? 0,
        certificats: certifRes.count ?? 0,
        appointments: apptRes.count ?? 0,
        mailings: mailRes.count ?? 0,
        sms: smsRes.count ?? 0,
      });
    } catch (err) {
      logger.warn('[ClientDetail] hard delete preflight count error:', err);
      setHardDeleteCounts({ contracts: null, interventions: null, certificats: null, appointments: null, mailings: null, sms: null });
    }
  };

  const handleConfirmHardDelete = async () => {
    try {
      await hardDeleteClient();
      toast.success('Client supprimé définitivement');
      setShowHardDelete(false);
      setHardDeleteCounts(null);
      navigate('/clients');
    } catch (err) {
      logger.error('[ClientDetail] hard delete error:', err);
      const code = err?.message || '';
      const msg = code.includes('org_admin_required') || code.includes('not_member_of_org')
        ? 'Action réservée aux administrateurs'
        : code.includes('client_not_found')
        ? 'Client introuvable'
        : 'Erreur lors de la suppression';
      toast.error(msg);
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

      <EnTeteFicheClient
        client={client}
        displayName={displayName}
        isOwner={isOwner}
        isTenant={isTenant}
        isArchived={isArchived}
        isAdmin={isAdmin}
        canCreateAppointment={canCreateAppointment}
        canCreateSAV={canCreateSAV}
        isHardDeleting={isHardDeleting}
        onNouveauRdv={() => setAppointmentModal({ open: true })}
        onNouveauSav={() => setSavOpen(true)}
        onArchiver={() => setShowArchiveConfirm(true)}
        onSupprimer={handleOpenHardDelete}
        onModifier={() => setModificationOuverte(true)}
      />

      {/* Onglets */}
      <div className="overflow-x-auto border-b border-secondary-200">
        <nav className="flex gap-1" aria-label="Onglets de la fiche client">
          {ONGLETS.map((onglet) => {
            const isActive = activeTab === onglet;
            const badge = onglet === 'equipements' ? client.equipments_count
              : onglet === 'interventions' ? client.interventions_count
                : 0;
            return (
              <button
                key={onglet}
                type="button"
                onClick={() => setActiveTab(onglet)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-body-sm transition-colors focus-visible:outline-none focus-visible:shadow-ring ${
                  isActive ? 'border-primary-600 font-semibold text-secondary-900' : 'border-transparent font-medium text-secondary-500 hover:text-secondary-700'
                }`}
              >
                {LIBELLE_ONGLET[onglet]}
                {badge > 0 && <span className="rounded-full bg-secondary-100 px-1.5 py-0.5 text-caption text-secondary-600">{badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Contenu des onglets. Résumé, Devis et factures, Échanges posent leurs propres cartes.
          Le Résumé reste monté pendant la modification (le bloc DPE ne rejoue pas son rattachement). */}
      {activeTab === 'resume' && (
        <TabResume
          client={client}
          owner={owner}
          tenants={tenants}
          members={members}
          formHousingType={formData.housingType}
          formSurface={formData.surface}
          onApplyDpe={handleApplyInvestigation}
          onCreateEquipment={handleCreateEquipmentFromDpe}
          onInvestigate={() => setShowInvestigation(true)}
          onOuvrirOnglet={setActiveTab}
        />
      )}
      {activeTab === 'devis-factures' && <TabDevisFactures client={client} clientId={id} orgId={organization?.id} />}
      {activeTab === 'echanges' && <TabEchanges clientId={id} projectId={client.project_id} />}
      {['contrat', 'equipements', 'interventions'].includes(activeTab) && (
        <div className="bg-white rounded-lg border border-secondary-200 shadow-card p-6">
          {activeTab === 'contrat' && <TabContrat clientId={id} orgId={organization?.id} userId={user?.id} client={client} />}
          {activeTab === 'equipements' && (
            <TabEquipments
              clientId={id}
              client={isArchived ? null : client}
              prefillDraft={equipmentDraft}
              onPrefillConsumed={() => setEquipmentDraft(null)}
            />
          )}
          {activeTab === 'interventions' && <TabInterventions projectId={client.project_id} clientId={id} />}
        </div>
      )}

      <PanneauModifierClient
        ouvert={modificationOuverte} nom={casseTitre(displayName)} isUpdating={isUpdating}
        modifie={champsModifies(initialData, formData).length > 0}
        onEnregistrer={async () => { if (await handleSave()) setModificationOuverte(false); }}
        onAbandonner={handleAbandonModification}
        formData={formData} setFormData={setFormData} clientId={id} orgId={organization?.id} client={client}
      />

      {/* Investigation bâtiment — panneau latéral, lecture seule. « Renseigner la fiche » ne fait
          que PRÉ-REMPLIR le formulaire : rien n'est écrit en base sans un Enregistrer explicite. */}
      <ClientInvestigationPanel
        client={client}
        isOpen={showInvestigation}
        onClose={() => setShowInvestigation(false)}
      />

      {/* Modale création RDV (pré-remplie avec les infos du client) */}
      <EventModal
        isOpen={appointmentModal.open}
        mode="create"
        appointment={null}
        defaultDate={null}
        defaultTime={null}
        prefillClient={client}
        members={members}
        orgId={organization?.id}
        userId={user?.id}
        onClose={() => setAppointmentModal({ open: false })}
        onSave={handleCreateAppointment}
        onDelete={() => {}}
        onCancel={() => {}}
        isSaving={isCreatingAppointment}
      />

      {/* Modale création SAV (client pré-rempli ; contrat actif repris par la modale) */}
      {canCreateSAV && (
        <CreateSAVModal
          isOpen={savOpen}
          onClose={() => setSavOpen(false)}
          prefillClient={client}
        />
      )}

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
              Vous pourrez le retrouver en activant le filtre &quot;Clients archivés&quot;.
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

      {/* Hard delete — org_admin god mode (nettoyage de base, irréversible) */}
      <ConfirmDialog
        open={showHardDelete}
        onOpenChange={(open) => {
          setShowHardDelete(open);
          if (!open) setHardDeleteCounts(null);
        }}
        title="Supprimer définitivement ce client ?"
        description="Cette action est irréversible. Le client et ses données rattachées seront purgés de la base."
        confirmLabel={isHardDeleting ? 'Suppression…' : 'Supprimer définitivement'}
        cancelLabel="Annuler"
        variant="destructive"
        loading={isHardDeleting}
        onConfirm={handleConfirmHardDelete}
      >
        <div className="mt-4 rounded-lg border border-red-100 bg-red-50/60 p-3 text-sm text-secondary-700">
          <p className="font-medium text-red-700 mb-2">
            Données de <strong>{displayName}</strong> qui seront supprimées :
          </p>
          {hardDeleteCounts === null ? (
            <p className="text-secondary-500 italic">Calcul en cours…</p>
          ) : (
            <ul className="space-y-1 list-disc list-inside text-xs">
              <li>
                <span className="font-medium">{hardDeleteCounts.contracts ?? '?'}</span>{' '}
                contrat{(hardDeleteCounts.contracts || 0) > 1 ? 's' : ''}
              </li>
              <li>
                <span className="font-medium">{hardDeleteCounts.interventions ?? '?'}</span>{' '}
                intervention{(hardDeleteCounts.interventions || 0) > 1 ? 's' : ''} (entretiens / SAV)
              </li>
              <li>
                <span className="font-medium">{hardDeleteCounts.certificats ?? '?'}</span>{' '}
                certificat{(hardDeleteCounts.certificats || 0) > 1 ? 's' : ''}
              </li>
              <li>
                <span className="font-medium">{hardDeleteCounts.appointments ?? '?'}</span>{' '}
                RDV planning
              </li>
              <li>
                <span className="font-medium">{hardDeleteCounts.mailings ?? '?'}</span>{' '}
                log{(hardDeleteCounts.mailings || 0) > 1 ? 's' : ''} mailing
              </li>
              <li>
                <span className="font-medium">{hardDeleteCounts.sms ?? '?'}</span>{' '}
                SMS
              </li>
            </ul>
          )}
          <p className="mt-2 text-xs text-secondary-500">
            Les fiches liées (locataire / propriétaire, filleuls) et les leads pipeline rattachés seront détachés, pas supprimés.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
