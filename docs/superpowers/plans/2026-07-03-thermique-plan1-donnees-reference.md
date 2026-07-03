# Module Thermique — Plan 1/5 : Données de référence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir les bases de données du logiciel Windows historique (`C:\Thermique`) et les sources open source (Open3CL, hplib) en fichiers JSON versionnés dans `src/apps/thermique/data/`, avec scripts de conversion rejouables et testés.

**Architecture:** Des scripts Node autonomes dans `scripts/thermique/` (un par source, + un orchestrateur), chacun avec parser pur testable via `node --test`. Les JSON produits sont commités (les moteurs des plans 2-3 les importeront statiquement). Aucune dépendance npm nouvelle.

**Tech Stack:** Node ≥ 18 natif (`node:fs`, `node:path`, `node:test`). Encodage source : Windows-1252 → lecture `latin1`.

**Spec:** `docs/superpowers/specs/2026-07-03-module-thermique-deperditions-design.md` (§9)

**Contexte source (vérifié le 2026-07-03) :**
- `C:\Thermique` : fichiers texte ANSI, valeurs entre guillemets, tabulations.
- `Composants/<famille>/[<sous-dossier>/]<matériau>.txt` : ligne 1 = source, ligne 2 = masse volumique (kg/m³), ligne 3 = **λ** W/(m·K), ligne 4 = capacité (J/(kg·K)), lignes suivantes = épaisseurs/notes.
- `Base de données - Coordonnées des villes.txt` : TSV avec en-tête `Villes	INSEE	Postal	Population	Latitude	Longitude	Altitude	Superficie	DJU	Entité` (~35 000 communes, séparateur de milliers = espace insécable dans DJU).
- `Coefficients-b.txt` : lignes `"<catégorie>"` puis `"<valeur> <description>"`.
- `Bibliothèque Parois.txt` : dump tableur complexe ; on n'extrait que nom + code + U (ligne d'en-tête de paroi + ligne « Déphasage thermique » qui porte R total et U jour/nuit).
- `Météo/**/*.Met` : **obfusqués → ignorés.** Le climat vient de la table θe base par département (transcrite depuis `C:\Thermique\Aide`) + altitude/DJU de la base villes.
- Chaque JSON produit porte un champ `_meta` : `{ source, license, convertedAt, script }`.

**Convention chemins :** les scripts lisent la source via `process.env.THERMIQUE_SRC || 'C:/Thermique'` et écrivent dans `src/apps/thermique/data/`.

---

### Task 1: Socle — utilitaires de lecture + orchestrateur

**Files:**
- Create: `scripts/thermique/lib/sourceFiles.js`
- Create: `scripts/thermique/convert-all.mjs`
- Test: `scripts/thermique/lib/sourceFiles.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/thermique/lib/sourceFiles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unquote, parseFrNumber, stripDiacritics } from './sourceFiles.js';

test('unquote retire les guillemets englobants et trim', () => {
  assert.equal(unquote('"Pièce"'), 'Pièce');
  assert.equal(unquote('  "0.40 Avec 1 mur"  '), '0.40 Avec 1 mur');
  assert.equal(unquote('sans guillemets'), 'sans guillemets');
});

test('parseFrNumber gère virgule, espaces (dont insécables) et vide', () => {
  assert.equal(parseFrNumber('0.60'), 0.6);
  assert.equal(parseFrNumber('0,036'), 0.036);
  assert.equal(parseFrNumber('2 165'), 2165); // espace insécable (DJU)
  assert.equal(parseFrNumber('1 000'), 1000);
  assert.equal(parseFrNumber(''), null);
  assert.equal(parseFrNumber('abc'), null);
});

test('stripDiacritics pour comparaisons de noms', () => {
  assert.equal(stripDiacritics('Bétons'), 'Betons');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/thermique/lib/sourceFiles.test.mjs`
Expected: FAIL (module inexistant)

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/thermique/lib/sourceFiles.js
// Utilitaires de lecture des fichiers du logiciel Thermique historique (ANSI/Windows-1252).
import fs from 'node:fs';
import path from 'node:path';

export const SRC_ROOT = process.env.THERMIQUE_SRC || 'C:/Thermique';
export const OUT_DIR = path.join('src', 'apps', 'thermique', 'data');

/** Lit un fichier source ANSI → string UTF-8 (latin1 couvre les accents FR de Windows-1252). */
export function readSource(relPath) {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), 'latin1');
}

export function readSourceLines(relPath) {
  return readSource(relPath).split(/\r?\n/);
}

export function unquote(line) {
  const t = String(line).trim();
  const m = t.match(/^"(.*)"$/s);
  return (m ? m[1] : t).trim();
}

/** "0,036" | "1 000" | "2 165" → number ; vide/non-numérique → null. */
export function parseFrNumber(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[\s  ]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Écrit un JSON de data avec _meta en tête. */
export function writeDataJson(fileName, meta, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = { _meta: { convertedAt: new Date().toISOString().slice(0, 10), ...meta }, ...data };
  fs.writeFileSync(path.join(OUT_DIR, fileName), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`✓ ${fileName}`);
}
```

```javascript
// scripts/thermique/convert-all.mjs
// Orchestrateur : rejoue toutes les conversions (usage : node scripts/thermique/convert-all.mjs)
const steps = [
  './convert-materiaux.mjs',
  './convert-communes.mjs',
  './convert-coefficients-b.mjs',
  './convert-menuiseries.mjs',
  './convert-parois-types.mjs',
  './convert-u-defauts.mjs',
  './convert-pac.mjs',
];
for (const step of steps) {
  console.log(`\n=== ${step} ===`);
  await import(step);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/thermique/lib/sourceFiles.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/thermique/
git commit -m "feat(thermique): socle scripts de conversion des données de référence"
```

---

### Task 2: Matériaux (`Composants/` → `materiaux.json`)

**Files:**
- Create: `scripts/thermique/lib/parseMateriau.js`
- Create: `scripts/thermique/convert-materiaux.mjs`
- Test: `scripts/thermique/lib/parseMateriau.test.mjs`

- [ ] **Step 1: Write the failing test** (fixtures = contenus réels vérifiés dans C:\Thermique)

```javascript
// scripts/thermique/lib/parseMateriau.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMateriau } from './parseMateriau.js';

test('parse un matériau Th-U (eau à 10°C : λ=0.60)', () => {
  const contenu = '"Règles Th-U 2.5"\n"1 000"\n"0.60"\n"4190"\n""\n""\n""\n';
  const m = parseMateriau(contenu, 'eau à 10°C', 'Autres matériaux');
  assert.deepEqual(m, {
    nom: 'eau à 10°C', famille: 'Autres matériaux',
    lambda: 0.6, masseVolumique: 1000, capacite: 4190,
    source: 'Règles Th-U 2.5',
  });
});

test('parse un isolant fabricant (Foamglas : λ=0.036)', () => {
  const contenu = '"Doc Foamglas terrasses bois - www.foamglas.com"\n"100"\n"0.036"\n"1 000"\n"150"\n"150"\n"notes"\n';
  const m = parseMateriau(contenu, 'Foamglas T4', 'Matériaux isolants manufacturés');
  assert.equal(m.lambda, 0.036);
  assert.equal(m.masseVolumique, 100);
});

test('rejette un fichier sans lambda exploitable', () => {
  assert.equal(parseMateriau('"src"\n""\n""\n', 'x', 'f'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/thermique/lib/parseMateriau.test.mjs`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/thermique/lib/parseMateriau.js
import { unquote, parseFrNumber } from './sourceFiles.js';

/**
 * Format Composants/<famille>/.../<nom>.txt :
 * L1 source · L2 masse volumique kg/m³ · L3 λ W/(m·K) · L4 capacité J/(kg·K)
 * @returns {{nom,famille,lambda,masseVolumique,capacite,source}|null}
 */
export function parseMateriau(contenu, nom, famille) {
  const l = contenu.split(/\r?\n/).map(unquote);
  const lambda = parseFrNumber(l[2]);
  if (lambda == null || lambda <= 0 || lambda > 500) return null; // garde-fou physique
  return {
    nom, famille,
    lambda,
    masseVolumique: parseFrNumber(l[1]),
    capacite: parseFrNumber(l[3]),
    source: l[0] || null,
  };
}
```

```javascript
// scripts/thermique/convert-materiaux.mjs
import fs from 'node:fs';
import path from 'node:path';
import { SRC_ROOT, writeDataJson } from './lib/sourceFiles.js';
import { parseMateriau } from './lib/parseMateriau.js';

const root = path.join(SRC_ROOT, 'Composants');
const materiaux = [];
const rejets = [];

function walk(dir, famille) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, famille ?? entry.name);
    else if (entry.name.endsWith('.txt')) {
      const nom = entry.name.replace(/\.txt$/, '');
      const m = parseMateriau(fs.readFileSync(p, 'latin1'), nom, famille);
      if (m) materiaux.push(m);
      else rejets.push(path.relative(root, p));
    }
  }
}
walk(root, null);
materiaux.sort((a, b) => a.famille.localeCompare(b.famille) || a.nom.localeCompare(b.nom));

if (rejets.length) console.warn(`⚠ ${rejets.length} fichiers rejetés (pas de λ) :`, rejets.slice(0, 10));
if (materiaux.length < 100) throw new Error(`Seulement ${materiaux.length} matériaux convertis — parser à vérifier`);

writeDataJson('materiaux.json',
  { source: 'C:\\Thermique\\Composants (bibliothèque du logiciel historique, usage interne)', license: 'proprietary-internal' },
  { materiaux });
```

- [ ] **Step 4: Run tests + conversion réelle**

Run: `node --test scripts/thermique/lib/parseMateriau.test.mjs && node scripts/thermique/convert-materiaux.mjs`
Expected: PASS ; `✓ materiaux.json` avec > 100 matériaux ; examiner les rejets loggés (normal d'en avoir quelques-uns : fichiers de notes).
Puis contrôle visuel : `node -e "const d=require('./src/apps/thermique/data/materiaux.json'); console.log(d.materiaux.length, d.materiaux.find(m=>m.nom.includes('eau à 10')))"`

- [ ] **Step 5: Commit**

```bash
git add scripts/thermique/ src/apps/thermique/data/materiaux.json
git commit -m "feat(thermique): conversion bibliothèque matériaux (Composants → materiaux.json)"
```

---

### Task 3: Communes (altitude + DJU) → `communes.json`

**Files:**
- Create: `scripts/thermique/lib/parseCommunes.js`
- Create: `scripts/thermique/convert-communes.mjs`
- Test: `scripts/thermique/lib/parseCommunes.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/thermique/lib/parseCommunes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommunesTsv } from './parseCommunes.js';

const TSV = [
  'Villes\tINSEE\tPostal\tPopulation\tLatitude\tLongitude\tAltitude\tSuperficie\tDJU\tEntité\t\t',
  'Aast\t640001\t64460\t193\t43.29\t-0.09\t380\t475\t2 165\tCommune\t\t',
  'Abancourt\t590001\t59265\t442\t50.24\t3.21\t50\t567\t2 300\tCommune\t\t',
  '', // ligne vide finale
].join('\n');

test('parse le TSV villes : dept dérivé de INSEE, DJU avec espace insécable', () => {
  const rows = parseCommunesTsv(TSV);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    nom: 'Aast', insee: '640001', dept: '64', cp: '64460',
    lat: 43.29, lng: -0.09, altitude: 380, dju: 2165,
  });
  assert.equal(rows[1].dept, '59');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/thermique/lib/parseCommunes.test.mjs` → FAIL

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/thermique/lib/parseCommunes.js
import { parseFrNumber } from './sourceFiles.js';

/** TSV `Base de données - Coordonnées des villes.txt` → lignes normalisées. */
export function parseCommunesTsv(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) { // skip header
    const c = line.split('\t');
    if (c.length < 9 || !c[1]) continue;
    const insee = c[1].trim();
    rows.push({
      nom: c[0].trim(), insee, dept: insee.slice(0, 2), cp: c[2].trim(),
      lat: parseFrNumber(c[4]), lng: parseFrNumber(c[5]),
      altitude: parseFrNumber(c[6]), dju: parseFrNumber(c[8]),
    });
  }
  return rows;
}
```

```javascript
// scripts/thermique/convert-communes.mjs
import { readSource, writeDataJson } from './lib/sourceFiles.js';
import { parseCommunesTsv } from './lib/parseCommunes.js';

const rows = parseCommunesTsv(readSource('Base de données - Coordonnées des villes.txt'));
if (rows.length < 30000) throw new Error(`${rows.length} communes seulement — parser à vérifier`);
writeDataJson('communes.json',
  { source: 'C:\\Thermique (base villes du logiciel historique)', license: 'proprietary-internal',
    note: 'altitude (m) et DJU (degrés-jours unifiés base 18) par commune' },
  { communes: rows });
```

Note taille : ~35 000 communes ≈ 4-5 Mo de JSON. Acceptable en fichier statique **mais ne PAS l'importer dans le bundle principal** — les plans 4-5 le chargeront en `import()` dynamique (lazy) ou le réduiront par département. Décision consignée ici pour le plan 4.

- [ ] **Step 4: Run tests + conversion réelle**

Run: `node --test scripts/thermique/lib/parseCommunes.test.mjs && node scripts/thermique/convert-communes.mjs`
Expected: PASS + `✓ communes.json` (> 30 000 communes). Contrôle : Gaillac (81) doit exister avec altitude ~140 m.
`node -e "const d=require('./src/apps/thermique/data/communes.json'); console.log(d.communes.find(c=>c.nom==='Gaillac'))"`

- [ ] **Step 5: Commit**

```bash
git add scripts/thermique/ src/apps/thermique/data/communes.json
git commit -m "feat(thermique): conversion base communes (altitude + DJU)"
```

---

### Task 4: Climat — θe de base par département → `climat.json`

La table des températures extérieures de base par département (annexe nationale FR, courte) n'est pas dans un fichier structuré : elle est dans la documentation du logiciel (`C:\Thermique\Aide\*.pdf`, chercher « température extérieure de base » dans `Aide1.pdf`/`Aide2.pdf` — l'agent exécutant lit les PDF avec l'outil Read) et dans les textes réglementaires.

**Files:**
- Create: `src/apps/thermique/data/climat.json` (transcription manuelle vérifiée)
- Create: `scripts/thermique/check-climat.test.mjs` (test de cohérence)

- [ ] **Step 1: Localiser la table dans la doc source**

Lire `C:\Thermique\Aide\Aide1.pdf` (outil Read, pages ciblées) et repérer la table « températures extérieures de base » par département avec ses tranches d'altitude. Si absente d'Aide1, balayer Aide2/Aide3. Ne PAS inventer de valeurs : chaque θe transcrit doit être lu dans la source.

- [ ] **Step 2: Écrire le test de cohérence AVANT la transcription complète**

```javascript
// scripts/thermique/check-climat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const climat = JSON.parse(readFileSync('src/apps/thermique/data/climat.json', 'utf8'));

test('structure : 96 départements métropole, tranches d’altitude croissantes', () => {
  const depts = Object.keys(climat.thetaBase);
  assert.ok(depts.length >= 95, `${depts.length} départements`);
  for (const [dept, tranches] of Object.entries(climat.thetaBase)) {
    assert.ok(Array.isArray(tranches) && tranches.length >= 1, dept);
    for (const t of tranches) {
      assert.ok(typeof t.altMax === 'number' || t.altMax === null, dept);
      assert.ok(t.thetaE >= -30 && t.thetaE <= 0, `${dept}: θe=${t.thetaE} hors plage`);
    }
    // tranches triées par altitude croissante, θe décroissant avec l'altitude
    for (let i = 1; i < tranches.length; i++) {
      assert.ok(tranches[i].thetaE <= tranches[i - 1].thetaE, `${dept}: θe doit baisser avec l'altitude`);
    }
  }
});

test('valeurs de contrôle lues dans la source (à ajuster si la source diffère)', () => {
  const at = (dept, alt) => {
    const tr = climat.thetaBase[dept].find((t) => t.altMax === null || alt <= t.altMax);
    return tr.thetaE;
  };
  // Ces 4 ancres DOIVENT être relues dans la doc Aide au moment de la transcription :
  assert.equal(at('75', 50), climat._ancres['75']);   // Paris
  assert.equal(at('67', 150), climat._ancres['67']);  // Strasbourg (continental, plus froid)
  assert.equal(at('06', 10), climat._ancres['06']);   // Nice (littoral doux)
  assert.equal(at('81', 140), climat._ancres['81']);  // Tarn (org pilote Mayer)
  assert.ok(at('67', 150) < at('06', 10), 'Strasbourg plus froid que Nice');
});
```

- [ ] **Step 3: Transcrire `climat.json`** — format :

```json
{
  "_meta": { "source": "Table θe base par département — transcrite depuis C:\\Thermique\\Aide (Aide<N>.pdf, p.<P>), annexe nationale NF EN 12831", "license": "regulatory-table", "convertedAt": "2026-07-XX" },
  "_ancres": { "75": -7, "67": -15, "06": -2, "81": -5 },
  "thetaNonChauffage": 16,
  "thetaBase": {
    "01": [ { "altMax": 200, "thetaE": -10 }, { "altMax": 600, "thetaE": -13 }, { "altMax": null, "thetaE": -15 } ],
    "02": [ { "altMax": null, "thetaE": -7 } ]
  }
}
```

(`altMax: null` = dernière tranche « au-delà ». Les valeurs ci-dessus sont des **exemples de format** ; `_ancres` est rempli avec les valeurs réellement lues, puis les 96 départements transcrits. Un département = souvent 1 seule tranche ; les départements de montagne en ont plusieurs.)

- [ ] **Step 4: Run test**

Run: `node --test scripts/thermique/check-climat.test.mjs`
Expected: PASS. Si la doc Aide ne contient pas la table : STOP, le signaler à Eric (il a la table papier/le logiciel affiche θe par ville — fallback : relever θe dans le logiciel original pour 96 départements).

- [ ] **Step 5: Commit**

```bash
git add src/apps/thermique/data/climat.json scripts/thermique/check-climat.test.mjs
git commit -m "feat(thermique): table climat θe de base par département (transcription annexe nationale)"
```

---

### Task 5: Coefficients b (locaux non chauffés) → `coefficients-b.json`

**Files:**
- Create: `scripts/thermique/lib/parseCoefB.js`
- Create: `scripts/thermique/convert-coefficients-b.mjs`
- Test: `scripts/thermique/lib/parseCoefB.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/thermique/lib/parseCoefB.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoefB } from './parseCoefB.js';

const SRC = [
  '"Pièce"',
  '"0.40 Avec seulement 1 mur extérieur"',
  '"0.50 Avec seulement 2 murs extérieurs sans portes extérieures"',
  '""',
  '"Sous-sol"',
  '"0.50 Sans fenêtre ni porte extérieure"',
  '""',
].join('\n');

test('parse catégories et valeurs b', () => {
  const cats = parseCoefB(SRC);
  assert.equal(cats.length, 2);
  assert.equal(cats[0].categorie, 'Pièce');
  assert.deepEqual(cats[0].valeurs[0], { b: 0.4, description: 'Avec seulement 1 mur extérieur' });
  assert.equal(cats[1].categorie, 'Sous-sol');
  assert.equal(cats[1].valeurs.length, 1);
});
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implementation**

```javascript
// scripts/thermique/lib/parseCoefB.js
import { unquote } from './sourceFiles.js';

/** Lignes: catégorie (texte) puis "<b> <description>" ; ligne vide = fin de catégorie. */
export function parseCoefB(text) {
  const cats = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = unquote(raw);
    if (!line) { current = null; continue; }
    const m = line.match(/^([01](?:[.,]\d+)?)\s+(.+)$/);
    if (m && current) {
      current.valeurs.push({ b: Number(m[1].replace(',', '.')), description: m[2].trim() });
    } else if (!m) {
      current = { categorie: line, valeurs: [] };
      cats.push(current);
    }
  }
  return cats.filter((c) => c.valeurs.length > 0);
}
```

```javascript
// scripts/thermique/convert-coefficients-b.mjs
import { readSource, writeDataJson } from './lib/sourceFiles.js';
import { parseCoefB } from './lib/parseCoefB.js';

const categories = parseCoefB(readSource('Coefficients-b.txt'));
if (categories.length < 4) throw new Error('Parser coefficients-b à vérifier');
writeDataJson('coefficients-b.json',
  { source: 'C:\\Thermique\\Coefficients-b.txt', license: 'regulatory-table' },
  { categories });
```

- [ ] **Step 4: Run** : `node --test scripts/thermique/lib/parseCoefB.test.mjs && node scripts/thermique/convert-coefficients-b.mjs`
Expected: PASS + JSON avec ≥ 4 catégories (Pièce, Sous-sol, Espace sous toiture, Circulations…).

- [ ] **Step 5: Commit**

```bash
git add scripts/thermique/ src/apps/thermique/data/coefficients-b.json
git commit -m "feat(thermique): conversion coefficients b (locaux non chauffés)"
```

---

### Task 6: Menuiseries → `menuiseries.json`

Sources : `Vitrages.txt`, `Menuiseries.txt`, `Volets.txt`, `WarmEdge.txt` (petits fichiers ANSI, même format ligne-à-ligne quoté). **Première action : afficher le contenu brut des 4 fichiers** (`node -e "console.log(require('node:fs').readFileSync('C:/Thermique/Vitrages.txt','latin1'))"`) puis écrire le parser sur le format constaté — même patron TDD que Task 5 (test avec fixture copiée du réel, parser dans `scripts/thermique/lib/parseMenuiseries.js`, convertisseur `convert-menuiseries.mjs`).

Sortie attendue :

```json
{
  "_meta": { "source": "C:\\Thermique (Vitrages, Menuiseries, Volets, WarmEdge)", "license": "proprietary-internal" },
  "vitrages": [ { "nom": "Double vitrage 4/16/4 argon", "ug": 1.1 } ],
  "menuiseriesTypes": [ { "nom": "PVC", "uf": 1.5 } ],
  "volets": [ { "nom": "Volet roulant PVC", "deltaR": 0.19 } ],
  "fenetresTypes": [ { "nom": "PVC DV récent", "uw": 1.3 }, { "nom": "Bois simple vitrage", "uw": 4.8 } ]
}
```

`fenetresTypes` = liste courte de **fenêtres complètes prêtes à poser dans l'UI** (Uw direct) — construite en croisant vitrage+profil, c'est elle que le wizard proposera (le détail ug/uf reste disponible en mode expert).

- [ ] Step 1 : afficher les 4 fichiers, coller les fixtures dans le test
- [ ] Step 2 : test failing → parser → test PASS (même cycle que Task 5)
- [ ] Step 3 : convertisseur + garde-fou (≥ 3 vitrages, ≥ 2 profils, uw/ug dans [0.5, 6])
- [ ] Step 4 : `node --test scripts/thermique/lib/parseMenuiseries.test.mjs && node scripts/thermique/convert-menuiseries.mjs` → PASS
- [ ] Step 5 : `git add … && git commit -m "feat(thermique): conversion menuiseries (vitrages, profils, volets)"`

---

### Task 7: Bibliothèque de parois (nom + U) → `parois-types.json`

Extraction **minimale assumée** du dump complexe `Bibliothèque Parois.txt` : nom, code, famille, U jour. Pas les compositions (spec §9 : les compositions se refont dans l'UI depuis `materiaux.json`).

Format constaté : une paroi commence par une ligne quotée dont la 2ᵉ colonne (tab) est le nom préfixé (`ME.` mur ext, `FE.` fenêtre…), dernière colonne = famille (`Mur Ext.`, `Fen. Porte et Porte-fen.`…) ; sa ligne « `Déphasage thermique de la paroi` » porte en colonnes : R total puis **U jour** puis U nuit.

**Files:**
- Create: `scripts/thermique/lib/parseParois.js`
- Create: `scripts/thermique/convert-parois-types.mjs`
- Test: `scripts/thermique/lib/parseParois.test.mjs`

- [ ] **Step 1: Test avec fixture réelle** (extraite du fichier — bloc « ME. Briques G35 Th - GR32 16 cm - Placo », attendu : `{ code:'A1', famille:'Mur Ext.', u:0.15 }`)

```javascript
// scripts/thermique/lib/parseParois.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParois } from './parseParois.js';
import { readFileSync } from 'node:fs';

// fixture-parois.txt : copier ~30 lignes réelles depuis C:\Thermique\Bibliothèque Parois.txt
// (les 2 premiers blocs, en-têtes compris) AVANT d'écrire ce test — encodage latin1 conservé.
const SRC = readFileSync(new URL('./fixture-parois.txt', import.meta.url), 'latin1');

test('extrait nom, code, famille et U jour des blocs paroi', () => {
  const parois = parseParois(SRC);
  const brique = parois.find((p) => p.nom.startsWith('ME. Briques G35'));
  assert.ok(brique);
  assert.equal(brique.code, 'A1');
  assert.equal(brique.famille, 'Mur Ext.');
  assert.ok(Math.abs(brique.u - 0.15) < 0.005);
});

test('aucun U aberrant', () => {
  for (const p of parseParois(SRC)) assert.ok(p.u > 0.05 && p.u < 6, `${p.nom}: U=${p.u}`);
});
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implementation**

```javascript
// scripts/thermique/lib/parseParois.js
import { unquote, parseFrNumber } from './sourceFiles.js';

const PREFIXES = /^(ME|MI|PB|PH|PL|TO|FE|PO)\.\s/; // familles de parois du logiciel historique

/** Extrait { nom, code, famille, u } de chaque bloc paroi du dump tableur. */
export function parseParois(text) {
  const parois = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const cols = unquote(raw).split('\t').map((c) => c.trim());
    const nom = cols[1] || '';
    if (PREFIXES.test(nom)) {
      current = { nom, code: cols[3] || null, famille: cols[cols.length - 2] || null, u: null };
      continue;
    }
    if (current && cols.some((c) => c.startsWith('Déphasage thermique'))) {
      // colonnes numériques de la ligne : [R total, U jour, U nuit] — U jour = 2e nombre
      const nums = cols.map(parseFrNumber).filter((n) => n != null && n > 0);
      if (nums.length >= 2) current.u = nums[1];
      if (current.u) parois.push(current);
      current = null;
    }
  }
  return parois;
}
```

```javascript
// scripts/thermique/convert-parois-types.mjs
import { readSource, writeDataJson } from './lib/sourceFiles.js';
import { parseParois } from './lib/parseParois.js';

const parois = parseParois(readSource('Bibliothèque Parois.txt'));
if (parois.length < 20) throw new Error(`${parois.length} parois — parser à vérifier`);
writeDataJson('parois-types.json',
  { source: 'C:\\Thermique\\Bibliothèque Parois.txt (U extraits, compositions non reprises)', license: 'proprietary-internal' },
  { parois });
```

- [ ] **Step 4: Run** : tests + conversion. Expected: PASS, ≥ 20 parois, log du count. Vérifier 2-3 U à la main contre le logiciel original ouvert.
- [ ] **Step 5: Commit** : `git commit -m "feat(thermique): extraction bibliothèque parois (nom + U)"`

---

### Task 8: U par défaut par période (Open3CL) → `u-defauts.json`

**Files:**
- Create: `scripts/thermique/convert-u-defauts.mjs`
- Create: `src/apps/thermique/data/u-defauts.json`
- Test: `scripts/thermique/check-u-defauts.test.mjs`

- [ ] **Step 1: Récupérer les tables Open3CL (MIT)**

```bash
git clone --depth 1 https://github.com/Open3CL/engine "$TMP/open3cl"  # $TMP = scratchpad de session
# Localiser les tables de valeurs (elles portent les U par défaut par période de construction) :
grep -ril "umur" "$TMP/open3cl/src" | head; ls "$TMP/open3cl/src" | head -30
```

Les tables 3CL utilisent les périodes : `avant 1948, 1948-1974, 1975-1977, 1978-1982, 1983-1988, 1989-2000, 2001-2005, 2006-2012, après 2012` et des U par défaut `umur0/uplancher0/uph0` par période (+ zone climatique pour certaines). Identifier le fichier JSON exact au moment de l'exécution (le dépôt évolue), noter son chemin + le hash du commit cloné dans `_meta.sourceRef`.

- [ ] **Step 2: Test de cohérence (avant transformation)**

```javascript
// scripts/thermique/check-u-defauts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('src/apps/thermique/data/u-defauts.json', 'utf8'));

test('structure : 4 types de paroi × périodes, U décroissants dans le temps', () => {
  for (const type of ['mur', 'plancherBas', 'plafond', 'fenetre']) {
    const periodes = d[type];
    assert.ok(Array.isArray(periodes) && periodes.length >= 6, type);
    for (const p of periodes) {
      assert.match(p.periode, /^\d{4}|^avant|^apres/i);
      assert.ok(p.u > 0.1 && p.u < 6.5, `${type} ${p.periode}: U=${p.u}`);
    }
    // isolation progressive : le U de la dernière période < U de la première
    assert.ok(periodes.at(-1).u < periodes[0].u, `${type}: U récent doit être meilleur`);
  }
});
```

- [ ] **Step 3: Écrire le script de transformation** `convert-u-defauts.mjs` : lit le JSON Open3CL localisé (chemin passé en argv), mappe vers le format cible ci-dessous, écrit avec `_meta: { source: 'Open3CL/engine (MIT)', sourceRef: '<commit>', license: 'MIT' }` :

```json
{
  "mur":        [ { "periode": "avant 1948", "u": 2.5 }, { "periode": "1948-1974", "u": 2.5 } ],
  "plancherBas": [ { "periode": "avant 1948", "u": 2.0 } ],
  "plafond":     [ { "periode": "avant 1948", "u": 2.5 } ],
  "fenetre":     [ { "periode": "avant 1948", "u": 4.8 } ]
}
```

(valeurs illustratives — les vraies viennent du fichier Open3CL ; si une table est indexée aussi par effet joule/zone, prendre la colonne « défaut » la plus générale et le noter dans `_meta.note`)

- [ ] **Step 4: Run** : `node scripts/thermique/convert-u-defauts.mjs "$TMP/open3cl/src/<fichier>.json" && node --test scripts/thermique/check-u-defauts.test.mjs` → PASS
- [ ] **Step 5: Commit** : `git commit -m "feat(thermique): U par défaut par période de construction (tables Open3CL, MIT)"`

---

### Task 9: Courbes PAC (hplib) → `pac-catalogue.json`

**Files:**
- Create: `scripts/thermique/convert-pac.mjs`
- Create: `src/apps/thermique/data/pac-catalogue.json`
- Test: `scripts/thermique/check-pac.test.mjs`

- [ ] **Step 1: Télécharger la base hplib (MIT) et inspecter les colonnes**

```bash
curl -L -o "$TMP/hplib_database.csv" https://raw.githubusercontent.com/RE-Lab-Projects/hplib/main/hplib/hplib_database.csv
head -2 "$TMP/hplib_database.csv"
```

Colonnes attendues (à confirmer sur l'en-tête réel) : `Manufacturer, Model, Type/Group (ex. "Outdoor Air/Water", régulé), P_th_h_ref [W], p1..p4_P_th, p1..p4_COP…` — le modèle hplib : `P_th(T_in, T_out) = P_th_ref · (p1·T_in + p2·T_out + p3 + p4·T_amb)` et de même pour COP (cf. README hplib). Si l'URL a changé : chercher `hplib_database.csv` dans le dépôt GitHub RE-Lab-Projects/hplib.

- [ ] **Step 2: Test de cohérence**

```javascript
// scripts/thermique/check-pac.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('src/apps/thermique/data/pac-catalogue.json', 'utf8'));

test('catalogue : génériques présents + modèles air/eau, params complets', () => {
  assert.ok(d.pacs.length >= 20, `${d.pacs.length} PAC`);
  assert.ok(d.pacs.some((p) => p.generique), 'au moins un modèle générique');
  for (const p of d.pacs.slice(0, 50)) {
    assert.ok(p.fabricant && p.modele, JSON.stringify(p));
    assert.equal(p.type, 'air-eau');
    assert.ok(Number.isFinite(p.pthRef) && p.pthRef > 1000, `${p.modele}: pthRef`);
    assert.equal(p.coefPth.length, 4);
    assert.equal(p.coefCop.length, 4);
  }
});
```

- [ ] **Step 3: Script de conversion** `convert-pac.mjs` : parse le CSV (split simple `,` ne suffit pas si champs quotés — utiliser un mini-parser CSV avec gestion des guillemets, ~15 lignes), filtre `Type` air/eau **régulé** (« Outdoor Air/Water » + subtype regulated), garde `{ fabricant, modele, type:'air-eau', pthRef, coefPth:[p1..p4], coefCop:[p1..p4], generique:boolean }`, ajoute les modèles « Generic » hplib. Écrit avec `_meta: { source: 'hplib (RE-Lab-Projects)', license: 'MIT', sourceRef: '<date/commit>' }`.

- [ ] **Step 4: Run** : conversion + `node --test scripts/thermique/check-pac.test.mjs` → PASS. Contrôle physique : pour un modèle connu, `COP(T_in=7, T_out=35)` doit tomber entre 3 et 6 (petit calcul inline dans le test si les colonnes le permettent).
- [ ] **Step 5: Commit** : `git commit -m "feat(thermique): catalogue PAC air/eau (courbes hplib, MIT)"`

---

### Task 10: Ventilation + tarifs énergie + index des données

**Files:**
- Create: `src/apps/thermique/data/ventilation.json` (valeurs réglementaires publiques, écrites directement)
- Create: `src/apps/thermique/data/tarifs-energie.json` (défauts éditables par org ensuite)
- Create: `src/apps/thermique/data/index.js` (point d'entrée unique)
- Test: `scripts/thermique/check-data-index.test.mjs`

- [ ] **Step 1: Écrire `ventilation.json`** (débits extraits réglementaires logement — arrêté du 24 mars 1982 modifié — et taux pour le calcul EN 12831) :

```json
{
  "_meta": { "source": "Arrêté du 24 mars 1982 modifié (débits logement) + n_min EN 12831", "license": "regulatory-table" },
  "systemes": [
    { "id": "naturelle",   "nom": "Ventilation naturelle",  "mode": "taux",   "tauxParPiece": { "defaut": 0.5, "cuisine": 1.0, "sdb": 1.0, "wc": 1.0 } },
    { "id": "vmc-sf-auto", "nom": "VMC simple flux autoréglable", "mode": "debits", "rendement": 0 },
    { "id": "vmc-sf-hygro","nom": "VMC simple flux hygroréglable", "mode": "debits", "facteurDebit": 0.75, "rendement": 0 },
    { "id": "vmc-df",      "nom": "VMC double flux", "mode": "debits", "rendement": 0.7 }
  ],
  "debitsExtraitsParTaille": [
    { "piecesPrincipales": 1, "debitTotal": 35, "cuisine": 20 },
    { "piecesPrincipales": 2, "debitTotal": 60, "cuisine": 30 },
    { "piecesPrincipales": 3, "debitTotal": 75, "cuisine": 45 },
    { "piecesPrincipales": 4, "debitTotal": 90, "cuisine": 45 },
    { "piecesPrincipales": 5, "debitTotal": 105, "cuisine": 45 },
    { "piecesPrincipales": 6, "debitTotal": 120, "cuisine": 45 }
  ]
}
```

(Débits en m³/h. `facteurDebit` hygro = réduction moyenne assumée ; `rendement` DF = récupération sur l'air extrait. Vérifier les débits contre l'arrêté ou le dossier `C:\Thermique\Ventilation\Logements` avant commit.)

- [ ] **Step 2: Écrire `tarifs-energie.json`** — relever les prix dans `C:\Thermique\Tarif Energie.txt` (format quoté verbeux : lire le fichier entier, en extraire manuellement les €/kWh actuels) ; structure :

```json
{
  "_meta": { "source": "C:\\Thermique\\Tarif Energie.txt (2025) — défauts, éditables par org (plan 4)", "license": "proprietary-internal" },
  "tarifs": [
    { "id": "elec-base", "nom": "Électricité base", "prixKwh": 0.0 },
    { "id": "elec-hphc", "nom": "Électricité HP/HC", "prixKwh": 0.0 },
    { "id": "gaz", "nom": "Gaz naturel", "prixKwh": 0.0 },
    { "id": "fioul", "nom": "Fioul domestique", "prixKwh": 0.0 }
  ]
}
```

(`0.0` = à remplacer par les valeurs lues — le test vérifie qu'aucun prix ne reste à 0.)

- [ ] **Step 3: Écrire l'index + test global**

```javascript
// src/apps/thermique/data/index.js
// Point d'entrée unique des données de référence du module Thermique.
// ⚠ communes.json est volumineux (~5 Mo) → import() dynamique uniquement.
export { default as climat } from './climat.json';
export { default as materiaux } from './materiaux.json';
export { default as paroisTypes } from './parois-types.json';
export { default as uDefauts } from './u-defauts.json';
export { default as menuiseries } from './menuiseries.json';
export { default as coefficientsB } from './coefficients-b.json';
export { default as ventilation } from './ventilation.json';
export { default as pacCatalogue } from './pac-catalogue.json';
export { default as tarifsEnergie } from './tarifs-energie.json';
export const loadCommunes = () => import('./communes.json').then((m) => m.default);
```

```javascript
// scripts/thermique/check-data-index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DATA = 'src/apps/thermique/data';

test('tous les JSON de data parsent et portent _meta.source + license', () => {
  for (const f of readdirSync(DATA).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(`${DATA}/${f}`, 'utf8'));
    assert.ok(d._meta?.source, `${f}: _meta.source manquant`);
    assert.ok(d._meta?.license, `${f}: _meta.license manquant`);
  }
});

test('tarifs énergie renseignés (pas de 0 restant)', () => {
  const d = JSON.parse(readFileSync(`${DATA}/tarifs-energie.json`, 'utf8'));
  for (const t of d.tarifs) assert.ok(t.prixKwh > 0.01, `${t.id} non renseigné`);
});
```

- [ ] **Step 4: Run all** : `node --test scripts/thermique/` → tous les tests du plan PASS. Puis `node scripts/thermique/convert-all.mjs` (rejouable de bout en bout, sauf Task 4/8/9 qui ont des entrées manuelles/externes — convert-all les saute proprement si la source manque : wrapper try/catch avec message).
- [ ] **Step 5: Lint + commit final**

```bash
npm run lint:errors
git add scripts/thermique/ src/apps/thermique/data/
git commit -m "feat(thermique): ventilation, tarifs énergie, index des données de référence"
```

---

## Self-review (fait à la rédaction)

- **Couverture spec §9** : climat ✅(T4+T3) · matériaux ✅(T2) · parois-types ✅(T7, réduit à nom+U — assumé et noté) · u-defauts ✅(T8) · menuiseries ✅(T6) · coefficients-b ✅(T5) · ventilation ✅(T10) · pac ✅(T9) · tarifs ✅(T10). Fichiers `.Met` obfusqués → remplacés par DJU communes + θe transcrit (écart au spec documenté en tête de plan).
- **Dépendances inter-plans** : les moteurs (plan 2) consomment `data/index.js` ; le format de chaque JSON est figé par les tests `check-*`.
- **Points de vigilance exécutant** : Task 4 exige une lecture réelle des PDF Aide (jamais de valeurs inventées) ; Tasks 8-9 dépendent de dépôts GitHub externes (chemins à confirmer à l'exécution, refs consignées dans `_meta.sourceRef`).
