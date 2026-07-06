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

### ⚠️ Point non tranché (à confirmer en Phase 2)
- Le catalogue observé expose `RES4`, `RES2WE`, `ENT*`… — **vérifier que `RES1` / `RES2` (base résidentiel) sont bien présents** et lequel est le meilleur talon « fond de maison » neutre (hors VE/piscine, qu'on rajoute en couche déclarée). Requête à lancer : `?select=profil&group_by=profil` (ou `?facet=profil`).

### Méthode de génération de la fixture talon (DIFFÉRÉE)
1. Pull une **année pleine** du segment choisi (`?where=profil=... AND plage_...`, `order_by=horodate`, pagination).
2. Agréger **½ h → h** : sommer les 2 pas demi-horaires de chaque heure (Wh → Wh/h).
3. Aligner sur 8760 h (année non bissextile — cf. calendrier du moteur) : retirer le 29 févr. si l'année source est bissextile.
4. **Normaliser** : diviser chaque heure par la somme annuelle → forme `Σ = 1`.
5. Écrire `scripts/fixtures/enedis-res-base-normalized.json` : `{ source, profil, plage, annee, hourly: [8760] }`.

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
