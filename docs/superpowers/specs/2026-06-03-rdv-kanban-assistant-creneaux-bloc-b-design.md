# Spec — Assistant créneaux / planification multi-technicien — Bloc B

> **Date** : 2026-06-03
> **Auteur** : Brainstorming Eric + Claude
> **Statut** : Validé en brainstorming — à relire avant plan d'implémentation
> **Périmètre** : Bloc B — l'UX de prise de créneau (multi-créneaux, dispo par personne) + convergence des jours de chantier sur `appointments`. Suite directe du **Bloc A** (`docs/superpowers/specs/2026-06-03-rdv-kanban-unifie-bloc-a-design.md`).
> **Découpage imposé** : réutiliser le découpage Bloc A — spec → plan (`writing-plans`) → exécution **par stages**, chaque stage clôturé par `npx vite build` + `npm run lint` **et** une re-vérification des critères de succès Bloc A. **Aucun preview tool** (Eric valide visuellement sur son propre serveur).

## 1. Contexte & motivation

### Le symptôme rapporté
La modale de planification (`SchedulingPanel.jsx`, utilisée par la modale entretien `SchedulingTransitionModal` et par le pipeline `LeadModal`) affiche un aperçu planning à la semaine mais gère **un créneau unique** :
- impossible de poser **plusieurs** créneaux,
- pas de gestion de la disponibilité **par personne** (le `MiniWeekCalendar` reçoit `technicianFilter={[]}` → il affiche tous les RDV mêlés, jamais filtrés par tech),
- **bug** : quand un créneau est pris, impossible d'en ajouter un autre.

La vision : pour un même RDV/chantier, pouvoir poser **plusieurs créneaux** en **voyant la disponibilité de chacun**. Le multi-créneau est surtout fréquent pour **l'installation**.

### La cartographie réelle (découverte en brainstorming)
Trois représentations de « travail planifié + techniciens » coexistent aujourd'hui :

| Système | Stocké dans | Multi-jour | Multi-tech | Sur le planning ? |
|---|---|---|---|---|
| RDV (VT, entretien, SAV, install…) | `appointments` + `appointment_technicians` (jointure) | non (1 bloc) | ✅ jointure | ✅ natif |
| Jours de chantier | `interventions` (slots) + `intervention_technicians` (jointure) | ✅ | ✅ | ⚠️ via service **transitoire** (`chantierSlots.service.js`) |
| Dispo par personne | nulle part | — | — | ❌ jamais filtré |

- `chantierSlots.service.js` est explicitement marqué *« TRANSITOIRE — à supprimer quand migré vers appointments »*.
- Une unification complète avait déjà été décidée (`docs/superpowers/specs/2026-05-06-planning-unifie-google-sync-design.md`, décision Q4 « tout devient un appointment », Q7a « multi-tech = event dupliqué par colonne »). **Seule la Phase 0 a été livrée** (affichage transitoire). Les Phases 1-6 (convergence data + vue Resource + absences + sync Google) n'ont jamais été faites.
- **Bloc A** (2026-06-03) est passé ensuite avec un chemin compatible mais différent : `appointments.intervention_id`/`lead_id` + dérivation `next_rdv_date`/`has_active_rdv`, **sans** toucher aux slots chantier.

### Objectif
Faire du Bloc B **le point de convergence** : un **assistant de planification unique**, multi-créneaux et conscient de la dispo par personne, construit sur `appointments` + `appointment_technicians`, qui **finit la convergence** (les jours de chantier deviennent des appointments, l'ancien silo est retiré) et **livre la planification d'install depuis le kanban Chantier** (le TODO laissé par Bloc A).

## 2. Scope

### Dans le scope (Bloc B)
- **Assistant créneaux partagé** (`SchedulingAssistant`, évolution de `SchedulingPanel` + `MiniWeekCalendar`) :
  - **axe « jour d'abord »** (le client donne sa date, pas son technicien),
  - **colonnes par technicien** pour un jour donné (codées à la main, **sans FullCalendar Premium**),
  - **liste de créneaux en construction** → on empile plusieurs créneaux (= fin du bug),
  - **conflit doux** (alerte ambre, non bloquant).
- **Modèle ressources** : 1 créneau = **1 RDV (appointment) + N techs** via la jointure **existante** `appointment_technicians`. Multi-créneau = **N appointments**. **Aucune table nouvelle.**
- **Annulation** : par ressource (retirer un tech de la jointure) **ou** RDV entier (`status='cancelled'`) — au choix de l'user.
- **Convergence chantier** : les jours d'install deviennent des appointments (`appointment_type='installation'`, `lead_id`=chantier, + `appointment_technicians`). Réécriture de `ChantierInterventionSection`/`ChantierModal` vers `appointmentsService`, migration one-shot des slots existants, **retrait** de `chantierSlots.service.js` + slots `interventions`. **Livraison de la planif install depuis le kanban Chantier** + **réactivation de l'icône ambre** « à replanifier » sur `ChantierCard` (désactivée par Bloc A faute de ce flux).
- **Unification des points d'entrée** : l'assistant remplace `SchedulingPanel` partout (fiche, planning, kanbans entretien/pipeline/chantier) → fin des deux UIs de planif qui divergent.
- **Vue `majordhome_appointments` étendue** (additive) : exposer `technician_ids`/`technician_names` agrégés depuis la jointure + `day_index`/`total_days` dérivés pour les install (ROW_NUMBER/COUNT sur `lead_id` où type=installation).

### Hors scope explicite
- **Vue Resource sur la grande page Planning** (`Planning.jsx`, colonnes par tech via FullCalendar Premium ~480 $/an) — la page Planning principale reste telle quelle ; les colonnes-par-tech ne vivent que dans le **picker**. Décision/budget reportés (et même alors, codables à la main).
- **Absences** (congés/maladie/formation — Phase 3 de la spec 2026-05-06).
- **Sync Google Agenda** bidirectionnelle + busy blocks externes (Phases 4-5). → **Le conflit doux du Bloc B se base uniquement sur les appointments**, pas encore sur les indispos Google.
- **i18n** — tout en français.
- **Génération proactive** des entretiens à venir depuis les contrats (itération future, déjà hors scope Bloc A).

## 3. Décisions de design validées en brainstorming

| Question | Décision |
|---|---|
| Axe du picker | **Jour d'abord.** Le client donne sa dispo (date), choisit rarement le technicien. On répond à « on est tel jour, qui peut-on envoyer ? ». |
| Visualisation de la dispo | **Colonnes par technicien** pour le jour sélectionné (qui est pris / libre). Codé main dans la grille maison (`MiniWeekCalendar` n'utilise pas FullCalendar) → **0 €, pas de Premium**. |
| Tenue dans la modale | Mayer = **2-3 techs actifs** → « 1 jour × N colonnes » tient. (Scale multi-tenant : scroll horizontal si beaucoup de colonnes.) |
| Modèle ressources | **1 créneau = 1 appointment + N techs** via `appointment_technicians` (jointure **déjà existante**). |
| « 2 techs » | = **1 seul RDV** (sens client/éco) affiché comme **2 blocs visuels** (1 par colonne de tech). Pas 2 RDV en base. |
| Déplacer un RDV | **Tous les techs suivent** (c'est 1 appointment). |
| Annuler une ressource | Retirer le tech de la jointure → son bloc disparaît, le RDV continue. **Pas de trace conservée** (suppression de la ligne de jointure). |
| Annuler le RDV | `status='cancelled'` (chemin existant). L'user choisit ressource vs RDV. |
| Multi-créneau | **N appointments** (install plusieurs jours / horaires différents). Réutilise le `lead_id` de Bloc A — **pas de colonne nouvelle**. |
| Pose multi-tech | On pose **1 créneau** (clic-glisser, durée par drag) et on **assigne le(s) tech(s)** ; le bloc s'affiche dans la colonne de chacun. |
| Conflit | **Alerte ambre non bloquante** sur le bloc d'un tech déjà pris (« déjà pris : {autre RDV} ») + compteur près du bouton. **L'user tranche** (« Planifier quand même »). |
| Schéma | **Aucune table nouvelle.** Une seule évolution **additive** de la vue `majordhome_appointments` (techs agrégés + day_index dérivé). Convergence = **retrait** de code/silo, pas d'ajout. |
| Convergence chantier | **Dans le périmètre Bloc B.** Jours d'install → appointments ; retrait `intervention_slots`/`chantierSlots.service`. Sinon l'install — principal cas multi-créneau — reste sur l'ancien silo et l'assistant ne sert qu'à moitié. |
| Composant | **Un seul `SchedulingAssistant`** partagé, remplace `SchedulingPanel`, utilisé par tous les points d'entrée Bloc A. |
| Horaires par colonne | Si dispo, refléter `team_members.default_availability` (griser le hors-horaire) ; sinon **7h-19h** (range actuel). Best-effort, non bloquant. |
| Garde Bloc A | Intégration **staged**, build/lint **et** re-check des critères Bloc A à chaque stage. La logique d'activation/cycle de vie Bloc A n'est **pas** modifiée — on ne fait que (a) remplacer l'UI de picking, (b) créer N appointments au lieu d'1, via le **même** chemin de cycle de vie. |

## 4. Architecture d'ensemble

### 4.1 Modèle de données (rappel — pas de table nouvelle)

- **1 créneau = 1 `appointments` + N lignes `appointment_technicians`** (jointure existante : `appointment_id`, `technician_id`, `role` lead/assistant, `confirmed`, `google_event_id`, `actual_start/end_time`).
- **Multi-créneau** = N `appointments` partageant le même `lead_id` (chantier) ou `intervention_id` (entretien) — la relation `appointment → carte` est déjà **N:1** (Bloc A).
- **Install** = `appointment_type='installation'` + `lead_id`=chantier (le type et `lead_id` existent déjà ; `syncCardStateOnCreate` a déjà la branche installation).
- **Dérivation Bloc A inchangée** : `next_rdv_date = MIN(scheduled_date actifs)`, `has_active_rdv = EXISTS`. Un créneau à 2 techs = **1** appointment → le MIN/EXISTS et la puce de date sont identiques.

### 4.2 Évolution de la vue `public.majordhome_appointments` (additive, `security_invoker=true`)

Exposer, par appointment :
- `technician_ids uuid[]` et `technician_names text[]` — agrégés depuis `appointment_technicians` (permet à la grille jour de colorer les colonnes en **une** requête ; débloque aussi le `technicianFilter` du `MiniWeekCalendar` qui était inopérant).
- `chantier_day_index` / `chantier_total_days` — `ROW_NUMBER()` / `COUNT(*) OVER (PARTITION BY lead_id ORDER BY scheduled_date, scheduled_start)` filtré `appointment_type='installation'` (titre « 🔨 J{X}/{N} »).

> Respect conventions multi-tenant : `WITH (security_invoker=true)`, garder le `.eq('org_id', orgId)` côté front (défense en profondeur). Vérifier l'impact perf de l'agrégation (volumétrie modeste) ; repli possible = sous-requête latérale.

### 4.3 Composant `SchedulingAssistant` (remplace `SchedulingPanel`)

Orchestrateur découpé (règle qualité : pas de composant > 500 LOC, logique hors JSX) :

- **`SchedulingAssistant.jsx`** — état + assemblage. Props contextuelles héritées de `SchedulingPanel` (type, assigneeType, members, defaultDuration, lead) + nouveau `onConfirm(slots[])` (tableau de créneaux).
- **`DayResourceGrid.jsx`** — la vue **1 jour × colonnes par membre** (évolution CSS-grid de `MiniWeekCalendar`, toujours sans FullCalendar) : navigation jour (bande semaine en tête), colonnes = membres assignables selon le type (techniciens pour install/entretien/SAV ; commerciaux pour VT), blocs occupés par colonne, clic-glisser pour poser/régler la durée, surbrillance **ambre** sur chevauchement.
- **`SlotDraftList.jsx`** — la liste « Créneaux à planifier » (date, horaire, tech(s), retrait) : permet d'**empiler** plusieurs créneaux sans fermer la modale (= fix du bug), de changer de jour entre deux poses, d'ajouter/retirer un tech sur un créneau, et affiche le **compteur de conflits**.
- Réutilise **`TechnicianSelect`** pour le choix des membres.

**Sortie** : `slots[] = [{ date, startTime, endTime, duration, technicianIds, subject, notes }]`. L'assistant ne crée rien lui-même — il **retourne** les créneaux ; le caller crée N appointments via le service (cf. 4.4).

### 4.4 Service — création par lot + dispo + annulation ressource

Dans `appointments.service.js` :
- **`getTeamDayAvailability({ coreOrgId, date, memberIds })`** — RDV du jour par membre (via la vue étendue) → alimente les colonnes du `DayResourceGrid`.
- **`createAppointmentBatch(slots[], sharedContext)`** — crée N appointments (1 par créneau) en réutilisant le `createAppointment` existant (donc le **même** `syncCardStateOnCreate` Bloc A par appointment + sync Google par tech). `sharedContext` = `{ coreOrgId, appointment_type, lead_id?, intervention_id?, client_id?, subject_prefix }`.
- **`removeAppointmentTechnician(appointmentId, technicianId)`** — supprime **une** ligne de jointure (annulation ressource, libère le créneau, **pas** de reflux de carte : le RDV existe toujours). Si c'était le **dernier** tech → l'UI propose d'annuler le RDV (chemin `cancelAppointment` existant → là, reflux Bloc A normal).

> **Cycle de vie Bloc A** : inchangé. Création multi-créneau = boucle de `createAppointment` (chaque appel passe par `syncCardStateOnCreate`, forward-only). Annulation ressource ≠ suppression de RDV → ne touche pas `has_active_rdv`. Seules la suppression/annulation **du RDV** (déjà codées) refluent la carte.

### 4.5 Convergence chantier → appointments

- **Création** : depuis le kanban Chantier, « Prendre RDV » (install) ouvre l'assistant (type `installation` figé, `lead_id`=chantier pré-lié, multi-créneau attendu) → N appointments. Réactive l'icône ambre « à replanifier » sur `ChantierCard`.
- **Modale Chantier** : `ChantierInterventionSection` alimentée par les appointments du chantier (`lead_id` + `appointment_type='installation'`) au lieu des slots `interventions`. `useInterventionSlots` → `useChantierAppointments(leadId)`. Le bouton « Créer l'intervention » disparaît (plus de parent prérequis pour planifier).
- **Migration one-shot** (idempotente) : slots `interventions` → appointments `installation` (mapping `slot_date→scheduled_date`, `slot_start/end_time→scheduled_start/end`, `intervention_technicians→appointment_technicians`, parent `lead_id→lead_id`). Adaptation du script §6 de la spec 2026-05-06 en utilisant **`lead_id`** (et non `parent_chantier_id`, superflu car Bloc A relie déjà via `lead_id`). **Ré-auditer le volume** au moment du plan.
- **Retrait** : `chantierSlots.service.js` supprimé ; vue `majordhome_intervention_slots` conservée en lecture le temps de valider (rollback), puis supprimée ; méthodes `createInterventionSlot`/`deleteInterventionSlot` dépréciées puis retirées. `majordhome.interventions` (parents) **reste intact** (workflow chantier, PV réception).

## 5. Points d'entrée — implémentation

L'assistant remplace `SchedulingPanel` partout. Le contexte de rattachement (carte cible + type imposé/libre) vient de Bloc A.

- **Modale entretien** (`SchedulingTransitionModal`) — type Entretien/SAV, `intervention_id` pré-lié, assignation technicien. Multi-créneau possible (rare en entretien, fréquent en install).
- **Pipeline** (`LeadModal`) — type VT, `lead_id` pré-lié, assignation commercial (colonnes par commercial).
- **Kanban Chantier** — **nouveau** : type Installation figé, `lead_id`=chantier pré-lié, multi-créneau.
- **Kanban Pipeline / Entretien** — « Prendre RDV », type figé par le kanban.
- **Fiche client / Planning** (`EventModal`) — l'assistant remplace `SectionDateTime` + `SectionAssignee`. Le `handleSave` boucle sur les `slots[]` retournés (1 → comportement actuel ; N → install). **La logique d'activation déduppée Bloc A (`resolveCardForAppointment`, walk-in prospect) reste intacte** — seule la partie « date + techs + N créneaux » change.

## 6. Stages d'implémentation (découpage Bloc A)

Chaque stage : `npx vite build` + `npm run lint` + **re-check des critères de succès Bloc A** (§9 de la spec Bloc A) avant de passer au suivant. Le plan (`writing-plans`) détaillera.

1. **Vue + service** — étendre `majordhome_appointments` (techs agrégés + day_index) ; `getTeamDayAvailability`, `createAppointmentBatch`, `removeAppointmentTechnician`. Pas d'UI encore.
2. **`SchedulingAssistant`** — `DayResourceGrid` (jour + colonnes par membre + conflit ambre), `SlotDraftList` (empilage = fix du bug), parité mono-créneau d'abord, puis multi. Branché sur les callers actuels de `SchedulingPanel` (entretien + pipeline). `SchedulingPanel` retiré.
3. **`EventModal`** — intégration de l'assistant (remplace date/heure + assignation), `handleSave` boucle les créneaux. **Stage le plus sensible Bloc A** (chemin d'activation).
4. **Convergence chantier** — flux install depuis le kanban Chantier ; `ChantierInterventionSection`/`ChantierModal`/`useChantierAppointments` sur appointments ; migration des slots ; icône ambre réactivée.
5. **Nettoyage** — retrait `chantierSlots.service.js`, vue `majordhome_intervention_slots` + méthodes slots après validation prod ; `audit:dead-code` ; MàJ `CLAUDE.md`/`DATABASE.md`.

## 7. Fichiers impactés (pré-inventaire)

- **Migration DB** : vue `majordhome_appointments` (additive) ; script one-shot slots→appointments ; (plus tard) drop vue `majordhome_intervention_slots`.
- `src/shared/services/appointments.service.js` — `getTeamDayAvailability`, `createAppointmentBatch`, `removeAppointmentTechnician`.
- `src/apps/artisan/components/pipeline/SchedulingPanel.jsx` → **remplacé** par `SchedulingAssistant.jsx` (+ `DayResourceGrid.jsx`, `SlotDraftList.jsx`).
- `src/apps/artisan/components/planning/MiniWeekCalendar.jsx` — refondu en `DayResourceGrid` (jour + colonnes par membre) ; le `technicianFilter` devient effectif via la vue étendue.
- `src/apps/artisan/components/entretiens/SchedulingTransitionModal.jsx`, `pipeline/LeadModal.jsx` — consomment l'assistant (`onConfirm(slots[])`).
- `src/apps/artisan/components/planning/EventModal.jsx` + `EventFormSections.jsx` — assistant en place de `SectionDateTime`/`SectionAssignee` ; save en boucle.
- `src/apps/artisan/components/chantiers/{ChantierModal,ChantierInterventionSection,ChantierCard}.jsx` — slots → appointments ; icône ambre réactivée ; bouton « Prendre RDV » install.
- `src/shared/services/chantierSlots.service.js` — **supprimé** (Stage 5).
- `src/shared/hooks/useAppointments.js` — `useTeamDayAvailability`, `useChantierAppointments` ; invalidations croisées (kanban ↔ appointments) au batch/remove.
- `src/shared/hooks/cacheKeys.js` — clés dispo jour / chantier appointments (orgId en 1er param, convention P0.11).

## 8. Risques & points ouverts

- **`EventModal` multi-créneau + Bloc A** : le save en boucle touche le chemin d'activation. Mitigation : ne pas modifier `resolveCardForAppointment`/walk-in ; seule la création passe de 1 à N appels `createAppointment` ; re-check critères Bloc A au Stage 3.
- **Migration slots → appointments** : volume à ré-auditer (≈ quelques lignes en mai). Script idempotent + vue de rétro-compat conservée le temps de valider + backup avant.
- **Sync Google par tech** : `createAppointment` déclenche déjà la sync par tech (fire-and-forget) ; le batch doit la préserver (1 appel par appointment).
- **`team_members.default_availability`** : shape jsonb à confirmer au plan ; traitement best-effort (fallback 7h-19h) — ne pas bloquer le Bloc B dessus.
- **Conflit limité aux appointments** : pas encore les indispos Google (hors scope) — à documenter dans l'UI (« basé sur les RDV Majord'home »).
- **Largeur modale si beaucoup de membres** : OK Mayer (2-3) ; scroll horizontal pour une org plus grande.
- **VT = assignation commercial** : colonnes par commercial pour la VT (membres assignables selon le type). Peu de commerciaux chez Mayer ; généraliser « colonnes = membres assignables du type ».
- **Cohérence avec la spec 2026-05-06** : Bloc B réalise de facto la **Phase 1** (convergence chantier→appointments) avec le modèle de liens de Bloc A (`lead_id`) au lieu de `parent_chantier_id`. Les Phases 2-6 (Resource view, absences, Google) restent ouvertes et compatibles.

## 9. Critères de succès

- Planifier un **entretien** depuis l'assistant : choisir le jour → voir la dispo des techs → poser un créneau → assigner un tech ⇒ **1 appointment**, carte Entretien « Planifié », **aucun lead créé** (Bloc A préservé).
- Poser une **install à 2 techs** sur un jour ⇒ **1 appointment**, **2 blocs** (1 par colonne) ; le déplacer ⇒ **les deux suivent**.
- **Retirer 1 tech** d'un RDV à 2 techs ⇒ son bloc disparaît, le **RDV reste** ; retirer le dernier ⇒ proposition d'annuler le RDV.
- **Empiler 2 créneaux** (jours différents) dans l'assistant **sans que la modale se ferme** ⇒ 2 appointments (**le bug est corrigé**).
- Ajouter un tech **déjà occupé** sur le créneau ⇒ **alerte ambre non bloquante**, planification possible quand même.
- Planifier une **install multi-jours depuis le kanban Chantier** ⇒ N appointments, puce = **1ᵉʳ jour**, icône **ambre** au retrait du dernier RDV.
- Les **jours de chantier apparaissent nativement** sur le Planning (plus via le service transitoire) ; `chantierSlots.service.js` retiré ; **aucune régression** sur les critères de succès Bloc A.
