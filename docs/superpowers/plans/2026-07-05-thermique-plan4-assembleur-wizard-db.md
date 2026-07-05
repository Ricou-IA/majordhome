# Module Thermique — Plan 4/5 : Assembleur, wizard, DB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'assembleur `assembleBatiment` (dessin plan 3 + données plan 1 + choix wizard → bâtiment résolu pour `calculeBatiment` du plan 2, décisions D1-D11 formalisées), le wizard 4 étapes `/thermique` (contexte, dessin, ouvertures & compositions, résultats & PAC), la persistance `majordhome.thermal_studies` + historique, la page `/settings/thermique` et le câblage app (permission, routes, sidebar).

**Architecture:** Toute la logique nouvelle en modules **purs** node-testés (`assembleBatiment.js`, `thermiqueConfig.js`, `etudeModel.js`, `wizardState.js`) ; les pages React sont des coquilles minces qui consomment ces modules + les composants canevas du plan 3. Patron app = module Solaire à l'identique (routes lazy + RouteGuard, service `{ data, error }`, hooks React Query, config org `settings.thermique`, brouillon localStorage). DB = miroir exact du pattern `pv_simulations` (RLS owner-or-admin, vue publique security_invoker updatable, GRANT service_role).

**Tech Stack:** JavaScript pur + node:test (moteurs), React 18 + Tailwind + Radix + Recharts (UI), TanStack React Query v5, Supabase (migrations via MCP `apply_migration` + copie versionnée `sql/`).

**Spec:** `docs/superpowers/specs/2026-07-03-module-thermique-deperditions-design.md` (§2, §3, §4 fin, §5, §7) · **Passation:** `docs/thermique-plan4-handoff.md` · Plans 1-3 : `docs/superpowers/plans/2026-07-0{3,4}-thermique-plan{1,2,3}-*.md`

**⚠ Contraintes d'exécution (mémoire projet)** :
- **JAMAIS de preview tools** — vérification des composants React via `npm run lint:errors` + `npx vite build` uniquement.
- Travailler sur le repo principal, branche `main`, commits fréquents (1 par tâche).
- Migrations DB : MCP Supabase `apply_migration` (instance PARTAGÉE — uniquement du SQL additif, jamais de DROP) + copie versionnée dans `sql/`.
- `thetaBasePour(...)` : ne destructurer QUE `.thetaE` (forme `{thetaE, correctionAltitude}` transitoire, redeviendra scalaire après calibration).

---

## Signatures livrées (plans 1-3) — à consommer telles quelles

```javascript
// geometryEngine.js
deduireParois(dessin) → { parois, erreurs, avertissements }
//   paroi = { pieceId, type, surfaceM2, orientation?, adjacentPieceId?, ouvertureId?,
//             meta: { niveauId, segmentIndex?, de?, a?, plancherBasType? } }
//   types : 'mur-exterieur'|'mur-lnc'|'mur-mitoyen-interne'|'plancher-bas'|'plancher-sur-exterieur'|
//           'plancher-sur-lnc'|'plafond-comble'|'plafond-sur-lnc'|'toiture-rampant'|'fenetre'|'porte'|'porte-fenetre'
//   mitoyens internes émis SEULEMENT si |Δθint| > DELTA_THETA_INTERNE (4 K)
adjacencesNiveau(pieces) → { parPiece: Map<pieceId, [{segmentIndex, de, a, longueur, adjacent}]>, erreurs }
surfaceCm2(poly), DELTA_THETA_INTERNE

// dessinOps.js — réducteurs purs (dessin, …) → { dessin, erreurs } :
// ajoutePiece, supprimePiece, deplacePiece, renommePiece, basculeChauffee, regleThetaInt,
// ajouteOuverture, supprimeOuverture, ajouteNiveau, dupliqueNiveau, supprimeNiveau, regleNord,
// regleHauteurNiveau, valideDessin(dessin) → { erreurs, avertissements } (jamais de throw)

// thermalEngine.js
calculeBatiment({ thetaExt, systemeVentilation, debitTotal, fRH, plageVraisemblance?, pieces })
//   piece = { id, nom, surface, volume, thetaInt, humide, parois: [{surface, u, deltaUtb, poste, b | thetaAdjacente}] }
// → { pieces: [{id, nom, surface, transmission, ventilation, relance, total, parPoste}],
//     total, parPoste, gv, ratioWm2, fourchette: {min, max}, alerteVraisemblance }
// gv EXCLUT la relance ; total/ratioWm2 l'INCLUENT.
POSTES = ['murs','menuiseries','plancherBas','plafondToiture','pontsThermiques','ventilation']

// heatPumpEngine.js
courbeCharge({phiTotal, thetaBase, thetaNC}) → (θ) => W
pointBivalence({pac, tDepart, charge, thetaBase, thetaNC})
// → { thetaBivalence, appointNecessaire, tauxCouverture, avertissementChargePartielle }
consoAnnuelle({gv, dju, heuresChauffage, pac, tDepart, prixKwh, facteurAjustement = 1.0})
// → { besoinKwh, thetaExtMoyenne, consoElecKwh, coutEuros, fourchette } — throw si dju null
copAt(pac, tExt, tDepart)

// refDataResolvers.js
resolvePeriode(annee) → label ; uDefautPour(uDefauts, 'mur'|'plancherBas'|'plafond'|'fenetre', annee) → U|null
thetaBasePour(climat, dept, altitude) → { thetaE, correctionAltitude } ; coefficientBPour(coefB, categorie, description) → b
chercheCommunes(communes, saisie, dept?) → [{nom, insee, dept, cp, lat, lng, altitude, dju}]

// data/index.js — statiques : climat, materiaux, paroisTypes, uDefauts, menuiseries, coefficientsB,
// ventilation, tarifsEnergie ; dynamiques : loadCommunes() (~7 Mo), loadPacCatalogue() (~4,6 Mo)

// PlanCanvas.jsx (composant contrôlé)
<PlanCanvas dessin niveauActifId selection mode onChange onSelect />
// mode : 'selection'|'rectangle'|'polygone'|'ouverture' ; onChange reçoit un dessin COMPLET neuf
```

## Décisions verrouillées (formalisation de la passation — tout écart = NEEDS_CONTEXT au contrôleur)

| # | Décision formalisée |
|---|---|
| D1 | Pièces principales (débits VMC) = pièces **chauffées** `typePiece ∈ {sejour, chambre}` ; palier table ventilation clampé à [1, 7] (T7 reconduit au-delà, cf. `_meta.notes` ventilation.json). `typePiece 'autre'` (et tout type ni principal ni humide) : ni principale ni humide. |
| D2 | Pièces humides = `typePiece ∈ {cuisine, sdb, wc, buanderie}` → `humide: true` (débit soufflé 0 en mode 'debits'). |
| D3 | U menuiseries SAISIS (pas de table par période). Défauts proposés dans l'UI via `uwDepuisComposants({ug, uf, deltaR?})` = forfait 0.7·Ug + 0.3·Uf (répartition vitrage/châssis assumée), volet : Ujn = 1/(1/Uw + ΔR). Composants depuis `menuiseries.json` (vitrages/menuiseriesTypes/volets). |
| D4 | b d'une pièce LNC résolu PAR pièce en comptant ses **murs extérieurs** (segments du polygone ayant ≥ 1 sous-segment `adjacent: null` via `adjacencesNiveau` de SON niveau). Mapping catégorie « Pièce » de coefficients-b.json (libellés exacts ci-dessous) : 0 mur → b 0.4 + avertissement ; 1 → 0.4 ; 2 sans porte ext → 0.5 ; 2 avec porte ext → 0.6 (porte ext = ouverture `type 'porte'` dessinée sur la pièce LNC) ; ≥ 3 → 0.8. Ce b s'applique à TOUTES les parois donnant sur cette pièce (murs, planchers, plafonds, menuiseries). |
| D5 | b plancher bas par `meta.plancherBasType` : `terre-plein` → b = 1 (pas d'ISO 13370 v1, assumé) ; `vide-sanitaire` → b(catégorie 'Vide sanitaire') = 0.5 ; `sous-sol` → b(catégorie 'Sous-sol') = 0.5 sans ouvertures ext / 0.8 avec (choix `contexte.sousSolAvecOuvertures`). `plancher-sur-exterieur` → b = 1. |
| D6 | ΔUtb = valeur unique par étude selon `contexte.isolation` : table org `delta_utb` = `{ 'non-isole': 0.15, iti: 0.10, ite: 0.05 }` (défauts assumés, éditables `/settings/thermique`). Appliqué à TOUTES les parois déperditives (ext, LNC, comble, planchers, menuiseries) ; **0 sur mitoyen interne**. |
| D7 | Mitoyen interne (émis si ΔT > 4 K) : U = U famille 'murs', `thetaAdjacente` = θint de la pièce adjacente, ΔUtb 0, poste 'murs'. |
| D8 | Volume pièce = surface (m²) × hauteur niveau (m) — cotes intérieures. |
| D9 | `plafond-comble` → b selon `contexte.combleIsolation` : `'isole'` → 0.7 (« Toiture isolée ») ; `'non-isole'` → 0.9 (« Autres toitures non isolée ») ; `'fortement-ventile'` → 1. `toiture-rampant` → b = 1 (U = famille plafondToiture). |
| D10 | Orientation ignorée au calcul, conservée sur la paroi résolue (plan coloré / traçabilité). |
| D11 | Menuiserie : règle UNIFORME par `adjacentPieceId` — absent → b = 1 (ext) ; pièce adjacente **chauffée** → `thetaAdjacente` = son θint (trou du brouillon comblé) ; pièce **LNC** → b de cette pièce (D4). |
| R1 | θint par défaut selon typePiece, org-configurable (`theta_int_defauts`), affecté PAR LE WIZARD à la création de pièce et au changement de type (jamais laissé null sur une pièce chauffée). |
| R2 | DJU : `commune.dju ?? djuDepartemental(communes, dept)` = **médiane** des DJU non-null du département (tranché : plus robuste que le chef-lieu, pas de table des chefs-lieux à maintenir). Résolu à la sélection de commune, stocké dans `contexte.dju`. |
| R3 | Plages de vraisemblance W/m² PAR PÉRIODE = constante app `PLAGES_VRAISEMBLANCE` (ordres de grandeur métier, garde-fou non bloquant — pas un setting org : pas d'UI à créer). |
| R4 | fRH : toggle `contexte.relance` ; valeur org `f_rh` (défaut 11 W/m²). PAC : `bilan.total` (relance incluse) → `courbeCharge` ; `bilan.gv` (relance exclue) → `consoAnnuelle` — ne JAMAIS croiser. |
| R5 | Mode « bibliothèque » des compositions = choix d'une paroi de `parois-types.json` (U direct). Le constructeur de composition par couches (materiaux.json + `calculeUParoi`) = plan 5 (écart assumé). |
| R6 | Exceptions de composition : granularité **(pieceId × famille)** pour murs/plancherBas/plafondToiture + **par ouverture** (ouvertureId) pour les menuiseries. La granularité segment est YAGNI v1 (clé instable aux éditions de géométrie). |
| R7 | Historique : une étude rouverte affiche ses **résultats persistés** (jamais de recalcul silencieux) ; bannière si `engine_version` ≠ courant + bouton « Recalculer avec le moteur actuel » explicite. |
| R8 | Permission : resource **`thermal_study`**, action `view`, seed = copie des lignes `pv_calculator` de `majordhome.role_permissions` (les 2 orgs). Le registre app-level WIP (`permissionsRegistry.js` / `app_role_permissions`) n'est PAS touché (précédent pv_calculator + interdiction CLAUDE.md de consommer prématurément). |
| R9 | `thermal_studies.org_id` = **org core** (`useAuth().organization.id`), comme `pv_simulations`. Pas de `getMajordhomeOrgId()`. |
| R10 | Brouillon localStorage `thermal-draft:${userId}` (convention P1.9), autosave debounce 1 s. |
| R11 | Régimes d'eau proposés = constante app `REGIMES_EAU = [35, 45, 55]` ; catalogue PAC par org = plan 5 (écarts assumés, aucune valeur org consommée → pas d'UI settings requise). |
| R12 | Écran résultats : palette déficience-couleur-safe (bleu → ambre pour l'échelle W/m², jamais rouge/vert — règle produit Solaire étendue). |

**Libellés exacts `coefficients-b.json` (vérifiés 2026-07-05 dans le JSON commité)** — catégorie « Pièce » : `"Avec seulement 1 mur extérieur"` (0.4), `"Avec seulement 2 murs extérieurs sans portes extérieures"` (0.5), `"Avec au moins 2 murs extérieurs et des portes extérieures"` (0.6), `"Avec au moins 3 murs extérieurs (par ex. escalier extérieur)"` (0.8) ; « Sous-sol » : `"Sans fenêtre ni porte extérieure"` (0.5), `"Avec fenêtres ou portes extérieures"` (0.8) ; « Espace sous toiture » : `"Espace sous toiture fortement ventilé sans feutre ni panneau en sous face"` (1), `"Autres toitures non isolée"` (0.9), `"Toiture isolée"` (0.7) ; « Vide sanitaire » : `"Vide sanitaire très faiblement ventilé"` (0.5).

---

### Task 1: Résolveurs complémentaires (DJU départemental, débits ventilation, Uw composants)

**Files:**
- Modify: `src/apps/thermique/lib/refDataResolvers.js`
- Modify: `scripts/thermique/ref-data-resolvers.test.mjs`

- [ ] **Step 1: Tests (ajout au fichier existant)**

```javascript
import { djuDepartemental, debitVentilationPour, uwDepuisComposants }
  from '../../src/apps/thermique/lib/refDataResolvers.js';
const ventilation = JSON.parse(readFileSync('src/apps/thermique/data/ventilation.json', 'utf8'));

test('djuDepartemental : médiane des DJU non-null du département', () => {
  const communes = [
    { nom: 'A', dept: '81', dju: 1900 }, { nom: 'B', dept: '81', dju: 2100 },
    { nom: 'C', dept: '81', dju: 2000 }, { nom: 'D', dept: '81', dju: null },
    { nom: 'E', dept: '31', dju: 1500 },
  ];
  assert.equal(djuDepartemental(communes, '81'), 2000);          // médiane impaire
  communes.push({ nom: 'F', dept: '81', dju: 2200 });
  assert.equal(djuDepartemental(communes, '81'), 2050);          // paire → moyenne des 2 centraux
  assert.throws(() => djuDepartemental(communes, '99'), /thermique/); // aucun DJU
});

test('debitVentilationPour : table réglementaire clampée [1, 7]', () => {
  assert.equal(debitVentilationPour(ventilation, 'vmc-sf-auto', 3).debitTotal, 75);
  assert.equal(debitVentilationPour(ventilation, 'vmc-sf-auto', 0).debitTotal, 35);   // clamp bas
  assert.equal(debitVentilationPour(ventilation, 'vmc-sf-auto', 12).debitTotal, 135); // T7 reconduit
  assert.equal(debitVentilationPour(ventilation, 'naturelle', 3).debitTotal, null);   // mode taux
  assert.equal(debitVentilationPour(ventilation, 'naturelle', 3).systeme.mode, 'taux');
  assert.equal(debitVentilationPour(ventilation, 'vmc-df', 4).systeme.rendement, 0.7);
  assert.throws(() => debitVentilationPour(ventilation, 'vmc-triple-flux', 3), /thermique/);
});

test('uwDepuisComposants : forfait 0.7·Ug + 0.3·Uf, volet en résistance additionnelle', () => {
  // Ug 1.1, Uf 1.5 → Uw = 0.7×1.1 + 0.3×1.5 = 0.77 + 0.45 = 1.22
  const r = uwDepuisComposants({ ug: 1.1, uf: 1.5 });
  assert.ok(Math.abs(r.uw - 1.22) < 1e-9);
  assert.equal(r.ujn, null);
  // Avec volet ΔR 0.25 : Ujn = 1/(1/1.22 + 0.25) = 1/1.06967… = 0.93487…
  const v = uwDepuisComposants({ ug: 1.1, uf: 1.5, deltaR: 0.25 });
  assert.ok(Math.abs(v.ujn - 1 / (1 / 1.22 + 0.25)) < 1e-9);
  assert.throws(() => uwDepuisComposants({ ug: 0, uf: 1.5 }), /thermique/);
});
```

- [ ] **Step 2: Run** `node --test scripts/thermique/ref-data-resolvers.test.mjs` → FAIL (exports inexistants)

- [ ] **Step 3: Implementation (ajout à refDataResolvers.js)**

```javascript
/** DJU de repli départemental = MÉDIANE des DJU non-null du département (décision plan 4 R2). */
export function djuDepartemental(communes, dept) {
  const djus = communes.filter((c) => c.dept === String(dept) && Number.isFinite(c.dju))
    .map((c) => c.dju).sort((a, b) => a - b);
  if (djus.length === 0) throw new Error(`thermique: aucun DJU disponible pour le département ${dept}`);
  const m = Math.floor(djus.length / 2);
  return djus.length % 2 ? djus[m] : (djus[m - 1] + djus[m]) / 2;
}

/**
 * Système + débit total réglementaire pour un type de ventilation et un nombre de pièces principales.
 * Palier clampé aux bornes de la table (T7 reconduit au-delà — _meta.notes ventilation.json).
 * @returns {{ systeme: object, debitTotal: number|null }} debitTotal null en mode 'taux'.
 */
export function debitVentilationPour(ventilation, systemeId, nbPiecesPrincipales) {
  const systeme = ventilation.systemes.find((s) => s.id === systemeId);
  if (!systeme) throw new Error(`thermique: système de ventilation inconnu « ${systemeId} »`);
  if (systeme.mode === 'taux') return { systeme, debitTotal: null };
  const table = ventilation.debitsExtraitsParTaille;
  const n = Math.min(Math.max(1, nbPiecesPrincipales), table[table.length - 1].piecesPrincipales);
  const row = table.find((r) => r.piecesPrincipales === n);
  return { systeme, debitTotal: row.debitTotal };
}

/**
 * Uw proposé depuis les composants menuiseries.json — forfait assumé (D3) :
 * Uw ≈ 0.7·Ug + 0.3·Uf (répartition surfacique vitrage/châssis typique), sans ψ intercalaire.
 * Volet : Ujn = 1/(1/Uw + ΔR) (résistance additionnelle fermée).
 */
export function uwDepuisComposants({ ug, uf, deltaR = null }) {
  if (!Number.isFinite(ug) || ug <= 0 || !Number.isFinite(uf) || uf <= 0) {
    throw new Error('thermique: ug et uf > 0 requis');
  }
  const uw = 0.7 * ug + 0.3 * uf;
  const ujn = Number.isFinite(deltaR) && deltaR > 0 ? 1 / (1 / uw + deltaR) : null;
  return { uw, ujn };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): résolveurs DJU départemental, débits ventilation, Uw composants"`

---

### Task 2: `thermiqueConfig.js` — types de pièce, défauts org, plages de vraisemblance

**Files:**
- Create: `src/apps/thermique/lib/thermiqueConfig.js`
- Test: `scripts/thermique/thermique-config.test.mjs`

- [ ] **Step 1: Tests**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES_PIECE, typePieceInfo, PLAGES_VRAISEMBLANCE, REGIMES_EAU,
  DIMENSIONS_OUVERTURES, DEFAULTS_THERMIQUE, buildThermiqueConfig }
  from '../../src/apps/thermique/lib/thermiqueConfig.js';

test('TYPES_PIECE : flags cohérents avec D1/D2', () => {
  const principaux = TYPES_PIECE.filter((t) => t.principale).map((t) => t.id);
  assert.deepEqual(principaux.sort(), ['chambre', 'sejour']);
  const humides = TYPES_PIECE.filter((t) => t.humide).map((t) => t.id);
  assert.deepEqual(humides.sort(), ['buanderie', 'cuisine', 'sdb', 'wc']);
  assert.equal(typePieceInfo('garage').chauffeeParDefaut, false);
  assert.equal(typePieceInfo('sejour').chauffeeParDefaut, true);
  assert.equal(typePieceInfo('inconnu').id, 'autre'); // fallback sûr
});

test('PLAGES_VRAISEMBLANCE : une plage par période 3CL, min < max, resserrées dans le temps', () => {
  const labels = ['avant 1974', '1975-1977', '1978-1982', '1983-1988', '1989-2000',
    '2001-2005', '2006-2012', 'après 2012'];
  for (const l of labels) {
    const p = PLAGES_VRAISEMBLANCE[l];
    assert.ok(p && p.min > 0 && p.min < p.max, l);
  }
  assert.ok(PLAGES_VRAISEMBLANCE['après 2012'].max < PLAGES_VRAISEMBLANCE['avant 1974'].max);
});

test('buildThermiqueConfig : défauts purs + merge org (deep sur les tables)', () => {
  const d = buildThermiqueConfig(undefined);
  assert.equal(d.theta_int_defauts.sejour, 20);
  assert.equal(d.theta_int_defauts.sdb, 24);
  assert.equal(d.delta_utb['non-isole'], 0.15);
  assert.equal(d.f_rh, 11);
  assert.equal(d.theta_non_chauffage, 16);
  assert.ok(d.prix_kwh > 0.05);
  assert.equal(d.facteur_ajustement, 1.0);
  const c = buildThermiqueConfig({ thermique: { f_rh: 22, theta_int_defauts: { chambre: 19 } } });
  assert.equal(c.f_rh, 22);
  assert.equal(c.theta_int_defauts.chambre, 19);
  assert.equal(c.theta_int_defauts.sejour, 20);   // deep merge : les autres clés survivent
  assert.equal(DEFAULTS_THERMIQUE.f_rh, 11);      // défauts jamais mutés
  assert.deepEqual(REGIMES_EAU, [35, 45, 55]);
  assert.ok(DIMENSIONS_OUVERTURES.fenetre.largeur > 0);
});
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implementation**

```javascript
// src/apps/thermique/lib/thermiqueConfig.js
// Constantes app + défauts org du module Thermique — module PUR (aucun import).
// Les valeurs org vivent dans core.organizations.settings.thermique (page /settings/thermique).
// ⚠ org_update_settings merge JSONB niveau 1 → toujours sauver l'objet `thermique` COMPLET.

/** Types de pièce (D1/D2). principale → dimensionne les débits VMC ; humide → débit soufflé 0. */
export const TYPES_PIECE = [
  { id: 'sejour',    label: 'Séjour',        principale: true,  humide: false, chauffeeParDefaut: true },
  { id: 'chambre',   label: 'Chambre',       principale: true,  humide: false, chauffeeParDefaut: true },
  { id: 'cuisine',   label: 'Cuisine',       principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'sdb',       label: 'Salle de bain', principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'wc',        label: 'WC',            principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'buanderie', label: 'Buanderie',     principale: false, humide: true,  chauffeeParDefaut: true },
  { id: 'bureau',    label: 'Bureau',        principale: false, humide: false, chauffeeParDefaut: true },
  { id: 'entree',    label: 'Entrée / dégagement', principale: false, humide: false, chauffeeParDefaut: true },
  { id: 'garage',    label: 'Garage',        principale: false, humide: false, chauffeeParDefaut: false },
  { id: 'cellier',   label: 'Cellier',       principale: false, humide: false, chauffeeParDefaut: false },
  { id: 'autre',     label: 'Autre',         principale: false, humide: false, chauffeeParDefaut: true },
];

export function typePieceInfo(id) {
  return TYPES_PIECE.find((t) => t.id === id) ?? TYPES_PIECE.find((t) => t.id === 'autre');
}

/** Garde-fou W/m² par période (R3) — ordres de grandeur métier, alerte NON bloquante. */
export const PLAGES_VRAISEMBLANCE = {
  'avant 1974': { min: 60, max: 220 },
  '1975-1977':  { min: 50, max: 180 },
  '1978-1982':  { min: 45, max: 160 },
  '1983-1988':  { min: 40, max: 140 },
  '1989-2000':  { min: 35, max: 120 },
  '2001-2005':  { min: 30, max: 110 },
  '2006-2012':  { min: 25, max: 95 },
  'après 2012': { min: 15, max: 80 },
};

export const REGIMES_EAU = [35, 45, 55]; // °C départ (R11 — constante app v1)

/** Dimensions standard proposées à la pose (cm) — modifiables dans le panneau ouverture. */
export const DIMENSIONS_OUVERTURES = {
  fenetre:        { largeur: 120, hauteur: 130 },
  'porte-fenetre': { largeur: 240, hauteur: 220 },
  porte:          { largeur: 90,  hauteur: 220 },
};

/** Défauts org (éditables /settings/thermique). θint : spec §4 (séjour 20, SdB 24…). */
export const DEFAULTS_THERMIQUE = Object.freeze({
  theta_int_defauts: Object.freeze({
    sejour: 20, chambre: 18, cuisine: 20, sdb: 24, wc: 18, buanderie: 16,
    bureau: 20, entree: 18, garage: 16, cellier: 16, autre: 19,
  }),
  delta_utb: Object.freeze({ 'non-isole': 0.15, iti: 0.10, ite: 0.05 }), // W/(m²·K), D6
  f_rh: 11,                  // W/m² (EN 12831 annexe, abaissement nocturne standard)
  theta_non_chauffage: 16,   // °C (spec §5, défaut climat.json)
  prix_kwh: 0.1952,          // €/kWh élec base (tarifs-energie.json elec-base 2025)
  facteur_ajustement: 1.0,   // conso (apports gratuits/intermittence), à calibrer phase A/B
});

/** Config effective = défauts ⊕ settings.thermique (deep merge sur les 2 tables, shallow sinon). */
export function buildThermiqueConfig(settings) {
  const org = settings?.thermique ?? {};
  return {
    ...DEFAULTS_THERMIQUE,
    ...org,
    theta_int_defauts: { ...DEFAULTS_THERMIQUE.theta_int_defauts, ...(org.theta_int_defauts ?? {}) },
    delta_utb: { ...DEFAULTS_THERMIQUE.delta_utb, ...(org.delta_utb ?? {}) },
  };
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): config module (types de pièce, défauts org, plages de vraisemblance)"`

---

### Task 3: Assembleur — b des locaux non chauffés + résolution d'une paroi

**Files:**
- Create: `src/apps/thermique/lib/assembleBatiment.js`
- Test: `scripts/thermique/assemble-batiment.test.mjs`

- [ ] **Step 1: Tests** — cibler `bLncParPiece` et `resoudParoi` (exportés pour testabilité). Fixtures : mini-dessins construits à la main (RDC garage accolé à un séjour ; garage 3 murs ext → b 0.8 ; cellier enclavé 0 mur ext → b 0.4 + avertissement ; garage 2 murs ext + porte ext dessinée → 0.6 ; sans porte → 0.5). Les b attendus sont résolus via le VRAI `coefficients-b.json` (lu par fs dans le test). Pour `resoudParoi` : une paroi de chaque type des 12 émis par `deduireParois`, avec un contexte figé (uMur 2.5, uPlancher 2.0, uPlafond 2.5, uFenetre 2.8, uPorte 3.5, ΔUtb 0.1, bLnc garage 0.8, θint chambre 18) — assertions littérales sur `{surface, u, b|thetaAdjacente, deltaUtb, poste}` :

```javascript
// Extraits d'assertions (l'implémenteur écrit le fichier complet, chaque attendu dérivé en commentaire) :
// mur-exterieur   → { u: 2.5, b: 1,   deltaUtb: 0.1, poste: 'murs' } (+ orientation conservée)
// mur-lnc garage  → { u: 2.5, b: 0.8, deltaUtb: 0.1, poste: 'murs' }
// mur-mitoyen-interne (adj chambre 18) → { u: 2.5, thetaAdjacente: 18, deltaUtb: 0, poste: 'murs' }
// fenetre ext     → { u: 2.8, b: 1, deltaUtb: 0.1, poste: 'menuiseries' }
// fenetre sur mur-lnc (adjacentPieceId garage)      → b 0.8 (D11)
// fenetre sur mitoyen émis (adjacentPieceId chambre chauffée) → thetaAdjacente 18, deltaUtb 0 (D11)
// porte avec exception ouverture { u: 2.0 }         → u 2.0 (override par ouvertureId)
// plancher-bas terre-plein → b 1 ; vide-sanitaire → b 0.5 ; sous-sol (sans ouvertures) → b 0.5
// plancher-sur-exterieur → b 1 ; plancher-sur-lnc garage → b 0.8 — poste 'plancherBas'
// plafond-comble (combleIsolation 'isole') → b 0.7 ; 'non-isole' → 0.9 ; 'fortement-ventile' → 1
// toiture-rampant → b 1 — poste 'plafondToiture'
// exception paroi `${pieceId}:murs` { u: 0.5 } → u 0.5 sur les murs de CETTE pièce seulement
// famille murs mode 'defaut' (u null) + annee 1960 → u = uDefautPour('mur', 1960) = 2.5
// menuiserie sans U (familles.fenetre.u null) → erreur listée (pas de throw)
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implementation**

```javascript
// src/apps/thermique/lib/assembleBatiment.js
// L'ASSEMBLEUR (plan 4) : dessin (plan 3) + données de référence (plan 1) + choix wizard
// → bâtiment résolu pour calculeBatiment (plan 2). Module PUR (aucun import React/Supabase ni JSON).
// Formalise D1-D11 de docs/thermique-plan4-handoff.md — chaque règle est marquée « Dn ».
import { adjacencesNiveau } from './geometryEngine.js';
import { uDefautPour, coefficientBPour } from './refDataResolvers.js';
import { typePieceInfo } from './thermiqueConfig.js';

// D4 : libellés exacts de coefficients-b.json (catégorie « Pièce »), vérifiés par test contre le JSON.
const B_PIECE = {
  0: 'Avec seulement 1 mur extérieur', // enclavé : assimilé 1 mur + avertissement
  1: 'Avec seulement 1 mur extérieur',
  2: 'Avec seulement 2 murs extérieurs sans portes extérieures',
  '2p': 'Avec au moins 2 murs extérieurs et des portes extérieures',
  3: 'Avec au moins 3 murs extérieurs (par ex. escalier extérieur)',
};
// D9 : catégorie « Espace sous toiture »
const B_COMBLE = {
  isole: 'Toiture isolée',
  'non-isole': 'Autres toitures non isolée',
  'fortement-ventile': 'Espace sous toiture fortement ventilé sans feutre ni panneau en sous face',
};

/**
 * b par pièce NON chauffée (D4) : compte ses murs extérieurs (segments du polygone ayant ≥ 1
 * sous-segment adjacent:null sur SON niveau) ; « portes extérieures » = ouverture type 'porte'
 * dessinée sur la pièce. Exporté pour tests.
 * @returns {{ bParPiece: Map<pieceId, number>, avertissements: string[] }}
 */
export function bLncParPiece(dessin, coefficientsB) {
  const bParPiece = new Map();
  const avertissements = [];
  for (const niveau of dessin.niveaux) {
    const piecesNiveau = dessin.pieces.filter((p) => p.niveauId === niveau.id);
    if (!piecesNiveau.some((p) => !p.chauffee)) continue;
    const { parPiece } = adjacencesNiveau(piecesNiveau);
    for (const piece of piecesNiveau) {
      if (piece.chauffee) continue;
      const sous = parPiece.get(piece.id) ?? [];
      const mursExt = new Set(
        sous.filter((s) => s.adjacent === null && s.longueur > 0).map((s) => s.segmentIndex)
      ).size;
      const aPorteExt = dessin.ouvertures.some((o) => o.pieceId === piece.id && o.type === 'porte');
      let cle;
      if (mursExt >= 3) cle = 3;
      else if (mursExt === 2) cle = aPorteExt ? '2p' : 2;
      else cle = mursExt; // 0 ou 1
      if (mursExt === 0) avertissements.push(`« ${piece.nom} » (non chauffée) n'a aucun mur extérieur — b minimal 0.4 appliqué`);
      bParPiece.set(piece.id, coefficientBPour(coefficientsB, 'Pièce', B_PIECE[cle]));
    }
  }
  return { bParPiece, avertissements };
}

const FAMILLE_PAR_TYPE = {
  'mur-exterieur': 'murs', 'mur-lnc': 'murs', 'mur-mitoyen-interne': 'murs',
  fenetre: 'fenetre', porte: 'porte', 'porte-fenetre': 'porteFenetre',
  'plancher-bas': 'plancherBas', 'plancher-sur-exterieur': 'plancherBas', 'plancher-sur-lnc': 'plancherBas',
  'plafond-comble': 'plafondToiture', 'plafond-sur-lnc': 'plafondToiture', 'toiture-rampant': 'plafondToiture',
};
const POSTE_PAR_FAMILLE = {
  murs: 'murs', fenetre: 'menuiseries', porte: 'menuiseries', porteFenetre: 'menuiseries',
  plancherBas: 'plancherBas', plafondToiture: 'plafondToiture',
};
const TYPE_U_DEFAUT = { murs: 'mur', plancherBas: 'plancherBas', plafondToiture: 'plafond' };

/** U résolu pour une paroi : exception ouverture > exception (pièce × famille) > famille (mode défaut/valeur). */
function uPour(paroi, famille, ctx) {
  const excO = paroi.ouvertureId != null ? ctx.compositions.exceptions?.ouvertures?.[paroi.ouvertureId] : null;
  if (excO && Number.isFinite(excO.u)) return excO.u;
  const excP = ctx.compositions.exceptions?.parois?.[`${paroi.pieceId}:${famille}`];
  if (excP && Number.isFinite(excP.u)) return excP.u;
  const fam = ctx.compositions.familles[famille] ?? {};
  if (fam.mode === 'defaut' && TYPE_U_DEFAUT[famille]) {
    return uDefautPour(ctx.uDefauts, TYPE_U_DEFAUT[famille], ctx.annee);
  }
  return Number.isFinite(fam.u) ? fam.u : null;
}

/**
 * Résout UNE paroi géométrique en paroi moteur (D3-D7, D9-D11). Exporté pour tests.
 * ctx = { annee, uDefauts, coefficientsB, compositions, deltaUtb, bParPieceLnc,
 *         thetaIntParPiece, combleIsolation, bPlancherBas }
 * @returns {{ paroi: object|null, erreur: string|null }}
 */
export function resoudParoi(paroi, ctx) {
  const famille = FAMILLE_PAR_TYPE[paroi.type];
  if (!famille) throw new Error(`thermique: type de paroi inconnu « ${paroi.type} »`);
  const u = uPour(paroi, famille, ctx);
  if (!Number.isFinite(u) || u <= 0) {
    return { paroi: null, erreur: `U manquant pour « ${famille} » (paroi ${paroi.type} de la pièce ${paroi.pieceId})` };
  }
  const base = { surface: paroi.surfaceM2, u, poste: POSTE_PAR_FAMILLE[famille],
    type: paroi.type, orientation: paroi.orientation ?? null, pieceId: paroi.pieceId };

  // Référence de température : b OU thetaAdjacente (D5, D7, D9, D11)
  if (paroi.type === 'mur-mitoyen-interne') {
    const theta = ctx.thetaIntParPiece.get(paroi.adjacentPieceId);
    return { paroi: { ...base, thetaAdjacente: theta, deltaUtb: 0 }, erreur: null }; // D7
  }
  if (famille === 'fenetre' || famille === 'porte' || famille === 'porteFenetre') {
    if (paroi.adjacentPieceId != null) {
      const thetaVoisine = ctx.thetaIntParPiece.get(paroi.adjacentPieceId);
      if (thetaVoisine != null) { // D11 : menuiserie sur mitoyen émis → θadjacente, ΔUtb 0
        return { paroi: { ...base, thetaAdjacente: thetaVoisine, deltaUtb: 0 }, erreur: null };
      }
      const bLnc = ctx.bParPieceLnc.get(paroi.adjacentPieceId) ?? 1; // D11 : menuiserie sur LNC
      return { paroi: { ...base, b: bLnc, deltaUtb: ctx.deltaUtb }, erreur: null };
    }
    return { paroi: { ...base, b: 1, deltaUtb: ctx.deltaUtb }, erreur: null };
  }
  let b = 1;
  if (paroi.type === 'mur-lnc' || paroi.type === 'plancher-sur-lnc' || paroi.type === 'plafond-sur-lnc') {
    b = ctx.bParPieceLnc.get(paroi.adjacentPieceId) ?? 1; // D4
  } else if (paroi.type === 'plancher-bas') {
    b = ctx.bPlancherBas; // D5 (résolu une fois par étude)
  } else if (paroi.type === 'plafond-comble') {
    b = coefficientBPour(ctx.coefficientsB, 'Espace sous toiture', B_COMBLE[ctx.combleIsolation] ?? B_COMBLE.isole); // D9
  }
  // 'mur-exterieur', 'plancher-sur-exterieur', 'toiture-rampant' → b 1 (D5/D9/D10)
  return { paroi: { ...base, b, deltaUtb: ctx.deltaUtb }, erreur: null };
}

/** b du plancher bas selon le type (D5). Exporté pour tests. */
export function bPlancherBasPour(coefficientsB, plancherBasType, sousSolAvecOuvertures = false) {
  if (plancherBasType === 'vide-sanitaire') {
    return coefficientBPour(coefficientsB, 'Vide sanitaire', 'Vide sanitaire très faiblement ventilé');
  }
  if (plancherBasType === 'sous-sol') {
    return coefficientBPour(coefficientsB, 'Sous-sol',
      sousSolAvecOuvertures ? 'Avec fenêtres ou portes extérieures' : 'Sans fenêtre ni porte extérieure');
  }
  return 1; // terre-plein (pas d'ISO 13370 v1 — assumé)
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): assembleur — b des LNC et résolution des parois (D3-D11)"`

---

### Task 4: Assembleur — `assembleBatiment` (orchestration complète)

**Files:**
- Modify: `src/apps/thermique/lib/assembleBatiment.js`
- Modify: `scripts/thermique/assemble-batiment.test.mjs`

- [ ] **Step 1: Contract + implementation (dans la continuité du fichier)**

```javascript
import { deduireParois, surfaceCm2 } from './geometryEngine.js';
import { resolvePeriode, thetaBasePour, debitVentilationPour } from './refDataResolvers.js';
import { PLAGES_VRAISEMBLANCE } from './thermiqueConfig.js';

/**
 * L'ASSEMBLEUR : dessin + données + choix → entrée de calculeBatiment.
 * @param {object} dessin — modèle plan 3 (le wizard a déjà affecté typePiece + thetaInt, R1)
 * @param {object} options
 *   data:        { climat, uDefauts, coefficientsB, ventilation }   (JSON du plan 1, passés en paramètres)
 *   contexte:    { dept, altitude, annee, typeVentilation, isolation, combleIsolation,
 *                  sousSolAvecOuvertures?, relance }
 *   compositions:{ familles: { murs|plancherBas|plafondToiture: {mode:'defaut'|'bibliotheque'|'saisi', u:number|null},
 *                              fenetre|porteFenetre|porte: {u:number|null} },
 *                  exceptions: { parois: {'pieceId:famille': {u}}, ouvertures: {ouvertureId: {u}} } }
 *   reglages:    { thetaIntDefauts, deltaUtb (table par isolation), fRH }   (buildThermiqueConfig)
 * @returns {{ batiment: object|null, thetaE: number|null, parois: object[], erreurs: string[], avertissements: string[] }}
 *   batiment = null si erreurs bloquantes (l'UI affiche la liste, jamais de throw pour un problème d'étude).
 *   Throws 'thermique:' réservés aux entrées malformées (programmation).
 */
export function assembleBatiment(dessin, options) {
  const { data, contexte, compositions, reglages } = options;
  const erreurs = [];
  const avertissements = [];

  // 1. Géométrie (les erreurs/avertissements du dessin remontent tels quels)
  const geo = deduireParois(dessin);
  erreurs.push(...geo.erreurs);
  avertissements.push(...geo.avertissements);

  // 2. θe — ne destructurer QUE thetaE (forme transitoire, cf. passation)
  let thetaE = null;
  try {
    thetaE = thetaBasePour(data.climat, contexte.dept, contexte.altitude).thetaE;
  } catch (e) {
    erreurs.push(e.message);
  }

  // 3. Pièces chauffées (θint obligatoire — R1)
  const chauffees = dessin.pieces.filter((p) => p.chauffee);
  if (chauffees.length === 0) erreurs.push('aucune pièce chauffée — dessinez au moins une pièce chauffée');
  const thetaIntParPiece = new Map();
  for (const p of chauffees) {
    if (!Number.isFinite(p.thetaInt)) erreurs.push(`« ${p.nom} » : température de consigne manquante`);
    else thetaIntParPiece.set(p.id, p.thetaInt);
  }

  // 4. Contexte de résolution des parois
  const { bParPiece, avertissements: avB } = bLncParPiece(dessin, data.coefficientsB);
  avertissements.push(...avB);
  const deltaUtb = reglages.deltaUtb[contexte.isolation];
  if (!Number.isFinite(deltaUtb)) erreurs.push(`type d'isolation inconnu « ${contexte.isolation} »`);
  const ctx = {
    annee: contexte.annee, uDefauts: data.uDefauts, coefficientsB: data.coefficientsB,
    compositions, deltaUtb: deltaUtb ?? 0, bParPieceLnc: bParPiece, thetaIntParPiece,
    combleIsolation: contexte.combleIsolation,
    bPlancherBas: bPlancherBasPour(data.coefficientsB, dessin.plancherBasType, contexte.sousSolAvecOuvertures),
  };

  // 5. Résolution des parois, groupées par pièce
  const paroisResolues = [];
  const paroisParPiece = new Map(chauffees.map((p) => [p.id, []]));
  const erreursU = new Set(); // dédup : 1 message par famille manquante
  for (const paroi of geo.parois) {
    if (!paroisParPiece.has(paroi.pieceId)) continue; // paroi d'une pièce non chauffée : rien à faire
    const { paroi: resolue, erreur } = resoudParoi(paroi, ctx);
    if (erreur) { erreursU.add(erreur.replace(/\(paroi .*\)$/, '').trim()); continue; }
    paroisParPiece.get(paroi.pieceId).push(resolue);
    paroisResolues.push(resolue);
  }
  erreurs.push(...erreursU);

  // 6. Ventilation (D1) : pièces principales chauffées, palier clampé
  let systemeVentilation = null;
  let debitTotal = null;
  try {
    const nbPrincipales = chauffees.filter((p) => typePieceInfo(p.typePiece).principale).length;
    ({ systeme: systemeVentilation, debitTotal } =
      debitVentilationPour(data.ventilation, contexte.typeVentilation, Math.max(1, nbPrincipales)));
  } catch (e) {
    erreurs.push(e.message);
  }

  if (erreurs.length > 0) return { batiment: null, thetaE, parois: paroisResolues, erreurs, avertissements };

  // 7. Bâtiment résolu
  const hauteurParNiveau = new Map(dessin.niveaux.map((n) => [n.id, n.hauteur]));
  const batiment = {
    thetaExt: thetaE,
    systemeVentilation,
    debitTotal,
    fRH: contexte.relance ? reglages.fRH : 0, // R4
    plageVraisemblance: PLAGES_VRAISEMBLANCE[resolvePeriode(contexte.annee)], // R3
    pieces: chauffees.map((p) => {
      const surface = surfaceCm2(p.polygone) / 10000;                       // cm² → m²
      const volume = surface * (hauteurParNiveau.get(p.niveauId) / 100);    // D8
      return { id: p.id, nom: p.nom, surface, volume, thetaInt: p.thetaInt,
        humide: typePieceInfo(p.typePiece).humide,                          // D2
        parois: paroisParPiece.get(p.id) };
    }),
  };
  return { batiment, thetaE, parois: paroisResolues, erreurs, avertissements };
}
```

- [ ] **Step 2: Test maison de référence** — reprendre la maison du plan 3 Task 6 (RDC : séjour 500×400 θ20, cuisine 300×400 accolée θ20 humide, garage 300×400 accolé non chauffé ; fenêtre séjour sud 140×120, porte d'entrée nord séjour 90×215 ; étage : chambre 500×400 θ18 posée sur le séjour, reste comble). Hypothèses : année 1960 (U défauts « avant 1974 »), isolation 'iti' (ΔUtb 0.10), Uw 1.3 / Uporte 3.5 saisis, VMC sf auto, dept '81' altitude 140 (θe −5), combleIsolation 'isole' (b 0.7), terre-plein, relance off. **Dériver le bilan attendu À LA MAIN en commentaires** (discipline plans 2-3 : chaque mur longueur × hauteur − ouvertures, chaque b, débit = 2 principales → 60 m³/h) puis asserter `assembleBatiment` → `calculeBatiment` : nombre de parois par type, 6-8 surfaces exactes, b du garage (0.8 — 3 murs ext), total et parPoste à 1e-9. Ajouter : cas **ventilation naturelle** (mode 'taux' — chemin jamais exercé, cf. passation) avec dérivation à la main des ΦV ; cas pièce chauffée sans θint → erreur listée ; cas U fenêtre null → erreur listée, batiment null.
- [ ] **Step 3: Run** `node --test scripts/thermique/assemble-batiment.test.mjs` → PASS
- [ ] **Step 4: Commit** `"feat(thermique): assembleBatiment — orchestration dessin → bâtiment résolu (D1-D11)"`

---

### Task 5: Réécriture du test d'intégration sur l'assembleur réel (obligation de passation)

**Files:**
- Rewrite: `scripts/thermique/integration-dessin-bilan.test.mjs`

- [ ] **Step 1:** Supprimer le brouillon d'assembleur local du fichier (marqué jetable en tête) et réécrire le test : même maison, mêmes hypothèses que sa version actuelle SAUF le débit de ventilation qui devient réglementaire (2 pièces principales → 60 m³/h au lieu du 90 arbitraire du brouillon — re-dériver les termes ΦV à la main, les termes de transmission sont inchangés). Chaîne testée : `deduireParois` → `assembleBatiment` → `calculeBatiment` → `courbeCharge`/`pointBivalence`/`consoAnnuelle` (PAC réelle du catalogue relue par fs, mêmes assertions qu'avant sur la cohérence gv/total — R4).
- [ ] **Step 2:** Retirer de l'en-tête la mention « brouillon à réécrire » ; la remplacer par « test d'intégration OFFICIEL de l'assembleur (plan 4) ».
- [ ] **Step 3: Run** `node --test scripts/thermique/integration-dessin-bilan.test.mjs` → PASS, puis TOUTE la suite `node --test scripts/thermique/` → PASS (aucune régression).
- [ ] **Step 4: Commit** `"test(thermique): intégration réécrite sur l'assembleur réel (fin du brouillon T10)"`

---

### Task 6: `etudeModel.js` — source de calcul unique UI ↔ (PDF plan 5)

**Files:**
- Create: `src/apps/thermique/lib/etudeModel.js`
- Test: `scripts/thermique/etude-model.test.mjs`

- [ ] **Step 1: Tests** — sur la maison de référence de Task 4 (fixture partagée : l'extraire dans `scripts/thermique/lib/fixtureMaison.mjs` exportant `dessinMaison()`, `contexteMaison()`, `compositionsMaison()` — consommée par Tasks 4, 5, 6) :

```javascript
// Assertions structurantes :
// - buildEtudeModel(...) → { ok: true, erreurs: [], bilan, thetaE: -5, parois, pac: null, engineVersion }
//   quand aucun choix PAC ; bilan identique à l'appel direct assembleBatiment+calculeBatiment (1e-9).
// - avec pac { mode: 'catalogue', pacId } + catalogue chargé : pac.bivalence.thetaBivalence ∈ [θe, θnc],
//   pac.conso.besoinKwh = 24 × dju × gv / 1000 × facteur (recalculé dans le test),
//   RÈGLE R4 vérifiée : courbeCharge reçoit bilan.total, consoAnnuelle reçoit bilan.gv.
// - avec pac { mode: 'manuelle', points: [...], scopManuel: 3.2 } : conso calculée, pas d'avertissement charge partielle.
// - pac mode catalogue SANS pacCatalogue fourni → pac: null (l'UI recalcule après le lazy import).
// - dessin invalide (pièce chauffée sans θint) → { ok: false, erreurs: [...], bilan: null }.
// - ENGINE_VERSION exporté, présent dans le retour.
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implementation**

```javascript
// src/apps/thermique/lib/etudeModel.js
// buildEtudeModel = SOURCE DE CALCUL UNIQUE (pattern Solaire) : écran résultats (plan 4) et PDF
// (plan 5) consomment le même modèle. Module PUR — les données JSON sont passées en paramètres.
import { assembleBatiment } from './assembleBatiment.js';
import { calculeBatiment } from './thermalEngine.js';
import { courbeCharge, pointBivalence, consoAnnuelle } from './heatPumpEngine.js';

export const ENGINE_VERSION = '1.0.0'; // à incrémenter à tout changement de règle de calcul

/**
 * @param {{ contexte, dessin, compositions, pac }} etude — état wizard (input jsonb persisté tel quel)
 *   pac = { regime, mode: 'catalogue'|'manuelle'|null, pacId, points, scopManuel, prixKwh }
 *   contexte porte dju (résolu à la sélection de commune — commune.dju ?? djuDepartemental, R2)
 * @param {{ config, data }} env — config = buildThermiqueConfig(settings) ;
 *   data = { climat, uDefauts, coefficientsB, ventilation, pacCatalogue? } (pacCatalogue lazy)
 * @returns {{ ok, erreurs, avertissements, thetaE, bilan, parois, pac, engineVersion }}
 *   pac = null si pas de sélection valide ou catalogue non chargé ;
 *   sinon { bivalence: {thetaBivalence, appointNecessaire, tauxCouverture, avertissementChargePartielle},
 *           conso: {besoinKwh, consoElecKwh, coutEuros, fourchette, thetaExtMoyenne} | null,
 *           consoErreur: string|null }
 */
export function buildEtudeModel(etude, { config, data }) {
  const { contexte, dessin, compositions } = etude;
  const reglages = { thetaIntDefauts: config.theta_int_defauts, deltaUtb: config.delta_utb, fRH: config.f_rh };
  const assemblage = assembleBatiment(dessin, { data, contexte, compositions, reglages });
  const base = { erreurs: assemblage.erreurs, avertissements: assemblage.avertissements,
    thetaE: assemblage.thetaE, parois: assemblage.parois, engineVersion: ENGINE_VERSION };
  if (!assemblage.batiment) return { ...base, ok: false, bilan: null, pac: null };

  const bilan = calculeBatiment(assemblage.batiment);
  const pacResolue = resolvePac(etude.pac, data.pacCatalogue);
  if (!pacResolue) return { ...base, ok: true, bilan, pac: null };

  const thetaNC = config.theta_non_chauffage;
  // R4 : total (relance incluse) → courbe de charge ; gv (relance exclue) → conso. Ne pas croiser.
  const charge = courbeCharge({ phiTotal: bilan.total, thetaBase: assemblage.thetaE, thetaNC });
  const bivalence = pointBivalence({ pac: pacResolue, tDepart: etude.pac.regime, charge,
    thetaBase: assemblage.thetaE, thetaNC });
  let conso = null;
  let consoErreur = null;
  try {
    conso = consoAnnuelle({ gv: bilan.gv, dju: contexte.dju,
      heuresChauffage: data.climat.heuresChauffage[contexte.dept],
      pac: pacResolue, tDepart: etude.pac.regime,
      prixKwh: etude.pac.prixKwh ?? config.prix_kwh,
      facteurAjustement: config.facteur_ajustement });
  } catch (e) {
    consoErreur = e.message; // ex. PAC manuelle sans scopManuel — l'UI affiche la raison
  }
  return { ...base, ok: true, bilan, pac: { bivalence, conso, consoErreur } };
}

function resolvePac(pac, pacCatalogue) {
  if (!pac || !pac.mode) return null;
  if (pac.mode === 'manuelle') {
    if (!Array.isArray(pac.points) || pac.points.length < 2) return null;
    return { type: 'manuelle', points: pac.points, scopManuel: pac.scopManuel ?? null };
  }
  if (!pacCatalogue || !pac.pacId) return null;
  return pacCatalogue.pacs.find((p) => (p.id ?? `${p.fabricant}|${p.modele}`) === pac.pacId) ?? null;
}
```

⚠ AVANT d'implémenter `resolvePac` : vérifier si les entrées de `pac-catalogue.json` portent un champ `id` (`node -e "const d=require('./src/apps/thermique/data/pac-catalogue.json'); console.log(Object.keys(d.pacs[0]))"`). S'il n'existe pas, l'identifiant canonique est `` `${p.fabricant}|${p.modele}` `` — l'utiliser partout (picker Task 14 compris) et retirer la branche `p.id`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"feat(thermique): buildEtudeModel — source de calcul unique (assemblage + bilan + PAC)"`

---

### Task 7: DB — `majordhome.thermal_studies` + vue publique + seed permission

**Files:**
- Create: `sql/migration_thermal_studies.sql` (copie versionnée des 3 migrations)
- Migrations MCP Supabase : `thermal_studies_create`, `thermal_studies_public_view`, `thermal_study_permission_seed`

⚠ Instance Supabase PARTAGÉE : SQL strictement additif. Si le MCP Supabase n'est pas joignable (auth) : STOP, écrire quand même `sql/migration_thermal_studies.sql` et remonter au contrôleur (Eric appliquera), ne PAS bloquer les tâches frontend suivantes.

- [ ] **Step 1: Migration `thermal_studies_create`** (via MCP `apply_migration`)

```sql
CREATE TABLE majordhome.thermal_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  client_id uuid REFERENCES majordhome.clients(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES majordhome.leads(id) ON DELETE SET NULL,
  title text,
  input jsonb NOT NULL,
  results jsonb,
  engine_version text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_thermal_studies_org_created ON majordhome.thermal_studies(org_id, created_at DESC);
CREATE INDEX idx_thermal_studies_client ON majordhome.thermal_studies(client_id) WHERE client_id IS NOT NULL;

ALTER TABLE majordhome.thermal_studies ENABLE ROW LEVEL SECURITY;

-- Pattern pv_simulations à l'identique : SELECT/UPDATE/DELETE = membre org ET (owner OU org_admin) ;
-- INSERT = membre org, owner forcé.
CREATE POLICY thermal_studies_select ON majordhome.thermal_studies
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = thermal_studies.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY thermal_studies_insert ON majordhome.thermal_studies
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY thermal_studies_update ON majordhome.thermal_studies
  FOR UPDATE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = thermal_studies.org_id AND m.role = 'org_admin'))
  );

CREATE POLICY thermal_studies_delete ON majordhome.thermal_studies
  FOR DELETE TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM core.organization_members m
      WHERE m.user_id = auth.uid() AND m.org_id = thermal_studies.org_id AND m.role = 'org_admin'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON majordhome.thermal_studies TO authenticated;
-- Charte multi-tenant (régression 2026-05-27) : GRANT service_role obligatoire (vue security_invoker)
GRANT SELECT ON majordhome.thermal_studies TO service_role;
```

- [ ] **Step 2: Migration `thermal_studies_public_view`**

```sql
-- Miroir simple mono-table, sans JOIN ni colonne calculée → auto-updatable (règle Bloc B)
CREATE VIEW public.majordhome_thermal_studies
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.thermal_studies;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_thermal_studies TO authenticated;
GRANT SELECT ON public.majordhome_thermal_studies TO service_role;
```

- [ ] **Step 3: Migration `thermal_study_permission_seed`** — R8 : copie du set org × rôle de `pv_calculator` :

```sql
-- Pré-contrôle : SELECT count(*) FROM majordhome.role_permissions WHERE resource = 'thermal_study'; → 0
INSERT INTO majordhome.role_permissions (org_id, role, resource, action, allowed)
SELECT org_id, role, 'thermal_study', 'view', allowed
FROM majordhome.role_permissions
WHERE resource = 'pv_calculator' AND action = 'view';
```

- [ ] **Step 4: Vérifications** (MCP `execute_sql`)

```sql
SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.thermal_studies'::regclass;            -- true
SELECT count(*) FROM pg_policies WHERE schemaname='majordhome' AND tablename='thermal_studies';    -- 4
SELECT has_table_privilege('service_role', 'majordhome.thermal_studies', 'SELECT');                -- true
SELECT is_insertable_into FROM information_schema.tables
  WHERE table_schema='public' AND table_name='majordhome_thermal_studies';                         -- YES
SELECT org_id, role, allowed FROM majordhome.role_permissions WHERE resource='thermal_study';      -- 2 orgs × rôles, mêmes allowed que pv_calculator
```

- [ ] **Step 5:** Écrire `sql/migration_thermal_studies.sql` (les 3 blocs ci-dessus + les requêtes de vérification en commentaire). **Commit** `"feat(thermique): table thermal_studies + vue publique + permission thermal_study (migrations appliquées)"`

---

### Task 8: Cache keys + service + hooks

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js`
- Create: `src/shared/services/thermal.service.js`
- Create: `src/shared/hooks/useThermalStudies.js`

- [ ] **Step 1: `thermalKeys` dans cacheKeys.js** (à côté de `pvKeys`, même style, orgId 1ᵉʳ paramètre — P0.11) :

```javascript
export const thermalKeys = {
  all: (orgId) => ['thermal', orgId],
  studies: (orgId) => [...thermalKeys.all(orgId), 'studies'],
  list: (orgId, filters) => [...thermalKeys.studies(orgId), filters],
  detail: (orgId, id) => [...thermalKeys.studies(orgId), 'detail', id],
};
```

- [ ] **Step 2: `thermal.service.js`** — miroir de `pv.service.js` :

```javascript
// src/shared/services/thermal.service.js
import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';
import { escapePostgrestSearchTerm } from '@lib/postgrestUtils';

const LIST_COLUMNS = 'id, title, status, engine_version, client_id, lead_id, results, created_at, updated_at';

export const thermalService = {
  async list({ orgId, search = '', page = 0, pageSize = 25 }) {
    return withErrorHandling(async () => {
      let query = supabase
        .from('majordhome_thermal_studies')
        .select(LIST_COLUMNS, { count: 'exact' })
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (search.trim()) {
        const term = escapePostgrestSearchTerm(search.trim());
        query = query.ilike('title', `%${term}%`);
      }
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    }, 'thermal.list');
  },

  async getById(orgId, id) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_thermal_studies')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    }, 'thermal.getById');
  },

  async create({ orgId, userId, title, clientId, leadId, input, results, engineVersion, status }) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_thermal_studies')
        .insert({
          org_id: orgId, created_by: userId, title: title || null,
          client_id: clientId || null, lead_id: leadId || null,
          input, results: results ?? null, engine_version: engineVersion, status: status ?? 'draft',
        })
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }, 'thermal.create');
  },

  async update(orgId, id, patch) {
    return withErrorHandling(async () => {
      const { data, error } = await supabase
        .from('majordhome_thermal_studies')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('org_id', orgId)
        .eq('id', id)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    }, 'thermal.update');
  },

  async remove(orgId, id) {
    return withErrorHandling(async () => {
      const { error } = await supabase
        .from('majordhome_thermal_studies')
        .delete()
        .eq('org_id', orgId)
        .eq('id', id);
      if (error) throw error;
      return true;
    }, 'thermal.remove');
  },
};
```

- [ ] **Step 3: `useThermalStudies.js`** — miroir de `usePvSimulations.js` : `useThermalStudies({ search, page })` (queryKey `thermalKeys.list`, `enabled: !!orgId`, staleTime 30 s), `useThermalStudy(id)` (detail, `enabled: !!orgId && !!id`), `useThermalStudyMutations()` → `{ createStudy, updateStudy, deleteStudy }` avec invalidation `thermalKeys.all(orgId)` en onSuccess. `updateStudy.mutationFn = ({ id, patch }) => thermalService.update(orgId, id, patch)`.
- [ ] **Step 4: Vérification** `npm run lint:errors` → 0 erreur (le build viendra avec les pages Task 9). **Step 5: Commit** `"feat(thermique): cache keys, service et hooks thermal_studies"`

---

### Task 9: Câblage app — pages stub, routes, sidebar, tuile Settings

**Files:**
- Create: `src/apps/thermique/pages/ThermiqueWizard.jsx` (stub)
- Create: `src/apps/thermique/pages/ThermiqueHistorique.jsx` (stub)
- Create: `src/apps/artisan/pages/settings/ThermiqueSettings.jsx` (stub)
- Modify: `src/apps/artisan/routes.jsx`
- Modify: `src/layouts/AppLayout.jsx`
- Modify: la page index Settings (tuiles)

- [ ] **Step 1: Stubs** — 3 pages minimales compilables (en-tête h1 + texte « en construction »), remplacées Tasks 10-15. Export default.
- [ ] **Step 2: Routes** dans `src/apps/artisan/routes.jsx` (miroir exact du bloc solaire — lazy en tête, routes à côté de `solaire`) :

```javascript
const ThermiqueWizard = lazy(() => import('@apps/thermique/pages/ThermiqueWizard'));
const ThermiqueHistorique = lazy(() => import('@apps/thermique/pages/ThermiqueHistorique'));
const ThermiqueSettings = lazy(() => import('./pages/settings/ThermiqueSettings'));
// ⚠ vérifier le style d'import des pages settings existantes (SolaireSettings) et s'y conformer.

{ path: 'thermique', element: (
    <SuspenseWrapper><RouteGuard resource="thermal_study"><ThermiqueWizard /></RouteGuard></SuspenseWrapper> ) },
{ path: 'thermique/historique', element: (
    <SuspenseWrapper><RouteGuard resource="thermal_study"><ThermiqueHistorique /></RouteGuard></SuspenseWrapper> ) },
{ path: 'settings/thermique', element: (
    <SuspenseWrapper><RouteGuard resource="settings"><ThermiqueSettings /></RouteGuard></SuspenseWrapper> ) },
```

- [ ] **Step 3: Sidebar** dans `src/layouts/AppLayout.jsx` (après la ligne Solaire, import `Thermometer` de lucide-react) :

```javascript
{ name: 'Thermique', href: '/thermique', icon: Thermometer, resource: 'thermal_study' },
```

- [ ] **Step 4: Tuile Settings** — localiser la page index Settings (`grep -rn "settings/solaire" src/apps/artisan/pages/`) ; ajouter une tuile « Thermique » (icône Thermometer, description « Défauts de calcul des études de déperditions », lien `/settings/thermique`) EXACTEMENT sur le modèle de la tuile Solaire (même condition de visibilité org_admin). S'il n'y a pas de tuile Solaire, en créer une paire cohérente avec les tuiles existantes et le signaler dans le rapport de tâche.
- [ ] **Step 5: Vérification** `npm run lint:errors` + `npx vite build` → OK. **Step 6: Commit** `"feat(thermique): routes, sidebar et tuile settings (pages stub)"`

---

### Task 10: Page `/settings/thermique` (org_admin)

**Files:**
- Rewrite: `src/apps/artisan/pages/settings/ThermiqueSettings.jsx`

- [ ] **Step 1:** Page sur le modèle EXACT de `SolaireSettings.jsx` (le lire d'abord : structure, garde `isOrgAdmin` → `<Navigate to="/settings" replace />`, `useOrgSettings()`, save par onglet avec `{ form, initial }` + `isDirty` via JSON diff, bouton disabled `!isDirty || isSaving`). 3 onglets :
  - **Températures** : une ligne par `TYPES_PIECE` chauffable (label + input number °C, bornes 5-30) éditant `theta_int_defauts`.
  - **Ponts thermiques** : 3 inputs (Non isolé / ITI / ITE, W/(m²·K), bornes 0-0.5, step 0.01) éditant `delta_utb`.
  - **Calcul** : `f_rh` (W/m², 0-50), `theta_non_chauffage` (°C, 10-20), `prix_kwh` (€/kWh, 0.05-1), `facteur_ajustement` (0.5-1.5, step 0.05).
- [ ] **Step 2:** ⚠ Sauvegarde : TOUJOURS l'objet `thermique` complet — `save({ thermique: { ...buildThermiqueConfig(settings), ...form } })` en ne persistant QUE les clés de `DEFAULTS_THERMIQUE` (pas les constantes app). Source des valeurs initiales : `buildThermiqueConfig(settings)`.
- [ ] **Step 3: Vérification** `npm run lint:errors` + `npx vite build`. **Step 4: Commit** `"feat(thermique): page settings org (θint par pièce, ΔUtb, relance, conso)"`

---

### Task 11: État du wizard (pur) + shell + étape 1 Contexte

**Files:**
- Create: `src/apps/thermique/lib/wizardState.js`
- Test: `scripts/thermique/wizard-state.test.mjs`
- Rewrite: `src/apps/thermique/pages/ThermiqueWizard.jsx`
- Create: `src/apps/thermique/components/wizard/Step1Contexte.jsx`
- Create: `src/apps/thermique/components/wizard/CommuneSearch.jsx`

- [ ] **Step 1: `wizardState.js` (TDD)** — réducteur pur + brouillon :

```javascript
// État initial (le shape EST le `input` jsonb persisté, hors champs volatils step/savedResults)
export function initialWizardState(config) {
  return {
    step: 1,
    studyId: null,
    contexte: { titre: '', clientId: null, leadId: null, commune: null, dept: null, altitude: null,
      dju: null, djuFallback: false, annee: null, typeVentilation: 'vmc-sf-auto',
      isolation: 'non-isole', combleIsolation: 'isole', sousSolAvecOuvertures: false, relance: false },
    dessin: { nord: 0, plancherBasType: 'terre-plein', toitureType: 'comble',
      niveaux: [{ id: 'rdc', nom: 'RDC', hauteur: 250 }], pieces: [], ouvertures: [] },
    compositions: {
      familles: { murs: { mode: 'defaut', u: null }, plancherBas: { mode: 'defaut', u: null },
        plafondToiture: { mode: 'defaut', u: null },
        fenetre: { u: 2.8 }, porteFenetre: { u: 2.8 }, porte: { u: 3.5 } },
      exceptions: { parois: {}, ouvertures: {} },
    },
    pac: { regime: 45, mode: null, pacId: null, points: [], scopManuel: null, prixKwh: config.prix_kwh },
    savedResults: null, // { results, engineVersion } d'une étude rouverte (R7)
  };
}
// Actions du réducteur (chacune testée : nominal + immutabilité via Object.freeze du state d'entrée) :
// LOAD {state} · SET_STEP {step} · PATCH_CONTEXTE {patch} · SET_COMMUNE {commune, dju, djuFallback}
//   (pose commune + dept + altitude + dju d'un coup) · SET_DESSIN {dessin} · PATCH_COMPOSITIONS {patch}
//   (merge familles) · SET_EXCEPTION_PAROI {cle, u|null} · SET_EXCEPTION_OUVERTURE {ouvertureId, u|null}
//   (null = retire l'exception) · PATCH_PAC {patch} · LOAD_STUDY {study, config} (hydrate depuis
//   input + savedResults, studyId) · RESET {config}
// Brouillon : draftKey(userId) = `thermal-draft:${userId}` ; loadDraft / saveDraft / clearDraft
// (pattern Solaire : try/catch, logger.warn si illisible).
// toStudyInput(state) → { contexte, dessin, compositions, pac } (strip step/studyId/savedResults).
```

- [ ] **Step 2: Run** `node --test scripts/thermique/wizard-state.test.mjs` → PASS après implémentation.
- [ ] **Step 3: Shell `ThermiqueWizard.jsx`** (pattern Simulateur.jsx lu au préalable) : wrapper externe `useOrgSettings()` → `<WizardInner config={buildThermiqueConfig(settings)} />` ; inner : `useReducer`, chargement brouillon au mount, autosave debounce 1 s, param `?etude=<id>` → `useThermalStudy(id)` → `LOAD_STUDY` ; param `?client=<id>` → pré-remplissage (Step 4 ci-dessous). Stepper 4 étapes (barre de progression + titres « Contexte · Dessin · Ouvertures & compositions · Résultats »), navigation Précédent/Suivant. **Gating** : étape 2 requiert `contexte.dept`, étape 4 requiert `valideDessin(dessin).erreurs.length === 0` ET ≥ 1 pièce chauffée (passation) — bouton Suivant disabled avec tooltip raison.
- [ ] **Step 4: `Step1Contexte.jsx`** :
  - `CommuneSearch` : autocomplete sur `loadCommunes()` (import dynamique au premier focus, spinner), `chercheCommunes(communes, saisie)` limité à 20 résultats (nom + dept + altitude) ; sélection → `SET_COMMUNE` avec `dju: commune.dju ?? djuDepartemental(communes, commune.dept)` et `djuFallback: commune.dju == null`.
  - Affichage dérivés : θe (via `thetaBasePour` — que `.thetaE`, try/catch → message), altitude (input éditable), DJU (+ badge « estimation départementale » si fallback).
  - Champs : titre, année de construction (input number, vide accepté → « avant 1974 » affiché via `resolvePeriode`), type de ventilation (select depuis `ventilation.systemes`), isolation des murs (select Non isolé/ITI/ITE — défaut auto : `annee >= 1975 ? 'iti' : 'non-isole'` au premier remplissage de l'année uniquement), type de comble si `toitureType === 'comble'` (select D9), type de plancher bas (select terre-plein/vide-sanitaire/sous-sol → écrit `dessin.plancherBasType` via SET_DESSIN ; si sous-sol : checkbox « avec fenêtres/portes extérieures »), toggle relance.
  - Pré-remplissage client : si `?client=<id>`, récupérer le client via le service clients existant (vérifier l'export : `grep -n "getById\|getClientById" src/shared/services/clients.service.js`) → titre `Étude thermique — ${nom}`, recherche commune pré-remplie avec sa ville. En cas d'échec : silencieux (logger.warn), l'utilisateur saisit à la main.
- [ ] **Step 5: Vérification** `npm run lint:errors` + `npx vite build`. **Step 6: Commit** `"feat(thermique): wizard — état pur, shell 4 étapes et contexte (commune, θe, DJU)"`

---

### Task 12: Étape 2 — Dessin (canevas câblé + dette ciblée du plan 3)

**Files:**
- Create: `src/apps/thermique/components/wizard/Step2Dessin.jsx`
- Create: `src/apps/thermique/components/wizard/PieceInspector.jsx`
- Create: `src/apps/thermique/components/wizard/CanvasErrorBoundary.jsx`
- Modify: `src/apps/thermique/components/canvas/PlanCanvas.jsx` (prop `piecesEnErreur` + `useId`)
- Modify: `src/apps/thermique/pages/ThermiqueWizard.jsx` (montage étape 2)

- [ ] **Step 1: `Step2Dessin.jsx`** — layout : barre de niveaux en haut (onglets niveaux + « + Niveau » (`ajouteNiveau`) + « Dupliquer » (`dupliqueNiveau`) + input hauteur cm (`regleHauteurNiveau`) + suppression (`supprimeNiveau`, ConfirmDialog si le niveau a des pièces)) ; barre d'outils modes (Sélection / Rectangle — le mode 'ouverture' vit à l'étape 3, le mode 'polygone' n'est pas exposé v1) ; `<PlanCanvas>` au centre (via `CanvasErrorBoundary`) ; panneau droit = `PieceInspector` (pièce sélectionnée) ou liste erreurs/avertissements de `valideDessin(dessin)` (recalculée debounce 300 ms).
- [ ] **Step 2: Création de pièce routée (R1)** — `onChange` du canevas : détecter la pièce ajoutée (id absent de l'état précédent) ; lui appliquer immédiatement les défauts AVANT de committer l'état : `typePiece: 'autre'`, `chauffee: typePieceInfo('autre').chauffeeParDefaut`, `thetaInt: config.theta_int_defauts.autre`, nom auto « Pièce N » ; puis la sélectionner (ouvre l'inspecteur). Tout passe par `SET_DESSIN` (le dessin reste la source unique).
- [ ] **Step 3: `PieceInspector.jsx`** — nom (input → `renommePiece`), type (select `TYPES_PIECE` → au changement : `thetaInt` re-défauté depuis config + `chauffee` re-défauté SEULEMENT si l'utilisateur ne les a pas déjà édités à la main — tenir un flag local), chauffée (switch → `basculeChauffee`), θint (input number 5-30 → `regleThetaInt`, masqué si non chauffée), surface m² (lecture seule via `surfaceCm2/10000`), bouton Supprimer (ConfirmDialog → `supprimePiece`). Toutes les ops via `dessinOps` — si `erreurs` retournées : toast.error + état inchangé.
- [ ] **Step 4: Dette canevas ciblée** (passation) : (a) prop optionnelle `piecesEnErreur` (Set d'ids, défaut vide) sur PlanCanvas, transmise à `PieceShape` (`enErreur`) — le wizard la calcule : pièces dont `validePolygone(polygone).length > 0` ∪ pièces chauffées sans `thetaInt` (approximation honnête, les messages détaillés restent dans le panneau) ; (b) `CanvasErrorBoundary` (class component, fallback : encart « Le plan n'a pas pu être affiché » + bouton réessayer) ; (c) remplacer les ids statiques de `<pattern>` SVG par `useId` (multi-instance étape 2 + résultats). Le reste de la dette (centroïde L/U, ré-édition d'ouverture, a11y RoseNord, mode polygone) reste au plan 5 — le NOTER dans le rapport de tâche, pas l'embarquer.
- [ ] **Step 5: Vérification** `npm run lint:errors` + `npx vite build`. **Step 6: Commit** `"feat(thermique): wizard — étape dessin (niveaux, inspecteur de pièce, erreurs live)"`

---

### Task 13: Étape 3 — Ouvertures & compositions

**Files:**
- Create: `src/apps/thermique/components/wizard/Step3OuverturesCompositions.jsx`
- Create: `src/apps/thermique/components/wizard/CompositionFamille.jsx`
- Create: `src/apps/thermique/components/wizard/UwHelperModal.jsx`
- Modify: `src/apps/thermique/pages/ThermiqueWizard.jsx` (montage étape 3)

- [ ] **Step 1: Volet ouvertures** — `<PlanCanvas mode="ouverture">` + sélecteur de type au-dessus (fenêtre / porte-fenêtre / porte, dimensions pré-remplies depuis `DIMENSIONS_OUVERTURES`, inputs largeur/hauteur cm éditables). Au tap sur un mur, le canevas produit la pose — vérifier son contrat réel (lire l'en-tête PlanCanvas : si le canevas n'émet qu'une sélection `{type:'pose-ouverture', pieceId, segmentIndex, position}`, appliquer `ajouteOuverture` avec le type/dims choisis + id `crypto.randomUUID()`). Liste des ouvertures du niveau (type, dimensions, pièce porteuse, bouton supprimer → `supprimeOuverture`, input U d'exception → `SET_EXCEPTION_OUVERTURE`).
- [ ] **Step 2: Volet compositions par famille** — 3 × `CompositionFamille` (murs, plancher bas, plafond/toiture) : radio 3 modes — « Défaut période » (affiche le U résolu : `uDefautPour(uDefauts, type, annee)` + label période), « Bibliothèque » (select sur `paroisTypes.parois` filtrées par famille — inspecter d'abord les valeurs distinctes : `node -e "const d=require('./src/apps/thermique/data/parois-types.json'); console.log([...new Set(d.parois.map(p=>p.famille))])"` ; mapper murs ↔ familles contenant 'Mur', plancher ↔ 'Plancher', plafond/toiture ↔ le reste pertinent ; le U de la paroi choisie remplit `u`), « U saisi » (input). Menuiseries : 3 inputs U (fenêtre / porte-fenêtre / porte) + bouton « Proposer depuis les composants » → `UwHelperModal` (selects vitrage × menuiserie × volet optionnel depuis `menuiseries.json` → `uwDepuisComposants` → affiche Uw et Ujn, bouton « Utiliser Uw » / « Utiliser Ujn »).
- [ ] **Step 3: Exceptions par pièce** — tableau replié (`<details>`) : lignes = pièces chauffées, colonnes = murs / plancher / plafond, cellule = input U optionnel (`SET_EXCEPTION_PAROI` clé `${pieceId}:${famille}`, vider = retirer). Mention : « Le U saisi remplace le réglage global pour cette pièce » (R6).
- [ ] **Step 4: Vérification** `npm run lint:errors` + `npx vite build`. **Step 5: Commit** `"feat(thermique): wizard — ouvertures et compositions (3 modes U, exceptions)"`

---

### Task 14: Étape 4 — Résultats & PAC + sauvegarde DB

**Files:**
- Create: `src/apps/thermique/components/wizard/Step4Resultats.jsx`
- Create: `src/apps/thermique/components/wizard/PlanResultats.jsx`
- Create: `src/apps/thermique/components/wizard/PacSection.jsx`
- Modify: `src/apps/thermique/pages/ThermiqueWizard.jsx` (montage étape 4 + sauvegarde)

- [ ] **Step 1: Calcul** — `const model = useMemo(() => buildEtudeModel(toStudyInput(state), { config, data: { climat, uDefauts, coefficientsB, ventilation, pacCatalogue } }), [state.contexte, state.dessin, state.compositions, state.pac, pacCatalogue])`. `pacCatalogue` : `useState(null)` + `loadPacCatalogue()` déclenché à l'ouverture de la section PAC (spinner). Si `model.ok === false` : panneau erreurs (liste) + renvoi vers l'étape fautive. **Étude rouverte (R7)** : si `state.savedResults` non null → afficher `savedResults.results` (mêmes composants, données figées) + bannière « Étude enregistrée avec le moteur v{X} » (variant warning si ≠ `ENGINE_VERSION`) + bouton « Recalculer avec le moteur actuel » (→ vide `savedResults`, bascule sur le calcul live).
- [ ] **Step 2: Synthèse** — cartes : Φtotal (kW, 1 déc.) + fourchette `min–max` W ; W/m² + badge alerte si `alerteVraisemblance` (« hors plage {min}-{max} W/m² pour {période} — vérifier la saisie », ambre, non bloquant) ; θe + dept ; décomposition par poste (Recharts `BarChart` horizontal, un bar par clé de `bilan.parPoste`, libellés FR : Murs / Menuiseries / Plancher bas / Plafond & toiture / Ponts thermiques / Ventilation / Relance).
- [ ] **Step 3: `PlanResultats.jsx`** — SVG lecture seule PAR NIVEAU (pas de PlanCanvas : composant dédié minimal) : polygones des pièces chauffées remplis selon W/m² de la pièce (échelle bleu `#3b82f6` → ambre `#f59e0b`, interpolation linéaire min-max du bâtiment — JAMAIS rouge/vert, R12), pièces LNC hachurées gris, label centroïde « nom · NNN W » (formatage `Math.round`), viewBox via `boiteEnglobante`. Tableau par pièce sous le plan : colonnes Pièce / Surface / Transmission / Ventilation / Relance (si fRH > 0) / **Total W**.
- [ ] **Step 4: `PacSection.jsx`** — régime d'eau (segmented control `REGIMES_EAU`), source machine : « Catalogue » (search input filtrant `pacs` par `fabricant + modele` normalisés, génériques en tête, affiche COP à +7/35 via `copAt` ; sélection → `PATCH_PAC {pacId}`) ou « Saisie constructeur » (éditeur de points `{tExt, pTh}` — min 2 lignes, + `scopManuel` input requis pour la conso) ; prix kWh (input, défaut config). Résultats : bivalence °C + appoint W + taux de couverture % ; bannière info si `avertissementChargePartielle` (« Puissances catalogue = points EN 14825 à charge partielle, pas la capacité maximale ») ; conso : besoin kWh, élec kWh, €/an + fourchette — si `consoErreur` : encart expliquant (ex. SCOP manquant). Graphique bivalence : Recharts `LineChart`, X = θext de `thetaE − 2` à `thetaNC`, 2 séries (charge via `courbeCharge` re-échantillonnée, P_th via `pThAt` ou interpolation des points manuels), ligne verticale au point de bivalence.
- [ ] **Step 5: Sauvegarde** — boutons « Enregistrer (brouillon) » / « Terminer l'étude » : payload `{ title: contexte.titre, clientId, leadId, input: toStudyInput(state), results: resultsPersistables(model), engineVersion: ENGINE_VERSION, status: 'draft'|'completed' }` via `createStudy` (puis `LOAD_STUDY`-léger : mémoriser `studyId`) ou `updateStudy` si `studyId`. `resultsPersistables(model)` = `{ bilan, thetaE, pac }` (pas les parois : re-dérivables de `input`). Toast succès ; « Terminer » : `clearDraft(userId)` + navigation `/thermique/historique`. `{ error }` toujours vérifié (toast.error).
- [ ] **Step 6: Vérification** `npm run lint:errors` + `npx vite build`. **Step 7: Commit** `"feat(thermique): wizard — résultats (plan coloré, postes, PAC, conso) et sauvegarde"`

---

### Task 15: Historique + réouverture

**Files:**
- Rewrite: `src/apps/thermique/pages/ThermiqueHistorique.jsx`

- [ ] **Step 1:** Page sur le modèle de `Historique.jsx` (Solaire) : `useThermalStudies({ search: debouncedSearch, page })` (SearchBar sur le titre + pagination `DEFAULT_PAGE_SIZE` du service), tableau : Titre / Statut (badge draft = « Brouillon » ambre, completed = « Terminée » émeraude) / Total (depuis `results.bilan.total`, `—` si null) / Moteur (`engine_version`) / Modifiée le (`formatDateShortFR`) / actions. Actions : « Ouvrir » → `navigate('/thermique?etude=' + id)` ; « Supprimer » → ConfirmDialog destructive → `deleteStudy` + toast. Bouton en-tête « Nouvelle étude » → `/thermique` (le wizard repart du brouillon ou vierge). Empty state propre.
- [ ] **Step 2:** Côté wizard (déjà posé Task 11) : vérifier le flux `?etude=` de bout en bout à la lecture du code — `LOAD_STUDY` hydrate `contexte/dessin/compositions/pac` depuis `input`, `savedResults` depuis `results` + `engine_version`, `step: 4`.
- [ ] **Step 3: Vérification** `npm run lint:errors` + `npx vite build`. **Step 4: Commit** `"feat(thermique): historique des études (liste, réouverture, suppression)"`

---

### Task 16: Vérifications finales

- [ ] **Step 1:** Suite complète : `node --test scripts/thermique/` → 100 % PASS (y compris les tests plans 1-3 : non-régression).
- [ ] **Step 2:** `npm run lint:errors` → 0 erreur ; `npm run lint` → pas de NOUVEAU warning (max-warnings est un garde-fou CI).
- [ ] **Step 3:** `npx vite build` → OK ; contrôler dans la sortie que `communes.json` et `pac-catalogue.json` sont des chunks séparés (import dynamique) et ne sont PAS dans le chunk principal.
- [ ] **Step 4:** `npm run audit:quality` (lint:errors + dead-code) — tout fichier créé par ce plan doit avoir au moins un importeur.
- [ ] **Step 5:** Commit final si des retouches ont eu lieu : `"chore(thermique): vérifications finales plan 4"`. Rapport de fin : ce qui est livré, les écarts assumés (R5, R11, dette canevas restante, PDF/fiche client/validation A/B = plan 5), et les points à valider à la main par Eric (parcours wizard complet sur son serveur de dev, RLS en conditions réelles).

---

## Self-review (fait à la rédaction)

- **Couverture passation** : D1-D11 formalisées (table + code Task 3/4) ✅ · θint par défaut org + affectation wizard R1 ✅ (T2/T12) · θe `.thetaE` seulement ✅ (T4, rappel en tête) · `djuPour` fallback départemental R2 ✅ (T1, médiane tranchée) · plages vraisemblance R3 ✅ (T2/T4) · fRH org + ventilation naturelle exercée ✅ (T4/T5) · PAC total vs gv R4 ✅ (T6, testé) · avertissement charge partielle + scopManuel ✅ (T14) · ≥ 1 pièce chauffée avant calcul ✅ (T4 erreur + T11 gating) · réécriture test intégration ✅ (T5) · dette canevas : enErreur/boundary/useId embarqués (T12), reste signalé plan 5 ✅.
- **Couverture spec** : §2 (routes, permission, sidebar, config org, /settings/thermique) ✅ T7/T9/T10 · §3 (table, RLS, vue, service, hook, keys, draft, XOR libre client/lead) ✅ T7/T8/T11 · §7 (4 écrans, sauvegarde continue, historique) ✅ T11-T15 · §4 fin (loi d'émission radiateurs 35/45/55) → **plan 5, écart assumé** (déjà noté au plan 2 ; la puissance par pièce est livrée) · §6 compositions globales + exceptions ✅ T13 (granularité R6 assumée) · §8 PDF + fiche client + §10 validation A/B → plan 5.
- **Placeholders** : les tâches moteurs (1-6) ont code + tests complets ou contrats verrouillés avec assertions littérales à dériver à la main (discipline plans 1-3). Les tâches React (10-15) spécifient fichiers, états, contrats et comportements exhaustifs sans JSX intégral — assumé : pas d'infra de test React, la revue inter-tâches du contrôleur et build+lint font foi, et le patron Solaire (lu en Step 1 de chaque tâche) fournit le gabarit exact.
- **Cohérence de types** : `assembleBatiment` consomme les 12 types exacts de `deduireParois` (T3 les couvre tous) ; `batiment` produit = signature exacte de `calculeBatiment` ; `toStudyInput` = `input` jsonb = ce que `LOAD_STUDY` hydrate ; `thermalKeys`/service/hooks alignés sur le trio pvKeys/pvService/usePvSimulations ; libellés coefficients-b transcrits du JSON commité (re-vérifiés par les tests T3 contre le fichier réel).
- **Risques identifiés** : (a) contrat de pose d'ouverture du canevas (T13 Step 1 impose de lire l'en-tête avant de câbler) ; (b) champ `id` du catalogue PAC (T6 impose la vérification) ; (c) MCP Supabase indisponible (T7 a un chemin de repli) ; (d) familles `parois-types.json` (T13 impose l'inspection).
