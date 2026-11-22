// src/lib/mailVariables.js
// ============================================================================
// Ce qu'un mail EST (sa nature) et ce que son texte peut citer : variables proposées à l'éditeur, libellés
// d'artisan, variables oubliées ou inconnues — SEULE définition (spec 2026-11-21-createur-mail-une-page-
// habillage-design.md §§ 5.3, 5.4). Module PUR (imports relatifs seulement), testé
// `scripts/mail-variables.test.mjs`. Non copié pour Deno : seul l'écran l'utilise.
//
// Quatre natures de texte par défaut, quatre jeux de variables :
//   - campagne manuelle / automatique / séquence : celles que `mailing-send` remplace à l'envoi
//     (`{{SALUTATION}}`, `{{CLIENT_NAME}}`, `{{lien_pellets}}` — casse exacte — et la marque) ;
//   - e-mail du registre : celles de son texte par défaut + de son `exemple` ;
//   - gabarit de la boutique : `WEBSHOP_EMAIL_PLACEHOLDERS` de sa clé.
// Une variable que personne ne remplace partirait telle quelle chez le client : `variablesInconnues`.
// ============================================================================
import { emailAutomatique, emailOuSequence, variablesDe, VARIABLES_MARQUE } from './emailsAutomatiques.js';
import { estSequence } from './sequencesEmails.js';
import { normaliser } from './mailCorps.js';
import {
  WEBSHOP_EMAIL_KEYS, WEBSHOP_EMAIL_DEFAULTS, WEBSHOP_EMAIL_PLACEHOLDERS, GABARITS_HABILLES_PAR_LE_SITE, VARIABLES_MARQUE_DU_SITE,
} from './webshop/emailTemplates.js';

/**
 * @typedef {{ nom: string, libelle: string, bloc: boolean, lien: boolean }} VariableProposee
 *   `nom` est le jeton complet `{{NOM}}`, tel que l'éditeur l'insère.
 * @typedef {{ key?: string | null, is_automated?: boolean | null, is_transactional?: boolean | null,
 *   html_body?: string | null, subject?: string | null }} CampagneMail
 * @typedef {'manuelle' | 'automatique' | 'sequence' | 'auto_registre' | 'boutique'} NatureMail
 */

/** Variables de marque qui ont du sens dans une phrase : proposées pour tout mail. */
const MARQUE_DANS_UNE_PHRASE = Object.freeze([
  '{{BRAND_NAME}}', '{{ORG_PHONE}}', '{{ORG_EMAIL}}', '{{ORG_WEBSITE_URL}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}',
]);

// Les autres variables de marque (couleurs, logo, phrase d'accroche) sont posées par l'habillage : jamais proposées.

/** Ce que `mailing-send` remplace pour une campagne (hors marque) — `lien_pellets` en minuscules, comme l'edge. */
const DE_CAMPAGNE = Object.freeze(['{{SALUTATION}}', '{{CLIENT_NAME}}', '{{lien_pellets}}']);

/** Libellés d'artisan, par nom de variable sans accolades. Une variable absente de la table affiche son nom. */
const LIBELLES = Object.freeze({
  SALUTATION: 'Formule de politesse',
  CLIENT_NAME: 'Nom du client',
  PRENOM: 'Prénom du client',
  lien_pellets: 'Lien de l’offre pellets',
  // Entreprise
  BRAND_NAME: 'Nom de l’entreprise',
  ORG_EMAIL: 'E-mail de l’entreprise',
  ORG_PHONE: 'Téléphone de l’entreprise',
  ORG_ADDRESS: 'Adresse de l’entreprise',
  ORG_POSTAL_CODE: 'Code postal de l’entreprise',
  ORG_CITY: 'Ville de l’entreprise',
  ORG_WEBSITE_URL: 'Site de l’entreprise',
  ACCENT_COLOR: 'Couleur principale',
  SECONDARY_COLOR: 'Couleur du bandeau',
  EMAIL_TAGLINE: 'Phrase d’accroche',
  LOGO_URL: 'Logo de l’entreprise',
  // Contrat, facture, entretien
  EQUIP_RECAP: 'Équipements concernés',
  TOTAL_AMOUNT: 'Montant total',
  PDF_URL: 'Lien de la proposition',
  INVOICE_NUMBER: 'Numéro de facture',
  INVOICE_AMOUNT: 'Montant de la facture',
  INVOICE_DATE: 'Date de la facture',
  EQUIPMENTS: 'Équipements',
  EQUIPEMENTS: 'Équipements',
  ATTACHMENTS: 'Pièces jointes',
  MOIS: 'Mois de l’entretien',
  LIEN_RDV: 'Lien de prise de rendez-vous',
  DATE_RDV: 'Date du rendez-vous',
  DEMI_JOURNEE: 'Demi-journée',
  TECHNICIEN: 'Technicien',
  // Chantier, SAV, DPE
  OBJET: 'Objet des travaux',
  LIEN_PV: 'Lien de signature du PV',
  DATE_INTERVENTION: 'Date de l’intervention',
  APPAREIL: 'Appareil',
  NUMERO_DPE: 'Numéro du DPE',
  ETIQUETTE_DPE: 'Étiquette énergie',
  LIEN_RAPPORT: 'Lien du rapport',
  // Boutique
  ORDER_NUMBER: 'Numéro de commande',
  ITEMS: 'Récapitulatif de la commande',
  DELIVERY_DATE: 'Date de livraison',
  DELIVERY_ADDRESS: 'Adresse de livraison',
  PICKUP_POINT: 'Point de retrait',
  DELIVERY_INFO: 'Informations de livraison',
  DELIVERY_LINE: 'Ligne de livraison',
  LEGAL_INFO: 'Mentions légales',
  TOURNEE_DATE: 'Date de la tournée',
  SECTEUR: 'Secteur',
  DEPOT: 'Dépôt',
  NB_ARRETS: 'Nombre d’arrêts',
  NB_EMPLACEMENTS: 'Nombre d’emplacements',
  ARRETS: 'Liste des arrêts',
  KM_ESTIMES: 'Kilométrage estimé',
  ITINERAIRE_URL: 'Lien de l’itinéraire',
  ALERTES: 'Alertes',
  DEPOT_NAME: 'Nom du dépôt',
  DEPOT_ADDRESS: 'Adresse du dépôt',
  PARCELS_TABLE: 'Tableau des colis',
  TOTAL_WEIGHT: 'Poids total',
  DECLARED_VALUE: 'Valeur déclarée',
  CLIENT_PHONE: 'Téléphone du client',
  CLIENT_EMAIL: 'E-mail du client',
});

/** Variable sans accolades : `{{X}}` ou `X` → `X`. @param {string} nom @returns {string} */
const sansAccolades = (nom) => String(nom ?? '').replace(/^\{\{/, '').replace(/\}\}$/, '');

/**
 * Libellé d'artisan d'une variable ; le nom brut, sans accolades, si elle n'a pas de libellé.
 * @param {string} nom `{{X}}` ou `X`
 * @returns {string}
 */
export function libelleVariable(nom) {
  const n = sansAccolades(nom);
  return Object.prototype.hasOwnProperty.call(LIBELLES, n) ? LIBELLES[/** @type {keyof typeof LIBELLES} */ (n)] : n;
}

/**
 * Nature d'un mail : décide quelles cartes la page affiche et quelles variables elle propose.
 * Une campagne transactionnelle hors registre et hors boutique est traitée comme la boutique (message seul).
 * @param {CampagneMail | null | undefined} campagne
 * @returns {NatureMail}
 */
export function natureDuMail(campagne) {
  const cle = campagne?.key ?? '';
  if (cle && estSequence(cle)) return 'sequence';
  if (cle && emailAutomatique(cle)) return 'auto_registre';
  if (cle && WEBSHOP_EMAIL_KEYS.includes(cle)) return 'boutique';
  if (campagne?.is_transactional) return 'boutique';
  return campagne?.is_automated ? 'automatique' : 'manuelle';
}

/**
 * Texte par défaut d'un mail (registre, séquence ou boutique), `null` pour une campagne libre.
 * @param {CampagneMail | null | undefined} campagne
 * @returns {{ subject: string, html_body: string } | null}
 */
function texteParDefaut(campagne) {
  const cle = campagne?.key ?? '';
  if (!cle) return null;
  const defaut = emailOuSequence(cle)?.gabarit ?? WEBSHOP_EMAIL_DEFAULTS[cle] ?? null;
  return defaut ? { subject: defaut.subject, html_body: defaut.html_body } : null;
}

/**
 * Variables posées seules à la racine du texte, hors paragraphe (tableaux, mentions…) : elles s'affichent
 * comme une étiquette sur leur propre ligne. Lues sur la forme normalisée, où un bloc reste nu.
 * @param {string} html
 * @returns {Set<string>}
 */
function blocsDe(html) {
  const reste = normaliser(html).replace(/<(p|h2|div|ul|ol)\b[\s\S]*?<\/\1>/gi, '');
  return new Set(variablesDe(reste));
}

/** Variables citées comme adresse d'un lien (`href="{{X}}"`) dans un texte. @param {string} html @returns {Set<string>} */
function liensDe(html) {
  const out = new Set();
  const re = /href\s*=\s*["']\s*(\{\{[A-Za-z0-9_]+\}\})\s*["']/gi;
  let m = re.exec(html);
  while (m) { out.add(m[1]); m = re.exec(html); }
  return out;
}

/** @param {string} nom @returns {boolean} Le nom d'une variable dit-il que c'est une adresse (`LIEN_…`, `…_URL`, `lien_pellets`) ? */
export const nomDeLien = (nom) => /^lien_/i.test(sansAccolades(nom)) || /_url$/i.test(sansAccolades(nom));

/** Valeur unique, ordre conservé. @param {string[]} liste @returns {string[]} */
const uniques = (liste) => [...new Set(liste)];

/**
 * Jetons du texte que l'éditeur peut proposer, selon la nature du mail (sans la marque posée par le
 * programme, avec la marque utile dans une phrase).
 * @param {CampagneMail | null | undefined} campagne
 * @returns {string[]}
 */
function jetonsProposes(campagne) {
  const nature = natureDuMail(campagne);
  const cle = campagne?.key ?? '';
  let propres;
  if (nature === 'auto_registre') {
    const e = emailAutomatique(cle);
    propres = [...variablesDe(`${e.gabarit.subject}${e.gabarit.html_body}`), ...Object.keys(e.exemple)];
  } else if (nature === 'boutique') {
    propres = WEBSHOP_EMAIL_PLACEHOLDERS[cle]
      ? [...WEBSHOP_EMAIL_PLACEHOLDERS[cle]]
      : variablesDe(`${campagne?.subject ?? ''}${campagne?.html_body ?? ''}`);
  } else {
    propres = [...DE_CAMPAGNE];
  }
  // Un mail habillé par le site n'a que les trois variables d'entreprise que le site remplace.
  const marque = GABARITS_HABILLES_PAR_LE_SITE.includes(cle) ? VARIABLES_MARQUE_DU_SITE : MARQUE_DANS_UNE_PHRASE;
  return uniques([...propres.filter((v) => !VARIABLES_MARQUE.includes(v)), ...marque]);
}

/**
 * Variables qu'un utilisateur peut INSÉRER dans le texte de ce mail. Les couleurs, le logo et la phrase
 * d'accroche n'y sont jamais : ils sont posés par l'habillage.
 * @param {CampagneMail | null | undefined} campagne
 * @returns {VariableProposee[]}
 */
export function variablesProposees(campagne) {
  const defaut = texteParDefaut(campagne);
  const blocs = defaut ? blocsDe(defaut.html_body) : new Set();
  const liens = defaut ? liensDe(defaut.html_body) : new Set();
  return jetonsProposes(campagne).map((nom) => ({
    nom,
    libelle: libelleVariable(nom),
    bloc: blocs.has(nom),
    lien: liens.has(nom) || nomDeLien(nom),
  }));
}

/**
 * Variables du texte par défaut de ce mail que le texte n'affiche plus, en libellés d'artisan
 * (« Mentions légales »). Seules comptent les variables qu'on peut insérer : une couleur posée par
 * l'habillage n'est jamais « oubliée ». Une campagne sans texte par défaut n'oublie rien.
 * @param {CampagneMail | null | undefined} campagne
 * @param {string} html texte actuel
 * @returns {string[]}
 */
export function variablesManquantes(campagne, html) {
  const defaut = texteParDefaut(campagne);
  if (!defaut) return [];
  const presentes = new Set(variablesDe(html));
  const offertes = new Set(jetonsProposes(campagne));
  return variablesDe(defaut.html_body).filter((v) => offertes.has(v) && !presentes.has(v)).map(libelleVariable);
}

/**
 * Variables du texte que personne ne remplacera à l'envoi : ni proposées pour ce mail, ni de marque. Elles
 * partiraient telles quelles chez le client (`{{PRENOM}}` tapé à la main dans une campagne).
 * @param {CampagneMail | null | undefined} campagne
 * @param {string} html texte actuel
 * @returns {string[]} jetons `{{X}}`
 */
export function variablesInconnues(campagne, html) {
  const duSite = GABARITS_HABILLES_PAR_LE_SITE.includes(campagne?.key ?? '');
  const connues = new Set([...jetonsProposes(campagne), ...(duSite ? [] : VARIABLES_MARQUE)]);
  return variablesDe(html).filter((v) => !connues.has(v));
}

/**
 * Éléments que l'éditeur propose pour ce mail. Les deux e-mails habillés par le site ne remplacent pas
 * `{{ACCENT_COLOR}}` : ni titre, ni bouton, ni encadré (sinon leurs couleurs partiraient en clair).
 * @param {CampagneMail | null | undefined} campagne
 * @returns {{ titre: boolean, bouton: boolean, encadre: boolean }}
 */
export function elementsPermis(campagne) {
  const permis = !GABARITS_HABILLES_PAR_LE_SITE.includes(campagne?.key ?? '');
  return { titre: permis, bouton: permis, encadre: permis };
}
