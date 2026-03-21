/**
 * EntretienSAVKanban.jsx - Majord'home Artisan
 * ============================================================================
 * Board kanban unifié Entretien & SAV avec drag & drop.
 *
 * Features :
 * - Colonnes par workflow_status, filtrage rôle + recherche texte
 * - Drag & drop entre colonnes (@hello-pangea/dnd, pattern LeadKanban)
 * - Modales contextuelles au drop :
 *   • demande → devis_envoye : SAVQuoteModal (montant + date)
 *   • devis_envoye → pieces_commandees : AcceptQuoteModal (date)
 *   • * → planifie : SchedulingTransitionModal (planning + toggle entretien)
 * - Validation transitions (getTransitions) avant le drop
 * - Modal item sur click carte
 *
 * @version 2.0.0 - Sprint 8 Entretien & SAV — Drag & Drop
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Loader2, RefreshCw, Search, X, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useEntretienSAV, useEntretienSAVMutations } from '@hooks/useEntretienSAV';
import { KANBAN_COLUMNS, getTransitions } from '@services/sav.service';
import { appointmentsService } from '@services/appointments.service';
import { EntretienSAVCard } from './EntretienSAVCard';
import { EntretienSAVModal } from './EntretienSAVModal';
import { CreateSAVModal } from './CreateSAVModal';
import { ClientModal } from '../clients/ClientModal';
import { SAVQuoteModal } from './SAVQuoteModal';
import { AcceptQuoteModal } from './AcceptQuoteModal';
import { SchedulingTransitionModal } from './SchedulingTransitionModal';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

function KanbanColumn({ column, items, onItemClick, provided, isDraggingOver }) {
  const count = items.length;

  return (
    <div
      className={`flex flex-col bg-gray-50 rounded-xl min-w-0 flex-1 basis-0 border transition-colors ${
        isDraggingOver ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'
      }`}
    >
      {/* Header colonne */}
      <div className="px-3 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: column.color }}
            />
            <h3 className="font-semibold text-sm text-gray-800 truncate">
              {column.label}
            </h3>
          </div>
          <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
      </div>

      {/* Liste cartes (zone de drop) */}
      <div
        ref={provided.innerRef}
        {...provided.droppableProps}
        className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] max-h-[calc(100vh-320px)]"
      >
        {items.map((item, index) => (
          <Draggable key={item.id} draggableId={item.id} index={index}>
            {(dragProvided, snapshot) => (
              <div
                ref={dragProvided.innerRef}
                {...dragProvided.draggableProps}
                {...dragProvided.dragHandleProps}
                className={snapshot.isDragging ? 'opacity-90 rotate-1 shadow-lg' : ''}
              >
                <EntretienSAVCard
                  item={item}
                  onClick={onItemClick}
                />
              </div>
            )}
          </Draggable>
        ))}

        {provided.placeholder}

        {count === 0 && (
          <p className="text-xs text-gray-400 text-center py-6 italic">
            Aucun élément
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function EntretienSAVKanban() {
  const { organization, user } = useAuth();
  const orgId = organization?.id;
  const { can, effectiveRole } = useCanAccess();

  const { items, isLoading, refresh } = useEntretienSAV(orgId);
  const {
    updateWorkflowStatus,
    updateFields,
  } = useEntretienSAVMutations();

  // --- State principal ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [createSAVOpen, setCreateSAVOpen] = useState(false);
  const [createSAVPrefill, setCreateSAVPrefill] = useState(null);
  const [clientModalId, setClientModalId] = useState(null);

  // --- State drag & drop transitions ---
  const [pendingTransition, setPendingTransition] = useState(null);
  // null | { item, oldStatus, newStatus, type: 'quote'|'accept'|'schedule' }
  const [transitionLoading, setTransitionLoading] = useState(false);

  const canCreateSAV = can('sav', 'create');

  // Technicien : voit seulement planifié + réalisé
  const TECHNICIEN_STATUSES = ['planifie', 'realise'];

  // Colonnes visibles selon le rôle
  const visibleColumns = useMemo(() => {
    if (effectiveRole === 'technicien') {
      return KANBAN_COLUMNS.filter(c => TECHNICIEN_STATUSES.includes(c.value));
    }
    return KANBAN_COLUMNS;
  }, [effectiveRole]);

  // Filtrer côté client : scope par rôle + recherche texte
  const filteredItems = useMemo(() => {
    let result = items;

    if (effectiveRole === 'technicien') {
      result = result.filter(i => TECHNICIEN_STATUSES.includes(i.workflow_status));
    }

    if (effectiveRole === 'commercial' && user?.id) {
      result = result.filter(i => i.created_by === user.id || i.technician_id === user.id);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      result = result.filter(i => {
        const fields = [
          i.client_name, i.client_first_name, i.client_last_name,
          i.client_postal_code, i.client_city, i.contract_number, i.sav_description,
        ];
        return fields.some(f => f && f.toLowerCase().includes(term));
      });
    }

    return result;
  }, [items, searchTerm, effectiveRole, user?.id]);

  // Grouper par workflow_status
  const columnData = useMemo(() => {
    const map = {};
    for (const col of KANBAN_COLUMNS) {
      map[col.value] = [];
    }
    for (const item of filteredItems) {
      if (map[item.workflow_status]) {
        map[item.workflow_status].push(item);
      }
    }
    return map;
  }, [filteredItems]);

  // =========================================================================
  // HANDLERS — CLICK
  // =========================================================================

  const handleItemClick = useCallback((item) => {
    setSelectedItem(item);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const handleUpdated = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleCreateSAVFromEntretien = useCallback(({ client, contractId }) => {
    setSelectedItem(null);
    setCreateSAVPrefill({ client, contractId, origin: 'entretien' });
    setCreateSAVOpen(true);
  }, []);

  const handleCreateSAVDirect = useCallback(() => {
    setCreateSAVPrefill(null);
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

    // Pas de destination ou même colonne → annuler
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;

    const oldStatus = source.droppableId;
    const newStatus = destination.droppableId;

    // Trouver l'item dragué
    const item = filteredItems.find(i => i.id === draggableId);
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
      // Demande → Devis envoyé : modale montant + date
      setPendingTransition({ item, oldStatus, newStatus, type: 'quote' });
    } else if (newStatus === 'pieces_commandees' && oldStatus === 'devis_envoye') {
      // Devis envoyé → Pièces commandées : modale acceptation devis
      setPendingTransition({ item, oldStatus, newStatus, type: 'accept' });
    } else if (newStatus === 'planifie') {
      // * → Planifié : modale planification
      setPendingTransition({ item, oldStatus, newStatus, type: 'schedule' });
    } else {
      // Autres transitions : update direct
      handleDirectTransition(item, newStatus);
    }
  }, [filteredItems]);

  // Transition directe (sans modale)
  const handleDirectTransition = useCallback(async (item, newStatus) => {
    try {
      await updateWorkflowStatus(item.id, newStatus);
      toast.success('Statut mis à jour');
      refresh();
    } catch {
      toast.error('Erreur de transition');
    }
  }, [updateWorkflowStatus, refresh]);

  // Annuler la transition en cours
  const handleCancelTransition = useCallback(() => {
    setPendingTransition(null);
  }, []);

  // =========================================================================
  // HANDLERS — MODALES DE TRANSITION
  // =========================================================================

  // Confirmer devis envoyé (SAVQuoteModal)
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

  // Confirmer acceptation devis (AcceptQuoteModal)
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

  // Confirmer planification (SchedulingTransitionModal)
  const handleConfirmSchedule = useCallback(async (schedulingData, includesEntretien) => {
    if (!pendingTransition) return;
    const item = pendingTransition.item;
    const isSAV = item.intervention_type === 'sav';
    const name = item.client_name || `${item.client_last_name || ''} ${item.client_first_name || ''}`.trim() || 'Sans nom';

    try {
      // 1. Créer le RDV
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

      // 2. Mettre à jour les champs sur l'intervention
      const fields = { scheduled_date: schedulingData.date };
      if (isSAV && includesEntretien !== (item.includes_entretien || false)) {
        fields.includes_entretien = includesEntretien;
      }
      await updateFields(item.id, fields);

      // 3. Transition workflow → planifié
      await updateWorkflowStatus(item.id, 'planifie');

      // 4. Confirmer le client draft si contact web
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
  // RENDU
  // =========================================================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Nom client pour les modales de transition
  const pendingClientName = pendingTransition
    ? (pendingTransition.item.client_name || `${pendingTransition.item.client_last_name || ''} ${pendingTransition.item.client_first_name || ''}`.trim() || '')
    : '';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {searchTerm.trim()
            ? `${filteredItems.length} / ${items.length} élément${items.length !== 1 ? 's' : ''}`
            : `${items.length} élément${items.length !== 1 ? 's' : ''}`}
        </p>
        <div className="flex items-center gap-2">
          {/* Bouton Nouveau SAV */}
          {canCreateSAV && (
            <button
              onClick={handleCreateSAVDirect}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
            >
              <Wrench className="h-4 w-4" />
              Nouveau SAV
            </button>
          )}

          {/* Recherche */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-[220px] pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors min-h-[40px]"
              placeholder="Rechercher..."
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={refresh}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Board kanban avec Drag & Drop */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 pb-4 overflow-x-auto">
          {visibleColumns.map((column) => (
            <Droppable key={column.value} droppableId={column.value}>
              {(provided, snapshot) => (
                <KanbanColumn
                  column={column}
                  items={columnData[column.value] || []}
                  onItemClick={handleItemClick}
                  provided={provided}
                  isDraggingOver={snapshot.isDraggingOver}
                />
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      {/* Modale détail */}
      {selectedItem && (
        <EntretienSAVModal
          item={selectedItem}
          onClose={handleModalClose}
          onUpdated={handleUpdated}
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
        onClose={() => {
          setCreateSAVOpen(false);
          setCreateSAVPrefill(null);
        }}
        onCreated={handleUpdated}
        prefillClient={createSAVPrefill?.client || null}
        prefillContractId={createSAVPrefill?.contractId || null}
        savOrigin={createSAVPrefill?.origin || 'appel_client'}
      />

      {/* ============================================================ */}
      {/* MODALES DE TRANSITION (drag & drop)                          */}
      {/* ============================================================ */}

      {/* Devis envoyé : montant + date */}
      <SAVQuoteModal
        isOpen={pendingTransition?.type === 'quote'}
        onClose={handleCancelTransition}
        onConfirm={handleConfirmQuote}
        loading={transitionLoading}
        clientName={pendingClientName}
      />

      {/* Acceptation devis : date */}
      <AcceptQuoteModal
        isOpen={pendingTransition?.type === 'accept'}
        onClose={handleCancelTransition}
        onConfirm={handleConfirmAcceptQuote}
        loading={transitionLoading}
        clientName={pendingClientName}
        devisAmount={pendingTransition?.item?.devis_amount || null}
      />

      {/* Planification : SchedulingPanel + toggle entretien */}
      {pendingTransition?.type === 'schedule' && (
        <SchedulingTransitionModal
          item={pendingTransition.item}
          orgId={orgId}
          onConfirm={handleConfirmSchedule}
          onCancel={handleCancelTransition}
        />
      )}
    </div>
  );
}

export default EntretienSAVKanban;
