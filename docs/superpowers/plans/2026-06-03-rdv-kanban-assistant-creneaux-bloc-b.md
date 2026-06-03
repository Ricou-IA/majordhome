# Assistant créneaux multi-technicien (Bloc B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le picker mono-créneau par un assistant de planification multi-créneaux conscient de la dispo par personne (colonnes par technicien, jour d'abord), construit sur `appointments` + `appointment_technicians`, et faire converger les jours de chantier sur `appointments`.

**Architecture:** 1 créneau = 1 `appointment` + N techs (jointure `appointment_technicians` existante) ; multi-créneau = N appointments partageant `lead_id`/`intervention_id` (modèle Bloc A). Un composant `SchedulingAssistant` partagé remplace `SchedulingPanel` chez tous les consommateurs et retourne `slots[]`. La vue `majordhome_appointments` est étendue (additif) pour exposer les techs agrégés + `day_index`. Les jours de chantier deviennent des appointments (`appointment_type='installation'`, `lead_id`=chantier), retirant le silo `intervention_slots`.

**Tech Stack:** React 18 + Vite 5, TanStack Query v5, Supabase (PostgREST + vues `security_invoker`), Tailwind, Lucide. **Pas de framework de test** dans ce repo → la vérification = `npx vite build` + `npm run lint` + re-check manuel des critères Bloc A + validation visuelle d'Eric (jamais de preview tools).

---

## Conventions & garde-fous (s'appliquent à CHAQUE tâche)

- **Pas de preview tools.** Eric valide visuellement sur son propre serveur de dev.
- **Verif de fin de stage (obligatoire, dans l'ordre) :**
  1. `npx vite build` → doit réussir.
  2. `npm run lint` → ne doit **pas** augmenter le nombre de warnings (`--max-warnings` = count actuel, regression guard). Tout nouveau warning = fix immédiat.
  3. **Re-check non-régression Bloc A** (cf. checklist §Bloc A ci-dessous).
  4. **Commit** (message conventionnel, trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`). Pre-commit hook lance `lint:errors`.
- **Travailler sur `main`** (préférence Eric — jamais de worktree). Commits par **pathspec** (ne pas balayer les fichiers tiers déjà modifiés dans le working tree).
- **Lire le fichier avant de l'éditer.** Les tâches d'intégration donnent l'interface cible + le comportement ; l'exécutant lit le fichier (les line ranges sont indicatifs, ils peuvent dériver).
- **Multi-tenant :** toute requête Supabase filtre `org_id` explicitement ; toute vue modifiée garde `WITH (security_invoker=true)` ; cache keys avec `orgId` en 1ᵉʳ param (convention P0.11).
- **Bloc A intact :** ne pas modifier `resolveCardForAppointment`, le walk-in prospect, ni la logique de `syncCardStateOnCreate/Delete`. On ne fait que (a) remplacer l'UI de picking et (b) créer N appointments via le **même** `createAppointment` (donc le même cycle de vie par appointment).

### Checklist non-régression Bloc A (re-jouer à chaque fin de stage qui touche les appointments)
- [ ] RDV « Entretien » depuis la fiche client sous contrat → carte visible dans Kanban Entretien « Planifié », **aucun lead créé**.
- [ ] Supprimer ce RDV → carte revient en « À planifier ».
- [ ] VT sur un lead « Devis envoyé » → RDV attaché, date affichée, **colonne ne bouge pas**.
- [ ] Supprimer le dernier RDV d'un lead « RDV planifié » → icône ambre, carte en place.
- [ ] « Autre » depuis la fiche → RDV au planning, **aucune** carte kanban.
- [ ] Le Planning affiche toujours tous les RDV (pas de doublon, pas de disparition).

---

## File Structure

**Stage 1 — DB + service (fondations, pas d'UI)**
- Modify (DB migration): vue `public.majordhome_appointments` (additif : `technician_ids`, `technician_names`, `chantier_day_index`, `chantier_total_days`).
- Modify: `src/shared/services/appointments.service.js` (+ `getTeamDayAvailability`, `createAppointmentBatch`, `removeAppointmentTechnician`).
- Create: `src/lib/scheduleConflicts.js` (helpers overlap/dispo, purs, testables à la main).
- Modify: `src/shared/hooks/cacheKeys.js` (+ `appointmentKeys.dayAvailability`, `appointmentKeys.chantier`).
- Modify: `src/shared/hooks/useAppointments.js` (+ `useTeamDayAvailability`, `useChantierAppointments`).

**Stage 2 — Assistant créneaux (UI) + bascule des consommateurs picker**
- Create: `src/apps/artisan/components/planning/scheduling/SchedulingAssistant.jsx` (orchestrateur).
- Create: `src/apps/artisan/components/planning/scheduling/DayResourceGrid.jsx` (jour × colonnes par membre).
- Create: `src/apps/artisan/components/planning/scheduling/SlotDraftList.jsx` (liste créneaux empilables).
- Modify: `src/apps/artisan/components/entretiens/SchedulingTransitionModal.jsx`, `EntretienSAVModal.jsx`, `EntretienSAVKanban.jsx`, `pipeline/LeadModal.jsx` (consomment l'assistant, `onConfirm(slots[])`).
- Delete (fin de stage): `src/apps/artisan/components/pipeline/SchedulingPanel.jsx`. (`MiniWeekCalendar.jsx` conservé tant que le Planning/EventModal ne sont pas migrés — retiré au Stage 5 s'il devient orphelin.)

**Stage 3 — EventModal (fiche/planning) sur l'assistant**
- Modify: `src/apps/artisan/components/planning/EventModal.jsx` (assistant en place de `SectionDateTime`+`SectionAssignee` ; `handleSave` boucle `slots[]`).
- Modify: `src/apps/artisan/components/planning/EventFormSections.jsx` (retrait/repli de `SectionDateTime`+`SectionAssignee` si plus consommés).

**Stage 4 — Convergence chantier → appointments**
- Modify: `src/shared/services/appointments.service.js` (helpers chantier appointments si besoin) ; `interventions.service.js` (lecture installation appointments).
- Modify: `src/apps/artisan/components/chantiers/ChantierModal.jsx`, `ChantierInterventionSection.jsx` (slots → appointments via assistant).
- Modify: `src/shared/hooks/useChantiers.js` (`useChantierAppointments` remplace `useInterventionSlots` côté chantier).
- Modify: `src/shared/hooks/useAppointments.js` (retrait du merge chantier-slots dans `events`).
- Modify: `src/apps/artisan/components/chantiers/ChantierCard.jsx` (réactiver l'icône ambre), `ChantierKanban.jsx` (bouton « Prendre RDV » install).
- DB migration one-shot: slots `interventions` → appointments `installation` (+ `intervention_technicians` → `appointment_technicians`).

**Stage 5 — Nettoyage**
- Delete: `src/shared/services/chantierSlots.service.js` ; `chantierSlotKeys` (cacheKeys) ; `getChantierSlots` consumers.
- DB: drop vue `public.majordhome_intervention_slots` ; déprécier `interventions.createInterventionSlot/deleteInterventionSlot/getInterventionSlots` (après validation prod).
- `npm run audit:dead-code` ; MàJ `CLAUDE.md` + `docs/DATABASE.md`.

---

## STAGE 1 — Fondations DB + service

### Task 1.1: Étendre la vue `public.majordhome_appointments` (additif)

**Files:**
- DB migration (via Supabase MCP `apply_migration`, project_id `odspcxgafcqxjzrarsqf`, name `bloc_b_appointments_view_resources`).

**Contexte :** la vue actuelle est un mirror 1:1 sans join (cf. DDL ci-dessous). On ajoute 4 colonnes dérivées sans rien retirer. Le template d'agrégation existe déjà dans `majordhome_intervention_slots`.

- [ ] **Step 1: Vérifier les GRANT sur la table de jointure**

Run (Supabase `execute_sql`):
```sql
select has_table_privilege('authenticated','majordhome.appointment_technicians','SELECT') as auth_sel,
       has_table_privilege('service_role','majordhome.appointment_technicians','SELECT') as svc_sel;
```
Si `auth_sel` est `false`, ajouter `GRANT SELECT ON majordhome.appointment_technicians TO authenticated;` (la vue est `security_invoker` → le rôle appelant doit pouvoir lire la jointure). Idem `service_role` (convention edge functions).

- [ ] **Step 2: Re-créer la vue avec les colonnes additionnelles**

Conserver **toutes** les colonnes existantes (liste ci-dessous) et ajouter l'agg techs (LATERAL, pas de GROUP BY sur 52 colonnes) + le day_index install (window).

```sql
CREATE OR REPLACE VIEW public.majordhome_appointments
WITH (security_invoker = true) AS
SELECT
  a.id, a.org_id, a.service_request_id, a.lead_id, a.client_name, a.client_phone,
  a.client_email, a.address, a.postal_code, a.city, a.scheduled_date, a.scheduled_start,
  a.scheduled_end, a.duration_minutes, a.scheduled_at, a.appointment_type, a.equipment_type,
  a.priority, a.status, a.subject, a.description, a.internal_notes, a.completion_notes,
  a.parts_used, a.photos_urls, a.signature_url, a.completed_at, a.is_billable,
  a.estimated_amount, a.final_amount, a.invoice_id, a.invoice_status, a.is_recurring,
  a.recurrence_rule, a.parent_appointment_id, a.google_event_id, a.google_calendar_id,
  a.google_synced_at, a.slack_message_ts, a.slack_channel_id, a.client_notified_at,
  a.reminder_24h_sent, a.reminder_1h_sent, a.source, a.created_at, a.updated_at,
  a.created_by, a.cancelled_at, a.cancellation_reason, a.client_id, a.client_first_name,
  a.assigned_commercial_id, a.intervention_id,
  -- NEW: techniciens agrégés (1 RDV = N techs)
  COALESCE(at_agg.technician_ids, '{}'::uuid[])  AS technician_ids,
  COALESCE(at_agg.technician_names, '{}'::text[]) AS technician_names,
  -- NEW: jour X/N pour les installs (chantier multi-jours)
  CASE WHEN a.appointment_type = 'installation' AND a.lead_id IS NOT NULL THEN
    row_number() OVER (PARTITION BY a.lead_id, a.appointment_type
                       ORDER BY a.scheduled_date, a.scheduled_start)
  END AS chantier_day_index,
  CASE WHEN a.appointment_type = 'installation' AND a.lead_id IS NOT NULL THEN
    count(*) OVER (PARTITION BY a.lead_id, a.appointment_type)
  END AS chantier_total_days
FROM majordhome.appointments a
LEFT JOIN LATERAL (
  SELECT array_agg(at.technician_id) AS technician_ids,
         array_agg(tm.display_name)  AS technician_names
  FROM majordhome.appointment_technicians at
  LEFT JOIN majordhome.team_members tm ON tm.id = at.technician_id
  WHERE at.appointment_id = a.id
) at_agg ON true;
```

- [ ] **Step 3: Vérifier**

Run:
```sql
select id, appointment_type, technician_ids, technician_names, chantier_day_index, chantier_total_days
from public.majordhome_appointments
where technician_ids <> '{}'::uuid[] limit 5;
```
Expected: au moins quelques lignes avec `technician_ids` non vide. La fenêtre window n'altère pas le nb de lignes (LATERAL corrélé, pas de GROUP BY).

- [ ] **Step 4: Régénérer les types (optionnel) + commit migration**

La migration est versionnée par `apply_migration`. Noter le nom dans le message de commit de fin de stage.

---

### Task 1.2: Helpers de conflit/dispo purs

**Files:**
- Create: `src/lib/scheduleConflicts.js`

- [ ] **Step 1: Écrire les helpers**

```javascript
/**
 * scheduleConflicts.js — helpers purs pour la dispo & les conflits du picker.
 * Pas d'I/O. Heures au format "HH:MM". Un "busy" = { start, end } sur un même jour.
 */

/** "HH:MM" -> minutes depuis minuit. */
export function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Deux plages [aStart,aEnd) [bStart,bEnd) (minutes) se chevauchent-elles ? */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Un créneau {date, startTime, endTime} entre-t-il en conflit avec les RDV
 * d'un technicien donné ? `dayAppointments` = appointments du jour portant ce tech.
 * Retourne la liste des RDV en conflit (vide = libre).
 */
export function findTechnicianConflicts({ date, startTime, endTime }, technicianId, dayAppointments) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (s == null || e == null) return [];
  return (dayAppointments || []).filter((apt) => {
    if (apt.scheduled_date !== date) return false;
    if (apt.status === 'cancelled' || apt.status === 'no_show') return false;
    if (!(apt.technician_ids || []).includes(technicianId)) return false;
    const as = timeToMinutes(apt.scheduled_start);
    const ae = timeToMinutes(apt.scheduled_end) ?? (as + (apt.duration_minutes || 60));
    if (as == null) return false;
    return rangesOverlap(s, e, as, ae);
  });
}

/** Plage de travail "active" d'un membre pour un jour JS (0=dim..6=sam) depuis default_availability. */
export function memberWorkingHoursForDate(member, dateStr) {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const jsDay = new Date(dateStr + 'T00:00:00').getDay();
  const cfg = member?.default_availability?.[days[jsDay]];
  if (!cfg || cfg.active === false) return null; // jour off
  return { start: cfg.start || '08:00', end: cfg.end || '18:00' };
}
```

- [ ] **Step 2: Build/lint** (`npx vite build` doit passer ; pas d'import inutilisé).

---

### Task 1.3: Méthodes service (dispo jour, création par lot, retrait ressource)

**Files:**
- Modify: `src/shared/services/appointments.service.js` (ajouter 3 méthodes dans l'objet `appointmentsService`, après `getAppointmentTechnicians`).

**Contexte :** `createAppointment({ coreOrgId, technicianIds, ...data })` existe déjà et fait : insert appointment → insert `appointment_technicians` → `syncCardStateOnCreate` → sync Google. On le réutilise tel quel dans le batch (donc cycle de vie Bloc A préservé par appointment).

- [ ] **Step 1: `getTeamDayAvailability`** — RDV d'un jour, avec techs (via la vue étendue).

```javascript
/**
 * RDV d'un jour donné (avec technician_ids via la vue étendue) pour alimenter
 * les colonnes du DayResourceGrid. Filtre org_id, exclut annulés/no_show.
 */
async getTeamDayAvailability({ coreOrgId, date }) {
  try {
    const orgId = await getMajordhomeOrgId(coreOrgId);
    const { data, error } = await supabase
      .from('majordhome_appointments')
      .select('id, subject, appointment_type, scheduled_date, scheduled_start, scheduled_end, duration_minutes, status, technician_ids, technician_names, client_name, client_first_name')
      .eq('org_id', orgId)
      .eq('scheduled_date', date)
      .not('status', 'in', '(cancelled,no_show)')
      .order('scheduled_start', { ascending: true });
    if (error) { console.error('[appointments] getTeamDayAvailability error:', error); return { data: null, error }; }
    return { data: data || [], error: null };
  } catch (err) {
    console.error('[appointments] getTeamDayAvailability error:', err);
    return { data: null, error: err };
  }
},
```

- [ ] **Step 2: `createAppointmentBatch`** — crée N appointments via le `createAppointment` existant.

```javascript
/**
 * Crée N appointments (1 par créneau) en réutilisant createAppointment
 * (donc même syncCardStateOnCreate + sync Google par appointment).
 * slots[] = [{ date, startTime, endTime, duration, technicianIds, subject?, notes? }]
 * shared = { coreOrgId, appointment_type, lead_id?, intervention_id?, client_id?,
 *            client_name?, client_first_name?, client_phone?, client_email?,
 *            address?, city?, postal_code?, assigned_commercial_id?, subjectPrefix? }
 * Retourne { data: [appointments...], error } — error = 1ère erreur rencontrée (best-effort, ne rollback pas les précédents).
 */
async createAppointmentBatch(slots, shared) {
  const created = [];
  for (const slot of slots) {
    const { data, error } = await this.createAppointment({
      coreOrgId: shared.coreOrgId,
      technicianIds: slot.technicianIds || [],
      appointment_type: shared.appointment_type,
      subject: slot.subject || shared.subjectPrefix || null,
      scheduled_date: slot.date,
      scheduled_start: slot.startTime,
      scheduled_end: slot.endTime || null,
      duration_minutes: slot.duration || 60,
      lead_id: shared.lead_id || null,
      intervention_id: shared.intervention_id || null,
      client_id: shared.client_id || null,
      client_name: shared.client_name || null,
      client_first_name: shared.client_first_name || null,
      client_phone: shared.client_phone || null,
      client_email: shared.client_email || null,
      address: shared.address || null,
      city: shared.city || null,
      postal_code: shared.postal_code || null,
      assigned_commercial_id: shared.assigned_commercial_id || null,
      status: 'scheduled',
      priority: 'normal',
      internal_notes: slot.notes || null,
    });
    if (error) return { data: created, error };
    created.push(data);
  }
  return { data: created, error: null };
},
```

- [ ] **Step 3: `removeAppointmentTechnician`** — annulation d'**une** ressource (libère le créneau, le RDV reste).

```javascript
/**
 * Retire UN technicien d'un RDV (annulation ressource, pas de trace conservée).
 * Le RDV reste actif → pas de reflux de carte (has_active_rdv inchangé).
 * Re-sync Google pour refléter le retrait.
 */
async removeAppointmentTechnician(appointmentId, technicianId) {
  if (!appointmentId || !technicianId) throw new Error('[appointments] appointmentId & technicianId requis');
  try {
    const { error } = await supabase
      .from('majordhome_appointment_technicians')
      .delete()
      .eq('appointment_id', appointmentId)
      .eq('technician_id', technicianId);
    if (error) { console.error('[appointments] removeAppointmentTechnician error:', error); return { error }; }

    // Re-sync Google avec la liste de techs restante (fire-and-forget).
    const { data: appointment } = await supabase
      .from('majordhome_appointments').select('*').eq('id', appointmentId).maybeSingle();
    const { data: remaining } = await supabase
      .from('majordhome_appointment_technicians').select('technician_id').eq('appointment_id', appointmentId);
    if (appointment) {
      googleCalendarService.syncAppointment('update', appointment, {
        technicianIds: remaining?.map(t => t.technician_id) || [],
        assignedCommercialId: appointment.assigned_commercial_id,
        orgId: appointment.org_id,
      }).catch(() => {});
    }
    return { error: null };
  } catch (err) {
    console.error('[appointments] removeAppointmentTechnician error:', err);
    return { error: err };
  }
},
```

- [ ] **Step 4: Build/lint.** `npx vite build` + `npm run lint`.

---

### Task 1.4: Cache keys + hooks dispo/chantier

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js` (famille `appointmentKeys`).
- Modify: `src/shared/hooks/useAppointments.js` (ajouter 2 hooks).

- [ ] **Step 1: Cache keys** — ajouter à `appointmentKeys` :

```javascript
  dayAvailability: (orgId, date) => [...appointmentKeys.all(orgId), 'day-availability', date],
  chantier: (orgId, leadId) => [...appointmentKeys.all(orgId), 'chantier', leadId],
```

- [ ] **Step 2: `useTeamDayAvailability(orgId, date)`** dans `useAppointments.js` :

```javascript
export function useTeamDayAvailability(orgId, date) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: appointmentKeys.dayAvailability(orgId, date),
    queryFn: async () => {
      const { data, error } = await appointmentsService.getTeamDayAvailability({ coreOrgId: orgId, date });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId && !!date,
    staleTime: 15_000,
  });
  return { dayAppointments: data || [], isLoading, error, refresh: refetch };
}
```

- [ ] **Step 3: `useChantierAppointments(orgId, leadId)`** — install appointments d'un chantier :

```javascript
export function useChantierAppointments(orgId, leadId) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: appointmentKeys.chantier(orgId, leadId),
    queryFn: async () => {
      const mhOrg = await getMajordhomeOrgId(orgId); // import depuis serviceHelpers si pas déjà présent
      const { data, error } = await supabase
        .from('majordhome_appointments')
        .select('*')
        .eq('org_id', mhOrg)
        .eq('lead_id', leadId)
        .eq('appointment_type', 'installation')
        .not('status', 'in', '(cancelled,no_show)')
        .order('scheduled_date', { ascending: true })
        .order('scheduled_start', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && !!leadId,
    staleTime: 15_000,
  });
  return { appointments: data || [], isLoading, error, refresh: refetch };
}
```
> Note : vérifier les imports en tête de `useAppointments.js` (`supabase`, `getMajordhomeOrgId`, `appointmentsService`, `useQuery`). Ajouter ceux qui manquent.

- [ ] **Step 4: Build/lint + commit Stage 1.**

```bash
git add supabase/ src/lib/scheduleConflicts.js src/shared/services/appointments.service.js src/shared/hooks/cacheKeys.js src/shared/hooks/useAppointments.js
git commit -m "feat(planning): Bloc B stage 1 - vue appointments etendue + service dispo/batch/remove-tech"
```
**Verif stage :** `npx vite build` ✅, `npm run lint` ✅, checklist Bloc A ✅ (rien d'UI changé — vérifier juste que Planning + scheduling actuels marchent encore).

---

## STAGE 2 — Assistant créneaux (UI) + bascule des consommateurs picker

> Objectif : `SchedulingAssistant` atteint d'abord la **parité mono-créneau** avec `SchedulingPanel` (pour ne rien casser chez les 3 consommateurs), puis on active le **multi-créneau** et les **colonnes par tech**. `SchedulingPanel` supprimé en fin de stage.

### Task 2.1: `DayResourceGrid` — jour × colonnes par membre

**Files:**
- Create: `src/apps/artisan/components/planning/scheduling/DayResourceGrid.jsx`

**Contrat (props) :**
```
DayResourceGrid({
  date,                 // 'YYYY-MM-DD' jour affiché
  onDateChange,         // (newDate) => void  (bande semaine en tête)
  members,              // [{ id, display_name, calendar_color, default_availability }]
  dayAppointments,      // RDV du jour (via useTeamDayAvailability) — chacun a technician_ids
  draftSlots,           // créneaux en cours (pour afficher les blocs "draft")
  onPlaceSlot,          // ({ memberId, date, startTime, endTime, duration }) => void
})
```

- [ ] **Step 1: Construire la grille.** Évolution de `MiniWeekCalendar` (CSS grid maison, **pas** de FullCalendar) :
  - En-tête : navigation jour (‹ / ›, libellé « Mardi 9 juin », bande Lun-Sam cliquable → `onDateChange`).
  - Colonnes : `40px` (heures) + 1 colonne par `member`. Heures 7h-19h, lignes de 30 min (réutiliser `START_HOUR=7`, `END_HOUR=19`, `SLOT_MINUTES=30`).
  - Par colonne membre : blocs occupés = `dayAppointments` filtrés `technician_ids.includes(member.id)` (couleur = `getAppointmentTypeConfig(type).color`). Hors-horaire (`memberWorkingHoursForDate`) grisé léger.
  - Blocs « draft » (du membre) rendus distinctement (bleu plein).
  - Clic-glisser **dans une colonne** → `onPlaceSlot({ memberId, date, startTime, endTime, duration })` (reprendre la logique drag de `MiniWeekCalendar` : `handleSlotMouseDown/Enter`, `handleDragEnd`, listener global mouseup ; borner au même jour/colonne).
  - **Conflit visuel** : si un drag/draft chevauche un bloc occupé du membre (via `findTechnicianConflicts`), surbrillance **ambre** (ne **pas** bloquer le drag).

- [ ] **Step 2: Scroll horizontal** si `members.length` dépasse la largeur (Mayer 2-3 → OK ; garder `overflow-x-auto`).

- [ ] **Step 3: Build/lint.**

### Task 2.2: `SlotDraftList` — créneaux empilables (fix du bug)

**Files:**
- Create: `src/apps/artisan/components/planning/scheduling/SlotDraftList.jsx`

**Contrat (props) :**
```
SlotDraftList({
  slots,            // [{ id, date, startTime, endTime, duration, technicianIds }]
  members,          // pour afficher/éditer les techs
  conflictsBySlot,  // { [slotId]: number } (compteur de conflits)
  onRemoveSlot,     // (slotId) => void
  onToggleTech,     // (slotId, techId) => void   (ajouter/retirer un tech sur un créneau)
})
```

- [ ] **Step 1: Rendu liste.** Une ligne par créneau : « Mar 9 — 10:00–12:00 — Philippe (+ Karim) », sélecteur de techs (réutiliser `TechnicianSelect` ou chips cliquables), croix de suppression, pastille ambre si `conflictsBySlot[id] > 0`. En-tête « Créneaux à planifier (N) ». **C'est ce qui permet d'empiler plusieurs créneaux sans fermer la modale.**

- [ ] **Step 2: Build/lint.**

### Task 2.3: `SchedulingAssistant` — orchestrateur (remplace `SchedulingPanel`)

**Files:**
- Create: `src/apps/artisan/components/planning/scheduling/SchedulingAssistant.jsx`

**Contrat (props) — surcouche compatible de `SchedulingPanel` + sortie multi :**
```
SchedulingAssistant({
  lead, orgId,
  commercials = [], members = [],
  assigneeType = 'commercial',      // 'commercial' (VT) | 'technician'
  appointmentTypeLabel, appointmentTypeValue,
  defaultDuration = 30, defaultSubjectPrefix,
  multi = false,                    // false => 1 créneau (parité), true => multi-créneau (install)
  onConfirm,                        // (slots[]) => void   slots = [{ date, startTime, endTime, duration, technicianIds, subject, notes }]
  onCancel, isLoading = false,
})
```

- [ ] **Step 1: État + assemblage.**
  - `selectedDate` (défaut = aujourd'hui ou prochain jour ouvré), `draftSlots` (array), `subject`, `notes`.
  - `members` à afficher en colonnes = selon `assigneeType` (techniciens, ou commerciaux pour VT). Pré-sélection des techs = `selectedTechnicianIds` (défaut depuis `lead.assigned_user_id` en mode commercial, sinon vide).
  - `useTeamDayAvailability(orgId, selectedDate)` → `dayAppointments` pour `DayResourceGrid`.
  - `onPlaceSlot` : crée un draft `{ id: crypto.randomUUID(), date, startTime, endTime, duration, technicianIds: [memberId] }` ; si `multi=false`, **remplace** le draft courant (1 seul) ; si `multi=true`, **ajoute**.
  - `onToggleTech(slotId, techId)` : ajoute/retire le tech du draft.
  - Conflits : `conflictsBySlot` calculé via `findTechnicianConflicts` pour chaque (draft, tech).
  - **Bouton** : « Planifier {n} créneau(x) », désactivé si `draftSlots.length === 0`. `onConfirm(draftSlots.map(...))`.

- [ ] **Step 2: Parité d'abord.** Avec `multi=false` + 1 tech, le comportement doit égaler l'ancien `SchedulingPanel` (1 créneau, 1+ techs sur ce créneau via toggle). Garder la sortie au format `slots[]` (longueur 1 dans ce cas).

- [ ] **Step 3: Build/lint.**

### Task 2.4: Brancher les 3 consommateurs picker sur l'assistant

**Files (lire avant d'éditer) :**
- Modify: `src/apps/artisan/components/entretiens/SchedulingTransitionModal.jsx` (~ligne 130, remplace `SchedulingPanel`).
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVModal.jsx` (`handleConfirmScheduling`, ~185-236).
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` (`handleConfirmSchedule`, ~194-245).
- Modify: `src/apps/artisan/components/pipeline/LeadModal.jsx` (`handleConfirmScheduling`, ~533-584 ; usage panel ~968-977).

**Contexte :** ces 3 handlers reçoivent aujourd'hui un objet mono-créneau `{date, startTime, endTime, duration, appointmentType, technicianIds, subject, notes}` et appellent `createAppointment`. Nouveau : ils reçoivent `slots[]` et appellent `createAppointmentBatch`.

- [ ] **Step 1: SchedulingTransitionModal** — remplacer `<SchedulingPanel .../>` par `<SchedulingAssistant ... multi onConfirm={handleConfirmScheduling} />` (entretien/SAV = `assigneeType="technician"`, `multi` activable). Adapter `handleConfirmScheduling(slots)` → passe `slots` à l'appelant (`onConfirm(slots, includesEntretien)`).

- [ ] **Step 2: EntretienSAVModal + EntretienSAVKanban** — `handleConfirmScheduling/Schedule(slots, includesEntretien)` :
```javascript
const first = slots[0];
const { error } = await appointmentsService.createAppointmentBatch(slots, {
  coreOrgId: orgId,
  appointment_type: first.appointmentType || (item.intervention_type === 'sav' ? 'service' : 'maintenance'),
  intervention_id: item.id,
  client_id: item.client_id || null,
  client_name: item.client_last_name || item.client_name || 'Sans nom',
  client_first_name: item.client_first_name || null,
  client_phone: item.client_phone || '',
  client_email: item.client_email || null,
  address: item.client_address || null, city: item.client_city || null, postal_code: item.client_postal_code || null,
  subjectPrefix: /* libellé existant */,
});
// puis updateFields/updateWorkflowStatus comme avant (inchangé)
```
> `appointmentType` n'est plus dans chaque slot — le type vient du contexte (`shared.appointment_type`). Adapter l'assistant pour ne PAS exiger `appointmentType` par slot (le passer en prop `appointmentTypeValue`).

- [ ] **Step 3: LeadModal** — `handleConfirmScheduling(slots)` : `createAppointmentBatch(slots, { coreOrgId, appointment_type: 'rdv_technical', lead_id: leadId, client_id, assigned_commercial_id, ... })` puis `updateLeadStatus(...)` avec le 1ᵉʳ appointment (`appointmentDate = slots[0].date`, `appointmentId = created[0].id`). VT = `assigneeType="commercial"`, `multi={false}` (1 VT).

- [ ] **Step 4: Invalidations.** Après batch : invalider `appointmentKeys.all(orgId)`, `appointmentKeys.dayAvailability(orgId, date)`, et la carte concernée (`leadKeys`/`interventionKeys`/kanban).

- [ ] **Step 5: Supprimer `SchedulingPanel.jsx`** (plus aucun consommateur). Vérifier via recherche `SchedulingPanel` qu'il ne reste aucune référence.

- [ ] **Step 6: Build/lint + checklist Bloc A + commit Stage 2.**
```bash
git commit -m "feat(planning): Bloc B stage 2 - SchedulingAssistant (jour + colonnes tech + multi-creneau) remplace SchedulingPanel"
```
**Verif visuelle Eric :** planifier un entretien (parité), poser 2 créneaux pour une install fictive (multi), vérifier colonnes par tech + dispo + conflit ambre + empilage sans fermeture.

---

## STAGE 3 — EventModal (fiche / planning) sur l'assistant

> Stage le plus sensible Bloc A (chemin d'activation). **Ne pas toucher** `resolveCardForAppointment` ni le walk-in.

### Task 3.1: Intégrer l'assistant dans EventModal

**Files (lire avant d'éditer) :**
- Modify: `src/apps/artisan/components/planning/EventModal.jsx` (init form ~217-259, `handleSave` ~421-511, rendu ~610-664).
- Modify: `src/apps/artisan/components/planning/EventFormSections.jsx` (`SectionDateTime`, `SectionAssignee`).

- [ ] **Step 1: Remplacer le picking.** Dans le rendu d'`EventModal`, remplacer `<SectionDateTime/>` + `<SectionAssignee/>` par `<SchedulingAssistant .../>` en mode adapté au type courant (`assigneeType` = `'commercial'` si `COMMERCIAL_TYPES.includes(type)` sinon `'technician'` ; `multi` = `formData.appointment_type === 'installation'`). Conserver `SectionType`, `SectionClient`, `SectionNotes` et toute la logique d'activation.

- [ ] **Step 2: `handleSave` boucle les créneaux.** L'assistant fournit `slots[]` (state remonté via `onConfirm` ou via un state contrôlé dans EventModal). Après l'activation déduppée existante (qui résout `leadId`/`interventionId`), remplacer l'appel `onSave(data)` unique par une création **par lot** :
  - mode **edit** : conserver le comportement actuel (1 RDV, `updateAppointment`) — pas de multi en édition.
  - mode **create** : `appointmentsService.createAppointmentBatch(slots, shared)` où `shared` reprend `lead_id`/`intervention_id` résolus + champs client + `appointment_type`. Garder l'invalidation `leadKeys.all(orgId)`.
  > ⚠️ Si `onSave` (prop venant de Planning.jsx) est le writer actuel, vérifier sa signature : soit on garde `onSave` pour le cas mono/edit, soit on bascule la création create vers `createAppointmentBatch` ici. Lire `Planning.jsx` `handleSaveEvent` avant de trancher ; préserver le flux Planning (drag&drop, edit).

- [ ] **Step 3: Replier EventFormSections.** Si `SectionDateTime`/`SectionAssignee` ne sont plus utilisés ailleurs (vérifier par recherche), les supprimer ; sinon les laisser. Pas de code mort (règle qualité).

- [ ] **Step 4: Build/lint + checklist Bloc A (intégrale) + commit Stage 3.**
```bash
git commit -m "feat(planning): Bloc B stage 3 - EventModal sur SchedulingAssistant (creation multi-creneau)"
```
**Verif visuelle Eric :** créer un RDV depuis la fiche + depuis le Planning (tous types), vérifier activation carte OK, aucun lead fantôme, edit d'un RDV existant inchangé.

---

## STAGE 4 — Convergence chantier → appointments

### Task 4.1: Migration one-shot des slots existants (5 lignes / 3 parents)

**Files:**
- DB migration (`apply_migration`, name `bloc_b_migrate_chantier_slots_to_appointments`).

- [ ] **Step 1: Migrer slots → appointments `installation`** (idempotent via `internal_notes` tag ou une colonne metadata si dispo ; ici on tag via `subject` + garde `NOT EXISTS`).

```sql
BEGIN;
-- 1) Slots -> appointments installation (lead_id = parent.lead_id)
INSERT INTO majordhome.appointments
  (id, org_id, lead_id, appointment_type, scheduled_date, scheduled_start, scheduled_end,
   duration_minutes, client_name, client_first_name, address, postal_code, city,
   internal_notes, status, created_by, created_at)
SELECT
  gen_random_uuid(), l.org_id, parent.lead_id, 'installation',
  slot.slot_date, slot.slot_start_time, slot.slot_end_time, slot.duration_minutes,
  l.last_name, l.first_name, l.address, l.postal_code, l.city,
  COALESCE(slot.slot_notes,'') || ' [migr slot:' || slot.id || ']',
  'scheduled', slot.created_by, slot.created_at
FROM majordhome.interventions slot
JOIN majordhome.interventions parent ON parent.id = slot.parent_id
JOIN majordhome.leads l ON l.id = parent.lead_id
WHERE slot.parent_id IS NOT NULL AND slot.slot_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM majordhome.appointments a
    WHERE a.internal_notes LIKE '%[migr slot:' || slot.id || ']%'
  );

-- 2) intervention_technicians -> appointment_technicians
INSERT INTO majordhome.appointment_technicians (appointment_id, technician_id, role)
SELECT a.id, it.technician_id, 'lead'
FROM majordhome.appointments a
JOIN majordhome.interventions slot ON a.internal_notes LIKE '%[migr slot:' || slot.id || ']%'
JOIN majordhome.intervention_technicians it ON it.intervention_id = slot.id
ON CONFLICT DO NOTHING;
COMMIT;
```
> Vérifier le nom exact de la contrainte UNIQUE sur `appointment_technicians(appointment_id, technician_id)` ; si absente, `ON CONFLICT DO NOTHING` nécessitera la cible — sinon dédupliquer en amont. Re-auditer le count (`select count(*) ... parent_id is not null and slot_date is not null`) avant exécution (attendu ≈ 5).

- [ ] **Step 2: Vérifier** que les jours de chantier migrés apparaissent dans `majordhome_appointments` avec `chantier_day_index`/`chantier_total_days` corrects.

### Task 4.2: Flux « Prendre RDV » install depuis le kanban Chantier

**Files (lire avant d'éditer) :**
- Modify: `src/apps/artisan/components/chantiers/ChantierKanban.jsx` (action carte → ouvre l'assistant).
- Modify: `src/apps/artisan/components/chantiers/ChantierModal.jsx` (section intervention → appointments).
- Modify: `src/apps/artisan/components/chantiers/ChantierInterventionSection.jsx` (alimentée par `appointments[]`).
- Modify: `src/shared/hooks/useChantiers.js` (`useChantierAppointments` au lieu de `useInterventionSlots` côté chantier).

- [ ] **Step 1: ChantierModal sur appointments.** Remplacer `useInterventionSlots(parentIntervention?.id)` par `useChantierAppointments(orgId, chantier.id)`. Le bouton « Créer l'intervention » (parent prérequis) **disparaît** : on peut ajouter des jours directement. « Ajouter un jour » ouvre l'assistant (`appointmentTypeValue='installation'`, `lead_id=chantier.id`, `multi`, `assigneeType='technician'`) → `createAppointmentBatch`. Suppression d'un jour = `deleteAppointment(appointmentId)` (chemin existant, reflux Bloc A chantier OK). Retrait d'un tech = `removeAppointmentTechnician`.

- [ ] **Step 2: ChantierInterventionSection** alimentée par `appointments[]` (mapper `appointment.scheduled_date/start/end`, `technician_names`) au lieu de `slots[]`. Garder le rendu (liste de jours + techs).

- [ ] **Step 3: ChantierKanban** — action « Prendre RDV » sur une carte → ouvre l'assistant install (type figé, `lead_id` pré-lié).

- [ ] **Step 4: Build/lint.**

### Task 4.3: Réactiver l'icône ambre + retirer le merge slots du calendrier

**Files:**
- Modify: `src/apps/artisan/components/chantiers/ChantierCard.jsx` (~51-57).
- Modify: `src/shared/hooks/useAppointments.js` (~88-99, 130-140 : retrait du merge chantier-slots).

- [ ] **Step 1: ChantierCard** — réactiver le marqueur ambre « à replanifier » : quand la carte est en état « planifié » (chantier_status avancé) mais `has_active_rdv === false`, afficher l'icône ambre (réutiliser le pattern `LeadCard`/`EntretienSAVCard` du Bloc A). Retirer le commentaire « désactivé tant que… ».

- [ ] **Step 2: useAppointments** — les jours de chantier étant désormais des appointments `installation`, ils remontent **nativement** dans `events`. Retirer la query `chantierSlotsService.getChantierSlots` + la branche `slotEvents` du merge (lignes ~88-99 et ~130-140). Les events install sont déjà produits par `appointmentsService.toCalendarEvent` (vérifier le titre « 🔨 J{X}/{N} » : enrichir `toCalendarEvent` pour les install via `chantier_day_index`/`chantier_total_days` si on veut garder le libellé jour X/N).

- [ ] **Step 3: Build/lint + checklist Bloc A + vérif planning (chantiers visibles, pas de doublon) + commit Stage 4.**
```bash
git commit -m "feat(planning): Bloc B stage 4 - convergence chantier->appointments + planif install kanban + icone ambre"
```
**Verif visuelle Eric :** planifier une install multi-jours depuis le kanban Chantier → N jours, puce = 1ᵉʳ jour, visibles sur le Planning ; supprimer le dernier RDV → ambre.

---

## STAGE 5 — Nettoyage

### Task 5.1: Retrait du silo transitoire

**Files:**
- Delete: `src/shared/services/chantierSlots.service.js`.
- Modify: `src/shared/hooks/cacheKeys.js` (retirer `chantierSlotKeys` si plus utilisé), `useAppointments.js` (retirer imports `chantierSlotsService`/`chantierSlotKeys`).
- Modify: `src/shared/services/interventions.service.js` (déprécier `createInterventionSlot`/`deleteInterventionSlot`/`getInterventionSlots` — laisser un commentaire `@deprecated Bloc B` ; suppression réelle après validation prod).

- [ ] **Step 1:** Supprimer `chantierSlots.service.js` + toutes ses références (recherche `chantierSlots`). Build doit rester vert.

- [ ] **Step 2: DB** — après validation prod (≥ quelques jours), `DROP VIEW public.majordhome_intervention_slots;` (migration séparée `bloc_b_drop_intervention_slots_view`). **Ne pas dropper** les colonnes `slot_*` de `interventions` ni la table `intervention_technicians` dans ce stage (rollback). Garder `majordhome.interventions` parents intacts.

- [ ] **Step 3:** `npm run audit:dead-code` → traiter les orphelins révélés (ex. `MiniWeekCalendar` si plus consommé après Stage 3 ; `SchedulingTransitionModal` reste).

- [ ] **Step 4: MàJ docs** — `docs/DATABASE.md` (vue appointments étendue, intervention_slots dépréciée) + `CLAUDE.md` (section planning : assistant créneaux, convergence faite). **Demander l'accord d'Eric avant d'éditer `CLAUDE.md`** (règle proposed-updates).

- [ ] **Step 5: Build/lint + commit Stage 5.**
```bash
git commit -m "chore(planning): Bloc B stage 5 - retrait silo intervention_slots + nettoyage code mort"
```

---

## Self-Review

**1. Spec coverage** (chaque exigence de la spec → tâche) :
- Assistant jour-d'abord + colonnes tech → Task 2.1, 2.3 ✅
- Liste créneaux empilables (fix bug) → Task 2.2, 2.3 ✅
- Conflit ambre non bloquant → Task 1.2 (`findTechnicianConflicts`), 2.1, 2.3 ✅
- 1 RDV + N techs (jointure) → modèle conservé ; batch crée 1 appointment/créneau avec ses techs (Task 1.3) ✅
- Multi-créneau = N appointments → `createAppointmentBatch` (Task 1.3) ✅
- Annulation ressource vs RDV → `removeAppointmentTechnician` (1.3) + `deleteAppointment`/`cancelAppointment` existants ; UI retrait tech (2.2, 4.2) ✅
- Vue étendue (techs + day_index) → Task 1.1 ✅
- Convergence chantier + migration + planif install kanban + icône ambre → Stage 4 ✅
- Un seul composant (remplace SchedulingPanel, tous points d'entrée) → Stage 2 (entretien/pipeline) + Stage 3 (EventModal fiche/planning) ✅
- Horaires par colonne (default_availability) → Task 1.2 (`memberWorkingHoursForDate`) + 2.1 ✅
- Retrait silo transitoire → Stage 5 ✅
- Garde Bloc A (staged + build/lint + checklist) → conventions globales + verif fin de stage ✅
- Hors scope (Resource view page Planning, absences, Google sync) → non planifié ✅

**2. Placeholder scan :** code complet fourni pour les unités neuves (vue SQL, 3 méthodes service, helpers conflits, 2 hooks, migration). Les tâches d'intégration (LeadModal/EventModal/Chantier) donnent l'interface cible + le comportement + les snippets clés, avec consigne explicite « lire le fichier avant d'éditer » (refactor brownfield, line ranges indicatifs) — pas de « TODO/à compléter » vague.

**3. Type/contrat consistency :**
- `slots[]` = `[{ date, startTime, endTime, duration, technicianIds, subject?, notes? }]` — cohérent entre `SchedulingAssistant.onConfirm`, `createAppointmentBatch`, et les 3 consommateurs. `appointmentType` **n'est plus** par-slot (vient du contexte `shared.appointment_type`) — noté en Task 2.4 Step 2.
- `getTeamDayAvailability` retourne des rows avec `technician_ids` (de la vue étendue Task 1.1) — consommé par `findTechnicianConflicts` et `DayResourceGrid`. ✅
- Cache keys : `appointmentKeys.dayAvailability(orgId, date)` / `.chantier(orgId, leadId)` cohérents entre 1.4 et les hooks. ✅

---

## Execution Handoff

Eric a choisi le **mode multi-agent**. Exécution **subagent-driven** : un sous-agent par tâche, **stages dans l'ordre** (dépendances), revue + verif (build/lint + checklist Bloc A) entre chaque stage, point à Eric en fin de stage. REQUIRED SUB-SKILL : `superpowers:subagent-driven-development`.
