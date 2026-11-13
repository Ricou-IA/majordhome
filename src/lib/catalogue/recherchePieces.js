// src/lib/catalogue/recherchePieces.js
// Classement des pièces détachées d'un catalogue de marchand pour la fiche d'un appareil (marque + modèle) :
// d'abord les pièces dont la fiche CITE le modèle (ses mots à la suite et dans l'ordre), puis, à part, les pièces de la même marque dont la fiche ne le cite pas.
// Module PUR, sans import, utilisé par le frontend seulement (non copié pour Deno). Ne déclare jamais une compatibilité
// que la fiche du marchand n'énonce pas : « citée » veut dire « le marchand écrit ce modèle », rien de plus.
// Spec : 2026-11-12-base-pieces-catalogues-marchands-design.md (§ 3 et § 4 « Classement »).
// Testé sur l'extrait réel du flux : scripts/catalogue/recherche-pieces.test.mjs.

/**
 * Ligne de la vue `majordhome_pieces_catalogue` (seuls les champs lus ici sont obligatoires pour le classement).
 * @typedef {Object} LignePiece
 * @property {string} [id]
 * @property {string} [reference]            Référence du marchand
 * @property {string} [name]                 Désignation
 * @property {string} [brand]                Marque de la fiche (une seule, même pour une pièce commune à plusieurs marques)
 * @property {string} [rayons]               Rayons du marchand, séparés par « | » (la pièce commune y cite toutes ses marques)
 * @property {number|null} [prix_public_ttc] Prix public TTC
 * @property {boolean} [en_stock]            Stock au dernier relevé
 * @property {string} [recherche]            Texte de recherche : minuscules, sans accents, ponctuation gardée
 *                                           (désignation, référence, marque, rayons, description du marchand)
 */

/**
 * Appareil du client et texte tapé dans la fenêtre.
 * @typedef {Object} CritereClassement
 * @property {string} [marque]  Marque de l'appareil (texte libre ou référentiel : FREEPOINT, « Freepoint », freepoint)
 * @property {string} [modele]  Modèle de l'appareil (texte libre)
 * @property {string} [saisie]  Texte tapé pour filtrer (chaque mot doit commencer un mot de la fiche)
 */

/**
 * @typedef {'modele_absent'|'modele_generique'|'marque_absente'|null} MotifClassement
 *   marque_absente : marque vide ou aucune pièce du catalogue pour cette marque (les deux groupes sont vides) ;
 *   modele_absent : modèle vide ; modele_generique : modèle trop court ou trop banal (« One », « Evo »), ou simple
 *   répétition de la marque (« Freepoint ») : rien n'est « cité », les pièces de la marque restent proposées ;
 *   null : classement normal.
 */

/**
 * @typedef {Object} ResultatClassement
 * @property {LignePiece[]} citees      Pièces de la marque dont la fiche cite le modèle (après filtre par la saisie)
 * @property {LignePiece[]} memeMarque  Pièces de la marque dont la fiche ne cite pas le modèle (après filtre par la saisie)
 * @property {MotifClassement} motif
 * @property {{ citees: number, memeMarque: number }} total  Mêmes deux groupes AVANT le filtre par la saisie : la saisie
 *   ne les change jamais (de quoi distinguer « le catalogue n'a rien » de « votre saisie ne retient rien »)
 */

/** Mots de modèle trop banals pour prouver une compatibilité à eux seuls (normalisés). */
export const MOTS_GENERIQUES = Object.freeze(['one', 'evo', 'air', 'plus', 'new', 'eco', 'top', 'max', 'mini', 'wifi', 'at']);

/** Mots de rayon qui ne désignent aucune marque (« Pièces détachées Freepoint »). */
const MOTS_DE_RAYON_SANS_MARQUE = new Set(['pieces', 'detachees']);

/** Articles et particules qui ne désignent aucune marque (« La Foyère », « De Dietrich ») : liste unique, aussi utilisée par le filtre serveur. */
export const MOTS_VIDES = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'et', 'en', 'au', 'aux']);

/**
 * Unités écartées de la séquence du modèle ET de la suite de la fiche (« 9 kW » ne doit pas empêcher « Globe Airtight 9 »).
 * kw, kg, mm, cm : toujours ; m2, m3 : seulement juste après un nombre d'au moins 20 (« 80 m2 »), car « 14 M2 » est un nom de version
 * (« Suite Comfort Air 14 M2 ») et « M2 » seul aussi.
 */
export const UNITES_IGNOREES = Object.freeze(['kw', 'kg', 'mm', 'cm', 'm2', 'm3']);
const UNITES_TOUJOURS = new Set(['kw', 'kg', 'mm', 'cm']);
const UNITES_APRES_NOMBRE = new Set(['m2', 'm3']);

/** Texte libre → chaîne ('' si ce n'est pas du texte). */
const texte = (v) => (typeof v === 'string' ? v : '');

/** Translittérations de `unaccent` (PostgreSQL) que la décomposition NFD ne couvre pas. */
const TRANSLITTERATIONS = { 'œ': 'oe', 'æ': 'ae', 'ß': 'ss', 'ø': 'o', 'ł': 'l' };

/**
 * Minuscules, sans accents, comme `lower(unaccent(...))` de la base : diacritiques retirés (NFD), puis œ→oe, æ→ae, ß→ss,
 * ø→o, ł→l. Définition unique, importée par `piecesCatalogueRequete.js`.
 * @param {unknown} v
 * @returns {string}
 */
export const normaliser = (v) => texte(v)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[œæßøł]/g, (c) => TRANSLITTERATIONS[c]);

/**
 * Mots d'un texte : normalisé, découpé sur tout ce qui n'est ni lettre ni chiffre (espace, tiret, barre, apostrophes,
 * ponctuation). Aucune expression régulière construite à partir d'une saisie.
 * @param {unknown} v
 * @returns {string[]}
 */
function mots(v) {
  return normaliser(v).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** @param {string} mot @returns {number} nombre de lettres du mot */
const nbLettres = (mot) => (mot.match(/\p{L}/gu) || []).length;

const estNombre = (m) => /^\p{N}+$/u.test(m);

/** Nombre assez grand pour être une surface ou un volume (« 80 m2 ») et non un numéro de version (« Suite Comfort Air 14 M2 »). */
const SEUIL_SURFACE = 20;
const estSurface = (m) => /^\d{1,6}$/.test(m) && Number(m) >= SEUIL_SURFACE;

/**
 * Mots significatifs d'une suite de mots : 2 caractères et plus, hors nombres seuls, hors unités (kw, kg, mm, cm ; m2 et m3
 * juste après un nombre d'au moins 20). Même filtre pour le modèle et pour la fiche du marchand.
 * @param {string[]} tous
 * @returns {string[]}
 */
function motsSignificatifs(tous) {
  const out = [];
  for (let i = 0; i < tous.length; i++) {
    const m = tous[i];
    if (m.length < 2 || estNombre(m) || UNITES_TOUJOURS.has(m)) continue;
    if (UNITES_APRES_NOMBRE.has(m) && i > 0 && estSurface(tous[i - 1])) continue;
    out.push(m);
  }
  return out;
}

/**
 * Mots du modèle : normalisés, 2 caractères et plus, hors nombres seuls et hors unités, sans doublon, dans l'ordre.
 * @param {unknown} modele
 * @returns {string[]}
 */
export function motsDuModele(modele) {
  return [...new Set(motsSignificatifs(mots(modele)))];
}

/** Mots de la marque de l'appareil : 2 caractères et plus, hors articles, sans doublon. */
function motsDeLaMarque(marque) {
  return [...new Set(mots(marque).filter((m) => m.length >= 2 && !MOTS_VIDES.has(m)))];
}

/**
 * Le modèle prouve-t-il quelque chose ? Vrai si au moins un mot a 4 lettres et plus sans être générique. Si la marque est
 * donnée, ses mots ne comptent pas (quelqu'un a tapé la marque dans le champ modèle).
 * @param {unknown} modele
 * @param {unknown} [marque]
 * @returns {boolean}
 */
export function modeleExploitable(modele, marque = '') {
  const deLaMarque = new Set(motsDeLaMarque(marque));
  return motsDuModele(modele).some((m) => !deLaMarque.has(m) && nbLettres(m) >= 4 && !MOTS_GENERIQUES.includes(m));
}

/**
 * @typedef {Object} Indexee
 * @property {string[]} liste  Mots distincts de `recherche`
 * @property {string[]} suite Mots de `recherche` dans l'ordre et avec répétitions, mêmes filtres que le modèle (test « à la suite »)
 * @property {Set<string>} marque Mots de `brand` et de `rayons` (sans « pièces détachées »)
 * @property {Map<string, boolean>} cites Résultat du test « à la suite » par séquence de modèle (clé = mots joints par une espace)
 */
/** Index par ligne (les lignes ne sont jamais modifiées : le calcul est gardé tant que la ligne vit). */
const INDEX = new WeakMap();

/** @param {LignePiece} ligne @returns {Indexee} */
function indexer(ligne) {
  let i = INDEX.get(ligne);
  if (!i) {
    const tous = mots(ligne.recherche);
    const set = new Set(tous);
    const marque = new Set([...mots(ligne.brand), ...mots(ligne.rayons)].filter((m) => !MOTS_DE_RAYON_SANS_MARQUE.has(m)));
    i = { liste: [...set], suite: motsSignificatifs(tous), marque, cites: new Map() };
    INDEX.set(ligne, i);
  }
  return i;
}

/** `motif` est-il une sous-suite contiguë de `suite` ? (comparaison mot à mot, aucune expression régulière) */
function contient(suite, motif) {
  const fin = suite.length - motif.length;
  for (let i = 0; i <= fin; i++) {
    let j = 0;
    while (j < motif.length && suite[i + j] === motif[j]) j++;
    if (j === motif.length) return true;
  }
  return false;
}

/** Ordre d'affichage : en stock d'abord, puis prix croissant (sans prix en dernier), puis référence. */
function comparer(a, b) {
  const sa = a.en_stock === true ? 0 : 1;
  const sb = b.en_stock === true ? 0 : 1;
  if (sa !== sb) return sa - sb;
  const pa = typeof a.prix_public_ttc === 'number' && Number.isFinite(a.prix_public_ttc) ? a.prix_public_ttc : Infinity;
  const pb = typeof b.prix_public_ttc === 'number' && Number.isFinite(b.prix_public_ttc) ? b.prix_public_ttc : Infinity;
  if (pa !== pb) return pa < pb ? -1 : 1;
  const ra = texte(a.reference);
  const rb = texte(b.reference);
  if (ra === rb) return 0;
  return ra < rb ? -1 : 1;
}

/**
 * Classe les pièces candidates en « citées » (la fiche du marchand écrit le modèle) et « même marque » (elle ne l'écrit pas).
 * - même marque : tous les mots de la marque de l'appareil (hors articles) figurent, à mots entiers, dans la marque ou les rayons de la pièce ;
 * - citée : même marque ET modèle exploitable ET les mots du modèle figurent dans `recherche` à la suite et dans l'ordre
 *   (mots entiers ; séparateurs, nombres seuls, mots d'un caractère et unités ignorés des deux côtés ; mots de la marque
 *   placés en tête du modèle écartés) : « Mika » et « Evo » éloignés dans une liste ne citent pas « Mika Evo » ;
 * - saisie : chaque mot de 2 caractères et plus doit commencer un mot de `recherche` (filtre progressif) ;
 * - `total` : effectifs des deux groupes avant le filtre par la saisie ;
 * - tri de chaque groupe : en stock, prix croissant, référence. Une pièce n'apparaît que dans un groupe.
 * Ne modifie pas ses entrées, ne lève jamais d'exception sur une ligne incomplète (champ manquant = vide).
 * @param {CritereClassement} critere
 * @param {LignePiece[]|null|undefined} lignes
 * @returns {ResultatClassement}
 */
export function classerPieces(critere, lignes) {
  const c = critere && typeof critere === 'object' ? critere : {};
  const vide = (motif) => ({ citees: [], memeMarque: [], motif, total: { citees: 0, memeMarque: 0 } });
  const marque = motsDeLaMarque(c.marque);
  if (!marque.length || !Array.isArray(lignes)) return vide('marque_absente');

  const deLaMarque = lignes.filter((l) => l && typeof l === 'object' && marque.every((m) => indexer(l).marque.has(m)));
  if (!deLaMarque.length) return vide('marque_absente');

  const saisie = [...new Set(mots(c.saisie).filter((m) => m.length >= 2))];

  const modele = motsDuModele(c.modele);
  let motif = null;
  if (!modele.length) motif = 'modele_absent';
  else if (!modeleExploitable(c.modele, c.marque)) motif = 'modele_generique';

  // Séquence exigée : le modèle sans les mots de la marque placés en tête (« Freepoint Globe Airtight » → « globe airtight »).
  const motsMarque = new Set(marque);
  const sequence = [...modele];
  while (sequence.length && motsMarque.has(sequence[0])) sequence.shift();
  const cle = sequence.join(' ');

  // Classement de TOUTES les pièces de la marque (totaux avant filtre), puis filtre par la saisie.
  const toutesCitees = [];
  const toutesAutres = [];
  for (const l of deLaMarque) {
    let citee = false;
    if (motif === null && sequence.length) {
      const idx = indexer(l);
      citee = idx.cites.get(cle);
      if (citee === undefined) {
        citee = contient(idx.suite, sequence);
        idx.cites.set(cle, citee);
      }
    }
    (citee ? toutesCitees : toutesAutres).push(l);
  }
  const retenue = (l) => saisie.every((s) => indexer(l).liste.some((w) => w.startsWith(s)));
  const citees = saisie.length ? toutesCitees.filter(retenue) : [...toutesCitees];
  const memeMarque = saisie.length ? toutesAutres.filter(retenue) : [...toutesAutres];
  return {
    citees: citees.sort(comparer),
    memeMarque: memeMarque.sort(comparer),
    motif,
    total: { citees: toutesCitees.length, memeMarque: toutesAutres.length },
  };
}
