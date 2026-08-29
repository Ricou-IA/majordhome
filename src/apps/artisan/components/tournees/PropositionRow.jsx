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

/**
 * @param {object} props
 * @param {object|null} props.passage  heure de passage à afficher — calculée
 *   par `useJourneePose.heureDe`, source UNIQUE partagée avec la barre. La
 *   ligne ne la dérive plus elle-même : elle le faisait depuis le `placement`
 *   du classement, un autre contexte de calcul, et l'heure changeait de
 *   quelques minutes entre le survol et le clic.
 */
export function PropositionRow({
  proposition, checked, disabled, onToggle, onSurvol, passage,
}) {
  const { candidat, detourMinutes } = proposition;
  const meta = candidat.meta || {};
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
