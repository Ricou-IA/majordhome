// src/lib/tournee/arrets.js
// ============================================================================
// Construction des arrêts "déjà posés" d'une journée, à partir des RDV bruts
// (majordhome_appointments + lat/lng résolus). Module PUR.
//
// Factorise une logique qui existait EN DOUBLE (tournees.service.js et
// RemplirJourneePanel.jsx, cf. revue finale C2) : les deux copies risquaient
// de diverger silencieusement à la prochaine correction. N'existe qu'ici
// désormais.
//
// C2 — un rendez-vous déjà pris est un ENGAGEMENT, pas une préférence :
// `sequencerTournee` ne contraint que les arrêts porteurs d'une `fenetre`,
// donc un arrêt existant SANS fenêtre flotte librement dans la journée (le
// moteur peut le réordonner n'importe où). On lui dérive une fenêtre depuis
// son heure réelle (`scheduled_start`), verrouillée en amont (arriver plus
// tôt fait juste patienter, cf. sequence.js::simuler) et desserrée en aval de
// `fenetrePromiseMinutes` (reglages.tournees.fenetre_promise_minutes — la
// largeur de créneau déjà annoncée au client, jusqu'ici jamais consommée).
// Un RDV sans heure de début exploitable reste SANS fenêtre plutôt que de lui
// en inventer une fausse : comportement antérieur, volontairement conservé
// pour ce cas précis.
// ============================================================================

import { cleCoord } from './geo.js';

/**
 * "HH:MM" ou "HH:MM:SS" -> minutes depuis minuit. `null` si non exploitable.
 * Parsing en chaîne, jamais via `Date` (règle du dossier).
 */
function minutesDepuisMinuit(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Arrêts déjà posés d'une journée, prêts pour `sequencerTournee` /
 * `classerCandidats` : `{ id, key, dureeMinutes, fenetre? }`.
 *
 * @param {Array<{id, lat, lng, duration_minutes, scheduled_start}>} rdvs
 *   `journee.rdvs` (cf. tournees.service.js). Un RDV sans coordonnées est
 *   exclu (aucun coût de trajet calculable), comme avant.
 * @param {number} fenetrePromiseMinutes  reglages.fenetre_promise_minutes —
 *   marge en aval de l'heure réelle avant qu'un retard soit jugé infaisable.
 * @returns {Array<{id: string, key: string|null, dureeMinutes: number, fenetre?: {debut: number, fin: number}}>}
 */
export function construireArretsExistants(rdvs, fenetrePromiseMinutes) {
  return (rdvs || [])
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => {
      const arret = { id: r.id, key: cleCoord(r), dureeMinutes: r.duration_minutes || 60 };
      const debut = minutesDepuisMinuit(r.scheduled_start);
      if (debut != null) arret.fenetre = { debut, fin: debut + (fenetrePromiseMinutes || 0) };
      return arret;
    });
}
