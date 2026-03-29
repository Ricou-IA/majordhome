/**
 * SchedulingPanel.jsx - Majord'home Artisan
 * ============================================================================
 * Panneau de planification de RDV réutilisable.
 * Compose MiniWeekCalendar + champs formulaire.
 *
 * Utilisé par :
 * - LeadModal (pipeline) → type "Visite technique", assignation commercial
 * - EntretienSAVModal → type "Entretien-SAV", assignation technicien
 *
 * Props contextuelles :
 * - appointmentTypeLabel / appointmentTypeValue → type de RDV affiché
 * - assigneeType ('commercial' | 'technician') → qui assigner
 * - members → liste des techniciens (mode technician)
 * - defaultDuration → durée pré-remplie (ex. durée contrat entretien)
 * - defaultSubjectPrefix → préfixe objet (ex. "Entretien - ")
 *
 * v3.0 — Contextuel : type RDV + assignation + durée configurables
 * ============================================================================
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Calendar,
  Clock,
  User,
  Users,
  FileText,
  Loader2,
  X,
  CalendarCheck,
} from 'lucide-react';
import { MiniWeekCalendar } from '@apps/artisan/components/planning/MiniWeekCalendar';
import { TechnicianSelect } from '@apps/artisan/components/planning/TechnicianSelect';
import { useAppointments } from '@hooks/useAppointments';

// ============================================================================
// CONSTANTES (défauts pour le mode pipeline)
// ============================================================================

const DEFAULT_APPOINTMENT_TYPE = 'rdv_technical';
const DEFAULT_APPOINTMENT_LABEL = 'Visite technique';

/**
 * Calcule l'heure de fin à partir de l'heure de début et la durée
 */
function computeEndTime(startTime, durationMinutes) {
  if (!startTime || !durationMinutes) return '';
  const [h, m] = startTime.split(':').map(Number);
  const totalMin = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMin / 60) % 24;
  const endM = totalMin % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Retourne le lundi de la semaine d'une date donnée
 */
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Formate YYYY-MM-DD
 */
function fmtDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formate une durée en minutes en texte lisible
 */
function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// ============================================================================
// COMPOSANT
// ============================================================================

/**
 * @param {Object} props
 * @param {Object} props.lead - Lead/client courant (pour pré-remplir l'objet, assigned_user_id)
 * @param {string} props.orgId - core org_id
 * @param {Array} props.commercials - Liste des commerciaux [{id, full_name}] (mode commercial)
 * @param {Function} props.onConfirm - Callback avec les données de planification
 * @param {Function} props.onCancel - Callback annulation
 * @param {boolean} [props.isLoading] - État de chargement pendant la confirmation
 * @param {string} [props.appointmentTypeLabel] - Label du type de RDV (défaut: 'Visite technique')
 * @param {string} [props.appointmentTypeValue] - Valeur du type de RDV (défaut: 'rdv_technical')
 * @param {'commercial'|'technician'} [props.assigneeType] - Type d'assignation (défaut: 'commercial')
 * @param {Array} [props.members] - Liste des techniciens [{id, display_name, calendar_color}] (mode technician)
 * @param {number} [props.defaultDuration] - Durée par défaut en minutes
 * @param {string} [props.defaultSubjectPrefix] - Préfixe objet (ex. "Entretien - ")
 */
export function SchedulingPanel({
  lead,
  orgId,
  commercials = [],
  onConfirm,
  onCancel,
  isLoading = false,
  appointmentTypeLabel = DEFAULT_APPOINTMENT_LABEL,
  appointmentTypeValue = DEFAULT_APPOINTMENT_TYPE,
  assigneeType = 'commercial',
  members = [],
  defaultDuration = 30,
  defaultSubjectPrefix,
}) {
  // Résoudre le préfixe objet
  const subjectPrefix = defaultSubjectPrefix || appointmentTypeLabel;

  // État du formulaire
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [duration, setDuration] = useState(defaultDuration);
  const [selectedTechnicianIds, setSelectedTechnicianIds] = useState([]);
  const [subject, setSubject] = useState(
    () => {
      const name = `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim();
      return name ? `${subjectPrefix} - ${name}` : subjectPrefix;
    }
  );
  const [notes, setNotes] = useState('');
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    // Dimanche : Lun-Sam déjà passés, avancer au lundi suivant
    if (now.getDay() === 0) now.setDate(now.getDate() + 1);
    return getMonday(now);
  });

  // Erreurs de validation
  const [errors, setErrors] = useState({});

  // Commercial assigné (résolu depuis lead.assigned_user_id) — mode commercial uniquement
  const assignedCommercial = useMemo(() => {
    if (assigneeType !== 'commercial') return null;
    if (!lead?.assigned_user_id) return null;
    return commercials.find(c => c.id === lead.assigned_user_id) || null;
  }, [assigneeType, lead?.assigned_user_id, commercials]);

  // Charger les RDV de la semaine affichée pour le calendrier
  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return fmtDate(end);
  }, [weekStart]);

  const { appointments: weekAppointments } = useAppointments({
    orgId,
    startDate: fmtDate(weekStart),
    endDate: weekEnd,
  });

  // Heure de fin calculée
  const endTime = useMemo(
    () => computeEndTime(selectedTime, duration),
    [selectedTime, duration]
  );

  // Sélection d'un créneau depuis le calendrier (avec durée drag)
  const handleSlotSelect = useCallback(({ date, time, duration: dragDuration }) => {
    setSelectedDate(date);
    setSelectedTime(time);
    if (dragDuration) setDuration(dragDuration);
    setErrors(prev => ({ ...prev, date: null, time: null }));
  }, []);

  // Navigation semaine
  const handleWeekChange = useCallback((newMonday) => {
    setWeekStart(newMonday);
  }, []);

  // Validation
  const validate = useCallback(() => {
    const newErrors = {};
    if (!selectedDate) newErrors.date = 'Date requise';
    if (!selectedTime) newErrors.time = 'Heure requise';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [selectedDate, selectedTime]);

  // Soumission
  const handleSubmit = useCallback(() => {
    if (!validate()) return;

    onConfirm({
      date: selectedDate,
      startTime: selectedTime,
      endTime,
      duration,
      appointmentType: appointmentTypeValue,
      technicianIds: assigneeType === 'technician' ? selectedTechnicianIds : [],
      subject: subject.trim() || subjectPrefix,
      notes: notes.trim() || null,
    });
  }, [validate, onConfirm, selectedDate, selectedTime, endTime, duration, appointmentTypeValue, assigneeType, selectedTechnicianIds, subject, subjectPrefix, notes]);

  // Formater la date sélectionnée pour l'affichage
  const selectedDateDisplay = useMemo(() => {
    if (!selectedDate) return null;
    const d = new Date(selectedDate + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }, [selectedDate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-blue-600" />
          Planifier le RDV
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Type de RDV + Assignation */}
      <div className="space-y-2">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5 text-gray-600">
            <CalendarCheck className="w-3.5 h-3.5 text-blue-500" />
            <span className="font-medium">{appointmentTypeLabel}</span>
          </div>
          {assigneeType === 'commercial' && (
            <>
              <span className="text-gray-300">•</span>
              <div className="flex items-center gap-1.5 text-gray-600">
                <User className="w-3.5 h-3.5 text-indigo-500" />
                <span>
                  {assignedCommercial
                    ? assignedCommercial.full_name
                    : <span className="text-gray-400 italic">Aucun commercial assigné</span>
                  }
                </span>
              </div>
            </>
          )}
        </div>

        {/* Sélecteur de technicien (mode technician) */}
        {assigneeType === 'technician' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              Technicien(s)
            </label>
            <TechnicianSelect
              selectedIds={selectedTechnicianIds}
              onChange={setSelectedTechnicianIds}
              members={members}
              placeholder="Sélectionner un technicien..."
            />
          </div>
        )}
      </div>

      {/* Mini calendrier */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5" />
          Créneau
        </label>
        <MiniWeekCalendar
          weekStartDate={weekStart}
          appointments={weekAppointments || []}
          selectedDate={selectedDate}
          selectedTime={selectedTime}
          selectedDuration={duration}
          onSelectSlot={handleSlotSelect}
          onWeekChange={handleWeekChange}
          technicianFilter={[]}
        />
        {(errors.date || errors.time) && (
          <p className="text-xs text-red-500 mt-0.5">
            {errors.date || errors.time}
          </p>
        )}
      </div>

      {/* Résumé créneau sélectionné */}
      {selectedDate && selectedTime && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-blue-800">
              <span className="font-medium capitalize">{selectedDateDisplay}</span>
              <span className="ml-2">
                {selectedTime} - {endTime || '?'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-blue-600">
              <Clock className="w-3.5 h-3.5" />
              {formatDuration(duration)}
            </div>
          </div>
        </div>
      )}

      {/* Objet */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
          <FileText className="w-3.5 h-3.5" />
          Objet
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Objet du RDV"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Notes internes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes internes (optionnel)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes pour l'équipe..."
          rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
        />
      </div>

      {/* Boutons */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isLoading}
          className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg
                     hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2 min-h-[44px]"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Planification...
            </>
          ) : (
            <>
              <CalendarCheck className="w-4 h-4" />
              Planifier le RDV
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg
                     hover:bg-gray-50 transition-colors disabled:opacity-50 min-h-[44px]"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

export default SchedulingPanel;
