// src/lib/catalogue/nomenclature.js
// Règles PURES du bloc « Pièces détachées » (fiche équipement, fiche SAV) : filtre par repère, mentions d'une
// pièce, prix, lignes de devis, classement des modèles fabricant proposés pour un équipement. Aucun import React /
// Supabase. Testé dans scripts/catalogue/nomenclature-pieces.test.mjs. Spec :
// docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md § 4, § 5.6.
//
// Une « ligne » est une ligne de la vue majordhome_equipment_model_parts : repere, quantity, notes, piece_reference,
// piece_name, prix_public_ht (prix sur CET appareil), selling_price_ht, purchase_price_ht, taux_remise, unit,
// catalog_item_id, piece_active, cycle_de_vie, remplacee_par, kit, vendue_seule, prix_selon_appareil.

/** Clé de comparaison d'un texte : minuscules, sans accents, lettres et chiffres seulement. */
export function cle(texte) {
  return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Repères saisis (« 12, 30 » ou « 12 30 ») → liste. Le site écrit parfois un repère en plage (« 7-14 ») : un
 * repère saisi à l'intérieur de la plage la retrouve.
 * @param {string} saisie
 * @returns {string[]}
 */
export function reperesSaisis(saisie) {
  return String(saisie || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function repereCorrespond(repere, cherche) {
  const r = String(repere || '').trim().toLowerCase();
  if (!r) return false;
  if (r === cherche) return true;
  const plage = r.match(/^(\d+)\s*-\s*(\d+)$/);
  if (plage && /^\d+$/.test(cherche)) {
    const n = Number(cherche);
    return n >= Number(plage[1]) && n <= Number(plage[2]);
  }
  return false;
}

/**
 * Lignes de nomenclature dans l'ordre des repères (1, 2, 10, 17… puis les repères non numériques, puis les lignes
 * sans repère) : le site les rend dans un ordre quelconque. Une plage « 7-14 » se range à 7. L'ordre d'origine est
 * gardé entre deux lignes de même repère (variantes d'une même pièce).
 * @param {object[]} lignes
 * @returns {object[]}
 */
export function trierParRepere(lignes) {
  const rang = (l) => {
    const r = String(l?.repere || '').trim();
    if (!r) return [2, 0, ''];
    const m = r.match(/^(\d+)/);
    return m ? [0, Number(m[1]), r.toLowerCase()] : [1, 0, r.toLowerCase()];
  };
  return (lignes || []).map((l, i) => ({ l, i, k: rang(l) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2].localeCompare(b.k[2], 'fr') || a.i - b.i)
    .map((x) => x.l);
}

/**
 * Lignes de nomenclature dont le repère est l'un des repères saisis ; saisie vide = toutes.
 * @param {object[]} lignes
 * @param {string} saisie
 * @returns {object[]}
 */
export function filtrerParReperes(lignes, saisie) {
  const cherches = reperesSaisis(saisie);
  if (!cherches.length) return lignes || [];
  return (lignes || []).filter((l) => cherches.some((c) => repereCorrespond(l.repere, c)));
}

/**
 * Mentions à afficher à côté d'une pièce (texte, jamais la couleur seule). `ton` : 'alerte' (à savoir avant de
 * commander) ou 'info'.
 * @param {object} ligne
 * @returns {Array<{ cle: string, texte: string, ton: 'alerte'|'info' }>}
 */
export function mentionsPiece(ligne) {
  const m = [];
  if (!ligne) return m;
  if (ligne.cycle_de_vie === 'arretee') m.push({ cle: 'arretee', texte: 'Arrêtée', ton: 'alerte' });
  if (ligne.cycle_de_vie === 'fin_de_stock') m.push({ cle: 'fin_de_stock', texte: 'Fin de stock', ton: 'alerte' });
  if (ligne.remplacee_par) m.push({ cle: 'remplacee', texte: `Remplacée par ${ligne.remplacee_par}`, ton: 'alerte' });
  if (ligne.piece_active === false) m.push({ cle: 'absente', texte: 'Absente du dernier relevé', ton: 'alerte' });
  if (ligne.vendue_seule === false) m.push({ cle: 'non_vendue', texte: 'Non vendue seule', ton: 'alerte' });
  if (ligne.kit) m.push({ cle: 'kit', texte: 'Kit', ton: 'info' });
  return m;
}

const nombre = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const centime = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Prix PUBLIC HT d'une pièce sur cet appareil (colonne du tableau) ; `null` = non communiqué par le fabricant.
 * @param {object} ligne
 * @returns {number|null}
 */
export function prixPublicPiece(ligne) {
  const p = nombre(ligne?.prix_public_ht);
  return p != null && p > 0 ? p : null;
}

/**
 * Prix de vente HT d'une pièce sur cet appareil : pour une pièce à prix unique, le prix de vente de l'ARTICLE, sinon
 * celui de la ligne fournisseur ; à défaut (ou pièce dont le prix dépend de l'appareil) le prix public de la ligne ;
 * `null` = pas de prix connu (à chiffrer).
 * @param {object} ligne
 * @returns {number|null}
 */
export function prixVentePiece(ligne) {
  if (!ligne?.prix_selon_appareil) {
    // l'article d'abord (prix ajusté dans la fiche article, celui que pose la recherche d'articles du devis)
    const article = ligne?.catalog_item_id ? nombre(ligne?.article_selling_price_ht) : null;
    if (article != null && article > 0) return article;
    const vente = nombre(ligne?.selling_price_ht);
    if (vente != null && vente > 0) return vente;
  }
  return prixPublicPiece(ligne);
}

/**
 * Prix d'achat HT estimé (marge du devis) : celui du catalogue, sinon le prix public de la ligne moins la remise
 * du fournisseur (pièce dont le prix dépend de l'appareil) ; `null` si rien n'est connu (prix public ou remise).
 * @param {object} ligne
 * @returns {number|null}
 */
export function prixAchatPiece(ligne) {
  const achat = nombre(ligne?.purchase_price_ht);
  if (!ligne?.prix_selon_appareil && achat != null && achat > 0) return achat;
  const publicHt = nombre(ligne?.prix_public_ht);
  if (publicHt == null || publicHt <= 0) return null;
  const remise = nombre(ligne?.taux_remise);
  if (remise == null) return null; // remise inconnue : pas de prix d'achat, plutôt qu'une marge de 0 % inventée
  return centime(publicHt * (1 - Math.min(Math.max(remise, 0), 99.99) / 100));
}

/**
 * Ligne de devis d'une pièce choisie dans la nomenclature. Une pièce sans article (prix selon l'appareil, pièce
 * sans prix) part en ligne libre ; la référence est toujours celle du fabricant (celle qu'on commande).
 * @param {object} ligne ligne de nomenclature
 * @param {number} quantite
 * @param {number} tva taux de TVA du devis
 * @returns {object}
 */
export function ligneDevisDepuisPiece(ligne, quantite, tva) {
  const q = Number(quantite) > 0 ? Number(quantite) : 1;
  return {
    line_type: 'product',
    catalog_item_id: ligne.catalog_item_id || null,
    is_freeform: !ligne.catalog_item_id,
    brand: null,
    supplier_product_id: null,
    supplier_id: null,
    supplier_name: null,
    designation: ligne.piece_name || ligne.piece_reference || 'Pièce détachée',
    description: '',
    reference: ligne.piece_reference || '',
    quantity: q,
    unit: ligne.unit || 'pièce',
    purchase_price_ht: prixAchatPiece(ligne),
    unit_price_ht: prixVentePiece(ligne) ?? 0,
    tva_rate: Number(tva),
    show_specs: false,
    caracteristiques: [],
  };
}

/**
 * Lignes initiales d'un devis : les chapitres par défaut de la famille, avec les pièces rangées sous le chapitre
 * « PIÈCES » (le premier dont le titre contient « pièce », sinon le premier chapitre, sinon aucune section).
 * @param {object[]} sections lignes `section_title` de la famille (buildDefaultSections)
 * @param {Array<{ ligne: object, quantite: number }>} choix
 * @param {number} tva
 * @returns {object[]}
 */
export function lignesDevisAvecPieces(sections, choix, tva) {
  const pieces = (choix || []).map((c) => ligneDevisDepuisPiece(c.ligne, c.quantite, tva));
  const titres = (sections || []).filter((s) => s && s.line_type === 'section_title');
  if (!titres.length) return pieces;
  let cible = titres.findIndex((s) => cle(s.designation).includes('piece'));
  if (cible < 0) cible = 0;
  const out = [];
  titres.forEach((s, i) => { out.push(s); if (i === cible) out.push(...pieces); });
  return out;
}

/**
 * Modèles fabricant proposés pour un équipement, du plus probable au moins probable. Jamais un choix d'office :
 * c'est une liste à présenter. Score : référence fabricant saisie telle quelle (100), nom de modèle identique (80),
 * l'un contient l'autre (50), premier mot commun (30) ; à égalité, les modèles en vente d'abord puis l'ordre
 * alphabétique.
 * @param {object[]} modeles lignes de majordhome_equipment_models
 * @param {{ model?: string|null }} equipement
 * @returns {Array<{ modele: object, score: number }>}
 */
export function classerModeles(modeles, equipement) {
  const saisi = cle(equipement?.model);
  const premierMot = cle(String(equipement?.model || '').trim().split(/\s+/)[0]);
  const classes = (modeles || []).map((modele) => {
    const ref = cle(modele.reference);
    const nom = cle(modele.model_name || modele.name);
    let score = 0;
    if (saisi) {
      if (ref && (ref === saisi || ref === `p${saisi}` || (ref.length >= 5 && saisi.includes(ref)))) score = 100;
      else if (nom && nom === saisi) score = 80;
      else if (nom && saisi.length >= 3 && (nom.includes(saisi) || (nom.length >= 3 && saisi.includes(nom)))) score = 50;
      else if (premierMot.length >= 3 && cle(String(modele.model_name || '').trim().split(/\s+/)[0]) === premierMot) score = 30;
    }
    return { modele, score };
  });
  return classes.sort((a, b) => b.score - a.score
    || Number(b.modele.is_active !== false) - Number(a.modele.is_active !== false)
    || String(a.modele.name || '').localeCompare(String(b.modele.name || ''), 'fr'));
}

/**
 * Filtre de la liste du sélecteur : chaque mot saisi doit se trouver dans le nom ou la référence du modèle.
 * @param {object[]} modeles
 * @param {string} recherche
 * @returns {object[]}
 */
export function filtrerModeles(modeles, recherche) {
  const mots = String(recherche || '').split(/\s+/).map(cle).filter(Boolean);
  if (!mots.length) return modeles || [];
  return (modeles || []).filter((m) => { const t = cle(`${m.name} ${m.reference} ${m.model_name}`); return mots.every((mot) => t.includes(mot)); });
}

const ORDRE_DOCUMENTS = { notice: 0, fiche_technique: 1, vue_eclatee: 2, autre: 3, procedure: 4 };

/**
 * Documents d'un modèle rangés pour l'affichage : notice, fiche technique, vue éclatée, autres d'abord (`principaux`),
 * procédures à part (`procedures` — un poêle à granulés en porte une dizaine : mise en service, dépannage de la
 * carte, kit Wi-Fi…). L'ordre d'origine est gardé à l'intérieur d'un même type.
 * @param {object[]} docs
 * @returns {{ principaux: object[], procedures: object[] }}
 */
export function rangerDocumentsModele(docs) {
  const tries = (docs || []).map((d, i) => ({ d, i }))
    .sort((a, b) => (ORDRE_DOCUMENTS[a.d.document_type] ?? 3) - (ORDRE_DOCUMENTS[b.d.document_type] ?? 3) || a.i - b.i)
    .map((x) => x.d);
  return { principaux: tries.filter((d) => d.document_type !== 'procedure'), procedures: tries.filter((d) => d.document_type === 'procedure') };
}

/**
 * Titre d'un document du modèle : son libellé, sauf libellé générique du site (« datasheet », « Notice ») remplacé
 * par le nom du type.
 * @param {object} doc
 * @param {(type: string) => string} libelleType
 * @returns {string}
 */
export function titreDocumentModele(doc, libelleType) {
  const label = String(doc?.label || '').trim();
  if (!label || /^(datasheet|notice|fiche technique)$/i.test(label)) return libelleType(doc?.document_type);
  return label;
}
