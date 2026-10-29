/**
 * deviceViewport.js — Adaptation du viewport selon la catégorie d'appareil.
 *
 * Problème : sur les petites tablettes durcies (ex. Oukitel RT3 Pro, écran 8"),
 * Android annonce une largeur logique faible (~400-850 px). L'app rend donc
 * dans cette largeur → contenu gros, mono-colonne, jamais au-dessus du
 * breakpoint `lg` (1024 px) → sensation « zoomé ».
 *
 * Solution : pour les tablettes uniquement, on force le navigateur à rendre
 * l'app dans une largeur plus grande (réécriture de <meta name="viewport">),
 * ce qui « dézoome » et fait basculer l'UI en vue bureau (sidebar + colonnes).
 *
 * Le PC (non tactile) est exclu du dézoom → affichage ordinateur strictement
 * identique. Le TÉLÉPHONE (2026-10-11) garde le viewport natif : c'est lui qui
 * déclenche les breakpoints Tailwind mobiles. Avant cette branche, un téléphone
 * était classé tablette → rendu à 38 % d'échelle, rien de tapable.
 */

/**
 * Largeur de rendu forcée sur tablette (px CSS logiques).
 * C'est LE réglage à calibrer sur la vraie tablette :
 *   - 800  → « tablette dense » : reste en mode tablette, ~2× plus de contenu
 *   - 1024 → « vue bureau » (défaut) : bascule sidebar fixe + colonnes
 *   - 1180 → « vue bureau aérée » : un peu plus dézoomé
 */
export const TABLET_VIEWPORT_WIDTH = 1024;

/**
 * Bord court maximal d'un téléphone (px CSS logiques). Les téléphones annoncent
 * 360-430 px ; les tablettes 8" peuvent descendre vers 600 mais pas sous 480.
 * Le marqueur `Mobi` de l'user-agent (présent sur Android téléphone et iPhone,
 * absent sur tablette Android et iPad) tranche avant ce seuil.
 */
export const PHONE_MAX_SHORT_EDGE = 480;

// viewport-fit=cover : les zones de sécurité iOS (encoche, barre d'accueil)
// deviennent lisibles via env(safe-area-inset-*) dans le CSS.
const DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

/**
 * Catégorie d'appareil — fonction PURE (testée dans scripts/device-viewport.test.mjs).
 *
 * @param {object} mesures
 * @param {boolean} mesures.touch - pointeur grossier ou points tactiles
 * @param {number} mesures.shortEdge - bord court de l'écran (px logiques)
 * @param {number} mesures.longEdge - bord long de l'écran (px logiques)
 * @param {string} [mesures.userAgent]
 * @returns {'desktop' | 'tablet' | 'phone'}
 */
export function classifyDevice({ touch, shortEdge, longEdge, userAgent = '' }) {
  if (!touch) return 'desktop'; // PC : jamais touché
  if (/Mobi/i.test(userAgent) || shortEdge < PHONE_MAX_SHORT_EDGE) return 'phone';
  // Grand écran tactile (grande tablette, PC tactile) : atteint déjà le mode
  // bureau tout seul → inutile de dézoomer.
  if (longEdge >= TABLET_VIEWPORT_WIDTH) return 'desktop';
  return 'tablet';
}

/** Détecte un appareil à pointeur grossier (tactile). */
function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  return Boolean(coarse) || (navigator.maxTouchPoints || 0) > 0;
}

/**
 * Dimensions logiques *stables* de l'écran physique — indépendantes de
 * l'orientation et de toute réécriture viewport déjà appliquée (donc on ne
 * lit PAS window.innerWidth, qui change après le dézoom).
 */
function getScreenEdges() {
  const w = window.screen?.width || window.innerWidth || 0;
  const h = window.screen?.height || window.innerHeight || 0;
  return { shortEdge: Math.min(w, h), longEdge: Math.max(w, h) };
}

/**
 * Catégorie de l'appareil courant, mesurée dans le navigateur.
 * @returns {'desktop' | 'tablet' | 'phone'}
 */
export function getDeviceClass() {
  if (typeof window === 'undefined') return 'desktop';
  return classifyDevice({
    touch: isTouchDevice(),
    ...getScreenEdges(),
    userAgent: navigator.userAgent || '',
  });
}

/**
 * Applique le viewport adapté à la catégorie courante. Idempotent : ne réécrit
 * la balise que si le contenu change (pas de boucle resize).
 */
function applyDeviceViewport() {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;

  const deviceClass = getDeviceClass();
  // Hook d'observabilité (inspectable dans le DOM) + cible CSS :
  // `html[data-device-class="phone"] { ... }` (index.css) et useDeviceClass().
  document.documentElement.dataset.deviceClass = deviceClass;

  // Sans `initial-scale`, le navigateur ajuste seul l'échelle pour faire tenir
  // la largeur forcée dans l'écran (re-fit automatique à chaque rotation).
  const content =
    deviceClass === 'tablet' ? `width=${TABLET_VIEWPORT_WIDTH}` : DEFAULT_VIEWPORT;

  if (meta.getAttribute('content') !== content) {
    meta.setAttribute('content', content);
  }
}

/**
 * Initialise l'adaptation viewport + ré-applique au changement d'orientation.
 * À appeler une fois au démarrage, avant le render React.
 */
export function initDeviceViewport() {
  applyDeviceViewport();
  // Ceinture + bretelles : certains navigateurs ne re-fit pas l'échelle à la
  // rotation sans réaffirmer le viewport. getDeviceClass() étant basé sur des
  // mesures stables, c'est un no-op si la catégorie n'a pas changé.
  if (typeof window !== 'undefined') {
    window.addEventListener('orientationchange', applyDeviceViewport);
  }
}
