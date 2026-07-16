# SPEC — Chantier : reprendre les devis validés du pipeline (Pennylane canonical)

> **Date** : 2026-07-16 · **Statut** : validé avec Eric (brainstorming) — à relire avant plan d'implémentation
> **Steer Eric** : « le canonique c'est le flag *accepted* que je passe sur Pennylane » · « une carte en chantier vient forcément d'un devis marqué gagné sur pipeline, c'est la suite logique, **pas un traitement différent** ».
> **Prolonge** : Module Pennylane quote-driven (`docs/MODULE_PENNYLANE.md`), bridge Pipeline ↔ PL (spec 2026-05-23).

---

## 1. Constat

Le Kanban chantier affiche des montants faux. Deux causes **indépendantes**, découvertes en investiguant le client OBIERTI.

**Cas de référence — OBIERTI JEAN MARC.** Pennylane (canonique) : `D-2026-07296` **Accepté** 3 520 € · `D-2026-07302` **Accepté** 2 197 € · `D-2026-07301` **Refusé** 1 233 € · `D-2026-07297` **Refusé** 750 €. Total accepté = **5 717 €**. Chez nous : 3 lignes `accepted` → **6 950 €**, sur la carte chantier **et** sur la carte Gagné du pipeline.

---

## 2. Bug A — le trigger réécrit le statut canonique

`trg_lead_pennylane_quotes_invariant_winning` est déclaré `BEFORE INSERT OR UPDATE OF is_winning_quote, quote_status` et force `quote_status := 'accepted'` dès que `is_winning_quote = true` et que le statut sort de {accepted, invoiced}.

`D-2026-07301` (refusé dans PL) porte `is_winning_quote = true`. Donc **à chaque passage du cron** (15 min) : lecture PL `refused` → `UPDATE quote_status='refused'` → le trigger intercepte avant écriture → réécrit `'accepted'`. La valeur stockée ne change jamais ; le cron compte l'opération comme une mise à jour réussie. **Échec silencieux permanent.**

Le trigger avait été posé (2026-05-25) pour préserver le geste commercial face aux désynchros cron/RPC : un commercial marque un devis gagné alors que PL est encore `pending` → forcer `accepted` pour que la carte tombe en Gagné. **Intention légitime** — mais le trigger ne distingue pas « PL ne sait pas encore » de « PL dit non », et écrase le second.

**Portée** : 42 lignes `is_winning_quote = true` actives, chacune capable de masquer un refus/une expiration PL de la même façon. Le pipeline est touché autant que le chantier (même colonne lue).

### Sémantique retenue (validée Eric)

| Statut entrant depuis PL | Seau | Comportement |
|---|---|---|
| `refused` / `denied` / `canceled` | **PL dit non** | PL gagne : le statut passe, `is_winning_quote := false` |
| `null` / `pending` / `draft` / `expired` | **PL ne sait pas (encore)** | Geste commercial préservé : `quote_status := 'accepted'` si winning |
| `accepted` / `invoiced` | validé | inchangé |

`expired` reste dans le seau indécis : décision produit existante — un devis expiré est relançable et ne pousse pas le lead en Perdu (cf. `majordhome_kanban_cards`, migration `20260525_7_lpq_normalize_winning_expired`).

Ce sont **les 3 mêmes seaux que `majordhome_kanban_cards`** utilise déjà (`pending_count` / `accepted_count` / `refused_count`) — aucune notion nouvelle n'est introduite.

**Distinction Case 1 / Case 3 (impose de lire `OLD`)** : « le cron change le statut d'une ligne déjà gagnante » (PL parle → PL gagne) et « la RPC pose winning sur une ligne refusée » (geste commercial) présentent le même `NEW`. Discriminant : `TG_OP = 'UPDATE' AND NEW.quote_status IS DISTINCT FROM OLD.quote_status`. Dans le second cas on force `accepted`, et le cron réaligne sur PL au passage suivant (auto-correction ≤ 15 min, PL garde le dernier mot).

**Pas de backfill.** Une fois le trigger corrigé, le cron re-fetche tous les devis rattachés et réaligne seul en ≤ 15 min.

---

## 3. Bug B — le chantier ne compte pas comme le pipeline

`majordhome_kanban_cards` calcule la colonne Gagné avec `accepted_sum` sur l'allowlist `accepted | invoiced`. `majordhome_chantiers.linked_quotes_amount_ht` **somme tous les devis non éjectés, sans filtre de statut**. Pour le même lead, les deux vues divergent :

| Lead | Carte Gagné (pipeline) | Carte chantier | Devis acceptés |
|---|---|---|---|
| RENOU FATHIA | 5 600 € | **21 190 €** | 1 |
| TACHON YANICK | 4 752 € | **15 790 €** | 1 |
| BUHL SEBASTIEN | 3 821 € | **14 498 €** | 1 |
| CHENE ALBERTE | 7 155 € | **12 553 €** | 2 |
| CHAUVIERE JOSETTE | 5 214 € | **10 428 €** | 1 |
| ASTRUC MR | 4 645 € | **9 000 €** | 1 |
| DUVAL BRUNO | 2 523 € | **7 056 €** | 1 |
| BALARAN LIONEL | 3 652 € | **6 058 €** | 1 |
| DELPECH-GAUDIN INGRID | 2 511 € | **4 785 €** | 1 |

9 chantiers sur 43. Totaux de colonnes faussés d'autant : Planification 238 749 € → **194 930 €**, Commande à faire 48 983 € → **31 316 €**.

Côté écran, ces devis refusés/expirés apparaissent aussi comme des blocs à réceptionner dans « Gestion des Appro », avec leurs lignes — du bruit pur.

---

## 4. Design

**Principe** : le chantier ne définit rien. Il **consomme** la notion « devis validé » du pipeline. Une seule définition en base, impossible de diverger à nouveau.

### 4.1 Trigger (migration)

`CREATE OR REPLACE FUNCTION majordhome.lead_pennylane_quotes_invariant_winning()` selon la table de sémantique §2. Le trigger lui-même n'est pas redéclaré (mêmes événements).

### 4.2 Vue partagée `majordhome.lead_quote_stats` (migration)

Le CTE `lead_quote_stats` de `majordhome_kanban_cards` est extrait dans sa propre vue (`security_invoker = true`), consommée par :
- `majordhome_kanban_cards` — remplace son CTE (colonnes de sortie identiques) ;
- `majordhome_chantiers` — `linked_quotes_amount_ht` devient `accepted_sum` (COALESCE 0), plus la sous-requête `sum()` sans filtre.

L'allowlist `accepted | invoiced` n'existe **qu'ici**.

Contraintes respectées : `CREATE OR REPLACE VIEW` ne change ni nom, ni type, ni position de colonne (`linked_quotes_amount_ht` reste `numeric` à sa place) → pas de « cannot change name of view column ». Les deux vues sont déjà non-updatable (JOIN/LATERAL/UNION) et les écritures passent par `update_majordhome_lead` → aucun risque de régression PostgREST type Bloc B. `GRANT SELECT` à `authenticated` + `service_role` sur la nouvelle vue.

### 4.3 Section Appro (frontend)

`ChantierReceptionSection` n'affiche que les devis validés. L'allowlist n'est pas recopiée dans le composant : filtrage porté par la couche service/hook via une constante unique exportée. Les devis non validés **restent dans le pivot** (on filtre à l'affichage, on n'éjecte pas) → le placement Kanban du pipeline, qui lit les mêmes lignes, n'est pas touché.

### 4.4 Retrait de la modale de liaison (frontend)

`LinkPennylaneQuoteModal.jsx` supprimé (fichier + ses 2 points de montage dans `ChantierReceptionSection`). Un seul endroit pour rattacher un devis : le pipeline. L'état « aucun devis validé » renvoie vers le pipeline au lieu d'offrir un bouton.

Le ✕ « retirer ce devis du chantier » **reste** : seul recours quand le cron rattache un devis validé au mauvais lead (`autoAttachNewQuotes` vise le lead assigné le plus récemment), cas que PL ne peut pas corriger.

`is_winning_quote` reste tel quel pour le pipeline ; il ne décide plus de la composition du chantier.

---

## 5. Critère de succès (vérifiable)

1. **OBIERTI** : carte Gagné pipeline = 2 devis / **5 717 €**, carte chantier = **5 717 €**.
2. **Zéro divergence** — pour tout lead avec devis rattachés :
   ```sql
   SELECT count(*) FROM majordhome.leads l
     JOIN public.majordhome_chantiers ch ON ch.id = l.id
     JOIN public.majordhome_kanban_cards kc ON kc.lead_id = l.id AND kc.column_key = 'gagne'
   WHERE ROUND(ch.linked_quotes_amount_ht) IS DISTINCT FROM kc.total_amount;
   -- attendu : 0
   ```
3. **Trigger** : aucune ligne `is_winning_quote = true AND quote_status IN ('refused','denied','canceled')` après passage du cron (l'invariant tient toujours, mais par PL, plus par écrasement).
4. Les 9 chantiers du §3 affichent le montant de leur carte Gagné.
5. `npx vite build` OK · `npm run lint:errors` OK · `npm run audit:dead-code` ne signale pas de nouvel orphelin.

Ordre imposé : **§4.1 avant §4.2** — filtrer sur un statut corrompu laisserait OBIERTI à 6 950 €. Vérifier le point 1 après un passage de cron avant d'enchaîner.

---

## 6. Hors périmètre (signalé, non embarqué)

- **Seuil 1 000 € HT de `autoAttachNewQuotes`** : une option acceptée sous 1 000 € ne remonte pas seule (ex. `D-2026-07297` à 750 €, sans conséquence car refusé). Le baisser ferait entrer les devis SAV/entretien dans le pipeline → arbitrage produit distinct.
- **Absence d'`updated_at` sur `majordhome.lead_pennylane_quotes`** : impossible de dater la dernière synchro d'une ligne, donc d'auditer les décrochages. C'est ce qui a rendu le bug A indétectable de l'intérieur.
- **Cron `pennylane-sync-quote-status` : ~250 appels PL séquentiels, 120 s par passage, sans `pLimit(5)`** alors que la limite PL est de 25 req/5 s, et **skip silencieux** (`console.warn` + `continue`) de tout devis dont le GET ne renvoie pas 2xx après 2 retries. Pas la cause du bug A (démenti par l'analyse), mais une fragilité réelle qui grandit avec le volume du pivot.
