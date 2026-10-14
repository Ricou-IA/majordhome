import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, uniqueSlug, parseDecimal, emptyProductForm, productToForm, validateProductForm,
  formToPayload, computeMargin, resolveImageUrl, ownStoragePath, imagesToDelete, checkImageFile,
  duplicatePayload, nextDisplayOrder, productPageUrl, IMAGE_MAX_BYTES,
} from '../src/lib/webshop/catalog.js';

const ORG = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
const OWN = `https://x.supabase.co/storage/v1/object/public/webshop/${ORG}/products/p1/a.webp`;
const IMPORT = 'https://x.supabase.co/storage/v1/object/public/webshop/products/serviteur-arcadia/1.webp';
const SITE = '/images/boutique/pellets-total-premium-sac.jpg';

// ── slug ──────────────────────────────────────────────────────────────────
test('slugify : accents, ponctuation, tirets', () => {
  assert.equal(slugify('Pellets Premium TotalEnergies — palette de 66 sacs'), 'pellets-premium-totalenergies-palette-de-66-sacs');
  assert.equal(slugify('  Range-bûches Éliss !! '), 'range-buches-eliss');
  assert.equal(slugify(''), '');
});
test('uniqueSlug : suffixe -2, -3 si pris', () => {
  assert.equal(uniqueSlug('borne', []), 'borne');
  assert.equal(uniqueSlug('borne', ['borne']), 'borne-2');
  assert.equal(uniqueSlug('borne', ['borne', 'borne-2']), 'borne-3');
  assert.equal(uniqueSlug('', []), 'produit');
});

// ── nombres ───────────────────────────────────────────────────────────────
test('parseDecimal : virgule, espaces, vide, invalide', () => {
  assert.equal(parseDecimal('249,9'), 249.9);
  assert.equal(parseDecimal('1 290'), 1290);
  assert.equal(parseDecimal('1\u202f290,50'), 1290.5);
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('  '), null);
  assert.ok(Number.isNaN(parseDecimal('abc')));
});

// ── formulaire ────────────────────────────────────────────────────────────
const PRODUCT = {
  id: 'p1', org_id: ORG, slug: 'serviteur-arcadia', name: 'Serviteur Arcadia', brand: 'Dixneuf',
  category_id: 'c1', short_description: 'Serviteur 4 pièces', long_description: null,
  price_ttc: 119, vat_rate: 20, install_price_ttc: null, pro_install_price_ttc: null, install_vat_rate: 5.5,
  is_active: true, is_featured: false, display_order: 3, specs: { Poids: '3,1 kg', Matière: 'Acier' },
  supplier: 'dixneuf', supplier_ref: 'ARC-01', ean: null, purchase_price_ht: 52.4, stock_qty: 3,
  allow_backorder: false, lead_time_days: null, shipping_kind: 'parcel', pallet_slots: null, weight_kg: 3.1,
  images: [SITE, 42, null], seo_title: null, seo_description: null,
};
test('productToForm : nombres en texte FR, specs en lignes, images filtrées', () => {
  const f = productToForm(PRODUCT);
  assert.equal(f.price_ttc, '119');
  assert.equal(f.purchase_price_ht, '52,4');
  assert.equal(f.install_price_ttc, '');
  assert.equal(f.vat_rate, '20');
  assert.deepEqual(f.images, [SITE]);
  assert.deepEqual(f.specs, [{ label: 'Poids', value: '3,1 kg' }, { label: 'Matière', value: 'Acier' }]);
  assert.equal(f.long_description, '');
  assert.equal(f.is_active, true);
});
test('formToPayload : vides → null, nombres parsés, specs en objet, palette', () => {
  const f = productToForm(PRODUCT);
  f.brand = '  ';
  f.specs = [...f.specs, { label: '', value: 'ignorée' }, { label: ' Garantie ', value: ' 5 ans ' }];
  const p = formToPayload(f);
  assert.equal(p.brand, null);
  assert.equal(p.price_ttc, 119);
  assert.equal(p.purchase_price_ht, 52.4);
  assert.equal(p.install_price_ttc, null);
  assert.equal(p.vat_rate, 20);
  assert.equal(p.stock_qty, 3);
  assert.equal(p.pallet_slots, null);
  assert.deepEqual(p.specs, { Poids: '3,1 kg', Matière: 'Acier', Garantie: '5 ans' });
  assert.equal(p.long_description, null);
  assert.equal('slug' in p, false);
  assert.equal('id' in p, false);
  const pal = formToPayload({ ...f, shipping_kind: 'pallet', pallet_slots: '2' });
  assert.equal(pal.pallet_slots, 2);
});
test('validateProductForm : obligatoires, nombres FR, négatifs, palette, specs en double', () => {
  assert.deepEqual(validateProductForm(productToForm(PRODUCT)), {});
  const e = validateProductForm({ ...emptyProductForm(), name: ' ', price_ttc: 'abc' });
  assert.ok(e.name);
  assert.ok(e.price_ttc);
  assert.ok(validateProductForm({ ...productToForm(PRODUCT), price_ttc: '-1' }).price_ttc);
  assert.ok(validateProductForm({ ...productToForm(PRODUCT), stock_qty: '2,5' }).stock_qty);
  assert.ok(validateProductForm({ ...productToForm(PRODUCT), shipping_kind: 'pallet', pallet_slots: '' }).pallet_slots);
  assert.ok(validateProductForm({ ...productToForm(PRODUCT), shipping_kind: 'drone' }).shipping_kind);
  // Hors boutique (borne vendue par sa page dédiée) : shipping_kind vide est valide et part en null
  const borne = { ...productToForm(PRODUCT), shipping_kind: '' };
  assert.deepEqual(validateProductForm(borne), {});
  assert.equal(formToPayload(borne).shipping_kind, null);
  assert.equal(productToForm({ ...PRODUCT, shipping_kind: null }).shipping_kind, '');
  assert.ok(validateProductForm({ ...productToForm(PRODUCT), vat_rate: '7' }).vat_rate);
  const dup = { ...productToForm(PRODUCT), specs: [{ label: 'Poids', value: 'a' }, { label: 'poids ', value: 'b' }] };
  assert.ok(validateProductForm(dup).specs);
  assert.deepEqual(validateProductForm({ ...productToForm(PRODUCT), price_ttc: '1 290,5' }), {});
});

// ── marge ─────────────────────────────────────────────────────────────────
test('computeMargin : TTC → HT − achat', () => {
  assert.deepEqual(computeMargin({ priceTtc: 120, vatRate: 20, purchaseHt: 60 }), { amount: 40, percent: 40 });
  assert.equal(computeMargin({ priceTtc: 120, vatRate: 20, purchaseHt: null }), null);
  assert.equal(computeMargin({ priceTtc: null, vatRate: 20, purchaseHt: 10 }), null);
  assert.deepEqual(computeMargin({ priceTtc: 349, vatRate: 10, purchaseHt: 300 }), { amount: 17.27, percent: 5.4 });
});

// ── photos ────────────────────────────────────────────────────────────────
test('resolveImageUrl : absolue telle quelle, relative préfixée par le site, sinon null', () => {
  assert.equal(resolveImageUrl(OWN, null), OWN);
  assert.equal(resolveImageUrl(SITE, 'https://mayer-energie.fr/'), `https://mayer-energie.fr${SITE}`);
  assert.equal(resolveImageUrl(SITE, null), null);
  assert.equal(resolveImageUrl('', 'https://a.fr'), null);
});
test('ownStoragePath : seulement sous le préfixe de l’org', () => {
  assert.equal(ownStoragePath(OWN, ORG), `${ORG}/products/p1/a.webp`);
  assert.equal(ownStoragePath(IMPORT, ORG), null);
  assert.equal(ownStoragePath(SITE, ORG), null);
  assert.equal(ownStoragePath(OWN, 'autre-org'), null);
});
test('imagesToDelete : fichiers de notre préfixe retirés, jamais ceux du site ni de l’import', () => {
  const OWN2 = OWN.replace('a.webp', 'b.webp');
  assert.deepEqual(imagesToDelete([OWN, SITE, IMPORT, OWN2], [OWN2], ORG), [`${ORG}/products/p1/a.webp`]);
  assert.deepEqual(imagesToDelete([OWN], [OWN], ORG), []);
  assert.deepEqual(imagesToDelete([], [], ORG), []);
});
test('checkImageFile : type et taille', () => {
  assert.equal(checkImageFile({ type: 'image/jpeg', size: 1000 }), null);
  assert.ok(checkImageFile({ type: 'application/pdf', size: 1000 }));
  assert.ok(checkImageFile({ type: 'image/png', size: IMAGE_MAX_BYTES + 1 }));
});

// ── duplication / ordre / lien ────────────────────────────────────────────
test('duplicatePayload : sans id/slug/photos, masqué, nom suffixé, slug unique', () => {
  const d = duplicatePayload(PRODUCT, ORG, ['serviteur-arcadia', 'serviteur-arcadia-copie'], 9);
  assert.equal(d.name, 'Serviteur Arcadia (copie)');
  assert.equal(d.slug, 'serviteur-arcadia-copie-2');
  assert.equal(d.is_active, false);
  assert.equal(d.is_featured, false);
  assert.deepEqual(d.images, []);
  assert.equal(d.org_id, ORG);
  assert.equal(d.display_order, 9);
  assert.equal('id' in d, false);
  assert.equal('created_at' in d, false);
  assert.deepEqual(d.specs, PRODUCT.specs);
});
test('nextDisplayOrder : max + 1, 1 si vide', () => {
  assert.equal(nextDisplayOrder([]), 1);
  assert.equal(nextDisplayOrder([{ display_order: 3 }, { display_order: null }, { display_order: 7 }]), 8);
});
test('productPageUrl', () => {
  assert.equal(productPageUrl('a-b', 'https://mayer-energie.fr/'), 'https://mayer-energie.fr/boutique/p/a-b');
  assert.equal(productPageUrl('a-b', ''), null);
  assert.equal(productPageUrl('', 'https://x.fr'), null);
});

// ── Relecture finale ──────────────────────────────────────────────────────
test('imagesToDelete : photo envoyée puis retirée dans la session (union avant ∪ envoyées), sans doublon', () => {
  const UP = OWN.replace('a.webp', 'up.webp');
  // Enregistrement : (avant ∪ envoyées) − après
  assert.deepEqual(imagesToDelete([OWN, UP, OWN], [OWN], ORG), [`${ORG}/products/p1/up.webp`]);
  // Abandon : envoyées − état initial
  assert.deepEqual(imagesToDelete([UP, UP], [OWN], ORG), [`${ORG}/products/p1/up.webp`]);
});
test('duplicatePayload : la copie ne reprend ni la référence fournisseur ni l’EAN (import Dixneuf indexé par supplier_ref)', () => {
  const d = duplicatePayload({ ...PRODUCT, ean: '3700000000000' }, ORG, [], 1);
  assert.equal(d.supplier_ref, null);
  assert.equal(d.ean, null);
  assert.equal(d.supplier, 'dixneuf');
});
