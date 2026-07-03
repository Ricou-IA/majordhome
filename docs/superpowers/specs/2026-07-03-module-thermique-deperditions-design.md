# Module Thermique — Étude de déperditions & dimensionnement PAC (design)

**Date** : 2026-07-03 · **Statut** : validé avec Eric (brainstorming session C:\Thermique)
**Objectif** : outil terrain dans Majord'home permettant à un installateur **non-ingénieur** de calculer les déperditions thermiques d'une maison individuelle existante, pièce par pièce (EN 12831), pour dimensionner une pompe à chaleur (puissance, point de bivalence, émetteurs) et produire un rapport PDF client.

## 1. Contexte et décisions cadres

Eric dispose d'un logiciel Windows historique (« Thermique » / « Déperditions-Tableur », C:\Thermique) : binaires sans source, mais **bases de données en texte lisible** (bibliothèque parois 77 Ko, matériaux par famille, météo par ville avec altitude, ponts thermiques, menuiseries, coefficients b…) et documentation complète. Ce logiciel sert de **référence de validation**, ses données sont **converties et réutilisées**.

Décisions actées pendant le brainstorming :

| Question | Décision |
|---|---|
| Utilisateurs | Installateurs/commerciaux sur le terrain (tablette), non-ingénieurs |
| Méthode | EN 12831 pièce par pièce (nécessaire pour les émetteurs), **sans suroptimisation** : forfaits assumés, fourchettes affichées — les puissances PAC sont de toute façon majorées ensuite |
| Plateforme | Web, intégré à **Majord'home** (`src/apps/thermique/`), connexion supposée (pas de hors-ligne v1) |
| Livrables | Puissance PAC + point de bivalence · puissance par pièce (émetteurs) · rapport PDF + estimation conso annuelle |
| Données | Reprise des bases C:\Thermique (conversion one-shot) + tables réglementaires Open3CL (MIT) + courbes PAC hplib (MIT) |
| Périmètre v1 | Maison individuelle existante uniquement |
| UX | **Saisie par dessin du plan** (canevas tactile), pas de tableur |
| Nom | Module « Thermique », table `thermal_studies` |

### Recherche open source (2026-07-03)

- **Aucune implémentation mature de l'EN 12831-1:2017 n'existe en open source.** Références d'implémentation : `heaty`/`python-hvac` (structure 2017, Python), `heatlossjs` (pièce par pièce mais norme 2003, AGPL — ne pas copier de code).
- **Open3CL** (github.com/Open3CL/engine, MIT, très actif, validé sur 10 000 DPE ADEME) : réutiliser ses **tables JSON réglementaires** (U par défaut par période de construction, zones climatiques, altitude).
- **hplib** (github.com/RE-Lab-Projects/hplib, MIT) : base de ~6 000 PAC réelles (Keymark) avec modèle puissance/COP = f(T° source, T° départ) → courbes machine pour la bivalence.
- Open data utile plus tard : base DPE ADEME (pré-remplissage par adresse), BDNB.

Le moteur EN 12831 lui-même est **écrit par nous** (calcul algébrique borné, quelques centaines de lignes JS).

## 2. Architecture

Calquée sur le **module Solaire** (`docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md`), patron éprouvé :

```
src/apps/thermique/
├── routes.jsx                  # /thermique, /thermique/historique (RouteGuard resource=thermal_study)
├── pages/                      # ThermiqueWizard, ThermiqueHistorique
├── components/                 # étapes wizard, canevas, panneau résultats, PDF
├── lib/
│   ├── thermalEngine.js        # moteur EN 12831 PUR (aucun import React/Supabase)
│   ├── geometryEngine.js       # déduction parois/adjacences/orientations depuis le plan (PUR)
│   ├── heatPumpEngine.js       # bivalence + conso degrés-jours (PUR)
│   └── etudeModel.js           # buildEtudeModel = source de calcul unique UI ↔ PDF
└── data/                       # JSON statiques de référence (voir §5)
```

- **Permission** : `thermal_study.view` dans le registre app-level, seed façon `pv_calculator` (commercial/team_leader ✅, technicien ❌), configurable Settings → Permissions. `org_admin` bypass.
- **Sidebar** : entrée « Thermique » (icône Thermometer).
- **Calcul côté navigateur**, instantané à chaque modification. Les moteurs sont purs et déterministes.
- **Config org** : `core.organizations.settings.thermique` (défauts métier : T° intérieures par pièce, forfait relance, régimes d'eau proposés, catalogue PAC de l'org), page `/settings/thermique` (org_admin). ⚠️ `org_update_settings` merge niveau 1 → toujours sauver l'objet `thermique` complet via `useOrgSettings().save({ thermique })`.

## 3. Base de données

Table `majordhome.thermal_studies` :

```sql
id uuid PK, org_id uuid NOT NULL FK core.organizations,
client_id uuid NULL FK majordhome.clients,
lead_id uuid NULL FK majordhome.leads,          -- rattachement client OU lead (XOR non imposé : les 2 NULL = étude libre)
created_by uuid NOT NULL,
title text,                                      -- ex. "Maison Dupont — Gaillac"
input jsonb NOT NULL,                            -- saisie complète (site, bâtiment, niveaux/pièces dessinées, parois, PAC choisie)
results jsonb,                                   -- sorties du moteur (par pièce, totaux, bivalence, conso)
engine_version text NOT NULL,                    -- rejouabilité : une étude ancienne affiche ses résultats persistés
status text DEFAULT 'draft',                     -- draft | completed
created_at, updated_at
```

Conformité charte multi-tenant (CLAUDE.md) :
- RLS activée dès la création, policies CRUD scopées `org_id` (SELECT membre ; écritures owner-or-admin, comme `pv_simulations`).
- Vue publique `majordhome_thermal_studies` `WITH (security_invoker=true)`, **miroir simple updatable** (pas de JOIN/LATERAL), `GRANT SELECT TO service_role`.
- Frontend : lectures/écritures via la vue, filtre `.eq('org_id', orgId)` explicite partout.
- Cache keys : famille `thermalKeys` dans `cacheKeys.js`, `all: (orgId) => ['thermal', orgId]`.
- Brouillon local : `thermal-draft:${userId}` (convention localStorage suffixée).
- Service `thermal.service.js` (pattern `{ data, error }`, `withErrorHandling()`), hook `useThermalStudies`.

L'étude apparaît dans la fiche client (onglet/section « Études ») et peut se lancer depuis un client ou un lead — c'est le lien demandé avec les dossiers clients existants.

## 4. Moteur de calcul (thermalEngine.js)

### Entrées (modèle `input`)

- **Site** : département + altitude (dérivés de l'adresse client géocodée, modifiables) → **θe température extérieure de base** (table par département + correction altitude).
- **Bâtiment** : année de construction (→ U par défaut), type de ventilation (naturelle, VMC SF auto, VMC SF hygro, VMC DF), étanchéité qualitative.
- **Pièces** (issues du dessin, §6) : nom typé, surface, hauteur, θint de consigne par défaut selon type (séjour 20, chambre 18-20, SdB 24…, défauts org-configurables), chauffée/non chauffée.
- **Parois** (déduites du dessin + compositions) : type (mur ext, mur sur LNC, mur mitoyen logement voisin, plancher bas, plafond/comble, toiture, menuiserie), surface nette, orientation, adjacence, U.

### U d'une paroi — 3 modes, du plus rapide au plus précis
1. **Défaut par période de construction** (tables Open3CL) — 1 clic.
2. **Composition** depuis la bibliothèque convertie : U = 1/(Rsi + Σ e/λ + Rse).
3. **U saisi directement** (DPE récent, étude existante).

### Calculs par pièce (EN 12831 simplifié assumé)
- **Transmission** : ΦT = Σ A·U·b·(θint − θe), avec :
  - b = 1 parois sur extérieur ; coefficient b tabulé pour LNC (garage, comble, cellier — reprise tables Coefficients-b) ;
  - plancher sur terre-plein / vide sanitaire : U équivalent tabulé (approche forfaitaire, pas de calcul ISO 13370 complet) ;
  - parois mitoyennes entre pièces chauffées du même logement : **non déperditives** (ignorées), sauf ΔT entre consignes > 4 K (transfert interne calculé) ;
  - **ponts thermiques : majoration forfaitaire** du ΦT selon le type d'isolation (ITI/ITE/non isolé, points % tabulés). Pas de catalogue ψ en v1.
- **Ventilation** : ΦV = 0,34 · V̇ · (θint − θe), débits déduits du type de ventilation (taux de renouvellement global réparti, ou débits réglementaires par pièce humide/sèche), modifiables.
- **Relance** (optionnelle) : ΦRH = fRH · A, facteur forfaitaire selon intermittence (défaut org).
- **Sorties pièce** : Φtotal, détail par poste, **température d'eau requise des émetteurs** : pour les radiateurs existants saisis (optionnel), vérification puissance à 35/45/55 °C via loi d'émission (exposant 1,3).

### Sorties bâtiment
Φtotal à θe base, ratio W/m² (garde-fou), décomposition par poste (murs/toiture/plancher/menuiseries/PT/ventilation), **fourchette affichée** (± tolérance assumée) plutôt qu'un chiffre au watt.

## 5. Volet PAC (heatPumpEngine.js)

- **Courbe de charge bâtiment** : droite Φ(θext) entre (θe base, Φtotal) et (θnon-chauffage, 0) — θnc défaut 16 °C configurable.
- **Courbe machine** : puissance calo et COP = f(θext, θdépart) depuis **hplib** (extrait embarqué : modèles air/eau du marché FR + génériques) OU saisie manuelle de 3-4 points constructeur. Régime d'eau choisi (35/45/55 °C).
- **Résultats** : point de bivalence (intersection), puissance d'appoint nécessaire à θe base, taux de couverture énergétique, alerte si bivalence trop haute/basse.
- **Conso annuelle** : méthode des **degrés-jours** par tranches de température (bin method simplifiée sur la station météo du département, données converties de C:\Thermique/Météo), COP variable par tranche → kWh élec/an, coût via tarifs énergie (table convertie, éditable org). Estimation présentée comme telle (fourchette).

## 6. Interface de dessin (geometryEngine.js + canevas)

**Principe : on dessine le plan, l'outil déduit les parois.**

- Canevas **SVG React** (pas de lib CAD lourde), événements pointeur → tactile tablette (viewport 1024 déjà géré par `deviceViewport.js`).
- Par **niveau** (RDC, étage 1…, hauteur sous plafond par niveau) : pièces tracées comme **rectangles accolés** (option polygone), **grille d'accrochage 10 cm**, cotes live, duplication de niveau.
- Chaque pièce : nom typé (liste), chauffée / **non chauffée** (garage, cellier…).
- **Déductions automatiques** (code pur, très testé) :
  - segment de contour sans voisin → **mur extérieur**, orientation lue sur le plan (rose des vents affichée, nord réglable) ;
  - segment partagé entre 2 pièces chauffées → mitoyen interne (ignoré ou ΔT) ; avec pièce non chauffée → paroi sur LNC (coefficient b) ;
  - RDC → plancher bas (terre-plein/vide sanitaire/sous-sol au choix) ; dernier niveau → plafond sur comble ou rampant ; niveaux intermédiaires → planchers internes non déperditifs (sauf pièce sur LNC, ex. chambre sur garage — détecté par superposition des plans) ;
  - surfaces de murs = périmètre × hauteur − ouvertures.
- **Ouvertures** : tap sur un mur → fenêtre/porte (types bibliothèque, dimensions standards proposées), déduites de la surface du mur.
- **Compositions par familles** : réglages globaux (« tous les murs extérieurs = X », « toiture = Y ») avec **exception par paroi** — 3-4 choix suffisent pour un cas courant.

**Garde-fous saisie** (alertes non bloquantes) : chevauchement de pièces, niveau sans pièce chauffée, W/m² hors fourchette de vraisemblance par période de construction, U hors bornes.

## 7. Wizard et écrans

1. **Contexte** — client/lead pré-rempli (adresse → dept, altitude, θe affichés), année, ventilation.
2. **Dessin** — niveaux/pièces (§6).
3. **Ouvertures & compositions** — pose des menuiseries, choix globaux + exceptions.
4. **Résultats & PAC** — plan coloré avec **watts par pièce**, total + fourchette + W/m², décomposition par poste (graphique), onglet PAC (régime, machine → bivalence, conso), bouton **rapport PDF**.

Sauvegarde continue : brouillon localStorage puis `thermal_studies` (status draft → completed). Historique `/thermique/historique` + rattachement fiche client.

## 8. Rapport PDF

- `@react-pdf/renderer`, branding `buildCompanyInfo(settings)` (multi-tenant, fallback neutre).
- **`buildEtudeModel` = source de calcul unique** partagée écran résultats ↔ PDF (pattern Solaire) ; régénération possible depuis l'historique via `input`+`engine_version` persistés.
- Contenu : synthèse (puissance, bivalence, conso), plan par niveau (SVG → primitives PDF), tableau par pièce, décomposition par poste, hypothèses (U retenus, ventilation, θe) — transparence des forfaits.
- Graphique bivalence **redessiné en primitives** (pas de capture).
- **Formatters PDF-safe obligatoires** (gotcha Helvetica : espaces U+202F, virgule FR, pas de symboles Unicode).

## 9. Données de référence (`src/apps/thermique/data/` + `scripts/convert-thermique-data.mjs`)

| Fichier JSON | Source | Contenu |
|---|---|---|
| `climat.json` | C:\Thermique (météo, altitude) + vérif textes réglementaires | θe base par département, corrections altitude, degrés-jours/bins par station |
| `materiaux.json`, `parois-types.json` | C:\Thermique/Composants + Bibliothèque Parois.txt | λ, e, R ; compositions types |
| `u-defauts.json` | Open3CL (MIT) | U par défaut par type de paroi × période de construction |
| `menuiseries.json` | C:\Thermique (Vitrages, Menuiseries, Volets, WarmEdge) | Uw types |
| `coefficients-b.json` | C:\Thermique/Coefficients-b.txt | b par type de LNC |
| `ventilation.json` | débits réglementaires logement | taux/débits par type de VMC |
| `pac-catalogue.json` | hplib (MIT), extrait | courbes P/COP modèles air/eau FR + génériques |
| `tarifs-energie.json` | C:\Thermique/Tarif Energie.txt (base, éditable org) | €/kWh par énergie |

Le script de conversion est **versionné et rejouable** (si Eric enrichit ses bibliothèques). Provenance et licence notées dans chaque JSON (`_source`). Les données C:\Thermique appartiennent à l'usage d'Eric ; les tables Open3CL/hplib sont MIT (attribution dans le code).

## 10. Fiabilité, erreurs, tests

- **Tests moteur** : `node --test scripts/thermal-engine.test.mjs` — cas de référence calculés à la main (pièce simple, LNC, terre-plein, ventilation par type, relance, bivalence, degrés-jours).
- **Tests géométrie** : `scripts/geometry-engine.test.mjs` — adjacences, orientations, mitoyennetés, superposition de niveaux, surfaces nettes. Partie la plus originale = la plus testée.
- **Validation croisée** : 3-4 cas ressaisis dans le logiciel Thermique original (dont le fichier exemple `Dossiers/232477`) — **écart cible ±5 %** pièce par pièce, documenté dans `docs/thermique-validation.md`.
- **Erreurs** : schémas zod sur `input` avant sauvegarde ; services `{ data, error }` ; `{ error }` destructuré sur toute mutation ; moteurs purs → pas d'I/O à gérer ; anciennes études = résultats persistés affichés, jamais de recalcul silencieux après montée de version moteur.
- Lint/dead-code : conventions repo (pre-commit `lint:errors`, `audit:dead-code` avant PR).

## 11. Hors périmètre v1 (extensions naturelles ensuite)

Catalogue détaillé ψ de ponts thermiques · collectif/tertiaire · mode hors-ligne (PWA) · préconisation automatique de modèles PAC · pré-remplissage par la base DPE ADEME · export devis Pennylane · ECS (dimensionnement ballon thermodynamique).
