# Recette — refonte de l'interface, phase 5 (finitions)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : à renseigner à la mise en ligne
- **Comptes** : celui d'Eric (Mayer Énergie, administrateur) ; pour T1, un téléphone
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.
- **Avant de commencer** : « Mettre à jour » si le site le propose en bas de l'écran, sinon Ctrl + Maj + R.

## Ce que change la phase 5

- **Listes déroulantes** : plus de liste grise du navigateur sur ordinateur et tablette. Une liste stylée, avec un champ « Rechercher… » dès 7 choix (sans accent ni majuscule), au clavier (flèches, Entrée, Échap). La valeur enregistrée est la même qu'avant.
- **Dates** : affichées « lun. 23 nov. 2026 », saisies au clavier en jj/mm/aaaa (ou 23112026), calendrier qui commence le lundi, jours fériés grisés mais choisissables, raccourcis Aujourd'hui / Demain / Lundi prochain. Une date impossible passe le champ en rouge et le vide.
- **Téléphone** : listes et dates restent celles du téléphone (au pouce).
- **Emojis** : remplacés par des icônes, planning compris ; les pastilles de centre que vous choisissez (Territoire) restent.
- **Textes** : « Accepte les e-mails », « Note interne » expliquée, « Proches et sociétés liées », « Itinéraire », message DPE plus clair.
- **États vides** : un tableau de leads, de chantiers ou de devis vide le dit, avec l'action utile.
- **Réglages** : page des Paramètres en cartes par module ; cibles tactiles d'au moins 44 px sur tablette et téléphone.
- **Rien d'autre ne bouge** : aucune règle, aucune donnée, aucune adresse de page.

## Déjà fait, vérifié avant la mise en ligne

- Chaque tâche sensible relue par un relecteur indépendant ; build, lint, `audit:quality` au vert.
- Tests des règles pures : lecture des dates saisies (siècle d'une année à deux chiffres, chiffres seuls, dates impossibles), jours fériés, raccourcis, filtre de liste sans accent.
- **Restées natives, volontairement** : 7 listes à groupes, les listes des lignes de devis et de facture (géométrie de la ligne), le sélecteur de date caché de la grille de RDV.
- **Non vérifiable par un agent** : tout l'affichage. Rien n'est présumé validé.

## Tests

### Listes

- [ ] **L1. Recherche dès 7 choix.** Fiche client → Modifier → une liste longue (ex. type de logement, ou Équipement → Type) : un champ « Rechercher… » en haut ; taper « elec » trouve « Électricité ». Une liste de moins de 7 choix n'a pas de champ de recherche.
- [ ] **L2. Clavier.** Tab jusqu'à une liste, flèche bas l'ouvre, flèches pour choisir, Entrée enregistre, Échap ferme la liste **sans fermer la fenêtre ou le panneau**.
- [ ] **L3. Valeur identique.** Changer une valeur par la nouvelle liste, enregistrer, rouvrir : la valeur est la bonne. Rechoisir la valeur déjà choisie ne marque pas le formulaire comme modifié.
- [ ] **L4. Dans une fenêtre.** Depuis la fenêtre de RDV et depuis le panneau « Modifier » de la fiche client, la liste s'ouvre au-dessus de tout et défile à la molette.

### Dates

- [ ] **D1. Affichage et saisie.** Un champ de date affiche « lun. 23 nov. 2026 » ; au clic il passe en 23/11/2026 ; taper 01122026 puis Entrée donne « mar. 1 déc. 2026 ».
- [ ] **D2. Calendrier.** L'icône ouvre le calendrier : semaine du lundi au dimanche, 25 décembre grisé mais choisissable, raccourcis Aujourd'hui / Demain / Lundi prochain.
- [ ] **D3. Erreur.** Taper 31/02/2026 puis quitter le champ : bordure rouge, « Date invalide (jj/mm/aaaa) », le champ est vide ; un formulaire qui exige une date le refuse.
- [ ] **D5. PV : réponse aux réserves.** Dans la réponse aux réserves d'un PV, Entrée dans le champ de date ne soumet plus le formulaire : cliquer le bouton d'enregistrement.
- [ ] **D4. Rien de changé, rien d'écrit.** Entrer dans un champ de date déjà rempli puis en sortir sans rien taper : la date ne bouge pas, rien n'est marqué modifié.

### Téléphone

- [ ] **T2. Tablette (Oukitel).** Une liste de 7 choix ou plus s'ouvre sans sortir le clavier ; toucher « Rechercher… » le fait apparaître.
- [ ] **T1. Listes et dates du téléphone.** Sur le téléphone, une liste ouvre le sélecteur du système ; une date, le calendrier du système. Les boutons et onglets sont faciles à toucher.

### Icônes, textes, états vides

- [ ] **I5. Tableau vide ou en échec.** Pipeline des leads avec un filtre qui ne garde rien : « Aucun lead pour ces filtres. » (pas « Nouveau lead »).

- [ ] **I1. Planning.** Les vignettes de RDV montrent des icônes (cadenas d'un RDV figé, flèches de souplesse) à la place des emojis ; aucune vignette n'est plus haute ni coupée.
- [ ] **I2. Ailleurs.** Tournées, pipeline des contrats, Solaire, GeoGrid : plus d'emoji d'interface. Organisation → Territoire : les pastilles de centre restent celles choisies.
- [ ] **I3. Textes.** Fiche client : « Accepte les e-mails », « Proches et sociétés liées », bouton « Itinéraire » ; fenêtre de RDV et devis : « Note interne » avec l'explication au survol de (i).
- [ ] **I4. États vides.** Un tableau de leads, de chantiers ou de devis sans aucune carte (filtre qui ne garde rien, ou entreprise vide) affiche le message et l'action, pas une page blanche.

### Réglages et focus

- [ ] **R1. Page des Paramètres.** Cartes par module, une ligne par réglage avec son icône et une flèche ; un clic ouvre le même écran qu'avant.
- [ ] **R2. Focus après « Abandonner ».** Fiche client → Modifier → changer un champ → fermer → « Abandonner » : le focus revient sur le bouton « Modifier ».

## Mesure (proposée, phase 0)

Questionnaire UEQ-S (8 paires d'adjectifs, 2 minutes) auprès de 3 à 5 utilisateurs de Mayer, maintenant puis dans un mois, à côté de deux tâches chronométrées (poser un RDV, retrouver un client). Protocole à valider avec Eric.
