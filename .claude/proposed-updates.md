## [2026-04-26 14:59] Séquence DB client_number — gotcha race condition
**Statut** : RESOLU
**Commit** : 58892c7829f69fc9c0ec4fa078d34be2db71f1b9
**Contexte** : Le cron `pennylane-sync-cron` calculait manuellement `client_number` via `SELECT MAX(client_number) + 1`, ce qui désynchronisait la séquence PostgreSQL `majordhome.client_number_seq`. Quand le frontend créait un client ensuite, le DEFAULT de la séquence générait un numéro déjà utilisé → duplicate key error. Fix : retirer le calcul manuel, laisser le DEFAULT DB générer atomiquement via la séquence.
**Proposition** : Ajouter un gotcha dans la section "Base de Données (Supabase)" ou "Conventions de Code" :
**Gotcha séquences PostgreSQL** : Ne JAMAIS calculer manuellement un ID/numéro via `SELECT MAX(col) + 1`. Toujours laisser le DEFAULT de la séquence DB (`nextval()`) générer la valeur automatiquement — atomique, évite race conditions et désynchronisation. Exemple : `majordhome.client_number` utilise `majordhome.client_number_seq`, toute insertion doit omettre `client_number` pour que le DEFAULT s'applique.
---

## [2026-04-26 14:59] Pattern sync Pennylane fire-and-forget
**Statut** : RESOLU
**Commit** : 58892c7829f69fc9c0ec4fa078d34be2db71f1b9
**Contexte** : `ClientModal` appelle désormais `usePennylaneSyncClient().syncClient()` après création client, en fire-and-forget (`.catch()` pour logger les erreurs silencieusement). L'UX n'est pas bloquée si l'API Pennylane est lente ou indisponible. Le code 411 Pennylane est récupéré et stocké automatiquement dans `clients.pennylane_account_number`.
**Proposition** : Documenter le pattern de synchronisation Pennylane dans une nouvelle section ou intégrer dans "Conventions de Code" :
**Sync Pennylane** : Sync automatique MDH→Pennylane après création client via `usePennylaneSyncClient` (fire-and-forget, ne bloque pas UX). Le code 411 Pennylane est récupéré et stocké dans `clients.pennylane_account_number`. Erreurs loggées silencieusement (console.warn). Cron `pennylane-sync-cron` : ne calcule JAMAIS `client_number` manuellement, laisse la séquence DB générer la valeur (évite race condition + duplicate key).
OU
Est-ce que la stratégie fire-and-forget doit s'appliquer à d'autres services (geocoding, etc.) ? Faut-il documenter un pattern général de sync externe non-bloquant ?
---

## [2026-04-27 10:20] Documentation URL Google Place ID Finder et pattern d'aide contextuelle
**Statut** : RESOLU
**Commit** : dc25013f3ff7c3db3102e37a26db82a8492b95ac
**Contexte** : Ajout d'un bouton "Trouver" avec lien externe vers la documentation Google Place ID Finder (https://developers.google.com/maps/documentation/places/web-service/place-id) dans le formulaire GeoGrid. Le tooltip rappelle de chercher le business (pas l'adresse postale). Pattern d'aide contextuelle avec icône ExternalLink.
**Proposition** : Faut-il documenter l'URL de référence Google Place ID Finder dans la section Module GeoGrid du CLAUDE.md ? Et/ou documenter le pattern UI "aide contextuelle avec lien externe + tooltip" dans les conventions de code composants ?
---

## [2026-04-27 10:57] GeoGrid : sélecteur de ville source de vérité + sync Place ID org
**Statut** : REJETE
**Commit** : 024aed6852afa8bd5771b504bd7ced1735d10e2a
**Contexte** : Refactor `ScanConfigPanel.jsx` : `selectedCityCode` est maintenant le state explicite (au lieu de `centerLat/centerLng` dans config + dérivation inverse). Les coordonnées sont calculées à partir de la ville sélectionnée au moment du submit. Élimine le risque de désynchro entre l'affichage du sélecteur et les coordonnées envoyées au scan. Ajout d'un affichage des coordonnées sous le sélecteur pour vérification visuelle. Pattern synchronisation automatique du `placeId` avec `businessName` : si le nom saisi correspond à l'org (insensible casse/espaces), le `placeId` stocké dans `organization.settings.google_place_id` est auto-rempli (badge AUTO vert). Si le nom ne correspond plus, le `placeId` est vidé pour permettre saisie manuelle.
**Décision** : Rejeté — info déjà couverte dans la section GeoGrid de CLAUDE.md (`google_place_id` dans `core.organizations.settings`). Pattern UI trop spécifique pour une convention générale.
---

## [2026-04-27 12:42] Master prompt SEO audit site web Mayer
**Statut** : REJETE
**Commit** : d1a47f4d248594a9b8087bac2c52215ec93a41b4
**Contexte** : Création du fichier `docs/SEO_AUDIT_MASTER_PROMPT.md` (293 lignes) — prompt complet pour session Claude dédiée à l'audit SEO et stratégie de contenus du site mayer-energie.fr (repo séparé `C:\Dev\Landing Page - Mayer`).
**Décision** : Rejeté — déjà mentionné dans la section "Module GeoGrid Rank Tracker" → "Master prompt SEO (session séparée)" de CLAUDE.md.
---

## [2026-04-27 12:42] Loop frontend séquentiel pour benchmarks vs edge function batch
**Statut** : REJETE
**Commit** : d1a47f4d248594a9b8087bac2c52215ec93a41b4
**Contexte** : `BenchmarkLauncher.jsx` implémente un loop frontend qui lance 1 scan à la fois en séquentiel. Alternative architecturale possible : modifier l'edge function pour accepter un array de keywords et gérer le loop côté backend.
**Décision** : Rejeté — décision visible dans le code et commits. Pas critique de la formaliser tant qu'elle n'est pas remise en cause.
---

## [2026-04-27 12:42] Pattern auto-tag famille keywords par regex
**Statut** : REJETE
**Commit** : d1a47f4d248594a9b8087bac2c52215ec93a41b4
**Contexte** : `BenchmarkResultTable.jsx` définit une fonction `detectFamily(keyword)` qui matche par regex (Poêle / Ramonage / Clim / PAC / Chauffage / Entretien). Si un nouveau métier Mayer arrive (ex: ventilation, VMC), il faudra étendre le pattern.
**Décision** : Rejeté — déjà mentionné en 1 ligne dans la section GeoGrid de CLAUDE.md. Extraction en module séparé à reconsidérer si nouveaux métiers ajoutés.
---

## [2026-04-27 13:10] Vérification explicite erreur UPDATE benchmark_id (anti silent failure)
**Statut** : RESOLU
**Commit** : 567557f518f3ac359cef5f39bdd8831e92f46d0f
**Contexte** : `BenchmarkLauncher.jsx` ajoutait un lien `benchmark_id` sur le scan créé via un `UPDATE` Supabase, mais sans vérifier l'erreur retournée. Un trigger fantôme (`set_geogrid_scans_updated_at`) tentait de set une colonne `updated_at` inexistante → UPDATE échouait silencieusement.
**Décision** : Intégré dans CLAUDE.md section Gotchas DB (validé par utilisateur 2026-04-27).
---

## [2026-04-27 13:37] UI benchmarks : cards famille cliquables + filtre actif tableau
**Statut** : REJETE
**Commit** : b2da534a15221bda55d320db8199b2c76fcb71ee
**Contexte** : `BenchmarkResultTable.jsx` — les 6-7 cards famille sont maintenant cliquables pour filtrer le tableau sur une famille uniquement. Click sur card = toggle. Card sélectionnée : ring + shadow ; non sélectionnées : opacity 40%.
**Décision** : Rejeté — UX validée par utilisateur, pas de gotcha technique à documenter.
---

## [2026-04-27 23:50] Module Search Console (4ème onglet GeoGrid)
**Statut** : RESOLU
**Commit** : (à venir)
**Décision** : Intégré 2026-05-01 — option (b) : résumé court inline dans CLAUDE.md (section Module Search Console après GeoGrid) + détails complets dans nouveau `docs/MODULE_SEARCH_CONSOLE.md` + gotcha PostgREST `majordhome` ajouté à Gotchas DB (utile bien au-delà de GSC).
**Contexte** : Ajout d'un 4ème onglet "Search Console" dans GeoGrid Rank Tracker, complémentaire aux onglets Maps. Pipeline OAuth Google + sync API Search Analytics → table `majordhome.gsc_keyword_metrics`. 3 edge functions (`gsc-oauth-init`, `gsc-oauth-callback`, `gsc-sync`) + RPC `public.gsc_upsert_metrics` + composant `GscPanel.jsx`. Refresh_token stocké dans `core.organizations.settings.gsc_refresh_token`. UI affiche KPIs (impressions/clics/CTR/position) + tableau agrégé par requête + filtre famille + croisement avec liste "Mayer SEO 2026". Premier test 2026-04-27 : 370 lignes / 43 requêtes uniques sur 12 mois pour mayer-energie.fr.

**Gotcha technique majeur** : `supabase-js` côté edge function ne peut PAS écrire directement dans `majordhome.*` via `.schema('majordhome')` — PostgREST renvoie "Invalid schema: majordhome". Pattern projet : passer par une RPC SECURITY DEFINER (cf. gotcha N8N → Supabase déjà documenté). En revanche `.schema('core')` fonctionne (le schema core est exposé). Asymétrie à connaître.

**Proposition** : Ajouter une section après "Module GeoGrid Rank Tracker" dans CLAUDE.md :

```markdown
## Module Search Console (Google Search Console)

2ème thermomètre SEO complémentaire à GeoGrid (Maps). Affiche les positions, impressions et clics du site web (mayer-energie.fr) dans Google Search.

### Stack
- **OAuth Google** : refresh_token stocké dans `core.organizations.settings.gsc_refresh_token` + `gsc_site_url` (`sc-domain:mayer-energie.fr`)
- **API GSC** : `searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` (dimensions: query/date/page, rowLimit 25k, paginé jusqu'à 200k)
- **Projet GCP** : `Mayer Energie Automation` (compte gmail.com, OAuth Client + Search Console API activée). Secrets `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `FRONTEND_ORIGINS` dans Supabase Edge Functions

### Edge functions (`supabase/functions/`)
- `gsc-oauth-init` (verify_jwt: true) — valide membership user/org, retourne URL OAuth Google avec state encodé `base64({ orgId, returnTo })`
- `gsc-oauth-callback` (verify_jwt: false) — échange `code` → `refresh_token`, liste les sites GSC (priorité `sc-domain:mayer-energie.fr`), stocke dans settings, redirige vers `${returnTo}/geogrid?gsc=connected`
- `gsc-sync` (verify_jwt: true) — refresh access_token, paginate Search Analytics, UPSERT batch via RPC

### DB
- `majordhome.gsc_keyword_metrics` (org_id, site_url, date, query, page, impressions, clicks, ctr, avg_position) + UNIQUE (org_id, site_url, date, query, page) + RLS via `core.organization_members`
- Vues publiques `majordhome_gsc_keyword_metrics` + `_write`
- RPC `public.gsc_upsert_metrics(p_rows jsonb) RETURNS integer` (SECURITY DEFINER, search_path = majordhome) — UPSERT batch idempotent. Le schema `majordhome` n'est pas exposé directement par PostgREST, on passe par cette RPC pour les écritures depuis edge function.

### Frontend
- `gsc.service.js` — getAuthUrl, triggerSync, getMetrics, getStatus, disconnect
- `useGsc.js` — useGscStatus, useGscMetrics, useGscConnect, useGscSync, useGscDisconnect (+ `gscKeys` dans cacheKeys.js)
- `GscPanel.jsx` (`src/apps/artisan/components/geogrid/`) — états non-connecté (CTA OAuth) + connecté (header + sélecteur période 7j/30j/3m/12m + filtre famille + toggle "Liste Mayer SEO 2026 uniquement" + 5 KPIs + tableau agrégé par requête avec étoile pour les keywords de la liste curée)
- 4ème onglet "Search Console" dans `GeoGrid.jsx` avec auto-sélection au retour OAuth (`?gsc=connected`)

### Sync initiale
Au retour OAuth, `useEffect` détecte `?gsc=connected` et déclenche automatiquement `triggerSync({ monthsBack: 16 })`. Bouton "Sync 16 mois" disponible aussi pour re-import manuel.

### Gotcha — schema `majordhome` non exposé via PostgREST
Le client supabase-js ne peut pas écrire dans `majordhome.*` via `.schema('majordhome').from(...)` — PostgREST renvoie "Invalid schema: majordhome". Pattern : créer une RPC SECURITY DEFINER dans `public` avec `SET search_path = majordhome, public` qui fait l'opération. Le schema `core` est en revanche bien exposé (les `.schema('core')` fonctionnent). Pattern déjà utilisé pour les écritures N8N → Supabase.
```

OU question ouverte : la doc CLAUDE.md grossit beaucoup avec ce module (~50 lignes). Faut-il :
- (a) tout inline dans CLAUDE.md (risque saturation)
- (b) un résumé court inline + détails dans `docs/MODULE_SEARCH_CONSOLE.md`
- (c) résumé court inline + détails déjà dans `docs/GSC_INTEGRATION_MASTER_PROMPT.md`
---

## [2026-05-20 12:31] Audit pré-onboarding multi-tenant + Semaine 0 hardening DB
**Statut** : RESOLU
**Commit** : a53d2bf8f6f6229e99df5c6c251722225b087d78
**Décision** : Intégré 2026-05-21 — les 6 propositions appliquées à CLAUDE.md :
- #1 bannière "⚠️ Consolidation multi-tenant en cours" en tête + référence audit
- #2 Dernière MàJ pointe sur l'audit du 2026-05-20
- #3 nouvelle section "Multi-tenant & sécurité" avec les 5 bombes + statut + règles imposées
- #4 ligne "Sem 0" 🔧 EN COURS dans tableau Plan Dev + Sprints 8-10 marqués ⏸ EN PAUSE
- #5 gotcha vues `majordhome_*` en mode "historique fixé" (P0.0.2 ✅ 2026-05-20)
- #6 gotcha `exec_sql` en mode "historique fixé" (P0.0.1 ✅ 2026-05-20)
**Contexte** : Ajout de `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md` (936 lignes) — audit complet en vue de l'arrivée d'une 2ème entreprise sur la même instance Supabase. 91 findings codebase (13 CRITICAL) + 725 findings Supabase Advisor (131 ERROR). 5 bombes structurelles DB identifiées (exec_sql ouvert authenticated, 112 vues SECURITY DEFINER, 24 RPCs anon, storage contracts/certificats ALL, 19 tables sans RLS). Plan révisé : Semaine 0 hardening DB (~12 j-h) ajoutée avant les 4 semaines codebase. Total pré-onboarding : 5-6 semaines. La roadmap fonctionnelle est en pause durant la consolidation.
**Proposition** : Plusieurs ajouts possibles à arbitrer :
1. Ajouter en tête de CLAUDE.md une bannière "⚠️ Consolidation multi-tenant en cours — voir `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`. Roadmap (Sprint 8-10) en pause jusqu'à la fin du hardening."
2. Mettre à jour la "Dernière MàJ" pour pointer vers l'audit.
3. Ajouter une section "Multi-tenant & sécurité" qui rappelle les 5 bombes structurelles (exec_sql, vues SECURITY DEFINER, RPCs anon, storage ALL, tables sans RLS) avec leur fix one-liner — pour éviter qu'une session future les recrée ou les ignore.
4. Mettre à jour le tableau "Plan de Développement" en bas : ajouter ligne "Sem 0 — Hardening DB pré-onboarding" en statut "🔧 EN COURS" avant les sprints 8-10.
5. Documenter dans une note Gotcha DB que **les vues `public.majordhome_*` sont en SECURITY DEFINER par défaut** (RLS bypassée) — donc le filtre `.eq('org_id', orgId)` côté frontend est aujourd'hui la SEULE défense effective. À retirer une fois `security_invoker=true` appliqué (cf. P0.0.2 de l'audit).
6. Documenter le grant dangereux `public.exec_sql` exécutable par `authenticated` jusqu'à fix P0.0.1 — toute session future qui rajouterait des appels à cette fonction depuis le frontend doit être bloquée.
---

## [2026-05-21 09:36] P0.0.7 storage — N8N contract PDF upload à migrer + statut hardening
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 1b1afb7ef4994813165cfc126b4c43d8fc2d2735
**Contexte** : Migration DB de P0.0.7 appliquée prod (110 fichiers + 11 refs DB préfixés par Mayer org_id ; DROP 7 policies ouvertes + CREATE 12 policies strictes filtrant `(storage.foldername(name))[1]::uuid IN org_members` sur `contracts` / `certificats` / `product-documents`). Côté frontend, `certificats.service.js:uploadPdf` exige désormais `orgId` (path `${orgId}/${clientId}/${year}/${certificatId}.pdf`), propagé via `useCertificats` + `CertificatWizard`. `product-documents` était déjà conforme. **Reste à faire (hors codebase) : workflow N8N Mayer qui upload les PDF de contrats doit utiliser le nouveau préfixe `${orgId}/`, sinon les nouveaux uploads contracts seront refusés par la storage policy stricte.**
**Proposition** : Plusieurs choses à arbitrer :
1. Mettre à jour la ligne #5 du tableau "5 bombes structurelles" dans CLAUDE.md → passer P0.0.7 de "🔧 EN COURS" à "🔧 EN COURS (DB ✅ / N8N contract upload à migrer)" ou "✅ Fait" une fois N8N corrigé.
2. Ajouter une note dans la section "Multi-tenant & sécurité" / règles imposées : "Tout code qui upload dans `contracts` / `certificats` / `product-documents` doit utiliser un path `${orgId}/...` (sinon refusé par RLS)" — déjà couvert par la règle générale "Tout nouveau bucket Storage doit utiliser `${orgId}/...`", à voir si on rajoute mention explicite des buckets existants.
3. Tracker quelque part (ici ou dans une note dédiée) l'action N8N : workflow contract upload à modifier — sinon prochain envoi de devis signé Pennylane → upload bucket `contracts` → 403 silencieux côté N8N.
4. La signature de `certificats.service.js:uploadPdf` est maintenant `(orgId, clientId, certificatId, pdfBlob)` (positionnel) côté service mais `({orgId, clientId, certificatId, pdfBlob})` (objet) côté hook — asymétrie volontaire ou à harmoniser ?
---


## [2026-05-21 09:36] Pattern cache keys paramétré par orgId (défense cross-org via cache RQ)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 9075beba31dc5ba788dcb16c359bd490bccd1b5f
**Contexte** : `pricingKeys` est passé de keys statiques (`['pricing', 'zones']`) à une factory paramétrée par orgId (`all: (orgId) => ['pricing', orgId]`). Motivation : éviter qu'au changement d'organisation (multi-tenant), React Query retourne le cache de l'ancienne org en attendant le refetch. C'est la seule famille de keys qui adopte ce pattern pour l'instant. Tous les hooks pricing passent maintenant `useAuth().organization.id` aux keys.
**Proposition** :
A) Documenter le pattern dans la section "Hooks" sous "Cache keys centralisées" :
   - Pour les domaines avec données scopées org, préfixer les keys par orgId (`keysName.all(orgId) => [domain, orgId]`) pour éviter les fuites cross-org via le cache React Query au changement d'organisation. Premier domaine adoptant le pattern : `pricingKeys`. Les autres familles (`clientKeys`, `contractKeys`, etc.) restent statiques car le `staleTime` court et le filtre `.eq('org_id')` explicite suffisent pour l'instant.
B) Généraliser le pattern aux autres familles maintenant que la 2e entreprise approche ? Décision à prendre dans le cadre du hardening Sem 0.
---

## [2026-05-21 09:36] Settings → Tarification : nouvelle UI CRUD grille tarifaire per-org
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 9075beba31dc5ba788dcb16c359bd490bccd1b5f
**Contexte** : Nouvelle page `src/apps/artisan/pages/settings/PricingSettings.jsx` (957 LOC) sur la route `/settings/pricing` (org_admin only), avec 5 onglets : Zones / Types d'équipement / Tarifs (matrice) / Remises volume / Options. Nouveau hook `usePricingAdmin` (queries non-filtrées par `is_active` + 13 mutations CRUD scopées sur `useAuth().organization.id`). Service `pricing.service.js` reçoit 13 nouvelles méthodes CRUD (`createZone`/`updateZone`/`deleteZone`, idem pour equipmentType/extra/discount + `upsertRate`/`deleteRate`) via `.schema('majordhome')`. Lectures existantes acceptent maintenant un `orgId` optionnel pour la défense en profondeur (en plus du filtre RLS via `security_invoker`). Migration DB déjà appliquée : ajout `org_id NOT NULL + FK core.organizations` sur les 5 tables `majordhome.pricing_*`, UNIQUE constraints converties en composites `(org_id, code)` / `(org_id, zone_id, equipment_type_id)` / `(org_id, min_equipments)`, drop policies `USING(true)` + 20 nouvelles policies RLS filtrées `org_id IN (org_members)`, 5 vues publiques recréées en `security_invoker=true`. Table `monthly_source_costs` droppée (jamais utilisée). Backfill Mayer 100% (3 zones, 14 types, 36 rates, 2 discounts, 2 extras).
**Proposition** : Ajouter un nouveau module "Module Tarification" au CLAUDE.md (après Module Certificats) :
### Module Tarification (Settings → Tarification)
- **Page** : `src/apps/artisan/pages/settings/PricingSettings.jsx` sur `/settings/pricing` (org_admin only, icône Calculator) — 5 onglets : Zones / Types / Tarifs (matrice zone × type) / Remises / Options
- **Hook admin** : `usePricingAdmin()` dans `src/shared/hooks/usePricing.js` — expose `{zones, equipmentTypes, rates, discounts, extras}` (incluant inactifs) + 13 mutations CRUD scopées automatiquement sur `useAuth().organization.id`
- **Hook prod** : `usePricingData()` (existant) — filtre `is_active=true` pour les formulaires contrat
- **Service** : `pricing.service.js` — lectures via vues publiques `majordhome_pricing_*` (RLS via `security_invoker`), écritures via `.schema('majordhome')` (CRUD UI)
- **Tables `majordhome.pricing_*`** : `pricing_zones`, `pricing_equipment_types`, `pricing_rates`, `pricing_discounts`, `pricing_extras` — toutes avec `org_id NOT NULL` + FK + RLS `org_id IN (org_members)` + UNIQUE composites `(org_id, …)`
- **`upsertRate`** utilise `onConflict: 'org_id,zone_id,equipment_type_id'` (composite UNIQUE)
- **Table `monthly_source_costs`** : droppée dans cette migration (jamais utilisée)
---

## [2026-05-21 10:13] Edge function `contract-signed-notify` (transactionnel email + org settings multi-tenant)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 25fb8241e01fd84c40608f74b4d3fdfb71ad92b4
**Contexte** : Migration de l'envoi d'email "contrat signé" depuis le workflow N8N "Mayer - Entretien Contrat" vers une nouvelle edge function Supabase `contract-signed-notify` (`verify_jwt: true`). Le frontend appelle `supabase.functions.invoke('contract-signed-notify', { body: { contract_id } })` ; l'edge function charge contract + org settings + template depuis la DB, télécharge le PDF depuis storage, envoie via Resend avec PDF en pièce jointe et log dans `mailing_logs`. RLS valide la membership org sur tous les SELECT (verify_jwt:true). Ancien code N8N renommé `_legacyTriggerContractPdfN8n` dans `entretiens.service.js` pour rollback rapide. Workflow N8N "Mayer - Entretien Contrat" reste actif en backup 24-48h puis à désactiver.

Cette migration introduit 2 patterns nouveaux non documentés :
1. **Template transactionnel stocké dans `majordhome.mail_campaigns`** (key=`contrat_signature_confirm`) à côté des templates marketing (`mail_a-g`, `lead_bienvenue`). Placeholders `{{CLIENT_NAME}}`, `{{BRAND_NAME}}`, `{{ORG_EMAIL}}`, `{{ORG_PHONE}}`, `{{ORG_ADDRESS}}`, `{{ORG_POSTAL_CODE}}`, `{{ORG_CITY}}`, `{{ACCENT_COLOR}}`. Éditable via l'onglet Mailing > Éditeur.
2. **Org settings de branding** dans `core.organizations.settings` (keys : `brand_name`, `from_email`, `from_name`, `reply_to`, `phone`, `address`, `postal_code`, `city`, `accent_color`) — lus par l'edge function pour personnaliser l'expéditeur, le contenu et l'apparence par org. Premier usage multi-tenant de ces settings au-delà de `google_place_id` / `gsc_refresh_token` / `gsc_site_url` déjà documentés.

**Proposition** :
1. Ajouter dans Module Mailing (liste des edge functions) une ligne :
   - **Edge function `contract-signed-notify`** (`supabase/functions/contract-signed-notify/index.ts`, verify_jwt: true) — envoi transactionnel "contrat signé" multi-tenant : charge contract + org settings + template depuis DB, télécharge PDF, envoie via Resend avec PDF en attachement, log dans `mailing_logs`. Remplace l'ancien workflow N8N "Mayer - Entretien Contrat" (2026-05-21).
2. Documenter le template `contrat_signature_confirm` quelque part — soit dans le tableau templates (mais c'est transactionnel pas marketing, à séparer ?) soit dans une nouvelle sous-section "Templates transactionnels".
3. Documenter les nouvelles clés de `core.organizations.settings` (branding) — créer une sous-section "Org settings" dans la section "Multi-tenant & sécurité" listant les clés connues (`brand_name`, `from_email`, `phone`, `address`, `accent_color`, `google_place_id`, `gsc_refresh_token`, `gsc_site_url`) pour que les futures sessions sachent où piocher quand elles veulent personnaliser un comportement par org.
4. Documenter le pattern général "transactionnel branded" pour les prochaines migrations N8N → edge function (devis, rappel intervention, etc.) : verify_jwt:true + RLS pour la membership + settings org pour le branding + template DB éditable + Resend + log mailing_logs. Ou laisser ce pattern émerger naturellement.
5. Action externe à tracker : workflow N8N "Mayer - Entretien Contrat" à désactiver après validation prod 24-48h (sinon double envoi possible si quelqu'un déclenche encore le webhook).
---

## [2026-05-21 10:20] Template `proposition_contrat` (3ème campagne pilotée par mail_campaigns + placeholders custom)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : cb3dbe8e4c52c5a78f2f26b0d32d72a688e05714
**Contexte** : Le HTML hardcodé `buildProposalEmailHtml()` dans `ContractPdfSection.jsx` (~70 LOC inline) a été supprimé. Le template est désormais chargé depuis `majordhome.mail_campaigns` (key=`proposition_contrat`) via `mailCampaignsService.getByKey(orgId, 'proposition_contrat')`. Placeholders custom supportés (replaceAll côté frontend) : `{{EQUIP_RECAP}}`, `{{TOTAL_AMOUNT}}`, `{{PDF_URL}}`. Le subject est aussi lu depuis le template (fallback hardcodé si vide). Éditable via l'onglet Mailing > Éditeur. C'est la 3ème campagne "transactionnelle" pilotée par template DB :
1. `contrat_signature_confirm` (edge function `contract-signed-notify`) — placeholders `{{CLIENT_NAME}}`, `{{BRAND_NAME}}`, `{{ORG_*}}`, `{{ACCENT_COLOR}}`
2. `proposition_contrat` (frontend `ContractPdfSection`) — placeholders `{{EQUIP_RECAP}}`, `{{TOTAL_AMOUNT}}`, `{{PDF_URL}}`
3. `lead_bienvenue` + `mail_a-g` (workflow N8N "Mayer - Mailing") — placeholder `{{SALUTATION}}` remplacé par N8N

Chacun a son propre mécanisme de remplacement (3 endroits dans le code) et son propre jeu de placeholders.

**Proposition** :
1. Documenter le pattern "campagne transactionnelle pilotée par template DB" comme catégorie à part dans Module Mailing — créer une sous-section "Templates transactionnels" listant les 2 campagnes actuelles (`contrat_signature_confirm` côté edge function, `proposition_contrat` côté frontend) avec leurs placeholders custom respectifs. Distincte des templates marketing `mail_a-g` (qui n'utilisent que `{{SALUTATION}}` remplacé par N8N).
2. Lister explicitement les placeholders custom supportés par campagne (ex: tableau Campaign / Placeholders / Lieu de remplacement) pour que les futures sessions sachent ce qui est éditable sans casser le rendu.
3. Question d'archi : faut-il centraliser le remplacement de placeholders dans un helper partagé (ex: `mailCampaignsService.renderTemplate(orgId, key, vars)`) pour éviter que 3 endroits différents implémentent leur propre `replaceAll` ? Aujourd'hui : N8N node, edge function `contract-signed-notify` et frontend `ContractPdfSection` font chacun leur substitution. Sinon, le risque est qu'à la 4ème campagne transactionnelle on ait un 4ème mécanisme légèrement différent.
4. Hotfix storage `${orgId}/` sur les 2 uploads `contracts` dans `ContractPdfSection` (handleUploadSigned + handleSendProposal) : déjà couvert par la règle P0.0.7 / "Tout nouveau bucket Storage doit utiliser `${orgId}/...`" dans la section Multi-tenant. Pas de doc supplémentaire nécessaire — c'est l'application directe de la règle. La ligne #5 du tableau "5 bombes" (statut P0.0.7) peut basculer en ✅ une fois le workflow N8N côté Pennylane aussi migré (cf. PENDING précédent).
---


## [2026-05-21 10:45] Sem 3 — Branding multi-tenant (P0.13 → P0.20)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : ea319a2f5c6b58260d7e3560d19e74de603ce73e
**Contexte** : Couche complète de branding multi-tenant pour l'onboarding 2ème entreprise. Toute valeur Mayer hardcodée a un fallback dans le code mais peut être surchargée via `core.organizations.settings`.

Nouveaux champs settings (P0.13) : `legal_name`, `legal_form`, `capital`, `rcs`, `siret`, `tva_intra`, `domain`, `website_url`, `portal_url`, `unsubscribe_landing_url`, `insurance`, `rge_certifications`, `geogrid_default_city`, `map_default_center`, `territoire_centers`, `mailing_resources`, `brand_name`, `logo_url`, `accent_color`, `from_email`, `from_name`, `phone`, `city`, `postal_code`, `address`. Migration `p0_13_org_settings_full_branding` déjà appliquée. Backfill complet pour Mayer.

Patterns introduits :
- **PDFs paramétrés** : `generateContractPdfBlob(data, company)`, `generatePvReceptionPdfBlob(data, company)`, `generateDevisPdfBlob(data, company)`, `generatePdfBlob(data, company)` (Certificat). Le caller construit `company` via `buildCompanyInfo(organization?.settings)`.
- **Edge functions multi-tenant** : `invite-client` et `mailing-unsubscribe` chargent `core.organizations.settings` au runtime (via SELECT sur `core.organizations` filtré par `client.org_id` ou `lead.org_id`). Aucune valeur Mayer hardcodée dans le HTML email ou la redirection.
- **Helpers config** : `getMapDefaultCenter(settings)` (mapbox.js), `getTerritoireCenters(settings)` (territoire-config.js), `getResources(settings)` (mailing/resources.js).
- **CampaignWizard** : `buildPrompt(form, company, resourcesCatalog)` — le prompt système IA ne contient plus de valeurs Mayer hardcodées (nom, téléphone, adresse, certifications RGE, URL site). Tout vient des settings.

**Proposition** : Plusieurs ajouts possibles au CLAUDE.md — à arbitrer :

1. **Section dédiée "Branding multi-tenant"** (probablement entre "Multi-tenant & sécurité" et "Stack") qui documente le helper `buildCompanyInfo`, la liste des champs `settings`, et la convention "tout nouveau composant qui affiche du branding entreprise (PDF, email, page publique) DOIT consommer `buildCompanyInfo(organization?.settings)` plutôt que hardcoder Mayer".

2. **Règle additionnelle dans la liste "Règles imposées par le multi-tenant"** : "Toute nouvelle valeur de branding (nom, adresse, URL, certification) DOIT passer par `core.organizations.settings` + helper `buildCompanyInfo` plutôt que d'être hardcodée. Fallback Mayer accepté uniquement comme valeur par défaut dans le helper."

3. **Note dans la section "Module Mailing"** : préciser que `CampaignWizard.buildPrompt()` injecte maintenant les coordonnées et certifications RGE depuis les settings org, et que la caisse à outils `resources.js` peut être surchargée via `settings.mailing_resources` (JSONB) par org.

4. **Note de déploiement** : les 2 edge functions `invite-client` et `mailing-unsubscribe` ont été modifiées et doivent être redéployées (`supabase functions deploy invite-client` + `supabase functions deploy mailing-unsubscribe`). Ce type de note transitoire a-t-il sa place dans CLAUDE.md ou seulement dans le message de commit ?

5. **Dette technique signalée dans le diff** : `zoneDetection.js` continue d'utiliser le default Mayer en dur (à refactor quand la 2ème org arrivera). Faut-il l'ajouter à une liste "dette résiduelle multi-tenant" pour ne pas l'oublier ?
---

## [2026-05-21 10:54] P0.8 — Compilation SQL mailing côté serveur (RPCs membership-checked) + `is_transactional` + résiduel N8n
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 58ad51312e7b4a8424c6ac10d1172fe1195b2538
**Contexte** : Étape supplémentaire du hardening Sem 0 (non listée dans les 5 bombes originelles de l'audit). Le frontend ne construit plus de SQL en clair pour le mailing : il appelle 2 nouvelles RPCs SECURITY DEFINER qui compilent le SQL côté serveur après vérification `auth.uid() ∈ org_members` :
1. `public.mail_segment_compile_safe(p_segment_id uuid, p_campaign_name text) RETURNS text` — recharge filters depuis `mail_segments` puis délègue à `mail_segment_compile`.
2. `public.mail_single_client_sql(p_client_id uuid, p_campaign_name text) RETURNS text` — construit le SQL pour 1 destinataire avec check membership.
Les 2 ont `REVOKE EXECUTE FROM anon` + `GRANT authenticated + service_role`.

Changements frontend :
- `ContractPdfSection.jsx:handleSendProposal` : remplace le SQL inline `SELECT ... WHERE id = '${clientId}'` par un appel à `supabase.rpc('mail_single_client_sql', ...)`. Le payload N8n inclut désormais aussi `client_id` (pour la future bascule).
- `SendTab.jsx:buildPayload` : utilise déjà `mailSegmentsService.compileSql()` (RPC `mail_segment_compile`), ajoute `segment_id` au payload pour la future bascule. Filtre maintenant les campagnes `is_transactional=true` de la liste de broadcast (les transactionnelles `contrat_signature_confirm` / `proposition_contrat` ne doivent pas être envoyables en masse depuis l'onglet Envoi).
- `SendTab.jsx` ajoute `sandbox="allow-same-origin"` sur l'iframe de prévisualisation HTML (durcissement preview).

**⚠️ Résiduel — P0.8 V2** : le webhook N8n public "Mayer - Mailing" accepte encore `segment_sql` brut. Un attaquant qui connaît l'URL du webhook peut forger un payload arbitraire avec n'importe quel SQL (donc bypasser le check membership). Les RPCs côté DB sont prêtes : il reste à modifier le workflow N8n pour n'accepter que `segment_id` (broadcast) ou `client_id` (transactionnel) et appeler les RPCs `mail_segment_compile_safe` / `mail_single_client_sql` côté serveur. Tant que ce n'est pas fait, le frontend est durci mais le webhook reste vulnérable.

Nouvelle colonne DB introduite (probablement par migration antérieure, mais référencée pour la 1ère fois côté code ici) : `majordhome.mail_campaigns.is_transactional BOOLEAN` — distingue les campagnes broadcast-ables (mail_a-g, lead_bienvenue…) des transactionnelles déclenchées 1-à-1 (contrat_signature_confirm, proposition_contrat).

**Proposition** : plusieurs ajouts possibles à CLAUDE.md, à arbitrer :

1. **Ajouter une 6ème ligne au tableau "5 bombes structurelles"** (renommer en "6 bombes" ou "bombes structurelles & défense en profondeur") :

   | 6 | Construction SQL mailing côté frontend → un user mal intentionné peut forger un `segment_sql` pour exfiltrer une autre org via le webhook N8n public | RPCs `mail_segment_compile_safe` + `mail_single_client_sql` avec check `auth.uid() ∈ org_members` (P0.8 frontend) + workflow N8n à modifier pour rejeter `segment_sql` brut (P0.8 V2) | 🔧 EN COURS (frontend ✅ / N8n workflow à migrer) |

   Cohérent avec le pattern P0.0.7 qui distingue "DB ✅ / N8N à migrer".

2. **Ajouter dans Module Mailing > RPCs** les 2 nouvelles entrées :
   - `public.mail_segment_compile_safe(segment_id, campaign_name) RETURNS text` — recharge filters depuis `mail_segments` + délègue à `mail_segment_compile`, check membership. Pour la future bascule du webhook N8n broadcast.
   - `public.mail_single_client_sql(client_id, campaign_name) RETURNS text` — SQL pour 1 destinataire, check membership. Pour la future bascule du webhook N8n transactionnel.

3. **Documenter la colonne `is_transactional`** :
   - Dans la définition de `mail_campaigns` (section Tables) : ajouter `is_transactional` au listing des colonnes.
   - Dans la section "Templates campagnes" ou "Templates transactionnels" (cf. PENDING précédent du 2026-05-21 10:20) : préciser que les templates transactionnels ont `is_transactional=true` et sont exclus de l'onglet Envoi.

4. **Note résiduelle webhook N8n** dans la section Module Mailing > "Workflow N8n : Mayer - Mailing" : ajouter un avertissement explicite "⚠️ Le workflow accepte encore `segment_sql` brut côté webhook public — un attaquant connaissant l'URL peut exfiltrer une autre org. À durcir en P0.8 V2 : n'accepter que `segment_id`/`client_id` et appeler les RPCs `mail_segment_compile_safe`/`mail_single_client_sql`." Sinon le risque s'oublie.

5. **Règle additionnelle dans "Multi-tenant & sécurité"** : "Ne JAMAIS construire de SQL dynamique côté frontend pour le mailing (ou tout autre flux multi-tenant). Toujours passer par une RPC SECURITY DEFINER qui vérifie `auth.uid() ∈ org_members` avant de compiler le SQL." Pattern à étendre si d'autres modules construisent du SQL inline (à auditer).
---


## [2026-05-21 18:00] P0.3 pennylane-proxy hardening (membership + allowlist)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : (à venir)
**Contexte** : Avant cette session, l'edge `pennylane-proxy` vérifiait juste le JWT — n'importe quel user authentifié pouvait piloter le Pennylane Mayer (lecture factures, création devis, DELETE arbitraire). Critique avant l'arrivée de la 2ème entreprise. La fonction `findPennylaneEnabledOrg` lit maintenant les orgs du user dans `core.organization_members` JOIN `core.organizations.settings`, et exige `settings.pennylane.enabled=true` (sinon 403). Allowlist paths : `/customers`, `/customer_invoices`, `/quotes`, `/ledger_accounts`. Allowlist méthodes par path (GET partout, POST sur /customers et /quotes, PUT sur /quotes seulement). DELETE et PATCH bloqués partout. Mayer settings backfillé avec `pennylane: { enabled: true }`.
**Proposition** : Ajouter dans la section "Multi-tenant & sécurité" ou "Conventions de Code" :
**Settings org : intégrations conditionnelles** — `core.organizations.settings.pennylane = { enabled: bool }` est le flag qui décide si une org peut piloter l'API Pennylane via `pennylane-proxy`. Quand une 2ème org arrive sans Pennylane, elle est rejetée 403 par le proxy. Si elle obtient son propre compte Pennylane plus tard → ajouter `{ enabled: true }` + considérer un token Pennylane par org (vault Supabase, aujourd'hui 1 seul `PENNYLANE_API_TOKEN` env var). L'edge `pennylane-proxy` v33 fait : check membership + check settings.pennylane.enabled + allowlist paths (`/customers`, `/customer_invoices`, `/quotes`, `/ledger_accounts`) + allowlist méthodes par path + DELETE/PATCH bloqués partout. Pattern à reprendre pour toute future intégration tierce (ex: settings.gsc, settings.meta_ads...).
---

## [2026-05-21 18:00] P0.8 V2 — migration mailing N8n → edge function (changement archi majeur)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : (à venir)
**Contexte** : Le webhook N8n public `Mayer - Mailing` (id `1COgLUuiMtSq2sUq`) acceptait `segment_sql` brut du client — un attaquant qui connaissait l'URL pouvait forger un payload arbitraire et envoyer des mails à n'importe quel destinataire. Migration vers une edge function Supabase `mailing-send` qui n'accepte que `segment_id` ou `client_id` (mode bulk vs single), avec compile+exec côté DB via RPC SECURITY DEFINER `mail_fetch_recipients(segment_id?, client_id?)` qui inclut check membership multi-tenant. Le SQL n'est jamais accepté du client.
Frontend migré (SendTab + ContractPdfSection → `supabase.functions.invoke('mailing-send')`). Scheduler N8n `Mayer - Scheduler Campagnes Auto` (id `KESlI0Hpz0rijmT2`) updaté pour appeler la nouvelle edge avec service_role. Workflow `Mayer - Mailing` archivé. Build OK.
**Proposition** : Refonte importante de la section "Module Mailing" du CLAUDE.md (architecture, workflow N8n principal disparu) :
1. Remplacer toutes les références au "workflow N8n Mayer - Mailing" et "webhook mayer-mailing" par "edge function mailing-send".
2. Documenter la nouvelle API edge `mailing-send` (mode bulk/single, body, auth JWT/service_role).
3. Documenter la RPC `mail_fetch_recipients(segment_id?, client_id?, campaign_name?)` qui remplace l'usage direct de `mail_segment_compile_safe` + `mail_single_client_sql` depuis le frontend.
4. Garder référence au scheduler N8n `Mayer - Scheduler Campagnes Auto` (qui appelle maintenant l'edge).
5. Retirer la variable `VITE_N8N_WEBHOOK_MAILING` du frontend (plus utilisée).
**Question ouverte** : faut-il garder un workflow N8n d'envoi simple en backup en cas de panne edge function, ou bien tout est sur edge function maintenant ?
---

## [2026-05-21 18:00] P0.0.12 — Apps cohabitantes : 1 instance unique + charte multi-tenant
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : (à venir)
**Contexte** : Décision actée le 2026-05-21 (Eric) — instance Supabase unique conservée pour raisons de coût, pas de migration vers instances séparées. 4 apps actives sur la même instance : Majord'home, Pack Vendeur, Baikal (rag+legifrance), Arpet. 3 schémas partagés actifs : `core`, `config`, `sources`. Vestiges identifiés mais à confirmer avant DROP (snapstudio/karedas/zelty). 1 vestige droppé : `perfec` (0 tables). 3 schémas en attente de clarification : linktrack/invoicing/imports.
**Proposition** : Ajouter une section "Charte multi-tenant inter-apps" dans le CLAUDE.md (peut-être après "Multi-tenant & sécurité") :
**Charte multi-tenant unifiée** (instance Supabase partagée Majord'home / Pack Vendeur / Baikal / Arpet) :
1. Toute table d'app : RLS activée + policy scopée via `core.organization_members`
2. Toute vue `public.*` qui expose une table d'app : `WITH (security_invoker=true)` obligatoire (cf. P0.0.2)
3. Toute RPC SECURITY DEFINER : `REVOKE EXECUTE FROM anon` (cf. P0.0.4), sauf webhook public légitime
4. Toute table Storage : préfixe `${org_id}/...` + policy `(storage.foldername(name))[1]::uuid IN org_members`
5. Ne JAMAIS appeler `public.exec_sql` depuis le frontend (SECURITY INVOKER depuis P0.0.1)

Schémas partagés ne JAMAIS dropper : `core` (orgs/membership/profiles), `config` (apps/concepts), `sources` (files cross-app).

P0.0.3 (39 vues SECURITY DEFINER hors `majordhome_*`) reste à propager aux apps voisines pour fermer définitivement les vecteurs cross-org.
---

## [2026-05-21 19:05] Gotcha critique — DROP SCHEMA et config PostgREST
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : (à venir)
**Contexte** : Pendant P0.0.12, j'ai DROP le schéma `perfec` (0 tables, 0 vues, 0 fonctions) supposé inoffensif. Résultat : **30 minutes de downtime PostgREST 503** sur toute l'instance (Majord'home + Pack Vendeur impactés). Cause : le schéma était listé dans la config PostgREST Supabase (`db-schemas` exposed schemas) sans qu'aucun objet n'y existe. Le DROP a cassé le schema cache reload PostgREST → toute l'API REST en 503 jusqu'à recréation du schéma vide. Aucun warning ni côté Migration Supabase ni côté Advisor. Diagnostiqué via logs postgres (`ERROR: schema "perfec" does not exist` répété à chaque reload PostgREST) + logs API (503 universel). Fix : `CREATE SCHEMA IF NOT EXISTS perfec` puis `NOTIFY pgrst, 'reload schema'`. Cleanup propre : retirer perfec du Dashboard Supabase → API → Settings → "Exposed schemas" AVANT de drop.
**Proposition** : Ajouter dans la section "Gotchas DB" du CLAUDE.md :
**Gotcha DROP SCHEMA** : Ne JAMAIS `DROP SCHEMA xxx CASCADE` sans avoir d'abord vérifié que le schéma n'est PAS listé dans la config PostgREST de Supabase (Dashboard → API Settings → "Exposed schemas"). Si oui : (1) retirer le schéma de la liste exposée, (2) attendre le re-deploy PostgREST (~30s), (3) puis seulement DROP. Sinon → 503 sur TOUTE l'API REST de l'instance (toutes les apps cohabitantes impactées). Symptôme : PGRST002 "Could not query the database for the schema cache. Retrying." côté frontend, `ERROR: schema "xxx" does not exist` côté logs postgres. Fix d'urgence : `CREATE SCHEMA IF NOT EXISTS xxx; NOTIFY pgrst, 'reload schema';`. À retenir : un schéma vide listé en exposed schemas EST une dépendance même sans objet dedans.
---

## [2026-05-21 13:50] P0.2 + P0.4 — auth crons Pennylane (MDH_CRON_SECRET) + OAuth GSC state signé HMAC
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 4537a9684a269d7a8796b0df6324a819d56de33b
**Contexte** : Deux durcissements d'edges publics (`verify_jwt:false`) effectués dans ce commit :
1. **P0.2** — `pennylane-sync-cron` et `pennylane-backfill-quotes` exigent désormais un header `Authorization: Bearer <MDH_CRON_SECRET>` (comparaison timing-safe). Sans le secret → 401. Empêche l'invocation publique anonyme qui pouvait drainer le quota Pennylane Mayer + polluer la DB.
2. **P0.4** — Le state OAuth GSC n'est plus un `base64({orgId, returnTo})` opaque, mais un payload signé HMAC-SHA256 avec `RESEND_WEBHOOK_SECRET` (réutilisation du secret existant), bindé à `(orgId, userId, returnTo, nonce, exp)`, TTL 10 min. Au callback : vérif signature timing-safe + expiration + revalidation membership `user × org`. Empêche CSRF (state forgé), replay, et user-switch entre init et callback.

Le commit mentionne une **action externe requise pour activation** : ajouter `MDH_CRON_SECRET` dans Edge Functions Secrets côté Supabase + injecter le header `Authorization: Bearer <secret>` sur les nodes N8n qui appellent les 2 crons. Tant que ce n'est pas fait, les crons retournent 401 et ne tournent plus.

**Proposition** : Plusieurs ajouts possibles à arbitrer (à mixer avec les entrées hardening précédentes du même sprint Sem 0) :

1. **Ajouter une 7ème ligne au tableau "bombes structurelles"** (ou créer une sous-section "Hardening edges publics") :
   | 7 | Crons Pennylane `verify_jwt:false` publics → invocation anonyme possible (drain quota PL, pollution DB) | Auth header `MDH_CRON_SECRET` timing-safe sur `pennylane-sync-cron` + `pennylane-backfill-quotes` (P0.2) | ✅ Fait code (2026-05-21) / 🔧 Action externe : ajouter secret Supabase + header N8n |
   | 8 | State OAuth GSC opaque (base64) → CSRF, replay, user-switch entre init et callback | State signé HMAC-SHA256 avec binding `(orgId, userId, returnTo, nonce, exp)` + TTL 10 min + revalidation membership au callback (P0.4) | ✅ Fait (2026-05-21) |

2. **Ajouter dans Module Search Console** une note sécurité : "Le state OAuth GSC est signé HMAC-SHA256 avec `RESEND_WEBHOOK_SECRET` (réutilisation du secret Svix), payload `{orgId, userId, returnTo, nonce, exp}`, TTL 10 min. Le callback revalide la membership `user × org` (un user révoqué entre init et callback ne peut plus écrire le refresh_token sur l'org)."

3. **Documenter le nouvel env var `MDH_CRON_SECRET`** quelque part — soit dans une section "Env vars critiques" à créer, soit en gotcha dans Module Pennylane (à créer si pas encore documenté). Sans ce secret côté N8n, les 2 crons Pennylane ne tournent plus.

4. **Documenter le pattern réutilisable "OAuth state signé"** pour les futures intégrations OAuth (Meta Ads, autres providers) — payload signé HMAC + binding userId + TTL court + revalidation membership au callback. Pendant Sem 0 c'est l'occasion de poser la convention pour les futures intégrations.

5. **Pattern réutilisable "auth d'edge `verify_jwt:false`"** : tout cron/job public doit exiger un secret partagé via header Authorization Bearer + comparaison timing-safe. À noter dans "Multi-tenant & sécurité" comme règle additionnelle : "Toute edge function `verify_jwt:false` qui n'est PAS un webhook tiers légitime (Resend, Pennylane, Meta) doit exiger un secret partagé en header Authorization."

6. **Action externe à tracker** : ajouter `MDH_CRON_SECRET` dans Supabase Edge Functions Secrets + injecter le header sur les 2 nodes N8n appelants. À déplacer en RESOLU une fois activé en prod.
---

## [2026-05-21 14:22] Helper partagé `supabase/functions/_shared/auth.ts` (P0.25)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : ef95b5c4b82dc9d9d3a72d82af142e3aa5670710
**Contexte** : Nouveau fichier `supabase/functions/_shared/auth.ts` (270 lignes) qui pose la convention multi-tenant d'auth pour toutes les edge functions. Expose :
- `requireOrgMembership(req, opts)` : valide JWT user + check membership user × org dans `core.organization_members`, avec options `orgId`, `orgSettingsFilter` (filtre settings, ex: `pennylane.enabled`), `requiredRole` (hiérarchie `member < team_leader < org_admin`). Retourne `{ ok: true, userId, orgId, membershipRole, supabase }` ou `{ ok: false, response }` 401/403/500 prête à renvoyer.
- `requireSharedSecret(req, secret)` : check `Authorization: Bearer <secret>` timing-safe pour les edges `verify_jwt:false` (crons, jobs internes).
- Helpers exportés : `jsonResponse`, `getAdminClient`, `timingSafeEqual`, `corsHeaders`.
POC : `gsc-oauth-init` refactoré pour utiliser `requireOrgMembership` (passe de 35 lignes d'auth inline à 3 lignes). Code duplique encore présent dans `voice-extract-fieldreport`, `pennylane-sync-cron`, `pennylane-backfill-quotes` (à migrer).

**Proposition** : Documenter dans une nouvelle section "Convention auth edge functions" dans "Multi-tenant & sécurité" du CLAUDE.md, ou en sous-section dédiée :

**Helper partagé `supabase/functions/_shared/auth.ts`** :
- `verify_jwt:true` (edges appelées par le front avec JWT user) → `requireOrgMembership(req, { orgId, requiredRole?, orgSettingsFilter? })`. Pattern :
  ```ts
  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;
  const { userId, orgId, supabase } = auth;
  ```
- `verify_jwt:false` (crons N8n, jobs internes, PAS de webhook tiers signé) → `requireSharedSecret(req, Deno.env.get("MDH_CRON_SECRET") || "")`. Toute edge interne publique doit exiger ce secret en header `Authorization: Bearer <MDH_CRON_SECRET>`.
- Webhooks tiers (Resend Svix, Pennylane callback signé, etc.) → garder leur propre vérification de signature.

Question annexe : faut-il imposer dans la charte une migration progressive de toutes les edges existantes vers ce helper, ou seulement les nouvelles ? Liste à migrer : `voice-extract-fieldreport`, `pennylane-sync-cron`, `pennylane-backfill-quotes`, `pennylane-proxy`, `gsc-oauth-callback`, `gsc-sync`, `mailing-send`, `contract-signed-notify`, etc.
---

## [2026-05-21 14:22] Permission DB `voice_recorder.use` + ressource dans permissions.js (P0.10)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : ef95b5c4b82dc9d9d3a72d82af142e3aa5670710
**Contexte** : `src/lib/permissions.js` gagne une nouvelle entrée dans `RESOURCES` : `{ key: 'voice_recorder', label: 'Compte-rendu vocal (PWA)' }`. Côté DB, migration `p0_10_seed_voice_recorder_permission` seed `voice_recorder.use` dans `majordhome.role_permissions` (team_leader=true, autres=false ; org_admin bypass implicite). Le nouveau composant `VoiceAccessGate.jsx` (`src/apps/voice/components/`) utilise `useCanAccess().can('voice_recorder', 'use')` pour gater l'accès à la PWA voice, en remplacement d'une whitelist de 2 UUIDs (Eric + Philippe) hardcodés. Multi-tenant ready pour la 2ème entreprise — configurable via Settings → Permissions.

**Proposition** : Le module voice (PWA `src/apps/voice/`) n'est pas encore documenté dans CLAUDE.md (info dans mémoire `project_phase1_voice_pwa.md`). Faut-il :
1. Créer une section "Module Voice (PWA terrain)" dans CLAUDE.md maintenant (avec routes, edges `voice-extract-fieldreport`, RPC `record_voice_memo_extraction`, permission `voice_recorder.use`, env `MDH_CRON_SECRET` + `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`) ?
2. Attendre que la Phase 1 voice soit livrée/stabilisée avant d'ajouter une section dédiée, et garder l'info uniquement dans la mémoire pour l'instant ?
3. Au minimum, mentionner `voice_recorder` dans le tableau Rôles & Permissions ou dans une liste des ressources de permissions ?
---

## [2026-05-21 14:22] RPC `record_voice_memo_extraction` service_role only (P0.5)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : ef95b5c4b82dc9d9d3a72d82af142e3aa5670710
**Contexte** : Migration `p0_5_record_voice_revoke_public_anon_authenticated` : la RPC `public.record_voice_memo_extraction` (SECURITY DEFINER, insère dans `majordhome.voice_memos` + crée leads cross-org) voit ses droits durcis : `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`. Seul `service_role` peut l'appeler désormais. Avant ce fix, n'importe quel user front authentifié (ou même anon avec l'anon_key publique) pouvait forger un `org_id` arbitraire dans le payload et créer des voice_memos/leads cross-org. Le workflow N8n `mayer-voice-field-report` utilise déjà `service_role_key`, pas de régression côté N8n.

**Proposition** : Cette RPC n'est pas listée dans CLAUDE.md (module voice pas encore documenté, cf. proposition précédente). Faut-il étendre la charte multi-tenant "Règles imposées par le multi-tenant" avec une règle supplémentaire ?

> Toute RPC SECURITY DEFINER qui prend `org_id` dans son payload (sans le dériver d'`auth.uid()`) doit être restreinte à `service_role` seulement (REVOKE FROM PUBLIC, anon, authenticated). Sinon un attaquant authentifié peut forger un `org_id` arbitraire et écrire cross-org.

C'est une généralisation de la règle déjà existante "Tout nouveau RPC SECURITY DEFINER doit REVOKE EXECUTE FROM anon", mais qui va plus loin (exclut aussi authenticated dans le cas spécifique des RPCs prenant org_id en input).
---

## [2026-05-21 14:56] P0.26 — Helper `escapePostgrestSearchTerm` pour clauses PostgREST `.or()` / `.ilike`
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 876a3e00f6faaee501aa61aff4b30a427a35dc98
**Contexte** : Nouveau helper `src/lib/postgrestUtils.js:escapePostgrestSearchTerm(term)` qui strip les chars `,()*:%\` d'un terme de recherche utilisateur avant interpolation dans une clause PostgREST `.or()` / `.ilike`. Sans ce stripping, un utilisateur tapant `foo,is_archived.eq.false` pouvait forger un filtre additionnel AND dans la requête (potentiellement contourner un filtre légitime ou exfiltrer cross-org si le `org_id` n'était pas filtré ailleurs). 10 callsites patchés dans ce commit : `clients.service.js` (×2), `leads.service.js` (×2), `entretiens.service.js`, `prospects.service.js`, `suppliers.service.js` (×2), `voice/hooks/useVoiceContext.js`, `CreateSAVModal.jsx`.

**Proposition** : Ajouter une règle dans la section "Multi-tenant & sécurité" → "Règles imposées par le multi-tenant" :

> Toute clause PostgREST `.or()` / `.ilike()` qui interpole un input utilisateur DOIT le passer par `escapePostgrestSearchTerm()` (`src/lib/postgrestUtils.js`) avant interpolation. Strip `,()*:%\` empêche un attaquant de forger un filtre additionnel (ex: `foo,is_archived.eq.false`) qui contournerait un filtre légitime ou bypasserait `.eq('org_id')` si oublié ailleurs. Le helper est aussi appelable sur tout input qui transite dans PostgREST URL params.

Alternative : créer une mini-section "Conventions PostgREST" dans "Conventions de Code" qui documenterait à la fois ce helper + le pattern `.eq('org_id')` explicite + le pattern "ne JAMAIS construire de SQL dynamique côté frontend" (déjà en PENDING du 10:54).
---

## [2026-05-21 14:56] P0.27 — Reconfig ESLint (.eslintrc.cjs legacy) + dette héritée à trier
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 876a3e00f6faaee501aa61aff4b30a427a35dc98
**Contexte** : `npm run lint` était silencieux faute de config : `eslint . --ext js,jsx` échouait avec "No ESLint configuration found". Nouveau fichier `.eslintrc.cjs` (legacy config ESLint 8.57.1) qui pose `eslint:recommended` + `plugin:react/recommended` + `plugin:react-hooks/recommended` + `plugin:react/jsx-runtime`, `react-refresh` plugin, ignore `dist`, `node_modules`, `public`, `supabase/functions/**`, `*.config.*`. Règles assouplies : `prop-types: off`, `react-in-jsx-scope: off`, `no-unused-vars: warn` (argsIgnorePattern `^_`), `no-empty: warn` (allowEmptyCatch). Run actuel : **10 errors + 385 warnings** = dette héritée à trier dans une session dédiée (no-unused-vars, eslint-disable directives obsolètes, etc.). Note dans le commit : `eslint.config.js` (flat config) sera utilisé quand on passera à ESLint 9+.

**Proposition** : Plusieurs angles à arbitrer :

1. **Documenter le statut ESLint** dans la section "Commandes" du CLAUDE.md (1 ligne) : "ESLint 8.57.1 legacy config (`.eslintrc.cjs`). Run actuel : 10 errors + 385 warnings, dette héritée à trier. Migration ESLint 9+ flat config (`eslint.config.js`) pas encore faite."

2. **Créer une dette "dette résiduelle Sem 0"** quelque part — soit dans la mémoire `project_hardening_sem0_status.md`, soit dans une section "Dette" du CLAUDE.md, listant : ESLint cleanup (10 errors + 385 warnings), P0.11 propagation orgId dans cacheKeys (~3-4h), zoneDetection.js fallback Mayer hardcodé (cf. P0.13). Ça évite que ces 3 items s'oublient une fois le sprint Sem 0 clos.

3. **Action externe à tracker** : la 1ʳᵉ "session ESLint cleanup" dédiée sera nécessaire avant de pouvoir activer un CI lint strict (ex: GitHub Action qui bloque les PRs sur erreurs). Pas urgent tant qu'on est en mono-dev.
---

## [2026-05-21 16:09] P0.3 — Allowlist routes × méthodes `pennylane-proxy`
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 6cb46f83d854d15ac9d152e124627e36a54b6eb2
**Contexte** : `pennylane-proxy` v37 ne se contente plus de relayer n'importe quel `{method, path}` vers Pennylane. Le proxy implémente désormais :
- **Auth** : `requireOrgMembership(req, { orgSettingsFilter: settings.pennylane.enabled === true })` — l'user doit être membre d'au moins une org avec `pennylane.enabled` dans ses settings, sinon 403.
- **DELETE/PATCH bloqués partout** (405).
- **Allowlist explicite** des couples `{prefix, methods}` autorisés :
  - `/customers` → GET, POST
  - `/customer_invoices` → GET
  - `/quotes` → GET, POST, PUT
  - `/ledger_accounts` → GET
  - Tout autre path/méthode → 403.
- Logs warn explicites quand un user est bloqué (path tenté + userId + orgId).

Avant le fix : tout user authentifié pouvait potentiellement faire `DELETE /quotes/{id}`, `PATCH /customer_invoices/{id}`, ou accéder à d'autres ressources Pennylane non utilisées par le frontend (ex: `/transactions`, `/journals`). Validé bout en bout via UI Devis + Factures après déploiement.

**Proposition** : Plusieurs ajouts possibles à mixer avec les autres entrées Sem 0 :

1. **Documenter dans une section "Module Pennylane (proxy edge)"** (à créer dans CLAUDE.md si Sprint 9 doit être visible avant le hardening final) : routes whitelistées + auth obligatoire `pennylane.enabled` dans org settings + DELETE/PATCH bloqués. Avantage : tout futur appel à Pennylane depuis le frontend devra passer par cette allowlist, donc si on ajoute `/transactions` ou autres demain, c'est documenté qu'il faut amender l'allowlist côté edge.

2. **Pattern réutilisable "allowlist routes × méthodes"** pour les futurs proxies tiers (Meta Ads, Pennylane, GSC, etc.) — à noter comme convention dans "Multi-tenant & sécurité" : "Tout edge function proxy vers une API tierce DOIT implémenter une allowlist explicite des couples (path prefix, méthodes HTTP) autorisés. Pas de pass-through aveugle."

3. **Option `orgSettingsFilter` du helper `requireOrgMembership`** : élargir la doc du helper `_shared/auth.ts` (PENDING du 14:22) pour mentionner que `orgSettingsFilter: (settings) => bool` permet de restreindre l'accès aux orgs ayant une fonctionnalité activée (Pennylane, Meta, etc.). Pattern réutilisable pour toute fonctionnalité opt-in par org.
---

## [2026-05-21 16:09] P0.6 follow-up — Quota daily voice (table + RPC + env var)
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : 6cb46f83d854d15ac9d152e124627e36a54b6eb2
**Contexte** : `voice-extract-fieldreport` ajoute un garde-fou métier en plus du `MDH_CRON_SECRET` (P0.6) :
- **Nouvelle table** `majordhome.voice_quotas(user_id uuid, org_id uuid, date date, count int, last_at timestamptz)` + PK composite `(user_id, org_id, date)` + RLS policy SELECT scopée `org_members`. Pas de policy INSERT/UPDATE/DELETE (uniquement via RPC service_role).
- **Nouvelle RPC** `public.increment_voice_quota(p_user_id uuid, p_org_id uuid, p_daily_limit int)` SECURITY DEFINER + REVOKE PUBLIC/anon/authenticated + GRANT service_role. Fait un UPSERT atomique avec `RAISE EXCEPTION P0001 'voice_quota_exceeded'` si `count > limit` (le ROLLBACK du raise empêche un attaquant qui hammer en boucle de faire grossir le compteur).
- **Nouvelle env var** `VOICE_DAILY_LIMIT` (default 20/user/jour, override possible).
- **Transition douce** : si le body ne contient pas `user_id` + `org_id` (workflow N8n pas encore mis à jour), l'edge skip le check + log un warn. Sinon retourne **429 + JSON structuré** `{ success: false, error: "Voice quota exceeded", quota: { limit } }`.
- **Action externe Eric à tracker** : update workflow N8n `mayer-voice-field-report` pour passer `user_id` + `org_id` dans le body de l'appel à l'edge. Tant que ce n'est pas fait, le quota n'est PAS enforced.

**Proposition** : Plusieurs ajouts à arbitrer :

1. **Documenter le quota voice dans le module Voice** (PWA) — module pas encore documenté dans CLAUDE.md, cf. proposition PENDING du 14:22 ("Permission DB `voice_recorder.use`"). À regrouper dans une future section "Module Voice (PWA terrain)" qui couvrirait : permission `voice_recorder.use`, edges `voice-extract-fieldreport` + `record_voice_memo_extraction`, quota daily (table `voice_quotas` + RPC + env `VOICE_DAILY_LIMIT`), env vars critiques (`MDH_CRON_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

2. **Pattern réutilisable "quota daily per user × org"** pour les autres edges AI/coûteuses (GSC sync, Anthropic-driven mailing future, etc.) — table générique vs N tables dédiées ? Si on prend la même structure `(user_id, org_id, date, count)` + RPC `increment_X_quota`, ça vaudrait peut-être une mini-section "Quotas métier" dans Multi-tenant & sécurité.

3. **Stratégie atomique UPSERT + RAISE** : noter le pattern dans les Gotchas DB. La subtilité (le ROLLBACK du raise empêche un attaquant qui hammer en boucle de faire grossir le compteur) n'est pas évidente à la lecture, c'est un piège classique qu'on peut rater si on implémente un quota similaire ailleurs.

4. **Action externe à tracker** : update workflow N8n pour passer `user_id` + `org_id`. Tant que pas fait → quota inactif (skip + warn). À déplacer en RESOLU une fois activé en prod.
---

## [2026-05-21 18:37] CLAUDE.md mailing — webhook N8n public désormais obsolète
**Statut** : RESOLU (intégré dans CLAUDE.md, session 2026-05-21)
**Commit** : fc4270dbd8838a501d7d3c37eab218e8180a2c5c
**Contexte** : Le commit P0.11 inclut aussi (en plus du refacto cache keys) la finalisation de P0.8 V2 dans `ContractPdfSection.jsx` : l'envoi de la "Proposition Contrat" pour un client unique ne passe plus par le webhook public N8n `VITE_N8N_WEBHOOK_MAILING` mais par l'edge function `supabase/functions/mailing-send/` (mode `'single'` + `client_id`, l'edge appelle la RPC serveur `mail_fetch_recipients` avec check membership). Le code retire `N8N_WEBHOOK_URL`, `AbortController`, payload `segment_sql` et appel RPC `mail_single_client_sql` côté front. Par ailleurs, la mémoire `project_hardening_sem0_status.md` note que le workflow N8n "Mayer - Mailing" (id 1COgLUuiMtSq2sUq) a été archivé. Or la section "Module Mailing" de CLAUDE.md décrit toujours ce workflow + `VITE_N8N_WEBHOOK_MAILING` + payload `segment_sql` comme architecture primaire, et la section "Scheduler Campagnes Auto" décrit toujours l'étape `POST /webhook/mayer-mailing` comme étape 5 du workflow scheduler.
**Proposition** : Audit + refresh de la section "Module Mailing" pour refléter l'archi P0.8 V2. Plusieurs questions à arbitrer :

1. **Quel canal d'envoi est désormais le canonique ?** Edge function `mailing-send` partout (single + batch scheduler) ? Ou edge pour single + workflow N8n restauré/remplacé pour le batch ?
2. **`VITE_N8N_WEBHOOK_MAILING`** est-il encore utilisé quelque part dans le repo ? Si non, à retirer du CLAUDE.md + de `.env`.
3. **Section "Workflow N8n : Mayer - Mailing"** (~30 lignes décrivant le payload + noeuds Resend) — à supprimer, à remplacer par la doc de l'edge function `mailing-send`, ou à archiver dans `docs/` ?
4. **Section "Scheduler Campagnes Auto"** : l'étape 5 (`HTTP POST /webhook/mayer-mailing`) est-elle toujours valide ou le scheduler appelle maintenant directement l'edge ?
5. **Section "Évolutions prévues"** : ajouter une entrée ✅ FAIT pour P0.8 V2 (migration webhook → edge function `mailing-send`).

Faute de visibilité complète sur l'état actuel du workflow N8n et de la nouvelle edge `mailing-send` (non touchée dans ce diff, présente en `??` dans git status), je ne propose pas de patch direct — arbitrage humain nécessaire.
---

## [2026-05-21 21:26] Pennylane quote-driven — module chantiers ↔ devis Pennylane
**Statut** : RESOLU (intégré CLAUDE.md, session 2026-05-22 — flag ⚠️ WIP conservé)
**Commit** : 1df67db4079702821212d2d50357707e94a759ce
**Contexte** : Le commit ajoute toute une couche "quote-driven" sur les chantiers : nouveau composant `QuoteBlock.jsx` (257 LOC, affiché sur ChantierCard et ChantierModal), `LinkPennylaneQuoteModal.jsx` (modale de liaison), réécriture lourde de `ChantierReceptionSection.jsx` (443 LOC modifiées), +14 LOC dans `chantiers.service.js` et +62 LOC dans `pennylane.service.js` (fonctions liaison lead↔devis : assign/eject/list multi-devis par chantier). Le doc `docs/PROMPT_SPRINT_PENNYLANE_QUOTE_DRIVEN.md` décrit le plan d'arbitrage. Aujourd'hui le CLAUDE.md mentionne juste "Sprint 9 — Pennylane 🔧 EN COURS (proxy hardened P0.3, lignes libres + ledger_account livrés)" sans aucun détail sur cette architecture quote-driven. ⚠️ Le commit message indique explicitement que ce travail est non-finalisé ("À reprendre 1 par 1 si bugs", "smoke test fonctionnel non couvert").
**Proposition** : NE PAS documenter dans CLAUDE.md tant que la feature n'est pas validée fonctionnellement. Une fois stable, ajouter une sous-section "Module Pennylane quote-driven" décrivant : (1) flow utilisateur (liaison/déliaison d'un devis PL à un chantier), (2) composants clés (`QuoteBlock`, `LinkPennylaneQuoteModal`), (3) méthodes service (`pennylane.service.js` : assign/eject, multi-devis par chantier), (4) modèle DB (table de liaison `lead_pennylane_quotes` ?), (5) côté frontend : où le bloc est affiché (carte Kanban + Modal + Réception). Arbitrage à faire avec Eric quand la feature sortira du WIP.
---

## [2026-05-21 21:26] Pipeline LongTerm — sous-arbo `pipeline/longTerm/`
**Statut** : RESOLU (intégré CLAUDE.md, session 2026-05-22 — ligne ajoutée dans Architecture)
**Commit** : 1df67db4079702821212d2d50357707e94a759ce
**Contexte** : Création d'une sous-arborescence `src/apps/artisan/components/pipeline/longTerm/` contenant `LongTermLeadDrawer.jsx`, `LongTermTab.jsx`, `MoveToLongTermModal.jsx` (+ modif `LeadCard.jsx`). La fonctionnalité "Suivi MT-LT (devis long-terme)" est référencée dans MEMORY.md (`project_pipeline_mt_lt.md`, livraison 2026-04-25) mais l'arborescence n'apparaît pas dans la section "Architecture" du CLAUDE.md (la ligne pipeline mentionne uniquement `LeadModal+FormSections+StatusConfig, LeadKanban, LeadList, SchedulingPanel`). Commit en bulk explicitement non-finalisé.
**Proposition** : Une fois le module validé, ajouter à la section Architecture la ligne `│       ├── pipeline/longTerm/   # LongTermTab, LongTermLeadDrawer, MoveToLongTermModal (suivi projets MT-LT)` sous `pipeline/`. Vérifier également qu'il n'y a pas de duplication entre les composants `longTerm/` et le 4ème onglet Pipeline existant décrit dans MEMORY.md. Arbitrage humain pour confirmer l'arbo finale après stabilisation.
---


## [2026-05-22 02:49] Pattern lecture/écriture `core.organizations.settings` côté frontend
**Statut** : RESOLU (intégré CLAUDE.md, session 2026-05-22 — règle "useOrgSettings = canal canonique unique", migration progressive des callers existants en dette technique)
**Commit** : ff8b8ef27b28f050c1a88809514a0d57a93eba97
**Contexte** : Le commit pose la couche fondation d'accès aux settings d'org : nouveau service `src/shared/services/orgSettings.service.js` (`getSettings` via SELECT direct sur `core.organizations`, `updateSettings` via RPC `org_update_settings`), nouveau hook `src/shared/hooks/useOrgSettings.js` (React Query : `{settings, isLoading, save, isSaving}`), nouvelle famille de cache keys `orgSettingsKeys`. Aucun consumer dans ce commit — c'est la fondation pour la future UI Settings multi-tenant (cf. `docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md` §8). Le hook invalide aussi `['auth', 'organization']` pour resync `AuthContext.organization.settings`. Aujourd'hui plusieurs endroits du codebase lisent `useAuth().organization.settings` directement (ex GeoGrid Place ID, branding PDFs, territoire centers, Pennylane enabled flag).
**Proposition** : Une fois la 1ère page consumer livrée, ajouter à CLAUDE.md (section "Hooks" ou nouvelle sous-section "Settings org") :
- `useOrgSettings()` = canal canonique pour read/write des settings org côté frontend
- Lecture : SELECT direct (RLS via `security_invoker`) ; écriture : RPC `org_update_settings` (SECURITY DEFINER, org_admin only, raise P0002 si org inexistante)
- Invalide `['auth','organization']` après save → `useAuth().organization.settings` reste synchro
- Ajouter `orgSettingsKeys` à la liste des familles cache keys

Questions à arbitrer :
1. Faut-il migrer les lectures existantes (`useAuth().organization.settings` éparpillé) vers `useOrgSettings()` pour homogénéité ? Ou garder AuthContext comme source de vérité pour la lecture (≠ écriture) et n'utiliser `useOrgSettings` que pour les pages d'édition ?
2. Si on garde les 2 chemins, documenter la règle ("lecture passive = AuthContext, écriture + lecture editor = useOrgSettings") pour éviter de re-fetcher inutilement les settings sur chaque page.
3. Le `staleTime: 60s` du hook : suffisant si l'AuthContext est invalidé en parallèle après save, à reconsidérer si on découple les deux flux.

À documenter quand la 1ère page de Settings multi-tenant (cf. plan `2026-05-22-multitenant-settings-organization.md`) est livrée et qu'on sait quel pattern s'impose.
---

## [2026-05-22 02:55] Branding fallback : Mayer → Neutre (rule multi-tenant à corriger)
**Statut** : RESOLU (intégré CLAUDE.md, session 2026-05-22 — règle multi-tenant + ligne Composants mises à jour)
**Commit** : ab9dfe9fbe3ce5980f5f6175a122fb1cfa75456f
**Contexte** : Refacto `MAYER_DEFAULTS` → `NEUTRAL_DEFAULTS` dans `src/lib/orgBranding.js`. Avant : une org sans settings voyait silencieusement Mayer Énergie partout (nom, SIRET, RCS, adresse Gaillac, couleur orange, RGE QualiPAC/QualiBois, logo, etc.). Après : `name="Votre entreprise"`, tous les autres champs vides, `accentColor="#64748b"` (slate neutre), `rgeCertifications=[]`, `logoUrl=""` (pas d'`<img>`). Trois changements de comportement notables : (1) `portalUrl` n'est plus lu de `settings` mais hardcodé en constante `APP_PORTAL_URL='https://majordhome.vercel.app'` (singleton tant qu'il n'y a pas de sous-domaines par org) ; (2) `domain` est dérivé de `from_email.split('@')[1]` au lieu d'un setting dédié ; (3) `formatFullAddress` et `buildLegalFooter` filtrent les champs vides au lieu de produire des séparateurs orphelins (" – ", " — — — "). Cf design `docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md` §9.1.
**Proposition** : Mettre à jour la règle existante dans CLAUDE.md section "Règles imposées par le multi-tenant" :

> **Toute valeur de branding** (nom, adresse, URL, certification, couleur, logo) DOIT passer par `core.organizations.settings` + helper `buildCompanyInfo(settings)` de `src/lib/orgBranding.js` plutôt que d'être hardcodée. ~~Fallback Mayer accepté uniquement comme valeur par défaut dans le helper~~ → **Fallback neutre** (`"Votre entreprise"`, champs vides, couleur slate) — une org sans settings affiche du neutre, pas du Mayer (P0.13-P0.20 + refacto 2026-05-22). `portal_url` est une constante app (`APP_PORTAL_URL`), pas un setting. `domain` est dérivé de `from_email`.

Et mettre à jour la ligne "Branding multi-tenant" de la section Composants pour remplacer "avec fallback Mayer" par "avec fallback neutre".

Questions à arbitrer :
1. La règle "Fallback Mayer accepté" était listée parmi les règles multi-tenant — son inversion mérite-t-elle d'être mise en évidence (badge ⚠️ ou ligne dédiée dans le changelog d'en-tête) ?
2. Faut-il ajouter une note sur `APP_PORTAL_URL` constante app (singleton) dans la section "Aliases" ou "Constantes" du CLAUDE.md ?
3. Le changement est-il considéré complet ou y a-t-il des callers PDF qui dépendent encore de fields Mayer hardcodés (à vérifier sur `generateContractPdfBlob` & co) avant de figer la doc ?
---


## [2026-05-22 03:25] Documenter la page /settings/organization (3 onglets) + neutralisation fallback Mayer
**Statut** : RESOLU (intégré CLAUDE.md, session 2026-05-22 — nouvelle section "Module Settings → Organization" + règle "éditable via Settings, jamais hardcodée" ajoutée à la charte multi-tenant)
**Commit** : 72de6063c05a95af084413b6d64bd4ca8bdccc3e
**Contexte** : Livraison Task 1-15 de la spec `docs/superpowers/specs/2026-05-22-multitenant-settings-organization-design.md`. Une nouvelle page `/settings/organization` (org_admin only) avec 3 onglets (Identité, Coordonnées, Territoire) permet de configurer toutes les données de branding multi-tenant (`core.organizations.settings`). En parallèle, les fallbacks Mayer encore présents dans `orgBranding.js` et `mapbox.js` ont été neutralisés. Le champ legacy `geogrid_department_code` a été backfillé vers `geogrid_target_department` (Mayer = `81`).
**Proposition** : Ajouter une section dédiée dans CLAUDE.md (parallèle à "Module Tarification") :

```
## Module Settings → Organization (/settings/organization)

Configuration multi-tenant de l identité de l org (P0.13-P0.20 finalisé, 2026-05-22). Accès `org_admin` only.

- **Page** : `src/apps/artisan/pages/settings/OrganizationSettings.jsx` — 3 onglets :
  - **Identité** : nom, raison sociale, SIRET, RGE, logo, couleur secondaire
  - **Coordonnées** : adresse siège, téléphone, email, site web, IBAN
  - **Territoire** : centres territoire (siège + agences), département cible GeoGrid (singleton, code FR via `FRENCH_DEPARTMENTS`)
- **Source de vérité** : `core.organizations.settings` (JSONB) — consommé par `buildCompanyInfo(settings)`, `getOrgHeadquarters(settings)`, `getCoverageDepartments(settings)`.
- **Migration legacy** : champ `geogrid_department_code` (singleton historique Mayer) → `geogrid_target_department` (convention unifiée). Backfill Mayer = `81`.
- **Fallbacks Mayer neutralisés** (2026-05-22) : `orgBranding.js` et `lib/mapbox.js` ne renvoient plus de valeurs Mayer hardcodées si `settings` est vide → UI doit prompter la config si org neuve.
```

Question ouverte : faut-il aussi mentionner ce nouveau point de configuration dans la section "Multi-tenant et sécurité" en tête (charte) sous forme de règle "Toute nouvelle valeur de branding doit être éditable via /settings/organization, jamais hardcodée" ?
---