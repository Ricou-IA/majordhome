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
