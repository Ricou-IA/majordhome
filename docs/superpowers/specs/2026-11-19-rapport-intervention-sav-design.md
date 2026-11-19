# Rapport d'intervention SAV — design court

Date : 2026-11-19 · Demande d'Eric : « un rapport SAV c'est bien, et pas trop coûteux à faire », **sans signature du client**.

## Intention

Après un dépannage, remettre au client un rapport d'une page à l'en-tête de l'entreprise, depuis la fiche SAV, sans geste de plus chez le client. Jusqu'ici aucun document ne sortait d'un SAV, et l'ancien écran `/intervention/:id` (rapport, photos, signature, deux boutons N8N) n'est relié à rien et n'a jamais servi.

Constats mesurés en production le 2026-11-19 : 74 demandes SAV, 39 en Réalisé ou facturées, **aucune** avec « ce qui a été fait » saisi. Le rapport doit donc faire écrire ce texte au moment de l'éditer.

## Buts, non-buts

- **But** : sur une carte SAV en Réalisé (ou facturée), un bouton « Rapport d'intervention » qui produit le PDF, l'archive sur la carte, le rend téléchargeable et l'envoie au client par e-mail.
- **Hors périmètre de cette version** : signature du client ; photos avant / après ; prix sur le rapport ; rapport pour un entretien (il a son certificat) ; affichage du rapport sur la carte du kanban ou dans le portail client.
- **À ne pas faire** : reprendre les notes internes de la carte dans un document remis au client ; écrire un rapport dont le texte « travaux réalisés » est vide ; envoyer un rapport qui n'est plus celui affiché.

## Approches

1. **Retenue — lettre d'une page depuis la fiche SAV.** Le contenu se saisit dans une petite fenêtre de la fiche SAV ; le PDF reprend la lettre à l'en-tête déjà utilisée par l'attestation et le certificat allégé ; l'envoi suit le patron des autres e-mails (edge function + Resend + texte modifiable). Aucune migration.
2. Brancher l'ancien écran d'intervention sur le SAV et remplacer ses boutons N8N. Écartée : deux machines d'état (`status` de l'écran, `workflow_status` du kanban), deux saisies de « ce qui a été fait », deux listes de pièces, et un parcours technicien à faire adopter.
3. PDF seul, sans e-mail. Écartée : Eric a demandé l'envoi sans N8N, et le patron d'envoi existe.

## Design

- **Où** : pied de la fiche SAV (`EntretienSAVModal`), bouton « Rapport d'intervention », visible pour une carte `sav` racine en `realise` ou `facture`, à qui peut modifier la carte (`sav.edit` ou `entretiens.edit`, donc bureau et technicien).
- **Fenêtre `RapportSavDialog`** : date d'intervention (dernier RDV de la carte, jamais future), intervenant(s) (noms des techniciens de ce RDV, modifiables), appareil (celui de la carte, sinon l'unique équipement du client, sinon aucun), problème signalé (repris de la demande, modifiable), **travaux réalisés (obligatoire)**, pièces remplacées (pièces identifiées de la carte, cochées, décochables), observations (facultatif).
  - Mon choix : les pièces identifiées sont **cochées d'office** — sur un SAV réalisé ce sont presque toujours celles posées, et la fenêtre les montre avant l'édition. À revoir si Eric préfère les cocher à la main.
  - Liste des pièces ou RDV illisible ⇒ édition fermée, avec le motif : jamais un rapport amputé sans le dire.
- **Contenu figé** : le PDF archivé est le document de référence. Ce qui a servi à l'écrire est gardé dans `interventions.metadata.rapport_sav = { path, edite_le, edite_par, contenu, envoye_le?, envoye_a? }` (colonne existante, aucune migration). « Travaux réalisés » est aussi écrit dans `work_performed` (la colonne faite pour cela). Les observations ne vont **que** dans `contenu` : `report_notes` porte les notes internes de la carte.
- **PDF** : module pur `src/lib/rapportSavModel.js` (`contenuInitial`, `validerContenu`, `buildRapportSav` → `lettre`), rendu par `AttestationEntretienPDF` (inchangé, sauf un titre de document paramétrable). Texte PDF-safe (Helvetica).
- **Archivage** : dossier `interventions`, chemin fixe `${orgId}/${projectId}/${interventionId}/rapport-intervention.pdf` (org CORE en tête, remplacé à chaque édition) — `buildInterventionReportPath` de `src/lib/interventionStoragePath.js`, partagé avec l'edge.
- **E-mail** : edge function `sav-report-send` (`verify_jwt = true`, membre de l'org, module Communication, `user_can(sav | entretiens, edit)`). Elle relit la carte en base, dérive elle-même le chemin du PDF (jamais reçu de la requête), n'écrit qu'à l'adresse du client de la carte, joint le PDF archivé et utilise le gabarit transactionnel `rapport_sav` (Paramètres → Communication → Emails). Trace `mailing_logs` `campaign_name = 'rapport_sav'`. Réponses `{ data, error: code }`, codes traduits par `messageErreurRapportSav` (`src/lib/rapportSav.js`, copié pour Deno).
  - L'envoi est fermé tant que la saisie affichée diffère du rapport archivé (« Mettez à jour le rapport avant de l'envoyer »).
  - Après un envoi réussi, l'écran note `envoye_le` / `envoye_a` sur la carte ; si cette note échoue, l'envoi est dit fait et la note manquante est signalée.
- **Déploiement** : le front se livre seul (édition et téléchargement). L'edge function ne se déploie que sur le oui d'Eric ; avant, « Envoyer au client » répond « envoi pas encore en service ».

## Laissé à la suite

Photos avant / après sur le rapport ; signature du client sur place ; repère « rapport édité / envoyé » sur la carte ; retrait de l'ancien écran `/intervention/:id` et de ses webhooks N8N ; bouton « Envoyer par mail » de la fiche d'un entretien réalisé, qui n'affiche aujourd'hui qu'un message d'attente.
