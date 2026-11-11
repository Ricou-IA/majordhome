# Lien MonsieurDPE sur la fiche client — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis la fiche d'un client Majord'home, retrouver son DPE dans le corpus MonsieurDPE, enregistrer le numéro, et ouvrir ou copier le lien du rapport complet MonsieurDPE, sans paiement.

**Architecture:** Une edge function Majord'home (`dpe-lien`) relaie trois actions fermées vers le corpus (VPS) et vers une porte partenaire du site MonsieurDPE. La porte émet un jeton par (organisation, numéro) dans une table à part `dpe.acces_partenaire` ; le mur du rapport complet apprend à l'accepter et masque alors les entreprises RGE. Majord'home garde le jeton dans `majordhome.dpe_report_accesses`.

**Tech Stack:** Majord'home : React 18, TanStack Query v5, Supabase edge functions (Deno), `node --test`. MonsieurDPE : Next 16, TypeScript strict, Vitest, PostgREST, corpus Python/FastAPI/DuckDB.

**Spec:** `docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md` (dépôt Majord'home). À lire avant toute tâche.

## Global Constraints

- **Deux dépôts.** `C:\Dev\Frontend-Majordhome` (branche `main`, jamais de worktree) et `C:\Dev\DPE` (branche `master`). Lire le `CLAUDE.md` de chacun, et `C:\Dev\DPE\site\CLAUDE.md` avant de toucher `site/`.
- **Dépôt DPE :** code, noms et commentaires en français ; `npm run verifier` vert avant tout commit ; `git commit -o <fichiers>` ; **aucun push sans accord explicite d'Eric** (un push déploie le site) ; une migration s'applique en base avant que le code qui l'utilise soit poussé ; pas de tiret cadratin dans les textes d'interface ; toute table du schéma `dpe` : RLS forcée, policy `service_role` seule, plus policy `baikal_read`.
- **Dépôt Majord'home :** charte multi-tenant de `CLAUDE.md` (RLS org, vue `security_invoker`, `REVOKE … FROM PUBLIC, anon`, `GRANT SELECT … TO service_role`, écriture `majordhome.*` par RPC SECURITY DEFINER, cache keys avec `orgId` en premier, `unwrapResult` dans les mutations, `logger` et non `console`). Vérification par `npx vite build` et `npm run audit:quality`, jamais par les outils de prévisualisation.
- **Deux projets Supabase :** Majord'home = `ejqqqwudmizqisdkxohw` ; schéma `dpe` = `odspcxgafcqxjzrarsqf`. Aucun accès base à base.
- **Secrets :** jamais affichés, jamais commités. Corpus : `x-corpus-secret`. Porte partenaire : `x-dpe-partenaire-secret`, secret **distinct** de celui du corpus.
- **Jamais de rattachement d'office** d'un DPE à un client. Aucun candidat présélectionné.
- **La route `POST /requete` du corpus n'est jamais appelée.**
- **Aucune adresse n'est écrite** côté MonsieurDPE ni dans un fichier commité.
- Numéro de DPE valide : `^[0-9A-Za-z]{13}$` (même règle que le site). Jeton : UUID v4.
- Ordre de livraison : tâches 1 à 4 (mesure, MonsieurDPE) avant 5 à 9 (Majord'home).

## Review Focus

1. **Client à plusieurs DPE sur le bâtiment, de même surface** (immeuble) : l'écran doit donner de quoi les distinguer, sinon l'humain choisit au hasard. Test : tâche 7 (`formaterCandidats` garde tout champ distinctif) et décision de la tâche 2.
2. **Numéro déjà saisi à la main et faux, ou d'un jeu hors corpus** (tertiaire, neuf, avant 2021) : pas de bouton d'analyse, message « absent du corpus », jamais « introuvable à l'ADEME ». Test : tâche 6 (action `verifier`, code `numero_absent`) et tâche 7.
3. **Corpus ou site MonsieurDPE injoignable, ou réponse 503 « base en cours de construction »** (le corpus se reconstruit toutes les heures) : message clair, rien d'enregistré, nouvel essai possible. Test : tâches 3 et 6 (`corpus_indisponible`, `partenaire_indisponible`).
4. **Double clic ou deux utilisateurs sur « Analyse MonsieurDPE »** : une seule ligne des deux côtés, même jeton. Test : tâche 3 (upsert idempotent) et tâche 5 (assertion d'unicité).
5. **Adresse du client incomplète ou géocodée ailleurs** (lieu-dit, commune seule) : le libellé géocodé s'affiche toujours pour comparaison ; clé BAN de type commune ⇒ zéro candidat, pas d'erreur. Test : tâche 7 (`formaterCandidats` avec `dpe: []` et `adresse: null`).

---

### Task 1 : Mesurer le rapprochement sur 50 clients Mayer

**Files:**
- Create: `scripts/dpe/mesure-rapprochement.mjs` (Majord'home)
- Sortie (non commitée) : dossier de travail temporaire de la session

**Interfaces:**
- Produces : un rapport chiffré, remis à Eric. Aucune interface de code pour les tâches suivantes.

- [ ] **Step 1 :** Tirer 50 clients Mayer au hasard avec adresse, code postal et ville non vides (lecture seule, connecteur Supabase du projet `ejqqqwudmizqisdkxohw`, table `majordhome.clients`, org majordhome de Mayer). Écrire `[{ id, adresse }]` dans un fichier JSON **hors dépôt**.
- [ ] **Step 2 :** Écrire `scripts/dpe/mesure-rapprochement.mjs` : `node scripts/dpe/mesure-rapprochement.mjs --clients <fichier.json> --env C:\Dev\DPE\site\.env.local`. Il lit `DPE_CORPUS_URL` et `DPE_CORPUS_SECRET` du fichier d'env (sans les afficher), appelle `GET /dossier-batiment?adresse=…` un client à la fois avec 300 ms de pause, et imprime **uniquement des agrégats** : nombre de réponses, part avec `batiment` non nul, part avec au moins un DPE, répartition du nombre de DPE (0, 1, 2 à 5, plus de 5), médiane et p95 du temps de réponse, liste des **noms de champs** rendus par DPE, nombre de réponses 503. Aucune adresse dans la sortie.
- [ ] **Step 3 :** Lancer. Attendu : 50 réponses, aucune 401.
- [ ] **Step 4 :** Pour 3 bâtiments à plusieurs DPE, relever à la main si les champs rendus permettent de distinguer les logements (étage, complément d'adresse). Noter oui ou non.
- [ ] **Step 5 :** Commit du script seul (`git commit -o scripts/dpe/mesure-rapprochement.mjs`).
- [ ] **Step 6 : POINT D'ARRÊT.** Rapporter les chiffres à Eric. Règle de décision à lui présenter : moins de 40 % de clients avec au moins un DPE ⇒ la saisie manuelle devient le chemin principal de l'écran (tâche 8) ; logements indistinguables ou adresse géocodée non comparable ⇒ la tâche 2 se fait, sinon elle se saute. Attendre sa réponse.

---

### Task 2 (conditionnelle) : Enrichir `/dossier-batiment` du corpus

À faire seulement si la tâche 1 le décide.

**Files:**
- Modify: `C:\Dev\DPE\corpus\dossier_batiment.py` (`_sql_dpe`, contrat de colonnes de `dpe_batiment`)
- Modify: `C:\Dev\DPE\corpus\interrogation.py` (`_geocoder_ban`, route `dossier_batiment`)
- Test: `C:\Dev\DPE\corpus\tests\` (fichiers existants de la vue bâtiment et de l'interrogation)

**Interfaces:**
- Produces : dans la réponse de `/dossier-batiment`, `adresse.libelle_geocode: str | null`, `adresse.score: float | null`, et par DPE `complement_adresse_logement: str | null`, `numero_etage_appartement` (ou les noms exacts de ces champs dans `sourcing.parquet`, à lire dans `data-model/`). **Ajouts seulement** : aucun champ existant n'est retiré ni renommé (le site consomme la route).

- [ ] **Step 1 :** Tests pytest qui échouent : la réponse porte `libelle_geocode` et `score` quand l'adresse est géocodée ; `dpe_batiment` porte les deux colonnes de distinction ; le test de contrat de colonnes est mis à jour.
- [ ] **Step 2 :** `python -m pytest corpus/tests` : les nouveaux tests échouent.
- [ ] **Step 3 :** Implémenter. `_geocoder_ban` rend déjà `libelle` et `score` : les faire remonter dans `adresse` même quand le bâtiment est trouvé.
- [ ] **Step 4 :** `python -m pytest corpus/tests` vert (13 tests Linux exclus sous Windows, comme documenté).
- [ ] **Step 5 :** Commit. **Déploiement sur le VPS et reconstruction de la vue bâtiment : seulement après accord d'Eric**, selon `corpus/interrogation-deploiement.md`, puis suite complète sur le VPS.

---

### Task 3 : Table `dpe.acces_partenaire` et porte partenaire du site

**Files:**
- Create: `C:\Dev\DPE\supabase\migrations\20261112120000_dpe_acces_partenaire.sql`
- Create: `C:\Dev\DPE\site\lib\partenaire\acces.ts`
- Create: `C:\Dev\DPE\site\app\api\partenaire\acces\route.ts` (coquille)
- Test: `C:\Dev\DPE\site\tests\partenaire-acces.test.ts`
- Modify: `C:\Dev\DPE\site\app\confidentialite\page.tsx` (ce que la porte conserve : numéro, organisation partenaire, date)

**Interfaces:**
- Produces (SQL) : `dpe.acces_partenaire(id bigint identity pk, partenaire text not null check (partenaire in ('majordhome')), org_id uuid not null, org_libelle text not null, numero_dpe text not null, jeton text not null unique default gen_random_uuid()::text, cree_le timestamptz not null default now(), revoque_le timestamptz, unique (partenaire, org_id, numero_dpe))`. RLS forcée, policy `service_role`, policy `baikal_read`, grants `service_role` (cf. §8 du `CLAUDE.md` DPE).
- Produces (HTTP) : `POST /api/partenaire/acces`, en-tête `x-dpe-partenaire-secret`, corps `{ numero: string, org_id: string, org_libelle: string }` → `200 { data: { jeton: string, url: string }, error: null }` où `url = https://www.monsieurdpe.fr/rapport/{numero}/complet?acces={jeton}` (base lue de l'env du site si elle existe, sinon cette constante). Erreurs `{ data: null, error: <code> }` : `401 secret_invalide`, `400 numero_mal_forme`, `400 organisation_invalide`, `404 numero_absent`, `503 corpus_indisponible`, `503 base_indisponible`.
- Produces (TS) : `emettreAccesPartenaire(deps: { corpus: ClientDossier; supabase: { url: string; cleService: string }; fetchImpl?: typeof fetch }, demande: { numero: string; orgId: string; orgLibelle: string }): Promise<{ data: { jeton: string } | null; error: string | null; statut: number }>`.
- Env du site : `DPE_PARTENAIRE_SECRET` (nouveau), `DPE_SUPABASE_URL`, `DPE_SUPABASE_CLE_SERVICE`, `DPE_CORPUS_URL`, `DPE_CORPUS_SECRET` (existants).

- [ ] **Step 1 :** Écrire la migration. Vérifier qu'elle se rejoue (`if not exists`).
- [ ] **Step 2 :** Tests Vitest qui échouent, avec `fetchImpl` injecté :

```ts
test("secret absent ou faux : 401, aucun appel sortant")
test("numéro de 12 caractères : 400 numero_mal_forme, aucun appel sortant")
test("org_id qui n'est pas un UUID : 400 organisation_invalide, aucun appel sortant")
test("numéro absent du corpus (404) : 404 numero_absent, aucune écriture")
test("corpus en 503 : 503 corpus_indisponible, aucune écriture")
test("première émission : upsert on_conflict=partenaire,org_id,numero_dpe, rend le jeton de la ligne")
test("seconde émission, même org et même numéro : même jeton")
test("PostgREST en erreur : 503 base_indisponible, trace console.error, jamais de jeton")
test("accès révoqué (revoque_le non nul) : la ligne est réactivée avec un jeton neuf")
```

- [ ] **Step 3 :** `npm run test` dans `site/` : les neuf échouent.
- [ ] **Step 4 :** Implémenter `emettreAccesPartenaire` puis la coquille de route. Comparaison du secret en temps constant. Upsert PostgREST avec `Prefer: resolution=merge-duplicates,return=representation`, en-tête `content-profile: dpe`. Limiteur existant (`creerLimiteur`) : 60 appels par minute.
- [ ] **Step 5 :** Compléter la page de confidentialité.
- [ ] **Step 6 :** `npm run verifier` à la racine du dépôt DPE : vert.
- [ ] **Step 7 :** Commit (`git commit -o` sur les fichiers de la tâche). Pas de push.

---

### Task 4 : Le mur du rapport accepte l'accès partenaire et masque les RGE

**Files:**
- Modify: `C:\Dev\DPE\site\lib\rapport\acces.ts`
- Modify: `C:\Dev\DPE\site\app\rapport\[numero]\complet\page.tsx` (vers les lignes 292 et 420 à 431)
- Test: `C:\Dev\DPE\site\tests\rapport-acces.test.ts`, et le test de page ou de rendu existant le plus proche pour la bande RGE

**Interfaces:**
- Consumes : table `dpe.acces_partenaire` (tâche 3).
- Produces : `type Acces = { ouvert: true; email: string; origine: "achat" | "partenaire" } | { ouvert: false; … }`. `accesParJeton` interroge `dpe.achat` (inchangé), puis, sans conclusion, `dpe.acces_partenaire` avec `jeton=eq`, `numero_dpe=eq`, `revoque_le=is.null` ; succès ⇒ `{ ouvert: true, email: "", origine: "partenaire" }`. Tous les chemins existants rendent `origine: "achat"`.

- [ ] **Step 1 :** Tests qui échouent :

```ts
test("jeton d'un achat : ouvert, origine achat (non-régression)")
test("jeton partenaire, bon numéro : ouvert, origine partenaire")
test("jeton partenaire, autre numéro : null")
test("jeton partenaire révoqué : null")
test("jeton difforme : aucun appel, ni sur achat ni sur acces_partenaire")
test("PostgREST en panne sur acces_partenaire : null, avec trace")
test("page, origine partenaire : artisansDuSecteur et citerArtisans jamais appelés, aucune bande RGE, aucune demande de devis")
test("page, origine achat : bande RGE et citation inchangées")
```

- [ ] **Step 2 :** Les lancer, constater l'échec.
- [ ] **Step 3 :** Implémenter dans `acces.ts`, puis conditionner dans la page tout ce qui montre ou compte un artisan tiers à `acces.origine === "achat"`. Vérifier chaque usage de `acces.email` dans la page : une chaîne vide ne doit rien afficher de cassé.
- [ ] **Step 4 :** Chercher les autres sorties du rapport complet qui citent des artisans (`grep -rn "citerArtisans\|artisansDuSecteur" site/`), dont `app/api/pdf/rapport-complet/route.ts` : même règle si le PDF est atteignable avec un jeton partenaire.
- [ ] **Step 5 :** `npm run verifier` vert. Commit.
- [ ] **Step 6 : POINT D'ARRÊT, livraison MonsieurDPE.** Demander l'accord d'Eric, puis dans l'ordre : appliquer la migration sur `odspcxgafcqxjzrarsqf` ; poser `DPE_PARTENAIRE_SECRET` (valeur générée, 32 octets aléatoires) dans Vercel, variable sensible ; `git fetch`, push `master` ; vérifier le déploiement de production pour ce commit ; essai réel avec `curl -L` sur l'apex : émettre un accès pour `2662E2065219C`, ouvrir l'URL, constater le rapport complet sans bande RGE ; second appel ⇒ même jeton.

---

### Task 5 : Majord'home — table des accès émis

**Files:**
- Create: `supabase/migrations/20261112_1_dpe_report_accesses.sql`
- Create: `scripts/migration-rehearsal/assert-dpe-report-accesses.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (table, vue, fonction dans les listes)
- Modify: `docs/DATABASE.md`

**Interfaces:**
- Produces : `majordhome.dpe_report_accesses(id uuid pk default gen_random_uuid(), org_id uuid not null references core.organizations, client_id uuid references majordhome.clients on delete set null, dpe_number text not null, token text not null, report_url text not null, issued_by uuid, issued_at timestamptz not null default now(), unique (org_id, dpe_number))`. `org_id` = organisation **CORE**.
- Produces : vue `public.majordhome_dpe_report_accesses` (`security_invoker=true`, lecture seule, `REVOKE ALL … FROM PUBLIC, anon`, `GRANT SELECT` à `authenticated` et `service_role`). Policy SELECT = membre de l'organisation. Aucune policy d'écriture.
- Produces : `public.dpe_report_access_record(p_org_id uuid, p_client_id uuid, p_dpe_number text, p_token text, p_report_url text, p_issued_by uuid) returns jsonb` — SECURITY DEFINER, `search_path = majordhome, public`, `REVOKE … FROM PUBLIC, anon, authenticated` (service_role seul : elle prend `org_id` en paramètre). `ON CONFLICT (org_id, dpe_number)` : met à jour jeton, lien et client. Rend la ligne.

- [ ] **Step 1 :** Écrire l'assertion : RLS active ; `has_function_privilege('anon' | 'authenticated', …, 'EXECUTE')` faux, vrai pour `service_role` ; `has_table_privilege('anon', vue, 'SELECT')` faux ; deux appels de la RPC pour le même (org, numéro) ⇒ une ligne ; un membre d'une autre organisation lit zéro ligne par la vue.
- [ ] **Step 2 :** Écrire la migration, étendre `snapshot.mjs`.
- [ ] **Step 3 :** Répéter sur le harnais (`scripts/migration-rehearsal/README.md`) : assertion verte.
- [ ] **Step 4 :** Appliquer en prod (`apply_migration`), puis `node scripts/permissions-coherence.mjs --env .env.local` : aucun échec nouveau.
- [ ] **Step 5 :** Documenter dans `docs/DATABASE.md`. Commit.

---

### Task 6 : Majord'home — edge function `dpe-lien`

**Files:**
- Create: `supabase/functions/dpe-lien/index.ts`
- Create: `supabase/functions/dpe-lien/regles.ts` (pur, sans import Deno ni réseau)
- Test: `scripts/dpe-lien-edge.test.mjs` (importe `regles.ts` ; si l'import direct d'un `.ts` ne passe pas sous `node --test`, écrire `regles.js` avec JSDoc, comme les modules copiés de `_shared/`)
- Modify: `supabase/config.toml` (`[functions.dpe-lien] verify_jwt = true`)
- Modify: `package.json` (test ajouté à `audit:quality`)

**Interfaces:**
- Consumes : corpus `GET /dossier-batiment?adresse=`, `GET /dossier/{numero}` ; porte `POST /api/partenaire/acces` (tâche 3) ; RPC `dpe_report_access_record` et vue (tâche 5) ; `requireOrgMembership`, `jsonResponse`, `sanitizeError` de `_shared/auth.ts` ; RPC `user_can`.
- Secrets : `MDH_DPE_CORPUS_URL`, `MDH_DPE_CORPUS_SECRET`, `MDH_DPE_SITE_URL`, `MDH_DPE_PARTENAIRE_SECRET`.
- Produces : `POST dpe-lien`, corps `{ org_id, action, … }`, réponses `{ data, error }` où `error` est un **code** :
  - `action: "chercher"`, `{ client_id }` → `{ adresse: { libelle, libelle_geocode?, score? } | null, batiment_trouve: boolean, candidats: object[] }` (les objets DPE du corpus, tels quels). L'adresse est relue **en base** depuis le client.
  - `action: "verifier"`, `{ numero }` → `{ present: boolean, resume: { etiquette, date, surface, type } | null }`.
  - `action: "ouvrir"`, `{ client_id }` → `{ url, numero, deja_emis: boolean }`. Relit `dpe_number` en base ; ligne déjà présente pour (org, numéro) ⇒ rendue sans appeler MonsieurDPE.
  - Codes : `module_ferme`, `droit_requis`, `action_inconnue`, `client_introuvable`, `adresse_incomplete`, `client_sans_numero`, `numero_mal_forme`, `numero_absent`, `corpus_indisponible`, `partenaire_indisponible`, `enregistrement_impossible`.
- Produces (pur) : `numeroValide(n: string): boolean` ; `adresseDeRecherche(client: { address, postal_code, city }): string | null` (null si rue ou commune manquante) ; `codeDepuisCorpus(statut: number, error: string | null): string | null` ; `resumeDossier(dossier: object): { etiquette, date, surface, type }`.

- [ ] **Step 1 :** Tests qui échouent sur `regles` :

```js
test('numeroValide : 13 alphanumériques oui, 12 non, espace non')
test('adresseDeRecherche : rue + CP + ville ⇒ "12 rue X 81600 Gaillac"')
test('adresseDeRecherche : ville seule ⇒ null')
test('codeDepuisCorpus : 503 ⇒ corpus_indisponible ; 404 ⇒ numero_absent ; 401 ⇒ corpus_indisponible ; 200 ⇒ null')
test('resumeDossier : champs absents ⇒ null, jamais undefined')
```

- [ ] **Step 2 :** `node --test scripts/dpe-lien-edge.test.mjs` : échec.
- [ ] **Step 3 :** Implémenter `regles`, tests verts.
- [ ] **Step 4 :** Implémenter `index.ts`. Ordre des gardes : `requireOrgMembership` avec `orgSettingsFilter` sur `settings.modules.dpe === true` (sinon `module_ferme`) → `user_can(org, 'clients', 'edit')` au jeton de l'utilisateur (sinon `droit_requis`) → action. Le client est lu avec le client Supabase **de l'utilisateur** sur `majordhome_clients`, filtré par l'organisation majordhome qui correspond à l'organisation core de l'appelant (`majordhome.organizations.core_org_id`, cf. `getMajordhomeOrgId` côté front) : zéro ligne ⇒ `client_introuvable`. Délai de 10 s sur chaque appel sortant. Lire `{ error }` de la RPC ⇒ `enregistrement_impossible`. Aucune URL sortante composée à partir du corps de la requête, hors `encodeURIComponent` de l'adresse relue en base et du numéro validé.
- [ ] **Step 5 :** Poser les quatre secrets (le secret du corpus et celui de la porte viennent des tâches 1 et 4 ; ne jamais les afficher). Déployer (`deploy_edge_function`, avec `../_shared/auth.ts`).
- [ ] **Step 6 :** Essais réels, module encore fermé pour Mayer : toute action ⇒ `module_ferme`. (Les essais ouverts se font en tâche 9.)
- [ ] **Step 7 :** Commit.

---

### Task 7 : Majord'home — module pur, service, hook, module de l'offre

**Files:**
- Create: `src/lib/dpeLien.js`
- Test: `scripts/dpe-lien.test.mjs` (ajouté à `audit:quality`)
- Create: `src/shared/services/dpeLien.service.js`
- Create: `src/shared/hooks/useDpeLien.js`
- Modify: `src/shared/hooks/cacheKeys.js` (`dpeLienKeys`)
- Modify: `src/lib/modules.js` (entrée `CATALOGUE`), `scripts/modules.test.mjs`

**Interfaces:**
- Consumes : edge `dpe-lien` (tâche 6), vue `majordhome_dpe_report_accesses` (tâche 5).
- Produces (`src/lib/dpeLien.js`, pur) :
  - `formaterCandidats(data): { adresseLibelle: string | null, adresseGeocodee: string | null, batimentTrouve: boolean, candidats: Array<{ numero, date, etiquette, surface, type, distinction: string | null }> }` — trie du plus récent au plus ancien ; `distinction` concatène étage et complément d'adresse s'ils existent ; n'en présélectionne aucun.
  - `messageErreurDpeLien(code: string): string` — un message français par code de la tâche 6, et un message générique pour un code inconnu.
  - `etatDuLien({ dpeNumber, verification, acces }): 'sans_numero' | 'a_verifier' | 'absent_du_corpus' | 'pret' | 'emis'`.
- Produces (service) : `dpeLienService.chercher(orgId, clientId)`, `.verifier(orgId, numero)`, `.ouvrir(orgId, clientId)`, `.getAcces(orgId, dpeNumber)` → `{ data, error }`.
- Produces (hook) : `useDpeLien({ orgId, clientId, dpeNumber })` → `{ acces, verification, chercher, ouvrir, isSearching, isOpening }`. `dpeLienKeys.all(orgId)`, `.acces(orgId, dpeNumber)`, `.verification(orgId, numero)`. `enabled: !!orgId && …`.
- Produces (offre) : `{ key: 'dpe', label: 'MonsieurDPE', description: "DPE du client et analyse complète du logement.", parDefaut: false, accueil: null }`.

- [ ] **Step 1 :** Tests qui échouent :

```js
test('formaterCandidats : dpe vide et adresse nulle ⇒ zéro candidat, batimentTrouve faux')
test('formaterCandidats : trois DPE ⇒ tri par date décroissante, aucun marqué choisi')
test('formaterCandidats : deux DPE de même surface ⇒ distinction portée si étage ou complément présents')
test('formaterCandidats : champs inconnus du corpus ⇒ ignorés sans erreur')
test('messageErreurDpeLien : chaque code de la liste a un message distinct et non vide')
test('messageErreurDpeLien : numero_absent ne contient pas le mot « introuvable »')
test('etatDuLien : sans numéro / numéro non vérifié / absent du corpus / prêt / émis')
```

- [ ] **Step 2 :** Les lancer : échec.
- [ ] **Step 3 :** Implémenter `dpeLien.js`. Tests verts.
- [ ] **Step 4 :** Service (`supabase.functions.invoke('dpe-lien')`, erreur = code rendu par l'edge) puis hook (`unwrapResult` dans chaque `mutationFn`, invalidation de `dpeLienKeys.acces` après `ouvrir`).
- [ ] **Step 5 :** Ajouter l'entrée au `CATALOGUE`, compléter `scripts/modules.test.mjs` (clé `dpe` fermée par défaut).
- [ ] **Step 6 :** `npm run audit:quality` vert. Commit.

---

### Task 8 : Majord'home — le bloc sur la fiche client

**Files:**
- Create: `src/apps/artisan/components/clients/ClientDpeLinkPanel.jsx`
- Modify: `src/apps/artisan/pages/client-detail/TabInfo.jsx` (bloc Logement, autour des lignes 423 à 445)

**Interfaces:**
- Consumes : `useDpeLien`, `formaterCandidats`, `messageErreurDpeLien`, `etatDuLien` (tâche 7) ; `moduleActif(settings, 'dpe')` via `useOrgSettings()` ; `useCanAccess().can('clients', 'edit')` ; la mutation de mise à jour du client déjà utilisée par la fiche (`useClient`).
- Produces : `<ClientDpeLinkPanel client={client} dpeNumber={formData.dpeNumber} onDpeNumberSaved={(numero) => …} disabled={isLocked} />`.

Comportement, à réaliser avec les composants existants (`FormFields.jsx`, `components/ui`) :

- Module fermé ⇒ le composant ne rend rien ; le bloc Logement reste tel qu'aujourd'hui.
- Bouton « Rechercher le DPE » ; désactivé avec la raison si l'adresse est incomplète ou si l'utilisateur n'a pas `clients.edit`.
- Résultat : l'adresse du client et l'adresse géocodée l'une sous l'autre, puis la liste des candidats. Chaque ligne a son bouton « C'est ce logement ». Aucune ligne présélectionnée.
- Confirmer ⇒ `dpe_number` enregistré **tout de suite** par la mutation client (toast de succès ou d'échec), puis `onDpeNumberSaved` met à jour le formulaire de la fiche pour qu'un enregistrement global ultérieur ne réécrive pas l'ancienne valeur.
- Zéro candidat ⇒ « Aucun DPE rattaché à ce bâtiment dans le corpus MonsieurDPE », avec renvoi vers « Investiguer » et vers le champ de saisie.
- Numéro présent (saisi ou confirmé) ⇒ vérification ; `absent_du_corpus` ⇒ message, pas de bouton d'analyse.
- État `pret` ou `emis` ⇒ boutons « Analyse MonsieurDPE » (ouvre `url` dans un nouvel onglet, `rel="noopener"`) et « Copier le lien » (presse-papiers, toast). L'un comme l'autre émet l'accès au premier usage.
- Un membre sans `clients.edit` voit les deux boutons seulement à l'état `emis` : le lien est alors lu dans la vue `majordhome_dpe_report_accesses`, sans appeler l'edge function.
- Si la tâche 1 a conclu à moins de 40 % de rattachement : le champ de saisie du numéro passe avant le bouton de recherche.
- Toute erreur passe par `messageErreurDpeLien` dans un `toast.error`.

- [ ] **Step 1 :** Écrire le composant (moins de 500 lignes, pas de logique métier dans le JSX).
- [ ] **Step 2 :** Le monter dans `TabInfo.jsx`. Le lien existant vers l'observatoire ADEME et le bouton « Investiguer » restent en place.
- [ ] **Step 3 :** `npx vite build` et `npm run lint` : verts, aucun avertissement nouveau.
- [ ] **Step 4 :** Commit.

---

### Task 9 : Ouvrir pour Mayer, recette réelle, documentation

**Files:**
- Modify: `CLAUDE.md` (section « Module MonsieurDPE » : règles qui mordent)
- Modify: `C:\Dev\DPE\CLAUDE.md` via `.claude/proposed-updates.md` (la porte partenaire et l'origine d'un accès)

- [ ] **Step 1 :** Pousser Majord'home sur `main`, suivre le déploiement Vercel jusqu'à READY.
- [ ] **Step 2 :** Ouvrir le module `dpe` pour Mayer par l'edge `baikal-admin` (jamais un `UPDATE` SQL sur `settings.modules`). Si l'appel exige un geste d'Eric dans Baikal, le lui demander, une action par message.
- [ ] **Step 3 :** Recette réelle sur la prod, sur trois fiches Mayer choisies d'après la tâche 1 (un DPE unique, plusieurs DPE, aucun DPE) :
  - recherche, confirmation, numéro enregistré (relire `majordhome.clients.dpe_number`) ;
  - « Analyse MonsieurDPE » ouvre le rapport complet, sans bande RGE ;
  - second clic : `deja_emis: true`, une ligne dans `majordhome.dpe_report_accesses`, une ligne dans `dpe.acces_partenaire` ;
  - « Copier le lien » puis ouverture en navigation privée : même rapport ;
  - le lien avec un autre numéro dans l'URL : mur fermé ;
  - fiche sans DPE : message et repli visibles.
- [ ] **Step 4 :** Vérifier les refus : appel de `dpe-lien` avec le jeton d'un membre sans `clients.edit` ⇒ `droit_requis` ; `client_id` d'une autre organisation ⇒ `client_introuvable`.
- [ ] **Step 5 :** Écrire la section de `CLAUDE.md` et la proposition côté DPE. Commit, push.
- [ ] **Step 6 :** Rapport à Eric : ce qui est fait, les chiffres de la tâche 1, ce qui n'est pas couvert (client à plusieurs logements, adresses hors BDNB, DPE récents absents de la vue bâtiment), et ce que le chantier 2 pourra réutiliser.
