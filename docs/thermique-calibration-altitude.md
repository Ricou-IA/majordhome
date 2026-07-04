# Calibration de la correction d'altitude de θe (module Thermique)

> Statut : **reporté en phase A/B** (décision Eric, 2026-07-04). Ce document est le protocole à
> exécuter lors de cette phase, après le plan 5 (validation croisée avec le logiciel historique).

## 1. Contexte

`climat.json` (module Thermique) porte **une seule θe (température extérieure de base hiver) par
département**, transcrite depuis `Base de données - Coordonnées des départements.txt` (base du
logiciel historique, colonne **T Hiver**) — voir `climat.json._meta.source`. Cette valeur est une
référence chef-lieu, sans tranche d'altitude.

Le logiciel historique (`Thermique.exe`) affiche en plus une **« Température corrigée hiver »**,
obtenue en appliquant une correction d'altitude à la θe de base. Cette règle de correction est
**codée en dur dans l'exécutable** et n'est documentée dans aucun fichier accessible (ni dans les
sources texte, ni dans l'aide).

**Décision v1 (ce plan) : aucune correction d'altitude n'est appliquée.** La fonction
`thetaBasePour` (`src/apps/thermique/lib/refDataResolvers.js`) retourne la θe départementale brute
et un champ `correctionAltitude: 'non-appliquée'`. L'altitude de la commune est acceptée en
paramètre (signature figée pour ne pas casser les appelants plus tard) et reste **affichée à titre
informatif** dans l'UI, mais n'influence pas le calcul.

La calibration de la règle réelle est **reportée à la phase de test A/B contre le logiciel
historique**, qui suit le plan 5. C'est l'objet du protocole ci-dessous.

## 2. Point déjà acquis

Relevé en plan 1, dans l'aide du logiciel historique :

> Aide générale-1.pdf, p. 10 — commune d'**Amanzé** (département 71), altitude **350 m** :
> θe de base **−10 °C** → θe corrigée **−11 °C**.

Ce point est cohérent avec les données actuelles du dépôt : `communes.json` donne Amanzé (INSEE
710006, dept 71) à l'altitude 350 m, et `climat.json.thetaBase["71"]` vaut −10 °C. Il sert de
première ligne au tableau de relevés ci-dessous.

**Deuxième point acquis (plan 2, Task 11)** : le fichier exemple du logiciel
(`Dossiers/232477 - Fichier exemple - Déperditions.dep`) est situé à **Ceyzériat** (dépt 01),
altitude **300 m** : θe base **−10 °C** → corrigée **−11 °C** (lu et contre-vérifié dans le fichier,
cf. `docs/thermique-validation.md`). Deux points cohérents avec une hypothèse « −1 K au-delà de
200 m » — toujours insuffisant pour valider une règle (il faut des altitudes étagées, cf. §3-§4).

## 3. Protocole de relevés (phase A/B)

Dans le logiciel historique, choisir **2 à 3 départements contrastés** en θe de base (ex. **71**,
**81**, **67** — climats et θe de base différents), et pour chacun des **communes à altitudes
étagées** couvrant environ 0, 200, 400, 600, 800 et 1000 m (selon ce que le relief du département
permet réellement — pas la peine de forcer une tranche introuvable).

Pour chaque commune, relever dans le logiciel :

- le nom de la commune et son département,
- l'altitude affichée,
- la θe de base (avant correction),
- la θe corrigée (« Température corrigée hiver »).

**Cible : 8 à 12 points** au total (répartis sur les 2-3 départements). Plus de points si les
premiers relevés ne permettent pas de trancher entre plusieurs règles candidates (cf. §4).

### Tableau de relevés (à remplir)

| Commune | Dépt | Altitude (m) | θe base (°C) | θe corrigée (°C) |
|---|---|---|---|---|
| Amanzé | 71 | 350 | −10 | −11 |
| Ceyzériat | 01 | 300 | −10 | −11 |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

## 4. Exploitation des relevés

**Forme attendue de la règle :** une correction par paliers, du type **−1 K par tranche de N
mètres au-delà d'un seuil S** (N et S à déterminer à partir des relevés — par exemple, à titre
d'hypothèse de travail seulement, « −1 K tous les 200 m au-delà de 200 m » donnerait −11 à 350 m
pour une base à −10, ce qui colle au point Amanzé, mais **une seule donnée ne suffit pas** à valider
une règle : il faut la confronter à tous les points relevés avant de la retenir).

**Critère de validation : exact ou rejeté.** La règle candidate doit reproduire **tous** les points
du tableau à **0 K d'écart**. Ce n'est pas une régression à minimiser — le logiciel historique
applique une règle déterministe (paliers entiers), donc la bonne formule ne laisse aucun résidu.
Une règle qui approxime « à peu près » n'est pas la bonne règle.

**Si aucune règle simple ne colle à tous les points :** ne pas forcer un ajustement approximatif.
Consigner les écarts observés (quels points ne collent pas, de combien) dans ce document, et
trancher avec Eric avant d'implémenter quoi que ce soit — il est possible que la règle dépende aussi
d'un autre paramètre (ex. le département, une zone climatique) et pas seulement de l'altitude.

## 5. Branchement (une fois la règle validée)

- **Où :** `thetaBasePour(climat, dept, altitude)` dans
  `src/apps/thermique/lib/refDataResolvers.js`. La fonction applique déjà l'altitude en paramètre
  (elle sert aujourd'hui uniquement au choix de tranche dans `climat.thetaBase`, une seule tranche
  ouverte par département) ; il s'agit d'ajouter le calcul de correction sur `tr.thetaE` et de
  changer la valeur retournée pour `correctionAltitude` : `'non-appliquée'` →
  **`'calibrée-legacy'`**.
- **Donnée déjà disponible :** l'altitude par commune existe déjà dans
  `src/apps/thermique/data/communes.json` (champ `altitude`) — aucune nouvelle donnée de référence
  à importer, uniquement la règle de calcul à coder.
- **Tests à ajouter :** dans `scripts/thermique/ref-data-resolvers.test.mjs`, chaque ligne du
  tableau de relevés (§3) devient une assertion sur `thetaBasePour(climat, dept, altitude).thetaE`
  (valeur = θe corrigée relevée) et sur `.correctionAltitude === 'calibrée-legacy'`. Le test actuel
  qui vérifie `correctionAltitude === 'non-appliquée'` (commentaire « avant Task 9 ») devra être
  supprimé ou mis à jour à ce moment-là.
