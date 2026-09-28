// src/lib/fumisterie/articles.js
// Résolution composant générique → article du catalogue — module PUR.
// Entrées : articles (vue majordhome_fum_articles), lignes de fum_composant_mapping, critères.
// Ordre : mapping avec finition exacte > mapping sans finition ; attributs (type, gamme tarif, Ø,
// longueur, angle, pente) ; à défaut, motif de code ({D} = diamètre). null si rien : l'appelant
// crée une ligne « à chiffrer », jamais une omission silencieuse.

/**
 * @param {Array<object>} articles
 * @param {Array<object>} mappings
 * @param {{composant_code:string, gamme_catalogue:string, diametre:number, finition?:string|null, longueur?:number|null, angle?:number|null, pente?:number|null, type_piece?:string|null}} c
 * @returns {{ article: object|null, mapping: object|null, via: 'attributs'|'motif'|null }}
 */
export function resoudreArticle(articles, mappings, c) {
  const candidats = mappings
    .filter((m) => m.composant_code === c.composant_code && m.gamme_catalogue === c.gamme_catalogue)
    .filter((m) => !m.finition || m.finition === c.finition)
    .sort((a, b) => (b.finition ? 1 : 0) - (a.finition ? 1 : 0) || (a.priorite ?? 100) - (b.priorite ?? 100));
  for (const m of candidats) {
    const type = c.type_piece || m.type_piece;
    // Un article sans couleur détectée ne peut pas satisfaire un mapping à finition : accepter
    // `a.couleur == null` ici ouvrirait un fail-open dès que de vraies lignes catalogue sans
    // couleur renseignée arrivent (l'article surgirait sous la mauvaise finition). Sans couleur
    // exacte, l'article est rejeté et la ligne sort « à chiffrer », jamais un mauvais article.
    const parAttributs = articles.filter((a) => a.is_active !== false && !a.sur_mesure && !a.hors_perimetre
      && a.gamme_tarif === m.gamme_tarif && a.type_piece === type && a.diametre_int === c.diametre
      && (c.longueur == null || a.longueur_mm === c.longueur)
      && (c.angle == null || a.angle === c.angle)
      && (c.pente == null || (a.pente_min != null && a.pente_max != null && c.pente >= a.pente_min && c.pente <= a.pente_max))
      && (!m.finition || a.couleur === m.finition));
    // Solin : quand la pente saisie chevauche deux plages, la plage la plus basse (pente_min la
    // plus petite) est retenue — même règle que le `find` de la maquette.
    if (parAttributs.length) {
      parAttributs.sort((a, b) => (a.pente_min ?? 0) - (b.pente_min ?? 0) || String(a.reference).localeCompare(String(b.reference)));
      return { article: parAttributs[0], mapping: m, via: 'attributs' };
    }
    if (m.motif_code) {
      const re = new RegExp(m.motif_code.replace('{D}', String(c.diametre)).replace('{LG}', String(c.longueur ?? '')));
      const parMotif = articles.find((a) => a.is_active !== false && re.test(String(a.reference)));
      if (parMotif) return { article: parMotif, mapping: m, via: 'motif' };
    }
  }
  return { article: null, mapping: candidats[0] || null, via: null };
}
