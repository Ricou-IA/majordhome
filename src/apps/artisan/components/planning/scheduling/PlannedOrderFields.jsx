/**
 * PlannedOrderFields.jsx - Majord'home Artisan
 * ============================================================================
 * Saisie de la commande « personnes × jours » d'une installation (chantier) ou
 * d'un SAV (intervention), en tête de la planification. Deux champs numériques
 * inline ; `onChange({ teamSize, days })` au blur (null si vide). Le host
 * persiste (update_majordhome_lead / savService.updateFields).
 *
 * Partagé par ChantierModal et EntretienSAVModal (SAV uniquement).
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { Users, CalendarRange } from 'lucide-react';

const inputClass =
  'w-16 px-2 py-1 border border-gray-300 rounded-md text-sm text-center tabular-nums ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-400';

/** Normalise une saisie : entier ≥ 1 ou null. */
function normaliser(value, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, max);
}

/**
 * @param {Object} props
 * @param {number|null} props.teamSize - personnes par jour (planned_team_size)
 * @param {number|null} props.days - jours (planned_days)
 * @param {Function} props.onChange - ({ teamSize, days }) => void, appelé au blur si la valeur a changé
 * @param {boolean} [props.disabled]
 * @param {string} [props.dayLabel] - libellé de l'unité (défaut « jours » ; SAV : « passages »)
 */
export function PlannedOrderFields({ teamSize = null, days = null, onChange, disabled = false, dayLabel = 'jours' }) {
  const [team, setTeam] = useState(teamSize ?? '');
  const [nbDays, setNbDays] = useState(days ?? '');

  // Resynchronise si la carte change sous les pieds (refetch après sauvegarde).
  useEffect(() => { setTeam(teamSize ?? ''); }, [teamSize]);
  useEffect(() => { setNbDays(days ?? ''); }, [days]);

  const commit = (nextTeam, nextDays) => {
    const t = normaliser(nextTeam, 20);
    const d = normaliser(nextDays, 60);
    setTeam(t ?? '');
    setNbDays(d ?? '');
    if (t !== (teamSize ?? null) || d !== (days ?? null)) onChange?.({ teamSize: t, days: d });
  };

  return (
    <div className="flex items-center gap-4 text-sm text-gray-700">
      <label className="flex items-center gap-1.5">
        <Users className="w-4 h-4 text-gray-400" />
        <input
          type="number"
          min={1}
          max={20}
          inputMode="numeric"
          value={team}
          placeholder="1"
          disabled={disabled}
          onChange={(e) => setTeam(e.target.value)}
          onBlur={() => commit(team, nbDays)}
          className={inputClass}
          aria-label="Personnes par jour"
        />
        <span>pers.</span>
      </label>
      <span className="text-gray-300">×</span>
      <label className="flex items-center gap-1.5">
        <CalendarRange className="w-4 h-4 text-gray-400" />
        <input
          type="number"
          min={1}
          max={60}
          inputMode="numeric"
          value={nbDays}
          placeholder="1"
          disabled={disabled}
          onChange={(e) => setNbDays(e.target.value)}
          onBlur={() => commit(team, nbDays)}
          className={inputClass}
          aria-label={`Nombre de ${dayLabel}`}
        />
        <span>{dayLabel}</span>
      </label>
    </div>
  );
}

export default PlannedOrderFields;
