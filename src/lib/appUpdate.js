/**
 * appUpdate.js — suivi de mise à jour de l'application (PWA)
 * ============================================================================
 * Le service worker (vite-plugin-pwa, autoUpdate : skipWaiting + clientsClaim)
 * installe seul la nouvelle version, mais la PAGE déjà ouverte garde l'ancien
 * code — et le navigateur ne cherche une nouvelle version qu'à un vrai
 * chargement de page. Sur un téléphone, rouvrir l'application reprend la page
 * sans la recharger : on restait sur l'ancienne version sans moyen simple de
 * rafraîchir (Eric, 2026-11-14).
 *
 * Ce module ne fait que deux choses, sans rien recharger lui-même :
 *   - `verifier()` demande au navigateur de chercher une nouvelle version
 *     (au plus une fois par intervalle) ;
 *   - il signale (`onPrete`) le moment où la nouvelle version a pris la main.
 * Le rechargement reste un geste de l'écran (bouton, changement de page) :
 * jamais en pleine saisie. Cf. src/components/AppUpdateWatcher.jsx.
 *
 * Aucune dépendance au DOM : `serviceWorker` est injecté (testé avec un faux).
 * Test : node --test scripts/app-update.test.mjs
 * ============================================================================
 */

/** Écart minimal entre deux recherches de version. */
export const INTERVALLE_VERIFICATION_MS = 10 * 60 * 1000;

/**
 * @param {object} p
 * @param {{ controller: unknown, addEventListener: Function, removeEventListener: Function, getRegistration: () => Promise<{ update: () => Promise<unknown> }|undefined> }} p.serviceWorker  `navigator.serviceWorker`
 * @param {() => number} [p.maintenant]  horloge (ms)
 * @param {number} [p.intervalleMs]
 * @param {() => void} [p.onPrete]  appelé une fois, quand une nouvelle version a pris la main
 * @returns {{ verifier: () => Promise<void>, prete: () => boolean, arreter: () => void }}
 */
export function creerSuiviMiseAJour({
  serviceWorker, maintenant = Date.now, intervalleMs = INTERVALLE_VERIFICATION_MS, onPrete = () => {},
}) {
  // Page sans contrôleur = première installation : la prise de contrôle qui suit
  // n'est pas une mise à jour (le code affiché est déjà celui du serveur).
  let controlee = !!serviceWorker.controller;
  let prete = false;
  let derniereVerification = null;

  const surChangement = () => {
    if (!controlee) {
      controlee = true;
      return;
    }
    if (prete) return;
    prete = true;
    onPrete();
  };
  serviceWorker.addEventListener('controllerchange', surChangement);

  return {
    async verifier() {
      const t = maintenant();
      if (derniereVerification !== null && t - derniereVerification < intervalleMs) return;
      derniereVerification = t;
      try {
        const registration = await serviceWorker.getRegistration();
        await registration?.update();
      } catch {
        // Hors ligne ou serveur injoignable : on réessaiera au prochain intervalle.
      }
    },
    prete: () => prete,
    arreter: () => serviceWorker.removeEventListener('controllerchange', surChangement),
  };
}
