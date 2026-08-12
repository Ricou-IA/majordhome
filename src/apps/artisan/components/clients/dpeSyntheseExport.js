/**
 * dpeSyntheseExport.js — Point d'entrée unique de la synthèse énergétique client
 * ============================================================================
 * Toute la chaîne (modèle, branding, rendu, nommage du fichier) vit ici : deux
 * écrans qui produiraient chacun leur PDF finiraient par diverger — même
 * principe que `rapportExport.js` côté Thermique.
 * ============================================================================
 */

import { buildCompanyInfo } from '@lib/orgBranding';
import { formatDateFR } from '@lib/utils';
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
 * Déclenche le téléchargement d'un blob.
 * NOTE : duplique volontairement `downloadBlob` de
 * `@apps/thermique/lib/rapportExport`. Importer ce module tirerait avec lui les
 * données climatiques et le chargeur de catalogue PAC dans le bundle artisan,
 * pour huit lignes d'idiome navigateur. À promouvoir dans `src/lib/utils.js`
 * lors d'un passage dédié (pas dans ce commit — cf. Posture #3).
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
