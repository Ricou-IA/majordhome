/**
 * RemplirJourneePanel.jsx - Majord'home Artisan
 * ============================================================================
 * Slide-over : propose les contrats dus qui coûtent le moins de trajet à
 * insérer dans la journée d'un technicien, et pose les RDV en un geste.
 *
 * Deux états à ne jamais confondre (cf. usePropositions) :
 *   - liste vide → aucun candidat ne trouve sa place ; `raisonsRejet` dit
 *     POURQUOI (plus de trou, budget, pause, client non géolocalisé). Jamais
 *     un « aucun entretien » sec qui laisse deviner.
 *   - liste non vide → le classement, à cocher.
 *
 * ⚠️ Il n'y a plus d'état « journée en dépassement » : une journée déjà posée
 * n'est pas une hypothèse à valider, elle a lieu (cf. creneaux.js). L'ancien
 * modèle la déclarait infaisable dès que ses RDV ne respectaient pas NOS
 * estimations de trajet, et l'écran refusait alors tout en bloc — sur le 31/08
 * réel, 2 h 30 annoncées libres et rien de possible.
 *
 * `estime: true` → au moins une durée de trajet de la MATRICE (utilisée pour
 * le classement initial) est approximative (Mapbox indisponible/hors quota) —
 * bandeau ambre obligatoire, jamais masqué.
 *
 * La sélection, l'aperçu en direct et le calcul des trajets réels au moment
 * de la pose (chaînage `ensureEntretienCard` -> `savService.scheduleEntretien`,
 * seule voie canonique de création carte<->RDV du projet) vivent dans le hook
 * `useJourneePose` — ce composant ne fait que l'orchestration d'affichage.
 *
 * ⚠️ DÉCALAGE MANUEL (useDecalagesJournee) : le moteur ne déplace jamais un RDV
 * posé — sa fenêtre reste ponctuelle. Un HUMAIN, lui, peut en pousser un sur la
 * barre pour faire de la place. Trois conséquences à ne pas perdre de vue :
 *   1. c'est `journeeAjustee` (et elle seule) qui alimente `usePropositions`,
 *      `construireArretsExistants` et `useJourneePose` — la journée d'origine
 *      classerait les candidats pour un planning qui n'existe plus à l'écran ;
 *   2. rien n'est écrit avant la pose, et le panneau doit le dire : fermer
 *      annule tout ;
 *   3. à la pose, les décalages partent en base AVANT les créations, et un
 *      échec de déplacement ANNULE la pose (les créneaux des nouveaux RDV
 *      supposent que les anciens ont bougé).
 * ============================================================================
 */

import { useMemo } from 'react';
import { X, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
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
import { JourneeTimeline } from './JourneeTimeline';
import { useJourneePose } from './useJourneePose';
import { useDecalagesJournee } from './useDecalagesJournee';
import { RAISON_LABELS, minutesEnHHMM, formatDuree } from './tourneesPanelUtils';

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

  // Décalages manuels des RDV déjà posés. `journeeAjustee` DOIT alimenter tout
  // ce qui suit : proposer les candidats sur la journée d'origine les
  // classerait pour un planning que l'utilisateur vient de changer sous ses yeux.
  const {
    decalages, journeeAjustee, decaler, reinitialiser, retirerDecalages,
  } = useDecalagesJournee(journee);

  const { data, isLoading, isError, error } = usePropositions({
    journee: journeeAjustee, candidats, coreOrgId, settings,
  });

  const depot = useMemo(() => getOrgHeadquarters(settings), [settings]);
  const reglages = useMemo(() => construireReglages(settings), [settings]);
  const propositions = data?.propositions;

  // Raison la plus fréquente parmi les candidats écartés : ce qu'il faut dire
  // quand la liste est vide, plutôt que de laisser croire qu'il n'y a personne
  // à visiter dans le secteur.
  const motifDominant = useMemo(() => {
    const entrees = Object.entries(data?.raisonsRejet || {});
    if (entrees.length === 0) return null;
    return entrees.sort((a, b) => b[1] - a[1])[0][0];
  }, [data]);

  // Arrêts déjà posés ce jour — helper partagé avec tournees.service.js (C2,
  // revue finale) pour que les DEUX endroits qui construisent "les arrêts
  // existants" restent identiques par construction, fenêtre comprise, plutôt
  // que par discipline de copier-coller.
  const arretsExistants = useMemo(
    () => construireArretsExistants(journeeAjustee?.rdvs, depot),
    [journeeAjustee, depot],
  );

  const {
    selectedIds, toggleSelection, recalcul, calculatingReel, posing, resultatPose,
    confirmOpen, handlePoserClick, handleConfirmApprox, handleCancelApprox,
    confirmEstime,
  } = useJourneePose({
    journee: journeeAjustee, depot, reglages, arretsExistants, propositions,
    coreOrgId, user, onClose, decalages, retirerDecalages,
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

        {/* La journée telle qu'elle est. C'est ici qu'on voit où il reste de la
            place — et qu'on peut pousser un RDV pour en faire. */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-gray-600">
              Journée actuelle
              {/* Rien à glisser sur une journée vide : la consigne ne s'affiche
                  que quand elle a un objet. */}
              {journeeAjustee.rdvs?.length > 0 && (
                <span className="text-gray-400 font-normal"> · glisser un RDV pour le décaler</span>
              )}
            </p>
            {decalages.size > 0 && (
              <button
                type="button"
                onClick={reinitialiser}
                disabled={posing || calculatingReel}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                Annuler les déplacements
              </button>
            )}
          </div>
          <JourneeTimeline
            amplitude={journee.amplitude}
            rdvs={journeeAjustee.rdvs}
            onDecaler={posing || calculatingReel ? undefined : decaler}
          />
          {/* Un déplacement en attente n'est PAS encore en base : le dire, sinon
              on croit le planning déjà changé et on ferme le panneau. */}
          {decalages.size > 0 && (
            <p className="text-xs text-emerald-700 mt-1">
              {decalages.size} RDV déplacé{decalages.size > 1 ? 's' : ''} (
              {[...decalages.values()].map((d) => (d > 0 ? `+${formatDuree(d)}` : formatDuree(d))).join(', ')}
              ) — appliqué{decalages.size > 1 ? 's' : ''} seulement à la pose.
            </p>
          )}
        </div>

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
          ) : !propositions || propositions.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              <p>Aucun entretien à proposer sur cette journée.</p>
              {/* Le motif dominant, pas un silence : « plus de trou » et
                  « budget atteint » n'appellent pas la même réaction — et
                  décaler un RDV peut débloquer le premier. */}
              {motifDominant && (
                <p className="mt-1 text-xs text-gray-400">
                  Motif principal : {RAISON_LABELS[motifDominant] || motifDominant}.
                </p>
              )}
            </div>
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
                {/* Un candidat coché que l'ensemble ne place plus n'est pas une
                    erreur globale : les autres tiennent toujours. On nomme
                    celui qui saute plutôt que d'annuler tout le panneau. */}
                {recalcul.refuses.length > 0 && (
                  <p className="text-amber-700">
                    {recalcul.refuses.length === 1
                      ? `${recalcul.refuses[0].candidat.meta?.clientName || 'Un client'} ne rentre plus`
                      : `${recalcul.refuses.length} clients ne rentrent plus`}
                    {' '}— {RAISON_LABELS[recalcul.refuses[0].raison] || recalcul.refuses[0].raison}.
                  </p>
                )}
                {recalcul.places.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span>Fin de journée</span>
                      <span className="font-medium">
                        {recalcul.finMinutes == null ? '—' : minutesEnHHMM(recalcul.finMinutes)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Charge / budget</span>
                      <span className="font-medium">
                        {formatDuree(recalcul.chargeMinutes)} / {formatDuree(journee.budgetMinutes)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      Aperçu local, distances estimées à vol d&apos;oiseau.
                      Les horaires réels sont recalculés à la pose.
                    </p>
                  </>
                )}
              </div>
            )}

            {resultatPose && resultatPose.echecs.length > 0 && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                {resultatPose.posesCount} posé{resultatPose.posesCount > 1 ? 's' : ''} sur{' '}
                {resultatPose.posesCount + resultatPose.echecs.length}.
                {/* Un RDV déplacé l'est POUR DE BON, même si la pose a échoué
                    ensuite : le taire laisserait croire le planning intact. */}
                {resultatPose.decalesCount > 0 && (
                  <> {resultatPose.decalesCount} RDV déjà déplacé{resultatPose.decalesCount > 1 ? 's' : ''} en base.</>
                )}
                {' '}Échec : {resultatPose.echecs.map((e) => `${e.nom} (${e.message})`).join(' · ')}
              </div>
            )}

            {!canCreer && (
              <p className="text-xs text-amber-700">Droit requis pour planifier des entretiens.</p>
            )}

            <Button
              className="w-full"
              disabled={
                selectedIds.size === 0 || posing || calculatingReel || !canCreer
                || (recalcul && recalcul.places.length === 0)
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
                `Poser ${recalcul?.places.length ?? selectedIds.size} rendez-vous${decalages.size > 0 ? ` et décaler ${decalages.size} RDV` : ''}`
              )}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => { if (!open) handleCancelApprox(); }}
        title={decalages.size > 0 ? 'Déplacer des rendez-vous existants ?' : 'Horaires approximatifs'}
        description={[
          // Le déplacement passe en premier : c'est la conséquence la plus
          // lourde des deux — une heure déjà annoncée à un client change.
          decalages.size > 0
            ? `${decalages.size} rendez-vous déjà planifié${decalages.size > 1 ? 's seront déplacés' : ' sera déplacé'} pour libérer le créneau. `
              + 'Leur horaire a pu être annoncé aux clients concernés.'
            : null,
          confirmEstime
            ? "Les distances réelles entre ces rendez-vous n'ont pas pu être confirmées (Mapbox indisponible ou hors quota) : les horaires posés seront estimés et peuvent varier une fois sur place."
            : null,
        ].filter(Boolean).join(' ')}
        confirmLabel={decalages.size > 0 ? 'Déplacer et poser' : 'Poser quand même'}
        cancelLabel="Annuler"
        variant="default"
        onConfirm={handleConfirmApprox}
        loading={posing}
      />
    </>
  );
}

export default RemplirJourneePanel;
