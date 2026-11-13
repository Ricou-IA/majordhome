# Mode atelier et pièces enregistrées sur la fiche SAV — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lire le document d'un appareil (vue éclatée, notice PDF) en face de la liste des pièces, dans la page, et enregistrer les pièces identifiées sur la demande SAV — y compris par le technicien depuis la fiche client.

**Architecture:** une table `majordhome.sav_part_selections` (vue miroir `majordhome_sav_part_selections`) porte les pièces identifiées par carte SAV, avec une photo de chaque pièce qui survit au remplacement de la nomenclature à chaque relevé. Les règles (rapprochement photo ↔ nomenclature, garde d'écran du technicien, onglets de documents) vivent dans des modules purs testés. Le « mode atelier » est un composant à deux colonnes monté par `EquipmentPartsSection` ; son lecteur PDF est pdf.js chargé à la demande. Les visionneuses plein écran disparaissent.

**Tech Stack:** React 18, Vite 5, TanStack Query v5, Supabase (PostgREST + RLS `role_can`), Tailwind, `pdfjs-dist@4.10.38`, tests `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-12-mode-atelier-pieces-enregistrees-sav-design.md`

## Global Constraints

- Travail sur `main` uniquement, commits par chemins explicites, `git pull --rebase --autostash` puis push. **Avant de commencer : vérifier `git branch --show-current` = `main`** (une autre session a laissé le dossier sur `spec/assistant-pieces-sav` le 2026-11-12 ; ne jamais commiter sur sa branche, ne pas changer de branche sans l'accord d'Eric).
- Charte multi-tenant de `CLAUDE.md` : `org_id` = org CORE (`organization.id` de `useAuth`, celle de `majordhome.project_org_id`), filtre `.eq('org_id', orgId)` explicite sur toute mutation, `{ error }` lu partout, `REVOKE ALL … FROM PUBLIC, anon` sur la vue, `GRANT SELECT … TO service_role` sur la table, vue `security_invoker=true`.
- Écritures RLS sous `majordhome.role_can(org_id, 'clients', 'edit')` ; lecture = membres de l'org (même prédicat que `equipment_models_select`).
- Migration versionnée `supabase/migrations/20261113_5_sav_pieces_identifiees.sql`, répétée d'abord sur `scripts/migration-rehearsal/` avant `apply_migration` en prod.
- Mutations de hooks via `unwrapResult()` ; cache keys dans `cacheKeys.js`, `all: (orgId) => [domain, orgId]` ; `enabled: !!orgId && …`.
- Composants < 500 lignes ; aucune règle métier dans le JSX ; `logger`, jamais `console.*` ; Tailwind seul ; jamais la couleur seule pour porter un état.
- Libellés d'écran (Eric) : bouton **« Lire avec la liste »**, retour **« Réduire »**, bouton fiche client **« Mettre sur la demande SAV »**.
- Pas d'outils de prévisualisation : vérification par `npx vite build`, `npm run lint`, `npm run audit:quality`.
- Rien ne recouvre la page : plus aucun `fixed inset-0` sombre pour lire un document.

## Review Focus

1. **Relevé Invicta entre l'identification et le devis** (ids de nomenclature changés) : la pièce reste affichée et part au devis au bon prix → test `ligneDepuisIdentifiee` repli par référence + repère, puis photo (Task 2).
2. **Écriture refusée** (réseau, RLS) pendant un + / − : toast et quantité affichée = valeur en base, jamais un état local qui ment → test du hook optimiste remis en place (Task 4, étape vérification manuelle décrite) et règle pure `quantiteAffichee` (Task 2).
3. **PDF qui ne charge pas** (URL signée expirée après 1 h, fichier absent, worker pdf.js absent après déploiement PWA) : message dans la zone + « Ouvrir dans un onglet », jamais une zone blanche → état d'erreur du `LecteurPdf` (Task 5) et test `natureDocument` (Task 5).
4. **Technicien sur une carte Réalisée ou sur une carte qu'il ne peut que clôturer** : il coche tant que la carte n'est pas Réalisée, rien d'autre ne s'ouvre → tests `peutIdentifierPieces` (Task 3).
5. **Client sans demande SAV ouverte, technicien sans `sav.create`** : la demande se crée par « Mettre sur la demande SAV », pas par un autre bouton → test `peutRangerSurDemandeSav` (Task 3).

---

### Task 1: Table des pièces identifiées (base)

**Files:**
- Create: `supabase/migrations/20261113_5_sav_pieces_identifiees.sql`
- Create: `scripts/migration-rehearsal/assert-sav-pieces-identifiees.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (seulement si une table / fonction citée manque : `majordhome.interventions`, `majordhome.equipments`, `majordhome.project_org_id`, `majordhome.role_can`)

**Interfaces:**
- Produces: table `majordhome.sav_part_selections` et vue `public.majordhome_sav_part_selections` (miroir simple, mêmes colonnes) :
  `id uuid pk default gen_random_uuid()`, `org_id uuid not null → core.organizations`, `intervention_id uuid not null → majordhome.interventions on delete cascade`, `equipment_id uuid not null → majordhome.equipments on delete cascade`, `equipment_model_id uuid null` (pas de FK), `part_line_id uuid null` (pas de FK), `piece_reference text not null check (btrim(piece_reference) <> '')`, `piece_name text null`, `repere text not null default ''`, `supplier_product_id uuid null` (pas de FK), `public_price_ht numeric null`, `quantity numeric not null check (quantity > 0)`, `added_by uuid not null default auth.uid()`, `added_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, unique `(intervention_id, equipment_id, piece_reference, repere)`.

- [ ] **Step 1: Écrire les assertions** dans `assert-sav-pieces-identifiees.sql` (blocs `DO $$ … RAISE EXCEPTION … $$`) :
  - la vue existe avec `security_invoker=true` et est insérable (`is_insertable_into = 'YES'`) ;
  - `has_table_privilege('anon', 'public.majordhome_sav_part_selections', 'SELECT')` = false ; `has_table_privilege('service_role', 'majordhome.sav_part_selections', 'SELECT')` = true ;
  - en se faisant passer pour un technicien membre (`set local role authenticated; set local request.jwt.claim.sub = '<user technicien du snapshot>'`) : INSERT d'une pièce sur une carte SAV de son org réussit ; le même INSERT avec un `org_id` d'une autre org, ou une `intervention_id` d'une autre org, échoue ;
  - une 2ᵉ insertion de la même clé `ON CONFLICT (intervention_id, equipment_id, piece_reference, repere) DO UPDATE SET quantity = excluded.quantity` remplace la quantité (1 → 3, pas 4) ;
  - `quantity = 0` est refusé ; supprimer la carte SAV supprime ses pièces.
- [ ] **Step 2: Lancer la répétition sans migration et voir échouer**
  Run: `node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-sav-pieces-identifiees.sql`
  Expected: FAIL « relation … majordhome_sav_part_selections does not exist ».
- [ ] **Step 3: Écrire la migration** : table, index sur `intervention_id`, trigger `updated_at`, RLS activée, policies :
  `select` = `org_id IN (SELECT om.org_id FROM core.organization_members om WHERE om.user_id = auth.uid())` ;
  `insert` / `update` = `majordhome.role_can(org_id, 'clients', 'edit') AND org_id = majordhome.project_org_id((SELECT i.project_id FROM majordhome.interventions i WHERE i.id = intervention_id))` (USING et WITH CHECK) ;
  `delete` = `majordhome.role_can(org_id, 'clients', 'edit')`.
  Vue `CREATE VIEW public.majordhome_sav_part_selections WITH (security_invoker=true) AS SELECT … FROM majordhome.sav_part_selections` ; `REVOKE ALL ON public.majordhome_sav_part_selections FROM PUBLIC, anon` ; `GRANT SELECT, INSERT, UPDATE, DELETE ON public.majordhome_sav_part_selections TO authenticated` ; `GRANT SELECT ON majordhome.sav_part_selections TO service_role`. Commentaires `COMMENT ON` (photo = affichage et survie au relevé, pas le prix du devis).
- [ ] **Step 4: Répéter avec la migration**
  Run: `node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261113_5_sav_pieces_identifiees.sql --assert scripts/migration-rehearsal/assert-sav-pieces-identifiees.sql`
  Expected: PASS, aucun `RAISE EXCEPTION`.
- [ ] **Step 5: Appliquer en prod** (`apply_migration`, projet `ejqqqwudmizqisdkxohw`, nom `20261113_5_sav_pieces_identifiees`) puis vérifier : `select to_regclass('public.majordhome_sav_part_selections')` non NULL et `has_table_privilege('anon', 'public.majordhome_sav_part_selections', 'SELECT')` = false.
- [ ] **Step 6: Commit** `git add supabase/migrations/20261113_5_sav_pieces_identifiees.sql scripts/migration-rehearsal/assert-sav-pieces-identifiees.sql [snapshot.mjs si modifié]` — `feat(sav): pièces identifiées enregistrées sur la carte SAV (base)`.

### Task 2: Règles pures des pièces identifiées

**Files:**
- Create: `src/lib/catalogue/piecesIdentifiees.js`
- Create: `scripts/catalogue/pieces-identifiees.test.mjs`
- Modify: `package.json` (ajouter le test à `audit:quality`, après `nomenclature-pieces.test.mjs`)

**Interfaces:**
- Consumes: `cle`, `prixPublicPiece` de `src/lib/catalogue/nomenclature.js` ; lignes de `majordhome_equipment_model_parts` (`id, repere, piece_reference, piece_name, supplier_product_id, prix_public_ht, prix_selon_appareil, catalog_item_id, …`).
- Produces (JSDoc complète, pas d'import React/Supabase/alias) :
  - `photoPiece(ligne, { equipmentId, equipmentModelId }, quantite) → { equipment_id, equipment_model_id, part_line_id, piece_reference, piece_name, repere, supplier_product_id, public_price_ht, quantity }` — `repere` vide = `''`, `public_price_ht = prixPublicPiece(ligne)`.
  - `retrouverLigne(selection, lignes) → object|null` — par `part_line_id`, sinon même `cle(piece_reference)` ET même `repere`.
  - `quantitesParLigne(selections, lignes) → { [ligneId]: number }` — les pièces identifiées projetées sur la nomenclature affichée.
  - `ligneDepuisIdentifiee(selection, lignes) → object` — la ligne actuelle si retrouvée, sinon `{ id: null, repere, piece_reference, piece_name, supplier_product_id, prix_public_ht: public_price_ht, prix_selon_appareil: true, catalog_item_id: null, unit: 'pièce' }`.
  - `choixDepuisIdentifiees(selections, lignesParEquipement) → Array<{ ligne, quantite }>` — entrée de `lignesDevisAvecPieces` ; `lignesParEquipement` = `{ [equipmentId]: lignes[] }`.
  - `quantiteAffichee(enBase, enCours) → number` — `enCours` (écriture en vol) s'il est défini, sinon `enBase`, sinon 0.

- [ ] **Step 1: Écrire les tests**

```js
const L = (x) => ({ id: 'l1', repere: '14', piece_reference: 'F6107098', piece_name: 'DEFLECTEUR POELE BALHAM', supplier_product_id: 'sp1', prix_public_ht: 58.64, catalog_item_id: 'ci1', ...x });
test('photoPiece : photo complète, repère vide = chaîne vide', () => {
  assert.deepEqual(photoPiece(L(), { equipmentId: 'e1', equipmentModelId: 'm1' }, 2), { equipment_id: 'e1', equipment_model_id: 'm1', part_line_id: 'l1', piece_reference: 'F6107098', piece_name: 'DEFLECTEUR POELE BALHAM', repere: '14', supplier_product_id: 'sp1', public_price_ht: 58.64, quantity: 2 });
  assert.equal(photoPiece(L({ repere: null }), { equipmentId: 'e1', equipmentModelId: 'm1' }, 1).repere, '');
});
test('retrouverLigne : après relevé (nouvel id), par référence + repère', () => {
  const sel = { part_line_id: 'ancien', piece_reference: 'f6107098', repere: '14' };
  assert.equal(retrouverLigne(sel, [L({ id: 'neuf' })]).id, 'neuf');
  assert.equal(retrouverLigne({ ...sel, repere: '15' }, [L({ id: 'neuf' })]), null);
});
test('ligneDepuisIdentifiee : pièce disparue du relevé → ligne libre au prix photo', () => {
  const l = ligneDepuisIdentifiee({ part_line_id: 'x', piece_reference: 'ZZ1', piece_name: 'Joint', repere: '3', public_price_ht: 3.64, supplier_product_id: null }, []);
  assert.equal(l.catalog_item_id, null); assert.equal(l.prix_selon_appareil, true); assert.equal(l.prix_public_ht, 3.64);
});
test('choixDepuisIdentifiees : une entrée par pièce, quantité enregistrée', () => {
  const c = choixDepuisIdentifiees([{ equipment_id: 'e1', part_line_id: 'l1', piece_reference: 'F6107098', repere: '14', quantity: 2 }], { e1: [L()] });
  assert.equal(c.length, 1); assert.equal(c[0].quantite, 2); assert.equal(c[0].ligne.catalog_item_id, 'ci1');
});
test('quantitesParLigne / quantiteAffichee', () => {
  assert.deepEqual(quantitesParLigne([{ part_line_id: 'l1', piece_reference: 'F6107098', repere: '14', quantity: 3 }], [L()]), { l1: 3 });
  assert.equal(quantiteAffichee(2, undefined), 2); assert.equal(quantiteAffichee(2, 0), 0); assert.equal(quantiteAffichee(undefined, undefined), 0);
});
```

- [ ] **Step 2: Voir échouer** — Run: `node --test scripts/catalogue/pieces-identifiees.test.mjs` — Expected: FAIL (module absent).
- [ ] **Step 3: Écrire les six fonctions** dans `src/lib/catalogue/piecesIdentifiees.js`.
- [ ] **Step 4: Voir passer** — même commande — Expected: PASS ; puis `npm run audit:quality` PASS.
- [ ] **Step 5: Commit** `src/lib/catalogue/piecesIdentifiees.js scripts/catalogue/pieces-identifiees.test.mjs package.json` — `feat(sav): règles des pièces identifiées`.

### Task 3: Gardes d'écran (technicien, rangement)

**Files:**
- Modify: `src/lib/savCloture.js`
- Modify: `scripts/sav-cloture.test.mjs`

**Interfaces:**
- Produces :
  - `peutIdentifierPieces(item, { role, canEditSAV }) → boolean` — vrai si `item.intervention_type === 'sav'`, `item.workflow_status` n'est ni `realise` ni `facture`, et (`canEditSAV` OU `role === 'technicien'`).
  - `peutRangerSurDemandeSav({ canEditClient }) → boolean` — `canEditClient` (`can('clients','edit')`) suffit : la création de la demande par cette voie ne demande PAS `sav.create` (Eric, 2026-11-12).

- [ ] **Step 1: Tests**

```js
test('peutIdentifierPieces : technicien sur demande, planifiée ; jamais sur Réalisé', () => {
  assert.equal(peutIdentifierPieces(carte(), { role: 'technicien', canEditSAV: false }), true);
  assert.equal(peutIdentifierPieces(carte({ workflow_status: 'planifie' }), { role: 'technicien', canEditSAV: false }), true);
  assert.equal(peutIdentifierPieces(carte({ workflow_status: 'realise' }), { role: 'org_admin', canEditSAV: true }), false);
  assert.equal(peutIdentifierPieces(carte(), { role: 'commercial', canEditSAV: false }), false);
  assert.equal(peutIdentifierPieces(carte({ intervention_type: 'entretien' }), { role: 'technicien', canEditSAV: true }), false);
});
test('peutRangerSurDemandeSav : clients.edit suffit', () => {
  assert.equal(peutRangerSurDemandeSav({ canEditClient: true }), true);
  assert.equal(peutRangerSurDemandeSav({ canEditClient: false }), false);
});
```

- [ ] **Step 2: Voir échouer** — `node --test scripts/sav-cloture.test.mjs` — FAIL (exports absents).
- [ ] **Step 3: Implémenter** les deux fonctions (JSDoc) ; `limiteALaCloture` inchangé.
- [ ] **Step 4: Voir passer** — même commande — PASS.
- [ ] **Step 5: Commit** `src/lib/savCloture.js scripts/sav-cloture.test.mjs` — `feat(sav): le technicien identifie les pièces d'une demande SAV`.

### Task 4: Service et hooks des pièces identifiées

**Files:**
- Create: `src/shared/services/savPieces.service.js`
- Create: `src/shared/hooks/useSavPieces.js`
- Modify: `src/shared/hooks/cacheKeys.js` (famille `savPieceKeys`)

**Interfaces:**
- Consumes: vue `majordhome_sav_part_selections` (Task 1), `photoPiece` (Task 2), `withErrorHandling` / `unwrapResult` (`src/lib/serviceHelpers.js`).
- Produces :
  - `savPieceKeys = { all: (orgId) => ['sav-pieces', orgId], byCard: (orgId, interventionId) => [...all(orgId), 'card', interventionId] }`.
  - `savPiecesService.list(orgId, interventionId) → { data: selection[], error }` (tri `added_at`).
  - `savPiecesService.setQuantity(orgId, interventionId, photo) → { data, error }` — `photo.quantity > 0` : upsert `onConflict: 'intervention_id,equipment_id,piece_reference,repere'` avec `org_id`, `intervention_id`, `updated_at` ; `quantity <= 0` : delete `.eq('org_id', orgId).eq('intervention_id', …).eq('equipment_id', …).eq('piece_reference', …).eq('repere', …)`. Lire `{ error }` ; upsert qui ne renvoie aucune ligne = erreur explicite.
  - `savPiecesService.ranger(orgId, interventionId, photos[]) → { data: { count }, error }` — upsert en un appel (remplace les quantités, Eric : « remplace, ne cumule pas »).
  - `useSavPieces(interventionId) → { selections, isLoading, error, setQuantity: (photo) => Promise, isSaving }` — `enabled: !!orgId && !!interventionId` ; mutation optimiste (`onMutate` écrit le cache, `onError` restaure l'instantané + `toast.error('La pièce n\'a pas pu être enregistrée')`, `onSettled` invalide `byCard`).
  - `useRangerPiecesSurSav() → { ranger: ({ interventionId, photos }) => Promise<{ count }>, isRanging }` — invalide `savPieceKeys.byCard`.

- [ ] **Step 1: Écrire service, keys et hooks** selon les signatures ci-dessus (mutationFn `unwrapResult(await savPiecesService.…)`).
- [ ] **Step 2: Vérifier le contrat des mutations** — Run: `grep -rnE "mutationFn: .*=> *[a-zA-Z]+Service\.[a-zA-Z]+\(" src/shared/hooks | grep -v "unwrap("` — Expected: seule `useGoogleCalendar` remonte.
- [ ] **Step 3: Build + lint** — `npx vite build` et `npm run lint` — Expected: build OK, aucun nouvel avertissement.
- [ ] **Step 4: Commit** les trois fichiers — `feat(sav): service et hooks des pièces identifiées`.

### Task 5: Lecteur de document (PDF pdf.js, image)

**Files:**
- Modify: `package.json`, `package-lock.json` (`npm install pdfjs-dist@4.10.38 --save-exact`)
- Create: `src/lib/catalogue/documentsAppareil.js` (pur)
- Create: `scripts/catalogue/documents-appareil.test.mjs` (ajouté à `audit:quality`)
- Create: `src/apps/artisan/components/equipements/lecteur/LecteurDocument.jsx`
- Create: `src/apps/artisan/components/equipements/lecteur/LecteurPdf.jsx`
- Create: `src/apps/artisan/components/equipements/lecteur/LecteurImage.jsx`

**Interfaces:**
- Consumes: `equipmentDocumentsService.getSignedUrl({ storage_path })`, `rangerDocumentsModele`, `titreDocumentModele`, `equipmentDocumentTypeLabel`.
- Produces :
  - `natureDocument(doc) → 'pdf'|'image'|'autre'` (règle actuelle de `EquipmentDocumentViewer.natureDe`, déplacée).
  - `ongletsAtelier({ vues, documents }) → Array<{ id: string, type: 'vue'|'notice'|'fiche_technique'|'procedure'|'autre', libelle: string, source: object }>` — d'abord une entrée par vue éclatée (`vue:<i>`, libellé « Vue éclatée » ou « Vue éclatée 2/3 »), puis les documents dans l'ordre de `rangerDocumentsModele` (principaux puis procédures), `id = doc:<doc.id>` ; seuls les types présents apparaissent.
  - `<LecteurDocument source={{ kind: 'vue', url, width, height } | { kind: 'doc', doc }} pageInitiale={number?} />` — URL signée à l'ouverture pour `doc` ; aiguille vers `LecteurPdf` / `LecteurImage` / message « Ce type de fichier ne s'affiche pas dans le logiciel » ; barre discrète « Ouvrir dans un onglet ».
  - `<LecteurPdf url pageInitiale />` — `import('pdfjs-dist')` dynamique, `GlobalWorkerOptions.workerSrc` = `import('pdfjs-dist/build/pdf.worker.min.mjs?url')` ; page ‹ › et n° de page, « Largeur » / − / +, recherche texte (surlignage, suivante) ; erreur de chargement = message + « Ouvrir dans un onglet ».
  - `<LecteurImage url width height />` — niveaux Ajustée / Taille réelle / Double, défilement (doigt sur tablette).

- [ ] **Step 1: Tests purs**

```js
test('natureDocument', () => {
  assert.equal(natureDocument({ mime_type: 'application/pdf' }), 'pdf');
  assert.equal(natureDocument({ storage_path: 'a/b/doc-1.PDF' }), 'pdf');
  assert.equal(natureDocument({ file_name: 'vue.webp' }), 'image');
  assert.equal(natureDocument({ file_name: 'cablage.docx' }), 'autre');
});
test('ongletsAtelier : vues d\'abord, procédures en dernier, rien d\'absent', () => {
  const o = ongletsAtelier({ vues: [{ url: 'u1' }, { url: 'u2' }], documents: [{ id: 'p', document_type: 'procedure', label: 'Mise en service' }, { id: 'n', document_type: 'notice', label: 'Notice' }] });
  assert.deepEqual(o.map((x) => x.id), ['vue:0', 'vue:1', 'doc:n', 'doc:p']);
  assert.equal(o[0].libelle, 'Vue éclatée 1/2');
  assert.deepEqual(ongletsAtelier({ vues: [], documents: [] }), []);
});
```

- [ ] **Step 2: Voir échouer** — `node --test scripts/catalogue/documents-appareil.test.mjs` — FAIL.
- [ ] **Step 3: Implémenter `documentsAppareil.js`**, puis voir passer — PASS.
- [ ] **Step 4: Installer pdf.js et écrire les trois composants.** Le chunk pdf.js ne doit pas entrer dans le paquet principal.
- [ ] **Step 5: Vérifier le découpage** — Run: `npx vite build` — Expected: OK ; un fichier `pdf.worker.min-*.mjs` et un chunk `pdf-*.js` séparés dans `dist/assets` ; `index-*.js` ne grossit pas de plus de ~5 Ko.
- [ ] **Step 6: Commit** — `feat(equipements): lecteur de document dans le logiciel (pdf.js à la demande)`.

### Task 6: Mode atelier dans le bloc « Pièces détachées »

**Files:**
- Create: `src/apps/artisan/components/equipements/AtelierPieces.jsx`
- Create: `src/apps/artisan/components/equipements/NomenclatureTable.jsx` (tableau + recherche + / − sortis d'`EquipmentPartsSection`, réutilisés en mode normal et en atelier)
- Modify: `src/apps/artisan/components/equipements/EquipmentPartsSection.jsx`

**Interfaces:**
- Consumes: `ongletsAtelier`, `LecteurDocument` (Task 5), `useEquipmentModelDocuments([equipment.id])` (`@hooks/useEquipmentDocuments`), `useEquipmentModelImages`, `useDeviceClass().isPhone`.
- Produces — nouvelles props d'`EquipmentPartsSection` (les existantes restent) :
  - `quantites?: { [ligneId]: number }` et `onQuantiteChange?: (ligne, quantite) => void` — sélection CONTRÔLÉE par l'appelant (fiche SAV : base ; fiche client : état local). Sans elles, comportement local d'aujourd'hui.
  - `selectionLectureSeule?: boolean` — + / − désactivés, quantités affichées.
  - `atelier?: { ouvert: boolean, ongletId?: string|null }` et `onAtelierChange?: (atelier) => void` — ouverture contrôlable de l'extérieur (rubrique Documents) ; sans elles, état interne.
  - `actionsSelection?: ReactNode` — boutons sous la liste (« Créer un devis… », « Mettre sur la demande SAV »), remplace le bouton de devis interne quand fourni.
  - `<AtelierPieces onglets ongletId onOnglet vueNotice={boolean} liste={ReactNode} onReduire />` — en-tête « Pièces détachées · modèle · Réduire », onglets, colonnes document / liste séparées par une poignée (glisser, bornes 30 %–75 %, départ 60 %), hauteur `calc(100vh - 12rem)` (min 420 px) ; `isPhone` : document au-dessus (hauteur 60vh), liste en dessous, pas de poignée. Fiche sans liste de pièces (`listePiecesDisponible` faux) : document seul. Vue tirée d'une notice : l'avertissement actuel reste au-dessus du document.
- Bouton **« Lire avec la liste »** dans l'en-tête du bloc (visible dès qu'il existe au moins un onglet).

- [ ] **Step 1: Extraire `NomenclatureTable`** sans changer le rendu actuel ; `npx vite build` OK.
- [ ] **Step 2: Écrire `AtelierPieces`** et brancher « Lire avec la liste » / « Réduire » dans `EquipmentPartsSection` (qui reste < 500 lignes) ; l'agrandissement de vignette ouvre désormais l'atelier sur `vue:<i>` (plus d'`ExplodedViewViewer`).
- [ ] **Step 3: Rendre la sélection contrôlable** (`quantites` / `onQuantiteChange` / `selectionLectureSeule`) ; sans ces props, le comportement de la fiche client d'aujourd'hui est inchangé.
- [ ] **Step 4: Build + lint** — `npx vite build`, `npm run lint` — OK, aucun nouvel avertissement.
- [ ] **Step 5: Commit** — `feat(equipements): mode atelier, document en face de la liste des pièces`.

### Task 7: Fiche SAV — pièces enregistrées, technicien, fenêtre élargie

**Files:**
- Modify: `src/apps/artisan/components/entretiens/SAVModelPartsSection.jsx`
- Modify: `src/apps/artisan/components/entretiens/EntretienSAVModal.jsx`
- Create (si `SAVModelPartsSection` dépasse 250 lignes) : `src/apps/artisan/components/entretiens/PiecesIdentifieesListe.jsx`

**Interfaces:**
- Consumes: `useSavPieces(item.id)` (Task 4), `photoPiece`, `quantitesParLigne`, `choixDepuisIdentifiees`, `quantiteAffichee` (Task 2), `peutIdentifierPieces` (Task 3), props d'atelier et de sélection d'`EquipmentPartsSection` (Task 6), `useEquipmentModelParts`.
- Produces :
  - `SAVModelPartsSection` nouvelle prop `onAtelierChange?: (ouvert: boolean) => void`.
  - `EntretienSAVModal` : largeur `max-w-4xl` → `max-w-[calc(100vw-2rem)]` tant que l'atelier est ouvert.

- [ ] **Step 0: Garder l'assistant « Trouver une pièce »** fusionné le 2026-11-13 (`TrouverPieceButton`, branche « sans modèle » sous `moduleActif(settings, 'assistant')`) : ni retiré ni déplacé ; même chose dans `EquipmentList` (Task 8).
- [ ] **Step 1: Brancher la sélection sur la base** : `quantites = quantitesParLigne(selections de cet équipement, parts)` ; `onQuantiteChange(ligne, q)` → `setQuantity(photoPiece(ligne, { equipmentId, equipmentModelId }, q))` ; `selectionLectureSeule = !peutIdentifierPieces(item, { role: effectiveRole, canEditSAV })`. `canEditSAV && !clotureSeule` reste la garde du choix de modèle et du devis.
- [ ] **Step 2: Liste « Pièces identifiées »** en tête du bloc : appareil (si plusieurs), référence, désignation, quantité, prix public HT, « par Prénom, le jj/mm » (`added_by` résolu par le nom de membre déjà disponible dans la fiche, sinon « — »), retrait (– jusqu'à 0) si `peutIdentifierPieces`.
- [ ] **Step 3: Devis depuis la liste enregistrée** : « Créer un devis avec ces pièces » → `lignesDevisAvecPieces(sections, choixDepuisIdentifiees(selections, { [equipmentId]: parts }), tva)` ; ne vide pas la liste ; bouton visible seulement si `peutCreerDevis` (inchangé).
- [ ] **Step 4: Fenêtre élargie** pendant l'atelier (`onAtelierChange`).
- [ ] **Step 5: Build + lint + audit** — `npx vite build`, `npm run lint`, `npm run audit:quality` — OK.
- [ ] **Step 6: Commit** — `feat(sav): pièces identifiées enregistrées sur la fiche SAV`.

### Task 8: Fiche client — « Mettre sur la demande SAV », documents dans l'atelier

**Files:**
- Create: `src/apps/artisan/components/equipements/PartsToSavDemand.jsx`
- Modify: `src/apps/artisan/pages/client-detail/TabEquipments.jsx`
- Modify: `src/apps/artisan/components/clients/EquipmentList.jsx` (props seulement : le fichier fait déjà 595 lignes, n'y ajouter que le passage de props — ⚠ dette signalée, pas de découpage dans ce commit)
- Modify: `src/apps/artisan/components/clients/EquipmentDocumentsSection.jsx`

**Interfaces:**
- Consumes: `useRangerPiecesSurSav` (Task 4), `photoPiece` (Task 2), `peutRangerSurDemandeSav` (Task 3), `savService.getOpenSavCardId`, `CreateSAVModal` (`prefillClient`, `prefillEquipmentId`, `prefillDescription`, `allowSchedule={false}`, `suite`), `descriptionSavDepuisPieces`.
- Produces :
  - `<PartsToSavDemand client equipment choix onClose onRanged />` — demande ouverte du client (`getOpenSavCardId`) sinon `CreateSAVModal` (texte `suite` : « Les N pièces choisies seront mises sur cette demande. ») ; puis `ranger({ interventionId, photos: choix.map(c => photoPiece(c.ligne, { equipmentId, equipmentModelId }, c.quantite)) })` ; `toast.success('3 pièces mises sur la demande SAV')` ; `onRanged()` vide la sélection. Erreur de lecture / de rangement : `toast.error` explicite, sélection conservée.
  - `EquipmentList` props `onPartsToSav?: (equipment, choix) => void` passée à `EquipmentPartsSection.actionsSelection`.
  - `EquipmentDocumentsSection` prop `onOpenDocument?: (doc) => void` — quand fournie, un clic ouvre l'atelier du même équipement sur `doc:<id>` (via `atelier` / `onAtelierChange` d'`EquipmentPartsSection`, état tenu par la carte équipement) ; plus d'`EquipmentDocumentViewer`.
  - `TabEquipments` : `peutRanger = peutRangerSurDemandeSav({ canEditClient: can('clients','edit') })` ; « Créer un devis SAV » reste sous `peutDevisSav` (inchangé).

- [ ] **Step 1: Écrire `PartsToSavDemand`** (même structure que `PartsToSavQuote`, sans fenêtre de devis).
- [ ] **Step 2: Brancher** `TabEquipments` → `EquipmentList` → `EquipmentPartsSection.actionsSelection` (« Mettre sur la demande SAV » + « Créer un devis SAV » selon les droits).
- [ ] **Step 3: Documents → atelier** : état `{ ouvert, ongletId }` par carte équipement ; `EquipmentDocumentsSection.onOpenDocument` l'ouvre.
- [ ] **Step 4: Vérifier le risque de doublon signalé dans la conception** : lire `savService.createSAV` et l'appelant certificat (`sourceCertificatId`) ; noter dans le compte rendu final si une 2ᵉ demande SAV peut naître pour un client qui en a déjà une ouverte. **Ne rien changer à ce flux.**
- [ ] **Step 5: Build + lint + audit** — OK.
- [ ] **Step 6: Commit** — `feat(equipements): pièces mises sur la demande SAV depuis la fiche client`.

### Task 9: Fin du plein écran (fiche d'intervention, appareils à contrôler)

**Files:**
- Modify: `src/apps/artisan/components/interventions/EquipmentModelDocuments.jsx`
- Modify: `src/apps/artisan/components/dashboard/AppareilAControlerFiche.jsx`
- Delete: `src/apps/artisan/components/equipements/EquipmentDocumentViewer.jsx`, `src/apps/artisan/components/equipements/ExplodedViewViewer.jsx`

**Interfaces:**
- Consumes: `LecteurDocument` (Task 5).
- Produces: un clic sur un document ouvre `LecteurDocument` dans la page, sous sa ligne (hauteur 70vh, bouton « Fermer »), un seul ouvert à la fois.

- [ ] **Step 1: Remplacer** les deux usages d'`EquipmentDocumentViewer`.
- [ ] **Step 2: Supprimer** les deux visionneuses ; Run: `grep -rn "EquipmentDocumentViewer\|ExplodedViewViewer" src` — Expected: aucun résultat.
- [ ] **Step 3: `npm run audit:quality`** — Expected: « Aucun fichier orphelin détecté », tests PASS.
- [ ] **Step 4: Commit** — `refactor(equipements): plus de visionneuse plein écran`.

### Task 10: Puce « SAV » dans la fenêtre d'un RDV

**Files:**
- Create: `src/apps/artisan/components/planning/FicheSavDepuisRdv.jsx`
- Modify: `src/apps/artisan/components/planning/EventFormSections.jsx`

**Interfaces:**
- Consumes: `appointment.intervention_id`, `savService.getCardById(id)` (ligne `majordhome_entretien_sav`), `EntretienSAVModal({ item, onClose, onUpdated })`.
- Produces: `<FicheSavDepuisRdv interventionId onClose />` — lit la carte, ouvre `EntretienSAVModal` en portail au-dessus de la fenêtre RDV (z-index supérieur à celui d'`EventModal`) ; carte illisible → `toast.error('La demande SAV n\'a pas pu être ouverte')`. Puce `LinkChip` « SAV » à côté de « Fiche », seulement si la carte liée est de type `sav` (`intervention_type` disponible côté RDV, sinon lu par `getCardById` au clic et le dire si ce n'est pas un SAV).

- [ ] **Step 1: Écrire `FicheSavDepuisRdv`** et la puce.
- [ ] **Step 2: Build + lint** — OK.
- [ ] **Step 3: Commit** — `feat(planning): ouvrir la demande SAV depuis son RDV`.

### Task 11: Documentation, contrôle final, mémoire

**Files:**
- Modify: `CLAUDE.md` (Module Catalogue fournisseur, puce pièces détachées : mode atelier, `sav_part_selections`, technicien, lecteur pdf.js, fin du plein écran ; Module SAV : le technicien identifie les pièces)
- Modify: mémoire `project_referentiel_appareils_installes.md` / `project_pieces_detachees_invicta.md`

- [ ] **Step 1: Mettre à jour `CLAUDE.md`** (règles qui mordent seulement : photo ≠ prix, `onConflict` remplace, garde d'écran du technicien dans `savCloture.js`, lecteur unique `LecteurDocument`).
- [ ] **Step 2: Contrôle final** — `npx vite build`, `npm run lint`, `npm run audit:quality`, `node scripts/permissions-coherence.mjs --env .env.local` (§ 6 : la nouvelle vue n'est pas ouverte à anon).
- [ ] **Step 3: Pousser et suivre Vercel jusqu'à READY.**
- [ ] **Step 4: Commit** `CLAUDE.md` — `docs: mode atelier et pièces identifiées SAV`.
