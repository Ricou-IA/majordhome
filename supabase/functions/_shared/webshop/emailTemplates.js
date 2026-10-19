// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/webshop/emailTemplates.js — ne pas éditer.
// src/lib/webshop/emailTemplates.js
// ============================================================================
// Gabarits PAR DÉFAUT des e-mails du webshop (étape 2), même patron que
// src/lib/invoiceEmailTemplate.js : rangés dans `mail_campaigns`
// (is_transactional = true, exclus du broadcast), créés d'un clic depuis
// Settings → Webshop → Process, édités dans Mailing → Éditeur. Le corps est
// habillé par le squelette d'e-mail de l'org (pas de <html>). Placeholders
// {{UPPER_SNAKE}} : valeurs fournies par `variablesCommande` (process.js), ou
// par le site Mayer pour la confirmation et la feuille de route.
// Module PUR, copié pour Deno (_shared/webshop/) par sync-tournee-engine.
// ============================================================================
import { WEBSHOP_EMAIL_KEYS } from './reglages.js';

export { WEBSHOP_EMAIL_KEYS };

/**
 * @typedef {'client' | 'transporteur' | 'prestataire'} DestinataireGabarit
 * @typedef {{
 *   key: string, label: string, subject: string, html_body: string,
 *   is_transactional: true, destinataire: DestinataireGabarit,
 * }} GabaritWebshop
 */

const COMMUNS = ['{{CLIENT_NAME}}', '{{ORDER_NUMBER}}', '{{ITEMS}}', '{{DELIVERY_DATE}}', '{{DELIVERY_ADDRESS}}', '{{PICKUP_POINT}}'];
const BRANDING = ['{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}'];

/**
 * Placeholders disponibles par gabarit (affichés en chips dans l'éditeur).
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const WEBSHOP_EMAIL_PLACEHOLDERS = Object.freeze({
  webshop_confirmation: Object.freeze([...COMMUNS, ...BRANDING]),
  webshop_expedition_colis: Object.freeze([...COMMUNS, ...BRANDING]),
  webshop_livraison_colis: Object.freeze([...COMMUNS, ...BRANDING]),
  webshop_expedition_palette: Object.freeze([...COMMUNS, ...BRANDING]),
  webshop_livraison_palette: Object.freeze([...COMMUNS, ...BRANDING]),
  webshop_feuille_route: Object.freeze([
    '{{TOURNEE_DATE}}', '{{SECTEUR}}', '{{NB_ARRETS}}', '{{ITINERAIRE_URL}}', '{{ALERTES}}', ...BRANDING,
  ]),
  webshop_ordre_colis: Object.freeze([
    ...COMMUNS, ...BRANDING,
    '{{DEPOT_NAME}}', '{{DEPOT_ADDRESS}}', '{{PARCELS_TABLE}}', '{{TOTAL_WEIGHT}}', '{{DECLARED_VALUE}}',
    '{{CLIENT_PHONE}}', '{{CLIENT_EMAIL}}',
  ]),
});

const CONTACT = '<p>Une question ? Contactez-nous au {{ORG_PHONE}} ou par e-mail à {{ORG_EMAIL}}.</p>';
const SIGNATURE = '<p>À bientôt,<br>{{BRAND_NAME}}</p>';

/**
 * @param {string} key @param {DestinataireGabarit} destinataire @param {string} label
 * @param {string} subject @param {string[]} corps
 * @returns {Readonly<GabaritWebshop>}
 */
function gabarit(key, destinataire, label, subject, corps) {
  return Object.freeze({ key, label, subject, html_body: corps.join('\n'), is_transactional: /** @type {true} */ (true), destinataire });
}

/**
 * Gabarits par défaut, indexés par clé.
 * @type {Readonly<Record<string, Readonly<GabaritWebshop>>>}
 */
export const WEBSHOP_EMAIL_DEFAULTS = Object.freeze({
  webshop_confirmation: gabarit('webshop_confirmation', 'client',
    'Boutique — confirmation de commande (client)',
    'Votre commande {{ORDER_NUMBER}} est confirmée — {{BRAND_NAME}}',
    [
      '<p>Bonjour {{CLIENT_NAME}},</p>',
      '<p>Merci pour votre commande <strong>{{ORDER_NUMBER}}</strong>. Votre paiement est bien reçu.</p>',
      '<p>Récapitulatif :</p>',
      '{{ITEMS}}',
      '<p>Livraison : {{DELIVERY_ADDRESS}}</p>',
      '<p>Nous vous préviendrons par e-mail à chaque étape de l’expédition.</p>',
      CONTACT,
      SIGNATURE,
    ]),
  webshop_expedition_colis: gabarit('webshop_expedition_colis', 'client',
    'Boutique — colis expédié (client)',
    'Votre colis est en route — commande {{ORDER_NUMBER}}',
    [
      '<p>Bonjour {{CLIENT_NAME}},</p>',
      '<p>Bonne nouvelle : les articles suivants de votre commande <strong>{{ORDER_NUMBER}}</strong> viennent d’être expédiés par colis.</p>',
      '{{ITEMS}}',
      '<p>Livraison : {{DELIVERY_ADDRESS}}</p>',
      CONTACT,
      SIGNATURE,
    ]),
  webshop_livraison_colis: gabarit('webshop_livraison_colis', 'client',
    'Boutique — colis livré (client)',
    'Votre colis est livré — commande {{ORDER_NUMBER}}',
    [
      '<p>Bonjour {{CLIENT_NAME}},</p>',
      '<p>Votre colis de la commande <strong>{{ORDER_NUMBER}}</strong> a été livré.</p>',
      '{{ITEMS}}',
      '<p>Un article manque ou est abîmé ? Signalez-le-nous sans attendre.</p>',
      CONTACT,
      SIGNATURE,
    ]),
  webshop_expedition_palette: gabarit('webshop_expedition_palette', 'client',
    'Boutique — livraison palette en route (client)',
    'Votre livraison arrive aujourd’hui — commande {{ORDER_NUMBER}}',
    [
      '<p>Bonjour {{CLIENT_NAME}},</p>',
      '<p>Notre camion est parti : votre livraison de la commande <strong>{{ORDER_NUMBER}}</strong> est prévue le {{DELIVERY_DATE}}.</p>',
      '{{ITEMS}}',
      '<p>Livraison : {{DELIVERY_ADDRESS}}</p>',
      '<p>Merci de prévoir un accès dégagé pour le déchargement.</p>',
      CONTACT,
      SIGNATURE,
    ]),
  webshop_livraison_palette: gabarit('webshop_livraison_palette', 'client',
    'Boutique — livraison palette effectuée (client)',
    'Votre commande {{ORDER_NUMBER}} est livrée',
    [
      '<p>Bonjour {{CLIENT_NAME}},</p>',
      '<p>Votre livraison de la commande <strong>{{ORDER_NUMBER}}</strong> a été effectuée.</p>',
      '{{ITEMS}}',
      '<p>Merci de votre confiance.</p>',
      CONTACT,
      SIGNATURE,
    ]),
  webshop_feuille_route: gabarit('webshop_feuille_route', 'transporteur',
    'Boutique — feuille de route (transporteur)',
    'Feuille de route du {{TOURNEE_DATE}} — {{SECTEUR}} — {{NB_ARRETS}} arrêt(s)',
    [
      '<p>Bonjour,</p>',
      '<p>Voici la tournée du <strong>{{TOURNEE_DATE}}</strong> — secteur {{SECTEUR}}, {{NB_ARRETS}} arrêt(s).</p>',
      '{{ALERTES}}',
      '<p><a href="{{ITINERAIRE_URL}}">Ouvrir l’itinéraire dans Google Maps</a></p>',
      '<p>La feuille de route détaillée et les bons de livraison sont en pièce jointe (PDF).</p>',
      '<p>Merci,<br>{{BRAND_NAME}} — {{ORG_PHONE}}</p>',
    ]),
  webshop_ordre_colis: gabarit('webshop_ordre_colis', 'prestataire',
    'Boutique — ordre d’expédition colis (prestataire)',
    'Ordre d’expédition — commande {{ORDER_NUMBER}} — {{BRAND_NAME}}',
    [
      '<p>Bonjour,</p>',
      '<p>Merci de prendre en charge l’expédition suivante.</p>',
      '<p><strong>Expéditeur (enlèvement)</strong><br>{{DEPOT_NAME}}<br>{{DEPOT_ADDRESS}}</p>',
      '<p><strong>Destinataire</strong><br>{{CLIENT_NAME}}<br>{{DELIVERY_ADDRESS}}<br>Tél. : {{CLIENT_PHONE}} — E-mail : {{CLIENT_EMAIL}}</p>',
      '<p><strong>Référence</strong> : commande {{ORDER_NUMBER}}</p>',
      '{{PARCELS_TABLE}}',
      '<p>Poids total : {{TOTAL_WEIGHT}} — Valeur déclarée : {{DECLARED_VALUE}}</p>',
      '<p>Pour toute question : {{ORG_PHONE}} ou {{ORG_EMAIL}}.</p>',
      '<p>Merci,<br>{{BRAND_NAME}}</p>',
    ]),
});
