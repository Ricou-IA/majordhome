# Spec — Refonte prise de RDV ↔ Kanban (modèle unifié) — Bloc A

> **Date** : 2026-06-03
> **Auteur** : Brainstorming Eric + Claude
> **Statut** : Validé en brainstorming — à relire avant plan d'implémentation
> **Périmètre** : Bloc A uniquement (modèle de données + cycle de vie + activation). Le Bloc B (assistant créneaux / disponibilités par user) fera l'objet d'une spec dédiée.

## 1. Contexte & motivation

### Le symptôme rapporté
Un RDV de type « Entretien » créé depuis la fiche client **n'apparaît jamais** dans le Kanban Entretien. En parallèle, des clients existants dont on a simplement programmé un entretien (SHIELD LUANN, LENDRIN, TOUAHRIA…) se retrouvent comme **leads fantômes** dans la colonne « RDV planifié » du pipeline.

### La cause racine (vérifiée en base)
L'action « Nouveau RDV » mélange en silence **trois objets** aux cycles de vie distincts :

1. **`appointments`** — le créneau calendrier (Planning)
2. **`interventions`** (type `entretien`/`sav`) — la carte du Kanban Entretien
3. **`leads`** — la carte du pipeline commercial (et du chantier via `chantier_status`)

Constats DB :
- `leads` ↔ `appointments` sont liés dans les deux sens (`leads.appointment_id` + `appointments.lead_id`) → le pipeline/chantier savent quel RDV les planifie.
- `interventions` ↔ `appointments` : **aucun lien**. L'entretien stocke sa propre `scheduled_date` sans connaître le RDV.
- Faute de ce pont, un RDV « Entretien » ne peut **pas** matérialiser de carte Kanban.
- Et un side-effect dans `EventModal.jsx` (`handleSave`, ~lignes 423-456) fait un `INSERT` **aveugle** d'un nouveau lead dès que le type est « commercial » (`COMMERCIAL_TYPES = ['rdv_agency','rdv_technical']`), **sans dédup** et **sur le mauvais kanban**. Le type **par défaut** du modal étant `rdv_technical`, programmer un entretien crachait un lead fantôme avant même la bascule en `maintenance`.

Mesure de l'existant (leads dont `notes LIKE 'Lead auto-créé depuis le Planning%'`) : 10 leads — 6 « RDV planifié », 2 « Gagné » (vraies affaires, à préserver), 2 « Perdu ». Le nettoyage ne peut donc **pas** être aveugle.

### Objectif
Redéfinir le service de prise de RDV autour d'**un principe unique** :

> Un RDV est la **planification d'une carte** (work item). Le **type** détermine le kanban de destination. L'état de planification de la carte est **piloté par ses RDV**. Aucun type ne crée quoi que ce soit en silence.

Le résultat net est une **réduction** de la complexité : un lien ajouté, un side-effect retiré, un cycle de vie rendu cohérent — moins de chemins de code qu'aujourd'hui.

## 2. Scope

### Dans le scope (Bloc A)
- Nouveau lien `appointments.intervention_id` (miroir de `lead_id`) → l'entretien/SAV devient « linkable » comme le lead l'est déjà.
- **5 types de RDV** avec destination unique : Visite Technique → Pipeline, Installation → Chantier, Entretien → Entretien, SAV → Entretien, **Autre → aucun kanban (planning seul)**.
- **Geste d'activation** : prendre un RDV rattache/active **une** carte (dédup par client + type), matérialise la carte entretien si absente, ne crée jamais de carte commerciale en doublon.
- Suppression du side-effect auto-lead.
- **Cycle de vie carte ↔ RDV** unifié : prise / déplacement / suppression, avec garde *forward-only* et reflux à la suppression.
- **Multi-RDV par carte** (fréquent pour l'installation) : N RDV → 1 carte, puce de date = 1ᵉʳ RDV.
- **Puce de gauche** comme indicateur d'état RDV universel sur les 3 kanbans (date / icône ambre « à replanifier »).
- Points d'entrée : prise de RDV depuis fiche client, Planning, et les 3 kanbans.
- **Remédiation de l'existant** (one-shot) : nettoyage des leads fantômes + backfill des cartes entretien manquantes.

### Hors scope explicite
- **Bloc B — assistant créneaux** : modale « créneaux libres », disponibilités **par user**, fix du bug « créneau pris = impossible d'en ajouter un autre ». Spec dédiée. *(La donnée multi-RDV est en A ; l'UX de recherche de créneaux est en B.)*
- **Génération proactive** des entretiens à venir depuis les contrats (peuplement automatique de « À planifier » par échéance `maintenance_month`) — itération future. En A, la carte entretien se matérialise au moment où on la planifie.
- **Refonte du Planning calendrier** (FullCalendar) au-delà du strict nécessaire pour refléter les liens.
- **i18n** — tout en français.
- **Réassignation** d'un RDV d'une carte vers une autre — pas exposé en A.

## 3. Décisions de design validées en brainstorming

| Question | Décision |
|---|---|
| Que crée « prendre un RDV » ? | Toujours **un seul** rattachement à une carte. Le **type** détermine le kanban. Jamais deux kanbans. |
| Carte commerciale (lead/chantier) créée par un RDV ? | **Non.** Les cartes commerciales naissent du cycle de vente. Le RDV ne fait que les planifier. |
| Visite Technique | Visite de **closing commercial**, posée sur un lead **déjà présent** dans le pipeline. |
| Client existant qui veut une VT | Pas de formulaire prospect. On **active sa carte en sommeil** : réutilise sa carte pipeline si elle existe, sinon en matérialise **une seule** liée au `client_id`. |
| Entretien/SAV depuis la fiche | Matérialise la carte intervention (dédup). **Lié au contrat actif si présent ; sinon carte dégradée sans équipements** — le technicien créera le contrat + identifiera l'équipement sur place. |
| Installation depuis la fiche | **Interdit** (nécessite un devis). Le besoin réel = un RDV **« Autre »**, visible au planning seulement, on adapte sur place. |
| 5ᵉ type « Autre » | Créneau calendrier pur : aucun work item, aucun kanban, aucune activation. Remplace l'ancien défaut piégeux. |
| Défaut du type dans le modal | **Plus de défaut qui active en silence.** Depuis un kanban, le type est **imposé** par le kanban. Depuis fiche/planning, le défaut est **« Autre »** (no-op) — l'utilisateur choisit explicitement un type activant. |
| Garde anti-régression | Prendre un RDV **avance** la colonne **seulement si la carte est en amont**. Une carte déjà plus loin (ex. lead « Devis envoyé ») **garde sa colonne** ; on attache juste le RDV (un 2ᵉ RDV « visite technique » est légitime). Jamais de descente dans le flux décisionnel. |
| Suppression d'un RDV — Entretien | La carte **retourne en « À planifier »** (`workflow_status → a_planifier`), sauf état terminal (`realise`/`facture`). |
| Suppression d'un RDV — Pipeline / Chantier | La carte **reste en place** (pas de colonne « à planifier ») et affiche un **marqueur à replanifier**. |
| Forme du marqueur « à replanifier » | **Icône + couleur douce (ambre)**, pas de texte ; libellé « À replanifier » en tooltip. Réutilise l'emplacement de la puce de date (pas de nouveau badge). |
| Multi-RDV par carte | Supporté (fréquent pour l'installation). La carte reste *Planifiée* tant qu'il reste ≥1 RDV ; le marqueur ambre n'apparaît qu'au retrait du **dernier**. |
| Date affichée sur la carte | **Date du 1ᵉʳ RDV** (MIN des RDV actifs liés ; pour une install multi-jours = 1ᵉʳ jour). Format `JJ mois` (ex. « 28 Mai »). |
| Source de vérité de la planification | La table **`appointments`**. Les indicateurs de planification (date, présence) sont **dérivés** des RDV liés, pas dupliqués → élimine la dérive (cause du bug). Les états **décisionnels** restent stockés (`leads.status_id`, `interventions.workflow_status` terminal). |
| Prospect (formulaire) | Ne survit qu'à **un seul endroit** : un inconnu **sans fiche**, depuis le Planning (VT/commercial). |

## 4. Architecture d'ensemble

### 4.1 Les 5 types et leur destination unique

| Type (`appointment_type`) | Kanban | Work item | Créable depuis la fiche ? |
|---|---|---|---|
| `rdv_technical` — Visite Technique | Pipeline | `leads` (`status_id`) | oui (active la carte client) |
| `installation` — Installation | Chantier | `leads` (`chantier_status`) | **non** (vient d'un deal gagné) |
| `maintenance` — Entretien | Entretien | `interventions` (`entretien`) | oui |
| `service` — SAV | Entretien | `interventions` (`sav`) | oui |
| `other` — Autre | — (planning seul) | aucun | oui |

> Note : `rdv_agency` (« RDV Commercial ») de l'énum actuelle est fusionné conceptuellement dans Visite Technique côté produit. Le plan tranchera entre suppression du type et conservation comme alias (impact sur l'historique des RDV existants).

### 4.2 Modèle de données

**Ajout unique** :
- `majordhome.appointments.intervention_id uuid NULL` — FK → `majordhome.interventions(id)` `ON DELETE SET NULL`.
- Exposition de la colonne dans la vue `public.majordhome_appointments`.

**Invariant** : un RDV pointe vers **au plus un** work item :
- VT → `lead_id` (pipeline)
- Installation → `lead_id` (chantier, même table `leads`)
- Entretien / SAV → `intervention_id`
- Autre → ni l'un ni l'autre

**Multi-RDV** : la relation `appointment → carte` est **N:1** (déjà le cas via `lead_id`, désormais aussi via `intervention_id`). Une carte agrège ses RDV.

**Dérivation (single source of truth = `appointments`)** — les vues kanban exposent, par carte :
- `next_rdv_date` = `MIN(scheduled_date)` des RDV **actifs** liés (statut ∉ `cancelled`),
- `has_active_rdv` = `EXISTS` d'un RDV actif lié.

Ces deux champs pilotent la puce de date et le marqueur ambre, **sans** champ dénormalisé à maintenir (on supprime la dérive de `leads.appointment_date` / `interventions.scheduled_date` comme source d'affichage ; ces colonnes peuvent rester pour compat legacy mais ne sont plus la vérité d'affichage).

**États décisionnels (restent stockés, écrits explicitement)** :
- `leads.status_id` — étape de vente (Nouveau…Perdu). Avancé à « RDV planifié » à la prise (forward-only). **Non** rétrogradé à la suppression.
- `interventions.workflow_status` — `a_planifier` / `planifie` / `realise` / `facture`. La distinction `a_planifier ⟺ planifie` suit la présence d'un RDV ; les états terminaux priment.
- `leads.chantier_status` — état du chantier (valeurs exactes à mapper dans le plan).

### 4.3 Geste d'activation (prendre un RDV)

Règle unique : **prendre un RDV = se rattacher à une carte.** Ce qui varie selon l'entrée, c'est *comment on désigne la carte* :

| Entrée | Comportement |
|---|---|
| **Kanban** (Pipeline / Chantier / Entretien) | La carte est sous la main ; le type est imposé par le kanban → **rattachement direct** du RDV à cette carte. |
| **Fiche client** (VT / Entretien / SAV / Autre) | **Activation** : réutilise la carte du client dans le kanban du type choisi si elle existe (dédup `client_id` + type), sinon la **matérialise** (entretien/SAV : intervention liée au contrat actif si présent ; VT : un lead lié au client). « Autre » ne matérialise rien. **Jamais de formulaire prospect.** Installation non proposée. |
| **Planning + client connu** | Identique à la fiche (sélection client + type → activation). |
| **Planning + inconnu (walk-in)** | **Seul cas « prospect »** : VT → création d'un vrai lead prospect (formulaire). |

**Dédup** (le cœur du fix anti-fantôme) : avant de matérialiser, on cherche une carte active existante pour `(client_id, type→kanban)`. Si trouvée → on rattache. Sinon → on crée **une seule** carte liée au `client_id`.

**Préconditions de matérialisation entretien** : l'intervention exige `client.project_id` (INNER JOIN `core.projects` dans `majordhome_entretien_sav`). Si le client n'a pas de `project_id`, on ne peut pas matérialiser → le plan définit le fallback (création projet implicite vs blocage explicite). Réutiliser la logique idempotente existante `ensureKanbanAndAppointmentForVisit` ([entretiens.service.js:46](../../src/shared/services/entretiens.service.js)) en l'extrayant en helper qui crée **l'intervention seule** (le RDV est déjà créé par le flux d'activation — éviter le double appointment).

### 4.4 Cycle de vie carte ↔ RDV

Centralisé dans **un seul chemin** (`appointmentsService` : `createAppointment` / `updateAppointment` / `moveAppointment` / `deleteAppointment`) — c'est le seul writer de l'état induit par les RDV.

**1. Prise** (`create`)
- Lier le RDV (`lead_id` **ou** `intervention_id` ; rien si Autre).
- **Avancer la colonne seulement si la carte est en amont** de l'état « planifié » :
  - Entretien : `workflow_status → planifie` (sauf terminal).
  - Pipeline : `status_id → RDV planifié` **uniquement si** l'étape courante est antérieure (sinon garder).
  - Chantier : passage à l'état planifié si antérieur.
- La puce de date s'affiche (dérivée = `next_rdv_date`).

**2. Déplacement** (`move` / changement de date)
- Met à jour la date du RDV. La puce se recalcule (MIN). **Pas** de changement de colonne.

**3. Suppression** (`delete`)
- Délier le RDV.
- S'il reste **≥1 RDV actif** sur la carte → ne rien changer (la puce recule sur le nouveau MIN).
- Si c'était le **dernier** RDV :
  - Entretien : `workflow_status → a_planifier` (sauf terminal) → la carte retourne visuellement dans la colonne « À planifier ».
  - Pipeline / Chantier : la carte **reste en place** ; la puce bascule en **icône ambre** (dérivé : la carte est dans un état « planifié » mais `has_active_rdv = false`).

> Aujourd'hui `deleteAppointment` ne touche **ni** le lead **ni** l'intervention → c'est précisément ce vide que ce cycle de vie comble.

### 4.5 Indicateur visuel unifié (puce de gauche)

Sur **toutes** les cartes kanban (`LeadCard`, `ChantierCard`, `EntretienSAVCard`), la puce de gauche devient l'indicateur d'état RDV :
- `has_active_rdv = true` → **date** `next_rdv_date` au format `JJ mois` (neutre).
- carte en état « planifié » mais `has_active_rdv = false` → **icône ambre** (`CalendarClock` ou équivalent, couleur ambre, tooltip « À replanifier »). *(Pipeline/Chantier uniquement — l'entretien matérialise le besoin via le retour en colonne « À planifier ».)*

## 5. Points d'entrée — implémentation

- **Fiche client** ([ClientDetail.jsx:301](../../src/apps/artisan/pages/ClientDetail.jsx)) — bouton « Nouveau RDV » → `EventModal` en mode activation : types proposés VT / Entretien / SAV / Autre (pas Installation), client pré-lié.
- **Planning** ([Planning.jsx](../../src/apps/artisan/pages/Planning.jsx)) — création depuis le calendrier : tous types ; client connu → activation, inconnu + VT → prospect.
- **Kanban Pipeline** — action « Prendre RDV » sur une carte lead → `EventModal` type VT figé, lead pré-lié.
- **Kanban Chantier** — action « Prendre RDV » sur une carte chantier → `EventModal` type Installation figé, chantier pré-lié (supporte multi-RDV).
- **Kanban Entretien** — action « Prendre RDV » sur une carte → type Entretien/SAV figé, intervention pré-liée.

`EventModal` ([EventModal.jsx](../../src/apps/artisan/components/planning/EventModal.jsx)) reçoit un **contexte de rattachement** (carte cible + type imposé/libre) au lieu de décider seul. Le bloc auto-lead (`COMMERCIAL_TYPES`) est **supprimé** et remplacé par le helper d'activation déduppé.

## 6. Remédiation de l'existant (one-shot, après livraison du code)

À exécuter **après** que le nouveau modèle soit en place (sinon re-pollution) :

1. **Side-effect** : retiré par le code (point 5).
2. **Leads fantômes** — soft-delete (`is_deleted = true`) des **3 cas clairs** (statut « RDV planifié », client lié à un entretien `maintenance`, **aucune** visite commerciale) : SHIELD (`9de16f90`), LENDRIN (`bfaa876a`), TOUAHRIA (`4dd66795`).
   - **À soumettre à Eric** avant action : les 3 ambigus (PRESSION « INSTAL PAG » sans contrat, DOUCET, COROIR — qui ont *aussi* une visite technique).
   - **À préserver absolument** : les 2 « Gagné » (CAPPAROS `e9ce3618`, MAZEL `f2011008`).
3. **Backfill entretien** — pour chaque RDV `maintenance` déjà posé mais sans intervention liée (SHIELD & co), matérialiser la carte entretien (intervention liée au contrat actif) en `workflow_status = planifie` + poser `appointments.intervention_id`. Périmètre : RDV `maintenance` futurs/récents non clôturés.

## 7. Fichiers impactés (pré-inventaire)

- **Migration DB** : `appointments.intervention_id` + FK ; vue `majordhome_appointments` (exposer la colonne) ; vues `majordhome_entretien_sav`, pipeline (`majordhome_kanban_cards` ?) et chantier (`majordhome_chantiers`) pour exposer `next_rdv_date` / `has_active_rdv`. Respect conventions multi-tenant : vues `security_invoker=true`, `GRANT SELECT ... TO service_role` si nouvelle table lue par edge (n/a ici).
- `src/shared/services/appointments.service.js` — chemin unique create/move/delete : liaison + sync d'état + reflux.
- `src/shared/services/entretiens.service.js` — extraire de `ensureKanbanAndAppointmentForVisit` un helper « matérialiser l'intervention seule » réutilisable par l'activation.
- `src/apps/artisan/components/planning/EventModal.jsx` — supprimer l'auto-lead ; logique d'activation déduppée ; contexte de rattachement ; type « Autre » ; défaut non-activant.
- `src/apps/artisan/components/planning/EventFormSections.jsx` — `SectionType` : liste de types selon l'entrée, retrait de la notice violette auto-lead.
- Cartes : `LeadCard`, `chantiers/ChantierCard.jsx`, `entretiens/EntretienSAVCard.jsx` — puce de gauche (date / icône ambre).
- Boutons « Prendre RDV » dans `LeadKanban` / `ChantierKanban` / `EntretienSAVKanban`.
- Hooks d'invalidation de cache croisée (kanban ↔ appointments) au create/move/delete.

## 8. Risques & points ouverts

- **Énum `rdv_agency`** : décision plan — supprimer vs garder comme alias de VT (impact RDV historiques).
- **Client sans `project_id`** : fallback de matérialisation entretien à trancher (création projet implicite vs blocage).
- **Chantier `chantier_status`** : mapper les valeurs exactes (état « planifié » / terminal) avant de câbler la garde forward-only.
- **Vues dérivées vs perf** : si l'agrégation `MIN/EXISTS` sur `appointments` alourdit les vues kanban (volumétrie ~750 contrats, N RDV), le plan évaluera un champ `next_rdv_date` maintenu centralement comme repli — mais **un seul** chemin de maintenance, jamais trois.
- **Cohérence Google Calendar sync** : la suppression/déplacement de RDV reste fire-and-forget existant ; vérifier que le reflux de carte n'introduit pas de double sync.

## 9. Critères de succès

- Programmer un RDV « Entretien » depuis la fiche d'un client sous contrat → carte visible dans le Kanban Entretien « Planifié », **et aucun** lead créé.
- Supprimer ce RDV → la carte revient en « À planifier ».
- Poser une VT sur un lead « Devis envoyé » → le RDV s'attache, la date s'affiche, **la colonne ne bouge pas**.
- Supprimer le dernier RDV d'un lead « RDV planifié » → icône ambre, carte en place.
- Installation multi-jours sur un chantier → plusieurs RDV, puce = 1ᵉʳ jour.
- « Autre » depuis la fiche → RDV au planning, **aucune** carte kanban.
- Après remédiation : plus aucun lead fantôme « RDV planifié » lié à un pur entretien ; les 2 « Gagné » intacts.
