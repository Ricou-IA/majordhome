# Normalisation des échéances Pennylane + matérialisation — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normaliser l'échéance de tout devis Pennylane à `date d'émission + 3 mois` par API, et matérialiser les devis dans une table jumelle qui alimente l'explorateur `/devis` sur tout l'historique.

**Architecture:** Une edge function balaie l'endpoint LISTE `/quotes` (paginé, filtré par statut), upsert chaque devis dans `majordhome.pennylane_quotes`, et repousse par `PUT /quotes/{id}` les échéances non conformes. **La règle des 3 mois vit une seule fois, en SQL** : la RPC d'upsert renvoie elle-même la liste des devis à corriger et leur échéance cible — l'edge function ne fait aucune arithmétique de dates. Livraison en deux temps : balayage en lecture seule d'abord, écritures Pennylane ensuite.

**Tech Stack:** Deno (edge functions Supabase), PostgreSQL + pg_cron, React 18 + TanStack Query v5.

**Spec source:** `docs/superpowers/specs/2026-08-07-devis-pl-deadline-et-materialisation-design.md`

---

## Faits vérifiés en amont (ne pas re-supposer)

1. **`expired` est dérivé de `deadline`** — établi par test sur D-2026-05195 le 2026-08-07. Un seul
   `PUT /quotes/{id}` avec `{ deadline }` suffit ; `update_status` est inutile.
2. **`PUT /quotes/{id}` accepte un payload partiel** ([doc](https://pennylane.readme.io/reference/updatequote)).
3. **L'endpoint LISTE `/quotes` renvoie `deadline`, `status`, `date`, `quote_number`,
   `currency_amount_before_tax`, `public_file_url`, `customer`, `created_at`, `updated_at`,
   `archived_at`** ([doc](https://pennylane.readme.io/reference/listquotes)). `limit` max 100,
   pagination par `cursor` + `has_more` + `next_cursor`. Filtre disponible sur `id`, `customer_id`,
   `status` (opérateurs `eq, not_eq, in, not_in`).
4. **Statuts filtrables documentés** : `accepted, denied, expired, invoiced, pending`. **`draft`
   n'y figure pas** alors que notre code le référence — à constater en Task 3, pas à supposer.
5. **`lead_pennylane_quotes.org_id` = org CORE** (`useAuth().organization.id`). Pas de
   `getMajordhomeOrgId()`.
6. **Le proxy n'est pas concerné** : les edge functions appellent Pennylane en direct avec
   `PENNYLANE_API_TOKEN` (le proxy n'existe que pour le frontend, qui exige un JWT user).
7. **Rate limit Pennylane V2 : 25 req / 5 s.**

## Structure de fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/20260807_1_pennylane_quotes_twin.sql` | Table jumelle + vue + RLS + grants + RPC d'upsert (porte la règle des 3 mois) |
| `supabase/functions/pennylane-quotes-sweep/index.ts` | Balayage paginé, matérialisation, normalisation des échéances |
| `supabase/migrations/20260807_2_pennylane_quotes_sweep_cron.sql` | Entrée pg_cron 5 min |
| `src/shared/services/pennylaneQuotes.service.js` | Lecture de la table jumelle (remplace le scan live) |

**Modifiés :**

| Fichier | Modification |
|---|---|
| `src/shared/hooks/usePennylane.js` | `useQuotesExplorer` lit la table jumelle ; expose `syncedAt` |
| `src/shared/services/pennylane.service.js` | Retrait de `getQuotesExplorer` (scan live devenu mort) |
| `src/apps/artisan/pages/DevisExplorer.jsx` | Bandeau de fraîcheur ; retrait du bandeau de troncature |
| `src/shared/hooks/cacheKeys.js` | Key `quotesExplorer` sans `sinceDays` |

---

### Task 1: Migration — table jumelle, vue, RPC d'upsert

**Files:**
- Create: `supabase/migrations/20260807_1_pennylane_quotes_twin.sql`

⚠️ **Instance Supabase PARTAGÉE en PRODUCTION** (Majord'home, Pack Vendeur, Baikal, Arpet cohabitent).
DDL **strictement additif**. Le seul `DROP` autorisé porte sur les objets que cette migration crée
elle-même (`DROP VIEW IF EXISTS public.majordhome_pennylane_quotes`, `DROP POLICY IF EXISTS` sur ses
propres policies). Aucun `DROP SCHEMA`, aucun `ALTER TABLE` sur une table existante.

- [ ] **Step 1: Écrire la migration**

```sql
-- 20260807_1_pennylane_quotes_twin.sql
-- Table jumelle des devis Pennylane : projection en lecture seule alimentée par
-- l'edge function pennylane-quotes-sweep. Sens strictement unique PL → MDH.
-- Spec : docs/superpowers/specs/2026-08-07-devis-pl-deadline-et-materialisation-design.md

CREATE TABLE IF NOT EXISTS majordhome.pennylane_quotes (
  org_id             uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pennylane_quote_id bigint      NOT NULL,
  quote_number       text,
  label              text,
  status             text,
  quote_date         date,        -- date d'émission PL
  deadline           date,        -- échéance PL (le champ que le job normalise)
  amount_ht          numeric,
  amount_ttc         numeric,
  pdf_url            text,
  customer_id        bigint,
  customer_name      text,
  pdf_invoice_subject text,
  archived_at        timestamptz,
  pl_created_at      timestamptz,
  pl_updated_at      timestamptz,
  missing_since      timestamptz, -- posé quand le devis disparaît du balayage
  synced_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pennylane_quote_id)
);

CREATE INDEX IF NOT EXISTS idx_pl_quotes_org_status
  ON majordhome.pennylane_quotes (org_id, status);
CREATE INDEX IF NOT EXISTS idx_pl_quotes_org_date
  ON majordhome.pennylane_quotes (org_id, quote_date DESC);

ALTER TABLE majordhome.pennylane_quotes ENABLE ROW LEVEL SECURITY;

-- Lecture au niveau membre. Aucune policy d'écriture : le job passe par une RPC
-- SECURITY DEFINER (service_role). La table est une projection, jamais éditée
-- depuis Majord'home — sinon elle diverge de Pennylane en silence.
DROP POLICY IF EXISTS plq_select ON majordhome.pennylane_quotes;
CREATE POLICY plq_select ON majordhome.pennylane_quotes
  FOR SELECT USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

-- Vue publique : miroir simple => reste lisible via PostgREST.
-- NE PAS y ajouter de JOIN/LATERAL (cf. gotcha majordhome_appointments).
DROP VIEW IF EXISTS public.majordhome_pennylane_quotes;
CREATE VIEW public.majordhome_pennylane_quotes
  WITH (security_invoker = true) AS
  SELECT org_id, pennylane_quote_id, quote_number, label, status, quote_date, deadline,
         amount_ht, amount_ttc, pdf_url, customer_id, customer_name, pdf_invoice_subject,
         archived_at, pl_created_at, pl_updated_at, missing_since, synced_at
  FROM majordhome.pennylane_quotes;

-- Sans ce GRANT, une edge function lisant la vue plante en 42501 SILENCIEUX.
GRANT SELECT ON majordhome.pennylane_quotes TO service_role;
GRANT SELECT ON public.majordhome_pennylane_quotes TO authenticated;
-- Les nouvelles vues public.* héritent des privilèges par défaut du schéma
-- (constaté le 2026-08-05 sur pennylane_quote_dismissals) : on les retire.
REVOKE ALL ON public.majordhome_pennylane_quotes FROM anon;

-- ---------------------------------------------------------------------------
-- RÈGLE MÉTIER — SOURCE UNIQUE
-- L'échéance cible d'un devis. Définie ICI et nulle part ailleurs : l'edge
-- function ne fait aucune arithmétique de dates, elle reçoit la cible calculée.
-- Postgres gère correctement les fins de mois (30/11 + 3 mois = 28 ou 29/02).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION majordhome.pl_quote_target_deadline(p_quote_date date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$ SELECT (p_quote_date + INTERVAL '3 months')::date $$;

-- ---------------------------------------------------------------------------
-- Upsert d'un lot de devis. Retourne les devis dont l'échéance doit être
-- repoussée, avec la cible — l'edge function n'a plus qu'à émettre les PUT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pennylane_quotes_upsert_batch(
  p_org_id uuid,
  p_rows   jsonb
)
RETURNS TABLE (pennylane_quote_id bigint, target_deadline date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
BEGIN
  INSERT INTO majordhome.pennylane_quotes AS q (
    org_id, pennylane_quote_id, quote_number, label, status, quote_date, deadline,
    amount_ht, amount_ttc, pdf_url, customer_id, customer_name, pdf_invoice_subject,
    archived_at, pl_created_at, pl_updated_at, missing_since, synced_at
  )
  SELECT
    p_org_id,
    (r->>'id')::bigint,
    r->>'quote_number',
    r->>'label',
    r->>'status',
    NULLIF(r->>'date','')::date,
    NULLIF(r->>'deadline','')::date,
    NULLIF(r->>'amount_ht','')::numeric,
    NULLIF(r->>'amount_ttc','')::numeric,
    r->>'pdf_url',
    NULLIF(r->>'customer_id','')::bigint,
    r->>'customer_name',
    r->>'pdf_invoice_subject',
    NULLIF(r->>'archived_at','')::timestamptz,
    NULLIF(r->>'pl_created_at','')::timestamptz,
    NULLIF(r->>'pl_updated_at','')::timestamptz,
    NULL,          -- vu dans ce balayage => plus manquant
    now()
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (org_id, pennylane_quote_id) DO UPDATE SET
    quote_number = EXCLUDED.quote_number,
    label = EXCLUDED.label,
    status = EXCLUDED.status,
    quote_date = EXCLUDED.quote_date,
    deadline = EXCLUDED.deadline,
    amount_ht = EXCLUDED.amount_ht,
    amount_ttc = EXCLUDED.amount_ttc,
    pdf_url = COALESCE(EXCLUDED.pdf_url, q.pdf_url),
    customer_id = EXCLUDED.customer_id,
    customer_name = COALESCE(EXCLUDED.customer_name, q.customer_name),
    pdf_invoice_subject = EXCLUDED.pdf_invoice_subject,
    archived_at = EXCLUDED.archived_at,
    pl_created_at = EXCLUDED.pl_created_at,
    pl_updated_at = EXCLUDED.pl_updated_at,
    missing_since = NULL,
    synced_at = now();

  RETURN QUERY
  SELECT q.pennylane_quote_id, majordhome.pl_quote_target_deadline(q.quote_date)
  FROM majordhome.pennylane_quotes q
  WHERE q.org_id = p_org_id
    AND q.pennylane_quote_id IN (
      SELECT (r->>'id')::bigint FROM jsonb_array_elements(p_rows) AS r
    )
    AND q.status IN ('pending','expired')
    AND q.quote_date IS NOT NULL
    AND q.deadline IS DISTINCT FROM majordhome.pl_quote_target_deadline(q.quote_date);
END;
$$;

-- Payload contient org_id sans le dériver d'auth.uid() => service_role UNIQUEMENT
-- (règle CLAUDE.md, cf. record_voice_memo_extraction).
REVOKE ALL ON FUNCTION public.pennylane_quotes_upsert_batch(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_quotes_upsert_batch(uuid, jsonb) TO service_role;

-- Marque les devis absents du dernier balayage complet.
CREATE OR REPLACE FUNCTION public.pennylane_quotes_mark_missing(
  p_org_id uuid,
  p_sweep_started timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE majordhome.pennylane_quotes
     SET missing_since = now()
   WHERE org_id = p_org_id
     AND synced_at < p_sweep_started
     AND missing_since IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pennylane_quotes_mark_missing(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_quotes_mark_missing(uuid, timestamptz) TO service_role;
```

- [ ] **Step 2: Appliquer**

Via le MCP Supabase (`apply_migration`, project_id `odspcxgafcqxjzrarsqf`), nom
`20260807_1_pennylane_quotes_twin`. Vérifier d'abord que `majordhome.pennylane_quotes` n'existe pas
(`SELECT to_regclass('majordhome.pennylane_quotes')` → doit valoir NULL). Si elle existe, **STOP**,
rapporter BLOCKED.

- [ ] **Step 3: Vérifier**

```sql
SELECT relrowsecurity FROM pg_class WHERE oid = 'majordhome.pennylane_quotes'::regclass;
SELECT has_table_privilege('service_role','majordhome.pennylane_quotes','SELECT') AS svc_select;
SELECT count(*) AS anon_grants FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='majordhome_pennylane_quotes' AND grantee='anon';
SELECT majordhome.pl_quote_target_deadline('2026-11-30'::date) AS fin_de_mois;
```

Attendu : `true`, `true`, `0`, et `2027-02-28` (preuve que l'arithmétique de fin de mois est correcte).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807_1_pennylane_quotes_twin.sql
git commit -m "feat(pennylane): table jumelle des devis + RPC d'upsert portant la regle 3 mois"
```

---

### Task 2: Edge function — balayage en LECTURE SEULE

**Files:**
- Create: `supabase/functions/pennylane-quotes-sweep/index.ts`

**Pourquoi en deux temps :** cette tâche déploie le balayage **sans aucune écriture vers Pennylane**.
Elle matérialise et **compte** ce qu'il faudrait normaliser, sans le faire. On observe un vrai passage
en production avant d'autoriser la moindre écriture sur des documents clients. Task 4 activera les
`PUT`.

- [ ] **Step 1: Écrire la fonction**

```typescript
// supabase/functions/pennylane-quotes-sweep/index.ts
// Balayage des devis Pennylane : matérialise la table jumelle et normalise les
// échéances (deadline = date d'émission + 3 mois).
//
// La règle des 3 mois n'est PAS ici : elle vit dans
// majordhome.pl_quote_target_deadline(). La RPC d'upsert renvoie les devis à
// corriger et leur cible — cette fonction ne fait aucune arithmétique de dates.
//
// Auth : verify_jwt:false — protégée par MDH_CRON_SECRET (pattern P0.2).
// Spec : docs/superpowers/specs/2026-08-07-devis-pl-deadline-et-materialisation-design.md

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  requireSharedSecret,
  jsonResponse,
  getAdminClient,
  sanitizeError,
  buildCorsHeaders,
} from "../_shared/auth.ts";

const PENNYLANE_BASE_URL = "https://app.pennylane.com/api/external/v2";

// Statuts balayés. `denied` est exclu : un devis refusé n'a pas à être
// matérialisé ni normalisé. `draft` n'est pas dans l'énumération filtrable
// documentée par Pennylane — cf. Task 3, à constater avant de l'ajouter.
const SWEEP_STATUSES = ["pending", "expired", "accepted", "invoiced"];

const PAGE_LIMIT = 100;
const MAX_PAGES = 200;          // garde-fou : 20 000 devis
const UPSERT_CHUNK = 200;

interface PennylaneQuoteListItem {
  id: number;
  quote_number?: string;
  label?: string;
  status?: string;
  date?: string;
  deadline?: string;
  currency_amount_before_tax?: number;
  amount?: number;
  currency_amount?: number;
  public_file_url?: string;
  pdf_invoice_subject?: string;
  archived_at?: string;
  created_at?: string;
  updated_at?: string;
  customer?: { id?: number; name?: string; first_name?: string; last_name?: string };
}

function formatCustomerName(c?: PennylaneQuoteListItem["customer"]): string | null {
  if (!c) return null;
  if (c.name) return c.name;
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || null;
}

async function callPennylane(
  path: string,
  apiToken: string,
  init?: RequestInit,
): Promise<{ status: number; data: unknown }> {
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${PENNYLANE_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  }
  return { status: 599, data: null };
}

async function sweepOrg(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  apiToken: string,
  applyDeadlines: boolean,
) {
  const sweepStarted = new Date().toISOString();
  const filter = encodeURIComponent(
    JSON.stringify([{ field: "status", operator: "in", value: SWEEP_STATUSES }]),
  );

  let cursor: string | null = null;
  let pages = 0;
  let scanned = 0;
  let truncated = false;
  const toNormalize: { id: number; target: string }[] = [];
  const statusSeen = new Set<string>();

  while (pages < MAX_PAGES) {
    let path = `/quotes?limit=${PAGE_LIMIT}&filter=${filter}`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;

    const { status, data } = await callPennylane(path, apiToken);
    if (status !== 200) {
      throw new Error(`GET /quotes a renvoye ${status}`);
    }
    const payload = data as { items?: PennylaneQuoteListItem[]; has_more?: boolean; next_cursor?: string };
    const items = payload?.items ?? [];
    scanned += items.length;
    pages++;

    for (const q of items) if (q.status) statusSeen.add(q.status);

    // Upsert par tranches
    for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
      const chunk = items.slice(i, i + UPSERT_CHUNK).map((q) => ({
        id: q.id,
        quote_number: q.quote_number ?? q.label ?? null,
        label: q.label ?? null,
        status: q.status ?? null,
        date: q.date ?? null,
        deadline: q.deadline ?? null,
        amount_ht: q.currency_amount_before_tax ?? null,
        amount_ttc: q.amount ?? q.currency_amount ?? null,
        pdf_url: q.public_file_url ?? null,
        customer_id: q.customer?.id ?? null,
        customer_name: formatCustomerName(q.customer),
        pdf_invoice_subject: q.pdf_invoice_subject ?? null,
        archived_at: q.archived_at ?? null,
        pl_created_at: q.created_at ?? null,
        pl_updated_at: q.updated_at ?? null,
      }));

      const { data: rows, error } = await supabase.rpc("pennylane_quotes_upsert_batch", {
        p_org_id: orgId,
        p_rows: chunk,
      });
      if (error) throw error;

      for (const r of (rows ?? []) as { pennylane_quote_id: number; target_deadline: string }[]) {
        toNormalize.push({ id: r.pennylane_quote_id, target: r.target_deadline });
      }
    }

    if (!payload?.has_more || !payload?.next_cursor) break;
    cursor = payload.next_cursor;
    if (pages >= MAX_PAGES) truncated = true;
  }

  // Devis absents de ce balayage
  const { data: missing, error: missErr } = await supabase.rpc("pennylane_quotes_mark_missing", {
    p_org_id: orgId,
    p_sweep_started: sweepStarted,
  });
  if (missErr) throw missErr;

  return {
    scanned,
    pages,
    truncated,
    statuses_seen: [...statusSeen],
    to_normalize: toNormalize.length,
    normalized: 0,          // Task 4
    normalize_errors: 0,    // Task 4
    marked_missing: missing ?? 0,
    apply_deadlines: applyDeadlines,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  const authError = requireSharedSecret(
    req,
    Deno.env.get("MDH_CRON_SECRET") || "",
    "MDH_CRON_SECRET",
  );
  if (authError) return authError;

  const apiToken = Deno.env.get("PENNYLANE_API_TOKEN") || "";
  if (!apiToken) {
    return jsonResponse({ success: false, error: "PENNYLANE_API_TOKEN not configured" }, 500, req);
  }

  // Interrupteur d'écriture. Tant qu'il est absent/false, la fonction ne touche
  // PAS aux devis Pennylane : elle matérialise et compte seulement.
  const applyDeadlines = Deno.env.get("PL_APPLY_DEADLINES") === "true";

  const supabase = getAdminClient();

  try {
    const { data: orgs, error: orgsErr } = await supabase
      .schema("core")
      .from("organizations")
      .select("id, settings");
    if (orgsErr) throw orgsErr;

    const plOrgs = (orgs ?? []).filter((org) => {
      const pl = (org.settings as Record<string, unknown>)?.pennylane as { enabled?: boolean } | undefined;
      return pl?.enabled === true;
    });

    const results: Record<string, unknown>[] = [];
    for (const org of plOrgs) {
      try {
        results.push({ org_id: org.id, ...(await sweepOrg(supabase, org.id, apiToken, applyDeadlines)) });
      } catch (e) {
        results.push({ org_id: org.id, error: sanitizeError(e, "sweep failed") });
      }
    }

    return jsonResponse({ success: true, orgs: results }, 200, req);
  } catch (e) {
    return jsonResponse({ success: false, error: sanitizeError(e, "sweep failed") }, 500, req);
  }
});
```

- [ ] **Step 2: Déclarer `verify_jwt`**

Ajouter dans `supabase/config.toml`, à la suite des autres entrées :

```toml
[functions.pennylane-quotes-sweep]
verify_jwt = false
```

- [ ] **Step 3: Déployer**

Via le MCP Supabase (`deploy_edge_function`, project_id `odspcxgafcqxjzrarsqf`). Le tableau `files`
doit inclure `../_shared/auth.ts` sous ce nom exact pour que le bundler résolve l'import.

**Ne pas** définir `PL_APPLY_DEADLINES` : l'absence de la variable vaut lecture seule.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/pennylane-quotes-sweep/index.ts supabase/config.toml
git commit -m "feat(pennylane): balayage des devis en lecture seule + materialisation"
```

---

### Task 3: Premier passage observé — mesure avant écriture

**Files:** aucun (tâche d'observation)

Cette tâche répond aux deux inconnues de la spec et **conditionne la suite**.

- [ ] **Step 1: Déclencher un passage manuel**

```bash
curl -s -X POST "https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/pennylane-quotes-sweep" \
  -H "Authorization: Bearer $MDH_CRON_SECRET" -H "Content-Type: application/json" -d '{}'
```

Le secret est dans les env vars de la fonction ; le récupérer auprès d'Eric plutôt que de le
chercher dans le dépôt. À défaut, déclencher depuis le dashboard Supabase.

- [ ] **Step 2: Relever la réponse**

Noter `scanned`, `pages`, `truncated`, `statuses_seen`, `to_normalize`, `marked_missing`.

- [ ] **Step 3: Vérifier en base**

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE deadline IS NULL) AS sans_deadline,
       min(quote_date) AS plus_ancien,
       max(synced_at)  AS derniere_synchro
FROM majordhome.pennylane_quotes;

SELECT status, count(*) FROM majordhome.pennylane_quotes GROUP BY status ORDER BY 2 DESC;

SELECT count(*) AS a_normaliser
FROM majordhome.pennylane_quotes
WHERE status IN ('pending','expired')
  AND quote_date IS NOT NULL
  AND deadline IS DISTINCT FROM majordhome.pl_quote_target_deadline(quote_date);
```

- [ ] **Step 4: Trancher les deux inconnues et RAPPORTER**

1. **`draft` apparaît-il dans `statuses_seen` ?** S'il apparaît alors qu'il n'est pas dans le filtre,
   c'est que le filtre ne mord pas comme prévu — le signaler. S'il n'apparaît nulle part, la question
   est close.
2. **`truncated` vaut-il `true` ?** Si oui, `MAX_PAGES` est trop bas pour l'historique réel : le
   remonter et refaire un passage.

**Ne pas passer à la Task 4 sans avoir rapporté ces chiffres à Eric.** Le nombre `a_normaliser` est
le volume exact d'écritures que la Task 4 émettra sur des documents clients réels.

---

### Task 4: Activer la normalisation des échéances

**Files:**
- Modify: `supabase/functions/pennylane-quotes-sweep/index.ts`

⚠️ **Cette tâche fait écrire dans Pennylane.** Elle ne démarre qu'après le rapport de la Task 3.

- [ ] **Step 1: Ajouter l'émission des PUT**

Dans `sweepOrg`, remplacer le bloc de retour par le code suivant (le reste de la fonction est
inchangé) :

```typescript
  // --- Normalisation des échéances -----------------------------------------
  // Un seul PUT par devis : le statut `expired` est DÉRIVÉ de `deadline` côté
  // Pennylane (établi par test le 2026-08-07), il se recalcule seul. Ne PAS
  // appeler /update_status.
  let normalized = 0;
  let normalizeErrors = 0;

  if (applyDeadlines && toNormalize.length > 0) {
    // Rate limit PL V2 = 25 req / 5 s → 5 en vol maximum.
    const CONCURRENCY = 5;
    for (let i = 0; i < toNormalize.length; i += CONCURRENCY) {
      const batch = toNormalize.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async ({ id, target }) => {
        try {
          const { status } = await callPennylane(`/quotes/${id}`, apiToken, {
            method: "PUT",
            body: JSON.stringify({ deadline: target }),
          });
          if (status >= 200 && status < 300) normalized++;
          else normalizeErrors++;
        } catch {
          normalizeErrors++;
        }
      }));
    }
  }

  const { data: missing, error: missErr } = await supabase.rpc("pennylane_quotes_mark_missing", {
    p_org_id: orgId,
    p_sweep_started: sweepStarted,
  });
  if (missErr) throw missErr;

  return {
    scanned,
    pages,
    truncated,
    statuses_seen: [...statusSeen],
    to_normalize: toNormalize.length,
    normalized,
    normalize_errors: normalizeErrors,
    marked_missing: missing ?? 0,
    apply_deadlines: applyDeadlines,
  };
```

Supprimer l'ancien bloc `mark_missing` + `return` qui se trouvait à la fin de `sweepOrg` (il est
repris ci-dessus) pour éviter un double appel.

- [ ] **Step 2: Redéployer**

Via MCP `deploy_edge_function`, en incluant `../_shared/auth.ts`.

- [ ] **Step 3: Activer l'interrupteur**

Poser la variable d'environnement `PL_APPLY_DEADLINES = true` sur la fonction (dashboard Supabase →
Edge Functions → Secrets). **Demander confirmation à Eric avant** : c'est le moment où des documents
clients commencent à être modifiés.

- [ ] **Step 4: Déclencher un passage et vérifier la convergence**

Relancer le `curl` de la Task 3 **deux fois de suite**.

- 1ᵉʳ passage : `normalized` ≈ la valeur `to_normalize` mesurée en Task 3.
- 2ᵉ passage : `to_normalize` doit être **proche de zéro**.

C'est la preuve que la règle est idempotente. Si le second passage renvoie le même nombre que le
premier, **STOP** : le `PUT` ne prend pas, ou la cible calculée diverge de ce que Pennylane
enregistre. Rapporter sans insister.

- [ ] **Step 5: Vérifier l'effet métier**

```sql
SELECT status, count(*), round(sum(amount_ht)) AS montant_ht
FROM majordhome.pennylane_quotes
WHERE status IN ('pending','expired')
GROUP BY status;
```

Attendu : la population `expired` s'est fortement réduite (les devis émis il y a moins de 3 mois
sont repassés en `pending`), et ce qui reste `expired` a plus de 3 mois d'ancienneté.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/pennylane-quotes-sweep/index.ts
git commit -m "feat(pennylane): normalisation des echeances a emission + 3 mois"
```

---

### Task 5: Planification pg_cron

**Files:**
- Create: `supabase/migrations/20260807_2_pennylane_quotes_sweep_cron.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 20260807_2_pennylane_quotes_sweep_cron.sql
-- Planifie pennylane-quotes-sweep toutes les 5 min (même pattern que
-- geocode-sweep / mailing-scheduler : secret lu depuis vault).
--
-- Fréquence : ~15 appels API par passage (liste paginée) contre 360 pour le
-- GET unitaire de pennylane-sync-quote-status — d'où la cible 5 min.

SELECT cron.schedule(
  'pennylane-quotes-sweep',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/pennylane-quotes-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mdh_cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
```

- [ ] **Step 2: Appliquer et VÉRIFIER que le job existe**

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'pennylane-quotes-sweep';
```

Attendu : une ligne, `*/5 * * * *`, `active = true`.

**Cette vérification n'est pas décorative** : sur ce projet, un cron documenté « toutes les 15
minutes » est resté deux jours sans entrée `cron.job` réelle. Une edge function décrite comme un
cron n'est pas un cron.

- [ ] **Step 3: Confirmer une exécution réelle**

Attendre 6 minutes puis :

```sql
SELECT status, start_time FROM cron.job_run_details r
  JOIN cron.job j ON j.jobid = r.jobid
 WHERE j.jobname = 'pennylane-quotes-sweep'
 ORDER BY start_time DESC LIMIT 3;

SELECT max(synced_at) FROM majordhome.pennylane_quotes;
```

`cron.job_run_details` dit « succeeded » dès que `net.http_post` est **émis**, pas quand le travail
aboutit — c'est `max(synced_at)` qui prouve que la fonction a réellement tourné.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807_2_pennylane_quotes_sweep_cron.sql
git commit -m "feat(pennylane): planification du balayage des devis toutes les 5 min"
```

---

### Task 6: Service de lecture de la table jumelle

**Files:**
- Create: `src/shared/services/pennylaneQuotes.service.js`

- [ ] **Step 1: Écrire le service**

```javascript
/**
 * pennylaneQuotes.service.js — lecture de la table jumelle des devis Pennylane
 * ============================================================================
 * Projection alimentée par l'edge function pennylane-quotes-sweep. Lecture
 * seule : on n'écrit JAMAIS dans cette table depuis Majord'home, sinon elle
 * diverge de Pennylane en silence.
 *
 * ⚠️ orgId = org CORE (useAuth().organization.id).
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

const VIEW = 'majordhome_pennylane_quotes';

/**
 * Tous les devis matérialisés de l'org, sur tout l'historique, plus leurs
 * rattachements et leurs écartements — c'est-à-dire tout ce que
 * `buildExplorerRows` attend en entrée.
 * Le filtrage métier (seuil, statuts, vues) reste dans le module pur
 * src/lib/quotesExplorer.js — ce service ne fait que de l'I/O.
 *
 * @param {string} orgId
 * @returns {Promise<{ rows: Array, linkByQuoteId: Map, dismissedIds: Set, syncedAt: string|null }>}
 */
export const pennylaneQuotesService = {
  async getAll(orgId) {
    return withErrorHandling(async () => {
      if (!orgId) {
        return { rows: [], linkByQuoteId: new Map(), dismissedIds: new Set(), syncedAt: null };
      }

      const { data, error } = await supabase
        .from(VIEW)
        .select('pennylane_quote_id, quote_number, label, status, quote_date, deadline, amount_ht, amount_ttc, pdf_url, customer_id, customer_name, pdf_invoice_subject, synced_at')
        .eq('org_id', orgId)
        .is('missing_since', null)
        .order('quote_date', { ascending: false });

      if (error) throw error;

      // Rattachements actifs. ⚠️ `throw` obligatoire sur l'erreur : un SELECT
      // avalé ferait apparaître TOUS les devis comme orphelins, donc une
      // campagne de rattachement sur des devis déjà rattachés.
      const { data: links, error: linksError } = await supabase
        .from('majordhome_lead_pennylane_quotes')
        .select('pennylane_quote_id, lead_id')
        .eq('org_id', orgId)
        .is('ejected_at', null);
      if (linksError) throw linksError;

      const linkByQuoteId = new Map();
      for (const l of links || []) {
        linkByQuoteId.set(Number(l.pennylane_quote_id), { lead_id: l.lead_id, lead_name: null });
      }

      // Noms des leads rattachés (1 requête, pas N)
      const leadIds = [...new Set([...linkByQuoteId.values()].map(v => v.lead_id).filter(Boolean))];
      if (leadIds.length > 0) {
        const { data: leads, error: leadsError } = await supabase
          .from('majordhome_leads')
          .select('id, first_name, last_name')
          .in('id', leadIds);
        if (leadsError) throw leadsError;

        const nameById = new Map(
          (leads || []).map(l => [l.id, [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || null]),
        );
        for (const v of linkByQuoteId.values()) {
          v.lead_name = nameById.get(v.lead_id) || null;
        }
      }

      // Écartements
      const { data: dismissals, error: dismissalsError } = await supabase
        .from('majordhome_pennylane_quote_dismissals')
        .select('pennylane_quote_id')
        .eq('org_id', orgId);
      if (dismissalsError) throw dismissalsError;

      const dismissedIds = new Set((dismissals || []).map(d => Number(d.pennylane_quote_id)));

      const rows = (data || []).map(r => ({
        id: Number(r.pennylane_quote_id),
        quote_number: r.quote_number,
        label: r.label,
        subject: r.pdf_invoice_subject,
        date: r.quote_date,
        deadline: r.deadline,
        amount_ht: r.amount_ht,
        amount_ttc: r.amount_ttc,
        status: r.status,
        pdf_url: r.pdf_url,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
      }));

      // Fraîcheur de la projection : la page DOIT l'afficher (cf. spec §9).
      const syncedAt = (data || []).reduce(
        (max, r) => (!max || r.synced_at > max ? r.synced_at : max),
        null,
      );

      return { rows, linkByQuoteId, dismissedIds, syncedAt };
    }, 'pennylaneQuotes.getAll');
  },
};

export default pennylaneQuotesService;
```

- [ ] **Step 2: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/services/pennylaneQuotes.service.js
git commit -m "feat(devis): service de lecture de la table jumelle"
```

---

### Task 7: Bascule du hook + bandeau de fraîcheur

**Files:**
- Modify: `src/shared/hooks/usePennylane.js` (`useQuotesExplorer`)
- Modify: `src/shared/hooks/cacheKeys.js` (`quotesExplorer`)
- Modify: `src/apps/artisan/pages/DevisExplorer.jsx`
- Modify: `src/shared/services/pennylane.service.js` (retrait de `getQuotesExplorer`)

- [ ] **Step 1: Cache key sans fenêtre**

Dans `cacheKeys.js`, remplacer la key `quotesExplorer` par :

```javascript
  // Explorateur : plus de fenêtre temporelle, la table jumelle porte tout
  // l'historique. Compteur KPI Dashboard ET page /devis partagent CETTE key.
  quotesExplorer: (orgId) => [...pennylaneKeys.all(orgId), 'quotes-explorer'],
```

- [ ] **Step 2: Réécrire `useQuotesExplorer`**

Dans `usePennylane.js`, remplacer le corps du hook (la signature publique ne change pas, hormis
`sinceDays` qui disparaît et `syncedAt` qui apparaît) :

```javascript
/**
 * Explorateur de devis PL : source UNIQUE du compteur KPI Dashboard et de la
 * page /devis. Lit la table jumelle (alimentée toutes les 5 min par l'edge
 * pennylane-quotes-sweep), plus Pennylane en direct.
 *
 * `syncedAt` DOIT être affiché par la page : sans lui, un cron arrêté fait
 * afficher des données périmées avec assurance (cf. spec §9).
 */
export function useQuotesExplorer({ enabled = true } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: pennylaneKeys.quotesExplorer(orgId),
    queryFn: async () => {
      const { data, error } = await pennylaneQuotesService.getAll(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && enabled,
    staleTime: 60_000,
  });

  const rawRows = query.data?.rows || [];

  const rows = useMemo(
    () => buildExplorerRows({
      quotes: rawRows,
      linkByQuoteId: query.data?.linkByQuoteId || new Map(),
      dismissedIds: query.data?.dismissedIds || new Set(),
      minAmountHt: PIPELINE_MIN_AMOUNT_HT,
      sinceDays: Number.POSITIVE_INFINITY,
    }),
    [rawRows, query.data],
  );

  return {
    rows,
    orphanCount: filterExplorerRows(rows, EXPLORER_VIEWS.ORPHANS).length,
    syncedAt: query.data?.syncedAt || null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
```

⚠️ **Vérifier que `useMemo` est importé** en tête de `usePennylane.js` — le fichier n'utilise
aujourd'hui que les hooks de React Query. L'ajouter à l'import `react` si absent.

`sinceDays: Number.POSITIVE_INFINITY` neutralise le filtre temporel du module pur sans le modifier :
`cutoffMs` devient `-Infinity`, donc aucune ligne n'est écartée sur la date. Les 12 tests existants
restent verts.

- [ ] **Step 3: Bandeau de fraîcheur dans la page**

Dans `DevisExplorer.jsx`, récupérer `syncedAt` du hook, supprimer le bloc `truncated` (il n'a plus
d'objet) et insérer à sa place :

```jsx
      {syncedAt && (
        <p className="text-xs text-gray-400">
          Dernière synchronisation {formatRelativeFR(syncedAt)}
        </p>
      )}
      {syncedAt && (Date.now() - new Date(syncedAt).getTime()) > 60 * 60 * 1000 && (
        <div className="p-3 rounded-lg bg-amber-50 text-amber-800 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          Les devis affichés datent de plus d&apos;une heure — la synchronisation
          Pennylane est peut-être arrêtée.
        </div>
      )}
```

Importer `formatRelativeFR` depuis `@/lib/utils`. Retirer `truncated` et `scanned` du destructuring
du hook.

- [ ] **Step 4: Retirer le scan live devenu mort**

Supprimer `getQuotesExplorer` de `pennylane.service.js` (fonction + ligne d'export) ainsi que les
imports devenus inutiles (`buildExplorerRows`, `PIPELINE_MIN_AMOUNT_HT` s'ils n'ont plus d'autre
usage dans ce fichier — **vérifier avant de retirer**). `getUnlinkedQuotes` reste : il sert
`QuoteCandidatesModal`.

- [ ] **Step 5: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && node --test scripts/quotes-explorer.test.mjs && npm run lint:errors && npx vite build 2>&1 | tail -3
```

Attendu : 12 tests OK, 0 erreur, build OK.

```bash
grep -rn "getQuotesExplorer" src/
```

Attendu : aucun résultat.

- [ ] **Step 6: Commit**

```bash
git add src/shared/hooks/usePennylane.js src/shared/hooks/cacheKeys.js src/apps/artisan/pages/DevisExplorer.jsx src/shared/services/pennylane.service.js
git commit -m "feat(devis): l'explorateur lit la table jumelle + bandeau de fraicheur"
```

---

### Task 8: Vérification finale

- [ ] **Step 1: Suite complète**

```bash
cd /c/Dev/Frontend-Majordhome && node --test scripts/quotes-explorer.test.mjs && npm run lint:errors && npx vite build 2>&1 | tail -3 && npm run audit:dead-code
```

- [ ] **Step 2: Cohérence compteur / page**

```sql
SELECT count(*) AS orphelins_attendus
FROM majordhome.pennylane_quotes q
WHERE q.status IN ('pending','expired','accepted','invoiced')
  AND q.amount_ht >= 500
  AND q.missing_since IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM majordhome.lead_pennylane_quotes l
     WHERE l.pennylane_quote_id = q.pennylane_quote_id AND l.ejected_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM majordhome.pennylane_quote_dismissals d
     WHERE d.pennylane_quote_id = q.pennylane_quote_id AND d.org_id = q.org_id);
```

Ce nombre doit égaler celui de la carte KPI du Dashboard et le nombre de cartes en vue Orphelins.

- [ ] **Step 3: Recette manuelle par Eric**

1. La page `/devis` s'ouvre instantanément (plus de scan API).
2. L'historique complet est visible, au-delà de 90 jours.
3. Le bandeau « Dernière synchronisation il y a X » est présent.
4. La colonne Expiré ne contient plus que des devis de plus de 3 mois.
5. Les trois gestes (rattacher, créer le lead, écarter) fonctionnent toujours.
6. Un devis créé dans Pennylane apparaît dans les 5 minutes.

---

## Écarts assumés par rapport à la spec

- **La spec évoquait un module pur JS pour la règle des 3 mois.** Elle vit finalement en SQL
  (`majordhome.pl_quote_target_deadline`), pour éviter une troisième duplication Deno/JS après celle
  de `PIPELINE_MIN_AMOUNT_HT`. Conséquence : pas de test `node --test` sur la règle, mais une
  vérification directe en Task 1 Step 3 (fin de mois : `2026-11-30` → `2027-02-28`).
- **Un interrupteur `PL_APPLY_DEADLINES` a été ajouté** (absent de la spec) pour livrer le balayage
  en lecture seule avant d'autoriser la moindre écriture sur des documents clients.
