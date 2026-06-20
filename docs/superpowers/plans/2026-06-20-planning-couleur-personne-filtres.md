# Planning — couleurs par personne + filtres Intervention/Commercial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colorer le planning par personne (au lieu de par type de RDV), avec override violet pour les interventions facturées, et ajouter 2 filtres-toggles Intervention/Commercial + un filtre équipe en chips.

**Architecture:** Toute la logique pure (buckets de type, unification d'identité par `profile_key`, résolution couleur, prédicats de filtre) vit dans un module pur node-testable `src/lib/planningEvents.js`. Le service `appointments.service.js` délègue la couleur au hook (param sur `toCalendarEvent`). Le hook `useAppointments` construit les maps couleur depuis `team_members`+`commercials`, applique les filtres côté client et expose un `teamList` unifié. `Planning.jsx` rend les toggles + chips.

**Tech Stack:** React 18, TanStack Query v5, FullCalendar 6, Tailwind, Supabase. Tests purs via `node --test` (convention `scripts/*.test.mjs`). Vérif build via `npx vite build` (jamais de preview tools — cf. CLAUDE.md).

**Référence design :** `docs/superpowers/specs/2026-06-20-planning-couleur-personne-filtres-design.md`

---

## File Structure

- **Create** `src/lib/planningEvents.js` — module PUR (aucun import React/Supabase) : constantes de buckets, `buildPersonColorMaps`, `resolveAppointmentColor`, `buildTeamList`, `appointmentKind`, `matchesKindFilter`, `matchesMemberFilter`.
- **Create** `scripts/planning-events.test.mjs` — tests `node --test` du module pur.
- **Create** `supabase/migrations/20260620_planning_member_colors.sql` — seed one-time des couleurs Mayer.
- **Modify** `src/shared/services/appointments.service.js` — re-exporte les buckets depuis `planningEvents`, paramètre `toCalendarEvent(appointment, { color })`, supprime le code mort `INVOICEABLE_APPOINTMENT_TYPES` / logique violet locale.
- **Modify** `src/shared/hooks/useAppointments.js` — fetch members+commercials, maps couleur, filtres `kinds` + `memberProfileKeys`, résolution couleur, expose `teamList`.
- **Modify** `src/apps/artisan/pages/Planning.jsx` — `CalendarFilters` (2 toggles + chips, garde le filtre Type), consomme `teamList` du hook, retire le teamList local + `useLeadCommercials`.

---

## Task 1: Seed couleurs (données Mayer)

**Files:**
- Create: `supabase/migrations/20260620_planning_member_colors.sql`

- [ ] **Step 1: Créer le fichier migration**

```sql
-- 20260620_planning_member_colors.sql
-- Seed one-time des couleurs planning par personne (Mayer). Source unique =
-- majordhome.team_members.calendar_color (résolu via profile_key pour les humains
-- présents aussi comme commerciaux : Philippe, Michel). Violet #6D28D9 RÉSERVÉ au
-- "facturé" → aucune personne ne doit l'avoir. Couleurs ensuite éditables via
-- Settings → Équipe (Phase 2). Idempotent (UPDATE par id).
UPDATE majordhome.team_members SET calendar_color = '#EF4444' WHERE id = '87ba1ecb-0913-4cc0-8755-62c43c153693'; -- Ludovic Robert  (rouge)
UPDATE majordhome.team_members SET calendar_color = '#F97316' WHERE id = '15a68690-1ac5-409e-8c00-c7ba19b40ff3'; -- Antoine Verloo  (orange)
UPDATE majordhome.team_members SET calendar_color = '#3B82F6' WHERE id = 'e375271d-e126-466d-93ca-e5c92d041d27'; -- Philippe Mazel  (bleu)
UPDATE majordhome.team_members SET calendar_color = '#0D9488' WHERE id = '06dc4781-7b60-4bc0-a668-a9755db75099'; -- Michel Rieutord (teal)
UPDATE majordhome.team_members SET calendar_color = '#10B981' WHERE id = '2db6765f-99ce-48e8-b797-25660d3b8685'; -- Eric Pudebat    (vert)
```

- [ ] **Step 2: Appliquer en base via MCP Supabase**

Exécuter le contenu du fichier via `mcp__08e883e6-2179-451d-9c85-f993466b02e1__execute_sql` (project_id `odspcxgafcqxjzrarsqf`).

- [ ] **Step 3: Vérifier**

Run (execute_sql):
```sql
select display_name, calendar_color from majordhome_team_members where is_active order by display_name;
```
Expected : Antoine `#F97316`, Eric `#10B981`, Ludovic `#EF4444`, Michel `#0D9488`, Philippe `#3B82F6`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260620_planning_member_colors.sql
git commit -m "feat(planning): seed couleurs calendrier par personne (Mayer)"
```

---

## Task 2: Module pur `planningEvents.js` + tests (TDD)

**Files:**
- Create: `src/lib/planningEvents.js`
- Test: `scripts/planning-events.test.mjs`

- [ ] **Step 1: Écrire les tests (échec attendu)**

Create `scripts/planning-events.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentKind, buildPersonColorMaps, resolveAppointmentColor,
  buildTeamList, matchesKindFilter, matchesMemberFilter,
  INVOICED_EVENT_COLOR, FALLBACK_PERSON_COLOR,
} from '../src/lib/planningEvents.js';

// Fixtures inspirées des vraies données Mayer (Philippe = tech + commercial).
const members = [
  { id: 'tm-ludo', user_id: 'p-ludo', display_name: 'Ludovic Robert', calendar_color: '#EF4444' },
  { id: 'tm-phil', user_id: 'p-phil', display_name: 'Philippe Mazel', calendar_color: '#3B82F6' },
];
const commercials = [
  { id: 'co-phil', profile_id: 'p-phil', full_name: 'Philippe Mazel' },
];
const maps = buildPersonColorMaps({ members, commercials });

test('appointmentKind: buckets par type', () => {
  assert.equal(appointmentKind('rdv_technical'), 'commercial');
  assert.equal(appointmentKind('rdv_agency'), 'commercial');
  assert.equal(appointmentKind('maintenance'), 'intervention');
  assert.equal(appointmentKind('installation'), 'intervention');
  assert.equal(appointmentKind('other'), 'other');
});

test('resolveAppointmentColor: intervention -> couleur du technicien', () => {
  const appt = { appointment_type: 'maintenance', technician_ids: ['tm-ludo'], assigned_commercial_id: null, target_invoiced: false };
  assert.equal(resolveAppointmentColor(appt, maps), '#EF4444');
});

test('resolveAppointmentColor: VT commerciale -> couleur du commercial (profil partagé)', () => {
  const appt = { appointment_type: 'rdv_technical', technician_ids: [], assigned_commercial_id: 'co-phil', target_invoiced: false };
  assert.equal(resolveAppointmentColor(appt, maps), '#3B82F6');
});

test('resolveAppointmentColor: facturé écrase la couleur personne -> violet', () => {
  const appt = { appointment_type: 'maintenance', technician_ids: ['tm-ludo'], target_invoiced: true };
  assert.equal(resolveAppointmentColor(appt, maps), INVOICED_EVENT_COLOR);
});

test('resolveAppointmentColor: "Autre" -> couleur du propriétaire', () => {
  const appt = { appointment_type: 'other', technician_ids: ['tm-phil'], assigned_commercial_id: null, target_invoiced: false };
  assert.equal(resolveAppointmentColor(appt, maps), '#3B82F6');
});

test('resolveAppointmentColor: non assigné -> fallback', () => {
  const appt = { appointment_type: 'other', technician_ids: [], assigned_commercial_id: null };
  assert.equal(resolveAppointmentColor(appt, maps), FALLBACK_PERSON_COLOR);
});

test('buildTeamList: dédoublonne Philippe (tech + commercial) en 1 humain', () => {
  const list = buildTeamList({ members, commercials });
  const phil = list.filter(h => h.displayName === 'Philippe Mazel');
  assert.equal(phil.length, 1);
  assert.deepEqual(new Set(phil[0].recordIds), new Set(['tm-phil', 'co-phil']));
  assert.equal(phil[0].color, '#3B82F6');
  assert.equal(phil[0].isTech, true);
  assert.equal(phil[0].isCommercial, true);
});

test('matchesKindFilter: "Autre" toujours visible, buckets respectés', () => {
  assert.equal(matchesKindFilter({ appointment_type: 'other' }, { intervention: false, commercial: false }), true);
  assert.equal(matchesKindFilter({ appointment_type: 'rdv_technical' }, { intervention: true, commercial: false }), false);
  assert.equal(matchesKindFilter({ appointment_type: 'rdv_technical' }, { intervention: true, commercial: true }), true);
  assert.equal(matchesKindFilter({ appointment_type: 'maintenance' }, { intervention: true, commercial: false }), true);
});

test('matchesMemberFilter: match via commercial OU technicien, vide = tout', () => {
  const sel = new Set(['co-phil', 'tm-phil']);
  assert.equal(matchesMemberFilter({ assigned_commercial_id: 'co-phil', technician_ids: [] }, sel), true);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-phil'] }, sel), true);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-ludo'], assigned_commercial_id: null }, sel), false);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-ludo'] }, null), true);
  assert.equal(matchesMemberFilter({ technician_ids: ['tm-ludo'] }, new Set()), true);
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `node --test scripts/planning-events.test.mjs`
Expected: FAIL (`Cannot find module '../src/lib/planningEvents.js'`).

- [ ] **Step 3: Implémenter le module**

Create `src/lib/planningEvents.js`:
```js
/**
 * planningEvents.js — Helpers PURS du calendrier planning.
 * AUCUN import React/Supabase (node-testable via scripts/planning-events.test.mjs).
 *
 * - Buckets de type (commercial / intervention / autre)
 * - Unification d'identité humaine par profile_key (= team_members.user_id =
 *   commercials.profile_id) pour dédoublonner les personnes présentes dans les
 *   deux tables (Philippe, Michel).
 * - Résolution de la couleur d'un RDV par personne, override violet si facturé.
 * - Prédicats de filtre (bucket + équipe).
 */

export const COMMERCIAL_TYPES = ['rdv_agency', 'rdv_technical'];
export const TECHNICIAN_TYPES = ['installation', 'maintenance', 'service'];

// Violet foncé — RDV facturé (override). Réservé : aucune personne ne doit l'avoir.
export const INVOICED_EVENT_COLOR = '#6D28D9';
// Slate — personne sans couleur définie ou RDV sans assignation.
export const FALLBACK_PERSON_COLOR = '#94A3B8';

/** Bucket d'un RDV selon son type. 'other' = ni commercial ni intervention. */
export function appointmentKind(appointmentType) {
  if (COMMERCIAL_TYPES.includes(appointmentType)) return 'commercial';
  if (TECHNICIAN_TYPES.includes(appointmentType)) return 'intervention';
  return 'other';
}

/**
 * Maps de résolution couleur.
 * @param {Object} p
 * @param {Array}  p.members     team_members [{ id, user_id, calendar_color }]
 * @param {Array}  p.commercials [{ id, profile_id }]
 */
export function buildPersonColorMaps({ members = [], commercials = [] } = {}) {
  const colorByProfile = new Map();  // profile_key -> color
  const techProfileById = new Map(); // team_member.id -> profile_key
  const comProfileById = new Map();  // commercial.id -> profile_key
  for (const m of members) {
    if (!m?.user_id) continue;
    techProfileById.set(m.id, m.user_id);
    if (m.calendar_color) colorByProfile.set(m.user_id, m.calendar_color);
  }
  for (const c of commercials) {
    if (!c?.profile_id) continue;
    comProfileById.set(c.id, c.profile_id);
  }
  return { colorByProfile, techProfileById, comProfileById };
}

/**
 * Couleur d'un RDV : couleur du propriétaire, override violet si facturé.
 * @param {Object} appt { appointment_type, technician_ids[], assigned_commercial_id, target_invoiced }
 * @param {Object} maps issu de buildPersonColorMaps
 */
export function resolveAppointmentColor(appt, maps) {
  if (appt?.target_invoiced === true) return INVOICED_EVENT_COLOR;
  const { colorByProfile, techProfileById, comProfileById } = maps;
  const techId = appt?.technician_ids?.[0];
  const techProfile = techId ? techProfileById.get(techId) : null;
  const comProfile = appt?.assigned_commercial_id ? comProfileById.get(appt.assigned_commercial_id) : null;
  // VT/agence : on préfère le commercial ; sinon (intervention/autre) le technicien.
  const preferCom = COMMERCIAL_TYPES.includes(appt?.appointment_type);
  const profile = preferCom ? (comProfile || techProfile) : (techProfile || comProfile);
  return (profile && colorByProfile.get(profile)) || FALLBACK_PERSON_COLOR;
}

/**
 * Liste équipe unifiée par humain (profile_key) : dédoublonne les personnes
 * présentes en tech ET commercial. recordIds = ids à matcher sur les RDV.
 * Couleur = celle du team_member (source unique) ; fallback sinon.
 */
export function buildTeamList({ members = [], commercials = [] } = {}) {
  const byProfile = new Map();
  const ensure = (key, name) => {
    if (!byProfile.has(key)) {
      byProfile.set(key, {
        profileKey: key, displayName: name || 'Membre', color: FALLBACK_PERSON_COLOR,
        recordIds: [], isTech: false, isCommercial: false,
      });
    }
    return byProfile.get(key);
  };
  for (const m of members) {
    if (!m?.user_id) continue;
    const h = ensure(m.user_id, m.display_name);
    h.recordIds.push(m.id);
    h.isTech = true;
    if (m.calendar_color) h.color = m.calendar_color;
    if (m.display_name) h.displayName = m.display_name;
  }
  for (const c of commercials) {
    if (!c?.profile_id) continue;
    const h = ensure(c.profile_id, c.full_name);
    h.recordIds.push(c.id);
    h.isCommercial = true;
  }
  return Array.from(byProfile.values())
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
}

/** RDV visible selon les toggles de bucket. 'other' toujours visible. */
export function matchesKindFilter(appt, kinds) {
  const k = appointmentKind(appt?.appointment_type);
  if (k === 'other') return true;
  if (k === 'commercial') return !!kinds?.commercial;
  return !!kinds?.intervention;
}

/** RDV visible selon les humains sélectionnés (Set de recordIds). null/vide = tout. */
export function matchesMemberFilter(appt, selectedRecordIds) {
  if (!selectedRecordIds || selectedRecordIds.size === 0) return true;
  if (appt?.assigned_commercial_id && selectedRecordIds.has(appt.assigned_commercial_id)) return true;
  return (appt?.technician_ids || []).some((id) => selectedRecordIds.has(id));
}
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `node --test scripts/planning-events.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/planningEvents.js scripts/planning-events.test.mjs
git commit -m "feat(planning): module pur resolveAppointmentColor + filtres (TDD)"
```

---

## Task 3: Service — paramétrer la couleur + DRY les constantes

**Files:**
- Modify: `src/shared/services/appointments.service.js`

- [ ] **Step 1: Remplacer les constantes locales par un re-export depuis `planningEvents`**

Dans `appointments.service.js`, supprimer les blocs locaux suivants :
```js
// Types dont la tâche liée se facture (pose / SAV / entretien). Les VT et « Autre »
// ne sont jamais recolorés en « facturé » sur le planning.
export const INVOICEABLE_APPOINTMENT_TYPES = ['maintenance', 'service', 'installation'];
// Violet foncé « facturé » — volontairement plus sombre que le violet Installation
// (#8B5CF6) pour rester lisible quand une pose passe en facturé.
export const INVOICED_EVENT_COLOR = '#6D28D9';
```
et
```js
export const COMMERCIAL_TYPES = ['rdv_agency', 'rdv_technical'];
export const TECHNICIAN_TYPES = ['installation', 'maintenance', 'service'];
// 'other' → all members
```

Ajouter en haut du fichier, après les imports existants (sous la ligne `import { leadsService } from '@services/leads.service';`) :
```js
// Buckets de type — source unique dans le module pur (re-export pour les callers
// existants : EventModal, EventFormSections).
export { COMMERCIAL_TYPES, TECHNICIAN_TYPES } from '@/lib/planningEvents';
```

(Conserver la ligne de commentaire `// 'other' → all members` au-dessus de `COMMERCIAL_TYPES`/`getAppointmentTypeConfig` n'est plus nécessaire — supprimée avec le bloc.)

- [ ] **Step 2: Paramétrer `toCalendarEvent` avec la couleur résolue**

Remplacer la fonction `toCalendarEvent` (la couleur est désormais calculée par le hook ; fallback type si non fournie) :
```js
  /**
   * Convertit un appointment DB → event FullCalendar.
   * @param {Object} appointment
   * @param {Object} [opts]
   * @param {string} [opts.color] couleur résolue par personne (cf. resolveAppointmentColor).
   *   Si absente → fallback couleur du type (rétro-compat).
   */
  toCalendarEvent(appointment, { color } = {}) {
    const typeConfig = getAppointmentTypeConfig(appointment.appointment_type);

    const startStr = `${appointment.scheduled_date}T${appointment.scheduled_start}`;
    const endStr = appointment.scheduled_end
      ? `${appointment.scheduled_date}T${appointment.scheduled_end}`
      : null;

    const eventColor = color || typeConfig.color;

    return {
      id: appointment.id,
      title: appointment.subject || `${typeConfig.label} - ${[appointment.client_name, appointment.client_first_name].filter(Boolean).join(' ')}`,
      start: startStr,
      end: endStr,
      backgroundColor: eventColor,
      borderColor: eventColor,
      textColor: '#FFFFFF',
      extendedProps: {
        ...appointment,
        typeConfig,
      },
    };
  },
```

- [ ] **Step 3: Vérifier le build**

Run: `npx vite build`
Expected: build OK, aucune erreur. (À ce stade le hook appelle encore `toCalendarEvent(a)` sans couleur → fallback type ; comportement inchangé.)

- [ ] **Step 4: Commit**

```bash
git add src/shared/services/appointments.service.js
git commit -m "refactor(planning): toCalendarEvent accepte une couleur, DRY des buckets"
```

---

## Task 4: Hook + UI — couleurs par personne + filtres bout-en-bout

**Files:**
- Modify: `src/shared/hooks/useAppointments.js`
- Modify: `src/apps/artisan/pages/Planning.jsx`

- [ ] **Step 1: Hook — imports**

Dans `useAppointments.js`, après `import { useAuth } from '@contexts/AuthContext';`, ajouter :
```js
import { useLeadCommercials } from '@hooks/useLeads';
import {
  buildPersonColorMaps, buildTeamList, resolveAppointmentColor,
  matchesKindFilter, matchesMemberFilter,
} from '@/lib/planningEvents';
```

- [ ] **Step 2: Hook — état filtres étendu**

Remplacer l'initialisation de `filters` dans `useAppointments` :
```js
  const [filters, setFilters] = useState({
    kinds: { intervention: true, commercial: true }, // 2 toggles (les 2 ON = vue globale)
    memberProfileKeys: [],                            // chips équipe (humains, dédup par profile_key)
    appointmentType: null,
    status: null,
  });
```

- [ ] **Step 3: Hook — maps couleur + teamList**

Juste avant le `const events = useMemo(...)`, ajouter :
```js
  // Membres + commerciaux (caches partagés avec Planning) → maps couleur + teamList unifié.
  const { members } = useTeamMembers(orgId);
  const { commercials } = useLeadCommercials(orgId);
  const colorMaps = useMemo(() => buildPersonColorMaps({ members, commercials }), [members, commercials]);
  const teamList = useMemo(() => buildTeamList({ members, commercials }), [members, commercials]);

  // Record ids des humains sélectionnés (union team_member + commercial).
  const selectedRecordIds = useMemo(() => {
    if (!filters.memberProfileKeys.length) return null;
    const keySet = new Set(filters.memberProfileKeys);
    const ids = new Set();
    teamList.forEach((h) => { if (keySet.has(h.profileKey)) h.recordIds.forEach((id) => ids.add(id)); });
    return ids;
  }, [filters.memberProfileKeys, teamList]);
```

- [ ] **Step 4: Hook — events memo (filtres + couleur)**

Remplacer le corps de `const events = useMemo(...)` :
```js
  const events = useMemo(() => {
    if (!appointments) return [];

    // Enrichir chaque appointment avec ses technician_ids
    const techMap = new Map();
    if (techLinks) {
      techLinks.forEach((t) => {
        if (!techMap.has(t.appointment_id)) techMap.set(t.appointment_id, []);
        techMap.get(t.appointment_id).push(t.technician_id);
      });
    }

    const enriched = (appointments || []).map((a) => ({
      ...a,
      technician_ids: techMap.get(a.id) || [],
    }));

    return enriched
      .filter((a) => matchesKindFilter(a, filters.kinds) && matchesMemberFilter(a, selectedRecordIds))
      .map((a) => appointmentsService.toCalendarEvent(a, { color: resolveAppointmentColor(a, colorMaps) }));
  }, [appointments, techLinks, filters.kinds, selectedRecordIds, colorMaps]);
```

- [ ] **Step 5: Hook — exposer `teamList`**

Dans l'objet retourné par `useAppointments`, ajouter `teamList` près de `filters` :
```js
    // Filtres
    filters,
    setFilters,
    teamList,
```

- [ ] **Step 6: Planning.jsx — imports**

Dans `Planning.jsx` :
- Retirer `import { useLeadCommercials } from '@hooks/useLeads';`
- Dans l'import lucide-react, retirer `Users` et `CheckCircle2` (deviennent inutilisés), ajouter `Wrench` et `Briefcase`. Le bloc devient :
```js
import {
  Plus,
  Filter,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  ChevronDown,
  Wrench,
  Briefcase,
} from 'lucide-react';
```

- [ ] **Step 7: Planning.jsx — remplacer `CalendarFilters` + sous-composant `KindToggle`**

Remplacer entièrement la fonction `CalendarFilters` (et son JSDoc) par :
```jsx
/**
 * Bouton toggle de bucket (Intervention / Commercial)
 */
function KindToggle({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-50 border-blue-200 text-blue-700'
          : 'bg-white border-gray-300 text-gray-400 hover:bg-gray-50'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

/**
 * Filtres : toggles bucket (Intervention/Commercial) + chips équipe (par personne) + type
 */
function CalendarFilters({ filters, setFilters, teamList }) {
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  const kinds = filters.kinds || { intervention: true, commercial: true };
  const selectedKeys = filters.memberProfileKeys || [];
  const selectedType = APPOINTMENT_TYPES.find((t) => t.value === filters.appointmentType);
  const hasFilters =
    selectedKeys.length > 0 || filters.appointmentType || !kinds.intervention || !kinds.commercial;

  const toggleKind = (kind) =>
    setFilters((f) => ({ ...f, kinds: { ...f.kinds, [kind]: !f.kinds[kind] } }));

  const toggleMember = (profileKey) =>
    setFilters((f) => {
      const cur = f.memberProfileKeys || [];
      const next = cur.includes(profileKey) ? cur.filter((k) => k !== profileKey) : [...cur, profileKey];
      return { ...f, memberProfileKeys: next };
    });

  const resetAll = () =>
    setFilters((f) => ({
      ...f,
      kinds: { intervention: true, commercial: true },
      memberProfileKeys: [],
      appointmentType: null,
    }));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Toggles bucket */}
      <div className="flex items-center gap-1.5">
        <KindToggle active={kinds.intervention} onClick={() => toggleKind('intervention')} icon={Wrench} label="Intervention" />
        <KindToggle active={kinds.commercial} onClick={() => toggleKind('commercial')} icon={Briefcase} label="Commercial" />
      </div>

      <span className="w-px h-6 bg-gray-200" />

      {/* Chips équipe (1 par personne) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {teamList.map((h) => {
          const isSel = selectedKeys.includes(h.profileKey);
          return (
            <button
              key={h.profileKey}
              onClick={() => toggleMember(h.profileKey)}
              title={h.displayName}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-sm transition-colors ${
                isSel
                  ? 'border-gray-400 bg-gray-100 text-gray-900'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
              {h.displayName.split(' ')[0]}
            </button>
          );
        })}
      </div>

      <span className="w-px h-6 bg-gray-200" />

      {/* Filtre type (conservé) */}
      <div className="relative">
        <button
          onClick={() => setShowTypeDropdown(!showTypeDropdown)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
            filters.appointmentType
              ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          <CalendarIcon className="w-4 h-4" />
          {selectedType ? selectedType.label : 'Type'}
          <ChevronDown className={`w-3 h-3 transition-transform ${showTypeDropdown ? 'rotate-180' : ''}`} />
        </button>
        {showTypeDropdown && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowTypeDropdown(false)} />
            <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              <button
                onClick={() => { setFilters((f) => ({ ...f, appointmentType: null })); setShowTypeDropdown(false); }}
                className={`w-full flex items-center px-3 py-2 text-sm text-left ${!filters.appointmentType ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                Tous les types
              </button>
              {APPOINTMENT_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => { setFilters((f) => ({ ...f, appointmentType: type.value })); setShowTypeDropdown(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${
                    filters.appointmentType === type.value ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full ${type.bgClass}`} />
                  {type.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Reset */}
      {hasFilters && (
        <button onClick={resetAll} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          Effacer
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Planning.jsx — consommer `teamList` du hook, retirer le local**

Dans le composant `Planning` :
- Récupérer `teamList` depuis `useAppointments` (l'ajouter à la déstructuration, près de `filters, setFilters`).
- Retirer la ligne `const { commercials } = useLeadCommercials(orgId);`
- Supprimer entièrement le `const teamList = useMemo(() => { ... }, [members, commercials]);` (remplacé par celui du hook).
- Conserver `const { members, isLoading: isLoadingMembers } = useTeamMembers(orgId);` (toujours requis pour le prop `members` de `EventModal`).

La déstructuration du hook devient (ajout de `teamList`) :
```js
  const {
    events,
    isLoading,
    error,
    filters,
    setFilters,
    teamList,
    createAppointment,
    updateAppointment,
    moveAppointment,
    cancelAppointment,
    deleteAppointment,
    isCreating,
    isUpdating,
    isMoving,
    refresh,
  } = useAppointments({
    orgId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
```

(Le passage `<CalendarFilters filters={filters} setFilters={setFilters} teamList={teamList} />` existe déjà — inchangé.)

- [ ] **Step 9: Vérifier le build**

Run: `npx vite build`
Expected: build OK, aucune erreur ni warning nouveau.

- [ ] **Step 10: Commit**

```bash
git add src/shared/hooks/useAppointments.js src/apps/artisan/pages/Planning.jsx
git commit -m "feat(planning): couleurs par personne + filtres Intervention/Commercial + chips équipe"
```

---

## Task 5: Vérification finale

- [ ] **Step 1: Tests purs**

Run: `node --test scripts/planning-events.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 2: Lint (garde anti-régression)**

Run: `npm run lint:errors`
Expected: 0 error.

- [ ] **Step 3: Build complet**

Run: `npx vite build`
Expected: build OK.

- [ ] **Step 4: Revue manuelle Eric (hors agent)**

Checklist visuelle à faire valider par Eric sur son serveur de dev :
- Couleurs par personne (Ludovic rouge, Antoine orange, Philippe bleu, Michel teal).
- Interventions facturées en violet.
- Toggle Intervention seul → masque les VT commerciales ; Commercial seul → masque entretiens/SAV/poses ; « Autre » toujours visible.
- Chips équipe : Philippe/Michel apparaissent **une seule fois** et filtrent leurs RDV tech ET commerciaux.
- Filtre Type toujours fonctionnel ; bouton Effacer remet tout à zéro.

---

## Self-review (auteur)

- **Couverture spec** : couleur par personne (T2/T4) ✓ · violet facturé (T2 resolver) ✓ · identité unifiée profile_key (T2) ✓ · 2 toggles (T4) ✓ · chips équipe (T4) ✓ · Autre couleur propriétaire + visible (T2) ✓ · seed couleurs (T1) ✓ · pas de migration de vue (décision #1) ✓ · filtre Type conservé (T4) ✓.
- **Phase 2** (éditeur couleur Settings → Équipe) : hors périmètre de ce plan — à traiter ensuite (spawn_task).
- **Placeholders** : aucun (tout le code est fourni).
- **Cohérence des noms** : `resolveAppointmentColor`, `buildPersonColorMaps`, `buildTeamList`, `matchesKindFilter`, `matchesMemberFilter`, `filters.kinds`, `filters.memberProfileKeys`, `teamList` — identiques entre tâches.
- **Risque intermédiaire** : après T3, le hook appelle encore `toCalendarEvent(a)` → fallback couleur type (OK). T4 bascule tout d'un bloc (hook + UI) → pas de fenêtre cassée.
