/**
 * LeadKanban.jsx - Majord'home Artisan
 * ============================================================================
 * Vue kanban des leads par statut avec drag & drop (@hello-pangea/dnd).
 * Chaque colonne = un statut du pipeline.
 *
 * @version 1.0.0 - Sprint 4 Pipeline Commercial
 * ============================================================================
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Loader2, Plus, RefreshCw, CalendarDays, ChevronDown, CheckCircle2, X, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadStatuses, useLeadCommercials, useLeadMutations } from '@/shared/hooks/useLeads';
import { leadsService } from '@/shared/services/leads.service';
import { LeadCard } from './LeadCard';

// Transitions autorisées (identique LeadModal)
const ALLOWED_TRANSITIONS = {
  'Nouveau': ['Contacté', 'RDV planifié', 'Perdu'],
  'Contacté': ['RDV planifié', 'Perdu'],
  'RDV planifié': ['Devis envoyé', 'Perdu'],
  'Devis envoyé': ['Gagné', 'Perdu'],
  'Gagné': [],
  'Perdu': [],
};

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
        flex flex-col bg-gray-50 rounded-xl min-w-0 flex-1
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
  const { organization, user } = useAuth();
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

  const [allLeads, setAllLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Charger tous les leads (pas de pagination pour le kanban)
  const fetchLeads = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    try {
      const dateFilters = monthToDateRange(selectedMonth);
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
  }, [orgId, selectedMonth]);

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
  }, [refreshTrigger, orgId, selectedMonth]);

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
    // Trier les leads dans chaque colonne par date de mise à jour
    for (const col of Object.values(map)) {
      col.leads.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
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
  const [lostReasonInput, setLostReasonInput] = useState('');
  const lostInputRef = useRef(null);

  // Drag & drop handler avec validation des transitions
  const handleDragEnd = useCallback(
    async (result) => {
      const { draggableId, source, destination } = result;
      if (!destination) return;
      if (source.droppableId === destination.droppableId && source.index === destination.index) return;

      const leadId = draggableId;
      const newStatusId = destination.droppableId;
      const oldStatusId = source.droppableId;

      // Valider la transition
      const oldStatus = statuses.find((s) => s.id === oldStatusId);
      const newStatus = statuses.find((s) => s.id === newStatusId);
      const allowed = ALLOWED_TRANSITIONS[oldStatus?.label] || [];

      if (!allowed.includes(newStatus?.label)) {
        toast.error(`Transition non autorisée : ${oldStatus?.label} → ${newStatus?.label}`);
        return;
      }

      // Si "Perdu", ouvrir le prompt de motif
      if (newStatus?.label === 'Perdu') {
        setPendingLost({ leadId, newStatusId, oldStatusId });
        setLostReasonInput('');
        setTimeout(() => lostInputRef.current?.focus(), 100);
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
    if (!pendingLost || !lostReasonInput.trim()) {
      toast.error('Veuillez saisir un motif de perte');
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
        lostReason: lostReasonInput.trim(),
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
  }, [pendingLost, lostReasonInput, updateLeadStatus, userId, fetchLeads]);

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
          <button
            onClick={onNewLead}
            className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm min-h-[40px]"
          >
            <Plus className="h-4 w-4" />
            Nouveau lead
          </button>
        </div>
      </div>

      {/* Prompt motif de perte (affiché au-dessus du kanban) */}
      {pendingLost && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2">
            <span className="text-sm font-medium text-red-800 whitespace-nowrap">Motif de perte :</span>
            <input
              ref={lostInputRef}
              type="text"
              value={lostReasonInput}
              onChange={(e) => setLostReasonInput(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-red-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
              placeholder="Ex: Trop cher, Concurrent retenu..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleConfirmLost(); }
                if (e.key === 'Escape') setPendingLost(null);
              }}
            />
          </div>
          <button
            onClick={handleConfirmLost}
            className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
          >
            Confirmer
          </button>
          <button
            onClick={() => setPendingLost(null)}
            className="p-1.5 text-red-400 hover:text-red-600 rounded transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
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
    </div>
  );
}

export default LeadKanban;
