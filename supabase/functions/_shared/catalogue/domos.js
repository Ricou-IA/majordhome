// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/catalogue/domos.js — ne pas éditer.
// src/lib/catalogue/domos.js
// Adaptateur Domos Industries (webshop.domosindustries.com, WooCommerce) : relevé brut de l'API Store
// (`/wp-json/wc/store/v1/products`, prix HT en centimes) → lignes de catalogue `supplier_products`
// (catégorie `batterie`). Module PUR : aucun import, copié pour Deno dans supabase/functions/_shared/catalogue/
// par `npm run sync:tournee-engine` (ne jamais éditer la copie).
// Spec : docs/superpowers/specs/2026-10-24-module-batterie-catalogue-baywa-design.md (§ 7 « Domos »).
//
// Périmètre : le stockage (batteries AC / DC, accessoires de stockage, kits de stockage). Les bundles
// (`type !== 'simple'`, sans prix ni SKU) sont exclus. Un relevé incomplet est refusé.

/** Slugs de catégorie Domos qui constituent le périmètre « stockage ». */
export const SLUGS_STOCKAGE = Object.freeze([
  'systeme-de-stockage', 'batteries-ac', 'batteries-dc', 'accessoires-systeme-de-stockage', 'kits-de-stockage', 'kit-batterie',
]);

const RE_KWH = /(\d+(?:[.,]\d+)?)\s*kwh/i;

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
 * Sous-famille lisible d'un article du périmètre.
 * @param {{ categories?: Array<{ slug?: string }> }} item
 * @returns {string}
 */
export function gammeDe(item) {
  const s = slugs(item);
  if (s.includes('batteries-ac')) return 'Batterie AC';
  if (s.includes('batteries-dc')) return 'Batterie DC';
  if (s.includes('kits-de-stockage') || s.includes('kit-batterie')) return 'Kit de stockage';
  return 'Accessoire stockage';
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
 * Un article du relevé entre-t-il dans le périmètre importé ?
 * @param {{ type?: string, sku?: string, prices?: object, categories?: Array<{ slug?: string }> }} item
 * @returns {boolean}
 */
export function estRetenu(item) {
  if (!item || item.type !== 'simple' || !item.sku) return false;
  const p = prixHt(item);
  if (p == null || p <= 0) return false;
  return slugs(item).some((s) => SLUGS_STOCKAGE.includes(s));
}

/**
 * Transforme un article du relevé en ligne de catalogue.
 * @param {Record<string, any>} item
 * @param {{ version: string, releveAt: string|null }} ctx
 * @returns {Record<string, any>}
 */
function ligneDepuisItem(item, { version, releveAt }) {
  const e = energieUtile(item);
  const s = slugs(item);
  const estBatterie = (s.includes('batteries-ac') || s.includes('batteries-dc')) && e != null;
  const attributs = {};
  for (const a of item.attributes || []) if (a?.name) attributs[a.name] = (a.terms || []).join(', ');
  const canonical = {
    domos_id: item.id ?? null,
    slug: item.slug || null,
    fiche_produit: item.permalink || null,
    image: item.image || null,
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
    brand: marqueDe(item),
    gamme: gammeDe(item),
    product_kind: estBatterie ? 'main' : 'accessory',
    purchase_price_ht: prixHt(item),
    selling_price_ht_defaut: 0,
    default_tva_rate: 20,
    unit: 'pièce',
    category: 'batterie',
    specs: { canonical, source_version: version },
  };
}

/**
 * Lignes de catalogue depuis un relevé Domos complet.
 * @param {{ total?: number, fetched_at?: string, items: Array<Record<string, any>> }} releve
 * @param {{ version: string }} options
 * @returns {{ lignes: Array<Record<string, any>>, retenus: number, exclus: { kits: number, sans_prix: number, non_achetable: number, hors_perimetre: number }, releve_at: string|null }}
 */
export function articlesDepuisReleveDomos(releve, { version }) {
  const items = Array.isArray(releve?.items) ? releve.items : [];
  if (!items.length || (Number.isFinite(Number(releve?.total)) && items.length < Number(releve.total))) {
    throw new Error(`releve_incomplet: ${items.length} article(s) pour un total annoncé de ${releve?.total}`);
  }
  const releveAt = releve.fetched_at || null;
  const exclus = { kits: 0, sans_prix: 0, non_achetable: 0, hors_perimetre: 0 };
  const lignes = [];
  const vus = new Set();
  for (const item of items) {
    const dansPerimetre = slugs(item).some((s) => SLUGS_STOCKAGE.includes(s));
    if (!dansPerimetre) { exclus.hors_perimetre += 1; continue; }
    if (item.type !== 'simple') { exclus.kits += 1; continue; }
    const p = prixHt(item);
    if (p == null || p <= 0 || !item.sku) { exclus.sans_prix += 1; continue; }
    if (item.is_purchasable === false) { exclus.non_achetable += 1; continue; }
    if (vus.has(item.sku)) throw new Error(`reference_en_double: ${item.sku}`);
    vus.add(item.sku);
    lignes.push(ligneDepuisItem(item, { version, releveAt }));
  }
  return { lignes, retenus: lignes.length, exclus, releve_at: releveAt };
}
