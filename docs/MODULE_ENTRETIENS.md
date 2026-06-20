# Module Entretiens (Programmation · grands secteurs · certificats · géocodage)

> Déporté de CLAUDE.md (restructuration 2026-06-18). Pointeur + règles qui mordent : CLAUDE.md § Modules.

## Programmation entretiens — Grands secteurs & géocodage auto

L'onglet **Programmation** (Entretiens) regroupe les contrats par **« grands secteurs »** géographiques au lieu du code postal nu (un CP agrège des communes éparses, et deux CP proches en n° ne sont pas proches en réalité). Spec : `docs/superpowers/specs/2026-06-17-programmation-grands-secteurs-design.md` · Plan : `docs/superpowers/plans/2026-06-17-programmation-grands-secteurs.md`.

### Clustering (frontend, pur)
- `src/lib/sectorClustering.js` — `clusterSectorsByProximity(sectors, { radiusKm=15, cityPopulation })` : **partition stricte au grain code postal** (chaque CP dans 1 seul grand secteur), agglomératif sous **contrainte de rayon** (haversine : tous les CP d'un secteur à ≤ rayon du barycentre pondéré → pas d'effet de chaîne). Déterministe (tri d'entrée + tie-break d'indice). Pur (aucune dépendance React/Supabase), testé `node --test scripts/sector-clustering.test.mjs`.
  - **Zéro doublon** (test de conservation : Σ CP des groupes = total) · **zéro orphelin** : CP sans coords → bucket `Non localisé` (placé en dernier) ; CP géocodé mais **isolé** (> rayon de tout le monde) → **son propre secteur singleton** (≠ `Non localisé`). On ne **scinde jamais** un CP entre deux secteurs.
  - **Nommage par la ville la plus peuplée** (PAS par nb de contrats) : `src/lib/communePopulation.js::fetchCityPopulations` (API `geo.api.gouv.fr`, cache localStorage org-scoped 30 j ; `normalizeCity` gère accents + abréviations St/Ste). Fallback nb de contrats si population indispo. Ex. le secteur d'Albi s'appelle « ALBI » même si le CP 81990 (Le Séquestre) y a plus de contrats.
- `entretiensService.getContractsBySector` : merge les coords client (2ᵉ requête `majordhome_clients`, la vue contrats ne les expose pas), **trim le CP**, annote chaque secteur de `grandSecteurId/Name/Order` (forme de retour inchangée).
- `SectorGroupView.jsx` : rendu **2 niveaux grand secteur → clients** (le niveau CP a été retiré — décision 2026-06-17, inutile une fois la commune affichée sur chaque ligne) ; clients triés par commune puis nom ; nom du grand secteur en MAJUSCULES (uniforme). **⚠️ Gotcha** : l'icône `Map` de lucide-react **shadow** le constructeur global `Map` → aliaser l'import en `MapIcon` si on utilise `new Map()` dans le fichier (sinon `Map is not a constructor` au rendu — invisible au build).

### Géocodage serveur automatique (« sans dette géographique »)
- Le géocodage à la saisie (`ClientModal`/`LeadModal` via `geocoding.service.js`) ne couvre PAS les créations hors modale (cron Pennylane, N8N, imports) ni les échecs/ré-adressages → comblé par un balayage serveur. Règle unique : `geocoded_at IS NULL` + adresse exploitable = à géocoder.
- **Edge `geocode-sweep`** (`verify_jwt:false`, `requireSharedSecret(MDH_CRON_SECRET)`) : lit un lot via RPC `geocode_fetch_pending_clients` (service_role), géocode via l'endpoint **unitaire** `/search/` de `geo.api.gouv.fr` (⚠️ **NE PAS** utiliser l'endpoint CSV `/search/csv/` : ses colonnes résultat ne sont pas à la position supposée → matchait 0 ; fix `cac340c`), applique via RPC `geocode_apply_client_coordinates` (COALESCE strict, n'écrase jamais une coord par NULL). RPCs service_role only (migration `20260617_2`). Cron pg_cron **30 min** (migration `20260617_3`, secret lu depuis vault). App-level cross-org, géocodage org-agnostique.
- Combiné à `clients.geocode_attempts` (cf. Gotchas DB) : 3 tentatives max puis abandon, reset au ré-adressage.

### Grand secteur figé sur le RDV (Planning)
- Photo du grand secteur figée à la création du RDV dans `appointments.grand_secteur` (détails + gotcha org CORE ≠ majordhome : cf. Gotchas DB, ligne `majordhome_appointments`). Affiché sur l'étiquette calendrier (`Planning.jsx::renderEventContent` : ligne 1 = heure + **type**, ligne 2 = `NOM · Secteur XXX` → supprime le doublon de nom). Périmètre = clients sous contrat (entretiens) ; pas de rétro-remplissage des RDV existants.

## Module Certificats d'entretien (multi-équipements)

### Architecture
- **1 certificat par équipement** : interventions enfants (`parent_id` + `equipment_id`)
- **Parent** = carte Kanban (1 par contrat/client), **enfants** = 1 par équipement du contrat
- **Vue `majordhome_entretien_sav`** filtrée `parent_id IS NULL` (enfants exclus du Kanban et des stats)
- **Lazy create** : les enfants sont créés à la première ouverture de la modale si absents

### Composants
| Fichier | Rôle |
|---------|------|
| `CertificatsSection.jsx` | Section certificats extraite de EntretienSAVModal (equipments, lazy create, progress bar, liste) |
| `CertificatEquipmentRow.jsx` | Ligne équipement : statut (À faire/Rempli/Néant) + CTA Remplir/Voir/Néant |
| `useCertificatEntretien.js` | Hook React Query : `useCertificatChildren` + `useCertificatEntretienMutations` |

### Workflow
```
planifie → [Remplir certificats équipements] → realise → facture (hors Kanban)
```
- Transition `realise` automatique quand tous les enfants sont traités (rempli ou néant)
- `completeParentEntretien()` : transition parent + insert `maintenance_visit` (chaînage annuel)
- Bouton "Valider facturation" sur carte Kanban → carte disparaît
- `client_comment` (colonne `interventions`) : message pour le mail client

### PDF Certificat
- Logo Mayer Énergie + titre centré
- Signature technicien (nom = user connecté, non modifiable)
- TVA retirée, prochaine intervention en mois/année FR

### Fiche équipement
- Combobox marque/modèle : saisie libre + suggestions fournisseurs (`<input>` + `<datalist>`)

### Service methods (`sav.service.js`)
- `getChildInterventions(parentId)` — enfants + JOIN équipements
- `createChildInterventions(parentId, equipments, ctx)` — batch insert
- `markChildNeant(childId)` / `unmarkChildNeant(childId)` — NÉANT toggle
- `completeParentEntretien(parentId, orgId, reportNotes)` — clôture + maintenance_visit
- `deleteEntretienCard(interventionId)` — hard delete intervention + enfants certificats. « Ranger » une carte « À planifier » → libère le contrat dans l'outil Programmation. Délie les RDV via FK `appointments.intervention_id ON DELETE SET NULL`. Toast undo recrée via `createEntretien` (snapshot).
- `scheduleEntretien({ card, slots, includesEntretien, coreOrgId })` (2026-06-17) — **source unique** de planification entretien/SAV (cf. Module Planning). Appelée par le kanban **et** `ContractModal`.

### Pièces de rechange (détail + « Offert », 2026-06-05)
- Composant `EntretienPartsSection.jsx` (fiche entretien) : détail des pièces (parent + enfants) + toggle « Offrir/Annuler » + suppression (X rouge), réservé **team_leader+**.
- Vue `majordhome_entretien_sav` v2 : `parts_detail` (JSON array agrégé parent+enfants via `WITH ORDINALITY`, clés `intervention_id`/`idx`/`designation`/`quantite`/`prix_ht`/`offert`) ; `parts_total_ttc` **exclut** les pièces offertes (geste commercial répercuté en prépa facturation).
- RPCs (SECURITY DEFINER, REVOKE anon, role-checkées team_leader+ côté DB) : `certificat_set_piece_offert(p_intervention_id, p_piece_index, p_offert)`, `certificat_delete_piece(p_intervention_id, p_piece_index)`.
- **⚠️ Gotcha `idx` parts_detail** : les `idx` sont recalculés par la vue (`WITH ORDINALITY`) → toute mutation qui retire/réordonne (`certificat_delete_piece`) invalide les `idx` mémorisés côté front. Pattern obligatoire : `refreshParts()` recharge `parts_detail` depuis la vue après CHAQUE mutation avant d'autoriser la suivante (sinon le 2ᵉ delete consécutif vise la mauvaise pièce).

