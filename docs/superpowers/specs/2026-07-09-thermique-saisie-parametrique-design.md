# Thermique — Pivot vers la saisie paramétrique par pièce

> **Statut** : design validé (brainstorming Eric, 2026-07-09) — prêt à passer en plan d'implémentation.
> **Périmètre** : points 5 + 6 + 1 des retours terrain (nouveau modèle de saisie, déperdition/émetteur par pièce, largeur de la zone de travail).
> **Hors périmètre (spec suivante)** : points 2 (curation matériaux), 3 (régime d'eau 65/70), 4 (température de zone PAC pour l'appoint bois).

## 1. Contexte & problème

L'étude thermique actuelle repose sur un **dessin géométrique** : l'utilisateur trace des rectangles sur une grille, et `deduireParois` (`geometryEngine.js`) déduit automatiquement, par adjacence, quels murs sont extérieurs vs mitoyens, la surface plancher/plafond, etc. C'est robuste (pas de double-comptage, détection auto) mais **lent et coûteux en temps sur le terrain** — ce n'est pas « agile ».

Retour Eric : *« dans un premier temps j'ai besoin d'efficacité »*. On assume la perte de la détection automatique mitoyen/extérieur : c'est désormais l'humain qui déclare les métrés (« ce mur fait 6 m d'extérieur »).

## 2. Décision structurante

**On remplace la couche de saisie, pas le moteur physique.**

Chaîne actuelle :
```
dessin (géométrie) → deduireParois → assembleBatiment → calculeBatiment
```
Chaîne cible :
```
saisie (emprise + pièces paramétriques) → assembleBatimentParametrique → calculeBatiment
```

`calculeBatiment` / `transmissionPiece` / `ventilationPiece` / tout le moteur PAC restent **inchangés** : ils consomment un `batiment = { thetaExt, systemeVentilation, debitTotal, fRH, plageVraisemblance, pieces: [{ id, nom, surface, volume, thetaInt, humide, parois: [...] }] }`. On écrit un **nouvel assembleur** qui produit ce même shape à partir des paramètres saisis. Le risque est donc **contenu à la couche d'entrée**.

### Approche B validée : double calcul + réconciliation

- **L'emprise au sol** (dessinée, une par niveau) donne une **déperdition globale** au niveau enveloppe (surface sol/plafond, périmètre extérieur).
- **La liste de pièces paramétriques** donne le **détail pièce par pièce**.
- L'outil **croise les deux** : alerte non bloquante si la somme des pièces s'écarte de l'emprise (surfaces, métré de murs extérieurs). C'est la « vérification globale ET pièce par pièce ».

## 3. Modèle de données

Nouveau sous-objet d'état `saisie` (remplace le rôle de `dessin` dans le flux paramétrique). Le shape fait partie du `input` jsonb persisté dans `majordhome.thermal_studies` (comme `dessin` aujourd'hui).

```js
saisie: {
  modeSaisie: 'parametrique',        // discriminant de routage (cf. §7 compat)
  plancherBasType: 'terre-plein',    // conservé (b plancher bas, D5) : terre-plein | vide-sanitaire | sous-sol
  toitureType: 'comble',             // conservé (b comble, D9)
  niveaux: [
    {
      id: 'rdc',
      nom: 'RDC',
      rang: 0,                        // 0 = rez (porte le plancher bas) ; max = dernier (porte le plafond)
      emprise: {                      // DESSINÉE (on garde le dessin pour l'emprise)
        polygone: [{x,y}, ...],       // contour cm, grille 10 cm (rectangle par défaut, polygone possible)
        // dérivés au calcul : surfaceSol (m²), perimetre (m)
      },
    },
  ],
  pieces: [
    {
      id: 'uuid',
      niveauId: 'rdc',
      nom: 'Séjour',
      typePiece: 'sejour',            // TYPES_PIECE inchangés (principale/humide/chauffeeParDefaut)
      chauffee: true,
      thetaInt: 20,                   // consigne °C (défaut org par type)
      // -- géométrie paramétrique --
      longueur: 500,                  // cm
      largeur: 400,                   // cm  → surface = L×l
      hauteur: 250,                   // cm  → PARAMÉTRIQUE PAR PIÈCE (défaut = hauteur de référence du niveau)
      // -- métrés d'enveloppe déclarés --
      mlMurExterieur: 900,            // cm de mur en contact extérieur
      mlMurLocalNonChauffe: 0,        // cm de mur en contact avec un local non chauffé
      bLocalNonChauffe: 0.6,          // coefficient b du LNC adjacent (défaut, éditable) — cf. §4
      surfaceOuverture: 3.2,          // m² de menuiserie (sur les murs extérieurs)
      typeMenuiserie: 'fenetre',      // fenetre | porteFenetre | porte → hérite du U menuiserie global
    },
  ],
}
```

Notes de modèle :
- **Plus d'`ouvertures[]` géométriques** : chaque pièce porte une **surface d'ouverture agrégée** + un **type de menuiserie**. La pose sur un mur précis disparaît (inutile pour le bilan de déperdition ; on gagne le temps).
- **Murs mitoyens entre pièces chauffées** : non saisis, non déperditifs (ΔT ≈ 0) — ignorés par construction. C'est LA simplification qui rend la saisie rapide.
- **Hauteur par pièce** : vrai paramètre (permet d'affiner la déperdition d'une pièce sous rampant, d'un cellier bas, etc.). Défaut = hauteur de référence du niveau ; surchargeable.
- Les niveaux gardent une **hauteur de référence** (défaut des pièces) mais elle n'est plus la seule source du volume.

## 4. Dérivation « params pièce → parois » (nouvel assembleur)

`assembleBatimentParametrique(saisie, options)` — module PUR, même signature de sortie que `assembleBatiment` (`{ batiment, thetaE, parois, erreurs, avertissements }`). Pour chaque pièce **chauffée** :

| Paroi générée | Surface | U | Référence température | Poste |
|---|---|---|---|---|
| Mur extérieur | `mlMurExterieur × hauteur − surfaceOuverture` | U murs | b = 1 (θe) | murs |
| Mur sur local non chauffé | `mlMurLocalNonChauffe × hauteur` | U murs | b = `bLocalNonChauffe` | murs |
| Menuiserie | `surfaceOuverture` | U menuiserie(type) | b = 1 (θe) | menuiseries |
| Plancher bas | `L×l` **si niveau rang 0** | U plancher bas | b = `bPlancherBasPour(...)` (D5, réutilisé) | plancherBas |
| Plafond / toiture | `L×l` **si niveau dernier rang** | U plafond | b = `coefficientB(comble)` (D9, réutilisé) | plafondToiture |

- **ΔUtb** (ponts thermiques) : appliqué comme aujourd'hui, majoration forfaitaire par `contexte.isolation` (`config.delta_utb`), sur les parois déperditives (murs ext, LNC, plancher, plafond). Réutilise le mécanisme existant.
- **b du local non chauffé** : sans géométrie, on ne peut pas compter les murs extérieurs du LNC. Donc **l'utilisateur choisit le coefficient `b`** (défaut 0,6, borné [0,1], éditable par pièce), ou choisit un preset (garage/cellier/véranda → b pré-rempli depuis `coefficients-b.json`). Décision : **preset + override manuel**.
- **Volume** pièce = `L × l × hauteur` (cm³ → m³). Alimente la ventilation.
- **Ventilation** : `debitVentilationPour(...)` inchangé (compte les pièces principales via `typePieceInfo`). Réutilisé tel quel.
- **Garde-fous surface** : `mlMurExterieur × hauteur − surfaceOuverture` doit être > 0 → sinon erreur pièce (« surface d'ouverture supérieure au mur extérieur déclaré »). Surface/volume ≤ 0 → erreur pièce.

Le `batiment` produit part ensuite dans `calculeBatiment` **sans aucune modification du moteur**.

## 5. Réconciliation globale ↔ pièces (la « vérif globale »)

Calculé en plus du bilan par pièce, à partir de l'emprise dessinée :

- **Surfaces** : `Σ (L×l des pièces du niveau)` vs `surfaceSol(emprise du niveau)`.
- **Métré extérieur** : `Σ mlMurExterieur (pièces du niveau)` vs `perimetre(emprise du niveau)`.
- **Déperdition globale enveloppe** : un bilan mono-zone rapide à partir de l'emprise (murs ext = `perimetre × hauteur_moy − Σ ouvertures`, plancher = `surfaceSol` au rez, plafond = `surfaceSol` au dernier niveau, θint = moyenne pondérée surface), comparé à `Σ déperditions pièces`.

Sortie : un **panneau de cohérence** (écart en % + valeurs côte à côte), **alerte non bloquante** au-delà d'un seuil (proposé : ±10 %). Objectif : donner à Eric les deux chiffres pour se rassurer, pas bloquer la saisie.

## 6. Résultats : déperdition par pièce + puissance émetteur (foisonnement)

Le tableau par pièce existe déjà (`PlanResultats`). On ajoute une **colonne « Puissance émetteur »** :

```
puissanceEmetteurPiece = deperditionPiece.total × foisonnement
```

- **Foisonnement** = coefficient org (`config.thermique.foisonnement_emetteur`, défaut 1,0), éditable dans `/settings/thermique`. Appliqué **par émetteur** (par pièce), pas au générateur (décision Eric : « par émetteur »).
- Affiché par pièce (dimensionnement radiateur/plancher chauffant de la pièce) + total.
- N'affecte **pas** le dimensionnement PAC (qui reste sur `bilan.total`) — c'est un dimensionnement d'émetteurs, distinct de la génération.

## 7. Compatibilité des études existantes

Le module est neuf (livré 2026-07-06) → volumétrie d'études réelles quasi nulle. Stratégie légère :

- **Routage par shape dans `buildEtudeModel`** : si `input.saisie?.modeSaisie === 'parametrique'` → `assembleBatimentParametrique` ; sinon (ancien `input.dessin`) → `assembleBatiment` existant.
- On **conserve** `geometryEngine.js` / `dessinOps.js` / `assembleBatiment.js` (non supprimés — règle repo Posture #3) pour que les **anciennes études restent recalculables**. On les **signale pour retrait** (spawn_task) une fois la migration confirmée sans usage.
- L'**UI de dessin par pièce** (`PlanCanvas` mode rectangle, `PieceInspector`, `Step2Dessin`, `Step3` pose d'ouvertures) n'est plus montée dans le wizard. Le **canevas d'emprise** réutilise le rendu SVG existant (contour unique éditable).
- Mode R7 (résultats figés) inchangé : une ancienne étude s'ouvre en frozen, avec sa bannière moteur.

## 8. UI / flux du wizard

Étapes remaniées (élargissement inclus, point 1) :

1. **Contexte** — inchangé (commune, année, ventilation, isolation…). Largeur mesurée (pas besoin de pleine largeur).
2. **Emprise & pièces** — remplace « Dessin » + « Ouvertures & compositions » :
   - Gauche : **canevas d'emprise** (dessin du contour au sol, par niveau) — **pleine largeur exploitée**.
   - Droite / dessous : **tableau des pièces paramétriques** (ajout ligne, champs L/l/H/ml ext/ml LNC/ouverture/menuiserie/type/θint/chauffée).
   - **Panneau de cohérence** (§5) en pied.
   - Les **compositions** (U murs / plancher / plafond / menuiseries, exceptions par pièce) restent éditables ici (réutilise `CompositionFamille` + `InputU`).
3. **Résultats** — synthèse + plan coloré (réutilise `PlanResultats`, alimenté par les polygones de pièce dérivés OU un rendu simplifié par pièce) + **colonne émetteur** + volet PAC (inchangé). `PlanResultats` : le plan coloré par pièce nécessite une géométrie ; en mode paramétrique on rend chaque pièce comme une **vignette rectangulaire L×l** (pas de position absolue), colorée par ratio W/m². Le tableau reste la source détaillée.

**Largeur (point 1)** : le conteneur du wizard passe de `max-w-4xl` à une largeur large sur l'étape 2 et 3 (ex. `max-w-7xl` ou pleine largeur `container`), l'étape 1 peut rester contrainte. Canevas d'emprise : hauteur ≥ celle d'aujourd'hui, responsive.

## 9. Configuration org (`/settings/thermique`)

Ajouts à `core.organizations.settings.thermique` (défauts dans `DEFAULTS_THERMIQUE`) :
- `foisonnement_emetteur` (défaut 1,0 ; borne [1,0 – 1,5]).
- Presets `b` locaux non chauffés (optionnel — sinon table `coefficients-b.json` + override manuel).

⚠️ Rappel : `org_update_settings` merge JSONB niveau 1 → toujours sauver l'objet `thermique` COMPLET (les tabs settings préservent déjà `parois_bibliotheque`).

## 10. Modules purs & tests (convention du module)

Nouveaux modules purs testables via `node --test` (pas de React/Supabase) :
- `assembleBatimentParametrique.js` — dérivation params → `batiment`. Tests : chaque type de paroi, garde-fous surface, plancher/plafond selon rang, ventilation, ΔUtb, b LNC.
- Helpers emprise (`surfaceSol`, `perimetre` depuis polygone) — réutilise `geometryEngine` (`surfaceCm2`, `segmentsDe`).
- Réconciliation (`reconcilieGlobalPieces`) — écarts surfaces/métrés/déperdition.
- `foisonnement` appliqué dans `etudeModel` / résultats.

Le moteur physique (`thermalEngine`, `heatPumpEngine`) **n'est pas retouché** → ses tests existants restent verts (garde-fou de non-régression).

## 11. Décisions & tradeoffs (récap)

1. Pièces = **tableau paramétrique**, pas de dessin par pièce (le gain de temps). ✅ Eric.
2. On **garde le dessin pour l'emprise** uniquement. ✅ Eric.
3. **Hauteur paramétrique par pièce** (affine la perte par pièce). ✅ Eric.
4. **Foisonnement par émetteur**, coefficient org. ✅ Eric.
5. Perte assumée de la détection auto mitoyen/extérieur (métrés déclarés par l'humain).
6. Moteur physique intact ; seule la couche d'entrée change (risque contenu).
7. Anciennes études recalculables via routage par shape ; code géométrique conservé, signalé pour retrait.

## 12. Hors périmètre (spec suivante — points 2/3/4)

- **Point 2** : curation des 364 matériaux (favoris/actifs org, regroupement par famille) dans le composeur + `/settings/thermique`.
- **Point 3** : régime d'eau 65/70 °C — ajout `REGIMES_EAU`, **relever `T_DEPART_MAX` (65→70)** dans `heatPumpEngine`, + avertissement de validité des fits COP hplib au-delà de ~55-60 °C.
- **Point 4** : température de zone surchargeable dans la sim PAC → recalcul de Φtotal à θint réduit → dimensionnement de l'appoint (chaudière bois). S'appuie sur `appointNecessaire` déjà exposé.
