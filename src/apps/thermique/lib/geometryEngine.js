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
