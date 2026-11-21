// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/emailsAutomatiques.js — ne pas éditer.
// src/lib/emailsAutomatiques.js
// ============================================================================
// Registre des e-mails envoyés automatiquement (ou d'un clic) au nom de
// l'entreprise : SEULE liste, lue par l'écran Réglages → Emails et par les edges.
//
// Le texte d'un e-mail vit dans `majordhome_mail_campaigns` (is_transactional)
// quand l'entreprise l'a personnalisé ; SINON c'est le texte par défaut du
// registre qui part (`texteEffectif`). Avant le 2026-11-21 la ligne n'existait
// qu'après un clic sur « Modifier le texte » et, sans elle, l'envoi était refusé
// (`template_missing`) : une entreprise qui arrivait ne pouvait rien envoyer.
//
// Ajouter un e-mail = une entrée ici (texte par défaut dans son module métier,
// valeurs d'exemple pour l'essai) + l'edge qui l'envoie lit `chargerTexteEmail`
// (`_shared/texteEmail.ts`). Les e-mails de la boutique gardent leur propre
// écran (Réglages → Webshop) et ne sont pas ici.
//
// Module PUR, copié pour Deno par `npm run sync:tournee-engine` (PARTAGES) avec
// les modules qu'il importe — ne jamais éditer la copie.
// ============================================================================
import { DEFAULT_INVOICE_EMAIL } from './invoiceEmailTemplate.js';
import { DEFAULT_AUTO_RDV_EMAIL, DEFAULT_AUTO_RDV_CONFIRMATION_EMAIL } from './autoRdvEmailTemplates.js';
import { DEFAULT_PV_RECEPTION_EMAIL, DEFAULT_PV_LEVEE_EMAIL } from './pvReception.js';
import { DEFAULT_RAPPORT_SAV_EMAIL } from './rapportSav.js';
import { DEFAULT_DPE_RAPPORT_EMAIL } from './dpeRapportEmailTemplate.js';
import { DEFAULT_LEAD_WELCOME_EMAIL } from './leadWelcomeEmail.js';
import { DEFAULT_PROPOSITION_CONTRAT_EMAIL, DEFAULT_CONTRAT_SIGNE_EMAIL } from './contratEmailTemplates.js';

/**
 * Variables de l'entreprise, remplies pour tout e-mail (`brandingReplacements` de `_shared/mail.ts` :
 * le test du registre tient les deux listes alignées).
 */
export const VARIABLES_MARQUE = Object.freeze([
  '{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}',
  '{{ORG_WEBSITE_URL}}', '{{ACCENT_COLOR}}', '{{SECONDARY_COLOR}}', '{{EMAIL_TAGLINE}}', '{{LOGO_URL}}',
]);

/**
 * @typedef {{ key: string, label: string, subject: string, html_body: string, is_transactional: boolean }} GabaritEmail
 * @typedef {{
 *   gabarit: Readonly<GabaritEmail>,
 *   titre: string,
 *   description: string,
 *   module: string | null,
 *   interrupteur: string | null,
 *   exemple: Readonly<Record<string, string>>,
 * }} EmailAutomatique
 */

const LIEN_EXEMPLE = 'https://example.com/';

/**
 * @param {Readonly<GabaritEmail>} gabarit texte par défaut
 * @param {string} titre ce que fait l'e-mail, en mots d'artisan
 * @param {string} description quand il part
 * @param {Record<string, string>} exemple valeurs d'essai des variables propres à cet e-mail
 * @param {{ module?: string | null, interrupteur?: string | null }} [options] `module` : clé du module
 *   sans lequel l'e-mail ne sert pas (masqué) ; `interrupteur` : l'e-mail a un réglage marche / arrêt à l'écran
 * @returns {Readonly<EmailAutomatique>}
 */
function entree(gabarit, titre, description, exemple, options = {}) {
  return Object.freeze({
    gabarit, titre, description,
    module: options.module ?? null,
    interrupteur: options.interrupteur ?? null,
    exemple: Object.freeze({ ...exemple }),
  });
}

/** @type {ReadonlyArray<Readonly<EmailAutomatique>>} */
export const EMAILS_AUTOMATIQUES = Object.freeze([
  entree(DEFAULT_PROPOSITION_CONTRAT_EMAIL,
    'Envoyer une proposition de contrat d’entretien',
    'Utilisé par « Envoyer la proposition » : le client reçoit le montant annuel et un lien vers la proposition.',
    { '{{SALUTATION}}': 'Bonjour Jean Dupont,', '{{EQUIP_RECAP}}': 'Poêle à granulés', '{{TOTAL_AMOUNT}}': '180,00 €', '{{PDF_URL}}': LIEN_EXEMPLE },
    { module: 'entretiens' }),
  entree(DEFAULT_CONTRAT_SIGNE_EMAIL,
    'Confirmer au client la signature de son contrat',
    'Envoyé quand le client a signé son contrat d’entretien : le contrat signé part en pièce jointe.',
    { '{{CLIENT_NAME}}': 'Jean Dupont' },
    { module: 'entretiens' }),
  entree(DEFAULT_INVOICE_EMAIL,
    'Envoyer la facture d’entretien au client',
    'Utilisé quand vous envoyez une facture d’entretien par e-mail depuis la carte.',
    {
      '{{CLIENT_NAME}}': 'Jean Dupont', '{{INVOICE_NUMBER}}': 'F-2026-00042', '{{INVOICE_AMOUNT}}': '180,00 €',
      '{{INVOICE_DATE}}': '21/11/2026', '{{EQUIPMENTS}}': 'Poêle à granulés', '{{ATTACHMENTS}}': 'facture, certificat d’entretien',
    },
    { module: 'entretiens' }),
  entree(DEFAULT_AUTO_RDV_EMAIL,
    'Inviter le client à choisir son rendez-vous d’entretien',
    'Envoyé chaque mois aux clients dont l’entretien arrive, si la prise de rendez-vous en ligne est activée (Réglages → Tournées).',
    { '{{PRENOM}}': 'Jean', '{{EQUIPEMENTS}}': 'poêle à granulés', '{{MOIS}}': 'décembre 2026', '{{LIEN_RDV}}': LIEN_EXEMPLE },
    { module: 'entretiens' }),
  entree(DEFAULT_AUTO_RDV_CONFIRMATION_EMAIL,
    'Confirmer le rendez-vous choisi en ligne',
    'Envoyé quand le client a choisi sa demi-journée.',
    { '{{PRENOM}}': 'Jean', '{{DATE_RDV}}': 'mardi 8 décembre 2026', '{{DEMI_JOURNEE}}': 'le matin', '{{TECHNICIEN}}': 'notre technicien' },
    { module: 'entretiens' }),
  entree(DEFAULT_PV_RECEPTION_EMAIL,
    'Faire signer le PV de réception au client',
    'Utilisé par « Envoyer au client » de la fiche chantier : le client signe la réception des travaux depuis le lien, sur son téléphone.',
    { '{{PRENOM}}': 'Jean', '{{OBJET}}': 'poêle à granulés', '{{LIEN_PV}}': LIEN_EXEMPLE }),
  entree(DEFAULT_PV_LEVEE_EMAIL,
    'Demander au client de confirmer la levée des réserves',
    'Utilisé par « Demander la levée » de la fiche chantier : le client confirme depuis le lien, sur son téléphone, que ses réserves sont levées.',
    { '{{PRENOM}}': 'Jean', '{{OBJET}}': 'poêle à granulés', '{{LIEN_PV}}': LIEN_EXEMPLE }),
  entree(DEFAULT_RAPPORT_SAV_EMAIL,
    'Envoyer le rapport d’intervention SAV au client',
    'Utilisé par « Envoyer au client » de la fenêtre Rapport d’intervention d’une demande SAV réalisée : le rapport part en pièce jointe.',
    { '{{CLIENT_NAME}}': 'Jean Dupont', '{{DATE_INTERVENTION}}': '21/11/2026', '{{APPAREIL}}': 'votre poêle à granulés' },
    { module: 'entretiens' }),
  entree(DEFAULT_DPE_RAPPORT_EMAIL,
    'Envoyer l’analyse MonsieurDPE du logement au client',
    'Utilisé par « Envoyer le rapport au client » de la fiche client : le PDF de l’analyse complète part en pièce jointe.',
    { '{{CLIENT_NAME}}': 'Jean Dupont', '{{LIEN_RAPPORT}}': LIEN_EXEMPLE, '{{NUMERO_DPE}}': '2681E0000000A', '{{ETIQUETTE_DPE}}': 'D' },
    { module: 'dpe' }),
  entree(DEFAULT_LEAD_WELCOME_EMAIL,
    'Confirmer leur demande aux prospects Facebook et Instagram',
    'Un e-mail part automatiquement après chaque nouvelle demande reçue par une publicité.',
    { '{{PRENOM}}': 'Jean' },
    { interrupteur: 'lead_welcome_email' }),
]);

/**
 * @param {string} cle clé du texte (`mail_campaigns.key`)
 * @returns {Readonly<EmailAutomatique> | null}
 */
export function emailAutomatique(cle) {
  return EMAILS_AUTOMATIQUES.find((e) => e.gabarit.key === cle) ?? null;
}

/**
 * Texte qui part : celui de l'entreprise s'il a un objet ET un corps, sinon le défaut du registre.
 * `null` seulement pour une clé hors registre sans ligne exploitable (l'appelant refuse l'envoi).
 * @param {{ subject?: string | null, html_body?: string | null } | null | undefined} ligne ligne NON archivée
 *   de `mail_campaigns` pour cette clé, ou rien
 * @param {string} cle
 * @returns {{ subject: string, html_body: string, source: 'entreprise' | 'defaut' } | null}
 */
export function texteEffectif(ligne, cle) {
  const subject = String(ligne?.subject ?? '').trim();
  const corps = String(ligne?.html_body ?? '');
  if (subject && corps.trim()) return { subject, html_body: corps, source: 'entreprise' };
  const defaut = emailAutomatique(cle)?.gabarit;
  return defaut ? { subject: defaut.subject, html_body: defaut.html_body, source: 'defaut' } : null;
}

/**
 * E-mails à présenter à une entreprise : ceux dont le module est ouvert.
 * @param {(cleModule: string) => boolean} moduleOuvert ex. `(m) => moduleActif(settings, m)`
 * @returns {ReadonlyArray<Readonly<EmailAutomatique>>}
 */
export function emailsAffiches(moduleOuvert) {
  return EMAILS_AUTOMATIQUES.filter((e) => !e.module || moduleOuvert(e.module));
}

/**
 * Variables `{{NOM}}` citées dans un texte, sans doublon.
 * @param {string} texte
 * @returns {string[]}
 */
export function variablesDe(texte) {
  return [...new Set(String(texte ?? '').match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [])];
}

/** Codes renvoyés par l'edge `email-essai` → message affiché. Un code ajouté d'un côté s'ajoute de l'autre. */
export const ESSAI_CODES = Object.freeze({
  email_inconnu: 'Cet e-mail n’existe pas.',
  module_communication_inactif: 'Le module Communication n’est pas ouvert pour votre entreprise.',
  no_from_email: 'Renseignez d’abord votre adresse d’envoi, en haut de cette page.',
  destinataire_inconnu: 'Votre compte n’a pas d’adresse e-mail : l’essai ne peut pas vous être envoyé.',
  texte_illisible: 'Le texte de cet e-mail n’a pas pu être lu. Réessayez.',
  envoi_refuse: 'L’envoi a été refusé.',
});

/**
 * @param {string | null | undefined} code code de l'edge `email-essai`
 * @param {string | null} [detail] précision du service d'envoi (domaine non vérifié…)
 * @returns {string}
 */
export function messageErreurEssai(code, detail = null) {
  const base = ESSAI_CODES[/** @type {keyof typeof ESSAI_CODES} */ (code)] ?? 'L’essai n’a pas pu être envoyé.';
  return detail ? `${base} ${detail}` : base;
}
