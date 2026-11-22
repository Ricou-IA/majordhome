// src/lib/importClients/libelles.js
// Libellés affichés de l'import de clients — module PUR (imports relatifs seulement), testé par
// scripts/import-clients/libelles.test.mjs.

import { CHAMPS } from './champs.js';

const RAISONS_RAPPROCHEMENT = {
  phone: 'même téléphone',
  email: 'même e-mail',
  name: 'même nom et prénom',
  name_cp: 'même nom dans la même commune',
  nom_affiche: 'même nom',
};

/**
 * Pourquoi une fiche existante a été rapprochée d'une ligne du fichier, en clair.
 * @param {{ matchReasons?: string[], raisonAncienNumero?: boolean } | null | undefined} doublon
 * @returns {string[]} libellés dans l'ordre des raisons, « même ancien numéro » en dernier ; raison inconnue ignorée
 */
export function libellesRapprochement(doublon) {
  const libelles = [];
  for (const r of doublon?.matchReasons || []) {
    const l = RAISONS_RAPPROCHEMENT[r];
    if (l && !libelles.includes(l)) libelles.push(l);
  }
  // « même nom » redit « même nom et prénom » : omis quand celui-ci y est.
  const sansRedite = libelles.includes(RAISONS_RAPPROCHEMENT.name)
    ? libelles.filter((l) => l !== RAISONS_RAPPROCHEMENT.nom_affiche)
    : libelles;
  if (doublon?.raisonAncienNumero) sansRedite.push('même ancien numéro');
  return sansRedite;
}

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Phrase d'équilibre de l'aperçu, en une seule chaîne : lues = à importer + doublons écartés + écartées.
 * @param {{ lues: number, importees: number, doublons_ecartes: number, ecartees: number }} b
 * @returns {string}
 */
export function phraseBilan(b) {
  return `${pluriel(b.lues, 'ligne lue', 'lignes lues')} = ${b.importees} à importer`
    + ` + ${pluriel(b.doublons_ecartes, 'doublon écarté', 'doublons écartés')}`
    + ` + ${pluriel(b.ecartees, 'écartée', 'écartées')}`;
}

const nombreFR = (n) => Number(n).toLocaleString('fr-FR');
const USAGES = '(contrat, intervention, devis, e-mail envoyé…)';

/**
 * Texte de confirmation du retrait d'un import, construit sur l'aperçu.
 * @param {{ retirables: number, conservees: number }} apercu
 * @returns {string}
 */
export function texteRetrait({ retirables, conservees }) {
  if (retirables > 0) {
    const retrait = `${nombreFR(retirables)} ${retirables > 1 ? 'fiches seront retirées' : 'fiche sera retirée'}.`;
    if (conservees <= 0) return retrait;
    const reste = conservees > 1
      ? `${nombreFR(conservees)} seront conservées : elles sont déjà utilisées ailleurs ${USAGES}.`
      : `1 sera conservée : elle est déjà utilisée ailleurs ${USAGES}.`;
    return `${retrait} ${reste}`;
  }
  if (conservees > 0) {
    return conservees > 1
      ? `Aucune fiche ne peut être retirée : les ${nombreFR(conservees)} fiches de cet import sont déjà utilisées ailleurs ${USAGES}.`
      : `Aucune fiche ne peut être retirée : la fiche de cet import est déjà utilisée ailleurs ${USAGES}.`;
  }
  // Import sans aucune fiche (interrompu avant le premier lot, ou déjà vidé) : le retrait le sort de la liste.
  return 'Cet import ne contient aucune fiche. Le retirer de la liste ?';
}

/**
 * Texte du toast après un retrait.
 * @param {{ retirees: number, conservees: number }} totaux
 * @returns {string}
 */
export function texteRetraitFait({ retirees, conservees }) {
  if (retirees <= 0 && conservees <= 0) return 'Import retiré de la liste.';
  const retire = retirees > 0
    ? `${nombreFR(retirees)} ${retirees > 1 ? 'fiches retirées' : 'fiche retirée'}`
    : 'Aucune fiche retirée';
  if (conservees <= 0) return retire;
  return `${retire}, ${nombreFR(conservees)} ${conservees > 1 ? 'conservées' : 'conservée'}`;
}

/**
 * Message d'un retrait interrompu : des fiches ont pu être retirées avant l'arrêt.
 * @param {string} message phrase d'erreur déjà en français
 * @returns {string}
 */
export function messageEchecRetrait(message) {
  return `${message} Des fiches ont pu être retirées avant l'arrêt : relancez le retrait pour terminer.`;
}

/**
 * Fiches d'un import précédent, pour sa ligne de la liste : créées (bilan de fin), puis retirées et conservées si un
 * retrait est passé. Sans bilan de fin, l'import a été interrompu : on ne dit pas combien de fiches il a créées.
 * @param {{ importees?: number, retirees?: number, conservees?: number } | null | undefined} counts
 * @returns {string}
 */
export function resumeFichesImport(counts) {
  const n = counts?.importees;
  const creees = typeof n === 'number' ? `${nombreFR(n)} ${n > 1 ? 'fiches créées' : 'fiche créée'}` : 'import interrompu';
  const r = counts?.retirees;
  if (typeof r !== 'number' || r <= 0) return creees;
  const c = typeof counts.conservees === 'number' ? counts.conservees : 0;
  const retrait = `${nombreFR(r)} ${r > 1 ? 'retirées' : 'retirée'}`;
  return c > 0 ? `${creees} · ${retrait}, ${nombreFR(c)} ${c > 1 ? 'conservées' : 'conservée'}` : `${creees} · ${retrait}`;
}

const ACCORDS = new Set(CHAMPS.filter((c) => c.type === 'oui_non').map((c) => c.libelle));
const TYPE_CLIENT = CHAMPS.find((c) => c.cle === 'type_client').libelle;

/**
 * Bloc de l'aperçu sur les valeurs illisibles des lignes qui seront importées (cf. resumeCorrections).
 * @param {Array<{ libelle: string, nombre: number }>} resume
 * @returns {string | null} null quand il n'y a rien à signaler
 */
export function texteCorrections(resume) {
  if (!resume || resume.length === 0) return null;
  const liste = resume.map((r) => `${nombreFR(r.nombre)} × ${r.libelle}`).join(', ');
  // Valeurs prises d'office quand la valeur du fichier est illisible (cf. controlerFiche).
  const parDefaut = resume.some((r) => ACCORDS.has(r.libelle) || r.libelle === TYPE_CLIENT)
    ? ' Un accord illisible vaut « oui » ; un type de client illisible est déduit de la société, sinon « particulier ».'
    : '';
  return `Valeurs illisibles : ${liste}. Le champ est laissé vide et la valeur d'origine est gardée dans les notes internes de la fiche.${parDefaut}`;
}

/**
 * Ligne de l'étape Correspondance quand des accents abîmés par un tableur ont été réparés à la lecture.
 * @param {number} n cellules réparées
 * @returns {string | null} null quand rien n'a été réparé
 */
export function texteAccentsRepares(n) {
  if (!(n > 0)) return null;
  return `Des accents abîmés ont été réparés dans ${nombreFR(n)} ${n > 1 ? 'cellules' : 'cellule'} (fichier passé par un tableur).`;
}

/**
 * Ligne de l'aperçu sur les fiches à importer sans code postal.
 * @param {number} n fiches à importer sans code postal (cf. fichesSansCodePostal)
 * @returns {string | null} null quand toutes en ont un
 */
export function texteSansCodePostal(n) {
  if (!(n > 0)) return null;
  return n > 1
    ? `${nombreFR(n)} fiches sans code postal : elles ne seront pas placées sur la carte.`
    : '1 fiche sans code postal : elle ne sera pas placée sur la carte.';
}

/**
 * Avis affiché à l'aperçu après « Arrêter l'import » : les fiches déjà créées restent, et se retirent plus bas.
 * @param {number} faits fiches déjà écrites
 * @returns {string}
 */
export function texteArret(faits) {
  if (!(faits > 0)) return "Import arrêté : aucune fiche n'a été créée.";
  return faits > 1
    ? `Import arrêté : ${nombreFR(faits)} fiches sont déjà créées. Vous pouvez les retirer dans « Imports précédents », plus bas.`
    : 'Import arrêté : 1 fiche est déjà créée. Vous pouvez la retirer dans « Imports précédents », plus bas.';
}
