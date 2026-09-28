// src/lib/fumisterie/articles.js
// Résolution composant générique → article du catalogue — module PUR.
// Entrées : articles (vue majordhome_fum_articles), lignes de fum_composant_mapping, critères.
// Ordre : mapping avec finition exacte > mapping sans finition > priorité croissante.
// Pour chaque mapping :
//   1. candidats par ATTRIBUTS (type, gamme tarif, Ø, longueur, angle, pente, couleur) ;
//   2. le motif de code (`motif_code`), s'il existe, FILTRE ces candidats ;
//   3. si les attributs ne trouvent RIEN, le motif sert de repli sur tout le catalogue actif ;
//   4. il doit rester UN article. Plusieurs → `ambigus` (l'appelant émet une ligne « à chiffrer »
//      + alerte `article_ambigu`) : jamais un choix silencieux par ordre alphabétique (vécu :
//      raccord « inverse » et collier galva retenus à la place des bonnes pièces sur le vrai tarif).
//      Exception : le solin, dont les plages de pente se chevauchent → plage la plus basse.
// Rien de trouvé → article null : l'appelant crée une ligne « à chiffrer », jamais une omission.
//
// Placeholders du motif : {D} diamètre, {D-n}/{D+n} diamètre ± n (ex. raccord réduit pour tuyau
// émaillé : Ø150 → femelle 148), {LG} longueur, {A} angle, {BOI} indice de section de boisseau
// (1..6, même numérotation MODINOX pour les kits de couronnement et les plaques ventilées), {BOI4}
// la même section en 4 chiffres (références PLA « 2020 », « 3050 »), {ML} longueur entière en mètres
// d'un kit (gaine isolée vendue par kit de N ml). Valeur inconnue → `\d+`.

/**
 * Compile un motif de code en RegExp pour les critères donnés.
 * @param {string} motif
 * @param {{diametre:number, longueur?:number|null, angle?:number|null, boisseau?:number|string|null}} c
 * @returns {RegExp}
 */
export function compilerMotif(motif, c) {
  const val = (v) => (v == null || v === '' ? '\\d+' : String(v));
  const src = String(motif)
    .replace(/\{D([+-])(\d+)\}/g, (_, s, n) => (c.diametre == null ? '\\d+' : String(c.diametre + (s === '+' ? 1 : -1) * Number(n))))
    .replace(/\{D\}/g, val(c.diametre))
    .replace(/\{LG\}/g, val(c.longueur))
    .replace(/\{A\}/g, val(c.angle))
    .replace(/\{BOI\}/g, val(c.boisseau))
    .replace(/\{BOI4\}/g, val(BOISSEAU_4CHIFFRES[c.boisseau]))
    .replace(/\{ML\}/g, val(c.ml));
  return new RegExp(src);
}

/** Sections de boisseau (indice 1..6 du relevé) → 4 chiffres des références PLA (adaptateurs n°6 / n°7). */
export const BOISSEAU_4CHIFFRES = Object.freeze({ 1: '2020', 2: '2525', 3: '3030', 4: '2040', 5: '4040', 6: '3050' });

/**
 * Un motif sans `{D}` désigne un article dont le diamètre NOMINAL n'est pas celui du relevé : kit
 * d'entrée d'air (aucun placeholder), ou pièce référencée par un Ø extérieur (`{D+60}` seul :
 * support mural intermédiaire PTR, collier Polytoit, solin MFI). Le chargement et la résolution ne
 * filtrent alors pas sur le Ø ; le motif fait le tri.
 */
export function motifDependDuDiametre(motif) {
  return /\{D\}/.test(String(motif || ''));
}

/**
 * Départage final : un article → retenu ; solin (pente saisie) → plage la plus basse ; sinon ambigu.
 * @returns {{ article: object|null, ambigus: string[]|null }}
 */
function departager(liste, c) {
  if (liste.length <= 1) return { article: liste[0] || null, ambigus: null };
  let reste = liste;
  if (c.pente != null && reste.every((a) => a.pente_min != null)) {
    const min = Math.min(...reste.map((a) => a.pente_min));
    reste = reste.filter((a) => a.pente_min === min);
  }
  if (reste.length === 1) return { article: reste[0], ambigus: null };
  return { article: null, ambigus: reste.map((a) => String(a.reference)).sort() };
}

/**
 * @param {Array<object>} articles
 * @param {Array<object>} mappings
 * @param {{composant_code:string, gamme_catalogue:string, diametre:number, finition?:string|null, longueur?:number|null, angle?:number|null, pente?:number|null, type_piece?:string|null}} c
 * @returns {{ article: object|null, mapping: object|null, via: 'attributs'|'motif'|null, ambigus: string[]|null }}
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
    // Critères de la pièce (hors gamme/type) : s'appliquent aussi au repli par motif — un repli
    // qui ignorerait la pente ramènerait un solin hors plage.
    const criteresOk = (a) => a.is_active !== false && !a.sur_mesure && !a.hors_perimetre
      && (c.longueur == null || a.longueur_mm === c.longueur)
      && (c.angle == null || a.angle === c.angle)
      // Une pièce sans plage de pente (collerette PLA) n'est pas écartée par la pente : la plage ne
      // départage que les articles qui en ont une (solins inox, souches).
      && (c.pente == null || a.pente_min == null || a.pente_max == null || (c.pente >= a.pente_min && c.pente <= a.pente_max))
      && (!m.finition || a.couleur === m.finition);
    // Un mapping dont le motif ne cite pas le diamètre désigne un article indépendant du Ø (kit
    // d'entrée d'air Ø100 posé sur un conduit Ø80) : le Ø du relevé ne filtre pas les candidats.
    const parDiametre = !m.motif_code || motifDependDuDiametre(m.motif_code);
    const parAttributs = articles.filter((a) => criteresOk(a)
      && a.gamme_tarif === m.gamme_tarif && a.type_piece === type && (!parDiametre || a.diametre_int === c.diametre));
    const re = m.motif_code ? compilerMotif(m.motif_code, c) : null;
    if (parAttributs.length) {
      const filtres = re ? parAttributs.filter((a) => re.test(String(a.reference))) : parAttributs;
      if (!filtres.length) continue; // le motif écarte tout : mapping suivant (priorité)
      const { article, ambigus } = departager(filtres, c);
      return { article, mapping: m, via: article ? 'attributs' : null, ambigus };
    }
    if (re) {
      const parMotif = articles.filter((a) => criteresOk(a) && re.test(String(a.reference)));
      if (parMotif.length) {
        const { article, ambigus } = departager(parMotif, c);
        return { article, mapping: m, via: article ? 'motif' : null, ambigus };
      }
    }
  }
  return { article: null, mapping: candidats[0] || null, via: null, ambigus: null };
}
