# Restructuration CLAUDE.md — Plan d'exécution

> **Pour le loop / worker :** exécuter dans l'ordre. **Checkpoint après CHAQUE tâche** (rapport `fait / reste / diff`). **S'arrêter** et demander à Eric uniquement sur les points marqués 🛑. Cocher les `- [ ]` au fur et à mesure.

**Goal :** Réduire `CLAUDE.md` de 879 → ~350-380 lignes en gardant les décisions de structure + règles qui mordent, et en déportant les encyclopédies de modules vers `docs/MODULE_*.md`, **sans perte d'information**.

**Approche :** (1) déporter 4 gros modules (move faithful), (2) réécrire le cœur de CLAUDE.md lean (posture + charte + conventions + index modules), (3) réconcilier `proposed-updates.md` + vérifier.

**Principe de tri unique :** CLAUDE.md garde les *règles qui mordent* (ce qui casse un truc si ignoré) + le *pourquoi* qui porte une règle. L'encyclopédie (schémas DB complets, listes de RPC, composants, narratif daté) part en `docs/`. **On jette** : dates, hashes de commit, « ✅ Fait », « 🔧 EN COURS », puces « MàJ 20XX », « régression vécue le X », « (fix 2026-…) ». On garde la **règle**, on jette le **quand**.

---

## Critères de succès (DONE)

1. `wc -l CLAUDE.md` ≤ **380**.
2. Corps de CLAUDE.md **sans changelog daté** : zéro hash de commit, zéro puce « MàJ 20XX » en tête, zéro table de bombes à statut ✅/🔧. (Tolérés : dates dans la table Sprints, UUID org cible, dates dans `docs/`.)
3. `docs/MODULE_MAILING.md`, `docs/MODULE_PENNYLANE.md`, `docs/MODULE_PLANNING.md`, `docs/MODULE_ENTRETIENS.md` créés, contenu **faithful** (aucune info encyclopédique perdue — vérifié par diff retiré↔ajouté).
4. Chaque module a une entrée dans l'« Index des modules » de CLAUDE.md (4 déportés → pointeur `docs/` ; petits → bloc compact inline).
5. Les 4 « à intégrer » (mail_segment, SMS option A, invariant Gagné, invariant Perdu) sont **gravés dans les docs cibles** ET **retirés de `.claude/proposed-updates.md`** (→ il ne reste que le pointeur permissions = 1 PENDING).
6. Aucune référence cassée : tout « cf. Module X » de CLAUDE.md pointant vers une section déportée est repointé vers `docs/MODULE_X.md`.

## Vérification (structurelle — PAS build/lint : c'est du markdown, build/lint ne prouvent rien ici)

```bash
wc -l CLAUDE.md                                          # ≤ 380
grep -nE '\b[0-9a-f]{7}\b' CLAUDE.md                     # aucun hash résiduel
grep -nE 'MàJ 20|✅ Fait|🔧 EN COURS|régression vécue' CLAUDE.md   # vide
grep -c 'PENDING' .claude/proposed-updates.md            # = 1
ls docs/MODULE_{MAILING,PENNYLANE,PLANNING,ENTRETIENS}.md # 4 fichiers
```
Puis **relecture humaine** de CLAUDE.md (cohérence, pas d'orphelin).

---

## PHASE 1 — Déporter les 4 gros modules (mécanique, faithful, autonome)

Chaque tâche : isoler la section dans CLAUDE.md (de son `## ` jusqu'au `## ` suivant), la déplacer VERBATIM vers le doc (en `# Titre`), intégrer les « à intégrer » concernés, puis remplacer dans CLAUDE.md par le stub d'index (format Task 8). Checkpoint = confirmer que les lignes retirées == lignes ajoutées (modulo intégrations).

### Task 1 — `docs/MODULE_MAILING.md` ✅ doc créé+intégré (stub CLAUDE.md → batché Phase 2) (CLAUDE.md L296-533, 238 lignes)
**Files:** Create `docs/MODULE_MAILING.md` · Modify `CLAUDE.md`
- [ ] Déplacer la section `## Module Mailing` VERBATIM vers `docs/MODULE_MAILING.md` (titre `# Module Mailing`).
- [ ] **Intégrer mail_segment** : sous `### RPCs` → `mail_segment_compile`, ajouter le bloc « ⚠️ Filtre statut lead = placement Pennylane » (texte dans `.claude/proposed-updates.md`, entrée mail_segment).
- [ ] **Intégrer SMS option A** : créer une sous-section « SMS rappel entretien » avec le détail option A (texte dans `.claude/proposed-updates.md`, entrée SMS).
- [ ] Remplacer la section dans CLAUDE.md par le stub d'index :
```
### Mailing → `docs/MODULE_MAILING.md`
Règles qui mordent :
- Provider **Resend**. Envoi via edge `mailing-send` — **jamais de SQL brut côté front** (RPC `mail_fetch_recipients` membership-checked, compile côté DB).
- Scheduler auto = **pg_cron → edge `mailing-scheduler`** (PAS N8n). `mail_campaign_mark_run` SEULEMENT si `mailing-send` renvoie HTTP 2xx (sinon fenêtre consommée à vide).
- `is_transactional=true` → exclu du broadcast (onglet Envoi).
- Webhook `resend-webhook` (Svix HMAC) idempotent via `svix_id` UNIQUE ; priorité statuts sent<delivered<opened<clicked, bounce/complaint=terminal.
- Gotcha clé `sb_secret` (service_role non-JWT) : tout appel inter-edges = `verify_jwt:false` + secret partagé.
```
- [ ] Checkpoint.

### Task 2 — `docs/MODULE_PENNYLANE.md` ✅ doc créé+intégré (stub CLAUDE.md → batché Phase 2) (CLAUDE.md L758-832, 75 lignes)
**Files:** Create `docs/MODULE_PENNYLANE.md` · Modify `CLAUDE.md`
- [ ] Déplacer `## Module Pennylane quote-driven` VERBATIM vers `docs/MODULE_PENNYLANE.md`.
- [ ] **Intégrer invariant Gagné** ET **invariant Perdu** dans la sous-section « Règles métier Pipeline ↔ PL » (textes dans `.claude/proposed-updates.md`).
- [ ] Remplacer dans CLAUDE.md par le stub :
```
### Pennylane (quote-driven, WIP) → `docs/MODULE_PENNYLANE.md`
Règles qui mordent :
- Post-attache, **PL fait foi** pour l'identité du lead (OVERWRITE ; contact lead en lecture seule).
- « Gagner un lead » = UNIQUEMENT `lead_mark_won_with_quote` (statut + won_date + chantier). Ne jamais dupliquer la logique de gain ailleurs.
- « Devis envoyé » / « Gagné » / « Perdu » manuels **interdits sans devis PL rattaché** sur orgs PL (trigger DB + gardes board/drawer/fiche). Perte directe (sans devis) reste OK.
- Liens devis = `q.public_file_url` / `pdf_url` — **jamais** construire `app.pennylane.com/quotes/{id}` (404 multi-cabinet).
- Rate limit V2 25 req/5s → `pLimit(5)`. Single GET = ressource au **root** (pas wrappée). LISTE `/quotes` n'embarque QUE `customer.id` (pas le nom → `resolveCustomerNames`).
- Seuil pipeline 1000€ HT. Tie-break chrono = `pennylane_quote_id DESC`.
```
- [ ] Checkpoint.

### Task 3 — `docs/MODULE_PLANNING.md` ✅ doc créé (stub CLAUDE.md → batché Phase 2) (CLAUDE.md L534-578, 45 lignes)
**Files:** Create `docs/MODULE_PLANNING.md` · Modify `CLAUDE.md`
- [ ] Déplacer `## Module Planning / Prise de RDV ↔ Kanban` VERBATIM vers `docs/MODULE_PLANNING.md`.
- [ ] Remplacer dans CLAUDE.md par le stub :
```
### Planning / RDV ↔ Kanban → `docs/MODULE_PLANNING.md`
Règles qui mordent :
- **1 RDV = 1 carte** selon son `appointment_type` (plus d'auto-lead silencieux). Lien `appointments.intervention_id` OU `lead_id` OU rien.
- Dérivation `next_rdv_date`/`has_active_rdv` dans les vues (source unique = `appointments`). Vue `majordhome_appointments` = **miroir simple updatable** → JAMAIS de LATERAL/window (casse les INSERT PostgREST).
- Unique writer du cycle carte↔RDV = `appointments.service.js` (forward-only, ne descend jamais un état terminal).
- Source unique planif entretien/SAV = `savService.scheduleEntretien(...)` (kanban + ContractModal). `savService.updateFields` = allowlist par champ (un champ absent est ignoré en silence).
- Gotcha backfill : un RDV passé ≠ entretien non fait (scope backfill = RDV À VENIR uniquement).
```
- [ ] Checkpoint.

### Task 4 — `docs/MODULE_ENTRETIENS.md` ✅ doc créé, 2 sections (stub CLAUDE.md → batché Phase 2) (CLAUDE.md L579-643, 65 lignes)
**Files:** Create `docs/MODULE_ENTRETIENS.md` · Modify `CLAUDE.md`
- [ ] Déplacer `## Module Programmation entretiens — Grands secteurs` ET `## Module Certificats d'entretien` VERBATIM vers `docs/MODULE_ENTRETIENS.md` (2 sections `##` dans le doc).
- [ ] Remplacer les DEUX sections dans CLAUDE.md par le stub :
```
### Entretiens (Programmation, grands secteurs, certificats, géocodage) → `docs/MODULE_ENTRETIENS.md`
Règles qui mordent :
- Programmation regroupée en **grands secteurs** (clustering CP par proximité, `src/lib/sectorClustering.js` pur + testé ; nommage par la ville la + peuplée). Gotcha : l'icône `Map` de lucide **shadow** `new Map()` → aliaser `MapIcon`.
- Géocodage serveur auto : edge `geocode-sweep` (cron pg_cron 30 min) via endpoint **`/search/` unitaire** (PAS `/search/csv/`). `clients.geocode_attempts` = 3 max, reset au ré-adressage.
- Grand secteur figé sur `appointments.grand_secteur` à la création du RDV ; `getGrandSecteurMaps` attend l'org **CORE** (≠ org majordhome).
- Certificats = 1 par équipement (interventions enfants `parent_id`+`equipment_id`), vue Kanban filtrée `parent_id IS NULL`. Pièces : `refreshParts()` après CHAQUE mutation (les `idx` sont recalculés par la vue).
```
- [ ] Checkpoint.

---

## PHASE 2 — Réécrire le cœur de CLAUDE.md lean (jugement → checkpoints)

### Task 5 — Ajouter « Posture de travail » + « Lancer un /loop » en tête
**Files:** Modify `CLAUDE.md` (insérer après le bloc titre, avant `## Projet`)
- [ ] Insérer ce bloc VERBATIM :
```
## Posture de travail (à chaque tâche)
1. **Réfléchir avant de coder** — énoncer les hypothèses, ne pas deviner. Si le code peut répondre (caller, export, convention existante), le lire d'abord.
2. **Simplicité d'abord** — minimum de code, zéro abstraction spéculative.
3. **Chirurgical** — toucher seulement ce qui sert l'objectif. Le nettoyage adjacent se **signale** (spawn_task / note de fin), il ne s'embarque pas dans le commit. (Remplace les anciennes règles « profite pour décomposer / migrer ».)
4. **Objectif défini puis vérifié** — critère de succès AVANT de commencer ; boucler jusqu'à preuve, pas avant, pas après.
5. **Surfacer les conflits, jamais les moyenner** — 2 patterns dans le code ? on en choisit un et on le dit.
6. **Échouer fort** — « terminé » avec 14% sauté en silence = le pire bug. Surfacer l'incertitude et ce qui a été ignoré (cohérent avec nos gotchas « échec silencieux »).
7. **Checkpoint à chaque étape** — ne pas empiler sur un état cassé ; repartir d'un contexte frais quand ça tourne en rond, ne pas re-litiger une approche rejetée.

## Lancer un /loop
Avant de démarrer un loop auto-rythmé, TOUJOURS définir :
- Critère de succès vérifiable + la commande/check qui le prouve
- Checkpoint : rapport après chaque étape (fait / reste / diff), stop si l'arbitrage appartient à Eric
- Conditions d'arrêt : fini OU bloqué OU ambigu
Pas d'objectif d'output défini → on ne lance pas (le loop s'arrête trop tôt ou tourne sans fin). Objectif gros/multi-étapes → l'écrire dans un plan `docs/superpowers/plans/` et y pointer le loop.
```
- [ ] **Appliquer le basculement #3 ailleurs** : dans `## Conventions qualité` § Dette technique, retirer/retourner les 2 règles « Si tu touches un fichier dette → décompose dans le même commit » et « Quand tu touches un caller `useAuth().settings` → profite pour migrer ». Les remplacer par : « Nettoyage adjacent repéré en touchant un fichier → le **signaler** (spawn_task), pas l'embarquer (cf. Posture #3). »
- [ ] Checkpoint.

### Task 6 — Dégraisser le bloc titre + « Multi-tenant & sécurité »
**Files:** Modify `CLAUDE.md` (bloc titre L1-8 + section L12-45)
- [ ] Bloc titre : remplacer les 5 puces « MàJ 20XX » + bannière par **1 ligne** d'état : « Consolidation multi-tenant (onboarding 2ᵉ entreprise) — hardening Sem 0 quasi-fini. Détails : `docs/AUDIT_PRE_ONBOARDING_2026-05-20.md`. »
- [ ] Section sécurité : **supprimer la table des 8 bombes** (historique résolu — vit dans l'audit). **Garder intégralement** la liste « Règles imposées par le multi-tenant » (ce sont les règles vivantes). Garder le titre `## Multi-tenant & sécurité` (sans « 97% »).
- [ ] Checkpoint avec diff du nombre de lignes coupées.

### Task 7 — Trimer « Conventions de code » + gotchas « Base de Données » 🛑
**Files:** Modify `CLAUDE.md` (L157-207 DB, L234-295 Conventions)
- [ ] Règle : **garder chaque gotcha/règle qui énonce une consigne forward** (ex : `equipments.category` ENUM NOT NULL, séquences PG, miroir vue updatable, react-pdf/Helvetica, `.maybeSingle()`). **Strip uniquement** : les dates `(fix 2026-…)`, hashes, « vécu en pratique avec… », « régression … le X ». La règle reste, l'anecdote part.
- [ ] Les gotchas **purement historiques** (« avant le fix, X était Y » sans consigne forward — ex : paragraphes narratifs `exec_sql`/`security_invoker` au-delà de la consigne « ne pas appeler depuis le front ») : réduire à la consigne forward d'une ligne.
- [ ] 🛑 **STOP — montrer à Eric** la liste des gotchas que tu proposes de réduire fortement ou supprimer (DB + conventions) avant de finaliser. Ne pas supprimer un gotcha en autonomie si un doute subsiste sur son caractère load-bearing.
- [ ] Checkpoint.

### Task 8 — Construire l'« Index des modules » + trimer les petits modules en place
**Files:** Modify `CLAUDE.md`
- [ ] Créer une section `## Modules` qui regroupe : les 4 stubs déportés (Tasks 1-4) + les petits modules trimés.
- [ ] Petits modules (Contrats L644, Tarification L660, Settings L671, Voice L688, GeoGrid L699, Search Console L739, Appels L833, Solaire L845, Meta Ads L859) : réduire chacun à un bloc compact `### Module → (pointeur doc/spec si existe)` + 1-3 règles qui mordent. GeoGrid & Search Console pointent déjà vers `docs/` — garder le pointeur, couper le détail. Appels & Solaire pointent vers leurs specs/mémoires.
- [ ] 🛑 **STOP — montrer à Eric** les blocs compacts des petits modules (risque de couper une règle utile) avant de finaliser.
- [ ] Checkpoint.

### Task 9 — Trims légers du reste (Projet/Stack/Commandes/Aliases/Architecture/Rôles/Plan dev)
**Files:** Modify `CLAUDE.md`
- [ ] Garder ces sections (Architecture = la carte, Rôles = le modèle + god mode + garde-fou app-level, Plan dev = table sprints). Couper seulement les annotations datées résiduelles. Ne pas toucher au fond.
- [ ] Checkpoint.

---

## PHASE 3 — Réconcilier + vérifier

### Task 10 — Nettoyer `.claude/proposed-updates.md`
**Files:** Modify `.claude/proposed-updates.md`
- [ ] Retirer les 4 entrées « à intégrer » (mail_segment, SMS, Gagné, Perdu) — désormais gravées dans les docs. Il ne doit rester QUE le pointeur permissions.
- [ ] Vérifier : `grep -c PENDING` → 1.
- [ ] Checkpoint.

### Task 11 — Vérification finale + relecture
**Files:** (lecture seule)
- [ ] Lancer le bloc Vérification (en tête de ce plan). Tous les checks doivent passer.
- [ ] Relire CLAUDE.md en entier : cohérence, aucun pointeur orphelin, aucune règle qui mordait perdue.
- [ ] 🛑 **STOP** — rapport final à Eric : avant/après lignes, liste des docs créés, ce qui a été coupé. **Ne pas commiter** sans son go (il voudra relire).

---

## Notes d'exécution
- **Faithful move = priorité** : en cas de doute entre couper et garder, GARDER (on peut toujours retrimmer ; réintroduire une règle perdue est plus coûteux — principe #6 fail loud).
- Les déports (Phase 1) sont sûrs et autonomes. Les trims (Phase 2 Tasks 7-8) ont des 🛑 explicites.
- Rien n'est commité par le loop — Eric relit et commite (cf. Task 11).
