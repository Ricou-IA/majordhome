# Répétition locale des migrations

Cluster PostgreSQL **jetable** (binaires `initdb`/`postgres` du PATH, port 55432) alimenté par une
photographie **en lecture seule** de la prod, pour exécuter une migration et ses assertions **avant**
de la livrer. Rien n'est écrit en prod : `snapshot.mjs` n'appelle que `exec_sql` avec des `SELECT`.

```bash
# 1. Photographier la prod (DST_URL / DST_KEY = clé service_role du projet cible)
node scripts/migration-rehearsal/snapshot.mjs --env C:/Dev/Frontend-Majordhome/.env.local

# 2. Répéter une migration + vérifier
node scripts/migration-rehearsal/run.mjs \
  --migration supabase/migrations/20260913_1_referentiel_equipements_expansion.sql \
  --assert scripts/migration-rehearsal/assert-m1.sql

# Sans migration : contrôle que le cluster reflète bien la prod
node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-baseline.sql
```

- `--keep` laisse le cluster démarré (`psql -h localhost -p 55432 -U postgres rehearsal`).
- Le sous-ensemble de tables/vues/fonctions/policies est déclaré en tête de `snapshot.mjs` ;
  le DDL est régénéré depuis les catalogues (`format_type`, `pg_get_constraintdef`,
  `pg_get_functiondef`, `pg_get_viewdef`, `pg_policies`) : ce qui est répété est ce qui est en prod.
- `bootstrap-pre.sql` reproduit rôles Supabase, `auth.uid()` (lit `request.jwt.claim.sub`) et les
  **ACL par défaut** observées (`majordhome` : `authenticated` = arwd, pas de `service_role`, plus d'`anon`
  depuis `20261029_1` ; `public` : tout à `anon`/`authenticated`/`service_role`, mais `bootstrap-post.sql` retire
  `anon` des vues `majordhome_*` comme en prod) — c'est ce qui rend testables les `REVOKE … FROM anon` et
  `GRANT … TO service_role` d'une migration. Les ACL **par objet** ne sont pas photographiées : une assertion qui
  dépend d'un GRANT/REVOKE d'une migration passée doit rejouer cette migration dans la chaîne.
- Les assertions sont des blocs `DO $$ … RAISE EXCEPTION … $$` : un écart fait échouer le run.
- `scratch/` (données, cluster, logs) est ignoré par git.

## `assert-baseline.sql` — quand le ré-aligner

Le contrôle « sans migration » ne code **aucun compte d'activité** (équipements, certificats,
clients…) : ces chiffres bougent chaque jour en prod et ne prouvent rien, `run.mjs` ayant déjà
chargé `data.json` ligne à ligne. Il vérifie la structure (fonctions, triggers, vues +
`security_invoker`, RLS/policies, enum, colonne GENERATED, ACL), les invariants tenus par les
triggers de prod (typé ⇒ catégorie du type, code de catégorie dénormalisé) et les seuls comptes
stables : 14 types d'équipement, 8 membres d'équipe, 11 valeurs d'enum. Le `NOTICE` final
affiche les volumes du snapshot à titre indicatif.

Il faut l'éditer quand, et seulement quand :
- un objet entre ou sort des listes `FUNCTIONS` / `TRIGGER_TABLES` / `VIEWS` / `POLICY_TABLES`
  de `snapshot.mjs` → même changement dans le §1 ;
- un type d'équipement ou un membre d'équipe est créé/supprimé en prod → §3 (le message d'erreur
  le dit) ;
- M2 (`20260920_1`, drop de l'enum `equipment_category`) est passée en prod → retirer le contrôle
  d'enum du §1 et du bilan.

Un simple snapshot plus récent ne doit **jamais** exiger de le toucher : si c'est le cas, c'est
un compte volumétrique qui s'est glissé dedans, à retirer. Les `assert-m*.sql` / `assert-<sujet>.sql`
restent, eux, figés sur la prod du jour où la migration a été répétée (chiffres de reprise).

## Pièges vécus (2026-10-26, migrations de droits `20261028_3` / `_4`)

- Le stub `storage.objects` de `bootstrap-pre.sql` a RLS et `foldername`, donc une policy Storage se
  répète ; mais les policies Storage existantes (`20260809_2`) ne sont **pas** photographiées : une
  assertion fonctionnelle doit recréer `product_documents_org_select` si elle manque — sans SELECT policy,
  un `DELETE … WHERE` touche 0 ligne pour tout le monde (faux positif vécu).
- Un snapshot pris **après** la mise en prod d'une migration exige que ses nouvelles fonctions soient
  listées dans `FUNCTIONS` (vécu : `user_can` absente ⇒ l'assertion `20261028_3` échouait sur un snapshot
  frais). Étendre la liste, ne pas contourner.
