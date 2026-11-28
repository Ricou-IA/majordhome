// src/lib/importArticles/controles.js
// Contrôle d'un article, classement des lignes (prête, doublon, écartée) et bilan — module PUR
// (imports relatifs seulement), testé par scripts/import-articles/controles.test.mjs.
// Un doublon avec la base se cherche par index construits une seule fois : jamais de balayage complet par ligne.
// Invariant : lignes lues = importées + doublons écartés + écartées, quel que soit le choix.

import { normaliserArticle } from './normaliser.js';
import { NATURE_ECARTER } from './valeurs.js';
import { cleFournisseur } from './fournisseurs.js';
import { cleEntete } from '../importClients/champs.js';
import { calculerModelKey } from '../catalogue/modelKey.js';

/**
 * Clés, figées et dans cet ordre, d'une ligne envoyée à la base (`org_id` n'y figure jamais : l'entreprise est celle
 * de l'import). `fournisseur` vaut null ou `{ supplier_id, reference, purchase_price_ht, tarif_public, purchase_price_at }`.
 */
export const CLES_ROW_ARTICLE = [
  'import_line', 'name', 'code', 'brand', 'model_key', 'modele_brut', 'code_ean', 'category', 'gamme',
  'product_kind', 'unit', 'default_tva_rate', 'selling_price_ht', 'description', 'ancien_numero', 'fournisseur',
];

const texte = (v) => { const t = String(v ?? '').trim(); return t || null; };
const cle = (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());
const cleMarque = (v) => cle(v).replace(/\s+/g, ' ');

/**
 * Valeur de la correspondance validée pour une valeur brute du fichier.
 * @returns {{ vide: boolean, cible: string }} `cible` vaut '' quand la valeur est inconnue
 */
function interpreter(table, brut) {
  const t = texte(brut);
  if (!t) return { vide: true, cible: '' };
  return { vide: false, cible: (table && table[t]) || '' };
}

/**
 * Transforme les valeurs brutes d'une ligne (sortie d'appliquerCorrespondanceArticles) en fiche prête à écrire.
 * Une valeur illisible ou inconnue est remplacée par la valeur par défaut et sa clé part dans `corrections`.
 * @param {Record<string, string>} valeurs
 * @param {{ valeursInterpretees?: { nature?: object, categorie?: object, unite?: object }, avecFournisseur?: boolean, maintenant?: Date }} options
 * @returns {{ fiche: object|null, raison: 'sans_designation'|'ouvrage'|null, corrections: string[], ligneFournisseur: 'oui'|'sans_prix'|'sans_reference'|'sans_fournisseur'|'non_demandee' }}
 */
export function controlerArticle(valeurs, options = {}) {
  const { valeursInterpretees = {}, avecFournisseur = false, maintenant = new Date() } = options;
  const v = valeurs || {};
  const corrections = [];
  const lire = (champ) => {
    const r = normaliserArticle(champ, v[champ], maintenant);
    if (r.illisible) corrections.push(champ);
    return r.valeur;
  };

  const name = texte(v.designation);
  if (!name) return { fiche: null, raison: 'sans_designation', corrections, ligneFournisseur: 'non_demandee' };

  const nature = interpreter(valeursInterpretees.nature, v.nature);
  if (nature.cible === NATURE_ECARTER) return { fiche: null, raison: 'ouvrage', corrections, ligneFournisseur: 'non_demandee' };
  if (!nature.vide && !nature.cible) corrections.push('nature');
  const categorie = interpreter(valeursInterpretees.categorie, v.categorie);
  if (!categorie.vide && !categorie.cible) corrections.push('categorie');
  const unite = interpreter(valeursInterpretees.unite, v.unite);
  if (!unite.vide && !unite.cible) corrections.push('unite');

  const brand = texte(v.marque);
  const modeleBrut = texte(v.modele);
  const prixAchat = lire('prix_achat');
  const fournisseurNom = texte(v.fournisseur);
  const reference = texte(v.ref_fournisseur);
  const fiche = {
    name,
    code: texte(v.code),
    brand,
    model_key: calculerModelKey(brand, [modeleBrut, name]),
    modele_brut: modeleBrut,
    code_ean: lire('ean'),
    category: categorie.cible || null,
    gamme: texte(v.gamme),
    product_kind: nature.cible || 'main',
    unit: unite.cible || 'pièce',
    default_tva_rate: lire('tva') ?? 20,
    selling_price_ht: lire('prix_vente') ?? 0,
    description: texte(v.description),
    ancien_numero: texte(v.ancien_numero),
    fournisseur: null,
  };

  // Lues dans tous les cas : une valeur illisible se compte même sans ligne fournisseur demandée.
  const tarifPublic = lire('prix_public');
  const datePrix = lire('date_prix');
  let ligneFournisseur = 'non_demandee';
  if (avecFournisseur) {
    if (!fournisseurNom) ligneFournisseur = 'sans_fournisseur';
    else if (!reference) ligneFournisseur = 'sans_reference';
    else if (!(prixAchat > 0)) ligneFournisseur = 'sans_prix';
    else {
      ligneFournisseur = 'oui';
      fiche.fournisseur = { nom: fournisseurNom, reference, purchase_price_ht: prixAchat, tarif_public: tarifPublic ?? null, purchase_price_at: datePrix ?? null };
    }
  }
  return { fiche, raison: null, corrections, ligneFournisseur };
}

/** Index des articles existants : code, EAN, marque + clé modèle, désignation (articles sans marque seulement), lignes fournisseur. */
function indexerExistants(existant) {
  const code = new Map(); const ean = new Map(); const modele = new Map(); const designation = new Map(); const lignes = new Set();
  for (const a of existant?.articles || []) {
    if (!code.has(cle(a.code)) && cle(a.code)) code.set(cle(a.code), a.id);
    if (a.code_ean && !ean.has(a.code_ean)) ean.set(a.code_ean, a.id);
    if (cle(a.brand) && a.model_key) { const k = `${cleMarque(a.brand)}|${a.model_key}`; if (!modele.has(k)) modele.set(k, a.id); }
    const d = cleEntete(a.name);
    if (d) {
      if (!designation.has(d)) designation.set(d, []);
      designation.get(d).push({ id: a.id, brand: cleMarque(a.brand), kind: a.product_kind });
    }
  }
  for (const l of existant?.lignes || []) if (cle(l.reference)) lignes.add(`${l.supplier_id}|${cle(l.reference)}`);
  return { code, ean, modele, designation, lignes };
}

/**
 * Classe chaque candidat : prête, doublon (fichier, base forte ou faible) ou écartée. La première ligne du fichier gagne ;
 * puis les doublons avec la base : code, EAN, marque + modèle, ligne fournisseur (forts), désignation (faible).
 * @param {Array<{ numero: number, valeurs: Record<string, string> }>} candidats dans l'ordre du fichier
 * @param {{ articles: Array<{ id: string, code: string|null, code_ean: string|null, brand: string|null, model_key: string|null, name: string }>, lignes: Array<{ supplier_id: string, reference: string }> }} existant
 * @param {{ valeursInterpretees?: object, avecFournisseur?: boolean, maintenant?: Date, fournisseursResolus?: Record<string, string> }} [options]
 *   `fournisseursResolus` : `cleFournisseur(nom)` → supplier_id ; un fournisseur absent (à créer) n'a encore aucune ligne.
 * @returns {Array<{ numero: number, fiche: object|null, raison: string|null, corrections: string[], ligneFournisseur: string, doublon: null | { force: 'fort'|'faible', motif: string, articleId?: string }, recochable: boolean }>}
 */
export function classerArticles(candidats, existant, options = {}) {
  if (!existant || !Array.isArray(existant.articles) || !Array.isArray(existant.lignes)) {
    throw new Error('Liste des articles existants inconnue : classement impossible.');
  }
  const index = indexerExistants(existant);
  const resolus = options.fournisseursResolus || {};
  const dansFichier = { designation: new Set(), code: new Set(), ean: new Set(), modele: new Set(), ligne: new Set() };
  return candidats.map(({ numero, valeurs }) => {
    const c = controlerArticle(valeurs, options);
    const base = { numero, fiche: c.fiche, raison: c.raison, corrections: c.corrections, ligneFournisseur: c.ligneFournisseur };
    const pas = { ...base, ligneExistante: false, doublon: null, recochable: false };
    if (!c.fiche) return pas;
    const f = c.fiche;
    const kCode = cle(f.code);
    const kDesignation = cleEntete(f.name);
    const kModele = cleMarque(f.brand) && f.model_key ? `${cleMarque(f.brand)}|${f.model_key}` : '';
    const supplierId = f.fournisseur ? resolus[cleFournisseur(f.fournisseur.nom)] : null;
    const kLigne = f.fournisseur ? `${supplierId || `nom:${cleFournisseur(f.fournisseur.nom)}`}|${cle(f.fournisseur.reference)}` : '';

    // La ligne fournisseur existe-t-elle déjà en base ? Indépendant du motif de doublon retenu plus bas.
    const ligneExistante = Boolean(supplierId && f.fournisseur && index.lignes.has(`${supplierId}|${cle(f.fournisseur.reference)}`));

    // Doublon dans le fichier : testé avant la base (la première ligne gagne).
    let doublon = null; let recochable = true;
    if (kCode && dansFichier.code.has(kCode)) { doublon = { force: 'fort', motif: 'fichier_code' }; recochable = false; }
    else if ((kDesignation && dansFichier.designation.has(`${kDesignation}|${f.product_kind}|${cleMarque(f.brand)}`)) || (f.code_ean && dansFichier.ean.has(f.code_ean)) || (kModele && dansFichier.modele.has(kModele)) || (kLigne && dansFichier.ligne.has(kLigne))) {
      doublon = { force: 'fort', motif: 'fichier' };
    } else if (kCode && index.code.has(kCode)) {
      doublon = { force: 'fort', motif: 'code', articleId: index.code.get(kCode) }; recochable = false;
    } else if (f.code_ean && index.ean.has(f.code_ean)) {
      doublon = { force: 'fort', motif: 'ean', articleId: index.ean.get(f.code_ean) };
    } else if (kModele && index.modele.has(kModele)) {
      doublon = { force: 'fort', motif: 'marque_modele', articleId: index.modele.get(kModele) };
    } else if (ligneExistante) {
      doublon = { force: 'fort', motif: 'ligne_fournisseur' };
    } else {
      // Même désignation et même nature : fort si la marque est identique (ou absente des deux côtés), sinon faible.
      const memes = (index.designation.get(kDesignation) || []).filter((a) => a.kind === f.product_kind);
      const fort = memes.find((a) => a.brand === cleMarque(f.brand));
      if (fort) doublon = { force: 'fort', motif: 'designation', articleId: fort.id };
      else if (memes.length) doublon = { force: 'faible', motif: 'designation', articleId: memes[0].id };
    }

    if (kDesignation) dansFichier.designation.add(`${kDesignation}|${f.product_kind}|${cleMarque(f.brand)}`);
    if (kCode) dansFichier.code.add(kCode);
    if (f.code_ean) dansFichier.ean.add(f.code_ean);
    if (kModele) dansFichier.modele.add(kModele);
    if (kLigne) dansFichier.ligne.add(kLigne);
    return { ...base, ligneExistante, doublon, recochable: doublon ? recochable : false };
  });
}

/**
 * Une ligne est-elle écrite, compte tenu des choix ? Écartée ou doublon non recochable : jamais. Doublon fort : écarté
 * par défaut, repris si `choix[numero] === true`. Doublon faible : repris par défaut, écarté si `choix[numero] === false`.
 * @param {{ numero: number, fiche: object|null, doublon: null|{ force: string }, recochable: boolean }} classee
 * @param {Record<number, boolean>} choix
 * @returns {boolean}
 */
export function aImporter(classee, choix) {
  if (!classee.fiche) return false;
  if (!classee.doublon) return true;
  if (!classee.recochable) return false;
  const c = choix?.[classee.numero];
  if (classee.doublon.force === 'faible') return c !== false;
  return c === true;
}

/**
 * Même choix pour tous les doublons recochables d'un coup ; les doublons non recochables et les autres lignes ne bougent pas.
 * @param {Array<{ numero: number, doublon: null|object, recochable: boolean }>} classees
 * @param {Record<number, boolean>} choix
 * @param {boolean} reprendre vrai = tous repris, faux = tous écartés
 * @returns {Record<number, boolean>}
 */
export function choixPourTousLesDoublons(classees, choix, reprendre) {
  const suite = { ...choix };
  for (const c of classees) if (c.doublon && c.recochable) suite[c.numero] = reprendre;
  return suite;
}

/** Faut-il envoyer la ligne fournisseur de cette ligne ? (jamais pour une ligne fournisseur déjà en base) */
const aLigneFournisseur = (c) => c.ligneFournisseur === 'oui' && !c.ligneExistante;

/**
 * Bilan affiché à l'écran : importées + doublons écartés + écartées = lues, toujours.
 * `lignesFournisseur` : lignes fournisseur que les articles importés créeront (avant résolution des fournisseurs « à créer » décochés).
 * @param {Array<object>} classees
 * @param {Record<number, boolean>} choix
 * @returns {{ lues: number, importees: number, doublons: number, ecartees: number, lignesFournisseur: number }}
 */
export function bilan(classees, choix) {
  const lues = classees.length;
  const ecartees = classees.filter((c) => !c.fiche).length;
  const retenues = classees.filter((c) => aImporter(c, choix));
  // Comptés directement (jamais par différence) : une ligne perdue ou comptée deux fois rompt l'égalité.
  const doublons = classees.filter((c) => c.fiche && c.doublon && !aImporter(c, choix)).length;
  return {
    lues,
    importees: retenues.length,
    ecartees,
    doublons,
    lignesFournisseur: retenues.filter(aLigneFournisseur).length,
  };
}

/**
 * Lignes à envoyer à l'écriture (clés de `CLES_ROW_ARTICLE`, jamais d'organisation). Une ligne fournisseur n'est envoyée
 * que si son fournisseur est résolu (existant ou créé), qu'elle n'existe pas déjà en base et qu'elle n'a pas déjà
 * été envoyée plus haut : un article repris malgré une ligne fournisseur existante part sans `fournisseur`.
 * @param {Array<object>} classees
 * @param {Record<number, boolean>} choix
 * @param {Record<string, string>} fournisseursResolus `cleFournisseur(nom)` → supplier_id
 * @returns {Array<Record<string, unknown>>}
 */
export function lignesPourEcriture(classees, choix, fournisseursResolus = {}) {
  const envoyees = new Set();
  return classees.filter((c) => aImporter(c, choix)).map((c) => {
    const f = c.fiche;
    let fournisseur = null;
    const supplierId = f.fournisseur ? fournisseursResolus[cleFournisseur(f.fournisseur.nom)] : null;
    if (supplierId && aLigneFournisseur(c)) {
      const k = `${supplierId}|${cle(f.fournisseur.reference)}`;
      if (!envoyees.has(k)) {
        envoyees.add(k);
        fournisseur = {
          supplier_id: supplierId, reference: f.fournisseur.reference, purchase_price_ht: f.fournisseur.purchase_price_ht,
          tarif_public: f.fournisseur.tarif_public, purchase_price_at: f.fournisseur.purchase_price_at,
        };
      }
    }
    const ligne = { import_line: c.numero, ...f, fournisseur };
    return Object.fromEntries(CLES_ROW_ARTICLE.map((k) => [k, ligne[k] ?? null]));
  });
}
