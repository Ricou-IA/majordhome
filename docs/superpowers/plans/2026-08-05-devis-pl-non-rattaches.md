# Explorateur de devis Pennylane non rattachés — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer les devis Pennylane jamais rattachés à un lead via une carte KPI Dashboard et une page `/devis` en kanban par statut, avec 3 gestes de traitement (rattacher, créer le lead, écarter).

**Architecture:** Un seul scan `/quotes` Pennylane alimente à la fois le compteur et la page (même `queryKey`, pas de divergence possible). La logique de filtrage/tagging est extraite dans un module **pur** testable (`src/lib/quotesExplorer.js`) ; le service ne fait que l'I/O. L'écartement est persisté dans une nouvelle table `majordhome.pennylane_quote_dismissals` lue via une vue publique updatable. Aucune nouvelle RPC : les gestes réutilisent `lead_attach_quotes_and_send` (forward-only, déjà en place).

**Tech Stack:** React 18 + TanStack Query v5, Supabase (PostgreSQL + PostgREST), Tailwind, `node --test` pour le module pur.

**Spec source:** `docs/superpowers/specs/2026-08-05-devis-pl-non-rattaches-design.md`

---

## Faits vérifiés en amont (ne pas re-supposer)

Ces points ont été confirmés contre la base et le code. Ils évitent trois pièges connus du projet :

1. **`lead_pennylane_quotes.org_id` = org CORE** (`3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`), c'est-à-dire
   `useAuth().organization.id`. **Ne PAS appeler `getMajordhomeOrgId()`** ici. Vérifié : 314 lignes,
   toutes sur l'org core. `LeadModal` passe déjà `organization?.id` à `QuoteCandidatesModal`.
2. **`lead_pennylane_quotes.pennylane_quote_id` est un `bigint`.** La nouvelle table doit s'aligner.
3. **`lead_attach_quotes_and_send` est forward-only** (garde `v_current_display_order < 4`,
   `20260524_lead_attach_quotes_round_and_tiebreak.sql:179`) : rattacher un devis à un lead déjà
   Gagné ne le rétrograde pas. Aucune garde supplémentaire à écrire.

## Structure de fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `src/lib/quotesExplorer.js` | **Pur.** Allowlist statuts, jointure devis↔liens↔écartements, filtres par vue. Zéro import React/Supabase. |
| `scripts/quotes-explorer.test.mjs` | Tests `node --test` du module pur. |
| `src/shared/services/quoteDismissals.service.js` | CRUD des écartements. Fichier séparé pour ne pas grossir `pennylane.service.js` (déjà 1778 LOC / plafond 700). |
| `supabase/migrations/20260805_1_pennylane_quote_dismissals.sql` | Table + RLS + vue publique + GRANT. |
| `src/apps/artisan/pages/DevisExplorer.jsx` | Page `/devis` : orchestrateur (vue active, sélection, montage des modales). |
| `src/apps/artisan/components/devis/QuoteExplorerCard.jsx` | Carte devis (présentationnel + checkbox de sélection). |
| `src/apps/artisan/components/devis/AttachQuoteToLeadModal.jsx` | Recherche lead + rattachement. |
| `src/apps/artisan/components/devis/CreateLeadFromQuoteModal.jsx` | Création lead pré-rempli PL + rattachement. |

**Modifiés :**

| Fichier | Modification |
|---|---|
| `src/lib/constants.js` | Ajout `PIPELINE_MIN_AMOUNT_HT`. |
| `src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx:45` | Import au lieu de la const locale. |
| `supabase/functions/pennylane-sync-quote-status/index.ts:85-86` | Commentaire croisé (la valeur reste dupliquée, Deno ne peut pas importer `src/lib/`). |
| `src/shared/services/pennylane.service.js` | Ajout `getQuotesExplorer`, `getUnlinkedQuotes` devient un filtre, suppression `countUnlinkedQuotes`. |
| `src/shared/hooks/cacheKeys.js:295-296` | Ajout `quotesExplorer`, suppression `unlinkedQuotesCount`. |
| `src/shared/hooks/usePennylane.js` | Ajout `useQuotesExplorer` + hooks d'écartement, suppression `useUnlinkedQuoteCount`. |
| `src/apps/artisan/routes.jsx` | Route `/devis`. |
| `src/apps/artisan/pages/Dashboard.jsx` | 5ᵉ carte KPI. |

---

### Task 1: Centraliser PIPELINE_MIN_AMOUNT_HT

**Files:**
- Modify: `src/lib/constants.js`
- Modify: `src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx:41-45`
- Modify: `supabase/functions/pennylane-sync-quote-status/index.ts:84-86`

- [ ] **Step 1: Ajouter la constante**

Dans `src/lib/constants.js`, à la suite du bloc Pagination :

```javascript
// Pipeline commercial
// Seuil sous lequel un devis Pennylane est considéré SAV/entretien et sort du
// pipeline commercial (sélecteur de rattachement + explorateur de devis).
// ⚠️ Valeur DUPLIQUÉE dans supabase/functions/pennylane-sync-quote-status/index.ts
// (Deno ne peut pas importer src/lib/). Toute modification doit toucher les deux.
export const PIPELINE_MIN_AMOUNT_HT = 1000;
```

- [ ] **Step 2: Remplacer la const locale du composant**

Dans `QuoteCandidatesModal.jsx`, supprimer les lignes 41-45 (le commentaire + `const PIPELINE_MIN_AMOUNT_HT = 1000;`) et ajouter l'import auprès des autres imports :

```javascript
import { PIPELINE_MIN_AMOUNT_HT } from '@lib/constants';
```

Les deux usages existants (lignes ~201 et ~250) restent inchangés.

- [ ] **Step 3: Poser le commentaire croisé côté edge**

Dans `supabase/functions/pennylane-sync-quote-status/index.ts`, remplacer le commentaire au-dessus de `const PIPELINE_MIN_AMOUNT_HT = 1000;` par :

```typescript
// Seuil pipeline commercial. ⚠️ COPIE de src/lib/constants.js — Deno ne peut pas
// importer le code frontend. Toute modification du seuil doit toucher LES DEUX.
const PIPELINE_MIN_AMOUNT_HT = 1000;
```

- [ ] **Step 4: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5
```

Attendu : `✓ built in ...`, aucune erreur de résolution.

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants.js src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx supabase/functions/pennylane-sync-quote-status/index.ts
git commit -m "refactor(pipeline): centraliser PIPELINE_MIN_AMOUNT_HT dans lib/constants"
```

---

### Task 2: Migration — table des écartements

**Files:**
- Create: `supabase/migrations/20260805_1_pennylane_quote_dismissals.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 20260805_1_pennylane_quote_dismissals.sql
-- Écartement manuel d'un devis Pennylane de l'explorateur (« hors pipeline »).
-- Réversible : réintégrer = supprimer la ligne.
-- Spec : docs/superpowers/specs/2026-08-05-devis-pl-non-rattaches-design.md

CREATE TABLE IF NOT EXISTS majordhome.pennylane_quote_dismissals (
  org_id             uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pennylane_quote_id bigint      NOT NULL,  -- aligné sur lead_pennylane_quotes.pennylane_quote_id
  reason             text,
  dismissed_by       uuid,
  dismissed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pennylane_quote_id)
);

ALTER TABLE majordhome.pennylane_quote_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pqd_select ON majordhome.pennylane_quote_dismissals;
CREATE POLICY pqd_select ON majordhome.pennylane_quote_dismissals
  FOR SELECT USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

DROP POLICY IF EXISTS pqd_insert ON majordhome.pennylane_quote_dismissals;
CREATE POLICY pqd_insert ON majordhome.pennylane_quote_dismissals
  FOR INSERT WITH CHECK (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

DROP POLICY IF EXISTS pqd_delete ON majordhome.pennylane_quote_dismissals;
CREATE POLICY pqd_delete ON majordhome.pennylane_quote_dismissals
  FOR DELETE USING (
    org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())
  );

-- Vue publique : miroir simple => auto-updatable (INSERT/DELETE via PostgREST,
-- pas de RPC). NE PAS y ajouter de JOIN/LATERAL : la vue perdrait
-- is_insertable_into (cf. gotcha majordhome_appointments dans CLAUDE.md).
DROP VIEW IF EXISTS public.majordhome_pennylane_quote_dismissals;
CREATE VIEW public.majordhome_pennylane_quote_dismissals
  WITH (security_invoker = true) AS
  SELECT org_id, pennylane_quote_id, reason, dismissed_by, dismissed_at
  FROM majordhome.pennylane_quote_dismissals;

-- Règle CLAUDE.md : sans ce GRANT, toute edge function lisant la vue plante en
-- 42501 permission denied SILENCIEUX (la vue est security_invoker).
GRANT SELECT ON majordhome.pennylane_quote_dismissals TO service_role;
GRANT SELECT, INSERT, DELETE ON public.majordhome_pennylane_quote_dismissals TO authenticated;
```

- [ ] **Step 2: Appliquer la migration**

Via le MCP Supabase (`apply_migration`, project_id `odspcxgafcqxjzrarsqf`), nom `20260805_1_pennylane_quote_dismissals`.

- [ ] **Step 3: Vérifier RLS, GRANT et updatabilité**

```sql
SELECT relrowsecurity FROM pg_class
 WHERE oid = 'majordhome.pennylane_quote_dismissals'::regclass;

SELECT has_table_privilege('service_role', 'majordhome.pennylane_quote_dismissals', 'SELECT') AS svc_select;

SELECT is_insertable_into FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'majordhome_pennylane_quote_dismissals';
```

Attendu : `relrowsecurity = true`, `svc_select = true`, `is_insertable_into = YES`.
**Si `is_insertable_into` vaut NO, s'arrêter** — la vue n'est pas un miroir simple et les écritures casseront.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260805_1_pennylane_quote_dismissals.sql
git commit -m "feat(pennylane): table pennylane_quote_dismissals + vue publique"
```

---

### Task 3: Module pur `quotesExplorer` (TDD)

**Files:**
- Create: `src/lib/quotesExplorer.js`
- Test: `scripts/quotes-explorer.test.mjs`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `scripts/quotes-explorer.test.mjs` :

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORER_QUOTE_STATUSES,
  EXPLORER_VIEWS,
  buildExplorerRows,
  filterExplorerRows,
} from '../src/lib/quotesExplorer.js';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const recent = '2026-07-20';
const old = '2026-01-10';

function quote(over = {}) {
  return {
    id: 1,
    quote_number: 'DEV-001',
    label: 'Poêle',
    date: recent,
    amount_ht: 4200,
    amount_ttc: 4620,
    status: 'pending',
    pdf_url: 'https://pl/x.pdf',
    customer_id: 77,
    customer_name: 'DUPONT',
    ...over,
  };
}

const base = { minAmountHt: 1000, sinceDays: 90, nowMs: NOW };

test('draft est exclu (brouillon non envoyé, pas une anomalie)', () => {
  const rows = buildExplorerRows({ quotes: [quote({ status: 'draft' })], ...base });
  assert.equal(rows.length, 0);
});

test('les 4 statuts de EXPLORER_QUOTE_STATUSES passent', () => {
  const quotes = EXPLORER_QUOTE_STATUSES.map((status, i) => quote({ id: i + 1, status }));
  const rows = buildExplorerRows({ quotes, ...base });
  assert.equal(rows.length, 4);
});

test('un devis sous le seuil est exclu', () => {
  const rows = buildExplorerRows({ quotes: [quote({ amount_ht: 999 })], ...base });
  assert.equal(rows.length, 0);
});

test('un devis hors fenêtre est exclu', () => {
  const rows = buildExplorerRows({ quotes: [quote({ date: old })], ...base });
  assert.equal(rows.length, 0);
});

test('un devis sans montant est exclu (pas de faux positif à 0)', () => {
  const rows = buildExplorerRows({ quotes: [quote({ amount_ht: null })], ...base });
  assert.equal(rows.length, 0);
});

test('le lead rattaché est reporté sur la ligne', () => {
  const rows = buildExplorerRows({
    quotes: [quote()],
    linkByQuoteId: new Map([[1, { lead_id: 'lead-a', lead_name: 'DUPONT Jean' }]]),
    ...base,
  });
  assert.equal(rows[0].lead_id, 'lead-a');
  assert.equal(rows[0].lead_name, 'DUPONT Jean');
  assert.equal(rows[0].is_orphan, false);
});

test('sans lien, la ligne est orpheline', () => {
  const rows = buildExplorerRows({ quotes: [quote()], ...base });
  assert.equal(rows[0].lead_id, null);
  assert.equal(rows[0].is_orphan, true);
});

test('un devis écarté est tagué is_dismissed', () => {
  const rows = buildExplorerRows({
    quotes: [quote()],
    dismissedIds: new Set([1]),
    ...base,
  });
  assert.equal(rows[0].is_dismissed, true);
});

test('vue ORPHANS : ni rattachés ni écartés', () => {
  const rows = buildExplorerRows({
    quotes: [quote({ id: 1 }), quote({ id: 2 }), quote({ id: 3 })],
    linkByQuoteId: new Map([[2, { lead_id: 'l', lead_name: 'X' }]]),
    dismissedIds: new Set([3]),
    ...base,
  });
  const view = filterExplorerRows(rows, EXPLORER_VIEWS.ORPHANS);
  assert.deepEqual(view.map(r => r.id), [1]);
});

test('vue ALL : rattachés inclus, écartés exclus', () => {
  const rows = buildExplorerRows({
    quotes: [quote({ id: 1 }), quote({ id: 2 }), quote({ id: 3 })],
    linkByQuoteId: new Map([[2, { lead_id: 'l', lead_name: 'X' }]]),
    dismissedIds: new Set([3]),
    ...base,
  });
  const view = filterExplorerRows(rows, EXPLORER_VIEWS.ALL);
  assert.deepEqual(view.map(r => r.id).sort(), [1, 2]);
});

test('vue DISMISSED : uniquement les écartés', () => {
  const rows = buildExplorerRows({
    quotes: [quote({ id: 1 }), quote({ id: 3 })],
    dismissedIds: new Set([3]),
    ...base,
  });
  const view = filterExplorerRows(rows, EXPLORER_VIEWS.DISMISSED);
  assert.deepEqual(view.map(r => r.id), [3]);
});

test('les lignes sont triées par date décroissante', () => {
  const rows = buildExplorerRows({
    quotes: [
      quote({ id: 1, date: '2026-06-01' }),
      quote({ id: 2, date: '2026-07-30' }),
      quote({ id: 3, date: '2026-07-01' }),
    ],
    ...base,
  });
  assert.deepEqual(rows.map(r => r.id), [2, 3, 1]);
});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
cd /c/Dev/Frontend-Majordhome && node --test scripts/quotes-explorer.test.mjs
```

Attendu : échec `Cannot find module ... quotesExplorer.js`.

- [ ] **Step 3: Écrire le module**

Créer `src/lib/quotesExplorer.js` :

```javascript
/**
 * quotesExplorer.js — logique PURE de l'explorateur de devis Pennylane
 * ============================================================================
 * Aucun import React / Supabase : testable via `node --test`.
 * Le service ne fait que l'I/O, tout le tri/filtrage/tagging vit ici.
 * ============================================================================
 */

/**
 * Statuts Pennylane qui matérialisent une opportunité commerciale réelle.
 *
 * ⚠️ CE N'EST PAS une copie de `majordhome.quote_status_bucket()`. Les buckets DB
 * répondent à « ce devis est-il validé / en cours / refusé ? ». Cette allowlist-ci
 * répond à « ce devis aurait-il dû être rattaché à un lead ? ».
 * `draft` appartient au bucket `pending` côté DB mais est EXCLU ici : un brouillon
 * jamais envoyé au client n'est pas une anomalie de rapprochement.
 * La divergence est VOULUE — ne pas « corriger » en réintroduisant draft.
 */
export const EXPLORER_QUOTE_STATUSES = ['pending', 'expired', 'accepted', 'invoiced'];

export const EXPLORER_VIEWS = {
  ORPHANS: 'orphans',
  ALL: 'all',
  DISMISSED: 'dismissed',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Joint les devis PL bruts avec leurs rattachements et leurs écartements,
 * applique les filtres métier, trie par date décroissante.
 *
 * @param {object} params
 * @param {Array}  params.quotes          - devis PL déjà formatés par le service
 * @param {Map}    [params.linkByQuoteId] - Map<number, {lead_id, lead_name}>
 * @param {Set}    [params.dismissedIds]  - Set<number> des devis écartés
 * @param {number} params.minAmountHt     - seuil pipeline (PIPELINE_MIN_AMOUNT_HT)
 * @param {number} params.sinceDays       - fenêtre glissante
 * @param {number} params.nowMs           - horodatage de référence (injecté pour les tests)
 * @returns {Array} lignes enrichies
 */
export function buildExplorerRows({
  quotes = [],
  linkByQuoteId = new Map(),
  dismissedIds = new Set(),
  minAmountHt = 0,
  sinceDays = 90,
  nowMs = Date.now(),
}) {
  const cutoffMs = nowMs - sinceDays * DAY_MS;

  const rows = [];
  for (const q of quotes) {
    if (!EXPLORER_QUOTE_STATUSES.includes(q.status)) continue;

    const amountHt = Number(q.amount_ht);
    if (!Number.isFinite(amountHt) || amountHt < minAmountHt) continue;

    if (q.date) {
      const d = Date.parse(q.date);
      if (!Number.isNaN(d) && d < cutoffMs) continue;
    }

    const link = linkByQuoteId.get(q.id) || null;
    rows.push({
      ...q,
      amount_ht: amountHt,
      lead_id: link?.lead_id ?? null,
      lead_name: link?.lead_name ?? null,
      is_orphan: !link,
      is_dismissed: dismissedIds.has(q.id),
    });
  }

  rows.sort((a, b) => {
    const da = a.date ? Date.parse(a.date) : 0;
    const db = b.date ? Date.parse(b.date) : 0;
    return db - da;
  });

  return rows;
}

/**
 * Applique la vue active. Les écartés ne sortent QUE dans la vue DISMISSED.
 */
export function filterExplorerRows(rows, view) {
  switch (view) {
    case EXPLORER_VIEWS.DISMISSED:
      return rows.filter(r => r.is_dismissed);
    case EXPLORER_VIEWS.ALL:
      return rows.filter(r => !r.is_dismissed);
    case EXPLORER_VIEWS.ORPHANS:
    default:
      return rows.filter(r => !r.is_dismissed && r.is_orphan);
  }
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

```bash
cd /c/Dev/Frontend-Majordhome && node --test scripts/quotes-explorer.test.mjs
```

Attendu : `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotesExplorer.js scripts/quotes-explorer.test.mjs
git commit -m "feat(pennylane): module pur quotesExplorer + tests"
```

---

### Task 4: Service — `getQuotesExplorer` et nettoyage

**Files:**
- Modify: `src/shared/services/pennylane.service.js:1350-1492` (zone `getUnlinkedQuotes` / `countUnlinkedQuotes`)
- Modify: `src/shared/services/pennylane.service.js:1770-1771` (exports)

- [ ] **Step 1: Ajouter `getQuotesExplorer` juste avant `getUnlinkedQuotes`**

```javascript
/**
 * Scan unique des devis PL de la fenêtre, enrichi des rattachements et des
 * écartements. Alimente À LA FOIS le compteur Dashboard et la page /devis
 * (même queryKey) — un compteur calculé à part dériverait des filtres de la
 * liste et le voyant perdrait toute crédibilité.
 *
 * ⚠️ orgId = org CORE (useAuth().organization.id) : c'est ce que porte
 * lead_pennylane_quotes.org_id. NE PAS passer par getMajordhomeOrgId().
 *
 * @param {string} orgId
 * @param {object} [opts]
 * @param {number} [opts.sinceDays=90]
 * @returns {Promise<{rows: Array, truncated: boolean, scanned: number}>}
 */
async function getQuotesExplorer(orgId, { sinceDays = 90 } = {}) {
  if (!orgId) return { rows: [], truncated: false, scanned: 0 };

  // 1. Rattachements actifs (org core) → Map<quote_pl_id, {lead_id}>
  const { data: links } = await supabase
    .from('majordhome_lead_pennylane_quotes')
    .select('pennylane_quote_id, lead_id')
    .eq('org_id', orgId)
    .is('ejected_at', null);

  const linkByQuoteId = new Map();
  for (const l of links || []) {
    linkByQuoteId.set(Number(l.pennylane_quote_id), { lead_id: l.lead_id, lead_name: null });
  }

  // 2. Noms des leads rattachés (1 requête, pas N)
  const leadIds = [...new Set([...linkByQuoteId.values()].map(v => v.lead_id).filter(Boolean))];
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from('majordhome_leads')
      .select('id, first_name, last_name')
      .in('id', leadIds);
    const nameById = new Map(
      (leads || []).map(l => [l.id, [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || null]),
    );
    for (const v of linkByQuoteId.values()) {
      v.lead_name = nameById.get(v.lead_id) || null;
    }
  }

  // 3. Écartements
  const { data: dismissals } = await supabase
    .from('majordhome_pennylane_quote_dismissals')
    .select('pennylane_quote_id')
    .eq('org_id', orgId);
  const dismissedIds = new Set((dismissals || []).map(d => Number(d.pennylane_quote_id)));

  // 4. Scan paginé /quotes (même plafond que getUnlinkedQuotes)
  const allQuotes = [];
  let cursor = null;
  let hasMore = true;
  let pageCount = 0;
  const MAX_PAGES = 10;

  while (hasMore && pageCount < MAX_PAGES) {
    let path = '/quotes?limit=100';
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}`;
    const result = await apiCall('GET', path);
    const items = result?.items || [];
    allQuotes.push(...items);
    hasMore = result?.has_more && !!result?.next_cursor;
    cursor = result?.next_cursor || null;
    pageCount++;
  }

  // truncated = le scan s'est arrêté sur le plafond alors que PL en avait encore.
  // Doit être affiché (règle « pas de cap muet »).
  const truncated = hasMore;

  // 5. Noms clients (la LISTE /quotes n'embarque que customer.id — cf ef7c175)
  const namesById = await resolveCustomerNames(orgId, allQuotes.map(q => q.customer?.id));

  const formatted = allQuotes.map(q => ({
    id: q.id,
    quote_number: q.quote_number || q.label || null,
    label: q.label || null,
    subject: q.pdf_invoice_subject || null,
    date: q.date || null,
    amount_ht: q.currency_amount_before_tax ?? null,
    amount_ttc: q.amount ?? q.currency_amount ?? null,
    status: q.status || null,
    pdf_url: q.public_file_url || null,
    customer_id: q.customer?.id || null,
    customer_name: formatPennylaneCustomerName(q.customer)
      || (q.customer?.id ? namesById.get(String(q.customer.id)) : null)
      || null,
  }));

  const rows = buildExplorerRows({
    quotes: formatted,
    linkByQuoteId,
    dismissedIds,
    minAmountHt: PIPELINE_MIN_AMOUNT_HT,
    sinceDays,
  });

  return { rows, truncated, scanned: allQuotes.length };
}
```

- [ ] **Step 2: Ajouter les imports en tête de fichier**

```javascript
import { PIPELINE_MIN_AMOUNT_HT } from '@lib/constants';
import { buildExplorerRows } from '@lib/quotesExplorer';
```

- [ ] **Step 3: Supprimer `countUnlinkedQuotes`**

Supprimer la fonction complète (`pennylane.service.js:1440-1492`, du bloc JSDoc `Compteur "devis PL non rattachés..."` jusqu'à sa dernière accolade) et sa ligne d'export (`countUnlinkedQuotes: (orgId, opts) => ...`).

Rationale : le compteur vient désormais de `getQuotesExplorer`, une seconde source divergerait.

- [ ] **Step 4: Exporter le nouveau service**

Dans l'objet `pennylaneService`, à côté de `getUnlinkedQuotes` :

```javascript
  getQuotesExplorer: (orgId, opts) => withErrorHandling(() => getQuotesExplorer(orgId, opts), 'pennylane.getQuotesExplorer'),
```

- [ ] **Step 5: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5 && npm run lint:errors
```

Attendu : build OK, 0 erreur ESLint. `getUnlinkedQuotes` reste intact et `QuoteCandidatesModal` fonctionne toujours.

- [ ] **Step 6: Commit**

```bash
git add src/shared/services/pennylane.service.js
git commit -m "feat(pennylane): getQuotesExplorer (scan unique) + retrait countUnlinkedQuotes"
```

---

### Task 5: Service des écartements

**Files:**
- Create: `src/shared/services/quoteDismissals.service.js`

- [ ] **Step 1: Écrire le service**

```javascript
/**
 * quoteDismissals.service.js — écartements de devis Pennylane
 * ============================================================================
 * Écarter un devis = le sortir de l'explorateur sans le toucher dans Pennylane.
 * Réversible (restore). Fichier séparé de pennylane.service.js qui est déjà à
 * 1778 LOC (plafond conventionnel 700).
 *
 * ⚠️ orgId = org CORE (useAuth().organization.id).
 * ============================================================================
 */

import { supabase } from '@lib/supabaseClient';
import { withErrorHandling } from '@lib/serviceHelpers';

const VIEW = 'majordhome_pennylane_quote_dismissals';

export const quoteDismissalsService = {
  /**
   * Écarte un ou plusieurs devis. Idempotent (upsert sur la PK composite).
   * @param {string} orgId
   * @param {Array<number>} quoteIds
   * @param {object} [opts]
   * @param {string} [opts.reason]
   * @param {string} [opts.userId]
   */
  async dismiss(orgId, quoteIds, { reason = null, userId = null } = {}) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[quoteDismissals] orgId requis');
      const ids = (quoteIds || []).map(Number).filter(Number.isFinite);
      if (ids.length === 0) return { dismissed: 0 };

      const rows = ids.map(id => ({
        org_id: orgId,
        pennylane_quote_id: id,
        reason,
        dismissed_by: userId,
      }));

      const { error } = await supabase
        .from(VIEW)
        .upsert(rows, { onConflict: 'org_id,pennylane_quote_id' });

      if (error) throw error;
      return { dismissed: ids.length };
    }, 'quoteDismissals.dismiss');
  },

  /**
   * Réintègre un devis écarté (suppression de la ligne).
   */
  async restore(orgId, quoteId) {
    return withErrorHandling(async () => {
      if (!orgId) throw new Error('[quoteDismissals] orgId requis');

      const { error } = await supabase
        .from(VIEW)
        .delete()
        .eq('org_id', orgId)
        .eq('pennylane_quote_id', Number(quoteId));

      if (error) throw error;
      return { restored: 1 };
    }, 'quoteDismissals.restore');
  },
};

export default quoteDismissalsService;
```

- [ ] **Step 2: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5
```

Attendu : build OK.

- [ ] **Step 3: Commit**

```bash
git add src/shared/services/quoteDismissals.service.js
git commit -m "feat(pennylane): service d'écartement des devis"
```

---

### Task 6: Cache keys et hooks

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js:293-296`
- Modify: `src/shared/hooks/usePennylane.js:449-475`

- [ ] **Step 1: Cache keys**

Dans `cacheKeys.js`, remplacer la ligne `unlinkedQuotesCount` par :

```javascript
  // Explorateur de devis : compteur KPI Dashboard ET page /devis partagent
  // CETTE key — deux sources divergeraient sur les filtres.
  quotesExplorer: (orgId, sinceDays) => [...pennylaneKeys.all(orgId), 'quotes-explorer', sinceDays],
  quoteDismissals: (orgId) => [...pennylaneKeys.all(orgId), 'quote-dismissals'],
```

`unlinkedQuotes` reste (consommée par `QuoteCandidatesModal`).

- [ ] **Step 2: Remplacer `useUnlinkedQuoteCount` par `useQuotesExplorer`**

Dans `usePennylane.js`, supprimer `useUnlinkedQuoteCount` (lignes 449-475) et écrire :

```javascript
/**
 * Explorateur de devis PL : source UNIQUE du compteur KPI Dashboard et de la
 * page /devis. staleTime long (15 min) — le scan PL est coûteux et les devis
 * bougent peu.
 *
 * @param {object} [opts]
 * @param {number} [opts.sinceDays=90]
 * @param {boolean} [opts.enabled=true]
 */
export function useQuotesExplorer({ sinceDays = 90, enabled = true } = {}) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: pennylaneKeys.quotesExplorer(orgId, sinceDays),
    queryFn: async () => {
      const { data, error } = await pennylaneService.getQuotesExplorer(orgId, { sinceDays });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && enabled,
    staleTime: 15 * 60_000,
  });

  const rows = query.data?.rows || [];

  return {
    rows,
    orphanCount: rows.filter(r => r.is_orphan && !r.is_dismissed).length,
    truncated: query.data?.truncated || false,
    scanned: query.data?.scanned || 0,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Écarter (unitaire ou en lot) et réintégrer un devis.
 * Invalide l'explorateur pour que la carte disparaisse/réapparaisse.
 */
export function useQuoteDismissals() {
  const queryClient = useQueryClient();
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: pennylaneKeys.all(orgId) });
  };

  const dismiss = useMutation({
    mutationFn: async ({ quoteIds, reason }) => {
      const { data, error } = await quoteDismissalsService.dismiss(orgId, quoteIds, {
        reason,
        userId: user?.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const restore = useMutation({
    mutationFn: async (quoteId) => {
      const { data, error } = await quoteDismissalsService.restore(orgId, quoteId);
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    dismissQuotes: dismiss.mutateAsync,
    isDismissing: dismiss.isPending,
    restoreQuote: restore.mutateAsync,
    isRestoring: restore.isPending,
  };
}
```

- [ ] **Step 3: Ajouter l'import du service**

En tête de `usePennylane.js` :

```javascript
import { quoteDismissalsService } from '@services/quoteDismissals.service';
```

- [ ] **Step 4: Vérifier qu'aucun consommateur de `useUnlinkedQuoteCount` ne subsiste**

```bash
cd /c/Dev/Frontend-Majordhome && grep -rn "useUnlinkedQuoteCount\|countUnlinkedQuotes\|unlinkedQuotesCount" src/
```

Attendu : **aucun résultat**.

- [ ] **Step 5: Vérifier le build**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5 && npm run lint:errors
```

Attendu : build OK, 0 erreur.

- [ ] **Step 6: Commit**

```bash
git add src/shared/hooks/cacheKeys.js src/shared/hooks/usePennylane.js
git commit -m "feat(pennylane): hooks useQuotesExplorer + useQuoteDismissals"
```

---

### Task 7: Carte devis

**Files:**
- Create: `src/apps/artisan/components/devis/QuoteExplorerCard.jsx`

- [ ] **Step 1: Écrire le composant**

```jsx
/**
 * QuoteExplorerCard.jsx — carte d'un devis Pennylane dans l'explorateur.
 * Présentationnel : aucune logique métier, aucun appel réseau.
 */

import { FileText, Link2, Plus, EyeOff, Undo2, ExternalLink } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@lib/utils';

export function QuoteExplorerCard({
  row,
  selected = false,
  onToggleSelect,
  onAttach,
  onCreateLead,
  onDismiss,
  onRestore,
}) {
  const isOrphan = row.is_orphan && !row.is_dismissed;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-2">
        {isOrphan && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(row.id); }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 rounded border-gray-300"
            aria-label={`Sélectionner le devis ${row.quote_number || row.id}`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm text-secondary-900 truncate">
              {row.customer_name || 'Client inconnu'}
            </p>
            <span className="text-sm font-semibold text-secondary-900 shrink-0">
              {formatEuro(row.amount_ht)}
            </span>
          </div>

          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {row.quote_number || `#${row.id}`}
            {row.date ? ` · ${formatDateShortFR(row.date)}` : ''}
          </p>

          {row.lead_id ? (
            <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
              <Link2 className="w-3 h-3" />
              {row.lead_name || 'Lead rattaché'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700">
              <FileText className="w-3 h-3" />
              Non rattaché
            </span>
          )}

          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {row.pdf_url ? (
              <a
                href={row.pdf_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
              >
                <ExternalLink className="w-3 h-3" /> PDF
              </a>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-xs text-gray-300 cursor-not-allowed"
                title="PDF non synchronisé (prochain cycle < 15 min)"
              >
                <ExternalLink className="w-3 h-3" /> PDF
              </span>
            )}

            {isOrphan && (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); onAttach?.(row); }}
                  className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-secondary-700">
                  <Link2 className="w-3 h-3" /> Rattacher
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onCreateLead?.(row); }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-secondary-700">
                  <Plus className="w-3 h-3" /> Créer le lead
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onDismiss?.(row); }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-gray-500">
                  <EyeOff className="w-3 h-3" /> Écarter
                </button>
              </>
            )}

            {row.is_dismissed && (
              <button type="button" onClick={(e) => { e.stopPropagation(); onRestore?.(row); }}
                className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-secondary-50 text-secondary-700">
                <Undo2 className="w-3 h-3" /> Réintégrer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuoteExplorerCard;
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/artisan/components/devis/QuoteExplorerCard.jsx
git commit -m "feat(devis): carte devis de l'explorateur"
```

---

### Task 8: Page `/devis` + route

**Files:**
- Create: `src/apps/artisan/pages/DevisExplorer.jsx`
- Modify: `src/apps/artisan/routes.jsx`

- [ ] **Step 1: Écrire la page**

```jsx
/**
 * DevisExplorer.jsx — page /devis
 * ============================================================================
 * Explorateur des devis Pennylane par statut. Sert à repérer et traiter les
 * devis jamais rattachés à un lead.
 * Accès org_admin uniquement (un devis PL ne porte pas de commercial).
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useQuotesExplorer, useQuoteDismissals } from '@hooks/usePennylane';
import { KanbanBoard } from '@apps/artisan/components/shared/KanbanBoard';
import { QuoteExplorerCard } from '@apps/artisan/components/devis/QuoteExplorerCard';
import { EXPLORER_VIEWS, filterExplorerRows } from '@lib/quotesExplorer';
import { formatEuro } from '@lib/utils';

const COLUMNS = [
  { id: 'pending', label: 'En attente', color: '#d97706' },
  { id: 'expired', label: 'Expiré', color: '#a16207' },
  { id: 'accepted', label: 'Accepté', color: '#1d4ed8' },
  { id: 'invoiced', label: 'Facturé', color: '#0f766e' },
];

const VIEW_TABS = [
  { id: EXPLORER_VIEWS.ORPHANS, label: 'Orphelins' },
  { id: EXPLORER_VIEWS.ALL, label: 'Tous' },
  { id: EXPLORER_VIEWS.DISMISSED, label: 'Écartés' },
];

export default function DevisExplorer() {
  const { isOrgAdmin } = useAuth();
  const pennylaneActive = usePennylaneEnabled();

  const [view, setView] = useState(EXPLORER_VIEWS.ORPHANS);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [attachRow, setAttachRow] = useState(null);
  const [createRow, setCreateRow] = useState(null);

  const { rows, truncated, scanned, isLoading, error, refetch } = useQuotesExplorer({
    enabled: isOrgAdmin && pennylaneActive,
  });
  const { dismissQuotes, isDismissing, restoreQuote } = useQuoteDismissals();

  const visibleRows = useMemo(() => filterExplorerRows(rows, view), [rows, view]);

  if (!isOrgAdmin || !pennylaneActive) return <Navigate to="/" replace />;

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDismiss = async (rowOrIds) => {
    const ids = Array.isArray(rowOrIds) ? rowOrIds : [rowOrIds.id];
    try {
      await dismissQuotes({ quoteIds: ids, reason: 'hors pipeline' });
      setSelectedIds(new Set());
      toast.success(ids.length > 1 ? `${ids.length} devis écartés` : 'Devis écarté');
    } catch (e) {
      toast.error(`Écartement impossible : ${e?.message || e}`);
    }
  };

  const handleRestore = async (row) => {
    try {
      await restoreQuote(row.id);
      toast.success('Devis réintégré');
    } catch (e) {
      toast.error(`Réintégration impossible : ${e?.message || e}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Devis Pennylane</h1>
          <p className="text-secondary-600">
            Devis des 90 derniers jours et leur rattachement au pipeline.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-amber-50 text-amber-800 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium">Pennylane injoignable</p>
            <p className="text-sm">{error?.message || 'Erreur inconnue'}</p>
          </div>
          <button type="button" onClick={() => refetch()}
            className="text-sm font-medium underline shrink-0">Réessayer</button>
        </div>
      )}

      {truncated && (
        <div className="p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
          Affichage partiel : {scanned} devis analysés (plafond de scan atteint).
          Les devis les plus anciens de la fenêtre peuvent manquer.
        </div>
      )}

      {/* Onglets de vue */}
      <div className="flex items-center gap-1 border-b border-secondary-200">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setView(tab.id); setSelectedIds(new Set()); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === tab.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-secondary-500 hover:text-secondary-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 text-gray-400">Chargement des devis...</div>
      ) : (
        <KanbanBoard
          items={visibleRows}
          columns={COLUMNS}
          groupBy="status"
          emptyMessage="Aucun devis"
          searchPlaceholder="Rechercher un client, un n° de devis..."
          searchFilter={(row, query) => {
            const q = query.toLowerCase();
            return [row.customer_name, row.quote_number, row.label, row.lead_name]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q));
          }}
          columnAmount={(items) => items.reduce((sum, r) => sum + (Number(r.amount_ht) || 0), 0)}
          headerLeft={
            selectedIds.size > 0 ? (
              <button
                type="button"
                disabled={isDismissing}
                onClick={() => handleDismiss([...selectedIds])}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary-100 hover:bg-secondary-200 text-sm font-medium text-secondary-700 disabled:opacity-50"
              >
                <EyeOff className="w-4 h-4" />
                Écarter {selectedIds.size} devis
              </button>
            ) : (
              <p className="text-sm text-gray-500">
                {visibleRows.length} devis · {formatEuro(visibleRows.reduce((s, r) => s + (Number(r.amount_ht) || 0), 0))}
              </p>
            )
          }
          renderCard={(row) => (
            <QuoteExplorerCard
              row={row}
              selected={selectedIds.has(row.id)}
              onToggleSelect={toggleSelect}
              onAttach={setAttachRow}
              onCreateLead={setCreateRow}
              onDismiss={handleDismiss}
              onRestore={handleRestore}
            />
          )}
        />
      )}

      {/* Les modales Rattacher / Créer le lead sont branchées ici par les
          Tasks 9 et 10. `attachRow` / `createRow` sont déjà câblés sur les
          boutons de carte — la page reste buildable en attendant. */}
    </div>
  );
}
```

- [ ] **Step 2: Déclarer la route**

Dans `routes.jsx`, ajouter le lazy import après `const PipelineContrats = ...` :

```javascript
// Explorateur de devis Pennylane
const DevisExplorer = lazy(() => import('./pages/DevisExplorer'));
```

Puis l'entrée de route, après le bloc `contrats` :

```jsx
  {
    // Explorateur de devis PL — garde fine org_admin in-component
    path: 'devis',
    element: (
      <SuspenseWrapper>
        <RouteGuard resource="pipeline">
          <DevisExplorer />
        </RouteGuard>
      </SuspenseWrapper>
    ),
  },
```

- [ ] **Step 3: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5 && npm run lint:errors
```

Attendu : build OK, 0 erreur. La page est fonctionnelle en lecture (kanban, vues, écarter, réintégrer, écartement en lot) ; les deux modales d'action sont branchées aux tâches suivantes.

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/pages/DevisExplorer.jsx src/apps/artisan/routes.jsx
git commit -m "feat(devis): page /devis explorateur kanban par statut"
```

---

### Task 9: Modale « Rattacher à un lead existant »

**Files:**
- Create: `src/apps/artisan/components/devis/AttachQuoteToLeadModal.jsx`

**Note d'architecture :** `useAttachQuotesAndSend(orgId, leadId)` prend le `leadId` **à la construction du hook**. On ne peut donc pas l'appeler avec un lead choisi dynamiquement dans le même composant. Solution : un sous-composant `<AttachButton>` monté **après** la sélection, donc avec un `leadId` stable. On ne touche pas au hook existant (Posture #3).

- [ ] **Step 1: Écrire la modale**

```jsx
/**
 * AttachQuoteToLeadModal.jsx — rattache un devis PL orphelin à un lead existant.
 * Réutilise useAttachQuotesAndSend (RPC lead_attach_quotes_and_send, forward-only).
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Search, Link2 } from 'lucide-react';
import { supabase } from '@lib/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { useAttachQuotesAndSend } from '@hooks/usePennylane';
import { useDebounce } from '@hooks/useDebounce';
import { escapePostgrestSearchTerm } from '@lib/postgrestUtils';
import { formatEuro } from '@lib/utils';

/** Bouton monté une fois le lead choisi → leadId stable pour le hook. */
function AttachButton({ orgId, leadId, quote, onDone }) {
  const { attachQuotes, isAttaching } = useAttachQuotesAndSend(orgId, leadId);

  const handleAttach = async () => {
    try {
      await attachQuotes([{
        quote_pl_id: quote.id,
        customer_id: quote.customer_id ?? null,
        amount_ht: quote.amount_ht ?? null,
        label: quote.quote_number || quote.label || null,
        date: quote.date || null,
        status: quote.status || null,
        pdf_url: quote.pdf_url || null,
      }]);
      toast.success('Devis rattaché au lead');
      onDone();
    } catch (e) {
      toast.error(`Rattachement impossible : ${e?.message || e}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleAttach}
      disabled={isAttaching}
      className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
    >
      <Link2 className="w-4 h-4" />
      {isAttaching ? 'Rattachement...' : 'Rattacher'}
    </button>
  );
}

export function AttachQuoteToLeadModal({ quote, onClose, onAttached }) {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const [query, setQuery] = useState(quote.customer_name || '');
  const [selected, setSelected] = useState(null);
  const debounced = useDebounce(query, 300);

  const { data: leads = [], isFetching } = useQuery({
    queryKey: ['devis-attach-lead-search', orgId, debounced],
    queryFn: async () => {
      const term = escapePostgrestSearchTerm(debounced.trim());
      if (!term) return [];
      const { data, error } = await supabase
        .from('majordhome_leads')
        .select('id, first_name, last_name, city, status_label, order_amount_ht')
        .eq('org_id', orgId)
        .eq('is_deleted', false)
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && debounced.trim().length >= 2,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-secondary-200">
          <div>
            <h2 className="font-semibold text-secondary-900">Rattacher le devis</h2>
            <p className="text-sm text-secondary-500">
              {quote.quote_number || `#${quote.id}`} · {quote.customer_name || 'Client inconnu'} · {formatEuro(quote.amount_ht)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-secondary-100">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        <div className="p-4 border-b border-secondary-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Rechercher un lead (nom, prénom)..."
              className="w-full pl-9 pr-3 py-2 border border-secondary-200 rounded-lg text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isFetching && <p className="text-sm text-gray-400 p-3">Recherche...</p>}
          {!isFetching && debounced.trim().length >= 2 && leads.length === 0 && (
            <p className="text-sm text-gray-400 p-3">
              Aucun lead trouvé. Utilise « Créer le lead » depuis la carte.
            </p>
          )}
          {leads.map((lead) => {
            const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
            const isSel = selected?.id === lead.id;
            return (
              <button
                key={lead.id}
                type="button"
                onClick={() => setSelected(lead)}
                className={`w-full text-left p-3 rounded-lg mb-1 transition-colors ${
                  isSel ? 'bg-primary-50 border border-primary-200' : 'hover:bg-secondary-50 border border-transparent'
                }`}
              >
                <p className="text-sm font-medium text-secondary-900">{name || 'Sans nom'}</p>
                <p className="text-xs text-secondary-500">
                  {[lead.city, lead.status_label].filter(Boolean).join(' · ')}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-secondary-200">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          {selected && (
            <AttachButton
              orgId={orgId}
              leadId={selected.id}
              quote={quote}
              onDone={onAttached}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default AttachQuoteToLeadModal;
```

- [ ] **Step 2: Brancher la modale dans la page**

Dans `DevisExplorer.jsx`, ajouter l'import :

```javascript
import { AttachQuoteToLeadModal } from '@apps/artisan/components/devis/AttachQuoteToLeadModal';
```

Puis, juste avant le commentaire `{/* Les modales Rattacher / Créer le lead ... */}`, insérer :

```jsx
      {attachRow && (
        <AttachQuoteToLeadModal
          quote={attachRow}
          onClose={() => setAttachRow(null)}
          onAttached={() => { setAttachRow(null); refetch(); }}
        />
      )}
```

- [ ] **Step 3: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5 && npm run lint:errors
```

Attendu : build OK, 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/components/devis/AttachQuoteToLeadModal.jsx src/apps/artisan/pages/DevisExplorer.jsx
git commit -m "feat(devis): modale de rattachement d'un devis à un lead existant"
```

---

### Task 10: Modale « Créer le lead depuis le devis »

**Files:**
- Create: `src/apps/artisan/components/devis/CreateLeadFromQuoteModal.jsx`

- [ ] **Step 1: Écrire la modale**

```jsx
/**
 * CreateLeadFromQuoteModal.jsx — crée un lead depuis un devis PL orphelin.
 * Le contact vient de Pennylane (canonical post-attache) ; l'admin ne choisit
 * QUE le commercial. Puis on enchaîne sur l'attache : le lead naît directement
 * en « Devis envoyé » avec son devis rattaché.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { X, Plus } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useLeadCommercials } from '@hooks/useLeads';
import { useAttachQuotesAndSend } from '@hooks/usePennylane';
import { leadsService } from '@services/leads.service';
import { pennylaneService } from '@services/pennylane.service';
import { formatEuro } from '@lib/utils';

/** Monté une fois le lead créé → leadId stable pour le hook d'attache. */
function AttachAfterCreate({ orgId, leadId, quote, onDone }) {
  const { attachQuotes } = useAttachQuotesAndSend(orgId, leadId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await attachQuotes([{
          quote_pl_id: quote.id,
          customer_id: quote.customer_id ?? null,
          amount_ht: quote.amount_ht ?? null,
          label: quote.quote_number || quote.label || null,
          date: quote.date || null,
          status: quote.status || null,
          pdf_url: quote.pdf_url || null,
        }]);
        if (!cancelled) {
          toast.success('Lead créé et devis rattaché');
          onDone();
        }
      } catch (e) {
        if (!cancelled) {
          // Le lead EXISTE déjà à ce stade : ne pas laisser croire à un échec total.
          toast.error(`Lead créé, mais rattachement échoué : ${e?.message || e}`);
          onDone();
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <p className="text-sm text-secondary-500 p-4">Rattachement du devis...</p>;
}

export function CreateLeadFromQuoteModal({ quote, onClose, onCreated }) {
  const { organization, user } = useAuth();
  const orgId = organization?.id;

  const { commercials } = useLeadCommercials(orgId);
  const [commercialId, setCommercialId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdLeadId, setCreatedLeadId] = useState(null);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      // Contact canonique = Pennylane (cf. règle « PL fait foi post-attache »).
      const { data: customer } = quote.customer_id
        ? await pennylaneService.fetchCustomerById(quote.customer_id, orgId)
        : { data: null };

      // API RÉELLE du service : extractCustomerName renvoie un OBJET
      // { firstName, lastName, fullName }, extractCustomerAddress renvoie
      // { address, postalCode, city }. Ce ne sont pas des extracteurs par champ.
      const { firstName, lastName, fullName } = customer
        ? pennylaneService.extractCustomerName(customer)
        : { firstName: '', lastName: '', fullName: '' };
      const { address, postalCode, city } = customer
        ? pennylaneService.extractCustomerAddress(customer)
        : { address: null, postalCode: null, city: null };

      const leadData = {
        orgId,
        userId: user?.id,
        first_name: firstName || '',
        last_name: lastName || fullName || quote.customer_name || 'CLIENT PENNYLANE',
        email: customer ? pennylaneService.extractCustomerEmail(customer) : null,
        phone: customer ? pennylaneService.extractCustomerPhone(customer) : null,
        address: address || null,
        postal_code: postalCode || null,
        city: city || null,
        // assigned_user_id porte l'ID de la table commercials (dual-ID bridge,
        // cf. Dashboard.jsx) — donc bien `commercial.id`, pas `profile_id`.
        assigned_user_id: commercialId || null,
      };

      const { data: lead, error } = await leadsService.createLead(leadData);
      if (error) throw error;

      setCreatedLeadId(lead?.id);
    } catch (e) {
      toast.error(`Création impossible : ${e?.message || e}`);
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-secondary-200">
          <div>
            <h2 className="font-semibold text-secondary-900">Créer le lead</h2>
            <p className="text-sm text-secondary-500">
              {quote.customer_name || 'Client inconnu'} · {formatEuro(quote.amount_ht)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-secondary-100">
            <X className="w-5 h-5 text-secondary-500" />
          </button>
        </div>

        {createdLeadId ? (
          <AttachAfterCreate orgId={orgId} leadId={createdLeadId} quote={quote} onDone={onCreated} />
        ) : (
          <>
            <div className="p-4 space-y-3">
              <p className="text-sm text-secondary-600">
                Le contact sera repris depuis Pennylane. Choisis le commercial à qui
                affecter ce lead.
              </p>
              <div>
                <label htmlFor="commercial" className="block text-sm font-medium text-secondary-700 mb-1">
                  Commercial
                </label>
                <select
                  id="commercial"
                  value={commercialId}
                  onChange={(e) => setCommercialId(e.target.value)}
                  className="w-full px-3 py-2 border border-secondary-200 rounded-lg text-sm"
                >
                  <option value="">Non assigné</option>
                  {(commercials || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.email || c.id}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-secondary-200">
              <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {isCreating ? 'Création...' : 'Créer et rattacher'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CreateLeadFromQuoteModal;
```

- [ ] **Step 2: Brancher la modale dans la page**

Dans `DevisExplorer.jsx`, ajouter l'import :

```javascript
import { CreateLeadFromQuoteModal } from '@apps/artisan/components/devis/CreateLeadFromQuoteModal';
```

Puis, à la place du commentaire `{/* Les modales Rattacher / Créer le lead ... */}` :

```jsx
      {createRow && (
        <CreateLeadFromQuoteModal
          quote={createRow}
          onClose={() => setCreateRow(null)}
          onCreated={() => { setCreateRow(null); refetch(); }}
        />
      )}
```

- [ ] **Step 3: Vérifier le build complet**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5 && npm run lint:errors
```

Attendu : build OK, 0 erreur.

- [ ] **Step 4: Commit**

```bash
git add src/apps/artisan/components/devis/CreateLeadFromQuoteModal.jsx
git commit -m "feat(devis): modale de création de lead depuis un devis orphelin"
```

---

### Task 11: Carte KPI Dashboard

**Files:**
- Modify: `src/apps/artisan/pages/Dashboard.jsx:201-301`

- [ ] **Step 1: Ajouter les imports**

```javascript
import { usePennylaneEnabled } from '@hooks/useOrgSettings';
import { useQuotesExplorer } from '@hooks/usePennylane';
```

Ajouter `FileSearch` à la liste d'icônes importées depuis `lucide-react`.

- [ ] **Step 2: Consommer le hook dans le composant**

Dans `Dashboard()`, après `const { kpis, todayAppointments, isLoading } = useDashboardHome(...)` :

```javascript
  // Voyant devis non rattachés — org_admin + Pennylane actif uniquement.
  // Même queryKey que la page /devis : le compteur ne peut pas diverger.
  const { isOrgAdmin } = useAuth();
  const pennylaneActive = usePennylaneEnabled();
  const showQuotesKpi = isOrgAdmin && pennylaneActive;
  const { orphanCount, error: quotesError } = useQuotesExplorer({ enabled: showQuotesKpi });
```

`isOrgAdmin` s'ajoute au destructuring existant de `useAuth()` en haut du composant — ne pas appeler `useAuth()` deux fois.

- [ ] **Step 3: Ajouter la carte et adapter le grid**

Remplacer la ligne d'ouverture du grid KPI :

```jsx
      <div className={`grid grid-cols-2 ${
        can('pipeline', 'view') && effectiveRole !== 'commercial'
          ? (showQuotesKpi ? 'lg:grid-cols-5' : 'lg:grid-cols-4')
          : 'lg:grid-cols-2'
      } gap-4`}>
```

Puis, après le bloc `can('chantiers', 'view') && ...`, ajouter :

```jsx
        {/* Devis PL non rattachés — masqué si Pennylane est injoignable
            (afficher « 0 » serait un mensonge, pas une information) */}
        {showQuotesKpi && !quotesError && (
          <KpiCard
            label="Devis non rattachés"
            value={orphanCount}
            icon={FileSearch}
            color="bg-rose-500"
            onClick={() => navigate('/devis')}
          />
        )}
```

- [ ] **Step 4: Vérifier**

```bash
cd /c/Dev/Frontend-Majordhome && npx vite build 2>&1 | tail -5 && npm run lint:errors
```

Attendu : build OK, 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add src/apps/artisan/pages/Dashboard.jsx
git commit -m "feat(dashboard): carte KPI devis non rattachés"
```

---

### Task 12: Vérification finale

- [ ] **Step 1: Suite complète**

```bash
cd /c/Dev/Frontend-Majordhome && node --test scripts/quotes-explorer.test.mjs && npm run lint:errors && npx vite build 2>&1 | tail -5
```

Attendu : `# fail 0`, 0 erreur ESLint, build OK.

- [ ] **Step 2: Code mort**

```bash
cd /c/Dev/Frontend-Majordhome && npm run audit:dead-code
```

Attendu : aucun des nouveaux fichiers ne remonte comme jamais importé.

- [ ] **Step 3: Vérifier qu'aucune trace du compteur supprimé ne subsiste**

```bash
cd /c/Dev/Frontend-Majordhome && grep -rn "useUnlinkedQuoteCount\|countUnlinkedQuotes\|unlinkedQuotesCount" src/ supabase/
```

Attendu : aucun résultat.

- [ ] **Step 4: Recette manuelle par Eric**

Parcours à valider en prod :
1. La carte KPI apparaît sur le Dashboard et affiche un nombre.
2. Le clic ouvre `/devis` ; **le nombre de cartes en vue Orphelins égale le compteur de la carte KPI**.
3. Un devis rattaché n'apparaît PAS en vue Orphelins, mais apparaît en vue Tous avec le nom du lead.
4. « Écarter » fait disparaître la carte ; elle réapparaît en vue Écartés ; « Réintégrer » la ramène.
5. Sélection multiple + « Écarter N devis » fonctionne.
6. « Rattacher » sur un lead existant : le devis quitte la vue Orphelins, le lead passe en « Devis envoyé ».
7. « Créer le lead » : le lead apparaît dans le pipeline en « Devis envoyé » avec son devis.

---

## Écarts assumés par rapport à la spec

- **La spec annonçait « pas de test automatisé ».** L'extraction du module pur `quotesExplorer.js`
  crée un module isolable qui *mérite* des tests (même pattern que `pvEngine` / `phoneUtils`). Task 3
  en ajoute 12. Le reste (I/O Pennylane, React) reste non testé, conformément à la spec.
- **`is_orphan` a été ajouté aux lignes** (la spec ne listait que `lead_id` / `lead_name` /
  `is_dismissed`). Il rend les filtres de vue lisibles et évite de recopier `!lead_id` à trois endroits.
