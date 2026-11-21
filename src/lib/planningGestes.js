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

const VUES_SEMAINE = ['timeGridWeek', 'listWeek'];
const VUES_JOUR = ['timeGridDay', 'listDay'];

/** `YYYY-MM-DD` décalé de `jours` (date locale, sans dérive UTC). */
function decaler(iso, jours) {
  const [a, m, j] = String(iso).split('-').map(Number);
  return dateLocale(new Date(a, m - 1, j + jours));
}

/** Jour ouvré voisin (le calendrier masque samedi et dimanche). */
function jourOuvreVoisin(iso, sens) {
  let d = decaler(iso, sens);
  for (let i = 0; i < 2; i += 1) {
    const [a, m, j] = d.split('-').map(Number);
    const jour = new Date(a, m - 1, j).getDay();
    if (jour !== 0 && jour !== 6) break;
    d = decaler(d, sens);
  }
  return d;
}

/**
 * Plages que le calendrier annoncera si l'on clique « précédent » ou « suivant » :
 * elles servent à charger d'avance les RDV voisins, pour un changement de semaine
 * sans attente. Mêmes bornes que `plageDeVue` (semaine = lundi → samedi exclu, les
 * week-ends étant masqués ; jour = le jour ouvré voisin). Vue Mois : rien — la grille
 * déborde sur les mois voisins et ses bornes ne se déduisent pas d'un simple décalage.
 * @param {{ vue?: string, startDate?: string|null, endDate?: string|null }} p
 * @returns {Array<{ startDate: string, endDate: string }>}  précédente puis suivante
 */
export function plagesVoisines({ vue, startDate, endDate } = {}) {
  if (!startDate || !endDate) return [];
  if (VUES_SEMAINE.includes(vue)) {
    return [-7, 7].map((n) => ({ startDate: decaler(startDate, n), endDate: decaler(endDate, n) }));
  }
  if (VUES_JOUR.includes(vue)) {
    return [-1, 1].map((sens) => {
      const jour = jourOuvreVoisin(startDate, sens);
      return { startDate: jour, endDate: decaler(jour, 1) };
    });
  }
  return [];
}

// Grille horaire affichée par défaut ; elle ne s'étend que pour montrer un RDV
// posé plus tôt ou plus tard (Eric, 2026-11-21).
const GRILLE_DEBUT_MINUTES = 7 * 60 + 30;
const GRILLE_FIN_MINUTES = 18 * 60;
const PAS_GRILLE_MINUTES = 30;

const heureDeGrille = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
const minutesDuJour = (iso) => {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Bornes de la grille horaire : 7 h 30 → 18 h, élargies à la demi-heure près pour
 * que tout RDV affiché soit visible en entier. Les bandes de tolérance (events de
 * fond) n'élargissent rien. Un RDV sans heure de fin compte pour une heure.
 * @param {Array<{ start?: string, end?: (string|null), display?: string }>} events
 *   blocs du calendrier (`start` / `end` = `YYYY-MM-DDTHH:MM[:SS]`)
 * @returns {{ slotMinTime: string, slotMaxTime: string }}
 */
export function bornesDeGrille(events = []) {
  let debut = GRILLE_DEBUT_MINUTES;
  let fin = GRILLE_FIN_MINUTES;
  for (const e of events) {
    if (e.display === 'background') continue;
    const d = minutesDuJour(e.start);
    if (d === null) continue;
    const f = minutesDuJour(e.end) ?? d + DUREE_PAR_DEFAUT_MINUTES;
    debut = Math.min(debut, Math.floor(d / PAS_GRILLE_MINUTES) * PAS_GRILLE_MINUTES);
    fin = Math.max(fin, Math.ceil(Math.max(f, d + 1) / PAS_GRILLE_MINUTES) * PAS_GRILLE_MINUTES);
  }
  return { slotMinTime: heureDeGrille(Math.max(0, debut)), slotMaxTime: heureDeGrille(Math.min(24 * 60, fin)) };
}
