/**
 * LeadKanban.jsx - Majord'home Artisan
 * ============================================================================
 * Vue kanban des leads par statut avec drag & drop (@hello-pangea/dnd).
 * Chaque colonne = un statut du pipeline.
 *
 * @version 1.0.0 - Sprint 4 Pipeline Commercial
 * ============================================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Loader2, Plus, RefreshCw, CalendarDays, ChevronDown, CheckCircle2, X, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadStatuses, useLeadCommercials, useLeadMutations } from '@/shared/hooks/useLeads';
import { leadsService } from '@/shared/services/leads.service';
import { LeadCard } from './LeadCard';
import { CallModal } from './CallModal';
import { QuoteModal } from './QuoteModal';
import { ALLOWED_TRANSITIONS, LOST_REASONS } from './LeadStatusConfig';

// ============================================================================
// HELPERS
// ============================================================================

function getMonthOptions() {
  const options = [{ value: '', label: 'Tous les mois' }];
  const now = new Date();
  const start = new Date(2026, 0, 1); // Janvier 2026
  const current = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let d = current; d >= start; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    options.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return options;
}

const MONTH_OPTIONS = getMonthOptions();

function monthToDateRange(monthValue) {
  if (!monthValue) return {};
  const [year, month] = monthValue.split('-');
  const dateFrom = `${year}-${month}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const dateTo = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  return { dateFrom, dateTo };
}

/**
 * Dropdown filtre mois compact pour le kanban
 */
function MonthFilterDropdown({ value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = MONTH_OPTIONS.find((opt) => opt.value === value);
  const hasValue = value !== '';

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-h-[40px]
          ${hasValue
            ? 'bg-blue-50 border-blue-200 text-blue-700'
            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }
        `}
      >
        <CalendarDays className="w-4 h-4" />
        <span className="text-sm font-medium truncate max-w-[140px]">
          {selectedOption?.label || 'Mois'}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 max-h-64 overflow-y-auto">
            {MONTH_OPTIONS.map((option) => (
              <button
                key={option.value ?? 'null'}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`
                  w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors
                  ${option.value === value
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                <span>{option.label}</span>
                {option.value === value && <CheckCircle2 className="w-4 h-4 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/**
 * Colonne kanban pour un statut donné
 */
function KanbanColumn({ status, leads, onLeadClick, provided, isDraggingOver, commercialsMap }) {
  const count = leads.length;
  const totalAmount = leads.reduce(
    (sum, l) => sum + (Number(l.order_amount_ht) || Number(l.estimated_revenue) || 0),
    0,
  );

  return (
    <div
      className={`
        flex flex-col bg-gray-50 rounded-xl min-w-0 flex-1 basis-0
        border transition-colors
        ${isDraggingOver ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'}
      `}
    >
      {/* Header colonne */}
      <div className="px-3 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: status.color }}
            />
            <h3 className="font-semibold text-sm text-gray-800 truncate">
              {status.label}
            </h3>
          </div>
          <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
        <p className={`text-xs mt-1 ${totalAmount > 0 ? 'text-gray-500' : 'text-gray-300'}`}>
          {new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(totalAmount)}
        </p>
      </div>

      {/* Zone droppable */}
      <div
        ref={provided.innerRef}
        {...provided.droppableProps}
        className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] max-h-[calc(100vh-280px)]"
      >
        {leads.map((lead, index) => (
          <Draggable key={lead.id} draggableId={lead.id} index={index}>
            {(dragProvided, snapshot) => (
              <div
                ref={dragProvided.innerRef}
                {...dragProvided.draggableProps}
                {...dragProvided.dragHandleProps}
                className={`${snapshot.isDragging ? 'opacity-90 rotate-1 shadow-lg' : ''}`}
              >
                <LeadCard lead={lead} onClick={onLeadClick} compact commercialsMap={commercialsMap} />
              </div>
            )}
          </Draggable>
        ))}
        {provided.placeholder}

        {/* État vide */}
        {count === 0 && (
          <p className="text-xs text-gray-400 text-center py-6 italic">
            Aucun lead
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

/**
 * @param {Object} props
 * @param {Function} props.onLeadClick - Callback clic sur un lead
 * @param {Function} props.onNewLead - Callback nouveau lead
 */
export function LeadKanban({ onLeadClick, onNewLead, refreshTrigger }) {
  const { organization, user, effectiveRole } = useAuth();
  const orgId = organization?.id;
  const userId = user?.id;

  const { statuses } = useLeadStatuses();
  const { commercials } = useLeadCommercials(orgId);
  const { updateLeadStatus } = useLeadMutations();

  // Map { userId → { initials, name, colorIndex } } pour les badges
  const commercialsMap = useMemo(() => {
    const map = {};
    commercials.forEach((c, i) => {
      const parts = (c.full_name || '').trim().split(/\s+/);
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (parts[0] || '?').substring(0, 2).toUpperCase();
      map[c.id] = { initials, name: c.full_name, colorIndex: i };
    });
    return map;
  }, [commercials]);

  // Résoudre l'ID commercial depuis l'ID auth (dual ID bridge)
  const myCommercialId = useMemo(() => {
    if (effectiveRole !== 'commercial' || !userId) return null;
    return commercials.find(c => c.profile_id === userId)?.id || null;
  }, [effectiveRole, userId, commercials]);

  const [allLeads, setAllLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Charger les leads (commercial = les siens uniquement)
  const fetchLeads = useCallback(async () => {
    if (!orgId) return;
    // Attendre la résolution de l'ID commercial avant de filtrer
    if (effectiveRole === 'commercial' && !myCommercialId) return;
    setIsLoading(true);
    try {
      const dateFilters = monthToDateRange(selectedMonth);
      // Commercial : filtrer sur ses propres leads via l'ID commercial (pas l'ID auth)
      if (effectiveRole === 'commercial' && myCommercialId) {
        dateFilters.assignedUserId = myCommercialId;
      }
      const { data, error } = await leadsService.getLeads({
        orgId,
        filters: dateFilters,
        limit: 500,
        offset: 0,
      });
      if (error) throw error;
      setAllLeads(data || []);
    } catch (err) {
      console.error('[LeadKanban] fetchLeads error:', err);
      toast.error('Erreur chargement des leads');
    } finally {
      setIsLoading(false);
    }
  }, [orgId, selectedMonth, effectiveRole, myCommercialId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // Refetch dédié quand la modale sauvegarde un changement de statut
  useEffect(() => {
    if (refreshTrigger === 0) return;
    const refetch = async () => {
      if (!orgId) return;
      try {
        const dateFilters = monthToDateRange(selectedMonth);
        if (effectiveRole === 'commercial' && myCommercialId) {
          dateFilters.assignedUserId = myCommercialId;
        }
        const { data, error } = await leadsService.getLeads({
          orgId,
          filters: dateFilters,
          limit: 500,
          offset: 0,
        });
        if (error) throw error;
        setAllLeads(data || []);
      } catch (err) {
        console.error('[LeadKanban] refresh error:', err);
      }
    };
    refetch();
  }, [refreshTrigger, orgId, selectedMonth, effectiveRole, myCommercialId]);

  // Filtrer les leads côté client (instantané, pas d'appel API)
  const filteredLeads = useMemo(() => {
    if (!searchTerm.trim()) return allLeads;
    const term = searchTerm.trim().toLowerCase();
    return allLeads.filter((lead) => {
      const fields = [
        lead.first_name,
        lead.last_name,
        lead.company_name,
        lead.email,
        lead.phone,
        lead.city,
      ];
      return fields.some((f) => f && f.toLowerCase().includes(term));
    });
  }, [allLeads, searchTerm]);

  // Grouper les leads filtrés par status_id
  const columnData = useMemo(() => {
    const map = {};
    for (const status of statuses) {
      map[status.id] = {
        status,
        leads: [],
      };
    }
    for (const lead of filteredLeads) {
      if (map[lead.status_id]) {
        map[lead.status_id].leads.push(lead);
      }
    }
    // Trier les leads dans chaque colonne par sort_order (puis updated_at en fallback)
    for (const col of Object.values(map)) {
      col.leads.sort((a, b) => {
        const oa = a.sort_order || 0;
        const ob = b.sort_order || 0;
        if (oa !== ob) return oa - ob;
        return new Date(b.updated_at) - new Date(a.updated_at);
      });
    }
    return map;
  }, [statuses, filteredLeads]);

  // Colonnes ordonnées par display_order
  const orderedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.display_order - b.display_order),
    [statuses],
  );

  // État pour le prompt "Perdu" depuis le kanban
  const [pendingLost, setPendingLost] = useState(null); // { leadId, newStatusId, oldStatusId }
  const [lostReasonSelect, setLostReasonSelect] = useState('');
  const [lostReasonCustom, setLostReasonCustom] = useState('');

  // État pour le prompt "Contacté" depuis le kanban
  const [pendingContact, setPendingContact] = useState(null); // { leadId, newStatusId, oldStatusId }
  const [contactLoading, setContactLoading] = useState(false);

  // État pour le prompt "Devis envoyé" depuis le kanban
  const [pendingQuote, setPendingQuote] = useState(null); // { leadId, newStatusId, oldStatusId, defaultAmount }
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Drag & drop handler avec validation des transitions
  const handleDragEnd = useCallback(
    async (result) => {
      const { draggableId, source, destination } = result;
      if (!destination) return;
      if (source.droppableId === destination.droppableId && source.index === destination.index) return;

      const leadId = draggableId;
      const newStatusId = destination.droppableId;
      const oldStatusId = source.droppableId;

      // Réorganisation dans la même colonne — réordonner + persister
      if (oldStatusId === newStatusId) {
        setAllLeads((prev) => {
          const colLeads = prev.filter((l) => l.status_id === oldStatusId);
          const others = prev.filter((l) => l.status_id !== oldStatusId);
          const [moved] = colLeads.splice(source.index, 1);
          colLeads.splice(destination.index, 0, moved);
          // Mettre à jour sort_order localement
          const updated = colLeads.map((l, i) => ({ ...l, sort_order: i + 1 }));
          // Persister en DB (fire-and-forget)
          leadsService.reorderLeads(updated.map((l) => l.id)).catch((err) =>
            console.error('[LeadKanban] reorder error:', err),
          );
          return [...others, ...updated];
        });
        return;
      }

      // Valider la transition inter-colonnes
      const oldStatus = statuses.find((s) => s.id === oldStatusId);
      const newStatus = statuses.find((s) => s.id === newStatusId);
      const allowed = ALLOWED_TRANSITIONS[oldStatus?.label] || [];

      if (!allowed.includes(newStatus?.label)) {
        toast.error(`Transition non autorisée : ${oldStatus?.label} → ${newStatus?.label}`);
        return;
      }

      // Si "Perdu", ouvrir la modale de motif
      if (newStatus?.label === 'Perdu') {
        setPendingLost({ leadId, newStatusId, oldStatusId });
        setLostReasonSelect('');
        setLostReasonCustom('');
        return;
      }

      // Si "Contacté", ouvrir la modale d'appel
      if (newStatus?.label === 'Contacté') {
        setPendingContact({ leadId, newStatusId, oldStatusId });
        return;
      }

      // Si "RDV planifié", ouvrir la modale lead avec auto-scheduling
      if (newStatus?.label === 'RDV planifié') {
        const lead = allLeads.find((l) => l.id === leadId);
        if (lead) onLeadClick(lead, { autoSchedule: true });
        return;
      }

      // Si "Devis envoyé", ouvrir la modale devis
      if (newStatus?.label === 'Devis envoyé') {
        const lead = allLeads.find((l) => l.id === leadId);
        setPendingQuote({
          leadId,
          newStatusId,
          oldStatusId,
          defaultAmount: lead?.order_amount_ht || lead?.estimated_revenue || '',
        });
        return;
      }

      // Optimistic update
      setAllLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status_id: newStatusId } : l)),
      );

      try {
        await updateLeadStatus(leadId, newStatusId, userId);
        fetchLeads();
      } catch (err) {
        console.error('[LeadKanban] drag status error:', err);
        toast.error('Erreur lors du déplacement');
        setAllLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, status_id: oldStatusId } : l)),
        );
      }
    },
    [updateLeadStatus, userId, fetchLeads, statuses],
  );

  // Confirmer le passage en Perdu avec motif
  const handleConfirmLost = useCallback(async () => {
    const reason = lostReasonSelect === 'Autre' ? lostReasonCustom.trim() : lostReasonSelect;
    if (!pendingLost || !reason) {
      toast.error('Veuillez sélectionner un motif de perte');
      return;
    }

    const { leadId, newStatusId, oldStatusId } = pendingLost;

    // Optimistic update
    setAllLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status_id: newStatusId } : l)),
    );
    setPendingLost(null);

    try {
      await updateLeadStatus(leadId, newStatusId, userId, {
        lostReason: reason,
      });
      fetchLeads();
      toast.success('Lead marqué comme perdu');
    } catch (err) {
      console.error('[LeadKanban] lost status error:', err);
      toast.error('Erreur lors du changement de statut');
      setAllLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status_id: oldStatusId } : l)),
      );
    }
  }, [pendingLost, lostReasonSelect, lostReasonCustom, updateLeadStatus, userId, fetchLeads]);

  // Confirmer le passage en Contacté avec données d'appel
  const handleConfirmContact = useCallback(async (callData) => {
    if (!pendingContact) return;

    const { leadId, newStatusId, oldStatusId } = pendingContact;
    setContactLoading(true);

    // Optimistic update — inclut les données d'appel pour affichage immédiat
    setAllLeads((prev) =>
      prev.map((l) => (l.id === leadId ? {
        ...l,
        status_id: newStatusId,
        call_count: (l.call_count || 0) + 1,
        last_call_date: callData.date || new Date().toISOString(),
        last_call_result: callData.result,
      } : l)),
    );
    setPendingContact(null);

    try {
      await updateLeadStatus(leadId, newStatusId, userId, {
        callResult: callData.result,
        callDate: callData.date,
      });
      fetchLeads();
      toast.success('Lead passé en "Contacté"');
    } catch (err) {
      console.error('[LeadKanban] contact status error:', err);
      toast.error('Erreur lors du changement de statut');
      setAllLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status_id: oldStatusId } : l)),
      );
    } finally {
      setContactLoading(false);
    }
  }, [pendingContact, updateLeadStatus, userId, fetchLeads]);

  // Confirmer le passage en Devis envoyé avec montant + date
  const handleConfirmQuote = useCallback(async (quoteData) => {
    if (!pendingQuote) return;

    const { leadId, newStatusId, oldStatusId } = pendingQuote;
    setQuoteLoading(true);

    // Optimistic update — inclut le montant + date pour affichage immédiat sur la carte
    setAllLeads((prev) =>
      prev.map((l) => (l.id === leadId ? {
        ...l,
        status_id: newStatusId,
        order_amount_ht: quoteData.amount || l.order_amount_ht,
        estimated_revenue: quoteData.amount || l.estimated_revenue,
        quote_sent_date: quoteData.date || l.quote_sent_date,
      } : l)),
    );
    setPendingQuote(null);

    try {
      await updateLeadStatus(leadId, newStatusId, userId, {
        quoteSentDate: quoteData.date,
        quoteAmount: quoteData.amount,
      });
      fetchLeads();
      toast.success('Lead passé en "Devis envoyé"');
    } catch (err) {
      console.error('[LeadKanban] quote status error:', err);
      toast.error('Erreur lors du changement de statut');
      setAllLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status_id: oldStatusId } : l)),
      );
    } finally {
      setQuoteLoading(false);
    }
  }, [pendingQuote, updateLeadStatus, userId, fetchLeads]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {searchTerm.trim()
            ? `${filteredLeads.length} / ${allLeads.length} lead${allLeads.length !== 1 ? 's' : ''}`
            : `${allLeads.length} lead${allLeads.length !== 1 ? 's' : ''} actif${allLeads.length !== 1 ? 's' : ''}`
          }
        </p>
        <div className="flex items-center gap-2">
          {/* Recherche leads */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-[220px] pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors min-h-[40px]"
              placeholder="Rechercher un lead..."
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
          <MonthFilterDropdown value={selectedMonth} onChange={setSelectedMonth} />
          <button
            onClick={fetchLeads}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {onNewLead && (
            <button
              onClick={onNewLead}
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm min-h-[40px]"
            >
              <Plus className="h-4 w-4" />
              Nouveau lead
            </button>
          )}
        </div>
      </div>

      {/* Modale motif de perte */}
      {pendingLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setPendingLost(null);
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Motif de perte</h3>
              <button
                onClick={() => setPendingLost(null)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <select
                value={lostReasonSelect}
                onChange={(e) => setLostReasonSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                autoFocus
              >
                <option value="">Sélectionner un motif...</option>
                {LOST_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
                <option value="Autre">Autre (préciser)</option>
              </select>

              {lostReasonSelect === 'Autre' && (
                <input
                  type="text"
                  value={lostReasonCustom}
                  onChange={(e) => setLostReasonCustom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                  placeholder="Précisez le motif..."
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleConfirmLost(); }
                  }}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setPendingLost(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmLost}
                disabled={!lostReasonSelect || (lostReasonSelect === 'Autre' && !lostReasonCustom.trim())}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Board kanban (scroll horizontal) */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 pb-4">
          {orderedStatuses.map((status) => {
            const col = columnData[status.id] || { status, leads: [] };
            return (
              <Droppable key={status.id} droppableId={status.id}>
                {(provided, snapshot) => (
                  <KanbanColumn
                    status={col.status}
                    leads={col.leads}
                    onLeadClick={onLeadClick}
                    provided={provided}
                    isDraggingOver={snapshot.isDraggingOver}
                    commercialsMap={commercialsMap}
                  />
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {/* Modale d'appel pour transition vers Contacté */}
      <CallModal
        isOpen={!!pendingContact}
        onClose={() => setPendingContact(null)}
        onConfirm={handleConfirmContact}
        loading={contactLoading}
      />

      {/* Modale devis pour transition vers Devis envoyé */}
      <QuoteModal
        isOpen={!!pendingQuote}
        onClose={() => setPendingQuote(null)}
        onConfirm={handleConfirmQuote}
        loading={quoteLoading}
        defaultAmount={pendingQuote?.defaultAmount}
      />
    </div>
  );
}

export default LeadKanban;
