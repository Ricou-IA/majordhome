/**
 * SectorGroupView.jsx - Vue contrats groupés par secteur géographique
 * ============================================================================
 * Affiche les contrats groupés par code postal, avec sections dépliables.
 * Chaque secteur montre le nombre de contrats, visites faites/à faire.
 * Tri par nombre de visites à faire (décroissant).
 *
 * @version 2.0.0 - Restyle borders/colors harmonisé
 * @version 1.0.0 - Sprint 5
 * ============================================================================
 */

import { useState } from 'react';
import { MapPin, ChevronDown, ChevronRight, CheckCircle2, Clock, Loader2, Map } from 'lucide-react';
import { CONTRACT_FREQUENCIES } from '@services/contracts.service';
import { VisitBadge } from './VisitBadge';

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

function SectorHeader({ sector, isExpanded, onToggle }) {
  const { codePostal, commune, totalContracts, visitsDone, visitsPending } = sector;
  const completionPct = totalContracts > 0 ? Math.round((visitsDone / totalContracts) * 100) : 0;

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
    >
      {/* Chevron */}
      <div className="flex-shrink-0 text-gray-400">
        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
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
  );
}

function SectorContracts({ contracts, onContractClick }) {
  return (
    <div className="bg-gray-50 border-t border-gray-100">
      <div className="divide-y divide-gray-100">
        {contracts.map((contract) => {
          // Label fréquence
          const freqLabel = CONTRACT_FREQUENCIES.find(f => f.value === contract.frequency)?.label || contract.frequency || '-';
          // Statut visite calculé depuis next_maintenance_date
          const visitStatus = contract.next_maintenance_date && new Date(contract.next_maintenance_date) > new Date()
            ? 'completed'
            : 'pending';

          return (
            <div
              key={contract.id}
              onClick={() => onContractClick?.(contract)}
              className="flex items-center gap-3 px-4 py-2.5 pl-11 hover:bg-gray-100 cursor-pointer transition-colors"
            >
              {/* Nom */}
              <span className="font-medium text-gray-900 truncate flex-1 min-w-0">
                {contract.client_name || 'Sans nom'}
              </span>

              {/* Fréquence */}
              <span className="hidden sm:inline text-xs text-gray-500 truncate max-w-[120px]">
                {freqLabel}
              </span>

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

export function SectorGroupView({ sectors, isLoading, onContractClick }) {
  const [expandedSectors, setExpandedSectors] = useState(new Set());

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
    setExpandedSectors(new Set(sectors.map((s) => s.codePostal)));
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

  // Stats globales
  const totalContracts = sectors.reduce((s, sec) => s + sec.totalContracts, 0);
  const totalDone = sectors.reduce((s, sec) => s + sec.visitsDone, 0);
  const totalPending = sectors.reduce((s, sec) => s + sec.visitsPending, 0);

  return (
    <div className="space-y-4">
      {/* Header stats + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            <strong>{sectors.length}</strong> secteur{sectors.length > 1 ? 's' : ''}
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

      {/* Liste des secteurs */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
        {sectors.map((sector) => {
          const isExpanded = expandedSectors.has(sector.codePostal);
          return (
            <div key={sector.codePostal}>
              <SectorHeader
                sector={sector}
                isExpanded={isExpanded}
                onToggle={() => toggleSector(sector.codePostal)}
              />
              {isExpanded && (
                <SectorContracts
                  contracts={sector.contracts}
                  onContractClick={onContractClick}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SectorGroupView;
