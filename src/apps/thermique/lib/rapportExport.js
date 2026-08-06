// src/apps/thermique/lib/rapportExport.js
// Génération et téléchargement du rapport thermique PDF — POINT D'ENTRÉE UNIQUE, partagé par
// l'étape Résultats du wizard et l'historique. Toute la chaîne (nom du client, mise en forme,
// rendu, nommage du fichier) vit ici : deux écrans qui produiraient chacun leur PDF finiraient
// par diverger.
import { clientsService } from '@services/clients.service';
import { buildCompanyInfo } from '@lib/orgBranding';
import { formatDateFR } from '@lib/utils';
import { logger } from '@lib/logger';
import { climat, uDefauts, coefficientsB, ventilation, loadPacCatalogue } from '../data';
import { pacId } from './etudeModel';
import { buildRapportModel } from './rapportModel';

const DATA_RAPPORT = { climat, uDefauts, coefficientsB, ventilation };

/** `rapport-thermique-<slug>-<AAAA-MM-JJ>.pdf` — accents et ponctuation strippés (nom de fichier
 * portable Windows/macOS). `date` est injectée par le caller (testable, pas d'horloge implicite). */
export function buildRapportFilename(nom, date = new Date()) {
  const slug = (nom || 'etude')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'etude';
  return `rapport-thermique-${slug}-${date.toISOString().slice(0, 10)}.pdf`;
}

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
 * Machine du catalogue retenue par l'étude, pour le graphe de bivalence.
 * Le catalogue (~4,6 Mo) n'est chargé qu'à la demande ; `catalogueCharge` permet à l'appelant qui
 * l'a déjà en mémoire (volet PAC ouvert) de ne pas le retélécharger.
 * Best effort : un catalogue indisponible retire le graphe, il ne bloque JAMAIS le rapport.
 */
export async function resoudMachineRapport(pacInput, catalogueCharge = null) {
  if (pacInput?.mode !== 'catalogue' || !pacInput?.pacId) return null;
  try {
    const catalogue = catalogueCharge ?? await loadPacCatalogue();
    return catalogue?.pacs?.find((p) => pacId(p) === pacInput.pacId) ?? null;
  } catch (e) {
    logger.warn('[thermique] catalogue PAC indisponible — rapport sans graphe de bivalence', e);
    return null;
  }
}

/** Nom du client rattaché à l'étude. Best effort : une étude peut n'être liée à aucune fiche. */
async function nomClient(clientId) {
  if (!clientId) return '';
  const { data, error } = await clientsService.getClientById(clientId);
  if (error || !data) {
    logger.warn('[thermique] nom du client indisponible pour le rapport', error);
    return '';
  }
  return data.display_name || data.name
    || `${data.last_name || ''} ${data.first_name || ''}`.trim();
}

/**
 * Construit le rapport et déclenche le téléchargement.
 * @param {object} input      `input` de l'étude (état wizard persisté — toStudyInput)
 * @param {object} resultats  { bilan, thetaE, pac, engineVersion } LIVE ou FIGÉS. Ce sont eux qui
 *   font foi : le PDF n'affiche jamais un chiffre que l'écran n'a pas montré.
 * @param {object} config     buildThermiqueConfig(settings)
 * @param {object} settings   settings d'org (branding du rapport via buildCompanyInfo)
 * @param {object|null} machine PAC résolue (cf. resoudMachineRapport) — null = pas de graphe
 */
export async function telechargerRapportThermique({ input, resultats, config, settings, machine = null }) {
  const clientName = await nomClient(input?.contexte?.clientId);
  const rapport = buildRapportModel(input, resultats, {
    config,
    data: DATA_RAPPORT,
    machine,
    dateLabel: formatDateFR(new Date()),
    clientName,
  });
  // Import dynamique : @react-pdf/renderer ne pèse dans le bundle que si un rapport est demandé.
  const { generateRapportThermiquePdfBlob } = await import('../components/etude/EtudeThermiquePDF');
  const blob = await generateRapportThermiquePdfBlob({
    rapport,
    company: buildCompanyInfo(settings),
  });
  downloadBlob(blob, buildRapportFilename(clientName || input?.contexte?.titre));
}
