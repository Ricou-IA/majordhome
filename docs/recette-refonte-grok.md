# Recette de la refonte de l'interface Majord'home — consignes pour Grok

## Ta mission

Tu vérifies, dans un navigateur, la nouvelle interface de Majord'home, logiciel de gestion d'un artisan du chauffage (clients, planning, leads, chantiers, entretiens). La refonte a été livrée en cinq étapes le 23 novembre 2026. Elle ne devait changer **que l'apparence** : aucune donnée, aucun calcul, aucune adresse de page. Personne ne l'a encore regardée à l'écran : ton rapport est la première vérification visuelle.

- **Adresse** : https://majordhome.vercel.app
- **Compte** : Eric t'ouvre une session administrateur de l'entreprise Mayer Énergie. Tu ne saisis jamais de mot de passe toi-même.
- **Version attendue** : commit `90377882` ou plus récent. Si un bandeau « Nouvelle version disponible » apparaît en bas, clique « Mettre à jour ». Sinon, recharge la page sans le cache (Ctrl + Maj + R).
- **Écran** : fenêtre d'ordinateur d'environ 1440 px de large, sauf mention contraire.

## Règles absolues : c'est la base réelle de l'entreprise

Tu travailles sur les vraies données d'une entreprise en activité. **Par défaut, tu regardes et tu n'enregistres rien.**

Ne fais jamais :

- enregistrer, valider, signer, envoyer, supprimer, archiver, fusionner ;
- envoyer un e-mail, un SMS, un lien, un devis, un PV ou une facture ;
- glisser une carte d'une colonne à une autre dans un tableau (Kanban) ;
- cliquer « Facturer », « Planifier », « Conforme », « Intervention faite », « Lancer », « Tester », « Importer » ;
- modifier un réglage, même pour le remettre ensuite.

Tu peux :

- ouvrir des pages, des fiches et des onglets ;
- ouvrir une fenêtre ou un panneau d'édition, taper dedans, puis **fermer sans enregistrer** (Annuler, Échap ou la croix). Si une question « Abandonner les modifications ? » apparaît, réponds « Abandonner » ;
- chercher, filtrer, trier, déplier ou replier une colonne ;
- télécharger le PDF d'un document déjà existant.

Si un test semble demander une écriture, tu t'arrêtes et tu le notes `ÉRIC`. Si tu as un doute, tu t'abstiens et tu le dis. N'inscris dans ton rapport aucune donnée d'un client (nom, téléphone, adresse) : désigne une fiche par son numéro client ou par sa position (« 3ᵉ carte de la colonne Devis envoyé »).

## Ce qui a changé, en bref

- **Couleurs** : la couleur principale est le **cuivre** (`#C2532B`), réservée aux actions : boutons, liens, onglet ouvert, sélection, focus. Les fonds sont en pierre chaude (beige gris). **Le cuivre ne sert jamais à un statut.** Un statut prend l'un de cinq tons : gris (neutre), bleu (information), vert (fait, réussi), ambre (en attente), rouge (alerte).
- **Polices** : titres et gros chiffres en Bricolage Grotesque, texte courant en Figtree, numéros et références en Geist Mono. L'ancienne police Inter ne doit plus apparaître nulle part.
- **Planning** : chaque rendez-vous garde la couleur de la **personne** qui le porte. Le violet est réservé aux rendez-vous « facturés ». C'est voulu, ce n'est pas une anomalie.
- **Menu** : nouveaux noms (Accueil, Leads, Carte, Messages, Publicité, Visibilité locale, Boutique), mais les adresses des pages ne changent pas (`/pipeline`, `/territoire`, `/mailing`…).
- **Listes et dates** : les listes déroulantes du navigateur sont remplacées par des listes stylées, avec un champ de recherche dès 7 choix. Les dates s'affichent « lun. 23 nov. 2026 » et se tapent en jj/mm/aaaa.
- **Ce qui ne doit pas changer** : les chiffres, les données, la hauteur des cartes des tableaux, les PDF.

## Ton rapport

Pour chaque test, une ligne :

| Test | Verdict | Ce que tu as vu | Capture |
|---|---|---|---|
| G1 | OK / KO / À VOIR / ÉRIC / NT | une phrase, factuelle | nom du fichier si KO ou À VOIR |

- **OK** : conforme à « Attendu ».
- **KO** : écart net. Décris ce que tu vois, où, et ce qui était attendu. Joins une capture.
- **À VOIR** : tu doutes, ou c'est conforme mais te semble mal fini (alignement, texte coupé, contraste faible).
- **ÉRIC** : le test demande une écriture, un autre compte ou un autre appareil.
- **NT** : non testable (page vide, module absent…), avec la raison.

Termine par :

1. la liste des KO, du plus gênant au moins gênant ;
2. tes remarques d'ergonomie hors tests, cinq au plus, chacune avec l'écran concerné.

---

## 1. Partout

- **G1. Boutons.** Où : Clients, Planning, une fiche client. Attendu : bouton principal à fond cuivre et texte blanc net, un peu plus foncé au survol ; boutons secondaires blancs ou gris ; **aucun bouton bleu ou violet**, sauf « Facturer » / « Facturé » dans les Entretiens (violet voulu).
- **G2. Polices.** Où : Accueil, une fiche client, Paramètres. Attendu : titres dans une police ronde et un peu serrée, chiffres et numéros dans une police à chasse fixe, rien en Inter.
- **G3. Pas de statut cuivre.** Où : menu latéral (étiquette du rôle sous le nom), fiche client → « Devis et factures ». Attendu : étiquette du rôle en gris ; compteurs et pastilles de statut en gris, bleu, vert, ambre ou rouge ; jamais en cuivre.
- **G4. Plus d'emojis.** Où : Planning, Entretiens, Paramètres, Leads. Attendu : des icônes au trait à la place des emojis (cadenas, flèches, triangle d'alerte). Seule exception : les pastilles de centre dans Paramètres → Organisation → Territoire.
- **G5. Focus clavier.** Où : n'importe quelle page. Fais Tab plusieurs fois. Attendu : l'élément atteint est entouré d'un anneau visible ; on ne perd jamais la trace du focus.

## 2. Menu latéral

- **M1. Page ouverte.** Attendu : l'entrée de la page ouverte est une carte blanche à légère ombre, icône cuivre, texte foncé ; les autres entrées sont grises ; aucun pavé cuivre plein, sauf le carré du logo.
- **M2. Nouveaux noms.** Clique Accueil, Leads, Carte, Messages, Publicité, Visibilité locale, Boutique (ceux qui existent). Attendu : la bonne page s'ouvre, et l'adresse reste l'ancienne (`/`, `/pipeline`, `/territoire`, `/mailing`…). Note les adresses vues.
- **M3. Menu replié.** Bouton en bas du menu. Attendu : une colonne d'icônes, le nom au survol, toutes les entrées accessibles ; après rechargement, le menu reste replié. Remets-le ensuite comme tu l'as trouvé.
- **M4. Créer et recherche.** « Créer » (ouvre puis ferme le menu, sans rien créer), puis Ctrl K : tape « pipeline », puis « territoire ». Attendu : « Créer » est un bouton blanc bordé ; la recherche propose Leads puis Carte. Ferme avec Échap.
- **M5. Avatar.** Bas du menu. Attendu : un rond gris foncé avec des initiales, le rôle dans une étiquette grise.

## 3. Accueil

- **A1. En-tête.** Attendu : « Bonjour, … », puis la date et « N rendez-vous et N leads à contacter » ; à droite « Ouvrir le planning » (blanc) et « Nouveau lead » (cuivre). Clique « Nouveau lead » : une fenêtre de création s'ouvre. Ferme-la sans rien saisir.
- **A2. Ma journée.** Attendu : chaque RDV a l'heure, le type, la ville, les personnes en ronds à initiales dans leur couleur, un bouton d'itinéraire à droite. Un RDV en cours est surligné en cuivre très clair avec « En cours ».
- **A3. Chiffres.** Attendu : des cartes à grand chiffre ; un chiffre inconnu s'écrit « — », jamais 0 ; l'explication du CA programmé derrière un petit (i).
- **A4. À traiter.** Attendu : « À traiter · N actions », puis « Relances prioritaires » (trois devis au plus, montant HT, « Sans relance depuis N j »). Un clic ouvre la fiche du lead : ferme-la.

## 4. Clients

- **C1. En-tête et sélecteur.** Attendu : « Clients », une ligne « N clients · N contrats d'entretien actifs », un sélecteur Tous / Particuliers / Entreprises / Secteur public avec compteurs. Chaque choix filtre la liste et ajoute `?filter=…` à l'adresse.
- **C2. Tableau.** Attendu : colonnes Client (rond à initiales, nom, catégorie, n° client), Ville, Téléphone, Contrat, Créé le ; un clic sur une ligne ouvre la fiche.
- **C3. Tri.** Clique « Client », puis encore ; puis « Créé le ». Attendu : flèche cuivre, sens inversé au 2ᵉ clic ; « Ville » n'est pas triable.
- **C4. Charger plus.** Attendu : en bas « 25 sur N » et « Charger plus » ; après trois clics, aucun client en double.
- **C5. Recherche.** Hors d'un champ, tape « / ». Attendu : le curseur va dans la recherche. Cherche « helene » (sans accent) : des clients nommés « Hélène » apparaissent.
- **C6. Liste vide.** Cherche « zzqxw ». Attendu : une icône dans un cercle, une phrase, « Effacer les filtres » et « Ajouter un client ». Ne clique pas « Ajouter ».

## 5. Fiche client

Ouvre la fiche d'un client sous contrat, avec équipements et devis.

- **F1. En-tête.** Attendu : fil « Clients › Nom », carré à initiales, nom, pastille verte « Contrat actif », catégorie, adresse (lien Waze), « client depuis AAAA » ; à droite Appeler, E-mail, Itinéraire, portail, « … », « Modifier », « Nouveau RDV » (seul bouton cuivre).
- **F2. Menu « … ».** Ouvre-le sans rien choisir. Attendu : Nouveau SAV, Archiver, Supprimer définitivement (en rouge).
- **F3. Résumé.** Attendu : la fiche s'ouvre sur Résumé, en lecture : prochaines interventions, historique récent, coordonnées, carte, logement (bloc DPE), « Proches et sociétés liées » si la fiche en a, notes.
- **F4. Onglets.** Résumé, Contrat, Équipements (compteur), Interventions (compteur), Devis et factures, Échanges. Attendu : l'onglet ouvert souligné en cuivre ; chaque onglet a du contenu ou un message clair.
- **F5. Panneau Modifier.** « Modifier ». Attendu : un panneau à droite ; « Enregistrer » grisé tant que rien n'a changé ; on lit « Accepte les e-mails » et « Note interne » avec un (i) qui l'explique au survol.
- **F6. Abandonner.** Dans le panneau, change une lettre d'un champ, puis Échap. Attendu : « Abandonner les modifications ? » ; « Continuer la saisie » garde le texte ; « Abandonner » ferme le panneau, l'ancienne valeur revient, et **le focus revient sur le bouton « Modifier »** (anneau visible).
- **F7. Échap dans une liste.** Dans le panneau, ouvre une liste déroulante, puis Échap. Attendu : seule la liste se ferme, le panneau reste ouvert. Ferme ensuite le panneau sans enregistrer.

## 6. Listes et dates (étape 5)

Fais-les dans le panneau « Modifier » d'une fiche client, ou dans la fenêtre « Nouveau RDV » du Planning, **sans jamais enregistrer**.

- **S1. Liste longue.** Une liste de 7 choix ou plus (ex. dans « Nouveau RDV » : type ou personne). Attendu : un champ « Rechercher… » en haut ; une recherche sans accent trouve le choix accentué ; l'option choisie porte une coche cuivre.
- **S2. Liste courte.** Une liste de moins de 7 choix. Attendu : pas de champ de recherche.
- **S3. Clavier.** Tab jusqu'à une liste, flèche bas : elle s'ouvre ; les flèches déplacent la sélection ; Entrée choisit ; Échap ferme la liste seule.
- **S4. Au-dessus de tout.** Dans « Nouveau RDV », ouvre une liste. Attendu : elle passe au-dessus de la fenêtre, n'est pas coupée et défile à la molette.
- **S5. Libellé long.** Une liste aux choix longs. Attendu : un choix long passe à la ligne au lieu d'être coupé ; au survol du champ, le texte complet s'affiche.
- **D1. Affichage et saisie.** Un champ de date. Attendu : « lun. 23 nov. 2026 » au repos ; « 23/11/2026 » au clic ; taper `01122026` puis Tab donne « mar. 1 déc. 2026 ».
- **D2. Calendrier.** Icône de calendrier. Attendu : semaine du lundi au dimanche ; le 25 décembre grisé mais cliquable ; raccourcis Aujourd'hui / Demain / Lundi prochain ; le jour choisi en cuivre.
- **D3. Date impossible.** Tape `31/02/2026` puis Tab. Attendu : bordure rouge, « Date invalide (jj/mm/aaaa) », champ vidé.
- **D4. Sans rien changer.** Clique dans une date déjà remplie, puis Tab sans rien taper. Attendu : la date ne change pas, rien n'est marqué modifié.

Ferme ensuite la fenêtre ou le panneau sans enregistrer.

## 7. Planning

- **P1. Barre d'outils.** Vue Semaine. Attendu : une ligne avec Aujourd'hui, flèches, « S48 » (numéro de semaine), période en grand, CA de la période, recherche, Jour / Semaine / Mois (segment actif blanc), « … » (Rafraîchir, Imprimer), « Nouveau RDV » en cuivre.
- **P2. Maintenant.** Attendu : le trait de l'heure actuelle en cuivre ; le numéro du jour dans une pastille cuivre.
- **P3. Hauteur stable.** Passe à la semaine suivante puis reviens, trois fois. Attendu : l'en-tête des jours garde sa hauteur, la grille ne saute pas.
- **P4. Lignes de charge.** En-tête d'un jour ouvré. Attendu : une ligne par technicien (Vide en gris, Ouverte en vert, Pleine en ambre, Figée en bleu, À arbitrer en rouge), jamais en violet.
- **P5. Vignettes.** Un RDV de 30 min, un d'une heure, une journée entière. Attendu : 30 min sur une ligne, 1 h sur deux, la journée en cadre plein ; aucune ligne coupée à mi-hauteur ; les icônes (cadenas, flèches) ne grandissent pas la ligne.
- **P6. Couleurs.** Attendu : chaque bloc à la couleur de sa personne ; un RDV facturé en violet ; une pose provisoire hachurée en biais.
- **P7. Nouveau RDV.** Ouvre « Nouveau RDV », regarde, ferme sans enregistrer. Attendu : grille à gauche, réglages à droite, listes et dates aux nouveaux styles.

## 8. Leads (`/pipeline`)

- **L1. Onglets.** Attendu : Statistiques (ouvert par défaut), Tableau, Suivi des objectifs ; le mot « MT-LT » n'apparaît plus.
- **L2. Cartes.** Onglet Tableau. Attendu : bande de date grise, nom en gras, montant en noir, source en étiquette grise, « Hors zone » en pastille ambre, commercial en rond à sa couleur ; toutes les cartes d'une colonne ont la même hauteur.
- **L3. Gagné et Perdu repliées.** Attendu : deux bandes étroites avec nombre et total ; « Déplier » montre les cartes, « Replier » les range ; le choix tient après rechargement. Remets-les repliées.
- **L4. Recherche.** Cherche un nom d'une carte de la colonne Perdu. Attendu : la bande repliée affiche « N trouvé(s) ».
- **L5. Filtre sans résultat.** Choisis un mois ou une source qui ne garde aucun lead. Attendu : « Aucun lead pour ces filtres. » et pas de bouton « Nouveau lead ». Retire le filtre.

## 9. Chantiers, Entretiens, Devis

- **H1. Chantiers.** Attendu : cartes de même hauteur, bande de date grise, commandes Commandé (bleu), Reçu (vert), N/A (gris) ; repères d'après-vente lisibles, même dans une colonne étroite.
- **E1. Entretiens, repères.** Attendu : sous le titre, une bande Entretiens à faire, SAV gérés, Planifiés, Réalisés.
- **E2. Entretiens, onglets.** Attendu : Suivi, Contrats, Programmation, Dashboard, Clos, soulignés, avec compteurs ; « Nouveau contrat » seul en cuivre.
- **E3. Entretiens, cartes.** Attendu : bande bleue pour un entretien, orange pour un SAV ; « Urgent » en rouge avec icône ; cartes de même hauteur, pastilles à interligne normal (environ 20 px de haut).
- **V1. Devis Pennylane** (`/devis`). Attendu : Orphelins / Tous / Écartés en sélecteur avec compteurs ; « Sans réponse depuis 21 j » ne garde que les devis en attente ou expirés de plus de 21 jours, et un 2ᵉ clic rend tout.
- **V2. PDF.** Télécharge le PDF d'un devis déjà existant (fiche client → Devis et factures). Attendu : un PDF lisible, sans caractère cassé dans les montants.

## 10. Paramètres

- **R1. Page d'accueil des Paramètres.** Attendu : des cartes par module, une ligne par réglage avec son icône grise et une flèche ; un clic ouvre l'écran du réglage.
- **R2. Écrans de réglage.** Organisation, Équipe, Droits d'accès, Fournisseurs & catalogue. Attendu : icônes d'en-tête en gris, chapitre ouvert du menu de gauche en cuivre. **Ne modifie rien.**

## 11. Largeurs d'écran

Si tu peux régler la largeur de la fenêtre :

- **W1. 1024 px** (largeur de la tablette) : Planning, Entretiens, une fiche client. Attendu : menu à gauche, rien ne déborde ; les Kanbans défilent horizontalement, colonnes lisibles.
- **W2. 375 px** (téléphone) : Accueil, Clients, Planning. Attendu : barre en bas (pages du quotidien, « Créer » au centre, « Plus ») ; la liste des clients en cartes ; la barre du Planning sur deux lignes sans déborder.

Une fenêtre étroite sur ordinateur n'est pas un vrai téléphone : listes et dates natives du téléphone, clavier et toucher restent à vérifier par Eric.

---

## Réservé à Eric (ne pas faire)

- Enregistrer une fiche client et vérifier la synchronisation Pennylane.
- Glisser une carte de lead sur Gagné ou Perdu repliée (refus sans devis Pennylane, « Annuler » pendant 8 s).
- Page publique d'un PV (`/pv/…`) et page de RDV client (`/rdv/…`).
- Compte technicien : accueil, planning sans lignes de charge.
- Second compte : menu replié propre à chaque compte.
- Vrai téléphone et tablette Oukitel : listes et dates natives, liste ouverte sans clavier sur la tablette, cibles de 44 px.
- Imprimer le planning hebdomadaire d'une personne.
