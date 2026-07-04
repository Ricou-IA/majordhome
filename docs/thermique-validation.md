# Validation du module Thermique — bilan et protocole A/B

> Statut : bilan de ce qui est validé à la fin du plan 2 (moteurs), et protocole de la **phase de
> test A/B contre le logiciel historique** (décision Eric 2026-07-04 : après le plan 5). Voir aussi
> `docs/thermique-calibration-altitude.md` (protocole dédié à la correction d'altitude).

## 1. Ce qui est validé aujourd'hui

### 1.1 Tests automatisés (49 tests verts)

Suite : `node --test "scripts/thermique/*.test.mjs"` — **49 tests** au 2026-07-04 :

| Fichier | Tests | Ce qui est couvert |
|---|---|---|
| `thermal-engine.test.mjs` | 16 | U par composition, transmission par poste, débits de ventilation, relance, bilan bâtiment (cas de référence 2 pièces calculé à la main), erreurs propres |
| `heat-pump-engine.test.mjs` | 14 | COP/P_el/P_th (formule hplib), courbe de charge, point de bivalence, conso annuelle DJU |
| `ref-data-resolvers.test.mjs` | 5 | périodes 3CL, U par défaut, θe par département, coefficients b, recherche communes |
| `check-*.test.mjs` (×4) | 12 | intégrité des données converties du plan 1 (climat, u-défauts, PAC, index) |
| `validation-croisee.test.mjs` | 2 | les 2 cas de non-régression ci-dessous |

### 1.2 Cas de non-régression calculés à la main (`scripts/thermique/validation-croisee.test.mjs`)

Chaque terme est dérivé en commentaire dans le fichier de test (re-calculable par un relecteur) ;
assertions à 1e-9 (bruit IEEE 754 seulement — l'arithmétique est fermée, aucune approximation).

**Cas 1 — pièce unique, tout paramétré en littéraux.** Séjour 25 m² × 2,5 m (62,5 m³), θint 20 °C,
θe −7 °C ; mur ext 15 m² (U 0,42, ΔUtb 0,08), fenêtre 3 m² (U 1,4, ΔUtb 0,08), plancher bas sur
vide sanitaire 25 m² (U 0,30, b 0,5), plafond sous comble isolé 25 m² (U 0,20, b 0,7) ; ventilation
naturelle 0,5 vol/h ; fRH 0.

| Grandeur | Valeur épinglée |
|---|---|
| Transmission (dont ponts th. 38,88 W) | 518,13 W |
| Ventilation (31,25 m³/h) | 286,875 W |
| **Total** | **805,005 W** |
| GV | 29,815 W/K |
| Ratio | 32,20 W/m² |
| Fourchette (−5 %/+10 %) | 765 – 886 W |

**Cas 2 — maison 4 pièces type, résolveurs + moteur intégrés.** Séjour 30 m²/75 m³ (20 °C, sec),
chambre 12 m²/30 m³ (18 °C, sec), cuisine 10 m²/25 m³ (20 °C, humide), sdb 6 m²/15 m³ (22 °C,
humide) ; θe −5 °C ; VMC SF autoréglable, débit total 90 m³/h ; fRH 11 W/m². Le U du mur extérieur
sort de `calculeUParoi` (parpaing R 0,23 + laine de verre 8,4 cm → U 0,40), les b de
`coefficientBPour` sur le vrai `coefficients-b.json` (extérieur 1, comble isolé 0,7, vide
sanitaire 0,5), le débit et le système de `ventilation.json`.

⚠ Le débit d'un **T4 (4 pièces principales) est 90 m³/h** dans la table réglementaire
(`ventilation.json`, `debitsExtraitsParTaille`) — la valeur 105 m³/h parfois citée correspond à
**5** pièces principales.

| Grandeur | Valeur épinglée |
|---|---|
| Transmission (dont ponts th. 91,36 W) | 733,96 W |
| Ventilation (séjour ≈ 546,43 W, chambre ≈ 201,09 W, humides 0) | ≈ 747,51 W |
| Relance (fRH 11) | 638 W |
| **Total** | **≈ 2 119,47 W** |
| GV (relance exclue) | ≈ 59,75 W/K |
| Ratio | ≈ 36,54 W/m² |
| Fourchette (−5 %/+10 %) | 2 014 – 2 331 W |

### 1.3 Verdict sur le fichier exemple du logiciel historique : **EXPLOITABLE**

Fichiers analysés : `C:\Thermique\Dossiers\232477 - Fichier exemple - Déperditions.dep` (1,2 Mo)
et `.Pc1` (224 o), texte latin1. Le `.dep` est une sérialisation d'état de grilles type tableur
(chaque cellule = 1 valeur + 10 lignes de style : gras, police, couleurs…) ; une fois les styles
ignorés, les tableaux de calcul du logiciel sont lisibles dans l'ordre. **Les résultats calculés
par le logiciel y sont bien présents et identifiables sans ambiguïté** :

- **Site** : Ceyzériat (01250, Ain), altitude 300 m, zone H1 ; **θe base −10 °C → θe retenue
  (corrigée altitude) −11 °C** — cohérent avec `climat.json["01"] = −10`, et **2ᵉ point de
  calibration altitude** à reporter dans le tableau de
  `docs/thermique-calibration-altitude.md` (avec Amanzé, 350 m, −10 → −11).
- **Résultats par pièce** (marqueurs `TableauLigne1`…`TableauLigneRésultats`, ΔT affiché = 33 K
  cohérent avec θa − (−11)) — identiques aux 9 couples (θa, puissance) du `.Pc1` :

| Local | θa (°C) | Puissance (W) |
|---|---|---|
| Garage | 19 | 1 020 |
| Toilettes | 22 | 167 |
| Cuisine | 23 | 639 |
| Séjour | 23 | 1 235 |
| Salon | 22 | 300 |
| Entrée | 23 | 379 |
| Mezzanine | 22 | 764 |
| Chambre | 22 | 672 |
| Vide sur rez | 22 | 452 |
| **Total** | | **5 628** |

- **Triple recoupement interne** (c'est ce qui lève l'ambiguïté résultat/saisie/état d'UI) :
  1. la somme des lignes de calcul d'une pièce (parois + ponts + renouvellement d'air) retombe sur
     la puissance de la pièce (vérifié sur Toilettes : 58+4+39+37+7+22 = 167 ✓) ;
  2. la somme des 9 pièces vaut 5 628 W = champ « Pertes de chaleur totales, base (W) : 5628 » du
     récapitulatif (avec surface chauffée 145,6 m² et volume 361,15 m³) ;
  3. les 9 couples (θa, puissance) du `.Pc1` sont identiques aux blocs du `.dep`.
- **Détail par paroi disponible** : chaque ligne porte U (jour/nuit), surface nette, ΔT, b et
  pertes (W) ; les ponts thermiques sont détaillés en Ψ linéiques (codes type `PB-TP-ITS-l3.1`,
  longueurs) ; le renouvellement d'air par pièce est en 0,34 × débit × ΔT. Le fichier suffit donc
  à **ressaisir intégralement le cas dans notre outil** sans faire tourner le logiciel.
- Non identifié (et non nécessaire) : un second nombre par pièce (ex. 1 053 pour Toilettes,
  étiquettes `Pe :`/`Qi :`) — probablement la puissance d'émetteurs installée ; ne pas l'utiliser.

## 2. Ce qui reste pour la phase A/B (après le plan 5)

1. **Comparaison écran contre le logiciel historique.** Protocole : ressaisir dans les deux outils
   les 2 cas manuels (§1.2) **et** le fichier exemple 232477 (§1.3, toutes les entrées sont dans le
   `.dep`). Tolérance : **±5 % pièce par pièce** (pas seulement sur le total — un total juste peut
   cacher deux erreurs opposées). Écart attendu et à examiner en priorité : les ponts thermiques
   (Ψ linéiques dans le logiciel vs forfait ΔUtb chez nous) et la répartition du renouvellement
   d'air par pièce.
2. **Calibration de la correction d'altitude de θe** : protocole complet dans
   `docs/thermique-calibration-altitude.md`. Le point Ceyzériat (300 m, −10 → −11) extrait du
   fichier exemple s'ajoute au point Amanzé (350 m, −10 → −11) déjà relevé.
3. **Calibration du `facteurAjustement` de la consommation** (`consoAnnuelle`, défaut 1,0 —
   apports gratuits/intermittence) : comparer le besoin annuel DJU à la section « consommation »
   du logiciel (présente dans le fichier exemple) et/ou à des factures réelles.
4. Vérification émetteurs 35/45/55 °C (loi d'émission exposant 1,3) — plan 4, écran résultats.
5. TODO — Fallback DJU départemental à créer (`refDataResolvers.djuPour`) avant le câblage UI —
   ~750 communes ont `dju` null (Var, Corse, DOM) ; règle à trancher (DJU du chef-lieu ou médiane
   départementale).

## 3. Hypothèses assumées, à challenger pendant l'A/B

- **Forfait ΔUtb pour les ponts thermiques** (majoration en W/(m²·K) sur les parois, choix
  org/UI) au lieu des Ψ linéiques du logiciel — la contribution est isolée dans le poste
  `pontsThermiques` pour être comparable.
- **Répartition de la ventilation** : débit total × facteurDebit réparti au prorata du volume des
  pièces sèches, pièces humides à 0 W (l'air de transfert arrive à θint) — EN 12831 simplifiée ;
  le logiciel affiche un débit par pièce potentiellement différent. Les `facteurDebit` 0,75
  (hygro) et rendement 0,7 (double flux) de `ventilation.json` sont des défauts **non sourcés**,
  exposés comme hypothèses éditables.
- **Fourchettes affichées** : puissance −5 %/+10 % (asymétrique côté sécurité), coût de
  consommation ±15 % (cumul d'hypothèses DJU) — vérifier qu'elles contiennent bien les valeurs du
  logiciel et la réalité terrain.
- **Charge partielle hplib** : pour les PAC « Regulated » (inverter), P_th(θ) du catalogue est le
  point certifié EN 14825 **en charge partielle adaptée**, pas la capacité maximale — le point de
  bivalence porte `avertissementChargePartielle` ; confronter aux données constructeur pendant
  l'A/B.
- **Infiltrations/étanchéité** : non modélisées séparément en v1 — absorbées dans le terme
  ventilation (taux/débits) ; un modulateur d'étanchéité qualitative pourra être ajouté à
  l'assemblage (plan 4).
- **Terre-plein** : pas de table U-équivalent en v1 (`coefficients-b` couvre vide sanitaire/sous-sol)
  — saisie d'un U équivalent direct en attendant, table à ajouter si le besoin terrain le confirme.
