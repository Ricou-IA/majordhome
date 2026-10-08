# Démarches administratives PV — tranche 1 : moteur + paramètres + onglet Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le moteur pur `calculerDemarches()` (parcours, planning, pièces, frais, alertes), ses paramètres datés dans `settings.pv.demarches`, et l'onglet Settings → Solaire → Démarches qui les édite. Rien de visible côté client dans cette tranche (section Résultats, PDF et mandat = tranches 2 et 3).

**Architecture:** Modules PURS dans `src/apps/solaire/lib/demarches/` (aucun import React/Supabase/alias, JSDoc), testés en `node --test`. Les défauts sont rattachés à `PV_DEFAULTS.demarches` pour que `buildPvConfig(settings)` fasse le merge org (objets fusionnés, listes datées remplacées). L'onglet Settings est un fichier à part (`settings/solaire/DemarchesTab.jsx`) branché dans `SolaireSettings.jsx`, qui sauve l'objet `pv` complet.

**Tech Stack:** JavaScript ES modules, `node:test`, React 18 + Tailwind (onglet), `useOrgSettings` existant.

**Spec:** `docs/superpowers/specs/2026-10-08-solaire-demarches-administratives-design.md` (§4, §5.1-5.3, §6, §8.2, §10 critères 1-9).

## Global Constraints

- Moteur **pur** : aucun `import` React, Supabase, `@lib/…` ou alias Vite dans `src/apps/solaire/lib/demarches/`. Imports relatifs uniquement. JSDoc sur chaque export.
- Aucun montant ni délai en dur hors `DEMARCHES_DEFAULTS` ; le moteur ne lit que `parametres`.
- Dates : chaînes ISO `YYYY-MM-DD`, arithmétique en UTC (`Date.UTC`), mois calendaires avec écrêtage au dernier jour du mois.
- Liste datée vide ou sans entrée en vigueur → `null` + alerte `parametre_manquant`, **jamais 0**.
- Entrée datée dont `valide_jusqu_au` < date cible → utilisée quand même + alerte `parametre_perime`.
- Pose au sol hors périmètre : pas de `type_pose`, DP toujours applicable, éligibilité au rachat = RGE seulement.
- Prime à l'autoconsommation : paramètre conservé, **jamais** exposé dans le résultat.
- Chaque alerte porte `code`, `niveau` (`info | avertissement | bloquant`) et `message` (le libellé du niveau est rendu avec l'icône, jamais la couleur seule).
- Onglet Settings : sauver `pv` complet (`save({ pv: form })`, merge JSONB niveau 1) ; composant < 500 LOC, logique dans `parametres.js`, pas dans le JSX.
- Commits conventionnels en français, suffixe `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Pre-commit = `lint:errors`.
- Vérification de fin de tranche : `node --test scripts/solaire/demarches.test.mjs`, `npx vite build`, `npm run lint:errors`.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/apps/solaire/lib/demarches/parametres.js` (créer) | `DEMARCHES_DEFAULTS`, métadonnées `DELAIS_META` / `TARIFS_META`, `valeurA()`, `buildDemarchesParams()` |
| `src/apps/solaire/lib/demarches/planning.js` (créer) | `ajouterDelai()`, `lundiSuivant()`, `maxIso()`, `calculerPlanning()` |
| `src/apps/solaire/lib/demarches/referentiel.js` (créer) | `ETAPES` (texte client / entreprise / tiers, variantes selon le mode) |
| `src/apps/solaire/lib/demarches/regles.js` (créer) | délai d'instruction, Enedis, Consuel, rachat, applicabilité, alertes de situation |
| `src/apps/solaire/lib/demarches/pieces.js` (créer) | checklist |
| `src/apps/solaire/lib/demarches/frais.js` (créer) | lignes de frais + prise en charge |
| `src/apps/solaire/lib/demarches/index.js` (créer) | `ENGINE_VERSION`, `normaliserInputs()`, `calculerDemarches()` |
| `src/apps/solaire/lib/pvConfig.js` (modifier) | `PV_DEFAULTS.demarches = DEMARCHES_DEFAULTS` |
| `src/apps/artisan/pages/settings/solaire/DemarchesTab.jsx` (créer) | onglet Settings |
| `src/apps/artisan/pages/settings/SolaireSettings.jsx` (modifier) | onglet + validation |
| `src/lib/modules.js` (modifier) | description de la tuile Solaire |
| `scripts/solaire/demarches.test.mjs` (créer) | tests moteur, ajouté à `audit:quality` |
| `package.json` (modifier) | `audit:quality` |

---

### Task 1 : Paramètres datés (`parametres.js`)

**Files:**
- Create: `src/apps/solaire/lib/demarches/parametres.js`
- Modify: `src/apps/solaire/lib/pvConfig.js` (ajout `demarches` dans `PV_DEFAULTS`)
- Test: `scripts/solaire/demarches.test.mjs`

**Interfaces:**
- Produces: `DEMARCHES_DEFAULTS`, `DELAIS_META[cle] = { libelle, unite: 'jours'|'mois' }`, `TARIFS_META[cle] = { libelle, unite: string }`, `valeurA(liste, dateIso) → { valeur, date_effet, valide_jusqu_au, note, perimee } | null`, `buildDemarchesParams(settings) → params` (même forme que `DEMARCHES_DEFAULTS`).

- [ ] **Step 1 : écrire le test qui échoue**

Créer `scripts/solaire/demarches.test.mjs` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMARCHES_DEFAULTS, DELAIS_META, TARIFS_META, valeurA, buildDemarchesParams,
} from '../../src/apps/solaire/lib/demarches/parametres.js';

test('défauts : chaque délai et chaque tarif a ses métadonnées', () => {
  for (const cle of Object.keys(DEMARCHES_DEFAULTS.delais)) assert.ok(DELAIS_META[cle], `DELAIS_META.${cle}`);
  for (const cle of Object.keys(DEMARCHES_DEFAULTS.tarifs)) assert.ok(TARIFS_META[cle], `TARIFS_META.${cle}`);
  assert.deepEqual(DEMARCHES_DEFAULTS.prise_en_charge_defaut, { raccordement_enedis: 'refacture', consuel: 'refacture' });
});

test('valeurA : dernière entrée dont date_effet ≤ date cible', () => {
  const liste = [
    { date_effet: '2026-01-01', valeur: 50.1, valide_jusqu_au: '2026-10-27' },
    { date_effet: '2026-10-28', valeur: 61 },
  ];
  assert.equal(valeurA(liste, '2026-10-27').valeur, 50.1);
  assert.equal(valeurA(liste, '2026-10-28').valeur, 61);
  assert.equal(valeurA(liste, '2026-10-28').perimee, false);
});

test('valeurA : périmée si valide_jusqu_au dépassé, null si rien en vigueur ou liste vide', () => {
  const liste = [{ date_effet: '2026-01-01', valeur: 50.1, valide_jusqu_au: '2026-10-27' }];
  assert.equal(valeurA(liste, '2026-11-02').perimee, true);
  assert.equal(valeurA(liste, '2026-11-02').valeur, 50.1);
  assert.equal(valeurA(liste, '2025-12-31'), null);
  assert.equal(valeurA([], '2026-06-01'), null);
  assert.equal(valeurA(undefined, '2026-06-01'), null);
});

test('valeurA : ordre de la liste indifférent', () => {
  const liste = [{ date_effet: '2026-10-28', valeur: 61 }, { date_effet: '2026-01-01', valeur: 50.1 }];
  assert.equal(valeurA(liste, '2026-06-01').valeur, 50.1);
});

test('buildDemarchesParams : les objets fusionnent, les listes datées remplacent', () => {
  const settings = { pv: { demarches: {
    delais: { consuel: { jours: 10 } },
    tarifs: { tarif_consuel_bleu: [{ date_effet: '2027-01-01', valeur: 200 }] },
  } } };
  const p = buildDemarchesParams(settings);
  assert.equal(p.delais.consuel.jours, 10);
  assert.equal(p.delais.recours_tiers.mois, 2);            // défaut conservé
  assert.deepEqual(p.tarifs.tarif_consuel_bleu, [{ date_effet: '2027-01-01', valeur: 200 }]);
  assert.equal(p.tarifs.frais_raccordement_enedis.length, 1); // défaut conservé
});

test('buildDemarchesParams : sans settings → défauts', () => {
  assert.deepEqual(buildDemarchesParams(undefined), DEMARCHES_DEFAULTS);
  assert.deepEqual(buildDemarchesParams({}), DEMARCHES_DEFAULTS);
});
```

- [ ] **Step 2 : lancer le test, vérifier l'échec**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : FAIL « Cannot find module … parametres.js ».

- [ ] **Step 3 : écrire `parametres.js`**

```js
// src/apps/solaire/lib/demarches/parametres.js
// Paramètres du module Démarches (délais réglementaires + tarifs DATÉS).
// Source de vérité : core.organizations.settings.pv.demarches, édité dans
// Settings → Solaire → Démarches. PUR : aucun import React/Supabase.
//
// Tarifs = listes `{ date_effet, valeur, valide_jusqu_au?, note?, source? }` :
// la valeur en vigueur à une date = dernière entrée dont date_effet ≤ date.
// Une liste vide ⇒ null (jamais 0) ; le moteur lève `parametre_manquant`.

/** @typedef {{ date_effet: string, valeur: number, valide_jusqu_au?: string, note?: string, source?: string }} EntreeDatee */

export const DEMARCHES_DEFAULTS = {
  delais: {
    depot_dp:           { jours: 7 },
    instruction_dp:     { mois: 1 },
    instruction_dp_abf: { mois: 2 },
    recours_tiers:      { mois: 2 },
    enedis_cacsi:       { mois: 2 },
    enedis_surplus:     { mois: 3 },
    duree_pose:         { jours: 2 },
    consuel:            { jours: 21 },
    mise_en_service:    { jours: 42 },
  },
  tarifs: {
    frais_raccordement_enedis: [
      { date_effet: '2026-01-01', valeur: 50.10, valide_jusqu_au: '2026-10-27', note: 'Nouveau barème au 28/10/2026 à saisir' },
    ],
    tarif_consuel_bleu: [{ date_effet: '2026-01-01', valeur: 195.20, source: 'Consuel 2026' }],
    tarif_consuel_violet: [],
    tarif_oa_surplus_lte_9kwc: [{ date_effet: '2026-06-05', valeur: 1.1, source: 'Arrêté du 01/06/2026' }],
    tarif_oa_surplus_gt_9kwc: [],
    prime_autoconsommation: [{ date_effet: '2026-06-05', valeur: 0, note: 'Supprimée pour toute demande complète déposée à partir du 05/06/2026' }],
  },
  prise_en_charge_defaut: { raccordement_enedis: 'refacture', consuel: 'refacture' },
};

/** Libellés et unités des délais (onglet Settings + hypothèses du planning). */
export const DELAIS_META = {
  depot_dp:           { libelle: 'Dépôt de la DP après le départ', unite: 'jours' },
  instruction_dp:     { libelle: "Instruction de la DP (hors périmètre ABF)", unite: 'mois' },
  instruction_dp_abf: { libelle: "Instruction de la DP (périmètre ABF)", unite: 'mois' },
  recours_tiers:      { libelle: 'Recours des tiers après affichage', unite: 'mois' },
  enedis_cacsi:       { libelle: 'Réponse Enedis — convention CACSI', unite: 'mois' },
  enedis_surplus:     { libelle: 'Réponse Enedis — demande complète (surplus)', unite: 'mois' },
  duree_pose:         { libelle: 'Durée de pose', unite: 'jours' },
  consuel:            { libelle: 'Obtention de l’attestation Consuel', unite: 'jours' },
  mise_en_service:    { libelle: 'Mise en service Enedis après Consuel', unite: 'jours' },
};

/** Libellés et unités des tarifs datés. */
export const TARIFS_META = {
  frais_raccordement_enedis: { libelle: 'Frais de raccordement Enedis (surplus, Linky)', unite: '€ TTC' },
  tarif_consuel_bleu:        { libelle: 'Attestation Consuel — visa bleu', unite: '€ TTC' },
  tarif_consuel_violet:      { libelle: 'Attestation Consuel — visa violet (batterie)', unite: '€ TTC' },
  tarif_oa_surplus_lte_9kwc: { libelle: 'Tarif de rachat du surplus ≤ 9 kWc', unite: 'c€/kWh' },
  tarif_oa_surplus_gt_9kwc:  { libelle: 'Tarif de rachat du surplus > 9 kWc', unite: 'c€/kWh' },
  prime_autoconsommation:    { libelle: 'Prime à l’autoconsommation (non affichée)', unite: '€' },
};

/**
 * Valeur en vigueur à une date : dernière entrée dont date_effet ≤ dateIso.
 * @param {EntreeDatee[]|undefined} liste
 * @param {string} dateIso YYYY-MM-DD
 * @returns {{ valeur: number, date_effet: string, valide_jusqu_au: string|null, note: string|null, perimee: boolean } | null}
 */
export function valeurA(liste, dateIso) {
  if (!Array.isArray(liste) || liste.length === 0) return null;
  const enVigueur = liste
    .filter((e) => e && typeof e.date_effet === 'string' && e.date_effet <= dateIso)
    .sort((a, b) => (a.date_effet < b.date_effet ? 1 : a.date_effet > b.date_effet ? -1 : 0))[0];
  if (!enVigueur || typeof enVigueur.valeur !== 'number') return null;
  return {
    valeur: enVigueur.valeur,
    date_effet: enVigueur.date_effet,
    valide_jusqu_au: enVigueur.valide_jusqu_au ?? null,
    note: enVigueur.note ?? null,
    perimee: typeof enVigueur.valide_jusqu_au === 'string' && enVigueur.valide_jusqu_au < dateIso,
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/**
 * Paramètres effectifs = settings.pv.demarches mergés sur les défauts
 * (objets fusionnés clé à clé, listes datées REMPLACÉES).
 * @param {object|undefined} settings core.organizations.settings
 */
export function buildDemarchesParams(settings) {
  return deepMerge(DEMARCHES_DEFAULTS, settings?.pv?.demarches);
}
```

Dans `src/apps/solaire/lib/pvConfig.js`, ajouter en tête :

```js
import { DEMARCHES_DEFAULTS } from './demarches/parametres.js';
```

et dans `PV_DEFAULTS`, après `ev: { … },` :

```js
  demarches: DEMARCHES_DEFAULTS, // module Démarches administratives (délais + tarifs datés)
```

(`buildPvConfig` fait déjà le deepMerge ; `SolaireSettings` embarque donc `form.demarches` sans autre changement.)

- [ ] **Step 4 : lancer le test, vérifier le succès**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : 6 tests PASS.

- [ ] **Step 5 : vérifier le test moteur PV existant (import pvConfig)**

Run : `node --test scripts/pv-engine.test.mjs`
Expected : PASS (l'import relatif `./demarches/parametres.js` fonctionne hors Vite).

- [ ] **Step 6 : commit**

```bash
git add src/apps/solaire/lib/demarches/parametres.js src/apps/solaire/lib/pvConfig.js scripts/solaire/demarches.test.mjs
git commit -m "feat(solaire): paramètres datés du module Démarches (défauts, valeurA, merge org)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : Planning prévisionnel (`planning.js`)

**Files:**
- Create: `src/apps/solaire/lib/demarches/planning.js`
- Test: `scripts/solaire/demarches.test.mjs` (ajout)

**Interfaces:**
- Consumes: `params.delais` de Task 1.
- Produces: `ajouterDelai(iso, { jours?, mois? }) → iso`, `lundiSuivant(iso) → iso`, `maxIso(a, b) → iso`, `calculerPlanning({ date_depart, instructionCle, enedisCle }, params) → planning` avec les clés `depot_dp, accord_dp, fin_recours, depot_enedis, reponse_enedis, pose_au_plus_tot, fin_pose, attestation_consuel, mise_en_service_au_plus_tard, duree_totale_mois, hypotheses[]`.

- [ ] **Step 1 : ajouter les tests qui échouent**

Ajouter à `scripts/solaire/demarches.test.mjs` :

```js
import { ajouterDelai, lundiSuivant, maxIso, calculerPlanning } from '../../src/apps/solaire/lib/demarches/planning.js';

test('ajouterDelai : jours et mois calendaires, écrêtage fin de mois', () => {
  assert.equal(ajouterDelai('2026-10-08', { jours: 7 }), '2026-10-15');
  assert.equal(ajouterDelai('2026-01-31', { mois: 1 }), '2026-02-28');
  assert.equal(ajouterDelai('2026-11-15', { mois: 2 }), '2027-01-15');
  assert.equal(ajouterDelai('2026-10-08', {}), '2026-10-08');
});

test('lundiSuivant : lundi conservé, sinon prochain lundi', () => {
  assert.equal(lundiSuivant('2026-10-12'), '2026-10-12'); // lundi
  assert.equal(lundiSuivant('2026-10-13'), '2026-10-19'); // mardi
  assert.equal(lundiSuivant('2026-10-11'), '2026-10-12'); // dimanche
});

test('maxIso', () => {
  assert.equal(maxIso('2026-01-01', '2026-03-01'), '2026-03-01');
  assert.equal(maxIso('2026-03-01', '2026-01-01'), '2026-03-01');
});

test('calculerPlanning : chevauchement recours / Enedis, pose au lundi suivant le max', () => {
  const p = calculerPlanning({ date_depart: '2026-10-08', instructionCle: 'instruction_dp', enedisCle: 'enedis_surplus' }, DEMARCHES_DEFAULTS);
  assert.equal(p.depot_dp, '2026-10-15');
  assert.equal(p.accord_dp, '2026-11-15');
  assert.equal(p.fin_recours, '2027-01-15');
  assert.equal(p.depot_enedis, '2026-11-15');       // = accord, en parallèle du recours
  assert.equal(p.reponse_enedis, '2027-02-15');     // 3 mois (surplus) > fin du recours
  assert.equal(p.pose_au_plus_tot, '2027-02-15');   // 15/02/2027 est un lundi
  assert.equal(p.fin_pose, '2027-02-17');
  assert.equal(p.attestation_consuel, '2027-03-10');
  assert.equal(p.mise_en_service_au_plus_tard, '2027-04-21');
  assert.equal(p.duree_totale_mois, 6.4);
  assert.ok(p.hypotheses.some((h) => h.includes('7 jours')));
});

test('calculerPlanning : ABF = 2 mois d’instruction ; CACSI = 2 mois Enedis, le recours devient le facteur limitant', () => {
  const p = calculerPlanning({ date_depart: '2026-10-08', instructionCle: 'instruction_dp_abf', enedisCle: 'enedis_cacsi' }, DEMARCHES_DEFAULTS);
  assert.equal(p.accord_dp, '2026-12-15');
  assert.equal(p.fin_recours, '2027-02-15');
  assert.equal(p.reponse_enedis, '2027-02-15');
  assert.equal(p.pose_au_plus_tot, '2027-02-15');
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : FAIL « Cannot find module … planning.js ».

- [ ] **Step 3 : écrire `planning.js`**

```js
// src/apps/solaire/lib/demarches/planning.js
// Planning prévisionnel des démarches (spec §6.7). PUR, dates ISO YYYY-MM-DD en UTC.
// Les étapes 4 (recours des tiers) et 5 (Enedis) se chevauchent : la demande Enedis
// part dès l'accord de la DP. La pose ne peut commencer qu'après les deux.
import { DELAIS_META } from './parametres.js';

const JOUR_MS = 86_400_000;

function parse(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(dt) {
  return dt.toISOString().slice(0, 10);
}

/**
 * Ajoute un délai. Les mois sont calendaires (31/01 + 1 mois = 28/02).
 * @param {string} iso
 * @param {{ jours?: number, mois?: number }} delai
 * @returns {string}
 */
export function ajouterDelai(iso, delai = {}) {
  let dt = parse(iso);
  const mois = Number(delai.mois) || 0;
  const jours = Number(delai.jours) || 0;
  if (mois) {
    const jour = dt.getUTCDate();
    const cible = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + mois, 1));
    const dernierJour = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
    dt = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth(), Math.min(jour, dernierJour)));
  }
  if (jours) dt = new Date(dt.getTime() + jours * JOUR_MS);
  return format(dt);
}

/** Lundi de la prochaine semaine ouvrée (un lundi est conservé). */
export function lundiSuivant(iso) {
  const dt = parse(iso);
  const jour = dt.getUTCDay(); // 0 = dimanche, 1 = lundi
  const delta = jour === 1 ? 0 : (8 - jour) % 7;
  return format(new Date(dt.getTime() + delta * JOUR_MS));
}

/** La plus tardive de deux dates ISO. */
export function maxIso(a, b) {
  return a >= b ? a : b;
}

function libelleDelai(cle, delai) {
  const meta = DELAIS_META[cle];
  const n = delai.mois ?? delai.jours;
  const unite = delai.mois != null ? 'mois' : 'jours';
  return `${meta ? meta.libelle : cle} : ${n} ${unite}`;
}

/**
 * @param {{ date_depart: string, instructionCle: 'instruction_dp'|'instruction_dp_abf', enedisCle: 'enedis_cacsi'|'enedis_surplus' }} ctx
 * @param {{ delais: Record<string, { jours?: number, mois?: number }> }} params
 */
export function calculerPlanning(ctx, params) {
  const d = params.delais;
  const depot_dp = ajouterDelai(ctx.date_depart, d.depot_dp);
  const accord_dp = ajouterDelai(depot_dp, d[ctx.instructionCle]);
  const fin_recours = ajouterDelai(accord_dp, d.recours_tiers);
  const depot_enedis = accord_dp;
  const reponse_enedis = ajouterDelai(depot_enedis, d[ctx.enedisCle]);
  const pose_au_plus_tot = lundiSuivant(maxIso(fin_recours, reponse_enedis));
  const fin_pose = ajouterDelai(pose_au_plus_tot, d.duree_pose);
  const attestation_consuel = ajouterDelai(fin_pose, d.consuel);
  const mise_en_service_au_plus_tard = ajouterDelai(attestation_consuel, d.mise_en_service);
  const dureeJours = (parse(mise_en_service_au_plus_tard) - parse(ctx.date_depart)) / JOUR_MS;
  const duree_totale_mois = Math.round((dureeJours / 30.44) * 10) / 10;

  const hypotheses = [
    libelleDelai('depot_dp', d.depot_dp),
    libelleDelai(ctx.instructionCle, d[ctx.instructionCle]),
    libelleDelai('recours_tiers', d.recours_tiers),
    libelleDelai(ctx.enedisCle, d[ctx.enedisCle]),
    'Demande Enedis déposée dès l’accord de la DP, en parallèle du recours des tiers',
    'Pose au lundi suivant la fin du recours et la réponse Enedis',
    libelleDelai('duree_pose', d.duree_pose),
    libelleDelai('consuel', d.consuel),
    libelleDelai('mise_en_service', d.mise_en_service),
    'Délais indicatifs',
  ];

  return {
    depot_dp, accord_dp, fin_recours, depot_enedis, reponse_enedis,
    pose_au_plus_tot, fin_pose, attestation_consuel, mise_en_service_au_plus_tard,
    duree_totale_mois, hypotheses,
  };
}
```

- [ ] **Step 4 : lancer, vérifier le succès**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : 11 tests PASS. Si une date attendue diffère d'un jour, vérifier le calendrier avant de toucher le code : 15/02/2027 est bien un lundi (`new Date(Date.UTC(2027,1,15)).getUTCDay() === 1`).

- [ ] **Step 5 : commit**

```bash
git add src/apps/solaire/lib/demarches/planning.js scripts/solaire/demarches.test.mjs
git commit -m "feat(solaire): planning prévisionnel des démarches (mois calendaires, chevauchement recours/Enedis)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : Référentiel des étapes et règles (`referentiel.js`, `regles.js`)

**Files:**
- Create: `src/apps/solaire/lib/demarches/referentiel.js`, `src/apps/solaire/lib/demarches/regles.js`
- Test: `scripts/solaire/demarches.test.mjs` (ajout)

**Interfaces:**
- Consumes: `valeurA`, `params` (Task 1).
- Produces :
  - `ETAPES` : tableau ordonné `{ code, libelle, tiers, client(ctx) → string|null, installateur(ctx) → string, delaiCle(ctx) → string|null, applicable(ctx) → boolean }` avec `ctx = { societe, mode_valorisation, copropriete_ou_lotissement }`.
  - `regles.js` : `delaiInstruction(inputs) → { cle, alertes }`, `demarcheEnedis(inputs) → { type: 'cacsi'|'surplus', delaiCle }`, `typeConsuel(inputs) → 'bleu'|'violet'`, `rachat(inputs, params, dateIso) → { applicable, eligible, tarif, alertes }`, `alertesSituation(inputs) → alertes[]`, `construireEtapes(inputs, params, { instructionCle, enedisCle, societe }) → etapes[]`.

- [ ] **Step 1 : ajouter les tests qui échouent**

```js
import { ETAPES } from '../../src/apps/solaire/lib/demarches/referentiel.js';
import {
  delaiInstruction, demarcheEnedis, typeConsuel, rachat, alertesSituation, construireEtapes,
} from '../../src/apps/solaire/lib/demarches/regles.js';

const BASE = {
  commune_insee: '81099', commune_nom: 'Gaillac', puissance_kwc: 6, batterie: false,
  perimetre_abf: 'non', installateur_rge: true, mode_valorisation: 'autoconso_surplus',
  copropriete_ou_lotissement: 'aucun', compteur_linky: true, date_depart: '2026-10-08',
  prise_en_charge: { raccordement_enedis: 'refacture', consuel: 'refacture' },
};

test('référentiel : 10 étapes (9 + accord d’AG), codes uniques', () => {
  assert.equal(ETAPES.length, 10);
  assert.equal(new Set(ETAPES.map((e) => e.code)).size, 10);
  assert.equal(ETAPES[0].code, 'ACCORD_AG');
  assert.equal(ETAPES.at(-1).code, 'CONTRAT_CLOTURE');
});

test('delaiInstruction : non → 1 mois, oui → 2 mois + prescriptions, inconnu → 2 mois + à vérifier', () => {
  assert.equal(delaiInstruction(BASE).cle, 'instruction_dp');
  const oui = delaiInstruction({ ...BASE, perimetre_abf: 'oui' });
  assert.equal(oui.cle, 'instruction_dp_abf');
  assert.ok(oui.alertes.some((a) => a.code === 'abf_prescriptions' && a.niveau === 'info'));
  const inc = delaiInstruction({ ...BASE, perimetre_abf: 'inconnu' });
  assert.equal(inc.cle, 'instruction_dp_abf');
  assert.ok(inc.alertes.some((a) => a.code === 'abf_a_verifier' && a.niveau === 'avertissement'));
});

test('demarcheEnedis et typeConsuel', () => {
  assert.deepEqual(demarcheEnedis(BASE), { type: 'surplus', delaiCle: 'enedis_surplus' });
  assert.deepEqual(demarcheEnedis({ ...BASE, mode_valorisation: 'autoconso_totale' }), { type: 'cacsi', delaiCle: 'enedis_cacsi' });
  assert.equal(typeConsuel(BASE), 'bleu');
  assert.equal(typeConsuel({ ...BASE, batterie: true }), 'violet');
});

test('rachat : surplus + RGE → éligible avec tarif ≤ 9 kWc ; totale → non applicable ; non RGE → bloquant', () => {
  const r = rachat(BASE, DEMARCHES_DEFAULTS, '2026-11-15');
  assert.equal(r.applicable, true);
  assert.equal(r.eligible, true);
  assert.equal(r.tarif.valeur, 1.1);
  assert.equal(r.tarif.unite, 'c€/kWh');
  assert.equal(r.alertes.length, 0);
  assert.equal(rachat({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, '2026-11-15').applicable, false);
  const nonRge = rachat({ ...BASE, installateur_rge: false }, DEMARCHES_DEFAULTS, '2026-11-15');
  assert.equal(nonRge.eligible, false);
  assert.ok(nonRge.alertes.some((a) => a.code === 'oa_non_eligible' && a.niveau === 'bloquant'));
});

test('rachat : > 9 kWc sans tarif → parametre_manquant, tarif null', () => {
  const r = rachat({ ...BASE, puissance_kwc: 12 }, DEMARCHES_DEFAULTS, '2026-11-15');
  assert.equal(r.tarif, null);
  assert.ok(r.alertes.some((a) => a.code === 'parametre_manquant' && a.cle === 'tarif_oa_surplus_gt_9kwc'));
});

test('alertesSituation : copropriété, lotissement, compteur non Linky', () => {
  assert.equal(alertesSituation(BASE).length, 0);
  assert.ok(alertesSituation({ ...BASE, copropriete_ou_lotissement: 'copropriete' }).some((a) => a.code === 'copropriete_ag' && a.niveau === 'avertissement'));
  assert.ok(alertesSituation({ ...BASE, copropriete_ou_lotissement: 'lotissement' }).some((a) => a.code === 'lotissement_reglement' && a.niveau === 'info'));
  assert.ok(alertesSituation({ ...BASE, compteur_linky: false }).some((a) => a.code === 'compteur_non_linky'));
  assert.equal(alertesSituation({ ...BASE, mode_valorisation: 'autoconso_totale', compteur_linky: false }).length, 0);
});

test('construireEtapes : textes variantes selon le mode, accord d’AG seulement en copropriété', () => {
  const ctx = { instructionCle: 'instruction_dp', enedisCle: 'enedis_surplus', societe: 'Soleil SAS' };
  const etapes = construireEtapes(BASE, DEMARCHES_DEFAULTS, ctx);
  assert.equal(etapes.filter((e) => e.applicable).length, 9);
  const depot = etapes.find((e) => e.code === 'DEPOT_DP');
  assert.ok(depot.installateur.includes('Soleil SAS'));
  assert.ok(depot.client.includes('mandat'));
  assert.ok(etapes.find((e) => e.code === 'RACCORDEMENT_ENEDIS').installateur.includes('obligation d’achat'));
  assert.ok(etapes.find((e) => e.code === 'CONTRAT_CLOTURE').client.includes('contrat de rachat'));
  assert.equal(etapes.find((e) => e.code === 'INSTRUCTION_DP').delai.libelle, '1 mois');
  const totale = construireEtapes({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, { ...ctx, enedisCle: 'enedis_cacsi' });
  assert.ok(totale.find((e) => e.code === 'RACCORDEMENT_ENEDIS').installateur.includes('CACSI'));
  assert.ok(!totale.find((e) => e.code === 'CONTRAT_CLOTURE').client.includes('contrat de rachat'));
  const copro = construireEtapes({ ...BASE, copropriete_ou_lotissement: 'copropriete' }, DEMARCHES_DEFAULTS, ctx);
  assert.equal(copro.filter((e) => e.applicable).length, 10);
  assert.equal(copro[0].code, 'ACCORD_AG');
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : FAIL « Cannot find module … referentiel.js ».

- [ ] **Step 3 : écrire `referentiel.js`**

```js
// src/apps/solaire/lib/demarches/referentiel.js
// Les étapes du parcours administratif PV (spec §3 d'origine + accord d'AG en copropriété).
// Chaque texte est une fonction du contexte pour porter les variantes (mode de
// valorisation, société, copropriété) sans dupliquer d'étapes. PUR.
//
// ctx = { societe, mode_valorisation: 'autoconso_totale'|'autoconso_surplus', copropriete_ou_lotissement }

const surplus = (ctx) => ctx.mode_valorisation === 'autoconso_surplus';

/**
 * @typedef {object} Etape
 * @property {string} code
 * @property {string} libelle
 * @property {string|null} tiers
 * @property {(ctx: object) => string|null} client   ce que fait le client
 * @property {(ctx: object) => string} installateur  ce que fait l'entreprise
 * @property {(ctx: object) => string|null} delaiCle clé de params.delais ou null
 * @property {(ctx: object) => boolean} applicable
 */

/** @type {Etape[]} */
export const ETAPES = [
  {
    code: 'ACCORD_AG', libelle: 'Accord de l’assemblée générale', tiers: 'Syndic de copropriété',
    client: () => 'Fait inscrire le projet à l’ordre du jour de l’assemblée générale et obtient son accord écrit.',
    installateur: (ctx) => `${ctx.societe} fournit la description technique et les visuels nécessaires au vote.`,
    delaiCle: () => null,
    applicable: (ctx) => ctx.copropriete_ou_lotissement === 'copropriete',
  },
  {
    code: 'ETUDE_DEVIS', libelle: 'Étude et devis', tiers: null,
    client: () => 'Transmet ses factures d’électricité. Signe le devis et le mandat de représentation.',
    installateur: (ctx) => `${ctx.societe} réalise la visite technique, l’étude de production et le devis. Vérifie le PLU et les abords de monuments historiques.`,
    delaiCle: () => null,
    applicable: () => true,
  },
  {
    code: 'DEPOT_DP', libelle: 'Déclaration préalable', tiers: 'Mairie',
    client: () => 'Signe la déclaration préalable (il reste le déclarant) ; le dépôt est fait pour lui par mandat.',
    installateur: (ctx) => `${ctx.societe} monte le dossier (Cerfa 16702, DP1, DP2, DP4, DP6, DP7/DP8, fiches techniques) et le dépose en mairie ou en ligne.`,
    delaiCle: () => null,
    applicable: () => true,
  },
  {
    code: 'INSTRUCTION_DP', libelle: 'Instruction', tiers: 'Mairie, ABF',
    client: () => 'Transmet tout courrier de la mairie.',
    installateur: (ctx) => `${ctx.societe} répond aux demandes de pièces et adapte le projet aux prescriptions de l’Architecte des Bâtiments de France.`,
    delaiCle: (ctx) => ctx.instructionCle,
    applicable: () => true,
  },
  {
    code: 'ACCORD_AFFICHAGE', libelle: 'Accord et affichage', tiers: null,
    client: () => 'Affiche l’accord sur le terrain, visible de la rue, pendant tout le chantier.',
    installateur: (ctx) => `${ctx.societe} commande le matériel et planifie le chantier.`,
    delaiCle: () => 'recours_tiers',
    applicable: () => true,
  },
  {
    code: 'RACCORDEMENT_ENEDIS', libelle: 'Raccordement Enedis', tiers: 'Enedis',
    client: (ctx) => (surplus(ctx)
      ? 'Valide l’offre de raccordement. Les frais Enedis sont avancés puis refacturés selon le devis.'
      : 'Aucune action : la convention d’autoconsommation sans injection est signée par mandat.'),
    installateur: (ctx) => (surplus(ctx)
      ? `${ctx.societe} dépose par mandat la demande complète de raccordement avec option obligation d’achat sur Enedis Connect.`
      : `${ctx.societe} signe par mandat la convention CACSI (autoconsommation sans injection) sur Enedis Connect.`),
    delaiCle: (ctx) => ctx.enedisCle,
    applicable: () => true,
  },
  {
    code: 'INSTALLATION', libelle: 'Installation', tiers: null,
    client: () => 'Donne accès à la toiture et au tableau électrique. Signe le procès-verbal de réception.',
    installateur: (ctx) => `${ctx.societe} pose les panneaux, l’onduleur et la batterie éventuelle, puis réalise les essais.`,
    delaiCle: () => 'duree_pose',
    applicable: () => true,
  },
  {
    code: 'CONSUEL', libelle: 'Contrôle Consuel', tiers: 'Consuel',
    client: () => null,
    installateur: (ctx) => `${ctx.societe} obtient l’attestation Consuel (visa bleu, ou violet avec batterie).`,
    delaiCle: () => 'consuel',
    applicable: () => true,
  },
  {
    code: 'MISE_EN_SERVICE', libelle: 'Mise en service', tiers: 'Enedis',
    client: () => 'Présent si Enedis doit intervenir sur le compteur.',
    installateur: (ctx) => `${ctx.societe} transmet l’attestation Consuel à Enedis.`,
    delaiCle: () => 'mise_en_service',
    applicable: () => true,
  },
  {
    code: 'CONTRAT_CLOTURE', libelle: 'Contrat et clôture', tiers: 'EDF OA, Mairie',
    client: (ctx) => (surplus(ctx)
      ? 'Signe le contrat de rachat du surplus (EDF OA). Envoie la DAACT (Cerfa 13408) à la mairie.'
      : 'Envoie la DAACT (Cerfa 13408) à la mairie.'),
    installateur: (ctx) => `${ctx.societe} fournit l’attestation S21 et remet le dossier d’ouvrage (garanties, schémas, PV, attestations).`,
    delaiCle: () => null,
    applicable: () => true,
  },
];
```

- [ ] **Step 4 : écrire `regles.js`**

```js
// src/apps/solaire/lib/demarches/regles.js
// Règles métier du parcours (spec §6.1 à 6.6, 6.10). PUR.
import { ETAPES } from './referentiel.js';
import { valeurA, TARIFS_META } from './parametres.js';

/** @typedef {{ code: string, niveau: 'info'|'avertissement'|'bloquant', message: string, cle?: string }} Alerte */

/** Alerte paramètre manquant / périmé pour une clé de tarif. */
export function alerteParametre(cle, resolu) {
  const libelle = TARIFS_META[cle]?.libelle ?? cle;
  if (!resolu) {
    return { code: 'parametre_manquant', niveau: 'avertissement', cle, message: `Paramètre à renseigner : ${libelle} (Settings → Solaire → Démarches).` };
  }
  if (resolu.perimee) {
    return { code: 'parametre_perime', niveau: 'avertissement', cle, message: `${libelle} : la valeur en vigueur (${resolu.date_effet}) n’est valide que jusqu’au ${resolu.valide_jusqu_au}. À mettre à jour.` };
  }
  return null;
}

/** @returns {{ cle: 'instruction_dp'|'instruction_dp_abf', alertes: Alerte[] }} */
export function delaiInstruction(inputs) {
  if (inputs.perimetre_abf === 'non') return { cle: 'instruction_dp', alertes: [] };
  if (inputs.perimetre_abf === 'oui') {
    return {
      cle: 'instruction_dp_abf',
      alertes: [{ code: 'abf_prescriptions', niveau: 'info', message: 'Périmètre des Bâtiments de France : prescriptions possibles (panneaux noirs, pose intégrée). Échange préalable avec l’UDAP recommandé.' }],
    };
  }
  return {
    cle: 'instruction_dp_abf',
    alertes: [{ code: 'abf_a_verifier', niveau: 'avertissement', message: 'Périmètre ABF à vérifier (Atlas des patrimoines) : le délai d’instruction retenu est de 2 mois par prudence.' }],
  };
}

/** @returns {{ type: 'cacsi'|'surplus', delaiCle: 'enedis_cacsi'|'enedis_surplus' }} */
export function demarcheEnedis(inputs) {
  return inputs.mode_valorisation === 'autoconso_totale'
    ? { type: 'cacsi', delaiCle: 'enedis_cacsi' }
    : { type: 'surplus', delaiCle: 'enedis_surplus' };
}

/** @returns {'bleu'|'violet'} */
export function typeConsuel(inputs) {
  return inputs.batterie ? 'violet' : 'bleu';
}

/**
 * Contrat de rachat (obligation d'achat). Applicable en surplus seulement ;
 * éligible si installateur RGE (pose toujours en toiture).
 * @param {object} inputs
 * @param {object} params
 * @param {string} dateIso date de la demande complète (planning.depot_enedis)
 */
export function rachat(inputs, params, dateIso) {
  if (inputs.mode_valorisation !== 'autoconso_surplus') return { applicable: false, eligible: false, tarif: null, alertes: [] };
  const alertes = [];
  const eligible = inputs.installateur_rge === true;
  if (!eligible) {
    alertes.push({ code: 'oa_non_eligible', niveau: 'bloquant', message: 'Contrat de rachat non éligible : l’installateur doit être certifié RGE. Vente du surplus impossible en l’état.' });
  }
  const cle = inputs.puissance_kwc <= 9 ? 'tarif_oa_surplus_lte_9kwc' : 'tarif_oa_surplus_gt_9kwc';
  const resolu = valeurA(params.tarifs[cle], dateIso);
  const alerteP = alerteParametre(cle, resolu);
  if (alerteP) alertes.push(alerteP);
  const tarif = resolu ? { cle, valeur: resolu.valeur, unite: TARIFS_META[cle].unite, date_effet: resolu.date_effet } : null;
  return { applicable: true, eligible, tarif, alertes };
}

/** Alertes liées à la situation du bien (copropriété, lotissement, compteur). */
export function alertesSituation(inputs) {
  const alertes = [];
  if (inputs.copropriete_ou_lotissement === 'copropriete') {
    alertes.push({ code: 'copropriete_ag', niveau: 'avertissement', message: 'Copropriété : l’accord de l’assemblée générale est requis avant le dépôt de la déclaration préalable.' });
  }
  if (inputs.copropriete_ou_lotissement === 'lotissement') {
    alertes.push({ code: 'lotissement_reglement', niveau: 'info', message: 'Lotissement : vérifier le règlement ou le cahier des charges (aspect, implantation).' });
  }
  if (inputs.mode_valorisation === 'autoconso_surplus' && inputs.compteur_linky === false) {
    alertes.push({ code: 'compteur_non_linky', niveau: 'avertissement', message: 'Compteur non communicant : remplacement par un Linky nécessaire, frais de raccordement à confirmer avec Enedis.' });
  }
  return alertes;
}

function libelleDelai(delai) {
  if (!delai) return null;
  if (delai.mois != null) return `${delai.mois} mois`;
  return `${delai.jours} jours`;
}

/**
 * Étapes résolues pour un projet (textes, applicabilité, délai affiché).
 * @param {object} inputs
 * @param {object} params
 * @param {{ instructionCle: string, enedisCle: string, societe: string }} ctxCalc
 */
export function construireEtapes(inputs, params, ctxCalc) {
  const ctx = {
    societe: ctxCalc.societe || 'Votre entreprise',
    mode_valorisation: inputs.mode_valorisation,
    copropriete_ou_lotissement: inputs.copropriete_ou_lotissement,
    instructionCle: ctxCalc.instructionCle,
    enedisCle: ctxCalc.enedisCle,
  };
  return ETAPES.map((e, i) => {
    const delaiCle = e.delaiCle(ctx);
    const delai = delaiCle ? params.delais[delaiCle] : null;
    return {
      code: e.code,
      libelle: e.libelle,
      ordre: i + 1,
      applicable: e.applicable(ctx),
      client: e.client(ctx),
      installateur: e.installateur(ctx),
      tiers: e.tiers,
      delai: delai ? { cle: delaiCle, libelle: libelleDelai(delai) } : null,
    };
  });
}
```

- [ ] **Step 5 : lancer, vérifier le succès**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : 18 tests PASS.

- [ ] **Step 6 : commit**

```bash
git add src/apps/solaire/lib/demarches/referentiel.js src/apps/solaire/lib/demarches/regles.js scripts/solaire/demarches.test.mjs
git commit -m "feat(solaire): référentiel des étapes et règles du parcours administratif PV

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : Pièces et frais (`pieces.js`, `frais.js`)

**Files:**
- Create: `src/apps/solaire/lib/demarches/pieces.js`, `src/apps/solaire/lib/demarches/frais.js`
- Test: `scripts/solaire/demarches.test.mjs` (ajout)

**Interfaces:**
- Consumes: `valeurA`, `TARIFS_META`, `alerteParametre`, `typeConsuel`, `demarcheEnedis`.
- Produces: `listerPieces(inputs) → [{ code, libelle, applicable, condition }]`, `calculerFrais(inputs, params, { depot_enedis, attestation_consuel }) → { lignes: [{ code, libelle, montant_ttc, montant_connu, prise_en_charge, parametre }], total_ttc, total_connu, alertes }`.

- [ ] **Step 1 : ajouter les tests qui échouent**

```js
import { listerPieces } from '../../src/apps/solaire/lib/demarches/pieces.js';
import { calculerFrais } from '../../src/apps/solaire/lib/demarches/frais.js';

test('listerPieces : base toujours applicable, RIB seulement en surplus, règlements selon la situation', () => {
  const codes = (inputs) => listerPieces(inputs).filter((p) => p.applicable).map((p) => p.code);
  assert.deepEqual(codes(BASE), ['factures_12_mois', 'numero_pdl', 'justificatif_propriete', 'piece_identite_declarant', 'mandat_signe', 'rib']);
  assert.ok(!codes({ ...BASE, mode_valorisation: 'autoconso_totale' }).includes('rib'));
  assert.ok(codes({ ...BASE, copropriete_ou_lotissement: 'copropriete' }).includes('reglement_copropriete'));
  assert.ok(codes({ ...BASE, copropriete_ou_lotissement: 'copropriete' }).includes('accord_ag'));
  assert.ok(codes({ ...BASE, copropriete_ou_lotissement: 'lotissement' }).includes('reglement_lotissement'));
  assert.equal(listerPieces(BASE).length, 9); // toutes listées, applicable ou non
});

test('calculerFrais : surplus + Linky → Enedis au tarif en vigueur, Consuel bleu, DP gratuite, total connu', () => {
  const f = calculerFrais(BASE, DEMARCHES_DEFAULTS, { depot_enedis: '2026-11-15', attestation_consuel: '2027-03-10' });
  const enedis = f.lignes.find((l) => l.code === 'raccordement_enedis');
  assert.equal(enedis.montant_ttc, 50.1);
  assert.equal(enedis.prise_en_charge, 'refacture');
  assert.equal(enedis.parametre.cle, 'frais_raccordement_enedis');
  assert.equal(f.lignes.find((l) => l.code === 'consuel').montant_ttc, 195.2);
  assert.equal(f.lignes.find((l) => l.code === 'dp').montant_ttc, 0);
  assert.equal(f.total_ttc, 245.3);
  assert.equal(f.total_connu, true);
  assert.ok(f.alertes.some((a) => a.code === 'parametre_perime' && a.cle === 'frais_raccordement_enedis')); // valide jusqu'au 27/10/2026
});

test('calculerFrais : totale → CACSI gratuite ; batterie → violet manquant → montant null, total inconnu', () => {
  const totale = calculerFrais({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, { depot_enedis: '2026-10-15', attestation_consuel: '2026-12-01' });
  assert.equal(totale.lignes.find((l) => l.code === 'raccordement_enedis').montant_ttc, 0);
  const bat = calculerFrais({ ...BASE, batterie: true }, DEMARCHES_DEFAULTS, { depot_enedis: '2026-10-15', attestation_consuel: '2026-12-01' });
  const consuel = bat.lignes.find((l) => l.code === 'consuel');
  assert.equal(consuel.montant_ttc, null);
  assert.equal(consuel.montant_connu, false);
  assert.ok(consuel.libelle.includes('violet'));
  assert.equal(bat.total_connu, false);
  assert.equal(bat.total_ttc, null);
  assert.ok(bat.alertes.some((a) => a.code === 'parametre_manquant' && a.cle === 'tarif_consuel_violet'));
});

test('calculerFrais : surplus sans Linky → montant Enedis inconnu ; prise en charge par projet respectée', () => {
  const f = calculerFrais({ ...BASE, compteur_linky: false, prise_en_charge: { raccordement_enedis: 'inclus', consuel: 'refacture' } }, DEMARCHES_DEFAULTS, { depot_enedis: '2026-10-15', attestation_consuel: '2026-12-01' });
  const enedis = f.lignes.find((l) => l.code === 'raccordement_enedis');
  assert.equal(enedis.montant_connu, false);
  assert.equal(enedis.prise_en_charge, 'inclus');
  assert.equal(f.lignes.find((l) => l.code === 'consuel').prise_en_charge, 'refacture');
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : FAIL « Cannot find module … pieces.js ».

- [ ] **Step 3 : écrire `pieces.js`**

```js
// src/apps/solaire/lib/demarches/pieces.js
// Checklist des pièces à collecter auprès du client (spec §6.8). PUR.
// Toutes les pièces sont listées avec `applicable` ; le statut (a_demander / recue /
// non_applicable) est porté par l'UI dans pv_dossiers.demarches.pieces_statut.

const PIECES = [
  { code: 'factures_12_mois', libelle: 'Factures d’électricité des 12 derniers mois', condition: null },
  { code: 'numero_pdl', libelle: 'Numéro de point de livraison (PDL / PRM, sur la facture)', condition: null },
  { code: 'justificatif_propriete', libelle: 'Justificatif de propriété (taxe foncière ou acte)', condition: null },
  { code: 'piece_identite_declarant', libelle: 'Pièce d’identité du déclarant', condition: null },
  { code: 'mandat_signe', libelle: 'Mandat de représentation signé', condition: null },
  { code: 'rib', libelle: 'RIB (versement du rachat du surplus)', condition: 'vente du surplus' },
  { code: 'reglement_copropriete', libelle: 'Règlement de copropriété', condition: 'copropriété' },
  { code: 'accord_ag', libelle: 'Procès-verbal d’assemblée générale autorisant les travaux', condition: 'copropriété' },
  { code: 'reglement_lotissement', libelle: 'Règlement ou cahier des charges du lotissement', condition: 'lotissement' },
];

function estApplicable(piece, inputs) {
  switch (piece.condition) {
    case null: return true;
    case 'vente du surplus': return inputs.mode_valorisation === 'autoconso_surplus';
    case 'copropriété': return inputs.copropriete_ou_lotissement === 'copropriete';
    case 'lotissement': return inputs.copropriete_ou_lotissement === 'lotissement';
    default: return false;
  }
}

/**
 * @param {object} inputs
 * @returns {Array<{ code: string, libelle: string, applicable: boolean, condition: string|null }>}
 */
export function listerPieces(inputs) {
  return PIECES.map((p) => ({ ...p, applicable: estApplicable(p, inputs) }));
}
```

- [ ] **Step 4 : écrire `frais.js`**

```js
// src/apps/solaire/lib/demarches/frais.js
// Tableau des frais administratifs (spec §6.9). PUR.
// Montant inconnu = null + montant_connu:false (jamais 0 par défaut) ; le total
// n'est donné que si toutes les lignes sont connues.
import { valeurA, TARIFS_META } from './parametres.js';
import { alerteParametre, typeConsuel, demarcheEnedis } from './regles.js';

const arrondi = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} inputs
 * @param {object} params
 * @param {{ depot_enedis: string, attestation_consuel: string }} dates dates du planning auxquelles résoudre les tarifs
 */
export function calculerFrais(inputs, params, dates) {
  const alertes = [];
  const pec = { ...params.prise_en_charge_defaut, ...(inputs.prise_en_charge ?? {}) };
  const lignes = [];

  lignes.push({ code: 'dp', libelle: 'Déclaration préalable de travaux', montant_ttc: 0, montant_connu: true, prise_en_charge: 'inclus', parametre: null });

  const enedis = demarcheEnedis(inputs);
  if (enedis.type === 'cacsi') {
    lignes.push({ code: 'raccordement_enedis', libelle: 'Convention CACSI (autoconsommation sans injection)', montant_ttc: 0, montant_connu: true, prise_en_charge: pec.raccordement_enedis, parametre: null });
  } else if (inputs.compteur_linky === false) {
    lignes.push({ code: 'raccordement_enedis', libelle: 'Raccordement Enedis (compteur à remplacer, montant à confirmer)', montant_ttc: null, montant_connu: false, prise_en_charge: pec.raccordement_enedis, parametre: null });
  } else {
    const cle = 'frais_raccordement_enedis';
    const r = valeurA(params.tarifs[cle], dates.depot_enedis);
    const a = alerteParametre(cle, r);
    if (a) alertes.push(a);
    lignes.push({
      code: 'raccordement_enedis', libelle: 'Raccordement Enedis (vente du surplus)',
      montant_ttc: r ? r.valeur : null, montant_connu: Boolean(r), prise_en_charge: pec.raccordement_enedis,
      parametre: r ? { cle, date_effet: r.date_effet, unite: TARIFS_META[cle].unite } : { cle, date_effet: null, unite: TARIFS_META[cle].unite },
    });
  }

  const visa = typeConsuel(inputs);
  const cleConsuel = visa === 'violet' ? 'tarif_consuel_violet' : 'tarif_consuel_bleu';
  const rc = valeurA(params.tarifs[cleConsuel], dates.attestation_consuel);
  const ac = alerteParametre(cleConsuel, rc);
  if (ac) alertes.push(ac);
  lignes.push({
    code: 'consuel', libelle: `Attestation Consuel — visa ${visa}`,
    montant_ttc: rc ? rc.valeur : null, montant_connu: Boolean(rc), prise_en_charge: pec.consuel,
    parametre: { cle: cleConsuel, date_effet: rc ? rc.date_effet : null, unite: TARIFS_META[cleConsuel].unite },
  });

  const total_connu = lignes.every((l) => l.montant_connu);
  const total_ttc = total_connu ? arrondi(lignes.reduce((s, l) => s + l.montant_ttc, 0)) : null;
  return { lignes, total_ttc, total_connu, alertes };
}
```

- [ ] **Step 5 : lancer, vérifier le succès**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : 22 tests PASS.

- [ ] **Step 6 : commit**

```bash
git add src/apps/solaire/lib/demarches/pieces.js src/apps/solaire/lib/demarches/frais.js scripts/solaire/demarches.test.mjs
git commit -m "feat(solaire): checklist des pièces et tableau des frais du module Démarches

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : Point d'entrée `calculerDemarches()` + critères d'acceptation

**Files:**
- Create: `src/apps/solaire/lib/demarches/index.js`
- Modify: `package.json` (`audit:quality`)
- Test: `scripts/solaire/demarches.test.mjs` (ajout)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `ENGINE_VERSION = 1`, `normaliserInputs(partial, { aujourdhui }) → inputs complets`, `calculerDemarches(inputs, params, { aujourdhui, societe }) → resultat` (forme spec §5.2 + clé `rachat`).

- [ ] **Step 1 : ajouter les tests (critères d'acceptation 1-9 de la spec)**

```js
import { ENGINE_VERSION, normaliserInputs, calculerDemarches } from '../../src/apps/solaire/lib/demarches/index.js';

const OPTS = { aujourdhui: '2026-10-08', societe: 'Soleil SAS' };

test('normaliserInputs : défauts (surplus, aucun, Linky, date du jour) et perimetre_abf dérivable', () => {
  const n = normaliserInputs({ puissance_kwc: 6 }, { aujourdhui: '2026-10-08' });
  assert.equal(n.mode_valorisation, 'autoconso_surplus');
  assert.equal(n.copropriete_ou_lotissement, 'aucun');
  assert.equal(n.compteur_linky, true);
  assert.equal(n.batterie, false);
  assert.equal(n.perimetre_abf, 'inconnu');
  assert.equal(n.date_depart, '2026-10-08');
  assert.equal(normaliserInputs({ abf: { secteur_protege: true } }, { aujourdhui: '2026-10-08' }).perimetre_abf, 'oui');
  assert.equal(normaliserInputs({ abf: { secteur_protege: false } }, { aujourdhui: '2026-10-08' }).perimetre_abf, 'non');
  assert.equal(normaliserInputs({ perimetre_abf: 'non', abf: null }, { aujourdhui: '2026-10-08' }).perimetre_abf, 'non');
});

test('critère 1 : toiture, sans ABF, surplus, sans batterie → 9 étapes, 1 mois, Consuel bleu, rachat affiché', () => {
  const r = calculerDemarches(BASE, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.engine_version, ENGINE_VERSION);
  assert.equal(r.calcule_le, '2026-10-08');
  assert.equal(r.etapes.filter((e) => e.applicable).length, 9);
  assert.equal(r.etapes.find((e) => e.code === 'INSTRUCTION_DP').delai.libelle, '1 mois');
  assert.equal(r.consuel, 'bleu');
  assert.equal(r.rachat.applicable, true);
  assert.equal(r.rachat.tarif.valeur, 1.1);
  assert.equal(r.planning.pose_au_plus_tot, '2027-02-15');
  assert.ok(!r.alertes.some((a) => a.code === 'abf_a_verifier'));
  assert.ok(!('prime_autoconsommation' in r.parametres_utilises));
});

test('critère 2 : perimetre_abf inconnu → 2 mois + alerte', () => {
  const r = calculerDemarches({ ...BASE, perimetre_abf: 'inconnu' }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.etapes.find((e) => e.code === 'INSTRUCTION_DP').delai.libelle, '2 mois');
  assert.ok(r.alertes.some((a) => a.code === 'abf_a_verifier'));
  assert.equal(r.planning.accord_dp, '2026-12-15');
});

test('critère 5 : batterie → Consuel violet, montant à renseigner', () => {
  const r = calculerDemarches({ ...BASE, batterie: true }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.consuel, 'violet');
  assert.equal(r.frais.lignes.find((l) => l.code === 'consuel').montant_ttc, null);
  assert.ok(r.alertes.some((a) => a.code === 'parametre_manquant' && a.cle === 'tarif_consuel_violet'));
});

test('autoconsommation totale → CACSI, pas de rachat, pas de RIB, 2 mois Enedis', () => {
  const r = calculerDemarches({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.rachat.applicable, false);
  assert.ok(!r.pieces.find((p) => p.code === 'rib').applicable);
  assert.equal(r.etapes.find((e) => e.code === 'RACCORDEMENT_ENEDIS').delai.libelle, '2 mois');
  assert.equal(r.frais.lignes.find((l) => l.code === 'raccordement_enedis').montant_ttc, 0);
});

test('copropriété → 10 étapes applicables, accord d’AG en tête, pièces et alerte', () => {
  const r = calculerDemarches({ ...BASE, copropriete_ou_lotissement: 'copropriete' }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.etapes.filter((e) => e.applicable).length, 10);
  assert.equal(r.etapes[0].code, 'ACCORD_AG');
  assert.ok(r.pieces.find((p) => p.code === 'accord_ag').applicable);
  assert.ok(r.alertes.some((a) => a.code === 'copropriete_ag'));
});

test('non RGE + surplus → alerte bloquante', () => {
  const r = calculerDemarches({ ...BASE, installateur_rge: false }, DEMARCHES_DEFAULTS, OPTS);
  assert.ok(r.alertes.some((a) => a.code === 'oa_non_eligible' && a.niveau === 'bloquant'));
  assert.equal(r.rachat.eligible, false);
});

test('critère 6 : un paramètre modifié change le résultat sans autre intervention', () => {
  const params = buildDemarchesParams({ pv: { demarches: {
    delais: { instruction_dp: { mois: 2 } },
    tarifs: { frais_raccordement_enedis: [{ date_effet: '2026-10-28', valeur: 61 }] },
  } } });
  const r = calculerDemarches(BASE, params, OPTS);
  assert.equal(r.planning.accord_dp, '2026-12-15');
  assert.equal(r.frais.lignes.find((l) => l.code === 'raccordement_enedis').montant_ttc, 61);
  assert.ok(!r.alertes.some((a) => a.code === 'parametre_perime'));
});

test('traçabilité : parametres_utilises liste les tarifs résolus avec leur date d’effet', () => {
  const r = calculerDemarches(BASE, DEMARCHES_DEFAULTS, OPTS);
  assert.deepEqual(Object.keys(r.parametres_utilises).sort(), ['frais_raccordement_enedis', 'tarif_consuel_bleu', 'tarif_oa_surplus_lte_9kwc']);
  assert.equal(r.parametres_utilises.tarif_consuel_bleu.date_effet, '2026-01-01');
});

test('chaque alerte porte code, niveau et message ; chaque étape applicable porte un texte entreprise', () => {
  const r = calculerDemarches({ ...BASE, perimetre_abf: 'inconnu', batterie: true, copropriete_ou_lotissement: 'copropriete' }, DEMARCHES_DEFAULTS, OPTS);
  assert.ok(r.alertes.length >= 3);
  for (const a of r.alertes) {
    assert.ok(a.code && ['info', 'avertissement', 'bloquant'].includes(a.niveau) && a.message.length > 10);
  }
  for (const e of r.etapes.filter((x) => x.applicable)) assert.ok(e.installateur.length > 10);
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : FAIL « Cannot find module … index.js ».

- [ ] **Step 3 : écrire `index.js`**

```js
// src/apps/solaire/lib/demarches/index.js
// Point d'entrée UNIQUE du module Démarches administratives PV.
// PUR : aucun import React/Supabase/alias. Le résultat est figé dans
// pv_dossiers.demarches.resultat avec engine_version ; un dossier rouvert le relit.
import { valeurA } from './parametres.js';
import { calculerPlanning } from './planning.js';
import { delaiInstruction, demarcheEnedis, typeConsuel, rachat, alertesSituation, construireEtapes } from './regles.js';
import { listerPieces } from './pieces.js';
import { calculerFrais } from './frais.js';

/** À incrémenter à tout changement de règle, de texte d'étape ou de calcul. */
export const ENGINE_VERSION = 1;

/**
 * Complète et normalise les entrées (spec §5.1). `perimetre_abf` se dérive du bloc
 * `abf` du dossier s'il n'est pas fourni : secteur_protege true → oui, false → non, sinon inconnu.
 * @param {object} partial
 * @param {{ aujourdhui: string }} opts
 */
export function normaliserInputs(partial = {}, { aujourdhui }) {
  let perimetre_abf = partial.perimetre_abf;
  if (!['oui', 'non', 'inconnu'].includes(perimetre_abf)) {
    const sp = partial.abf?.secteur_protege;
    perimetre_abf = sp === true ? 'oui' : sp === false ? 'non' : 'inconnu';
  }
  return {
    commune_insee: partial.commune_insee ?? null,
    commune_nom: partial.commune_nom ?? null,
    puissance_kwc: Number(partial.puissance_kwc) || 0,
    batterie: partial.batterie === true,
    perimetre_abf,
    installateur_rge: partial.installateur_rge === true,
    mode_valorisation: partial.mode_valorisation === 'autoconso_totale' ? 'autoconso_totale' : 'autoconso_surplus',
    copropriete_ou_lotissement: ['copropriete', 'lotissement'].includes(partial.copropriete_ou_lotissement) ? partial.copropriete_ou_lotissement : 'aucun',
    compteur_linky: partial.compteur_linky !== false,
    date_depart: typeof partial.date_depart === 'string' && partial.date_depart ? partial.date_depart : aujourdhui,
    prise_en_charge: partial.prise_en_charge ?? {},
  };
}

/**
 * @param {object} inputsPartiels voir normaliserInputs
 * @param {object} params buildDemarchesParams(settings)
 * @param {{ aujourdhui: string, societe?: string }} opts
 */
export function calculerDemarches(inputsPartiels, params, { aujourdhui, societe } = {}) {
  const jour = aujourdhui ?? new Date().toISOString().slice(0, 10);
  const inputs = normaliserInputs(inputsPartiels, { aujourdhui: jour });

  const instruction = delaiInstruction(inputs);
  const enedis = demarcheEnedis(inputs);
  const planning = calculerPlanning({ date_depart: inputs.date_depart, instructionCle: instruction.cle, enedisCle: enedis.delaiCle }, params);
  const etapes = construireEtapes(inputs, params, { instructionCle: instruction.cle, enedisCle: enedis.delaiCle, societe });
  const pieces = listerPieces(inputs);
  const frais = calculerFrais(inputs, params, planning);
  const oa = rachat(inputs, params, planning.depot_enedis);

  const alertes = [...instruction.alertes, ...alertesSituation(inputs), ...oa.alertes, ...frais.alertes];

  // Traçabilité : tarifs réellement résolus (jamais la prime, non affichée).
  const parametres_utilises = {};
  for (const ligne of frais.lignes) {
    if (ligne.parametre?.cle && ligne.parametre.date_effet) {
      parametres_utilises[ligne.parametre.cle] = { valeur: ligne.montant_ttc, date_effet: ligne.parametre.date_effet, unite: ligne.parametre.unite };
    }
  }
  if (oa.tarif) parametres_utilises[oa.tarif.cle] = { valeur: oa.tarif.valeur, date_effet: oa.tarif.date_effet, unite: oa.tarif.unite };

  return {
    engine_version: ENGINE_VERSION,
    calcule_le: jour,
    inputs,
    etapes,
    planning,
    pieces,
    frais,
    consuel: typeConsuel(inputs),
    enedis: enedis.type,
    rachat: { applicable: oa.applicable, eligible: oa.eligible, tarif: oa.tarif },
    alertes,
    parametres_utilises,
  };
}

// valeurA ré-exporté pour les consommateurs UI (affichage « en vigueur au … »).
export { valeurA };
```

- [ ] **Step 4 : lancer, vérifier le succès**

Run : `node --test scripts/solaire/demarches.test.mjs`
Expected : 32 tests PASS.

- [ ] **Step 5 : brancher dans `audit:quality`**

Dans `package.json`, script `audit:quality`, insérer `scripts/solaire/demarches.test.mjs` juste après `scripts/clim/dimensionnement.test.mjs` dans la liste `node --test …`.

Run : `npm run audit:quality`
Expected : lint OK, tous les tests PASS (dont les 32 nouveaux), dead-code OK. Note : `audit:dead-code` ignore les fichiers nommés `index` et considère vivant tout fichier importé par un autre fichier de `src/` ; `index.js` importe les six modules et `pvConfig.js` importe `parametres.js`, donc rien n'est signalé même si l'app n'appelle `calculerDemarches` qu'à la tranche 2.

- [ ] **Step 6 : commit**

```bash
git add src/apps/solaire/lib/demarches/index.js scripts/solaire/demarches.test.mjs package.json
git commit -m "feat(solaire): calculerDemarches — point d'entrée du module Démarches PV, critères d'acceptation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : Onglet Settings → Solaire → Démarches

**Files:**
- Create: `src/apps/artisan/pages/settings/solaire/DemarchesTab.jsx`
- Modify: `src/apps/artisan/pages/settings/SolaireSettings.jsx` (onglet + validation), `src/lib/modules.js:66` (description de la tuile)

**Interfaces:**
- Consumes: `DELAIS_META`, `TARIFS_META` (Task 1) ; `form.demarches` déjà présent dans le `form` de `SolaireSettings` grâce à `PV_DEFAULTS.demarches`.
- Produces: `DemarchesTab({ form, patch })` ; `validateDemarches(demarches) → boolean` exporté depuis `DemarchesTab.jsx` et utilisé par `validatePvForm`.

- [ ] **Step 1 : créer `DemarchesTab.jsx`**

```jsx
// src/apps/artisan/pages/settings/solaire/DemarchesTab.jsx
// Onglet Démarches administratives : délais réglementaires + tarifs datés + prise en charge
// des frais par défaut. Édite form.demarches (settings.pv.demarches) ; la page parente
// sauve l'objet pv COMPLET (merge JSONB niveau 1). Aucune règle métier ici : les
// libellés/unités viennent de parametres.js.
import { Plus, Trash2 } from 'lucide-react';
import { DELAIS_META, TARIFS_META } from '@apps/solaire/lib/demarches/parametres';
import { FormField, SectionTitle, inputClass, selectClass } from '../../../components/FormFields';

const PRISE_EN_CHARGE_OPTIONS = [
  { value: 'refacture', label: 'Avancés par nous, refacturés au client' },
  { value: 'inclus', label: 'Inclus dans l’offre' },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Validation du bloc demarches (appelée par validatePvForm). */
export function validateDemarches(d) {
  if (!d) return false;
  for (const cle of Object.keys(DELAIS_META)) {
    const v = d.delais?.[cle];
    const n = DELAIS_META[cle].unite === 'mois' ? v?.mois : v?.jours;
    if (!isNum(n) || n < 0) return false;
  }
  for (const cle of Object.keys(TARIFS_META)) {
    const liste = d.tarifs?.[cle] ?? [];
    if (!Array.isArray(liste)) return false;
    for (const e of liste) {
      if (!isIsoDate(e.date_effet) || !isNum(e.valeur) || e.valeur < 0) return false;
      if (e.valide_jusqu_au && !isIsoDate(e.valide_jusqu_au)) return false;
    }
    if (new Set(liste.map((e) => e.date_effet)).size !== liste.length) return false;
  }
  const pec = d.prise_en_charge_defaut ?? {};
  return ['refacture', 'inclus'].includes(pec.raccordement_enedis) && ['refacture', 'inclus'].includes(pec.consuel);
}

function DelaiField({ cle, delai, onChange }) {
  const meta = DELAIS_META[cle];
  const champ = meta.unite; // 'jours' | 'mois'
  return (
    <FormField label={meta.libelle}>
      <div className="flex items-center gap-2">
        <input
          type="number" className={inputClass} min={0} step={1} inputMode="numeric"
          value={delai?.[champ] ?? ''}
          onChange={(e) => {
            const n = e.target.value === '' ? '' : Number(e.target.value);
            onChange({ [champ]: Number.isNaN(n) ? '' : n });
          }}
        />
        <span className="text-sm text-secondary-500 flex-shrink-0">{champ}</span>
      </div>
    </FormField>
  );
}

function TarifTable({ cle, liste, onChange }) {
  const meta = TARIFS_META[cle];
  const rows = [...liste].sort((a, b) => (a.date_effet || '').localeCompare(b.date_effet || ''));
  const update = (idx, p) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => onChange([...rows, { date_effet: '', valeur: '' }]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-secondary-800">{meta.libelle} <span className="text-secondary-500">({meta.unite})</span></p>
        <button type="button" onClick={add} className="btn-secondary text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" /> Ajouter une période
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[#B45309]">Aucune valeur renseignée : le moteur affichera « à renseigner » et une alerte.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-secondary-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Date d’effet</th>
                <th className="py-1 pr-2 font-medium">Valeur</th>
                <th className="py-1 pr-2 font-medium">Valide jusqu’au</th>
                <th className="py-1 pr-2 font-medium">Note</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${cle}-${idx}`}>
                  <td className="py-1 pr-2"><input type="date" className={inputClass} value={r.date_effet ?? ''} onChange={(e) => update(idx, { date_effet: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input type="number" step="any" min={0} inputMode="decimal" className={inputClass} value={r.valeur ?? ''}
                    onChange={(e) => { const n = e.target.value === '' ? '' : Number(e.target.value); update(idx, { valeur: Number.isNaN(n) ? '' : n }); }} /></td>
                  <td className="py-1 pr-2"><input type="date" className={inputClass} value={r.valide_jusqu_au ?? ''} onChange={(e) => update(idx, { valide_jusqu_au: e.target.value || undefined })} /></td>
                  <td className="py-1 pr-2"><input type="text" className={inputClass} value={r.note ?? ''} placeholder="source, remarque" onChange={(e) => update(idx, { note: e.target.value || undefined })} /></td>
                  <td className="py-1">
                    <button type="button" onClick={() => remove(idx)} className="p-1 text-secondary-400 hover:text-secondary-700" aria-label="Supprimer cette période">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function DemarchesTab({ form, patch }) {
  const d = form.demarches ?? { delais: {}, tarifs: {}, prise_en_charge_defaut: {} };
  const patchD = (p) => patch({ demarches: { ...d, ...p } });
  const setDelai = (cle, v) => patchD({ delais: { ...d.delais, [cle]: v } });
  const setTarif = (cle, liste) => patchD({ tarifs: { ...d.tarifs, [cle]: liste } });
  const setPec = (cle, v) => patchD({ prise_en_charge_defaut: { ...d.prise_en_charge_defaut, [cle]: v } });

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <SectionTitle>Délais réglementaires et internes</SectionTitle>
          <p className="text-xs text-secondary-500 mt-1">Utilisés pour le planning prévisionnel (délais indicatifs). Mois calendaires.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {Object.keys(DELAIS_META).map((cle) => (
            <DelaiField key={cle} cle={cle} delai={d.delais?.[cle]} onChange={(v) => setDelai(cle, v)} />
          ))}
        </div>
      </div>

      <div className="card space-y-6">
        <div>
          <SectionTitle>Tarifs datés</SectionTitle>
          <p className="text-xs text-secondary-500 mt-1">
            La valeur retenue est la dernière dont la date d’effet précède la date de la démarche. Une période échue (« valide jusqu’au » dépassé) reste utilisée mais déclenche une alerte.
          </p>
        </div>
        {Object.keys(TARIFS_META).map((cle) => (
          <TarifTable key={cle} cle={cle} liste={d.tarifs?.[cle] ?? []} onChange={(liste) => setTarif(cle, liste)} />
        ))}
      </div>

      <div className="card space-y-4">
        <SectionTitle>Prise en charge des frais par défaut</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Raccordement Enedis">
            <select className={selectClass} value={d.prise_en_charge_defaut?.raccordement_enedis ?? 'refacture'} onChange={(e) => setPec('raccordement_enedis', e.target.value)}>
              {PRISE_EN_CHARGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
          <FormField label="Attestation Consuel">
            <select className={selectClass} value={d.prise_en_charge_defaut?.consuel ?? 'refacture'} onChange={(e) => setPec('consuel', e.target.value)}>
              {PRISE_EN_CHARGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FormField>
        </div>
        <p className="text-xs text-secondary-500">Réglable projet par projet dans la section Démarches de l’étude.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : brancher l'onglet dans `SolaireSettings.jsx`**

Imports (après `FileText, Upload, ExternalLink, Trash2,` dans l'import lucide, ajouter `ClipboardList`) :

```js
import DemarchesTab, { validateDemarches } from './solaire/DemarchesTab';
```

`TABS` :

```js
  { key: 'demarches', label: 'Démarches', icon: ClipboardList },
```

Rendu, après la ligne `bibliotheque` :

```jsx
            {activeTab === 'demarches' && <DemarchesTab form={form} patch={patch} />}
```

`validatePvForm`, remplacer la dernière ligne `return grid.every(…)` par :

```js
  if (!grid.every((r) => isNum(r.kwc) && r.kwc >= 1 && r.kwc <= 9 && isNum(r.prix_ttc) && r.prix_ttc > 0)) return false;
  return validateDemarches(form.demarches);
```

`handleSave` : avant `await save({ pv: cleaned })`, nettoyer les listes datées (tri + suppression des clés vides) :

```js
      const tarifs = Object.fromEntries(
        Object.entries(form.demarches?.tarifs ?? {}).map(([cle, liste]) => [
          cle,
          [...liste].sort((a, b) => a.date_effet.localeCompare(b.date_effet))
            .map((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== ''))),
        ]),
      );
      const cleaned = {
        ...form,
        cost_grid: [...(form.cost_grid ?? [])].sort((a, b) => a.kwc - b.kwc),
        demarches: { ...form.demarches, tarifs },
      };
```

(remplace la définition existante de `cleaned`.)

Sous-titre de la page : `Paramètres du calculateur photovoltaïque, grille de coûts et démarches administratives.`

- [ ] **Step 3 : description de la tuile dans `src/lib/modules.js`**

Ligne 66, remplacer la description par : `'Paramètres de calcul, grille de coûts, véhicule électrique, bibliothèque, démarches administratives'`.

Run : `node --test scripts/modules.test.mjs`
Expected : PASS.

- [ ] **Step 4 : build + lint**

Run : `npx vite build`
Expected : build OK (vérifier qu'aucun warning n'apparaît sur `demarches/`).

Run : `npm run lint:errors`
Expected : 0 erreur. Puis `npm run lint` : pas de nouveau warning (plafond inchangé).

- [ ] **Step 5 : vérification manuelle (Eric, serveur de dev)**

Aller sur `/settings/solaire` → onglet Démarches : les 9 délais sont pré-remplis, les tarifs par défaut apparaissent (Enedis 50,10 € valide jusqu'au 27/10/2026, Consuel bleu 195,20 €, rachat 1,1 c€/kWh), le violet et le > 9 kWc sont vides avec le message ambre. Ajouter une période, enregistrer, recharger : la valeur persiste. Supprimer une période, enregistrer : persiste. Le bouton Enregistrer se désactive si une date d'effet est vide.

- [ ] **Step 6 : commit**

```bash
git add src/apps/artisan/pages/settings/solaire/DemarchesTab.jsx src/apps/artisan/pages/settings/SolaireSettings.jsx src/lib/modules.js
git commit -m "feat(settings): onglet Démarches du module Solaire — délais, tarifs datés, prise en charge des frais

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : Alignement de la spec et clôture de tranche

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-solaire-demarches-administratives-design.md` (§5.3)

- [ ] **Step 1 : aligner la forme des entrées datées dans la spec**

Dans §5.3, remplacer le bloc `tarifs: { … }` par la forme réellement implémentée (clé `valeur` unique, unité portée par `TARIFS_META`) :

```js
  tarifs: {
    // EntreeDatee = { date_effet, valeur, valide_jusqu_au?, note?, source? } ; unité par clé dans TARIFS_META
    frais_raccordement_enedis: [{ date_effet: '2026-01-01', valeur: 50.10, valide_jusqu_au: '2026-10-27', note: 'Nouveau barème au 28/10/2026 à saisir' }],
    tarif_consuel_bleu:        [{ date_effet: '2026-01-01', valeur: 195.20, source: 'Consuel 2026' }],
    tarif_consuel_violet:      [],
    tarif_oa_surplus_lte_9kwc: [{ date_effet: '2026-06-05', valeur: 1.1, source: 'Arrêté du 01/06/2026' }],
    tarif_oa_surplus_gt_9kwc:  [],
    prime_autoconsommation:    [{ date_effet: '2026-06-05', valeur: 0, note: 'Supprimée pour toute demande complète déposée à partir du 05/06/2026' }],
  },
```

Et dans §5.2, ajouter après `frais` : `consuel: 'bleu' | 'violet', enedis: 'cacsi' | 'surplus', rachat: { applicable, eligible, tarif }`.

- [ ] **Step 2 : vérification finale de tranche**

Run : `npm run audit:quality`
Expected : tout vert.

- [ ] **Step 3 : commit**

```bash
git add docs/superpowers/specs/2026-10-08-solaire-demarches-administratives-design.md
git commit -m "docs(solaire): spec démarches alignée sur l'implémentation de la tranche 1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4 : note de fin de tranche**

Rapport à Eric : fait / reste (tranche 2 = section Résultats + `pv_dossiers.demarches` + migration ; tranche 3 = PDF + mandat + signataire org) ; valeurs à renseigner dans l'onglet (Consuel violet, rachat > 9 kWc, barème Enedis du 28/10/2026, délai Consuel, durée de pose).
