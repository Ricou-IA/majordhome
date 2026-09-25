// src/apps/maintenance/lib/registreExport.js
// Registre de maintenance PDF — POINT D'ENTRÉE UNIQUE (mise en forme, rendu, nom de fichier).
// Le modèle (registreModel.js, pur et testé) ne recalcule rien ; le rendu react-pdf est
// chargé à la demande pour ne pas alourdir la page.
import { buildCompanyInfo } from '@lib/orgBranding';
import { downloadBlob } from '@lib/utils';
import { construireRegistre } from '@/lib/maintenance/registreModel';

const GENERE_LE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * @param {object} p
 * @param {object} p.settings core.organizations.settings (branding)
 * @param {Array} p.units @param {Array} p.tasks @param {Array} p.operators
 * @param {Array} p.logs réalisations DÉJÀ filtrées (période, unité…)
 * @param {string} p.du 'YYYY-MM-DD' @param {string} p.au 'YYYY-MM-DD'
 */
export async function telechargerRegistre({ settings, units, tasks, operators, logs, du, au }) {
  const registre = construireRegistre({ units, tasks, logs, operators, du, au });
  const company = buildCompanyInfo(settings);
  const { generateRegistrePdfBlob } = await import('../components/RegistrePDF');
  const blob = await generateRegistrePdfBlob({ registre, company, genereLe: GENERE_LE.format(new Date()).replace(/\s/g, ' ') });
  downloadBlob(blob, `registre-maintenance-${du}-au-${au}.pdf`);
}
