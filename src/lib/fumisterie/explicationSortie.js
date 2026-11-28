// src/lib/fumisterie/explicationSortie.js
// Ce que dit l'écran sous « Ajuster la sortie » (module PUR, aucun calcul nouveau : lecture de la géométrie).
// Recette du 2026-11-28 : « Minimum réglementaire calculé : 1,52 m », le bouton écrivait 1,35 m et la coupe
// affichait 1,94 m, sans un mot d'explication. En G1 la surlongueur du conduit intérieur (éléments entiers)
// remonte déjà la sortie ; le bouton la retire puis arrondit aux 5 cm au-dessus (hauteurSortieMinimale).

const GABARITS_SORTIE = { G1: 'toit', G3: 'gouttiere', G3P: 'gouttiere' };
const fini = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {string} gabaritCode
 * @param {any} geometrie résultat de geometrieG1 / geometrieG3
 * @param {number|null} valeurAppliquee ce que « Ajuster » écrit (sortieMinimale)
 * @param {number} hSortieSaisie hauteur de sortie du relevé
 * @returns {{ repere: 'toit'|'gouttiere', minReglementaire: number, dejaCouvert: number, aViser: number|null,
 *   hauteurReelle: number, elementsStandard: number, saisie: number } | null} null : gabarit sans sortie (tubage, ventouse)
 */
export function explicationSortie(gabaritCode, geometrie, valeurAppliquee, hSortieSaisie) {
  const repere = GABARITS_SORTIE[gabaritCode];
  if (!repere || !geometrie || !fini(geometrie.minSortie) || !fini(geometrie.hAct) || !fini(hSortieSaisie)) return null;
  const t = geometrie.troncons || {};
  const dejaCouvert = repere === 'toit' ? (t.conduit_interieur?.composition?.surlongueur ?? 0) / 1000 : 0;
  const elementsStandard = repere === 'toit'
    ? (t.sortie_toit?.composition?.total ?? hSortieSaisie * 1000) / 1000 - hSortieSaisie
    : (t.facade?.composition?.surlongueur ?? 0) / 1000;
  return { repere, minReglementaire: geometrie.minSortie, dejaCouvert, aViser: fini(valeurAppliquee) ? valeurAppliquee : null,
    hauteurReelle: geometrie.hAct, elementsStandard, saisie: hSortieSaisie };
}

const m = (v) => `${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')} m`;

/**
 * Les deux phrases de l'écran et le libellé du bouton.
 * @param {ReturnType<typeof explicationSortie>} e
 * @returns {{ bouton: string, aViser: string|null, hauteur: string }}
 */
export function textesSortie(e) {
  const ou = e.repere === 'toit' ? 'au-dessus du toit' : 'au-dessus de la gouttière';
  const aViser = e.aViser == null ? null
    : e.dejaCouvert >= 0.005
      ? `À viser : ${m(e.aViser)}. Hauteur réglementaire ${m(e.minReglementaire)}, moins ${m(e.dejaCouvert)} déjà gagnés par le conduit intérieur, arrondie aux 5 cm au-dessus.`
      : `À viser : ${m(e.aViser)}. Hauteur réglementaire ${m(e.minReglementaire)} ${ou}, arrondie aux 5 cm au-dessus.`;
  const parts = [`${m(e.saisie)} saisis`];
  if (e.elementsStandard >= 0.005) parts.push(`${m(e.elementsStandard)} d’éléments standard`);
  if (e.dejaCouvert >= 0.005) parts.push(`${m(e.dejaCouvert)} de conduit intérieur`);
  const hauteur = parts.length > 1 ? `Hauteur réelle ${ou} : ${m(e.hauteurReelle)} (${parts.join(' + ')}).` : `Hauteur réelle ${ou} : ${m(e.hauteurReelle)}.`;
  return { bouton: e.aViser == null ? 'Ajuster la sortie au minimum' : `Mettre à ${m(e.aViser)}`, aViser, hauteur };
}
