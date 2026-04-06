/**
 * EntretienSAVKanban.jsx - Majord'home Artisan
 * ============================================================================
 * Board kanban unifié Entretien & SAV avec drag & drop.
 * Utilise le composant générique KanbanBoard.
 *
 * @version 3.0.0 - Refactoring KanbanBoard
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useEntretienSAV, useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { KANBAN_COLUMNS, getTransitions } from '@services/sav.service';
import { appointmentsService } from '@services/appointments.service';
import { KanbanBoard } from '@/apps/artisan/components/shared/KanbanBoard';
import { EntretienSAVCard } from './EntretienSAVCard';
import { EntretienSAVModal } from './EntretienSAVModal';
import { CreateSAVModal } from './CreateSAVModal';
import { ClientModal } from '../clients/ClientModal';
import { SAVQuoteModal } from './SAVQuoteModal';
import { AcceptQuoteModal } from './AcceptQuoteModal';
import { SchedulingTransitionModal } from './SchedulingTransitionModal';
// CertificatsEntretienModal retiré — section certificats intégrée dans EntretienSAVModal

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const TECHNICIEN_STATUSES = ['planifie', 'realise'];

export function EntretienSAVKanban() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { can, effectiveRole } = useCanAccess();

  const { items, isLoading, refresh } = useEntretienSAV(orgId);
  const { updateWorkflowStatus, updateFields } = useEntretienSAVMutations();

  // --- State ---
  const [selectedItem, setSelectedItem] = useState(null);
  const [createSAVOpen, setCreateSAVOpen] = useState(false);
  const [createSAVPrefill, setCreateSAVPrefill] = useState(null);
  const [clientModalId, setClientModalId] = useState(null);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [transitionLoading, setTransitionLoading] = useState(false);

  const canCreateSAV = can('sav', 'create');

  // Colonnes visibles selon le rôle
  const visibleColumns = useMemo(() => {
    const cols = effectiveRole === 'technicien'
      ? KANBAN_COLUMNS.filter(c => TECHNICIEN_STATUSES.includes(c.value))
      : KANBAN_COLUMNS;
    return cols.map(c => ({ id: c.value, label: c.label, color: c.color }));
  }, [effectiveRole]);

  // Filtrer par rôle avant de passer au KanbanBoard
  const roleFilteredItems = useMemo(() => {
    let result = items;
    if (effectiveRole === 'technicien') {
      result = result.filter(i => TECHNICIEN_STATUSES.includes(i.workflow_status));
    }
    if (effectiveRole === 'commercial' && user?.id) {
      result = result.filter(i => i.created_by === user.id || i.technician_id === user.id);
    }
    return result;
  }, [items, effectiveRole, user?.id]);

  // =========================================================================
  // SEARCH FILTER
  // =========================================================================

  const searchFilter = useCallback((item, query) => {
    const term = query.toLowerCase();
    const fields = [
      item.client_name, item.client_first_name, item.client_last_name,
      item.client_postal_code, item.client_city, item.contract_number, item.sav_description,
    ];
    return fields.some(f => f && f.toLowerCase().includes(term));
  }, []);

  // =========================================================================
  // HANDLERS — CLICK
  // =========================================================================

  const handleCreateSAVFromEntretien = useCallback(({ client, contractId }) => {
    setSelectedItem(null);
    setCreateSAVPrefill({ client, contractId, origin: 'entretien' });
    setCreateSAVOpen(true);
  }, []);

  const handleOpenClient = useCallback((clientId) => {
    setSelectedItem(null);
    setClientModalId(clientId);
  }, []);

  // =========================================================================
  // HANDLERS — DRAG & DROP
  // =========================================================================

  const handleDragEnd = useCallback((result) => {
    const { draggableId, source, destination } = result;
    if (!destination || source.droppableId === destination.droppableId) return;

    const oldStatus = source.droppableId;
    const newStatus = destination.droppableId;
    const item = roleFilteredItems.find(i => i.id === draggableId);
    if (!item) return;

    // Vérifier transition autorisée
    const allowed = getTransitions(item.intervention_type, oldStatus);
    if (!allowed.includes(newStatus)) {
      toast.error('Transition non autorisée');
      return;
    }

    // Bloquer drag planifié → réalisé pour les entretiens (certificat obligatoire)
    if (item.intervention_type === 'entretien' && newStatus === 'realise') {
      toast.error('Veuillez remplir le certificat d\'entretien pour passer en réalisé');
      return;
    }

    // Dispatcher selon la transition cible
    if (newStatus === 'devis_envoye' && oldStatus === 'demande') {
      setPendingTransition({ item, oldStatus, newStatus, type: 'quote' });
    } else if (newStatus === 'pieces_commandees' && oldStatus === 'devis_envoye') {
      setPendingTransition({ item, oldStatus, newStatus, type: 'accept' });
    } else if (newStatus === 'planifie') {
      setPendingTransition({ item, oldStatus, newStatus, type: 'schedule' });
    } else {
      handleDirectTransition(item, newStatus);
    }
  }, [roleFilteredItems]);

  const handleDirectTransition = useCallback(async (item, newStatus) => {
    try {
      await updateWorkflowStatus(item.id, newStatus);
      toast.success('Statut mis à jour');
      refresh();
    } catch {
      toast.error('Erreur de transition');
    }
  }, [updateWorkflowStatus, refresh]);

  const handleCancelTransition = useCallback(() => {
    setPendingTransition(null);
  }, []);

  // =========================================================================
  // HANDLERS — MODALES DE TRANSITION
  // =========================================================================

  const handleConfirmQuote = useCallback(async ({ amount, date }) => {
    if (!pendingTransition) return;
    setTransitionLoading(true);
    try {
      const fields = { devis_status: 'envoye' };
      if (amount) fields.devis_amount = amount;
      await updateFields(pendingTransition.item.id, fields);
      await updateWorkflowStatus(pendingTransition.item.id, 'devis_envoye');
      toast.success('Devis envoyé');
      setPendingTransition(null);
      refresh();
    } catch {
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setTransitionLoading(false);
    }
  }, [pendingTransition, updateFields, updateWorkflowStatus, refresh]);

  const handleConfirmAcceptQuote = useCallback(async ({ date }) => {
    if (!pendingTransition) return;
    setTransitionLoading(true);
    try {
      await updateFields(pendingTransition.item.id, { devis_status: 'accepte' });
      await updateWorkflowStatus(pendingTransition.item.id, 'pieces_commandees');
      toast.success('Devis accepté — pièces à commander');
      setPendingTransition(null);
      refresh();
    } catch {
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setTransitionLoading(false);
    }
  }, [pendingTransition, updateFields, updateWorkflowStatus, refresh]);

  const handleConfirmSchedule = useCallback(async (schedulingData, includesEntretien) => {
    if (!pendingTransition) return;
    const item = pendingTransition.item;

    try {
      const { error: appointmentError } = await appointmentsService.createAppointment({
        coreOrgId: orgId,
        technicianIds: schedulingData.technicianIds || [],
        appointment_type: schedulingData.appointmentType,
        subject: schedulingData.subject,
        scheduled_date: schedulingData.date,
        scheduled_start: schedulingData.startTime,
        scheduled_end: schedulingData.endTime,
        duration_minutes: schedulingData.duration,
        client_name: item.client_last_name || item.client_name || 'Sans nom',
        client_first_name: item.client_first_name || null,
        client_phone: item.client_phone || '',
        client_email: item.client_email || null,
        address: item.client_address || null,
        city: item.client_city || null,
        postal_code: item.client_postal_code || null,
        client_id: item.client_id || null,
        status: 'scheduled',
        priority: 'normal',
        internal_notes: schedulingData.notes || null,
      });

      if (appointmentError) {
        toast.error('Erreur création du RDV');
        return;
      }

      const fields = { scheduled_date: schedulingData.date };
      if (item.intervention_type === 'sav' && includesEntretien !== (item.includes_entretien || false)) {
        fields.includes_entretien = includesEntretien;
      }
      await updateFields(item.id, fields);
      await updateWorkflowStatus(item.id, 'planifie');

      if (item.client_id && item.tags?.includes('Web')) {
        const { clientsService } = await import('@services/clients.service');
        await clientsService.confirmWebDraft(item.client_id);
      }

      toast.success('RDV planifié avec succès');
      setPendingTransition(null);
      refresh();
    } catch {
      toast.error('Erreur lors de la planification');
    }
  }, [pendingTransition, orgId, updateFields, updateWorkflowStatus, refresh]);

  // =========================================================================
  // RENDER
  // =========================================================================

  const renderCard = useCallback((item) => (
    <EntretienSAVCard item={item} onClick={setSelectedItem} onRefresh={refresh} />
  ), [refresh]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const pendingClientName = pendingTransition
    ? (pendingTransition.item.client_name || `${pendingTransition.item.client_last_name || ''} ${pendingTransition.item.client_first_name || ''}`.trim() || '')
    : '';

  return (
    <KanbanBoard
      items={roleFilteredItems}
      columns={visibleColumns}
      groupBy="workflow_status"
      renderCard={renderCard}
      onCardClick={setSelectedItem}
      onDragEnd={handleDragEnd}
      searchPlaceholder="Rechercher..."
      searchFilter={searchFilter}
      emptyMessage="Aucun élément"
      headerRight={
        <>
          {canCreateSAV && (
            <button
              onClick={() => { setCreateSAVPrefill(null); setCreateSAVOpen(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
            >
              <Wrench className="h-4 w-4" />
              Nouveau SAV
            </button>
          )}
          <button
            onClick={refresh}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </>
      }
    >
      {/* Modale détail */}
      {selectedItem && (
        <EntretienSAVModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdated={refresh}
          onCreateSAV={handleCreateSAVFromEntretien}
          onOpenClient={handleOpenClient}
        />
      )}

      {/* Modale fiche client */}
      <ClientModal
        clientId={clientModalId}
        isOpen={!!clientModalId}
        onClose={() => setClientModalId(null)}
      />

      {/* Modale création SAV */}
      <CreateSAVModal
        isOpen={createSAVOpen}
        onClose={() => { setCreateSAVOpen(false); setCreateSAVPrefill(null); }}
        onCreated={refresh}
        prefillClient={createSAVPrefill?.client || null}
        prefillContractId={createSAVPrefill?.contractId || null}
        savOrigin={createSAVPrefill?.origin || 'appel_client'}
      />

      {/* Modales de transition (drag & drop) */}
      <SAVQuoteModal
        isOpen={pendingTransition?.type === 'quote'}
        onClose={handleCancelTransition}
        onConfirm={handleConfirmQuote}
        loading={transitionLoading}
        clientName={pendingClientName}
      />
      <AcceptQuoteModal
        isOpen={pendingTransition?.type === 'accept'}
        onClose={handleCancelTransition}
        onConfirm={handleConfirmAcceptQuote}
        loading={transitionLoading}
        clientName={pendingClientName}
        devisAmount={pendingTransition?.item?.devis_amount || null}
      />
      {pendingTransition?.type === 'schedule' && (
        <SchedulingTransitionModal
          item={pendingTransition.item}
          orgId={orgId}
          onConfirm={handleConfirmSchedule}
          onCancel={handleCancelTransition}
        />
      )}
    </KanbanBoard>
  );
}

export default EntretienSAVKanban;
