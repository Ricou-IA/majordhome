# Module Search Console (Google Search Console)

2ème thermomètre SEO complémentaire à GeoGrid (Maps). Affiche les positions, impressions et clics du site web (mayer-energie.fr) dans Google Search.

## Stack
- **OAuth Google** : refresh_token stocké dans `core.organizations.settings.gsc_refresh_token` + `gsc_site_url` (`sc-domain:mayer-energie.fr`)
- **API GSC** : `searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` (dimensions: query/date/page, rowLimit 25k, paginé jusqu'à 200k)
- **Projet GCP** : `Mayer Energie Automation` (compte gmail.com, OAuth Client + Search Console API activée). Secrets `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `FRONTEND_ORIGINS` dans Supabase Edge Functions

## Edge functions (`supabase/functions/`)
- `gsc-oauth-init` (verify_jwt: true) — valide membership user/org, retourne URL OAuth Google avec state encodé `base64({ orgId, returnTo })`
- `gsc-oauth-callback` (verify_jwt: false) — échange `code` → `refresh_token`, liste les sites GSC (priorité `sc-domain:mayer-energie.fr`), stocke dans settings, redirige vers `${returnTo}/geogrid?gsc=connected`
- `gsc-sync` (verify_jwt: true) — refresh access_token, paginate Search Analytics, UPSERT batch via RPC

## DB
- `majordhome.gsc_keyword_metrics` (org_id, site_url, date, query, page, impressions, clicks, ctr, avg_position) + UNIQUE (org_id, site_url, date, query, page) + RLS via `core.organization_members`
- Vues publiques `majordhome_gsc_keyword_metrics` + `_write`
- RPC `public.gsc_upsert_metrics(p_rows jsonb) RETURNS integer` (SECURITY DEFINER, search_path = majordhome) — UPSERT batch idempotent. Le schema `majordhome` n'est pas exposé directement par PostgREST, on passe par cette RPC pour les écritures depuis edge function.

## Frontend
- `gsc.service.js` — getAuthUrl, triggerSync, getMetrics, getStatus, disconnect
- `useGsc.js` — useGscStatus, useGscMetrics, useGscConnect, useGscSync, useGscDisconnect (+ `gscKeys` dans cacheKeys.js)
- `GscPanel.jsx` (`src/apps/artisan/components/geogrid/`) — états non-connecté (CTA OAuth) + connecté (header + sélecteur période 7j/30j/3m/12m + filtre famille + toggle "Liste Mayer SEO 2026 uniquement" + 5 KPIs + tableau agrégé par requête avec étoile pour les keywords de la liste curée)
- 4ème onglet "Search Console" dans `GeoGrid.jsx` avec auto-sélection au retour OAuth (`?gsc=connected`)

## Sync initiale
Au retour OAuth, `useEffect` détecte `?gsc=connected` et déclenche automatiquement `triggerSync({ monthsBack: 16 })`. Bouton "Sync 16 mois" disponible aussi pour re-import manuel.

## Premier test (2026-04-27)
370 lignes / 43 requêtes uniques sur 12 mois pour mayer-energie.fr.

## Gotcha — schema `majordhome` non exposé via PostgREST
Le client supabase-js ne peut pas écrire dans `majordhome.*` via `.schema('majordhome').from(...)` — PostgREST renvoie "Invalid schema: majordhome". Pattern : créer une RPC SECURITY DEFINER dans `public` avec `SET search_path = majordhome, public` qui fait l'opération. Le schema `core` est en revanche bien exposé (les `.schema('core')` fonctionnent). Pattern déjà utilisé pour les écritures N8N → Supabase.

## Voir aussi
- `docs/GSC_INTEGRATION_MASTER_PROMPT.md` — prompt master pour session dédiée d'évolution du module
