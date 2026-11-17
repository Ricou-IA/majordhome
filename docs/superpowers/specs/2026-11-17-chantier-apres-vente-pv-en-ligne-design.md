# Après-vente du chantier et PV de réception signé en ligne

Date : 2026-11-17 · Demandeur : Eric · Module : Chantiers

## Pourquoi

« Réceptionné » est la première étape de l'après-vente, et aujourd'hui elle ne porte rien :

- le PV de réception n'est presque jamais fait sur place par les techniciens — **0 PV sur 67
  chantiers réceptionnés** (mesuré le 2026-11-17), tous passés par « Valider la réception sans PV » ;
- la demande d'avis par SMS n'existe que pour les entretiens ;
- « Proposer un contrat » est caché dans la fiche, rien ne dit sur la carte si c'est fait
  (12 chantiers réceptionnés sur 67 ont un contrat) ;
- la facturation est connue (66 / 67 facturés dans Pennylane) mais pas montrée ; le paiement n'est
  connu nulle part.

## Ce que veut Eric (ses mots, 2026-11-17)

- Passer de Planifié à Réceptionné par le PV de réception ; prévoir **un envoi du PV au client**,
  qui le **signe en ligne** (réponse du 2026-11-17).
- Sur un chantier réceptionné : envoyer le SMS « comme sur entretien, mais pour la pose »,
  proposer le contrat d'entretien, suivre la facturation et la mise en paiement.

## Non-objectifs

- Pas de facture émise par Majord'home (décision du 2026-10-10 : Pennylane facture).
- Pas d'envoi automatique du PV : c'est un geste du bureau, après la pose.
- Le PV signé sur place (tablette, deux signatures) reste tel quel.

## Approches pour le PV à distance

1. **Lien signé, page sans compte, signature enregistrée en base** (retenue). Même patron que la
   prise de RDV en ligne (`/rdv/:token`, edge `auto-rdv`) : jeton HMAC sans état, l'organisation est
   dérivée du chantier porté par le jeton. La réponse du client (choix, réserves, nom, signature)
   est la donnée de référence ; le PDF en est un rendu, produit à la demande.
2. PDF fabriqué dans le navigateur du client puis téléversé. Écartée : le document de référence
   serait un fichier produit par un poste que nous ne maîtrisons pas, et un client qui ferme la page
   trop tôt laisse un chantier « signé » sans document.
3. Service de signature tiers. Écartée : coût par signature et dépendance pour un document qui n'a
   pas besoin d'une signature qualifiée (le PV sur tablette n'en a pas non plus).

## Tranche 1 — repères d'après-vente et SMS après pose

- **Carte Réceptionné** : la dernière ligne ne montre plus les commandes (Éq. / Mat., sans objet
  après la pose) mais quatre repères : `PV`, `Avis`, `Contrat`, `Facturé`. Fait = pastille pleine,
  pas fait = pastille vide ; l'infobulle dit l'état en toutes lettres.
- **SMS après pose** : campagne `avis_pose` du registre `src/lib/smsCampaigns.js`, gabarit saisi
  dans Paramètres → SMS (jamais un texte en dur). Même envoi que l'avis d'entretien
  (`savService.sendAvisRequest`, paramètre `campaign`). Bouton sur la carte et dans la fiche.
- **Déjà demandé** : dérivé de `majordhome_sms_logs` (`campaign_name = 'avis_pose'`, par client).
  Liste inconnue (chargement, erreur) ⇒ bouton verrouillé : on ne devine pas.
- **Contrat** : lu dans `majordhome_contracts` par client (`active` = signé, `pending` = proposé).
- **Fiche** : une section « Après-vente » (avis, contrat, facturation) remplace le bloc
  « Contrat d'entretien ».
- Règles pures : `src/lib/chantierApresVente.js`, testées.

## Tranche 2 — PV de réception signé en ligne

### Parcours

1. Fiche d'un chantier Planifié (ou Réceptionné sans PV) → « Envoyer le PV au client » : e-mail au
   client avec un lien. « Copier le lien » pour l'envoyer autrement (SMS, WhatsApp).
2. Le client ouvre le lien sur son téléphone : entreprise, objet des travaux, adresse, jours de
   pose. Il choisit « sans réserve » ou « avec réserves » (il les décrit), coche ce qu'il a reçu
   (informations, notices, consignes d'entretien), écrit son nom et signe au doigt.
3. La signature est enregistrée ; un chantier Planifié passe en Réceptionné. Un PV avec réserves
   est une réception : le chantier passe aussi, la carte porte « Réserves ».
4. Le bureau voit dans la fiche : envoyé le…, ouvert le…, signé le… par…, et les réserves.
   « Voir le PV » produit le PDF depuis l'enregistrement et l'archive (`pv_reception_path`).
5. Le client peut télécharger son PV depuis la page, juste après avoir signé.

### Données

- `majordhome.chantier_pv` (une ligne par chantier) : envoi (`sent_at`, `sent_to`, `sent_by`,
  `sent_count`), ouverture (`opened_at`), signature (`signed_at`, `signataire_nom`,
  `signature_png`, `reception_type`, `reserves_nature`, `reserves_travaux`, `info_recues`,
  `notices_recues`, `entretien_recues`). Lecture : membres de l'org. **Aucune écriture par
  l'application** : trois RPC `service_role` (`chantier_pv_contexte`, `chantier_pv_marquer_envoi`,
  `chantier_pv_signer`). Une ligne signée ne se supprime pas (trigger).
- `majordhome_chantiers` gagne en fin de liste `pv_sent_at`, `pv_signed_at`, `pv_avec_reserves`
  (l'image de la signature n'est jamais dans la liste du board).
- Vue `majordhome_chantier_pv` (lecture seule) pour produire le PDF côté bureau.

### Edge `chantier-pv` (`verify_jwt = false`, comme `auto-rdv`)

| Action | Qui | Effet |
|---|---|---|
| `envoyer` | membre + `user_can(chantiers, edit)` + module Communication | e-mail (gabarit `pv_reception`), trace `mailing_logs`, `marquer_envoi` |
| `lien` | membre + `user_can(chantiers, edit)` | rend le lien, sans rien envoyer |
| `GET ?token=` | public | ce que la page affiche ; note l'ouverture |
| `signer` | public | enregistre la signature, fait avancer le chantier |

- Jeton `pv.<chantier_id>.<exp>.<sig>`, HMAC-SHA256, valable 60 jours, sans état (rien n'est
  stocké : un lien se recalcule à la demande). Secret : `MDH_PV_SECRET` s'il est posé, sinon
  `MDH_AUTO_RDV_SECRET` — le préfixe signé (`pv.` / `rdv.`) sépare les deux usages.
- L'adresse e-mail est relue EN BASE, jamais prise dans la requête.
- La page publique ne reçoit ni montant, ni note interne, ni téléphone du client.
- Signature : image PNG en data URL, 300 Ko au plus ; textes bornés ; débit limité par jeton.
- Déjà signé ⇒ la page le dit et n'accepte pas une seconde signature.

### Gabarit d'e-mail

`pv_reception`, transactionnel, créé d'un clic dans Paramètres → Communication → Emails
(`src/lib/pvReceptionEmailTemplate.js`, copié pour Deno). Variables : `{{PRENOM}}`, `{{OBJET}}`,
`{{LIEN_PV}}` + celles de l'identité de l'entreprise. Gabarit absent ⇒ code `template_missing`,
dit à l'écran ; « Copier le lien » reste possible.

## Tranche 3 — paiement (non cadrée ici)

Deux voies à trancher avec Eric : lire le paiement dans Pennylane (les factures ne sont pas
recopiées dans Majord'home), ou un geste « Encaissé » comme sur les cartes d'entretien, qui clôt la
carte (le statut `facture` existe déjà, sa colonne est masquée, aucun chantier n'y est).

## Choix faits sans Eric (à confirmer)

- Envoi du PV = geste manuel du bureau, pas d'envoi automatique le lendemain de la pose.
- Un PV avec réserves fait passer le chantier en Réceptionné.
- Le PV en ligne ne porte que la signature du client (pas celle du technicien).
- Lien valable 60 jours.
- Le SMS d'avis part d'un clic sur la carte, sans confirmation, comme pour les entretiens.

## Livré le 2026-11-17

- Tranche 1 : commit `52692146`. Tranche 2 : migration `20261117_3` (répétée sur
  `assert-chantier-pv.sql`, appliquée en production), edge `chantier-pv` déployée, page `/pv/:token`.
- **Pas de secret dédié** : la CLI Supabase demande l'accord explicite d'Eric pour écrire un secret
  en production. Le lien est signé avec `MDH_AUTO_RDV_SECRET` (préfixe `pv.`). Poser
  `MDH_PV_SECRET` plus tard invalide les liens déjà envoyés.
- **Non essayé en réel** : l'envoi de l'e-mail, l'ouverture d'un vrai lien et une vraie signature
  (il faut un compte utilisateur et un client). Essayés : les refus de l'edge en production, le
  jeton en local, les trois RPC et les droits sur la copie locale de la base.
- La copie déployée de l'edge diffère du dépôt par un message d'écran de `pvReception.js` (retouché après
  le déploiement, non lu par l'edge) et par l'en-tête de commentaires de `modules.js` : sans effet, à
  réaligner au prochain déploiement.
- Le gabarit d'e-mail `pv_reception` et le texte du SMS `avis_pose` restent à créer par Eric
  (Paramètres → Communication → Emails, et → SMS & WhatsApp).

## Laissé au constructeur

Mise en page de la page publique, libellés exacts, découpage des composants.
