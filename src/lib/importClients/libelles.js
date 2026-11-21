// src/lib/importClients/libelles.js
// Libellés affichés de l'import de clients — module PUR (aucun import), testé par scripts/import-clients/libelles.test.mjs.

const RAISONS_RAPPROCHEMENT = {
  phone: 'même téléphone',
  email: 'même e-mail',
  name: 'même nom et prénom',
  name_cp: 'même nom dans la même commune',
  nom_affiche: 'même nom',
};

/**
 * Pourquoi une fiche existante a été rapprochée d'une ligne du fichier, en clair.
 * @param {{ matchReasons?: string[], raisonAncienNumero?: boolean } | null | undefined} doublon
 * @returns {string[]} libellés dans l'ordre des raisons, « même ancien numéro » en dernier ; raison inconnue ignorée
 */
export function libellesRapprochement(doublon) {
  const libelles = [];
  for (const r of doublon?.matchReasons || []) {
    const l = RAISONS_RAPPROCHEMENT[r];
    if (l && !libelles.includes(l)) libelles.push(l);
  }
  if (doublon?.raisonAncienNumero) libelles.push('même ancien numéro');
  return libelles;
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Phrase d'équilibre de l'aperçu, en une seule chaîne : lues = à importer + doublons écartés + écartées.
 * @param {{ lues: number, importees: number, doublons_ecartes: number, ecartees: number }} b
 * @returns {string}
 */
export function phraseBilan(b) {
  return `${pluriel(b.lues, 'ligne lue', 'lignes lues')} = ${b.importees} à importer`
    + ` + ${pluriel(b.doublons_ecartes, 'doublon écarté', 'doublons écartés')}`
    + ` + ${pluriel(b.ecartees, 'écartée', 'écartées')}`;
}

const nombreFR = (n) => Number(n).toLocaleString('fr-FR');
const MOTIF_CONSERVEES = 'a déjà un contrat, une intervention ou un e-mail envoyé';

/**
 * Texte de confirmation du retrait d'un import, construit sur l'aperçu.
 * @param {{ retirables: number, conservees: number }} apercu
 * @returns {string}
 */
export function texteRetrait({ retirables, conservees }) {
  if (retirables > 0) {
    const retrait = `${nombreFR(retirables)} ${retirables > 1 ? 'fiches seront retirées' : 'fiche sera retirée'}.`;
    if (conservees <= 0) return retrait;
    const reste = conservees > 1
      ? `${nombreFR(conservees)} seront conservées : elles ont déjà un contrat, une intervention ou un e-mail envoyé.`
      : `1 sera conservée : elle ${MOTIF_CONSERVEES}.`;
    return `${retrait} ${reste}`;
  }
  if (conservees > 0) {
    return conservees > 1
      ? `Aucune fiche ne peut être retirée : les ${nombreFR(conservees)} fiches de cet import ont déjà un contrat, une intervention ou un e-mail envoyé.`
      : `Aucune fiche ne peut être retirée : la fiche de cet import ${MOTIF_CONSERVEES}.`;
  }
  return 'Cet import ne contient plus aucune fiche.';
}

/**
 * Texte du toast après un retrait.
 * @param {{ retirees: number, conservees: number }} totaux
 * @returns {string}
 */
export function texteRetraitFait({ retirees, conservees }) {
  const retire = retirees > 0
    ? `${nombreFR(retirees)} ${retirees > 1 ? 'fiches retirées' : 'fiche retirée'}`
    : 'Aucune fiche retirée';
  if (conservees <= 0) return retire;
  return `${retire}, ${nombreFR(conservees)} ${conservees > 1 ? 'conservées' : 'conservée'}`;
}
