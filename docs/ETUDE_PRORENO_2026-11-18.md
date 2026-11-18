# Étude Pro'Réno — ce que nous pouvons reprendre pour les PDF, rapports et autocontrôles

Date : 2026-11-18. Étude seule : aucun code modifié, aucune migration, aucun déploiement.

## 1. L'essentiel

- **Pro'Réno (proreno.fr) est le site de l'Agence Qualité Construction (AQC)**, qui publie les documents du programme PROFEEL, financé par les certificats d'économie d'énergie. Tout est gratuit et lisible sans compte.
- **Quatre familles de documents nous concernent directement** : les fiches d'autocontrôle (une par type d'équipement, 39 à 78 points de contrôle en cinq étapes), les procès-verbaux de réception (un par type d'équipement, avec le PV de levée des réserves), les attestations d'entretien réglementaires (chaudières, pompes à chaleur et climatiseurs) et les attestations d'essais de fonctionnement.
- **Droits : le site interdit toute reprise sans accord écrit de l'AQC**, lien hypertexte compris. Seules les attestations d'entretien portent une autorisation écrite d'usage et d'adaptation par les entreprises. Pour le reste, rien n'est écrit : il faut demander à l'AQC, d'autant que Majord'home a vocation à être vendu à d'autres entreprises.
- **Ce qui vaut la peine**, dans l'ordre : compléter notre PV de réception (points de réception par équipement, délai et levée des réserves), aligner le certificat d'entretien des pompes à chaleur, climatiseurs et chaudières sur le contenu réglementaire, créer une fiche courte de mise en service, vérifier une fois les mentions de nos devis.
- **Ce qui ne vaut pas la peine** : reprendre les fiches d'autocontrôle entières dans l'application. Les techniciens ne remplissent déjà pas trois cases de PV ; ils ne rempliront pas 61 points.
- **Rien sur le photovoltaïque posé en surimposition côté autocontrôle, rien sur les bornes de recharge, rien sur le ramonage, rien de propre aux inserts.** Pour ces sujets, Pro'Réno n'est pas la source.

## 2. Méthode et limites

- Lecture du `robots.txt` (seules les pages de collection listées et les fiches `/documents/…` ont été lues ; les pages de résultats interdites ne l'ont pas été), des mentions légales et des conditions générales d'utilisation.
- Inventaire tiré du plan du site (`sitemap.xml`, 1 038 fiches documents).
- **13 PDF téléchargés** par le bouton « Télécharger » du site (serveur `media.proreno.fr`) : 7 lus en entier, 5 seulement parcourus (en-tête, étapes, nombre de points, mentions de droits), 1 non ouvert (« Installer un climatiseur », connu par sa page). Chaque partie du 3 dit ce qui a été lu. 14 pages descriptives lues. Les autres documents sont décrits d'après leur titre et leur page de présentation : je ne les ai pas ouverts.
- Aucun compte créé, aucun formulaire envoyé. **Check'Réno, PAC'Réno et Conduits'Réno n'ont donc pas été essayés** : ce que j'en dis vient de leur page de présentation.
- Les fichiers téléchargés sont dans le dossier temporaire de la session, pas dans le dépôt.
- Je ne suis pas juriste : la partie « droits » rapporte ce que les textes disent, avec leur source. La lecture qui en découle est la mienne.
- Les textes réglementaires cités (arrêtés, code de l'environnement) sont rapportés tels que l'AQC les reproduit dans ses documents. **Je ne les ai pas relus sur Légifrance.**

## 3. Inventaire

Adresse d'une fiche : `https://www.proreno.fr/documents/<nom>`. La colonne « Nom » donne la fin de l'adresse.

### 3.1 Fiches d'autocontrôle PROFEEL

46 fiches dans le plan du site (la page de présentation en annonce 49). Format : PDF simple à imprimer, **non remplissable** à l'écran (aucun champ de formulaire), avec un emplacement « logo entreprise ». Les pages web affichent « Publié le 01/06/2021 », mais les fichiers lus ont été régénérés entre le 06/10/2025 et le 27/11/2025 : c'est une version récente.

Structure commune, lue en entier sur deux fiches (poêle à granulés, pompe à chaleur air / air) et retrouvée sur les trois autres parcourues :

1. En-tête : entreprise, client, adresse, référence du devis, dates de début et de fin, deux intervenants.
2. Cinq étapes : conception et dimensionnement, préparation de chantier, travaux, mise au point et mise en service, réception.
3. Pour chaque point, trois cases : conforme, non conforme ou non vérifiable, sans objet. Un bloc de commentaires numérotés par étape.
4. Un repère « RGE » sur les points qui valent non-conformité dans les grilles d'audit RGE. Sur la fiche poêle à granulés, 12 des 14 points de conception le portent.

Fiches utiles à Mayer :

| Équipement | Nom | Pages | Points | Lu |
|---|---|---|---|---|
| Poêle à granulés sur conduit de fumée | `fiche-autocontrole-poele-granules` | 5 | 61 | oui |
| Poêle à bûches classique | `fiche-autocontrole-poele-a-buches-classique` | 5 | 54 | parcouru |
| Poêle à granulés étanche (type C) | `fiche-autocontrole-poele-granules-de-type-c` | 4 | non compté | non |
| Poêles avec bouilleur (bûches, granulés, granulés type C) | `fiche-autocontrole-poele-a-buches-avec-bouilleur`, `…-poele-granules-avec-bouilleur`, `…-poele-granules-avec-bouilleur-de-type-c` | 7 pour le granulés | non compté | non |
| Pompe à chaleur air / air (donc climatisation réversible) | `fiche-autocontrole-pompe-a-chaleur-air-air` | 6 | 78 | oui |
| Pompe à chaleur air / eau | `fiche-autocontrole-pompe-a-chaleur-air-eau` | 6 | 75 | parcouru |
| Pompe à chaleur eau / eau | `fiche-autocontrole-pompe-a-chaleur-eau-eau` | — | — | non |
| Chauffe-eau thermodynamique (cinq variantes) | `fiche-autocontrole-cet-sur-air-exterieur-monobloc` et quatre autres | 4 | 39 | parcouru (monobloc) |
| Chauffe-eau électrique, chauffe-eau gaz, chauffe-eau solaire | `fiche-autocontrole-chauffe-eau-electrique`, etc. | — | — | non |
| Chaudières bûches et granulés (chauffage seul, chauffage et eau chaude) | `fiche-autocontrole-chaudiere-granules-chauffage-ecs`, etc. | — | — | non |
| Chaudières gaz (huit variantes) | `fiche-autocontrole-chaudiere-gaz-appareil-type-c-chauffage-ecs`, etc. | — | — | non |
| Ventilation (simple et double flux, répartie) | `fiche-autocontrole-vmc-simple-flux-et-double-flux`, `…-ventilation-mecanique-repartie-vmr` | — | — | non |
| Devis et factures | `fiche-autocontrole-devis-factures` | 5 | 25 mentions | oui |

Ce que contient la fiche poêle à granulés, résumé :

- **Conception (14 points)** : note de calcul des déperditions, plancher compatible, diagnostic du conduit existant s'il est réutilisé, compatibilité des conduits avec les fumées, amenée d'air et sa section, distance du débouché au faîtage, note de calcul de la fumisterie.
- **Préparation (3)** : cuve fioul neutralisée, local et dégagements conformes à la notice.
- **Travaux (31)** : prise d'air, distances de sécurité aux matériaux combustibles, té et tampon, pente et longueur du raccordement, coudes, traversées de plancher, coffrage en volume habitable, tubage (aération de l'espace annulaire), protections électriques.
- **Mise en service (7)** : test d'étanchéité du conduit, tirage, calibrage de l'alimentation en granulés, réglage de l'extracteur, plaque signalétique du conduit.
- **Réception (6)** : notice en français, différentiel 30 mA, rapport de mise en service remis, consignes d'usage (démonstration, combustible, amenée d'air), consignes d'entretien.

La fiche pompe à chaleur air / air ajoute ce que nous ne suivons nulle part pour une pose : support et plots, évacuation des condensats, réseau aéraulique, liaisons frigorifiques, étiquette de fluide, attestation d'aptitude de l'intervenant, CERFA 15497, contrôle d'étanchéité à l'azote, tirage au vide, protections électriques (courbes de disjoncteur, terre), réglage du régulateur.

**La fiche Devis et factures** est différente : version 1.0 de décembre 2023, PDF remplissable (59 champs), 25 mentions obligatoires marquées « devis » ou « facture », les mentions liées aux aides et à la qualification de chantier, deux exemples de clause de confidentialité, et un modèle de devis annoté.

### 3.2 Procès-verbaux de réception PROFEEL

28 fiches. PDF simple de 6 pages, non remplissable, régénéré en octobre et novembre 2025 (page web : « Publié le 01/02/2021 »). Un lu en entier (poêle à granulés), un lu pour ses points de réception (pompe à chaleur air / air).

Structure commune :

1. **PV de réception** : le client déclare, pour le devis n° … du …, que la réception est prononcée sans réserve, avec réserves (avec un **délai de levée négocié**), ou **refusée ou différée** avec ses motifs. Lieu, date, deux signatures.
2. **Rappel des trois garanties** (parfait achèvement 1 an, bon fonctionnement 2 ans, décennale 10 ans) et du rôle de la date de réception.
3. **Points de réception propres à l'équipement**, chacun avec oui, non, sans objet et un commentaire, et la façon de le constater (document remis, constat visuel, explication orale).
4. **Devoir de conseil** : consignes d'usage et d'entretien données au client.
5. **Page de réserves numérotées** : réserve du client, commentaire de l'entreprise, délai global.
6. **PV de levée des réserves**, à signer quand les reprises sont faites.

Points de réception relevés :

- **Poêle à granulés** (3 points) : notice en français remise, différentiel 30 mA présent, rapport de mise en service remis. Plus les consignes : démonstration de l'allumage, granulés certifiés, amenée d'air à ne pas modifier, entretien.
- **Pompe à chaleur air / air** (6 points) : notices remises, dimensionnement expliqué au regard des besoins, schéma ou repérage des unités, différentiel 30 mA, plaque indiquant la quantité et la nature du fluide, mise en service effectuée.

PV existants pour nos métiers : `fiche-pv-reception-travaux-poele-a-buches`, `…-poele-a-granules-bois`, `…-pompe-a-chaleur-pac-air-air-1`, `…-pompe-a-chaleur-pac-air-eau`, `…-pompe-a-chaleur-pac-eau-eau`, `…-chaudiere-a-buches`, `…-chaudiere-a-granules-bois`, `…-chaudiere-gaz`, `…-chaudiere-hybride`, `…-chauffe-eau-electrique`, `…-chauffe-eau-gaz`, `…-chauffe-eau-solaire-individuel-cesi`, `…-systeme-solaire-combine-ssc`, `…-vmc-simple-flux`, `…-ventilation-mecanique-repartie-vmr`, `fiche-de-reception-chauffe-eau-thermodynamique`, `fiche-de-reception-vmc-double-flux`.

### 3.3 Attestations d'entretien PROFEEL (réglementaires)

6 modèles publiés les 7 et 9 octobre 2025, PDF simple de 5 ou 6 pages, avec emplacement « logo entreprise ». Deux lus en entier.

| Modèle | Nom | Texte de référence cité |
|---|---|---|
| Installation thermodynamique de 4 à 70 kW (pompes à chaleur, climatiseurs) | `attestation-entretien-installation-thermodynamique` | arrêté du 24 juillet 2020 modifié, annexe 3 ; article R224-44-4 du code de l'environnement |
| Chaudière bois de 4 à 400 kW | `attestation-entretien-chaudiere-bois` | arrêté du 15 septembre 2009 modifié, annexe 5 ; article R224-41-8 |
| Chaudière gaz, chaudière fioul | `attestation-entretien-chaudiere-gaz`, `…-chaudiere-fioul` | idem (non lus) |
| Pompe à chaleur hybride gaz, hybride fioul | `attestation-entretien-pac-hybride-gaz`, `…-pac-hybride-fioul` | non lus |

Les deux guides associés : `entretien-installation-thermodynamique-4kW-70kW` et `entretien-chaudiere-4kW-400kW` (guides datés du 30 mai 2025 dans les attestations, mis en ligne en octobre 2025). Non lus.

Ce que dit le modèle, et qui nous engage : **l'attestation doit être établie dans les quinze jours** suivant la visite et remise au commanditaire ; elle peut l'être sous forme dématérialisée ; il en faut une par système entretenu.

Rubriques du modèle « installation thermodynamique » (trois pages utiles) :

1. **Distribution et régulation** : embouement, purge, pression du réseau, circulateurs, filtre, vase d'expansion, isolation des réseaux hors volume chauffé ; état des gaines et du ventilateur pour une distribution par air ; présence d'une régulation par pièce, d'une programmation horaire, d'un régulateur de classe IV au moins ; sondes, température de départ, robinets thermostatiques, cohérence des horaires. Trois états : validé, non validé, sans objet.
2. **Générateur** : identification (unité extérieure et unités intérieures, numéro de série, puissance, fluide, charge) ; relevé des températures des unités intérieure et extérieure en mode chauffage et en mode refroidissement ; inversion de cycle ; enclenchement des appoints ; tension à l'arrêt et en fonctionnement ; **appareils de mesure utilisés** ; nettoyage de l'échangeur extérieur, nettoyage et désinfection de l'unité intérieure et du filtre ; voyant de fluide et pressions du compresseur.
3. **Défauts corrigés, conseils et recommandations** (bon usage, améliorations possibles), date de la visite, signature de l'intervenant et du commanditaire.

Le modèle « chaudière bois » ajoute : contrôle du conduit d'évacuation, état des joints, nettoyage du corps de chauffe et décendrage, alimentation automatique, sécurités ; **mesure du monoxyde de carbone à proximité de l'appareil avec trois seuils** (moins de 10 ppm, de 10 à 50, 50 et plus) ; température des fumées, teneurs en CO2 et O2, rendement évalué face à un rendement de référence, poussières et composés organiques volatils.

### 3.4 Attestations d'essais de fonctionnement (AQC)

12 fiches, marquées « © AQC • 01-2023 », en ligne depuis décembre 2023, qui remplacent les anciennes fiches COPREC. **PDF remplissable** (93 champs), 5 pages : mode d'emploi, liste des essais, fiche de saisie (équipement, localisation, essai satisfaisant, observations), attestation de réalisation signée.

Une lue en entier : pompe à chaleur air / air (`pompe-a-chaleur-airair-attestation-dessais-de-fonctionnement`) ; une parcourue : chaudière bois, de même structure. Pour la pompe à chaleur air / air, dix essais : sécurités, tensions, étanchéité et remplissage du circuit, sens de rotation du ventilateur, dégivrage, points de fonctionnement du cycle, relèves, évacuation des condensats, inversion de cycle, enclenchement et coupure du compresseur selon la consigne. Appareils requis : thermomètre, anémomètre, multimètre.

Les autres : pompe à chaleur air / eau, chaudière gaz, chaufferie collective, sous-station, radiateurs, plancher chauffant, réseaux hydrauliques, réseaux aérauliques, ventilation simple flux et double flux. Elles visent plutôt le petit collectif et le tertiaire.

### 3.5 Calepins de chantier, recommandations, guides

- **Calepins de chantier** (32 au total, PDF et livre numérique) : appareils de chauffage divisé à granulés (72 pages, décembre 2017, programme PACTE : types d'appareils, amenée d'air, zones 1 à 3 d'évacuation, tubage, traversées, références aux NF DTU 24.1 et 24.2) ; à bûches ; pompes à chaleur air / air, air / eau, double service, géothermiques ; chauffe-eau thermodynamique ; ventilation ; **systèmes photovoltaïques par modules rigides intégrés en couverture**. Un seul survolé (granulés, page de présentation).
- **Recommandations professionnelles RAGE** : pour les appareils à bûches et à granulés, trois volumes chacun (conception et dimensionnement, installation et mise en service, entretien et maintenance). Non lues.
- **Photovoltaïque** : guide de mise en œuvre en surimposition (janvier 2021), guide des installations en autoconsommation (juin 2019), une webconférence sur les risques et l'assurance. Aucune fiche d'autocontrôle ni PV de réception.
- **Climatisation** : la seule fiche « Installer un climatiseur » vient de la DRAC Occitanie (2016) et traite de l'insertion sur les bâtiments patrimoniaux de Toulouse. Sans rapport avec nos besoins.
- **Bornes de recharge, ramonage, inserts** : rien trouvé dans le plan du site.

### 3.6 Outils en ligne

| Outil | Ce qu'il fait d'après sa page | Accès |
|---|---|---|
| **Check'Réno** (`checkreno`) | Listes d'autocontrôle par lot, modifiables, création de ses propres listes ; réception avec le client, **génération et signature d'un PV de réception** | Application web gratuite. Compte probablement requis : non vérifié |
| **Conduits'Réno** (`conduitsreno`) | Dimensionnement simplifié d'un conduit de fumée en douze étapes (bois et gaz, conduit maçonné, métallique, tubage) ; **audit technique du local et du conduit existant** ; audit réglementaire d'un conduit | Application mobile Android et iOS, éditée par l'AQC |
| **PAC'Réno** (`pacreno-dimensionnement-de-pac`) | Dimensionnement de pompes à chaleur en maison individuelle, déperditions pièce par pièce ou simplifiées, rapport détaillé | Inscription sur pacreno.fr |
| Score Réno, « mes aides réno », schémathèques | Impact carbone, estimation des aides, schémas hydrauliques types | Non regardés |

## 4. Droits de réutilisation

### 4.1 Ce que disent le site et les documents

**Éditeur** : l'Agence Qualité Construction, association loi 1901, secrétariat technique du programme PROFEEL 2 (mentions légales). Contact donné pour toute réutilisation : contact@qualiteconstruction.com.

**Conditions générales d'utilisation, article « Propriété intellectuelle »** :

- reproduction, adaptation, modification et incorporation sont interdites sans autorisation écrite préalable de l'AQC ;
- le site ne confère aucun droit « autre que celui de consulter le Site » ;
- les droits de reproduction sont réservés, « y compris pour les documents téléchargeables ».

**Article « Obligations générales »** : l'utilisateur s'interdit de reproduire ou d'utiliser toute donnée appartenant à l'AQC ou à un tiers « dans le cadre d'un usage commercial ».

**Article « Liens hypertextes »** (et mentions légales) : un lien vers le site demande une autorisation préalable et écrite de l'AQC.

**À l'intérieur des documents**, les mentions diffèrent :

- **Attestations d'entretien** (les deux lues, et la page web de l'une) : ces documents « peuvent être photocopiés pour être utilisés tel quel ou être adaptés par chaque entreprise ». C'est la seule autorisation écrite que j'ai trouvée.
- **Attestations d'essais** : « © AQC », et une phrase qui admet qu'une entreprise utilise son propre document interne si elle en respecte le contenu.
- **Fiches d'autocontrôle et PV de réception** : aucune mention de droits dans le PDF. Un emplacement « logo entreprise » montre qu'ils sont faits pour être utilisés par l'entreprise ; la page web de la fiche poêle à granulés invite à adapter la liste à ses besoins. Rien sur une reprise dans un logiciel.
- **Fiche Devis et factures** : aucune mention de droits.

### 4.2 Ce que j'en conclus, famille par famille

| Usage | Attestations d'entretien | Fiches d'autocontrôle et PV de réception | Attestations d'essais | Guides, calepins |
|---|---|---|---|---|
| Mayer imprime et remplit le PDF tel quel | **Autorisé par écrit** | Usage prévu par le document (logo entreprise), non écrit comme une licence | Usage prévu (« à remettre au demandeur ») | Consultation |
| Joindre le PDF tel quel au dossier d'un client | Autorisé (c'est son objet) | Probable, non écrit | Probable, non écrit | **Non écrit : à demander** |
| Mettre un lien vers Pro'Réno dans l'application | **Autorisation écrite exigée** par les conditions générales | idem | idem | idem |
| Reprendre la structure et le contenu dans nos gabarits | **Autorisé pour une entreprise** (« adaptés par chaque entreprise ») | **Non écrit : à demander** | Toléré si le contenu est respecté ; la portée n'est pas précisée | À demander |
| Reproduire le texte mot pour mot dans Majord'home, vendu à d'autres | **À demander** : l'autorisation vise « chaque entreprise », pas un éditeur de logiciel | **À demander** (les conditions générales l'interdisent sans accord) | **À demander** | **À demander** |

Trois précisions, qui sont ma lecture et non un avis juridique :

1. **Le contenu réglementaire n'appartient pas à l'AQC.** Les points obligatoires d'une attestation d'entretien viennent des arrêtés ; les mentions obligatoires d'un devis viennent de la loi ; les trois garanties viennent du code civil. Nous pouvons bâtir nos gabarits **à partir des textes officiels eux-mêmes**, sans rien devoir à personne. C'est la voie la plus sûre pour la recommandation n° 2.
2. **Une idée d'organisation ne se protège pas, une rédaction si.** Découper un contrôle en cinq étapes ou proposer trois états par point est libre. La liste rédigée des 61 points d'une fiche est une œuvre de l'AQC : la recopier demande son accord.
3. **Majord'home n'est pas « une entreprise qui adapte un modèle ».** Tant que l'outil ne sert que Mayer, on est proche de l'usage prévu. Dès qu'il est vendu à d'autres artisans, c'est une exploitation commerciale par un éditeur, que les conditions générales interdisent sans accord. Si nous voulons du texte PROFEEL dans l'application, il faut l'accord écrit avant, pas après.

### 4.3 Question à poser à l'AQC

Un seul message à contact@qualiteconstruction.com suffit, à peu près ainsi : « Nous éditons un logiciel de gestion pour installateurs. Pouvons-nous y reprendre, en citant PROFEEL et l'AQC, les points des fiches d'autocontrôle et des PV de réception, et sous quelles conditions (mention de source, mise à jour, usage par nos clients) ? Pouvons-nous y placer des liens vers les fiches Pro'Réno ? » PROFEEL est financé pour diffuser ces contenus : un accord est plausible, mais je ne peux pas le présumer.

## 5. Rapprochement avec Majord'home

### 5.1 PV de réception de chantier

Ce que nous avons (`PvReceptionPDF.jsx`, `src/lib/pvReception.js`, page publique `/pv/:token`) : référence et date, entreprise et client, objet des travaux, montant HT facultatif, réception sans réserve ou avec réserves (nature, travaux à exécuter), trois cases « le client reconnaît avoir reçu » (informations de fonctionnement, notices en français, informations d'entretien), lieu, signatures, note « à conserver 10 ans ».

| Élément du PV PROFEEL | Chez nous | Écart |
|---|---|---|
| Numéro et date du devis | Référence du PV seulement | Le PV ne cite pas le marché qu'il clôt |
| Réception refusée ou différée, avec motifs | Absent | Le client mécontent n'a que « avec réserves » |
| Délai de levée des réserves, convenu | Absent (« travaux à exécuter » en texte libre) | Aucune date d'engagement |
| Réserves numérotées, avec réponse de l'entreprise | Un seul texte | Suivi réserve par réserve impossible |
| **PV de levée des réserves** | **Absent** (aucune trace dans le code ni dans la spécification du 17 novembre) | Un chantier réceptionné avec réserves n'a pas de document de clôture |
| Points de réception propres à l'équipement | Trois cases identiques pour tout | Rien sur le différentiel, la plaque de fluide, le rapport de mise en service, la démonstration |
| Rappel des trois garanties | Une phrase | Pédagogie, utile au client, pas indispensable |

Point d'attention : la fiche PROFEEL précise qu'elle s'utilise **en présence des deux parties**. Notre signature en ligne se fait par le client seul. Un client peut confirmer ce qu'il a reçu et ce qu'on lui a expliqué ; il ne peut pas attester qu'un différentiel 30 mA est posé. Les points se partagent donc en deux : ce que le client confirme, ce que l'entreprise déclare.

Dette connue confirmée : le PDF porte un logo Mayer en dur (`LOGO_BASE64`).

### 5.2 Certificat d'entretien

Ce que nous avons (`certificat/constants.js`, `CertificatPDF.jsx`) : sept profils (bois, fossile, pompe à chaleur, eau chaude thermodynamique, eau chaude, aéraulique, générique), onze contrôles de sécurité communs, neuf nettoyages, ramonage par conduit, étape F-Gaz (détection de fuites, charges, aptitude, carnet), mesures par profil, pièces, bilan à trois issues, signature du client.

Écarts avec le modèle réglementaire « installation thermodynamique » (profil pompe à chaleur) :

| Rubrique du modèle | Chez nous |
|---|---|
| Embouement, purge, circulateurs, filtre, isolation des réseaux | Absents. Nous avons la pression du circuit et le vase d'expansion |
| Présence d'une régulation par pièce, d'une programmation, classe du régulateur, robinets thermostatiques, cohérence des horaires | Une seule ligne « Régulation / thermostat » |
| Températures des unités intérieure et extérieure, en chaud et en froid | Températures de départ, de retour, intérieure, extérieure : pas la même mesure |
| Tension à l'arrêt et en fonctionnement | Une ligne « Alimentation électrique », sans valeur |
| Appareils de mesure utilisés (marque, référence) | Absent |
| Inversion de cycle, enclenchement des appoints | Absents |
| Nettoyage de l'échangeur extérieur, nettoyage et désinfection de l'unité intérieure | « Filtre à air », « Ventilateurs », « Bac à condensats » : proche, pas identique |
| Conseils sur le bon usage et les améliorations possibles | Champ « Recommandations » : présent |
| Date du dernier entretien | Absent du certificat |
| États validé, non validé, sans objet | Conforme, non conforme, sans objet : équivalent |

Écarts avec le modèle « chaudière bois » (profil bois, pour les chaudières seulement) : mesure du monoxyde de carbone **dans la pièce** avec ses trois seuils (nous mesurons le CO des fumées), rendement comparé à une référence, poussières, appareil de mesure.

Deux réserves :

- **Je n'ai pas vérifié quels équipements entretenus par Mayer entrent dans le champ.** Les modèles visent les systèmes thermodynamiques de 4 à 70 kW et les chaudières de 4 à 400 kW. Un climatiseur mono-split de 2,5 kW est sous le seuil ; un poêle n'est pas une chaudière. Le guide PROFEEL tranche sans doute ces cas : je ne l'ai pas lu.
- **Le certificat « Conforme » allégé** (posé par le bureau, sans relevé) ne contient par construction aucune des mesures obligatoires. Pour un équipement dans le champ de l'arrêté, il ne vaut pas attestation réglementaire.

Notre attestation d'entretien et de ramonage (`attestationEntretienModel.js`) couvre un autre texte (décret du 20 juillet 2023 sur le ramonage) : Pro'Réno n'a rien d'équivalent, nous sommes en avance sur ce point.

### 5.3 Autocontrôle et mise en service d'une pose

Nous n'avons rien. Un chantier passe de « Planifié » à « Réceptionné » sans trace de ce qui a été vérifié. Or le PV PROFEEL et la fiche d'autocontrôle demandent tous deux la **remise d'un rapport de mise en service**, que nous ne produisons pas.

Ce que les fiches apporteraient : une liste de contrôle par type d'appareil, dont les points sanctionnés en audit RGE. Ce qui s'y oppose : le constat du 17 novembre. Aucun des 67 chantiers réceptionnés n'avait de PV, et 53 entretiens ont été clos sans document. Une fiche de 61 points ne sera pas remplie sur tablette.

### 5.4 Devis

Ce que nous avons (`devisConfig.js`, `devisDocumentModel.js`) : titre, introduction, acompte, conditions (quatre lignes par défaut : validité, acompte de 30 %, TVA, garantie du fabricant), validité, pied légal construit depuis l'entreprise, signature. Le champ « Mention assurance » existe dans Organisation → Identité, mais **je ne l'ai trouvé imprimé que sur le contrat**, pas sur le devis.

Mentions de la fiche PROFEEL que nos réglages par défaut ne portent pas : assureur de responsabilité décennale et zone couverte, médiateur de la consommation, gestion des déchets de chantier (quantité, coût, modalités), opposition au démarchage (Bloctel), politique de confidentialité, date de la visite préalable (exigée pour les aides), droit de rétractation, choix du client de conserver les pièces remplacées.

Deux réserves : le devis remis au client sort de Pennylane, dont le modèle peut déjà porter ces mentions (non vérifié) ; la fiche date de décembre 2023 et les règles de TVA et d'aides ont bougé depuis.

### 5.5 Fumisterie, thermique, documents d'équipement

- **Fumisterie** : notre assistant chiffre les pièces d'un conduit. Conduits'Réno fait autre chose : il **dimensionne** le conduit (tirage) et guide le **diagnostic d'un conduit existant**. Ces deux actes sont des points RGE de la fiche poêle (n° 3 et n° 14) que notre outil ne couvre pas. Les deux sont complémentaires.
- **Thermique** : la « note de calcul des déperditions » est le premier point, marqué RGE, de chaque fiche d'autocontrôle. Notre module Thermique la produit. C'est un argument de plus pour brancher l'étude au lead, déjà décidé. PAC'Réno fait double emploi avec notre module : rien à y prendre.
- **Documents d'équipement** : les calepins et guides sont des documents de métier, pas des documents d'un appareil ou d'une marque. Nos trois tiroirs (appareil, modèle, marque) n'ont pas de place pour eux, et les ranger chez nous demanderait un accord de l'AQC. Faible intérêt.
- **Solaire** : aucun modèle d'autocontrôle ni de PV sur Pro'Réno. Les deux guides photovoltaïques sont de la documentation technique.

## 6. Recommandations, par intérêt pour Mayer

### 1. Compléter le PV de réception : points par équipement, devis, délai et levée des réserves

- **À construire** : sur le PV en ligne, remplacer les trois cases identiques par trois à six points propres à la famille d'équipement (réglés dans le référentiel des équipements), en séparant ce que le client confirme de ce que l'entreprise déclare ; ajouter le numéro du devis, le délai de levée des réserves, puis un second document « levée des réserves » signé en ligne par le même lien.
- **Pourquoi d'abord** : le PV en ligne vient d'être livré et n'a pas encore servi. C'est le moment le moins coûteux pour le compléter, et la levée des réserves manque réellement.
- **Effort** : 3 à 4 jours (modèle pur et son test, page publique, PDF, migration, fonction serveur à redéployer).
- **À décider par Eric** : rédiger nos propres points ou demander l'accord de l'AQC pour reprendre les leurs ; par quelles familles commencer (poêle à granulés et climatisation réversible me semblent les plus fréquentes) ; garder ou non « réception refusée ou différée ».

### 2. Aligner le certificat d'entretien sur le contenu réglementaire (pompes à chaleur, climatiseurs, chaudières)

- **À construire** : pour les profils concernés, ajouter au certificat les rubriques obligatoires de l'arrêté (distribution et régulation, mesures avec appareil utilisé, conseils), à partir du texte officiel, et l'écrire sur le PDF avec sa référence réglementaire.
- **Pourquoi** : c'est une obligation légale avec un délai de quinze jours, et le seul sujet où le droit de reprise est clair. Le certificat existe déjà : on complète, on ne crée pas.
- **Effort** : 2 à 3 jours, après une demi-journée de lecture du guide PROFEEL et de l'arrêté pour fixer le champ.
- **À décider par Eric** : quels contrats de Mayer sont dans le champ (puissance des appareils) ; que faire du certificat « Conforme » allégé pour ces appareils-là ; allonger ou non la saisie du technicien, sachant qu'il ne la fait déjà pas toujours.

### 3. Une fiche de mise en service courte, par famille

- **À construire** : huit à douze points par famille (étapes « mise en service » et « réception » des fiches, essais de l'AQC pour la pompe à chaleur), remplis en fin de pose ou, à défaut, déclarés par le bureau comme pour le certificat « Conforme » ; un PDF d'une page rangé sur le chantier et cité par le PV.
- **Pourquoi** : le PV comme les grilles RGE demandent un rapport de mise en service, que nous ne produisons pas.
- **Effort** : 4 à 6 jours.
- **À décider par Eric** : qui la remplit réellement, c'est la vraie question ; l'accord de l'AQC si l'on reprend ses formulations ; faut-il attendre de voir si le PV en ligne est utilisé avant d'ajouter un document de plus.

### 4. Vérifier une fois les mentions de nos devis

- **À construire** : rien d'abord. Passer un devis réel sorti de Pennylane au crible des 25 mentions, puis ajouter ce qui manque aux réglages (Réglages → Devis) et au modèle Pennylane.
- **Effort** : une demi-journée de contrôle, une demi-journée de réglages si besoin.
- **À décider par Eric** : faire valider la liste par le comptable ou l'organisme de qualification, la fiche datant de décembre 2023.

### 5. Utiliser Conduits'Réno tel quel pour le diagnostic des conduits existants

- **À construire** : rien. Installer l'application sur le téléphone des techniciens qui font les visites techniques et déposer son rapport sur le lead ou le chantier, si elle en produit un (non vérifié).
- **Pourquoi** : le diagnostic du conduit réutilisé et la note de calcul de fumisterie sont des points d'audit RGE que notre assistant ne traite pas.
- **Effort** : une heure d'essai.
- **À décider par Eric** : l'essayer sur une visite réelle avant d'en parler à l'équipe.

### Ce qui ne vaut pas la peine

- **Les fiches d'autocontrôle entières dans l'application** : 54 à 78 points par pose, personne ne les remplira. Les garder imprimées dans le camion pour un nouveau poseur ou avant un audit RGE est un usage plus réaliste, et c'est celui pour lequel elles sont faites.
- **Check'Réno à la place de notre PV** : gratuit et prêt, mais c'est une saisie de plus, hors de Majord'home, sans lien avec le chantier ni archivage chez nous. À regarder seulement pour s'en inspirer.
- **PAC'Réno** : double emploi avec notre module Thermique.
- **Attestations d'essais pour le collectif** (chaufferie, sous-station, réseaux) : hors de notre activité.
- **Calepins, recommandations RAGE, guides** : bonne documentation de formation, pas des gabarits. À lire, pas à intégrer.
- **La fiche « Installer un climatiseur »** : patrimoine toulousain, sans rapport.

## 7. Questions ouvertes

1. **Accord de l'AQC** : reprise de textes PROFEEL dans un logiciel vendu à d'autres entreprises, et liens vers Pro'Réno (voir 4.3). Sans réponse, nous écrivons nos propres formulations à partir des textes officiels et des notices des fabricants.
2. **Champ réglementaire de l'entretien** : quels appareils suivis par Mayer relèvent de l'arrêté du 24 juillet 2020 (4 à 70 kW) et de celui du 15 septembre 2009 (chaudières de 4 à 400 kW) ? À lire dans les deux guides PROFEEL, puis à croiser avec le parc sous contrat.
3. **Qui remplit ?** Toute fiche ajoutée bute sur le même constat que le PV et le certificat. La réponse (technicien, bureau, client) décide de la forme des recommandations 1 et 3.
4. **Photovoltaïque et bornes de recharge** : Pro'Réno n'offre pas de trame. Les organismes de qualification (Qualit'EnR, Qualifelec) et le Consuel en publient peut-être : non cherché ici.
5. **Mentions du devis Pennylane** : à contrôler sur un devis réel avant de toucher aux réglages.

## 8. Ce qui n'a pas été vérifié

- Check'Réno, PAC'Réno et Conduits'Réno n'ont pas été ouverts (compte ou installation requis).
- 12 PDF ouverts (7 lus en entier, 5 parcourus) sur environ 90 qui nous concernent. La fiche « Installer un climatiseur » n'est connue que par sa page de présentation. Les fiches « poêle avec bouilleur », « poêle étanche », « chaudières », « chauffe-eau », « ventilation », quatre attestations d'entretien sur six et dix attestations d'essais sur douze ne sont connues que par leur titre.
- La couverture des inserts par les fiches « poêle » n'est pas établie.
- L'écart entre les 49 fiches d'autocontrôle annoncées et les 46 du plan du site n'est pas expliqué.
- Les textes réglementaires n'ont pas été relus à la source, et la validité actuelle de la fiche Devis et factures (décembre 2023) n'a pas été contrôlée.
- La lecture des droits est la mienne ; seule une réponse écrite de l'AQC ferait foi.

## 9. Sources

- Conditions générales d'utilisation : https://www.proreno.fr/conditions-generales-utilisation
- Mentions légales : https://www.proreno.fr/mentions-legales
- Règles d'exploration : https://www.proreno.fr/robots.txt ; plan du site : https://www.proreno.fr/sitemap_index.xml
- Fiches ouvertes (lues en entier ou parcourues, voir 2) : `https://www.proreno.fr/documents/` suivi de `fiche-autocontrole-poele-granules`, `fiche-autocontrole-poele-a-buches-classique`, `fiche-autocontrole-pompe-a-chaleur-air-air`, `fiche-autocontrole-pompe-a-chaleur-air-eau`, `fiche-autocontrole-cet-sur-air-exterieur-monobloc`, `fiche-autocontrole-devis-factures`, `fiche-pv-reception-travaux-poele-a-granules-bois`, `fiche-pv-reception-travaux-pompe-a-chaleur-pac-air-air-1`, `attestation-entretien-chaudiere-bois`, `attestation-entretien-installation-thermodynamique`, `pompe-a-chaleur-airair-attestation-dessais-de-fonctionnement`, `chaudiere-bois-attestation-dessais-de-fonctionnement-1`, `installer-un-climatiseur`.
- Pages de présentation lues : `checkreno`, `conduitsreno`, `pacreno-dimensionnement-de-pac`, `commissionnement-liste-des-autocontroles-et-essais`, `appareils-chauffage-divise-a-granules-calepin-chantier`, `entretien-installation-thermodynamique-4kW-70kW`, et la page `/services`.
- Code lu : `src/apps/artisan/components/chantiers/PvReceptionPDF.jsx`, `src/lib/pvReception.js`, `src/apps/artisan/components/certificat/constants.js`, `CertificatPDF.jsx`, les étapes `StepFGaz.jsx` et `StepRamonage.jsx`, `src/lib/attestationEntretienModel.js`, `src/lib/devisConfig.js`, `src/lib/devisDocumentModel.js`, `src/lib/orgBranding.js`.
