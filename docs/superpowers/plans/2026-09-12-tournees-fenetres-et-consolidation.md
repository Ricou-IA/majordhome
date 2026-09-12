# Tournées « fenêtres d'abord, heures ensuite » — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque RDV porte une souplesse (figé / ±15 / ±30 / demi-journée) ; l'insertion d'un entretien peut faire glisser UN voisin adaptable dans sa tolérance ; « Figer la journée » ordonnance la journée dans les fenêtres, pose les heures définitives et prévient les clients ; le planning montre toujours des blocs (heure provisoire + bande de tolérance).

**Architecture:** Deux colonnes sur `appointments` (`time_flex_minutes`, `hour_confirmed_at`) exposées par la vue. Le moteur pur gagne la notion de `tolerance` par arrêt (`arrets.js`), un décalage d'un seul voisin dans `placerCandidat` (`creneaux.js`), une pénalité de temps perdu (`proposer-contrat.js`) et un bâtisseur d'arrêts « fenêtres » pour `sequencerTournee` (consolidation). Un composant unique `SouplesseSelect` sert à la prise (CTA + assistant), à l'édition (EventModal) et au panneau Tournées. La pose (`scheduleEntretien`) écrit le RDV + les décalages ; la consolidation écrit heures + figé + SMS.

**Tech Stack:** React 18 / Vite, supabase-js, FullCalendar 6, edge Deno (`slots-propose`, `sms-send`), PostgreSQL, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-tournees-fenetres-et-consolidation-design.md`

## Global Constraints

- Modules `src/lib/tournee/*` purs (aucun import React/Supabase/alias) ; copies Deno resynchronisées (`npm run sync:tournee-engine`) et testées égales ; `slots-propose` redéployée après toute modif du moteur.
- Un RDV **figé** (`hour_confirmed_at NOT NULL` ou flex effectif 0) n'est **jamais** déplacé par le moteur — ni à l'insertion, ni à la consolidation. Test dédié.
- `flex` effectif = `hour_confirmed_at ? 0 : (time_flex_minutes ?? souplesse_defaut_minutes)`. Demi-journée = 240 → fenêtre [08:00,12:00] ou [13:00,18:00] selon l'heure provisoire, bornée par l'amplitude.
- Sans souplesse renseignée nulle part, le comportement est **identique à aujourd'hui** aux blocs près (tests existants intacts).
- Services : `{ data, error }` ; toute mutation filtre `org_id` ; `logger` pas `console` ; 0 nouveau warning ESLint ; commits par pathspec.
- Toute nouvelle clé de `settings.tournees` naît dans `src/lib/tournee/reglages.js` (source unique ; l'onglet Settings → Tournées est en chantier séparé).

---

### Task A : DB — souplesse sur `appointments`

**Files:** Create `supabase/migrations/20260912_3_appointments_souplesse.sql` ; Modify `src/lib/tournee/reglages.js`.

- [ ] Migration : `ALTER TABLE majordhome.appointments ADD COLUMN IF NOT EXISTS time_flex_minutes smallint CHECK (time_flex_minutes IS NULL OR time_flex_minutes IN (0,15,30,240)), ADD COLUMN IF NOT EXISTS hour_confirmed_at timestamptz;` + COMMENT ; `CREATE OR REPLACE VIEW public.majordhome_appointments WITH (security_invoker = true) AS SELECT <liste actuelle des 55 colonnes dans l'ordre> , time_flex_minutes, hour_confirmed_at FROM majordhome.appointments a;` (définition actuelle récupérée par `pg_get_viewdef` le 2026-09-12 : colonnes `id … intervention_id`, puis le CASE `target_invoiced`, puis `grand_secteur`). Vérifications : `is_insertable_into = 'YES'`, `reloptions = {security_invoker=true}`.
- [ ] `reglages.js` : `souplesse_defaut_minutes: 30`, `reste_utile_min_minutes: 75`, `demi_journee: { matin: [8, 12], apres_midi: [13, 18] }`.
- [ ] Appliquer via MCP (`apply_migration`), vérifier, commit.

### Task B : moteur — tolérance, décalage d'un voisin, temps perdu, consolidation

**Files:** Modify `src/lib/tournee/arrets.js`, `creneaux.js`, `proposer-contrat.js`, `loaders.js` ; tests `scripts/tournee/arrets.test.mjs` (créer si absent), `creneaux.test.mjs`, `proposer-contrat.test.mjs`, `sequence.test.mjs`.

- [ ] `arrets.js` : `toleranceDe(rdv, { flexDefaut, amplitude, demiJournee })` → `{ min, max }` (figé si `hour_confirmed_at`, sinon `time_flex_minutes ?? flexDefaut` ; 240 ⇒ demi-journée) ; `construireArretsExistants(rdvs, coordsFallback, opts)` ajoute `tolerance` à chaque arrêt (fenêtre ponctuelle inchangée) ; nouveau `construireArretsPourConsolidation(rdvs, coordsFallback, opts)` = même chose avec `fenetre = tolerance` (pour `sequencerTournee`). Tests : figé, ±30, demi-journée matin/après-midi, bornes d'amplitude.
- [ ] `creneaux.js::placerCandidat` : si un intervalle manque de `d` min, essayer de repousser `apres` de `d` (si `apres.tolerance.max − apres.debut ≥ d` et si `apres` reste compatible avec SON suivant : `nouveauDebut + dureeApres + trajet(apres, suivant) ≤ suivant.debut` — ou amplitude/dépôt), sinon avancer `avant` de `d` (symétrique). Un seul voisin, jamais un figé. Le placement porte `decalages: [{ id, debutMinutesAvant, debutMinutesApres }]` (vide sinon). Tests : rentre grâce à un décalage ; refus si le voisin est figé ; refus si le décalage casserait le suivant ; sans tolérance = comportement inchangé (suite existante verte).
- [ ] `proposer-contrat.js` : `construireArretsExistants(j.rdvs, depot, { flexDefaut: reglages.souplesse_defaut_minutes, amplitude: j.amplitude, demiJournee: reglages.demi_journee })` ; créneau enrichi de `decalages` (avec `label` du RDV, heures `avant/apres`) ; **score** = `coutMinutes + (10 < resteUtile < reste_utile_min ? resteUtile : 0)` ; tri sur le score puis date/heure. Tests : décalage remonté ; pénalité temps perdu (un créneau laissant 50 min passe derrière un créneau à coût +5 qui enchaîne).
- [ ] `loaders.js::chargerJournees` : `.select(...)` des appointments enrichi de `time_flex_minutes, hour_confirmed_at`.
- [ ] `sequence.js` : retirer la mention « hors chemin de production » ; test de consolidation : arrêts avec fenêtres [−30,+30] + 1 figé → ordre/heures dans les fenêtres, figé immobile.
- [ ] `npm run sync:tournee-engine`, tests verts, commit.

### Task C : edge — décalages exposés

- [ ] `slots-propose` : rien de plus que le passage (les créneaux portent `decalages`) ; `deno check`, redéploiement, commit.

### Task D : pose avec souplesse et décalages (CTA + assistant)

**Files:** Create `src/apps/artisan/components/shared/SouplesseSelect.jsx`, `src/apps/artisan/components/entretiens/SouplesseDialog.jsx` ; Modify `src/shared/services/sav.service.js` (`scheduleEntretien`), `src/shared/services/appointments.service.js` (`createAppointmentBatch`), `ContractModal.jsx`, `CreneauxProposesPanel.jsx`, `SchedulingTransitionModal.jsx`.

- [ ] `SouplesseSelect({ value, onChange, defaut })` : 4 boutons radio — Figé (0) / ±15 / ±30 / Demi-journée (240) ; `value === null` ⇒ « défaut d'org (±30) » présélectionné ; `libelleSouplesse(flex)` exporté.
- [ ] `createAppointmentBatch` : `time_flex_minutes: slot.timeFlexMinutes ?? null`, `hour_confirmed_at: slot.timeFlexMinutes === 0 ? new Date().toISOString() : null`.
- [ ] `scheduleEntretien({ …, timeFlexMinutes = null, decalages = [] })` : slots enrichis ; après la création, pour chaque décalage : `appointmentsService.updateAppointment(id, { scheduled_start, scheduled_end })` (fin = début + durée du RDV) ; une erreur de décalage ⇒ `{ error }` (le RDV est posé mais le décalage non : toast explicite « RDV posé, mais X n'a pas pu être décalé — vérifiez le planning »).
- [ ] `SouplesseDialog` (ConfirmDialog-like) : titre « Souplesse du rendez-vous », `SouplesseSelect`, ligne « Vous lui annoncez : mar. 14 oct. vers 08:15 (entre 07:45 et 08:45) », et si `decalages` : « BASCOUL passera de 14:00 à 14:20 (dans sa tolérance ±30) ». Boutons Poser / Annuler.
- [ ] `ContractModal` : clic sur un créneau → `SouplesseDialog` → `handleConfirmScheduling([slot], { timeFlexMinutes, decalages })`. `CreneauxProposesPanel` : ligne « rentre si BASCOUL passe de 14:00 à 14:20 » quand `k.decalages.length`.
- [ ] `SchedulingTransitionModal` (assistant classique) : `SouplesseSelect` sous les créneaux, remonté dans `onConfirm(slots, includesEntretien, { timeFlexMinutes })` ; kanban (`EntretienSAVKanban`) passe la valeur à `scheduleEntretien`.
- [ ] Build, lint, commit.

### Task E : modifier la souplesse après coup (EventModal)

**Files:** Modify `src/apps/artisan/components/planning/EventModal.jsx` (+ `EventFormSections.jsx` : `SectionSouplesse`).

- [ ] Init édition : `time_flex_minutes: appointment.time_flex_minutes ?? null`, `hour_confirmed_at` ; `SectionSouplesse` (après `SectionDateTime`, mode édition et création) avec `SouplesseSelect` ; au save : `time_flex_minutes`, `hour_confirmed_at: flex === 0 ? (existant || now) : null`.
- [ ] Build, lint, commit.

### Task F : affichage — blocs + bande, icônes

**Files:** Modify `src/shared/services/appointments.service.js` (`toCalendarEvent`), `src/shared/hooks/useAppointments.js` (bande de tolérance), `src/apps/artisan/pages/Planning.jsx` (`PlanningEventContent`), `src/index.css` (ou le fichier CSS FullCalendar existant), `src/apps/artisan/components/tournees/BlocRdvCard.jsx`.

- [ ] `estAdaptable(appt, flexDefaut)` + `fenetreDe(appt, …)` dans `src/lib/planningEvents.js` (pur) ; `toCalendarEvent` ajoute `classNames: ['mdh-flex']` ; `useAppointments.calendarEvents` ajoute pour chaque adaptable un événement `display: 'background'` couvrant la fenêtre (même couleur, `classNames: ['mdh-flex-band']`, non éditable) ; CSS : bloc adaptable bordure pointillée, bande à 18 % d'opacité.
- [ ] `PlanningEventContent` : icône ↔ (adaptable) ou 🔒 (figé) devant le nom.
- [ ] `BlocRdvCard` (Tournées) : même icône + bouton « Figer » / « Rendre adaptable » (`updateAppointment`).
- [ ] Build, lint, commit.

### Task G : consolidation « Figer la journée »

**Files:** Create `src/apps/artisan/components/tournees/FigerJourneeDialog.jsx`, `src/apps/artisan/components/tournees/useConsolidationJournee.js` ; Modify `RemplirJourneePanel.jsx` (bouton), `src/shared/services/sav.service.js` (`sendHeureDePassage`).

- [ ] `useConsolidationJournee({ journee, trajet, reglages })` : `construireArretsPourConsolidation` → `sequencerTournee` → `{ faisable, raison, lignes: [{ id, label, avant: 'HH:MM', apres: 'HH:MM', figé }] }`.
- [ ] `FigerJourneeDialog` : aperçu (tableau avant → après, figés grisés), « N client(s) recevront un SMS d'heure de passage », Confirmer → pour chaque RDV : `updateAppointment(id, { scheduled_start, scheduled_end, time_flex_minutes: 0, hour_confirmed_at: now })` ; puis `sendHeureDePassage` (campagne `heure_de_passage`, vars `prenom/date/heure/technicien`) pour les adaptables avec mobile FR ; `campaign_template_missing` ⇒ toast info « heures figées, SMS non envoyés : gabarit heure_de_passage absent ». Invalidation planning/tournées/kanban.
- [ ] Bouton « Figer la journée » dans l'en-tête de `RemplirJourneePanel` (visible si ≥ 1 adaptable).
- [ ] Build, lint, commit.

### Task H : vérification, docs, revue

- [ ] `node --test scripts/tournee/*.test.mjs`, `npm run lint:errors`, `npx vite build`, `deno check`, copies synchronisées, edge redéployée.
- [ ] Vérification SQL après scénario : un RDV figé n'a pas bougé ; colonnes posées.
- [ ] Proposition CLAUDE.md (PENDING), mémoire, revue par agent, push.
