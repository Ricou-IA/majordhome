# Recette — refonte de l'interface, phase 1 (jetons et polices)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : à compléter à la mise en ligne (six commits de phase 1, du 2026-11-22 : couleurs cuivre et pierre, polices, bouton d'action, gris repris, contrôle anti-régression, cuivre retiré des statuts)
- **Comptes** : celui d'Eric (Mayer Énergie, administrateur) ; pour R3, un compte d'un autre rôle s'il est sous la main
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.
- **Avant de commencer** : « Mettre à jour » si le site le propose en bas de l'écran, sinon Ctrl + Maj + R. Une page restée ouverte depuis hier montre l'ancienne version (bleu, ancienne police).

## Ce que change la phase 1

- La couleur principale passe du bleu au **cuivre**, et les gris deviennent des gris chauds (pierre).
- Le cuivre veut dire **action** ou **« vous êtes ici »** : bouton principal, lien, onglet actif, ligne ou carte choisie, champ actif. Il ne sert plus jamais à un statut.
- Un statut ou une information prend l'un des cinq tons : neutre (gris), info (**bleu**), succès (vert), en attente (ambre), alerte (rouge).
- Trois polices nouvelles : Bricolage Grotesque (titres et chiffres), Figtree (texte), Geist Mono (numéros, références).
- **Rien d'autre ne bouge** : aucune donnée, aucun calcul, aucune adresse de page. Les couleurs du planning (couleur de la personne, violet « facturé ») et les PDF envoyés aux clients sont inchangés.

## Déjà fait, vérifié avant la mise en ligne

- Build, lint et `audit:quality` au vert ; le contrôle `audit-ui` (tailles de texte, couleurs codées en dur, emojis) ne peut que baisser.
- Aucune migration, aucune variable d'environnement, aucune fonction serveur : uniquement l'application.
- Dernier lot (cuivre retiré des statuts) : 46 emplois du cuivre (39 lignes) passés en ton de statut, en neutre ou en alerte ; tous les boutons, liens, onglets actifs, sélections, chargements et cases cochées restent cuivre.
- **Non vérifiable par un agent** : tout l'affichage. Rien n'est présumé validé.

## Tests

### Partout

- [ ] **R1. Les boutons sont cuivre et se lisent.**
  Où : Clients → « Nouveau client » ; une fiche client → « Modifier » ; Planning → « Nouveau RDV ».
  Saisir : regarder les boutons principaux, passer la souris dessus.
  Attendu : fond cuivre, texte blanc net (aucun bouton bleu ou violet), un cuivre un peu plus foncé au survol. Les boutons secondaires restent blancs ou gris.
  Vérification : rien (affichage seul). À dire : tout bouton encore bleu, ou un texte blanc qui se lit mal.

- [ ] **R2. Plus aucun texte dans l'ancienne police.**
  Où : Accueil, puis une fiche client, puis Réglages.
  Saisir : regarder les titres, les chiffres de la bande de repères, un numéro de client.
  Attendu : titres et gros chiffres dans une police ronde et un peu serrée (Bricolage) ; texte courant en Figtree ; numéros et références en police à chasse fixe. Rien qui ressemble à l'ancienne police (Inter : lettres droites, très régulières). Pas de saut de police au chargement au-delà d'un instant.
  Vérification : rien (affichage seul). À dire : l'écran où une ancienne police subsiste.

- [ ] **R3. Le cuivre ne sert jamais à un statut.**
  Où : menu latéral (en haut, sous le nom) ; une fiche client → onglets « Devis Pennylane » et « Factures » ; Réglages → Organisation → Identité.
  Saisir : regarder l'étiquette du rôle sous votre nom ; le nombre à côté de « Devis Pennylane » et de « Vos Factures » ; le code comptable Pennylane sous le nom du client.
  Attendu : l'étiquette du rôle (Admin, Responsable, Commercial, Technicien) en gris, plus en violet, bleu, ambre ou vert ; les compteurs de devis et de factures en bleu ; le code comptable en gris. Nulle part une pastille, un compteur ou une étiquette cuivre.
  Vérification : rien (affichage seul). À dire : tout statut ou toute pastille encore cuivre.

### Accueil, clients

- [ ] **R4. L'accueil.**
  Où : menu → Dashboard.
  Saisir : regarder la journée, la bande de chiffres et « À traiter ».
  Attendu : mêmes RDV, mêmes chiffres qu'hier ; les personnes d'un RDV gardent leur couleur ; « Voir le planning » et les lignes de « À traiter » en cuivre (ce sont des liens).
  Vérification : les nombres de C5 à C7 de la recette de novembre restent justes.

- [ ] **R5. La liste des clients.**
  Où : menu → Clients.
  Saisir : chercher un client, ouvrir la liste des filtres.
  Attendu : le champ de recherche s'entoure de cuivre quand on écrit dedans ; « Contrat actif » en vert ; filtre actif en cuivre ; rien de cassé dans la mise en page.
  Vérification : rien (affichage seul).

- [ ] **R6. La fiche client.**
  Où : une fiche client avec un contrat, des équipements et des devis.
  Saisir : passer par chaque onglet (Infos, Contrat, Équipements, Interventions, Timeline, Mailings, Devis, Factures).
  Attendu : l'onglet ouvert souligné en cuivre ; le total annuel du contrat en noir, plus en couleur ; statuts de devis et de contrat dans leurs tons (vert, ambre, rouge, bleu) ; les boutons en cuivre.
  Vérification : rien (affichage seul).

### Pipeline

- [ ] **R7. Les cartes du Kanban ont toutes la même hauteur.**
  Où : Pipeline → Kanban, sur ordinateur.
  Saisir : parcourir les six colonnes.
  Attendu : comme en C27 de novembre : toutes les cartes de la même hauteur, sur deux lignes, aucune ligne coupée par la nouvelle police ; les sources lisibles dans les trois premières colonnes, abrégées au besoin dans les trois autres.
  Vérification : rien (affichage seul). La nouvelle police est un peu plus large : c'est ce test qui dit si elle tient.

### Planning

- [ ] **R8. Les vignettes ne perdent pas de ligne.**
  Où : Planning, vue Semaine, une semaine chargée.
  Saisir : regarder un RDV de 30 minutes, un d'une heure, et une journée d'installation entière.
  Attendu : 30 min sur une ligne (heure, type court, nom, zone) ; 1 h sur deux lignes ; la journée en cadre plein, type en toutes lettres, nom sur plusieurs lignes. Aucune dernière ligne coupée à mi-hauteur.
  Vérification : rien (affichage seul).

- [ ] **R9. L'en-tête des jours ne saute pas.**
  Où : Planning, vue Semaine.
  Saisir : passer à la semaine suivante, puis revenir, deux ou trois fois.
  Attendu : la grille ne monte ni ne descend quand les lignes de charge apparaissent ; l'en-tête garde sa hauteur pendant le chargement.
  Vérification : rien (affichage seul).

- [ ] **R10. Les lignes de charge.**
  Où : Planning, vue Semaine, en administrateur.
  Saisir : lire l'en-tête d'un jour ouvré.
  Attendu : une ligne par technicien au travail, avec sa zone et son chiffre ; « Vide · 0 € » pour un technicien sans intervention ; cumul de la période à côté du titre. Mêmes chiffres qu'avant.
  Vérification : rien (affichage seul).

- [ ] **R11. Blocs hachurés et violet « facturé ».**
  Où : Planning, une semaine qui porte une installation posée avant réception du matériel, et un RDV déjà facturé.
  Saisir : regarder ces deux blocs.
  Attendu : l'installation provisoire hachurée en biais, dans la couleur de la personne ; le RDV facturé en violet. Les autres blocs gardent la couleur de leur personne, comme avant : la refonte ne touche aucune couleur de bloc.
  Vérification : rien (affichage seul).

### Chantiers, entretiens

- [ ] **R12. Les chantiers.**
  Où : menu → Chantiers.
  Saisir : regarder une carte en « Commande à faire » ou « À planifier » dont l'équipement ou le matériel est commandé.
  Attendu : la pastille d'approvisionnement « commandé » en **bleu** (plus en cuivre) ; « reçu » en vert ; cartes de la même hauteur ; bandes de date inchangées.
  Vérification : rien (affichage seul).

- [ ] **R13. Les entretiens.**
  Où : menu → Entretiens, Kanban puis Programmation.
  Saisir : ouvrir une carte SAV, regarder les urgences ; ouvrir la Programmation.
  Attendu : urgence « Urgent » en rouge, avec son icône ; boutons « Planifier », « Facturer » en cuivre ; après une modification d'un champ, le bouton « Enregistrer » de la fiche en cuivre avec un bord cuivre (plus de bord bleu), puis fermer sans enregistrer.
  Vérification : rien (affichage seul).

### Réglages

- [ ] **R14. Les réglages.**
  Où : menu → Réglages, puis Organisation, Équipe, Droits d'accès, Fournisseurs & catalogue → Articles.
  Saisir : parcourir les pages ; dans Organisation → Identité, lancer « Retrouver votre entreprise » et choisir l'entreprise sans enregistrer.
  Attendu : les icônes des en-têtes de page en gris (plus en cuivre) ; le chapitre ouvert du menu de gauche en cuivre ; l'encadré de l'annuaire (« informations trouvées ») en bleu pâle ; dans Articles, la catégorie d'un article en gris. Dans Fumisterie ou Climatisation, une valeur refusée s'écrit en rouge.
  Vérification : rien (affichage seul). Quitter Identité sans enregistrer.

### Ce qui part chez le client

- [ ] **R15. La page publique d'un PV.**
  Où : Chantiers → un chantier réceptionné → Après-vente → copier le lien du PV ; ouvrir ce lien dans une fenêtre de navigation privée. La fiche de test « PUDEBAT Eric » convient.
  Saisir : lire la page, **sans signer**.
  Attendu : la page aux couleurs de l'entreprise (réglage d'organisation), comme avant la refonte ; boutons lisibles. La refonte ne doit pas l'avoir changée, sinon par la police.
  Vérification : rien (affichage seul).

- [ ] **R16. Le PDF d'un devis est inchangé.**
  Où : une fiche client → un devis natif déjà envoyé → télécharger le PDF.
  Saisir : le comparer à un PDF du même devis (ou d'un autre) produit avant le 22 novembre.
  Attendu : même mise en page, même couleur, même police. Les PDF ne dépendent pas des couleurs de l'écran.
  Vérification : comparaison des deux fichiers.

### Les trois écrans

- [ ] **R17. À 1440 px.**
  Où : ordinateur, fenêtre pleine largeur (environ 1440 px).
  Saisir : Accueil, Pipeline, Planning, une fiche client.
  Attendu : rien ne déborde ; menu latéral avec la page ouverte en cuivre ; les nouvelles polices ne font passer aucun titre sur deux lignes là où il tenait sur une.
  Vérification : rien (affichage seul).

- [ ] **R18. Sur tablette.**
  Où : la tablette, après « Mettre à jour ».
  Saisir : Planning, Entretiens, une fiche client.
  Attendu : vue bureau (menu à gauche), comme avant ; vignettes du planning lisibles ; boutons cuivre.
  Vérification : rien (affichage seul). Peut rejoindre C23 (Kanbans sur tablette) de la recette de novembre.

- [ ] **R19. Sur téléphone.**
  Où : le téléphone, après « Mettre à jour ».
  Saisir : regarder la barre du bas et la barre du navigateur en haut ; toucher Planning puis Clients.
  Attendu : la barre du navigateur (ou de l'application installée) en **cuivre**, plus en bleu ; dans la barre du bas, le bouton de la page affichée en cuivre ; champs de saisie qui ne zooment pas ; textes lisibles.
  Vérification : rien (affichage seul).

## Bilan

À écrire à la fin de la recette. **La phase 2 (menu, composants de base) ne commence qu'après ce bilan.**
