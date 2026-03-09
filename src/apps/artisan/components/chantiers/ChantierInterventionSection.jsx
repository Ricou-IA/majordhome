/**
 * ChantierInterventionSection.jsx - Majord'home Artisan
 * ============================================================================
 * Section intervention dans la modale chantier.
 * Gestion intervention parent + liste des slots (jours d'intervention).
 *
 * @version 1.0.0 - Sprint 6 Chantiers
 * ============================================================================
 */

import { useState } from 'react';
import { CalendarDays, Plus, Trash2, Loader2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { FormField, TextInput } from '@apps/artisan/components/FormFields';
import { TechnicianSelect } from '@apps/artisan/components/planning/TechnicianSelect';

/**
 * @param {Object} props
 * @param {Object|null} props.parentIntervention - Intervention parent existante ou null
 * @param {Array} props.slots - Liste des slots (jours d'intervention)
 * @param {Array} props.members - Liste des team_members pour TechnicianSelect
 * @param {Function} props.onCreateParent - () => Promise (crée intervention parent)
 * @param {Function} props.onAddSlot - ({ slotDate, slotStartTime, slotEndTime, technicianIds, slotNotes }) => Promise
 * @param {Function} props.onDeleteSlot - (slotId) => Promise
 * @param {boolean} props.isCreatingParent
 * @param {boolean} props.isCreatingSlot
 * @param {boolean} props.disabled
 */
export function ChantierInterventionSection({
  parentIntervention,
  slots = [],
  members = [],
  onCreateParent,
  onAddSlot,
  onDeleteSlot,
  isCreatingParent = false,
  isCreatingSlot = false,
  disabled = false,
}) {
  const [newSlot, setNewSlot] = useState({
    slotDate: '',
    slotStartTime: '08:00',
    slotEndTime: '17:00',
    technicianIds: [],
    slotNotes: '',
  });
  const [showNewSlotForm, setShowNewSlotForm] = useState(false);

  const handleCreateParent = async () => {
    try {
      await onCreateParent();
      toast.success('Intervention créée');
    } catch {
      toast.error("Erreur lors de la création de l'intervention");
    }
  };

  const handleAddSlot = async () => {
    if (!newSlot.slotDate) {
      toast.error('Veuillez sélectionner une date');
      return;
    }
    try {
      await onAddSlot(newSlot);
      setNewSlot({
        slotDate: '',
        slotStartTime: '08:00',
        slotEndTime: '17:00',
        technicianIds: [],
        slotNotes: '',
      });
      setShowNewSlotForm(false);
      toast.success('Jour ajouté');
    } catch {
      toast.error("Erreur lors de l'ajout du jour");
    }
  };

  const handleDeleteSlot = async (slotId) => {
    try {
      await onDeleteSlot(slotId);
      toast.success('Jour supprimé');
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-secondary-500 uppercase tracking-wider flex items-center gap-2">
        <CalendarDays className="w-4 h-4" />
        Intervention
      </h3>

      {/* Pas encore d'intervention parent */}
      {!parentIntervention && (
        <div className="text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <p className="text-sm text-gray-500 mb-3">
            Aucune intervention planifiée
          </p>
          <button
            type="button"
            onClick={handleCreateParent}
            disabled={disabled || isCreatingParent}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isCreatingParent ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Créer l'intervention
          </button>
        </div>
      )}

      {/* Intervention existante : liste des slots */}
      {parentIntervention && (
        <div className="space-y-3">
          {/* Liste des slots existants */}
          {slots.length === 0 && !showNewSlotForm && (
            <p className="text-sm text-gray-400 italic py-2">
              Aucun jour planifié
            </p>
          )}

          {slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              onDelete={() => handleDeleteSlot(slot.id)}
              disabled={disabled}
            />
          ))}

          {/* Formulaire nouveau slot */}
          {showNewSlotForm && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Date">
                  <TextInput
                    type="date"
                    value={newSlot.slotDate}
                    onChange={(val) => setNewSlot(s => ({ ...s, slotDate: val }))}
                  />
                </FormField>
                <FormField label="Début">
                  <TextInput
                    type="time"
                    value={newSlot.slotStartTime}
                    onChange={(val) => setNewSlot(s => ({ ...s, slotStartTime: val }))}
                  />
                </FormField>
                <FormField label="Fin">
                  <TextInput
                    type="time"
                    value={newSlot.slotEndTime}
                    onChange={(val) => setNewSlot(s => ({ ...s, slotEndTime: val }))}
                  />
                </FormField>
              </div>

              <FormField label="Techniciens">
                <TechnicianSelect
                  selectedIds={newSlot.technicianIds}
                  onChange={(ids) => setNewSlot(s => ({ ...s, technicianIds: ids }))}
                  members={members}
                  placeholder="Sélectionner des techniciens..."
                />
              </FormField>

              <FormField label="Notes">
                <TextInput
                  value={newSlot.slotNotes}
                  onChange={(val) => setNewSlot(s => ({ ...s, slotNotes: val }))}
                  placeholder="Notes pour ce jour..."
                />
              </FormField>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddSlot}
                  disabled={isCreatingSlot || !newSlot.slotDate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreatingSlot ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Ajouter
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewSlotForm(false)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* Bouton ajouter un jour */}
          {!showNewSlotForm && (
            <button
              type="button"
              onClick={() => setShowNewSlotForm(true)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Ajouter un jour
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Ligne d'un slot existant
 */
function SlotRow({ slot, onDelete, disabled }) {
  const dateStr = slot.slot_date
    ? new Date(slot.slot_date + 'T00:00:00').toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    : '—';

  const timeStr =
    slot.slot_start_time && slot.slot_end_time
      ? `${slot.slot_start_time.slice(0, 5)} – ${slot.slot_end_time.slice(0, 5)}`
      : null;

  const techNames =
    slot.technician_names?.length > 0
      ? slot.technician_names.join(', ')
      : null;

  return (
    <div className="flex items-center gap-3 p-2.5 bg-white border border-gray-200 rounded-lg group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-gray-900">{dateStr}</span>
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
        {slot.slot_notes && (
          <p className="text-xs text-gray-400 mt-0.5 ml-5.5 truncate italic">{slot.slot_notes}</p>
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
