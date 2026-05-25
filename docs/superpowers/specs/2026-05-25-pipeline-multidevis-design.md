# Spec — Pipeline multi-devis (Phase 1)

> **Date** : 2026-05-25
> **Auteur** : Brainstorming Eric + Claude
> **Statut** : Validé pour implémentation
> **Itération** : 1 (Phase 1) — Affichage pluri-cartes pipeline. Phase 2 (chantiers granulaires "1 par devis") prévue plus tard.
> **Lien spec antérieure** : `docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md` (le bridge Pipeline ↔ Pennylane, dont cette spec est l'évolution UX)

## 1. Contexte & motivation

Le bridge Pipeline ↔ Pennylane (PR 1-6 + cron PR 7 prévu) permet d'attacher N devis Pennylane à un même lead. Mais le modèle d'affichage actuel impose **1 lead = 1 carte = 1 statut** dans le Kanban, ce qui crée des situations problématiques :

- **Cas BERNA HÉLÈNE (réel chez Mayer)** : 2 devis signés (D-2026-04106 + D-2026-04107). Le lead bascule en Gagné, mais les 2 ventes sont fondues dans 1 carte → le commercial perd la visibilité par devis.
- **Cas mix pending + accepted** : si un client signe 1 devis et laisse 2 autres en attente, basculer le lead en "Gagné" fait disparaître la trace commerciale sur les devis pending non encore tranchés.
- **Cas Perdu** : un devis refusé devrait apparaître en Perdu pour le KPI commercial. Mais si le client a signé un autre devis du même lot, ce n'est pas un échec commercial — il a juste choisi une variante.

**Objectif Phase 1** : refondre l'affichage du Kanban pipeline pour qu'un même lead puisse générer 1 ou plusieurs cartes selon l'état de ses devis Pennylane attachés, **sans modifier le modèle data** (préserver la compatibilité Phase 2 future qui éclatera aussi le Kanban Chantiers à granularité devis).

## 2. Scope

### Dans le scope (Phase 1)
- Vue SQL `public.majordhome_kanban_cards` qui matérialise les "cartes Kanban" calculées depuis `lead_pennylane_quotes.quote_status` (Pennylane canonical)
- Refonte UI du Kanban pipeline : chaque carte affiche un chip `📄 N ▼` cliquable pour déployer les sous-cartes devis
- Adaptation `LeadCard.jsx` pour le pattern compact/étendu (taille compacte identique à l'existante)
- Adaptation `LeadKanban.jsx` pour consommer la nouvelle vue (1 lead peut générer 1 ou 2 cartes)
- Cron `pennylane-sync-quote-status` (PR 7 d'origine, adaptée) : sync `quote_status` PL → DB + sync customer fields PL → MDH, sans toucher à `leads.status_id`
- KPI compteurs par colonne basés sur la vue (COUNT cartes, SUM montants ROUND)

### Hors scope explicite (Phase 2+)
- **Refonte Kanban Chantiers** à granularité devis (nouvelle table `majordhome.chantiers`, 1 row par devis accepted)
- **Distinction "variantes du même projet" vs "projets distincts"** quand le client signe 2 devis (double comptage CA accepté en Phase 1)
- **Suppression de `leads.chantier_status` et colonnes liées** — reste tel quel
- **Migration des cartes chantier existantes** vers la nouvelle table — Phase 2
- **Persistance de l'état expand** entre refresh — non persisté (volatile)

## 3. Décisions de design validées

| Question | Décision |
|---|---|
| Mental model "Devis envoyé" | Statut du LEAD (1 carte = 1 client jusqu'au tranchage), mais l'affichage en aval peut éclater selon les devis. |
| 1 lead = 1 carte ? | **Non** — 1 lead avec mix pending + accepted génère 2 cartes (1 en Devis envoyé + 1 en Gagné). Cas BERNA (2 accepted) = 1 carte regroupée. |
| Source de vérité du Kanban | **Pennylane canonical** via `lead_pennylane_quotes.quote_status`. Calcul de placement dans la vue SQL. `leads.status_id` reste utilisé uniquement pour les leads sans devis PL (mode classique). |
| Bascule auto Gagné/Perdu côté `leads.status_id` | **Non** — le cron PR 7 ne touche plus à `leads.status_id` quand le lead a des devis attachés. La vue calcule la position de la carte indépendamment. |
| Montant par carte | **SUM des devis pertinents pour la colonne**, arrondi à l'entier (`ROUND`). Devis envoyé = SUM pending, Gagné = SUM accepted, Perdu = SUM refused. |
| KPI compteurs | COUNT cartes (= nb clients distincts dans cette colonne) + sous-compteur "X devis" |
| Carte en Perdu si lead a 1 signature | **Non** — règle "pas un échec commercial". Lead avec ≥1 accepted ne génère JAMAIS de carte Perdu (les refusés sont tracés en sous-cartes au LeadModal seulement). |
| Affichage carte par défaut | **Compact** (taille identique à l'existant). Chip `📄 N ▼` déclenche l'expand inline. Pas de persistance de l'état d'expand. |
| Mini-indicateur statuts | "1✓ 1⏳ 1✗" optionnel sous le chip pour aperçu instant sans déployer. À tester visuellement. |
| Lien sous-carte | Clic ouvre le devis dans Pennylane (nouvel onglet). Pas de deeplink interne. |

## 4. Architecture d'ensemble

```
┌─────────────────────────────────────────────────────────────────────┐
│  DATA LAYER                                                          │
│                                                                       │
│  majordhome.leads ──────┐                                            │
│                          ├─→  vue public.majordhome_kanban_cards     │
│  majordhome.lead_        │     (matérialise N cartes par lead         │
│  pennylane_quotes ──────┘      selon les statuts devis)              │
│  (quote_status sync PL)                                              │
└────────────────────────────────────────────────┬────────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CRON (PR 7)                                                         │
│  Edge function pennylane-sync-quote-status (15 min)                  │
│                                                                       │
│  - Fetch /quotes PL paginé                                           │
│  - Sync quote_status (DB ← PL)                                       │
│  - Pose is_winning_quote sur le plus récent accepted si pas posé    │
│  - Sync customer fields PL → MDH (COALESCE strict)                  │
│  - Log anomalies en lead_activities                                  │
│  - PAS de bascule leads.status_id (PL canonical via la vue)         │
└─────────────────────────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UI LAYER                                                            │
│                                                                       │
│  LeadKanban.jsx ─── consomme majordhome_kanban_cards                 │
│       │                                                              │
│       └── LeadCard.jsx (compact + étendu)                            │
│              │                                                       │
│              ├── chip "📄 N ▼" cliquable                             │
│              └── QuoteSubCard.jsx (sous-cartes devis)                │
└─────────────────────────────────────────────────────────────────────┘
```

## 5. Modèle data

**Phase 1 : AUCUNE nouvelle table, AUCUNE nouvelle colonne sur tables existantes.**

Tables existantes consommées :
- `majordhome.leads` — `status_id` reste utilisé pour les leads sans devis PL (mode classique)
- `majordhome.lead_pennylane_quotes` — source de vérité des statuts devis
- `majordhome.statuses` — 6 statuts globaux inchangés

### Nouvelle vue `public.majordhome_kanban_cards`

```sql
CREATE OR REPLACE VIEW public.majordhome_kanban_cards
WITH (security_invoker = true) AS
WITH lead_quote_stats AS (
  SELECT
    lpq.lead_id,
    lpq.org_id,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('pending','draft')) AS pending_count,
    COUNT(*) FILTER (WHERE lpq.quote_status = 'accepted') AS accepted_count,
    COUNT(*) FILTER (WHERE lpq.quote_status IN ('refused','denied','expired','canceled')) AS refused_count,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('pending','draft')) AS pending_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status = 'accepted') AS accepted_sum,
    SUM(lpq.quote_amount_ht) FILTER (WHERE lpq.quote_status IN ('refused','denied','expired','canceled')) AS refused_sum
  FROM majordhome.lead_pennylane_quotes lpq
  WHERE lpq.ejected_at IS NULL
  GROUP BY lpq.lead_id, lpq.org_id
)
-- Cartes "Devis envoyé" depuis devis pending
SELECT
  l.id || ':devis_envoye' AS card_key,
  l.id AS lead_id, l.org_id,
  'lead' AS card_type,
  'devis_envoye' AS column_key,
  lqs.pending_count AS devis_count,
  ROUND(lqs.pending_sum)::numeric AS total_amount,
  lqs.pending_count AS pending_count,
  lqs.accepted_count AS accepted_count,
  lqs.refused_count AS refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.pending_count > 0 AND COALESCE(l.is_deleted, false) = false

UNION ALL

-- Cartes "Gagné" depuis devis accepted
SELECT
  l.id || ':gagne' AS card_key,
  l.id AS lead_id, l.org_id,
  'lead' AS card_type,
  'gagne' AS column_key,
  lqs.accepted_count AS devis_count,
  ROUND(lqs.accepted_sum)::numeric AS total_amount,
  lqs.pending_count, lqs.accepted_count, lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.accepted_count > 0 AND COALESCE(l.is_deleted, false) = false

UNION ALL

-- Cartes "Perdu" UNIQUEMENT si 0 accepted (vraie perte commerciale)
SELECT
  l.id || ':perdu' AS card_key,
  l.id AS lead_id, l.org_id,
  'lead' AS card_type,
  'perdu' AS column_key,
  lqs.refused_count AS devis_count,
  ROUND(lqs.refused_sum)::numeric AS total_amount,
  lqs.pending_count, lqs.accepted_count, lqs.refused_count
FROM majordhome.leads l
JOIN lead_quote_stats lqs ON lqs.lead_id = l.id
WHERE lqs.refused_count > 0 AND lqs.accepted_count = 0 AND lqs.pending_count = 0
  AND COALESCE(l.is_deleted, false) = false

UNION ALL

-- Cartes mode classique : leads sans devis PL attaché → fallback sur leads.status_id
SELECT
  l.id || ':classic' AS card_key,
  l.id AS lead_id, l.org_id,
  'lead' AS card_type,
  CASE s.display_order
    WHEN 1 THEN 'nouveau'
    WHEN 2 THEN 'contacte'
    WHEN 3 THEN 'rdv_planifie'
    WHEN 4 THEN 'devis_envoye'
    WHEN 5 THEN 'gagne'
    WHEN 6 THEN 'perdu'
  END AS column_key,
  0 AS devis_count,
  COALESCE(l.order_amount_ht, 0)::numeric AS total_amount,
  0 AS pending_count, 0 AS accepted_count, 0 AS refused_count
FROM majordhome.leads l
LEFT JOIN majordhome.statuses s ON s.id = l.status_id
WHERE COALESCE(l.is_deleted, false) = false
  AND NOT EXISTS (
    SELECT 1 FROM lead_quote_stats lqs WHERE lqs.lead_id = l.id
  );
```

**Notes** :
- `security_invoker = true` (convention P0.0.2)
- Stats agrégées dans une CTE pour éviter recalculs
- 1 lead peut générer 1 ou 2 cartes selon mix devis (jamais 3 — car Perdu exclu si ≥1 accepted)
- Fallback mode classique pour les leads sans devis attaché (rétro-compat)

### Index recommandés (existants)
- `majordhome.lead_pennylane_quotes.lead_id` ✅ déjà présent (`idx_lpq_lead`)
- `majordhome.lead_pennylane_quotes.ejected_at IS NULL` couvert par index existant `idx_lpq_active`
- Pas de nouvel index nécessaire

## 6. Règles de placement du lead

```
Pour chaque lead avec devis Pennylane attachés (ejected_at IS NULL) :
  - SI ≥1 devis pending|draft
    → générer 1 carte en "Devis envoyé"
  - SI ≥1 devis accepted
    → générer 1 carte en "Gagné"
  - SI ≥1 devis refused|denied|expired|canceled ET 0 accepted ET 0 pending
    → générer 1 carte en "Perdu"
  (1 lead peut donc générer 1 ou 2 cartes selon mix)

Pour chaque lead SANS devis Pennylane attachés (mode classique) :
  → 1 carte au statut leads.status_id (comportement actuel inchangé)
```

### Conséquence pour `leads.status_id`

- Pour les leads **avec** devis attachés : `status_id` n'est plus consulté pour le Kanban. Le cron ne le bascule pas. Il sert pour :
  - Le LeadModal (affichage du badge en haut)
  - La rétro-compatibilité avec d'autres systèmes (KPI legacy, reporting)
- Pour les leads **sans** devis attachés : `status_id` reste source de vérité (mode classique inchangé)

### Cas concret BERNA (aujourd'hui)
- 2 devis attachés, tous `accepted` côté PL, 0 pending
- Vue génère 1 carte en "Gagné" avec chip "📄 2 ▼" (montre D-04106 + D-04107)
- Montant carte = ROUND(5469.99 + 6480.98) = **11 951 €**

### Cas concret BERNA hypothétique (mix pending + accepted)
- Vue génère 2 cartes :
  - 1 en "Devis envoyé" (chip 📄 1 → le pending)
  - 1 en "Gagné" (chip 📄 1 → l'accepted)

## 7. Affichage de la carte

### État compact (défaut, taille préservée)

```
┌────────────────────────────────────┐
│  ┌──┐                               │
│  │21│ DUPONT JEAN              5470€│
│  │MAI│ Site Web · PM · 📄 3 ▼      │
│  └──┘                               │
└────────────────────────────────────┘
```

- Date + nom client + chips source/commercial existants
- Nouveau chip cliquable : `📄 N ▼` où N = devis pertinents pour la colonne
  - Couleur du chip selon contexte : bleu (Devis envoyé), vert (Gagné), gris (Perdu)
- Montant à droite (SUM ROUND, cf section 8)
- (Optionnel) Mini-indicateur sous le chip : "1✓ 1⏳ 1✗" pour aperçu instant

### État étendu (sur clic du chip)

```
┌────────────────────────────────────┐
│  ┌──┐                               │
│  │21│ DUPONT JEAN              5470€│
│  │MAI│ Site Web · PM · 📄 3 ▲      │
│  └──┘                               │
│  ┌────────────────────────────────┐ │
│  │ D-2026-04130 · ✓ 23 avr  7905€│ │
│  ├────────────────────────────────┤ │
│  │ D-2026-04131 · ⏳ 24 avr  3250€│ │
│  ├────────────────────────────────┤ │
│  │ D-2026-04132 · ✗ 25 avr  1150€│ │
│  └────────────────────────────────┘ │
└────────────────────────────────────┘
```

- N sous-cartes correspondantes
- Chaque sous-carte : numéro devis (D-2026-XXX), mini-icône statut, date courte, montant
- Clic sur sous-carte → ouvre `https://app.pennylane.com/quotes/{id}` (nouvel onglet)
- Re-clic chip ▲ → repli (sans persistance entre refresh)

### Composants front à modifier

| Fichier | Changement |
|---|---|
| `LeadKanban.jsx` | Consomme `majordhome_kanban_cards` au lieu de `leads`. Itère par `card_key` (1 lead peut produire 2 entrées). |
| `LeadCard.jsx` | Ajout du chip cliquable + bloc expand inline. Reçoit en props les sous-cartes devis filtrées par column_key. |
| `QuoteSubCard.jsx` (nouveau) | Ligne devis dans l'expand. Similaire à `LinkedQuotesPanel` mais en compact (1 ligne). |
| `useLeads.js` | Nouveau hook `useKanbanCards(orgId, columnKey)` qui SELECT sur la vue. Remplace ou complète `useLeads` pour le Kanban (les autres callers de `useLeads` restent inchangés). |

## 8. Montant affiché par carte

| Carte | Montant | Sémantique |
|---|---|---|
| Devis envoyé | `ROUND(SUM des devis pending)` | CA potentiel en cours |
| Gagné | `ROUND(SUM des devis accepted)` | CA réalisé (1 ligne = 1 vente acquise) |
| Perdu | `ROUND(SUM des devis refused)` | CA perdu (vraie perte) |
| Mode classique | `leads.order_amount_ht` (existant) | Inchangé |

**Pas de double comptage côté KPI** : chaque devis n'est dans qu'**une** colonne (par sa position dans `quote_status`).

## 9. Cron `pennylane-sync-quote-status` (PR 7)

Edge function planifiée Supabase, 15 min, `verify_jwt:false` + `requireSharedSecret(MDH_CRON_SECRET)` (pattern P0.2/P0.25).

### Algorithme

```
Pour chaque org WHERE settings->pennylane->>enabled = 'true':

  1. Fetch /quotes Pennylane (paginé, MAX_PAGES=10 safety, ~30j fenêtre)

  2. Pour chaque devis attaché actif (lead_pennylane_quotes.ejected_at IS NULL):
     a. Sync quote_status DB ← quote_status PL (si différent)
     b. SI lead a ≥1 devis 'accepted' ET aucun is_winning_quote=true:
        → poser is_winning_quote=true sur le plus récent accepted
          (tri pennylane_quote_id DESC)
     c. PAS de bascule de leads.status_id (Pennylane canonical via la vue)

  3. Pour chaque customer PL référencé:
     a. Pull /customers/{id}
     b. Si fields divergent du client MDH (via pennylane_sync):
        UPDATE majordhome.clients avec COALESCE strict
        (name, first_name, last_name, email, phone, address, postal_code, city)

  4. Cas anormaux loggés en lead_activities:
     - 'anomaly_multiple_accepted' (N devis acceptés sur même lead)
     - 'anomaly_winning_quote_refused' (winning passé refused)
     - 'anomaly_quote_deleted_in_pennylane' (404 sur /quotes/{id})
       → ejected_at = NOW(), ejected_reason = 'deleted_in_pennylane'

  5. Logger nb d'updates par run pour observabilité
```

### Auth & sécurité
- `verify_jwt:false` + `requireSharedSecret(MDH_CRON_SECRET)` du helper `_shared/auth.ts`
- Skip silencieux si org a clé API PL invalide (log warning)

### Idempotence
- Chaque run rescanne, no-op si déjà à l'état cible
- UPDATEs vérifient l'égalité avant pour éviter changements sans valeur
- Erreurs par devis/par customer catchées localement → ne bloquent pas le run

### Différence avec spec PR 7 initiale
- **N'ajuste plus `leads.status_id`** (PL canonical via la vue)
- Pas de bascule auto Gagné/Perdu côté `status_id`

## 10. KPI et compteurs

Calculés directement depuis `majordhome_kanban_cards`. Pas de calcul JS séparé.

| Colonne | Compteur principal | Sous-compteur |
|---|---|---|
| Nouveau / Contacté / RDV | COUNT(*) | — |
| Devis envoyé | COUNT(*) (nb clients) | SUM(devis_count) (nb devis pending) |
| Gagné | COUNT(*) (nb clients distincts ayant ≥1 signature) | SUM(devis_count) (nb devis signés) |
| Perdu | COUNT(*) (nb clients en vraie perte) | SUM(devis_count) (nb devis refusés) |

Montants totaux colonne = SUM(total_amount) sur les cartes de la colonne.

```sql
-- Exemple compteur Gagné
SELECT
  COUNT(*) AS clients_count,
  SUM(devis_count) AS quotes_count,
  SUM(total_amount) AS ca_realise
FROM public.majordhome_kanban_cards
WHERE column_key = 'gagne' AND org_id = :org_id;
```

## 11. Cas limites

| Cas | Comportement |
|---|---|
| Lead avec 0 devis attaché | Mode classique inchangé — `leads.status_id` source de vérité |
| 1 devis pending | 1 carte Devis envoyé, chip "📄 1" |
| 1 devis accepted, 0 pending | 1 carte Gagné, chip "📄 1" |
| 1 accepted + 1 pending | 2 cartes : Devis envoyé (📄 1) + Gagné (📄 1) |
| 2 accepted, 0 pending (BERNA réel) | 1 carte Gagné, chip "📄 2", montant SUM |
| N refused, 0 accepted, 0 pending | 1 carte Perdu, chip "📄 N" |
| N refused, ≥1 accepted (variantes) | 1 carte Gagné uniquement (refused juste tracés au LeadModal) |
| Lead Mayer "Gagné" manuel (pré-bridge) | Fallback classique — la vue lit `status_id` |
| Devis PL supprimé côté PL | Cron pose `ejected_at` + `'deleted_in_pennylane'`. Vue recalcule sans ce devis. |
| Multiple devis accepted | Cron pose winning sur le plus récent, log anomaly |
| Winning passe refused | Cron pose winning=false, log anomaly. Carte recalculée. |
| Lead supprimé (soft delete) | Vue exclut `is_deleted=true` |

## 12. Compatibilité Phase 2 future

**Engagement Phase 1** : aucune dette qui rendrait Phase 2 difficile.

### Ce que Phase 2 ajoutera (chantiers granulaires)
- Nouvelle table `majordhome.chantiers(id, org_id, lead_id, pennylane_quote_id, chantier_status, equipment_order_status, materials_order_status, planification_date, estimated_date, chantier_notes, ...)`
- 1 row par devis accepted (FK vers `lead_pennylane_quotes`)
- Le Kanban Chantiers (`/chantiers`) affichera 1 carte par row

### Migration data Phase 2 (script SQL prévu)
Pour chaque lead actuel avec `chantier_status IS NOT NULL` :
- Si ≥1 devis accepted attaché : 1 row chantiers par devis accepted
- Sinon (legacy) : 1 row chantiers "orpheline" (`pennylane_quote_id NULL`)

### Garanties Phase 1
- Aucune nouvelle colonne sur `majordhome.leads` ou `lead_pennylane_quotes` qui présume "1 chantier = 1 lead"
- Vue `majordhome_kanban_cards` peut être étendue pour cartes chantier (Phase 2)
- Aucune contrainte SQL bloquante

### Phase 1 — workaround BERNA
- BERNA reste 1 carte chantier en `planification`
- 2 interventions distinctes à créer manuellement dans la modale chantier
- Acceptable pour 1 cas isolé

## 13. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Double comptage CA si client signe 2 variantes du même projet | Limitation connue Phase 1. Résolvable Phase 2+ via concept "groupe de devis / projet". |
| Drift entre `leads.status_id` et la vue (lead "Devis envoyé" en DB mais devis acceptés) | Acceptable. `status_id` n'est plus la source de vérité du Kanban pour leads avec PL. LeadModal et reporting peuvent l'utiliser. |
| Performance de la vue sur grosses orgs | Vue calculée à chaque requête. Pour Mayer (~3000 clients, <500 devis attachés actifs), négligeable. Si croissance : matview ou cache React Query suffisent. |
| Cohérence visuelle (mini-indicateurs "1✓ 1⏳ 1✗" peu lisibles) | À valider visuellement avec Eric. Optionnel et désactivable. |
| Régression sur leads sans PL (mode classique) | Tests obligatoires : créer 1 lead sans PL, vérifier qu'il apparaît dans la bonne colonne via fallback `status_id`. |
| Lead orphelin si tous devis ejectés | Vue tombe en mode classique (NOT EXISTS lead_quote_stats). Comportement OK. |

## 14. Limitations connues

- **Double comptage CA** sur variantes de projet signées (cf section 13)
- **Pas de granularité chantier** Phase 1 — workaround manuel BERNA
- **Pas de persistance d'expand** entre refresh navigateur
- **Drift potentiel `leads.status_id` vs Kanban affichage** (acceptable, documenté)

## 15. Travaux annexes (à intégrer dans le plan)

- **Onglet Statuts du LeadModal** : afficher le badge "Pennylane canonical" ou similaire pour indiquer au commercial que le statut affiché vient des devis PL, pas d'un statut manuel
- **Reporting / KPI dashboard** : adapter les requêtes existantes (s'il y en a) à la nouvelle sémantique "1 client gagné = COUNT DISTINCT lead_id en colonne gagné"
- **Tests E2E** : scénario "lead → 2 devis attachés → 1 signé + 1 pending → 2 cartes visibles" (Cypress ou équivalent — pas encore en place)

## 16. Références

- Brainstorming session 2026-05-25 (cette conversation)
- Spec bridge initial : `docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md`
- BERNA HÉLÈNE (cas réel multi-devis Gagné chez Mayer) : `lead_id=d87ed67a-2b7d-4782-a3a3-6898d41dfd8b`, 2 devis accepted (D-2026-04106 + D-2026-04107)
- Convention multi-tenant cache keys + helpers : `CLAUDE.md` sections "Multi-tenant & sécurité" + "Conventions qualité"
- Tie-break "le plus récent" sur `pennylane_quote_id DESC` : commit `c4518ca` (2026-05-24)
