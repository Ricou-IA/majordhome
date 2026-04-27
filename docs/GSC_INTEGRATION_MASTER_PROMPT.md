# Master prompt — Intégration Google Search Console dans Majord'home

> À copier-coller dans une **nouvelle conversation Claude** dédiée à l'intégration GSC.
> Cette session-là est purement consacrée à GSC ; la session principale Majord'home gère le reste.

---

## Le prompt à utiliser

```
Tu vas intégrer Google Search Console dans l'app Majord'home pour ajouter
un 4ème onglet "Search Console" dans la page GeoGrid Rank Tracker, qui
deviendra le 2ème thermomètre SEO complémentaire à GeoGrid (qui mesure
les positions Maps via Places API).

# Repo et stack

- Repo principal : `C:\Dev\Frontend-Majordhome` (branche `main`)
- Stack frontend : React 18 + Vite 5 + React Router 6 + TanStack React Query v5 + Tailwind CSS 3.4
- Stack backend : Supabase (PostgreSQL + Edge Functions Deno + Auth)
- Pattern services : `src/shared/services/xxxService.js` retourne `{ data, error }`
- Pattern hooks : `src/shared/hooks/` avec cache keys dans `cacheKeys.js`
- Conventions : voir `CLAUDE.md` à la racine

⚠️ Préférences utilisateur (depuis MEMORY.md) :
- Communique en français, code en anglais, interface en français
- NE JAMAIS utiliser les preview tools — utilise `npx vite build` pour vérifier
- Toujours travailler sur le repo principal, branche main

# Contexte business

**Mayer Énergie** (TPE artisan CVC, Gaillac, Tarn) a son site web
https://mayer-energie.fr déjà configuré dans Google Search Console
(propriété vérifiée par eric.pudebat@gmail.com).

L'objectif : récupérer automatiquement les données GSC (requêtes,
impressions, clics, CTR, position moyenne) et les afficher dans
Majord'home pour suivre l'évolution SEO du site dans le temps, en
parallèle des positions Maps déjà mesurées par GeoGrid.

# Liste des keywords prioritaires (déjà curée)

La liste "Mayer SEO 2026" est déjà en DB (table `majordhome.geogrid_keyword_lists`).
Elle contient 25 keywords prioritaires (Poêle / Ramonage / Climatisation /
PAC / Chauffage / Entretien). Le but : croiser les data GSC avec ces
mêmes keywords pour avoir un thermomètre cohérent Maps + Search.

Voir détails dans `CLAUDE.md` section "Module GeoGrid Rank Tracker".

# Architecture cible

## DB

Table `majordhome.gsc_keyword_metrics` :
```sql
CREATE TABLE majordhome.gsc_keyword_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  site_url TEXT NOT NULL,           -- https://mayer-energie.fr
  date DATE NOT NULL,
  query TEXT NOT NULL,              -- la requête tapée
  page TEXT,                        -- URL qui ressort (optionnel)
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  ctr DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, site_url, date, query, page)
);

CREATE INDEX idx_gsc_metrics_org_date ON majordhome.gsc_keyword_metrics(org_id, date DESC);
CREATE INDEX idx_gsc_metrics_query ON majordhome.gsc_keyword_metrics(query);
```

+ Vues publiques `public.majordhome_gsc_keyword_metrics` et `_write`

## Stockage du refresh_token GSC

À stocker dans `core.organizations.settings` (jsonb existant) :
```json
{
  "google_place_id": "ChIJ...",  // déjà existant
  "gsc_refresh_token": "1//xxxxx",
  "gsc_site_url": "sc-domain:mayer-energie.fr"
}
```

⚠️ Sécurité : le refresh_token donne accès permanent à GSC. À traiter avec
précaution (HTTPS only, RLS strict, ne jamais exposer côté client).

## Edge functions (à créer dans `supabase/functions/`)

### `gsc-oauth-callback`
- `verify_jwt: false` (callback OAuth public)
- Reçoit le `code` retourné par Google après autorisation
- Échange le code contre un `refresh_token` via Google OAuth API
- Stocke le `refresh_token` dans `core.organizations.settings.gsc_refresh_token`
- Stocke aussi le `site_url` confirmé (récupéré via `searchconsole.sites.list`)
- Redirige vers `/geogrid?gsc=connected` après succès

### `gsc-sync`
- `verify_jwt: true` (appelé par cron N8n authentifié, ou via UI)
- Lit le `refresh_token` de l'org
- Refresh l'`access_token` via Google OAuth (https://oauth2.googleapis.com/token)
- Appelle l'API GSC :
  ```
  POST https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query
  body: {
    startDate: 'YYYY-MM-DD',
    endDate: 'YYYY-MM-DD',
    dimensions: ['query', 'date', 'page'],
    rowLimit: 25000
  }
  ```
- UPSERT dans `majordhome.gsc_keyword_metrics` (idempotent via UNIQUE constraint)
- Renvoie un résumé `{ rowsImported, dateRange }`

## Frontend

### Service
`src/shared/services/gsc.service.js` :
- `getMetrics(orgId, { dateFrom, dateTo, queries? }) → { data, error }`
- `triggerSync(orgId) → { data, error }` (appelle gsc-sync edge function)
- `connectGsc(orgId) → ouvre OAuth flow`

### Hooks
`src/shared/hooks/useGsc.js` :
- `useGscMetrics(orgId, dateRange)` — query React
- `useGscSync()` — mutation pour refresh manuel
- `useGscStatus(orgId)` — détecte si refresh_token présent

Ajouter cache keys dans `src/shared/hooks/cacheKeys.js` :
```js
export const gscKeys = {
  all: ['gsc'],
  metrics: (orgId, range) => [...gscKeys.all, 'metrics', orgId, range],
  status: (orgId) => [...gscKeys.all, 'status', orgId],
};
```

### UI

Ajouter un 4ème onglet **"Search Console"** dans `src/apps/artisan/pages/GeoGrid.jsx`.
S'inspirer de l'architecture des onglets existants (Scan / Listes / Benchmarks).

Composant `src/apps/artisan/components/geogrid/GscPanel.jsx` :

**État 1 — pas connecté** :
- Card "Connecte ton compte Google Search Console pour voir les positions de mayer-energie.fr"
- Bouton "Se connecter à GSC" → redirige vers Google OAuth consent

**État 2 — connecté** :
- Header : Site connecté + bouton "Synchroniser maintenant" + dernière sync
- Sélecteur de période (7j / 30j / 3 mois / 12 mois)
- Tableau : Query × Impressions × Clics × CTR × Position moyenne
- **Croisement avec liste "Mayer SEO 2026"** : pour chaque keyword de la liste, afficher si présent dans GSC + ses metrics. Si pas de data → "Pas encore d'impressions"
- Filtre par famille (réutiliser `detectFamily()` de `BenchmarkResultTable.jsx`)
- Optionnel : graph d'évolution position dans le temps

# Pré-requis utilisateur (à valider avant de coder)

L'utilisateur doit faire ces 4 étapes dans Google Cloud :

1. Aller dans le projet GCP **`Towercontrol`** (compte eric.pudebat@gmail.com)
2. **APIs & Services** → **Bibliothèque** → activer "Google Search Console API"
3. **APIs & Services** → **Identifiants** → Créer un **OAuth 2.0 Client ID** :
   - Type : "Application Web"
   - Authorized redirect URIs : URL de l'edge function callback, ex.
     `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/gsc-oauth-callback`
4. Récupérer **Client ID** et **Client Secret** → les stocker dans Supabase Edge
   Functions Secrets (`GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`)

Demande à l'utilisateur de confirmer ces pré-requis avant de commencer
l'implémentation. Si nécessaire, guide-le pas à pas dans la console GCP.

# Étapes d'implémentation suggérées

1. **Validation pré-requis** : OAuth Client ID créé + secrets Supabase configurés
2. **Migration DB** : créer la table `gsc_keyword_metrics` + vues + index
3. **Edge function `gsc-oauth-callback`** : déployer + tester le flow OAuth
4. **Edge function `gsc-sync`** : implémenter + tester avec un appel manuel
5. **Service + hooks frontend** : `gsc.service.js`, `useGsc.js`, cache keys
6. **UI onglet "Search Console"** : composant `GscPanel` avec les 2 états
7. **Synchronisation initiale** : sync 16 mois d'historique au premier connect
8. **Cron quotidien** (optionnel, peut être Phase 2) : N8n ou pg_cron qui appelle
   gsc-sync 1×/jour pour rafraîchir les data
9. **Build verification** : `npx vite build` (l'utilisateur a son propre dev server,
   pas de preview tool)
10. **Commit + push** sur main avec message descriptif

# Format du flow OAuth attendu (Google Search Console)

Scopes requis : `https://www.googleapis.com/auth/webmasters.readonly`

URL d'autorisation :
```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id={GSC_CLIENT_ID}
  &redirect_uri={CALLBACK_URL}
  &response_type=code
  &scope=https://www.googleapis.com/auth/webmasters.readonly
  &access_type=offline
  &prompt=consent
  &state={orgId}
```

Le `state` permet de relier le callback à la bonne org.
`access_type=offline` + `prompt=consent` garantissent un `refresh_token`.

# Documentation à mettre à jour

À la fin de l'implémentation :
- `CLAUDE.md` : ajouter une section "Module Search Console" similaire à GeoGrid
- `MEMORY.md` (`~/.claude/projects/.../memory/`) : ajouter une entrée sur GSC

# Workflow attendu de la conversation

1. Tu confirmes que tu as bien le contexte (résume en 3-4 lignes ce que tu vas faire)
2. Tu demandes à l'utilisateur de valider les pré-requis OAuth (étape 1)
3. Tu attends qu'il te transmette le OAuth Client ID + Client Secret
4. Tu commences par la migration DB
5. Tu enchaînes sur les edge functions une par une, avec test à chaque étape
6. Tu finis par le frontend + intégration

Commence par résumer ce que tu vas faire et demander à l'utilisateur de
créer l'OAuth Client ID sur le projet GCP Towercontrol.
```

---

## Contexte d'utilisation de ce prompt

Ce prompt est destiné à une **conversation séparée** dédiée à GSC.
Pourquoi séparé :
- L'OAuth setup + edge functions Deno + sync API + UI = ~1 journée de dev
- Réduction de la complexité contextuelle de la session principale
- Permet à l'utilisateur d'avoir le suivi du projet sans mélanger avec d'autres
  travaux Majord'home

## Ce qui doit déjà être en place

- Listes de keywords + benchmarks GeoGrid (✅ fait dans la session principale)
- Master prompt SEO du site web (✅ existe : `docs/SEO_AUDIT_MASTER_PROMPT.md`)
- Place ID Mayer dans org settings (✅ déjà rempli)

## Pour aller plus loin (Phase 2/3)

Une fois GSC fonctionnel, plusieurs extensions possibles :
- **Cron mensuel auto** : N8n qui appelle `gsc-sync` chaque jour
- **Vue consolidée** : tableau qui combine GeoGrid (Maps) + GSC (Search) côte à côte par keyword
- **Alertes** : "tu as perdu 5 positions moyennes sur `ramoneur` ce mois-ci"
- **Multi-orgs** : si Majord'home gère plusieurs clients un jour, OAuth par org
