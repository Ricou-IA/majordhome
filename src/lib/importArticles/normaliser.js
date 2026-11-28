// src/lib/importArticles/normaliser.js
// Mise en forme de la valeur d'une cellule selon le champ — module PUR (imports relatifs seulement),
// testé par scripts/import-articles/normaliser.test.mjs.
import { champArticle } from './champs.js';
import { lireSaisieDate } from '../datesFr.js';

/** Taux de TVA admis (en %). */
export const TAUX_TVA_ADMIS = [0, 5.5, 10, 20];

const ESPACES = /[ \u00A0\u202F]/g;
const VIDE = { valeur: null, illisible: false };
const ILLISIBLE = { valeur: null, illisible: true };
const ok = (valeur) => ({ valeur, illisible: false });

/**
 * Nombre positif ou nul : espaces (dont insécables), € et % retirés ; avec une virgule, elle est
 * décimale et les points séparent les milliers ; sinon le point est décimal.
 * @param {string} texte
 * @returns {number|null} null si illisible
 */
function lireNombre(texte) {
  let s = texte.replace(ESPACES, '').replace(/[€%]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

function lirePrix(texte) {
  const n = lireNombre(texte);
  return n === null ? ILLISIBLE : ok(n);
}

// 0,2 et 20 désignent le même taux : une valeur inférieure à 1 est une fraction.
function lireTva(texte) {
  const n = lireNombre(texte);
  if (n === null) return ILLISIBLE;
  const taux = Math.round((n < 1 ? n * 100 : n) * 100) / 100;
  return TAUX_TVA_ADMIS.includes(taux) ? ok(taux) : ILLISIBLE;
}

// Un tableur peut écrire un code-barres en notation scientifique (3.760123456789E12) : on en rend les chiffres.
function lireEan(texte) {
  let s = texte.replace(ESPACES, '');
  if (/^\d(\.\d+)?e\+?\d+$/i.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) s = String(n);
  }
  return /^\d{8,14}$/.test(s) ? ok(s) : ILLISIBLE;
}

const jourLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Une cellule date d'Excel arrive en AAAA-MM-JJ (voir `celluleEnTexte`) ; une saisie à la main en JJ/MM/AAAA.
function lireDate(texte, maintenant) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte);
  const iso = lireSaisieDate(m ? `${m[3]}/${m[2]}/${m[1]}` : texte, maintenant);
  if (!iso) return ILLISIBLE;
  return iso > jourLocal(maintenant) ? ILLISIBLE : ok(iso);
}

/**
 * Valeur d'une cellule mise en forme pour son champ.
 * @param {string} champ  clé du champ (ex. `prix_vente`) ; un champ inconnu est lu comme du texte
 * @param {unknown} brut  texte de la cellule (voir `celluleEnTexte`)
 * @param {Date} [maintenant]  pour refuser une date future (tests)
 * @returns {{ valeur: string|number|null, illisible: boolean }}  vide ⇒ `{ null, false }` ; illisible ⇒ `{ null, true }`
 */
export function normaliserArticle(champ, brut, maintenant = new Date()) {
  const texte = String(brut ?? '').trim();
  if (!texte) return VIDE;
  switch (champArticle(champ)?.type) {
    case 'prix': return lirePrix(texte);
    case 'tva': return lireTva(texte);
    case 'ean': return lireEan(texte);
    case 'date': return lireDate(texte, maintenant);
    default: return ok(texte);
  }
}
