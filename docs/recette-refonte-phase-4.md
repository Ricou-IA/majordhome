# Recette — refonte de l'interface, phase 4 (Leads, Planning, Chantiers, Entretiens, Devis)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : `77edd619` (2026-11-23)
- **Comptes** : celui d'Eric (Mayer Énergie, administrateur) ; pour P6, un compte technicien
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.
- **Avant de commencer** : « Mettre à jour » si le site le propose en bas de l'écran, sinon Ctrl + Maj + R.

## Ce que change la phase 4

- **Planning** : barre d'outils (Aujourd'hui, semaine en étiquette, période en grand, « … » pour Rafraîchir et Imprimer, Nouveau RDV en cuivre), trait « maintenant » cuivre, pastille cuivre sur le jour même, lignes de charge aux cinq tons. Couleur des personnes, tailles et hachures inchangées.
- **Leads** : carte (bande de date neutre, source en étiquette grise, « Hors zone » en pastille ambre, commercial en rond à sa couleur), colonnes sur fond pierre, onglets Statistiques / Tableau / Suivi des objectifs, colonnes **Gagné** et **Perdu repliées** en bande étroite.
- **Chantiers**, **Entretiens et SAV** : repères et pastilles aux tons de statut ; les quatre cartes de chiffres des Entretiens deviennent une bande de repères.
- **Devis Pennylane** : vues en sélecteur avec compteurs, filtre « Sans réponse depuis 21 j ».
- **Rien d'autre ne bouge** : aucune règle de placement, aucun glisser-déposer, aucune donnée.

## Déjà fait, vérifié avant la mise en ligne

- Chaque tâche relue par un relecteur indépendant ; build, lint, `audit:quality` (2 080 tests) au vert.
- Vérifié par lecture du code : une colonne repliée reste une vraie zone de dépôt sur toute la hauteur du tableau ; la hauteur des en-têtes de jour du planning n'a pas bougé ; aucune carte de Kanban ne gagne de ligne.
- **Non vérifiable par un agent** : tout l'affichage. Rien n'est présumé validé.

## Tests

### Planning

- [ ] **P1. La barre d'outils.** Une seule ligne sur grand écran (semaine) : « Aujourd'hui », flèches, « S48 », la période en grand, le CA de la période, la recherche, Jour / Semaine / Mois, « … », « Nouveau RDV » en cuivre. Le « … » contient Rafraîchir et Imprimer (Imprimer grisé avec la raison quand il ne peut pas servir, absent sur téléphone).
- [ ] **P2. Maintenant et aujourd'hui.** Le trait de l'heure actuelle est cuivre ; le numéro du jour même est dans une pastille cuivre, pour tous les comptes ; l'en-tête ne change pas de hauteur d'une semaine à l'autre.
- [ ] **P3. Lignes de charge.** Vide en gris, Ouverte en vert, Pleine en ambre, **Figée en bleu** (le violet reste à « facturé »), À arbitrer en rouge ; un clic ouvre toujours « Remplir / figer la journée ».
- [ ] **P4. Les blocs.** Chaque RDV garde la couleur de sa personne, le violet pour « facturé », les hachures pour une pose provisoire et pour un congé ; les vignettes de 30 min, 1 h et journée ne sont pas coupées.
- [ ] **P5. Imprimer.** Vue Semaine filtrée sur une personne → « … » → Imprimer : le PDF sort comme avant.
- [ ] **P6. Technicien.** Avec un compte technicien : pas de lignes de charge, la pastille du jour est là, « RDV » en cuivre sur téléphone.

### Leads

- [ ] **L1. La carte.** Bande de date grise (le jour en grand, le mois dessous), nom en gras, montant en noir, source en étiquette grise, « Hors zone » en pastille ambre, rond à initiales du commercial à sa couleur. Les cartes d'une colonne ont toutes la même hauteur.
- [ ] **L2. Les onglets.** Statistiques (ouvert par défaut), Tableau, Suivi des objectifs. Le mot « MT-LT » n'apparaît plus.
- [ ] **L3. Gagné et Perdu repliées.** Deux bandes étroites avec le nombre de cartes et le total ; « Déplier » montre les cartes, « Replier » les range ; le choix reste après rechargement, propre à votre compte.
- [ ] **L4. Glisser sur une bande repliée.** Glisser une carte « Devis envoyé » sans devis Pennylane sur Gagné repliée : même refus qu'avant. Glisser une carte sur Perdu repliée : passage direct avec « Annuler » pendant 8 s.
- [ ] **L5. Recherche.** Chercher un nom présent dans Perdu : la bande repliée affiche « N trouvé(s) ».

### Chantiers

- [ ] **H1. La carte.** Hauteur fixe inchangée ; bande de date grise ; commandes Commandé (bleu), Reçu (vert), N/A (gris) ; après-vente PV, Avis, Contrat, Facturé lisibles sans être coupés, même sur une colonne étroite ; « sans devis validé » en ambre.

### Entretiens et SAV

- [ ] **E1. Repères.** Sous le titre, une bande avec Entretiens à faire (et son CA, les refus), SAV gérés, Planifiés, Réalisés : mêmes chiffres qu'avant.
- [ ] **E2. Onglets et boutons.** Onglets soulignés (Suivi, Contrats, Programmation, Dashboard, Clos) avec leurs compteurs ; « Nouveau contrat » seul en cuivre ; « Nouveau SAV » et « Lancer l'appel » en blanc.
- [ ] **E3. La carte.** Bande bleue pour un entretien, orange pour un SAV ; pastilles de statut aux tons de la DA ; « Urgent » en rouge ; boutons Facturer / Facturé toujours violets ; les cartes gardent leur hauteur.

### Devis Pennylane

- [ ] **D1. Vues.** Orphelins / Tous / Écartés en sélecteur avec leurs compteurs.
- [ ] **D2. Sans réponse.** « Sans réponse depuis 21 j » ne garde que les devis en attente ou expirés de plus de 21 jours ; un second clic rend tout.

### Téléphone et tablette

- [ ] **T1.** Sur téléphone et tablette, les Kanbans défilent comme avant ; les bandes repliées restent étroites ; la barre du planning passe sur deux lignes sans déborder.
