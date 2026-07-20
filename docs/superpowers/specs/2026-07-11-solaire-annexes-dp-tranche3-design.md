# SPEC — Annexes graphiques DP + dossier orienté-documents (Tranche 3)

> **Date** : 2026-07-11 · **Statut** : validé avec Eric (brainstorming) — à relire avant plan d'implémentation
> **Prérequis** : tranche 1 (CERFA 16702 + notice) + module consentement & signature livrés. Prolonge le chaînage dossier PV.
> **Steer Eric** : « on crée les **modules techniques** maintenant, l'ordonnancement UI/UX ensuite ». → cette spec couvre les **générateurs + le modèle de données orienté-documents + l'assemblage**. La couche UI riche (1 carte éditable par pièce) est **cadrée mais différée** ; le modèle la rend possible sans refonte.

---

## 1. Objectif

Générer les **pièces graphiques** de la déclaration préalable qui sont auto-productibles depuis les données déjà capturées (parcelle cadastrale, coordonnées, pans de toiture, nb de modules), et passer le dossier d'un couple figé (CERFA+notice) à un **ensemble de documents indépendants**, chacun régénérable/remplaçable séparément, assemblés en fin de parcours.

**Périmètre technique de CETTE tranche** :
- **DPC1 — Plan de situation** (auto) : localise le terrain dans la commune.
- **DPC2 — Plan de masse** « niveau offre » (auto) : parcelle(s) + emprise toiture + zone PV, à l'échelle. *(La cotation orthogonale réglementaire reste hors périmètre.)*
- **Bordereau** du CERFA coché pour les pièces présentes.
- **Assemblage** final (PDF fusionné) de toutes les pièces du dossier.
- **Modèle `documents` orienté-pièces** (permet « 1 UI par doc »).

**Hors périmètre (phase UI/UX + tranches ultérieures)** :
- L'UI riche (cartes éditables par pièce, réordonnancement, aperçu inline) — différée par Eric.
- Photos terrain DPC7/DPC8 (upload), photomontage DPC5, coupe DPC3, façades DPC4 — nécessitent input terrain / profil bâtiment, non auto-générables.

---

## 2. Principe directeur — dossier orienté-documents

Aujourd'hui `pv_dossiers.documents = { cerfa_pdf_path, notice_pdf_path, generated_at }` (couple figé, un seul bouton « générer »). **Nouveau modèle** : chaque pièce est un **document indépendant** tracé par sa clé, avec son chemin Storage et son horodatage. Objectif : régénérer/remplacer une pièce sans refaire les autres (contrôle fin, steer Eric).

```jsonc
documents: {
  cerfa:          { path, generated_at, kind: 'generated' },
  notice:         { path, generated_at, kind: 'generated' },
  plan_situation: { path, generated_at, kind: 'generated' },
  plan_masse:     { path, generated_at, kind: 'generated' },
  assembled:      { path, generated_at, kind: 'assembled' }   // PDF fusionné final
}
```
- `kind` : `'generated'` (auto) / `'uploaded'` (futur : photos) / `'assembled'` (fusion).
- **Rétro-compat** : lecture tolérante — un helper `docPath(documents, key)` lit `documents[key]?.path` ET l'ancien `documents.${key}_pdf_path` (les dossiers de test existants ne cassent pas ; ils se re-normalisent à la prochaine génération).
- Écriture toujours via `patchBlock({ documents })` (bloc entier remplacé — donc on merge côté client avant patch : `{ ...documents, [key]: {...} }`).

---

## 3. Cœur technique — projection géo (lib pure testable)

`src/apps/solaire/lib/geoProject.js` — aucune dépendance runtime, node-testable. C'est la brique partagée par les deux générateurs.

- `computeBbox(features, marginRatio=0.1)` → `{ minLon, minLat, maxLon, maxLat }` englobant + marge.
- `mapboxStaticBbox(lon, lat, zoom, wPx, hPx)` → bbox géographique exacte couverte par une image Mapbox Static de taille `wPx×hPx` centrée `(lon,lat)` au `zoom` donné (math slippy-map Web Mercator standard). Permet de **superposer nos vecteurs parfaitement alignés** sur l'image de fond.
- `makeProjector(bbox, wPt, hPt)` → `(lon,lat) → {x,y}` en points PDF, **ratio préservé** (Web Mercator local ; à l'échelle parcelle/quartier l'écart au vrai Lambert-93 est négligeable pour un plan d'offre).
- `metricScale(bbox, wPt)` → `{ lengthPt, label }` d'une barre d'échelle « ronde » (1/2/5 × 10ⁿ m).
- `polygonToPath(geometry, projector)` → chaîne de points `{x,y}[]` (anneaux) pour tracer en SVG react-pdf.

**Tests** (`scripts/geo-project.test.mjs`) : bbox d'un jeu de features, projection des 4 coins d'un carré → rectangle proportionné, barre d'échelle « ronde », mapboxStaticBbox cohérente (largeur en m ≈ résolution zoom × wPx).

---

## 4. Générateur DPC1 — Plan de situation

`src/apps/solaire/components/dossier/PlanSituationPDF.jsx` → `generatePlanSituationBlob({ location, cadastre, company })`.

- **Fond** : Mapbox **Static Images API** (`api.mapbox.com/styles/v1/mapbox/streets-v12/static/{lon},{lat},{zoom}/{w}x{h}@2x?access_token=`), zoom ~15 (échelle quartier/commune), token `MAPBOX_CONFIG.accessToken`. Fetch → dataURL (react-pdf `<Image src=dataURL>`).
- **Superposition** : contour de la/les parcelle(s) (via `mapboxStaticBbox` + `makeProjector` sur la taille image) tracé en `<Svg>` react-pdf par-dessus l'`<Image>` + **repère Nord** + **cartouche société** (`buildCompanyInfo`) + titre « Plan de situation (DPC1) ».
- A4 paysage, 1 page. → blob.
- Échec Mapbox (réseau) : fail-loud (throw, surfacé par le caller — pas de pièce muette).

---

## 5. Générateur DPC2 — Plan de masse (niveau offre)

`src/apps/solaire/components/dossier/PlanMassePDF.jsx` → `generatePlanMasseBlob({ location, cadastre, roofGeometry, panelsCount, company })`.

- **Fond** : Mapbox Static **satellite** (`mapbox/satellite-v9`) zoom ~19 (échelle bâti), même technique d'alignement.
- **Superposition vecteurs** (échelle réelle, `makeProjector` sur la bbox parcelle) : contour parcelle(s) (trait plein), **emprise des pans de toiture** (`roof_geometry.pans[].polygon`) hachurée = zone PV, annotation « N modules PV », **barre d'échelle métrique** + **Nord**.
- Cartouche société + titre « Plan de masse (DPC2) ». A4 paysage. → blob.
- **Limite documentée** : plan « propre » d'implantation, **sans cotation orthogonale réglementaire** (distances aux limites séparatives) — cotation = tranche ultérieure, même géométrie cadastre en dessous, aucune resaisie quand on l'ajoutera.
- Si `roof_geometry` absent (dossier sans pans) : plan de masse avec la seule parcelle + note « emprise toiture à préciser » (non bloquant).

---

## 6. Bordereau CERFA

Extension de `buildCerfaFields` (pur, testé) : nouveau paramètre `piecesPresentes: string[]` (clés `'dpc1'`, `'dpc2'`, …). Coche les cases du bordereau correspondantes :
- `dpc1` → `P5PA2` (plan de situation), `dpc2` → `P5PB1` (plan de masse).
- (Noms de champs déjà cartographiés dans la reconnaissance AcroForm.)
Test : `piecesPresentes: ['dpc1','dpc2']` → `checks` contient `P5PA2` + `P5PB1`.

---

## 7. Assemblage final

`src/apps/solaire/lib/assembleDossier.js` → `assembleDossierBlob(orderedBlobsOrPaths)` : fusionne plusieurs PDF en un seul via **pdf-lib** (`copyPages`, pattern `attachAnnexes` d'`etudeExport.js`). Ordre réglementaire : CERFA → notice → DPC1 → DPC2. Une pièce illisible = warn + ignorée (jamais bloquant), mais **surfacée** (compteur). → blob « dossier complet », uploadé en `documents.assembled`.

---

## 8. Orchestration (technique, UI minimale)

Côté `DossierDrawer.generate()` (rebranché) : produit chaque pièce, l'upload sous `${orgId}/solaire/dossiers/${id}/<clé>.pdf`, met à jour `documents[clé]`, coche le bordereau CERFA pour les pièces générées, puis produit l'assemblé. Chaque pièce est **indépendante** (échec de l'une ⇒ les autres se génèrent quand même, la manquante est signalée).

> **UI par document (différée, cadrée)** : la phase UI/UX transformera la checklist en **cartes par pièce** (aperçu / régénérer / remplacer), avec un bouton **« Assembler le dossier »** final. Le modèle §2 (documents orienté-pièces) est conçu pour ça — aucune refonte data ne sera nécessaire. Pour CETTE tranche, on se contente de brancher la génération dans le flux existant.

---

## 9. Architecture & fichiers

```
src/apps/solaire/lib/geoProject.js                     # NEW pur (projection, bbox, échelle)
scripts/geo-project.test.mjs                           # NEW tests
src/apps/solaire/lib/mapboxStatic.js                   # NEW : URL + fetch → dataURL (I/O)
src/apps/solaire/components/dossier/PlanSituationPDF.jsx # NEW générateur DPC1
src/apps/solaire/components/dossier/PlanMassePDF.jsx     # NEW générateur DPC2
src/apps/solaire/lib/assembleDossier.js                # NEW fusion pdf-lib
src/apps/solaire/lib/cerfa16702.js                     # + param piecesPresentes (bordereau)
scripts/cerfa16702.test.mjs                            # + test bordereau
src/apps/solaire/lib/dossierDocuments.js               # NEW helper docPath() rétro-compat
src/apps/solaire/components/dossier/DossierDrawer.jsx  # rebranche generate() multi-pièces + assemblage
```

- Réutilise : `MAPBOX_CONFIG`, `@react-pdf/renderer` (`<Image>`, `<Svg>`/`<Path>`), `pdf-lib`, `@turf/turf` (bbox/centroïde), `storageService`, `buildCompanyInfo`.
- Conventions : libs pures sans alias Vite (`geoProject`), composants < 500 LOC, logger, Tailwind, palette deutan (le fond Mapbox est une image, hors palette). Fail-loud sur les fetch Mapbox.

---

## 10. Sécurité multi-tenant

- PDF pièces + assemblé sous préfixe `${orgId}/solaire/dossiers/${id}/…` (bucket `product-documents`).
- Écriture `documents` via `patchBlock` existant (org_id scopé, status jamais touché). Aucune nouvelle table/RPC/edge/migration.
- Token Mapbox = déjà exposé côté client (statique, restreint) — inchangé.

---

## 11. Risques & points ouverts

1. **Alignement vecteurs / image Mapbox static** : la bbox exacte d'une image static à `(center, zoom, size)` doit être calculée précisément (Web Mercator). *Sonde de calage au démarrage : générer un plan de masse et vérifier visuellement que le contour parcelle colle à l'ortho.*
2. **URL length / rate Mapbox static** : on n'envoie PAS la géométrie dans l'URL (on superpose nos vecteurs) → pas de limite d'URL. Rate limit Mapbox static généreux ; 2 images/génération.
3. **Précision Web Mercator vs Lambert-93** : négligeable à l'échelle parcelle pour un plan d'offre (non réglementaire coté).
4. **Acceptation mairie** : un fond Mapbox clair + parcelle marquée localise le terrain ; si une mairie exige un fond IGN/cadastre officiel, la source de fond est un point d'extension isolé (`mapboxStatic.js`).

---

## 12. Critères de succès (vérifiables)

- `geoProject` : tests verts (bbox, projection carré→rectangle proportionné, échelle ronde, mapboxStaticBbox).
- Génération d'un dossier : produit CERFA + notice + **plan de situation** + **plan de masse** + **assemblé**, tous uploadés et tracés dans `documents` (modèle orienté-pièces).
- Le CERFA généré a `P5PA2` + `P5PB1` cochés (bordereau).
- Le plan de masse montre la parcelle + zone PV à l'échelle (contour aligné sur l'ortho), avec barre d'échelle + Nord.
- `npx vite build` OK ; `npm run lint:errors` clean ; pas de fuite cross-org (préfixe Storage).

## Hors périmètre (rappel)
UI riche par document (phase UI/UX) ; photos terrain / photomontage / coupe / façades ; cotation réglementaire DP2 ; source de fond IGN.
