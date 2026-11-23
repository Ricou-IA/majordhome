# Recette — refonte de l'interface, phase 3 (Accueil, liste Clients, fiche client)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : `5c075c6d` (2026-11-23)
- **Comptes** : celui d'Eric (Mayer Énergie, administrateur) ; pour A5 et F9, un compte technicien ou commercial s'il est sous la main
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.
- **Avant de commencer** : « Mettre à jour » si le site le propose en bas de l'écran, sinon Ctrl + Maj + R.

## Ce que change la phase 3

- **Accueil** : sous-titre chiffré, boutons « Ouvrir le planning » et « Nouveau lead », personnes en avatars à leur couleur, Itinéraire, RDV en cours surligné, variation du CA signé, « À traiter · N actions », bloc « Relances prioritaires ».
- **Clients** : tableau triable à la place des cartes (les cartes restent sur téléphone), sélecteur Tous / Particuliers / Entreprises / Secteur public à la place des six cartes de chiffres, recherche plus grande et touche « / ».
- **Fiche client** : en-tête de résumé, onglets regroupés (Résumé, Contrat, Équipements, Interventions, Devis et factures, Échanges), **Résumé** en lecture par défaut, **« Modifier »** dans un panneau à droite.
- **Rien d'autre ne bouge** : aucune donnée, aucun calcul, aucune adresse de page ; l'enregistrement d'une fiche envoie les mêmes champs, avec la même synchronisation Pennylane.

## Déjà fait, vérifié avant la mise en ligne

- Chaque tâche sensible relue par un relecteur indépendant ; build, lint, `audit:quality` (2 058 tests) au vert.
- Défauts trouvés et corrigés en relecture : le tri par ville aurait pu montrer deux fois certains clients avec « Charger plus » (la ville n'est plus triable) ; « Tous » n'effaçait pas un ancien filtre d'adresse ; deux copies de la bibliothèque des fenêtres auraient bloqué la page après une confirmation ; Échap dans « Créer un nouveau client » fermait tout le panneau.
- **Non vérifiable par un agent** : tout l'affichage. Rien n'est présumé validé.

## Tests

### Accueil

- [ ] **A1. L'en-tête.** Ce que vous devez voir : « Bonjour, Eric », puis « Lundi 23 novembre · N rendez-vous et N leads à contacter » (vos chiffres) ; à droite « Ouvrir le planning » (blanc) et « Nouveau lead » (cuivre). « Nouveau lead » ouvre la fenêtre de création du lead.
- [ ] **A2. Ma journée.** Chaque RDV montre l'heure, le client, le type, la ville, les personnes avec un rond à leurs initiales dans leur couleur du planning, et un bouton d'itinéraire à droite (ouvre Waze). Pendant un RDV en cours : la ligne est sur fond cuivre très clair, avec « En cours ».
- [ ] **A3. Chiffres clés.** Les mêmes chiffres qu’avant, dans des cartes à grand chiffre (pas de comparaison au mois précédent : le mois en cours n’est jamais complet).
- [ ] **A4. À traiter et relances.** Le titre « À traiter · N actions », sans phrase dessous. En dessous, « Relances prioritaires » : trois devis au plus, avec le nom, le montant HT et « Sans relance depuis N j ». Un clic ouvre la fiche du lead.
- [ ] **A5. Un rôle sans pipeline.** Avec un compte technicien : pas de « Nouveau lead », pas de relances, l'accueil reste lisible.

### Clients

- [ ] **C1. En-tête et sélecteur.** « Clients », puis « 3 612 clients · 490 contrats d'entretien actifs » (vos chiffres). Plus de six cartes : un sélecteur Tous / Particuliers / Entreprises / Secteur public avec les compteurs. Chaque choix filtre la liste ; l'adresse de la page prend `?filter=…` comme avant.
- [ ] **C2. Le tableau.** Colonnes Client (rond à initiales, nom en majuscules et minuscules, catégorie, n° client), Ville, Téléphone, Contrat, Créé le. Un clic sur une ligne ouvre la fiche.
- [ ] **C3. Le tri.** Cliquer « Client » : la flèche cuivre s'affiche, un second clic inverse. Idem « Créé le » (le plus récent d'abord). « Ville » n'est pas triable.
- [ ] **C4. Charger plus.** En bas : « 25 sur 3 612 » et « Charger plus » ; aucun client en double après plusieurs clics.
- [ ] **C5. Recherche et « / ».** Hors d'un champ, appuyer sur « / » : le curseur va dans la recherche. Chercher un nom, un téléphone, une ville : mêmes résultats qu'avant. Ctrl K ouvre toujours la recherche globale.
- [ ] **C6. Filtres conservés.** « Contrats actifs », « Archivés », « Inclure les archivés », le filtre Contrat, Rafraîchir, Importer, Nouveau client, Carte : chacun fait ce qu'il faisait.
- [ ] **C7. Téléphone.** Sur le téléphone, la liste reste en cartes ; le sélecteur et la recherche sont utilisables au pouce.

### Fiche client

- [ ] **F1. L'en-tête.** Fil « Clients › Nom », carré à initiales, nom, pastille « Contrat actif » si le client en a un, catégorie, adresse cliquable (Waze), « client depuis 2019 ». À droite : Appeler et E-mail (si le client a un téléphone, un e-mail), Itinéraire, portail client, « … », « Modifier », « Nouveau RDV » (cuivre).
- [ ] **F2. Le menu « … ».** Nouveau SAV, Archiver, et pour l'administrateur Supprimer définitivement : mêmes fenêtres de confirmation qu'avant.
- [ ] **F3. Le Résumé.** La fiche s'ouvre sur Résumé : prochaines interventions, historique récent, coordonnées, carte de l'adresse, logement avec le bloc MonsieurDPE, proches et sociétés liées (si la fiche en a), notes et note interne avec son (i).
- [ ] **F4. Les onglets regroupés.** Contrat, Équipements (avec son compteur), Interventions (compteur), « Devis et factures » (devis puis factures Pennylane), « Échanges » (historique, e-mails, SMS). Rien de ce qu'il y avait dans les anciens onglets ne manque.
- [ ] **F5. Lien vers un onglet.** Signer un contrat (ou revenir de la page de signature) : la fiche s'ouvre sur l'onglet Contrat.
- [ ] **F6. Modifier et enregistrer.** « Modifier » ouvre le panneau à droite avec le formulaire habituel. « Enregistrer » est grisé tant que rien n'a changé. Changer un téléphone, Enregistrer : le panneau se ferme, le Résumé montre le nouveau numéro, la fiche Pennylane suit comme avant.
- [ ] **F7. Annuler.** Changer un champ puis Annuler (ou Échap, ou clic à côté) : « Abandonner les modifications ? ». « Continuer la saisie » garde le texte ; « Abandonner » ferme et remet l'ancienne valeur. Sans changement : le panneau se ferme tout de suite.
- [ ] **F8. Créer un client depuis le panneau.** Dans le panneau, « Proches et sociétés liées » → créer un nouveau client, remplir à moitié, appuyer sur Échap : le panneau reste ouvert, la fenêtre de création aussi.
- [ ] **F9. DPE « Appliquer ».** Sur une fiche avec un DPE proposé : « Appliquer » ouvre le panneau avec les champs pré-remplis, rien n'est enregistré tant que vous n'enregistrez pas.
- [ ] **F10. Téléphone et tablette.** Sur téléphone, le panneau prend tout l'écran, les boutons du bas restent visibles et accessibles. Sur tablette, le panneau occupe la droite de l'écran.
