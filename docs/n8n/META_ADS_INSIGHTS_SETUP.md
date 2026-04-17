# Mayer - Meta Ads Insights (Daily) — Guide d'activation

> Workflow N8N qui snapshot quotidiennement les stats Meta Ads dans `majordhome.meta_ads_daily_stats`. Alimente le dashboard **Meta Ads** de Majord'home (org_admin).

## Prérequis

- Workflow référence : [`mayer-meta-ads-insights-daily-workflow.json`](./mayer-meta-ads-insights-daily-workflow.json)
- Credential N8N `Facebook Graph API` (même que le polling leads — déjà en place)
- Credential N8N `Header Auth` nommé ex. "Supabase service_role" :
  - Name: `Authorization`
  - Value: `Bearer <SERVICE_ROLE_KEY>`
  - L'en-tête `apikey` est rempli par le node HTTP avec la même valeur via expression
- Table `majordhome.meta_ads_daily_stats` créée (migration `meta_ads_daily_stats_v1`)
- RPC `public.meta_ads_upsert_daily_stats(p_rows jsonb)` déployée (migration `meta_ads_upsert_rpc`)

## Import dans N8N

1. Workflows → **Import from File** → sélectionner le JSON
2. Relier les credentials (Facebook Graph API, Supabase service_role)
3. Ne PAS activer tout de suite

## Test avant activation

1. Lancer manuellement une exécution (bouton **Execute Workflow**)
2. Vérifier que `Fetch Insights (Campaign)` / `(Adset)` retournent bien `data: [...]` (pas d'erreur 400)
3. Vérifier que `Normalize Rows` produit des items (sinon c'est que l'account n'a pas eu d'activité dans la période)
4. Vérifier dans Supabase :
   ```sql
   SELECT COUNT(*), MIN(date_start), MAX(date_start)
   FROM majordhome.meta_ads_daily_stats;
   ```

## Backfill historique

Pour récupérer tout l'historique depuis le début des comptes, avant activation du cron :

1. Ouvrir le nœud **Build Account List** (Code)
2. Changer `const BACKFILL_MODE = false;` → `const BACKFILL_MODE = true;`
3. Save + **Execute Workflow** (run manuel)
4. Remettre `const BACKFILL_MODE = false;` + save **avant** d'activer le cron quotidien

En `date_preset=maximum`, Meta renvoie tout l'historique du compte avec `time_increment=1` (une ligne par jour).

> Note : l'accès à `$env.*` dans les Code nodes est bloqué par défaut dans la plupart des instances N8N auto-hébergées (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`). D'où le choix d'une constante toggle-à-la-main plutôt qu'une variable d'env.

## Activation

Une fois le test + backfill OK :

1. Activer le workflow (toggle en haut à droite)
2. Il se déclenche tous les jours à **04:00 Paris**
3. À chaque run, il recalcule les 7 derniers jours (`date_preset=last_7d`) en UPSERT → les corrections d'attribution Meta J-1 à J-7 sont propagées automatiquement.

## Endpoints Graph API utilisés

| Nœud | Endpoint | Paramètres clés |
|------|----------|-----------------|
| Fetch Insights (Campaign) | `GET /v21.0/{act_id}/insights` | `level=campaign&time_increment=1&date_preset=last_7d` |
| Fetch Insights (Adset) | `GET /v21.0/{act_id}/insights` | `level=adset&time_increment=1&date_preset=last_7d` |
| Fetch Campaign Status | `GET /v21.0/{act_id}/campaigns` | `fields=id,name,status,effective_status,objective` |
| Fetch Adset Status | `GET /v21.0/{act_id}/adsets` | `fields=id,name,status,effective_status,campaign_id` |

## Mapping DB

| Champ Graph API | Colonne `meta_ads_daily_stats` | Notes |
|-----------------|--------------------------------|-------|
| `campaign_id` / `adset_id` | `entity_id` | selon `entity_level` |
| `campaign_name` / `adset_name` | `entity_name` | |
| `effective_status` | `entity_status` | ACTIVE / PAUSED / … |
| `campaign_id` (dans adset) | `parent_campaign_id` | pour drill-down UI |
| `spend` | `spend_cents` | `* 100`, arrondi entier |
| `impressions`, `reach`, `clicks` | idem | int |
| `ctr`, `frequency` | idem | numeric |
| `cpm`, `cpc` | `cpm_cents`, `cpc_cents` | `* 100` |
| `actions[]` | `leads_meta` | somme des `action_type ∈ {lead, leadgen.other, onsite_conversion.lead_grouped, offsite_conversion.fb_pixel_lead}` |
| payload complet | `raw_payload` (jsonb) | audit |

## Comptes Meta ciblés

- `act_1147055617398773` — **Mayer Energie Clim**
- `act_1198344052455745` — **Mayer Energie Poêle**

Modifiable dans le nœud **Build Account List** (Code).

## Idempotence

La contrainte `UNIQUE (ad_account_id, entity_level, entity_id, date_start)` permet de ré-exécuter le workflow sans risque : chaque jour × entité est overwrite avec les derniers chiffres Meta. C'est voulu — Meta corrige les attributions rétroactivement jusqu'à J-28.

## Troubleshooting

- **0 leads_meta alors que des leads arrivent dans le pipeline** → vérifier le mapping `LEAD_ACTION_TYPES` dans le Code Normalize. Les types Meta varient selon l'objectif de la campagne (Lead Gen Form = `lead` ; Pixel = `offsite_conversion.fb_pixel_lead`).
- **Erreur 400 `(#100) Please reduce the amount of data`** → réduire `date_preset` (30d au lieu de maximum) ou splitter les requêtes par tranche mensuelle.
- **RLS policy denied** → vérifier que le credential Supabase utilise bien la clé `service_role` (pas `anon`).
