# Chantier : une entité par devis accepté, regroupable

**Date** : 2026-09-30 · **Statut** : design validé par Eric (« rien, go »), spec à relire · **Périmètre** : kanban Chantiers (installation). SAV et entretien hors itération.

Remplace la spec `2026-09-30-chantier-separation-devis-design.md` (non commitée, modèle « second lead »), écartée par Eric le soir même au profit d'une entité chantier distincte du lead.

## 1. Problème

Aujourd'hui **1 lead = 1 chantier** : la vue `majordhome_chantiers` lit `majordhome.leads` filtrée sur `chantier_status IS NOT NULL`, et tout ce qui décrit le chantier (statut, appro, dates, notes, PV, commande « personnes × jours ») vit sur le lead. Les RDV d'installation portent `appointments.lead_id`, les devis `lead_pennylane_quotes.lead_id`.

Quand un client passe une seconde commande, tout tombe sur la même carte. Cas GOUIN BATISTE (lead `476aa7e6-fa13-4512-aea3-de08313186a5`) : une borne (D-2026-09430, 1 260,76 €, facturée, posée le 18/09 à 1 personne) et une PAC (D-2026-09466, 11 540 €, acceptée, 3 jours à 2 personnes en novembre) sur une seule carte à 12 801 €, une seule commande, un seul appro, un seul statut ; et comme la borne est facturée, `target_invoiced` peint **les quatre** journées en violet dans le planning, PAC comprise.

Mesuré en prod le 2026-09-30 : 74 leads avec `chantier_status`, dont **12 portent au moins 2 devis validés** et 5 mélangent un devis facturé et un devis accepté. Classement d'Eric : BERNA, DELMAS, BESOMBES = même chantier ; VEOLIA ENERGIE, VEOLIA ENVIRONNEMENT, GOUIN = chantiers distincts ; CAPPAROS et COTTERAU = deux devis au même montant (doublon probable) ; les autres à trancher dans l'app. Aucune heuristique de date ne tient (DELMAS : deux mois d'écart, même chantier).

## 2. Règle (Eric, 2026-09-30)

> Un lead = plusieurs devis possibles. Chaque devis accepté = 1 chantier, avec la possibilité de grouper, ce qui permet de garder des cartes chantier individuelles.

Décisions qui en découlent :

1. **Le chantier est une entité** (`majordhome.chantiers`), distincte du lead. Le lead reste l'affaire commerciale (identité, pipeline, `won_date`, `order_amount_ht`) ; le chantier est la commande à exécuter.
2. **Un devis validé (accepté ou facturé) qui n'a pas de chantier en crée un**, quelle que soit la voie (cron Pennylane, modale Gagner, rattachement depuis `/devis`). Un lead gagné sans devis Pennylane (org sans Pennylane) a un chantier sans devis.
3. **Grouper** et **Détacher** sont des gestes humains, dans la même carte. Aucun automatisme ne regroupe ni ne sépare.
4. **Facturé se lit par chantier** : tous ses devis validés sont facturés. Le violet du planning suit le chantier du RDV.
5. **Les 74 chantiers existants sont repris tels quels** : un chantier par lead, tous ses devis dessus. La règle « un devis = un chantier » s'applique aux devis validés **après** la migration. Eric détache GOUIN et les deux VEOLIA à la main.
6. **Le pipeline ne change pas** : une carte Gagné par lead, un gain dans les statistiques, quel que soit le nombre de chantiers.

## 3. Modèle de données

Migration versionnée `supabase/migrations/20260930_16_chantiers_entite.sql`, répétée sur `scripts/migration-rehearsal/` (extension de `snapshot.mjs`, cf. § 10).

### 3.1 Table `majordhome.chantiers`

| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `org_id` | uuid NOT NULL | FK `core.organizations` |
| `lead_id` | uuid NOT NULL | FK `majordhome.leads` ON DELETE CASCADE (`lead_hard_delete` purge par cascade) |
| `client_id` | uuid | FK `majordhome.clients` ON DELETE SET NULL (recopié du lead à la création) |
| `label` | text | objet du devis fondateur (`pennylane_quotes.pdf_invoice_subject`, renseigné sur 50 des 114 devis validés), sinon NULL ; éditable |
| `chantier_status` | text NOT NULL | CHECK `gagne, commande_a_faire, commande_recue, planification, realise, facture` |
| `equipment_order_status`, `materials_order_status` | text | CHECK `na, commande, recu`, NULL = non renseigné |
| `estimated_date`, `planification_date`, `won_date` | date | |
| `chantier_notes` | text | |
| `pv_reception_path` | text | |
| `planned_team_size`, `planned_days` | smallint | mêmes CHECK que `20260922_1` (1-20, 1-60) |
| `equipment_type_id` | uuid | FK `majordhome.pricing_equipment_types` |
| `sort_order` | int NOT NULL DEFAULT 0 | |
| `created_at`, `updated_at` | timestamptz | trigger `update_updated_at` |

Index `(org_id, chantier_status)`, `(lead_id)`. `GRANT SELECT ON majordhome.chantiers TO service_role`.

**RLS** (activée à la création) : SELECT pour les membres de l'org ; UPDATE `majordhome.role_can(org_id, 'chantiers', 'edit') OR role_can(org_id, 'chantiers', 'edit_own')` (lignes `chantiers` déjà seedées dans `app_role_permissions`, et `leads` utilise déjà `role_can` en prod). Pas de policy INSERT ni DELETE pour `authenticated` : création par trigger et RPC, suppression par RPC.

**Mouchard** : `trg_audit_chantiers` → `audit_row_change('updated_at,sort_order')`.

### 3.2 Colonnes ajoutées

- `majordhome.lead_pennylane_quotes.chantier_id uuid` FK `chantiers` ON DELETE SET NULL. NULL = devis attaché au lead mais à aucun chantier (devis en attente, refusé, ou antérieur à la migration sur un lead sans chantier).
- `majordhome.appointments.chantier_id uuid` FK `chantiers` ON DELETE SET NULL. Renseigné pour les RDV `installation`. `lead_id` reste renseigné (dérivé du chantier à la création côté service) pour tout ce qui lit encore le lead : cartes pipeline, mouchard, `lead_merge`, `lead_hard_delete`.
- `majordhome.chantier_line_receptions.chantier_id` contenait des ids de lead : réécrit vers l'id du chantier, puis FK `chantiers` ON DELETE CASCADE. Aucun écrivain frontend (suivi retiré).

### 3.3 Colonnes du lead devenues legacy

`leads.chantier_status`, `equipment_order_status`, `materials_order_status`, `estimated_date`, `planification_date`, `chantier_notes`, `pv_reception_path`, `planned_team_size`, `planned_days` **ne sont plus écrites par le front** ni lues par la vue. Elles restent en place (expansion) ; `lead_mark_won_with_quote`, `pennylane_sync_ensure_winning_quotes` et `lead_merge` continuent d'y écrire sans effet. Contraction (DROP + nettoyage de ces RPC + `update_majordhome_lead`) dans une migration ultérieure après ≥ 1 semaine, comme pour l'enum des équipements.

## 4. Création, regroupement, détachement

### 4.1 Trigger `majordhome.chantier_ensure_for_quote()`

`AFTER INSERT OR UPDATE OF quote_status, ejected_at ON lead_pennylane_quotes`, donc **après** `trg_lead_pennylane_quotes_invariant_winning` (BEFORE) : il voit le statut final.

Condition : `NEW.ejected_at IS NULL AND NEW.chantier_id IS NULL AND quote_status_bucket(NEW.quote_status) = 'validated'` et transition réelle (`TG_OP = 'INSERT'` ou `quote_status_bucket(OLD.quote_status) <> 'validated'` ou `OLD.ejected_at IS NOT NULL`), lead non supprimé.

Effet : `INSERT chantiers` (org, lead, `client_id` et `equipment_type_id` du lead, `label` = `pdf_invoice_subject` du miroir `pennylane_quotes` s'il existe, `won_date` = `quote_date` sinon `current_date`, `chantier_status` = `facture` si le devis est déjà `invoiced`, sinon `gagne`), puis `UPDATE lead_pennylane_quotes SET chantier_id = <id> WHERE id = NEW.id` (pas de récursion : `chantier_id` n'est pas dans la liste `UPDATE OF`). Activité `chantier_created` sur le lead.

Conséquences assumées :
- Un devis facturé rattaché après coup crée un chantier directement en `facture` (colonne masquée du kanban) : pas de carte parasite.
- Un devis refusé ou éjecté **ne touche pas** son chantier : la carte reste, la vue expose `validated_quotes_count = 0` et l'UI la marque en ambre « aucun devis validé ». Suppression à la main (§ 4.5).
- Les 5 leads sans `chantier_status` qui portent un vieux devis `invoiced` (RENOU, TRAIN MINIATURE, BASILE, SDIS 81, REY, tous en Perdu / Devis envoyé) ne sont pas touchés : le trigger ne se déclenche que sur une transition, la migration ne leur crée rien. Cohérent avec le garde-fou existant de `ensure_winning_quotes` (pas de chantier rétroactif).

### 4.2 RPC `public.chantier_ensure_for_lead(p_lead_id uuid) RETURNS uuid`

SECURITY DEFINER, `SET search_path = majordhome, public, core`, `REVOKE FROM PUBLIC, anon`, `GRANT authenticated`. Garde positive : `auth.uid()` non NULL et membre de l'org du lead. Si le lead n'a aucun chantier, en crée un sans devis (`gagne`, `won_date = current_date`). Retourne l'id (existant ou créé). Appelée par `leadsService.updateLeadStatus` au passage en Gagné, à la place de `chantier_status = 'gagne'`.

### 4.3 RPC `public.chantier_group(p_target_id uuid, p_source_ids uuid[]) RETURNS jsonb`

SECURITY DEFINER, mêmes REVOKE/GRANT. Garde : `auth.uid()` non NULL, `role_can(org, 'chantiers', 'edit') IS NOT TRUE → RAISE 'not_authorized'` (org_admin, team_leader).

Validations (RAISE explicite) : cible et sources existent, **même org et même lead**, sources ≠ cible, aucune source vide.

Effets, une transaction :
1. `lead_pennylane_quotes`, `appointments` (`installation`), `chantier_line_receptions` des sources → cible.
2. Cible : `chantier_notes` concaténées (`— groupé depuis … —`), `planned_team_size` / `planned_days` / `estimated_date` / `equipment_type_id` / `label` conservés s'ils sont renseignés, sinon repris de la première source qui les porte ; statut = le plus avancé (ordre `gagne < commande_a_faire < commande_recue < planification < realise < facture`) ; appro = `recu` si tous `recu`, sinon la valeur la moins avancée (`na < commande < recu`, NULL ignorés) ; `pv_reception_path` conservé, sinon celui d'une source.
3. DELETE des sources. Activité `chantier_grouped` sur le lead avec `metadata` (cible, sources, compteurs).

Retour `{ target_id, counts: { quotes, appointments, line_receptions } }`.

### 4.4 RPC `public.chantier_detach(p_chantier_id uuid, p_quote_ids uuid[], p_appointment_ids uuid[], p_move_planned_order boolean, p_label text) RETURNS jsonb`

Même garde que `chantier_group`.

Validations : chaque devis appartient au chantier et n'est pas éjecté ; la sélection contient ≥ 1 devis validé **et** il reste ≥ 1 devis validé sur le chantier d'origine (sinon ce n'est pas un détachement) ; chaque RDV appartient au chantier, est `installation`, ni annulé ni `no_show`.

Effets : `INSERT chantiers` (org, lead, client, `label` = `p_label` sinon objet du premier devis sélectionné, `equipment_type_id` du chantier d'origine, `won_date` = date du devis validé sélectionné le plus récent, tie-break `pennylane_quote_id DESC`), `chantier_status` = `facture` si tous les devis validés déplacés sont facturés, sinon `planification` si des RDV suivent (+ `planification_date = current_date`), sinon `gagne` ; appro NULL. Déplacement des devis, de leurs `chantier_line_receptions` (par `pennylane_quote_id`) et des RDV. Si `p_move_planned_order` : commande déplacée et remise à NULL sur l'origine. Activité `chantier_detached` sur le lead.

Retour `{ new_chantier_id, origin_chantier_id, counts }`.

### 4.5 RPC `public.chantier_delete(p_chantier_id uuid)`

Même garde. Refuse (`RAISE`) si le chantier porte un devis validé, un RDV actif ou un PV. Les devis non validés restants repassent à `chantier_id = NULL` (ils restent attachés au lead). Activité `chantier_deleted`.

### 4.6 Écritures ordinaires

Vue miroir simple **updatable** `public.majordhome_chantiers_write` (`security_invoker = true`, aucune jointure) sur `majordhome.chantiers`, comme `majordhome_pricing_rates_write`. Le service écrit `.from('majordhome_chantiers_write').update(patch).eq('id', chantierId).eq('org_id', orgId)` et lit `{ error }`. RLS UPDATE (§ 3.1) fait foi. `update_majordhome_lead` n'est plus appelée pour le chantier.

## 5. Vues

- **`majordhome.chantier_quote_stats`** (nouvelle, pendant de `lead_quote_stats`) : par `chantier_id`, `validated_count`, `validated_sum`, `invoiced_count`, `pending_count`, via `quote_status_bucket()` sur les devis non éjectés. **Aucune allowlist recopiée.**
- **`public.majordhome_chantiers`** : `DROP VIEW` + `CREATE VIEW` (aucune vue dépendante en prod, vérifié ; les colonnes `intervention_id` / `intervention_status`, sans lecteur, disparaissent). Source `chantiers c JOIN leads l ON l.id = c.lead_id AND l.is_deleted = false`. Mêmes noms de colonnes de sortie qu'aujourd'hui : `id` = **id du chantier**, identité / adresse / `assigned_user_id` / `project_id` / `order_amount_ht` / `estimated_revenue` / `pennylane_quote_id` du lead, colonnes chantier de la table, `equipment_type_label` / `equipment_type_category`, `linked_quotes_amount_ht` = `validated_sum`, `validated_quotes_count` = `validated_count`, `next_rdv_date` / `has_active_rdv` par `appointments.chantier_id`. Ajouts en fin : `lead_id`, `label`, `quotes_count` (devis rattachés au chantier, éjectés exclus), `is_invoiced` (`validated_count > 0 AND invoiced_count = validated_count`), `lead_chantiers_count` (nombre de chantiers du lead, pour afficher « Grouper avec… »). `getChantierAmount` garde sa cascade (devis validés, sinon `order_amount_ht`, sinon `estimated_revenue`).
- **`public.majordhome_appointments`** : la branche `installation` de `target_invoiced` devient `EXISTS (SELECT 1 FROM majordhome.chantier_quote_stats s WHERE s.chantier_id = a.chantier_id AND s.validated_count > 0 AND s.invoiced_count = s.validated_count)`. Même position, même type : `CREATE OR REPLACE` ; `chantier_id` ajouté **en fin** de liste (vue miroir, reste insérable).
- **`public.majordhome_lead_pennylane_quotes`** : `chantier_id` ajouté en fin.
- `majordhome_kanban_cards`, `lead_quote_stats` : **inchangées** (le pipeline reste par lead).

## 6. Reprise des données (dans la migration)

1. Un chantier par lead avec `chantier_status IS NOT NULL` (supprimés compris, la vue filtre) : toutes les colonnes chantier recopiées, `label` NULL, `client_id` / `equipment_type_id` / `won_date` du lead.
2. `lead_pennylane_quotes.chantier_id` = chantier du lead pour les devis **validés non éjectés** de ces leads. Les devis en attente / refusés restent à NULL : s'ils deviennent validés plus tard, le trigger leur crée leur propre carte (règle 2).
3. `appointments.chantier_id` = chantier du lead pour les RDV `installation` (tous statuts).
4. `chantier_line_receptions.chantier_id` : lead → chantier, puis FK.
5. Assertions en fin de migration (`RAISE` si faux) : autant de chantiers que de leads à `chantier_status` ; aucun RDV `installation` à `lead_id` renseigné sans `chantier_id` ; aucune réception de ligne orpheline ; pour GOUIN un chantier à 2 devis validés (1 260,76 + 11 540) et 4 RDV.

Après déploiement, Eric détache GOUIN (PAC + 3 RDV de novembre + commande 2 × 3), VEOLIA ENERGIE et VEOLIA ENVIRONNEMENT ; vérifie CAPPAROS et COTTERAU (✕ « Retirer ce devis » si doublon).

## 7. Frontend

### 7.1 Module pur `src/lib/chantierSplit.js`

Aucun import React / Supabase. Testé par `scripts/chantier-split.test.mjs`, ajouté à `audit:quality`.

- `resumeDetachement({ quotes, appointments, plannedOrder }, { quoteIds, appointmentIds, movePlannedOrder })` → `{ origine: { montant, jours, devis }, nouveau: { … }, erreurs: string[], ok }`. Mêmes règles que la RPC (≥ 1 devis validé de chaque côté, RDV du chantier), messages FR.
- `commandeSuitParDefaut(plannedOrder, joursSelectionnes)` → `true` si le nombre de jours sélectionnés vaut `planned_days`.
- `resumeGroupement(cible, sources)` → montant, jours, devis, statut résultant (même ordre que la RPC), pour l'aperçu du dialogue.

### 7.2 Services et hooks

- `chantiers.service.js` : toutes les mutations prennent `chantierId` (+ `orgId`) et écrivent `majordhome_chantiers_write` ; `getChantiersByClientId(clientId)` (liste) remplace `getChantierByClientId` ; nouveaux `groupChantiers`, `detachChantier`, `deleteChantier`, `ensureChantierForLead` (RPC). `CHANTIER_TRANSITIONS` : `archive` retiré (n'existe pas).
- `useChantiers.js` : mutations sur `chantierId` ; `groupMutation`, `detachMutation`, `deleteMutation` via `unwrapResult()` ; invalidation croisée `chantierKeys.all`, `appointmentKeys` (chantier + listes planning), `pennylaneKeys.linkedQuotesByLead`, `leadKeys.all`, `kanbanCardKeys.all`.
- `useAppointments.js` : `useChantierAppointments(orgId, chantierId)` filtre `chantier_id` ; `appointmentKeys.chantier(orgId, chantierId)`.
- `appointments.service.js` : `createAppointment` / `createAppointmentBatch` acceptent `chantier_id` ; `syncCardStateOnCreate` lit `majordhome_chantiers` par `chantier_id` et avance le **chantier** en `planification` (forward-only, via la vue `_write`), plus le lead.
- `usePennylane.js` : `useLinkedPennylaneQuotes(leadId, { chantierId })` filtre `chantier_id` quand fourni ; `useLinkedPennylaneQuotesMutations` invalide aussi `chantierKeys`.
- `leads.service.js` `updateLeadStatus` : Gagné → `won_date` + `chantier_ensure_for_lead`, plus de `chantier_status`.
- `appointmentActivation.service.js` : le passthrough installation porte `chantierId` (et `leadId` dérivé).

### 7.3 Composants (`components/chantiers/`)

- `ChantierKanban` / `ChantierCard` : clé `chantier.id` ; sous le nom, `label` quand renseigné ; pastille « N devis » si `quotes_count ≥ 2` ; pastille ambre « aucun devis validé » si `validated_quotes_count = 0` et `quotes_count > 0` ou chantier issu d'un devis refusé. Deux cartes d'un même client se distinguent par le libellé, le montant et le type d'équipement.
- `ChantierModal` : mutations sur `chantier.id` ; RDV créés avec `chantier_id: chantier.id, lead_id: chantier.lead_id` ; PV vers `/chantiers/:chantierId/pv-reception` ; champ « Libellé » éditable ; bouton **Grouper avec…** (visible si `lead_chantiers_count ≥ 2` et droit `edit`) → `GroupChantiersDialog` ; bouton **Supprimer ce chantier** (ghost rouge, `chantier_delete`, ConfirmDialog) quand aucun devis validé / RDV / PV.
- `ChantierReceptionSection` (liste « Devis rattachés ») : devis du chantier (`chantierId`) ; lien **Détacher en chantier distinct** dès 2 devis validés (droit `edit`) → `DetachChantierDialog`. ✕ « Retirer ce devis » inchangé.
- `GroupChantiersDialog.jsx` (nouveau) : cases à cocher sur les autres chantiers du lead (libellé, montant, statut, jours), aperçu `resumeGroupement`, bouton **Grouper**.
- `DetachChantierDialog.jsx` (nouveau) : devis en cases à cocher (numéro, objet, montant, statut ; devis non validés peuvent accompagner), jours d'installation en cases à cocher (date, horaire, personnes), case « La commande N pers. × M j part avec le nouveau chantier » (pré-cochée par `commandeSuitParDefaut`), libellé facultatif, résumé en deux colonnes issu de `resumeDetachement`, bouton **Détacher** désactivé tant que `ok` est faux.
- `PvReceptionSign.jsx` : route `chantiers/:chantierId/pv-reception`, lecture par `id`, `updatePvReceptionPath(chantierId)`, montant via `getChantierAmount` (corrige la lecture directe d'`order_amount_ht`).
- `TabInterventions.ChantierSummary` (fiche client) : un bloc par chantier.
- `Planning.jsx` : la modale chantier reçoit un chantier (id chantier) ; la branche morte `chantier_slot` n'est pas touchée.

### 7.4 Droits

`can('chantiers', 'edit')` pour grouper / détacher / supprimer (org_admin, team_leader). Les autres gestes gardent `edit` / `edit_own` comme aujourd'hui.

## 8. Interactions et conséquences

- **`lead_merge`** : ajoute `UPDATE majordhome.chantiers SET lead_id = p_survivor_id WHERE lead_id = p_absorbed_id` au re-parentage (le survivant porte alors N chantiers, à grouper à la main si c'est la même commande). `chantier_line_receptions` n'est plus re-parenté par lead (il suit le chantier).
- **`lead_hard_delete`** : cascade FK sur `chantiers` ; les RDV sont déjà purgés par lead. **`client_hard_delete`** : `chantiers.client_id` → NULL par FK.
- **`eject_pennylane_quote`** : inchangé ; le devis éjecté garde son `chantier_id` (historique), la vue l'exclut des comptes.
- **Mouchard** : les changements de `chantier_id` sur les RDV et les écritures sur `chantiers` sont tracés (`audit_row_change`). Libellés FR à ajouter dans `auditTrail.js` pour `chantiers`.
- **Google Calendar** : rien (ni date ni personne ne changent).
- **Dashboard** : lit la vue, colonnes conservées ; un lead à deux chantiers compte deux fois dans « commande à faire » / « à planifier », ce qui est exact.
- **Explorateur `/devis`, modale Gagner, `lead_attach_quotes_and_send`, `lead_mark_won_with_quote`, cron** : aucune modification ; le trigger fait le reste.
- **Facturation (hub)** : `majordhome.invoices` ne connaît ni lead ni chantier (contexte contrat / entretien) : rien à changer.

## 9. Hors périmètre

- Contraction des colonnes chantier du lead et nettoyage des RPC qui les écrivent (migration dédiée, après observation).
- Poser la question « même chantier ? » au moment du rattachement d'un devis.
- Grouper deux chantiers de **leads différents** (passer d'abord par « Fusionner »).
- SAV, entretien, la branche `chantier_slot` du planning.

## 10. Vérification

- `node --test scripts/chantier-split.test.mjs` : sélection vide, aucun devis validé sélectionné, aucun devis validé restant, RDV hors chantier, montants et jours de chaque côté, commande qui suit par défaut, statut résultant d'un groupement.
- `node --test scripts/install-order.test.mjs` inchangé (le compteur de commande lit les RDV du chantier).
- **Répétition sur le harnais** (`scripts/migration-rehearsal/`) — extension de `snapshot.mjs` : TABLES `lead_pennylane_quotes` (toutes colonnes), `pennylane_quotes` (`org_id, pennylane_quote_id, quote_number, pdf_url, pdf_invoice_subject, quote_date`), `chantier_line_receptions`, `lead_activities`, `statuses` (avec données), `clients` + `pennylane_account_number` ; FUNCTIONS `public.lead_merge(uuid, uuid)` (recréée sans ses 16 tables satellites : un corps plpgsql ne résout les tables qu'à l'exécution ; l'assertion vérifie le texte de la fonction, pas son exécution), `majordhome.lead_pennylane_quotes_invariant_winning()`, `majordhome.role_can(uuid, text, text)`, `majordhome.user_effective_role(uuid)` ; TRIGGER_TABLES + `majordhome.lead_pennylane_quotes` (les triggers du mouchard ne sont pas reproduits : fail-safe en WARNING, vérifiés en prod après déploiement par une lecture d'`audit_log`) ; VIEWS + `public.majordhome_lead_pennylane_quotes`, `public.majordhome_appointments` ; POLICY_TABLES + `leads`. Fichier `assert-chantiers.sql` : fixture GOUIN (DO $$), puis reprise = 1 chantier à 2 devis et 4 RDV ; `chantier_detach` GOUIN (PAC + 3 RDV + commande) → 2 chantiers : origine 1 260,76 € / 1 RDV / statut inchangé / `is_invoiced` vrai, nouveau 11 540 € / 3 RDV / `planification` / commande 2 × 3 / `is_invoiced` faux, activité sur le lead ; `chantier_group` inverse → 1 chantier ; refus pour un technicien, un devis d'un autre chantier, une sélection qui vide l'origine ; `chantier_delete` refusé avec RDV ; trigger : un devis qui passe `pending → accepted` sur un lead déjà pourvu crée un **second** chantier ; `target_invoiced` vrai pour le RDV de la borne, faux pour ceux de la PAC ; `lead_merge` déplace les chantiers ; `has_function_privilege('anon', …, 'EXECUTE')` faux sur les 4 RPC ; `has_table_privilege('service_role', 'majordhome.chantiers', 'SELECT')` vrai.
- `npm run audit:quality`, `npx vite build`.
- **Manuel (Eric)** : après déploiement, GOUIN = 1 carte 12 801 € ; « Détacher » PAC + 3 jours + commande → 2 cartes (borne 1 260,76 € violette au planning, PAC 11 540 € en couleur d'équipe, « Il manque … » calculé sur les 3 jours) ; une carte Gagné au pipeline ; « Grouper avec… » remet une carte ; un devis accepté de plus sur un lead pourvu fait apparaître une nouvelle carte en Gagné.
