/**
 * feuilleDeRouteExport.js — Point d'entrée unique de l'impression d'une feuille de route
 * ============================================================================
 * Le modèle vient de `useFeuilleDeRoute` (le même que l'écran) ; ici seulement
 * le branding, la carte, le rendu et le téléchargement — même principe que
 * `planningPrintExport.js`. Une carte indisponible n'empêche pas l'impression.
 * ============================================================================
 */

import { buildCompanyInfo } from '@lib/orgBranding';
import { downloadBlob } from '@lib/utils';
import { logger } from '@lib/logger';

/** Image distante → data URL (react-pdf n'a pas à refaire l'appel ; un échec = pas de carte). */
async function chargerCarte(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    logger.warn('[feuilleDeRoute] carte indisponible, impression sans carte', err);
    return null;
  }
}

/**
 * @param {object} p
 * @param {object} p.feuille   modèle `buildFeuilleDeRoute` (via useFeuilleDeRoute)
 * @param {string|null} p.carteUrl  carte statique Mapbox
 * @param {object} p.settings  settings d'org (branding)
 */
export async function telechargerFeuilleDeRoute({ feuille, carteUrl, settings }) {
  const carte = await chargerCarte(carteUrl);
  // Import dynamique : @react-pdf/renderer ne pèse que si on imprime.
  const { generateFeuilleDeRoutePdfBlob } = await import('./FeuilleDeRoutePDF');
  const blob = await generateFeuilleDeRoutePdfBlob({ model: feuille, company: buildCompanyInfo(settings), carte });
  downloadBlob(blob, feuille.filename);
}
