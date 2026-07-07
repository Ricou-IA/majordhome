# Design — Intégration du moteur horaire d'autoconso dans le wizard solaire

> Statut : **À VALIDER par Eric** (touche du code LIVRÉ : `buildEtudeModel`, Step2, Step3, PDF). Décision de flux : **option A** (optimisation dans Résultats). Contexte : [[project_solaire_autoconso_batterie]].

## 1. Flux cible (validé Eric)
1. **Capacité productive** — Localisation + map/pans → kWc (PVGIS). *[existant]*
2. **Conso type → constat** — profil de conso → autoconso RÉELLE horaire. *[à rebrancher]*
3. **Dimensionnement** — scénarios de taille selon la conso. *[existant]*
4. **Optimisation autoconso** — cascade (délestage, VE week-end, piscine/clim, batterie). *[nouveau, dans Résultats]*

## 2. Le changement de fond : coefficient → moteur horaire

**Aujourd'hui** (`buildEtudeModel`) : `autoconso = computeMonthly(prod, conso, coeff)` où `coeff = simultaneityCoeff(preset, ecsBonus, evBonus)` — un **coefficient forfaitaire** piloté par les cartes « présence » (Step2). C'est l'estimation grossière à remplacer.

**Cible** : le **constat d'autoconso** = `computeSelfConsumption(prodHourly, consoHourly)` du moteur horaire, où :
- `prodHourly` = `state.pvgis` (déjà là, 1 kWc) × `activeKwc`. ⚠️ le wizard a `pvgis.e_m` (mensuel PVGIS **PVcalc**) → il faudra la **série horaire `seriescalc`** (branchement #2, edge — ou fixture en attendant).
- `consoHourly` = talon Enedis RES1 réconcilié sur les **12 conso mensuelles** du wizard (= les ancres, déjà saisies). C'est la « conso type » pour le constat.

Puis **tout le financier** (`economyYear1`, `table`, `mensualite`) consomme ce **vrai autoconso kWh** au lieu de `active.totals.autoconso` (coeff). Le bloc « pilotage/coefficient » (`coeffParts`, `overlapRatio`, `maxAchievableAutoconso`, `pilotageDelta*`) est **remplacé** par le gain de la **cascade** (étape 4).

## 3. ⚠️ RISQUES / décisions à valider (sign-off Eric)

1. **Les CHIFFRES du calculateur changent.** L'autoconso (donc économie, point mort, mensualité) passe du coefficient au horaire → **différent** des études déjà générées. Les PDFs historiques rechargés recalculeront différemment. **OK produit ?**
2. **Le PDF (`EtudePDF`) doit suivre.** Il lit `buildEtudeModel` (dont `coeffParts`/pilotage). La section « transparence / pilotage » du PDF doit être **réécrite** sur le mécanisme horaire + cascade. Gros morceau.
3. **`pvEngine.simultaneityCoeff` + `config.simultaneity` deviennent morts** → à nettoyer (et l'admin `SolaireSettings` qui les édite).
4. **Constat = talon type OU décomposé ?** Reco : constat sur **talon Enedis × 12 mensuels** (simple, « conso type »). La **décomposition d'usages** (ECS/VE/piscine/clim/PAC) n'intervient qu'à l'**étape 4** (pour savoir quoi déphaser). Léger décalage baseline constat↔optim, acceptable.

## 4. Changements UI

**Step2Consommation** : **retirer** les cartes « Profil de présence » + case « Pilotage ECS » + case « Recharge pilotée VE » (l'heuristique simultanéité). **Garder** : 12 mensuels, prix kWh, VE (km/conso/borne). **Améliorer** « Répartir depuis l'annuel » → forme **Enedis RES1** (sans chauffage) / **RES2** (avec chauffage élec, via un flag « chauffage électrique ? ») au lieu du profil générique.

**Step3Resultats** : KPI autoconso/couverture depuis le constat horaire. **Nouvelle section « Optimisation autoconso »** (bouton « Optimiser » → cascade + Sankey + batterie recommandée, réutilise les composants du simulateur `/solaire/autoconso`). Collecte les usages manquants (personnes, piscine, clim, PAC) dans cette section.

**wizardState** : retirer `conso.preset`/`conso.ecsBonus`/`ev.pilotedCharge` ; ajouter les usages d'optimisation (`persons`, `pool`, `clim`, `pacAnnualKwh`).

## 5. Plan phasé (pour ne pas tout casser d'un coup)
- **P1** — `seriescalc` dispo (edge #2 sign-off, ou fixture temporaire) + helper `buildConsoHourlyFromMonthly(monthly, talon)`.
- **P2** — `buildEtudeModel` : autoconso constat depuis le horaire, financier rebranché dessus. Tests `node --test` (les chiffres changent → mettre à jour les tests attendus). **Feature-flag** possible pour bascule progressive.
- **P3** — Step2 : retirer cartes présence + « Répartir » Enedis RES1/RES2.
- **P4** — Step3 : section « Optimisation autoconso » (cascade + Sankey).
- **P5** — PDF : réécrire la section pilotage sur horaire + cascade.
- **P6** — nettoyage : `simultaneityCoeff`/`config.simultaneity`/admin.

## 6. Reco
C'est une intégration **structurante et livrée** (calcul + PDF). Je recommande de l'exécuter **phase par phase avec checkpoints**, pas d'un bloc. P2 (le cœur) + le fait que **les chiffres changent** = le sign-off le plus important. Dépendance dure : **P1 nécessite la prod horaire** (`seriescalc`) — soit l'edge #2, soit une fixture temporaire (comme le simulateur).
