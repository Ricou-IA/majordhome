# Plan — anomalie du certificat (carte, SAV, facture) + commentaire de devis

Spec : `docs/superpowers/specs/2026-10-10-anomalie-certificat-sav-facture-commentaire-devis-design.md`.
Critère de succès : `npx vite build` + `npm run audit:quality` verts, migration répétée sur le harnais
puis appliquée en prod, carte GUILLOU (CTR-00127) affichant l'anomalie.

## T1 — Module pur `certificatAnomalies.js` + tests (TDD)
- `scripts/certificat-anomalies.test.mjs` : libellés, `anomaliesDeCarte` (jsonb / chaîne / vide / tri),
  `doitCreerSav` (devis + anomalie ⇒ oui ; sur_place ⇒ non ; conforme ⇒ non), `descriptionSavDepuisCertificat`,
  `noteClientDepuisAnomalies` (0, 1, 2 anomalies, actions différentes).
- Ajouter le test à `audit:quality`. `StepBilan` importe `ACTIONS_CORRECTIVES`.

## T2 — Migration `20261010_1` + harnais
- SQL : quotes.commentaire (+2 vues), interventions.source_certificat_id (+index, +vue),
  invoices.client_note (+vue DROP/CREATE/GRANT, +RPC, +trigger), vue `majordhome_entretien_sav` + `anomalies`.
- `snapshot.mjs` : colonnes certificats, vues et fonctions ajoutées ; `assert-anomalie-certificat.sql`.
- `node scripts/migration-rehearsal/snapshot.mjs --env .env.local` puis `run.mjs --migration … --assert …`.

## T3 — Carte + fiche de synthèse
- `EntretienSAVCard` : bloc « Anomalie », étiquette « Suite d'entretien » sur un SAV d'origine entretien.
- `EntretienSAVModal` : section « Anomalie constatée » + `CertificatLink`.

## T4 — Demande SAV à la finalisation du certificat
- `savService.createSAV` : `sourceCertificatId`, `equipmentId`.
- `CertificatWizard.finaliser` : création après `markRealise`, 23505 silencieux, autre erreur en warning,
  invalidation `entretienSavKeys`.

## T5 — Information client sur la facture
- `entretienInvoiceModel.toPennylaneInvoicePayload` : `pdf_invoice_free_text`.
- `invoiceDocumentModel.buildInvoiceDraft` / `buildInvoicePdfModel` : `client_note` / `clientNote` (+ tests).
- `InvoicePDF` : bloc « Information ». `FacturerEntretienDialog` : champ pré-rempli, modèle enrichi.

## T6 — Commentaire sur le devis
- `devis.service` (create / update / duplicate), `CreateDevisModal` + `DevisConditions`,
  `devisDocumentModel` (ZONES + modèle + exemple + tests), `DevisPDF`, `ApercuDevis`, `DevisModal`.

## T7 — Vérification et livraison
- `npx vite build`, `npm run audit:quality`, migration en prod (`apply_migration`), contrôle SQL sur
  CTR-00127, commit, note de fin (proposition CLAUDE.md en PENDING).
