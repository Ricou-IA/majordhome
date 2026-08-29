// src/lib/tournee/timeline.js
// ============================================================================
// Placement des RDV d'une journée sur une barre horaire. Module PUR.
// Testé : node --test scripts/tournee/timeline.test.mjs
//
// Pourquoi ce module plutôt qu'un calcul dans le JSX : cette barre est la SEULE
// vue sur laquelle on décide si un entretien « rentre » quelque part. Un RDV
// qu'elle omettrait se lirait comme un trou libre — exactement le mensonge que
// le reste du module s'interdit (cf. « toute troncature s'affiche »). D'où :
//   - un RDV sans heure exploitable n'est PAS placé mais ressort dans
//     `sansHeure` : à l'écran de le dire, jamais de le taire ;
//   - un RDV qui sort de l'amplitude est placé quand même (clampé aux bords)
//     et porte `deborde: true` — il occupe le technicien, il doit se voir ;
//   - une amplitude dégénérée (fin <= début) ne produit AUCUN placement
//     silencieux : tout part dans `sansHeure`.
//
// L'heure est lue par `minutesDepuisMinuit` d'arrets.js — la MÊME lecture que
// celle du séquenceur. Deux lectures différentes de `scheduled_start`
// finiraient par diverger, et l'écran montrerait autre chose que ce que le
// moteur contraint.
// ============================================================================

import { minutesDepuisMinuit, minutesVersHeure } from './arrets.js';
import { cleCoord } from './geo.js';
import { trajetLocal } from './matrice.js';

/** Durée d'un RDV, avec le même défaut que partout ailleurs dans le module. */
const dureeDe = (rdv) => rdv?.duration_minutes || 60;

/**
 * Répartit les RDV d'une journée en segments positionnés (en % de l'amplitude)
 * et en RDV non plaçables.
 *
 * @param {Array<object>} rdvs  `journee.rdvs`
 * @param {{debut: number, fin: number}} amplitude  minutes depuis minuit
 * @returns {{
 *   span: number,
 *   segments: Array<{ id, rdv, debutMinutes, finMinutes, leftPct, widthPct, deborde }>,
 *   sansHeure: Array<object>,
 * }}
 *   `segments` est trié chronologiquement. `leftPct`/`widthPct` sont bornés à
 *   [0,100] et leur somme ne sort jamais de la barre.
 */
export function construireSegments(rdvs, amplitude) {
  const debutJour = amplitude?.debut;
  const finJour = amplitude?.fin;
  const span = Number.isFinite(debutJour) && Number.isFinite(finJour) ? finJour - debutJour : 0;

  // Amplitude inexploitable : aucun placement ne voudrait dire quoi que ce
  // soit. On rend tous les RDV visibles par l'autre canal plutôt que d'en
  // dessiner à des positions inventées.
  if (span <= 0) return { span: 0, segments: [], sansHeure: [...(rdvs || [])] };

  const segments = [];
  const sansHeure = [];

  for (const rdv of rdvs || []) {
    const debut = minutesDepuisMinuit(rdv.scheduled_start);
    if (debut == null) { sansHeure.push(rdv); continue; }

    const fin = debut + dureeDe(rdv);
    const debordeAvant = debut < debutJour;
    const debordeApres = fin > finJour;

    // Clamp d'AFFICHAGE seulement : `debutMinutes`/`finMinutes` gardent les
    // heures réelles (c'est ce qu'on montre en clair et ce sur quoi un
    // déplacement se calcule), seuls left/width sont ramenés dans la barre.
    const debutVu = Math.max(debut, debutJour);
    const finVue = Math.min(fin, finJour);

    segments.push({
      id: rdv.id,
      rdv,
      // Clé de position : sert aux BORNES de déplacement, pour qu'un RDV glissé
      // ne vienne pas se coller à son voisin sans laisser le temps d'y aller.
      key: cleCoord(rdv),
      debutMinutes: debut,
      finMinutes: fin,
      leftPct: ((debutVu - debutJour) / span) * 100,
      // Un RDV entièrement hors amplitude donnerait une largeur nulle donc
      // invisible : plancher à un filet visible, quitte à être imprécis — on
      // préfère un repère un peu large à un RDV qu'on ne voit pas.
      widthPct: Math.max(((finVue - debutVu) / span) * 100, 1.5),
      deborde: debordeAvant || debordeApres,
    });
  }

  segments.sort((a, b) => a.debutMinutes - b.debutMinutes);
  return { span, segments, sansHeure };
}

/**
 * Repères horaires réguliers à l'intérieur de l'amplitude, pour situer les
 * blocs. Bornes incluses seulement si elles tombent sur le pas.
 *
 * @param {{debut: number, fin: number}} amplitude
 * @param {number} [pasMinutes=120]
 * @returns {Array<{minutes: number, leftPct: number, heure: number}>}
 */
export function graduations(amplitude, pasMinutes = 120) {
  const debut = amplitude?.debut;
  const fin = amplitude?.fin;
  const span = Number.isFinite(debut) && Number.isFinite(fin) ? fin - debut : 0;
  if (span <= 0 || !(pasMinutes > 0)) return [];

  const reperes = [];
  // Première heure ronde alignée sur le pas, à partir de minuit : sur une
  // amplitude 8 h–18 h au pas de 2 h on obtient 8, 10, 12… et non 8, 10 décalé
  // d'un reste (des repères à 8 h 07 seraient illisibles).
  const premier = Math.ceil(debut / pasMinutes) * pasMinutes;
  for (let m = premier; m <= fin; m += pasMinutes) {
    reperes.push({ minutes: m, leftPct: ((m - debut) / span) * 100, heure: Math.floor(m / 60) });
  }
  return reperes;
}

/**
 * Créneaux libres entre les RDV placés, bornes de journée comprises.
 * Sert à répondre à la question que la barre pose : « où reste-t-il de la
 * place ? ». Les chevauchements éventuels sont absorbés (on avance un curseur),
 * donc deux RDV qui se recouvrent ne fabriquent jamais un trou négatif.
 *
 * @returns {Array<{debutMinutes: number, finMinutes: number, dureeMinutes: number, leftPct: number, widthPct: number}>}
 */
export function creneauxLibres(segments, amplitude) {
  const debutJour = amplitude?.debut;
  const finJour = amplitude?.fin;
  const span = Number.isFinite(debutJour) && Number.isFinite(finJour) ? finJour - debutJour : 0;
  if (span <= 0) return [];

  const trous = [];
  let curseur = debutJour;
  const pousser = (a, b) => {
    if (b - a <= 0) return;
    trous.push({
      debutMinutes: a,
      finMinutes: b,
      dureeMinutes: b - a,
      leftPct: ((a - debutJour) / span) * 100,
      widthPct: ((b - a) / span) * 100,
    });
  };

  for (const s of segments) {
    const debut = Math.max(s.debutMinutes, debutJour);
    if (debut > curseur) pousser(curseur, Math.min(debut, finJour));
    curseur = Math.max(curseur, Math.min(s.finMinutes, finJour));
  }
  pousser(curseur, finJour);
  return trous;
}

// ============================================================================
// DÉCALAGE MANUEL D'UN RDV DÉJÀ POSÉ
// ============================================================================
// Le planning existant reste une contrainte ABSOLUE pour le moteur : il ne
// déplace jamais rien de lui-même, et un RDV garde sa fenêtre ponctuelle.
// Ce que ces deux fonctions ouvrent, c'est autre chose — un HUMAIN qui décide
// de décaler un rendez-vous pour faire rentrer un entretien. La décision reste
// la sienne (c'est une heure annoncée à un client), le moteur ne fait que
// recalculer sur la nouvelle donne.
//
// Règle de butée : un RDV glissé s'arrête à la distance de son voisin — pas au
// contact. Le TRAJET entre les deux est réservé, sinon on dessine une journée
// impossible : finir chez un client à 9 h 30 et être chez le suivant à 9 h 30.
// Vu à l'écran le 2026-08-29, deux blocs accolés après un glissement.
// Un RDV ne traverse jamais un autre : deux rendez-vous qui échangeraient leur
// ordre au passage d'un pixel produiraient une tournée qu'on n'a pas voulue.

/**
 * Jusqu'où un RDV peut être glissé sans empiéter sur ses voisins (trajet
 * compris) ni sortir de la journée.
 *
 * @param {Array} segments   sortie de `construireSegments`, triée
 * @param {string} id
 * @param {{debut: number, fin: number}} amplitude
 * @param {Function} [trajet=trajetLocal]  (fromKey, toKey) => minutes. Par
 *   défaut l'estimation à vol d'oiseau : la barre n'a pas de matrice Mapbox
 *   sous la main, et une butée approchée vaut mieux qu'une butée à zéro.
 * @returns {{minDebut: number, maxDebut: number, dureeMinutes: number}|null}
 */
export function bornesDeplacement(segments, id, amplitude, trajet = trajetLocal) {
  const i = (segments || []).findIndex((s) => s.id === id);
  if (i === -1) return null;
  const s = segments[i];
  const duree = s.finMinutes - s.debutMinutes;

  let minDebut = amplitude?.debut ?? s.debutMinutes;
  let maxDebut = (amplitude?.fin ?? s.finMinutes) - duree;

  // Marge de route entre deux arrêts : le trajet ESTIMÉ. Quand une position
  // manque, on n'invente AUCUNE contrainte — mieux vaut une butée trop
  // permissive (que le moteur rattrapera au calcul) qu'une butée de 60 min
  // fabriquée sur du vide, qui empêcherait de bouger un RDV sans raison visible.
  //
  // ⚠️ Une contrainte DÉJÀ violée par le planning en place ne s'applique pas.
  // Sur le 31/08, LODDO finit à 9 h 30 et TREVISIOL commence à 10 h : 30 min
  // d'écart là où l'estimation en réclame 46. TREVISIOL se retrouvait donc figé,
  // incapable de reculer d'une seule minute — pour faire respecter un trajet qui
  // n'était de toute façon pas respecté. Dans ce cas la butée redescend au
  // contact et l'humain reprend la main : c'est lui qui sait si ce trajet passe
  // (l'estimation est à vol d'oiseau, le technicien connaît sa route). L'écart
  // insuffisant est signalé à l'écran plutôt qu'imposé — cf.
  // `trajetDepuisPrecedent`, dont la carte de survol affiche les deux chiffres.
  const marge = (a, b, ecartConstate) => {
    if (!a || !b) return 0;
    const estime = trajet(a, b);
    return (ecartConstate != null && ecartConstate < estime) ? 0 : estime;
  };

  const precedent = segments[i - 1];
  const suivant = segments[i + 1];
  if (precedent) {
    const m = marge(precedent.key, s.key, s.debutMinutes - precedent.finMinutes);
    minDebut = Math.max(minDebut, precedent.finMinutes + m);
  }
  if (suivant) {
    const m = marge(s.key, suivant.key, suivant.debutMinutes - s.finMinutes);
    maxDebut = Math.min(maxDebut, suivant.debutMinutes - m - duree);
  }

  // La position ACTUELLE est toujours atteignable : sans ça, un RDV qui déborde
  // déjà de l'amplitude (installation commencée à 7 h) ou qui chevauche un
  // voisin sauterait tout seul à la première prise en main — un déplacement que
  // personne n'a demandé, sur une heure promise à un client.
  minDebut = Math.min(minDebut, s.debutMinutes);
  maxDebut = Math.max(maxDebut, s.debutMinutes);

  return { minDebut, maxDebut, dureeMinutes: duree };
}

/**
 * Jusqu'où la DURÉE d'un RDV peut être ajustée sans mordre sur le suivant ni
 * sortir de la journée. Symétrique de `bornesDeplacement` : raccourcir une
 * intervention est l'autre façon de faire de la place.
 *
 * @param {Array} segments   sortie de `construireSegments`, triée
 * @param {string} id
 * @param {{debut: number, fin: number}} amplitude
 * @param {Function} [trajet=trajetLocal]
 * @param {number} [minimum=15]  durée plancher — une intervention de 0 min
 *   n'existe pas, et un bloc invisible ne se rattrape plus à la souris.
 * @returns {{minDuree: number, maxDuree: number}|null}
 */
export function bornesDuree(segments, id, amplitude, trajet = trajetLocal, minimum = 15) {
  const i = (segments || []).findIndex((s) => s.id === id);
  if (i === -1) return null;
  const s = segments[i];
  const dureeActuelle = s.finMinutes - s.debutMinutes;

  const suivant = segments[i + 1];
  // Même règle que `bornesDeplacement` : trajet estimé, sauf si le planning en
  // place ne le respecte déjà pas — auquel cas on ne l'impose pas.
  let marge = 0;
  if (suivant && s.key && suivant.key) {
    const estime = trajet(s.key, suivant.key);
    marge = (suivant.debutMinutes - s.finMinutes) < estime ? 0 : estime;
  }
  const butoir = suivant
    ? suivant.debutMinutes - marge
    : (amplitude?.fin ?? s.finMinutes);

  return {
    minDuree: Math.min(minimum, dureeActuelle),
    // La durée actuelle reste toujours atteignable : un RDV qui déborde déjà ne
    // doit pas se voir raccourci d'office à la première prise en main.
    maxDuree: Math.max(butoir - s.debutMinutes, dureeActuelle),
  };
}

/**
 * Applique les ajustements manuels à des RDV bruts : décalage de l'heure de
 * début et/ou nouvelle durée.
 *
 * Point d'injection UNIQUE : tout ce qui suit (arrêts existants, placement,
 * aperçu, trajets réels de la pose) consomme le résultat sans savoir qu'un
 * ajustement a eu lieu. Une seconde voie qui contournerait cette fonction ferait
 * diverger ce qu'on montre de ce qu'on calcule.
 *
 * Un RDV sans heure exploitable n'est pas ajustable : il est rendu tel quel
 * plutôt que de lui inventer un horaire à partir de rien.
 *
 * @param {Array<object>} rdvs
 * @param {Map<string, number>|null} decalages  minutes signées
 * @param {Map<string, number>|null} durees     nouvelle durée en minutes
 * @returns {Array<object>}  `decalageMinutes` / `dureeInitialeMinutes` portés
 *   sur les RDV touchés
 */
export function appliquerAjustements(rdvs, decalages, durees) {
  const aDecalages = decalages && decalages.size > 0;
  const aDurees = durees && durees.size > 0;
  if (!aDecalages && !aDurees) return rdvs || [];

  return (rdvs || []).map((r) => {
    const delta = aDecalages ? (decalages.get(r.id) || 0) : 0;
    const dureeVoulue = aDurees ? durees.get(r.id) : undefined;
    if (!delta && dureeVoulue == null) return r;

    const debut = minutesDepuisMinuit(r.scheduled_start);
    if (debut == null) return r;

    const dureeInitiale = r.duration_minutes || 60;
    const duree = dureeVoulue ?? dureeInitiale;
    return {
      ...r,
      scheduled_start: minutesVersHeure(debut + delta),
      scheduled_end: minutesVersHeure(debut + delta + duree),
      duration_minutes: duree,
      ...(delta ? { decalageMinutes: delta } : {}),
      ...(dureeVoulue != null && dureeVoulue !== dureeInitiale
        ? { dureeInitialeMinutes: dureeInitiale } : {}),
    };
  });
}

/**
 * Temps de route entre un arrêt et le précédent : l'estimation, et le temps
 * réellement disponible entre les deux rendez-vous.
 *
 * Existe pour être AFFICHÉ. Cette information manquait complètement à l'écran —
 * au point que la poignée de redimensionnement, une simple zone teintée au bord
 * du bloc, a été prise pour « le transport » (31/08). Une donnée qu'on cherche
 * et qui n'est nulle part finit toujours par être lue dans autre chose.
 *
 * Les DEUX chiffres sont rendus, jamais le seul minimum : quand le planning
 * laisse moins de temps que le trajet estimé (30 min pour 46 estimées sur le
 * 31/08), c'est précisément ce qu'il faut montrer — et c'est ce qui explique
 * qu'on n'impose alors aucune butée (cf. `bornesDeplacement`).
 *
 * @returns {{minutes: number, disponibleMinutes: number, insuffisant: boolean,
 *   depuisId: string}|null} `null` s'il n'y a pas de précédent, ou si l'un des
 *   deux points n'a pas de position (aucun trajet n'est alors calculable, et en
 *   inventer un serait pire que se taire).
 */
export function trajetDepuisPrecedent(segments, id, trajet = trajetLocal) {
  const i = (segments || []).findIndex((s) => s.id === id);
  if (i <= 0) return null;
  const s = segments[i];
  const precedent = segments[i - 1];
  if (!s.key || !precedent.key) return null;
  const estime = trajet(precedent.key, s.key);
  const disponible = Math.max(s.debutMinutes - precedent.finMinutes, 0);
  return {
    minutes: estime,
    disponibleMinutes: disponible,
    insuffisant: disponible < estime,
    depuisId: precedent.id,
  };
}
