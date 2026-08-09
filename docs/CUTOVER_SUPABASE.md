# Cutover — projet Supabase dédié (chantier 0)

> Checklist de préparation et d'exécution du déménagement de Majord'home vers son propre projet Supabase.
> Établi le 2026-08-09. Précédent réussi : Pack Vendeur, migré vers `ycmavnmtyvodqawvwrrd`, ancien projet conservé en fallback.

| | Projet | Organisation | Plan |
|---|---|---|---|
| **Source** | `odspcxgafcqxjzrarsqf` — partagé avec Baikal, Arpet, Agent Marketing, Voirie | `Confer` / `kssnsyagibfxthtwmpds` | free |
| **Cible** | `ejqqqwudmizqisdkxohw` — `Majordhome`, `eu-west-3`, créé le 2026-08-09 | `Confer` (temporairement) | free |
| **Destination finale** | la cible, après transfert | `confer-saas` / `sswhrsezyvlutwqlyvrw` | Pro |

Le projet cible est volontairement créé dans l'org **gratuite** : tout le chantier (restore, répétition, cutover) s'y déroule sans payer de compute. Le transfert vers `confer-saas` se fait **après** la bascule réussie — c'est un changement de propriété, pas une migration.

⚠️ **Accès outillage** : le connecteur MCP Supabase n'est autorisé que sur l'org `Confer`. Après le transfert vers `confer-saas`, l'exécution SQL à la volée (`execute_sql`, `apply_migration`, advisors) ne sera plus disponible — seule la CLI, authentifiée au niveau du compte, continuera de fonctionner (déploiement d'edge functions, dumps). À ré-autoriser depuis les réglages de connecteurs claude.ai sur la nouvelle org.

## Destination et coût (arbitré le 2026-08-09)

**Nouveau projet Pro dédié, dans l'organisation Supabase existante `kssnsyagibfxthtwmpds`.**

Le tier gratuit plafonne à 2 projets par organisation, et les deux sont pris (`odspcxgafcqxjzrarsqf`, `ycmavnmtyvodqawvwrrd`). Créer un projet Majord'home **impose** donc le passage en Pro : ce n'est pas un choix.

| État | Projets | Coût mensuel |
|---|---|---|
| Aujourd'hui (Free) | 2 | 0 € |
| Pro, sans rien déménager | 2 | ~35 $ |
| Pro + projet Majord'home dédié | 3 | ~45 $ |

Le Pro est facturé **par organisation** (25 $, incluant 10 $ de crédit compute), pas par projet. Les autres apps — Baikal, Arpet, Agent Marketing, Voirie — restent ensemble sur `odspcxgafcqxjzrarsqf` : elles n'ajoutent aucun coût.

**Deux dépenses distinctes, deux urgences distinctes :**

- Les 25 $ ne financent pas l'ambition SaaS. Mayer Énergie tourne aujourd'hui sur un projet **gratuit, sans aucune sauvegarde**, à 55 % du plafond de 500 MB. On paierait ces 25 $ même sans jamais vendre le produit.
- Les 10 $ du projet dédié financent, eux, ce que la cohabitation empêche : faire évoluer le schéma `core` sans risquer 5 apps voisines (chantier 3), ranger les secrets clients dans un Vault qui n'est pas partagé (chantier 1b), et ne plus partager un quota de base avec le RAG de Baikal.

**Secrets : régénérer, ne pas recopier.** Le Vault de l'instance partagée a été exposé le 2026-08-08 (`gtm_get_secret`, Agent Marketing). Tous les secrets qui y vivent sont à considérer comme fuités. Recopier des secrets suspects sur une instance neuve annulerait la moitié du bénéfice du déménagement — la rotation se fait au passage, pas plus tard.

## Méthode — le point qui décide de tout

**Dump/restore de la base vivante. Jamais un rejeu des migrations du repo.**

La production compte **536 migrations** dans `supabase_migrations.schema_migrations`, le repo en contient **63 fichiers**. L'écart vient de `apply_migration` (MCP), qui enregistre la version en base sans écrire de fichier local. Rejouer le repo sur un projet vide produirait une fraction du schéma.

Bascule **big-bang avec fenêtre de coupure** un dimanche matin, pas de double-écriture. Ancien projet conservé en lecture ~4 semaines.

⚠️ Le jour où l'on supprimera le schéma `majordhome` de l'ancien projet : **retirer d'abord le schéma des « Exposed schemas »** du dashboard, sinon 503 sur toute l'API REST de l'instance — les autres apps incluses (incident du 2026-05-21, 30 min).

## 1. Secrets des edge functions

Fournis automatiquement par Supabase, **rien à faire** : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

À recréer sur le nouveau projet :

| Secret | Utilisé par | Note |
|---|---|---|
| `MDH_CRON_SECRET` | 9 fonctions | **Aussi à poser dans `vault.secrets`** — c'est là que pg_cron le lit |
| `RESEND_WEBHOOK_SECRET` | 6 | Double usage : vérification Svix **et** clé de signature des états OAuth (GSC + Google Calendar) |
| `PENNYLANE_API_TOKEN` | 5 | Mono-tenant aujourd'hui — devient un secret par org au chantier 1b |
| `RESEND_API_KEY` | 4 | |
| `GSC_CLIENT_ID` / `GSC_CLIENT_SECRET` | 3 / 2 | App OAuth Search Console |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 2 / 2 | App OAuth Google Calendar — **distincte de GSC** |
| `GOOGLE_PLACES_API_KEY` | 1 | GeoGrid (projet GCP *Towercontrol*) |
| `GOOGLE_SOLAR_API_KEY` | 1 | Module Solaire |
| `OPENAI_API_KEY` | 1 | Whisper + fallback extraction voice |
| `ANTHROPIC_API_KEY` | 1 | Extraction voice |

Optionnels, valeur par défaut dans le code si absents : `PENNYLANE_BASE_URL`, `FRONTEND_ORIGINS`, `DENO_ENV`, `ENVIRONMENT`, `VOICE_DAILY_LIMIT`, `MAILING_MAX_PER_RUN`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `MDH_PL_APPLY_DEADLINES`.

## 2. Edge functions

27 fonctions, **toutes versionnées** depuis le commit `889157a` (5 tournaient sans exister dans le repo). `supabase/config.toml` porte leur `verify_jwt`.

⚠️ `config.toml` déclare encore `meeting-extract` (Arpet, 0 appelant Majord'home) en `verify_jwt = true` alors que la prod est en `false` — à retirer avant tout `functions deploy` global, sous peine de casser une app voisine.

## 3. Storage

6 buckets + 23 policies, scriptés dans `supabase/migrations/20260809_2_storage_buckets_et_policies.sql`. **Le contenu des buckets est à copier séparément** — la migration ne crée que les contenants et les règles.

Deux anomalies transcrites telles quelles, à instruire séparément (détail en commentaire dans la migration) : les policies `interventions` filtrent sur le nom du projet au lieu du chemin de l'objet ; `project-recordings` dérive l'org de `core.profiles` au lieu de `core.organization_members`.

## 4. Crons pg_cron

4 jobs, avec **l'URL du projet en dur** dans leurs migrations — à réécrire :

| Job | Migration |
|---|---|
| `pennylane-sync-quote-status` | `20260527_pennylane_sync_quote_status_cron.sql` |
| `mailing-scheduler` | `20260602_mailing_scheduler_cron.sql` |
| `geocode-sweep` | `20260617_3_geocode_sweep_cron.sql` |
| `pennylane-quotes-sweep` | `20260807_3_pennylane_quotes_sweep_cron.sql` |

Contrôle après bascule : `select jobname, schedule from cron.job`. Une edge décrite comme un cron sans entrée `cron.job` ne tourne jamais — déjà vécu.

## 5. Références au projet en dur, hors crons

- `src/apps/artisan/components/mailing/resources.js:63` — URL `avis-redirect`, injectée dans le prompt IA du mailing
- `scripts/geocode-clients.mjs:23`
- `supabase/config.toml:11` — `project_id`, normal, à mettre à jour

## 6. Dépendances externes (hors Supabase)

- **Google Cloud** : réenregistrer les redirect URI OAuth sur la nouvelle URL de projet — Calendar **et** Search Console. Sans ça les deux connexions cassent silencieusement.
- **N8N** : 6 webhooks (`VITE_N8N_WEBHOOK_*`) et les workflows qui écrivent en base via RPC.
- **Vercel** : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
- **Resend** : vérifier que le webhook pointe vers la nouvelle edge.

## 7. Extensions Postgres

À réactiver : `pg_cron`, `supabase_vault`, `moddatetime`. Contrôler la liste complète via `list_extensions` avant la bascule.

## 8. Critère de succès — vérifiable, pas déclaratif

Sur le nouveau projet, après restauration :

1. Login Mayer opérationnel
2. Les 4 crons ont tourné au moins une fois (`cron.job_run_details`)
3. Un devis Pennylane se resynchronise
4. Un PDF de contrat se génère et s'uploade dans le bucket `contracts`
5. Un mailing de test part et son webhook Resend revient
6. **Audit de privilèges propre** : `has_function_privilege('anon', …)` faux sur tous les RPC SECURITY DEFINER, `security_invoker` vrai sur les 73 vues `majordhome_*`

Le point 6 n'est pas optionnel : une partie du durcissement Sem 0 a été appliquée hors migrations, via `execute_sql`. **Un restore ne garantit pas qu'il a suivi — il faut le vérifier, pas le présumer.**

## État de la préparation

- [x] Edge functions non versionnées récupérées (`889157a`)
- [x] Buckets Storage + policies scriptés (`20260809_2`)
- [x] Inventaire des secrets (ce document)
- [ ] Répétition à blanc chronométrée sur projet jetable
- [ ] Date de bascule
