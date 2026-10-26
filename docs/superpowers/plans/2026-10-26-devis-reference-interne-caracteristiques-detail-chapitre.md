# Devis — référence interne, caractéristiques, détail des prix par chapitre, éditer l'article — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le devis imprime la référence interne et les caractéristiques de l'article, une description par ligne, peut masquer les prix d'un chapitre, et un article se corrige depuis la ligne (droits `team_leader`).

**Architecture:** Trois colonnes sur `quote_lines` (`hide_prices`, `show_specs`, `caracteristiques`) portées par l'état de ligne du front et figées à l'enregistrement ; une colonne `code` sur `catalog_items` ; un module pur `devisCaracteristiques.js` qui met en forme les specs ; le modèle de document (`devisDocumentModel.js`) reste la seule source du PDF et de l'aperçu ; les droits d'article passent par le registre canonique (`articles.create/edit` → `role_can`), avec une RPC `user_can` pour les edges.

**Tech Stack:** React 18 + Vite, Supabase (PostgreSQL, RLS, RPC SECURITY DEFINER), react-pdf, `node --test` pour les modules purs, harnais `scripts/migration-rehearsal/`.

**Spec:** `docs/superpowers/specs/2026-10-26-devis-reference-interne-caracteristiques-detail-chapitre-design.md`

## Global Constraints

- Toute migration dans `supabase/migrations/` (numéros `20261028_1`, `_2`, `_3`), répétée sur le harnais (`node scripts/migration-rehearsal/run.mjs` + fichier `assert-*.sql`) avant application en prod via MCP `apply_migration` ; vues `CREATE OR REPLACE VIEW` : nouvelle colonne **en fin de liste**.
- Toute RPC SECURITY DEFINER : `REVOKE EXECUTE … FROM PUBLIC, anon` ; garde positive `IF (…) IS NOT TRUE THEN RAISE` ; `auth.uid() IS NULL` refusé en première instruction.
- `upsertQuoteLines` supprime puis réinsère : **chaque nouvelle colonne de ligne est lue depuis l'état du front** et portée par `majordhome_quote_lines_write`, `getQuoteLines`, `duplicateQuote`.
- Modules purs (`src/lib/*.js`) : aucun import React / Supabase / alias ; test `node --test` ajouté à `audit:quality` dans `package.json`.
- Textes PDF-safe (espaces ordinaires, virgule décimale, pas de glyphe hors cp1252) ; libellés d'écran en français, neutres (« Référence interne », jamais « Mayer »).
- Composants ≤ 500 lignes : `DevisStepLines.jsx` (445) et `CreateDevisModal.jsx` (217) ne dépassent pas ; la logique nouvelle va dans des modules purs.
- Rien n'est avalé : toute erreur Supabase remonte en toast, tout `{ error }` est lu.
- Commits par tâche, message en français, suffixe `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` ; `npm run lint:errors` passe (hook pre-commit).

## Review Focus

1. **Un devis repris (brouillon ou envoyé) puis ré-enregistré** doit conserver `hide_prices`, `show_specs`, `caracteristiques` et `description` : testé en Task 2 (service aller-retour) et Task 6 (état de ligne).
2. **Un article dont la catégorie n'a pas de schéma** (clim) avec des extras saisis doit imprimer ses extras et rien d'autre ; sans extras, la coche affiche « 0 caractéristique » et n'imprime rien : Task 3.
3. **Un chapitre masqué dans un devis où `affichage.prix_unitaires` est déjà faux** ne doit pas doubler ni casser le rendu (sous-total imprimé une seule fois) : Task 2.
4. **Deux articles avec le même code à la casse près** (`me-001` / `ME-001`) dans la même org : refus `23505` traduit, et deux orgs peuvent porter le même code : Task 9.
5. **Un `team_leader` sans surcharge d'org** édite un article, un `commercial` ne le peut pas, et l'edge « Enrichir » refuse le commercial avec 403 : Task 12 (assert SQL) et Task 13.

---

## Lot A — Détail des prix par chapitre (part 3) + colonnes de ligne

### Task 1 : Migration des colonnes de ligne (`hide_prices`, `show_specs`, `caracteristiques`)

**Files:**
- Create: `supabase/migrations/20261028_1_devis_lignes_affichage.sql`
- Create: `scripts/migration-rehearsal/assert-devis-lignes-affichage.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (commentaire de la ligne `quote_lines`, L36 : ajouter `20261028_1`)

**Interfaces:**
- Produces: colonnes `majordhome.quote_lines.hide_prices boolean NOT NULL DEFAULT false`, `show_specs boolean NOT NULL DEFAULT false`, `caracteristiques text[] NOT NULL DEFAULT '{}'`, exposées **en fin** de `public.majordhome_quote_lines` (après `catalog_item_id`, puis `brand`, `discount_percent` si ces deux-là sont déjà en fin — relire la dernière définition de la vue dans `20261027_8_remise_ligne_devis.sql` et la reprendre telle quelle en y ajoutant les trois colonnes) et de `public.majordhome_quote_lines_write`.

- [ ] **Step 1 : Écrire l'assertion** `assert-devis-lignes-affichage.sql` (bloc `DO $$`) : les trois colonnes existent avec leurs défauts (`information_schema.columns`), les deux vues les exposent (`information_schema.view_column_usage` ou `SELECT hide_prices, show_specs, caracteristiques FROM public.majordhome_quote_lines_write LIMIT 0`), un INSERT dans `majordhome_quote_lines_write` avec `caracteristiques = ARRAY['Puissance : 8 kW']` relit la valeur, fixture nettoyée.

- [ ] **Step 2 : Écrire la migration** : `ALTER TABLE majordhome.quote_lines ADD COLUMN IF NOT EXISTS …` × 3, puis `CREATE OR REPLACE VIEW` des deux vues (définitions actuelles + colonnes en fin), `GRANT` / `REVOKE anon` identiques aux vues actuelles, en-tête de commentaire qui cite la spec.

- [ ] **Step 3 : Répéter sur le harnais**
Run: `node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local` puis `node scripts/migration-rehearsal/run.mjs supabase/migrations/20261028_1_devis_lignes_affichage.sql --assert scripts/migration-rehearsal/assert-devis-lignes-affichage.sql` (syntaxe exacte dans `scripts/migration-rehearsal/README.md`).
Expected: migration appliquée, assertion sans `RAISE`.

- [ ] **Step 4 : Appliquer en prod** via MCP `apply_migration` (projet `ejqqqwudmizqisdkxohw`, nom `20261028_1_devis_lignes_affichage`), puis vérifier par `execute_sql` : `SELECT column_name FROM information_schema.columns WHERE table_schema='majordhome' AND table_name='quote_lines' AND column_name IN ('hide_prices','show_specs','caracteristiques')` → 3 lignes.

- [ ] **Step 5 : Commit**
```bash
git add supabase/migrations/20261028_1_devis_lignes_affichage.sql scripts/migration-rehearsal/assert-devis-lignes-affichage.sql scripts/migration-rehearsal/snapshot.mjs
git commit -m "feat(devis): colonnes de ligne hide_prices, show_specs, caracteristiques (vues en fin)"
```

### Task 2 : Chapitre à prix masqués — service, modèle, PDF, aperçu, éditeur

**Files:**
- Modify: `src/shared/services/devis.service.js` (`upsertQuoteLines` L324-348, `duplicateQuote` L540-560)
- Modify: `src/lib/devisDocumentModel.js` (`chapitres` L84-95, `buildDevisDocumentModel` L117-130)
- Modify: `src/apps/artisan/components/devis/DevisPDF.jsx` (L115-135)
- Modify: `src/apps/artisan/pages/settings/devis/ApercuDevis.jsx` (L94-106)
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx` (`SectionBlock` L46-100, `addSection` L327-329)
- Test: `scripts/devis-document-model.test.mjs`

**Interfaces:**
- Consumes: colonnes de Task 1.
- Produces: `chapitres(lines)` renvoie en plus `prix_masques: boolean` (vrai si la ligne de titre porte `hide_prices === true`) ; `buildDevisDocumentModel` → `tableau.chapitres[i].prix_masques` et, quand vrai, `lignes[j].prix_unitaire === ''`, `remise === ''`, `total === ''`, `sous_total` renseigné. L'état de ligne du front porte `hide_prices` sur les `section_title`.

- [ ] **Step 1 : Écrire les tests** dans `scripts/devis-document-model.test.mjs` :
```js
test('chapitre à prix masqués : lignes sans prix, sous-total conservé, totaux du devis inchangés', () => {
  const lines = [
    { line_type: 'section_title', designation: 'FUMISTERIE', hide_prices: true },
    { line_type: 'product', designation: 'Conduit', quantity: 2, unit: 'pièce', unit_price_ht: 100, tva_rate: 20, total_ht: 200 },
    { line_type: 'section_title', designation: 'POÊLE' },
    { line_type: 'product', designation: 'Poêle', quantity: 1, unit: 'pièce', unit_price_ht: 2500, tva_rate: 5.5, total_ht: 2500 },
  ];
  const m = buildDevisDocumentModel({ quote: {}, lines, totals: computeQuoteTotals(lines, 0), company: {} });
  assert.equal(m.tableau.chapitres[0].prix_masques, true);
  assert.deepEqual([m.tableau.chapitres[0].lignes[0].prix_unitaire, m.tableau.chapitres[0].lignes[0].total], ['', '']);
  assert.equal(m.tableau.chapitres[0].sous_total, '200,00 €');
  assert.equal(m.tableau.chapitres[1].lignes[0].total, '2 500,00 €');
  assert.equal(m.totaux.lignes.at(-1).valeur, fmtEur(computeQuoteTotals(lines, 0).total_ttc));
});
test('chapitre masqué + affichage.prix_unitaires faux : sous-total une seule fois, pas d\'exception', () => { /* config { affichage: { prix_unitaires: false } }, même jeu de lignes, assert prix_masques true et lignes présentes */ });
```
(`computeQuoteTotals` s'importe de `src/lib/devisCalculs.js` comme les tests voisins.)

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/devis-document-model.test.mjs`
Expected: FAIL (`prix_masques` undefined).

- [ ] **Step 3 : Implémenter le modèle** : `chapitres()` pose `prix_masques: l.hide_prices === true` sur le chapitre ouvert par la ligne de titre (faux pour le chapitre sans titre) ; dans `buildDevisDocumentModel`, pour un chapitre `prix_masques`, les trois chaînes de prix sont vides et `prix_masques` est recopié dans l'objet chapitre.

- [ ] **Step 4 : Lancer, vérifier le succès**
Run: `node --test scripts/devis-document-model.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Rendu** : `DevisPDF.jsx` ligne de titre : `{(!col.detail || c.prix_masques) ? <Text>{c.sous_total}</Text> : null}` ; `ApercuDevis.jsx` même condition (L96). Les cellules de prix vides s'affichent déjà vides (chaînes).

- [ ] **Step 6 : Service** : `upsertQuoteLines` ajoute `hide_prices: line.line_type === 'section_title' && line.hide_prices === true`, `show_specs: line.show_specs === true`, `caracteristiques: Array.isArray(line.caracteristiques) ? line.caracteristiques : []` ; `duplicateQuote` recopie les trois ; `getQuoteLines` (`select('*')`) les relit déjà.

- [ ] **Step 7 : Éditeur** : dans `SectionBlock`, à droite du badge de type, une case à cocher `Afficher le détail des prix` (`checked={section.hide_prices !== true}`, `onChange={(e) => onUpdate(sectionIndex, { ...section, hide_prices: !e.target.checked })}`, `title="Décochée : le document liste les lignes sans prix unitaire ni total, le sous-total du chapitre reste"`). `addSection` crée le titre avec `hide_prices: false`.

- [ ] **Step 8 : Vérifier** : `npx vite build` passe ; sur un devis d'essai, décocher un chapitre, enregistrer, rouvrir : la case reste décochée ; « Générer PDF » : lignes du chapitre sans prix, sous-total sur la ligne de titre.

- [ ] **Step 9 : Commit**
```bash
git add src/shared/services/devis.service.js src/lib/devisDocumentModel.js src/apps/artisan/components/devis/DevisPDF.jsx src/apps/artisan/pages/settings/devis/ApercuDevis.jsx src/apps/artisan/components/devis/DevisStepLines.jsx scripts/devis-document-model.test.mjs
git commit -m "feat(devis): « Afficher le détail des prix » par chapitre — lignes sans prix, sous-total conservé"
```

## Lot B — Caractéristiques et description par ligne (part 2)

### Task 3 : Module pur `devisCaracteristiques.js`

**Files:**
- Create: `src/lib/devisCaracteristiques.js`
- Test: `scripts/devis-caracteristiques.test.mjs` (à ajouter à `audit:quality` dans `package.json`, après `scripts/devis-annexes.test.mjs`)

**Interfaces:**
- Consumes: schémas `src/shared/specs/*.schema.js` (champs `{ key, label, unit?, type: 'number'|'enum'|'boolean'|'text', options?: Array<string|{value,label}> }`, export `*_CANONICAL_SPECS` — vérifier le nom exact exporté par `poele.schema.js` et la fonction d'accès dans `src/shared/specs/index.js` : le module prend le **tableau de champs** en paramètre, jamais le registre).
- Produces:
  - `lignesCaracteristiques(article, champs = []) → string[]` — `article = { category?, specs?: { canonical?: object, extras?: Array<{label, value, unit?}> } }`, `champs` = tableau de champs du schéma (vide si la catégorie n'en a pas).
  - `pdfSafe(texte) → string` (remplace `≥ ≤ ≈ − → ↔ ×` par `>= <= ~ - -> <-> x`, espaces U+202F/U+00A0 par espace, trim).
  - `figerCaracteristiques(lines, articlesParId, champsParCategorie) → lines` — renvoie une nouvelle liste où chaque ligne avec `show_specs === true` et `catalog_item_id` porte `caracteristiques = lignesCaracteristiques(article, champsParCategorie(article.category))`, les autres `caracteristiques: []`. `champsParCategorie` = fonction `(category) => champs[]`.

- [ ] **Step 1 : Écrire les tests**
```js
test('canonique dans l\'ordre du schéma, formats FR, booléen vrai seulement, enum libellée', () => {
  const champs = [
    { key: 'power_nominal_kw', label: 'Puissance nominale', unit: 'kW', type: 'number' },
    { key: 'efficiency_pct', label: 'Rendement', unit: '%', type: 'number' },
    { key: 'energy_class', label: 'Classe énergétique', type: 'enum', options: [{ value: 'A+', label: 'A+' }] },
    { key: 'eco_design_2022', label: 'Eco Design 2022', type: 'boolean' },
    { key: 'direct_air', label: 'Air direct', type: 'boolean' },
  ];
  const article = { category: 'poele', specs: { canonical: { efficiency_pct: 92.5, power_nominal_kw: 8, energy_class: 'A+', eco_design_2022: true, direct_air: false } } };
  assert.deepEqual(lignesCaracteristiques(article, champs), ['Puissance nominale : 8 kW', 'Rendement : 92,5 %', 'Classe énergétique : A+', 'Eco Design 2022 : oui']);
});
test('sans schéma : canonical ignoré, extras imprimés dans l\'ordre ; valeurs vides sautées', () => {
  const article = { category: 'climatisation', specs: { canonical: { kw: 3.5 }, extras: [{ label: 'SCOP', value: '4,6' }, { label: '', value: 'x' }, { label: 'Niveau sonore', value: 19, unit: 'dB' }] } };
  assert.deepEqual(lignesCaracteristiques(article, []), ['SCOP : 4,6', 'Niveau sonore : 19 dB']);
});
test('pdfSafe remplace les glyphes hors cp1252', () => { assert.equal(pdfSafe('T° ≥ 5\u202F°C → ok'), 'T° >= 5 °C -> ok'); });
test('figerCaracteristiques : seules les lignes cochées avec article reçoivent des caractéristiques', () => { /* 3 lignes : cochée+article → tableau non vide ; cochée sans article → [] ; non cochée → [] ; lignes non mutées (nouvel objet) */ });
test('article sans specs : tableau vide, pas d\'exception', () => { assert.deepEqual(lignesCaracteristiques({ category: 'poele' }, [{ key: 'a', label: 'A', type: 'text' }]), []); });
```

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/devis-caracteristiques.test.mjs`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : Implémenter** le module (nombres : `String(n).replace('.', ',')` ; enum : libellé de l'option dont `value` ou la chaîne correspond ; booléen faux non imprimé ; extras : `label` et `value` non vides après trim, unité collée après un espace ; chaque chaîne passée par `pdfSafe`).

- [ ] **Step 4 : Lancer, vérifier le succès ; ajouter le test à `audit:quality`**
Run: `node --test scripts/devis-caracteristiques.test.mjs` → PASS ; `npm run audit:quality` → vert.

- [ ] **Step 5 : Commit**
```bash
git add src/lib/devisCaracteristiques.js scripts/devis-caracteristiques.test.mjs package.json
git commit -m "feat(devis): module pur des caractéristiques imprimées (schéma, extras, PDF-safe, figeage)"
```

### Task 4 : Modèle de document, PDF et aperçu — caractéristiques sous la ligne

**Files:**
- Modify: `src/lib/devisDocumentModel.js` (lignes du tableau L121-127, `exempleDevis` L150-156)
- Modify: `src/apps/artisan/components/devis/DevisPDF.jsx` (L125-128, style `lineDescription` L36)
- Modify: `src/apps/artisan/pages/settings/devis/ApercuDevis.jsx` (L101)
- Test: `scripts/devis-document-model.test.mjs`

**Interfaces:**
- Produces: `tableau.chapitres[i].lignes[j].caracteristiques: string[]` (copie de `l.caracteristiques` filtrée aux chaînes non vides ; `[]` si `detail_lignes` faux).

- [ ] **Step 1 : Test**
```js
test('caractéristiques figées de la ligne reprises dans le tableau, jamais recalculées', () => {
  const lines = [{ line_type: 'product', designation: 'Poêle', quantity: 1, unit_price_ht: 1, tva_rate: 5.5, total_ht: 1, caracteristiques: ['Puissance nominale : 8 kW', ''] }];
  const m = buildDevisDocumentModel({ quote: {}, lines, totals: computeQuoteTotals(lines, 0), company: {} });
  assert.deepEqual(m.tableau.chapitres[0].lignes[0].caracteristiques, ['Puissance nominale : 8 kW']);
});
test('exempleDevis : la ligne d\'équipement porte deux caractéristiques', () => { const { lines } = exempleDevis(null); assert.equal(lines.find((l) => l.designation.startsWith('Équipement')).caracteristiques.length, 2); });
```

- [ ] **Step 2 : Échec** — Run: `node --test scripts/devis-document-model.test.mjs` → FAIL.

- [ ] **Step 3 : Implémenter** modèle + `exempleDevis` (`caracteristiques: ['Puissance nominale : 8 kW', 'Rendement : 90 %']`) ; PDF : sous la description, `{l.caracteristiques.map((c, k) => <Text key={k} style={s.lineSpec}>{c}</Text>)}` avec `lineSpec: { fontSize: 7, color: '#6b7280', marginTop: 0.5 }` ; aperçu : même liste en `text-[9px] text-secondary-500`.

- [ ] **Step 4 : Succès** — Run: `node --test scripts/devis-document-model.test.mjs` → PASS ; `npx vite build` → OK ; Settings → Devis : l'aperçu montre les deux caractéristiques sous l'équipement d'exemple.

- [ ] **Step 5 : Commit**
```bash
git add src/lib/devisDocumentModel.js src/apps/artisan/components/devis/DevisPDF.jsx src/apps/artisan/pages/settings/devis/ApercuDevis.jsx scripts/devis-document-model.test.mjs
git commit -m "feat(devis): caractéristiques imprimées sous la ligne (PDF et aperçu)"
```

### Task 5 : Lecture des articles pour l'éditeur (`useCatalogItemsSpecs`)

**Files:**
- Modify: `src/shared/services/catalogItems.service.js` (après `getItemsResume` L101)
- Modify: `src/shared/hooks/useCatalogItems.js` (après `useCatalogItemsResume` L82)
- Modify: `src/shared/hooks/cacheKeys.js` (famille `catalogItemKeys`, ajouter `specs: (orgId, idsKey) => [...catalogItemKeys.all(orgId), 'specs', idsKey]`)
- Modify: `src/shared/specs/index.js` : ajouter `export function canonicalFieldsForCategory(category)` → la liste **complète** `<CAT>_CANONICAL_SPECS` du module de la catégorie (`POELE_CANONICAL_SPECS`, `BATTERIE_…`, `PHOTOVOLTAIQUE_…`), `[]` sans schéma. On n'utilise pas `filterByFuelType(null)` (il ne garde que les champs communs à tous les combustibles, donc perdrait « Puissance min/max » d'un poêle à granulés) ; `lignesCaracteristiques` n'imprime que les valeurs renseignées, le filtrage par combustible est inutile.

**Interfaces:**
- Produces: `canonicalFieldsForCategory(category) → Array<champ>` — c'est le `champsParCategorie` consommé par Task 6 et Task 14.
- `catalogItemsService.getItemsSpecs(orgId, ids) → { data: Array<{ id, name, unit, selling_price_ht, category, specs, code, updated_at }>, error }` (vue `majordhome_catalog_items`, `.eq('org_id', orgId).in('id', ids.slice(0, 150))` ; **`code` n'existe qu'après Task 9** : le sélectionner seulement à partir de Task 10, d'ici là `select('id, name, unit, selling_price_ht, category, specs, updated_at')`).
- `useCatalogItemsSpecs(orgId, ids) → { articles: Map<id, row>, isLoading, error }`, `enabled: !!orgId && ids.length > 0`, `staleTime: 30_000`.

- [ ] **Step 1 : Implémenter** service + hook + clé (pattern de `useCatalogItemsResume`, `{ data, error }` lu).
- [ ] **Step 2 : Vérifier** — Run: `npx vite build` → OK ; `npm run lint:errors` → 0 erreur.
- [ ] **Step 3 : Commit**
```bash
git add src/shared/services/catalogItems.service.js src/shared/hooks/useCatalogItems.js src/shared/hooks/cacheKeys.js
git commit -m "feat(catalogue): lecture des specs d'articles pour l'éditeur de devis"
```

### Task 6 : Éditeur — description, coche « Caractéristiques », figeage à l'enregistrement

**Files:**
- Modify: `src/apps/artisan/components/devis/DevisLineRow.jsx`
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx` (`ListeLignes` L121-150, `SectionBlock`, props du composant principal L153)
- Modify: `src/apps/artisan/components/devis/DevisProductPicker.jsx` (`versLigne` L80-96, signature L51)
- Modify: `src/apps/artisan/components/devis/CreateDevisModal.jsx` (`handleSaveEdition` L129-140 et création L155 ; ajouter `useCatalogItemsSpecs`)
- Modify: `src/apps/artisan/components/devis/DevisModal.jsx` (modèle de devis type L193 : recopier `show_specs`, `hide_prices`, `description`)

**Interfaces:**
- Consumes: `useCatalogItemsSpecs` et `canonicalFieldsForCategory` (Task 5, `champsParCategorie = canonicalFieldsForCategory`), `figerCaracteristiques`, `lignesCaracteristiques` (Task 3).
- Produces: état de ligne `{ …, show_specs: boolean, caracteristiques: string[] }` ; `DevisProductPicker` reçoit `typeChapitre` (déjà) et pose `show_specs: typeChapitre === 'equipement'`, `caracteristiques: []` ; `DevisLineRow` reçoit `nbCaracteristiques?: number` et `onEditerArticle?: () => void` (Task 14 branchera ce dernier).

- [ ] **Step 1 : `DevisLineRow`** : (a) sous la désignation, si `line.description` non vide ou `descriptionOuverte` : `<textarea rows={2} value={line.description || ''} onChange={(e) => setLineField('description', e.target.value)} placeholder="Description imprimée sous la ligne…" className="w-full mt-1 text-xs border border-secondary-200 rounded px-2 py-1" />` ; sinon un bouton icône `AlignLeft` « + description » dans les actions (largeur des actions passe de `w-[40px]` à `w-[64px]`, idem `EnTeteLignes`). (b) si `line.catalog_item_id` : `<label title="Imprimer les caractéristiques de l'article sous la ligne"><input type="checkbox" checked={line.show_specs === true} onChange={(e) => setLineField('show_specs', e.target.checked)} /> {nbCaracteristiques} caract.</label>` en texte `text-[10px]`, grisé avec titre « aucune caractéristique renseignée sur l'article » si `nbCaracteristiques === 0`.
- [ ] **Step 2 : `DevisStepLines`** : nouvelle prop `articles` (Map, depuis `CreateDevisModal`) ; `ListeLignes` passe `nbCaracteristiques={line.catalog_item_id ? lignesCaracteristiques(articles.get(line.catalog_item_id) || {}, champsParCategorie(articles.get(line.catalog_item_id)?.category)).length : 0}` (mémoïser dans un `useMemo` `nbParItem` au niveau du composant principal, pas par ligne).
- [ ] **Step 3 : Picker** : `versLigne` ajoute `show_specs: typeChapitre === 'equipement', caracteristiques: []`. `ligneVide` de `DevisStepLines` ajoute `show_specs: false, caracteristiques: []`.
- [ ] **Step 4 : Figeage** : dans `CreateDevisModal`, `const ids = useMemo(() => lines.map((l) => l.catalog_item_id).filter(Boolean), [lines])`, `const { articles } = useCatalogItemsSpecs(orgId, ids)` ; avant `createQuote(...)` et avant `upsertLines(...)` : `const figees = figerCaracteristiques(lines, articles, champsParCategorie)` et passer `figees`. Passer `articles` à `DevisStepLines`.
- [ ] **Step 5 : Vérifier** : `npx vite build` ; devis d'essai : ligne poêle ajoutée dans ÉQUIPEMENT → coche active, compteur > 0 ; description saisie ; enregistrer, rouvrir : description et coche conservées ; « Générer PDF » : caractéristiques et description sous la ligne. Ligne dans FUMISTERIE → coche inactive par défaut.
- [ ] **Step 6 : Commit**
```bash
git add src/apps/artisan/components/devis/DevisLineRow.jsx src/apps/artisan/components/devis/DevisStepLines.jsx src/apps/artisan/components/devis/DevisProductPicker.jsx src/apps/artisan/components/devis/CreateDevisModal.jsx src/apps/artisan/components/devis/DevisModal.jsx
git commit -m "feat(devis): description par ligne et coche « Caractéristiques » figées à l'enregistrement"
```

### Task 7 : Extras saisissables pour toute catégorie (fiche article)

**Files:**
- Modify: `src/apps/artisan/pages/settings/product-detail/ProductSpecsForm.jsx` (L23-35 et le rendu)
- Modify: `src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx` (L200-206 : condition `supportsEnrichment`)

**Interfaces:**
- Produces: `ProductSpecsForm` sans schéma rend uniquement le bloc « Autres caractéristiques » (extras) ; `ArticleDrawer` monte le formulaire pour toute catégorie (le bouton « Enrichir » reste conditionné à `supportsEnrichment`).

- [ ] **Step 1 : Implémenter** : dans `ProductSpecsForm`, quand `schema` est null, `groupedFields = []` est déjà le cas ; retirer tout `return null` précoce lié à `schema` et garder le bloc extras ; dans `ArticleDrawer`, monter `ProductSpecsForm` sans condition de schéma (`fuelType` inchangé).
- [ ] **Step 2 : Vérifier** : `npx vite build` ; fiche d'un article `climatisation` : bloc extras visible, ajout « SCOP : 4,6 », enregistrer, rouvrir : conservé ; fiche poêle inchangée.
- [ ] **Step 3 : Commit**
```bash
git add src/apps/artisan/pages/settings/product-detail/ProductSpecsForm.jsx src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx
git commit -m "feat(catalogue): caractéristiques libres saisissables pour toute catégorie d'article"
```

### Task 8 : Push Pennylane — description + caractéristiques, avertissement prix masqués

**Files:**
- Modify: `src/lib/pennylaneQuotePayload.js` (L50-58)
- Modify: `src/apps/artisan/components/devis/DevisModal.jsx` (handler du push Pennylane, autour de L100-112)
- Test: `scripts/pennylane-quote-payload.test.mjs`

**Interfaces:**
- Produces: `buildPennylaneQuotePayload` : `l.description = [line.description, ...(line.caracteristiques || [])].filter(Boolean).join('\n')` (absent si vide).

- [ ] **Step 1 : Test** : ligne avec `description: 'Pose incluse'` et `caracteristiques: ['Puissance : 8 kW']` → `description === 'Pose incluse\nPuissance : 8 kW'` ; ligne sans les deux → pas de clé `description`.
- [ ] **Step 2 : Échec** — Run: `node --test scripts/pennylane-quote-payload.test.mjs` → FAIL.
- [ ] **Step 3 : Implémenter** ; dans `DevisModal`, avant le push : `if (lines.some((l) => l.line_type === 'section_title' && l.hide_prices)) toast.info('Pennylane affichera les prix de tous les chapitres')`.
- [ ] **Step 4 : Succès** — Run: `node --test scripts/pennylane-quote-payload.test.mjs` → PASS. **Vérification réelle** (Eric ou builder avec accès) : pousser un brouillon avec une ligne à dix caractéristiques ; si Pennylane répond 422 sur `description`, tronquer à la description seule dans `buildPennylaneQuotePayload` (`MAX_DESCRIPTION_PL` à mesurer) et le noter dans l'en-tête du module.
- [ ] **Step 5 : Commit**
```bash
git add src/lib/pennylaneQuotePayload.js src/apps/artisan/components/devis/DevisModal.jsx scripts/pennylane-quote-payload.test.mjs
git commit -m "feat(devis): caractéristiques dans la description Pennylane, avertissement sur un chapitre à prix masqués"
```

## Lot C — Référence interne de l'article (part 1)

### Task 9 : Migration `catalog_items.code`

**Files:**
- Create: `supabase/migrations/20261028_2_catalog_items_code.sql`
- Create: `scripts/migration-rehearsal/assert-catalog-items-code.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` : ajouter aux `VIEWS` `public.majordhome_catalog_items`, `public.majordhome_catalog_items_list`, `public.majordhome_catalog_item_offers` et aux `FUNCTIONS` `majordhome.catalog_item_merge_impl(<signature exacte relue dans 20261026_2>)` s'ils n'y sont pas.

**Interfaces:**
- Produces: `majordhome.catalog_items.code text` + `CHECK (code IS NULL OR btrim(code) <> '')` ; index `catalog_items_code_org_unique ON majordhome.catalog_items (org_id, lower(code)) WHERE code IS NOT NULL AND merged_into IS NULL` ; `code` **en fin** de `majordhome_catalog_items` (miroir updatable) et de `majordhome_catalog_items_list` (+ `i.code` dans le `concat_ws` de `recherche`) ; `catalog_item_merge_impl` : `UPDATE … SET code = NULL WHERE id = absorbé` puis `UPDATE survivant SET code = COALESCE(survivant.code, code_absorbé)`.

- [ ] **Step 1 : Assertion** : colonne et index existent ; insérer deux articles `ME-001` / `me-001` même org → le second lève `unique_violation` ; même code dans une autre org (créer une org fixture ou utiliser une 2ᵉ org existante en lecture : `SELECT id FROM core.organizations WHERE id <> v_mayer LIMIT 1`) → accepté ; fusion : survivant sans code hérite ; `SELECT recherche FROM majordhome_catalog_items_list WHERE id = …` contient `me-001` ; fixture nettoyée.
- [ ] **Step 2 : Migration** (définitions complètes des vues reprises de `20261027_1` L69-95 + `code` en fin ; `merge_impl` recréée entière avec les deux UPDATE avant le re-parentage).
- [ ] **Step 3 : Répéter** — Run: snapshot puis `run.mjs … --assert assert-catalog-items-code.sql` → OK.
- [ ] **Step 4 : Appliquer en prod** (MCP `apply_migration` `20261028_2_catalog_items_code`) ; vérifier `SELECT indexname FROM pg_indexes WHERE indexname = 'catalog_items_code_org_unique'` → 1 ligne.
- [ ] **Step 5 : Commit**
```bash
git add supabase/migrations/20261028_2_catalog_items_code.sql scripts/migration-rehearsal/assert-catalog-items-code.sql scripts/migration-rehearsal/snapshot.mjs
git commit -m "feat(catalogue): référence interne de l'article (code unique par org, recherche, fusion)"
```

### Task 10 : Référence interne — fiche, liste, picker, ligne de devis

**Files:**
- Modify: `src/shared/services/catalogItems.service.js` (`createItem` L134, `updateItem` L158, `getItemsSpecs` de Task 5 : ajouter `code`)
- Modify: `src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx` (`formDepuis` L23, champs L138)
- Modify: `src/apps/artisan/pages/settings/catalogue/ArticlesPage.jsx` (rendu de la liste)
- Modify: `src/apps/artisan/components/devis/DevisProductPicker.jsx` (L188, `versLigne` L92)
- Modify: `src/apps/artisan/components/devis/DevisCreateArticleForm.jsx` (si le formulaire crée depuis le devis : champ « Référence interne » optionnel)

**Interfaces:**
- Produces: `updateItem(orgId, itemId, { code })` écrit `row.code = String(code || '').trim() || null` ; erreur `23505` sur `catalog_items_code_org_unique` → `new Error('Cette référence interne est déjà portée par un autre article')` ; `createItem` accepte `code`. Picker : `versLigne` pose `reference: it.code || ''`.

- [ ] **Step 1 : Service** (création, mise à jour, traduction du conflit, `getItemsSpecs` sélectionne `code`).
- [ ] **Step 2 : Fiche** : `FormField label="Référence interne"` en tête (avant « Libellé »), `TextInput` avec `placeholder="ex. ME-POE-0042"`, `disabled={!canEdit}` ; `formDepuis` lit `item.code`.
- [ ] **Step 3 : Liste et picker** : dans `ArticlesPage` et `DevisProductPicker` (L188), préfixe `<span className="font-mono text-[11px] text-secondary-500 mr-1">{it.code}</span>` quand `it.code` ; `versLigne` → `reference: it.code || ''`.
- [ ] **Step 4 : Vérifier** : `npx vite build` ; fiche : poser `ME-001`, enregistrer ; second article avec `me-001` → toast de conflit ; picker : recherche « me-001 » trouve l'article ; ligne posée → « Générer PDF » imprime `ME-001` dans la colonne Réf. (réglage `affichage.references` vrai).
- [ ] **Step 5 : Commit**
```bash
git add src/shared/services/catalogItems.service.js src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx src/apps/artisan/pages/settings/catalogue/ArticlesPage.jsx src/apps/artisan/components/devis/DevisProductPicker.jsx src/apps/artisan/components/devis/DevisCreateArticleForm.jsx
git commit -m "feat(catalogue): référence interne saisie sur la fiche, cherchable, imprimée sur la ligne de devis"
```

## Lot D — Éditer l'article depuis la ligne, droits `team_leader` (part 4)

### Task 11 : Ressource `articles` dans le registre des droits

**Files:**
- Modify: `src/lib/permissionsRegistry.js` (après l'entrée `devis` L65-72)
- Modify: `scripts/permissions-coherence.mjs` (`GOVERNED` L28 : ajouter `'catalog_items'`)
- Create: `supabase/migrations/20261028_3_articles_droits.sql` — **partie 1** : sortie de `node scripts/gen-app-role-permissions-sql.mjs` (INSERT des défauts, pattern de la dernière migration `app_role_permissions`, relire comment elle gère les lignes existantes : `ON CONFLICT … DO UPDATE` ou purge)

**Interfaces:**
- Produces: `REGISTRY.articles = { label: 'Articles (base du devis)', tables: { catalog_items: 'org' }, actions: { view: { sql: 'SELECT', default: d([1, 1, 1]) }, create: { sql: 'INSERT', default: d([1, 0, 0]) }, edit: { sql: 'UPDATE', default: d([1, 0, 0]) } } }` ; `useCanAccess().can('articles', 'edit')` renvoie vrai pour `team_leader` sans surcharge.

- [ ] **Step 1 : Test** : dans `scripts/permissions-resolve.test.mjs`, `resolvePermission(new Map(), 'team_leader', 'articles', 'edit') === true`, `('commercial', …) === false`, `('technicien', 'articles', 'view') === true`.
- [ ] **Step 2 : Échec** — Run: `node --test scripts/permissions-resolve.test.mjs` → FAIL.
- [ ] **Step 3 : Implémenter** registre + `GOVERNED` ; générer la partie 1 de la migration.
- [ ] **Step 4 : Succès** — Run: `node --test scripts/permissions-resolve.test.mjs` → PASS ; `node scripts/verify-permissions-registry.mjs` → OK (il compare registre et migration générée : lire son message s'il échoue).
- [ ] **Step 5 : Commit** (la migration n'est pas encore appliquée : elle se complète en Task 12)
```bash
git add src/lib/permissionsRegistry.js scripts/permissions-coherence.mjs scripts/permissions-resolve.test.mjs supabase/migrations/20261028_3_articles_droits.sql
git commit -m "feat(droits): ressource articles (view, create, edit) dans le registre, défauts générés"
```

### Task 12 : Migration des droits d'article — policies, RPC, `user_can`

**Files:**
- Modify: `supabase/migrations/20261028_3_articles_droits.sql` — **partie 2**
- Create: `scripts/migration-rehearsal/assert-articles-droits.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` : `POLICY_TABLES` + `'catalog_items'` ; `FUNCTIONS` + `catalog_item_create_for_product`, `catalog_item_attach`, `catalog_item_detach`, `catalog_item_require_admin` (signatures exactes relues dans `20261026_1..3`)

**Interfaces:**
- Produces:
  - `majordhome.catalog_item_require_edit(p_org_id uuid, p_action text DEFAULT 'edit') RETURNS void` SECURITY DEFINER : `auth.uid() IS NULL` → `not_authenticated` ; `IF majordhome.role_can(p_org_id, 'articles', p_action) IS NOT TRUE THEN RAISE EXCEPTION 'articles_edit_required' USING ERRCODE = '42501'` ; `REVOKE … FROM PUBLIC, anon, authenticated`.
  - `catalog_item_create_for_product` appelle `require_edit(org, 'create')` ; `catalog_item_attach` / `_detach` appellent `require_edit(org, 'edit')` (recréer les trois fonctions entières, corps inchangé par ailleurs).
  - Policies `catalog_items` : `catalog_items_update` `USING/WITH CHECK (majordhome.role_can(org_id, 'articles', 'edit'))`, `catalog_items_insert` `WITH CHECK (majordhome.role_can(org_id, 'articles', 'create'))` ; anciennes `catalog_items_update_admin` / `catalog_items_insert_admin` droppées **dans la même migration, après** création des nouvelles.
  - Policies `product_documents` (insert/update/delete) : la clause `catalog_item_id IS NULL OR EXISTS (… role = 'org_admin')` devient `catalog_item_id IS NULL OR majordhome.role_can(product_documents.org_id, 'articles', 'edit')`.
  - `public.user_can(p_org_id uuid, p_resource text, p_action text) RETURNS boolean` SECURITY INVOKER, `SET search_path = majordhome, public`, `RETURN COALESCE(majordhome.role_can(p_org_id, p_resource, p_action), false)` ; `REVOKE EXECUTE FROM PUBLIC, anon` ; `GRANT EXECUTE TO authenticated, service_role`.

- [ ] **Step 1 : Assertion** (impersonation `SET LOCAL ROLE authenticated` + `request.jwt.claim.sub`, modèle `assert-documents-article-admin.sql`) : un membre `team_leader` Mayer met à jour un article et ajoute un document d'article ; un membre `commercial` (ou `member`) est refusé (`insufficient_privilege`) ; `catalog_item_create_for_product` accepté pour le team_leader, refusé pour le commercial ; `user_can(v_mayer, 'articles', 'edit')` vrai / faux selon le rôle ; `has_function_privilege('anon', 'public.user_can(uuid,text,text)', 'EXECUTE')` faux ; les policies `*_admin` n'existent plus (`pg_policies`).
- [ ] **Step 2 : Migration** partie 2.
- [ ] **Step 3 : Répéter** — Run: snapshot + `run.mjs 20261028_3 --assert assert-articles-droits.sql` → OK.
- [ ] **Step 4 : Appliquer en prod** (MCP `apply_migration` `20261028_3_articles_droits`) ; **mesure** : `node scripts/permissions-coherence.mjs --env .env.local` → 0 erreur, `catalog_items` gouvernée, aucune policy legacy.
- [ ] **Step 5 : Commit**
```bash
git add supabase/migrations/20261028_3_articles_droits.sql scripts/migration-rehearsal/assert-articles-droits.sql scripts/migration-rehearsal/snapshot.mjs
git commit -m "feat(droits): écriture des articles sous role_can(articles) — policies, RPC, user_can pour les edges"
```

### Task 13 : Gates écran et edges sur `articles.edit`

**Files:**
- Modify: `src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx` (L40, L59, L133), `ArticlesPage.jsx` (L27, L68, L74), `ArticleDocuments.jsx`, `ArticleAttachModal.jsx`, `ArticleEnrichModal.jsx` (chaque `isOrgAdmin` lié à un geste d'article)
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx` (L211, L237, L351, L375), `DevisProductPicker.jsx` (L52, L218), `DevisCreateArticleForm.jsx`, `ImportOffreDevisModal.jsx` (L69, L81, L205)
- Modify: `src/apps/artisan/pages/settings/suppliers/ImportOffreCatalogueModal.jsx` (si un gate admin s'y trouve)
- Modify: `supabase/functions/catalog-item-enrich/index.ts` (L174) ; `supabase/functions/supplier-offer-import/index.ts` (L57)

**Interfaces:**
- Consumes: `useCanAccess` de `@hooks/usePermissions` (`const { can } = useCanAccess()`), RPC `user_can` (Task 12).
- Produces: `peutEditerArticles = can('articles', 'edit')`, `peutCreerArticles = can('articles', 'create')` ; edges : `requireOrgMembership(req, { orgId })` puis `const { data: autorise } = await user.rpc('user_can', { p_org_id: orgId, p_resource: 'articles', p_action: 'edit' }); if (autorise !== true) return jsonResponse({ error: 'Forbidden: articles.edit' }, 403, req);` (client `user` au jeton de l'utilisateur, déjà présent dans `catalog-item-enrich` ; à créer de la même façon dans `supplier-offer-import` pour l'action `apply`).

- [ ] **Step 1 : Front** : remplacer chaque `isOrgAdmin` listé par `can('articles', 'edit')` (ou `'create'` pour la création) ; texte L133 d'`ArticleDrawer` → « Lecture seule : la correction d'un article est réservée aux responsables. » ; L205 d'`ImportOffreDevisModal` → « ajoutés en lignes libres : la création d'articles est réservée aux responsables ». Vérifier avec `grep -n isOrgAdmin` sur les fichiers listés qu'il ne reste que des gestes d'harmonisation.
- [ ] **Step 2 : Edges** : modifier les deux gardes ; `deno check` sur chaque `index.ts` ; déployer via MCP `deploy_edge_function` (`verify_jwt` inchangé, fichiers `_shared/auth.ts` inclus sous le nom `../_shared/auth.ts`).
- [ ] **Step 3 : Vérifier** : `npx vite build` ; connecté en `team_leader` (compte de test Mayer) : fiche article éditable, « Enrichir » répond 200 sur `propose` ; connecté en commercial : fiche en lecture seule, l'appel direct de l'edge répond 403.
- [ ] **Step 4 : Commit**
```bash
git add src/apps/artisan/pages/settings/catalogue src/apps/artisan/components/devis src/apps/artisan/pages/settings/suppliers supabase/functions/catalog-item-enrich supabase/functions/supplier-offer-import
git commit -m "feat(droits): gestes d'article et import d'offre ouverts à articles.edit (écran et edges)"
```

### Task 14 : « Éditer l'article » depuis la ligne, réalignement

**Files:**
- Create: `src/lib/devisLigneArticle.js`
- Test: `scripts/devis-ligne-article.test.mjs` (ajouter à `audit:quality`)
- Modify: `src/apps/artisan/components/devis/DevisLineRow.jsx` (bouton crayon `Pencil`, prop `onEditerArticle`)
- Modify: `src/apps/artisan/components/devis/DevisStepLines.jsx` (état `articleOuvert`, montage d'`ArticleDrawer`, réalignement à la fermeture)
- Modify: `src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx` (z-index `z-[60]` ou supérieur à `CreateDevisModal` ; `onClose` inchangé)

**Interfaces:**
- Consumes: `useCatalogItemsSpecs` (Task 5, les `articles` passés par `CreateDevisModal`), `lignesCaracteristiques` (Task 3).
- Produces: `realignerLigne(ligne, articleAvant, articleApres, champs) → ligne` (pur) : si `articleApres.updated_at <= articleAvant.updated_at` → même objet ; sinon nouvel objet avec `designation = articleApres.name`, `unit = articleApres.unit`, `reference = articleApres.code || ''`, `caracteristiques = ligne.show_specs ? lignesCaracteristiques(articleApres, champs) : []`, `unit_price_ht = Number(ligne.unit_price_ht) === Number(articleAvant.selling_price_ht) ? Number(articleApres.selling_price_ht) : ligne.unit_price_ht` ; quantité, remise, TVA, description, `show_specs` inchangées.

- [ ] **Step 1 : Tests**
```js
test('article inchangé : la ligne est renvoyée telle quelle (même référence)', () => { … assert.equal(realignerLigne(l, a, a, []), l); });
test('article modifié : libellé, unité, référence et caractéristiques suivent ; prix suivi seulement s\'il n\'avait pas été ajusté', () => {
  const avant = { name: 'Poêle A', unit: 'pièce', selling_price_ht: 2500, code: null, updated_at: '2026-10-26T10:00:00Z', specs: {} };
  const apres = { ...avant, name: 'Poêle A+', code: 'ME-001', selling_price_ht: 2600, updated_at: '2026-10-26T11:00:00Z' };
  const suivie = realignerLigne({ designation: 'Poêle A', unit_price_ht: 2500, quantity: 2, show_specs: false }, avant, apres, []);
  assert.deepEqual([suivie.designation, suivie.reference, suivie.unit_price_ht, suivie.quantity], ['Poêle A+', 'ME-001', 2600, 2]);
  const ajustee = realignerLigne({ designation: 'Poêle A', unit_price_ht: 2400, show_specs: false }, avant, apres, []);
  assert.equal(ajustee.unit_price_ht, 2400);
});
```
- [ ] **Step 2 : Échec** — Run: `node --test scripts/devis-ligne-article.test.mjs` → FAIL.
- [ ] **Step 3 : Implémenter** le module.
- [ ] **Step 4 : Succès** — Run: `node --test scripts/devis-ligne-article.test.mjs` → PASS ; ajouter à `audit:quality`.
- [ ] **Step 5 : Écran** : `DevisLineRow` : bouton `Pencil` « Éditer l'article » si `line.catalog_item_id && onEditerArticle` (largeur des actions ajustée) ; `DevisStepLines` : `const [articleOuvert, setArticleOuvert] = useState(null)` (`{ itemId, avant: articles.get(itemId) }`), monte `<ArticleDrawer orgId={orgId} itemId={articleOuvert.itemId} onClose={fermerArticle} />` ; `fermerArticle` : `await queryClient.invalidateQueries({ queryKey: catalogItemKeys.all(orgId) })`, relit l'article (`catalogItemsService.getItemsSpecs(orgId, [itemId])`), puis `setLines((prev) => prev.map((l) => (l.catalog_item_id === itemId ? realignerLigne(l, avant, apres, champsParCategorie(apres.category)) : l)))` ; si au moins une ligne a changé de référence d'objet → `toast.success('Ligne mise à jour depuis l\'article')` ; erreur de relecture → `toast.error`, lignes inchangées. Échap dans le drawer ne ferme que le drawer (vérifier le `onKeyDown` de `CreateDevisModal`).
- [ ] **Step 6 : Vérifier** : `npx vite build` ; devis d'essai : crayon → drawer au-dessus de la modale, modifier le libellé et le prix de vente, fermer → ligne mise à jour, toast ; ligne dont le prix avait été ajusté à la main : libellé suit, prix conservé ; `DevisStepLines.jsx` ≤ 500 lignes (`wc -l`), sinon extraire `SectionBlock` + `ListeLignes` dans `DevisSectionBlock.jsx`.
- [ ] **Step 7 : Commit**
```bash
git add src/lib/devisLigneArticle.js scripts/devis-ligne-article.test.mjs package.json src/apps/artisan/components/devis/DevisLineRow.jsx src/apps/artisan/components/devis/DevisStepLines.jsx src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx
git commit -m "feat(devis): « Éditer l'article » depuis la ligne, réalignement de la ligne à la fermeture"
```

### Task 15 : Vérification finale, livraison, documentation

**Files:**
- Modify: `.claude/proposed-updates.md` (entrée PENDING résumant ce lot pour CLAUDE.md : colonnes de ligne figées, `code` d'article, ressource `articles`, `user_can`, `require_edit`)
- Modify: `docs/superpowers/specs/2026-10-26-devis-…-design.md` (statut « livré », écarts constatés)

- [ ] **Step 1 : Mesures** — Run: `npm run audit:quality` → vert ; `node scripts/permissions-coherence.mjs --env .env.local` → 0 erreur ; `npx vite build` → OK ; `git status` propre.
- [ ] **Step 2 : Critère de fin de la spec** (§ 9) sur un devis poêle + fumisterie d'essai : PDF avec référence interne, caractéristiques, description, chapitre Fumisterie sans prix de ligne ; team_leader corrige un article depuis la ligne. Noter tout écart dans la spec.
- [ ] **Step 3 : Push et déploiement** — Run: `git pull --rebase --autostash && git push origin main` ; suivre le déploiement Vercel jusqu'à READY (MCP Vercel `list_deployments` / `get_deployment`) ; hard-reload ×2 avant de conclure sur un symptôme (gotcha PWA).
- [ ] **Step 4 : Documentation** : ajouter l'entrée PENDING dans `.claude/proposed-updates.md` (ne pas éditer `CLAUDE.md` sans accord d'Eric) ; commit `docs(devis): spec livrée, proposition CLAUDE.md`.
