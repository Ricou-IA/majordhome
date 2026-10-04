/**
 * workingHours.js - Majord'home Artisan
 * ============================================================================
 * Horaires de travail d'un membre (majordhome.team_members.default_availability,
 * jsonb { monday…sunday: { start, end, active } }) — module PUR, sans import.
 *
 * Lecture alignée sur les consommateurs (scheduleConflicts.js::memberWorkingHoursForDate,
 * tournee/loaders.js::chargerJournees) : un jour ABSENT ou `active === false`
 * est chômé, tout autre jour est travaillé.
 *
 * Écriture : la RPC team_member_set_availability valide et normalise à son tour
 * (7 jours, HH:MM, début < fin, jour chômé stocké { active: false }). La
 * validation ici n'existe que pour afficher l'erreur à côté du champ.
 * Tests : node --test scripts/working-hours.test.mjs
 * ============================================================================
 */

/** Jours dans l'ordre d'affichage (semaine française, lundi d'abord). */
export const JOURS_SEMAINE = [
  { key: 'monday', label: 'Lundi', court: 'Lun' },
  { key: 'tuesday', label: 'Mardi', court: 'Mar' },
  { key: 'wednesday', label: 'Mercredi', court: 'Mer' },
  { key: 'thursday', label: 'Jeudi', court: 'Jeu' },
  { key: 'friday', label: 'Vendredi', court: 'Ven' },
  { key: 'saturday', label: 'Samedi', court: 'Sam' },
  { key: 'sunday', label: 'Dimanche', court: 'Dim' },
];

/** Heures proposées quand on coche un jour qui n'en avait pas. */
const HEURES_PAR_DEFAUT = { start: '08:00', end: '17:00' };

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Valeur stockée → état de formulaire (7 jours, heures toujours renseignées pour
 * qu'un jour re-coché retrouve des valeurs éditables).
 * @param {object|null|undefined} availability
 * @returns {Record<string, { active: boolean, start: string, end: string }>}
 */
export function versFormulaire(availability) {
  const form = {};
  for (const { key } of JOURS_SEMAINE) {
    const cfg = availability?.[key];
    form[key] = {
      active: !!cfg && cfg.active !== false,
      start: cfg?.start || HEURES_PAR_DEFAUT.start,
      end: cfg?.end || HEURES_PAR_DEFAUT.end,
    };
  }
  return form;
}

/**
 * Erreurs par jour (seuls les jours travaillés sont contrôlés).
 * @param {Record<string, { active: boolean, start: string, end: string }>} form
 * @returns {Record<string, string>}  { [jour]: message } — objet vide = valide
 */
export function erreursHoraires(form) {
  const erreurs = {};
  for (const { key } of JOURS_SEMAINE) {
    const j = form?.[key];
    if (!j?.active) continue;
    if (!HHMM.test(j.start || '') || !HHMM.test(j.end || '')) {
      erreurs[key] = 'Heure au format HH:MM';
    } else if (j.start >= j.end) {
      erreurs[key] = 'Le début doit précéder la fin';
    }
  }
  return erreurs;
}

/**
 * État de formulaire → corps envoyé à la RPC (même forme que ce qu'elle stocke).
 * @param {Record<string, { active: boolean, start: string, end: string }>} form
 * @returns {Record<string, { start: string, end: string, active: true } | { active: false }>}
 */
export function versPayload(form) {
  const out = {};
  for (const { key } of JOURS_SEMAINE) {
    const j = form?.[key];
    out[key] = j?.active ? { start: j.start, end: j.end, active: true } : { active: false };
  }
  return out;
}

/**
 * Résumé lisible, jours consécutifs aux mêmes heures regroupés :
 * « Lun–Jeu 08:00–17:00 · Ven 08:00–16:00 ».
 * @param {object|null|undefined} availability
 * @returns {string}
 */
export function resumeHoraires(availability) {
  const form = versFormulaire(availability);
  const groupes = [];
  for (const jour of JOURS_SEMAINE) {
    const j = form[jour.key];
    if (!j.active) continue;
    const plage = `${j.start}–${j.end}`;
    const dernier = groupes[groupes.length - 1];
    const precedent = JOURS_SEMAINE[JOURS_SEMAINE.indexOf(jour) - 1];
    if (dernier && dernier.plage === plage && precedent && dernier.fin === precedent.court) {
      dernier.fin = jour.court;
    } else {
      groupes.push({ debut: jour.court, fin: jour.court, plage });
    }
  }
  if (groupes.length === 0) return 'Aucun jour travaillé';
  return groupes
    .map((g) => `${g.debut === g.fin ? g.debut : `${g.debut}–${g.fin}`} ${g.plage}`)
    .join(' · ');
}
