// src/lib/mailHabillageEcran.js
// ============================================================================
// Règles de l'écran « Habillage des e-mails » (Réglages → E-mails & SMS → E-mails,
// spec 2026-11-21-createur-mail-une-page-habillage-design.md § 5.1). Module PUR,
// testé `scripts/mail-habillage-ecran.test.mjs`. NON copié pour Deno : l'écran seul
// s'en sert ; la règle de l'envoi reste `habillerMail` (`mailHabillage.js`).
//
// Le formulaire : { entete, phrase, couleurBandeau, couleurBoutons, pied }. Une couleur
// vide veut dire « la couleur par défaut » et s'enregistre `null` (lu comme absent par
// `valeursDeMarque`). L'écran n'écrit QUE `email_habillage`, `accent_color`,
// `secondary_color`, `email_tagline` — jamais `email_skeleton_html` (l'ancien habillage
// reste en base, on peut y revenir).
// ============================================================================
import {
  choixDepuisReglages, couleurValide, lireHabillage, valeursDeMarque, DEFAUTS_MARQUE,
} from './mailHabillage.js';
import { contraste } from './pagePublique.js';
import { normaliser } from './mailCorps.js';

/**
 * @typedef {{
 *   entete: 'logo' | 'logo_bandeau', phrase: string, couleurBandeau: string, couleurBoutons: string,
 *   pied: { coordonnees: boolean, certifications: boolean, site: boolean },
 * }} FormulaireHabillage
 */

/** Seuil de lecture d'un texte blanc sur un bouton (même seuil que `teintesDeMarque`). */
export const SEUIL_LISIBLE = 4.5;

const COULEUR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Objet du mail d'exemple de l'aperçu. */
export const OBJET_EXEMPLE = 'Votre entretien annuel approche';

/** Texte du mail d'exemple, au format enregistré (passé par `normaliser`, jamais écrit à la main). */
export const TEXTE_EXEMPLE = normaliser(
  '<h2>Votre entretien annuel approche</h2>'
  + '<p>{{SALUTATION}}</p>'
  + '<p>L’entretien de votre appareil arrive à échéance. Vous trouverez <a href="https://exemple.fr">le détail de votre contrat</a> dans votre espace.</p>'
  + '<div data-encadre><p>Un entretien régulier garde votre appareil sûr et économe, et maintient sa garantie.</p></div>'
  + '<p><a data-bouton href="https://exemple.fr">Choisir mon rendez-vous</a></p>'
  + '<p>À bientôt,<br>{{BRAND_NAME}}</p>',
);

/** @param {unknown} v @returns {string} */
const texte = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Le formulaire tel que l'écran l'ouvre : le choix enregistré, sinon un équivalent de l'ancien
 * habillage, sinon le défaut (`choixDepuisReglages`) ; phrase et couleurs telles qu'enregistrées.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {FormulaireHabillage}
 */
export function formulaireInitial(reglages) {
  const s = reglages ?? {};
  const choix = choixDepuisReglages(s);
  return {
    entete: choix.entete,
    phrase: texte(s.email_tagline),
    couleurBandeau: texte(s.secondary_color),
    couleurBoutons: texte(s.accent_color),
    pied: { ...choix.pied },
  };
}

/**
 * L'ancien habillage n'est utilisé à l'envoi que s'il porte l'emplacement du texte (même test que `habillerMail`).
 * @param {Record<string, any>} s
 */
const aUnAncienHabillage = (s) => typeof s.email_skeleton_html === 'string' && s.email_skeleton_html.includes('{{EMAIL_BODY}}');

/**
 * Où en est l'entreprise : ancien habillage en place, choix enregistré, confirmation du premier
 * enregistrement (il remplace l'ancien habillage), retour possible à l'ancien.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {{ ancien: boolean, choixEnregistre: boolean, remplacementAConfirmer: boolean, retourPossible: boolean }}
 */
export function situationHabillage(reglages) {
  const s = reglages ?? {};
  const ancien = aUnAncienHabillage(s);
  const choixEnregistre = lireHabillage(s) !== null;
  return { ancien, choixEnregistre, remplacementAConfirmer: ancien && !choixEnregistre, retourPossible: ancien && choixEnregistre };
}

/**
 * Couleurs mal formées, avec leur raison. Une couleur vide est acceptée (couleur par défaut).
 * @param {FormulaireHabillage} form
 * @returns {{ couleurBandeau?: string, couleurBoutons?: string }}
 */
export function erreursFormulaire(form) {
  /** @type {{ couleurBandeau?: string, couleurBoutons?: string }} */
  const erreurs = {};
  for (const cle of /** @type {const} */ (['couleurBandeau', 'couleurBoutons'])) {
    const v = texte(form[cle]);
    if (v && !COULEUR_RE.test(v)) erreurs[cle] = 'Couleur illisible : écrivez-la sous la forme #1e3a8a, ou choisissez-la dans la palette.';
  }
  return erreurs;
}

/** Forme comparée et enregistrée du formulaire (espaces retirés). @param {FormulaireHabillage} form */
function normaliserFormulaire(form) {
  return {
    entete: form.entete === 'logo_bandeau' ? 'logo_bandeau' : 'logo',
    phrase: texte(form.phrase),
    couleurBandeau: texte(form.couleurBandeau),
    couleurBoutons: texte(form.couleurBoutons),
    pied: { coordonnees: !!form.pied?.coordonnees, certifications: !!form.pied?.certifications, site: !!form.pied?.site },
  };
}

/**
 * Le formulaire diffère-t-il de ce qui a été ouvert ? Sans changement, « Enregistrer » reste fermé.
 * @param {FormulaireHabillage} form
 * @param {FormulaireHabillage} initial
 * @returns {boolean}
 */
export function estModifie(form, initial) {
  return JSON.stringify(normaliserFormulaire(form)) !== JSON.stringify(normaliserFormulaire(initial));
}

/**
 * Ce que l'écran enregistre : exactement quatre clés, `email_habillage` entier (fusion de niveau 1).
 * Lève sur une couleur mal formée : elle n'arrive jamais jusqu'à l'enregistrement.
 * @param {FormulaireHabillage} form
 * @returns {{ email_habillage: { entete: string, pied: object }, accent_color: string | null, secondary_color: string | null, email_tagline: string | null }}
 */
export function patchAEnregistrer(form) {
  if (Object.keys(erreursFormulaire(form)).length) throw new Error('couleur_mal_formee');
  const f = normaliserFormulaire(form);
  return {
    email_habillage: { entete: f.entete, pied: f.pied },
    accent_color: f.couleurBoutons || null,
    secondary_color: f.couleurBandeau || null,
    email_tagline: f.phrase || null,
  };
}

/**
 * Les réglages tels qu'ils seront une fois l'écran enregistré — ce que l'aperçu habille.
 * Une couleur mal formée en cours de saisie est rendue comme à l'envoi : couleur par défaut.
 * @param {Record<string, any> | null | undefined} reglages
 * @param {FormulaireHabillage} form
 * @returns {Record<string, any>}
 */
export function reglagesApresEnregistrement(reglages, form) {
  const f = normaliserFormulaire(form);
  return {
    ...(reglages ?? {}),
    email_habillage: { entete: f.entete, pied: f.pied },
    accent_color: f.couleurBoutons || null,
    secondary_color: f.couleurBandeau || null,
    email_tagline: f.phrase || null,
  };
}

const VERS_COORDONNEES = { vers: '/settings/organization?tab=contact', libelle: 'Organisation → Coordonnées' };
const VERS_IDENTITE = { vers: '/settings/organization?tab=identity', libelle: 'Organisation → Identité' };

/**
 * Chaque choix du pied de page : y a-t-il quelque chose à montrer, sinon pourquoi et où le renseigner.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {Record<'coordonnees' | 'certifications' | 'site', { disponible: boolean, raison: string | null, lien: { vers: string, libelle: string } }>}
 */
export function piedDisponible(reglages) {
  const s = reglages ?? {};
  const v = valeursDeMarque(s);
  const coords = ['{{BRAND_NAME}}', '{{ORG_ADDRESS}}', '{{ORG_POSTAL_CODE}}', '{{ORG_CITY}}', '{{ORG_PHONE}}', '{{ORG_EMAIL}}']
    .some((cle) => v[cle]);
  const certifs = Array.isArray(s.rge_certifications) && s.rge_certifications.some((c) => texte(c));
  const site = /^https?:\/\//i.test(v['{{ORG_WEBSITE_URL}}']);
  return {
    coordonnees: { disponible: coords, raison: coords ? null : 'Aucune coordonnée enregistrée.', lien: VERS_COORDONNEES },
    certifications: { disponible: certifs, raison: certifs ? null : 'Aucune certification enregistrée.', lien: VERS_IDENTITE },
    site: { disponible: site, raison: site ? null : 'Aucun site internet enregistré.', lien: VERS_COORDONNEES },
  };
}

/** `#rgb` ou `#rrggbb` → [r, g, b]. @param {string} c @returns {number[]} */
function lireHex(c) {
  const h = c.slice(1).length === 3 ? c.slice(1).replace(/./g, (x) => x + x) : c.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** @param {number[]} rgb @returns {string} */
const versHex = (rgb) => `#${rgb.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;

/**
 * La couleur qu'un sélecteur natif peut afficher (`#rrggbb`) : la couleur saisie, sinon celle qui partira.
 * @param {string} valeur
 * @param {string} repli
 * @returns {string}
 */
export function couleurPourSelecteur(valeur, repli) {
  return versHex(lireHex(couleurValide(valeur, repli)));
}

/**
 * Un texte blanc se lit-il sur la couleur des boutons ? Sinon, la même teinte assombrie jusqu'à se lire.
 * Jugée sur la couleur qui partira (vide ou mal formée ⇒ couleur par défaut).
 * @param {string} valeur
 * @returns {{ couleur: string, ratio: number, lisible: boolean, suggestion: string | null }}
 */
export function lisibiliteBoutons(valeur) {
  const couleur = couleurValide(valeur, DEFAUTS_MARQUE.accent);
  const ratio = contraste(couleur, '#ffffff');
  if (ratio >= SEUIL_LISIBLE) return { couleur, ratio, lisible: true, suggestion: null };
  let rgb = lireHex(couleur);
  for (let i = 0; i < 40; i += 1) {
    rgb = rgb.map((x) => x * 0.94);
    if (contraste(versHex(rgb), '#ffffff') >= SEUIL_LISIBLE) return { couleur, ratio, lisible: false, suggestion: versHex(rgb) };
  }
  return { couleur, ratio, lisible: false, suggestion: null };
}

/**
 * Le logo tel que l'habillage l'utilise : seulement une adresse `https` ; sinon le nom est écrit.
 * @param {Record<string, any> | null | undefined} reglages
 * @returns {{ url: string | null, nom: string }}
 */
export function logoAffiche(reglages) {
  const url = texte(reglages?.logo_url);
  return { url: /^https:\/\//i.test(url) ? url : null, nom: texte(reglages?.brand_name) };
}

/**
 * Le bandeau est-il dessiné ? Seulement avec « Logo et bandeau » ET une phrase (même règle que l'envoi).
 * @param {{ entete: string, phrase: string }} form
 * @returns {boolean}
 */
export function bandeauVisible(form) {
  return form.entete === 'logo_bandeau' && !!texte(form.phrase);
}
