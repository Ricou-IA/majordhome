# Métré de fumisterie, suite — plan d'implémentation

> **Pour l'exécutant :** sous-skill requis : superpowers:executing-plans (exécution par Claude dans la session, tâche par tâche). Les étapes utilisent la syntaxe `- [ ]`.

**Objectif :** annexer un plan du conduit au PDF du devis, transformer les règles du NF DTU 24.1 / Cahier CSTB 3708 en alertes non bloquantes, rendre le moteur indépendant du fabricant (DINAK + comparaison), enregistrer la justification du dimensionnement et le bilan du conduit existant.

**Architecture :** tout calcul vit dans des modules PURS de `src/lib/fumisterie/` (testés `node --test`) ; les écrans et le PDF ne font que dessiner. La coupe devient une **scène de primitives** (une seule géométrie de dessin) rendue deux fois : en SVG à l'écran, en `Svg` react-pdf dans le plan annexé. Le plan lit le métré **enregistré** (`fum_metres.resultat`), jamais un recalcul.

**Stack :** React 18, `@react-pdf/renderer`, `pdf-lib` (fusion), Supabase (vues `majordhome_fum_*`), `node:test`.

**Spec :** `docs/superpowers/specs/2026-11-28-fumisterie-plan-dtu-dinak-design.md` (+ synthèses `docs/devis-fumisterie/regles/dtu-24-1-p1-1-1.md`, `docs/devis-fumisterie/regles/cstb-granules-ventouse-abaques.md`).

## Contraintes globales

- Aucune alerte ne bloque l'injection ; aucun nouveau champ obligatoire. `validerReleve` ne connaît que les paramètres du gabarit en base : les compléments facultatifs n'y entrent pas.
- Donnée absente ⇒ règle « non vérifiée » (niveau `verifier` ou silence), jamais `ok`.
- Une comparaison entre produits non équivalents n'est jamais présentée comme un écart de prix ; « moins cher » jamais désigné si un fabricant a des lignes à chiffrer ou ambiguës.
- Le plan annexé lit `fum_metres.resultat` ; aucune valeur Mayer en dur (cartouche = `buildCompanyInfo(settings)` + `logo_url` chargé par `fetchAsDataUrl`).
- Texte PDF : Helvetica / cp1252 — pas de grecs, flèches, `≤ ≥ −`, ni `✓ ⚠` ; passer par `texteSurPdf` (Tâche A2).
- Multi-tenant : RLS + `org_id` explicite, vue `security_invoker`, `REVOKE ALL … FROM PUBLIC, anon`, `GRANT SELECT … TO service_role`. Migration répétée sur `scripts/migration-rehearsal/`, **jamais appliquée en prod sans le oui d'Eric**. Aucune écriture de données en prod (attributs DINAK, mapping) sans son oui.
- Pennylane : aucun devis brouillon créé dans le Pennylane réel. Le plan n'accompagne que le PDF Majord'home et l'écran le dit.
- `ENGINE_VERSION` incrémentée à toute règle changée (B, C). Une valeur figée d'un test qui change l'est dans le même commit, avec sa raison.
- Après chaque livraison : `npm run build`, `npm run lint:errors`, `node --test scripts/fumisterie/*.test.mjs`, `npm run audit:quality` verts, puis commit sur `main` (pas de push).

## Décisions prises en écrivant ce plan (à relire par Eric)

1. **Une scène, deux rendus** (au lieu d'un composant PDF par gabarit, spec § A) : `scene.js` produit des primitives en pixels ; `CoupeCotee.jsx` (écran, unique pour tous les gabarits) et `CoupePdf.jsx` (PDF) les dessinent. Les quatre `CoupeCotee*.jsx` actuels disparaissent. Preuve : le SVG d'écran rendu avant / après la refonte est **identique au caractère près** sur 9 relevés types.
2. **Pas de colonnes `alertes_acceptees` ni `justification`** sur `fum_metres` (spec § 6) : `resultat` est figé à l'injection, ses `warn` SONT les alertes acceptées ; justification et bilan sont des champs facultatifs du relevé (`releve` jsonb). Seule colonne ajoutée : `supplier_id` (bloc C). Moins de migration, aucune copie qui diverge.
3. **Hauteur de sortie** : la distance au faîtage est déjà relevée (`dFaitage`, horizontale). Le point de référence devient le point le plus haut du toit **à moins de 8 m** : `yRoofTop + min(dFaitage, 8) × tan(pente)`. Faîtage à moins de 8 m ⇒ comportement d'aujourd'hui inchangé ; pas de case « faîtage à plus de 8 m ».
4. **Périmètre DINAK de cette livraison** : CFG-24 (G1, conduit isolé intérieur bois) seulement, la configuration du critère de succès C. Les autres configurations restent MODINOX seul tant que leur équivalence n'est pas écrite ; l'écran le dit (« pas d'équivalence DINAK pour cette configuration »).
5. **Plaque signalétique** : alerte `verifier` seulement. L'ajout facultatif à la nomenclature demande une notion de composant facultatif absente de `fum_config_composants` : laissé en suite.

## Points en suspens (arbitrage d'Eric)

- Pennylane : peut-on tenter une pièce jointe sur un devis brouillon de test ? Sans oui, rien n'est essayé.
- Prix DINAK de Mayer : `purchase_price_ht` = net négocié à jour, `tarif_public = selling_price_ht` = prix public ? (mesuré en prod le 2026-11-28 : 12 380 articles, achat ≈ 35 % du public). Sans réponse, la comparaison affiche « base de prix DINAK non vérifiée ».
- Table d'équivalence DINAK ↔ MODINOX : proposée, marquée « non validée » jusqu'à validation par Eric ou Philippe.
- Application en prod de la migration C et du SQL des attributs / mapping DINAK.

## Points à surveiller (non couverts par les tests de tâche, ajoutés aux tâches qui les possèdent)

1. Un métré enregistré **avant** cette livraison (sans `supplier_id`, sans compléments) doit produire un plan complet : fixture `metre-g1-ancien.json` dans le test de `planModel` (A2).
2. Un devis sans métré : `genererPlanConduit` rend `{ blob: null, raison: 'sans_metre' }`, le PDF part comme avant (A4).
3. Un relevé G4 sans diamètre de boisseau ni compléments : aucune règle B ne plante ni ne dit « conforme » (B2, test `controles sur relevé minimal`).
4. Saisie d'un complément numérique vidé (`''`) : traité comme absent, jamais comme 0 (B1, `lireComplement`).
5. Fabricant sans équivalence pour la configuration : pas de colonne fantôme à 0 € dans la comparaison (C4).

---

## Livraison A — Plan du conduit en annexe PDF

### Tâche A1 : scène de primitives partagée écran / PDF

**Fichiers :**
- Créer : `src/lib/fumisterie/scene.js`
- Créer : `scripts/fumisterie/scene.test.mjs`
- Modifier : `src/apps/artisan/components/devis/metre/CoupeCotee.jsx` (devient générique), `ReleveStep.jsx`
- Supprimer : `CoupeCoteeG3.jsx`, `CoupeCoteeG4.jsx`, `CoupeCoteeG6.jsx`

**Interfaces :**
- Produit : `construireScene(gabaritCode: string, geometrie: object, releve: object, opts?: { police?: number }) => Scene | null` (null si gabarit sans dessin).
  - `Scene = { largeur: number, hauteur: number, formes: Forme[], cotes: Cote[], reperes: Repere[] }` en pixels (repère écran : y vers le bas).
  - `Forme = { type: 'rect'|'polygon'|'polyline'|'line'|'texte', ton: string, … }` — rect `{x,y,w,h,arrondi?}`, polygon/polyline `{points: [x,y][]}`, line `{x1,y1,x2,y2}`, texte `{x,y,texte,ancre,taille,gras?,etat?}` ; optionnels `epaisseur`, `pointille`, `jointure`. `ton` ∈ `sol, mur, toit, toitTrait, appareil, foyer, raccord, conduit, conduitBlanc, conduitInox, conduitNoir, piece, boisseau, legende, zoneOk, zoneKo, trait`.
  - `Cote = { cle, libelle, texte, ligne:{x1,y1,x2,y2}, ticks:{x1,y1,x2,y2}[], boite:{x,y,w,h}, texteX, texteY }`.
  - `Repere = { n, ligne:{x1,y1,x2,y2}, cx, cy, r }`.
  - Libellé de zone 1 : forme `texte` avec `etat: 'ok'|'ko'` ; l'écran préfixe `✓ ` / `⚠ `, le PDF écrit « Conforme : » / « À reprendre : ».
- Police : `opts.police` (13 par défaut) ; boîte de cote = `texte.length × police × 8,2/13 + 10` de large, `police × 22/13` de haut, rayon de repère `police × 12/13`, police de repère `police × 15/13` — à 13, les valeurs actuelles exactes.

- [ ] **Étape 1 : photographier le rendu actuel.** Script jetable (scratchpad) : esbuild + `react-dom/server.renderToStaticMarkup` des quatre coupes actuelles sur 9 relevés (G1 sans dévoiement / avec dévoiement + étage, G3, G4 plafond flexible, G4 mur, G4R rigide, G5, G6, G1 toit plat) — géométries calculées par `calculerMetre`/`geometrie*`. Sortie : `avant/<cas>.svg`.
- [ ] **Étape 2 : test de `scene.js`** (`scripts/fumisterie/scene.test.mjs`) :
  - `construireScene('G1', g, r)` : `largeur`/`hauteur` finis > 0, toutes les coordonnées finies, repères `[1,2,3,4,5,6]`, cotes `hBuse, hsp1, hCombles, hSortie` (+ `hsp2` si `nbEtages`, `decal` si `angle > 0`).
  - G3 repères `[1,2,5,7,8]` ; G4 `[1,2,3,4,5]` ; G6 `[1,2,3,4]` ; `construireScene('GX', …) === null`.
  - texte de zone : `etat 'ok'` sur la maquette, `'ko'` avec `hSortie: 0.5`.
  - `police: 26` double le rayon des repères.
- [ ] **Étape 3 :** lancer `node --test scripts/fumisterie/scene.test.mjs` → échec (module absent).
- [ ] **Étape 4 : écrire `scene.js`** en portant **à l'identique** (mêmes formules, même ordre de dessin) le contenu des `useMemo` et du JSX des quatre coupes. Familles : `G1` ; `G3, G3P` ; `G4, G4R, G4P, G4K, G4F, G5` ; `G6`.
- [ ] **Étape 5 :** test vert.
- [ ] **Étape 6 : `CoupeCotee.jsx` générique** `({ gabaritCode, geometrie, releve, onFocusChamp })` : dessine la scène, mêmes `className` qu'aujourd'hui (table `CLASSES_DU_TON`), mêmes `<g role="button">` sur les cotes, même `aria-label` par famille. `ReleveStep` n'a plus de table `COUPES`.
- [ ] **Étape 7 : preuve d'équivalence** : refaire l'étape 1 avec le nouveau composant → `apres/<cas>.svg` ; `diff` vide sur les 9 cas (à défaut, n'accepter que des écarts d'arrondi ≤ 0,1 px, listés dans le commit).
- [ ] **Étape 8 :** supprimer les trois anciennes coupes ; `npm run lint:errors`.

### Tâche A2 : modèle du plan (pur)

**Fichiers :** créer `src/lib/fumisterie/planModel.js`, `scripts/fumisterie/plan-model.test.mjs`, `scripts/fumisterie/fixtures/metre-g1-ancien.json` (métré G1 réel anonymisé : `releve` + `resultat` tels qu'enregistrés).

**Interfaces :**
- Produit : `texteSurPdf(t: string) => string` (`≤`→`au plus`, `≥`→`au moins`, `→`→`-`, `−`→`-`, `✓`/`⚠` retirés, espaces fines normalisées, puis tout caractère hors cp1252 retiré).
- Produit : `buildPlanModel({ metre, configuration, gabarit, company, devis, auteurNom, fournisseurNom, variante }) => PlanModel`, `variante ∈ 'offre'|'chantier'`.
  - `PlanModel = { variante, titre, gabaritCode, geometrie, releve, pieces: { titre, lignes: {repere, designation, detail, quantite, unite, reference?}[] }, cartouche: { entreprise: { nom, lignes: string[], rge: string, logoUrl }, client: { nom, lignes: string[] }, devis: { numero, mention }, installation: { titre, gabarit, diametre, finition, fabricant }, releve: { date, auteur }, mentions: string[] }, chantier: null | { releveSaisi: {libelle, valeur}[], alertes: string[], aVerifier: string[], justification: string|null, bilan: object|null } }`.
- `titre` : « Plan du conduit » (offre), « Fiche chantier — conduit de fumée » (chantier). `pieces.titre` : `Pièces selon le métré du jj/mm/aaaa`. `devis.mention` : `Annexe au devis N° X`. `mentions` : `['Cotes en m', 'Hors échelle']`.
- `quantite` formatée (`'1,5'` pour un flexible au ml), `reference` seulement en variante `chantier`.

- [ ] **Étape 1 : tests** :
  - `aucun prix` : `JSON.stringify(model)` ne contient ni `prix`, ni `€`, ni `vente`, ni `achat` (deux variantes).
  - `référence seulement sur la fiche chantier`.
  - `cartouche depuis les réglages` : `company.name` et `rgeCertifications` repris, aucun « Mayer » si `company.name = 'Entreprise Test'` ; client depuis `devis.client_display_name / client_address / client_postal_code / client_city`.
  - `date et auteur` : `metre.created_at = '2026-11-27T12:04:53Z'` → `27/11/2026` ; `auteurNom` null → `—`.
  - `métré ancien` (fixture) : modèle complet, `chantier.alertes` = messages `warn` de `resultat.alertes` hors `article_manquant`/`article_ambigu`, rendus par `texteSurPdf`.
  - `relevé saisi` : un libellé par paramètre **visible** du gabarit (`parametreVisible`), valeur avec unité ou libellé de choix (`Ø 150`, `Noir`, `30°`).
  - `texteSurPdf('Pente ≤ 15° → ✓ ok')` === `'Pente au plus 15° - ok'`.
- [ ] **Étape 2 :** test rouge.
- [ ] **Étape 3 :** écrire `planModel.js` (imports relatifs seulement, JSDoc sur les exports).
- [ ] **Étape 4 :** test vert.

### Tâche A3 : document PDF du plan

**Fichiers :** créer `src/apps/artisan/components/devis/metre/pdf/CoupePdf.jsx`, `…/pdf/PlanConduitPDF.jsx`.

**Interfaces :**
- Consomme : `construireScene` (A1), `PlanModel` (A2), `C`, `accentOf` de `src/lib/pdfShared.jsx`.
- Produit : `generatePlanConduitPdfBlob(model: PlanModel) => Promise<Blob>` ; export `PlanConduitDocument` (harnais).
- Mise en page : A4 paysage ; coupe à gauche (≈ 60 %, `police: 24` pour rester lisible une fois réduite), liste de pièces à droite, cartouche encadré en bas à droite (logo, entreprise, client, devis, installation, relevé, mentions). Fiche chantier : page 2 (relevé saisi, alertes acceptées, à vérifier, justification, bilan), sections absentes quand vides. Textes ≥ 8 pt, `fontSize` et `lineHeight` toujours ensemble (gotcha react-pdf).

- [ ] **Étape 1 :** écrire les deux composants (`CoupePdf` : `Svg` / `Rect` / `Polygon` / `Polyline` / `Line` / `Circle` / `Text` de react-pdf, table `COULEUR_DU_TON` en hex).
- [ ] **Étape 2 : rendu vérifié en PNG** : harnais scratchpad (mémoire `reference_react_pdf_render_harness`) sur la fixture A2 en deux variantes + G4 + G6 → `renderToStream` → PyMuPDF → PNG lus : aucun texte coupé ni chevauché, cartouche rempli, repères lisibles, aucun prix.

### Tâche A4 : jointure au PDF du devis et fiche chantier

**Fichiers :**
- Modifier : `src/shared/services/fumisterie.service.js` (+ `getPlanContexte`), `src/shared/hooks/useFumisterie.js` (+ `useFumMetreByQuote`), `src/shared/hooks/cacheKeys.js` (clé `metreByQuote` si absente), `src/apps/artisan/components/devis/devisAnnexesExport.js`, `src/apps/artisan/components/devis/DevisModal.jsx`
- Créer : `src/apps/artisan/components/devis/metre/planConduitExport.js`, `…/metre/BoutonFicheChantier.jsx`

**Interfaces :**
- `fumisterieService.getPlanContexte(orgId, metre) => { data: { configuration, gabarit, fournisseurNom, auteurNom }, error }` (configuration + gabarit filtrés `org_id` ; fournisseur = `metre.supplier_id` s'il existe, sinon le fournisseur de fumisterie de l'org ; auteur = `profiles.full_name` de `created_by`, null si illisible).
- `genererPlanConduit({ orgId, quote, settings, variante }) => Promise<{ blob: Blob|null, raison: null|'sans_metre'|'erreur', message?: string }>` — ne lève jamais.
- `joindreAnnexes(devisBlob, annexes = [], insertions = [])` : `insertions = [{ label, blob }]` placées juste après le devis, avant les fiches techniques ; une insertion illisible va dans `ignorees`.
- `useFumMetreByQuote(orgId, quoteId)` → React Query, `enabled: !!orgId && !!quoteId`.

- [ ] **Étape 1 :** service + hook + export ; `joindreAnnexes` avec insertions (le cas « aucune annexe mais une insertion » fusionne quand même).
- [ ] **Étape 2 :** `DevisModal.handleGeneratePdf` : plan `offre` généré avant `joindreAnnexes`, passé en insertion ; `raison 'erreur'` ⇒ `toast.info('Plan du conduit non joint : …')`. Ajout chirurgical (le fichier est une dette signalée, pas de découpage ici).
- [ ] **Étape 3 :** `BoutonFicheChantier` (affiché seulement si un métré existe) : bouton « Fiche chantier » (télécharge la variante `chantier`, jamais envoyée) + phrase « Le plan du conduit est joint au PDF Majord'home, pas au devis Pennylane. »
- [ ] **Étape 4 : vérifications de livraison** puis commit `feat(fumisterie): plan du conduit annexé au devis et fiche chantier`.

---

## Livraison B — Règles du DTU en alertes non bloquantes

### Tâche B1 : compléments facultatifs du relevé

**Fichiers :** créer `src/lib/fumisterie/complements.js`, `scripts/fumisterie/complements.test.mjs`, `src/apps/artisan/components/devis/metre/ComplementsForm.jsx` ; modifier `ReleveStep.jsx`.

**Interfaces :**
- `COMPLEMENTS: { cle, libelle, type: 'nombre'|'choix'|'texte', unite?, choix?, libelles?, gabarits: string[], groupe: 'debouche'|'raccordement'|'ventouse'|'dimensionnement'|'existant', min?, max? }[]`.
- Clés B : `obstacleDistance`, `obstacleHauteur` (m, au-dessus du sol), `hAcrotere` (m au-dessus du toit), `sortieBuse` (`dessus|arriere`), `diametreBuse` (mm), `angleBoisseau` (°, G4 et variantes : dévoiement du conduit maçonné), `hVerticalNotice` (m, G6), `batimentRecentOuErp` (`oui|non`, G6).
- `complementsDuGabarit(code) => COMPLEMENTS[]` ; `lireComplement(releve, cle) => number|string|null` — `''`, `null`, `NaN`, hors `[min,max]` ⇒ `null` (jamais 0).
- `ComplementsForm` : bloc replié « Compléments facultatifs (règles du DTU) », jamais d'astérisque, rien n'est validé comme requis.

- [ ] Tests : `lireComplement({x:''},'x') === null`, `lireComplement({obstacleDistance: 0}, 'obstacleDistance') === 0`, `complementsDuGabarit('G6')` contient `batimentRecentOuErp`, pas `G1`.
- [ ] Rouge → code → vert.

### Tâche B2 : règles et sources

**Fichiers :** modifier `src/lib/fumisterie/config.js`, `gabarits/g1.js`, `gabarits/g3.js`, `controles.js`, `index.js` (passe `configuration` aux contrôles, `ENGINE_VERSION = 'dtu-2026.11'`), `ListePieces.jsx` (`Alertes` : section « À vérifier sur place » pour le niveau `verifier`), `MetreFumisterie.jsx` (la confirmation ne liste que `warn`, inchangé) ; tests `scripts/fumisterie/dtu.test.mjs` + mises à jour motivées de `g1.test.mjs` / `g3-g5-g6.test.mjs`.

**Interfaces :**
- `config.zone1` += `distance_m: 8`, `acrotere_m: 1.00`, `acrotere_seuil_m: 0.20` ; `flat = pente < pente_plat_deg` (était `≤`).
- `natureInstallation(configuration) => 'traditionnelle'|'etanche_granules'|'etanche_bois'` (dans `controles.js`) : `appareil_etanche_requis` faux ⇒ traditionnelle ; vrai et `combustibles` sans `bois_buches` ⇒ étanche granulés ; sinon étanche bois.
- Hauteur exigée (G1, G3) : `yRef = yToit + min(dFaitage, distance_m) × tan(pente)` ; non plat : `yReq = max(yRef, obstacleHauteur si obstacleDistance < distance_m) + pente_m` ; plat : `max(yToit + plat_m, hAcrotere > seuil ? yToit + hAcrotere + acrotere_m : -∞, obstacle + pente_m)`.
- Contrôles `(g, r, cfg, configuration)` ; alertes `{ niveau: 'ok'|'info'|'warn'|'verifier', code, message, source }` ; sources : `Arrêté du 22/10/1969, art. 18`, `NF DTU 24.1 § …`, `Cahier CSTB 3708 § …`.

| code | déclenche | ne déclenche pas | niveau, source |
|---|---|---|---|
| `zone1` (renommé « hauteur de sortie ») | sortie sous `yReq` | maquette | warn, arrêté art. 18 ; **info** si étanche granulés ; info « Avis Technique du conduit et notice » si étanche bois |
| `devoiement_angle` | G1 `angle > 45` | 30 / 45 | warn, § 5.4.1.2.2 |
| `devoiement_hauteur` | `vg > 5` | maquette (0,69 m) | warn, § 5.4.1.2.2 |
| `raccordement_horizontal` | `lHoriz > 3` (G3, G4/G5 mur) | 1 m | warn, § 13.1.7 |
| `raccordement_directions` | somme des changements de direction hors té > 180° (compte du gabarit) | tous les gabarits actuels | warn, § 13.1.7 |
| `te_buse_arriere` | `sortieBuse = 'arriere'` et aucune ligne dont le composant contient `te` | `dessus` ou absent | warn, § 5.4.4.2 |
| `section_buse` | `diametreBuse > diametre` | égal ou absent | warn, § 13.1.3 ; `diametreBuse < diametre` ⇒ info « pièce de forme de 45° au plus » |
| `devoiement_tubage` | G4 `angleBoisseau > 45` (complément facultatif) | absent / ≤ 45 | warn, § 15.1 |
| `flexible_raccords` | G4 flexible `ceil(Lflex / 30) - 1 > 1` | ≤ 60 m | warn, § 15.4.1.1 |
| `ventilation_annulaire` | G4 sans ligne de plaque ventilée / ventilation basse (codes listés dans le test) | nomenclature avec | info, § 15.4 |
| `ventouse_vertical` | G6 `Lv < max(1,5, hVerticalNotice)` | ≥ | warn, 3708 § 3.5.1.2 |
| `ventouse_batiment` | G6 `batimentRecentOuErp = 'oui'` | `non` / absent (alors `verifier`) | warn, 3708 § 2.1 / 3.3.1 |

- Points `verifier` dérivés du gabarit et de la nature (spec § B, listes recopiées) : G4/G5 diagnostic Annexe C, vacuité, état, distances, Tableau 13 ; G1/G3 planchers traversés, distance Tableau 5, coffrage au-delà de T160 ; G6 distances du terminal (3708 § 3.3.1.3, sept lignes) ; tous sauf G5 : plaque signalétique et fiche d'identification ; tous : essais de mise en service (§ 16).
- `zone3_non_verifiee` (G6) devient la liste `verifier` du terminal ; `zone1_non_verifiee` (G4) passe en `verifier`.

- [ ] Tests (`dtu.test.mjs`) : pour chaque ligne du tableau, un cas qui déclenche et un qui ne déclenche pas ; `aucune règle ne lève` sur un relevé G4 minimal sans compléments ; `nature` sur CFG-24 / CFG-28 / CFG-40 ; `pente 15° n'est plus un toit plat`.
- [ ] Rouge → code → vert ; mettre à jour `g1.test.mjs` / `g3-g5-g6.test.mjs` (sources, seuil 15°) avec la raison dans le commit ; `tarif-reel.test.mjs` et `tranche3-tarif-reel.test.mjs` verts **sans** modification (aucune nomenclature de la maquette ne change).
- [ ] Ajouter `dtu`, `complements`, `scene`, `plan-model`, `g4`, `g3-g5-g6`, `tranche3-tarif-reel` à `audit:quality`.
- [ ] Vérifications de livraison, commit `feat(fumisterie): règles du DTU 24.1 et du Cahier 3708 en alertes non bloquantes`.

---

## Livraison C — DINAK et comparaison des fabricants

### Tâche C1 : parseur des désignations DINAK

**Fichiers :** créer `scripts/fumisterie/lib/dinak-designation.js`, `scripts/fumisterie/data/dinak-extrait-2026-11.json` (extrait réel lu en prod : référence, désignation, gamme, diamètre, des gammes du périmètre), `scripts/fumisterie/dinak-designation.test.mjs`.

**Interfaces :**
- `parserDinak({ reference, name, gamme, diametre }) => { type_piece: string|null, diametre_int: number|null, longueur_mm, longueur_max_mm, angle, pente_min, pente_max, couleur, gamme_tarif, parse_confidence, parse_notes }`.
- Types reconnus (vocabulaire du moteur) : `element_droit`, `element_reglable` (« Ajustable L = a - b »), `coude`, `te`, `chapeau_anti_refouleur` (capuchon pare-pluie / antivent / cône de finition), `solin`, `collier_jonction` (collier d'union), `collier_sous_toiture` (support au toit), `plaque_proprete` / `couronne_coupe_feu` (plaques d'écart au feu), `raccord_simple_paroi` (raccord femelle, raccord adaptation DEKO - DW), `collier_mural`, `plaque_signaletique`, `flexible` (couronne N mètres), `tampon`.
- `couleur` : gamme `… BLACK` ⇒ `noir`, sinon `inox`.

- [ ] Test pinné : nombre d'articles par `type_piece` sur l'extrait (valeurs relevées au premier passage et figées), **liste des désignations non reconnues** affichée et comptée (`non_reconnues.length` figé), Ø = colonne `diametre`, `Élément droit L = 500 mm` → 500, `Ajustable L = 350 - 530 mm` → 350 / 530, `Coude 45°` → 45, `Solin … en pente 5/30°` → 5 / 30.
- [ ] Rouge → code → vert.

### Tâche C2 : attributs, mapping et équivalence (SQL rejouable, non appliqué)

**Fichiers :** créer `scripts/fumisterie/import-attrs-dinak.mjs`, `scripts/fumisterie/data/dinak-cfg24-mapping.json`, `scripts/fumisterie/data/equivalences-gammes.json`, `supabase/migrations/20261128_1_fumisterie_fabricants.sql`, `scripts/migration-rehearsal/assert-fumisterie-fabricants.sql`.

- Migration : `fum_metres.supplier_id uuid NULL REFERENCES majordhome.suppliers(id)` ; vue `majordhome_fum_metres` recréée (`SELECT *` : la colonne arrive en fin) ; table `majordhome.fum_gamme_equivalences (id, org_id, configuration_code, gamme_catalogue, supplier_id, gamme_tarif, finition, longueurs_elements_mm int[], reglable_min_mm, reglable_max_mm, validee_par text, validee_le date, created_at, updated_at, UNIQUE(org_id, configuration_code, gamme_catalogue, supplier_id, finition))`, RLS (lecture membre, écriture org_admin), `GRANT SELECT … TO authenticated, service_role`, vue `public.majordhome_fum_gamme_equivalences` `security_invoker`, `REVOKE ALL … FROM PUBLIC, anon` ; vue `majordhome_fum_fabricants` (fournisseurs de l'org qui ont des `fum_article_attrs`, `security_invoker`, même REVOKE).
- `import-attrs-dinak.mjs` : lit les articles DINAK de l'org (PostgREST, clé service_role de `.env.local`), applique `parserDinak`, écrit `scripts/fumisterie/out/dinak-attrs_<date>.sql` (UPSERT `fum_article_attrs`, `source_version 'dinak-2026-11'`) + les lignes de mapping CFG-24 et d'équivalence ; **n'applique rien**.
- Assertions : colonne et table présentes, RLS active, `has_table_privilege('anon', …) = false` sur table et vues, `has_table_privilege('service_role', 'majordhome.fum_gamme_equivalences', 'SELECT')`, impersonation d'un membre d'une autre org ⇒ 0 ligne.

- [ ] Répéter `20260929_1` puis `20261128_1` sur le harnais avec l'assertion → vert.

### Tâche C3 : moteur indépendant du fabricant

**Fichiers :** modifier `src/lib/fumisterie/config.js` (+ `reglagesDuFabricant(reglages, equivalence) => reglages` : longueurs / réglable de l'équivalence, repli sur les réglages d'org), `src/lib/fumisterie/index.js` (+ `comparerFabricants(params, fabricants) => Comparaison`), `fumisterie.service.js` (plus de nom en dur : `getFabricants(orgId)`, `getBundle(orgId, configurationId, supplierId)`, `getEquivalences(orgId, configurationCode)`), `useFumisterie.js` ; test `scripts/fumisterie/fabricants.test.mjs`.

**Interfaces :**
- `comparerFabricants({ configuration, gabarit, composants, reglages, releve }, [{ supplierId, nom, mapping, articles, equivalence, prixVerifies }]) => { colonnes: { supplierId, nom, resultat, totaux, aChiffrer, ambigus, validee, prixVerifies }[], complete: boolean, moinsCher: string|null }` — `moinsCher` null dès qu'une colonne a `aChiffrer + ambigus > 0` ou qu'il y a moins de deux colonnes.

- [ ] Tests : MODINOX seul ⇒ une colonne, `moinsCher` null ; deux colonnes complètes ⇒ `moinsCher` = la moins chère en vente HT ; une colonne avec une ligne à chiffrer ⇒ `complete false`, `moinsCher null` ; `reglagesDuFabricant` remplace `longueurs_elements_mm` et `reglable`, garde le reste ; fabricant sans équivalence ⇒ absent des colonnes.
- [ ] Rouge → code → vert ; `tarif-reel` reste vert (MODINOX : réglages inchangés).

### Tâche C4 : comparaison à l'écran et fabricant retenu

**Fichiers :** créer `src/apps/artisan/components/devis/metre/ComparaisonFabricants.jsx` ; modifier `MetreFumisterie.jsx`, `CreateDevisModal.jsx` (passe `supplierId`), `fumisterie.service.saveMetre` (+ `supplier_id`), `planConduitExport.js` (fabricant du métré).

- Une colonne par fabricant équivalent : total achat, vente, marge, lignes à chiffrer / ambiguës, mentions « équivalence non validée », « base de prix DINAK non vérifiée » ; « comparaison incomplète » au lieu d'un gagnant. Choix du fabricant injecté ; présélection = dernier fabricant choisi (`localStorage` `fum-fabricant:${orgId}`). Moins de deux fabricants ⇒ bloc absent, écran d'aujourd'hui.
- [ ] Vérifications de livraison, commit `feat(fumisterie): moteur indépendant du fabricant, DINAK et comparaison`.

---

## Livraison D — Justification du dimensionnement et bilan du conduit existant

### Tâche D1 : règles pures

**Fichiers :** modifier `src/lib/fumisterie/complements.js` (+ clés `justification` : `notice|couplage|abaque|logiciel|non_justifie`, `justificationReference` texte ; G4/G5 : `existantNature`, `existantSectionA`, `existantSectionB` (cm), `existantVacuite` `oui|non`, `existantEtat` `bon|fissure|a_reprendre`, `existantDebouche` `conforme|non_conforme`, `existantEpaisseur` (cm), `existantDistanceCombustible` (cm, depuis la paroi intérieure)) ; créer `src/lib/fumisterie/bilanExistant.js`, `scripts/fumisterie/bilan-existant.test.mjs` ; modifier `controles.js` (info `dimensionnement_non_justifie`), `planModel.js` (`chantier.justification`, `chantier.bilan`).

**Interfaces :**
- `bilanConduitExistant(releve, configuration) => { constats: string[], nonConformites: { texte, source }[], aVerifier: string[] } | null` (null hors G4/G5).
- Tableau 13 (cm) : briques 10,5 ; boisseaux terre cuite 5 ; béton 5 ; pierre dure 10 ; pierre tendre 15. Distance paroi intérieure → combustible : < 4 ⇒ « tubage refusé » (§ 15.2.2) ; < 16 ⇒ « non thermiquement satisfaisant, désignation à calculer » (§ 15.2.1). Vacuité `non` ⇒ « pas de tubage » (§ 15.3.3). Étanche granulés : section minimale du conduit existant selon le Ø (3708 § 3.5.1.3 : 80→14, 100→16, 130→19, 150→21 cm).
- Donnée absente ⇒ ligne dans `aVerifier`, jamais de conformité supposée.

- [ ] Tests : briques 8 cm ⇒ non-conformité Tableau 13 ; 12 cm ⇒ rien ; distance 3 cm ⇒ refus ; 10 cm ⇒ « à calculer » ; aucun constat ⇒ `aVerifier` contient vacuité, épaisseur, distance ; G1 ⇒ `null` ; `justification non_justifie` ⇒ info, jamais warn.
- [ ] Rouge → code → vert.

### Tâche D2 : écran et fiche chantier

**Fichiers :** `ComplementsForm.jsx` (groupes « Dimensionnement » et « Conduit existant »), `PlanConduitPDF.jsx` (sections « Justification du dimensionnement » et « Bilan du conduit existant ») ; harnais PNG sur un G4 avec bilan.
- [ ] Vérifications de livraison, commit `feat(fumisterie): justification du dimensionnement et bilan du conduit existant`.

---

## Hors code (rappel de la spec)

- Comparaison Cat-Draw sur 3-4 chantiers réels (Eric / Philippe) ; les écarts deviendront des cas de test.
- Lecture du NF DTU 24.2 et des tableaux 2 à 4 du DTU 24.1 avant de durcir les règles de raccordement et le bilan.
