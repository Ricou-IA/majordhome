# Design — Bibliothèque de sous-profils d'usage + scénarios d'optimisation (module solaire)

> Statut : **DESIGN À VALIDER par Eric** (les défauts marqués 🟡 À VALIDER sont ses appels terrain). Une fois validé → plan TDD + code (`usageProfiles.js` puis `scenarios.js`).
> Contexte : [[project_solaire_autoconso_batterie]]. Moteur pur déjà livré (`autoconsoEngine.js` : `buildLoadCurve`, `computeSelfConsumption`, `simulateBattery`, `sizeBattery` ; `pvgisHourly.js`). Invariant absolu : **le surplus n'est JAMAIS valorisé en €** — on valorise l'import évité ou l'usage de confort (pas un rachat).

---

## 1. Principe (validé avec Eric)

**Étape 0 — le « constat » (sans changement de comportement)**
Courbe enveloppe = **talon Enedis RES1 + particularités client** (ECS, VE, piscine, PAC — chacun à sa place actuelle : ECS/VE la nuit), calée sur les 12 conso mensuelles du client (ancres = sa facture). On superpose la cloche PVGIS → **autoconsommation « normale »**.

**Puis la cascade de leviers, empilés (chacun sort un % d'autoconso) :**
1. **Comportement + mesure (gratuit)** — déplacement manuel partiel → **+2-3 %**
2. **Déphasage piloté** — asservissement ECS + charge VE sur le surplus (compteurs intelligents) → **+5-10 %**
3. **PAC piscine** — absorbe le surplus en chauffant la piscine → **« 2-3 mois de baignade en plus »** (valeur = confort, pas €)
4. **Batterie** — couvre le soir/nuit

Les % sont **constatés** (fraction réaliste → on lit le résultat), pas des objectifs à atteindre (décision Eric).

## 2. Flux de données

```
Formulaire foyer ──► usageProfiles.js ──► devices[] ──┐
(nb pers, km VE,                                       ├─► buildLoadCurve(talon RES1, devices, 12 ancres)
 volume piscine, …)   fixture Enedis RES1 ──► baseShape┘        │
                                                                ▼  consoHourly (baseline)
                              PVGIS seriescalc ─► pvgisToProdHourly ─► prodHourly[8760]
                                                                │
                    computeSelfConsumption(baseline) ───────────┴─► autoconso "normale" (constat)
                                                                │
                    scenarios.js : applySolarShift / absorbSurplusWithLoad / simulateBattery
                                                                ▼
                                     runScenarios ─► cascade [S0, S1, S2, S2bis, S3] (% + gains)
```

## 3. Sous-profils par usage

Chaque usage produit un `device = { name, annualKwh, hourOfDayWeights[24], monthWeights[12] }` consommé par `distributeDeviceLoad`. `hourOfDayWeights` = *quand dans la journée* ; `monthWeights` = *quand dans l'année*. Poids relatifs (renormalisés).

### 3.1 Talon (base résidentielle)
- **Source** : forme Enedis **RES1** (base, SANS chauffage élec) normalisée = `baseShape` de `buildLoadCurve`. Pas de formule — c'est la fixture du spike.
- **Rôle** : absorbe le **résidu** = `conso_mensuelle − Σ usages` (éclairage, froid, veilles, cuisine, divers).
- 🟡 À VALIDER (spike données) : confirmer que **RES1 est publié** dans `conso-inf36` et le retenir (pas RES2, qui embarque le chauffage qu'on modélise en PAC).

### 3.2 ECS (ballon eau chaude) — dérivé du nombre de personnes
- **Énergie/jour** : `E_jour(m) = N_pers × V_pers × (T_ballon − T_froide(m)) × 1,163 ÷ 1000 ÷ η` (kWh)
  - `1,163 Wh/L/°C` = chaleur massique eau (constante).
  - **Énergie/mois** = `E_jour(m) × jours(m)` → `monthWeights` (varie tout seul avec la saison via `T_froide`).
- **Défauts proposés** 🟡 À VALIDER :
  | Param | Défaut | Note |
  |---|---|---|
  | `V_pers` | **40 L/pers/jour** | douche ~50 L + éviers ; réglable |
  | `T_ballon` | **55 °C** | |
  | `T_froide(m)` | **[10,10,11,13,15,17,18,18,17,15,12,10] °C** | eau froide réseau, saisonnière |
  | `η_ballon` | **0,9** | pertes stand-by |
  - Ordre de grandeur : ~1,5-2 kWh/pers/jour, plus l'hiver. Foyer 4 → ~6-8 kWh/jour.
- **Forme horaire baseline (nuit HC)** : `hourOfDayWeights` = 1 sur **[22,23,0,1,2,3,4,5]**, sinon 0.
- **Forme cible (délestage)** : 1 sur **[11,12,13,14,15]** (levier, cf. §4), **plafonné par le volume du ballon** (batterie thermique : on chauffe un jour, pas une semaine).

### 3.3 VE (recharge véhicule électrique)
- **Énergie/an** : `km/an × kWh_100km ÷ 100 × part_charge_maison` (fonction `evMonthlyConsumption` déjà dans `pvEngine.js` — à réutiliser).
- **Défauts** 🟡 : `kWh_100km` = **18**, `part_charge_maison` = **0,9**. `km/an` saisi.
- **Forme horaire baseline (nuit)** : 1 sur **[23,0,1,2,3,4,5]**.
- **`monthWeights`** : uniforme (option : léger +hiver, autonomie réduite — négligé en v1).
- **Levier** : déplaçable jour (asservissement charge, cf. §4).

### 3.4 Piscine (pompe de filtration)
- **Énergie/mois** : `P_pompe × heures_jour × jours(m)` (saison).
- **Défauts** 🟡 : `P_pompe` = **0,8 kW**, `heures_jour` ≈ **8 h** (proportionnel à la température de l'eau).
- **Forme horaire** : 1 sur **[11..17]** (déjà bien placée sur le surplus).
- **`monthWeights`** (saison baignade) 🟡 : **[0,0,0,0.2,0.5,1,1,1,0.6,0.2,0,0]** (avril→oct, pic été).

### 3.5 PAC (chauffage / clim) — thermosensible
- **Énergie** : v1 = budget annuel estimé ou saisi. Refonte possible : **brancher le Module Thermique** (déperditions déjà calculées) pour dériver le besoin de chauffe → COP → kWh. À défaut, saisie.
- **Forme horaire** : chauffage matin **[6,7,8,9]** + soir **[18,19,20,21,22]** ; clim été midi **[12..17]**.
- **`monthWeights`** 🟡 : chauffage ∝ degrés-jours **[1,0.9,0.7,0.4,0.1,0,0,0,0.1,0.4,0.7,1]** ; clim **[0,0,0,0,0,0.4,1,1,0.3,0,0,0]**.
- **Levier** : partiellement pilotable (préchauffe/pré-rafraîchissement sur surplus) — v2.

## 4. Leviers & scénarios (`scenarios.js`)

Deux primitives PURES, symétriques :

- **`applySolarShift(consoHourly, prodHourly, usageCurve, { fraction })`** — *déplace* une part `fraction` de l'énergie d'un usage de ses heures actuelles vers les heures de **surplus** (prod>conso), greedy. Conso totale inchangée. → scénarios 1 (fraction faible) & 2 (fraction élevée, ECS+VE). ECS plafonné par volume ballon.
- **`absorbSurplusWithLoad(consoHourly, prodHourly, { window, maxKw })`** — *ajoute* une charge de confort (PAC piscine) dans les heures de surplus jusqu'à épuisement. Conso totale augmente, coût marginal ≈ 0. Renvoie kWh absorbés → sous-modèle `poolExtraMonths`.

**Cascade** `runScenarios(baseline, prodHourly, config)` → tableau :
| Scénario | Transform | Gain attendu |
|---|---|---|
| S0 Constat | baseline | — |
| S1 Comportement | `applySolarShift(fraction faible)` | +2-3 % |
| S2 Déphasage piloté | `applySolarShift(ECS+VE, fraction élevée)` | +5-10 % |
| S2bis PAC piscine | `absorbSurplusWithLoad` | X mois baignade |
| S3 Batterie | `simulateBattery` / `sizeBattery` | +Z % |

**Sous-modèle piscine** : `poolExtraMonths(surplusByMonth, poolHeatDemandByMonth)` = mois d'épaule (avril-mai, sept-oct) où le surplus couvre le besoin de chauffe → **« N mois de baignade alimentés par votre surplus »**. Besoin de chauffe 🟡 à modéliser (volume/surface, T° cible, bâche) — **codé en dernier**, ne bloque pas le cœur.

**Honnêteté saisonnière (à afficher, pas masquer)** : déphasage ECS efficace en mi-saison/été (surplus abondant, eau froide tiède) ; faible en hiver (peu de surplus, besoin max).

## 5. Invariants
- Surplus **jamais** valorisé en € (import évité / usage de confort uniquement).
- Simu batterie **non cyclique** (soc=0 en h0 ; déficit initial irrécupérable — voulu).
- Calendrier **8760** (année non bissextile) ; PVGIS aligné via `pvgisHourly`.
- Tout module **pur** (aucun import), testé `node --test`.

## 6. Questions ouvertes (à trancher par Eric)
1. Les **défauts 🟡** ci-dessus (V_pers, T_froide, P_pompe piscine, monthWeights) — OK ou corrections ?
2. **PAC v1** : budget saisi manuellement, ou on branche le **Module Thermique** dès maintenant (plus juste mais couplage) ?
3. **Anchors** : on part des **12 conso mensuelles de la facture** client (constat) quand dispo, et estimation bottom-up sinon — confirmé ?

## 7. Découpage build (après validation)
1. **`usageProfiles.js`** (pur, TDD) : `ecsDevice({persons,...})`, `veDevice({kmPerYear,...})`, `poolDevice({...})`, `pacDevice({...})`, `RES1_TALON` (charge fixture). Chaque fonction → `device` normalisé.
2. **`scenarios.js`** (pur, TDD) : `applySolarShift`, `absorbSurplusWithLoad`, `runScenarios`, `poolExtraMonths`.
3. Fixture Enedis RES1 (spike Phase 2) + wiring PVGIS `seriescalc` (edge, sign-off prod).
