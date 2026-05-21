# Sprint refonte Pennylane sync — quote-driven

> Prompt pour démarrer une nouvelle session Claude Code dédiée. À copier-coller tel quel.

---

## Contexte

Voir `CLAUDE.md` (stack + conventions) et `MEMORY.md` (préférences inter-sessions).
Voir aussi `docs/SYNC_DEDUP_DIAGNOSIS.md` pour l'historique de la cure DB du 2026-05-01.

## Logique métier (à intégrer)

1. **Tous les devis sont créés dans Pennylane** (pas dans MDH).
2. **L'origine d'un client Pennylane = la création d'un devis** par l'utilisateur (qui peut bypasser MDH).
3. **L'unité de tracking est le DEVIS, pas le customer.** Pour chaque devis Pennylane, il faut :
   - Trouver/créer le client MDH (via customer Pennylane)
   - Trouver/créer le lead approprié pour ce client
   - Attacher le devis au lead

Modèle relationnel :
- 1 client Pennylane = 1 client MDH
- 1 client MDH peut avoir N leads (1 par projet)
- 1 lead MDH peut avoir N devis (variantes du même projet)
- L'utilisateur trie manuellement les variantes via UI (RPCs `assign_pennylane_quote_to_lead` / `eject_pennylane_quote`)

## État actuel après session 2026-05-01

### DB (déjà créé)
- `majordhome.dedup_candidates` + `majordhome.dedup_merge_history` (cure clients faite : 29 fusions)
- `majordhome.client_creation_audit` (audit log des créations clients)
- `majordhome.lead_pennylane_quotes` (N:N leads ↔ devis Pennylane)
- Vue publique `public.majordhome_lead_pennylane_quotes`
- 127 devis attachés à 90 leads (962K€ HT) via backfill

### RPCs (déjà créés)
- `public.find_or_create_client(...)` — matching email + phone/nom + lookup leads + fuzzy detect (flag dans `dedup_candidates`)
- `public.upsert_pennylane_lead(...)` — find by email/phone, create si absent, protection statuts terminaux
- `public.assign_pennylane_quote_to_lead(p_org_id, p_quote_pl_id, p_target_lead_id, p_quote_data)` — déplacement / création
- `public.eject_pennylane_quote(p_org_id, p_quote_pl_id, p_reason)` — retrait soft (`ejected_at`)

### Edge Functions Supabase (déjà déployées)
- `pennylane-sync-cron` v14 — itère sur **NEW customers** (limité, ne traite pas les nouveaux devis sur customers existants)
- `pennylane-backfill-quotes` v1 — one-shot pour migration retroactive

### Cure DB faite
- 29 doublons clients fusionnés
- 102 paires keep_separate
- ZOUDE / ALGAY / MAURIES corrigés
- 1 doublon de leads CLARENSON / CLARANSON fusionné manuellement (perte de `assigned_user_id` et `source_id` — recompensé manuellement par user, à éviter pour la suite)

## Le vrai problème à résoudre

**Le cron actuel itère sur customers, pas sur devis.** Conséquences :
- Un nouveau devis sur un customer **existant** n'est pas détecté (cas KAIS KAOUTAR : 6 devis, cron a vu 0 sans backfill manuel)
- Tout futur devis sur un client mappé est invisible

Il faut **un cron quote-driven** qui itère sur les devis :
1. Pour chaque devis Pennylane :
   - Si déjà attaché à un lead actif (`lead_pennylane_quotes.ejected_at IS NULL`) → skip
   - Sinon → appel RPC `process_pennylane_quote(quote_data, customer_data)` :
     - `find_or_create_client` (via customer_id du devis)
     - Trouve un lead approprié du client OU crée via `upsert_pennylane_lead`
     - Attache le devis au lead

## Questions de logique à arbitrer

1. **Critère de match devis → lead** pour un client donné :
   - (A) Lead le plus récent **actif** (statut ≠ Gagné / Perdu / Annulé) — recommandation par défaut
   - (B) Lead le plus récent quel que soit le statut
   - (C) 1 devis = 1 lead toujours

2. **Statuts terminaux** à exclure du matching :
   - Gagné `c717780c-0ba7-4bf1-9e1e-5f014c1e9e2f`
   - Perdu `e0419cea-d0fe-4be5-aba4-56197b2fd4fb`
   - Autres ?

3. **Devis sans customer** (brouillon Pennylane) → skip ?

4. **Re-classification** : nouveau devis sur un client dont le dernier lead est Gagné — créer un nouveau lead ou lier à l'ancien ?

5. **Bug fusion leads** : créer une RPC `merge_leads_pair(canonical_id, duplicate_id)` similaire à `merge_dedup_pair` pour les clients (snapshot avant DELETE, migration FK exhaustive : appointments, lead_interactions, mailing_logs, lead_pennylane_quotes, etc.). Permet de fusionner proprement sans perdre `assigned_user_id`, `source_id`, etc.

## Plan d'implémentation proposé

### Phase A — RPC `process_pennylane_quote`
Nouvelle RPC `public.process_pennylane_quote(p_org_id, p_customer_data jsonb, p_quote_data jsonb)` qui orchestre :
1. `find_or_create_client` (à partir de `p_customer_data`)
2. Lookup lead actif du client (selon critère choisi)
3. Si pas de lead actif → `upsert_pennylane_lead` (création)
4. `assign_pennylane_quote_to_lead`
5. Retourne `{ client_id, lead_id, quote_assigned, action }` pour audit

### Phase B — Refonte cron en mode quote-driven
Remplacer la logique actuelle (loop customers) par :
1. Fetch tous les devis Pennylane (paginé)
2. Fetch lead_pennylane_quotes (active) → set `processedQuoteIds`
3. Filter devis nouveaux (pas dans processedQuoteIds) → `newQuotes`
4. Pour chaque newQuote → appel `process_pennylane_quote`

### Phase C — RPC `merge_leads_pair`
Pour fusion safe de leads avec audit log (cf. point 5 ci-dessus).

### Phase D — Re-backfill
Lancer le nouveau cron (mode backfill) pour rattraper l'éventuel retard.

## Contraintes

- **Stack** : React 18 + Vite + Supabase + N8N. Voir `CLAUDE.md`.
- **Données en production** : ~3390 clients, ~666 contrats. Toute migration idempotente, transactionnelle.
- **Pas de preview tools** : l'utilisateur a son propre serveur de dev.
- **Communication français**, code anglais, interface française.
- **Travail sur le repo principal** (`C:\Dev\Frontend-Majordhome`, branche `main`) — pas de worktree.
- **Demander autorisation avant toute mutation DB** (mais GO sur les fix techniques validés).
- **Gotcha PostgREST** : `supabase-js` ne peut pas écrire dans `majordhome.*` via `.schema()` → toujours passer par RPC SECURITY DEFINER dans `public`.

## Méthodologie attendue

1. Lire le contexte (`CLAUDE.md`, `MEMORY.md`, `docs/SYNC_DEDUP_DIAGNOSIS.md`)
2. Confirmer/ajuster les choix sur les 5 questions ci-dessus avec l'utilisateur
3. Implémenter Phase A (RPC `process_pennylane_quote`)
4. Implémenter Phase B (refacto cron) + déployer + tester
5. (Optionnel) Phase C — RPC `merge_leads_pair`
6. (Optionnel) Phase D — re-backfill

## Action immédiate

Commencer par poser les 5 questions ci-dessus à l'utilisateur pour valider la logique avant de coder.
