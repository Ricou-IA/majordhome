# Facture d'entretien — gabarits par catégorie (libellé, objet, ligne offerte) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre paramétrable, par catégorie d'équipement et par org, le libellé de la ligne d'entretien, l'objet de la facture et une ligne offerte (remisée à 100 %), pour les deux modes de facturation (brouillon Pennylane et hub Majord'home).

**Architecture:** Le modèle pur `buildEntretienInvoice` (`src/lib/entretienInvoiceModel.js`) est déjà l'unique source des deux modes (`toPennylaneInvoicePayload` côté brouillon, `buildInvoiceDraft` côté hub). On lui ajoute une option `templates` lue depuis `settings.pennylane.invoice.templates.by_category` ; un rendu de gabarit à variables `{type} {marque} {modele} {serie} {contrat}` ; une ligne offerte `kind: 'libre'`, `discountPercent: 100`, `netTtc: 0`. L'onglet Settings → Facturation gagne une section « Libellés et ligne offerte par catégorie » (composant extrait, l'onglet frôle 500 LOC). Aucune migration : `invoice_lines.kind` accepte déjà `libre`, `discount_percent` existe, les montants 0 passent les CHECK (`ht + tva = ttc`).

**Tech Stack:** JS pur + `node --test`, React 18 / Tailwind, `useOrgSettings().save({ pennylane })` (merge JSONB niveau 1 → objet `pennylane` COMPLET).

**Spec:** Décision d'Eric du 2026-09-23 (cette conversation) : « pas une usine à gaz », trois champs par catégorie, défauts = comportement actuel, tout dans `settings`. Contexte : facture manuelle Pennylane F-2026-09374 (« Entretien Performance Poêle à granulés Multimarque Z1 » + « Ramonage conduit de fumée » 60 € HT, TVA 10 %, remise 100 %, référence « Ramonage offert dans le cadre d'un contrat d'entretien »).

## Global Constraints

- Une org sans gabarit facture EXACTEMENT comme aujourd'hui : mêmes libellés, même objet, aucune ligne ajoutée. Tous les tests existants de `scripts/entretien-invoice-model.test.mjs` passent inchangés.
- Le modèle reste PUR (aucun import React / Supabase) ; toute règle se teste dans `scripts/entretien-invoice-model.test.mjs` (inclus dans `audit:quality`).
- La ligne offerte porte `kind: 'libre'` (pas de nouvelle valeur d'enum : `invoice_lines.kind CHECK IN ('contrat','piece','libre')`), `discountPercent: 100`, `netTtc: 0`, `grossTtc` = prix HT × (1 + TVA), `unitPriceHt` = prix HT brut (le brouillon Pennylane affiche 60 € HT · remise 100 % · 0 €, comme la facture manuelle). Elle ne change JAMAIS le total : `totalTtc` reste `contract.amount`.
- La ligne offerte utilise le compte de vente de sa catégorie (déclinaison de SON taux de TVA), jamais le compte des pièces.
- Le suffixe d'unités d'une ligne bi-split (`labelWithUnits` ≠ `label`, test MATHIEU) est CONSERVÉ après un gabarit de libellé.
- Sauvegarde Settings : objet `pennylane` complet, `invoice.templates = { by_category: { [categoryId]: { label?, subject?, offered?: { label, price_ht, vat_rate } } } }`, seules les catégories renseignées sont écrites, aucune chaîne `"undefined"` (cf. bug `parts`).
- Variables de gabarit : `{type}` (nom du type d'équipement), `{marque}`, `{modele}`, `{serie}`, `{contrat}` (numéro). Inconnue → vide. Après remplacement : espaces multiples réduits, chaîne trimée, ponctuation orpheline finale (`:`, `-`, `–`, `—`, `·`, `,`) retirée. Les textes de remplissage du parc (« À renseigner ») comptent comme vides (`clean` existant).
- Taux de TVA de la ligne offerte ∈ {20, 10, 5.5, 0} (`VAT_CODES`), sélecteur fermé côté UI.
- Pas de console.* (logger), pas de nouveau warning ESLint, `npm run audit:quality && npx vite build` verts avant chaque commit. Commits terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Modèle pur — gabarits de libellé / objet et ligne offerte

**Files:**
- Modify: `src/lib/entretienInvoiceModel.js`
- Test: `scripts/entretien-invoice-model.test.mjs`

**Interfaces:**
- Consumes: `buildEntretienInvoice({ …, templates })` — nouvel argument optionnel.
- Produces:
  - `export function renderInvoiceTemplate(template, vars) → string` (pur).
  - `export function invoiceTemplatesFromSettings(invoiceSettingsRaw) → { byCategory: Object<string, { label: string|null, subject: string|null, offered: { label: string, priceHt: number, vatPercent: number } | null }> }` — normalise `settings.pennylane.invoice.templates` (utilisé par `pennylaneInvoiceSettings` en Task 2).
  - `buildEntretienInvoice` accepte `templates` (forme normalisée ci-dessus) ; lignes offertes `{ kind: 'libre', label, description, quantity: 1, vatPercent, discountPercent: 100, grossTtc, netTtc: 0, categoryId, equipmentId, ledgerAccountId, ledgerAccountNumber }` insérées juste après la ligne d'équipement qu'elles accompagnent.

- [ ] **Step 1: Écrire les tests (ils échouent : fonctions absentes)**

Ajouter en fin de `scripts/entretien-invoice-model.test.mjs` (les fixtures `EQ_POELE`, `CAT_POELE`, `TYPE_POELE`, `pricingFor`, `referentiel` existent en tête de fichier ; ajouter `renderInvoiceTemplate, invoiceTemplatesFromSettings` à l'import) :

```js
test('renderInvoiceTemplate : variables, inconnue vide, espaces réduits, ponctuation orpheline retirée', () => {
  const vars = { type: 'Poêle à granulés', marque: 'Cola', modele: 'Fire HR acciaio', serie: '', contrat: 'CTR-00063' };
  assert.equal(renderInvoiceTemplate('Entretien de votre {type} : {marque} {modele}', vars), 'Entretien de votre Poêle à granulés : Cola Fire HR acciaio');
  assert.equal(renderInvoiceTemplate('Entretien {type} : {marque} {modele}', { ...vars, marque: '', modele: '' }), 'Entretien Poêle à granulés');
  assert.equal(renderInvoiceTemplate('Contrat {contrat} — {inconnue}', vars), 'Contrat CTR-00063');
  assert.equal(renderInvoiceTemplate('   ', vars), '');
  assert.equal(renderInvoiceTemplate(null, vars), '');
});

test('invoiceTemplatesFromSettings : normalise, ignore les vides et les "undefined", TVA hors table → null', () => {
  const t = invoiceTemplatesFromSettings({
    templates: { by_category: {
      'cat-poele': { label: ' Entretien Performance {type} ', subject: '', offered: { label: 'Ramonage conduit de fumée', price_ht: '60', vat_rate: '10' } },
      'cat-pac': { label: 'undefined', offered: { label: '', price_ht: '10', vat_rate: '20' } },
      'cat-x': { offered: { label: 'Truc', price_ht: '5', vat_rate: '7' } },
    } },
  });
  assert.deepEqual(t.byCategory['cat-poele'], { label: 'Entretien Performance {type}', subject: null, offered: { label: 'Ramonage conduit de fumée', priceHt: 60, vatPercent: 10 } });
  assert.deepEqual(t.byCategory['cat-pac'], { label: null, subject: null, offered: null });
  assert.deepEqual(t.byCategory['cat-x'], { label: null, subject: null, offered: null });
  assert.deepEqual(invoiceTemplatesFromSettings({}), { byCategory: {} });
  assert.deepEqual(invoiceTemplatesFromSettings(null), { byCategory: {} });
});

test('gabarits : libellé et objet rendus par catégorie, suffixe d’unités conservé, défaut inchangé sans gabarit', () => {
  const templates = { byCategory: { 'cat-poele': { label: 'Entretien Performance {type} Multimarque', subject: 'Entretien de votre {type} : {marque} {modele}', offered: null } } };
  const eq = { ...EQ_POELE, brand: 'Cola', model: 'Fire HR acciaio', serial_number: null };
  const m = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', contract_number: 'CTR-00063', amount: 90 }, pricing: pricingFor([eq]), parts: [], referentiel, templates, today: '2026-09-23' });
  assert.equal(m.errors.length, 0);
  assert.equal(m.lines.length, 1);
  assert.equal(m.lines[0].label, 'Entretien Performance Entretien et ramonage de conduit poêle à bois Multimarque');
  assert.equal(m.subject, 'Entretien de votre Entretien et ramonage de conduit poêle à bois : Cola Fire HR acciaio');
  // bi-split : suffixe d'unités conservé après gabarit
  const tPac = { byCategory: { 'cat-pac': { label: 'Entretien {type}', subject: null, offered: null } } };
  const pac = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 210 }, pricing: pricingFor([{ ...EQ_PAC, unit_count: 2 }], { discounts: [] }), parts: [], referentiel, templates: tPac, today: '2026-09-23' });
  const base = pricingFor([{ ...EQ_PAC, unit_count: 2 }], { discounts: [] }).items[0];
  const suffix = base.labelWithUnits.slice(base.label.length);
  assert.ok(suffix.length > 0, 'la fixture bi-split doit produire un suffixe d’unités');
  assert.equal(pac.lines[0].label, `Entretien Entretien PAC Air/Air${suffix}`);
  // sans gabarit : identique à avant
  const none = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', contract_number: 'CTR-00063', amount: 90 }, pricing: pricingFor([eq]), parts: [], referentiel, templates: { byCategory: {} }, today: '2026-09-23' });
  assert.equal(none.lines[0].label, pricingFor([eq]).items[0].labelWithUnits);
  assert.equal(none.subject, 'Entretien de votre poêle à bois : Cola · Fire HR acciaio');
});

test('ligne offerte : après sa ligne d’équipement, remise 100 %, TTC net 0, compte de la catégorie à SON taux, total inchangé, charge utile Pennylane', () => {
  const templates = { byCategory: { 'cat-poele': { label: null, subject: null, offered: { label: 'Ramonage conduit de fumée', priceHt: 60, vatPercent: 10 } } } };
  const catalog = [{ id: 1, number: '70601', vatRate: 'any' }, { id: 2, number: '70601', vatRate: 'FR_100' }, { id: 3, number: '70601', vatRate: 'FR_55' }];
  const refPoele55 = { ...referentiel, categoriesById: new Map([[CAT_POELE.id, { ...CAT_POELE, default_vat_rate: 5.5 }], [CAT_PAC.id, CAT_PAC], [CAT_SANS_TVA.id, CAT_SANS_TVA]]) };
  const m = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 90 }, pricing: pricingFor([EQ_POELE]), parts: [{ designation: 'Joint', quantite: 1, prix_ht: 12, offert: false }], referentiel: refPoele55, ledgerAccounts: { byCategory: { 'cat-poele': '70601' }, parts: null, catalog }, templates, today: '2026-09-23' });
  assert.equal(m.errors.length, 0);
  assert.deepEqual(m.lines.map((l) => l.kind), ['contrat', 'libre', 'piece']);
  const off = m.lines[1];
  assert.equal(off.label, 'Ramonage conduit de fumée');
  assert.equal(off.description, 'Offert dans le cadre du contrat d’entretien (valeur 60,00 € HT)');
  assert.equal(off.quantity, 1);
  assert.equal(off.vatPercent, 10);
  assert.equal(off.vatCode, 'FR_100');
  assert.equal(off.discountPercent, 100);
  assert.equal(off.grossTtc, 66);
  assert.equal(off.netTtc, 0);
  assert.equal(off.unitPriceHt, '60');
  assert.equal(off.ledgerAccountId, 2);
  assert.equal(off.ledgerAccountNumber, '70601');
  assert.equal(off.categoryId, 'cat-poele');
  assert.equal(off.equipmentId, 'eq-1');
  assert.equal(m.totalTtc, 102); // 90 + pièce 12, la ligne offerte ne pèse rien
  const payload = toPennylaneInvoicePayload(m, { customerId: 1, draft: true, externalReference: 'x' });
  assert.deepEqual(payload.invoice_lines[1].discount, { type: 'relative', value: '100' });
  assert.equal(payload.invoice_lines[1].raw_currency_unit_price, '60');
  assert.equal(payload.invoice_lines[1].vat_rate, 'FR_100');
  assert.equal(payload.invoice_lines[1].ledger_account_id, 2);
  // 2 poêles → 2 lignes offertes, une derrière chaque équipement
  const m2 = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 162 }, pricing: pricingFor([EQ_POELE, { ...EQ_POELE, id: 'eq-3' }]), parts: [], referentiel, templates, today: '2026-09-23' });
  assert.deepEqual(m2.lines.map((l) => l.kind), ['contrat', 'libre', 'contrat', 'libre']);
  assert.equal(m2.totalTtc, 162);
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `node --test scripts/entretien-invoice-model.test.mjs`
Expected: FAIL — `renderInvoiceTemplate` / `invoiceTemplatesFromSettings` ne sont pas exportées.

- [ ] **Step 3: Implémenter dans `src/lib/entretienInvoiceModel.js`**

Ajouter après `referenceEquipement` :

```js
/** Nombre en € HT, format FR, PDF-safe (espace simple, virgule). */
const fmtHt = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} € HT`;

/**
 * Rend un gabarit de libellé : `{type} {marque} {modele} {serie} {contrat}`. Variable inconnue
 * ou vide → rien ; espaces réduits ; ponctuation orpheline finale retirée (« Entretien Poêle : »
 * → « Entretien Poêle »). Gabarit vide/null → ''.
 * @param {string|null|undefined} template
 * @param {Object<string, string|null|undefined>} vars
 */
export function renderInvoiceTemplate(template, vars) {
  if (typeof template !== 'string' || !template.trim()) return '';
  const out = template.replace(/\{([a-z_]+)\}/gi, (_, key) => {
    const v = vars?.[key.toLowerCase()];
    return v == null ? '' : String(v);
  });
  return out.replace(/\s+/g, ' ').trim().replace(/[\s:\-–—·,]+$/u, '').trim();
}

const VALID_VATS = new Set(Object.keys(VAT_CODES).map(Number));
const cleanText = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s && s !== 'undefined' && s !== 'null' ? s : null;
};

/**
 * Gabarits de facture par catégorie d'équipement, normalisés depuis
 * `settings.pennylane.invoice.templates = { by_category: { [catId]: { label, subject,
 * offered: { label, price_ht, vat_rate } } } }` (Settings → Facturation). Une entrée vide
 * disparaît ; une ligne offerte sans libellé, sans prix > 0 ou à TVA hors table est ignorée.
 * @param {object|null|undefined} invoiceSettingsRaw  `settings.pennylane.invoice`
 * @returns {{ byCategory: Object<string, { label: string|null, subject: string|null, offered: { label: string, priceHt: number, vatPercent: number } | null }> }}
 */
export function invoiceTemplatesFromSettings(invoiceSettingsRaw) {
  const src = invoiceSettingsRaw?.templates?.by_category;
  const byCategory = {};
  if (src && typeof src === 'object') {
    for (const [catId, t] of Object.entries(src)) {
      if (!t || typeof t !== 'object') continue;
      const o = t.offered && typeof t.offered === 'object' ? t.offered : null;
      const oLabel = cleanText(o?.label);
      const oPrice = Number(o?.price_ht);
      const oVat = Number(o?.vat_rate);
      const offered = oLabel && oPrice > 0 && VALID_VATS.has(oVat) ? { label: oLabel, priceHt: oPrice, vatPercent: oVat } : null;
      byCategory[catId] = { label: cleanText(t.label), subject: cleanText(t.subject), offered };
    }
  }
  return { byCategory };
}
```

Dans `buildEntretienInvoice` :
- signature : ajouter `templates = { byCategory: {} },` après `ledgerAccounts = {},` et documenter le paramètre en JSDoc (`@param {{ byCategory: Object }} [p.templates]  `invoiceTemplatesFromSettings(...)``).
- dans la boucle `priced.forEach`, après le calcul de `catLabel` et avant `pushLine` :

```js
    const tpl = catId ? templates?.byCategory?.[catId] : null;
    const typeLabel = referentiel?.typesById?.get(typeId)?.label || it.label || 'Équipement';
    const vars = { type: typeLabel, marque: clean(eq?.brand), modele: clean(eq?.model), serie: clean(eq?.serial_number), contrat: contractNumber };
    const baseLabel = it.label || 'Entretien';
    const withUnits = it.labelWithUnits || baseLabel;
    const unitsSuffix = withUnits.startsWith(baseLabel) ? withUnits.slice(baseLabel.length) : '';
    const rendered = tpl?.label ? renderInvoiceTemplate(tpl.label, vars) : '';
    const label = rendered ? `${rendered}${unitsSuffix}` : withUnits;
    if (tpl?.subject) subjectTemplates.push(renderInvoiceTemplate(tpl.subject, vars));
```
  (remplace l'ancien `const label = it.labelWithUnits || it.label || 'Entretien';` ; déclarer `const subjectTemplates = [];` à côté de `subjectRefs`).
- juste après le `pushLine({ kind: 'contrat', … })` de la boucle, ajouter la ligne offerte :

```js
    if (tpl?.offered) {
      const o = tpl.offered;
      pushLine({
        kind: 'libre',
        label: o.label,
        description: `Offert dans le cadre du contrat d’entretien (valeur ${fmtHt(o.priceHt)})`,
        quantity: 1,
        vatPercent: o.vatPercent,
        ledgerAccountId: ledgerForCategory(catId, catLabel, VAT_CODES[o.vatPercent] || null),
        ledgerAccountNumber: ledgerNumber ? String(ledgerNumber) : null,
        equipmentId: eq?.id ?? null,
        equipmentTypeId: typeId,
        categoryId: catId,
        grossTtc: round2(o.priceHt * (1 + o.vatPercent / 100)),
        netTtc: 0,
        discountPercent: 100,
      });
    }
```
- `pushLine` : `netTtc: round2(line.netTtc ?? grossTtc)` — vérifier que `0` est conservé (`??` garde 0 : OK, ne pas remplacer par `||`).
- Objet : avant le bloc `let subject;`, si `subjectTemplates.length === 1 && priced.length === 1 && subjectTemplates[0]` → `subject = subjectTemplates[0]` et sauter le bloc existant (le garder tel quel pour tous les autres cas).
- Pièces : `partsVat` reste `lines[0]?.vatPercent` (la première ligne est toujours un équipement).

- [ ] **Step 4: Lancer les tests**

Run: `node --test scripts/entretien-invoice-model.test.mjs`
Expected: PASS, tous les tests (anciens + 4 nouveaux).

- [ ] **Step 5: Qualité et commit**

Run: `npm run audit:quality`
Expected: vert.

```bash
git add src/lib/entretienInvoiceModel.js scripts/entretien-invoice-model.test.mjs
git commit -m "feat(facturation): gabarits par catégorie — libellé, objet et ligne offerte dans le modèle d'entretien"
```

---

### Task 2: Settings → Facturation : section gabarits par catégorie + branchement des deux modes

**Files:**
- Create: `src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx`
- Modify: `src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx` (pickForm, save, rendu de la section)
- Modify: `src/shared/hooks/useOrgSettings.js` (`pennylaneInvoiceSettings` expose `templates`)
- Modify: `src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx` (passe `templates` au modèle)
- Modify: `.claude/proposed-updates.md` (entrée PENDING pour CLAUDE.md)

**Interfaces:**
- Consumes: `invoiceTemplatesFromSettings`, `VAT_CODES` (Task 1).
- Produces: `pennylaneInvoiceSettings(settings).templates` = forme normalisée ; `settings.pennylane.invoice.templates.by_category` en base.

- [ ] **Step 1: `pennylaneInvoiceSettings` expose `templates`**

Dans `src/shared/hooks/useOrgSettings.js`, importer `invoiceTemplatesFromSettings` depuis `'@/lib/entretienInvoiceModel'` et ajouter à l'objet retourné par `pennylaneInvoiceSettings` :

```js
    // Gabarits par catégorie (libellé de ligne, objet, ligne offerte) — Settings → Facturation,
    // consommés par buildEntretienInvoice dans les DEUX modes (brouillon PL et hub).
    templates: invoiceTemplatesFromSettings(inv),
```
Mettre à jour le commentaire de tête (« `mode` ∈ draft | final | hub », et la ligne « l'import Pennylane arrive en phase 2 » est périmée : l'import est livré).

- [ ] **Step 2: Le dialogue passe les gabarits au modèle**

Dans `FacturerEntretienDialog.jsx`, appel `buildEntretienInvoice({ … })` (ligne ~104) : ajouter `templates: invoiceSettings.templates,` après `ledgerAccounts`. Le tableau de dépendances du `useMemo` contient déjà `settings`.

- [ ] **Step 3: Composant `TemplatesSection.jsx`**

```jsx
// src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx
// ============================================================================
// Settings → Facturation : gabarits de facture d'entretien PAR CATÉGORIE d'équipement
// (Eric, 2026-09-23 : « pas une usine à gaz, paramétrable facilement pour un tiers »).
// Trois champs par catégorie, tous facultatifs : libellé de la ligne, objet de la facture,
// ligne offerte (libellé + prix HT + TVA, toujours remisée à 100 %). Vide = comportement par
// défaut. Consommé par buildEntretienInvoice dans les deux modes (brouillon PL et hub).
// Présentationnel : l'état vit dans FacturationTab (form.templates_by_category).
// ============================================================================
import { VAT_CODES } from '@/lib/entretienInvoiceModel';

const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const VAT_OPTIONS = Object.keys(VAT_CODES).map(Number).sort((a, b) => b - a);

export const EMPTY_TEMPLATE = Object.freeze({ label: '', subject: '', offered_label: '', offered_price_ht: '', offered_vat: '10' });

/**
 * @param {object} p
 * @param {Array<{ id: string, label: string }>} p.categories
 * @param {Object<string, typeof EMPTY_TEMPLATE>} p.value  form.templates_by_category
 * @param {(catId: string, patch: object) => void} p.onChange
 * @param {Object<string, string>} p.errors  `{ [catId]: message }`
 */
export default function TemplatesSection({ categories, value, onChange, errors }) {
  return (
    <div className="space-y-6">
      <p className="text-xs text-secondary-500">
        Variables disponibles : <code>{'{type}'}</code> (type d&apos;équipement), <code>{'{marque}'}</code>, <code>{'{modele}'}</code>,{' '}
        <code>{'{serie}'}</code>, <code>{'{contrat}'}</code>. Champ vide = libellé automatique. La ligne offerte apparaît sous chaque
        équipement de la catégorie, au prix indiqué et remisée à 100 % : elle ne change pas le total.
      </p>
      {categories.map((cat) => {
        const t = value?.[cat.id] || EMPTY_TEMPLATE;
        return (
          <div key={cat.id} className="border border-secondary-200 rounded-md p-4">
            <div className="text-sm font-medium text-secondary-900 mb-3">{cat.label}</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Libellé de la ligne d&apos;entretien</label>
                <input type="text" value={t.label} onChange={(e) => onChange(cat.id, { label: e.target.value })} placeholder="Entretien Performance {type} Multimarque" className={INPUT_CLASS} />
              </div>
              <div>
                <label className={LABEL_CLASS}>Objet de la facture</label>
                <input type="text" value={t.subject} onChange={(e) => onChange(cat.id, { subject: e.target.value })} placeholder="Entretien de votre {type} : {marque} {modele}" className={INPUT_CLASS} />
                <p className={HINT_CLASS}>Utilisé quand la facture ne porte qu&apos;un équipement.</p>
              </div>
              <div>
                <label className={LABEL_CLASS}>Ligne offerte — libellé</label>
                <input type="text" value={t.offered_label} onChange={(e) => onChange(cat.id, { offered_label: e.target.value })} placeholder="Ramonage conduit de fumée" className={INPUT_CLASS} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLASS}>Prix HT (€)</label>
                  <input type="number" min="0" step="0.01" value={t.offered_price_ht} onChange={(e) => onChange(cat.id, { offered_price_ht: e.target.value })} className={INPUT_CLASS} />
                </div>
                <div>
                  <label className={LABEL_CLASS}>TVA</label>
                  <select value={t.offered_vat} onChange={(e) => onChange(cat.id, { offered_vat: e.target.value })} className={INPUT_CLASS}>
                    {VAT_OPTIONS.map((v) => <option key={v} value={String(v)}>{String(v).replace('.', ',')} %</option>)}
                  </select>
                </div>
              </div>
            </div>
            {errors?.[cat.id] && <p className="mt-2 text-xs text-red-600">{errors[cat.id]}</p>}
          </div>
        );
      })}
      {categories.length === 0 && <p className={HINT_CLASS}>Aucune catégorie d&apos;équipement active (Paramètres → Équipements).</p>}
    </div>
  );
}
```

- [ ] **Step 4: Brancher dans `FacturationTab.jsx`**

1. Import : `import TemplatesSection, { EMPTY_TEMPLATE } from './TemplatesSection';`
2. `pickForm(settings)` : ajouter

```js
  const templatesByCategory = {};
  const raw = settings?.pennylane?.invoice?.templates?.by_category;
  if (raw && typeof raw === 'object') {
    for (const [catId, t] of Object.entries(raw)) {
      if (!t || typeof t !== 'object') continue;
      templatesByCategory[catId] = {
        label: ledgerValue(t.label),
        subject: ledgerValue(t.subject),
        offered_label: ledgerValue(t.offered?.label),
        offered_price_ht: ledgerValue(t.offered?.price_ht),
        offered_vat: ledgerValue(t.offered?.vat_rate) || '10',
      };
    }
  }
```
   et la clé `templates_by_category: templatesByCategory` dans l'objet retourné.
3. Forme stockée, à côté de `ledgerAccountsForSave` :

```js
/** Forme stockée des gabarits : seules les catégories renseignées, jamais de "undefined". */
function templatesForSave(form) {
  const by_category = {};
  for (const [catId, t] of Object.entries(form.templates_by_category || {})) {
    const label = (t.label || '').trim();
    const subject = (t.subject || '').trim();
    const oLabel = (t.offered_label || '').trim();
    const oPrice = Number(t.offered_price_ht);
    const entry = {};
    if (label) entry.label = label;
    if (subject) entry.subject = subject;
    if (oLabel && oPrice > 0) entry.offered = { label: oLabel, price_ht: oPrice, vat_rate: Number(t.offered_vat) };
    if (Object.keys(entry).length > 0) by_category[catId] = entry;
  }
  return { by_category };
}
```
4. `validate(form)` : pour chaque catégorie, si `offered_label` renseigné et `Number(offered_price_ht) > 0` est faux → `errors.templates[catId] = 'Indiquez un prix HT supérieur à 0 pour la ligne offerte'` ; si prix > 0 et libellé vide → `'Indiquez le libellé de la ligne offerte'`. `isValid` = aucune clé hors `templates` ET `templates` vide (adapter `Object.keys(errors).length === 0` en conséquence : `errors.templates` n'est posé que s'il contient au moins une entrée).
5. `handleSave` : ajouter `templates: templatesForSave(form),` dans `invoice`.
6. Setter : `const setTemplate = (catId, patch) => setForm((f) => ({ ...f, templates_by_category: { ...f.templates_by_category, [catId]: { ...(f.templates_by_category?.[catId] || EMPTY_TEMPLATE), ...patch } } }));`
7. Rendu : nouvelle `<section className={form.enabled ? '' : 'opacity-50 pointer-events-none'}>` placée juste APRÈS la section « compte de vente par catégorie », titre `Contrats d'entretien — libellés et ligne offerte par catégorie`, contenu `<TemplatesSection categories={categories} value={form.templates_by_category} onChange={setTemplate} errors={errors.templates} />`.
8. Commentaire de tête du fichier : ajouter `templates: { by_category }` à la description de `settings.pennylane.invoice`.

- [ ] **Step 5: Vérifier**

Run: `npm run audit:quality && npx vite build`
Expected: vert, 0 warning ESLint (`npm run lint`), `FacturationTab.jsx` ne dépasse pas ~520 LOC (la section est extraite ; si > 500, extraire aussi les deux blocs de test « spike » dans `JournalSpikeSection.jsx` — à signaler, pas obligatoire).

- [ ] **Step 6: Proposition CLAUDE.md**

Ajouter dans `.claude/proposed-updates.md` une entrée PENDING (format du fichier) : « Gabarits de facture d'entretien par catégorie » — `settings.pennylane.invoice.templates.by_category[catId] = { label, subject, offered: { label, price_ht, vat_rate } }`, variables `{type} {marque} {modele} {serie} {contrat}`, ligne offerte `kind='libre'` remise 100 % sans effet sur le total, source unique `buildEntretienInvoice` pour les deux modes, éditable Settings → Facturation. Y inscrire les SHAs des commits de Task 1 et Task 2.

- [ ] **Step 7: Commit**

```bash
git add src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx src/shared/hooks/useOrgSettings.js src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx .claude/proposed-updates.md
git commit -m "feat(settings): gabarits de facture d'entretien par catégorie (libellé, objet, ligne offerte) branchés sur les deux modes"
```

---

## Vérification de fin (contrôleur / Eric)

- Mayer, Settings → Facturation : catégorie Poêle → libellé « Entretien Performance {type} Multimarque », objet « Entretien de votre {type} : {marque} {modele} », ligne offerte « Ramonage conduit de fumée » 60 € HT TVA 10 %. Enregistrer, recharger : valeurs présentes, `settings.pennylane.invoice.templates.by_category` en base sans `"undefined"`.
- Carte entretien Réalisé (mode brouillon) : l'aperçu du dialogue « Facturer » montre 2 lignes (équipement + ramonage 0 €), total inchangé ; le brouillon Pennylane affiche 60 € HT, remise 100 %, TVA 10 %, comme la facture manuelle F-2026-09374.
- Risque assumé, à observer au premier import hub : Pennylane pourrait refuser une ligne à `currency_amount` 0 sur `/customer_invoices/import`. Si oui, la carte porte `import_status = error` (visible, rejouable) et le correctif est d'omettre les lignes à 0 du payload d'import dans l'edge `pennylane-invoice-import` (le PDF légal est celui de Majord'home ; la ligne n'a aucun effet comptable).
