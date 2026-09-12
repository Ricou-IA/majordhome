// src/lib/souplesse.js
// ============================================================================
// Souplesse d'un rendez-vous (spec 2026-09-12 « fenêtres d'abord, heures
// ensuite ») : valeurs, libellés et phrase d'annonce au client. Module PUR
// (hors composants, compatible Fast Refresh), testé :
// node --test scripts/souplesse.test.mjs
//
// Valeurs = appointments.time_flex_minutes : 0 figé (le client exige cette
// heure), 15, 30, 240 (demi-journée). `null` = défaut d'org.
// ============================================================================

export const SOUPLESSES = [
  { value: 0, label: 'Figé', aide: 'Le client exige cette heure' },
  { value: 15, label: '±15 min', aide: 'Peut glisser d’un quart d’heure' },
  { value: 30, label: '±30 min', aide: 'Peut glisser d’une demi-heure' },
  { value: 240, label: 'Demi-journée', aide: 'Le client sait « matin » ou « après-midi »' },
];

/** Libellé court d'une souplesse effective (après résolution du défaut). */
export function libelleSouplesse(flex) {
  if (flex === 0) return 'figé';
  if (flex >= 240) return 'demi-journée';
  return `±${flex} min`;
}

import { TYPES_ADAPTABLES } from './tournee/arrets.js';

export { TYPES_ADAPTABLES };

/** Un type de RDV concerné par la souplesse (Entretien, SAV). */
export const estTypeAdaptable = (appointmentType) => TYPES_ADAPTABLES.includes(appointmentType);

/**
 * Souplesse effective d'un RDV : type non concerné ou heure confirmée ⇒ 0,
 * sinon la sienne, sinon le défaut d'org.
 */
export function souplesseEffective(appointment, defaut = 30) {
  if (!estTypeAdaptable(appointment?.appointment_type)) return 0;
  if (appointment?.hour_confirmed_at) return 0;
  return appointment?.time_flex_minutes ?? defaut;
}

const hhmmVersMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const minutesVersHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Ce que le client entend, pour une heure provisoire et une souplesse.
 * @param {{ startTime: string }} slot   'HH:MM'
 * @param {number} flex
 * @param {string} jour   date déjà formatée (ex. « mar. 14 oct. »)
 * @param {{ demiJournee?: { matin: number[], apres_midi: number[] } }} [opts]
 *   bornes de l'org (heures) — la « matinée » s'arrête où l'org l'a décidé,
 *   comme dans toleranceDe (même réglage `demi_journee`), pas à midi en dur.
 */
export function phraseAnnonce(slot, flex, jour, { demiJournee } = {}) {
  const debut = hhmmVersMinutes(slot.startTime);
  const finMatin = (demiJournee?.matin?.[1] ?? 12) * 60;
  if (flex === 0) return `${jour} à ${slot.startTime} — heure ferme`;
  if (flex >= 240) return `${jour}, ${debut < finMatin ? 'dans la matinée' : 'dans l’après-midi'} (heure précisée la veille)`;
  return `${jour} vers ${slot.startTime} (entre ${minutesVersHHMM(Math.max(0, debut - flex))} et ${minutesVersHHMM(debut + flex)})`;
}
