/**
 * catalog.js — Webshop : logique PURE du catalogue (aucun import React/Supabase/alias).
 * Formulaire produit ↔ payload `majordhome_webshop_products`, slug, marge, photos.
 * Testé : node --test scripts/webshop-catalog.test.mjs
 */

export const VAT_RATES = [5.5, 10, 20];
// '' = hors boutique : le site n'affiche dans /boutique que les produits avec un mode d'expédition
// (la borne V2C, vendue par sa page dédiée, n'en a pas).
export const SHIPPING_KINDS = [
  { value: 'parcel', label: 'Colis (expédié)' },
  { value: 'pallet', label: 'Palette (livrée)' },
  { value: '', label: 'Hors boutique (page dédiée)' },
];
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PUBLIC_PREFIX = '/storage/v1/object/public/webshop/';

const TEXT_FIELDS = ['name', 'brand', 'short_description', 'long_description', 'seo_title', 'seo_description', 'supplier', 'supplier_ref', 'ean'];
const DECIMAL_FIELDS = ['price_ttc', 'install_price_ttc', 'pro_install_price_ttc', 'purchase_price_ht', 'weight_kg'];
const INT_FIELDS = ['stock_qty', 'lead_time_days', 'pallet_slots'];
const RATE_FIELDS = ['vat_rate', 'install_vat_rate'];

/** @param {string} name */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** @param {string} base @param {string[]} takenSlugs */
export function uniqueSlug(base, takenSlugs) {
  const taken = new Set(takenSlugs);
  const root = base || 'produit';
  if (!taken.has(root)) return root;
  for (let i = 2; ; i += 1) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** « 1290,50 » (espaces de milliers tolérées) → 1290.5 ; vide → null ; invalide → NaN. @param {string} str */
export function parseDecimal(str) {
  const s = String(str ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

function numToInput(n) {
  if (n === null || n === undefined || n === '') return '';
  return String(n).replace('.', ',');
}

export function emptyProductForm() {
  return {
    name: '', brand: '', category_id: '', short_description: '', long_description: '',
    price_ttc: '', vat_rate: '20', install_price_ttc: '', pro_install_price_ttc: '', install_vat_rate: '5.5',
    is_active: false, is_featured: false,
    images: [], specs: [],
    shipping_kind: 'parcel', pallet_slots: '', weight_kg: '', stock_qty: '0', allow_backorder: false, lead_time_days: '',
    supplier: '', supplier_ref: '', ean: '', purchase_price_ht: '',
    seo_title: '', seo_description: '',
  };
}

/** @param {object} p - ligne majordhome_webshop_products */
export function productToForm(p) {
  const form = emptyProductForm();
  for (const f of TEXT_FIELDS) form[f] = p[f] ?? '';
  for (const f of [...DECIMAL_FIELDS, ...INT_FIELDS]) form[f] = numToInput(p[f]);
  form.vat_rate = String(p.vat_rate ?? 20);
  form.install_vat_rate = String(p.install_vat_rate ?? 5.5);
  form.category_id = p.category_id ?? '';
  form.is_active = p.is_active !== false;
  form.is_featured = Boolean(p.is_featured);
  form.allow_backorder = Boolean(p.allow_backorder);
  form.shipping_kind = p.shipping_kind ?? '';
  form.images = Array.isArray(p.images) ? p.images.filter((u) => typeof u === 'string' && u) : [];
  form.specs = p.specs && typeof p.specs === 'object' && !Array.isArray(p.specs)
    ? Object.entries(p.specs).map(([label, value]) => ({ label, value: String(value ?? '') }))
    : [];
  return form;
}

/** @param {object} form @returns {Record<string,string>} champ → message (vide = valide) */
export function validateProductForm(form) {
  const errors = {};
  if (!String(form.name ?? '').trim()) errors.name = 'Le nom est obligatoire';
  const price = parseDecimal(form.price_ttc);
  if (price === null) errors.price_ttc = 'Le prix est obligatoire';
  else if (Number.isNaN(price) || price < 0) errors.price_ttc = 'Prix invalide';
  if (!VAT_RATES.includes(Number(form.vat_rate))) errors.vat_rate = 'TVA invalide';
  if (!SHIPPING_KINDS.some((k) => k.value === (form.shipping_kind ?? ''))) errors.shipping_kind = 'Mode d’expédition inconnu';
  for (const f of ['install_price_ttc', 'pro_install_price_ttc', 'purchase_price_ht', 'weight_kg']) {
    const v = parseDecimal(form[f]);
    if (v !== null && (Number.isNaN(v) || v < 0)) errors[f] = 'Nombre invalide';
  }
  for (const f of ['stock_qty', 'lead_time_days', 'pallet_slots']) {
    const v = parseDecimal(form[f]);
    if (v !== null && (Number.isNaN(v) || v < 0 || !Number.isInteger(v))) errors[f] = 'Nombre entier attendu';
  }
  if (form.shipping_kind === 'pallet' && !errors.pallet_slots) {
    const v = parseDecimal(form.pallet_slots);
    if (v === null || v < 1) errors.pallet_slots = 'Au moins 1 emplacement palette';
  }
  const labels = (form.specs ?? []).map((s) => String(s.label ?? '').trim().toLowerCase()).filter(Boolean);
  if (new Set(labels).size !== labels.length) errors.specs = 'Deux caractéristiques portent le même libellé';
  return errors;
}

/** Formulaire validé → payload d'écriture (sans id, org_id, slug, display_order). */
export function formToPayload(form) {
  const payload = {};
  for (const f of TEXT_FIELDS) {
    const v = String(form[f] ?? '').trim();
    payload[f] = v === '' ? null : v;
  }
  for (const f of [...DECIMAL_FIELDS, ...INT_FIELDS]) payload[f] = parseDecimal(form[f]);
  for (const f of RATE_FIELDS) payload[f] = Number(form[f]);
  if (form.shipping_kind !== 'pallet') payload.pallet_slots = null;
  payload.category_id = form.category_id || null;
  payload.is_active = Boolean(form.is_active);
  payload.is_featured = Boolean(form.is_featured);
  payload.allow_backorder = Boolean(form.allow_backorder);
  payload.shipping_kind = form.shipping_kind || null;
  payload.images = [...(form.images ?? [])];
  payload.specs = Object.fromEntries(
    (form.specs ?? [])
      .map((s) => [String(s.label ?? '').trim(), String(s.value ?? '').trim()])
      .filter(([label]) => label !== ''),
  );
  if (payload.stock_qty === null) payload.stock_qty = 0;
  return payload;
}

/** Marge sur prix public : HT = TTC / (1 + TVA) ; amount € (2 déc.), percent du HT (1 déc.). */
export function computeMargin({ priceTtc, vatRate, purchaseHt }) {
  if (priceTtc === null || priceTtc === undefined || Number.isNaN(priceTtc)) return null;
  if (purchaseHt === null || purchaseHt === undefined || Number.isNaN(purchaseHt)) return null;
  const ht = priceTtc / (1 + Number(vatRate) / 100);
  if (ht <= 0) return null;
  const amount = Math.round((ht - purchaseHt) * 100) / 100;
  const percent = Math.round(((ht - purchaseHt) / ht) * 1000) / 10;
  return { amount, percent };
}

/** URL affichable : absolue telle quelle ; chemin du site (« /images/… ») préfixé par l'URL du site. */
export function resolveImageUrl(url, siteUrl) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/') && siteUrl) return `${String(siteUrl).replace(/\/+$/, '')}${url}`;
  return null;
}

/** Chemin dans le bucket `webshop` si l'URL est sous NOTRE préfixe d'org, sinon null. */
export function ownStoragePath(url, orgId) {
  if (!url || !orgId) return null;
  const i = String(url).indexOf(PUBLIC_PREFIX);
  if (i === -1) return null;
  const path = decodeURIComponent(String(url).slice(i + PUBLIC_PREFIX.length));
  return path.startsWith(`${orgId}/`) ? path : null;
}

/**
 * Fichiers à supprimer du bucket : présents dans `before`, absents de `after`, sous notre préfixe,
 * sans doublon. Enregistrement : before = initial ∪ envoyées pendant la session ; abandon :
 * before = envoyées, after = initial.
 */
export function imagesToDelete(before, after, orgId) {
  const kept = new Set(after ?? []);
  return [...new Set(before ?? [])]
    .filter((u) => !kept.has(u))
    .map((u) => ownStoragePath(u, orgId))
    .filter(Boolean);
}

/** @param {{type:string,size:number}} file @returns {string|null} message d'erreur */
export function checkImageFile(file) {
  if (!IMAGE_TYPES.includes(file?.type)) return 'Format accepté : JPEG, PNG ou WebP';
  if (file.size > IMAGE_MAX_BYTES) return 'Photo trop lourde (8 Mo maximum)';
  return null;
}

/**
 * Copie d'un produit : masquée, sans photos, slug unique dérivé. Ni référence fournisseur ni EAN :
 * l'import Dixneuf du site rapproche par `supplier_ref`, deux lignes identiques le tromperaient.
 */
export function duplicatePayload(product, orgId, takenSlugs, displayOrder) {
  const {
    id: _id, slug, created_at: _c, updated_at: _u, org_id: _o, images: _i, ...rest
  } = product;
  return {
    ...rest,
    org_id: orgId,
    name: `${product.name} (copie)`,
    slug: uniqueSlug(`${slug || slugify(product.name)}-copie`, takenSlugs),
    images: [],
    supplier_ref: null,
    ean: null,
    is_active: false,
    is_featured: false,
    display_order: displayOrder,
  };
}

export function nextDisplayOrder(products) {
  const max = Math.max(0, ...(products ?? []).map((p) => Number(p.display_order) || 0));
  return max + 1;
}

export function productPageUrl(slug, siteUrl) {
  if (!slug || !siteUrl) return null;
  return `${String(siteUrl).replace(/\/+$/, '')}/boutique/p/${slug}`;
}
