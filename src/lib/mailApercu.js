// src/lib/mailApercu.js
// ============================================================================
// HTML de l'aperçu fidèle d'un mail — spec 2026-11-21-createur-mail-une-page-habillage-design.md § 5.4.
// Module PUR, testé `scripts/mail-apercu.test.mjs`. Non copié pour Deno.
//
// Aucune mise en page ici : l'aperçu appelle `habillerMail`, la fonction même que les edges exécutent à
// l'envoi, puis remplace les variables dans l'ordre de l'envoi — marque (`valeursDeMarque`), puis valeurs
// d'exemple. Le tout en UNE passe : une valeur insérée n'est jamais relue comme une variable.
// Après `rendreApercu`, aucun `{{…}}` ne reste ni dans le HTML ni dans l'objet.
//
// Valeurs insérées dans le HTML : échappées (un nom d'entreprise « A<B » ne casse pas l'aperçu), SAUF les
// valeurs d'exemple du registre — du texte d'exemple de confiance, écrit dans le code et inséré tel quel
// par l'essai (`email-essai`) : les échapper ici ferait un aperçu différent de l'essai.
// ============================================================================
import { habillerMail, valeursDeMarque } from './mailHabillage.js';
import { emailOuSequence } from './emailsAutomatiques.js';
import { GABARITS_HABILLES_PAR_LE_SITE, VARIABLES_MARQUE_DU_SITE } from './webshop/emailTemplates.js';
import { nomDeLien, variablesProposees, variablesAccepteesDansLObjet } from './mailVariables.js';

const JETON = /\{\{([A-Za-z0-9_]+)\}\}/g;
const DESABONNEMENT = /mailto:[^"'\s>]*\?subject=D[eé]sabonnement/gi;

const SALUTATION_EXEMPLE = 'Bonjour Jean Dupont,';
const CLIENT_EXEMPLE = 'Jean Dupont';

/** Échappe pour du HTML ; `{` aussi, pour qu'une valeur ne puisse jamais refaire un `{{…}}`. @param {unknown} v @returns {string} */
const echapper = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\{/g, '&#123;');

/** Bloc de remplacement d'une variable-bloc : un encadré gris qui porte son libellé. @param {string} libelle @returns {string} */
const emplacementDeBloc = (libelle) => '<div style="margin:12px 0;padding:12px 16px;background:#f1f5f9;border:1px dashed #cbd5e1;'
  + `border-radius:6px;color:#64748b;font-size:14px;text-align:center;">${echapper(libelle)}</div>`;

/**
 * Remplace chaque `{{X}}` d'un texte, en une passe.
 * @param {string} texte
 * @param {(nom: string, jetonComplet: string) => string} valeurDe
 * @returns {string}
 */
const substituer = (texte, valeurDe) => texte.replace(JETON, (jetonComplet, nom) => valeurDe(nom, jetonComplet));

/**
 * @param {{ key?: string | null } | null | undefined} campagne
 * @param {Record<string, any> | null | undefined} reglages
 * @param {boolean} html le texte est du HTML (corps) — faux pour l'objet, qui est du texte brut
 * @returns {(nom: string, jetonComplet: string) => string}
 */
function resolveur(campagne, reglages, html) {
  // Un mail habillé par le site : seules ses trois variables d'entreprise sont remplacées ; les autres se voient.
  const duSite = GABARITS_HABILLES_PAR_LE_SITE.includes(campagne?.key ?? '');
  const marque = Object.fromEntries(Object.entries(valeursDeMarque(reglages))
    .filter(([j]) => !duSite || VARIABLES_MARQUE_DU_SITE.includes(j)));
  const exemples = { '{{SALUTATION}}': SALUTATION_EXEMPLE, '{{CLIENT_NAME}}': CLIENT_EXEMPLE,
    ...(campagne?.key ? emailOuSequence(campagne.key)?.exemple : null) };
  const proposees = new Map(variablesProposees(campagne).map((v) => [v.nom, v]));
  const sortie = (v, sur = false) => (html && !sur ? echapper(v) : String(v));
  // Objet : seules les variables que l'envoi remplace dans l'objet ; les autres se voient entre crochets,
  // comme une variable inconnue (une campagne ne remplace pas la formule de politesse dans l'objet).
  const dansLObjet = html ? null : new Set(variablesAccepteesDansLObjet(campagne));
  return (nom, j) => {
    if (dansLObjet && !dansLObjet.has(j)) return `[${proposees.get(j)?.libelle ?? nom}]`;
    if (Object.prototype.hasOwnProperty.call(marque, j)) return sortie(marque[j]);
    const connue = proposees.get(j);
    if (connue && (connue.lien || nomDeLien(nom))) return '#';
    if (Object.prototype.hasOwnProperty.call(exemples, j)) return sortie(exemples[j], true);
    if (connue?.bloc && html) return emplacementDeBloc(connue.libelle);
    // Une variable que ce mail ne connaît pas garde son nom brut : elle partirait telle quelle, l'aperçu le montre.
    return sortie(`[${connue ? connue.libelle : nom}]`);
  };
}

/**
 * L'aperçu d'un mail : habillage de l'entreprise, variables de marque, valeurs d'exemple, lien de
 * désabonnement neutralisé. Ne lève jamais : campagne, réglages ou texte absents donnent un résultat valide.
 * Les deux e-mails habillés par le site (`GABARITS_HABILLES_PAR_LE_SITE`) restent sans habillage.
 * @param {{
 *   campagne?: { key?: string | null, is_automated?: boolean | null, is_transactional?: boolean | null } | null,
 *   objet?: string | null, corps?: string | null, reglages?: Record<string, any> | null,
 * }} [entree]
 * @returns {{ html: string, objet: string, habilleParLeSite: boolean }}
 */
export function rendreApercu({ campagne = null, objet = '', corps = '', reglages = null } = {}) {
  const habilleParLeSite = GABARITS_HABILLES_PAR_LE_SITE.includes(campagne?.key ?? '');
  try {
    const texte = String(corps ?? '');
    const base = habilleParLeSite ? texte : habillerMail(reglages, texte);
    return {
      html: substituer(base, resolveur(campagne, reglages, true)).replace(DESABONNEMENT, '#'),
      objet: substituer(String(objet ?? ''), resolveur(campagne, reglages, false)),
      habilleParLeSite,
    };
  } catch {
    return { html: '', objet: '', habilleParLeSite };
  }
}
