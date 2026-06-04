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

import { CalendarDays, Plus, Trash2, Clock } from 'lucide-react';
import { toast } from 'sonner';

/**
 * @param {Object} props
 * @param {Array} props.appointments - appointments `installation` du chantier (via useChantierAppointments)
 * @param {Function} props.onSchedule - () => void (ouvre l'assistant de planification)
 * @param {Function} props.onDeleteAppointment - (appointmentId) => Promise (throw en cas d'erreur)
 * @param {boolean} props.disabled
 */
export function ChantierInterventionSection({
  appointments = [],
  onSchedule,
  onDeleteAppointment,
  disabled = false,
}) {
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
      </h3>

      {appointments.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-1">Aucun jour d'installation planifié</p>
      ) : (
        <div className="space-y-2">
          {appointments.map((apt) => (
            <AppointmentRow
              key={apt.id}
              apt={apt}
              onDelete={() => handleDelete(apt.id)}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {!disabled && (
        <button
          type="button"
          onClick={onSchedule}
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Planifier l'installation
        </button>
      )}
    </div>
  );
}

/**
 * Ligne d'un jour d'installation (appointment)
 */
function AppointmentRow({ apt, onDelete, disabled }) {
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

  const dayLabel =
    apt.chantier_total_days > 1
      ? `J${apt.chantier_day_index}/${apt.chantier_total_days}`
      : null;

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
