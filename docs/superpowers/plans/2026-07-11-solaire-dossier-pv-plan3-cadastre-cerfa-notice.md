# Dossier PV — Cadastre + ABF + CERFA 16702 + Notice (Tranche 1 · Plans 3-4/4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boucler le réglementaire de la tranche 1 du chaînage dossier PV : capture cadastre (parcelles apicarto IGN, sélection multi-parcelles sur carte) + statut ABF (GPU), config matériel dans l'offre, validation du dossier (état civil déclarant) et génération du **CERFA 16702\*03 pré-rempli** + **notice descriptive** brandée — sans aucune resaisie (write-once).

**Architecture:** Tout est frontend (aucune migration : les blocs jsonb `cadastre/abf/material/declarant/documents` existent déjà en prod, vérifié ; aucune edge function : apicarto cadastre + GPU sont CORS-OK en direct navigateur, testé avec l'origin Vercel). Libs pures node-testables (`cadastre.js` parsing, `cerfa16702.js` field map, `dossierDocs.js` description/notice model) séparées des couches runtime (fetch réseau, pdf-lib + asset Vite, react-pdf). Le wizard capture cadastre/ABF (Step1) et matériel (Step3) dans le state → persistés à la sauvegarde dans `pv_dossiers` (patch non-null only). L'onglet Historique porte le panneau Dossier : badge statut, checklist des blocs, modale déclarant, génération → upload Storage → `documents` → RPC `advance('dossier_valide')`.

**Tech Stack:** apicarto IGN (`/api/cadastre/parcelle`, `/api/gpu/assiette-sup-s`, POST GeoJSON), react-map-gl (parcelles cliquables), pdf-lib (AcroForm fill + flatten), @react-pdf/renderer (notice), Storage `product-documents`, node --test.

**Spec source:** `docs/superpowers/specs/2026-07-06-solaire-chainage-dossier-pv-tranche1-design.md` §3 (parcours), §4 (modèle — déjà livré), §5.4 (cadastre/GPU), §6 (CERFA/notice), §8 (sécurité). Reconnaissance 2026-07-11 (workflow 5 agents) : shapes API réelles, 386 champs AcroForm énumérés, patterns PDF projet.

---

## Décisions verrouillées (conflits tranchés)

1. **CERFA 16702\*03** (version courante servie par `https://www.formulaires.service-public.gouv.fr/gf/cerfa_16702.do`), PAS \*01 : le \*03 a absorbé l'ex-13703 — il n'y a plus de case « maison individuelle ». PV **en toiture** = case `C2ZB1_existante` + description `C2ZD1_description` ; la rubrique 4.2.1 « puissance crête » (`C2ZP1_crete`) ne concerne que le PV **au sol** → on ne la remplit PAS.
2. **Asset repo** : le PDF officiel (1 544 624 octets) est commité dans `src/apps/solaire/assets/cerfa_16702-03.pdf`, importé via `?url` (fetch runtime). Pas de fetch service-public à la volée (version drift, CORS inconnu).
3. **Déclarant élargi** : le bloc `declarant` porte AUSSI nom/prénom/tél/email/adresse (pré-remplis depuis la simulation/le terrain, éditables) — une simulation n'est pas toujours rattachée à un Lead. Write-once respecté : on pré-remplit tout ce qu'on sait, on ne redemande jamais un champ déjà connu.
4. **Bordereau des pièces : rien de coché en T1.** Les pièces graphiques DP1-DP8 sont la tranche 3 ; la notice descriptive est jointe en annexe libre. Les cases légales connues via GPU sont cochées (X2H abords MH si ac1, X2C site classé si ac2, X2R SPR si ac4) ; les questions juridiques qu'on ne sait pas trancher (section 5 Oui/Non) restent vides.
5. **Surfaces** : panneaux en surimposition → aucune surface de plancher ni emprise créée. Tableau 4.4 laissé vide ; emprise 4.3 : `W3ES2_creee='0'`, `W3ES3_supprimee='0'`, existant laissé vide (inconnu).
6. **Max 3 parcelles dans le CERFA** (3 slots) : au-delà, les 3 premières sont remplies + avertissement UI (« fiche complémentaire papier requise »).
7. **Point d'entrée Dossier = Historique** (drawer par simulation). Le wizard ne connaît pas `sim.id` après save — pas de section Dossier dans Step3 en T1.
8. **Patch non-null only** : `handleSave` ne patche un bloc dossier que s'il est renseigné dans le wizard (ne clobber jamais un bloc existant au re-save d'une simulation rechargée sans ce bloc en state). `cadastre`/`abf`/`material` sont AUSSI mis dans `pv_simulations.inputs` (snapshot wizard, restauration au rechargement) — le dossier reste canonique pour les documents.
9. **ABF fail-loud** : échec API GPU → `abf: null` + badge « à vérifier manuellement » (jamais un faux « non protégé »). Résultat vide GPU = « aucune protection recensée au GPU » (formulation honnête : le GPU n'est pas exhaustif).
10. **Texte PDF WinAnsi-safe** : tout texte injecté dans l'AcroForm passe par `sanitizeWinAnsi()` (apostrophes/tirets/espaces Unicode → ASCII) — Helvetica AcroForm ne couvre pas U+2019/U+202F.

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `src/apps/solaire/lib/cadastre.js` | Parsers purs (normalizeParcelle, buildAbfSummary, makeSquareAround, toDbCadastre) + fetchers apicarto (parcelle au point, parcelles autour, ABF) | Create |
| `scripts/cadastre-lib.test.mjs` | Tests node des parsers purs | Create |
| `src/apps/solaire/lib/wizardState.js` | + clés `cadastre:null`, `abf:null`, `material:{...}` + actions SET_CADASTRE/SET_ABF/SET_MATERIAL + invalidation SET_LOCATION | Modify |
| `src/apps/solaire/components/dossier/CadastreSection.jsx` | Card Step1 : auto-lookup parcelle, carte parcelles cliquables (react-map-gl), chips sélection, badge ABF | Create |
| `src/apps/solaire/components/Step1Localisation.jsx` | Monte CadastreSection sous le bloc localisation | Modify |
| `src/apps/solaire/components/Step3Resultats.jsx` | Card « Matériel » (marque/modèle/aspect) avant les boutons | Modify |
| `src/apps/solaire/pages/Simulateur.jsx` | handleSave : inputs+patch cadastre/abf/material (non-null only) ; LOAD restaure | Modify |
| `src/apps/solaire/assets/cerfa_16702-03.pdf` | Formulaire officiel (asset binaire) | Create |
| `src/apps/solaire/lib/cerfa16702.js` | PUR : constantes champs, `buildCerfaFields()`, `toJJMMAAAA`, `splitEmail`, `sanitizeWinAnsi`, `buildCerfaDescription` | Create |
| `scripts/cerfa16702.test.mjs` | Tests node du field map | Create |
| `src/apps/solaire/lib/fillCerfa.js` | Runtime : fetch asset ?url, pdf-lib fill + flatten → Blob | Create |
| `src/apps/solaire/lib/dossierDocs.js` | PUR : `buildNoticeModel(dossier, simulation, config)` (+ description partagée avec le CERFA) | Create |
| `scripts/dossier-docs.test.mjs` | Tests node du modèle notice | Create |
| `src/apps/solaire/components/dossier/NoticePDF.jsx` | Document react-pdf brandé + `generateNoticePdfBlob` | Create |
| `src/apps/solaire/components/dossier/ValidateDossierModal.jsx` | Modale état civil déclarant (pré-remplie, pattern SaveSimulationModal) | Create |
| `src/apps/solaire/components/dossier/DossierDrawer.jsx` | Drawer par simulation : statut, checklist blocs, génération docs, liens | Create |
| `src/apps/solaire/pages/Historique.jsx` | Bouton « Dossier » + badge statut par ligne | Modify |
| `src/shared/services/pvDossier.service.js` | + `getForSimulations(orgId, simulationIds)` (IN query) | Modify |
| `src/shared/hooks/usePvDossier.js` | + `usePvDossiersBySimulations(simulationIds)` | Modify |

---

## Task 1 : lib cadastre pure + tests (TDD)

**Files:** Create `src/apps/solaire/lib/cadastre.js`, `scripts/cadastre-lib.test.mjs`

- [ ] Tests d'abord (`node --test scripts/cadastre-lib.test.mjs`, style pv-engine.test.mjs) :
  - `normalizeParcelle(feature)` → `{ idu, prefixe, section, numero, code_insee, nom_com, superficie_m2, geometry }` depuis la shape apicarto réelle (`properties: {numero:'0632', feuille, section:'BS', code_dep:'81', nom_com:'Gaillac', code_com:'099', com_abs:'000', idu:'81099000BS0632', contenance:4308, code_insee:'81099'}`) ; `prefixe` = `com_abs` (`'000'`).
  - `makeSquareAround(lon, lat, meters)` → Polygon GeoJSON 5 points fermé ; dLat = m/111320, dLon = m/(111320·cos(lat)) ; testé à ~43.9°N.
  - `buildAbfSummary(features)` → filtre `suptype ∈ {ac1,ac2,ac4}` (insensible casse), retourne `{ secteur_protege, protections:[{suptype, nom, type}], source:'gpu', checked_at }` ; `nomsuplitt` → `nom`, `typeass` → `type` ; features vides → `secteur_protege:false` ; pm1 ignoré.
  - `toDbCadastre(sel)` → `{ commune_insee, nom_com, parcelles:[{idu,prefixe,section,numero,superficie_m2}], geojson: FeatureCollection }` (shape DB documentée dans la migration).
- [ ] Implémentation + fetchers (non testés unitairement, réseau) :
  - `fetchParcelleAtPoint(lon, lat)` — POST `https://apicarto.ign.fr/api/cadastre/parcelle` body `{geom:{type:'Point',coordinates:[lon,lat]}}` ; si `features` vide → retry avec `makeSquareAround(lon,lat,15)` (point sur voirie = cas nominal).
  - `fetchParcellesAround(lon, lat, meters=45)` — même POST avec le carré (voisines cliquables).
  - `fetchAbfAtPoint(lon, lat)` — POST `https://apicarto.ign.fr/api/gpu/assiette-sup-s` body `{geom:Point}` SANS categorie, → `buildAbfSummary`. `_limit` ignoré par le module GPU : ne pas s'en servir.
  - Erreurs : throw (caller gère le fail-loud UI).
- [ ] Run tests → verts. Commit `feat(solaire): lib cadastre — parcelles apicarto + résumé ABF GPU (pur, testé)`

## Task 2 : wizard state + CadastreSection (Step1)

**Files:** Modify `wizardState.js`, `Step1Localisation.jsx` ; Create `components/dossier/CadastreSection.jsx`

- [ ] `wizardState.js` : défauts `cadastre:null, abf:null, material:{module_marque:'', module_modele:'', module_aspect:'full_black'}` ; actions `SET_CADASTRE`, `SET_ABF`, `SET_MATERIAL` ; `SET_LOCATION` purge aussi `cadastre`/`abf` (comme roofGeometry/pans). Rétrocompat draft : merge `{...initial, ...draft}` couvre les anciens drafts.
- [ ] `CadastreSection.jsx` (< 300 LOC, orchestrateur + carte inline) : à la pose de `location.lat/lon` → fetch parallèle parcelle-au-point + voisines + ABF ; auto-sélection de la parcelle contenant le point ; carte react-map-gl (style satellite, pattern RoofLocatorMap) avec Source/Layer GeoJSON : voisines en liseré slate, sélectionnées en fill jaune `#F5C542` ; clic = toggle ; chips « BS 0632 · 4 308 m² » avec retrait ; badge ABF (ambre « Secteur protégé : PDA de Gaillac » / slate « Aucune protection recensée au GPU » / warning « Vérification ABF indisponible — à contrôler manuellement » si erreur) ; > 3 parcelles → note « CERFA : 3 max, fiche complémentaire requise ». Callbacks → dispatch SET_CADASTRE/SET_ABF.
- [ ] Montage dans Step1 sous le bloc localisation existant ; `npx vite build` OK. Commit `feat(solaire): capture cadastre + ABF à la géoloc (parcelles cliquables, write-once)`

## Task 3 : matériel (Step3) + persistance dossier au save

**Files:** Modify `Step3Resultats.jsx`, `Simulateur.jsx`

- [ ] Card « Matériel proposé » dans Step3 (avant le bloc boutons) : `module_marque`, `module_modele` (TextInput), `module_aspect` (Select : `full_black` « Full black » défaut / `standard`) → `SET_MATERIAL`.
- [ ] `Simulateur.jsx handleSave` : `inputs` étendus (`material`, `cadastre`, `abf`) ; patch dossier étendu **non-null only** : `roof_geometry` (existant), `cadastre: toDbCadastre(state.cadastre)`, `abf`, `material` (si marque ou modèle non vide) ; `ensureDossier` déclenché si l'UN des blocs est présent. `LOAD` (`?sim=`) restaure `material`/`cadastre`/`abf` depuis `inputs`.
- [ ] Build OK. Commit `feat(solaire): config matériel dans l'offre + persistance cadastre/abf/material au dossier`

## Task 4 : asset CERFA + field map pur + tests (TDD)

**Files:** Create `src/apps/solaire/assets/cerfa_16702-03.pdf` (copie scratchpad, 1 544 624 octets), `lib/cerfa16702.js`, `scripts/cerfa16702.test.mjs`

- [ ] Tests : `toJJMMAAAA('1980-03-07')==='07031980'` ; `splitEmail('a@b.fr')===['a','b.fr']` ; `sanitizeWinAnsi` (U+2019→', U+202F/00A0→espace, –/—→-) ; `buildCerfaDescription({kwc, panels, marque, modele, aspect, pitchDeg, orientation})` contient kWc/nb modules/surimposition ; `buildCerfaFields(data)` → mapping complet :
  - Déclarant : `D1N_nom`, `D1P_prenom`, `D1A_naissance` (8 chars), `D1C_commune`, `D1D_dept`, `D1E_pays` ; adresse `D3N_numero/D3V_voie/D3L_localite/D3C_code`, `D3T_telephone` (10 digits nettoyés), `D5GE1_email`+`D5GE2_email` ; checkbox `D5A_acceptation` si opt-in.
  - Terrain : `T2Q_numero/T2V_voie/T2L_localite/T2C_code` ; parcelles 1-3 : `T2F_prefixe/T2S_section/T2N_numero/T2T_superficie` puis suffixes `P2`/`P3` ; `D5T_total` = somme superficies (max 3 remplies, flag `overflow` si plus).
  - Nature : checkbox `C2ZB1_existante` + `C2ZD1_description` ; emprise `W3ES2_creee='0'`, `W3ES3_supprimee='0'`.
  - Législation : `X2H_historique` si ac1, `X2C_classe` si ac2, `X2R_remarquable` si ac4.
  - Engagement : `E1L_lieu`, `E1D_date` (aujourd'hui passé en paramètre — pas de Date() dans la lib pure).
  - Retour `{ text: {name:value}, checks: [names], overflowParcelles }`.
- [ ] Implémentation pure (AUCUN import d'asset ni de pdf-lib — node-testable). Run tests verts. Commit `feat(solaire): field map CERFA 16702*03 (pur, testé) + asset officiel`

## Task 5 : fillCerfa runtime + notice (modèle pur + Document react-pdf)

**Files:** Create `lib/fillCerfa.js`, `lib/dossierDocs.js`, `scripts/dossier-docs.test.mjs`, `components/dossier/NoticePDF.jsx`

- [ ] `fillCerfa.js` : `import cerfaUrl from '../assets/cerfa_16702-03.pdf?url'` ; `fillCerfa16702(fields)` → fetch(cerfaUrl) → `PDFDocument.load` → `form.getTextField(name).setText(sanitizeWinAnsi(v))` / `form.getCheckBox(name).check()` (try/catch par champ + `logger.warn` champ par champ — un nom raté ne bloque pas le reste, mais compteur d'échecs retourné) → `form.flatten()` → Blob. Retourne `{ blob, missedFields }`.
- [ ] `dossierDocs.js` (pur, testé) : `buildNoticeModel({ dossier, simulation, company })` → sections { terrain (adresse, parcelles, superficie), projet (kWc actif, nb modules, marque/modèle, aspect, surimposition, pans pente/orientation), insertion (texte standard + paragraphe renforcé si `abf.secteur_protege` avec le nom de la protection), abf } ; réutilise `buildCerfaDescription`. Tests : modèle complet avec/sans ABF, sans matériel (fallback « modules photovoltaïques »).
- [ ] `NoticePDF.jsx` : Document react-pdf pattern EtudePDF (CompanyHeader + footer legal fixed, palette deutan, formatters PDF-safe copiés — `fmtInt/numStr`) ; `generateNoticePdfBlob({ model, company })`. 1-2 pages A4.
- [ ] Tests verts + build OK. Commit `feat(solaire): génération CERFA 16702 pré-rempli (pdf-lib) + notice descriptive brandée`

## Task 6 : validation dossier (drawer Historique + modale déclarant)

**Files:** Create `components/dossier/DossierDrawer.jsx`, `components/dossier/ValidateDossierModal.jsx` ; Modify `Historique.jsx`, `pvDossier.service.js`, `usePvDossier.js`

- [ ] Service : `getForSimulations(orgId, simulationIds)` → `.in('pv_simulation_id', ids).eq('org_id', orgId)` ; hook `usePvDossiersBySimulations(ids)` (key `pvDossierKeys.all(orgId) + ['bySimulations', ids]`, enabled ids.length>0) → map simId→dossier pour les badges.
- [ ] `Historique.jsx` : badge statut (label `pvDossierStatus.js`) + bouton « Dossier » par ligne → ouvre `DossierDrawer` (simulation row complète en prop).
- [ ] `ValidateDossierModal.jsx` (pattern SaveSimulationModal) : civilité (M./Mme), nom, prénom (pré-remplis en scindant `client_name` de la simulation), date de naissance (input date), commune + département + pays de naissance (pays défaut « France »), téléphone, email, adresse déclarant (numero/voie/code_postal/localite — pré-remplie par parsing best-effort de l'adresse terrain, éditable), toggle « accepte les notifications électroniques » (défaut décoché). Submit → objet `declarant` complet.
- [ ] `DossierDrawer.jsx` : `usePvDossier(sim.id)` ; checklist blocs (toiture ✓ n pans, cadastre ✓ n parcelles + commune, ABF badge 3 états, matériel, déclarant) ; état vide (dossier null) → explication « sauvegardez la simulation avec cadastre/toiture pour créer le dossier » ; CTA « Valider le dossier » (requiert cadastre + déclarant ; matériel manquant = warning non bloquant) → modale → orchestration :
  1. `patchBlock({ declarant })`
  2. `buildCerfaFields` (données dossier+simulation+aujourd'hui) → `fillCerfa16702` → blob
  3. `buildNoticeModel` → `generateNoticePdfBlob` → blob
  4. upload ×2 `storageService.uploadFile('product-documents', `${orgId}/solaire/dossiers/${dossierId}/cerfa-dp.pdf|notice-descriptive.pdf`, blob, { upsert:true, contentType:'application/pdf' })`
  5. `patchBlock({ documents: { cerfa_pdf_path, notice_pdf_path, generated_at } })`
  6. `advance({ targetStatus:'dossier_valide' })` (idempotent)
  - Toasts par étape ratée (échec upload → stop avant advance, fail loud) ; documents existants → boutons télécharger (signed URL 1 h) + « Régénérer ».
- [ ] Build OK. Commit `feat(solaire): validation dossier PV — déclarant, CERFA + notice générés, statut dossier_valide`

## Task 7 : preuves + revue + docs

- [ ] `node --test scripts/cadastre-lib.test.mjs scripts/cerfa16702.test.mjs scripts/dossier-docs.test.mjs` verts ; `npx vite build` OK ; `npm run lint:errors` sans nouvelle erreur.
- [ ] Revue multi-agents (workflow adversarial : sécurité multi-tenant org_id/RLS, write-once, gotchas CLAUDE.md, régressions wizard) ; fixes.
- [ ] MàJ spec (statut), mémoire `project_chainage_dossier_pv.md`, entrée proposed-updates si gotchas durables. Commit final.

## Hors périmètre (rappel)
Tranches 2-4 (Consuel, DP1/DP2/DP5 graphiques, pack Enedis + mandat) ; plan de masse coté ; case bordereau auto ; edge functions ; permission dédiée `pv_dossier.manage` (on reste sur `pv_calculator.view`).
