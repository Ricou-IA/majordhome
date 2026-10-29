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
// E-mails du process (rendus par l'edge, `variablesCommande`) : + la ligne « Livraison : … » / « Retrait : … »
// entière, vide quand il n'y a rien à dire (jamais de libellé orphelin dans un gabarit).
const PROCESS = [...COMMUNS, '{{DELIVERY_LINE}}'];
const BRANDING = ['{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}'];

/**
 * Placeholders disponibles par gabarit (affichés en chips dans l'éditeur).
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const WEBSHOP_EMAIL_PLACEHOLDERS = Object.freeze({
  webshop_confirmation: Object.freeze([...COMMUNS, '{{DELIVERY_INFO}}', '{{LEGAL_INFO}}', ...BRANDING]),
  webshop_expedition_colis: Object.freeze([...PROCESS, ...BRANDING]),
  webshop_livraison_colis: Object.freeze([...PROCESS, ...BRANDING]),
  webshop_expedition_palette: Object.freeze([...PROCESS, ...BRANDING]),
  webshop_livraison_palette: Object.freeze([...PROCESS, ...BRANDING]),
  // Feuille de route : rendue par le site Mayer (lib/boutique/livraison/emails-tournee.ts).
  // {{ARRETS}} = liste des arrêts (HTML) ; {{KM_ESTIMES}} = paragraphe, vide si inconnu.
  webshop_feuille_route: Object.freeze([
    '{{TOURNEE_DATE}}', '{{SECTEUR}}', '{{DEPOT}}', '{{NB_ARRETS}}', '{{NB_EMPLACEMENTS}}', '{{ARRETS}}',
    '{{KM_ESTIMES}}', '{{ITINERAIRE_URL}}', '{{ALERTES}}', ...BRANDING,
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
      '{{DELIVERY_INFO}}',
      '{{LEGAL_INFO}}',
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
      '{{DELIVERY_LINE}}',
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
    'Votre livraison est en route — commande {{ORDER_NUMBER}}',
    [
      '<p>Bonjour {{CLIENT_NAME}},</p>',
      '<p>Notre camion est parti : votre livraison de la commande <strong>{{ORDER_NUMBER}}</strong> est en route.</p>',
      '{{ITEMS}}',
      '{{DELIVERY_LINE}}',
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
    'Feuille de route du {{TOURNEE_DATE}} — {{SECTEUR}} ({{NB_ARRETS}} arrêt(s), {{NB_EMPLACEMENTS}} emplacement(s))',
    [
      '<p>Bonjour,</p>',
      '<p>Voici la tournée du <strong>{{TOURNEE_DATE}}</strong> — secteur {{SECTEUR}}.</p>',
      '<p>Départ : {{DEPOT}}. {{NB_ARRETS}} arrêt(s), {{NB_EMPLACEMENTS}} emplacement(s) palette.</p>',
      '{{KM_ESTIMES}}',
      '{{ALERTES}}',
      '{{ARRETS}}',
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

// ----------------------------------------------------------------------------
// Confirmation de commande : blocs {{DELIVERY_INFO}} et {{LEGAL_INFO}}.
// Textes par défaut repris de l'ancienne confirmation du site Mayer (sans perte :
// date indicative, date changée, planification manuelle, retrait, mixte,
// commentaire, charte palettes, CGV + rétractation). Jetons {minuscule} remplis
// en une passe par des valeurs échappées.
// ----------------------------------------------------------------------------

/** Chemins du site (identiques à l'ancienne confirmation du site Mayer). */
const WEBSHOP_SITE_CHEMINS = Object.freeze({ cgv: '/boutique/cgv', charte: '/boutique/livraison/charte' });

/** Phrases client par défaut de la confirmation. @type {Readonly<Record<string, string>>} */
export const WEBSHOP_CONFIRMATION_TEXTES = Object.freeze({
  palette_date: '<p><strong>Vos palettes</strong> : livraison prévue le <strong>{date}</strong> (date indicative) à l\'adresse : {adresse}. Le transporteur vous contactera pour confirmer la date et l\'heure de livraison.</p>',
  palette_date_changee: '<p><strong>Vos palettes</strong> : la date que vous aviez choisie n\'était plus disponible au moment du paiement. Livraison prévue le <strong>{date}</strong> (date indicative) à l\'adresse : {adresse}. Le transporteur vous contactera pour confirmer la date et l\'heure de livraison. Si cette date ne vous convient pas, répondez à cet email.</p>',
  palette_manuelle: '<p><strong>Vos palettes</strong> : Nous vous appelons sous 48 h pour convenir d\'une date de livraison à l\'adresse : {adresse}.</p>',
  palette_manuelle_changee: '<p><strong>Vos palettes</strong> : la date que vous aviez choisie n\'était plus disponible au moment du paiement et aucune autre date n\'est ouverte sur votre secteur. Nous vous appelons sous 48 h pour convenir d\'une date de livraison à l\'adresse : {adresse}.</p>',
  palette_sans_date: '<p><strong>Vos palettes</strong> seront livrées à l\'adresse : {adresse}. Votre date de livraison vous sera confirmée par email.</p>',
  palette_retrait: '<p><strong>Vos palettes</strong> sont à retirer : {point}. Nous vous appelons pour convenir d\'un créneau.</p>',
  palette_retrait_sans_point: '<p><strong>Vos palettes</strong> sont à retirer. Nous vous appelons pour convenir d\'un créneau.</p>',
  accessoires_livraison: '<p><strong>Vos accessoires</strong> seront expédiés à : {adresse}.</p>',
  accessoires_retrait: '<p><strong>Vos accessoires</strong> sont à retirer : {point}.</p>',
  accessoires_retrait_sans_point: '<p><strong>Vos accessoires</strong> sont à retirer. Nous vous appelons pour convenir d\'un créneau.</p>',
  commentaire: '<p><em>Votre commentaire : {commentaire}</em></p>',
  charte: '<p>Le jour de la livraison, la palette est déposée entière au plus près de votre lieu de stockage par le chariot élévateur du camion. Rappel des conditions d\'accès : {lien_charte}.</p>',
  charte_lien: 'charte de livraison des palettes',
  cgv: '<p style="font-size:13px;color:#666">Conditions générales de vente et droit de rétractation de 14 jours : {lien_cgv}.</p>',
  cgv_sans_lien: 'consultables sur notre site',
});

/** @param {unknown} s @returns {string} */
function echapper(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Remplit les jetons `{nom}` en une passe (une valeur n'est jamais re-substituée).
 * @param {string} texte @param {Record<string, string>} valeurs (déjà prêtes pour du HTML)
 */
function remplir(texte, valeurs) {
  return texte.replace(/\{([a-z_]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(valeurs, k) ? valeurs[k] : m));
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « mardi 3 novembre 2026 » depuis YYYY-MM-DD ; '' si illisible. @param {unknown} iso */
function dateLongue(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return '';
  return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Lien `<a>` échappé, ou le libellé seul si l'URL n'est pas http(s). @param {string} url @param {string} libelle */
function lien(url, libelle) {
  return /^https?:\/\//.test(url) ? `<a href="${echapper(url)}">${libelle}</a>` : libelle;
}

/**
 * Blocs de la confirmation de commande : paragraphes livraison / retrait et mentions.
 * - `order` : modes `pallet_delivery_mode` / `parcel_delivery_mode` ('delivery' | 'pickup' | null),
 *   `address`, `postal_code`, `city`, `geocoded_address?.label`, `delivery_slot_changed`,
 *   `needs_manual_planning`, `comments`.
 * - `lines` (optionnel) : si fourni, un mode n'est cité que si la commande a des lignes de ce type
 *   (`shippingKind` ou `shipping_kind` 'pallet' / 'parcel').
 * - `slot` : `{ date: 'YYYY-MM-DD' }` de la tournée palette, ou null.
 * - `pickupPoint` : `{ name, address?, openingHours? }` ou null.
 * - `siteUrl` : origine du site (`settings.webshop.site_url`), `/` final toléré ; vide → mentions sans lien.
 * Toutes les valeurs sont échappées.
 * @param {{
 *   order: any, lines?: any[] | null, slot?: { date?: string } | null,
 *   pickupPoint?: { name?: string, address?: string, openingHours?: string | null } | null,
 *   siteUrl?: string | null,
 * }} p
 * @returns {{ livraisonHtml: string, mentionsHtml: string }}
 */
export function blocsConfirmation({ order, lines = null, slot = null, pickupPoint = null, siteUrl = '' }) {
  const o = order ?? {};
  const T = WEBSHOP_CONFIRMATION_TEXTES;
  const site = String(siteUrl ?? '').trim().replace(/\/+$/, '');
  const aDes = (/** @type {string} */ kind) => !Array.isArray(lines)
    || lines.some((l) => (l?.shippingKind ?? l?.shipping_kind) === kind);
  const palette = aDes('pallet') ? o.pallet_delivery_mode : null;
  const accessoires = aDes('parcel') ? o.parcel_delivery_mode : null;

  const ville = [o.postal_code, o.city].filter(Boolean).join(' ');
  const adresseSaisie = [o.address, ville].filter(Boolean).join(', ');
  const adressePalette = o.geocoded_address?.label || adresseSaisie;
  const p = pickupPoint ?? null;
  const point = (/** @type {boolean} */ horaires) => (p?.name
    ? [p.name, p.address].filter(Boolean).join(', ') + (horaires && p.openingHours ? ` (${p.openingHours})` : '')
    : '');

  const parts = [];
  if (palette === 'delivery') {
    const adresse = echapper(adressePalette);
    const date = dateLongue(slot?.date);
    // Ordre des cas : planification manuelle d'abord (aucune tournée), puis date changée, puis date connue.
    if (o.needs_manual_planning) parts.push(remplir(o.delivery_slot_changed ? T.palette_manuelle_changee : T.palette_manuelle, { adresse }));
    else if (date) parts.push(remplir(o.delivery_slot_changed ? T.palette_date_changee : T.palette_date, { adresse, date: echapper(date) }));
    else parts.push(remplir(T.palette_sans_date, { adresse }));
  } else if (palette === 'pickup') {
    const pt = point(true);
    parts.push(pt ? remplir(T.palette_retrait, { point: echapper(pt) }) : T.palette_retrait_sans_point);
  }
  if (accessoires === 'delivery') {
    parts.push(remplir(T.accessoires_livraison, { adresse: echapper(adresseSaisie) }));
  } else if (accessoires === 'pickup') {
    const pt = point(false);
    parts.push(pt ? remplir(T.accessoires_retrait, { point: echapper(pt) }) : T.accessoires_retrait_sans_point);
  }
  const commentaire = typeof o.comments === 'string' ? o.comments.trim() : '';
  if (commentaire) parts.push(remplir(T.commentaire, { commentaire: echapper(commentaire) }));

  const mentions = [];
  if (palette === 'delivery') {
    mentions.push(remplir(T.charte, { lien_charte: lien(site ? site + WEBSHOP_SITE_CHEMINS.charte : '', T.charte_lien) }));
  }
  const urlCgv = site ? site + WEBSHOP_SITE_CHEMINS.cgv : '';
  const libelleCgv = /^https?:\/\//.test(urlCgv) ? echapper(urlCgv.replace(/^https?:\/\/(www\.)?/, '')) : T.cgv_sans_lien;
  mentions.push(remplir(T.cgv, { lien_cgv: lien(urlCgv, libelleCgv) }));

  return { livraisonHtml: parts.join('\n'), mentionsHtml: mentions.join('\n') };
}

/**
 * Garde légale de la confirmation : les mentions CGV / rétractation ne dépendent pas du gabarit de l'org.
 * Corps sans `{{LEGAL_INFO}}` (variable retirée, gabarit antérieur) → le bloc est ajouté en fin de corps
 * (`ajoutees: true`, à signaler par l'appelant). `{{LEGAL_INFO}}` est déjà fait de paragraphes : pas de `<p>`
 * englobant (paragraphes imbriqués invalides).
 * @param {string | null | undefined} htmlBody
 * @returns {{ html: string, ajoutees: boolean }}
 */
export function garantirMentionsLegales(htmlBody) {
  const html = String(htmlBody ?? '');
  if (html.includes('{{LEGAL_INFO}}')) return { html, ajoutees: false };
  return { html: html ? `${html}\n{{LEGAL_INFO}}` : '{{LEGAL_INFO}}', ajoutees: true };
}
