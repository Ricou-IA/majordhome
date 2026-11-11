// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/dpeRapportEmailTemplate.js — ne pas éditer.
// Gabarit PAR DÉFAUT de l'e-mail « Rapport MonsieurDPE » (module Communication). Même patron que
// invoiceEmailTemplate.js : campagne transactionnelle `rapport_dpe` de l'org, créée d'un clic dans
// Settings → Communication → Emails, éditable dans Mailing → Éditeur. Le PDF du rapport complet MonsieurDPE
// part en pièce jointe (edge dpe-lien, action `envoyer`). Module PUR, copié pour Deno (PARTAGES).
// Spec : docs/superpowers/specs/2026-11-12-logement-monsieurdpe-fiche-client-design.md §8.

export const DPE_RAPPORT_EMAIL_TEMPLATE_KEY = 'rapport_dpe';

export const DPE_RAPPORT_EMAIL_PLACEHOLDERS = Object.freeze([
  '{{CLIENT_NAME}}', '{{LIEN_RAPPORT}}', '{{NUMERO_DPE}}', '{{ETIQUETTE_DPE}}',
  '{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}', '{{ORG_WEBSITE_URL}}',
]);

export const DEFAULT_DPE_RAPPORT_EMAIL = Object.freeze({
  key: DPE_RAPPORT_EMAIL_TEMPLATE_KEY,
  label: 'Rapport MonsieurDPE (envoi au client)',
  subject: 'L’analyse complète de votre logement — {{BRAND_NAME}}',
  html_body: [
    '<p>Bonjour {{CLIENT_NAME}},</p>',
    '<p>Vous trouverez ci-joint l’analyse complète de votre logement, établie par MonsieurDPE à partir de votre diagnostic de performance énergétique (n° {{NUMERO_DPE}}, étiquette {{ETIQUETTE_DPE}}).</p>',
    '<p>Elle détaille où part la chaleur, les valeurs du diagnostic qui mériteraient d’être vérifiées et les travaux qui amélioreraient votre étiquette. Vous pouvez aussi la consulter en ligne : <a href="{{LIEN_RAPPORT}}">ouvrir l’analyse</a>.</p>',
    '<p>Nous restons à votre disposition pour en parler, au {{ORG_PHONE}} ou par e-mail à {{ORG_EMAIL}}.</p>',
    '<p>{{BRAND_NAME}}<br>{{ORG_ADDRESS}}, {{ORG_POSTAL_CODE}} {{ORG_CITY}}</p>',
  ].join('\n'),
  is_transactional: true,
});
