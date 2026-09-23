# Envoi de la facture d'entretien au client par e-mail (Resend) avec certificats joints — Design

**Date** : 2026-09-23 · **Décideur** : Eric · **Statut** : validé en conversation, à implémenter.

## Décision

Depuis la modale « Facturer » d'une carte entretien : une coche **« Envoyer au client par e-mail »** et la **liste des certificats d'entretien de l'intervention à joindre**. L'e-mail part par **Resend**, depuis le domaine de l'org, avec la facture en pièce jointe et les certificats cochés. Ces options n'existent que si le **module Communication** est ouvert pour l'org.

Pourquoi Resend et pas Pennylane : la facture est le document le plus lu par le client ; elle part sous le nom de l'org, avec son gabarit, et laisse une trace dans la fiche client (livré / ouvert). Pennylane reste la comptabilité, pas le courrier.

## Règles

- **Module** : `settings.modules.communication === true` (helper pur `moduleActif(settings, 'communication')`, `src/lib/modules.js`). Absent ⇒ rien n'apparaît (on ne montre pas ce qui n'est pas ouvert). L'activation est une décision commerciale : posée en base par nous (super admin), pas éditable par l'org_admin — exception assumée à la règle « toute config a son UI ». Mayer et H&E : ouvert.
- **Prérequis techniques** (coche visible mais grisée avec la raison) : e-mail du client renseigné ; `from_email` de l'org renseigné et domaine Resend vérifié (`settings.resend.status === 'verified'`) ; facture réellement créée et **non brouillon** (mode « Brouillon » ⇒ « à envoyer depuis Pennylane après finalisation » ; modes « Finalisée » et « Émise par Majord'home » ⇒ envoi possible).
- **Pièces jointes** : la facture toujours (PDF Pennylane `public_file_url` du miroir `pennylane_sync`, ou PDF du hub dans le bucket `invoices`) + les certificats cochés (PDF archivé dans le bucket `certificats`, `pdf_storage_path`). Un certificat sans PDF archivé est listé grisé (« PDF non généré ») ; un certificat non signé est cochable mais marqué « non signé ». Cochés par défaut : tous les certificats avec PDF. Plafond 35 Mo cumulés (limite Resend 40 Mo).
- **Gabarit** : campagne `mail_campaigns` de clé `facture_entretien`, `is_transactional = true`, éditable dans Mailing → Éditeur, créée d'un clic depuis Settings → Communication → Emails (« Créer le gabarit par défaut »). Variables : `{{CLIENT_NAME}}`, `{{INVOICE_NUMBER}}`, `{{INVOICE_AMOUNT}}`, `{{INVOICE_DATE}}`, `{{EQUIPMENTS}}`, `{{ATTACHMENTS}}` + les variables de marque existantes. Gabarit absent ⇒ l'envoi est refusé avec un message qui pointe le réglage ; la facture, elle, est créée quoi qu'il arrive (même règle que `campaign_template_missing` côté SMS : une information, pas un échec métier).
- **Échec d'envoi après création** : la facture reste créée ; toast d'erreur et bouton **« Envoyer par e-mail »** sur la carte facturée pour renvoyer (même dialogue : e-mail, certificats). La trace est la ligne `mailing_logs` (`campaign_name = 'facture_entretien'`, `client_id`), visible dans l'onglet Mailings de la fiche client, accusés livré / ouvert par le webhook Resend existant. Pas de colonne nouvelle, pas de migration.
- **Sécurité** : edge `invoice-send` (`verify_jwt: true`, `requireOrgMembership` team_leader+, `orgSettingsFilter` module Communication). Tout objet (intervention, facture, certificats, gabarit) est relu côté serveur filtré par `org_id` ; les ids de certificats reçus ne sont acceptés que s'ils appartiennent à l'intervention (ou à ses interventions enfants). L'edge lit `{ error }` de chaque écriture et répond 4xx/5xx explicite.
- **Réutilisation** : un helper `_shared/mail.ts` (Resend + pièces jointes + marque + placeholders + log) est créé pour cette edge ; `mailing-send` et `contract-signed-notify` ne sont pas touchés (refonte à signaler, pas à embarquer).

## Hors périmètre

Envoi automatique par Pennylane ; envoi du certificat seul sans facture (même mécanisme, à ouvrir ensuite) ; UI d'activation des modules ; sidebar par module.
