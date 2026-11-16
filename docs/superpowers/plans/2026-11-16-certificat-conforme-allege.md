# Certificat « Conforme » allégé — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un bouton de bureau « Conforme » sur chaque ligne d'équipement d'un entretien, qui crée un certificat allégé d'une page, clôt la ligne et laisse la suite (Facturer, attestation de ramonage, e-mail) inchangée.

**Architecture:** une ligne `certificats` marquée `mode = 'allege'`, finalisée sans signature du client. Le texte du document sort d'un module pur (même forme de « lettre » que l'attestation de ramonage, donc même gabarit PDF `AttestationEntretienPDF`). Une seule fonction enchaîne certificat → ligne « Réalisé » → PDF → archivage.

**Tech Stack:** React 18, TanStack Query v5, Supabase (vue `majordhome_certificats`), `@react-pdf/renderer`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-16-certificat-conforme-allege-design.md`

## Global Constraints

- Bouton visible pour `isTeamLeaderOrAbove` seulement (même règle que « Facturer »), jamais pour le technicien.
- Certificat allégé : `mode = 'allege'`, `statut = 'signe'`, `bilan_conformite = 'conforme'`, aucune signature du client.
- Case « Ramonage effectué » cochée ⇒ `donnees_ramonage = { conduits: [{ label: 'Conduit principal', resultat: 'ramone' }] }`, **sans** `methode` ; décochée ⇒ `donnees_ramonage = null`.
- Ordre de la chaîne : certificat enregistré → `savService.markRealise(childId, { visitDate })` → PDF → archivage. Un PDF en échec ne défait rien.
- Aucun caractère hors cp1252 dans les textes du PDF (Helvetica).
- Colonne ajoutée **en fin** de la vue `majordhome_certificats` ; la vue reste `security_invoker`, insérable, fermée à `anon`.
- « Annuler » seulement tant que la carte n'est pas facturée (`workflow_status !== 'facture'`, ni `invoice_id`, ni `invoiced_at`).

## Review Focus

- Un brouillon existe déjà sur la ligne avec une anomalie notée par le technicien : « Conforme » doit refuser, pas l'écraser (test `blocageConforme`).
- Un certificat complet signé existe déjà : refus (test `blocageConforme`).
- RDV daté dans le futur (entretien fait en avance) : la date proposée est bornée à aujourd'hui (test `dateDePassage`).
- Organisation sans signataire ni ville : le document sort quand même, sans « undefined » (test `buildCertificatConforme`).
- Équipement sans marque ni modèle, client sans adresse : phrases sans virgule orpheline ni double espace (test `buildCertificatConforme`).

---

### Task 1 : colonne `mode` et vue

**Files:**
- Create: `supabase/migrations/20261116_1_certificats_mode_allege.sql`
- Create: `scripts/migration-rehearsal/assert-certificats-mode.sql`

- [ ] `ALTER TABLE majordhome.certificats ADD COLUMN mode text NOT NULL DEFAULT 'complet'` + `CHECK (mode IN ('complet','allege'))` ; `CREATE OR REPLACE VIEW public.majordhome_certificats WITH (security_invoker = true)` avec la liste de `20261012_1` + `mode` en dernier.
- [ ] Assertions : colonne et contrainte présentes, dernière colonne de la vue = `mode`, vue insérable et `security_invoker`, `anon` sans SELECT, `authenticated` SELECT/INSERT/UPDATE/DELETE, toutes les lignes existantes à `complet`, un `UPDATE … SET mode = 'x'` refusé.
- [ ] `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261116_1_certificats_mode_allege.sql --assert scripts/migration-rehearsal/assert-certificats-mode.sql` → OK.

### Task 2 : modèle pur

**Files:**
- Create: `src/lib/certificatConformeModel.js`
- Test: `scripts/certificat-conforme-model.test.mjs` (ajouté à `audit:quality` dans `package.json`)

**Interfaces (Produces):**
- `MODE_ALLEGE = 'allege'`, `estAllege(certificat): boolean`
- `dateDePassage(scheduledDate: string|null, today: string): string` — `YYYY-MM-DD`, jamais après `today`, `today` si absente.
- `blocageConforme(certificatExistant: object|null): string|null` — `null` si rien, brouillon conforme ou certificat déjà allégé ; message si certificat complet signé / envoyé, ou brouillon avec `bilan_conformite !== 'conforme'` ou `anomalies_detail` renseigné.
- `certificatAllegePayload({ interventionId, clientId, equipmentId, contractId, orgId, userId, equipement: { code, marque, modele, numeroSerie }, tvaTaux, technicien: { id, nom }, date, ramonage }): object` — ligne prête pour l'upsert (contraintes globales ci-dessus ; `type_document` = `entretien_ramonage` si ramonage, sinon `entretien` ; `signed_at`, signatures, anomalies, `pdf_*` remis à `null`).
- `buildCertificatConforme({ certificat, appareil, contractNumber, client, company, dateEdition }): { lettre }` — même forme que `buildAttestationEntretien().lettre` (`lieuDate`, `destinataire`, `objet = 'CERTIFICAT D’ENTRETIEN'`, `references`, `salutation`, `paragraphes`, `faitA`, `signataire`).
- `peutAnnulerConforme(carte): boolean`

- [ ] Tests d'abord (les cinq lignes du Review Focus + payload avec et sans ramonage + texte attendu : « Aucune anomalie n’a été relevée », phrase de ramonage présente seulement si `donnees_ramonage` porte un conduit ramoné), les voir échouer, écrire le module, les voir passer.

### Task 3 : service, chaîne, hooks

**Files:**
- Modify: `src/shared/services/certificats.service.js` — `saveAllege(payload)` (upsert `onConflict: 'intervention_id'`), `deleteAllege(certificatId, orgId)` (filtre `mode = 'allege'`, erreur si 0 ligne), `removeFiles(paths)`, `listRdvTechnicianIds(interventionId)` ; `listForInterventionTree` sélectionne aussi `mode, technicien_nom, equipement_numero_serie`.
- Modify: `src/apps/artisan/components/certificat/attestationExport.js` — extraire et exporter `chargerVisuelsLettre(company): Promise<{ logoSrc, signatureSrc, warnings }>`.
- Create: `src/apps/artisan/components/certificat/certificatConformeExport.js` — `poserCertificatConforme({ payload, childId, lettreCtx })`, `genererPdfConforme({ certificat, lettreCtx })`, `annulerCertificatConforme({ certificat, childId, orgId })` ; `lettreCtx = { appareil, contractNumber, client, company, orgId }`.
- Modify: `src/shared/hooks/cacheKeys.js` (`certificatKeys.rdvTechniciens`), `src/shared/hooks/useCertificatEntretien.js` (mutations `poserConforme`, `annulerConforme`, `regenererConforme`, invalidation enfants + carte + certificats).

### Task 4 : écran

**Files:**
- Create: `src/apps/artisan/components/entretiens/CertificatConformeDialog.jsx` — date, technicien, case ramonage, rappel d'engagement, blocage affiché.
- Modify: `CertificatEquipmentRow.jsx` (statut `conforme`, boutons Conforme / Voir certificat / Annuler), `CertificatsSection.jsx` (certificats de l'arbre, droits, fenêtre), `pages/CertificatEntretien.jsx` (un certificat allégé n'ouvre jamais la saisie complète).

### Task 5 : preuve et livraison

- [ ] `node --test scripts/certificat-conforme-model.test.mjs scripts/attestation-entretien-model.test.mjs scripts/invoice-email-model.test.mjs`
- [ ] `npm run lint` et `npx vite build`
- [ ] Migration appliquée en prod, `has_table_privilege('anon', …)` faux, commit, push, déploiement suivi.
