# Spike — Données horaires Enedis (conso) + PVGIS (production)

> Date : 2026-07-07. But : figer la shape exacte des deux sources horaires avant de câbler le moteur d'autoconsommation (`src/apps/solaire/lib/autoconsoEngine.js`). Vérifié en live via l'API. **Statut : shapes + URLs confirmées. Génération de la fixture talon 8760 = DIFFÉRÉE à la Phase 2 (nécessite un pull année pleine paginé + agrégation ½h→h).**

---

## 1. Enedis Open Data — courbe de charge (talon)

- **Dataset** : `conso-inf36` — « Agrégats segmentés de consommation au pas ½ h des points de soutirage ≤ 36 kVA – Maille nationale ». Variante régionale : `conso-inf36-region`.
- **API (Opendatasoft Explore v2.1)** :
  `https://data.enedis.fr/api/explore/v2.1/catalog/datasets/conso-inf36/records`
  (public, sans auth ; `?limit=`, `?where=`, `?order_by=`, pagination `?offset=`).
- **Champs confirmés (clés JSON dans `results[]`)** :
  | Champ | Contenu |
  |---|---|
  | `horodate` | Horodatage ISO 8601 UTC (ex. `2025-09-30T22:00:00+00:00`) |
  | `profil` | Profil client — ex. `RES4`, `RES2WE`, `ENT1 (+ ENT2)` (catalogue Enedis, archétypes FOYER) |
  | `plage_de_puissance_souscrite` | ex. `P0: Total <= 36 kVA`, `P4: ]9-12] kVA` |
  | `courbe_moyenne_ndeg1_ndeg2_wh` | Courbe de charge moyenne combinée, en **Wh** ← **talon à utiliser** |
  | `courbe_moyenne_ndeg1_wh` / `_ndeg2_wh` | Sous-courbes (index sous-profil, ex. HP/HC) |
  | `total_energie_soutiree_wh` | Énergie totale soutirée du segment (Wh) |
- **Pas de temps** : **demi-horaire** (horodates à `:00` / `:30`). Unité **Wh**.
- **Filtrage segment** : `?where=profil='RES1' AND plage_de_puissance_souscrite='P0: Total <= 36 kVA'` (adapter le profil au foyer ; `RES1` base sans chauffage élec, `RES2*` avec HP/HC — cf. §Enedis du CLAUDE.md).

### ✅ RES1 confirmé + fixture GÉNÉRÉE (2026-07-07)
- Profils publiés confirmés : `RES1 (+ RES1WE)`, `RES11 (+ RES11WE)`, `RES2 (+ RES5)`, `RES2WE`, `RES3`, `RES4`, PRO*, ENT*.
- **Chaîne exacte stockée** : `profil = "RES1 (+ RES1WE)"` (pas `"RES1"` — l'API fusionne les libellés WE), plage `"P0: Total <= 36 kVA"`, champ talon `courbe_moyenne_ndeg1_ndeg2_wh` (Wh/½h). RES1 = base SANS chauffage élec → bon talon « fond de maison ».
- **Fixture générée** : `scripts/fixtures/enedis-res1-base-normalized.json` via `scripts/fetch-enedis-res1-profile.mjs` (endpoint **`/exports/json`** — le records API cape l'offset à 10000, insuffisant pour 17520 lignes ½h). Année **2023** (non bissextile → 8760 h). 17520 lignes ½h, 0 trou, Σ=1.
- **Silhouette validée** (moyenne par heure, 1,0=plat) : creux nuit 02-04h ≈ 0,64-0,65 ; pic soir 17-19h ≈ 1,43-1,52 ; saisonnalité janv. 11,3 % → juin 6,8 %. Vraie courbe résidentielle.

### Méthode de génération (implémentée dans `fetch-enedis-res1-profile.mjs`)
1. Pull **export JSON** année pleine du segment (`where profil like "RES1%" and plage like "P0%"`, `select=horodate,courbe_moyenne_ndeg1_ndeg2_wh`).
2. Agréger **½ h → h** : sommer les 2 pas demi-horaires (Wh → Wh/h) via l'index horaire `floor((horodate_UTC − yearStart)/3600s)`.
3. Année non bissextile (2023) → 8760 h directement (pas de 29 févr. à retirer).
4. **Normaliser** : `Σ = 1`. Horodate UTC (cohérent avec PVGIS UTC).

---

## 2. PVGIS v5.2 — production horaire

- **Endpoint** : `https://re.jrc.ec.europa.eu/api/v5_2/seriescalc`
- **Exemple validé** :
  `?lat=43.90&lon=1.90&startyear=2020&endyear=2020&pvcalculation=1&peakpower=1&loss=14&angle=30&aspect=0&outputformat=json`
- **Réponse (confirmée)** :
  - Série horaire : **`outputs.hourly[]`**.
  - Puissance produite : champ **`P`**, en **Watts** (pour `peakpower=1` kWc → le front multiplie par la puissance réelle kWc, linéarité, 1 seul appel PVGIS/simulation — même principe que l'edge `pvgis-proxy` actuelle).
  - Horodatage : **`time`** au format **`YYYYMMDD:HHMM`** (ex. `20200101:0010` — décalage `:10` min, moyenne horaire timbrée en milieu de pas).
  - Paramètres écho : `inputs.pv_module` (`peak_power`, `technology`, `system_loss`), `inputs.mounting_system.fixed` (`slope`, `azimuth`), `inputs.location`, `inputs.meteo_data` (PVGIS-SARAH2 / ERA5).

### ⚠️ Gotcha bissextile (IMPORTANT pour l'alignement)
- Pour **2020 (bissextile)** PVGIS renvoie **8784 pas (366 j)**, PAS 8760. Le moteur `autoconsoEngine.js` travaille sur un calendrier **365 j / 8760 h**.
- **Alignement Phase 2** : soit demander une **année non bissextile** (2019/2021/2022/2023), soit utiliser l'endpoint **TMY** (`tmy`, année météo typique = 8760 h par construction), soit **retirer le 29 févr.** de la série. Recommandation : privilégier une année non bissextile ou le TMY pour éviter tout recalage.

---

## 3. Conséquences pour le wiring (Phase 2, plan dédié)
- Étendre l'edge `pvgis-proxy` à `seriescalc` (retour `P[]` horaire) en plus du `PVcalc` mensuel actuel ; `peakpower=1` forcé serveur.
- Le front convertit `P` (W, 1 kWc) → kWh/h × puissance réelle → tableau `prodHourly[8760]` aligné (année non bissextile / TMY).
- Le talon Enedis normalisé (fixture) alimente `baseShape` de `buildLoadCurve` ; le formulaire foyer fournit les 12 ancres (`monthlyConsoTotals`) et les `devices` (VE/piscine).
