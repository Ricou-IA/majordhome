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

import { minutesDepuisMinuit } from './arrets.js';

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
