# Brief Claude Code : refonte UI / UX de Majord'home

**Objectif :** donner à Majord'home l'allure d'un SaaS premium (Linear, Attio, Pipedrive), chaleureux et efficace pour les artisans, **sans toucher à la logique métier ni aux données**.

**À lire d'abord :**
- `DA.md` : la direction artistique complète (couleurs, typo, composants, navigation, règles d'écriture).
- `mockups/*.html` et `png/*.png` : les 6 écrans cibles (Accueil, Clients, Fiche client, Leads, Planning, Accueil mobile). Les maquettes sont la référence visuelle ; reprends les mesures du CSS des maquettes (`src/common.py`, variable `CSS`).

**Règles absolues :**
1. Aucune modification de schéma, de requête Supabase, de RPC, de cron, de fonction Edge ni de règle métier. Seulement des composants de présentation, des styles, des libellés et l'organisation des routes du menu.
2. Les anciennes URL continuent de fonctionner : chaque route renommée garde une redirection.
3. Chaque phase se livre seule, derrière un commit propre, et l'app reste utilisable entre deux phases.
4. Ne jamais copier de données réelles dans des tests, stories ou captures : utiliser des données fictives.
5. Avant de commencer, vérifie le stack réel (version de Tailwind, présence de shadcn/ui ou Radix, librairie d'icônes) et adapte les extraits ci-dessous.

---

## 1. Jetons de design

### 1.1 Variables CSS (`src/styles/tokens.css`, importé une seule fois à la racine)
```css
@import url("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Figtree:wght@400..700&family=Geist+Mono&display=swap");
/* En production : préférer @fontsource/bricolage-grotesque, @fontsource-variable/figtree, @fontsource/geist-mono (auto-hébergé). */

:root {
  /* Marque : cuivre */
  --brand-50:#FDF3EE; --brand-100:#F9E1D5; --brand-200:#F2C2AB; --brand-500:#D4693C;
  --brand-600:#C2532B; --brand-700:#A0421F; --brand-900:#5A2410;
  /* Neutres chauds */
  --n-0:#FFFFFF; --n-25:#FCFBF9; --n-50:#F7F5F1; --n-100:#F0EDE7; --n-150:#E8E4DC; --n-200:#DDD7CD;
  --n-300:#C5BDB1; --n-400:#A39A8E; --n-500:#7D7468; --n-600:#5E564C; --n-700:#443E36; --n-800:#2C2823; --n-900:#1C1915;
  /* 5 statuts */
  --st-neutre:#6B645B;  --st-neutre-bg:#F0EDE8;
  --st-info:#2D5BC7;    --st-info-bg:#EAF0FC;
  --st-ok:#1E7A4C;      --st-ok-bg:#E5F3EB;
  --st-attente:#A86A0E; --st-attente-bg:#FBF0DA;
  --st-alerte:#BE3328;  --st-alerte-bg:#FCE9E6;
  /* 4 activités planning */
  --act-pose:#C2532B;      --act-pose-bg:#FBEAE1;
  --act-visite:#2D5BC7;    --act-visite-bg:#E8EEFB;
  --act-entretien:#1E7A4C; --act-entretien-bg:#E3F2E9;
  --act-sav:#7A4BB8;       --act-sav-bg:#F0E9FA;
  /* Typo */
  --font-display:"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-ui:"Figtree", ui-sans-serif, system-ui, sans-serif;
  --font-mono:"Geist Mono", ui-monospace, monospace;
  /* Rayons */
  --r-sm:6px; --r-md:8px; --r-lg:12px; --r-xl:16px; --r-full:9999px;
  /* Ombres */
  --sh-xs:0 1px 2px rgba(28,25,21,.05);
  --sh-sm:0 1px 2px rgba(28,25,21,.04),0 2px 6px -1px rgba(28,25,21,.06);
  --sh-md:0 2px 4px rgba(28,25,21,.04),0 8px 20px -6px rgba(28,25,21,.10);
  --sh-lg:0 12px 32px -8px rgba(28,25,21,.18),0 4px 8px rgba(28,25,21,.05);
  --ring:0 0 0 3px rgba(194,83,43,.22);
}
html, body { background:var(--n-50); color:var(--n-900); font-family:var(--font-ui); font-size:15px; line-height:22px; -webkit-font-smoothing:antialiased; }
```

### 1.2 Tailwind v3 (`tailwind.config.ts`, section `theme.extend`)
```ts
extend: {
  colors: {
    brand: { 50:"var(--brand-50)",100:"var(--brand-100)",200:"var(--brand-200)",500:"var(--brand-500)",600:"var(--brand-600)",700:"var(--brand-700)",900:"var(--brand-900)" },
    n: { 0:"var(--n-0)",25:"var(--n-25)",50:"var(--n-50)",100:"var(--n-100)",150:"var(--n-150)",200:"var(--n-200)",300:"var(--n-300)",400:"var(--n-400)",500:"var(--n-500)",600:"var(--n-600)",700:"var(--n-700)",800:"var(--n-800)",900:"var(--n-900)" },
    st: { neutre:"var(--st-neutre)","neutre-bg":"var(--st-neutre-bg)", info:"var(--st-info)","info-bg":"var(--st-info-bg)", ok:"var(--st-ok)","ok-bg":"var(--st-ok-bg)", attente:"var(--st-attente)","attente-bg":"var(--st-attente-bg)", alerte:"var(--st-alerte)","alerte-bg":"var(--st-alerte-bg)" },
    act: { pose:"var(--act-pose)","pose-bg":"var(--act-pose-bg)", visite:"var(--act-visite)","visite-bg":"var(--act-visite-bg)", entretien:"var(--act-entretien)","entretien-bg":"var(--act-entretien-bg)", sav:"var(--act-sav)","sav-bg":"var(--act-sav-bg)" },
  },
  fontFamily: { display:["var(--font-display)"], sans:["var(--font-ui)"], mono:["var(--font-mono)"] },
  fontSize: {
    caption:["12px",{lineHeight:"16px",fontWeight:"500"}],
    label:["13px",{lineHeight:"18px",fontWeight:"600"}],
    "body-sm":["14px",{lineHeight:"20px"}],
    cell:["14.5px",{lineHeight:"20px"}],
    body:["15px",{lineHeight:"22px"}],
    section:["18px",{lineHeight:"26px",letterSpacing:"-0.012em",fontWeight:"600"}],
    count:["20px",{lineHeight:"26px",fontWeight:"600"}],
    title:["28px",{lineHeight:"34px",letterSpacing:"-0.022em",fontWeight:"600"}],
    kpi:["32px",{lineHeight:"38px",letterSpacing:"-0.025em",fontWeight:"600"}],
  },
  borderRadius: { sm:"var(--r-sm)", md:"var(--r-md)", lg:"var(--r-lg)", xl:"var(--r-xl)" },
  boxShadow: { xs:"var(--sh-xs)", sm:"var(--sh-sm)", md:"var(--sh-md)", lg:"var(--sh-lg)", ring:"var(--ring)" },
}
```
**Tailwind v4 :** déclarer les mêmes jetons dans `@theme { --color-brand-600: #C2532B; … --font-display: …; --text-title: 28px; … }`.

**Interdits après la phase 1 (à faire respecter par une règle ESLint ou une recherche en CI) :** `text-[8px]` à `text-[11px]`, `text-xs` utilisé pour du contenu (sauf `caption`), toute couleur `sky-*`, `blue-*`, `slate-*` codée en dur, `#0369a1`, et tout emoji dans le JSX.

---

## 2. Composants à créer (dossier `src/components/ui/`)

| Composant | Rôle | Points clés |
|---|---|---|
| `AppShell` | Barre latérale 248 px + barre supérieure 60 px + zone de contenu | Barre latérale `n-25`, repliable à 64 px ; contenu max 1 240 px, ou pleine largeur via `fullWidth` |
| `SidebarNav` | Menu par tâches (DA § 9) | Item actif : fond blanc, `shadow-sm`, icône `brand-600` ; badge = actions en attente |
| `TopBar` | Recherche globale, Assistant, notifications, avatar | Recherche ouvre la palette `CommandMenu` (Ctrl K) |
| `CommandMenu` | Recherche + création rapide (remplace « + Créer ») | « Créer un lead », « Nouveau RDV », « Nouveau client », « Nouveau devis », puis résultats |
| `PageHeader` | H1 28 px + sous-titre 1 ligne + actions à droite | Prop `primaryAction` rendue **en dernier** à droite |
| `Button` | Variantes `primary`, `secondary`, `ghost`, `link`, `danger` ; tailles `md` 38 px, `sm` 32 px ; `icon` | Un seul `primary` par écran (alerte de dev si plus) |
| `Card`, `CardHeader` | Conteneur blanc `r-xl`, `shadow-sm`, bordure `n-150` ; titre en `font-display text-section` | Actions à droite du titre |
| `KpiCard` | Libellé, valeur 32 px, contexte, `Delta`, `Sparkline` optionnelle | 4 maximum par écran |
| `StatusPill` | Point + mot, 5 tons : `neutre`, `info`, `ok`, `attente`, `alerte` | Fonction `toneFor(statut)` centralisée (§ 3) |
| `Tag` | Attribut neutre (source, ville) | Jamais coloré |
| `Avatar`, `AvatarStack` | Initiales, 6 couleurs déterministes depuis l'id | 24, 32, 56 px |
| `DataTable` | Tableau trié, sélection, menu de ligne, pagination | Lignes 56 px, en-tête `n-25`, tri visible, chiffres tabulaires, état vide intégré |
| `SegmentedControl` | 2 à 4 choix exclusifs, avec compteurs | Remplace les onglets de filtre et les bascules Jour/Semaine/Mois |
| `FilterChip` | Filtre vide (pointillé « + Ville ») ou actif (cuivre clair, croix) | Ouvre un `Combobox` |
| `Combobox` / `Select` | Remplace tous les `<select>` natifs | Recherche dès 7 options |
| `DatePicker` | Français : « lun. 23 nov. 2026 », semaine du lundi, fériés FR, raccourcis | Locale `fr` (date-fns), saisie `jj/mm/aaaa`, heures 24 h |
| `KanbanColumn`, `KanbanCard` | Colonnes `n-100` `r-xl`, cartes ≥ 260 px | Structure de carte : DA § 7 |
| `DropZone` | « Signés ce mois », « Perdus ce mois » | Accepte le glisser de `KanbanCard` |
| `EventBlock` | Bloc de planning par activité | Fond `act-*-bg`, bandeau gauche 3 px, heure + client ≥ 13 px, avatar |
| `Timeline` | Historique d'une fiche | Icône par type, date relative à droite |
| `KeyValueList` | Coordonnées en lecture | Libellé 110 px `n-500`, valeur 500 |
| `EmptyState` | Icône 40 px dans cercle `n-100`, une phrase, un bouton | Obligatoire pour chaque liste |
| `InfoTip` | Icône (i) + info-bulle | Remplace les sous-titres explicatifs |
| `SidePanel` | Panneau latéral 480 px pour « Modifier » | Annuler (ghost) + Enregistrer (primary) en bas à droite |

Icônes : `lucide-react` uniquement, `strokeWidth={1.75}`, taille 16-18.

---

## 3. Correspondance des statuts (fonction `toneFor`)

| Domaine | Valeur actuelle | Ton |
|---|---|---|
| Lead | Nouveau | `neutre` |
| Lead | Contacté, RDV planifié | `info` |
| Lead | Devis envoyé | `attente` |
| Lead | Gagné | `ok` |
| Lead | Perdu | `alerte` |
| Devis | Brouillon | `neutre` |
| Devis | Envoyé (< 21 j) | `info` |
| Devis | Sans relance > 21 j, Expiré | `attente` / `alerte` |
| Devis | Signé, Accepté, Facturé | `ok` |
| Devis | Refusé | `alerte` |
| Chantier | Gagné, Commande à faire, À planifier | `attente` |
| Chantier | Planifié | `info` |
| Chantier | Réceptionné | `ok` |
| Contrat | Actif | `ok` · À renouveler `attente` · Expiré `alerte` · Aucun `neutre` |
| Entretiens | Demande SAV, Urgent | `alerte` |
| Entretiens | Devis envoyé, Pièces commandées, Demande de contrat | `attente` |
| Entretiens | À planifier, Planifié, Certificat à faire | `info` |
| Entretiens | Réalisé, Facturé | `ok` |
| Planning (jour) | Pleine / Vide / Figée / À arbitrer | Remplacé par une jauge de charge ; « À arbitrer » devient `attente` dans l'info-bulle |

Les badges abrégés `Éq.`, `Mat.`, `PM`, `MR`, `EP`, `M.`, `S.`, `B.` disparaissent : soit un `Tag` en mots entiers (« Équipement reçu », « Matériel commandé »), soit un `Avatar` pour une personne.

---

## 4. Changements écran par écran

### 4.1 Barre latérale et menu (toutes pages)
- Nouveau menu : Accueil, Clients, Leads, Devis, Planning, Chantiers, Entretiens, Messages ; groupe « Outils » : Carte, Visibilité locale, Publicité, Boutique (si activé), Statistiques ; en bas : encart Assistant, Réglages.
- Retirer du menu : « Chantier Gaillac » (devient un chantier épinglé), « Cédants », « Prospection ». Garder les routes, avec une option d'affichage dans Réglages.
- Supprimer le bouton global « + Créer » ; brancher `CommandMenu` sur Ctrl K et sur la recherche.
- Redirections : `/pipeline` → `/leads`, `/pipeline?tab=kanban` → `/leads`, `/pipeline?tab=dashboard` → `/leads/statistiques`, `/territoire` → `/outils/carte`, `/geogrid` → `/outils/visibilite`, `/meta-ads` → `/outils/publicite`, `/webshop` → `/outils/boutique`, `/mailing` → `/messages`, `/dashboard` → `/`. (À adapter aux routes réelles.)
- Nouvelle entrée **Devis** : liste de tous les devis (`DataTable`) en réutilisant les requêtes déjà présentes dans Pipeline et la fiche client. **Aucune nouvelle requête.**

### 4.2 Accueil
- `PageHeader` : « Bonjour {prénom} », sous-titre « {jour} · {n} rendez-vous et {n} leads à rappeler », actions « Ouvrir le planning » (secondaire) + « Nouveau lead » (principal).
- 4 `KpiCard` : RDV aujourd'hui, Signé ce mois (+ variation), Devis en attente (+ montant), Taux de signature 90 j. Retirer « CA HT programmé, semaine prochaine » de l'en-tête (le garder dans Statistiques).
- « Ma journée » : liste des RDV du jour (bascule Aujourd'hui / Demain), `EventRow` avec heure, bandeau d'activité, client, ville, avatars, bouton Itinéraire ; RDV en cours surligné `brand-50`.
- « À traiter » : mêmes compteurs qu'aujourd'hui, avec icône teintée par urgence et sous-ligne courte.
- « Relances prioritaires » : les 3 devis « sans relance > 21 j » au plus gros montant (données déjà calculées pour le compteur).
- Blocs « À corriger », « Clients en double dans Pennylane », « Leads rattachés à plusieurs clients Pennylane » : **déplacés** vers Réglages › Qualité des données. Sur l'Accueil, une seule ligne : « {n} fiches à rapprocher avec Pennylane · Vérifier ».

### 4.3 Clients (liste)
- Supprimer les 6 KPI. Les remplacer par `SegmentedControl` : Tous, Particuliers, Entreprises, Secteur public (avec compteurs) ; « Archivés » passe dans le menu « … » de la barre d'outils.
- Grande recherche 48 px, raccourci « / ».
- Filtres en `FilterChip` : Contrat, Ville, Équipement (remplacent les selects natifs).
- Grille de cartes → `DataTable` : Client (avatar + nom en casse normale + type), Ville, Téléphone, Contrat (`StatusPill`), Dernière visite, Prochain RDV, CA total, menu « … ». Tri par colonne, pagination 25.
- Afficher les noms en casse « Titre » à l'affichage seulement (`Famille Delorme`), sans modifier la donnée.
- Bouton « Carte » qui ouvre l'ex-Territoire filtré.

### 4.4 Fiche client
- En-tête : fil d'Ariane, avatar 56 px, nom en `text-title`, `StatusPill` du contrat, adresse et « Client depuis {année} » ; actions : Appeler (`tel:`), E-mail (`mailto:`), Itinéraire (Waze ou Google Maps selon préférence), Modifier, **Nouveau RDV** (menu : RDV, SAV, Devis).
- « Inviter au portail », Archiver, Supprimer : dans le menu « … ».
- Onglets : Résumé, Équipements, Interventions, Devis et factures (fusion Devis + Factures), Documents, Échanges (fusion Timeline + Mailings + SMS), avec compteurs.
- Nouvel onglet par défaut **Résumé** (lecture seule) : Prochaine intervention, Devis, Historique (5 derniers) à gauche ; Coordonnées, mini-carte, Équipements, Logement, note épinglée à droite.
- Le formulaire actuel (Identité, Contact, Adresse, Logement, Notes) devient le `SidePanel` « Modifier », mêmes champs, mêmes validations, mêmes appels.
- Bloc MonsieurDPE : n'apparaît que s'il a un résultat ; sinon une ligne « DPE non trouvé · Chercher » dans Logement.

### 4.5 Leads (ex-Pipeline)
- Titre « Leads », sous-titre « {n} en cours · {montant} potentiels ». `SegmentedControl` : Tableau, Liste, Statistiques. Principal : « Nouveau lead ». « Nouveau devis » passe dans le menu de la carte et dans la page Devis.
- Barre d'outils : filtre texte, chips Commercial, Source, Période, Projet ; tri « par urgence ».
- 4 colonnes actives (Nouveau, Contacté, RDV planifié, Devis envoyé), largeur ≥ 260 px, défilement horizontal si nécessaire.
- Gagné et Perdu → `DropZone` « Signés ce mois » / « Perdus ce mois » avec total ; un clic ouvre la liste filtrée. Le dépôt sur Perdu ouvre la sélection du motif existante.
- `KanbanCard` selon la DA ; supprimer l'icône sablier, la date en grand chiffre de couleur, les badges abrégés.
- Ex-« Suivi MT-LT » → Statistiques › « Suivi des objectifs ».

### 4.6 Planning
- Une seule ligne d'outils : Aujourd'hui, ‹ ›, période en titre (`font-display` 20 px), `SegmentedControl` Jour / Semaine / Mois, équipe en avatars cliquables ; « Imprimer » et « Tolérances » dans le menu « … ».
- Sous-titre de page : « Semaine {n} · {CA} HT posés · {n} créneaux libres ».
- En-tête de jour : abréviation, numéro (pastille cuivre aujourd'hui), CA du jour, jauge de charge. Supprimer les lignes « Pleine / Vide / Figée / À arbitrer » de la grille (le détail en info-bulle sur la jauge).
- `EventBlock` : fond pâle par activité, bandeau gauche, « 8:00 · Pose » puis le client (≥ 13 px), ville si la hauteur le permet, avatar en bas à droite ; plus de hachures ni d'emojis. Chevauchement : colonnes côte à côte.
- Trait « maintenant » cuivre. Légende des 4 activités en pied.
- « Trouver un créneau » (secondaire) ouvre la recherche existante ; « Nouveau RDV » (principal).

### 4.7 Chantiers
- Même kanban que Leads (`KanbanCard`), colonnes : À commander, À planifier, Planifié, Réceptionné ; « Gagné » devient un filtre. Le chantier « Gaillac » est épinglé en tête.
- Retirer le sous-titre « Suivi post-vente : commandes, planification et réalisation » et l'icône emoji du titre.

### 4.8 Entretiens et SAV
- Retirer les 4 KPI à icône colorée ; garder un sous-titre « {n} contrats actifs · {n} entretiens à faire ».
- `SegmentedControl` : Suivi (kanban), Contrats, Programmation, Clos. « Dashboard » passe dans Statistiques.
- Boutons : « Lancer l'appel ({n}) » devient secondaire ; « Nouveau SAV » secondaire ; « Nouveau contrat » principal.
- Statuts via `toneFor` ; « Urgent » = `StatusPill alerte`, plus de badge rouge plein.

### 4.9 Réglages
- Retirer le sous-titre « Gérez les paramètres de votre compte et de votre organisation ».
- Navigation en colonne gauche (Entreprise, Équipe, Devis et facturation, Catalogue, Intégrations, Qualité des données, Modules) au lieu de la longue page de cartes.
- Nouvelle section « Qualité des données » qui reprend les blocs Pennylane de l'Accueil, à l'identique fonctionnellement.

### 4.10 Mobile (< 768 px)
- Barre inférieure : Accueil, Planning, Clients, Leads, Plus ; bouton flottant « + » (ouvre `CommandMenu` en feuille).
- Accueil mobile : 2 KPI sur une ligne, carte « Prochain RDV » (`n-900`, boutons Itinéraire / Appeler de 44 px), liste « Ensuite », tuiles « À traiter ».
- Zones tactiles ≥ 44 px, texte ≥ 14 px.

---

## 5. Textes à couper ou réécrire

| Écran | Texte actuel | Remplacement |
|---|---|---|
| Accueil | « Ménage des données. Rien ici ne bloque le travail du jour. » | Supprimé (le bloc part dans Réglages) |
| Accueil | « Une seconde fiche Pennylane correspond à un client déjà lié. À fusionner dans Pennylane en gardant la fiche liée à Majord'home ; la ligne disparaît au passage suivant du cron. » | Dans Qualité des données : « Doublon dans Pennylane. Fusionnez-les dans Pennylane ; la ligne disparaîtra à la prochaine mise à jour. » |
| Accueil | « Pennylane ne peut pas faire foi sur l'identité de ces leads : leur synchronisation est suspendue. Deux personnes différentes → retirer les devis du mauvais client (ils redeviennent « Non rattachés » dans l'explorateur). … » | « Un même lead est relié à plusieurs clients Pennylane. Retirez les devis du mauvais client. » + `InfoTip` pour le détail |
| Accueil | « Ce qui attend aujourd'hui, quelle que soit sa date. » | Supprimé ; titre « À traiter · 34 actions » |
| Accueil | « CA HT programmé, semaine prochaine » / « Interventions posées au planning » | « Signé en novembre » / « ↗ 12 % vs octobre » (KPI déplacé dans Statistiques) |
| Accueil | « Aucun RDV aujourd'hui. » | `EmptyState` : « Aucun rendez-vous aujourd'hui. » + [Voir demain] |
| Clients | « 3612 clients au total » | « 3 612 clients · 490 contrats d'entretien actifs » |
| Clients | « Rechercher par nom, email, téléphone, ville... » | « Nom, téléphone, e-mail, ville ou n° de devis… » |
| Clients | « Tous les catégories », « Tous », « Nom (A-Z) » (selects) | Segments + chips « + Contrat », « + Ville » ; tri dans l'en-tête de colonne |
| Fiche | « Accepte de recevoir des emails (optin mailing) » | « Accepte les e-mails » |
| Fiche | « Notes internes (non visibles par le client) » | « Note interne » + `InfoTip` « Non visible par le client » |
| Fiche | « L'adresse du client n'est pas reconnue au numéro près (lieu-dit, numéro manquant ou inconnu de la Base Adresse Nationale) : le bâtiment ne peut pas être identifié. Complétez l'adresse, ou cherchez dans les DPE publics. » | « DPE non trouvé pour cette adresse. [Chercher] » |
| Fiche | « Y aller avec Waze » | « Itinéraire » |
| Fiche | « Clients liés » / « Aucun client lié » | « Proches et sociétés liées » ; masqué si vide |
| Fiche | Onglet « Timeline » | « Échanges » |
| Pipeline | « Pipeline » + onglets « Dashboard · Kanban · Suivi MT-LT » | « Leads » + « Tableau · Liste · Statistiques » |
| Pipeline | « 652 leads actifs » | « 318 en cours · 2,2 M€ potentiels » (valeurs réelles calculées) |
| Pipeline | « Tous les mois » | Chip « + Période » |
| Pipeline | Colonne « Gagné » | « Signé » |
| Pipeline › Dashboard | « Écart vs oct. sur l'activité de la période. Les deux dernières colonnes suivent les leads reçus. » | Supprimé + `InfoTip` sur l'en-tête des deux colonnes |
| Pipeline › Dashboard | « Le portefeuille ouvert aujourd'hui, hors projets en suivi MT-LT. Ne dépend pas de la période. » | `InfoTip` « Hors projets en suivi d'objectifs » |
| Chantiers | « Suivi post-vente : commandes, planification et réalisation » | Supprimé ; sous-titre « 118 chantiers · 6 à planifier » |
| Chantiers | « Devis signé », « Acompte versé, à commander », « Commandes reçues, pose à dater » (sous les colonnes) | Supprimés (titres de colonne explicites) |
| Entretiens | « 490 contrats actifs · Année 2026 » | « 490 contrats actifs · 161 entretiens à faire » |
| Planning | « Tolérances », « Pleine », « Vide », « Figée », « À arbitrer » | Menu « … » ; jauge de charge + info-bulle |
| Planning | « Intervention » / « Commercial » (filtre) | Légende Pose / Visite / Entretien / SAV + filtre équipe |
| Réglages | « Gérez les paramètres de votre compte et de votre organisation » | Supprimé |
| Réglages | « Votre entreprise, votre équipe, vos clients et leur parc — toujours inclus. » | Supprimé |
| Partout | « + Créer » | Supprimé (Ctrl K et bouton principal de page) |
| Partout | Mots « cron », « Place ID », « {{VAR}} », « MT-LT », « fiche liée », « sync » | « mise à jour automatique », « fiche Google », « champ personnalisé », « suivi des objectifs », « fiche rattachée », « mise à jour » |

---

## 6. Les 15 changements les plus rentables (par impact)

| # | Changement | Critères d'acceptation |
|---|---|---|
| 1 | **Jetons + polices** (Bricolage Grotesque, Figtree, cuivre, neutres chauds) | `tokens.css` chargé à la racine ; aucun texte < 12 px sur les 6 écrans cibles ; plus aucune occurrence de `#0369a1` ni de `text-[8-11px]` ; Lighthouse Accessibilité ≥ 95 sur Accueil |
| 2 | **Nouveau menu par tâches** + redirections | Le menu contient exactement les entrées de la DA § 9 ; « Chantier Gaillac », « Cédants », « Prospection » n'y figurent plus ; toutes les anciennes URL redirigent sans 404 |
| 3 | **Fiche client : Résumé lisible + Modifier en panneau** | La fiche s'ouvre sur Résumé, au-dessus de la ligne de flottaison à 1440×900 : prochaine intervention, devis, coordonnées ; Modifier ouvre un panneau avec les mêmes champs et le même enregistrement qu'avant (tests existants verts) |
| 4 | **Clients en tableau** | 25 lignes triables par Client, Ville, Contrat, Dernière visite, CA ; recherche « / » ; les 6 KPI ont disparu ; temps de rendu ≤ celui de la grille actuelle |
| 5 | **Accueil « cockpit »** | 4 KPI, Ma journée, À traiter, Relances ; les blocs Pennylane ne sont plus sur l'Accueil mais dans Réglages › Qualité des données, avec les mêmes actions |
| 6 | **5 statuts via `toneFor`** | Une seule fonction centralise les couleurs ; recherche des classes `bg-(red|orange|green|blue|purple|yellow)-` dans `src/` hors `ui/` = 0 ; chaque pastille affiche un mot entier |
| 7 | **Une action principale par page, en haut à droite** ; suppression de « + Créer » | Sur chaque page : 1 seul `Button variant="primary"` ; il est le dernier élément de `PageHeader`; Ctrl K propose les 4 créations |
| 8 | **Kanban Leads aéré** | Colonnes ≥ 260 px ; nom du client jamais tronqué sur 2 lignes ; aucun badge abrégé ; Signé/Perdu en zones de dépôt ; le glisser-déposer change l'étape comme avant |
| 9 | **Planning lisible** | Toolbar sur 1 ligne à 1440 px ; texte des RDV ≥ 13 px ; 4 couleurs d'activité + légende ; aucun emoji ni hachure |
| 10 | **Combobox + DatePicker français** | 0 `<select>` natif dans les 6 écrans ; toutes les dates affichées au format « lun. 23 nov. 2026 », semaine du lundi, saisie `jj/mm/aaaa` |
| 11 | **Couper les textes** (tableau § 5) | Chaque texte listé est remplacé ou supprimé ; aucun sous-titre de page ne dépasse une ligne à 1440 px ; aucun mot de la liste « jargon » n'apparaît à l'écran (test e2e de recherche de texte) |
| 12 | **Icônes Lucide, zéro emoji** | Recherche Unicode emoji dans le JSX = 0 ; une seule librairie d'icônes importée |
| 13 | **États vides avec action** | Chaque liste/kanban vide affiche `EmptyState` avec un bouton qui ouvre la création correspondante |
| 14 | **Nouvelle entrée Devis** | Liste de tous les devis (réf., client, montant, statut, âge) triable, filtre « À relancer », sans nouvelle requête ni migration |
| 15 | **Accueil mobile** | À 390 px : 2 KPI sur une ligne, Prochain RDV visible sans défiler, boutons ≥ 44 px, barre 5 onglets + « + » |

---

## 7. Découpage en phases (livrable à chaque étape)

| Phase | Contenu | Risque | Changements de la liste |
|---|---|---|---|
| **0 · Fondations** (½ j) | `tokens.css`, polices, config Tailwind, `Button`, `Card`, `StatusPill`, `Tag`, `Avatar`, `toneFor` | Nul : rien n'est encore branché | — |
| **1 · Coquille** (1 j) | `AppShell`, `SidebarNav`, `TopBar`, `CommandMenu`, `PageHeader`, redirections ; jetons appliqués globalement | Faible : navigation seulement | 1, 2, 7 |
| **2 · Écrans quotidiens** (2-3 j) | Accueil, Clients en tableau, Fiche client (Résumé + panneau Modifier) | Moyen : vérifier que le formulaire déplacé enregistre à l'identique | 3, 4, 5 |
| **3 · Commerce et terrain** (2-3 j) | Leads kanban, Planning, Chantiers, Entretiens, nouvelle page Devis | Moyen : glisser-déposer et planning à retester | 6, 8, 9, 14 |
| **4 · Finitions** (1-2 j) | Combobox, DatePicker, EmptyState, textes § 5, emojis, Réglages + Qualité des données, mobile | Faible | 10, 11, 12, 13, 15 |

À la fin de chaque phase : captures à 1440×900 et 390×844 des écrans touchés, comparées aux `png/` des maquettes ; tests existants verts ; aucun fichier de migration, de RPC ou de fonction Edge dans le diff (`git diff --stat` le prouve).

---

## 8. Ce qu'il ne faut pas faire
- Ne pas renommer de champ, de table ni de valeur de statut en base : les nouveaux libellés sont une couche d'affichage.
- Ne pas supprimer les modules Cédants, Prospection, Webshop : seulement les sortir du menu.
- Ne pas ajouter de dépendance lourde de design system complet ; Radix ou shadcn/ui seulement s'ils sont déjà là ou pour Combobox / DatePicker / Dialog.
- Ne pas changer les e-mails envoyés aux clients (Messages) dans cette refonte.
