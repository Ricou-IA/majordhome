# Module Tournées — moteur d'entretien, souplesse des RDV, journée pleine

> Déporté de CLAUDE.md (2026-09-12). Pointeur + règles qui mordent : CLAUDE.md § Module Tournées.
> Specs : `docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md` (tranche 1),
> `…/2026-09-12-tournees-fenetres-et-consolidation-design.md` (tranche 2),
> `…/2026-09-12-tournees-bloc-contrat-et-journee-pleine-design.md` (tranche 3).
> Livré en prod le 2026-09-12 (module Tournées initial : 2026-08-29).

## Ce que ça fait

Deux questions, un seul moteur :
- **Journée → clients** (Planning → puce d'état de la journée, « remplir une journée » ; l'onglet Tournées de la page Entretiens a été supprimé le 2026-09-30, cf. § Ranger) : pour une journée d'un technicien, quels contrats dus insérer, dans quel ordre, à quel coût de trajet.
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
| `creneaux.js` | `placerCandidat` : insertion d'un candidat dans les créneaux libres d'une journée (coût = allée + travail + retour − trajet évité), `fenetreArrivee`, `trajetMaxMinutes`, `tenterDecalage` (glisse UN voisin adaptable). `classerParCreneaux` / `placerPlusieurs` pour le panneau de remplissage (refusent tout placement qui supposerait un voisin déplacé). |
| `sequence.js` | `sequencerTournee` : ordre + heures d'une journée dans les fenêtres, exact jusqu'à `MAX_ARRETS_EXACT`, heuristique plus-proche-voisin au-delà ; `figesSontDesFaits` ; `diagnostiquerJournee` (chiffres de la journée telle que posée quand rien ne tient). |
| `plein.js` | `evaluerRemplissage` (reste utile), `verdictJournee` (`sans_adaptable` / `non_pleine` / `figeable` / `a_arbitrer`) — même verdict pour le cron et le tableau de bord. |
| `proposer-contrat.js` | `techniciensEligibles`, `journeesCandidates`, `proposerPourContrat` (contrat → créneaux classés par score, `nouvellesJournees`, `raisonsRejet`). |
| `loaders.js` | `chargerJournees` / `chargerContrat` / `chargerDureesBareme` — chargement **injectable** (client supabase en paramètre), même code navigateur et edge. |
| `timeline.js` | Placement des RDV sur la barre horaire du panneau de remplissage (segments, trous, `trajetDepuisPrecedent`, bornes d'un déplacement à la main). |

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
- `toleranceDe(rdv, { souplesse: true, flexDefaut, amplitude, demiJournee })` : **sans `souplesse: true`, tolérance ponctuelle** quel que soit `time_flex_minutes`. Seul un appelant qui sait **écrire** les décalages la demande : `proposerPourContrat` (pose via `scheduleEntretien({ decalages })`) et la consolidation. Le remplissage de journée (panneau ouvert depuis le Planning) reste ponctuel et refuse tout placement qui supposerait un voisin déplacé.
- La plage est ancrée sur `announced_start` (des décalages successifs restent dans « 14 h ± 30 »), l'heure courante est toujours dans sa plage, l'amplitude prime (un adaptable qui déborde est ramené dedans à la consolidation), un figé n'est jamais borné.
- `placerCandidat` glisse **au plus un** voisin adaptable (pousse le suivant / tire le précédent, sans casser le voisin du voisin). `scheduleEntretien` relit le voisin et le glisse **avant** la pose ; refus `decalage_refuse` (+ raison : `deplace`, `fige`, `souplesse_modifiee`, `introuvable`, `ecriture`) si son état a changé ; remis en place si la pose échoue. Une carte créée pour l'occasion redescend en « À planifier » si la pose échoue.
- Un **drag** dans le Planning ré-ancre `announced_start` sans figer ; **figer** est un geste explicite (SouplesseDialog à la pose, `SectionSouplesse` sur le RDV, « Figer la journée »).

### Journée pleine (R2) — figée toute seule, pas la veille
`reste utile = budget + dépassement − (travail barème + trajets réels)`. Pleine quand `reste utile < reste_utile_min_minutes` et qu'il reste ≥ 1 RDV adaptable. Edge **`tournees-figer`** (`verify_jwt:false` + `MDH_CRON_SECRET`, cron pg_cron `tournees-figer` `20 5-19 * * *` UTC, migration `20260912_5`) : pour chaque journée **à partir de demain** d'une org avec `majordhome_organizations` et `figer_journee_pleine ≠ false` — pré-filtre à vol d'oiseau, matrice Mapbox (cache), `verdictJournee`, puis RPC **`tournees_figer_journee(p_org_id, p_lignes)`** (SECURITY DEFINER, **service_role only**, tout ou rien si un RDV a bougé) → heures définitives au **5 min supérieur** (`arrondirHeureFigee`), 🔒, `announced_start`. SMS `heure_de_passage` seulement si `figer_sms` + SMS org actifs + gabarit. Body manuel : `{ dry_run, org_id, date }` ; le rapport atterrit dans `net._http_response` quand on l'appelle par `net.http_post` avec le secret du vault.
Décision Eric : « si c'est plein depuis 10 jours, pourquoi attendre ? » — **pas de figeage la veille**. Aujourd'hui n'est jamais figé par le cron (geste humain).

### La journée commence au dépôt
`simuler` part du dépôt à l'ouverture : le trajet vers le premier client compte. Le « départ anticipé » ne vaut que pour un RDV **figé** à l'ouverture (le client a exigé 8 h). Un adaptable posé à 8 h à 38 min du dépôt → à arbitrer, et le diagnostic nomme « dépôt (ouverture) → client ». Un figé atteint « en retard » selon nos estimations est un **fait** (`figesSontDesFaits`), pas un blocage (leçon du 31/08).

### Pleine mais impossible (R3) → Dashboard des entretiens
`JourneesAArbitrer` (Entretiens → Dashboard, depuis le 2026-09-30 ; auparavant tableau de bord de l'admin) liste les journées pleines que l'ordonnanceur ne sait pas tenir, avec le diagnostic (travail / trajets / budget / trajets qui ne tiennent pas, estimés à vol d'oiseau) ; clic → `/planning?journee=YYYY-MM-DD&tech=<id>` (`lienJourneePlanning`) ouvre la journée dans le Planning.

### « Figer la journée » (bouton du panneau de remplissage, Planning)
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

## État de journée, étiquettes de secteur, journal des crons (auto-RDV tranche 1, 2026-09-29)

Spec : `docs/superpowers/specs/2026-09-29-auto-rdv-entretien-mensuel-design.md` · plan : `docs/superpowers/plans/2026-09-29-auto-rdv-tranche1-voir.md` · migration `20260930_1`.

- **Un seul état par journée de technicien**, dérivé à la lecture par `src/lib/tournee/etat.js::etatJournee` (module pur, testé `scripts/tournee/etat.test.mjs`) : `vide` · `ouverte` · `pleine` (verdict `figeable`) · `figee` (trace en base) · `a_arbitrer`. Libellés UI = `LIBELLES_ETAT`. Jamais stocké, jamais recopié.
- **`majordhome.journees_secteur`** (org **core**, `UNIQUE (org_id, team_member_id, date)`) : étiquette de secteur d'une journée (`origine` = `deduite` des RDV posés · `machine` · `humain`) + **trace du figeage** `figee_at` / `figee_par` (`cron` ou `user:<uuid>`). Une journée est disponible par nature : personne ne l'ouvre, l'étiquette dit seulement à quel secteur elle est dédiée. `deduireSecteur(rdvs)` = secteur majoritaire des entretiens/SAV du jour (une journée qui porte un entretien à Castres EST une journée Castres).
- **`majordhome.planification_runs`** : journal des passages des crons (`tournees-figer` ; `auto-rdv-*` à venir), écrit par l'edge **même en échec** (500 explicite si le journal ne s'écrit pas). Lu par le Dashboard entretiens (`PlanificationJournal`). Avant : le rapport n'existait que dans `net._http_response`.
- **Figeage = une seule fonction** `majordhome.figer_journee(p_mdh_org_id, p_lignes, p_par)` (interne), appelée par `public.tournees_figer_journee` (cron, service_role only) **et** `public.tournees_figer_journee_user(p_lignes)` (bouton « Figer la journée », authenticated, org dérivée des RDV, org_admin/team_leader). Tout ou rien, et la trace `figee_at` est posée dans la même transaction. Le bouton ne boucle plus sur `updateAppointment`.
- **Planning** : `useEtatsJournees({ coreOrgId, startDate, endDate })` calcule l'état de la plage visible (verdict à **vol d'oiseau**, `estime: true` ; « figée » vient de la base et est donc toujours vrai) ; `JourneeEtatChips` affiche une puce par technicien sous l'en-tête du jour (`dayHeaderContent`), clic → panneau de remplissage de la journée, sur place (depuis la tranche 4 ; auparavant l'onglet Tournées).
- Harnais : `scripts/migration-rehearsal/assert-journees-secteur.sql` ; le snapshot photographie désormais `appointment_technicians` et les colonnes de souplesse d'`appointments`.

## Auto-RDV : lien signé, créneaux en direct, pose atomique (tranche 2, 2026-09-29)

Plan : `docs/superpowers/plans/2026-09-29-auto-rdv-tranche2-proposer-poser.md` · migration `20260930_2` · edge `auto-rdv` (`verify_jwt:false`) · page `src/pages/PriseRdv.jsx` (`/rdv/:token`, hors `ProtectedRoute`).

- **Le mail ne porte aucun créneau, seulement un lien signé** : `rdv.<contract_id>.<exp>.<sig>`, HMAC-SHA256 avec `MDH_AUTO_RDV_SECRET` (edge env, jamais en vault ni côté front), sans état, expirant fin de mois (ou fin du mois suivant s'il reste < 7 jours). Obtenu par l'action `sign` de l'edge (JWT + `requireOrgMembership`, contrat ∈ org) — bouton « Copier le lien » (`Link2`) sur la carte Kanban « À planifier » (`EntretienSAVCard`, team_leader+). Toute lecture/pose dérive l'org du contrat porté par le jeton, jamais du payload.
- **L'offre = `src/lib/tournee/auto-rdv.js`** (pur, testé `scripts/tournee/auto-rdv.test.mjs`) : `bornesMois` (aujourd'hui + `auto_rdv.delai_min_jours` (2) → dernier jour du mois, **jamais le mois suivant**), `journeesProposables` (dans les bornes, non figées, porteuses d'un secteur : étiquette `journees_secteur` ou secteur déduit des entretiens posés — une journée vide sans étiquette n'est pas proposée), `placerDansDemiJournee` (`placerCandidat` borné à `reglages.demi_journee`, arrivée ET départ dedans, **aucun voisin déplacé** : arrêts en tolérance ponctuelle), `creneauxPourContrat` (secteur du contrat d'abord, puis date, matin avant après-midi, coût ; `auto_rdv.max_creneaux` (6)), `empreinteJournee` (`id@HH:MM` triés — **même formule que la RPC**).
- **`GET ?token=`** recalcule tout à l'instant (journées du mois, étiquettes, matrice Mapbox par lots comme `slots-propose`, secteur du contrat = dernier `grand_secteur` du client) ; renvoie branding neutre (`brand_name`, `phone`, `logo_url`, `accent_color`), prénom du client, créneaux avec `technicien` = prénom seulement, `deja` si un entretien à venir existe. **`POST { action: 'book' }`** recharge la journée ciblée, revérifie l'empreinte et le placement, puis appelle la RPC.
- **RPC `public.auto_rdv_poser(...)`** (service_role only) : contrat actif → org core/majordhome, technicien « par la machine », `hors_mois` (borne dure aussi côté DB), `journee_figee`, **`journee_modifiee` si l'empreinte a bougé**, carte racine non terminale du client réutilisée (règle `ensureEntretienCard`) ou créée en `planifie`, `deja_planifie` si elle porte déjà un RDV à venir ; RDV `maintenance` `time_flex_minutes = 240`, `announced_start` = arrivée calculée (dans la demi-journée), `source = 'auto_rdv:client|operateur'`, technicien `lead`, étiquette `deduite`. Tout ou rien ; 409 côté edge pour chaque refus métier.
- Page : chargement → erreur (lien expiré, contrat inactif… + téléphone) · déjà pris · choix (cartes par date, boutons matin / après-midi) · confirmation · succès (« l'heure exacte par SMS ») ; un 409 recharge les créneaux avec un avis. Limite 60 requêtes / jeton / heure.
- Non fait ici (tranche 3) : e-mail de confirmation, invitations et relances, étiquetage machine des journées vides, réglages `auto_rdv` dans Settings (les clés `delai_min_jours` / `max_creneaux` sont lues avec défaut mais pas encore éditables).

### Réordonnancement à la pose, tolérance du retour au dépôt, détour (2026-09-30)
- **L'offre auto-RDV réordonnance la journée entière** (`auto-rdv.js::placerParSequencement` sur `sequencerTournee`, souplesse activée) : chaque entretien posé glisse dans SA souplesse (`time_flex_minutes`, ancré sur `announced_start`), les figés ne bougent pas, le contrat est contraint à la demi-journée. Les décalages des voisins sont renvoyés dans le créneau et **écrits par la RPC avec le RDV** (`auto_rdv_poser(..., p_decalages)`, migration `20260930_4`, tout ou rien, `decalage_refuse` si un voisin a bougé). Un chevauchement que les tolérances ne résolvent pas reste refusé `fenetre` (= journée à arbitrer).
- **`tolerance_retour_depot_minutes`** (15, Settings → Tournées) : le dernier client finit dans l'amplitude, seul le retour au dépôt peut la déborder d'autant (`sequencerTournee` et `placerCandidat`, propagé à tous les appelants). Amplitudes de Mayer alignées sur le réel : 17 h, 16 h le vendredi (Settings → Équipe).
- **Trajet maximum = DÉTOUR ajouté** entre deux clients (aller + retour − arc évité), tronçon brut seulement en bord de journée ; dépôt exempté. Un client à 5 min du précédent sur un arc déjà long n'est plus refusé.
- **La demi-journée est un engagement de DÉBUT, pas de fin** (Eric, 2026-09-30 : « la souplesse est une variable du moteur, pas pour le client ; au client on indique "1er passage" ou "second créneau du matin", sauf RDV figé = contrainte du client qui appelle »), **avec au moins la moitié du travail dedans** (« commencer à 11 h 59, c.est compliqué à justifier » : 90 min → dernier début 11 h 15). `toleranceDe` (flex 240) borne le début à `fin − durée/2`, l.amplitude borne la fin ; même règle pour le contrat de l.auto-RDV. La pause (Mayer : **60 min**, fenêtre **11 h 30 – 14 h** = la pause entière tient dedans (14 h pour qu.une intervention de 2 h commencée à 11 h laisse déjeuner)) glisse, prise sur la route. Réglages Mayer posés le 2026-09-30 : `souplesse_defaut_minutes = 240`, `pause_minutes = 60`, `pause_fenetre = [11.5, 14]` (⚠️ `pause_fenetre` n.a pas encore de champ dans Settings → Tournées).

## Auto-RDV : invitations mensuelles, étiquetage, relances (tranche 3, 2026-09-30)

Plan : `docs/superpowers/plans/2026-09-30-auto-rdv-tranche3-inviter-relancer.md` · migrations `20260930_5` (invitations) et `20260930_6` (crons) · edge `auto-rdv-cron`.

- **Cycle** : `auto-rdv-ouverture` (pg_cron `0 4 1 * *`, 6 h Paris le 1ᵉʳ) et `auto-rdv-relances` (`20 4 * * *`) appellent l'edge `auto-rdv-cron` (`verify_jwt:false`, `MDH_CRON_SECRET`), body `{ mode }`. **Gouverné par `settings.tournees.auto_rdv.enabled`** (défaut `false`, Settings → Tournées → « Prise de rendez-vous par le client ») ; la page publique et « Lien de RDV client » marchent quel que soit ce réglage. `dry_run` + `force` simule une org non activée sans rien écrire ni envoyer.
- **Modules purs** (copiés pour Deno, testés) : `secteurs.js` (même partition que l'onglet Programmation, **noms normalisés** : « ALBI » → « Albi ») + `populations.js` (geo.api.gouv.fr, fetch injecté, sans cache) ; `etiquetage.js` (`besoinParSecteur` : contrats dus × marge ÷ capacité cible, capacité déjà amorcée déduite ; `journeesAEtiqueter` : journées VIDES les plus proches, techniciens alternés, jamais hors bornes ; `secteursAReouvrir`) ; `invitations.js` (`contratsAInviter` : anniversaire du mois ou retard, un par client, exclusions comptées ; `etapeRelance` : sms J+7, appel J+15, expiration).
- **Ouverture** : contrats actifs sans visite, sans carte en cours, pas déjà invités ; mail `auto_rdv` (gabarit `mail_campaigns`, `{{PRENOM}}` `{{EQUIPEMENTS}}` `{{MOIS}}` `{{LIEN_RDV}}` + branding) via Resend, `mailing_logs` (`campaign_name = 'auto_rdv'`) ; gabarit absent / pas de `from_email` / client sans e-mail ⇒ invitation `outcome = 'phone'` (liste d'appels), jamais un échec silencieux (`template_missing` dans le journal). Puis étiquetage `journees_secteur` origine `machine`.
- **Relances** : SMS `auto_rdv_relance` (`sendCampaignSms`, `campaign_template_missing` = compté `sms_skipped`), `escalade_appel_at`, `outcome = 'expired'` après la fin du mois ; étiquettes `deduite` des journées amorcées ; une journée vide de plus pour un secteur dont les journées étiquetées sont à ≥ `seuil_reouverture_pct`.
- **`majordhome.auto_rdv_invitations`** (`UNIQUE (org_id, contract_id, mois)`, écrite par les edges seulement) : l'edge `auto-rdv` y marque `opened_at`, `no_slot`, `booked_at` ; e-mail de confirmation `auto_rdv_confirmation` best-effort à la pose. Lue par `useInvitationsDuMois` → ligne « Invité le… · relancé le… · à appeler » sur la carte À planifier, tableau du mois et journaux par job dans le Dashboard entretiens (`AutoRdvMois`, `PlanificationJournal job=…`).
- ⚠️ **Filtres `in` PostgREST par lots de 100** côté edge : 500 uuid dépassent la longueur d'URL (« error sending request », vécu à la première simulation).
- Jeton partagé : `_shared/autoRdvToken.ts` (edge `auto-rdv` et cron). Gabarits e-mail : `src/lib/autoRdvEmailTemplates.js`, créés depuis Settings → Communication → Emails (`GabaritTransactionnel`).
- **Activation = gestes d'Eric** : créer les deux gabarits e-mail, saisir les SMS `auto_rdv_relance` et `heure_de_passage` (Communication → SMS), cocher « Prise de rendez-vous par le client », puis `figer_sms`.

## Auto-RDV : ranger (tranche 4, 2026-09-30)

Spec § 9. Aucune migration, aucune edge redéployée, rien de retiré du moteur.

- **L'onglet Tournées de la page Entretiens n'existe plus** (`components/tournees/TourneesTab.jsx` supprimé ; `?tab=tournees` retombe sur le Dashboard). Entretiens garde Kanban, Contrats, Programmation, Dashboard, Clos.
- **Remplir / figer une journée = clic sur sa puce dans le Planning** : `Planning.jsx` monte `RemplirJourneePanel` sur place. Le panneau charge lui-même les contrats dus ; le Planning ne lui passe que la journée, **dérivée en direct** de l'horizon (`useEtatsJournees` renvoie aussi `journees`), jamais un objet capturé au clic. Lien direct : `/planning?journee=YYYY-MM-DD&tech=<team_member id>` (source unique `lienJourneePlanning` de `tourneesPanelUtils.js`) — le calendrier s'ouvre sur la date ; une journée absente de l'horizon (passée, non travaillée, technicien « à la main ») ou un chargement en échec donne un message, pas un lien muet.
- **Dashboard des entretiens** : `JourneesAArbitrer` (retiré du tableau de bord général) et `AlertesTournees` (sous-remplies à J-7, retardataires, clients non localisés, équipements à typer), au-dessus de « Planification automatique ». Même horizon pour les deux (`useJourneesHorizon` par défaut) ; journée → Planning, contrat → fiche contrat.
- **CTA « Trouver le créneau » borné au mois** : `CreneauxProposesPanel` passe `constraints.date_to` = fin de `bornesMois(aujourd'hui, { delaiMinJours: 0 })` — mois en cours, mois suivant inclus s'il reste moins de 7 jours, sans délai minimal (l'opérateur peut poser pour demain). La borne s'affiche dans le panneau. ⚠️ Elle est posée par l'**appelant** : l'edge `slots-propose` appelée sans `date_to` (Hermes, MCP) propose encore au-delà du mois.
- Non fait ici : corriger l'étiquette de secteur d'une journée depuis le Planning (spec § 5 — la table accepte l'origine `humain`, aucun écran ne l'écrit) ; action « Arbitrer » sur la puce rouge.
