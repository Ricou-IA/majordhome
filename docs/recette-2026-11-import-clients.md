# Recette — import des clients d'un autre logiciel (novembre 2026)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : à compléter après le push (le site en ligne ne porte pas encore la page d'import).
- **Comptes** : celui d'Eric sur **Cimaj** (administrateur) pour tous les tests d'import ; celui d'Eric sur **Mayer Énergie** pour C101.
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.
- **Numéros** : cette recette commence à C101 pour ne pas croiser ceux de `docs/recette-2026-11.md`, en cours en parallèle.
- **Fichier d'essai fourni** : `docs/recette-fichiers/import-clients-essai.csv` (personnes fictives, 6 lignes, un titre au-dessus de l'en-tête).

## Déjà fait, vérifié le 2026-11-22

- **Migrations appliquées en production** : `20261121_13_clients_import`, `20261121_14_geocode_file_equitable`, `20261122_1_clients_import_suite`, inscrites au registre.
- **Vérifié en base après application** : les trois vues ont `security_invoker` ; `external_ref` est la dernière colonne des deux vues clients ; un visiteur sans compte n'a ni lecture ni exécution sur aucun objet de l'import ; les fonctions internes sont fermées à tout compte.
- **Essai de bout en bout en production, annulé à la fin** (aucune fiche ne reste) : 200 fiches créées en 674 ms, lot rejoué = 0 créée et 200 déjà présentes, administrateur d'une autre entreprise refusé, retrait de 100 fiches en 150 à 200 ms. Après l'essai : 3 788 clients, 0 import, comme avant.
- **Numéros de client** : migration `20261122_2_client_number_sans_troncature` appliquée et inscrite au registre le 2026-11-22 (le numéro ne se tronque plus au-delà de 99 999). Vérifié : le défaut de la colonne passe par `majordhome.client_number_suivant()`, exécutable par l'application et le serveur, pas par un visiteur ; les 3 788 numéros existants sont inchangés ; une fiche créée comme le fait l'application, dans un essai annulé, a reçu `CLI-04066`.
- **Aucune variable d'environnement, aucune fonction serveur** dans ce lot.
- **Dépôt** : 1 677 tests, lint, contrôle du code mort et compilation au vert après le rebase.
- **Fichier d'essai passé par les règles réelles** (hors navigateur) : 6 lignes lues = 4 à importer + 1 doublon écarté + 1 écartée.
- **Non vérifiable par un agent** : tout ce qui demande une session connectée, donc chaque écran de la page d'import. Personne ne l'a encore vue. Rien n'est présumé validé.

## Tests

### Avant le push (la base est déjà à jour, le site non)

- [ ] **C101. La recherche et la création de clients marchent toujours chez Mayer.**
  Où : compte Mayer → Clients.
  Saisir : chercher un nom connu, puis un numéro de téléphone ; ouvrir « Nouveau client » et le refermer sans enregistrer.
  Attendu : la recherche répond comme d'habitude, la fenêtre de création s'ouvre.
  Vérification : par l'API, la clause de recherche répond 200 sur la base à jour (fait le 2026-11-22).

### Après le push — compte Cimaj

- [ ] **C102. Le bouton « Importer » et la page.**
  Où : Clients, en haut à droite, à gauche de « Nouveau client ».
  Saisir : cliquer « Importer ».
  Attendu : une page « Fichier · Correspondance · Aperçu · Résultat » avec une zone de dépôt, « Télécharger le fichier type » et un champ « Logiciel d'origine ».
  Vérification : rien (affichage seul).

- [ ] **C103. Le fichier type.**
  Où : page d'import.
  Saisir : « Télécharger le fichier type », l'ouvrir dans le tableur.
  Attendu : une feuille « Clients » avec la seule ligne d'en-tête (vingt colonnes) et une feuille « Mode d'emploi » qui explique chaque colonne. Aucun nom d'entreprise, aucune commune du Tarn.
  Vérification : rien (affichage seul).

- [ ] **C104. Le fichier d'essai arrive à la correspondance.**
  Où : page d'import.
  Saisir : déposer `import-clients-essai.csv`.
  Attendu : l'étape Correspondance. La ligne d'en-tête trouvée est la troisième du fichier. Sept colonnes sont reconnues (Réf. client, Société, GSM, Mail, Type de logement, Surface habitable, Accord SMS) ; quatre sont « à choisir » : Nom complet, Adresse complète, Marque chaudière, ID interne.
  Vérification : rien (affichage seul).

- [ ] **C105. Régler les quatre colonnes, voir l'aperçu.**
  Où : étape Correspondance.
  Saisir : Nom complet → « Nom et prénom, dans cet ordre » ; Adresse complète → « Adresse complète (rue, code postal, ville) » ; Marque chaudière → « Ajouter aux notes » ; ID interne → « Ignorer » ; puis « Voir l'aperçu ».
  Attendu : « 6 lignes lues = 4 à importer + 1 doublon écarté + 1 écartée ». À importer : DURAND PAUL (06 39 98 00 01), MARTIN CLAIRE (06 39 98 00 02, sans e-mail), GARAGE DU CENTRE, LEROY JEAN (sans téléphone). Doublon : la ligne 9, « Déjà présent ligne 4 du fichier ». Écartée : la ligne 8, « Ni nom ni société ». Un bloc « Valeurs illisibles » cite un e-mail, un téléphone et un accord SMS.
  Vérification : rien (affichage seul ; rien n'est encore écrit).

- [ ] **C106. Importer.**
  Où : étape Aperçu.
  Saisir : « Importer 4 clients ».
  Attendu : la barre de progression, puis « 4 fiches créées » et la phrase sur la carte.
  Vérification : `select display_name, phone, email, postal_code, city, client_category, sms_optin, external_ref, internal_notes from majordhome.clients where import_id is not null and org_id = '62cd2073-96e0-4300-adae-4c1bb8934546' order by import_line;` — 4 lignes, MARTIN CLAIRE avec `sms_optin = false` et son e-mail d'origine dans les notes internes, GARAGE DU CENTRE en `entreprise`.

- [ ] **C107. Une fiche importée.**
  Où : Clients → ouvrir LEROY JEAN.
  Saisir : rien ; puis chercher « A-1004 » dans la liste des clients.
  Attendu : « ancien n° A-1004 » à côté du numéro de client ; dans les notes internes : la marque de chaudière, « Téléphone d'origine : néant », « Accepte les SMS d'origine : peut-être ». La recherche « A-1004 » retrouve la fiche.
  Vérification : rien de plus que C106.

- [ ] **C108. Le même fichier une seconde fois ne recrée rien.**
  Où : page d'import.
  Saisir : déposer de nouveau le fichier, régler les quatre colonnes, « Voir l'aperçu ».
  Attendu : 0 à importer ; les quatre fiches apparaissent en doublons, avec la fiche existante en face et la raison du rapprochement. Le bouton d'import est fermé.
  Vérification : `select count(*) from majordhome.clients where org_id = '62cd2073-96e0-4300-adae-4c1bb8934546';` — inchangé (5).

- [ ] **C109. Les imports précédents et le retrait.**
  Où : bas de la page d'import, « Imports précédents ».
  Saisir : « Retirer cet import » sur l'import du fichier d'essai, lire le texte, confirmer.
  Attendu : « 4 fiches seront retirées. » ; après confirmation, « 4 fiches retirées » et la ligne passe à « Retiré le … ». La liste des clients revient à 1.
  Vérification : `select status, counts from majordhome.client_imports order by created_at desc limit 1;` — `retire`, `retirees = 4` ; `select count(*) from majordhome.clients where import_id is not null;` — 0.

- [ ] **C110. Un vrai fichier Excel.**
  Où : page d'import.
  Saisir : le fichier type rempli de deux ou trois lignes dans le tableur (un téléphone saisi sans son 0, un code postal à 4 chiffres), enregistré en `.xlsx`, déposé.
  Attendu : l'aperçu directement (sans passer par la correspondance), le téléphone et le code postal remis en forme.
  Vérification : rien (ne pas importer, ou retirer l'import ensuite).

- [ ] **C111. Un membre qui n'est pas administrateur.**
  Où : un compte Cimaj non administrateur, s'il y en a un sous la main.
  Saisir : ouvrir Clients, puis l'adresse `/clients/import`.
  Attendu : pas de bouton « Importer » ; l'adresse renvoie à la liste des clients.
  Vérification : rien (la base refuse de toute façon : éprouvé le 2026-11-22).

- [ ] **C112. La carte.**
  Où : aucune action.
  Saisir : attendre le passage suivant du géocodage (toutes les 30 minutes) après C106, si l'import n'a pas été retiré entre-temps.
  Attendu : les fiches importées ont des coordonnées.
  Vérification : `select display_name, latitude is not null as placee from majordhome.clients where import_id is not null;`

## Anomalies

_(aucune pour l'instant)_

## Remarques et améliorations

- Connu avant recette : pendant un envoi, le menu latéral reste cliquable (l'envoi continue, l'import reste dans la liste).
- Connu avant recette : un import arrêté en cours de route garde le libellé « En cours » dans la liste.
- Connu avant recette : le retrait d'un très gros import (10 000 fiches) prendrait plusieurs minutes, sans barre de progression.

## Retest des corrections

_(rien pour l'instant)_
