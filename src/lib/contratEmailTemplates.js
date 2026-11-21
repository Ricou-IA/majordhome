// src/lib/contratEmailTemplates.js
// ============================================================================
// Textes PAR DÉFAUT des deux e-mails du contrat d'entretien : la proposition
// (envoyée par `useContractProposal` via l'edge mailing-send, mode `single`) et
// la confirmation de signature (edge contract-signed-notify, contrat signé joint).
// Jusqu'au 2026-11-21 ces deux textes n'existaient que dans les lignes
// `mail_campaigns` de Mayer : une autre entreprise ne pouvait pas les envoyer.
// Même patron que invoiceEmailTemplate.js. Module PUR (aucun import), copié pour
// Deno par `npm run sync:tournee-engine` (PARTAGES) — ne jamais éditer la copie.
// ============================================================================

export const PROPOSITION_CONTRAT_TEMPLATE_KEY = 'proposition_contrat';
export const CONTRAT_SIGNE_TEMPLATE_KEY = 'contrat_signature_confirm';

/** Variables remplies par `useContractProposal` : sans elles la proposition n'a ni montant ni lien. */
export const PROPOSITION_CONTRAT_PLACEHOLDERS_REQUIS = Object.freeze(['{{EQUIP_RECAP}}', '{{TOTAL_AMOUNT}}', '{{PDF_URL}}']);

export const DEFAULT_PROPOSITION_CONTRAT_EMAIL = Object.freeze({
  key: PROPOSITION_CONTRAT_TEMPLATE_KEY,
  label: 'Proposition de contrat d’entretien (envoi au client)',
  subject: 'Votre proposition de contrat d’entretien — {{BRAND_NAME}}',
  html_body: [
    '<p>{{SALUTATION}}</p>',
    '<p>Nous vous avons préparé une proposition de contrat d’entretien pour votre installation.</p>',
    '<p><strong>Équipement concerné</strong> : {{EQUIP_RECAP}}<br><strong>Montant annuel TTC</strong> : {{TOTAL_AMOUNT}}</p>',
    '<p style="text-align:center;margin:28px 0">',
    '<a href="{{PDF_URL}}" style="background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Consulter ma proposition</a>',
    '</p>',
    '<p>Un appareil entretenu chaque année tombe moins souvent en panne, consomme moins et dure plus longtemps.</p>',
    '<p>Pour toute question ou pour souscrire, répondez à cet e-mail.</p>',
    '<p>À bientôt,<br>{{BRAND_NAME}}</p>',
  ].join('\n'),
  is_transactional: true,
});

export const DEFAULT_CONTRAT_SIGNE_EMAIL = Object.freeze({
  key: CONTRAT_SIGNE_TEMPLATE_KEY,
  label: 'Contrat d’entretien signé (confirmation au client)',
  subject: 'Votre contrat d’entretien — {{BRAND_NAME}}',
  html_body: [
    '<p>Bonjour {{CLIENT_NAME}},</p>',
    '<p>Nous vous confirmons la signature de votre contrat d’entretien annuel et nous vous en remercions.</p>',
    '<p><strong>Votre contrat signé est joint à cet e-mail.</strong></p>',
    '<p>Nous vous recontacterons chaque année pour programmer votre entretien. Pour toute question, répondez à cet e-mail.</p>',
    '<p>À bientôt,<br>{{BRAND_NAME}}</p>',
  ].join('\n'),
  is_transactional: true,
});
