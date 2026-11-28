// ops/aspirateur/journal.mjs — journal du service : tout texte est passé par masquerSecrets avant d'être écrit.
// Les secrets d'un travail (identifiant, mot de passe, numéro de compte client) ne doivent jamais apparaître dans un
// journal, une recette, une réponse ou un texte envoyé au modèle.

/**
 * Remplace chaque secret (3 caractères au moins), sans casse, par « *** ».
 * @param {unknown} texte
 * @param {Array<string | null | undefined>} secrets
 * @returns {string}
 */
export function masquerSecrets(texte, secrets) {
  let s = String(texte ?? '');
  for (const secret of secrets || []) {
    if (typeof secret !== 'string' || secret.trim().length < 3) continue;
    const motif = secret.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(motif, 'gi'), '***');
  }
  return s;
}

/**
 * @param {Array<string | null | undefined>} secrets
 * @param {{ log: (...a: unknown[]) => void, error: (...a: unknown[]) => void }} [sortie]
 */
export function creerJournal(secrets, sortie = console) {
  const ligne = (/** @type {string} */ msg, /** @type {unknown} */ donnees) =>
    masquerSecrets(donnees === undefined ? msg : `${msg} ${JSON.stringify(donnees)}`, secrets);
  return {
    info: (/** @type {string} */ msg, /** @type {unknown} */ donnees) => sortie.log(`[aspirateur] ${ligne(msg, donnees)}`),
    erreur: (/** @type {string} */ msg, /** @type {unknown} */ donnees) => sortie.error(`[aspirateur] ${ligne(msg, donnees)}`),
  };
}
