// src/lib/invoiceEmailModel.js
// ============================================================================
// Envoi de la facture d'entretien par e-mail (Resend) — modèle PUR (spec
// 2026-09-23-facture-entretien-envoi-email-resend-design.md) : disponibilité de
// l'option (module Communication, prérequis), lignes de certificats joignables,
// messages d'erreur de l'edge `invoice-send`. Aucun import React / Supabase.
// ============================================================================
import { moduleActif } from './modules.js';

/**
 * @param {object} p
 * @param {object} p.settings  settings de l'org
 * @param {'draft'|'final'|'hub'} p.mode  mode de création (pennylaneInvoiceSettings)
 * @param {string|null|undefined} p.clientEmail
 * @param {boolean} [p.hasInvoice=true]  renvoi depuis la carte : la carte porte-t-elle une facture ?
 * @param {boolean} [p.isDraftInvoice]  renvoi : la facture Pennylane est-elle encore un brouillon ? (si connu)
 * @returns {{ visible: boolean, enabled: boolean, reason: null|'module_off'|'no_email'|'no_from_email'|'resend_not_verified'|'draft_mode'|'no_invoice'|'draft_invoice' }}
 */
export function invoiceEmailAvailability({ settings, mode, clientEmail, hasInvoice = true, isDraftInvoice }) {
  if (!moduleActif(settings, 'communication')) return { visible: false, enabled: false, reason: 'module_off' };
  const off = (reason) => ({ visible: true, enabled: false, reason });
  if (!(clientEmail || '').trim()) return off('no_email');
  if (!(settings?.from_email || '').trim()) return off('no_from_email');
  if (settings?.resend?.status !== 'verified') return off('resend_not_verified');
  if (!hasInvoice) return off('no_invoice');
  if (isDraftInvoice === true) return off('draft_invoice');
  if (isDraftInvoice == null && mode === 'draft') return off('draft_mode');
  return { visible: true, enabled: true, reason: null };
}

export const INVOICE_EMAIL_REASONS = Object.freeze({
  no_email: 'Le client n’a pas d’adresse e-mail (fiche client).',
  no_from_email: 'Aucun e-mail expéditeur : Paramètres → Communication → Emails.',
  resend_not_verified: 'Le domaine d’envoi n’est pas vérifié : Paramètres → Communication → Emails.',
  draft_mode: 'Brouillon Pennylane : à envoyer depuis Pennylane après finalisation.',
  no_invoice: 'Aucune facture sur cette carte.',
  draft_invoice: 'La facture est encore un brouillon dans Pennylane : finalisez-la d’abord.',
});

/**
 * Certificats de l'intervention → lignes cochables. Joignable = PDF archivé.
 * @param {Array<{ id, reference?, equipement_type?, equipement_marque?, equipement_modele?, statut?, pdf_storage_path? }>|null} certificats
 */
export function certificateAttachmentRows(certificats) {
  return (certificats || []).map((c) => {
    const attachable = Boolean(c.pdf_storage_path);
    const signed = c.statut === 'signe';
    return {
      id: c.id,
      label: c.reference ? `Certificat ${c.reference}` : 'Certificat d’entretien',
      sublabel: [c.equipement_type, c.equipement_marque, c.equipement_modele].filter(Boolean).join(' · '),
      attachable,
      defaultChecked: attachable,
      badge: !attachable ? 'PDF non généré' : !signed ? 'non signé' : null,
    };
  });
}

export const INVOICE_EMAIL_ERROR_MESSAGES = Object.freeze({
  module_communication_inactif: 'Le module Communication n’est pas ouvert pour cette organisation.',
  intervention_not_found: 'Intervention introuvable.',
  invoice_missing: 'Cette carte n’a pas de facture à envoyer.',
  invoice_is_draft: 'La facture est encore un brouillon dans Pennylane : finalisez-la d’abord.',
  invoice_pdf_missing: 'Le PDF de la facture n’est pas disponible (Pennylane ne l’a pas encore produit, ou l’archive du hub manque).',
  certificate_not_allowed: 'Un certificat sélectionné n’appartient pas à cette intervention.',
  certificate_pdf_missing: 'Un certificat sélectionné n’a pas de PDF généré : ouvrez-le et générez le PDF.',
  template_missing: 'Gabarit « Facture d’entretien » absent : créez-le dans Paramètres → Communication → Emails.',
  client_email_missing: 'Le client n’a pas d’adresse e-mail.',
  attachments_too_large: 'Pièces jointes trop volumineuses (plus de 35 Mo) : retirez des certificats.',
  resend_failed: 'Resend a refusé l’envoi.',
});

const FALLBACK = 'L’e-mail n’a pas pu être envoyé.';

/** @param {{ code?: string, detail?: string, message?: string }|null|undefined} err */
export function invoiceEmailErrorMessage(err) {
  if (!err) return FALLBACK;
  const base = err.code && INVOICE_EMAIL_ERROR_MESSAGES[err.code];
  if (base) return err.detail ? `${base} (${String(err.detail).slice(0, 300)})` : base;
  return err.message || FALLBACK;
}
