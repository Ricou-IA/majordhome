/**
 * joursOuverture.js — jours d'ouverture de l'entreprise (module pur, décision Eric 2026-11-24).
 * ============================================================================
 * Réglage d'organisation `settings.jours_ouverture` : liste des jours travaillés, numérotés
 * comme `Date.getDay()` (0 = dimanche … 6 = samedi). Saisi dans Paramètres → Entreprise →
 * Coordonnées ; le Planning masque les jours fermés (FullCalendar `hiddenDays`).
 * Absent, illisible ou vide ⇒ du lundi au vendredi (le planning d'avant, `weekends={false}`).
 * Testé : scripts/jours-ouverture.test.mjs.
 * ============================================================================
 */

/** Jours dans l'ordre de la semaine française (lundi en tête). */
export const JOURS_SEMAINE = Object.freeze([
  { jour: 1, libelle: 'Lundi', court: 'Lun.' },
  { jour: 2, libelle: 'Mardi', court: 'Mar.' },
  { jour: 3, libelle: 'Mercredi', court: 'Mer.' },
  { jour: 4, libelle: 'Jeudi', court: 'Jeu.' },
  { jour: 5, libelle: 'Vendredi', court: 'Ven.' },
  { jour: 6, libelle: 'Samedi', court: 'Sam.' },
  { jour: 0, libelle: 'Dimanche', court: 'Dim.' },
]);

export const JOURS_OUVERTURE_DEFAUT = Object.freeze([1, 2, 3, 4, 5]);

/**
 * Jours d'ouverture lus dans les réglages, triés (0 à 6), sans doublon.
 * @param {Record<string, unknown>|null|undefined} settings
 * @returns {number[]}
 */
export function lireJoursOuverture(settings) {
  const brut = settings?.jours_ouverture;
  if (!Array.isArray(brut)) return [...JOURS_OUVERTURE_DEFAUT];
  const jours = [...new Set(brut.map(Number).filter((j) => Number.isInteger(j) && j >= 0 && j <= 6))].sort((a, b) => a - b);
  return jours.length > 0 ? jours : [...JOURS_OUVERTURE_DEFAUT];
}

/** Jours à masquer dans le calendrier (complément des jours d'ouverture). */
export function joursMasques(jours) {
  const ouverts = new Set(jours);
  return [0, 1, 2, 3, 4, 5, 6].filter((j) => !ouverts.has(j));
}

/** Coche ou décoche un jour ; le dernier jour ouvert ne se décoche pas (au moins un jour). */
export function basculerJour(jours, jour) {
  const ouverts = new Set(jours);
  if (ouverts.has(jour)) {
    if (ouverts.size === 1) return [...jours];
    ouverts.delete(jour);
  } else {
    ouverts.add(jour);
  }
  return [...ouverts].sort((a, b) => a - b);
}
