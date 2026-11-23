# Refonte UI — phase 3 (Accueil, liste Clients, fiche client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre les trois écrans du quotidien — Accueil, liste Clients, fiche client — sur la boîte à composants de la phase 2, sans perdre aucune fonction ni ajouter aucune requête.

**Architecture:** Règles nouvelles dans des modules purs testés (`src/lib/accueil.js`, `src/lib/pipelineDashboard.js`, `src/lib/clientsAffichage.js`). Deux composants communs nouveaux (`DataTable`, `SidePanel` + `MenuActions`). La fiche client garde son état et ses appels (`ClientDetail.jsx` : `formData`, `handleSave`, `useClient`) : seule la présentation change — un onglet Résumé en lecture, le formulaire actuel (`TabInfo`) déplacé dans un panneau « Modifier ».

**Tech Stack:** React 18, Vite 5, Tailwind 3.4, Radix (`@radix-ui/react-popover` installé, `@radix-ui/react-dialog` à ajouter), lucide-react, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-refonte-ui-ux-direction-artistique-design.md` § 6 Phase 3 (références `docs/ux/references/DA.md`, `docs/ux/references/brief-grok-ui.md` § 4.2-4.4, § 5).

**Mode d'exécution (Eric, 2026-11-23) :** tâches simples faites par le contrôleur ; agent + relecture pour la liste Clients et la fiche client (tâches 3, 5, 6, 7).

## Global Constraints

- Aucune modification de schéma, vue, RPC, edge function ni règle métier ; **aucune nouvelle requête** : on ne lit que ce que les hooks existants chargent déjà (`useClients`, `useClientStats`, `useClient`, `useAppointments`, `usePipelineDashboard`, `useLinkedClients`, `useClientAuditTrail`…). La vue `majordhome_clients` ne porte ni dernière visite, ni prochain RDV, ni CA : ces colonnes du brief ne sont pas affichées.
- URL et paramètres conservés : `/clients?filter=particuliers|entreprises|publics|contracts|archived`, `/clients?new=1`, `location.state.tab` de la fiche client (`'contract'` utilisé par `ContractSign.jsx`).
- Un seul `Button variant="primary"` par écran, le plus à droite de `PageHeader`. Destructif jamais collé au principal : menu « … ».
- Le cuivre ne sert jamais à un statut ; statuts par `toneFor` + `StatusPill`.
- Tablette rendue en 1 024 px forcés ; téléphone (`useDeviceClass().isPhone`) : zones tactiles ≥ 44 px, la liste Clients reste en cartes (`ClientCard`) sous `md`.
- Fichiers ≤ 500 lignes ; `ClientDetail.jsx` (683) et `Clients.jsx` (700) ne grossissent pas : toute nouvelle section va dans son propre fichier sous `pages/client-detail/` ou `components/clients/`.
- Après chaque tâche : `npx vite build`, `npm run lint` (0 avertissement), `npm run audit:quality` verts ; `audit-ui` ne remonte pas.
- Travail sur `main`, commit par pathspec, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push par le contrôleur.

## Review Focus

1. **Enregistrer depuis le panneau « Modifier »** : mêmes champs, même validation (nom obligatoire, `emailRefuse`), même appel `updateClient`, même push Pennylane par deltas ; fermer sans enregistrer rend les valeurs d'avant. Pinned by the parity checklist of Task 7 and `scripts/clients-affichage.test.mjs` (`champsModifies`).
2. **« Appliquer » un DPE depuis le Résumé** (`handleApplyInvestigation`) : ouvre le panneau pré-rempli, n'enregistre rien. Task 7, step 3.
3. **Lien profond vers un onglet** : `navigate('/clients/:id', { state: { tab: 'contract' } })` et les anciens identifiants (`info`, `timeline`, `mailings`, `sms`, `devis-pl`, `factures-pl`) ouvrent le bon onglet regroupé. Pinned by `ongletDeDepart` tests (Task 6).
4. **Chiffre inconnu** : sous-titre de l'Accueil et de Clients sans « … » ni 0 inventé quand un hook charge ou échoue. Pinned by `sousTitreAccueil` tests (Task 1).
5. **Tri par colonne qui ne correspond à rien en base** : seules les colonnes de la vue (`display_name`, `city`, `client_number`, `created_at`) sont triables ; les autres en-têtes ne sont pas cliquables. Pinned by `COLONNES_TRIABLES` test (Task 2).

---

### Task 1: Règles de l'Accueil (controller)

**Files:**
- Modify: `src/lib/accueil.js`, `scripts/accueil.test.mjs`
- Modify: `src/lib/pipelineDashboard.js`, `scripts/pipeline-dashboard.test.mjs`

**Interfaces:**
- Produces:
  - `rdvEnCours(rdv, maintenant: Date): boolean` — vrai si `rdv.scheduled_date` est le jour local de `maintenant` et `scheduled_start ≤ heure < scheduled_end` (`HH:MM`).
  - `sousTitreAccueil({ dateDuJour: string, rdvAujourdhui: number|null, aRappeler: number|null }): string` — « Lundi 23 novembre · 4 rendez-vous et 9 leads à rappeler » ; une partie inconnue (`null`) est omise ; singuliers « 1 rendez-vous », « 1 lead à rappeler » ; zéro écrit « aucun rendez-vous ».
  - dans `buildPipelineDashboard`, `portefeuille.relancesPrioritaires: Array<{ leadId, nom, montant, jours: number|null }>` — les 3 cartes « Devis envoyé » sans relance depuis plus de `SEUIL_RELANCE_JOURS` (même critère que `devisSansRelance`), hors MT-LT, au plus gros montant, puis plus vieux contact.

- [ ] **Step 1: tests** —

```js
assert.equal(rdvEnCours({ scheduled_date: '2026-11-23', scheduled_start: '09:00', scheduled_end: '10:30' }, new Date(2026, 10, 23, 9, 45)), true);
assert.equal(rdvEnCours({ scheduled_date: '2026-11-23', scheduled_start: '09:00', scheduled_end: '10:30' }, new Date(2026, 10, 23, 10, 30)), false);
assert.equal(rdvEnCours({ scheduled_date: '2026-11-24', scheduled_start: '09:00', scheduled_end: '10:30' }, new Date(2026, 10, 23, 9, 45)), false);
assert.equal(sousTitreAccueil({ dateDuJour: 'Lundi 23 novembre', rdvAujourdhui: 4, aRappeler: 9 }), 'Lundi 23 novembre · 4 rendez-vous et 9 leads à rappeler');
assert.equal(sousTitreAccueil({ dateDuJour: 'Lundi 23 novembre', rdvAujourdhui: 1, aRappeler: null }), 'Lundi 23 novembre · 1 rendez-vous');
assert.equal(sousTitreAccueil({ dateDuJour: 'Lundi 23 novembre', rdvAujourdhui: null, aRappeler: null }), 'Lundi 23 novembre');
assert.equal(sousTitreAccueil({ dateDuJour: 'Lundi 23 novembre', rdvAujourdhui: 0, aRappeler: 1 }), 'Lundi 23 novembre · aucun rendez-vous et 1 lead à rappeler');
// pipeline-dashboard : 4 devis sans relance (montants 500, 9000, 3000, 9000 plus ancien) → [9000 ancien, 9000, 3000] ; un MT-LT exclu ; un devis relancé il y a 5 j exclu
```

- [ ] **Step 2:** FAIL → implémenter (`aRappeler` = `portefeuille.total.aContacter`) → PASS. Commit `feat(accueil): règles du sous-titre, du RDV en cours et des relances prioritaires`.

### Task 2: `DataTable` et règles d'affichage des clients (controller)

**Files:**
- Create: `src/components/ui/data-table.jsx`, `src/lib/clientsAffichage.js`, Test: `scripts/clients-affichage.test.mjs` (dans `audit:quality`)

**Interfaces:**
- Produces:
  - `<DataTable colonnes={[{ cle, titre, rendu: (ligne) => node, triable?: boolean, alignement?: 'gauche'|'droite', largeur?: string }]} lignes tri={{ cle, ascendant }} onTri={(cle) => void} onLigne={(ligne) => void} cleLigne={(ligne) => string} chargement? vide?={node} pied?={node} />` — en-tête 40 px `bg-secondary-25 text-label text-secondary-500`, lignes 56 px séparées `border-secondary-100`, survol `bg-secondary-50`, ligne entière cliquable et focusable (Entrée), en-tête triable = bouton avec flèche (`ArrowUp`/`ArrowDown` cuivre sur la colonne triée, `ChevronsUpDown` `secondary-300` sinon), `aria-sort`. `chargement` affiche 8 lignes squelette.
  - `clientsAffichage.js` : `casseTitre(texte: string): string` (« FAMILLE DELORME » → « Famille Delorme », « jean-pierre DUPONT » → « Jean-Pierre Dupont », particules `de, du, des, la, le, d'` en minuscules sauf en tête, sigles de 2-3 lettres sans voyelle gardés : « SCI » reste « SCI ») ; `COLONNES_TRIABLES = ['display_name', 'city', 'client_number', 'created_at']` ; `triSuivant(triActuel, cle) → { cle, ascendant }` (même colonne : inverse ; autre colonne : ascendant, sauf `created_at` qui démarre descendant) ; `champsModifies(initial, courant): string[]` (clés dont la valeur diffère, comparaison stricte après `trim` des chaînes).

- [ ] **Step 1: tests** — `casseTitre` (les quatre cas ci-dessus + chaîne vide → `''` + `null` → `''`), `COLONNES_TRIABLES` exact, `triSuivant` (4 cas), `champsModifies({a:'x ', b:1},{a:'x', b:2})` → `['b']`.
- [ ] **Step 2:** FAIL → implémenter → PASS. `DataTable` sans consommateur dans ce commit : l'ajouter à `ALLOW_ORPHAN` de l'audit de code mort avec « consommé par Clients (tâche 3) », retiré en tâche 3. Commit `feat(ui): tableau de données et règles d'affichage des clients`.

### Task 3: Liste Clients en tableau (agent + relecture)

**Files:**
- Modify: `src/apps/artisan/pages/Clients.jsx` (ne doit pas dépasser 500 lignes : sortir l'en-tête/barre d'outils dans `src/apps/artisan/components/clients/ClientsBarreOutils.jsx` et le tableau dans `components/clients/ClientsTableau.jsx`)

**Interfaces:**
- Consumes: `DataTable`, `casseTitre`, `COLONNES_TRIABLES`, `triSuivant` (Task 2) ; `SegmentedControl`, `StatusPill`, `Avatar`, `Tag`, `PageHeader`, `EmptyState`, `Button` (phase 2) ; `toneFor('contrat','active')`.

- [ ] **Step 1:** En-tête : `PageHeader` titre « Clients », sous-titre `« 3 612 clients · 490 contrats d'entretien actifs »` depuis `stats` (`total_clients`, `active_contracts`, formatés `fr-FR`, partie inconnue omise) ; actions inchangées (Importer, Nouveau client) + « Carte » (`variant: 'ghost'`, `to: '/territoire'`).
- [ ] **Step 2:** Les six `StatCard` disparaissent. `SegmentedControl` « Tous · Particuliers · Entreprises · Secteur public » (ce dernier seulement si `stats.publics > 0`) avec compteurs de `stats` ; il écrit le même paramètre `?filter=` et applique les mêmes filtres que `handleStatCardClick` aujourd'hui. « Contrats actifs » et « Archivés » : deux boutons-bascules `variant: 'secondary'` à droite de la barre (même effet que les cartes `contracts` / `archived`), état actif `bg-primary-50 border-primary-200 text-primary-800`.
- [ ] **Step 3:** Recherche : `SearchBar` à 48 px de haut, libellé « Nom, téléphone, e-mail, ville ou n° de client… » ; raccourci « / » (hors champ de saisie) qui la focalise. Le filtre Contrat (avec / sans) reste un `FilterDropdown` (le Combobox arrive en phase 5). Le select « Tri » disparaît : le tri passe par les en-têtes (`setFilters({ orderBy, ascending })`, mêmes clés qu'aujourd'hui). Bouton Rafraîchir conservé (`variant: 'ghost'`, icône seule, `aria-label`).
- [ ] **Step 4:** À partir de `md` : `ClientsTableau` avec les colonnes Client (Avatar 32 px + `casseTitre(display_name)` en `font-semibold` + `Tag` catégorie, n° client en `font-mono text-caption` dessous), Ville, Téléphone (`formatPhoneNumber`), Contrat (`StatusPill` « Contrat actif » si `has_active_contract`, sinon rien), Créé le (`formatDateShortFR`). Triables : Client (`display_name`), Ville (`city`), Créé le (`created_at`). Clic = ouvrir la fiche (même handler). Sous `md` : la grille de `ClientCard` actuelle. Pied : « 25 sur 3 612 » + bouton « Charger plus » (même `loadMore`, même `hasMore`) ; pas de pagination par page (le hook charge par ajout).
- [ ] **Step 5:** État vide, erreur, chargement inchangés dans leurs conditions. Retirer `DataTable` de `ALLOW_ORPHAN`. Build, lint, audit verts. Commit `feat(clients): liste en tableau, segments et recherche`.

### Task 4: `SidePanel` et `MenuActions` (controller)

**Files:**
- Modify: `package.json` (`@radix-ui/react-dialog`, même majeure que les autres paquets Radix installés)
- Create: `src/components/ui/side-panel.jsx`, `src/components/ui/menu-actions.jsx`

**Interfaces:**
- Produces:
  - `<SidePanel ouvert onFermer titre description? pied={node} largeur?='md'|'lg'>{children}</SidePanel>` — Radix Dialog, panneau collé à droite, `md` = 480 px, `lg` = 640 px, plein écran sous `sm` ; en-tête titre `font-display text-section` + bouton fermer ; corps défilant ; pied collé en bas, actions alignées à droite ; Échap et clic sur le voile appellent `onFermer`.
  - `<MenuActions libelle="Plus d'actions" actions={[{ label, icon?, onClick, danger?: boolean }|false]} />` — Radix Popover, déclencheur `Button variant="ghost" size="icon"` avec `MoreHorizontal`, liste verticale, `danger` en `text-st-alerte`, une entrée falsy ignorée.
- [ ] **Step 1:** Installer, écrire les deux composants. Consommateurs : arrivent en tâches 5 et 7 → `ALLOW_ORPHAN` avec la raison, retiré en tâche 7. Build, lint. Commit `feat(ui): panneau latéral et menu d'actions`.

### Task 5: En-tête de la fiche client (agent + relecture)

**Files:**
- Create: `src/apps/artisan/pages/client-detail/EnTeteFicheClient.jsx`
- Modify: `src/apps/artisan/pages/ClientDetail.jsx` (le bloc « Header » actuel, lignes ~357-490, sort dans le nouveau fichier ; l'état et les handlers restent dans `ClientDetail`)

**Interfaces:**
- Consumes: `PageHeader` (`breadcrumb`), `Avatar` (56), `StatusPill`, `Tag`, `Button`, `MenuActions` (Task 4), `LienWaze`, `InviteClientButton`, `toneFor`.

- [ ] **Step 1:** Fil d'Ariane « Clients › {nom} » (remplace la flèche retour). Titre `casseTitre(displayName)`. À côté du titre : `StatusPill` « Contrat actif » (tone ok) si `has_active_contract` ; `Tag` catégorie ; « Propriétaire » / « Locataire » en `Tag`. Sous le titre, une ligne : adresse en `LienWaze` (icône `Navigation`), n° client / compte Pennylane / ancien n° comme aujourd'hui (`font-mono text-caption`), « client depuis {année de created_at} ». Le « MàJ … » disparaît de l'en-tête.
- [ ] **Step 2:** Actions, de gauche à droite : icône « Appeler » (`tel:` sur `phone`, masquée sans téléphone, `aria-label`), icône « E-mail » (`mailto:`, masquée sans e-mail), « Itinéraire » (`LienWaze`, secondary), « Modifier » (secondary ; appelle `onModifier`, prop fournie par `ClientDetail`, branchée en tâche 7 — en attendant elle appelle `handleToggleLock`), puis l'action principale « Nouveau RDV » (`primary`, `canCreateAppointment && !isArchived`). « Nouveau SAV » va dans le menu « … » avec : Inviter au portail (le contenu d'`InviteClientButton` — si le composant ne se prête pas à une entrée de menu, le garder en bouton secondaire et le dire), Archiver (`danger`), Supprimer définitivement (`danger`, admin seul, mêmes conditions et mêmes confirmations qu'aujourd'hui).
- [ ] **Step 3:** Bannière « client archivé » inchangée. Sur téléphone, les actions passent sous le titre, boutons ≥ 44 px. Build, lint, audit. Commit `feat(fiche-client): en-tête de résumé et menu d'actions`.

### Task 6: Onglets regroupés et onglet Résumé (agent + relecture)

**Files:**
- Create: `src/apps/artisan/pages/client-detail/TabResume.jsx`, `src/lib/ficheClientOnglets.js`, Test: `scripts/fiche-client-onglets.test.mjs` (dans `audit:quality`)
- Modify: `src/apps/artisan/pages/ClientDetail.jsx` (tableau `TABS` et rendu des onglets)

**Interfaces:**
- Produces: `ONGLETS = ['resume','contrat','equipements','interventions','devis-factures','echanges']` avec libellés « Résumé, Contrat, Équipements, Interventions, Devis et factures, Échanges » ; `ongletDeDepart(etat?: string): string` (`info`→`resume`, `contract`→`contrat`, `equipments`→`equipements`, `interventions`→`interventions`, `devis-pl`/`factures-pl`→`devis-factures`, `timeline`/`mailings`/`sms`→`echanges`, inconnu/absent → `resume`).
- [ ] **Step 1: tests** de `ongletDeDepart` (chaque ancien identifiant + `undefined` + `'xyz'`).
- [ ] **Step 2:** Rendu : « Devis et factures » empile `TabDevisPL` puis `TabFacturesPL` (mêmes conditions `pennylane_account_number`) ; « Échanges » empile `TabTimeline`, `TabMailings`, `TabSms` sous trois `CardHeader` (« Historique », « E-mails », « SMS »). Compteurs des onglets Équipements / Interventions conservés. Barre d'onglets soulignée : onglet actif `text-secondary-900 font-semibold` + soulignement cuivre 2 px, inactif `text-secondary-500`.
- [ ] **Step 3:** `TabResume` (lecture seule, aucune requête nouvelle — il reçoit `client`, `owner`, `tenants` déjà chargés par `ClientDetail`, et réutilise les hooks des onglets existants s'il affiche leurs données) : colonne large (2/3) = « Prochaines interventions » (les 3 prochaines lignes de ce que `TabInterventions` charge, lien « Tout voir » vers l'onglet), « Historique » (5 dernières entrées de `useClientAuditTrail`, lien vers Échanges) ; colonne étroite (1/3) = « Coordonnées » (libellé 110 px `text-secondary-500`, valeur `font-medium` : téléphone(s) en `tel:`, e-mail en `mailto:`, adresse en `LienWaze`, accès, accords e-mail / SMS), « Logement » (type, surface, DPE + **le bloc `ClientLogementDpe` déplacé ici**, mêmes props que dans `TabInfo`), « Proches et sociétés liées » (masqué si vide), « Note » (notes visibles, et la note interne avec `InfoTip` « Non visible par le client »). Sur téléphone, une seule colonne.
- [ ] **Step 4:** `ClientLogementDpe` n'est plus rendu dans `TabInfo` (prop `avecLogement={false}` ou retrait, au choix), pour qu'il ne monte qu'une fois. Build, lint, audit. Commit `feat(fiche-client): onglet Résumé et onglets regroupés`.

### Task 7: Panneau « Modifier » (agent + relecture)

**Files:**
- Create: `src/apps/artisan/pages/client-detail/PanneauModifierClient.jsx`
- Modify: `src/apps/artisan/pages/ClientDetail.jsx`, `src/apps/artisan/pages/client-detail/TabInfo.jsx` (si nécessaire pour la mise en page étroite)

**Interfaces:**
- Consumes: `SidePanel` (largeur `lg`), `Button`, `champsModifies` (Task 2), `TabInfo` existant.

- [ ] **Step 1:** « Modifier » ouvre `PanneauModifierClient` : `TabInfo` avec `isLocked={false}` et les mêmes props qu'aujourd'hui, dans le panneau. Pied : « Annuler » (ghost) puis « Enregistrer » (primary, désactivé si `champsModifies(initialData, formData)` est vide ou `isUpdating`, `Loader2` pendant l'envoi). Enregistrer appelle **le même `handleSave`** ; le panneau se ferme seulement si l'enregistrement a réussi (faire rendre un booléen à `handleSave` sans changer ce qu'il envoie). Annuler, Échap, voile : remettent `formData` à `initialData` (logique actuelle de `handleToggleLock`) et ferment ; s'il y a des modifications, demander confirmation (`ConfirmDialog` existant) « Abandonner les modifications ? ».
- [ ] **Step 2:** Le cadenas, le bouton « Enregistrer » de l'en-tête et l'état verrouillé de l'onglet Résumé disparaissent ; `isLocked` ne sert plus qu'à piloter `TabInfo` dans le panneau. Retirer `SidePanel` et `MenuActions` d'`ALLOW_ORPHAN`.
- [ ] **Step 3:** `handleApplyInvestigation` (DPE appliqué depuis le Résumé) pré-remplit `formData` et ouvre le panneau au lieu de déverrouiller ; le toast reste.
- [ ] **Step 4: parité** — consigner dans le rapport, preuve à l'appui (lecture du diff) : mêmes 20 champs envoyés par `handleSave`, même validation (`lastName`, `emailRefuse`), même invalidation et même push Pennylane (`useClient`), `initialData` mis à jour après succès, `LinkedClientsSection` toujours éditable dans le panneau. Build, lint, audit. Commit `feat(fiche-client): modifier dans un panneau latéral`.

### Task 8: Accueil à l'écran, recette, mise en ligne (controller)

**Files:**
- Modify: `src/apps/artisan/pages/Dashboard.jsx`, `src/apps/artisan/components/dashboard/AccueilJournee.jsx`
- Create: `src/apps/artisan/components/dashboard/AccueilRelances.jsx`, `docs/recette-refonte-phase-3.md`

**Interfaces:**
- Consumes: `rdvEnCours`, `sousTitreAccueil`, `portefeuille.relancesPrioritaires` (Task 1) ; `Avatar`, `KpiCard`, `Card`, `CardHeader`, `LienWaze`.

- [ ] **Step 1:** `PageHeader` : titre « Bonjour, {prénom} », sous-titre `sousTitreAccueil` ; actions « Ouvrir le planning » (secondary, `to: '/planning'`, si `peutPlanning`) puis « Nouveau lead » (primary, `to: '/pipeline?tab=kanban&new=1'`, si `can('pipeline','create')`).
- [ ] **Step 2:** `AccueilJournee` : chaque ligne montre les personnes en `Avatar` 24 px (couleur = `p.couleur`, la couleur de la personne), un bouton icône « Itinéraire » (`LienWaze`, ≥ 44 px sur téléphone), et la ligne du RDV en cours en `bg-primary-50` avec « En cours » en `Tag`.
- [ ] **Step 3:** `KpiCard` « CA signé » : `delta` vs mois précédent si `dashboard.entreprise.precedent` existe (« ↗ 12 % vs octobre »). « Relances prioritaires » (`AccueilRelances`, sous « À traiter », si `peutPipeline` et liste non vide) : nom, montant HT, « sans relance depuis N j », lien vers le lead (`/pipeline?tab=kanban&lead=<id>`).
- [ ] **Step 4:** Recette `docs/recette-refonte-phase-3.md` (format des recettes précédentes) couvrant les trois écrans, le panneau Modifier (enregistrer, annuler, abandon avec modifications, DPE appliqué), les liens profonds d'onglets, le tableau (tri, charger plus, téléphone en cartes), à 1440 px, tablette, téléphone. Mettre à jour `CLAUDE.md` (fiche client : Résumé par défaut, panneau Modifier, `ongletDeDepart`) et la mémoire. Relecture d'ensemble (agent), corrections, push, suivi Vercel.
