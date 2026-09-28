// Combinaison d'éléments droits pour couvrir une longueur — module PUR, règle PROVISOIRE
// portée de la maquette (docs/devis-fumisterie/MAQUETTE_metre_svg.md §5) : n × plus long,
// puis le reste par les éléments courts, un réglable quand il tombe juste, sinon un élément de plus.

/**
 * @param {number} longueurMm longueur à couvrir
 * @param {{ longueurs: number[], reglable: {min:number,max:number}, avecReglable?: boolean }} opts
 * @returns {{ elements: Record<number, number>, reglable: {n:number, longueur:number}|null, total: number, surlongueur: number, nb: number }}
 */
export function composer(longueurMm, { longueurs, reglable, avecReglable = false }) {
  const L = Math.max(0, Math.round(longueurMm));
  const [long, moyen, court] = [...longueurs].sort((a, b) => b - a);
  const elements = Object.fromEntries(longueurs.map((l) => [l, 0]));
  let reg = null;
  if (L > 0) {
    elements[long] = Math.floor(L / long);
    const r = L - elements[long] * long;
    const dansPlage = (x) => avecReglable && x >= reglable.min && x <= reglable.max;
    if (r <= 0) { /* rien */ }
    else if (r <= court) elements[court] = 1;
    else if (dansPlage(r)) reg = { n: 1, longueur: r };
    else if (r <= moyen) elements[moyen] = 1;
    else if (r <= moyen + court) { elements[moyen] = 1; elements[court] = 1; }
    else if (dansPlage(r - moyen)) { elements[moyen] = 1; reg = { n: 1, longueur: r - moyen }; }
    else elements[long] += 1;
  }
  const total = longueurs.reduce((s, l) => s + elements[l] * l, 0) + (reg ? reg.longueur : 0);
  const nb = longueurs.reduce((s, l) => s + elements[l], 0) + (reg ? 1 : 0);
  return { elements, reglable: reg, total, surlongueur: total - L, nb };
}
