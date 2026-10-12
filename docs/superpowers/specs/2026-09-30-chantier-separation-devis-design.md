> **⚠️ REMPLACÉ — non implémenté.** Approche `lead_split` (« 1 lead = 1 chantier ») abandonnée au profit de l'entité `majordhome.chantiers` (un chantier par devis validé, gestes Détacher / Grouper), en prod le 2026-10-01 (migrations `20260930_16..18`). Conservé pour l'analyse du problème (cas GOUIN, 12 chantiers / 74 multi-devis).

# Chantier : plusieurs devis, un ou plusieurs chantiers

**Date** : 2026-09-30 · **Statut** : spec à valider par Eric · **Périmètre** : kanban Chantiers (installation). SAV et entretien hors itération.

## 1. Problème

Aujourd'hui **1 lead = 1 chantier**. Tout devis validé rattaché au lead tombe sur la même carte, sans que personne ait dit « même chantier » ou « autre chantier ». Quand un client passe une seconde commande, la carte mélange tout.

Cas GOUIN (constaté le 2026-09-30) : un seul lead porte la borne (D-2026-09430, 1 261 €, facturée, posée le 18/09 à 1 personne) et la PAC (D-2026-09466, 11 540 €, acceptée le 30/09, 3 jours à 2 personnes en novembre). La carte affiche 12 801 €, des jours « J1 à J4 sur 3 », la commande 2 pers. × 3 j appliquée à la borne, l'appro de la borne, et un seul statut pour un chantier fini et un chantier à venir.

Mesuré en prod : **12 chantiers sur 74** portent au moins 2 devis validés. Classement donné par Eric le 2026-09-30 :

| Client | Devis validés | Verdict |
|---|---|---|
| BERNA | 6 481 € + 5 470 €, même jour | même chantier |
| DELMAS | 7 166 € (juin) + 640 € (août) | même chantier |
| BESOMBES | 9 080 € facturé et posé le 31/07 + 655 € le 13/08 | même chantier |
| VEOLIA ENERGIE, VEOLIA ENVIRONNEMENT | un devis facturé, un autre accepté ensuite | plusieurs interventions |
| GOUIN | borne + PAC | chantiers distincts |
| CAPPAROS, CHENE, COTTERAU, FRENCH COUNTRY, LITCHMAN, OBIERTI | — | à trancher dans l'app |

Aucune règle automatique ne départage ces cas : DELMAS a deux mois d'écart et BESOMBES un devis arrivé après la pose, et ce sont pourtant des chantiers uniques. **C'est un humain qui tranche.**

## 2. Décisions

1. **Même chantier par défaut.** Un devis de plus sur le lead reste sur la carte (cas majoritaire). Rien ne change pour BERNA, DELMAS, BESOMBES.
2. **Chantier distinct = carte distincte = lead distinct.** Le modèle « 1 lead = 1 chantier » est conservé. Séparer crée un second lead pour le même client et y déplace les devis et les jours d'installation choisis. C'est l'inverse de `lead_merge` ; l'annulation d'une séparation faite par erreur est le bouton « Fusionner » existant.
3. **La question est posée, la réponse est mémorisée.** Une carte qui porte au moins 2 devis validés dont un n'a pas été tranché affiche « Même chantier ou chantiers distincts ? ». Répondre « Même chantier » ou séparer fait disparaître la question ; un nouveau devis validé la fait revenir.
4. **Pas de table `chantiers`** (un lead, N chantiers) : il faudrait réécrire la vue, le kanban, les RDV, le PV de réception et la facturation pour 12 cas sur 74.
5. **Aucune séparation automatique** : ni cron ni heuristique ne crée de lead (règle « un flux serveur ne crée jamais de lead »). La RPC n'est appelée que par un geste utilisateur.

## 3. Modèle de données

Migration versionnée `supabase/migrations/20260930_11_lead_split.sql`, répétée sur `scripts/migration-rehearsal/` (étendre `snapshot.mjs` : tables `leads`, `lead_pennylane_quotes`, `lead_quote_revisions`, `chantier_line_receptions`, `appointments`, `lead_activities`, `statuses` si absentes).

### Colonnes

```sql
ALTER TABLE majordhome.lead_pennylane_quotes
  ADD COLUMN scope_confirmed_at timestamptz,
  ADD COLUMN scope_confirmed_by uuid;
```

`NULL` = pas encore tranché. Aucun backfill : les 12 cartes existantes affichent la question, Eric tranche dans l'app (cf. § 6).

### Vues (colonnes ajoutées en fin de liste)

- `majordhome.lead_quote_stats` : `+ unconfirmed_validated_count` = nombre de devis du bucket `validated` avec `scope_confirmed_at IS NULL`. Toujours via `quote_status_bucket()`, aucune allowlist recopiée.
- `public.majordhome_chantiers` : `+ quotes_to_arbitrate` = `unconfirmed_validated_count` si `accepted_count >= 2`, sinon 0.

### RPC `public.lead_quotes_confirm_scope(p_lead_id uuid)`

SECURITY DEFINER, `REVOKE FROM PUBLIC, anon`, `GRANT authenticated`. Garde positive : `auth.uid()` non NULL et membre de l'org du lead. Pose `scope_confirmed_at = now()`, `scope_confirmed_by = auth.uid()` sur les devis validés non éjectés du lead encore à NULL. Écrit une activité `quotes_scope_confirmed` (« N devis confirmés sur le même chantier »).

### RPC `public.lead_split(p_lead_id uuid, p_quote_ids uuid[], p_appointment_ids uuid[], p_move_planned_order boolean, p_equipment_type_id uuid)`

SECURITY DEFINER, `SET search_path = majordhome, public, core`, `REVOKE FROM PUBLIC, anon`, `GRANT authenticated`.

**Garde** (positive, `IS NOT TRUE`) : `auth.uid()` non NULL ; rôle dans l'org du lead ∈ (`org_admin`, `team_leader`). *Hypothèse prise seul, à confirmer : Philippe doit pouvoir séparer sans passer par un admin.*

**Validations** (RAISE explicite, rien n'est avalé) :
- le lead existe, n'est pas supprimé, porte un `chantier_status` ;
- chaque `p_quote_ids` appartient au lead et n'est pas éjecté ;
- la sélection contient au moins un devis validé, et il reste au moins un devis validé sur le lead d'origine (sinon ce n'est pas une séparation) ;
- chaque `p_appointment_ids` appartient au lead, est de type `installation`, n'est ni annulé ni `no_show` ;
- `p_equipment_type_id` (facultatif) appartient à la même org.

**Effets**, dans une seule transaction :
1. `INSERT` d'un nouveau lead : identité, adresse, géocodage, `client_id`, `project_id`, `assigned_user_id`, `source_id` recopiés du lead d'origine ; `status_id` = « Nouveau » ; `equipment_type_id` = `p_equipment_type_id`. **Non recopiés** : `external_id`, `external_source`, `external_data` (sinon le dashboard Meta Ads compterait deux gains pour une seule publicité), notes, compteurs d'appels, PV de réception, statuts d'appro.
2. Déplacement vers le nouveau lead : `lead_pennylane_quotes` sélectionnés, leurs `lead_quote_revisions` (par `lead_quote_id`), les `chantier_line_receptions` de ces devis (par `pennylane_quote_id`), les `appointments` sélectionnés.
3. Gain du nouveau lead par `lead_mark_won_with_quote(org, nouveau lead, devis validé déplacé le plus récent — tie-break `pennylane_quote_id DESC`)` : seule voie de gain, non dupliquée. Puis `won_date` = date de ce devis (et non la date de la séparation) ; `chantier_status` = `planification` (+ `planification_date`) si des jours d'installation ont suivi, sinon `gagne`.
4. Si `p_move_planned_order` : `planned_team_size` / `planned_days` passent sur le nouveau lead et sont remis à NULL sur l'origine.
5. Origine : si `leads.pennylane_quote_id` désignait un devis déplacé, il est repointé sur le devis validé restant le plus récent et `order_amount_ht` est réaligné (à vérifier au plan : lecteurs de ces deux colonnes). Si le devis déplacé portait `is_winning_quote`, le devis validé restant le plus récent le reprend.
6. `scope_confirmed_at` posé sur tous les devis validés des deux leads.
7. Activité `lead_split` sur **les deux** leads, avec en `metadata` l'autre lead, les devis et les RDV déplacés.

Retour : `{ new_lead_id, origin_lead_id, counts: { quotes, appointments, line_receptions } }`.

Le mouchard (`audit_log`) trace de lui-même l'INSERT du lead et le changement de `lead_id` des RDV. La synchro Google Calendar n'est pas concernée (ni date ni personne ne changent).

## 4. Module pur `src/lib/chantierSplit.js`

Aucun import React/Supabase. Testé par `scripts/chantier-split.test.mjs`, ajouté à `audit:quality`.

- `resumeSeparation({ quotes, appointments, plannedOrder }, selection)` → `{ origine: { montant, jours, devis }, nouveau: { montant, jours, devis }, erreurs: string[], ok: boolean }`. Mêmes règles que la RPC (au moins un devis validé de chaque côté), messages FR prêts à afficher.
- `commandeSuitParDefaut(plannedOrder, joursSelectionnes)` → `true` si le nombre de jours sélectionnés est égal à `planned_days` (cas GOUIN : 3 jours de novembre = la commande 2 × 3).

## 5. UI

### ChantierCard
- Badge ambre « N devis à trancher » quand `quotes_to_arbitrate > 0`.
- Deux cartes du même client se distinguent par le montant, la date et l'étiquette de type d'équipement (déjà affichée).

### ChantierReceptionSection (liste « Devis rattachés »)
- Bandeau ambre quand `quotes_to_arbitrate > 0` : « Ce chantier porte N devis validés. Même chantier ou chantiers distincts ? » avec deux boutons : **Même chantier** (→ `lead_quotes_confirm_scope`) et **Séparer…** (→ dialogue).
- Lien discret « Séparer en chantier distinct » sous la liste dès qu'il y a 2 devis validés, même une fois la question tranchée (on peut changer d'avis).
- Masqués pour un rôle qui n'a pas le droit de séparer.

### `SplitChantierDialog.jsx` (nouveau, `components/chantiers/`)
- Devis du lead en cases à cocher : numéro, objet du devis quand le miroir le porte (`pennylane_quotes.pdf_invoice_subject`, renseigné sur 50 des 114 devis validés ; ex. « Installation d'une Borne V2C Monophasé »), montant, statut. Les devis non validés (en attente, expirés) peuvent accompagner.
- Jours d'installation en cases à cocher (date, horaire, personnes).
- Case « La commande 2 pers. × 3 j part avec le nouveau chantier », pré-cochée selon `commandeSuitParDefaut`.
- Sélecteur facultatif « Type d'équipement du nouveau chantier ».
- Résumé en deux colonnes « Chantier d'origine » / « Nouveau chantier » (montant, devis, jours) issu de `resumeSeparation` ; bouton **Séparer** désactivé tant que `ok` est faux, avec l'erreur affichée.

### Service et hook
- `chantiersService.splitChantier(...)` et `confirmQuotesScope(leadId)` (retour `{ data, error }`).
- Mutations dans `useChantiers` via `unwrapResult()`. Invalidation croisée : chantiers, leads, cartes kanban du pipeline, RDV du chantier et listes planning, devis liés des deux leads.

### Fiche client, onglet Interventions
- `getChantierByClientId` fait `.limit(1)` : un client à deux chantiers n'en montrerait qu'un. Devient `getChantiersByClientId` (liste), `ChantierSummary` rend un bloc par chantier.

## 6. Rattrapage des 12 cartes existantes

Par les gestes de l'app, pas par SQL : les 12 cartes affichent le badge. BERNA, DELMAS, BESOMBES → « Même chantier ». VEOLIA ENERGIE, VEOLIA ENVIRONNEMENT, GOUIN → « Séparer ». Les 6 autres sont à trancher par Eric ou Philippe.

À regarder avant de trancher : CAPPAROS (1 346,30 € deux fois) et COTTERAU (2 338,72 € deux fois) ont deux devis validés **au même montant**. Cela ressemble à un devis en double plutôt qu'à deux commandes ; dans ce cas le geste est le ✕ « Retirer ce devis », pas la séparation.

## 7. Conséquences assumées

- **Pipeline** : deux cartes Gagné pour le client, une par commande. Les statistiques comptent deux gains, ce qui est exact.
- **Doublons** : `findPotentialDuplicates` signalera les deux leads du même client. C'est attendu (un client peut légitimement porter plusieurs affaires) ; « Fusionner » reste la voie de retour.
- **Rapprochement Pennylane** : `upsert_pennylane_lead` ne rapproche que des leads actifs ; deux leads Gagné (statut final) ne changent rien.

## 8. Hors périmètre

- Poser la question **au moment du rattachement** du devis (explorateur `/devis`, fiche lead) : itération suivante si le badge ne suffit pas.
- Séparation depuis la fiche lead du pipeline (la RPC le permettra, seule l'UI chantier est livrée).
- SAV et entretien.
- Correctif « Il manque N jours » de `ChantierInterventionSection` (le calcul lit `date` / `technicianIds` sur des RDV qui portent `scheduled_date` / `technician_ids`) : bug indépendant, signalé à part.

## 9. Vérification

- `node --test scripts/chantier-split.test.mjs` : sélection vide, aucun devis validé sélectionné, aucun devis validé restant, montants et jours de chaque côté, commande qui suit par défaut.
- Répétition de la migration sur le harnais, avec assertions : séparation GOUIN (2 leads, montants 1 260,76 € et 11 540 €, 1 et 3 jours, commande sur le nouveau, activités sur les deux) ; refus pour un technicien, pour un devis d'un autre lead, pour une sélection qui vide l'origine ; `has_function_privilege('anon', …)` faux sur les deux RPC.
- `npm run audit:quality`, `npx vite build`.
- Manuel (Eric) : séparer GOUIN → deux cartes, la borne à 1 261 € avec le jour du 18/09, la PAC à 11 540 € avec les 3 jours de novembre et « commande 2 pers. × 3 j » ; deux cartes Gagné au pipeline ; « Même chantier » sur BERNA → le badge disparaît et ne revient pas.
