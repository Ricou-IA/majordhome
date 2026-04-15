import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FileText, Loader2, Save, Plus, X, Settings, Zap,
  ClipboardList, CalendarCheck, CalendarX2,
  Flame, Wind, Thermometer, Fan, Wrench,
  CheckCircle2, XCircle, Ban,
} from 'lucide-react';
import { useClientContract, useContractEquipments, useContractVisits, useContractMutations } from '@hooks/useContracts';
import { usePricingEquipmentTypes, clientKeys } from '@hooks/useClients';
import { CONTRACT_STATUSES, MAINTENANCE_MONTHS } from '@services/contracts.service';
import { formatEuro } from '@/lib/utils';
import { EQUIPMENT_TYPES } from '@services/clients.service';
import { formatDateForInput, formatDateFR } from '@/lib/utils';
import { FormField, TextInput, SelectInput, TextArea } from '@/apps/artisan/components/FormFields';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CreateContractModal } from '@/apps/artisan/components/entretiens/CreateContractModal';
import { ContractPricingSection } from './ContractPricingSection';
import { ContractPdfSection } from './ContractPdfSection';
import { useDevisByClient } from '@hooks/useDevis';
import DevisStatusBadge from '@/apps/artisan/components/devis/DevisStatusBadge';
import DevisModal from '@/apps/artisan/components/devis/DevisModal';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

const ContractStatusBadge = ({ status }) => {
  const found = CONTRACT_STATUSES.find((s) => s.value === status);
  if (!found) return null;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border ${found.color}`}>
      {found.label}
    </span>
  );
};

const getEquipmentIcon = (type) => {
  const icons = {
    chaudiere_gaz: Flame, chaudiere_fioul: Flame, chaudiere_bois: Flame,
    pac_air_air: Wind, pac_air_eau: Wind, climatisation: Fan,
    vmc: Fan, chauffe_eau_thermo: Thermometer, ballon_ecs: Thermometer,
    poele: Flame,
  };
  return icons[type] || Wrench;
};

const ContractEquipmentsSection = ({ contractId }) => {
  const { equipments, isLoading } = useContractEquipments(contractId);
  const { equipmentTypes } = usePricingEquipmentTypes();

  const pricingTypesMap = useMemo(() => {
    const map = {};
    for (const t of equipmentTypes) map[t.id] = t;
    return map;
  }, [equipmentTypes]);

  const getLabel = (eq) => {
    if (eq.equipment_type_id && pricingTypesMap[eq.equipment_type_id]) {
      return pricingTypesMap[eq.equipment_type_id].label;
    }
    const type = eq.equipment_type || eq.category;
    return EQUIPMENT_TYPES?.find((t) => t.value === type)?.label || type || 'Équipement';
  };

  return (
    <div className="pt-6 border-t border-secondary-200">
      <h4 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-secondary-500" />
        Équipements sous contrat
      </h4>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
        </div>
      ) : equipments.length === 0 ? (
        <p className="text-sm text-secondary-500 italic py-2">
          Aucun équipement lié à ce contrat. Associez des équipements depuis l'onglet Équipements.
        </p>
      ) : (
        <div className="space-y-2">
          {equipments.map((eq) => {
            const Icon = getEquipmentIcon(eq.equipment_type || eq.category);
            const typeLabel = getLabel(eq);
            const unitCount = eq.unit_count || 1;
            const pricingType = eq.equipment_type_id && pricingTypesMap[eq.equipment_type_id];
            const unitLabel = pricingType?.unit_label || 'unité';
            const details = [eq.brand, eq.model, eq.serial_number].filter(v => v && v !== 'À renseigner');
            return (
              <div key={eq.id} className="flex items-center gap-3 px-3 py-2.5 bg-secondary-50 rounded-lg">
                <Icon className="w-4 h-4 text-secondary-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-secondary-900">{typeLabel}</span>
                  {unitCount > 1 && (
                    <span className="inline-flex items-center ml-1.5 px-1.5 py-0.5 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-700">
                      {unitCount} {unitLabel}{unitCount > 1 ? 's' : ''}
                    </span>
                  )}
                  {details.length > 0 && (
                    <span className="text-sm text-secondary-500 ml-2">
                      — {details.join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ContractVisitsSection = ({ contract, orgId, userId }) => {
  const queryClient = useQueryClient();
  const { visits, isLoading, refresh: refreshVisits } = useContractVisits(contract.id);
  const { recordVisit, isRecordingVisit } = useContractMutations();
  const [editingYear, setEditingYear] = useState(null);
  const [visitForm, setVisitForm] = useState({ date: '', notes: '', status: 'completed' });

  const currentYear = new Date().getFullYear();
  const startYear = contract.start_date
    ? new Date(contract.start_date).getFullYear()
    : currentYear;
  const endYear = contract.end_date
    ? new Date(contract.end_date).getFullYear()
    : currentYear;
  const maxYear = Math.min(endYear, currentYear);
  const years = [];
  for (let y = maxYear; y >= startYear; y--) {
    years.push(y);
  }

  const visitsByYear = {};
  (visits || []).forEach((v) => {
    visitsByYear[v.visit_year] = v;
  });

  const handleRecordVisit = async (year) => {
    const isRefusal = visitForm.status === 'cancelled';
    if (!isRefusal && !visitForm.date) {
      toast.error('La date de passage est requise');
      return;
    }
    try {
      const result = await recordVisit({
        contractId: contract.id,
        orgId,
        year,
        visitDate: isRefusal ? null : visitForm.date,
        status: visitForm.status || 'completed',
        notes: visitForm.notes || null,
        userId,
      });
      if (result?.error) {
        console.error('[ContractVisits] recordVisit error:', result.error);
        toast.error(result.error.message || "Erreur lors de l'enregistrement");
        return;
      }
      toast.success(`Visite ${year} enregistrée`);
      setEditingYear(null);
      setVisitForm({ date: '', notes: '', status: 'completed' });
      refreshVisits();
      if (contract.client_id) {
        queryClient.invalidateQueries({ queryKey: clientKeys.detail(contract.client_id) });
      }
    } catch (err) {
      console.error('[ContractVisits] recordVisit exception:', err);
      toast.error("Erreur lors de l'enregistrement");
    }
  };

  const openForm = (year) => {
    const existing = visitsByYear[year];
    setVisitForm({
      date: existing?.visit_date || new Date().toISOString().split('T')[0],
      notes: existing?.notes || '',
      status: existing?.status || 'completed',
    });
    setEditingYear(year);
  };

  return (
    <div className="pt-6 border-t border-secondary-200">
      <h4 className="text-sm font-semibold text-secondary-900 mb-3 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-secondary-500" />
        Visites d'entretien
      </h4>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
        </div>
      ) : years.length === 0 ? (
        <p className="text-sm text-secondary-500 italic py-2">
          Renseignez la date de début du contrat pour voir l'historique des visites.
        </p>
      ) : (
        <div className="space-y-1">
          {years.map((year) => {
            const visit = visitsByYear[year];
            const isCompleted = visit?.status === 'completed';
            const isRefused = visit?.status === 'cancelled';
            const isEditingThis = editingYear === year;

            return (
              <div key={year}>
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isCompleted ? 'bg-green-50' : isRefused ? 'bg-red-50' : 'bg-secondary-50'
                }`}>
                  <span className="text-sm font-semibold text-secondary-900 w-12">{year}</span>

                  {isCompleted ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      <span className="text-sm text-green-700">
                        Réalisé le {formatDateFR(visit.visit_date)}
                      </span>
                      {visit.technician_name && (
                        <span className="text-xs text-green-600">• {visit.technician_name}</span>
                      )}
                      {visit.notes && (
                        <span className="text-xs text-secondary-500 truncate" title={visit.notes}>
                          — {visit.notes}
                        </span>
                      )}
                    </div>
                  ) : isRefused ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      <span className="text-sm text-red-700">Refusé par le client</span>
                      {visit.notes && (
                        <span className="text-xs text-red-600 truncate" title={visit.notes}>
                          — {visit.notes}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <CalendarX2 className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <span className="text-sm text-amber-700">
                        {year < currentYear ? 'Non réalisé' : 'En attente'}
                      </span>
                    </div>
                  )}

                  {!isEditingThis && (
                    <button
                      onClick={() => openForm(year)}
                      className="flex-shrink-0 text-xs px-2.5 py-1 text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                    >
                      {isCompleted || isRefused ? 'Modifier' : 'Enregistrer'}
                    </button>
                  )}
                </div>

                {isEditingThis && (
                  <div className="ml-12 mt-1 p-3 bg-primary-50 border border-primary-200 rounded-lg space-y-3">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`visit-status-${year}`}
                          checked={visitForm.status === 'completed'}
                          onChange={() => setVisitForm((p) => ({ ...p, status: 'completed' }))}
                          className="w-4 h-4 text-green-600 border-secondary-300 focus:ring-green-500"
                        />
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span className="text-sm text-secondary-700">Passage réalisé</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`visit-status-${year}`}
                          checked={visitForm.status === 'cancelled'}
                          onChange={() => setVisitForm((p) => ({ ...p, status: 'cancelled' }))}
                          className="w-4 h-4 text-red-600 border-secondary-300 focus:ring-red-500"
                        />
                        <XCircle className="w-4 h-4 text-red-500" />
                        <span className="text-sm text-secondary-700">Proposé mais refusé par le client</span>
                      </label>
                    </div>
                    {visitForm.status === 'cancelled' ? (
                      <div>
                        <FormField label="Motif du refus">
                          <TextInput
                            value={visitForm.notes}
                            onChange={(v) => setVisitForm((p) => ({ ...p, notes: v }))}
                            placeholder="Ex: Client absent, ne souhaite pas l'entretien cette année..."
                          />
                        </FormField>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField label="Date de passage" required>
                          <TextInput
                            value={visitForm.date}
                            onChange={(v) => setVisitForm((p) => ({ ...p, date: v }))}
                            type="date"
                          />
                        </FormField>
                        <FormField label="Note (optionnel)">
                          <TextInput
                            value={visitForm.notes}
                            onChange={(v) => setVisitForm((p) => ({ ...p, notes: v }))}
                            placeholder="Ex: RAS, remplacement filtre..."
                          />
                        </FormField>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRecordVisit(year)}
                        disabled={isRecordingVisit}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                      >
                        {isRecordingVisit ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
                        Valider
                      </button>
                      <button
                        onClick={() => { setEditingYear(null); setVisitForm({ date: '', notes: '', status: 'completed' }); }}
                        className="px-3 py-1.5 text-sm text-secondary-600 hover:bg-secondary-100 rounded-lg transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

const CANCELLATION_REASONS = [
  { value: 'demenagement', label: 'Déménagement' },
  { value: 'concurrent', label: 'Parti chez un concurrent' },
  { value: 'prix', label: 'Raison tarifaire' },
  { value: 'insatisfaction', label: 'Insatisfaction service' },
  { value: 'plus_equipement', label: "N'a plus l'équipement" },
  { value: 'deces', label: 'Décès' },
  { value: 'archivage_client', label: 'Client archivé' },
  { value: 'autre', label: 'Autre' },
];

export const TabContrat = ({ clientId, orgId, userId, client }) => {
  const {
    contract,
    isLoading,
    createContract,
    isCreating,
    updateContract,
    isUpdating,
    closeContract,
    isClosing,
    deleteContract,
    isDeleting,
  } = useClientContract(clientId);

  const [isEditing, setIsEditing] = useState(false);
  const [contractForm, setContractForm] = useState({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [closeReasonDetail, setCloseReasonDetail] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [openDevisId, setOpenDevisId] = useState(null);
  const { quotes: clientQuotes, isLoading: loadingQuotes } = useDevisByClient(clientId);

  const initForm = useCallback((c) => {
    setContractForm({
      status: c?.status || 'active',
      startDate: formatDateForInput(c?.start_date) || '',
      endDate: formatDateForInput(c?.end_date) || '',
      maintenanceMonth: c?.maintenance_month || '',
      amount: c?.amount || '',
      estimatedTime: c?.estimated_time || '',
      notes: c?.notes || '',
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 text-secondary-300 mx-auto" />
        <p className="mt-4 text-secondary-700 font-medium">Aucun contrat d'entretien</p>
        <p className="mt-1 text-sm text-secondary-500">Ce client n'a pas encore de contrat.</p>
        <button
          onClick={() => setShowCreateModal(true)}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Créer un contrat
        </button>
        <CreateContractModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          preSelectedClient={client ? {
            id: client.id,
            last_name: client.last_name,
            first_name: client.first_name,
            address: client.address,
            postal_code: client.postal_code,
            city: client.city,
            display_name: client.display_name,
            has_active_contract: false,
          } : null}
        />
      </div>
    );
  }

  const handleSaveContract = async () => {
    const result = await updateContract(contract.id, {
      status: contractForm.status,
      startDate: contractForm.startDate || null,
      endDate: contractForm.endDate || null,
      maintenanceMonth: contractForm.maintenanceMonth || null,
      amount: contractForm.amount || null,
      estimatedTime: contractForm.estimatedTime || null,
      notes: contractForm.notes || null,
    });
    if (result?.error) {
      toast.error('Erreur lors de la mise à jour');
    } else {
      toast.success('Contrat mis à jour');
      setIsEditing(false);
    }
  };

  const handleDeleteContract = async () => {
    const result = await deleteContract(contract.id);
    if (result?.error) {
      toast.error('Erreur lors de la suppression');
    } else {
      toast.success('Contrat supprimé');
    }
    setShowDeleteConfirm(false);
  };

  return (
    <div className="space-y-6">
      {/* Header contrat */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ContractStatusBadge status={contract.status} />
          {contract.contract_number && (
            <span className="text-sm font-mono text-secondary-500">{contract.contract_number}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <button
              onClick={() => { initForm(contract); setIsEditing(true); }}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
            >
              <Settings className="w-4 h-4" />
              Modifier
            </button>
          ) : (
            <>
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 text-sm text-secondary-600 hover:bg-secondary-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveContract}
                disabled={isUpdating}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Enregistrer
              </button>
            </>
          )}
        </div>
      </div>

      {/* Détails contrat */}
      {isEditing ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Statut">
            <SelectInput value={contractForm.status} onChange={(v) => setContractForm((p) => ({ ...p, status: v }))} options={CONTRACT_STATUSES} />
          </FormField>
          <FormField label="Montant (€)">
            <TextInput value={contractForm.amount} onChange={(v) => setContractForm((p) => ({ ...p, amount: v }))} placeholder="0.00" type="number" />
          </FormField>
          <FormField label="Date début">
            <TextInput value={contractForm.startDate} onChange={(v) => setContractForm((p) => ({ ...p, startDate: v }))} type="date" />
          </FormField>
          <FormField label="Date fin">
            <TextInput value={contractForm.endDate} onChange={(v) => setContractForm((p) => ({ ...p, endDate: v }))} type="date" />
          </FormField>
          <FormField label="Mois d'entretien">
            <select
              value={contractForm.maintenanceMonth || ''}
              onChange={(e) => setContractForm((p) => ({ ...p, maintenanceMonth: e.target.value ? parseInt(e.target.value) : '' }))}
              className="w-full rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">Non défini</option>
              {MAINTENANCE_MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Tps estimé (heures)">
            <TextInput value={contractForm.estimatedTime} onChange={(v) => setContractForm((p) => ({ ...p, estimatedTime: v }))} placeholder="Ex: 1.5" type="number" />
          </FormField>
          <div className="md:col-span-2">
            <FormField label="Notes">
              <TextArea value={contractForm.notes} onChange={(v) => setContractForm((p) => ({ ...p, notes: v }))} placeholder="Notes sur le contrat..." rows={2} />
            </FormField>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Montant</p>
            <p className="mt-1 text-sm text-secondary-900">
              {contract.amount ? formatEuro(contract.amount) : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Mois d'entretien</p>
            <p className="mt-1 text-sm text-secondary-900">
              {contract.maintenance_month ? MAINTENANCE_MONTHS.find((m) => m.value === contract.maintenance_month)?.label : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Tps estimé</p>
            <p className="mt-1 text-sm text-secondary-900">
              {contract.estimated_time ? `${Number(contract.estimated_time)}h` : '-'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Date historique</p>
            <p className="mt-1 text-sm text-secondary-900">{formatDateFR(contract.start_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Date signature contrat</p>
            <p className="mt-1 text-sm text-secondary-900">{contract.signed_at ? formatDateFR(contract.signed_at) : '-'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Date fin</p>
            <p className="mt-1 text-sm text-secondary-900">{formatDateFR(contract.end_date)}</p>
          </div>
          {contract.notes && (
            <div className="md:col-span-3">
              <p className="text-xs font-medium text-secondary-500 uppercase tracking-wider">Notes</p>
              <p className="mt-1 text-sm text-secondary-600">{contract.notes}</p>
            </div>
          )}
          {contract.status === 'cancelled' && contract.cancellation_reason && (
            <div className="md:col-span-3">
              <p className="text-xs font-medium text-red-500 uppercase tracking-wider">Raison de clôture</p>
              <p className="mt-1 text-sm text-red-700">
                {CANCELLATION_REASONS.find((r) => r.value === contract.cancellation_reason)?.label || contract.cancellation_reason}
                {contract.cancelled_at && (
                  <span className="text-secondary-500 ml-2">— le {formatDateFR(contract.cancelled_at)}</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {!isEditing && <ContractEquipmentsSection contractId={contract.id} />}
      {!isEditing && <ContractPricingSection contractId={contract.id} contract={contract} client={client} />}
      {!isEditing && <ContractPdfSection contract={contract} clientId={clientId} client={client} orgId={orgId} />}
      {!isEditing && <ContractVisitsSection contract={contract} orgId={orgId} userId={userId} />}

      {!isEditing && (
        <div className="pt-4 border-t border-secondary-200 flex items-center gap-3">
          {contract.status !== 'cancelled' && (
            <button
              onClick={() => { setCloseReason(''); setCloseReasonDetail(''); setShowCloseModal(true); }}
              disabled={isClosing}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
            >
              {isClosing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Clore le contrat
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            Supprimer le contrat
          </button>
        </div>
      )}

      {/* Section Devis */}
      {clientQuotes.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            Devis ({clientQuotes.length})
          </h3>
          <div className="space-y-2">
            {clientQuotes.map((quote) => (
              <button
                key={quote.id}
                onClick={() => setOpenDevisId(quote.id)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-secondary-200 bg-white hover:border-primary-300 hover:bg-primary-50/50 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-primary-500" />
                  <div>
                    <span className="text-sm font-medium text-secondary-900">{quote.quote_number}</span>
                    {quote.subject && <p className="text-xs text-secondary-500 truncate max-w-[200px]">{quote.subject}</p>}
                  </div>
                  <DevisStatusBadge status={quote.status} />
                </div>
                <span className="text-sm font-medium text-secondary-900">{formatEuro(quote.total_ttc)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal détail devis */}
      {openDevisId && (
        <DevisModal
          quoteId={openDevisId}
          onClose={() => setOpenDevisId(null)}
          onStatusChange={() => {}}
        />
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Supprimer le contrat"
        description="Voulez-vous vraiment supprimer ce contrat ? Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDeleteContract}
        loading={isDeleting}
      />

      {/* Modale clôture contrat */}
      <ConfirmDialog
        open={showCloseModal}
        onOpenChange={setShowCloseModal}
        title="Clore le contrat"
        description=""
        confirmLabel="Clore le contrat"
        variant="destructive"
        onConfirm={async () => {
          const reason = closeReason === 'autre' && closeReasonDetail
            ? closeReasonDetail
            : closeReason;
          if (!reason) {
            toast.error('Veuillez sélectionner une raison de clôture');
            return;
          }
          const result = await closeContract(contract.id, reason);
          if (result?.error) {
            toast.error('Erreur lors de la clôture');
          } else {
            toast.success('Contrat clos');
            setShowCloseModal(false);
          }
        }}
        loading={isClosing}
      >
        <div className="space-y-3 mt-2">
          <p className="text-sm text-secondary-600">
            Le contrat sera marqué comme clos. Sélectionnez la raison :
          </p>
          <div className="space-y-2">
            {CANCELLATION_REASONS.map((r) => (
              <label key={r.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="close-reason"
                  checked={closeReason === r.value}
                  onChange={() => setCloseReason(r.value)}
                  className="w-4 h-4 text-primary-600 border-secondary-300 focus:ring-primary-500"
                />
                <span className="text-sm text-secondary-700">{r.label}</span>
              </label>
            ))}
          </div>
          {closeReason === 'autre' && (
            <TextInput
              value={closeReasonDetail}
              onChange={(v) => setCloseReasonDetail(v)}
              placeholder="Précisez la raison..."
            />
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
};
