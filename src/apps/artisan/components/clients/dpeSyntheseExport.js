/**
 * dpeSyntheseExport.js — Point d'entrée unique de la synthèse énergétique client
 * ============================================================================
 * Toute la chaîne (modèle, branding, rendu, nommage du fichier) vit ici : deux
 * écrans qui produiraient chacun leur PDF finiraient par diverger — même
 * principe que `rapportExport.js` côté Thermique.
 * ============================================================================
 */

import { buildCompanyInfo } from '@lib/orgBranding';
import { formatDateFR, downloadBlob } from '@lib/utils';
import { buildDpeReportModel } from '@/lib/dpeReportModel';

/**
 * `bilan-energetique-<slug>-<AAAA-MM-JJ>.pdf` — accents et ponctuation
 * strippés (nom de fichier portable Windows/macOS). `date` est injectée par le
 * caller : testable, pas d'horloge implicite.
 */
export function buildSyntheseFilename(nom, date = new Date()) {
  const slug = (nom || 'logement')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'logement';
  return `bilan-energetique-${slug}-${date.toISOString().slice(0, 10)}.pdf`;
}

/**
 * Construit la synthèse et déclenche le téléchargement.
 *
 * @param {object} record   enregistrement DPE choisi (mapDpeRecord)
 * @param {object} client   fiche client
 * @param {object} settings settings d'org (branding via buildCompanyInfo)
 */
export async function telechargerSyntheseDpe({ record, client, settings }) {
  const model = buildDpeReportModel(record, client, { dateLabel: formatDateFR(new Date()) });

  // Import dynamique : @react-pdf/renderer ne pèse dans le bundle que si une
  // synthèse est réellement demandée.
  const { generateDpeSynthesePdfBlob } = await import('./DpeSynthesePDF');
  const blob = await generateDpeSynthesePdfBlob({ model, company: buildCompanyInfo(settings) });

  downloadBlob(blob, buildSyntheseFilename(model.client.nom));
}
