/**
 * PlanningDayHeader.jsx - Majord'home Artisan
 * ============================================================================
 * En-tête d'un jour du Planning pour le pilotage (admin d'organisation et team
 * leader) : le jour, le CA HT programmé du jour, puis une ligne par technicien
 * (JourneeEtatChips). Les données viennent de usePlanningCharge.
 * ============================================================================
 */

import { formatCa } from '@/lib/planningCa';
import { JourneeEtatChips } from './JourneeEtatChips';

/**
 * @param {object} props
 * @param {string} props.texte  libellé du jour (FullCalendar)
 * @param {string} props.date   ISO `YYYY-MM-DD`
 * @param {Map<string, object>} props.lignes  lignes de charge (usePlanningCharge)
 * @param {object|null} props.ca       CA programmé (caProgramme) ; null = inconnu
 * @param {Error|null} props.caError
 * @param {boolean} props.filtreEquipe  vrai si le chiffre est la part des personnes affichées
 * @param {(item: object) => void} props.onOpen
 */
export function PlanningDayHeader({ texte, date, lignes, ca, caError, filtreEquipe, onOpen }) {
  const total = ca?.parJour.get(date) || 0;
  const sansMontant = ca?.sansMontantParJour.get(date) || 0;
  return (
    <div className="mdh-day-head flex w-full flex-col items-start">
      <div className="flex w-full items-baseline justify-between gap-2">
        <span>{texte}</span>
        {caError && (
          <span className="font-normal normal-case text-secondary-400" title={`CA HT programmé indisponible (${caError.message || 'échec du chargement'})`}>
            CA indisponible
          </span>
        )}
        {!caError && (total > 0 || sansMontant > 0) && (
          <span
            className="whitespace-nowrap tabular-nums text-secondary-900"
            title={[
              'CA HT programmé : devis validés des installations (au prorata des journées posées) + contrats d’entretien. SAV non compté.',
              filtreEquipe ? 'Part des personnes affichées.' : null,
              sansMontant > 0 ? `${sansMontant} affaire${sansMontant > 1 ? 's' : ''} sans montant, comptée${sansMontant > 1 ? 's' : ''} à 0.` : null,
            ].filter(Boolean).join('\n')}
          >
            {formatCa(total)} HT{sansMontant > 0 ? ' *' : ''}
          </span>
        )}
      </div>
      <JourneeEtatChips
        date={date}
        etats={lignes}
        onOpen={onOpen}
        caParTechnicien={ca?.parTechnicienJour || null}
      />
    </div>
  );
}
