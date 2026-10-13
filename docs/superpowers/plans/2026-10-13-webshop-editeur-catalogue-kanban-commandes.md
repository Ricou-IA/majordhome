# Webshop — éditeur de catalogue + kanban des commandes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un org_admin d'éditer complètement le catalogue boutique (photos, caractéristiques, stock, prix, SEO) lu en direct par le site Mayer, et suivre les commandes boutique dans un kanban.

**Architecture:** Deux modules purs testés (`src/lib/webshop/catalog.js`, `src/lib/webshop/orders.js`) portent toute la logique (formulaire ↔ payload, slug, marge, photos, lignes de commande, pastilles). Deux services (`webshopProducts.service.js`, `webshopOrders.service.js`) + un fichier de hooks React Query (`useWebshop.js`). L'UI est découpée en `ProductsTab` (liste + drawer) et `OrdersTab` (kanban + drawer) ; `Webshop.jsx` redevient un orchestrateur d'onglets. Une migration restreint les écritures catalogue à `org_admin`, pose les policies du bucket `webshop` et enrichit la vue des commandes.

**Tech Stack:** React 18, TanStack Query v5, Supabase JS (PostgREST + Storage), Tailwind, lucide-react, sonner, `@hello-pangea/dnd` (via `KanbanBoard`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-13-webshop-editeur-catalogue-kanban-commandes-design.md`

## Global Constraints

- Org des tables webshop = org **CORE** (`useAuth().organization.id`, Mayer `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`) — jamais `getMajordhomeOrgId()`.
- Toute lecture/mutation Supabase filtre explicitement `.eq('org_id', orgId)`.
- Services : retour `{ data, error }` via `withErrorHandling` ; jamais de throw au caller. Hooks : `mutationFn` déballe via `unwrapResult()`, appelant en try/catch + toast.
- Cache keys : `webshopKeys` dans `src/shared/hooks/cacheKeys.js`, `all: (orgId) => ['webshop', orgId]`, `enabled: !!orgId`.
- Écritures catalogue (produits, catégories, photos) : **org_admin uniquement** (décision Eric 2026-10-13), en base ET à l'écran.
- Pas de `console.*` : `import { logger } from '@lib/logger'`.
- Champs vides envoyés en `null`, jamais `''`.
- Slug figé après création ; aucun produit supprimé (on masque).
- Photos : bucket `webshop`, chemin `${orgId}/products/${productId}/${uuid}.webp`, WebP largeur max 1600 px qualité 0,82 ; un fichier hors du préfixe `${orgId}/` n'est JAMAIS supprimé.
- Réglage `settings.webshop.site_url` sauvé via `useOrgSettings().save({ webshop: { ...settings.webshop, site_url } })` (merge JSONB niveau 1 → objet `webshop` complet).
- Aucun composant > 500 LOC, aucun service > 700 LOC, Tailwind uniquement, textes UI en français.
- Ne JAMAIS utiliser les preview tools : vérifier par `npx vite build`.
- Le dépôt du site (`C:\Dev\Landing Page - Mayer`) n'est PAS modifié.

## Review Focus

1. **Refus RLS silencieux** — un non-admin (ou une session expirée) qui enregistre un produit : l'UPDATE renvoie 0 ligne ; on attend une erreur visible (toast), pas un « Enregistré ». → `.select().single()` sur toutes les mutations (PGRST116 = erreur) + test de service impossible en pur ; vérifié par la vérification d'impersonation de la Task 2 et par la désactivation du formulaire pour non-admin (Task 4).
2. **Photo envoyée puis drawer annulé / photo retirée** — les fichiers non référencés de NOTRE préfixe doivent être supprimés, les URL du site ou de l'import jamais. → tests `imagesToDelete` (Task 1).
3. **Prix saisi à la française** (« 249,9 », « 1 290 ») — doit être accepté ; « abc » ou négatif refusé avec message. → tests `parseDecimal` / `validateProductForm` (Task 1).
4. **Commande historique sans lignes** (ancien modèle borne, `order_items` vide) — la carte et le drawer doivent afficher le produit unique, pas « 0 article ». → test `orderLines` repli (Task 1).
5. **Glisser une carte vers la même colonne ou hors tableau** — aucun appel réseau, aucune erreur. → test `canMoveTo` (Task 1).

---

## File Structure

| Fichier | Rôle |
|---|---|
| `src/lib/webshop/catalog.js` (créer) | PUR — slug, formulaire produit ↔ payload, validation, marge, photos (URL, chemins, suppression), duplication |
| `src/lib/webshop/orders.js` (créer) | PUR — colonnes, transitions, lignes de commande, résumé, pastilles, patch de statut, recherche |
| `src/lib/webshop/imageToWebp.js` (créer) | navigateur — conversion fichier → Blob WebP |
| `scripts/webshop-catalog.test.mjs`, `scripts/webshop-orders.test.mjs` (créer) | tests `node --test` |
| `supabase/migrations/20261013_1_webshop_editeur.sql` (créer) | policies org_admin, bucket + storage policies, vue commandes |
| `scripts/migration-rehearsal/assert-webshop-editeur.sql` (créer), `snapshot.mjs` (modifier) | répétition |
| `src/shared/services/webshopProducts.service.js` (créer) | catalogue + photos |
| `src/shared/services/webshopOrders.service.js` (créer) | commandes + lignes |
| `src/shared/services/webshop.service.js` (supprimer) | remplacé |
| `src/shared/hooks/cacheKeys.js` (modifier) | `webshopKeys` |
| `src/shared/hooks/useWebshop.js` (créer) | `useWebshopCatalog`, `useWebshopOrders` |
| `src/apps/artisan/components/webshop/products/*` (créer) | `ProductsTab`, `ProductList`, `ProductDrawer`, `ProductFormSections`, `ProductImagesField`, `SpecsField`, `SiteUrlSetting` |
| `src/apps/artisan/components/webshop/orders/*` (créer) | `OrdersTab`, `OrderCard`, `OrderDrawer`, `SideColumn` |
| `src/apps/artisan/pages/Webshop.jsx` (réécrire) | orchestrateur d'onglets |
| `package.json` (modifier) | tests dans `audit:quality` |

---

### Task 1: Modules purs `catalog.js` + `orders.js`

**Files:**
- Create: `src/lib/webshop/catalog.js`, `src/lib/webshop/orders.js`
- Test: `scripts/webshop-catalog.test.mjs`, `scripts/webshop-orders.test.mjs`
- Modify: `package.json` (script `audit:quality`)

**Interfaces:**
- Produces (catalog.js): `VAT_RATES`, `SHIPPING_KINDS`, `IMAGE_MAX_BYTES`, `slugify(name)`, `uniqueSlug(base, takenSlugs)`, `parseDecimal(str)`, `emptyProductForm()`, `productToForm(product)`, `validateProductForm(form) → { [field]: message }`, `formToPayload(form) → object`, `computeMargin({ priceTtc, vatRate, purchaseHt }) → { amount, percent } | null`, `resolveImageUrl(url, siteUrl) → string|null`, `ownStoragePath(url, orgId) → string|null`, `imagesToDelete(before, after, orgId) → string[]`, `checkImageFile(file) → string|null`, `duplicatePayload(product, orgId, takenSlugs, displayOrder) → object`, `nextDisplayOrder(products) → number`, `productPageUrl(slug, siteUrl) → string|null`.
- Produces (orders.js): `ORDER_STATUS_LABELS`, `ORDER_BOARD_COLUMNS`, `ORDER_SIDE_STATUSES`, `canMoveTo(from, to) → boolean`, `toCents(n)`, `orderLines(order) → Line[]`, `linesSummary(lines, max=2) → string`, `orderTotalCents(order) → number`, `orderBadges(order, lines) → Badge[]`, `statusPatch(order, to, now=new Date()) → object`, `matchesOrderSearch(order, query) → boolean`, `formatCents(cents) → string`.
  - `Line = { name, qty, unitCents, totalCents, shippingKind }` ; `Badge = { key, label, tone: 'neutral'|'info'|'warning' }`.
  - `order.items` = tableau des lignes `majordhome_webshop_order_items` fusionné par le service (Task 3).

- [ ] **Step 1: Write the failing tests (catalog)**

`scripts/webshop-catalog.test.mjs` :

```js
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
  assert.ok(validateProductForm({ ...productToForm(PRODUCT), shipping_kind: '' }).shipping_kind);
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
```

- [ ] **Step 2: Write the failing tests (orders)**

`scripts/webshop-orders.test.mjs` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_BOARD_COLUMNS, ORDER_SIDE_STATUSES, canMoveTo, toCents, orderLines, linesSummary,
  orderTotalCents, orderBadges, statusPatch, matchesOrderSearch, formatCents,
} from '../src/lib/webshop/orders.js';

const NEW_MODEL = {
  id: 'o1', order_number: 'WEB-2026-0010', status: 'nouvelle', channel: 'particulier', order_type: 'vente_directe',
  first_name: 'Jean', last_name: 'Dupont', city: 'Gaillac', email: 'j@d.fr', total_ttc: null, total_ttc_cents: 81800,
  pallet_delivery_mode: 'delivery', parcel_delivery_mode: null, delivery_date: '2026-10-20',
  needs_manual_planning: false, delivery_slot_changed: true, shipped_at: null, delivered_at: null,
  items: [
    { product_name: 'Pellets Premium', qty: 2, unit_price_ttc_cents: 34900, line_total_ttc_cents: 69800, shipping_kind: 'pallet' },
    { product_name: 'Serviteur Arcadia', qty: 1, unit_price_ttc_cents: 11900, line_total_ttc_cents: 11900, shipping_kind: 'parcel' },
    { product_name: 'Range-bûches', qty: 1, unit_price_ttc_cents: 24990, line_total_ttc_cents: 24990, shipping_kind: 'parcel' },
  ],
};
const LEGACY = {
  id: 'o2', order_number: 'WEB-2026-0001', status: 'annulee', channel: 'pro', order_type: 'vente_installation',
  first_name: 'test', last_name: 'test', city: 'Toulouse', product_name: 'Borne V2C Trydan', product_id: 'p9',
  quantity: 1, unit_price_ttc: 1290, total_ttc: 1290, total_ttc_cents: null, items: [], needs_manual_planning: true,
};

test('colonnes : 5 au tableau, 2 repliées', () => {
  assert.deepEqual(ORDER_BOARD_COLUMNS.map((c) => c.id), ['nouvelle', 'confirmee', 'transmise_fournisseur', 'expediee', 'livree']);
  assert.deepEqual(ORDER_SIDE_STATUSES, ['en_attente_paiement', 'annulee']);
});
test('canMoveTo : seulement entre colonnes du tableau, pas sur place', () => {
  assert.equal(canMoveTo('nouvelle', 'expediee'), true);
  assert.equal(canMoveTo('livree', 'confirmee'), true);
  assert.equal(canMoveTo('nouvelle', 'nouvelle'), false);
  assert.equal(canMoveTo('en_attente_paiement', 'nouvelle'), false);
  assert.equal(canMoveTo('nouvelle', 'annulee'), false);
  assert.equal(canMoveTo('nouvelle', undefined), false);
});
test('toCents / formatCents', () => {
  assert.equal(toCents(249.9), 24990);
  assert.equal(toCents(null), null);
  assert.equal(formatCents(129050).replace(/\s/g, ' '), '1 290,50 €');
  assert.equal(formatCents(11900).replace(/\s/g, ' '), '119 €');
});
test('orderLines : nouveau modèle', () => {
  const l = orderLines(NEW_MODEL);
  assert.equal(l.length, 3);
  assert.deepEqual(l[0], { name: 'Pellets Premium', qty: 2, unitCents: 34900, totalCents: 69800, shippingKind: 'pallet' });
});
test('orderLines : repli ancien modèle (sans lignes)', () => {
  assert.deepEqual(orderLines(LEGACY), [{ name: 'Borne V2C Trydan', qty: 1, unitCents: 129000, totalCents: 129000, shippingKind: null }]);
  assert.deepEqual(orderLines({ items: [] }), []);
});
test('linesSummary : tronqué au-delà de max', () => {
  assert.equal(linesSummary(orderLines(NEW_MODEL)), 'Pellets Premium ×2, Serviteur Arcadia ×1 +1');
  assert.equal(linesSummary(orderLines(LEGACY)), 'Borne V2C Trydan ×1');
  assert.equal(linesSummary([]), '');
});
test('orderTotalCents : centimes en priorité, sinon total_ttc', () => {
  assert.equal(orderTotalCents(NEW_MODEL), 81800);
  assert.equal(orderTotalCents(LEGACY), 129000);
  assert.equal(orderTotalCents({}), 0);
});
test('orderBadges', () => {
  const keys = (o) => orderBadges(o, orderLines(o)).map((b) => b.key);
  assert.deepEqual(keys(NEW_MODEL), ['pallet', 'parcel', 'slot_changed']);
  assert.equal(orderBadges(NEW_MODEL, orderLines(NEW_MODEL))[0].label, 'Palette · 20/10');
  assert.deepEqual(keys(LEGACY), ['pro', 'install', 'manual_planning']);
  assert.deepEqual(keys({ ...NEW_MODEL, pallet_delivery_mode: 'pickup', delivery_slot_changed: false }), ['pallet', 'parcel', 'pickup']);
});
test('statusPatch : dates posées une seule fois', () => {
  const now = new Date('2026-10-13T10:00:00Z');
  assert.deepEqual(statusPatch(NEW_MODEL, 'expediee', now), { status: 'expediee', shipped_at: now.toISOString() });
  assert.deepEqual(statusPatch({ ...NEW_MODEL, shipped_at: 'x' }, 'expediee', now), { status: 'expediee' });
  assert.deepEqual(statusPatch(NEW_MODEL, 'livree', now), { status: 'livree', delivered_at: now.toISOString() });
  assert.deepEqual(statusPatch(NEW_MODEL, 'confirmee', now), { status: 'confirmee' });
});
test('matchesOrderSearch : numéro, nom, ville, email, insensible aux accents', () => {
  assert.equal(matchesOrderSearch(NEW_MODEL, '0010'), true);
  assert.equal(matchesOrderSearch(NEW_MODEL, 'dupont'), true);
  assert.equal(matchesOrderSearch({ ...NEW_MODEL, city: 'Lisle-sur-Tarn' }, 'lisle'), true);
  assert.equal(matchesOrderSearch({ ...NEW_MODEL, last_name: 'Géraud' }, 'geraud'), true);
  assert.equal(matchesOrderSearch(NEW_MODEL, 'zzz'), false);
  assert.equal(matchesOrderSearch(NEW_MODEL, ''), true);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test scripts/webshop-catalog.test.mjs scripts/webshop-orders.test.mjs`
Expected: FAIL — `Cannot find module '…/src/lib/webshop/catalog.js'`.

- [ ] **Step 4: Implement `src/lib/webshop/catalog.js`**

```js
/**
 * catalog.js — Webshop : logique PURE du catalogue (aucun import React/Supabase/alias).
 * Formulaire produit ↔ payload `majordhome_webshop_products`, slug, marge, photos.
 * Testé : node --test scripts/webshop-catalog.test.mjs
 */

export const VAT_RATES = [5.5, 10, 20];
export const SHIPPING_KINDS = [
  { value: 'parcel', label: 'Colis (expédié)' },
  { value: 'pallet', label: 'Palette (livrée)' },
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

/** « 1 290,50 » → 1290.5 ; vide → null ; invalide → NaN. @param {string} str */
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
  if (!SHIPPING_KINDS.some((k) => k.value === form.shipping_kind)) errors.shipping_kind = 'Choisir colis ou palette';
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

/** Fichiers à supprimer du bucket : présents avant, absents après, et sous notre préfixe. */
export function imagesToDelete(before, after, orgId) {
  const kept = new Set(after ?? []);
  return (before ?? [])
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

/** Copie d'un produit : masquée, sans photos, slug unique dérivé. */
export function duplicatePayload(product, orgId, takenSlugs, displayOrder) {
  const {
    id: _id, slug, created_at: _c, updated_at: _u, org_id: _o, images: _i, ...rest
  } = product;
  const name = `${product.name} (copie)`;
  return {
    ...rest,
    org_id: orgId,
    name,
    slug: uniqueSlug(`${slug || slugify(product.name)}-copie`, takenSlugs),
    images: [],
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
```

- [ ] **Step 5: Implement `src/lib/webshop/orders.js`**

```js
/**
 * orders.js — Webshop : logique PURE des commandes (kanban, lignes, pastilles).
 * Testé : node --test scripts/webshop-orders.test.mjs
 */

export const ORDER_STATUS_LABELS = {
  en_attente_paiement: 'En attente de paiement',
  nouvelle: 'Nouvelle',
  confirmee: 'Confirmée',
  transmise_fournisseur: 'Transmise fournisseur',
  expediee: 'Expédiée',
  livree: 'Livrée',
  annulee: 'Annulée',
};

export const ORDER_BOARD_COLUMNS = [
  { id: 'nouvelle', label: 'Nouvelle', color: '#3b82f6' },
  { id: 'confirmee', label: 'Confirmée', color: '#6366f1' },
  { id: 'transmise_fournisseur', label: 'Transmise fournisseur', color: '#f59e0b' },
  { id: 'expediee', label: 'Expédiée', color: '#8b5cf6' },
  { id: 'livree', label: 'Livrée', color: '#0ea5e9' },
];

export const ORDER_SIDE_STATUSES = ['en_attente_paiement', 'annulee'];

const BOARD_IDS = new Set(ORDER_BOARD_COLUMNS.map((c) => c.id));

export function canMoveTo(from, to) {
  return BOARD_IDS.has(from) && BOARD_IDS.has(to) && from !== to;
}

export function toCents(n) {
  if (n === null || n === undefined || n === '') return null;
  return Math.round(Number(n) * 100);
}

export function formatCents(cents) {
  const euros = (Number(cents) || 0) / 100;
  const hasDecimals = Math.round(euros * 100) % 100 !== 0;
  return euros.toLocaleString('fr-FR', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }) + ' €';
}

/** Lignes de commande ; repli sur le produit unique de l'ancien modèle borne. */
export function orderLines(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length > 0) {
    return items.map((it) => ({
      name: it.product_name,
      qty: it.qty,
      unitCents: it.unit_price_ttc_cents,
      totalCents: it.line_total_ttc_cents,
      shippingKind: it.shipping_kind ?? null,
    }));
  }
  if (order?.product_id || order?.product_name) {
    const qty = order.quantity ?? 1;
    return [{
      name: order.product_name ?? 'Produit',
      qty,
      unitCents: toCents(order.unit_price_ttc),
      totalCents: toCents(order.total_ttc) ?? (toCents(order.unit_price_ttc) ?? 0) * qty,
      shippingKind: null,
    }];
  }
  return [];
}

export function linesSummary(lines, max = 2) {
  const shown = lines.slice(0, max).map((l) => `${l.name} ×${l.qty}`).join(', ');
  return lines.length > max ? `${shown} +${lines.length - max}` : shown;
}

export function orderTotalCents(order) {
  if (order?.total_ttc_cents !== null && order?.total_ttc_cents !== undefined) return order.total_ttc_cents;
  return toCents(order?.total_ttc) ?? 0;
}

function shortDate(iso) {
  const [, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : '';
}

/** Pastilles de carte, ordre stable : livraison → canal → alertes. */
export function orderBadges(order, lines) {
  const badges = [];
  const hasPallet = lines.some((l) => l.shippingKind === 'pallet') || Boolean(order.pallet_delivery_mode);
  const hasParcel = lines.some((l) => l.shippingKind === 'parcel');
  if (hasPallet) {
    badges.push({ key: 'pallet', label: order.delivery_date ? `Palette · ${shortDate(order.delivery_date)}` : 'Palette', tone: 'info' });
  }
  if (hasParcel) badges.push({ key: 'parcel', label: 'Colis', tone: 'neutral' });
  if (order.pallet_delivery_mode === 'pickup' || order.parcel_delivery_mode === 'pickup') {
    badges.push({ key: 'pickup', label: order.pickup_point_name ? `Retrait · ${order.pickup_point_name}` : 'Retrait', tone: 'neutral' });
  }
  if (order.channel === 'pro') badges.push({ key: 'pro', label: 'Pro', tone: 'neutral' });
  if (order.order_type === 'vente_installation') badges.push({ key: 'install', label: 'Installation', tone: 'info' });
  if (order.needs_manual_planning) badges.push({ key: 'manual_planning', label: 'Planification manuelle', tone: 'warning' });
  if (order.delivery_slot_changed) badges.push({ key: 'slot_changed', label: 'Créneau modifié', tone: 'warning' });
  return badges;
}

/** Patch d'un changement de statut : shipped_at / delivered_at posés une seule fois. */
export function statusPatch(order, to, now = new Date()) {
  const patch = { status: to };
  if (to === 'expediee' && !order.shipped_at) patch.shipped_at = now.toISOString();
  if (to === 'livree' && !order.delivered_at) patch.delivered_at = now.toISOString();
  return patch;
}

function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function matchesOrderSearch(order, query) {
  const q = fold(query).trim();
  if (!q) return true;
  return [order.order_number, order.first_name, order.last_name, order.city, order.email, order.company_name]
    .some((v) => fold(v).includes(q));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test scripts/webshop-catalog.test.mjs scripts/webshop-orders.test.mjs`
Expected: PASS (tous). Si `computeMargin({349,10,300})` diffère : HT = 317,2727… → amount 17,27, percent 5,4 — corriger le test seulement si le calcul à la main donne autre chose.

- [ ] **Step 7: Brancher les tests dans `audit:quality`**

Dans `package.json`, script `audit:quality`, ajouter ` scripts/webshop-catalog.test.mjs scripts/webshop-orders.test.mjs` juste après `scripts/itineraire.test.mjs`.

Run: `node --test scripts/webshop-catalog.test.mjs scripts/webshop-orders.test.mjs && npm run lint:errors`
Expected: PASS, aucune erreur ESLint.

- [ ] **Step 8: Commit**

```bash
git add src/lib/webshop/catalog.js src/lib/webshop/orders.js scripts/webshop-catalog.test.mjs scripts/webshop-orders.test.mjs package.json
git commit -m "feat(webshop): modules purs catalogue et commandes (formulaire, photos, kanban)"
```

---

### Task 2: Migration — droits org_admin, bucket photos, vue commandes

**Files:**
- Create: `supabase/migrations/20261013_1_webshop_editeur.sql`
- Create: `scripts/migration-rehearsal/assert-webshop-editeur.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (TABLES, VIEWS, POLICY_TABLES)

**Interfaces:**
- Produces: vue `public.majordhome_webshop_orders` avec, EN FIN de liste, `pallet_delivery_mode, parcel_delivery_mode, pickup_point_id, pallet_slots, subtotal_ttc_cents, shipping_ttc_cents, total_ttc_cents, vat_breakdown, paid_at, expires_at, cancel_reason, sector_id, delivery_slot_id, delivery_slot_changed, needs_manual_planning, delivery_date, sector_label, pickup_point_name`. Écritures `webshop_products` / `webshop_categories` réservées à `org_admin`. Upload `webshop/${orgId}/…` réservé à `org_admin` de l'org.

- [ ] **Step 1: Écrire la migration**

`supabase/migrations/20261013_1_webshop_editeur.sql` :

```sql
-- 20261013_1_webshop_editeur.sql
-- Éditeur de catalogue + kanban des commandes (spec 2026-10-13).
-- 1. Catalogue : écritures org_admin seulement (lecture inchangée : membres).
--    Le site Mayer lit/écrit en service_role : non concerné par la RLS.
-- 2. Bucket public `webshop` : limites + policies sur le préfixe `${orgId}/`.
--    Les fichiers du script d'import du site (`products/…`, service_role) ne sont pas touchés.
-- 3. Vue des commandes : colonnes du modèle boutique (paiement, livraison) en fin de liste.

-- ── 1. webshop_products ─────────────────────────────────────────────────
DROP POLICY IF EXISTS webshop_products_insert_org_members ON majordhome.webshop_products;
DROP POLICY IF EXISTS webshop_products_update_org_members ON majordhome.webshop_products;
DROP POLICY IF EXISTS webshop_products_delete_org_members ON majordhome.webshop_products;

CREATE POLICY webshop_products_insert_org_admin ON majordhome.webshop_products
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_products_update_org_admin ON majordhome.webshop_products
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_products_delete_org_admin ON majordhome.webshop_products
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM core.organization_members om
    WHERE om.org_id = webshop_products.org_id AND om.user_id = auth.uid() AND om.role = 'org_admin'));

-- ── 1bis. webshop_categories (policy ALL « tout membre » → lecture membre / écriture admin) ──
DROP POLICY IF EXISTS webshop_categories_org ON majordhome.webshop_categories;

CREATE POLICY webshop_categories_select_org_members ON majordhome.webshop_categories
  FOR SELECT TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));

CREATE POLICY webshop_categories_write_org_admin ON majordhome.webshop_categories
  FOR ALL TO authenticated
  USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'))
  WITH CHECK (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- ── 2. Bucket webshop ───────────────────────────────────────────────────
UPDATE storage.buckets
   SET file_size_limit = 8388608,
       allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png']
 WHERE id = 'webshop';

DROP POLICY IF EXISTS webshop_images_org_select ON storage.objects;
DROP POLICY IF EXISTS webshop_images_org_admin_insert ON storage.objects;
DROP POLICY IF EXISTS webshop_images_org_admin_update ON storage.objects;
DROP POLICY IF EXISTS webshop_images_org_admin_delete ON storage.objects;

-- Lecture publique servie par le bucket public ; cette policy sert au remove() (lecture préalable).
CREATE POLICY webshop_images_org_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid()));

CREATE POLICY webshop_images_org_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_images_org_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

CREATE POLICY webshop_images_org_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'webshop'
    AND (storage.foldername(name))[1] IN (SELECT om.org_id::text FROM core.organization_members om WHERE om.user_id = auth.uid() AND om.role = 'org_admin'));

-- ── 3. Vue commandes (colonnes ajoutées EN FIN, security_invoker conservé) ──
CREATE OR REPLACE VIEW public.majordhome_webshop_orders WITH (security_invoker = true) AS
SELECT o.id, o.org_id, o.order_number, o.product_id, o.channel, o.order_type, o.status, o.quantity,
       o.unit_price_ttc, o.total_ttc, o.first_name, o.last_name, o.email, o.phone, o.address,
       o.postal_code, o.city, o.company_name, o.company_siret, o.company_contact, o.company_email,
       o.company_phone, o.comments, o.internal_notes, o.lead_id, o.client_id, o.source, o.carrier,
       o.tracking_number, o.shipped_at, o.delivered_at, o.external_data, o.created_at, o.updated_at,
       p.name AS product_name, p.slug AS product_slug, p.brand AS product_brand,
       (l.first_name || ' ' || l.last_name) AS lead_name,
       o.pallet_delivery_mode, o.parcel_delivery_mode, o.pickup_point_id, o.pallet_slots,
       o.subtotal_ttc_cents, o.shipping_ttc_cents, o.total_ttc_cents, o.vat_breakdown,
       o.paid_at, o.expires_at, o.cancel_reason, o.sector_id, o.delivery_slot_id,
       o.delivery_slot_changed, o.needs_manual_planning,
       ds.delivery_date, s.label AS sector_label, pp.name AS pickup_point_name
  FROM majordhome.webshop_orders o
  LEFT JOIN majordhome.webshop_products p ON p.id = o.product_id
  LEFT JOIN majordhome.leads l ON l.id = o.lead_id
  LEFT JOIN majordhome.webshop_delivery_slots ds ON ds.id = o.delivery_slot_id
  LEFT JOIN majordhome.webshop_sectors s ON s.id = o.sector_id
  LEFT JOIN majordhome.webshop_pickup_points pp ON pp.id = o.pickup_point_id;
```

- [ ] **Step 2: Écrire les assertions**

`scripts/migration-rehearsal/assert-webshop-editeur.sql` :

```sql
-- assert-webshop-editeur.sql — vérifie 20261013_1_webshop_editeur.sql. Un écart lève une exception.
DO $$
DECLARE n int; v_last text;
BEGIN
  -- Policies catalogue : plus aucune écriture « tout membre »
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='majordhome' AND tablename='webshop_products'
    AND policyname IN ('webshop_products_insert_org_members','webshop_products_update_org_members','webshop_products_delete_org_members');
  IF n <> 0 THEN RAISE EXCEPTION 'policies membres encore présentes sur webshop_products (%)', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='majordhome' AND tablename='webshop_products'
    AND cmd IN ('INSERT','UPDATE','DELETE') AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%org_admin%';
  IF n <> 3 THEN RAISE EXCEPTION 'attendu 3 policies org_admin en écriture sur webshop_products, trouvé %', n; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='majordhome' AND tablename='webshop_categories' AND policyname='webshop_categories_org') THEN
    RAISE EXCEPTION 'webshop_categories_org (ALL membres) toujours présente'; END IF;

  -- Vue : dernière colonne, security_invoker, lisible par service_role
  SELECT column_name INTO v_last FROM information_schema.columns
   WHERE table_schema='public' AND table_name='majordhome_webshop_orders' ORDER BY ordinal_position DESC LIMIT 1;
  IF v_last <> 'pickup_point_name' THEN RAISE EXCEPTION 'majordhome_webshop_orders : dernière colonne % au lieu de pickup_point_name', v_last; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.majordhome_webshop_orders'::regclass AND reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'majordhome_webshop_orders a perdu security_invoker'; END IF;

  -- Bucket
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='webshop' AND file_size_limit=8388608) THEN
    RAISE EXCEPTION 'bucket webshop : limite 8 Mo non posée'; END IF;
  RAISE NOTICE 'assert-webshop-editeur A (structure) : OK';
END $$;

-- B. Comportement : un membre non admin ne modifie pas un produit, un admin oui.
DO $$
DECLARE v_org uuid; v_admin uuid; v_member uuid; v_prod uuid; n int;
BEGIN
  SELECT org_id INTO v_org FROM majordhome.webshop_products LIMIT 1;
  IF v_org IS NULL THEN RAISE NOTICE 'assert B ignoré : aucun produit dans le snapshot'; RETURN; END IF;
  SELECT id INTO v_prod FROM majordhome.webshop_products WHERE org_id = v_org LIMIT 1;
  SELECT user_id INTO v_admin FROM core.organization_members WHERE org_id = v_org AND role = 'org_admin' LIMIT 1;
  SELECT user_id INTO v_member FROM core.organization_members WHERE org_id = v_org AND role <> 'org_admin' LIMIT 1;

  SET LOCAL ROLE authenticated;
  IF v_member IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
    UPDATE majordhome.webshop_products SET name = name WHERE id = v_prod;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'un membre non admin a pu modifier un produit'; END IF;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  UPDATE majordhome.webshop_products SET name = name WHERE id = v_prod;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'l''admin ne peut pas modifier un produit (% ligne)', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'assert-webshop-editeur B (droits) : OK';
END $$;
```

- [ ] **Step 3: Étendre le snapshot**

Dans `scripts/migration-rehearsal/snapshot.mjs` :
- `TABLES` : ajouter (avec données, volumes minuscules)
  ```js
  // 20261013_1 : éditeur webshop (policies catalogue + vue commandes)
  { schema: 'majordhome', table: 'webshop_products', columns: null },
  { schema: 'majordhome', table: 'webshop_categories', columns: null },
  { schema: 'majordhome', table: 'webshop_orders', columns: null, data: false },
  { schema: 'majordhome', table: 'webshop_delivery_slots', columns: null, data: false },
  { schema: 'majordhome', table: 'webshop_sectors', columns: null, data: false },
  { schema: 'majordhome', table: 'webshop_pickup_points', columns: null, data: false },
  ```
- `VIEWS` : ajouter `'public.majordhome_webshop_orders', // 20261013_1`
- `POLICY_TABLES` : ajouter `'webshop_products', 'webshop_categories', // 20261013_1`

Si `snapshot.mjs` ne reproduit pas les colonnes `role` de `core.organization_members` (vérifier : l'entrée a `columns: null` = toutes), rien d'autre à faire.

- [ ] **Step 4: Photographier puis répéter**

Run:
```bash
node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local
node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-baseline.sql
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261013_1_webshop_editeur.sql --assert scripts/migration-rehearsal/assert-webshop-editeur.sql
```
Expected: baseline OK (si le §1 de `assert-baseline.sql` échoue parce qu'il énumère VIEWS / POLICY_TABLES, y ajouter les mêmes entrées — cf. README) ; puis `assert-webshop-editeur A … OK` et `B … OK`.

- [ ] **Step 5: Appliquer en prod**

Via MCP Supabase `apply_migration` (project `ejqqqwudmizqisdkxohw`, name `20261013_1_webshop_editeur`, contenu du fichier).
Puis vérifier (execute_sql) :
```sql
select policyname, cmd from pg_policies where tablename in ('webshop_products','webshop_categories') order by 1;
select policyname from pg_policies where schemaname='storage' and policyname like 'webshop_images%';
select column_name from information_schema.columns where table_schema='public' and table_name='majordhome_webshop_orders' order by ordinal_position desc limit 3;
select has_table_privilege('service_role','majordhome.webshop_delivery_slots','SELECT');
```
Expected: 3 policies `_org_admin` + SELECT membres sur products ; select + write_org_admin sur categories ; 4 policies `webshop_images_*` ; dernières colonnes `pickup_point_name, sector_label, delivery_date` ; `true`.

Vérifier que le site boutique répond toujours (lecture service_role) : `curl -s -o /dev/null -w "%{http_code}" https://mayer-energie.fr/boutique` → `200`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261013_1_webshop_editeur.sql scripts/migration-rehearsal/assert-webshop-editeur.sql scripts/migration-rehearsal/snapshot.mjs scripts/migration-rehearsal/assert-baseline.sql
git commit -m "feat(webshop): catalogue en écriture org_admin, bucket photos, vue commandes enrichie"
```

---

### Task 3: Services + cache keys + hooks

**Files:**
- Create: `src/lib/webshop/imageToWebp.js`, `src/shared/services/webshopProducts.service.js`, `src/shared/services/webshopOrders.service.js`, `src/shared/hooks/useWebshop.js`
- Modify: `src/shared/hooks/cacheKeys.js` (ajout `webshopKeys` en fin de fichier)
- Delete (Task 6, quand plus aucun import) : `src/shared/services/webshop.service.js`

**Interfaces:**
- Consumes: `ownStoragePath` (Task 1) ; vue enrichie (Task 2).
- Produces:
  - `webshopProductsService.getProducts(orgId)`, `.getCategories(orgId)`, `.createProduct(orgId, payload)` (payload contient `id`, `slug`, `display_order`), `.updateProduct(orgId, productId, patch)`, `.uploadImage(orgId, productId, file) → { data: publicUrl }`, `.deleteImages(paths[])`.
  - `webshopOrdersService.getOrders(orgId)` (chaque commande porte `items: []`), `.updateOrder(orgId, orderId, patch)`.
  - `webshopKeys = { all, products, categories, orders }`.
  - `useWebshopCatalog() → { orgId, products, categories, isLoading, error, createProduct(payload), updateProduct({ id, patch }), isSaving }`
  - `useWebshopOrders() → { orgId, orders, isLoading, error, refetch, updateOrder({ id, patch }) }` (mise à jour optimiste du cache, rollback sur erreur).

- [ ] **Step 1: `src/lib/webshop/imageToWebp.js`**

```js
/**
 * imageToWebp.js — conversion navigateur d'une photo en WebP (largeur max 1600 px),
 * même format que le script d'import du site (scripts/import-dixneuf.ts).
 */
export async function imageToWebp(file, { maxWidth = 1600, quality = 0.82 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new Error('Conversion de la photo impossible');
  return blob;
}
```

- [ ] **Step 2: `src/shared/services/webshopProducts.service.js`**

```js
/**
 * webshopProducts.service.js — Catalogue boutique (lu en direct par le site Mayer).
 * Lectures/écritures : vue auto-updatable majordhome_webshop_products, toujours filtrées org_id.
 * Écritures réservées à org_admin par la RLS : `.select().single()` fait remonter un refus
 * (0 ligne → PGRST116) au lieu d'un faux succès.
 * Photos : bucket public `webshop`, chemin `${orgId}/products/${productId}/${uuid}.webp`.
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { imageToWebp } from '@/lib/webshop/imageToWebp';

const BUCKET = 'webshop';

export const webshopProductsService = {
  async getProducts(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .select('*')
        .eq('org_id', orgId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return data || [];
    }, 'webshopProducts.getProducts');
  },

  async getCategories(orgId) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_categories')
        .select('id, slug, name, parent_id, display_order, is_active')
        .eq('org_id', orgId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return data || [];
    }, 'webshopProducts.getCategories');
  },

  async createProduct(orgId, payload) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .insert({ ...payload, org_id: orgId })
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'webshopProducts.createProduct');
  },

  async updateProduct(orgId, productId, patch) {
    return withErrorHandling(async () => {
      if (!productId) throw new Error('[webshopProducts] productId requis');
      const { data, error } = await supabase
        .from('majordhome_webshop_products')
        .update(patch)
        .eq('id', productId)
        .eq('org_id', orgId)
        .select()
        .single();
      if (error) throw error;
      return data;
    }, 'webshopProducts.updateProduct');
  },

  /** @returns {{ data: string }} URL publique de la photo */
  async uploadImage(orgId, productId, file) {
    return withErrorHandling(async () => {
      const blob = await imageToWebp(file);
      const path = `${orgId}/products/${productId}/${crypto.randomUUID()}.webp`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
        contentType: 'image/webp',
        upsert: false,
      });
      if (error) throw error;
      return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    }, 'webshopProducts.uploadImage');
  },

  /** @param {string[]} paths - chemins sous `${orgId}/` uniquement (cf. imagesToDelete) */
  async deleteImages(paths) {
    return withErrorHandling(async () => {
      if (!paths?.length) return [];
      const { data, error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) throw error;
      return data;
    }, 'webshopProducts.deleteImages');
  },
};

export default webshopProductsService;
```

- [ ] **Step 3: `src/shared/services/webshopOrders.service.js`**

```js
/**
 * webshopOrders.service.js — Commandes boutique (kanban).
 * Lecture : vue majordhome_webshop_orders (+ créneau, secteur, point de retrait) puis lignes
 * majordhome_webshop_order_items fusionnées en mémoire (`order.items`).
 * Écriture : vue auto-updatable majordhome_webshop_orders_write.
 */
import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const CHUNK = 200;

export const webshopOrdersService = {
  async getOrders(orgId) {
    return withErrorHandling(async () => {
      const { data: orders, error } = await supabase
        .from('majordhome_webshop_orders')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const ids = (orders || []).map((o) => o.id);
      const items = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error: itemsError } = await supabase
          .from('majordhome_webshop_order_items')
          .select('order_id, product_id, product_name, product_slug, supplier_ref, qty, unit_price_ttc_cents, vat_rate, shipping_kind, pallet_slots, line_total_ttc_cents')
          .eq('org_id', orgId)
          .in('order_id', ids.slice(i, i + CHUNK));
        if (itemsError) throw itemsError;
        items.push(...(data || []));
      }
      const byOrder = new Map();
      for (const it of items) {
        if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
        byOrder.get(it.order_id).push(it);
      }
      return (orders || []).map((o) => ({ ...o, items: byOrder.get(o.id) ?? [] }));
    }, 'webshopOrders.getOrders');
  },

  async updateOrder(orgId, orderId, patch) {
    return withErrorHandling(async () => {
      if (!orderId) throw new Error('[webshopOrders] orderId requis');
      const { data, error } = await supabase
        .from('majordhome_webshop_orders_write')
        .update(patch)
        .eq('id', orderId)
        .eq('org_id', orgId)
        .select('id, status, carrier, tracking_number, internal_notes, shipped_at, delivered_at, cancel_reason')
        .single();
      if (error) throw error;
      return data;
    }, 'webshopOrders.updateOrder');
  },
};

export default webshopOrdersService;
```

- [ ] **Step 4: `webshopKeys` dans `cacheKeys.js`** (ajouter en fin de fichier)

```js
// --- Webshop (catalogue boutique + commandes) ---
export const webshopKeys = {
  all: (orgId) => ['webshop', orgId],
  products: (orgId) => [...webshopKeys.all(orgId), 'products'],
  categories: (orgId) => [...webshopKeys.all(orgId), 'categories'],
  orders: (orgId) => [...webshopKeys.all(orgId), 'orders'],
};
```

- [ ] **Step 5: `src/shared/hooks/useWebshop.js`**

```js
/**
 * useWebshop.js — hooks React Query du module Webshop (catalogue + commandes).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { unwrapResult } from '@lib/serviceHelpers';
import { webshopKeys } from '@/shared/hooks/cacheKeys';
import { webshopProductsService } from '@services/webshopProducts.service';
import { webshopOrdersService } from '@services/webshopOrders.service';

export function useWebshopCatalog() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();

  const productsQuery = useQuery({
    queryKey: webshopKeys.products(orgId),
    queryFn: () => unwrapResult(webshopProductsService.getProducts(orgId)),
    enabled: !!orgId,
  });
  const categoriesQuery = useQuery({
    queryKey: webshopKeys.categories(orgId),
    queryFn: () => unwrapResult(webshopProductsService.getCategories(orgId)),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: webshopKeys.products(orgId) });

  const createMutation = useMutation({
    mutationFn: (payload) => unwrapResult(webshopProductsService.createProduct(orgId, payload)),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, patch }) => unwrapResult(webshopProductsService.updateProduct(orgId, id, patch)),
    onSuccess: invalidate,
  });

  return {
    orgId,
    products: productsQuery.data ?? [],
    categories: categoriesQuery.data ?? [],
    isLoading: productsQuery.isLoading || categoriesQuery.isLoading,
    error: productsQuery.error || categoriesQuery.error,
    createProduct: createMutation.mutateAsync,
    updateProduct: updateMutation.mutateAsync,
    isSaving: createMutation.isPending || updateMutation.isPending,
  };
}

export function useWebshopOrders() {
  const { organization } = useAuth();
  const orgId = organization?.id;
  const qc = useQueryClient();
  const key = webshopKeys.orders(orgId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => unwrapResult(webshopOrdersService.getOrders(orgId)),
    enabled: !!orgId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }) => unwrapResult(webshopOrdersService.updateOrder(orgId, id, patch)),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData(key);
      qc.setQueryData(key, (old) => (old ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    orgId,
    orders: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    updateOrder: updateMutation.mutateAsync,
  };
}
```

- [ ] **Step 6: Vérifier**

Run: `npm run lint:errors && npx vite build`
Expected: aucune erreur, build OK (les nouveaux fichiers ne sont pas encore importés : `audit:dead-code` les signalerait — normal jusqu'à la Task 6, ne pas le lancer ici).

- [ ] **Step 7: Commit**

```bash
git add src/lib/webshop/imageToWebp.js src/shared/services/webshopProducts.service.js src/shared/services/webshopOrders.service.js src/shared/hooks/cacheKeys.js src/shared/hooks/useWebshop.js
git commit -m "feat(webshop): services catalogue/commandes filtrés org, hooks React Query"
```

---

### Task 4: Onglet Produits — liste + drawer d'édition

**Files:**
- Create: `src/apps/artisan/components/webshop/products/ProductsTab.jsx`, `ProductList.jsx`, `ProductDrawer.jsx`, `ProductFormSections.jsx`, `ProductImagesField.jsx`, `SpecsField.jsx`, `SiteUrlSetting.jsx`

**Interfaces:**
- Consumes: Task 1 (`catalog.js`), Task 3 (`useWebshopCatalog`, `webshopProductsService.uploadImage/deleteImages`), `useOrgSettings()` (`settings.webshop.site_url`), `useAuth().isOrgAdmin`, `FormField/TextInput/SelectInput/TextArea/inputClass` de `@apps/artisan/components/FormFields`, `ConfirmDialog` de `@/components/ui/confirm-dialog`.
- Produces: `<ProductsTab />` (default export) monté par `Webshop.jsx` (Task 6).

- [ ] **Step 1: `SiteUrlSetting.jsx`**

```jsx
/**
 * SiteUrlSetting — adresse du site boutique (settings.webshop.site_url).
 * Sert au lien « Voir sur le site » et à l'aperçu des photos stockées dans le dépôt du site.
 */
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Globe, Loader2 } from 'lucide-react';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { inputClass } from '@apps/artisan/components/FormFields';

export default function SiteUrlSetting({ canEdit }) {
  const { settings, save, isSaving } = useOrgSettings();
  const current = settings?.webshop?.site_url ?? '';
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);

  const handleSave = async () => {
    let url = value.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      await save({ webshop: { ...(settings?.webshop ?? {}), site_url: url || null } });
      toast.success('Adresse du site enregistrée');
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err.message}`);
    }
  };

  if (!canEdit && !current) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Globe className="w-4 h-4 text-secondary-400 shrink-0" />
      <span className="text-secondary-500 shrink-0">Site boutique</span>
      {canEdit ? (
        <>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://mayer-energie.fr"
            className={`${inputClass} max-w-xs py-1.5`}
          />
          {value.trim().replace(/\/+$/, '') !== current && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Enregistrer'}
            </button>
          )}
        </>
      ) : (
        <a href={current} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{current}</a>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `SpecsField.jsx`**

```jsx
/** SpecsField — caractéristiques « libellé — valeur » (objet `specs`). */
import { Plus, X } from 'lucide-react';
import { inputClass } from '@apps/artisan/components/FormFields';

export default function SpecsField({ rows, onChange, disabled, error }) {
  const update = (i, key, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const add = () => onChange([...rows, { label: '', value: '' }]);

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-secondary-400">Aucune caractéristique.</p>}
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={row.label}
            onChange={(e) => update(i, 'label', e.target.value)}
            placeholder="Libellé (ex. Poids)"
            disabled={disabled}
            className={`${inputClass} w-2/5`}
          />
          <input
            value={row.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder="Valeur (ex. 4,2 kg)"
            disabled={disabled}
            className={`${inputClass} flex-1`}
          />
          {!disabled && (
            <button type="button" onClick={() => remove(i)} className="p-2 text-secondary-400 hover:text-red-600" aria-label="Retirer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!disabled && (
        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700">
          <Plus className="w-4 h-4" /> Ajouter une caractéristique
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `ProductImagesField.jsx`**

```jsx
/**
 * ProductImagesField — photos d'un produit : dépôt (glisser / parcourir), ordre, principale.
 * L'envoi est immédiat (Storage) ; l'URL n'entre dans le produit qu'à l'enregistrement du drawer.
 */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, ChevronLeft, ChevronRight, Star, X, Loader2, ImageOff } from 'lucide-react';
import { webshopProductsService } from '@services/webshopProducts.service';
import { checkImageFile, resolveImageUrl } from '@/lib/webshop/catalog';

export default function ProductImagesField({ images, onChange, orgId, productId, siteUrl, disabled }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const accepted = [];
    for (const f of files) {
      const err = checkImageFile(f);
      if (err) toast.error(`${f.name} : ${err}`);
      else accepted.push(f);
    }
    if (accepted.length === 0) return;
    setUploading((n) => n + accepted.length);
    const urls = [];
    for (const f of accepted) {
      const { data, error } = await webshopProductsService.uploadImage(orgId, productId, f);
      if (error) toast.error(`${f.name} : envoi impossible (${error.message})`);
      else urls.push(data);
      setUploading((n) => n - 1);
    }
    if (urls.length) onChange([...images, ...urls]);
  };

  const move = (i, delta) => {
    const next = [...images];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    onChange(next);
  };
  const makeMain = (i) => onChange([images[i], ...images.filter((_, j) => j !== i)]);
  const remove = (i) => onChange(images.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {images.map((url, i) => {
          const src = resolveImageUrl(url, siteUrl);
          return (
            <div key={url} className="relative group aspect-square rounded-lg border border-secondary-200 bg-secondary-50 overflow-hidden">
              {src ? (
                <img src={src} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-secondary-400 text-[10px] p-1 text-center">
                  <ImageOff className="w-5 h-5 mb-1" /> Aperçu indisponible
                </div>
              )}
              {i === 0 && (
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-primary-600 text-white text-[10px] font-medium">Principale</span>
              )}
              {!disabled && (
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-white disabled:opacity-30" aria-label="Avancer"><ChevronLeft className="w-4 h-4" /></button>
                  {i !== 0 && (
                    <button type="button" onClick={() => makeMain(i)} className="p-1 text-white" aria-label="Mettre en principale" title="Mettre en principale"><Star className="w-4 h-4" /></button>
                  )}
                  <button type="button" onClick={() => remove(i)} className="p-1 text-white" aria-label="Retirer"><X className="w-4 h-4" /></button>
                  <button type="button" disabled={i === images.length - 1} onClick={() => move(i, 1)} className="p-1 text-white disabled:opacity-30" aria-label="Reculer"><ChevronRight className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          );
        })}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`up-${i}`} className="aspect-square rounded-lg border border-dashed border-secondary-300 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-secondary-400" />
          </div>
        ))}
      </div>
      {!disabled && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-5 cursor-pointer text-sm transition-colors ${
            dragOver ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-secondary-200 text-secondary-500 hover:border-secondary-300'
          }`}
        >
          <ImagePlus className="w-5 h-5" />
          <span>Glisser des photos ici ou <span className="text-primary-600 font-medium">parcourir</span></span>
          <span className="text-xs text-secondary-400">JPEG, PNG ou WebP · 8 Mo max</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `ProductFormSections.jsx`**

```jsx
/**
 * ProductFormSections — blocs du drawer produit (formulaire contrôlé, `form` + `set(field, value)`).
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FormField, TextInput, SelectInput, TextArea } from '@apps/artisan/components/FormFields';
import { VAT_RATES, SHIPPING_KINDS, computeMargin, parseDecimal } from '@/lib/webshop/catalog';

const VAT_OPTIONS = VAT_RATES.map((r) => ({ value: String(r), label: `${String(r).replace('.', ',')} %` }));

export function Block({ title, defaultOpen = true, hint, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-secondary-100 last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between py-3 text-left">
        <span className="text-sm font-semibold text-secondary-800">{title}</span>
        <span className="flex items-center gap-2 text-xs text-secondary-400">
          {!open && hint}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="pb-4 space-y-3">{children}</div>}
    </section>
  );
}

function NumberInput({ value, onChange, disabled, suffix, placeholder }) {
  return (
    <div className="relative">
      <TextInput value={value} onChange={onChange} disabled={disabled} inputMode="decimal" placeholder={placeholder} />
      {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-secondary-400">{suffix}</span>}
    </div>
  );
}

function categoryOptions(categories) {
  const roots = categories.filter((c) => !c.parent_id);
  const out = [];
  for (const r of roots) {
    out.push({ value: r.id, label: r.name });
    for (const c of categories.filter((x) => x.parent_id === r.id)) out.push({ value: c.id, label: `   └ ${c.name}` });
  }
  return out;
}

export function EssentialFields({ form, set, errors, categories, disabled }) {
  return (
    <>
      <FormField label="Nom" required error={errors.name}>
        <TextInput value={form.name} onChange={(v) => set('name', v)} disabled={disabled} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Marque">
          <TextInput value={form.brand} onChange={(v) => set('brand', v)} disabled={disabled} />
        </FormField>
        <FormField label="Catégorie">
          <SelectInput value={form.category_id} onChange={(v) => set('category_id', v ?? '')} options={categoryOptions(categories)} placeholder="— Aucune —" disabled={disabled} />
        </FormField>
      </div>
      <FormField label="Description courte">
        <TextArea value={form.short_description} onChange={(v) => set('short_description', v)} rows={2} disabled={disabled} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Prix TTC" required error={errors.price_ttc}>
          <NumberInput value={form.price_ttc} onChange={(v) => set('price_ttc', v)} disabled={disabled} suffix="€" />
        </FormField>
        <FormField label="TVA" required error={errors.vat_rate}>
          <SelectInput value={form.vat_rate} onChange={(v) => set('vat_rate', v ?? '20')} options={VAT_OPTIONS} disabled={disabled} />
        </FormField>
      </div>
    </>
  );
}

export function StockFields({ form, set, errors, disabled }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Expédition" required error={errors.shipping_kind}>
          <SelectInput value={form.shipping_kind} onChange={(v) => set('shipping_kind', v ?? '')} options={SHIPPING_KINDS} placeholder="— Choisir —" disabled={disabled} />
        </FormField>
        {form.shipping_kind === 'pallet' ? (
          <FormField label="Emplacements palette" required error={errors.pallet_slots}>
            <NumberInput value={form.pallet_slots} onChange={(v) => set('pallet_slots', v)} disabled={disabled} />
          </FormField>
        ) : (
          <FormField label="Poids" error={errors.weight_kg}>
            <NumberInput value={form.weight_kg} onChange={(v) => set('weight_kg', v)} disabled={disabled} suffix="kg" />
          </FormField>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Stock" error={errors.stock_qty}>
          <NumberInput value={form.stock_qty} onChange={(v) => set('stock_qty', v)} disabled={disabled} />
        </FormField>
        <FormField label="Délai" error={errors.lead_time_days}>
          <NumberInput value={form.lead_time_days} onChange={(v) => set('lead_time_days', v)} disabled={disabled} suffix="jours" />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm text-secondary-700">
        <input type="checkbox" checked={form.allow_backorder} onChange={(e) => set('allow_backorder', e.target.checked)} disabled={disabled} className="rounded border-secondary-300" />
        Continuer à vendre en rupture de stock
      </label>
    </>
  );
}

export function PoseFields({ form, set, errors, disabled }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <FormField label="Posé particulier TTC" error={errors.install_price_ttc}>
        <NumberInput value={form.install_price_ttc} onChange={(v) => set('install_price_ttc', v)} disabled={disabled} suffix="€" />
      </FormField>
      <FormField label="Posé pro TTC" error={errors.pro_install_price_ttc}>
        <NumberInput value={form.pro_install_price_ttc} onChange={(v) => set('pro_install_price_ttc', v)} disabled={disabled} suffix="€" />
      </FormField>
      <FormField label="TVA pose">
        <SelectInput value={form.install_vat_rate} onChange={(v) => set('install_vat_rate', v ?? '5.5')} options={VAT_OPTIONS} disabled={disabled} />
      </FormField>
    </div>
  );
}

export function PurchaseFields({ form, set, errors, disabled }) {
  const margin = computeMargin({
    priceTtc: parseDecimal(form.price_ttc),
    vatRate: Number(form.vat_rate),
    purchaseHt: parseDecimal(form.purchase_price_ht),
  });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Fournisseur">
          <TextInput value={form.supplier} onChange={(v) => set('supplier', v)} disabled={disabled} />
        </FormField>
        <FormField label="Référence fournisseur">
          <TextInput value={form.supplier_ref} onChange={(v) => set('supplier_ref', v)} disabled={disabled} />
        </FormField>
        <FormField label="EAN">
          <TextInput value={form.ean} onChange={(v) => set('ean', v)} disabled={disabled} />
        </FormField>
        <FormField label="Prix d'achat HT" error={errors.purchase_price_ht}>
          <NumberInput value={form.purchase_price_ht} onChange={(v) => set('purchase_price_ht', v)} disabled={disabled} suffix="€" />
        </FormField>
      </div>
      {margin && (
        <p className={`text-sm ${margin.amount < 0 ? 'text-amber-700' : 'text-secondary-600'}`}>
          Marge : <strong>{margin.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT</strong> ({String(margin.percent).replace('.', ',')} % du prix HT)
        </p>
      )}
    </>
  );
}

export function AdvancedFields({ form, set, disabled, slug, isNew }) {
  return (
    <>
      <FormField label="Description longue">
        <TextArea value={form.long_description} onChange={(v) => set('long_description', v)} rows={6} disabled={disabled} />
      </FormField>
      <FormField label={`Titre SEO (${form.seo_title.length}/60)`}>
        <TextInput value={form.seo_title} onChange={(v) => set('seo_title', v)} disabled={disabled} />
      </FormField>
      <FormField label={`Description SEO (${form.seo_description.length}/160)`}>
        <TextArea value={form.seo_description} onChange={(v) => set('seo_description', v)} rows={2} disabled={disabled} />
      </FormField>
      <FormField label="Adresse de la page">
        <p className="text-sm text-secondary-600 font-mono">
          /boutique/p/{slug || (isNew ? '… (calculée depuis le nom à l’enregistrement)' : '—')}
        </p>
        <p className="text-xs text-secondary-400">Fixée à la création pour ne pas casser les liens et le référencement.</p>
      </FormField>
    </>
  );
}
```

> Note : la spec prévoyait un bouton « Modifier l'adresse » avec avertissement. YAGNI V1 : non livré, l'adresse reste en lecture (le dire dans le rapport de fin).

- [ ] **Step 5: `ProductDrawer.jsx`**

```jsx
/**
 * ProductDrawer — édition / création d'un produit boutique.
 * Un objet `form` + son `initial` (isDirty = diff JSON) ; un seul « Enregistrer ».
 * Photos : envoyées immédiatement ; à l'enregistrement on supprime les fichiers de NOTRE préfixe
 * retirés du produit ; à l'abandon, ceux envoyés pendant la session.
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { X, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { webshopProductsService } from '@services/webshopProducts.service';
import {
  emptyProductForm, productToForm, validateProductForm, formToPayload, imagesToDelete,
  slugify, uniqueSlug, nextDisplayOrder, productPageUrl,
} from '@/lib/webshop/catalog';
import { Block, EssentialFields, StockFields, PoseFields, PurchaseFields, AdvancedFields } from './ProductFormSections';
import ProductImagesField from './ProductImagesField';
import SpecsField from './SpecsField';

export default function ProductDrawer({ product, products, categories, orgId, siteUrl, canEdit, onClose, createProduct, updateProduct, isSaving }) {
  const isNew = !product;
  const [productId] = useState(() => product?.id ?? crypto.randomUUID());
  const initial = useMemo(() => (product ? productToForm(product) : emptyProductForm()), [product]);
  const [form, setForm] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const errors = validateProductForm(form);
  const isValid = Object.keys(errors).length === 0;
  const isDirty = JSON.stringify(form) !== JSON.stringify(initial);
  const shownErrors = showErrors ? errors : {};
  const pageUrl = productPageUrl(product?.slug, siteUrl);
  const hasPose = Boolean(initial.install_price_ttc || initial.pro_install_price_ttc);

  const discardUploads = async () => {
    const paths = imagesToDelete(form.images, initial.images, orgId);
    if (paths.length) await webshopProductsService.deleteImages(paths);
  };

  const requestClose = () => {
    if (isDirty && canEdit) setConfirmClose(true);
    else onClose();
  };

  const handleSave = async () => {
    if (!isValid) { setShowErrors(true); toast.error('Des champs sont à corriger'); return; }
    const payload = formToPayload(form);
    try {
      if (isNew) {
        const slug = uniqueSlug(slugify(form.name), products.map((p) => p.slug));
        await createProduct({ ...payload, id: productId, slug, display_order: nextDisplayOrder(products) });
        toast.success('Produit créé');
      } else {
        await updateProduct({ id: product.id, patch: payload });
        toast.success('Produit enregistré — visible sur le site');
      }
      const orphans = imagesToDelete(initial.images, form.images, orgId);
      if (orphans.length) {
        const { error } = await webshopProductsService.deleteImages(orphans);
        if (error) toast.warning('Photos retirées du produit mais pas supprimées du stockage');
      }
      onClose();
    } catch (err) {
      toast.error(`Enregistrement refusé : ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={requestClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-6 py-4 border-b border-secondary-200">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-secondary-900 truncate">{isNew ? 'Nouveau produit' : product.name}</h2>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className={`px-2 py-0.5 rounded-full font-medium ${form.is_active ? 'bg-sky-100 text-sky-700' : 'bg-secondary-100 text-secondary-500'}`}>
                {form.is_active ? 'Visible sur le site' : 'Masqué'}
              </span>
              {pageUrl && (
                <a href={pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                  Voir sur le site <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
          <button type="button" onClick={requestClose} className="p-1 text-secondary-400 hover:text-secondary-700" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-6">
          {product?.supplier === 'dixneuf' && canEdit && (
            <p className="mt-4 flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Produit importé du catalogue Dixneuf : un ré-import peut remplacer les textes, caractéristiques et stock (pas le prix ni l'expédition).
            </p>
          )}
          <Block title="L'essentiel">
            <EssentialFields form={form} set={set} errors={shownErrors} categories={categories} disabled={!canEdit} />
            <div className="flex gap-6 text-sm text-secondary-700">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} disabled={!canEdit} className="rounded border-secondary-300" />
                Visible sur le site
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_featured} onChange={(e) => set('is_featured', e.target.checked)} disabled={!canEdit} className="rounded border-secondary-300" />
                Mis en avant
              </label>
            </div>
          </Block>
          <Block title="Photos" hint={`${form.images.length} photo(s)`}>
            <ProductImagesField images={form.images} onChange={(v) => set('images', v)} orgId={orgId} productId={productId} siteUrl={siteUrl} disabled={!canEdit} />
          </Block>
          <Block title="Caractéristiques" hint={`${form.specs.length}`}>
            <SpecsField rows={form.specs} onChange={(v) => set('specs', v)} disabled={!canEdit} error={shownErrors.specs} />
          </Block>
          <Block title="Stock & livraison">
            <StockFields form={form} set={set} errors={shownErrors} disabled={!canEdit} />
          </Block>
          <Block title="Pose" defaultOpen={hasPose} hint={hasPose ? 'renseignée' : 'non proposée'}>
            <PoseFields form={form} set={set} errors={shownErrors} disabled={!canEdit} />
          </Block>
          <Block title="Achat & marge" defaultOpen={false}>
            <PurchaseFields form={form} set={set} errors={shownErrors} disabled={!canEdit} />
          </Block>
          <Block title="Avancé (description longue, SEO)" defaultOpen={false}>
            <AdvancedFields form={form} set={set} disabled={!canEdit} slug={product?.slug} isNew={isNew} />
          </Block>
        </div>

        {canEdit && (
          <footer className="flex items-center justify-end gap-2 px-6 py-3 border-t border-secondary-200 bg-secondary-50">
            <button type="button" onClick={requestClose} className="px-4 py-2 text-sm text-secondary-600 hover:text-secondary-900">Annuler</button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isNew ? 'Créer le produit' : 'Enregistrer'}
            </button>
          </footer>
        )}
      </aside>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Abandonner les modifications ?"
        description="Les modifications non enregistrées seront perdues."
        confirmLabel="Abandonner"
        onConfirm={async () => { setConfirmClose(false); await discardUploads(); onClose(); }}
      />
    </div>
  );
}
```

- [ ] **Step 6: `ProductList.jsx`**

```jsx
/** ProductList — une ligne par produit ; Visible / Mis en avant se basculent au clic. */
import { Package, Star, Copy, ImageOff } from 'lucide-react';
import { resolveImageUrl } from '@/lib/webshop/catalog';

const euros = (n) => `${Number(n ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;

export default function ProductList({ products, categoriesById, siteUrl, canEdit, onOpen, onToggle, onDuplicate }) {
  if (products.length === 0) {
    return <div className="text-center py-12 text-secondary-500 text-sm">Aucun produit ne correspond.</div>;
  }
  return (
    <div className="bg-white border border-secondary-200 rounded-xl divide-y divide-secondary-100">
      {products.map((p) => {
        const thumb = resolveImageUrl(Array.isArray(p.images) ? p.images[0] : null, siteUrl);
        const outOfStock = (p.stock_qty ?? 0) <= 0 && !p.allow_backorder;
        return (
          <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary-50 cursor-pointer" onClick={() => onOpen(p)}>
            <div className="w-12 h-12 rounded-lg bg-secondary-100 overflow-hidden flex items-center justify-center shrink-0">
              {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-secondary-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium truncate ${p.is_active ? 'text-secondary-900' : 'text-secondary-400'}`}>{p.name}</p>
              <p className="text-xs text-secondary-500 truncate">
                {[p.brand, categoriesById.get(p.category_id)?.name].filter(Boolean).join(' · ') || '—'}
                {(!Array.isArray(p.images) || p.images.length === 0) && (
                  <span className="inline-flex items-center gap-0.5 ml-2 text-amber-600"><ImageOff className="w-3 h-3" /> sans photo</span>
                )}
              </p>
            </div>
            <div className="w-24 text-right text-sm font-semibold text-secondary-900">{euros(p.price_ttc)}</div>
            <div className="w-24 text-right">
              <span className={`text-xs px-2 py-0.5 rounded-full ${outOfStock ? 'bg-amber-100 text-amber-800' : 'bg-secondary-100 text-secondary-600'}`}>
                {outOfStock ? 'Rupture' : `Stock ${p.stock_qty ?? 0}`}
              </span>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onToggle(p, 'is_featured')}
                title={p.is_featured ? 'Retirer de la mise en avant' : 'Mettre en avant'}
                className="p-1.5 rounded hover:bg-secondary-100 disabled:cursor-default"
              >
                <Star className={`w-4 h-4 ${p.is_featured ? 'fill-amber-400 text-amber-400' : 'text-secondary-300'}`} />
              </button>
              <label className={`flex items-center gap-1.5 text-xs text-secondary-600 px-1.5 ${canEdit ? 'cursor-pointer' : ''}`}>
                <input type="checkbox" checked={p.is_active} disabled={!canEdit} onChange={() => onToggle(p, 'is_active')} className="rounded border-secondary-300" />
                Visible
              </label>
              {canEdit && (
                <button type="button" onClick={() => onDuplicate(p)} title="Dupliquer" className="p-1.5 rounded text-secondary-400 hover:bg-secondary-100 hover:text-secondary-700">
                  <Copy className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: `ProductsTab.jsx`**

```jsx
/** ProductsTab — catalogue boutique : recherche, filtre catégorie, liste, drawer. */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Loader2, Search, Lock } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { useWebshopCatalog } from '@hooks/useWebshop';
import { duplicatePayload, nextDisplayOrder } from '@/lib/webshop/catalog';
import { inputClass, selectClass } from '@apps/artisan/components/FormFields';
import ProductList from './ProductList';
import ProductDrawer from './ProductDrawer';
import SiteUrlSetting from './SiteUrlSetting';

function fold(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function ProductsTab() {
  const { isOrgAdmin } = useAuth();
  const { settings } = useOrgSettings();
  const siteUrl = settings?.webshop?.site_url ?? null;
  const { orgId, products, categories, isLoading, error, createProduct, updateProduct, isSaving } = useWebshopCatalog();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [drawer, setDrawer] = useState(null); // null | { product: object|null }

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const filtered = useMemo(() => {
    const q = fold(query).trim();
    const inCategory = (p) => !categoryId || p.category_id === categoryId || categoriesById.get(p.category_id)?.parent_id === categoryId;
    return products.filter((p) => inCategory(p) && (!q || [p.name, p.brand, p.supplier_ref].some((v) => fold(v).includes(q))));
  }, [products, query, categoryId, categoriesById]);

  const handleToggle = async (p, field) => {
    try {
      await updateProduct({ id: p.id, patch: { [field]: !p[field] } });
      toast.success(field === 'is_active' ? (p.is_active ? 'Produit masqué' : 'Produit visible sur le site') : 'Mise en avant mise à jour');
    } catch (err) {
      toast.error(`Modification refusée : ${err.message}`);
    }
  };

  const handleDuplicate = async (p) => {
    try {
      const copy = await createProduct(duplicatePayload(p, orgId, products.map((x) => x.slug), nextDisplayOrder(products)));
      toast.success('Copie créée (masquée) — ajoutez ses photos');
      setDrawer({ product: copy });
    } catch (err) {
      toast.error(`Duplication refusée : ${err.message}`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-secondary-400" /></div>;
  if (error) return <div className="text-center py-12 text-red-600 text-sm">Chargement du catalogue impossible : {error.message}</div>;

  const roots = categories.filter((c) => !c.parent_id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SiteUrlSetting canEdit={isOrgAdmin} />
        {isOrgAdmin ? (
          <button type="button" onClick={() => setDrawer({ product: null })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700">
            <Plus className="w-4 h-4" /> Nouveau produit
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-secondary-500"><Lock className="w-3.5 h-3.5" /> Lecture seule — modification réservée à l'administrateur</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un produit, une marque, une référence" className={`${inputClass} pl-9 w-80`} />
        </div>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${selectClass} w-64`}>
          <option value="">Toutes les catégories</option>
          {roots.map((r) => (
            <optgroup key={r.id} label={r.name}>
              <option value={r.id}>{r.name} (tout)</option>
              {categories.filter((c) => c.parent_id === r.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="self-center text-xs text-secondary-500">{filtered.length} / {products.length} produit(s)</span>
      </div>

      <ProductList
        products={filtered}
        categoriesById={categoriesById}
        siteUrl={siteUrl}
        canEdit={isOrgAdmin}
        onOpen={(p) => setDrawer({ product: p })}
        onToggle={handleToggle}
        onDuplicate={handleDuplicate}
      />

      {drawer && (
        <ProductDrawer
          key={drawer.product?.id ?? 'new'}
          product={drawer.product}
          products={products}
          categories={categories}
          orgId={orgId}
          siteUrl={siteUrl}
          canEdit={isOrgAdmin}
          onClose={() => setDrawer(null)}
          createProduct={createProduct}
          updateProduct={updateProduct}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
```

Vérifier que `@hooks/useWebshop` résout (`@hooks` → `src/shared/hooks`, cf. vite.config.js) et que `TextInput` transmet `inputMode` (il propage `...props` : oui).

- [ ] **Step 8: Vérifier**

Run: `npm run lint:errors && npx vite build`
Expected: OK. Compter les LOC : `wc -l src/apps/artisan/components/webshop/products/*.jsx` — aucun > 500.

- [ ] **Step 9: Commit**

```bash
git add src/apps/artisan/components/webshop/products
git commit -m "feat(webshop): éditeur de catalogue — liste, drawer par blocs, photos, caractéristiques"
```

---

### Task 5: Onglet Commandes — kanban + drawer

**Files:**
- Create: `src/apps/artisan/components/webshop/orders/OrdersTab.jsx`, `OrderCard.jsx`, `OrderDrawer.jsx`, `SideColumn.jsx`

**Interfaces:**
- Consumes: Task 1 (`orders.js`), Task 3 (`useWebshopOrders`), `KanbanBoard` (`@apps/artisan/components/shared/KanbanBoard`, props `items, columns, groupBy, renderCard, onCardClick, onDragEnd, searchFilter, searchPlaceholder, columnAmount, headerLeft, headerRight, emptyMessage`), `ConfirmDialog`.
- Produces: `<OrdersTab />` (default export).

- [ ] **Step 1: `OrderCard.jsx`**

```jsx
/** OrderCard — carte kanban d'une commande boutique. */
import { AlertTriangle } from 'lucide-react';
import { orderLines, linesSummary, orderTotalCents, orderBadges, formatCents } from '@/lib/webshop/orders';

const TONES = {
  neutral: 'bg-secondary-100 text-secondary-600',
  info: 'bg-sky-100 text-sky-700',
  warning: 'bg-amber-100 text-amber-800',
};

export default function OrderCard({ order }) {
  const lines = orderLines(order);
  const badges = orderBadges(order, lines);
  const created = new Date(order.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  return (
    <div className="bg-white rounded-lg border border-secondary-200 p-3 shadow-sm hover:shadow transition-shadow space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-mono text-secondary-500">{order.order_number}</span>
        <span className="text-xs text-secondary-400">{created}</span>
      </div>
      <p className="text-sm font-medium text-secondary-900 truncate">
        {[order.first_name, order.last_name].filter(Boolean).join(' ') || order.company_name || '—'}
        {order.city && <span className="font-normal text-secondary-500"> · {order.city}</span>}
      </p>
      <p className="text-xs text-secondary-600 line-clamp-2">{linesSummary(lines) || 'Aucun article'}</p>
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {badges.map((b) => (
            <span key={b.key} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${TONES[b.tone]}`}>
              {b.tone === 'warning' && <AlertTriangle className="w-3 h-3" />}
              {b.label}
            </span>
          ))}
        </div>
        <span className="text-sm font-semibold text-secondary-900 shrink-0">{formatCents(orderTotalCents(order))}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `SideColumn.jsx`**

```jsx
/** SideColumn — colonne repliée (En attente de paiement / Annulée) hors du tableau glissable. */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ORDER_STATUS_LABELS } from '@/lib/webshop/orders';
import OrderCard from './OrderCard';

export default function SideColumn({ status, orders, onOpen }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-secondary-200 rounded-xl bg-secondary-50">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2 text-sm">
        <span className="font-medium text-secondary-700">{ORDER_STATUS_LABELS[status]} <span className="text-secondary-400">({orders.length})</span></span>
        <ChevronDown className={`w-4 h-4 text-secondary-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-3 pt-0">
          {orders.length === 0 && <p className="text-xs text-secondary-400">Aucune commande.</p>}
          {orders.map((o) => (
            <div key={o.id} className="cursor-pointer" onClick={() => onOpen(o)}><OrderCard order={o} /></div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `OrderDrawer.jsx`**

```jsx
/**
 * OrderDrawer — détail d'une commande : lignes, montants, client, livraison, paiement, suivi.
 * Statut modifiable ici aussi ; annulation = motif obligatoire ; réactivation → Nouvelle.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { X, Phone, Mail, MapPin, Building2, Loader2, Truck, CreditCard } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TextInput, TextArea, FormField, SelectInput } from '@apps/artisan/components/FormFields';
import {
  ORDER_BOARD_COLUMNS, ORDER_STATUS_LABELS, orderLines, orderTotalCents, formatCents, statusPatch,
} from '@/lib/webshop/orders';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const DELIVERY_LABELS = { delivery: 'Livraison', pickup: 'Retrait' };

function Section({ title, icon: Icon, children }) {
  return (
    <section className="py-4 border-b border-secondary-100">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-secondary-400 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5" />} {title}
      </h3>
      <div className="text-sm text-secondary-700 space-y-1">{children}</div>
    </section>
  );
}

export default function OrderDrawer({ order, onClose, updateOrder }) {
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [tracking, setTracking] = useState(order.tracking_number ?? '');
  const [notes, setNotes] = useState(order.internal_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const lines = orderLines(order);
  const trackingDirty = carrier !== (order.carrier ?? '') || tracking !== (order.tracking_number ?? '') || notes !== (order.internal_notes ?? '');

  const run = async (patch, success) => {
    setSaving(true);
    try {
      await updateOrder({ id: order.id, patch });
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(`Modification refusée : ${err.message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveTracking = () => run({
    carrier: carrier.trim() || null,
    tracking_number: tracking.trim() || null,
    internal_notes: notes.trim() || null,
  }, 'Suivi enregistré');

  const changeStatus = (to) => run(statusPatch(order, to), `Commande « ${ORDER_STATUS_LABELS[to]} »`);

  const confirmCancel = async () => {
    const ok = await run({ status: 'annulee', cancel_reason: cancelReason.trim() }, 'Commande annulée');
    if (ok) { setCancelOpen(false); onClose(); }
  };

  const isCancelled = order.status === 'annulee';
  const isPending = order.status === 'en_attente_paiement';
  const vat = order.vat_breakdown && typeof order.vat_breakdown === 'object' ? Object.entries(order.vat_breakdown) : [];

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 px-6 py-4 border-b border-secondary-200">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">{order.order_number}</h2>
            <p className="text-xs text-secondary-500">Passée le {fmtDate(order.created_at)} · {formatCents(orderTotalCents(order))} TTC</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-secondary-400 hover:text-secondary-700" aria-label="Fermer"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-6">
          <div className="py-4 border-b border-secondary-100 flex items-center gap-3">
            {isCancelled || isPending ? (
              <span className="text-sm font-medium text-secondary-600">{ORDER_STATUS_LABELS[order.status]}</span>
            ) : (
              <div className="w-60">
                <SelectInput
                  value={order.status}
                  onChange={(v) => v && v !== order.status && changeStatus(v)}
                  options={ORDER_BOARD_COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
                  disabled={saving}
                />
              </div>
            )}
            {isCancelled && (
              <button type="button" disabled={saving} onClick={() => changeStatus('nouvelle')} className="text-sm text-primary-600 hover:underline">Réactiver</button>
            )}
            {!isCancelled && (
              <button type="button" disabled={saving} onClick={() => setCancelOpen(true)} className="ml-auto text-sm text-red-600 hover:underline">Annuler la commande</button>
            )}
          </div>
          {isCancelled && order.cancel_reason && <p className="pt-2 text-xs text-secondary-500">Motif : {order.cancel_reason}</p>}

          <Section title="Articles">
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-secondary-50 last:border-0">
                    <td className="py-1 pr-2">{l.name}{l.shippingKind && <span className="text-xs text-secondary-400"> · {l.shippingKind === 'pallet' ? 'palette' : 'colis'}</span>}</td>
                    <td className="py-1 px-2 text-right text-secondary-500">{l.qty} × {formatCents(l.unitCents ?? 0)}</td>
                    <td className="py-1 pl-2 text-right font-medium">{formatCents(l.totalCents ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {order.subtotal_ttc_cents !== null && order.subtotal_ttc_cents !== undefined && (
              <div className="pt-2 text-xs text-secondary-500 space-y-0.5">
                <p>Sous-total : {formatCents(order.subtotal_ttc_cents)} · Livraison : {formatCents(order.shipping_ttc_cents ?? 0)}</p>
                {vat.length > 0 && <p>TVA : {vat.map(([rate, cents]) => `${rate} % → ${formatCents(cents)}`).join(' · ')}</p>}
              </div>
            )}
            <p className="pt-1 font-semibold text-secondary-900">Total : {formatCents(orderTotalCents(order))} TTC</p>
          </Section>

          <Section title="Client" icon={MapPin}>
            <p className="font-medium">{[order.first_name, order.last_name].filter(Boolean).join(' ')}</p>
            <p>{[order.address, [order.postal_code, order.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</p>
            {order.phone && <p><a href={`tel:${order.phone}`} className="inline-flex items-center gap-1 text-primary-600"><Phone className="w-3.5 h-3.5" />{order.phone}</a></p>}
            {order.email && <p><a href={`mailto:${order.email}`} className="inline-flex items-center gap-1 text-primary-600"><Mail className="w-3.5 h-3.5" />{order.email}</a></p>}
            {order.comments && <p className="italic text-secondary-500">« {order.comments} »</p>}
            {order.lead_id && <p><Link to={`/pipeline?lead=${order.lead_id}`} className="text-primary-600 hover:underline">Lead lié : {order.lead_name ?? 'ouvrir'}</Link></p>}
          </Section>

          {order.channel === 'pro' && (
            <Section title="Concessionnaire" icon={Building2}>
              <p className="font-medium">{order.company_name}{order.company_siret && <span className="text-secondary-500"> — SIRET {order.company_siret}</span>}</p>
              <p className="text-secondary-500">{[order.company_contact, order.company_phone, order.company_email].filter(Boolean).join(' · ')}</p>
            </Section>
          )}

          <Section title="Livraison & paiement" icon={CreditCard}>
            {order.pallet_delivery_mode && <p>Palette : {DELIVERY_LABELS[order.pallet_delivery_mode]}{order.delivery_date && ` le ${fmtDate(order.delivery_date)}`}{order.sector_label && ` · secteur ${order.sector_label}`}</p>}
            {order.parcel_delivery_mode && <p>Colis : {DELIVERY_LABELS[order.parcel_delivery_mode]}</p>}
            {order.pickup_point_name && <p>Point de retrait : {order.pickup_point_name}</p>}
            {order.needs_manual_planning && <p className="text-amber-700">Livraison à planifier à la main</p>}
            {order.delivery_slot_changed && <p className="text-amber-700">Le créneau a été modifié après la commande</p>}
            <p>Paiement : {order.paid_at ? `reçu le ${fmtDate(order.paid_at)}` : isPending ? 'en attente' : '—'}</p>
            <p className="text-xs text-secondary-400">Expédiée : {fmtDate(order.shipped_at)} · Livrée : {fmtDate(order.delivered_at)}</p>
          </Section>

          <Section title="Suivi" icon={Truck}>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Transporteur"><TextInput value={carrier} onChange={setCarrier} /></FormField>
              <FormField label="N° de suivi"><TextInput value={tracking} onChange={setTracking} /></FormField>
            </div>
            <FormField label="Notes internes"><TextArea value={notes} onChange={setNotes} rows={3} placeholder="Fournisseur contacté, particularités…" /></FormField>
            <button type="button" onClick={saveTracking} disabled={!trackingDirty || saving} className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer le suivi
            </button>
          </Section>
        </div>
      </aside>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Annuler ${order.order_number} ?`}
        description="La commande passe en Annulée. Un éventuel remboursement se fait dans Stripe."
        confirmLabel="Annuler la commande"
        confirmDisabled={!cancelReason.trim()}
        loading={saving}
        onConfirm={confirmCancel}
      >
        <FormField label="Motif" required>
          <TextInput value={cancelReason} onChange={setCancelReason} placeholder="Ex. rupture fournisseur, demande du client" />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
```

Avant d'écrire le lien lead : vérifier comment une autre page ouvre un lead par URL (`grep -rn "pipeline?lead=\|/pipeline?" src | head`). Si aucun paramètre n'existe, remplacer le `<Link>` par le simple texte « Lead lié : {lead_name} » (ne pas inventer de route).

- [ ] **Step 4: `OrdersTab.jsx`**

```jsx
/** OrdersTab — kanban des commandes boutique (5 colonnes glissables + 2 repliées). */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { KanbanBoard } from '@apps/artisan/components/shared/KanbanBoard';
import { useWebshopOrders } from '@hooks/useWebshop';
import { selectClass } from '@apps/artisan/components/FormFields';
import {
  ORDER_BOARD_COLUMNS, ORDER_SIDE_STATUSES, ORDER_STATUS_LABELS, canMoveTo, statusPatch,
  matchesOrderSearch, orderTotalCents,
} from '@/lib/webshop/orders';
import OrderCard from './OrderCard';
import OrderDrawer from './OrderDrawer';
import SideColumn from './SideColumn';

export default function OrdersTab() {
  const { orders, isLoading, error, refetch, updateOrder } = useWebshopOrders();
  const [channel, setChannel] = useState('');
  const [orderType, setOrderType] = useState('');
  const [openId, setOpenId] = useState(null);

  const visible = useMemo(
    () => orders.filter((o) => (!channel || o.channel === channel) && (!orderType || o.order_type === orderType)),
    [orders, channel, orderType],
  );
  const boardOrders = visible.filter((o) => !ORDER_SIDE_STATUSES.includes(o.status));
  const openOrder = orders.find((o) => o.id === openId) ?? null;

  const handleDragEnd = async (result) => {
    const order = orders.find((o) => o.id === result.draggableId);
    const to = result.destination?.droppableId;
    if (!order || !canMoveTo(order.status, to)) return;
    try {
      await updateOrder({ id: order.id, patch: statusPatch(order, to) });
      toast.success(`${order.order_number} → ${ORDER_STATUS_LABELS[to]}`);
    } catch (err) {
      toast.error(`Changement refusé : ${err.message}`);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-secondary-400" /></div>;
  if (error) return <div className="text-center py-12 text-red-600 text-sm">Chargement des commandes impossible : {error.message}</div>;

  return (
    <div className="space-y-4">
      <KanbanBoard
        items={boardOrders}
        columns={ORDER_BOARD_COLUMNS}
        groupBy="status"
        renderCard={(o) => <OrderCard order={o} />}
        onCardClick={(o) => setOpenId(o.id)}
        onDragEnd={handleDragEnd}
        searchFilter={matchesOrderSearch}
        searchPlaceholder="N°, client, ville, email"
        columnAmount={(items) => items.reduce((s, o) => s + orderTotalCents(o), 0) / 100}
        emptyMessage="Aucune commande"
        headerLeft={(
          <div className="flex items-center gap-2">
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${selectClass} w-44 py-1.5`}>
              <option value="">Tous les canaux</option>
              <option value="particulier">Particulier</option>
              <option value="pro">Pro / concessionnaire</option>
            </select>
            <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className={`${selectClass} w-48 py-1.5`}>
              <option value="">Tous les types</option>
              <option value="vente_directe">Vente directe</option>
              <option value="vente_installation">Vente + installation</option>
            </select>
          </div>
        )}
        headerRight={(
          <button type="button" onClick={() => refetch()} className="p-2 text-secondary-400 hover:text-secondary-700" title="Actualiser">
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      />
      {ORDER_SIDE_STATUSES.map((s) => (
        <SideColumn key={s} status={s} orders={visible.filter((o) => o.status === s)} onOpen={(o) => setOpenId(o.id)} />
      ))}
      {openOrder && <OrderDrawer key={openOrder.id} order={openOrder} onClose={() => setOpenId(null)} updateOrder={updateOrder} />}
    </div>
  );
}
```

Vérifier dans `KanbanBoard.jsx` l'export nommé (`export function KanbanBoard`, oui) et que `columnAmount` attend des euros (il passe le résultat à `formatEuroCeil`, d'où la division par 100).

- [ ] **Step 5: Vérifier**

Run: `npm run lint:errors && npx vite build`
Expected: OK ; aucun fichier > 500 LOC.

- [ ] **Step 6: Commit**

```bash
git add src/apps/artisan/components/webshop/orders
git commit -m "feat(webshop): kanban des commandes boutique (lignes, livraison, suivi, annulation motivée)"
```

---

### Task 6: Orchestrateur, nettoyage, vérification finale, livraison

**Files:**
- Rewrite: `src/apps/artisan/pages/Webshop.jsx`
- Delete: `src/shared/services/webshop.service.js`
- Modify: `.claude/proposed-updates.md` (proposition CLAUDE.md)

- [ ] **Step 1: Réécrire `Webshop.jsx`**

```jsx
/**
 * Webshop.jsx - Majord'home Artisan
 * ============================================================================
 * Module Webshop (boutique du site Mayer) : orchestrateur d'onglets.
 * - Commandes : kanban (components/webshop/orders)
 * - Produits & tarifs : éditeur du catalogue lu en direct par le site (components/webshop/products)
 * - Inscriptions : inscriptions aux offres
 * Spec : docs/superpowers/specs/2026-10-13-webshop-editeur-catalogue-kanban-commandes-design.md
 * ============================================================================
 */
import { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import OrdersTab from '@/apps/artisan/components/webshop/orders/OrdersTab';
import ProductsTab from '@/apps/artisan/components/webshop/products/ProductsTab';
import InscriptionsTab from '@/apps/artisan/components/webshop/InscriptionsTab';

const TABS = [
  { id: 'orders', label: 'Commandes', Component: OrdersTab },
  { id: 'products', label: 'Produits & tarifs', Component: ProductsTab },
  { id: 'inscriptions', label: 'Inscriptions', Component: InscriptionsTab },
];

export default function Webshop() {
  const [tab, setTab] = useState('orders');
  const Active = TABS.find((t) => t.id === tab).Component;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-primary-100 rounded-xl flex items-center justify-center">
          <ShoppingCart className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-secondary-900">Webshop</h1>
          <p className="text-sm text-secondary-500">Commandes et catalogue de la boutique en ligne</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b border-secondary-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-secondary-500 hover:text-secondary-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  );
}
```

- [ ] **Step 2: Supprimer l'ancien service**

Run: `grep -rn "webshop.service'" src` → doit être vide après la réécriture ; puis `git rm src/shared/services/webshop.service.js`.

- [ ] **Step 3: Vérification complète**

Run:
```bash
npm run audit:quality
npm run lint
npx vite build
```
Expected: tous verts ; `audit:dead-code` ne liste aucun fichier `webshop` ; `npm run lint` ne dépasse pas le plafond de warnings (un nouveau warning → le corriger).

- [ ] **Step 4: Proposition CLAUDE.md**

Ajouter en fin de `.claude/proposed-updates.md` :

```markdown
## [2026-10-13] Module Webshop — éditeur de catalogue + kanban
**Statut** : PENDING
**Commit** : <hash du commit Task 6>
**Contexte** : Le catalogue boutique (lu en direct par le site Mayer en service_role) s'édite désormais dans Majord'home ; écritures réservées à org_admin (RLS) ; photos dans le bucket public `webshop` sous `${orgId}/products/…`.
**Proposition** : Section « Module Webshop » : (1) `majordhome.webshop_products` est consommé par le site — toute colonne renommée/retirée casse la boutique (vérifier `lib/boutique/catalog.ts` du dépôt Landing) ; (2) écritures catalogue org_admin only, le site écrit en service_role ; (3) photos : jamais supprimer hors préfixe `${orgId}/` (fichiers de l'import Dixneuf et chemins `/images/boutique/…` du site) ; (4) l'import Dixneuf du site écrase textes/specs/stock à chaque passage (seuls slug, prix, TVA, expédition, palettes sont « propriété CRM ») ; (5) `specs` est un jsonb : l'ordre des clés n'est pas conservé ; (6) `settings.webshop.site_url` = adresse du site (lien produit + aperçu des images relatives).
---
```

- [ ] **Step 5: Commit + push + suivi Vercel**

```bash
git add src/apps/artisan/pages/Webshop.jsx .claude/proposed-updates.md
git rm --cached -q src/shared/services/webshop.service.js 2>/dev/null; git add -A src/shared/services
git commit -m "feat(webshop): page orchestratrice, ancien service retiré"
git pull --rebase --autostash
git push
```
Puis suivre le déploiement Vercel jusqu'à READY (MCP Vercel `list_deployments` du projet Majord'home).

- [ ] **Step 6: Vérification bout en bout (prod)**

Avec Eric (ou en lecture) :
1. `/webshop` → Produits : modifier le prix d'un produit de test + ajouter une caractéristique + envoyer une photo → Enregistrer → toast « visible sur le site ».
2. Ouvrir `https://mayer-energie.fr/boutique/p/{slug}` : nouveau prix, caractéristique et photo visibles (cache du site : pages produit `force-dynamic`/strictes — si ancien contenu, recharger après 60 s).
3. Contrôle en base : `select images, specs, price_ttc from majordhome.webshop_products where slug='…';`
4. Commandes : la commande annulée `WEB-2026-0009` apparaît dans la colonne repliée « Annulée », le drawer affiche son article.
5. Remettre le produit de test dans son état initial.

---

## Self-review (fait)

- Couverture spec : §2.1 liste/recherche/filtre/dupliquer → T4 ; §2.2 blocs → T4 ; §2.3 slug figé, pas de suppression, nulls → T1/T4 ; §2.4 photos → T1/T2/T3/T4 ; §2.5 site_url → T4 ; §2.6 droits → T2/T4 ; §2.7 avertissement Dixneuf → T4 ; §3 kanban/carte/drawer/filtres → T1/T5 ; §4 vue/services/hooks/modules purs → T1–T3 ; §6 vérifications → T2/T6.
- Écart assumé : bouton « Modifier l'adresse » (spec §2.3) non livré en V1 — à signaler dans le rapport.
- Signatures cohérentes : `updateProduct({ id, patch })`, `updateOrder({ id, patch })`, `statusPatch(order, to)`, `imagesToDelete(before, after, orgId)` utilisés à l'identique dans T3–T5.
