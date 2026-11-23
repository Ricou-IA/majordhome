# Refonte UI — phase 5 (finitions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finir la refonte : listes déroulantes avec recherche à la place des `<select>` natifs, sélecteur de date en français, icônes Lucide à la place des emojis, textes du § 5 du brief réécrits, états vides, derniers réglages tactiles et page des Réglages.

**Architecture:** Deux composants nouveaux (`Combobox`, `DateInput`) aux règles dans des modules purs testés (`src/lib/listeOptions.js`, `src/lib/datesFr.js`). `SelectInput` de `FormFields.jsx` (65 usages) passe par `Combobox` : une seule modification migre les deux tiers des listes. Les 115 `<select>` restants sont migrés par zones. **Sur téléphone, la liste et la date restent natives** (sélecteur du système, au pouce), partout ailleurs elles prennent les nouveaux composants.

**Tech Stack:** React 18, Vite 5, Tailwind 3.4, Radix Popover (installé), `react-day-picker` 10 + `date-fns` (à ajouter), lucide-react, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-refonte-ui-ux-direction-artistique-design.md` § 6 Phase 5 ; DA `docs/ux/references/DA.md` § 5, § 7 (Contrôles, Sélecteur de date) ; brief `docs/ux/references/brief-grok-ui.md` § 5.

**Mode d'exécution (Eric, 2026-11-23) :** composants et textes par le contrôleur (tâches 1, 2, 3, 9, 10, 11) ; migrations en masse et emojis du planning par agent + relecture (tâches 4 à 8).

## Global Constraints

- Aucune modification de schéma, vue, RPC, edge function, requête ni règle métier. Une valeur envoyée par un champ (`onChange`) garde exactement sa forme : chaîne `''` / `null` comme avant, date `YYYY-MM-DD`.
- Un champ migré garde sa valeur initiale, ses options, son ordre, `disabled`, `required`, ses handlers et ses conditions d'affichage.
- **Téléphone (`useDeviceClass().isPhone`) : `<select>` et `<input type="date">` natifs conservés.** Tablette (1 024 px forcés) et ordinateur : nouveaux composants.
- Les PDF (`*PDF*.jsx`, react-pdf) ne sont pas touchés (ni emoji, ni `©`, ni police).
- Les emojis choisis par l'utilisateur et stockés comme donnée (pastille d'un centre du territoire, `CenterEditor`) restent : ce sont des données, pas une décoration.
- Planning : géométrie fixe inchangée (vignettes, interligne 13 px, `hauteurEnTeteReservee`) ; une icône remplace un emoji à taille de texte égale (12 px), jamais plus grande.
- Libellés : vouvoiement, pas de « Veuillez », pas de jargon à l'écran (cron, sync, Place ID, `{{VAR}}`, MT-LT, fiche liée, webhook).
- `audit-ui` ne remonte jamais ; à la fin, compteur `emoji` ≤ nombre d'emojis restants justifiés (PDF, données).
- Après chaque tâche : `npx vite build`, `npm run lint` (0 avertissement), `npm run audit:quality` verts. Travail sur `main`, commit par pathspec, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push par le contrôleur.

## Review Focus

1. **Une liste dont la valeur est un nombre ou un booléen** (`value={2}`, `'true'`) : le Combobox rend la même valeur à `onChange` que le `<select>` (chaîne), pas un nombre. Pinned by `listeOptions` tests (Task 1).
2. **Une option vide** (« Tous », « — ») : sélectionnable, renvoie `''` (ou `null` pour `SelectInput`) comme avant. Pinned by Task 1 tests.
3. **Une date tapée à la main** mal formée (« 31/02/2026 », « 12/13/2026 », « 1/2/26 ») : refusée sans écraser la valeur, message court. Pinned by `lireSaisieDate` tests (Task 3).
4. **Fuseau** : une date choisie dans le calendrier donne le même `YYYY-MM-DD` quelle que soit l'heure (jamais `toISOString()`). Pinned by `versIso` tests (Task 3).
5. **Liste dans une fenêtre** (modale, panneau latéral) : la liste s'ouvre au-dessus de la fenêtre et Échap ferme la liste, pas la fenêtre. Checked in Task 2 review (Radix Popover dans la même pile que Dialog).

---

### Task 1: `Combobox` et règles des options (contrôleur)

**Files:**
- Create: `src/lib/listeOptions.js`, Test: `scripts/liste-options.test.mjs` (dans `audit:quality`)
- Create: `src/components/ui/combobox.jsx`

**Interfaces:**
- Produces:
  - `filtrerOptions(options: Array<{value, label}>, saisie: string): Array` — comparaison sans accent ni casse (réutiliser `normaliser` de `src/lib/catalogue/recherchePieces.js`), sur le libellé.
  - `SEUIL_RECHERCHE = 7` ; `avecRecherche(options): boolean` (≥ 7 options).
  - `libelleDe(options, value): string|null` — `value` comparé en chaîne (`String(o.value) === String(value)`).
  - `<Combobox value onChange options placeholder? disabled? libelle? className? />` : déclencheur à l'allure d'un champ (38 px, bordure `secondary-300`, focus cuivre), liste en Radix Popover (`shadow-lg`, max 320 px de haut, défilante), champ de recherche quand `avecRecherche`, clavier (↑ ↓ Entrée Échap, début de saisie), `role="combobox"` / `listbox` / `option`, `aria-selected`. **`onChange` reçoit `String(option.value)`** (même forme que `e.target.value` d'un `<select>`), option vide comprise (`''`).

- [ ] **Step 1: tests** — `filtrerOptions([{value:'a',label:'Électricité'}], 'elec')` → 1 résultat ; `libelleDe([{value:2,label:'Deux'}], '2')` → `'Deux'` ; `avecRecherche` à 6 et 7 options ; option vide conservée par `filtrerOptions` quand la saisie est vide.
- [ ] **Step 2:** FAIL → implémenter → PASS ; composant écrit ; consommateur en tâche 2 (pas d'`ALLOW_ORPHAN` si commit groupé avec la tâche 2). Commit avec la tâche 2.

### Task 2: `SelectInput` sur `Combobox` (contrôleur)

**Files:**
- Modify: `src/apps/artisan/components/FormFields.jsx`

- [ ] **Step 1:** `SelectInput` : quand `options` est fourni et que l'appareil n'est pas un téléphone → `Combobox` (même `value || ''`, même `onChange(v || null)`, même `placeholder` en option vide, même `disabled`, même `className`) ; sinon (téléphone, ou forme `children`) → le `<select>` actuel. Vérifier les 65 usages par `grep` : aucun ne lit `e.target`.
- [ ] **Step 2:** Build, lint, audit. Commit `feat(ui): liste déroulante avec recherche (Combobox) derrière SelectInput`.

### Task 3: `DateInput` en français (contrôleur)

**Files:**
- Modify: `package.json` (`react-day-picker@^10`, `date-fns@^4` — vérifier la compatibilité React 18 et la locale `fr` avant d'installer)
- Create: `src/lib/datesFr.js`, Test: `scripts/dates-fr.test.mjs` (dans `audit:quality`)
- Create: `src/components/ui/date-input.jsx`

**Interfaces:**
- Produces:
  - `formatDateLongueFR(iso: string): string` → `'lun. 23 nov. 2026'` (vide si invalide) ;
  - `lireSaisieDate(texte: string): string|null` → `'23/11/2026'` → `'2026-11-23'` ; accepte `23/11/26` (→ 2026), `23-11-2026`, `23.11.2026` ; refuse date impossible (`31/02/2026`), mois > 12, année < 1900 ; `''` → `''` (champ vidé) ;
  - `versIso(date: Date): string` (local, jamais `toISOString`) ;
  - `joursFeries(annee: number): string[]` — les 11 jours fériés de métropole (1ᵉʳ janv., lundi de Pâques, 1ᵉʳ mai, 8 mai, Ascension, lundi de Pentecôte, 14 juil., 15 août, 1ᵉʳ nov., 11 nov., 25 déc.), Pâques par l'algorithme de Meeus ;
  - `<DateInput value onChange min? max? disabled? required? placeholder? />` : champ texte `jj/mm/aaaa` (affiche `formatDateLongueFR` hors focus), bouton calendrier → Radix Popover + `DayPicker` (locale `fr`, semaine du lundi, fériés grisés mais choisissables, `min`/`max` respectés), raccourcis « Aujourd'hui », « Demain », « Lundi prochain » ; `onChange(iso)` avec `iso` `YYYY-MM-DD` ou `''` — exactement la forme de `e.target.value` d'un `<input type="date">`. Saisie invalide : bordure `st-alerte`, message « Date invalide (jj/mm/aaaa) », valeur inchangée. Téléphone : `<input type="date">` natif.

- [ ] **Step 1: tests** — `formatDateLongueFR('2026-11-23')` = `'lun. 23 nov. 2026'` ; les cas de `lireSaisieDate` ci-dessus ; `versIso(new Date(2026, 10, 23, 23, 30))` = `'2026-11-23'` ; `joursFeries(2026)` contient `'2026-04-06'` (lundi de Pâques), `'2026-05-14'` (Ascension), `'2026-05-25'` (Pentecôte) et compte 11 dates.
- [ ] **Step 2:** FAIL → implémenter → PASS ; composant ; consommé en tâche 7 → `ALLOW_ORPHAN` (raison « consommé par la migration des dates, tâche 7 »), retiré en tâche 7. Commit `feat(ui): champ de date en français (DateInput)`.

### Task 4: Listes — Réglages (agent + relecture)

**Files:** les 25 fichiers de `src/apps/artisan/pages/settings/**` qui contiennent `<select` (lister par `grep -rl '<select' src/apps/artisan/pages/settings`).

- [ ] **Step 1:** Chaque `<select>` à options statiques ou calculées → `Combobox` (ou `SelectInput` si le fichier l'utilise déjà), téléphone natif via `useDeviceClass().isPhone` **seulement si** le fichier est ouvert sur téléphone (Réglages : tablette et ordinateur, `Combobox` partout). `<optgroup>` : conserver le natif et le signaler. Mêmes valeurs, handlers (`e.target.value` → `v`), conditions.
- [ ] **Step 2:** Rapport : tableau fichier → nombre de listes migrées / gardées natives (et pourquoi). Build, lint, audit. Commit `feat(reglages): listes déroulantes avec recherche`.

### Task 5: Listes — écrans artisan (agent + relecture)

**Files:** les fichiers de `src/apps/artisan/components/**` et `src/apps/artisan/pages/*.jsx`, `pages/client-detail/**` qui contiennent `<select` (hors `pages/settings`, hors `FormFields.jsx`).

- [ ] **Step 1:** Même règle que la tâche 4, **téléphone natif** (ces écrans servent au terrain) : `isPhone ? <select …> : <Combobox …>` factorisé par un petit composant `ListeChoix` dans `src/components/ui/liste-choix.jsx` (même API que `Combobox`, rend le natif sur téléphone) — à créer ici et à réutiliser en tâche 6.
- [ ] **Step 2:** Rapport fichier par fichier ; build, lint, audit. Commit `feat(ui): listes déroulantes avec recherche sur les écrans métier`.

### Task 6: Listes — autres applications (agent + relecture)

**Files:** les fichiers de `src/apps/{solaire,thermique,maintenance,chantier-gaillac,voice,client,…}/**` et `src/components/**` qui contiennent `<select`.

- [ ] **Step 1:** `ListeChoix` (tâche 5). La borne de maintenance (`apps/maintenance/components/borne`) et le portail client (`apps/client`, non utilisé) peuvent rester natifs : le dire. Rapport, build, lint, audit. Commit `feat(ui): listes déroulantes avec recherche dans les autres applications`.

### Task 7: Dates (agent + relecture)

**Files:** les 25 fichiers qui contiennent `type="date"` (liste au § « type=date » du rapport de cadrage : `grep -rln 'type="date"' src`).

- [ ] **Step 1:** Chaque `<input type="date">` → `DateInput` (mêmes `value`, `min`, `max`, `disabled`, `required`, handler `e.target.value` → `iso`). Exclure `planning/scheduling/DayResourceGrid.jsx` s'il s'agit d'un sélecteur de jour de grille à géométrie fixe (le dire). Retirer `date-input.jsx` d'`ALLOW_ORPHAN`.
- [ ] **Step 2:** Rapport fichier par fichier ; build, lint, audit. Commit `feat(ui): dates en français partout`.

### Task 8: Emojis → icônes Lucide (agent + relecture)

**Files:** sortie de `node scripts/audit-ui.mjs` / liste des fichiers à emojis (57) hors PDF et hors données (`CenterEditor`, `TerritoryTab` s'ils affichent l'emoji choisi).

- [ ] **Step 1:** Remplacer chaque emoji d'interface par l'icône Lucide équivalente à la taille du texte (`🔥`→`Flame`, `❄`→`Snowflake`, `🪵`→`TreePine` ou `Axe`, `🔒`→`Lock`, `⏳`→`Hourglass`, `📍`→`MapPin`, `🗺`→`Map` (aliasé `MapIcon`), `⚠`→`AlertTriangle`, `🔧`→`Wrench`, `🎯`→`Target`, `🌐`→`Globe`, `✋`→`Hand`, `📸`→`Camera`, `📝`→`FileText`, `📋`→`ClipboardList`, `➕`→`Plus`, `↔`→`ArrowLeftRight`, `★`→`Star`, `▶`→`Play`), `aria-hidden` + texte voisin ou `title` gardé. **Planning** (`PlanningEventContent.jsx`, `tournees/BlocRdvCard.jsx`, `shared/EquipmentKindIcons.jsx`) : icône 12 px `inline-block align-[-1px]`, aucune hauteur de ligne modifiée.
- [ ] **Step 2:** `node scripts/audit-ui.mjs --update` après baisse ; rapport des emojis restants et de leur raison. Build, lint, audit. Commit `feat(ui): icônes Lucide à la place des emojis`.

### Task 9: Textes, jargon, états vides (contrôleur)

**Files:** `ClientModalTabs.jsx` (« Accepte de recevoir des emails (optin mailing) » → « Accepte les e-mails »), `DevisConditions.jsx` et `EventFormSections.jsx` (« Notes internes (non visibles …) » → « Note interne » + `InfoTip` « Non visible par le client / sur le devis »), `ClientLogementDpe.jsx` (`adresse_non_trouvee` → « DPE non trouvé pour cette adresse. » + bouton « Chercher » existant), `shared/LienWaze.jsx` (« Y aller avec Waze » → « Itinéraire »), `client-detail/TabInfo.jsx` (« Clients liés » → « Proches et sociétés liées », « Aucun client lié » gardé seulement dans le panneau de modification), libellés visibles « sync » → « mise à jour », « cron » → « mise à jour automatique » (grep des textes visibles, jamais des identifiants), `shared/KanbanBoard.jsx` (prop `vide?: { message, action? }` : quand aucune carte du tableau entier, rendre `EmptyState` à la place des colonnes vides ; branchée sur Leads « Aucun lead. » + « Nouveau lead », Chantiers « Aucun chantier en cours. », Devis « Aucun devis à rapprocher. »).

- [ ] **Step 1:** Tests existants à mettre à jour s'ils figent un texte (grep `scripts/` sur chaque phrase). Build, lint, audit. Commit `feat(ui): textes plus courts, jargon retiré, états vides des tableaux`.

### Task 10: Tactile et Réglages (contrôleur)

**Files:** `src/components/ui/segmented-control.jsx` (segments ≥ 44 px sur téléphone et tablette : `html[data-device-class="phone"]`, `[data-device-class="tablet"]` dans `index.css`, classe `mdh-segment`), `client-detail/InviteClientButton` (hauteur 38 px, ≥ 44 px au toucher), `PanneauModifierClient.jsx` + `EnTeteFicheClient.jsx` (focus rendu au bouton « Modifier » après « Abandonner », via une ref et `onCloseAutoFocus`), `src/apps/artisan/pages/Settings.jsx` (groupes de tuiles dans des `Card` avec `CardHeader` au nom du module, tuiles en lignes 56 px avec icône neutre et chevron, organisation et état actuels conservés), violets du suivi des objectifs (`LongTermLeadDrawer.jsx`, `MoveToLongTermModal.jsx`) → neutres / `st-info`.

- [ ] **Step 1:** Build, lint, audit. Commit `feat(ui): cibles tactiles, focus rendu, page des Réglages`.

### Task 11: Recette, relecture d'ensemble, mise en ligne (contrôleur)

- [ ] **Step 1:** `docs/recette-refonte-phase-5.md` : listes (recherche dès 7 choix, clavier, valeur enregistrée identique, liste dans une fenêtre), dates (saisie `jj/mm/aaaa`, calendrier lundi, fériés, raccourcis, erreur), téléphone (listes et dates natives), emojis remplacés (planning compris), textes, états vides, Réglages, focus après « Abandonner ».
- [ ] **Step 2:** `CLAUDE.md` (`Combobox` / `ListeChoix` / `DateInput`, natif sur téléphone, `datesFr.js`) et mémoire ; relecture d'ensemble (agent), corrections, push, suivi Vercel. Mesure UEQ (phase 0) : proposer le protocole à Eric.
