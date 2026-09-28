# Assistant de devis fumisterie — tranche 2 : G4 tubage (addendum)

Complète `2026-09-28-assistant-devis-fumisterie-design.md` (§7, tranche 2). Décidé avec Eric le
2026-09-29 pendant la recette de la tranche 1 (« go de bout en bout ») : le relevé proposé ci-dessous
est celui validé en conversation, les règles de quantité sont **provisoires** (statut `provisoire`
dans la nomenclature, à faire confirmer par Philippe).

## 1. Périmètre

Rendre métrables les configurations de **tubage d'un conduit existant** avec un gabarit commun G4 :

| Configuration | Gamme | Gabarit | Combustible |
|---|---|---|---|
| CFG-34 | flexible POLYLISSE XT | `G4` (flexible) | pellets |
| CFG-26 | flexible POLYLISSE XT | `G4` | bûches |
| CFG-35 | rigide PRH | `G4R` (rigide) | pellets |
| CFG-27 | rigide PRH (ATRINOX plus tard) | `G4R` | bûches |

Hors périmètre de cet addendum : POLYPERF (CFG-37/39, alternatives « ou » en bas de conduit),
kits rénovation PLA (CFG-30/31, appareil étanche), raccordement seul (G5), extérieur (G3).

## 2. Relevé (fum_gabarits.troncons)

Deux gabarits qui partagent la même géométrie ; le rigide n'affiche pas les choix qui ne le
concernent pas (un champ affiché mais ignoré est un piège silencieux).

| Tronçon | Paramètre | G4 | G4R |
|---|---|---|---|
| Appareil | `diametre` (80/100/130/150/180), `hBuse` | ✓ | ✓ |
| Raccordement | `entree` (`plafond` / `mur`), `hsp1`, `hEntree` + `lHoriz` (si mur), `raccord` (`emaille_12` / `emaille_07` / `acier_peint`) | ✓ | `raccord` absent (PRH jusqu'à la buse) |
| Conduit existant | `hConduit` (de l'entrée au haut de souche), `boisseau` (section : 20×20, 25×25, 30×30, 20×40, 40×40, 30×50) | ✓ | ✓ |
| Sortie de souche | `chapeau` (`standard` / `plat`) | ✓ | absent (anti-refouleur PRH) |
| Options | `kit_air` (0/1) | ✓ | ✓ |

Un choix à libellés (`choix` + `libelles`) est rendu par `ReleveForm` ; la validation
(`validerReleve`) est inchangée. `hSortie`/zone 1 n'existent pas : le débouché est celui du conduit
existant, le métré le dit en `info` et ne le vérifie pas.

## 3. Géométrie (`gabarits/g4.js`, pur)

- `Lsp_v` = `hsp1 − hBuse` (entrée plafond) ou `hEntree − hBuse` (mur) ; `Lsp_h` = `lHoriz` si mur.
- `raccordement_sp` = composition de `Lsp_v + Lsp_h` : longueurs d'org (émaillé 1000/500/250) en G4, `longueurs_prh_mm` (1000/500/330) en G4R.
- `conduit_existant` : G4 → **flexible au mètre** = `hConduit + flexible_marge_m`, arrondi au `flexible_arrondi_m` supérieur ; G4R → composition en `longueurs_prh_mm`.
- Contrôles : buse au-dessus de l'entrée, conduit < 1 m, entrée par le mur au-delà du Ø150 (adaptateur de piquage limité, R-POLYPERF-02), surlongueurs, info « zone 1 non vérifiée ».

## 4. Nomenclature — extensions du moteur

- **Alternatives** : un composant avec `groupe_alternative` + `option` n'est retenu que si `releve[groupe] == option`. Un groupe sans `option` (kit RT2012 de CFG-24) reste un simple regroupement.
- **`par_longueur`** itère les longueurs de la composition du tronçon (plus la liste d'org) : un tronçon PRH se compose en 330, pas en 250.
- **`par_longueur_ml:<tronçon>`** : quantité = mètres du tronçon (article vendu au ml).
- **Placeholder `{BOI}`** dans `motif_code` = indice de section de boisseau (1..6). Les références MODINOX des kits de couronnement (`2DIVKCIRN{BOI}{D}`) et des plaques ventilées (`2FLEPHV{BOI}N{D}NO`) portent le même indice.
- **Articles sans diamètre** : un mapping dont le motif ne contient pas `{D}` ne dépend pas du Ø (kit entrée d'air) → le service charge toute la gamme.

## 5. Réglages (`settings.fumisterie`, Settings → Fumisterie)

`flexible_marge_m` (0,50), `flexible_arrondi_m` (0,50), `longueurs_prh_mm` (1000, 500, 330). Épaisseur du flexible (10/100) et du PRH (6/10) = mapping, pas réglage (tranche 3 si besoin).

## 6. Données (`scripts/fumisterie/data/`)

`gabarit-g4.json`, `gabarit-g4r.json`, `cfg{26,27,34,35}-composants.json`, `g4-mapping.json`.
Le seed devient générique (liste de gabarits, de nomenclatures et de fichiers de mapping) et
remplace tout le mapping MODINOX (union des fichiers) à chaque passage.

## 7. Écran

`CoupeCoteeG4` (boisseau, souche, flexible ou tuyau, raccordement plafond/mur), choisie par
`ReleveStep` selon `gabarit.code`. Qualification : quand aucune configuration filtrée n'est
métrable, l'écran liste celles qui le sont.

## 8. Tests

- `g4.test.mjs` : géométrie plafond / mur, arrondi du flexible, composition PRH en 330.
- `tarif-reel.test.mjs` : CFG-34 Ø80, CFG-26 Ø150 (mur), CFG-35 Ø80, CFG-27 Ø150 sur le tarif réel — aucune ligne à chiffrer, références et totaux d'achat pinnés.
- `nomenclature.test.mjs` : alternative, `par_longueur_ml`, `{BOI}`.
- CFG-24 : les 14 lignes / 1 480,90 € restent verts (non-régression).

## 9. Preuve

Un devis tubage pellets (CFG-34) et un tubage bûches (CFG-26) sortent en prod sans ligne à
chiffrer aux Ø80 et Ø150 ; Philippe valide ou corrige les règles provisoires dans les données.
