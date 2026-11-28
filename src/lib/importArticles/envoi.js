// src/lib/importArticles/envoi.js
// Préparation de l'envoi d'un import d'articles (aperçu puis après l'ouverture de l'import) — module PUR
// (imports relatifs seulement), testé par scripts/import-articles/envoi.test.mjs.
// Règle : ce que l'aperçu annonce est exactement ce qui part. Les fournisseurs « à créer » reçoivent à l'aperçu un
// identifiant PROVISOIRE distinct chacun (jamais envoyé), remplacé après l'ouverture par celui rendu par la base.

import { champArticle } from './champs.js';
import { NATURE_ECARTER } from './valeurs.js';
import { aImporter, controlerArticle, lignesPourEcriture } from './controles.js';
import { verifierLigneArticle } from './lots.js';

/**
 * Identifiant provisoire du n-ième fournisseur à créer : UUID valide, distinct par fournisseur, jamais envoyé.
 * @param {number} index
 * @returns {string}
 */
export function idProvisoire(index) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

/**
 * Fournisseurs résolus pour l'aperçu : ceux de l'entreprise, plus un identifiant provisoire par fournisseur à créer.
 * @param {Array<{ cle: string, aCreer: boolean }>} aEnvoyer fournisseurs envoyés à l'ouverture (existants et à créer cochés)
 * @param {Record<string, string>} resolusExistants `cle` → supplier_id
 * @returns {Record<string, string>}
 */
export function resolusPrevus(aEnvoyer, resolusExistants) {
  const resolus = { ...resolusExistants };
  let n = 0;
  for (const r of aEnvoyer) if (r.aCreer) { resolus[r.cle] = idProvisoire(n); n += 1; }
  return resolus;
}

/**
 * Fournisseurs résolus après l'ouverture, à partir de ce que la base a rendu (dans l'ordre envoyé). Lève si la base
 * n'a pas rendu chaque fournisseur, au même rang et sous le même nom, avec un identifiant.
 * @param {Array<{ cle: string, nom: string }>} aEnvoyer
 * @param {Array<{ nom: string, supplier_id: string }>} rendus
 * @param {Record<string, string>} resolusExistants
 * @returns {Record<string, string>}
 */
export function resolusApresOuverture(aEnvoyer, rendus, resolusExistants) {
  const ok = Array.isArray(rendus) && rendus.length === aEnvoyer.length
    && rendus.every((f, i) => typeof f?.supplier_id === 'string' && f.supplier_id && f.nom === aEnvoyer[i].nom);
  if (!ok) throw new Error("La base n'a pas rendu tous les fournisseurs : aucun article n'a été envoyé. Revenez à l'aperçu.");
  const resolus = { ...resolusExistants };
  aEnvoyer.forEach((r, i) => { resolus[r.cle] = rendus[i].supplier_id; });
  return resolus;
}

// Clé de ligne refusée (verifierLigneArticle) → champ du catalogue dont on affiche le libellé.
const CHAMP_DE_CLE = {
  name: 'designation', code: 'code', brand: 'marque', model_key: 'modele', modele_brut: 'modele', code_ean: 'ean',
  category: 'categorie', gamme: 'gamme', product_kind: 'nature', unit: 'unite', default_tva_rate: 'tva',
  selling_price_ht: 'prix_vente', description: 'description', ancien_numero: 'ancien_numero',
};

/**
 * Raison affichée d'une ligne refusée au contrôle avant envoi.
 * @param {string} cle clé rendue par verifierLigneArticle
 * @returns {string}
 */
export function raisonRefus(cle) {
  if (cle === 'fournisseur') return 'Ligne fournisseur refusée au contrôle avant envoi';
  if (cle === 'import_line') return 'Numéro de ligne refusé au contrôle avant envoi';
  const libelle = champArticle(CHAMP_DE_CLE[cle])?.libelle || cle;
  return `Valeur « ${libelle} » refusée au contrôle avant envoi`;
}

/**
 * Lignes à écrire, chacune passée par `verifierLigneArticle`. Une ligne refusée devient une ligne écartée (avec sa
 * raison) et les lignes sont recalculées SANS elle : une ligne refusée ne garde jamais la place (fournisseur +
 * référence) d'une ligne valide. Répété jusqu'à ce qu'aucune nouvelle ligne ne soit refusée.
 * @param {Array<object>} classees sortie de classerArticles
 * @param {Record<number, boolean>} choix
 * @param {Record<string, string>} resolus `cleFournisseur(nom)` → supplier_id
 * @returns {{ classeesFinales: Array<object>, lignes: Array<Record<string, unknown>> }}
 */
export function preparerEcriture(classees, choix, resolus) {
  let courantes = classees;
  for (let tour = 0; tour <= classees.length; tour += 1) {
    const lignes = lignesPourEcriture(courantes, choix, resolus);
    const refus = new Map();
    for (const l of lignes) {
      const cle = verifierLigneArticle(l);
      if (cle) refus.set(l.import_line, cle);
    }
    if (refus.size === 0) return { classeesFinales: courantes, lignes };
    courantes = courantes.map((c) => (refus.has(c.numero)
      ? { ...c, fiche: null, raison: raisonRefus(refus.get(c.numero)), doublon: null, recochable: false }
      : c));
  }
  throw new Error('Contrôle des lignes avant envoi : aucune stabilité atteinte.');
}

/**
 * Nombre de lignes importées par champ dont une valeur a été corrigée.
 * @param {Array<object>} classees
 * @param {Record<number, boolean>} choix
 * @returns {Array<{ cle: string, nombre: number }>}
 */
export function resumeCorrections(classees, choix) {
  const compte = new Map();
  for (const c of classees) {
    if (!aImporter(c, choix)) continue;
    for (const cle of c.corrections) compte.set(cle, (compte.get(cle) || 0) + 1);
  }
  return [...compte].map(([cle, nombre]) => ({ cle, nombre }));
}

/**
 * Articles importés sans ligne fournisseur, par raison (`non_creee` : fournisseur à créer décoché ;
 * `existante` : ligne fournisseur déjà en base, article repris quand même).
 * @param {Array<object>} classees
 * @param {Record<number, boolean>} choix
 * @param {Array<{ import_line: number, fournisseur: object|null }>} lignes sortie de preparerEcriture
 * @returns {{ sans_prix: number, sans_reference: number, sans_fournisseur: number, existante: number, non_creee: number }}
 */
export function resumeSansLigne(classees, choix, lignes) {
  const avecLigne = new Set(lignes.filter((l) => l.fournisseur).map((l) => l.import_line));
  const r = { sans_prix: 0, sans_reference: 0, sans_fournisseur: 0, existante: 0, non_creee: 0 };
  for (const c of classees) {
    if (!aImporter(c, choix) || avecLigne.has(c.numero)) continue;
    if (c.ligneFournisseur === 'oui') r[c.ligneExistante ? 'existante' : 'non_creee'] += 1;
    else if (c.ligneFournisseur in r) r[c.ligneFournisseur] += 1;
  }
  return r;
}

/**
 * Choix proposés à l'écran pour une valeur du fichier. Nature et unité : la valeur par défaut est une option RÉELLE
 * (« Équipement (par défaut) » = `main`, « Pièce (par défaut) » = `pièce`) : la choisir rend la valeur reconnue, et
 * elle n'est plus comptée corrigée ; une valeur non reconnue ('') s'affiche « Non reconnue » (non sélectionnable).
 * Catégorie : '' = « Sans catégorie ».
 * @param {'nature'|'categorie'|'unite'} champ
 * @param {Array<{ value: string, label: string }>} options valeurs de Majord'home
 * @returns {Array<{ value: string, label: string, disabled?: boolean }>}
 */
export function optionsDuChamp(champ, options) {
  const parDefaut = { nature: 'main', unite: 'pièce' }[champ];
  if (!parDefaut) return [{ value: '', label: 'Sans catégorie' }, ...options];
  const liste = [
    { value: '', label: 'Non reconnue : à choisir', disabled: true },
    ...options.map((o) => (o.value === parDefaut ? { ...o, label: `${o.label} (par défaut)` } : o)),
  ];
  if (champ === 'nature') liste.push({ value: NATURE_ECARTER, label: 'Ne pas importer (ouvrage, composant)' });
  return liste;
}

/**
 * Table brute → valeur de Majord'home : choix de l'utilisateur, sinon proposition. `explicites` = valeurs choisies
 * à la main (une catégorie laissée vide exprès n'est pas « non reconnue »).
 * @param {string[]} distinctes
 * @param {Record<string, string>} proposees
 * @param {Record<string, string>} choisies
 * @returns {{ table: Record<string, string>, explicites: Set<string> }}
 */
export function tableDesValeurs(distinctes, proposees, choisies = {}) {
  const table = {};
  const explicites = new Set();
  for (const brute of distinctes) {
    if (Object.prototype.hasOwnProperty.call(choisies, brute)) { table[brute] = choisies[brute]; explicites.add(brute); }
    else table[brute] = proposees[brute] || '';
  }
  return { table, explicites };
}

/**
 * Réapplique unité et catégorie à un classement fait sans elles (ou avec d'autres tables), par la règle même de
 * `controlerArticle`, évaluée une fois par couple de valeurs brutes distinct. Unité et catégorie ne jouent ni sur
 * les doublons ni sur la ligne fournisseur : changer l'une d'elles à l'aperçu ne refait pas tout le classement
 * (≈ 0,4 s sur 50 000 lignes). Résultat identique à `classerArticles` avec toutes les tables (testé).
 * @param {Array<object>} classees sortie de classerArticles, dans l'ordre de `candidats`
 * @param {Array<{ numero: number, valeurs: Record<string, string> }>} candidats
 * @param {{ unite?: Record<string, string>, categorie?: Record<string, string> }} tables
 * @returns {Array<object>}
 */
export function appliquerUniteCategorie(classees, candidats, tables) {
  const cache = new Map();
  const interpretation = (unite, categorie) => {
    const cle = `${unite ?? ''}\u0000${categorie ?? ''}`;
    if (!cache.has(cle)) {
      const r = controlerArticle({ designation: 'x', unite, categorie }, { valeursInterpretees: tables });
      cache.set(cle, {
        unit: r.fiche.unit, category: r.fiche.category,
        corrections: r.corrections.filter((k) => k === 'unite' || k === 'categorie'),
      });
    }
    return cache.get(cle);
  };
  return classees.map((c, i) => {
    if (!c.fiche) return c;
    const v = candidats[i]?.valeurs || {};
    const r = interpretation(v.unite, v.categorie);
    return {
      ...c,
      fiche: { ...c.fiche, unit: r.unit, category: r.category },
      corrections: [...c.corrections.filter((k) => k !== 'unite' && k !== 'categorie'), ...r.corrections],
    };
  });
}
