/**
 * SchedulingAssistant.jsx - Majord'home Artisan
 * ============================================================================
 * Assistant de planification multi-créneaux conscient de la dispo PAR PERSONNE.
 * Remplace SchedulingPanel : "jour d'abord" + colonnes par membre + empilage
 * de plusieurs créneaux (fix du bug mono-créneau).
 *
 * Modèle : 1 créneau = 1 appointment + N techs. Multi-créneau = N appointments.
 * L'assistant NE CRÉE RIEN — il retourne `slots[]` via onConfirm ; le caller
 * appelle appointmentsService.createAppointmentBatch.
 *
 * `appointment_type` n'est PAS par-slot : il vient du contexte (appointmentTypeValue).
 *
 * Composé de :
 *  - DayResourceGrid (jour × colonnes par membre, drag pour poser)
 *  - SlotDraftList (liste des créneaux empilés + édition des techs par créneau)
 *  - TechnicianSelect (réutilisé dans SlotDraftList)
 *
 * @version 1.0.0 - Bloc B stage 2 (assistant créneaux)
 * ============================================================================
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { CalendarCheck, Loader2, X, FileText, User } from 'lucide-react';
import { DayResourceGrid } from './DayResourceGrid';
import { SlotDraftList } from './SlotDraftList';
import { useTeamDayAvailability } from '@hooks/useAppointments';
import { findMemberConflicts } from '@/lib/scheduleConflicts';
import { formatDateForInput } from '@/lib/utils';

// ============================================================================
// HELPERS
// ============================================================================

/** Date du prochain jour ouvré (saute samedi/dimanche, semaine Lun-Ven) au format YYYY-MM-DD. */
function defaultStartDate() {
  const d = new Date();
  if (d.getDay() === 6) d.setDate(d.getDate() + 2); // samedi → lundi
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1); // dimanche → lundi
  return formatDateForInput(d);
}

/** UUID compatible (fallback si crypto.randomUUID indispo). */
function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// COMPOSANT
// ============================================================================

/**
 * @param {Object} props
 * @param {Object} props.lead - lead/client courant (pré-remplit objet + assigned_user_id)
 * @param {string} props.orgId - core org_id
 * @param {Array} [props.commercials] - [{ id, full_name, role? }] (colonnes en mode commercial — filtrées role commercial/admin)
 * @param {Array} [props.members] - [{ id, display_name, calendar_color, default_availability, role }] (colonnes en mode technician — filtrées role technician)
 * @param {'commercial'|'technician'} [props.assigneeType]
 * @param {string|null} [props.fixedAssigneeId] - (mode commercial) id du commercial figé (= owner de la carte) : la grille n'affiche QUE sa colonne. null → tous les commerciaux.
 * @param {string} [props.appointmentTypeLabel] - libellé affiché du type de RDV
 * @param {number} [props.defaultDuration]
 * @param {string} [props.defaultSubjectPrefix]
 * @param {boolean} [props.multi] - false = 1 créneau (parité) ; true = multi-créneau
 * @param {Function} props.onConfirm - (slots[]) => void  (mode autonome, avec bouton)
 * @param {Function} props.onCancel
 * @param {boolean} [props.isLoading]
 * @param {boolean} [props.embedded] - mode intégré : pas de header/objet/notes/boutons ;
 *   remonte les créneaux en continu via onSlotsChange (le host gère objet/notes/confirmation).
 * @param {Function} [props.onSlotsChange] - (slots[]) => void  (mode embedded, doit être stable)
 */
export function SchedulingAssistant({
  lead,
  orgId,
  commercials = [],
  members = [],
  assigneeType = 'commercial',
  fixedAssigneeId = null,
  appointmentTypeLabel = 'Visite technique',
  // NB: le type de RDV (appointment_type) est appliqué par le CALLER via le
  // contexte partagé de createAppointmentBatch — pas par l'assistant. Les callers
  // peuvent passer `appointmentTypeValue` sans effet ici (forward-compat).
  defaultDuration = 30,
  defaultSubjectPrefix,
  multi = false,
  onConfirm,
  onCancel,
  isLoading = false,
  embedded = false,
  onSlotsChange,
}) {
  const subjectPrefix = defaultSubjectPrefix || appointmentTypeLabel;

  // Mode commercial : assignation portée par la carte (assigned_commercial_id),
  // pas choisie ici. La colonne affichée = le commercial figé (fixedAssigneeId).
  const commercialMode = assigneeType === 'commercial';

  // Colonnes affichées = membres assignables selon le type, FILTRÉS par rôle.
  // Mirror de la convention SectionAssignee (EventFormSections.jsx) :
  //   - 'technician' → role === 'technician'
  //   - 'commercial' → role === 'commercial' || role === 'admin'
  //   - inconnu / membre sans rôle → conservé (fallback).
  // En mode commercial avec fixedAssigneeId → on ne garde QUE ce commercial
  // (la dispo affichée est celle du commercial assigné à la carte).
  // Source unique : la liste filtrée est passée à DayResourceGrid (colonnes) ET
  // à SlotDraftList (sélecteur par créneau, masqué en mode commercial).
  const columnMembers = useMemo(() => {
    if (commercialMode) {
      const mapped = (commercials || [])
        .filter((c) => !c.role || c.role === 'commercial' || c.role === 'admin')
        .map((c) => ({
          id: c.id,
          display_name: c.full_name || c.display_name || 'Commercial',
          calendar_color: c.calendar_color || '#6366F1',
          default_availability: c.default_availability || null,
          role: c.role,
        }));
      if (fixedAssigneeId) {
        return mapped.filter((c) => c.id === fixedAssigneeId);
      }
      return mapped;
    }
    if (assigneeType === 'technician') {
      return (members || []).filter((m) => !m.role || m.role === 'technician');
    }
    return members || [];
  }, [commercialMode, assigneeType, commercials, members, fixedAssigneeId]);

  // Membre(s) posé(s) par défaut sur un nouveau créneau.
  // Mode commercial : le commercial figé (fixedAssigneeId) ou, à défaut,
  // l'owner du lead — son id pilote le rendu de la colonne + les conflits.
  // Il est retiré de l'output final (technicianIds: []) dans handleSubmit.
  const defaultTechIds = useMemo(() => {
    if (commercialMode) {
      const target = fixedAssigneeId || lead?.assigned_user_id || null;
      if (target && columnMembers.some((m) => m.id === target)) return [target];
      return [];
    }
    return [];
  }, [commercialMode, fixedAssigneeId, lead?.assigned_user_id, columnMembers]);

  const [selectedDate, setSelectedDate] = useState(defaultStartDate);
  const [draftSlots, setDraftSlots] = useState([]);
  const [subject, setSubject] = useState(() => {
    const name = `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim();
    return name ? `${subjectPrefix} - ${name}` : subjectPrefix;
  });
  const [notes, setNotes] = useState('');

  // RDV du jour sélectionné (avec technician_ids) pour les colonnes.
  const { dayAppointments } = useTeamDayAvailability(orgId, selectedDate);

  // --- Poser un créneau depuis la grille ---
  const handlePlaceSlot = useCallback(({ memberId, date, startTime, endTime, duration }) => {
    const slot = {
      id: newId(),
      date,
      startTime,
      endTime,
      duration: duration || defaultDuration,
      technicianIds: memberId
        ? Array.from(new Set([memberId, ...defaultTechIds]))
        : [...defaultTechIds],
    };
    setDraftSlots((prev) => (multi ? [...prev, slot] : [slot]));
  }, [multi, defaultDuration, defaultTechIds]);

  // --- Ajouter / retirer un tech sur un créneau ---
  const handleToggleTech = useCallback((slotId, techId) => {
    setDraftSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const has = (s.technicianIds || []).includes(techId);
        return {
          ...s,
          technicianIds: has
            ? s.technicianIds.filter((id) => id !== techId)
            : [...(s.technicianIds || []), techId],
        };
      }),
    );
  }, []);

  const handleRemoveSlot = useCallback((slotId) => {
    setDraftSlots((prev) => prev.filter((s) => s.id !== slotId));
  }, []);

  // --- Conflits par créneau (somme des conflits sur tous ses techs) ---
  const conflictsBySlot = useMemo(() => {
    const map = {};
    draftSlots.forEach((slot) => {
      let count = 0;
      (slot.technicianIds || []).forEach((tid) => {
        count += findMemberConflicts(
          { date: slot.date, startTime: slot.startTime, endTime: slot.endTime },
          tid,
          dayAppointments,
        ).length;
      });
      map[slot.id] = count;
    });
    return map;
  }, [draftSlots, dayAppointments]);

  const totalConflicts = useMemo(
    () => Object.values(conflictsBySlot).reduce((a, b) => a + b, 0),
    [conflictsBySlot],
  );

  // --- Mode intégré (embedded) : remonte en continu les créneaux au host (EventModal),
  // sans bouton de confirmation interne. Objet/notes/subject sont gérés par le host. ---
  const emittedSlots = useMemo(
    () => draftSlots.map((s) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime || null,
      duration: s.duration || defaultDuration,
      technicianIds: commercialMode ? [] : (s.technicianIds || []),
      assignedCommercialId: commercialMode ? (s.technicianIds?.[0] || null) : null,
    })),
    [draftSlots, defaultDuration, commercialMode],
  );
  useEffect(() => {
    if (embedded) onSlotsChange?.(emittedSlots);
  }, [embedded, emittedSlots, onSlotsChange]);

  // --- Confirmation : remonte les slots[] au format du contrat ---
  // slots = [{ date, startTime, endTime, duration, technicianIds, assignedCommercialId, subject, notes }]
  // Mode technician : `technicianIds` porte les techniciens sélectionnés.
  // Mode commercial : l'assignation N'EST PAS dans technicianIds (sort []). Deux cas :
  //   - figé (fixedAssigneeId, ex. VT pipeline) : le caller pose assigned_commercial_id
  //     lui-même → il ignore assignedCommercialId (rétrocompat).
  //   - sélectionnable (fixedAssigneeId=null, ex. VT depuis EventModal) : la colonne
  //     choisie est portée par `assignedCommercialId` → le caller la recopie sur le RDV.
  const handleSubmit = useCallback(() => {
    if (draftSlots.length === 0) return;
    const slots = draftSlots.map((s) => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime || null,
      duration: s.duration || defaultDuration,
      technicianIds: commercialMode ? [] : (s.technicianIds || []),
      assignedCommercialId: commercialMode ? (s.technicianIds?.[0] || null) : null,
      subject: subject.trim() || subjectPrefix,
      notes: notes.trim() || null,
    }));
    onConfirm?.(slots);
  }, [draftSlots, defaultDuration, commercialMode, subject, subjectPrefix, notes, onConfirm]);

  const assigneeLabel = commercialMode ? 'Commercial(aux)' : 'Technicien(s)';

  // Affichage du membre dans l'en-tête : en mode commercial figé, le nom du
  // commercial assigné à la carte (parité avec l'ancien SchedulingPanel) ;
  // sinon le libellé générique.
  const assigneeDisplay = useMemo(() => {
    if (commercialMode && fixedAssigneeId) {
      const assigned = columnMembers.find((m) => m.id === fixedAssigneeId);
      if (assigned) return assigned.display_name;
      return 'Aucun commercial assigné';
    }
    return assigneeLabel;
  }, [commercialMode, fixedAssigneeId, columnMembers, assigneeLabel]);

  return (
    <div className="space-y-4">
      {!embedded && (
        <>
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

          {/* Type de RDV */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <CalendarCheck className="w-3.5 h-3.5 text-blue-500" />
            <span className="font-medium">{appointmentTypeLabel}</span>
            <span className="text-gray-300">•</span>
            <User className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-gray-500">{assigneeDisplay}</span>
          </div>
        </>
      )}

      {/* Grille jour × colonnes par membre */}
      <DayResourceGrid
        date={selectedDate}
        onDateChange={setSelectedDate}
        members={columnMembers}
        dayAppointments={dayAppointments}
        draftSlots={draftSlots}
        onPlaceSlot={handlePlaceSlot}
      />

      {/* Liste des créneaux empilés (sélecteur par créneau masqué en mode commercial :
          l'assignation est celle de la carte, pas choisie ici). */}
      <SlotDraftList
        slots={draftSlots}
        members={columnMembers}
        conflictsBySlot={conflictsBySlot}
        onRemoveSlot={handleRemoveSlot}
        onToggleTech={handleToggleTech}
        assigneeLabel={assigneeLabel}
        showTechSelect={!commercialMode}
      />

      {!embedded && (
        <>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes internes (optionnel)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes pour l'équipe..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>
        </>
      )}

      {/* Compteur de conflits global */}
      {totalConflicts > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {totalConflicts} conflit(s) de disponibilité détecté(s) — la planification reste possible.
        </p>
      )}

      {/* Boutons (mode autonome uniquement — en embedded, le host confirme) */}
      {!embedded && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || draftSlots.length === 0}
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
                Planifier {draftSlots.length || ''} créneau{draftSlots.length > 1 ? 'x' : ''}
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
      )}
    </div>
  );
}

export default SchedulingAssistant;
