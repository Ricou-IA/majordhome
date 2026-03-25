/**
 * SectorGroupView.jsx - Vue contrats groupés par secteur (Programmation)
 * ============================================================================
 * Affiche les contrats groupés par code postal, avec sections dépliables.
 * Chaque secteur montre le nombre de contrats, visites faites/à faire.
 *
 * Sprint 8 — Enrichissements :
 *   - Filtre par mois de référence (maintenance_month)
 *   - CTA « Planifier » par contrat → crée un entretien à planifier
 *   - CTA « Planifier le secteur » bulk → crée pour tous les contrats
 *
 * @version 3.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import {
  MapPin,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock,
  Calendar,
  Loader2,
  Map,
} from 'lucide-react';
import { VisitBadge } from './VisitBadge';

// ============================================================================
// CONSTANTES
// ============================================================================

const MONTHS = [
  { value: 1, label: 'Janvier' },
  { value: 2, label: 'Février' },
  { value: 3, label: 'Mars' },
  { value: 4, label: 'Avril' },
  { value: 5, label: 'Mai' },
  { value: 6, label: 'Juin' },
  { value: 7, label: 'Juillet' },
  { value: 8, label: 'Août' },
  { value: 9, label: 'Septembre' },
  { value: 10, label: 'Octobre' },
  { value: 11, label: 'Novembre' },
  { value: 12, label: 'Décembre' },
];

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

function SectorHeader({ sector, isExpanded, onToggle, canPlan, onPlanSector, isPlanningDisabled, plannableCount }) {
  const { codePostal, commune, totalContracts, visitsDone, visitsPending } = sector;
  const completionPct =
    totalContracts > 0 ? Math.round((visitsDone / totalContracts) * 100) : 0;

  return (
    <div className="flex items-center gap-1 bg-white hover:bg-gray-50 transition-colors">
      <button
        onClick={onToggle}
        className="flex-1 flex items-center gap-3 px-4 py-3 text-left min-w-0"
      >
        {/* Chevron */}
        <div className="flex-shrink-0 text-gray-400">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>

        {/* Code postal + commune */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <MapPin className="h-4 w-4 text-blue-500 flex-shrink-0" />
          <span className="font-semibold text-gray-900">{codePostal}</span>
          {commune && (
            <span className="text-sm text-gray-500 truncate">— {commune}</span>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Barre de progression mini */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 w-8 text-right">{completionPct}%</span>
          </div>

          {/* Compteurs */}
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {visitsDone}
            </span>
            <span className="text-gray-300">|</span>
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Clock className="h-3.5 w-3.5" />
              {visitsPending}
            </span>
          </div>

          {/* Badge total */}
          <span className="bg-gray-100 text-gray-600 px-2 py-0.5 text-xs rounded-full font-medium">
            {totalContracts}
          </span>
        </div>
      </button>

      {/* CTA Planifier le secteur */}
      {canPlan && plannableCount > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlanSector?.(sector);
          }}
          disabled={isPlanningDisabled}
          className="mr-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 flex-shrink-0"
          title={`Programmer ${plannableCount} entretien${plannableCount > 1 ? 's' : ''}`}
        >
          <Calendar className="h-3.5 w-3.5" />
          Planifier le secteur ({plannableCount})
        </button>
      )}
    </div>
  );
}

function SectorContracts({
  contracts,
  onContractClick,
  canPlan,
  onPlanContract,
  isPlanningDisabled,
  plannedContractIds,
}) {
  return (
    <div className="bg-gray-50 border-t border-gray-100">
      <div className="divide-y divide-gray-100">
        {contracts.map((contract) => {
          const isAlreadyPlanned = plannedContractIds?.has(contract.id) ?? false;

          // Statut visite : basé sur current_year_visit_status (visite année en cours)
          const visitStatus =
            contract.current_year_visit_status === 'completed'
              ? 'completed'
              : 'pending';

          // Mois de référence
          const monthLabel = contract.maintenance_month
            ? MONTHS.find((m) => m.value === contract.maintenance_month)?.label
            : null;

          return (
            <div
              key={contract.id}
              className={`flex items-center gap-3 px-4 py-2.5 pl-11 transition-colors group ${
                isAlreadyPlanned
                  ? 'opacity-50 bg-gray-50'
                  : 'hover:bg-gray-100'
              }`}
            >
              {/* Nom (cliquable) */}
              <span
                onClick={() => onContractClick?.(contract)}
                className="font-medium text-gray-900 truncate flex-1 min-w-0 cursor-pointer hover:text-blue-600 transition-colors"
              >
                {contract.client_name || 'Sans nom'}
              </span>

              {/* Mois de référence */}
              {monthLabel && (
                <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">
                  {monthLabel}
                </span>
              )}

              {/* Tarif */}
              {contract.amount ? (
                <span className="text-xs font-medium text-blue-700 flex-shrink-0">
                  {new Intl.NumberFormat('fr-FR', {
                    style: 'currency',
                    currency: 'EUR',
                    maximumFractionDigits: 0,
                  }).format(contract.amount)}
                </span>
              ) : null}

              {/* Badge visite */}
              <VisitBadge status={visitStatus} />

              {/* CTA Planifier ou badge "Déjà planifié" */}
              {canPlan && (
                isAlreadyPlanned ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded flex-shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    Planifié
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlanContract?.(contract);
                    }}
                    disabled={isPlanningDisabled}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-all disabled:opacity-50 flex-shrink-0"
                    title="Programmer un entretien"
                  >
                    <Calendar className="h-3 w-3" />
                    Planifier
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function SectorGroupView({
  sectors,
  isLoading,
  onContractClick,
  onPlanContract,
  onPlanSector,
  isPlanningDisabled = false,
  canPlan = false,
  plannedContractIds,
}) {
  const [expandedSectors, setExpandedSectors] = useState(new Set());
  const [selectedMonth, setSelectedMonth] = useState('');

  // Filtrer par mois de référence
  const filteredSectors = useMemo(() => {
    if (!sectors) return [];
    if (!selectedMonth) return sectors;

    const monthValue = parseInt(selectedMonth, 10);

    return sectors
      .map((sector) => {
        const filtered = sector.contracts.filter(
          (c) => c.maintenance_month === monthValue,
        );
        const visitsDone = filtered.filter(
          (c) => c.current_year_visit_status === 'completed',
        ).length;

        return {
          ...sector,
          contracts: filtered,
          totalContracts: filtered.length,
          visitsDone,
          visitsPending: filtered.length - visitsDone,
        };
      })
      .filter((s) => s.contracts.length > 0);
  }, [sectors, selectedMonth]);

  const toggleSector = (codePostal) => {
    setExpandedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(codePostal)) {
        next.delete(codePostal);
      } else {
        next.add(codePostal);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSectors(new Set(filteredSectors.map((s) => s.codePostal)));
  };

  const collapseAll = () => {
    setExpandedSectors(new Set());
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-12 bg-white rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!sectors || sectors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <Map className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-700 font-medium">Aucun secteur trouvé</p>
        <p className="text-sm text-gray-500 mt-1">
          Les contrats seront groupés par code postal ici.
        </p>
      </div>
    );
  }

  // Stats globales (calculées sur les secteurs filtrés)
  const totalContracts = filteredSectors.reduce((s, sec) => s + sec.totalContracts, 0);
  const totalDone = filteredSectors.reduce((s, sec) => s + sec.visitsDone, 0);
  const totalPending = filteredSectors.reduce((s, sec) => s + sec.visitsPending, 0);

  return (
    <div className="space-y-4">
      {/* Header stats + filtre mois + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            <strong>{filteredSectors.length}</strong> secteur
            {filteredSectors.length > 1 ? 's' : ''}
          </span>
          <span className="text-gray-300">|</span>
          <span>
            <strong>{totalContracts}</strong> contrat{totalContracts > 1 ? 's' : ''}
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-green-600">
            <strong>{totalDone}</strong> fait{totalDone > 1 ? 's' : ''}
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-amber-600">
            <strong>{totalPending}</strong> à faire
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Filtre mois de référence */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">Tous les mois</option>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Expand/collapse */}
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="text-xs text-blue-600 hover:underline"
            >
              Tout déplier
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={collapseAll}
              className="text-xs text-blue-600 hover:underline"
            >
              Tout replier
            </button>
          </div>
        </div>
      </div>

      {/* Message si filtre mois actif et aucun résultat */}
      {selectedMonth && filteredSectors.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Calendar className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">
            Aucun contrat avec le mois de référence{' '}
            <strong>{MONTHS.find((m) => m.value === parseInt(selectedMonth))?.label}</strong>
          </p>
        </div>
      )}

      {/* Liste des secteurs */}
      {filteredSectors.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {filteredSectors.map((sector) => {
            const isExpanded = expandedSectors.has(sector.codePostal);
            // Nombre de contrats planifiables (pas encore dans le workflow)
            const plannableCount = sector.contracts.filter(
              (c) => !plannedContractIds?.has(c.id),
            ).length;
            return (
              <div key={sector.codePostal}>
                <SectorHeader
                  sector={sector}
                  isExpanded={isExpanded}
                  onToggle={() => toggleSector(sector.codePostal)}
                  canPlan={canPlan}
                  onPlanSector={onPlanSector}
                  isPlanningDisabled={isPlanningDisabled}
                  plannableCount={plannableCount}
                />
                {isExpanded && (
                  <SectorContracts
                    contracts={sector.contracts}
                    onContractClick={onContractClick}
                    canPlan={canPlan}
                    onPlanContract={onPlanContract}
                    isPlanningDisabled={isPlanningDisabled}
                    plannedContractIds={plannedContractIds}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SectorGroupView;
