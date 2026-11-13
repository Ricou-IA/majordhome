// src/lib/catalogue/woocommercePieces.js
// Adaptateur WooCommerce « catalogue de PIÈCES DÉTACHÉES » (Energies Bois Distribution, flux public de l'API Store
// `/wp-json/wc/store/v1/products`) : relevé brut → lignes de catégorie `piece_detachee`, au format que lit
// l'écrivain unique `public.supplier_pieces_upsert` (clés de `supplier_catalog_upsert`, migration 20261111_2).
// Module PUR, sans import (copié pour Deno par `npm run sync:tournee-engine`, ne jamais éditer la copie).
// Spec : 2026-11-12-base-pieces-catalogues-marchands-design.md (§ 4). Testé sur un extrait réel du flux :
// scripts/catalogue/woocommerce-pieces.test.mjs.
//
// Ce qu'on garde pour la recherche : référence (sku), désignation, marque, rayons du marchand, prix public TTC,
// stock au relevé, lien de la fiche et description longue en texte (c'est là que le marchand écrit les modèles
// compatibles). Prix : le flux donne le prix affiché au public, donc TTC (TVA 20 %) ; public HT = TTC ÷ 1,2 ;
// achat = public HT − remise du fournisseur. Tout est calculé en centimes entiers (pas d'erreur de virgule flottante).

/** Marque de relevé passée à `supplier_pieces_upsert` : un relevé = un seul appel, toutes marques d'appareils confondues. */
export const MARQUE_RELEVE = 'CATALOGUE';

/** Longueur maximale (caractères) de la description rangée par ligne (les listes de modèles compatibles sont longues : 13 887 caractères pour la 41451308101). */
export const DESCRIPTION_MAX = 20000;

const CATEGORIE_PIECE = 'piece_detachee';
const TVA_PCT = 20;

/** @type {Record<string, string>} Entités nommées courantes du flux (le reste, numérique, est décodé par son code). */
const ENTITES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', euro: '€', deg: '°', times: '×', middot: '·',
  bull: '•', copy: '©', reg: '®', trade: '™', plusmn: '±', frac12: '½', micro: 'µ', sup2: '²', sup3: '³',
  agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ograve: 'ò', oacute: 'ó', ocirc: 'ô', ouml: 'ö',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ', oelig: 'œ', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Auml: 'Ä', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë',
  Icirc: 'Î', Iuml: 'Ï', Ocirc: 'Ô', Ouml: 'Ö', Ugrave: 'Ù', Ucirc: 'Û', Uuml: 'Ü', Ccedil: 'Ç', OElig: 'Œ',
};

/**
 * Décode, en un seul passage, les entités HTML nommées courantes et numériques (`&#8217;`, `&#x41;`). Une entité
 * inconnue est laissée telle quelle.
 * @param {string} texte
 * @returns {string}
 */
function decoderEntites(texte) {
  return texte.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,8}));/g, (entiere, dec, hex, nom) => {
    if (nom) return Object.prototype.hasOwnProperty.call(ENTITES, nom) ? ENTITES[nom] : entiere;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entiere;
    return String.fromCodePoint(code);
  });
}

/** Balises de bloc (et `<br>`) : remplacées par une espace pour que deux blocs ne se collent pas. */
const BALISES_BLOC = new Set(['p', 'div', 'br', 'hr', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'tr', 'td', 'th', 'table', 'thead',
  'tbody', 'tfoot', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'blockquote', 'pre',
  'figure', 'figcaption']);

/**
 * Lettre ASCII ?
 * @param {number} c code UTF-16
 * @returns {boolean}
 */
function estLettre(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * Caractère de mot au sens de `\b` (ASCII : lettre, chiffre, `_`) ?
 * @param {number} c code UTF-16
 * @returns {boolean}
 */
function estCarMot(c) {
  return estLettre(c) || (c >= 48 && c <= 57) || c === 95;
}

/**
 * `mot` (écrit en minuscules ASCII) figure-t-il à la position i, casse ignorée ?
 * @param {string} s
 * @param {number} i
 * @param {string} mot
 * @returns {boolean}
 */
function motA(s, i, mot) {
  if (i + mot.length > s.length) return false;
  for (let k = 0; k < mot.length; k++) {
    const c = s.charCodeAt(i + k);
    if ((estLettre(c) ? c | 0x20 : c) !== mot.charCodeAt(k)) return false;
  }
  return true;
}

/**
 * Retire les blocs `<script>` et `<style>` AVEC leur contenu (jusqu'à la première fermeture `</script >`, casse
 * ignorée, ou jusqu'à la fin s'il n'y en a pas), chacun remplacé par une espace. Un seul passage vers l'avant.
 * @param {string} s
 * @returns {string}
 */
function sansScripts(s) {
  let sortie = '';
  let depuis = 0;
  let i = s.indexOf('<');
  while (i !== -1) {
    const nom = motA(s, i + 1, 'script') ? 'script' : (motA(s, i + 1, 'style') ? 'style' : null);
    if (!nom || estCarMot(s.charCodeAt(i + 1 + nom.length))) { i = s.indexOf('<', i + 1); continue; }
    sortie += s.slice(depuis, i) + ' ';
    let fin = -1;
    let j = s.indexOf('</', i + 1 + nom.length);
    while (j !== -1) {
      if (!motA(s, j + 2, nom)) { j = s.indexOf('</', j + 2); continue; }
      let k = j + 2 + nom.length;
      while (k < s.length && /\s/.test(s[k])) k += 1;
      if (s.charCodeAt(k) === 62) { fin = k + 1; break; }
      j = s.indexOf('</', k);
    }
    if (fin === -1) return sortie; // jamais fermé : tout le reste part
    depuis = fin;
    i = s.indexOf('<', fin);
  }
  return sortie + s.slice(depuis);
}

/**
 * Retire les commentaires `<!-- … -->` (jusqu'à la fin s'ils ne sont pas fermés), chacun remplacé par une espace.
 * @param {string} s
 * @returns {string}
 */
function sansCommentaires(s) {
  let sortie = '';
  let depuis = 0;
  let i = s.indexOf('<!--');
  while (i !== -1) {
    sortie += s.slice(depuis, i) + ' ';
    const fin = s.indexOf('-->', i + 4);
    if (fin === -1) return sortie;
    depuis = fin + 3;
    i = s.indexOf('<!--', depuis);
  }
  return sortie + s.slice(depuis);
}

/**
 * Retire les balises en un seul passage : balise de bloc ou `<br>` → une espace, autre balise ou déclaration `<!…>`
 * → rien. Une balise commence par `<` ou `</` suivi d'une lettre et finit au premier `>` hors guillemets (un chevron
 * dans une valeur d'attribut entre guillemets est toléré). Sans `>` atteignable, ou avec un guillemet jamais refermé,
 * ce n'est pas une balise : le `<` reste du texte.
 * Temps linéaire : « prochain caractère spécial » précalculé, et mémoire des guillemets ouvrants d'où la recherche a
 * déjà échoué (la suite d'une recherche ne dépend que de la position atteinte : un échec vaut pour tout `<` ultérieur
 * qui y arrive). Chaque guillemet n'est donc parcouru qu'une fois par une recherche qui échoue.
 * @param {string} s
 * @returns {string}
 */
function sansBalises(s) {
  if (s.indexOf('<') === -1) return s;
  const n = s.length;
  const special = new Int32Array(n + 1); // prochain > " ou ' à partir de p (n si aucun)
  const dq = new Int32Array(n + 1); // prochain "
  const sq = new Int32Array(n + 1); // prochain '
  const gt = new Int32Array(n + 1); // prochain >
  special[n] = n; dq[n] = n; sq[n] = n; gt[n] = n;
  for (let p = n - 1; p >= 0; p--) {
    const c = s.charCodeAt(p);
    dq[p] = c === 34 ? p : dq[p + 1];
    sq[p] = c === 39 ? p : sq[p + 1];
    gt[p] = c === 62 ? p : gt[p + 1];
    special[p] = c === 62 || c === 34 || c === 39 ? p : special[p + 1];
  }
  const echoue = new Uint8Array(n + 1);
  /** @type {number[]} */
  const chemin = [];

  /**
   * Position du `>` qui ferme la balise dont le corps commence en p, hors guillemets ; -1 si aucune.
   * @param {number} p
   * @returns {number}
   */
  function finDeBalise(p) {
    chemin.length = 0;
    let q = special[p];
    while (q < n && !echoue[q]) {
      if (s.charCodeAt(q) === 62) return q;
      chemin.push(q);
      const ferme = s.charCodeAt(q) === 34 ? dq[q + 1] : sq[q + 1];
      if (ferme >= n) break;
      q = special[ferme + 1];
    }
    for (const x of chemin) echoue[x] = 1;
    return -1;
  }

  let sortie = '';
  let depuis = 0;
  let i = s.indexOf('<');
  while (i !== -1) {
    let fin = -1;
    let remplacement = '';
    if (s.charCodeAt(i + 1) === 33) { // <! … > : déclaration
      const g = gt[Math.min(i + 2, n)];
      fin = g < n ? g : -1;
    } else {
      const j = s.charCodeAt(i + 1) === 47 ? i + 2 : i + 1;
      if (j < n && estLettre(s.charCodeAt(j))) {
        let k = j;
        while (k < n && estCarMot(s.charCodeAt(k))) k += 1;
        if (BALISES_BLOC.has(s.slice(j, k).toLowerCase())) remplacement = ' ';
        fin = finDeBalise(j);
      }
    }
    if (fin === -1) { i = s.indexOf('<', i + 1); continue; }
    sortie += s.slice(depuis, i) + remplacement;
    depuis = fin + 1;
    i = s.indexOf('<', depuis);
  }
  return sortie + s.slice(depuis);
}

/**
 * Texte brut d'un fragment HTML : blocs `<script>` et `<style>` retirés AVEC leur contenu, commentaires retirés,
 * balises de bloc et `<br>` remplacées par une espace, autres balises retirées, entités décodées, espaces réduits,
 * borné à DESCRIPTION_MAX. Temps LINÉAIRE, même sur du HTML mal formé (balise sans `>`, guillemet jamais refermé) :
 * une fiche abîmée ne doit pas faire tuer l'edge en plein relevé. Ne lève jamais : une valeur qui n'est pas du texte
 * donne ''.
 * @param {unknown} html
 * @returns {string}
 */
export function texteDepuisHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  let t = sansBalises(sansCommentaires(sansScripts(html)));
  t = decoderEntites(t).replace(/\s+/g, ' ').trim();
  if (t.length > DESCRIPTION_MAX) {
    t = t.slice(0, DESCRIPTION_MAX);
    const dernier = t.charCodeAt(t.length - 1);
    if (dernier >= 0xd800 && dernier <= 0xdbff) t = t.slice(0, -1); // pas de demi-paire de substitution
    t = t.trimEnd();
  }
  return t;
}

/**
 * Nom propre : entités décodées, espaces réduits.
 * @param {unknown} nom
 * @returns {string}
 */
function nomPropre(nom) {
  return typeof nom === 'string' ? decoderEntites(nom).replace(/\s+/g, ' ').trim() : '';
}

/**
 * Référence (sku) de la fiche : entités HTML décodées (« 68866 &#8211; 68867 »), espaces réduits ; '' si absente.
 * @param {{ sku?: unknown }|null|undefined} item
 * @returns {string}
 */
function referenceDe(item) {
  return item && item.sku != null ? nomPropre(String(item.sku)) : '';
}

/**
 * Forme de comparaison d'un nom de rayon : entités décodées, sans accents ni casse, espaces réduits.
 * @param {unknown} nom
 * @returns {string}
 */
function normaliser(nom) {
  return nomPropre(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Un rayon de pièces se reconnaît à son nom : « Pièces détachées », « Pièces détachées MCZ », « … divers MCZ ».
 * @param {unknown} nom
 * @returns {boolean}
 */
function estRayonDePieces(nom) {
  return normaliser(nom).startsWith('pieces detachees');
}

/**
 * Rayons de pièces du relevé : ceux dont le nom normalisé commence par « pieces detachees », et tous leurs
 * descendants (« Joints MCZ » sous « Pièces détachées MCZ »). « Conduits de fumées » ou « Poêle à granulés » n'y sont pas.
 * @param {Array<{ id: number, name?: string, parent?: number }>|undefined|null} categories catégories du relevé
 * @returns {Set<number>} identifiants de rayons
 */
export function rayonsDePieces(categories) {
  const liste = Array.isArray(categories) ? categories : [];
  const enfants = new Map();
  for (const c of liste) {
    const parent = c && c.parent ? c.parent : 0;
    if (!enfants.has(parent)) enfants.set(parent, []);
    enfants.get(parent).push(c.id);
  }
  /** @type {Set<number>} */
  const ids = new Set();
  const pile = liste.filter((c) => c && estRayonDePieces(c.name)).map((c) => c.id);
  while (pile.length) {
    const id = pile.pop();
    if (id == null || ids.has(id)) continue;
    ids.add(id);
    for (const e of enfants.get(id) || []) pile.push(e);
  }
  return ids;
}

/**
 * Profondeur d'un rayon dans l'arbre du relevé (racine = 0), bornée contre les boucles.
 * @param {number} id
 * @param {Map<number, { parent?: number }>|null|undefined} categoriesParId
 * @returns {number}
 */
function profondeur(id, categoriesParId) {
  let p = categoriesParId && categoriesParId.get(id) ? categoriesParId.get(id)?.parent : 0;
  let d = 0;
  while (p && categoriesParId && categoriesParId.has(p) && d < 12) { d += 1; p = categoriesParId.get(p)?.parent; }
  return d;
}

/** Début d'un nom de rayon de pièces (avec ses accents tels qu'écrits) et ce qui peut le suivre avant la marque. */
const RE_DEBUT_RAYON = /^\s*pi[èeé]ces\s+d[ée]tach[ée]es\s*/i;

/**
 * Marque d'une fiche, en MAJUSCULES : la marque déclarée (`brands[0].name`), sinon le reste du rayon de pièces le plus
 * profond de la fiche (« Pièces détachées divers MCZ » → « MCZ » ; à profondeur égale, le premier du flux), sinon « DIVERS ».
 * @param {{ brands?: Array<{ name?: string }>, categories?: Array<{ id?: number, name?: string }> }|null|undefined} item fiche du flux
 * @param {Map<number, { name?: string, parent?: number }>|null|undefined} categoriesParId catégories du relevé par identifiant
 * @returns {string}
 */
export function marqueDeLaFiche(item, categoriesParId) {
  const declaree = nomPropre(item && item.brands && item.brands[0] && item.brands[0].name);
  if (declaree) return declaree.toUpperCase();
  let meilleure = null;
  let meilleureProfondeur = -1;
  for (const c of (item && item.categories) || []) {
    const nom = nomPropre(c && c.name);
    if (!c || !estRayonDePieces(nom)) continue;
    const reste = nom.replace(RE_DEBUT_RAYON, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^divers(?![\p{L}\p{N}])\s*/iu, '').trim();
    if (!reste) continue;
    const d = c.id == null ? 0 : profondeur(c.id, categoriesParId);
    if (d > meilleureProfondeur) { meilleure = reste; meilleureProfondeur = d; }
  }
  return meilleure ? meilleure.toUpperCase() : 'DIVERS';
}

/**
 * Division entière arrondie à la demi-unité supérieure (entiers positifs : exact, sans virgule flottante).
 * @param {number} numerateur
 * @param {number} denominateur
 * @returns {number}
 */
function arrondiDemi(numerateur, denominateur) {
  return Math.floor((2 * numerateur + denominateur) / (2 * denominateur));
}

/**
 * Prix affiché au public en centimes d'euro, depuis l'objet `prices` de l'API Store (entier en unité mineure +
 * `currency_minor_unit`, 2 par défaut). null si le prix est absent, non numérique ou ≤ 0.
 * @param {{ prices?: { price?: string|number, currency_minor_unit?: number } }|null|undefined} item
 * @returns {number|null}
 */
function centimesTtc(item) {
  const brut = Number(item && item.prices && item.prices.price);
  if (!Number.isFinite(brut) || brut <= 0) return null;
  const p = Math.round(brut);
  const u = Number(item && item.prices && item.prices.currency_minor_unit);
  const unite = Number.isInteger(u) && u >= 0 && u <= 6 ? u : 2;
  const centimes = unite <= 2 ? p * 10 ** (2 - unite) : arrondiDemi(p, 10 ** (unite - 2));
  return centimes > 0 ? centimes : null;
}

/**
 * Remise du fournisseur en pourcent : valeur finie dans [0 ; 100[, sinon 0.
 * @param {unknown} valeur
 * @returns {number}
 */
function remiseValide(valeur) {
  const r = Number(valeur);
  return Number.isFinite(r) && r > 0 && r < 100 ? r : 0;
}

/**
 * Ligne de catalogue (forme lue par `supplier_pieces_upsert`) pour une fiche retenue.
 * @param {Record<string, any>} item fiche du flux
 * @param {{ ttc: number, remise: number, version: string, releveLe: string, rayons: string[], marque: string }} ctx
 * @returns {Record<string, any>}
 */
function ligneDepuisItem(item, { ttc, remise, version, releveLe, rayons, marque }) {
  const htCentimes = arrondiDemi(ttc * 100, 100 + TVA_PCT);
  const achatCentimes = arrondiDemi(htCentimes * (10000 - Math.round(remise * 100)), 10000);
  const reference = referenceDe(item);
  const fiche = typeof item.permalink === 'string' && item.permalink ? item.permalink : null;
  const photo = item.images && item.images[0] && typeof item.images[0].src === 'string' && item.images[0].src ? item.images[0].src : null;
  const description = texteDepuisHtml(item.description) || texteDepuisHtml(item.short_description);
  return {
    reference,
    name: nomPropre(item.name) || reference,
    brand: marque,
    category: CATEGORIE_PIECE,
    product_kind: 'accessory',
    unit: 'pièce',
    default_tva_rate: TVA_PCT,
    tarif_public: htCentimes / 100,
    taux_remise: remise,
    purchase_price_ht: achatCentimes / 100,
    selling_price_ht_defaut: htCentimes / 100,
    image_url: photo,
    image_source_url: fiche,
    specs: {
      source_version: version,
      canonical: {
        catalogue_pieces: true,
        fiche_produit: fiche,
        rayons,
        prix_public_ttc: ttc / 100,
        stock_releve: { en_stock: item.is_in_stock === true, at: releveLe },
        description_marchand: description,
      },
    },
  };
}

/**
 * Lignes de catalogue de pièces depuis un relevé WooCommerce COMPLET.
 * Une fiche est retenue si elle a un rayon de pièces, le type `simple`, une référence (sku) et un prix > 0. Une pièce en
 * rupture ou non commandable est retenue (elle s'affiche « en rupture au relevé »). Chaque fiche écartée est comptée dans
 * UN SEUL compteur, testé dans l'ordre : hors_rayon, variantes, sans_reference, sans_prix.
 * @param {{ total?: number, fetched_at?: string, items?: Array<Record<string, any>>, categories?: Array<{ id: number, name?: string, parent?: number }> }|null|undefined} releve
 * @param {{ version: string, remisePct?: number|string|null, releveLe: string }} options
 *   version = version du relevé (specs.source_version) ; remisePct = remise du fournisseur en POURCENT (0 par défaut,
 *   valeur invalide = 0) ; releveLe = date du relevé (ISO), rangée avec le stock.
 * @returns {{ lignes: Array<Record<string, any>>, compte: { retenues: number, variantes: number, sans_prix: number, sans_reference: number, hors_rayon: number }, rayons: string[] }}
 * @throws {Error} `releve_incomplet` (moins de fiches que le total annoncé, ou aucune fiche retenue) ; `reference_en_double`
 */
export function piecesDepuisReleveWoocommerce(releve, { version, remisePct = 0, releveLe }) {
  if (!version) throw new Error('version du relevé requise');
  if (!releveLe) throw new Error('releveLe (date du relevé) requis');
  const items = Array.isArray(releve && releve.items) ? /** @type {Array<Record<string, any>>} */ (releve?.items) : [];
  const annonce = Number(releve && releve.total);
  if (Number.isFinite(annonce) && items.length < annonce) {
    throw new Error(`releve_incomplet: ${items.length} fiche(s) pour un total annoncé de ${annonce}`);
  }
  const remise = remiseValide(remisePct);
  const categories = Array.isArray(releve && releve.categories) ? releve?.categories || [] : [];
  const rayonsDePiece = rayonsDePieces(categories);
  const parId = new Map(categories.map((c) => [c.id, c]));

  const compte = { retenues: 0, variantes: 0, sans_prix: 0, sans_reference: 0, hors_rayon: 0 };
  /** @type {Array<Record<string, any>>} */
  const lignes = [];
  const vus = new Set();
  /** @type {Set<string>} */
  const rayonsVus = new Set();
  for (const item of items) {
    /** @type {string[]} */
    const rayonsItem = [];
    for (const c of (item && item.categories) || []) {
      const nom = nomPropre(c && c.name);
      if (c && rayonsDePiece.has(c.id) && nom && !rayonsItem.includes(nom)) rayonsItem.push(nom);
    }
    if (!rayonsItem.length) { compte.hors_rayon += 1; continue; }
    if (item.type !== 'simple') { compte.variantes += 1; continue; }
    const reference = referenceDe(item);
    if (!reference) { compte.sans_reference += 1; continue; }
    const ttc = centimesTtc(item);
    if (ttc == null) { compte.sans_prix += 1; continue; }
    if (vus.has(reference)) throw new Error(`reference_en_double: ${reference}`);
    vus.add(reference);
    for (const r of rayonsItem) rayonsVus.add(r);
    lignes.push(ligneDepuisItem(item, { ttc, remise, version, releveLe, rayons: rayonsItem, marque: marqueDeLaFiche(item, parId) }));
  }
  if (!lignes.length) throw new Error(`releve_incomplet: aucune fiche de pièce retenue sur ${items.length} fiche(s)`);
  compte.retenues = lignes.length;
  return { lignes, compte, rayons: [...rayonsVus] };
}
