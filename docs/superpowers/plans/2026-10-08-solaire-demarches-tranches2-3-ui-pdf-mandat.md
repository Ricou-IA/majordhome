# Démarches administratives PV — tranches 2 et 3 : section Résultats, persistance, pages PDF, mandat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le moteur Démarches visible et utile : une section « Démarches administratives » à l'étape Résultats (entrées projet, synoptique, planning, checklist, frais, alertes) persistée dans `pv_dossiers.demarches`, deux pages dans l'étude PDF, et le mandat de représentation généré avec le dossier.

**Architecture:** Un helper pur assemble les entrées du moteur depuis l'état du wizard et le dossier (`demarchesInputs.js`). La section Résultats est un orchestrateur fin (`DemarchesSection`) + sous-composants de rendu ; elle calcule via `calculerDemarches` et fige le résultat dans `pv_dossiers.demarches` par `patchBlock`. Le PDF et le mandat ne calculent rien : `DemarchesPage`/`DemarchesVigilancePage` lisent `resultat`, `MandatPDF` lit `buildMandatModel(...)` (pur) alimenté par les blocs du dossier et `settings`. Le signataire de l'org vient de trois clés plates de `settings` éditées dans Organisation → Identité.

**Tech Stack:** React 18 + Tailwind, TanStack Query (`usePvDossier`, `patchBlock`), react-pdf (`pdfShared`), Supabase Storage (`product-documents`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-08-solaire-demarches-administratives-design.md` (§5.4, §5.5, §7, §8, §9, §10 critères 10-11). Tranche 1 livrée : `docs/superpowers/plans/2026-10-08-solaire-demarches-tranche1-moteur-parametres.md`.

## Global Constraints

- Modules purs sans import React/Supabase/alias : `src/apps/solaire/lib/demarchesInputs.js`, `src/apps/solaire/lib/demarches/mandatModel.js`. Tests `node --test` dans `audit:quality`.
- Le PDF (étude et mandat) **ne calcule rien** ; formatters PDF-safe de `pdfShared` ; aucun glyphe hors Helvetica (pas de ≤ ≥ → ; écrire « inférieure ou égale à »).
- Toute écriture du dossier passe par `patchBlock` (jamais `status`). `pv_dossiers.demarches = { inputs, resultat, pieces_statut, mis_a_jour_le }`.
- Migration versionnée `supabase/migrations/20261008_1_pv_dossiers_demarches.sql` : `ADD COLUMN` + `CREATE OR REPLACE VIEW … SELECT *` + `NOTIFY pgrst`. Le harnais `migration-rehearsal` ne photographie pas `pv_dossiers` : l'écart est signalé dans le rapport final, la migration est appliquée en prod par Eric.
- Alertes et colonnes du synoptique : couleur + icône + libellé, jamais la couleur seule. Palette deutan (`#F5C542`, `#2196F3`, `#1565C0`, `#0D47A1`, ambre `#B45309` pour les avertissements).
- Composants < 500 LOC, pas de logique métier dans le JSX. Nouveau fichier partagé = consommé dans le même commit.
- Commits en français avec `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Vérification : `npx vite build`, `npm run lint`, `npm run audit:quality`.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `src/apps/solaire/lib/demarchesInputs.js` (créer) | `assemblerInputsDemarches({ state, dossier, activeKwc, company, aujourdhui })`, `dateDepartParDefaut(dossier, aujourdhui)` |
| `src/apps/solaire/lib/demarches/mandatModel.js` (créer) | `buildMandatModel(...)` → blocs du mandat + alertes |
| `src/apps/solaire/lib/consentItems.js` (modifier) | phrase renvoyant au mandat complet |
| `src/apps/solaire/lib/dossierDocuments.js` (modifier) | pièce `mandat` |
| `src/lib/orgBranding.js` (modifier) | `signatoryName`, `signatoryRole`, `signatorySignaturePath` |
| `supabase/migrations/20261008_1_pv_dossiers_demarches.sql` (créer) | colonne + vue |
| `src/apps/solaire/components/demarches/*.jsx` (créer) | `DemarchesSection`, `DemarchesInputs`, `ParcoursSynoptique`, `PlanningPrevisionnel`, `ChecklistPieces`, `TableauFrais`, `AlertesDemarches` |
| `src/apps/solaire/components/Step3Resultats.jsx`, `pages/Simulateur.jsx` (modifier) | branchement section + `dossier` + PDF |
| `src/apps/solaire/components/etude/DemarchesPage.jsx`, `DemarchesVigilancePage.jsx` (créer), `EtudePDF.jsx` (modifier) | pages PDF |
| `src/apps/solaire/components/dossier/MandatPDF.jsx` (créer), `DossierDrawer.jsx` (modifier) | mandat généré et assemblé |
| `src/apps/artisan/pages/settings/organization/IdentityTab.jsx` (modifier) | signataire des mandats |
| `scripts/solaire/demarches-inputs.test.mjs`, `scripts/solaire/mandat-model.test.mjs` (créer), `package.json` | tests |

---

### Task 1 : Assemblage des entrées depuis le wizard et le dossier (`demarchesInputs.js`)

**Interfaces produites :**
```js
assemblerInputsDemarches({ state, dossier, activeKwc, company, aujourdhui }) → {
  commune_insee, commune_nom, puissance_kwc, batterie, abf, installateur_rge,
  mode_valorisation, copropriete_ou_lotissement, compteur_linky, date_depart, prise_en_charge, devis
}
dateDepartParDefaut(dossier, aujourdhui) → ISO   // docsGeneratedAt(documents) tronqué, sinon aujourdhui
```
Les champs saisis (mode, copropriété, Linky, date, prise en charge, devis) viennent de `dossier.demarches.inputs` s'ils existent, sinon des défauts ; les dérivés viennent toujours du wizard/dossier (jamais figés : un changement de scénario change la puissance).

- [ ] Test `scripts/solaire/demarches-inputs.test.mjs` : dérivation INSEE/commune depuis `dossier.cadastre` (fallback `state.cadastre[0]`), puissance = `activeKwc`, batterie = `state.optim.batteryOn`, `abf` = `dossier.abf ?? state.abf`, RGE = `company.rgeCertifications.length > 0`, saisies reprises de `dossier.demarches.inputs`, `date_depart` = date des documents si générés sinon aujourd'hui.
- [ ] Implémenter, lancer, commit `feat(solaire): assemblage des entrées Démarches depuis le wizard et le dossier`.

### Task 2 : Migration `pv_dossiers.demarches`

- [ ] Écrire `supabase/migrations/20261008_1_pv_dossiers_demarches.sql` (même pattern que `sql/migration_pv_dossiers_consent.sql`, commentaire sur le `SELECT *` figé, requête de vérification en commentaire).
- [ ] Mettre à jour le commentaire d'en-tête de `pvDossier.service.js` (`patchBlock` : blocs autorisés + `demarches`).
- [ ] Commit `feat(db): colonne pv_dossiers.demarches + vue publique recréée`.

### Task 3 : Section « Démarches administratives » (étape Résultats)

**Interfaces :**
- `Simulateur.jsx` : `const { data: dossier } = usePvDossier(savedDossierSim?.id)` ; passe `dossier` à `Step3Resultats` ; `handleGeneratePdf` passe `demarches: dossier?.demarches?.resultat ?? null` à `generateEtudePdfBlob`.
- `Step3Resultats.jsx` : nouvelle prop `dossier` ; rend `<DemarchesSection state={state} dossier={dossier} dossierSim={dossierSim} activeKwc={model.activeKwc} />` en chapitre pleine largeur après le tableau annuel (la section a besoin de la largeur : synoptique 3 colonnes).
- `DemarchesSection` : lit `settings` (`useOrgSettings`), `company = buildCompanyInfo(settings)`, `params = buildDemarchesParams(settings)` ; état local = saisies du formulaire initialisées depuis `assemblerInputsDemarches` ; bouton « Calculer et enregistrer » → `calculerDemarches(inputs, params, { aujourdhui, societe: company.name })` → `patchBlock({ id: dossier.id, patch: { demarches: { inputs, resultat, pieces_statut: existant, mis_a_jour_le } } })`. Bandeau « à recalculer » si `resultat.engine_version !== ENGINE_VERSION` ou si les entrées dérivées diffèrent (`puissance_kwc`, `batterie`, `perimetre_abf`). Sans `dossierSim` : message « Enregistrez d'abord la simulation ». Sans `dossier.demarches` : formulaire + bouton seulement.
- `ChecklistPieces` : clic sur une pièce → cycle `a_demander → recue → a_demander` ; `non_applicable` quand `applicable === false` (non cliquable) ; `patchBlock` avec `pieces_statut` mis à jour (demarches complet re-posé).
- Sous-composants purs de rendu : `ParcoursSynoptique({ etapes })`, `PlanningPrevisionnel({ planning })`, `TableauFrais({ frais })`, `AlertesDemarches({ alertes })`, `DemarchesInputs({ value, onChange, prisesEnChargeDefaut })`.

- [ ] Créer les 7 composants ; brancher dans Step3 et Simulateur.
- [ ] `npx vite build` + `npm run lint` verts ; vérification manuelle par Eric (serveur de dev) : enregistrer une simu, remplir mode/copro/Linky, calculer, recharger la simu depuis l'historique : le résultat figé réapparaît ; cocher une pièce persiste.
- [ ] Commit `feat(solaire): section Démarches administratives à l'étape Résultats (calcul figé dans pv_dossiers.demarches)`.

### Task 4 : Pages PDF « Démarches »

- [ ] `etude/DemarchesPage.jsx` : titre, phrase d'intro, tableau 3 colonnes (Étape | Ce que vous faites | Ce que nous faisons) sur les étapes `applicable`, délai en petit sous le libellé, colonnes fond `#FFF6D6`/bord `#F5C542` et `#E3F0FD`/bord `#2196F3` avec un pictogramme texte « Vous » / « Nous » dans l'en-tête ; mention « délais indicatifs ».
- [ ] `etude/DemarchesVigilancePage.jsx` : bloc « Points de vigilance » (alertes avec libellé de niveau), « Calendrier prévisionnel » (dates clés + durée totale + hypothèses), « Pièces à nous transmettre » (pièces applicables), « Frais administratifs » (lignes + prise en charge + total si connu), « Bon à savoir » (affichage de l'accord, DAACT, contrat de rachat si surplus, Consuel bleu/violet).
- [ ] `EtudePDF.jsx` : prop `demarches` ; pages rendues après `CoutsPage` si `demarches` non nul ; commentaire d'en-tête mis à jour (7-8 pages).
- [ ] Build + lint ; commit `feat(solaire): pages Démarches dans l'étude PDF (synoptique + vigilance)`.

### Task 5 : Modèle du mandat (`mandatModel.js`)

**Interface :**
```js
buildMandatModel({ declarant, adresseDeclarant, site: { adresse, code_postal, commune }, cadastre, projet: { puissance_kwc, mode_valorisation }, company, consent, devis, dateLabel })
→ { titre, sousTitre, mandant: { nom, naissance, domicile }, mandataire: { denomination, siege, rcs, siret, signataire }, site: { adresse, parcelles, nature, devis }, articles: [{ numero, titre, paragraphes: string[], cases?: [{ cochee, texte }] }], signatures: { mandant: { nom, lieu, date }, mandataire: { nom, lieu, date } }, alertes: [{ code, niveau, message }] }
```
Texte = brouillon `docs/solaire/2026-10-08-mandat-representation-pv-brouillon.md`. Alertes : `signataire_manquant` (pas de `company.signatoryName`), `devis_manquant` (pas de numéro), `consentement_manquant` (pas de `consent.signed_at`). Mode totale : CACSI cité dans l'article 1, pas de phrase « contrat de rachat » dans l'article 3.

- [ ] Test `scripts/solaire/mandat-model.test.mjs` (critère 10 de la spec) ; implémenter ; `package.json` `audit:quality` ; commit `feat(solaire): modèle pur du mandat de représentation`.

### Task 6 : Signataire de l'org (Identité) + branding

- [ ] `orgBranding.js` : `signatoryName: s.signatory_name`, `signatoryRole: s.signatory_role`, `signatorySignaturePath: s.signatory_signature_path` (défauts `''`).
- [ ] `IdentityTab.jsx` : `FIELDS` + `signatory_name`, `signatory_role`, `signatory_signature_path` ; section « Signataire des mandats » : deux champs texte + upload PNG (bucket `product-documents`, path `${orgId}/branding/signature-mandat.png`, `upsert: true`, aperçu via URL signée, bouton Supprimer qui vide le champ). Validation : nom ≤ 80, fonction ≤ 60.
- [ ] Build + lint ; commit `feat(settings): signataire des mandats (nom, fonction, signature) dans Organisation → Identité`.

### Task 7 : `MandatPDF` + génération dans le dossier

- [ ] `dossier/MandatPDF.jsx` : `generateMandatPdfBlob({ model, company, signatureMandantPng, signatureMandatairePng })` — 2 pages A4, en-tête `CompanyHeader`-like (logo autorisé par Enedis), articles, cases cochées rendues « [x] » / « [ ] », cadre signatures avec images si fournies.
- [ ] `consentItems.js` : ajouter `note: 'Le mandat complet (mairie et Enedis) vous est remis avec le dossier.'` consommée par `ConsentSignatureModal` (une ligne sous la liste).
- [ ] `dossierDocuments.js` : `{ key: 'mandat', label: 'Mandat de représentation' }` en 2ᵉ position.
- [ ] `DossierDrawer.generate()` : après le CERFA, `tryPiece('mandat', …)` : modèle depuis `fresh` (declarant, adresse cicatrisée, cadastre, `fresh.demarches?.inputs` pour puissance/mode/devis avec repli `sim.results?.selectedKwc`), signature client = octets déjà chargés, signature org = `settings.signatory_signature_path` via URL signée (absente → toast warning, PDF sans signature org), upload `mandat.pdf`, assemblage `CERFA → mandat → notice → DPC1 → DPC2`.
- [ ] Build + lint ; commit `feat(solaire): mandat de représentation généré et assemblé avec le dossier PV`.

### Task 8 : Clôture

- [ ] Spec : §5.4 (clés plates `signatory_*`), §8.1 (chapitre pleine largeur), §7 (assemblage après le CERFA, repli puissance).
- [ ] `npm run audit:quality` vert ; rapport final (fait / reste / à appliquer en prod / à renseigner).
