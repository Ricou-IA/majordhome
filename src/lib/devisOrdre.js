// src/lib/devisOrdre.js
// Réordonner un devis par glisser-déposer — module PUR (aucun import), testé (scripts/devis-ordre.test.mjs).
// Le devis est une liste PLATE (titre de chapitre suivi de ses lignes) : on la découpe en blocs, on déplace, on
// ré-aplatit. Demande d'Eric (2026-10-25) : déplacer les chapitres et les lignes à la souris plutôt qu'avec + / −.

/**
 * Découpe en blocs : { titre, lignes }. Les lignes avant le premier chapitre forment un bloc sans titre (titre null).
 * @param {Array<{ line_type: string }>} lines
 * @returns {Array<{ titre: object | null, lignes: object[] }>}
 */
export function blocs(lines) {
  const out = [];
  for (const l of lines || []) {
    if (l.line_type === 'section_title') { out.push({ titre: l, lignes: [] }); continue; }
    if (!out.length) out.push({ titre: null, lignes: [] });
    out[out.length - 1].lignes.push(l);
  }
  return out;
}

/**
 * Liste plate depuis des blocs.
 * @param {Array<{ titre: object | null, lignes: object[] }>} bs
 * @returns {object[]}
 */
export function aplatir(bs) {
  return bs.flatMap((b) => (b.titre ? [b.titre, ...b.lignes] : b.lignes));
}

/**
 * Déplace une ligne. Les index de bloc comptent le bloc sans titre s'il existe (blocs(lines)).
 * Hors bornes ⇒ liste inchangée.
 * @param {object[]} lines
 * @param {{ deBloc: number, deRang: number, versBloc: number, versRang: number }} p
 * @returns {object[]}
 */
export function deplacerLigne(lines, { deBloc, deRang, versBloc, versRang }) {
  const bs = blocs(lines).map((b) => ({ titre: b.titre, lignes: [...b.lignes] }));
  const src = bs[deBloc];
  const dst = bs[versBloc];
  if (!src || !dst || deRang < 0 || deRang >= src.lignes.length) return [...lines];
  const [ligne] = src.lignes.splice(deRang, 1);
  dst.lignes.splice(Math.max(0, Math.min(versRang, dst.lignes.length)), 0, ligne);
  return aplatir(bs);
}

/**
 * Déplace un chapitre avec ses lignes. Les rangs ne comptent que les chapitres TITRÉS ; le bloc sans titre reste en
 * tête. Hors bornes ⇒ liste inchangée.
 * @param {object[]} lines
 * @param {number} de
 * @param {number} vers
 * @returns {object[]}
 */
export function deplacerChapitre(lines, de, vers) {
  const bs = blocs(lines);
  const tete = bs.length && !bs[0].titre ? [bs[0]] : [];
  const chapitres = bs.slice(tete.length);
  if (de < 0 || de >= chapitres.length || vers < 0 || vers >= chapitres.length) return [...lines];
  const [c] = chapitres.splice(de, 1);
  chapitres.splice(vers, 0, c);
  return aplatir([...tete, ...chapitres]);
}

// Chapitres acceptables, dans l'ordre, pour les lignes d'un chapitre d'un type donné quand on change d'installation.
const SECOURS_TYPE = Object.freeze({
  equipement: ['equipement', 'libre', 'option'],
  option: ['option', 'libre', 'equipement'],
  stock: ['stock', 'option', 'libre'],
  main_oeuvre: ['main_oeuvre', 'libre'],
  libre: ['libre', 'option', 'equipement'],
  fumisterie: ['fumisterie', 'libre', 'option'],
});

/**
 * Changer d'installation SANS perdre de ligne (retour d'Eric 2026-10-25 : après un import d'offre, l'installation ne
 * se changeait plus — la confirmation supprimait tout). Les chapitres de la nouvelle installation remplacent les
 * anciens ; les lignes de chaque ancien chapitre vont dans le chapitre de même titre, sinon le premier du même type
 * (puis d'un type de secours), dans leur ordre. Un ancien chapitre sans place est gardé tel quel en fin de devis ;
 * un ancien chapitre vide disparaît ; les lignes avant le premier chapitre restent en tête.
 * @param {object[]} lines devis actuel (liste plate)
 * @param {object[]} sections titres de chapitre de la nouvelle installation (line_type 'section_title')
 * @param {{ typeAvant: (titre: string) => string, typeApres: (titre: string) => string }} types
 * @returns {object[]}
 */
export function reclasserDansSections(lines, sections, { typeAvant, typeApres }) {
  const anciens = blocs(lines);
  const tete = anciens.length && !anciens[0].titre ? anciens[0].lignes : [];
  const cle = (t) => String(t ?? '').trim().toLowerCase();
  const nouveaux = (sections || []).map((t) => ({ titre: t, type: typeApres(t.designation), lignes: [] }));
  const gardes = [];
  for (const b of anciens) {
    if (!b.titre || !b.lignes.length) continue;
    let cible = nouveaux.find((n) => cle(n.titre.designation) === cle(b.titre.designation)) || null;
    const type = typeAvant(b.titre.designation);
    for (const t of SECOURS_TYPE[type] || [type]) {
      if (cible) break;
      cible = nouveaux.find((n) => n.type === t) || null;
    }
    if (cible) cible.lignes.push(...b.lignes);
    else gardes.push(b);
  }
  return [...tete, ...aplatir(nouveaux), ...aplatir(gardes)];
}
