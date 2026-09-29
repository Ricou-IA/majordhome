# Auto-RDV — Tranche 3 « Inviter et relancer » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le 1ᵉʳ du mois, la machine étiquette les journées vides par grand secteur selon les contrats dus, envoie à chaque client dû un mail avec son lien signé, relance par SMS à J+7, escalade en liste d'appels à J+15, et tout est réglable dans Settings → Tournées.

**Architecture:** Trois modules PURS (`secteurs.js` : grands secteurs côté serveur ; `etiquetage.js` : quelles journées vides dédier à quel secteur ; `invitations.js` : qui inviter pour un mois, calendrier des relances) ; une edge `auto-rdv-cron` (`verify_jwt:false`, `MDH_CRON_SECRET`) à deux modes `ouverture` / `relances`, journalisée dans `planification_runs` ; une table `auto_rdv_invitations` (suivi par contrat et par mois) mise à jour par l'edge `auto-rdv` à l'ouverture de la page et à la pose ; le jeton HMAC partagé dans `_shared/autoRdvToken.ts` ; gabarits e-mail dans `mail_campaigns` (registre `src/lib/autoRdvEmailTemplates.js`, même patron que `facture_entretien`), gabarit SMS `auto_rdv_relance` dans le registre `smsCampaigns.js` ; réglages `settings.tournees.auto_rdv` avec défauts dans `reglages.js` et UI dans `TourneesTab.jsx`.

**Tech Stack:** Deno edge functions, PostgreSQL (pg_cron + vault), Resend (`_shared/mail.ts`), Twilio (`_shared/sms.ts`), React settings, `node --test`, harnais de migration.

**Spec:** `docs/superpowers/specs/2026-09-29-auto-rdv-entretien-mensuel-design.md` (§ 3.2, § 4.1, § 6, § 7, § 12 tranche 3). Tranches 1–2 : plans du 2026-09-29.

## Global Constraints

- Moteur `src/lib/tournee/` : purs, imports relatifs `.js`, JSDoc ; `npm run sync:tournee-engine` puis redéployer `auto-rdv`, `auto-rdv-cron`, `slots-propose`, `tournees-figer`.
- **Un flux serveur ne crée JAMAIS de lead ni de client** ; il ne crée que des étiquettes, des invitations, des RDV via `auto_rdv_poser`.
- **Horizon = mois en cours** (prolongé si < 7 jours, `bornesMois`) ; l'étiquetage ne touche que des journées **vides** (aucun RDV) de techniciens « par la machine », **dans les bornes**.
- Mail : gabarit `auto_rdv` dans `majordhome_mail_campaigns` (`is_transactional = true`), placeholders `{{UPPER_SNAKE}}`, branding via `orgBranding` / `wrapWithSkeleton`, envoi `sendResendEmail`, log `insertMailingLog` (`campaign_name = 'auto_rdv'`). Exclus : `email` vide, `mail_optin = false`, `email_unsubscribed_at` non NULL, `is_archived`.
- SMS : `sendCampaignSms` (`campaign_template_missing` = information, compteur `skipped`), `settings.sms.enabled !== true` ⇒ silencieux, `isMobileFR`.
- Réglages : défauts dans `reglages.js` (`auto_rdv` fusionné explicitement, `construireReglages` étant superficiel), UI dans Settings → Tournées, l'onglet renvoie l'objet `tournees` complet.
- Toute écriture d'edge lit `{ error }` ; journal `planification_runs` à chaque passage, même en échec.
- `figer_sms` reste OFF tant que le gabarit `heure_de_passage` n'est pas saisi dans Settings → Communication → SMS (geste d'Eric).
- Pas de preview navigateur : tests Node, `deno check`, harnais, `npx vite build`, `npm run lint:errors`, `dry_run` des deux modes en prod.

---

## Fichiers

| Action | Fichier | Responsabilité |
|---|---|---|
| Créer | `src/lib/tournee/populations.js` | `chargerPopulations(codesPostaux, { fetchImpl })` (geo.api.gouv.fr, sans cache) |
| Créer | `src/lib/tournee/secteurs.js` | `secteursDepuisContrats(contrats, { radiusKm, cityPopulation })` → `{ byClient, byCp, secteurs }` ; `normaliserSecteur` |
| Créer | `src/lib/tournee/etiquetage.js` | `journeesAEtiqueter({ journeesVides, dusParSecteur, etiquettes, reglages, bornes })`, `secteursSatures(...)` |
| Créer | `src/lib/tournee/invitations.js` | `contratsAInviter({ contrats, clients, cartesEnCours, mois, reglages })`, `etapeRelance(invitation, aujourdhui, reglages)` |
| Créer | `scripts/tournee/{secteurs,etiquetage,invitations}.test.mjs` | tests |
| Modifier | `src/lib/tournee/reglages.js` | défauts `auto_rdv`, `construireReglages` fusionne `auto_rdv` |
| Modifier | `scripts/sync-tournee-engine.mjs` | NOMS + `populations`, `secteurs`, `etiquetage`, `invitations` ; PARTAGES + `autoRdvEmailTemplates` |
| Créer | `supabase/migrations/20260930_5_auto_rdv_invitations.sql` | table, RLS, vue, crons |
| Créer | `scripts/migration-rehearsal/assert-auto-rdv-invitations.sql` | assertions |
| Créer | `supabase/functions/_shared/autoRdvToken.ts` | `signer`, `verifier`, `expirationLien` (sortis de `auto-rdv`) |
| Modifier | `supabase/functions/auto-rdv/index.ts` | utilise le helper ; marque `opened_at` / `no_slot` / `booked_at` ; e-mail de confirmation |
| Créer | `supabase/functions/auto-rdv-cron/index.ts` | modes `ouverture` / `relances` |
| Modifier | `supabase/config.toml` | `[functions.auto-rdv-cron] verify_jwt = false` |
| Créer | `src/lib/autoRdvEmailTemplates.js` | `AUTO_RDV_EMAIL`, `AUTO_RDV_CONFIRMATION_EMAIL` (key, label, subject, html_body, is_transactional) |
| Modifier | `src/lib/smsCampaigns.js` | campagne `auto_rdv_relance` |
| Modifier | `src/apps/artisan/pages/settings/communication/EmailsTab.jsx` | bloc « Gabarits transactionnels » = liste (facture, auto_rdv, confirmation) |
| Modifier | `src/apps/artisan/pages/settings/entretiens/TourneesTab.jsx` | section « Prise de rendez-vous par le client » + fenêtre de pause |
| Modifier | `src/shared/services/autoRdv.service.js`, `src/shared/hooks/useTournees.js`, `cacheKeys.js` | invitations du mois |
| Modifier | `EntretienSAVCard.jsx`, `EntretiensDashboard.jsx`, `PlanificationJournal.jsx` | ligne « invité / relancé », tableau du mois, journal par job |
| Modifier | `docs/MODULE_TOURNEES.md` | section tranche 3 |

---

### Task 1 : secteurs côté serveur (`populations.js`, `secteurs.js`)

**Interfaces (Produces):**
- `chargerPopulations(codesPostaux: string[], { fetchImpl = globalThis.fetch, concurrence = 8 }) => Promise<Map<string, number>>` — clé = `normalizeCity(nom)`, même API que `communePopulation.js` (`https://geo.api.gouv.fr/communes?codePostal=…&fields=nom,population&format=json`), erreurs réseau → CP ignoré (log), jamais throw.
- `secteursDepuisContrats(contrats, { radiusKm = 15, cityPopulation = null }) => { secteurs, byClient: Map<clientId, nom>, byCp: Map<cp, nom> }` — `contrats[] = { id, client_id, client_postal_code, client_city, client_latitude, client_longitude, current_year_visit_status }` ; groupe par CP puis `clusterSectorsByProximity` (import `'../sectorClustering.js'`) ; « Non localisé » exclu des maps ; **noms normalisés** par `normaliserSecteur(nom)` = trim + première lettre de chaque mot en majuscule, reste en minuscule (« ALBI » et « Albi » → « Albi »).
- `normaliserSecteur(s) => string`.

- [ ] Tests : regroupement par CP, exclusion « Non localisé », normalisation de casse, `chargerPopulations` avec `fetchImpl` simulé (une réponse, une erreur).
- [ ] Implémenter ; ajouter `'populations', 'secteurs'` à `NOMS` ; sync ; tests verts ; commit.

### Task 2 : étiquetage des journées vides (`etiquetage.js`)

**Interfaces (Produces):**
- `journeesAEtiqueter({ journeesVides, dusParSecteur, etiquettes, journeesAmorcees, reglages, bornes }) => Array<{ date, technicienId, secteur }>`
  - `journeesVides[]` = journées de `chargerJournees` avec `rdvs.length === 0`, dans `[bornes.debut, bornes.fin]`, non déjà étiquetées ;
  - `dusParSecteur: Map<secteur, number>` (contrats dus du mois par secteur) ;
  - `journeesAmorcees[] = { date, technicienId, secteur, chargeMinutes, budgetMinutes }` (déduites ou étiquetées, avec place) — comptent comme capacité existante : `placesRestantes = floor((budget − charge) / dureeMoyenne)` avec `dureeMoyenne = reglages.auto_rdv.duree_moyenne_minutes` (90) ;
  - besoin par secteur = `ceil(dus × (1 + marge_pct/100) / capacite_cible) − journéesAmorceesDuSecteurAvecPlace` ; on choisit les journées vides **les plus proches dans le mois**, en alternant les techniciens (round-robin par date), sans dépasser le besoin ; un secteur dont le besoin ≤ 0 n'en reçoit aucune ; les journées vides restantes restent libres.
- `secteursAReouvrir({ journeesEtiquetees, reglages }) => string[]` — secteurs dont toutes les journées étiquetées sont remplies à ≥ `seuil_reouverture_pct` (charge/budget) : mode `relances` leur étiquette une journée vide de plus (via `journeesAEtiqueter` avec besoin = 1).

- [ ] Tests : besoin arrondi au-dessus avec marge, journées amorcées déduites du besoin, choix des plus proches, alternance des techniciens, secteur saturé → réouverture, aucune date hors bornes.
- [ ] Implémenter ; `NOMS` + `'etiquetage'` ; sync ; commit.

### Task 3 : qui inviter, quand relancer (`invitations.js`)

**Interfaces (Produces):**
- `contratsAInviter({ contrats, clients, cartesEnCours, mois, reglages }) => { aInviter: Array<{ contractId, clientId, email, prenom, nom, telephone, secteurCp, lat, lng, raison: 'anniversaire'|'retard' }>, exclus: Record<'sans_email'|'desinscrit'|'optout'|'archive'|'deja_planifie'|'deja_invite'|'hors_periode', number> }`
  - `contrats[]` = `majordhome_contracts` actifs (`current_year_visit_status IS NULL`) ; `clients: Map<id, { email, first_name, last_name, phone, mail_optin, email_unsubscribed_at, is_archived, latitude, longitude, postal_code }>` ; `cartesEnCours: Set<contractId>` (= `getPlannedContractIds`) ; `mois = 'YYYY-MM'` ; un contrat par client ;
  - `raison` : anniversaire (`start_date` même mois) ou retard (`retardStatus === 'en_retard'` et `reglages.auto_rdv.inclure_retardataires`).
- `etapeRelance(invitation, aujourdhui, reglages) => 'sms' | 'appel' | 'expire' | null` — J+`relance_sms_jours` sans `booked_at` ni `sms_relance_at` → `'sms'` ; J+`escalade_appel_jours` sans `escalade_appel_at` → `'appel'` ; `aujourdhui > fin du mois de l'invitation` sans `booked_at` → `'expire'`.

- [ ] Tests (ordre des exclusions, un par client, retardataires on/off, calendrier des relances).
- [ ] Implémenter ; `NOMS` + `'invitations'` ; sync ; commit.

### Task 4 : réglages `auto_rdv` (défauts + UI) et fenêtre de pause

- `reglages.js` : `REGLAGES_DEFAUT.auto_rdv = { enabled: false, capacite_cible: 4, marge_pct: 20, seuil_reouverture_pct: 75, delai_min_jours: 2, max_creneaux: 6, relance_sms_jours: 7, escalade_appel_jours: 15, inclure_retardataires: true, duree_moyenne_minutes: 90 }` ; `construireReglages` : `auto_rdv: { ...DEFAUT.auto_rdv, ...(settings.tournees.auto_rdv || {}) }`.
- `TourneesTab.jsx` : nouvelle section « Prise de rendez-vous par le client » (case `enabled` + 8 champs entiers + case retardataires) ; section « Pause » : `pause_fenetre` début/fin en heures décimales (2 champs `ChampMinutes` avec `unite="h"`, pas 0,5, min 6 max 20) ; validation ; `save` envoie `tournees` complet avec `auto_rdv` et `pause_fenetre`.
- [ ] Lint ; commit.

### Task 5 : migration `20260930_5` — invitations + crons

```sql
CREATE TABLE majordhome.auto_rdv_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES majordhome.contracts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  mois date NOT NULL,                    -- 1er du mois
  raison text NOT NULL CHECK (raison IN ('anniversaire','retard')),
  sent_at timestamptz, email_to text, mailing_log_id uuid,
  opened_at timestamptz, booked_at timestamptz, appointment_id uuid, intervention_id uuid,
  sms_relance_at timestamptz, escalade_appel_at timestamptz,
  outcome text CHECK (outcome IN ('booked','no_slot','expired','phone')),
  relances int NOT NULL DEFAULT 0,       -- nombre de mois consécutifs invité sans RDV
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contract_id, mois)
);
```
RLS SELECT membres, aucune policy d'écriture (service_role) ; `GRANT SELECT TO authenticated` ; `GRANT SELECT, INSERT, UPDATE TO service_role` ; vue `public.majordhome_auto_rdv_invitations` `security_invoker` ; trigger `updated_at`. Crons (vault `mdh_cron_secret`, même patron que `maintenance-digest`) : `auto-rdv-ouverture` `0 4 1 * *` body `{"mode":"ouverture"}` ; `auto-rdv-relances` `20 4 * * *` body `{"mode":"relances"}`. Assert : privilèges, vue, 2 `cron.job`.
- [ ] Répéter (migrations 1→5) ; appliquer ; auditer ; commit.

### Task 6 : jeton partagé + edge `auto-rdv` (invitations, confirmation)

- `_shared/autoRdvToken.ts` : `signer(contractId, exp)`, `verifier(token)`, `expirationLien(now)` (copie de `auto-rdv/index.ts`, secret `MDH_AUTO_RDV_SECRET`) ; `auto-rdv` l'importe.
- `auto-rdv` GET : après calcul, `UPDATE majordhome_auto_rdv_invitations SET opened_at = coalesce(opened_at, now()), outcome = CASE WHEN creneaux vides AND outcome IS NULL THEN 'no_slot' END WHERE contract_id AND mois = mois courant AND booked_at IS NULL` (best-effort, erreur loggée). POST book : après succès, `UPDATE … SET booked_at, appointment_id, intervention_id, outcome = 'booked'` ; puis e-mail de confirmation (gabarit `auto_rdv_confirmation`, best-effort, `insertMailingLog`).
- [ ] `deno check` ; déployer ; commit.

### Task 7 : edge `auto-rdv-cron`

- Body `{ mode: 'ouverture'|'relances', dry_run?, org_id?, aujourdhui? }` ; `requireSharedSecret`.
- Par org (`majordhome_organizations` + `settings.tournees.auto_rdv.enabled === true`, sinon `skipped: 'auto_rdv_off'`) :
  1. `reglages`, `depot`, `bornes = bornesMois(aujourdhui)`, `mois` = mois d'`aujourdhui`.
  2. Contrats actifs (`majordhome_contracts`), clients (`majordhome_clients` : email, optin, désinscription, archive, coords, CP, city), cartes en cours (`majordhome_entretien_sav` non terminales), populations (`chargerPopulations`) → `secteursDepuisContrats` → `byClient`/`byCp`.
  3. **ouverture** : `contratsAInviter` → par contrat : jeton `signer`, mail `auto_rdv` (placeholders `{{PRENOM}}`, `{{LIEN_RDV}}`, `{{EQUIPEMENTS}}`, `{{MOIS}}` + branding), `insertMailingLog`, insert invitation (`sent_at`, `email_to`, `raison`, `relances` = précédent+1) ; exclus sans e-mail → invitation `outcome = 'phone'` sans envoi. Puis `journeesAEtiqueter` (journées vides de `chargerJournees`, dus par secteur via `byClient`/`byCp`) → insert `journees_secteur` origine `machine`.
  4. **relances** : pour chaque invitation du mois non bookée : `etapeRelance` → `sms` (`sendCampaignSms` `auto_rdv_relance`, `sms_relance_at`) · `appel` (`escalade_appel_at`) · `expire` (`outcome = 'expired'`) ; puis `secteursAReouvrir` → une journée vide de plus par secteur saturé ; réécriture des étiquettes `deduite` (journées non figées avec entretiens : `deduireSecteur`).
  5. Journal `planification_runs` (`job` = `auto-rdv-ouverture` | `auto-rdv-relances`, rapport `{ invitations: { envoyees, exclus }, etiquetees: [...], relances: { sms, appel, expire }, erreurs }`).
- [ ] `deno check` ; `config.toml` ; déployer ; `dry_run` des deux modes via `net.http_post` ; commit.

### Task 8 : gabarits (mail + SMS) et EmailsTab

- `src/lib/autoRdvEmailTemplates.js` : `AUTO_RDV_EMAIL` (`key: 'auto_rdv'`, sujet « Votre entretien annuel : choisissez votre demi-journée », corps HTML sobre avec bouton `{{LIEN_RDV}}`, `{{PRENOM}}`, `{{EQUIPEMENTS}}`, `{{ORG_PHONE}}`), `AUTO_RDV_CONFIRMATION_EMAIL` (`key: 'auto_rdv_confirmation'`, `{{DATE_RDV}}`, `{{DEMI_JOURNEE}}`, `{{TECHNICIEN}}`) ; `PARTAGES` + copie Deno pour les valeurs par défaut de placeholders.
- `EmailsTab.jsx` : le bloc transactionnel devient une boucle sur `[DEFAULT_INVOICE_EMAIL, AUTO_RDV_EMAIL, AUTO_RDV_CONFIRMATION_EMAIL]` (même « Créer le gabarit par défaut » / « Modifier dans l'éditeur »).
- `smsCampaigns.js` : `auto_rdv_relance` (variables `prenom`, `entreprise` ; texte suggéré « {{prenom}}, votre entretien approche : consultez vos e-mails, nous vous avons envoyé les disponibilités. {{entreprise}} »).
- [ ] Lint ; sync ; commit.

### Task 9 : visibilité (carte, dashboard, journal)

- `autoRdvService.getInvitationsDuMois({ orgId, mois })` (vue), `useInvitationsDuMois(orgId, mois)`, `tourneeKeys.invitations(orgId, mois)`.
- `EntretienSAVCard` : ligne 4 → « Invité le 1/10 · relancé le 8/10 » / « Sans e-mail : à appeler » quand une invitation existe pour `effective_contract_id`. `EntretienSAVKanban` passe la map.
- `EntretiensDashboard` : carte « Prise de rendez-vous en ligne, mois en cours » (invitées / ouvertes / prises / sans créneau / à appeler) + `PlanificationJournal` prend `job` en prop, rendu 3 fois (figeage, ouverture, relances).
- [ ] Lint, build ; commit.

### Task 10 : documentation, audit, activation

- `docs/MODULE_TOURNEES.md` section tranche 3 ; `.claude/proposed-updates.md` PENDING.
- `npm run audit:quality`.
- **Activation Mayer = geste d'Eric** : cocher « Prise de rendez-vous par le client » dans Settings → Tournées, créer les gabarits e-mail depuis Settings → Communication → Emails, saisir le SMS `auto_rdv_relance` et `heure_de_passage` dans Settings → Communication → SMS, puis passer `figer_sms` à ON.

## Self-review

- Spec § 4.1 : contrats à inviter ✔ (T3/T7), journées déduites ✔ (T7 relances), étiquetage ✔ (T2/T7), invitations + mail ✔ (T7/T8), journal ✔. § 6 relances ✔ (T3/T7). § 7 réglages ✔ (T4). § 4.2 confirmation mail ✔ (T6), `no_slot` ✔ (T6). § 5 carte + dashboard ✔ (T9).
- Écarts : e-mail de confirmation best-effort (l'échec n'annule pas la pose) ; « Copier le lien » réutilise le jeton de l'invitation courante s'il existe (même contrat, même exp) — non, le jeton est sans état : un nouveau lien signé est équivalent.
