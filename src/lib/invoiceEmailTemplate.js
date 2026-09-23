// src/lib/invoiceEmailTemplate.js
// ============================================================================
// Gabarit PAR DÉFAUT de l'e-mail « Facture d'entretien » (module Communication).
// Créé d'un clic dans Settings → Communication → Emails comme campagne
// transactionnelle `facture_entretien` de l'org, puis éditable dans Mailing → Éditeur.
// Module PUR. Le corps est habillé par le squelette d'e-mail de l'org (pas de <html>).
// ============================================================================
export const INVOICE_EMAIL_TEMPLATE_KEY = 'facture_entretien';

export const INVOICE_EMAIL_PLACEHOLDERS = Object.freeze([
  '{{CLIENT_NAME}}', '{{INVOICE_NUMBER}}', '{{INVOICE_AMOUNT}}', '{{INVOICE_DATE}}', '{{EQUIPMENTS}}', '{{ATTACHMENTS}}',
  '{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}', '{{ORG_WEBSITE_URL}}',
]);

export const DEFAULT_INVOICE_EMAIL = Object.freeze({
  key: INVOICE_EMAIL_TEMPLATE_KEY,
  label: 'Facture d’entretien (envoi au client)',
  subject: 'Votre facture {{INVOICE_NUMBER}} — {{BRAND_NAME}}',
  html_body: [
    '<p>Bonjour {{CLIENT_NAME}},</p>',
    '<p>Veuillez trouver ci-joint votre facture <strong>{{INVOICE_NUMBER}}</strong> du {{INVOICE_DATE}}, d’un montant de <strong>{{INVOICE_AMOUNT}}</strong>, relative à l’entretien de : {{EQUIPMENTS}}.</p>',
    '<p>Pièces jointes : {{ATTACHMENTS}}</p>',
    '<p>Nous vous remercions de votre confiance et restons à votre disposition au {{ORG_PHONE}} ou par e-mail à {{ORG_EMAIL}}.</p>',
    '<p>{{BRAND_NAME}}<br>{{ORG_ADDRESS}}, {{ORG_POSTAL_CODE}} {{ORG_CITY}}</p>',
  ].join('\n'),
  is_transactional: true,
});
