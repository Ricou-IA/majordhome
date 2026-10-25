// src/lib/catalogue/offreRapprochement.js
// Offre fournisseur importée → articles Majord'home et lignes de devis — module PUR (front seulement), testé
// scripts/catalogue/offre-fournisseur.test.mjs. Demande d'Eric (2026-10-25) : chaque ligne de l'offre est rapprochée
// d'un article existant (même fournisseur + même référence, sinon suggestions.js), ou proposée en création ; il
// valide ligne par ligne, puis le devis est prérempli — lignes rangées dans les chapitres selon la nature de
// l'article, prix d'achat = prix de l'offre, prix de vente = celui de l'article s'il existe.

import { comparerReferences, scorerCandidat } from './suggestions.js';
import { calculerModelKey } from './modelKey.js';
import { referenceLigne, uniteDepuisOffre, nombreFr } from './offreFournisseur.js';

const cle = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Fournisseur de l'org qui correspond au nom lu dans l'offre (« TEREVA - ALBI » ⇒ TEREVA) : nom identique, sinon
 * l'un contient l'autre ; plusieurs candidats ⇒ null (on ne devine pas, l'écran fait choisir).
 * @param {string|null|undefined} nom
 * @param {Array<{ id: string, name: string, is_active?: boolean }>} fournisseurs
 * @returns {{ id: string, name: string } | null}
 */
export function fournisseurDeLOffre(nom, fournisseurs) {
  const n = cle(nom);
  if (!n) return null;
  const actifs = (fournisseurs || []).filter((f) => f && f.is_active !== false && cle(f.name));
  const exact = actifs.filter((f) => cle(f.name) === n);
  if (exact.length === 1) return exact[0];
  const proches = actifs.filter((f) => { const c = cle(f.name); return c.length >= 3 && (n.includes(c) || c.includes(n)); });
  return proches.length === 1 ? proches[0] : null;
}

/**
 * L'offre vue comme un « article » pour scorerCandidat : libellé, marque, clé modèle, ses références.
 * @param {Record<string, any>} l ligne lue
 */
function ligneCommeArticle(l) {
  return {
    name: l.designation, brand: l.marque || null,
    model_key: calculerModelKey(l.marque || null, [l.ref_fabricant]),
    references: [l.ref_fabricant, l.code].filter(Boolean),
    // un prix au mètre ou au lot ne se compare pas au prix d'un article vendu à la couronne ou à la pièce
    prix: uniteDepuisOffre(l.unite) === 'pièce' ? nombreFr(l.prix_unitaire_net) : null,
  };
}

/** Score minimal d'une suggestion affichée : plus bas que suggestions.js (2,5), une suggestion n'étant jamais choisie d'office. */
const SEUIL_SUGGESTION = 1.5;

/**
 * Rapprochement d'une ligne de l'offre.
 *   - `meme_reference` : le fournisseur a déjà cette référence dans son catalogue (produit), avec son article s'il en a un ;
 *   - `reference_fabricant` : un article de l'org porte la même référence fabricant (suggestion forte) ;
 *   - `a_creer` : rien de sûr ; `suggestions` classées (suggestions.js) pour un rattachement à la main.
 * @param {Record<string, any>} ligne ligne lue (lireOffre)
 * @param {{ produits: Array<{ id: string, reference: string, catalog_item_id?: string|null }>,
 *   candidats: Array<{ article: Record<string, any>, references?: string[] }>, articlesParId: Map<string, Record<string, any>> }} ctx
 *   `produits` = lignes du catalogue du fournisseur choisi aux références de l'offre ; `candidats` = articles de l'org
 *   trouvés par la recherche, avec les références de leurs lignes fournisseur.
 * @returns {{ statut: 'meme_reference'|'reference_fabricant'|'a_creer', produit: object|null, article: object|null,
 *   suggestions: Array<{ article: object, score: number, raisons: string[] }> }}
 */
export function rapprocherLigne(ligne, { produits = [], candidats = [], articlesParId = new Map() } = {}) {
  const ref = cle(ligne.code) || cle(ligne.ref_fabricant);
  const produit = ref ? (produits.find((p) => cle(p.reference) === ref) || null) : null;
  const offre = ligneCommeArticle(ligne);
  const suggestions = [];
  for (const c of candidats) {
    if (!c?.article?.id) continue;
    const refsCandidat = [...(c.references || []), c.article.model_key].filter(Boolean);
    // la référence du candidat qui ressemble le plus à une référence de l'offre (sinon la première)
    const refProche = refsCandidat.find((r) => offre.references.some((o) => comparerReferences(o, r) === 'identique'))
      || refsCandidat.find((r) => offre.references.some((o) => comparerReferences(o, r)))
      || refsCandidat[0] || null;
    const { score, raisons } = scorerCandidat(offre, {
      name: c.article.name, brand: c.article.brand, reference: refProche, model_key: c.article.model_key,
      purchase_price_ht: c.article.meilleur_prix_achat,
    });
    if (score >= SEUIL_SUGGESTION) suggestions.push({ article: c.article, score, raisons });
  }
  suggestions.sort((a, b) => b.score - a.score || String(a.article.name).localeCompare(String(b.article.name), 'fr'));
  const top = suggestions.slice(0, 4);

  if (produit) {
    const article = produit.catalog_item_id ? (articlesParId.get(produit.catalog_item_id) || null) : null;
    return { statut: 'meme_reference', produit, article, suggestions: top.filter((s) => s.article.id !== article?.id) };
  }
  const forte = top.find((s) => s.raisons.includes('même référence fabricant'));
  if (forte) return { statut: 'reference_fabricant', produit: null, article: forte.article, suggestions: top.filter((s) => s !== forte) };
  return { statut: 'a_creer', produit: null, article: null, suggestions: top };
}

/**
 * Choix proposé d'office dans l'écran de validation du devis : l'article reconnu, sinon créer l'article (admin, avec
 * un fournisseur choisi), sinon une ligne libre au prix de l'offre.
 * @param {ReturnType<typeof rapprocherLigne>} r
 * @param {{ peutCreer: boolean }} opts
 * @returns {{ type: 'article', itemId: string } | { type: 'creer' } | { type: 'libre' }}
 */
export function choixParDefaut(r, { peutCreer }) {
  if (r?.article?.id) return { type: 'article', itemId: r.article.id };
  return peutCreer ? { type: 'creer' } : { type: 'libre' };
}

/**
 * Action proposée sur le catalogue du fournisseur (import depuis la fiche fournisseur) :
 *   - `creer` : référence absente du catalogue ;
 *   - `maj` : prix d'achat changé ; décochée d'office si le prix connu est PLUS RÉCENT que l'offre ;
 *   - `identique` : même prix, rien à écrire (décochée).
 * @param {Record<string, any>} ligne
 * @param {{ purchase_price_ht?: number|string|null, purchase_price_at?: string|null, is_active?: boolean } | null} produit
 * @param {string|null} dateOffre AAAA-MM-JJ
 * @returns {{ action: 'creer'|'maj'|'identique', coche: boolean, ancien: number|null, nouveau: number|null, avertissement: string|null }}
 */
export function actionCatalogue(ligne, produit, dateOffre) {
  const nouveau = nombreFr(ligne?.prix_unitaire_net);
  if (!produit) return { action: 'creer', coche: nouveau > 0, ancien: null, nouveau, avertissement: nouveau > 0 ? null : 'pas de prix lu' };
  const ancien = nombreFr(produit.purchase_price_ht);
  const desactive = produit.is_active === false ? 'article supprimé du catalogue : le prix sera mis à jour mais il restera supprimé' : null;
  if (ancien != null && nouveau != null && Math.abs(ancien - nouveau) < 0.005) {
    return { action: 'identique', coche: false, ancien, nouveau, avertissement: desactive };
  }
  const connuLe = produit.purchase_price_at ? String(produit.purchase_price_at).slice(0, 10) : null;
  const plusRecent = !!(connuLe && dateOffre && connuLe > dateOffre);
  return {
    action: 'maj', coche: nouveau > 0 && !plusRecent, ancien, nouveau,
    avertissement: plusRecent ? `prix actuel du ${connuLe.split('-').reverse().join('/')}, plus récent que l'offre` : desactive,
  };
}

/**
 * Ce qu'un import d'offre DANS UN DEVIS enregistre au catalogue du fournisseur (retour d'Eric 2026-10-25 : « l'offre
 * fournisseur est un prix d'achat, c'est important pour le listing produit »). Chaque ligne incluse et rapprochée
 * (article reconnu, suggestion choisie ou article à créer) écrit sa référence et son prix d'achat chez le fournisseur ;
 * la ligne qui n'existait pas encore chez lui est rattachée à l'article choisi (l'article gagne l'offre). Une ligne
 * déjà connue n'est jamais déplacée d'article depuis un devis. Restent hors catalogue : la ligne libre (choix explicite),
 * la ligne sans référence ou sans prix, le prix inchangé et le prix connu plus récent que l'offre (actionCatalogue).
 * @param {Array<{ ligne: Record<string, any>, rap: ReturnType<typeof rapprocherLigne>, choix: { type: string, itemId?: string }, nature: string }>} rows lignes incluses
 * @param {string|null} dateOffre AAAA-MM-JJ
 * @returns {{ aEcrire: Array<{ ligne: Record<string, any>, nature: string }>, aRattacher: Array<{ reference: string, itemId: string }>,
 *   ignorees: Array<{ ligne: Record<string, any>, raison: string }> }}
 */
export function planCatalogueDevis(rows, dateOffre) {
  const aEcrire = [];
  const aRattacher = [];
  const ignorees = [];
  for (const r of rows || []) {
    const reference = referenceLigne(r.ligne);
    if (r.choix?.type === 'libre') { ignorees.push({ ligne: r.ligne, raison: 'ligne libre' }); continue; }
    if (!reference || !(nombreFr(r.ligne.prix_unitaire_net) > 0)) { ignorees.push({ ligne: r.ligne, raison: 'sans référence ou sans prix' }); continue; }
    const a = actionCatalogue(r.ligne, r.rap?.produit || null, dateOffre);
    if (a.action === 'identique') { ignorees.push({ ligne: r.ligne, raison: 'prix inchangé' }); continue; }
    if (!a.coche) { ignorees.push({ ligne: r.ligne, raison: a.avertissement || 'prix non retenu' }); continue; }
    aEcrire.push({ ligne: r.ligne, nature: r.nature });
    if (r.choix?.type === 'article' && r.choix.itemId && !r.rap?.produit) aRattacher.push({ reference, itemId: r.choix.itemId });
  }
  return { aEcrire, aRattacher, ignorees };
}

// ---------------------------------------------------------------------------------------------------------------
// Lignes de devis et chapitres
// ---------------------------------------------------------------------------------------------------------------

/** Type de chapitre (devisConfig.TYPES_CHAPITRE) où ranger un article d'une nature donnée. */
export const TYPE_PAR_NATURE = Object.freeze({
  main: 'equipement', accessory: 'option', consumable: 'option', stock: 'stock', main_oeuvre: 'main_oeuvre',
});
/** Chapitres acceptables, dans l'ordre, quand le devis n'a pas de chapitre du type voulu. */
const SECOURS = Object.freeze({
  equipement: ['equipement', 'libre', 'option'],
  option: ['option', 'libre', 'equipement'],
  stock: ['stock', 'option', 'libre'],
  main_oeuvre: ['main_oeuvre', 'libre'],
});

/**
 * Ligne de devis depuis une ligne de l'offre. Prix d'achat = prix net de l'offre (éco-participation exclue, comme au
 * catalogue) ; prix de vente = celui de l'article s'il existe, sinon 0 (« à chiffrer ») ; libellé de l'article s'il
 * existe, sinon celui de l'offre (ligne libre).
 * @param {Record<string, any>} ligne
 * @param {{ article?: Record<string, any>|null, produit?: { id: string }|null, fournisseur?: { id: string, name: string }|null, tva: number }} opts
 * @returns {Record<string, any>}
 */
export function ligneDevisDepuisOffre(ligne, { article = null, produit = null, fournisseur = null, tva }) {
  const pu = nombreFr(ligne.prix_unitaire_net);
  return {
    line_type: 'product',
    catalog_item_id: article?.id ?? null,
    is_freeform: !article?.id,
    brand: null,
    supplier_product_id: produit?.id ?? null,
    supplier_id: fournisseur?.id ?? null,
    supplier_name: fournisseur?.name ?? null,
    designation: article?.name || ligne.designation,
    description: '',
    reference: referenceLigne(ligne) || '',
    quantity: nombreFr(ligne.quantite) > 0 ? nombreFr(ligne.quantite) : 1,
    unit: article?.unit && article.unit !== 'pièce' ? article.unit : uniteDepuisOffre(ligne.unite),
    purchase_price_ht: pu != null ? Math.round(pu * 10000) / 10000 : null,
    unit_price_ht: Number(article?.selling_price_ht) || 0,
    tva_rate: Number(tva),
  };
}

/**
 * Insère des lignes dans les chapitres du devis selon leur nature : premier chapitre du type voulu (sinon du type de
 * secours), après sa dernière ligne, dans l'ordre de l'offre. Sans chapitre acceptable, un chapitre `titreSecours`
 * est ajouté en fin de devis pour ces lignes. Les lignes existantes ne bougent pas.
 * @param {Array<Record<string, any>>} lines lignes du devis (titres de chapitre compris)
 * @param {Array<{ line: Record<string, any>, nature: string }>} nouvelles
 * @param {{ typeDe: (titre: string) => string, titreSecours: string }} opts
 * @returns {Array<Record<string, any>>}
 */
export function insererLignesOffre(lines, nouvelles, { typeDe, titreSecours }) {
  const sections = [];
  (lines || []).forEach((l, i) => { if (l.line_type === 'section_title') sections.push({ index: i, type: typeDe(l.designation) }); });
  const parSection = new Map(); // index du titre → lignes
  const orphelines = [];
  for (const { line, nature } of nouvelles || []) {
    const voulu = TYPE_PAR_NATURE[nature] || 'option';
    let cible = null;
    for (const t of SECOURS[voulu] || [voulu]) {
      cible = sections.find((s) => s.type === t) || null;
      if (cible) break;
    }
    if (!cible) { orphelines.push(line); continue; }
    if (!parSection.has(cible.index)) parSection.set(cible.index, []);
    parSection.get(cible.index).push(line);
  }
  const result = [...(lines || [])];
  // de la dernière section à la première : les index des sections précédentes restent valables
  for (const idx of [...parSection.keys()].sort((a, b) => b - a)) {
    let fin = idx + 1;
    while (fin < result.length && result[fin].line_type !== 'section_title') fin += 1;
    result.splice(fin, 0, ...parSection.get(idx));
  }
  if (orphelines.length) {
    result.push({ line_type: 'section_title', designation: titreSecours, quantity: 0, unit_price_ht: 0, tva_rate: 0 }, ...orphelines);
  }
  return result;
}
