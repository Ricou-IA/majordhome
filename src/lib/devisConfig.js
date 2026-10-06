// src/lib/devisConfig.js
// Paramétrage des devis par org — module PUR (aucun import). Valeurs org : core.organizations.settings.devis
// (Settings → Socle → Devis). ⚠ org_update_settings merge niveau 1 → toujours sauver l'objet `devis` COMPLET.
// Spec : docs/superpowers/specs/2026-10-06-parametrage-devis-modele-document-design.md. Les défauts sont le
// comportement codé en dur avant le 2026-10-06 : une org sans réglage ne voit rien changer.

export const DEFAULT_CONDITIONS = `- Devis valable pour la durée indiquée ci-dessus.
- Acompte de 30% à la commande, solde à la réception des travaux.
- TVA applicable selon la nature des travaux (art. 278-0 bis du CGI).
- Garantie matériel selon les conditions du fabricant.`;

/** Catégories produit du picker (valeurs de PRODUCT_CATEGORIES de suppliers.service) ; null = tous les fournisseurs. */
export const CATEGORIES_PRODUIT = Object.freeze(['poele', 'climatisation', 'chauffage', 'fumisterie']);

/** Familles d'installation par défaut (ex-QUOTE_TEMPLATE_FAMILIES + FAMILY_DEFAULT_SECTIONS). */
export const DEFAULT_FAMILLES = Object.freeze([
  Object.freeze({ key: 'poele_granules', label: 'Poêle à Granulé', actif: true, categorie: 'poele', sections: Object.freeze(['POÊLE', 'FUMISTERIE', 'ÉLÉMENTS SÉCURITÉ', 'MAIN D\'ŒUVRE']) }),
  Object.freeze({ key: 'poele_bois', label: 'Poêle à Bois', actif: true, categorie: 'poele', sections: Object.freeze(['POÊLE', 'FUMISTERIE', 'ÉLÉMENTS SÉCURITÉ', 'MAIN D\'ŒUVRE']) }),
  Object.freeze({ key: 'climatisation', label: 'Climatisation', actif: true, categorie: 'climatisation', sections: Object.freeze(['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE']) }),
  Object.freeze({ key: 'chauffage_pac', label: 'Chauffage/PAC', actif: true, categorie: 'chauffage', sections: Object.freeze(['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE']) }),
  Object.freeze({ key: 'electricite', label: 'Electricité', actif: true, categorie: null, sections: Object.freeze(['MATÉRIEL', 'MAIN D\'ŒUVRE']) }),
  Object.freeze({ key: 'vmc', label: 'VMC', actif: true, categorie: null, sections: Object.freeze(['ÉQUIPEMENT', 'ACCESSOIRES', 'MAIN D\'ŒUVRE']) }),
  Object.freeze({ key: 'autre', label: 'Autre', actif: true, categorie: null, sections: Object.freeze(['PRESTATIONS', 'MAIN D\'ŒUVRE']) }),
]);

export const DEFAULTS_DEVIS = Object.freeze({
  familles: DEFAULT_FAMILLES,
  document: Object.freeze({
    titre: 'DEVIS',
    intro: '',
    acompte: '',
    conditions: DEFAULT_CONDITIONS,
    mention_speciale: '',
    validite_jours: 30,
    pied_de_page: '',        // vide = ligne légale construite depuis l'entreprise (buildLegalFooter)
    signature: 'Bon pour accord',
  }),
  paiement: Object.freeze({
    afficher: false,         // IBAN / BIC viennent de settings.invoicing (Facturation)
    etablissement: '',
    texte: 'Merci d’indiquer le numéro du devis dans le libellé de votre virement.',
  }),
  affichage: Object.freeze({
    logo: true,
    references: true,
    prix_unitaires: true,
    tva_par_ligne: true,
    detail_lignes: true,     // false = seulement le sous-total de chaque chapitre
  }),
});

const estObjet = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const texte = (v, d) => (typeof v === 'string' ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

/** Slug d'une clé de famille : minuscules, sans accents, `_` entre les mots. */
export function slugFamille(label) {
  return String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normaliserFamille(f, i) {
  if (!estObjet(f)) return null;
  const label = texte(f.label, '').trim();
  const key = texte(f.key, '').trim() || slugFamille(label) || `famille_${i + 1}`;
  if (!label) return null;
  const sections = Array.isArray(f.sections) ? f.sections.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
  const categorie = CATEGORIES_PRODUIT.includes(f.categorie) ? f.categorie : null;
  return { key, label, actif: bool(f.actif, true), categorie, sections };
}

/**
 * Config Devis effective d'une org : défauts + surcharge `settings.devis`. Une liste de familles vide ou
 * malformée retombe sur les défauts ; les objets de niveau 2 sont fusionnés clé par clé.
 * @param {{ devis?: object } | null | undefined} settings
 * @returns {{ familles: Array<{ key: string, label: string, actif: boolean, categorie: string|null, sections: string[] }>,
 *   document: typeof DEFAULTS_DEVIS.document, paiement: typeof DEFAULTS_DEVIS.paiement, affichage: typeof DEFAULTS_DEVIS.affichage }}
 */
export function buildDevisConfig(settings) {
  const s = estObjet(settings?.devis) ? settings.devis : {};
  const famillesBrutes = Array.isArray(s.familles) ? s.familles.map(normaliserFamille).filter(Boolean) : [];
  const vues = new Set();
  const familles = famillesBrutes.filter((f) => { if (vues.has(f.key)) return false; vues.add(f.key); return true; });
  const d = estObjet(s.document) ? s.document : {};
  const p = estObjet(s.paiement) ? s.paiement : {};
  const a = estObjet(s.affichage) ? s.affichage : {};
  const D = DEFAULTS_DEVIS;
  const validite = Number(d.validite_jours);
  return {
    familles: familles.length ? familles : DEFAULT_FAMILLES.map((f) => ({ ...f, sections: [...f.sections] })),
    document: {
      titre: texte(d.titre, D.document.titre).trim() || D.document.titre,
      intro: texte(d.intro, D.document.intro),
      acompte: texte(d.acompte, D.document.acompte),
      conditions: texte(d.conditions, D.document.conditions),
      mention_speciale: texte(d.mention_speciale, D.document.mention_speciale),
      validite_jours: Number.isInteger(validite) && validite >= 1 && validite <= 365 ? validite : D.document.validite_jours,
      pied_de_page: texte(d.pied_de_page, D.document.pied_de_page),
      signature: texte(d.signature, D.document.signature),
    },
    paiement: { afficher: bool(p.afficher, D.paiement.afficher), etablissement: texte(p.etablissement, D.paiement.etablissement), texte: texte(p.texte, D.paiement.texte) },
    affichage: {
      logo: bool(a.logo, D.affichage.logo), references: bool(a.references, D.affichage.references),
      prix_unitaires: bool(a.prix_unitaires, D.affichage.prix_unitaires), tva_par_ligne: bool(a.tva_par_ligne, D.affichage.tva_par_ligne),
      detail_lignes: bool(a.detail_lignes, D.affichage.detail_lignes),
    },
  };
}

/** Familles proposées dans la modale « Nouveau devis » (actives, dans l'ordre). */
export function famillesActives(config) {
  return (config?.familles || []).filter((f) => f.actif);
}

/**
 * Famille par key OU par label (les devis et devis types existants portent le label).
 * @returns {object|null}
 */
export function familleDe(config, keyOuLabel) {
  if (!keyOuLabel) return null;
  const v = String(keyOuLabel);
  return (config?.familles || []).find((f) => f.key === v || f.label === v) || null;
}

/** Titres de chapitre par défaut d'une famille (vide si famille inconnue). */
export function sectionsParDefaut(config, keyOuLabel) {
  return familleDe(config, keyOuLabel)?.sections?.slice() || [];
}

const normaliserCategorie = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Catégorie produit du picker pour une section : le nom de la section s'il est une catégorie (« POÊLE »,
 * « FUMISTERIE »), sinon celle de la famille (« ÉQUIPEMENT » d'un devis Climatisation ⇒ climatisation),
 * sinon null (tous les fournisseurs). Avant ce helper, « ÉQUIPEMENT » cherchait un fournisseur de
 * catégorie « equipement » : picker vide en silence.
 * @returns {string|null}
 */
export function categoriePourSection(config, sectionName, keyOuLabel) {
  const n = normaliserCategorie(sectionName);
  if (CATEGORIES_PRODUIT.includes(n)) return n;
  return familleDe(config, keyOuLabel)?.categorie || null;
}

/**
 * Contrôle d'un paramétrage saisi (avant sauvegarde). Erreurs nommées, jamais un défaut silencieux.
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function validerDevisConfig(config) {
  const erreurs = [];
  const familles = Array.isArray(config?.familles) ? config.familles : [];
  if (!familles.some((f) => f?.actif)) erreurs.push('au moins une famille active');
  const keys = new Set();
  familles.forEach((f, i) => {
    const nom = f?.label?.trim() || `famille ${i + 1}`;
    if (!f?.label?.trim()) erreurs.push(`famille ${i + 1} : libellé manquant`);
    if (!f?.key) erreurs.push(`${nom} : clé manquante`);
    if (f?.key && keys.has(f.key)) erreurs.push(`${nom} : clé en double`);
    if (f?.key) keys.add(f.key);
    if (!Array.isArray(f?.sections) || f.sections.filter((s) => String(s).trim()).length === 0) erreurs.push(`${nom} : au moins un chapitre`);
    if (f?.categorie != null && !CATEGORIES_PRODUIT.includes(f.categorie)) erreurs.push(`${nom} : catégorie produit inconnue`);
  });
  const v = Number(config?.document?.validite_jours);
  if (!Number.isInteger(v) || v < 1 || v > 365) erreurs.push('validité entre 1 et 365 jours');
  if (!String(config?.document?.titre || '').trim()) erreurs.push('titre du document manquant');
  return { ok: erreurs.length === 0, erreurs };
}
