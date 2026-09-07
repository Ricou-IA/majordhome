/**
 * planningPrintExport.js — Point d'entrée unique de l'impression du planning hebdo
 * ============================================================================
 * Toute la chaîne (modèle, branding, rendu, nommage du fichier) vit ici — même
 * principe que `dpeSyntheseExport.js` et `rapportExport.js` : un 2ᵉ écran qui
 * voudrait imprimer un planning passe par cette fonction, pas par sa propre chaîne.
 * ============================================================================
 */

import { buildCompanyInfo } from '@lib/orgBranding';
import { downloadBlob } from '@lib/utils';
import { buildWeeklyPlanningModel } from '@/lib/planningPrintModel';
import { APPOINTMENT_TYPES } from '@services/appointments.service';

const TYPE_LABELS = Object.fromEntries(APPOINTMENT_TYPES.map((t) => [t.value, t.label]));

/**
 * Construit le planning de la semaine d'une personne et déclenche le téléchargement.
 *
 * @param {object} p
 * @param {Array}  p.appointments             lignes RDV (extendedProps du calendrier, déjà filtrées sur la personne)
 * @param {object} p.person                   entrée de `teamList` ({ displayName, color })
 * @param {string} p.weekStart                lundi 'YYYY-MM-DD'
 * @param {Map}    p.equipmentLabelsByClient  client_id → libellés d'équipement
 * @param {object} p.settings                 settings d'org (branding via buildCompanyInfo)
 */
export async function telechargerPlanningHebdo({ appointments, person, weekStart, equipmentLabelsByClient, settings }) {
  const model = buildWeeklyPlanningModel({
    appointments, person, weekStart, equipmentLabelsByClient, typeLabels: TYPE_LABELS,
  });

  // Import dynamique : @react-pdf/renderer ne pèse dans le bundle que si une
  // impression est réellement demandée.
  const { generatePlanningWeekPdfBlob } = await import('./PlanningWeekPDF');
  const blob = await generatePlanningWeekPdfBlob({ model, company: buildCompanyInfo(settings) });

  downloadBlob(blob, model.filename);
}
