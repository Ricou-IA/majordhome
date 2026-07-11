# Design — Intégration du moteur horaire d'autoconso dans le wizard solaire

> Statut : **LIVRÉ** (P1→P6 exécutés, commits `93f97c4`→`b606917` + affinages `c8c4220`/`f47fd1c`/`1248565` — constat 2026-07-11). Restent hors périmètre : Sankey/cascade dans le PDF, edge `seriescalc` par adresse (raffinement). Décision de flux : **option A** (optimisation dans Résultats). Contexte : [[project_solaire_autoconso_batterie]].

## 1. Flux cible (validé Eric)
1. **Capacité productive** — Localisation + map/pans → kWc (PVGIS). *[existant]*
2. **Conso type → constat** — profil de conso → autoconso RÉELLE horaire. *[à rebrancher]*
3. **Dimensionnement** — scénarios de taille selon la conso. *[existant]*
4. **Optimisation autoconso** — cascade (délestage, VE week-end, piscine/clim, batterie). *[nouveau, dans Résultats]*

## 2. Le changement de fond : coefficient → moteur horaire

**Aujourd'hui** (`buildEtudeModel`) : `autoconso = computeMonthly(prod, conso, coeff)` où `coeff = simultaneityCoeff(preset, ecsBonus, evBonus)` — un **coefficient forfaitaire** piloté par les cartes « présence » (Step2). C'est l'estimation grossière à remplacer.

**Cible** : le **constat d'autoconso** = `computeSelfConsumption(prodHourly, consoHourly)` du moteur horaire, où :
- `prodHourly` = **prod mensuelle RÉELLE par adresse** (`pvgis.e_m` déjà fetché par le wizard) × `activeKwc` × **forme horaire normalisée** (part de chaque heure dans son mois, tirée de la fixture Gaillac `seriescalc`). → magnitude/saisonnalité réelles de l'adresse + forme diurne réaliste, **sans edge**. (Le moteur tourne déjà sur du `seriescalc` horaire ; ici on distribue le mensuel réel par la forme.) L'edge #2 (`seriescalc` par adresse) = raffinement d'exactitude ultérieur, PAS une dépendance bloquante.
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
- **P1** — helpers purs (TDD) : `hourlyProdFromMonthly(e_m, kwc, hourlyShape)` (mensuel réel par adresse × forme Gaillac normalisée) + `consoHourlyFromMonthly(monthly, talon)`. **Aucune dépendance edge.**
- **P2** — `buildEtudeModel` : autoconso constat depuis le horaire, financier rebranché dessus. Tests `node --test` (les chiffres changent → mettre à jour les tests attendus). **Feature-flag** possible pour bascule progressive.
- **P3** — Step2 : retirer cartes présence + « Répartir » Enedis RES1/RES2.
- **P4** — Step3 : section « Optimisation autoconso » (cascade + Sankey).
- **P5** — PDF : réécrire la section pilotage sur horaire + cascade.
- **P6** — nettoyage : `simultaneityCoeff`/`config.simultaneity`/admin.

## 6. Reco
C'est une intégration **structurante et livrée** (calcul + PDF). Je recommande de l'exécuter **phase par phase avec checkpoints**, pas d'un bloc. **Sign-off principal = les chiffres changent** (coeff → horaire) sur le calculateur + PDF. **Plus de dépendance edge** : la prod horaire se reconstruit du mensuel réel (par adresse, déjà fetché) × la forme Gaillac normalisée. L'edge #2 (`seriescalc` par adresse) = raffinement d'exactitude ultérieur.
