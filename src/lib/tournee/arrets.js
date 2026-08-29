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
//
// ⚠️ Un RDV SANS COORDONNÉES est conservé, avec `key: null`. Il l'était
// auparavant écarté, ce qui produisait exactement le défaut ci-dessus sous une
// autre forme : sa durée comptait dans la charge de la journée, mais il ne
// bloquait AUCUN créneau, donc le moteur plaçait des entretiens par-dessus.
// Cas réel observé le 04/09 : une installation de 8 h à 13 h sans coordonnée
// client, et des entretiens proposés à 8 h 05.
// Sans position, aucun trajet n'est calculable : `construireMatrice` retombe
// alors sur son coût par défaut (60 min) pour toute paire l'impliquant, ce qui
// est le comportement prudent recherché — le moteur évite de l'enchaîner de
// près plutôt que de supposer un déplacement gratuit.
// Le corollaire, côté appelant : les clés nulles doivent être filtrées avant
// d'être envoyées à Mapbox (elles n'ont pas de coordonnées à géocoder).
// ============================================================================

import { cleCoord } from './geo.js';

/**
 * "HH:MM" ou "HH:MM:SS" -> minutes depuis minuit. `null` si non exploitable.
 * Parsing en chaîne, jamais via `Date` (règle du dossier).
 *
 * Exporté : `timeline.js` place les mêmes RDV sur une barre horaire et doit
 * lire leur heure EXACTEMENT comme le séquenceur la lit — un RDV que le moteur
 * traite comme contraint à 8 h 30 mais que l'écran dessine ailleurs (ou pas du
 * tout) ferait mentir la seule vue qui sert à décider.
 */
export function minutesDepuisMinuit(hhmm) {
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
 *   `journee.rdvs` (cf. tournees.service.js).
 * @returns {Array<{id: string, key: string|null, dureeMinutes: number, fenetre?: {debut: number, fin: number}}>}
 */
export function construireArretsExistants(rdvs, coordsFallback = null) {
  const cleFallback = cleCoord(coordsFallback);
  return (rdvs || []).map((r) => {
    // Cascade : position du RDV (client ou lead géocodé, résolue en amont), puis
    // repli sur le siège. Un RDV dont on ignore où il se trouve conserve ainsi
    // une position plausible plutôt qu'aucune — c'est le choix métier retenu
    // (« toute intervention a une adresse, sinon celle de l'agence »).
    const arret = {
      id: r.id,
      key: cleCoord(r) || cleFallback,
      dureeMinutes: r.duration_minutes || 60,
    };
    const debut = minutesDepuisMinuit(r.scheduled_start);
    // Fenêtre ponctuelle : l'heure du rendez-vous est celle annoncée au client.
    if (debut != null) arret.fenetre = { debut, fin: debut };
    return arret;
  });
}
