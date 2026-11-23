# Recette — refonte de l'interface, phase 2 (menu, composants, en-têtes de page)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : `24cf1cfd` (2026-11-23) ; le menu était en ligne depuis `125ab233`
- **Comptes** : celui d'Eric (Mayer Énergie, administrateur) ; pour M4, un second compte (autre personne ou autre navigateur)
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.
- **Avant de commencer** : « Mettre à jour » si le site le propose en bas de l'écran, sinon Ctrl + Maj + R.

## Ce que change la phase 2

- **Menu latéral calmé** : la page ouverte est une carte blanche avec l'icône seule en cuivre ; « Créer » est un bouton blanc ; l'avatar est gris foncé. Le menu se replie en icônes seules.
- **Nouveaux noms dans le menu**, adresses inchangées : Dashboard → Accueil, Pipeline → Leads, Territoire → Carte, GeoGrid → Visibilité locale, Meta Ads → Publicité, Webshop → Boutique, Mailing → Messages. La recherche (Ctrl K) trouve aussi les anciens noms.
- **Pastilles de statut** : un point et un mot, dans l'un des cinq tons (neutre, info, succès, en attente, alerte).
- **En-tête de page commun** : titre au nom du menu, au plus une ligne de chiffre, actions à droite, une seule action cuivre, la plus à droite.
- **Rien d'autre ne bouge** : aucune donnée, aucun calcul, aucune adresse de page.

## Déjà fait, vérifié avant la mise en ligne

- Chaque tâche relue par un relecteur indépendant ; build, lint, `audit:quality` (2 043 tests) au vert.
- Défauts trouvés et corrigés en relecture : la recherche ne trouvait plus « pipeline » ; les nouvelles tailles de texte étaient effacées par l'outil de classes (aucun bouton n'avait la bonne taille) ; la pastille d'urgence SAV aurait grandi les cartes du Kanban ; deux tons de contrat.
- **Non vérifiable par un agent** : tout l'affichage. Rien n'est présumé validé.

## Tests

### Menu latéral

- [ ] **M1. La page ouverte n'est plus un pavé cuivre.**
  Où : n'importe quelle page. Ce que vous devez voir : l'entrée de la page ouverte sur fond blanc, légère ombre, texte foncé, icône cuivre ; les autres entrées en gris. Aucun bloc cuivre plein dans le menu, sauf le carré du logo.
- [ ] **M2. Les nouveaux noms.**
  Où : menu. Ce que vous devez voir : Accueil, Leads, Carte, Messages, Publicité, Visibilité locale, Boutique (selon vos modules). Cliquer chacun : la bonne page s'ouvre, l'adresse dans la barre du navigateur est l'ancienne (`/pipeline`, `/territoire`, `/mailing`…).
- [ ] **M3. Replier le menu.**
  Où : bouton en bas du menu, sur ordinateur. Ce que vous devez voir : le menu passe à une colonne d'icônes ; le survol d'une icône donne son nom ; toutes les entrées restent accessibles. Recharger la page : le menu reste replié.
- [ ] **M4. Le repli est propre à chaque compte.**
  Où : se connecter avec un autre compte sur le même navigateur. Ce que vous devez voir : le menu de cet autre compte n'est pas replié tant qu'il ne l'a pas replié lui-même.
- [ ] **M5. « Créer » et la recherche.**
  Où : menu → « Créer », puis Ctrl K. Ce que vous devez voir : « Créer » est un bouton blanc à bordure, son menu propose les mêmes créations qu'avant. Dans la recherche, taper « pipeline » puis « territoire » : Leads et Carte sont proposés.
- [ ] **M6. Votre avatar et votre rôle.**
  Où : bas du menu. Ce que vous devez voir : un rond gris foncé avec vos initiales ; votre rôle dans une étiquette grise.

### Téléphone

- [ ] **T1. La barre du bas.**
  Où : sur le téléphone. Ce que vous devez voir : la barre du bas comme avant, aux nouvelles couleurs ; le « Créer » central reste cuivre ; « Plus » ouvre le menu complet avec les nouveaux noms.

### En-têtes de page

- [ ] **P1. Un titre, une seule action cuivre.**
  Où : Planning, Leads, Chantiers, Entretiens, Contrats, Messages, Carte, Paramètres, Clients, et la page Devis Pennylane (hors menu). Ce que vous devez voir : un grand titre au nom du menu (police des titres) ; au plus un bouton cuivre, tout à droite.
- [ ] **P2. Les chiffres en sous-titre.**
  Où : Entretiens → sous le titre « 490 contrats actifs · 161 entretiens à faire · Année 2026 » (vos vrais chiffres) ; Contrats → « N contrats en cours de traitement ». Pendant le chargement : pas de « … », la ligne apparaît quand le chiffre est connu.
- [ ] **P3. Les phrases d'explication ont disparu.**
  Où : Chantiers (plus de « Suivi post-vente… », plus d'icône de casque orange), Paramètres (plus de « Gérez les paramètres… »), Devis Pennylane (plus de « Tous les devis Pennylane… »), Carte (plus de « Carte interactive… »).
- [ ] **P4. Les boutons d'action marchent comme avant.**
  Où : Entretiens → « Nouveau contrat » ; Clients → « Nouveau client » et « Importer » ; Carte → boutons de géocodage. Ce que vous devez voir : la même fenêtre ou le même effet qu'avant.

### Composants

- [ ] **C1. Pastille d'urgence SAV sur le Kanban.**
  Où : Entretiens → Kanban, une carte SAV « Urgent » à côté d'une carte normale. Ce que vous devez voir : une pastille rouge avec icône et le mot « Urgent », à la hauteur des autres étiquettes de la carte ; les deux cartes ont la même hauteur.
- [ ] **C2. Pastille de contrat sur la carte client.**
  Où : Clients, vue en cartes, un client sous contrat. Ce que vous devez voir : une pastille verte « Contrat actif ». Le nom du client reste lisible, même sur une carte étroite.
- [ ] **C3. Sélecteur Jour / Semaine / Mois.**
  Où : Planning. Ce que vous devez voir : un sélecteur à trois segments, le segment actif blanc ; cliquer chacun change bien de vue. Sur téléphone, les choix proposés sont les mêmes qu'avant.
- [ ] **C4. Chiffres de l'accueil.**
  Où : Accueil. Ce que vous devez voir : les mêmes chiffres qu'avant, dans des cartes avec un grand chiffre ; l'explication du CA programmé derrière le petit (i). Un chiffre inconnu s'affiche « — », jamais 0.
- [ ] **C5. Liste Clients vide.**
  Où : Clients, chercher un nom qui n'existe pas. Ce que vous devez voir : une icône dans un cercle, une phrase, « Effacer les filtres » et « Ajouter un client » (ce dernier seulement pour un compte qui a le droit de créer un client).
