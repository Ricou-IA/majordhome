# Programmation des entretiens — Regroupement en « grands secteurs » + géocodage automatique

- **Date** : 2026-06-17
- **Statut** : Spec — en attente de validation Eric
- **Modules touchés** : Entretiens / Programmation, Géocodage (clients), edge functions + cron

---

## 1. Contexte & problème

L'onglet **Programmation** (Entretiens) groupe les contrats par **code postal**
(`SectorGroupView` ← `useContractSectors` ← `entretiensService.getContractsBySector`).
Trois frictions formulées par Eric :

1. Le CP nu (`81600`) n'est pas parlant — pas de nom de ville.
2. Deux CP **numériquement** proches ne sont pas **géographiquement** proches → impossible
   de voir ensemble les secteurs d'une même zone.
3. Une distance brute au siège ne suffit pas : « 20 km de Gaillac, ça peut être dans les
   2 sens » — il manque la **direction**.

Fond commun : **le code postal est le mauvais grain**, et la proximité est un problème **2D**.
Mesures sur la base Mayer (2026-06-17) :

- **389 clients** sous contrat actif, **95 % géocodés** (370/389) → coordonnées réelles dispo.
- **197 communes** pour **89 codes postaux** (~2,2 villes/CP) → le CP agrège des villages
  distincts (confirme #1).

**Décision produit (validée)** : **pas de carte** (jugée trop lourde). On veut un **regroupement
logiciel**, déterministe, qui reste une **liste**, basé sur la **position réelle** (jamais le
numéro de CP — sinon #2 revient).

---

## 2. Objectifs / non-objectifs

**Objectifs**
- Regrouper les CP en **« grands secteurs »** géographiques cohérents (tournées), nommés par
  leur **commune dominante**.
- Afficher la **commune réelle** de chaque client (résout #1 sans choisir de « ville principale »).
- **Géocodage automatique et systématique** des clients, quel que soit le chemin de création,
  pour ne pas accumuler de **dette géographique**.
- **Additif** : la liste actuelle et les actions « Planifier » sont préservées.

**Non-objectifs (v1)**
- Pas de carte / vue cartographique.
- Pas d'optimisation d'itinéraire (ordre de tournée type VRP).
- Pas de refonte du flux de planification (on réutilise l'existant).
- Géocodage **serveur des leads** (la détection de zone lead dépend du localStorage) — séparé.

---

## 3. État des lieux technique (découvertes)

**Géocodage**
- Service front `src/shared/services/geocoding.service.js` : `geocodeAddress` (gouv
  `api-adresse.data.gouv.fr`, seuil score ≥ 0.3), `batchGeocodeClients` (CSV + fallback unitaire),
  `updateClientCoordinates` (écrit `majordhome_clients`).
- `ClientModal` / `LeadModal` géocodent **à la saisie** (fire-and-forget).
- Triggers DB **déjà en place** : `reset_geocode_on_address_change` (clients) +
  `reset_lead_geocode_on_address_change` (leads) → remettent `latitude/longitude/geocoded_at`
  (+ `zone` pour les leads) à NULL quand l'adresse change.
- **Manque** : **aucun cron ne re-géocode** les lignes NULL. `cron.job` actuels = mailing-scheduler,
  pennylane-sync-quote-status, pv-scrape-auto-poll, retry-failed-ingestion. → les créations
  **hors modale** (cron Pennylane, N8N, imports) + les **échecs** + les **ré-adressages** restent
  NULL indéfiniment = **la dette**.
- Extensions dispo : `pg_cron` 1.6.4, `pg_net` 0.19.5.
- Colonnes `majordhome.clients` : `address`, `address_complement`, `city`, `postal_code`,
  `latitude` (numeric), `longitude` (numeric), `geocoded_at` (timestamptz), `import_source`.

**Données Programmation**
- `majordhome_contracts` expose `client_city`, `client_postal_code`, `zone_id` — **mais PAS**
  `client_latitude` / `client_longitude`. → à étendre.

---

## 4. Partie A — Géocodage automatique (sans dette)

Principe : garder le géocodage **instantané à la saisie** (modale) **et** ajouter un **balayage
serveur périodique** qui rattrape **tous** les chemins (Pennylane/N8N/imports), les échecs, et les
ré-adressages. La règle unique : « `geocoded_at IS NULL` + adresse exploitable = à géocoder ».

### A.1 Edge function `geocode-sweep`
- `verify_jwt:false`, auth via `requireSharedSecret(MDH_CRON_SECRET)` (`_shared/auth.ts`),
  versionnée dans `supabase/config.toml`.
- Logique :
  1. RPC `geocode_fetch_pending_clients(p_limit int default 100)` → `{id, address, postal_code,
     city}` où `geocoded_at IS NULL` ET `is_archived = false` ET CP présent ET (adresse OU ville).
     Ordre `created_at ASC`.
  2. Géocode via l'endpoint **CSV batch** gouv (`/search/csv/`), même logique que
     `batchGeocodeClients` (seuil score ≥ 0.3, fallback unitaire).
  3. RPC `geocode_apply_client_coordinates(p_rows jsonb)` → UPDATE `majordhome.clients`
     (`latitude`, `longitude`, `geocoded_at = now()`) par id, **COALESCE strict** (n'écrit jamais
     une coord valide avec NULL).
- Cap par run (100) → plusieurs runs absorbent le backfill ; régime de croisière = quelques lignes.

### A.2 Cron pg_cron
- `cron.job` **toutes les 30 min** : `net.http_post` vers `geocode-sweep` avec
  `Authorization: Bearer <mdh_cron_secret>` (vault), même pattern que `mailing-scheduler`.
  Migration versionnée (le `cron.job` doit être **réellement créé** — gotcha cron documenté).

### A.3 RPCs (SECURITY DEFINER, **service_role only**)
- `geocode_fetch_pending_clients(p_limit)` + `geocode_apply_client_coordinates(p_rows jsonb)` :
  `REVOKE FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE TO service_role`,
  `SET search_path = majordhome, public`. (Écritures `majordhome.*` via RPC —
  `.schema('majordhome')` interdit côté edge.)

### A.4 Anti-retry infini (minimal)
- Colonne `geocode_attempts smallint default 0` : le sweep l'incrémente, **ignore après 3 tentatives** ;
  le trigger `reset_geocode_on_address_change` la remet à 0 via **une seule ligne ajoutée**
  (`NEW.geocode_attempts := 0;`) → un ré-adressage relance. Pas de backoff, aucune autre machinerie.

### A.5 Multi-tenant
- Cron **app-level** (toutes orgs), géocodage **org-agnostique** (adresse → coords). RPCs
  service_role only. Future-proof pour l'entreprise #2.

### A.6 Backfill initial
- Le sweep draine seul les ~19 NULL existants ; option : un passage manuel `batchGeocodeClients`
  pour un backfill instantané.

---

## 5. Partie B — Regroupement en « grands secteurs »

### B.1 Fonction de clustering (pure, testable)
- `src/lib/sectorClustering.js` : `clusterSectorsByProximity(sectors, { radiusKm = 15 })`.
- Entrée : secteurs `{ codePostal, commune, contracts:[{ client_latitude, client_longitude,
  client_city, ... }] }`.
- Algo (contrainte de **rayon** — « tous les CP d'un grand secteur à ≤ `radiusKm` de son centre ») :
  1. **Centroïde par CP** = moyenne des coords des contrats géocodés du CP. CP sans aucun contrat
     géocodé → bucket `Non localisé`.
  2. **Agglomératif sous contrainte de rayon** (distance **haversine**) : chaque CP = un cluster ;
     on fusionne itérativement la paire de clusters dont les centres sont les plus proches **à
     condition que le cluster résultant garde tous ses CP à ≤ `radiusKm` de son barycentre**
     (pondéré par nb de contrats) ; sinon fusion refusée. Arrêt quand plus aucune fusion permise.
     → un grand secteur fait **au plus ~`2×radiusKm` de bout en bout** (pas d'effet de chaîne qui
     étirerait la zone au-delà du rayon voulu).
  3. **Déterministe** : tri des CP par `codePostal` en entrée ; égalités de distance → fusion de la
     paire d'indice le plus bas.
- Sortie : `[{ id, name, sectors:[...CP...], totalContracts, visitsDone, visitsPending, centroid }]`.
  `name` = **commune dominante** (plus de contrats), tie-break alpha. Bucket `Non localisé` en dernier.
- Tests `node --test scripts/sector-clustering.test.mjs` : déterminisme, effet du seuil, bucket
  non-localisé, nommage par commune dominante.

### B.2 Données
- Étendre la vue `public.majordhome_contracts` : ajouter `client_latitude`, `client_longitude`
  (le JOIN clients est déjà présent), **`security_invoker=true` préservé**.
  (Alternative si on ne veut pas toucher la vue : 2ᵉ requête `majordhome_clients` dans le service
  puis merge en mémoire.)

### B.3 Service / hook
- `getContractsBySector` retourne déjà les secteurs CP. Niveau ajouté : `useContractSectors`
  (ou un sélecteur dédié) applique `clusterSectorsByProximity` → hiérarchie
  grands secteurs → CP → contrats.

### B.4 UI `SectorGroupView`
- **3 niveaux additifs** (recommandé) : en-tête **grand secteur** (repliable, % + compteurs
  faits/à faire + bouton **« Planifier le grand secteur (N) »**) → sous-en-têtes **CP** existants
  (intacts, bouton « Planifier le secteur ») → lignes contrat (avec **commune réelle** affichée).
- Ordre : grands secteurs par `visitsPending` desc puis nom ; CP par `visitsPending` desc puis CP.
- Défauts : grands secteurs **dépliés** (sous-en-têtes CP visibles, contrats repliés).
  « Tout déplier / replier » agit au niveau grand secteur.
- Recherche + filtre mois : inchangés, s'appliquent à travers la hiérarchie.

### B.5 Invariants & cas limites (zéro doublon, zéro orphelin)
Le regroupement est une **partition au niveau code postal**, **jamais** des « cercles » qui se
chevauchent — c'est ce qui garantit structurellement les deux propriétés soulevées :

- **Zéro doublon** : chaque CP appartient à **exactement un** grand secteur (singleton au pire) ;
  chaque fiche hérite du secteur de son CP → une fiche n'apparaît **que dans un seul** secteur.
  Garde défensive : construction de l'arbre **dédupliquée par `contract.id`**. **Test de
  conservation** : `Σ fiches(grands secteurs) === total fiches en entrée` (ni perte, ni doublon).
- **Zéro orphelin perdu** : tout CP est rattaché. Un CP **sans aucune coordonnée exploitable** part
  dans un bucket **`Non localisé`** explicite (visible + planifiable — rien ne disparaît). Une fiche
  isolée **sans coords n'est pas orpheline** tant que son CP est localisable (elle suit son CP).
  *Minimisation* : pour un CP sans fiche géocodée, on pré-résout son centroïde via
  `geocodeByPostalCode(cp)` (centroïde commune gouv) avant clustering → seuls les CP **totalement
  vides de CP** restent en `Non localisé`. Avec le géocodage auto (Partie A), ce bucket tend vers ~0.
- **Fiche / CP isolé** (géocodé mais à > `radiusKm` de tout le monde) : **ce n'est pas un orphelin** —
  il forme **son propre grand secteur (singleton)**, nommé par sa commune. La partition ne perd jamais
  un point : tout CP **démarre** comme son propre cluster, la fusion est seulement *optionnelle* ;
  « hors de tous les cercles » = « ne fusionne avec personne » = **reste solo**. (≠ bucket
  `Non localisé`, réservé au **sans-coordonnées**.) *Option UX si beaucoup de singletons* : un repli
  **« Excentrés »** regroupant les secteurs de taille 1 — à n'ajouter que si la liste devient chargée.
- **CP entier dans une seule zone** : on ne **scinde jamais** un code postal entre deux tournées
  (l'unité d'action reste le secteur) → c'est aussi pourquoi on cluster au grain **CP** et non à la fiche.

---

## 6. Découpage en lots (pour le plan)

1. **A — Géocodage auto** : RPCs + edge `geocode-sweep` + cron (+ option colonne `geocode_attempts`).
   Vérifiable seul (le backfill remplit les NULL, `pct_geocoded` → 100 %).
2. **B1 — Clustering** : fonction pure `sectorClustering.js` + tests (indépendant de l'UI).
3. **B2 — Vue** : `majordhome_contracts` + `client_latitude/longitude`.
4. **B3 — UI** : `SectorGroupView` 3 niveaux + branchement hook.

A et B sont indépendants ; **A peut partir en premier** pour fiabiliser les coordonnées avant
d'exposer le regroupement.

---

## 7. Décisions (résolues avec Eric, 2026-06-17)

- **Profondeur UI** : ✅ 3 niveaux (grand secteur > CP > contrat, additif). À affiner au moment de l'UI.
- **Rayon `radiusKm`** : ✅ **15 km autour du centre du grand secteur** — chaque CP du secteur est à
  ≤ 15 km du barycentre ; une zone fait donc **≤ ~30 km de bout en bout**. Constante en dur v1,
  réglable dans Settings plus tard *seulement si besoin*.
- **`geocode_attempts`** : ✅ ajouté, **implémentation minimale** (1 compteur + skip après 3 tentatives
  + 1 ligne dans le trigger existant). Pas de backoff.
- **Fréquence du sweep** : ✅ 30 min.

---

## 8. Risques / gotchas

- **Vue updatable** : ajouter 2 colonnes SELECT issues du JOIN clients ne change pas l'écriture de
  `majordhome_contracts` (elle expose déjà `client_*`), mais **vérifier** au moment de la migration
  (cf. gotcha `majordhome_appointments` = miroir simple à ne pas casser).
- **Déterminisme du clustering** : impératif (sinon les groupes « bougent » entre reloads) →
  tri d'entrée + tie-break d'indice.
- **`geocode_apply_client_coordinates`** : COALESCE strict, ne jamais écraser une coord valide par NULL.
- **Edge `geocode-sweep`** : appel API tierce direct (cron sans JWT user), `MDH_CRON_SECRET`,
  `cron.job` réellement planifié (gotcha cron documenté).
- **Rate limit gouv** : CSV batch + cap par run ; endpoint gratuit mais rester poli.
- **CP multi-communes** : le nom de grand secteur = commune dominante du *cluster* (pas du CP) ;
  chaque ligne contrat montre sa **propre** commune → l'ambiguïté « ville principale » disparaît.
- **Doublon / orphelin** (cf. B.5) : partition stricte au grain CP + **test de conservation**
  (`Σ fiches === total`) + bucket `Non localisé` visible. Modèle « cercles chevauchants » **écarté**
  — c'est lui qui créerait doublons et orphelins.
