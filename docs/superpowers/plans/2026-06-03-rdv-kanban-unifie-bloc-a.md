# Refonte prise de RDV ↔ Kanban (Bloc A) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire qu'un RDV planifie une carte de kanban unique déterminée par son type, que l'état de la carte soit piloté par ses RDV, et supprimer le side-effect auto-lead.

**Architecture:** Un lien `appointments.intervention_id` rend l'entretien aussi « linkable » que le lead. Les vues kanban dérivent `next_rdv_date`/`has_active_rdv` depuis `appointments` (source unique). Le service `appointments.service.js` devient l'unique writer de l'état induit par les RDV (avance forward-only, reflux à la suppression). `EventModal` perd l'auto-lead au profit d'un helper d'activation déduppé.

**Tech Stack:** React 18 + Vite, Supabase (PostgreSQL via vues publiques `security_invoker`), TanStack Query v5, Tailwind. **Pas de framework de test** → vérification = `npx vite build` + `npm run lint:errors` + validation manuelle Eric (jamais de preview tools).

**Spec source:** [docs/superpowers/specs/2026-06-03-rdv-kanban-unifie-bloc-a-design.md](../specs/2026-06-03-rdv-kanban-unifie-bloc-a-design.md)

**Décisions actées (délégation Eric) :**
- `rdv_agency` conservé comme **alias legacy** de Visite Technique (pas de migration des RDV historiques ; UI n'expose plus que « Visite Technique » → route Pipeline).
- Client sans `project_id` (0/3412 en prod) → **blocage défensif** avec toast, pas de création implicite de projet.
- `next_rdv_date` **dérivé en vue** (`MIN/EXISTS` sur `appointments`), pas de champ dénormalisé.

**Conventions de référence :**
- RDV « actif » = `appointments.status NOT IN ('cancelled','no_show')`.
- `workflow_status` entretien : `a_planifier` / `planifie` / `realise` / `facture` (terminaux = `realise`, `facture`).
- `chantier_status` : `gagne` → `commande_a_faire` → `commande_recue` → `planification` → `realise` (état « planifié install » = `planification`).
- Statut pipeline « RDV planifié » = `e23d04b8-da2e-4477-8e1c-b92868b682ae` (`statuses.display_order = 3`).
- Multi-tenant : toute nouvelle vue `security_invoker=true`, filtrer `org_id`, RPC SECURITY DEFINER `REVOKE anon`.

---

## ⚠️ Points de checkpoint (validation Eric obligatoire avant exécution)
- **Avant Stage A appliqué en prod** : la migration touche l'instance Supabase partagée. Ajout de colonne nullable + CREATE OR REPLACE de vues `majordhome_*` (Mayer-only, rétro-compatible). Bas risque mais annoncé.
- **Avant Stage E (remédiation data)** : suppression de leads en prod. Les 3 cas clairs sont OK ; les 3 ambigus nécessitent l'arbitrage Eric.

---

## Stage A — Fondation DB (le lien + la dérivation)

### Task A1 : Lien `appointments.intervention_id` + index

**Files:**
- Migration Supabase (via MCP `apply_migration`, name: `rdv_kanban_add_intervention_link`)

- [ ] **Step 1 : Appliquer la migration**

```sql
-- Lien RDV -> intervention (entretien/SAV)
ALTER TABLE majordhome.appointments
  ADD COLUMN IF NOT EXISTS intervention_id uuid
  REFERENCES majordhome.interventions(id) ON DELETE SET NULL;

-- Index pour la dérivation des cartes (MIN/EXISTS par carte)
CREATE INDEX IF NOT EXISTS idx_appointments_intervention_id
  ON majordhome.appointments(intervention_id) WHERE intervention_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_lead_id
  ON majordhome.appointments(lead_id) WHERE lead_id IS NOT NULL;
```

- [ ] **Step 2 : Vérifier**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='majordhome' AND table_name='appointments' AND column_name='intervention_id';
-- Attendu : 1 ligne
```

### Task A2 : Exposer `intervention_id` dans la vue `majordhome_appointments`

**Files:** Migration `rdv_kanban_view_appointments_intervention`

- [ ] **Step 1 : Récupérer la définition courante**

Run (MCP execute_sql) : `SELECT pg_get_viewdef('public.majordhome_appointments'::regclass, true);`

- [ ] **Step 2 : `CREATE OR REPLACE VIEW ... WITH (security_invoker=true)`** en ajoutant `a.intervention_id` à la liste des colonnes (mirror 1:1, la vue est auto-updatable — ne pas casser l'ordre des colonnes existantes : ajouter en fin de SELECT). Conserver `WITH (security_invoker=true)`.

- [ ] **Step 3 : Vérifier** : `SELECT intervention_id FROM majordhome_appointments LIMIT 1;` (ne doit pas erreur).

### Task A3 : Dériver `next_rdv_date` + `has_active_rdv` sur `majordhome_entretien_sav`

**Files:** Migration `rdv_kanban_view_entretien_sav_rdv`

- [ ] **Step 1 : `CREATE OR REPLACE VIEW public.majordhome_entretien_sav`** (repartir de la def actuelle, déjà connue) en ajoutant le LATERAL et les 2 colonnes :

```sql
-- ... (toutes les colonnes existantes) ...
  rdv.next_rdv_date,
  COALESCE(rdv.has_active_rdv, false) AS has_active_rdv
FROM majordhome.interventions i
  JOIN core.projects p ON p.id = i.project_id
  LEFT JOIN majordhome.clients cl ON cl.id = i.client_id
  LEFT JOIN majordhome.contracts c ON c.id = i.contract_id
  LEFT JOIN LATERAL (
    SELECT MIN(a.scheduled_date) AS next_rdv_date, bool_or(true) AS has_active_rdv
    FROM majordhome.appointments a
    WHERE a.intervention_id = i.id
      AND a.status NOT IN ('cancelled','no_show')
  ) rdv ON true
WHERE (i.intervention_type = ANY (ARRAY['entretien'::majordhome.intervention_type, 'sav'::majordhome.intervention_type]))
  AND i.parent_id IS NULL
  AND (c.status IS NULL OR (c.status <> ALL (ARRAY['cancelled'::majordhome.contract_status, 'archived'::majordhome.contract_status])));
```
Garder `WITH (security_invoker=true)`.

- [ ] **Step 2 : Vérifier** : `SELECT id, next_rdv_date, has_active_rdv FROM majordhome_entretien_sav LIMIT 3;`

### Task A4 : Dériver `next_rdv_date` + `has_active_rdv` sur les vues leads (pipeline + chantier)

**Files:** Migration `rdv_kanban_view_leads_rdv`

> Le pipeline et le chantier sont adossés à `leads` (via `appointments.lead_id`). Identifier la/les vue(s) réellement consommées : `majordhome_chantiers` (chantier) et la source du pipeline (`majordhome_kanban_cards` matérialise depuis Pennylane mais chaque carte porte un `lead_id`).

- [ ] **Step 1 :** Récupérer les def : `pg_get_viewdef('public.majordhome_chantiers')` et `pg_get_viewdef('public.majordhome_kanban_cards')`.

- [ ] **Step 2 :** Sur chaque vue, ajouter le même LATERAL keyé sur le `lead_id` de la carte :

```sql
LEFT JOIN LATERAL (
  SELECT MIN(a.scheduled_date) AS next_rdv_date, bool_or(true) AS has_active_rdv
  FROM majordhome.appointments a
  WHERE a.lead_id = <alias_lead>.id
    AND a.status NOT IN ('cancelled','no_show')
) rdv ON true
```
+ exposer `rdv.next_rdv_date`, `COALESCE(rdv.has_active_rdv,false) AS has_active_rdv`. Garder `security_invoker=true`.

- [ ] **Step 3 :** Vérifier chaque vue (`SELECT ... next_rdv_date, has_active_rdv ... LIMIT 3`).

---

## Stage B — Couche service (cycle de vie + activation)

### Task B1 : Helper de matérialisation entretien réutilisable

**Files:**
- Modify: `src/shared/services/entretiens.service.js` (extraire de `ensureKanbanAndAppointmentForVisit`, lignes 46-185)

- [ ] **Step 1 :** Extraire une fonction exportée `ensureEntretienCard({ clientId, contractId, visitDate, userId })` qui crée **l'intervention seule** (PAS l'appointment — le RDV est créé par le flux d'activation). Réutilise la logique existante (anti-doublon parent : SELECT existant `intervention_type='entretien'`, `parent_id IS NULL` ; skip si terminal ; sinon INSERT `workflow_status='planifie'`, `scheduled_date=visitDate`, `tags=['Contrat']` si contractId). Retourne `{ interventionId, error }`. Précondition : charger `client.project_id` ; si null → `{ interventionId: null, error: 'client_sans_projet' }`.

```javascript
export async function ensureEntretienCard({ clientId, contractId = null, visitDate, userId = null }) {
  const { data: client } = await supabase
    .from('majordhome_clients')
    .select('project_id')
    .eq('id', clientId)
    .maybeSingle();
  if (!client?.project_id) return { interventionId: null, error: 'client_sans_projet' };

  // anti-doublon : carte parent non terminale existante ?
  const { data: existing } = await supabase
    .from('majordhome_interventions')
    .select('id, workflow_status')
    .eq('client_id', clientId)
    .eq('intervention_type', 'entretien')
    .is('parent_id', null)
    .not('workflow_status', 'in', '("realise","facture")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { interventionId: existing.id, error: null };

  const { data: created, error } = await supabase
    .from('majordhome_interventions')
    .insert({
      project_id: client.project_id,
      client_id: clientId,
      contract_id: contractId,
      intervention_type: 'entretien',
      workflow_status: 'planifie',
      scheduled_date: visitDate,
      status: 'scheduled',
      created_by: userId,
      tags: contractId ? ['Contrat'] : [],
    })
    .select('id')
    .single();
  return { interventionId: created?.id || null, error };
}
```

- [ ] **Step 2 :** `ensureKanbanAndAppointmentForVisit` (le flux fiche contrat) appelle désormais `ensureEntretienCard` pour la partie intervention (DRY). Garder son comportement (il crée aussi l'appointment de son côté).

- [ ] **Step 3 :** Build + lint.
```
npx vite build && npm run lint:errors
```

### Task B2 : Activation déduppée (helper consommé par EventModal)

**Files:**
- Create: `src/shared/services/appointmentActivation.service.js`

- [ ] **Step 1 :** Écrire le helper qui, pour un client + type, retourne le rattachement (`{ lead_id }` ou `{ intervention_id }`) en réutilisant/matérialisant **sans doublon** :

```javascript
import { supabase } from '@/lib/supabaseClient';
import { ensureEntretienCard } from '@services/entretiens.service';
import { ensureSavCard } from '@services/sav.service'; // si existant ; sinon entretien-like
import { leadsService } from '@services/leads.service';

const RDV_PLANIFIE_STATUS_ID = 'e23d04b8-da2e-4477-8e1c-b92868b682ae';

// Retourne { lead_id?, intervention_id?, error? }
export async function resolveCardForAppointment({ orgId, userId, type, clientId, leadId = null, interventionId = null }) {
  // Déjà rattaché explicitement (depuis un kanban) → passthrough
  if (leadId) return { lead_id: leadId };
  if (interventionId) return { intervention_id: interventionId };
  if (type === 'other') return {}; // aucun work item

  if (type === 'maintenance' || type === 'service') {
    if (!clientId) return { error: 'client_requis_entretien' };
    const { data: contract } = await supabase
      .from('majordhome_contracts')
      .select('id').eq('client_id', clientId).eq('status', 'active').maybeSingle();
    const { interventionId: iid, error } = await ensureEntretienCard({
      clientId, contractId: contract?.id || null, visitDate: null, userId,
    });
    return error ? { error } : { intervention_id: iid };
  }

  // VT / installation -> lead (dédup par client, jamais de prospect form ici)
  if (type === 'rdv_technical' || type === 'rdv_agency' || type === 'installation') {
    if (!clientId) return {}; // walk-in inconnu géré en amont (création prospect explicite)
    const { data: existingLead } = await supabase
      .from('majordhome_leads')
      .select('id, status_id')
      .eq('client_id', clientId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingLead) return { lead_id: existingLead.id };
    const { data, error } = await leadsService.createLead({
      orgId, userId, client_id: clientId, status_id: RDV_PLANIFIE_STATUS_ID,
      notes: 'Carte client activée via prise de RDV',
    });
    return error ? { error } : { lead_id: data?.id };
  }
  return {};
}
```

> Note : `visitDate` est passé `null` à `ensureEntretienCard` puis la date réelle est portée par l'appointment (dérivation). Au besoin, passer la date du RDV pour pré-remplir `interventions.scheduled_date` (compat legacy).

- [ ] **Step 2 :** Vérifier l'existence d'un équivalent SAV (`ensureSavCard`) dans `sav.service.js` ; sinon généraliser `ensureEntretienCard` avec un paramètre `interventionType`.

- [ ] **Step 3 :** Build + lint.

### Task B3 : Cycle de vie dans `appointments.service.js`

**Files:**
- Modify: `src/shared/services/appointments.service.js`

- [ ] **Step 1 :** Ajouter un writer privé `syncCardStateOnCreate(appointment)` :
  - si `intervention_id` → `UPDATE interventions SET workflow_status='planifie' WHERE id=... AND workflow_status NOT IN ('realise','facture')`.
  - si `lead_id` → avance forward-only : `UPDATE leads SET status_id='<RDV planifié>' WHERE id=... AND status_id IN (<statuts display_order < 3>)` (ne jamais redescendre). Récupérer les status_id éligibles via `statuses` (display_order 0..2).
  Appelé en fin de `createAppointment` (après insert réussi).

- [ ] **Step 2 :** Ajouter `syncCardStateOnDelete(appointment)` appelé dans `deleteAppointment` AVANT le delete (on a encore les liens) :
  - calculer s'il reste ≥1 autre RDV actif sur la même carte (`lead_id`/`intervention_id`). Si oui → no-op.
  - si dernier RDV et `intervention_id` → `workflow_status='a_planifier'` (sauf terminal).
  - si dernier RDV et `lead_id` → **no-op statut** (la carte reste, l'icône ambre est dérivée de `has_active_rdv=false`).

- [ ] **Step 3 :** `updateAppointment` (changement de date) : aucune écriture de date sur la carte (dérivée). Conserver la sync Google Calendar existante. Retirer la dénormalisation `leads.appointment_date` devenue superflue **uniquement si** plus aucun consommateur (sinon laisser, non bloquant).

- [ ] **Step 4 :** Build + lint.

---

## Stage C — EventModal & formulaire (retrait auto-lead, activation, type Autre)

### Task C1 : Retirer l'auto-lead, brancher l'activation

**Files:**
- Modify: `src/apps/artisan/components/planning/EventModal.jsx` (bloc `handleSave`, ~423-489)

- [ ] **Step 1 :** Supprimer le bloc `if (!isEdit && COMMERCIAL_TYPES.includes(...) ...)` qui `INSERT` un lead. Remplacer par un appel à `resolveCardForAppointment({ orgId, userId, type: formData.appointment_type, clientId: selectedClient?.id, leadId: selectedLead?.id, interventionId: prefillInterventionId })`, et injecter le résultat (`lead_id` / `intervention_id`) dans `data` avant `onSave`.

- [ ] **Step 2 :** Cas walk-in inconnu (Planning, pas de client, type VT) → garder la création explicite de prospect (le seul endroit). Gérer `error: 'client_sans_projet'` → toast clair, abort.

- [ ] **Step 3 :** Accepter une prop `attachContext` (`{ leadId?, interventionId?, lockedType? }`) passée depuis les kanbans pour le rattachement direct + type figé.

- [ ] **Step 4 :** Build + lint.

### Task C2 : Type « Autre » par défaut, liste de types selon l'entrée

**Files:**
- Modify: `src/apps/artisan/components/planning/EventFormSections.jsx` (`SectionType`)
- Modify: `src/shared/services/appointments.service.js` (`APPOINTMENT_TYPES` : libellés / regroupement)

- [ ] **Step 1 :** Défaut de `appointment_type` en création = `'other'` (au lieu de `'rdv_technical'`) dans `EventModal` init (ligne ~220).
- [ ] **Step 2 :** `SectionType` : si `attachContext.lockedType` → type figé (lecture seule). Sinon liste filtrée selon l'entrée : fiche/planning → `[rdv_technical, maintenance, service, other]` (PAS `installation`). Retirer la notice violette « un lead sera créé ».
- [ ] **Step 3 :** `installation` n'est proposé que depuis le Kanban Chantier (type figé).
- [ ] **Step 4 :** Build + lint.

---

## Stage D — Cartes kanban & points d'entrée

### Task D1 : Puce de gauche = `next_rdv_date` + icône ambre

**Files:**
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVCard.jsx` (date ~75-98)
- Modify: `src/apps/artisan/components/pipeline/LeadCard.jsx` (puce date)
- Modify: `src/apps/artisan/components/chantiers/ChantierCard.jsx` (puce date)

- [ ] **Step 1 :** Composant partagé `RdvDateChip` (`src/apps/artisan/components/shared/RdvDateChip.jsx`) : props `{ date, hasActiveRdv, stripeClass }`. Si `hasActiveRdv && date` → bloc jour/mois (réutiliser le pattern `EntretienSAVCard` lignes 76-98). Sinon (carte en état planifié sans RDV) → icône `CalendarClock` ambre + `title="À replanifier"`.
- [ ] **Step 2 :** Brancher la puce sur `item.next_rdv_date` / `item.has_active_rdv`. Entretien : pas d'icône ambre (le reflux en colonne « À planifier » suffit) → fallback neutre (created_at) si pas de RDV.
- [ ] **Step 3 :** Pipeline / Chantier : icône ambre si la carte est en colonne « planifiée » (`status RDV planifié` / `chantier_status='planification'`) mais `has_active_rdv=false`.
- [ ] **Step 4 :** Build + lint + vérif manuelle Eric (rendu cartes).

### Task D2 : Bouton « Prendre RDV » sur les 3 kanbans

**Files:**
- Modify: `src/apps/artisan/components/pipeline/LeadKanban.jsx` (+ LeadModal si pertinent)
- Modify: `src/apps/artisan/components/chantiers/ChantierKanban.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` (ou la modale détail)

- [ ] **Step 1 :** Sur chaque carte/détail, action « Prendre RDV » ouvrant `EventModal` avec `attachContext` : Pipeline → `{ leadId, lockedType:'rdv_technical' }` ; Chantier → `{ leadId, lockedType:'installation' }` ; Entretien → `{ interventionId, lockedType:'maintenance' }` (ou `service`).
- [ ] **Step 2 :** Invalidation croisée des caches au save/delete (kanban concerné + `appointmentKeys`).
- [ ] **Step 3 :** Build + lint + vérif manuelle.

### Task D3 : Commit Stage A-D

- [ ] `git add` des fichiers touchés (par pathspec) + commit `feat(planning): RDV unifie <-> kanban (lien intervention, activation deduppee, cycle de vie, type Autre)`.

---

## Stage E — Remédiation de l'existant (one-shot, APRÈS déploiement code — checkpoint Eric)

### Task E1 : Nettoyage leads fantômes (cas clairs)

- [ ] **Step 1 (checkpoint Eric) :** soumettre les 3 ambigus (PRESSION, DOUCET, COROIR) ; confirmer la suppression des 3 clairs.
- [ ] **Step 2 :** soft-delete des 3 clairs :
```sql
UPDATE majordhome.leads SET is_deleted = true, updated_at = now()
WHERE id IN ('9de16f90-5792-4bbe-9e25-226c915af431',  -- SHIELD
             'bfaa876a-3640-4512-a43b-2f32c0189277',  -- LENDRIN
             '4dd66795-c84c-4e47-aae1-1743776e9b4d'); -- TOUAHRIA
```
- [ ] **Step 3 :** Vérifier qu'aucun des 2 « Gagné » (CAPPAROS `e9ce3618`, MAZEL `f2011008`) n'est touché.

### Task E2 : Backfill cartes entretien manquantes

- [ ] **Step 1 :** Identifier les RDV `maintenance` futurs/récents sans `intervention_id` :
```sql
SELECT a.id, a.client_id, a.scheduled_date
FROM majordhome.appointments a
WHERE a.appointment_type='maintenance' AND a.intervention_id IS NULL
  AND a.status NOT IN ('cancelled','no_show') AND a.scheduled_date >= current_date - 30;
```
- [ ] **Step 2 :** Pour chacun : `ensureEntretienCard` (contrat actif si présent) + `UPDATE appointments SET intervention_id=...`. Script ponctuel (RPC `service_role` ou via app admin), idempotent.
- [ ] **Step 3 :** Vérifier que SHIELD & co apparaissent en colonne « Planifié » du Kanban Entretien.

---

## Self-review (couverture spec)
- Lien appointment↔intervention → A1/A2. ✅
- Dérivation date/état → A3/A4. ✅
- Helper matérialisation entretien + dédup → B1/B2. ✅
- Cycle de vie (create/move/delete, forward-only, reflux) → B3. ✅
- Retrait auto-lead + activation + type Autre + défaut → C1/C2. ✅
- Puce date + icône ambre + multi-RDV (MIN dérivé) → D1. ✅
- Points d'entrée kanban → D2. ✅
- Remédiation (fantômes + backfill, gates) → E1/E2. ✅
- Hors scope : assistant créneaux (Bloc B), génération proactive entretiens. ✅
