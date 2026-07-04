// Helpers d'interaction du canevas de dessin — module PUR (aucun import React/DOM).
// Réutilise geometryEngine.js (même couche pure) pour les primitives de polygone.
// Coordonnées : ENTIERS en cm, grille 10 cm, x → droite, y → bas (SVG) — mêmes conventions
// que geometryEngine.js (décisions structurantes du plan 3).

import { GRILLE_CM, normalisePolygone, segmentsDe } from './geometryEngine.js';

/**
 * Accroche un point à la grille 10 cm : chaque coordonnée est arrondie au multiple de GRILLE_CM
 * le plus proche via `Math.round`. Règle de la demi-mesure (point EXACTEMENT à 5 cm d'un nœud de
 * grille) : `Math.round` arrondit les demis vers +∞ (jamais « loin de zéro »), donc 15 → 20
 * (0,5 → 1, demi vers le haut, comportement usuel) mais −15 → −10 (−1,5 → −1, PAS −2 : le demi
 * « vers +∞ » revient ici à arrondir vers zéro). Documenté et testé explicitement (15→20, −15→−10).
 * @param {{x: number, y: number}} point coordonnées entières (cm)
 * @returns {{x: number, y: number}} point accroché à la grille
 */
export function snapPoint(point) {
  if (!point || typeof point !== 'object'
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('thermique: snapPoint : point {x, y} numérique fini requis');
  }
  return {
    x: Math.round(point.x / GRILLE_CM) * GRILLE_CM,
    y: Math.round(point.y / GRILLE_CM) * GRILLE_CM,
  };
}

/**
 * Construit un rectangle normalisé (CCW, repère y-bas — même convention que normalisePolygone)
 * depuis un drag souris/tactile entre deux points quelconques. Les deux points sont d'abord
 * accrochés à la grille (snapPoint) ; le rectangle est ensuite orienté quel que soit l'ordre ou
 * le sens du drag. Dégénéré (largeur ou hauteur nulle après accroche — moins d'une cellule de
 * grille dans une dimension) → `null` (pas de pièce à créer).
 * @param {{x: number, y: number}} p1 premier point du drag (coordonnées brutes, non accrochées)
 * @param {{x: number, y: number}} p2 second point du drag
 * @returns {{x: number, y: number}[]|null} polygone rectangle à 4 sommets CCW, ou null si dégénéré
 */
export function rectDepuisDrag(p1, p2) {
  const a = snapPoint(p1);
  const b = snapPoint(p2);
  const xMin = Math.min(a.x, b.x);
  const xMax = Math.max(a.x, b.x);
  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  if (xMax - xMin < GRILLE_CM || yMax - yMin < GRILLE_CM) return null;
  // CCW en repère y-bas (cf. Task 1 : (0,0)→(0,h)→(L,h)→(L,0)) : haut-gauche → bas-gauche →
  // bas-droite → haut-droite.
  return [
    { x: xMin, y: yMin },
    { x: xMin, y: yMax },
    { x: xMax, y: yMax },
    { x: xMax, y: yMin },
  ];
}

/**
 * Teste l'appartenance d'un point à un polygone rectilinéaire par ray-casting horizontal
 * (rayon vers x = +∞ à partir du point, compte les croisements d'arêtes VERTICALES). Un point
 * exactement SUR le bord (segment ou sommet) est considéré DEDANS : décision d'ergonomie de
 * sélection (cliquer pile sur un mur doit sélectionner la pièce), documentée ici et testée
 * explicitement (bord, sommet, encoche d'un L).
 * @param {{x: number, y: number}} pt point testé (coordonnées numériques, pas nécessairement sur
 *   la grille — un clic souris converti en cm)
 * @param {{x: number, y: number}[]} poly polygone rectilinéaire (normalisé ou non — le test de
 *   parité fonctionne sur l'ordre des sommets tel quel, fermeture implicite)
 * @returns {boolean}
 */
export function pointDansPolygone(pt, poly) {
  if (!pt || typeof pt !== 'object' || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
    throw new Error('thermique: pointDansPolygone : pt {x, y} numérique fini requis');
  }
  if (!Array.isArray(poly) || poly.length < 3) {
    throw new Error('thermique: pointDansPolygone : poly (≥ 3 sommets) requis');
  }

  const segs = segmentsDe(poly);

  // Détection « sur le bord » (segment ou sommet) : distance perpendiculaire nulle avec
  // projection dans l'étendue du segment (les segments sont axis-aligned, donc un simple test
  // de colinéarité + bornes suffit, exact en arithmétique entière ou flottante).
  for (const s of segs) {
    if (s.axe === 'v') {
      if (pt.x === s.x1 && pt.y >= Math.min(s.y1, s.y2) && pt.y <= Math.max(s.y1, s.y2)) return true;
    } else {
      if (pt.y === s.y1 && pt.x >= Math.min(s.x1, s.x2) && pt.x <= Math.max(s.x1, s.x2)) return true;
    }
  }

  // Ray-casting standard vers x = +∞ : compte les arêtes qui croisent strictement la demi-droite
  // horizontale y = pt.y. Convention demi-ouverte sur y pour éviter le double-compte aux sommets.
  let dedans = false;
  for (const s of segs) {
    const y1 = s.y1, y2 = s.y2;
    const traverse = (y1 > pt.y) !== (y2 > pt.y);
    if (!traverse) continue;
    const xCroisement = s.x1 + ((pt.y - y1) / (y2 - y1)) * (s.x2 - s.x1);
    if (xCroisement > pt.x) dedans = !dedans;
  }
  return dedans;
}

/**
 * Trouve le segment du polygone le plus proche d'un point, pour poser une ouverture par tap/clic
 * sur un mur. `position` = distance depuis le DÉBUT DU PARCOURS du segment (même convention que
 * `intervalleAxial` de geometryEngine.js) : pour un segment parcouru en coordonnée croissante,
 * position = coordonnée du point projeté − coordonnée de départ ; pour un segment parcouru en
 * coordonnée DÉCROISSANTE (ex. mur est/nord d'un rectangle CCW), position = coordonnée de départ
 * (qui est le max) − coordonnée du point projeté. La position est TOUJOURS clampée à
 * [0, longueur] (le point peut se projeter hors de l'étendue du segment). La distance retournée
 * est la distance perpendiculaire du point à la droite du segment si sa projection tombe dans
 * l'étendue, sinon la distance euclidienne au sommet le plus proche (projection clampée).
 * @param {{x: number, y: number}} pt point testé (coordonnées numériques, ex. position du curseur
 *   en cm)
 * @param {{x: number, y: number}[]} poly polygone rectilinéaire (sera normalisé en CCW — même
 *   parcours que segmentsDe/intervalleAxial dans geometryEngine.js)
 * @param {number} toleranceCm distance maximale (cm) pour considérer un segment « proche »
 * @returns {{segmentIndex: number, position: number, distance: number}|null} le segment le plus
 *   proche dans la tolérance, ou null si aucun segment n'est assez proche
 */
export function segmentLePlusProche(pt, poly, toleranceCm) {
  if (!pt || typeof pt !== 'object' || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
    throw new Error('thermique: segmentLePlusProche : pt {x, y} numérique fini requis');
  }
  if (!Array.isArray(poly) || poly.length < 3) {
    throw new Error('thermique: segmentLePlusProche : poly (≥ 3 sommets) requis');
  }
  if (!Number.isFinite(toleranceCm) || toleranceCm < 0) {
    throw new Error('thermique: segmentLePlusProche : toleranceCm numérique ≥ 0 requis');
  }

  const segs = segmentsDe(normalisePolygone(poly));
  let meilleur = null;

  segs.forEach((s, segmentIndex) => {
    // Coordonnée de départ/fin du parcours sur l'axe du segment (convention intervalleAxial).
    const debut = s.axe === 'v' ? s.y1 : s.x1;
    const fin = s.axe === 'v' ? s.y2 : s.x2;
    const longueur = s.longueur;

    // Coordonnée du point projetée sur l'axe du segment, et distance perpendiculaire à la droite
    // porteuse (constante sur l'autre axe).
    const coordPt = s.axe === 'v' ? pt.y : pt.x;
    const constante = s.axe === 'v' ? s.x1 : s.y1;
    const perpendiculaire = s.axe === 'v' ? pt.x : pt.y;
    const distancePerp = Math.abs(perpendiculaire - constante);

    // Position brute le long du parcours (avant clamp), puis clampée à [0, longueur].
    const coordClampee = Math.min(Math.max(coordPt, Math.min(debut, fin)), Math.max(debut, fin));
    const position = fin > debut ? coordClampee - debut : debut - coordClampee;
    const positionClampee = Math.min(Math.max(position, 0), longueur);

    // Distance : perpendiculaire si la projection tombe dans l'étendue du segment, sinon
    // distance euclidienne au point clampé (sommet le plus proche).
    const dansEtendue = coordPt >= Math.min(debut, fin) && coordPt <= Math.max(debut, fin);
    const distance = dansEtendue
      ? distancePerp
      : Math.sqrt((perpendiculaire - constante) ** 2 + (coordPt - coordClampee) ** 2);

    if (distance > toleranceCm) return;
    if (!meilleur || distance < meilleur.distance) {
      meilleur = { segmentIndex, position: positionClampee, distance };
    }
  });

  return meilleur;
}

/**
 * Accroche à la grille et clampe la position d'une ouverture le long de son segment porteur, pour
 * qu'elle tienne entièrement dans le mur : position finale ∈ [0, longueur − largeur]. `null` si
 * l'ouverture ne peut pas tenir (largeur > longueur du segment).
 * @param {{longueur: number}} segment segment porteur (longueur entière cm ; seul ce champ est
 *   utilisé — accepte un objet de segmentsDe ou tout objet { longueur })
 * @param {number} positionBrute position brute (cm, avant accroche), ex. issue du curseur
 * @param {number} largeur largeur entière (cm) de l'ouverture
 * @returns {number|null} position accrochée à la grille 10 cm et clampée, ou null si impossible
 */
export function positionOuvertureSnappee(segment, positionBrute, largeur) {
  if (!segment || typeof segment !== 'object' || !Number.isFinite(segment.longueur)) {
    throw new Error('thermique: positionOuvertureSnappee : segment {longueur} numérique requis');
  }
  if (!Number.isFinite(positionBrute)) {
    throw new Error('thermique: positionOuvertureSnappee : positionBrute numérique requis');
  }
  if (!Number.isFinite(largeur) || largeur <= 0) {
    throw new Error('thermique: positionOuvertureSnappee : largeur numérique > 0 requise');
  }
  if (largeur > segment.longueur) return null;

  const max = segment.longueur - largeur; // borne haute (≥ 0, cf. garde ci-dessus)
  const snappee = Math.round(positionBrute / GRILLE_CM) * GRILLE_CM;
  return Math.min(Math.max(snappee, 0), max);
}

/**
 * Boîte englobante de toutes les pièces d'un dessin, avec une marge de 100 cm de chaque côté —
 * sert à cadrer le viewBox SVG du canevas. Aucune pièce → boîte par défaut 1000×800 cm à
 * l'origine (documenté : évite un canevas vide sans dimension au premier chargement du wizard).
 * @param {{polygone: {x: number, y: number}[]}[]} pieces pièces (au moins un champ `polygone`
 *   par élément — les autres champs, ex. id/niveauId, sont ignorés)
 * @returns {{x: number, y: number, largeur: number, hauteur: number}} rectangle englobant (cm)
 */
export function boiteEnglobante(pieces) {
  if (!Array.isArray(pieces)) {
    throw new Error('thermique: boiteEnglobante : pieces doit être un tableau');
  }
  const MARGE_CM = 100;
  if (pieces.length === 0) {
    return { x: 0, y: 0, largeur: 1000, hauteur: 800 };
  }

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const piece of pieces) {
    if (!piece || !Array.isArray(piece.polygone)) {
      throw new Error('thermique: boiteEnglobante : chaque pièce doit avoir un polygone');
    }
    for (const p of piece.polygone) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }

  return {
    x: xMin - MARGE_CM,
    y: yMin - MARGE_CM,
    largeur: xMax - xMin + 2 * MARGE_CM,
    hauteur: yMax - yMin + 2 * MARGE_CM,
  };
}
