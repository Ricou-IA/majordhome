// src/lib/expediteur.js
// ============================================================================
// De quelle adresse part un e-mail de l'entreprise — SEULE définition (spec
// 2026-11-21-emails-expediteur-par-defaut-textes-sequences-design.md § 3.1).
// Module PUR (aucun import), copié pour Deno par `npm run sync:tournee-engine`,
// testé `scripts/expediteur.test.mjs`.
//
//   - domaine de l'entreprise vérifié → son adresse ;
//   - sinon, e-mail INDIVIDUEL (facture, PV, RDV, rapport…) → l'adresse commune de
//     la plateforme, au nom de l'entreprise, la réponse arrivant chez elle ;
//   - sinon, envoi EN NOMBRE (campagne, séquence) → refus `domaine_requis` : un
//     envoi de masse depuis l'adresse commune ferait porter à toutes les
//     entreprises la réputation d'une seule.
//
// Tant que la plateforme n'a pas d'adresse commune (secret absent), rien ne
// change : l'e-mail part de l'adresse de l'entreprise et le service d'envoi juge.
// ============================================================================

const ADRESSE_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const texte = (v) => (typeof v === 'string' ? v.trim() : '');

/** Domaine d'une adresse, en minuscules ; '' si l'adresse n'en est pas une. */
export function domaineDe(adresse) {
  const a = texte(adresse);
  return ADRESSE_RE.test(a) ? a.split('@')[1].toLowerCase() : '';
}

/** « Nom <adresse> » ou « adresse » → { nom, adresse } ; adresse '' si illisible. */
export function lireAdresse(valeur) {
  const v = texte(valeur);
  const m = v.match(/^(.*)<([^<>]+)>$/);
  const adresse = texte(m ? m[2] : v);
  if (!ADRESSE_RE.test(adresse)) return { nom: '', adresse: '' };
  return { nom: m ? nomSur(m[1]) : '', adresse };
}

/** Un nom d'affichage ne porte ni chevron, ni guillemet, ni retour à la ligne. */
function nomSur(nom) {
  return texte(nom).replace(/[<>"\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** « Nom <adresse> », ou l'adresse seule sans nom. */
export function enTete(nom, adresse) {
  const n = nomSur(nom);
  return n ? `${n} <${adresse}>` : adresse;
}

/**
 * Nom d'entreprise → ce qui précède le « @ » sur le domaine commun : minuscules, sans accents,
 * lettres, chiffres et tirets (« Habitat & Énergies » → « habitat-energies »). '' si rien d'exploitable.
 */
export function partieLocale(nom) {
  return texte(nom)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
}

/** Le domaine de l'adresse d'envoi de l'entreprise est-il vérifié ? */
export function domaineVerifie(settings) {
  const s = settings ?? {};
  const domaine = domaineDe(s.from_email);
  return Boolean(domaine)
    && s.resend?.status === 'verified'
    && texte(s.resend?.domain).toLowerCase() === domaine;
}

/**
 * @param {object} settings  réglages de l'organisation
 * @param {object} [opts]
 * @param {'individuel'|'nombre'} [opts.usage='individuel']
 * @param {string} [opts.plateforme='']  adresse commune de la plateforme (« Nom <adresse> » ou adresse)
 * @returns {{ refus: null, mode: 'domaine'|'plateforme'|'non_verifie', fromEmail: string, fromName: string,
 *   from: string, replyTo: string, contactEmail: string }
 *   | { refus: 'no_from_email'|'domaine_requis', mode: null, fromEmail: '', fromName: string, from: '',
 *   replyTo: '', contactEmail: string }}
 *   `contactEmail` = l'adresse de l'entreprise (celle qu'on écrit dans un e-mail), jamais celle de la plateforme.
 */
export function resoudreExpediteur(settings, { usage = 'individuel', plateforme = '' } = {}) {
  const s = settings ?? {};
  const fromName = nomSur(s.from_name) || nomSur(s.brand_name);
  const contactEmail = texte(s.from_email) || texte(s.reply_to);
  const refus = (code) => ({ refus: code, mode: null, fromEmail: '', fromName, from: '', replyTo: '', contactEmail });
  if (!contactEmail) return refus('no_from_email');

  const replyTo = texte(s.reply_to) || contactEmail;
  const ok = (mode, fromEmail, nom) => ({
    refus: null, mode, fromEmail, fromName: nom, from: enTete(nom, fromEmail), replyTo, contactEmail,
  });

  if (domaineVerifie(s)) return ok('domaine', texte(s.from_email), fromName);
  if (usage === 'nombre') return refus('domaine_requis');

  const commune = lireAdresse(plateforme);
  if (commune.adresse) {
    // Chaque entreprise écrit depuis une adresse à son nom sur le domaine commun (cimaj@…) ; sans
    // nom exploitable, l'adresse commune telle quelle. Jamais une saisie libre : elle permettrait
    // d'écrire depuis une adresse qui semble être celle d'une autre entreprise.
    const local = partieLocale(s.brand_name);
    const adresse = local ? `${local}@${commune.adresse.split('@')[1]}` : commune.adresse;
    return ok('plateforme', adresse, fromName || commune.nom);
  }
  return ok('non_verifie', contactEmail, fromName);
}

/**
 * Phrase de Réglages → Emails : d'où partent les e-mails de l'entreprise. '' tant qu'elle n'a pas
 * d'adresse. L'écran ne connaît pas l'adresse commune : il dit « l'adresse d'envoi commune ».
 */
export function phraseEtatEnvoi(settings) {
  const r = resoudreExpediteur(settings);
  if (r.refus) return '';
  if (r.mode === 'domaine') return `Vos e-mails partent de ${r.fromEmail}.`;
  const nom = r.fromName ? `de la part de ${r.fromName}` : 'à votre nom';
  return `Vos e-mails individuels (factures, rendez-vous, documents) partent ${nom}, depuis l’adresse d’envoi commune ; `
    + `les réponses arrivent à ${r.replyTo}. Les envois en nombre demandent votre propre domaine (ci-dessous).`;
}

/** Ce que l'écran dit d'un refus. */
export const EXPEDITEUR_REFUS = Object.freeze({
  no_from_email: 'Renseignez d’abord votre adresse e-mail : Paramètres → Communication → Emails.',
  domaine_requis: 'Un envoi en nombre part de votre propre domaine : vérifiez-le dans Paramètres → Communication → Emails.',
});
