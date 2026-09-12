# Planification d'entretien « machine-usable » — outils déterministes, humain dans la boucle, Hermes ensuite

**Date** : 2026-09-12 · **Statut** : spec à relire (Eric) · **Origine** : brainstorm Hermes × Majord'home du 2026-09-12

## 1. Le problème (cas d'usage n°1, le plus douloureux)

Un client appelle pour son entretien. L'humain décroche, ouvre la fiche, et doit trouver **le bon créneau** :
le bon technicien (l'entretien concerne une clim → seul Antoine fait la clim), la bonne journée (le client
est à Castres → là où la tournée passe déjà à côté), à un moment qui tient entre les rendez-vous posés,
trajets compris. Aujourd'hui l'onglet **Tournées** répond à la question inverse (« pour cette journée,
quels contrats insérer ? ») et l'humain bricole à partir de là. Le géocodage, socle de tout le calcul,
repose sur des adresses saisies à la main sans validation — et échoue en silence quand l'adresse
n'existe pas.

**Décisions d'Eric qui cadrent la solution** (2026-09-12) :
- L'agent **propose, l'humain choisit et pose**. Pas d'écriture autonome en V1.
- On construit **maintenant** tous les outils dont Hermes aura besoin, en conception *machine-usable*
  (entrées/sorties JSON stables, aucune logique enfermée dans l'UI), avec l'humain dans la boucle.
  Objectif : pouvoir « débrancher l'humain » demain sans réécrire, et **tester les outils avant**
  d'y mettre Hermes.
- Une précision d'adresse au **code postal suffit dans 99 % des cas** ; la BAN (Base Adresse Nationale)
  devient la source de saisie.
- Hermes (agent, profil `majordhome` sur le KVM2) n'entre en jeu qu'en **tranche 3**, par-dessus les
  mêmes outils, exposés en MCP.

## 2. Ce qui existe déjà (et qu'on réutilise tel quel)

| Brique | Où | Ce qu'elle fait |
|---|---|---|
| Moteur Tournées **pur** | `src/lib/tournee/` (`creneaux.js`, `arrets.js`, `duree.js`, `eligibilite.js`, `geo.js`, `matrice.js`, `timeline.js`) | Durée barémée par équipement, insertion d'un candidat dans les créneaux libres d'une journée (`placerCandidat`), coût = minutes ajoutées trajets compris. Testé `node --test scripts/tournee/*.test.mjs`. |
| Orchestration jour → candidats | `tournees.service.js::getJourneesHorizon`, `::proposerPourJournee` | Charge techniciens (`include_in_routing`, `is_active`), RDV de l'horizon avec coordonnées (client → lead → siège), matrice Mapbox à deux étages (haversine puis Matrix API sur les survivants) via `trajets.service.js::chargerMatrice` + cache `majordhome.travel_cache`. Réglages `settings.tournees` (`construireReglages`). |
| Pose d'un entretien | `useJourneePose.js` → `ensureEntretienCard` + `savService.scheduleEntretien` | Crée la carte kanban si absente, puis `createAppointmentBatch` + `workflow_status='planifie'`. **Source unique** de planification entretien (kanban, ContractModal, Tournées). |
| Géocodage | `geocoding.service.js` (front, BAN) + edge `geocode-sweep` (cron 30 min, BAN `/search/`) | Géocode après coup ; `geocodeByPostalCode` (`type=municipality`) existe mais n'est pas dans le chemin du balayage. Trigger `reset_geocode_on_address_change` remet les coordonnées à NULL quand l'adresse change. |
| SMS/WhatsApp | edge `sms-send` | Notification client, identité d'expéditeur par org. |

**Ce qui manque** : la question inverse (contrat → journées), l'exécution **côté serveur**, les
**compétences** des techniciens, l'adresse **validée à la saisie**, et un contrat d'API stable pour
qu'une machine (Hermes, Vapi) appelle tout ça.

## 3. Architecture cible

```
Fiche client / ContractModal ──CTA──▶ edge `slots-propose` ──▶ moteur pur (copie de src/lib/tournee)
        │                                   │                        + Mapbox Matrix (token serveur)
        │ clic sur un créneau               │                        + travel_cache
        ▼                                   ▼
  pose (tranche 1 : chemin front existant ; tranche 2 : RPC `entretien_book_slot`)
        │
        ▼
  SMS confirmation (sms-send)

Tranche 3 : serveur MCP Majord'home (edge) = façade des mêmes opérations → Hermes / Vapi
```

Principe : **une seule implémentation par opération**, côté serveur, appelée par l'UI *et* par les
machines. L'onglet Tournées actuel n'est pas réécrit (il continue d'exécuter le moteur dans le
navigateur pour son usage interactif) ; les modules purs restent la source unique, copiés au build.

## 4. Tranche 1 — outils déterministes + CTA (humain dans la boucle)

### 4.1 Adresse BAN à la saisie (`BanAddressInput`)

- **Composant partagé** `src/apps/artisan/components/shared/BanAddressInput.jsx` (même famille que
  `SearchBar`), monté dans `ClientModalTabs` (onglet Info) et dans la section adresse de `LeadModal`.
  Appels BAN via `geocoding.service.js` (une fonction `suggestAddresses` ajoutée à côté de
  `geocodeAddress`), pas de fetch dans le composant.
- Saisie → suggestions BAN (`/search/?q=…&limit=5&autocomplete=1`, `postcode` si déjà connu).
  Sélection → remplit `address` (numéro + voie), `postal_code`, `city`, **et** `latitude`/`longitude`
  + `address_precision` (`housenumber` | `street` | `locality` | `municipality`).
- **Adresse introuvable** : l'utilisateur garde son texte libre, mais doit choisir la **commune**
  (recherche `type=municipality` par code postal / ville) → coordonnées = centroïde, précision
  `municipality`. Résultat : **tout client créé ou modifié a des coordonnées à l'enregistrement**,
  précision ≥ commune.
- Pas de bouton « géocoder » : la validation est dans le geste de saisie.

**DB (migration)** :
- `majordhome.clients.address_precision text` + `majordhome.leads.address_precision text`, nullables,
  CHECK sur les 4 valeurs. NULL = géocodé par l'ancien chemin (précision inconnue).
- **Trigger `reset_geocode_on_address_change` corrigé** : ne remettre `latitude/longitude/geocoded_at`
  à NULL que si l'UPDATE ne fournit **pas** de nouvelles coordonnées
  (`NEW.latitude IS NOT DISTINCT FROM OLD.latitude AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude`).
  Sans ça, l'UPDATE « adresse BAN + coordonnées » se fait effacer ses coordonnées par le trigger —
  échec silencieux garanti. Vérification rejouable dans la migration (UPDATE de test en transaction
  annulée, ou test SQL commenté avec le résultat attendu).
- Vues `majordhome_clients` / `majordhome_leads` : colonne ajoutée **en fin de liste** (gotcha
  `CREATE OR REPLACE VIEW`).
- `ClientModal` : si les coordonnées BAN sont présentes au save, **ne pas** relancer
  `geocodeAndUpdateByProjectId` (sinon double géocodage et risque d'écraser une précision meilleure
  par une moins bonne).

**Balayage (`geocode-sweep`)** : ajouter l'étage 2 — si `/search/` échoue (score < 0,3), tenter
`type=municipality&postcode=…` et enregistrer le centroïde avec `address_precision='municipality'`
au lieu de consommer une tentative. Les « 4 clients sans adresse localisée » se résorbent au prochain
passage. Un client vraiment sans commune reconnue reste en échec compté, comme aujourd'hui.

### 4.2 Compétences techniciens

- `majordhome.team_members.skills text[] NOT NULL DEFAULT '{}'` — valeurs = catégories d'équipement
  (`climatisation`, `poele`, `pac_air_air`, `pac_air_eau`, `chaudiere_gaz`, `chaudiere_fioul`,
  `chaudiere_bois`, `chaudiere_granules`, `autre`), CHECK `skills <@ (liste)`.
- **Sémantique** : `'{}'` = **polyvalent** (aucune restriction). Choisi pour ne rien casser au déploiement
  (les propositions continuent) ; la restriction « seul Antoine fait la clim » se pose en renseignant
  les compétences de **chaque** technicien dans Settings → Équipe (chips, mention « non renseigné =
  polyvalent »). RPC d'écriture `team_member_set_routing_settings` étendue d'un paramètre `p_skills`
  (org_admin only, REVOKE PUBLIC/anon).
- **Règle d'éligibilité** : catégories des équipements du contrat ⊆ `skills` du technicien (ou skills
  vide). Contrat multi-équipements dont aucun technicien ne couvre tout → aucun éligible, motif
  `competence` remonté explicitement (pas de proposition « à moitié »).
- Hypothèse à confirmer par Eric : la compétence est bien **par technicien × catégorie d'équipement**
  (pas par client, ni par secteur).

### 4.3 `proposerPourContrat` — module pur

`src/lib/tournee/proposer-contrat.js` (aucun import React/Supabase, testé
`scripts/tournee/proposer-contrat.test.mjs`).

Entrée : `{ contrat: { id, dureeMinutes, lat, lng, categories[] }, journees: Journee[] (déjà chargées,
une par technicien × date, avec rdvs coordonnés), techniciens: [{ id, skills[], daily_work_minutes,
default_availability }], depot, reglages, contraintes?, trajet }` où `trajet(a, b)` est la fonction de
temps de trajet (matrice chargée en amont, `estime` propagé).

Sortie :
```
{
  creneaux: [ { date, technicianId, debutMinutes, finMinutes, coutMinutes,
                trajetAvantMin, trajetApresMin, avant: {id, label, finMinutes}|null,
                apres: {id, label, debutMinutes}|null, estime } ],   // triés par coût, max N
  nouvellesJournees: [ { date, technicianId } ],   // journées vides proposables si aucun créneau
  raisonsRejet: { competence, creneau, budget, pause, horizon, position },
  techniciensEligibles: [ids ]
}
```

Règles :
1. Techniciens éligibles = `include_in_routing` ∧ compétence (4.2) ∧ contrainte `technicianId` si fournie.
2. Journées candidates = pour chaque technicien éligible, les journées de l'horizon **ferme**
   (`horizon_ferme_jours`, vides ou amorcées) + au-delà, **seulement les journées déjà amorcées**
   (même règle que l'onglet Tournées) ; journées « complètes » (budget atteint) écartées ; contraintes
   `dateFrom/dateTo`, `periode` (matin/après-midi), `joursExclus` appliquées.
3. Pour chaque journée : `construireArretsExistants` → `placerCandidat` (un seul candidat) → coût.
4. Classement global par `coutMinutes` croissant, puis date croissante ; on garde `maxResults` (4).
5. **Aucun créneau** → `nouvellesJournees` = premières journées **sans RDV** d'un technicien éligible,
   dans ses jours ouvrés (`default_availability`), jusqu'à `horizon_ouverture_jours` (nouveau réglage
   `settings.tournees`, défaut 45). C'est le « ouvrir une nouvelle date » : signalé **distinctement**,
   jamais mélangé aux créneaux dans une tournée existante.
6. Chaque créneau porte de quoi s'**expliquer** (avant/après, trajets) : l'UI et l'agent l'affichent,
   personne ne recalcule.

### 4.4 Edge function `slots-propose`

- `verify_jwt:true` + `requireOrgMembership(req)` ; `supabase/config.toml` mis à jour.
- Body : `{ contract_id, constraints?: { technician_id?, date_from?, date_to?, periode?, jours_exclus? },
  max_results? (défaut 4) }`. Org = celle de la membership ; **jamais** d'`org_id` dans le payload.
- Étapes : contrat + équipements (durée via `dureeContrat` + fallbacks `construireFallbacks`) ;
  client → coordonnées (si absentes → `error: 'client_non_localise'`, jamais « aucun créneau ») ;
  techniciens ; journées (même requêtes que `getJourneesHorizon`, réécrites côté Deno avec filtre
  `org_id` explicite) ; matrice Mapbox avec token **serveur** (`MDH_MAPBOX_TOKEN`, nouveau secret) +
  `travel_cache` (GRANT service_role déjà en place) ; `proposerPourContrat`.
- Sortie = celle du module pur, enrichie des libellés (nom technicien, client avant/après, heures
  `HH:MM`) + `estime` global. `estime:true` signifie qu'au moins un trajet est à vol d'oiseau — l'UI
  l'affiche (« trajets estimés »), jamais masqué.
- **Modules purs en Deno** : script `scripts/sync-tournee-engine.mjs` copie `src/lib/tournee/*.js` +
  `sectorClustering.js` vers `supabase/functions/_shared/tournee/` ; un test (`node --test`) échoue si
  les copies divergent de la source. Ajouté à `npm run audit:quality`. Source unique = `src/lib`.
- Erreurs typées, jamais absorbées : `siege_non_configure`, `client_non_localise`, `aucun_technicien`
  (avec motif `competence`), `mapbox_indisponible` (→ `estime:true`, pas une erreur).

### 4.5 CTA « Trouver le créneau optimisé »

- Dans `ContractModal` (contrat d'entretien actif, carte `a_planifier` ou contrat dû sans carte) —
  c'est là que la planification se fait déjà. Bouton → `tourneesService.proposerPourContrat(...)`
  (appel de l'edge) → panneau `CreneauxProposes` : 4 cartes (date, technicien avec sa couleur, heure,
  « +N min de trajet », « entre X (Gaillac) et Y (Lisle) »), bloc « ouvrir une journée » si
  `nouvellesJournees`, motifs de rejet lisibles si rien.
- Clic sur un créneau → **chemin de pose existant** (`ensureEntretienCard` + `scheduleEntretien`,
  extrait de `useJourneePose` dans un helper partagé pour ne pas dupliquer) → toast, invalidation
  planning/kanban/tournées → SMS de confirmation via `sms-send` (campagne RDV existante), seulement
  si le client a un mobile (`isMobileFR`).
- Sans LLM. Latence attendue : quelques secondes au premier appel (matrice), puis cache.

### 4.6 Critères de succès (tranche 1)

1. `node --test scripts/tournee/*.test.mjs` vert, dont `proposer-contrat.test.mjs` (cas : clim → seul
   le technicien compétent ; Castres → journée la plus proche en coût, pas en date ; aucun créneau →
   `nouvellesJournees` non vide ; contrainte `periode` respectée ; `estime` propagé).
2. `slots-propose` appelée sur un contrat réel de Castres renvoie 4 créneaux cohérents avec l'onglet
   Tournées (mêmes journées exploitables, coûts du même ordre).
3. Depuis `ContractModal`, un clic pose le RDV : visible dans Planning, carte `planifie` au kanban,
   SMS parti (log `sms_logs`).
4. Un client créé avec une adresse BAN a `latitude/longitude` **non NULL à l'enregistrement**, et un
   client créé avec une adresse introuvable + commune choisie a `address_precision='municipality'`.
5. Après un passage de `geocode-sweep`, les clients « sans adresse localisée » qui ont un code postal
   valide sont localisés en `municipality`.

## 5. Tranche 2 — la pose côté serveur (pour débrancher l'humain)

- RPC `public.entretien_book_slot(p_contract_id, p_technician_id, p_date, p_start, p_duration_minutes)`
  SECURITY DEFINER, `SET search_path = majordhome, public`, `REVOKE FROM PUBLIC, anon`, org dérivée
  du contrat + membership `auth.uid()` (garde **positive** : `IF (autorisé) IS NOT TRUE THEN refuser`).
  Fait en une transaction ce que `ensureEntretienCard` + `scheduleEntretien` font en 3 appels : carte
  si absente, RDV + liaison technicien + snapshot grand secteur, `workflow_status='planifie'`,
  confirmation brouillon Web. Retourne `{ appointment_id, intervention_id }`.
- `savService.scheduleEntretien` devient un **appelant** de cette RPC (le « single writer » descend en
  base ; kanban, ContractModal, Tournées et le CTA passent tous par là). Refacto à part, avec ses tests.
- Variante service_role pour les machines (MCP) : même RPC, membership vérifiée par le serveur MCP
  en amont (token d'org), org passée explicitement **uniquement** dans cette variante, `REVOKE
  authenticated` dessus.
- `identify_client(phone)` : recherche par `formatPhoneForSearch` sur `clients` (+ contrats actifs,
  dernier entretien, cartes ouvertes) — lecture seule, org-scopée.

## 6. Tranche 3 — Hermes / MCP (hors périmètre de ce plan, contrat d'outils figé ici)

Serveur MCP Majord'home (edge, transport HTTP, 1 token par org haché dans
`core.organizations.settings.hermes`, org dérivée du token) exposant :

| Outil | Opération sous-jacente | Écrit ? |
|---|---|---|
| `identify_client` | 5 (recherche par téléphone) | non |
| `propose_slots` | 4.4 `slots-propose` | non |
| `book_slot` | 5 `entretien_book_slot` | **oui** (V1 : appelé seulement après validation humaine) |
| `notify_client` | `sms-send` | oui |

Hermes (profil `majordhome`, cf. mémoire `project_hermes_kvm2_instance`) consomme ce serveur via
`mcp_servers` ; canal principal = Majord'home (edge `hermes-ask` → serveur API Hermes), vocal via
`transcribe-dictation`, téléphone via Vapi sur le même serveur MCP. Un CTA au résultat déterministe
n'appelle jamais le LLM ; Hermes intervient quand il y a du langage à interpréter.

## 7. Hors périmètre / non-décisions

- Pas de réordonnancement des RDV posés (arbitrage Tournées 2026-08-29 : un candidat ne se glisse que
  dans un trou existant).
- Pas de multi-technicien par entretien.
- Pas de modification de la grille des durées (`pricing_equipment_types`).
- `settings.tournees` reste non éditable dans `/settings` (dette connue, à traiter dans son propre
  passage) ; le nouveau réglage `horizon_ouverture_jours` naît avec un défaut et suit ce passage.
- Renommage du profil Hermes `majordhome` → `mayer` : geste séparé, sans lien avec ce plan.

## 8. Risques

- **Trigger de géocodage** (4.1) : c'est le piège n°1 ; le test rejouable est obligatoire.
- **Divergence des copies Deno** du moteur : couverte par le test de synchronisation.
- **Quota Mapbox Matrix** : ~2 appels par journée candidate au premier calcul, cache ensuite ;
  surveiller `travel_cache` (taille) et le compteur Mapbox le premier mois.
- **`'{}' = polyvalent`** : tant que les compétences ne sont pas renseignées, Ludovic sera proposé pour
  une clim. À faire dans Settings → Équipe le jour du déploiement (checklist du plan).
