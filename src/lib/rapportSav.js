// src/lib/rapportSav.js — rapport d'intervention SAV : ce que l'écran et l'edge `sav-report-send` partagent.
// Module PUR (aucun import), copié pour Deno par `npm run sync:tournee-engine` (PARTAGES) — ne jamais
// éditer la copie `supabase/functions/_shared/rapportSav.js`.
// Spec : docs/superpowers/specs/2026-11-19-rapport-intervention-sav-design.md
//
// Le contenu du rapport et sa mise en lettre vivent dans `rapportSavModel.js` (écran seulement).

/** Clé de `interventions.metadata` qui garde la trace du rapport (chemin, contenu, envoi). */
export const RAPPORT_SAV_METADATA_KEY = 'rapport_sav';

/** Carte qui peut porter un rapport : demande SAV (racine) en Réalisé ou facturée. */
export const STATUTS_RAPPORT_SAV = Object.freeze(['realise', 'facture']);

/**
 * @param {{ intervention_type?: string, workflow_status?: string, parent_id?: string|null }|null|undefined} carte
 * @returns {boolean}
 */
export function peutFaireRapportSav(carte) {
  return !!carte
    && carte.intervention_type === 'sav'
    && !carte.parent_id
    && STATUTS_RAPPORT_SAV.includes(carte.workflow_status);
}

/**
 * Trace du rapport gardée sur la carte, ou `null`.
 * @param {{ metadata?: Record<string, unknown>|null }|null|undefined} carte
 * @returns {{ path?: string, edite_le?: string, edite_par?: string|null, contenu?: object, envoye_le?: string, envoye_a?: string }|null}
 */
export function rapportDeCarte(carte) {
  const trace = carte?.metadata?.[RAPPORT_SAV_METADATA_KEY];
  return trace && typeof trace === 'object' && typeof trace.path === 'string' && trace.path ? trace : null;
}

// ── Gabarit PAR DÉFAUT de l'e-mail (même patron que dpeRapportEmailTemplate.js) ──
// Campagne transactionnelle `rapport_sav` de l'org, créée d'un clic dans Paramètres → Communication →
// Emails, modifiable dans Mailing → Éditeur. Le PDF archivé part en pièce jointe.

export const RAPPORT_SAV_EMAIL_TEMPLATE_KEY = 'rapport_sav';

export const RAPPORT_SAV_EMAIL_PLACEHOLDERS = Object.freeze([
  '{{CLIENT_NAME}}', '{{DATE_INTERVENTION}}', '{{APPAREIL}}',
  '{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}', '{{ORG_WEBSITE_URL}}',
]);

export const DEFAULT_RAPPORT_SAV_EMAIL = Object.freeze({
  key: RAPPORT_SAV_EMAIL_TEMPLATE_KEY,
  label: 'Rapport d’intervention SAV (envoi au client)',
  subject: 'Votre rapport d’intervention — {{BRAND_NAME}}',
  html_body: [
    '<p>Bonjour {{CLIENT_NAME}},</p>',
    '<p>Vous trouverez ci-joint le rapport de notre intervention du {{DATE_INTERVENTION}} sur {{APPAREIL}}.</p>',
    '<p>Nous restons à votre disposition pour toute question, au {{ORG_PHONE}} ou par e-mail à {{ORG_EMAIL}}.</p>',
    '<p>{{BRAND_NAME}}<br>{{ORG_ADDRESS}}, {{ORG_POSTAL_CODE}} {{ORG_CITY}}</p>',
  ].join('\n'),
  is_transactional: true,
});

const minuscule = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * `{{DATE_INTERVENTION}}` : `2026-11-12` → `12/11/2026` (chaîne vide si la date est absente ou mal formée).
 * @param {unknown} iso
 * @returns {string}
 */
export function dateInterventionFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * `{{APPAREIL}}` : « votre poêle à granulés EDILKAMIN Lena », « votre installation » à défaut.
 * @param {{ libelle?: string|null, marque?: string|null, modele?: string|null }|null|undefined} appareil
 * @returns {string}
 */
export function appareilPourEmail(appareil) {
  const morceaux = [minuscule(String(appareil?.libelle || '').trim()), String(appareil?.marque || '').trim(), String(appareil?.modele || '').trim()].filter(Boolean);
  return morceaux.length ? `votre ${morceaux.join(' ')}` : 'votre installation';
}

// ── Codes de l'edge ↔ messages (un code ajouté d'un côté s'ajoute de l'autre : test) ──

export const RAPPORT_SAV_CODES = Object.freeze({
  module_communication_inactif: 'Module Communication fermé pour cette organisation.',
  droit_requis: 'Vous n’avez pas le droit de modifier cette demande SAV.',
  carte_introuvable: 'Demande SAV introuvable.',
  carte_non_sav: 'Le rapport d’intervention ne concerne que les demandes SAV réalisées.',
  client_sans_email: 'Le client n’a pas d’adresse e-mail (fiche client).',
  no_from_email: 'Aucun e-mail expéditeur : Paramètres → E-mails & SMS.',
  rapport_absent: 'Aucun rapport archivé sur cette carte : éditez-le d’abord.',
  rapport_illisible: 'Le rapport archivé est illisible : éditez-le à nouveau.',
  template_missing: 'Texte de l’e-mail « Rapport d’intervention SAV » absent : créez-le dans Paramètres → E-mails & SMS.',
  resend_failed: 'L’envoi a échoué chez le prestataire d’e-mail. Réessayez dans un instant.',
  envoi_pas_en_service: 'L’envoi par e-mail n’est pas encore en service. Le rapport reste téléchargeable.',
});

/**
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function messageErreurRapportSav(code) {
  return RAPPORT_SAV_CODES[code] || 'L’envoi du rapport a échoué.';
}
