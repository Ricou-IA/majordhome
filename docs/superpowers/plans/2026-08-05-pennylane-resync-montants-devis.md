# Resync des montants de devis Pennylane — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resynchroniser en continu le montant / numéro / date des devis Pennylane rattachés aux leads, en traçant chaque révision dans une table d'historique qui flague les modifications survenues après un point de non-retour.

**Architecture:** L'edge function `pennylane-sync-quote-status` (cron 15 min) récupère déjà l'objet Pennylane complet mais n'en propage que `status` et `pdf_url`. On étend la RPC `pennylane_sync_update_quote_fields` à `amount_ht` / `label` / `quote_date` ; elle écrit au passage une ligne dans la nouvelle table `majordhome.lead_quote_revisions`, une ligne de timeline, et repropage `leads.order_amount_ht`. Le seuil pipeline descend de 1 000 € à 500 € HT sur ses quatre copies, avec un déploiement en deux temps.

**Tech Stack:** PostgreSQL (Supabase) · RPC SECURITY DEFINER · Deno edge functions · React 18 / Vite

**Spec :** `docs/superpowers/specs/2026-08-05-pennylane-resync-montants-devis-design.md`

---

## Contexte indispensable avant de commencer

**On travaille sur la base de PRODUCTION.** Il n'y a pas d'environnement de test.

- Toute vérification qui écrit doit être encapsulée dans `BEGIN; … ROLLBACK;` — jamais de test destructif validé.
- Les migrations s'appliquent via le MCP Supabase `apply_migration` (elles partent en prod immédiatement) **et** sont versionnées dans `supabase/migrations/`.
- Les edge functions se déploient via le MCP `deploy_edge_function`. Le fichier partagé doit être passé sous le `name` exact `../_shared/auth.ts` dans le tableau `files`, sinon le bundler ne résout pas l'import.

**Fixture de test réelle** (le cas qui a déclenché ce chantier) :

| Objet | Valeur |
|---|---|
| Lead FLECHER DOMINIQUE | `3ea42c72-8602-4072-a513-393ca465fc50` |
| Ligne `lead_pennylane_quotes` | `35682a3e-c48e-48c2-9746-28363d4f6fa1` |
| `pennylane_quote_id` | `5054580650` |
| org_id (core) | `3c68193e-783b-4aa9-bc0d-fb2ce21e99b1` |
| Montant en base (périmé) | `7096` |
| Montant Pennylane réel | `7386` |
| `won_date` du lead | `2026-04-29` (donc `modified_after_won` doit se déclencher) |

**Rappels de conventions projet :**

- Toute table `majordhome.*` : RLS activée + policy scopée `org_id` dès la création.
- Toute table lue via une vue publique : `GRANT SELECT … TO service_role` obligatoire, sinon `42501` **silencieux** côté edge function.
- Toute vue `public.majordhome_*` : `WITH (security_invoker = true)`.
- Toute RPC SECURITY DEFINER : `REVOKE … FROM PUBLIC, anon, authenticated` si elle ne dérive pas l'org d'`auth.uid()`.

---

## Structure des fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/20260805_1_lead_quote_revisions.sql` | Table d'historique + vue publique + RLS |
| `supabase/migrations/20260805_2_pennylane_sync_update_quote_fields_v2.sql` | RPC de sync étendue (le cœur) |
| `supabase/migrations/20260805_3_ensure_winning_quotes_invoiced.sql` | Fix allowlist `invoiced` |

**Modifiés :**

| Fichier | Nature du changement |
|---|---|
| `supabase/functions/pennylane-sync-quote-status/index.ts` | Câblage des 3 champs + seuil 500 |
| `supabase/functions/pennylane-backfill-quotes/index.ts` | Seuil 500 |
| `src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx` | Seuil 500 |
| `supabase/functions/pennylane-sync-cron/index.ts` | Seuil 500 (**déployé en dernier**) |
| `src/shared/services/leads.service.js` | Entrée `quote_revised` dans `ACTIVITY_CONFIG` |
| `src/apps/artisan/components/pipeline/LeadActivityTimeline.jsx` | Icône `FileText` dans `ICON_MAP` |
| `CLAUDE.md` · `docs/MODULE_PENNYLANE.md` | Documentation |

---

## Task 1 : Table d'historique des révisions

**Files:**
- Create: `supabase/migrations/20260805_1_lead_quote_revisions.sql`

- [ ] **Step 1 : Écrire la requête de vérification (elle doit échouer)**

Via le MCP Supabase `execute_sql` :

```sql
SELECT count(*) FROM majordhome.lead_quote_revisions;
```

Attendu : `ERROR: 42P01: relation "majordhome.lead_quote_revisions" does not exist`

- [ ] **Step 2 : Écrire la migration**

Créer `supabase/migrations/20260805_1_lead_quote_revisions.sql` :

```sql
-- supabase/migrations/20260805_1_lead_quote_revisions.sql
-- ============================================================================
-- Historique des révisions de devis Pennylane.
--
-- Pennylane reste canonical : un devis peut être modifié après rattachement et
-- Majord'home doit suivre. Cette table garde la trace de chaque modification de
-- CONTENU (montant / numéro / date) pour rendre l'évolution traçable, et flague
-- celles survenues après un point de non-retour (lead gagné, devis validé).
--
-- Un snapshot par révision, PAS un journal de deltas champ par champ :
-- « suivre l'évolution » doit être un simple ORDER BY detected_at.
--
-- Un simple changement de quote_status (pending -> accepted) ne crée PAS de
-- révision : c'est du cycle de vie, déjà visible par le déplacement de la carte.
--
-- Spec : docs/superpowers/specs/2026-08-05-pennylane-resync-montants-devis-design.md
-- ============================================================================

CREATE TABLE IF NOT EXISTS majordhome.lead_quote_revisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES core.organizations(id),
  lead_quote_id      uuid NOT NULL REFERENCES majordhome.lead_pennylane_quotes(id) ON DELETE CASCADE,
  lead_id            uuid NOT NULL REFERENCES majordhome.leads(id) ON DELETE CASCADE,
  pennylane_quote_id bigint NOT NULL,
  detected_at        timestamptz NOT NULL DEFAULT now(),

  -- Etat APRES modification
  amount_ht          numeric,
  quote_label        text,
  quote_date         date,
  quote_status       text,

  -- Delta (brut, sans seuil : le filtrage se fait a la requete)
  previous_amount_ht numeric,
  amount_delta       numeric,
  amount_delta_pct   numeric,

  source             text NOT NULL DEFAULT 'sync',
  anomaly_flags      text[] NOT NULL DEFAULT '{}'::text[],

  CONSTRAINT lead_quote_revisions_source_chk
    CHECK (source IN ('sync', 'initial_reconciliation'))
);

CREATE INDEX IF NOT EXISTS idx_lqr_quote    ON majordhome.lead_quote_revisions(lead_quote_id);
CREATE INDEX IF NOT EXISTS idx_lqr_lead     ON majordhome.lead_quote_revisions(lead_id);
CREATE INDEX IF NOT EXISTS idx_lqr_org_date ON majordhome.lead_quote_revisions(org_id, detected_at DESC);

-- RLS : lecture/ecriture scopees org (defense en profondeur, l'ecriture reelle
-- passe par la RPC SECURITY DEFINER de la Task 2).
ALTER TABLE majordhome.lead_quote_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_quote_revisions_org ON majordhome.lead_quote_revisions;
CREATE POLICY lead_quote_revisions_org ON majordhome.lead_quote_revisions
  FOR ALL
  USING (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid()));

-- Sans ce GRANT, les edge functions qui lisent la vue plantent en 42501 SILENCIEUX.
GRANT SELECT ON majordhome.lead_quote_revisions TO service_role;

CREATE OR REPLACE VIEW public.majordhome_lead_quote_revisions
  WITH (security_invoker = true) AS
  SELECT * FROM majordhome.lead_quote_revisions;

GRANT SELECT ON public.majordhome_lead_quote_revisions TO authenticated, service_role;

COMMENT ON TABLE majordhome.lead_quote_revisions IS
  'Historique des modifications de contenu des devis Pennylane rattaches (montant/numero/date). Ecrite par pennylane_sync_update_quote_fields. source=initial_reconciliation pour les ecarts constates au premier passage (delta reel, date de modification inconnue).';
```

- [ ] **Step 3 : Appliquer la migration**

MCP Supabase `apply_migration`, nom `20260805_1_lead_quote_revisions`, avec le contenu ci-dessus.

- [ ] **Step 4 : Re-run la vérification**

```sql
SELECT count(*) FROM majordhome.lead_quote_revisions;
```

Attendu : `0` (plus d'erreur).

Vérifier aussi le GRANT (règle multi-tenant) :

```sql
SELECT has_table_privilege('service_role', 'majordhome.lead_quote_revisions', 'SELECT') AS ok;
```

Attendu : `true`

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/20260805_1_lead_quote_revisions.sql && git commit -m "feat(pennylane): table d'historique des revisions de devis"
```

---

## Task 2 : RPC de sync étendue (le cœur)

**Files:**
- Create: `supabase/migrations/20260805_2_pennylane_sync_update_quote_fields_v2.sql`
- Reference: `supabase/migrations/20260526_12_pennylane_sync_update_quote_fields.sql` (version actuelle, 3 paramètres)

- [ ] **Step 1 : Écrire le test qui échoue**

```sql
SELECT public.pennylane_sync_update_quote_fields(
  '35682a3e-c48e-48c2-9746-28363d4f6fa1'::uuid, NULL, NULL, 7386, 'D-2026-05137', '2026-05-19'::date, 500
);
```

Attendu : `ERROR: 42883: function public.pennylane_sync_update_quote_fields(uuid, unknown, unknown, integer, unknown, date, integer) does not exist`

- [ ] **Step 2 : Écrire la migration**

Créer `supabase/migrations/20260805_2_pennylane_sync_update_quote_fields_v2.sql` :

```sql
-- supabase/migrations/20260805_2_pennylane_sync_update_quote_fields_v2.sql
-- ============================================================================
-- v2 : la RPC de sync propage aussi le CONTENU du devis (montant / numero /
-- date), pas seulement status + pdf_url.
--
-- Bug corrige : un devis modifie dans Pennylane apres rattachement gardait son
-- montant d'origine. La carte affichait une photo d'avril tout en ouvrant un PDF
-- de mai (lead FLECHER : 7096 en base, 7386 chez Pennylane).
--
-- Effets de bord voulus, tous dans cette RPC (transaction unique) :
--   1. ecriture d'une ligne lead_quote_revisions si le CONTENU change
--   2. ligne de timeline lead_activities (type 'quote_revised')
--   3. repropagation de leads.order_amount_ht si le devis touche est le plus
--      recent du lead (tie-break pennylane_quote_id DESC, meme regle qu'a
--      l'attache)
--
-- Le seuil pipeline arrive en PARAMETRE (p_pipeline_min_ht) : il vit deja en 4
-- exemplaires cote code, on n'en cree pas un 5e en base.
--
-- Spec : docs/superpowers/specs/2026-08-05-pennylane-resync-montants-devis-design.md
-- ============================================================================

-- L'ancienne signature DOIT partir : garder les deux rendrait l'appel a 3
-- arguments ambigu (les nouveaux parametres ont des DEFAULT).
DROP FUNCTION IF EXISTS public.pennylane_sync_update_quote_fields(uuid, text, text);

CREATE OR REPLACE FUNCTION public.pennylane_sync_update_quote_fields(
  p_quote_id        uuid,
  p_new_status      text,
  p_pdf_url         text,
  p_amount_ht       numeric DEFAULT NULL,
  p_label           text    DEFAULT NULL,
  p_quote_date      date    DEFAULT NULL,
  p_pipeline_min_ht numeric DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
DECLARE
  -- Marqueur historique : tout devis rattache AVANT cette date et dont on
  -- decouvre un ecart pour la premiere fois releve de la reconciliation
  -- initiale (le delta est reel, sa date de modification est inconnue).
  c_reconciliation_cutoff constant timestamptz := '2026-08-05 00:00:00+00';

  v_old            record;
  v_won_date       date;
  v_new_status     text;
  v_new_pdf        text;
  v_new_amount     numeric;
  v_new_label      text;
  v_new_date       date;
  v_content_changed boolean;
  v_any_changed     boolean;
  v_flags          text[] := '{}'::text[];
  v_source         text;
  v_delta          numeric;
  v_delta_pct      numeric;
  v_max_pl_id      bigint;
BEGIN
  SELECT * INTO v_old
  FROM majordhome.lead_pennylane_quotes
  WHERE id = p_quote_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  -- COALESCE strict : ne JAMAIS vider une valeur existante avec NULL.
  v_new_status := COALESCE(NULLIF(p_new_status, ''), v_old.quote_status);
  v_new_pdf    := COALESCE(NULLIF(p_pdf_url, ''),    v_old.pdf_url);
  v_new_amount := COALESCE(p_amount_ht,              v_old.quote_amount_ht);
  v_new_label  := COALESCE(NULLIF(p_label, ''),      v_old.quote_label);
  v_new_date   := COALESCE(p_quote_date,             v_old.quote_date);

  -- Contenu = ce qui fait l'objet d'une revision. Un simple changement de
  -- status ou de pdf_url est du cycle de vie, pas une modification de devis.
  v_content_changed :=
       v_new_amount IS DISTINCT FROM v_old.quote_amount_ht
    OR v_new_label  IS DISTINCT FROM v_old.quote_label
    OR v_new_date   IS DISTINCT FROM v_old.quote_date;

  v_any_changed := v_content_changed
    OR v_new_status IS DISTINCT FROM v_old.quote_status
    OR v_new_pdf    IS DISTINCT FROM v_old.pdf_url;

  IF NOT v_any_changed THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'no_change');
  END IF;

  UPDATE majordhome.lead_pennylane_quotes SET
    quote_status    = v_new_status,
    pdf_url         = v_new_pdf,
    quote_amount_ht = v_new_amount,
    quote_label     = v_new_label,
    quote_date      = v_new_date
  WHERE id = p_quote_id;

  IF NOT v_content_changed THEN
    RETURN jsonb_build_object('updated', true, 'revision', false);
  END IF;

  -- ---- Revision -----------------------------------------------------------
  SELECT won_date INTO v_won_date FROM majordhome.leads WHERE id = v_old.lead_id;

  IF v_won_date IS NOT NULL THEN
    v_flags := v_flags || 'modified_after_won';
  END IF;

  IF majordhome.quote_status_bucket(v_old.quote_status) = 'validated' THEN
    v_flags := v_flags || 'modified_after_validated';
  END IF;

  IF v_new_amount IS NOT NULL AND v_new_amount < p_pipeline_min_ht THEN
    v_flags := v_flags || 'below_pipeline_threshold';
  END IF;

  v_delta := v_new_amount - COALESCE(v_old.quote_amount_ht, 0);
  v_delta_pct := CASE
    WHEN COALESCE(v_old.quote_amount_ht, 0) <> 0
      THEN ROUND(v_delta / v_old.quote_amount_ht * 100, 2)
    ELSE NULL
  END;

  v_source := CASE
    WHEN v_old.assigned_at < c_reconciliation_cutoff
     AND NOT EXISTS (
       SELECT 1 FROM majordhome.lead_quote_revisions r
       WHERE r.lead_quote_id = p_quote_id
     )
    THEN 'initial_reconciliation'
    ELSE 'sync'
  END;

  INSERT INTO majordhome.lead_quote_revisions (
    org_id, lead_quote_id, lead_id, pennylane_quote_id,
    amount_ht, quote_label, quote_date, quote_status,
    previous_amount_ht, amount_delta, amount_delta_pct,
    source, anomaly_flags
  ) VALUES (
    v_old.org_id, p_quote_id, v_old.lead_id, v_old.pennylane_quote_id,
    v_new_amount, v_new_label, v_new_date, v_new_status,
    v_old.quote_amount_ht, v_delta, v_delta_pct,
    v_source, v_flags
  );

  -- ---- Timeline lead ------------------------------------------------------
  -- Pas de TO_CHAR : les separateurs de milliers dependent de lc_numeric et
  -- peuvent injecter des caracteres exotiques. ROUND()::text est neutre.
  INSERT INTO majordhome.lead_activities (
    lead_id, user_id, activity_type, description, metadata, org_id
  ) VALUES (
    v_old.lead_id,
    NULL,
    'quote_revised',
    'Devis ' || COALESCE(v_new_label, '?') || ' modifié dans Pennylane : ' ||
      ROUND(COALESCE(v_old.quote_amount_ht, 0))::text || ' € → ' ||
      ROUND(COALESCE(v_new_amount, 0))::text || ' € HT',
    jsonb_build_object(
      'source', v_source,
      'pennylane_quote_id', v_old.pennylane_quote_id,
      'previous_amount_ht', v_old.quote_amount_ht,
      'amount_ht', v_new_amount,
      'amount_delta', v_delta,
      'anomaly_flags', v_flags
    ),
    v_old.org_id
  );

  -- ---- Repropagation de leads.order_amount_ht -----------------------------
  -- Uniquement si le devis touche est le plus recent du lead. Tie-break
  -- pennylane_quote_id DESC : l'ID interne PL est strictement incremental.
  IF v_new_amount IS DISTINCT FROM v_old.quote_amount_ht THEN
    SELECT max(pennylane_quote_id) INTO v_max_pl_id
    FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = v_old.lead_id AND ejected_at IS NULL;

    IF v_max_pl_id = v_old.pennylane_quote_id THEN
      UPDATE majordhome.leads
      SET order_amount_ht = ROUND(v_new_amount),
          updated_at = now()
      WHERE id = v_old.lead_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'revision', true,
    'source', v_source,
    'amount_delta', v_delta,
    'anomaly_flags', v_flags
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric)
  TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_update_quote_fields(uuid, text, text, numeric, text, date, numeric) IS
  'Sync des champs mutables d''un devis Pennylane rattache (status, pdf_url, montant, numero, date) depuis le cron pennylane-sync-quote-status. Ecrit une revision + une ligne de timeline si le CONTENU change, et repropage leads.order_amount_ht si le devis est le plus recent. service_role only. COALESCE strict. Idempotent.';
```

- [ ] **Step 3 : Appliquer la migration**

MCP `apply_migration`, nom `20260805_2_pennylane_sync_update_quote_fields_v2`.

- [ ] **Step 4 : Vérifier sur la fixture réelle, en transaction annulée**

⚠️ **Le `ROLLBACK` final n'est pas optionnel** — c'est la base de production.

```sql
BEGIN;

SELECT public.pennylane_sync_update_quote_fields(
  '35682a3e-c48e-48c2-9746-28363d4f6fa1'::uuid,
  'invoiced', NULL, 7386, 'D-2026-05137', '2026-05-19'::date, 500
) AS rpc_result;

SELECT quote_amount_ht, quote_label, quote_date
FROM majordhome.lead_pennylane_quotes
WHERE id = '35682a3e-c48e-48c2-9746-28363d4f6fa1';

SELECT amount_delta, amount_delta_pct, source, anomaly_flags
FROM majordhome.lead_quote_revisions
WHERE lead_quote_id = '35682a3e-c48e-48c2-9746-28363d4f6fa1';

SELECT order_amount_ht FROM majordhome.leads
WHERE id = '3ea42c72-8602-4072-a513-393ca465fc50';

SELECT activity_type, description FROM majordhome.lead_activities
WHERE lead_id = '3ea42c72-8602-4072-a513-393ca465fc50' AND activity_type = 'quote_revised';

ROLLBACK;
```

Attendu :
- `rpc_result` : `{"updated": true, "revision": true, "source": "initial_reconciliation", "amount_delta": 290, …}`
- devis : `7386` · `D-2026-05137` · `2026-05-19`
- révision : delta `290`, pct `4.09`, source `initial_reconciliation`, flags contenant `modified_after_won` **et** `modified_after_validated`
- lead : `order_amount_ht = 7386`
- timeline : `Devis D-2026-05137 modifié dans Pennylane : 7096 € → 7386 € HT`

- [ ] **Step 5 : Vérifier l'idempotence (2ᵉ appel identique = no-op)**

```sql
BEGIN;
SELECT public.pennylane_sync_update_quote_fields(
  '35682a3e-c48e-48c2-9746-28363d4f6fa1'::uuid, 'invoiced', NULL, 7386, 'D-2026-05137', '2026-05-19'::date, 500);
SELECT public.pennylane_sync_update_quote_fields(
  '35682a3e-c48e-48c2-9746-28363d4f6fa1'::uuid, 'invoiced', NULL, 7386, 'D-2026-05137', '2026-05-19'::date, 500) AS second_call;
SELECT count(*) AS revisions FROM majordhome.lead_quote_revisions
WHERE lead_quote_id = '35682a3e-c48e-48c2-9746-28363d4f6fa1';
ROLLBACK;
```

Attendu : `second_call` = `{"updated": false, "reason": "no_change"}` et `revisions` = `1`.

- [ ] **Step 6 : Vérifier qu'un simple changement de statut ne crée PAS de révision**

```sql
BEGIN;
SELECT public.pennylane_sync_update_quote_fields(
  '35682a3e-c48e-48c2-9746-28363d4f6fa1'::uuid, 'accepted', NULL, NULL, NULL, NULL, 500) AS r;
SELECT count(*) AS revisions FROM majordhome.lead_quote_revisions
WHERE lead_quote_id = '35682a3e-c48e-48c2-9746-28363d4f6fa1';
ROLLBACK;
```

Attendu : `r` = `{"updated": true, "revision": false}` et `revisions` = `0`.

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260805_2_pennylane_sync_update_quote_fields_v2.sql && git commit -m "feat(pennylane): la RPC de sync propage montant/numero/date + ecrit une revision"
```

---

## Task 3 : Rendre la révision lisible dans la timeline

**Files:**
- Modify: `src/shared/services/leads.service.js:62-72`
- Modify: `src/apps/artisan/components/pipeline/LeadActivityTimeline.jsx:11-37`

Sans ça, le nouveau type `quote_revised` retombe sur la config `note` (icône bulle grise générique) : ça s'affiche, mais rien ne distingue une révision de devis d'une note écrite à la main.

- [ ] **Step 1 : Ajouter l'entrée de config**

Dans `src/shared/services/leads.service.js`, ajouter la ligne dans `ACTIVITY_CONFIG` après `email_received` :

```javascript
  email_received: { icon: 'MailOpen', color: 'bg-blue-100 text-blue-700' },
  quote_revised: { icon: 'FileText', color: 'bg-amber-100 text-amber-700' },
};
```

- [ ] **Step 2 : Ajouter l'icône au mapping**

Dans `src/apps/artisan/components/pipeline/LeadActivityTimeline.jsx`, ajouter `FileText` à l'import lucide :

```javascript
import {
  Plus,
  ArrowRight,
  MessageSquare,
  UserPlus,
  CheckCircle,
  Phone,
  Mail,
  MailOpen,
  FileText,
  Loader2,
  Send,
} from 'lucide-react';
```

puis dans `ICON_MAP` :

```javascript
const ICON_MAP = {
  Plus,
  ArrowRight,
  MessageSquare,
  UserPlus,
  CheckCircle,
  Phone,
  Mail,
  MailOpen,
  FileText,
};
```

- [ ] **Step 3 : Vérifier le build**

```bash
npx vite build
```

Attendu : build réussi, aucune nouvelle erreur.

- [ ] **Step 4 : Commit**

```bash
git add src/shared/services/leads.service.js src/apps/artisan/components/pipeline/LeadActivityTimeline.jsx && git commit -m "feat(pipeline): icone dediee pour les revisions de devis dans la timeline"
```

---

## Task 4 : Câbler l'edge function de sync

**Files:**
- Modify: `supabase/functions/pennylane-sync-quote-status/index.ts` (interfaces l.28-34 et l.54-63, constante l.86, SELECT l.278-282, bloc de sync l.386-409)

- [ ] **Step 1 : Étendre les deux interfaces**

L'interface `PennylaneQuote` (l.28-34) doit déclarer `quote_number` — c'est le champ que le chemin d'auto-attache utilise déjà en priorité (`q.quote_number || q.label`, l.612) :

```typescript
interface PennylaneQuote {
  id?: number;
  quote_number?: string;
  label?: string;
  date?: string;
  status?: string;
  currency_amount_before_tax?: number;
  public_file_url?: string;
  customer?: { id?: number };
}
```

L'interface `AttachedQuote` (l.54-63) doit porter les 3 champs à comparer :

```typescript
interface AttachedQuote {
  id: string;
  lead_id: string;
  pennylane_quote_id: number;
  pennylane_customer_id: number | null;
  quote_status: string | null;
  quote_amount_ht: number | string | null;
  quote_label: string | null;
  quote_date: string | null;
  is_winning_quote: boolean;
  pdf_url: string | null;
  assigned_at: string;
}
```

- [ ] **Step 2 : Étendre le SELECT (l.278-282)**

Remplacer la chaîne de colonnes par :

```typescript
      "id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_status, quote_amount_ht, quote_label, quote_date, is_winning_quote, pdf_url, assigned_at",
```

- [ ] **Step 3 : Descendre le seuil pipeline (l.83-86)**

```typescript
// Seuil pipeline : devis < 500€ HT = SAV/entretien hors pipeline commercial.
// Pas d'auto-attach pour ces devis (alignement constante frontend
// PIPELINE_MIN_AMOUNT_HT dans QuoteCandidatesModal).
// 2026-08-05 : descendu de 1000 à 500 (demande equipe — le SAV est sous 500).
const PIPELINE_MIN_AMOUNT_HT = 500;
```

- [ ] **Step 4 : Étendre le bloc de comparaison et l'appel RPC (l.386-409)**

Remplacer depuis `const plStatus = …` jusqu'à la fermeture du `if (statusDiffers || pdfDiffers) { … }` par :

```typescript
      const plStatus = plQuote.status ?? null;
      const plPdfUrl = plQuote.public_file_url ?? null;
      const plAmountHt = plQuote.currency_amount_before_tax ?? null;
      const plLabel = plQuote.quote_number || plQuote.label || null;
      const plQuoteDate = plQuote.date ?? null;

      const statusDiffers = plStatus && plStatus !== aq.quote_status;
      const pdfDiffers = plPdfUrl && plPdfUrl !== aq.pdf_url;
      // Comparaison numerique : quote_amount_ht revient en string depuis PostgREST.
      const amountDiffers =
        plAmountHt !== null && Number(plAmountHt) !== Number(aq.quote_amount_ht);
      const labelDiffers = plLabel && plLabel !== aq.quote_label;
      const dateDiffers = plQuoteDate && plQuoteDate !== aq.quote_date;

      if (statusDiffers || pdfDiffers || amountDiffers || labelDiffers || dateDiffers) {
        const { data: updResult, error: updErr } = await supabase.rpc(
          'pennylane_sync_update_quote_fields',
          {
            p_quote_id: aq.id,
            p_new_status: plStatus,
            p_pdf_url: plPdfUrl,
            p_amount_ht: plAmountHt,
            p_label: plLabel,
            p_quote_date: plQuoteDate,
            p_pipeline_min_ht: PIPELINE_MIN_AMOUNT_HT,
          },
        );

        if (updErr) {
          console.warn(
            `[pennylane-sync] fields update failed for quote ${aq.id}:`,
            sanitizeError(updErr, 'fields update failed'),
          );
        } else {
          updates++;
          if (updResult?.revision) {
            console.log(
              `[pennylane-sync] revision quote ${aq.pennylane_quote_id}: ` +
                `delta ${updResult.amount_delta}€ (${updResult.source}) flags=${JSON.stringify(updResult.anomaly_flags)}`,
            );
          }
        }
      }
```

- [ ] **Step 5 : Déployer**

MCP Supabase `deploy_edge_function`, slug `pennylane-sync-quote-status`, avec les deux fichiers :
`supabase/functions/pennylane-sync-quote-status/index.ts` (name `index.ts`) et `supabase/functions/_shared/auth.ts` (name **`../_shared/auth.ts`**).

- [ ] **Step 6 : Déclencher un cycle et lire les logs**

Appeler l'edge avec le `Bearer MDH_CRON_SECRET`, puis lire les logs via le MCP `get_logs` (service `edge-function`).

Attendu : des lignes `[pennylane-sync] revision quote … (initial_reconciliation)` et aucun `fields update failed`.

- [ ] **Step 7 : Vérifier la fixture en base (pour de vrai cette fois)**

```sql
SELECT quote_amount_ht, quote_label, quote_date
FROM majordhome.lead_pennylane_quotes
WHERE id = '35682a3e-c48e-48c2-9746-28363d4f6fa1';
```

Attendu : `7386` · `D-2026-05137` · `2026-05-19`

```sql
SELECT count(*) AS revisions_totales,
       count(*) FILTER (WHERE source = 'initial_reconciliation') AS reconciliation,
       count(*) FILTER (WHERE 'modified_after_won' = ANY(anomaly_flags)) AS apres_gain
FROM majordhome.lead_quote_revisions;
```

Noter les chiffres : c'est la mesure de l'ampleur réelle de la dérive. **La rapporter à Eric.**

- [ ] **Step 8 : Commit**

```bash
git add supabase/functions/pennylane-sync-quote-status/index.ts && git commit -m "feat(pennylane): le cron resynchronise montant/numero/date des devis rattaches"
```

---

## Task 5 : Fix du trou `invoiced` → chantier

**Files:**
- Create: `supabase/migrations/20260805_3_ensure_winning_quotes_invoiced.sql`

`pennylane_sync_ensure_winning_quotes` filtre sur `quote_status = 'accepted'` strictement, alors que la colonne Gagné accepte `accepted` **ou** `invoiced`. Un devis arrivant déjà facturé donne une carte en Gagné sans jamais produire de chantier.

- [ ] **Step 1 : Mesurer l'état actuel (le test qui échoue)**

```sql
WITH no_winner AS (
  SELECT DISTINCT lpq.lead_id FROM majordhome.lead_pennylane_quotes lpq
  WHERE lpq.ejected_at IS NULL AND lpq.quote_status = 'invoiced'
  EXCEPT
  SELECT DISTINCT lpq2.lead_id FROM majordhome.lead_pennylane_quotes lpq2
  WHERE lpq2.ejected_at IS NULL AND lpq2.is_winning_quote = true
)
SELECT count(*) AS invoiced_sans_gagnant,
       count(*) FILTER (WHERE l.chantier_status IS NULL) AS sans_chantier
FROM no_winner nw JOIN majordhome.leads l ON l.id = nw.lead_id
WHERE COALESCE(l.is_deleted, false) = false;
```

Attendu au 2026-08-05 : `3` / `0` (le trou est latent : ces 3 leads ont eu leur chantier par un autre chemin).

- [ ] **Step 2 : Écrire la migration**

Créer `supabase/migrations/20260805_3_ensure_winning_quotes_invoiced.sql` :

```sql
-- supabase/migrations/20260805_3_ensure_winning_quotes_invoiced.sql
-- ============================================================================
-- La RPC ne voyait que quote_status = 'accepted', alors que la colonne Gagne
-- accepte 'accepted' OU 'invoiced' (allowlist majordhome.quote_status_bucket).
-- Un devis arrivant deja facture donnait donc une carte en Gagne SANS chantier.
--
-- Latent jusqu'ici (les devis passent par 'accepted' avant d'etre factures, le
-- cron les attrape au passage), mais la descente du seuil pipeline a 500 EUR va
-- importer de l'historique DEJA FACTURE : le trou deviendrait la norme sur ce
-- lot.
--
-- Seul le SELECT change. Le reste de la RPC est identique.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pennylane_sync_ensure_winning_quotes(p_org_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'majordhome', 'public', 'core'
AS $function$
DECLARE
  v_updates int := 0;
  v_lead_id uuid;
  v_quote_pl_id bigint;
BEGIN
  FOR v_lead_id IN
    SELECT DISTINCT lpq.lead_id
    FROM majordhome.lead_pennylane_quotes lpq
    WHERE lpq.org_id = p_org_id
      AND lpq.ejected_at IS NULL
      AND majordhome.quote_status_bucket(lpq.quote_status) = 'validated'
    EXCEPT
    SELECT DISTINCT lpq2.lead_id
    FROM majordhome.lead_pennylane_quotes lpq2
    WHERE lpq2.org_id = p_org_id
      AND lpq2.ejected_at IS NULL
      AND lpq2.is_winning_quote = true
  LOOP
    SELECT pennylane_quote_id INTO v_quote_pl_id
    FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = v_lead_id
      AND org_id = p_org_id
      AND ejected_at IS NULL
      AND majordhome.quote_status_bucket(quote_status) = 'validated'
    ORDER BY pennylane_quote_id DESC
    LIMIT 1;

    IF v_quote_pl_id IS NOT NULL THEN
      BEGIN
        PERFORM public.lead_mark_won_with_quote(p_org_id, v_lead_id, v_quote_pl_id);
        v_updates := v_updates + 1;
      EXCEPTION WHEN OTHERS THEN
        -- ne pas casser le batch si un lead echoue
        RAISE WARNING 'pennylane_sync_ensure_winning_quotes: lead % ignore (%): %',
          v_lead_id, SQLSTATE, SQLERRM;
      END;
    END IF;
  END LOOP;

  RETURN v_updates;
END
$function$;
```

- [ ] **Step 3 : Appliquer la migration**

MCP `apply_migration`, nom `20260805_3_ensure_winning_quotes_invoiced`.

- [ ] **Step 4 : Vérifier en transaction annulée**

```sql
BEGIN;
SELECT public.pennylane_sync_ensure_winning_quotes('3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'::uuid) AS leads_gagnes;
SELECT count(*) AS restants FROM (
  SELECT DISTINCT lpq.lead_id FROM majordhome.lead_pennylane_quotes lpq
  WHERE lpq.ejected_at IS NULL
    AND majordhome.quote_status_bucket(lpq.quote_status) = 'validated'
  EXCEPT
  SELECT DISTINCT lpq2.lead_id FROM majordhome.lead_pennylane_quotes lpq2
  WHERE lpq2.ejected_at IS NULL AND lpq2.is_winning_quote = true
) s;
ROLLBACK;
```

Attendu : `leads_gagnes` = `3` (les 3 leads `invoiced` sans gagnant sont traités) et `restants` = `0`.

⚠️ Si `leads_gagnes` dépasse largement 3, **s'arrêter et rapporter à Eric** : ça voudrait dire que le fix déplace bien plus de leads que la mesure du Step 1 ne l'annonçait.

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/20260805_3_ensure_winning_quotes_invoiced.sql && git commit -m "fix(pennylane): les devis factures declenchent aussi le gain et le chantier"
```

---

## Task 6 : Seuil 500 € — les trois constantes de filtrage

**Files:**
- Modify: `src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx:42-45`
- Modify: `supabase/functions/pennylane-backfill-quotes/index.ts:35`
- (`pennylane-sync-quote-status` a déjà été traité en Task 4, Step 3)

Ces trois-là **filtrent** ce qu'on rattache à un lead existant. Effet progressif et réversible. La quatrième (création de leads) est traitée séparément en Task 7.

- [ ] **Step 1 : Frontend — sélecteur de rattachement**

Dans `src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx`, remplacer le bloc l.42-45 :

```javascript
// Les devis < 500€ HT sont quasi-toujours du SAV ou de l'entretien et n'ont pas
// leur place dans le pipeline commercial.
// 2026-08-05 : descendu de 1000 à 500 (demande equipe — le SAV est sous 500).
const PIPELINE_MIN_AMOUNT_HT = 500;
```

- [ ] **Step 2 : Edge backfill**

Dans `supabase/functions/pennylane-backfill-quotes/index.ts`, l.35 :

```typescript
const LEAD_THRESHOLD_HT = 500;
```

- [ ] **Step 3 : Vérifier le build frontend**

```bash
npx vite build
```

Attendu : build réussi.

- [ ] **Step 4 : Déployer l'edge backfill**

MCP `deploy_edge_function`, slug `pennylane-backfill-quotes`, avec `index.ts` et `../_shared/auth.ts`.

- [ ] **Step 5 : Commit**

```bash
git add src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx supabase/functions/pennylane-backfill-quotes/index.ts && git commit -m "feat(pennylane): seuil pipeline a 500 EUR HT sur les chemins de rattachement"
```

- [ ] **Step 6 : POINT D'ARRÊT — observer un cycle**

Attendre un cycle complet du cron (15 min), puis mesurer ce que l'élargissement a effectivement rattaché :

```sql
SELECT count(*) AS attaches_sous_1000
FROM majordhome.lead_pennylane_quotes
WHERE ejected_at IS NULL AND quote_amount_ht < 1000;
```

**Rapporter le chiffre à Eric et attendre son feu vert avant la Task 7.** C'est le point de non-retour du plan : la Task 7 crée des leads, pas seulement des rattachements.

---

## Task 7 : Seuil 500 € — création de leads (après validation d'Eric)

**Files:**
- Modify: `supabase/functions/pennylane-sync-cron/index.ts:8, 33`

⚠️ **Ne pas exécuter cette task sans le feu vert explicite d'Eric** (cf. Task 6, Step 6).

Contrairement aux trois autres, cette constante ne filtre pas : elle décide de **créer un lead** en « Devis envoyé » pour chaque client Pennylane dont le plus gros devis dépasse le seuil (l.328). Le volume n'est pas chiffrable à l'avance — aucun cache local des devis Pennylane.

- [ ] **Step 1 : Descendre la constante**

Dans `supabase/functions/pennylane-sync-cron/index.ts`, l.33 :

```typescript
const LEAD_THRESHOLD_HT = 500;
```

Et mettre à jour le commentaire d'en-tête l.8 :

```typescript
//   2. Un lead en "Devis envoyé" SI le client a un devis > 500€ HT
```

- [ ] **Step 2 : Compter les leads AVANT (pour mesurer l'effet)**

```sql
SELECT count(*) AS leads_avant FROM majordhome.leads
WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND COALESCE(is_deleted, false) = false;
```

Noter le chiffre.

- [ ] **Step 3 : Déployer**

MCP `deploy_edge_function`, slug `pennylane-sync-cron`, avec `index.ts` et `../_shared/auth.ts`.

- [ ] **Step 4 : Déclencher un cycle et mesurer**

Après un passage du cron :

```sql
SELECT count(*) AS leads_apres FROM majordhome.leads
WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND COALESCE(is_deleted, false) = false;

SELECT count(*) AS nouveaux_sans_chantier
FROM majordhome.leads l
WHERE l.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND l.external_source = 'pennylane'
  AND l.created_at > now() - interval '1 hour'
  AND l.chantier_status IS NULL;
```

Le second chiffre doit retomber à 0 au cycle suivant pour les leads dont le devis est validé — c'est le fix de la Task 5 qui opère. S'il reste bloqué au-dessus de 0 sur deux cycles, **s'arrêter et rapporter**.

- [ ] **Step 5 : Commit**

```bash
git add supabase/functions/pennylane-sync-cron/index.ts && git commit -m "feat(pennylane): seuil de creation de leads a 500 EUR HT"
```

---

## Task 8 : Documentation

**Files:**
- Modify: `CLAUDE.md:444`
- Modify: `docs/MODULE_PENNYLANE.md`

- [ ] **Step 1 : CLAUDE.md — corriger le seuil et poser l'invariant**

Remplacer la ligne 444 (`- Seuil pipeline 1000€ HT. Tie-break chrono = ...`) par :

```markdown
- Seuil pipeline **500€ HT** (2026-08-05, était 1000€). 4 copies : `QuoteCandidatesModal.jsx`, `pennylane-sync-quote-status`, `pennylane-backfill-quotes`, `pennylane-sync-cron` (⚠️ cette dernière **crée des leads**, pas seulement filtre). Tie-break chrono = `pennylane_quote_id DESC`.
- **Le montant d'un devis rattaché est resynchronisé en continu** (cron 15 min) : Pennylane est canonical, y compris pour le contenu (montant/numéro/date). Chaque modification de contenu écrit une ligne dans `majordhome.lead_quote_revisions` + une activité `quote_revised`. Corollaire assumé : pas de date de coupe stable pour les stats — un montant passé peut changer rétroactivement.
```

- [ ] **Step 2 : MODULE_PENNYLANE.md — documenter la table et le piège de l'allowlist**

Ajouter dans la section des règles :

```markdown
- **`lead_quote_revisions`** : historique des modifications de CONTENU des devis (montant/numéro/date). Un snapshot par révision. `source='initial_reconciliation'` = écart constaté au déploiement du 2026-08-05 (delta réel, date de modification inconnue). Flags : `modified_after_won`, `modified_after_validated`, `below_pipeline_threshold`. **On flague, on ne corrige jamais automatiquement.**
- **Toute RPC qui sélectionne des « devis validés » doit passer par `majordhome.quote_status_bucket(status) = 'validated'`**, jamais par `status = 'accepted'` en dur — sinon les devis arrivant directement en `invoiced` sont ignorés (carte en Gagné sans chantier, corrigé le 2026-08-05 sur `pennylane_sync_ensure_winning_quotes`).
```

- [ ] **Step 3 : Commit**

```bash
git add CLAUDE.md docs/MODULE_PENNYLANE.md && git commit -m "docs(pennylane): resync des montants, table de revisions, seuil 500 EUR"
```

---

## Vérification finale

- [ ] La carte FLECHER affiche **7 386 €** et le devis **D-2026-05137** daté du 19 mai, en accord avec le PDF qu'elle ouvre.
- [ ] `lead_quote_revisions` contient sa ligne : delta `290`, `source='initial_reconciliation'`, flags `modified_after_won` + `modified_after_validated`.
- [ ] La timeline du lead affiche la ligne de révision avec l'icône ambre.
- [ ] Aucun lead avec un devis validé ne reste sans `chantier_status` après deux cycles.
- [ ] `npx vite build` passe.
- [ ] `npm run lint:errors` passe (le hook pre-commit le vérifie de toute façon).

## Ce que ce plan ne fait pas

- Aucune correction automatique des incohérences détectées — arbitrage humain.
- Aucune éjection automatique d'un devis passé sous le seuil.
- Le seuil reste codé en dur en 4 exemplaires. `CLAUDE.md` voudrait qu'il vive dans `/settings/organization` : dette signalée, non traitée ici.
- `pennylane-sync-cron` continue de passer par `upsert_pennylane_lead` + `assign_pennylane_quote_to_lead` (qui ne gagne jamais) plutôt que par `lead_attach_quotes_and_send`. Le gain et le chantier arrivent donc au cycle suivant, jusqu'à 15 min après la création du lead.
