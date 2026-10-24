// src/lib/catalogue/releve.js
// Allègement d'un relevé fournisseur avant envoi à l'edge supplier-catalog-sync (import de fichier depuis l'app).
// Un relevé brut pèse 1,5 à 3 Mo (descriptions, détails de prix) ; on ne transmet que les champs lus par les
// adaptateurs, et l'adaptateur produit exactement les mêmes lignes (testé scripts/catalogue/releve.test.mjs).
// Module PUR. La règle d'écriture reste côté edge / RPC : ici on ne fait que retirer des champs.

const CHAMPS = Object.freeze({
  suitecommerce: ['internalid', 'itemid', 'displayname', 'storedisplayname2', 'urlcomponent', 'itemtype', 'price', 'ispurchasable', 'isbackorderable', 'quantityavailable', 'fields', 'docs', 'itemimages_detail'],
  woocommerce: ['id', 'name', 'slug', 'sku', 'permalink', 'type', 'prices', 'is_in_stock', 'is_purchasable', 'categories', 'attributes', 'short_description', 'image'],
});

/** SuiteCommerce : clés de `fields` (custitem_webshopjson) lues par l'adaptateur — le reste (certifications, extensions…) est retiré. */
const FIELDS_SUITECOMMERCE = Object.freeze([
  'mpn', 'custitem_manufacturerfacet', 'cseg_itemcategory', 'custitem_itemtitle', 'custitem_usableenergy', 'custitem_itemwatt',
  'custitem_batterytype', 'custitem_batterycelltechnology', 'custitem_productwarrantysc', 'custitem_perfwarrantysc',
  'custitem_pacejetitemlength', 'custitem_pacejetitemwidth', 'custitem_pacejetitemheight', 'weight',
]);

/**
 * Relevé réduit aux champs utiles à l'adaptateur du connecteur. Connecteur inconnu ou relevé sans items : renvoyé
 * tel quel. Les catégories du relevé (WooCommerce) sont conservées : l'adaptateur en tire parents et gammes.
 * @param {string} connector 'suitecommerce' | 'woocommerce'
 * @param {{ total?: number, fetched_at?: string, source?: string, items?: Array<Record<string, any>>, categories?: Array<Record<string, any>> }} releve
 * @returns {Record<string, any>}
 */
export function allegerReleve(connector, releve) {
  const champs = CHAMPS[connector];
  if (!champs || !releve || !Array.isArray(releve.items)) return releve;
  const items = releve.items.map((it) => {
    const o = {};
    for (const k of champs) if (it[k] !== undefined) o[k] = it[k];
    if (connector === 'suitecommerce' && o.fields && typeof o.fields === 'object') {
      const f = {};
      for (const k of FIELDS_SUITECOMMERCE) if (o.fields[k] !== undefined) f[k] = o.fields[k];
      o.fields = f;
    }
    return o;
  });
  const out = { source: releve.source, fetched_at: releve.fetched_at, total: releve.total, items };
  if (Array.isArray(releve.categories)) out.categories = releve.categories;
  return out;
}
