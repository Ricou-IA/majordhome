# PV de réception en ligne : points par équipement, déclaration de l'entreprise, levée des réserves

Date : 2026-11-18 · Demandeur : Eric · Module : Chantiers
Suite de `2026-11-17-chantier-apres-vente-pv-en-ligne-design.md` (PV signé en ligne, livré le 17).
Origine : `docs/ETUDE_PRORENO_2026-11-18.md`, recommandation n° 1.

## Pourquoi

Le PV signé en ligne ne porte que trois cases identiques pour tous les équipements (« le client
reconnaît avoir reçu… ») et s'arrête à la signature. Les trames de la profession (PV de réception
PROFEEL) y mettent ce qui nous manque :

- des points de réception **propres à l'équipement** ;
- la **référence du devis** que le PV clôt ;
- un **engagement de délai** quand il y a des réserves, puis un **PV de levée des réserves**.

Aujourd'hui, un chantier réceptionné avec réserves n'a aucun document de clôture.

## Ce qu'Eric a décidé (2026-11-18)

- Lancer cette reprise en premier, avant le certificat d'entretien et la fiche de mise en service.
- **Le PV porte deux séries de points** : ce que **le client confirme** (ce qu'il a reçu, ce qu'on
  lui a montré) et ce que **l'entreprise déclare** (faits techniques que le client, seul chez lui,
  ne peut pas attester). Le bureau remplit la déclaration avant d'envoyer le lien.

## Ce qui a été mesuré (production, 2026-11-18)

- Aucun PV en ligne envoyé ni signé à ce jour ; le gabarit d'e-mail `pv_reception` n'existe pas
  encore. **Aucune donnée existante à reprendre.**
- 60 chantiers sur 117 n'ont pas de type d'équipement (20 des 34 « Planifié »).
- La catégorie « Poêle » couvre « Poêle à granulés » (13 chantiers) et « Poêle à bois ou Insert »
  (19) : les points se rattachent au **type**, pas à la catégorie.
- 99 chantiers sur 101 (Planifié ou Réceptionné) ont au moins un devis validé portant un numéro
  (`lead_pennylane_quotes.quote_label`) et une date (`quote_date`) ; 7 en ont plusieurs.
- **Aucun PV ne peut être enregistré aujourd'hui, ni sur tablette ni en ligne.** Les quatre
  règles d'accès du dossier de fichiers `interventions` comparent le nom d'un projet à son propre
  identifiant (anomalie déjà notée dans `20260809_2_storage_buckets_et_policies.sql`) : aucun des
  3 854 projets ne la remplit, le dossier contient 0 fichier et aucun chantier n'a de
  `pv_reception_path`. Seuls les PV utilisent ce dossier. Déduit des règles et des compteurs :
  aucun dépôt n'a été tenté en production pour le prouver.
- La vue `majordhome_pricing_equipment_types` porte encore en production la colonne
  `equipment_category` : la contraction `20260920_1` (fichier présent dans le dépôt) n'est pas
  appliquée.

## Objectifs

1. Le client lit, avant de signer, ce que l'entreprise déclare, et confirme point par point ce qui
   le concerne, avec des phrases adaptées à son équipement.
2. Le PV cite le ou les devis du chantier.
3. Un PV avec réserves a une suite : réponse et date d'engagement de l'entreprise, puis levée des
   réserves signée en ligne par le client, avec son propre document.
4. Tout ce qui est signé reste figé et relu tel qu'enregistré (même règle que le PV du 17).

## Non-objectifs

- **Aucun texte PROFEEL** : les points sont rédigés par nous. L'accord de l'AQC n'est pas attendu.
- Pas de « réception refusée ou différée » : un client qui refuse ne signe pas et appelle.
- Pas de fiche de mise en service ni d'autocontrôle (recommandation n° 3 de l'étude, plus tard).
- Le PV signé sur place (tablette, `PvReceptionSign.jsx`) garde ses trois cases et son parcours.
- Pas d'e-mail automatique au client quand le bureau répond aux réserves.
- Le logo Mayer en dur du PDF (`LOGO_BASE64`) n'est pas traité ici (dette signalée à part).

## À ne surtout pas faire

- Présélectionner une réponse dans la déclaration de l'entreprise : une case jamais touchée n'est
  pas un « oui ».
- Rendre un point du client obligatoire : il doit pouvoir signer sans tout cocher.
- Recalculer un PV signé depuis les gabarits du jour : un PV signé relit ses propres points.

## Approches pour ranger les points

1. **Gabarits fournis par l'application, choisis par type d'équipement** (retenue). Liste fermée,
   textes dans un module pur, testés et sûrs pour le PDF ; le type d'équipement choisit son gabarit
   dans Paramètres → Équipements → Types. Même patron que `certificate_profile` sur les catégories.
   Une entreprise nouvelle a des PV corrects sans rien préparer.
2. Points saisissables par type dans les paramètres. Écartée pour l'instant : chaque entreprise
   devrait rédiger ses listes avant le premier PV, sans garantie sur les textes. Peut s'ajouter
   plus tard par-dessus la première (surcharge par type).
3. Une liste unique par entreprise. Écartée : ne distingue pas un poêle d'une climatisation.

## Les gabarits et leurs points

Module pur `src/lib/pvPoints.js` (copié pour Deno par `npm run sync:tournee-engine`, testé).
Chaque point a une clé stable et un texte. **Textes à relire par Eric (et Philippe)** : ce sont
des propositions.

Points communs à tous les gabarits :

| Clé | Qui | Texte |
|---|---|---|
| `c_notice` | client | J'ai reçu la notice d'utilisation en français. |
| `c_demonstration` | client | L'appareil a été mis en marche devant moi et son fonctionnement m'a été expliqué. |
| `c_entretien` | client | On m'a expliqué l'entretien à prévoir et sa fréquence. |
| `e_mise_en_service` | entreprise | L'installation a été mise en service et essayée. |
| `e_conforme_devis` | entreprise | Les travaux réalisés correspondent au devis. |

Points propres à chaque gabarit, ajoutés aux communs :

| Gabarit | Qui | Clé | Texte |
|---|---|---|---|
| `poele_granules` | client | `c_combustible` | On m'a indiqué quels granulés utiliser (certifiés, secs, sans poussière). |
| | client | `c_amenee_air` | On m'a expliqué que l'arrivée d'air doit rester dégagée et ne pas être modifiée. |
| | entreprise | `e_conduit` | Le conduit de fumée a été contrôlé et porte sa plaque signalétique. |
| | entreprise | `e_distances` | Les distances de sécurité aux matériaux combustibles sont respectées. |
| | entreprise | `e_reglages` | Les réglages de combustion ont été faits (alimentation en granulés, extraction des fumées). |
| | entreprise | `e_differentiel` | L'alimentation électrique est protégée par un interrupteur différentiel 30 mA. |
| `poele_buches` (poêle à bois, insert) | client | `c_combustible` | On m'a indiqué quel bois brûler (bûches sèches, de taille adaptée au foyer). |
| | client | `c_amenee_air` | On m'a expliqué que l'arrivée d'air doit rester dégagée et ne pas être modifiée. |
| | entreprise | `e_conduit` | Le conduit de fumée a été contrôlé et porte sa plaque signalétique. |
| | entreprise | `e_distances` | Les distances de sécurité aux matériaux combustibles sont respectées. |
| `pac_air_air` (climatisation, PAC air/air) | client | `c_reglages` | On m'a montré la télécommande, les modes et le réglage de la température. |
| | client | `c_filtres` | On m'a montré comment nettoyer les filtres des unités intérieures. |
| | entreprise | `e_etancheite` | Le circuit frigorifique a été contrôlé étanche et tiré au vide avant la mise en service. |
| | entreprise | `e_fluide` | L'unité extérieure porte l'étiquette indiquant la nature et la quantité de fluide. |
| | entreprise | `e_condensats` | Les condensats s'évacuent correctement. |
| | entreprise | `e_differentiel` | L'alimentation électrique est protégée par un interrupteur différentiel 30 mA. |
| `pac_air_eau` | client | `c_reglages` | On m'a montré le thermostat et les réglages du chauffage. |
| | client | `c_dimensionnement` | On m'a expliqué pourquoi cette puissance a été retenue pour mon logement. |
| | entreprise | `e_etancheite` | Le circuit frigorifique a été contrôlé étanche et tiré au vide avant la mise en service. |
| | entreprise | `e_fluide` | L'unité extérieure porte l'étiquette indiquant la nature et la quantité de fluide. |
| | entreprise | `e_hydraulique` | Le circuit de chauffage a été rempli, purgé et mis en pression. |
| | entreprise | `e_differentiel` | L'alimentation électrique est protégée par un interrupteur différentiel 30 mA. |
| `chauffe_eau` | client | `c_reglages` | On m'a montré les modes de fonctionnement et le réglage de la température. |
| | entreprise | `e_securite` | Le groupe de sécurité est posé et raccordé à l'évacuation. |
| | entreprise | `e_differentiel` | L'alimentation électrique est protégée par un interrupteur différentiel 30 mA. |
| `generique` | — | — | Les points communs seuls. |

Règles du module :

- `GABARITS_RECEPTION` (liste fermée), `pointsDuGabarit(code)` → `{ client: [...], entreprise: [...] }`
  dans l'ordre : communs, puis propres. Code inconnu ou absent ⇒ `generique`.
- Réponse de l'entreprise à un point : `oui` | `non` | `sans_objet`. Réponse du client : confirmé
  ou non.
- `declarationComplete(points, reponses)` : vrai seulement si chaque point de l'entreprise a une
  des trois réponses.
- Textes sans caractère hors de la police du PDF (Helvetica) : un test le vérifie.

### Quel gabarit pour quel chantier

- Nouvelle colonne `majordhome.pricing_equipment_types.reception_profile text NOT NULL DEFAULT
  'generique'`, bornée par un CHECK sur la liste fermée ; exposée par la vue des types ; éditable
  dans Paramètres → Équipements → Types (un sélecteur « Gabarit du PV de réception »).
- **La vue se recrée depuis sa définition de PRODUCTION** (qui porte encore `equipment_category`),
  colonne ajoutée en fin. Le fichier en attente `20260920_1_referentiel_equipements_contraction.sql`
  supprime puis recrée cette vue avec une liste fixe : il est mis à jour dans le même lot pour
  porter `reception_profile`, sinon la colonne disparaîtrait le jour où la contraction passera.
- La migration pose une valeur de départ **pour toutes les organisations**, d'après le code du
  type et de sa catégorie (un type dont le code contient `granul` dans une catégorie de profil
  `combustion_bois` hors chaudière ⇒ `poele_granules`, etc.). La règle exacte est laissée au
  constructeur ; **le résultat est listé et vérifié type par type avant application**. Un type non
  reconnu reste `generique`.
- Chantier sans type : la fenêtre de préparation propose de le choisir (écrit
  `chantiers.equipment_type_id` par `majordhome_chantiers_write`, comme la fiche). Sans choix, le
  gabarit `generique` s'applique. Le type n'est jamais exigé.

## Parcours

### 1. Le bureau prépare le PV

Fiche d'un chantier Planifié (ou Réceptionné sans PV), section « PV de réception ». Les boutons
« Envoyer au client » et « Copier le lien » ouvrent d'abord la fenêtre **« Préparer le PV »** :

```
Préparer le PV de réception
Équipement : Poêle à granulés                 [changer]     (ou : choisir le type)
Devis : D-2026-0412 du 3 septembre 2026

L'entreprise déclare                                   [Tout est fait]
  L'installation a été mise en service et essayée.     ( ) oui ( ) non ( ) sans objet
  Les travaux réalisés correspondent au devis.         ( ) oui ( ) non ( ) sans objet
  Le conduit de fumée a été contrôlé et porte…         ( ) oui ( ) non ( ) sans objet
  …
Le client verra ces réponses avant de signer.
                                   [Annuler]  [Copier le lien]  [Envoyer au client]
```

- Aucune réponse n'est présélectionnée. « Tout est fait » coche « oui » partout d'un seul geste
  (un geste explicite) ; on corrige ensuite point par point.
- Tant que la déclaration n'est pas complète, « Envoyer » et « Copier le lien » sont fermés, avec
  la raison écrite.
- La préparation peut être reprise tant que le client n'a pas signé (le client lit toujours la
  dernière version). Après signature, elle est figée.
- Le PV nomme l'entreprise, jamais la personne du bureau (même choix que l'attestation
  « Conforme ») ; qui a préparé est gardé en base.

### 2. Le client signe

Page `/pv/:token`, dans cet ordre :

1. Travaux, jours de pose, adresse (comme aujourd'hui), plus **« Devis n° … du … »** (plusieurs
   devis : une ligne chacun).
2. **« Ce que déclare votre installateur »** : la liste, en lecture, avec la réponse en toutes
   lettres (« oui », « non », « sans objet »).
3. Sa décision : sans réserve / avec réserves (inchangé).
4. **« Ce que vous confirmez »** : les points du client, cases décochées, facultatives. Elles
   remplacent les trois cases actuelles.
5. Un rappel des garanties, en trois lignes : parfait achèvement (1 an), bon fonctionnement
   (2 ans), décennale (10 ans), qui courent à partir de la date de signature.
6. Nom, signature, bouton (inchangé).

Un lien ouvert alors que le PV n'est pas préparé (cas d'un lien copié avant cette évolution : il
n'en existe aucun) affiche « Ce procès-verbal n'est pas encore prêt » et rien à signer.

### 3. Suite d'un PV avec réserves

Dans la fiche, sous les réserves du client :

- **« Répondre aux réserves »** : un texte (ce que l'entreprise va faire) et une **date
  d'engagement** (« réserves levées avant le… »). Modifiable tant que la levée n'est pas signée.
  Le client les lit en rouvrant son lien. Le texte et la date sont chacun facultatifs, il en faut
  au moins un pour enregistrer. La date ne peut pas précéder le jour de la signature du PV ; une
  date déjà passée est admise (on consigne une reprise déjà faite).
- **Répondre n'est pas un préalable à la levée** : une reprise faite le lendemain se clôt sans
  réponse écrite. Le PV de levée n'affiche la réponse et la date que si elles existent.
- Quand les reprises sont faites : **« Demander la levée des réserves »** → e-mail au client
  (gabarit transactionnel `pv_levee_reserves`, créé d'un clic dans Paramètres → Communication →
  Emails, comme `pv_reception`) ou « Copier le lien ». Le lien est le même que celui du PV ; s'il
  a expiré (60 jours), le bouton en produit un nouveau. **« Copier le lien » note lui aussi la
  demande de levée** : sans elle, le client n'aurait rien à signer.
- Le client rouvre le lien : ses réserves, la réponse de l'entreprise, puis **« Je constate que
  les réserves sont levées »**, son nom, sa signature. S'il n'est pas d'accord, il ne signe pas
  et appelle (même règle que pour la réception).
- La carte passe de « Réserves » à « Réserves levées ». Le bureau et le client peuvent ouvrir le
  **PV de levée des réserves** (PDF produit depuis l'enregistrement, puis archivé).

## Données

Migration `20261118_x_chantier_pv_points_levee.sql`, répétée sur le harnais
(`assert-chantier-pv.sql` étendu). Aucune écriture par l'application dans `chantier_pv` : tout
passe par des RPC `service_role` appelées par l'edge, comme le 17.

`majordhome.chantier_pv` gagne :

| Colonne | Rôle |
|---|---|
| `gabarit text` | code du gabarit retenu à la préparation |
| `points_entreprise jsonb` | `[{ cle, texte, reponse }]` : photo des points et des réponses |
| `prepare_at`, `prepare_par` | dernière préparation |
| `devis jsonb` | `[{ libelle, date }]` : devis validés du chantier, photographiés **à la signature** |
| `points_client jsonb` | `[{ cle, texte, confirme }]` : photo à la signature |
| `reserves_reponse text`, `reserves_echeance date`, `reserves_repondu_at`, `reserves_repondu_par` | réponse de l'entreprise |
| `levee_demandee_at`, `levee_sent_to`, `levee_sent_count` | demande de levée |
| `levee_signed_at`, `levee_signataire_nom`, `levee_signature_png` | levée signée |

- Les trois booléens `info_recues`, `notices_recues`, `entretien_recues` restent en base et ne
  sont plus écrits par la signature en ligne.
- **Les textes sont recopiés dans la ligne** (`texte`) : un PV signé ne dépend plus du module.
  Le serveur ne fait pas confiance aux textes reçus : il les reprend de `pvPoints.js` d'après les
  clés, et refuse une clé étrangère au gabarit.
- Trigger `chantier_pv_signature_figee` étendu : après `signed_at`, sont figés aussi `gabarit`,
  `points_entreprise`, `points_client`, `devis` ; après `levee_signed_at`, sont figés les colonnes
  `levee_signed_at`, `levee_signataire_nom`, `levee_signature_png`, `reserves_reponse`,
  `reserves_echeance`.
- CHECK : `levee_signed_at` exige une signature avec réserves déjà enregistrée, un nom et une image.
- « Devis validé » se lit par `majordhome.quote_status_bucket()` sur
  `lead_pennylane_quotes.chantier_id` (devis non éjectés) : jamais une liste de statuts recopiée.

RPC (toutes `SECURITY DEFINER`, `REVOKE … FROM PUBLIC, anon, authenticated`, `service_role` seul) :

| RPC | Effet |
|---|---|
| `chantier_pv_contexte` (étendue) | rend en plus : `reception_profile` du type, devis validés, préparation, points, réponse aux réserves, levée |
| `chantier_pv_preparer(p_chantier_id, p_gabarit, p_points jsonb, p_user)` | crée ou met à jour la préparation ; refus `deja_signe` |
| `chantier_pv_signer` (étendue) | exige une préparation complète (`pv_non_prepare`) ; enregistre `points_client` et la photo `devis` |
| `chantier_pv_repondre_reserves(p_chantier_id, p_reponse, p_echeance, p_user)` | refus si pas de réserves ou si la levée est signée |
| `chantier_pv_marquer_levee(p_chantier_id, p_sent_to, p_user)` | note la demande de levée |
| `chantier_pv_signer_levee(p_chantier_id, p_payload)` | exige `levee_demandee_at` ; refus `levee_deja_signee` |

Refus métier = retour `{ ok: false, code }`, jamais un `RAISE` (règle du 17).

Vues :

- `majordhome_chantier_pv` : nouvelles colonnes en fin de liste.
- `majordhome_chantiers` : `pv_reserves_levees_at` en fin de liste (`security_invoker` répété,
  `REVOKE … FROM PUBLIC, anon`).
- `majordhome.chantiers.pv_levee_path text` (chemin du PDF de levée archivé), exposé par
  `majordhome_chantiers` et `majordhome_chantiers_write` en fin de liste.

## Archivage des PDF : réparer le dossier `interventions`

Sans cette réparation, ni le PV de réception ni le PV de levée ne peuvent être rangés, et le PV
sur tablette échoue à l'enregistrement.

- Les quatre règles d'accès du dossier `interventions` sont remplacées par le motif de la charte,
  celui du dossier `certificats` : le premier segment du chemin est l'organisation, et l'appelant
  en est membre (`(storage.foldername(name))[1]::uuid IN (…)`). Le dossier est vide : rien à
  déplacer.
- Chemins : `${orgId}/pv-reception/${chantierId}/…` pour le PV, `${orgId}/pv-levee/${chantierId}/…`
  pour la levée. `chantiersService.uploadPvReception` et `chantierPvService.genererPdf` changent
  de chemin ; c'est la seule retouche du parcours tablette, qui retrouve ainsi son enregistrement.
- Le harnais ne porte pas ces règles (son `storage.objects` est un substitut) : l'assertion les
  recrée avant de les éprouver, comme pour `product_documents_org_select`.
- Vérification en production après application : `pg_policies` relu, puis un PV réel archivé
  lors du premier essai avec Eric.

## Edge `chantier-pv`

| Action | Qui | Effet |
|---|---|---|
| `preparer` | membre + `user_can(chantiers, edit \| edit_own)` | valide les clés contre le gabarit, appelle `chantier_pv_preparer` |
| `envoyer`, `lien` | inchangé | refusent `pv_non_prepare` si la déclaration est incomplète ; une fois le PV signé avec réserves, `lien` rend le lien au lieu de refuser `deja_signe` (la garde commune du bureau refuse aujourd'hui toute action sur un PV signé : elle est levée pour `lien`, `repondre_reserves` et `demander_levee`) |
| `repondre_reserves` | même garde | réponse et date d'engagement |
| `demander_levee` | même garde + module Communication pour l'e-mail | e-mail `pv_levee_reserves`, trace `mailing_logs`, `chantier_pv_marquer_levee` ; variante sans e-mail qui rend le lien |
| `GET ?token=` | public | rend en plus : devis, déclaration, points du client du gabarit, réponse aux réserves, état de la levée |
| `signer` | public | points du client validés contre le gabarit de la préparation |
| `signer_levee` | public | nom et signature, mêmes bornes que `signer` |

- La page publique ne reçoit toujours ni montant, ni note interne, ni téléphone ou e-mail du
  client. Le numéro et la date du devis sont des informations que le client possède déjà.
- Codes d'erreur nouveaux, chacun avec son message dans `pvReception.js` (le test l'exige) :
  `pv_non_prepare`, `declaration_incomplete`, `point_inconnu`, `pas_de_reserves`,
  `levee_non_demandee`, `levee_deja_signee`, `echeance_invalide`.
- **Déploiement** : migration puis edge, **sur accord d'Eric** (règle : aucune edge ni secret en
  production sans son oui). Aucun secret nouveau.

## Documents PDF

- `donneesPdfPv` (`src/lib/pvReception.js`) rend en plus : devis, points de l'entreprise, points
  du client. Le PDF (`PvReceptionPDF.jsx`) les affiche s'ils existent ; sinon il garde les trois
  cases (PV signé sur tablette). Il ne calcule ni ne formate rien de plus.
- Le PV de réception **ne porte pas** la réponse de l'entreprise ni la date d'engagement : elles
  viennent après la signature et un PV signé ne change plus. Elles figurent sur le PV de levée.
- Nouveau document « Procès-verbal de levée des réserves » : entreprise, client, référence du PV
  de réception et sa date, devis, réserves du client, réponse et date d'engagement de
  l'entreprise, phrase de constat, date, nom et signature du client. Données par une fonction pure
  `donneesPdfLevee` à côté de `donneesPdfPv`, testée.
- Rappel des garanties : même texte court sur le PV et sur la page.
- Textes passés par les formatters sûrs pour le PDF (pas de caractère hors Helvetica).

## Écrans touchés

- `ChantierPvSection.jsx` : fenêtre « Préparer le PV » (nouveau composant à part, la section
  approche 200 lignes), bloc « Réponse aux réserves », demande de levée, états « Réserves levées ».
- `src/pages/PvReception.jsx` : nouvelles sections, état « levée à signer », état « pas prêt ».
  À découper : le fichier fait 349 lignes et va grossir.
- Carte du chantier réceptionné : le repère `PV` dit en infobulle « signé », « signé avec
  réserves », « réserves levées le… » (règle dans `src/lib/chantierApresVente.js`, testée).
- Paramètres → Équipements → Types : sélecteur du gabarit de réception.
- Paramètres → Communication → Emails : création du gabarit `pv_levee_reserves`.

## Vérification

- Tests des modules purs : `pvPoints` (gabarits, complétude, clés uniques, textes sûrs pour le
  PDF), `pvReception` (validation, normalisation, données des deux PDF, codes ↔ messages),
  `chantierApresVente` (repère PV).
- Harnais : préparation, refus de signer sans préparation, signature avec points, gel après
  signature, réponse aux réserves, levée (refus sans demande, gel après), droits (`anon` et
  `authenticated` sans EXECUTE, vérifié par `has_function_privilege`).
- `npx vite build`, `npm run audit:quality`, test de synchro des copies Deno.
- **Ce qui ne pourra pas être prouvé sans Eric** : un envoi réel, une signature réelle et une
  levée réelle (il faut le gabarit d'e-mail, un chantier et un téléphone). Le PV en ligne du 17
  n'a lui-même jamais servi en réel : le premier essai couvrira les deux.

## Choix faits sans Eric (à confirmer)

- Gabarits fournis par l'application, non modifiables par entreprise pour l'instant.
- Six gabarits pour commencer ; borne de recharge, photovoltaïque et travaux d'électricité
  tombent sur `generique`.
- La date d'engagement est posée par l'entreprise après la signature, pas négociée dans le PV.
- Le client qui conteste la levée ne signe pas ; rien n'est enregistré de son désaccord.
- Le PV sur tablette n'est pas modifié, hormis le chemin où il range son fichier.
- Le PV ne nomme pas la personne du bureau qui a préparé la déclaration.
- Le dossier de fichiers `interventions` est réparé dans ce lot (règles d'accès par organisation).
- Le fichier de migration en attente `20260920_1` est retouché pour ne pas perdre la colonne du
  gabarit ; la contraction elle-même n'est pas appliquée par ce lot.
- Répondre aux réserves n'est pas exigé avant de demander leur levée ; une date d'engagement
  passée est admise, pas une date antérieure à la signature.

## Relecture du constructeur (2026-11-18)

Un relecteur a confronté ce document au code et à la production. Il a relevé les deux écarts
repris ci-dessus (dossier `interventions`, forme de la vue des types), vérifiés ensuite en base,
et la question des règles de réponse aux réserves, tranchée ci-dessus. Points qu'il règle seul :
recréer `majordhome_chantiers_write` pour exposer `pv_levee_path`, ajouter `pvPoints` aux modules
copiés pour Deno (`scripts/sync-tournee-engine.mjs`).

## Laissé au constructeur

Mise en page de la fenêtre et de la page, libellés d'interface hors textes des points, découpage
des composants, règle de valeur de départ des gabarits par type (résultat à lister), nom exact du
fichier de migration, ordre des tranches de livraison.
