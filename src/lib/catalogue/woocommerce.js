// src/lib/catalogue/woocommerce.js
// Adaptateur WooCommerce (Domos Industries, webshop.domosindustries.com) : relevé brut de l'API Store
// (`/wp-json/wc/store/v1/products`, prix HT en centimes) → lignes de catalogue `supplier_products`. Module PUR
// (copié pour Deno par `npm run sync:tournee-engine`, ne jamais éditer la copie).
// Spec : 2026-10-24-module-batterie-catalogue-baywa-design.md (§ 7) + tranche 2
// 2026-10-24-catalogue-photovoltaique-connexion-generique-design.md (§ 4 : périmètre complet, mapping par slug,
// gamme = sous-catégorie la plus précise, photo, clé modèle). Bundles exclus, relevé incomplet refusé.
import { calculerModelKey } from './modelKey.js';
import { categorieMajordhome, DEFAUTS_MAPPING, CLE_SANS_CATEGORIE } from './mapping.js';

/** Slugs de catégorie Domos qui constituent le périmètre « stockage » (gammes de la tranche 1). */
export const SLUGS_STOCKAGE = Object.freeze([
  'systeme-de-stockage', 'batteries-ac', 'batteries-dc', 'accessoires-systeme-de-stockage', 'kits-de-stockage', 'kit-batterie',
]);

const RE_KWH = /(\d+(?:[.,]\d+)?)\s*kwh/i;
const SLUGS_PRINCIPAUX = /^(panneaux-solaires|onduleur-central|micro-onduleur|onduleurs-micro-onduleurs|borne-de-recharge|batteries-ac|batteries-dc)$/;

/**
 * Slugs de catégorie d'un article.
 * @param {{ categories?: Array<{ slug?: string }> }} item
 * @returns {string[]}
 */
function slugs(item) {
  return (item?.categories || []).map((c) => c.slug).filter(Boolean);
}

/**
 * Prix HT en euros depuis l'objet `prices` de l'API Store (centimes + `currency_minor_unit`).
 * @param {{ prices?: { price?: string|number, currency_minor_unit?: number } }} item
 * @returns {number|null}
 */
export function prixHt(item) {
  const p = Number(item?.prices?.price);
  if (!Number.isFinite(p)) return null;
  const unite = Number.isFinite(Number(item.prices.currency_minor_unit)) ? Number(item.prices.currency_minor_unit) : 2;
  return Math.round(p) / 10 ** unite;
}

/**
 * Marque = premier mot du nom (« ATMOCE – … », « LIVOLTEK-BATTERIE … », « PYLONTECH -Batterie … »).
 * @param {{ name?: string }} item
 * @returns {string|null}
 */
export function marqueDe(item) {
  const m = String(item?.name || '').trim().match(/^[A-Za-zÀ-ÿ0-9]+/);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Capacité (kWh) lue dans le nom, null si absente.
 * @param {{ name?: string }} item
 * @returns {number|null}
 */
function energieUtile(item) {
  const m = String(item?.name || '').match(RE_KWH);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/**
 * Index des catégories du relevé : id → { name, slug, parent, profondeur }.
 * @param {{ categories?: Array<{ id: number, name: string, slug: string, parent: number }> }} releve
 * @returns {Map<number, { name: string, slug: string, parent: number, profondeur: number }>}
 */
function indexCategories(releve) {
  const parId = new Map();
  for (const c of releve?.categories || []) parId.set(c.id, { name: c.name, slug: c.slug, parent: c.parent || 0, profondeur: 0 });
  for (const c of parId.values()) {
    let p = c.parent; let d = 0;
    while (p && parId.has(p) && d < 10) { d += 1; p = parId.get(p).parent; }
    c.profondeur = d;
  }
  return parId;
}

/**
 * Gamme d'un article : tranche 1 pour le stockage, sinon le nom de sa catégorie la plus précise (la plus profonde).
 * @param {{ categories?: Array<{ id?: number, name?: string, slug?: string }> }} item
 * @param {'batterie'|'photovoltaique'} categorie
 * @param {Map<number, { profondeur: number }>} index
 * @returns {string}
 */
export function gammeDe(item, categorie, index) {
  const s = slugs(item);
  if (categorie === 'batterie') {
    if (s.includes('batteries-ac')) return 'Batterie AC';
    if (s.includes('batteries-dc')) return 'Batterie DC';
    if (s.includes('kits-de-stockage') || s.includes('kit-batterie')) return 'Kit de stockage';
    return 'Accessoire stockage';
  }
  const cats = (item?.categories || []).filter((c) => c?.name);
  if (!cats.length) return 'Sans catégorie';
  const plusPrecise = cats.reduce((best, c) => {
    const p = index?.get(c.id)?.profondeur ?? 0;
    return p > best.p ? { c, p } : best;
  }, { c: cats[0], p: index?.get(cats[0].id)?.profondeur ?? 0 });
  return String(plusPrecise.c.name).trim();
}

/**
 * Transforme un article du relevé en ligne de catalogue.
 * @param {Record<string, any>} item
 * @param {{ version: string, releveAt: string|null, categorie: 'batterie'|'photovoltaique', index: Map<number, any> }} ctx
 * @returns {Record<string, any>}
 */
function ligneDepuisItem(item, { version, releveAt, categorie, index }) {
  const e = energieUtile(item);
  const s = slugs(item);
  const principal = categorie === 'batterie'
    ? (s.includes('batteries-ac') || s.includes('batteries-dc')) && e != null
    : s.some((x) => SLUGS_PRINCIPAUX.test(x));
  const attributs = {};
  for (const a of item.attributes || []) if (a?.name) attributs[a.name] = (a.terms || []).join(', ');
  const brand = marqueDe(item);
  const canonical = {
    domos_id: item.id ?? null,
    slug: item.slug || null,
    fiche_produit: item.permalink || null,
    categories_site: s,
    categories: (item.categories || []).map((c) => c.name).filter(Boolean).join(' / ') || null,
    energie_utile_kwh: e,
    description_courte: item.short_description ? String(item.short_description).slice(0, 600) : null,
    stock_releve: { en_stock: item.is_in_stock === true, at: releveAt },
    ...(Object.keys(attributs).length ? { attributs } : {}),
  };
  for (const k of Object.keys(canonical)) if (canonical[k] == null) delete canonical[k];
  return {
    reference: String(item.sku),
    name: String(item.name).trim(),
    brand,
    gamme: gammeDe(item, categorie, index),
    product_kind: principal ? 'main' : 'accessory',
    purchase_price_ht: prixHt(item),
    selling_price_ht_defaut: 0,
    default_tva_rate: 20,
    unit: 'pièce',
    category: categorie,
    image_url: item.image || null,
    image_source_url: item.permalink || null,
    model_key: calculerModelKey(brand, [item.name]),
    specs: { canonical, source_version: version },
  };
}

/**
 * Lignes de catalogue depuis un relevé WooCommerce complet.
 * @param {{ total?: number, fetched_at?: string, items: Array<Record<string, any>>, categories?: Array<Record<string, any>> }} releve
 * @param {{ version: string, mapping?: Record<string, string>|null }} options
 * @returns {{ lignes: Array<Record<string, any>>, retenus: number, exclus: { kits: number, sans_prix: number, non_achetable: number, par_mapping: number }, releve_at: string|null, categories_vues: Array<{ cle: string, libelle: string, parent: string|null, nombre: number }> }}
 */
export function articlesDepuisReleveWoocommerce(releve, { version, mapping = null }) {
  const items = Array.isArray(releve?.items) ? releve.items : [];
  if (!items.length || (Number.isFinite(Number(releve?.total)) && items.length < Number(releve.total))) {
    throw new Error(`releve_incomplet: ${items.length} article(s) pour un total annoncé de ${releve?.total}`);
  }
  const releveAt = releve.fetched_at || null;
  const index = indexCategories(releve);
  const defauts = DEFAUTS_MAPPING.woocommerce;
  const exclus = { kits: 0, sans_prix: 0, non_achetable: 0, par_mapping: 0 };
  const lignes = [];
  const vus = new Set();
  const vuesParCle = new Map();
  const libelles = new Map();
  for (const item of items) {
    if (item.type !== 'simple') { exclus.kits += 1; continue; }
    const s = slugs(item);
    for (const c of (item.categories || [])) if (c?.slug) libelles.set(c.slug, { libelle: c.name, parent: index.get(index.get(c.id)?.parent)?.name || null });
    for (const c of (s.length ? s : [CLE_SANS_CATEGORIE])) vuesParCle.set(c, (vuesParCle.get(c) || 0) + 1);
    const p = prixHt(item);
    if (p == null || p <= 0 || !item.sku) { exclus.sans_prix += 1; continue; }
    if (item.is_purchasable === false) { exclus.non_achetable += 1; continue; }
    const categorie = categorieMajordhome(s, mapping, defauts);
    if (!categorie) { exclus.par_mapping += 1; continue; }
    if (vus.has(item.sku)) throw new Error(`reference_en_double: ${item.sku}`);
    vus.add(item.sku);
    lignes.push(ligneDepuisItem(item, { version, releveAt, categorie, index }));
  }
  const categories_vues = [...vuesParCle.entries()].map(([cle, nombre]) => ({
    cle,
    libelle: cle === CLE_SANS_CATEGORIE ? 'Sans catégorie' : (libelles.get(cle)?.libelle || cle),
    parent: cle === CLE_SANS_CATEGORIE ? null : (libelles.get(cle)?.parent || null),
    nombre,
  }));
  return { lignes, retenus: lignes.length, exclus, releve_at: releveAt, categories_vues };
}
