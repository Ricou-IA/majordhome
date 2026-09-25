# Propositions de mise à jour CLAUDE.md — file vivante

> **Ce fichier ne contient QUE les propositions OUVERTES.**
> Dès qu'une proposition est intégrée au CLAUDE.md (RESOLU) ou écartée (REJETE), on la **retire d'ici** — git + l'archive gardent la trace.
> Snapshot historique complet au 2026-06-18 (110 entrées, 93 RESOLU + 5 REJETE + 12 PENDING d'alors) : `.claude/proposed-updates-archive.md`.
> **Discipline anti-drift** : une session qui intègre une entrée dans CLAUDE.md la **supprime** de ce fichier dans la foulée. Sinon la doc est à jour mais l'entrée traîne en PENDING (cause exacte du tas qu'on vient de nettoyer : 6 entrées étaient déjà dans CLAUDE.md sans avoir été fermées ici).
> Revue du 2026-09-16 : 6 entrées intégrées (SMS, référentiel équipements, paramétrage par module, Pennylane sans création de lead, MT-LT = vue, RDV toujours assigné) — commit `docs(claude): revue des propositions`.
> Revue du 2026-09-20 : 1 entrée intégrée (contrat unique des mutations React Query — `unwrapResult`, § Conventions qualité → Hooks).
> Revue du 2026-09-20 (soir) : 1 entrée intégrée (gotcha « un fichier `sql/*.sql` n'est pas une migration appliquée », § Gotchas DB + correction des vues `majordhome_prospects` / `_prospect_interactions`, § Vues publiques principales).
> Revue du 2026-09-21 : 2 entrées intégrées (facturation d'entretien → Pennylane, condensée en 4 puces § Module Pennylane + remise exceptionnelle § Module Contrats ; `create-user` : écritures `core` + lecture de `{ error }`, § Edge functions).
> Revue du 2026-09-22 : 2 entrées intégrées (plan comptable de gestion par métier § Module Pennylane + icônes des tuiles § Paramétrage par module ; commande « personnes × jours » § Module Planning + gotchas `update_majordhome_lead` / harnais de répétition § Gotchas DB). Hub de facturation phase 1 gardé PENDING en attendant la phase 2 (import Pennylane livré le soir même, à documenter d'un bloc).

---

## [DROITS APP-LEVEL] Modèle de permissions canonical — Phases 4-6 à graver
**Statut** : PENDING (volontairement différé — fusionne 4 anciennes entrées du 2026-06-02 : spec 01:22 / registre 01:39 / socle DB 01:55 / Phase 3 RLS 02:21)
**Commits** : cc9ac2b · 74a9e00 · 4285f82 · ed671ec
**État** : Phases 1-3 livrées en prod (registre `src/lib/permissionsRegistry.js` ; table `majordhome.app_role_permissions` + fonctions `user_effective_role`/`role_can` ; écritures `equipments`+`interventions` gouvernées par `role_can(project_org_id(...), 'clients', …)`). Garde-fou déjà présent dans CLAUDE.md § Rôles & Permissions (ne pas éditer `app_role_permissions` à la main ; ne pas brancher de policy RLS sur `role_can` avant Phase 4).
**Reste (avec Eric, prod partagée)** : policies `clients`/`contracts`/`leads`, branchement front `can()`, retrait du seed Mayer `org_seed_permissions`.
**À faire** : graver la doc complète dans CLAUDE.md § Rôles & Permissions quand Phases 4-6 atterrissent. Spec : `docs/superpowers/specs/2026-06-02-permissions-app-level-canonical-design.md`.

*Confirmé PENDING le 2026-08-09 : rien à graver tant que les phases ne sont pas livrées. Reconfirmé le 2026-09-16 et le 2026-09-22.*
---

## [2026-09-22 14:30] Hub de facturation — phases 1 à 3 (émission locale, import Pennylane, avoir)
**Statut** : PENDING (à graver dans CLAUDE.md)
**Commit** : f5d9196 · db8e39a · fb7d90e · 40e8924 · 10d7eff · ca40d0c · 877afa1 · cd9014e · f3f99c5 · 1236240 · 69d808a · 49a2931 · 4e43212 · 571914d · 7ac8776 · d7763b1 · eb7f7de · 2ebe8ed · eaa08fe · 2f77981
**Contexte** : Majord'home émet ses factures d'entretien (mode « Émise par Majord'home » dans Settings → Facturation) : numéro légal par la base, lignes/totaux figés, PDF archivé dans le bucket `invoices`. Pennylane n'est pas appelé (import en phase 2, journal de ventes principal — le journal dédié est reporté, l'API ne permet pas de déplacer l'écriture d'une facture). Phase 3 ajoute les avoirs de correction.
**Proposition** (nouvelle section « Module Facturation (hub) → spec 2026-09-22 ») :
- **Numéro de facture = RPC `invoice_issue` sous verrou** (`majordhome.invoice_sequences` par org × année, `${prefix}-${YYYY}-${NNNNN}`) : jamais calculé côté front, jamais `MAX()+1`. Préfixe = `settings.invoicing.number_prefix` (Settings → Facturation → Émission) ; distinct de la série Pennylane (« F ») tant que PL numérote aussi.
- **Une facture `issued` est figée par trigger** (`invoices_guard_immutable` + lignes) : seules `pdf_path`, `pennylane_*`, `import_*` bougent ; correction = avoir (phase 3). `customer` = photo du client à l'émission.
- **Chaîne d'émission = `useIssueEntretienInvoice` (point d'entrée unique)** : brouillon → numéro → carte marquée → PDF → Storage `invoices/${org}/${année}/${numéro}.pdf`. La carte est marquée AVANT le PDF (le numéro consommé fait exister la facture) ; tout échec aval dit ce qui EST fait.
- **Modèle PUR `src/lib/invoiceDocumentModel.js`** (`node --test scripts/invoice-document-model.test.mjs`, dans `audit:quality`) : montants au centime (`ht + tva = ttc` par ligne, totaux = sommes, ventilation par taux), modèle PDF préformaté (PDF-safe). `InvoicePDF.jsx` ne calcule ni ne formate rien.
- Réglages `settings.invoicing = { number_prefix, iban, bic, payment_terms, late_penalty, discount_note }` lus par `invoicingSettings()` (défauts neutres), objet sauvé COMPLET.
- **Import Pennylane = edge `pennylane-invoice-import`** (team_leader+, org Pennylane activée) : PDF archivé → `/file_attachments` → `POST /customer_invoices/import` avec NOTRE numéro, `external_reference` = id facture, montants ENREGISTRÉS (jamais recalculés), journal de ventes principal (le déplacement d'écriture est refusé par l'API). Résultat écrit UNIQUEMENT par la RPC `invoice_set_import_result` (service_role) : `import_status` ∈ `pending | imported | error` + `import_error` + `import_attempted_at`. L'import n'échoue jamais l'émission : un échec est enregistré et rejoué depuis la carte (`useRetryInvoiceExport`, qui régénère aussi un PDF manquant). Le client Pennylane vient du mapping `pennylane_sync` type `client`, posé côté front (`ensurePennylaneCustomer`) — l'edge ne prend jamais un `customer_id` du payload.
- `invoice_lines.vat_code` = code TVA Pennylane figé à la création (l'edge ne recopie pas `VAT_CODES`). `majordhome_entretien_sav.invoice_import_status` pilote le bouton de rejeu (cast `invoice_id::uuid` protégé par un CASE : la colonne porte aussi des ids Pennylane).
- **Avoir = `invoice_cancel_with_credit_note`** (team_leader+, annulation TOTALE, une seule par facture) : copie négative émise dans la même série, original `cancelled`, carte remise à facturer (`invoice_id`/`invoiced_at` NULL), import Pennylane avec `credited_invoice_id`. L'index unique « un entretien = une facture émise » ne compte que `kind='invoice'`. Pas d'avoir partiel.
---

## [2026-09-23 15:30] Gabarits de facture d'entretien par catégorie (libellé, objet, ligne offerte)
**Statut** : PENDING (à graver dans CLAUDE.md)
**Commit** : 2d75893 (modèle, Task 1) · 0603a97 (Settings → Facturation + branchement, Task 2) · + commit de cette tâche (modale Facturer — édition manuelle des lignes, Task 3)
**Contexte** : Eric, 2026-09-23 : « pas une usine à gaz, paramétrable facilement pour un tiers ». Le libellé de ligne d'entretien, l'objet de la facture et une éventuelle ligne offerte (type ramonage) étaient jusqu'ici implicites dans `buildEntretienInvoice`. Un gabarit par catégorie d'équipement, éditable dans Settings → Facturation, couvre les deux modes de facturation (brouillon Pennylane et hub) sans dupliquer la logique.
**Proposition** (§ Module Pennylane ou § Module Contrats, à côté de la facturation d'entretien) :
- `settings.pennylane.invoice.templates.by_category[catId] = { label, subject, offered: { label } }`, tous les champs facultatifs, catégorie absente = comportement par défaut. Normalisé par `invoiceTemplatesFromSettings()` (`src/lib/entretienInvoiceModel.js`, Task 1) — une entrée héritée portant `price_ht`/`vat_rate` (ancienne forme) est acceptée, ces clés sont ignorées. Exposé par `pennylaneInvoiceSettings(settings).templates`.
- Variables de gabarit `{type} {marque} {modele} {serie} {contrat}`, rendues par `renderInvoiceTemplate()` (une variable vide/inconnue disparaît, ponctuation orpheline finale nettoyée). Chips cliquables sous chaque champ dans `TemplatesSection.jsx` (insertion au curseur), aperçu en direct sous chaque champ.
- Ligne offerte = libellé + prix HT + TVA (ou famille) + remise réglable (100 % = offerte, ne pèse rien) ; édition manuelle des lignes dans la modale Facturer (`lineEditsFromModel` / `applyLineEdits` / `newFreeLine`, module pur ; les deux modes envoient `effectiveModel`).
- Source unique de consommation : `buildEntretienInvoice({ …, templates })`, appelée par `FacturerEntretienDialog.jsx` dans les DEUX modes (brouillon Pennylane et hub) — pas de branche séparée par mode.
- Éditable Settings → Facturation Pennylane, section « Entretien — gabarits par famille d'équipement » (`TemplatesSection.jsx`, présentationnel ; état dans `FacturationTab.jsx::form.templates_by_category`), un bloc par catégorie active du référentiel équipements.
---

## [2026-09-23 18:00] Envoi de la facture d'entretien par e-mail (Resend, module Communication)
**Statut** : PENDING (à graver dans CLAUDE.md)
**Commit** : b46659a (modèle + services/hooks, Task 1) · 6814366 (edge `invoice-send`, Task 2) · + commit de cette tâche (front : modale Facturer, renvoi depuis la carte, gabarit par défaut, Task 3)
**Contexte** : la facture d'entretien (hub ou Pennylane finalisée) peut maintenant partir directement au client par e-mail, avec ses certificats en pièces jointes, sans repasser par le mailing broadcast. Gate = `moduleActif(settings, 'communication')` — **premier consommateur réel de `settings.modules`**, posé en base (migration Task 2) mais sans aucune UI d'activation pour l'instant (à ouvrir manuellement par org via SQL le temps que Settings → Modules existe).
**Proposition** (§ Module Mailing ou nouvelle sous-section « Facture d'entretien par e-mail ») :
- **Edge `invoice-send`** (`verify_jwt:true`, `requireOrgMembership`) + helper `_shared/mail.ts` (Resend, pièces jointes en base64 depuis Storage) : point d'entrée UNIQUE de l'envoi, appelé par `invoicesService.sendByEmail` (`useSendInvoiceEmail`). Refuse un brouillon Pennylane (`invoice_is_draft`), une facture absente (`invoice_missing`), un certificat hors intervention (`certificate_not_allowed`) ou sans PDF (`certificate_pdf_missing`), un gabarit absent (`template_missing`), des pièces jointes trop lourdes (`attachments_too_large` > 35 Mo) — codes normalisés en français par `invoiceEmailErrorMessage()` (`src/lib/invoiceEmailModel.js`).
- **Disponibilité de l'option = `invoiceEmailAvailability()`** (module pur, `src/lib/invoiceEmailModel.js`) : invisible si module Communication fermé, désactivée (avec raison affichée) sans e-mail client / `from_email` / domaine Resend vérifié / si la facture est un brouillon Pennylane. Consommée par `FacturerEntretienDialog` (coche proposée après création, jamais bloquante — un échec d'envoi laisse la facture créée avec un toast « renvoyez depuis la carte ») et `SendInvoiceEmailDialog` (renvoi explicite depuis la carte facturée, bouton « Envoyer par e-mail » visible si `moduleActif(settings,'communication') && item.invoice_id && type === 'entretien'`).
- **Gabarit transactionnel `facture_entretien`** : `majordhome.mail_campaigns` comme les campagnes broadcast (`is_transactional=true`, donc exclu de l'onglet Envoi), créé d'un clic (`DEFAULT_INVOICE_EMAIL` de `src/lib/invoiceEmailTemplate.js`) depuis Settings → Communication → Emails → « Gabarits transactionnels », puis édité comme n'importe quelle campagne dans Mailing → Éditeur. Variables `{{INVOICE_NUMBER}}`, `{{INVOICE_AMOUNT}}`, `{{EQUIPMENTS}}`, `{{ATTACHMENTS}}`, `{{CLIENT_NAME}}` + les placeholders de branding org habituels.
- **Trace** = `mailing_logs` avec `campaign_name='facture_entretien'` (visible fiche client → onglet Mailings), même mécanique que le reste du mailing transactionnel.
- **Non refondu, à signaler séparément** : `mailing-send` (broadcast) et `contract-signed-notify` restent sur leur propre logique d'envoi — pas de fusion avec `invoice-send` dans cette tâche.
---

## [2026-09-25 19:00] Module Maintenance (tâches récurrentes, borne d'atelier, traçabilité)
**Statut** : PENDING
**Commit** : 0322997 (spec) · de8e697 · 146420d · 39e0db1 · 689132b · 40068cc
**Contexte** : nouveau module opt-in générique (1er client : usine Bricafeu, nouvelle org). Unités → tâches à fréquence, borne TV + Raspberry Pi qui sert d'écran d'affichage ET de saisie (prénom + PIN), suivi responsable, e-mail du soir, registre PDF. Migrations 20260925_1 (répétée OK) et 20260925_2 (cron) NON appliquées en prod à la date du commit.
**Proposition** (nouvelle section « Module Maintenance → docs/superpowers/specs/2026-09-25-module-maintenance-taches-recurrentes-design.md ») :
- **Règle d'échéance = `src/lib/maintenance/echeances.js`**, seule définition de « dû / en retard » (borne, suivi, e-mail, PDF), copiée pour Deno par `sync:tournee-engine` (`_shared/maintenance/`). Échéance jamais stockée. Jours cochés : un retard ne s'empile pas ; intervalle : depuis la réalisation effective ; « pas pu faire » ⇒ J+1.
- **Borne = compte Supabase membre (option 1-B, choix Eric)** : voit ce que voit tout membre ⇒ création refusée si l'org a des clients (`BorneTab`). Org avec clients qui veut une borne ⇒ jeton d'appareil (option 1-A de la spec), jamais un compte membre.
- **PIN** : `pin_hash` illisible (privilèges colonne + vue sans la colonne + REVOKE `baikal_reader`, que les ACL par défaut du schéma `majordhome` servent en SELECT). `maint_record_completion` RETOURNE `{ok:false}` sur PIN faux au lieu de RAISE — un RAISE annulerait l'incrément `failed_attempts` et le blocage ne s'enclencherait jamais.
- **Journal `maint_task_logs` append-only** : aucune policy d'écriture + trigger anti UPDATE/DELETE ; horodatage `clock_timestamp()` (deux réalisations d'une même transaction restent ordonnées).
- **`settings.modules.crm === false`** (`crmActif`, `modulesVisibles` dans `src/lib/modules.js`) : sidebar et Paramètres réduits au module + tuiles `horsCrm` ; `/` → `/maintenance` ; compte borne (`settings.maintenance.kiosk_user_ids`) → `/maintenance/borne`. Module opt-in : `optIn: true` dans le registre.
- **E-mail du soir** : edge `maintenance-digest` (cron horaire :05, `MDH_CRON_SECRET`), part même si tout est à jour, expéditeur org sinon `MDH_PLATFORM_FROM_EMAIL` sinon `skipped:no_sender`, `maint_digest_mark_sent` (service_role only) après 2xx Resend.
---
