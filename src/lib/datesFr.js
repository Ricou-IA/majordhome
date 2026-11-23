/**
 * datesFr.js - Majord'home
 * ============================================================================
 * Dates en français pour le champ de date (DateInput, refonte UI phase 5) :
 * affichage « lun. 23 nov. 2026 », saisie jj/mm/aaaa, jours fériés de métropole,
 * raccourcis. Module PUR (aucun import React / Supabase / alias), testé par
 * scripts/dates-fr.test.mjs. Une date s'échange toujours en `YYYY-MM-DD` local,
 * jamais par `toISOString()` (qui recule d'un jour entre minuit et 1 h ou 2 h).
 * ============================================================================
 */

const deux = (n) => String(n).padStart(2, '0');

/** Date locale → `YYYY-MM-DD`. */
export const versIso = (date) => `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}`;

/**
 * `YYYY-MM-DD` → Date locale à midi (à l'abri des changements d'heure), ou null si la date n'existe pas.
 * Un horodatage (`2026-11-23T10:00:00…`) se lit par sa date : une valeur stockée telle quelle reste lisible.
 * @param {string|null|undefined} iso
 * @returns {Date|null}
 */
export function depuisIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(a, mo - 1, j, 12);
  return d.getFullYear() === a && d.getMonth() === mo - 1 && d.getDate() === j ? d : null;
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * « lun. 23 nov. 2026 » (DA § 7) ; chaîne vide pour une date absente ou impossible.
 * @param {string|null|undefined} iso
 */
export function formatDateLongueFR(iso) {
  const d = depuisIso(iso);
  return d ? `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}` : '';
}

/** `YYYY-MM-DD` → « 03/11/2026 » pour le champ ; vide si absente. */
export function saisieDepuisIso(iso) {
  const d = depuisIso(iso);
  return d ? `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

/**
 * Saisie au clavier → `YYYY-MM-DD`. Accepte j/m/aaaa, jj/mm/aa, séparateurs « / - . », ou les chiffres
 * seuls (jjmmaaaa, jjmmaa : le clavier numérique d'une tablette n'a pas toujours « / »). Une année
 * sur deux chiffres va au siècle actuel, sauf si elle dépasse l'année en cours de plus de 10 ans
 * (« 85 » = 1985 : une date de naissance).
 * @param {string} texte
 * @param {Date} [maintenant]  pour l'année sur deux chiffres (tests)
 * @returns {string|null}  `''` pour un champ vidé, null pour une saisie impossible
 */
export function lireSaisieDate(texte, maintenant) {
  const brut = String(texte ?? '').trim();
  if (!brut) return '';
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(brut)
    || /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(brut);
  if (!m) return null;
  const jour = Number(m[1]);
  const mois = Number(m[2]);
  let annee = Number(m[3]);
  if (m[3].length === 2) {
    const courante = (maintenant ?? new Date()).getFullYear();
    annee += Math.floor(courante / 100) * 100;
    if (annee > courante + 10) annee -= 100;
  }
  if (annee < 1900 || annee > 2999) return null;
  const iso = `${annee}-${deux(mois)}-${deux(jour)}`;
  return depuisIso(iso) ? iso : null;
}

/** Dimanche de Pâques (algorithme de Meeus / Jones / Butcher). */
function paques(annee) {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour, 12);
}

const plusJours = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12);

/**
 * Les 11 jours fériés de France métropolitaine.
 * @param {number} annee
 * @returns {string[]}  `YYYY-MM-DD`, dans l'ordre de l'année
 */
export function joursFeries(annee) {
  const p = paques(annee);
  return [
    `${annee}-01-01`,
    versIso(plusJours(p, 1)), // lundi de Pâques
    `${annee}-05-01`,
    `${annee}-05-08`,
    versIso(plusJours(p, 39)), // Ascension
    versIso(plusJours(p, 50)), // lundi de Pentecôte
    `${annee}-07-14`,
    `${annee}-08-15`,
    `${annee}-11-01`,
    `${annee}-11-11`,
    `${annee}-12-25`,
  ].sort();
}

/**
 * Raccourcis du calendrier : aujourd'hui, demain, lundi prochain (jamais le jour même).
 * @param {Date} [maintenant]
 * @returns {Array<{ label: string, iso: string }>}
 */
export function raccourcisDate(maintenant = new Date()) {
  const jour = maintenant.getDay(); // 0 = dimanche
  const versLundi = ((8 - jour) % 7) || 7;
  return [
    { label: 'Aujourd’hui', iso: versIso(maintenant) },
    { label: 'Demain', iso: versIso(plusJours(maintenant, 1)) },
    { label: 'Lundi prochain', iso: versIso(plusJours(maintenant, versLundi)) },
  ];
}
