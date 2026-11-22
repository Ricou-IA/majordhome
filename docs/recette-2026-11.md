# Recette — suites de l'audit d'interface (novembre 2026)

- **Adresse testée** : https://majordhome.vercel.app
- **Commit déployé** : `415004a2` au début de la recette (neuf commits depuis `29cccfad`, des 21 et 22 novembre 2026), puis `ae47f24c` à partir de C20 (groupe « Développement », A1)
- **Comptes** : celui d'Eric (Mayer Énergie, administrateur) ; pour C4 et C19, un compte au menu court (Cimaj, ou un technicien de Mayer) s'il est sous la main
- **Légende** : `[x]` validé · `[!]` anomalie · `[-]` non testable ou écarté, avec la raison
- **Règle** : un test à la fois. Un point est coché après le retour d'Eric et la vérification.

## Déjà fait, vérifié le 2026-11-22

- Aucune migration, aucune variable d'environnement, aucune fonction serveur dans ce lot : uniquement l'application.
- Dernier déploiement de production prêt pour `415004a2`, rattaché à `majordhome.vercel.app`.
- Le domaine répond (code 200) et le site servi contient le code livré (menu en groupes, recherche, règles de couleur des boutons).
- Lint, build et tests purs au vert avant chaque push (accueil, menu, recherche, planning).
- Lecture seule en base pour les compteurs (Mayer) : 3 612 clients = 3 455 particuliers + 100 entreprises + 57 secteur public ; 490 contrats actifs, 250 clos, 101 en attente ; 5 RDV le lundi 23 novembre.
- **Non vérifiable par un agent** : tout ce qui demande une session connectée, donc l'apparence de chaque écran. Rien n'est présumé validé.
- Connu, non traité : une adresse inconnue rend la page « introuvable » avec un code 200.

## Tests

### À faire ce dimanche (ne se voit que le week-end)

- [ ] **C1. Le planning s'ouvre sur la semaine à venir.** _Partiel_
  Où : menu → Planning.
  Saisir : ouvrir la page, puis cliquer « Aujourd'hui ».
  Attendu : la semaine du lundi 23 novembre s'affiche à l'ouverture (et non celle du 16) ; « Aujourd'hui » ramène à cette même semaine. La flèche de gauche mène toujours à la semaine passée.
  Vérification : rien (affichage seul).
  Retour du 2026-11-22 (dimanche) : « Oui, semaine du 23 » — l'ouverture est confirmée par Eric. Manque : le bouton « Aujourd'hui » et la flèche de gauche, non confirmés.

### Connexion et menu

- [x] **C2. Une connexion refusée le dit.** 2026-11-22
  Où : page de connexion, dans une fenêtre de navigation privée.
  Saisir : votre adresse et un mot de passe faux, puis « Se connecter ».
  Attendu : le message « Email ou mot de passe incorrect » s'affiche et l'adresse saisie reste dans le champ.
  Vérification : rien (affichage seul).
  Retour : « Oui, message affiché ». Le message et les champs vivent dans le même état de la page : s'il s'affiche, la page n'a pas été recréée, donc l'adresse est restée (non confirmé mot pour mot par Eric).

- [x] **C3. Le menu est rangé en groupes.** 2026-11-22 — retour : « Oui, tout est bon » pour le comportement (repli, mémoire du choix, groupe de la page ouverte). Rangement revu dans la foulée : voir A1 et le retest C20.
  Où : menu latéral, compte administrateur de Mayer.
  Saisir : regarder le menu ; cliquer sur le titre « Marketing », puis sur « Terrain » ; recharger la page ; ouvrir « Mailing » puis replier « Marketing ».
  Attendu : Dashboard et Planning en tête, puis « Clients & ventes » et « Terrain » dépliés, « Marketing » et « Études » repliés. Un clic sur un titre replie ou déplie, et ce choix tient après rechargement. Sur la page Mailing, le groupe « Marketing » reste ouvert et son titre ne se replie pas.
  Vérification : rien (affichage seul). À dire aussi : une entrée mal rangée, un titre qui ne parle pas.

- [x] **C4. Un menu court reste une liste simple.** 2026-11-22 — retour : « oui compte cimaj », avec une capture d'écran. Vu sur la capture : Dashboard, Planning, Clients, Territoire, Pipeline, Chantiers, Mailing, sans titre de groupe ; boutons « Rechercher » et « Créer » au-dessus. La même capture montre l'accueil d'une entreprise sans activité : quatre repères à zéro, « Aucun RDV posé d'ici au dimanche 6 décembre », « 1 lead à contacter », pas de section « À corriger ».
  Où : menu latéral, compte au menu court (Cimaj ou technicien).
  Saisir : regarder le menu.
  Attendu : la liste d'avant, dans le même ordre, sans titres de groupe.
  Vérification : rien (affichage seul).

### Accueil

- [x] **C5. La journée.** 2026-11-22 — retour : « Oui, les 5 RDV », avec lieu et personnes (retest de R1 compris). Vérifié en base : 5 RDV le lundi 23, relevé ci-dessous.
  Où : menu → Dashboard.
  Saisir : regarder le premier bloc.
  Attendu : ce dimanche, le titre « Prochains RDV · lundi 23 novembre » et 5 RDV, chacun avec son heure, le client, le type, le lieu et les personnes (pastille de couleur + prénom). À partir de lundi, le titre « Aujourd'hui » et les RDV du jour.
  Relevé en base le 22/11 pour le lundi 23 : 08:00 Installation à Graulhet (2 techniciens) ; 09:00 Visite technique à Terre-de-Bancalié ; 11:00 Visite technique à Gaillac ; 15:30 Visite technique à Saint-Jean ; 17:00 Visite technique à Gaillac (un commercial sur chacune des quatre visites).
  Vérification : `select count(*) from public.majordhome_appointments where scheduled_date = '2026-11-23' and status <> 'cancelled' and appointment_type <> 'leave'` (5 mesurés le 22/11).

- [x] **C6. Les quatre repères sont ceux des autres écrans.** 2026-11-22 — retour : « Oui, ils correspondent » (0 RDV aujourd'hui et 25 la semaine prochaine, CA signé ≈ 68 047 € pour 11 ventes, 130 devis en attente pour ≈ 1 732 344 € HT, CA programmé comparé au planning). Valeurs recalculées en base ci-dessous.
  Où : Dashboard, bande de chiffres ; puis Pipeline → onglet Dashboard (mois en cours) ; puis Planning (semaine du 23).
  Saisir : noter les quatre chiffres de l'accueil, puis les comparer.
  Attendu : « CA signé HT en novembre » = « CA signé HT » du pipeline ; « Devis en attente » et son montant = ligne Total du tableau « À traiter maintenant » ; « CA HT programmé » = le cumul affiché à côté du titre du planning pour la semaine du 23.
  Vérification : les trois comparaisons, chiffres notés dans la note du test.
  Recalculé en base le 22/11, indépendamment de l'écran (cartes en colonne Gagné datées de novembre ; cartes en colonne Devis envoyé hors projets MT-LT) : CA signé HT en novembre ≈ 68 047 € pour 11 ventes ; devis en attente 130 pour ≈ 1 732 344 € HT ; 25 RDV la semaine du 23. Le CA HT programmé ne se recalcule pas simplement en base (prorata des journées, contrats ramenés en HT) : il se compare au cumul du planning.

- [x] **C7. « À traiter » mène au bon endroit.** 2026-11-22 — retour : « Oui, tout est bon » (nombres et destinations). Nombres recalculés en base ci-dessous : 6, 20, 1 et 6.
  Où : Dashboard, bloc de droite.
  Saisir : cliquer chaque ligne tour à tour, revenir à l'accueil entre deux.
  Attendu : leads à contacter et RDV à replanifier ouvrent le Kanban du pipeline ; devis sans relance ouvre le Dashboard du pipeline ; commandes à passer et chantiers à planifier ouvrent les chantiers. Les nombres sont ceux de la ligne Total du pipeline et des colonnes « Commande à faire » et « À planifier » des chantiers.
  Vérification : comparaison à l'écran, chiffres notés.
  Recalculé en base le 22/11 : 6 leads à contacter, 20 RDV commerciaux à replanifier, 1 commande à passer, 6 chantiers à planifier (le nombre de devis sans relance dépend des dates de contact, non recalculé).

- [x] **C8. Le ménage des données est en bas.** 2026-11-22 — retour : « Oui, en bas ».
  Où : Dashboard, bas de page.
  Saisir : faire défiler.
  Attendu : une section « À corriger » sous le planning, avec ce qui s'affichait avant en tête de page (devis non rattachés, fiches en double, leads à plusieurs payeurs, appareils à contrôler). Rien de cela au-dessus du planning.
  Vérification : rien (affichage seul).

### Compteurs

- [x] **C9. Les cartes de la page Clients retombent sur le total.** 2026-11-22 — retour : « Oui, les bons chiffres ». Vérifié en base le même jour : 3 612 actifs = 3 455 particuliers + 100 entreprises + 57 secteur public ; 490 avec contrat actif ; 171 archivés. Aucune remarque sur la disposition des six cartes.
  Où : menu → Clients.
  Saisir : regarder les cartes ; cliquer « Secteur public ».
  Attendu : Total 3 612, Particuliers 3 455, Entreprises 100, Secteur public 57 (aux créations du jour près). Le clic filtre la liste sur ces clients.
  Vérification : `select client_category, count(*) from public.majordhome_clients where org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' and not is_archived group by 1`.

- [x] **C10. La pastille de l'onglet Contrats ne suit plus le filtre.** 2026-11-22 — validé sur la capture de C21 : la liste affichée est celle des contrats clos (vérifié en base) et la pastille « Contrats » affiche 490, « Clos » 250. Le passage par un clic sur l'onglet « Clos » n'a pas été fait ici : il est repris dans C22.
  Où : menu → **Entretiens** (et non « Contrats »), dans la barre d'onglets Kanban / Contrats / Programmation / Dashboard / Clos.
  Saisir : noter la pastille de l'onglet « Contrats », cliquer l'onglet « Clos », la relire.
  Attendu : « Contrats » affiche 490 avant et après ; « Clos » affiche 250 ; la liste montre les contrats clos.
  Vérification : `select status, count(*) from public.majordhome_contracts where org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1' group by 1` (490 actifs, 250 clos, 101 en attente, 32 archivés le 22/11).
  Retour du 2026-11-22 : « il ne se passe rien si je clique sur la carte clos », avec une capture de la page « Contrats » du menu (Pipeline Contrats). Le test n'a donc pas été fait sur le bon écran ; il a donné A2 et fait apparaître R2.

- [x] **C11. Le compteur d'envoi du mailing s'explique.** 2026-11-22 — retour : « Oui, avec la phrase ». Rien n'a été envoyé. Les nombres exacts lus à l'écran ne m'ont pas été donnés.
  Où : menu → Mailing → onglet Envoi. **Ne rien envoyer.**
  Saisir : choisir la campagne « Découverte de la bûche compresse » ; son segment par défaut, « Tous les clients (hors Public) », se sélectionne tout seul (relevé en base : 2 605 clients ont déjà reçu cette campagne).
  Attendu : « N destinataires sur 2 863 » (N autour de 290) et, sous le choix du segment, une phrase qui dit combien ont déjà reçu cette campagne.
  Vérification : N + le nombre de la phrase = le chiffre du segment dans l'onglet Segments.

### Boutons et lisibilité

- [x] **C12. Les boutons du Mailing ont un fond.** 2026-11-22 — retour : « Oui, ils ont un fond ». Aucune remarque sur le gris des boutons secondaires.
  Où : Mailing → onglets Éditeur et Segments.
  Saisir : regarder « Nouvelle campagne », « Éditer », « Voir ».
  Attendu : « Nouvelle campagne » en bleu foncé, texte blanc ; « Éditer » et « Voir » sur fond gris clair. Plus de texte nu.
  Vérification : rien (affichage seul).

- [x] **C13. La teinte des boutons d'action.** 2026-11-22 — retour : « Oui, elle convient ». La teinte foncée (primary-700) est donc la charte retenue.
  Où : Planning (« Nouveau RDV »), menu latéral (entrée active, bouton « Créer »), une fenêtre de confirmation, la fiche d'un client.
  Saisir : regarder, survoler un bouton.
  Attendu : un seul bleu, plus foncé qu'avant, qui fonce encore au survol. Le texte blanc se lit sans effort.
  Vérification : rien (affichage seul). C'est un choix de charte : dire si la teinte convient.

- [x] **C14. Les cartes se lisent, rien n'est coupé (sur ordinateur).** 2026-11-22 — retour : trois captures d'Eric (Pipeline, Entretiens, Chantiers), sans défaut signalé.
  Où : Entretiens → Kanban ; Chantiers ; Pipeline → Kanban.
  Saisir : parcourir les colonnes, sur ordinateur. La tablette est reportée dans C19.
  Attendu : sur la carte Entretien / SAV, le numéro de contrat, la ligne du devis, « Certificat à faire » et les boutons sont plus gros qu'avant ; aucune étiquette ne passe à la ligne de travers, aucune carte de chantier n'a de texte coupé en bas.
  Vérification : lecture des trois captures. Pipeline : le mois tient dans la bande de date, rien ne déborde d'une carte. Entretiens : numéros de contrat, « Certificat à faire », « Facturé » et ses deux boutons tiennent dans la carte ; sur une seule carte visible (LENDRIN, « À planifier ») l'étiquette « Commandé » passe proprement sur une seconde ligne. Chantiers : phrase sous chaque titre de colonne lisible, les quatre repères d'une carte réceptionnée tiennent sur une ligne, aucun texte coupé en bas. Deux coupures relevées, toutes deux antérieures à ce lot (A3, A4).

### Recherche et création

- [x] **C15. La recherche trouve un client, un lead, une page.** 2026-11-22 — retour, pour le téléphone, « mail », Entrée et Échap : « Oui, tout marche ».
  Où : n'importe quelle page.
  Saisir : `Ctrl K` ; taper le nom d'un client connu, puis un numéro de téléphone, puis « rozieres », puis « mail ». Flèches, Entrée, Échap.
  Attendu : le client sous « Clients », le lead ROZIERES sous « Leads », la page Mailing sous « Pages ». Entrée ouvre la fiche ; un lead ouvre sa fiche dans le pipeline. Échap ferme.
  Vérification : rien (affichage seul).
  2026-11-22 — capture d'Eric, « rozieres » saisi depuis une fiche client : « FRANCOIS ROZIERES · CLI-03754 · 81600 Montans » sous Clients, « ROZIERES FRANCOIS · Devis envoyé · 81600 Montans · Site Web » sous Leads, la seconde ligne surlignée. Conforme à la base (un client et un lead de ce nom, lus le même jour). Le numéro de téléphone, « mail » (page Mailing), Entrée et Échap ont été confirmés ensuite par Eric.
  Rectification : le test annonçait un lead « ROZIÈRES » trouvé sans son accent ; les deux fiches s'écrivent sans accent, la capture ne prouve donc rien sur les accents (voir A5).

- [x] **C16. « Créer » ouvre la bonne fenêtre.** 2026-11-22 — retour : « Oui, les trois ». Vérifié en base juste après : 0 lead et 0 RDV créés dans les 20 minutes (dernier lead la veille à 17 h 30 UTC, dernier RDV la veille à 9 h UTC). Un client créé 18 minutes plus tôt, étranger à ce test : « TEST1 ERIC » (CLI-04071), organisation Cimaj, entré par l'import de fichier (`clients_import_batch`, journal d'audit), c'est-à-dire par la recette de l'import des clients menée en parallèle.
  Où : menu latéral, bouton « Créer », depuis l'accueil.
  Saisir : « Nouveau RDV », fermer ; « Nouveau lead », fermer ; « Nouveau client », fermer. Recharger la page après chacun.
  Attendu : la fenêtre de création s'ouvre sur la bonne page ; après rechargement elle ne se rouvre pas. Rien n'est enregistré si l'on ferme.
  Vérification : aucune ligne créée — `select count(*) from majordhome.leads where created_at > now() - interval '15 minutes'` (0 attendu).

- [x] **C17. Le lien « voir le lead » d'un mémo vocal.** 2026-11-22 — retour : « Oui, elle s'ouvre » (lien vers le lead ROZIERES FRANCOIS, `a51c893e-…`, identifiant lu en base).
  Où : adresse `/pipeline?tab=kanban&lead=<identifiant d'un lead>` (prendre celui d'un lead ouvert via C15).
  Saisir : ouvrir l'adresse.
  Attendu : la fiche du lead s'ouvre, l'adresse perd le paramètre.
  Vérification : rien (affichage seul).

### Libellés et téléphone

- [x] **C18. Les libellés corrigés.** 2026-11-22 — retour, pour Fumisterie : « Oui, c'est bon » ; les trois autres libellés lus sur les captures d'Eric.
  Où : Chantiers (haut du Kanban) ; Pipeline → Dashboard, tableau Commerciaux ; Paramètres → Webshop → Général ; Paramètres → Fumisterie.
  Saisir : lire.
  Attendu : « éléments » avec son accent ; « Écart vs oct. sur l'activité de la période. » sans double point ; plus de `site_url_missing` ; « valeurs par défaut à vérifier » à la place de « règles provisoires ».
  Vérification : rien (affichage seul). Déjà vu sur les captures de C14 (2026-11-22) : « 118 éléments » sur Chantiers, « 300 éléments » sur Entretiens. Capture d'Eric du tableau Commerciaux (2026-11-22) : « Écart vs oct. sur l'activité de la période. Les deux dernières colonnes suivent les leads reçus. », un seul point après « période ». Capture d'Eric de Paramètres → Webshop → Général (2026-11-22) : « Sans adresse, l'envoi automatique des feuilles de route échoue. », plus de `site_url_missing`. Fumisterie confirmé ensuite par Eric.

- [!] **C19. Sur téléphone et sur tablette.** 2026-11-22 — retour : « ça reste en carte illisible » (R4). Le menu, la loupe et « Créer » sur téléphone ne sont pas encore confirmés.
  Où : l'application sur le téléphone, puis sur la tablette.
  Saisir : téléphone — ouvrir le menu ; toucher la loupe du bandeau ; chercher un client ; ouvrir « Créer ». Tablette — parcourir les Kanbans Entretiens, Chantiers et Pipeline (suite de C14).
  Attendu : le menu s'ouvre avec ses groupes (ou la liste simple) ; la loupe ouvre la recherche, le clavier ne masque pas les résultats ; « Créer » se déplie dans le tiroir. Sur la tablette, aucune carte n'a de texte coupé ni de bouton qui déborde.
  Vérification : rien (affichage seul).

## Anomalies

- **R1 (2026-11-22, trouvée en préparant C5, avant le test d'Eric).** Le lieu d'un RDV ne s'affichait jamais sur l'accueil : le bloc lisait un champ `location` que la vue des RDV ne porte pas (repris de l'ancien accueil). Corrigé : code postal et ville, à défaut l'adresse (`lieuDuRdv`). Un test vérifie maintenant que le bloc ne lit que des champs existants. C5 couvre le retest.

- **R2 (2026-11-22, trouvée en relisant le code pour C10).** La correction de la pastille de l'onglet « Contrats » affichait 841 (tous les contrats non archivés) alors que la liste de cet onglet s'ouvre sur les contrats ACTIFS (490) : une incohérence de mon fait, j'avais mal lu le filtre par défaut. Corrigé : la pastille affiche les contrats actifs, quel que soit le filtre en cours. C10 couvre le retest.

- **R3 (2026-11-22, vue sur la capture de C21).** La liste des contrats clos ne se distinguait pas de celle des actifs : chaque carte portait « À faire » (un contrat clos n'a pas d'entretien à faire), et seul un bouton « Clos » légèrement grisé indiquait le filtre. Corrigé : un contrat qui n'est pas actif affiche son statut (« Clos », « En attente », « Archivé ») à la place de « À faire » ; la liste des clos commence par « 250 contrats clos. Revenir aux contrats actifs ». C10 couvre le retest.

- **R4 (2026-11-22, sur C19).** Eric : « ça reste en carte illisible ». Lu dans le code, sans capture : les colonnes d'un Kanban (`KanbanBoard`, commun à Entretiens, Chantiers, Pipeline, Contrats, Devis, Webshop) se partagent la largeur de l'écran à parts égales, sans largeur minimale (`min-w-0 flex-1 basis-0`, depuis mars 2026). Sept colonnes font donc environ 50 px chacune sur un téléphone, et environ 105 px sur la tablette (rendue en 1 024 px, menu déduit), bande de date comprise : aucun texte ne tient. Antérieur à ce lot ; grossir les textes ne pouvait pas le régler. Confirmé par la capture d'Eric du pipeline sur téléphone : six colonnes d'environ 50 px où seule la date se lit, et la barre des filtres qui sort de l'écran. Corrigé (`0ecc13b2`), sur téléphone et tablette seulement : une colonne par écran sur le téléphone (la suivante dépasse, le tableau défile au doigt et s'arrête sur chaque colonne), des colonnes de 240 px sur la tablette (trois environ) ; la barre du haut (compteur, filtres, recherche) passe à la ligne au lieu de déborder. Rien ne change sur ordinateur. Vaut pour les six Kanbans. Limite connue : glisser une carte vers une colonne hors écran n'est pas possible au doigt, les boutons de la fiche restent. Écrit sans voir l'écran : retest C23.

## Remarques et améliorations

- **A1 (2026-11-22, sur C3).** Eric : « Prospection et Cédant est à mettre dans un dossier Développement ». Fait : un groupe « Développement » (Cédants, Prospection), placé entre « Terrain » et « Marketing », replié à l'ouverture comme « Marketing » et « Études ». La place et le repli par défaut sont mon choix, à confirmer au retest C20.

- **A2 (2026-11-22, sur C10).** Eric, sur la page « Contrats » du menu : « il ne se passe rien si je clique sur la carte clos ». Les trois cartes de chiffres n'étaient que des repères. Fait : « Contrats actifs » et « Clos » sont des boutons (flèche à droite) qui ouvrent Entretiens → onglet Contrats, filtré sur ces contrats ; « En attente » reste un repère, ce sont les contrats de la page elle-même. Retest C21.

- **A3 (2026-11-22, vue sur la capture Pipeline de C14, non signalée par Eric).** L'étiquette de source d'une carte de lead est coupée : « Bouche-à-or… », « Client Exista… », « Boutique en l… ». Antérieur à ce lot (largeur limitée à 100 px, inchangée ; le nom complet est en infobulle). Accord d'Eric après le bilan (« Oui, corrige »). Corrigé (`6b05291b`) : les repères de la carte passent à la ligne, la source se lit en entier ; une carte chargée gagne une ligne. Retest C26.

- **A4 (2026-11-22, vue sur la capture Chantiers de C14, non signalée par Eric).** Le texte d'aide du champ de recherche des chantiers est coupé (« Rechercher un chantie »). Antérieur à ce lot. Corrigé (`6b05291b`) : la largeur du champ suit son texte d'aide, pour tous les Kanbans, sans dépasser l'écran. Retest C26.

- **A5 (2026-11-22, trouvée en vérifiant C15).** La recherche de CLIENTS ne passe pas les accents : « helene » trouve 19 clients sur 23, « jerome » 22 sur 28 (mesuré en base, Mayer ; 134 clients ont un accent dans leur nom). La recherche de leads, elle, les ignore (`lead_search` utilise `unaccent`). Antérieur à ce lot : c'est la recherche de clients de toute l'application (liste des clients, fenêtre de RDV), que la recherche globale réutilise. Accord d'Eric en fin de recette (« Oui, corrige »). Corrigé (`0e14a698`) : migration `20261122_3` appliquée en production et vérifiée (colonne `recherche`, sans accent, en fin de la vue des clients ; essayée d'abord dans une transaction annulée) ; la liste des clients et la recherche rapide y cherchent nom et ville. Lu en base après application : « helene » 23 clients, « jerome » 28, vue toujours modifiable et en `security_invoker`, aucun droit pour `anon`. Retest C25.

- **A6 (2026-11-22, sur C23).** Eric, sur téléphone : « la navigation n'est pas super, peut-être qu'on peut mettre des menus de manière plus "mobile" plutôt que d'adapter le site desktop ». Aujourd'hui le téléphone reprend le menu latéral de l'ordinateur dans un tiroir qu'on ouvre par le bouton en haut à gauche : deux touchers pour changer de page, bouton loin du pouce. Proposé puis accepté (« Oui, fais-la »). Fait (`73a7ad3c`) : une barre fixe en bas de l'écran, sur téléphone seulement — Accueil, Planning, « Créer » au centre, Clients, « Plus » qui ouvre le menu complet. Les pages suivent les droits (une page fermée à la personne laisse sa place à la suivante ; quatre pages quand elle ne peut rien créer). Le bandeau du haut porte le nom de l'entreprise et la loupe, le bouton de menu est parti dans la barre. Les messages (« Nouvelle version disponible ») s'affichent au-dessus de la barre. Tablette et ordinateur inchangés. Écrit sans voir l'écran : retest C24.

- **A7 (2026-11-22, sur C26).** Eric : « je veux aussi que les cartes soient de taille uniforme, c'est le plus important ». Ma correction d'A3 faisait passer les repères à la ligne : les cartes portant un bouton de devis gagnaient une ligne. Corrigé (`64c57be3`) : une seule ligne de repères, tous à leur taille ; la source prend la place qui reste et ne se coupe que si la ligne est pleine (avant A3 elle était coupée à 100 px même avec de la place). Conséquence assumée : dans « Devis envoyé », « Gagné » et « Perdu », une source longue peut encore être abrégée, le nom complet restant au survol. La hauteur uniforme prime sur la source en entier. Aucun lead ne porte de « prochaine action » (0 sur 649, lu en base), la ligne qui l'afficherait ne joue donc pas. Retest C27.

## Retest des corrections

- [x] **C22. La liste des contrats clos se reconnaît (R3).** 2026-11-22 — retour : « Oui, c'est clair ».
  Où : menu → Entretiens, après « Mettre à jour » si le site le propose.
  Saisir : cliquer l'onglet « Clos » dans la barre d'onglets ; lire le haut de la liste et une carte ; cliquer « Revenir aux contrats actifs ».
  Attendu : l'onglet Contrats s'ouvre sur la liste des clos, qui commence par « 250 contrats clos. Revenir aux contrats actifs » ; chaque carte porte « Clos » à la place de « À faire » ; le lien ramène aux contrats actifs, dont les cartes portent de nouveau « À faire » ou « Réalisé ». La pastille « Contrats » reste à 490 tout du long.
  Vérification : rien (affichage seul).

- [x] **C21. Les cartes de la page Contrats mènent à leur liste (A2).** 2026-11-22 — retour : « ça ouvre la page Entretien et SAV », avec une capture. Vérifié en base : les quatre premiers noms de la capture (ALIAS, ALOISI, AMALRIC, ANGOY) sont les quatre premiers contrats clos par ordre alphabétique, donc la carte « Clos » ouvre bien la liste des contrats clos. La même capture a fait apparaître R3 (la liste ne dit pas qu'ils sont clos). La carte « Contrats actifs » n'a pas été confirmée séparément.
  Où : menu → Contrats, après « Mettre à jour » si le site le propose.
  Saisir : cliquer la carte « Clos », revenir, cliquer la carte « Contrats actifs ».
  Attendu : « Clos » ouvre Entretiens sur l'onglet Contrats avec les 250 contrats clos ; « Contrats actifs » l'ouvre avec les 490 actifs. Les deux cartes portent une flèche à droite ; « En attente » n'en porte pas et ne réagit pas.
  Vérification : rien (affichage seul).

- [x] **C20. Le groupe « Développement » (A1).** 2026-11-22 — retour : « Oui, c'est bon » (place entre « Terrain » et « Marketing », replié à l'ouverture : confirmés).
  Où : menu latéral, compte administrateur de Mayer, après « Mettre à jour » si le site le propose.
  Saisir : regarder le menu ; déplier « Développement ».
  Attendu : « Cédants » et « Prospection » ne sont plus sous « Clients & ventes » ; ils sont dans un groupe « Développement », entre « Terrain » et « Marketing », replié à l'ouverture.
  Vérification : rien (affichage seul).

- [ ] **C23. Les Kanbans sur téléphone et tablette (R4), et le reste de C19.** _Partiel_ — 2026-11-22, Pipeline sur téléphone après « Mettre à jour » : « Oui, lisibles ». Entretiens, Chantiers, menu, loupe et « Créer » sur téléphone, le même jour : « oui ça passe mais la navigation n'est pas super » (A6). Reste la tablette. Tablette reportée : « je n'ai pas la tablette », Eric n'a que le téléphone sous la main.
  Où : l'application sur le téléphone, puis sur la tablette, après « Mettre à jour » (le site le propose en bas de l'écran).
  Saisir : téléphone — ouvrir Pipeline → Kanban, faire défiler le tableau au doigt vers la droite ; même chose sur Entretiens et Chantiers ; puis ouvrir le menu, toucher la loupe, chercher un client, ouvrir « Créer ». Tablette — parcourir les trois mêmes Kanbans.
  Attendu : téléphone — une colonne occupe presque tout l'écran, les cartes se lisent en entier (nom, étiquettes, montant), le bord de la colonne suivante dépasse à droite, le tableau s'arrête sur chaque colonne ; le compteur et les filtres passent sur plusieurs lignes sans sortir de l'écran ; le menu s'ouvre avec ses groupes, la loupe ouvre la recherche sans que le clavier masque les résultats, « Créer » se déplie. Tablette — trois colonnes environ à l'écran, lisibles, les autres en faisant défiler.
  Vérification : rien (affichage seul).

- [x] **C24. La barre du bas sur téléphone (A6).** 2026-11-22 — retour : « Oui, elle convient ».
  Où : l'application sur le téléphone, après « Mettre à jour ».
  Saisir : regarder le bas de l'écran ; toucher Planning, Clients, Accueil ; toucher « Créer » puis fermer ; toucher « Plus », ouvrir Pipeline depuis le menu ; faire défiler une longue page jusqu'en bas.
  Attendu : cinq boutons en bas (Accueil, Planning, Créer, Clients, Plus), celui de la page affichée en bleu ; « Créer » ouvre ses trois choix au-dessus de la barre ; « Plus » ouvre le menu complet et se colore quand la page affichée n'est pas dans la barre (Pipeline) ; en haut, le nom de l'entreprise et la loupe, plus de bouton de menu ; le bas d'une page n'est jamais caché par la barre ; la barre ne recouvre pas la barre d'accueil de l'iPhone.
  Vérification : rien (affichage seul).

## Bilan au 2026-11-22

- **Validés** : 21 tests sur 24 — C2 à C18, C20 à C22, C24.
- **Ouverts** :
  - C1, partiel : le planning s'ouvre bien sur la semaine à venir ; le bouton « Aujourd'hui » et la flèche de gauche ne sont pas confirmés. Ne se teste que le week-end.
  - C23, partiel : validé sur téléphone ; les Kanbans sur la tablette restent à voir (pas de tablette sous la main).
  - C19 est remplacé par C23 (anomalie R4, corrigée).
- **Anomalies** : R1 à R4, toutes corrigées et retestées, sauf R4 sur la tablette.
- **Améliorations faites pendant la recette** : A1 (groupe « Développement »), A2 (cartes de la page Contrats), A6 (barre du bas sur téléphone).
- **Remarques anciennes** : A5 (la recherche de clients ne passait pas les accents) corrigée après ce bilan, retest C25 ; A3 (étiquette de source d'un lead coupée) et A4 (texte d'aide de la recherche des chantiers coupé) corrigées après ce bilan, retest C26.
- **Non testable par un agent** : tout l'affichage ; chaque point coché l'est sur le retour d'Eric, complété d'une lecture de la base ou de ses captures quand c'était possible.
- **Dernier commit en ligne** : `73a7ad3c` (barre du bas), déploiement prêt, rattaché à `majordhome.vercel.app`.

## Après le bilan

- [x] **C25. La recherche de clients passe les accents (A5).** 2026-11-22 — retour : « Oui, elles sortent ».
  Où : `Ctrl K` (ou la loupe sur téléphone), puis menu → Clients, champ de recherche. Après « Mettre à jour ».
  Saisir : `helene`, puis `jerome`, dans la recherche globale ; `helene` dans la liste des clients.
  Attendu : des clients dont le prénom s'écrit « Hélène » ou « Jérôme » apparaissent, mêlés à ceux écrits sans accent ; la liste des clients annonce 23 résultats pour `helene` (19 avant). Taper `hélène` avec ses accents donne les mêmes fiches.
  Vérification : `select count(*) from public.majordhome_clients where org_id = '<Mayer>' and is_archived = false and recherche ilike '%helene%'` — 23 lu le 2026-11-22.

- [ ] **C26. La source d'un lead et le texte d'aide de la recherche se lisent en entier (A3, A4).** 2026-11-22 — première capture d'Eric : sources encore coupées à la même largeur qu'avant (« Bouche-à-or… » sur une carte qui a la place). Le site en ligne sert pourtant la correction (vérifié dans le fichier `Pipeline-*.js` servi : `max-w-full` et `flex-wrap` présents) : la page affichée était l'ancienne version. À refaire après un rechargement forcé. Seconde capture, page rechargée : les sources se lisent en entier, mais les cartes n'ont plus la même hauteur (bouton des devis sur une seconde ligne dans « Gagné » et « Perdu »). Eric : « je veux aussi que les cartes soient de taille uniforme, c'est le plus important » (A7).
  Où : Pipeline → Kanban, puis Chantiers, sur ordinateur, après « Mettre à jour ».
  Saisir : lire les cartes des colonnes « Devis envoyé », « Gagné » et « Perdu » ; lire le champ de recherche en haut à droite des deux écrans.
  Attendu : « Bouche-à-oreille », « Client Existant », « Boutique en ligne » en toutes lettres ; sur une carte chargée, le délai ou le bouton des devis passe sur une seconde ligne, sans rien qui déborde. « Rechercher un chantier... » et « Rechercher un lead... » en entier.
  Vérification : rien (affichage seul).

- [ ] **C27. Les cartes du pipeline ont toutes la même hauteur (A7).**
  Où : Pipeline → Kanban, sur ordinateur, après Ctrl + Maj + R.
  Saisir : parcourir les six colonnes.
  Attendu : toutes les cartes ont la même hauteur, sur deux lignes (nom et montant, puis repères) ; aucun bouton de devis sur une troisième ligne. Dans « Nouveau », « Contacté » et « RDV planifié », la source se lit en entier (« Bouche-à-oreille », « Boutique en ligne ») ; dans les trois autres colonnes elle peut être abrégée quand la ligne est pleine. Seule exception voulue : une carte « Devis envoyé » sans devis rattaché porte une ligne d'alerte « Devis à rapprocher ».
  Vérification : rien (affichage seul).
