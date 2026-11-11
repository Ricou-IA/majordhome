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

/**
 * Catalogue FERMÉ des souplesses qu'une organisation peut proposer (Eric 2026-11-11 :
 * « cadrer le choix pour éviter un champ libre »). Minutes ; 240 = demi-journée.
 */
export const CATALOGUE_SOUPLESSES = [0, 10, 15, 20, 30, 45, 60, 90, 120, 240];

/** Option affichable d'une souplesse : { value, label, aide }. */
export function optionSouplesse(v) {
  if (v === 0) return { value: 0, label: 'Figé', aide: 'Le client exige cette heure' };
  if (v >= 240) return { value: v, label: 'Demi-journée', aide: 'Le client sait « matin » ou « après-midi »' };
  const lisible = v >= 60 ? `${Math.floor(v / 60)} h${v % 60 ? ` ${v % 60}` : ''}` : `${v} min`;
  return { value: v, label: `±${lisible}`, aide: `Peut glisser de ${lisible} avant ou après` };
}

/** Choix par défaut (organisation qui n'a rien réglé). */
export const SOUPLESSES = [0, 15, 30, 240].map(optionSouplesse);

/**
 * Souplesses proposées par l'organisation (`reglages.souplesses_proposees`, cf.
 * construireReglages) : filtrées sur le catalogue, figé toujours présent, triées. Liste
 * absente ou vide → les choix par défaut.
 * @param {{ souplesses_proposees?: number[] }|null} reglages
 * @returns {Array<{ value: number, label: string, aide: string }>}
 */
export function souplessesProposees(reglages) {
  const brut = Array.isArray(reglages?.souplesses_proposees) ? reglages.souplesses_proposees : null;
  const valeurs = (brut || []).map(Number).filter((v) => CATALOGUE_SOUPLESSES.includes(v));
  if (valeurs.length === 0) return SOUPLESSES;
  return [...new Set([0, ...valeurs])].sort((a, b) => a - b).map(optionSouplesse);
}

/**
 * Contrôle des réglages de souplesse saisis : au moins une souplesse en plus du figé, toutes
 * dans le catalogue, défaut parmi elles. Retourne le message d'erreur, ou null.
 */
export function erreurSouplesses(proposees, defaut) {
  const liste = (proposees || []).map(Number);
  if (liste.some((v) => !CATALOGUE_SOUPLESSES.includes(v))) return 'Valeur hors catalogue';
  if (!liste.some((v) => v > 0)) return 'Proposez au moins une souplesse en plus de « Figé »';
  if (!liste.includes(Number(defaut))) return 'La souplesse par défaut doit faire partie des choix proposés';
  return null;
}

/**
 * Contrôle des bornes de la demi-journée (heures, par demi-heure) : matin puis après-midi,
 * dans l'ordre, sans chevauchement, entre 6 h et 21 h. Retourne le message d'erreur, ou null.
 * @param {{ matin: number[], apres_midi: number[] }} dj
 */
export function erreurDemiJournee(dj) {
  const [a, b] = (dj?.matin || []).map(Number);
  const [c, d] = (dj?.apres_midi || []).map(Number);
  const ok = (h) => Number.isFinite(h) && h >= 6 && h <= 21 && Math.round(h * 2) === h * 2;
  if (![a, b, c, d].every(ok)) return 'Heures entre 6 h et 21 h, par demi-heure';
  if (!(a < b)) return 'Le matin doit finir après avoir commencé';
  if (!(b <= c)) return 'L’après-midi commence après la fin du matin';
  if (!(c < d)) return 'L’après-midi doit finir après avoir commencé';
  return null;
}

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
