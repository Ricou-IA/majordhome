# Refonte intégration MDH ↔ Pennylane — diagnostic + refacto

> **Scope élargi (2026-05-25 update)** : initialement centré sur la modale
> "Rattachement devis", étendu après identification de 3 bugs symptomatiques
> du même socle d'intégration PL non complet (devis anciens, clients PL
> introuvables, latence). Voir Vision section.

> **Statut** : à exécuter dans une session dédiée. Plusieurs hotfixes ont été
> empilés et il faut maintenant une vision d'ensemble + refonte ciblée.
> **Créé** : 2026-05-25 — branche `main`.

## Contexte projet
Projet : Frontend Majord'home (`C:\Dev\Frontend-Majordhome`, branche `main`).
Stack : React 18 + Vite + Supabase + edge functions Deno + Pennylane V2 API via proxy edge function.

Lis d'abord `CLAUDE.md` à la racine — notamment les sections "Sprint 9 — Pennylane",
"Multi-tenant & sécurité", "Gotchas DB", et "Edge functions".

## Feature concernée
**Modale "Passer en Devis envoyé"** sur le Pipeline (Kanban Leads).
Quand l'user fait passer un lead en "Devis envoyé" via DnD ou bouton, une
modale s'ouvre (`QuoteCandidatesModal.jsx`) qui doit :

1. **Section Suggestions** : proposer les devis Pennylane "qui ont l'air de
   correspondre à ce lead" (matching fuzzy sur bridge client_id, email,
   téléphone, nom).
2. **Section Exploration manuelle** : lister TOUS les devis PL non rattachés
   des N derniers jours, avec recherche textuelle (nom client, n° devis).

L'user coche des devis et "Attache la sélection" → ils sont liés au lead via
`majordhome.lead_pennylane_quotes` + le lead bascule en "Devis envoyé".

## Symptômes (accumulés au fil de l'eau, plusieurs hotfixes empilés)

1. **Latence forte à l'ouverture de la modale** (plusieurs secondes)
2. **Beaucoup d'erreurs 500 sur `pennylane-proxy`** dans la console
   (Internal Server Error sur les requêtes vers PL)
3. **Recherche manuelle ralentie aussi** depuis la dernière modif
   (la section Exploration est devenue laggy)
4. **Bug : devis anciens jamais rattachés** — exemple SYLVIE ANE (client lié
   CLI-03438) : la modale n'a attaché qu'1 devis (D-2026-05151) alors que ce
   client a d'autres devis PL plus anciens qui devraient être rattachés. La
   fenêtre temporelle limite le bridge match — si on bridge sur un client_id
   connu, on devrait fetch TOUS ses devis sans contrainte de date.
5. **Bug : clients PL non importés introuvables côté UI** — exemple ROGERO
   (CHRISTIANE ROGERO existe dans Pennylane avec devis) : recherche
   "CLIENT EXISTANT" sur création de lead ne le trouve pas, parce qu'elle
   interroge uniquement `majordhome.clients` (table locale MDH) sans
   fallback PL. PL est devenu source de vérité parallèle non syncée vers
   MDH. Symptôme du même problème de fond que #4.
6. **Bug : attacher un devis PL ne sync pas les infos contact** — suite du
   cas ROGERO : lead créé, devis D-2026-05185 attaché (1897€). La modale
   indique "Données synchronisées depuis Pennylane — à modifier dans
   Pennylane" mais TOUS les champs contact (prénom, téléphone, email,
   adresse, CP, ville) restent vides. La RPC `attachQuotesAndSendLead`
   attache le devis mais n'aspire pas les coordonnées du customer PL pour
   alimenter le lead. Le hint UI est mensonger : il prétend que les
   données viennent de PL alors qu'elles ne sont jamais récupérées.
7. **Bug : chip "devis attaché" absent sur la carte Kanban** — exemple
   FEDERATION (Gagné, 1 devis attaché D-2026-0371 avec badge "🏆 Gagnant"
   en modale) : la carte Kanban n'affiche AUCUN chip de devis (devis_count
   manquant). Diagnostic : le `quote_status` stocké dans
   `lead_pennylane_quotes` pour ce devis n'est probablement pas dans
   l'allowlist de la vue `majordhome_kanban_cards` (qui ne reconnaît que
   pending/draft/accepted/refused/denied/expired/canceled). Conséquences
   en cascade :
     - Aucune carte créée par les COUNT FILTER de la vue
     - Le fallback "classic" est skippé car EXISTS dans lqs
     - → Aucune carte du tout pour ce lead dans `majordhome_kanban_cards`
     - → LeadKanban tombe sur le fallback synthétique (`card: null`)
     - → Carte visible dans la colonne via `lead.status_id` MAIS sans chip
   De plus, double source de vérité non synchronisée : `is_winning_quote`
   (booléen UI) vs `quote_status` (view). Le badge "Gagnant" reste affiché
   alors que la carte Kanban dit autre chose.
8. Précédemment : suggestions vides systématiquement (fixé par 406→majordhome_leads
   + ajout matcher "nom" + fallback embedded customer)

## Vision : ressouder MDH ↔ Pennylane

Tous les bugs #1-#7 dérivent du même socle fragile : MDH consomme Pennylane
en best-effort, à la demande, sans cache ni sync structurée. Résultat :
- Lectures massives à chaque ouverture de modale (latence, 500)
- Connaissance partielle de la donnée PL côté UI (clients/devis manquants)
- Pas de search côté serveur (filtre tout en mémoire après pagination)
- Données dupliquées à saisir manuellement (contact lead non pré-rempli même
  quand un devis PL avec customer complet est attaché)
- Hints UI mensongers ("synchronisé depuis PL" alors que rien ne l'est)

La refonte devrait probablement introduire une **couche de cache/mirror
PL en DB** (alimentée par sync incrémental + on-demand refresh), pour que
toutes les recherches/matchings interrogent **la DB MDH** au lieu de PL
direct. PL devient la source d'écriture, MDH le miroir local de lecture.

Et surtout : **l'attachement d'un devis PL doit déclencher une cascade de
sync** (customer PL → lead.first_name/email/phone/adresse + optionnel
création/liaison majordhome.client). Pas seulement créer la ligne
`lead_pennylane_quotes` et basculer le statut.

## Fichiers en jeu

### Frontend
- `src/apps/artisan/components/pipeline/QuoteCandidatesModal.jsx` — la modale
- `src/apps/artisan/components/pipeline/LeadModal.jsx` — déclencheur + affichage
  des devis déjà attachés (LinkedQuotesPanel)
- `src/shared/hooks/usePennylane.js` — hooks React Query :
  - `useCandidateQuotesForLead(leadId)` — section Suggestions
  - `useUnlinkedQuotes({ sinceDays, limit })` — section Exploration
  - `useLinkedPennylaneQuotes(leadId)` — devis déjà attachés
- `src/shared/services/pennylane.service.js` — service appelant le proxy :
  - `getCandidateQuotesForLead()` — appelée par useCandidateQuotesForLead
  - `getUnlinkedQuotes()` — appelée par useUnlinkedQuotes
  - `fetchCustomersByIds()` — fetch parallèle de N customers PL

### Backend / DB
- Vue publique `public.majordhome_lead_pennylane_quotes`
- Table `majordhome.lead_pennylane_quotes` (N:N leads ↔ devis PL)
- Table `majordhome.pennylane_sync` (mapping local_id ↔ pennylane_id)
- Edge function `supabase/functions/pennylane-proxy/` — hardened P0.3
  (allowlist endpoints, membership check, DELETE/PATCH bloqués)

## Hotfixes déjà appliqués (NE PAS REFAIRE)

Voir `git log --oneline | grep -iE "pennylane|pipeline"` pour la liste précise.
En résumé sur les derniers commits :

- **`523f60e`** fix : `.schema('majordhome').from('leads').single()` → 406.
  Remplacé par `.from('majordhome_leads').maybeSingle()` (vue publique).
  → **Important : le schema `majordhome` N'EST PAS exposé via PostgREST.**
- **`8fdc005`** fix : fallback `customer = customersById.get(key) || q.customer` (si
  fetchCustomersByIds échoue silencieusement on a au moins le customer embedded)
- **`dccb197`** feat : ajout matcher "nom" (4ème signal de matching) avec strict
  + fullName fallback, case/accent insensible
- **`80a3bdb`** refactor : pattern déclaratif `matchers = [{ name, check(ctx) }]`
  (ajouter un signal = 1 entrée dans le tableau)
- **`fd150f9`** feat : filtre devis < 1000€ HT (= SAV/entretien, hors pipeline)
- **`267e7ee`** perf : fenêtre Suggestions 90j → 30j (réduit nb de devis scannés)
  → **mais cause maintenant le bug #4** (devis anciens jamais rattachés)

## Root cause probable (à valider par mesure)

À CHAQUE ouverture de la modale, deux appels lourds :

### A) Suggestions (`getCandidateQuotesForLead`)
1. Paginate `/quotes` Pennylane via proxy (jusqu'à 10 pages × 100 = 1000 devis)
2. Pour chaque devis avec customer, fetch `/customers/{id}` **en parallèle illimité**
   via `fetchCustomersByIds` → potentiellement 50-100 requêtes proxy concurrentes
3. Apply matchers (bridge / email / phone / nom)

### B) Exploration (`getUnlinkedQuotes`)
1. Idem paginate `/quotes`
2. Fetch `/customers/{id}` aussi en parallèle illimité pour récupérer les noms à
   afficher dans la liste

**Le proxy Pennylane répond 500 quand il est surchargé** (rate limit PL ou
timeout interne). Les requêtes échouées tombent sur le fallback embedded customer,
donc fonctionnellement ça passe mais la latence et le bruit console sont énormes.

**De plus** : ouvrir la modale fetch les DEUX (Suggestions + parfois Exploration).
React Query cache 30s mais ça ne suffit pas si l'user ferme/rouvre.

**Bug #4 spécifique** : la pagination /quotes triée par date desc + fenêtre 30j fait
qu'on rate les devis anciens d'un client bridgé. **Quand on a un bridgeCustomerId,
il faut fetch `/quotes?customer_id={bridgeCustomerId}` directement** (sans contrainte
de date) pour récupérer TOUS ses devis. C'est aussi plus rapide.

## Constraints à respecter

- **Multi-tenant** : tout filtrer par `org_id` explicite (défense en
  profondeur, même avec RLS via `security_invoker`)
- **Edge function `pennylane-proxy` est hardened P0.3** : membership check +
  endpoints en allowlist + DELETE/PATCH bloqués. NE PAS contourner.
  Vérifier que `/quotes?customer_id=...` est dans l'allowlist du proxy.
- **Schema `majordhome` non exposé via PostgREST** : pour lire depuis le
  frontend, utiliser `from('majordhome_*')` (vues publiques), pas `.schema()`.
- **PR/changement** : passer le pre-commit `npm run lint:errors` (ESLint propre).
  Pas de console.log laissés en prod (logger no-op disponible : `@lib/logger`).
- **UX** : la modale doit rester réactive — pas de spinner > 2s à l'ouverture.

## Ce qu'on veut comme résultat

1. **Diagnostic clair** des goulots (Network tab + timing) en premier — ne pas
   patcher avant d'avoir mesuré.
2. **Refonte ciblée** plutôt que hotfix de plus. Options à explorer (à arbitrer
   après diagnostic) :
   - **Bridge match prioritaire** : quand on a un bridgeCustomerId, appeler
     `/quotes?customer_id={id}` directement (1 requête, pas de pagination,
     tous les devis du client). C'est le fix du bug #4 + gain perf.
   - **Cache local en DB** des devis PL (table `majordhome_pennylane_quotes_cache`
     alimentée par un cron + refresh on-demand) → la modale n'appelle plus PL
     directement, tape la DB qui est froide et rapide.
   - **Concurrency limit** sur fetchCustomersByIds (batch de N parallèles,
     p-limit ou équivalent) → réduit la surcharge proxy.
   - **Skip fetch /customers/{id} quand pas nécessaire** (lead sans email/phone →
     bridge+nom suffisent via embedded q.customer).
   - **Recherche serveur-side** : si PL permet `?search=`, déléguer le filtrage.
   - **Pre-warm + React Query staleTime plus long** sur Exploration (les devis
     non rattachés changent rarement, 5 min staleTime acceptable).
3. **Mesure avant/après** : nombre de requêtes proxy par ouverture, latence
   modale ouverte → 1ère suggestion visible.
4. **Pas de régression fonctionnelle** :
   - Le matching ROMAIN AMALRIC actuel doit continuer à remonter (test manuel)
   - Le bug SYLVIE ANE (devis anciens) doit être résolu : tous les devis du
     client bridgé apparaissent en Suggestions, sans fenêtre temporelle
5. **Garder les hotfixes valides** (406 fix, matcher nom, refacto déclarative,
   filtre <1000€) — ne pas régresser.

## Méthode recommandée

1. Lance le projet (`npm run dev`), ouvre DevTools Network tab
2. Reproduis : pipeline → lead nouvellement créé (sans client_id, avec
   nom/téléphone) → clique "Devis envoyé"
3. Compte les requêtes au proxy, leur durée, les 500
4. Reproduis aussi le cas SYLVIE ANE (lead avec client_id bridgé) pour vérifier
   le bug #4
5. **Brainstorme** (skill `superpowers:brainstorming` si dispo) l'approche avant
   de coder — explore les options ci-dessus
6. Présente le diagnostic + 2-3 options chiffrées (latence attendue, complexité,
   risque) avant d'implémenter
7. Implémente l'option choisie en TDD si possible, sinon avec tests manuels
   listés
8. Commit logique par logique (pas un mega-commit)
9. Avant push : `npm run audit:quality` (lint:errors + dead-code)

## Données utiles pour le diagnostic

- Org Mayer (seule org active aujourd'hui) :
  `org_id = 3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`
- **Lead test A** : AMALRIC ROMAIN (créé 25 mai 2026) — sans client_id, doit
  matcher 6 devis PL via Bridge + Tél + Nom
- **Lead test B** : SYLVIE ANE — client lié CLI-03438. Doit faire remonter
  TOUS les devis PL de ce client (pas seulement les 30 derniers jours)
- **Cas test C** : recherche "rogero" dans CLIENT EXISTANT à la création d'un
  lead. CHRISTIANE ROGERO existe dans PL mais pas (encore) dans
  `majordhome.clients` → doit être proposée quand même (fallback search PL
  ou pré-sync), avec import à la sélection.
- ~3300 clients en DB, ~666 contrats actifs/expirés
- Pennylane API V2 : doc https://pennylane.readme.io/reference/

## Bonus si temps

- Le voyant "devis PL non rattachés" sur Dashboard utilise `countUnlinkedQuotes`
  qui appelle aussi `getUnlinkedQuotes` avec `limit:500` → ça peut aussi être
  une source de latence à inspecter.
- React Query keys à revoir : `pennylaneKeys.linkedQuotesByLead(orgId, leadId)`
  existe, mais y a-t-il une key équivalente pour les candidates/unlinked ? Si
  oui, ajuster `staleTime` peut suffire pour 80% du gain.
