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
export const CATEGORIES_PRODUIT = Object.freeze(['poele', 'climatisation', 'chauffage', 'fumisterie', 'batterie', 'photovoltaique', 'borne_recharge']);

/**
 * Type d'un chapitre de devis (2026-10-25, décisions d'Eric) — ce que le « + » du chapitre propose :
 *   equipement  : articles « équipement principal » des catégories de la famille (la borne, le poêle) ;
 *   option      : articles « accessoire » des catégories de la famille (l'abri, le câble long) ;
 *   stock       : matériel stocké, articles Mayer « par type », toutes familles (câble, disjoncteur) ;
 *   main_oeuvre : articles internes de main d'œuvre (pose, mise en service) ;
 *   libre       : saisie libre + tout le catalogue ;
 *   fumisterie  : métré assisté + articles de la catégorie fumisterie.
 */
export const TYPES_CHAPITRE = Object.freeze(['equipement', 'option', 'stock', 'main_oeuvre', 'libre', 'fumisterie']);

/** Taux de TVA proposés (la famille porte le sien, le devis peut le changer). */
export const TAUX_TVA = Object.freeze([20, 10, 5.5, 0]);

/** TVA par défaut d'une famille sans réglage : 5,5 % rénovation énergétique (poêles, PAC), 10 % sinon (à vérifier par org). */
const TVA_DEFAUT_PAR_FAMILLE = Object.freeze({ poele_granules: 5.5, poele_bois: 5.5, chauffage_pac: 5.5 });
const TVA_DEFAUT = 10;

const CHAPITRES_EQUIPEMENT = Object.freeze([
  ['ÉQUIPEMENT', 'equipement'], ['OPTIONS', 'option'], ['SÉCURITÉ ET ACCESSOIRES', 'stock'], ['POSE ET MISE EN SERVICE', 'main_oeuvre'],
]);
const CHAPITRES_POELE = Object.freeze([
  ['POÊLE', 'equipement'], ['OPTIONS', 'option'], ['FUMISTERIE', 'fumisterie'], ['SÉCURITÉ ET ACCESSOIRES', 'stock'], ['POSE ET MISE EN SERVICE', 'main_oeuvre'],
]);

/** Famille par défaut figée : `chapitres` typés, `sections` = leurs titres (lecteurs historiques). */
function familleDefaut(key, label, categories, chapitres) {
  const ch = chapitres.map(([titre, type]) => Object.freeze({ titre, type }));
  return Object.freeze({
    key, label, actif: true, categories: Object.freeze([...categories]),
    tva: TVA_DEFAUT_PAR_FAMILLE[key] ?? TVA_DEFAUT,
    chapitres: Object.freeze(ch), sections: Object.freeze(ch.map((c) => c.titre)),
  });
}

/**
 * Familles d'installation par défaut. `categories` = catégories produit des chapitres Équipement / Option (vide =
 * tout le catalogue) ; une famille peut en avoir plusieurs (2026-10-24 : un devis Photovoltaïque pioche aussi des
 * batteries). Chapitres d'Eric (2026-10-25) : Équipement / Option / Sécurité et accessoire / Pose et mise en service ;
 * les poêles gardent la fumisterie, le Photovoltaïque ses titres (dictés par Eric le 2026-10-24), typés.
 * Réglages antérieurs : `categorie` (texte) ⇒ `categories` ; `sections` (titres seuls) ⇒ `chapitres` déduits.
 */
export const DEFAULT_FAMILLES = Object.freeze([
  familleDefaut('poele_granules', 'Poêle à Granulé', ['poele'], CHAPITRES_POELE),
  familleDefaut('poele_bois', 'Poêle à Bois', ['poele'], CHAPITRES_POELE),
  familleDefaut('climatisation', 'Climatisation', ['climatisation'], CHAPITRES_EQUIPEMENT),
  familleDefaut('chauffage_pac', 'Chauffage/PAC', ['chauffage'], CHAPITRES_EQUIPEMENT),
  familleDefaut('batterie', 'Batterie', ['batterie', 'photovoltaique'], CHAPITRES_EQUIPEMENT),
  familleDefaut('photovoltaique', 'Photovoltaïque', ['photovoltaique', 'batterie'], [
    ['PANNEAUX', 'equipement'], ['ONDULEUR ET MONITORING', 'equipement'], ['FIXATION', 'equipement'],
    ['COFFRETS ET CÂBLAGE', 'stock'], ['MAIN D\'ŒUVRE', 'main_oeuvre'],
  ]),
  familleDefaut('borne_recharge', 'Borne de recharge', ['borne_recharge'], CHAPITRES_EQUIPEMENT),
  familleDefaut('electricite', 'Electricité', [], [['MATÉRIEL', 'stock'], ['POSE ET MISE EN SERVICE', 'main_oeuvre']]),
  familleDefaut('vmc', 'VMC', [], CHAPITRES_EQUIPEMENT),
  familleDefaut('autre', 'Autre', [], [['PRESTATIONS', 'libre'], ['MAIN D\'ŒUVRE', 'main_oeuvre']]),
]);

const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/gi, 'oe').toLowerCase();

/**
 * Type d'un chapitre d'après son titre (familles enregistrées avant les types, chapitre ajouté à la main dans un devis).
 * Ordre : main d'œuvre, stock (« sécurité et accessoires » est du stock), fumisterie, option, libre, équipement.
 * @param {string} titre
 * @returns {string}
 */
export function typeChapitreDeduit(titre) {
  const t = sansAccent(titre);
  if (/main\s*d\W?\s*oeuvre|\bpose\b|mise en service/.test(t)) return 'main_oeuvre';
  if (/securite|materiel|cablage|coffret|raccord/.test(t)) return 'stock';
  if (/fumisterie/.test(t)) return 'fumisterie';
  if (/option|accessoire/.test(t)) return 'option';
  if (/^\s*autre\b|prestation/.test(t)) return 'libre';
  return 'equipement';
}

/** TVA d'une famille saisie : un taux de la liste (nombre ou chaîne), sinon le défaut de la famille. */
function normaliserTva(v, key) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  return TAUX_TVA.includes(n) ? n : (TVA_DEFAUT_PAR_FAMILLE[key] ?? TVA_DEFAUT);
}

/** Chapitres d'une famille saisie : `chapitres` typés (type inconnu ⇒ déduit), sinon `sections` (titres) déduits. */
function normaliserChapitres(f) {
  const brut = Array.isArray(f.chapitres)
    ? f.chapitres.map((c) => (estObjet(c) ? { titre: texte(c.titre, ''), type: c.type } : { titre: String(c ?? ''), type: null }))
    : (Array.isArray(f.sections) ? f.sections.map((s) => ({ titre: String(s ?? ''), type: null })) : []);
  return brut
    .map((c) => ({ titre: c.titre.trim(), type: c.type }))
    .filter((c) => c.titre)
    .map((c) => ({ titre: c.titre, type: TYPES_CHAPITRE.includes(c.type) ? c.type : typeChapitreDeduit(c.titre) }));
}

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
  const chapitres = normaliserChapitres(f);
  return {
    key, label, actif: bool(f.actif, true), categories: normaliserCategories(f), tva: normaliserTva(f.tva, key),
    chapitres, sections: chapitres.map((c) => c.titre),
  };
}

/** `categories` d'une famille saisie : tableau filtré sur les catégories connues ; `categorie` (texte, legacy) accepté. */
function normaliserCategories(f) {
  const brutes = Array.isArray(f.categories) ? f.categories : (f.categorie != null ? [f.categorie] : []);
  const vues = new Set();
  return brutes.filter((c) => CATEGORIES_PRODUIT.includes(c) && !vues.has(c) && vues.add(c));
}

/**
 * Config Devis effective d'une org : défauts + surcharge `settings.devis`. Une liste de familles vide ou
 * malformée retombe sur les défauts ; les objets de niveau 2 sont fusionnés clé par clé.
 * @param {{ devis?: object } | null | undefined} settings
 * @returns {{ familles: Array<{ key: string, label: string, actif: boolean, categories: string[], sections: string[] }>,
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
    familles: familles.length ? familles : DEFAULT_FAMILLES.map((f) => ({
      ...f, categories: [...f.categories], chapitres: f.chapitres.map((c) => ({ ...c })), sections: [...f.sections],
    })),
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

/**
 * Type d'un chapitre d'un devis : celui du chapitre de même titre dans la famille (casse et espaces ignorés), sinon
 * déduit du titre (chapitre ajouté ou renommé dans le devis).
 * @returns {string}
 */
export function typeChapitre(config, keyOuLabel, titre) {
  const t = String(titre || '').trim().toLowerCase();
  const c = (familleDe(config, keyOuLabel)?.chapitres || []).find((x) => x.titre.trim().toLowerCase() === t);
  return c?.type || typeChapitreDeduit(titre);
}

/** TVA par défaut d'une famille (celle du réglage, sinon 10 %). Le devis peut la changer. */
export function tvaFamille(config, keyOuLabel) {
  return familleDe(config, keyOuLabel)?.tva ?? TVA_DEFAUT;
}

const normaliserCategorie = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Catégories produit du picker pour une section : le nom de la section s'il est une catégorie (« POÊLE »,
 * « FUMISTERIE »), sinon celles de la famille (« PANNEAUX » d'un devis Photovoltaïque ⇒ photovoltaique +
 * batterie), sinon vide (tous les fournisseurs). Avant ce helper, « ÉQUIPEMENT » cherchait un fournisseur de
 * catégorie « equipement » : picker vide en silence.
 * @returns {string[]}
 */
export function categoriesPourSection(config, sectionName, keyOuLabel) {
  const n = normaliserCategorie(sectionName);
  if (CATEGORIES_PRODUIT.includes(n)) return [n];
  return familleDe(config, keyOuLabel)?.categories?.slice() || [];
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
    const chapitres = Array.isArray(f?.chapitres) ? f.chapitres : (Array.isArray(f?.sections) ? f.sections.map((s) => ({ titre: s, type: typeChapitreDeduit(s) })) : []);
    if (chapitres.filter((c) => String(c?.titre ?? '').trim()).length === 0) erreurs.push(`${nom} : au moins un chapitre`);
    if (chapitres.some((c) => String(c?.titre ?? '').trim() && !TYPES_CHAPITRE.includes(c?.type))) erreurs.push(`${nom} : type de chapitre inconnu`);
    if (f?.tva !== undefined && !TAUX_TVA.includes(Number(f.tva))) erreurs.push(`${nom} : TVA hors des taux proposés (20, 10, 5,5 ou 0 %)`);
    const cats = Array.isArray(f?.categories) ? f.categories : (f?.categorie != null ? [f.categorie] : []);
    if (cats.some((c) => !CATEGORIES_PRODUIT.includes(c))) erreurs.push(`${nom} : catégorie produit inconnue`);
  });
  const v = Number(config?.document?.validite_jours);
  if (!Number.isInteger(v) || v < 1 || v > 365) erreurs.push('validité entre 1 et 365 jours');
  if (!String(config?.document?.titre || '').trim()) erreurs.push('titre du document manquant');
  return { ok: erreurs.length === 0, erreurs };
}
