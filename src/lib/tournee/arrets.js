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
// moteur peut le réordonner n'importe où). On lui dérive donc une fenêtre
// depuis son heure réelle (`scheduled_start`).
//
// ⚠️ Cette fenêtre est PONCTUELLE : `fin === debut`. Un rendez-vous annoncé au
// client à 8 h 30 est à 8 h 30, il ne se décale pas.
// Ne pas confondre avec `fenetre_promise_minutes`, qui est la largeur du
// créneau annoncé pour un NOUVEAU rendez-vous (« vers 10 h 30, entre 10 h et
// 11 h 30 ») : l'appliquer à un rendez-vous déjà pris autorisait le moteur à
// le faire glisser de 90 min, et donc à insérer un entretien qui mordait
// dessus. Cas réel observé en production le 10/09 : un rendez-vous humain à
// 8 h 30 (2 h), un entretien de 60 min proposé à 8 h 07 — retour au dépôt
// impossible avant 9 h 15, soit 45 min de chevauchement.
//
// L'amont n'a pas besoin d'être desserré : arriver en avance fait simplement
// patienter (`sequence.js::simuler` remonte `t` au début de la fenêtre).
// Un RDV sans heure de début exploitable reste SANS fenêtre plutôt que de lui
// en inventer une fausse : comportement antérieur, volontairement conservé.
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
 * @returns {Array<{id: string, key: string|null, dureeMinutes: number, fenetre?: {debut: number, fin: number}}>}
 */
export function construireArretsExistants(rdvs) {
  return (rdvs || [])
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => {
      const arret = { id: r.id, key: cleCoord(r), dureeMinutes: r.duration_minutes || 60 };
      const debut = minutesDepuisMinuit(r.scheduled_start);
      // Fenêtre ponctuelle : l'heure du rendez-vous est celle annoncée au client.
      if (debut != null) arret.fenetre = { debut, fin: debut };
      return arret;
    });
}
