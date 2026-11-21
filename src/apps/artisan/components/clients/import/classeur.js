/**
 * classeur.js - Import des clients
 * ============================================================================
 * Seul fichier de l'import qui touche ExcelJS (chargé à la demande) : lecture
 * du fichier déposé et téléchargement d'un classeur. Tout se passe dans le
 * navigateur, rien n'est envoyé.
 * ============================================================================
 */

import { decoderTexte, lireCsv, celluleEnTexte } from '@/lib/importClients/lireFichier';
import { downloadBlob } from '@/lib/utils';

async function chargerExcelJS() {
  const module = await import('exceljs');
  return module.default || module;
}

/** Matrice d'une feuille : la ligne N du tableur est à l'indice N - 1 (numéros de ligne fidèles). */
function matriceDeFeuille(feuille) {
  const matrice = [];
  feuille.eachRow({ includeEmpty: false }, (ligne, numero) => {
    const valeurs = ligne.values || []; // 1-indexé, trous pour les cellules vides
    const cellules = [];
    for (let i = 1; i < valeurs.length; i += 1) cellules.push(celluleEnTexte(valeurs[i]));
    matrice[numero - 1] = cellules;
  });
  for (let i = 0; i < matrice.length; i += 1) if (!matrice[i]) matrice[i] = [];
  return matrice;
}

const nonVide = (matrice) => matrice.some((l) => l.some((c) => c !== ''));

/**
 * Lit le fichier déposé en matrice de cellules texte.
 * `.csv` : décodage UTF-8 sinon Windows-1252 ; `.xlsx` : première feuille non vide.
 * Rejette si le fichier ne se lit pas.
 * @param {File} file
 * @returns {Promise<string[][]>}
 */
export async function lireFichierDepose(file) {
  const octets = new Uint8Array(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith('.csv')) return lireCsv(decoderTexte(octets));
  const ExcelJS = await chargerExcelJS();
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(octets.buffer);
  for (const feuille of classeur.worksheets) {
    const matrice = matriceDeFeuille(feuille);
    if (nonVide(matrice)) return matrice;
  }
  return [];
}

/**
 * Écrit un classeur .xlsx (une feuille par entrée, cellules en texte) et le télécharge.
 * @param {string} nomFichier
 * @param {Array<{ nom: string, lignes: string[][] }>} feuilles
 */
export async function telechargerClasseur(nomFichier, feuilles) {
  const ExcelJS = await chargerExcelJS();
  const classeur = new ExcelJS.Workbook();
  for (const { nom, lignes } of feuilles) {
    const feuille = classeur.addWorksheet(nom);
    lignes.forEach((ligne, i) => {
      const rang = feuille.addRow(ligne.map((c) => String(c ?? '')));
      if (i === 0) rang.font = { bold: true };
    });
    // Cellules écrites en texte : un code postal ou un téléphone garde son zéro de tête.
    (lignes[0] || []).forEach((_, k) => {
      const largeur = Math.max(12, ...lignes.map((l) => String(l[k] ?? '').length + 2));
      feuille.getColumn(k + 1).width = Math.min(60, largeur);
    });
  }
  const tampon = await classeur.xlsx.writeBuffer();
  downloadBlob(new Blob([tampon], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomFichier);
}
