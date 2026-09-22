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

## `assert-baseline.sql` — quand le ré-aligner

Le contrôle « sans migration » ne code **aucun compte d'activité** (équipements, certificats,
clients…) : ces chiffres bougent chaque jour en prod et ne prouvent rien, `run.mjs` ayant déjà
chargé `data.json` ligne à ligne. Il vérifie la structure (fonctions, triggers, vues +
`security_invoker`, RLS/policies, enum, colonne GENERATED, ACL), les invariants tenus par les
triggers de prod (typé ⇒ catégorie du type, code de catégorie dénormalisé) et les seuls comptes
stables : 14 types d'équipement, 7 membres d'équipe, 11 valeurs d'enum. Le `NOTICE` final
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
