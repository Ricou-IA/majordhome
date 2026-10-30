/**
 * eventForm.js — état du formulaire d'EventModal (module pur) : RDV ↔ formulaire,
 * recalcul heure de fin / durée, validation, objet automatique.
 */
import { formatDateForInput, computeEndTime, computeDuration } from '@/lib/utils';
import { getAppointmentTypeConfig } from '@services/appointments.service';
import { PHONE_REQUIRED_TYPES } from '@/lib/planningEvents';
import { hasPhoneNumber } from '@/lib/phoneUtils';

// Une visite technique sans numéro = un commercial qui ne peut ni confirmer ni
// prévenir d'un retard (vécu : lead LOLLENFANT, 2026-09-14). Si un client ou une
// carte est liée, le numéro vient de sa fiche : c'est là qu'il faut le compléter.
export const VT_PHONE_REQUIRED_MESSAGE = 'Téléphone requis : renseignez le numéro du client (sur sa fiche s’il est lié) avant de poser le RDV';

/** Coordonnées vides (déliaison d'un client). */
export const EMPTY_CONTACT = Object.freeze({
  client_name: '',
  client_first_name: '',
  client_phone: '',
  client_email: '',
  client_address: '',
  client_postal_code: '',
  client_city: '',
});

/** Coordonnées du formulaire depuis une fiche client ou une carte (`last_name` = nom). */
export function contactFromRecord(r, { nameFallback = '' } = {}) {
  return {
    client_name: r.last_name || nameFallback || '',
    client_first_name: r.first_name || '',
    client_phone: r.phone || '',
    client_email: r.email || '',
    client_address: r.address || '',
    client_postal_code: r.postal_code || '',
    client_city: r.city || '',
  };
}

/** Formulaire pré-rempli depuis un RDV existant. */
export function appointmentToForm(a) {
  return {
    subject: a.subject || '',
    appointment_type: a.appointment_type || 'rdv_technical',
    priority: a.priority || 'normal',
    status: a.status || 'scheduled',
    client_name: a.client_name || '',
    client_first_name: a.client_first_name || '',
    client_phone: a.client_phone || '',
    client_email: a.client_email || '',
    client_address: a.address || '',
    client_city: a.city || '',
    client_postal_code: a.postal_code || '',
    scheduled_date: formatDateForInput(a.scheduled_date) || '',
    scheduled_start: a.scheduled_start?.slice(0, 5) || '',
    scheduled_end: a.scheduled_end?.slice(0, 5) || '',
    duration_minutes: a.duration_minutes || 60,
    description: a.description || '',
    internal_notes: a.internal_notes || '',
    technicianIds: a.technician_ids || [],
    assigned_commercial_id: a.assigned_commercial_id || '',
    time_flex_minutes: a.time_flex_minutes ?? null,
    hour_confirmed_at: a.hour_confirmed_at || null,
  };
}

/** Formulaire de création : type figé par le kanban sinon « Autre », 1 h à partir de l'heure cliquée. */
export function newEventForm({ defaultDate = null, defaultTime = null, lockedType = null, prefillClient = null } = {}) {
  const startTime = defaultTime || '09:00';
  const duration = 60;
  return {
    subject: '',
    appointment_type: lockedType || 'other',
    priority: 'normal',
    status: 'scheduled',
    client_name: prefillClient?.last_name || '',
    client_first_name: prefillClient?.first_name || '',
    client_phone: prefillClient?.phone || '',
    client_email: prefillClient?.email || '',
    client_address: prefillClient?.address || '',
    client_city: prefillClient?.city || '',
    client_postal_code: prefillClient?.postal_code || '',
    scheduled_date: defaultDate || new Date().toISOString().split('T')[0],
    scheduled_start: startTime,
    scheduled_end: computeEndTime(startTime, duration),
    duration_minutes: duration,
    description: '',
    internal_notes: '',
    technicianIds: [],
    assigned_commercial_id: '',
    time_flex_minutes: null,
    hour_confirmed_at: null,
  };
}

/** Client lié (affichage) restauré depuis le RDV, ou null. */
export function linkedClientFromAppointment(a) {
  if (!a.client_id) return null;
  return {
    id: a.client_id,
    display_name: a.client_name || '',
    client_number: null,
    phone: a.client_phone || null,
    city: a.city || null,
  };
}

/** Carte pipeline liée (affichage) restaurée depuis le RDV, ou null. */
export function linkedLeadFromAppointment(a) {
  if (!a.lead_id) return null;
  return {
    id: a.lead_id,
    display_name: a.client_name || '',
    first_name: null,
    last_name: null,
    status_label: null,
    source_name: null,
    client_id: a.client_id || null,
  };
}

/** Client pré-lié depuis une fiche client (création), ou null. */
export function linkedClientFromPrefill(p) {
  if (!p?.id) return null;
  return {
    id: p.id,
    display_name: p.display_name || [p.last_name, p.first_name].filter(Boolean).join(' '),
    client_number: p.client_number || null,
    phone: p.phone || null,
    city: p.city || null,
  };
}

/** Change un champ : début ou durée recalculent la fin, la fin recalcule la durée. */
export function applyFieldChange(prev, field, value) {
  const next = { ...prev, [field]: value };
  if (field === 'scheduled_start' || field === 'duration_minutes') {
    const start = field === 'scheduled_start' ? value : prev.scheduled_start;
    const dur = field === 'duration_minutes' ? value : prev.duration_minutes;
    if (start && dur) next.scheduled_end = computeEndTime(start, Number(dur));
  }
  if (field === 'scheduled_end' && prev.scheduled_start) {
    next.duration_minutes = computeDuration(prev.scheduled_start, value);
  }
  return next;
}

/**
 * Validation du chemin classique (édition, création « Autre »).
 * Un RDV a toujours une personne : commercial → assigned_commercial_id (id stocké, même
 * pas encore résolu, ou legacy résolu) ; sinon → technicien(s) ou commercial.
 * Pas de RDV R1 sans numéro, à la pose ou à la re-catégorisation (un RDV déjà posé reste éditable).
 * @returns {{ errors: Object, phoneMissing: boolean }}
 */
export function validateEventForm(formData, { isFreeType, isCommercialType, commercialMemberId, isEdit, originalType }) {
  const errors = {};
  if (!formData.scheduled_date) errors.scheduled_date = 'Date requise';
  if (!formData.scheduled_start) errors.scheduled_start = 'Heure de début requise';
  if (!isFreeType && !formData.client_name?.trim()) errors.client_name = 'Nom requis';
  if (!formData.appointment_type) errors.appointment_type = 'Type requis';
  const hasPerson = isCommercialType
    ? !!(formData.assigned_commercial_id || commercialMemberId)
    : ((formData.technicianIds || []).length > 0 || !!formData.assigned_commercial_id);
  if (!hasPerson) errors[isCommercialType ? 'assigned_commercial_id' : 'technicianIds'] = 'Une personne est requise';
  const becomesVt = PHONE_REQUIRED_TYPES.includes(formData.appointment_type)
    && (!isEdit || !PHONE_REQUIRED_TYPES.includes(originalType));
  const phoneMissing = becomesVt && !hasPhoneNumber(formData.client_phone);
  if (phoneMissing) errors.client_phone = 'Téléphone requis pour ce type de RDV';
  return { errors, phoneMissing };
}

/** Décision du dialogue doublon (l'event DOM d'un onClick n'en est pas une). */
export function dupDecisionOf(maybeDecision) {
  return maybeDecision?.action === 'link' || maybeDecision?.action === 'create' ? maybeDecision : null;
}

/** « Nom Prénom » du formulaire, vide si rien. */
export function clientLabelOf(formData) {
  return [formData.client_name, formData.client_first_name].filter(Boolean).join(' ').trim();
}

/** Objet automatique « Type — Client » (type seul sans client). */
export function autoSubjectFor(appointmentType, formData) {
  const typeLabel = getAppointmentTypeConfig(appointmentType).label;
  const clientLabel = clientLabelOf(formData);
  return clientLabel ? `${typeLabel} — ${clientLabel}` : typeLabel;
}
