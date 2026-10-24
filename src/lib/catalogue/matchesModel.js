// src/lib/catalogue/matchesModel.js
// Mise en forme des rapprochements entre fournisseurs (vue majordhome_catalog_matches) — module PUR, testé
// (scripts/catalogue/matches-model.test.mjs). Ne calcule rien d'autre que l'écart et ne touche jamais la base.

/**
 * Écart relatif de `b` par rapport à `a`, en %, une décimale ; null si `a` n'est pas un prix positif.
 * @param {number|null|undefined} a
 * @param {number|null|undefined} b
 * @returns {number|null}
 */
export function ecartPct(a, b) {
  const pa = Number(a); const pb = Number(b);
  if (!Number.isFinite(pa) || !Number.isFinite(pb) || pa <= 0) return null;
  return Math.round(((pb - pa) / pa) * 1000) / 10;
}

/**
 * Prix HT lisible et PDF-safe : « 2 119,94 € HT » (espace ordinaire des milliers, virgule décimale).
 * @param {number|null|undefined} v
 * @returns {string}
 */
export function formatPrixHt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const [ent, dec] = n.toFixed(2).split('.');
  const entiers = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${entiers},${dec} € HT`;
}

/**
 * Le fournisseur « d'en face » d'un rapprochement, vu depuis un produit ; l'écart est celui de l'autre par rapport
 * à MOI (positif = l'autre est plus cher). null si le produit n'est pas dans la paire.
 * @param {Record<string, any>} match ligne de la vue majordhome_catalog_matches
 * @param {string} productId
 * @returns {{ matchId: string, statut: string, productId: string, name: string, reference: string|null, supplierId: string, supplierName: string, purchase: number|null, ecartPct: number|null }|null}
 */
export function autreCote(match, productId) {
  if (!match) return null;
  let moi; let autre;
  if (match.product_a_id === productId) { moi = 'a'; autre = 'b'; }
  else if (match.product_b_id === productId) { moi = 'b'; autre = 'a'; }
  else return null;
  return {
    matchId: match.id,
    statut: match.statut,
    productId: match[`product_${autre}_id`],
    name: match[`product_${autre}_name`],
    reference: match[`product_${autre}_reference`] ?? null,
    supplierId: match[`supplier_${autre}_id`],
    supplierName: match[`supplier_${autre}_name`],
    purchase: match[`product_${autre}_purchase`] ?? null,
    ecartPct: ecartPct(match[`product_${moi}_purchase`], match[`product_${autre}_purchase`]),
  };
}

/**
 * « DOMOS INDUSTRIES : 2 119,94 € HT (+5,9 %) », « … (-5,6 %, moins cher) », « … (même prix) ».
 * @param {{ supplierName: string, purchase: number|null, ecartPct: number|null }|null} cote
 * @returns {string}
 */
export function libelleAussiChez(cote) {
  if (!cote) return '';
  const prix = formatPrixHt(cote.purchase);
  const e = cote.ecartPct;
  if (e == null) return `${cote.supplierName} : ${prix}`;
  const pct = `${e > 0 ? '+' : ''}${String(e).replace('.', ',')} %`;
  if (e === 0) return `${cote.supplierName} : ${prix} (même prix)`;
  return `${cote.supplierName} : ${prix} (${pct}${e < 0 ? ', moins cher' : ''})`;
}

/**
 * Tri d'une liste de rapprochements : écart absolu décroissant (null en dernier), proposition avant confirmation
 * à écart égal.
 * @param {Array<Record<string, any>>} liste
 * @returns {Array<Record<string, any>>}
 */
export function trierParEcart(liste) {
  const rang = (m) => (m.statut === 'propose' ? 0 : 1);
  return [...(liste || [])].sort((x, y) => {
    const ex = x.ecart_pct == null ? -1 : Math.abs(Number(x.ecart_pct));
    const ey = y.ecart_pct == null ? -1 : Math.abs(Number(y.ecart_pct));
    if (ey !== ex) return ey - ex;
    return rang(x) - rang(y);
  });
}
