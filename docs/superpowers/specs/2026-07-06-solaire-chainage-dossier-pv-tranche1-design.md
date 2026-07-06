# SPEC — Chaînage administratif PV : socle « Dossier PV » + géoloc enrichie + CERFA/notice (Tranche 1)

> **Date** : 2026-07-06 · **Statut** : validée avec Eric (brainstorming) — à relire avant plan d'implémentation
> **Origine** : cahier des charges « SaaS de Gestion et d'Automatisation Solaire PV v1.0 » fourni par Eric, **adapté** à l'écosystème Majord'home existant (app `src/apps/solaire/`, stack React/Vite + Supabase, pas de backend Node séparé).
> **Prérequis** : app Solaire livrée le 2026-06-11 (`docs/superpowers/specs/2026-06-10-app-solaire-pv-design.md`).

---

## 1. Contexte, positionnement & principe directeur

### 1.1 Positionnement
Objectif Eric : **automatiser la chaîne administrative des installations PV pour Mayer** (urbanisme → Consuel → Enedis), en partant du parcours de vente existant. **Outil interne d'abord** ; le mode « produit vendable à d'autres installateurs » est une évolution *probable mais ultérieure*. Conséquence d'architecture : on construit pour Mayer **en respectant strictement la charte multi-tenant déjà en vigueur** (org_id-scopé, settings par org, `buildCompanyInfo`) — ainsi la productisation future ne demandera pas de refonte. Aucun effort spécifique « pour la vente » n'est engagé maintenant.

### 1.2 Principe directeur — **write-once, un seul parcours**
> Un seul parcours de vente qui capture au passage tout ce qui sert. Chaque information a **un unique point de saisie**, le plus en amont possible. La **validation du dossier ne fait que *déclencher* la génération** des documents, à partir de données déjà présentes. **Zéro resaisie a posteriori.**

Corollaire (steer explicite d'Eric) : **tout élément à double usage (vente + dossier) se saisit dans l'offre commerciale**, pas dans une phase admin séparée. Exemple canonique : le **plan de masse / le cadastre** enrichit l'offre (montrer au client sa parcelle + l'implantation) **et** constitue la pièce DP — donc capturé une fois, dans l'offre.

Les documents administratifs (CERFA, notice, plus tard schéma Consuel, mandat Enedis) sont des **projections** d'un accumulateur de données : ils **lisent**, ils ne demandent rien.

### 1.3 La chaîne complète (vision) & découpage en tranches
```
Vente signée (contrat/chantier, existant)
  └─ ① URBANISME     CERFA + notice → arrêté de non-opposition
        └─ ② CONSUEL  schéma unifilaire → attestation
        └─ ③ ENEDIS   pack raccordement (a besoin de ①, du plan de masse coté, et de ②)
  └─ mise en service
```
Le pack Enedis est un **assembleur** → il vient en dernier. Le plan de masse **coté réglementaire** (DP2) a besoin du cadastre → groupé avec les pièces graphiques.

| Tranche | Contenu | Statut |
|---|---|---|
| **1 (cette spec)** | Socle `pv_dossiers` + machine à états · **géoloc enrichie** (Google Solar géométrie + heatmap flux + cadastre IGN, avec repli) · config matériel minimale · **CERFA 16702 + notice descriptive** | **à faire** |
| 2 | Schéma Consuel unifilaire + brique « Étude technique / ingénierie électrique » | déféré |
| 3 | Pièces graphiques DP1 (situation) / **DP2 coté réglementaire** / DP5 photomontage | déféré |
| 4 | Pack Enedis + mandat de représentation + ZIP normalisé | déféré |

> **Cette spec couvre uniquement la tranche 1.** Les tranches 2-4 sont mentionnées pour situer, pas spécifiées.

---

## 2. Deltas vs cahier des charges d'origine (conflits tranchés, pas moyennés)

| Sujet | Cahier d'origine | **Décision retenue** |
|---|---|---|
| Backend | Node/Express ou FastAPI séparé | **Aucun backend séparé** : Supabase edge functions (Deno) + React/Vite. Pattern existant `pvgis-proxy`. |
| Base de données | PostgreSQL **+ PostGIS** | Postgres Supabase existant. **PostGIS non requis en tranche 1** (le GeoJSON cadastre est stocké en `jsonb` ; les calculs géométriques passent par `@turf/turf` côté client, déjà dans la stack). PostGIS réévalué si la DP2 coté (tranche 3) l'exige. |
| Carto front | Leaflet | **Mapbox GL** (déjà partout : territoire, GeoGrid). |
| Moteur géospatial | Turf.js / Shapely | **`@turf/turf`** (déjà installé). |
| Manip PDF | pdf-lib / pypdf | **`pdf-lib`** (AcroForm CERFA) + **`@react-pdf/renderer`** (notice) — déjà utilisés (contrats, EtudePDF). |
| Simulation | Fusion Google Solar + PVGIS | **Retenue** : Google Solar = géométrie toit + heatmap flux ; **PVGIS reste le moteur de rendement** (inchangé). Voir §5. |
| Module cache/quota (spec §8) | Cache géospatial + hard cap Google Cloud | **Retenu et nécessaire** (car Google Solar est payant au-delà du gratuit). Porté via le **playbook GeoGrid existant** (edge proxy + cache write-through + `useGeoGridQuota`-style). Voir §5.3. |
| Google Solar « surplus » | — | Sans objet : la règle produit **« surplus PV jamais valorisé en € »** est orthogonale (valorisation aval) et **reste inchangée**. |
| Formulaire urbanisme | CERFA **13703** | **CERFA 16702\*01** (le 13703 a été renuméroté/remplacé, même objet : DP maison individuelle). Voir §6. |
| Sécurité clé API | Restriction IP/domaine | Clé Google **uniquement côté edge** (jamais navigateur) + restriction API (Solar API only). Conforme charte multi-tenant + §8.2 du cahier. |

---

## 3. Parcours utilisateur (le fil write-once)

```
A. QUALIFICATION (Lead, existant) ─── identité, adresse, contact
      │  (source de vérité amont — aucune resaisie en aval)
      ▼
B. SIMULATION + OFFRE (app Solaire, enrichie) ───────────── LE PARCOURS DE VENTE
      • localisation (GPS/adresse, existant)
      • À LA GÉOLOC, en parallèle (nouveau) :
          – Google Solar buildingInsights → auto-remplit pente/orientation/surface + segments
          – Google Solar dataLayers      → heatmap de flux (image d'offre)
          – Cadastre IGN                 → parcelle(s) + plan de masse + code INSEE
          – Géoportail Urbanisme (GPU)   → statut ABF / secteur protégé
        → repli SILENCIEUX sur la saisie manuelle actuelle si 404 / hors couverture
      • toiture, consommation, config matériel (marque/modèle module + aspect), résultats (existant + minime)
      • étude PDF = l'offre vendable (existant)
      → tout ceci naît/s'accumule dans le DOSSIER PV
      ▼
C. VALIDATION DU DOSSIER (1 déclencheur, dans la continuité — pas une session admin à part)
      • on ne complète QUE les résidus purement admin encore inconnus :
          état civil du déclarant (civilité, date + lieu de naissance)
      • 1 clic ──> génère CERFA 16702 pré-rempli + notice descriptive
                  (tout le reste est déjà là : identité=Lead, technique=Simulation,
                   cadastre=auto, installateur=Org settings, constantes=figées)
```

Le **Dossier PV n'est pas un formulaire admin qui « s'ouvre après la vente »** : il naît avec l'offre (étape B) et accumule au fil de l'eau. L'étape C complète 3-4 champs qui n'ont aucun sens avant (état civil), **dans le même flux**.

---

## 4. Modèle de données & machine à états

### 4.1 Table `majordhome.pv_dossiers`
Prolonge la simulation existante — **ne la remplace pas** (`pv_simulations` reste le snapshot de calcul).

```sql
create table majordhome.pv_dossiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references core.organizations(id),
  created_by uuid not null references auth.users(id),

  -- rattachements parcours (write-once amont)
  pv_simulation_id uuid references majordhome.pv_simulations(id) on delete set null,
  lead_id          uuid references majordhome.leads(id)          on delete set null,
  client_id        uuid references majordhome.clients(id)        on delete set null,

  -- machine à états de la chaîne admin (voir 4.2)
  status text not null default 'offre',

  -- enrichissement géoloc auto-dérivé (persisté = pas de re-appel API)
  cadastre      jsonb,   -- { commune_insee, parcelles:[{section,numero,superficie_m2}], geojson }
  roof_geometry jsonb,   -- { source:'google_solar'|'manual', imagery_quality, segments:[...],
                         --   pitch_deg, azimuth_google_deg, aspect_pvgis, area_m2, flux_image_path }
  abf           jsonb,   -- { secteur_protege:bool, source:'gpu', checked_at }

  -- config matériel de l'offre (write-once ; alimente la notice + l'aval)
  material      jsonb,   -- { module_marque, module_modele, module_aspect(def 'full_black') }

  -- résidus admin complétés à la validation (write-once)
  declarant     jsonb,   -- { civilite, date_naissance, naissance_commune, naissance_departement }

  -- livrables générés
  documents     jsonb,   -- { cerfa_pdf_path, notice_pdf_path, generated_at }

  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

**Choix `jsonb` par bloc fonctionnel** (cadastre/roof_geometry/abf/material/declarant/documents) plutôt que colonnes plates : chaque bloc est produit/consommé d'un tenant, évite une migration par champ ajouté aux tranches suivantes, et suit la convention `pv_simulations` (`inputs`/`results` en jsonb). Les champs promus en colonnes scalaires (ex. filtrage) le seront au besoin.

**Création du dossier = LAZY, jamais d'UI « Créer un dossier ».** La ligne `pv_dossiers` est insérée automatiquement au **premier événement qui produit de la donnée de dossier** dans l'étape B — 1ᵉʳ appel Google Solar réussi OU 1ʳᵉ sauvegarde de simulation (`Step1Localisation`). **UPSERT sur `pv_simulation_id`** (idempotent : une simulation = au plus un dossier). Le dossier « existe » donc implicitement dès l'offre, sans geste dédié — cohérent avec le principe write-once (aucun formulaire d'ouverture). L'étape C (validation) ne fait que compléter `declarant` puis appeler la RPC de transition.

### 4.2 Machine à états (`status`)
Enum déclaré en entier (vision), **seule la 1ʳᵉ transition est active en tranche 1** :

| État | Sens | Actif T1 |
|---|---|---|
| `offre` | dossier né avec l'offre commerciale | ✅ |
| `dossier_valide` | validé → CERFA + notice générés | ✅ (transition cible T1) |
| `urbanisme_depose` | CERFA déposé en mairie | déclaré, inactif |
| `urbanisme_valide` | arrêté de non-opposition reçu | déclaré, inactif |
| `raccordement_enedis` | demande Enedis émise | déclaré, inactif |
| `consuel_demande` | dossier Consuel transmis | déclaré, inactif |
| `projet_en_service` | mise en service | déclaré, inactif |

- **Unique writer** de la transition (pattern Bloc A / appointments) : une RPC `pv_dossier_advance(p_dossier_id, p_target_status)` SECURITY DEFINER, **forward-only** (ne redescend jamais un état), check membership org. REVOKE anon.
- Les transitions aval (urbanisme→…) seront ajoutées avec leurs tranches respectives.

### 4.3 Lignage write-once (rappel condensé — matrice complète en annexe A)
| Donnée | Origine (point de saisie unique) | Documents T1 |
|---|---|---|
| Civilité, nom, prénom, adresse, tél, email | **Carte Lead** (existant) | CERFA, notice |
| kWc, nb modules, orientation, pente, surface | **Simulation** (existant ; auto-remplie via Google Solar) | CERFA, notice |
| Réf. cadastrales (INSEE, section, parcelle, superficie) | **Auto-dérivé géoloc** (cadastre IGN) → `pv_dossiers.cadastre` | CERFA |
| Statut ABF / secteur protégé | **Auto-dérivé géoloc** (GPU) → `pv_dossiers.abf` | conditionne notice DP11 |
| Marque/modèle module + aspect (full black) | **Config offre** → `pv_dossiers.material` | notice |
| Identité installateur (raison sociale, SIRET, RGE, adresse) | **Org settings** (`buildCompanyInfo`, existant) | notice (cartouche) |
| État civil déclarant (date + lieu de naissance) | **Validation dossier** → `pv_dossiers.declarant` | CERFA cadre 1 |
| Surface plancher=0, emprise=0, surimposition, mode pose | **Constantes métier** figées dans le générateur | CERFA, notice |

> **CERFA T1 = au nom du déclarant client SEUL.** Le dépôt en représentation (déclarant = installateur mandaté) relève du **mandat Enedis (tranche 4)** — hors T1. En T1 le CERFA n'utilise donc pas l'identité installateur comme déclarant ; celle-ci n'apparaît que dans le cartouche de la notice.

Hors périmètre T1 (tranches 2-4) : PDL/PRM, RIB, calibres/sections électriques, représentant légal org, dépôt mandaté, photos terrain. **Aucun de ces champs n'est demandé en T1.**

---

## 5. Enrichissement géoloc (étape B, à la géolocalisation)

### 5.1 Google Solar — géométrie de toiture (`buildingInsights`)
- Endpoint `buildingInsights.findClosest` (SKU **Building Insights**, palier gratuit **10 000 appels/mois**).
- Extraction : `solarPotential.roofSegmentStats[]` → `pitchDegrees`, `azimuthDegrees`, `stats.areaMeters2` (surface corrigée de l'inclinaison), `center`. On retient le segment dominant (plus grande `areaMeters2`) pour pré-remplir `Step1Localisation`, tous les segments persistés dans `roof_geometry`.
- **Conversion azimut → PVGIS** (Google : 0=N, 90=E, 180=S, horaire, 0–360 ; PVGIS : Sud=0, Est=−90, Ouest=+90) :
  ```
  aspect_pvgis = normalizeDeg(azimuth_google - 180)   // intervalle demi-ouvert [-180, +180)
  ```
  Vérifié aux 4 cardinaux. **Cas pan plat** (`pitchDegrees` ≈ 0 → azimut arbitrairement 0/Nord côté Google) : ne PAS propager ; forcer `aspect=0` (Sud) + `angle=0`. → **test unitaire dans `pvEngine.js`**.
- **Pente** : `pitchDegrees` s'utilise **directement** comme `angle` PVGIS (même convention, aucune conversion).
- **Restriction RGPD/EEA** (juil. 2025) : retire seulement `postalCode`/`administrativeArea`/`regionCode` — sans impact (on a le CP via `api-adresse.data.gouv.fr`).

### 5.2 Google Solar — heatmap de flux (`dataLayers`)
- Endpoint `dataLayers:get`, vue **`IMAGERY_AND_ANNUAL_FLUX_LAYERS`** (SKU **Data Layers**, palier gratuit **1 000 appels/mois** — largement suffisant au volume Mayer, décision Eric → **coût 0 €**).
- **On affiche la couche de Google directement, aucun visuel maison.** Mais Google ne renvoie pas un PNG : `annualFluxUrl` est un **GeoTIFF mono-bande float** (kWh/kW/an), l'URL **expire en 1 h** et nécessite `geoTiff:get?id=…&key=…`. Passage obligé côté edge :
  1. fetch du GeoTIFF (annualFlux + `maskUrl` roof mask),
  2. colorisation avec la **rampe de couleur recommandée par Google** (recette officielle, pas une palette inventée) + application du masque toit,
  3. rendu PNG **persisté** dans Storage `product-documents/${orgId}/solaire/dossiers/${dossierId}/flux.png` → `roof_geometry.flux_image_path`.
- L'image est régénérable mais persistée (URL Google éphémère → jamais stockée telle quelle).

### 5.3 Cache, quota & coût (playbook GeoGrid réutilisé)
- Edge **`google-solar-proxy`** (`verify_jwt:true` + `requireOrgMembership`) — miroir de `pvgis-proxy`. Clé **`GOOGLE_SOLAR_API_KEY`** en env edge (jamais navigateur), restreinte à la Solar API.
- **Cache write-through** table `majordhome.google_solar_cache` (org_id, `building_key` = `name` Google ou lat/lon arrondi, `building_insights jsonb`, `flux_image_path`, `imagery_quality`, `fetched_at`). Un toit est stable → **coût marginal 0** pour toute ré-simulation sur la même adresse. Vue publique `security_invoker` + `GRANT SELECT … TO service_role`. **Cache partagé par org, pas par dossier** ; pas de TTL (donnée quasi statique) — refetch uniquement si l'entrée est absente ou sur demande explicite « rafraîchir » (rare).
- **Garde-fou quota** `useGoogleSolarQuota(orgId)` (calqué sur `useGeoGridQuota`) : compteur mensuel bornes UTC strictes, **comptant séparément** Building Insights (10k) et Data Layers (1k, le tier rare). Hard cap journalier (≈ quota/30) contre l'emballement. Rate limit Google : 600 req/min.
- **404 NOT_FOUND** (pas de bâtiment < 50 m OU qualité < `requiredQuality`) traité comme **cas nominal** → `roof_geometry.source='manual'`, l'UI bascule sur la saisie manuelle (comportement actuel `Step1Localisation`). `requiredQuality=MEDIUM` par défaut (rural Tarn : MEDIUM plus probable que HIGH) ; `imageryQuality` retourné affiché à l'UI comme indice de fiabilité. **Règle : le dossier n'est JAMAIS bloqué par un échec/absence Google** (géométrie ⇒ saisie manuelle ; `flux.png` absent ⇒ offre sans heatmap) — la génération CERFA/notice ne dépend pas de Google Solar.

### 5.4 Cadastre IGN (parcelle + plan de masse)
- API **apicarto IGN / Géoplateforme** (`apicarto.ign.fr/api/cadastre/parcelle`, gratuite, sans auth) → GeoJSON des parcelles depuis lat/lon. Code commune INSEE via la réponse ou `geo.api.gouv.fr`.
- La parcelle contenant le point est mise en surbrillance ; l'utilisateur peut **cliquer les parcelles adjacentes** (propriété multi-parcelles) — carte **Mapbox GL** + `@turf/turf`. Résultat figé dans `pv_dossiers.cadastre` (tableau `parcelles`). **Ce n'est PAS du scope creep DP2** : le CERFA lui-même exige la liste de TOUTES les références cadastrales du terrain (une propriété peut chevaucher plusieurs parcelles) → la sélection multi-parcelle sert directement le CERFA T1. La parcelle dominante sert le plan de masse ; les autres sont pré-capturées (zéro resaisie pour la DP3). **Seule la cotation orthogonale réglementaire (distances aux limites) est déférée en tranche 3.**
- **Plan de masse (niveau offre)** : implantation « propre » des panneaux sur toiture/parcelle = simple, valeur commerciale immédiate. La **cotation orthogonale réglementaire (DP2)** est explicitement **hors T1** (tranche 3) — même donnée cadastre en dessous, aucune resaisie quand on l'ajoutera.
- **Statut ABF/secteur protégé** : croisement parcelle × **Géoportail de l'Urbanisme (GPU)** → `pv_dossiers.abf.secteur_protege`. Conditionne l'obligation de la notice/volet paysager renforcé.

---

## 6. Génération documentaire (étape C)

### 6.1 CERFA 16702\*01 (Déclaration Préalable, maison individuelle)
- Template PDF officiel (AcroForm) stocké en asset repo (ou bucket `product-documents/${orgId}/` si personnalisé). Rempli **client-side via `pdf-lib`** (`getForm().getTextField(name).setText(…)`, cases via `getCheckBox`), puis **aplati** (`form.flatten()`), export blob → Storage → `documents.cerfa_pdf_path`.
- **Sous-tâche de découverte (risque, cf. §9)** : énumérer une fois les noms de champs AcroForm du CERFA (souvent cryptiques) et les cartographier vers notre lignage. À faire au démarrage de l'implémentation, sur le PDF officiel courant.
- Champs alimentés : déclarant (`declarant` + Lead), terrain (adresse Lead + `cadastre`), nature travaux (constante), surfaces plancher/emprise (constantes 0), bordereau des pièces (liste dérivée des livrables présents).

### 6.2 Notice descriptive
- Générée par **concaténation intelligente** (approche du cahier §4.2) → PDF via **`@react-pdf/renderer`** (pattern `EtudePDF.jsx`), brandé `buildCompanyInfo(settings)`.
- Variables : `activePanels` (nb modules), `activeKwc`, `material.module_marque`, orientation/pente (Simulation), mode de pose = **surimposition** (constante), aspect **full black** (`material.module_aspect`), épaisseur structure **< 15 cm** (constante offre). Texte enrichi si `abf.secteur_protege` (justification d'insertion paysagère).
- ⚠️ **Gotcha react-pdf / Helvetica** (charte projet) : formatters PDF-safe obligatoires (espaces U+202F, virgule FR, pas de glyphes Unicode non couverts) — réutiliser `fmtInt`/`numStr` d'`EtudePDF.jsx`.

### 6.3 Emplacement UI
- Nouvel onglet/section **« Dossier »** dans le parcours Solaire (après Résultats) OU accessible depuis la fiche simulation. Bouton **« Valider le dossier »** → modale de complétion état civil → génération → aperçu/téléchargement des 2 PDFs. Décision d'emplacement précise = étape du plan d'implémentation.

---

## 7. Architecture & fichiers

```
src/apps/solaire/
├── lib/
│   ├── googleSolar.js        # NEW : invoke edge google-solar-proxy, parse buildingInsights,
│   │                         #       conversion azimut→PVGIS, sélection segment dominant, fallback
│   ├── cadastre.js           # NEW : apicarto IGN parcelle + INSEE + GPU (ABF)
│   ├── pvEngine.js           # + googleAzimuthToPvgisAspect() (pur, testé)
│   └── pvgis.js              # inchangé (moteur rendement)
├── components/
│   ├── Step1Localisation.jsx # + auto-remplissage toiture depuis Google Solar (repli manuel intact)
│   ├── dossier/              # NEW
│   │   ├── DossierTab.jsx        # onglet Dossier : statut, pièces, bouton Valider
│   │   ├── CadastrePicker.jsx    # carte Mapbox + sélection parcelles adjacentes
│   │   ├── FluxHeatmap.jsx       # affichage image flux persistée
│   │   └── ValidateDossierModal.jsx  # complétion état civil déclarant
│   └── pdf/                  # NEW
│       ├── fillCerfa.js         # pdf-lib AcroForm fill + flatten
│       └── NoticePDF.jsx        # @react-pdf/renderer, brandé buildCompanyInfo
src/shared/services/pvDossier.service.js   # NEW : CRUD via vue publique (org_id explicite)
src/shared/hooks/usePvDossier.js           # NEW : React Query (cache keys pvDossierKeys)
src/shared/hooks/useGoogleSolarQuota.js    # NEW : garde-fou quota (calqué useGeoGridQuota)
src/shared/hooks/cacheKeys.js              # + pvDossierKeys, googleSolarKeys (orgId 1er param)
supabase/functions/google-solar-proxy/index.ts  # NEW : proxy + cache + GeoTIFF→PNG
```

- Conventions qualité : composants < 500 LOC (orchestrateur + sections), logique dans `lib/`/hooks jamais dans le JSX, `logger` au lieu de `console.*`, Tailwind only, cache keys centralisées (orgId 1er param), retour service `{ data, error }`.
- Palette : **deutan stricte** (jaunes/bleus, jamais rouge/vert) — cohérence app Solaire. La heatmap de flux Google est une exception (rampe officielle Google) mais cantonnée à l'image de flux.

---

## 8. Sécurité multi-tenant (obligatoire dès les migrations)

- `pv_dossiers` : **RLS activée**. SELECT = membre org (`org_id IN (org_members de auth.uid())`) ; INSERT membre org + `created_by=auth.uid()` ; UPDATE/DELETE owner ou org_admin. Vue publique **`public.majordhome_pv_dossiers`** en `WITH (security_invoker=true)`, `SELECT *` mono-table → **auto-updatable** (jamais de JOIN/LATERAL : casse les écritures PostgREST). **`GRANT SELECT … TO service_role`** dans la même migration (régression 42501 silencieuse sinon).
- **Colonne `status` non mutable via la vue** : la policy UPDATE RLS sert à écrire les blocs `jsonb` (cadastre/roof_geometry/material/declarant/documents) depuis le front, **mais `status` n'est jamais écrit directement** — il l'est **uniquement** via la RPC `pv_dossier_advance` (garantie forward-only). Filet DB : **trigger BEFORE UPDATE** qui rejette tout changement de `status` non issu de la RPC (ou fige `status` hors RPC). La RPC est **side-effect-free** (ne touche que `status`) ; l'orchestration de génération est côté client : modale déclarant → `fillCerfa`/`NoticePDF` → upload Storage → UPDATE `documents` (via la vue) → RPC `pv_dossier_advance('dossier_valide')` en dernier.
- `google_solar_cache` : idem (RLS org, vue `security_invoker`, GRANT service_role).
- Toute requête frontend filtre **explicitement `.eq('org_id', orgId)`** (défense en profondeur).
- RPC `pv_dossier_advance` : SECURITY DEFINER, `SET search_path = majordhome, public`, check membership, **REVOKE anon**, forward-only.
- Edge `google-solar-proxy` : `verify_jwt:true` + `requireOrgMembership` (helper `_shared/auth.ts`). Clé Google **jamais exposée au client**. Ajouter l'entrée dans `supabase/config.toml`.
- Storage : PNG flux + PDFs sous préfixe **`${orgId}/…`** (bucket `product-documents` déjà conforme).
- Permission : la chaîne s'appuie sur `pv_calculator.view` existant. Un droit `pv_dossier.manage` distinct (org_admin/team_leader) **pourra** être ajouté — à décider au plan (par défaut : mêmes accès que la simulation).
- `.or()`/`.ilike()` avec input user → `escapePostgrestSearchTerm()`.

---

## 9. Risques & questions ouvertes

1. **Couverture Google Solar en rural Tarn** — MEDIUM probable, HIGH incertain, 404 possible. Mitigation = repli manuel (déjà là) → **aucun blocage fonctionnel**, seulement un taux d'auto-remplissage variable. *Validation empirique recommandée* : sonder `buildingInsights.findClosest` sur 5-10 adresses réelles de Gaillac au démarrage de l'implémentation (lire `imageryQuality`). N'engage pas le design (fallback-first).
2. **Cartographie des champs AcroForm du CERFA 16702** — noms cryptiques, à énumérer une fois sur le PDF officiel courant. Risque de champs non mappables → prévoir des champs laissés vides + remplissage manuel résiduel documenté.
3. **Ambiguïté enum `imageryQuality`** (LOW vs BASE, doc Google contradictoire) — vérifier la valeur réelle renvoyée en prod avant tout `switch` dessus.
4. **`dataLayers` GeoTIFF** — dépendance de rasterisation côté edge (lib GeoTIFF Deno + colorisation + masque). À valider techniquement tôt (spike). Repli acceptable T1 : livrer d'abord `buildingInsights` (géométrie), la heatmap flux juste après si le spike traîne — **sans** bloquer le CERFA.
5. **PVGIS `angle` depuis Google** — normalisation azimut cohérente (Nord = −180 vs +180) : figer la convention + test unitaire.

---

## 10. Critères de succès (vérifiables)

- Sur une adresse **couverte** : la géoloc pré-remplit pente/orientation/surface (valeurs Google Solar), affiche la heatmap de flux, et propose la/les parcelle(s) cadastrale(s) — **sans saisie manuelle**.
- Sur une adresse **non couverte** (404) : repli manuel transparent, le reste du parcours fonctionne à l'identique.
- À la validation : génération d'un **CERFA 16702 pré-rempli** (déclarant + terrain + cadastre + surfaces) et d'une **notice descriptive** cohérente, **sans aucune ressaisie** d'une donnée déjà présente sur le Lead / la Simulation / les settings org.
- `googleAzimuthToPvgisAspect()` : test unitaire vert sur les 4 cardinaux + cas pan plat (`node --test`, comme `pv-engine.test.mjs`).
- `npx vite build` OK ; `npm run lint:errors` sans nouvelle erreur.
- Aucune fuite cross-org (RLS + `.eq('org_id')` sur toutes les requêtes ; clé Google edge-only).

---

## Annexe A — Matrice de lignage complète
Issue de la reconnaissance read-only (7 agents) sur le code existant + exigences réglementaires. ~55 champs requis par l'ensemble de la chaîne, **~50 % déjà capturés**. Détail par document (CERFA / Notice / Consuel / Enedis) : voir la sortie de la passe `pv-chain-data-lineage` (identité/adresse ← Lead ; technique ← Simulation ; installateur ← Org settings ; ~15 champs neufs regroupés en 6 points de saisie uniques, dont **seuls ceux marqués « T1 » ci-dessus sont dans le périmètre de cette tranche**).
