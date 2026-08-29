/**
 * TourneesTab.jsx - Majord'home Artisan
 * ============================================================================
 * Onglet "Tournées" du module Entretiens & SAV : sur une journée creuse d'un
 * technicien, propose les entretiens dus qui coûtent le moins de trajet à
 * insérer. Le critère n'est pas la zone géographique mais le coût marginal en
 * minutes (cf. src/lib/tournee/insertion.js).
 *
 * Structure :
 *   - AlertesTournees (montée en tête) : les trois filets (sous-remplies,
 *     retardataires, équipements à typer).
 *   - Bandeau : nombre de contrats dus, nombre de journées ouvertes,
 *     avertissement si le siège n'est pas configuré.
 *   - Liste des journées de l'horizon, groupées en 2 sections : horizon ferme
 *     (toutes) et au-delà (uniquement les journées déjà amorcées, spec §3.2).
 *   - Clic sur une carte → RemplirJourneePanel (proposition + pose des RDV).
 *
 * ⚠️ Les compteurs (bandeau) et les listes ne doivent JAMAIS afficher un
 * nombre/une liste quand la donnée est en erreur : `useContratsDus` comme
 * `useJourneesHorizon` sont consommés avec leur `isError`/`error`, jamais
 * juste `data` — un échec réel ne doit jamais se lire comme "0".
 *
 * `selectedJournee` n'est PAS stocké comme un objet capturé au clic : il est
 * DÉRIVÉ à chaque rendu de la liste vivante `journees` (par clé date+tech).
 * Ainsi, après une pose (les caches tournees/appointments/interventions sont
 * invalidés par RemplirJourneePanel), la journée rouverte pour un nouvel
 * essai reflète la charge à jour — jamais l'état capturé avant la pose.
 *
 * Spec : docs/superpowers/specs/2026-08-29-optimisation-tournees-entretiens-design.md
 * ============================================================================
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Users, CalendarDays } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useContratsDus, useJourneesHorizon } from '@hooks/useTournees';
import { construireReglages } from '@services/tournees.service';
import { getOrgHeadquarters } from '@lib/territoire-config';
import { formatDateFR } from '@/lib/utils';
import { ContractModal } from '@apps/artisan/components/entretiens/ContractModal';
import { AlertesTournees } from './AlertesTournees';
import { RemplirJourneePanel } from './RemplirJourneePanel';

// Marge de recherche des journées déjà amorcées AU-DELÀ de l'horizon ferme
// (spec §3.2). La fenêtre chargée = horizon_ferme_jours + cette marge, JAMAIS
// une constante figée indépendante du réglage (Finding C, fix round 2) :
// avec un JOURS_HORIZON fixe à 45, une org qui aurait réglé horizon_ferme_jours
// au-delà de 45 aurait vu sa propre section "horizon ferme" silencieusement
// tronquée (journées au-delà de J+45 jamais chargées, donc jamais visibles,
// alors qu'elles font pourtant partie de l'horizon ferme promis).
const MARGE_AMORCEE_JOURS = 30;

// ============================================================================
// SOUS-COMPOSANTS
// ============================================================================

/** Valeur du bandeau : chargement (…), erreur (— rouge) ou nombre — jamais un 0 sur échec. */
function StatValue({ isLoading, isError, value }) {
  if (isLoading) return <span className="text-xl font-semibold text-gray-900">…</span>;
  if (isError) return <span className="text-xl font-semibold text-red-600" title="Erreur de chargement">—</span>;
  return <span className="text-xl font-semibold text-gray-900">{value}</span>;
}

function JourneeCard({ journee, onClick }) {
  const pct = journee.budgetMinutes > 0
    ? Math.min(100, Math.round((journee.chargeMinutes / journee.budgetMinutes) * 100))
    : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-500">{formatDateFR(journee.date)}</span>
        {journee.estAmorcee && (
          <span className="inline-flex items-center rounded-full font-medium px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800 flex-shrink-0">
            Amorcée
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: journee.couleur || '#94A3B8' }}
        />
        <span className="font-semibold text-gray-900 truncate">{journee.technicienNom}</span>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>{journee.chargeMinutes} / {journee.budgetMinutes} min</span>
          <span>{journee.rdvs.length} RDV</span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </button>
  );
}

function SectionJournees({ title, journees, onOpen, emptyLabel }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
        {title} <span className="text-gray-400 font-normal normal-case">({journees.length})</span>
      </h3>
      {journees.length === 0 ? (
        <p className="text-sm text-gray-400 italic">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {journees.map((j) => (
            <JourneeCard key={`${j.date}-${j.technicienId}`} journee={j} onClick={() => onOpen(j)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function TourneesTab() {
  const { organization } = useAuth();
  const coreOrgId = organization?.id;
  const { settings, isLoading: settingsLoading } = useOrgSettings();

  const reglages = useMemo(() => construireReglages(settings), [settings]);
  const depot = useMemo(() => getOrgHeadquarters(settings), [settings]);

  const {
    data: candidats, isLoading: candidatsLoading, isError: candidatsIsError, error: candidatsError,
  } = useContratsDus(coreOrgId);
  const {
    data: journees, isLoading: journeesLoading, isError: journeesIsError, error: journeesError,
  } = useJourneesHorizon(coreOrgId, reglages.horizon_ferme_jours + MARGE_AMORCEE_JOURS);

  // Clé (date + technicienId), pas l'objet Journee lui-même : la journée
  // affichée est dérivée en direct de `journees` à chaque rendu (cf. bloc de
  // tête), pour ne jamais retenter sur une charge/RDV périmés après une pose.
  const [selectedJourneeKey, setSelectedJourneeKey] = useState(null);
  const [selectedContractId, setSelectedContractId] = useState(null);

  const selectedJournee = useMemo(() => {
    if (!selectedJourneeKey || !journees) return null;
    return journees.find(
      (j) => j.date === selectedJourneeKey.date && j.technicienId === selectedJourneeKey.technicienId,
    ) || null;
  }, [selectedJourneeKey, journees]);

  const ouvrirJournee = (j) => setSelectedJourneeKey({ date: j.date, technicienId: j.technicienId });

  // Filtrage impératif (spec §3.2) : au-delà de l'horizon ferme, seules les
  // journées déjà amorcées sont proposables — getJourneesHorizon ne filtre
  // pas lui-même, c'est à l'écran de le faire (cf. task-11-report.md).
  const { joursFermes, joursAmorces, totalVisibles } = useMemo(() => {
    if (!journees) return { joursFermes: [], joursAmorces: [], totalVisibles: 0 };

    const limiteFerme = new Date();
    limiteFerme.setDate(limiteFerme.getDate() + reglages.horizon_ferme_jours);
    const limite = limiteFerme.toISOString().slice(0, 10);

    const journeesVisibles = (journees || []).filter(
      (j) => j.date <= limite || j.estAmorcee,
    );
    const tri = (a, b) => a.date.localeCompare(b.date) || a.technicienNom.localeCompare(b.technicienNom);

    return {
      joursFermes: journeesVisibles.filter((j) => j.date <= limite).sort(tri),
      joursAmorces: journeesVisibles.filter((j) => j.date > limite).sort(tri),
      totalVisibles: journeesVisibles.length,
    };
  }, [journees, reglages.horizon_ferme_jours]);

  return (
    <div className="space-y-6">
      <AlertesTournees
        journees={journees}
        candidats={candidats}
        journeesError={journeesError}
        candidatsError={candidatsError}
        onOpenJournee={ouvrirJournee}
        onOpenContract={setSelectedContractId}
        toleranceAnniversaireMois={reglages.tolerance_anniversaire_mois}
      />

      {/* Bandeau de tête */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-gray-400" />
          <div>
            <StatValue isLoading={candidatsLoading} isError={candidatsIsError} value={candidats?.length ?? 0} />
            <span className="text-sm text-gray-500 ml-2">contrats dus</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-gray-400" />
          <div>
            <StatValue isLoading={journeesLoading} isError={journeesIsError} value={totalVisibles} />
            <span className="text-sm text-gray-500 ml-2">journées ouvertes</span>
          </div>
        </div>
      </div>

      {!settingsLoading && !depot && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5" />
          <p>
            Configurez le siège dans <strong>Réglages → Organisation → Territoire</strong> pour
            activer le calcul des trajets. Sans siège, aucune proposition de tournée n&apos;est possible.
          </p>
        </div>
      )}

      {candidatsIsError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          Erreur de chargement des contrats dus : {candidatsError?.message || 'échec inconnu'}
        </div>
      )}

      {journeesLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Chargement des journées…</span>
        </div>
      ) : journeesIsError ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
          Erreur de chargement des journées : {journeesError?.message || 'échec inconnu'}
        </div>
      ) : (
        <div className="space-y-8">
          <SectionJournees
            title={`Horizon ferme (${reglages.horizon_ferme_jours} jours)`}
            journees={joursFermes}
            onOpen={ouvrirJournee}
            emptyLabel="Aucune journée dans l'horizon ferme."
          />
          {joursAmorces.length > 0 && (
            <SectionJournees
              title="Au-delà — journées déjà amorcées"
              journees={joursAmorces}
              onOpen={ouvrirJournee}
              emptyLabel=""
            />
          )}
        </div>
      )}

      {selectedJournee && (
        <RemplirJourneePanel
          journee={selectedJournee}
          candidats={candidats}
          candidatsError={candidatsError}
          onClose={() => setSelectedJourneeKey(null)}
        />
      )}

      <ContractModal
        contractId={selectedContractId}
        isOpen={!!selectedContractId}
        onClose={() => setSelectedContractId(null)}
      />
    </div>
  );
}

export default TourneesTab;
