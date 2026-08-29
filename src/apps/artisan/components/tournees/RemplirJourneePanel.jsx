/**
 * RemplirJourneePanel.jsx - Majord'home Artisan
 * ============================================================================
 * Slide-over : propose les contrats dus qui coûtent le moins de trajet à
 * insérer dans la journée d'un technicien, et pose les RDV en un geste.
 *
 * Trois états à ne jamais confondre (cf. usePropositions) :
 *   - `baseInfaisable: true`  → la journée est DÉJÀ en dépassement (budget,
 *     amplitude ou fenêtre) avant tout ajout. Jamais "aucun entretien".
 *   - `baseInfaisable: false` + liste vide → aucun entretien à proximité.
 *   - liste non vide → le classement, à cocher.
 *
 * `estime: true` → au moins une durée de trajet de la MATRICE (utilisée pour
 * le classement initial) est approximative (Mapbox indisponible/hors quota) —
 * bandeau ambre obligatoire, jamais masqué.
 *
 * La sélection, l'aperçu en direct et le calcul des trajets réels au moment
 * de la pose (chaînage `ensureEntretienCard` -> `savService.scheduleEntretien`,
 * seule voie canonique de création carte<->RDV du projet) vivent dans le hook
 * `useJourneePose` — ce composant ne fait que l'orchestration d'affichage.
 * ============================================================================
 */

import { useMemo } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useCanAccess } from '@hooks/usePermissions';
import { usePropositions } from '@hooks/useTournees';
import { construireReglages } from '@services/tournees.service';
import { getOrgHeadquarters } from '@lib/territoire-config';
import { construireArretsExistants } from '@/lib/tournee/arrets.js';
import { formatDateFR } from '@/lib/utils';
import { Button } from '@components/ui/button';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { PropositionRow } from './PropositionRow';
import { useJourneePose } from './useJourneePose';
import { RAISON_LABELS, minutesEnHHMM } from './tourneesPanelUtils';

/**
 * @param {object} props
 * @param {object} props.journee    Journee (cf. tournees.service.js)
 * @param {Array|undefined} props.candidats  data de useContratsDus (peut être undefined pendant le chargement)
 * @param {Error|null} [props.candidatsError]  error de useContratsDus — undefined ET pas d'erreur = encore en chargement
 * @param {Function} props.onClose
 */
export function RemplirJourneePanel({
  journee, candidats, candidatsError, onClose,
}) {
  const { organization, user } = useAuth();
  const coreOrgId = organization?.id;
  const { settings } = useOrgSettings();
  const { can } = useCanAccess();
  const canCreer = can('entretiens', 'create');

  const candidatsIndisponibles = candidats === undefined;

  const { data, isLoading, isError, error } = usePropositions({
    journee, candidats, coreOrgId, settings,
  });

  const depot = useMemo(() => getOrgHeadquarters(settings), [settings]);
  const reglages = useMemo(() => construireReglages(settings), [settings]);
  const propositions = data?.propositions;

  // Arrêts déjà posés ce jour — helper partagé avec tournees.service.js (C2,
  // revue finale) pour que les DEUX endroits qui construisent "les arrêts
  // existants" restent identiques par construction, fenêtre comprise, plutôt
  // que par discipline de copier-coller.
  const arretsExistants = useMemo(
    () => construireArretsExistants(journee?.rdvs, depot),
    [journee, depot],
  );

  const {
    selectedIds, toggleSelection, recalcul, calculatingReel, posing, resultatPose,
    confirmOpen, handlePoserClick, handleConfirmApprox, handleCancelApprox,
  } = useJourneePose({
    journee, depot, reglages, arretsExistants, propositions, coreOrgId, user, onClose,
  });

  if (!journee) return null;

  const afficherChargement = (candidatsIndisponibles && !candidatsError) || isLoading;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 truncate">{journee.technicienNom}</h3>
            <p className="text-sm text-gray-500">{formatDateFR(journee.date)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Bandeau estimation — toujours visible dès que vrai, quel que soit l'état ci-dessous */}
        {data?.estime && (
          <div className="mx-5 mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>Temps de trajet estimés (Mapbox indisponible) — les horaires peuvent varier.</p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {candidatsError ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
              Erreur de chargement des contrats dus : {candidatsError?.message || 'échec inconnu'}
            </div>
          ) : afficherChargement ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Calcul des trajets…</p>
            </div>
          ) : isError ? (
            error?.message === 'siege_non_configure' ? (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-4">
                Configurez le siège dans <strong>Réglages → Organisation → Territoire</strong> pour
                activer le calcul des trajets.
              </div>
            ) : (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
                Erreur de calcul : {error?.message || 'échec inconnu'}
              </div>
            )
          ) : data?.baseInfaisable ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
              Cette journée est déjà en dépassement — {RAISON_LABELS[data.raisonBase] || data.raisonBase || 'raison inconnue'}.
            </div>
          ) : !propositions || propositions.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">Aucun entretien à proposer à proximité.</p>
          ) : (
            <ul className="space-y-2">
              {propositions.map((p) => (
                <PropositionRow
                  key={p.candidat.id}
                  proposition={p}
                  checked={selectedIds.has(p.candidat.id)}
                  disabled={posing || calculatingReel}
                  onToggle={() => toggleSelection(p.candidat.id)}
                  // I3 — dès que ≥2 candidats sont cochés, l'heure de passage
                  // calculée pour CHAQUE ligne à la proposition initiale (en
                  // supposant CE candidat seul ajouté) devient mutuellement
                  // incompatible avec les autres lignes cochées. Au-delà d'1
                  // sélection, on fournit le recalcul d'ENSEMBLE (aperçu local
                  // déjà affiché au pied de panneau) : PropositionRow n'affiche
                  // alors l'heure que pour les lignes qu'il y retrouve
                  // (cochées), jamais l'estimation solo devenue caduque.
                  recalculEnsemble={selectedIds.size >= 2 ? recalcul : null}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer récapitulatif + action */}
        {propositions?.length > 0 && (
          <div className="border-t border-gray-200 bg-gray-50 px-5 py-4 space-y-3">
            {selectedIds.size > 0 && recalcul && (
              <div className="text-sm text-gray-700 space-y-1">
                {!recalcul.faisable ? (
                  <p className="text-red-700 font-medium">
                    Sélection impossible — {RAISON_LABELS[recalcul.raison] || recalcul.raison}.
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span>Fin de journée</span>
                      <span className="font-medium">{minutesEnHHMM(recalcul.finMinutes)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Charge / budget</span>
                      <span className="font-medium">{recalcul.chargeMinutes} / {journee.budgetMinutes} min</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Aperçu local, distances estimées à vol d&apos;oiseau
                      {recalcul.methode === 'heuristique' ? ' · ordre approché (plus de 8 arrêts)' : ''}.
                      Les horaires réels sont recalculés à la pose.
                    </p>
                  </>
                )}
              </div>
            )}

            {resultatPose && resultatPose.echecs.length > 0 && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                {resultatPose.posesCount} posé{resultatPose.posesCount > 1 ? 's' : ''} sur{' '}
                {resultatPose.posesCount + resultatPose.echecs.length}. Échec :{' '}
                {resultatPose.echecs.map((e) => `${e.nom} (${e.message})`).join(' · ')}
              </div>
            )}

            {!canCreer && (
              <p className="text-xs text-amber-700">Droit requis pour planifier des entretiens.</p>
            )}

            <Button
              className="w-full"
              disabled={
                selectedIds.size === 0 || posing || calculatingReel || !canCreer
                || (recalcul && !recalcul.faisable)
              }
              onClick={handlePoserClick}
            >
              {calculatingReel ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Vérification des trajets…
                </>
              ) : posing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Pose en cours…
                </>
              ) : (
                `Poser ${selectedIds.size} rendez-vous`
              )}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => { if (!open) handleCancelApprox(); }}
        title="Horaires approximatifs"
        description="Les distances réelles entre ces rendez-vous n'ont pas pu être confirmées (Mapbox indisponible ou hors quota). Les rendez-vous seront posés avec des horaires estimés, qui peuvent varier une fois sur place."
        confirmLabel="Poser quand même"
        cancelLabel="Annuler"
        variant="default"
        onConfirm={handleConfirmApprox}
        loading={posing}
      />
    </>
  );
}

export default RemplirJourneePanel;
