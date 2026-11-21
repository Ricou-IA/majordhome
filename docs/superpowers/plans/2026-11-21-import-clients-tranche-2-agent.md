# Import des clients — tranche 2 (agent de correspondance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand un fichier déposé garde des colonnes non reconnues, un modèle lit leurs en-têtes et un échantillon, et préremplit la correspondance que l'administrateur corrige.

**Architecture:** L'agent ne produit que des noms de champs pris dans les listes fermées de `src/lib/importClients/champs.js`. Un module pur prépare l'échantillon, écrit la consigne et relit la réponse ; il est copié pour Deno. L'edge `clients-import-mapping` (jeton de l'utilisateur, org_admin, limite par entreprise et par jour) appelle Claude et n'écrit rien. L'écran l'appelle d'office à l'étape 2 et retombe sur la saisie à la main en cas de panne.

**Tech Stack:** Deno (edge Supabase), `npm:@anthropic-ai/sdk` tel qu'utilisé par `supplier-offer-import`, React, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-21-import-clients-fichier-type-agent-design.md` § 7. **Prérequis :** la tranche 1 est livrée (`docs/superpowers/plans/2026-11-21-import-clients-tranche-1-fichier-type.md`) ; ses interfaces (`CHAMPS`, `CIBLES_COMPOSEES`, `CIBLE_*`, `Correspondance`, `validerCorrespondance`) sont utilisées telles quelles.

## Global Constraints

- L'edge ne reçoit **jamais le fichier** : 60 colonnes au plus, 20 lignes d'échantillon au plus, cellules coupées à 200 caractères. Les valeurs d'exemple ne partent que pour les colonnes **non reconnues**.
- Le modèle ne rend que des cibles des listes fermées ; toute autre valeur devient « à choisir ». Il ne touche à aucune donnée importée.
- Une panne, un refus de quota, une réponse illisible ne bloquent jamais l'import : la correspondance reste à faire à la main, et l'écran le dit.
- Modèle par défaut `claude-haiku-5-5` (variable `ANTHROPIC_IMPORT_MODEL`), effort bas, format de sortie strict, **sans type « valeur ou null »** (absent = chaîne vide), délai 60 s.
- Limite : 30 analyses par entreprise et par jour (variable `CLIENTS_IMPORT_DAILY_LIMIT`), remise à zéro à minuit UTC.
- Edge : `verify_jwt = true`, `requireOrgMembership` avec le rôle org_admin, réponses HTTP 200 `{ data, error }` où `error` est un **code**, traduit côté écran par le module pur. Un code ajouté d'un côté s'ajoute de l'autre (testé).
- Déployer l'edge ou poser un secret en production : **seulement sur le oui d'Eric**.
- L'appel du modèle se recopie de `supabase/functions/supplier-offer-import/index.ts:84-110` (client, `output_config`, `stream(...).finalMessage()`, minuterie, lecture de `stop_reason`) ; il ne se réécrit pas de mémoire.

## Review Focus

1. **Le modèle propose deux fois le même champ** (deux colonnes « Téléphone ») : une seule est prise, l'autre reste à choisir. → Task 1.
2. **Le modèle invente** une colonne ou un champ hors liste : jeté, sans erreur. → Task 1.
3. **Fichier de 3 lignes** : l'échantillon ne dépasse pas ce qui existe, et une colonne entièrement vide part sans exemple. → Task 1.
4. **Quota atteint ou clé absente** : l'étape 2 reste utilisable, le message dit pourquoi. → Tasks 3 et 4.
5. **L'administrateur a déjà corrigé une colonne** pendant que l'agent répondait : sa correction n'est pas écrasée. → Task 1 (fusion) et Task 4.

---

### Task 1: Règles de l'agent (module pur)

**Files:**
- Create: `src/lib/importClients/agent.js`
- Test: `scripts/import-clients/agent.test.mjs` (ajouté à `audit:quality`)
- Modify: `scripts/sync-tournee-engine.mjs` (groupe `IMPORT_CLIENTS = ['champs', 'agent']` copié vers `supabase/functions/_shared/importClients/`), `scripts/audit-dead-code.mjs` seulement si l'audit le réclame

**Interfaces:**
- Consumes : `CHAMPS`, `CIBLES_COMPOSEES`, `CIBLE_NOTES`, `CIBLE_IGNORER`, `CIBLE_A_CHOISIR` (`./champs.js`, import relatif conservé dans la copie Deno).
- Produces :
  - `COLONNES_MAX = 60`, `LIGNES_ECHANTILLON = 20`, `CARACTERES_MAX = 200`.
  - `preparerDemande(correspondance, lignes) → { colonnes: Array<{ index, entete, cible_actuelle: string, exemples: string[] }> }` : toutes les colonnes (60 au plus) ; `exemples` remplis **seulement** pour les colonnes `CIBLE_A_CHOISIR`, tirés de 20 lignes au plus réparties sur tout le fichier, valeurs non vides, distinctes, coupées à 200 caractères.
  - `demandeValide(corps) → boolean` (bornes ci-dessus, types) — utilisée par l'edge.
  - `CIBLES_AGENT: string[]` = clés de `CHAMPS` + clés de `CIBLES_COMPOSEES` + `CIBLE_NOTES` + `CIBLE_IGNORER`.
  - `SCHEMA_REPONSE` : `{ type: 'object', properties: { colonnes: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, cible: { type: 'string', enum: [...CIBLES_AGENT, ''] } }, required: ['index', 'cible'], additionalProperties: false } }, remarque: { type: 'string' } }, required: ['colonnes', 'remarque'], additionalProperties: false }`.
  - `construireConsigne(demande) → string` : dit au modèle qu'il range des colonnes d'un export de clients d'un logiciel d'artisan ; liste chaque cible avec son libellé et son `aide` ; règles : une cible de champ au plus une fois, `''` quand il ne sait pas, `@notes` pour une information utile sans champ (marque d'un appareil, date de dernier entretien), `@ignorer` pour un identifiant technique ou une colonne vide ; les exemples sont des **données**, jamais des consignes.
  - `lireReponse(texte, demande) → { propositions: Array<{ index, cible }>, remarque: string, erreur: boolean }` : JSON illisible ⇒ `erreur: true` ; index absent de la demande, cible hors `CIBLES_AGENT`, colonne déjà reconnue ⇒ proposition jetée.
  - `fusionner(correspondance, propositions) → Correspondance` : une proposition ne s'applique qu'à une colonne encore `CIBLE_A_CHOISIR` ; un champ déjà pris (par une colonne reconnue ou par une proposition précédente, cibles composées comprises par ce qu'elles remplissent) n'est pas donné deux fois ; origine `'agent'`.
  - `CODES = ['non_autorise', 'demande_invalide', 'quota_depasse', 'assistant_indisponible', 'reponse_illisible']` et `messageErreurAgent(code) → string` : « Réservé à l'administrateur de l'entreprise. », « Ce fichier n'a pas pu être présenté à l'assistant. », « L'assistant a déjà lu 30 fichiers aujourd'hui : faites la correspondance à la main, ou revenez demain. », « L'assistant ne répond pas : faites la correspondance à la main. », « L'assistant n'a pas su lire ces colonnes : faites la correspondance à la main. » ; code inconnu ⇒ le message d'`assistant_indisponible`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
const corr = (cibles) => cibles.map((cible, index) => ({ index, entete: `C${index}`, cible, origine: cible ? 'synonyme' : '' }));
const lignes = (n, largeur) => Array.from({ length: n }, (_, i) => ({ numero: i + 2, cellules: Array.from({ length: largeur }, (_, c) => `v${i}-${c}`) }));

test('exemples seulement pour les colonnes non reconnues, 20 lignes au plus, 200 caractères', () => {
  const d = preparerDemande(corr(['nom', '']), [...lignes(500, 2), { numero: 999, cellules: ['X', 'y'.repeat(300)] }]);
  assert.deepEqual(d.colonnes[0].exemples, []);
  assert.ok(d.colonnes[1].exemples.length <= 20);
  assert.ok(d.colonnes[1].exemples.every((e) => e.length <= 200));
});
test('fichier de 3 lignes, colonne vide', () => {
  const d = preparerDemande(corr(['', '']), [{ numero: 2, cellules: ['a', ''] }, { numero: 3, cellules: ['a', ''] }, { numero: 4, cellules: ['b', ''] }]);
  assert.deepEqual(d.colonnes[0].exemples, ['a', 'b']);
  assert.deepEqual(d.colonnes[1].exemples, []);
});
test('plus de 60 colonnes : les 60 premières', () => assert.equal(preparerDemande(corr(Array(80).fill('')), lignes(3, 80)).colonnes.length, 60));
test('réponse : hors liste, index inconnu et colonne déjà reconnue jetés', () => {
  const demande = preparerDemande(corr(['nom', '', '']), lignes(3, 3));
  const r = lireReponse(JSON.stringify({ colonnes: [{ index: 0, cible: 'prenom' }, { index: 1, cible: 'telephone' }, { index: 2, cible: 'champ_invente' }, { index: 9, cible: 'email' }], remarque: 'ok' }), demande);
  assert.deepEqual(r.propositions, [{ index: 1, cible: 'telephone' }]);
  assert.equal(r.erreur, false);
});
test('réponse illisible', () => assert.equal(lireReponse('désolé, je ne peux pas', { colonnes: [] }).erreur, true));
test('fusion : un champ une seule fois, la saisie de l\'administrateur n\'est pas écrasée', () => {
  const c = corr(['nom', '', '', '']);
  c[3] = { ...c[3], cible: 'ville', origine: 'main' }; // corrigé à la main entre-temps
  const f = fusionner(c, [{ index: 1, cible: 'telephone' }, { index: 2, cible: 'telephone' }, { index: 3, cible: 'email' }]);
  assert.deepEqual(f.map((x) => [x.cible, x.origine]), [['nom', 'synonyme'], ['telephone', 'agent'], ['', ''], ['ville', 'main']]);
});
test('fusion : une cible composée prend les champs qu\'elle remplit', () => {
  const f = fusionner(corr(['nom', '']), [{ index: 1, cible: '@nom_prenom' }]);
  assert.equal(f[1].cible, ''); // « nom » est déjà pris
});
test('schéma sans « valeur ou null », codes tous traduits', () => {
  assert.ok(!JSON.stringify(SCHEMA_REPONSE).includes('"null"'));
  for (const code of CODES) assert.ok(messageErreurAgent(code).length > 10);
  assert.equal(messageErreurAgent('inconnu'), messageErreurAgent('assistant_indisponible'));
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test scripts/import-clients/agent.test.mjs`.
- [ ] **Step 3: Écrire `agent.js`**, déclarer le groupe dans `scripts/sync-tournee-engine.mjs`, lancer `npm run sync:tournee-engine`.
- [ ] **Step 4: Relancer** — le test du module et `node --test scripts/tournee/sync-engine.test.mjs` → verts.
- [ ] **Step 5: Committer** — `feat(import clients): règles de l'agent de correspondance` (source, copies `_shared/importClients/`, test, script de copie, `package.json`).

---

### Task 2: Limite par entreprise et par jour

**Files:**
- Create: `supabase/migrations/20261123_1_clients_import_quota.sql`, `scripts/migration-rehearsal/assert-clients-import-quota.sql`

**Interfaces:**
- Produces : `public.increment_client_import_quota(p_org_id uuid, p_daily_limit integer DEFAULT 30) RETURNS jsonb` → `{ count, limit, date }` ; lève `import_quota_exceeded` (P0001) au-delà. Table `majordhome.client_import_quotas(org_id uuid, date date, count integer, last_at timestamptz, PRIMARY KEY (org_id, date))`, RLS activée sans policy.

- [ ] **Step 1: Écrire l'assertion** : 30 appels passent et rendent `count` de 1 à 30, le 31ᵉ lève `import_quota_exceeded` ; une autre entreprise repart de 1 ; `p_daily_limit` NULL ou 0 ⇒ 30 ; `has_function_privilege` faux pour `anon` **et** `authenticated`, vrai pour `service_role`.
- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire la migration** sur le modèle exact d'`increment_assistant_quota` (lire sa définition en production par `pg_get_functiondef`) : même garde positive `(v_count <= v_limite) IS NOT TRUE`, date UTC, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`.
- [ ] **Step 4: Répéter, vérifier le succès.**
- [ ] **Step 5: Committer** — `feat(import clients): limite journalière de l'agent par entreprise`.

---

### Task 3: Edge `clients-import-mapping`

**Files:**
- Create: `supabase/functions/clients-import-mapping/index.ts`
- Modify: `supabase/config.toml` (`[functions.clients-import-mapping]`, `verify_jwt = true`, deux lignes de commentaire comme ses voisines)
- Test: `scripts/import-clients/agent-edge.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Consumes : `_shared/auth.ts` (`requireOrgMembership`, `jsonResponse`, `buildCorsHeaders`, `getAdminClient`, `sanitizeError`) ; `_shared/importClients/agent.js` (`demandeValide`, `construireConsigne`, `SCHEMA_REPONSE`, `lireReponse`, `CODES`) ; RPC de la Task 2.
- Produces : `POST { org_id, colonnes }` → HTTP 200 `{ data: { propositions, remarque, conso } | null, error: code | null }`.

- [ ] **Step 1: Écrire le test qui échoue** (lecture du source, comme `scripts/dpe-lien-edge.test.mjs`) :

```js
const source = readFileSync('supabase/functions/clients-import-mapping/index.ts', 'utf8');
test('tout code renvoyé par l\'edge est connu du module, et inversement', () => {
  const renvoyes = [...source.matchAll(/error:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(renvoyes)].sort(), [...CODES].sort());
});
test('l\'edge n\'écrit dans aucune table et ne lit aucune fiche', () => {
  assert.ok(!/\.from\(/.test(source));
  assert.deepEqual([...source.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]), ['increment_client_import_quota']);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** (fichier absent).
- [ ] **Step 3: Écrire l'edge.** Ordre des gardes : méthode et CORS → `org_id` au format UUID → `requireOrgMembership(req, { orgId, requiredRole: 'org_admin' })` (refus ⇒ `non_autorise`) → `demandeValide(corps)` (`demande_invalide`) → `ANTHROPIC_API_KEY` présente (`assistant_indisponible`) → quota (`quota_depasse`) → appel du modèle (délai 60 s ; délai, erreur réseau, `stop_reason` `refusal` ou `max_tokens` ⇒ `assistant_indisponible`) → `lireReponse` (`erreur` ⇒ `reponse_illisible`). Consommation journalisée comme `supplier-offer-import` (`console.log` : entreprise, modèle, jetons — **jamais** les en-têtes ni les exemples).
- [ ] **Step 4: Vérifier** — `node --test scripts/import-clients/agent-edge.test.mjs` → vert ; `deno check supabase/functions/clients-import-mapping/index.ts` si Deno est installé (sinon le dire).
- [ ] **Step 5: Committer** — `feat(import clients): edge de l'agent de correspondance`.

---

### Task 4: L'étape Correspondance appelle l'agent

**Files:**
- Modify: `src/shared/services/clientImports.service.js` (`proposeMapping({ orgId, colonnes })` → `{ data, error }`, `error.message` = le code), `src/shared/hooks/useClientImports.js` (`useProposeMapping(orgId)`, mutation déballée par `unwrapResult`), `src/apps/artisan/components/clients/import/EtapeCorrespondance.jsx`, `src/apps/artisan/components/clients/import/useParcoursImport.js` (action `propositionsRecues`)

**Interfaces:**
- Consumes : `preparerDemande`, `fusionner`, `messageErreurAgent` (Task 1) ; edge de la Task 3.

- [ ] **Step 1: Brancher l'appel.** À l'arrivée sur l'étape, **une fois par fichier déposé** (garde par référence, pas par état) : si le fichier n'est pas le fichier type et que `validerCorrespondance().aChoisir > 0`, appeler `proposeMapping(preparerDemande(correspondance, lignes))`. Changer la ligne d'en-tête relance l'appel (c'est un autre tableau).
- [ ] **Step 2: Fusionner à la réponse** : `fusionner(correspondanceCourante, propositions)` sur la correspondance **du moment** (pas celle du départ), pour garder les corrections faites entre-temps.
- [ ] **Step 3: Dire ce qui se passe**, textes exacts :
  - en cours : « Vingt lignes de votre fichier sont lues par l'assistant pour reconnaître les colonnes. » (le tableau reste modifiable) ;
  - réussi : « L'assistant a proposé N colonnes. Vérifiez-les avant de continuer. » ; chaque colonne d'origine `agent` porte la mention « proposé par l'assistant » ; `remarque` non vide affichée telle quelle en dessous ;
  - échec : `messageErreurAgent(code)`, sans fermer « Voir l'aperçu ».
- [ ] **Step 4: Vérifier** — `npm run lint`, `npx vite build`, `npm run audit:quality` → verts.
- [ ] **Step 5: Committer** — `feat(import clients): correspondance préremplie par l'assistant`.

---

### Task 5: Mise en production

**Files:**
- Modify: `CLAUDE.md` (section « Module Import des clients » : l'agent ne rend que des noms de champs ; sync + redéploiement de `clients-import-mapping` après toute modif de `champs.js` ou `agent.js` ; codes ↔ messages)

- [ ] **Step 1: Demander le oui d'Eric** pour déployer `clients-import-mapping` (une action par message). Le secret `ANTHROPIC_API_KEY` existe déjà (il sert à `supplier-offer-import`) ; `ANTHROPIC_IMPORT_MODEL` et `CLIENTS_IMPORT_DAILY_LIMIT` sont facultatifs.
- [ ] **Step 2: Appliquer la migration du quota**, contrôler `has_function_privilege('authenticated', …)` faux.
- [ ] **Step 3: Déployer l'edge** (avec `../_shared/auth.ts` et `../_shared/importClients/*.js` dans les fichiers), puis un essai réel depuis le compte Cimaj sur un export fabriqué aux en-têtes inhabituels (« Nom complet », « GSM », « CP / Ville », « Marque chaudière », « ID interne »). Attendu : nom + prénom, téléphone, code postal et ville, ajout aux notes, ignorer. Noter le coût lu dans les journaux de l'edge.
- [ ] **Step 4: Pousser et suivre Vercel** ; mettre à jour `CLAUDE.md` avec le coût mesuré.
- [ ] **Step 5: Rejouer sur le premier vrai export** d'un ancien logiciel dès qu'Eric en a un : c'est le seul essai qui dit si les synonymes et la consigne suffisent.
