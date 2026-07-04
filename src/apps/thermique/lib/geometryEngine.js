// Moteur de géométrie du plan dessiné — module PUR (aucun import).
// Coordonnées : ENTIERS en cm (grille 10 cm), x → droite, y → bas (SVG).
// Polygones : rectilinéaires (angles droits), normalisés anti-horaires, fermeture implicite.
// Erreurs de dessin → tableaux de messages (l'UI affiche) ; erreurs de programmation → throw 'thermique:'.

export const GRILLE_CM = 10;

/** Aire signée ×2 (shoelace). Positif = horaire en repère y-bas. */
function aireSignee2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

export function surfaceCm2(poly) { return Math.abs(aireSignee2(poly)) / 2; }

export function perimetreCm(poly) {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    p += Math.abs(b.x - a.x) + Math.abs(b.y - a.y); // rectilinéaire
  }
  return p;
}

/** Normalise en anti-horaire (repère y-bas : aire signée > 0 ⇒ horaire ⇒ renverser en gardant poly[0]). */
export function normalisePolygone(poly) {
  if (!Array.isArray(poly) || poly.length < 4) throw new Error('thermique: polygone invalide (≥ 4 sommets)');
  return aireSignee2(poly) > 0 ? [poly[0], ...poly.slice(1).reverse()] : [...poly];
}

/** Segments orientés consécutifs, avec axe 'h'|'v'. Suppose le polygone rectilinéaire. */
export function segmentsDe(poly) {
  const segs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      longueur: Math.abs(b.x - a.x) + Math.abs(b.y - a.y), axe: a.x === b.x ? 'v' : 'h' });
  }
  return segs;
}

/** Erreurs de forme (tableau de messages FR, vide si valide). */
export function validePolygone(poly) {
  const err = [];
  // < 3 (pas < 4) : un « polygone » à 3 sommets doit atteindre le contrôle d'angles droits
  // pour produire le message précis « segment non rectiligne » (cf. test du plan).
  if (!Array.isArray(poly) || poly.length < 3) return ['polygone : au moins 3 sommets requis'];
  for (const p of poly) {
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) { err.push('coordonnées entières (cm) requises'); break; }
    if (p.x % GRILLE_CM !== 0 || p.y % GRILLE_CM !== 0) { err.push(`sommet hors grille ${GRILLE_CM} cm`); break; }
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.x !== b.x && a.y !== b.y) { err.push('segment non rectiligne (angles droits requis)'); break; }
    if (a.x === b.x && a.y === b.y) { err.push('segment de longueur nulle'); break; }
  }
  if (err.length === 0 && segmentsSeCroisent(poly)) err.push('le polygone s’auto-intersecte');
  if (err.length === 0 && surfaceCm2(poly) === 0) err.push('surface nulle');
  return err;
}

/** Auto-intersection rectilinéaire : paires de segments non adjacents h×v qui se croisent, ou colinéaires qui se chevauchent. */
function segmentsSeCroisent(poly) {
  const segs = segmentsDe(poly);
  const n = segs.length;
  const sontAdjacents = (i, j) => {
    const d = Math.abs(i - j);
    return d === 1 || d === n - 1; // consécutifs (fermeture incluse) partagent un sommet
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sontAdjacents(i, j)) continue;
      const s1 = segs[i], s2 = segs[j];
      if (s1.axe !== s2.axe) {
        // Un horizontal, un vertical : croisement strict en intérieur
        const h = s1.axe === 'h' ? s1 : s2;
        const v = s1.axe === 'h' ? s2 : s1;
        const hx1 = Math.min(h.x1, h.x2), hx2 = Math.max(h.x1, h.x2);
        const vy1 = Math.min(v.y1, v.y2), vy2 = Math.max(v.y1, v.y2);
        const vx = v.x1; // constant sur un segment vertical
        const hy = h.y1; // constant sur un segment horizontal
        if (vx > hx1 && vx < hx2 && hy > vy1 && hy < vy2) return true;
      } else {
        // Même axe : chevauchement colinéaire (même ordonnée constante) sur intervalles ouverts
        if (s1.axe === 'h') {
          if (s1.y1 !== s2.y1) continue; // pas la même ordonnée → pas colinéaires
          const a1 = Math.min(s1.x1, s1.x2), a2 = Math.max(s1.x1, s1.x2);
          const b1 = Math.min(s2.x1, s2.x2), b2 = Math.max(s2.x1, s2.x2);
          if (Math.max(a1, b1) < Math.min(a2, b2)) return true;
        } else {
          if (s1.x1 !== s2.x1) continue; // pas la même abscisse → pas colinéaires
          const a1 = Math.min(s1.y1, s1.y2), a2 = Math.max(s1.y1, s1.y2);
          const b1 = Math.min(s2.y1, s2.y2), b2 = Math.max(s2.y1, s2.y2);
          if (Math.max(a1, b1) < Math.min(a2, b2)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Décompose l'intervalle entier [de, a] en morceaux contigus ordonnés `{ de, a, ref }` selon une
 * liste de recouvrements étiquetés `{ de, a, ref }` (ex. les segments des pièces voisines qui
 * chevauchent un mur donné). `ref` vaut `null` sur les portions non couvertes (donnant sur
 * l'extérieur). Les recouvrements sont tronqués aux bornes `[de, a]` ; ceux entièrement hors
 * bornes sont ignorés. Deux morceaux contigus de même `ref` (y compris `null`) sont fusionnés ;
 * les morceaux de longueur nulle après troncature sont supprimés silencieusement.
 *
 * Ne PAS présupposer que les polygones amont sont des anneaux de Jordan stricts : les cas
 * dégénérés « pincement » (deux pièces qui se touchent en un seul point) et « fente » (un
 * aller-retour colinéaire adjacent) passent `validePolygone` en v1 et peuvent produire ici des
 * recouvrements de longueur nulle une fois tronqués — c'est pourquoi ils sont droppés en silence
 * plutôt que de lever une erreur. Le consommateur (Task 3, `adjacencesNiveau`) doit rester
 * tolérant à cette situation plutôt que de supposer une géométrie parfaitement propre.
 *
 * Deux recouvrements qui se chevauchent (même partiellement) à l'intérieur des bornes — QUE LES
 * REFS SOIENT DIFFÉRENTES OU IDENTIQUES — constituent une violation de contrat de programmation :
 * un tronçon de mur revendiqué deux fois trahit une géométrie amont corrompue, et l'accepter
 * produirait des morceaux non contigus en sortie (contrat violé). Cela doit être détecté en
 * amont (dessin invalide, Task 3, qui convertit en erreur de dessin) ; ici c'est un throw
 * `thermique:`, jamais une erreur de dessin retournée. Se TOUCHER sans se chevaucher reste
 * permis (et fusionné si même ref) ; la tolérance aux longueurs nulles ci-dessus est inchangée.
 *
 * @param {number} de borne basse entière (cm)
 * @param {number} a borne haute entière (cm), > de
 * @param {{de: number, a: number, ref: *}[]} recouvrements intervalles étiquetés (ref non null)
 * @returns {{de: number, a: number, ref: *}[]} morceaux ordonnés, contigus, ref non-fusionnable adjacente distincte
 */
export function decomposeIntervalle(de, a, recouvrements) {
  if (!Number.isInteger(de) || !Number.isInteger(a) || de >= a) {
    throw new Error('thermique: decomposeIntervalle : bornes [de, a] entières avec de < a requises');
  }
  if (!Array.isArray(recouvrements)) {
    throw new Error('thermique: decomposeIntervalle : recouvrements doit être un tableau');
  }
  for (const r of recouvrements) {
    if (!Number.isInteger(r.de) || !Number.isInteger(r.a) || r.de >= r.a) {
      throw new Error('thermique: decomposeIntervalle : chaque recouvrement doit avoir de < a entiers');
    }
    if (r.ref === null || r.ref === undefined) {
      throw new Error('thermique: decomposeIntervalle : ref de recouvrement non nul requis');
    }
  }

  // Tronque aux bornes [de, a] et écarte ce qui tombe entièrement hors bornes.
  const troncs = [];
  for (const r of recouvrements) {
    const rd = Math.max(r.de, de);
    const ra = Math.min(r.a, a);
    if (rd < ra) troncs.push({ de: rd, a: ra, ref: r.ref });
  }

  // Trié par début : tout chevauchement implique un chevauchement entre consécutifs
  // (si i < j se chevauchent, alors troncs[i+1].de ≤ troncs[j].de < troncs[i].a).
  troncs.sort((x, y) => x.de - y.de);
  for (let i = 1; i < troncs.length; i++) {
    const prev = troncs[i - 1], cur = troncs[i];
    if (cur.de < prev.a) {
      throw new Error(`thermique: decomposeIntervalle : recouvrements en conflit (${prev.ref} / ${cur.ref})`);
    }
  }

  // Balayage : émet les segments libres entre/autour des recouvrements, puis fusionne les
  // morceaux contigus de même ref (y compris deux recouvrements adjacents identiques).
  const bruts = [];
  let curseur = de;
  for (const t of troncs) {
    if (t.de > curseur) bruts.push({ de: curseur, a: t.de, ref: null });
    bruts.push({ de: t.de, a: t.a, ref: t.ref });
    curseur = Math.max(curseur, t.a);
  }
  if (curseur < a) bruts.push({ de: curseur, a, ref: null });

  const resultat = [];
  for (const morceau of bruts) {
    if (morceau.de >= morceau.a) continue; // longueur nulle après troncature → drop silencieux
    const dernier = resultat[resultat.length - 1];
    if (dernier && dernier.ref === morceau.ref && dernier.a === morceau.de) {
      dernier.a = morceau.a;
    } else {
      resultat.push({ ...morceau });
    }
  }
  return resultat;
}

/**
 * Décompose un polygone rectilinéaire simple en rectangles axis-alignés d'intérieurs disjoints
 * dont l'union est exactement le polygone (Σ aires = surfaceCm2). Balayage vertical sur les
 * abscisses distinctes des sommets : dans chaque bande [xi, xi+1], la couverture verticale du
 * polygone est constante (toutes les arêtes verticales tombent sur des bords de bande). Un rayon
 * vertical lancé à l'intérieur de la bande croise exactement les arêtes HORIZONTALES qui
 * enjambent toute la bande ; triées par y croissant, elles délimitent par parité les intervalles
 * couverts ([y0,y1], [y2,y3], …). Sert aussi à la superposition des niveaux (Task 5).
 * @param {{x: number, y: number}[]} poly polygone rectilinéaire VALIDE (sinon throw thermique —
 *   erreur de programmation : les appelants valident en amont via validePolygone)
 * @returns {{x1: number, y1: number, x2: number, y2: number}[]} rectangles (x1<x2, y1<y2),
 *   ordonnés par bande puis par y
 */
export function rectanglesDe(poly) {
  const problemes = validePolygone(poly);
  if (problemes.length > 0) {
    throw new Error(`thermique: rectanglesDe : polygone invalide (${problemes.join(' ; ')})`);
  }
  const xs = [...new Set(poly.map((p) => p.x))].sort((u, v) => u - v);
  const aretesH = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.y === b.y) aretesH.push({ x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), y: a.y });
  }
  const rects = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const gauche = xs[i], droite = xs[i + 1];
    const ys = aretesH.filter((e) => e.x1 <= gauche && e.x2 >= droite)
      .map((e) => e.y).sort((u, v) => u - v);
    for (let j = 0; j + 1 < ys.length; j += 2) {
      rects.push({ x1: gauche, y1: ys[j], x2: droite, y2: ys[j + 1] });
    }
  }
  return rects;
}

/**
 * Aire d'intersection (cm²) de deux polygones rectilinéaires simples : chacun est décomposé en
 * rectangles disjoints (rectanglesDe), puis somme des aires d'intersection rectangle × rectangle
 * (exacte : les rectangles issus d'un même polygone ont des intérieurs disjoints). 0 = disjoints
 * ou simple contact par un bord/coin (aire nulle). Polygones VALIDES requis (sinon throw).
 * @returns {number} aire commune en cm² (entier)
 */
export function aireIntersectionRectilineaire(polyA, polyB) {
  const rectsA = rectanglesDe(polyA);
  const rectsB = rectanglesDe(polyB);
  let aire = 0;
  for (const ra of rectsA) {
    for (const rb of rectsB) {
      const largeur = Math.min(ra.x2, rb.x2) - Math.max(ra.x1, rb.x1);
      const hauteur = Math.min(ra.y2, rb.y2) - Math.max(ra.y1, rb.y1);
      if (largeur > 0 && hauteur > 0) aire += largeur * hauteur;
    }
  }
  return aire;
}

/**
 * Adjacences des murs d'un niveau. Pour chaque pièce : décompose chaque segment de son polygone
 * (normalisé CCW) en sous-segments classés { segmentIndex, de, a, longueur, adjacent } via
 * decomposeIntervalle contre les segments colinéaires des AUTRES pièces du niveau (même axe,
 * même ordonnée constante, quel que soit leur sens de parcours). `adjacent` = id de la pièce
 * voisine, ou null = donne sur l'extérieur. `de`/`a` = coordonnée le long de l'axe du segment
 * (x pour 'h', y pour 'v'), bornes croissantes — indépendantes du sens de parcours CCW.
 *
 * Problèmes de DESSIN (jamais de throw, décision structurante n°5 — l'UI doit pouvoir afficher
 * un plan invalide en cours d'édition) → messages dans `erreurs` :
 *   - polygone invalide (validePolygone) → pièce écartée (ni calculée, ni voisine) ;
 *   - deux pièces qui se chevauchent en surface (aireIntersectionRectilineaire > 0) → les deux
 *     sont mises en quarantaine : ni calculées, NI offertes comme voisines aux pièces saines
 *     (leur géométrie n'est pas fiable et provoquerait des doubles revendications de tronçons) ;
 *   - double revendication d'un tronçon malgré tout (dessins dégénérés type aller-retour
 *     colinéaire adjacent, invisibles pour validePolygone en v1) : le throw de
 *     decomposeIntervalle est RATTRAPÉ et converti en erreur de dessin pour la pièce concernée,
 *     qui est retirée de `parPiece` ; les autres pièces restent calculées.
 * Entrées malformées (pas un tableau, id manquant/dupliqué, polygone absent) → throw thermique.
 * @param {{id: (string|number), polygone: {x: number, y: number}[]}[]} pieces pièces d'UN niveau
 * @returns {{parPiece: Map<*, {segmentIndex: number, de: number, a: number, longueur: number,
 *   adjacent: *}[]>, erreurs: string[]}}
 */
export function adjacencesNiveau(pieces) {
  if (!Array.isArray(pieces)) {
    throw new Error('thermique: adjacencesNiveau : pieces doit être un tableau');
  }
  const idsVus = new Set();
  for (const p of pieces) {
    if (!p || typeof p !== 'object' || p.id === null || p.id === undefined || p.id === '') {
      throw new Error('thermique: adjacencesNiveau : chaque pièce doit avoir un id');
    }
    if (idsVus.has(p.id)) {
      throw new Error(`thermique: adjacencesNiveau : id de pièce dupliqué (${p.id})`);
    }
    idsVus.add(p.id);
    if (!Array.isArray(p.polygone)) {
      throw new Error(`thermique: adjacencesNiveau : pièce ${p.id} sans polygone`);
    }
  }

  const erreurs = [];

  // 1. Polygones invalides → erreur de dessin, pièce écartée.
  const valides = [];
  for (const p of pieces) {
    const problemes = validePolygone(p.polygone);
    if (problemes.length > 0) {
      erreurs.push(`pièce « ${p.id} » : polygone invalide (${problemes.join(' ; ')})`);
    } else {
      valides.push({ id: p.id, polygone: p.polygone, segments: segmentsDe(normalisePolygone(p.polygone)) });
    }
  }

  // 2. Chevauchement surfacique (toutes paires) → quarantaine des deux pièces.
  const enQuarantaine = new Set();
  for (let i = 0; i < valides.length; i++) {
    for (let j = i + 1; j < valides.length; j++) {
      if (aireIntersectionRectilineaire(valides[i].polygone, valides[j].polygone) > 0) {
        erreurs.push(`pièces « ${valides[i].id} » et « ${valides[j].id} » : les polygones se chevauchent — corriger le dessin`);
        enQuarantaine.add(valides[i].id);
        enQuarantaine.add(valides[j].id);
      }
    }
  }
  const incluses = valides.filter((v) => !enQuarantaine.has(v.id));

  // 3. Décomposition mur par mur contre les segments colinéaires des autres pièces incluses.
  const parPiece = new Map();
  for (const piece of incluses) {
    try {
      const sousSegments = [];
      piece.segments.forEach((seg, segmentIndex) => {
        const constante = seg.axe === 'v' ? seg.x1 : seg.y1; // ordonnée fixe du segment
        const lo = seg.axe === 'v' ? Math.min(seg.y1, seg.y2) : Math.min(seg.x1, seg.x2);
        const hi = seg.axe === 'v' ? Math.max(seg.y1, seg.y2) : Math.max(seg.x1, seg.x2);
        const recouvrements = [];
        for (const autre of incluses) {
          if (autre.id === piece.id) continue;
          for (const t of autre.segments) {
            if (t.axe !== seg.axe) continue;
            if ((t.axe === 'v' ? t.x1 : t.y1) !== constante) continue;
            const tLo = t.axe === 'v' ? Math.min(t.y1, t.y2) : Math.min(t.x1, t.x2);
            const tHi = t.axe === 'v' ? Math.max(t.y1, t.y2) : Math.max(t.x1, t.x2);
            const de = Math.max(lo, tLo), a = Math.min(hi, tHi);
            if (de < a) recouvrements.push({ de, a, ref: autre.id });
          }
        }
        for (const m of decomposeIntervalle(lo, hi, recouvrements)) {
          sousSegments.push({ segmentIndex, de: m.de, a: m.a, longueur: m.a - m.de, adjacent: m.ref });
        }
      });
      parPiece.set(piece.id, sousSegments);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('thermique:')) throw e;
      erreurs.push(`pièce « ${piece.id} » : dessin dégénéré — un tronçon de mur est revendiqué par deux voisines à la fois`);
    }
  }

  return { parPiece, erreurs };
}

/**
 * Secteur d'orientation (N|NE|E|SE|S|SO|O|NO) de la normale extérieure d'un segment de mur
 * parcouru en CCW ; `nord` en degrés (0 = nord vers le haut du plan, sens horaire).
 *
 * Dérivation de la normale extérieure, verrouillée sur le rectangle normalisé de la Task 1
 * ((0,0),(0,300),(400,300),(400,0), CCW en repère y-bas, centroïde (200,150)) :
 *   (0,0)→(0,300)     d=(0,+1)  mur ouest → normale extérieure (−1, 0)
 *   (0,300)→(400,300) d=(+1,0)  mur sud   → normale extérieure ( 0,+1)
 *   (400,300)→(400,0) d=(0,−1)  mur est   → normale extérieure (+1, 0)
 *   (400,0)→(0,0)     d=(−1,0)  mur nord  → normale extérieure ( 0,−1)
 * Les quatre cas satisfont n = (−dy, dx) — rotation de d de +90° au sens trigonométrique du
 * repère mathématique, qui apparaît comme un quart de tour HORAIRE à l'écran (y vers le bas) ;
 * chaque n pointe bien à l'opposé du centroïde. Formule verrouillée ici.
 *
 * Cap « plan » d'un vecteur écran (vx, vy), 0 = haut de l'écran, sens horaire : atan2(vx, −vy).
 * Cap boussole = cap plan − nord. Secteurs de 45° centrés sur les caps cardinaux (N = 0°,
 * NE = 45°, …) ; une frontière exacte (22,5° + k·45°) bascule dans le secteur suivant en sens
 * horaire (arrondi demi-supérieur de Math.round).
 * @param {{x1: number, y1: number, x2: number, y2: number}} segment axis-aligné non nul
 *   (les objets de segmentsDe conviennent), entiers requis
 * @param {number} nord degrés (réel fini)
 * @returns {'N'|'NE'|'E'|'SE'|'S'|'SO'|'O'|'NO'}
 */
export function orientationDe(segment, nord) {
  if (!segment || typeof segment !== 'object'
    || ![segment.x1, segment.y1, segment.x2, segment.y2].every(Number.isInteger)) {
    throw new Error('thermique: orientationDe : segment {x1, y1, x2, y2} entier requis');
  }
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  if ((dx !== 0 && dy !== 0) || (dx === 0 && dy === 0)) {
    throw new Error('thermique: orientationDe : segment axis-aligné de longueur non nulle requis');
  }
  if (typeof nord !== 'number' || !Number.isFinite(nord)) {
    throw new Error('thermique: orientationDe : nord doit être un nombre fini (degrés)');
  }
  const nx = -Math.sign(dy); // normale extérieure n = (−dy, dx), réduite à son signe
  const ny = Math.sign(dx);
  const capPlan = (Math.atan2(nx, -ny) * 180) / Math.PI; // 0 = haut du plan, sens horaire
  const capBoussole = (((capPlan - nord) % 360) + 360) % 360;
  const SECTEURS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return SECTEURS[Math.round(capBoussole / 45) % 8];
}

/**
 * Intervalle occupé sur l'AXE du segment (bornes croissantes) par une ouverture posée à
 * `position` cm du DÉBUT du segment, comptée dans son SENS DE PARCOURS (CCW). Les sous-segments
 * d'`adjacencesNiveau` sont exprimés en coordonnées d'axe croissantes alors que `position` suit
 * le parcours : la conversion dépend donc du sens du segment. Parcours en coordonnée CROISSANTE
 * → de = min + position, a = de + largeur ; parcours DÉCROISSANT (murs est et nord d'un
 * rectangle CCW en repère y-bas) → a = max − position, de = a − largeur.
 * @param {{x1: number, y1: number, x2: number, y2: number, axe: 'h'|'v'}} segment segment
 *   orienté (les objets de segmentsDe conviennent)
 * @param {number} position distance entière (cm) depuis le début du segment, sens de parcours
 * @param {number} largeur largeur entière (cm) de l'ouverture
 * @returns {{de: number, a: number}} intervalle en coordonnée d'axe (x si 'h', y si 'v'), de < a
 */
export function intervalleAxial(segment, position, largeur) {
  if (!segment || typeof segment !== 'object' || (segment.axe !== 'h' && segment.axe !== 'v')) {
    throw new Error("thermique: intervalleAxial : segment orienté avec axe 'h'|'v' requis");
  }
  const debut = segment.axe === 'v' ? segment.y1 : segment.x1;
  const fin = segment.axe === 'v' ? segment.y2 : segment.x2;
  if (!Number.isInteger(debut) || !Number.isInteger(fin) || debut === fin) {
    throw new Error('thermique: intervalleAxial : segment entier de longueur non nulle requis');
  }
  if (!Number.isInteger(position) || !Number.isInteger(largeur)) {
    throw new Error('thermique: intervalleAxial : position et largeur entières (cm) requises');
  }
  if (fin > debut) {
    const de = debut + position;
    return { de, a: de + largeur };
  }
  const a = debut - position;
  return { de: a - largeur, a };
}

/**
 * Valide les ouvertures d'une pièce et impute leur surface au sous-segment porteur (pour le
 * calcul des surfaces nettes de murs, Task 6). Règles de DESSIN (messages dans `erreurs`,
 * jamais de throw — décision structurante n°5) :
 *   - position ≥ 0 et position + largeur ≤ longueur du segment porteur ;
 *   - hauteur > 0 et ≤ hauteurNiveau ; largeur > 0 ;
 *   - deux ouvertures du même segment ne se chevauchent pas (comparaison en coordonnées d'axe ;
 *     le simple contact bord à bord est toléré) — les deux fautives sont exclues de l'imputation
 *     (aucune double imputation) ;
 *   - une ouverture à cheval sur deux sous-segments d'adjacence différente = erreur (fenêtre
 *     moitié mur extérieur / moitié mitoyen n'a pas de sens thermique).
 * Une ouverture en erreur n'est JAMAIS imputée. Erreurs de PROGRAMMATION (throw 'thermique:') :
 * segmentIndex hors bornes, pieceId ≠ piece.id, entrées malformées, sous-segments absents pour
 * un segment porteur (incohérence avec la sortie d'adjacencesNiveau).
 * @param {{id: (string|number), polygone: {x: number, y: number}[]}} piece pièce porteuse
 *   (polygone normalisé CCW — re-normalisé ici par cohérence avec adjacencesNiveau)
 * @param {{id: *, pieceId: *, segmentIndex: number, type: string, largeur: number,
 *   hauteur: number, position: number}[]} ouvertures ouvertures de cette pièce (cm entiers ;
 *   position = distance depuis le début du segment, dans son sens de parcours)
 * @param {{segmentIndex: number, de: number, a: number, longueur: number, adjacent: *}[]}
 *   sousSegments sous-segments de la pièce (sortie adjacencesNiveau, bornes d'axe croissantes)
 * @param {number} hauteurNiveau hauteur du niveau en cm (entier > 0)
 * @returns {{erreurs: string[], surfacesOuvertures: Map<string, number>}} surfacesOuvertures :
 *   clé `${segmentIndex}:${de}:${a}` (sous-segment porteur) → cm² d'ouvertures imputées
 */
export function valideOuvertures(piece, ouvertures, sousSegments, hauteurNiveau) {
  if (!piece || typeof piece !== 'object' || piece.id === null || piece.id === undefined
    || piece.id === '' || !Array.isArray(piece.polygone)) {
    throw new Error('thermique: valideOuvertures : piece { id, polygone } requise');
  }
  if (!Array.isArray(ouvertures)) {
    throw new Error('thermique: valideOuvertures : ouvertures doit être un tableau');
  }
  if (!Array.isArray(sousSegments)) {
    throw new Error('thermique: valideOuvertures : sousSegments doit être un tableau');
  }
  if (!Number.isInteger(hauteurNiveau) || hauteurNiveau <= 0) {
    throw new Error('thermique: valideOuvertures : hauteurNiveau entier > 0 requis (cm)');
  }

  const segments = segmentsDe(normalisePolygone(piece.polygone));
  const erreurs = [];
  const etats = []; // { o, intervalle: {de, a}|null, ok } — intervalle nul si géométrie 1D inexploitable

  for (const o of ouvertures) {
    if (!o || typeof o !== 'object' || o.id === null || o.id === undefined || o.id === '') {
      throw new Error('thermique: valideOuvertures : chaque ouverture doit avoir un id');
    }
    if (o.pieceId !== piece.id) {
      throw new Error(`thermique: valideOuvertures : ouverture ${o.id} — pieceId inconnu (${o.pieceId} ≠ ${piece.id})`);
    }
    if (!Number.isInteger(o.segmentIndex) || o.segmentIndex < 0 || o.segmentIndex >= segments.length) {
      throw new Error(`thermique: valideOuvertures : ouverture ${o.id} — segmentIndex hors bornes (${o.segmentIndex})`);
    }
    if (![o.largeur, o.hauteur, o.position].every(Number.isInteger)) {
      throw new Error(`thermique: valideOuvertures : ouverture ${o.id} — largeur, hauteur et position entières (cm) requises`);
    }

    const seg = segments[o.segmentIndex];
    let ok = true;
    if (o.largeur <= 0) {
      erreurs.push(`ouverture « ${o.id} » : largeur invalide (> 0 requis)`);
      ok = false;
    }
    if (o.hauteur <= 0 || o.hauteur > hauteurNiveau) {
      erreurs.push(`ouverture « ${o.id} » : hauteur invalide (> 0 et ≤ hauteur du niveau ${hauteurNiveau} cm)`);
      ok = false;
    }
    let intervalle = null;
    if (o.position < 0 || o.position + o.largeur > seg.longueur) {
      erreurs.push(`ouverture « ${o.id} » : dépasse de son mur (position ${o.position} + largeur ${o.largeur} hors [0, ${seg.longueur}] cm)`);
      ok = false;
    } else if (o.largeur > 0) {
      intervalle = intervalleAxial(seg, o.position, o.largeur);
    }
    etats.push({ o, intervalle, ok });
  }

  // Chevauchement entre ouvertures du même segment, en coordonnées d'axe (le sens de parcours
  // est déjà résorbé par intervalleAxial). Contact bord à bord (max(de) = min(a)) toléré.
  for (let i = 0; i < etats.length; i++) {
    for (let j = i + 1; j < etats.length; j++) {
      const u = etats[i], v = etats[j];
      if (!u.intervalle || !v.intervalle || u.o.segmentIndex !== v.o.segmentIndex) continue;
      if (Math.max(u.intervalle.de, v.intervalle.de) < Math.min(u.intervalle.a, v.intervalle.a)) {
        erreurs.push(`ouvertures « ${u.o.id} » et « ${v.o.id} » : se chevauchent sur le même mur`);
        u.ok = false;
        v.ok = false;
      }
    }
  }

  // Imputation des ouvertures valides à leur sous-segment porteur. Les sous-segments contigus
  // de même adjacence étant fusionnés par decomposeIntervalle, une ouverture non contenue dans
  // UN sous-segment est nécessairement à cheval sur deux adjacences différentes.
  const surfacesOuvertures = new Map();
  for (const { o, intervalle, ok } of etats) {
    if (!ok || !intervalle) continue;
    const subs = sousSegments.filter((s) => s.segmentIndex === o.segmentIndex);
    if (subs.length === 0) {
      throw new Error(`thermique: valideOuvertures : aucun sous-segment pour le segment ${o.segmentIndex} — sousSegments incohérents avec la pièce`);
    }
    const porteur = subs.find((s) => s.de <= intervalle.de && intervalle.a <= s.a);
    if (!porteur) {
      erreurs.push(`ouverture « ${o.id} » : à cheval sur deux portions de mur d'adjacence différente (extérieur / mitoyen) — la déplacer d'un seul côté`);
      continue;
    }
    const cle = `${o.segmentIndex}:${porteur.de}:${porteur.a}`;
    surfacesOuvertures.set(cle, (surfacesOuvertures.get(cle) || 0) + o.largeur * o.hauteur);
  }

  return { erreurs, surfacesOuvertures };
}
