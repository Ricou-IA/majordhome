# Sprint Sync Pennylane & Dédup clients

> Prompt pour démarrer une nouvelle session Claude Code dédiée. À copier-coller tel quel.

---

## Contexte

Voir `[CLAUDE.md](http://CLAUDE.md)` pour la stack et les conventions.
Voir `[MEMORY.md](http://MEMORY.md)` pour les préférences inter-sessions.

Pendant le sprint UI/UX précédent (Module Gestion des Appro — commit `5242807`), un bug a été remonté côté utilisateur : **impossible de récupérer les devis Pennylane** pour certains clients, alors que les devis existent bien côté Pennylane.

Investigation effectuée pendant la session précédente — **diagnostic confirmé** :

### Cause racine identifiée

**Doublons clients en DB.** Beaucoup de clients existent en double (~30 paires détectées par nom+prénom seul). Pour chaque doublon :
- Un record est correctement synchronisé avec Pennylane (`pennylane_account_number` rempli + `pennylane_sync` OK)
- L'autre record est orphelin (pas de sync)

Les leads/chantiers nouveaux semblent **systématiquement pointer vers le mauvais doublon** — celui sans sync Pennylane.

Exemples confirmés :

| Client | Lead chantier `client_id` pointé | Sync Pennylane ? |
|---|---|---|
| BERNA HELENE | `f57efb2d-e378-4948-a3f7-e305a16040bf` | ❌ Non |
| BERNA HELENE (autre record) | `778132c3-7fa0-4631-8f83-87322af9f689` | ✅ 411100081 |
| FLECHER DOMINIQUE | `3d722004-3e32-406a-bca0-4d79ec8d2020` | ❌ Non |
| FLECHER DOMINIQUE (autre record) | `d64253ac-2c63-4ba6-b4d8-20735d55e240` | ✅ 411100105 |
| CHAUVIERE JOSETTE | `99664e64-1cd8-4f5f-9c00-704ea433e8fd` | ✅ (pas de doublon) |

### Code en cause (échec silencieux)

`pennylaneService.getQuotesByClient` (`src/shared/services/pennylane.service.js:367-419`) :
```js
const syncRecord = await getSyncRecord(orgId, 'client', clientId);
if (!syncRecord?.pennylane_id) return [];  // échec silencieux
const clientQuotes = allQuotes.filter(q => q.customer?.id === plCustomerId);  // match dur sur ID
```

Si pas de syncRecord → renvoie `[]` sans rien dire. L'UI affiche "Aucun devis Pennylane pour ce client" alors que le devis existe sur l'autre record.

---

## Tables / vues / RPCs concernées

- `majordhome.clients` — table client (~3300 records)
- `majordhome.pennylane_sync` — mapping `local_id (UUID MDH) ↔ pennylane_id (bigint)` + `external_reference` + `pennylane_number` (le code 411xxx)
- `majordhome.leads` — table leads/chantiers (FK `client_id`)
- `majordhome.contracts` — FK `client_id` (UNIQUE — max 1 contrat par client)
- `majordhome.equipments` — FK via `project_id` qui FK vers `core.projects` (architecture dual)
- `majordhome.interventions` — FK via `project_id`
- `majordhome.appointments` — FK via `client_id`
- `majordhome.mailing_logs` — FK `client_id`
- `majordhome.lead_interactions` — FK `lead_id`
- `core.projects` — 1:1 avec `majordhome.clients` via `clients.project_id`

Cron Pennylane : `pennylane-sync-cron` (Edge Function Supabase). Synchronise MDH → Pennylane et stocke le code 411 dans `clients.pennylane_account_number`.

Hook frontend : `usePennylaneSyncClient` (fire-and-forget après création client).

---

## Objectif de la session

**Régler le problème structurel** : doublons clients + sync Pennylane désynchronisée. Pas de patch palliatif — vraie résolution.

L'utilisateur a explicitement demandé : *"Il faut régler le problème structurel et le sujet de sync car ça va poser un vrai problème"*.

---

## Plan en 4 phases (à suivre dans l'ordre)

### Phase 1 — Diagnostic (LECTURE SEULE, pas de modification)

Cartographier l'ampleur exacte du problème :

1. **Combien de doublons clients exactement ?**
   - Par email (clé la plus fiable)
   - Par phone (si email manquant)
   - Par nom+prénom+postal_code (fallback)
   - Cas pathologiques : plus de 2 records ? records archivés vs actifs ?

2. **Pour chaque doublon, quel est le bon record ?**
   - Celui qui a la sync Pennylane → c'est lui le canonique a priori
   - Mais que se passe-t-il si les 2 ont la sync ? Ou si aucun ne l'a ?

3. **Quelles tables référencent le mauvais record ?**
   - `leads.client_id`, `contracts.client_id`, `appointments.client_id`, `mailing_logs.client_id`
   - Equipments via `project_id` → `core.projects` → `clients.project_id`
   - Interventions via `project_id`
   - Compter les FK à migrer pour estimer le risque

4. **Quels syncRecords sont obsolètes ?**
   - `pennylane_id` qui ne match plus aucun customer Pennylane (déduplication côté Pennylane)
   - À détecter via une comparaison API si nécessaire

→ **Livrable Phase 1** : un fichier `docs/SYNC_DEDUP_DIAGNOSIS.md` qui liste les chiffres précis (X doublons par email, Y par nom seul, Z FK à migrer, etc.) et les cas limites identifiés.

### Phase 2 — Cause racine

**Pourquoi les doublons se créent ?** Hypothèses à vérifier :

1. **Conversion lead → client** : est-ce que le code crée un nouveau client à chaque conversion sans matcher l'existant ?
   - Code probable : `leads.service.js` ou trigger DB
2. **Cron `pennylane-sync-cron`** : tente-t-il de créer côté Pennylane si déjà existant ?
3. **Workflows N8N** : qui touche aux clients (création lead, mailing, autres) ?
4. **Imports historiques** : Excel "Base Client NEW" (mentionné dans MEMORY.md) — combien de doublons issus de l'import vs créés depuis ?

→ **Livrable Phase 2** : section ajoutée au doc de diagnostic + identification des points de fix dans le code/workflows.

### Phase 3 — Stratégie de fix

À arbitrer **avec l'utilisateur** avant de coder :

1. **Hiérarchie de matching pour identifier les doublons** :
   - email exact (insensible casse) > phone normalisé > nom+prénom+postal_code
   - Choix du "canonique" : celui synced > celui le plus récemment édité > le plus ancien
2. **Stratégie de merge** :
   - Champs : prendre les non-null en priorité, sinon le canonique
   - FK : migrer toutes les FK vers le canonique
   - Suppression : `is_archived=true` ou `DELETE` du non-canonique ?
3. **Garde-fous DB** :
   - Index UNIQUE sur `email` (filtré sur `is_archived=false`) ? Sur `phone` ?
   - Trigger de déduplication à la création ?
4. **Fix de la cause** :
   - Si conversion lead→client crée des doublons : fix dans le code
   - Si cron crée des doublons : fix dans la cron
5. **Recovery sync** :
   - Pour les ~30 clients dédoublés, re-synchroniser avec Pennylane si besoin
   - Lookup Pennylane par `external_reference` (qui contient l'UUID MDH)

→ **Livrable Phase 3** : section dédiée du doc avec les arbitrages + script SQL de migration commenté.

### Phase 4 — Exécution

1. **Backup** : dump de la base avant migration
2. **Dry-run** : exécuter la migration sur une copie / branche Supabase pour vérifier
3. **Migration en production** : transaction unique si possible, sinon par batches sécurisés
4. **Vérifications post-migration** :
   - Aucun doublon résiduel
   - Toutes les FK bien migrées
   - Aucun client orphelin
   - Pennylane sync OK
5. **Tests UI** : revisiter les chantiers BERNA/FLECHER (et autres connus) → "Lier un devis Pennylane" doit afficher les devis attendus

→ **Livrable Phase 4** : migration exécutée, suite de tests passée, rapport post-mortem ajouté au doc.

---

## Contraintes

- **Stack** : React 18 + Vite + Supabase + N8N. Voir `CLAUDE.md`.
- **Données en production** : ~3300 clients, ~666 contrats, ~709 équipements. Toute migration doit être idempotente, transactionnelle, et avec un plan de rollback clair.
- **Pas de preview tools** : l'utilisateur a son propre serveur de dev. Vérifier avec `npx vite build` uniquement.
- **Communication français**, code anglais, interface française.
- **Travail sur le repo principal** (`C:\Dev\Frontend-Majordhome`, branche `main`) — pas de worktree.
- **Demander autorisation avant tout code** + livrer des fichiers complets, pas de patches partiels.
- **Demander autorisation avant toute mutation DB** (INSERT, UPDATE, DELETE). LECTURE SEULE par défaut.

---

## Méthodologie attendue

1. **Phase 1 d'abord** : pas de proposition de fix avant d'avoir les chiffres précis
2. **Validation utilisateur** entre chaque phase
3. **Documentation au fil de l'eau** dans `docs/SYNC_DEDUP_DIAGNOSIS.md` (créer si absent)
4. **Hypothèses formulées explicitement** avant tests SQL
5. **Aucune migration data sans dry-run + backup**

---

## Outils MCP utiles

- `mcp__supabase__execute_sql` — pour les SELECT de diagnostic (déjà utilisé dans le sprint précédent)
- `mcp__supabase__apply_migration` — pour les DDL (à utiliser AVEC PRÉCAUTION et autorisation explicite)
- `mcp__supabase__get_logs` — pour analyser les erreurs côté Edge Functions
- `mcp__supabase__list_tables` — pour explorer le schema

---

## Action immédiate

Commencer par la **Phase 1 — Diagnostic** :

1. Créer le fichier `docs/SYNC_DEDUP_DIAGNOSIS.md` avec une structure squelette (4 sections vides correspondant aux 4 phases)
2. Lancer 4-5 SELECT ciblés via `mcp__supabase__execute_sql` pour cartographier les doublons :
   - Doublons par email
   - Doublons par phone
   - Doublons par nom+prénom+postal_code
   - Multiplicité (combien à 2 records, 3+, etc.)
   - FK qui pointent vers les "mauvais" doublons (sans sync) — par table
3. Présenter une **synthèse chiffrée** à l'utilisateur avant de passer à la Phase 2
4. Pour chaque chiffre, noter dans le doc + estimer le risque/effort de migration

**Ne pas attaquer la Phase 2** (cause racine) avant validation explicite de la Phase 1.
**Ne pas proposer de fix** avant la Phase 3 et accord utilisateur.
