/**
 * planningGestes.js - Majord'home Artisan
 * ============================================================================
 * Ce que les gestes du calendrier veulent dire, en données : la plage qu'une vue
 * annonce, le créneau d'un clic dans le vide, le déplacement d'un RDV glissé ou
 * étiré. Module PUR (aucun import React / Supabase / alias), testé par
 * scripts/planning-gestes.test.mjs — usePlanningGestes ne fait qu'appeler.
 *
 * Toutes les dates sont LOCALES : `toISOString()` passe en UTC et recule d'un
 * jour tout ce qui se passe entre minuit et l'écart au méridien (une sélection
 * « journée entière » = minuit local = la veille en UTC).
 * ============================================================================
 */

import { isoWeekNumber } from './planningPrintModel.js';

const DUREE_PAR_DEFAUT_MINUTES = 60;
const HEURE_PAR_DEFAUT = '09:00';
// Vues qui montrent au plus une semaine : le numéro de semaine y a un sens.
const VUES_A_SEMAINE = ['timeGridWeek', 'timeGridDay', 'listWeek', 'listDay'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Date locale `YYYY-MM-DD`.
 * @param {Date} date
 * @returns {string}
 */
export function dateLocale(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Heure locale `HH:MM`.
 * @param {Date} date
 * @returns {string}
 */
export function heureLocale(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Ce qu'une vue du calendrier annonce (FullCalendar `datesSet`).
 * @param {{ start: Date, end: Date, startStr?: string, endStr?: string,
 *   view: { type: string, title: string, currentStart: Date, currentEnd: Date } }} info
 * @returns {{ vue: string, titre: string, plage: { startDate: string, endDate: string },
 *   periode: { debut: string, finExclue: string }, semaine: number|null }}
 *   `plage` = la grille chargée (déborde sur les mois voisins en vue Mois) ;
 *   `periode` = ce que le titre annonce (cumul du CA) ; `semaine` = numéro ISO, null en vue Mois.
 */
export function plageDeVue(info) {
  return {
    vue: info.view.type,
    titre: info.view.title,
    plage: {
      startDate: info.startStr?.split('T')[0] || dateLocale(info.start),
      endDate: info.endStr?.split('T')[0] || dateLocale(info.end),
    },
    periode: { debut: dateLocale(info.view.currentStart), finExclue: dateLocale(info.view.currentEnd) },
    semaine: VUES_A_SEMAINE.includes(info.view.type) ? isoWeekNumber(info.start) : null,
  };
}

/**
 * Créneau proposé à la fenêtre « Nouveau RDV » pour un clic dans le vide.
 * @param {{ start: Date, allDay?: boolean }} selection
 * @returns {{ defaultDate: string, defaultTime: string }}  9 h pour une journée entière (vue Mois)
 */
export function creneauDeSelection({ start, allDay = false }) {
  return { defaultDate: dateLocale(start), defaultTime: allDay ? HEURE_PAR_DEFAUT : heureLocale(start) };
}

/**
 * Créneau proposé par le bouton « Nouveau RDV » : aujourd'hui, 9 h.
 * @param {Date} [maintenant]
 * @returns {{ defaultDate: string, defaultTime: string }}
 */
export function creneauParDefaut(maintenant = new Date()) {
  return { defaultDate: dateLocale(maintenant), defaultTime: HEURE_PAR_DEFAUT };
}

/**
 * Id du RDV porté par un bloc du calendrier. Un RDV à plusieurs techniciens est
 * éclaté en un bloc par personne (`${id}__${technicienId}`) : l'id réel est dans
 * `extendedProps.id`, jamais dans `event.id`.
 * @param {{ id?: string, extendedProps?: { id?: string } }} event
 * @returns {string|undefined}
 */
export function idDuRdv(event) {
  return event?.extendedProps?.id || event?.id;
}

/**
 * Nouvel horaire d'un RDV glissé ou étiré dans le calendrier.
 * @param {{ start: Date, end?: Date|null }} event  fin absente (glissé depuis la vue Mois) = une heure
 * @returns {{ scheduled_date: string, scheduled_start: string, scheduled_end: string, duration_minutes: number }}
 */
export function horaireDeBloc({ start, end = null }) {
  const fin = end || new Date(start.getTime() + DUREE_PAR_DEFAUT_MINUTES * 60000);
  return {
    scheduled_date: dateLocale(start),
    scheduled_start: heureLocale(start),
    scheduled_end: heureLocale(fin),
    duration_minutes: Math.round((fin - start) / 60000),
  };
}
