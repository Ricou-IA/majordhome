# SMS de rappel d'entretien — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une bulle SMS « rappel d'entretien » dans l'onglet Programmation (`SectorGroupView`), envoyée via N8N, visible uniquement sur les contrats « à planifier », avec état « envoyé » dérivé de `sms_logs` et réinitialisé chaque année.

**Architecture:** La bulle appelle un handler du parent (`Entretiens.jsx`) → `savService.sendEntretienReminder()` → webhook N8N (campagne dédiée `rappel_entretien`). L'état « déjà rappelé cette année » est dérivé d'une query sur `majordhome_sms_logs` (option A, pas de migration). N8N (hors code) envoie le SMS et **log obligatoirement dans `sms_logs`**.

**Tech Stack:** React 18, TanStack Query v5, Supabase JS, Tailwind, lucide-react, sonner. Tests purs via `node --test`. Vérif UI via `npx vite build` + `npm run lint:errors` (pas de preview tools — serveur de dev géré par Eric).

**Spec source:** `docs/superpowers/specs/2026-06-16-sms-rappel-entretien-design.md`

---

## File Structure

| Fichier | Responsabilité | Action |
|---------|----------------|--------|
| `src/lib/phoneUtils.js` | Helper pur `isMobileFR` partagé | Modifier (+ fonction) |
| `scripts/phone-utils.test.mjs` | Test unitaire de `isMobileFR` | Créer |
| `src/shared/services/sav.service.js` | Méthode `sendEntretienReminder` + refactor `sendAvisRequest` | Modifier |
| `src/shared/hooks/cacheKeys.js` | Clé `smsKeys.remindedClients` | Modifier |
| `src/apps/artisan/pages/Entretiens.jsx` | Query `remindedClientIds` + handler + props | Modifier |
| `src/apps/artisan/components/entretiens/SectorGroupView.jsx` | Sous-composant `ContractRow` + bulle SMS | Modifier |
| `.env` (+ `.env.example` si présent) | `VITE_N8N_WEBHOOK_SMS_RAPPEL` | Modifier (Eric) |

---

## Task 1 — Extraire `isMobileFR` dans phoneUtils (TDD)

**Files:**
- Create: `scripts/phone-utils.test.mjs`
- Modify: `src/lib/phoneUtils.js` (ajout fonction)
- Modify: `src/shared/services/sav.service.js` (import + suppression closure locale)

- [ ] **Step 1 : Écrire le test qui échoue**

Create `scripts/phone-utils.test.mjs` :
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMobileFR } from '../src/lib/phoneUtils.js';

test('isMobileFR — mobiles nationaux 06/07', () => {
  assert.equal(isMobileFR('0612345678'), true);
  assert.equal(isMobileFR('0712345678'), true);
  assert.equal(isMobileFR('06 12 34 56 78'), true);
  assert.equal(isMobileFR('06.12.34.56.78'), true);
});

test('isMobileFR — formats internationaux', () => {
  assert.equal(isMobileFR('+33612345678'), true);
  assert.equal(isMobileFR('0033712345678'), true);
  assert.equal(isMobileFR('33612345678'), true);
});

test('isMobileFR — rejette fixes et invalides', () => {
  assert.equal(isMobileFR('0512345678'), false); // fixe 05
  assert.equal(isMobileFR('0123456789'), false); // fixe 01
  assert.equal(isMobileFR(''), false);
  assert.equal(isMobileFR(null), false);
  assert.equal(isMobileFR(undefined), false);
  assert.equal(isMobileFR('bonjour'), false);
});
```

- [ ] **Step 2 : Lancer le test → échec attendu**

Run: `node --test scripts/phone-utils.test.mjs`
Expected: FAIL (`isMobileFR` n'est pas exporté → `The "isMobileFR" is not a function` ou import undefined).

- [ ] **Step 3 : Ajouter `isMobileFR` à phoneUtils**

Append à la fin de `src/lib/phoneUtils.js` (après `formatPhoneForSearch`, ligne 41) :
```js

/**
 * Teste si un numéro est un mobile français (06/07), au format national
 * (0612345678) ou international (+33/0033/33). Tolère espaces, points, tirets.
 * @param {string} phone - Numéro brut
 * @returns {boolean}
 */
export function isMobileFR(phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/[\s.-]/g, '');
  return /^0[67]\d{8}$/.test(cleaned) || /^(?:\+33|0033|33)[67]\d{8}$/.test(cleaned);
}
```

- [ ] **Step 4 : Lancer le test → succès attendu**

Run: `node --test scripts/phone-utils.test.mjs`
Expected: PASS (3 tests, 0 fail).

- [ ] **Step 5 : Refactor `sendAvisRequest` pour consommer le helper**

Dans `src/shared/services/sav.service.js`, ajouter l'import après la ligne 18 (`import { entretiensService } from './entretiens.service';`) :
```js
import { isMobileFR } from '@/lib/phoneUtils';
```

Puis dans `sendAvisRequest`, **supprimer** la closure locale `isMobileFR` (les lignes actuelles) :
```js
    // Détection mobile FR : 06/07 au format national ou international
    const isMobileFR = (phone) => {
      if (!phone) return false;
      const cleaned = String(phone).replace(/[\s.-]/g, '');
      return /^0[67]\d{8}$/.test(cleaned) || /^(?:\+33|0033|33)[67]\d{8}$/.test(cleaned);
    };

```
La fonction `isMobileFR` importée prend le relais (comportement identique). Conserver le reste (`normalize`, boucle, etc.) tel quel.

- [ ] **Step 6 : Re-lancer le test + lint**

Run: `node --test scripts/phone-utils.test.mjs`
Expected: PASS.
Run: `npm run lint:errors`
Expected: aucune erreur.

- [ ] **Step 7 : Commit**

```bash
git add scripts/phone-utils.test.mjs src/lib/phoneUtils.js src/shared/services/sav.service.js
git commit -m "refactor(sms): extrait isMobileFR dans phoneUtils (+ test) et le partage avec sendAvisRequest"
```

---

## Task 2 — Méthode `sendEntretienReminder` dans sav.service.js

**Files:**
- Modify: `src/shared/services/sav.service.js` (nouvelle méthode après `sendAvisRequest`)

- [ ] **Step 1 : Ajouter la méthode**

Dans l'objet `savService`, insérer la méthode **juste après** `sendAvisRequest` (après son `},` de fermeture, avant le `};` final de l'objet) :
```js

  /**
   * Envoie un SMS de rappel d'entretien à un client sous contrat.
   * Campagne 'rappel_entretien' (distincte de l'avis 'avis_j1'). Mono-destinataire.
   * Déclenché depuis l'onglet Programmation (SectorGroupView).
   * N8N envoie le SMS ET log dans sms_logs (campaign_name='rappel_entretien').
   */
  async sendEntretienReminder({ contractId, clientId, clientFirstName, clientName, clientPhone, orgId }) {
    const webhookUrl = import.meta.env.VITE_N8N_WEBHOOK_SMS_RAPPEL;
    if (!webhookUrl) {
      console.error('[sav] VITE_N8N_WEBHOOK_SMS_RAPPEL non configuré');
      return { data: null, error: new Error('Webhook SMS rappel non configuré') };
    }

    if (!isMobileFR(clientPhone)) {
      const reason = clientPhone
        ? 'Aucun numéro mobile (06/07) disponible pour ce client'
        : 'Le client n\'a pas de numéro de téléphone';
      return { data: null, error: new Error(reason) };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_id: contractId,
          client_id: clientId,
          client_first_name: clientFirstName,
          client_name: clientName,
          client_phone: clientPhone,
          org_id: orgId,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
      }
      await response.json();
      return { data: { success: true }, error: null };
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        // Timeout = N8N traite en background, considéré comme succès
        return { data: { success: true }, error: null };
      }
      console.error('[sav] sendEntretienReminder error:', err);
      return { data: null, error: err };
    }
  },
```

- [ ] **Step 2 : Lint**

Run: `npm run lint:errors`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add src/shared/services/sav.service.js
git commit -m "feat(sms): savService.sendEntretienReminder (webhook N8N rappel entretien)"
```

---

## Task 3 — Cache key + branchement Entretiens.jsx

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` (clé `remindedClients`)
- Modify: `src/apps/artisan/pages/Entretiens.jsx` (import, query, handler, props)

- [ ] **Step 1 : Ajouter la cache key**

Dans `src/shared/hooks/cacheKeys.js`, remplacer le bloc `smsKeys` (lignes 175-179) par :
```js
export const smsKeys = {
  all: (orgId) => ['sms', orgId],
  byClient: (orgId, clientId) => [...smsKeys.all(orgId), 'client', clientId],
  byIntervention: (orgId, interventionId) => [...smsKeys.all(orgId), 'intervention', interventionId],
  remindedClients: (orgId, year) => [...smsKeys.all(orgId), 'reminded-clients', year],
};
```

- [ ] **Step 2 : Importer `smsKeys` dans Entretiens.jsx**

Ajouter après la ligne 43 (`import { useEntretienSAVStats, entretienSavKeys } from '@hooks/useEntretienSAV';`) :
```js
import { smsKeys } from '@hooks/cacheKeys';
```

- [ ] **Step 3 : Ajouter la query `remindedClientIds`**

Dans `Entretiens.jsx`, **juste après** la query `plannedContractIds` (après son `});` de fermeture, avant le commentaire `// ---------- Planning state ----------`) :
```js

  // Clients ayant déjà reçu le SMS de rappel cette année (campagne 'rappel_entretien').
  // Dérivé de sms_logs (option A — pas de colonne dédiée). Réinit. au 01/01.
  const { data: remindedClientIds } = useQuery({
    queryKey: smsKeys.remindedClients(orgId, currentYear),
    queryFn: async () => {
      const yearStart = new Date(currentYear, 0, 1).toISOString();
      const { data } = await supabase
        .from('majordhome_sms_logs')
        .select('client_id')
        .eq('org_id', orgId)
        .eq('campaign_name', 'rappel_entretien')
        .gte('sent_at', yearStart);
      return new Set((data || []).map((r) => r.client_id).filter(Boolean));
    },
    enabled: !!orgId,
    staleTime: 30_000,
  });
```

- [ ] **Step 4 : Ajouter le handler `handleSendReminder`**

Dans `Entretiens.jsx`, **juste après** `handlePlanSector` (après son `);` de fermeture du `useCallback`, avant `// ---------- Loader initial ----------`) :
```js

  // Envoyer un SMS de rappel d'entretien (depuis l'onglet Programmation).
  // Renvoie { data, error } pour que la ligne gère son état visuel.
  const handleSendReminder = useCallback(
    async (contract) => {
      const res = await savService.sendEntretienReminder({
        contractId: contract.id,
        clientId: contract.client_id,
        clientFirstName: contract.client_first_name,
        clientName: contract.client_name,
        clientPhone: contract.client_phone,
        orgId,
      });
      if (!res.error) {
        queryClient.invalidateQueries({
          queryKey: smsKeys.remindedClients(orgId, currentYear),
        });
      }
      return res;
    },
    [orgId, currentYear, queryClient],
  );
```

- [ ] **Step 5 : Passer les 3 props à `<SectorGroupView>`**

Dans le `<TabsContent value="programmation">`, ajouter après `plannedContractIds={plannedContractIds}` :
```jsx
            remindedClientIds={remindedClientIds}
            onSendReminder={handleSendReminder}
            canSendReminder={canCreateContract}
```

- [ ] **Step 6 : Lint**

Run: `npm run lint:errors`
Expected: aucune erreur.

- [ ] **Step 7 : Commit**

```bash
git add src/shared/hooks/cacheKeys.js src/apps/artisan/pages/Entretiens.jsx
git commit -m "feat(sms): query remindedClientIds + handler rappel dans Entretiens (option A)"
```

---

## Task 4 — Bulle SMS dans SectorGroupView

**Files:**
- Modify: `src/apps/artisan/components/entretiens/SectorGroupView.jsx`

- [ ] **Step 1 : Mettre à jour les imports**

Remplacer le bloc d'imports (lignes 16-28) par :
```js
import { useState, useMemo } from 'react';
import {
  MapPin,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Check,
  Clock,
  Calendar,
  Loader2,
  Map,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { VisitBadge } from './VisitBadge';
import { SearchBar } from '../shared/SearchBar';
```

- [ ] **Step 2 : Remplacer `SectorContracts` par `ContractRow` + `SectorContracts`**

Remplacer **toute** la fonction `SectorContracts` (de `function SectorContracts({` jusqu'à son `}` de fermeture, lignes 131-225) par :
```jsx
function ContractRow({
  contract,
  onContractClick,
  canPlan,
  onPlanContract,
  isPlanningDisabled,
  isAlreadyPlanned,
  remindedClientIds,
  onSendReminder,
  canSendReminder,
}) {
  // Statut visite : basé sur current_year_visit_status (visite année en cours)
  const visitStatus =
    contract.current_year_visit_status === 'completed' ? 'completed' : 'pending';

  // Traité pour l'année = entretien en cours OU visite effectuée
  const isDone = isAlreadyPlanned || visitStatus === 'completed';

  // Mois de référence
  const monthLabel = contract.maintenance_month
    ? MONTHS.find((m) => m.value === contract.maintenance_month)?.label
    : null;

  // Bulle SMS : visible uniquement quand le contrat est « à planifier »
  // (même condition que le bouton « Planifier » — jamais sur une ligne grisée).
  const canShowReminder =
    canSendReminder && !isAlreadyPlanned && visitStatus !== 'completed';
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(
    remindedClientIds?.has(contract.client_id) ?? false,
  );

  const handleReminderClick = async (e) => {
    e.stopPropagation();
    if (smsLoading || smsSent) return;
    setSmsLoading(true);
    const { error } = await onSendReminder(contract);
    setSmsLoading(false);
    if (error) {
      toast.error(error.message || 'Échec de l\'envoi du SMS');
    } else {
      setSmsSent(true);
      toast.success('Rappel envoyé par SMS');
    }
  };

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 pl-11 transition-colors group ${
        isDone ? 'opacity-50 bg-gray-50' : 'hover:bg-gray-100'
      }`}
    >
      {/* Nom (cliquable) */}
      <span
        onClick={() => onContractClick?.(contract)}
        className="font-medium text-gray-900 truncate flex-1 min-w-0 cursor-pointer hover:text-blue-600 transition-colors"
      >
        {contract.client_name || 'Sans nom'}
      </span>

      {/* Mois de référence */}
      {monthLabel && (
        <span className="text-xs text-gray-400 flex-shrink-0 hidden sm:inline">
          {monthLabel}
        </span>
      )}

      {/* Tarif */}
      {contract.amount ? (
        <span className="text-xs font-medium text-blue-700 flex-shrink-0">
          {new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0,
          }).format(contract.amount)}
        </span>
      ) : null}

      {/* Badge visite */}
      <VisitBadge status={visitStatus} />

      {/* Bulle SMS rappel — uniquement « à planifier » */}
      {canShowReminder && (
        <button
          onClick={handleReminderClick}
          disabled={smsLoading || smsSent}
          title={
            smsSent
              ? 'Rappel déjà envoyé cette année'
              : 'Envoyer un rappel d\'entretien par SMS'
          }
          className={`inline-flex items-center justify-center p-1.5 rounded border transition-colors flex-shrink-0 ${
            smsSent
              ? 'border-green-300 text-green-600 bg-green-50'
              : 'border-gray-300 text-gray-600 bg-white hover:bg-teal-50 hover:border-teal-400 hover:text-teal-700'
          } disabled:opacity-60`}
        >
          {smsLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : smsSent ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      {/* CTA Planifier / badge Planifié / rien (si visite déjà effectuée) */}
      {canPlan &&
        (isAlreadyPlanned ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-600 bg-green-50 border border-green-200 rounded flex-shrink-0">
            <CheckCircle2 className="h-3 w-3" />
            Planifié
          </span>
        ) : visitStatus === 'completed' ? null : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlanContract?.(contract);
            }}
            disabled={isPlanningDisabled}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-all disabled:opacity-50 flex-shrink-0"
            title="Programmer un entretien"
          >
            <Calendar className="h-3 w-3" />
            Planifier
          </button>
        ))}
    </div>
  );
}

function SectorContracts({
  contracts,
  onContractClick,
  canPlan,
  onPlanContract,
  isPlanningDisabled,
  plannedContractIds,
  remindedClientIds,
  onSendReminder,
  canSendReminder,
}) {
  return (
    <div className="bg-gray-50 border-t border-gray-100">
      <div className="divide-y divide-gray-100">
        {contracts.map((contract) => (
          <ContractRow
            key={contract.id}
            contract={contract}
            onContractClick={onContractClick}
            canPlan={canPlan}
            onPlanContract={onPlanContract}
            isPlanningDisabled={isPlanningDisabled}
            isAlreadyPlanned={plannedContractIds?.has(contract.id) ?? false}
            remindedClientIds={remindedClientIds}
            onSendReminder={onSendReminder}
            canSendReminder={canSendReminder}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3 : Mettre à jour la signature de `SectorGroupView`**

Remplacer la signature du composant principal (lignes ~231-240) par :
```jsx
export function SectorGroupView({
  sectors,
  isLoading,
  onContractClick,
  onPlanContract,
  onPlanSector,
  isPlanningDisabled = false,
  canPlan = false,
  plannedContractIds,
  remindedClientIds,
  onSendReminder,
  canSendReminder = false,
}) {
```

- [ ] **Step 4 : Passer les nouvelles props à `<SectorContracts>`**

Dans le rendu (bloc `{isExpanded && (<SectorContracts ... />)}`), ajouter après `plannedContractIds={plannedContractIds}` :
```jsx
                    remindedClientIds={remindedClientIds}
                    onSendReminder={onSendReminder}
                    canSendReminder={canSendReminder}
```

- [ ] **Step 5 : Lint + build**

Run: `npm run lint:errors`
Expected: aucune erreur.
Run: `npx vite build`
Expected: build réussi (`✓ built in ...`), aucune erreur de compilation.

- [ ] **Step 6 : Commit**

```bash
git add src/apps/artisan/components/entretiens/SectorGroupView.jsx
git commit -m "feat(sms): bulle rappel entretien sur les lignes a planifier (SectorGroupView)"
```

---

## Task 5 — Variable d'environnement + vérification finale

**Files:**
- Modify: `.env` (Eric — secret, non versionné)
- Modify: `.env.example` (si présent — versionné)

- [ ] **Step 1 : Déclarer le webhook**

Eric ajoute dans `.env` (local) **et** dans les variables d'environnement Vercel :
```
VITE_N8N_WEBHOOK_SMS_RAPPEL=https://<n8n>/webhook/<id-rappel-entretien>
```
Si un fichier `.env.example` existe à la racine : y ajouter la ligne `VITE_N8N_WEBHOOK_SMS_RAPPEL=` (sans valeur) et la committer :
```bash
git add .env.example
git commit -m "chore(sms): documente VITE_N8N_WEBHOOK_SMS_RAPPEL dans .env.example"
```
(Si `.env.example` n'existe pas : ne rien créer, passer.)

- [ ] **Step 2 : Build final**

Run: `npx vite build`
Expected: build réussi.

- [ ] **Step 3 : Vérification manuelle (Eric, après déploiement)**

  - [ ] Onglet Entretiens → Programmation : la bulle SMS apparaît **uniquement** sur les lignes « À faire » non planifiées (pas sur les grisées « Planifié »/« Effectué »).
  - [ ] Clic sur la bulle → spinner → `Check` vert + toast « Rappel envoyé par SMS ».
  - [ ] Le client reçoit bien le SMS (texte conforme au brouillon).
  - [ ] Recharger la page : la bulle reste verte/désactivée (état persistant via `sms_logs`).
  - [ ] `sms_logs` contient une ligne `campaign_name='rappel_entretien'`, `channel='sms'` (vérif SQL).
  - [ ] La campagne `avis_j1` (post-entretien) reste inchangée et fonctionnelle.

---

## Dépendance N8N (hors code — Eric)

Workflow N8N à créer (webhook `VITE_N8N_WEBHOOK_SMS_RAPPEL`) :
1. Reçoit `{ contract_id, client_id, client_first_name, client_name, client_phone, org_id }`.
2. Compose le message (salutation `client_first_name` + `client_name`, title-case conseillé, branding org).
3. Envoie le SMS (provider).
4. **INSERT obligatoire dans `sms_logs`** : `org_id`, `client_id`, `phone_to`, `message`, `campaign_name='rappel_entretien'`, `channel='sms'`, `status='sent'`, `sent_at=now()`.

Message validé :
> Bonjour {Prénom} {Nom}, l'entretien annuel de votre équipement approche. Vous recevrez un appel dans les prochains jours pour fixer votre rendez-vous ; vous pouvez aussi nous appeler au 05 63 33 23 14 pour définir le meilleur créneau. Mayer Energie - Econhome

---

## Post-implémentation (proposer à Eric, ne pas auto-éditer)
- Proposer une note CLAUDE.md (Module Mailing/SMS) : nouvelle campagne SMS `rappel_entretien` + env var `VITE_N8N_WEBHOOK_SMS_RAPPEL` + pattern « état dérivé de sms_logs, réinit. annuelle ».

---

## Self-Review

**Spec coverage :**
- Bulle uniquement « à planifier » → Task 4 (`canShowReminder`). ✓
- Icône change à l'envoi → Task 4 (`MessageSquare`/`Loader2`/`Check`). ✓
- Pas de conflit avec `avis_j1` → campagne `rappel_entretien` (Task 2/3). ✓
- Persistance option A → Task 3 (query `sms_logs`). ✓
- Réinit. annuelle → `yearStart` + clé par `currentYear` (Task 3). ✓
- SMS seul, mono-mobile, validation FR → Task 1/2. ✓
- Permission = `entretiens.create` → `canSendReminder={canCreateContract}` (Task 3). ✓
- Helper partagé `isMobileFR` → Task 1. ✓
- Contrat N8N + message → sections dédiées. ✓

**Placeholder scan :** aucun TBD/TODO ; tout le code est complet. ✓

**Type/nommage consistency :**
- `sendEntretienReminder({ contractId, clientId, clientFirstName, clientName, clientPhone, orgId })` — signature identique entre Task 2 (définition) et Task 3 (appel). ✓
- `smsKeys.remindedClients(orgId, year)` — identique Task 3 (def) / query / handler. ✓
- Props `remindedClientIds` / `onSendReminder` / `canSendReminder` — cohérentes Entretiens.jsx → SectorGroupView → SectorContracts → ContractRow. ✓
- `onSendReminder` renvoie `{ data, error }` (Task 3) et est déstructuré `{ error }` (Task 4). ✓
