# Dimensionnement d'une climatisation — moteur partagé Majord'home / site Mayer

**Date** : 2026-10-06 · **Statut** : validé par Eric (chat), implémentation lancée le jour même.
**Décisions fondatrices** : (1) le catalogue Solipac est importé dans `supplier_products`, prix de vente saisis à la main ;
(2) un petit outil de dimensionnement dans Majord'home, moteur PUR copié par le site Mayer pour un questionnaire
prospect sur le modèle du tunnel de conseil-solaire.fr.

## 1. Objectif

Donner au commercial (puis au prospect sur le site) une puissance frigorifique par pièce, un choix d'unités dans le
catalogue Hitachi airHome distribué par Solipac, un groupe multi-split compatible et les liaisons cuivre, avec les
avertissements de sur ou sous-dimensionnement. Le chauffage principal n'est PAS calculé ici : c'est le module Thermique.

## 2. Références métier retenues

| Règle | Valeur par défaut | Source |
|---|---|---|
| Base froid, 2,50 m sous plafond | 100 W/m² | travaux.com, espace-aubade |
| Isolation : RE2020/BBC · RT2012 · standard rénové · ancien · non isolé | 70 · 80 · 100 · 125 · 150 W/m² | fourchettes 65-80 / 75-100 / 100 / 125 / 150 des mêmes sources |
| Hauteur sous plafond | au prorata de 2,50 m (3 m = ×1,2) | travaux.com |
| Exposition de la pièce | nord −10 %, est 0, ouest +5 %, sud +15 % | travaux.com (sud/nord), ouest provisoire |
| Vitrage non protégé | 150 W/m² de vitrage plein sud ; 130 ouest, 90 est, 30 nord ; ×0,5 si volets/stores | travaux.com (150 W/m² baie sud-ouest), déclinaison provisoire |
| Occupants | +100 W par personne au-delà de 2 | travaux.com |
| Appareils | W déclarés (bureau 150, cuisine 500…) | travaux.com |
| Sous toiture (dernier étage, combles aménagés) | +10 % | provisoire |
| Zone climatique de l'org (Tarn, été chaud) | +5 % | provisoire, réglable |
| Contrôle croisé volume | 100 BTU/m³ + 1 000 BTU par paroi vitrée, ÷ 3 415 | hellowatt |
| Choix d'unité | plus petite unité ≥ besoin × 0,95 ; alerte si > besoin × 1,30 | espace-aubade (cycles courts) |
| Multi-split | Σ kW des unités intérieures ≤ 130 % du nominal froid du groupe, sorties min/max de la brochure Hitachi | brochure airHome Multi Pro, ratio provisoire |
| Liaisons | ≤ 3,5 kW : 1/4-3/8 · ≤ 6 kW : 1/4-1/2 · au-delà : 3/8-5/8 ; couronnes 20 m / 50 m | usage installateur, provisoire |

Toutes ces valeurs vivent dans `settings.clim` (Settings → Socle → Climatisation), défauts dans `src/lib/clim/config.js`.
« Provisoire » = à confirmer avec Philippe à l'usage, comme les règles fumisterie.

## 3. Moteur pur `src/lib/clim/`

- `config.js` : `DEFAULTS_CLIM`, `buildClimConfig(settings)` (merge niveau 2, jamais un sous-objet partiel à la sauvegarde).
- `dimensionnement.js` : `ENGINE_VERSION`, `CLASSES_ISOLATION`, `EXPOSITIONS`, `classeDepuisAnnee`, `besoinPiece`,
  `choisirUnite`, `composerMulti`, `liaisons`, `catalogueDepuisProduits`, `dimensionner` (point d'entrée unique),
  `lignesDevis`. Aucun import React/Supabase/alias ; JSDoc sur chaque export ; testé par
  `node --test scripts/clim/dimensionnement.test.mjs` sur le tarif Solipac réel (`scripts/clim/data/solipac-2026-10.json`).
- Entrées : `{ logement: { classe_isolation | annee, zone_majoration?, gamme: '200'|'400'|'600' }, pieces: [{ nom, surface_m2,
  hauteur_m, exposition, vitrage_m2, protection_solaire, occupants, appareils_w, sous_toiture, longueur_liaison_m }] }`.
- Sorties : par pièce `{ besoin_w, detail, controle_btu, unite, alertes }` ; `mono` = un pack par pièce ;
  `multi` = groupe + unités (null si impossible, avec la raison) ; `liaisons` ; `alertes` globales ; `lignes_devis`
  (même forme que `versLignesDevis` du métré fumisterie : prix d'achat porté, prix de vente 0 ⇒ « À CHIFFRER »).
- Rien n'est avalé : une pièce incomplète refuse le calcul (`validerReleve`), une unité introuvable produit une alerte,
  un prix de vente à 0 reste visible sur le devis.

## 4. Écran Majord'home

- Route `/clim` (sidebar « Climatisation », `RouteGuard resource="devis"`, module CRM), page `src/apps/clim/pages/Dimensionnement.jsx`
  en deux volets : logement + pièces à gauche, résultat vivant à droite. Brouillon `localStorage clim-draft:${userId}`.
- Catalogue = `useAllProducts(orgId)` filtré `category === 'climatisation'` ; les specs importées (`specs.canonical`) portent kW et sorties.
- « Créer le devis » : si `?lead=<id>`, ouvre `CreateDevisModal` avec `initialLines` (famille Climatisation, lignes dans
  la section ÉQUIPEMENT / ACCESSOIRES) ; sinon un lien vers le pipeline pour choisir le lead.
- Réglages : tuile « Climatisation » du socle → `/settings/clim`, un onglet, sauvegarde de l'objet `clim` complet.

## 5. Partage avec le site Mayer

Le site copie `src/lib/clim/config.js` et `dimensionnement.js` tels quels (JS pur, JSDoc) et rejoue les cas du test sur
son propre runner ; brief dans `C:\Dev\Landing Page - Mayer\docs\superpowers\specs\2026-10-06-simulateur-clim-design.md`.
Une seule source de calcul, versionnée par `ENGINE_VERSION` : toute modif de règle ici doit être recopiée là-bas.

## 6. Hors périmètre

Chauffage (module Thermique), gainable Airzone (catalogue importé mais non dimensionné), prix de vente automatiques,
persistance des dimensionnements (V1 = brouillon local + lignes dans le devis).
