/**
 * routeSheetExport.js — Point d'entrée unique du téléchargement d'une feuille de route
 * ============================================================================
 * Modèle (`buildRouteSheet`), branding (`buildCompanyInfo`), rendu et nommage du
 * fichier — même principe que `planningPrintExport.js`.
 * ============================================================================
 */

import { buildCompanyInfo } from '@lib/orgBranding';
import { downloadBlob } from '@lib/utils';
import { buildRouteSheet } from '@/lib/webshop/tournees';

/**
 * @param {object} p
 * @param {object} p.slot      tournée
 * @param {object} p.sector    secteur (code, label, depot, max_km)
 * @param {Array}  p.orders    commandes de la tournée
 * @param {Array}  p.items     lignes de ces commandes
 * @param {object} p.settings  settings d'org (branding)
 * @returns {Promise<number>}  nombre d'arrêts imprimés
 */
export async function telechargerFeuilleDeRoute({ slot, sector, orders, items, settings }) {
  const sheet = buildRouteSheet({ slot, sector, orders, items });
  // Import dynamique : @react-pdf/renderer ne pèse que si on imprime.
  const { generateRouteSheetPdfBlob } = await import('./RouteSheetPDF');
  const blob = await generateRouteSheetPdfBlob({ sheet, company: buildCompanyInfo(settings) });
  downloadBlob(blob, sheet.filename);
  return sheet.stops.length;
}
