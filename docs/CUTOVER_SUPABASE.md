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

**Secrets : audit du Vault fait le 2026-08-10, la portée est étroite.** L'exposition du 2026-08-08 (`gtm_get_secret`, Agent Marketing) concernait `vault.secrets`, dont le contenu réel était : `mdh_cron_secret` (seul secret Majord'home), `GTM_INTERNAL_KEY`, `GTM_UNSUB_SECRET`, `pv_cleanup_cron_secret`, `pv_scrape_cron_secret`, `supabase_anon_key` (publique par conception).

Les secrets des edge functions vivent dans un **magasin distinct** (variables d'environnement Edge Functions) que cet incident n'a pas touché. Conclusion : **un seul secret à régénérer pour cause de fuite** — `MDH_CRON_SECRET` — et un second qui change mécaniquement, `RESEND_WEBHOOK_SECRET` (nouvelle URL d'edge ⇒ nouveau webhook Resend ⇒ nouveau `whsec_`). Les autres peuvent être recopiés.

## Méthode — le point qui décide de tout

**Dump/restore de la base vivante. Jamais un rejeu des migrations du repo.**

La production compte **536 migrations** dans `supabase_migrations.schema_migrations`, le repo en contient **63 fichiers**. L'écart vient de `apply_migration` (MCP), qui enregistre la version en base sans écrire de fichier local. Rejouer le repo sur un projet vide produirait une fraction du schéma.

Bascule **big-bang avec fenêtre de coupure** un dimanche matin, pas de double-écriture. Ancien projet conservé en lecture ~4 semaines.

⚠️ Le jour où l'on supprimera le schéma `majordhome` de l'ancien projet : **retirer d'abord le schéma des « Exposed schemas »** du dashboard, sinon 503 sur toute l'API REST de l'instance — les autres apps incluses (incident du 2026-05-21, 30 min).

## 1. Secrets des edge functions

Fournis automatiquement par Supabase, **rien à faire** : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

À recréer sur le nouveau projet :

| Secret | Utilisé par | Action | Note |
|---|---|---|---|
| `MDH_CRON_SECRET` | 9 fonctions | 🔴 **régénérer** | Exposé le 08/08. Chaîne aléatoire, aucun tiers. **Aussi à poser dans `vault.secrets`** — c'est là que pg_cron le lit |
| `RESEND_WEBHOOK_SECRET` | 6 | 🔴 **change** | Nouvelle URL d'edge ⇒ nouveau webhook Resend ⇒ nouveau `whsec_`. Double usage : vérification Svix **et** clé de signature des états OAuth (GSC + Google Calendar) |
| `RESEND_API_KEY` | 4 | copier | Dashboard Resend |
| `PENNYLANE_API_TOKEN` | 5 | copier | Mono-tenant aujourd'hui — devient un secret par org au chantier 1b |
| `GSC_CLIENT_ID` / `GSC_CLIENT_SECRET` | 3 / 2 | copier | App OAuth Search Console |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 2 / 2 | copier | App OAuth Google Calendar — **distincte de GSC** |
| `GOOGLE_PLACES_API_KEY` | 1 | copier | GeoGrid (projet GCP *Towercontrol*) |
| `GOOGLE_SOLAR_API_KEY` | 1 | copier | Module Solaire |
| `OPENAI_API_KEY` | 1 | copier | Whisper + fallback extraction voice |
| `ANTHROPIC_API_KEY` | 1 | copier | Extraction voice |

Optionnels, valeur par défaut dans le code si absents : `PENNYLANE_BASE_URL`, `FRONTEND_ORIGINS`, `DENO_ENV`, `ENVIRONMENT`, `VOICE_DAILY_LIMIT`, `MAILING_MAX_PER_RUN`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `MDH_PL_APPLY_DEADLINES`.

**`GEMINI_API_KEY` — posée le 2026-08-10, aucun consommateur à ce jour.** Aucune ligne de Majord'home n'appelle Gemini : ni les 27 edge functions, ni le frontend. Provisionnée en anticipation d'un usage non arrêté. Trois pistes évoquées : second moteur derrière Claude dans `voice-extract-fieldreport` (à la place de GPT-4o), transcription audio native en remplacement de Whisper dans `transcribe-dictation` (ce qui supprimerait la dépendance OpenAI), ou tout autre besoin. **Si elle n'a toujours aucun consommateur au moment du cutover, ne pas la reporter machinalement** — la reposer seulement quand un usage existe.

> Ne pas confondre avec les entrées `@google/generative-ai` de `supabase/functions/transcribe-dictation/import_map.json` : elles sont héritées du bundle partagé d'une app voisine (Pack Vendeur utilise Gemini), pas d'un usage Majord'home.

## 2. Edge functions

27 fonctions, **toutes versionnées** depuis le commit `889157a` (5 tournaient sans exister dans le repo). `supabase/config.toml` porte leur `verify_jwt`.

✅ **Déployées sur le projet cible le 2026-08-10** — les 27, en une passe (`supabase functions deploy --project-ref ejqqqwudmizqisdkxohw`). `verify_jwt` vérifié après coup : 14 fonctions sans JWT, exactement celles attendues (webhooks tiers, callbacks OAuth, crons protégés par `MDH_CRON_SECRET`). Aucune exposée à tort, aucune verrouillée à tort.

`meeting-extract` a été **retirée de `config.toml`** au passage : elle appartient à Arpet, son source n'est pas dans ce repo, et sa présence faisait échouer le déploiement global. Elle y était de surcroît déclarée `verify_jwt = true` alors que la prod la sert en `false` — un deploy global depuis ce repo vers l'instance partagée aurait pu la basculer et casser une app voisine.

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

- **Google Cloud — les identifiants sont répartis sur DEUX projets GCP**, vérifié le 2026-08-10 (les empreintes des secrets en prod confirment qu'aucune clé n'est partagée) :

  | Projet GCP | Contient | Secret |
  |---|---|---|
  | **Mayer Energie Automation** | *Maps Platform API Key* (créée le 06/07, 35 API autorisées) | `GOOGLE_SOLAR_API_KEY` |
  | | client OAuth *Majord'home Calendar Sync* (créé le 07/04, appli web) | `GOOGLE_CLIENT_ID` / `_SECRET` |
  | **Towercontrol** (`eric.pudebat@gmail.com`) | clé API GeoGrid | `GOOGLE_PLACES_API_KEY` |
  | | client OAuth Search Console | `GSC_CLIENT_ID` / `_SECRET` |

  Redirect URI à ajouter sur **chacun des deux clients OAuth** (sans retirer l'ancien, les deux coexistent le temps de la bascule) :
  - Calendar → `https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/google-calendar-auth?action=callback` — ✅ ajouté le 2026-08-10
  - Search Console → `https://ejqqqwudmizqisdkxohw.supabase.co/functions/v1/gsc-oauth-callback` — ⬜

  Sans ça, les deux connexions cassent **silencieusement**.
- **N8N — deux sens à traiter, ne pas oublier le second** :
  - *Majord'home → N8N* : les 6 webhooks `VITE_N8N_WEBHOOK_*` (SMS avis, SMS rappel, PDF contrat, PDF intervention, signature, voice). Leur URL ne change pas, mais les identifiants SMS qu'ils utilisent restent les tiens (sujet du chantier 1b, pas du cutover).
  - *N8N → Majord'home* : **c'est là que ça casse en silence.** Les workflows appellent directement des edge functions (`transcribe-dictation` pour la transcription Whisper de la chaîne vocale, `voice-extract-fieldreport`) et écrivent en base via RPC. Ils embarquent donc trois choses liées à l'ancien projet, toutes à mettre à jour : **l'URL** (le ref du projet est dedans), le **`MDH_CRON_SECRET`** en Bearer (qu'on régénère), et la **clé `service_role`**, présente en clair dans certains nodes. Sans ça, la chaîne vocale et l'ingestion de leads Meta s'arrêtent sans message d'erreur.
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

## Répétition à blanc — résultats (2026-08-10)

Exécutée de bout en bout sur `ejqqqwudmizqisdkxohw`. Tout ce qui suit est **vérifié en base**, pas déduit d'un journal — les journaux PowerShell sont écrits en UTF-16 et le comptage d'erreurs par `grep` y renvoie 0 quoi qu'il arrive.

| Étape | Résultat |
|---|---|
| Edge functions | 27 déployées en une passe ; `verify_jwt` conforme (14 sans JWT, exactement les attendues) |
| Secrets | 12 posés + `mdh_cron_secret` dans le Vault (44 car., cohérent avec du base64 de 32 octets) |
| Schéma | 85 tables `majordhome`, 10 `core`, 93 vues `majordhome_*` — **0 erreur** sur 6664 lignes |
| Données | 13 tables comparées ligne à ligne, **0 divergence** (clients 3564, contracts 768, mailing_logs 9173) |
| Isolation | 13 schémas voisins supprimés en CASCADE, **Majord'home n'a perdu ni table ni vue** |
| Storage | 6 buckets + 23 policies (migration rejouée avec succès sur un 2ᵉ projet) |
| Crons | 4 actifs, aucun ne pointe vers l'ancien projet, secret présent |
| Comptes | 33 utilisateurs, 28 identités, 7 membres Mayer, tous avec mot de passe |

**L'isolation est démontrée.** Supprimer les cinq apps voisines ne retire aucun objet Majord'home : il n'existe pas de dépendance cachée vers `pack_vendeur`, `rag`, `arpet`, `voirie` ou les schémas vestiges.

### Trois pièges rencontrés, à connaître le jour J

1. **`pg_dump` signale des clés étrangères circulaires** (`appointments`). Un chargement de données seules échoue sans `SET session_replication_role = replica` autour de l'insertion. Les contraintes ne sont pas supprimées, seulement non vérifiées pendant le chargement.
2. **La CLI ne sait pas télécharger un bucket distant** — `supabase storage cp` ne fait que du local vers local (`LegacyStorageUnsupportedOperationError`). Le transfert des 161 fichiers (15 Mo) demandera un script utilisant les clés `service_role` des deux projets. **Seul poste non validé par la répétition.**
3. **`auth` est commun à l'instance** : le dump emporte les 33 comptes, dont 5 sans profil `core` qui appartiennent aux apps voisines. Sans conséquence fonctionnelle, mais ce sont des e-mails et des empreintes de mots de passe tiers à élaguer après bascule.

### Ce que la répétition n'a pas couvert

- Transfert du contenu des buckets (cf. piège 2)
- Bascule du frontend (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` sur Vercel)
- Les 6 critères de succès applicatifs ci-dessous, qui supposent le frontend branché

## État de la préparation

- [x] Edge functions non versionnées récupérées (`889157a`)
- [x] Buckets Storage + policies scriptés (`20260809_2`), rejoués avec succès sur un 2ᵉ projet
- [x] Inventaire des secrets (ce document)
- [x] Projet cible créé et peuplé : schéma, données, comptes, buckets, crons, 27 edge functions
- [x] Isolation démontrée (suppression des 13 schémas voisins sans perte)
- [ ] Script de transfert du contenu des buckets (161 fichiers)
- [ ] Bascule frontend + les 6 critères de succès
- [ ] Date de bascule
