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
