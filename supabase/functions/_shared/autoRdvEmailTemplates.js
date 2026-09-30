// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/autoRdvEmailTemplates.js — ne pas éditer.
// src/lib/autoRdvEmailTemplates.js
// ============================================================================
// Gabarits transactionnels de l'auto-RDV (spec 2026-09-29 § 4.1, § 4.2), même
// patron que invoiceEmailTemplate.js : rangés dans `majordhome_mail_campaigns`
// (is_transactional = true, exclus du broadcast), créés depuis Settings →
// Communication → Emails, modifiables dans Mailing → Éditeur. Placeholders
// {{UPPER_SNAKE}} : ceux-ci + le branding (mail.ts::brandingReplacements).
// Module PUR, copié pour Deno (PARTAGES) : l'edge auto-rdv-cron lit les clés.
// ============================================================================

export const AUTO_RDV_TEMPLATE_KEY = 'auto_rdv';
export const AUTO_RDV_CONFIRMATION_TEMPLATE_KEY = 'auto_rdv_confirmation';

/** Placeholders propres à l'invitation (en plus du branding). */
export const AUTO_RDV_PLACEHOLDERS = Object.freeze([
  '{{PRENOM}}', '{{NOM}}', '{{EQUIPEMENTS}}', '{{MOIS}}', '{{LIEN_RDV}}',
]);

/** Placeholders propres à la confirmation (en plus du branding). */
export const AUTO_RDV_CONFIRMATION_PLACEHOLDERS = Object.freeze([
  '{{PRENOM}}', '{{DATE_RDV}}', '{{DEMI_JOURNEE}}', '{{TECHNICIEN}}',
]);

export const DEFAULT_AUTO_RDV_EMAIL = Object.freeze({
  key: AUTO_RDV_TEMPLATE_KEY,
  label: 'Auto-RDV — invitation mensuelle',
  subject: 'Votre entretien annuel : choisissez votre demi-journée',
  html_body: [
    '<p>Bonjour {{PRENOM}},</p>',
    '<p>C’est le moment de l’entretien annuel de votre {{EQUIPEMENTS}}. Pour vous éviter les allers-retours au téléphone,',
    ' choisissez directement la demi-journée qui vous convient parmi celles où notre technicien passe dans votre secteur en {{MOIS}}.</p>',
    '<p style="text-align:center;margin:28px 0">',
    '<a href="{{LIEN_RDV}}" style="background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Choisir ma demi-journée</a>',
    '</p>',
    '<p>Nous vous confirmerons l’heure exacte de passage par SMS quelques jours avant. Si aucune demi-journée ne vous convient,',
    ' appelez-nous au {{ORG_PHONE}} : nous trouverons une date ensemble.</p>',
    '<p>À bientôt,<br>{{BRAND_NAME}}</p>',
  ].join(''),
  is_transactional: true,
});

export const DEFAULT_AUTO_RDV_CONFIRMATION_EMAIL = Object.freeze({
  key: AUTO_RDV_CONFIRMATION_TEMPLATE_KEY,
  label: 'Auto-RDV — confirmation du rendez-vous',
  subject: 'Votre entretien est prévu le {{DATE_RDV}}',
  html_body: [
    '<p>Bonjour {{PRENOM}},</p>',
    '<p>C’est noté : votre entretien aura lieu le <strong>{{DATE_RDV}}, {{DEMI_JOURNEE}}</strong>, avec {{TECHNICIEN}}.</p>',
    '<p>L’heure exacte de passage vous sera envoyée par SMS quelques jours avant. Pour tout changement, appelez-nous au {{ORG_PHONE}}.</p>',
    '<p>À bientôt,<br>{{BRAND_NAME}}</p>',
  ].join(''),
  is_transactional: true,
});

/** Les gabarits transactionnels à proposer dans Settings → Communication → Emails. */
export const AUTO_RDV_EMAIL_TEMPLATES = Object.freeze([DEFAULT_AUTO_RDV_EMAIL, DEFAULT_AUTO_RDV_CONFIRMATION_EMAIL]);
