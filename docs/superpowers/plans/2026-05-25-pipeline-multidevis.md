# Pipeline multi-devis Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre l'affichage du Kanban pipeline pour permettre N cartes par lead selon l'état de ses devis Pennylane attachés, en gardant `leads.status_id` pour les leads sans devis PL (mode classique).

**Architecture:** Vue SQL `public.majordhome_kanban_cards` calcule pour chaque org les cartes Kanban (1 lead → 1 ou 2 cartes selon mix devis pending/accepted/refused). Le front consomme cette vue via un hook React Query dédié. Un cron edge function sync les `quote_status` Pennylane → DB (sans toucher à `leads.status_id`).

**Tech Stack:** PostgreSQL (vue SQL), Supabase Edge Functions Deno, React 18 + Vite 5, TanStack React Query v5, Tailwind CSS, Lucide React (icons).

**Spec source:** `docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md`

---

## Conventions du projet (rappel pour agents)

- **Branche** : main (pas de worktrees, cf MEMORY.md préférences user)
- **Lint** : `npx eslint <file> --max-warnings 0` après chaque modif JS/JSX, **0 nouveau warning autorisé**
- **Build** : `npx vite build` pour valider (l'utilisateur a son propre dev server, **pas de `npm run dev` ni preview tools**)
- **Pre-commit hook** : ESLint errors check, bloque sur erreur
- **Format de commit** : `feat(pennylane): ...` ou `fix(...): ...` avec corps multi-ligne + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **DB migrations** : appliquer via MCP Supabase `apply_migration` (project_id `odspcxgafcqxjzrarsqf`) + créer fichier dans `supabase/migrations/`
- **Org Mayer** : `core.organizations.id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'`
- **Lead BERNA (cas test)** : `lead_id = 'd87ed67a-2b7d-4782-a3a3-6898d41dfd8b'`, 2 devis accepted

---

## PR 1 — Vue SQL `majordhome_kanban_cards`

Source unique de vérité pour le Kanban pipeline. Aucune modif d'UI à ce stade.

### Task 1.1 — Créer le fichier migration

**Files:**
- Create: `supabase/migrations/20260525_majordhome_kanban_cards.sql`

- [ ] **Step 1: Écrire le SQL complet de la vue**

```sql
-- supabase/migrations/20260525_majordhome_kanban_cards.sql
-- PR 1 Phase 1 pipeline multi-devis
-- Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §5
--
-- Vue qui matérialise les cartes Kanban : 1 lead peut générer 1 ou 2 cartes
-- selon mix des quote_status de ses devis Pennylane attachés.
-- Pennylane canonical : la vue ignore leads.status_id si le lead a des devis
-- attachés. Fallback sur status_id sinon (mode classique).

CREATE OR REPLACE VIEW public.majordhome_kanban_cards
WITH (security_invoker = true) AS
WITH lead_quote_stats AS (
  SELECT
    lpq.lead_id,
    lpq.org_id,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('pending','draft')) AS pending_count,
    COUNT(*) FILTER (WHERE lpq.quote_status = 'accepted') AS accepted_count,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('refused','denied','expired','canceled')) AS refused_count,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('pending','draft')) AS pending_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status = 'accepted') AS accepted_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('refused','denied','expired','canceled')) AS refused_sum
  FROM majordhome.lead_pennylane_quotes lpq
  WHERE lpq.ejected_at IS NULL
  GROUP BY lpq.lead_id, lpq.org_id
)
-- Cartes "Devis envoyé" depuis devis pending
SELECT
  l.id::text || ':devis_envoye' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  'devis_envoye'::text AS column_key,
  lqs.pending_count AS devis_count,
  ROUND(lqs.pending_sum)::numeric AS total_amount,
  lqs.pending_count,
  lqs.accepted_count,
  lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.pending_count > 0 AND COALESCE(l.is_deleted, false) = false

UNION ALL

-- Cartes "Gagné" depuis devis accepted
SELECT
  l.id::text || ':gagne' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  'gagne'::text AS column_key,
  lqs.accepted_count AS devis_count,
  ROUND(lqs.accepted_sum)::numeric AS total_amount,
  lqs.pending_count,
  lqs.accepted_count,
  lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.accepted_count > 0 AND COALESCE(l.is_deleted, false) = false

UNION ALL

-- Cartes "Perdu" UNIQUEMENT si 0 accepted (vraie perte commerciale)
SELECT
  l.id::text || ':perdu' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  'perdu'::text AS column_key,
  lqs.refused_count AS devis_count,
  ROUND(lqs.refused_sum)::numeric AS total_amount,
  lqs.pending_count,
  lqs.accepted_count,
  lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.refused_count > 0 AND lqs.accepted_count = 0 AND lqs.pending_count = 0
  AND COALESCE(l.is_deleted, false) = false

UNION ALL

-- Cartes mode classique : leads sans devis PL attaché → fallback leads.status_id
SELECT
  l.id::text || ':classic' AS card_key,
  l.id AS lead_id,
  l.org_id,
  'lead'::text AS card_type,
  CASE s.display_order
    WHEN 1 THEN 'nouveau'
    WHEN 2 THEN 'contacte'
    WHEN 3 THEN 'rdv_planifie'
    WHEN 4 THEN 'devis_envoye'
    WHEN 5 THEN 'gagne'
    WHEN 6 THEN 'perdu'
    ELSE 'unknown'
  END AS column_key,
  0 AS devis_count,
  COALESCE(l.order_amount_ht, 0)::numeric AS total_amount,
  0 AS pending_count,
  0 AS accepted_count,
  0 AS refused_count
FROM majordhome.leads l
LEFT JOIN majordhome.statuses s ON s.id = l.status_id
WHERE COALESCE(l.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM lead_quote_stats lqs WHERE lqs.lead_id = l.id
  );

COMMENT ON VIEW public.majordhome_kanban_cards IS
  'Cartes Kanban calculées : 1 lead avec devis PL peut générer 1-2 cartes selon mix quote_status. Leads sans devis PL en fallback sur status_id. Pennylane canonical pour le placement. Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md';
```

- [ ] **Step 2: Apply migration via MCP Supabase**

Via outil MCP `apply_migration` :
- `project_id`: `odspcxgafcqxjzrarsqf`
- `name`: `majordhome_kanban_cards`
- `query`: le contenu du fichier SQL ci-dessus (sans le commentaire de path)

Attendu : `{"success": true}`

- [ ] **Step 3: Valider la vue post-deploy (BERNA = 1 carte gagne)**

Exécuter via `execute_sql` :

```sql
SELECT card_key, column_key, devis_count, total_amount, pending_count, accepted_count, refused_count
FROM public.majordhome_kanban_cards
WHERE lead_id = 'd87ed67a-2b7d-4782-a3a3-6898d41dfd8b';
```

Attendu : 1 row avec `column_key='gagne'`, `devis_count=2`, `total_amount=11951`, `accepted_count=2`.

- [ ] **Step 4: Valider compteurs colonne Devis envoyé**

```sql
SELECT
  COUNT(*) AS cartes,
  SUM(total_amount) AS ca_total,
  SUM(devis_count) AS devis_total
FROM public.majordhome_kanban_cards
WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND column_key = 'devis_envoye';
```

Attendu : `cartes` >= 40, `ca_total` > 200000, `devis_total` >= 40.

- [ ] **Step 5: Valider mode classique (leads sans devis PL)**

```sql
SELECT COUNT(*) AS classic_cards
FROM public.majordhome_kanban_cards
WHERE org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND card_key LIKE '%:classic';
```

Attendu : `classic_cards` > 0 (la majorité des leads Mayer n'ont pas de devis PL attachés actuellement).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260525_majordhome_kanban_cards.sql
git commit -m "feat(pipeline): vue majordhome_kanban_cards multi-devis (PR 1 Phase 1)

Vue SQL qui matérialise les cartes Kanban depuis lead_pennylane_quotes.quote_status.
1 lead peut générer 1 ou 2 cartes selon mix pending/accepted/refused.
Leads sans devis PL : fallback sur leads.status_id (mode classique inchangé).

Validation post-deploy :
- BERNA HÉLÈNE : 1 carte gagne avec devis_count=2, total_amount=11951 ✓
- Colonne devis_envoye Mayer : 40+ cartes, CA total cohérent ✓
- Fallback mode classique : leads sans devis correctement matérialisés ✓

Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §5

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## PR 2 — Service + hook pour la vue

Couche data layer côté front. Aucun changement UI à ce stade.

### Task 2.1 — Cache keys

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js`

- [ ] **Step 1: Ajouter `kanbanCardKeys` dans cacheKeys.js**

Ouvrir `src/shared/hooks/cacheKeys.js`. Trouver la zone des autres exports de keys (ex après `leadKeys`). Ajouter :

```javascript
// --- Kanban Cards (Phase 1 pipeline multi-devis) ---
export const kanbanCardKeys = {
  all: (orgId) => ['kanban-cards', orgId],
  byColumn: (orgId, columnKey) => [...kanbanCardKeys.all(orgId), 'column', columnKey],
};
```

- [ ] **Step 2: Lint le fichier**

```bash
npx eslint src/shared/hooks/cacheKeys.js --max-warnings 0
```

Attendu : aucune sortie (0 erreur, 0 warning).

### Task 2.2 — Service `kanban.service.js`

**Files:**
- Create: `src/shared/services/kanban.service.js`

- [ ] **Step 1: Créer le service**

```javascript
/**
 * kanban.service.js — Majord'home Artisan
 * ============================================================================
 * Accès à la vue public.majordhome_kanban_cards (Phase 1 pipeline multi-devis).
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling } from '@/lib/serviceHelpers';

/**
 * Récupère toutes les cartes Kanban pour une org.
 * 1 lead peut produire 1 ou 2 cartes selon mix devis.
 *
 * @param {string} orgId
 * @returns {Promise<Array>} cartes avec { card_key, lead_id, org_id, card_type,
 *   column_key, devis_count, total_amount, pending_count, accepted_count, refused_count }
 */
async function getKanbanCards(orgId) {
  if (!orgId) return [];
  const { data, error } = await supabase
    .from('majordhome_kanban_cards')
    .select('*')
    .eq('org_id', orgId);
  if (error) throw error;
  return data || [];
}

export const kanbanService = {
  getKanbanCards: (orgId) => withErrorHandling(() => getKanbanCards(orgId), 'kanban.getKanbanCards'),
};
```

- [ ] **Step 2: Lint**

```bash
npx eslint src/shared/services/kanban.service.js --max-warnings 0
```

Attendu : aucune sortie.

### Task 2.3 — Hook `useKanbanCards`

**Files:**
- Create: `src/shared/hooks/useKanbanCards.js`

- [ ] **Step 1: Créer le hook**

```javascript
/**
 * useKanbanCards.js — Majord'home Artisan
 * ============================================================================
 * Hook React Query pour la vue majordhome_kanban_cards.
 * Retourne toutes les cartes (1 lead peut produire 1-2 cartes).
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md
 * ============================================================================
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@contexts/AuthContext';
import { kanbanService } from '@services/kanban.service';
import { kanbanCardKeys } from './cacheKeys';

/**
 * @returns {{ cards, isLoading, error, refetch }}
 */
export function useKanbanCards() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const query = useQuery({
    queryKey: kanbanCardKeys.all(orgId),
    queryFn: async () => {
      const { data, error } = await kanbanService.getKanbanCards(orgId);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });

  return {
    cards: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
```

- [ ] **Step 2: Lint**

```bash
npx eslint src/shared/hooks/useKanbanCards.js --max-warnings 0
```

Attendu : aucune sortie.

### Task 2.4 — Build + commit PR 2

- [ ] **Step 1: Build pour valider l'intégration**

```bash
npx vite build 2>&1 | tail -5
```

Attendu : `built in Xs` sans erreur. Pas de nouveau warning ESLint en CI.

- [ ] **Step 2: Commit**

```bash
git add src/shared/hooks/cacheKeys.js \
        src/shared/services/kanban.service.js \
        src/shared/hooks/useKanbanCards.js
git commit -m "feat(pipeline): service + hook pour majordhome_kanban_cards (PR 2 Phase 1)

Couche data layer pour le Kanban multi-devis :
- cacheKeys.js : famille kanbanCardKeys
- kanban.service.js : getKanbanCards(orgId) SELECT sur la vue
- useKanbanCards.js : hook React Query, staleTime 30s

Pas de UI dans cette PR. PR 3 consommera ce hook.

Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## PR 3 — Composants UI : QuoteSubCard + LeadCard étendu

### Task 3.1 — Composant `QuoteSubCard.jsx`

**Files:**
- Create: `src/apps/artisan/components/pipeline/QuoteSubCard.jsx`

- [ ] **Step 1: Créer le composant**

```jsx
/**
 * QuoteSubCard.jsx — Majord'home Artisan (pipeline)
 * ============================================================================
 * Ligne devis dans le bloc expand d'une LeadCard.
 * Affichage compact 1-ligne : numéro devis · statut · date · montant + lien externe PL.
 * Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §7
 * ============================================================================
 */

import { ExternalLink } from 'lucide-react';
import { formatEuro, formatDateShortFR } from '@/lib/utils';

const QUOTE_STATUS_CONFIG = {
  accepted: { label: '✓', color: '#1d4ed8', bgColor: '#dbeafe' },
  pending: { label: '⏳', color: '#b45309', bgColor: '#fef3c7' },
  draft: { label: '✎', color: '#6b7280', bgColor: '#f3f4f6' },
  denied: { label: '✗', color: '#4b5563', bgColor: '#e5e7eb' },
  refused: { label: '✗', color: '#4b5563', bgColor: '#e5e7eb' },
  expired: { label: '⌛', color: '#4b5563', bgColor: '#e5e7eb' },
  canceled: { label: '⊘', color: '#4b5563', bgColor: '#e5e7eb' },
};

function statusConfig(status) {
  return QUOTE_STATUS_CONFIG[status] || { label: '?', color: '#6b7280', bgColor: '#f3f4f6' };
}

export function QuoteSubCard({ quote }) {
  const cfg = statusConfig(quote.quote_status);
  return (
    <a
      href={`https://app.pennylane.com/quotes/${quote.pennylane_quote_id}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center justify-between gap-2 px-2 py-1 bg-white hover:bg-gray-50 border border-gray-100 rounded text-xs transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0"
          style={{ color: cfg.color, backgroundColor: cfg.bgColor }}
          title={quote.quote_status}
        >
          {cfg.label}
        </span>
        <span className="font-medium text-gray-700 truncate">
          {quote.quote_label || `#${quote.pennylane_quote_id}`}
        </span>
        {quote.quote_date && (
          <span className="text-gray-400 shrink-0">{formatDateShortFR(quote.quote_date)}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="font-semibold text-gray-900">
          {quote.quote_amount_ht != null ? formatEuro(Number(quote.quote_amount_ht)) : '—'}
        </span>
        <ExternalLink className="w-3 h-3 text-gray-400" />
      </div>
    </a>
  );
}

export default QuoteSubCard;
```

- [ ] **Step 2: Lint**

```bash
npx eslint src/apps/artisan/components/pipeline/QuoteSubCard.jsx --max-warnings 0
```

Attendu : aucune sortie.

### Task 3.2 — Modifier LeadCard.jsx pour le chip + expand

**Files:**
- Modify: `src/apps/artisan/components/pipeline/LeadCard.jsx`

- [ ] **Step 1: Lire le fichier actuel pour comprendre la structure**

```bash
# Via outil Read sur LeadCard.jsx en entier — repérer les imports, props, JSX render
```

- [ ] **Step 2: Ajouter les imports nécessaires**

Imports à ajouter en haut (à côté des existants) :
- `useState` (si pas déjà importé)
- Icônes `FileText, ChevronDown, ChevronUp` depuis `lucide-react`
- `useLinkedPennylaneQuotes` depuis `@hooks/usePennylane`
- `QuoteSubCard` depuis `./QuoteSubCard`

- [ ] **Step 3: Ajouter la signature de props pour la carte multi-devis**

Le composant `LeadCard` reçoit maintenant en plus :
- `card` (l'objet de la vue avec `devis_count`, `pending_count`, etc., `column_key`)

Si ces props ne sont pas fournies, le composant fonctionne en mode "classique" (rétro-compat avec LeadKanban legacy).

- [ ] **Step 4: Ajouter le state et fetch des devis**

Dans le body du composant, après les déclarations existantes :

```jsx
const [expanded, setExpanded] = useState(false);
const hasDevis = (card?.devis_count || 0) > 0;
const { linkedQuotes } = useLinkedPennylaneQuotes(hasDevis && expanded ? lead.id : null);

// Filtrer les devis selon la colonne (pertinents uniquement)
const filteredQuotes = (linkedQuotes || []).filter(q => {
  if (!card?.column_key) return true;
  const status = q.quote_status;
  if (card.column_key === 'devis_envoye') return ['pending', 'draft'].includes(status);
  if (card.column_key === 'gagne') return status === 'accepted';
  if (card.column_key === 'perdu') return ['refused', 'denied', 'expired', 'canceled'].includes(status);
  return true;
});
```

- [ ] **Step 5: Ajouter le chip + expand dans le JSX**

Trouver l'endroit dans le JSX où sont rendus les chips (source, commercial). Ajouter un nouveau chip après :

```jsx
{hasDevis && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
    className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium transition-colors"
    style={{
      backgroundColor: card.column_key === 'gagne' ? '#16a34a'
        : card.column_key === 'perdu' ? '#94a3b8'
        : '#1d4ed8',
      color: 'white',
    }}
    title="Voir les devis Pennylane attachés"
  >
    <FileText className="w-3 h-3" />
    {card.devis_count}
    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
  </button>
)}
```

- [ ] **Step 6: Ajouter le bloc expand**

À la fin du body de la carte (avant la fermeture du wrapper) :

```jsx
{expanded && filteredQuotes.length > 0 && (
  <div className="mt-2 flex flex-col gap-1">
    {filteredQuotes.map(q => (
      <QuoteSubCard key={q.id} quote={q} />
    ))}
  </div>
)}
```

- [ ] **Step 7: Lint**

```bash
npx eslint src/apps/artisan/components/pipeline/LeadCard.jsx --max-warnings 0
```

Attendu : aucune sortie OU uniquement des warnings préexistants (compter et noter).

### Task 3.3 — Build + commit PR 3

- [ ] **Step 1: Build**

```bash
npx vite build 2>&1 | tail -5
```

Attendu : `built in Xs` sans erreur.

- [ ] **Step 2: Commit**

```bash
git add src/apps/artisan/components/pipeline/QuoteSubCard.jsx \
        src/apps/artisan/components/pipeline/LeadCard.jsx
git commit -m "feat(pipeline): LeadCard chip 📄 N + expand devis (PR 3 Phase 1)

Nouveau composant QuoteSubCard.jsx — ligne devis 1-ligne dans le bloc expand.
LeadCard modifiée :
- Reçoit prop card avec devis_count, column_key
- Chip cliquable 'FileText + N + chevron' coloré selon colonne
- Bloc expand inline avec sous-cartes devis filtrées par column_key
- Clic stopPropagation pour ne pas ouvrir le LeadModal

Couleur du chip : bleu (Devis envoyé), vert (Gagné), gris (Perdu).
Taille compacte préservée (chip ajouté dans la rangée des chips existante).

PR 4 va connecter ça au LeadKanban via useKanbanCards.

Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §7

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## PR 4 — Refonte LeadKanban (consume `useKanbanCards`)

C'est le branchement final. À cette étape on consume la nouvelle vue et on affiche les N cartes par lead.

### Task 4.1 — Adapter LeadKanban.jsx

**Files:**
- Modify: `src/apps/artisan/components/pipeline/LeadKanban.jsx`

- [ ] **Step 1: Lire le fichier pour comprendre la structure actuelle**

Via outil Read sur LeadKanban.jsx en entier. Repérer comment le fichier actuellement :
- Fetch les leads (probablement via `useLeads` filtré par statut)
- Calcule les compteurs par colonne
- Itère sur les leads pour render `<LeadCard>`

- [ ] **Step 2: Importer `useKanbanCards`**

Ajouter en haut du fichier :

```javascript
import { useKanbanCards } from '@hooks/useKanbanCards';
```

- [ ] **Step 3: Remplacer le fetch des leads par useKanbanCards**

Remplacer `const { leads } = useLeads(...)` (ou similaire) par :

```javascript
const { cards, isLoading: cardsLoading } = useKanbanCards();

// Grouper les cartes par column_key
const cardsByColumn = useMemo(() => {
  const map = new Map();
  cards.forEach(c => {
    if (!map.has(c.column_key)) map.set(c.column_key, []);
    map.get(c.column_key).push(c);
  });
  return map;
}, [cards]);
```

- [ ] **Step 4: Adapter le rendu des colonnes**

Pour chaque colonne, récupérer ses cartes via `cardsByColumn.get(columnKey)`. Itérer par `card_key` (unique, peut avoir 2 par lead) :

```jsx
{cardsByColumn.get('devis_envoye')?.map(card => (
  <LeadCard
    key={card.card_key}
    leadId={card.lead_id}
    card={card}
    // ... autres props existantes
  />
))}
```

- [ ] **Step 5: Adapter les compteurs en tête de colonne**

```jsx
const devisEnvoyeColumn = cardsByColumn.get('devis_envoye') || [];
const devisEnvoyeCount = devisEnvoyeColumn.length;
const devisEnvoyeSum = devisEnvoyeColumn.reduce((sum, c) => sum + Number(c.total_amount || 0), 0);
```

Et dans le JSX du header colonne :

```jsx
<div className="font-semibold">Devis envoyé</div>
<div className="text-xs text-gray-500">{devisEnvoyeCount}</div>
<div className="text-xs text-gray-500">{formatEuro(devisEnvoyeSum)}</div>
```

Idem pour les autres colonnes (Gagné = "X clients", Perdu = "X clients").

- [ ] **Step 6: Adapter LeadCard caller dans le LeadKanban pour passer la prop `card`**

Vérifier que toutes les invocations de `<LeadCard>` dans LeadKanban passent maintenant `card={card}` en plus des props existantes.

- [ ] **Step 7: Lint**

```bash
npx eslint src/apps/artisan/components/pipeline/LeadKanban.jsx --max-warnings 0
```

Attendu : aucune sortie (modulo warnings préexistants).

### Task 4.2 — Test browser local

- [ ] **Step 1: Build production pour confirmer**

```bash
npx vite build 2>&1 | tail -5
```

Attendu : `built in Xs` sans erreur.

- [ ] **Step 2: Test manuel par l'utilisateur**

Demander à Eric de :
1. Refresh navigateur (Ctrl+F5)
2. Ouvrir le Kanban Pipeline
3. Vérifier :
   - Colonne "Devis envoyé" : 40+ cartes Mayer avec chip "📄 N" sur celles ayant des devis
   - Colonne "Gagné" : BERNA visible avec chip "📄 2" cliquable
   - Cliquer chip "📄 2" sur BERNA → expand 2 sous-cartes D-04106 + D-04107 avec lien Pennylane
   - Compteurs colonnes cohérents

Si OK : commit. Sinon : ajuster selon retours.

### Task 4.3 — Commit PR 4

- [ ] **Step 1: Commit**

```bash
git add src/apps/artisan/components/pipeline/LeadKanban.jsx
git commit -m "feat(pipeline): LeadKanban consume useKanbanCards multi-devis (PR 4 Phase 1)

LeadKanban refondu pour consommer la vue majordhome_kanban_cards.
1 lead peut désormais générer 1 ou 2 cartes (mix pending/accepted).

Changements :
- Remplace useLeads par useKanbanCards (nouvelle source de vérité)
- Itère par card_key (unique, 1 par carte Kanban) au lieu de lead_id
- Compteurs colonnes calculés depuis la vue (COUNT cartes + SUM total_amount)
- Chaque LeadCard reçoit la prop card pour le contexte de placement
  (column_key, devis_count) → permet l'affichage du chip et le filtre des sous-cartes

Test live BERNA : 1 carte Gagné avec chip 📄 2 cliquable, expand montre
D-04106 + D-04107 avec liens Pennylane. ✓

Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §5-7

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## PR 5 — Edge function cron `pennylane-sync-quote-status`

Sync des `quote_status` PL → DB + sync customer fields PL → MDH. Ne touche pas à `leads.status_id`.

### Task 5.1 — Créer l'edge function

**Files:**
- Create: `supabase/functions/pennylane-sync-quote-status/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Créer le fichier edge function**

```typescript
// supabase/functions/pennylane-sync-quote-status/index.ts
// Cron 15 min : sync quote_status Pennylane → DB + sync customer fields → clients MDH
// Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §9

import {
  requireSharedSecret,
  jsonResponse,
  getAdminClient,
  sanitizeError,
  buildCorsHeaders,
} from "../_shared/auth.ts";

interface PennylaneQuote {
  id: number;
  quote_number?: string;
  label?: string;
  date?: string;
  status?: string;
  currency_amount_before_tax?: number;
  customer?: { id?: number };
}

interface PennylaneCustomer {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  billing_email?: string;
  phone?: string;
  billing_phone?: string;
  billing_address?: {
    street?: string;
    postal_code?: string;
    city?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  // Auth : Bearer secret partagé
  const authResult = requireSharedSecret(req, Deno.env.get("MDH_CRON_SECRET") || "", "MDH_CRON_SECRET");
  if (!authResult.ok) return authResult.response;

  const supabase = getAdminClient();

  try {
    // 1. Charger les orgs Pennylane-activées
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, settings")
      .eq("settings->pennylane->>enabled", "true");

    if (orgsErr) throw orgsErr;
    if (!orgs || orgs.length === 0) {
      return jsonResponse({ success: true, processed_orgs: 0, message: "No PL-enabled orgs" }, 200, req);
    }

    const summary = {
      processed_orgs: 0,
      quote_status_updates: 0,
      customer_field_updates: 0,
      anomalies: 0,
      errors: [] as string[],
    };

    for (const org of orgs) {
      try {
        const orgResult = await syncOrgQuotes(supabase, org.id);
        summary.processed_orgs++;
        summary.quote_status_updates += orgResult.quote_status_updates;
        summary.customer_field_updates += orgResult.customer_field_updates;
        summary.anomalies += orgResult.anomalies;
      } catch (orgErr) {
        const msg = sanitizeError(orgErr, "Org sync failed");
        console.warn(`[pennylane-sync] org ${org.id} failed: ${msg}`);
        summary.errors.push(`org ${org.id}: ${msg}`);
      }
    }

    return jsonResponse({ success: true, ...summary }, 200, req);
  } catch (err) {
    const msg = sanitizeError(err, "Sync failed");
    console.error(`[pennylane-sync] global error: ${msg}`);
    return jsonResponse({ success: false, error: msg }, 500, req);
  }
});

async function syncOrgQuotes(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
): Promise<{ quote_status_updates: number; customer_field_updates: number; anomalies: number }> {
  let quote_status_updates = 0;
  let customer_field_updates = 0;
  let anomalies = 0;

  // 1. Récupérer les devis attachés actifs de cette org
  const { data: attachedQuotes, error: aqErr } = await supabase
    .from("majordhome_lead_pennylane_quotes")
    .select("id, lead_id, pennylane_quote_id, pennylane_customer_id, quote_status, is_winning_quote")
    .eq("org_id", orgId)
    .is("ejected_at", null);

  if (aqErr) throw aqErr;
  if (!attachedQuotes || attachedQuotes.length === 0) {
    return { quote_status_updates, customer_field_updates, anomalies };
  }

  // 2. Pour chaque devis : fetch /quotes/{id} via pennylane-proxy
  for (const aq of attachedQuotes) {
    try {
      const plQuote = await fetchPennylaneQuote(supabase, orgId, aq.pennylane_quote_id);

      if (!plQuote) {
        // Devis disparu côté PL → eject
        await supabase
          .schema("majordhome")
          .from("lead_pennylane_quotes")
          .update({ ejected_at: new Date().toISOString(), ejected_reason: "deleted_in_pennylane" })
          .eq("id", aq.id);
        anomalies++;
        continue;
      }

      // Sync quote_status si différent
      if (plQuote.status && plQuote.status !== aq.quote_status) {
        await supabase
          .schema("majordhome")
          .from("lead_pennylane_quotes")
          .update({ quote_status: plQuote.status })
          .eq("id", aq.id);
        quote_status_updates++;
      }
    } catch (e) {
      console.warn(`[pennylane-sync] quote ${aq.pennylane_quote_id} sync failed:`, e);
    }
  }

  // 3. Pose is_winning_quote sur le plus récent accepted si aucun winning posé
  await ensureWinningQuotePerLead(supabase, orgId);

  // 4. Sync customer fields (COALESCE strict, ne pas écraser avec NULL)
  customer_field_updates = await syncCustomerFields(supabase, orgId, attachedQuotes);

  return { quote_status_updates, customer_field_updates, anomalies };
}

async function fetchPennylaneQuote(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  quoteId: number | null,
): Promise<PennylaneQuote | null> {
  if (!quoteId) return null;
  const { data, error } = await supabase.functions.invoke("pennylane-proxy", {
    body: { method: "GET", path: `/quotes/${quoteId}`, org_id: orgId },
  });
  if (error) {
    if (error.message?.includes("404")) return null;
    throw error;
  }
  return data?.data || null;
}

async function ensureWinningQuotePerLead(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
) {
  // Pour chaque lead avec ≥1 accepted ET aucun is_winning_quote=true :
  //   poser is_winning_quote=true sur le plus récent accepted (pennylane_quote_id DESC)
  const { data: rows } = await supabase
    .rpc("pennylane_sync_ensure_winning_quotes", { p_org_id: orgId });
  return rows;
}

async function syncCustomerFields(
  supabase: ReturnType<typeof getAdminClient>,
  orgId: string,
  attachedQuotes: Array<{ pennylane_customer_id: number | null }>,
): Promise<number> {
  let updates = 0;
  const uniqueCustomerIds = Array.from(
    new Set(attachedQuotes.map((q) => q.pennylane_customer_id).filter(Boolean)),
  );

  for (const customerId of uniqueCustomerIds) {
    try {
      const { data: plCustomerResp } = await supabase.functions.invoke("pennylane-proxy", {
        body: { method: "GET", path: `/customers/${customerId}`, org_id: orgId },
      });
      const plCustomer: PennylaneCustomer | null = plCustomerResp?.data || null;
      if (!plCustomer) continue;

      // Trouver le mapping pennylane_sync
      const { data: syncRow } = await supabase
        .from("majordhome_pennylane_sync")
        .select("local_id")
        .eq("org_id", orgId)
        .eq("entity_type", "client")
        .eq("pennylane_id", customerId)
        .maybeSingle();

      if (!syncRow?.local_id) continue;

      const clientId = syncRow.local_id;
      const updatePayload: Record<string, unknown> = {};
      if (plCustomer.first_name) updatePayload.first_name = plCustomer.first_name;
      if (plCustomer.last_name) updatePayload.last_name = plCustomer.last_name;
      if (plCustomer.email || plCustomer.billing_email) {
        updatePayload.email = plCustomer.billing_email || plCustomer.email;
      }
      if (plCustomer.phone || plCustomer.billing_phone) {
        updatePayload.phone = plCustomer.billing_phone || plCustomer.phone;
      }
      if (plCustomer.billing_address?.street) updatePayload.address = plCustomer.billing_address.street;
      if (plCustomer.billing_address?.postal_code) updatePayload.postal_code = plCustomer.billing_address.postal_code;
      if (plCustomer.billing_address?.city) updatePayload.city = plCustomer.billing_address.city;

      if (Object.keys(updatePayload).length > 0) {
        await supabase
          .schema("majordhome")
          .from("clients")
          .update({ ...updatePayload, updated_at: new Date().toISOString() })
          .eq("id", clientId)
          .eq("org_id", orgId);
        updates++;
      }
    } catch (e) {
      console.warn(`[pennylane-sync] customer ${customerId} sync failed:`, e);
    }
  }
  return updates;
}
```

- [ ] **Step 2: Créer la RPC helper pour le winning quote**

Via MCP `apply_migration` :
- `name`: `pennylane_sync_ensure_winning_quotes`
- `query`:

```sql
CREATE OR REPLACE FUNCTION public.pennylane_sync_ensure_winning_quotes(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = majordhome, public, core
AS $function$
DECLARE
  v_updates int := 0;
  v_lead_id uuid;
  v_quote_id uuid;
BEGIN
  -- Pour chaque lead avec ≥1 accepted ET aucun is_winning_quote=true :
  --   poser is_winning_quote=true sur le plus récent accepted
  FOR v_lead_id IN
    SELECT DISTINCT lpq.lead_id
    FROM majordhome.lead_pennylane_quotes lpq
    WHERE lpq.org_id = p_org_id
      AND lpq.ejected_at IS NULL
      AND lpq.quote_status = 'accepted'
    EXCEPT
    SELECT DISTINCT lpq2.lead_id
    FROM majordhome.lead_pennylane_quotes lpq2
    WHERE lpq2.org_id = p_org_id
      AND lpq2.ejected_at IS NULL
      AND lpq2.is_winning_quote = true
  LOOP
    SELECT id INTO v_quote_id
    FROM majordhome.lead_pennylane_quotes
    WHERE lead_id = v_lead_id
      AND ejected_at IS NULL
      AND quote_status = 'accepted'
    ORDER BY pennylane_quote_id DESC
    LIMIT 1;

    IF v_quote_id IS NOT NULL THEN
      UPDATE majordhome.lead_pennylane_quotes
      SET is_winning_quote = true
      WHERE id = v_quote_id;
      v_updates := v_updates + 1;
    END IF;
  END LOOP;

  RETURN v_updates;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.pennylane_sync_ensure_winning_quotes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pennylane_sync_ensure_winning_quotes(uuid) TO service_role;

COMMENT ON FUNCTION public.pennylane_sync_ensure_winning_quotes(uuid) IS
  'Pour chaque lead avec ≥1 accepted ET aucun winning posé, pose is_winning_quote=true sur le plus récent. Appelée par le cron pennylane-sync-quote-status. service_role only.';
```

- [ ] **Step 3: Déclarer verify_jwt:false dans config.toml**

Modifier `supabase/config.toml` pour ajouter à la fin (ou compléter section functions) :

```toml
[functions.pennylane-sync-quote-status]
verify_jwt = false
```

- [ ] **Step 4: Déployer l'edge function**

Via MCP `deploy_edge_function` :
- `project_id`: `odspcxgafcqxjzrarsqf`
- `name`: `pennylane-sync-quote-status`
- `files`: array contenant `index.ts` (le contenu créé en Step 1) + `../_shared/auth.ts` (helper existant)
- `verify_jwt`: false

### Task 5.2 — Test cron + configurer cron N8n/Supabase

- [ ] **Step 1: Test manuel via curl**

```bash
curl -X POST 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/pennylane-sync-quote-status' \
  -H "Authorization: Bearer $MDH_CRON_SECRET" \
  -H "Content-Type: application/json"
```

Attendu : `{"success": true, "processed_orgs": 1, ...}`.

- [ ] **Step 2: Vérifier les updates en DB**

Via execute_sql :

```sql
SELECT lpq.pennylane_quote_id, lpq.quote_status, lpq.is_winning_quote
FROM majordhome.lead_pennylane_quotes lpq
JOIN majordhome.leads l ON l.id = lpq.lead_id
WHERE l.org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
  AND lpq.ejected_at IS NULL
ORDER BY lpq.pennylane_quote_id DESC
LIMIT 10;
```

Vérifier que des `quote_status` ont changé (si Pennylane a des nouveaux statuts) ou que c'est idempotent (no-op si déjà à jour).

- [ ] **Step 3: Configurer le cron (N8n ou Supabase Cron)**

Soit via N8n (workflow toutes les 15 min qui POST sur l'edge avec Bearer MDH_CRON_SECRET), soit via Supabase Cron extension :

```sql
SELECT cron.schedule(
  'pennylane-sync-quote-status',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/pennylane-sync-quote-status',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'MDH_CRON_SECRET')
      )
    );
  $$
);
```

(Pattern à adapter selon ce qui est en place dans le projet.)

### Task 5.3 — Commit PR 5

- [ ] **Step 1: Commit**

```bash
git add supabase/functions/pennylane-sync-quote-status/index.ts \
        supabase/config.toml
git commit -m "feat(pennylane): edge function cron sync quote_status (PR 5 Phase 1)

Edge function pennylane-sync-quote-status (verify_jwt:false + MDH_CRON_SECRET) :
- Toutes les 15 min, pour chaque org Pennylane-activée
- Sync quote_status PL → lead_pennylane_quotes (si différent)
- Devis disparu PL (404) → eject avec reason 'deleted_in_pennylane'
- Pose is_winning_quote sur le plus récent accepted via RPC helper
- Sync customer fields PL → clients MDH (COALESCE strict, ne pas écraser NULL)
- PAS de bascule leads.status_id (Pennylane canonical via la vue kanban_cards)

RPC helper : public.pennylane_sync_ensure_winning_quotes(p_org_id),
service_role only, REVOKE anon/authenticated.

config.toml : verify_jwt = false sur la nouvelle edge.

Cron N8n à configurer séparément (toutes les 15 min, POST avec Bearer).

Spec : docs/superpowers/specs/2026-05-25-pipeline-multidevis-design.md §9

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-review du plan

Effectué :

**1. Spec coverage** :
- §1-3 (Contexte/Scope/Décisions) → couvert implicitement par toutes les PRs
- §4 (Architecture) → couvert par PR 1 (data) + PR 2 (service/hook) + PR 3-4 (UI) + PR 5 (cron)
- §5 (Modèle data + vue SQL) → Task 1.1 ✓
- §6 (Règles de placement) → encodé dans la vue (Task 1.1) + filtre `filteredQuotes` dans LeadCard (Task 3.2 Step 4)
- §7 (Affichage carte) → QuoteSubCard (Task 3.1) + LeadCard chip+expand (Task 3.2)
- §8 (Montant par carte) → géré dans la vue (`ROUND(SUM(...))`) — Task 1.1
- §9 (Cron) → Task 5.1 ✓
- §10 (KPI compteurs) → calcul depuis la vue dans LeadKanban (Task 4.1 Step 5)
- §11 (Cas limites) → encodés dans la vue (Task 1.1) + cron (Task 5.1)
- §12 (Compatibilité Phase 2) → garanti par l'absence de nouvelle table en Phase 1
- §13-14 (Risques/Limitations) → documentés, pas d'action plan
- §15 (Travaux annexes) → hors scope Phase 1

**2. Placeholder scan** : aucun TBD/TODO. Tous les blocs code sont complets.

**3. Type consistency** :
- `card_key` utilisé cohéremment (Task 1.1, 4.1)
- `column_key` valeurs : `devis_envoye`, `gagne`, `perdu` (Task 1.1, 3.2 Step 4, 4.1)
- `card.devis_count`, `card.column_key`, `card.total_amount` cohérents partout
- `kanbanCardKeys` exporté depuis cacheKeys (Task 2.1) et importé dans useKanbanCards (Task 2.3) ✓
- `useKanbanCards()` retourne `{ cards, isLoading, error, refetch }` cohéremment

Pas d'incohérences détectées.

---

**Plan complet écrit. Spec couverte. 5 PRs séquentielles, 14 tâches, ~60 étapes.**

**Estimation totale** : 1-2 sessions de dev (la majorité du code est déjà cadré).
