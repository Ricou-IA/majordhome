# Refonte UI / UX : direction artistique « atelier chaleureux »

> Date : 2026-11-22. Sources, rangées dans le dépôt : `docs/ux/references/DA.md` (direction artistique : jetons `n-*`, `st-*`, `act-*`, typographie, composants) et `docs/ux/references/brief-grok-ui.md` (brief de Grok : § 1 jetons, § 3 correspondance statut → ton, § 5 textes à réécrire). Toute valeur citée ici sans chiffre se lit dans ces deux fichiers. Les maquettes citées par le brief (`mockups/`, `png/`) n'ont pas été fournies : la référence visuelle est le texte de la DA.

## 1. Intention

Majord'home va être commercialisé. Eric veut une interface au niveau des meilleurs SaaS actuels (Linear, Attio, Pipedrive) : chaleureuse, claire et efficace pour un chef d'entreprise artisan, **sans perdre aucune fonction**. Il cite le travail de Carine Lallemand (*Méthodes de design UX*, avec G. Gronier) : la qualité d'une expérience se **mesure** auprès des utilisateurs, elle ne se décrète pas.

Ce qui fera dire « réussi » :
- l'application a une identité propre (fond papier chaud, cartes blanches, un seul cuivre pour l'action), cohérente sur tous les écrans ;
- on lit l'écran plus vite : titres qui disent ce qu'on voit, un chiffre utile en sous-titre, une seule action principale en haut à droite ;
- aucune fonction, aucun garde-fou métier ni aucun lien profond ne disparaît ;
- la satisfaction mesurée (UEQ) progresse entre le passage après la phase 3 et celui après la phase 5 (pas de mesure sur l'interface actuelle, décision d'Eric).

## 2. Buts, non-buts, anti-buts

**Buts**
- Jetons de design (couleurs, typographie, rayons, ombres) appliqués partout.
- Une boîte à composants unique (`src/components/ui/`) consommée par les écrans.
- Écrans du quotidien refondus : Accueil, Clients, Fiche client, Leads, Planning, Chantiers, Entretiens, Devis, Réglages.
- Microcopie : textes du § 5 du brief, jargon retiré de l'écran.
- Un protocole de mesure UX léger, avant et après.

**Non-buts**
- Aucune modification de schéma, de vue, de RPC, de cron, d'edge function ni de règle métier.
- Les e-mails, SMS, PDF et pages publiques (`/pv`, `/rdv`) gardent leur habillage par organisation (couleur d'accent de l'entreprise). Seuls leurs neutres d'interface peuvent suivre la nouvelle palette.
- Pas de nouveau module, pas de nouvelle donnée affichée qui supposerait une nouvelle requête.
- Les URL ne changent pas (voir § 5.10).

**Anti-buts** (échec même si « ça marche »)
- Une fonction devenue inaccessible ou une information perdue (charge du planning, pose provisoire, sens des colonnes, garde Pennylane).
- Un arc-en-ciel remplacé par un autre : le cuivre utilisé comme statut.
- Un écran à moitié refondu qui reste en production des semaines.
- Une régression de contraste ou de lisibilité sur tablette ou sur téléphone.

## 3. Contraintes du projet (non négociables)

- `CLAUDE.md` § Conventions qualité : Tailwind seulement, composants ≤ 500 lignes, logique dans `src/lib/` (modules purs testés), aucun composant partagé livré sans consommateur dans le même commit.
- **Contraste** : texte blanc sur la couleur principale ≥ 4,5:1. Cuivre `#C2532B` + blanc = 4,60:1 (conforme, juste) ; `#A0421F` = 6,9:1.
- **Taille de texte** : plus rien sous 12 px hors écrans à géométrie fixe (planning, tournées, aperçu du modèle de devis, graphiques, solaire, thermique, GeoGrid, borne). Pour ces écrans, la règle actuelle (11 px minimum) reste, sauf mention contraire au § 5.
- Tablette rendue en 1 024 px forcés (`deviceViewport.js`) ; téléphone = barre du bas (`BarreDuBas`), jamais l'écran d'ordinateur réduit.
- Cartes de Kanban : **hauteur uniforme avant tout** (Eric, recette du 22/11) : une étiquette s'abrège plutôt que d'ajouter une ligne.
- Modules par organisation (`src/lib/modules.js`) : une entrée de menu n'apparaît que si le module est ouvert ; rien n'est retiré du catalogue.
- Multi-tenant : la marque de l'application (cuivre, Majord'home) est celle du produit. Le nom et le logo de l'entreprise connectée continuent de s'afficher là où ils s'affichent aujourd'hui.
- Travail sur `main`, commits par lot, pre-commit `lint:errors`. Pas d'aperçu navigateur côté Claude : vérification par `npx vite build`, tests, lint, puis recette d'Eric dans son navigateur (skill `recette-navigateur`).

## 4. Approches envisagées

| | Approche | Pour | Contre |
|---|---|---|---|
| **A** | **Les couleurs d'abord, puis écran par écran** | Effet visible dès le 1ᵉʳ jour, toute l'app reste cohérente en couleurs, chaque étape part seule | Pendant la transition, certains écrans ont la nouvelle palette mais l'ancienne mise en page |
| B | Composants d'abord, couleurs écran par écran | Propre sur le papier | Ancien bleu et nouveau cuivre cohabitent des semaines ; rien de visible longtemps |
| C | Nouvelle interface activable par organisation | Bascule sûre, mesure avant/après facile | Chaque écran maintenu en double ; le plus cher et le plus lent |

**Retenue par Eric : A.** Démarrage sans mesure de départ (Eric, 2026-11-22).

## 5. Décisions

### 5.1 Décidées par Eric
- **Au planning, un RDV garde la couleur de la PERSONNE** (`team_members.calendar_color`), le violet `#6D28D9` reste réservé à « facturé ». Les 4 couleurs d'activité de la DA ne colorent pas les blocs : l'activité se lit par son libellé court et une icône Lucide.
- Approche A.

### 5.2 Arbitrages proposés par Claude (conflits brief ↔ décisions récentes, annoncés à Eric sans objection)
1. **Lignes de charge du planning** (« Pleine / Vide / Figée / À arbitrer », « Vide · 0 € ») : **gardées**, restylées. Elles ouvrent « Remplir / figer une journée », seule porte de programmation. Une jauge de charge peut s'y ajouter, pas les remplacer.
2. **Pose provisoire** (hachures) : l'information reste. Forme proposée : bordure pointillée + icône `Clock` + libellé « Provisoire » dans l'infobulle ; hachure supprimée seulement si le nouveau signe se lit aussi bien.
3. **Leads** : colonnes Gagné et Perdu **conservées**, affichées étroites par défaut avec leur total (dépliables) ; règles de dépôt inchangées (gardes Pennylane, Perdu direct avec « Annuler » 8 s, pas de motif). Le brief citait un choix de motif qui n'existe plus.
4. **Chantiers** : colonnes actuelles et **sens écrit sous chaque titre conservés** (Eric, 17/11) ; pas d'avatar du commercial sur la carte.
5. **Création et recherche** : le menu « Créer » et la recherche Ctrl K restent **dans le menu latéral** (livrés le 22/11, bandeau du haut retiré exprès). Pas de barre supérieure sur ordinateur. Sur téléphone, la barre du bas garde son « Créer » central.
6. **Accueil** : le CA HT programmé reste pour les rôles de pilotage ; la section « À corriger » reste en bas, administrateur seul (décision du 22/11). Le brief demandait de les déplacer.
7. **Page Devis** : elle existe (`/devis`, explorateur) ; elle est restylée, pas recréée.
8. **Polices auto-hébergées** (`@fontsource`), jamais chargées depuis Google (RGPD).
9. **Cédants, Prospection, Chantier Gaillac** : restent au menu tant que leur module est ouvert (Cédants / Prospection : groupe « Développement » décidé le 22/11 ; Gaillac : module provisoire, retrait prévu par ailleurs).
10. **URL inchangées.** Seuls les libellés changent (Dashboard → Accueil, Pipeline → Leads, Territoire → Carte, GeoGrid → Visibilité locale, Meta Ads → Publicité, Webshop → Boutique, Mailing → Messages). Raison : des liens profonds circulent (`/pipeline?tab=kanban&lead=…`, `lienJourneePlanning`, liens d'e-mails, docs, tests) ; renommer une URL n'apporte rien à l'utilisateur qui lit le libellé.
11. **Contrats** : l'entrée de menu reste (aucune fonction perdue).
12. **Accents de rôle, badges** : les pastilles de statut passent par les 5 tons ; les couleurs des personnes (planning, avatars) ne sont pas des statuts et ne sont pas touchées.

### 5.3 Direction artistique retenue
Celle de `DA.md` (§ 2 à § 8), avec les arbitrages ci-dessus. Résumé : fond `#F7F5F1`, cartes blanches `r-xl` + `sh-sm`, cuivre `#C2532B` pour l'action et la sélection seulement, neutres chauds, 5 tons de statut (neutre, info, ok, attente, alerte), Bricolage Grotesque (titres, chiffres clés), Figtree (interface), Geist Mono (références), Lucide 1,75 px, zéro emoji.

## 6. Phases

Chaque phase = un ou plusieurs commits autonomes, l'application reste utilisable entre deux. Critères communs à toutes : `npx vite build` vert, `npm run lint` sans nouvel avertissement, `npm run audit:quality` vert, `git diff --stat` sans fichier sous `supabase/` ni `sql/`, recette d'Eric à 1440 px, sur tablette et sur téléphone.

### Phase 0 — Protocole de mesure (Claude prépare, Eric fait passer)
**Eric (2026-11-22) : on démarre sans mesure de départ.** Pas de comparaison avant / après sur l'interface actuelle ; la mesure sert à repérer les irritants qui restent, et à suivre la progression entre deux passages.
- `docs/ux/protocole-mesure.md` : UEQ-S (8 items) + 5 scénarios de tâches chronométrés (retrouver un client et l'appeler ; créer un lead ; poser un RDV d'entretien ; trouver les devis à relancer ; ouvrir la fiche d'un équipement et ses pièces). 5 à 8 personnes : Eric, Philippe, un technicien, un commercial, si possible quelqu'un de Cimaj.
- Premier passage après la phase 3, second après la phase 5. Résultats rangés dans `docs/ux/mesures/AAAA-MM-JJ.md`. Le protocole peut s'écrire à tout moment ; il ne bloque aucune phase.

### Phase 1 — Jetons et polices (le gros de l'effet)
- `tailwind.config.js` : l'échelle `primary` (bleu ciel, 1 108 usages) devient l'échelle **cuivre** complète (50 → 950, `600 = #C2532B`, `700 = #A0421F`, valeurs DA aux rangs donnés, intermédiaires interpolés) ; l'échelle `secondary` (ardoise, 4 423 usages) devient l'échelle **pierre chaude** (rangs alignés sur `n-*` de la DA ; `200` = bordure de carte). Les variables CSS de `index.css` (`--primary`, `--ring`, `--border`, `--background`…) suivent.
- Ajout des jetons nommés : `st-*`, `font-display` / `font-sans` / `font-mono`, tailles nommées (`caption` … `kpi`), rayons, ombres, anneau de focus cuivre.
- Bouton d'action : texte blanc sur `bg-primary-600` = `#C2532B` exactement (4,60:1, valeur fixée, jamais interpolée), survol `primary-700` (plus sombre, donc plus contrasté). L'état désactivé passe par l'opacité (pas d'exigence de contraste WCAG pour un contrôle inactif). Balayage mécanique des `bg-primary-700 … text-white` existants. Mise à jour de la règle dans `CLAUDE.md` § Composants. *(Choix de Claude, à confirmer par Eric : il avait fixé `700` le 22/11 pour le bleu, dont le `600` ne passait pas.)*
- **Cuivre utilisé comme statut** : la phase 1 part avec un reliquat **compté** (usages de `primary-*` hors bouton, lien, focus, sélection, listés par `audit-ui.mjs`), résorbé écran par écran dans les phases 3 à 5. Seuls les cas visibles sur les écrans du quotidien (pastilles « info », badges) passent sur `st-info` avant la mise en ligne.
- `gray-*` / `slate-*` codés en dur (≈ 2 400) → `secondary-*` équivalent, par codemod relu.
- Polices `@fontsource` importées une fois dans `main.jsx`.
- Garde anti-régression `scripts/audit-ui.mjs` (dans `audit:quality`) : compte, hors liste blanche des écrans à géométrie fixe, les `text-[8-11px]`, les `blue-* / sky-* / indigo-* / slate-* / gray-*` en dur, `#0369a1`, les emojis dans le JSX ; échoue si un compte augmente (comme `--max-warnings`).
- **À vérifier avant livraison** : vignettes du planning (`planningVignette.js` lie hauteurs et interligne 13 px au CSS ; Figtree n'a pas les métriques d'Inter), en-têtes de jour (`hauteurEnTeteReservee`), Kanbans à hauteur fixe. Tout endroit où `primary-*` sert de statut (info, sélection non actionnable) est repassé sur `st-info`.

### Phase 2 — Coquille et composants de base
Chaque composant part avec au moins un consommateur réel (règle anti-code mort).
- `Button` (primary, secondary, ghost, link, danger ; md 38 px, sm 32 px, icône) — réécriture de `components/ui/button.jsx`, variantes actuelles conservées en alias le temps de la migration.
- `PageHeader` (titre 28 px, sous-titre une ligne, actions à droite, principale en dernier ; avertissement en développement si plus d'un `primary`), `Card` / `CardHeader`, `KpiCard`, `StatusPill` + `toneFor` (module pur `src/lib/tonsStatut.js`, testé, correspondance du § 3 du brief), `Tag`, `Avatar` (couleur = `calendar_color` pour un membre de l'équipe, sinon 6 teintes déterministes), `EmptyState`, `InfoTip`, `SegmentedControl`.
- Menu latéral restylé (fond `n-25`, entrée active blanche + ombre, icône cuivre, repli à 64 px), libellés du § 5.2-10, groupes de `menuGroupes.js` revus (Accueil · Clients & ventes · Terrain · Outils · Développement), menu « Créer » et recherche restylés. Barre du bas restylée.
- `PageHeader` posé sur toutes les pages de menu.

### Phase 3 — Écrans du quotidien
- **Accueil** : `KpiCard` (4 au plus), « Ma journée » en liste avec heure, bandeau d'activité, personne en avatar, ville, Itinéraire ; « À traiter » ; « Relances prioritaires » (3 devis sans relance > 21 j au plus gros montant, données de `usePipelineDashboard` déjà chargées) ; `À corriger` inchangé en bas.
- **Clients** : `DataTable` (lignes 56 px, en-tête `n-25`, tri sur les colonnes que `clientsService` sait déjà ordonner via `orderBy`, pagination 25, « 1–25 sur 3 612 »), `SegmentedControl` Tous / Particuliers / Entreprises / Secteur public avec compteurs (remplacent les cartes KPI, mêmes chiffres), recherche 48 px + raccourci « / », filtres en chips, noms en casse titre à l'affichage seulement, bouton « Carte ».
- **Fiche client** : en-tête de résumé (avatar 56 px, nom, statut du contrat, adresse, « client depuis »), actions Appeler / E-mail / Itinéraire / Modifier / Nouveau RDV (menu) ; destructives dans « … ». Onglet **Résumé** par défaut en lecture (2/3 activité, 1/3 coordonnées). Le formulaire actuel de l'onglet Informations (Identité, Contact, Adresse, Logement, Notes) passe dans un `SidePanel` « Modifier » : mêmes champs, mêmes validations, mêmes appels (`useClient`, push Pennylane par deltas inchangé). Onglets fusionnés à l'affichage (Devis et factures ; Échanges = Timeline + Mailings + SMS) sans toucher aux composants qu'ils contiennent ; les autres onglets (Contrat, Équipements, Interventions, Documents…) restent des onglets tels quels.
  **Bloc MonsieurDPE (`ClientLogementDpe`) : il reste dans le Résumé (colonne de droite, partie Logement), même composant, monté à l'ouverture de la fiche comme aujourd'hui.** Son rattachement automatique se déclenche à son affichage (`actionALouverture`) : le mettre dans le panneau « Modifier » changerait son fonctionnement, c'est exclu. *(Choix de Claude.)*

### Phase 4 — Commerce et terrain
- **Leads** : titre « Leads », sous-titre chiffré, `SegmentedControl` sur les trois onglets ACTUELS renommés : Statistiques (ex-Dashboard, onglet par défaut inchangé), Tableau (ex-Kanban), Suivi des objectifs (ex-Suivi MT-LT). Pas de vue « Liste » : elle n'existe pas et serait une nouvelle vue. *(Choix de Claude.)* cartes à la DA dans la limite de la hauteur uniforme, colonnes ≥ 260 px, Gagné / Perdu étroites (§ 5.2-3), date de carte selon `dateDeCarte` (règle inchangée, seule la présentation change), plus de badges abrégés.
- **Planning** : barre d'outils sur une ligne à 1440 px (Aujourd'hui, ‹ ›, période en `font-display`, Jour / Semaine / Mois en `SegmentedControl`, filtres en entonnoir conservés, Imprimer et Tolérances dans « … »), en-tête de jour restylé (pastille cuivre pour aujourd'hui, CA du jour, lignes de charge restylées), blocs à la couleur de la personne (§ 5.1), pose provisoire selon § 5.2-2, trait « maintenant » cuivre, plus d'emoji. Gabarits de vignette inchangés dans leur logique ; texte porté à 12 px partout où le gabarit le permet.
- **Chantiers**, **Entretiens** (sous-titre chiffré à la place des 4 KPI, `SegmentedControl`, « Urgent » en `StatusPill alerte`), **Devis** (restyle de l'explorateur, filtre « À relancer » si la donnée est déjà dans la liste).

### Phase 5 — Finitions
- `Combobox` (recherche dès 7 options) à la place des 116 `<select>` natifs, écran par écran ; `DatePicker` français (« lun. 23 nov. 2026 », semaine du lundi, fériés grisés, saisie `jj/mm/aaaa`, 24 h) à la place des 33 `type="date"` — sauf là où le champ natif est voulu sur téléphone (clavier de date du système), à garder derrière `isPhone`.
- 106 emojis → icônes Lucide. Textes du § 5 du brief ; jargon retiré de l'écran (cron, sync, Place ID, `{{VAR}}`, MT-LT, fiche liée).
- `EmptyState` avec action sur chaque liste et Kanban vide.
- Réglages : navigation en colonne gauche généralisée (`SettingsPage disposition="menu"` existe déjà).
- Dépendances légères autorisées : `@radix-ui/react-dialog` (SidePanel), `react-day-picker` + `date-fns` (DatePicker), éventuellement `cmdk` (Combobox) ; pas de design system complet.

## 7. Laissé au constructeur
- Valeurs exactes des échelles intermédiaires (contrainte : contrastes AA vérifiés et notés dans le commit).
- API précise des composants, ordre interne des commits d'une phase.
- Choix `cmdk` ou Combobox maison sur Radix Popover.
- Quels écrans hors liste du § 6 reçoivent `PageHeader` en phase 2 ou plus tard.

## 8. Durée annoncée
Phase 1 : une journée de travail, visible dès sa mise en ligne. Phases 2 à 5 : plusieurs semaines de sessions, livrées écran par écran. Chaque fin de phase donne lieu à une recette d'Eric.
