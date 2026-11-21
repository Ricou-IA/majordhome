// src/lib/importClients/correspondance.js
// Correspondance entre les colonnes d'un fichier importé et les champs d'une fiche client — module PUR
// (aucun import React, Supabase ni alias), testé par scripts/import-clients/correspondance.test.mjs.
import {
  CHAMPS, CIBLES_COMPOSEES, CIBLE_NOTES, CIBLE_IGNORER, CIBLE_A_CHOISIR, champParCle, cibleDepuisEntete,
} from './champs.js';

/**
 * @typedef {{ index: number, entete: string, cible: string, origine: 'fichier_type' | 'synonyme' | 'agent' | 'main' | '' }} ColonneCorrespondance
 * @typedef {ColonneCorrespondance[]} Correspondance
 */

/** Champs remplis par une cible : ceux d'une cible composée, sinon le champ lui-même. */
function champsDeCible(cible) {
  const composee = CIBLES_COMPOSEES.find((c) => c.cle === cible);
  if (composee) return composee.remplit;
  return champParCle(cible) ? [cible] : [];
}

/**
 * Le fichier suit-il le fichier type ? (toutes les en-têtes non vides sont des libellés exacts du catalogue)
 * @param {string[]} entetes
 * @returns {boolean}
 */
export function estFichierType(entetes) {
  const noms = (entetes || []).map((e) => String(e ?? '').trim()).filter(Boolean);
  if (noms.length === 0) return false;
  const libelles = new Set(CHAMPS.map((c) => c.libelle));
  return noms.every((n) => libelles.has(n));
}

/**
 * Propose un champ pour chaque colonne. Un champ déjà pris par une colonne précédente n'est pas reproposé.
 * @param {string[]} entetes
 * @returns {Correspondance}
 */
export function proposerCorrespondance(entetes) {
  const type = estFichierType(entetes);
  const pris = new Set();
  return (entetes || []).map((brut, index) => {
    const entete = String(brut ?? '');
    if (!entete.trim()) return { index, entete, cible: CIBLE_IGNORER, origine: '' };
    const cle = cibleDepuisEntete(entete);
    if (!cle || pris.has(cle)) return { index, entete, cible: CIBLE_A_CHOISIR, origine: '' };
    pris.add(cle);
    return { index, entete, cible: cle, origine: type ? 'fichier_type' : 'synonyme' };
  });
}

/**
 * Contrôle le choix de l'utilisateur.
 * @param {Correspondance} c
 * @returns {{ erreurs: string[], aChoisir: number }}
 */
export function validerCorrespondance(c) {
  const erreurs = [];
  const compte = new Map();
  let aChoisir = 0;
  for (const col of c) {
    if (col.cible === CIBLE_A_CHOISIR) aChoisir += 1;
    for (const cle of champsDeCible(col.cible)) compte.set(cle, (compte.get(cle) || 0) + 1);
  }
  for (const [cle, n] of compte) {
    if (n > 1) erreurs.push(`Deux colonnes vont vers « ${champParCle(cle).libelle} » : gardez-en une.`);
  }
  const aUnNom = ['nom', 'societe'].some((cle) => compte.has(cle));
  if (!aUnNom) erreurs.push('Indiquez la colonne du nom ou de la société.');
  return { erreurs, aChoisir };
}

/** Un mot « tout en majuscules » : au moins une lettre, aucune minuscule. */
const estMajuscules = (mot) => mot === mot.toUpperCase() && mot !== mot.toLowerCase();

/** Code postal = dernier groupe de 5 chiffres du texte. Rend { avant, cp, apres } ou null. */
function separerCodePostal(texte) {
  const trouves = [...texte.matchAll(/(?<!\d)\d{5}(?!\d)/g)];
  if (trouves.length === 0) return null;
  const dernier = trouves[trouves.length - 1];
  return {
    avant: texte.slice(0, dernier.index).replace(/[\s,;-]+$/, '').trim(),
    cp: dernier[0],
    apres: texte.slice(dernier.index + 5).replace(/^[\s,;-]+/, '').trim(),
  };
}

const CIVILITE = /^(m|mr|mme|mlle|melle|monsieur|madame|mademoiselle)\.?$/i;
const LIEN_CIVILITES = /^(et|&|ou)$/i;

/**
 * Retire la civilité de tête (« M. », « Mme », « M. et Mme »…). Un « M » sans point n'en est une
 * que s'il reste au moins deux mots après lui. Si rien ne reste, le texte d'origine est gardé.
 * @param {string[]} mots
 * @returns {string[]}
 */
function sansCivilite(mots) {
  const estCivilite = (i) => i < mots.length && CIVILITE.test(mots[i])
    && (/\.$/.test(mots[i]) || !/^m$/i.test(mots[i]) || mots.length - i - 1 >= 2);
  let i = 0;
  if (!estCivilite(0)) return mots;
  i = 1;
  while (i + 1 < mots.length && LIEN_CIVILITES.test(mots[i]) && estCivilite(i + 1)) i += 2;
  return i >= mots.length ? mots : mots.slice(i);
}

/**
 * Découpe le texte d'une colonne composée en champs. Rend tous les champs de la cible ('' si une part manque).
 * @param {string} cibleComposee clé d'une cible composée
 * @param {string} texte
 * @returns {Record<string, string>}
 */
export function decouper(cibleComposee, texte) {
  const t = String(texte ?? '').trim();
  if (cibleComposee === '@nom_prenom') {
    const mots = sansCivilite(t.split(/\s+/).filter(Boolean));
    let n = 0;
    while (n < mots.length && estMajuscules(mots[n])) n += 1;
    // Tout en majuscules (anciens logiciels) : le dernier mot est le prénom.
    if (n === mots.length && n >= 2) n -= 1;
    if (n === 0) n = Math.min(1, mots.length);
    return { nom: mots.slice(0, n).join(' '), prenom: mots.slice(n).join(' ') };
  }
  if (cibleComposee === '@prenom_nom') {
    const mots = sansCivilite(t.split(/\s+/).filter(Boolean));
    return { prenom: mots[0] || '', nom: mots.slice(1).join(' ') };
  }
  if (cibleComposee === '@cp_ville') {
    const s = separerCodePostal(t);
    // La ville = ce qui précède le code postal puis ce qui le suit : rien n'est jeté.
    // Sans code postal reconnaissable, le texte est pris pour la ville (jamais pour un code postal).
    return s ? { code_postal: s.cp, ville: [s.avant, s.apres].filter(Boolean).join(' ') } : { code_postal: '', ville: t };
  }
  if (cibleComposee === '@adresse_complete') {
    const s = separerCodePostal(t);
    return s ? { adresse: s.avant, code_postal: s.cp, ville: s.apres } : { adresse: t, code_postal: '', ville: '' };
  }
  return {};
}

/**
 * Applique la correspondance à une ligne du fichier. Seules les valeurs non vides sont posées ;
 * si deux colonnes visent le même champ, la première valeur non vide l'emporte.
 * @param {{ numero: number, cellules: string[] }} ligne
 * @param {Correspondance} c
 * @returns {{ numero: number, valeurs: Record<string, string>, notesAjoutees: string[] }}
 */
export function appliquerCorrespondance(ligne, c) {
  const valeurs = {};
  const notesAjoutees = [];
  const poser = (cle, v) => { if (v && !(cle in valeurs)) valeurs[cle] = v; };
  for (const col of c) {
    const texte = String(ligne.cellules[col.index] ?? '').trim();
    if (!texte) continue;
    if (col.cible === CIBLE_NOTES) notesAjoutees.push(`${col.entete} : ${texte}`);
    else if (col.cible === CIBLE_IGNORER || col.cible === CIBLE_A_CHOISIR) continue;
    else if (CIBLES_COMPOSEES.some((x) => x.cle === col.cible)) {
      for (const [cle, v] of Object.entries(decouper(col.cible, texte))) poser(cle, v.trim());
    } else poser(col.cible, texte);
  }
  return { numero: ligne.numero, valeurs, notesAjoutees };
}
