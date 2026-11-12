# Logement MonsieurDPE sur la fiche client — conception (refonte du chantier 1)

> 2026-11-12. Remplace l'interface du chantier 1 (`2026-11-11-lien-monsieurdpe-fiche-client-design.md`), dont l'infrastructure est conservée : edge `dpe-lien`, porte partenaire MonsieurDPE, `majordhome.dpe_report_accesses`, module `dpe`. Le chantier 2 (prospection sur la base clients) reste à concevoir ; cette refonte en pose la fondation de données.

## 1. Intention

Eric a testé le chantier 1 sur une vraie fiche (client MONTOYA, Vacquiers). Constats :

- Deux blocs font le même travail : « Investiguer » (version bêta, API publique de l'ADEME, panneau à part) et « MonsieurDPE » (corpus complet). Investiguer donne pourtant des informations utiles sur le logement ; MonsieurDPE ne donne qu'un lien.
- Le rapport MonsieurDPE dans un autre onglet n'est pas exploitable tel quel : Eric veut **envoyer le PDF à son client**, pas un lien.
- Le rattachement demande trop de clics : il doit être **automatique**.
- **La marque MonsieurDPE sur le rapport envoyé est voulue** (Eric, 2026-11-12 : « c'est important »).

But : sur la fiche client, un seul bloc Logement, alimenté par le corpus MonsieurDPE, qui se rattache tout seul quand c'est sûr, affiche les informations du logement, et envoie le rapport complet en PDF au client par e-mail.

## 2. Décisions d'Eric

1. Un seul bloc : « Investiguer » disparaît en tant que bouton et panneau ; MonsieurDPE le remplace.
2. Les informations du logement s'affichent sur la fiche et sont enregistrées en base.
3. Le rattachement est automatique.
4. Le rapport complet part au client **en PDF par e-mail**, à la marque MonsieurDPE.
5. Accès illimités et journalisés (décision du chantier 1, inchangée).

## 3. Objectifs, hors-champ, échecs à éviter

**Objectifs**

1. À l'ouverture d'une fiche dont l'adresse est complète et sans DPE rattaché, le DPE du logement se rattache sans clic quand la règle du §5 le permet.
2. Sinon, l'utilisateur choisit parmi les candidats en un clic.
3. La carte du logement (§6) s'affiche sur la fiche, lue en base, sans appel réseau à l'ouverture.
4. « Envoyer le rapport » envoie au client un e-mail de l'organisation avec le PDF du rapport complet en pièce jointe.
5. Les données du logement sont stockées sous une forme filtrable (prospection à venir).

**Hors-champ**

- L'outil de prospection lui-même (chantier 2).
- Toute modification du contenu ou de la marque du rapport MonsieurDPE.
- Le rattachement en masse de toute la base (un script de rattrapage est hors de ce chantier ; le rattachement se fait à l'ouverture de chaque fiche).

**Échecs à éviter**

- **Rattacher d'office le DPE d'un autre logement** (voisin, autre appartement, ancien DPE d'un logement refait). C'est le pire défaut : la carte et le rapport envoyé au client seraient faux.
- **Écraser un numéro de DPE saisi par un humain.**
- **Envoyer un e-mail à une adresse qui n'est pas celle de la fiche**, ou un rapport sans analyse complète.
- **Un échec silencieux** : rattachement tenté et raté sans trace, envoi parti sans log, champ de la carte inventé faute de donnée.

## 4. Ce qui existe

- **Chantier 1 (en production)** : edge `dpe-lien` (`chercher`, `verifier`, `ouvrir`), `src/lib/dpeLien.js`, `ClientDpeLinkPanel.jsx`, table `majordhome.dpe_report_accesses`, module `dpe` (ouvert pour Mayer). Côté MonsieurDPE : porte `POST /api/partenaire/acces`, table `dpe.acces_partenaire`, rapport complet sans entreprises RGE pour un accès partenaire (page ET PDF).
- **PDF du rapport complet** : `GET https://monsieurdpe.fr/api/pdf/rapport-complet?numero={n}&acces={jeton}` (dépôt `C:\Dev\DPE`, `site/app/api/pdf/rapport-complet/route.ts`, `maxDuration = 60`). Même contrôle d'accès que la page. Aucune modification attendue côté MonsieurDPE.
- **Corpus** : `GET /dossier-batiment?adresse=` (DPE rattachés au bâtiment par la clé BAN, via la BDNB ; rend `adresse.cle_ban`, `adresse.libelle`, et par DPE `identifiant_dpe`, `date_etablissement_dpe`, `etiquette_dpe`, `surface_habitable_logement`, `type_batiment`, `fiabilite_geocodage`) et `GET /dossier/{numero}` (en-tête `dossier` : énergie et générateur de chauffage, émission, SCOP, ECS, ventilation, consommations, coûts par usage, qualités d'isolation par poste, confort d'été, période de construction, méthode d'application, validité… ; `composants` paroi par paroi ; `saisie`).
- **Investiguer** (`ClientInvestigationPanel.jsx`, `src/lib/dpeApi.js`, `dpeReportModel.js`, `dpeSyntheseExport.js`) : carte du DPE, « Renseigner la fiche » (surface, type, n°), équipements à recenser (`buildEquipmentDrafts`), synthèse PDF Mayer, recherche dans le voisinage avec carte. Règle `memeAdresseQueLaFiche` corrigée le 2026-11-12.
- **Envoi d'un document par e-mail** : edge `invoice-send` (Resend, `_shared/mail.ts`, gabarit transactionnel `mail_campaigns`, trace `mailing_logs`, gate `settings.modules.communication`, codes d'erreur traduits côté front).

**Mesures disponibles** (50 clients Mayer, 2026-11-11) : 84 % d'adresses géocodées, 62 % de bâtiments trouvés, 22 % avec au moins un DPE ; parmi ceux-là, 8 sur 11 avec un seul DPE.

## 5. Le rattachement automatique

**Quand** : à l'ouverture de la fiche, si le module `dpe` est ouvert, l'adresse est complète, aucun DPE n'est rattaché, et aucune tentative n'a eu lieu depuis le dernier changement d'adresse. Le résultat de chaque tentative est enregistré (y compris « aucun DPE ») pour ne pas rappeler le corpus à chaque ouverture.

**Données de la règle** : l'edge géocode elle-même l'adresse du client (même service que le corpus, `data.geopf.fr/geocodage/search`), ce qui lui donne le score et la clé BAN, puis interroge le corpus par `cle_ban`. Aucune modification du corpus. Quand il n'y a qu'un candidat, elle lit `/dossier/{numero}` (appel nécessaire de toute façon pour remplir la carte), qui porte la méthode d'application.

**Règle** — automatique seulement si TOUT est vrai :

1. Le bâtiment à l'adresse porte **exactement un** DPE dans le corpus.
2. Le géocodage de l'adresse du client est au numéro (`housenumber`) avec un score ≥ 0,8.
3. Le rattachement BDNB de ce DPE est « très fiable » ou « fiable » (`fiabilite_geocodage`).
4. Le DPE est celui d'une **maison individuelle** (neuf RT2012 / RE2020 compris) : le seul DPE d'un immeuble peut être celui d'un autre appartement à la même adresse.
5. La clé BAN propre au DPE (`identifiant_ban` du fichier ADEME) est **celle de la fiche** : un groupe de bâtiments BDNB couvre parfois plusieurs adresses voisines.

**Mesure (2026-11-12, toute la base Mayer, 3 493 clients)** : 835 adresses reconnues seulement à la rue ou au lieu-dit (pas de bâtiment identifiable, « adresse non reconnue au numéro près »), 431 bâtiments à DPE unique, **263 rattachés d'office, aucun mauvais connu**. Sans la condition 5, 6 mauvais sur 281 (17 / 15 Côte du Tarn, 49 / 49 bis, 384 / 398…). La condition 5 renvoie en « à confirmer » 5 bons cas (écarts de version de la BAN, géocodage ADEME approximatif) et les 7 DPE neufs absents du fichier ADEME.

Tout le reste (plusieurs DPE, une condition douteuse) produit des **candidats proposés**, choisis en un clic. Aucun candidat n'est présélectionné.

**Jamais** : écraser un `dpe_number` posé par un humain ; rattacher un DPE trouvé dans le voisinage.

**Défaire** : « Ce n'est pas le bon » retire le rattachement automatique et le note pour que la tentative suivante ne repose pas le même numéro.

**Origine visible** : la carte dit si le DPE a été rattaché automatiquement ou choisi par quelqu'un.

**Saisie à la main** : un numéro tapé dans le champ « N° DPE ADEME » et enregistré devient l'origine `saisi` ; il remplace toute valeur précédente et la carte se relit pour ce numéro. Le panneau détecte l'écart entre `clients.dpe_number` et `client_dpe` et appelle l'edge pour se réaligner (pas de trigger).

**Changement d'adresse** : un DPE d'origine `auto` est détaché et la tentative rejouée ; un DPE `choisi` ou `saisi` est conservé mais signalé « adresse modifiée depuis le rattachement, à vérifier ».

**Voisinage** : un DPE trouvé dans la recherche de voisinage peut être rattaché À LA MAIN (origine `choisi`, mention « trouvé dans le voisinage » conservée sur la carte), jamais automatiquement.

## 6. La carte du logement

Reprend le contenu de la carte d'Investiguer, alimentée par le corpus :

- étiquettes énergie et climat, surface, type de logement, période de construction, date et validité du DPE ;
- chauffage (générateur, énergie, émetteurs), eau chaude, froid, ventilation, consommation ;
- qualité d'isolation par poste (murs, menuiseries, toiture, planchers, enveloppe) ;
- où part la chaleur (répartition des déperditions) ;
- coût annuel par usage ;
- équipements à recenser (boutons qui ouvrent la création d'équipement pré-remplie, comme aujourd'hui) ;
- « Renseigner la fiche » (surface, type) quand ces champs sont vides.

**Source unique : le corpus.** La carte ne lit plus l'API publique de l'ADEME. Le corpus porte tout le nécessaire, vérifié le 2026-11-12 dans `corpus/dossier.py` : générateur et énergie de chauffage (même libellé ADEME, dont l'âge se lit comme aujourd'hui), ECS, ventilation, coûts par usage, qualités d'isolation, et les huit postes de déperdition publiés par l'ADEME (`deperdition_mur`, `_baie_vitree`, `_porte`, `_plancher_bas`, `_plancher_haut`, `_pont_thermique`, `_renouvellement_air`, `_enveloppe`). Les fonctions de mise en forme de `dpeApi.js` / `dpeReportModel.js` sont reprises sur les noms de colonnes du corpus ; ce qui ne sert plus est supprimé.

**Règle** : un champ que le corpus ne fournit pas est absent de la carte, jamais deviné ni repris d'une autre source. Chaque champ de la carte cite sa colonne du corpus dans le module de correspondance (test). Le piège d'échelle immeuble du corpus (besoins et déperditions de l'immeuble entier sur un appartement dérivé) s'applique : pour ces dossiers, la répartition des déperditions n'est pas affichée.

**Fraîcheur** : la carte affiche la date de lecture du corpus et propose « Mettre à jour ». Elle se relit seule quand le numéro de DPE change.

## 7. Stockage

Une ligne par client dans une nouvelle table `majordhome.client_dpe` (org CORE, RLS org, lecture tout membre, écriture par l'edge function seule) :

- le numéro rattaché, son origine (`auto` | `choisi` | `saisi`), qui et quand ;
- l'état de la dernière tentative (`rattache` | `candidats` | `aucun_dpe` | `adresse_non_trouvee` | `erreur`), l'adresse tentée, la date, les numéros écartés par « Ce n'est pas le bon » ;
- les champs filtrables en colonnes typées (au minimum : étiquette énergie, étiquette climat, énergie de chauffage, type de générateur, surface, période de construction, date du DPE, rapport complet disponible) ;
- le reste de la carte en `jsonb`, avec la version du module de correspondance et la date de lecture.

`clients.dpe_number` reste la valeur affichée dans le champ du formulaire et l'entrée de l'edge `ouvrir` ; il est tenu cohérent avec `client_dpe`.

## 8. Envoyer le rapport au client

- Bouton « Envoyer le rapport au client » sur la carte, à côté de « Analyse MonsieurDPE » et « Copier le lien ».
- Visible seulement si le module Communication est ouvert. Grisé avec la raison si : pas d'e-mail sur la fiche, pas de rapport complet pour ce DPE, expéditeur de l'organisation non configuré.
- Une fenêtre de confirmation montre le destinataire (l'e-mail de la fiche, non modifiable) et l'objet.
- L'edge émet l'accès s'il n'existe pas, télécharge le PDF depuis MonsieurDPE, l'attache, envoie par Resend avec le gabarit transactionnel `rapport_dpe` de l'organisation (créé d'un clic dans Settings → Communication → Emails, éditable dans Mailing, comme `facture_entretien`), et trace l'envoi dans `mailing_logs`.
- Le corps du mail peut contenir aussi le lien du rapport.
- Échec du téléchargement ou de l'envoi : message clair, rien n'est marqué comme envoyé.

## 9. Retrait d'Investiguer

- Le bouton « Investiguer » et son panneau quittent la fiche.
- La recherche dans le voisinage (carte, rayons) reste disponible depuis le bloc Logement, en repli quand le corpus ne trouve rien à l'adresse. Un DPE voisin ne se rattache jamais tout seul.
- Le code qui ne sert plus est supprimé dans le même chantier (règle « code mort » du dépôt).

## 10. Première étape : mesurer avant de fixer les seuils

Avant d'activer le rattachement automatique, mesurer sur 200 clients Mayer (lecture seule, agrégats seulement) :

- la répartition du score de géocodage et de `fiabilite_geocodage` ;
- pour les cas à un seul DPE, la concordance entre l'adresse du client et l'adresse du DPE, vérifiée par la règle `memeAdresseQueLaFiche` sur l'adresse brute ADEME (API publique) ou à la main sur un échantillon de 20 ;
- les seuils retenus et la part de clients rattachés automatiquement.

Les seuils sont des constantes nommées, justifiées par la mesure dans un commentaire. Le résultat est rapporté à Eric au fil de l'eau ; la réalisation continue avec ces seuils, SAUF si la vérification manuelle trouve un seul rattachement automatique faux, ou si la part de rattachements automatiques parmi les clients ayant un DPE tombe sous la moitié : arrêt et arbitrage d'Eric. Environ 200 appels au corpus et à l'API publique de l'ADEME, lecture seule, agrégats seulement, aucune adresse écrite.

## 11. Choix faits par le rédacteur (à vérifier par Eric)

- **La synthèse PDF à la marque Mayer d'Investiguer disparaît** : le rapport MonsieurDPE la remplace.
- **Rattachement à l'ouverture de la fiche, pas en masse** : une fiche jamais ouverte n'a pas de DPE. Le chantier 2 décidera s'il faut un rattrapage de toute la base.
- **Droits** : rattacher, choisir, défaire et mettre à jour demandent `clients.edit` ; voir la carte, tout membre ; envoyer le rapport, `clients.edit` (pas de nouvelle ressource).
- **L'envoi exige le module Communication**, comme les factures.
- **Géocodage fait par l'edge**, pas par le corpus : aucune modification du dépôt MonsieurDPE dans ce chantier.
- **Numéro tapé à la main = origine `saisi`**, il remplace toute valeur ; un rattachement `auto` est détaché si l'adresse change, un `choisi` / `saisi` est conservé et signalé.
- **Un DPE du voisinage peut être rattaché à la main**, jamais automatiquement.
- **La carte ne lit que le corpus** : l'API publique de l'ADEME ne sert plus qu'à la recherche de voisinage et à la mesure.
- **La mesure ne bloque pas** la réalisation, sauf rattachement faux observé ou taux automatique sous la moitié.
- **Reprise de l'existant** : un seul client porte un numéro en production (MONTOYA, posé par le chantier 1) ; il reçoit l'origine `choisi`.

## 12. Critères de réussite

- Sur la fiche FRAYSSINET (un seul DPE, adresse concordante) : à la première ouverture, le DPE se rattache sans clic et la carte s'affiche.
- Sur une fiche à plusieurs DPE : candidats proposés, rien de rattaché.
- Une fiche avec un numéro saisi à la main n'est jamais modifiée.
- « Ce n'est pas le bon » retire le DPE et il n'est pas reposé à la tentative suivante.
- La seconde ouverture de la fiche n'appelle pas le corpus.
- « Envoyer le rapport » : le client reçoit un e-mail de l'organisation avec le PDF MonsieurDPE ; une ligne `mailing_logs` existe.
- Plus de bouton « Investiguer » ; la recherche dans le voisinage reste accessible quand le corpus ne trouve rien.
