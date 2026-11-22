// src/lib/mailLien.js
// ============================================================================
// Adresse d'un lien ou d'un bouton saisie dans la fenêtre « Lien » de l'éditeur de mail : SEULE règle
// de ce qui est accepté avant de fermer la fenêtre (spec 2026-11-21-createur-mail-une-page-habillage-
// design.md § 5.3). Module PUR, testé `scripts/mail-lien.test.mjs`.
//
// Accord avec `normaliser` (mailCorps.js) : toute adresse acceptée ici y garde son lien. L'inverse est
// plus strict ici : une adresse que `normaliser` transformerait en texte simple (une adresse proposée
// suivie d'un chemin, `javascript:`…) est refusée avec une phrase au lieu de disparaître à
// l'enregistrement ; et une information qui n'est pas une adresse (le nom du client) est refusée même si
// `normaliser`, qui n'en connaît pas le sens, la garderait.
// ============================================================================

const JETON_SEUL = /^\{\{[A-Za-z0-9_]+\}\}$/;
const SCHEMA = /^(https?:\/\/|mailto:|tel:)/i;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/;

const MESSAGE_SCHEMA = 'Une adresse commence par https://, mailto: (e-mail) ou tel: (téléphone).';

/**
 * Proposition d'adresse complète pour une saisie sans « https:// » (site, e-mail ou téléphone), sinon `undefined`.
 * @param {string} a saisie rognée
 * @returns {string | undefined}
 */
function suggestionPour(a) {
  if (/^[^\s@:/]+@[^\s@:/]+\.[a-z]{2,}$/i.test(a)) return `mailto:${a}`;
  const chiffres = a.replace(/[\s.-]/g, '');
  if (/^\+?\d{6,15}$/.test(chiffres)) return `tel:${chiffres}`;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(a)) return `https://${a}`;
  return undefined;
}

/**
 * Verdict sur l'adresse d'un lien ou d'un bouton.
 * @param {string | null | undefined} adresse saisie ou choisie
 * @param {Array<string | { nom: string }>} [variablesDeLien] adresses proposées pour ce mail (`{{LIEN_PV}}`…)
 * @returns {{ valide: true, adresse: string } | { valide: false, message: string, suggestion?: string }}
 */
export function adresseDeLienValide(adresse, variablesDeLien = []) {
  // Rognée comme `normaliser` la lit : tabulations et retours retirés, blancs et caractères de contrôle aux deux bouts.
  // eslint-disable-next-line no-control-regex
  const a = String(adresse ?? '').replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').trim();
  if (!a) return { valide: false, message: 'Indiquez l’adresse du lien.' };
  if (CONTROLE.test(a)) return { valide: false, message: 'Cette adresse contient un caractère invisible : saisissez-la à nouveau.' };
  const proposees = new Set((variablesDeLien ?? []).map((v) => (typeof v === 'string' ? v : v?.nom)).filter(Boolean));
  if (JETON_SEUL.test(a)) {
    return proposees.has(a)
      ? { valide: true, adresse: a }
      : { valide: false, message: 'Cette information n’est pas une adresse : choisissez une adresse proposée ou saisissez-en une.' };
  }
  if (a.includes('{{')) {
    return {
      valide: false,
      message: 'Saisissez l’adresse complète, ou choisissez l’adresse proposée seule, sans rien ajouter avant ni après.',
    };
  }
  if (SCHEMA.test(a)) return { valide: true, adresse: a };
  const suggestion = /^[a-z][a-z0-9+.-]*:/i.test(a) && !/^[^:]+:\d/.test(a) ? undefined : suggestionPour(a);
  return suggestion
    ? { valide: false, message: `Il manque le début de l’adresse. ${MESSAGE_SCHEMA}`, suggestion }
    : { valide: false, message: `Cette adresse n’est pas acceptée. ${MESSAGE_SCHEMA}` };
}
