# Majord'home : direction artistique

> Version 1, 22 novembre 2026. Base de la version SaaS (nom commercial envisagé : Arpet). Les maquettes sont dans `mockups/`, leurs rendus dans `png/`. Toutes les données affichées sont fictives.

## 1. Positionnement et personnalité

**Le logiciel de l'artisan qui tient sa boîte.** Le chef d'entreprise ouvre Majord'home le matin et sait en 10 secondes ce qu'il doit faire : qui rappeler, où sont ses équipes, quels devis relancer.

| On veut être | On ne veut pas être |
|---|---|
| Chaleureux, comme un atelier bien rangé | Froid, gris, « logiciel d'administration » |
| Direct, avec des mots de métier | Bavard, avec du jargon de développeur |
| Dense quand il faut (listes, planning) | Une grille de cartes où rien ne se compare |
| Calme : une seule couleur d'action | Un arc-en-ciel de badges |
| Premium mais sans luxe (Linear, Attio, Pipedrive) | Un gadget sans profondeur |

Trois mots qui guident chaque choix : **clair, chaleureux, efficace**.

Signature visuelle : un fond **papier chaud** (beige très clair), des cartes blanches qui flottent légèrement, et **une seule couleur de marque, le cuivre**, qui rappelle le métier (cuivre de plomberie, flamme, soleil) et sert uniquement aux actions et à la sélection.

## 2. Couleurs

### Marque : cuivre
| Jeton | Hex | Usage |
|---|---|---|
| `brand-50` | `#FDF3EE` | Fond de ligne ou de carte sélectionnée, « en cours » |
| `brand-100` | `#F9E1D5` | Bordure de sélection douce |
| `brand-200` | `#F2C2AB` | Bordure de filtre actif |
| `brand-500` | `#D4693C` | Dégradé du logo, graphiques |
| `brand-600` | `#C2532B` | **Bouton principal**, onglet actif, icône de menu active, indicateur « maintenant » |
| `brand-700` | `#A0421F` | Survol du bouton principal, liens texte |
| `brand-900` | `#5A2410` | Texte sur fond cuivre clair |

Règle : le cuivre ne sert **jamais** à un statut. Il veut dire « action » ou « vous êtes ici ».

### Neutres chauds (pierre)
| Jeton | Hex | Usage |
|---|---|---|
| `n-0` | `#FFFFFF` | Cartes, champs |
| `n-25` | `#FCFBF9` | Barre latérale, en-têtes de tableau, pieds de carte |
| `n-50` | `#F7F5F1` | **Fond de l'application** |
| `n-100` | `#F0EDE7` | Fond des colonnes kanban, séparateurs de lignes, contrôle segmenté |
| `n-150` | `#E8E4DC` | Bordures de carte |
| `n-200` | `#DDD7CD` | Bordures de champs et de boutons secondaires |
| `n-300` | `#C5BDB1` | Cases à cocher, chevrons |
| `n-400` | `#A39A8E` | Icônes inactives, placeholders, heures |
| `n-500` | `#7D7468` | Texte secondaire (contraste 4,6:1 sur blanc) |
| `n-600` | `#5E564C` | Libellés, menu |
| `n-700` | `#443E36` | Texte appuyé |
| `n-900` | `#1C1915` | Titres, texte principal |

### Statuts : 5 couleurs, pas une de plus
Chaque statut a une couleur de texte et un fond pâle. Une pastille affiche **toujours un point et un mot** : la couleur seule ne porte jamais l'information.

| Statut | Texte | Fond | Exemples |
|---|---|---|---|
| Neutre | `#6B645B` | `#F0EDE8` | Brouillon, Aucun contrat, Nouveau |
| Info | `#2D5BC7` | `#EAF0FC` | Planifié, Confirmé, Envoyé (lu) |
| Succès | `#1E7A4C` | `#E5F3EB` | Signé, Payé, Contrat actif, Terminé |
| En attente | `#A86A0E` | `#FBF0DA` | À relancer, À renouveler, Envoyé sans réponse |
| Alerte | `#BE3328` | `#FCE9E6` | En retard, Expiré, Refusé, Perdu |

Correspondance avec les plus de 10 couleurs actuelles : chaque étape du pipeline, chaque statut de devis ou de chantier est rattaché à l'une de ces 5 familles (voir le brief, § 3).

### Activités du planning : 4 catégories
Ce ne sont pas des statuts mais des types de rendez-vous, chacun avec un bandeau gauche et un fond pâle.

| Activité | Couleur | Fond |
|---|---|---|
| Pose / installation | `#C2532B` | `#FBEAE1` |
| Visite technique | `#2D5BC7` | `#E8EEFB` |
| Entretien | `#1E7A4C` | `#E3F2E9` |
| SAV | `#7A4BB8` | `#F0E9FA` |

L'équipe se reconnaît à l'**avatar** (initiales sur pastille de couleur), pas à la couleur du bloc.

## 3. Typographie

Deux polices Google Fonts, plus une police à chasse fixe pour les références.

- **Bricolage Grotesque** (titres et chiffres clés) : une grotesque avec du caractère, un peu artisanale, très lisible en grand. Elle donne l'identité.
- **Figtree** (interface et texte) : une sans-serif ronde et amicale, très lisible à 14-15 px, avec chiffres tabulaires.
- **Geist Mono** (références de devis, numéros de facture) : uniquement pour `D-2026-0412` et équivalents.

| Rôle | Police | Taille / interligne | Graisse | Approche |
|---|---|---|---|---|
| Titre de page (H1) | Bricolage | 28 / 34 px | 600 | −0,022 em |
| Nom dans une fiche | Bricolage | 28 / 34 px | 600 | −0,022 em |
| Chiffre clé (KPI) | Bricolage | 32 / 38 px | 600 | −0,025 em, chiffres tabulaires |
| Titre de section (H2, carte) | Bricolage | 18 / 26 px | 600 | −0,012 em |
| Chiffre secondaire (compteur) | Bricolage | 20 / 26 px | 600 | |
| Texte courant | Figtree | 15 / 22 px | 400 | |
| Cellule de tableau, menu | Figtree | 14,5 / 20 px | 400 à 600 | |
| Texte secondaire | Figtree | 14 / 20 px | 400 | couleur `n-500` |
| Libellé de champ, en-tête de tableau | Figtree | 13 / 18 px | 600 | couleur `n-500` |
| Légende, pastille, compteur | Figtree | 12 à 12,5 / 16 px | 500 à 600 | **minimum absolu : 12 px** |

Règles :
- Plus rien sous 12 px (aujourd'hui le planning descend à 8-9 px).
- Pas de MAJUSCULES pour les noms de clients ; seule l'abréviation du jour du planning (LUN., MAR.) est en capitales.
- Les montants et les heures utilisent `font-variant-numeric: tabular-nums` pour s'aligner en colonne.
- Graisse 600 pour mettre en valeur, jamais 800-900.

## 4. Espacement, rayons, ombres

- **Grille de 4 px.** Pas d'espacement autorisé : 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Marges de page : 32 px sur les côtés, 28 px en haut. Écart entre cartes : 20 px (16 px entre KPI).
- Rembourrage des cartes : 20 px ; en-tête de carte 18 px en haut, 12 px en bas.
- Hauteurs : bouton 38 px (petit 32 px), champ 38 px, recherche principale 48 px, ligne de tableau 56 px, barre supérieure 60 px.
- Barre latérale : 248 px, repliable à 64 px (icônes seules).

| Rayon | Valeur | Usage |
|---|---|---|
| `r-sm` | 6 px | Étiquettes, segments |
| `r-md` | 8 px | Boutons, champs, éléments de menu |
| `r-lg` | 12 px | Cartes kanban, listes internes |
| `r-xl` | 16 px | Cartes principales, colonnes |
| `r-full` | 999 px | Pastilles, avatars |

| Ombre | Valeur | Usage |
|---|---|---|
| `sh-xs` | `0 1px 2px rgba(28,25,21,.05)` | Boutons secondaires, champs |
| `sh-sm` | `0 1px 2px rgba(28,25,21,.04), 0 2px 6px -1px rgba(28,25,21,.06)` | Cartes, élément de menu actif |
| `sh-md` | `0 2px 4px rgba(28,25,21,.04), 0 8px 20px -6px rgba(28,25,21,.10)` | Carte survolée, carte glissée |
| `sh-lg` | `0 12px 32px -8px rgba(28,25,21,.18), 0 4px 8px rgba(28,25,21,.05)` | Menus déroulants, fenêtres, palette Ctrl K |
| Focus | `0 0 0 3px rgba(194,83,43,.22)` | Anneau de focus clavier |

La profondeur vient de **cartes blanches sur fond papier** avec une ombre douce, et non de bordures grises sur fond gris.

## 5. Icônes

- **Une seule famille : Lucide** (`lucide-react`), trait 1,75 px, 16 à 18 px dans l'interface, 22 px dans la barre mobile.
- **Zéro emoji** dans l'interface (fini 🔥 ❄️ 📄 dans les listes). Une information comme « chaudière » ou « urgent » passe par une icône Lucide (`flame`, `alert-triangle`) ou une pastille.
- Icône inactive en `n-400`, active en `brand-600`.
- Les icônes accompagnent un mot. Une icône seule n'est permise que pour les actions universelles (appeler, e-mail, plus d'options), toujours avec une info-bulle.

## 6. Boutons et règle de placement

| Niveau | Style | Quand |
|---|---|---|
| Principal | Fond cuivre `brand-600`, texte blanc | **Une seule action principale par écran** : Nouveau lead, Nouveau client, Nouveau RDV, Envoyer le devis |
| Secondaire | Fond blanc, bordure `n-200`, ombre `sh-xs` | Importer, Modifier, Itinéraire, Reporter |
| Discret | Sans fond, texte `n-600` | Colonnes, Carte, actions de barre d'outils |
| Lien | Texte `brand-700`, graisse 600 | « Tout voir », « Voir les leads → » |
| Danger | Texte `st-alerte`, fond blanc ; fond rouge seulement dans la fenêtre de confirmation | Supprimer, Archiver |

**Règle de placement :**
1. Les actions de page sont **en haut à droite de l'en-tête**, alignées sur le titre. L'action principale est **la plus à droite**.
2. Les actions d'une carte sont à droite de son titre.
3. Dans une fenêtre ou un formulaire : en bas à droite, « Annuler » (discret) puis l'action principale.
4. Une action destructrice n'est jamais collée à l'action principale : elle va dans le menu « … ».
5. **Le bouton global « + Créer » disparaît.** La création passe par le bouton principal de chaque page, et par la palette **Ctrl K** (« Créer un lead… », « Nouveau RDV… »).

## 7. Composants

### Carte KPI
Libellé (14 px, icône 16 px en `n-400`), valeur en Bricolage 32 px, ligne de contexte (13 px) avec une **variation** en pastille verte ou rouge (« ↗ 12 % vs octobre »). Mini-courbe optionnelle en bas à droite. **4 KPI maximum** par écran, et seulement s'ils changent une décision.

### Tableau
En-tête 40 px sur fond `n-25`, libellés 13 px en `n-500`, icône de tri sur chaque colonne triable (colonne triée en `n-900`, flèche cuivre). Lignes de 56 px, séparateur `n-100`, survol `n-50`, sélection `brand-50`. Première colonne : avatar + nom en gras + type en dessous. Montants alignés à droite en chiffres tabulaires. Menu « … » en fin de ligne. Pied : « 1–25 sur 3 612 » et pagination.

### Carte kanban
Fond blanc, rayon 12 px, rembourrage 14 px, **largeur minimale 260 px**. Ligne 1 : nom (15 px, gras) + avatar du commercial. Ligne 2 : projet · source (14 px). Ligne 3 : montant (gras) à gauche, prochaine échéance à droite avec icône, en couleur seulement si elle demande une action (ambre « À relancer · 21 j », rouge « Reçu il y a 3 h »). Aucun badge abrégé (`Éq.`, `Mat.`, `PM`).

### Pastille de statut
24 px de haut, rayon plein, point de 6 px + mot (12,5 px, 600). Les 5 familles du § 2 seulement. Texte en entier : « À renouveler », pas « À ren. ».

### Étiquette (tag)
22 px, rayon 6 px, fond `n-100`, texte `n-600`. Pour les attributs neutres : source, ville, équipement. Jamais colorée.

### État vide
Illustration au trait (icône Lucide 40 px dans un cercle `n-100`), une phrase qui dit ce qui manque, **un bouton d'action**. Exemple : « Aucun chantier planifié cette semaine. » + [Planifier un chantier].

### Contrôles de formulaire
- Champ de 38 px, bordure `n-200`, rayon 8 px, focus = bordure `brand-600` + anneau de focus.
- Libellé au-dessus (13 px, 600). Aide dans une **info-bulle (i)**, pas en paragraphe sous le champ.
- **Plus de `<select>` natif** : liste déroulante stylée avec recherche dès 7 options (composant Combobox).
- Interrupteur pour les oui/non, contrôle segmenté pour 2 à 4 choix exclusifs.
- Filtres en « chips » : pointillé quand le filtre est vide (« + Ville »), plein cuivre clair quand il est actif.

### Sélecteur de date en français
Format affiché **« lun. 23 nov. 2026 »**, saisie au clavier `jj/mm/aaaa`, semaine qui commence le lundi, jours fériés français grisés, raccourcis « Aujourd'hui », « Demain », « Lundi prochain ». Jamais de `mm/dd/yyyy`. Heures au format 24 h (`14:30`).

### Avatars
Initiales blanches sur pastille de couleur (6 teintes du nuancier). 24 px dans les listes, 32 px dans les tableaux, 56 px (carré arrondi) dans l'en-tête de fiche.

## 8. Règles d'écriture (microcopie)

1. **Un titre dit ce qu'on voit**, un sous-titre (facultatif) donne **un chiffre utile** : « Clients · 3 612 clients · 490 contrats d'entretien actifs ». Jamais un paragraphe d'explication.
2. **Vocabulaire d'artisan** : pose, visite technique, entretien, SAV, chantier, relance, devis signé. Interdits à l'écran : cron, Place ID, `{{VAR}}`, MT-LT, fiche liée, sync, webhook, ID technique.
3. **Verbes d'action sur les boutons** : « Nouveau lead », « Relancer », « Envoyer le devis », pas « Valider » ni « OK ».
4. **L'aide va dans une info-bulle** ou un lien « En savoir plus », jamais en texte permanent.
5. **Chiffres avant mots** : « 14 devis à relancer », pas « Il y a des devis qui attendent une relance ».
6. Phrases courtes, sans point final dans les libellés. Pas de « Veuillez ». Tutoiement interdit, vouvoiement léger.
7. Le temps se dit en langage humain : « il y a 3 h », « depuis 21 j », « mer. 25 nov. ».
8. Les messages d'erreur disent quoi faire : « Adresse introuvable. Vérifiez le numéro ou placez le point sur la carte. »

## 9. Navigation : organisée par tâches

```
Accueil          le cockpit du jour
Clients          liste, fiches, contrats rattachés à la fiche
Leads            tableau (kanban), liste, statistiques
Devis            tous les devis, relances, modèles
Planning         jour, semaine, mois, par équipe
Chantiers        poses en cours et à planifier
Entretiens       contrats d'entretien, visites annuelles, SAV
Messages         e-mails et SMS automatiques, campagnes
── Outils ──
Carte            (ex-Territoire)
Visibilité locale (ex-GeoGrid)
Publicité        (ex-Meta Ads)
Boutique         (ex-Webshop, si activé)
Statistiques     (ex-Pipeline › Dashboard et Suivi MT-LT)
── en bas ──
Assistant        encart IA (Ctrl K ou « Demander à l'assistant »)
Réglages         entreprise, équipe, intégrations, qualité des données
```

Le badge à droite d'un élément (ex. « Leads 9 ») = nombre d'actions qui vous attendent, pas un total.

| Module actuel | Nouvelle place |
|---|---|
| Dashboard | **Accueil** |
| Planning | **Planning** |
| Clients | **Clients** |
| Territoire | Outils › **Carte** (+ bouton « Carte » dans la liste Clients) |
| Pipeline › Kanban | **Leads** › Tableau |
| Pipeline › Dashboard | **Leads** › Statistiques et Outils › **Statistiques** |
| Suivi MT-LT | Outils › **Statistiques** › « Suivi des objectifs » |
| Webshop | Outils › **Boutique** (masqué si non activé) |
| Contrats | Onglet de la fiche client + filtre « Contrat » dans **Entretiens** |
| Chantiers | **Chantiers** |
| Entretiens | **Entretiens** (avec SAV) |
| Chantier Gaillac | Retiré du menu : c'est un chantier comme un autre, **épinglé** en tête de Chantiers |
| Cédants, Prospection | Retirés du menu (vides et en double). Prospection devient une **source de lead** ; Cédants est caché derrière une option dans Réglages |
| GeoGrid | Outils › **Visibilité locale** |
| Mailing | **Messages** |
| Meta Ads | Outils › **Publicité** |
| Devis (aujourd'hui éclatés entre Pipeline et fiches) | **Devis**, nouvelle entrée |
| Blocs Pennylane du dashboard | Réglages › **Qualité des données** (un rappel discret sur l'Accueil) |
| « + Créer » global | Supprimé : bouton principal de page + palette Ctrl K |

## 10. Gabarit de page (toutes les pages)

```
┌ Barre latérale 248 px ┬────────────────────────────────────────────────┐
│ Logo + nom            │ Barre 60 px : [Recherche… Ctrl K]   Assistant Cloche Avatar │
│ Entreprise ▾          ├────────────────────────────────────────────────┤
│ Menu principal        │ (Fil d'Ariane, sur les fiches seulement)       │
│ ── Outils ──          │ H1 28 px                     [Secondaire][Principal] │
│ …                     │ Sous-titre : 1 ligne, 1 chiffre utile          │
│                       │ ── 24 px ──                                    │
│ Encart Assistant      │ Barre d'outils : recherche · segments · filtres │
│ Réglages              │ Contenu : cartes blanches, écart 20 px          │
└───────────────────────┴────────────────────────────────────────────────┘
```

- Contenu limité à **1 240 px** de large pour les pages de lecture ; pleine largeur pour Leads et Planning.
- Une fiche (client, chantier, devis) = **en-tête de résumé** (avatar, nom, statut, adresse, actions) + **onglets** + **Résumé lisible en deux colonnes** (2/3 activité, 1/3 coordonnées). La modification se fait dans un panneau latéral ou un mode « Modifier », jamais par défaut.
- **Mobile (< 768 px)** : barre inférieure 5 onglets (Accueil, Planning, Clients, Leads, Plus), bouton flottant « + » cuivre, 2 KPI maximum sur une ligne, carte « Prochain RDV » en tête avec Itinéraire et Appeler en boutons de 44 px.
