# Recette — import des clients d'un autre logiciel (novembre 2026)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : `cfaefda1` (poussé le 2026-11-22, 31 commits depuis `5b0a9f3e`). Corrections de recette mises en ligne le 2026-11-22 : `c3c51be8`, `87842d63`, `2cc124ae` (déploiement prêt pour `2cc124ae`).
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
- **Mise en ligne** : déploiement de production prêt pour `cfaefda1` (statut Vercel « success ») ; `https://majordhome.vercel.app/clients/import` répond 200 ; le site servi contient la route `clients/import` et le fichier de la page d'import (fragments « fichier type », « Imports pr »).
- **Dépôt** : 1 677 tests, lint, contrôle du code mort et compilation au vert après le rebase.
- **Fichier d'essai passé par les règles réelles** (hors navigateur) : 6 lignes lues = 4 à importer + 1 doublon écarté + 1 écartée.
- **Non vérifiable par un agent** : tout ce qui demande une session connectée, donc chaque écran de la page d'import. Personne ne l'a encore vue. Rien n'est présumé validé.

## Tests

### Non-régression (compte Mayer)

- [x] **C101. La recherche et la création de clients marchent toujours chez Mayer.** 2026-11-22 — retour d'Eric : « Oui, ça marche », après la mise en ligne de `cfaefda1`. Vérifié de mon côté : la clause de recherche (dont l'ancien numéro) répond 200 par l'API sur la base à jour ; une fiche créée comme le fait l'application, dans un essai annulé, a reçu `CLI-04066`. Non détaillé par Eric : nom et téléphone cherchés séparément.
  Où : compte Mayer → Clients.
  Saisir : chercher un nom connu, puis un numéro de téléphone ; ouvrir « Nouveau client » et le refermer sans enregistrer.
  Attendu : la recherche répond comme d'habitude, la fenêtre de création s'ouvre.
  Vérification : par l'API, la clause de recherche répond 200 sur la base à jour (fait le 2026-11-22).

### Après le push — compte Cimaj

- [x] **C102. Le bouton « Importer » et la page.** 2026-11-22 — retour d'Eric : « Oui, c'est bon » (compte Cimaj). Affichage seul, rien à vérifier en base. Aucune remarque de forme sur la page.
  Où : Clients, en haut à droite, à gauche de « Nouveau client ».
  Saisir : cliquer « Importer ».
  Attendu : une page « Fichier · Correspondance · Aperçu · Résultat » avec une zone de dépôt, « Télécharger le fichier type » et un champ « Logiciel d'origine ».
  Vérification : rien (affichage seul).

- [x] **C103. Le fichier type.** 2026-11-22 — retour d'Eric : « Oui, c'est bon » (compte Cimaj). Affichage seul, rien à vérifier en base. Premier fichier Excel réellement écrit par la page : il s'ouvre. Non détaillé par Eric : le compte des vingt colonnes et le contenu de la feuille « Mode d'emploi ».
  Où : page d'import.
  Saisir : « Télécharger le fichier type », l'ouvrir dans le tableur.
  Attendu : une feuille « Clients » avec la seule ligne d'en-tête (vingt colonnes) et une feuille « Mode d'emploi » qui explique chaque colonne. Aucun nom d'entreprise, aucune commune du Tarn.
  Vérification : rien (affichage seul).

- [x] **C104. Le fichier d'essai arrive à la correspondance.** 2026-11-22 — capture d'écran d'Eric : l'étape Correspondance s'affiche, la ligne d'en-tête trouvée est la ligne 3, les sept colonnes attendues sont reconnues, quatre sont « à choisir ». Sur la capture, « Adresse complète » portait « Adresse » : Eric confirme que la colonne était bien « à choisir » et que c'est lui qui a mis « Adresse » (« oui c'était à choisir, c'est moi qui ai mis adresse »). Vérifié : les règles locales et le code en ligne rendent « à choisir » pour cet en-tête. Voir A101.
  Où : page d'import.
  Saisir : déposer `import-clients-essai.csv`.
  Attendu : l'étape Correspondance. La ligne d'en-tête trouvée est la troisième du fichier. Sept colonnes sont reconnues (Réf. client, Société, GSM, Mail, Type de logement, Surface habitable, Accord SMS) ; quatre sont « à choisir » : Nom complet, Adresse complète, Marque chaudière, ID interne.
  Vérification : rien (affichage seul).

- [x] **C105. Régler les quatre colonnes, voir l'aperçu.** 2026-11-22 — capture d'écran d'Eric, conforme point par point : compteurs 6 / 4 / 1 / 1 et phrase « 6 lignes lues = 4 à importer + 1 doublon écarté + 1 écartée » ; à importer : DURAND PAUL (06 39 98 00 01, 69003 Lyon), MARTIN CLAIRE (06 39 98 00 02, sans e-mail, 69002 Lyon), GARAGE DU CENTRE (01 99 00 00 03, 69007 Lyon), LEROY JEAN (sans téléphone ni e-mail, 69700 Givors) ; doublon : ligne 9, « Déjà présent ligne 4 du fichier », avec la coche « Importer quand même » ; écartée : ligne 8, « Ni nom ni société » ; bloc « Valeurs illisibles : 1 × E-mail, 1 × Téléphone, 1 × Accepte les SMS ». Mêmes résultats que le passage du fichier par les règles hors navigateur. Rien n'est écrit à ce stade.
  Où : étape Correspondance.
  Saisir : Nom complet → « Nom et prénom, dans cet ordre » ; Adresse complète → « Adresse complète (rue, code postal, ville) » ; Marque chaudière → « Ajouter aux notes » ; ID interne → « Ignorer » ; puis « Voir l'aperçu ».
  Attendu : « 6 lignes lues = 4 à importer + 1 doublon écarté + 1 écartée ». À importer : DURAND PAUL (06 39 98 00 01), MARTIN CLAIRE (06 39 98 00 02, sans e-mail), GARAGE DU CENTRE, LEROY JEAN (sans téléphone). Doublon : la ligne 9, « Déjà présent ligne 4 du fichier ». Écartée : la ligne 8, « Ni nom ni société ». Un bloc « Valeurs illisibles » cite un e-mail, un téléphone et un accord SMS.
  Vérification : rien (affichage seul ; rien n'est encore écrit).

- [x] **C106. Importer.** 2026-11-22 — capture d'écran d'Eric : « Import terminé », 6 lignes lues, 4 fiches créées, 1 doublon écarté, 1 écartée, la phrase sur la carte, les trois boutons, et la ligne « import-clients-essai.csv · 22 nov. 2026, 02:14 · Demo Eric · 4 fiches créées · Terminé » sous « Imports précédents ». Vérifié en base (lecture seule) : 4 fiches chez Cimaj, lignes 4 à 7, numéros `CLI-04067` à `CLI-04070` ; DURAND PAUL (06 39 98 00 01, 12 rue de la République, 69003 Lyon, maison, 85.5, A-1001, note « Marque chaudière : Atlantic ») ; MARTIN CLAIRE (e-mail vide, `sms_optin = false`, appartement, 85.33, notes internes avec la marque et « E-mail d'origine : claire.martin(at)example.org ») ; GARAGE DU CENTRE (`entreprise`, sans nom ni prénom) ; LEROY JEAN (téléphone vide, `sms_optin = true`, notes internes avec « Téléphone d'origine : néant » et « Accepte les SMS d'origine : peut-être »). Notes visibles par le client : vides partout. Chaque fiche a son projet dans la même organisation et un auteur. Import `termine`, `counts = {lues: 6, importees: 4, doublons_ecartes: 1, ecartees: 1}`. Cimaj : 5 clients ; aucune fiche importée dans une autre organisation.
  Où : étape Aperçu.
  Saisir : « Importer 4 clients ».
  Attendu : la barre de progression, puis « 4 fiches créées » et la phrase sur la carte.
  Vérification : `select display_name, phone, email, postal_code, city, client_category, sms_optin, external_ref, internal_notes from majordhome.clients where import_id is not null and org_id = '62cd2073-96e0-4300-adae-4c1bb8934546' order by import_line;` — 4 lignes, MARTIN CLAIRE avec `sms_optin = false` et son e-mail d'origine dans les notes internes, GARAGE DU CENTRE en `entreprise`.

- [x] **C107. Une fiche importée.** 2026-11-22 — trois captures d'écran d'Eric. Capture d'écran d'Eric du 2026-11-22 (haut de la fiche LEROY JEAN) : « CLI-04070 ancien n° A-1004 » dans l'en-tête, Givors 69700, nom LEROY, prénom JEAN, catégorie Particulier, téléphone et e-mail vides, les deux accords cochés, adresse « Lieu-dit Les Granges », 69700 Givors ; la carte place la fiche d'après l'adresse saisie (géocodage pas encore passé). Conforme à la base (C106). Seconde capture (bas de la fiche) : logement Maison, surface 120 ; « Notes » vides ; « Notes internes » avec « Marque chaudière : De Dietrich », « Téléphone d'origine : néant », « Accepte les SMS d'origine : peut-être » — conforme. Troisième capture : la recherche « A-1004 » dans la liste des clients rend LEROY JEAN, seule fiche affichée (« 1 client affiché »).
  Où : Clients → ouvrir LEROY JEAN.
  Saisir : rien ; puis chercher « A-1004 » dans la liste des clients.
  Attendu : « ancien n° A-1004 » à côté du numéro de client ; dans les notes internes : la marque de chaudière, « Téléphone d'origine : néant », « Accepte les SMS d'origine : peut-être ». La recherche « A-1004 » retrouve la fiche.
  Vérification : rien de plus que C106.

- [x] **C108. Le même fichier une seconde fois ne recrée rien.** 2026-11-22 — deux captures d'écran d'Eric. Capture d'écran d'Eric du 2026-11-22 : « 6 lignes lues = 0 à importer + 5 doublons écartés + 1 écartée » (les quatre fiches déjà en base, plus la ligne 9 en double dans le fichier), bouton « Importer 0 client » fermé, « Imports précédents » toujours à un seul import. Vérifié en base (lecture seule) : Cimaj a toujours 5 clients dont 4 importés, un seul import (`termine`), la séquence des numéros n'a pas bougé (4 070) : aucun import n'a été ouvert. Seconde capture (liste dépliée) : lignes 4 à 7 « Déjà dans vos clients », chacune avec la fiche existante (nom, n° CLI-04067 à CLI-04070, ville) et ses raisons — DURAND PAUL : même téléphone, même e-mail, même nom et prénom, même nom, même ancien numéro ; MARTIN CLAIRE : sans « même e-mail » (son e-mail est vide) ; GARAGE DU CENTRE : sans « même nom et prénom » (société seule) ; LEROY JEAN : sans téléphone ni e-mail ; ligne 9 « En double dans le fichier · Déjà présent ligne 4 du fichier » ; coche « Importer quand même » non cochée partout. Les raisons affichées correspondent aux valeurs lues en base en C106. Voir A104.
  Où : page d'import.
  Saisir : déposer de nouveau le fichier, régler les quatre colonnes, « Voir l'aperçu ».
  Attendu : 0 à importer ; les quatre fiches apparaissent en doublons, avec la fiche existante en face et la raison du rapprochement. Le bouton d'import est fermé.
  Vérification : `select count(*) from majordhome.clients where org_id = '62cd2073-96e0-4300-adae-4c1bb8934546';` — inchangé (5).

- [x] **C109. Les imports précédents et le retrait.** 2026-11-22 — retour d'Eric : « Oui, 1 client ». Vérifié en base (lecture seule) : import `retire`, retiré à 02:28, `counts` = lues 6, importees 4, retirees 4, conservees 0 ; Cimaj n'a plus qu'une fiche, SOUBIELLE SARAH, intacte ; aucune fiche d'essai (A-1001 à A-1004) ni aucun projet créé par l'import ne reste ; 3 788 clients au total, comme avant la recette. Non détaillé par Eric : le texte de la fenêtre (« 4 fiches seront retirées. ») et le message de fin. Vu ensuite sur la capture de C110 : la ligne de l'import affiche « Retiré le 22 nov. 2026, 02:28 », sans bouton.
  Où : bas de la page d'import, « Imports précédents ».
  Saisir : « Retirer cet import » sur l'import du fichier d'essai, lire le texte, confirmer.
  Attendu : « 4 fiches seront retirées. » ; après confirmation, « 4 fiches retirées » et la ligne passe à « Retiré le … ». La liste des clients revient à 1.
  Vérification : `select status, counts from majordhome.client_imports order by created_at desc limit 1;` — `retire`, `retirees = 4` ; `select count(*) from majordhome.clients where import_id is not null;` — 0.

- [x] **C110. Un vrai fichier Excel.** 2026-11-22 — deux essais. Premier essai (autre que celui prévu) : le 2026-11-22 Eric a fait un autre essai que celui prévu : il a ouvert `import-clients-essai.csv` dans Excel, ajouté une ligne, enregistré en `.xlsx` et déposé ce fichier (capture d'écran). Acquis : un vrai `.xlsx` est lu (première feuille, 7 lignes, ligne d'en-tête trouvée en ligne 3, « 639980001 » et « 85.5 » lus comme nombres sans dommage). Écart : les accents sont abîmés à l'écran (« RÃ©f. client », « SociÃ©tÃ© », « Adresse complÃ¨te », « mÂ² », « peut-Ãªtre »), donc quatre en-têtes de plus tombent « à choisir ». Voir R101. Second essai, celui prévu (capture d'écran) : le fichier type rempli d'une ligne dans Excel puis déposé arrive directement à l'aperçu (étapes Fichier et Correspondance cochées d'office) ; « 1 ligne lue = 1 à importer + 0 doublon écarté + 0 écartée » ; téléphone affiché « 06 39 98 00 11 » (saisi sans son 0) ; code postal « 01100 » (saisi à 4 chiffres) ; e-mail lu tel que saisi. Le bloc « Valeurs illisibles : 1 × Type de client » signale une valeur saisie hors des trois admises (« Particulier » aurait été reconnu : vérifié). Voir A105.
  Où : page d'import.
  Saisir : le fichier type rempli de deux ou trois lignes dans le tableur (un téléphone saisi sans son 0, un code postal à 4 chiffres), enregistré en `.xlsx`, déposé.
  Attendu : l'aperçu directement (sans passer par la correspondance), le téléphone et le code postal remis en forme.
  Vérification : rien (ne pas importer, ou retirer l'import ensuite).

- [-] **C111. Un membre qui n'est pas administrateur.** 2026-11-22 — non testé : recette arrêtée à la demande d'Eric, pas de compte Cimaj non administrateur essayé. La base refuse de toute façon un non-administrateur (éprouvé le 2026-11-22 dans l'essai annulé).
  Où : un compte Cimaj non administrateur, s'il y en a un sous la main.
  Saisir : ouvrir Clients, puis l'adresse `/clients/import`.
  Attendu : pas de bouton « Importer » ; l'adresse renvoie à la liste des clients.
  Vérification : rien (la base refuse de toute façon : éprouvé le 2026-11-22).

- [-] **C112. La carte.** 2026-11-22 — écarté à l'arrêt de la recette, resté partiel : la file de géocodage prend bien les fiches importées, mais aucune fiche importée à l'adresse cohérente n'a été vue recevoir ses coordonnées. Détail — 2026-11-22 : Eric a importé la ligne de C110 à 02:45 (fiche `CLI-04071`, import `termine`, 1 fiche). Vérifié en base après le passage de 03:00 (`geocode-sweep`, « succeeded ») : la fiche a bien été prise par la file (`geocode_attempts` passé de 0 à 1), donc la file servie à tour de rôle fonctionne en production et voit les fiches importées. Mais elle n'a pas reçu de coordonnées (`latitude` et `geocoded_at` vides) : la ligne d'essai porte le code postal 01100 avec la ville « toulouse » et aucune adresse, une combinaison qui n'existe pas. Eric a dit vouloir corriger le code postal en 31000 ; au passage de 03:30 (« succeeded ») la fiche portait toujours 01100 / « toulouse » : deuxième essai sans résultat (`geocode_attempts` = 2). Manque : une fiche importée à l'adresse cohérente qui reçoit ses coordonnées. Dès que l'adresse de la fiche est corrigée, le compteur d'essais repart de zéro et le passage suivant la reprend.
  Où : aucune action.
  Saisir : attendre le passage suivant du géocodage (toutes les 30 minutes) après C106, si l'import n'a pas été retiré entre-temps.
  Attendu : les fiches importées ont des coordonnées.
  Vérification : `select display_name, latitude is not null as placee from majordhome.clients where import_id is not null;`

## Anomalies

- **R101 (2026-11-22, vu pendant C110) — corrigée (`c3c51be8`, `2cc124ae`), retest C113 validé le 2026-11-22. Accents abîmés quand un CSV a été ouvert puis enregistré par Excel.** Cause établie en lisant le fichier d'Eric cellule par cellule (`docs/recette-fichiers/import-clients-essai.xlsx`, non versionné) : c'est le fichier lui-même qui contient « RÃ©f. client », « SociÃ©tÃ© », « nÃ©ant »… Excel a ouvert le CSV d'essai, écrit en UTF-8 sans marque d'ordre des octets, comme un fichier Windows-1252, puis a enregistré le résultat. L'import a lu fidèlement ce qu'on lui a donné. Deux défauts de notre côté : (1) le fichier d'essai que j'ai fourni n'a pas la marque qui dit à Excel qu'il est en UTF-8 ; (2) le cas est courant chez un vrai utilisateur (ouvrir l'export dans Excel, le retoucher, l'enregistrer), et l'import ne répare rien : en-têtes non reconnus, noms et adresses faux en base. Correctif proposé, en attente de l'accord d'Eric : réparer ces accents à la lecture (une cellule dont le texte, repassé en octets Windows-1252, se relit proprement en UTF-8 est remplacée par sa version réparée ; sinon elle n'est pas touchée), avec ses tests, et ajouter la marque au fichier d'essai.

## Remarques et améliorations

- **A105 — fait (c3c51be8, 2cc124ae), retest C117 non fait à l'écran (2026-11-22, vu pendant C110).** Le type de client n'accepte que les mots exacts : « Particuliers » (au pluriel), « Privé », « Client », « SARL » sont illisibles. Par ailleurs le bloc de l'aperçu dit « le champ est laissé vide », alors que pour le type de client la fiche devient « particulier ». À proposer : accepter les pluriels et quelques mots courants, et dire la valeur prise par défaut.

- **A104 — fait (c3c51be8), retest C116 non fait à l'écran (2026-11-22, vu pendant C108).** Dans les raisons d'un doublon, « même nom et prénom » est suivi de « même nom », qui dit la même chose une seconde fois. À proposer : ne pas afficher « même nom » quand « même nom et prénom » y est déjà.

- **A102 — fait (87842d63), retest C115 validé (2026-11-22, vu pendant C107).** Sur la fiche, le champ « Notes internes » ne fait que deux lignes de haut : les trois lignes venues de l'import ne se lisent qu'en faisant défiler le champ (la première est coupée). À proposer : un champ qui s'agrandit avec son contenu.
- **A103 — ouverte, en attente de la réponse d'Eric (2026-11-22, vu pendant C107).** Deux façons de nommer le même champ : la fiche dit « Notes visibles par toute l'équipe », le fichier type et l'écran de correspondance disent « Notes (visibles par le client) ». À trancher par Eric, puis aligner les deux.

- **A101 — fait (c3c51be8, 87842d63, 2cc124ae), retest C114 validé (2026-11-22, vu pendant C104).** Devant une colonne « Adresse complète », le réflexe d'Eric a été de choisir « Adresse » : toute la ligne (« 12 rue de la République 69003 Lyon ») irait alors dans l'adresse, et le code postal et la ville resteraient vides, sans que rien ne le dise. Le bon choix, « Adresse complète (rue, code postal, ville) », est en bas de la liste, dans un second groupe. Correctif proposé, en attente de son accord : (1) présélectionner la cible composée quand l'en-tête le dit (« Adresse complète », « Nom complet », « Nom et prénom », « CP Ville »…) ; (2) quand une colonne pointée sur « Adresse » contient des codes postaux et qu'aucune colonne ne va vers « Code postal », le dire sous la liste avec un bouton pour basculer ; même chose pour « Nom » quand les valeurs portent nom et prénom ; (3) à l'aperçu, compter les fiches sans code postal.

- Connu avant recette : pendant un envoi, le menu latéral reste cliquable (l'envoi continue, l'import reste dans la liste).
- Connu avant recette : un import arrêté en cours de route garde le libellé « En cours » dans la liste.
- Connu avant recette : le retrait d'un très gros import (10 000 fiches) prendrait plusieurs minutes, sans barre de progression.

## Retest des corrections

- [x] **C113. Retest de R101 : le fichier Excel aux accents abîmés.** 2026-11-22 — retour d'Eric : « Oui, réparés » (sur le déploiement de `2cc124ae`). Vérifié hors navigateur : le même fichier passé par les règles donne 11 cellules réparées et les en-têtes attendus. Non détaillé par Eric : le nombre de cellules affiché.
  Où : compte Cimaj → Clients → « Importer ».
  Saisir : déposer de nouveau `import-clients-essai.xlsx` (celui enregistré depuis Excel).
  Attendu : à l'étape Correspondance, la ligne « Des accents abîmés ont été réparés dans 11 cellules (fichier passé par un tableur). » ; les en-têtes se lisent « Réf. client », « Société », « Adresse complète », « Marque chaudière » ; les valeurs aussi (« République », « Jaurès », « néant », « m² », « peut-être »).
  Vérification : hors navigateur, le même fichier passé par les règles donne 11 cellules réparées (fait le 2026-11-22).

- [x] **C114. Retest de A101 : « Adresse complète » et « Nom complet » présélectionnés.** 2026-11-22 — retour d'Eric : « Oui, c'est bon ». Affichage seul, rien à vérifier en base.
  Où : la même étape Correspondance (ou en déposant `import-clients-essai.csv`).
  Saisir : rien d'abord ; puis mettre « Adresse » à la main sur la colonne « Adresse complète ».
  Attendu : « Nom complet » arrive sur « Nom et prénom, dans cet ordre » et « Adresse complète » sur « Adresse complète (rue, code postal, ville) » ; seules « Marque chaudière » et « ID interne » restent à choisir. Une fois « Adresse » mis à la main, un encadré sous la liste dit « Ces adresses contiennent le code postal et la ville. » avec un bouton « Séparer », qui remet le bon choix.
  Vérification : rien (affichage seul).

- [x] **C115. Retest de A102 : les notes d'une fiche importée se lisent sans défiler.** 2026-11-22 — retour d'Eric : « Oui, c'est bon ». Fait sur la fiche TEST1 ERIC (CLI-04071) avec des lignes saisies à la main, la fiche LEROY JEAN ayant été retirée avec l'import d'essai. Affichage seul.
  Où : une fiche importée qui a plusieurs lignes de notes internes.
  Saisir : ouvrir la fiche, descendre aux notes.
  Attendu : le champ « Notes internes » montre toutes ses lignes (jusqu'à douze) sans barre de défilement.
  Vérification : rien (affichage seul).

- [-] **C116. Retest de A104 : les raisons d'un doublon.** 2026-11-22 — non testé à l'écran : recette arrêtée à la demande d'Eric. La règle est tenue par les tests du dépôt (`scripts/import-clients/libelles.test.mjs`).
  Où : l'aperçu d'un fichier dont les fiches existent déjà.
  Saisir : déplier « Doublons ».
  Attendu : « même nom et prénom » n'est plus suivi de « même nom ».
  Vérification : rien (affichage seul).

- [-] **C117. Retest de A105 : le type de client.** 2026-11-22 — non testé à l'écran : recette arrêtée à la demande d'Eric. La règle est tenue par les tests du dépôt (`scripts/import-clients/normaliser.test.mjs`).
  Où : le fichier type rempli, colonne « Type de client ».
  Saisir : « Particuliers », « SARL », « Mairie » sur trois lignes, puis déposer.
  Attendu : aucune de ces valeurs dans « Valeurs illisibles ». Avec une valeur vraiment illisible (« ? »), le bloc dit « Un accord illisible vaut « oui » ; un type de client illisible est déduit de la société, sinon « particulier ». »
  Vérification : rien (affichage seul).

## Fin de recette — 2026-11-22

Recette arrêtée à la demande d'Eric (« je l'utilise tous les jours, donc on relèvera les problèmes »). La suite se fait à l'usage.

- **Validés (13)** : C101 à C110, C113, C114, C115.
- **Non testés ou écartés (4)** : C111 (pas de compte non administrateur essayé), C112 (géocodage d'une fiche importée, resté partiel), C116 et C117 (retests d'affichage, règles tenues par les tests du dépôt).
- **Anomalie** : R101 corrigée et retestée. Aucune anomalie ouverte.
- **Remarque ouverte** : A103, le libellé du champ « Notes » (« visibles par toute l'équipe » sur la fiche, « visibles par le client » dans le fichier type et la correspondance).
- **Reste en base chez Cimaj** : la fiche d'essai TEST1 ERIC (`CLI-04071`, code postal 01100 / « toulouse », jamais placée sur la carte) et son import `fichier-type-clients (1).xlsx`. À retirer par Eric depuis « Imports précédents » quand il voudra ; aucune écriture n'a été faite en base pour la recette.
