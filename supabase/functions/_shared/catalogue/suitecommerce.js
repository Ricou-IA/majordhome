// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/catalogue/suitecommerce.js — ne pas éditer.
// src/lib/catalogue/suitecommerce.js
// Adaptateur NetSuite SuiteCommerce (BayWa r.e., solarshop.baywa-re.fr) : relevé brut de l'API `/api/items` →
// lignes de catalogue `supplier_products`. Module PUR : aucun import autre que les modules purs voisins, copié
// pour Deno dans supabase/functions/_shared/catalogue/ par `npm run sync:tournee-engine` (ne jamais éditer la copie).
// Spec : 2026-10-24-module-batterie-catalogue-baywa-design.md (§ 4, § 5) + tranche 2
// 2026-10-24-catalogue-photovoltaique-connexion-generique-design.md (§ 4 : périmètre complet, mapping, photo,
// clé modèle). Les kits (« sur devis », prix fictifs) sont toujours exclus ; un relevé incomplet est refusé.
import { calculerModelKey } from './modelKey.js';
import { categorieMajordhome, DEFAUTS_MAPPING, CLE_SANS_CATEGORIE } from './mapping.js';

/** Prix publics Tesla HT (capture tesla.com du 2026-10-24), par préfixe (7 premiers caractères) de référence fabricant. */
export const PRIX_PUBLIC_TESLA_HT = Object.freeze({
  1707000: 5500, // Powerwall 3 seule
  1152100: 1150, // Backup Gateway 2 (= 6 650 − 5 500)
  1807000: 4780, // Unité d'extension DC (= 10 280 − 5 500)
});

/** Libellés français des références Tesla principales, par préfixe de référence fabricant. */
export const LIBELLES_FR_TESLA = Object.freeze({
  1707000: 'Tesla Powerwall 3 – batterie 13,5 kWh / 11 kW AC',
  1807000: 'Tesla Powerwall 3 – unité d\'extension DC 13,5 kWh',
  1152100: 'Tesla Backup Gateway 2',
  2083764: 'Tesla Remote Meter – kit compteur monophasé (RS485)',
  2302439: 'Tesla Remote Meter – kit compteur triphasé (RS485)',
});

/** Gammes FR des familles du site hors stockage (cseg_itemcategory). */
const GAMMES_SUITECOMMERCE = Object.freeze({
  PV: 'Modules PV',
  Inverters: 'Onduleurs',
  'Inverter Accessories': 'Accessoires onduleur',
  'Mounting Systems': 'Fixation',
  Electrical: 'Électrique',
  'E-Mobility': 'Bornes de recharge',
  Diverse: 'Divers',
});

const SITE = 'https://solarshop.baywa-re.fr';
const SEUIL_TERTIAIRE_KWH = 20;
const FAMILLES_PRINCIPALES = new Set(['PV', 'Inverters', 'E-Mobility']);

/**
 * Nombre depuis une valeur BayWa (« 13,5 », « 261,0 », « 89,0% »).
 * @param {unknown} v
 * @returns {number|null}
 */
function nombre(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Préfixe (7 caractères) de la référence fabricant d'un article.
 * @param {{ fields?: { mpn?: string } }} item
 * @returns {string}
 */
function prefixeMpn(item) {
  return String(item?.fields?.mpn || '').slice(0, 7);
}

/**
 * Textes d'un article (titre, libellés) concaténés pour les recherches de mots-clés.
 * @param {{ displayname?: string, storedisplayname2?: string, fields?: { custitem_itemtitle?: string } }} item
 * @returns {string}
 */
function textes(item) {
  return [item?.fields?.custitem_itemtitle, item?.displayname, item?.storedisplayname2].filter(Boolean).join(' ');
}

/**
 * Énergie utile (kWh) d'un article, null pour un accessoire.
 * @param {{ fields?: { custitem_usableenergy?: string } }} item
 * @returns {number|null}
 */
function energieUtile(item) {
  const e = nombre(item?.fields?.custitem_usableenergy);
  return e != null && e > 0 ? e : null;
}

/**
 * Clés de catégorie du site d'un article (famille cseg_itemcategory), vide si absente.
 * @param {{ fields?: { cseg_itemcategory?: string } }} item
 * @returns {string[]}
 */
function clesCategorie(item) {
  const c = item?.fields?.cseg_itemcategory;
  return c ? [String(c)] : [];
}

/**
 * Article Tesla ou pour Tesla (coffrets Kamase, compteurs, câbles) : rangé en batterie même hors stockage.
 * @param {Record<string, any>} item
 * @returns {boolean}
 */
function estTesla(item) {
  return item?.fields?.custitem_manufacturerfacet === 'Tesla' || /tesla|powerwall/i.test(textes(item));
}

/**
 * Libellé français d'un article : table Tesla d'abord, puis le libellé qui ressemble à une phrase.
 * @param {{ displayname?: string, storedisplayname2?: string, fields?: { mpn?: string, custitem_itemtitle?: string } }} item
 * @returns {string}
 */
export function nommer(item) {
  const fr = LIBELLES_FR_TESLA[prefixeMpn(item)];
  if (fr) return fr;
  const d = String(item?.displayname || '').trim();
  const ressembleAUnePhrase = d.includes(' ') && !/^[A-Z0-9 ._/()+-]+$/.test(d);
  if (ressembleAUnePhrase) return d;
  return String(item?.storedisplayname2 || item?.fields?.custitem_itemtitle || d).trim();
}

/**
 * Sous-famille lisible d'un article : stockage (ou article rangé en batterie) par énergie et mots-clés,
 * sinon la gamme FR de sa famille du site.
 * @param {{ fields?: Record<string, unknown>, displayname?: string, storedisplayname2?: string }} item
 * @param {'batterie'|'photovoltaique'|null} [categorie]
 * @returns {string}
 */
export function gammeDe(item, categorie = null) {
  const cseg = item?.fields?.cseg_itemcategory;
  if (cseg === 'Battery Storage' || categorie === 'batterie') {
    const e = energieUtile(item);
    if (e != null) return e >= SEUIL_TERTIAIRE_KWH ? 'Stockage tertiaire' : 'Batterie';
    const t = textes(item);
    if (/gateway|passerelle/i.test(t)) return 'Passerelle / Gateway';
    if (/meter|compteur|\bCT\b/i.test(t)) return 'Compteur';
    if (/\bbox\b|coffret/i.test(t)) return 'Coffret';
    if (/cable|câble/i.test(t)) return 'Câble';
    return 'Accessoire';
  }
  return GAMMES_SUITECOMMERCE[cseg] || 'Divers';
}

/**
 * URL absolue de la fiche technique (FR, sinon EN), ou null.
 * @param {{ docs?: Array<{ type?: string, lang?: string, url?: string }> }} item
 * @returns {string|null}
 */
function ficheTechnique(item) {
  const docs = (item?.docs || []).filter((d) => /data\s*sheet|fiche/i.test(d.type || '') && d.url);
  const doc = docs.find((d) => d.lang === 'FR') || docs.find((d) => d.lang === 'EN') || null;
  if (!doc) return null;
  return doc.url.startsWith('http') ? doc.url : SITE + doc.url;
}

/**
 * Première URL d'image trouvée dans `itemimages_detail` (chaîne, ou objet NetSuite imbriqué), absolue, ou null.
 * @param {unknown} v
 * @returns {string|null}
 */
function premiereImage(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.startsWith('http') ? v : SITE + v;
  if (Array.isArray(v)) { for (const x of v) { const u = premiereImage(x); if (u) return u; } return null; }
  if (typeof v === 'object') {
    if (typeof v.url === 'string') return premiereImage(v.url);
    for (const k of Object.keys(v)) { const u = premiereImage(v[k]); if (u) return u; }
  }
  return null;
}

/**
 * Transforme un article du relevé en ligne de catalogue.
 * @param {Record<string, any>} item
 * @param {{ version: string, releveAt: string|null, categorie: 'batterie'|'photovoltaique' }} ctx
 * @returns {Record<string, any>}
 */
function ligneDepuisItem(item, { version, releveAt, categorie }) {
  const f = item.fields || {};
  const e = energieUtile(item);
  const cseg = f.cseg_itemcategory;
  const dims = [f.custitem_pacejetitemlength, f.custitem_pacejetitemwidth, f.custitem_pacejetitemheight].map(nombre);
  const brand = f.custitem_manufacturerfacet || null;
  const canonical = {
    mpn: f.mpn || null,
    fabricant: brand,
    categories_site: clesCategorie(item),
    energie_utile_kwh: e,
    puissance_wc: nombre(f.custitem_itemwatt),
    type_batterie: f.custitem_batterytype ? String(f.custitem_batterytype).trim() : null,
    technologie_cellules: f.custitem_batterycelltechnology || null,
    garantie_produit_ans: nombre(f.custitem_productwarrantysc),
    garantie_perf_ans: nombre(f.custitem_perfwarrantysc),
    dimensions_cm: dims.every((d) => d != null && d > 0) ? dims.map((d) => String(d).replace('.', ',')).join(' × ') : null,
    poids_kg: nombre(f.weight),
    fiche_technique_fr: ficheTechnique(item),
    baywa_internalid: item.internalid ?? null,
    stock_releve: { qty: Number.isFinite(Number(item.quantityavailable)) ? Number(item.quantityavailable) : null, at: releveAt },
  };
  for (const k of Object.keys(canonical)) if (canonical[k] == null) delete canonical[k];
  const principal = e != null || FAMILLES_PRINCIPALES.has(cseg);
  return {
    reference: String(item.itemid),
    name: nommer(item),
    brand,
    gamme: gammeDe(item, categorie),
    product_kind: principal ? 'main' : 'accessory',
    purchase_price_ht: Math.round(Number(item.price) * 100) / 100,
    selling_price_ht_defaut: PRIX_PUBLIC_TESLA_HT[prefixeMpn(item)] || 0,
    default_tva_rate: 20,
    unit: 'pièce',
    category: categorie,
    image_url: premiereImage(item.itemimages_detail),
    image_source_url: item.urlcomponent ? `${SITE}/${String(item.urlcomponent).replace(/^\/+/, '')}` : null,
    // Référence fabricant d'abord (la plus sûre quand elle porte des lettres : Tesla), puis les libellés.
    model_key: calculerModelKey(brand, [f.mpn, f.custitem_itemtitle, item.storedisplayname2, item.displayname]),
    specs: { canonical, source_version: version },
  };
}

/**
 * Lignes de catalogue depuis un relevé SuiteCommerce complet.
 * @param {{ total?: number, fetched_at?: string, items: Array<Record<string, any>> }} releve
 * @param {{ version: string, mapping?: Record<string, string>|null }} options
 * @returns {{ lignes: Array<Record<string, any>>, retenus: number, exclus: { kits: number, sans_prix: number, non_achetable: number, par_mapping: number }, releve_at: string|null, categories_vues: Array<{ cle: string, libelle: string, parent: string|null, nombre: number }> }}
 */
export function articlesDepuisReleveSuitecommerce(releve, { version, mapping = null }) {
  const items = Array.isArray(releve?.items) ? releve.items : [];
  if (!items.length || (Number.isFinite(Number(releve?.total)) && items.length < Number(releve.total))) {
    throw new Error(`releve_incomplet: ${items.length} article(s) pour un total annoncé de ${releve?.total}`);
  }
  const releveAt = releve.fetched_at || null;
  const defauts = DEFAUTS_MAPPING.suitecommerce;
  const exclus = { kits: 0, sans_prix: 0, non_achetable: 0, par_mapping: 0 };
  const lignes = [];
  const vus = new Set();
  const vuesParCle = new Map();
  for (const item of items) {
    if (item.itemtype === 'Kit') { exclus.kits += 1; continue; }
    const cles = clesCategorie(item);
    for (const c of (cles.length ? cles : [CLE_SANS_CATEGORIE])) vuesParCle.set(c, (vuesParCle.get(c) || 0) + 1);
    if (!Number.isFinite(Number(item.price))) { exclus.sans_prix += 1; continue; }
    if (item.ispurchasable === false) { exclus.non_achetable += 1; continue; }
    let categorie = categorieMajordhome(cles, mapping, defauts);
    if (categorie === 'photovoltaique' && estTesla(item)) categorie = 'batterie';
    if (!categorie) { exclus.par_mapping += 1; continue; }
    if (vus.has(item.itemid)) throw new Error(`reference_en_double: ${item.itemid}`);
    vus.add(item.itemid);
    lignes.push(ligneDepuisItem(item, { version, releveAt, categorie }));
  }
  const categories_vues = [...vuesParCle.entries()].map(([cle, nombre]) => ({
    cle, libelle: cle === CLE_SANS_CATEGORIE ? 'Sans catégorie' : cle, parent: null, nombre,
  }));
  return { lignes, retenus: lignes.length, exclus, releve_at: releveAt, categories_vues };
}
