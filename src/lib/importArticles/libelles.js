// src/lib/importArticles/libelles.js
// Libellés affichés de l'import d'articles — module PUR (imports relatifs seulement), testé par
// scripts/import-articles/libelles.test.mjs.

import { champArticle } from './champs.js';

const nombreFR = (n) => Number(n).toLocaleString('fr-FR');
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Phrase d'équilibre de l'aperçu, en une seule chaîne : lues = à importer + doublons écartés + écartées.
 * @param {{ lues: number, importees: number, doublons: number, ecartees: number }} b bilan de `controles.bilan`
 * @returns {string}
 */
export function phraseBilanArticles(b) {
  return `${pluriel(b.lues, 'ligne lue', 'lignes lues')} = ${b.importees} à importer`
    + ` + ${pluriel(b.doublons, 'doublon écarté', 'doublons écartés')}`
    + ` + ${pluriel(b.ecartees, 'écartée', 'écartées')}`;
}

const USAGES = '(devis, ligne fournisseur…)';

/**
 * Texte de confirmation du retrait d'un import, construit sur l'aperçu.
 * @param {{ retirables: number, conservees: number }} apercu
 * @returns {string}
 */
export function texteRetraitArticles({ retirables, conservees }) {
  if (retirables > 0) {
    const retrait = `${nombreFR(retirables)} ${retirables > 1 ? 'articles seront retirés' : 'article sera retiré'}.`;
    if (conservees <= 0) return retrait;
    const reste = conservees > 1
      ? `${nombreFR(conservees)} seront conservés : ils sont déjà utilisés ailleurs ${USAGES}.`
      : `1 sera conservé : il est déjà utilisé ailleurs ${USAGES}.`;
    return `${retrait} ${reste}`;
  }
  if (conservees > 0) {
    return conservees > 1
      ? `Aucun article ne peut être retiré : les ${nombreFR(conservees)} articles de cet import sont déjà utilisés ailleurs ${USAGES}.`
      : `Aucun article ne peut être retiré : l'article de cet import est déjà utilisé ailleurs ${USAGES}.`;
  }
  return 'Cet import ne contient aucun article. Le retirer de la liste ?';
}

/**
 * Bloc de l'aperçu sur les valeurs illisibles des lignes qui seront importées.
 * @param {Array<{ cle: string, nombre: number }>} resume `cle` = clé d'un champ du catalogue
 * @returns {string | null} null quand il n'y a rien à signaler
 */
export function texteCorrectionsArticles(resume) {
  if (!resume || resume.length === 0) return null;
  const liste = resume.map((r) => `${nombreFR(r.nombre)} × ${champArticle(r.cle)?.libelle || r.cle}`).join(', ');
  return `Valeurs illisibles : ${liste}. Elles sont remplacées par la valeur par défaut (ou laissées vides), l'article est importé quand même.`;
}

/**
 * Ligne de l'aperçu sur les prix d'achat importés sans date.
 * @param {number} nSansDate prix d'achat importés sans date
 * @returns {string | null} null quand tous ont une date
 */
export function texteDateDuPrix(nSansDate) {
  if (!(nSansDate > 0)) return null;
  return nSansDate > 1
    ? `${nombreFR(nSansDate)} prix d'achat sans date : ils seront affichés « date inconnue » et remplacés au premier relevé de leur fournisseur.`
    : "1 prix d'achat sans date : il sera affiché « date inconnue » et remplacé au premier relevé de son fournisseur.";
}
