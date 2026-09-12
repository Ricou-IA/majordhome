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
  **ACL par défaut** observées (`majordhome` : `anon`/`authenticated` = arwd, pas de `service_role`) —
  c'est ce qui rend testables les `REVOKE … FROM anon` et `GRANT … TO service_role` d'une migration.
- Les assertions sont des blocs `DO $$ … RAISE EXCEPTION … $$` : un écart fait échouer le run.
- `scratch/` (données, cluster, logs) est ignoré par git.
