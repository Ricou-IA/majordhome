# Thermique — Retrait du dessin, ouvertures multiples, θe forcée, foisonnement projet

> **Statut** : design validé (Eric, 2026-07-15) — implémentation en cours.
> **Périmètre** : 4 changements (A/B/C/D) sur la couche de saisie et l'assembleur paramétrique.
> **Intact** : moteur physique (`thermalEngine`, `heatPumpEngine`) et dimensionnement PAC — zéro régression, tests existants verts.

## Contexte

Le module a déjà basculé (spec 2026-07-09) en **saisie paramétrique par pièce**. Il subsiste un
**dessin d'emprise au sol par niveau** + un panneau de **réconciliation** (somme des pièces vs
emprise dessinée) qui « perturbe la logique » sans apporter au bilan. Retours terrain Eric :

1. Supprimer tout le dessin ; garder la liste de pièces paramétriques telle quelle.
2. Gérer **plusieurs ouvertures par pièce avec des U différents** (couvre aussi le besoin
   « exceptions menuiserie » : il n'existait aucune UI pour un U d'ouverture par pièce — les
   exceptions **murs/plancher/plafond** fonctionnent déjà au niveau moteur).
3. Pouvoir **forcer manuellement θe** (la correction d'altitude reste non calibrée, cf.
   `docs/thermique-calibration-altitude.md`).
4. Rendre le **foisonnement émetteur éditable par projet** (aujourd'hui seulement réglage org,
   défaut 1,0 → invisible).

## A — Retrait du dessin

- **Étape 2** (`Step2EmprisePieces`) : suppression du `EmpriseCanvas` et du `PanneauCoherence`.
  La barre de niveaux (nom / hauteur / +/−), le `PiecesTable`, les compositions (U murs/plancher/
  plafond), les U menuiseries et les exceptions par pièce **restent**.
- **Modèle** : le niveau perd son sous-objet `emprise` (`defautSaisie` : `{ id, nom, rang, hauteur }`).
  Les études existantes qui portent un `emprise` sont tolérées (champ ignoré, jamais lu).
- **Libellés** : étape « Emprise & pièces » → « Pièces » (`ThermiqueWizard.STEPS`) ; bouton
  d'erreur « Retourner au dessin » → « Retourner à la saisie » (`Step4Resultats`).
- **Code mort** signalé pour retrait (spawn_task, hors commit — Posture #3) : `EmpriseCanvas.jsx`,
  `PanneauCoherence.jsx`, `reconciliationEmprise.js` (+ son test), `empriseDerives` dans
  l'assembleur.

## B — Ouvertures multiples par pièce (U différents)

**Modèle** — la pièce remplace le couple unique par une liste :

```js
// AVANT : surfaceOuverture: 3.2, typeMenuiserie: 'fenetre'
// APRÈS :
ouvertures: [
  { id, type: 'fenetre',      surface: 2.4, u: null },  // u null → hérite du défaut global du type
  { id, type: 'porte',        surface: 1.8, u: 3.5  },  // u renseigné → override par ouverture
]
```

- `type` ∈ `fenetre | porteFenetre | porte` ; `surface` en m² ; `u` optionnel (null = défaut global
  de la famille du type, via `compositions.familles[type].u`).
- **Assembleur** (`paroisPieceParametrique`) :
  - `surfOuvTotale = Σ ouverture.surface`
  - mur extérieur net = `mlMurExterieur/100 × H − surfOuvTotale` (garde-fou < 0 inchangé, message
    « surface d'ouverture (X m²) supérieure au mur extérieur déclaré » avec X = total).
  - une paroi menuiserie **par ouverture**, `u = ouverture.u ?? resoudUFamille(type)`, `b = 1`,
    poste `menuiseries`. `surface ≤ 0` ignorée ; `u` non résolu → erreur pièce.
- **Migration douce** : helper `normaliseOuvertures(piece)` → si `piece.ouvertures` absent mais
  `surfaceOuverture > 0`, produit `[{ type: typeMenuiserie ?? 'fenetre', surface: surfaceOuverture,
  u: null }]`, sinon `[]`. Appliqué défensivement dans l'assembleur et à l'hydratation (`LOAD_STUDY`,
  restauration brouillon). Les nouvelles pièces naissent avec `ouvertures: []` (sans
  `surfaceOuverture`/`typeMenuiserie`).
- **UI** (`PiecesTable`) : la colonne unique « Ouverture (m²) » + « Menuiserie » devient une cellule
  **repliable** par pièce affichant un résumé (`n ouv. · X,X m²`) ; dépliée = liste éditable
  `{ type (select) · surface (m²) · U (défaut du type, éditable) · supprimer }` + « ajouter une
  ouverture ».
- Les défauts globaux de U menuiserie (`fenetre/porteFenetre/porte`) et l'aide `UwHelperModal`
  restent (pré-remplissage). Les exceptions **murs/plancher/plafond** restent (vérifiées end-to-end).

## C — Forçage manuel de θe

- **État** : `contexte.thetaEForce` (number|null, défaut null).
- **UI** (`Step1Contexte`) : le champ « Température de base θe » (aujourd'hui lecture seule) devient
  **éditable**. Valeur affichée = `thetaEForce ?? θe départementale dérivée`. Saisie → pose
  `thetaEForce` ; champ vidé ou bouton « ↺ auto » → `thetaEForce = null` (retour à la valeur
  départementale). Hint « auto : {dérivée} °C » quand forcé.
- **Assembleur** : si `Number.isFinite(contexte.thetaEForce)` → `thetaE = thetaEForce` (bypass
  `thetaBasePour`, donc marche même si la table climat manque) ; sinon comportement actuel.

## D — Foisonnement par projet

- **État** : `foisonnement` au niveau racine (init = `config.foisonnement_emetteur`), persisté dans
  l'input jsonb. Action reducer `SET_FOISONNEMENT`. `LOAD_STUDY` : `input.foisonnement ?? défaut`.
- **`etudeModel`** : `foisonnement = Number.isFinite(etude.foisonnement) ? etude.foisonnement :
  config.foisonnement_emetteur` (défaut org = repli). Appliqué comme aujourd'hui
  (`puissanceEmetteur = p.total × foisonnement`).
- **UI** (`Step4Resultats`, mode live uniquement) : champ éditable [1 – 1,5] pré-rempli, près de la
  section « Déperditions par pièce ». Mode figé (R7) : le `puissanceEmetteur` enregistré fait foi,
  pas d'édition. Le réglage org reste le défaut à la création (inchangé dans `ThermiqueSettings`).

## Modèle de données (diffs d'état persisté)

`toStudyInput` (input jsonb `thermal_studies`) :
- `saisie.niveaux[].emprise` : plus créé (toléré à la lecture).
- `saisie.pieces[].ouvertures[]` remplace `surfaceOuverture`/`typeMenuiserie`.
- `contexte.thetaEForce` (nullable) ajouté.
- `foisonnement` (racine) ajouté.
- La purge des exceptions orphelines de `toStudyInput` est **conservée** (fonctionne).

## Tests (node --test, modules purs)

- `assemble-batiment-parametrique.test.mjs` : plusieurs ouvertures (somme surfaces, U par ouverture,
  U hérité vs override, mur net, garde-fou total > mur) ; override `thetaEForce`.
- `etude-model.test.mjs` : `foisonnement` projet prioritaire sur config ; **exception murs
  end-to-end** via `buildEtudeModel` (le poste murs change quand une exception est posée).
- `wizard-state.test.mjs` : `foisonnement` dans `toStudyInput` ; `normaliseOuvertures` ; hydratation
  `thetaEForce`.
- Moteur physique non retouché → tests existants inchangés (garde-fou de non-régression).

## Compat & code mort

Volumétrie d'études réelles quasi nulle (module livré 2026-07-06). Migration douce (helper
`normaliseOuvertures` + champs optionnels) → aucune étude ne casse. Code géométrique legacy
(`assembleBatiment`, `geometryEngine`, `dessinOps`, `EmpriseCanvas`, `PanneauCoherence`,
`reconciliationEmprise`) conservé pour le recalcul des anciennes études, signalé pour retrait.
