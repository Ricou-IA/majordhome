# Commande « personnes × jours » (installation + SAV) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de « N personnes × N jours » une donnée du chantier (installation) et de l'intervention (SAV), et faire dériver les RDV de cette commande : un jour = un RDV à N techniciens, plus de RDV en double.

**Architecture:** Deux colonnes nullables `planned_team_size` / `planned_days` sur `majordhome.leads` et `majordhome.interventions`, exposées en fin des vues `majordhome_chantiers`, `majordhome_interventions` (miroir updatable) et `majordhome_entretien_sav`, écrites par la RPC `update_majordhome_lead` (chantier) et `savService.updateFields` (SAV). Un module pur `src/lib/installOrder.js` porte la fusion des créneaux qui se chevauchent le même jour et l'état de la commande ; `SchedulingAssistant` l'applique quand `mergeOverlapping` est actif ; un composant partagé `PlannedOrderFields` saisit la commande dans `ChantierModal` et `EntretienSAVModal`.

**Tech Stack:** React 18, TanStack Query v5, Supabase (PostgREST + RPC), node:test, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-21-chantier-commande-installation-personnes-jours-design.md`

## Global Constraints

- Migration versionnée dans `supabase/migrations/`, répétée sur `scripts/migration-rehearsal/` avant application ; vues recréées avec `WITH (security_invoker = true)` ; colonnes ajoutées **en fin de liste**.
- Toute mutation front filtre par `org_id` ou passe par une RPC membership-checked.
- Module pur sans import React/Supabase, test `node --test`, ajouté à `audit:quality`.
- Hooks : mutations `unwrapResult` ; appelants en try/catch + toast.
- Fichiers CRLF : éditer via Edit/Write (jamais `sed -i`).
- Périmètre : installation et SAV. Entretien inchangé (`mergeOverlapping` false).

---

### Task 1 : Migration DDL + RPC + répétition + application

**Files:**
- Create: `supabase/migrations/20260922_1_planned_order.sql`
- Create: `scripts/migration-rehearsal/assert-planned-order.sql`

**Interfaces:**
- Produces : colonnes `planned_team_size smallint`, `planned_days smallint` sur `majordhome.leads` et `majordhome.interventions` ; mêmes colonnes en fin des vues `public.majordhome_chantiers`, `public.majordhome_interventions`, `public.majordhome_entretien_sav` ; RPC `update_majordhome_lead` acceptant les clés `planned_team_size` / `planned_days` (`null` ou `''` → NULL).

- [ ] **Step 1 : écrire la migration**

Contenu : `ALTER TABLE … ADD COLUMN … CHECK (BETWEEN 1 AND 20 / 1 AND 60)` sur les deux tables ; `CREATE OR REPLACE VIEW public.majordhome_interventions WITH (security_invoker = true)` = définition prod actuelle + `planned_team_size, planned_days` en fin ; idem `majordhome_chantiers` (`l.planned_team_size, l.planned_days` après `validated_quotes_count`) ; idem `majordhome_entretien_sav` (`i.planned_team_size, i.planned_days` après `effective_contract_id`) ; `CREATE OR REPLACE FUNCTION public.update_majordhome_lead` = définition prod + deux lignes :

```sql
    planned_team_size = CASE WHEN p_updates ? 'planned_team_size' THEN NULLIF(p_updates->>'planned_team_size', '')::SMALLINT ELSE planned_team_size END,
    planned_days = CASE WHEN p_updates ? 'planned_days' THEN NULLIF(p_updates->>'planned_days', '')::SMALLINT ELSE planned_days END,
```

- [ ] **Step 2 : écrire les assertions** (`DO $$ … RAISE EXCEPTION … $$`) : les 4 colonnes existent ; `information_schema.views.is_updatable = 'YES'` pour `majordhome_interventions` ; les 3 vues exposent `planned_days` ; `pg_get_functiondef(update_majordhome_lead)` contient `planned_team_size`.

- [ ] **Step 3 : répéter** : `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20260922_1_planned_order.sql --assert scripts/migration-rehearsal/assert-planned-order.sql` (snapshot existant ou refait). Si le harnais n'est pas exécutable dans cette session, le dire explicitement dans le rapport.

- [ ] **Step 4 : appliquer en prod** via `apply_migration` (projet `ejqqqwudmizqisdkxohw`, nom `20260922_1_planned_order`), puis vérifier par `SELECT` : colonnes présentes, `is_updatable = YES`, `has_function_privilege('anon', 'public.update_majordhome_lead(uuid,jsonb)', 'EXECUTE')` inchangé par rapport à avant (l'ancienne fonction est remplacée, les GRANT sont conservés par `CREATE OR REPLACE`).

- [ ] **Step 5 : commit** `feat(db): commande personnes × jours sur leads et interventions (migration 20260922_1)`.

---

### Task 2 : Module pur `installOrder.js` + tests

**Files:**
- Create: `src/lib/installOrder.js`
- Create: `scripts/install-order.test.mjs`
- Modify: `package.json` (`audit:quality` : ajouter `scripts/install-order.test.mjs`)

**Interfaces (Produces):**
```js
export function chevauche(a, b)  // { startTime, endTime } × 2 → boolean ; endTime null ⇒ traité comme startTime (instant)
export function fusionnerCreneau(draftSlots, slot) // → nouveau tableau (voir spec §4)
export function etatCommande({ teamSize, days }, jours) // jours = [{ date, technicianIds }]
// → { joursAttendus, joursPoses, joursIncomplets: [{ date, personnes, attendues }], complete, message }
export function libelleCommande({ teamSize, days }) // → '2 pers. × 3 j' | null si les deux NULL
```

- [ ] **Step 1 : écrire les tests** (fusion : chevauchement même jour → union dans l'ordre, horaire du brouillon existant gardé ; même jour sans chevauchement → 2 créneaux ; date différente → 2 ; slot sans technicien → ajouté tel quel ; ne mute pas l'entrée. `etatCommande` : commande NULL → jamais incomplet, `joursAttendus = joursPoses` ; complète ; jour manquant ; personne manquante avec date FR dans `message` ; les deux à la fois ; `jours` dédoublonnés par date pour compter les jours posés).
- [ ] **Step 2 : `node --test scripts/install-order.test.mjs`** → échec (module absent).
- [ ] **Step 3 : implémenter** (`message` : « Il manque 1 jour », « Il manque 1 personne le 23/09 », « Il manque 1 jour et 1 personne le 23/09 » ; pluriels ; dates au format `dd/MM`).
- [ ] **Step 4 : tests verts + `audit:quality` étendu**.
- [ ] **Step 5 : commit** `feat(planning): module pur installOrder (fusion des créneaux, état de la commande)`.

---

### Task 3 : Assistant — fusion + état de la commande

**Files:**
- Modify: `src/apps/artisan/components/planning/scheduling/SchedulingAssistant.jsx` (props `mergeOverlapping = false`, `expectedTeamSize = null`, `expectedDays = null` ; `handlePlaceSlot` → `fusionnerCreneau` si `mergeOverlapping` ; `etat = etatCommande(...)` sur `draftSlots` ; message ambre au-dessus des boutons quand `!etat.complete` ; passe `expectedTeamSize` et `expectedDays` à `SlotDraftList`)
- Modify: `src/apps/artisan/components/planning/scheduling/SlotDraftList.jsx` (badge par créneau « 1/2 personnes » ambre si `expectedTeamSize` et `selectedIds.length < expectedTeamSize` ; titre « Créneaux à planifier (2/3 jours) » quand `expectedDays`)

- [ ] **Step 1 : implémenter** (aucun changement de comportement sans les nouvelles props).
- [ ] **Step 2 : `npx eslint` sur les deux fichiers**.
- [ ] **Step 3 : commit** `feat(planning): l'assistant fusionne les créneaux d'une même journée et affiche l'état de la commande`.

---

### Task 4 : Chantier — saisie de la commande, badge, technicien(s) par jour

**Files:**
- Create: `src/apps/artisan/components/planning/scheduling/PlannedOrderFields.jsx` — `({ teamSize, days, onChange, disabled })` : deux `<input type="number">` inline « Personnes » / « Jours », `onChange({ teamSize, days })` au blur (valeurs `null` si vide).
- Modify: `src/shared/services/chantiers.service.js` — `updatePlannedOrder(leadId, { teamSize, days })` → `leadsService.updateLead(leadId, { planned_team_size, planned_days })`.
- Modify: `src/shared/hooks/useChantiers.js` — `plannedOrderMutation` + `updatePlannedOrder` exposé (même pattern que `updateChantierNotes`).
- Modify: `src/shared/hooks/useAppointments.js` — `useChantierAppointments` : 2ᵉ requête `majordhome_appointment_technicians` (`appointment_id, technician_id`) pour les ids ramenés, merge `technician_ids[]` (pattern `getTeamDayAvailability`).
- Modify: `src/apps/artisan/components/chantiers/ChantierModal.jsx` — `PlannedOrderFields` en tête de la section Installation (persisté via `updatePlannedOrder`, toast erreur) ; `SchedulingAssistant` reçoit `mergeOverlapping`, `expectedTeamSize={chantier.planned_team_size}`, `expectedDays={chantier.planned_days}` ; `ChantierInterventionSection` reçoit `plannedOrder={{ teamSize, days }}`.
- Modify: `src/apps/artisan/components/chantiers/ChantierInterventionSection.jsx` — `N = plannedOrder.days ?? totalDays` ; ligne ambre `etatCommande(...).message` ; « 1/2 pers. » par ligne quand `technician_ids.length < teamSize`.

- [ ] **Step 1 : implémenter** ; **Step 2 : eslint + `npx vite build`** ; **Step 3 : commit** `feat(chantiers): commande personnes × jours saisie à la planification, badge J i/N sur la commande`.

---

### Task 5 : SAV — même commande

**Files:**
- Modify: `src/shared/services/sav.service.js` — `updateFields` allowlist : `planned_team_size`, `planned_days` (undefined ignoré, `null` accepté).
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVModal.jsx` — pour `type === 'sav'` : `PlannedOrderFields` au-dessus de l'assistant (persisté via `updateFields` du hook, invalidation existante) ; `SchedulingAssistant` reçoit `mergeOverlapping={type === 'sav'}`, `expectedTeamSize`, `expectedDays` depuis `item`.

- [ ] **Step 1 : implémenter** ; **Step 2 : eslint + build** ; **Step 3 : commit** `feat(entretiens): commande personnes × jours sur les SAV`.

---

### Task 6 : Spec, doc, liste de rattrapage

- [ ] Spec : corriger « `interventions.estimated_time` » → la durée d'un passage SAV n'est pas stockée sur l'intervention (le `estimated_time` de la vue vient du **contrat**), elle est choisie à la pose (drag ou durée par défaut).
- [ ] `.claude/proposed-updates.md` : entrée PENDING (règle « un jour = un RDV à N techniciens ; commande sur la carte ; RPC `update_majordhome_lead` à liste de colonnes explicite »).
- [ ] Générer `docs/superpowers/plans/2026-09-22-rattrapage-paires-installation.md` : les 12 paires (client, date, RDV A à garder, RDV B à supprimer, technicien à ajouter, notes à recopier) depuis la requête prod.
- [ ] `npm run audit:quality` + `npx vite build` finaux, commit `docs: …`.
