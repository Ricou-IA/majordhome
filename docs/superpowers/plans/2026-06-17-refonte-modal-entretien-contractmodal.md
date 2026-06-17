# Refonte UI modal Entretien (`ContractModal`) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nettoyer le slide-over `ContractModal`, le brancher sur le système d'entretien unifié pour planifier directement (RDV maintenance), factoriser la carte « Client lié » du pipeline, et corriger deux bugs de statut (refus année courante + historique « Non réalisé »).

**Architecture:** Le badge de statut Visite est dérivé en mémoire d'un helper pur (`deriveVisitBadgeStatus`) à partir des visites enregistrées + la carte entretien active. La planification réutilise une brique service unique `savService.scheduleEntretien(...)` (extraite du kanban). La carte « Client lié » devient un composant présentationnel partagé `LinkedClientCard`. Une colonne `client_number` est ajoutée à la vue `majordhome_contracts`.

**Tech Stack:** React 18, TanStack React Query v5, Supabase (vues publiques `security_invoker`), Tailwind, Lucide, Sonner. Tests purs via `node --test scripts/*.test.mjs`. Vérification build via `npx vite build` (pas de preview tools).

**Spec source :** `docs/superpowers/specs/2026-06-17-refonte-modal-entretien-contractmodal-design.md`

---

## File Structure

| Fichier | Responsabilité |
|---------|----------------|
| `src/lib/entretienVisitStatus.js` | **Création** — helper pur `deriveVisitBadgeStatus({ visits, activeCard, currentYear })` |
| `scripts/entretien-visit-status.test.mjs` | **Création** — tests `node --test` du helper |
| `src/apps/artisan/components/shared/LinkedClientCard.jsx` | **Création** — carte présentationnelle « Client lié » (slot action) |
| `src/shared/services/sav.service.js` | **Modif** — ajout `scheduleEntretien(...)` à l'objet `savService` |
| `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` | **Modif** — `handleConfirmSchedule` délègue à `scheduleEntretien` |
| `src/apps/artisan/components/pipeline/LeadFormSections.jsx` | **Modif** — `SectionClientLinking` utilise `LinkedClientCard` (iso-comportement) |
| `src/shared/hooks/useContracts.js` | **Modif** — ajout hook `useEntretienByContract(orgId, contractId)` |
| `src/apps/artisan/components/entretiens/VisitBadge.jsx` | **Modif** — ajout statuts `realise`/`planifie`/`a_planifier`/`non_realise` |
| `src/apps/artisan/components/entretiens/ContractModal.jsx` | **Modif** — refonte blocs Contrat/Visite/Historique + carte Client lié + Planifier |
| _(aucun)_ | `client_number` est **déjà exposé** par la vue `majordhome_contracts` (`cl.client_number`, `select('*')`) — aucune migration requise |

---

## Task 1 : Helper pur `deriveVisitBadgeStatus` (TDD)

**Files:**
- Create: `src/lib/entretienVisitStatus.js`
- Test: `scripts/entretien-visit-status.test.mjs`

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `scripts/entretien-visit-status.test.mjs` :

```js
// scripts/entretien-visit-status.test.mjs
// Tests de la dérivation du badge "Visite {année}" du modal entretien.
// Run : node --test scripts/entretien-visit-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveVisitBadgeStatus } from '../src/lib/entretienVisitStatus.js';

const YEAR = 2026;

test('visite année courante completed → realise', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'completed' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'realise');
});

test('visite année courante cancelled (refus) → non_realise (tâche close)', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'cancelled' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'non_realise');
});

test('visite année courante skipped → non_realise', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2026, status: 'skipped' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'non_realise');
});

test('aucune visite courante + carte planifie → planifie', () => {
  const r = deriveVisitBadgeStatus({ visits: [], activeCard: { workflow_status: 'planifie' }, currentYear: YEAR });
  assert.equal(r, 'planifie');
});

test('aucune visite courante + aucune carte → a_planifier', () => {
  const r = deriveVisitBadgeStatus({ visits: [], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});

test('aucune visite courante + carte a_planifier → a_planifier', () => {
  const r = deriveVisitBadgeStatus({ visits: [], activeCard: { workflow_status: 'a_planifier' }, currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});

test('seulement une visite d\'une année passée → a_planifier (on ne regarde que l\'année courante)', () => {
  const r = deriveVisitBadgeStatus({ visits: [{ visit_year: 2025, status: 'completed' }], activeCard: null, currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});

test('valeurs par défaut robustes (args vides)', () => {
  const r = deriveVisitBadgeStatus({ currentYear: YEAR });
  assert.equal(r, 'a_planifier');
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `node --test scripts/entretien-visit-status.test.mjs`
Expected: FAIL (`Cannot find module '../src/lib/entretienVisitStatus.js'`)

- [ ] **Step 3 : Implémenter le helper**

Créer `src/lib/entretienVisitStatus.js` :

```js
/**
 * entretienVisitStatus.js
 * Dérive le statut d'affichage du bloc "Visite {année}" du modal entretien.
 * Source unique = visites enregistrées (contract_visits) + carte entretien active.
 *
 * Fix bug : une visite refusée (cancelled) de l'année courante est une TÂCHE CLOSE
 * (≠ "à faire") → 'non_realise'. Idem 'skipped'.
 *
 * @param {Object} p
 * @param {Array<{visit_year:number,status:string}>} [p.visits]
 * @param {{workflow_status?:string}|null} [p.activeCard]
 * @param {number} p.currentYear
 * @returns {'realise'|'non_realise'|'planifie'|'a_planifier'}
 */
export function deriveVisitBadgeStatus({ visits = [], activeCard = null, currentYear }) {
  const currentYearVisit = (visits || []).find((v) => v.visit_year === currentYear);
  if (currentYearVisit?.status === 'completed') return 'realise';
  if (currentYearVisit) return 'non_realise'; // cancelled / skipped / autre = tâche close
  if (activeCard?.workflow_status === 'planifie') return 'planifie';
  return 'a_planifier';
}
```

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run: `node --test scripts/entretien-visit-status.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5 : Commit**

```bash
git add src/lib/entretienVisitStatus.js scripts/entretien-visit-status.test.mjs
git commit -m "feat(entretiens): helper pur deriveVisitBadgeStatus + tests"
```

---

## Task 2 : Composant partagé `LinkedClientCard`

**Files:**
- Create: `src/apps/artisan/components/shared/LinkedClientCard.jsx`

- [ ] **Step 1 : Créer le composant**

```jsx
// src/apps/artisan/components/shared/LinkedClientCard.jsx
import { UserCircle } from 'lucide-react';

/**
 * Carte présentationnelle "Client lié" partagée (pipeline + entretien).
 * Pure : aucune logique métier. Le bouton d'action est passé en `children`
 * (slot à droite) → chaque appelant câble son propre comportement.
 *
 * @param {Object} props
 * @param {string} props.name           - Nom affiché (gras)
 * @param {string} [props.clientNumber] - N° client (ex. CLI-03304)
 * @param {string} [props.city]         - Ville (ligne secondaire)
 * @param {React.ReactNode} [props.children] - Bouton d'action (droite)
 */
export function LinkedClientCard({ name, clientNumber, city, children }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
      <UserCircle className="h-5 w-5 text-blue-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-blue-800 truncate block">{name}</span>
        {(city || clientNumber) && (
          <span className="text-xs text-blue-600">
            {clientNumber}{city ? ` — ${city}` : ''}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export default LinkedClientCard;
```

- [ ] **Step 2 : Vérifier le lint**

Run: `npm run lint:errors`
Expected: aucune erreur (le composant n'est pas encore consommé — il le sera en Task 3, donc pas de mort-né).

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/shared/LinkedClientCard.jsx
git commit -m "feat(shared): composant presentational LinkedClientCard"
```

---

## Task 3 : `SectionClientLinking` (LeadModal) utilise `LinkedClientCard`

**Files:**
- Modify: `src/apps/artisan/components/pipeline/LeadFormSections.jsx` (~lignes 58-97)

Objectif : remplacer la carte bleue inline par `LinkedClientCard`, **sans changer le comportement** (bouton Modifier, délier, bandeau edit-mode conservés autour).

- [ ] **Step 1 : Ajouter l'import**

En haut de `LeadFormSections.jsx`, après les imports de composants existants, ajouter :

```jsx
import { LinkedClientCard } from '@/apps/artisan/components/shared/LinkedClientCard';
```

- [ ] **Step 2 : Remplacer la carte bleue inline**

Repérer le bloc actuel (la `<div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 ...">` jusqu'à sa fermeture, contenant `UserCircle`, `display_name`, `client_number`/`city`, et le bouton « Modifier »). Le remplacer par :

```jsx
<LinkedClientCard
  name={linkedClient.display_name}
  clientNumber={linkedClient.client_number}
  city={linkedClient.city}
>
  <button
    type="button"
    onClick={() => setEditClientMode(!editClientMode)}
    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors shrink-0 ${
      editClientMode
        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
        : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
    }`}
    title={editClientMode ? 'Désactiver la modification' : 'Modifier les infos client'}
  >
    <PenLine className="h-3 w-3" />
    {editClientMode ? 'Modification' : 'Modifier'}
  </button>
</LinkedClientCard>
```

> Conserver **tel quel** : le `<SectionTitle>Client lié</SectionTitle>` + bouton délier (`handleUnlinkClient`/`Unlink`) au-dessus, et le bandeau amber edit-mode en dessous. Ne pas toucher `UserCircle` reste-t-il importé ? → s'il n'est plus utilisé ailleurs dans le fichier, retirer l'import `UserCircle` (sinon le laisser).

- [ ] **Step 3 : Vérifier lint + build**

Run: `npm run lint:errors`
Expected: aucune erreur (ni warning nouveau).
Run: `npx vite build`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/apps/artisan/components/pipeline/LeadFormSections.jsx
git commit -m "refactor(pipeline): SectionClientLinking utilise LinkedClientCard"
```

---

## Task 4 : Brique partagée `savService.scheduleEntretien` + refactor kanban

**Files:**
- Modify: `src/shared/services/sav.service.js` (objet `savService`, `export const savService = {` à la ligne ~137)
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` (~lignes 17, 18, 195-243)

- [ ] **Step 1 : Ajouter `scheduleEntretien` à `savService`**

Dans `sav.service.js`, à l'intérieur de l'objet `savService`, ajouter la méthode (près de `updateWorkflowStatus`/`updateFields`) :

```js
  /**
   * Planifie une carte entretien/SAV : crée le(s) RDV (1 par créneau), pose la date
   * + workflow_status='planifie', confirme un éventuel brouillon Web.
   * Source unique appelée par le kanban ET le modal ContractModal.
   * @returns {{ error: any }}
   */
  async scheduleEntretien({ card, slots, includesEntretien = false, coreOrgId }) {
    try {
      if (!card?.id || !slots?.length) return { error: { message: 'invalid_args' } };
      const isSav = card.intervention_type === 'sav';

      const { appointmentsService } = await import('@services/appointments.service');
      const { error: appointmentError } = await appointmentsService.createAppointmentBatch(slots, {
        coreOrgId,
        appointment_type: isSav ? 'service' : 'maintenance',
        intervention_id: card.id,
        client_id: card.client_id || null,
        client_name: card.client_last_name || card.client_name || 'Sans nom',
        client_first_name: card.client_first_name || null,
        client_phone: card.client_phone || '',
        client_email: card.client_email || null,
        address: card.client_address || null,
        city: card.client_city || null,
        postal_code: card.client_postal_code || null,
        subjectPrefix: isSav ? (includesEntretien ? 'SAV + Entretien' : 'SAV') : 'Entretien',
      });
      if (appointmentError) return { error: appointmentError };

      const fields = { scheduled_date: slots[0].date };
      if (isSav && includesEntretien !== (card.includes_entretien || false)) {
        fields.includes_entretien = includesEntretien;
      }
      await savService.updateFields(card.id, fields);
      await savService.updateWorkflowStatus(card.id, 'planifie');

      if (card.client_id && card.tags?.includes('Web')) {
        const { clientsService } = await import('@services/clients.service');
        await clientsService.confirmWebDraft(card.client_id);
      }
      return { error: null };
    } catch (error) {
      console.error('[sav] scheduleEntretien error:', error);
      return { error };
    }
  },
```

> `appointmentsService` et `clientsService` sont importés **dynamiquement** (`await import(...)`) pour éviter tout cycle d'import (même pattern défensif que l'ancien kanban). `savService.updateFields`/`updateWorkflowStatus` sont référencés par le nom de la const du module (résolution paresseuse au runtime — OK).

- [ ] **Step 2 : Refactorer `handleConfirmSchedule` dans le kanban**

Dans `EntretienSAVKanban.jsx` :

(a) Import — ajouter `savService` à l'import sav.service (ligne ~17) et **retirer** l'import `appointmentsService` (ligne 18, devenu inutilisé) :

```jsx
import { KANBAN_COLUMNS, getTransitions, savService } from '@services/sav.service';
// (supprimer la ligne : import { appointmentsService } from '@services/appointments.service';)
```

(b) Remplacer tout le corps de `handleConfirmSchedule` (lignes ~195-243) par :

```jsx
  const handleConfirmSchedule = useCallback(async (slots, includesEntretien) => {
    if (!pendingTransition) return;
    if (!slots || slots.length === 0) return;
    const item = pendingTransition.item;
    try {
      const { error } = await savService.scheduleEntretien({
        card: item,
        slots,
        includesEntretien,
        coreOrgId: orgId,
      });
      if (error) {
        toast.error('Erreur lors de la planification');
        return;
      }
      toast.success('RDV planifié avec succès');
      setPendingTransition(null);
      refresh();
    } catch {
      toast.error('Erreur lors de la planification');
    }
  }, [pendingTransition, orgId, refresh]);
```

> Les fonctions `updateWorkflowStatus`/`updateFields` (du hook `useEntretienSAVMutations`) restent destructurées (toujours utilisées par les autres handlers : devis envoyé, pièces commandées, transition simple).

- [ ] **Step 3 : Vérifier lint + build**

Run: `npm run lint:errors`
Expected: aucune erreur, aucun warning nouveau (sinon : import `appointmentsService` oublié → le retirer).
Run: `npx vite build`
Expected: build OK.

- [ ] **Step 4 : Commit**

```bash
git add src/shared/services/sav.service.js src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx
git commit -m "refactor(entretiens): brique partagee savService.scheduleEntretien (kanban + modal)"
```

---

## Task 5 : ~~Migration `client_number`~~ — SANS OBJET

**Vérifié le 2026-06-17 via `pg_get_viewdef('public.majordhome_contracts')`** : la vue expose **déjà** `cl.client_number` (alias clients = `cl`), et `contractsService.getContractById` fait `.select('*')` → `contract.client_number` est **déjà disponible** dans `useContract`. **Aucune migration ni modification de service nécessaire.** La carte « Client lié » (Task 6) consomme directement `contract.client_number`. Passer à la Task 6.

---

## Task 6 : ContractModal — structure (Contrat / Client lié / suppression Fiche CRM & PDF)

**Files:**
- Modify: `src/apps/artisan/components/entretiens/ContractModal.jsx`

- [ ] **Step 1 : Imports**

En tête de fichier :
- Ajouter `import { LinkedClientCard } from '@/apps/artisan/components/shared/LinkedClientCard';`
- Ajouter `import { MAINTENANCE_MONTHS } from '@services/contracts.service';` (à côté de l'import existant `CONTRACT_STATUSES`)
- Retirer l'import `entretiensService` (devient inutilisé après suppression du PDF — cf. step 3) **et** retirer de la ligne d'icônes lucide celles qui ne servent plus : `Download`, `Globe` (et `CheckCircle2` sera retiré en Task 7).

- [ ] **Step 2 : Supprimer le bloc « Fiche CRM »**

Supprimer la `Section` « Fiche CRM » (le bloc `{contract.client_id && (<Section title="Fiche CRM" icon={ExternalLink}> ... Voir la fiche client CRM ... </Section>)}`, ~lignes 426-441). `ExternalLink` reste importé (réutilisé en step 4).

- [ ] **Step 3 : Réduire le bloc Contrat + retirer le bouton PDF**

Remplacer toute la `<Section title="Contrat" icon={FileText}>...</Section>` par :

```jsx
<Section title="Contrat" icon={FileText}>
  <InfoRow label="Tarif" value={formatEuro(contract.amount)} />
  <InfoRow
    label="Tps estimé"
    value={contract.estimated_time
      ? `${Math.round(Number(contract.estimated_time) * 60)} min`
      : '—'}
  />
  <InfoRow
    label="Mois d'entretien"
    value={MAINTENANCE_MONTHS.find((m) => m.value === contract.maintenance_month)?.label || '—'}
  />
</Section>
```

Puis supprimer le code mort associé au PDF : la fonction `handleGeneratePdf`, l'état `const [generatingPdf, setGeneratingPdf] = useState(false);`, et la dérivation `statusLabel`/`isActive` si elles ne servent plus (vérifier : `isActive` était aussi utilisé par le bouton « Marquer comme effectué » — il sera retiré en Task 7 ; le laisser pour l'instant si encore référencé, le nettoyage final est en Task 7).

- [ ] **Step 4 : Carte « Client lié » sous le bloc Client**

Juste **après** la `<Section title="Client" icon={User}>...</Section>`, insérer :

```jsx
{contract.client_id && (
  <div className="py-4 border-b border-gray-100">
    <LinkedClientCard
      name={contract.client_name}
      clientNumber={contract.client_number}
      city={contract.client_city}
    >
      <button
        type="button"
        onClick={() => { onClose(); navigate(`/clients/${contract.client_id}`); }}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors shrink-0"
        title="Voir la fiche client"
      >
        <ExternalLink className="h-3 w-3" />
        Voir la fiche
      </button>
    </LinkedClientCard>
  </div>
)}
```

- [ ] **Step 5 : Vérifier lint + build**

Run: `npm run lint:errors`
Expected: aucune erreur. Corriger tout import inutilisé signalé.
Run: `npx vite build`
Expected: build OK.

- [ ] **Step 6 : Commit**

```bash
git add src/apps/artisan/components/entretiens/ContractModal.jsx
git commit -m "feat(entretiens): modal contrat - bloc Contrat reduit + carte Client lie, retrait Fiche CRM/PDF"
```

---

## Task 7 : ContractModal — bloc Visite (badge dérivé + bouton Planifier) + hook `useEntretienByContract` + VisitBadge

**Files:**
- Modify: `src/shared/hooks/useContracts.js` (ajout hook)
- Modify: `src/apps/artisan/components/entretiens/VisitBadge.jsx` (ajout statuts)
- Modify: `src/apps/artisan/components/entretiens/ContractModal.jsx` (bloc Visite + scheduling)

- [ ] **Step 1 : Ajouter `useEntretienByContract` à `useContracts.js`**

Vérifier que `supabase` est importé dans le fichier (sinon `import { supabase } from '@/lib/supabaseClient';`). Ajouter le hook (après `useContractVisits`) :

```js
// ============================================================================
// HOOK - useEntretienByContract (carte entretien active d'un contrat)
// ============================================================================
export function useEntretienByContract(orgId, contractId) {
  const { data: card, isLoading } = useQuery({
    queryKey: [...entretienSavKeys.all(orgId), 'by-contract', contractId],
    queryFn: async () => {
      const { data } = await supabase
        .from('majordhome_entretien_sav')
        .select('id, workflow_status, next_rdv_date, scheduled_date')
        .eq('org_id', orgId)
        .eq('contract_id', contractId)
        .eq('intervention_type', 'entretien')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data || null;
    },
    enabled: !!orgId && !!contractId,
    staleTime: 30_000,
  });
  return { card, isLoading };
}
```

> `entretienSavKeys` est déjà importé dans `useContracts.js`. Vérifier l'import `supabase`.

- [ ] **Step 2 : Étendre `VisitBadge` avec les nouveaux statuts**

Dans `VisitBadge.jsx`, ajouter l'import `CalendarClock` à la ligne lucide (`import { Check, Clock, Minus, X, CalendarClock } from 'lucide-react';`) et ajouter au `VISIT_CONFIG` :

```js
  realise: {
    label: 'Réalisé',
    className: 'bg-green-100 text-green-800',
    Icon: Check,
  },
  planifie: {
    label: 'Planifié',
    className: 'bg-blue-100 text-blue-800',
    Icon: CalendarClock,
  },
  a_planifier: {
    label: 'À planifier',
    className: 'bg-amber-100 text-amber-800',
    Icon: Clock,
  },
  non_realise: {
    label: 'Non réalisé',
    className: 'bg-gray-100 text-gray-600',
    Icon: Minus,
  },
```

- [ ] **Step 3 : Brancher hooks + state + handlers dans ContractModal**

(a) Imports — ajouter :

```jsx
import { useContract, useContractVisits, useEntretienByContract } from '@hooks/useContracts';
import { ensureEntretienCard } from '@services/entretiens.service';
import { savService } from '@services/sav.service';
import { SchedulingTransitionModal } from './SchedulingTransitionModal';
import { entretienSavKeys, appointmentKeys, contractKeys } from '@hooks/cacheKeys';
import { useQueryClient } from '@tanstack/react-query';
import { deriveVisitBadgeStatus } from '@/lib/entretienVisitStatus';
import { CalendarPlus } from 'lucide-react';
```

> `useContract`/`useContractVisits` étaient déjà importés depuis `@hooks/useContracts` — ajouter `useEntretienByContract` à cet import existant plutôt que dupliquer la ligne. Retirer `useContractMutations` de l'import (le `recordVisit` n'est plus utilisé — cf. step 5).

(b) Dans le composant, retirer l'ancien state visite (`visitDate`, `visitNotes`, `showRecordForm`) et `const { recordVisit, isRecordingVisit } = useContractMutations();`. Ajouter :

```jsx
const queryClient = useQueryClient();
const { card: activeCard } = useEntretienByContract(organization?.id, contractId);
const [schedulingOpen, setSchedulingOpen] = useState(false);
const [schedulingItem, setSchedulingItem] = useState(null);
const [planning, setPlanning] = useState(false);
```

(c) Remplacer `handleRecordVisit` (et `handleGeneratePdf` s'il reste) par les deux handlers de planification :

```jsx
const handlePlanifier = useCallback(async () => {
  if (!contract || planning) return;
  setPlanning(true);
  try {
    const { interventionId, error } = await ensureEntretienCard({
      clientId: contract.client_id,
      contractId: contract.id,
      userId: user?.id,
    });
    if (error || !interventionId) {
      toast.error(error === 'client_sans_projet'
        ? 'Projet client introuvable — impossible de planifier'
        : 'Erreur lors de la préparation de la planification');
      return;
    }
    setSchedulingItem({
      id: interventionId,
      intervention_type: 'entretien',
      client_id: contract.client_id,
      client_name: contract.client_name,
      client_last_name: contract.client_name,
      client_first_name: null,
      client_phone: contract.client_phone || '',
      client_email: contract.client_email || null,
      client_address: contract.client_address || null,
      client_city: contract.client_city || null,
      client_postal_code: contract.client_postal_code || null,
      includes_entretien: false,
    });
    setSchedulingOpen(true);
  } catch (err) {
    console.error('[ContractModal] handlePlanifier error:', err);
    toast.error('Erreur lors de la planification');
  } finally {
    setPlanning(false);
  }
}, [contract, planning, user]);

const handleConfirmScheduling = useCallback(async (slots) => {
  const orgId = organization?.id;
  const { error } = await savService.scheduleEntretien({
    card: schedulingItem,
    slots,
    includesEntretien: false,
    coreOrgId: orgId,
  });
  if (error) { toast.error('Erreur création du RDV'); return; }
  toast.success('RDV planifié avec succès');
  setSchedulingOpen(false);
  setSchedulingItem(null);
  queryClient.invalidateQueries({ queryKey: [...entretienSavKeys.all(orgId), 'by-contract', contractId] });
  queryClient.invalidateQueries({ queryKey: entretienSavKeys.all(orgId) });
  queryClient.invalidateQueries({ queryKey: appointmentKeys.all(orgId) });
  queryClient.invalidateQueries({ queryKey: contractKeys.detail(orgId, contractId) });
  queryClient.invalidateQueries({ queryKey: [...contractKeys.all(orgId), 'visits', contractId] });
}, [organization, schedulingItem, contractId, queryClient]);
```

- [ ] **Step 4 : Remplacer le bloc « Visite {année} »**

Calculer le statut juste avant le `return` (remplace les anciennes lignes `isVisitDone`/`visitStatus`) :

```jsx
const currentYear = new Date().getFullYear();
const badgeStatus = deriveVisitBadgeStatus({ visits, activeCard, currentYear });
const nextVisitDate = activeCard?.next_rdv_date || contract?.next_maintenance_date;
```

Remplacer toute la `<Section title={\`Visite ${currentYear}\`} icon={Calendar}>...</Section>` par :

```jsx
<Section title={`Visite ${currentYear}`} icon={Calendar}>
  <div className="flex items-center justify-between">
    <span className="text-sm text-gray-500">Statut</span>
    <VisitBadge status={badgeStatus} size="md" />
  </div>
  {nextVisitDate && (
    <InfoRow label="Prochaine visite" value={formatDateFR(nextVisitDate)} />
  )}
  {badgeStatus === 'a_planifier' && (
    <div className="mt-3">
      <Button
        variant="outline"
        size="sm"
        className="w-full border-primary-300 text-primary-700 hover:bg-primary-50"
        onClick={handlePlanifier}
        disabled={planning}
      >
        {planning ? (
          <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Préparation…</>
        ) : (
          <><CalendarPlus className="h-4 w-4 mr-1.5" />Planifier</>
        )}
      </Button>
    </div>
  )}
</Section>
```

- [ ] **Step 5 : Monter `SchedulingTransitionModal` + nettoyage**

Avant la balise fermante `</>` finale du composant (après le `</div>` du panel), ajouter :

```jsx
{schedulingOpen && schedulingItem && (
  <SchedulingTransitionModal
    item={schedulingItem}
    orgId={organization?.id}
    onConfirm={handleConfirmScheduling}
    onCancel={() => { setSchedulingOpen(false); setSchedulingItem(null); }}
  />
)}
```

Nettoyage final : retirer les icônes lucide devenues inutilisées (`CheckCircle2`, `Clock` si plus utilisé directement, `Calendar` reste — utilisé par la Section). Retirer `statusLabel`/`isActive` désormais morts.

- [ ] **Step 6 : Vérifier lint + build**

Run: `npm run lint:errors`
Expected: aucune erreur, aucun warning nouveau (traiter chaque import/variable inutilisé).
Run: `npx vite build`
Expected: build OK.

- [ ] **Step 7 : Commit**

```bash
git add src/shared/hooks/useContracts.js src/apps/artisan/components/entretiens/VisitBadge.jsx src/apps/artisan/components/entretiens/ContractModal.jsx
git commit -m "feat(entretiens): modal contrat - statut Visite derive + bouton Planifier (assistant creneaux)"
```

---

## Task 8 : ContractModal — historique « — / Non réalisé »

**Files:**
- Modify: `src/apps/artisan/components/entretiens/ContractModal.jsx` (table historique)

- [ ] **Step 1 : Adapter le rendu des lignes d'historique**

Dans la `<Section title="Historique visites" icon={History}>`, remplacer le `visits.map((visit) => (...))` par :

```jsx
{visits.map((visit) => {
  const done = visit.status === 'completed';
  return (
    <tr key={visit.id} className="border-t border-gray-100">
      <td className="px-3 py-2 text-gray-900">{visit.visit_year}</td>
      <td className="px-3 py-2 text-gray-600">{done ? formatDateFR(visit.visit_date) : '—'}</td>
      <td className="px-3 py-2">
        <VisitBadge status={done ? 'completed' : 'non_realise'} />
      </td>
    </tr>
  );
})}
```

> Effet : toute visite non `completed` (cancelled/skipped) affiche date `—` + badge gris « Non réalisé ». `completed` → « Effectué » (vert, inchangé).

- [ ] **Step 2 : Vérifier lint + build**

Run: `npm run lint:errors`
Expected: aucune erreur.
Run: `npx vite build`
Expected: build OK.

- [ ] **Step 3 : Commit**

```bash
git add src/apps/artisan/components/entretiens/ContractModal.jsx
git commit -m "fix(entretiens): historique modal - visites non realisees affichent '-' + 'Non realise'"
```

---

## Task 9 : Vérification finale & smoke

**Files:** aucun (vérification).

- [ ] **Step 1 : Audit qualité complet**

Run: `npm run audit:quality`  (= `lint:errors` + `audit:dead-code`)
Expected: 0 erreur ESLint ; aucun nouveau fichier mort (LinkedClientCard est consommé par LeadModal + ContractModal ; `deriveVisitBadgeStatus` par ContractModal).

- [ ] **Step 2 : Build production**

Run: `npx vite build`
Expected: build OK, pas d'erreur.

- [ ] **Step 3 : Tests purs**

Run: `node --test scripts/entretien-visit-status.test.mjs`
Expected: PASS.

- [ ] **Step 4 : Smoke manuel (à faire valider par Eric sur son serveur de dev)**

Checklist :
1. Ouvrir le modal d'un contrat « à planifier » → bouton **Planifier** → poser un créneau → confirmer → badge passe **Planifié**, RDV visible au Planning, carte entretien créée.
2. Sur une fiche client, refuser la visite de l'année courante (onglet Contrat → « Proposé mais refusé ») → rouvrir le modal entretien → badge **Non réalisé** (plus « À faire »), bouton **Planifier** masqué.
3. Historique : années non réalisées affichent **« — »** + **« Non réalisé »** ; années faites → date + « Effectué ».
4. Bloc Contrat = **Tarif / Tps estimé / Mois d'entretien** seulement ; plus de Début/Fin/Statut/PDF.
5. Carte **Client lié** sous le bloc Client (n° client + ville) → **Voir la fiche** navigue vers `/clients/:id`.
6. **LeadModal** (pipeline) : carte client lié inchangée (Modifier toggle, délier OK).

- [ ] **Step 5 : Proposer la note CLAUDE.md (sans éditer sans accord)**

Proposer à Eric d'ajouter au CLAUDE.md (section Module Certificats/Entretien) une ligne sur la brique partagée `savService.scheduleEntretien` (source unique de planification entretien/SAV, appelée par le kanban ET ContractModal) + le helper `deriveVisitBadgeStatus`. **Ne pas éditer CLAUDE.md sans accord explicite** (cf. règle hooks auto-doc).

---

## Self-review (couverture spec)

| Exigence spec | Task |
|---------------|------|
| A. Bloc Client inchangé | (aucune) ✓ |
| B. Carte LinkedClientCard sous Client (Voir la fiche) + remplace Fiche CRM | Task 2, 6 |
| Migration LeadModal vers LinkedClientCard | Task 3 |
| C. Bloc Contrat = Tarif/Tps/Mois + retrait Début/Fin/Statut/Notes/Source/PDF | Task 6 |
| D. Badge Visite dérivé (realise/non_realise/planifie/a_planifier) + fix refus | Task 1, 7 |
| « Prochaine visite » = next_rdv_date ?? next_maintenance_date | Task 7 |
| Bouton Planifier → ensureEntretienCard → SchedulingTransitionModal → scheduleEntretien | Task 7 |
| E. Brique partagée scheduleEntretien (kanban + modal) | Task 4, 7 |
| F. Historique cancelled/skipped → « — » + « Non réalisé » | Task 8 |
| G. Hook useEntretienByContract | Task 7 |
| H. client_number dispo côté front | Déjà exposé par la vue (`cl.client_number` + `select('*')`) — Task 5 sans objet |
| Suppression code mort (recordVisit form, handleGeneratePdf, imports) | Task 6, 7 |
