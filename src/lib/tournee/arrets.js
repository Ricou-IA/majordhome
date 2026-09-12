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
 * Inverse de `minutesDepuisMinuit` : minutes depuis minuit -> "HH:MM".
 * La paire vit ici, à un seul endroit — c'est elle qui garantit qu'un RDV
 * décalé à l'écran s'écrit en base à l'heure exacte qu'on a montrée.
 */
export function minutesVersHeure(minutes) {
  const arrondi = Math.round(minutes ?? 0);
  const h = Math.floor(arrondi / 60) % 24;
  const m = ((arrondi % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DEMI_JOURNEE = 240;
const DEMI_JOURNEE_DEFAUT = { matin: [8, 12], apres_midi: [13, 18] };

/**
 * Seuls les rendez-vous d'Entretien (`maintenance`) et de SAV (`service`) sont
 * adaptables (décision Eric 2026-09-12) : une installation, une visite
 * technique ou un RDV commercial ont une heure ferme, le moteur ne les
 * déplace jamais. Source unique : souplesse.js et planningEvents.js l'importent.
 */
export const TYPES_ADAPTABLES = ['maintenance', 'service'];

/**
 * Tolérance de déplacement d'un RDV (spec 2026-09-12 « fenêtres d'abord,
 * heures ensuite ») : la plage [min, max] dans laquelle son heure de DÉBUT peut
 * glisser. Figé (heure exigée par le client, ou heure déjà communiquée :
 * `hour_confirmed_at`) ⇒ min = max = début. Sans souplesse renseignée
 * (`time_flex_minutes` NULL) ⇒ défaut d'org `flexDefaut`. 240 = demi-journée :
 * la plage devient la demi-journée qui contient l'heure provisoire.
 *
 * @param {{ scheduled_start, time_flex_minutes?, hour_confirmed_at? }} rdv
 * @param {{ flexDefaut?: number, amplitude?: {debut:number, fin:number}, demiJournee?: object }} [opts]
 * @returns {{ min: number, max: number, flex: number }|null}  null si le RDV n'a pas d'heure
 */
export function toleranceDe(rdv, { flexDefaut = 0, amplitude, demiJournee = DEMI_JOURNEE_DEFAUT } = {}) {
  const debut = minutesDepuisMinuit(rdv?.scheduled_start);
  if (debut == null) return null;
  const fige = !!rdv?.hour_confirmed_at || !TYPES_ADAPTABLES.includes(rdv?.appointment_type);
  const flex = fige ? 0 : (rdv?.time_flex_minutes ?? flexDefaut ?? 0);
  const duree = rdv?.duration_minutes || 60;
  let min = debut;
  let max = debut;
  if (flex >= DEMI_JOURNEE) {
    const [mDebut, mFin] = (demiJournee?.matin || DEMI_JOURNEE_DEFAUT.matin).map((h) => h * 60);
    const [aDebut, aFin] = (demiJournee?.apres_midi || DEMI_JOURNEE_DEFAUT.apres_midi).map((h) => h * 60);
    const [d, f] = debut < mFin ? [mDebut, mFin] : [aDebut, aFin];
    min = d;
    max = Math.max(d, f - duree); // doit finir dans la demi-journée
  } else if (flex > 0) {
    min = debut - flex;
    max = debut + flex;
  }
  if (amplitude) {
    min = Math.max(min, amplitude.debut);
    max = Math.min(max, Math.max(amplitude.debut, amplitude.fin - duree));
  }
  if (max < min) max = min;
  return { min, max, flex };
}

/**
 * Arrêts déjà posés d'une journée, prêts pour `sequencerTournee` /
 * `classerParCreneaux` : `{ id, key, dureeMinutes, fenetre?, tolerance? }`.
 *
 * La `fenetre` reste PONCTUELLE (l'heure provisoire, celle que l'écran montre) ;
 * la `tolerance` dit jusqu'où cette heure peut glisser — c'est elle que
 * `placerCandidat` lit pour décaler un voisin adaptable. Sans `opts`, la
 * tolérance vaut la fenêtre : strictement le comportement antérieur.
 *
 * @param {Array<{id, lat, lng, duration_minutes, scheduled_start, time_flex_minutes?, hour_confirmed_at?}>} rdvs
 *   `journee.rdvs` (cf. loaders.js::chargerJournees).
 * @param {{ lat: number, lng: number }|null} [coordsFallback]  position de repli
 *   (siège) pour un RDV sans coordonnées
 * @param {{ flexDefaut?: number, amplitude?: object, demiJournee?: object }} [opts]  cf. `toleranceDe`
 * @returns {Array<{id: string, key: string|null, dureeMinutes: number, fenetre?: {debut: number, fin: number}, tolerance?: {min: number, max: number, flex: number}}>}
 */
export function construireArretsExistants(rdvs, coordsFallback = null, opts = {}) {
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
    // Fenêtre ponctuelle : l'heure provisoire du rendez-vous, celle de l'écran.
    if (debut != null) {
      arret.fenetre = { debut, fin: debut };
      arret.tolerance = toleranceDe(r, opts);
    }
    return arret;
  });
}

/**
 * Même chose, mais la `fenetre` EST la tolérance : c'est l'entrée de
 * `sequencerTournee` pour la consolidation (« Figer la journée ») — l'ordonnanceur
 * peut poser chaque RDV n'importe où dans sa plage, les figés restant ponctuels.
 */
export function construireArretsPourConsolidation(rdvs, coordsFallback = null, opts = {}) {
  return construireArretsExistants(rdvs, coordsFallback, opts).map((a) => {
    if (!a.tolerance) return a;
    return { ...a, fenetre: { debut: a.tolerance.min, fin: a.tolerance.max } };
  });
}
