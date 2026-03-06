/**
 * ContractModal.jsx - Slide-over détail contrat d'entretien
 * ============================================================================
 * Overlay droit avec :
 * 1. Infos client (nom, adresse, tél, email)
 * 2. Infos contrat (type, tarif, début, statut)
 * 3. Visite en cours (statut + bouton "Marquer effectué")
 * 4. Historique visites (table année/date/statut)
 * 5. Lien CRM si matched_project_id
 *
 * Pattern identique à ClientModal.jsx / LeadModal.jsx (slide-over droit).
 *
 * @version 1.0.0 - Sprint 5
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import {
  X, User, MapPin, Phone, Mail, Wrench, Euro, Calendar, Clock,
  CheckCircle2, FileText, History, ExternalLink, Loader2, AlertCircle,
} from 'lucide-react';
import { useContract, useContractVisits, useContractMutations } from '@hooks/useContracts';
import { CONTRACT_STATUSES, CONTRACT_FREQUENCIES } from '@services/contracts.service';
import { useAuth } from '@contexts/AuthContext';
import { VisitBadge } from './VisitBadge';
import { Button } from '@components/ui/button';

// ============================================================================
// UTILITAIRES
// ============================================================================

const formatDateFR = (dateString) => {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
};

const formatEuro = (n) => {
  if (!n && n !== 0) return '-';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n);
};

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
  const { contract, isLoading: loadingContract } = useContract(contractId);
  const { visits, isLoading: loadingVisits } = useContractVisits(contractId);
  const { recordVisit, isRecordingVisit } = useContractMutations();
  const { user, organization } = useAuth();

  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [visitNotes, setVisitNotes] = useState('');
  const [showRecordForm, setShowRecordForm] = useState(false);

  // Reset state quand le contrat change
  useEffect(() => {
    if (contractId) {
      setShowRecordForm(false);
      setVisitNotes('');
      setVisitDate(new Date().toISOString().split('T')[0]);
    }
  }, [contractId]);

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

  const handleRecordVisit = useCallback(async () => {
    if (!contract || !organization) return;

    const currentYear = new Date().getFullYear();
    try {
      await recordVisit({
        contractId: contract.id,
        orgId: organization.id,
        year: currentYear,
        visitDate,
        technicianName: user?.user_metadata?.full_name || null,
        technicianId: user?.id || null,
        notes: visitNotes || null,
        userId: user?.id || null,
      });
      setShowRecordForm(false);
      setVisitNotes('');
    } catch (err) {
      console.error('[ContractModal] recordVisit error:', err);
    }
  }, [contract, organization, visitDate, visitNotes, user, recordVisit]);

  if (!isOpen) return null;

  const isLoading = loadingContract || (!contract && !!contractId);
  const currentYear = new Date().getFullYear();

  // Statut visite calculé depuis next_maintenance_date
  const isVisitDone = contract?.next_maintenance_date
    ? new Date(contract.next_maintenance_date) > new Date()
    : false;
  const visitStatus = isVisitDone ? 'completed' : 'pending';

  // Labels fréquence et statut
  const frequencyLabel = contract
    ? (CONTRACT_FREQUENCIES.find(f => f.value === contract.frequency)?.label || contract.frequency || '-')
    : '-';
  const statusLabel = contract
    ? (CONTRACT_STATUSES.find(s => s.value === contract.status)?.label || contract.status || '-')
    : '-';
  const isActive = contract?.status === 'active';

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

              {/* Section Contrat */}
              <Section title="Contrat" icon={FileText}>
                <InfoRow label="Fréquence" value={frequencyLabel} />
                <InfoRow label="Tarif" value={formatEuro(contract.amount)} />
                <InfoRow label="Début" value={formatDateFR(contract.start_date)} />
                <InfoRow label="Fin" value={formatDateFR(contract.end_date)} />
                {contract.renewal_date && (
                  <InfoRow label="Renouvellement" value={formatDateFR(contract.renewal_date)} />
                )}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-500">Statut</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      isActive
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
                {contract.notes && (
                  <div className="mt-2">
                    <span className="text-sm text-gray-500 block mb-1">Notes</span>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-2.5">
                      {contract.notes}
                    </p>
                  </div>
                )}
              </Section>

              {/* Section Visite en cours */}
              <Section title={`Visite ${currentYear}`} icon={Calendar}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Statut</span>
                  <VisitBadge status={visitStatus} size="md" />
                </div>
                {contract.next_maintenance_date && (
                  <InfoRow label="Prochaine visite" value={formatDateFR(contract.next_maintenance_date)} />
                )}

                {/* Bouton marquer comme effectué */}
                {!isVisitDone && isActive && (
                  <div className="mt-3">
                    {showRecordForm ? (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Date de la visite
                          </label>
                          <input
                            type="date"
                            value={visitDate}
                            onChange={(e) => setVisitDate(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                              focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Notes (optionnel)
                          </label>
                          <textarea
                            value={visitNotes}
                            onChange={(e) => setVisitNotes(e.target.value)}
                            placeholder="Observations, commentaires..."
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                              focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none resize-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleRecordVisit}
                            disabled={isRecordingVisit}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                            size="sm"
                          >
                            {isRecordingVisit ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                Enregistrement...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                Confirmer
                              </>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowRecordForm(false)}
                          >
                            Annuler
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-green-300 text-green-700 hover:bg-green-50"
                        onClick={() => setShowRecordForm(true)}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        Marquer comme effectué
                      </Button>
                    )}
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
                        {visits.map((visit) => (
                          <tr key={visit.id} className="border-t border-gray-100">
                            <td className="px-3 py-2 text-gray-900">{visit.visit_year}</td>
                            <td className="px-3 py-2 text-gray-600">
                              {formatDateFR(visit.visit_date)}
                            </td>
                            <td className="px-3 py-2">
                              <VisitBadge status={visit.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              {/* Lien CRM */}
              {contract.client_id && (
                <Section title="Fiche CRM" icon={ExternalLink}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      window.location.href = `/clients/${contract.client_id}`;
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-1.5" />
                    Voir la fiche client CRM
                  </Button>
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default ContractModal;
