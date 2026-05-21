# Brief Hardening Multi-tenant — Apps voisines Supabase

> Document à transmettre aux owners des apps **Pack Vendeur** (Eric), **Baikal** (rag + legifrance), **Arpet**, **Snapstudio** qui cohabitent sur l'instance Supabase `odspcxgafcqxjzrarsqf` avec **Majord'home**.
> Préparé le 2026-05-21 par l'équipe Majord'home après hardening Sem 0 (cf. `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`).

## Contexte

L'instance Supabase `odspcxgafcqxjzrarsqf` héberge plusieurs apps multi-tenant : Majord'home (`majordhome`, `core`), Pack Vendeur (`public.pv_*`), Baikal (`rag`, `legifrance`), Arpet (`arpet`), Snapstudio (`public.snapstudio_*`). Décision actée le 2026-05-21 : **1 instance unique conservée pour raisons de coût** — pas de migration vers des instances séparées.

Côté Majord'home, un audit complet a révélé 13 CRITICAL codebase + 131 ERROR Supabase Advisor. Un sprint Sem 0 de hardening a livré en 5 jours (~95% de l'audit). **Plusieurs failles concernent aussi vos apps** car le filtre Supabase Advisor couvre toute l'instance.

Ce document liste **précisément ce qui reste à fixer dans vos apps** + le **pattern de fix éprouvé** côté Majord'home pour vous éviter la phase d'exploration.

## Charte multi-tenant unifiée

Convention partagée à respecter pour toutes les apps cohabitant sur l'instance :

1. **Toute table d'app** : RLS activée + policy scopée via `core.organization_members`
   ```sql
   ALTER TABLE myapp.my_table ENABLE ROW LEVEL SECURITY;
   CREATE POLICY my_table_org_members ON myapp.my_table
     FOR ALL TO authenticated
     USING (org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid()));
   ```

2. **Toute vue `public.*` qui expose une table d'app** : `WITH (security_invoker=true)` obligatoire — sinon la vue bypasse RLS du sous-jacent. Cf. P0.0.2 ci-dessous.

3. **Toute RPC SECURITY DEFINER exposée à `authenticated`** : check membership `auth.uid() ∈ org_members` **dans le corps** de la fonction + `SET search_path = <schema>, public, core, pg_temp` pour mitiger CVE-2018-1058.

4. **Toute RPC SECURITY DEFINER qui prend `org_id` dans son payload** (sans dériver d'`auth.uid()`) : `REVOKE EXECUTE FROM PUBLIC, anon, authenticated`, accessible seulement à `service_role`. Sinon attaquant authentifié peut forger un `org_id` arbitraire.

5. **Tout bucket Storage** : préfixe `${org_id}/...` + policies `(storage.foldername(name))[1]::uuid IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid())`.

6. **Schémas partagés (NE JAMAIS dropper)** : `core` (orgs/membership/profiles), `config` (apps/concepts), `sources` (files cross-app). Le schéma `auth` est géré par Supabase.

7. **Gotcha DROP SCHEMA** : avant tout `DROP SCHEMA xxx`, vérifier que `xxx` n'est PAS dans Dashboard → API → Exposed schemas. Sinon → 503 PostgREST sur TOUTE l'instance pour ~30 min. Cf. incident 2026-05-21.

## Findings restants par app

### Pack Vendeur (`public.pv_*`)

**3 fonctions SECURITY DEFINER avec `search_path` mutable (P0.0.10)** :
- `public.pv_documents_delete_fn()` (trigger fn)
- `public.pv_documents_insert_fn()` (trigger fn)
- `public.pv_documents_update_fn()` (trigger fn)

**Fix** :
```sql
ALTER FUNCTION public.pv_documents_delete_fn() SET search_path = public, pg_temp;
-- idem pour les 2 autres
```

**À auditer** : si vous avez des vues `public.pv_*` (non listées dans mon scan car j'ai filtré sur certains patterns), vérifier qu'elles sont en `security_invoker=true`. Sinon le partial match RLS sur les tables sous-jacentes est bypassé.

### Baikal (schémas `rag` + `legifrance`)

**2 vues SECURITY DEFINER (P0.0.3)** :
- `rag.documents_hierarchy`
- `legifrance.v_codes_stats`, `legifrance.v_recent_jobs`

**Fix** :
```sql
ALTER VIEW rag.documents_hierarchy SET (security_invoker = true);
ALTER VIEW legifrance.v_codes_stats SET (security_invoker = true);
ALTER VIEW legifrance.v_recent_jobs SET (security_invoker = true);
```

**11 fonctions SECURITY DEFINER avec `search_path` mutable (P0.0.10)** :
- `rag.cleanup_expired_gemini_caches`
- `rag.close_conversation(p_conversation_id uuid)`
- `rag.delete_conversation(p_conversation_id uuid)`
- `rag.find_or_create_conversation(p_user_id, p_org_id, p_project_id, p_app_id, p_timeout_minutes)`
- `rag.get_conversation_context(p_conversation_id, p_last_n_messages)`
- `rag.log_qa_usage(p_row_id)`
- `rag.match_documents_v12` / `v13` / `v14` (3 versions)
- `rag.resolve_all_parent_chunk_ids`
- `rag.resolve_parent_chunk_ids(p_source_file_id)`

**Fix** : pour chacune, ajouter `SET search_path = rag, public, core, pg_temp` :
```sql
ALTER FUNCTION rag.close_conversation(uuid) SET search_path = rag, public, core, pg_temp;
-- etc.
```

**Important — incident `public.exec_sql`** : depuis le 2026-05-20, `public.exec_sql(text)` est passé en `SECURITY INVOKER` (P0.0.1, fix Majord'home). Si une fonction Baikal `rag.*` ou `legifrance.*` appelait `public.exec_sql` en s'attendant à `SECURITY DEFINER`, ça ne marche plus. À auditer.

### Arpet (schéma `arpet`)

**1 vue SECURITY DEFINER (P0.0.3)** :
- `arpet.meetings_with_permissions`

**Fix** :
```sql
ALTER VIEW arpet.meetings_with_permissions SET (security_invoker = true);
```

**2 fonctions SECURITY DEFINER avec `search_path` mutable (P0.0.10)** :
- `arpet.get_meeting_stats(p_project_id)`
- `arpet.search_meeting_decisions(p_project_id, p_search_text, p_lot_reference, p_item_type, p_from_date, p_to_date, p_status, p_limit)`

**Fix** :
```sql
ALTER FUNCTION arpet.get_meeting_stats(uuid) SET search_path = arpet, public, core, pg_temp;
ALTER FUNCTION arpet.search_meeting_decisions(uuid, text, text, varchar, date, date, varchar, integer)
  SET search_path = arpet, public, core, pg_temp;
```

### Snapstudio (`public.snapstudio_*`)

**6 vues SECURITY DEFINER (P0.0.3)** :
- `public.snapstudio_assets`
- `public.snapstudio_brands`
- `public.snapstudio_events`
- `public.snapstudio_generations`
- `public.snapstudio_leads`
- (`public.snapstudio_*` autres si présentes)

**Fix** :
```sql
ALTER VIEW public.snapstudio_assets SET (security_invoker = true);
-- etc.
```

**1 fonction SECURITY DEFINER avec `search_path` mutable (P0.0.10)** :
- `public.snapstudio_increment_simulation_count(p_lead_token text)`

**Fix** :
```sql
ALTER FUNCTION public.snapstudio_increment_simulation_count(text) SET search_path = public, pg_temp;
```

### Vues / fonctions cross-app à arbitrer

Vues `public.*` qui exposent des objets de plusieurs schémas (auditer côté propriétaire) :
- `public.admin_users_stats`, `public.apps`, `public.agent_prompts` — config / monitoring partagé
- `public.code_domains`, `public.codes` — peut-être Baikal ?
- `public.documents`, `public.files` — sources ?
- `public.linktrack_*` — app `linktrack` (orphelin ? à clarifier)
- `public.organization_members`, `public.organizations`, `public.profiles` — exposition core
- `public.projects` — core ou autre ?
- `public.sync_jobs` — sources / ingestion
- `public.v_config_concepts`, `public.v_config_document_categories` — config

**Fonctions `public.*` à `search_path`-patcher** :
- `public.complete_ingestion_job(p_file_id, p_success, p_error_message, p_chunks_count)` — sources
- `public.fn_v_config_document_categories_delete/insert/update` — config (trigger view fns)
- `public.get_app_concepts(p_app_ids)` — config
- `public.keep_alive_librarian` — Baikal ?
- `public.resolve_chunk_hierarchy(p_source_file_id)` — sources

**Fonction `config.get_agent_prompt(p_agent_type, p_app_id, p_org_id)`** — partagée par toutes les apps qui pilotent un LLM, à patcher pour `SET search_path = config, public, core, pg_temp`.

**Fonction `sources.get_user_file_permissions(p_file_layer, p_file_org_id, p_file_created_by)`** — partagée par toute app qui consomme `sources.*`, à patcher.

## Marche à suivre suggérée

1. **Audit local** : pour chaque app, lister vos vues/fonctions via :
   ```sql
   -- Vues SECURITY DEFINER de votre schema
   SELECT viewname, reloptions FROM pg_views
   JOIN pg_class c ON c.relname = pg_views.viewname
   JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = pg_views.schemaname
   WHERE schemaname = '<votre_schema>'
     AND ('security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))) IS NOT TRUE;

   -- Fonctions SECURITY DEFINER sans search_path
   SELECT proname, pg_get_function_identity_arguments(oid) AS args
   FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = '<votre_schema>'
     AND prosecdef = true
     AND (proconfig IS NULL OR NOT (proconfig::text LIKE '%search_path%'));
   ```

2. **Plan de fix** : pour chaque finding, créer une migration Supabase :
   ```sql
   -- migration_xxxx_security_hardening.sql
   ALTER VIEW <schema>.<view> SET (security_invoker = true);
   ALTER FUNCTION <schema>.<func>(<args>) SET search_path = <schema>, public, core, pg_temp;
   -- ...
   ```

3. **Smoke test** : vérifier qu'aucune query frontend ne tombe en "permission denied" après le fix. Les vues `security_invoker=true` appliquent maintenant RLS du sous-jacent — si une policy manque, ça apparaîtra en `[]` (lecture vide) plutôt qu'une erreur.

4. **Si bug fonctionnel** : c'est souvent qu'il manque une policy RLS sur la table sous-jacente. Pattern de policy minimal :
   ```sql
   CREATE POLICY <table>_org_members ON <schema>.<table>
     FOR SELECT TO authenticated
     USING (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()));
   ```

5. **Cas spéciaux** : `core.organizations` avait RLS activée sans policy → deny-all → Planning Majord'home affichait 3/21 events. Fix : ajout policy `organizations_read_via_core` (SELECT via JOIN `core.organization_members`).

## Référence

- Audit complet Majord'home : `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`
- Charte + règles imposées : `CLAUDE.md` section "Multi-tenant & sécurité"
- Pattern auth edge functions : `supabase/functions/_shared/auth.ts` (helper réutilisable par toutes les apps)

## Contact

Eric Pudebat (`eric.pudebat@confer-sas.fr`) — équipe Majord'home, disponible pour aider à debug si bug post-hardening.
