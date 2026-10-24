// scripts/catalogue/pdf-lignes.js
// Reconstitution des lignes d'un PDF à partir de ses mots positionnés (sortie de scripts/catalogue/pdf-mots.py :
// { x0, y0, x1, y1, t } par mot). Les parseurs de factures fournisseur (facture-soditelem.js, facture-tereva.js)
// lisent ensuite les colonnes par position horizontale. Module PUR, sans règle métier.

/**
 * Regroupe les mots d'une page en lignes (même ligne de base à `toleranceY` près), triées de haut en bas,
 * mots triés de gauche à droite. Un caractère isolé dont l'avance (écart entre abscisses de départ) sur le
 * caractère précédent est inférieure à `gapLettres` lui est recollé (polices à lettres espacées : Tereva écrit
 * « P O M P E » en un mot par lettre, avance ≈ 6 pt, espace ≈ 12 pt) ; deux mots « normaux » (plusieurs
 * caractères) ne sont jamais recollés.
 * @param {Array<{x0:number,y0:number,x1:number,y1:number,t:string}>} mots
 * @param {{ toleranceY?: number, gapLettres?: number }} [opts]
 * @returns {Array<{ y: number, tokens: Array<{ x0:number, x1:number, t:string }> }>}
 */
export function lignesDepuisMots(mots, { toleranceY = 3.2, gapLettres = 0 } = {}) {
  const tries = [...mots].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lignes = [];
  for (const m of tries) {
    const derniere = lignes[lignes.length - 1];
    if (derniere && Math.abs(m.y0 - derniere.y) <= toleranceY) derniere.mots.push(m);
    else lignes.push({ y: m.y0, mots: [m] });
  }
  return lignes.map((l) => {
    const mots = l.mots.sort((a, b) => a.x0 - b.x0);
    const tokens = [];
    for (const m of mots) {
      const prev = tokens[tokens.length - 1];
      const isole = m.t.length === 1;
      if (prev && gapLettres > 0 && prev.lettres && isole && m.x0 - prev.dernierX0 < gapLettres) {
        prev.t += m.t;
        prev.x1 = m.x1;
        prev.dernierX0 = m.x0;
      } else {
        tokens.push({ x0: m.x0, x1: m.x1, t: m.t, lettres: isole, dernierX0: m.x0 });
      }
    }
    return { y: l.y, tokens: tokens.map(({ x0, x1, t }) => ({ x0, x1, t })) };
  });
}

/** Nombre au format français (« 1.102,90 », « 9,33 », « 50,00 ») → 1102.9 ; null si ce n'est pas un nombre. */
export function nombreFR(s) {
  if (typeof s !== 'string' || !/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(s.trim())) return null;
  return Number(s.trim().replace(/\./g, '').replace(',', '.'));
}

/** Nombre au format anglo-saxon (« 1058.2000 », « 16.00 ») → 1058.2 ; null si ce n'est pas un nombre. */
export function nombreEN(s) {
  if (typeof s !== 'string' || !/^-?\d+(\.\d+)?$/.test(s.trim())) return null;
  return Number(s.trim());
}

/** Arrondi monétaire au centime (évite 0.1 + 0.2). */
export function centimes(n) {
  return Math.round(n * 100) / 100;
}

/** « 31/08/26 » ou « 31/07/2026 » → « 2026-08-31 » ; null si invalide. */
export function dateFR(s) {
  const m = typeof s === 'string' && s.trim().match(/^(\d{1,2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const annee = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${annee}-${m[2]}-${m[1].padStart(2, '0')}`;
}
