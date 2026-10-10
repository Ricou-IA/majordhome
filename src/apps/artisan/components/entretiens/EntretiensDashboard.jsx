/**
 * EntretiensDashboard.jsx - Tab Dashboard des entretiens & SAV
 * ============================================================================
 * Affiche les KPIs combinés contrats + workflow SAV :
 *   - Row 1 : CA Entretien, Taux de réalisation, Contrats actifs
 *   - Row 2 : Pipeline SAV (Demandes, Pièces commandées, Devis envoyés)
 *   - Tournées à surveiller : journées à arbitrer + les quatre filets
 *     (sous-remplies, retardataires, non localisés, équipements à typer) —
 *     ex-onglet Tournées, rangé ici (spec auto-RDV 2026-09-29 § 9)
 *   - Planification automatique : tableau du mois + journaux des crons
 *
 * @version 4.0.0 - Sprint 8 Entretien & SAV
 * ============================================================================
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Euro, TrendingUp, FileCheck, Wrench, Package, FileText } from 'lucide-react';
import { formatEuro } from '@/lib/utils';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useContratsDus, useJourneesHorizon } from '@hooks/useTournees';
import { construireReglages } from '@/lib/tournee/reglages.js';
import { PlanificationJournal } from '@/apps/artisan/components/tournees/PlanificationJournal';
import { AutoRdvMois } from '@/apps/artisan/components/tournees/AutoRdvMois';
import { JourneesAArbitrer } from '@/apps/artisan/components/tournees/JourneesAArbitrer';
import { AlertesTournees } from '@/apps/artisan/components/tournees/AlertesTournees';
import { lienJourneePlanning } from '@/apps/artisan/components/tournees/tourneesPanelUtils';
import { ParcSousContrat } from './ParcSousContrat';

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
// SOUS-COMPOSANT : Tournées, à surveiller
// ============================================================================

/**
 * Journées pleines à arbitrer + filets des tournées. Les deux cartes lisent le
 * MÊME horizon (`useJourneesHorizon` par défaut, partagé avec
 * `useJourneesAArbitrer`) : une seule requête. Une journée s'ouvre dans le
 * Planning, un contrat dans sa fiche.
 */
function SurveillanceTournees({ coreOrgId, onOpenContract }) {
  const navigate = useNavigate();
  const { settings } = useOrgSettings();
  const reglages = useMemo(() => construireReglages(settings), [settings]);
  const { data: candidats, error: candidatsError } = useContratsDus(coreOrgId);
  const { data: journees, error: journeesError } = useJourneesHorizon(coreOrgId);

  // Pas de titre de section : quand il n'y a rien à signaler, les deux cartes
  // ne rendent rien — un titre au-dessus du vide se lirait comme un chargement raté.
  return (
    <>
      <JourneesAArbitrer coreOrgId={coreOrgId} />
      <AlertesTournees
        journees={journees}
        candidats={candidats}
        journeesError={journeesError}
        candidatsError={candidatsError}
        onOpenJournee={(j) => navigate(lienJourneePlanning(j))}
        onOpenContract={onOpenContract}
        toleranceAnniversaireMois={reglages.tolerance_anniversaire_mois}
      />
    </>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function EntretiensDashboard({ stats, savStats, isLoading, coreOrgId, onOpenContract }) {
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
            Contrats d&apos;entretien
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

      {/* Parc sous contrat : familles d'intervention × types, composition des contrats */}
      {coreOrgId && <ParcSousContrat coreOrgId={coreOrgId} />}

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

      {/* Ce qui demande un humain : journées à arbitrer et filets des tournées */}
      {coreOrgId && <SurveillanceTournees coreOrgId={coreOrgId} onOpenContract={onOpenContract} />}

      {/* Journal du cron de figeage — ce que la machine a fait, passage par passage */}
      {coreOrgId && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Planification automatique</h2>
          <div className="space-y-4">
            <AutoRdvMois coreOrgId={coreOrgId} />
            <PlanificationJournal coreOrgId={coreOrgId} job="tournees-figer" />
            <PlanificationJournal coreOrgId={coreOrgId} job="auto-rdv-ouverture" />
            <PlanificationJournal coreOrgId={coreOrgId} job="auto-rdv-relances" />
          </div>
        </div>
      )}
    </div>
  );
}
