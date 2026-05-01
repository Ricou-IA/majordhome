# Sync Pennylane & Dédup clients — Diagnostic

> **Démarré** : 2026-05-01
> **Contexte** : Bug remonté pendant le sprint Module Gestion des Appro (commit `5242807`). Impossible de récupérer certains devis Pennylane côté chantiers — diagnostic préliminaire identifie des doublons clients en DB où les leads/chantiers pointent systématiquement vers le record sans sync Pennylane.
> **Objectif** : Régler le problème structurel — pas de patch palliatif.

## Plan en 4 phases

1. **Phase 1 — Diagnostic** (LECTURE SEULE) : cartographier l'ampleur exacte du problème
2. **Phase 2 — Cause racine** : identifier pourquoi les doublons se créent
3. **Phase 3 — Stratégie de fix** : matching, merge, garde-fous DB, recovery sync
4. **Phase 4 — Exécution** : backup, dry-run, migration prod, vérifications

---

## Phase 1 — Diagnostic

> **Statut** : EN COURS — 2026-05-01

### Objectif
Cartographier l'ampleur exacte du problème de doublons clients et de désynchronisation Pennylane. Aucune mutation DB.

### Méthodologie
SELECT ciblés sur la base de production (org Mayer Energie, `core.org_id = 3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`).

### Cas confirmés (avant diagnostic)

| Client | Lead chantier `client_id` | Sync Pennylane ? |
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

### Résultats

#### 0. Vue d'ensemble Mayer Energie

| Métrique | Valeur |
|---|---|
| Total clients | **3 419** |
| Actifs (`is_archived=false`) | 3 245 |
| Archivés | 174 |
| Avec `pennylane_account_number` (code 411 rempli) | **771** (22,5 %) |
| Sans `pennylane_account_number` | 2 648 (77,5 %) |
| Avec email | 2 636 |
| Avec phone | 3 167 |
| Entrées `pennylane_sync` `entity_type='client'` | 771 (toutes `synced`, distinct local_ids) |

#### 1. Doublons par email (case-insensitive, trim)

| Mesure | Valeur |
|---|---|
| Groupes de doublons | **36** |
| Records concernés | 72 |
| Paires (cnt=2) | 36 |
| Triplets (cnt=3) | 0 |
| Groupes ≥4 | 0 |
| **Mixed sync** (1 avec PL, 1 sans) | **4** |
| **None synced** (aucun avec PL) | 19 |
| **Multi synced** (les 2 avec PL) | 13 |

**Cas vérifiés (sample)** :
- `marie-pierre.teysseyre@wanadoo.fr` (BERNA HELENE) — confirmé : 778132c3 (excel/2026-02-23, 411100081) vs f57efb2d (manuel/2026-04-30, sans sync)
- `dominique-f.flecher@wanadoo.fr` (FLECHER DOMINIQUE) — confirmé : d64253ac (excel/2026-02-23, 411100105) vs 3d722004 (manuel/2026-04-30, sans sync)

#### 2. Doublons par téléphone normalisé (digits only, ≥8 chars)

| Mesure | Valeur |
|---|---|
| Groupes de doublons | **32** |
| Records concernés | 67 |
| Paires (cnt=2) | 31 |
| Quatuor (cnt=4) | 1 (en réalité 5 records) |
| **Mixed sync** | **10** |
| **None synced** | 13 |
| **Multi synced** | 9 |

**ATTENTION — faux positifs élevés** : le quatuor à `06 52 68 11 86` n'est PAS un doublon. 5 personnes différentes (CABOT BENJAMIN, GIROUARD NICOLAS, LAMBERT FREDERIC, RIEUTORD MICHEL, SUSTRAC PATRICIA) avec emails et noms distincts partagent ce numéro. Probable numéro placeholder ou commercial. **Le critère phone seul génère beaucoup de bruit — à utiliser en confirmation, pas en détection primaire.**

#### 3. Doublons par nom+prénom+code postal (insensible casse, trim)

| Mesure | Valeur |
|---|---|
| Groupes | **6** |
| Records | 12 |
| Paires (cnt=2) | 6 |
| **Mixed sync** | **5** |
| None synced | 1 |
| Multi synced | 0 |

→ **Critère le plus fiable** : 5 paires sur 6 sont mixed sync (signal clair). Faible volume mais haute précision.

#### 4. Doublons par nom+prénom seul (sans CP)

| Mesure | Valeur |
|---|---|
| Groupes | 18 |
| Records | 36 |
| **Mixed sync** | 10 |
| None synced | 6 |

→ Détecte des homonymes légitimes (CP différent) en plus des vrais doublons → moins fiable que critère 3.

#### 5. Multiplicité (combien de records dans un groupe de doublons ?)

Quasi-totalité des groupes sont des **paires** (cnt=2) sur tous les critères. **1 seul groupe à 4+** (sur phone) — faux positif (numéro partagé). **Aucun triplet réel.**

#### 6. Union dédupliquée des records suspects

| Critère | Records uniques |
|---|---|
| Détectés via email | 72 |
| Détectés via phone | 67 |
| Détectés via nom+prénom+CP | 12 |
| **Union (au moins un critère)** | **127** (3,7 % de la base) |

#### 7. Codes 411 (Pennylane) partagés entre records MDH

| Mesure | Valeur |
|---|---|
| `pennylane_account_number` partagés | 6 codes |
| Records MDH partageant un code 411 | 12 |
| `pennylane_id` (bigint) partagés dans `pennylane_sync` | 5 |
| Sync rows dans des groupes partagés | 10 |

**Détail des 6 codes 411 partagés** :

| Code 411 | Records concernés |
|---|---|
| 411000088 | BONELLO BERNARD + ALGAY FRANCOIS — _même pl_id 244601169_ ✱ noms incohérents (sync foireuse) |
| 411000324 | GAREIL GERARD + GAREIL GERARD — _même pl_id 244601381_ (vrai doublon) |
| 411000343 | GONZALO MICHAEL + GONZALO ROSE — _même pl_id 244601398_ (couple, ambigu) |
| 411000509 | MAURIES ROBERT + MAURIES GINETTE — pl_id distincts (244601547/244601548). Mais `pennylane_account_number=411000509` sur les 2 alors que `pennylane_sync.pennylane_number` dit 411000508 pour ROBERT et 411000509 pour GINETTE → **désynchro à corriger** |
| 411000599 | PUDEBAT ERIC + "test eric" — _même pl_id 244601630_ (test à supprimer) |
| 411000704 | TOSTIVINT-GRANGE x2 (couple) — _même pl_id 244601724_ |

→ **5 paires multi_sync ont le même `pennylane_id`** (1 customer Pennylane = 2 records MDH = bug sync, 1 record écrit dans l'entrée `pennylane_sync` du jumeau).

#### 8. Désynchronisation `clients.pennylane_account_number` vs `pennylane_sync.pennylane_number`

**2 cas / 771** (0,26 %). Cas connu : MAURIES ROBERT (CLI-02020) → fix manuel à prévoir.

#### 9. Distribution temporelle des doublons par email (72 records)

| Source | Mois création | Records |
|---|---|---|
| `excel_import_2026` | 2026-02 | **62** (86 %) |
| `(null)` (création manuelle / lead conv / cron) | 2026-03 | 1 |
| `(null)` | 2026-04 | **9** (12,5 %) |

→ La très large majorité des doublons sont issus de l'**import Excel initial** (orthographes, accents, emails partagés famille/entreprise). Mais **9 doublons créés en avril 2026 post-import** → probable bug actif sur le flux de création client (à investiguer en Phase 2).

#### 10. Impact FK — total des records "non-canoniques" présumés

Définition du "bad" : records candidats à fusion vers leur jumeau canonique.
- 4 via email mixed
- 10 via phone mixed
- 5 via nom+prénom+CP mixed
- 5 via multi_sync (même `pennylane_id`, on garde le plus ancien)
- **Total dédupliqué : 20 records uniques**

| Table | FK pointant vers un "bad" |
|---|---|
| `leads.client_id` | 3 |
| `contracts.client_id` | 6 |
| `appointments.client_id` | 2 |
| `mailing_logs.client_id` | 17 |
| `equipments` (via `project_id`) | 8 |
| `interventions` (via `project_id`) | 11 |
| **Total FK** | **47** |

→ Volume de migration **très faible et cadré**. Migration manuelle scriptée gérable en transaction unique.

⚠️ Le décompte phone inclut probablement des faux positifs (le quatuor à 06 52 68 11 86 est exclu car les 5 records ont tous `pennylane_account_number IS NULL`, donc ils sont écartés de "bad_via_phone" qui exige au moins un autre record avec PL — mais toute autre paire phone à investiguer manuellement).

### Synthèse Phase 1

#### Cartographie

- **127 records suspects au total** (3,7 % de la base) détectés par ≥1 critère.
- **20 records "vrais doublons"** candidats à fusion (signal robuste : mixed sync OU multi_sync même pl_id).
- **107 records suspects mais probablement faux doublons** (emails partagés couples/entreprises, homonymes, numéros placeholder).
- **47 FK à migrer** sur les 20 bad records (volume très gérable).

#### Critères de détection — fiabilité

| Critère | Volume | Fiabilité | Bruit principal |
|---|---|---|---|
| **Nom+prénom+CP** | 6 paires | ⭐⭐⭐⭐ | Faible volume mais signal très propre |
| **Email + sync mixed** | 4 paires | ⭐⭐⭐⭐ | Bon signal (email partagé exclu par mixed) |
| **Multi_sync même `pennylane_id`** | 5 paires | ⭐⭐⭐⭐⭐ | Signal physique côté Pennylane (bug sync) |
| Email + none/multi_sync | 32 paires | ⭐⭐ | Faux doublons : couples, familles, entreprises |
| **Phone normalisé** | 32 paires + 1 quatuor | ⭐⭐ | Numéros placeholder (06 52 68 11 86 partagé par 5 personnes) |
| Nom+prénom seul | 18 paires | ⭐⭐⭐ | Homonymes (CP différent) |

#### Cas atypiques à arbitrer en Phase 3

1. **MAURIES ROBERT** : `pennylane_account_number=411000509` côté `clients` mais `pennylane_sync.pennylane_number=411000508` → fix le numéro côté `clients`.
2. **PUDEBAT ERIC + "test eric"** : record `test eric` (CLI-03345) à supprimer (test, pas un vrai client).
3. **BONELLO BERNARD + ALGAY FRANCOIS** : même `pennylane_id 244601169` mais 2 personnes physiquement différentes — sync foireuse à comprendre.
4. **Couples partageant un email** (TOSTIVINT-GRANGE, MAURIES, BRUN, GONZALO, CREPEL…) : 8 cas. Faut-il fusionner (1 seul fiche couple) ou laisser séparés (2 fiches mais émission désambiguïsée) ?
5. **Quatuor phone 06 52 68 11 86** : 5 records distincts, pas un doublon. Question à part : ce numéro est-il un placeholder à nettoyer ?

#### Origine probable des doublons (à confirmer en Phase 2)

- **86 % issus de l'import Excel 2026-02-23** : orthographes (FRANÇOIS/FRANCOIS), variations nom (BLANC/BLANC ET FILS), emails partagés.
- **12,5 % créés post-import (avril 2026)** : flux actuel de création client a un bug. À investiguer :
  - `leads.service.js` : conversion lead→client crée-t-elle un nouveau client sans matcher ?
  - `pennylane-sync-cron` : crée-t-elle des records côté MDH ?
  - Workflows N8N (Lead Bienvenue, Mailing) : touchent-ils aux clients ?

### Validation utilisateur — Phase 1

**Questions ouvertes pour décider de la Phase 2** :

1. Le périmètre de "vrai doublon" est-il bon (20 records, basé sur mixed sync + multi sync même `pennylane_id`) ?
2. Comment trancher les 8 cas "couples avec email partagé" (multi_sync différent `pennylane_id`) ?
   - (a) laisser tel quel (2 fiches client = 2 customers Pennylane)
   - (b) fusionner sous un seul client + lier au customer principal Pennylane
3. Pour les 19 paires "none_synced" par email (couples/entreprises/familles), action ?
   - (a) ne rien faire (faux doublons légitimes)
   - (b) ajouter un flag `is_known_shared_email = true` pour les marquer comme non-doublon
4. Démarrer la Phase 2 (cause racine création des doublons d'avril 2026) ?

---

## Phase 2 — Cause racine

> **Statut** : À DÉMARRER après validation Phase 1

### Hypothèses à vérifier
1. Conversion lead → client : crée un nouveau client à chaque conversion sans matcher l'existant ?
2. Cron `pennylane-sync-cron` : tente-t-il de créer côté Pennylane si déjà existant ?
3. Workflows N8N : qui touche aux clients (création lead, mailing, autres) ?
4. Imports historiques : Excel "Base Client NEW" — combien de doublons issus de l'import vs créés depuis ?

### Résultats
_TBD_

---

## Phase 3 — Stratégie de fix

> **Statut** : À DÉMARRER après validation Phase 2

### Arbitrages à prendre
1. Hiérarchie de matching pour identifier les doublons (email > phone > nom+prénom+CP)
2. Stratégie de merge (champs, FK, suppression vs archivage)
3. Garde-fous DB (UNIQUE, triggers)
4. Fix de la cause (lead→client, cron, etc.)
5. Recovery sync Pennylane

### Décisions
_TBD_

---

## Phase 4 — Exécution

> **Statut** : À DÉMARRER après validation Phase 3

### Checklist
- [ ] Backup DB
- [ ] Dry-run sur copie / branche Supabase
- [ ] Migration production
- [ ] Vérifications post-migration
- [ ] Tests UI (chantiers BERNA/FLECHER)
- [ ] Rapport post-mortem

### Résultats
_TBD_
