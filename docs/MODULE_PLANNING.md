# Module Planning / Prise de RDV ↔ Kanban (Bloc A + Bloc B assistant créneaux)

> Déporté de CLAUDE.md (restructuration 2026-06-18). Pointeur + règles qui mordent : CLAUDE.md § Modules.

Refonte du service de prise de RDV. **Principe unique** : un RDV (`appointments`) planifie **une seule carte** (work item) déterminée par son **type** ; l'état de la carte est piloté par ses RDV. **Plus d'auto-lead silencieux** (cause historique des leads fantômes dans le pipeline).

### Types → destination unique
| Type (`appointment_type`) | Kanban | Work item |
|---|---|---|
| `rdv_technical` (Visite Technique = closing) + `rdv_agency` (legacy, alias) | Pipeline | `leads` (`status_id`) |
| `installation` | Chantier | `leads` (`chantier_status`) |
| `maintenance` (Entretien) | Entretien | `interventions` (`entretien`) |
| `service` (SAV) | Entretien | `interventions` (`sav`) |
| `other` (Autre) | — (planning seul) | aucun — **défaut non piégeux** |

### Modèle de données
- Lien `appointments.intervention_id` (miroir de `lead_id`, FK `ON DELETE SET NULL`). Un RDV pointe vers `lead_id` **ou** `intervention_id` **ou** rien (Autre). Multi-RDV : N appointments par carte (la date carte = 1ᵉʳ RDV).
- **Dérivation, source unique = `appointments`** : les vues `majordhome_entretien_sav`, `majordhome_chantiers`, `majordhome_kanban_cards` exposent `next_rdv_date` (MIN des RDV actifs liés) + `has_active_rdv`, via `LEFT JOIN LATERAL` filtré par type d'appt (`status NOT IN ('cancelled','no_show')`). Toutes en `security_invoker=true` (préservé). **Pas de champ dénormalisé** : puce date + marqueur ambre dérivent de ces 2 colonnes. Le filtre par type évite qu'un vieux RDV VT pollue la date d'un chantier (pipeline = `rdv_technical`/`rdv_agency`, chantier = `installation`, entretien = via `intervention_id`).

### Activation (prendre un RDV)
- `appointmentActivation.service.js::resolveCardForAppointment({type, clientId, leadId?, interventionId?})` : rattache (depuis un kanban) **ou** active la carte du client (dédup par client+type, jamais de doublon, jamais de formulaire prospect). Entretien/SAV → matérialise l'intervention via `entretiens.service.js::ensureEntretienCard`. VT → réutilise un lead **actif** (≠ Gagné/Perdu) sinon en crée un lié au client. `other` → rien.
- **Prospect** (vrai formulaire) réservé au **walk-in inconnu** (Planning, ni client ni lead lié), dans `EventModal::handleSave`.
- `EventModal` accepte `attachContext={ leadId?, interventionId?, lockedType? }` (rattachement direct + type figé depuis un kanban). Défaut fiche/planning = `other` ; Installation non proposée depuis la fiche.

### Cycle de vie carte ↔ RDV (unique writer = `appointments.service.js`)
- `syncCardStateOnCreate` (prise) : avance la carte en « planifié » **forward-only** (entretien `workflow_status→planifie` ; lead VT `status_id→RDV planifié` si display_order<3 ; chantier `chantier_status→planification` si en amont). Ne descend jamais, ne touche pas un état terminal.
- `recomputeEntretienWorkflow` (suppression/annulation de RDV) : entretien → recalcule `planifie`/`a_planifier` selon présence d'un RDV actif. Pipeline/chantier : no-op (marqueur « à replanifier » dérivé de `has_active_rdv=false`).
- **Les 3 chemins de planification entretien doivent poser `intervention_id`** : `EntretienSAVModal.handleConfirmScheduling`, `EntretienSAVKanban.handleConfirmSchedule`, `entretiens.service.ensureKanbanAndAppointmentForVisit`. Le pipeline pose déjà `lead_id` (`LeadModal`).
- **Brique de planification partagée `savService.scheduleEntretien({ card, slots, includesEntretien, coreOrgId })`** (2026-06-17) : source unique de planification entretien/SAV (createAppointmentBatch type `maintenance`/`service` avec `intervention_id` + `scheduled_date` + `workflow_status='planifie'` + confirm web-draft). Appelée par `EntretienSAVKanban.handleConfirmSchedule` **et** `ContractModal` (bouton « Planifier » → `ensureEntretienCard` → `SchedulingTransitionModal`). Ne pas réimplémenter la séquence ailleurs. ⚠️ `savService.updateFields` est une **allowlist par champ** : un champ absent de la liste est silencieusement ignoré (`scheduled_date` ajouté le 2026-06-17, sinon la date de planif était perdue — y compris dans l'ancien kanban).
- **`ContractModal` (slide-over entretien) planifie via le système unifié** (plus de « Marquer comme effectué »). Badge « Visite {année} » dérivé par `deriveVisitBadgeStatus({ visits, activeCard, currentYear })` (`src/lib/entretienVisitStatus.js`, testé `scripts/entretien-visit-status.test.mjs`) : visite courante `completed`→Réalisé ; `cancelled`/`skipped`→**Non réalisé (tâche close, ≠ « À faire »)** ; sinon carte active `planifie`→Planifié ; sinon À planifier. Carte active lue via `useEntretienByContract(orgId, contractId)`.

### Cartes & kanban
- Puce de gauche = **date du RDV** (`next_rdv_date` > `scheduled_date` > `created_at`). Pipeline : icône ambre `CalendarClock` si colonne `rdv_planifie` sans RDV actif. **Chantier** : icône ambre `CalendarClock` si `chantier_status='planification'` sans RDV `installation` actif (`!has_active_rdv`) — réactivé au Bloc B stage 4 (flux de planif installation depuis `ChantierModal`).
- `EntretienSAVKanban` : tri par date du RDV **ascendant** (du plus ancien au plus futur), même clé que l'affichage. Le `KanbanBoard` générique préserve l'ordre des items.
- Bouton **« Ranger »** (icône `Archive`, bas-gauche, cartes `a_planifier` uniquement) : `savService.deleteEntretienCard` + toast undo (recrée via `createEntretien`). Invalide `entretienSavKeys.all(orgId)` → dégrise instantanément le contrat dans l'outil Programmation (`plannedContractIds` est une query sous ce préfixe). Certificats masqués en `a_planifier` (utiles seulement une fois planifié).

### Assistant créneaux (Bloc B — livré 2026-06)
- Dossier `src/apps/artisan/components/planning/scheduling/` : `SchedulingAssistant.jsx` (orchestrateur multi-créneau), `DayResourceGrid.jsx` (vue jour × colonnes par membre, drag pour poser un créneau, conflits ambre non bloquants, off-hours grisés), `SlotDraftList.jsx` (créneaux en construction, tech par ligne). Remplace `SchedulingPanel`.
- **Contrat** : 1 créneau = 1 appointment, multi-créneau = N appointments via `appointmentsService.createAppointmentBatch(slots, ctx)`. `appointment_type` imposé par le **caller** (contexte partagé), pas par-slot. VT → commerciaux, entretien/SAV → techniciens.
- **Stage 4 — convergence chantier (2026-06-04)** : les jours d'installation sont des `appointments` `installation` natifs (`lead_id=chantier.id`), plus d'« intervention parent » ni de `intervention_slots`. `ChantierModal` ouvre `SchedulingAssistant` (multi-jours) → `createAppointmentBatch({ appointment_type:'installation', lead_id: chantier.id })` ; `ChantierInterventionSection` = liste read-only des appointments (`J X/N` via `chantier_day_index`/`chantier_total_days`) ; `useAppointments` ne merge plus les chantier-slots.

### Gotcha & reste à faire
- **⚠️ Backfill entretien** : un RDV `maintenance` sans `intervention_id` ne veut PAS dire entretien non fait — il peut déjà être `realise`/`facture`. Un backfill ne gardant que `workflow_status NOT IN (realise,facture)` crée des doublons « planifié » pour des entretiens déjà faits. **Scope correct = RDV À VENIR uniquement** (régression vécue & corrigée le 2026-06-03 : 24 doublons supprimés).
- **Reste (Bloc B stage 5)** : nettoyage des services orphelins post-convergence chantier (`chantierSlots.service.js`, `chantierSlotKeys`, `useInterventionSlots`, `getChantierInterventionByLeadId`, mutations `createChantierIntervention/createSlot/deleteSlot`) + DROP vue `intervention_slots` (5 slots historiques non migrés — décision Eric : repartir propre). À faire après validation prod.
- Spec Bloc A : `docs/superpowers/specs/2026-06-03-rdv-kanban-unifie-bloc-a-design.md` · Plan : `docs/superpowers/plans/2026-06-03-rdv-kanban-unifie-bloc-a.md` · mémoire `project_refonte_rdv_kanban_bloc_a.md`.
- Spec Bloc B (assistant créneaux multi-tech, à implémenter) : `docs/superpowers/specs/2026-06-03-rdv-kanban-assistant-creneaux-bloc-b-design.md` · Plan : `docs/superpowers/plans/2026-06-03-rdv-kanban-assistant-creneaux-bloc-b.md`.

