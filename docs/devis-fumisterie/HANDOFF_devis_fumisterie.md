# HANDOFF — Assistant de devis fumisterie (agent Hermes) — Mayer Énergie

> Document de passation rédigé le 2026-09-28 à l'issue d'une session Cowork.
> À placer dans le repo Majordhome (ex. `docs/devis-fumisterie/`) et à référencer depuis le `CLAUDE.md` du repo.

---

## 1. Objectif

Permettre à l'agent **Hermes** de produire des **devis de conduits de fumée** (création, tubage, raccordement) pour Mayer Énergie, à partir :

- du **catalogue MODINOX / ALTEMA 2026** (configurations types) ;
- du **tarif Mayer** (`MAYER002.xlsx`, prix nets déjà remisés).

**Périmètre métier : bois bûche + granulés (pellets) UNIQUEMENT.** Pas de gaz, pas de fioul, pas de charbon.

---

## 2. Décisions d'architecture (validées par Eric)

| Contenu | Où | Usage par Hermes |
|---|---|---|
| Base articles + prix | **Supabase** (tables) | requête SQL |
| Configurations types (critères + nomenclature) | **Supabase** (tables) | filtrage déterministe sur critères |
| Guide de choix (combustible × type d'évacuation → gamme) | **Supabase** | lookup |
| Mapping composant → article + règles de métré | **Supabase** / fonction SQL ou workflow n8n | calcul quantités & prix |
| Réglementation (DTU 24.1, avis techniques, notices) | **RAG** | justification / questions ouvertes uniquement |

**Principe clé : pas de RAG vectoriel pour les configurations ni les prix.** La similarité sémantique confond D80/D100, zone 1/zone 2, PLA/PTR. Le LLM sert à **qualifier la demande** (extraire appareil, combustible, projet, zone) puis appelle des outils déterministes.

Flux cible Hermes :
1. Qualification en langage naturel → critères structurés.
2. Outil → configurations compatibles.
3. Questions de métré propres au type de projet.
4. Calcul (SQL / n8n) → lignes de devis (code article, quantité, prix net).
5. RAG seulement pour justifier une règle.

---

## 3. Fichiers livrés

| Fichier | Contenu |
|---|---|
| `bibliotheque_configurations_modinox_v1.json` | 19 configurations (bois + granulés), guide de choix (3 lignes bois/pellets), 9 règles techniques, référentiels, questions de métré par type de projet. Version schéma 1.1. |
| `MAYER002.xlsx` | Tarif Mayer juin 2026 — 12 006 articles (onglet `Tarif Juin26`) + onglet `Conditions tarifaires`. |
| `HANDOFF_devis_fumisterie.md` | Ce document. |

### 3.1 Structure du JSON

- `_meta` : source, règle index image, légende des statuts, format des références observé.
- `referentiels` : appareils, combustibles (`bois_buches`, `pellets`), prise d'air, projets, zones 1/2/3, `questions_metre_par_projet`.
- `guide_de_choix_gammes` : matrice p.49 (lignes bois uniquement).
- `regles_techniques` : R-POLYPERF-01..05, R-MFI-01..02, R-EXT-01, R-CHAUDIERE-PELLETS-01.
- `configurations[]` : `id`, `titre`, `page_catalogue`, `index_image`, `criteres` (projet, appareils, combustibles, zones, prise_air, appareil_etanche_requis, conditions), `gamme_principale`, `nomenclature[]` (ordre, position, composant, chapitre, gamme, choix/alternatives), `regles_associees`, `remarques`.
- `a_completer_etape_suivante`.

**Statuts** : `catalogue` (lu sur la page), `deduit` (à confirmer), `propose` (questions de métré, à valider par un technicien), `a_completer`.

### 3.2 Catalogue source

- Visionneuse : https://catalogues.altema.pro/html/catalogue_modinox_1048/
- **Pas de PDF**, pages en SVG sans couche texte → lecture par modèle de vision uniquement.
- Image HD d'une page (1594×2197) : `https://it4resources.interactiv-doc.fr/catalogues/catalogue_modinox_1048/pages/page{index}.png` avec **index = n° de page imprimé + 2**.
- Données produits par page (codes articles des boutons panier) : `https://catalogues.altema.pro/hotspots/catalogue_modinox_1048/{index}.json` — champ `tooltipText` = libellé, `link` = `javascript:addToCart('CODE')`.

---

## 4. Analyse du tarif `MAYER002.xlsx` (onglet `Tarif Juin26`)

Colonnes : `Références articles`, `Désignation Article`, `Famille N1`, `Libellé Fam. N1`, `Famille N2`, `Libellé Fam. N2`, `Famille N3`, `Famille N4`, `Unité de vente`, `EAN`, `TARIF 06/26`, `Remise à la famille`, `Remise à l'article`, `Prix net`, `Prix pour client`.

### Constats vérifiés
- **`Prix pour client` = prix net Mayer final.** Vérifié sur 100 % des lignes : intègre remise famille N2, remise spécifique N3 (famille 598 Polyperf → 34 %, qui remplace les 50 % de la famille 244) et prix spécifiques (2 Polylisse XT). **Ne pas recalculer de remise.**
- Remises famille N2 : PTR 50 %, Lame d'air/PLA 47 %, MFI 45 %, Émaillés 60 %, Inox 304 50 %, Laqués 65 %, Inox 316 SP 55 %, Accessoires gaine 50 %, Flexibles inox 316 70 %, Polyperf 50 % (34 % en N3 598), Solins fumée 60 %, etc.
- **Désignation structurée** : `GAMME - COMPOSANT - attributs` (séparateur ` - `). Attributs : `D 80`, `D 80/125`, `LG 500`, `L 1400`, pente `24 A 31°`, couleur `NOIR`/`BLANC`/`INOX`/`RAL : XXXX`, version `V2`.
- Codes articles encodés (ex. `2PRWTUYA100330` = PRH, élément droit, Ø100, Lg 330 ; suffixe `NO` = noir).

### Pièges à gérer
1. **Noms de gammes tarif ≠ catalogue** :
   - PTR30 → `PTR30+ I` (inox), `PTR30+ LAQ`, `PTR30+ G` (galva), `PTR30+ G LAQ`, `PTR30 CUI`, `PTR50`
   - PLA → `PLA`, `PLA G`, `PLA CGC`
   - PRH → `PRH 6/10`, `PRH 8/10`, `PRH 5/10 BRIL`, `PR6 6/10`
   - Émaillé → `EMAIL LIGNE +`, `EMAIL PEL`
   - Acier peint → `MC ACIER PEINT 2 MM`, `MC ACIER PEINT 1,2 MM`
   - MFI → `MFI I`, `MFI LAQ`, `MFI G`, `MFI`
   - Polyperf → `FLEXIBLE ISOLE POLYPERF FIBRE`, `FLEXIBLE` (famille 244)
   → **Règles par défaut à faire valider par Eric** (fichier de paramètres).
2. **116 articles en unité `ML`** (flexibles) : prix au mètre, quantité = longueur.
3. **Polyperf vendu en kits de longueur fixe** (5 à 14 ML, pièces de finition incluses) → choisir le kit ≥ besoin.
4. **Articles sur mesure / prix indicatif** (`RAL : XXXX`, `D xxx`, `A PRECISER`, `………`) → ne jamais chiffrer automatiquement, signaler.
5. **Versions** (PLA avec/sans `V2`) → ne retenir que la gamme actuelle (catalogue p.298 « Gamme PLA actuelle – tarif 2026 »).
6. **Familles hors périmètre** à exclure : N1 22 `GAZ-FIOUL / VENTOUSES` (N2 221 POLYPROP.), et tout article gaz/fioul/charbon (ex. `POLYLISSE 904L`, `ALUMINIES`).

### Répartition (N2 principales)
PTR 2 716 · Lame d'air/PLA 1 726 · Accessoires gaine 1 029 · Inox 316 SP 808 · MFI 806 · Inox 304 SP 802 · Finitions 464 · Ramonage 393 · Souches carrées 352 · Solins 339 · Grilles 314 · Émaillés 292 · Laqués 254 · GIDI 240 · Polyperf 189.

---

## 5. Prochaines étapes (dans l'ordre)

> ⚠️ **Règles de travail d'Eric : demander systématiquement l'autorisation avant de coder ; livrer des fichiers complets (jamais d'extraits) ; commandes terminal en PowerShell ; UI en palette jaune/bleu (#F5C542/#FFD166, #2196F3/#1565C0/#0D47A1), jamais rouge/vert seuls, toujours couleur + icône + libellé.**

1. **Proposer le schéma Supabase** (avant toute création) :
   - `fum_articles` (code, désignation, famille N1/N2/N3, gamme_tarif, type_piece, diametre, diametre_ext, longueur_mm, pente, couleur, version, unite, prix_net, sur_mesure bool, actif bool)
   - `fum_configurations`, `fum_config_criteres`, `fum_config_composants`
   - `fum_guide_choix`, `fum_regles`
   - `fum_mapping_composant_article` (composant, gamme_catalogue, gamme_tarif, motif désignation, diamètre → code)
   - `fum_parametres_defaut` (choix par défaut : inox/noir, épaisseur PRH, émaillé ligne+/pellet…)
2. **Script Python de parsing du tarif** → table articles enrichie, périmètre bois/granulés.
3. **Mapping composant → article** + **rapport de couverture** : pour chaque config × diamètres courants (80, 100, 130, 150, 180), composants trouvés / manquants.
4. **Règles de métré** (à co-construire avec un technicien Mayer) : longueurs d'éléments, supports tous les X m, composants implicites (colliers, tampons de ramonage, plaques de finition), choix par défaut quand le catalogue propose des « ou ».
5. **Compléter depuis le catalogue** : p.80-89 (conditions zones 2/3 PLA, chaudières pellets), chapitres produits (longueurs/diamètres), p.264-293 (réglementation → RAG), p.298 (gamme PLA actuelle).
6. **Outil Hermes** : fonction/workflow qui prend les critères + réponses de métré et renvoie les lignes de devis.

---

## 6. Points ouverts / vigilance

- **3 éléments déduits** (non lus) : gamme PTR30 en CFG-42, prise d'air en CFG-29. À confirmer.
- **Zones 2 et 3** : conditions précises absentes (p.80-89) → tant que non intégrées, toute config zone 2/3 = validation technicien obligatoire.
- **MFI** : bloquant si l'appareil n'a pas de fiche appareil Modinox (R-MFI-01).
- **Chaudières pellets** : uniquement les modèles listés en CFG-48.
- Prix = **prix publics remisés Mayer juin 2026** ; prévoir procédure de mise à jour annuelle (nouveau tarif + nouveau catalogue).

---

## 7. Prompt de démarrage suggéré pour Claude Code

```
Lis docs/devis-fumisterie/HANDOFF_devis_fumisterie.md puis
docs/devis-fumisterie/bibliotheque_configurations_modinox_v1.json.
Inspecte le tarif docs/devis-fumisterie/MAYER002.xlsx.
Via le MCP Supabase, liste les tables existantes du projet Majordhome.
Propose-moi ensuite le schéma des tables fum_* (étape 5.1) SANS rien créer :
je valide avant toute migration.
```
