// src/lib/importArticles/lots.js
// Contrôle d'une ligne avant envoi et messages d'erreur de l'import d'articles — module PUR (imports relatifs
// seulement), testé par scripts/import-articles/lots.test.mjs.
// Miroir de `catalog_items_import_batch` (migration 20261129_2), à modifier ensemble : toute différence entre
// ces règles et la RPC fait refuser un lot entier. Le découpage en lots et l'exécution reprenable sont ceux de
// `../importClients/lots.js` (`decouperEnLots`, `executerLots`), réutilisés tels quels par la page.

import { CLES_ROW_ARTICLE } from './controles.js';

// Forme d'une ligne envoyée : la liste des clés vit dans controles.js (`CLES_ROW_ARTICLE`), jamais redéfinie ici.
export { CLES_ROW_ARTICLE };

/**
 * Articles retirés par appel de `catalog_items_import_remove` (la RPC accepte 1 à 500). Mesuré sur le harnais le
 * 2026-11-28 au volume de la production (import de 20 000 articles, 47 000 articles dans l'org) : 397 à 411 ms par
 * appel de 300, sous la cible de 2 s (plafond PostgREST 8 s). Le retrait des clients garde ses lots de 100.
 */
export const TAILLE_LOT_RETRAIT_ARTICLES = 300;

const NATURES = ['main', 'accessory', 'stock', 'main_oeuvre'];
const TAUX_TVA = [0, 5.5, 10, 20];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const EAN = /^[0-9]{8,14}$/;

const nombre = (v) => typeof v === 'number' && Number.isFinite(v);
// Plafond des prix : la ligne fournisseur est en numeric(10,2) (99 999 999,99 au plus).
const PRIX_MAX = 100000000;
// Plus petit prix d'achat qui ne s'arrondit pas à 0,00 en numeric(10,2).
const ACHAT_MIN = 0.005;
// Numéro de ligne : au plus 9 chiffres (même borne que la RPC).
const LIGNE_MAX = 999999999;
// Clés texte : chaîne, nombre ou vide ; tout autre type est refusé par la RPC (`catalog_import_texte`).
const CLES_TEXTE = ['code', 'brand', 'model_key', 'modele_brut', 'category', 'gamme', 'unit', 'description', 'ancien_numero'];
const texteAdmis = (v) => v === null || v === undefined || typeof v === 'string' || typeof v === 'number';
// Date réelle au format aaaa-mm-jj (« 2026-02-30 » refusée, comme `catalog_import_date_valide`).
const dateReelle = (v) => {
  if (typeof v !== 'string' || !DATE_ISO.test(v)) return false;
  const [a, m, j] = v.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
};

/**
 * Clé d'une ligne que `catalog_items_import_batch` refuserait (`row_invalid`), ou null si la ligne passe.
 * Une clé hors de la forme n'est pas refusée : la RPC l'ignore (liste fermée).
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {string | null}
 */
export function verifierLigneArticle(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 'import_line';
  if (!Number.isInteger(row.import_line) || row.import_line < 1 || row.import_line > LIGNE_MAX) return 'import_line';
  if (typeof row.name !== 'string' || !row.name.trim()) return 'name';
  if (!NATURES.includes(row.product_kind)) return 'product_kind';
  if (!TAUX_TVA.includes(row.default_tva_rate)) return 'default_tva_rate';
  if (!nombre(row.selling_price_ht) || row.selling_price_ht < 0 || row.selling_price_ht >= PRIX_MAX) return 'selling_price_ht';
  if (row.code_ean !== null && row.code_ean !== undefined && !(typeof row.code_ean === 'string' && EAN.test(row.code_ean))) return 'code_ean';
  const f = row.fournisseur;
  if (f !== null && f !== undefined) {
    if (typeof f !== 'object' || Array.isArray(f)) return 'fournisseur';
    if (typeof f.supplier_id !== 'string' || !UUID.test(f.supplier_id)) return 'fournisseur';
    if (typeof f.reference !== 'string' || !f.reference.trim()) return 'fournisseur';
    if (!nombre(f.purchase_price_ht) || !(f.purchase_price_ht >= ACHAT_MIN) || f.purchase_price_ht >= PRIX_MAX) return 'fournisseur';
    const p = f.tarif_public;
    if (p !== null && p !== undefined && !(nombre(p) && p >= 0 && p < PRIX_MAX)) return 'fournisseur';
    const d = f.purchase_price_at;
    if (d !== null && d !== undefined && !dateReelle(d)) return 'fournisseur';
  }
  for (const k of CLES_TEXTE) if (!texteAdmis(row[k])) return k;
  return null;
}

// ── Messages ─────────────────────────────────────────────────────────────────────────────────────────────────

const MESSAGES = {
  unauthenticated: 'Votre session a expiré : reconnectez-vous.',
  org_admin_required: "Réservé à l'administrateur de l'entreprise.",
  import_not_found: 'Cet import est introuvable.',
  import_closed: 'Cet import est déjà terminé.',
  rows_invalid: "Une ligne du fichier n'a pas pu être écrite : aucun article de ce lot n'a été créé.",
  row_invalid: "Une ligne du fichier n'a pas pu être écrite : aucun article de ce lot n'a été créé.",
  code_pris: 'Une référence interne du fichier est déjà prise par un autre article. Aucun article de ce lot n\'a été créé.',
  ligne_fournisseur_existante: "La ligne fournisseur d'un article existe déjà chez ce fournisseur. Aucun article de ce lot n'a été créé.",
  supplier_not_in_org: "Un fournisseur du fichier n'appartient pas à votre entreprise. Aucun article de ce lot n'a été créé.",
  file_name_required: 'Le nom du fichier est manquant : déposez à nouveau le fichier.',
  rattachement_incomplet: "Une ligne fournisseur n'a pas pu être rattachée à son article : aucun article de ce lot n'a été créé. Réessayez.",
  removal_incomplete: "Le retrait n'a pas pu aller au bout : rien n'a été retiré par cet appel. Réessayez.",
};

const DELAI = 'La base a mis trop de temps à répondre. Réessayez dans un instant.';
const RESEAU = 'Connexion interrompue. Vérifiez votre réseau, puis reprenez.';
const EN_COURS = "Ces lignes sont déjà en cours d'écriture par un autre envoi. Reprenez dans un instant.";

const COLONNES = {
  import_line: 'Numéro de ligne', name: 'Désignation', code: 'Référence interne', brand: 'Marque', model_key: 'Modèle',
  code_ean: 'Code EAN', category: 'Catégorie', gamme: 'Gamme', product_kind: 'Nature', unit: 'Unité',
  default_tva_rate: 'Taux de TVA', selling_price_ht: 'Prix de vente HT', description: 'Description',
  modele_brut: "Modèle (tel qu'écrit)", ancien_numero: 'Ancien numéro', fournisseur: 'Ligne fournisseur',
};
const libelleColonne = (colonne) => COLONNES[colonne] || colonne;
const contient = (texte, code) => new RegExp(`\\b${code}\\b`).test(texte);

/**
 * Phrase lisible pour une erreur de la base d'import d'articles. Le code est lu dans `error.message` (mot entier),
 * le détail d'une ligne dans `error.details` (« ligne N : colonne » ou « ligne N »), le code PostgreSQL dans
 * `error.code` ; un message inconnu est rendu tel quel, jamais un code connu.
 * @param {{ message?: string, details?: string, code?: string } | Error | null | undefined} error
 * @returns {string}
 */
export function messageErreurImportArticles(error) {
  const message = error?.message || '';
  const details = typeof error?.details === 'string' ? error.details : '';
  const code = error?.code;

  if (contient(message, 'row_invalid')) {
    const m = details.match(/ligne (\d+) : ([a-z_]+)/);
    if (m) return `Ligne ${m[1]} du fichier : la valeur « ${libelleColonne(m[2])} » est refusée. Aucun article de ce lot n'a été créé.`;
  }
  if (contient(message, 'code_pris')) {
    const m = details.match(/ligne (\d+)/);
    if (m) return `Ligne ${m[1]} du fichier : la référence interne est déjà prise par un autre article. Aucun article de ce lot n'a été créé.`;
  }
  if (contient(message, 'ligne_fournisseur_existante')) {
    const m = details.match(/ligne (\d+)/);
    if (m) return `Ligne ${m[1]} du fichier : cette référence existe déjà chez ce fournisseur. Aucun article de ce lot n'a été créé.`;
  }
  if (code === '57014' || code === '55P03') return DELAI;
  if (code === '23505' && `${message} ${details}`.includes('catalog_items_import_line_key')) return EN_COURS;
  if (error instanceof TypeError || /Failed to fetch|NetworkError/.test(message)) return RESEAU;
  if (!message) return 'Erreur inconnue';
  for (const cle of Object.keys(MESSAGES)) {
    if (contient(message, cle)) return MESSAGES[cle];
  }
  return message;
}
