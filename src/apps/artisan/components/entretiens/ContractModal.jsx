/**
 * ContractModal.jsx - Slide-over détail contrat d'entretien
 * ============================================================================
 * Overlay droit avec :
 * 1. Client lié (carte + lien CRM)
 * 2. Infos contrat (tarif, tps estimé, mois entretien)
 * 3. Visite en cours (statut dérivé + bouton Planifier)
 * 4. Historique visites (table année/date/statut)
 *
 * Pattern identique à ClientModal.jsx / LeadModal.jsx (slide-over droit).
 *
 * @version 2.0.0 - Refonte structure + Planifier
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, User, Calendar,
  FileText, History, ExternalLink, Loader2, AlertCircle,
  CalendarPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useContract, useContractVisits, useEntretienByContract } from '@hooks/useContracts';
import { entretienSavKeys, appointmentKeys, contractKeys } from '@hooks/cacheKeys';
import { MAINTENANCE_MONTHS } from '@services/contracts.service';
import { ensureEntretienCard } from '@services/entretiens.service';
import { savService } from '@services/sav.service';
import { useAuth } from '@contexts/AuthContext';
import { VisitBadge } from './VisitBadge';
import { Button } from '@components/ui/button';
import { formatDateFR, formatEuro } from '@/lib/utils';
import { logger } from '@lib/logger';
import { LinkedClientCard } from '@/apps/artisan/components/shared/LinkedClientCard';
import { deriveVisitBadgeStatus } from '@/lib/entretienVisitStatus';
import { SchedulingTransitionModal } from './SchedulingTransitionModal';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

function Section({ title, icon: Icon, children }) {
  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-gray-400" />
        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h4>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, isLink = false, href = null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
      {isLink && href ? (
        <a
          href={href}
          className="text-sm text-blue-600 hover:underline text-right truncate"
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </a>
      ) : (
        <span className="text-sm text-gray-900 text-right truncate">{value || '-'}</span>
      )}
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function ContractModal({ contractId, isOpen, onClose }) {
  const navigate = useNavigate();
  const { contract, isLoading: loadingContract } = useContract(contractId);
  const { visits, isLoading: loadingVisits } = useContractVisits(contractId);
  const { user, organization } = useAuth();
  const queryClient = useQueryClient();
  const { card: activeCard } = useEntretienByContract(organization?.id, contractId);

  const [schedulingOpen, setSchedulingOpen] = useState(false);
  const [schedulingItem, setSchedulingItem] = useState(null);
  const [planning, setPlanning] = useState(false);

  const handlePlanifier = useCallback(async () => {
    if (!contract || planning) return;
    setPlanning(true);
    try {
      const { interventionId, error } = await ensureEntretienCard({
        clientId: contract.client_id,
        contractId: contract.id,
        userId: user?.id,
      });
      if (error || !interventionId) {
        toast.error(error === 'client_sans_projet'
          ? 'Projet client introuvable — impossible de planifier'
          : 'Erreur lors de la préparation de la planification');
        return;
      }
      setSchedulingItem({
        id: interventionId,
        intervention_type: 'entretien',
        client_id: contract.client_id,
        client_name: contract.client_name,
        client_last_name: contract.client_name,
        client_first_name: null,
        client_phone: contract.client_phone || '',
        client_email: contract.client_email || null,
        client_address: contract.client_address || null,
        client_city: contract.client_city || null,
        client_postal_code: contract.client_postal_code || null,
        includes_entretien: false,
      });
      setSchedulingOpen(true);
    } catch (err) {
      logger.error('[ContractModal] handlePlanifier error:', err);
      toast.error('Erreur lors de la planification');
    } finally {
      setPlanning(false);
    }
  }, [contract, planning, user]);

  const handleConfirmScheduling = useCallback(async (slots) => {
    const orgId = organization?.id;
    const { error } = await savService.scheduleEntretien({
      card: schedulingItem,
      slots,
      includesEntretien: false,
      coreOrgId: orgId,
    });
    if (error) { toast.error('Erreur création du RDV'); return; }
    toast.success('RDV planifié avec succès');
    setSchedulingOpen(false);
    setSchedulingItem(null);
    queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
    queryClient.invalidateQueries({ queryKey: contractKeys.detail(orgId, contractId) });
    queryClient.invalidateQueries({ queryKey: [...contractKeys.all(orgId), 'visits', contractId] });
  }, [organization, schedulingItem, contractId, queryClient]);

  // Gestion ESC pour fermer
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    if (isOpen) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Empêcher le scroll du body quand le modal est ouvert
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isLoading = loadingContract || (!contract && !!contractId);
  const currentYear = new Date().getFullYear();
  const badgeStatus = contract ? deriveVisitBadgeStatus({ visits, activeCard, currentYear }) : null;
  const nextVisitDate = activeCard?.next_rdv_date || contract?.next_maintenance_date;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900 truncate">
            {isLoading ? 'Chargement...' : contract?.client_name || 'Détail contrat'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            </div>
          ) : !contract ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <AlertCircle className="h-10 w-10 mb-3" />
              <p>Contrat introuvable</p>
            </div>
          ) : (
            <>
              {/* Section Client */}
              <Section title="Client" icon={User}>
                <InfoRow label="Nom" value={contract.client_name} />
                <InfoRow
                  label="Adresse"
                  value={[contract.client_address, contract.client_postal_code, contract.client_city].filter(Boolean).join(', ')}
                />
                <InfoRow
                  label="Téléphone"
                  value={contract.client_phone}
                  isLink={!!contract.client_phone}
                  href={contract.client_phone ? `tel:${contract.client_phone.replace(/\s/g, '')}` : null}
                />
                <InfoRow
                  label="Email"
                  value={contract.client_email}
                  isLink={!!contract.client_email}
                  href={contract.client_email ? `mailto:${contract.client_email}` : null}
                />
              </Section>

              {/* Carte Client lié */}
              {contract.client_id && (
                <div className="py-4 border-b border-gray-100">
                  <LinkedClientCard
                    name={contract.client_name}
                    clientNumber={contract.client_number}
                    city={contract.client_city}
                  >
                    <button
                      type="button"
                      onClick={() => { onClose(); navigate(`/clients/${contract.client_id}`); }}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors shrink-0"
                      title="Voir la fiche client"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Voir la fiche
                    </button>
                  </LinkedClientCard>
                </div>
              )}

              {/* Section Contrat */}
              <Section title="Contrat" icon={FileText}>
                <InfoRow label="Tarif" value={formatEuro(contract.amount)} />
                <InfoRow
                  label="Tps estimé"
                  value={contract.estimated_time
                    ? `${Math.round(Number(contract.estimated_time) * 60)} min`
                    : '—'}
                />
                <InfoRow
                  label="Mois d'entretien"
                  value={MAINTENANCE_MONTHS.find((m) => m.value === contract.maintenance_month)?.label || '—'}
                />
              </Section>

              {/* Section Visite en cours */}
              <Section title={`Visite ${currentYear}`} icon={Calendar}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Statut</span>
                  <VisitBadge status={badgeStatus} size="md" />
                </div>
                {nextVisitDate && (
                  <InfoRow label="Prochaine visite" value={formatDateFR(nextVisitDate)} />
                )}
                {badgeStatus === 'a_planifier' && (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-primary-300 text-primary-700 hover:bg-primary-50"
                      onClick={handlePlanifier}
                      disabled={planning}
                    >
                      {planning ? (
                        <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Préparation…</>
                      ) : (
                        <><CalendarPlus className="h-4 w-4 mr-1.5" />Planifier</>
                      )}
                    </Button>
                  </div>
                )}
              </Section>

              {/* Historique visites */}
              <Section title="Historique visites" icon={History}>
                {loadingVisits ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ) : visits.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">Aucune visite enregistrée</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Année</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Date</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">Statut</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visits.map((visit) => {
                          const done = visit.status === 'completed';
                          return (
                            <tr key={visit.id} className="border-t border-gray-100">
                              <td className="px-3 py-2 text-gray-900">{visit.visit_year}</td>
                              <td className="px-3 py-2 text-gray-600">{done ? formatDateFR(visit.visit_date) : '—'}</td>
                              <td className="px-3 py-2">
                                <VisitBadge status={done ? 'completed' : 'non_realise'} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

            </>
          )}
        </div>
      </div>
      {schedulingOpen && schedulingItem && (
        <SchedulingTransitionModal
          item={schedulingItem}
          orgId={organization?.id}
          onConfirm={handleConfirmScheduling}
          onCancel={() => { setSchedulingOpen(false); setSchedulingItem(null); }}
        />
      )}
    </>
  );
}

export default ContractModal;
