# Fiche poêle : caractéristiques CEE (BAR-TH-112) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La fiche poêle porte Etas, émissions (particules, COG, CO, NOx), norme de mesure, Flamme Verte, combustible et position de sortie des fumées ; ces valeurs s'impriment en tête des caractéristiques d'une ligne de devis ; la fiche article affiche un repère CEE non bloquant.

**Architecture:** Les champs s'ajoutent au schéma canonique `poele` (tableau `POELE_CANONICAL_SPECS`, ordre du tableau = ordre d'impression par `lignesCaracteristiques`). Une règle pure `src/lib/cee/barTh112.js` juge un `specs.canonical`. Un petit composant l'affiche dans `ArticleDrawer`.

**Tech Stack:** JavaScript ESM, `node --test`, React 18, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-28-poele-caracteristiques-cee-design.md`

## Global Constraints

- Seuils (fiche BAR-TH-112 A46.3, valeurs en mg/Nm³ à 13 % d'O2) — bûches : Etas ≥ 66, PM ≤ 40, COG ≤ 120, CO ≤ 1500, NOx ≤ 200 ; granulés : Etas ≥ 80, PM ≤ 20, COG ≤ 60, CO ≤ 300, NOx ≤ 200.
- Flamme Verte vraie ⇒ les quatre émissions ne sont pas exigées (Etas et norme le restent).
- Jamais bloquant : aucun enregistrement de devis ou d'article ne dépend du verdict.
- Pas de conversion des anciens champs `co_emission_pct` et `dust_emission_mg_m3` ; la règle ne les lit pas.
- Textes imprimés passés par `pdfSafe` : écrire « O2 », jamais « O₂ ».
- Interface en français, aucun texte sous 12 px dans le tiroir (`text-xs` minimum), statut avec `StatusPill` + `toneFor` (jamais la couleur cuivre).

## Review Focus

- Combustible « hybride » ou absent : verdict `inconnu`, jamais « conforme » ni « hors seuil ».
- Valeur saisie avec virgule ou unité (« 67 % », « 1,2 ») : déjà convertie en nombre par `parseSpecValue` ; une chaîne non numérique est traitée comme manquante.
- Norme EN 16510-1 : acceptée, avec la remarque « à faire accepter par l'obligé ».
- Valeur exactement au seuil (Etas = 66, PM = 40) : conforme.
- Article d'une autre catégorie que `poele` : aucun repère affiché.

---

### Task 1: Champs CEE dans le schéma poêle

**Files:**
- Modify: `src/shared/specs/poele.schema.js`
- Modify: `src/apps/artisan/pages/settings/product-detail/ProductSpecsForm.jsx` (`SpecField`, branche `enum` : accepter des options `{ value, label }` en plus des chaînes — aujourd'hui `options.map((o) => ({ value: o, label: o }))`)
- Test: `scripts/specs-canonical-fields.test.mjs`, `scripts/devis-caracteristiques.test.mjs`

**Interfaces:**
- Produces: clés canoniques `fuel_type` (enum `bois|granules|hybride`, options = `POELE_FUEL_TYPES`), `etas_pct` (number, `%`), `pm_mg_nm3` (number, `mg/Nm³`), `cog_mgc_nm3` (number, `mgC/Nm³`), `co_mg_nm3` (number, `mg/Nm³`), `nox_mg_nm3` (number, `mg/Nm³`), `norme_mesure` (enum), `flamme_verte` (boolean), `flue_outlet_position` (enum) ; groupe `cee` libellé « Performances CEE » en tête de `POELE_GROUPS` ; constante exportée `NORMES_MESURE = ['EN 13240','EN 14785','EN 15250','EN 13229','EN 12815','EN 16510-1','Autre']` et `SORTIES_FUMEES = ['Dessus','Arrière','Dessus ou arrière','Latérale']`.

- [ ] **Step 1: Write the failing tests**

Dans `scripts/specs-canonical-fields.test.mjs` :

```js
test('poêle : les champs CEE viennent en tête, dans cet ordre', () => {
  const cles = canonicalFieldsForCategory('poele').map((f) => f.key);
  assert.deepEqual(cles.slice(0, 8), ['fuel_type', 'etas_pct', 'pm_mg_nm3', 'cog_mgc_nm3', 'co_mg_nm3', 'nox_mg_nm3', 'norme_mesure', 'flamme_verte']);
});
test('poêle : position de la sortie des fumées juste après son diamètre', () => {
  const cles = canonicalFieldsForCategory('poele').map((f) => f.key);
  assert.equal(cles.indexOf('flue_outlet_position'), cles.indexOf('flue_outlet_diameter_mm') + 1);
});
test('poêle : champs CEE visibles pour tous les combustibles', () => {
  const champs = canonicalFieldsForCategory('poele').filter((f) => f.group === 'cee');
  assert.ok(champs.every((f) => ['bois', 'granules', 'hybride'].every((c) => f.applies_to.includes(c))));
});
```

Dans `scripts/devis-caracteristiques.test.mjs`, avec les champs réels du schéma (importés comme dans `specs-canonical-fields.test.mjs`, ou un tableau recopié des neuf champs) :

```js
test('poêle CEE : Etas et émissions imprimés en tête, unités en toutes lettres', () => {
  const lignes = lignesCaracteristiques({ category: 'poele', specs: { canonical: {
    power_nominal_kw: 8, fuel_type: 'bois', etas_pct: 67, pm_mg_nm3: 30, cog_mgc_nm3: 100,
    co_mg_nm3: 1250, nox_mg_nm3: 160, norme_mesure: 'EN 16510-1', flamme_verte: true,
    flue_outlet_diameter_mm: 150, flue_outlet_position: 'Dessus' } } }, champsPoele);
  assert.equal(lignes[0], 'Combustible : Bois');
  assert.equal(lignes[1], 'Efficacité énergétique saisonnière (Etas) : 67 %');
  assert.ok(lignes.includes('Particules (13 % O2) : 30 mg/Nm³'));
  assert.ok(lignes.includes('Flamme Verte : oui'));
  assert.ok(lignes.includes('Sortie des fumées : Dessus'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/specs-canonical-fields.test.mjs scripts/devis-caracteristiques.test.mjs`
Expected: FAIL (clés absentes).

- [ ] **Step 3: Add the fields at the top of `POELE_CANONICAL_SPECS`, group `cee` first in `POELE_GROUPS`**

Libellés exacts (ceux du test) : « Combustible », « Efficacité énergétique saisonnière (Etas) », « Particules (13 % O2) », « COG (13 % O2) », « CO (13 % O2) », « NOx (13 % O2) », « Norme de mesure », « Flamme Verte », « Sortie des fumées ». `fuel_type` : enum dont les options sont les objets `{ value, label }` de `POELE_FUEL_TYPES` (`libelleEnum` imprime le `label`). Aliases (servent à l'enrichissement web et à l'aspirateur) : Etas ← `etas`, `ηs`, `ns`, `rendement saisonnier`, `efficacite energetique saisonniere`, `seasonal efficiency` ; PM ← `particules`, `poussieres`, `pm`, `particulate matter` (sans retirer les alias de `dust_emission_mg_m3` : `matchLabelToCanonicalKey` prend le premier champ du tableau, donc les nouveaux gagnent, c'est voulu) ; COG ← `cog`, `ogc`, `composes organiques gazeux`, `cov` ; CO ← `co a 13`, `monoxyde de carbone mg` ; NOx ← `nox`, `oxydes d azote` ; norme ← `norme`, `norme de mesure`, `en 16510`, `en 13240` ; Flamme Verte ← `flamme verte`, `label flamme verte` ; position ← `depart des fumees`, `sortie des fumees position`, `flue outlet position`. `required` : seulement `fuel_type` et `etas_pct`. Mettre à jour l'en-tête du fichier (« Performances CEE, fiche BAR-TH-112, 2026-11-28 »).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/specs-canonical-fields.test.mjs scripts/devis-caracteristiques.test.mjs scripts/catalogue/enrichissement.test.mjs scripts/catalogue/mapping.test.mjs`
Expected: PASS (les tests d'enrichissement et de correspondance existants restent verts ; si l'un d'eux attend `dust_emission_mg_m3` pour « poussières », l'aligner sur `pm_mg_nm3` et le dire dans le message de commit).

- [ ] **Step 5: Commit**

```bash
git add src/shared/specs/poele.schema.js src/apps/artisan/pages/settings/product-detail/ProductSpecsForm.jsx scripts/specs-canonical-fields.test.mjs scripts/devis-caracteristiques.test.mjs
git commit -m "feat(catalogue): champs CEE BAR-TH-112 et sortie des fumées sur la fiche poêle"
```

### Task 2: Règle pure du verdict BAR-TH-112

**Files:**
- Create: `src/lib/cee/barTh112.js`
- Test: `scripts/cee-bar-th-112.test.mjs` (ajouté à `audit:quality` dans `package.json`)

**Interfaces:**
- Consumes: clés de la Task 1.
- Produces: `verdictBarTh112(canonical: object|null) -> { statut: 'conforme'|'hors_seuil'|'incomplet'|'inconnu', manquants: string[], depassements: Array<{ cle: string, valeur: number, seuil: number }>, remarques: string[] }` ; `SEUILS_BAR_TH_112` exporté (`{ bois: {...}, granules: {...} }`, clés `etas_min, pm_max, cog_max, co_max, nox_max`). `manquants` contient les CLÉS canoniques.

- [ ] **Step 1: Write the failing tests** (module pur, aucun import d'alias)

```js
const toron = { fuel_type: 'bois', etas_pct: 67, pm_mg_nm3: 30, cog_mgc_nm3: 100, co_mg_nm3: 1250, nox_mg_nm3: 160, norme_mesure: 'EN 13240' };
test('bûches complet sous les seuils : conforme', () => assert.equal(verdictBarTh112(toron).statut, 'conforme'));
test('valeur au seuil exact : conforme', () => assert.equal(verdictBarTh112({ ...toron, etas_pct: 66, pm_mg_nm3: 40 }).statut, 'conforme'));
test('particules au-dessus : hors seuil, détail', () => {
  const v = verdictBarTh112({ ...toron, pm_mg_nm3: 45 });
  assert.equal(v.statut, 'hors_seuil');
  assert.deepEqual(v.depassements, [{ cle: 'pm_mg_nm3', valeur: 45, seuil: 40 }]);
});
test('granulés : seuils propres (Etas 79 hors seuil)', () => assert.equal(verdictBarTh112({ ...toron, fuel_type: 'granules', etas_pct: 79, pm_mg_nm3: 15, cog_mgc_nm3: 50, co_mg_nm3: 200 }).statut, 'hors_seuil'));
test('NOx manquant : incomplet', () => {
  const { nox_mg_nm3, ...sans } = toron;
  assert.deepEqual(verdictBarTh112(sans), { statut: 'incomplet', manquants: ['nox_mg_nm3'], depassements: [], remarques: [] });
});
test('Flamme Verte : émissions non exigées', () => assert.equal(verdictBarTh112({ fuel_type: 'bois', etas_pct: 70, norme_mesure: 'EN 13240', flamme_verte: true }).statut, 'conforme'));
test('hors seuil prime sur incomplet', () => assert.equal(verdictBarTh112({ fuel_type: 'bois', etas_pct: 60 }).statut, 'hors_seuil'));
test('combustible hybride, absent ou canonical nul : inconnu', () => {
  for (const c of [{ ...toron, fuel_type: 'hybride' }, { ...toron, fuel_type: undefined }, null]) assert.equal(verdictBarTh112(c).statut, 'inconnu');
});
test('valeur non numérique traitée comme manquante', () => assert.ok(verdictBarTh112({ ...toron, co_mg_nm3: 'n.c.' }).manquants.includes('co_mg_nm3')));
test('EN 16510-1 : remarque obligé', () => assert.deepEqual(verdictBarTh112({ ...toron, norme_mesure: 'EN 16510-1' }).remarques, ['norme EN 16510-1 : à faire accepter par l\'obligé']));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/cee-bar-th-112.test.mjs`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implement `verdictBarTh112` in `src/lib/cee/barTh112.js`** — nombres acceptés seulement si `typeof === 'number' && Number.isFinite` ; ordre de priorité `hors_seuil > incomplet > conforme` ; un dépassement se juge même quand d'autres champs manquent. En-tête : source (fiche A46.3, lue le 2026-11-28, abrogée au 1ᵉʳ octobre 2027) et « jamais bloquant ».

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/cee-bar-th-112.test.mjs`
Expected: PASS. Ajouter `scripts/cee-bar-th-112.test.mjs` à la liste de `audit:quality`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cee/barTh112.js scripts/cee-bar-th-112.test.mjs package.json
git commit -m "feat(catalogue): verdict CEE BAR-TH-112 d'un poêle (règle pure, testée)"
```

### Task 3: Repère CEE dans la fiche article

**Files:**
- Create: `src/apps/artisan/pages/settings/catalogue/RepereCee.jsx`
- Modify: `src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx` (au-dessus de `<ProductSpecsForm …>`, ligne ~211 ; passer `fuelType={specs.canonical?.fuel_type}` à `ProductSpecsForm` pour que les champs propres au combustible apparaissent)
- Modify: `src/lib/tonsStatut.js` + son test si `toneFor` n'a pas de domaine `cee` (valeurs `conforme`→ok, `hors_seuil`→alerte, `incomplet`→attente, `inconnu`→neutre)

**Interfaces:**
- Consumes: `verdictBarTh112` (Task 2), `canonicalFieldsForCategory('poele')` pour traduire `manquants` en libellés.
- Produces: `<RepereCee canonical={object} />` — rendu `null` si appelé hors poêle (l'appelant ne le monte que pour `form.category === 'poele'`).

- [ ] **Step 1: Write the failing test** — dans le test de `tonsStatut` : `toneFor('cee', 'hors_seuil') === 'alerte'`, `toneFor('cee', 'conforme') === 'ok'`, `toneFor('cee', 'incomplet') === 'attente'`, `toneFor('cee', 'inconnu') === 'neutre'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/tons-statut.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement** le domaine `cee` dans `toneFor`, puis `RepereCee` : `StatusPill` (« Conforme CEE » / « Hors seuil CEE » / « Incomplet pour le CEE » / « CEE : combustible à préciser ») et, dessous en `text-xs`, une ligne par dépassement (« Particules (13 % O2) : 45 > 40 »), la liste des libellés manquants, les remarques. Aucune action, aucun blocage.

- [ ] **Step 4: Verify**

Run: `node --test scripts/tons-statut.test.mjs && npm run lint:errors && npx vite build`
Expected: PASS, build sans erreur. `node scripts/audit-ui.mjs` ne doit pas augmenter ses totaux.

- [ ] **Step 5: Commit**

```bash
git add src/apps/artisan/pages/settings/catalogue/RepereCee.jsx src/apps/artisan/pages/settings/catalogue/ArticleDrawer.jsx src/lib/tonsStatut.js scripts/tons-statut.test.mjs
git commit -m "feat(catalogue): repère CEE sur la fiche article d'un poêle"
```
