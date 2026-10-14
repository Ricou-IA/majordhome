# Départ / Retour par technicien — design

> Date : 2026-10-14 · Statut : validé en conversation avec Eric, à relire
> Origine : feuille de route du jour (commit `f236208`) — Mohammed, technicien
> planifié à la main, travaille côté nord de Toulouse mais sa feuille part et
> revient à Gaillac : durées et kilomètres faussés.

## 1. Intention

Améliorer **le calcul** (trajets, km, remplissage des journées) et **le confort**
des techniciens : chacun a son véhicule équipé, il n'a pas à repasser par
l'agence. Règle produit (Eric) :

- **De base, c'est la maison** : chaque technicien porte un point de **départ**
  et un point de **retour** dans ses réglages (Settings → Équipe), en général
  son domicile. Les deux peuvent différer.
- **Par exception, c'est l'agence** : quand on doit imposer un passage (charger
  du matériel, retour nécessaire), on le pose sur **la journée**, depuis la
  feuille de route — « Départ : Agence » et/ou « Retour : Agence ». L'exception
  est **enregistrée** : elle sert à optimiser la semaine, la machine la lit.
- **Sans réglage, rien ne change** : départ et retour = agence (siège de l'org,
  `getOrgHeadquarters(settings)`), comportement actuel à l'identique.

Hors périmètre : rendre ces droits paramétrables dans l'éditeur « Droits
d'accès » (passage dédié décidé par Eric, cf. §7).

## 2. Données

### 2.1 Réglage du technicien — `majordhome.team_members`

Deux colonnes `jsonb NULL` :

| Colonne | Forme | NULL |
|---|---|---|
| `depart_point` | `{ label, address, lat, lng }` | agence |
| `retour_point` | `{ label, address, lat, lng }` | agence |

- `lat`/`lng` obligatoires et numériques dès que l'objet existe (CHECK) ; `label`
  court saisi (« Domicile »), `address` = libellé BAN/Mapbox complet.
- Vue `public.majordhome_team_members` : `CREATE OR REPLACE VIEW` en ajoutant les
  deux colonnes **en fin de liste** (miroir simple, `security_invoker=true`
  conservé). GRANT service_role déjà en place (vérifié 2026-10-14).
- Écriture : RPC existante `public.team_member_set_routing_settings`, prévue pour
  accueillir les réglages de tournée. Nouvelle signature (DROP + CREATE, sinon
  surcharge) :

  ```
  team_member_set_routing_settings(
    p_team_member_id uuid,
    p_daily_work_minutes integer DEFAULT NULL,
    p_include_in_routing boolean DEFAULT NULL,
    p_depart_point jsonb DEFAULT NULL,
    p_retour_point jsonb DEFAULT NULL,
    p_reset_depart boolean DEFAULT false,
    p_reset_retour boolean DEFAULT false
  ) RETURNS TABLE (daily_work_minutes, include_in_routing, depart_point, retour_point)
  ```

  NULL = inchangé (patch partiel, convention existante) ; `p_reset_*` = remettre
  l'agence (NULL en base). Validation : objet sans `lat`/`lng` numériques ⇒
  `22023`. Garde inchangée : `auth.uid()` NULL refusé en premier, `org_admin`
  only en autorisation positive (`IS DISTINCT FROM`). `REVOKE … FROM PUBLIC, anon`.

### 2.2 Exception du jour — `majordhome.team_member_day_endpoints` (nouvelle)

| Colonne | Type |
|---|---|
| `id` | uuid PK |
| `org_id` | uuid NOT NULL (org **majordhome**, comme `team_members`) |
| `team_member_id` | uuid NOT NULL FK `team_members` ON DELETE CASCADE |
| `date` | date NOT NULL |
| `depart` | text NULL CHECK (`'agence'`, `'perso'`) |
| `retour` | text NULL CHECK (`'agence'`, `'perso'`) |
| `created_by`, `created_at`, `updated_at` | |

- UNIQUE `(team_member_id, date)`. NULL = suit le réglage. Une ligne dont les deux
  valeurs redeviennent NULL est **supprimée** (pas de ligne morte).
- RLS activée : SELECT pour les membres de l'org (via `organizations.core_org_id`
  ∈ org_members) ; aucune policy d'écriture (écriture par RPC seulement).
- Vue `public.majordhome_team_member_day_endpoints` (`security_invoker=true`) +
  `GRANT SELECT … TO service_role` sur la table (les edges lisent la vue).
- RPC `public.team_member_set_day_endpoints(p_team_member_id uuid, p_date date,
  p_depart text, p_retour text)` — SECURITY DEFINER, `SET search_path`, refus
  `auth.uid()` NULL en premier, autorisation positive `role IN ('org_admin',
  'team_leader')` sur l'org core du membre, upsert ou delete si les deux NULL,
  `REVOKE … FROM PUBLIC, anon`, GRANT authenticated. Valeur hors liste ⇒ `22023`.
- `'perso'` posé alors que le technicien n'a pas de point personnel : accepté en
  base (le résolveur retombe sur l'agence, cf. §3) ; l'écran ne le propose pas.

### 2.3 Migration et répétition

Migration versionnée `supabase/migrations/20261014_1_depart_retour_technicien.sql`,
répétée sur `scripts/migration-rehearsal/` (étendre `snapshot.mjs` : vue déjà
listée ; ajouter la fonction `team_member_set_routing_settings` si absente).
Vérifications post-application en prod : `has_function_privilege('anon', …)` faux
sur les deux RPC, `has_table_privilege('service_role', …, 'SELECT')` vrai sur la
nouvelle table, vue toujours `is_insertable_into` inchangé.

## 3. Résolution — module pur unique

`src/lib/tournee/extremites.js` (pur, JSDoc complète, copié pour Deno par
`npm run sync:tournee-engine`, testé `scripts/tournee/extremites.test.mjs`) :

```js
resoudreExtremites({ siege, membre, exception })
// → { depart: Point|null, retour: Point|null }
// Point = { lat, lng, label, address, source: 'agence' | 'perso' }
```

Priorité, pour chaque extrémité indépendamment :
1. exception du jour `'agence'` ⇒ siège ;
2. exception `'perso'` **ou** pas d'exception ⇒ point personnel s'il existe ;
3. sinon siège.

Siège absent (org non configurée) ⇒ point personnel s'il existe, sinon `null`
(l'appelant garde son comportement « siège non configuré »). Un point personnel
aux coordonnées invalides est ignoré (repli siège), jamais propagé.

Libellés : `source='agence'` ⇒ libellé du siège ; `source='perso'` ⇒ `label`
saisi (défaut « Domicile »), complété de la commune si connue.

C'est la **seule** définition : moteur, feuille de route, écran et edges
l'appellent ; personne ne recopie la priorité.

## 4. Moteur de tournées (`src/lib/tournee/*`)

### 4.1 Chargement
`chargerJournees` reçoit `siege` (nouveau paramètre) ; lit `depart_point`,
`retour_point` dans son SELECT `majordhome_team_members`, et les exceptions de
l'horizon dans `majordhome_team_member_day_endpoints` (`{ error }` lu, échec ⇒
`error` remonté comme les autres lectures). Chaque `Journee` porte
`depart` et `retour` (Points résolus, cf. §3). Sans `siege` passé ⇒ comportement
actuel pour les techniciens sans point (rétro-compat des appelants non migrés).

### 4.2 Départ ≠ retour
Le dépôt unique est éclaté en deux clés :
- **`depotKey`** garde son nom et devient la clé de **départ** : premier trajet,
  plus proche voisin, départ anticipé d'un figé à l'ouverture, repli de position
  d'un RDV sans coordonnées (`construireArretsExistants` / `…PourConsolidation`).
- **`retourKey`** (nouveau, défaut = `depotKey`) : dernier trajet (`simuler`,
  `diagnostiquerJournee`), `chargeExistante`, `finDeJournee`, `intervalles`
  (`keyApres` du dernier intervalle), `tenterDecalage`, `proposer-contrat`
  (`keyApres`).

Le défaut `retourKey = depotKey` garde tous les tests existants valides.

### 4.3 Fonctions prenant `{ journee, depot }`
`verdictJournee`, `placerParSequencement`, `creneauxPourContrat`,
`proposerPourContrat`, `useConsolidationJournee`, `useJourneePose`,
`RemplirJourneePanel`, `useEtatsJournees`/`useTournees`, `tournees.service.js` :
point de départ = `journee.depart ?? depot`, retour = `journee.retour ?? départ`.
Le paramètre `depot` (siège) reste en repli.

### 4.4 Matrices de trajets
Les noyaux de matrice (`[depot, ...arrets]` dans `tournees.service.js`,
`slots-propose`, `tournees-figer`, `_shared/autoRdvContexte.ts`) incluent
départ **et** retour de la journée (dédoublonnés par `cleCoord`). `travel_cache`
est indexé par coordonnées : un nouveau point n'invalide rien, il ajoute des
entrées.

### 4.5 Règles inchangées
- « La journée commence au point de départ à l'ouverture » (ex-« au dépôt »).
- Trajet de retour **compté dans le budget**, tolérance `tolerance_retour_depot_minutes`
  appliquée au point de retour (décision Eric 2026-10-14 : même règle, seul le
  point change).
- Journée **figée** : jamais recalculée ; ses heures sont des faits. Changer un
  point ne modifie que les trajets estimés. Le verdict « pleine » de
  `tournees-figer` utilise naturellement les points résolus.
- Techniciens hors tournées (`include_in_routing=false`) : le moteur ne les voit
  pas ; seule la feuille de route les concerne.

### 4.6 Edges
`npm run sync:tournee-engine`, puis redéploiement des **cinq** edges qui
consomment le moteur : `slots-propose`, `tournees-figer`, `auto-rdv`,
`auto-rdv-cron`, `agent-creneaux` (les trois dernières via
`_shared/autoRdvContexte.ts` / `chargerJournees`). Chacune passe le siège à
`chargerJournees`.

## 5. Feuille de route du jour

- `useFeuilleDeRoute` : résout le membre (premier `team_members` dont l'id est
  dans `memberIds`) et l'exception du jour, puis `resoudreExtremites`. Sans
  membre trouvé (commercial sans ressource) ⇒ agence.
- `src/lib/feuilleDeRoute.js` : `pointsItineraire(depart, arrets, retour)`,
  `lienGoogleMapsTournee(depart, arrets, retour)` (origin ≠ destination),
  `urlCarteStatique` (pastille départ, pastille retour si différente),
  `buildFeuilleDeRoute({ depart, retour, … })` → `departLabel`, `retourLabel`.
  Compat : `depot` seul ⇒ départ = retour = `depot`.
- `FeuilleDeRouteSection` : « Départ · … » et « Arrivée · … » deviennent un
  sélecteur **Agence / Domicile** (affiché seulement si le technicien a le point
  personnel correspondant et que l'utilisateur est team_leader+ ; sinon texte
  simple). Un clic écrit l'exception (hook mutation `unwrapResult`, toast en cas
  d'échec), invalide la feuille et les journées de tournée ; trajets, carte, lien
  Maps et PDF se recalculent. Libellé avec la source : « Départ · Domicile
  (Bouloc) », « Arrivée · Agence (Gaillac) ».
- `FeuilleDeRoutePDF` : « Départ : … » / « Arrivée : … » lus du modèle
  (`departLabel`/`retourLabel`), aucun calcul.

## 6. Settings → Équipe — fiche membre

Onglet « Profil & planning », nouvelle section **« Départ / Retour »** (sous
« Budget journalier », visible pour toute ressource planning) :

- Deux lignes, Départ et Retour : **Agence** (défaut) / **Autre adresse**.
- « Autre adresse » ouvre la recherche d'adresse réutilisant
  `pages/settings/organization/components/AddressSearch.jsx` + un libellé court
  (défaut « Domicile »).
- Raccourci sur la ligne Retour : « Même adresse que le départ ».
- Enregistrement immédiat (convention de la fiche), via `useSetTeamMemberRouting`
  étendu ; cache `teamMembers` patché depuis la ligne renvoyée par la RPC.
- Lecture seule pour les non-admins.
- Ligne de la liste équipe : rien d'ajouté (YAGNI).

## 7. Droits

- Réglage du technicien : `org_admin` (même RPC que budget/planification).
- Exception du jour : `team_leader` et `org_admin`, en dur dans la RPC et l'écran.
- **Suivi** (Eric, 2026-10-14) : passage dédié sur les droits pour rendre
  paramétrables dans « Droits d'accès » les actions ajoutées récemment sans
  ressource du registre — celle-ci en fait partie.

## 8. Tests et vérifications

- `scripts/tournee/extremites.test.mjs` : priorités, siège absent, coordonnées
  invalides, libellés.
- Moteur : cas départ ≠ retour pour `simuler`/`sequencerTournee`,
  `chargeExistante`, `finDeJournee`, `proposerPourContrat`, `verdictJournee` ;
  tous les tests existants inchangés et verts.
- `scripts/feuille-de-route.test.mjs` : itinéraire et lien Maps avec départ ≠
  retour, compat `depot` seul, libellés.
- `npm run audit:quality` vert (dont test de synchro des copies Deno),
  `npx vite build` OK, `deno check` des edges touchées.
- Prod : migration appliquée et privilèges audités (§2.3) ; edges redéployées ;
  déploiement Vercel suivi jusqu'à READY.

## 9. CLAUDE.md

Règle à **proposer** à Eric (rien intégré sans accord) : « Point de départ / retour
d'une journée = `resoudreExtremites` (exception du jour > réglage du technicien >
siège) ; ne jamais repasser `getOrgHeadquarters` comme dépôt d'une journée. »
