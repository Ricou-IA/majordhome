/**
 * leadForm.js — état du formulaire de LeadModal et payloads d'écriture (module pur).
 * Les champs de contact sont partagés par le lead et par la fiche client liée.
 */
import { formatDateForInput } from './utils.js';

export const EMPTY_LEAD_FORM = Object.freeze({
  first_name: '', last_name: '', company_name: '',
  email: '', phone: '', phone_secondary: '',
  address: '', address_complement: '', postal_code: '', city: '',
  source_id: '', status_id: '', assigned_user_id: '',
  equipment_type_id: '', project_family_key: '', order_amount_ht: '', estimated_revenue: '',
  probability: '50', next_action: '', next_action_date: '',
  notes: '', lost_reason: '',
  appointment_date: '', quote_sent_date: '', won_date: '',
  email_sent: false,
});

/** Formulaire d'un nouveau lead : statut d'entrée du funnel + commercial par défaut. */
export function newLeadForm({ statusId = '', assignedUserId = '' } = {}) {
  return { ...EMPTY_LEAD_FORM, status_id: statusId, assigned_user_id: assignedUserId };
}

/** Formulaire pré-rempli depuis un lead existant. */
export function leadToForm(lead) {
  return {
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    company_name: lead.company_name || '',
    email: lead.email || '',
    phone: lead.phone || '',
    phone_secondary: lead.phone_secondary || '',
    address: lead.address || '',
    address_complement: lead.address_complement || '',
    postal_code: lead.postal_code || '',
    city: lead.city || '',
    source_id: lead.source_id || '',
    status_id: lead.status_id || '',
    assigned_user_id: lead.assigned_user_id || '',
    equipment_type_id: lead.equipment_type_id || '',
    project_family_key: lead.project_family_key || '',
    order_amount_ht: lead.order_amount_ht ?? '',
    estimated_revenue: lead.estimated_revenue ?? '',
    probability: lead.probability ?? '50',
    next_action: lead.next_action || '',
    next_action_date: formatDateForInput(lead.next_action_date) || '',
    notes: lead.notes || '',
    lost_reason: lead.lost_reason || '',
    appointment_date: formatDateForInput(lead.appointment_date) || '',
    quote_sent_date: formatDateForInput(lead.quote_sent_date) || '',
    won_date: formatDateForInput(lead.won_date) || '',
    email_sent: lead.email_sent || false,
  };
}

/** Champs de contact, communs au lead et à la fiche client (nom de famille jamais à null). */
export function contactPayload(form) {
  return {
    first_name: form.first_name.trim() || null,
    last_name: form.last_name.trim(),
    company_name: form.company_name.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    phone_secondary: form.phone_secondary.trim() || null,
    address: form.address.trim() || null,
    address_complement: form.address_complement.trim() || null,
    postal_code: form.postal_code.trim() || null,
    city: form.city.trim() || null,
  };
}

/** Payload complet du lead. `estimated_revenue` suit le montant HT saisi. */
export function buildLeadPayload(form, clientId) {
  return {
    ...contactPayload(form),
    source_id: form.source_id || null,
    status_id: form.status_id || null,
    assigned_user_id: form.assigned_user_id || null,
    equipment_type_id: form.equipment_type_id || null,
    project_family_key: form.project_family_key || null,
    order_amount_ht: form.order_amount_ht ? Number(form.order_amount_ht) : null,
    estimated_revenue: form.order_amount_ht ? Number(form.order_amount_ht) : null,
    probability: form.probability ? Number(form.probability) : 50,
    next_action: form.next_action.trim() || null,
    next_action_date: form.next_action_date || null,
    notes: form.notes.trim() || null,
    lost_reason: form.lost_reason.trim() || null,
    appointment_date: form.appointment_date || null,
    quote_sent_date: form.quote_sent_date || null,
    won_date: form.won_date || null,
    email_sent: form.email_sent || false,
    client_id: clientId || null,
  };
}
