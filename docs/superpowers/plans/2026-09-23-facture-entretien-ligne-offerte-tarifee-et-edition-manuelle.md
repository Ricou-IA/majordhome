# Facture d'entretien — ligne offerte tarifée (prix, TVA, remise) + édition manuelle des lignes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) La ligne offerte du gabarit par famille retrouve un prix HT, une TVA et un **pourcentage de remise réglable** (100 % par défaut) ; (2) la modale « Facturer » d'une carte entretien permet de **modifier les lignes à la main et d'en ajouter une** avant l'envoi, dans les deux modes (brouillon Pennylane et hub). Eric, 2026-09-23 : « on paramètre 99 % des cas et on garde la main sur les edge cases ».

**Architecture:** Tout le calcul reste dans le module pur `src/lib/entretienInvoiceModel.js` : la ligne offerte est construite par `buildEntretienInvoice` depuis le gabarit ; l'édition manuelle passe par deux nouvelles fonctions pures, `lineEditsFromModel(model)` (lignes → formulaire) et `applyLineEdits(model, edits)` (formulaire → modèle recalculé : montants, codes TVA, total, erreurs). La modale garde un état `edits` (null = lignes du modèle) et envoie `effectiveModel` aux deux chemins existants (`toPennylaneInvoicePayload`, `buildInvoiceDraft`) sans les modifier. L'éditeur de lignes est un composant présentationnel séparé (`InvoiceLinesEditor.jsx`). Aucune migration.

**Tech Stack:** JS pur + `node --test`, React 18 / Tailwind, `useOrgSettings().save({ pennylane })` (objet `pennylane` COMPLET).

**Spec:** décision d'Eric du 2026-09-23 (cette conversation), après la livraison `6da0902` (ligne offerte sans prix). Référence visuelle : facture manuelle Pennylane F-2026-09374 (« Ramonage conduit de fumée » 60 € HT, TVA 10 %, remise 100 %).

## Global Constraints

- Module `entretienInvoiceModel.js` PUR (aucun import React/Supabase). Tous les tests existants passent, sauf ceux explicitement adaptés ici (la ligne offerte retrouve un prix).
- Une org sans gabarit facture EXACTEMENT comme avant. Une modale sans édition (`edits === null`) envoie EXACTEMENT le modèle d'avant (les tests de round-trip le prouvent).
- Ligne offerte : `kind: 'libre'`, `quantity: 1`, `vatPercent` = TVA du gabarit si renseignée, sinon TVA de la ligne d'équipement qu'elle suit ; `grossTtc = round2(priceHt × (1 + vat/100))` ; `discountPercent` = remise du gabarit (0..100, défaut 100) ; `netTtc = round2(grossTtc × (1 − remise/100))` ; `unitPriceHt` = HT unitaire BRUT (6 décimales, `unitHt`) ; description « Offert dans le cadre du contrat d'entretien » si remise = 100, sinon `null` ; compte de vente = celui de la famille, déclinaison de SA TVA ; insérée juste après sa ligne d'équipement. Une remise < 100 fait ENTRER la ligne dans le total (c'est voulu : add-on tarifé).
- Charge utile Pennylane (brouillon) : `discount { type: 'relative', value }` seulement si remise > 0 (convention existante).
- Édition manuelle : une ligne éditée porte `label` (requis), `description`, `quantity` (> 0), `unitPriceHt` (HT unitaire brut ≥ 0, nombre), `vatPercent` (∈ `VAT_CODES`), `discountPercent` (0..100), et conserve `kind`, comptes et axes analytiques de la ligne d'origine ; une ligne ajoutée est `kind: 'libre'`, hérite TVA + compte de la PREMIÈRE ligne d'équipement (sinon 20 % et compte nul), sans équipement/catégorie. Tout invalide = erreur bloquante (`ligne_invalide`, message FR avec le numéro de ligne). Zéro ligne = `aucune_ligne`.
- Forme stockée : `settings.pennylane.invoice.templates.by_category[catId].offered = { label, price_ht, vat_rate (nombre ou null = TVA de la famille), discount_percent }`. Sauvegarde = objet `pennylane` COMPLET, jamais de chaîne "undefined".
- 0 warning ESLint ; `npm run audit:quality && npm run lint && npx vite build` verts avant chaque commit ; commits terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Pas de preview tools.

---

### Task 1: Modèle pur — ligne offerte tarifée + `lineEditsFromModel` / `applyLineEdits` / `newFreeLine`

**Files:**
- Modify: `src/lib/entretienInvoiceModel.js`
- Test: `scripts/entretien-invoice-model.test.mjs`, `scripts/invoice-document-model.test.mjs`

**Interfaces:**
- Produces:
  - `invoiceTemplatesFromSettings(raw).byCategory[catId].offered` = `{ label: string, priceHt: number, vatPercent: number|null, discountPercent: number } | null`.
  - `export function lineEditsFromModel(model) → Array<LineEdit>` avec `LineEdit = { kind, label, description, quantity: number, unitPriceHt: number, vatPercent: number, discountPercent: number, ledgerAccountId, ledgerAccountNumber, equipmentId, equipmentTypeId, categoryId }`.
  - `export function newFreeLine(model) → LineEdit`.
  - `export function applyLineEdits(model, edits) → model` (mêmes clés que `buildEntretienInvoice`, lignes recalculées, `totalTtc`, `errors`).

- [ ] **Step 1: Tests (échouent : exports absents / ancien comportement)**

Dans `scripts/entretien-invoice-model.test.mjs`, ajouter `lineEditsFromModel, applyLineEdits, newFreeLine` à l'import, puis REMPLACER le test `invoiceTemplatesFromSettings …` et le test `ligne offerte …` existants par :

```js
test('invoiceTemplatesFromSettings : ligne offerte = libellé + prix HT + TVA (ou null = famille) + remise (défaut 100, bornée 0..100)', () => {
  const t = invoiceTemplatesFromSettings({
    templates: { by_category: {
      'cat-poele': { label: ' Entretien Performance {type} ', subject: '', offered: { label: 'Ramonage conduit de fumée', price_ht: '60', vat_rate: '10', discount_percent: '100' } },
      'cat-pac': { label: 'undefined', offered: { label: '', price_ht: '10', vat_rate: '20' } },
      'cat-x': { offered: { label: 'Truc', price_ht: '5', vat_rate: '7', discount_percent: '150' } },
      'cat-y': { offered: { label: 'Sans prix' } },
    } },
  });
  assert.deepEqual(t.byCategory['cat-poele'], { label: 'Entretien Performance {type}', subject: null, offered: { label: 'Ramonage conduit de fumée', priceHt: 60, vatPercent: 10, discountPercent: 100 } });
  assert.deepEqual(t.byCategory['cat-pac'], { label: null, subject: null, offered: null });
  // TVA hors table → null (TVA de la famille) ; remise hors bornes → 100
  assert.deepEqual(t.byCategory['cat-x'], { label: null, subject: null, offered: { label: 'Truc', priceHt: 5, vatPercent: null, discountPercent: 100 } });
  assert.deepEqual(t.byCategory['cat-y'], { label: null, subject: null, offered: { label: 'Sans prix', priceHt: 0, vatPercent: null, discountPercent: 100 } });
  assert.deepEqual(invoiceTemplatesFromSettings({}), { byCategory: {} });
  assert.deepEqual(invoiceTemplatesFromSettings(null), { byCategory: {} });
});

test('ligne offerte : après sa ligne d’équipement, prix HT × TVA du gabarit, remise 100 → net 0 (total inchangé), remise 50 → entre dans le total, TVA null → TVA de la famille, charge utile Pennylane', () => {
  const catalog = [{ id: 1, number: '70601', vatRate: 'any' }, { id: 2, number: '70601', vatRate: 'FR_100' }, { id: 3, number: '70601', vatRate: 'FR_55' }];
  const refPoele55 = { ...referentiel, categoriesById: new Map([[CAT_POELE.id, { ...CAT_POELE, default_vat_rate: 5.5 }], [CAT_PAC.id, CAT_PAC], [CAT_SANS_TVA.id, CAT_SANS_TVA]]) };
  const build = (offered, amount = 90) => buildEntretienInvoice({
    intervention: { id: 'i1' }, contract: { id: 'c1', amount }, pricing: pricingFor([EQ_POELE]),
    parts: [{ designation: 'Joint', quantite: 1, prix_ht: 12, offert: false }], referentiel: refPoele55,
    ledgerAccounts: { byCategory: { 'cat-poele': '70601' }, parts: null, catalog },
    templates: { byCategory: { 'cat-poele': { label: null, subject: null, offered } } }, today: '2026-09-23',
  });
  const m = build({ label: 'Ramonage conduit de fumée', priceHt: 60, vatPercent: 10, discountPercent: 100 });
  assert.equal(m.errors.length, 0);
  assert.deepEqual(m.lines.map((l) => l.kind), ['contrat', 'libre', 'piece']);
  const off = m.lines[1];
  assert.equal(off.label, 'Ramonage conduit de fumée');
  assert.equal(off.description, 'Offert dans le cadre du contrat d’entretien');
  assert.equal(off.quantity, 1);
  assert.equal(off.vatPercent, 10);
  assert.equal(off.vatCode, 'FR_100');
  assert.equal(off.grossTtc, 66);
  assert.equal(off.netTtc, 0);
  assert.equal(off.discountPercent, 100);
  assert.equal(off.unitPriceHt, '60');
  assert.equal(off.ledgerAccountId, 2);          // déclinaison FR_100 de la famille
  assert.equal(off.ledgerAccountNumber, '70601');
  assert.equal(off.equipmentId, 'eq-1');
  assert.equal(m.totalTtc, 102);                  // 90 + pièce 12, l'offerte ne pèse rien
  const payload = toPennylaneInvoicePayload(m, { customerId: 1, draft: true, externalReference: 'x' });
  assert.deepEqual(payload.invoice_lines[1].discount, { type: 'relative', value: '100' });
  assert.equal(payload.invoice_lines[1].raw_currency_unit_price, '60');
  assert.equal(payload.invoice_lines[1].vat_rate, 'FR_100');
  assert.equal(payload.invoice_lines[1].ledger_account_id, 2);
  // remise 50 : la ligne entre dans le total, pas de mention « offert »
  const half = build({ label: 'Ramonage', priceHt: 60, vatPercent: 10, discountPercent: 50 });
  assert.equal(half.lines[1].netTtc, 33);
  assert.equal(half.lines[1].description, null);
  assert.equal(half.totalTtc, 135);
  // TVA null → TVA de la famille (5,5) et sa déclinaison de compte
  const fam = build({ label: 'Ramonage', priceHt: 60, vatPercent: null, discountPercent: 100 });
  assert.equal(fam.lines[1].vatPercent, 5.5);
  assert.equal(fam.lines[1].vatCode, 'FR_55');
  assert.equal(fam.lines[1].grossTtc, 63.3);
  assert.equal(fam.lines[1].ledgerAccountId, 3);
  // remise 0 sans prix : ligne à 0, pas de clé discount dans la charge utile
  const free = build({ label: 'Visite', priceHt: 0, vatPercent: null, discountPercent: 0 });
  assert.equal(free.lines[1].netTtc, 0);
  assert.equal(toPennylaneInvoicePayload(free, { customerId: 1, draft: true, externalReference: 'x' }).invoice_lines[1].discount, undefined);
  // 2 poêles → 2 lignes offertes
  const m2 = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 162 }, pricing: pricingFor([EQ_POELE, { ...EQ_POELE, id: 'eq-3' }]), parts: [], referentiel, templates: { byCategory: { 'cat-poele': { label: null, subject: null, offered: { label: 'Ramonage', priceHt: 60, vatPercent: 10, discountPercent: 100 } } } }, today: '2026-09-23' });
  assert.deepEqual(m2.lines.map((l) => l.kind), ['contrat', 'libre', 'contrat', 'libre']);
  assert.equal(m2.totalTtc, 162);
});

test('lineEditsFromModel → applyLineEdits sans modification : mêmes montants, même total, mêmes codes (round-trip)', () => {
  const m = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 162 }, pricing: pricingFor([EQ_POELE, EQ_PAC]), parts: [{ designation: 'Joint', quantite: 2, prix_ht: 12, offert: false }], referentiel, templates: { byCategory: { 'cat-poele': { label: null, subject: null, offered: { label: 'Ramonage', priceHt: 60, vatPercent: 10, discountPercent: 100 } } } }, today: '2026-09-23' });
  const edits = lineEditsFromModel(m);
  assert.equal(edits.length, m.lines.length);
  assert.equal(typeof edits[0].unitPriceHt, 'number');
  const back = applyLineEdits(m, edits);
  assert.deepEqual(back.lines.map((l) => [l.kind, l.label, l.quantity, l.vatPercent, l.vatCode, l.discountPercent, l.grossTtc, l.netTtc, l.unitPriceHt, l.ledgerAccountNumber]),
    m.lines.map((l) => [l.kind, l.label, l.quantity, l.vatPercent, l.vatCode, l.discountPercent, l.grossTtc, l.netTtc, l.unitPriceHt, l.ledgerAccountNumber]));
  assert.equal(back.totalTtc, m.totalTtc);
  assert.equal(back.subject, m.subject);
  assert.deepEqual(back.errors, m.errors);
  assert.deepEqual(back.discount, m.discount);
});

test('applyLineEdits : modifier, ajouter (newFreeLine hérite TVA + compte de la 1ʳᵉ ligne d’équipement), supprimer, invalide = erreur bloquante', () => {
  const catalog = [{ id: 1, number: '70601', vatRate: 'any' }, { id: 2, number: '70601', vatRate: 'FR_100' }];
  const m = buildEntretienInvoice({ intervention: { id: 'i1' }, contract: { id: 'c1', amount: 90 }, pricing: pricingFor([EQ_POELE]), parts: [], referentiel, ledgerAccounts: { byCategory: { 'cat-poele': '70601' }, parts: null, catalog }, today: '2026-09-23' });
  const edits = lineEditsFromModel(m);
  // modifier : quantité 2 au même PU brut, remise 10 % → net = round2(2 × 90 × 0,9)
  const edited = applyLineEdits(m, [{ ...edits[0], label: 'Entretien annuel', quantity: 2, discountPercent: 10 }]);
  assert.equal(edited.errors.length, 0);
  assert.equal(edited.lines[0].label, 'Entretien annuel');
  assert.equal(edited.lines[0].grossTtc, 180);
  assert.equal(edited.lines[0].netTtc, 162);
  assert.equal(edited.lines[0].discountPercent, 10);
  assert.equal(edited.totalTtc, 162);
  // ajouter une ligne libre : hérite TVA 10 et compte 70601/FR_100 de la 1ʳᵉ ligne d'équipement
  const free = newFreeLine(m);
  assert.equal(free.kind, 'libre');
  assert.equal(free.vatPercent, 10);
  assert.equal(free.ledgerAccountNumber, '70601');
  assert.equal(free.ledgerAccountId, 2);
  assert.equal(free.equipmentId, null);
  assert.equal(free.discountPercent, 0);
  const added = applyLineEdits(m, [...edits, { ...free, label: 'Déplacement', unitPriceHt: 20, quantity: 1 }]);
  assert.equal(added.errors.length, 0);
  assert.equal(added.lines[1].kind, 'libre');
  assert.equal(added.lines[1].grossTtc, 22);
  assert.equal(added.lines[1].netTtc, 22);
  assert.equal(added.lines[1].unitPriceHt, '20');
  assert.equal(added.lines[1].vatCode, 'FR_100');
  assert.equal(added.totalTtc, 112);
  // supprimer tout → aucune_ligne
  assert.ok(applyLineEdits(m, []).errors.some((e) => e.code === 'aucune_ligne'));
  // invalides : libellé vide, quantité 0, PU négatif, remise 120, TVA 7
  const bad = applyLineEdits(m, [
    { ...edits[0], label: '  ' },
    { ...free, label: 'Q', quantity: 0 },
    { ...free, label: 'P', unitPriceHt: -1 },
    { ...free, label: 'R', discountPercent: 120 },
    { ...free, label: 'T', vatPercent: 7 },
  ]);
  const codes = bad.errors.map((e) => e.code);
  assert.equal(codes.filter((c) => c === 'ligne_invalide').length, 4);
  assert.ok(codes.includes('tva_inconnue'));
  assert.ok(bad.errors.some((e) => /ligne 2/.test(e.message)));
  // un modèle sans ligne libre : newFreeLine sans ligne d'équipement → 20 % et compte nul
  const empty = newFreeLine({ lines: [] });
  assert.equal(empty.vatPercent, 20);
  assert.equal(empty.ledgerAccountId, null);
});
```

Dans `scripts/invoice-document-model.test.mjs`, la fixture `OFFERED` du test « ligne offerte » redevient tarifée : `grossTtc: 66, netTtc: 0, discountPercent: 100, unitPriceHt: '60'`, description « Offert dans le cadre du contrat d’entretien » ; assertion `discount_percent` → `100` ; le reste (unit_price_ht 0, ht/tva/ttc 0, totaux inchangés, PDF 0,00 €) reste tel quel.

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `node --test scripts/entretien-invoice-model.test.mjs scripts/invoice-document-model.test.mjs`
Expected: FAIL (`lineEditsFromModel` not exported, offerte sans prix).

- [ ] **Step 3: Implémenter dans `src/lib/entretienInvoiceModel.js`**

`invoiceTemplatesFromSettings` :

```js
const VALID_VATS = new Set(Object.keys(VAT_CODES).map(Number));
// …
      const o = t.offered && typeof t.offered === 'object' ? t.offered : null;
      const oLabel = cleanText(o?.label);
      let offered = null;
      if (oLabel) {
        const price = Number(o.price_ht);
        const vat = o.vat_rate === '' || o.vat_rate == null ? null : Number(o.vat_rate);
        const disc = Number(o.discount_percent);
        offered = {
          label: oLabel,
          priceHt: Number.isFinite(price) && price >= 0 ? round2(price) : 0,
          vatPercent: vat != null && VALID_VATS.has(vat) ? vat : null,
          discountPercent: Number.isFinite(disc) && disc >= 0 && disc <= 100 ? disc : 100,
        };
      }
```
(mettre à jour la JSDoc : `offered: { label, priceHt, vatPercent: number|null, discountPercent }`).

Ligne offerte dans `buildEntretienInvoice` (remplace le bloc `if (tpl?.offered)`) :

```js
    if (tpl?.offered) {
      const o = tpl.offered;
      const oVat = o.vatPercent ?? vatPercent;
      const oGross = round2(o.priceHt * (1 + oVat / 100));
      pushLine({
        kind: 'libre',
        label: o.label,
        description: o.discountPercent === 100 ? 'Offert dans le cadre du contrat d’entretien' : null,
        quantity: 1,
        vatPercent: oVat,
        ledgerAccountId: oVat === vatPercent ? ledgerId : ledgerForCategory(catId, catLabel, VAT_CODES[oVat] || null),
        ledgerAccountNumber: ledgerNumber ? String(ledgerNumber) : null,
        equipmentId: eq?.id ?? null,
        equipmentTypeId: typeId,
        categoryId: catId,
        grossTtc: oGross,
        netTtc: round2(oGross * (1 - o.discountPercent / 100)),
        discountPercent: o.discountPercent,
      });
    }
```

Nouvelles fonctions (après `toPennylaneInvoicePayload`) :

```js
/**
 * Lignes du modèle → lignes ÉDITABLES (modale « Facturer », édition à la main — Eric,
 * 2026-09-23 : « on paramètre 99 % des cas et on garde la main sur les edge cases »).
 * `unitPriceHt` = HT unitaire BRUT en nombre (6 décimales du modèle), la remise reste en %.
 * @param {ReturnType<typeof buildEntretienInvoice>} model
 */
export function lineEditsFromModel(model) {
  return (model?.lines || []).map((l) => ({
    kind: l.kind || 'libre',
    label: l.label || '',
    description: l.description ?? null,
    quantity: Number(l.quantity) || 1,
    unitPriceHt: Number(l.unitPriceHt) || 0,
    vatPercent: Number(l.vatPercent),
    discountPercent: Number(l.discountPercent) || 0,
    ledgerAccountId: l.ledgerAccountId ?? null,
    ledgerAccountNumber: l.ledgerAccountNumber ?? null,
    equipmentId: l.equipmentId ?? null,
    equipmentTypeId: l.equipmentTypeId ?? null,
    categoryId: l.categoryId ?? null,
  }));
}

/**
 * Ligne libre vierge à ajouter à la main : hérite la TVA et le compte de vente de la
 * PREMIÈRE ligne d'équipement (sinon 20 %, sans compte), sans équipement ni catégorie.
 * @param {{ lines?: Array }} model
 */
export function newFreeLine(model) {
  const first = (model?.lines || []).find((l) => l.kind === 'contrat') || null;
  return {
    kind: 'libre',
    label: '',
    description: null,
    quantity: 1,
    unitPriceHt: 0,
    vatPercent: first ? Number(first.vatPercent) : DEFAULT_VAT_PERCENT,
    discountPercent: 0,
    ledgerAccountId: first?.ledgerAccountId ?? null,
    ledgerAccountNumber: first?.ledgerAccountNumber ?? null,
    equipmentId: null,
    equipmentTypeId: null,
    categoryId: null,
  };
}

/**
 * Recalcule le modèle à partir de lignes éditées : montants (brut = PU HT × qté × (1 + TVA),
 * net = brut × (1 − remise)), code TVA, total, erreurs. Les erreurs de lignes du modèle
 * d'origine (`tva_inconnue`, `aucune_ligne`) sont remplacées par celles des lignes éditées ;
 * les autres (`montant_contrat_nul`…) sont conservées. `discount` (info remise contrat) et
 * `warnings` sont conservés tels quels.
 * @param {ReturnType<typeof buildEntretienInvoice>} model
 * @param {ReturnType<typeof lineEditsFromModel>} edits
 */
export function applyLineEdits(model, edits) {
  const kept = (model?.errors || []).filter((e) => e.code !== 'tva_inconnue' && e.code !== 'aucune_ligne');
  const errors = [...kept];
  const lines = [];
  (edits || []).forEach((e, i) => {
    const n = i + 1;
    const label = (e.label || '').trim();
    const quantity = Number(e.quantity);
    const unit = Number(e.unitPriceHt);
    const vatPercent = Number(e.vatPercent);
    const discountPercent = Number(e.discountPercent) || 0;
    const problems = [];
    if (!label) problems.push('libellé manquant');
    if (!(quantity > 0)) problems.push('quantité nulle');
    if (!(unit >= 0)) problems.push('prix unitaire négatif');
    if (!(discountPercent >= 0 && discountPercent <= 100)) problems.push('remise hors 0–100 %');
    if (problems.length) errors.push({ code: 'ligne_invalide', message: `Ligne ${n} : ${problems.join(', ')}.` });
    const vatCode = VAT_CODES[vatPercent];
    if (!vatCode) errors.push({ code: 'tva_inconnue', message: `Taux de TVA ${e.vatPercent} % sans équivalent Pennylane sur « ${label || `ligne ${n}`} ».` });
    const grossTtc = round2(unit * (quantity || 0) * (1 + (vatPercent || 0) / 100));
    const netTtc = round2(grossTtc * (1 - discountPercent / 100));
    lines.push({
      kind: e.kind || 'libre',
      label,
      description: e.description ? String(e.description).trim() || null : null,
      quantity,
      vatPercent,
      vatCode: vatCode || null,
      ledgerAccountId: e.ledgerAccountId ?? null,
      ledgerAccountNumber: e.ledgerAccountNumber ?? null,
      equipmentId: e.equipmentId ?? null,
      equipmentTypeId: e.equipmentTypeId ?? null,
      categoryId: e.categoryId ?? null,
      grossTtc,
      netTtc,
      discountPercent,
      unitPriceHt: unitHt(grossTtc, quantity || 1, vatPercent || 0),
    });
  });
  if (lines.length === 0) errors.push({ code: 'aucune_ligne', message: 'La facture n’a plus aucune ligne.' });
  const totalTtc = round2(lines.reduce((s, l) => s + l.netTtc, 0));
  return { ...model, lines, totalTtc, errors };
}
```

⚠️ Round-trip : `unitHt(grossTtc, qty, vat)` doit redonner la même chaîne 6 décimales qu'à l'origine pour une ligne non modifiée — vérifier par le test ; si un cas de la fixture diverge d'un centime, corriger en calculant `grossTtc` depuis `unit` avec `Math.round(… * 100) / 100` exactement comme ci-dessus (pas de `toFixed`).

- [ ] **Step 4: Tests verts**

Run: `node --test scripts/entretien-invoice-model.test.mjs scripts/invoice-document-model.test.mjs`
Expected: PASS.

- [ ] **Step 5: Qualité et commit**

Run: `npm run audit:quality`
```bash
git add src/lib/entretienInvoiceModel.js scripts/entretien-invoice-model.test.mjs scripts/invoice-document-model.test.mjs
git commit -m "feat(facturation): ligne offerte tarifée (prix, TVA, remise réglable) + édition manuelle des lignes dans le modèle pur"
```

---

### Task 2: Settings → Facturation : prix HT, TVA et remise de la ligne offerte

**Files:**
- Modify: `src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx`
- Modify: `src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx`

**Interfaces:**
- Consumes: `VAT_CODES` (`@/lib/entretienInvoiceModel`).
- Produces: `form.templates_by_category[catId] = { label, subject, offered_label, offered_price_ht, offered_vat, offered_discount }` (chaînes) ; stockage `offered: { label, price_ht: number, vat_rate: number|null, discount_percent: number }`.

- [ ] **Step 1: `TemplatesSection.jsx`**

`EMPTY_TEMPLATE = Object.freeze({ label: '', subject: '', offered_label: '', offered_price_ht: '', offered_vat: '', offered_discount: '100' })`. Importer `VAT_CODES` ; `const VAT_OPTIONS = Object.keys(VAT_CODES).map(Number).sort((a, b) => b - a);`. Sous le champ « Ligne offerte — libellé », une rangée `grid grid-cols-3 gap-4` :
- « Prix HT (€) » : `<input type="number" min="0" step="0.01" value={t.offered_price_ht} …>`
- « TVA » : `<select value={t.offered_vat}>` avec `<option value="">TVA de la famille</option>` puis `VAT_OPTIONS` (`{String(v).replace('.', ',')} %`)
- « Remise (%) » : `<input type="number" min="0" max="100" step="1" value={t.offered_discount} …>` ; hint « 100 % = offert (mention automatique sur la facture) ».
Aperçu de la ligne offerte (si libellé) : `Aperçu : <libellé> — <prix> € HT · TVA <taux ou "famille"> · remise <r> % → <net TTC> € TTC` où net TTC = `round2(prix × (1 + taux/100) × (1 − r/100))` (avec taux = 20 si « famille », mention « (TVA de la famille, ex. 20 %) ») ; à 100 % afficher `→ 0,00 € · Offert dans le cadre du contrat d'entretien`. Formater avec `toFixed(2).replace('.', ',')`.
Mettre à jour l'intro : « La ligne offerte apparaît sous chaque équipement de la famille, à son prix, remisée du pourcentage indiqué (100 % = offerte, elle ne change pas le total). »
Renvoyer `errors?.[cat.id]` en rouge sous la carte (prop `errors` réintroduite, optionnelle).

- [ ] **Step 2: `FacturationTab.jsx`**

- `pickForm` : `offered_price_ht: ledgerValue(t.offered?.price_ht)`, `offered_vat: ledgerValue(t.offered?.vat_rate)`, `offered_discount: t.offered?.discount_percent == null ? '100' : ledgerValue(t.offered.discount_percent)`.
- `templatesForSave` : si `oLabel` → `entry.offered = { label: oLabel, price_ht: Number(t.offered_price_ht) || 0, vat_rate: t.offered_vat === '' ? null : Number(t.offered_vat), discount_percent: t.offered_discount === '' ? 100 : Number(t.offered_discount) }`.
- `validate` : par catégorie avec `offered_label` renseigné : prix `< 0` ou non numérique → « Prix HT invalide » ; remise hors 0..100 → « Remise entre 0 et 100 % » ; sans libellé mais prix > 0 → « Indiquez le libellé de la ligne offerte ». `errors.templates` seulement si non vide ; `isValid` inchangé.
- Passer `errors={errors.templates}` à `TemplatesSection`.
- Commentaire de tête : forme `offered: { label, price_ht, vat_rate, discount_percent }`.

- [ ] **Step 3: Vérifier et committer**

Run: `npm run audit:quality && npm run lint && npx vite build`
```bash
git add src/apps/artisan/pages/settings/pennylane/TemplatesSection.jsx src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx
git commit -m "feat(settings): ligne offerte du gabarit — prix HT, TVA (ou famille) et remise réglable"
```

---

### Task 3: Modale « Facturer » : modifier les lignes à la main, en ajouter une

**Files:**
- Create: `src/apps/artisan/components/facturation/InvoiceLinesEditor.jsx`
- Modify: `src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx`
- Modify: `.claude/proposed-updates.md`

**Interfaces:**
- Consumes: `lineEditsFromModel`, `applyLineEdits`, `newFreeLine`, `VAT_CODES` (Task 1).
- Produces: `InvoiceLinesEditor({ lines, onChange })` présentationnel.

- [ ] **Step 1: `InvoiceLinesEditor.jsx`**

```jsx
// src/apps/artisan/components/facturation/InvoiceLinesEditor.jsx
// ============================================================================
// Édition à la main des lignes d'une facture d'entretien AVANT envoi (modale « Facturer »).
// Eric, 2026-09-23 : « on paramètre 99 % des cas et on garde la main sur les edge cases ».
// Présentationnel : `lines` = lineEditsFromModel(...) ; chaque saisie remonte la liste
// complète via onChange. Le recalcul (montants, TVA, total, erreurs) est fait par
// applyLineEdits dans le parent — ce composant ne calcule rien.
// ============================================================================
import { Trash2, Plus } from 'lucide-react';
import { VAT_CODES, newFreeLine } from '@/lib/entretienInvoiceModel';

const VAT_OPTIONS = Object.keys(VAT_CODES).map(Number).sort((a, b) => b - a);
const CELL = 'w-full px-1.5 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary-500';

/**
 * @param {object} p
 * @param {Array} p.lines   lignes éditables (`lineEditsFromModel`)
 * @param {(lines: Array) => void} p.onChange
 * @param {object|null} p.model  modèle d'origine (pour `newFreeLine`)
 */
export default function InvoiceLinesEditor({ lines, onChange, model }) {
  const patch = (i, p) => onChange(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const remove = (i) => onChange(lines.filter((_, j) => j !== i));
  const add = () => onChange([...lines, newFreeLine(model)]);
  return (
    <div className="space-y-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-200">
            <th className="text-left font-medium py-1">Libellé / description</th>
            <th className="text-right font-medium py-1 w-14">Qté</th>
            <th className="text-right font-medium py-1 w-20">PU HT</th>
            <th className="text-right font-medium py-1 w-16">TVA</th>
            <th className="text-right font-medium py-1 w-16">Rem. %</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-gray-100 align-top">
              <td className="py-1 pr-1 space-y-1">
                <input type="text" value={l.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Libellé" className={CELL} />
                <input type="text" value={l.description || ''} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Description (facultatif)" className={`${CELL} text-gray-600`} />
              </td>
              <td className="py-1 px-0.5"><input type="number" min="0" step="0.01" value={l.quantity} onChange={(e) => patch(i, { quantity: e.target.value })} className={`${CELL} text-right`} /></td>
              <td className="py-1 px-0.5"><input type="number" min="0" step="0.01" value={l.unitPriceHt} onChange={(e) => patch(i, { unitPriceHt: e.target.value })} className={`${CELL} text-right`} /></td>
              <td className="py-1 px-0.5">
                <select value={String(l.vatPercent)} onChange={(e) => patch(i, { vatPercent: Number(e.target.value) })} className={CELL}>
                  {VAT_OPTIONS.map((v) => <option key={v} value={String(v)}>{String(v).replace('.', ',')} %</option>)}
                </select>
              </td>
              <td className="py-1 px-0.5"><input type="number" min="0" max="100" step="1" value={l.discountPercent} onChange={(e) => patch(i, { discountPercent: e.target.value })} className={`${CELL} text-right`} /></td>
              <td className="py-1 text-right">
                <button type="button" onClick={() => remove(i)} title="Supprimer la ligne" className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
        <Plus className="w-3.5 h-3.5" /> Ajouter une ligne
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `FacturerEntretienDialog.jsx`**

1. Imports : `useState, useEffect` ; `Pencil, RotateCcw` de lucide ; `lineEditsFromModel, applyLineEdits` de `@/lib/entretienInvoiceModel` ; `InvoiceLinesEditor` de `@/apps/artisan/components/facturation/InvoiceLinesEditor`.
2. État : `const [edits, setEdits] = useState(null);` ; `useEffect(() => { setEdits(null); }, [model, open]);` (nouveau modèle ou réouverture ⇒ retour aux lignes calculées).
3. `const effectiveModel = useMemo(() => (model && edits ? applyLineEdits(model, edits) : model), [model, edits]);`
4. Remplacer `model` par `effectiveModel` dans : `blocked`, `buildInvoiceDraft({ model: effectiveModel, … })`, `toPennylaneInvoicePayload(effectiveModel, …)`, le rendu du tableau, des erreurs, de l'objet, du total et des warnings. `model` reste utilisé pour `lineEditsFromModel(model)` et `newFreeLine`.
5. Au-dessus du tableau, une ligne d'actions à droite : si `edits === null` → bouton texte `<Pencil/> Modifier les lignes` (`onClick={() => setEdits(lineEditsFromModel(model))}`) ; sinon → `<RotateCcw/> Revenir aux lignes calculées` (`setEdits(null)`). Quand `edits !== null`, afficher `<InvoiceLinesEditor lines={edits} onChange={setEdits} model={model} />` À LA PLACE du `<table>` lecture seule, et garder le `<tfoot>`-équivalent (remise contrat + Total TTC) sous l'éditeur sous forme d'un petit bloc `flex justify-between` avec `formatEuro(effectiveModel.totalTtc)`.
6. Sous l'éditeur, une phrase grise : « Les lignes modifiées partent telles quelles (brouillon Pennylane ou facture émise). La remise du contrat reste appliquée sur les lignes d'équipement via leur colonne Rem. »
7. Les erreurs `ligne_invalide` / `tva_inconnue` / `aucune_ligne` s'affichent par le rendu existant de `effectiveModel.errors` et bloquent le bouton (via `blocked`).
8. Mettre à jour le commentaire de tête (« Ce composant ne calcule rien » reste vrai : `applyLineEdits` calcule).

- [ ] **Step 3: Vérifier**

Run: `npm run audit:quality && npm run lint && npx vite build` — verts ; `wc -l` du dialogue reporté (attendu ≤ ~380).

- [ ] **Step 4: Proposition CLAUDE.md et commit**

Dans `.claude/proposed-updates.md`, entrée « Gabarits de facture d'entretien par catégorie » : ajouter à la Proposition « ligne offerte = libellé + prix HT + TVA (ou famille) + remise réglable (100 % = offerte, ne pèse rien) ; édition manuelle des lignes dans la modale Facturer (`lineEditsFromModel` / `applyLineEdits` / `newFreeLine`, module pur ; les deux modes envoient `effectiveModel`) » et compléter la ligne Commit avec les SHAs des trois tâches.

```bash
git add src/apps/artisan/components/facturation/InvoiceLinesEditor.jsx src/apps/artisan/components/entretiens/FacturerEntretienDialog.jsx .claude/proposed-updates.md
git commit -m "feat(facturation): modale Facturer — modifier les lignes à la main et en ajouter une avant envoi"
```

---

## Vérification de fin (Eric)

- Settings → Facturation, Poêle : « Ramonage conduit de fumée », 60, TVA 10 %, remise 100. Enregistrer, recharger : valeurs présentes.
- Carte entretien Réalisé → Facturer : aperçu montre le ramonage « offert » ; « Modifier les lignes » → changer la quantité, ajouter « Déplacement » 20 € HT, revenir aux lignes calculées ; créer le brouillon : Pennylane montre les lignes modifiées, la remise 100 % sur le ramonage.
- Risque inchangé (hub) : import Pennylane d'une ligne à 0 € — échec bruyant et rejouable, correctif = omettre les lignes à 0 du payload d'import.
