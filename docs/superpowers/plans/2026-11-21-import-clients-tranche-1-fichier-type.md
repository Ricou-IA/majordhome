# Import des clients — tranche 1 (fichier type et parcours complet) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'administrateur d'une entreprise dépose un Excel ou un CSV de clients, fait correspondre ses colonnes, voit ce qui sera importé, importe par lots, et peut retirer l'import.

**Architecture:** Toutes les règles vivent dans des modules purs `src/lib/importClients/` (catalogue des champs, lecture, correspondance, contrôles), testés par `node --test`. L'écriture passe par des RPC SECURITY DEFINER (org_admin de l'entreprise de l'import), par lots idempotents. Les écrans (`/clients/import`) n'assemblent que ces modules ; ExcelJS n'est chargé qu'à la demande dans deux adaptateurs.

**Tech Stack:** React 18, TanStack Query v5, Tailwind, ExcelJS 4 (déjà présent), Supabase (PostgreSQL, PostgREST), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-21-import-clients-fichier-type-agent-design.md` — à lire avec ce plan. La tranche 2 (agent) a son propre plan : `docs/superpowers/plans/2026-11-21-import-clients-tranche-2-agent.md`.

## Global Constraints

- Import, liste des imports et retrait : **org_admin** seulement, tenu à l'écran (`useAuth().isOrgAdmin`) ET en base (chaque RPC).
- Limites du fichier : **10 Mo**, **10 000 lignes** ; `.xlsx` et `.csv` seulement, `.xls` refusé.
- Invariant affiché et testé : **lignes lues = importées + doublons écartés + écartées**.
- Liste des clients existants inconnue (chargement, échec) ⇒ import **fermé**, jamais « aucun doublon ».
- Aucune ligne envoyée à la base ne porte d'`org_id` : l'entreprise est celle de l'import.
- `client_number` jamais calculé : séquence de la base.
- Toute vue recréée s'écrit `CREATE OR REPLACE VIEW … WITH (security_invoker = true)` : sans le `WITH`, PostgreSQL **efface** l'option. Nouvelle colonne en **fin** de liste.
- Toute RPC : `SECURITY DEFINER`, `SET search_path`, `auth.uid() IS NULL` refusé en première instruction, garde positive (`IS NOT TRUE`), `REVOKE ALL … FROM PUBLIC, anon` puis `GRANT EXECUTE … TO authenticated`.
- Conventions du dépôt (`CLAUDE.md`) : services `{ data, error }` via `withErrorHandling`, mutations déballées par `unwrapResult`, clés de cache dans `cacheKeys.js` avec `orgId` en premier, `logger` et non `console`, aucun composant au-dessus de 500 lignes, Tailwind seul.
- Ne jamais lancer de serveur de développement ni d'outil d'aperçu : la preuve est `npm run audit:quality` et `npx vite build`.
- Commits par chemins explicites (`git commit … -- <fichiers>`) : d'autres sessions travaillent sur `main`.

## Review Focus

1. **CSV français** (Windows-1252, séparateur `;`, guillemets) : « Élodie » doit rester « Élodie ». → Task 2.
2. **Excel a mangé les zéros** : téléphone `612345678` et code postal `1000` lus comme nombres. → Task 1.
3. **Lignes parasites** : titre au-dessus de l'en-tête, lignes vides au milieu et à la fin ; une ligne vide n'est pas une « ligne lue ». → Task 2.
4. **Même fichier déposé deux fois** : aucune fiche recréée par défaut, y compris sans téléphone ni e-mail. → Task 4.
5. **Lot renvoyé après une coupure** : aucun doublon, et l'écran dit ce qui est déjà créé. → Task 5 (assertion) et Task 7.

## File Structure

| Fichier | Rôle |
|---|---|
| `src/lib/clientDisplayName.js` (créé) | `buildClientDisplayName`, sorti de `clients.service.js` pour être importable par un module pur |
| `src/lib/importClients/champs.js` | Catalogue des champs, cibles composées, seule définition |
| `src/lib/importClients/normaliser.js` | Mise en forme d'une valeur (téléphone, code postal, oui / non, énumérations) |
| `src/lib/importClients/lireFichier.js` | Cellule → texte, CSV → matrice, matrice → `{ entetes, lignes }` |
| `src/lib/importClients/correspondance.js` | Proposer, valider, appliquer une correspondance |
| `src/lib/importClients/controles.js` | Contrôler une fiche, classer les lignes, bilan, lignes à écrire |
| `src/lib/importClients/fichierType.js` | Contenu du fichier type et du fichier des lignes écartées (données, pas d'ExcelJS) |
| `scripts/import-clients/*.test.mjs` | Un fichier de test par module ci-dessus |
| `supabase/migrations/20261122_1_clients_import.sql` | Table, colonnes, vues, RPC |
| `supabase/migrations/20261122_2_geocode_file_equitable.sql` | File de géocodage équitable |
| `scripts/migration-rehearsal/assert-clients-import.sql`, `assert-geocode-file-equitable.sql` | Assertions du harnais |
| `src/shared/services/clientImports.service.js` | Lectures et appels RPC |
| `src/shared/hooks/useClientImports.js` | Liste, clients existants, exécution par lots, retrait |
| `src/apps/artisan/pages/ClientsImport.jsx` | Page : garde org_admin, assemble les étapes |
| `src/apps/artisan/components/clients/import/` | `useParcoursImport.js` (réducteur), `EtapeFichier.jsx`, `EtapeCorrespondance.jsx`, `EtapeApercu.jsx`, `EtapeResultat.jsx`, `ImportsPrecedents.jsx`, `classeur.js` (ExcelJS à la demande) |

Les numéros de migration (`20261122_1`, `_2`) se remplacent par le premier numéro libre du jour d'écriture.

---

### Task 1: Catalogue des champs et mise en forme des valeurs

**Files:**
- Create: `src/lib/importClients/champs.js`, `src/lib/importClients/normaliser.js`
- Test: `scripts/import-clients/champs.test.mjs`, `scripts/import-clients/normaliser.test.mjs`
- Modify: `package.json` (script `audit:quality` : ajouter les deux tests)

**Interfaces:**
- Produces (`champs.js`) :
  - `CHAMPS: Array<{ cle, libelle, colonne, type, synonymes: string[], exemple, aide, valeurs?: string[] }>` avec `type ∈ 'texte' | 'telephone' | 'email' | 'code_postal' | 'enum' | 'nombre' | 'entier' | 'oui_non'`.
  - Les vingt champs, dans cet ordre (`cle` → `colonne`) : `type_client`→`client_category`, `nom`→`last_name`, `prenom`→`first_name`, `societe`→`company_name`, `email`→`email`, `telephone`→`phone`, `telephone_2`→`phone_secondary`, `adresse`→`address`, `complement_adresse`→`address_complement`, `code_postal`→`postal_code`, `ville`→`city`, `type_logement`→`housing_type`, `surface`→`surface`, `annee_construction`→`construction_year`, `consignes_acces`→`access_instructions`, `notes`→`notes`, `notes_internes`→`internal_notes`, `accepte_emails`→`mail_optin`, `accepte_sms`→`sms_optin`, `ancien_numero`→`external_ref`.
  - `CIBLES_COMPOSEES: Array<{ cle, libelle, remplit: string[] }>` : `@nom_prenom` (« Nom et prénom, dans cet ordre », `['nom','prenom']`), `@prenom_nom` (« Prénom et nom, dans cet ordre »), `@cp_ville` (« Code postal et ville », `['code_postal','ville']`), `@adresse_complete` (« Adresse complète (rue, code postal, ville) », `['adresse','code_postal','ville']`).
  - `CIBLE_NOTES = '@notes'`, `CIBLE_IGNORER = '@ignorer'`, `CIBLE_A_CHOISIR = ''`.
  - `champParCle(cle) → champ | null`, `cleEntete(texte) → string` (minuscules, sans accent, ponctuation et espaces multiples réduits à une espace), `cibleDepuisEntete(entete) → cle | ''` (libellé exact du catalogue ou synonyme).
- Produces (`normaliser.js`) : `normaliserValeur(champ, brut) → { valeur, illisible: boolean }` où `valeur` est du type attendu par la colonne (`string | number | boolean | null`).

- [ ] **Step 1: Écrire les tests qui échouent**

```js
// scripts/import-clients/champs.test.mjs
test('vingt champs, clés et colonnes uniques', () => {
  assert.equal(CHAMPS.length, 20);
  assert.equal(new Set(CHAMPS.map((c) => c.cle)).size, 20);
  assert.equal(new Set(CHAMPS.map((c) => c.colonne)).size, 20);
});
test('un synonyme ne désigne qu\'un champ', () => {
  const vus = new Map();
  for (const c of CHAMPS) for (const s of [c.libelle, ...c.synonymes]) {
    const k = cleEntete(s);
    assert.ok(!vus.has(k) || vus.get(k) === c.cle, `${s} désigne ${vus.get(k)} et ${c.cle}`);
    vus.set(k, c.cle);
  }
});
test('en-têtes courants reconnus', () => {
  assert.equal(cibleDepuisEntete('Tél. portable'), 'telephone');
  assert.equal(cibleDepuisEntete('CP'), 'code_postal');
  assert.equal(cibleDepuisEntete('RAISON SOCIALE'), 'societe');
  assert.equal(cibleDepuisEntete('E-mail'), 'email');
  assert.equal(cibleDepuisEntete('N° client'), 'ancien_numero');
  assert.equal(cibleDepuisEntete('Code agence'), '');
});

// scripts/import-clients/normaliser.test.mjs
const n = (cle, brut) => normaliserValeur(champParCle(cle), brut);
test('téléphone : Excel a mangé le zéro', () => assert.deepEqual(n('telephone', '612345678'), { valeur: '06 12 34 56 78', illisible: false }));
test('téléphone : +33 et points', () => {
  assert.equal(n('telephone', '+33 6 12 34 56 78').valeur, '06 12 34 56 78');
  assert.equal(n('telephone', '06.12.34.56.78').valeur, '06 12 34 56 78');
});
test('téléphone étranger gardé tel quel, nettoyé', () => assert.equal(n('telephone', '+41 22 555 01 02').valeur, '+41 22 555 01 02'));
test('code postal : zéro retrouvé', () => assert.equal(n('code_postal', '1000').valeur, '01000'));
test('e-mail : minuscules ; invalide = illisible et vide', () => {
  assert.equal(n('email', ' Jean.DUPONT@Orange.FR ').valeur, 'jean.dupont@orange.fr');
  assert.deepEqual(n('email', 'pas un mail'), { valeur: null, illisible: true });
});
test('accord : vide = oui, « non » = non', () => {
  assert.equal(n('accepte_emails', '').valeur, true);
  for (const v of ['non', 'Non', '0', 'faux', 'refus']) assert.equal(n('accepte_sms', v).valeur, false);
});
test('type de logement et de client', () => {
  assert.equal(n('type_logement', 'Appart').valeur, 'appartement');
  assert.deepEqual(n('type_logement', 'yourte'), { valeur: null, illisible: true });
  assert.equal(n('type_client', 'Société').valeur, 'entreprise');
  assert.equal(n('type_client', 'Mairie').valeur, 'public');
});
test('surface « 120 m² » = 120 ; année « vers 1980 » illisible', () => {
  assert.equal(n('surface', '120 m²').valeur, 120);
  assert.equal(n('surface', '85,5').valeur, 85.5);
  assert.deepEqual(n('annee_construction', 'vers 1980'), { valeur: null, illisible: true });
});
test('vide = null, jamais illisible', () => assert.deepEqual(n('surface', '  '), { valeur: null, illisible: false }));
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test scripts/import-clients/champs.test.mjs scripts/import-clients/normaliser.test.mjs` → échec « Cannot find module ».

- [ ] **Step 3: Écrire `champs.js` puis `normaliser.js`**
  - Synonymes : au moins ceux des tests, plus les variantes usuelles (« Portable », « Mobile », « Téléphone fixe » → `telephone_2`, « Code postal », « Commune », « Mail », « Courriel », « Remarques » / « Commentaires » → `notes_internes`, « Réf. client » / « Code client » / « Numéro client » → `ancien_numero`).
  - Validité d'un e-mail : `emailsValides` de `src/lib/emailUtils.js` (seule définition, ne pas écrire une autre expression régulière).
  - Téléphone : chiffres extraits ; `33` ou `0033` en tête suivi de 9 chiffres ⇒ `0` + les 9 ; 9 chiffres commençant par 1 à 9 ⇒ `0` devant ; 10 chiffres commençant par `0` ⇒ groupés par deux avec des espaces (forme que `formatPhoneForSearch` sait retrouver) ; sinon `cleanPhone(brut)`.
  - Code postal : espaces retirés ; 4 chiffres ⇒ `0` devant ; autre chose que 5 chiffres ⇒ gardé tel quel, pas illisible.
  - `type_client` : particulier ; entreprise, société, societe, pro, professionnel ⇒ `entreprise` ; public, collectivité, mairie, administration ⇒ `public` ; autre ⇒ illisible.
  - `type_logement` : maison ; appartement, appart ; local, local commercial ⇒ `local_commercial` ; immeuble ; autre.

- [ ] **Step 4: Relancer, vérifier le succès** — même commande → tous verts.

- [ ] **Step 5: Ajouter les deux tests à `audit:quality` et committer**

```bash
git add src/lib/importClients/champs.js src/lib/importClients/normaliser.js scripts/import-clients package.json
git commit -m "feat(import clients): catalogue des champs et mise en forme des valeurs" -- src/lib/importClients scripts/import-clients package.json
```

---

### Task 2: Lecture du fichier

**Files:**
- Create: `src/lib/importClients/lireFichier.js`
- Test: `scripts/import-clients/lire-fichier.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Produces :
  - `LIGNES_MAX = 10000`, `OCTETS_MAX = 10 * 1024 * 1024`.
  - `refusFichier({ nom, taille }) → string | null` (message à afficher, `null` = accepté).
  - `decoderTexte(octets: Uint8Array) → string` : UTF-8 (BOM retiré) ; si le décodage strict échoue, Windows-1252.
  - `lireCsv(texte) → string[][]` : séparateur détecté sur la première ligne non vide parmi `;`, `,`, tabulation (celui qui apparaît le plus hors guillemets) ; guillemets doubles, `""` = un guillemet, retours à la ligne dans une cellule entre guillemets.
  - `celluleEnTexte(valeur) → string` : valeur de cellule ExcelJS. `null` → `''` ; `Date` → `AAAA-MM-JJ` (composantes UTC) ; `{ result }`, `{ text }`, `{ richText }` comme `cellToString` de `SupplierManagement.jsx` ; nombre → `String` sans notation scientifique.
  - `trouverEntete(matrice) → number` : parmi les dix premières lignes, l'index de celle qui a le plus de cellules de texte non vides (à égalité, la première).
  - `tableau(matrice, indexEntete) → { entetes: string[], lignes: Array<{ numero: number, cellules: string[] }> }` : `numero` = numéro de ligne dans le fichier (1 = première ligne) ; lignes entièrement vides **retirées** ; colonnes sans en-tête nommées « Colonne C », « Colonne D »… (lettre Excel).

- [ ] **Step 1: Écrire les tests qui échouent**

```js
test('refus : .xls, trop lourd', () => {
  assert.equal(refusFichier({ nom: 'clients.xls', taille: 1000 }), 'Ancien format Excel (.xls) : enregistrez-le en .xlsx ou .csv, puis déposez-le.');
  assert.equal(refusFichier({ nom: 'c.xlsx', taille: OCTETS_MAX + 1 }), 'Fichier trop lourd (10 Mo au plus).');
  assert.equal(refusFichier({ nom: 'c.pdf', taille: 10 }), 'Format non pris en charge : déposez un fichier .xlsx ou .csv.');
  assert.equal(refusFichier({ nom: 'Clients.CSV', taille: 10 }), null);
});
test('Windows-1252 : Élodie reste Élodie', () => {
  const octets = Uint8Array.from([0xC9, 0x6C, 0x6F, 0x64, 0x69, 0x65]); // « Élodie » en 1252, invalide en UTF-8
  assert.equal(decoderTexte(octets), 'Élodie');
});
test('UTF-8 avec BOM', () => assert.equal(decoderTexte(Uint8Array.from([0xEF, 0xBB, 0xBF, 0x41])), 'A'));
test('CSV : point-virgule, guillemets, retour à la ligne dans une cellule', () => {
  assert.deepEqual(lireCsv('Nom;Adresse\r\n"DUPONT";"12 rue ""des Lilas""\nBât. B"\r\n'), [['Nom', 'Adresse'], ['DUPONT', '12 rue "des Lilas"\nBât. B']]);
});
test('CSV : virgule détectée', () => assert.deepEqual(lireCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]));
test('cellules ExcelJS', () => {
  assert.equal(celluleEnTexte(612345678), '612345678');
  assert.equal(celluleEnTexte({ formula: 'A1', result: 'Jean' }), 'Jean');
  assert.equal(celluleEnTexte({ richText: [{ text: 'DU' }, { text: 'PONT' }] }), 'DUPONT');
  assert.equal(celluleEnTexte(new Date(Date.UTC(2024, 2, 5))), '2024-03-05');
  assert.equal(celluleEnTexte(null), '');
});
test('titre au-dessus de l\'en-tête, lignes vides ignorées, numéros du fichier gardés', () => {
  const m = [['Export clients du 12/11'], [], ['Nom', 'Prénom', 'Tél'], ['DUPONT', 'Jean', '06'], ['', '', ''], ['MARTIN', 'Léa', '']];
  assert.equal(trouverEntete(m), 2);
  const t = tableau(m, 2);
  assert.deepEqual(t.entetes, ['Nom', 'Prénom', 'Tél']);
  assert.deepEqual(t.lignes.map((l) => l.numero), [4, 6]);
});
test('colonne sans en-tête', () => assert.deepEqual(tableau([['Nom', '', 'Ville'], ['A', 'B', 'C']], 0).entetes, ['Nom', 'Colonne B', 'Ville']));
```

- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test scripts/import-clients/lire-fichier.test.mjs`.
- [ ] **Step 3: Écrire `lireFichier.js`** (aucun import d'ExcelJS ici : le chargement du classeur est dans `classeur.js`, Task 8).
- [ ] **Step 4: Relancer, vérifier le succès.**
- [ ] **Step 5: Committer** — `feat(import clients): lecture d'un CSV et d'une feuille en tableau`.

---

### Task 3: Correspondance des colonnes

**Files:**
- Create: `src/lib/importClients/correspondance.js`
- Test: `scripts/import-clients/correspondance.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Consumes : `CHAMPS`, `CIBLES_COMPOSEES`, `CIBLE_NOTES`, `CIBLE_IGNORER`, `CIBLE_A_CHOISIR`, `cibleDepuisEntete` (Task 1) ; `tableau()` (Task 2).
- Produces :
  - `Correspondance = Array<{ index: number, entete: string, cible: string, origine: 'fichier_type' | 'synonyme' | 'agent' | 'main' | '' }>` — `cible` = clé d'un champ, clé d'une cible composée, `CIBLE_NOTES`, `CIBLE_IGNORER` ou `CIBLE_A_CHOISIR`.
  - `estFichierType(entetes) → boolean` : toutes les en-têtes non vides sont des libellés exacts de `CHAMPS`.
  - `proposerCorrespondance(entetes) → Correspondance` : origine `fichier_type` si `estFichierType`, sinon `synonyme` pour les colonnes reconnues et `CIBLE_A_CHOISIR` pour les autres ; un champ déjà pris par une colonne précédente n'est pas reproposé.
  - `validerCorrespondance(c) → { erreurs: string[], aChoisir: number }` — erreurs : « Deux colonnes vont vers « Téléphone » : gardez-en une. » (champ pris deux fois, cibles composées comprises), « Indiquez la colonne du nom ou de la société. » (ni `nom`, ni `societe`, ni `@nom_prenom`, ni `@prenom_nom`).
  - `appliquerCorrespondance(ligne, c) → { numero, valeurs: Record<cleChamp, string>, notesAjoutees: string[] }` : `notesAjoutees` = « En-tête : valeur » pour chaque colonne `CIBLE_NOTES` non vide ; une colonne `CIBLE_A_CHOISIR` est traitée comme ignorée.
  - `decouper(cibleComposee, texte) → Record<cleChamp, string>`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
test('fichier type reconnu', () => {
  const c = proposerCorrespondance(CHAMPS.map((x) => x.libelle));
  assert.ok(c.every((x) => x.origine === 'fichier_type' && x.cible));
});
test('synonymes, puis à choisir', () => {
  const c = proposerCorrespondance(['NOM', 'Tél. portable', 'Code agence', 'Portable']);
  assert.deepEqual(c.map((x) => x.cible), ['nom', 'telephone', '', '']); // « Portable » : téléphone déjà pris
  assert.equal(validerCorrespondance(c).aChoisir, 2);
});
test('validation', () => {
  const base = [{ index: 0, entete: 'A', cible: 'telephone', origine: 'main' }, { index: 1, entete: 'B', cible: 'telephone', origine: 'main' }];
  assert.deepEqual(validerCorrespondance(base).erreurs, ['Deux colonnes vont vers « Téléphone » : gardez-en une.', 'Indiquez la colonne du nom ou de la société.']);
});
test('découpes', () => {
  assert.deepEqual(decouper('@nom_prenom', 'DE LA FONTAINE Jean-Pierre'), { nom: 'DE LA FONTAINE', prenom: 'Jean-Pierre' });
  assert.deepEqual(decouper('@nom_prenom', 'Dupont Jean'), { nom: 'Dupont', prenom: 'Jean' });
  assert.deepEqual(decouper('@prenom_nom', 'Jean Dupont'), { prenom: 'Jean', nom: 'Dupont' });
  assert.deepEqual(decouper('@cp_ville', '81600 Gaillac'), { code_postal: '81600', ville: 'Gaillac' });
  assert.deepEqual(decouper('@adresse_complete', '12 rue des Lilas 81600 Gaillac'), { adresse: '12 rue des Lilas', code_postal: '81600', ville: 'Gaillac' });
  assert.deepEqual(decouper('@adresse_complete', 'Lieu-dit Le Bosc'), { adresse: 'Lieu-dit Le Bosc', code_postal: '', ville: '' });
});
test('application : notes ajoutées, colonnes ignorées', () => {
  const c = [{ index: 0, entete: 'Client', cible: '@nom_prenom' }, { index: 1, entete: 'Marque chaudière', cible: '@notes' }, { index: 2, entete: 'Agence', cible: '@ignorer' }];
  assert.deepEqual(appliquerCorrespondance({ numero: 7, cellules: ['DUPONT Jean', 'Viessmann', 'Albi'] }, c),
    { numero: 7, valeurs: { nom: 'DUPONT', prenom: 'Jean' }, notesAjoutees: ['Marque chaudière : Viessmann'] });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire `correspondance.js`.** `@nom_prenom` : le nom est la suite des mots de tête entièrement en majuscules (au moins un) ; s'il n'y en a pas, le premier mot. `@prenom_nom` : le premier mot est le prénom. `@cp_ville` et `@adresse_complete` : le code postal est le **dernier** groupe de 5 chiffres ; sans lui, tout va dans le premier champ.
- [ ] **Step 4: Relancer, vérifier le succès.**
- [ ] **Step 5: Committer** — `feat(import clients): correspondance des colonnes`.

---

### Task 4: Contrôles, doublons, bilan

**Files:**
- Create: `src/lib/clientDisplayName.js`, `src/lib/importClients/controles.js`
- Modify: `src/shared/services/clients.service.js:40-54` (déplacer `buildClientDisplayName` et `COMPANY_FIRST_CATEGORIES` dans `src/lib/clientDisplayName.js`, les réexporter depuis le service : aucun appelant ne change)
- Test: `scripts/import-clients/controles.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Consumes : `normaliserValeur`, `champParCle` (Task 1) ; sortie d'`appliquerCorrespondance` (Task 3) ; `buildClientDuplicateProbe`, `matchClientDuplicates`, `phoneTailKey` de `src/lib/clientDuplicateMatch.js` ; `normalizeEmailKey`, `normalizeNameKey` de `src/lib/leadDuplicateMatch.js`.
- Produces :
  - `controlerFiche(candidate) → { numero, fiche: Record<colonne, valeur>, ecartee: boolean, raison: '' | 'sans_nom', corrections: Array<{ libelle: string, valeur: string }> }`. `fiche` porte les vingt colonnes du catalogue plus `display_name` ; `internal_notes` = notes internes du fichier, puis `notesAjoutees`, puis une ligne « <Libellé> d'origine : <valeur> » par correction.
  - `classerLignes(candidates, clientsExistants) → Array<{ numero, fiche, statut, raison, doublons, corrections }>` avec `statut ∈ 'prete' | 'doublon_fort' | 'doublon_faible' | 'doublon_fichier' | 'ecartee'` ; `doublons` = fiches existantes rapprochées (sortie de `matchClientDuplicates`, plus `raisonAncienNumero: true` le cas échéant) ou `[{ numero }]` pour un doublon dans le fichier.
  - `aImporter(ligneClassee, choix) → boolean` avec `choix = { importer: Set<number>, ecarter: Set<number> }` (numéros de ligne) : `prete` oui ; `doublon_fort` seulement si dans `importer` ; `doublon_faible` sauf si dans `ecarter` ; `doublon_fichier` et `ecartee` jamais.
  - `bilan(classees, choix) → { lues, importees, doublons_ecartes, ecartees }` (`doublons_ecartes` = forts non repris + faibles écartés + doublons du fichier).
  - `lignesPourEcriture(classees, choix) → Array<Record<string, unknown>>` : pour chaque ligne à importer, `{ import_line: numero, …fiche }`.
  - `LIBELLE_RAISON = { sans_nom: 'Ni nom ni société', doublon_fichier: 'Déjà présent plus haut dans le fichier', doublon_fort: 'Déjà dans vos clients', doublon_faible: 'Homonyme écarté' }`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
const cand = (numero, valeurs, notesAjoutees = []) => ({ numero, valeurs, notesAjoutees });
test('ni nom ni société : écartée', () => {
  const r = controlerFiche(cand(2, { email: 'a@b.fr' }));
  assert.equal(r.ecartee, true); assert.equal(r.raison, 'sans_nom');
});
test('société sans type : entreprise, affichée sous sa raison sociale', () => {
  const { fiche } = controlerFiche(cand(2, { societe: 'Garage Durand', nom: 'Durand', prenom: 'Paul' }));
  assert.equal(fiche.client_category, 'entreprise');
  assert.equal(fiche.display_name, 'GARAGE DURAND');
  assert.equal(fiche.last_name, 'DURAND'); assert.equal(fiche.first_name, 'PAUL');
});
test('valeur illisible : champ vide, valeur gardée en notes internes, ligne importable', () => {
  const r = controlerFiche(cand(3, { nom: 'Martin', email: 'martin(at)free', notes_internes: 'Chien' }, ['Marque : Atlantic']));
  assert.equal(r.ecartee, false);
  assert.equal(r.fiche.email, null);
  assert.equal(r.fiche.internal_notes, 'Chien\nMarque : Atlantic\nE-mail d\'origine : martin(at)free');
  assert.equal(r.fiche.notes, null);
  assert.deepEqual(r.corrections, [{ libelle: 'E-mail', valeur: 'martin(at)free' }]);
});
test('accord e-mails et SMS : oui d\'office', () => {
  const { fiche } = controlerFiche(cand(2, { nom: 'A', accepte_sms: 'non' }));
  assert.equal(fiche.mail_optin, true); assert.equal(fiche.sms_optin, false);
});

const existants = [
  { id: 'c1', first_name: 'JEAN', last_name: 'DUPONT', phone: '06 12 34 56 78', email: null, postal_code: '81600', external_ref: null },
  { id: 'c2', first_name: 'LEA', last_name: 'MARTIN', phone: null, email: null, postal_code: '81000', external_ref: 'A-204' },
  { id: 'c3', first_name: 'PAUL', last_name: 'ROUX', phone: null, email: null, postal_code: '31000', external_ref: null },
];
const classe = (valeurs) => classerLignes([cand(2, valeurs)], existants)[0].statut;
test('doublons avec la base', () => {
  assert.equal(classe({ nom: 'Dupond', telephone: '612345678' }), 'doublon_fort');              // même téléphone
  assert.equal(classe({ nom: 'Autre', ancien_numero: 'a-204' }), 'doublon_fort');                // même ancien numéro
  assert.equal(classe({ nom: 'Roux', prenom: 'Paul', code_postal: '31000' }), 'doublon_fort');   // même nom + prénom, même code postal
  assert.equal(classe({ nom: 'Roux', prenom: 'Paul' }), 'doublon_fort');                         // même nom + prénom, code postal absent du fichier
  assert.equal(classe({ nom: 'Roux', prenom: 'Paul', code_postal: '75001' }), 'doublon_faible'); // homonyme ailleurs
  assert.equal(classe({ nom: 'Roux', prenom: 'Anne', code_postal: '31000' }), 'doublon_faible'); // même nom, même commune
  assert.equal(classe({ nom: 'Nouveau', prenom: 'Client' }), 'prete');
});
test('même fichier déposé deux fois : rien n\'est recréé par défaut', () => {
  const fichier = [cand(2, { nom: 'Roux', prenom: 'Paul', code_postal: '31000' }), cand(3, { nom: 'Martin', prenom: 'Léa', ancien_numero: 'A-204' })];
  const classees = classerLignes(fichier, existants);
  assert.equal(bilan(classees, { importer: new Set(), ecarter: new Set() }).importees, 0);
});
test('doublon dans le fichier : la première ligne est gardée', () => {
  const r = classerLignes([cand(2, { nom: 'Petit', prenom: 'Luc', code_postal: '81000' }), cand(3, { nom: 'PETIT', prenom: 'luc', code_postal: '81000' })], []);
  assert.deepEqual(r.map((l) => l.statut), ['prete', 'doublon_fichier']);
  assert.deepEqual(r[1].doublons, [{ numero: 2 }]);
});
test('invariant du bilan, quels que soient les choix', () => {
  const fichier = [cand(2, { nom: 'Nouveau' }), cand(3, { nom: 'Dupond', telephone: '0612345678' }), cand(4, { nom: 'Roux', prenom: 'Paul' }), cand(5, { email: 'x@y.fr' }), cand(6, { nom: 'Nouveau' , code_postal: '1'})];
  const classees = classerLignes(fichier, existants);
  for (const choix of [{ importer: new Set(), ecarter: new Set() }, { importer: new Set([3]), ecarter: new Set([4]) }]) {
    const b = bilan(classees, choix);
    assert.equal(b.lues, 5);
    assert.equal(b.importees + b.doublons_ecartes + b.ecartees, b.lues);
    assert.equal(lignesPourEcriture(classees, choix).length, b.importees);
  }
});
test('ligne à écrire : numéro de ligne, aucune organisation', () => {
  const [l] = lignesPourEcriture(classerLignes([cand(9, { nom: 'Blanc' })], []), { importer: new Set(), ecarter: new Set() });
  assert.equal(l.import_line, 9); assert.equal(l.display_name, 'BLANC'); assert.ok(!('org_id' in l));
});
```

- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Déplacer `buildClientDisplayName`, écrire `controles.js`.**
  - Noms et prénoms en majuscules (`toUpperCase`), comme `createClient`.
  - Doublons avec la base : construire une fois trois index sur `clientsExistants` (clé téléphone à 9 chiffres pour `phone` et `phone_secondary`, clé e-mail, clé de nom de famille), plus un index sur `external_ref` (trim, minuscules) ; pour chaque fiche, réunir les candidats de ces index puis les confirmer par `matchClientDuplicates`. Ne jamais balayer toute la liste par fiche (10 000 × 10 000).
  - Fort = `isStrong`, ou ancien numéro égal, ou raison `name` quand les deux codes postaux sont égaux **ou que l'un des deux manque** (sinon un import interrompu puis redéposé recréerait les fiches sans adresse). Faible = le reste des rapprochements.
  - Doublon dans le fichier (contre les lignes précédentes non écartées) : même ancien numéro non vide ; ou même `normalizeNameKey` et (même clé téléphone, ou même clé e-mail, ou même code postal non vide).
- [ ] **Step 4: Relancer** — `node --test scripts/import-clients/controles.test.mjs scripts/client-duplicate-match.test.mjs` → verts.
- [ ] **Step 5: Committer** — `feat(import clients): contrôles, doublons et bilan` (chemins : `src/lib/clientDisplayName.js`, `src/lib/importClients/controles.js`, `src/shared/services/clients.service.js`, le test, `package.json`).

---

### Task 5: Base — imports, colonnes, vues, RPC

**Files:**
- Create: `supabase/migrations/20261122_1_clients_import.sql`, `scripts/migration-rehearsal/assert-clients-import.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (colonnes de `majordhome.clients` lues par la migration : `notes`, `internal_notes`, `housing_type`, `surface`, `construction_year`, `access_instructions`, `mail_optin`, `import_source`, `created_by`, et toute colonne citée par les deux vues ; `VIEWS` : `majordhome_clients`, `majordhome_clients_all` si absentes), `docs/DATABASE.md`

**Interfaces:**
- Produces (appelées par la Task 7) :
  - `public.clients_import_start(p_org_id uuid, p_file_name text, p_source_label text, p_mapping jsonb, p_counts jsonb) RETURNS uuid`
  - `public.clients_import_batch(p_import_id uuid, p_rows jsonb) RETURNS jsonb` → `{ "created": n, "skipped": n }`
  - `public.clients_import_finish(p_import_id uuid, p_counts jsonb) RETURNS void`
  - `public.clients_import_removal_preview(p_import_id uuid) RETURNS jsonb` → `{ "retirables": n, "conservees": n }`
  - `public.clients_import_remove(p_import_id uuid, p_limit integer DEFAULT 200) RETURNS jsonb` → `{ "retirees": n, "conservees": n, "restantes": n }`
  - Vue `public.majordhome_client_imports` : `id, org_id, created_by, created_by_name, created_at, file_name, source_label, counts, status, removed_at` ; colonne `external_ref` en fin de `majordhome_clients` et `majordhome_clients_all`.
  - Codes d'erreur (message de l'exception) : `unauthenticated`, `org_admin_required` (42501), `import_not_found` (P0002), `import_closed`, `rows_invalid`, `row_invalid`.

- [ ] **Step 1: Écrire l'assertion du harnais** (`assert-clients-import.sql`, blocs `DO $$ … RAISE EXCEPTION … $$`, appelant sous `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated`). Elle doit échouer si l'un de ces faits est faux :
  1. Les deux vues clients et `majordhome_client_imports` ont `security_invoker=true` ; `external_ref` est la dernière colonne des deux vues clients ; `anon` n'a aucun droit sur `majordhome_client_imports` ; `has_function_privilege('anon', …, 'EXECUTE')` est faux pour les cinq RPC et pour les fonctions internes.
  2. Un org_admin de A : `start` rend un id, `batch` de 3 lignes rend `created = 3`, les 3 fiches sont dans A avec `import_id`, `import_line`, un `client_number` distinct chacune, un `project_id` dont le projet est dans A, `mail_optin` tel qu'envoyé.
  3. Le **même** lot renvoyé rend `created = 0, skipped = 3` et le nombre de fiches ne bouge pas.
  4. Un lot dont une ligne a un `display_name` vide lève `row_invalid` et n'écrit **aucune** ligne du lot.
  5. Refus `org_admin_required` : un membre non administrateur de A ; un org_admin de B sur l'import de A (`batch`, `finish`, `preview`, `remove`) ; `start` par un org_admin de B avec `p_org_id` = A. Sans `request.jwt.claims` : `unauthenticated`.
  6. `finish` passe l'import à `termine` ; un `batch` ensuite lève `import_closed`.
  7. Retrait : une des 3 fiches reçoit un contrat ; `preview` rend `{ retirables: 2, conservees: 1 }` ; `remove` rend `retirees = 2, conservees = 1, restantes = 0`, l'import est `retire`, la fiche au contrat existe toujours, les deux autres et leurs projets n'existent plus. Une fiche qui n'a qu'une ligne `client_dpe` est retirée.
  8. Un membre de B ne lit aucune ligne de `majordhome_client_imports` de A.

- [ ] **Step 2: Lancer, vérifier l'échec**

```bash
node scripts/migration-rehearsal/snapshot.mjs --env .env.local
node scripts/migration-rehearsal/run.mjs --assert scripts/migration-rehearsal/assert-clients-import.sql
```
Attendu : échec (« function public.clients_import_start does not exist »).

- [ ] **Step 3: Écrire la migration**
  - `majordhome.client_imports` : `id uuid PK DEFAULT gen_random_uuid()`, `org_id uuid NOT NULL REFERENCES core.organizations`, `created_by uuid`, `created_at timestamptz NOT NULL DEFAULT now()`, `file_name text NOT NULL`, `source_label text`, `mapping jsonb NOT NULL DEFAULT '[]'`, `counts jsonb NOT NULL DEFAULT '{}'`, `status text NOT NULL DEFAULT 'en_cours' CHECK (status IN ('en_cours','termine','retire'))`, `removed_at timestamptz`, `removed_by uuid`. RLS activée ; une seule policy : SELECT pour un org_admin de `org_id`. `GRANT SELECT … TO service_role`.
  - `majordhome.clients` : `import_id uuid REFERENCES majordhome.client_imports(id) ON DELETE SET NULL`, `import_line integer`, `external_ref text` ; index unique partiel `(import_id, import_line) WHERE import_id IS NOT NULL` ; index `(org_id, external_ref) WHERE external_ref IS NOT NULL`.
  - Les deux vues clients recréées à l'identique (définition actuelle : `pg_get_viewdef` en production) avec `external_ref` **après** `has_active_contract`, et `WITH (security_invoker = true)`. `REVOKE ALL … FROM PUBLIC, anon` réémis sur les trois vues.
  - Garde commune `majordhome.clients_import_org_admin(p_import_id uuid) RETURNS uuid` (rend l'`org_id` de l'import, lève sinon ; `REVOKE ALL … FROM PUBLIC, anon, authenticated`). « org_admin » se lit comme dans `update_member_role` (`supabase/migrations/20261121_3_update_member_role_etanche.sql`) : même condition sur `core.organization_members`, adhésion active comprise.
  - `clients_import_batch` : `p_rows` doit être un tableau de 1 à 500 objets (`rows_invalid` sinon) ; import `en_cours` (`import_closed` sinon). Par ligne : `import_line` entier et `display_name` non vide exigés (`row_invalid`) ; ligne déjà présente pour `(import_id, import_line)` ⇒ comptée `skipped` ; sinon `INSERT core.projects (org_id, name, slug, status, identity, created_by)` (même `identity` que `clientsService.createClient`, `created_from = 'import_clients'`, `slug` = nom réduit + `-` + 8 caractères d'un uuid) puis `INSERT majordhome.clients` avec **la liste fermée** des colonnes du catalogue (Task 1), `display_name`, `org_id` de l'import, `project_id`, `import_id`, `import_line`, `import_source` = `source_label` de l'import, `created_by = auth.uid()`. Aucune autre clé de la ligne n'est lue. `mail_optin` / `sms_optin` absents ⇒ `true`.
  - `majordhome.clients_import_retirables(p_import_id uuid) RETURNS uuid[]` (interne) : fiches de l'import **non référencées**. Les références se lisent dans `pg_constraint` à l'exécution (toute clé étrangère vers `majordhome.clients` ou vers `core.projects`, par `EXECUTE format(…)` avec `%I` et le `regclass`), sauf `majordhome.clients.project_id` (la fiche elle-même) et `majordhome.client_dpe`. Travailler sur un tableau d'identifiants (`= ANY($1)`), **pas de table temporaire** (incident du 2026-10-25).
  - `clients_import_remove` : supprime au plus `p_limit` (borné 1..500) fiches retirables puis leurs projets ; `restantes` = retirables encore présentes ; à `restantes = 0`, `status = 'retire'`, `removed_at`, `removed_by`. Ne passe jamais par `client_hard_delete` (pas d'instantané de corbeille : le fichier d'origine fait foi).

- [ ] **Step 4: Répéter la migration, vérifier le succès**

```bash
node scripts/migration-rehearsal/run.mjs --migration supabase/migrations/20261122_1_clients_import.sql --assert scripts/migration-rehearsal/assert-clients-import.sql
```
Attendu : toutes les assertions passent.

- [ ] **Step 5: Mesurer la durée d'un lot sur le harnais** — bloc `DO` qui appelle `clients_import_batch` avec 200 lignes sous l'identité d'un org_admin, lit `clock_timestamp()` avant et après, puis `RAISE EXCEPTION 'duree_ms=%'`. Attendu : sous 2 000 ms. Au-dessus, baisser `TAILLE_LOT` (Task 7) pour rester sous 2 s et noter le chiffre dans l'en-tête de la migration. Faire la même mesure pour `clients_import_remove(…, 200)`.

- [ ] **Step 6: Documenter et committer** — section `majordhome.client_imports` et les trois colonnes dans `docs/DATABASE.md` ; commit `feat(import clients): table des imports, écriture par lots et retrait`.

---

### Task 6: File de géocodage équitable entre entreprises

**Files:**
- Create: `supabase/migrations/20261122_2_geocode_file_equitable.sql`, `scripts/migration-rehearsal/assert-geocode-file-equitable.sql`
- Modify: `scripts/migration-rehearsal/snapshot.mjs` (`FUNCTIONS` : `public.geocode_fetch_pending_clients(integer)` ; colonnes `geocoded_at`, `geocode_attempts` de `clients`)

**Interfaces:**
- Produces : `public.geocode_fetch_pending_clients(p_limit integer DEFAULT 100)` — **même signature, mêmes colonnes rendues, mêmes conditions** qu'aujourd'hui (`20260617_2_geocode_sweep_rpcs.sql`) ; seul l'ordre change. L'edge `geocode-sweep` n'est pas touchée.

- [ ] **Step 1: Écrire l'assertion** : entreprise A avec 150 fiches en attente créées hier, entreprise B avec 3 fiches en attente créées aujourd'hui ⇒ `geocode_fetch_pending_clients(100)` rend 100 lignes dont **les 3 de B** ; avec A seule en attente, les 100 plus anciennes de A dans l'ordre de création ; `has_function_privilege` d'`anon` et d'`authenticated` inchangé par rapport à avant la migration (relevé en tête de l'assertion).
- [ ] **Step 2: Lancer, vérifier l'échec** (les 3 fiches de B ne sont pas rendues).
- [ ] **Step 3: Écrire la migration** : `CREATE OR REPLACE FUNCTION` ; `row_number() OVER (PARTITION BY c.org_id ORDER BY c.created_at ASC NULLS LAST)` sur les fiches en attente, puis `ORDER BY rang, created_at ASC NULLS LAST LIMIT GREATEST(1, LEAST(p_limit, 500))`.
- [ ] **Step 4: Répéter, vérifier le succès.**
- [ ] **Step 5: Committer** — `fix(geocodage): la file alterne entre entreprises`.

---

### Task 7: Service, clés de cache et hooks

**Files:**
- Create: `src/shared/services/clientImports.service.js`, `src/shared/hooks/useClientImports.js`, `src/lib/importClients/lots.js`
- Modify: `src/shared/hooks/cacheKeys.js` (famille `clientImportKeys`)
- Test: `scripts/import-clients/lots.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Consumes : RPC et vue de la Task 5 ; `lignesPourEcriture`, `bilan` (Task 4) ; `fetchAllPages` (`src/lib/postgrestUtils.js`) ; `unwrapResult`, `withErrorHandling`.
- Produces :
  - `lots.js` : `TAILLE_LOT = 200` ; `decouperEnLots(lignes, taille = TAILLE_LOT) → Array<Array>` ; `messageErreurImport(error) → string` (codes de la Task 5 → phrases : `org_admin_required` « Réservé à l'administrateur de l'entreprise. », `import_closed` « Cet import est déjà terminé. », `row_invalid` / `rows_invalid` « Une ligne du fichier n'a pas pu être écrite : aucune fiche de ce lot n'a été créée. », défaut : le message reçu).
  - `clientImportKeys = { all: (orgId) => ['client-imports', orgId], list: (orgId) => [...all(orgId), 'list'], existants: (orgId) => [...all(orgId), 'existants'], apercuRetrait: (orgId, id) => [...all(orgId), 'retrait', id] }`.
  - `clientImportsService` : `listImports(orgId)`, `loadExistingClients(orgId)` (tous les clients non archivés, colonnes `id, display_name, first_name, last_name, email, phone, phone_secondary, postal_code, city, client_number, external_ref`, tri stable par `id`, par `fetchAllPages`), `startImport({ orgId, fileName, sourceLabel, mapping, counts })`, `sendBatch({ importId, rows })`, `finishImport({ importId, counts })`, `previewRemoval(importId)`, `removeBatch(importId)`.
  - Hooks : `useClientImports(orgId)` ; `useExistingClientsForImport(orgId, { enabled })` → `{ clients, isLoading, error }` (`clients` reste `undefined` tant qu'inconnu) ; `useRemovalPreview(orgId, importId)` ; `useRemoveClientImport(orgId)` (boucle `removeBatch` jusqu'à `restantes === 0`, résout avec les totaux) ; `useClientImportRun(orgId)` → `{ etat, progression: { faits, total }, bilan, erreur, lancer(params), reprendre() }` avec `etat ∈ 'repos' | 'en_cours' | 'interrompu' | 'termine'`.

- [ ] **Step 1: Écrire les tests qui échouent**

```js
test('découpe en lots sans perdre ni dupliquer', () => {
  const lignes = Array.from({ length: 450 }, (_, i) => ({ import_line: i + 2 }));
  const lots = decouperEnLots(lignes);
  assert.deepEqual(lots.map((l) => l.length), [200, 200, 50]);
  assert.deepEqual(lots.flat(), lignes);
  assert.deepEqual(decouperEnLots([]), []);
});
test('codes de la base traduits', () => {
  assert.equal(messageErreurImport({ message: 'org_admin_required' }), 'Réservé à l\'administrateur de l\'entreprise.');
  assert.equal(messageErreurImport({ message: 'autre chose' }), 'autre chose');
});
```

- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire `lots.js`, le service, les clés, les hooks.**
  - `useClientImportRun.lancer({ fileName, sourceLabel, mapping, classees, choix })` : `startImport` → lots envoyés **l'un après l'autre** → `finishImport` avec le bilan. Un lot refusé arrête la boucle : `etat = 'interrompu'`, `erreur` = `messageErreurImport`, `progression.faits` = fiches réellement créées ; `reprendre()` renvoie les lots à partir du premier non confirmé (le lot refusé compris : la base passe ce qui existe déjà).
  - Le bilan final compte les fiches **créées** rendues par la base (`created`), pas les lignes envoyées ; un écart avec `bilan().importees` est affiché tel quel.
  - Après un import terminé ou un retrait : invalider `clientKeys.all(orgId)` et `clientImportKeys.all(orgId)`.
- [ ] **Step 4: Relancer** — `node --test scripts/import-clients/lots.test.mjs` et `npm run lint:errors` → verts.
- [ ] **Step 5: Committer** — `feat(import clients): service, lots et exécution reprenable`.

---

### Task 8: La page d'import (quatre étapes)

**Files:**
- Create: `src/apps/artisan/pages/ClientsImport.jsx`, `src/apps/artisan/components/clients/import/{useParcoursImport.js,EtapeFichier.jsx,EtapeCorrespondance.jsx,EtapeApercu.jsx,EtapeResultat.jsx,classeur.js}`, `src/lib/importClients/fichierType.js`
- Modify: `src/apps/artisan/routes.jsx` (route `clients/import`, chargée à la demande comme les autres), `src/apps/artisan/pages/Clients.jsx:476-484` (bouton « Importer » à gauche de « Nouveau client », visible si `useAuth().isOrgAdmin`, `navigate('/clients/import')`, style secondaire : bord gris, fond blanc)
- Test: `scripts/import-clients/fichier-type.test.mjs` (ajouté à `audit:quality`)

**Interfaces:**
- Consumes : tout ce que produisent les Tasks 1 à 4 et 7.
- Produces :
  - `fichierType.js` : `feuillesFichierType() → [{ nom: 'Clients', lignes: [libellés] }, { nom: "Mode d'emploi", lignes: [['Colonne', 'À quoi elle sert', 'Exemple', 'Valeurs admises'], …une par champ] }]` ; `feuilleLignesEcartees(entetes, lignesDuFichier, classees, choix) → { nom: 'Lignes écartées', lignes }` (en-têtes d'origine + « Raison », une ligne par ligne non importée, raison par `LIBELLE_RAISON`).
  - `classeur.js` (seul fichier qui importe ExcelJS, par `await import('exceljs')`) : `lireFichierDepose(file: File) → Promise<string[][]>` (`.csv` : `decoderTexte` + `lireCsv` ; `.xlsx` : première feuille non vide, cellules par `celluleEnTexte`) ; `telechargerClasseur(nomFichier, feuilles)` (`downloadBlob` de `src/lib/utils.js`).
  - `useParcoursImport()` : `useReducer`, état `{ etape: 'fichier' | 'correspondance' | 'apercu' | 'resultat', fichier: { nom, matrice, indexEntete, entetes, lignes } | null, sourceLabel, correspondance, choix }`.

- [ ] **Step 1: Écrire le test qui échoue**

```js
test('le fichier type se réimporte sans rien pointer', () => {
  const [clients, aide] = feuillesFichierType();
  assert.equal(clients.lignes.length, 1);                       // l'en-tête seule : aucune ligne d'exemple
  assert.ok(estFichierType(clients.lignes[0]));
  assert.equal(aide.lignes.length, CHAMPS.length + 1);
});
test('lignes écartées : colonnes d\'origine et raison', () => {
  const classees = classerLignes([{ numero: 2, valeurs: { email: 'a@b.fr' }, notesAjoutees: [] }], []);
  const f = feuilleLignesEcartees(['Mail'], [{ numero: 2, cellules: ['a@b.fr'] }], classees, { importer: new Set(), ecarter: new Set() });
  assert.deepEqual(f.lignes, [['Mail', 'Raison'], ['a@b.fr', 'Ni nom ni société']]);
});
```

- [ ] **Step 2: Lancer, vérifier l'échec.**
- [ ] **Step 3: Écrire `fichierType.js`, `classeur.js`, le réducteur, puis les quatre étapes et la page.** Décisions d'écran :
  - Page : un membre non administrateur est renvoyé à `/clients` (`<Navigate replace />`). Fil d'étapes en haut (« Fichier · Correspondance · Aperçu · Résultat »), lien « Retour aux clients ».
  - **Fichier** : zone de dépôt (clic ou glisser), bouton « Télécharger le fichier type », champ « Logiciel d'origine (facultatif) ». Refus par `refusFichier` avant toute lecture ; plus de `LIGNES_MAX` lignes ⇒ « Plus de 10 000 lignes : découpez le fichier. » ; aucune ligne ⇒ « Ce fichier ne contient aucune ligne de client. » Un fichier type (`estFichierType`) saute directement à l'aperçu.
  - **Correspondance** : un tableau, une ligne par colonne — en-tête, trois premières valeurs non vides, liste déroulante (champs du catalogue, puis les quatre cibles composées, puis « Ajouter aux notes », « Ignorer »). Sélecteur « Ligne d'en-tête » (les dix premières lignes) qui recalcule tout. Les erreurs de `validerCorrespondance` s'affichent au-dessus du bouton « Voir l'aperçu », fermé tant qu'il en reste ; les colonnes « à choisir » sont surlignées et comptées (« 3 colonnes à choisir ou à ignorer »), sans fermer le bouton : elles seront ignorées, et l'écran le dit.
  - **Aperçu** : compteurs de `bilan()` avec la phrase « N lignes lues = X à importer + Y doublons écartés + Z écartées » ; trois listes repliables : à importer (20 premières), doublons (la fiche existante en face : nom, n° client, ville, raison du rapprochement ; coche « Importer quand même » pour un fort, « Écarter » pour un faible), écartées (raison). Lien « Télécharger les lignes écartées ». Tant que `useExistingClientsForImport().clients` est `undefined` : listes non affichées et bouton fermé avec « Lecture de vos clients existants… » ; en erreur : « Vos clients existants n'ont pas pu être lus : l'import est fermé pour ne pas créer de doublons. » et un bouton « Réessayer ».
  - Bouton « Importer N clients » (N = `bilan().importees`), fermé à 0.
  - **Résultat** : barre « X fiches créées sur N » pendant l'envoi ; à la fin le bilan, « Voir les clients », « Télécharger les lignes écartées », et la phrase « Les adresses seront placées sur la carte dans les heures qui viennent. » Interrompu : le message d'erreur, « X fiches sont déjà créées », bouton « Reprendre ».
  - Quitter la page pendant l'envoi : `beforeunload` posé tant que `etat === 'en_cours'`.
- [ ] **Step 4: Vérifier** — `node --test scripts/import-clients/fichier-type.test.mjs`, `npm run lint`, `npx vite build` → verts ; aucun fichier créé au-dessus de 500 lignes (`wc -l`).
- [ ] **Step 5: Committer** — `feat(import clients): page d'import en quatre étapes et fichier type`.

---

### Task 9: Imports précédents, retrait, ancien numéro sur la fiche

**Files:**
- Create: `src/apps/artisan/components/clients/import/ImportsPrecedents.jsx`
- Modify: `src/apps/artisan/pages/ClientsImport.jsx` (liste sous le parcours), `src/apps/artisan/pages/ClientDetail.jsx:388` (à côté du numéro de client : « ancien n° <external_ref> » quand il existe), `src/shared/services/clients.service.js:150-156` (recherche : ajouter `external_ref.ilike.%${term}%` à la clause `.or()`, terme déjà passé par `escapePostgrestSearchTerm`)

**Interfaces:**
- Consumes : `useClientImports`, `useRemovalPreview`, `useRemoveClientImport` (Task 7) ; `ConfirmDialog` de `src/components/ui/confirm-dialog`.

- [ ] **Step 1: Écrire `ImportsPrecedents.jsx`** : une ligne par import — date (`formatDateTimeFR`), fichier, auteur, « N fiches créées », état (« En cours », « Terminé », « Retiré le … »). Bouton « Retirer cet import » sur un import non retiré → `ConfirmDialog` destructif dont le texte vient de l'aperçu : « 2 828 fiches seront retirées. 12 seront conservées : elles ont déjà un contrat, une intervention ou un e-mail envoyé. » ; aperçu inconnu ⇒ bouton de confirmation fermé. Après retrait : `toast.success('2 828 fiches retirées, 12 conservées')`. Liste vide : rien n'est affiché.
- [ ] **Step 2: Ancien numéro et recherche** : affichage sur la fiche, recherche de la liste des clients.
- [ ] **Step 3: Vérifier** — `npm run lint`, `npx vite build`, `npm run audit:dead-code` → verts.
- [ ] **Step 4: Committer** — `feat(import clients): imports précédents, retrait, ancien numéro de client`.

---

### Task 10: Mise en production et documentation

**Files:**
- Modify: `CLAUDE.md` (nouvelle section « Module Import des clients », 8 à 12 lignes : seule définition des champs, invariant du bilan, écriture par les RPC seules, vue à recréer avec `security_invoker`, retrait dérivé des clés étrangères, file de géocodage équitable ; retirer « Onboarding » ce qui est fait dans « Ouverture à une 2ᵉ entité »)

- [ ] **Step 1: Tout vérifier** — `npm run audit:quality` et `npx vite build` → verts.
- [ ] **Step 2: Appliquer les deux migrations en production** (connecteur Supabase, `apply_migration`), puis contrôler : `to_regclass('majordhome.client_imports')` non nul ; `security_invoker` des trois vues ; `has_function_privilege('anon', …)` faux sur les cinq RPC ; `node scripts/permissions-coherence.mjs --env .env.local` sans nouvel écart.
- [ ] **Step 3: Essai sans écriture en production** — bloc `DO` sous l'identité d'un org_admin de Cimaj : `start`, `batch` de 200 lignes fabriquées, mesure de la durée, puis `RAISE EXCEPTION` (tout est annulé). Attendu : sous 2 s ; sinon ajuster `TAILLE_LOT` et recommitter.
- [ ] **Step 4: Pousser** (`git pull --rebase --autostash` puis `git push`), suivre le déploiement Vercel jusqu'à « Ready ».
- [ ] **Step 5: Recette à remettre à Eric** (compte Cimaj, dans son navigateur) : télécharger le fichier type, le remplir de 5 lignes dont un doublon de SOUBIELLE Sarah et une ligne sans nom, importer, vérifier le bilan (3 créées, 1 doublon, 1 écartée), retrouver une fiche par son ancien numéro, retirer l'import, vérifier que la liste revient à 1 client. Dire ce qui n'a pas été vu à l'écran.
