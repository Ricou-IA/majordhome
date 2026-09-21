# Majord'home hub de facturation : émission locale, import Pennylane, journal dédié

> Date : 2026-09-22 · Décision Eric : « si on veut que Majord'home devienne un hub pour facturer, ça
> doit pouvoir être importé dans un journal dédié, c'est nécessaire pour l'audit et la traçabilité ».
> Remplace, pour la facturation, le chemin livré le 2026-09-21 (Pennylane crée la facture) — qui reste
> en place tant que le hub n'est pas livré.

## Pourquoi changer de chemin

Ce que l'API Pennylane permet et refuse, vérifié sur le schéma OpenAPI brut le 2026-09-22 :

| Chemin | Journal choisi ? | Document PDF | Relances / lettrage / e-invoicing PL | Constat |
|---|---|---|---|---|
| Créer la facture (`POST /customer_invoices`) | Non (aucun champ journal) | Pennylane | Oui | Écriture générée par PL, **non modifiable par l'API** (422 « not created via the API », vécu sur FERNANDEZ) |
| Importer la facture (`POST /customer_invoices/import`) | Non à l'import, **mais l'écriture est « créée via l'API »** → `PUT /ledger_entries/{id}` avec `journal_id` (à valider) | Majord'home | Oui | Chemin retenu |
| Écriture brute (`POST /ledger_entries`) | Oui | Aucun | Non | Pennylane n'a plus de facture : écarté |

Le journal dédié (« VA · Ventes automatiques », créé par Eric dans PL) est l'exigence d'audit :
tout ce que Majord'home écrit s'y lit, rien d'autre n'y est. Le rapprochement se fait sans
retraitement : journal d'intégration Majord'home ↔ écritures du journal VA.

## Ce que Majord'home porte désormais (obligations d'un émetteur de factures)

1. **Numérotation légale** : séquence continue, sans trou, chronologique, par organisation
   (`F-2026-00123`), attribuée par la base à l'émission, jamais côté front.
2. **Immuabilité** : une facture émise ne change plus (lignes, montants, PDF archivé). Toute
   correction = **avoir** (facture négative référençant l'originale).
3. **Mentions obligatoires** sur le PDF : identité, SIRET, TVA intracom, RCS, adresse, conditions de
   paiement, pénalités de retard, indemnité forfaitaire de recouvrement (40 €), escompte, mention
   RGE si applicable, bloc paiement (IBAN/BIC). Tout vient de `core.organizations.settings`
   (`buildCompanyInfo`) + nouveaux réglages (IBAN, BIC, conditions).
4. **Montants au centime** : Pennylane stocke ce qu'on envoie sans recalculer et exige
   `HT + TVA = TTC` par ligne et au total. Le calcul est le nôtre, dans un module pur testé,
   identique sur le PDF, en base et dans l'import.
5. **Archivage** : PDF dans le bucket Storage `invoices`, chemin `${orgId}/${année}/${numéro}.pdf`,
   policies org (charte multi-tenant).
6. **Facturation électronique** (réforme : réception 09/2026, émission PME 2027) : l'import PL
   accepte `convert_to_e_invoice` (Factur-X) — Pennylane reste la plateforme ; à activer en phase 4.

## Modèle de données (schéma `majordhome`, RLS org, vues `security_invoker`, GRANT service_role)

- `invoices` : `id`, `org_id`, `number` (UNIQUE org+number, NULL tant que brouillon), `year`,
  `status` ∈ `draft | issued | cancelled`, `kind` ∈ `invoice | credit_note`, `credited_invoice_id`,
  `context` ∈ `contrat | devis | …` (registre `PENNYLANE_CHART_CONTEXTS`), `client_id`,
  `contract_id`, `intervention_id`, `issued_at`, `due_at`, `currency`, `total_ht`, `total_tva`,
  `total_ttc`, `vat_breakdown` jsonb, `subject`, `pdf_path`, `pennylane_invoice_id`,
  `pennylane_ledger_entry_id`, `pennylane_journal_id`, `import_status` ∈
  `pending | imported | journal_moved | error`, `import_error`, `created_by`, timestamps.
- `invoice_lines` : `invoice_id`, `position`, `label`, `description`, `quantity`, `unit_price_ht`,
  `vat_rate`, `discount_percent`, `ht`, `tva`, `ttc`, `ledger_account_number`,
  `ledger_account_pl_id`, **axes analytiques sans dilution** : `metier_key` (type d'équipement /
  article), `equipment_id`, `category_id`. C'est le **journal d'intégration** : stats par métier
  chez nous, compte comptable chez Pennylane, jointure par facture.
- `invoice_sequences` : `org_id`, `year`, `last_number` — verrou ligne à l'émission.
- RPC `invoice_issue(p_invoice_id)` SECURITY DEFINER (`REVOKE FROM PUBLIC, anon` ; membership via
  `auth.uid()`, `IF auth.uid() IS NULL THEN refuser`) : attribue le numéro atomiquement, fige,
  pose `issued_at`. RPC `invoice_cancel_with_credit_note(p_invoice_id)` : crée l'avoir.
- Trigger : UPDATE interdit sur une facture `issued` hors colonnes d'import/PDF.

## Flux

1. **Préparer** (carte entretien, plus tard devis/travaux) : modèle pur `buildEntretienInvoice`
   (existant) → `invoices` + `invoice_lines` en `draft`. Aperçu comme aujourd'hui.
2. **Émettre** : RPC `invoice_issue` → numéro ; génération du PDF (react-pdf, `pdfShared.jsx`,
   `buildCompanyInfo`) ; upload Storage ; `invoiced_at`/`invoice_id` sur l'intervention.
3. **Importer** (edge `pennylane-invoice-import`, `verify_jwt:true`, `requireOrgMembership`,
   `orgSettingsFilter` pennylane) : dépôt du PDF chez PL (file attachments, multipart — le proxy
   JSON actuel ne suffit pas, l'edge parle à PL directement avec `PENNYLANE_API_TOKEN`), puis
   `POST /customer_invoices/import` (`invoice_number` = le nôtre, `external_reference` = id
   facture, lignes avec `ledger_account_id` déclinaison TVA, montants exacts), puis
   `PUT /ledger_entries/{ledger_entry.id}` `{ journal_id }` (réglage `settings.pennylane.invoice.journal_id`).
   Idempotent par `external_reference`. Chaque étape trace son statut ; un échec est visible et
   rejouable, jamais silencieux.
4. **Envoyer** : Pennylane (`send_by_email`, PDF importé) ou Majord'home (Resend) — décision plus tard,
   envoi manuel conservé pour l'instant.
5. **Rapprocher** : balayage des `customer_invoices` PL par `external_reference` + écritures du
   journal VA → vue anomalies : chez nous pas chez eux, chez eux (journal VA) pas chez nous,
   montants divergents, écriture hors journal VA.

## Phases

0. **Spike de validation (bloquant)** : un import avec un PDF minimal + déplacement de l'écriture
   dans VA, sur une société bac à sable Pennylane ou un cas réel de petit montant. Si le
   déplacement est refusé, le journal dédié est inatteignable par un chemin de facturation → on
   s'arrête et on revient au réglage côté Pennylane.
1. Numérotation + tables + RPC d'émission + PDF + archivage (sans Pennylane).
2. Import + journal + statuts + rejeu.
3. Avoir.
4. Facturation électronique, envoi, rapprochement automatisé.

Estimation : 4 à 6 jours après le spike. Le chemin actuel (Pennylane crée la facture) reste actif
jusqu'à la phase 2, avec le marqueur `label` « MDH » sur l'écriture en attendant.
