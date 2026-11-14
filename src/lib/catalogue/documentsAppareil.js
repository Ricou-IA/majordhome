/**
 * documentsAppareil.js — Règles pures du lecteur de documents d'un appareil (mode atelier, fiches).
 * ============================================================================
 * Aucun import React / Supabase / alias. La nature d'un fichier (PDF, image, autre) et la liste des onglets
 * proposés à l'atelier (vues éclatées d'abord, puis notice / fiche technique / autres, procédures en dernier)
 * se décident ici, jamais dans un composant.
 * ============================================================================
 */

import { rangerDocumentsModele, titreDocumentModele } from './nomenclature.js';

const LIBELLES_TYPE = { notice: 'Notice technique', fiche_technique: 'Fiche technique', procedure: 'Procédure' };
const TYPES_ONGLET = new Set(['notice', 'fiche_technique', 'procedure']);

/**
 * Nature d'un fichier d'après son type MIME, sinon son nom ou son chemin.
 * @param {{ mime_type?: string, file_name?: string, storage_path?: string }} doc
 * @returns {'pdf'|'image'|'autre'}
 */
export function natureDocument(doc) {
  const mime = String(doc?.mime_type || '').toLowerCase();
  const nom = String(doc?.file_name || doc?.storage_path || '').toLowerCase();
  if (mime === 'application/pdf' || nom.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(nom)) return 'image';
  return 'autre';
}

/**
 * Onglets du mode atelier : une entrée par vue éclatée (`vue:<i>`), puis les documents dans l'ordre de
 * `rangerDocumentsModele` (principaux puis procédures, `doc:<id>`). Rien n'est proposé pour un type absent.
 * @param {{ vues?: Array<object>, documents?: Array<object> }} p
 * @returns {Array<{ id: string, type: 'vue'|'notice'|'fiche_technique'|'procedure'|'autre', libelle: string, source: object, vueDeNotice?: boolean }>}
 */
export function ongletsAtelier({ vues, documents } = {}) {
  const lesVues = Array.isArray(vues) ? vues : [];
  const onglets = lesVues.map((v, i) => ({
    id: `vue:${i}`,
    type: 'vue',
    libelle: lesVues.length > 1 ? `Vue éclatée ${i + 1}/${lesVues.length}` : 'Vue éclatée',
    source: { kind: 'vue', url: v?.url, width: v?.width ?? null, height: v?.height ?? null },
    // vue tirée de la notice : ses repères ne sont pas ceux de la liste — l'atelier doit l'écrire au-dessus
    vueDeNotice: v?.origine === 'notice',
  }));
  const { principaux, procedures } = rangerDocumentsModele(documents || []);
  for (const doc of [...principaux, ...procedures]) {
    onglets.push({
      id: `doc:${doc.id}`,
      type: TYPES_ONGLET.has(doc.document_type) ? doc.document_type : 'autre',
      libelle: titreDocumentModele(doc, (t) => LIBELLES_TYPE[t] || 'Document'),
      source: { kind: 'doc', doc },
    });
  }
  return onglets;
}

/**
 * Onglet affiché : celui demandé s'il existe encore, sinon le premier (aucun si la liste est vide).
 * @param {Array<{ id: string }>} onglets
 * @param {string|null|undefined} ongletId
 * @returns {object|null}
 */
export function ongletActif(onglets, ongletId) {
  const liste = Array.isArray(onglets) ? onglets : [];
  return liste.find((o) => o.id === ongletId) || liste[0] || null;
}

/**
 * Nombre de vues éclatées déclarées sur la fiche du modèle (avant toute URL signée) : sert à proposer le mode
 * atelier sans charger les images d'un bloc replié.
 * @param {{ exploded_views?: Array<{ path?: string }> }|null|undefined} model
 * @returns {number}
 */
export function vuesDeclarees(model) {
  return Array.isArray(model?.exploded_views) ? model.exploded_views.filter((v) => v?.path).length : 0;
}

/** Part de la largeur donnée au document dans l'atelier : départ et bornes de la poignée. */
export const PART_DOCUMENT = { defaut: 0.6, min: 0.3, max: 0.75 };

/**
 * Part du document bornée (poignée glissée hors limites, valeur absurde → départ).
 * @param {number} part entre 0 et 1
 * @returns {number}
 */
export function bornerPartDocument(part) {
  if (!Number.isFinite(part)) return PART_DOCUMENT.defaut;
  return Math.min(PART_DOCUMENT.max, Math.max(PART_DOCUMENT.min, part));
}

/** Plafond de pixels d'un canvas de page PDF (même principe que `maxCanvasPixels` de pdf.js). */
export const MAX_PIXELS_CANVAS = 16777216;

/**
 * Densité de rendu d'une page PDF : pixels du canvas par pixel CSS. Vaut la densité d'écran, réduite pour que
 * le canvas ne dépasse jamais `maxPixels` (au-delà, une tablette rend un canvas blanc ou plante). La taille
 * affichée (CSS) ne change pas : seule la netteté baisse sur une page très zoomée.
 * @param {{ largeur: number, hauteur: number, zoom?: number, dpr?: number, maxPixels?: number }} p
 *   `largeur` / `hauteur` = taille CSS de la page à zoom 1, `zoom` = facteur d'agrandissement appliqué
 * @returns {number}
 */
export function echelleRendu({ largeur, hauteur, zoom = 1, dpr = 1, maxPixels = MAX_PIXELS_CANVAS }) {
  const densite = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const surface = largeur * z * hauteur * z;
  if (!(surface > 0)) return densite;
  return Math.min(densite, Math.sqrt(maxPixels / surface));
}

const sansAccent = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Requête de recherche normalisée comme le texte des pages : sans accent, en minuscules, blancs réduits à une
 * espace, bords retirés.
 * @param {string} s
 * @returns {string}
 */
export function normaliserRecherchePdf(s) {
  return sansAccent(String(s || '')).replace(/\s+/g, ' ').trim();
}

/**
 * Texte d'une page PDF pour la recherche : les éléments de texte de pdf.js mis bout à bout, séparés d'une espace
 * sauf quand l'un prolonge l'autre sur la même ligne. Jamais deux espaces de suite (élément vide ou blanc ignoré,
 * blancs internes réduits), même normalisation que `normaliserRecherchePdf`. `segments` garde, pour chaque
 * élément retenu, son indice et sa plage dans le texte.
 * @param {Array<{ str?: string, transform?: number[], width?: number }>} items
 * @returns {{ texte: string, segments: Array<{ item: number, debut: number, fin: number }> }}
 */
export function texteDePagePdf(items) {
  let texte = '';
  const segments = [];
  let prec = null;
  (Array.isArray(items) ? items : []).forEach((it, idx) => {
    const brut = typeof it?.str === 'string' ? it.str : '';
    if (!brut.trim()) return;
    let morceau = sansAccent(brut).replace(/\s+/g, ' ');
    const colle = !!(prec?.transform && it.transform)
      && Math.abs(prec.transform[5] - it.transform[5]) < 1
      && Math.abs(prec.transform[4] + (prec.width || 0) - it.transform[4]) < 1;
    if (!texte || texte.endsWith(' ')) morceau = morceau.trimStart();
    else if (!colle && !morceau.startsWith(' ')) texte += ' ';
    const debut = texte.length;
    texte += morceau;
    segments.push({ item: idx, debut, fin: texte.length });
    prec = it;
  });
  return { texte, segments };
}

/** Portées d'un document déposé sur la fiche d'un équipement, de la plus étroite à la plus large. */
export const PORTEES_DOCUMENT = ['appareil', 'modele', 'marque'];

/**
 * Portées proposées au dépôt : « cet appareil » toujours, « tous les <modèle> » si l'appareil a un modèle,
 * « toute la marque » s'il a une marque. Marque en MAJUSCULES, modèle tel que saisi.
 * @param {{ marque?: string, modele?: string, aMarque?: boolean, aModele?: boolean }} [p]
 * @returns {Array<{ value: 'appareil'|'modele'|'marque', label: string }>}
 */
export function porteesProposees({ marque, modele, aMarque, aModele } = {}) {
  const portees = [{ value: 'appareil', label: 'Cet appareil (ce client seulement)' }];
  if (aModele) portees.push({ value: 'modele', label: `Tous les ${modele ?? ''}` });
  if (aMarque) portees.push({ value: 'marque', label: `Toute la marque ${String(marque ?? '').toUpperCase()}` });
  return portees;
}

/**
 * Portée d'un document ; une ligne sans portée (ancienne ligne, ancien cache) ou inconnue vaut « modèle »,
 * l'ancien comportement.
 * @param {{ scope?: string }|null|undefined} doc
 * @returns {'appareil'|'modele'|'marque'}
 */
export function porteeDocument(doc) {
  return PORTEES_DOCUMENT.includes(doc?.scope) ? doc.scope : 'modele';
}

/**
 * Range les documents en trois tiroirs par portée, ordre d'origine gardé. Les documents des lignes fournisseur
 * (`productDocuments`) vont dans le tiroir « modèle », après les documents du modèle.
 * @param {Array<object>} [docs]
 * @param {Array<object>} [productDocuments]
 * @returns {{ appareil: Array<object>, modele: Array<object>, marque: Array<object> }}
 */
export function rangerEnTiroirs(docs, productDocuments = []) {
  const tiroirs = { appareil: [], modele: [], marque: [] };
  for (const d of Array.isArray(docs) ? docs : []) tiroirs[porteeDocument(d)].push(d);
  for (const d of Array.isArray(productDocuments) ? productDocuments : []) tiroirs.modele.push(d);
  return tiroirs;
}

/**
 * Le geste « Retirer » est-il offert ? Un document relevé (copié du site fabricant : `from_site` ou
 * `equipment_model_id`) ne se retire jamais d'ici. Portée appareil : droit de modifier ; marque / modèle :
 * droit de supprimer (il touche d'autres clients).
 * @param {{ scope?: string, from_site?: boolean, equipment_model_id?: string|null }|null|undefined} doc
 * @param {{ peutModifier?: boolean, peutSupprimer?: boolean }} [droits]
 * @returns {boolean}
 */
export function peutRetirerDocument(doc, { peutModifier, peutSupprimer } = {}) {
  if (doc?.from_site === true || doc?.equipment_model_id) return false;
  return porteeDocument(doc) === 'appareil' ? peutModifier === true : peutSupprimer === true;
}

/**
 * Phrase de confirmation du retrait, qui dit qui sera touché.
 * @param {{ scope?: string, label?: string, brand?: string, model?: string }|null|undefined} doc
 * @returns {string}
 */
export function messageRetraitDocument(doc) {
  const nom = `« ${doc?.label || 'ce document'} »`;
  const portee = porteeDocument(doc);
  if (portee === 'appareil') return `${nom} sera retiré de cet appareil.`;
  if (portee === 'marque') return `${nom} sera retiré pour tous les équipements de la marque ${doc?.brand ?? ''}.`;
  return `${nom} sera retiré pour tous les équipements ${doc?.brand ?? ''} ${doc?.model ?? ''} de l'entreprise.`;
}
