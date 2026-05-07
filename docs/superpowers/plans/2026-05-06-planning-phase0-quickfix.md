# Phase 0 — Quick fix : afficher les slots chantier sur le planning

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire apparaître les jours d'intervention chantier (`majordhome.interventions` avec `parent_id != null`) sur le planning équipe (`/planning`), avec couleur teal distinctive et clic qui ouvre la modale chantier complète. Aucun refactor du modèle data — extension non-disruptive de `useAppointments`.

**Architecture:** Multiplexage côté frontend. Une seule modif DB (extension de la vue `majordhome_intervention_slots` pour exposer le contexte client via le parent). Un nouveau service `chantierSlots.service.js` (transitoire, sera supprimé en Phase 1). `useAppointments` charge les slots en query parallèle React Query et merge les events FullCalendar côté client. Le clic sur un slot ouvre directement le `ChantierModal` existant.

**Tech Stack:** React 18 / Vite 5 / Supabase / TanStack React Query v5 / FullCalendar 6 / Tailwind 3.4 / Lucide React.

**Spec source:** `docs/superpowers/specs/2026-05-06-planning-unifie-google-sync-design.md` §7 Phase 0.

**Estimation:** ~1 jour-dev (5-6h). Aucune dépendance npm nouvelle. Aucune license à acheter.

---

## File Structure

| Fichier | Action | Responsabilité |
|---|---|---|
| `(DB)` vue `majordhome_intervention_slots` | Modify | Exposer parent_lead_id, chantier_client_name/first_name, chantier_address/city, chantier_day_index, chantier_total_days |
| `src/shared/services/chantierSlots.service.js` | Create | Service transitoire — `getChantierSlots({ orgId, startDate, endDate })` qui interroge la vue étendue |
| `src/shared/hooks/cacheKeys.js` | Modify | Ajouter `chantierSlotKeys` (sera supprimé en Phase 1) |
| `src/shared/hooks/useAppointments.js` | Modify | Ajouter query parallèle slots + merge events FullCalendar + filtrage techniciens |
| `src/apps/artisan/pages/Planning.jsx` | Modify | Détecter clic sur event slot chantier → fetch chantier complet → ouvrir `ChantierModal` |

---

## Task 1 — DB : étendre la vue `majordhome_intervention_slots`

**Files:**
- Modify (DB) : vue `public.majordhome_intervention_slots`

La vue actuelle expose `lead_id` mais ce champ vient de `interventions.lead_id` du **slot**, qui est `NULL` (le `lead_id` est sur le parent). Il faut joindre le parent pour récupérer le contexte client. On ajoute aussi le `day_index` (jour X/N) calculé via window function pour afficher "J2/3" dans le titre.

- [ ] **Step 1.1 : Vérifier la définition actuelle de la vue**

Run via Supabase MCP `execute_sql` :
```sql
SELECT pg_get_viewdef('public.majordhome_intervention_slots'::regclass, true);
```

Expected: la définition retourne le SELECT actuel basé sur `i.parent_id IS NOT NULL`.

- [ ] **Step 1.2 : Appliquer la migration via `apply_migration`**

Nom de migration : `extend_intervention_slots_view_with_chantier_context`

```sql
DROP VIEW IF EXISTS public.majordhome_intervention_slots;

CREATE VIEW public.majordhome_intervention_slots AS
SELECT
  slot.id,
  slot.parent_id,
  parent.lead_id AS parent_lead_id,
  slot.project_id,
  slot.slot_date,
  slot.slot_start_time,
  slot.slot_end_time,
  slot.slot_notes,
  slot.status,
  slot.duration_minutes,
  slot.created_at,
  slot.updated_at,
  COALESCE(array_agg(it.technician_id) FILTER (WHERE it.technician_id IS NOT NULL), '{}'::uuid[]) AS technician_ids,
  COALESCE(array_agg(tm.display_name) FILTER (WHERE tm.display_name IS NOT NULL), '{}'::text[]) AS technician_names,
  -- Contexte client (depuis le parent)
  l.last_name AS chantier_client_name,
  l.first_name AS chantier_client_first_name,
  l.address AS chantier_address,
  l.postal_code AS chantier_postal_code,
  l.city AS chantier_city,
  l.org_id AS org_id,
  -- Day index (jour X/N) calculé au sein du même parent
  ROW_NUMBER() OVER (
    PARTITION BY slot.parent_id
    ORDER BY slot.slot_date, slot.slot_start_time NULLS LAST
  ) AS chantier_day_index,
  COUNT(*) OVER (PARTITION BY slot.parent_id) AS chantier_total_days
FROM majordhome.interventions slot
JOIN majordhome.interventions parent ON parent.id = slot.parent_id
LEFT JOIN majordhome.intervention_technicians it ON it.intervention_id = slot.id
LEFT JOIN majordhome.team_members tm ON tm.id = it.technician_id
LEFT JOIN majordhome.leads l ON l.id = parent.lead_id
WHERE slot.parent_id IS NOT NULL
GROUP BY slot.id, parent.lead_id, l.last_name, l.first_name, l.address, l.postal_code, l.city, l.org_id;
```

- [ ] **Step 1.3 : Vérifier que les 3 slots BERNA HELENE remontent avec le contexte**

```sql
SELECT id, slot_date, parent_lead_id, chantier_client_name, chantier_client_first_name, chantier_day_index, chantier_total_days, technician_names
FROM public.majordhome_intervention_slots
WHERE slot_date BETWEEN '2026-05-18' AND '2026-05-24'
ORDER BY slot_date;
```

Expected:
- 3 lignes
- `chantier_client_name = 'BERNA'`, `chantier_client_first_name = 'HELENE'`
- `chantier_day_index` = 1, 2, 3
- `chantier_total_days` = 3
- `technician_names` non vides

- [ ] **Step 1.4 : Ne pas commit côté git (migration DB tracée par Supabase)**

La migration est déjà persistée dans `supabase_migrations` côté projet Supabase. On ne crée pas de fichier git pour cette modif.

---

## Task 2 — Créer le service `chantierSlots.service.js`

**Files:**
- Create: `src/shared/services/chantierSlots.service.js`

Service mince et transitoire. Sera supprimé en Phase 1 quand les slots seront migrés vers `appointments`.

- [ ] **Step 2.1 : Créer le fichier service**

```javascript
/**
 * chantierSlots.service.js — Majord'home Artisan
 * ============================================================================
 * Service TRANSITOIRE pour exposer les slots chantier (interventions enfants)
 * sur le planning équipe.
 *
 * À supprimer en Phase 1 quand les slots seront migrés vers `appointments`.
 *
 * @version 1.0.0 - Phase 0 quick fix
 * ============================================================================
 */

import { supabase } from '@/lib/supabaseClient';
import { withErrorHandling, getMajordhomeOrgId } from '@/lib/serviceHelpers';

export const chantierSlotsService = {
  /**
   * Récupère les slots chantier dans une fenêtre de dates.
   *
   * @param {Object} params
   * @param {string} params.coreOrgId - ID core.organizations (depuis useAuth)
   * @param {string} params.startDate - Date début (YYYY-MM-DD)
   * @param {string} params.endDate - Date fin (YYYY-MM-DD)
   * @returns {Promise<{ data: Array, error: Error|null }>}
   */
  async getChantierSlots({ coreOrgId, startDate, endDate }) {
    if (!coreOrgId || !startDate || !endDate) {
      return { data: [], error: null };
    }

    return withErrorHandling(async () => {
      const orgId = await getMajordhomeOrgId(coreOrgId);

      const { data, error } = await supabase
        .from('majordhome_intervention_slots')
        .select('*')
        .eq('org_id', orgId)
        .gte('slot_date', startDate)
        .lte('slot_date', endDate)
        .order('slot_date', { ascending: true })
        .order('slot_start_time', { ascending: true });

      if (error) throw error;
      return data || [];
    }, 'chantierSlots.getChantierSlots');
  },

  /**
   * Convertit un slot en event FullCalendar.
   * Couleur teal/cyan + titre "🔨 Chantier {client} J{X}/{N}".
   */
  toCalendarEvent(slot) {
    const fullName = [slot.chantier_client_name, slot.chantier_client_first_name]
      .filter(Boolean)
      .join(' ') || 'Chantier';

    const dayLabel = slot.chantier_total_days > 1
      ? ` J${slot.chantier_day_index}/${slot.chantier_total_days}`
      : '';

    const startStr = slot.slot_start_time
      ? `${slot.slot_date}T${slot.slot_start_time}`
      : slot.slot_date;
    const endStr = slot.slot_end_time
      ? `${slot.slot_date}T${slot.slot_end_time}`
      : null;

    return {
      id: `chantier-slot-${slot.id}`,
      title: `🔨 ${fullName}${dayLabel}`,
      start: startStr,
      end: endStr,
      backgroundColor: '#0D9488',  // teal-600
      borderColor: '#0D9488',
      textColor: '#FFFFFF',
      extendedProps: {
        // Marqueur pour Planning.jsx : permet de distinguer clic chantier vs RDV
        appointment_kind: 'chantier_slot',
        slot_id: slot.id,
        parent_lead_id: slot.parent_lead_id,
        client_name: slot.chantier_client_name,
        client_first_name: slot.chantier_client_first_name,
        address: slot.chantier_address,
        postal_code: slot.chantier_postal_code,
        city: slot.chantier_city,
        technician_ids: slot.technician_ids || [],
        technician_names: slot.technician_names || [],
        day_index: slot.chantier_day_index,
        total_days: slot.chantier_total_days,
        notes: slot.slot_notes,
      },
    };
  },
};

export default chantierSlotsService;
```

- [ ] **Step 2.2 : Commit**

```bash
git add src/shared/services/chantierSlots.service.js
git commit -m "feat(planning): service chantierSlots — exposer slots chantier sur le planning (Phase 0)"
```

---

## Task 3 — Ajouter `chantierSlotKeys` dans `cacheKeys.js`

**Files:**
- Modify: `src/shared/hooks/cacheKeys.js`

- [ ] **Step 3.1 : Ajouter la cache key family**

Dans `src/shared/hooks/cacheKeys.js`, ajouter après le bloc `// --- Chantier Receptions ---` (ligne ~86) :

```javascript
// --- Chantier Slots (Phase 0 transitoire — supprimé en Phase 1) ---
export const chantierSlotKeys = {
  all: ['chantier-slots'],
  lists: () => [...chantierSlotKeys.all, 'list'],
  list: (orgId, dateRange) => [...chantierSlotKeys.lists(), orgId, dateRange],
};
```

- [ ] **Step 3.2 : Commit**

```bash
git add src/shared/hooks/cacheKeys.js
git commit -m "feat(planning): cache keys chantierSlots (Phase 0)"
```

---

## Task 4 — Étendre `useAppointments` avec query parallèle slots

**Files:**
- Modify: `src/shared/hooks/useAppointments.js`

- [ ] **Step 4.1 : Ajouter les imports en tête de fichier**

Modifier le bloc d'imports en haut de `src/shared/hooks/useAppointments.js` (lignes 10-14) :

```javascript
import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsService } from '@services/appointments.service';
import { chantierSlotsService } from '@services/chantierSlots.service';
import { supabase } from '@/lib/supabaseClient';
import { appointmentKeys, leadKeys, chantierSlotKeys } from '@hooks/cacheKeys';
```

- [ ] **Step 4.2 : Ajouter la query slots dans `useAppointments`**

Dans la fonction `useAppointments` (ligne 38), AVANT la déclaration de `const events = useMemo(...)` (ligne 85), ajouter :

```javascript
  // Query parallèle : slots chantier (Phase 0 transitoire)
  const { data: chantierSlots } = useQuery({
    queryKey: chantierSlotKeys.list(orgId, { startDate, endDate }),
    queryFn: () =>
      chantierSlotsService.getChantierSlots({
        coreOrgId: orgId,
        startDate,
        endDate,
      }),
    enabled: !!orgId && !!startDate && !!endDate,
    staleTime: 15_000,
    select: (result) => result?.data || [],
  });
```

- [ ] **Step 4.3 : Étendre `events` pour merger les slots**

Remplacer le bloc `const events = useMemo(...)` (lignes 85-111) par :

```javascript
  // Convertir en events FullCalendar — appointments + slots chantier mergés
  const events = useMemo(() => {
    if (!appointments && !chantierSlots) return [];

    // Enrichir chaque appointment avec ses technician_ids
    const techMap = new Map();
    if (techLinks) {
      techLinks.forEach(t => {
        if (!techMap.has(t.appointment_id)) techMap.set(t.appointment_id, []);
        techMap.get(t.appointment_id).push(t.technician_id);
      });
    }

    let enrichedAppointments = (appointments || []).map(a => ({
      ...a,
      technician_ids: techMap.get(a.id) || [],
    }));

    // Filtre multi-membres pour les appointments
    if (filters.memberIds.length > 0 && techLinks) {
      const memberSet = new Set(filters.memberIds);
      enrichedAppointments = enrichedAppointments.filter(
        a => a.technician_ids.some(id => memberSet.has(id)) || memberSet.has(a.assigned_commercial_id)
      );
    }

    const appointmentEvents = enrichedAppointments.map(a => appointmentsService.toCalendarEvent(a));

    // Slots chantier — filtre type (appointmentType actif → masque chantiers car ils n'ont pas de type RDV)
    let visibleSlots = chantierSlots || [];
    if (filters.appointmentType) {
      visibleSlots = []; // chantier_slot n'a pas de type RDV équivalent
    }
    if (filters.memberIds.length > 0) {
      const memberSet = new Set(filters.memberIds);
      visibleSlots = visibleSlots.filter(s => (s.technician_ids || []).some(id => memberSet.has(id)));
    }
    const slotEvents = visibleSlots.map(s => chantierSlotsService.toCalendarEvent(s));

    return [...appointmentEvents, ...slotEvents];
  }, [appointments, chantierSlots, filters.memberIds, filters.appointmentType, techLinks]);
```

- [ ] **Step 4.4 : Vérifier qu'aucun import n'est cassé**

Run dans le terminal :
```bash
npx vite build 2>&1 | tail -30
```

Expected: build SUCCESS. Si erreurs d'import, vérifier les chemins `@hooks/cacheKeys` et `@services/chantierSlots.service`.

- [ ] **Step 4.5 : Commit**

```bash
git add src/shared/hooks/useAppointments.js
git commit -m "feat(planning): merge slots chantier dans events FullCalendar (Phase 0)"
```

---

## Task 5 — Click handler chantier dans Planning.jsx

**Files:**
- Modify: `src/apps/artisan/pages/Planning.jsx`

Au clic sur un event de type `chantier_slot`, on doit ouvrir le `ChantierModal` existant. Or `ChantierModal` attend l'objet `chantier` complet (issu de la vue `majordhome_chantiers`). On charge le chantier à la volée via le `parent_lead_id` (qui est aussi le lead_id du chantier dans Majord'home).

- [ ] **Step 5.1 : Ajouter les imports**

En haut de `src/apps/artisan/pages/Planning.jsx`, après les imports existants (~ligne 38), ajouter :

```javascript
import { ChantierModal } from '@/apps/artisan/components/chantiers/ChantierModal';
import { supabase } from '@/lib/supabaseClient';
```

- [ ] **Step 5.2 : Ajouter l'état pour le ChantierModal**

Après `const [modalState, setModalState] = useState(...)` (~ligne 346), ajouter :

```javascript
  const [selectedChantier, setSelectedChantier] = useState(null);
  const [loadingChantier, setLoadingChantier] = useState(false);
```

- [ ] **Step 5.3 : Modifier `handleEventClick` pour dispatcher selon le kind**

Remplacer la fonction `handleEventClick` (lignes 430-438) par :

```javascript
  // Clic sur un événement → éditer (RDV) OU ouvrir chantier (slot chantier)
  const handleEventClick = useCallback(async (clickInfo) => {
    const props = clickInfo.event.extendedProps;

    // Slot chantier : ouvrir ChantierModal
    if (props.appointment_kind === 'chantier_slot') {
      if (!props.parent_lead_id) {
        toast.error('Chantier introuvable');
        return;
      }
      setLoadingChantier(true);
      try {
        const { data, error } = await supabase
          .from('majordhome_chantiers')
          .select('*')
          .eq('id', props.parent_lead_id)
          .single();
        if (error || !data) {
          toast.error('Impossible de charger le chantier');
          return;
        }
        setSelectedChantier(data);
      } finally {
        setLoadingChantier(false);
      }
      return;
    }

    // RDV classique : EventModal existante
    setModalState({
      open: true,
      mode: 'edit',
      appointment: props,
      defaultDate: null,
      defaultTime: null,
    });
  }, []);
```

- [ ] **Step 5.4 : Render du `ChantierModal` dans le JSX**

Juste avant le dernier `</div>` qui ferme le composant principal (après le bloc `<EventModal ... />` ligne ~683), ajouter :

```jsx
      {/* Modale Chantier — clic sur slot chantier */}
      {selectedChantier && (
        <ChantierModal
          chantier={selectedChantier}
          onClose={() => setSelectedChantier(null)}
          onUpdated={() => {
            refresh();
            // Recharger le chantier (slots peuvent avoir changé)
            if (selectedChantier?.id) {
              supabase
                .from('majordhome_chantiers')
                .select('*')
                .eq('id', selectedChantier.id)
                .single()
                .then(({ data }) => data && setSelectedChantier(data));
            }
          }}
          effectiveRole={effectiveRole}
          canEditAll={can('chantiers', 'update')}
        />
      )}

      {/* Loader pendant fetch du chantier */}
      {loadingChantier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 pointer-events-none">
          <div className="bg-white rounded-lg shadow-xl px-6 py-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-sm text-gray-700">Chargement du chantier…</span>
          </div>
        </div>
      )}
```

- [ ] **Step 5.5 : Vérifier que `effectiveRole` et `can` sont déjà disponibles dans le composant**

Grep dans le fichier :
```bash
grep -n "effectiveRole\|const { can }" src/apps/artisan/pages/Planning.jsx
```

Expected: `effectiveRole` est extrait de `useAuth()` (ligne 336), `can` extrait de `useCanAccess()` (ligne 337). Si manquant, les ajouter.

- [ ] **Step 5.6 : Build de validation**

```bash
npx vite build 2>&1 | tail -30
```

Expected: build SUCCESS, aucune erreur.

- [ ] **Step 5.7 : Commit**

```bash
git add src/apps/artisan/pages/Planning.jsx
git commit -m "feat(planning): clic sur slot chantier ouvre ChantierModal (Phase 0)"
```

---

## Task 6 — Vérification fonctionnelle manuelle

**Files:**
- Aucun (tests manuels en navigateur — l'utilisateur a son propre serveur de dev en cours)

⚠️ NE PAS utiliser les preview tools. L'utilisateur fait ses tests dans son propre serveur de dev déjà démarré.

- [ ] **Step 6.1 : Demander à l'utilisateur de tester**

Après commit final, présenter à l'utilisateur la checklist de vérification ci-dessous (à exécuter dans son navigateur sur son serveur de dev déjà démarré) :

**Checklist test manuel :**

1. **Aller sur `/planning`** en vue Semaine, naviguer jusqu'à la semaine du 18-24 mai 2026
   - Attendu : 3 events teal "🔨 BERNA HELENE J1/3", "J2/3", "J3/3" sur lun 18, mar 19, mer 20 mai de 8h à 17h

2. **Cliquer sur un des events teal**
   - Attendu : `ChantierModal` du chantier BERNA HELENE s'ouvre (l'utilisateur peut voir les commandes, l'intervention, les techniciens)

3. **Filtrer "Équipe" sur "Ludovic" uniquement**
   - Attendu : les 3 events restent visibles (Ludovic est sur tous les jours), les autres événements de l'équipe sont masqués

4. **Filtrer "Équipe" sur "Antoine" uniquement**
   - Attendu : le slot du lundi 18 disparaît (Antoine pas assigné ce jour-là), les slots mar 19 et mer 20 restent

5. **Filtrer par "Type" → "Entretien"**
   - Attendu : les events teal chantier disparaissent (cohérent : pas un type RDV)

6. **Vérifier console**
   - Aucune erreur React ni Supabase 404/500

- [ ] **Step 6.2 : Si OK, marquer Phase 0 livrée**

Aucune action — l'utilisateur valide. Si bugs, retour aux tâches concernées.

---

## Self-Review

Spec coverage check :

| Spec §7 Phase 0 ligne | Tâche correspondante |
|---|---|
| "Afficher les slots chantier sur le planning actuel" | Task 4 (events mergés) + Task 5 (clic) |
| "extension de useAppointments avec query parallèle" | Task 4.2 (ajout `useQuery` parallèle) |
| "merge des events avec couleur teal" | Task 2.1 `toCalendarEvent` (`#0D9488`) |
| "titre 🔨 Chantier J{X}/{N}" | Task 2.1 `toCalendarEvent` titre dynamique |
| "1 jour" | 6 tâches × ~30-60 min = 5-6h ✓ |

Type consistency check :
- `chantierSlotsService.toCalendarEvent` retourne `extendedProps.appointment_kind = 'chantier_slot'` (Task 2)
- Planning.jsx checke `props.appointment_kind === 'chantier_slot'` (Task 5.3) ✓
- `chantierSlotKeys.list(orgId, { startDate, endDate })` (Task 3) utilisé dans Task 4.2 avec le même format ✓
- `parent_lead_id` exposé par la vue (Task 1.2) → utilisé dans `extendedProps` (Task 2.1) → utilisé pour fetch chantier (Task 5.3) ✓

Placeholder scan : aucun TBD/TODO/incomplete.

Dépendances entre tâches :
- Task 1 (DB) doit être DEPLOYED avant Task 4 (sinon getChantierSlots renvoie une vue qui ne contient pas les nouvelles colonnes)
- Tasks 2 et 3 indépendantes
- Task 4 dépend de Tasks 1, 2, 3
- Task 5 dépend de Task 4 (events mergés)
- Task 6 dépend de tout

Ordre d'exécution recommandé : 1 → 2 → 3 → 4 → 5 → 6.
