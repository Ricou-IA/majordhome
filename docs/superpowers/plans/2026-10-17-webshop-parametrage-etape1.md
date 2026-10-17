# Webshop — paramétrage, étape 1 (zone Settings + livraison palette) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une tuile Settings → Webshop qui porte tous les réglages de livraison (palette, dépôts, secteurs, colis de base, adresses internes), lus par Majord'home, par la base et par le site Mayer à la place des valeurs en dur et des variables d'env.

**Architecture:** Un module PUR `src/lib/webshop/reglages.js` est la source unique des clés et des défauts (= comportement actuel) ; il est copié tel quel par le site et sert de générateur au SQL (`majordhome.webshop_reglages(org)`), comme le registre des droits. Les scalaires vivent dans `core.organizations.settings.webshop` (écrit via `useOrgSettings().save`, objet COMPLET), les listes dans les tables existantes (`webshop_sectors`, `webshop_sector_postcodes`, `webshop_shipping_rates`, `webshop_pickup_points`) écrites par des RPC org_admin.

**Tech Stack:** React 18 + Tailwind (Majord'home), PostgreSQL / pg_cron / pg_net (Supabase prod `ejqqqwudmizqisdkxohw`), Next.js (site `C:\Dev\Landing Page - Mayer`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-17-webshop-parametrage-livraison-process-design.md` (§ 4.1, 4.2, 4.3 réglages, 4.5 adresses, § 5, § 6). Hors étape 1 : Process / déclencheurs, gabarits e-mail, ordre colis, API.

## Global Constraints

- Aucune valeur métier en dur : chaque valeur citée au § 3 du spec pour l'étape 1 est lue depuis `buildWebshopConfig(settings)` (JS/TS) ou `majordhome.webshop_reglages(org_id)` (SQL).
- Défauts = comportement actuel : fermeture J-2, horizon 12 semaines, ancre de cycle `2026-01-05`, capacité camion 10 emplacements, prix d'emplacement par défaut 5500 cts, TVA transport palette 10 %, max 10 emplacements par panier, TVA port colis 20 %, max 20 colis par ligne, dépôt `castanet` = « Dépôt Castanet-Tolosan » / « Castanet-Tolosan ».
- Heure d'envoi automatique des feuilles de route : **heure de Paris**, défaut **18** (Claude : valeur hiver du cron actuel `0 17 * * *` UTC ; l'été il partait à 19 h), réglage `palette.envoi_auto` défaut `true`.
- `org_update_settings` merge JSONB niveau 1 → toujours sauver l'objet `webshop` COMPLET.
- Multi-tenant (CLAUDE.md) : toute RPC SECURITY DEFINER → `REVOKE EXECUTE … FROM PUBLIC, anon` (+ `authenticated` si service_role only), garde `IF (autorisé) IS NOT TRUE THEN RAISE`, `auth.uid() IS NULL` refusé en première instruction ; filtres `org_id` explicites côté front ; jamais `.schema('majordhome')` depuis le front.
- Org des tables webshop = org **CORE** (`3c68193e-…` pour Mayer, cf. migration site `20261013_1_webshop_org_core.sql`).
- Le site est un second consommateur : aucune fonction SQL ne change de signature ; les migrations se répètent sur `scripts/migration-rehearsal/` avant prod ; ordre de livraison = base → Majord'home → site.
- Échec fort : envoi d'une feuille de route sans `site_url` → `site_url_missing` ; site sans transporteur paramétré → repli sur `TRANSPORTEUR_EMAIL` **signalé dans l'alerte interne**.
- Pas de nouveau warning ESLint ; `npm run audit:quality` vert ; `npx vite build` vert. Pas de preview tools.

## Review Focus

1. **Heure d'été / d'hiver** : le job pg_cron horaire doit déclencher l'envoi exactement une fois par jour à l'heure de Paris réglée, aux deux changements d'heure → test SQL dans Task 2 (`webshop_should_send(org, ts)` sur `2026-10-25 17:00 UTC` = 18 h Paris après bascule, et `2026-10-24 16:00 UTC` = 18 h Paris avant).
2. **Réglages partiels ou faux** (`settings.webshop` absent, sous-objet manquant, nombre en texte, délai négatif) : retombée sur le défaut, jamais `NaN`/`NULL` en base → tests de `buildWebshopConfig` (Task 1) et assert SQL (Task 2).
3. **Changer le délai J-n** alors que des créneaux sont déjà fermés : rien ne se rouvre tout seul ; seuls les créneaux ouverts sont fermés selon le nouveau délai → assert Task 2.
4. **Désactiver / modifier un secteur qui porte des commandes** : jamais de suppression d'un secteur ayant des créneaux ; « Régénérer » ne touche pas un créneau qui a une commande ou n'est pas `open` → assert Task 3.
5. **Code postal déjà rattaché à un autre secteur** : refus explicite (`postcode_taken`, avec le secteur concerné), pas de déplacement silencieux → assert Task 3.

---

### Task 1: Module pur des réglages webshop

**Files:**
- Create: `src/lib/webshop/reglages.js`
- Create: `scripts/webshop-reglages.test.mjs`
- Modify: `package.json` (ajouter le test à `audit:quality`)

**Interfaces:**
- Produces:
  - `WEBSHOP_REGLAGES_DEFAUT` (objet figé) :
    ```js
    {
      site_url: '',
      emails: { interne: [] },                       // destinataires internes (copie feuilles, alertes)
      depots: [{ code: 'castanet', libelle: 'Dépôt Castanet-Tolosan', adresse: 'Castanet-Tolosan' }],
      palette: {
        transporteur: { nom: '', emails: [], note: '' },
        envoi_auto: true, heure_envoi: 18,
        delai_fermeture_jours: 2, horizon_semaines: 12, ancre_cycle: '2026-01-05',
        capacite_emplacements: 10, prix_emplacement_defaut_cents: 5500,
        tva_pct: 10, max_emplacements_panier: 10,
      },
      colis: { prestataire: { nom: '', mode: 'email', emails: [], note: '' }, tva_pct: 20, max_qty_ligne: 20 },
    }
    ```
  - `buildWebshopConfig(settings) -> WebshopConfig` : fusion profonde défaut ← `settings?.webshop`, chaque scalaire coercé au type du défaut, hors bornes → défaut.
  - `validerWebshopReglages(cfg) -> Array<{ champ: string, message: string }>` : erreurs bloquantes pour l'écran.
  - `depotParCode(cfg, code) -> { code, libelle, adresse }` : code inconnu → `{ code, libelle: 'Dépôt ' + code, adresse: code }` (jamais un dépôt inventé, reprise de `depotFor`).
  - En-tête : « Copié tel quel par le site Mayer (`lib/boutique/reglages.js`) : ne rien importer ici. »

- [ ] **Step 1: Écrire les tests** (`scripts/webshop-reglages.test.mjs`)
  - `defauts quand settings vide` : `buildWebshopConfig(null)` deep-equal `WEBSHOP_REGLAGES_DEFAUT` ; idem `{}` et `{ webshop: {} }`.
  - `fusion partielle` : `{ webshop: { palette: { delai_fermeture_jours: 3 } } }` → `palette.delai_fermeture_jours === 3` et `palette.horizon_semaines === 12`, `colis.tva_pct === 20`.
  - `coercition` : `'4'` → `4` ; `'abc'`, `-1`, `null` sur `delai_fermeture_jours` → `2` ; `heure_envoi: 24` → `18` ; `heure_envoi: 0` → `0`.
  - Bornes : `delai_fermeture_jours` 0..14, `horizon_semaines` 1..26, `heure_envoi` 0..23, `capacite_emplacements` 1..40, `max_emplacements_panier` 1..`capacite_emplacements`, `tva_pct` ∈ {0, 5.5, 10, 20}, `max_qty_ligne` 1..100, `ancre_cycle` = date ISO `YYYY-MM-DD` valide sinon défaut.
  - Listes : `emails` non-chaîne ou vide filtrés, trim + minuscules ; `depots` vide → défaut ; dépôt sans `code` écarté.
  - `validerWebshopReglages` : e-mail mal formé dans `palette.transporteur.emails` → `{ champ: 'palette.transporteur.emails' }` ; `site_url` non `https://` → erreur `site_url` ; deux dépôts même code → erreur `depots`.
  - `depotParCode(cfg, 'castanet').libelle === 'Dépôt Castanet-Tolosan'` ; `depotParCode(cfg, 'xyz').adresse === 'xyz'`.

- [ ] **Step 2:** `node --test scripts/webshop-reglages.test.mjs` → FAIL (module absent).
- [ ] **Step 3:** Implémenter `src/lib/webshop/reglages.js` (aucun import, JSDoc sur chaque export).
- [ ] **Step 4:** `node --test scripts/webshop-reglages.test.mjs` → PASS ; ajouter le fichier à `audit:quality` ; `npm run audit:quality` → vert.
- [ ] **Step 5: Commit** — `feat(webshop): réglages de livraison — module pur et défauts`

---

### Task 2: Base — réglages lus par le SQL, cron horaire, URL du site

**Files:**
- Create: `scripts/gen-webshop-reglages-sql.mjs` (génère le corps de `majordhome.webshop_reglages_defaut()` depuis `WEBSHOP_REGLAGES_DEFAUT`, sur le modèle de `scripts/gen-app-role-permissions-sql.mjs`)
- Create: `supabase/migrations/20261017_1_webshop_reglages.sql`
- Create: `scripts/migration-rehearsal/assert-webshop-reglages.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (ajouter les fonctions remplacées absentes de la liste : `public.webshop_close_due_slots(date)`, `public.webshop_generate_slots(uuid,integer,date)`, `public.webshop_insert_slots(uuid,jsonb)`, `public.webshop_cycle_week(date)`, `public.webshop_is_french_holiday(date)`, `public.webshop_easter_sunday(integer)`, `public.webshop_apply_paid_order(uuid)`, `public.webshop_run_daily_tours(date)`, `public.webshop_slot_set_status(uuid,text,text)`, `public.webshop_order_move_slot(uuid,uuid)`, `public.webshop_slot_send_now(uuid)`, et la table `webshop_sector_postcodes`)

**Interfaces:**
- Consumes: `WEBSHOP_REGLAGES_DEFAUT` (Task 1).
- Produces (SQL) :
  - `majordhome.webshop_reglages_defaut() RETURNS jsonb` IMMUTABLE — **généré**, ne jamais éditer à la main.
  - `majordhome.webshop_reglages(p_org_id uuid) RETURNS jsonb` STABLE SECURITY DEFINER — fusion profonde défaut ← `core.organizations.settings->'webshop'` (même règles de coercition/bornes que Task 1 pour les clés `palette.*` lues par le SQL ; valeur invalide → défaut). REVOKE PUBLIC, anon, authenticated.
  - `majordhome.webshop_should_send(p_org_id uuid, p_at timestamptz) RETURNS boolean` — `envoi_auto` ET `extract(hour from p_at AT TIME ZONE 'Europe/Paris') = heure_envoi`.
  - `public.webshop_cycle_week(p_date date, p_ancre date)` (nouvelle surcharge) ; l'ancienne `webshop_cycle_week(date)` reste et délègue avec `DATE '2026-01-05'` (le site l'appelle peut-être — ne pas la supprimer).

- [ ] **Step 1: Écrire l'assert** `assert-webshop-reglages.sql` (blocs `DO $$ … RAISE EXCEPTION` sur échec, comme `assert-webshop-tournees.sql`) :
  - org sans `settings.webshop` : `webshop_reglages(org)->'palette'->>'delai_fermeture_jours' = '2'`, `heure_envoi = 18`, `capacite_emplacements = 10`.
  - `settings.webshop = {"palette":{"delai_fermeture_jours":"x"}}` → `2` ; `{"palette":{"delai_fermeture_jours":3}}` → `3`.
  - `webshop_should_send(org, '2026-10-24 16:00+00')` = true et `'2026-10-24 17:00+00'` = false (CEST) ; `'2026-10-25 17:00+00'` = true (CET) ; `envoi_auto=false` → false.
  - délai 3 : `webshop_close_due_slots(d)` ferme un créneau `open` à `d+3`, laisse `d+4` ouvert, ne rouvre pas un créneau `closed` à `d+5`, et n'affecte pas une autre org réglée à 2.
  - `webshop_generate_slots(org)` sans horizon → horizon de l'org ; `capacity_slots` = `capacite_emplacements` réglé.
  - `webshop_slot_send_now` avec `site_url` vide → exception `site_url_missing`.
  - `has_function_privilege('anon', …, 'EXECUTE')` faux pour chaque fonction créée/remplacée.
- [ ] **Step 2:** Lancer le harnais (`node scripts/migration-rehearsal/run.mjs` — cf. README du dossier) sans la migration → l'assert échoue (fonctions absentes).
- [ ] **Step 3: Écrire la migration** `20261017_1_webshop_reglages.sql` :
  - Corps de `webshop_reglages_defaut()` produit par `node scripts/gen-webshop-reglages-sql.mjs` et collé dans la migration.
  - Remplacer **à signature identique** (partir de la définition LIVE `pg_get_functiondef` en prod, pas des migrations — `webshop_apply_paid_order` a été réécrite 3 fois) : chaque `+ 2` de délai → `(webshop_reglages(org)->'palette'->>'delai_fermeture_jours')::int` ; chaque `10` de capacité → `capacite_emplacements` ; horizon `p_horizon_weeks DEFAULT NULL` → réglage de l'org si NULL ; `webshop_cycle_week(j.d)` → `webshop_cycle_week(j.d, ancre_cycle)` ; `webshop_close_due_slots(p_today)` ferme par org selon son délai ; `close_reason` reste `'j_minus_2'` (valeur de CHECK, libellé front corrigé en Task 4).
  - `webshop_run_daily_tours(p_today)` : ferme les créneaux échus de toutes les orgs, puis pour chaque org ayant des secteurs actifs ET `webshop_should_send(org, now())` : POST vers `site_url || '/api/boutique/cron/tournees'` avec `org_id` dans le body ; org sans `site_url` → `RAISE WARNING` + mention dans le texte retourné (la fermeture n'est pas annulée).
  - `webshop_slot_send_now` : URL depuis `site_url`, sinon `RAISE EXCEPTION 'site_url_missing' USING ERRCODE = '55000'`.
  - `cron.schedule('webshop-tours-daily', '0 * * * *', $$SELECT public.webshop_run_daily_tours()$$)` (même nom → mise à jour).
  - Backfill Mayer (org core `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`) si `settings->'webshop'->>'site_url'` vide : `site_url = 'https://www.mayer-energie.fr'` (merge niveau 1, sans écraser les autres clés de `webshop`).
  - REVOKE/GRANT recopiés à l'identique de l'existant pour chaque fonction remplacée.
- [ ] **Step 4:** Harnais → `assert-webshop-reglages.sql` + `assert-webshop-tournees.sql` verts.
- [ ] **Step 5:** Appliquer en prod (`apply_migration`), puis vérifier : `SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'webshop-%'` → `0 * * * *` ; `SELECT majordhome.webshop_reglages('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1')` → `site_url` renseignée, défauts ; `SELECT has_function_privilege('anon', 'majordhome.webshop_reglages(uuid)', 'EXECUTE')` → false.
- [ ] **Step 6: Commit** — `feat(webshop): la base lit les réglages de livraison (J-n, horizon, capacité, heure d'envoi, URL du site)`

---

### Task 3: Base — écriture des secteurs, codes postaux, tarifs colis, points de retrait

**Files:**
- Create: `supabase/migrations/20261017_2_webshop_reglages_listes.sql`
- Create: `scripts/migration-rehearsal/assert-webshop-reglages-listes.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (tables `webshop_shipping_rates`, données de `webshop_sector_postcodes`)

**Interfaces:**
- Produces (RPC `public.*`, SECURITY DEFINER, `SET search_path = majordhome, public`, garde : `auth.uid()` non NULL ET org_admin de l'org de la cible, sinon `org_admin_required` ; REVOKE PUBLIC, anon ; GRANT authenticated) :
  - `webshop_sector_upsert(p_org_id uuid, p_sector jsonb) RETURNS uuid` — champs `id?` (absent = création), `code`, `label`, `depot`, `max_stops`, `max_minutes`, `max_km`, `slot_price_ttc_cents`, `slots_per_cycle`, `recurrence` (`[{week 1-4, weekday 1-5}]`, validé), `is_active`. Création : `slot_price_ttc_cents` absent → `prix_emplacement_defaut_cents` du réglage. `depot` doit exister dans `webshop_reglages(org)->'depots'` sinon `depot_unknown`.
  - `webshop_sector_set_postcodes(p_sector_id uuid, p_rows jsonb) RETURNS int` — remplacement atomique `[{postal_code, insee_code, commune}]` ; un `insee_code` (ou CP sans INSEE) déjà rattaché à un AUTRE secteur de l'org → `RAISE EXCEPTION 'postcode_taken' USING DETAIL = <code du secteur>` et rien n'est écrit.
  - `webshop_regenerate_future_slots(p_org_id uuid) RETURNS jsonb` — supprime les créneaux `status='open'`, `delivery_date > aujourd'hui Paris + délai`, `used_slots = 0` et sans commande rattachée (`delivery_slot_id` / `requested_slot_id`), puis `webshop_generate_slots(org)` ; retourne `{ supprimes, crees }`.
  - `webshop_shipping_rate_upsert(p_org_id uuid, p_rate jsonb) RETURNS uuid`, `webshop_shipping_rate_delete(p_rate_id uuid)`, `webshop_pickup_point_upsert(p_org_id uuid, p_point jsonb) RETURNS uuid` (désactivation par `is_active`, pas de suppression — les commandes y font référence).
  - Pas de RPC de suppression de secteur : désactivation seulement.

- [ ] **Step 1: Écrire l'assert** (impersonation `set_config('request.jwt.claims', …)` comme les asserts existants) :
  - membre non admin → `org_admin_required` sur chaque RPC ; `auth.uid()` NULL → refus.
  - admin d'une autre org → refus sur un secteur de Mayer.
  - `webshop_sector_set_postcodes` avec un INSEE d'un autre secteur → `postcode_taken`, table inchangée.
  - `webshop_regenerate_future_slots` : un créneau futur avec 1 commande et un créneau `closed` survivent ; un créneau `open` vide futur est recréé (compteurs cohérents).
  - recurrence invalide (`week: 5`) → `invalid_recurrence`.
  - `has_function_privilege('anon', …)` faux partout.
- [ ] **Step 2:** Harnais → échec attendu.
- [ ] **Step 3:** Écrire la migration.
- [ ] **Step 4:** Harnais vert ; appliquer en prod ; vérifier les privilèges par `has_function_privilege`.
- [ ] **Step 5: Commit** — `feat(webshop): RPC d'édition des secteurs, codes postaux, tarifs colis et points de retrait`

---

### Task 4: Écran Settings → Webshop

**Files:**
- Modify: `src/lib/modules.js` (tuile socle `{ key: 'webshop', title: 'Webshop', description: 'Livraison palette, secteurs, colis, adresses de la boutique', icon: 'ShoppingCart', href: '/settings/webshop', adminOnly: true }` + `'settings/webshop'` dans `ROUTES_PAR_MODULE.socle`)
- Modify: `src/apps/artisan/pages/Settings.jsx:35` (`ShoppingCart` dans `ICONS`)
- Modify: `src/apps/artisan/routes.jsx` (route `settings/webshop`, `RouteGuard resource="settings"`, lazy)
- Create: `src/apps/artisan/pages/settings/WebshopSettings.jsx` (gabarit `SettingsPage` avec `tabs`)
- Create: `src/apps/artisan/pages/settings/webshop/GeneralTab.jsx` (URL du site — reprend `SiteUrlSetting` — et e-mails internes)
- Create: `src/apps/artisan/pages/settings/webshop/PaletteTab.jsx` (transporteur, dépôts, règles des tournées)
- Create: `src/apps/artisan/pages/settings/webshop/SecteursTab.jsx` + `SecteurEditor.jsx` (liste, édition, récurrence en grille semaines 1-4 × lun-ven, codes postaux, bouton « Régénérer les créneaux à venir »)
- Create: `src/apps/artisan/pages/settings/webshop/ColisTab.jsx` (prestataire mode e-mail, TVA, max/ligne, grille de port, points de retrait)
- Create: `src/shared/services/webshopSettings.service.js` (lectures vues + RPC de Task 3, `{ data, error }` via `withErrorHandling`)
- Create: `src/shared/hooks/useWebshopSettings.js` (queries + mutations `unwrapResult`, keys `webshopSettingsKeys` ajoutées à `cacheKeys.js`, `all: (orgId) => ['webshopSettings', orgId]`)
- Delete: `src/apps/artisan/components/webshop/products/SiteUrlSetting.jsx` ; Modify `ProductsTab.jsx` (retirer son usage)

**Interfaces:**
- Consumes: `buildWebshopConfig`, `validerWebshopReglages`, `WEBSHOP_REGLAGES_DEFAUT` (Task 1) ; RPC Task 3 ; `useOrgSettings()` → `{ settings, save, isSaving }`.
- Produces: rien pour les autres tâches.

- [ ] **Step 1:** Ajouter tuile + route + icône ; `node --test scripts/modules.test.mjs` → PASS (le test refuse une tuile sans route).
- [ ] **Step 2:** Onglets Général / Livraison palette / Colis : chaque onglet part de `buildWebshopConfig(settings)`, `isDirty` par `JSON.stringify`, bouton Enregistrer désactivé si `!isDirty || erreurs.length || isSaving`, sauvegarde `save({ webshop: { ...cfgComplet } })` (objet `webshop` COMPLET, toutes sections). Chaque champ montre sa valeur par défaut en aide (« Par défaut : J-2 »). L'onglet palette affiche en clair : « La feuille de route part chaque jour à {heure_envoi} h (heure de Paris) vers : {emails} » ou « Envoi automatique désactivé ».
- [ ] **Step 3:** Onglet Secteurs : erreurs RPC traduites (`postcode_taken` → « Ce code postal appartient déjà au secteur {detail} », `depot_unknown`, `invalid_recurrence`, `org_admin_required`) via toast.error ; « Régénérer » passe par un `ConfirmDialog` et affiche `{ supprimes, crees }`.
- [ ] **Step 4:** `npm run lint` (aucun nouveau warning), `npm run audit:quality`, `npx vite build` → verts.
- [ ] **Step 5: Commit** — `feat(settings): tuile Webshop — livraison palette, secteurs, colis, adresses`

---

### Task 5: Majord'home lit les réglages (onglet Tournées)

**Files:**
- Modify: `src/lib/webshop/tournees.js` (supprimer `DEPOTS` / `depotFor` ; utiliser `depotParCode(cfg, code)`)
- Modify: `scripts/webshop-tournees.test.mjs`, `scripts/feuille-de-route.test.mjs` (adapter aux nouvelles signatures)
- Modify: `src/apps/artisan/components/webshop/tournees/TourneeDrawer.jsx`, `routeSheetExport.js`, `RouteSheetPDF.jsx` (dépôt et texte « partira à la fermeture (J-2, cron de 17 h) » tirés du réglage : « partira à la fermeture (J-{delai}, {heure} h) », destinataires affichés)
- Modify: `src/lib/webshop/tournees.js::CLOSE_REASONS.j_minus_2` → libellé « délai de fermeture » (la valeur stockée reste `j_minus_2`)

**Interfaces:**
- Consumes: `buildWebshopConfig`, `depotParCode` (Task 1) ; `useOrgSettings().settings`.

- [ ] **Step 1:** Adapter les tests : `itineraryUrl`/feuille de route reçoivent l'adresse de `depotParCode(cfg, 'castanet')` ; un dépôt réglé `{ code: 'castanet', adresse: '1 rue X, 31320 Castanet' }` apparaît dans l'URL.
- [ ] **Step 2:** Tests → FAIL, implémenter, tests → PASS.
- [ ] **Step 3:** `grep -rn "Castanet\|J-2\|17 h" src/apps/artisan/components/webshop src/lib/webshop` → plus aucune occurrence hors commentaires d'historique.
- [ ] **Step 4:** `npm run audit:quality` + `npx vite build` → verts.
- [ ] **Step 5: Commit** — `refactor(webshop): l'onglet Tournées lit dépôt, délai et heure d'envoi dans les réglages`

---

### Task 6: Le site lit les réglages (dépôt `C:\Dev\Landing Page - Mayer`)

**Files (site):**
- Create: `lib/boutique/reglages.js` (copie **à l'identique** de `src/lib/webshop/reglages.js`)
- Create: `lib/boutique/reglages-org.ts` — `getWebshopConfig(): Promise<WebshopConfig>` server-only : lit `core.organizations.settings` de `MAJORDHOME_ORG_ID` via le client service_role (`lib/boutique/supabase-admin.ts`), applique `buildWebshopConfig`, cache mémoire 60 s ; erreur de lecture → défauts + `console.error` (le site doit continuer à vendre).
- Modify: `lib/boutique/pricing.ts` (constantes `MAX_PARCEL_QTY`, `MAX_PALLET_SLOTS`, TVA palette/colis, `DEFAULT_PALLET_SLOT_PRICE_CENTS` → paramètre `cfg` optionnel, défaut `buildWebshopConfig(null)`), `lib/boutique/livraison/disponibilites.ts` (`DELAI_MIN_JOURS` → `cfg.palette.delai_fermeture_jours`), `lib/boutique/livraison/creneaux.ts` (ancre, horizon, capacité), `lib/boutique/livraison/feuille-de-route.ts` (`DEPOT_LABEL` → `depotParCode`), `lib/boutique/livraison/repo.ts` + `import-secteurs.ts` (replis 5500 / 10), `app/api/boutique/cron/tournees/route.ts` (destinataires = `palette.transporteur.emails` + `emails.interne` ; vides → repli `TRANSPORTEUR_EMAIL` / `BOUTIQUE_NOTIF_EMAIL` **avec une alerte** « transporteur non paramétré dans Majord'home, repli sur la variable d'env » ; dépôt = `depotParCode` du secteur ; `org_id` du body vérifié = `MAJORDHOME_ORG_ID`), `lib/boutique/webhook.ts` / route webhook (adresse interne = `emails.interne`, repli env signalé de même). Expéditeur (`FROM` en dur dans la route webhook et `cron/tournees/route.ts`) = `settings.from_email` existant (Settings → Socle → Emails) avec le nom de marque de l'org ; absent → constante actuelle, signalé dans l'alerte interne.
- Modify: `scripts/livraison.test.mjs`, `scripts/boutique.test.mjs` (passer un `cfg`).
- Create: `scripts/reglages-copie.test.mjs` — vérifie que `lib/boutique/reglages.js` est identique octet pour octet à `../Frontend-Majordhome/src/lib/webshop/reglages.js` **si ce chemin existe** (sinon `skip`), pour détecter une copie périmée en local.

**Interfaces:**
- Consumes: Task 1 (copie), Task 2 (POST du cron porte `org_id`, URL depuis `site_url`).

- [ ] **Step 1:** Tests site : `pricing` avec `cfg.palette.max_emplacements_panier = 6` plafonne à 6 ; `disponibilites` avec délai 3 exclut J+2 ; `genererCreneaux` avec capacité 12 produit `capacity_slots: 12` ; `scripts/reglages-copie.test.mjs`.
- [ ] **Step 2:** `npm run test:livraison && npm run test:boutique` → FAIL.
- [ ] **Step 3:** Implémenter ; les pages/routes serveur appellent `getWebshopConfig()` et passent `cfg` ; aucun import de `reglages-org.ts` dans un composant client.
- [ ] **Step 4:** Tests site verts ; `npm run build` du site vert ; `grep -rnE "DELAI_MIN_JOURS = |capacity_slots: 10|5500|Castanet-Tolosan'" lib app` → aucune occurrence hors `reglages.js`.
- [ ] **Step 5: Commit** (dans le dépôt du site) — `feat(boutique): réglages de livraison lus depuis Majord'home` ; push → déploiement Vercel suivi jusqu'à READY.

---

### Task 7: Bascule en production et retrait des variables d'env

**Files:** aucun (exploitation) — compte rendu dans la mémoire projet webshop.

- [ ] **Step 1:** Eric saisit dans Settings → Webshop : e-mail(s) du transporteur palette, adresse(s) interne(s), adresse réelle du dépôt Castanet. (Valeurs actuelles des variables Vercel `TRANSPORTEUR_EMAIL` / `BOUTIQUE_NOTIF_EMAIL` / `DEPOT_ADDRESS` lues via le MCP Vercel `filter_project_envs` pour les lui proposer — sans les afficher dans un fichier versionné.)
- [ ] **Step 2:** Déclencher un envoi manuel sur une tournée de test (ou attendre l'heure d'envoi) et vérifier : `SELECT status_code FROM net._http_response ORDER BY id DESC LIMIT 1` → 200 ; le corps de la réponse du site ne contient aucune alerte « repli sur la variable d'env ».
- [ ] **Step 3:** Supprimer `TRANSPORTEUR_EMAIL`, `DEPOT_ADDRESS`, `BOUTIQUE_NOTIF_EMAIL` du projet Vercel du site **seulement après** l'étape 2 réussie ; redéployer ; revérifier l'étape 2.
- [ ] **Step 4:** Mettre à jour la mémoire `project_webshop_editeur_catalogue.md` (ou une nouvelle) : réglages livrés, cron horaire, ce qui reste (étapes 2-3).
