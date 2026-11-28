// src/lib/importArticles/champs.js
// Catalogue des champs d'un article importable — module PUR (imports relatifs seulement),
// testé par scripts/import-articles/champs.test.mjs.
import { cleEntete } from '../importClients/champs.js';

/**
 * Les dix-huit champs d'un article, dans l'ordre du fichier type.
 * `type` : texte | prix | tva | ean | date | valeur (nature, catégorie, unité : interprétées par la correspondance).
 * `fournisseur: true` marque les cinq champs de la ligne fournisseur de l'article.
 * Aucun synonyme « Note », « Remarque » ou « Client » : une colonne ainsi nommée n'est jamais reprise d'office.
 * @type {Array<{ cle: string, libelle: string, type: string, synonymes: string[], exemple: string, aide: string, fournisseur?: true }>}
 */
export const CHAMPS_ARTICLE = [
  { cle: 'designation', libelle: 'Désignation', type: 'texte',
    synonymes: ['Libellé', 'Nom de l\'article', 'Nom article', 'Article', 'Produit', 'Intitulé'], exemple: 'Poêle à granulés 8 kW', aide: 'Nom de l\'article, tel qu\'il apparaîtra sur un devis.' },
  { cle: 'code', libelle: 'Référence interne', type: 'texte',
    synonymes: ['Réf. interne', 'Code article', 'Code interne', 'Réf. article', 'Référence article'], exemple: 'POE-008', aide: 'Votre propre référence, unique par article.' },
  { cle: 'marque', libelle: 'Marque', type: 'texte',
    synonymes: ['Fabricant', 'Constructeur'], exemple: 'Invicta', aide: 'Marque de l\'article.' },
  { cle: 'modele', libelle: 'Référence fabricant', type: 'texte',
    synonymes: ['Réf. fabricant', 'Modèle', 'Réf. constructeur', 'Référence constructeur'], exemple: 'ORA-8', aide: 'Référence ou modèle chez le fabricant.' },
  { cle: 'ean', libelle: 'Code EAN', type: 'ean',
    synonymes: ['EAN', 'EAN13', 'GTIN', 'Gencod', 'Code barres', 'Code-barres'], exemple: '3760123456789', aide: 'Code-barres de 8 à 14 chiffres.' },
  { cle: 'categorie', libelle: 'Catégorie', type: 'valeur',
    synonymes: ['Famille', 'Rayon', 'Catégorie article'], exemple: 'Poêle à granulés', aide: 'Rayon ou famille de l\'article.' },
  { cle: 'gamme', libelle: 'Gamme', type: 'texte',
    synonymes: ['Série', 'Collection'], exemple: 'Orange', aide: 'Gamme de la marque.' },
  { cle: 'nature', libelle: 'Nature', type: 'valeur',
    synonymes: ['Type d\'article', 'Nature de l\'article'], exemple: 'Équipement', aide: 'Équipement, accessoire, main-d\'œuvre, etc.' },
  { cle: 'unite', libelle: 'Unité', type: 'valeur',
    synonymes: ['Unité de vente', 'UV'], exemple: 'pièce', aide: 'Pièce, mètre, heure, etc.' },
  { cle: 'tva', libelle: 'Taux de TVA', type: 'tva',
    synonymes: ['TVA', 'TVA %', 'Taux TVA'], exemple: '20', aide: '0, 5,5, 10 ou 20.' },
  { cle: 'prix_vente', libelle: 'Prix de vente HT', type: 'prix',
    synonymes: ['Prix de vente', 'PU HT', 'Prix HT', 'PV HT', 'Tarif HT'], exemple: '2490', aide: 'Prix de vente hors taxe. Un prix TTC n\'est jamais converti.' },
  { cle: 'description', libelle: 'Description', type: 'texte',
    synonymes: ['Descriptif', 'Détail'], exemple: 'Poêle à granulés étanche, 8 kW.', aide: 'Texte libre.' },
  { cle: 'fournisseur', libelle: 'Fournisseur', type: 'texte', fournisseur: true,
    synonymes: ['Fournisseur principal', 'Nom du fournisseur'], exemple: 'Invicta', aide: 'Fournisseur chez qui vous achetez l\'article.' },
  { cle: 'ref_fournisseur', libelle: 'Référence fournisseur', type: 'texte', fournisseur: true,
    synonymes: ['Réf. fournisseur', 'Code fournisseur', 'Réf. chez le fournisseur'], exemple: 'INV-ORA-8', aide: 'Référence de l\'article chez ce fournisseur.' },
  { cle: 'prix_achat', libelle: 'Prix d\'achat HT', type: 'prix', fournisseur: true,
    synonymes: ['Prix d\'achat', 'PA HT', 'Prix achat net', 'Prix d\'achat net'], exemple: '1650', aide: 'Prix d\'achat hors taxe, net de remise.' },
  { cle: 'prix_public', libelle: 'Prix public HT', type: 'prix', fournisseur: true,
    synonymes: ['Prix public', 'Prix catalogue', 'Tarif public', 'Prix conseillé'], exemple: '2490', aide: 'Prix public ou catalogue du fournisseur, hors taxe.' },
  { cle: 'date_prix', libelle: 'Date du prix d\'achat', type: 'date', fournisseur: true,
    synonymes: ['Date du prix', 'Date du tarif', 'Date tarif', 'Date d\'achat'], exemple: '15/03/2026', aide: 'Date du prix d\'achat. Vide : date inconnue.' },
  { cle: 'ancien_numero', libelle: 'Ancien numéro', type: 'texte',
    synonymes: ['N° article', 'Numéro article', 'Ancien code', 'Ancienne référence'], exemple: 'A-04521', aide: 'Numéro de l\'article dans l\'ancien logiciel.' },
];

const INDEX_ENTETES = (() => {
  const index = new Map();
  for (const c of CHAMPS_ARTICLE) for (const s of [c.libelle, ...c.synonymes]) index.set(cleEntete(s), c.cle);
  return index;
})();

/**
 * @param {string} cle
 * @returns {object|null} le champ du catalogue, ou null
 */
export function champArticle(cle) {
  return CHAMPS_ARTICLE.find((c) => c.cle === cle) || null;
}

/**
 * Champ désigné par l'en-tête d'une colonne : libellé exact du catalogue ou synonyme.
 * @param {string} entete
 * @returns {string} la clé du champ, ou '' si l'en-tête n'est pas reconnu
 */
export function cibleArticleDepuisEntete(entete) {
  return INDEX_ENTETES.get(cleEntete(entete)) || '';
}
