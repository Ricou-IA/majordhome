# Module Tournées — moteur d'entretien, souplesse des RDV, journée pleine

> Déporté de CLAUDE.md (2026-09-12). Pointeur + règles qui mordent : CLAUDE.md § Module Tournées.
> Specs : `docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md` (tranche 1),
> `…/2026-09-12-tournees-fenetres-et-consolidation-design.md` (tranche 2),
> `…/2026-09-12-tournees-bloc-contrat-et-journee-pleine-design.md` (tranche 3).
> Livré en prod le 2026-09-12 (module Tournées initial : 2026-08-29).

## Ce que ça fait

Deux questions, un seul moteur :
- **Journée → clients** (onglet Entretiens → Tournées, « remplir une journée ») : pour une journée d'un technicien, quels contrats dus insérer, dans quel ordre, à quel coût de trajet.
- **Contrat → créneaux** (CTA « Trouver le créneau optimisé » dans la fiche contrat, edge `slots-propose`) : pour ce contrat, quelles journées existantes l'accueillent au meilleur coût, sinon quelles journées vides ouvrir. C'est l'outil « machine-usable » qu'Hermes consommera (serveur MCP, tranche suivante).

Et par-dessus, la **souplesse** : chaque entretien/SAV a une tolérance de déplacement ; le moteur peut glisser un voisin pour faire rentrer un client ; une **journée pleine se fige toute seule** (heures définitives) ; l'humain n'arbitre que ce que le moteur ne sait pas tenir.

## Le moteur (`src/lib/tournee/`, modules PURS)

Aucun import React / Supabase / alias Vite. Testés par `node --test "scripts/tournee/*.test.mjs"` (`purete.test.mjs` vérifie l'absence d'import interdit). **Copiés** dans `supabase/functions/_shared/tournee/` par `npm run sync:tournee-engine` ; `scripts/tournee/sync-engine.test.mjs` (dans `audit:quality`) échoue dès qu'une copie diverge. **Ne jamais éditer les copies** ; après toute modification du moteur : sync + redéployer `slots-propose` et `tournees-figer`.

| Module | Rôle |
|---|---|
| `reglages.js` | `REGLAGES_DEFAUT` + `construireReglages(settings)` — **source unique** des réglages `settings.tournees` (voir tableau plus bas). |
| `duree.js` | `dureeEquipement` / `dureeContrat(équipements, types, fallbacks, { gainMultiPct })` : même mécanique que le prix (base + unités au-delà de `included_units`), gain multi-équipements dès 2 lignes, fallback par catégorie = type dominant du parc. |
| `eligibilite.js` | Score d'un contrat à une date (anniversaire, saison, retard). `retardStatus` alimente l'alerte « retardataires ». |
| `geo.js` | `cleCoord` (3 décimales ≈ 100 m), haversine, filtre de proximité, barycentre. |
| `matrice.js` / `trajets-core.js` | Matrice de trajets : cache `majordhome_travel_cache` → Mapbox Matrix (`MDH_MAPBOX_TOKEN`) → repli vol d'oiseau **toujours signalé** (`estime: true`). `creerChargeurMatrice({ client, coreOrgId, token })` est injectable (navigateur et Deno). |
| `arrets.js` | RDV bruts → arrêts (`{ id, key, dureeMinutes, fenetre, tolerance, prevu }`). `toleranceDe` (souplesse **opt-in**), `construireArretsExistants`, `construireArretsPourConsolidation`, `minutesDepuisMinuit` / `minutesVersHeure`, `arrondirHeureFigee`, `TYPES_ADAPTABLES`. |
| `creneaux.js` | `placerCandidat` : insertion d'un candidat dans les créneaux libres d'une journée (coût = allée + travail + retour − trajet évité), `fenetreArrivee`, `trajetMaxMinutes`, `tenterDecalage` (glisse UN voisin adaptable). `classerParCreneaux` / `placerPlusieurs` pour l'onglet Tournées (refusent tout placement qui supposerait un voisin déplacé). |
| `sequence.js` | `sequencerTournee` : ordre + heures d'une journée dans les fenêtres, exact jusqu'à `MAX_ARRETS_EXACT`, heuristique plus-proche-voisin au-delà ; `figesSontDesFaits` ; `diagnostiquerJournee` (chiffres de la journée telle que posée quand rien ne tient). |
| `plein.js` | `evaluerRemplissage` (reste utile), `verdictJournee` (`sans_adaptable` / `non_pleine` / `figeable` / `a_arbitrer`) — même verdict pour le cron et le tableau de bord. |
| `proposer-contrat.js` | `techniciensEligibles`, `journeesCandidates`, `proposerPourContrat` (contrat → créneaux classés par score, `nouvellesJournees`, `raisonsRejet`). |
| `loaders.js` | `chargerJournees` / `chargerContrat` / `chargerDureesBareme` — chargement **injectable** (client supabase en paramètre), même code navigateur et edge. |
| `timeline.js` | Placement des RDV sur la barre horaire de l'onglet Tournées (segments, trous, `trajetDepuisPrecedent`, bornes d'un déplacement à la main). |

Côté app : `tournees.service.js` et `trajets.service.js` ne sont que des wrappers navigateur ; hooks `useTournees.js` (`useContratsDus`, `useJourneesHorizon`, `usePropositions`, `useDureeContrat`, `useDureeContratClient`, `useJourneesAArbitrer`), clés `tourneeKeys` (orgId en 1ᵉʳ).

## Données

- **Asymétrie d'org** : `contracts` / `clients` / `pricing_equipment_types` / `travel_cache` = org **core** (`3c68…`) ; `team_members` / `appointments` = org **majordhome** (`getMajordhomeOrgId`). Les loaders prennent les deux.
- **Techniciens** : `team_members.include_in_routing`, `default_availability` (amplitude du jour), `daily_work_minutes` (**budget** = temps d'homme de la journée, **trajets compris**, plafond), `specialties` (catégories d'équipement, **vide = polyvalent**). Édités dans Settings → Équipe.
- **Souplesse d'un RDV** (migrations `20260912_3` et `_4`) : `appointments.time_flex_minutes` (0 figé / 15 / 30 / 240 demi-journée, **NULL = défaut d'org**), `hour_confirmed_at` (heure communiquée ⇒ figé), `announced_start` (**ancre** de la tolérance : l'heure dite au client, posée à la création, ré-ancrée au drag). Seuls `maintenance` et `service` sont adaptables (`TYPES_ADAPTABLES`).
- **Adresse** : `clients.latitude/longitude` + `address_precision` (`BanAddressInput` à la saisie, RPC `client_set_location` ; `geocode-sweep` retombe à la commune, précision `municipality` suffisante).

### Réglages `core.organizations.settings.tournees` (Settings → Organisation → Tournées)

| Clé | Défaut | Sens |
|---|---|---|
| `souplesse_defaut_minutes` | 30 | tolérance d'un entretien/SAV sans souplesse renseignée |
| `reste_utile_min_minutes` | 75 | en dessous, le reste d'une journée est perdu (pénalisé) ; **seuil « journée pleine »** |
| `trajet_max_entre_clients_minutes` | 45 | au-delà, une insertion n'est pas raisonnable (dépôt exempté) → « ouvrir une nouvelle journée » |
| `gain_multi_equipements_pct` | 10 | le barème vaut pour des interventions isolées ; dès 2 équipements chez le même client, −10 % |
| `depassement_journee_minutes` | 30 | le moteur accepte budget + 30 min (le « fini-parti » est un plafond non atteint, rien à coder) |
| `pause_minutes` / `pause_fenetre` | 30 / [12, 14] | pause prise entre deux arrêts, à la première occasion dans sa fenêtre |
| `figer_journee_pleine` | true | figeage automatique des journées pleines (cron) |
| `figer_sms` | **false** | SMS « Heure de passage » au figeage (cron ET bouton) — OFF pour l'instant (Eric, 2026-09-12) |
| `horizon_ferme_jours` / `horizon_ouverture_jours` | 15 / 45 | journées vides proposables / cherchées pour « ouvrir une journée » |
| `demi_journee` | matin [8,12], après-midi [13,18] | fenêtres de la souplesse « demi-journée » |

⚠️ `org_update_settings` merge au niveau 1 : l'onglet renvoie l'objet `tournees` **complet**.

## Les règles

### Temps de travail = barème × gain, le bloc n'est qu'un dessin (R1)
Pour un Entretien rattaché à un contrat, `chargerJournees` **remplace** `duration_minutes` par la durée barème (intervention → contrat → équipements → types, `duration_minutes_saisie` garde la valeur en base). Les SAV et les RDV sans contrat gardent leur durée. Au figeage, `scheduled_end` et `duration_minutes` sont réécrits : le bloc suit. Si le barème est faux, on corrige le barème (Tarification → durées), pas le bloc.

### Pose à la main = bloc contrat (R5)
`DayResourceGrid` / `SchedulingAssistant` prennent `fixedDuration` : un clic pose le bloc entier à la durée du contrat (`useDureeContrat` / `useDureeContratClient`), plus d'étirement « à peu près ». Alimenté par `SchedulingTransitionModal` (kanban, fiche contrat) et `EventModal` (Entretien sur un client à contrat).

### Souplesse : opt-in, ancre annoncée, un seul voisin
- `toleranceDe(rdv, { souplesse: true, flexDefaut, amplitude, demiJournee })` : **sans `souplesse: true`, tolérance ponctuelle** quel que soit `time_flex_minutes`. Seul un appelant qui sait **écrire** les décalages la demande : `proposerPourContrat` (pose via `scheduleEntretien({ decalages })`) et la consolidation. Le remplissage de journée (onglet Tournées) reste ponctuel et refuse tout placement qui supposerait un voisin déplacé.
- La plage est ancrée sur `announced_start` (des décalages successifs restent dans « 14 h ± 30 »), l'heure courante est toujours dans sa plage, l'amplitude prime (un adaptable qui déborde est ramené dedans à la consolidation), un figé n'est jamais borné.
- `placerCandidat` glisse **au plus un** voisin adaptable (pousse le suivant / tire le précédent, sans casser le voisin du voisin). `scheduleEntretien` relit le voisin et le glisse **avant** la pose ; refus `decalage_refuse` (+ raison : `deplace`, `fige`, `souplesse_modifiee`, `introuvable`, `ecriture`) si son état a changé ; remis en place si la pose échoue. Une carte créée pour l'occasion redescend en « À planifier » si la pose échoue.
- Un **drag** dans le Planning ré-ancre `announced_start` sans figer ; **figer** est un geste explicite (SouplesseDialog à la pose, `SectionSouplesse` sur le RDV, « Figer la journée »).

### Journée pleine (R2) — figée toute seule, pas la veille
`reste utile = budget + dépassement − (travail barème + trajets réels)`. Pleine quand `reste utile < reste_utile_min_minutes` et qu'il reste ≥ 1 RDV adaptable. Edge **`tournees-figer`** (`verify_jwt:false` + `MDH_CRON_SECRET`, cron pg_cron `tournees-figer` `20 5-19 * * *` UTC, migration `20260912_5`) : pour chaque journée **à partir de demain** d'une org avec `majordhome_organizations` et `figer_journee_pleine ≠ false` — pré-filtre à vol d'oiseau, matrice Mapbox (cache), `verdictJournee`, puis RPC **`tournees_figer_journee(p_org_id, p_lignes)`** (SECURITY DEFINER, **service_role only**, tout ou rien si un RDV a bougé) → heures définitives au **5 min supérieur** (`arrondirHeureFigee`), 🔒, `announced_start`. SMS `heure_de_passage` seulement si `figer_sms` + SMS org actifs + gabarit. Body manuel : `{ dry_run, org_id, date }` ; le rapport atterrit dans `net._http_response` quand on l'appelle par `net.http_post` avec le secret du vault.
Décision Eric : « si c'est plein depuis 10 jours, pourquoi attendre ? » — **pas de figeage la veille**. Aujourd'hui n'est jamais figé par le cron (geste humain).

### La journée commence au dépôt
`simuler` part du dépôt à l'ouverture : le trajet vers le premier client compte. Le « départ anticipé » ne vaut que pour un RDV **figé** à l'ouverture (le client a exigé 8 h). Un adaptable posé à 8 h à 38 min du dépôt → à arbitrer, et le diagnostic nomme « dépôt (ouverture) → client ». Un figé atteint « en retard » selon nos estimations est un **fait** (`figesSontDesFaits`), pas un blocage (leçon du 31/08).

### Pleine mais impossible (R3) → tableau de bord de l'admin
`JourneesAArbitrer` (Dashboard, org_admin) liste les journées pleines que l'ordonnanceur ne sait pas tenir, avec le diagnostic (travail / trajets / budget / trajets qui ne tiennent pas, estimés à vol d'oiseau) ; clic → `/entretiens?tab=tournees&journee=YYYY-MM-DD&tech=<id>` ouvre la journée. Pas dans l'onglet Tournées (décision Eric).

### « Figer la journée » (bouton, onglet Tournées)
`useConsolidationJournee` : aperçu (heures avant → après, figés grisés, diagnostic chiffré si impossible), relecture de l'état avant d'écrire (rien n'a bougé depuis l'aperçu, sinon rien n'est écrit), arrêt au premier refus, SMS seulement si tout est écrit **et** `figer_sms`, clients sans mobile listés « à prévenir par téléphone ». Même formats SMS que le cron (`formatSmsDate` / `formatSmsHour` / `capitaliserPrenom`).

### Contrat → créneaux (CTA, edge `slots-propose`)
`verify_jwt:true` + `requireOrgMembership(req, { orgId })` (`org_id` du body vérifié par membership). Erreurs typées `siege_non_configure` / `client_non_localise` / `aucun_technicien` / `contrat_introuvable`. Horizon ferme = toute journée du technicien éligible ; au-delà, seules les journées amorcées ; aucun créneau raisonnable → `nouvellesJournees`. Classement = `scoreMinutes` = coût + temps perdu ; **présentation chronologique** ; l'écran montre trajet pour y aller / travail / reste utile, jamais le détour net ; « +N min » = temps d'homme total. Trajet max entre deux clients (45 min, dépôt exempté) → « ouvrir une nouvelle journée ».

## Gotchas
- **Deno type-check lit les JSDoc des `.js`** : une fonction sans `@param` typé (`arrets = []` → `never[]`, `coordsFallback = null` → `null`) casse `deno check` de l'edge. Documenter les signatures exportées du moteur.
- `import "jsr:@supabase/functions-js/edge-runtime.d.ts"` fait échouer `deno check` hors ligne (types `npm:openai`) : les edges du moteur s'en passent.
- `sequencerTournee` rapportait la raison de la **dernière permutation** essayée : arbitraire. Toujours lire `diagnostic` (journée telle que posée).
- Les heures du planning et du moteur peuvent différer avant figeage (bloc dessiné ≠ barème) : c'est voulu (R1).
- `reste utile` exclut la pause (le budget est du temps d'homme, comme `simuler`).
- L'arrondi au 5 min supérieur peut serrer de ≤ 4 min le trajet vers l'arrêt suivant : accepté.

## Vérifier
```bash
node --test "scripts/tournee/*.test.mjs" scripts/planning-events.test.mjs scripts/souplesse.test.mjs
npm run sync:tournee-engine && (cd supabase/functions && deno check slots-propose/index.ts tournees-figer/index.ts)
npx supabase functions deploy slots-propose --project-ref ejqqqwudmizqisdkxohw
npx supabase functions deploy tournees-figer --project-ref ejqqqwudmizqisdkxohw
```
Dry-run du cron (SQL, secret du vault) : `net.http_post(url := '…/functions/v1/tournees-figer', headers := …mdh_cron_secret…, body := '{"dry_run": true, "org_id": "<core>", "date": "YYYY-MM-DD"}')` puis `select content from net._http_response where id = <request_id>`.
