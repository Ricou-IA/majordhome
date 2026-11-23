# Refonte UI — phase 4 (Leads, Planning, Chantiers, Entretiens, Devis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyler les écrans « commerce et terrain » — Kanban des leads, Planning, Chantiers, Entretiens et SAV, explorateur de devis — sur la boîte à composants, sans toucher à aucune règle de placement, de couleur de personne, de glisser-déposer ni de géométrie du planning.

**Architecture:** Présentation seulement. Les tons passent par `toneFor` / les jetons `st-*` (classes littérales) ; la couleur d'une personne reste la sienne (`calendar_color`, couleurs des commerciaux). Toute règle nouvelle va dans un module pur testé. Les hauteurs du planning (`planningVignette.js`, `hauteurEnTeteReservee` de `planningCharge.js`, CSS `.fc`) ne changent pas.

**Tech Stack:** React 18, Vite 5, Tailwind 3.4, FullCalendar 6, `@hello-pangea/dnd`, lucide-react, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-refonte-ui-ux-direction-artistique-design.md` § 5.1, § 5.2 (arbitrages 1 à 4), § 6 Phase 4 ; brief `docs/ux/references/brief-grok-ui.md` § 3, § 4.5 à 4.8, § 5.

**Mode d'exécution (Eric, 2026-11-23) :** Planning et Kanbans = agent + relecture (tâches 1 à 5) ; explorateur de devis et clôture = contrôleur (tâches 6 et 7).

## Global Constraints

- Aucune modification de schéma, vue, RPC, edge function, requête Supabase ni règle métier. Les règles de placement des cartes (`majordhome_kanban_cards`, `dateDeCarte`, `bandeDeCarteChantier`, `ALLOWED_TRANSITIONS`, gardes Pennylane Gagné / Perdu, Perdu direct avec « Annuler » 8 s, `refusReculChantier`) ne bougent pas.
- **Planning : un RDV garde la couleur de la personne** (`team_members.calendar_color`), violet `#6D28D9` réservé à « facturé ». Les blocs, leurs hauteurs, l'interligne 13 px, `planningVignette.js`, `hauteurEnTeteReservee` et les constantes de `JourneeEtatChips` ne changent pas. Les hachures « pose provisoire » et « congés » restent (information), seule leur teinte peut s'adoucir.
- **Cartes de Kanban : hauteur uniforme avant tout** (Eric) — une étiquette s'abrège plutôt que d'ajouter une ligne ; ne jamais ajouter une ligne à une carte.
- Le cuivre ne sert jamais à un statut ; aucune nouvelle couleur codée en dur (`audit-ui` ne remonte pas, il doit baisser) ; classes de tons écrites en entier (pas d'interpolation `bg-st-${ton}`).
- Les couleurs des commerciaux (pastille d'initiales) et des personnes restent des couleurs de personne, rendues par `Avatar` (`couleur`).
- Tablette forcée à 1 024 px ; téléphone : colonnes de Kanban à largeur fixe et défilement (`.mdh-kanban`, `.mdh-kanban-col`) inchangés.
- Fichiers ≤ 500 lignes ; `LeadKanban.jsx` (887) et `EntretienSAVCard.jsx` (559) ne grossissent pas (toute pièce nouvelle dans son fichier).
- Après chaque tâche : `npx vite build`, `npm run lint` (0 avertissement), `npm run audit:quality` verts.
- Travail sur `main`, commit par pathspec, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push par le contrôleur.

## Review Focus

1. **Glisser une carte** dans le Kanban des leads, dans Gagné / Perdu repliées, dans le Kanban des chantiers et des entretiens : même transition, mêmes refus, même fenêtre qu'avant. Pinned by Task 3's `colonneRepliee` tests and the drag parity checklist of Tasks 2-5.
2. **Une carte qui change de hauteur** (nom long, montant long, badges nombreux) : la carte garde sa hauteur. Pinned by the review of Tasks 2, 4, 5 (classes `truncate`, hauteur fixe conservée).
3. **Un en-tête de jour du planning qui saute** au changement de semaine : la réserve de hauteur doit rester exacte. Task 1 ne modifie aucune taille, seulement des couleurs.
4. **Un statut inconnu** (étape de lead future, statut Pennylane futur) : ton neutre, jamais d'erreur. Covered by `toneFor` (phase 2) and `tonEtatJournee` tests (Task 1).
5. **Un devis sans date** dans l'explorateur : jamais compté « sans réponse ». Pinned by `sansReponseDepuis` tests (Task 6).

---

### Task 1: Planning — barre d'outils, trait « maintenant », en-têtes de jour (agent + relecture)

**Files:**
- Modify: `src/apps/artisan/components/planning/CalendarToolbar.jsx`, `src/apps/artisan/components/planning/JourneeEtatChips.jsx` (couleurs seulement), `src/apps/artisan/components/planning/PlanningDayHeader.jsx` (couleurs seulement), `src/index.css` (bloc `.fc`)
- Modify: `src/lib/planningCharge.js` + `scripts/planning-charge.test.mjs`

**Interfaces:**
- Produces: `tonEtatJournee(etat: string): 'neutre'|'info'|'ok'|'attente'|'alerte'` dans `planningCharge.js` — `vide`→neutre, `ouverte`→ok, `pleine`→attente, `figee`→info, `a_arbitrer`→alerte, `manuelle`/`sans_etat`/`attente`/inconnu→neutre.

- [ ] **Step 1: tests** de `tonEtatJournee` (chaque valeur + inconnu + `undefined`) → FAIL → implémenter → PASS.
- [ ] **Step 2:** `JourneeEtatChips` : `STYLES` réécrit en classes littérales `st-*` selon `tonEtatJournee` (`bg-st-<ton>-bg text-st-<ton> border-st-<ton>/20`), en gardant **exactement** les classes de taille (`text-[10px]`, `px-1.5`, `py-0.5`, `leading-tight`, `rounded`) ; `attente` (chargement) garde son style neutre clair.
- [ ] **Step 3:** `CalendarToolbar` : « Aujourd'hui » = `Button variant="secondary" size="sm"` ; pastille de semaine = `Tag` (« S48 ») ; titre de période `font-display text-count` ; CA = `Tag` ; « Rafraîchir » et « Imprimer » passent dans `MenuActions` (« … »), avec les mêmes conditions (`printHint` désactive Imprimer, Imprimer reste absent sur téléphone comme aujourd'hui) ; « Nouveau RDV » = `Button variant="primary"`, en dernier. Une seule ligne à 1440 px quand la recherche est présente. Mêmes props, mêmes handlers.
- [ ] **Step 4:** CSS : trait « maintenant » cuivre (`.fc .fc-timegrid-now-indicator-line` et `-arrow` en `#C2532B`) ; numéro du jour d'aujourd'hui en pastille cuivre dans l'en-tête (`.fc .fc-col-header-cell.fc-day-today` — sans changer la hauteur réservée `--mdh-head-h`) ; teinte des hachures `mdh-provisional` / `mdh-leave` inchangée ou adoucie, motif conservé.
- [ ] **Step 5:** vérifier par lecture que `hauteurEnTeteReservee` et les constantes de `JourneeEtatChips` sont inchangées (citer les lignes dans le rapport). Build, lint, audit. Commit `feat(planning): barre d'outils, trait « maintenant » et tons des journées`.

### Task 2: Carte de lead et colonnes de Kanban (agent + relecture)

**Files:**
- Modify: `src/apps/artisan/components/pipeline/LeadCard.jsx`, `src/apps/artisan/components/shared/KanbanBoard.jsx` (en-tête et fond de colonne), `src/apps/artisan/pages/Pipeline.jsx` (libellés d'onglets)

**Interfaces:**
- Consumes: `Avatar`, `Tag`, `StatusPill` (`taille="compacte"`), `toneFor`.

- [ ] **Step 1: carte** (même hauteur, même nombre de lignes) — bande de date : plus de couleur de statut, `bg-secondary-25 border-secondary-150` et texte `text-secondary-700` (jour en `font-display`, mois en `text-caption`, la règle `dateDeCarte` inchangée) ; nom `text-body-sm font-semibold` ; montant `font-semibold text-secondary-900` (plus de vert) ; source = `Tag` (plus de pastille blanche sur fond de couleur) ; « Hors zone » = `StatusPill tone="attente" taille="compacte"` ; initiales du commercial = `Avatar taille={24}` avec la couleur actuelle du commercial passée en `couleur` (convertir la classe actuelle de `getCommercialColor` en hex équivalent, table locale littérale) ; compteurs d'appels / relances et icône MT-LT en `text-secondary-500` ; jours dans le statut : ton via `getDaysColor` réécrit en `st-*` (sans changer les seuils).
- [ ] **Step 2: colonnes** (`KanbanBoard`) — fond de colonne `bg-secondary-100 rounded-2xl`, en-tête : pastille de couleur de colonne conservée (c'est la couleur de l'étape, pas un statut cuivre), titre `text-label font-semibold text-secondary-800`, compteur en `Tag`, montant `tabular-nums`. Carte en cours de glisser : `shadow-md`. Aucune modification des props, du `Droppable` / `Draggable`, des largeurs (`.mdh-kanban-col`).
- [ ] **Step 3: onglets du pipeline** — libellés « Statistiques » (dashboard), « Tableau » (kanban), « Suivi des objectifs » (long-term) ; mêmes valeurs `?tab=`, même onglet par défaut. Le mot « MT-LT » ne s'affiche plus nulle part dans ces trois onglets (titres, boutons, infobulles visibles : remplacer par « suivi des objectifs » ; identifiants et noms de fichiers inchangés).
- [ ] **Step 4:** parité dans le rapport (chaque élément de la carte → où il est, même condition) ; build, lint, audit. Commit `feat(leads): carte de lead et colonnes aux couleurs de la DA`.

### Task 3: Colonnes Gagné et Perdu repliables (agent + relecture)

**Files:**
- Create: `src/lib/kanbanColonnes.js`, Test: `scripts/kanban-colonnes.test.mjs` (dans `audit:quality`)
- Modify: `src/apps/artisan/components/shared/KanbanBoard.jsx`, `src/apps/artisan/components/pipeline/LeadKanban.jsx` (passer la liste des colonnes repliables)

**Interfaces:**
- Produces: `colonneRepliee(cle: string, preferences: Record<string, boolean>, repliablesParDefaut: string[]): boolean` ; `cleColonnesRepliees(userId: string): string` → `mdh-kanban-replie:${userId}` ; `KanbanBoard` prop `colonnesRepliables?: string[]` (clés de colonnes repliées par défaut, ici `['gagne','perdu']`).

- [ ] **Step 1: tests** — `colonneRepliee('gagne', {}, ['gagne','perdu'])` → true ; `colonneRepliee('gagne', { gagne: false }, …)` → false ; `colonneRepliee('nouveau', {}, …)` → false ; `cleColonnesRepliees('u1')` → `'mdh-kanban-replie:u1'`.
- [ ] **Step 2:** Une colonne repliée fait 72 px de large : titre vertical ou abrégé, compteur et montant total, bouton « Déplier » (et l'en-tête dépliée a « Replier »). **Elle reste une zone de dépôt** (`Droppable` monté, même `droppableId`) : déposer une carte y produit exactement la même transition qu'aujourd'hui (même garde Pennylane, même Perdu direct avec « Annuler »). Les cartes n'y sont pas rendues tant qu'elle est repliée. Préférence lue / écrite sous `cleColonnesRepliees(user.id)`.
- [ ] **Step 3:** Seul `LeadKanban` passe `colonnesRepliables` ; Chantiers, Entretiens, Contrats, Devis, Webshop ne changent pas. Build, lint, audit. Commit `feat(leads): colonnes Signé et Perdu repliables`.

### Task 4: Chantiers (agent + relecture)

**Files:**
- Modify: `src/apps/artisan/components/chantiers/ChantierCard.jsx`, `src/apps/artisan/components/chantiers/ChantierKanban.jsx` (si nécessaire)

- [ ] **Step 1:** Carte (hauteur fixe `h-[124px]` conservée) : bande de date (`bandeDeCarteChantier`, inchangée) en neutre comme la carte de lead ; montant `font-semibold text-secondary-900` ; repères de commande (`ORDER_STYLES`) : Commandé = `st-info` (déjà), Reçu = `st-ok`, N/A = neutre, inconnu = neutre clair ; repères d'après-vente (PV, Avis, Contrat, Facturé) aux tons `st-*` selon leur état actuel (`attention` → attente, fait → ok, à faire → neutre) ; carte « aucun devis validé » ambre → `st-attente`. Pas d'avatar de commercial (décision d'Eric). Le sens écrit sous chaque titre de colonne reste.
- [ ] **Step 2:** Parité dans le rapport ; build, lint, audit. Commit `feat(chantiers): carte aux tons de statut`.

### Task 5: Entretiens et SAV (agent + relecture)

**Files:**
- Modify: `src/apps/artisan/pages/Entretiens.jsx`, `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (couleurs seulement), `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` (boutons)

- [ ] **Step 1:** Les quatre `StatCard` (Entretiens à faire + CA + refus, SAV gérés, Planifiés, Réalisés) deviennent un `StatStrip` (`components/shared/StatStrip.jsx`) : mêmes chiffres, mêmes sous-lignes, rien de perdu, plus d'icônes colorées.
- [ ] **Step 2:** Onglets (Suivi, Contrats, Programmation, Dashboard, …) : mêmes valeurs, libellés « Suivi » pour le kanban ; style souligné comme la fiche client (actif `text-secondary-900` + soulignement cuivre). Compteurs conservés.
- [ ] **Step 3:** Boutons : « Nouveau contrat » reste la seule action principale de la page ; « Nouveau SAV » et « Lancer l'appel » (s'il est affiché) en `secondary`.
- [ ] **Step 4:** `EntretienSAVCard` : chaque pastille de statut / workflow passe par `toneFor('entretien', …)` + `StatusPill taille="compacte"` ou par ses tons `st-*` équivalents, **sans changer tailles ni hauteur de carte** ; aucune couleur `blue/green/red/orange/amber/purple-*` codée en dur ne reste dans les pastilles de statut (les couleurs de personne restent).
- [ ] **Step 5:** Parité ; build, lint, audit. Commit `feat(entretiens): repères en bande, tons de statut, boutons hiérarchisés`.

### Task 6: Explorateur de devis (contrôleur)

**Files:**
- Modify: `src/lib/quotesExplorer.js` + son test existant (`scripts/quotes-explorer.test.mjs`), `src/apps/artisan/pages/DevisExplorer.jsx`

**Interfaces:**
- Produces: `sansReponseDepuis(ligne, aujourdhui: string, jours = 21): boolean` — vrai pour un devis `pending` (ou `expired`) daté (`quote_date`) de plus de `jours` jours ; faux sans date.

- [ ] **Step 1: tests** (pending vieux de 22 j → true ; 21 j → false ; `accepted` → false ; sans `quote_date` → false).
- [ ] **Step 2:** Les vues (Orphelins, Tous, Écartés) passent en `SegmentedControl` avec compteurs ; filtre « Sans réponse depuis 21 j » (bascule `secondary`) appliqué en mémoire sur les lignes déjà chargées ; statut de chaque devis en `StatusPill` via `toneFor('devis', …)`. Mêmes actions (rattacher, créer le lead, écarter, réintégrer). Commit `feat(devis): vues segmentées, tons de statut, filtre sans réponse`.

### Task 7: Recette, relecture d'ensemble, mise en ligne (contrôleur)

- [ ] **Step 1:** `docs/recette-refonte-phase-4.md` (format des recettes précédentes) : planning (barre d'outils, trait maintenant, pastille du jour, lignes de charge, vignettes 30 min / 1 h / journée, hachures, violet facturé, impression, couleur des personnes), Kanban des leads (carte, glisser dans chaque colonne, Signé / Perdu repliées, garde Pennylane, Perdu + Annuler), chantiers, entretiens et SAV, explorateur de devis ; ordinateur, tablette, téléphone.
- [ ] **Step 2:** `CLAUDE.md` (refonte : `tonEtatJournee`, colonnes repliables `kanbanColonnes.js`) et mémoire ; relecture d'ensemble (agent), corrections, push, suivi Vercel.
