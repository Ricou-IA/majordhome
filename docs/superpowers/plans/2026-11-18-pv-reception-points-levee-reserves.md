# PV de réception : points par équipement, déclaration de l'entreprise, levée des réserves — plan de construction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le PV de réception signé en ligne porte la déclaration de l'entreprise, des points confirmés par le client selon l'équipement, la référence du devis, et se prolonge par une levée des réserves signée en ligne.

**Architecture:** les points vivent dans un module pur (`src/lib/pvPoints.js`, copié pour Deno) ; chaque type d'équipement choisit son gabarit (`pricing_equipment_types.reception_profile`). La table `majordhome.chantier_pv` reçoit la préparation, les photos des points et la levée ; seules des RPC `service_role`, appelées par l'edge `chantier-pv`, l'écrivent. Les PDF sont des rendus de l'enregistrement.

**Tech Stack:** React 18 + Vite, TanStack Query v5, Tailwind, react-pdf ; Supabase (Postgres, RLS, RPC `SECURITY DEFINER`, Storage) ; edge function Deno ; tests `node --test` ; harnais `scripts/migration-rehearsal/`.

**Spec:** `docs/superpowers/specs/2026-11-18-pv-reception-points-levee-reserves-design.md` (à lire avec `2026-11-17-chantier-apres-vente-pv-en-ligne-design.md` et `CLAUDE.md`).

## Global Constraints

- **Aucun texte PROFEEL** : les textes des points sont ceux de la spécification, recopiés tels quels.
- **L'application n'écrit jamais dans `majordhome.chantier_pv`** : RPC `SECURITY DEFINER`, `SET search_path = majordhome, public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`. Droits vérifiés par `has_function_privilege`, jamais en relisant le SQL.
- Refus métier d'une RPC = retour `{ ok: false, code }`, jamais un `RAISE`.
- Vues `public.majordhome_*` : `WITH (security_invoker = true)` répété à chaque `CREATE OR REPLACE`, colonnes ajoutées **en fin de liste**, `REVOKE ALL … FROM PUBLIC, anon`.
- Aucune réponse présélectionnée dans la déclaration de l'entreprise ; aucun point du client obligatoire.
- Un PV signé relit ses propres points (colonnes `jsonb` avec le texte recopié), jamais les gabarits du jour.
- La page publique ne reçoit ni montant, ni note interne, ni téléphone ou e-mail du client.
- Modules purs sans import ni alias Vite (exécutables sous Deno) ; copies `_shared/` produites par `npm run sync:tournee-engine`, jamais éditées à la main.
- Textes imprimés sans caractère hors Helvetica (pas d'espace fine, de flèche, de lettre grecque).
- Composant ≤ 500 lignes ; mutations via `unwrapResult` ; clés de cache de `cacheKeys.js` ; `logger`, pas de `console.*` côté front.
- Tout fichier contenant des barres obliques inverses s'écrit avec l'outil d'écriture, pas par heredoc.
- Commits par chemin (`git commit -- <fichiers>`), jamais `git add -A` ; dépôt partagé avec d'autres sessions sur `main`.
- **Aucun déploiement de l'edge `chantier-pv` sans le oui d'Eric** (CLI ou connecteur). La migration s'applique après répétition sur le harnais.

## Review Focus

1. **Chantier sans type et sans devis validé** : le PV se prépare et se signe quand même, avec le gabarit `generique` et sans ligne « Devis ». → tests des tâches 1 et 2 (assertion 3).
2. **Préparation modifiée pendant que le client a la page ouverte** : une clé de point devenue étrangère au gabarit est refusée (`point_inconnu`), la page se recharge et rien n'est enregistré à moitié. → test de la tâche 1 (`figerPointsClient`), comportement des tâches 4 et 8.
3. **Levée signée deux fois** (double appui, deux onglets) : la seconde reçoit `levee_deja_signee`, la première reste intacte. → harnais, tâche 2.
4. **PV signé sur tablette avec réserves** (fichier archivé, aucune ligne `chantier_pv` signée) : ni réponse aux réserves ni demande de levée ne sont proposées. → test de `reperePv` et de `suiteDesReserves`, tâche 7.
5. **Date d'engagement** : antérieure au jour de la signature ⇒ refus `echeance_invalide` ; passée mais postérieure à la signature ⇒ acceptée. → tests des tâches 2 et 3.

---

## Carte des fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `src/lib/pvPoints.js` (créé) | gabarits, points, complétude, photos figées, garanties | 1 |
| `scripts/pv-points.test.mjs` (créé) | tests du module | 1 |
| `scripts/sync-tournee-engine.mjs`, `package.json` | copie Deno, `audit:quality` | 1 |
| `supabase/migrations/20261118_1_chantier_pv_points_levee.sql` (créé) | colonnes, trigger, RPC, vues, gabarit par type, règles du dossier `interventions` | 2 |
| `supabase/migrations/20260920_1_referentiel_equipements_contraction.sql` | vue des types : porte `reception_profile` | 2 |
| `scripts/migration-rehearsal/assert-chantier-pv-points.sql` (créé), `snapshot.mjs` | répétition | 2 |
| `src/lib/pvReception.js`, `scripts/pv-reception.test.mjs` | validation, codes, données des deux PDF, gabarit d'e-mail de levée | 3 |
| `supabase/functions/chantier-pv/index.ts` | actions `preparer`, `repondre_reserves`, `demander_levee`, `signer_levee` | 4 |
| `src/shared/services/chantierPv.service.js`, `chantiers.service.js`, `src/shared/hooks/useChantiers.js` | appels, chemins d'archivage, mutations | 5 |
| `src/apps/artisan/components/chantiers/PvReceptionPDF.jsx`, `PvLeveeReservesPDF.jsx` (créé) | rendus | 6 |
| `…/chantiers/PreparerPvDialog.jsx` (créé), `ChantierPvReserves.jsx` (créé), `ChantierPvSection.jsx`, `src/lib/chantierApresVente.js` | bureau | 7 |
| `src/pages/PvReception.jsx`, `src/pages/pv/*.jsx` (créés) | page du client | 8 |
| `…/settings/equipements/TypesTab.jsx`, `…/settings/communication/EmailsTab.jsx` | paramètres | 9 |
| `CLAUDE.md`, la spécification | règles durables, « Livré » | 10 |

---

### Task 1: Module pur des points de réception

**Files:**
- Create: `src/lib/pvPoints.js`
- Test: `scripts/pv-points.test.mjs`
- Modify: `scripts/sync-tournee-engine.mjs` (ajouter `'pvPoints'` à `PARTAGES`), `package.json` (ajouter `scripts/pv-points.test.mjs` à `audit:quality`)

**Interfaces:**
- Produces:
  - `GABARITS_RECEPTION: readonly string[]` = `['poele_granules','poele_buches','pac_air_air','pac_air_eau','chauffe_eau','generique']`
  - `GABARIT_GENERIQUE = 'generique'`
  - `LIBELLES_GABARIT: Record<string,string>` (« Poêle à granulés », « Poêle à bois ou insert », « Climatisation, PAC air / air », « PAC air / eau », « Chauffe-eau », « Générique »)
  - `REPONSES_ENTREPRISE = ['oui','non','sans_objet']`, `LIBELLE_REPONSE = { oui: 'oui', non: 'non', sans_objet: 'sans objet' }`
  - `GARANTIES_RECEPTION: readonly string[]` (trois phrases : parfait achèvement 1 an, bon fonctionnement 2 ans, décennale 10 ans, à compter de la signature)
  - `normaliserGabarit(code) → string` (code inconnu, vide ou nul ⇒ `'generique'`)
  - `pointsDuGabarit(code) → { gabarit: string, client: {cle,texte}[], entreprise: {cle,texte}[] }` (communs puis propres, ordre de la spécification)
  - `declarationComplete(code, reponses: Record<string,string>) → boolean`
  - `figerDeclaration(code, reponses) → { ok: true, points: {cle,texte,reponse}[] } | { ok: false, code: 'declaration_incomplete' | 'point_inconnu' }`
  - `figerPointsClient(code, clesConfirmees: string[]) → { ok: true, points: {cle,texte,confirme}[] } | { ok: false, code: 'point_inconnu' }`

- [ ] **Step 1: Écrire les tests** (`scripts/pv-points.test.mjs`)

```js
test('six gabarits, le générique en dernier', () => {
  assert.deepEqual([...GABARITS_RECEPTION], ['poele_granules','poele_buches','pac_air_air','pac_air_eau','chauffe_eau','generique']);
  for (const g of GABARITS_RECEPTION) assert.ok(LIBELLES_GABARIT[g]);
});
test('générique : les points communs seuls, dans l\'ordre', () => {
  const p = pointsDuGabarit('generique');
  assert.deepEqual(p.client.map((x) => x.cle), ['c_notice','c_demonstration','c_entretien']);
  assert.deepEqual(p.entreprise.map((x) => x.cle), ['e_mise_en_service','e_conforme_devis']);
});
test('poêle à granulés : communs puis propres', () => {
  const p = pointsDuGabarit('poele_granules');
  assert.deepEqual(p.client.map((x) => x.cle), ['c_notice','c_demonstration','c_entretien','c_combustible','c_amenee_air']);
  assert.deepEqual(p.entreprise.map((x) => x.cle), ['e_mise_en_service','e_conforme_devis','e_conduit','e_distances','e_reglages','e_differentiel']);
});
test('code inconnu, vide ou nul : générique', () => {
  for (const c of ['inconnu', '', null, undefined]) assert.equal(pointsDuGabarit(c).gabarit, 'generique');
});
test('clés uniques par gabarit, textes non vides et sûrs pour le PDF', () => {
  for (const g of GABARITS_RECEPTION) {
    const { client, entreprise } = pointsDuGabarit(g);
    const cles = [...client, ...entreprise].map((x) => x.cle);
    assert.equal(new Set(cles).size, cles.length);
    for (const x of [...client, ...entreprise]) assert.match(x.texte, /^[\x20-\x7E -ÿ’œ]+$/);
  }
  for (const t of GARANTIES_RECEPTION) assert.match(t, /^[\x20-\x7E -ÿ’œ]+$/);
});
test('déclaration : rien n\'est supposé', () => {
  assert.equal(declarationComplete('generique', {}), false);
  assert.equal(declarationComplete('generique', { e_mise_en_service: 'oui' }), false);
  assert.equal(declarationComplete('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'sans_objet' }), true);
  assert.equal(declarationComplete('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'peut-etre' }), false);
});
test('figer la déclaration : texte repris du module, clé étrangère refusée', () => {
  const r = figerDeclaration('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'non' });
  assert.deepEqual(r.points[1], { cle: 'e_conforme_devis', texte: pointsDuGabarit('generique').entreprise[1].texte, reponse: 'non' });
  assert.deepEqual(figerDeclaration('generique', { e_mise_en_service: 'oui' }), { ok: false, code: 'declaration_incomplete' });
  assert.deepEqual(figerDeclaration('generique', { e_mise_en_service: 'oui', e_conforme_devis: 'oui', e_conduit: 'oui' }), { ok: false, code: 'point_inconnu' });
});
test('figer les points du client : non coché = non confirmé, clé étrangère refusée', () => {
  const r = figerPointsClient('generique', ['c_notice']);
  assert.deepEqual(r.points.map((p) => p.confirme), [true, false, false]);
  assert.deepEqual(figerPointsClient('generique', ['c_filtres']), { ok: false, code: 'point_inconnu' });
  assert.equal(figerPointsClient('generique', []).ok, true);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test scripts/pv-points.test.mjs` → échec « Cannot find module ».
- [ ] **Step 3: Écrire `src/lib/pvPoints.js`** avec les textes de la spécification (section « Les gabarits et leurs points »), apostrophes droites, objets gelés, JSDoc sur chaque export (Deno lit les JSDoc).
- [ ] **Step 4: Lancer, vérifier le succès** — même commande → tous verts.
- [ ] **Step 5: Copie Deno et audit** — ajouter `'pvPoints'` à `PARTAGES`, le test à `audit:quality` ; `npm run sync:tournee-engine` puis `node --test scripts/tournee/sync-engine.test.mjs` → vert ; `supabase/functions/_shared/pvPoints.js` existe.
- [ ] **Step 6: Commit** — `feat(chantiers): gabarits de points du PV de réception (module pur)`.

---

### Task 2: Base — préparation, photos des points, levée, gabarit par type, dossier `interventions`

**Files:**
- Create: `supabase/migrations/20261118_1_chantier_pv_points_levee.sql`
- Create: `scripts/migration-rehearsal/assert-chantier-pv-points.sql`
- Modify: `supabase/migrations/20260920_1_referentiel_equipements_contraction.sql` (la vue recréée y porte `reception_profile` en fin)
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (si le snapshot est repris après le 17 : ajouter à `FUNCTIONS` les trois RPC `chantier_pv_*` existantes)

**Interfaces:**
- Consumes: `majordhome.quote_status_bucket(text)`, `majordhome.lead_pennylane_quotes(chantier_id, quote_label, quote_date, quote_status, ejected_at)`.
- Produces:
  - `pricing_equipment_types.reception_profile text NOT NULL DEFAULT 'generique'` + CHECK sur les six codes ; `public.majordhome_pricing_equipment_types.reception_profile` (dernière colonne).
  - `chantier_pv` : `gabarit text`, `points_entreprise jsonb`, `prepare_at timestamptz`, `prepare_par uuid`, `devis jsonb`, `points_client jsonb`, `reserves_reponse text`, `reserves_echeance date`, `reserves_repondu_at timestamptz`, `reserves_repondu_par uuid`, `levee_demandee_at timestamptz`, `levee_sent_to text`, `levee_sent_count integer NOT NULL DEFAULT 0`, `levee_signed_at timestamptz`, `levee_signataire_nom text`, `levee_signature_png text`.
  - `chantiers.pv_levee_path text`.
  - `public.chantier_pv_contexte(uuid, boolean)` (signature inchangée) rend en plus `gabarit_type` (profil du type ou `null`), `devis` (`[{libelle, date}]`, devis validés non éjectés, triés par date), et dans `pv` toutes les nouvelles colonnes.
  - `public.chantier_pv_preparer(p_chantier_id uuid, p_gabarit text, p_points jsonb, p_user uuid) → jsonb` : `{ok:true, prepare_at}` ; codes `chantier_introuvable`, `deja_signe`, `declaration_incomplete` (tableau vide, élément sans `cle`/`texte`, `reponse` hors des trois valeurs), `gabarit_inconnu`.
  - `public.chantier_pv_signer(uuid, jsonb)` (signature inchangée) : nouveau refus `pv_non_prepare` si `points_entreprise IS NULL` ; lit `p_payload->'points_client'` (tableau `[{cle,texte,confirme}]`, absent ⇒ `[]`) ; photographie `devis`. N'écrit plus les trois booléens.
  - `public.chantier_pv_repondre_reserves(p_chantier_id uuid, p_reponse text, p_echeance date, p_user uuid) → jsonb` : codes `chantier_introuvable`, `pas_de_reserves`, `levee_deja_signee`, `reponse_vide` (ni texte ni date), `texte_trop_long` (> 2000), `echeance_invalide` (date < jour de `signed_at` à l'heure de Paris).
  - `public.chantier_pv_marquer_levee(p_chantier_id uuid, p_sent_to text, p_user uuid) → jsonb` : pose `levee_demandee_at` s'il est nul ; `p_sent_to` non vide ⇒ `levee_sent_to` et `levee_sent_count + 1` ; codes `chantier_introuvable`, `pas_de_reserves`, `levee_deja_signee`.
  - `public.chantier_pv_signer_levee(p_chantier_id uuid, p_payload jsonb) → jsonb` : `{ok:true}` ; codes `chantier_introuvable`, `pas_de_reserves`, `levee_non_demandee`, `levee_deja_signee`, `nom_requis`, `signature_requise` (mêmes bornes que `chantier_pv_signer`).
  - `public.majordhome_chantier_pv` : nouvelles colonnes en fin. `public.majordhome_chantiers` : `pv_reserves_levees_at`, `pv_levee_path` en fin. `public.majordhome_chantiers_write` recréée (elle est un `SELECT *`).
  - Règles Storage `interventions_org_select|insert|update|delete` : `bucket_id = 'interventions' AND ((storage.foldername(name))[1])::uuid IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())` ; les quatre `org_members_*_interventions` sont supprimées.

- [ ] **Step 1: Écrire l'assertion** `assert-chantier-pv-points.sql` (autonome, sur le modèle d'`assert-chantier-pv.sql` : crée son lead, ses chantiers, un devis validé `D-TEST-1` et un devis refusé). Elle lève une exception si l'un de ces faits est faux :
  1. signer sans préparation ⇒ `pv_non_prepare` ;
  2. `chantier_pv_preparer` avec `[]` ⇒ `declaration_incomplete` ; avec une réponse `peut-etre` ⇒ `declaration_incomplete` ; avec un gabarit `inconnu` ⇒ `gabarit_inconnu` ; complet ⇒ `ok`, ligne créée avec `prepare_par` ;
  3. `chantier_pv_contexte` rend `devis` = un seul élément `D-TEST-1` (le refusé n'y est pas) et `gabarit_type` du type du chantier ; chantier sans type ⇒ `gabarit_type` nul ; chantier sans devis ⇒ `devis` = `[]` et la signature passe ;
  4. signature avec `points_client` ⇒ colonnes `points_client`, `devis` remplies, `info_recues` nul ;
  5. après signature : `UPDATE` de `points_entreprise`, `points_client`, `devis` ou `gabarit` ⇒ exception `pv_signe` ; `chantier_pv_preparer` ⇒ `deja_signe` ;
  6. réponse aux réserves : sur un PV sans réserves ⇒ `pas_de_reserves` ; ni texte ni date ⇒ `reponse_vide` ; date = veille de la signature ⇒ `echeance_invalide` ; date = jour de la signature ⇒ `ok` ;
  7. `chantier_pv_signer_levee` avant demande ⇒ `levee_non_demandee` ; après `chantier_pv_marquer_levee` ⇒ `ok` ; une seconde fois ⇒ `levee_deja_signee` ; `UPDATE` de `levee_signature_png` ou `reserves_reponse` ensuite ⇒ exception ;
  8. `majordhome_chantiers.pv_reserves_levees_at` non nul pour ce chantier ; `is_insertable_into` de `majordhome_chantiers_write` = `YES` ;
  9. `has_function_privilege('anon' | 'authenticated', …, 'EXECUTE')` faux pour les six RPC ; vrai pour `service_role` ;
  10. règles Storage (recréées par l'assertion si le substitut du harnais ne les porte pas) : membre de l'org A, insertion d'un objet `A/pv-reception/x.pdf` acceptée, `B/pv-reception/x.pdf` refusée, `pv-reception/x.pdf` (sans org) refusée.
- [ ] **Step 2: Lancer, vérifier l'échec** — `node scripts/migration-rehearsal/run.mjs --migrations supabase/migrations/20261117_3_chantier_pv_en_ligne.sql --assert scripts/migration-rehearsal/assert-chantier-pv-points.sql` (retirer `20261117_3` de la chaîne si le snapshot la contient déjà) → échec sur la colonne ou la fonction absente.
- [ ] **Step 3: Écrire la migration.** Points qui ne se devinent pas :
  - la vue `majordhome_pricing_equipment_types` se recrée depuis sa définition **de production** (`pg_get_viewdef`), qui porte encore `equipment_category` en 6ᵉ position ; `reception_profile` en fin ;
  - valeur de départ du gabarit, pour toutes les organisations, d'après le code du type et le profil de certificat de sa catégorie ; **lister le résultat** (`SELECT org_id, code, label, reception_profile`) et le relire type par type avant d'appliquer ; un type non reconnu reste `generique` ;
  - trigger `chantier_pv_signature_figee` : ajouter aux colonnes figées après `signed_at` : `gabarit`, `points_entreprise`, `points_client`, `devis` ; et, dès que `OLD.levee_signed_at` n'est pas nul : `levee_signed_at`, `levee_signataire_nom`, `levee_signature_png`, `reserves_reponse`, `reserves_echeance` ;
  - CHECK `chantier_pv_levee_complete` : `levee_signed_at IS NULL OR (signed_at IS NOT NULL AND reception_type = 'avec_reserves' AND levee_signataire_nom IS NOT NULL AND levee_signature_png IS NOT NULL)` ;
  - `REVOKE ALL … FROM baikal_reader` reste valable (table existante) ; pas de nouvelle table.
- [ ] **Step 4: Mettre à jour `20260920_1`** : `reception_profile` ajouté en fin de la vue recréée. Vérifier par lecture que rien d'autre ne change dans ce fichier.
- [ ] **Step 5: Lancer la répétition** — même commande, chaîne `20261117_3` (si besoin) + `20261118_1` → `assert-chantier-pv-points : OK`. Puis rejouer `assert-chantier-pv.sql` adapté (il signait sans préparation : lui ajouter une préparation avant chaque signature attendue réussie) → OK.
- [ ] **Step 6: Commit** — `feat(chantiers): base du PV complété — préparation, points, levée des réserves, dossier interventions réparé`.
- [ ] **Step 7: Appliquer en production** (connecteur, `apply_migration`), puis vérifier : `to_regclass`, colonnes, `has_function_privilege('anon', …)` faux pour les six RPC, `pg_policies` du dossier `interventions` (quatre règles `interventions_org_*`, plus aucune `org_members_*_interventions`), liste des gabarits par type. Tant que l'edge n'est pas redéployée, la signature en ligne répond `pv_non_prepare` : sans effet, aucun lien n'a jamais été envoyé.

---

### Task 3: Règles pures du PV — validation, codes, données des deux PDF

**Files:**
- Modify: `src/lib/pvReception.js`
- Test: `scripts/pv-reception.test.mjs`

**Interfaces:**
- Consumes: rien de `pvPoints.js` (ce fichier reste sans import ; l'edge et l'écran assemblent les deux).
- Produces:
  - `PV_LEVEE_TEMPLATE_KEY = 'pv_levee_reserves'`, `DEFAULT_PV_LEVEE_EMAIL` (même forme que `DEFAULT_PV_RECEPTION_EMAIL`, variables `{{PRENOM}}`, `{{OBJET}}`, `{{LIEN_PV}}`)
  - `normaliserReponsePv(reponse)` rend en plus `points_confirmes: string[]` (chaînes non vides, dédoublonnées, 30 au plus) et ne rend plus les trois booléens
  - `validerReponseLevee(reponse) → string|null` (`nom_requis`, `signature_requise`, mêmes bornes que le PV)
  - `validerReponseReserves({ reponse, echeance }, jourSignature) → string|null` (`reponse_vide`, `texte_trop_long`, `echeance_invalide` : format `YYYY-MM-DD` invalide ou date < `jourSignature`)
  - `donneesPdfPv(…)` rend en plus `devis: {libelle, date}[]` (date en toutes lettres), `pointsEntreprise: {texte, reponse}[]`, `pointsClient: {texte, confirme}[]` ; les trois booléens ne sont renseignés que si `signature.points_client` est absent (PV sur tablette)
  - `donneesPdfLevee({ chantierId, client, objet, entreprise, pv }) → { numero, date, pvNumber, pvDate, clientName, clientAddress, clientPostalCode, clientCity, equipmentLabel, devis, reservesNature, reservesTravaux, reponse, echeance, signatureNom, signatureBase64, entreprise, lieu }` (`numero` = `LR-` + 8 premiers caractères de l'id en majuscules ; `reponse` et `echeance` à `null` quand absentes)
  - messages pour : `pv_non_prepare`, `declaration_incomplete`, `point_inconnu`, `gabarit_inconnu`, `pas_de_reserves`, `levee_non_demandee`, `levee_deja_signee`, `echeance_invalide`, `reponse_vide`

- [ ] **Step 1: Écrire les tests** (ajouts)

```js
test('normalisation : clés confirmées dédoublonnées, plus de booléens', () => {
  const r = normaliserReponsePv({ ...complete, points_confirmes: ['c_notice', 'c_notice', '', 7] });
  assert.deepEqual(r.points_confirmes, ['c_notice']);
  assert.equal('info_recues' in r, false);
});
test('réserves : au moins un des deux, date jamais avant la signature', () => {
  assert.equal(validerReponseReserves({ reponse: ' ', echeance: null }, '2026-11-20'), 'reponse_vide');
  assert.equal(validerReponseReserves({ reponse: '', echeance: '2026-11-19' }, '2026-11-20'), 'echeance_invalide');
  assert.equal(validerReponseReserves({ reponse: '', echeance: '2026-11-20' }, '2026-11-20'), null);
  assert.equal(validerReponseReserves({ reponse: 'Reprise du joint', echeance: null }, '2026-11-20'), null);
  assert.equal(validerReponseReserves({ reponse: 'x', echeance: '20/11/2026' }, '2026-11-20'), 'echeance_invalide');
});
test('levée : nom et signature, mêmes bornes que le PV', () => {
  assert.equal(validerReponseLevee({ signataire_nom: '', signature_png: sig }), 'nom_requis');
  assert.equal(validerReponseLevee({ signataire_nom: 'Marie Durand', signature_png: 'x' }), 'signature_requise');
  assert.equal(validerReponseLevee({ signataire_nom: 'Marie Durand', signature_png: sig }), null);
});
test('PDF du PV : points et devis lus dans l\'enregistrement', () => {
  const d = donneesPdfPv({ …base, signature: { …signee, devis: [{ libelle: 'D-2026-0412', date: '2026-09-03' }],
    points_entreprise: [{ cle: 'e_mise_en_service', texte: 'T1', reponse: 'sans_objet' }],
    points_client: [{ cle: 'c_notice', texte: 'T2', confirme: false }] } });
  assert.deepEqual(d.devis, [{ libelle: 'D-2026-0412', date: '3 septembre 2026' }]);
  assert.deepEqual(d.pointsEntreprise, [{ texte: 'T1', reponse: 'sans objet' }]);
  assert.deepEqual(d.pointsClient, [{ texte: 'T2', confirme: false }]);
});
test('PDF de levée : réponse et échéance absentes restent nulles', () => {
  const d = donneesPdfLevee({ …base, pv: { …avecReserves, levee_signed_at: '2026-12-01T10:00:00Z', levee_signataire_nom: 'Marie Durand', levee_signature_png: sig } });
  assert.equal(d.numero, 'LR-' + base.chantierId.slice(0, 8).toUpperCase());
  assert.equal(d.reponse, null); assert.equal(d.echeance, null);
  assert.equal(d.date, '1er décembre 2026');
});
test('chaque code nouveau a un message', () => {
  for (const c of ['pv_non_prepare','declaration_incomplete','point_inconnu','gabarit_inconnu','pas_de_reserves','levee_non_demandee','levee_deja_signee','echeance_invalide','reponse_vide']) {
    assert.notEqual(messagePv(c, 'DEFAUT'), 'DEFAUT');
  }
});
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test scripts/pv-reception.test.mjs`.
- [ ] **Step 3: Écrire le code** dans `src/lib/pvReception.js` ; adapter les deux tests existants qui lisent `info_recues` (ils décrivent désormais le cas « sans `points_client` »).
- [ ] **Step 4: Lancer, vérifier le succès**, puis `npm run sync:tournee-engine` et `node --test scripts/tournee/sync-engine.test.mjs`.
- [ ] **Step 5: Commit** — `feat(chantiers): règles pures du PV complété et de la levée des réserves`.

---

### Task 4: Edge `chantier-pv`

**Files:**
- Modify: `supabase/functions/chantier-pv/index.ts`

**Interfaces:**
- Consumes: `_shared/pvPoints.js` (`normaliserGabarit`, `pointsDuGabarit`, `figerDeclaration`, `figerPointsClient`, `GARANTIES_RECEPTION`, `LIBELLE_REPONSE`), `_shared/pvReception.js` (tâche 3), RPC de la tâche 2.
- Produces (corps JSON, toutes en `POST` sauf la lecture) :
  - `{ action: 'preparer', org_id, chantier_id, reponses: Record<string,string> }` → `{ prepare_at }` ; le gabarit vient **du type du chantier** (`ctx.gabarit_type`), jamais du corps.
  - `envoyer`, `lien` : refus `pv_non_prepare` (400) si `ctx.pv?.points_entreprise` est absent.
  - `{ action: 'repondre_reserves', org_id, chantier_id, reponse, echeance }` → `{ ok: true }`.
  - `{ action: 'demander_levee', org_id, chantier_id, mode: 'email' | 'lien' }` → `email` : `{ sent_to }` (gabarit `pv_levee_reserves`, mêmes gardes que `envoyer`) ; `lien` : `{ url, expires_at }` ; les deux appellent `chantier_pv_marquer_levee`.
  - `GET ?token=` rend en plus : `pret: boolean`, `devis`, `declaration: {texte, reponse}[]` (réponse en toutes lettres), `points_client: {cle, texte}[]` (du gabarit de la préparation tant que ce n'est pas signé), `garanties: string[]`, `reserves: { reponse, echeance } | null`, `levee: { demandee: boolean, signed_at, signataire_nom, signature_png } | null` ; dans `signature`, `points_client` remplace les trois booléens.
  - `{ action: 'signer', token, reponse }` : `figerPointsClient(pv.gabarit, reponse.points_confirmes)` ; refus `point_inconnu` (409).
  - `{ action: 'signer_levee', token, reponse: { signataire_nom, signature_png } }` → `{ ok: true, pv }`.
- Statuts HTTP : 409 pour `deja_signe`, `levee_deja_signee`, `point_inconnu` ; 404 pour `chantier_introuvable` ; 400 pour les autres refus.

- [ ] **Step 1: Garde du bureau** — `gardeBureau(req, body, { admettreSigne })` : `lien`, `repondre_reserves`, `demander_levee` passent `admettreSigne: true` ; `lien` sur un PV signé **sans** réserves garde le refus `deja_signe`.
- [ ] **Step 2: Écrire les quatre actions et étendre `pourLaPage`, `actionSigner`, `actionEnvoyer`, `actionLien`.** Limite de débit : mêmes compteurs, clés `preparer:`, `levee:`.
- [ ] **Step 3: Vérifier le typage** — `deno check supabase/functions/chantier-pv/index.ts` (Deno est installé sur ce poste) → aucune erreur.
- [ ] **Step 4: Test du refus sans déploiement** — `node --test scripts/pv-points.test.mjs scripts/pv-reception.test.mjs` (les règles que l'edge applique) → verts. L'edge elle-même n'est éprouvée qu'après déploiement.
- [ ] **Step 5: Commit** — `feat(chantiers): edge chantier-pv — préparation, réponse aux réserves, levée`.
- [ ] **Step 6: Demander à Eric l'accord de déployer `chantier-pv`.** Sur son oui : déployer (copie du dépôt, ce qui réaligne aussi l'écart signalé le 17), puis éprouver en production les refus sans compte : `GET` sans jeton ⇒ 400 ou 401, `signer_levee` avec un jeton invalide ⇒ `invalid_token`, `preparer` sans `Authorization` ⇒ 401. Sans réponse, continuer les tâches suivantes et le redire à la fin.

---

### Task 5: Service, hooks, chemins d'archivage

**Files:**
- Modify: `src/shared/services/chantierPv.service.js`, `src/shared/services/chantiers.service.js`, `src/shared/hooks/useChantiers.js`

**Interfaces:**
- Produces (service, tous `{ data, error }`) : `preparer({ orgId, chantierId, reponses })`, `repondreReserves({ orgId, chantierId, reponse, echeance })`, `demanderLevee({ orgId, chantierId, mode })`, `genererPdfLevee({ orgId, chantier, company }) → { blob, archive }`.
- Produces (hook `useChantierPvMutations`) : `preparerPv`, `repondreReservesPv`, `demanderLeveePv`, `genererPdfLeveePv` et leurs `is…` ; chacun invalide `chantierKeys.all(orgId)`.
- Chemins : `${orgId}/pv-reception/${chantierId}/PV_Reception_en_ligne.pdf`, `${orgId}/pv-reception/${chantierId}/PV_Reception_${Date.now()}.${ext}` (tablette), `${orgId}/pv-levee/${chantierId}/PV_Levee_reserves.pdf` ; `updatePvLeveePath(orgId, chantierId, chemin)` écrit `pv_levee_path` par `majordhome_chantiers_write`.

- [ ] **Step 1: Écrire le service et les mutations** (`unwrapResult` dans chaque `mutationFn`).
- [ ] **Step 2: Vérifier** — `npm run lint:errors` → 0 erreur ; `grep -rn "pv-reception/" src` ne montre plus aucun chemin sans `${orgId}/` en tête.
- [ ] **Step 3: Commit** — `feat(chantiers): service du PV complété, archivage par organisation`.

---

### Task 6: PDF — PV de réception enrichi et PV de levée des réserves

**Files:**
- Modify: `src/apps/artisan/components/chantiers/PvReceptionPDF.jsx`
- Create: `src/apps/artisan/components/chantiers/PvLeveeReservesPDF.jsx`

**Interfaces:**
- Consumes: `donneesPdfPv`, `donneesPdfLevee` (tâche 3), `GARANTIES_RECEPTION` (tâche 1).
- Produces: `generatePvReceptionPdfBlob(data, company)` (inchangé) ; `generatePvLeveePdfBlob(data, company) → Promise<Blob>`.

- [ ] **Step 1: PV de réception** — sous « Objet des travaux », une ligne par devis (« Devis D-2026-0412 du 3 septembre 2026 ») ; si `data.pointsEntreprise?.length` : bloc « L'entreprise déclare » (texte, puis « oui », « non » ou « sans objet ») et bloc « Le client confirme » (case cochée ou vide) **à la place** des trois cases ; sinon les trois cases comme aujourd'hui. Bloc « Garanties » : les trois phrases. Le composant ne calcule rien.
- [ ] **Step 2: PV de levée** — une page : en-tête, entreprise et client, « Levée des réserves du procès-verbal `pvNumber` du `pvDate` », devis, réserves du client, réponse et date d'engagement **seulement si présentes**, phrase « Le client constate que les réserves ci-dessus sont levées. », date, nom et signature. Réutiliser les styles du PV (les extraire dans le même dossier si le fichier dépasse 500 lignes).
- [ ] **Step 3: Vérifier le rendu** — rendre les deux PDF avec les données d'exemple des tests (harnais de rendu décrit dans la mémoire « Rendu react-pdf → PNG »), lire les deux images : aucun caractère abîmé, aucun bloc coupé en bas de page avec six points d'entreprise et cinq points de client.
- [ ] **Step 4: Commit** — `feat(chantiers): PDF du PV avec points et PV de levée des réserves`.

---

### Task 7: Bureau — préparer, répondre aux réserves, demander la levée

**Files:**
- Create: `src/apps/artisan/components/chantiers/PreparerPvDialog.jsx`, `src/apps/artisan/components/chantiers/ChantierPvReserves.jsx`
- Modify: `src/apps/artisan/components/chantiers/ChantierPvSection.jsx`, `src/lib/chantierApresVente.js`
- Test: `scripts/chantier-apres-vente.test.mjs`

**Interfaces:**
- Consumes: tâches 1, 3, 5 ; `useEquipmentReferential()` (types avec `reception_profile`).
- Produces: `reperePv(chantier)` rend, quand `pv_reserves_levees_at` est posé, `{ cle: 'pv', libelle: 'PV', etat: 'fait', titre: 'Réserves levées le …' }` ; `suiteDesReserves(chantier, pv) → 'aucune' | 'a_repondre' | 'a_lever' | 'levee_demandee' | 'levee_signee'` (`'aucune'` dès que le PV n'a pas été signé **en ligne** avec réserves).

- [ ] **Step 1: Écrire les tests**

```js
test('repère PV : réserves levées = fait', () => {
  const r = reperePv({ pv_signed_at: 'x', pv_avec_reserves: true, pv_reserves_levees_at: '2026-12-01T10:00:00Z' });
  assert.equal(r.etat, 'fait'); assert.match(r.titre, /^Réserves levées le /);
});
test('suite des réserves : rien pour un PV sur tablette, étapes pour un PV en ligne', () => {
  assert.equal(suiteDesReserves({ pv_reception_path: 'p', pv_avec_reserves: false }, null), 'aucune');
  const c = { pv_signed_at: 'x', pv_avec_reserves: true };
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves' }), 'a_repondre');
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves', reserves_repondu_at: 'x' }), 'a_lever');
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves', levee_demandee_at: 'x' }), 'levee_demandee');
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves', levee_signed_at: 'x' }), 'levee_signee');
  assert.equal(suiteDesReserves(c, undefined), 'aucune'); // détail pas encore chargé : on ne propose rien
});
```

- [ ] **Step 2: Lancer, vérifier l'échec, écrire le code, vérifier le succès** — `node --test scripts/chantier-apres-vente.test.mjs`.
- [ ] **Step 3: `PreparerPvDialog`** — props `{ open, onOpenChange, chantier, canEdit, onUpdated }`. Contenu de la spécification (« Le bureau prépare le PV ») : équipement (sélecteur du type si absent, écrit par la mutation existante de la fiche), devis en lecture, points de l'entreprise avec trois boutons radio **non cochés** par point, bouton « Tout est fait », reprise de la préparation existante (`pv.points_entreprise`). « Envoyer au client » et « Copier le lien » fermés tant que `declarationComplete` est faux, avec la phrase « Répondez à chaque point pour envoyer le PV. » ; chacun enchaîne `preparerPv` puis `envoyerPv` ou `lienPv`. « Envoyer » masqué si le module Communication est fermé.
- [ ] **Step 4: `ChantierPvReserves`** — affiché selon `suiteDesReserves` : formulaire « Répondre aux réserves » (texte, date, validation par `validerReponseReserves`, modifiable jusqu'à `levee_signee`) ; boutons « Demander la levée par e-mail » et « Copier le lien » **dès `a_repondre`** (répondre n'est pas un préalable) ; états « Levée demandée le … » et « Réserves levées le … par … » avec « Voir le PV de levée ». `aucune` ⇒ le composant ne rend rien.
- [ ] **Step 5: `ChantierPvSection`** — les deux boutons d'envoi ouvrent `PreparerPvDialog` ; le détail du PV se charge dès que `chantier.pv_sent_at`, `pv_signed_at` **ou l'ouverture de la fenêtre** ; rester sous 250 lignes.
- [ ] **Step 6: Vérifier** — `npx vite build` → succès ; `npm run lint` → pas de nouvel avertissement.
- [ ] **Step 7: Commit** — `feat(chantiers): préparer le PV, répondre aux réserves, demander leur levée`.

---

### Task 8: Page du client

**Files:**
- Modify: `src/pages/PvReception.jsx` (assemble seulement)
- Create: `src/pages/pv/PvDeclaration.jsx`, `src/pages/pv/PvPointsClient.jsx`, `src/pages/pv/PvLevee.jsx`, `src/pages/pv/PvRecapitulatif.jsx` (extrait du fichier actuel)

**Interfaces:**
- Consumes: réponse de `GET ?token=` (tâche 4), `validerReponsePv`, `validerReponseLevee`, `messagePv`.
- États de la page : `chargement`, `erreur`, `pas_pret` (`pret === false`), `formulaire`, `envoi`, `signe`, `levee` (`levee.demandee` et pas encore signée), `levee_signee`.

- [ ] **Step 1: Découper** `Recapitulatif` vers `src/pages/pv/PvRecapitulatif.jsx` sans changer son comportement ; `npx vite build`.
- [ ] **Step 2: Formulaire** dans l'ordre de la spécification : travaux et devis, « Ce que déclare votre installateur » (lecture), décision, « Ce que vous confirmez » (cases décochées, facultatives ; l'état porte `points_confirmes: string[]`), garanties, signature. Refus `point_inconnu` (409) ⇒ recharger la page et afficher « Le procès-verbal a été mis à jour par votre installateur : relisez-le avant de signer. ».
- [ ] **Step 3: États `pas_pret`, `levee`, `levee_signee`** — `pas_pret` : « Ce procès-verbal n'est pas encore prêt. » et rien à signer. Après un PV signé avec réserves : récapitulatif, réponse et date d'engagement si elles existent, puis `PvLevee` (bouton « Je constate que les réserves sont levées », nom, signature) seulement si `levee.demandee`. Téléchargement du PV de levée après signature.
- [ ] **Step 4: Vérifier** — `npx vite build` ; chaque fichier créé < 250 lignes ; lecture à 375 px de large du JSX (champs à 16 px, boutons ≥ 48 px, comme l'existant).
- [ ] **Step 5: Commit** — `feat(chantiers): page du client — déclaration, points confirmés, levée des réserves`.

---

### Task 9: Paramètres — gabarit par type, gabarit d'e-mail de levée

**Files:**
- Modify: `src/apps/artisan/pages/settings/equipements/TypesTab.jsx`, `src/apps/artisan/pages/settings/communication/EmailsTab.jsx`

**Interfaces:**
- Consumes: `GABARITS_RECEPTION`, `LIBELLES_GABARIT` (tâche 1), `DEFAULT_PV_LEVEE_EMAIL` (tâche 3).

- [ ] **Step 1: Types** — colonne « PV de réception » dans le tableau et sélecteur « Gabarit du PV de réception » dans la fenêtre d'édition ; `reception_profile` part dans la charge utile existante (mise à jour partielle : rien d'autre n'est ajouté).
- [ ] **Step 2: E-mails** — un second bloc sur le patron de `pv_reception` : `gabarit={DEFAULT_PV_LEVEE_EMAIL}`.
- [ ] **Step 3: Vérifier** — `npx vite build`, `npm run lint`.
- [ ] **Step 4: Commit** — `feat(parametres): gabarit de PV par type d'équipement, e-mail de levée des réserves`.

---

### Task 10: Vérification d'ensemble, règles durables, livraison

**Files:**
- Modify: `CLAUDE.md` (Module Chantiers : paragraphe du PV en ligne), la spécification (section « Livré »)

- [ ] **Step 1: Tout rejouer** — `npm run audit:quality` → vert ; `npx vite build` → succès ; `node scripts/permissions-coherence.mjs --env .env.local` → pas de nouvel écart (les six RPC fermées à `anon`).
- [ ] **Step 2: Relire le lot entier** (`git diff 65bdcb01..HEAD --stat` puis fichier par fichier) contre la spécification et la section « Review Focus ».
- [ ] **Step 3: `CLAUDE.md`** — remplacer le paragraphe « PV de réception signé en ligne » par les règles qui mordent : préparation obligatoire avant l'envoi, points figés avec leur texte, gabarit porté par le type, levée par le même lien, dossier `interventions` par organisation, `pvPoints.js` copié pour Deno. Écrire la section « Livré » de la spécification, avec ce qui n'a pas été essayé en réel.
- [ ] **Step 4: Commit et push** — `docs(chantiers): règles du PV complété`, puis `git pull --rebase --autostash` et `git push` ; suivre le déploiement Vercel jusqu'à l'état prêt.
- [ ] **Step 5: Ce qui reste à Eric**, à dire en clair en fin de lot : le oui pour déployer l'edge s'il n'a pas été donné ; créer les deux gabarits d'e-mail (Paramètres → Communication → Emails) ; un essai réel sur un chantier (préparer, envoyer, signer avec une réserve, répondre, demander la levée, signer la levée, ouvrir les deux PDF) ; relire les gabarits attribués aux types (Paramètres → Équipements → Types).
