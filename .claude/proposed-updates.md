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
