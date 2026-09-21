/**
 * ChantierInterventionSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section installation dans la modale chantier.
 * Liste les jours d'installation (appointments `installation` liés au chantier)
 * + bouton de planification (ouvre l'assistant créneaux côté ChantierModal).
 *
 * Bloc B stage 4 : les jours d'install sont des appointments (plus de slots
 * intervention enfants ni d'« intervention parent »).
 *
 * @version 2.0.0 - Bloc B stage 4 (convergence chantier → appointments)
 * ============================================================================
 */

import { useMemo } from 'react';
import { CalendarDays, Plus, Trash2, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { etatCommande, libelleCommande } from '@/lib/installOrder';

const INACTIVE_STATUSES = new Set(['cancelled', 'no_show']);

/**
 * Journées d'installation actives, dans l'ordre chronologique.
 * Source unique = `appointments` (aucun champ dénormalisé) : le badge « J i/N »
 * suit donc les ajouts après coup (« Programmer une suite », EventModal).
 * Le hook `useChantierAppointments` filtre/trie déjà — on le refait ici pour ne
 * pas dépendre d'un contrat implicite du caller.
 */
function orderInstallationDays(appointments) {
  return appointments
    .filter(
      (apt) =>
        apt.appointment_type === 'installation' && !INACTIVE_STATUSES.has(apt.status)
    )
    .sort(
      (a, b) =>
        (a.scheduled_date || '').localeCompare(b.scheduled_date || '') ||
        (a.scheduled_start || '').localeCompare(b.scheduled_start || '')
    );
}

/**
 * @param {Object} props
 * @param {Array} props.appointments - appointments `installation` du chantier (via useChantierAppointments)
 * @param {Function} props.onSchedule - () => void (ouvre l'assistant de planification)
 * @param {Function} props.onDeleteAppointment - (appointmentId) => Promise (throw en cas d'erreur)
 * @param {boolean} props.disabled
 * @param {{teamSize?: number|null, days?: number|null}} [props.plannedOrder] - commande
 *   « personnes × jours » du chantier (planned_team_size / planned_days). NULL = le badge
 *   J i/N compte les RDV comme avant.
 */
export function ChantierInterventionSection({
  appointments = [],
  onSchedule,
  onDeleteAppointment,
  disabled = false,
  plannedOrder = { teamSize: null, days: null },
}) {
  const installationDays = useMemo(() => orderInstallationDays(appointments), [appointments]);
  // Commande renseignée → N = jours commandés ; sinon N = jours posés (comportement historique).
  const commande = useMemo(() => etatCommande(plannedOrder, installationDays), [plannedOrder, installationDays]);
  const totalDays = plannedOrder?.days ?? installationDays.length;
  const libelle = libelleCommande(plannedOrder);

  const handleDelete = async (appointmentId) => {
    try {
      await onDeleteAppointment(appointmentId);
      toast.success('Jour supprimé');
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <CalendarDays className="w-4 h-4" />
        Installation
        {libelle && (
          <span className="normal-case tracking-normal font-medium text-xs text-gray-500">
            · commande {libelle}
          </span>
        )}
      </h3>

      {/* Commande incomplète : on prévient (le planning reste modifiable), sans bloquer */}
      {!commande.complete && appointments.length > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {commande.message}
        </p>
      )}

      {appointments.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-1">Aucun jour d&apos;installation planifié</p>
      ) : (
        <div className="space-y-2">
          {appointments.map((apt) => {
            const dayIndex = installationDays.indexOf(apt);
            return (
              <AppointmentRow
                key={apt.id}
                apt={apt}
                dayLabel={
                  totalDays > 1 && dayIndex !== -1 ? `J${dayIndex + 1}/${totalDays}` : null
                }
                teamSize={plannedOrder?.teamSize ?? null}
                onDelete={() => handleDelete(apt.id)}
                disabled={disabled}
              />
            );
          })}
        </div>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={onSchedule}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Planifier l&apos;installation
        </button>
      )}
    </div>
  );
}

/**
 * Ligne d'un jour d'installation (appointment)
 */
function AppointmentRow({ apt, dayLabel, teamSize = null, onDelete, disabled }) {
  // Personnes posées sur ce jour (technician_ids mergés par useChantierAppointments)
  const personnes = apt.technician_ids?.length ?? null;
  const sousEffectif = teamSize && personnes != null && personnes < teamSize;
  const dateStr = apt.scheduled_date
    ? new Date(apt.scheduled_date + 'T00:00:00').toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : '—';

  const timeStr =
    apt.scheduled_start && apt.scheduled_end
      ? `${apt.scheduled_start.slice(0, 5)} – ${apt.scheduled_end.slice(0, 5)}`
      : apt.scheduled_start
        ? apt.scheduled_start.slice(0, 5)
        : null;

  const techNames =
    apt.technician_names?.length > 0 ? apt.technician_names.join(', ') : null;

  return (
    <div className="flex items-center gap-3 p-2.5 bg-white border border-gray-200 rounded-lg group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-gray-900">{dateStr}</span>
          {dayLabel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-bold">
              {dayLabel}
            </span>
          )}
          {timeStr && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeStr}
            </span>
          )}
          {teamSize && personnes != null && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                sousEffectif ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
              }`}
              title={`${personnes} personne(s) sur ${teamSize} attendue(s)`}
            >
              {personnes}/{teamSize} pers.
            </span>
          )}
        </div>
        {techNames && (
          <p className="text-xs text-gray-500 mt-0.5 ml-5.5 truncate">{techNames}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="p-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all disabled:cursor-not-allowed"
        title="Supprimer ce jour"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export default ChantierInterventionSection;
