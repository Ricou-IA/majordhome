/**
 * programmesExport.js — point d'entrée unique de l'export PDF des programmes du chantier Gaillac.
 * Même principe que `planningPrintExport.js` : modèle pur, branding, rendu, nom du fichier, ici.
 */
import { buildCompanyInfo } from '@lib/orgBranding';
import { downloadBlob } from '@lib/utils';
import { buildProgrammesModel } from './lib/chantierGaillacModel';

/**
 * Construit les programmes (une page par journée datée, selon les filtres) et déclenche le téléchargement.
 * @returns {Promise<number>} nombre de pages produites (0 = rien téléchargé)
 */
export async function telechargerProgrammes({ taches, planning, techniciens, techId, planningCode, settings }) {
  const model = buildProgrammesModel({ taches, planning, techniciens, techId, planningCode, editedAt: new Date() });
  if (!model.pages.length) return 0;

  // Import dynamique : @react-pdf/renderer ne pèse dans le bundle que si un export est demandé.
  const { generateProgrammesPdfBlob } = await import('./components/ProgrammesPDF');
  const blob = await generateProgrammesPdfBlob({ model, company: buildCompanyInfo(settings) });
  downloadBlob(blob, model.filename);
  return model.pages.length;
}
