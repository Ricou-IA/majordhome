# Chantier — reprendre les devis validés du pipeline — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le Kanban chantier affiche le montant des devis réellement validés dans Pennylane, avec la même définition que la carte Gagné du pipeline.

**Architecture:** Trois couches, dans cet ordre imposé. (1) Un trigger DB corrige sa sémantique : un refus explicite de Pennylane n'est plus réécrit en `accepted`. (2) L'allowlist « devis validé » est extraite dans **une fonction unique** `majordhome.quote_status_bucket()`, consommée par une vue partagée `majordhome.lead_quote_stats` que lisent `majordhome_kanban_cards` **et** `majordhome_chantiers`. (3) Le frontend chantier filtre sur le booléen `is_validated` exposé par la vue pivot, et la modale de rattachement du chantier disparaît.

**Tech Stack:** PostgreSQL (Supabase, prod partagée) · migrations SQL versionnées + MCP `apply_migration` · React 18 / TanStack Query v5 · Vite.

**Spec:** `docs/superpowers/specs/2026-07-16-chantier-devis-valides-pennylane-design.md`

---

## Cartographie des fichiers

| Fichier | Responsabilité | Action |
|---|---|---|
| `supabase/migrations/20260716_1_quote_status_bucket_and_winning_trigger.sql` | Fonction `quote_status_bucket` (définition unique des 3 seaux) + correction de la fonction du trigger | Créer |
| `supabase/migrations/20260716_2_lead_quote_stats_shared_view.sql` | Vue partagée `majordhome.lead_quote_stats` + recâblage `majordhome_kanban_cards` et `majordhome_chantiers` | Créer |
| `supabase/migrations/20260716_3_lpq_is_validated.sql` | Colonne calculée `is_validated` en fin de `majordhome_lead_pennylane_quotes` | Créer |
| `src/shared/services/pennylane.service.js:999-1010` | `getLinkedQuotesByLead` — remonter `is_validated` | Modifier |
| `src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx` | Filtrer sur `is_validated` ; retirer la modale de liaison et ses 2 points de montage | Modifier |
| `src/apps/artisan/components/chantiers/LinkPennylaneQuoteModal.jsx` | — | **Supprimer** |
| `docs/MODULE_PENNYLANE.md:13` | Documentation de l'invariant du trigger (devenue fausse) | Modifier |

**Non touchés, volontairement** : `QuoteBlock.jsx` (purement présentationnel, reçoit ses données du parent) · `chantiers.service.js::getChantierAmount` (sa cascade `linked_quotes_amount_ht → order_amount_ht → estimated_revenue` reste correcte, c'est sa 1ʳᵉ valeur qui devient juste) · `pennylane-sync-quote-status` (edge function) · le ✕ d'éjection.

---

## Effet de bord attendu — à mesurer, pas à corriger en silence

`pennylane_sync_ensure_winning_quotes` (helper du cron) repose `is_winning_quote` sur le devis `accepted` le plus récent de tout lead qui a ≥1 `accepted` et aucun gagnant. Donc après correction du trigger :

- **Lead avec un autre devis validé** (cas OBIERTI) → le flag gagnant se repose seul sur `D-2026-07302`, le chantier reste, montant réaligné. Rien à faire.
- **Lead dont le SEUL devis gagnant devient refusé** → `accepted_count = 0` : la carte quitte la colonne Gagné du pipeline, alors que `leads.status_id` et `chantier_status` restent en l'état. **Un chantier subsiste pour une vente que Pennylane dit refusée.** C'est la vérité qui remonte, pas une régression — le trigger la masquait jusqu'ici. Aujourd'hui ce cas n'existe pas (0 chantier avec devis rattachés et 0 accepté). La Task 1 le mesure et le **rapporte à Eric** ; aucune correction automatique (l'arbitrage lui appartient).

---

## Task 1 : Corriger la sémantique du trigger

**Files:**
- Create: `supabase/migrations/20260716_1_quote_status_bucket_and_winning_trigger.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- supabase/migrations/20260716_1_quote_status_bucket_and_winning_trigger.sql
-- ============================================================================
-- Bug A — le trigger réécrivait le statut canonique Pennylane.
--
-- trg_lead_pennylane_quotes_invariant_winning forçait quote_status='accepted'
-- dès que is_winning_quote=true et que le statut sortait de {accepted,invoiced}.
-- Le cron écrivait le 'refused' lu dans PL, le trigger le réécrivait en
-- 'accepted' avant écriture : la valeur stockée ne changeait jamais et le cron
-- comptait l'opération comme réussie. Échec silencieux permanent.
-- Vu sur OBIERTI JEAN MARC : D-2026-07301 refusé dans PL, stocké 'accepted'.
--
-- Sémantique retenue (validée Eric, PL fait foi) :
--   refused|denied|canceled  -> PL dit non   : le statut passe, winning := false
--   null|pending|draft|expired -> PL ne sait pas : geste commercial préservé
--   accepted|invoiced        -> validé       : inchangé
-- ============================================================================

-- 1. Définition UNIQUE des 3 seaux de statut PL.
--    Reproduit à l'identique les allowlists de majordhome_kanban_cards.
--    Le seau 'other' préserve la décision documentée : tout statut PL futur
--    (ex. 'scheduled') reste invisible tant qu'il n'est pas ajouté ici.
CREATE OR REPLACE FUNCTION majordhome.quote_status_bucket(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_status IN ('accepted', 'invoiced')          THEN 'validated'
    WHEN p_status IN ('pending', 'draft', 'expired')   THEN 'pending'
    WHEN p_status IN ('refused', 'denied', 'canceled') THEN 'refused'
    ELSE 'other'
  END;
$$;

COMMENT ON FUNCTION majordhome.quote_status_bucket(text) IS
  'Seau d''un quote_status Pennylane : validated | pending | refused | other. Definition UNIQUE de l''allowlist, consommée par majordhome.lead_quote_stats, la vue pivot et le trigger invariant_winning. Ne pas recopier l''allowlist ailleurs. NOT SECURITY DEFINER, aucun accès aux données.';

-- 2. Trigger : PL fait foi sur un refus explicite.
CREATE OR REPLACE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'majordhome', 'public'
AS $function$
BEGIN
  -- Cas 1 — le statut CHANGE vers un refus explicite : c'est Pennylane qui
  -- parle (cron), PL gagne. Le flag gagnant saute.
  -- Discriminant OLD : « la RPC pose winning sur une ligne déjà refusée »
  -- (geste commercial) présente le même NEW mais ne change pas le statut.
  IF TG_OP = 'UPDATE'
     AND NEW.quote_status IS DISTINCT FROM OLD.quote_status
     AND majordhome.quote_status_bucket(NEW.quote_status) = 'refused' THEN
    NEW.is_winning_quote := false;

  -- Cas 2 — on pose/garde winning sur un statut non validé : geste commercial
  -- préservé (PL encore pending/draft/expired, ou pas encore synchro).
  -- Le cron réaligne sur PL au passage suivant (auto-correction <= 15 min).
  ELSIF NEW.is_winning_quote = true
     AND majordhome.quote_status_bucket(NEW.quote_status) <> 'validated' THEN
    NEW.quote_status := 'accepted';
  END IF;

  RETURN NEW;
END;
$function$;
```

- [ ] **Step 2 : Appliquer la migration**

Via MCP Supabase `apply_migration` (project_id `odspcxgafcqxjzrarsqf`, name `20260716_1_quote_status_bucket_and_winning_trigger`), avec le contenu ci-dessus.

- [ ] **Step 3 : Tester le seau (fonction pure)**

```sql
SELECT majordhome.quote_status_bucket('accepted')  AS a,
       majordhome.quote_status_bucket('invoiced')  AS b,
       majordhome.quote_status_bucket('refused')   AS c,
       majordhome.quote_status_bucket('expired')   AS d,
       majordhome.quote_status_bucket(NULL)        AS e,
       majordhome.quote_status_bucket('scheduled') AS f;
```
Attendu : `validated | validated | refused | pending | other | other`.

- [ ] **Step 4 : Tester le trigger sans rien casser (transaction annulée)**

```sql
BEGIN;
-- D-2026-07301 : refusé dans PL, stocké 'accepted', is_winning_quote = true
UPDATE majordhome.lead_pennylane_quotes
   SET quote_status = 'refused'
 WHERE pennylane_quote_id = 25682468773888;

SELECT quote_label, quote_status, is_winning_quote
  FROM majordhome.lead_pennylane_quotes
 WHERE pennylane_quote_id = 25682468773888;
-- Attendu : D-2026-07301 | refused | false     (AVANT le fix : accepted | true)
ROLLBACK;
```

Vérifier ensuite que le geste commercial tient toujours :

```sql
BEGIN;
-- Poser winning sur un devis pending doit toujours forcer 'accepted'
UPDATE majordhome.lead_pennylane_quotes
   SET is_winning_quote = true
 WHERE pennylane_quote_id = (
   SELECT pennylane_quote_id FROM majordhome.lead_pennylane_quotes
    WHERE quote_status = 'pending' AND ejected_at IS NULL LIMIT 1);

SELECT quote_status, is_winning_quote FROM majordhome.lead_pennylane_quotes
 WHERE is_winning_quote = true AND quote_status = 'accepted'
   AND pennylane_quote_id = (
   SELECT pennylane_quote_id FROM majordhome.lead_pennylane_quotes
    WHERE quote_status = 'accepted' AND is_winning_quote = true LIMIT 1);
-- Attendu : au moins 1 ligne (accepted | true) → le forçage fonctionne encore
ROLLBACK;
```

- [ ] **Step 5 : Laisser le cron réaligner et vérifier OBIERTI**

Le cron `pennylane-sync-quote-status` tourne toutes les 15 min (`*/15`). Attendre un passage (`SELECT max(start_time) FROM cron.job_run_details WHERE jobid = 4;` doit avancer), puis :

```sql
SELECT quote_label, quote_amount_ht, quote_status, is_winning_quote
  FROM majordhome.lead_pennylane_quotes
 WHERE lead_id = '0852c26f-e361-4491-953b-aac598ceecdd'
 ORDER BY pennylane_quote_id;
```
Attendu, conforme à Pennylane : `D-2026-07296 | 3520 | accepted` · `D-2026-07301 | 1233 | refused | false` · `D-2026-07302 | 2197 | accepted` (dont un `is_winning_quote = true`, reposé par `pennylane_sync_ensure_winning_quotes` sur le plus récent accepté).

```sql
SELECT column_key, devis_count, total_amount
  FROM public.majordhome_kanban_cards
 WHERE lead_id = '0852c26f-e361-4491-953b-aac598ceecdd';
-- Attendu : gagne | 2 | 5717     (AVANT : gagne | 3 | 6950)
```

- [ ] **Step 6 : Mesurer l'effet de bord et le rapporter**

Chantiers dont Pennylane dit qu'aucun devis n'est validé. La vue partagée n'existe
pas encore à ce stade (Task 2) → on agrège à la main :

```sql
SELECT coalesce(l.last_name,'')||' '||coalesce(l.first_name,'') AS who,
       l.chantier_status,
       count(q.id) FILTER (WHERE q.quote_status IN ('accepted','invoiced')) AS accepted_count,
       count(q.id) AS links
  FROM majordhome.leads l
  JOIN majordhome.lead_pennylane_quotes q ON q.lead_id = l.id AND q.ejected_at IS NULL
 WHERE l.chantier_status IS NOT NULL AND l.is_deleted = false
 GROUP BY l.id, l.last_name, l.first_name, l.chantier_status
HAVING count(q.id) FILTER (WHERE q.quote_status IN ('accepted','invoiced')) = 0;
```
Attendu avant le fix : **0 ligne**. Après le passage du cron : toute ligne qui apparaît est un chantier dont PL dit que la vente est refusée. **STOP — rapporter la liste à Eric, ne rien corriger automatiquement.**

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260716_1_quote_status_bucket_and_winning_trigger.sql
git commit -m "fix(pennylane): le trigger winning n'écrase plus un refus explicite de PL

trg_lead_pennylane_quotes_invariant_winning forçait quote_status='accepted' sur
toute ligne winning dont le statut sortait de {accepted,invoiced}. Le cron
écrivait le 'refused' lu dans PL, le trigger le réécrivait avant écriture : la
valeur stockée ne bougeait jamais, et le cron comptait un update réussi.
OBIERTI : 3 devis validés en base, 2 dans Pennylane (6950 vs 5717 EUR), sur la
carte pipeline comme sur la carte chantier.

Refus explicite PL (refused/denied/canceled) -> PL gagne, is_winning_quote saute.
Statut indécis (null/pending/draft/expired) -> geste commercial préservé.
Discriminant OLD : seul un statut qui CHANGE est la voix de PL.

Allowlist extraite dans majordhome.quote_status_bucket() : définition unique,
seau 'other' pour préserver l'invisibilité documentée des statuts PL futurs.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 : Vue partagée — le chantier consomme la définition du pipeline

**Files:**
- Create: `supabase/migrations/20260716_2_lead_quote_stats_shared_view.sql`

- [ ] **Step 1 : Prendre les deux relevés AVANT (référence obligatoire)**

```sql
-- (a) Divergence chantier <-> carte Gagné
SELECT count(*) AS divergences
  FROM majordhome.leads l
  JOIN public.majordhome_chantiers ch ON ch.id = l.id
  JOIN public.majordhome_kanban_cards kc ON kc.lead_id = l.id AND kc.column_key = 'gagne'
 WHERE ROUND(ch.linked_quotes_amount_ht) IS DISTINCT FROM kc.total_amount;
-- Attendu à ce stade : 9
```

```sql
-- (b) Photo du Kanban pipeline, à comparer au Step 5 (non-régression)
SELECT column_key, count(*) AS cards, ROUND(sum(total_amount)) AS total
  FROM public.majordhome_kanban_cards GROUP BY column_key ORDER BY column_key;
```
**Conserver cette sortie** : c'est la seule référence pour prouver au Step 5 que le
recâblage du CTE n'a rien déplacé dans le pipeline.

- [ ] **Step 2 : Écrire la migration**

```sql
-- supabase/migrations/20260716_2_lead_quote_stats_shared_view.sql
-- ============================================================================
-- Bug B — le chantier ne comptait pas comme le pipeline.
--
-- majordhome_kanban_cards ne somme que les devis accepted|invoiced (accepted_sum)
-- ; majordhome_chantiers sommait TOUS les devis non éjectés, sans filtre de
-- statut. Pour le même lead : RENOU 5600 EUR côté pipeline, 21190 EUR côté
-- chantier. 9 chantiers /43 divergeaient de leur propre carte Gagné.
--
-- Steer Eric : « une carte en chantier vient forcément d'un devis marqué gagné
-- sur pipeline, c'est la suite logique, pas un traitement différent. »
--
-- Le CTE lead_quote_stats de majordhome_kanban_cards devient une vue partagée
-- que les DEUX vues consomment. L'allowlist n'existe qu'une fois, dans
-- majordhome.quote_status_bucket().
-- ============================================================================

-- 1. Vue partagée : stats devis PL par lead (source unique)
CREATE OR REPLACE VIEW majordhome.lead_quote_stats
WITH (security_invoker = true) AS
SELECT
  lpq.lead_id,
  lpq.org_id,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'pending')   AS pending_count,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'validated') AS accepted_count,
  count(*) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'refused')   AS refused_count,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'pending')   AS pending_sum,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'validated') AS accepted_sum,
  sum(lpq.quote_amount_ht) FILTER (WHERE majordhome.quote_status_bucket(lpq.quote_status) = 'refused')   AS refused_sum
FROM majordhome.lead_pennylane_quotes lpq
WHERE lpq.ejected_at IS NULL
GROUP BY lpq.lead_id, lpq.org_id;

COMMENT ON VIEW majordhome.lead_quote_stats IS
  'Stats devis Pennylane par lead (non éjectés). Source UNIQUE de la notion « devis validé », consommée par majordhome_kanban_cards (colonne Gagné) ET majordhome_chantiers (linked_quotes_amount_ht). Ne pas recopier l''agrégation ailleurs.';

-- security_invoker=true -> RLS de lead_pennylane_quotes s'applique au caller.
-- GRANT indispensable : sans lui, les vues publiques qui la lisent plantent en
-- 42501 permission denied SILENCIEUX côté edge functions.
GRANT SELECT ON majordhome.lead_quote_stats TO authenticated, service_role;

-- 2. Kanban : le CTE devient un passe-plat vers la vue partagée.
--    Les 4 branches UNION ALL sont inchangées (diff minimal, zéro risque).
CREATE OR REPLACE VIEW public.majordhome_kanban_cards
WITH (security_invoker = true) AS
 WITH lead_quote_stats AS (
         SELECT * FROM majordhome.lead_quote_stats
        ), lead_rdv AS (
         SELECT a.lead_id,
            min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.lead_id IS NOT NULL AND (a.appointment_type = ANY (ARRAY['rdv_technical'::text, 'rdv_agency'::text])) AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))
          GROUP BY a.lead_id
        )
 SELECT l.id::text || ':devis_envoye'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
    'devis_envoye'::text AS column_key,
    lqs.pending_count AS devis_count,
    round(lqs.pending_sum) AS total_amount,
    lqs.pending_count,
    lqs.accepted_count,
    lqs.refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE lqs.pending_count > 0 AND COALESCE(l.is_deleted, false) = false
UNION ALL
 SELECT l.id::text || ':gagne'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
    'gagne'::text AS column_key,
    lqs.accepted_count AS devis_count,
    round(lqs.accepted_sum) AS total_amount,
    lqs.pending_count,
    lqs.accepted_count,
    lqs.refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE lqs.accepted_count > 0 AND COALESCE(l.is_deleted, false) = false
UNION ALL
 SELECT l.id::text || ':perdu'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
    'perdu'::text AS column_key,
    lqs.refused_count AS devis_count,
    round(lqs.refused_sum) AS total_amount,
    lqs.pending_count,
    lqs.accepted_count,
    lqs.refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE lqs.refused_count > 0 AND lqs.accepted_count = 0 AND lqs.pending_count = 0 AND COALESCE(l.is_deleted, false) = false
UNION ALL
 SELECT l.id::text || ':classic'::text AS card_key,
    l.id AS lead_id,
    l.org_id,
    'lead'::text AS card_type,
        CASE s.display_order
            WHEN 1 THEN 'nouveau'::text
            WHEN 2 THEN 'contacte'::text
            WHEN 3 THEN 'rdv_planifie'::text
            WHEN 4 THEN 'devis_envoye'::text
            WHEN 5 THEN 'gagne'::text
            WHEN 6 THEN 'perdu'::text
            ELSE 'unknown'::text
        END AS column_key,
    0 AS devis_count,
    COALESCE(l.order_amount_ht, 0::numeric) AS total_amount,
    0 AS pending_count,
    0 AS accepted_count,
    0 AS refused_count,
    lr.next_rdv_date,
    COALESCE(lr.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     LEFT JOIN majordhome.statuses s ON s.id = l.status_id
     LEFT JOIN lead_rdv lr ON lr.lead_id = l.id
  WHERE COALESCE(l.is_deleted, false) = false AND NOT (EXISTS ( SELECT 1
           FROM lead_quote_stats lqs
          WHERE lqs.lead_id = l.id));

-- 3. Chantiers : linked_quotes_amount_ht = accepted_sum de la vue partagée.
--    Seule cette expression change ; nom, type (numeric) et position de la
--    colonne sont préservés -> pas de « cannot change name of view column ».
--    La vue est déjà non-updatable (is_insertable_into=NO), les écritures
--    passent par update_majordhome_lead -> aucun risque type Bloc B.
CREATE OR REPLACE VIEW public.majordhome_chantiers
WITH (security_invoker = true) AS
 SELECT l.id,
    l.org_id,
    l.first_name,
    l.last_name,
    l.company_name,
    l.email,
    l.phone,
    l.address,
    l.postal_code,
    l.city,
    l.order_amount_ht,
    l.estimated_revenue,
    l.chantier_status,
    l.equipment_order_status,
    l.materials_order_status,
    l.estimated_date,
    l.planification_date,
    l.chantier_notes,
    l.won_date,
    l.client_id,
    l.project_id,
    l.assigned_user_id,
    l.equipment_type_id,
    l.pv_reception_path,
    l.updated_at,
    l.created_at,
    pet.label AS equipment_type_label,
    pet.category AS equipment_type_category,
    i.id AS intervention_id,
    i.status AS intervention_status,
    l.pennylane_quote_id,
    COALESCE(( SELECT lqs.accepted_sum
           FROM majordhome.lead_quote_stats lqs
          WHERE lqs.lead_id = l.id), 0::numeric) AS linked_quotes_amount_ht,
    rdv.next_rdv_date,
    COALESCE(rdv.has_active_rdv, false) AS has_active_rdv
   FROM majordhome.leads l
     LEFT JOIN majordhome.pricing_equipment_types pet ON pet.id = l.equipment_type_id
     LEFT JOIN majordhome.interventions i ON i.lead_id = l.id AND i.parent_id IS NULL
     LEFT JOIN LATERAL ( SELECT min(a.scheduled_date) AS next_rdv_date,
            bool_or(true) AS has_active_rdv
           FROM majordhome.appointments a
          WHERE a.lead_id = l.id AND a.appointment_type = 'installation'::text AND (a.status <> ALL (ARRAY['cancelled'::text, 'no_show'::text]))) rdv ON true
  WHERE l.chantier_status IS NOT NULL AND l.is_deleted = false;
```

- [ ] **Step 3 : Appliquer la migration**

Via MCP Supabase `apply_migration` (name `20260716_2_lead_quote_stats_shared_view`).

- [ ] **Step 4 : Vérifier le critère de succès n°2 — zéro divergence**

```sql
SELECT count(*) AS divergences
  FROM majordhome.leads l
  JOIN public.majordhome_chantiers ch ON ch.id = l.id
  JOIN public.majordhome_kanban_cards kc ON kc.lead_id = l.id AND kc.column_key = 'gagne'
 WHERE ROUND(ch.linked_quotes_amount_ht) IS DISTINCT FROM kc.total_amount;
-- Attendu : 0     (était 9 au Step 1)
```

- [ ] **Step 5 : Vérifier la non-régression du Kanban pipeline**

```sql
SELECT column_key, count(*) AS cards, ROUND(sum(total_amount)) AS total
  FROM public.majordhome_kanban_cards GROUP BY column_key ORDER BY column_key;
```
Attendu : **identique au relevé (b) du Step 1**, à l'exception des leads réalignés par la Task 1 (OBIERTI : colonne `gagne` −1 233 €). Toute autre différence = régression du recâblage → arrêter et diagnostiquer avant d'aller plus loin.

- [ ] **Step 6 : Vérifier les totaux chantier**

```sql
SELECT chantier_status, count(*) AS n, ROUND(sum(
         COALESCE(NULLIF(linked_quotes_amount_ht,0), order_amount_ht, estimated_revenue, 0))) AS total
  FROM public.majordhome_chantiers GROUP BY chantier_status ORDER BY n DESC;
```
Attendu : `planification` ≈ **194 930 €** (était 238 749) · `commande_a_faire` ≈ **31 316 €** (était 48 982) · `realise` 8 115 · `gagne` 8 195. Écart possible sur les leads réalignés par la Task 1 (OBIERTI : −1 233 €).

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260716_2_lead_quote_stats_shared_view.sql
git commit -m "fix(chantier): le chantier consomme la définition « devis validé » du pipeline

majordhome_chantiers.linked_quotes_amount_ht sommait TOUS les devis non éjectés,
statut compris ; majordhome_kanban_cards ne somme que accepted|invoiced. Pour le
même lead : RENOU 5600 EUR en pipeline, 21190 EUR en chantier. 9 chantiers /43
divergeaient de leur propre carte Gagné, et les devis refusés apparaissaient en
blocs à réceptionner dans les Appro.

Le CTE lead_quote_stats devient la vue partagée majordhome.lead_quote_stats, lue
par les deux vues. L'allowlist n'existe qu'une fois (quote_status_bucket).
Planification 238749 -> 194930 EUR, Commande à faire 48982 -> 31316 EUR.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 : Frontend — n'afficher que les devis validés

**Files:**
- Create: `supabase/migrations/20260716_3_lpq_is_validated.sql`
- Modify: `src/shared/services/pennylane.service.js:999-1010`
- Modify: `src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx`
- Delete: `src/apps/artisan/components/chantiers/LinkPennylaneQuoteModal.jsx`

- [ ] **Step 1 : Exposer `is_validated` sur la vue pivot**

```sql
-- supabase/migrations/20260716_3_lpq_is_validated.sql
-- ============================================================================
-- Expose le booléen is_validated sur la vue pivot pour que le frontend chantier
-- filtre sans recopier l'allowlist en JS. Source : quote_status_bucket().
--
-- Colonne ajoutée EN FIN de liste (CREATE OR REPLACE VIEW ne l'autorise nulle
-- part ailleurs). Vue déjà non-updatable (is_insertable_into=NO), écritures via
-- RPC (lead_pennylane_quotes_link_client) -> aucun risque de régression.
-- ============================================================================
CREATE OR REPLACE VIEW public.majordhome_lead_pennylane_quotes
WITH (security_invoker = true) AS
 SELECT lpq.id,
    lpq.org_id,
    lpq.lead_id,
    lpq.pennylane_quote_id,
    lpq.pennylane_customer_id,
    lpq.pennylane_client_id,
    lpq.quote_amount_ht,
    lpq.quote_label,
    lpq.quote_date,
    lpq.quote_status,
    lpq.pdf_url,
    lpq.assigned_at,
    lpq.ejected_at,
    lpq.ejected_reason,
    lpq.created_at,
    lpq.is_winning_quote,
    l.last_name AS lead_last_name,
    l.first_name AS lead_first_name,
    l.status_id AS lead_status_id,
    l.client_id,
    c.client_number,
    c.last_name AS client_last_name,
    c.first_name AS client_first_name,
    c.pennylane_account_number AS client_pl_number,
    majordhome.quote_status_bucket(lpq.quote_status) = 'validated' AS is_validated
   FROM majordhome.lead_pennylane_quotes lpq
     JOIN majordhome.leads l ON l.id = lpq.lead_id
     LEFT JOIN majordhome.clients c ON c.id = l.client_id;
```

Appliquer via MCP `apply_migration` (name `20260716_3_lpq_is_validated`), puis vérifier :

```sql
SELECT quote_label, quote_status, is_validated
  FROM public.majordhome_lead_pennylane_quotes
 WHERE lead_id = '0852c26f-e361-4491-953b-aac598ceecdd'
 ORDER BY pennylane_quote_id;
-- Attendu : 07296 accepted true | 07301 refused false | 07302 accepted true
```

- [ ] **Step 2 : Remonter `is_validated` dans le service**

Dans `src/shared/services/pennylane.service.js`, fonction `getLinkedQuotesByLead` (~ligne 999), ajouter `is_validated` au `.select()` :

```javascript
async function getLinkedQuotesByLead(leadId) {
  const { data, error } = await supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_amount_ht, quote_label, quote_date, quote_status, is_winning_quote, is_validated, assigned_at, pdf_url')
    .eq('lead_id', leadId)
    .is('ejected_at', null)
    .order('quote_date', { ascending: false, nullsFirst: false })
```

Ne pas filtrer ici : la fonction rend « les devis rattachés au lead », son nom doit rester vrai. Le filtre est porté par le seul consommateur (le chantier).

- [ ] **Step 3 : Filtrer dans `ChantierReceptionSection`**

Dans `src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx`, après le `useLinkedPennylaneQuotes` (~ligne 64), dériver la liste validée et l'utiliser **partout où `linkedQuotes` était utilisé** :

```javascript
  const {
    linkedQuotes: allLinkedQuotes,
    isLoading: isLoadingLinks,
  } = useLinkedPennylaneQuotes(chantier?.id);

  // Le chantier ne reprend que les devis validés par le client dans Pennylane
  // (is_validated = quote_status_bucket() côté DB — même définition que la
  // colonne Gagné du pipeline). Les autres restent dans le pivot : on filtre à
  // l'affichage, on n'éjecte pas, pour ne pas déplacer la carte pipeline.
  const linkedQuotes = useMemo(
    () => (allLinkedQuotes || []).filter((q) => q.is_validated),
    [allLinkedQuotes]
  );
```

Le reste du composant (`linkedQuoteIds`, `enrichedByQuote`, `headerSummary`, la boucle `linkedQuotes.map`) est inchangé — il consomme déjà `linkedQuotes`.

- [ ] **Step 4 : Retirer la modale de liaison**

Toujours dans `ChantierReceptionSection.jsx` :

1. Supprimer l'import : `import { LinkPennylaneQuoteModal } from './LinkPennylaneQuoteModal';`
2. Supprimer l'état : `const [linkModalOpen, setLinkModalOpen] = useState(false);`
3. Supprimer les **deux** blocs `{linkModalOpen && (<LinkPennylaneQuoteModal ... />)}` (état non lié ~ligne 191, et fin de composant ~ligne 430).
4. Supprimer le bloc footer « Ajouter un devis / option validé » (~lignes 369-380).
5. Remplacer le bouton de l'état vide (~lignes 175-189) par un renvoi vers le pipeline :

```jsx
        <div className="text-center py-6 px-4 bg-gray-50 border border-gray-200 rounded-lg">
          <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-600">
            Aucun devis validé sur ce chantier
          </p>
          <p className="text-xs text-gray-400 mt-2 max-w-sm mx-auto">
            Le chantier reprend les devis acceptés dans Pennylane. Le rattachement
            se fait depuis le pipeline.
          </p>
        </div>
```

6. Nettoyer les imports `lucide-react` devenus inutilisés — **`Link2` et `Plus` obligatoirement** (le hook pre-commit lance `lint:errors`, un import mort = error `no-unused-vars` = commit bloqué). Vérifier aussi `AlertCircle` (encore utilisé par le bandeau `linesError`, à conserver) et `FileText` (conservé par l'état vide ci-dessus).

- [ ] **Step 5 : Supprimer le fichier mort**

```bash
git rm src/apps/artisan/components/chantiers/LinkPennylaneQuoteModal.jsx
```

`LinkPennylaneQuoteModal` n'a aucun autre caller (vérifié : seul `ChantierReceptionSection` l'importait).

- [ ] **Step 6 : Vérifier**

```bash
npm run lint:errors
npx vite build
npm run audit:dead-code
```
Attendu : lint clean · build OK · aucun nouvel orphelin signalé. Si `audit:dead-code` remonte `usePennylaneQuotes` (que seule la modale supprimée consommait), le **signaler sans le supprimer** — il appartient au domaine Pennylane, pas au chantier.

- [ ] **Step 7 : Commit**

```bash
git add src/shared/services/pennylane.service.js src/apps/artisan/components/chantiers/ChantierReceptionSection.jsx supabase/migrations/20260716_3_lpq_is_validated.sql
git commit -m "feat(chantier): la section Appro n'affiche que les devis validés

Le chantier filtre sur is_validated, exposé par la vue pivot depuis
quote_status_bucket() — pas d'allowlist recopiée en JS. Les devis refusés,
expirés ou en attente ne sont plus proposés à la réception avec leurs lignes.
Ils restent dans le pivot : on filtre à l'affichage, on n'éjecte pas, donc la
carte du pipeline ne bouge pas.

La modale « Lier / Ajouter un devis » du chantier est retirée : un seul endroit
pour rattacher un devis, le pipeline. Le ✕ d'éjection reste (seul recours quand
le cron rattache un devis au mauvais lead, ce que PL ne peut pas corriger).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 : Documentation

**Files:**
- Modify: `docs/MODULE_PENNYLANE.md:13`
- Modify: `.claude/proposed-updates.md`

- [ ] **Step 1 : Corriger l'invariant documenté**

`docs/MODULE_PENNYLANE.md` ligne 13 décrit l'ancien comportement (« poser winning sur un statut incompatible (expired/refused/pending/null) force `quote_status='accepted'` automatiquement »). Il est désormais faux pour les refus. Remplacer la phrase de l'invariant par :

```markdown
**Invariant DB (trigger `trg_lead_pennylane_quotes_invariant_winning`, révisé 2026-07-16)** : `is_winning_quote=true ⟹ quote_status ∈ {accepted, invoiced}`, mais **Pennylane a le dernier mot**. Un statut entrant qui CHANGE vers un refus explicite (`refused`/`denied`/`canceled`) passe et retire `is_winning_quote` — PL fait foi. Un statut indécis (`null`/`pending`/`draft`/`expired`) force encore `quote_status='accepted'` : le geste commercial est préservé le temps que PL rattrape. Avant la révision, le trigger réécrivait tout refus en `accepted` à chaque passage du cron → statut canonique corrompu en silence (OBIERTI, 2026-07-16). Les 3 seaux sont définis une seule fois dans `majordhome.quote_status_bucket()`.
```

- [ ] **Step 2 : Documenter la vue partagée**

Dans `docs/MODULE_PENNYLANE.md`, sous la sous-section `### DB`, ajouter :

```markdown
- `majordhome.lead_quote_stats` (vue, `security_invoker`) — stats devis PL par lead (non éjectés) : `pending_count` / `accepted_count` / `refused_count` + les sommes. **Source unique de la notion « devis validé »**, consommée par `majordhome_kanban_cards` (colonne Gagné) ET `majordhome_chantiers` (`linked_quotes_amount_ht`). L'allowlist des statuts vit dans `majordhome.quote_status_bucket(text)` → `validated | pending | refused | other`. Le seau `other` préserve l'invisibilité des statuts PL futurs (`scheduled`…). **Ne jamais recopier l'allowlist** dans une vue, une RPC ou du JS : le chantier a divergé du pipeline pendant des mois exactement comme ça (9 chantiers /43, RENOU à 21 190 € contre 5 600 €). Côté frontend, la vue pivot expose `is_validated`.
```

- [ ] **Step 3 : Proposer les entrées CLAUDE.md (sans éditer CLAUDE.md)**

Append dans `.claude/proposed-updates.md`, statut PENDING (règle impérative : rien n'entre dans CLAUDE.md sans accord explicite d'Eric) :

```markdown
## [2026-07-16] Chantier = devis validés du pipeline (définition unique)

**Statut** : PENDING
**Commit** : (voir Task 1-3 du plan 2026-07-16-chantier-devis-valides-pennylane)
**Contexte** : Le trigger `invariant_winning` réécrivait en `accepted` tout refus PL sur une ligne gagnante (échec silencieux permanent, OBIERTI 6950 vs 5717 €). Et `majordhome_chantiers` sommait tous les devis sans filtre là où le pipeline ne compte que `accepted|invoiced` (9 chantiers /43 divergents).
**Proposition** : ajouter à « Module Pennylane quote-driven → Règles qui mordent » :
> - **Une seule définition de « devis validé »** : `majordhome.quote_status_bucket()` → vue `majordhome.lead_quote_stats` → consommée par `majordhome_kanban_cards` ET `majordhome_chantiers`. Ne jamais recopier l'allowlist (vue, RPC ou JS). Le chantier ne définit rien : il reprend les devis validés du pipeline.
> - **PL a le dernier mot sur un refus** : le trigger `invariant_winning` ne force `accepted` que sur un statut indécis (`null/pending/draft/expired`) ; un refus explicite passe et retire `is_winning_quote`.

---
```

- [ ] **Step 4 : Commit**

```bash
git add docs/MODULE_PENNYLANE.md .claude/proposed-updates.md
git commit -m "docs(pennylane): invariant winning révisé + vue partagée lead_quote_stats

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Vérification finale (spec §5)

- [ ] OBIERTI : carte Gagné = 2 devis / 5 717 € · carte chantier = 5 717 €
- [ ] Requête de divergence chantier ↔ carte Gagné = **0** (était 9)
- [ ] `SELECT count(*) FROM majordhome.lead_pennylane_quotes WHERE is_winning_quote = true AND quote_status IN ('refused','denied','canceled');` = **0** (l'invariant tient, mais par PL, plus par écrasement)
- [ ] Les 9 chantiers du §3 de la spec affichent le montant de leur carte Gagné
- [ ] `npm run lint:errors` · `npx vite build` · `npm run audit:dead-code` OK
- [ ] Liste des chantiers sans devis validé (effet de bord, Task 1 Step 6) rapportée à Eric
