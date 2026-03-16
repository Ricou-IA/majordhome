/**
 * EntretiensDashboard.jsx - Tab Dashboard des entretiens & SAV
 * ============================================================================
 * Affiche les KPIs combinés contrats + workflow SAV :
 *   - Row 1 : CA Entretien, Taux de réalisation, Contrats actifs
 *   - Row 2 : Pipeline SAV (Demandes, Pièces commandées, Devis envoyés)
 *
 * @version 4.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { Euro, TrendingUp, FileCheck, Wrench, Package, FileText } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

// ============================================================================
// SOUS-COMPOSANT : Info Card (non cliquable)
// ============================================================================

function InfoCard({
  label,
  value,
  icon: Icon,
  color = 'text-blue-600',
  bgColor = 'bg-blue-50',
  suffix = '',
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${bgColor}`}
        >
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500 truncate">{label}</p>
          <p className="text-2xl font-semibold text-gray-900">
            {value}
            {suffix && (
              <span className="text-base font-normal text-gray-500 ml-1">
                {suffix}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function EntretiensDashboard({ stats, savStats, isLoading }) {
  if (isLoading || (!stats && !savStats)) {
    return (
      <div className="space-y-6">
        {/* Skeleton contrats */}
        <div>
          <div className="h-4 bg-gray-200 rounded w-20 mb-3 animate-pulse" />
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-20 bg-white rounded-lg border border-gray-200 animate-pulse"
              />
            ))}
          </div>
        </div>
        {/* Skeleton SAV */}
        <div>
          <div className="h-4 bg-gray-200 rounded w-24 mb-3 animate-pulse" />
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-20 bg-white rounded-lg border border-gray-200 animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Section Contrats */}
      {stats && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Contrats d'entretien
          </h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <InfoCard
              label="CA Entretien"
              value={formatEuro(stats.totalRevenue)}
              icon={Euro}
              color="text-blue-600"
              bgColor="bg-blue-100"
            />
            <InfoCard
              label="Taux de réalisation"
              value={stats.completionRate}
              icon={TrendingUp}
              color="text-emerald-600"
              bgColor="bg-emerald-100"
              suffix="%"
            />
            <InfoCard
              label="Contrats actifs"
              value={stats.openContracts}
              icon={FileCheck}
              color="text-green-600"
              bgColor="bg-green-100"
            />
          </div>
        </div>
      )}

      {/* Section Pipeline SAV */}
      {savStats && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Pipeline SAV
          </h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <InfoCard
              label="Demandes"
              value={savStats.sav_demande ?? 0}
              icon={Wrench}
              color="text-red-600"
              bgColor="bg-red-100"
            />
            <InfoCard
              label="Pièces commandées"
              value={savStats.sav_pieces_commandees ?? 0}
              icon={Package}
              color="text-amber-600"
              bgColor="bg-amber-100"
            />
            <InfoCard
              label="Devis envoyés"
              value={savStats.sav_devis_envoye ?? 0}
              icon={FileText}
              color="text-blue-600"
              bgColor="bg-blue-100"
            />
          </div>
        </div>
      )}
    </div>
  );
}
