# Créateur de mail sur une page, habillage réglé une fois — conception

> 2026-11-21 — demandé par Eric : « trop d'étapes, trop compliqué ; le modèle de Baikal me semble plus
> adapté ; deux aspects, la forme et le fond ; l'utilisateur ne doit pas se galérer avec le HTML ; il faut
> que ce soit visuellement satisfaisant ».
> Décidé avec lui le même jour : **la forme est un habillage réglé une fois pour l'entreprise**, pas une
> mise en page par mail. Les deux écrans ont été maquettés et acceptés (« Oui, rédige »).

## 1. Intention

Créer un mail doit tenir sur **un écran** : à gauche ce qu'on règle (à qui, quoi, quand), à droite le mail
tel qu'il arrivera. L'utilisateur ne voit jamais de HTML, ne copie rien vers un autre outil, ne change pas
d'onglet pour envoyer.

Deux choses séparées :

- **La forme** = l'habillage de l'entreprise (logo, couleurs, bandeau, pied de page). Réglé une fois dans
  les Réglages, appliqué à **tous** les e-mails, campagnes comme e-mails automatiques.
- **Le fond** = le texte du mail, écrit dans un éditeur de texte simple (gras, liste, lien, titre, bouton,
  encadré, variables en étiquettes), avec une rédaction assistée dans l'application.

Pourquoi maintenant : une seconde entreprise (Cimaj) arrive, sans personne pour lui fabriquer du HTML ;
elle n'a aujourd'hui que l'habillage neutre, sans pouvoir le changer.

## 2. État actuel (mesuré le 2026-11-21)

**Parcours d'une campagne aujourd'hui** : onglet Segments (créer le segment) → onglet Éditeur → assistant
en trois étapes (`CampaignWizard.jsx`, 691 lignes) : *Identité* (libellé, objectif, cible, notes, ton,
automatisation), *Brief*, *Génération* (copier une consigne, la coller dans Claude ailleurs, recoller le
HTML obtenu) → onglet Envoi (`SendTab.jsx`) : rechoisir la campagne et le segment, tester, lancer.

**La forme n'a aucun écran.** `settings.email_skeleton_html` est un bloc de HTML posé à la main (Mayer,
2 325 caractères : logo centré, bande `{{SECONDARY_COLOR}}` avec `{{EMAIL_TAGLINE}}`, pied avec téléphone,
e-mail, site, adresse et lien de désabonnement). `accent_color`, `secondary_color` et `email_tagline`
n'ont pas d'écran non plus. Une entreprise sans habillage reçoit `habillageNeutre` (`_shared/mail.ts`),
qui **n'affiche aucun lien de désabonnement** (seul l'en-tête technique `List-Unsubscribe` est posé).

**Campagnes en base** :

| Entreprise | Campagnes | Pages HTML complètes | Texte seul |
|---|---|---|---|
| Mayer | 27 | 16 | 11 |
| Cimaj | 2 | 0 | 2 |

- Les 11 textes seuls de Mayer n'utilisent que `p`, `br`, `strong`, `a`, `div`, avec parfois un bouton
  écrit `<a style="background:{{ACCENT_COLOR}};…">` dans un `<p style="text-align:center">`.
- Les 16 pages complètes sont : 9 campagnes manuelles, les 4 séquences vers les prospects, 2 autres
  campagnes et `proposition_contrat`. Elles partent telles quelles (`wrapWithSkeleton` ne touche pas un
  HTML complet).

**Chaîne d'envoi** (inchangée par ce chantier, sauf l'habillage) :

- `mailing-send` reçoit `{ mode, segment_id, subject, html_body, campaign_name, test_email? }` du
  navigateur, ou est appelée par `mailing-scheduler` pour une campagne automatique. Elle habille
  (`wrapInSkeleton`), remplace les variables de marque, `{{SALUTATION}}` (« Bonjour Prénom Nom, », ou
  « Bonjour, » sans nom), `{{CLIENT_NAME}}`, `{{lien_pellets}}`, et remplace
  `mailto:<adresse de l'entreprise>?subject=Désabonnement` par le vrai lien de désabonnement.
- **Le journal des envois est tenu par le NOM de la campagne** (`campaign_name` = libellé) : l'anti-doublon
  d'un envoi par vagues et les statistiques en dépendent.
- Les e-mails automatiques (RDV, PV, facture, contrat, SAV, DPE…) sont habillés par `wrapWithSkeleton`
  de `_shared/mail.ts` dans leurs propres edges ; leur texte est celui de l'entreprise
  (`mail_campaigns`, `is_transactional`) s'il existe, sinon le défaut du registre
  `src/lib/emailsAutomatiques.js`.

**Baikal** (`C:\Dev\Frontend-Baikal\src\components\console\mailing\`) : `EditeurCampagne.jsx` (une page,
trois cartes numérotées Destinataires / Message / Envoi, aperçu collant à droite avec De, Objet, « Exemple
pour … », bascule ordinateur / téléphone) et `EditeurTexte.jsx` (150 lignes, `contentEditable`, variables
en étiquettes non éditables, coller = texte seul, HTML jamais montré). C'est le modèle à reprendre.

## 3. Buts, hors périmètre, à ne surtout pas faire

**Buts**

1. Une page par mail, trois cartes au plus, aperçu fidèle en direct.
2. Aucun HTML visible, aucun copier-coller vers un outil extérieur.
3. Un écran d'habillage, utilisable par une entreprise qui arrive, appliqué à tous ses e-mails.
4. Le même écran sert aux campagnes, aux séquences et aux e-mails automatiques (« Modifier le texte »).
5. Rien de ce qui part aujourd'hui ne cesse de partir, ni ne change d'aspect sans un geste de l'entreprise.

**Hors périmètre**

- Images dans le texte (hors logo de l'habillage), colonnes, mise en page par glisser-déposer.
- Séquences à plusieurs relances, plafond d'envois par jour, envoi en jours ouvrés (présents dans Baikal).
- Refonte du constructeur de segments (`SegmentBuilderDrawer.jsx`) et de l'onglet Stats.
- Nouvelle variable « prénom seul » dans les campagnes : la salutation reste `{{SALUTATION}}`, qui sait
  quoi écrire quand le nom manque. *(Différence avec la maquette, qui montrait « Bonjour [Prénom], ».)*
- E-mails de la boutique : ils s'ouvrent dans le nouvel éditeur comme tout texte, leur écran de réglage
  ne change pas.

**À ne surtout pas faire**

- Un aperçu qui diffère de ce qui part. L'habillage et le remplacement des variables de l'aperçu sont le
  **même code** que celui de l'envoi.
- Renommer une campagne qui a déjà été envoyée (le journal est tenu par son nom).
- Un compteur de destinataires qui ne soit pas celui de l'envoi : seules les RPC existantes
  (`mail_segment_count`, `mail_segment_preview`) comptent et listent.
- Perdre le HTML d'une ancienne campagne.
- Laisser le texte rendu par l'IA partir sans passer par la même normalisation qu'un texte tapé.

## 4. Approches

| | Approche | Pour | Contre |
|---|---|---|---|
| **A — retenue** | Éditeur maison repris de Baikal (`contentEditable`), enrichi de Titre et Encadré. Habillage décrit par quelques choix, **rendu au moment de l'envoi** par un module pur partagé navigateur ↔ edges. | Aucune bibliothèque ; déjà éprouvé dans Baikal ; aperçu et envoi partagent le code. | `document.execCommand` est ancien ; peu d'éléments possibles. |
| B | Bibliothèque d'édition (TipTap). | Copier-coller, annulation et éléments sur mesure plus solides. | Dépendance et poids en plus, davantage de travail. À reprendre si A montre ses limites. |
| C | Constructeur par glisser-déposer (Unlayer, MJML…). | Mise en page libre. | C'est la « mise en page par mail » qu'Eric a écartée. |

Choisie par Eric dans la conversation : A (présentée comme mon choix, acceptée avec les maquettes).

**Un point a changé depuis la conversation.** J'avais annoncé qu'aucune fonction d'envoi ne serait à
modifier, l'écran d'habillage écrivant un HTML tout fait dans `email_skeleton_html`. À l'étude, cette
copie se périme dès que le logo, les coordonnées affichées ou les certifications changent. L'habillage est
donc **rendu au moment de l'envoi** à partir des choix enregistrés, ce qui demande de modifier
`_shared/mail.ts` et `mailing-send`, puis de redéployer les edges qui envoient (une fois, sur le oui
d'Eric). C'est mon choix, à confirmer par lui à la relecture.

## 5. Conception

### 5.1 La forme : habillage de l'entreprise

**Écran** : Réglages → E-mails & SMS → onglet E-mails, section « Habillage des e-mails », org_admin.
Réglages à gauche, aperçu en direct à droite sur un mail d'exemple (titre, paragraphe, encadré, bouton).

| Réglage | Clé | Remarque |
|---|---|---|
| Logo | `logo_url` | Lecture seule ici, lien vers Organisation → Identité. Sans logo : le nom de l'entreprise. |
| En-tête | `email_habillage.entete` = `logo` \| `logo_bandeau` | |
| Phrase du bandeau | `email_tagline` | Affichée si l'en-tête a un bandeau. |
| Couleur du bandeau | `secondary_color` | |
| Couleur des boutons et des liens | `accent_color` | **C'est aussi la couleur des pages publiques** (`/rdv/:token`, `/pv/:token`) : l'écran le dit. |
| Pied de page | `email_habillage.pied` = `{ coordonnees, certifications, site }` (booléens) | Le lien de désabonnement est toujours présent, non décochable. |

Couleurs : quelques pastilles proposées et un choix libre. Le texte d'un bouton reste blanc ; l'écran
avertit quand la couleur choisie rend ce blanc peu lisible (calcul de contraste, même seuil de 4,5:1 que
`teintesDeMarque` de `src/lib/pagePublique.js`).

**Enregistrement** : `useOrgSettings().save({ email_habillage, accent_color, secondary_color,
email_tagline })`. `email_habillage` est toujours envoyé entier (fusion JSONB de niveau 1).
`email_skeleton_html` n'est **jamais** écrit ni effacé par l'écran.

**Rendu** : module pur `src/lib/mailHabillage.js`, copié pour Deno (`PARTAGES` de
`sync-tournee-engine.mjs`), testé `scripts/mail-habillage.test.mjs`.

```
habillerMail(reglages, corps) → HTML complet
```

Ordre de décision, **seule définition**, utilisée par l'aperçu et par les edges :

1. `corps` est déjà une page complète (`<html` ou `<!doctype`) → rendu tel quel.
2. `reglages.email_habillage` est un objet → habillage construit depuis ses choix.
3. sinon `reglages.email_skeleton_html` contient `{{EMAIL_BODY}}` → ancien habillage (Mayer aujourd'hui).
4. sinon → habillage construit avec les choix par défaut (`logo`, pied avec coordonnées).

Conséquences voulues : rien ne change pour Mayer tant qu'un administrateur n'a pas enregistré l'écran ;
« Revenir à l'ancien habillage » = enregistrer `email_habillage: null` (proposé seulement si
`email_skeleton_html` existe) ; une entreprise sans rien (Cimaj) passe du neutre actuel à l'habillage par
défaut, qui porte désormais un lien de désabonnement visible.

L'habillage construit pose ses valeurs lui-même, échappées (comme `habillageNeutre` aujourd'hui), à une
exception près : le lien de désabonnement est écrit sous la forme
`mailto:<adresse de l'entreprise>?subject=Désabonnement`, que `mailing-send` remplace déjà par le vrai
lien. Dans un e-mail automatique, il reste un lien d'écriture à l'entreprise, comme aujourd'hui chez Mayer.
Mise en page en tableaux, styles en ligne, largeur 600 px, police Arial : les contraintes des messageries.

**Un seul lien de désabonnement.** Si le corps porte déjà ce lien (`mailto:…?subject=Désabonnement`,
avec ou sans accent) — c'est le cas des textes par défaut des séquences (`PIED` de `sequencesEmails.js`)
et des lignes déjà enregistrées qui en sont issues — le pied construit n'en ajoute pas. Les textes par
défaut des séquences ne sont pas modifiés dans ce chantier : un défaut sans lien lu par une edge pas
encore redéployée partirait sans aucun lien, ce qui est pire que deux.

**Valeurs de marque : une seule définition.** Les variables de marque (`{{BRAND_NAME}}`,
`{{ACCENT_COLOR}}`…) sont aujourd'hui calculées en trois endroits qui ne donnent pas le même résultat
(`_shared/mail.ts` : nom vide par défaut ; `mailing-send` : « Majord'home » ; `contract-signed-notify` :
nom de l'organisation ; couleur des boutons `#f97316` dans les edges, `#64748b` dans `orgBranding.js`).
`mailHabillage.js` porte `valeursDeMarque(reglages)`, que les trois edges et l'aperçu appellent. Défauts
retenus, neutres : nom vide, boutons et liens `#64748b`, bandeau `#334155`. Effet : une entreprise sans
couleur réglée (Cimaj aujourd'hui) voit ses boutons d'e-mail passer de l'orange et du bleu de Mayer au
gris ardoise, jusqu'à ce qu'elle choisisse ses couleurs. Mayer, qui a ses deux couleurs, ne change pas.

**Côté edges** : `wrapWithSkeleton` de `_shared/mail.ts`, `wrapInSkeleton` de `mailing-send` et la règle
propre à `contract-signed-notify` (qui laisse aujourd'hui partir le corps nu sans `email_skeleton_html`)
délèguent à `habillerMail` : plus de `habillageNeutre`, plus de seconde ni de troisième règle. Les douze
edges qui embarquent `_shared/mail.ts` (`auto-rdv`, `auto-rdv-cron`, `chantier-pv`,
`contract-signed-notify`, `dpe-lien`, `email-essai`, `invoice-send`, `lead-welcome-email`, `mailing-send`,
`maintenance-digest`, `sav-report-send`, `webshop-process`) sont redéployées **avant** que l'écran soit
livré : tant que personne n'a de `email_habillage`, leur comportement ne change que pour une entreprise
sans habillage (cas 4) et par les défauts neutres ci-dessus.

**Deux e-mails échappent à l'habillage** : `webshop_confirmation` et `webshop_feuille_route` sont rendus
et habillés par le site vitrine (`lib/boutique/emails.ts` du dépôt du site), qui ne remplace que
`BRAND_NAME`, `ORG_EMAIL` et `ORG_PHONE`. Le site n'est pas modifié par ce chantier (voir § 5.3 et 5.4
pour ce que l'éditeur en déduit).

### 5.2 Le fond : format du texte

`mail_campaigns.html_body` reste la donnée. Un texte écrit avec le nouvel éditeur est un **HTML
restreint**, avec ses styles en ligne déjà posés (une messagerie n'a pas de feuille de style) :

| Élément | Balise enregistrée |
|---|---|
| Paragraphe, retour à la ligne | `p`, `br` |
| Gras, italique | `strong`, `em` |
| Listes | `ul`, `ol`, `li` |
| Lien | `a[href]` |
| Titre | `h2` |
| Bouton | `p` centré contenant `a[data-bouton]`, fond `{{ACCENT_COLOR}}`, texte blanc |
| Encadré | `div[data-encadre]`, liseré `{{ACCENT_COLOR}}`, fond gris clair |
| Variable | `{{NOM}}` en clair dans le texte ou dans l'adresse d'un lien |

Module pur `src/lib/mailCorps.js` (testé `scripts/mail-corps.test.mjs`, copié pour Deno) — il travaille
sur des chaînes avec un petit analyseur de balises, pas sur le DOM, pour tourner sous `node --test` et
dans une edge :

- `estEditable(html)` : vrai si le texte ne contient que les éléments ci-dessus. Lecture **tolérante** de
  l'existant : les styles sont ignorés, un `a` qui porte un style de fond est lu comme un bouton, un `div`
  est lu comme un encadré, un `p` centré est accepté.
- `normaliser(html)` : remet un texte éditable dans la forme enregistrée (balises permises, attributs
  permis, styles en ligne reposés, tout le reste retiré). `normaliser(normaliser(x)) === normaliser(x)`.
- `variablesDe`, `texteBrut` (pour un compteur de longueur ou un extrait).

**Variable-bloc.** Une variable posée seule à la racine du texte, hors de tout paragraphe (`{{ITEMS}}`,
`{{DELIVERY_INFO}}`, `{{LEGAL_INFO}}`, `{{PARCELS_TABLE}}`, `{{ARRETS}}` des gabarits de la boutique, qui
deviennent des tableaux ou des paragraphes à l'envoi), **reste nue à la racine** : `normaliser` ne
l'emballe jamais dans un `p`. Du texte tapé à la racine, lui, est mis en paragraphe.

Tests à tenir : tout texte par défaut du registre (`EMAILS_AUTOMATIQUES`, séquences, gabarits de la
boutique) est éditable ; un texte fait seulement de `p`, `br`, `strong`, de variables et de
variables-blocs ressort de `normaliser` identique aux blancs près (les textes actuels de Mayer et de
Cimaj ne changent donc pas à leur premier enregistrement) ; une page complète n'est pas éditable ; aucune
balise `script`, `style`, `iframe`, `img`, aucun attribut `on…` ni adresse `javascript:` ne survit à
`normaliser`.

### 5.3 L'éditeur de texte

Composant `EditeurTexte` (repris de Baikal, aux couleurs de l'application) :

- Barre : Gras, Italique, Liste, Lien, puis Titre, Bouton, Encadré, puis les variables du mail en
  étiquettes « + … ».
- Une variable est une étiquette non éditable qui porte un libellé d'artisan (« Salutation », « Nom du
  client », « Lien du PV »…). Les libellés sont dans un module pur (`src/lib/mailVariables.js`) ; une
  variable sans libellé affiche son nom brut. Variables proposées : pour une campagne ou une séquence,
  `{{SALUTATION}}`, `{{CLIENT_NAME}}` et celles de `VARIABLES_MARQUE` utiles dans un texte (nom, téléphone,
  site, e-mail) ; pour un e-mail automatique, celles de son `exemple` au registre, plus les mêmes
  variables de marque ; pour un gabarit de la boutique, celles déjà présentes dans son texte.
- Lien et Bouton s'ajoutent par une petite fenêtre dans la page (pas `window.prompt`) : texte, adresse ;
  l'adresse peut être une variable de lien du mail.
- Une variable-bloc (§ 5.2) s'affiche comme une étiquette sur sa propre ligne, non éditable ; elle se
  déplace et se supprime comme aujourd'hui dans le HTML. La carte Message **avertit** quand une variable du
  texte par défaut de ce mail n'est plus dans le texte (« Ce mail n'affiche plus : Mentions légales »),
  sans empêcher d'enregistrer.
- Pour les deux e-mails habillés par le site (`webshop_confirmation`, `webshop_feuille_route`), Titre,
  Bouton et Encadré ne sont pas proposés : leurs couleurs passent par `{{ACCENT_COLOR}}`, que le site ne
  remplace pas. La liste de ces clés vit à côté des gabarits de la boutique, pas dans l'écran.
- Coller = texte seul. Le composant émet toujours `normaliser(...)`.
- Il n'est relu depuis l'extérieur que sur un changement de version (ouverture, rédaction par l'IA), sinon
  le curseur saute.

### 5.4 La page du mail

Onglets de `/mailing` : **Campagnes**, Stats, Segments. L'onglet Envoi et l'assistant en trois étapes
disparaissent. La liste des campagnes garde ses trois groupes (Automatiques, Transactionnelles,
Manuelles) et ses cartes ; « Éditer » et « Nouvelle campagne » ouvrent la page du mail, en pleine page.
Le lien existant `/mailing?tab=editor&edit=<clé>` (Réglages → E-mails & SMS, « Modifier le texte »)
continue d'ouvrir le bon mail.

En tête : nom du mail, « Enregistrer ». À gauche les cartes, à droite l'aperçu collant.

**Selon la nature du mail**

| Nature | Carte 1 Destinataires | Carte 2 Message | Carte 3 Envoi |
|---|---|---|---|
| Campagne manuelle | oui | oui | Une fois / Automatique |
| Campagne automatique hors registre | oui | oui | Automatique (cadence) |
| Séquence du registre (`sequence_…`) | lecture seule, lien vers Réglages | oui | lecture seule, lien vers Réglages |
| E-mail automatique du registre | absente | oui | « M'envoyer un essai » seulement |
| Gabarit de la boutique (hors registre) | absente | oui | absente (pas d'essai, comme aujourd'hui : `email-essai` refuse une clé hors registre) |

Les séquences gardent leur interrupteur, leur délai et leur segment dans `SequencesSection` : une seule
définition, la page n'y touche pas.

**Carte 1 — Destinataires.** La liste des segments enregistrés, rangés Clients / Prospects, un seul
choisi (`auto_segment_id`). Le nombre de destinataires du segment choisi vient de `useSegmentCount` avec
le nom de la campagne (donc sans ceux à qui elle a déjà écrit). « Voir des exemples » : les vingt premiers
(`useSegmentPreview`). « Nouveau segment » ouvre `SegmentBuilderDrawer` sur place ; à l'enregistrement, le
segment créé est choisi. Nombre inconnu (chargement, erreur) ⇒ rien d'affiché et « Lancer » fermé, jamais 0.

**Carte 2 — Message.**

- Rédaction assistée (§ 5.5) : deux lignes d'intention (`blocks.brief`), « Rédiger », puis « Plus court »,
  « Plus chaleureux », « Reformuler » quand un texte existe.
- Objet, avec « Proposer » (trois objets au choix) et un rappel au-delà de 50 caractères.
- L'éditeur de texte.
- Les champs objectif, cible, notes, ton et déclencheur ne sont plus affichés ni écrits ; les colonnes
  restent.

**Ancien format.** Si `estEditable(html_body)` est faux : l'objet reste modifiable, le texte ne l'est pas,
l'aperçu le montre tel quel, et un bandeau dit « Ce mail a été fait avec l'ancien outil. Il part tel
quel. » avec « Refaire avec le nouvel éditeur ». Ce geste, confirmé, range l'ancien HTML dans
`blocks.ancien_html` puis remplace le texte par le défaut du registre si la clé y est, sinon par un texte
vide ; « Revenir à l'ancien » le restaure tant que `blocks.ancien_html` existe.

**Carte 3 — Envoi.**

- *Une fois* : adresse de test, « Tester », « Lancer » avec confirmation (nom du segment, nombre), envoi
  par vagues avec progression et reprise sans doublon — la logique de `SendTab.jsx` déplacée telle quelle
  dans un hook (`useEnvoiCampagne`), seule définition.
- *Automatique* : tous les N jours, heure d'envoi ; segment obligatoire. À l'activation,
  `next_run_at = maintenant`, comme aujourd'hui. Une cadence en minutes déjà enregistrée est affichée et
  conservée, sans être proposée.
- Ce qui part est **ce qui est enregistré** : « Tester » et « Lancer » enregistrent d'abord un mail modifié.
- Un envoi à une liste demande le domaine d'envoi de l'entreprise : le refus de `resoudreExpediteur`
  (`usage: 'nombre'`) s'affiche dans la carte dès l'ouverture, avec un lien vers le réglage, au lieu
  d'attendre le clic.

**Nom du mail.** Modifiable tant que la campagne n'a aucun envoi au journal (`majordhome_mailing_logs`,
même `org_id`, `campaign_name` = libellé) ; ensuite verrouillé, avec la raison. Journal illisible ⇒
verrouillé. La clé technique reste dérivée du libellé à la création, jamais affichée. « Dupliquer » ne
demande plus de clé : clé et libellé de la copie sont dérivés (« … (copie) »).

**Aperçu.** En-tête : De (expéditeur résolu par `resoudreExpediteur`, ou le refus), Objet, « Exemple pour
Jean Dupont ». Bascule ordinateur / téléphone (375 px). Le HTML affiché vient d'un module pur
`src/lib/mailApercu.js` : `habillerMail` puis remplacement des variables de marque par les réglages (même
liste que `brandingReplacements`, tenue alignée par un test avec `VARIABLES_MARQUE`) et des autres par des
valeurs d'exemple (`exemple` du registre, « Bonjour Jean Dupont, » pour la salutation). `iframe` avec
`sandbox=""` et `srcDoc`. Sous l'aperçu, pour un org_admin : « Modifier l'habillage ». Les variables de
marque de l'aperçu viennent de `valeursDeMarque` (§ 5.1), le même code que l'envoi ; le test d'alignement
avec `VARIABLES_MARQUE` reste, comme filet. Pour les deux e-mails habillés par le site, l'aperçu montre le
texte sans habillage, avec la mention « Cet e-mail est habillé par votre site ».

**Droits.** org_admin : tout. Les autres rôles gardent ce qu'ils ont aujourd'hui avec l'onglet Envoi :
ils voient les campagnes manuelles, ouvrent la page avec le Message en lecture seule, choisissent les
destinataires, testent et lancent. Le segment qu'ils choisissent **n'est pas enregistré** (il vaut pour
leur envoi, comme aujourd'hui) : seul le choix d'un org_admin devient le segment de la campagne. Le
Message en lecture seule est une garde d'écran, comme aujourd'hui ; ce chantier ne change ni les règles
de la table ni ce que `mailing-send` accepte.

**Enregistrement.** `useMailCampaigns` (existant) ; ne sont écrits que les champs que la page porte.
Quitter avec des modifications non enregistrées demande confirmation.

### 5.5 Rédaction assistée

Edge `mailing-rediger` (`verify_jwt = true`, `requireOrgMembership` org_admin, module Communication
ouvert), réponse HTTP 200 `{ data, error }` où `error` est un code.

- **Entrée** : `{ org_id, consigne, intention, objet, corps, nature, cle?, variables[] }`,
  `consigne` ∈ `rediger | court | chaleureux | reformuler | objets`.
- **Ce que l'edge relit en base, jamais reçu du navigateur** : le nom de l'entreprise, son site, et le
  catalogue d'adresses `settings.mailing_resources` (`getResources`).
- **Rien d'un client ou d'un prospect n'est envoyé au modèle** : ni segment, ni nom, ni adresse.
- **Sortie** demandée en format strict (schéma JSON sans type « valeur ou null » — l'API en refuse plus
  de seize, vécu sur `supplier-offer-import`) : `{ objet, objets[3], corps }`. `objets` seul pour la
  consigne `objets`.
- **Contrôle avant de répondre** : `corps` passe par `normaliser` ; une variable hors de `variables[]` est
  retirée ; un lien dont l'adresse n'est ni une variable ni une adresse du catalogue de l'entreprise ni
  son site est ramené à du texte simple (pas d'adresse inventée).
- **Plafond** par utilisateur et par jour (défaut 50, secret `MAILING_REDACTION_DAILY_LIMIT`) : table et
  RPC `increment_mailing_redaction_quota` sur le modèle d'`increment_equipment_enrich_quota`
  (`service_role` seul), migration versionnée répétée sur le harnais.
- **Modèle** : secret `ANTHROPIC_MAILING_MODEL`, défaut `claude-sonnet-5-5` ; clé `ANTHROPIC_API_KEY` déjà
  en place.
- Règles pures (codes ↔ messages, consigne envoyée au modèle, lecture et contrôle de la réponse) dans
  `src/lib/mailRedaction.js`, copié pour Deno, testé.

À l'écran : « Rédaction… » sur le bouton pendant l'appel, texte et objet remplacés à la réponse,
« Annuler » rend le texte d'avant (un seul retour en arrière suffit). Un refus se dit par son message ;
rien n'est écrit en base par l'edge.

### 5.6 Ce qui est retiré

`CampaignWizard.jsx`, `SendTab.jsx`, `CampaignIdentityPanel.jsx` et la consigne à copier (`buildPrompt`,
`formatResourcesForPrompt` s'il n'a plus d'appelant). `resources.js` reste pour `getResources`.
L'assistant actuel n'est retiré que lorsque la rédaction assistée est en production : entre-temps
personne ne doit se retrouver sans aucune aide à la rédaction.

## 6. Tranches

Chacune se livre seule.

1. **Socle d'habillage** : `mailHabillage.js` (`habillerMail`, `valeursDeMarque`) et son test ;
   `_shared/mail.ts`, `mailing-send` et `contract-signed-notify` délèguent ; synchronisation ;
   redéploiement des douze edges qui envoient (sur le oui d'Eric). Aucun écran.
2. **Rédaction assistée, côté serveur** : migration du plafond, `mailRedaction.js`, edge
   `mailing-rediger` (déployée sur le oui d'Eric).
3. **Page du mail** : `mailCorps.js`, `mailVariables.js`, `mailApercu.js`, `EditeurTexte`, les trois
   cartes, l'ancien format, le hook d'envoi ; onglets ; retrait de l'assistant et de l'onglet Envoi.
4. **Écran d'habillage** dans les Réglages.

Ordre : 1 d'abord (l'aperçu de la page s'appuie sur `mailHabillage.js`, et il ne doit pas précéder les
edges qui rendent pareil), puis 2 et 3 (le mal dont Eric se plaint), puis 4.

## 7. Laissé au constructeur

- Adresse de la page du mail (route dédiée ou état de la page `/mailing`) — toute route nouvelle se déclare
  dans `routes.jsx` et `ROUTES_PAR_MODULE` (module `communication`).
- Découpage en composants (aucun au-dessus de 500 lignes ; l'état du formulaire en `useReducer`).
- Dessin exact de l'habillage construit, des pastilles de couleur et de la fenêtre Lien / Bouton.
- Afficher ou non un nombre sur chaque segment de la liste, au-delà de celui qui est choisi.
- Forme de la table du plafond ; texte de la consigne envoyée au modèle.
- Appel à l'API de Claude : lire la documentation à jour avant d'écrire l'edge.

## 8. Vérification

- `npm run audit:quality` (nouveaux tests inscrits : habillage, corps, aperçu, rédaction, synchronisation
  des copies Deno) et `npx vite build`.
- Habillage : pour Mayer, le rendu de `habillerMail` sans `email_habillage` est **identique au caractère
  près** à celui d'aujourd'hui (test sur son habillage réel, anonymisé si besoin).
- Envoi d'essai d'un e-mail automatique et test d'une campagne vers l'adresse de l'entreprise, avant et
  après enregistrement d'un habillage.
- Les 16 anciennes campagnes de Mayer s'ouvrent en « ancien format » et leur aperçu est inchangé.
- Mise à jour de `CLAUDE.md` (§ Module Mailing) et de `docs/MODULE_MAILING.md` à chaque tranche livrée.
