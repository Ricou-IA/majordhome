// src/lib/catalogue/baywa.js
// Adaptateur BayWa r.e. (solarshop.baywa-re.fr, NetSuite SuiteCommerce) : relevé brut de l'API `/api/items`
// → lignes de catalogue `supplier_products` (catégorie `batterie`). Module PUR : aucun import, copié pour Deno
// dans supabase/functions/_shared/catalogue/ par `npm run sync:tournee-engine` (ne jamais éditer la copie).
// Spec : docs/superpowers/specs/2026-10-24-module-batterie-catalogue-baywa-design.md (§ 4, § 5).
//
// Périmètre : stockage (« Battery Storage ») toutes marques + accessoires Tesla rangés ailleurs chez BayWa
// (coffrets Kamase pour onduleur hybride Tesla, compteurs, câbles). Les kits (« sur devis », prix fictifs) sont
// toujours exclus. Un relevé incomplet est refusé : l'écrivain désactive les articles absents.

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

const SITE = 'https://solarshop.baywa-re.fr';
const SEUIL_TERTIAIRE_KWH = 20;

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
 * Un article du relevé entre-t-il dans le périmètre importé ?
 * @param {{ itemtype?: string, price?: unknown, ispurchasable?: boolean, fields?: Record<string, unknown> }} item
 * @returns {boolean}
 */
export function estRetenu(item) {
  if (!item || item.itemtype === 'Kit') return false;
  if (!Number.isFinite(Number(item.price))) return false;
  if (item.ispurchasable === false) return false;
  return dansPerimetre(item);
}

/**
 * Stockage toutes marques, ou article Tesla / pour Tesla rangé ailleurs (coffrets Kamase, compteurs, câbles).
 * @param {{ fields?: Record<string, unknown>, displayname?: string, storedisplayname2?: string }} item
 * @returns {boolean}
 */
function dansPerimetre(item) {
  const f = item?.fields || {};
  return f.cseg_itemcategory === 'Battery Storage' || f.custitem_manufacturerfacet === 'Tesla' || /tesla|powerwall/i.test(textes(item));
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
 * Sous-famille lisible d'un article.
 * @param {{ fields?: Record<string, unknown>, displayname?: string, storedisplayname2?: string }} item
 * @returns {string}
 */
export function gammeDe(item) {
  const e = energieUtile(item);
  if (e != null) return e >= SEUIL_TERTIAIRE_KWH ? 'Stockage tertiaire' : 'Batterie';
  const t = textes(item);
  if (/gateway|passerelle/i.test(t)) return 'Passerelle / Gateway';
  if (/meter|compteur|\bCT\b/i.test(t)) return 'Compteur';
  if (/\bbox\b|coffret/i.test(t)) return 'Coffret';
  if (/cable|câble/i.test(t)) return 'Câble';
  return 'Accessoire';
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
 * Transforme un article du relevé en ligne de catalogue.
 * @param {Record<string, any>} item
 * @param {{ version: string, releveAt: string }} ctx
 * @returns {Record<string, any>}
 */
function ligneDepuisItem(item, { version, releveAt }) {
  const f = item.fields || {};
  const e = energieUtile(item);
  const dims = [f.custitem_pacejetitemlength, f.custitem_pacejetitemwidth, f.custitem_pacejetitemheight].map(nombre);
  const canonical = {
    mpn: f.mpn || null,
    fabricant: f.custitem_manufacturerfacet || null,
    energie_utile_kwh: e,
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
  return {
    reference: String(item.itemid),
    name: nommer(item),
    brand: f.custitem_manufacturerfacet || null,
    gamme: gammeDe(item),
    product_kind: e != null ? 'main' : 'accessory',
    purchase_price_ht: Math.round(Number(item.price) * 100) / 100,
    selling_price_ht_defaut: PRIX_PUBLIC_TESLA_HT[prefixeMpn(item)] || 0,
    default_tva_rate: 20,
    unit: 'pièce',
    category: 'batterie',
    specs: { canonical, source_version: version },
  };
}

/**
 * Lignes de catalogue depuis un relevé BayWa complet.
 * @param {{ total?: number, fetched_at?: string, items: Array<Record<string, any>> }} releve
 * @param {{ version: string }} options
 * @returns {{ lignes: Array<Record<string, any>>, retenus: number, exclus: { kits: number, sans_prix: number, non_achetable: number, hors_perimetre: number }, releve_at: string|null }}
 */
export function articlesDepuisReleveBaywa(releve, { version }) {
  const items = Array.isArray(releve?.items) ? releve.items : [];
  if (!items.length || (Number.isFinite(Number(releve?.total)) && items.length < Number(releve.total))) {
    throw new Error(`releve_incomplet: ${items.length} article(s) pour un total annoncé de ${releve?.total}`);
  }
  const releveAt = releve.fetched_at || null;
  const exclus = { kits: 0, sans_prix: 0, non_achetable: 0, hors_perimetre: 0 };
  const lignes = [];
  const vus = new Set();
  for (const item of items) {
    // Le périmètre d'abord : les 61 kits « sur devis » hors stockage ne sont pas comptés comme des kits exclus,
    // seuls ceux du périmètre (13 sets SMA / Huawei le 2026-10-24) le sont.
    if (!dansPerimetre(item)) { exclus.hors_perimetre += 1; continue; }
    if (item.itemtype === 'Kit') { exclus.kits += 1; continue; }
    if (!Number.isFinite(Number(item.price))) { exclus.sans_prix += 1; continue; }
    if (item.ispurchasable === false) { exclus.non_achetable += 1; continue; }
    if (vus.has(item.itemid)) throw new Error(`reference_en_double: ${item.itemid}`);
    vus.add(item.itemid);
    lignes.push(ligneDepuisItem(item, { version, releveAt }));
  }
  return { lignes, retenus: lignes.length, exclus, releve_at: releveAt };
}
