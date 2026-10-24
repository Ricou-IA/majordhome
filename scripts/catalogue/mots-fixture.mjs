// scripts/catalogue/mots-fixture.mjs — fabrique de « mots positionnés » (forme de scripts/catalogue/pdf-mots.py)
// pour les tests des parseurs de factures. Une page = { num, words:[{x0,y0,x1,y1,t}] }.

/** Mots « normaux » d'une ligne : chaque texte à l'abscisse donnée, largeur ≈ 5 pt par caractère. */
export function ligne(y, ...elements) {
  return elements.map(([x, t]) => ({ x0: x, y0: y, x1: x + t.length * 5, y1: y + 8, t }));
}

/** Même chose en lettres espacées (corps DocuWare de TEREVA) : un mot par caractère, pas de 5,9 pt, espace = 11,8 pt. */
export function ligneEspacee(y, ...elements) {
  const mots = [];
  for (const [x, t] of elements) {
    let cx = x;
    for (const c of t) {
      if (c === ' ') { cx += 11.8; continue; }
      mots.push({ x0: cx, y0: y, x1: cx + 4.5, y1: y + 8, t: c });
      cx += 5.9;
    }
  }
  return mots;
}

export function page(num, ...lignes) {
  return { num, width: 595, height: 842, words: lignes.flat() };
}
