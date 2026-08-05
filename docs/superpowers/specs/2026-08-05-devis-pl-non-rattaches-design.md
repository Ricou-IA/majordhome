# Explorateur de devis Pennylane — détection des devis non rattachés

> Spec de design — 2026-08-05. Statut : **validée par Eric, prête pour le plan d'implémentation**.
> Module concerné : Pennylane quote-driven (`docs/MODULE_PENNYLANE.md`).

## 1. Problème

Les devis sont réalisés dans Pennylane, puis rattachés manuellement à une fiche lead du pipeline
(`majordhome.lead_pennylane_quotes`). Ce rapprochement est **100 % humain** par décision produit
(invariant « Devis envoyé exige ≥1 devis PL rattaché », 2026-06-10). Rien ne surveille les oublis.

Conséquence : un devis créé dans Pennylane sans passer par Majord'home n'existe nulle part dans le
pipeline. Le CA en cours est sous-estimé, le lead n'est jamais relancé, et personne ne le sait —
c'est un **échec silencieux**, la pire catégorie.

Besoin : un outil qui rend visibles les devis non rattachés et permet de les traiter.

## 2. Ce qui existe déjà

La détection est **déjà codée et jamais branchée** :

| Élément | Fichier | État |
|---|---|---|
| `getUnlinkedQuotes(orgId, {sinceDays, limit})` | `pennylane.service.js:1364` | Consommé par `QuoteCandidatesModal` (section Exploration 60 j) |
| `countUnlinkedQuotes(orgId, {sinceDays, softCap})` | `pennylane.service.js:1455` | **Aucun consommateur** |
| `useUnlinkedQuoteCount()` | `usePennylane.js:454` | **Aucun consommateur** — commentaire : « voyant de discipline (Dashboard + Pipeline header, org_admin only) » |

Le voyant a été spécifié en PR 8 du bridge Pennylane puis jamais posé. Le présent chantier n'invente
donc pas la détection : il l'expose, la rend actionnable, et la rend **tenable dans la durée**.

Autres briques réutilisées telles quelles :

- `KanbanBoard` (`components/shared/KanbanBoard.jsx`) — mode statique sans DnD, colonnes
  configurables, cumul € par colonne, `renderCard`, recherche intégrée.
- `lead_attach_quotes_and_send` via `useAttachQuotesAndSend` — **forward-only** (garde
  `display_order < 4`, cf. `20260524_lead_attach_quotes_round_and_tiebreak.sql:179`) : rattacher un
  devis à un lead déjà Gagné ne le rétrograde pas. Déclenche aussi `ensureClientForLeadFromPennylane`.
- `fetchCustomerById` + `buildContactPatchFromCustomer` pour pré-remplir un lead depuis un customer PL.
- `QUOTE_STATUS_CONFIG` (`QuoteCandidatesModal.jsx:47`) — libellés + couleurs statut, déjà deutan-safe.

**Aucune nouvelle RPC n'est nécessaire.**

## 3. Périmètre retenu

Arbitrages validés avec Eric le 2026-08-05 :

| Sujet | Décision |
|---|---|
| Seuil montant | Même seuil que le pipeline (`PIPELINE_MIN_AMOUNT_HT`). Passe à 500 € dans un chantier séparé. |
| Statuts affichés | `pending`, `expired`, `accepted`, `invoiced`. **`draft` exclu.** |
| Fenêtre | 90 jours glissants sur la date du devis PL. |
| Emplacement | Carte KPI Dashboard → page `/devis`, présentation en cartes type kanban. |
| Gestes | Rattacher · Créer le lead · Écarter. |
| Écartement | Persisté (nouvelle table), réversible, **disponible en lot**. |
| Miroir « leads sans devis » | **Hors scope** — déjà signalé par le flag ambre « Devis à rapprocher » sur les cartes. |
| Audience | `org_admin` uniquement. Pennylane ne porte pas de commercial sur les devis : un orphelin n'est attribuable à personne. |
| Fraîcheur | **Live** à l'ouverture. Volumétrie estimée < 500 devis / 90 j, pas de cron de matérialisation. |

## 4. Architecture

### 4.1 Donnée — un seul scan, les deux côtés

`getUnlinkedQuotes` pagine déjà `/quotes`, puis **jette** les devis rattachés. On généralise :

```
getQuotesExplorer(orgId, { sinceDays = 90 })
  → [{ …champs devis PL…, lead_id, lead_name, is_dismissed }]
```

- Le scan paginé `/quotes` (plafond `MAX_PAGES = 10`, soit 1000 devis) est **identique** à l'existant :
  garder les devis rattachés ne coûte **aucun appel Pennylane supplémentaire**.
- Le rattachement vient d'une requête locale sur `majordhome_lead_pennylane_quotes`
  (`org_id`, `ejected_at IS NULL`), le nom du lead d'une seconde requête sur `majordhome_leads`
  (`id, first_name, last_name`).
- L'écartement vient de la nouvelle vue `majordhome_pennylane_quote_dismissals`.
- Les noms clients passent par `resolveCustomerNames` (cache-first, déjà borné) — la LISTE `/quotes`
  n'embarque que `customer.id`.

`getUnlinkedQuotes` **est conservé** comme filtre trivial par-dessus `getQuotesExplorer`, pour que
`QuoteCandidatesModal` ne soit pas touchée.

### 4.2 Filtres

Appliqués dans le service, pas dans le JSX :

1. `amount_ht >= PIPELINE_MIN_AMOUNT_HT`
2. `status ∈ EXPLORER_QUOTE_STATUSES`
3. date du devis dans les 90 derniers jours
4. selon la vue active (§5.2) : écartés masqués, ou seuls les écartés

> **`EXPLORER_QUOTE_STATUSES = ['pending', 'expired', 'accepted', 'invoiced']` n'est PAS une copie de
> `majordhome.quote_status_bucket()`.** Les buckets DB répondent à « ce devis est-il validé / en cours /
> refusé ? ». Cette allowlist-ci répond à « ce devis matérialise-t-il une opportunité commerciale
> réelle ? ». `draft` (brouillon jamais envoyé) appartient au bucket `pending` mais **n'est pas une
> anomalie de rapprochement** — il est donc exclu ici et pas là-bas. Cette divergence est **voulue** :
> le commentaire dans le code doit le dire, sinon un futur lecteur la prendra pour une copie corrompue
> et « corrigera » en réintroduisant `draft`.

### 4.3 Compteur et page = une seule requête

Le compteur de la carte KPI et la page consomment **la même `queryKey`** (`pennylaneKeys.quotesExplorer(orgId, sinceDays)`, `staleTime` 15 min).

Rationale : un compteur calculé séparément dérive **toujours** des filtres de la liste — la carte
afficherait 12, la page 5, et le voyant perdrait toute crédibilité. Le projet s'est déjà fait piéger
plusieurs fois par des allowlists recopiées (chantiers vs pipeline, cf. `MODULE_PENNYLANE.md`).
Une seule source, pas de divergence possible.

Conséquence : `countUnlinkedQuotes` et `useUnlinkedQuoteCount` deviennent définitivement morts et
sont **supprimés** (règle « code mort » du CLAUDE.md).

### 4.4 Constante de seuil

`PIPELINE_MIN_AMOUNT_HT` est aujourd'hui **déclarée dans un composant** (`QuoteCandidatesModal.jsx:45`)
et **recopiée en dur** dans l'edge du cron (`pennylane-sync-quote-status/index.ts:86`). L'explorateur
serait le 3ᵉ consommateur.

→ Elle remonte dans `src/lib/constants.js`, et les deux consommateurs front l'importent.

**Limite assumée** : l'edge function Deno ne peut pas importer `src/lib/`. Sa copie subsiste, et le
passage 1000 € → 500 € devra la modifier à la main. Un commentaire croisé est posé aux deux endroits
pour rendre la dépendance visible.

## 5. Interface

### 5.1 Carte KPI Dashboard

5ᵉ carte « Devis non rattachés », affichée **seulement** si `isOrgAdmin && pennylane.enabled`.
Le grid KPI passe de `lg:grid-cols-4` à `lg:grid-cols-5` quand elle est visible. Clic → `/devis`.

### 5.2 Page `/devis`

Route lazy dans `artisanRoutes`, `RouteGuard resource="pipeline"` + garde `isOrgAdmin` in-component
(`<Navigate to="/" replace />`), même pattern qu'`OrganizationSettings`.

`KanbanBoard` en **mode statique** — pas de drag & drop : déplacer une carte ne changerait rien dans
Pennylane, et un geste sans effet est pire qu'une absence de geste.

Colonnes, cumul € HT en tête de chacune :

| Colonne | Statut PL |
|---|---|
| En attente | `pending` |
| Expiré | `expired` |
| Accepté | `accepted` |
| Facturé | `invoiced` |

Carte : n° de devis · nom client · montant HT · date · lien PDF (`pdf_url`, **grisé + tooltip**
si absent — ne jamais construire d'URL `app.pennylane.com/quotes/{id}` à la main) · pastille
« Orphelin » ou nom du lead rattaché.

En-tête : sélecteur de vue à 3 positions + recherche texte (fournie par `KanbanBoard`).

| Vue | Contenu |
|---|---|
| **Orphelins** (défaut) | Non rattachés **et** non écartés — la liste de travail. |
| **Tous** | Rattachés + non rattachés, écartés exclus. Sert à vérifier un chiffre qui surprend. |
| **Écartés** | Uniquement les écartés — sans elle, un écartement par erreur ne serait rattrapable qu'en SQL. |

### 5.3 Gestes

Sur les cartes **orphelines** :

| Geste | Mécanique |
|---|---|
| **Rattacher** | Recherche d'un lead existant → `useAttachQuotesAndSend` (existant). Forward-only, déclenche la matérialisation client. |
| **Créer le lead** | Contact pré-rempli depuis `fetchCustomerById` ; l'admin choisit **uniquement** le commercial ; création du lead puis même RPC d'attache → le lead naît en « Devis envoyé » avec son devis. |
| **Écarter** | Confirmation → insert dismissal. Sélection multiple → **écartement en lot**. |

Sur les cartes de la vue **Écartés** :

| Geste | Mécanique |
|---|---|
| **Réintégrer** | Delete de la ligne dismissal → le devis retourne dans Orphelins. |

Pas de rattachement en lot : chaque devis va vers un lead différent, l'opération n'a pas de sens groupée.

**Pourquoi l'écartement en lot est en V1 et non en V2** : au premier lancement, la liste contiendra
90 jours d'historique jamais rapproché — probablement plusieurs dizaines de cartes. Si chaque
écartement coûte un clic unitaire, l'outil est abandonné avant d'être adopté.

## 6. Migration

`supabase/migrations/20260805_1_pennylane_quote_dismissals.sql`

```sql
CREATE TABLE majordhome.pennylane_quote_dismissals (
  org_id             uuid        NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pennylane_quote_id bigint      NOT NULL,   -- aligné sur lead_pennylane_quotes.pennylane_quote_id
  reason             text,
  dismissed_by       uuid,
  dismissed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, pennylane_quote_id)
);
```

- RLS activée + policies CRUD scopées `org_id IN (SELECT org_id FROM core.organization_members WHERE user_id = auth.uid())`.
- Vue publique `public.majordhome_pennylane_quote_dismissals` `WITH (security_invoker = true)` —
  **miroir simple, donc updatable** : insert/delete directs via PostgREST, pas de RPC.
- `GRANT SELECT ON majordhome.pennylane_quote_dismissals TO service_role` (règle CLAUDE.md : sans ce
  GRANT, toute edge function lisant la vue plante en `42501` silencieux).
- Réversibilité : un devis écarté par erreur se récupère en supprimant la ligne.

## 7. Gestion des erreurs

| Cas | Comportement |
|---|---|
| Pennylane injoignable / proxy 5xx | Carte KPI masquée (pas de « 0 » mensonger), page en état d'erreur explicite avec bouton Réessayer. |
| Scan tronqué (`MAX_PAGES` atteint) | Bandeau « affichage partiel — N devis analysés » plutôt qu'une troncature silencieuse (règle « pas de cap muet »). |
| `pdf_url` absent | Lien grisé + tooltip « PDF non synchronisé (prochain cycle < 15 min) ». |
| Rattachement échoué | Toast d'erreur, carte conservée dans la colonne, aucune invalidation de cache. |
| Org sans Pennylane | Carte KPI absente, route `/devis` redirige vers `/`. |

## 8. Vérification

Critère de succès : `npx vite build` passe + `npm run lint:errors` propre + parcours manuel par Eric
(carte KPI ↔ page cohérentes, les 3 gestes aboutissent, un écarté disparaît et se récupère).

Pas de test automatisé : la logique est un filtre sur une API tierce, sans module pur isolable
justifiant un harness dédié.

## 9. Hors scope

- Miroir « leads en Devis envoyé sans devis PL » (déjà couvert par le flag ambre sur les cartes).
- Vue par commercial (impossible : Pennylane ne porte pas de commercial sur les devis).
- Cron de matérialisation en base (volumétrie trop faible pour le justifier).
- Refonte de `QuoteCandidatesModal`.
- Décomposition de `pennylane.service.js` (1778 LOC, dette identifiée, > 700 LOC réglementaires) —
  **à signaler, pas à embarquer** (Posture #3). L'explorateur ajoute ~50 LOC nettes à ce fichier.

## 10. Références

- `docs/MODULE_PENNYLANE.md` — règles du bridge, allowlists, gotchas API PL V2
- `docs/superpowers/specs/2026-05-23-pipeline-pennylane-bridge-design.md` — spec bridge (PR 8 = le voyant jamais posé)
- `CLAUDE.md` § Module Pennylane quote-driven, § Conventions qualité
