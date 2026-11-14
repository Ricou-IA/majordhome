# Documents d'un équipement en trois tiroirs — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** au dépôt d'un document sur une carte équipement, choisir sa portée (cet appareil · modèle · marque) et afficher les documents de la carte en trois tiroirs.

**Architecture:** la table existante `majordhome.equipment_documents` reçoit `scope` + `equipment_id` ; la vue par équipement `majordhome_equipment_model_documents` rend les trois portées ; un module pur range les documents en tiroirs et dit qui peut retirer quoi ; la fenêtre de dépôt propose la portée.

**Tech Stack:** PostgreSQL (Supabase, RLS `role_can`), React 18, TanStack Query v5, Tailwind, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-14-documents-equipement-trois-tiroirs-design.md`

## Global Constraints

- Portées : `marque` | `modele` | `appareil` ; défaut en base `modele` (un ancien écran en cache qui n'envoie pas la portée garde le comportement d'avant) ; présélection à l'écran `appareil`.
- Un document relevé (`equipment_model_id` non nul) est toujours `modele` ; jamais inséré ni retiré par le front (policies existantes inchangées sur ce point).
- Retrait : `appareil` ⇒ `role_can(org, 'clients', 'edit')` ; `marque` / `modele` ⇒ `role_can(org, 'clients', 'delete')`. Dépôt : `clients.edit` pour les trois.
- Portée et équipement d'un document sont immuables après dépôt (refus `equipment_document_scope_immutable`) : sinon on contournerait la règle de retrait en passant un document « modèle » en « appareil ».
- Chemin Storage : `appareil` ⇒ `${org}/equipments/${equipment_id}/…` ; sinon `${org}/equipment-models/…` (inchangé). Aucune policy Storage nouvelle.
- Migration `supabase/migrations/20261114_1_equipment_documents_portee.sql`, répétée sur le harnais AVANT la prod ; toute vue recréée : `WITH (security_invoker = true)`, `REVOKE ALL … FROM PUBLIC, anon` puis GRANT, nouvelles colonnes **en fin de liste**.
- Libellés écran : « Cet appareil (ce client seulement) », « Tous les {modèle} », « Toute la marque {MARQUE} » ; tiroirs « Cet appareil », « Modèle {modèle} », « Marque {marque} ».
- Règles dans `src/lib/catalogue/documentsAppareil.js` (pur, sans import React / Supabase / alias), jamais dans un composant. Composant ≤ 500 lignes.
- Commits par chemins explicites sur `main` ; la chaîne de commit échoue si `git branch --show-current` ≠ `main`.

## Review Focus

1. Ancien écran en cache (PWA) qui insère sans `scope` → document `modele`, comme avant (assertion harnais (3)).
2. Équipement sans marque ni modèle → seule la portée « Cet appareil » est proposée et acceptée (test `porteesProposees` + assertion harnais (5)).
3. Technicien sur un document « Modèle » → pas de corbeille, et la base refuse (test `peutRetirerDocument` + assertion harnais (7)).
4. Changer la portée par un UPDATE direct → refus (assertion harnais (8)).
5. Document « Cet appareil » visible sur cet équipement seulement, « Marque » sur un autre modèle de la même marque, « Modèle » pas sur un autre modèle (assertion harnais (9)).

---

### Task 1 : Base — portée, garde, vues, répétition

**Files:**
- Create: `supabase/migrations/20261114_1_equipment_documents_portee.sql`
- Create: `scripts/migration-rehearsal/assert-equipment-documents-portee.sql`

**Interfaces:**
- Produces : colonnes `equipment_documents.scope text NOT NULL DEFAULT 'modele'`, `equipment_id uuid NULL → equipments(id) ON DELETE CASCADE` ; `brand`, `model`, `brand_key`, `model_key` deviennent NULLables ; vue miroir `public.majordhome_equipment_documents` + `scope`, `equipment_id` (fin de liste) ; vue `public.majordhome_equipment_model_documents` + `scope` (fin de liste, après `from_site`). Codes d'erreur : `equipment_document_model_required` (existant), `equipment_document_brand_required`, `equipment_document_equipment_required`, `equipment_document_scope_immutable`.

- [ ] **Step 1 : écrire les assertions** (`DO $$ … RAISE EXCEPTION … $$`, modèle d'impersonation : `scripts/migration-rehearsal/assert-equipment-documents.sql` lignes ~80-125, `set_config('request.jwt.claim.sub', …)` + `SET ROLE authenticated`). Fixtures nettoyées en fin. Numérotées :
  (1) structure : colonnes présentes, CHECK portée, vues `security_invoker`, `has_table_privilege('anon', 'public.majordhome_equipment_model_documents', 'SELECT')` faux, idem miroir ;
  (2) technicien : dépôt `appareil` sur un équipement Mayer → OK, chemin `${org}/equipments/${eq}/x.pdf` ;
  (3) insert sans `scope` (marque + modèle utiles) → `scope = 'modele'` ;
  (4) `marque` sans marque utile → `equipment_document_brand_required` ; `marque` avec modèle fourni → `model` et `model_key` remis à NULL ;
  (5) `appareil` sans marque ni modèle → OK ; `modele` sans modèle → `equipment_document_model_required` ;
  (6) `appareil` avec un `equipment_id` inexistant → `equipment_document_equipment_required` ; `appareil` sans `equipment_id` → violation de CHECK ; `appareil` avec chemin `…/equipment-models/…` → violation de CHECK ;
  (7) technicien : DELETE de son document `appareil` → 1 ligne ; DELETE d'un document `modele` → 0 ligne ; org_admin : DELETE du `modele` → 1 ligne ;
  (8) UPDATE de `scope` (ou d'`equipment_id`) → `equipment_document_scope_immutable` ;
  (9) vue : le document `appareil` n'apparaît que sur son équipement ; un `marque` apparaît sur un équipement de même marque d'un autre modèle ; un `modele` n'y apparaît pas ; un document relevé existant garde `scope = 'modele'` et `from_site = true`.
- [ ] **Step 2 : écrire la migration.** En tête, le pourquoi (demande d'Eric 2026-11-14) et la chaîne de répétition. Contenu : `ALTER TABLE` (colonnes, DROP NOT NULL) ; contraintes `equipment_documents_scope_check`, `equipment_documents_scope_equipment` (`(scope = 'appareil') = (equipment_id IS NOT NULL)`), `equipment_documents_scope_releve` (`equipment_model_id IS NULL OR scope = 'modele'`) ; remplacer `equipment_documents_storage_path_org` par une version à deux cas (appareil / autres) ; réécrire `majordhome.equipment_documents_set_keys()` : clés calculées (fonction STRICT ⇒ NULL sur NULL), puis selon la portée — `modele` : deux clés exigées (erreur existante) ; `marque` : `brand_key` exigée, `model` et `model_key` forcés à NULL ; `appareil` : clés facultatives, l'équipement doit exister et `majordhome.project_org_id(e.project_id) = NEW.org_id`, sinon `equipment_document_equipment_required` ; sur UPDATE, `scope` / `equipment_id` changés ⇒ `equipment_document_scope_immutable`. Trigger recréé en `BEFORE INSERT OR UPDATE` (plus seulement `OF brand, model`). Policy DELETE : `equipment_model_id IS NULL AND (role_can(org_id,'clients','delete') OR (scope = 'appareil' AND role_can(org_id,'clients','edit')))`. Vues recréées (4 branches pour la vue par équipement : modèle manuel `scope = 'modele'`, relevé inchangé avec `'modele'::text`, marque par `brand_key`, appareil par `equipment_id = e.id` et org du projet) + leurs REVOKE / GRANT existants.
- [ ] **Step 3 : répéter.** La table n'est pas photographiée (`TABLES` de `snapshot.mjs`) : chaîne complète `20261028_5`, `20261111_1` → `_6`, `20261112_4` → `_8`, `20261114_1`, puis `--assert` sur `assert-equipment-documents.sql` ET `assert-equipment-documents-portee.sql`. Si `20261028_5` est refusée comme déjà existante, la retirer de la chaîne et le noter.
  Run : `node scripts/migration-rehearsal/run.mjs --migration … (chaîne) --assert scripts/migration-rehearsal/assert-equipment-documents.sql --assert scripts/migration-rehearsal/assert-equipment-documents-portee.sql`
  Expected : `assert-equipment-documents-portee : OK`, run en succès.
- [ ] **Step 4 : commit** (migration + assertions). **La mise en prod est faite par le contrôleur** (`apply_migration`), puis vérifiée : `has_table_privilege('anon', …)` faux sur les deux vues, `permissions-coherence.mjs --env .env.local` sans nouvelle erreur.

### Task 2 : Règles pures — portées proposées, tiroirs, droit de retrait

**Files:**
- Modify: `src/lib/catalogue/documentsAppareil.js`
- Test: `scripts/catalogue/documents-appareil.test.mjs` (déjà dans `audit:quality`)

**Interfaces:**
- Produces :
  - `PORTEES_DOCUMENT = ['appareil', 'modele', 'marque']`
  - `porteesProposees({ marque, modele, aMarque, aModele }) → Array<{ value, label }>` : `appareil` toujours ; `modele` si `aModele` ; `marque` si `aMarque` ; libellés de Global Constraints (marque en MAJUSCULES, modèle tel que saisi).
  - `porteeDocument(doc) → 'appareil'|'modele'|'marque'` (absente ou inconnue ⇒ `'modele'`).
  - `rangerEnTiroirs(docs, productDocuments = []) → { appareil: doc[], modele: doc[], marque: doc[] }` (documents fournisseur ⇒ `modele`, ordre d'origine gardé).
  - `peutRetirerDocument(doc, { peutModifier, peutSupprimer }) → boolean` : relevé (`from_site` ou `equipment_model_id`) ⇒ faux ; `appareil` ⇒ `peutModifier === true` ; sinon `peutSupprimer === true`.
  - `messageRetraitDocument(doc) → string` : appareil « « X » sera retiré de cet appareil. » ; modèle « … pour tous les équipements {brand} {model} de l'entreprise. » ; marque « … pour tous les équipements de la marque {brand}. » (X = `doc.label` sinon « ce document »).

- [ ] **Step 1 : tests en échec** — un test par fonction, dont : `porteesProposees({ aMarque: false, aModele: false })` ne rend que `appareil` ; `{ marque: 'Invicta', modele: 'Lp9', aMarque: true, aModele: true }` rend dans l'ordre `appareil`, `modele` (« Tous les Lp9 »), `marque` (« Toute la marque INVICTA ») ; `porteeDocument({})` = `'modele'` ; `peutRetirerDocument({ scope: 'modele' }, { peutModifier: true, peutSupprimer: false })` = faux ; `({ scope: 'appareil' }, { peutModifier: true })` = vrai ; `({ scope: 'appareil', from_site: true }, { peutModifier: true, peutSupprimer: true })` = faux.
- [ ] **Step 2 :** `node --test scripts/catalogue/documents-appareil.test.mjs` → FAIL (fonctions absentes).
- [ ] **Step 3 :** implémenter dans `documentsAppareil.js` (JSDoc sur chaque export).
- [ ] **Step 4 :** même commande → PASS.
- [ ] **Step 5 : commit.**

### Task 3 : Service, hook et écran

**Files:**
- Modify: `src/shared/services/equipmentDocuments.service.js` (en-tête, `upload`, nouvel export `equipmentHasBrand`)
- Modify: `src/shared/hooks/useEquipmentDocuments.js` (`upload` transmet `scope`)
- Create: `src/apps/artisan/components/clients/EquipmentDocumentUploadModal.jsx` (fenêtre de dépôt sortie de la section)
- Modify: `src/apps/artisan/components/clients/EquipmentDocumentsSection.jsx`
- Modify: `CLAUDE.md` (une puce dans « Module Catalogue fournisseur », à côté de `majordhome_equipment_model_documents`)

**Interfaces:**
- Consumes : Task 1 (colonnes, codes d'erreur), Task 2 (fonctions pures).
- Produces : `equipmentDocumentsService.upload({ orgId, equipment, file, documentType, label, userId, scope = 'appareil' })` ; `equipmentHasBrand(equipment) → boolean` (même règle `champUtile` que `equipmentHasModel`).

- [ ] **Step 1 : service.** `upload` : `modele` exige `equipmentHasModel`, `marque` exige `equipmentHasBrand` (sinon erreurs `equipment_document_model_required` / `equipment_document_brand_required`) ; `appareil` envoie `equipment_id: equipment.id`, chemin `${orgId}/equipments/${equipment.id}/${uuid}.${ext}`, marque / modèle envoyés s'ils sont renseignés (trim, sinon `null`) ; `marque` n'envoie pas de modèle. Le reste inchangé (fichier retiré si la ligne est refusée ; `remove` inchangé).
- [ ] **Step 2 : hook.** `uploadMutation` passe `scope` au service.
- [ ] **Step 3 : fenêtre de dépôt** (`EquipmentDocumentUploadModal.jsx`) : reprise de `UploadModal` + choix de portée (boutons segmentés, mêmes classes que le choix du type) alimenté par `porteesProposees`, présélection `appareil` ; le sous-titre dit à qui le document s'appliquera selon la portée choisie ; `onSubmit({ file, documentType, label, scope })`.
- [ ] **Step 4 : section.** Le bouton « Déposer » est toujours proposé à qui a `canUpload` (plus de message « Renseignez la marque et le modèle ») ; affichage `rangerEnTiroirs` : un en-tête repliable par tiroir non vide (« Cet appareil (n) », « Modèle {modèle} (n) », « Marque {marque} (n) »), ouverts par défaut, procédures repliées dans le tiroir Modèle comme aujourd'hui ; corbeille d'une ligne = `peutRetirerDocument(doc, { peutModifier: canUpload, peutSupprimer: canDelete })` ; texte de confirmation = `messageRetraitDocument` ; toast de succès selon la portée ; erreur `brand_required` traduite (« Renseignez la marque de l'équipement… »). Aucun document : « Aucun document pour cet appareil. »
- [ ] **Step 5 : CLAUDE.md** — une puce : portées, défaut base `modele` / écran `appareil`, règle de retrait, immutabilité, chemin Storage `equipments/`.
- [ ] **Step 6 : vérifier.** `npm run audit:quality` (0 échec, aucun fichier mort) ; `npm run lint` (plafond non dépassé) ; `npx vite build` OK ; `wc -l` de la section et de la fenêtre < 500.
- [ ] **Step 7 : commit**, puis pousser (`git pull --rebase --autostash` d'abord) et suivre le déploiement Vercel jusqu'à READY.
