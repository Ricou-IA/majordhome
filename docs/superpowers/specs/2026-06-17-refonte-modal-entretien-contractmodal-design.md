# Refonte UI du modal Entretien (`ContractModal`) — Design

> **Date** : 2026-06-17
> **Statut** : Validé (feu vert Eric) — prêt pour plan d'implémentation
> **Fichiers cœur** : `src/apps/artisan/components/entretiens/ContractModal.jsx`, `src/apps/artisan/components/pipeline/LeadFormSections.jsx`, `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx`, `src/shared/services/entretiens.service.js`

## 1. Contexte & problème

Le slide-over `ContractModal` (ouvert au clic sur un contrat dans la page Entretiens, ou depuis la Programmation) est un composant **Sprint 5** branché sur l'**ancien système** d'entretien :
- statut visite = `contract.current_year_visit_status` (colonne calculée de la vue `majordhome_contracts`)
- historique = `contract_visits` / `majordhome_maintenance_visits` (via `useContractVisits`)
- « Marquer comme effectué » = `entretiensService.recordVisit(...)`

Or la **planification** d'entretien passe désormais par le **système unifié** (RDV ↔ Kanban, Bloc A/B) : une carte entretien (`majordhome.interventions`, `intervention_type='entretien'`) → des `appointments` de type `maintenance`, planifiés via `SchedulingTransitionModal` (qui enveloppe `SchedulingAssistant`). La page Entretiens a déjà `handlePlanContract` qui crée une carte « à planifier ».

Cette dualité génère plusieurs frictions UI + un bug de cohérence de statut. Objectif : nettoyer le modal, le brancher sur le système unifié pour la planification, factoriser la carte « Client lié » du pipeline, et corriger deux bugs d'affichage de statut.

## 2. Décisions actées (arbitrage Eric)

| # | Décision |
|---|----------|
| Label refus année courante | **« Non réalisé » (gris)** — cohérent avec la ligne d'historique juste en dessous. Pas de vert « Réalisé » pour un refus. |
| Sémantique « sortir du process » | Une visite `cancelled` de l'année courante est reconnue comme **tâche close** (lue depuis le record `cancelled`) : le badge quitte « À faire » et le CTA « Planifier » disparaît pour l'année. Le record `cancelled` **est** la trace informatique. |
| Portée du fix de statut | **Modal-only**. La vue `majordhome_contracts` n'est **pas** modifiée pour le filtre Programmation. ⚠️ Conséquence assumée : l'onglet Programmation pourra encore lister ce contrat comme « à planifier » l'année du refus. |
| `client_number` carte Client lié | **Déjà exposé** par la vue `majordhome_contracts` (`cl.client_number`) et `getContractById` fait `.select('*')` → disponible dans `useContract` sans migration (vérifié via `pg_get_viewdef` le 2026-06-17). |

## 3. Changements détaillés

### A. Bloc Client
Inchangé (Nom / Adresse / Téléphone / Email).

### B. Carte « Client lié » (nouveau, sous le bloc Client)
- Extraction d'un composant **présentationnel partagé** `LinkedClientCard` depuis la carte bleue de `SectionClientLinking` (`LeadFormSections.jsx`, lignes ~72-97).
- **Signature** : `LinkedClientCard({ name, clientNumber, city, children })`
  - rendu : carte `bg-blue-50 border-blue-200`, icône `UserCircle`, `name` (gras), ligne secondaire `clientNumber — city` (conditionnelle), puis **slot `children`** à droite = bouton d'action propre à chaque appelant.
  - **Présentationnel pur** : aucune logique métier, aucune dépendance React Query/Pennylane.
- **Emplacement** : `src/apps/artisan/components/shared/LinkedClientCard.jsx` (à côté de `KanbanBoard`, `SearchBar`).
- **Consommateurs** :
  - **ContractModal** : placée **juste sous le bloc Client**. `children` = bouton **« Voir la fiche »** (icône `ExternalLink`) → `onClose()` puis `navigate('/clients/' + contract.client_id)`. **Remplace** l'ancienne section « Fiche CRM » (supprimée). Données : `name=contract.client_name`, `clientNumber=contract.client_number` (nouvelle colonne), `city=contract.client_city`. Rendue seulement si `contract.client_id`.
  - **LeadModal / `SectionClientLinking`** : migre vers `LinkedClientCard`. `children` = le bouton « Modifier » existant (toggle `editClientMode`, état amber/bleu conservé). Le bouton « délier » (`handleUnlinkClient`) et le bandeau edit-mode restent **autour** de la carte, inchangés. **Aucun changement de comportement** côté lead.

### C. Bloc Contrat
Réduit à **3 lignes uniquement** :
- **Tarif** (`formatEuro(contract.amount)`)
- **Tps estimé** (existant, `Math.round(estimated_time * 60)` min)
- **Mois d'entretien** (nouveau) : `contract.maintenance_month` (1-12) → label via `MAINTENANCE_MONTHS` (importé de `contracts.service.js`). Affiche `—` si null.

**Supprimés** : Début, Fin, Renouvellement, Statut (badge), Notes, Source (« Site internet »), bouton « Générer le contrat PDF ».
**Code mort à retirer** : `handleGeneratePdf`, état `generatingPdf`, imports devenus inutilisés (`Download`, `Globe`, `CONTRACT_STATUSES`, et `entretiensService.getContractPdfUrl/triggerContractPdf` ne sont plus appelés depuis ce fichier — ne pas supprimer les méthodes service, juste l'usage local).

### D. Bloc Visite {année}
**Badge de statut** dérivé en mémoire (plus de dépendance à `current_year_visit_status`), à partir de `visits` (déjà chargé pour l'historique) + la carte entretien active :

```
currentYearVisit = visits.find(v => v.visit_year === currentYear)

si currentYearVisit?.status === 'completed'         → 'realise'      // « Réalisé »   (vert)
sinon si currentYearVisit (cancelled/skipped/autre)  → 'non_realise'  // « Non réalisé » (gris) — tâche close
sinon si activeCard?.workflow_status === 'planifie'  → 'planifie'     // « Planifié »  (bleu)
sinon                                                → 'a_planifier'  // « À planifier » (ambre)
```

- **Corrige le bug** : un refus (`cancelled`) de l'année courante ne reste plus « À faire » → passe « Non réalisé », tâche close.
- **« Prochaine visite »** : `activeCard.next_rdv_date` si présent, sinon `contract.next_maintenance_date`.
- **Bouton « Planifier »** : visible **uniquement** quand `badgeStatus === 'a_planifier'`. Au clic :
  1. `ensureEntretienCard({ clientId: contract.client_id, contractId: contract.id, userId })` (get-or-create idempotent, retourne `interventionId`).
  2. construit l'`item` lead-like (`client_name`, `client_first_name`, `client_phone`, `client_email`, `client_address`, `client_city`, `client_postal_code`, `intervention_type:'entretien'`, `id:interventionId`, `client_id`, `contract_id`) pour `SchedulingTransitionModal`.
  3. ouvre `SchedulingTransitionModal` (overlay) → `onConfirm(slots)` → appelle la **brique partagée** `scheduleEntretien(...)` (cf. E).
  4. succès → `toast.success` + invalidation caches (`entretienSavKeys.all(orgId)`, `contractKeys.detail(contractId)`, `contractKeys.visits(contractId)`) + ferme l'assistant.
- **Supprimés** : bouton « Marquer comme effectué » + formulaire inline. Code mort : `recordVisit` (hook), `showRecordForm`, `visitDate`, `visitNotes`, `handleRecordVisit`, imports `CheckCircle2` (si plus utilisé).

### E. Brique de planification partagée
La logique de confirmation de planning est actuellement **inline** dans `EntretienSAVKanban.handleConfirmSchedule` (lignes ~195-243) : `createAppointmentBatch` → `updateFields(scheduled_date)` → `updateWorkflowStatus('planifie')` → confirm web-draft.

**Extraction** dans `entretiensService.scheduleEntretien(...)` :
```
scheduleEntretien({ card, slots, includesEntretien = false, coreOrgId }) → { error }
  1. appointmentsService.createAppointmentBatch(slots, {
       coreOrgId,
       appointment_type: card.intervention_type === 'sav' ? 'service' : 'maintenance',
       intervention_id: card.id,
       client_id, client_name, client_first_name, client_phone, client_email, address, city, postal_code,
       subjectPrefix: 'Entretien' | 'SAV' | 'SAV + Entretien',
     })
  2. update intervention: scheduled_date = slots[0].date (+ includes_entretien si SAV et changé)
  3. update workflow_status = 'planifie'
  4. si carte taggée 'Web' et client_id → clientsService.confirmWebDraft(client_id)
  retourne { error } (pas de throw)
```
- Fonction **service pure** (pas de toast, pas d'invalidation cache) → les appelants gèrent toast + invalidation.
- **Refactor `EntretienSAVKanban.handleConfirmSchedule`** : remplace le corps inline par `await entretiensService.scheduleEntretien({ card: item, slots, includesEntretien, coreOrgId: orgId })`, conserve son `toast` + `refresh()`. Comportement identique (régression faible, même logique).
- **ContractModal** : appelle la même fonction. → 1 seule source de vérité, « planifier depuis plusieurs endroits ».

### F. Historique des visites
Dans la table de l'historique (`ContractModal`), pour toute visite **non `completed`** (`cancelled` / `skipped` / autre) :
- colonne **Date** → `—`
- colonne **Statut** → badge unique neutre **« Non réalisé »** (gris).

`completed` → « Effectué » (vert, inchangé) ; `pending` → « À faire » (inchangé).
Implémentation : mapping local dans `ContractModal` (ou ajout d'un état `non_realise` à `VisitBadge`). `VisitBadge` étant local au modal, on peut y ajouter l'entrée `non_realise` sans risque d'effet de bord ailleurs ; les entrées `cancelled`/`skipped` existantes peuvent rester mais ne seront plus utilisées par l'historique du modal.

### G. Hook de données — carte entretien par contrat
Nouveau query léger pour récupérer la carte entretien active (badge « Planifié »/« À planifier ») :
```
useEntretienByContract(orgId, contractId)
  → select sur majordhome_entretien_sav
    .eq('org_id', orgId).eq('contract_id', contractId)
    .eq('intervention_type', 'entretien')   // la vue filtre déjà parent_id IS NULL
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  → retourne { card, isLoading }   (card = workflow_status, next_rdv_date, id, …)
  cache key : [...entretienSavKeys.all(orgId), 'by-contract', contractId]
  enabled : !!orgId && !!contractId
```
**Emplacement** : `src/shared/hooks/useContracts.js` (co-localisé avec `useContract`/`useContractVisits` déjà consommés par le modal), clé sous `entretienSavKeys` pour rester cohérent avec l'invalidation planning.

### H. Migration DB — SANS OBJET
Vérification `pg_get_viewdef('public.majordhome_contracts')` (2026-06-17) : la vue expose **déjà** `cl.client_number` (alias clients = `cl`). `contractsService.getContractById` fait `.select('*')` → `contract.client_number` est déjà présent dans `useContract`. **Aucune migration ni modification de service.** La carte « Client lié » consomme directement `contract.client_number`.

## 4. Flux de données (planification depuis le modal)

```
ContractModal « Planifier »
  → ensureEntretienCard(client_id, contract_id)         [get-or-create carte entretien]
  → SchedulingTransitionModal (item lead-like)          [choix créneaux multi-tech]
      → onConfirm(slots)
        → entretiensService.scheduleEntretien({ card, slots, coreOrgId })
            → createAppointmentBatch (appointment_type='maintenance', intervention_id)
            → intervention.scheduled_date + workflow_status='planifie'
        → toast + invalidation caches
  → badge VISITE {année} se recalcule → « Planifié »
```

## 5. Gestion d'erreurs
- `ensureEntretienCard` retourne `{ interventionId, error }` (client sans projet → `'client_sans_projet'`) : si erreur → `toast.error` explicite, ne pas ouvrir l'assistant.
- `scheduleEntretien` retourne `{ error }` (jamais de throw) ; `createAppointmentBatch` en échec → `toast.error('Erreur création du RDV')`, pas de transition de statut.
- Migration vue : append-only de colonne, faible risque ; vérifier `is_insertable_into` non requis (la vue contrats peut rester non-updatable, les écritures passent par `majordhome_contracts_write`).

## 6. Tests & vérification
- Pas de framework de test composant dans le projet (tests `node --test` réservés au pur logique). Vérification :
  - `npm run lint:errors` (0 erreur — pre-commit hook) + pas de nouveau warning ESLint.
  - `npx vite build` (build OK — pas de preview tools, cf. préférence Eric).
  - Smoke manuel : (1) ouvrir le modal d'un contrat « à planifier » → « Planifier » → poser un créneau → badge passe « Planifié » + RDV visible au Planning ; (2) refuser une visite année courante via fiche client → rouvrir le modal → badge « Non réalisé » (plus « À faire »), CTA « Planifier » masqué ; (3) historique : années non faites → « — » + « Non réalisé » ; (4) carte « Client lié » affiche n° client + « Voir la fiche » navigue ; (5) LeadModal inchangé (carte + Modifier + délier).
- `scheduleEntretien` : couverte indirectement par le smoke kanban (refactor iso-comportement) + smoke modal.

## 7. Hors-scope / notes
- **Programmation** : un contrat refusé l'année courante peut encore apparaître « à planifier » (fix modal-only assumé). Si gênant → pousser la sémantique « `cancelled` = traité » dans `current_year_visit_status` (vue) dans un second temps.
- **TabContrat** (fiche client → onglet Contrat) : déjà correct (radio « réalisé »/« refusé », affichage « Non réalisé »/« En attente ») → **inchangé**.
- Léger écart de label assumé : bloc VISITE = « Réalisé » (mot d'Eric pour l'année courante) vs historique = « Effectué » (existant). Alignable plus tard si souhaité.
- Migration `useAuth().organization.settings` → `useOrgSettings()` : non concernée ici.

## 8. Fichiers touchés (récap)
| Fichier | Nature |
|---------|--------|
| `src/apps/artisan/components/shared/LinkedClientCard.jsx` | **création** (présentationnel) |
| `src/apps/artisan/components/entretiens/ContractModal.jsx` | refonte (blocs, badge, Planifier, historique, nettoyage) |
| `src/apps/artisan/components/pipeline/LeadFormSections.jsx` | migration vers `LinkedClientCard` (iso-comportement) |
| `src/apps/artisan/components/entretiens/EntretienSAVKanban.jsx` | refactor `handleConfirmSchedule` → `scheduleEntretien` |
| `src/shared/services/entretiens.service.js` | ajout `scheduleEntretien(...)` |
| `src/shared/hooks/useContracts.js` | ajout `useEntretienByContract` |
| `src/apps/artisan/components/entretiens/VisitBadge.jsx` | ajout état `non_realise` (optionnel) |
| ~~migration SQL `majordhome_contracts`~~ | sans objet — `client_number` déjà exposé par la vue |
