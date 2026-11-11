# Logement MonsieurDPE sur la fiche client — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (choisi par Eric : réalisation dans la session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Un seul bloc Logement sur la fiche client : rattachement automatique du DPE quand c'est sûr, carte du logement lue dans le corpus MonsieurDPE et enregistrée, envoi du rapport complet en PDF au client ; « Investiguer » retiré.

**Architecture:** L'edge `dpe-lien` gagne cinq actions (`rattacher`, `choisir`, `detacher`, `actualiser`, `envoyer`). Elle géocode l'adresse elle-même (BAN IGN), interroge le corpus par clé BAN, applique la règle automatique, lit le dossier, et écrit en une fois `majordhome.client_dpe` + `clients.dpe_number` par une RPC service_role. La carte est rendue depuis `client_dpe` (aucun appel réseau à l'ouverture). L'envoi télécharge le PDF du rapport complet chez MonsieurDPE et l'envoie par Resend comme `invoice-send`.

**Tech Stack:** React 18, TanStack Query v5, Supabase (Postgres, edge Deno), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-12-logement-monsieurdpe-fiche-client-design.md` (à lire avant toute tâche), et pour l'infrastructure existante `docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md`.

## Global Constraints

- Dépôt `C:\Dev\Frontend-Majordhome`, branche `main`, pas de worktree. Aucune modification du dépôt `C:\Dev\DPE`.
- Charte multi-tenant de `CLAUDE.md` : RLS org, vue `security_invoker`, `REVOKE … FROM PUBLIC, anon` (et `authenticated` pour une RPC qui prend `org_id`), `GRANT SELECT … TO service_role`, cache keys `orgId` en premier, `unwrapResult`, `logger`.
- `clients.org_id` = organisation CORE.
- **Jamais** : rattacher automatiquement plusieurs candidats, un DPE du voisinage, un appartement dérivé de l'immeuble ; écraser un numéro d'origine `saisi` ; envoyer à une adresse autre que `clients.email`.
- Un champ absent du corpus est absent de la carte.
- Seuils du rattachement = constantes nommées, justifiées par la mesure de la tâche 1.
- Vérification : `node --test` des modules, `npm run audit:quality`, `npx vite build`. Pas d'outil de prévisualisation.
- Migration répétée sur `scripts/migration-rehearsal/` avant la prod ; edge déployée avec `--yes`.

## Review Focus

1. **Fiche ouverte deux fois de suite pendant que la première tentative tourne** : une seule ligne `client_dpe`, pas deux rattachements. Test : RPC idempotente (tâche 3).
2. **Numéro tapé à la main pendant qu'un rattachement auto existe** : le numéro saisi gagne, la carte se relit pour lui. Test : `actionALouverture` (tâche 2) + RPC refuse `auto` sur un `saisi` (tâche 3).
3. **Adresse corrigée après un rattachement auto** : DPE détaché puis nouvelle tentative ; `choisi` conservé et signalé. Test : `actionALouverture` (tâche 2).
4. **Corpus ou géocodeur en panne à l'ouverture** : état `erreur` enregistré, nouvel essai possible, aucune fausse donnée. Test : règles de l'edge (tâche 4).
5. **Envoi sans rapport complet / sans e-mail / module Communication fermé** : bouton grisé avec la raison, l'edge refuse aussi. Test : `disponibiliteEnvoi` (tâche 2) + codes de l'edge (tâche 5).

---

### Task 1 : Mesurer et fixer les seuils du rattachement automatique

**Files:** Create `scripts/dpe/mesure-rattachement-auto.mjs`.

- [ ] Script en lecture seule, agrégats seulement : 200 clients Mayer tirés au hasard (adresse complète) ; géocodage `https://data.geopf.fr/geocodage/search?q=…&limit=1` (score, type, `id` = clé BAN) ; corpus `/dossier-batiment?cle_ban=` ; pour les cas à un seul DPE, `/dossier/{n}` (méthode d'application) et l'adresse brute ADEME (`data-fair …/lines?qs=numero_dpe:"…"&select=adresse_brut,code_postal_brut,nom_commune_brut`) comparée à la fiche par `memeAdresseQueLaFiche` (`src/lib/dpeApi.js`).
- [ ] Sortie : nombre de candidats (0, 1, 2+), répartition score × type × `fiabilite_geocodage`, concordance d'adresse par tranche, part qui serait rattachée automatiquement pour les seuils candidats.
- [ ] Fixer `SCORE_GEOCODAGE_MIN`, `TYPES_GEOCODAGE_ACCEPTES`, `FIABILITES_BDNB_ACCEPTEES` (tâche 4). **Arrêt** si un cas retenu automatiquement est discordant, ou si moins de la moitié des clients à DPE unique sont retenus. Sinon rapport à Eric et suite.
- [ ] Commit du script.

### Task 2 : Modules purs

**Files:** Create `src/lib/dpeCorpus.js` ; Modify `src/lib/dpeLien.js` ; Tests `scripts/dpe-corpus.test.mjs`, `scripts/dpe-lien.test.mjs` (ajout à `audit:quality`). `dpeCorpus.js` est copié pour Deno par `npm run sync:tournee-engine` (ajouter le fichier à la liste du script de synchro).

**Interfaces (produites) :**
- `mapCorpusDossier(data: { dossier, composants }) → record | null` — même forme que `mapDpeRecord` (`dpeNumber, dpeLabel, gesLabel, buildingType, surface, levels, heatingGenerator, heatingEnergy, ecsGenerator, ventilation, insulation*, consoPerM2, annualCost, ubat, heatLoss{…}, costs{…}, dpeDate, dpeValidUntil`) + `periodeConstruction`, `immeubleDerive`, `rapportComplet`. Correspondance : `classe_bilan_dpe`, `classe_emission_ges`, `methode_application_dpe` (type lisible), `surface_habitable_logement`, `nombre_niveaux`, `type_generateur_chauffage`, `type_energie_chauffage`, `type_generateur_ecs`, `type_ventilation`, `qualite_isolation_enveloppe|_mur|_menuiserie|_plancher_haut|_plancher_bas`, `conso_ep_m2`, `cout_5_usages`, `ubat`, `deperdition_enveloppe|_mur|_plancher_haut|_plancher_bas|_baie_vitree|_porte|_pont_thermique|_renouvellement_air`, `cout_chauffage|_ecs|_refroidissement|_eclairage|_auxiliaires`, `date_etablissement`, `date_fin_validite`. Pour un dossier `immeubleDerive`, `heatLoss` est vide (piège d'échelle). `buildHeatLossBreakdown`, `buildCostBreakdown`, `buildEquipmentDrafts`, `toClientPatch`, `isDpeExpired` de `dpeApi.js` s'appliquent tels quels.
- `colonnesFiltrables(record) → { etiquette_dpe, etiquette_ges, energie_chauffage, generateur_chauffage, surface, periode_construction, date_dpe, rapport_complet }`.
- `dpeLien.js` : `actionALouverture({ adresseFiche, clientDpe, dpeNumberFiche }) → 'rien' | 'rattacher' | 'actualiser' | 'signaler_adresse'` ; `adresseNormalisee(client) → string` ; `disponibiliteEnvoi({ communicationActive, emailClient, rapportComplet, peutModifier }) → { visible, actif, raison }`.

- [ ] Tests d'abord (fixture = dossier réel 2631E0482288Y relevé le 2026-11-12, adresse retirée) : correspondance champ par champ ; dossier sans composant ⇒ `rapportComplet=false` ; appartement dérivé ⇒ `heatLoss` vide et `rapportComplet=false` ; `buildHeatLossBreakdown(mapCorpusDossier(f))` somme à 100 % ; `actionALouverture` : pas de ligne ⇒ rattacher ; adresse changée + `auto` ⇒ rattacher ; adresse changée + `choisi` ⇒ signaler ; numéro de la fiche ≠ ligne ⇒ actualiser ; tentative `aucun_dpe` à la même adresse ⇒ rien ; `disponibiliteEnvoi` pour chaque raison.
- [ ] Implémenter, tests verts, synchro Deno, commit.

### Task 3 : Table `majordhome.client_dpe` et RPC

**Files:** Create `supabase/migrations/20261112_2_client_dpe.sql`, `scripts/migration-rehearsal/assert-client-dpe.sql`.

- Table (une ligne par client, `UNIQUE(client_id)`) : `org_id` (core), `client_id`, `dpe_number`, `origine` (`auto|choisi|saisi`, nullable si rien), `etat` (`rattache|candidats|aucun_dpe|adresse_non_trouvee|erreur`), `adresse_tentee`, `tente_le`, `candidats jsonb`, `ecartes text[]`, `voisinage boolean`, colonnes filtrables de `colonnesFiltrables`, `carte jsonb`, `version_carte int`, `lu_le`, `rattache_par`, `rattache_le`. RLS SELECT membre ; aucune écriture `authenticated` ; vue `public.majordhome_client_dpe` lecture seule ; `GRANT SELECT … service_role`.
- RPC `public.client_dpe_record(p_org_id uuid, p_client_id uuid, p_patch jsonb, p_user uuid) returns jsonb`, SECURITY DEFINER, service_role seul : vérifie que le client est de l'org ; upsert de la ligne ; si `p_patch` porte un numéro, met `clients.dpe_number` dans la même transaction ; **refuse** (`client_dpe_saisi_protege`) un `origine='auto'` quand la ligne est `saisi` ou que `clients.dpe_number` est non nul et différent ; `detacher` met le numéro dans `ecartes` et vide `clients.dpe_number`.
- Reprise : les clients ayant un `dpe_number` reçoivent une ligne `origine='choisi'`, `etat='rattache'`, `carte` nulle (relue à l'ouverture par `actualiser`).
- [ ] Assertions d'abord (privilèges, idempotence, refus auto sur saisi, client d'une autre org refusé, détacher), répétition sur le harnais, application en prod, commit + `docs/DATABASE.md`.

### Task 4 : Edge `dpe-lien` — rattacher, choisir, détacher, actualiser

**Files:** Modify `supabase/functions/dpe-lien/index.ts`, `regles.js` ; tests `scripts/dpe-lien-edge.test.mjs`.

- `regles.js` produit : `SCORE_GEOCODAGE_MIN`, `TYPES_GEOCODAGE_ACCEPTES`, `FIABILITES_BDNB_ACCEPTEES` (valeurs de la tâche 1) ; `decisionRattachement({ geocodage, candidats, dossierUnique, ecartes }) → { etat, numero?, candidats }`.
- Actions (toutes : module `dpe`, `user_can(clients, edit)` sauf lecture) :
  - `rattacher { client_id }` : relit le client ; adresse incomplète ⇒ rien ; géocode ; corpus par `cle_ban` ; candidats hors `ecartes` ; si un seul, lit `/dossier/{n}` ; `decisionRattachement` ; enregistre par la RPC (carte incluse si rattaché). Panne ⇒ `etat='erreur'` enregistré.
  - `choisir { client_id, numero, voisinage? }` : lit le dossier, origine `choisi`.
  - `detacher { client_id }`.
  - `actualiser { client_id }` : relit le dossier du `dpe_number` de la fiche ; origine `saisi` si le numéro diffère de la ligne, sinon inchangée.
- [ ] Tests de `decisionRattachement` d'abord (zéro, un sûr, un douteux par chaque critère, plusieurs, numéro écarté, appartement dérivé), implémentation, déploiement, commit.

### Task 5 : Envoi du rapport au client

**Files:** Create `src/lib/dpeRapportEmailTemplate.js` (gabarit par défaut, clé `rapport_dpe`, placeholders `{{CLIENT_NAME}} {{LIEN_RAPPORT}}` + branding) ; Modify `EmailsTab.jsx` (une ligne de gabarit), `dpe-lien/index.ts` (action `envoyer`).

- `envoyer { client_id }` : module `communication` ouvert, expéditeur configuré, `clients.email` présent, rapport complet disponible ; émet l'accès s'il manque ; télécharge `GET {MDH_DPE_SITE_URL}/api/pdf/rapport-complet?numero=…&acces=…` (délai 90 s, `%PDF-` vérifié, plafond 25 Mo) ; gabarit `rapport_dpe` ; `sendResendEmail` ; `insertMailingLog` (`campaign_name='rapport_dpe'`). Codes : `module_communication_inactif`, `no_from_email`, `client_sans_email`, `sans_rapport_complet`, `template_missing`, `pdf_indisponible`, `resend_failed` (ajoutés à `CODES` et traduits).
- [ ] Tests (codes traduits, gabarit), implémentation, déploiement, commit.

### Task 6 : Le bloc Logement

**Files:** Create `src/apps/artisan/components/clients/DpeLogementCard.jsx` (rendu de la carte, extrait de `RecordCard`), `ClientLogementDpe.jsx` (remplace `ClientDpeLinkPanel.jsx`) ; Modify `ClientInvestigationPanel.jsx` (devient la recherche de voisinage, utilise `DpeLogementCard`, bouton « C'est ce logement » ⇒ `choisir` avec `voisinage`), `TabInfo.jsx`, `ClientDetail.jsx` ; service + hook `useDpeLien` (`clientDpe`, `rattacher`, `choisir`, `detacher`, `actualiser`, `envoyer`) ; cache key `dpeLienKeys.client(orgId, clientId)`.

- À l'ouverture : `actionALouverture` décide, une seule fois par montage.
- États : rattaché (carte + origine + « Ce n'est pas le bon » + « Mettre à jour » + boutons rapport/lien/envoi), candidats (liste, un clic), aucun DPE (message + « Chercher dans le voisinage »), erreur (« Réessayer »), adresse modifiée (bandeau).
- Équipements à recenser et « Renseigner la fiche » branchés sur les callbacks existants de `ClientDetail`.
- Retirer le bouton « Investiguer », `ClientDpeLinkPanel.jsx`, la synthèse PDF (`dpeSyntheseExport.js`, `DpeSynthesePDF.jsx`, `dpeReportModel.js` et son test s'ils n'ont plus d'appelant — vérifier `planningPrintExport.js`).
- [ ] `npm run audit:quality`, `npx vite build`, commit, push, suivi Vercel.

### Task 7 : Documentation et recette

- [ ] `CLAUDE.md` § Module MonsieurDPE (remplace la section du chantier 1 et le § Investigation bâtiment), mémoire.
- [ ] Recette réelle possible sans session : appeler la RPC et le corpus pour FRAYSSINET via un script service_role et vérifier la ligne écrite ; le parcours écran reste à faire par Eric.
- [ ] Revue finale par un relecteur neuf ; corrections Critical / Important avec test rouge puis vert.
