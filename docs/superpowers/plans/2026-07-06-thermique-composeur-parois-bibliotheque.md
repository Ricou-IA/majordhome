# Thermique — Composeur de parois par couches + bibliothèque org — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la bibliothèque de parois legacy (12 entrées opaques, U seul, types mélangés) par un **composeur de paroi par couches** (matériaux Th-U → U calculé et transparent) et une **bibliothèque de parois créable au niveau org** (compositions nommées, réutilisables entre études).

**Architecture :** Le moteur reste INTACT — le composeur produit un **U** (via `calculeUParoi`, déjà testé) et mémorise les **couches** pour transparence/ré-édition. `assembleBatiment.uPour` lit déjà `fam.u` quand mode ≠ 'defaut' → aucun changement moteur. La composition par étude vit dans `compositions.familles[famille] = { mode:'compose', u, couches }` (shape additive, rétro-compatible). La bibliothèque réutilisable vit dans `core.organizations.settings.thermique.parois_bibliotheque` (org-scoped, éditable via `useOrgSettings`). Toute la logique pure (recherche matériaux, U depuis couches, ops bibliothèque) est en modules `node:test` ; l'UI React est validée par build + acceptation visuelle.

**Tech Stack :** React 18, modules purs ES (`src/apps/thermique/lib/*`), `node --test scripts/thermique/*.test.mjs` (258 tests verts actuels), Tailwind, `useOrgSettings` (RPC `org_update_settings`), modale pattern UwHelperModal.

**Commande de test :** `node --test scripts/thermique/*.test.mjs`.

**Palette (R12) :** ambre/slate, jamais rouge/vert porteurs de sens.

---

## Décisions verrouillées (Dn)

- **D1 — Moteur intact.** Le composeur écrit `{ mode:'compose', u:<calculé>, couches:[...] }` dans la famille. `uPour` (assembleBatiment) lit `fam.u` inchangé. Aucune modification de `thermalEngine.js`/`assembleBatiment.js`.
- **D2 — Unités.** L'UI saisit les épaisseurs en **cm** ; `calculeUParoi` attend des **mètres** (`e/lambda` en m²·K/W). Conversion `e_m = e_cm/100` faite dans le helper pur `uParoiDepuisCouches`. Mapping famille→type Rsi/Rse : `murs→'mur'`, `plancherBas→'plancher'`, `plafondToiture→'plafond'`.
- **D3 — Couches persistées par étude.** `compositions.familles[famille].couches` (array `{materiauNom, lambda, e}` — `e` en cm). Rétro-compatible : `PATCH_COMPOSITIONS` remplace déjà l'objet famille entier ; `LOAD_STUDY` merge les familles ; `toStudyInput` persiste tel quel → **aucun changement `wizardState.js`**. Les études anciennes (sans `couches`) restent valides (`u` seul suffit à `uPour`).
- **D4 — Bibliothèque = données org** dans `settings.thermique.parois_bibliotheque` : `[{ id, nom, famille, u, couches }]`. Lue via `buildThermiqueConfig` (défaut `[]`). Écrite via `useOrgSettings().save({ thermique: {…COMPLET…, parois_bibliotheque } })` — ⚠ `org_update_settings` merge JSONB niveau 1, TOUJOURS sauver l'objet `thermique` complet (gotcha déjà documenté).
- **D5 — Legacy retiré.** `parois-types.json` n'est plus consommé par l'UI (règle aussi le piège « Mur Ext./Ent./Int. mélangés » du filtre `startsWith('Mur')`). Le fichier reste sur disque (trace) mais l'import disparaît de `CompositionFamille`. Modes de famille : **Défaut période / Composer / U saisi** (l'ancien radio « Bibliothèque » est absorbé DANS le composeur via « Charger depuis la bibliothèque »).
- **D6 — Menuiseries inchangées.** Fenêtre/porte-fenêtre/porte gardent leur U direct + `UwHelperModal`. Le composeur ne concerne que les 3 familles de parois opaques.
- **D7 — Bibliothèque org-partagée.** Une entrée créée est visible par tous les membres de l'org (référence entreprise). Gestion (renommer/supprimer) dans `/settings/thermique`.

---

## Structure des fichiers

**Créés :**
- `src/apps/thermique/lib/composeurParois.js` (PUR) — `chercheMateriaux`, `uParoiDepuisCouches`, `ajouteParoiBibliotheque`, `supprimeParoiBibliotheque`.
- `scripts/thermique/composeur-parois.test.mjs` — tests node des 4 helpers.
- `src/apps/thermique/components/wizard/ComposeurParoiModal.jsx` — modale composeur (couches + U live + charger/enregistrer bibliothèque).
- `src/apps/thermique/components/wizard/MateriauPicker.jsx` — sélecteur de matériau cherchable (364 matériaux groupés).

**Modifiés :**
- `src/apps/thermique/lib/thermiqueConfig.js` — `buildThermiqueConfig` : défaut `parois_bibliotheque: []`.
- `src/apps/thermique/components/wizard/CompositionFamille.jsx` — remplace le mode 'bibliotheque' (paroisTypes) par 'compose' (bouton → ComposeurParoiModal) ; retire l'import `paroisTypes`/`FILTRE_FAMILLE`.
- `src/apps/thermique/components/wizard/Step3OuverturesCompositions.jsx` — passe `settings`/lib à `CompositionFamille` si besoin (le composeur lit la bibliothèque via `useOrgSettings`).
- `src/apps/artisan/pages/settings/ThermiqueSettings.jsx` — nouvelle section « Bibliothèque de parois » (liste + renommer + supprimer).

---

## PHASE 1 — Composeur par couches (par étude, sans bibliothèque)

### Task 1 : Helpers purs `chercheMateriaux` + `uParoiDepuisCouches`

**Files:**
- Create: `src/apps/thermique/lib/composeurParois.js`
- Test: `scripts/thermique/composeur-parois.test.mjs`

- [ ] **Step 1 : Écrire les tests qui échouent**

```js
// scripts/thermique/composeur-parois.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chercheMateriaux, uParoiDepuisCouches } from '../../src/apps/thermique/lib/composeurParois.js';

const MATS = [
  { nom: 'Béton plein', famille: 'Bétons', lambda: 1.65 },
  { nom: 'Laine de verre', famille: 'Matériaux isolants manufacturés', lambda: 0.032 },
  { nom: 'Plaque de plâtre', famille: 'Plâtres', lambda: 0.25 },
  { nom: 'Béton cellulaire', famille: 'Blocs de béton cellulaire', lambda: 0.11 },
];

test('chercheMateriaux : préfixe insensible accents/casse', () => {
  assert.deepEqual(chercheMateriaux(MATS, 'béton').map((m) => m.nom),
    ['Béton plein', 'Béton cellulaire']);
  assert.deepEqual(chercheMateriaux(MATS, 'BETON').map((m) => m.nom),
    ['Béton plein', 'Béton cellulaire']);
});

test('chercheMateriaux : filtre famille optionnel', () => {
  assert.deepEqual(chercheMateriaux(MATS, 'béton', 'Bétons').map((m) => m.nom), ['Béton plein']);
});

test('chercheMateriaux : saisie vide → tout (jusqu\'à la limite)', () => {
  assert.equal(chercheMateriaux(MATS, '').length, 4);
});

test('uParoiDepuisCouches : mur 20cm béton + 12cm laine → U cohérent', () => {
  // R = Rsi+Rse(0.17) + 0.20/1.65 + 0.12/0.032 = 0.17 + 0.1212 + 3.75 = 4.0412 → U ≈ 0.2475
  const { u, erreur } = uParoiDepuisCouches(
    [{ materiauNom: 'Béton plein', lambda: 1.65, e: 20 }, { materiauNom: 'Laine de verre', lambda: 0.032, e: 12 }],
    'murs',
  );
  assert.equal(erreur, null);
  assert.ok(Math.abs(u - 0.2475) < 0.001, `U=${u}`);
});

test('uParoiDepuisCouches : aucune couche → erreur douce (pas de throw)', () => {
  const { u, erreur } = uParoiDepuisCouches([], 'murs');
  assert.equal(u, null);
  assert.ok(typeof erreur === 'string');
});

test('uParoiDepuisCouches : couche invalide (e ou lambda ≤ 0) → erreur douce', () => {
  const { u, erreur } = uParoiDepuisCouches([{ materiauNom: 'X', lambda: 0, e: 10 }], 'murs');
  assert.equal(u, null);
  assert.ok(typeof erreur === 'string');
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/thermique/composeur-parois.test.mjs`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter `composeurParois.js`**

```js
// src/apps/thermique/lib/composeurParois.js
// Logique pure du composeur de parois (étape 3 wizard Thermique) — aucun import React/Supabase.
// Le calcul du U délègue à calculeUParoi (thermalEngine, testé) ; ce module gère la recherche de
// matériaux, la conversion cm→m, le mapping famille→type Rsi/Rse, et les ops de bibliothèque org.
import { calculeUParoi } from './thermalEngine.js';

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MAX_RESULTATS = 60;

/** Recherche matériaux par préfixe de nom (insensible accents/casse), filtre famille optionnel.
 * Saisie vide → tous (tronqués à MAX_RESULTATS). */
export function chercheMateriaux(materiaux, saisie, famille = null) {
  if (!Array.isArray(materiaux)) throw new Error('thermique: chercheMateriaux : materiaux doit être un tableau');
  const q = typeof saisie === 'string' ? norm(saisie.trim()) : '';
  return materiaux
    .filter((m) => (!famille || m.famille === famille) && (q === '' || norm(m.nom).startsWith(q)))
    .slice(0, MAX_RESULTATS);
}

// famille wizard → type de flux pour Rsi+Rse dans calculeUParoi (cf. en-tête thermalEngine.js).
const TYPE_FLUX = { murs: 'mur', plancherBas: 'plancher', plafondToiture: 'plafond' };

/** U d'une paroi composée de `couches` ({materiauNom, lambda, e en cm}) pour une famille wizard.
 * Retour DOUX (pas de throw — usage UI live) : { u, erreur }. u null si vide/invalide. */
export function uParoiDepuisCouches(couches, famille) {
  const type = TYPE_FLUX[famille];
  if (!type) return { u: null, erreur: `famille inconnue « ${famille} »` };
  if (!Array.isArray(couches) || couches.length === 0) return { u: null, erreur: 'Ajoutez au moins une couche' };
  const couchesM = [];
  for (const c of couches) {
    if (!Number.isFinite(c.lambda) || c.lambda <= 0 || !Number.isFinite(c.e) || c.e <= 0) {
      return { u: null, erreur: 'Chaque couche : matériau (λ > 0) et épaisseur > 0 requis' };
    }
    couchesM.push({ e: c.e / 100, lambda: c.lambda }); // cm → m
  }
  try {
    return { u: Math.round(calculeUParoi(couchesM, type) * 1000) / 1000, erreur: null };
  } catch (e) {
    return { u: null, erreur: e.message.replace(/^thermique:\s*/, '') };
  }
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**
Run: `node --test scripts/thermique/composeur-parois.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/composeurParois.js scripts/thermique/composeur-parois.test.mjs
git commit -m "feat(thermique): helpers purs composeur parois (recherche matériaux, U depuis couches)"
```

---

### Task 2 : `MateriauPicker` (sélecteur cherchable)

**Files:**
- Create: `src/apps/thermique/components/wizard/MateriauPicker.jsx`

- [ ] **Step 1 : Implémenter le picker**
Autocomplete sur `materiaux` (import statique `data`), pattern proche de `CommuneSearch` : input + liste filtrée par `chercheMateriaux`, item = `{nom} · {famille} · λ {lambda}`. `onSelect(materiau)` remonte `{ nom, lambda, famille }`. Filtre famille optionnel via prop `famille`.

```jsx
// src/apps/thermique/components/wizard/MateriauPicker.jsx
import { useState } from 'react';
import { Search } from 'lucide-react';
import { materiaux } from '../../data';
import { chercheMateriaux } from '../../lib/composeurParois';

export default function MateriauPicker({ famille = null, onSelect, placeholder = 'Chercher un matériau…' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = open ? chercheMateriaux(materiaux, query, famille) : [];
  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-4 h-4 text-secondary-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          className="w-full pl-8 pr-2 py-1.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        />
      </div>
      {results.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-secondary-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {results.map((m, i) => (
            <li key={`${m.nom}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onSelect(m); setQuery(''); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary-50"
              >
                <span className="font-medium text-secondary-900">{m.nom}</span>
                <span className="text-secondary-500 text-xs"> · {m.famille} · λ {m.lambda}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2 : Build**
Run: `npx vite build` → succès.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/wizard/MateriauPicker.jsx
git commit -m "feat(thermique): sélecteur de matériau cherchable (materiaux.json Th-U)"
```

---

### Task 3 : `ComposeurParoiModal` (couches + U live) + branchement dans `CompositionFamille`

**Files:**
- Create: `src/apps/thermique/components/wizard/ComposeurParoiModal.jsx`
- Modify: `src/apps/thermique/components/wizard/CompositionFamille.jsx`

- [ ] **Step 1 : `ComposeurParoiModal.jsx`**
Modale (pattern UwHelperModal : overlay + panneau fixed + ESC). Props : `{ famille, label, couchesInitiales, onApply, onClose }`. État : liste de couches `[{ materiauNom, lambda, e }]` (e en cm, draft). Un `MateriauPicker` (famille=null pour laisser choisir isolants/enduits toutes familles) pour AJOUTER une couche (e défaut 10 cm). Chaque ligne : nom + λ + input épaisseur (cm) + R affiché (`(e/100/λ).toFixed(3)`) + supprimer. En bas : **U live** via `uParoiDepuisCouches(couches, famille)` (ambre si erreur, sinon `U = x W/(m²·K)`). Boutons : « Annuler », « Utiliser cette paroi » (`disabled` si U null) → `onApply({ u, couches })`.

- [ ] **Step 2 : Brancher dans `CompositionFamille.jsx`**
Retirer l'import `paroisTypes` + `FILTRE_FAMILLE` + le mode 'bibliotheque' (select). Modes = radios **Défaut période / Composer / U saisi**. Pour 'compose' : afficher un résumé (`{couches?.length ?? 0} couche(s) · U = {valeur.u}`) + bouton **« Composer / éditer »** ouvrant `ComposeurParoiModal` avec `couchesInitiales={valeur.couches}`. `onApply({u, couches})` → `onPatch({ mode: 'compose', u, couches })`. `setMode('compose')` sans couches ouvre le composeur vide. Le U d'en-tête lit `valeur.u`.

```jsx
// setMode adapté :
const setMode = (mode) => {
  if (mode === valeur.mode) return;
  if (mode === 'defaut') onPatch({ mode: 'defaut', u: null, couches: undefined });
  else if (mode === 'compose') setComposeurOuvert(true); // le patch vient de onApply
  else onPatch({ mode: 'saisi', u: Number.isFinite(valeur.u) ? valeur.u : uDefaut, couches: undefined });
};
```

- [ ] **Step 3 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : sur « Murs », choisir Composer → ajouter « 20 cm agglo + 12 cm laine de verre » → U ≈ 0.25 s'affiche live → « Utiliser » → l'en-tête de la carte montre U = 0.25 ; passer à l'étape 4 → le calcul utilise ce U. Rouvrir le composeur → les couches sont là (ré-éditable).

- [ ] **Step 4 : Commit**

```bash
git add src/apps/thermique/components/wizard/ComposeurParoiModal.jsx \
  src/apps/thermique/components/wizard/CompositionFamille.jsx
git commit -m "feat(thermique): composeur de paroi par couches (U calculé, transparent) remplace la biblio legacy"
```

---

## PHASE 2 — Bibliothèque org (créer + réutiliser + gérer)

### Task 4 : Défaut config + ops bibliothèque (pur)

**Files:**
- Modify: `src/apps/thermique/lib/thermiqueConfig.js`
- Modify: `src/apps/thermique/lib/composeurParois.js`
- Test: `scripts/thermique/composeur-parois.test.mjs`, `scripts/thermique/thermique-config.test.mjs`

- [ ] **Step 1 : Tests qui échouent** (`composeur-parois.test.mjs`)

```js
import { ajouteParoiBibliotheque, supprimeParoiBibliotheque } from '../../src/apps/thermique/lib/composeurParois.js';

test('ajouteParoiBibliotheque : ajoute une entrée avec id, refuse nom vide', () => {
  const { bibliotheque, erreur } = ajouteParoiBibliotheque([], {
    nom: 'Mur agglo + LDV 12', famille: 'murs', u: 0.25,
    couches: [{ materiauNom: 'Agglo', lambda: 1.05, e: 20 }],
  }, 'id-1');
  assert.equal(erreur, null);
  assert.equal(bibliotheque.length, 1);
  assert.equal(bibliotheque[0].id, 'id-1');
  assert.equal(ajouteParoiBibliotheque([], { nom: '  ', famille: 'murs', u: 0.25, couches: [] }, 'x').erreur !== null, true);
});

test('supprimeParoiBibliotheque : retire par id', () => {
  const biblio = [{ id: 'a', nom: 'X', famille: 'murs', u: 1, couches: [] }];
  assert.deepEqual(supprimeParoiBibliotheque(biblio, 'a'), []);
  assert.equal(supprimeParoiBibliotheque(biblio, 'zzz').length, 1); // id inconnu : inchangé
});
```

Et (`thermique-config.test.mjs`) :

```js
test('buildThermiqueConfig : parois_bibliotheque défaut = []', () => {
  assert.deepEqual(buildThermiqueConfig(undefined).parois_bibliotheque, []);
  assert.deepEqual(buildThermiqueConfig({ thermique: { parois_bibliotheque: [{ id: 'a' }] } }).parois_bibliotheque, [{ id: 'a' }]);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**
Run: `node --test scripts/thermique/composeur-parois.test.mjs scripts/thermique/thermique-config.test.mjs`
Expected: FAIL.

- [ ] **Step 3 : Implémenter les ops** (`composeurParois.js`)

```js
/** Ajoute une entrée nommée à la bibliothèque (pure, immutable). id fourni par le caller
 * (crypto.randomUUID côté UI — module pur sans effet de bord). Retour doux { bibliotheque, erreur }. */
export function ajouteParoiBibliotheque(bibliotheque, entree, id) {
  const base = Array.isArray(bibliotheque) ? bibliotheque : [];
  const nom = typeof entree?.nom === 'string' ? entree.nom.trim() : '';
  if (nom === '') return { bibliotheque: base, erreur: 'Nom requis' };
  if (!Number.isFinite(entree?.u)) return { bibliotheque: base, erreur: 'U invalide' };
  const item = { id, nom, famille: entree.famille, u: entree.u, couches: entree.couches ?? [] };
  return { bibliotheque: [...base, item], erreur: null };
}

/** Retire une entrée par id (pure). id inconnu → tableau inchangé. */
export function supprimeParoiBibliotheque(bibliotheque, id) {
  const base = Array.isArray(bibliotheque) ? bibliotheque : [];
  return base.filter((p) => p.id !== id);
}
```

Et dans `thermiqueConfig.js`, ajouter à `DEFAULTS_THERMIQUE` la clé `parois_bibliotheque: Object.freeze([])`, et dans `buildThermiqueConfig` le passer via le shallow spread (déjà couvert par `...org` — vérifier qu'un `parois_bibliotheque` malformé (non-array) retombe sur `[]`) :

```js
// dans buildThermiqueConfig, après le spread :
parois_bibliotheque: Array.isArray(org.parois_bibliotheque) ? org.parois_bibliotheque : DEFAULTS_THERMIQUE.parois_bibliotheque,
```

- [ ] **Step 4 : Lancer, vérifier le succès**
Run: `node --test scripts/thermique/composeur-parois.test.mjs scripts/thermique/thermique-config.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/apps/thermique/lib/composeurParois.js src/apps/thermique/lib/thermiqueConfig.js \
  scripts/thermique/composeur-parois.test.mjs scripts/thermique/thermique-config.test.mjs
git commit -m "feat(thermique): ops bibliothèque de parois + défaut config org"
```

---

### Task 5 : Charger / Enregistrer depuis le composeur

**Files:**
- Modify: `src/apps/thermique/components/wizard/ComposeurParoiModal.jsx`

- [ ] **Step 1 : Câbler la bibliothèque org dans la modale**
Via `useOrgSettings()` : `const { settings, save, isSaving } = useOrgSettings();` puis `const config = buildThermiqueConfig(settings);` → `config.parois_bibliotheque`. Filtrer par `famille`.
- **Charger** : un `<select>` « Charger depuis la bibliothèque » (entrées de la famille) → au choix, remplace les couches courantes par une copie profonde de `entree.couches`.
- **Enregistrer** : input « Nom » + bouton « Enregistrer dans la bibliothèque » → `ajouteParoiBibliotheque(config.parois_bibliotheque, { nom, famille, u, couches }, crypto.randomUUID())` puis `save({ thermique: { ...settings?.thermique, parois_bibliotheque: resultat.bibliotheque } })`. ⚠ D4 : sauver l'objet `thermique` COMPLET (spread `...settings?.thermique`). Toast succès/erreur. Bouton `disabled` si U null ou nom vide ou `isSaving`.

- [ ] **Step 2 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : composer une paroi, l'« Enregistrer » sous un nom → rouvrir le composeur sur une autre pièce/étude → « Charger depuis la bibliothèque » propose l'entrée → sélection → couches + U restaurés.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/thermique/components/wizard/ComposeurParoiModal.jsx
git commit -m "feat(thermique): charger/enregistrer une paroi dans la bibliothèque org (settings)"
```

---

### Task 6 : Gestion de la bibliothèque dans `/settings/thermique`

**Files:**
- Modify: `src/apps/artisan/pages/settings/ThermiqueSettings.jsx`

- [ ] **Step 1 : Section « Bibliothèque de parois »**
Lire `buildThermiqueConfig(settings).parois_bibliotheque` (déjà via `useOrgSettings` sur la page). Table : Nom · Famille · U · N couches · [renommer] [supprimer]. Suppression via `supprimeParoiBibliotheque` puis `save({ thermique: { ...settings?.thermique, parois_bibliotheque } })` (D4, objet complet). Renommer = édition inline du `nom` (même save). Aucune création ici (la création se fait dans le composeur, en contexte) — juste gérer/nettoyer.

- [ ] **Step 2 : Build + acceptation visuelle**
Run: `npx vite build` → succès. Acceptation : la section liste les parois créées ; renommer/supprimer persiste (rechargement conservé).

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/pages/settings/ThermiqueSettings.jsx
git commit -m "feat(thermique): gestion de la bibliothèque de parois dans /settings/thermique"
```

---

## Self-Review

**Couverture spec :**
- Composeur par couches → Task 1 (pur) + Task 2 (picker) + Task 3 (modale + branchement) ✓
- U calculé transparent, moteur intact → D1 + Task 1 (`uParoiDepuisCouches` délègue à `calculeUParoi`) ✓
- Bibliothèque créable/réutilisable/gérable → Task 4 (ops+config) + Task 5 (charger/enregistrer) + Task 6 (gestion settings) ✓
- Legacy retiré + piège du filtre corrigé → D5 + Task 3 (retrait `paroisTypes`/`FILTRE_FAMILLE`) ✓
- Persistance par étude (couches) sans casser le format verrouillé → D3 (shape additive, aucun changement wizardState) ✓

**Cohérence types/signatures :** `chercheMateriaux(materiaux, saisie, famille?)`, `uParoiDepuisCouches(couches, famille)→{u,erreur}`, `ajouteParoiBibliotheque(bibliotheque, entree, id)→{bibliotheque,erreur}`, `supprimeParoiBibliotheque(bibliotheque, id)→[]`. Famille wizard = `'murs'|'plancherBas'|'plafondToiture'` partout ; couches `{materiauNom, lambda, e(cm)}` partout ; entrée biblio `{id, nom, famille, u, couches}` partout.

**Placeholders :** helpers purs = code complet + tests ; UI = fichiers exacts + approche + acceptation (le repo n'a pas de harness React — validation visuelle assumée, cf. plan 5).

**Garde-fous :** `node --test scripts/thermique/*.test.mjs` (258→+8 verts) après chaque tâche pure ; `npx vite build` après chaque tâche UI ; palette R12 ; `useOrgSettings` = canal canonique (pas de `useAuth().organization.settings`) ; D4 objet `thermique` complet à chaque save ; moteur non touché.

**Risque résiduel :** études anciennes en `mode:'bibliotheque'` (legacy) — `uPour` lit `fam.u` donc le calcul reste correct ; l'UI (CompositionFamille) doit afficher ces cas sans casser (fallback : traiter un mode inconnu comme 'saisi' en lecture). À gérer en Task 3 Step 2 (garde `mode === 'compose'`/`'saisi'`/`'defaut'`, sinon afficher U seul en lecture).
