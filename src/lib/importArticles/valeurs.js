// src/lib/importArticles/valeurs.js
// Valeurs du fichier à rapprocher de celles de Majord'home (nature, catégorie, unité) — module PUR
// (imports relatifs seulement), testé par scripts/import-articles/valeurs.test.mjs.
import { cleEntete } from '../importClients/champs.js';

/** Nature « écartée » : l'article du fichier n'est pas repris (ouvrage composé, par exemple). */
export const NATURE_ECARTER = '@ecarter';

/** Forme comparable : `cleEntete`, avec œ / æ développés (« Main-d’œuvre » → « main d oeuvre »). */
function cle(texte) {
  return cleEntete(String(texte ?? '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae'));
}

/** Même forme, sans « s » final (pluriel simple) : « Poêles » = « Poêle ». */
function cleSingulier(texte) {
  return cle(texte).replace(/s$/, '');
}

const NATURES_SYNONYMES = {
  main: ['fourniture', 'fournitures', 'equipement', 'equipements', 'materiel', 'produit', 'article'],
  main_oeuvre: ['mo', 'main d oeuvre', 'pose', 'installation', 'service', 'prestation', 'travail'],
  accessory: ['option', 'options', 'accessoire', 'accessoires'],
  stock: ['stock', 'stocke', 'materiel stocke'],
  // Seul l'ouvrage est écarté (conception) : un « lot » ou un « composant » peut être un article ordinaire, à choisir.
  [NATURE_ECARTER]: ['ouvrage', 'ouvrages'],
};

/** Unités : forme du fichier (minuscules, sans accent ni point) → unité de Majord'home. */
const UNITES_SYNONYMES = {
  'pièce': ['u', 'un', 'unite', 'unites', 'pce', 'pcs', 'piece', 'pieces', 'pc'],
  ml: ['ml', 'm', 'metre', 'metres', 'mlin', 'metre lineaire'],
  'm²': ['m2', 'm²', 'metre carre', 'metres carres'],
  forfait: ['forfait', 'ft', 'f', 'forf'],
  h: ['h', 'heure', 'heures', 'hr'],
};

/** Forme de comparaison d'une unité : minuscules, sans accent ni point ; ² conservé (« M² » ≠ « M »). */
function cleUnite(texte) {
  return String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').trim();
}

const normaliserOptions = (options) => (options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

/**
 * Valeur de Majord'home proposée pour chaque valeur distincte du fichier ('' = inconnue, à choisir).
 * Une proposition n'est faite que si elle figure dans `options` (sauf `NATURE_ECARTER` pour la nature).
 * @param {'nature' | 'categorie' | 'unite'} champ
 * @param {string[]} distinctes
 * @param {Array<{ value: string, label: string } | string>} options
 * @returns {Record<string, string>}
 */
export function proposerValeurs(champ, distinctes, options) {
  const opts = normaliserOptions(options);
  const permises = new Set(opts.map((o) => o.value));
  const resultat = {};
  for (const brute of distinctes || []) {
    let trouvee = '';
    if (champ === 'unite') {
      const k = cleUnite(brute);
      const exacte = opts.find((o) => cleUnite(o.value) === k || cleUnite(o.label) === k);
      trouvee = exacte ? exacte.value : (Object.entries(UNITES_SYNONYMES).find(([, l]) => l.includes(k))?.[0] || '');
    } else if (champ === 'nature') {
      const k = cle(brute);
      const parLibelle = opts.find((o) => cle(o.value) === k || cle(o.label) === k);
      trouvee = parLibelle ? parLibelle.value : (Object.entries(NATURES_SYNONYMES).find(([, l]) => l.includes(k))?.[0] || '');
      if (trouvee === NATURE_ECARTER) { resultat[brute] = NATURE_ECARTER; continue; }
    } else {
      const k = cleSingulier(brute);
      trouvee = opts.find((o) => k && (cleSingulier(o.value) === k || cleSingulier(o.label) === k))?.value || '';
    }
    resultat[brute] = permises.has(trouvee) ? trouvee : '';
  }
  return resultat;
}

/**
 * Valeurs distinctes (non vides) d'un champ sur les lignes interprétées, triées.
 * @param {Array<{ valeurs: Record<string, string> }>} lignes
 * @param {string} champ
 * @returns {string[]}
 */
export function valeursDistinctes(lignes, champ) {
  const ensemble = new Set();
  for (const l of lignes || []) {
    const v = String(l?.valeurs?.[champ] ?? '').trim();
    if (v) ensemble.add(v);
  }
  return [...ensemble].sort((a, b) => a.localeCompare(b, 'fr'));
}
