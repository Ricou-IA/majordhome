# Recette des livraisons des 23 et 24 novembre 2026 — consignes pour Grok

## Ta mission

Tu vérifies, dans un navigateur, ce qui a été livré dans Majord'home (logiciel de gestion d'un artisan du chauffage) les 23 et 24 novembre 2026 : brief UX (actions destructives, fenêtres, devis, réglages, état des écrans dans l'adresse), rendez-vous confirmés au client, tableau Entretien & SAV, page Devis. Personne ne l'a encore regardé à l'écran : ton rapport est la première vérification visuelle.

- **Adresse** : https://majordhome.vercel.app
- **Compte** : Eric t'ouvre une session administrateur de l'entreprise Mayer Énergie. Tu ne saisis jamais de mot de passe toi-même.
- **Version attendue** : commit `37582b7b` ou plus récent (déploiement de production prêt, vérifié le 2026-11-24). Si un bandeau « Nouvelle version disponible » apparaît, clique « Mettre à jour ». Sinon, recharge sans le cache (Ctrl + Maj + R) avant de commencer.
- **Écran** : fenêtre d'ordinateur d'environ 1440 px de large, sauf mention contraire.

## Règles absolues : c'est la base réelle de l'entreprise

Tu travailles sur les vraies données d'une entreprise en activité. **Par défaut, tu regardes et tu n'enregistres rien.**

Ne fais jamais :

- enregistrer, valider, signer, envoyer, supprimer, archiver, fusionner, dupliquer ;
- envoyer un e-mail, un SMS, un lien, un devis, un PV ou une facture ;
- glisser une carte d'une colonne à une autre, ou un rendez-vous dans le planning ;
- cliquer une entrée du menu « … » qui annule, supprime, archive ou fusionne (tu peux OUVRIR le menu pour lire ce qu'il contient) ;
- cocher « Confirmé au client », cliquer « Envoyer un rappel (SMS) », « Facturer », « Planifier », « Créer la proposition », « Lancer », « Tester », « Importer » ;
- cliquer « Afficher » à côté d'un IBAN ou d'un identifiant masqué ;
- modifier un réglage, même pour le remettre ensuite.

Tu peux :

- ouvrir des pages, des fiches, des onglets, des menus « … » ;
- ouvrir une fenêtre ou un panneau d'édition, taper dedans, puis **fermer sans enregistrer** (Annuler, Échap ou la croix). Si « Abandonner les modifications ? » ou « Abandonner le devis ? » apparaît, réponds « Abandonner » ;
- cliquer « Créer le devis » **quand l'objet est vide** (la création est alors refusée, c'est le test) ;
- dans une page de réglages, cliquer « Rétablir les valeurs par défaut » puis « Annuler les modifications » (seul le formulaire change, rien n'est écrit tant qu'on n'enregistre pas) ;
- chercher, filtrer, trier, déplier ou replier une colonne, changer de vue ou de date.

Si un test semble demander une écriture, tu t'arrêtes et tu le notes `ÉRIC`. Si tu as un doute, tu t'abstiens et tu le dis. N'inscris dans ton rapport aucune donnée d'un client (nom, téléphone, adresse) : désigne une fiche par son numéro client ou par sa position (« 3ᵉ carte de la colonne À planifier »).

## Ce qui a changé, en bref

- **Actions dangereuses** : supprimer, annuler, archiver, fusionner passent dans un menu « … », jamais à côté d'« Enregistrer ». Une suppression définitive demande de retaper le nom.
- **Fenêtres** : Échap et clic sur le fond ferment la fenêtre du dessus seulement. Une fenêtre ouverte depuis un devis (catalogue, import d'offre, aperçu) porte « Retour au devis ».
- **Devis** : nouvelle page « Devis » au menu, aperçu à droite pendant la saisie, prix d'achat et marges masqués par défaut, actions de ligne dans un menu « … ».
- **Réglages** : barre d'enregistrement collée en bas, recherche de réglages, valeurs sensibles masquées, nouveaux libellés (Entreprise, Pennylane, Boutique).
- **L'adresse retient l'écran** : onglet de la fiche client, onglet des Entretiens, vue et date du Planning, recherche des Clients. Un F5 doit rendre le même écran.
- **Planning** : seuls les jours d'ouverture de l'entreprise s'affichent (lundi au vendredi pour Mayer), grille de 8 h à 18 h, repères « confirmé », « à confirmer », « figé » sur les vignettes.
- **Entretien & SAV** : cartes à hauteur fixe, plus de colonnes « Demande de contrat » ni « Pièces commandées », colonne « Encaissé » repliée.
- **Chargements** : blocs gris à la place de « Chargement… » ou « … ».

## Ton rapport

Pour chaque test, une ligne :

| Test | Verdict | Ce que tu as vu | Capture |
|---|---|---|---|
| H1 | OK / KO / À VOIR / ÉRIC / NT | une phrase, factuelle | nom du fichier si KO ou À VOIR |

- **OK** : conforme à « Attendu ».
- **KO** : écart net. Décris ce que tu vois, où, et ce qui était attendu. Joins une capture.
- **À VOIR** : tu doutes, ou c'est conforme mais te semble mal fini (alignement, texte coupé, contraste faible).
- **ÉRIC** : le test demande une écriture, un autre compte ou un autre appareil.
- **NT** : non testable (page vide, aucune donnée concernée…), avec la raison.

Termine par :

1. la liste des KO, du plus gênant au moins gênant ;
2. tes remarques d'ergonomie hors tests, cinq au plus, chacune avec l'écran concerné.

---

## 1. Partout

- **H1. Chargement en blocs gris.**
  Où : recharge une page lourde (Entretiens, Planning, Devis) sans le cache.
  Attendu : pendant le chargement, la structure de la page se dessine en blocs gris. Jamais d'écran blanc, ni de « Chargement… » seul, ni de « … » à la place d'un chiffre. Une valeur qui reste inconnue s'affiche « — », jamais 0.

- **H2. Titres de page sur téléphone.**
  Où : n'importe quelle page du menu, fenêtre réduite à 390 px de large.
  Attendu : le titre de la page est plus petit qu'en grand écran et tient sur une ligne. La barre du bas montre trois raccourcis, « Créer » au centre et « Plus ».

## 2. Accueil

- **H3. « Aujourd'hui » en deux blocs.**
  Où : Accueil.
  Attendu : deux blocs côte à côte, « Interventions » (installation, entretien, SAV) et « Commercial », chacun avec son nombre. Un bloc vide dit en une phrase qu'il n'y a rien. S'il existe des RDV d'un autre type, ils sont dans un bloc « Autres RDV » dessous. Sous 768 px de large, les deux blocs s'empilent.

## 3. Planning

- **H4. Jours d'ouverture et heures.**
  Où : Planning, vue Semaine.
  Attendu : cinq colonnes, du lundi au vendredi, sans samedi ni dimanche. La grille va de 8 h à 18 h (plus large seulement si un RDV déborde), avec des libellés d'heure ronde (8 h 00, 9 h 00…). Le numéro de semaine s'écrit « Semaine 48 », pas « S48 ».

- **H5. Vue et date gardées après F5.**
  Où : Planning.
  Saisir : passe en vue Mois, avance de deux mois, puis appuie sur F5.
  Attendu : l'adresse contient `?vue=mois&date=…` et le planning revient sur le même mois, en vue Mois. Même essai en vue Jour.

- **H6. Repères de confirmation sur les vignettes.**
  Où : Planning, vue Semaine, plusieurs semaines à venir.
  Attendu : selon le RDV, une petite icône : coche (confirmé au client), téléphone (RDV à plus de 30 jours, pas encore confirmé), cadenas (heure figée sans confirmation). Note sur combien de vignettes tu les vois. NT s'il n'y en a aucun.

- **H7. Vignettes resserrées.**
  Où : Planning, vue Semaine, un jour où plusieurs personnes ont des RDV en même temps (colonnes étroites).
  Attendu : une vignette étroite montre l'heure de début et le nom de famille seulement ; le reste s'affiche au survol. Aucune vignette avec un texte coupé au milieu d'un mot sans moyen de le lire.

- **H8. Fenêtre d'un RDV : actions et confirmation.**
  Où : Planning, clic sur un RDV d'entretien ou de SAV à venir.
  Attendu : en bas, à gauche, un menu « … » qui contient « Annuler le RDV » et « Supprimer le RDV » (ouvre-le, ne clique rien dedans). À droite, seulement « Fermer » et l'action principale. Une section « Confirmé au client » et un bouton « Envoyer un rappel (SMS) » sont visibles. **Ne coche rien, n'envoie rien.** Ferme avec « Fermer ».

## 4. Fiche client et Clients

- **H9. Onglet gardé dans l'adresse.**
  Où : Clients → une fiche client → onglet « Interventions ».
  Saisir : F5.
  Attendu : l'adresse contient `?onglet=…` et la fiche rouvre sur Interventions. Essaie aussi « Devis et factures ».

- **H10. Devis et factures de la fiche.**
  Où : une fiche client qui a un devis fait dans Majord'home → onglet « Devis et factures ».
  Attendu : pendant le chargement, des lignes grises. Les devis Majord'home apparaissent et s'ouvrent au clic. Pour un client qui n'a pas de fiche Pennylane, la phrase est « Pas encore de fiche dans Pennylane ». Note le temps d'affichage approximatif (avant, 7 à 13 s).

- **H11. Menu « … » de la fiche client.**
  Où : en-tête d'une fiche client, menu « … ».
  Attendu : « Archiver » et « Supprimer définitivement » sont séparés par une ligne, la suppression en rouge. **Ne clique pas dessus.**

- **H12. Position estimée → « Corriger l'adresse ».**
  Où : une fiche client dont la carte affiche « position estimée » (cherche-en une, NT si aucune).
  Attendu : un lien « Corriger l'adresse » à côté de la mention. Au clic, le champ adresse ou le panneau Modifier s'ouvre. Ferme sans enregistrer.

- **H13. Recherche Clients dans l'adresse.**
  Où : Clients, tape trois lettres d'un nom, choisis une pastille (par exemple « Sous contrat »), puis F5.
  Attendu : l'adresse contient `?q=…`, la recherche et la pastille sont gardées et se cumulent. Pendant une recherche, les compteurs des pastilles sont masqués.

## 5. Leads (`/pipeline`)

- **H14. Carte de demande.**
  Où : Leads → onglet Pipeline.
  Attendu : une carte sans devis n'affiche pas « 0 € ». Le menu « … » d'une carte contient « Passer en suivi long terme » (ne clique pas).

- **H15. Fiche demande : en-tête et menu.**
  Où : ouvre une carte.
  Attendu : un bouton « Devis » dans l'en-tête. « Fusionner » et « Supprimer » sont dans le menu « … », plus à côté d'Enregistrer. Ferme sans rien faire.

## 6. Devis

- **H16. Page Devis.**
  Où : menu « Devis » (`/devis`).
  Attendu : la liste des devis faits dans Majord'home, avec recherche et pastilles de statut qui se cumulent, et des compteurs qui suivent la recherche. Un onglet « Orphelins Pennylane » existe (administrateur). Un clic sur un devis l'ouvre (aperçu, statut, PDF). Après F5, la recherche et le statut choisis sont gardés (`?statut=&q=`).

- **H17. Créer un devis sans objet.**
  Où : Créer → Nouveau devis (ou `/devis?nouveau=1`). Choisis un client ou un lead si on te le demande.
  Saisir : ne remplis pas l'objet, clique « Créer le devis ».
  Attendu : le bouton est actif. Une fenêtre dit seulement « Ajoutez un objet au devis », avec un seul bouton « OK ». Après « OK », le curseur est dans le champ Objet et la même phrase s'affiche sous le champ. **Rien n'est créé.**

- **H18. Aperçu pendant la saisie.**
  Où : même fenêtre de devis.
  Attendu : à 1440 px, un aperçu du devis à droite qui suit la saisie (tape un objet, ajoute une ligne libre avec un montant : l'aperçu change). Fenêtre réduite sous 1 280 px : l'aperçu disparaît et un bouton « Aperçu » l'ouvre par-dessus, avec « Retour au devis ».

- **H19. Lignes et chapitres.**
  Où : même fenêtre.
  Attendu : chaque ligne a un menu « … » (Ajouter une description, Modifier l'article, Supprimer la ligne…) et une poignée « Déplacer la ligne ». Les titres de chapitre s'écrivent en casse normale (« Équipement », « Main d'œuvre »), pas en capitales, et passent à la ligne au lieu d'être coupés. Le bouton « Devis type » n'apparaît que s'il existe un modèle (sinon, pour l'administrateur, « Créer un modèle de devis »).

- **H20. Catalogue : marges masquées, recherche rapide.**
  Où : même fenêtre, « + » d'un chapitre Équipement → catalogue.
  Attendu : la fenêtre du catalogue porte « Retour au devis ». Lignes grises au premier chargement, puis « Afficher les suivants (N restants) » en bas de liste. Pas de prix d'achat ni de marge affichés par défaut ; un choix « Afficher les marges » existe. Tape un mot (« granulés ») : les résultats arrivent en moins d'une seconde.

- **H21. Échap et calques.**
  Où : catalogue ouvert par-dessus le devis.
  Saisir : Échap une fois, puis une deuxième fois.
  Attendu : le premier Échap ferme le catalogue seul, le devis reste ouvert. Le second demande « Abandonner le devis ? » (puisque tu as saisi quelque chose). Réponds « Abandonner ». Un clic sur le fond sombre a le même effet que Échap.

## 7. Entretien & SAV

- **H22. Colonnes du tableau.**
  Où : Entretiens → onglet du tableau (Kanban).
  Attendu : plus de colonne « Demande de contrat » ni « Pièces commandées ». Une colonne « Encaissé » est repliée à droite et se déplie au clic. Toutes les cartes ont la même hauteur, sans étiquette « Contrat » ni numéro de contrat. Les étiquettes des cartes sont lisibles (au moins 12 px). Une carte SAV en attente de pièces est dans « À planifier » avec une bande de date hachurée (NT s'il n'y en a pas).

- **H23. Mêmes chiffres en-tête et Programmation.**
  Où : Entretiens, en-tête, puis onglet Programmation.
  Attendu : l'en-tête montre « À planifier » et « Planifiés », et un sous-titre « N entretiens à faire ». Le résumé de la Programmation dit « X faits | N à faire (dont P planifiés, A à planifier) | R refusés ». Vérifie : N de l'en-tête = N de la Programmation, et N = P + A. Écris les cinq nombres dans ton rapport.

- **H24. Filtre et mois de la Programmation.**
  Où : onglet Programmation.
  Attendu : elle s'ouvre sur novembre 2026. Un filtre « Tous · Reste à faire · À planifier · Faits » avec un nombre sur chaque bouton. Les lignes faites sont plus claires, pas grisées comme désactivées.

- **H25. Onglet « Clos » et adresse.**
  Où : Entretiens, onglet « Clos », puis F5.
  Attendu : « Clos » est un onglet normal (un seul onglet en surbrillance, pas de bandeau en plus). L'adresse contient `?onglet=…` et F5 rouvre le même onglet.

- **H26. Liste des contrats.**
  Où : Contrats, vue Liste (`?vue=liste`).
  Attendu : l'en-tête dit « N contrats à traiter ». La liste se trie par client, commune, mois d'entretien et statut, par paquets de 50.

- **H27. Alertes « Corriger » du tableau de bord.**
  Où : Entretiens → tableau de bord.
  Attendu : si elles existent, « N sans équipement · Corriger » déplie la liste des contrats concernés, et « N équip. sans type · Corriger » mène au parc filtré « Sans type ». Les compteurs SAV (Demandes, Devis envoyés, Pièces commandées) ne sont plus tous à 0.

## 8. Chantiers

- **H28. Libellés du chantier.**
  Où : Chantiers.
  Attendu : la colonne s'appelle « À commander » (plus « Commande à faire »). Dans une fiche chantier, les boutons disent « Passer à « … » » / « Revenir à « … » », et « Supprimer ce chantier » est dans le menu « … » (ne clique pas).

## 9. Paramètres

- **H29. Page Paramètres : libellés et recherche.**
  Où : Paramètres.
  Attendu : les tuiles s'appellent « Entreprise » (plus Organisation), « Pennylane » (plus Facturation), « Boutique » (plus Webshop). Un champ « Rechercher un réglage » filtre les tuiles ; essaie « tournees » sans accent, puis « iban ».

- **H30. Barre d'enregistrement en bas.**
  Où : Paramètres → Climatisation, puis Fumisterie, Tournées, Solaire, Thermique.
  Attendu : une barre collée en bas de la page, « Enregistrer » inactif tant que rien ne change, aucun bouton Enregistrer en haut. Change une valeur : la barre dit « Modifications non enregistrées ». Clique « Annuler les modifications » : la valeur revient. Clique « Rétablir les valeurs par défaut » : une confirmation, puis le formulaire change ; clique alors « Annuler les modifications ». **N'enregistre jamais.** Les unités sont écrites dans les libellés (W, degrés, €, min, %), sans symbole Σ ni θ seuls.

- **H31. Valeurs sensibles masquées.**
  Où : Paramètres → Pennylane (mentions et coordonnées bancaires), et Paramètres → Agent téléphonique.
  Attendu : l'IBAN s'affiche masqué (« FR76 •••• •••• 0189 » ou équivalent) avec un bouton « Afficher » ; l'identifiant de l'agent téléphonique de même. **Ne clique pas sur « Afficher ».**

- **H32. Entreprise → Coordonnées : jours d'ouverture.**
  Où : Paramètres → Entreprise → Coordonnées.
  Attendu : un réglage « Jours d'ouverture » avec les sept jours, lundi au vendredi cochés. Dans l'onglet Identité, une ligne « Études solaires HésiaSun · Connecté » ou « Non connecté ». Ne change rien.

- **H33. Fournisseurs, plan comptable, équipements.**
  Où : Paramètres → Fournisseurs & catalogue ; puis Plan comptable ; puis Mon activité / Équipements.
  Attendu : Fournisseurs a une recherche par nom et plus de « Aucun contact » répété ; chaque fournisseur a « Voir les articles ». Le plan comptable charge en lignes grises puis montre au moins 706, 707 et 708. La liste des équipements n'affiche plus de colonne de codes techniques (du type `poele_granules`).

- **H34. Équipe : libellés des tournées.**
  Où : Paramètres → Équipe → fiche d'un technicien (ouvre, ne modifie pas).
  Attendu : un fil d'Ariane en haut. Le choix s'écrit « Inclus dans les tournées automatiques » / « Hors tournées (planifié à la main, sous-traitant) ».

## 10. Mailing

- **H35. Stats et segments.**
  Où : Mailing → Stats, puis Segments.
  Attendu : Stats a un choix de période (30 jours, 90 jours, 12 mois, tout), des colonnes triables, des chiffres cliquables soulignés, plus de phrase « Astuce ». Segments : œil « Consulter » sur un segment prédéfini, crayon « Modifier » sur les autres. Dans Campagnes, Dupliquer, Archiver et Supprimer sont dans un menu « … » (ne clique rien), plus de corbeille rouge à côté d'Éditer.

---

## Réservé à Eric (ne pas faire)

- **E1. Confirmer un RDV au client** : cocher « Confirmé au client » sur un RDV adaptable → il se fige (cadenas puis coche) ; déplacer ensuite ce RDV demande un accord ; changer sa date retire la confirmation. Vérification : `select client_confirmed_at, client_confirmed_by, hour_confirmed_at from majordhome.appointments where id = '<id>'`.
- **E2. Rappel SMS d'un RDV** depuis la fenêtre du RDV → `client_notified_at` posé, une ligne `sms_logs` campagne `rappel_rdv`.
- **E3. Suppression définitive avec le nom retapé** (client ou demande de test) : le bouton reste fermé tant que le nom n'est pas exact.
- **E4. Créer un vrai devis** avec objet et ligne chiffrée, le rouvrir depuis `/devis`, télécharger le PDF : l'aperçu de la saisie et le PDF sont identiques.
- **E5. Enregistrer les jours d'ouverture** (par exemple ajouter le samedi) → le Planning montre six colonnes ; remettre lundi au vendredi.
- **E6. Encaissé → Réalisé** : glisser une carte de la colonne « Encaissé » vers « Réalisé », puis « Annuler » au toast.
- **E7. Fournisseur** : n° de compte client, identifiant du compte en ligne (« Afficher » pour l'administrateur seul) ; « Importer un devis ou une facture » sur une facture fournisseur. ⚠ L'edge `supplier-offer-import` n'a pas été redéployée avec la lecture du type de document : à faire avant ce test.
