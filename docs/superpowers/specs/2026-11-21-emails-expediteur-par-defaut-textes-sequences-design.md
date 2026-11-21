# E-mails d'une nouvelle entreprise : expéditeur par défaut, textes sans clic, séquences prêtes à activer

Date : 2026-11-21 · Statut : principe validé par Eric. Adresse de plateforme provisoire retenue :
`envoi.confer-sas.fr` (le nom commercial n'est pas choisi). Tranche 2 codée le 2026-11-21, edges
non déployées ; tranches 1, 3 et 4 à faire.

## 1. Objectif

Une entreprise qui arrive (Cimaj, H&E) doit pouvoir envoyer ses e-mails le jour même, sans
toucher à son DNS, puis passer à son propre domaine quand elle le veut. Ses e-mails automatiques
et ses séquences de relance doivent exister sans qu'on recopie ceux de Mayer.

Critère de succès : une organisation créée à l'instant, avec le module Communication ouvert et
rien d'autre de réglé que son identité, envoie un PV de réception à signer ; le client le reçoit
au nom de l'entreprise et sa réponse arrive chez elle.

## 2. État mesuré le 2026-11-21

### 2.1 Expéditeur

- Un compte Resend, une clé (`RESEND_API_KEY`), région EU. Le domaine d'une entreprise est créé
  par l'edge `resend-domain-onboard` (org_admin, domaine toujours déduit de `from_email`).
- **Aucune résolution centrale de l'expéditeur.** Onze edges fabriquent chacune leur en-tête
  `from` à partir de `from_email` : `invoice-send`, `chantier-pv`, `sav-report-send`, `dpe-lien`,
  `auto-rdv`, `auto-rdv-cron`, `lead-welcome-email`, `webshop-process` (par `_shared/mail.ts`),
  et `mailing-send`, `contract-signed-notify`, `invite-client` (appel Resend à part).
- Côté serveur, personne ne lit `settings.resend.status`. Seuls deux écrans le lisent
  (`invoiceEmailModel.js`, `ClientLogementDpe.jsx`). Les autres envois partent et Resend les
  refuse si le domaine n'est pas vérifié.
- `settings.resend` est écrit par le navigateur (`ResendDomainSection` → `useOrgSettings().save`),
  donc par quelqu'un qui peut écrire ce qu'il veut dans les réglages.
- Un expéditeur de plateforme existe déjà en un seul endroit : `MDH_PLATFORM_FROM_EMAIL`, lu par
  `maintenance-digest` quand l'entreprise n'a pas d'adresse.
- En production :

  | Entreprise | `from_email` | Domaine Resend | Module Communication |
  |---|---|---|---|
  | Mayer | contact@mayer-energie.fr | vérifié | ouvert |
  | H&E | info@habitat-energies.com | jamais configuré | ouvert |
  | Cimaj | vide | — | fermé |

  H&E est donc dans le cas visé : module ouvert, adresse saisie, et tout envoi serait refusé par
  Resend.

### 2.2 Textes des e-mails automatiques

- Ils ne sont pas en dur : chaque texte est une ligne de `mail_campaigns` (`is_transactional`),
  éditable dans Mailing → Éditeur. Le code ne porte que le texte par défaut.
- **Mais la ligne n'existe qu'après un clic sur « Modifier le texte »** (`assurerTexteEmail`).
  Sans elle, neuf edges refusent l'envoi (`template_missing`). Même Mayer n'a pas de ligne pour
  l'invitation au RDV, la confirmation de RDV, le rapport SAV, le rapport DPE ni l'accueil des
  leads Meta.
- La liste affichée dans Réglages → Emails est du JSX écrit à la main (huit lignes).
- Deux textes n'ont **aucun défaut dans le code** et n'existent que chez Mayer :
  `proposition_contrat` (lu par `useContractProposal`) et `contrat_signature_confirm` (lu par
  `contract-signed-notify`). Une autre entreprise ne peut ni envoyer une proposition de contrat
  ni confirmer une signature.
- `contrat_signature_confirm` est rangé `is_transactional = false` chez Mayer : il apparaît donc
  parmi les campagnes diffusables. À corriger.
- En dur pour de bon : le HTML de `invite-client` (portail client, module non livré — laissé).

### 2.3 Séquences

- Les séquences de Mayer ne sont pas dans le code non plus. Ce sont des campagnes
  `is_automated` reliées à un segment, exécutées par `mailing-scheduler` (pg_cron, 10 min) :

  | Campagne | Segment | Cadence |
  |---|---|---|
  | Accueil d'un nouveau lead | leads au statut Nouveau | toutes les 10 min |
  | Relance « Contacté » | 7 à 14 jours dans le statut, pas d'e-mail depuis 30 jours | chaque jour 9 h |
  | Relance « Devis envoyé » | 7 à 14 jours après le devis, pas d'e-mail depuis 30 jours | chaque jour 9 h |

- Tout est réglable dans `CampaignWizard` (segment, cadence, heure). Ce qui manque à une nouvelle
  entreprise : elle a **zéro campagne et zéro segment**, et les textes de Mayer citent Michel,
  Philippe et son site.
- Les statuts de lead sont communs aux entreprises (`majordhome.statuses`) : un segment modèle
  par statut vaut pour toutes. Les segments par type d'équipement, eux, sont propres à chacune.

### 2.4 Ce que Resend permet

- La configuration DNS en un clic (Domain Connect, surtout Cloudflare) est une fonction du
  **tableau de bord** Resend. Je n'ai trouvé aucune trace d'un équivalent par l'API : nos clients
  n'ont pas accès à notre tableau de bord, donc on ne peut pas compter dessus.
- Le nombre de domaines est limité par l'offre (10 sur l'offre Pro d'après la page de prix,
  100 de plus pour 20 $ par mois). Chaque entreprise qui branche son domaine en consomme un.
  Chiffres à confirmer sur le compte.

## 3. Conception

### 3.1 Un expéditeur résolu en un seul endroit

Module pur `src/lib/expediteur.js` (copié pour Deno), une fonction :

```
resoudreExpediteur(settings, { usage, plateforme }) →
  { from, replyTo, mode: 'domaine' | 'plateforme' } | { refus: code }
```

- Domaine de l'entreprise vérifié → `Nom <from_email>`, réponse à `reply_to` sinon `from_email`.
- Sinon, pour un e-mail **individuel** (facture, PV, RDV, rapport, proposition, accueil d'un
  lead) → `Nom de l'entreprise <adresse de la plateforme>`, réponse à l'adresse de l'entreprise.
  Sans adresse de réponse connue : refus `no_reply_to`, jamais un envoi dont la réponse se perd.
- Sinon, pour un envoi **en nombre** (campagne, séquence) → refus `domaine_requis`. Un envoi de
  masse depuis le domaine commun ferait porter à toutes les entreprises la réputation d'une
  seule.

Les onze edges passent par cette fonction ; `mailing-send`, `contract-signed-notify` et
`invite-client` abandonnent leur construction d'en-tête à part.

Le statut du domaine cesse d'être écrit par le navigateur : `resend-domain-onboard` l'écrit
lui-même par une RPC `org_resend_noter` (service_role), comme `org_hesiasun_noter`.

Écran Réglages → Emails : un seul champ obligatoire, « Votre adresse e-mail (les réponses de vos
clients y arrivent) ». Une phrase dit l'état : « Vos e-mails partent de la part de Cimaj, depuis
l'adresse de Majord'home » ou « depuis contact@cimaj.fr ». L'étape `expediteur` de
`demarrage.js` est faite dès que cette adresse est saisie.

### 3.2 Passer à son domaine sans connaître le DNS

Même edge, même sécurité, trois ajouts :

1. **Chez qui est le DNS.** Lecture des serveurs de noms du domaine, puis mode d'emploi du bon
   hébergeur (OVH, Gandi, Ionos, Cloudflare, o2switch… générique sinon).
2. **« Envoyer à la personne qui gère mon site ».** Une page sans compte `/dns/:jeton`
   (habillage `pageUi.jsx`, jeton signé comme `/pv/:token`) qui liste les enregistrements avec
   leurs boutons de copie et l'état de chacun. Elle ne montre rien d'autre de l'entreprise.
3. **Vérification toute seule.** Un cron relance la vérification des domaines en attente
   (toutes les 15 min, 7 jours au plus, seulement s'il y en a). Au passage en « vérifié »,
   l'expéditeur bascule sans geste et l'administrateur est prévenu par e-mail.

### 3.3 Des textes qui existent sans clic

Registre unique `src/lib/emailsAutomatiques.js` (pur, copié pour Deno), sur le modèle de
`smsCampaigns.js` : clé, titre et phrase de l'écran, module requis, variables, texte par défaut.

- Lecture d'un texte = `chargerTexteEmail(supabase, orgId, clé)` dans `_shared/mail.ts` : la
  ligne de l'entreprise si elle existe, **sinon le défaut du registre**. `template_missing`
  disparaît pour les e-mails du registre.
- L'écran est dessiné depuis le registre. Ajouter un e-mail = une entrée de registre.
- `proposition_contrat` et `contrat_signature_confirm` reçoivent un défaut neutre (à écrire, à
  relire par Eric) ; la ligne de Mayer passe en `is_transactional = true`.
- Chaque ligne gagne « M'envoyer un essai » (à l'adresse de la personne connectée, données
  d'exemple).

Les textes par défaut déjà écrits (`invoiceEmailTemplate.js`, `pvReception.js`…) restent où ils
sont : le registre les importe.

### 3.4 Des séquences prêtes à activer

Pas de nouveau moteur : campagnes automatiques, segments et `mailing-scheduler` font déjà le
travail.

- Bibliothèque de modèles dans le code (`src/lib/sequencesModeles.js`) : accueil d'un nouveau
  lead, relance « Contacté », relance « Devis envoyé », remerciement après un projet perdu.
  Chaque modèle = texte neutre + définition du segment + cadence par défaut.
- Mailing → un écran « Séquences » : une ligne par modèle, un interrupteur, « dans quel délai »
  (jours mini et maxi), l'heure d'envoi, « Modifier le texte ». Allumer crée la campagne et son
  segment pour l'entreprise ; éteindre met `is_automated` à faux, rien n'est supprimé.
- Allumer exige un domaine vérifié (§ 3.1) ; l'écran le dit et renvoie vers Réglages → Emails.
- Les campagnes actuelles de Mayer sont reconnues par leur clé et ne sont pas touchées.

Hors périmètre : un enchaînement à étapes conditionnelles (« si pas ouvert à J+3, alors… »).
Les délais par statut couvrent les trois séquences qui tournent aujourd'hui.

## 4. Ordre de livraison

| Tranche | Contenu | Ce qu'elle débloque |
|---|---|---|
| 1 | § 3.1 : expéditeur central, adresse de plateforme, statut écrit par le serveur | H&E et Cimaj envoient dès aujourd'hui |
| 2 | § 3.3 : registre, défaut sans clic, deux textes manquants, essai | plus aucun `template_missing` |
| 3 | § 3.2 : hébergeur détecté, page pour le prestataire, vérification seule | passage au domaine propre sans nous |
| 4 | § 3.4 : séquences à activer | relances pour toute entreprise |

Chaque tranche se vérifie seule : tests des modules purs, répétition des migrations sur le
harnais, puis un envoi réel depuis une organisation d'essai.

## 5. À décider par Eric

1. **Le domaine de la plateforme** d'où partent les e-mails par défaut (un domaine à lui, à
   vérifier une fois dans Resend ; secret `MDH_PLATFORM_FROM_EMAIL`). Sans lui, la tranche 1 ne
   peut pas partir.
2. **Envois en nombre réservés au domaine propre** : d'accord, ou veut-il les ouvrir aussi depuis
   l'adresse commune avec un plafond ?
3. **Offre Resend** : combien de domaines le compte permet aujourd'hui.

## 6. Risques

- Réputation du domaine commun : limitée aux e-mails individuels ; un taux de rebond anormal
  d'une entreprise doit pouvoir lui couper l'adresse commune (réglage serveur, pas d'écran).
- Onze edges à redéployer en tranche 1 : sur le oui d'Eric, une par une, envoi d'essai après
  chacune.
- Le défaut sans clic change le comportement de Mayer pour les cinq e-mails qu'il n'a jamais
  créés (ils partiront avec le texte par défaut au lieu d'être refusés) : textes à relire avant.
