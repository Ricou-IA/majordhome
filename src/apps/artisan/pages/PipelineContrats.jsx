/**
 * PipelineContrats.jsx - Majord'home Artisan
 * ============================================================================
 * Pipeline commercial des contrats d'entretien.
 * Kanban : En attente → Proposition envoyée → (Actif = sort du board)
 *
 * Symétrique du Pipeline leads pour le circuit entretien.
 * ============================================================================
 */

import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, FileText, Send, User, MapPin, Phone, Euro } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@contexts/AuthContext';
import { contractKeys } from '@hooks/cacheKeys';
import { KanbanBoard } from '@apps/artisan/components/shared/KanbanBoard';
import { supabase } from '@/lib/supabaseClient';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

// ============================================================================
// CONSTANTES
// ============================================================================

const PIPELINE_COLUMNS = [
  { id: 'pending',       label: 'En attente',          color: '#F59E0B' },
  { id: 'proposal_sent', label: 'Proposition envoyée', color: '#3B82F6' },
];

// ============================================================================
// HOOK : CONTRATS PIPELINE (pending + proposal_sent)
// ============================================================================

function useContractsPipeline(orgId) {
  const { data, isLoading, error, refetch } = useQueryClient() ? {} : {};

  // Query directe pour simplicité
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const queryClient = useQueryClient();

  const fetchContracts = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('majordhome_contracts')
        .select('*')
        .eq('org_id', orgId)
        .in('status', ['pending', 'proposal_sent'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContracts(data || []);
      setFetchError(null);
    } catch (err) {
      console.error('[PipelineContrats] fetch error:', err);
      setFetchError(err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  // Fetch initial
  useState(() => { fetchContracts(); });

  const updateStatus = useCallback(async (contractId, newStatus) => {
    try {
      const { error } = await supabase
        .from('majordhome_contracts')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', contractId);

      if (error) throw error;
      // Refresh local
      setContracts(prev => prev.map(c =>
        c.id === contractId ? { ...c, status: newStatus } : c
      ));
      queryClient.invalidateQueries({ queryKey: contractKeys.all });
      return { error: null };
    } catch (err) {
      console.error('[PipelineContrats] updateStatus error:', err);
      return { error: err };
    }
  }, [queryClient]);

  return { contracts, loading, error: fetchError, refetch: fetchContracts, updateStatus };
}

// ============================================================================
// CARTE CONTRAT PIPELINE
// ============================================================================

function ContractPipelineCard({ contract }) {
  const clientName = [contract.client_name, contract.client_first_name].filter(Boolean).join(' ');
  const location = [contract.client_city, contract.client_postal_code].filter(Boolean).join(' ');
  const amount = contract.amount ? parseFloat(contract.amount) : 0;
  const createdDays = Math.floor((Date.now() - new Date(contract.created_at).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{clientName || 'Client'}</p>
          {location && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              {location}
            </p>
          )}
        </div>
        {amount > 0 && (
          <span className="text-sm font-bold text-emerald-600 tabular-nums flex-shrink-0">
            {formatEuro(amount)}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400 font-mono">{contract.contract_number}</span>
        <span className={`px-1.5 py-0.5 rounded-full ${createdDays > 7 ? 'bg-red-50 text-red-600' : createdDays > 3 ? 'bg-amber-50 text-amber-600' : 'bg-gray-50 text-gray-500'}`}>
          {createdDays === 0 ? "Aujourd'hui" : `${createdDays}j`}
        </span>
      </div>

      {contract.client_phone && (
        <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
          <Phone className="w-3 h-3" />
          {contract.client_phone}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// PAGE PRINCIPALE
// ============================================================================

export default function PipelineContrats() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const navigate = useNavigate();
  const { contracts, loading, error, refetch, updateStatus } = useContractsPipeline(orgId);

  // Drag & drop : transition entre colonnes
  const handleDragEnd = useCallback(async (result) => {
    const { destination, source, draggableId } = result;
    if (!destination || destination.droppableId === source.droppableId) return;

    const newStatus = destination.droppableId;
    const { error } = await updateStatus(draggableId, newStatus);
    if (error) {
      toast.error('Erreur lors du changement de statut');
      refetch();
    } else {
      toast.success(newStatus === 'proposal_sent' ? 'Proposition envoyée' : 'Statut mis à jour');
    }
  }, [updateStatus, refetch]);

  // Clic sur carte → fiche client onglet contrat
  const handleCardClick = useCallback((contract) => {
    if (contract.client_id) {
      navigate(`/clients/${contract.client_id}?tab=contract`);
    }
  }, [navigate]);

  // Recherche
  const searchFilter = useCallback((contract, query) => {
    const q = query.toLowerCase();
    return (
      (contract.client_name || '').toLowerCase().includes(q) ||
      (contract.client_first_name || '').toLowerCase().includes(q) ||
      (contract.client_city || '').toLowerCase().includes(q) ||
      (contract.client_postal_code || '').includes(q) ||
      (contract.contract_number || '').toLowerCase().includes(q) ||
      (contract.client_phone || '').includes(q)
    );
  }, []);

  // Montant par colonne
  const columnAmount = useCallback((items) => {
    return items.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  }, []);

  if (!orgId) return null;

  if (error) {
    return (
      <div className="text-center py-16">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-red-600">Erreur de chargement</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Contrats</h1>
          <p className="text-gray-500 mt-1">
            {loading ? '...' : `${contracts.length} contrat${contracts.length !== 1 ? 's' : ''} en cours de traitement`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
        </div>
      ) : (
        <KanbanBoard
          items={contracts}
          columns={PIPELINE_COLUMNS}
          groupBy="status"
          renderCard={(contract) => <ContractPipelineCard contract={contract} />}
          onCardClick={handleCardClick}
          onDragEnd={handleDragEnd}
          searchPlaceholder="Rechercher un contrat..."
          searchFilter={searchFilter}
          columnAmount={columnAmount}
          emptyMessage="Aucun contrat"
        />
      )}
    </div>
  );
}
