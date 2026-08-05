# Resync des montants de devis Pennylane + historique des révisions

**Date** : 2026-08-05
**Statut** : spec validée, plan à écrire
**Modules touchés** : Pennylane (bridge pipeline), Chantiers

---

## 1. Le problème

Un devis modifié dans Pennylane après son rattachement à un lead n'est jamais
resynchronisé côté Majord'home. Le montant affiché est un instantané figé au
moment du rattachement.

**Cas de référence — lead FLECHER DOMINIQUE** (`3ea42c72-…`) :

| | Pennylane (état réel) | Majord'home (base) |
|---|---|---|
| Numéro | D-2026-**05137** | D-2026-**04137** |
| Date | 19 mai 2026 | 28 avr. 2026 |
| Montant HT | **7 386,00 €** | **7 096 €** |

Même devis Pennylane (`pennylane_quote_id = 5054580650`), rattaché le
1ᵉʳ mai 2026, retouché dans Pennylane le 19 mai (+290 € HT, renuméroté au
passage puisque le mois d'émission a changé).

Ce n'est **pas** une confusion HT/TTC : 7 386 € est bien le total HT
(TVA 5,5 % = 406,25 €, TTC = 7 792,25 €).

### Pourquoi c'est visible

Le cron resynchronise `pdf_url` mais pas le montant. La carte affiche donc un
chiffre d'avril tout en ouvrant un PDF de mai. Si le lien avait été figé lui
aussi, l'écart serait resté invisible.

### Cause technique

`syncAttachedQuoteFields`
([pennylane-sync-quote-status/index.ts:394-399](../../../supabase/functions/pennylane-sync-quote-status/index.ts))
appelle `pennylane_sync_update_quote_fields(p_quote_id, p_new_status, p_pdf_url)`.
La signature ne porte que deux champs mutables. `quote_amount_ht`, `quote_label`
et `quote_date` sont **write-once**, posés au rattachement et jamais revus.

### Portée

Tout devis retouché dans Pennylane après rattachement dérive silencieusement, et
fausse le total de sa colonne. Ce n'est pas propre à FLECHER.

---

## 2. Décision de fond

**Pennylane reste canonical.** Il est impossible d'y figer une modification, et
c'est voulu : Majord'home est un **dashboard**, pas un registre. Les montants
doivent refléter Pennylane.

Corollaire assumé : les statistiques n'ont pas de date de coupe stable — un
montant passé peut changer rétroactivement. C'est le prix du canonical externe.
La contrepartie est l'historique (§4), qui rend chaque évolution traçable.

---

## 3. Sync des champs mutables

Étendre `pennylane_sync_update_quote_fields` à `p_amount_ht`, `p_label`,
`p_quote_date`. L'edge function récupère déjà l'objet Pennylane complet à chaque
cycle : les données sont disponibles, elles sont jetées.

Puis repropager `leads.order_amount_ht` depuis le devis le plus récent, tie-break
`pennylane_quote_id DESC` (même règle qu'au rattachement).

### Un seul champ répare la cascade

`majordhome.lead_quote_stats`
([20260716_2:27-29](../../../supabase/migrations/20260716_2_lead_quote_stats_shared_view.sql))
dérive tout de `quote_amount_ht`. Vérifié sur la carte FLECHER : son
`total_amount` (7096) vient de là. Corriger `quote_amount_ht` répare donc en
cascade le montant de carte, le total de colonne et le montant chantier.

`leads.order_amount_ht` reste nécessaire pour le Dashboard
(`useDashboardData`), la carte Territoire et les leads sans devis Pennylane.

### Point d'attention migration

Ajouter des paramètres crée une **surcharge** de fonction. Il faut `DROP`
l'ancienne signature `(uuid, text, text)`, sinon l'appel devient ambigu.

---

## 4. Historique : `majordhome.lead_quote_revisions`

**Un snapshot par révision détectée**, pas un journal de deltas champ par champ.
L'objectif est de suivre une évolution : `SELECT amount_ht … ORDER BY detected_at`
doit suffire, sans recomposer un état à partir de N lignes.

Par ligne :

- le devis concerné (FK `lead_pennylane_quotes`) + `pennylane_quote_id`
- `detected_at`
- l'état complet après modification : `amount_ht`, `label`, `quote_date`, `quote_status`
- le montant précédent
- `amount_delta` et `amount_delta_pct`, calculés à l'insert
- `source` : `sync` | `initial_reconciliation`
- `anomaly_flags text[]` (§5)

Vue publique `majordhome_lead_quote_revisions` en `security_invoker=true` +
`GRANT SELECT … TO service_role` (règle multi-tenant : sans ce GRANT les edge
functions plantent en `42501` silencieux).

Table `majordhome.*` → RLS activée + policies scopées `org_id` dès la création.

---

## 5. Détection d'incohérence

Calculée **à l'insert**, dans la RPC : c'est le seul moment où le contexte du
lead au moment du changement est disponible.

| Flag | Condition |
|---|---|
| `modified_after_won` | le lead était déjà Gagné (`won_date` non nul) |
| `modified_after_validated` | le devis était déjà `accepted` ou `invoiced` (`quote_status_bucket = 'validated'`) |
| `below_pipeline_threshold` | le nouveau montant passe sous le seuil pipeline |

Définition retenue : **une révision est incohérente quand elle survient après un
point de non-retour** (gagné, accepté, facturé). Le cas FLECHER en est un —
gagné le 29 avril, devis retouché le 19 mai.

Le delta est stocké **brut**, sans seuil en base : le filtrage se fait à la
requête. Pas de constante magique à ré-arbitrer plus tard.

### On flague, on ne corrige jamais automatiquement

Un devis qui tombe sous le seuil reste attaché. Un devis modifié après Gagné
reste Gagné. La correction est un arbitrage humain — même règle que celle déjà
posée sur les chantiers divergents.

---

## 6. Surface UI : aucune nouvelle page

Une ligne dans `lead_activities` à chaque révision :

> Devis D-2026-05137 modifié dans Pennylane : 7 096 € → 7 386 € HT

C'est déjà affiché dans la timeline du lead (`LeadModal`), coût quasi nul. La
table de révisions sert le suivi analytique. Une vue d'alertes viendra si le
besoin se confirme — pas avant.

---

## 7. Premier run : réconciliation initiale

Le premier cycle après déploiement va découvrir d'un coup tous les devis dérivés
et réécrire leurs montants. **Les totaux de colonne vont sauter.** C'est attendu.

Chaque écart constaté crée une ligne de révision marquée
`source='initial_reconciliation'` : le delta est réel, mais sa date est inconnue
— on constate un écart, on n'a pas assisté à la modification. Distinguer cette
source évite un faux pic daté du jour du déploiement dans les stats d'évolution.

---

## 8. Seuil pipeline : 1 000 € → 500 € HT

Demande de l'équipe, embarquée ici. Arbitrage Eric : « le SAV c'est en dessous de
500 €, pas de souci » — et l'équipe veut **aussi voir apparaître les leads** de
la tranche, pas seulement pouvoir y rattacher des devis.

Le seuil n'est pas une constante : **quatre copies sous deux noms**.

| Fichier | Constante | Rôle |
|---|---|---|
| [QuoteCandidatesModal.jsx:45](../../../src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx) | `PIPELINE_MIN_AMOUNT_HT` | filtre le sélecteur de rattachement |
| [pennylane-sync-quote-status:86](../../../supabase/functions/pennylane-sync-quote-status/index.ts) | `PIPELINE_MIN_AMOUNT_HT` | auto-attache aux leads déjà bridgés |
| [pennylane-backfill-quotes:35](../../../supabase/functions/pennylane-backfill-quotes/index.ts) | `LEAD_THRESHOLD_HT` | backfill historique |
| [pennylane-sync-cron:33](../../../supabase/functions/pennylane-sync-cron/index.ts) | `LEAD_THRESHOLD_HT` | **crée des leads** |

Les trois premières filtrent. La quatrième
([pennylane-sync-cron:328](../../../supabase/functions/pennylane-sync-cron/index.ts))
crée un lead en « Devis envoyé » pour chaque client Pennylane dont le plus gros
devis dépasse le seuil : effet de bord bien plus large.

### Séquencement de déploiement

Le volume du lot 500–1 000 € n'est **pas chiffrable depuis la base** : aucun
cache local des devis Pennylane, il faudrait interroger leur API.

Déployer donc en deux temps : les 3 constantes de filtrage d'abord, observer un
cycle, puis celle de création de leads. Zéro code supplémentaire, uniquement un
ordre — et un point d'arrêt si le volume surprend.

### Dette signalée, non embarquée

`CLAUDE.md` impose qu'une valeur de configuration métier soit éditable via
`/settings/organization`. Ce seuil en est une (une autre org n'aura pas le même).
On passe de 4 copies à 4 copies : la dette reste entière. À arbitrer séparément.

---

## 9. Trou de couverture : chantier des devis déjà facturés

`pennylane_sync_ensure_winning_quotes` (cron 15 min) repère les leads ayant un
devis validé sans gagnant désigné et appelle `lead_mark_won_with_quote` → Gagné +
`chantier_status='gagne'` → carte chantier. La chaîne de prépa chantier existe
donc déjà et est automatique.

**Mais elle filtre sur `quote_status = 'accepted'` strictement**, alors que la
colonne Gagné accepte `accepted` **ou** `invoiced` (allowlist
`quote_status_bucket()`). Un devis arrivant déjà facturé donne une carte en
Gagné sans jamais produire de chantier.

Aujourd'hui latent : **3 leads** concernés en base, tous déjà pourvus d'un
chantier par un autre chemin. Les devis actuels passent par `accepted` avant
d'être facturés, donc le cron les attrape au passage.

Le lot 500–1 000 € est de l'**historique déjà facturé** : il arrivera directement
en `invoiced`, sans passer par `accepted`. Le trou devient la norme sur ce lot.

**Correctif** : élargir le SELECT à `IN ('accepted','invoiced')`, aligné sur
l'allowlist existante.

---

## 10. Non-objectifs

- Pas de nouvelle page ni de tableau de bord d'audit
- Pas de correction automatique des incohérences détectées
- Pas d'éjection automatique d'un devis passé sous le seuil
- Pas de passage du seuil en setting d'org (dette §8)
- Pas de refonte du chemin de création de leads du cron

### Détail connu, laissé en l'état

`pennylane-sync-cron` n'utilise pas `lead_attach_quotes_and_send` (patché en
juillet pour le gain immédiat) mais `upsert_pennylane_lead` +
`assign_pennylane_quote_to_lead`, qui ne gagne jamais. Sur ce chemin, gain et
chantier arrivent **au cycle suivant, jusqu'à 15 min après** la création du lead.
Fonctionnel, mais non transactionnel. Documenté pour que le délai ne soit pas
pris pour un bug.

---

## 11. Critère de succès

1. La carte FLECHER affiche **7 386 €** et le devis **D-2026-05137** daté du
   19 mai, en accord avec le PDF qu'elle ouvre.
2. Une ligne existe dans `lead_quote_revisions` pour ce devis, avec
   `amount_delta = 290`, `source = 'initial_reconciliation'` et le flag
   `modified_after_won`.
3. La timeline du lead affiche la ligne de modification.
4. Un lead créé avec un devis déjà `invoiced` obtient son `chantier_status` au
   cycle suivant.
5. `npx vite build` passe.
