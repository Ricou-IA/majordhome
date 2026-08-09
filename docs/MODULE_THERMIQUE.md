# Module Thermique — étude de déperditions EN 12831 + dimensionnement PAC

> Résumé opérationnel (« règles qui mordent ») dans `CLAUDE.md` § Module Thermique. Ce document porte le détail.
> Spec source : `docs/superpowers/specs/2026-07-03-module-thermique-deperditions-design.md`
> Plans : `docs/superpowers/plans/2026-07-06-thermique-composeur-parois-bibliotheque.md`, `2026-07-09-thermique-saisie-parametrique.md`
> Livré le 2026-07-06 · rapport PDF le 2026-08-06.

## À quoi ça sert

Outil terrain destiné à un **installateur non-ingénieur**. Il produit, sans bureau d'études :

1. les **déperditions pièce par pièce** (EN 12831 simplifiée),
2. le **dimensionnement d'une PAC air/eau** (point de bivalence, consommation par degrés-jours),
3. un **rapport PDF** remis au client.

Le parcours est un wizard en 3 étapes — **Contexte** (`Step1Contexte`) → **Dessin / Pièces** (`Step2EmprisePieces`) → **Résultats** (`Step4Resultats`) — plus un historique (`/thermique/historique`).

## Cartographie

```
src/apps/thermique/
├── pages/            ThermiqueWizard.jsx · ThermiqueHistorique.jsx
├── lib/              moteurs purs + modèles (détail ci-dessous)
├── components/
│   ├── wizard/       Step1Contexte · Step2EmprisePieces · Step4Resultats · PiecesTable
│   │                 ResultatsPiecesGrid · PlanResultats · ComposeurParoiModal · MateriauPicker
│   │                 CompositionFamille · PacSection · PanneauCoherence · UwHelperModal · CommuneSearch
│   ├── canvas/       EmpriseCanvas.jsx (dessin du plan)
│   └── etude/        EtudeThermiquePDF · BilanPage · HypothesesPage · PacPage · PiecesSection · pdfShared
└── data/             référentiels JSON (cf. § Données de référence)
```

Page admin : `src/apps/artisan/pages/settings/…` → `/settings/thermique` (org_admin).
Tests : `scripts/thermique/*.test.mjs` — **331 tests**, lancés par `node --test "scripts/thermique/*.test.mjs"`.

## Les moteurs sont PURS

`thermalEngine.js`, `heatPumpEngine.js`, `geometryEngine.js`, `assembleBatimentParametrique.js`, `wizardState.js`, `rapportModel.js`, `etudeModel.js` **n'importent rien** (ni React, ni Supabase, ni alias `@`). C'est ce qui les rend testables par `node --test` sans harness.

**Conséquence pratique : toute règle de calcul se teste dans `scripts/thermique/`, jamais depuis un composant.** Un calcul écrit dans du JSX est un calcul non testé.

| Module | Rôle | Points d'attention |
|---|---|---|
| `thermalEngine.js` | Déperditions EN 12831 simplifiée | `RSI_RSE = { mur: 0.17, plafond: 0.14, plancher: 0.21 }` (EN ISO 6946). Une couche fournissant à la fois `r` et `e`/`lambda` est **rejetée** (saisie ambiguë). Vocabulaire de types `mur\|plafond\|plancher` (flux) ≠ celui de `refDataResolvers` (`mur\|plancherBas\|plafond\|fenetre`, tables U) — mapping fait à l'assemblage. |
| `heatPumpEngine.js` | Performance PAC air/eau (formule hplib) | ⚠️ Sémantique du catalogue : `coefCop` = p1..p4 du **COP**, `coefPth` = p1..p4 de **P_EL** (pas de P_th) → `P_th = P_el × COP`. `pElRef`/`copRef` = colonnes brutes Keymark (−7 °C ext / 52 °C départ), `null` pour les 3 génériques. ⚠️ Le `P_th` des modèles « Regulated » est un point certifié EN 14825 en charge partielle, **pas la capacité maximale** → l'usage en bivalence porte un avertissement dédié. Bornes : `tExt ∈ [−30, 45]`, `tDépart ∈ [20, 65]`. |
| `geometryEngine.js` | Géométrie du plan dessiné | Coordonnées **entières en cm**, grille 10 cm, `y` vers le bas (repère SVG). Polygones rectilinéaires, normalisés anti-horaires, fermeture implicite. **Erreur de dessin → tableau de messages** (l'UI affiche) ; **erreur de programmation → `throw 'thermique:…'`**. Ne pas confondre les deux canaux. |
| `assembleBatimentParametrique.js` | Assemble le bâtiment depuis la saisie paramétrique | Union dessin + saisie ; les exceptions U par pièce sont conservées. |
| `wizardState.js` | État du wizard (`useReducer`) | State machine imposée par la règle « >10 `useState` interdit ». ⚠️ **Le shape hors champs volatils (`step`/`studyId`/`savedResults`) EST le `input` jsonb persisté** → VERROUILLÉ (cf. `toStudyInput`). Brouillon `localStorage thermal-draft:${userId}` (convention P1.9). |

## Source de calcul unique : `buildEtudeModel`

`lib/etudeModel.js::buildEtudeModel` est la **seule** fonction qui produit les chiffres. Écran de résultats et PDF la consomment tous les deux — même pattern que le module Solaire.

- `ENGINE_VERSION` (actuellement `'1.0.0'`) versionne les règles de calcul. **À incrémenter à tout changement de règle**, sinon une étude ancienne se réaffiche sans signaler qu'elle a été produite par un moteur différent.
- `resultsPersistables(model)` définit le sous-ensemble persisté : `bilan`, `thetaE`, `pac`. Les parois ne sont pas persistées — elles sont re-dérivables de l'`input`.

### R7 — les résultats sont FIGÉS

Une étude rouverte affiche `thermal_studies.results` **tel qu'enregistré**, pas un recalcul. Si `engine_version` diffère d'`ENGINE_VERSION`, une bannière ambre le signale.

C'est la même règle que les contrats signés : **un artefact remis au client lit les valeurs ENREGISTRÉES**. Recalculer à la réouverture ferait diverger l'étude remise au client de celle affichée en interne.

Effet de bord documenté : une pièce ajoutée après réouverture (mode figé) n'est pas dans le bilan → `PlanResultats` la rend en gris neutre `#e2e8f0`. Un `fill` absent rendrait le polygone **noir** (défaut SVG) : ne pas retirer ce fallback.

## Rapport PDF

- `lib/rapportModel.js` (PUR) **met en forme sans jamais recalculer**. Corollaire : *un chiffre présent dans le PDF et absent de l'écran est un bug de ce module*.
- `lib/rapportExport.js::telechargerRapportThermique()` est le **point d'entrée unique**, partagé par l'étape Résultats et l'historique. Toute la chaîne (résolution du nom client, mise en forme, rendu, nommage du fichier) vit là. Ne pas réimplémenter la chaîne dans un 3ᵉ écran — deux écrans produisant chacun leur PDF finiraient par diverger.
- `buildRapportFilename(nom, date)` → `rapport-thermique-<slug>-<AAAA-MM-JJ>.pdf`, accents et ponctuation strippés (portable Windows/macOS). La `date` est **injectée par le caller** (testable, pas d'horloge implicite).
- `@react-pdf/renderer` en **import dynamique** (chunk séparé).
- Le catalogue PAC (~4,6 Mo) n'est chargé qu'à la demande : s'il est absent, le graphe de bivalence disparaît — **jamais le rapport entier**.

### ⚠️ Glyphes PDF (Helvetica / WinAnsi)

Même piège que les autres PDFs du projet. Dans tout texte du rapport :

- **Sortent en artefact** : lettres grecques (θ, Δ, Φ), flèches, `≈ ≥ ≤ −` (moins typographique U+2212).
- **Passent** : `° ² · × — – ’ « » € %`.

→ écrire « T° extérieure de base », « majoration Utb » en toutes lettres. Les formatters PDF-safe de `components/etude/pdfShared.jsx` sont obligatoires : `toLocaleString('fr-FR')` insère une espace fine insécable U+202F qui casse le rendu.

## Couleur (R12 — palette deutan)

Intensité des déperditions : **bleu `#3b82f6` → ambre `#f59e0b`**, interpolation linéaire entre le min et le max du **bâtiment entier** (pas du niveau, pour que deux niveaux restent comparables). **Jamais rouge/vert.** La couleur ne porte jamais l'information seule : bornes chiffrées systématiques.

L'échelle est `couleurRatio` de `rapportModel.js` — source unique écran ↔ PDF, consommée par `ResultatsPiecesGrid` et `EtudeThermiquePDF`.

> ⚠️ **Dette connue** : `components/wizard/PlanResultats.jsx` contient encore une **copie locale identique** de `couleurRatio` (avec ses propres constantes `BLEU`/`AMBRE`). Tant qu'elle est là, un changement d'échelle dans `rapportModel` ne se propage pas au plan de résultats. À supprimer au profit de l'import.

Autre piège de rendu : les pièces non chauffées sont hachurées via un **pattern SVG en attribut `fill`**, pas une classe Tailwind dynamique — le scanner Tailwind n'extrait pas les classes construites à l'exécution.

## Données de référence

Point d'entrée unique : `src/apps/thermique/data/index.js`.

| Fichier | Contenu | Chargement |
|---|---|---|
| `climat.json` | Températures de base, DJU | statique |
| `materiaux.json` | λ des matériaux | statique |
| `parois-types.json` | Compositions types | statique |
| `u-defauts.json` | U par défaut par époque/type | statique |
| `menuiseries.json` | Uw menuiseries | statique |
| `coefficients-b.json` | Coefficients de réduction b | statique |
| `ventilation.json` | Débits par type de VMC | statique |
| `tarifs-energie.json` | Tarifs énergie | statique |
| `communes.json` (~7 Mo) | Communes (altitude, département) | **`import()` dynamique** via `loadCommunes()` |
| `pac-catalogue.json` (~4 Mo) | Catalogue PAC Keymark | **`import()` dynamique** via `loadPacCatalogue()` |

Ne jamais passer les deux gros fichiers en import statique : ils entreraient dans le bundle principal.

## DB & configuration

- Table `majordhome.thermal_studies` + vue publique `majordhome_thermal_studies` (`security_invoker=true`, auto-updatable, `GRANT SELECT … TO service_role`).
- `input` jsonb = état du wizard (**shape verrouillé**, cf. `toStudyInput`), `results` jsonb + `engine_version`.
- **La liste ne sélectionne PAS `input`** (jsonb lourd) — le récupérer via `getById` quand on en a besoin.
- Config org : `core.organizations.settings.thermique`, lue via `buildThermiqueConfig(settings)` (`lib/thermiqueConfig.js`). ⚠️ `org_update_settings` fait un merge JSONB de **niveau 1** (`||`) → toujours sauver l'objet `thermique` **complet** via `useOrgSettings().save({ thermique })`, jamais un sous-objet partiel.
- Accès : `RouteGuard resource="thermal_study"` sur `/thermique` et `/thermique/historique`.

## ⚠️ Limite majeure : l'étude est indépendante du pipeline

Les rails existent mais **rien ne les alimente** :

- colonnes `thermal_studies.client_id` / `lead_id` → jamais renseignées,
- `contexte.clientId` / `contexte.leadId` dans l'état du wizard → `leadId` n'est jamais posé,
- pré-remplissage `/thermique?client=<id>` supporté → **aucun écran ne produit cette URL**,
- ni la fiche client ni le lead n'affichent les études existantes.

**Seule porte d'entrée aujourd'hui : la sidebar.**

**Phase 2, décidée avec Eric le 2026-08-06** : brancher l'étude sur le lead. Ne pas considérer le lien comme fonctionnel avant cette phase, et ne pas écrire de code qui suppose que `client_id` est peuplé.

## Reste à faire

| Sujet | État |
|---|---|
| Phase 2 — brancher l'étude au lead / à la fiche client | ⬜ à faire (décidé le 2026-08-06) |
| Phase C — couche override « saisie à la main » | ⬜ à faire — **sous-plan dédié requis**, le shape `input` jsonb est verrouillé |
| Dédup de `couleurRatio` dans `PlanResultats.jsx` | ⬜ dette signalée |
