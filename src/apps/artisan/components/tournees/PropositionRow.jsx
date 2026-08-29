/**
 * PropositionRow.jsx - Majord'home Artisan
 * ============================================================================
 * Une ligne candidat dans RemplirJourneePanel : case à cocher + nom, ville,
 * durée, détour, heure de passage prévue (classement initial, trajets
 * Mapbox), badges "hors saison" / "hors fenêtre anniversaire".
 * ============================================================================
 */

import { Clock } from 'lucide-react';
import { Checkbox } from '@components/ui/checkbox';
import { minutesEnHHMM } from './tourneesPanelUtils';

export function PropositionRow({
  proposition, checked, disabled, onToggle, recalculEnsemble = null, onSurvol,
}) {
  const { candidat, detourMinutes, placement } = proposition;
  const meta = candidat.meta || {};
  // I3 — `placement` suppose CE candidat seul ajouté à la tournée : dès que ≥2
  // candidats sont cochés (RemplirJourneePanel passe alors `recalculEnsemble`),
  // cette hypothèse est fausse pour toutes les lignes en même temps, et les
  // afficher produirait des heures mutuellement incompatibles sans le dire. On
  // bascule sur le recalcul d'ENSEMBLE, en n'affichant l'heure que pour les
  // lignes qu'il couvre réellement (les cochées) — une ligne non cochée
  // n'affiche alors plus rien plutôt qu'une estimation solo devenue caduque, et
  // un candidat que l'ensemble ne place plus n'affiche pas d'heure du tout.
  const passage = recalculEnsemble
    ? recalculEnsemble.planning?.find((p) => p.id === candidat.id)
    : placement;
  const horsSaison = meta.eligibilite?.saisonDefavorable === true;
  // "Hors fenêtre anniversaire" ne veut dire quelque chose que pour un contrat
  // qui A une date anniversaire : sans elle, l'éligibilité par défaut porte
  // dansTolerance=false pour tous, ce qui afficherait le badge à tort.
  const horsFenetre = meta.moisAnniversaire != null && meta.eligibilite
    && meta.eligibilite.dansTolerance === false;

  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:border-blue-200 transition-colors"
      onMouseEnter={() => onSurvol?.(candidat.id)}
      onMouseLeave={() => onSurvol?.(null)}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} disabled={disabled} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-gray-900 truncate">{meta.clientName || 'Client'}</p>
          <span className="text-xs text-gray-400 flex-shrink-0">+{Math.round(detourMinutes)} min</span>
        </div>
        <p className="text-sm text-gray-500">
          {meta.ville || '—'} · {candidat.dureeMinutes} min d&apos;intervention
        </p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {passage && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Clock className="h-3 w-3" />
              passage prévu {minutesEnHHMM(passage.arriveeMinutes)}
              {/* Le détour et l'heure de passage ne mesurent pas la même chose :
                  un client tout proche peut être repoussé l'après-midi parce
                  qu'y aller tout de suite supprimerait la pause déjeuner. Non
                  dit, cela se lit comme une incohérence du classement. */}
              {passage.attenteMinutes > 0 && (
                <span className="text-gray-400">· après la pause</span>
              )}
            </span>
          )}
          {horsSaison && (
            <span className="inline-flex items-center rounded-full font-medium px-2 py-0.5 text-xs bg-amber-100 text-amber-800">
              Hors saison
            </span>
          )}
          {horsFenetre && (
            <span className="inline-flex items-center rounded-full font-medium px-2 py-0.5 text-xs bg-gray-100 text-gray-600">
              Hors fenêtre anniversaire
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export default PropositionRow;
