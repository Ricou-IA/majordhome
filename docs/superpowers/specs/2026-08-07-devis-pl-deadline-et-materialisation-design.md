# Normalisation des échéances Pennylane + matérialisation des devis

> Spec de design — 2026-08-07. Statut : **validée par Eric, prête pour le plan d'implémentation**.
> Suite de `2026-08-05-devis-pl-non-rattaches-design.md` (explorateur `/devis`, livré).
> Module : Pennylane quote-driven (`docs/MODULE_PENNYLANE.md`).

## 1. Problème

**Le robinet, pas le stock.** Dans Pennylane, la date d'expiration d'un devis est une saisie
manuelle de l'opérateur à la création. Elle est courte et arbitraire : le devis expiré le plus
récent en base a été **émis il y a deux jours**. Un devis peut naître et mourir dans la même
semaine.

Le statut `expired` qui en découle est un pur frottement pour Mayer :

- Il n'a **aucune valeur métier** — Eric ne s'en sert pas comme information commerciale.
- Il **bloque les gestes** : accepter un devis expiré impose de rallonger la date à la main
  *avant* de pouvoir le valider. Idem pour le modifier.
- Il est **non uniforme**, donc inexploitable comme signal : deux devis émis le même jour peuvent
  expirer à des dates sans rapport, selon ce que l'opérateur a tapé.

Allonger la validité par défaut n'est pas possible : c'est une saisie opérateur, et l'imposer dans
le process ajoute de la charge mentale et un champ à corriger systématiquement.

**Objectif** : normaliser l'échéance par API pour qu'elle cesse d'être du bruit et devienne un
signal — `expired` voudra dire exactement « émis il y a plus de 3 mois, jamais converti ».

## 2. Ce que le test a établi (2026-08-07)

Test sur D-2026-05195 (561 € HT), échéance repoussée manuellement au 31/10 dans l'interface
Pennylane, observation via le cron de sync :

| Constat | Conséquence |
|---|---|
| **`expired` est DÉRIVÉ de `deadline`** — `expired → pending` sans toucher au statut | **Un seul `PUT /quotes/{id}`** avec la seule `deadline`. Pas de `update_status`, donc pas de cas « premier appel OK, second échoué » |
| API et interface Pennylane d'accord après le changement | Pas de divergence à gérer côté affichage |
| `quote_date` a suivi : 27/05 → 29/05 dans notre base en un cycle | La dérive de la date d'émission est **réelle et arrive jusqu'à nous** |

Détail crucial découvert au passage : **cliquer « Modifier » dans l'interface Pennylane réinitialise
la date d'émission ET l'expiration à la date du jour.** L'opérateur doit reforcer l'émission. Un
devis retouché change donc de date d'émission à numéro constant.

**Webhooks : piste morte.** Ceux de Pennylane sont en beta fermée et ne poussent que
`dms_file.created`. Le polling est la seule voie possible.

## 3. Décisions arrêtées

| Sujet | Décision |
|---|---|
| Règle | `deadline = date d'émission + 3 mois` |
| Déclenchement | Job périodique. Pas de webhook (indisponible), pas de déclenchement à la création (sans intérêt, cf. §4.1) |
| Fenêtre | **Glissante avec recouvrement**, pas « les devis du jour » |
| Rattrapage | **Oui**, one-shot sur tout le stock |
| Statuts traités | `pending` et `expired` **uniquement**. Jamais `accepted`, `invoiced`, `denied` |
| Dérive de l'émission | **Acceptée** — un devis modifié repart pour 3 mois. C'est un geste humain, pas le cron |
| Fenêtre de l'explorateur | Étendue de 90 jours à **tout l'historique** |
| Source d'affichage | **Table jumelle** matérialisée, alimentée par le job |
| Fraîcheur cible | **5 minutes** sur le chemin critique |
| PDF client | Eric ajoute un champ « Validité du devis : 3 mois » sur le document, ce qui neutralise l'écart entre la date envoyée et celle qu'on posera |

### La règle ne peut pas créer de boucle de renouvellement

`deadline = f(émission)` est une **fonction pure**. Un devis dont l'émission ne bouge pas se voit
poser toujours la même échéance, passage après passage : le job converge et n'écrit qu'une fois par
devis. C'est ce qui distingue cette règle d'un « +3 mois glissants » qui, lui, entretiendrait des
devis zombies indéfiniment.

Le seul cas où l'échéance avance est celui où l'émission avance — donc quand un humain a modifié le
devis. Ce n'est pas le cron qui renouvelle, c'est l'opérateur qui remet le compteur à zéro.

## 4. Architecture

### 4.1 Un seul balayage, trois effets

L'endpoint **LISTE** `/quotes` renvoie tout le nécessaire par item : `deadline`, `status`, `date`,
`quote_number`, `currency_amount_before_tax`, `public_file_url`, `customer`, plus `created_at` /
`updated_at` / `archived_at`. Il est **filtrable par statut** (`status` avec `in` / `not_in`).

Un balayage paginé unique suffit donc à :

1. **Normaliser** — comparer `deadline` à `date + 3 mois`, émettre un `PUT` sur les seuls devis
   divergents.
2. **Matérialiser** — upsert de chaque item dans la table jumelle.
3. **Rafraîchir le statut** des devis rattachés, aujourd'hui obtenu par un `GET` unitaire par devis.

**Pourquoi pas un déclenchement à la création** : rien ne dépend de la latence. Le client reçoit son
PDF à la seconde où le devis part, avec la date saisie par l'opérateur. Normaliser 10 minutes ou
6 heures plus tard ne change rien pour lui — et comme l'opérateur n'allonge jamais volontairement,
la correction va toujours dans le sens de l'extension, donc en sa faveur. Un webhook coûterait un
endpoint public, une vérification de signature et une gestion des rejeux, pour un résultat identique.

### 4.2 Le balayage est moins cher que l'existant

Le cron `pennylane-sync-quote-status` fait aujourd'hui **un `GET /quotes/{id}` par devis rattaché** :
360 devis × 96 passages/jour ≈ **34 000 appels par jour**.

Un balayage par liste (`limit=100`, curseur) ramène les mêmes informations en **~15 appels** par
passage. Soit environ **4 300 appels par jour à 5 minutes de fréquence** — huit fois moins que
l'existant, pour une fraîcheur trois fois meilleure.

C'est ce budget récupéré qui finance la cible de 5 minutes.

### 4.3 Le jumeau est une projection, jamais une seconde vérité

```
job (5 min) ──PUT deadline──> Pennylane
                                 │
              ──GET /quotes?filter=[status]──┘
                                 │
                                 ▼
                     table jumelle (upsert)
                                 │
                                 ▼
                   /devis · carte KPI Dashboard
```

Sens strictement unique : Pennylane → nous. **On n'écrit jamais dans la table jumelle depuis
Majord'home**, sinon elle diverge en silence et plus personne ne sait qui a raison. La seule
écriture vers Pennylane est la deadline.

## 5. La table jumelle

`majordhome.pennylane_quotes` — miroir des devis Pennylane de l'org.

Colonnes : `org_id`, `pennylane_quote_id` (bigint, PK composite avec org_id), `quote_number`,
`label`, `status`, `date` (émission), `deadline`, `amount_ht`, `amount_ttc`, `pdf_url`,
`customer_id`, `customer_name`, `pdf_invoice_subject`, `archived_at`, `pl_created_at`,
`pl_updated_at`, `synced_at`.

Conventions imposées par la charte multi-tenant :

- RLS activée, policies scopées `org_id IN (org_members)`.
- Vue publique `public.majordhome_pennylane_quotes` en `security_invoker = true`, **miroir simple**
  (aucun JOIN/LATERAL — cf. gotcha `majordhome_appointments`).
- `GRANT SELECT ON majordhome.pennylane_quotes TO service_role` (sans quoi les edge functions
  plantent en `42501` silencieux).
- **`REVOKE ALL ... FROM anon`** sur la vue : les nouvelles vues `public.*` héritent des privilèges
  par défaut du schéma, constaté le 2026-08-05 sur `pennylane_quote_dismissals`.
- Écritures réservées au `service_role` (le job) — `authenticated` n'a que `SELECT`.

**Devis disparus côté Pennylane** : le balayage voit l'ensemble courant. Les lignes de la table
absentes du balayage sont marquées, pas supprimées (même logique que `ejected_reason =
'deleted_in_pennylane'` sur les devis rattachés). Une suppression sèche ferait disparaître de
l'historique sans trace.

## 6. Le job

Edge function `pennylane-quotes-sweep`, `verify_jwt:false` + `requireSharedSecret(MDH_CRON_SECRET)`.

Pour chaque org avec `settings.pennylane.enabled` :

1. Paginer `/quotes` (`limit=100`, curseur) filtré sur les statuts utiles.
2. Pour chaque item : upsert dans la table jumelle avec `synced_at = now()`.
3. Si `status ∈ (pending, expired)` **et** `deadline ≠ date + 3 mois` → `PUT /quotes/{id}`
   avec `{ deadline }`, puis refléter la nouvelle valeur dans la table.
4. Marquer les lignes non revues comme absentes de Pennylane.

**Bornes et garde-fous :**

- `pLimit(5)` sur les `PUT` — rate limit Pennylane V2 = 25 req/5 s.
- Une erreur sur un devis ne casse pas le lot (chaque `PUT` isolé).
- Le nombre de `PUT` émis est **logué à chaque passage**. En régime établi il doit tomber à
  quasi-zéro ; un chiffre qui reste élevé signale que la règle ne « prend » pas.
- **Entrée `cron.job` créée dans la migration**, pas seulement décrite. Ce projet a déjà vécu un
  cron documenté « toutes les 15 minutes » resté deux jours sans planification réelle.

## 7. Rattrapage

Le rattrapage n'est **pas un traitement à part** : c'est le premier passage du job, qui voit
naturellement tout le stock puisque le balayage n'a pas de fenêtre temporelle (l'API ne propose pas
de filtre par date).

**Impact mesuré sur les devis rattachés en base** (le stock Pennylane complet, orphelins compris,
est plus large) :

| Effet | Devis | Montant HT | Émission |
|---|---|---|---|
| Repasse en `pending` | 87 | 593 669 € | 11/05 → 05/08 |
| Reste `expired` | 16 | 177 657 € | 06/03 → 29/04 |

**Conséquence visuelle à anticiper** : les 593 669 € correspondent exactement au total de la colonne
Expiré actuelle de l'explorateur. Sur la fenêtre 90 jours, cette colonne **tomberait donc à zéro**.
C'est précisément pour cela que la fenêtre passe à tout l'historique (§8) : le bac Expiré ne
retrouve son sens qu'en montrant les devis réellement anciens.

## 8. Bascule de l'explorateur

`useQuotesExplorer` lit la table jumelle au lieu de scanner Pennylane. Changement de source dans un
seul hook — `DevisExplorer`, `QuoteExplorerCard`, la carte KPI et les trois modales ne bougent pas.

Ce que ça débloque :

- **Tout l'historique** au lieu de 90 jours. Le scan direct plafonnait à 1000 devis par ouverture de
  page (10 pages × 100) ; au-delà l'affichage devenait partiel.
- **Tri par ancienneté** gratuit, donc l'explorateur peut enfin devenir une file de relance et plus
  seulement un outil de réconciliation.
- Ouverture de page instantanée (une requête SQL au lieu de 15-20 appels API).

`getQuotesExplorer` disparaît du service : le filtrage métier reste dans le module pur
`src/lib/quotesExplorer.js`, qui prend désormais ses lignes de la base. Les 12 tests existants
restent valides — le module ne sait pas d'où viennent ses données.

## 9. La panne muette, et sa parade

**C'est le vrai risque de la matérialisation.** Aujourd'hui, si Pennylane est injoignable, la page
affiche une erreur : la panne est visible. Avec une table, un job arrêté fait afficher des données
périmées **avec assurance** — l'utilisateur lit « pas de nouveaux devis » là où il faudrait lire
« je ne sais plus ».

Parade, obligatoire dans la livraison : `synced_at` est stocké, et la page **affiche la fraîcheur**.
Un bandeau « dernière synchronisation il y a 3 jours » rend la panne évidente en une seconde. Sans
ce bandeau, la matérialisation est une régression de fiabilité déguisée en gain de performance.

## 10. Impacts sur l'existant

- **Chemin critique inchangé.** Le passage devis validé → lead Gagné → chantier continue de passer
  par `lead_pennylane_quotes` et `lead_mark_won_with_quote`. La matérialisation ne remplace que la
  liste affichée dans l'explorateur. Aucune régression de latence pour les commerciaux ; la cible
  passe même de 15 à 5 minutes.
- **`pennylane-sync-quote-status`** : à terme son `GET` unitaire par devis fait doublon avec le
  balayage. **Ne pas le fusionner dans ce chantier** — il porte aussi la sync d'identité client, le
  gain automatique et l'auto-attache. Consolidation à traiter séparément, une fois le balayage
  éprouvé en production.
- **Table de révisions de devis** (livrée en parallèle) : vérifier qu'un changement de `deadline` ne
  déclenche pas une révision parasite. Le job en émettra quelques centaines au premier passage.

## 11. Hors scope

- Fusion du cron de sync existant dans le balayage (cf. §10).
- Tri et signalement d'ancienneté dans l'UI — débloqués par ce chantier, mais c'est une autre
  livraison.
- Toute écriture Pennylane autre que `deadline`.
- Figer la date d'émission côté MDH pour la protéger de la dérive : explicitement écarté par Eric,
  la dérive est un comportement acceptable.

## 12. À vérifier pendant l'implémentation

- **`draft` n'apparaît pas** dans l'énumération de statuts filtrables documentée par Pennylane
  (`accepted, denied, expired, invoiced, pending`), alors que notre code et
  `majordhome.quote_status_bucket()` le référencent. Constater ce que l'API renvoie réellement avant
  de figer le filtre du balayage.
- Volume réel du stock Pennylane complet — inconnu à ce jour, notre base ne remonte qu'au
  25/02/2026 (date de mise en service du pont, pas l'ancienneté du compte). Dimensionne le premier
  passage.

## 13. Références

- `docs/superpowers/specs/2026-08-05-devis-pl-non-rattaches-design.md` — l'explorateur
- `docs/MODULE_PENNYLANE.md` — règles du bridge, allowlists, gotchas API V2
- [List quotes](https://pennylane.readme.io/reference/listquotes) · [Update a quote](https://pennylane.readme.io/reference/updatequote) · [Update status](https://pennylane.readme.io/reference/updatestatusquote)
