# Assistant de devis fumisterie — tranche 3 : toutes les configurations (addendum)

Complète les specs du 2026-09-28 (G1) et du 2026-09-29 (G4 tubage). Décision Eric le 2026-09-29 :
« termine tout le moteur, on verra pour les prix et le raccordement Pennylane après ». Les 14
configurations restantes du catalogue MODINOX deviennent métrables ; toutes les règles de quantité
et les choix d'articles sont **provisoires** (statut `provisoire`, à faire valider par Philippe).

## 1. Gabarits et configurations

| Gabarit | Géométrie | Configurations |
|---|---|---|
| `G1` (existant) | création intérieure verticale, toiture + faîtage | CFG-24 PTR30, **CFG-32** PTR + souche Polytoit, **CFG-42** foyer via combles + Polytoit + PRH dans la hotte, **CFG-28** / **CFG-48** PLA concentrique (étanche, chaudière), **CFG-40** MFI |
| `G3` / `G3P` | création extérieure en façade (`gabarits/g3.js`) : traversée de mur, té au pied, conduit isolé le long de la façade, zone 1 depuis l'égout et le faîtage | **CFG-25** PTR, **CFG-33** PLA intérieur + PTR façade |
| `G4` / `G4R` (existants) | tubage flexible / rigide | CFG-34, 26, 35, 27 |
| `G4P` | tubage flexible isolé POLYPERF : le **bas de conduit** (`bas` = plafond / mur / foyer / té) décide de l'entrée et des pièces basses | **CFG-37**, **CFG-39** |
| `G4K` | kit rénovation PLA : flexible POLYLISSE + adaptateurs PLA haut / bas + raccordement concentrique | **CFG-30** (boisseau maçonné), **CFG-31** (conduit isolé existant) |
| `G4F` | foyer raccordé directement au flexible (Griffaflex), pas de tuyau simple paroi | **CFG-43** |
| `G5` | raccordement seul, conduit non métré (dessiné à titre indicatif) | **CFG-45** |
| `G6` | sortie horizontale en façade (`gabarits/g6.js`) : vertical, coude, horizontal, traversée, terminal — zone 3 **non vérifiée** (alerte) | **CFG-29** |

`G4P` / `G4K` / `G4F` / `G5` réutilisent `geometrieG4` avec des paramètres forcés (entrée, `hsp1 = hBuse`
pour un foyer, `hConduit = 0` pour le raccordement seul) ; les contrôles « buse » sont retirés quand
ils n'ont pas de sens.

## 2. Extensions du moteur

- **`kit_longueur:<tronçon>`** : un kit vendu par longueur entière (gaine POLYPERF « N ML ») choisi au
  mètre supérieur, placeholder `{ML}`.
- **`par_intervalle:<tronçon>`** : fixations réparties (supports muraux de façade), réglage
  `supports_muraux_tous_les_m` (2 m, Settings → Fumisterie).
- **`{BOI4}`** : section de boisseau en 4 chiffres pour les adaptateurs PLA n°6 / n°7 (`2020`… `3050`).
- **Pente** : ne départage que les pièces dont le mapping est de type `solin` ou `souche` ; une pièce
  sans plage (collerette PLA) n'est plus écartée par la pente.
- **Diamètre nominal ≠ Ø du relevé** : un motif sans `{D}` (kit d'air, ou `{D+60}` seul : support mural
  intermédiaire, collier Polytoit, solin MFI) n'est filtré ni au chargement ni à la résolution ; le
  motif fait le tri. Le service charge aussi les articles **sans Ø parsé** (plaque de propreté MFI).
- Alerte `article_ambigu` limitée à 6 références + total (46 kits MFI listés sinon).

## 3. « À chiffrer » voulus sur le tarif réel

Adaptateurs PLA n°2 / n°4 (référence « D XXX » = sur mesure), support mural de départ Ø80/100
(PTR30+ commence à Ø130), solin PLA Ø100 (seule la collerette Ø80 rouge tuile existe), kit de
raccordement MFI (un kit par modèle d'appareil, fiche R-MFI-01). Tout le reste se résout aux Ø testés.

## 4. Tests

`tranche3-tarif-reel.test.mjs` (14 configurations pinnées : références, totaux, lignes à chiffrer),
`g3-g5-g6.test.mjs` (géométries, contrôles, `sortieMinimale` G3, alternatives G4P / G5). Total
fumisterie : 75 tests.
