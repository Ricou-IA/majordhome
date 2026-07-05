# Module Thermique — Passation plans 1-3 → plan 4 (assembleur, wizard, DB)

> Consolidé à la clôture du plan 3 (2026-07-05, revue finale `a33d9df..16ec04b`). Ce document liste
> **toutes les décisions que l'assembleur du plan 4 doit formaliser** — collectées depuis les
> `_meta.note` du plan 1, les JSDoc des moteurs du plan 2, les revues du plan 3 et le brouillon
> d'assembleur (`scripts/thermique/integration-dessin-bilan.test.mjs`, marqué jetable : à réécrire
> sur l'assembleur réel dès qu'il existe).

## L'assembleur (`assembleBatiment`) — décisions D1-D11 + mappings

| # | Décision | Brouillon T10 | À formaliser au plan 4 |
|---|---|---|---|
| D1 | Pièces principales (ventilation) | chauffées `typePiece ∈ {sejour, chambre}`, palier `Math.min(7, n)` | + classer `typePiece: 'autre'` (défaut du canevas) : ni principale ni humide aujourd'hui |
| D2 | Pièces humides | `{cuisine, sdb, wc, buanderie}` (débit soufflé 0) | reconduire |
| D3 | U menuiseries | Uw/Uporte SAISIS (aucune table par période — `uDefautPour('fenetre')` = null par conception) | défauts proposés depuis `menuiseries.json` (composants Ug/Uf/ΔR) |
| D4 | b du LNC | figé 0.8 | résoudre PAR pièce LNC (compter ses murs ext ou demander à l'UI) via `coefficientBPour` (contrat par libellé) |
| D5 | b plancher bas | b=1 partout, U tabulé tel quel | résoudre par `meta.plancherBasType` : terre-plein 1 (pas d'ISO 13370 v1), vide-sanitaire 0.5, sous-sol 0.5/0.8 — ou assumer b=1 explicitement |
| D6 | ΔUtb (ponts thermiques) | 0.1 uniforme (ext + LNC, menuiseries incluses), 0 internes | table org selon type d'isolation ITI/ITE/non-isolé (spec §4), éditable `/settings/thermique` |
| D7 | Mitoyen interne | U mur tabulé année du bâti, `thetaAdjacente`, ΔUtb 0 | reconduire ; seuil d'émission = `DELTA_THETA_INTERNE` (4 K, géométrie) |
| D8 | Volume pièce | surface × hauteur niveau (cotes intérieures) | reconduire |
| D9 | b comble/rampant | comble → 'Espace sous toiture'/'Toiture isolée' 0.7 ; rampant → b 1, U plafond | choix isolation comble via UI/org (1/0.9/0.7) |
| D10 | Orientation | ignorée au calcul, portée par paroi (plan coloré §7) | reconduire |
| D11 | **Menuiserie sur mitoyen émis** | trou du brouillon (traitée en b LNC) | → `thetaAdjacente`, pas b (finding revue finale) |

**Mappings types** : `mur-*` → poste 'murs' ; `fenetre|porte|porte-fenetre` → 'menuiseries' ;
`plancher-*` → 'plancherBas' (dont `plancher-sur-exterieur` → **b=1**) ; `plafond-*|toiture-rampant`
→ 'plafondToiture'. Types de flux `calculeUParoi` (compositions) : plancherBas → 'plancher',
cf. en-tête `thermalEngine.js`.

## Résolutions amont (avant l'assembleur)

- **θint par défaut selon typePiece** (spec §3, org-configurable) — indispensable : le canevas crée
  `thetaInt: null` (throw à l'assemblage ; pas d'émission mitoyenne si null). Le wizard doit
  affecter type + θint dès la création de pièce (router par `dessinOps`, pas l'inline du canevas).
- **θe** : `thetaBasePour(climat, dept, altitude)` — correction altitude `'non-appliquée'`
  (calibration A/B pendante, 2 points acquis : Amanzé, Ceyzériat). Année inconnue → « avant 1974 ».
- **DJU** : `consoAnnuelle` **throw si dju null** (~750 communes : Var, Corse, DOM) — créer
  `djuPour(dept)` fallback départemental (règle à trancher : chef-lieu ou médiane).
- **plageVraisemblance W/m²** par période (garde-fou spec §6) — le défaut {0, ∞} n'alerte jamais.
- **fRH** (relance) : choix org ; ventilation naturelle mode 'taux' : chemin existant non exercé
  par le test d'intégration.
- **PAC** : `total` (relance incluse) → `courbeCharge` ; `gv` (relance exclue) → `consoAnnuelle` —
  ne pas croiser. Afficher `avertissementChargePartielle` (P_th hplib = EN 14825 charge partielle).
  PAC manuelle : `scopManuel` requis pour la conso.
- **valideDessin laisse passer un dessin vide** (avertissement seul) — le wizard doit exiger
  ≥ 1 pièce chauffée avant le calcul.

## Dette UI canevas (aussi en JSDoc de PlanCanvas)

`enErreur` ← `valideDessin` · error boundaries autour des helpers qui throw
(boiteEnglobante/normalisePolygone/intervalleAxial) · `useId` pour les ids de patterns SVG
(multi-instance) · centroïde d'aire pour formes L/U · édition/re-sélection des ouvertures
existantes · surlignage d'ouverture ciblée (pas toutes celles de la pièce) · a11y RoseNord
(tabIndex/clavier) · mode 'polygone' (si le besoin terrain le confirme) · validation visuelle
complète (aucune infra de test React — première vraie passe au câblage wizard + preview).

## Obligations de réécriture

- `integration-dessin-bilan.test.mjs` : à réécrire sur l'assembleur réel (obligation en tête du fichier).
- `thetaBasePour` : forme de retour `{thetaE, correctionAltitude}` transitoire — redeviendra
  scalaire après calibration (ne destructurer que `.thetaE`).
