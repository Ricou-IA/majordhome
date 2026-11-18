// Copie du lien du PV dans le presse-papiers (fenêtre de préparation, suite des réserves).
// Un refus du navigateur n'est pas un échec de l'action : le serveur a déjà rendu le lien et
// noté ce qu'il fallait ; l'écran montre alors le lien à copier à la main (`LienACopier`).

/**
 * @param {string} url
 * @returns {Promise<boolean>} faux si le navigateur a refusé (permission, contexte non sécurisé)
 */
export async function copierDansPressePapiers(url) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export const MESSAGE_COPIE_ECHOUEE = 'Le lien n\'a pas pu être copié automatiquement : copiez-le à la main ci-dessous.';
