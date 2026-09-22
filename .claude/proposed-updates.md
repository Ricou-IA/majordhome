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

## [2026-09-22 14:30] Hub de facturation — phases 1 et 2 (émission locale, import Pennylane)
**Statut** : PENDING (à graver dans CLAUDE.md)
**Commit** : f5d9196 · db8e39a · fb7d90e · 40e8924 · 10d7eff · ca40d0c · 877afa1 · cd9014e · f3f99c5 · 1236240 · 69d808a
**Contexte** : Majord'home émet ses factures d'entretien (mode « Émise par Majord'home » dans Settings → Facturation) : numéro légal par la base, lignes/totaux figés, PDF archivé dans le bucket `invoices`. Pennylane n'est pas appelé (import en phase 2, journal de ventes principal — le journal dédié est reporté, l'API ne permet pas de déplacer l'écriture d'une facture).
**Proposition** (nouvelle section « Module Facturation (hub) → spec 2026-09-22 ») :
- **Numéro de facture = RPC `invoice_issue` sous verrou** (`majordhome.invoice_sequences` par org × année, `${prefix}-${YYYY}-${NNNNN}`) : jamais calculé côté front, jamais `MAX()+1`. Préfixe = `settings.invoicing.number_prefix` (Settings → Facturation → Émission) ; distinct de la série Pennylane (« F ») tant que PL numérote aussi.
- **Une facture `issued` est figée par trigger** (`invoices_guard_immutable` + lignes) : seules `pdf_path`, `pennylane_*`, `import_*` bougent ; correction = avoir (phase 3). `customer` = photo du client à l'émission.
- **Chaîne d'émission = `useIssueEntretienInvoice` (point d'entrée unique)** : brouillon → numéro → carte marquée → PDF → Storage `invoices/${org}/${année}/${numéro}.pdf`. La carte est marquée AVANT le PDF (le numéro consommé fait exister la facture) ; tout échec aval dit ce qui EST fait.
- **Modèle PUR `src/lib/invoiceDocumentModel.js`** (`node --test scripts/invoice-document-model.test.mjs`, dans `audit:quality`) : montants au centime (`ht + tva = ttc` par ligne, totaux = sommes, ventilation par taux), modèle PDF préformaté (PDF-safe). `InvoicePDF.jsx` ne calcule ni ne formate rien.
- Réglages `settings.invoicing = { number_prefix, iban, bic, payment_terms, late_penalty, discount_note }` lus par `invoicingSettings()` (défauts neutres), objet sauvé COMPLET.
- **Import Pennylane = edge `pennylane-invoice-import`** (team_leader+, org Pennylane activée) : PDF archivé → `/file_attachments` → `POST /customer_invoices/import` avec NOTRE numéro, `external_reference` = id facture, montants ENREGISTRÉS (jamais recalculés), journal de ventes principal (le déplacement d'écriture est refusé par l'API). Résultat écrit UNIQUEMENT par la RPC `invoice_set_import_result` (service_role) : `import_status` ∈ `pending | imported | error` + `import_error` + `import_attempted_at`. L'import n'échoue jamais l'émission : un échec est enregistré et rejoué depuis la carte (`useRetryInvoiceExport`, qui régénère aussi un PDF manquant). Le client Pennylane vient du mapping `pennylane_sync` type `client`, posé côté front (`ensurePennylaneCustomer`) — l'edge ne prend jamais un `customer_id` du payload.
- `invoice_lines.vat_code` = code TVA Pennylane figé à la création (l'edge ne recopie pas `VAT_CODES`). `majordhome_entretien_sav.invoice_import_status` pilote le bouton de rejeu (cast `invoice_id::uuid` protégé par un CASE : la colonne porte aussi des ids Pennylane).
---
