# Optimisation des tournées d'entretien — Design

> Date : 2026-08-29 · Interlocuteur : Eric Pudebat · Org pilote : Mayer Énergie
> Statut : design validé, plan d'implémentation à écrire

## 1. Problème

416 contrats d'entretien actifs, en croissance (cible annoncée : 800). L'entretien est
l'activité de **remplissage** : les installations sont programmées un mois à l'avance
(commande matériel), et les entretiens complètent les creux du planning.

Aujourd'hui le remplissage est manuel. Trois besoins :

1. **Back-office** — sur une journée creuse, placer 4-5 entretiens géographiquement cohérents.
2. **Web** — laisser le client choisir sa date sur `mayer-energie.fr`.
3. **Mail** — un cycle mensuel qui propose des créneaux aux clients dont l'entretien est dû.

Les briques 2 et 3 sont deux robinets sur le même réservoir. Le socle est commun ;
c'est lui qui porte toute la difficulté.

## 2. Mesures de départ (base de production, 2026-08-29)

| Mesure | Valeur |
|---|---|
| Contrats actifs | 416 |
| Clients sous contrat géocodés | 412 / 416 (99 %) |
| Équipements sous contrat | 592 |
| Équipements typés (`equipment_type_id`) | 481 / 592 (81 %) |
| Contrats à 1 seul équipement | 456 / 517 (88 %) — 517 = contrats porteurs d'équipements, tous statuts |
| Contrats avec `start_date` | 414 / 416 |
| Contrats avec `renewal_date` | 0 / 416 (colonne morte) |
| Anniversaires (`start_date`) en nov→mars | 136 / 414 (33 %) |
| Visites de maintenance historisées | 1553, toutes datées |
| Techniciens dans l'optimisation | 2 (Antoine Verloo, Ludovic Robert) |

**Charge annuelle dérivée du parc** : ≈ 885 h d'intervention, dont **753 h de combustion**
(préférence saisonnière, cf. 3.3) et 141 h de non-combustion (indifférentes à la saison).

**Occupation d'avril à octobre, à 2 techniciens** : ≈ 45 % de la capacité
(hypothèses : 138 jours effectifs par technicien sur la période, 6 h d'intervention utile
par jour de tournée). Le plafond praticable à 2 techniciens est de ~460 contrats en
allouant la moitié de la saison à l'entretien. **La cible de 800 contrats suppose un
3ᵉ technicien** (61 % d'occupation) : à 2, elle consommerait 91 % de la saison.

Ces chiffres décrivent le cas où la préférence saisonnière est respectée intégralement.
La combustion restant **possible** en période de chauffe (cf. 3.3), l'hiver constitue une
soupape qui repousse ces plafonds — au prix du confort client. Le back-office affiche
l'occupation pour rendre cet arbitrage visible plutôt que subi.

**Gain attendu du module** : une tournée groupée fait ~1 h 25 de route contre ~2 h 30
dispersée, soit **≈ 1 h par jour de tournée**. Sur 126 jours-technicien annuels :
~125 h récupérées, soit ~69 contrats absorbables sans embauche.

## 3. Décisions structurantes

### 3.1 Le critère est le coût d'insertion, pas l'appartenance à un secteur

Le clustering existant (`src/lib/sectorClustering.js`, grands secteurs à 15 km) reste utilisé
par l'onglet Programmation, mais **n'entre pas dans le moteur**. Un cluster est une boîte
absolue : deux clients distants d'une minute peuvent tomber de part et d'autre d'une frontière
et ne jamais se « voir ».

Le moteur raisonne en relatif :

> Combien de minutes ce client ajoute-t-il à la journée du technicien si je l'insère
> dans sa tournée ?

Un client à 20 min du dépôt mais sur la route entre deux arrêts coûte 0 minute. Un client à
5 min dans la direction opposée en coûte 10. Aucune frontière, aucune zone nommée.

### 3.2 Une journée de tournée naît de son premier RDV

Rien n'est déclaré à l'avance. Une journée devient « journée d'entretien » parce qu'un
entretien y est posé — par le back-office, par le web, ou par un client qui appelle.
Ce mécanisme unique couvre les trois horizons :

| Horizon | Ce que le système propose | Justification |
|---|---|---|
| 0–15 jours | Tous les trous réels du planning | Les poses sont connues, le vide est du vrai vide |
| > 15 jours | Uniquement les journées contenant déjà un entretien | Ne crée aucune contrainte nouvelle sur la pose |
| Demande client | Le RDV demandé ouvre la journée | La demande devient une graine à compléter |

Une journée-graine à un seul RDV n'est pas une anomalie : c'est une opportunité de
remplissage, surveillée par le back-office (cf. 7.A).

### 3.3 Deux préférences continues, aucune interdiction

Deux règles métier se superposent :

- Le ramonage veut un **appareil froid** → hors période de chauffe (idéalement avril→octobre).
  **Ce n'est pas une interdiction** : c'est faisable en période de chauffe si le client
  n'allume pas la veille.
- L'entretien se fait **autour de la date anniversaire, ± 2 mois**.

33 % des contrats ont leur anniversaire en nov→mars. Traiter la saison comme une interdiction
rendrait leur fenêtre vide et imposerait un mécanisme d'élargissement à cas particuliers.

**Résolution : deux pénalités continues, pas une intersection d'ensembles.** Le score
d'éligibilité d'un contrat à une date combine :

- la **maturité** — plus on s'éloigne de l'anniversaire, plus le score baisse ; ± 2 mois est
  le plateau, au-delà la décroissance est progressive, jamais un mur ;
- la **saison** — un mois défavorable pour ce type d'équipement pénalise fortement, sans annuler.

Un contrat de poêle dont l'anniversaire tombe en janvier obtient ainsi ses meilleurs scores
en **octobre et avril** : l'équilibre entre les deux pénalités se fait seul, sans règle
d'exception. Et si la journée du 12 janvier a besoin d'un quatrième arrêt et que ce contrat
est le seul à trois minutes, il reste proposable — c'est exactement ce que « possible mais
pas idéal » veut dire.

**Trois niveaux d'exposition** découlent de cette nuance :

| Canal | Mois défavorables |
|---|---|
| Proposition automatique (mail, web, suggestions back-office) | jamais proposés spontanément |
| Choix libre du client (« une autre date ») | accessibles, avec la consigne « n'allumez pas l'appareil la veille » |
| Back-office | aucune restriction, l'humain décide |

La consigne « appareil froid » doit figurer dans la confirmation et dans le SMS de la veille
dès qu'un entretien de combustion est planifié en période de chauffe.

La contrainte saisonnière ne concerne que la combustion (~493 équipements). Les PAC, gainables
et ballons thermodynamiques (~90 équipements, 141 h) sont faisables toute l'année.
**Le moteur doit activement les pousser vers l'hiver** : les laisser au printemps les ferait
concurrencer les 493 équipements de combustion qui n'ont que sept mois pour passer, alors que
novembre→mars est structurellement creux en entretien (et chargé en installation).

Mécanisme concret : le score d'éligibilité d'un contrat **sans** contrainte saisonnière est
majoré sur les mois où la pression de la combustion est nulle (nov→mars) et minoré d'avril à
octobre. Un contrat non contraint reste proposable toute l'année — c'est un poids dans le
classement des candidats, jamais un filtre.

### 3.4 On ne paramètre jamais un nombre d'entretiens, on paramètre un temps

« 4-5 entretiens par jour » est une conséquence, pas une règle. Trois chaudières granulés
font 7 h 30 d'intervention seule : la journée est pleine à 3. Cinq poêles à bois font 5 h :
elle passe à 5. La contrainte est le **budget horaire**.

Deux bornes distinctes, toutes deux nécessaires :

- **Amplitude** (`team_members.default_availability`, existant) — *où* placer un RDV.
  Aujourd'hui 8 h – 18 h.
- **Budget de travail** (`team_members.daily_work_minutes`, nouveau, défaut 480) — *combien*
  charger. Sans lui, le moteur remplirait 9 h 30 dans une amplitude de 10 h.

### 3.5 Le client choisit un jour, le système attribue le rang

Le client **ne choisit pas son rang de passage** — sinon tous réclament le premier et la
géographie ne décide plus rien. Il choisit un jour ; le moteur calcule sa position et lui
annonce : « 2ᵉ passage, vers 10 h 30 (entre 10 h et 11 h 30) ; un SMS vous précisera l'heure
la veille ».

Contrepartie : **la fenêtre annoncée est engagée**. Le séquencement final peut réordonner la
tournée, mais uniquement parmi les ordres qui respectent toutes les fenêtres promises.
Le SMS de la veille resserre l'horaire (canal `rappel_entretien` existant, contenu à adapter).

### 3.6 Le mail est un cycle, pas une chance unique

Le mail mensuel contient :

1. Les créneaux **réels des 15 prochains jours**, cliquables.
2. « Une autre date vous arrange ? » — ouverte aux jours travaillés, **y compris en période
   de chauffe** (cf. 3.3) : un client qui veut son ramonage en janvier peut le demander,
   il reçoit la consigne « n'allumez pas l'appareil la veille ». On ne propose pas ces mois
   spontanément, on ne les interdit pas au client qui les choisit.
3. **Une phrase explicite** : d'autres dates seront proposées le mois prochain.

Sans le point 3, le client qui ne trouve pas son bonheur croit avoir raté son tour et
n'ouvre plus les mails suivants. Cadence : **une relance par mois maximum** et par contrat,
tant que la fenêtre reste ouverte — compteur en base.

### 3.7 La garantie « tout le monde a son entretien » n'est pas dans le mail

Le mail ne garantit rien : un client qui ne clique jamais n'existe pas pour lui.
La garantie est une **liste back-office des contrats en fin de fenêtre sans RDV**.
Un contrat sort de son année par une réservation ou par un humain qui le rattrape, jamais
en silence.

Cette liste est produite dans un format directement consommable par le **moteur d'appels
sortants** existant (`PhoningPanel`, `call_sessions`, colonne kanban `a_planifier`), livré en
mock. Le branchement effectif est hors scope.

## 4. Architecture

### 4.1 Moteur pur — `src/lib/tournee/`

Fichiers JavaScript purs : **aucun import** (ni React, ni Supabase, ni alias `@/`), donc
exécutables tels quels par Node, Vite **et Deno**. Même discipline que `pvEngine` et
`thermalEngine`. Tests : `node --test scripts/tournee/*.test.mjs`.

| Module | Responsabilité |
|---|---|
| `duree.js` | `base + max(0, unit_count − included_units) × perUnit`, sommé sur les équipements du contrat |
| `eligibilite.js` | Fenêtre `(anniversaire ± 2 mois) ∩ mois favorables`, avec élargissement ; score de maturité |
| `sequence.js` | Ordonne dépôt → n arrêts → dépôt sous budget, amplitude, pause et fenêtres promises |
| `insertion.js` | `coutInsertion(tournée, candidat)` → minutes ajoutées, ou `null` si infaisable |

`sequence.js` énumère **toutes** les permutations jusqu'à 8 arrêts (40 320 cas, quelques
millisecondes) : l'ordre retourné est l'optimum exact, pas une heuristique. Repli
plus-proche-voisin + 2-opt au-delà de 8 arrêts, chemin qui ne devrait jamais s'exécuter avec
4-5 RDV par jour.

La pause méridienne est modélisée comme un **arrêt fictif de 30 min à fenêtre [12 h, 14 h]**.
Une fenêtre promise à un client est un objet de même nature. Le séquenceur ne connaît qu'un
seul concept : un arrêt, avec une fenêtre optionnelle.

Le moteur est importé **directement** par le front (back-office, sans réseau) et **injecté
dans le bundle** des edge functions au déploiement (web, cron). Une seule source en git,
une seule suite de tests. Ce choix évite de reproduire la dette connue du seuil pipeline
500 € HT, qui vit aujourd'hui en trois copies.

### 4.2 Distances — le cache est une condition de fonctionnement

Deux étages :

1. **Haversine** (gratuit, instantané) : filtre les candidats à ≤ 25 km du barycentre de la
   tournée. Fait passer de 416 contrats à ~25 candidats.
2. **Mapbox Matrix** sur les survivants. Pattern déjà en place dans
   `useMapZones.js` (batch de 23 coordonnées, plafond Mapbox à 25).

Le quota gratuit Mapbox est de **100 000 éléments/mois** ; une matrice « tournée × candidats »
en consomme ~200, soit ~500 calculs mensuels. Insuffisant dès qu'on recalcule plusieurs fois
par jour sur plusieurs techniciens et 15 jours d'horizon.

**Le cache `majordhome.travel_cache` n'est donc pas une optimisation mais une condition** :
clés = coordonnées arrondies à ~100 m, TTL long (les routes ne bougent pas). Le parc client
étant stable, le cache converge en quelques semaines et Mapbox n'est plus sollicité que pour
les nouveaux clients.

### 4.3 L'invariant anti-double-réservation vit en base

Le moteur propose finement mais ne peut pas être atomique. La RPC de réservation
`entretien_reserver_creneau` prend un `pg_advisory_xact_lock(hash(technicien, date))`,
recompte la charge du jour et refuse si le budget est dépassé. C'est un garde-fou grossier
— il ignore les trajets — mais **atomique** : deux clients qui cliquent sur la dernière place
à la même seconde, un seul passe.

Division du travail : **le moteur propose, la base garantit.**

## 5. Modèle de données

```
majordhome.pricing_equipment_types
  + duration_base_minutes            int        NULL
  + duration_per_extra_unit_minutes  int        NOT NULL DEFAULT 0
  + unfavorable_months               smallint[] NOT NULL DEFAULT '{}'

majordhome.team_members
  + daily_work_minutes               int        NOT NULL DEFAULT 480
  + include_in_routing               boolean    NOT NULL DEFAULT true

majordhome.travel_cache              (nouvelle)
  org_id, from_key, to_key, minutes, km, computed_at
  PK (org_id, from_key, to_key) ; keys = lat/lng arrondis à 3 décimales

majordhome.entretien_booking_tokens  (nouvelle)
  id, org_id, contract_id, token_hash, created_at, expires_at, used_at
  Le token en clair n'est jamais stocké (hash uniquement), le lien est à usage unique.

majordhome.contracts
  + relance_count                    int         NOT NULL DEFAULT 0
  + last_relance_at                  timestamptz NULL
```

**Choix assumé : la durée vit dans `pricing_equipment_types`.** Le nom dit « pricing », ce qui
est trompeur, mais c'est le **seul référentiel de types d'équipement par organisation**, déjà
éditable dans `/settings/pricing`. Créer une table « durées » à côté donnerait deux référentiels
à tenir en phase, et le jour où un type est ajouté dans l'un sans l'autre, le moteur planifie
une durée nulle **en silence**. Un nom imparfait vaut mieux qu'un référentiel dédoublé.
L'onglet sera renommé « Types d'équipement » (prix **et** durée).

`renewal_date` (0/416) reste inutilisée ; l'anniversaire est `start_date`.

Contraintes multi-tenant respectées : `travel_cache` et `entretien_booking_tokens` portent
`org_id NOT NULL`, RLS activée dès la création, policies scopées `org_id`, vues publiques
`majordhome_*` en `security_invoker=true` avec `GRANT SELECT … TO service_role`.
Les RPC nouvelles sont `SECURITY DEFINER` avec `REVOKE EXECUTE FROM PUBLIC, anon`
immédiat, et gardes en autorisation positive (`IF (autorisé) IS NOT TRUE THEN refuser`).

## 6. Paramétrage (multi-tenant)

Aucune constante Mayer dans le code. Tout est per-org et éditable dans `/settings` :

| Paramètre | Emplacement | Écran |
|---|---|---|
| Durée base / par unité, mois défavorables | `pricing_equipment_types` (org_id) | `/settings/pricing` → Types d'équipement |
| Budget journalier, inclusion dans les tournées | `team_members` (org_id) | `/settings/team` |
| Amplitude horaire | `team_members.default_availability` (existant) | `/settings/team` |
| Point de départ / retour | `settings.territoire_centers[0]` via `getOrgHeadquarters()` | `/settings/organization` → Territoire |
| Réglages du moteur | `settings.tournees` (nouveau bloc) | `/settings/organization` |

Bloc `settings.tournees`, avec ses défauts :

```jsonc
{
  "horizon_ferme_jours": 15,      // au-delà, seules les journées déjà amorcées
  "tolerance_anniversaire_mois": 2,
  "pause_minutes": 30,
  "pause_fenetre": [12, 14],      // heures locales
  "rayon_filtre_km": 25,          // étage haversine avant Mapbox
  "fenetre_promise_minutes": 90,  // largeur annoncée au client
  "mois_creux": [11, 12, 1, 2, 3] // mois vides en entretien : les types sans
                                  // contrainte de saison y sont bonifiés (§3.3)
}
```

Seed Mayer (migration) :

| Code | Base (min) | + / unité | Mois défavorables |
|---|---|---|---|
| `poele_granules_elec` | 90 | — | 11,12,1,2,3 |
| `poele_bois_insert` | 60 | — | 11,12,1,2,3 |
| `pac_air_air` | 60 | 30 (`split`) | — |
| `chaudiere_granules` | 150 | — | 11,12,1,2,3 |
| `pac_air_eau` | 90 | — | — |
| `gainable` | 90 | — | — |
| `ballon_thermo` | 90 | — | — |
| `chaudiere_bois` | 150 | — | 11,12,1,2,3 |
| `poele_granules_sans_elec` | 90 | — | 11,12,1,2,3 |
| `poele_hydro` | 150 | — | 11,12,1,2,3 |
| `chauffe_eau_solaire` | 90 | — | — |
| `panneau_photovoltaique` | 90 (à confirmer, 1 seul sous contrat) | — | — |
| `TRAV_ELEC`, `prestation_diverses` | NULL (non entretien) | — | — |

**Fallback de durée** (111 équipements sous contrat non typés, dont 87 poêles) :
durée du **type dominant de la même catégorie** (`poele` → 90, `chaudiere_bois` → 150),
et 90 min quand la catégorie elle-même est inconnue. Un fallback uniforme à 90 min
sous-estimerait les 9 chaudières bois d'une heure et ferait déborder leur journée.
Un compteur « N équipements à typer » est affiché en back-office : exclure 19 % du parc
en silence serait le pire des comportements.

## 7. Les surfaces

### A. Back-office — onglet « Tournées » (Entretiens)

Les 15 prochains jours × techniciens inclus, avec leur taux de remplissage. Clic sur une
journée creuse → le moteur classe les contrats dus par coût d'insertion croissant → sélection →
`appointmentsService.createAppointmentBatch()`.

Affiche également :
- les **journées sous-remplies qui approchent** (« dans 5 jours : 1 RDV, 6 h 30 libres,
  12 candidats à moins de 15 min ») ;
- la **liste des retardataires** (fin de fenêtre sans RDV, cf. 3.7) ;
- le compteur d'équipements à typer.

C'est la seule surface qui a de la valeur seule : livrée sans le web ni le mail, elle résout
déjà le besoin de remplissage.

### B. Web client

Deux edge functions :
- `entretien-creneaux` — valide le token (ou la session du portail `/client`), retourne 3-5
  journées avec rang de passage et fenêtre horaire.
- `entretien-reserver` — confirme, via la RPC à advisory lock.

Le site vitrine (Next.js séparé, `C:\Dev\Landing Page - Mayer`) n'accède jamais à la base :
il appelle les edges. Le portail `/client` existant (auth Supabase, `invite-client`) consomme
les mêmes edges sans token.

Le lien du mail ne suppose **pas** de compte : un client qui prend RDV une fois par an ne
créera pas de mot de passe.

### C. Cron mensuel

`pg_cron` → edge `entretien-relance-mensuelle` → Resend. Cible : contrats dont la fenêtre
d'éligibilité s'ouvre sous 60 jours, sans RDV, et dont `last_relance_at` date de plus d'un
mois. Contenu conforme à 3.6.

## 8. Tranches de livraison

| Tranche | Contenu | Critère de succès vérifiable |
|---|---|---|
| **1** | Colonnes + seed + moteur pur + tests | `node --test scripts/tournee/*.test.mjs` vert ; aucune UI |
| **2** | Onglet Tournées back-office | Une journée réelle remplie de bout en bout |
| **3** | Tokens + edges + réservation web | Un client réserve depuis un lien |
| **4** | Cron mail mensuel | Une campagne part, les relances sont comptées |

Chaque tranche est livrable seule. La tranche 2 suffit à rentabiliser le module.

## 9. Hors scope

- Branchement effectif du moteur d'appels sortants (la liste est produite, pas consommée).
- Optimisation des tournées d'installation (seuls les entretiens sont concernés).
- Réaffectation automatique en cas d'absence technicien.
- Sous-traitance : Mohammed est exclu de l'optimisation (`include_in_routing = false`),
  capacité d'appoint ponctuelle organisée hors outil.
- Rapatriement du seuil pipeline 500 € HT dans le moteur partagé (rendu possible, pas fait).

## 10. Risques et garde-fous

| Risque | Garde-fou |
|---|---|
| Durée fausse sur équipement non typé → journée qui déborde | Fallback par catégorie dominante + compteur visible |
| Quota Mapbox épuisé → moteur muet | Cache `travel_cache` obligatoire ; échec Mapbox = repli haversine + mention explicite à l'écran |
| Double réservation du dernier créneau | Advisory lock en base, indépendant du moteur |
| Client oublié (jamais relancé, jamais rattrapé) | Liste retardataires en back-office ; un contrat ne sort jamais en silence |
| Fenêtre promise non tenue après réordonnancement | Les fenêtres engagées sont une contrainte du séquenceur, pas une préférence |
| Journée-graine restée à 1 RDV | Alerte « journées sous-remplies qui approchent » |
| Saturation avril-octobre à mesure que le parc grandit | Occupation affichée en back-office ; ~460 contrats de plafond à 2 techniciens ; la période de chauffe reste une soupape |
| Combustion planifiée en période de chauffe, appareil encore chaud à l'arrivée → visite perdue | Consigne « n'allumez pas la veille » dans la confirmation **et** dans le SMS de la veille, déclenchée automatiquement quand le type est en mois défavorable |
