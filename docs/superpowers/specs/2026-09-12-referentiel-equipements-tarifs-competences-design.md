# Référentiel équipements, tarifs et compétences par organisation

> Spec de design — 2026-09-12. Statut : **validée par Eric le 2026-09-12 ; implémentée** (plan
> `docs/superpowers/plans/2026-09-12-referentiel-equipements-tarifs-competences.md`, M1 et M2 répétées
> sur cluster local — voir `scripts/migration-rehearsal/`).
> Remplace l'enum Postgres `majordhome.equipment_category` par un référentiel **par organisation**
> (catégorie → type), y accroche la grille tarifaire, les durées d'entretien et les compétences des
> techniciens (**par type × rôle**, cochées comme des droits). Chemin critique à ne jamais couper :
> le CTA « Trouver le créneau optimisé » (`proposerPourContrat` + edge `slots-propose`), livré le
> 2026-09-12 (`docs/superpowers/specs/2026-09-12-planification-entretien-outils-machine-design.md`).
> Précédent de style et de méthode : `2026-08-12-sources-statuts-multi-org-design.md`.

## 1. Problème

La grille tarifaire (`majordhome.pricing_rates`, zone × type) dépend de `pricing_equipment_types`,
qui est déjà **par org** (CRUD dans `/settings/pricing`). Mais la **catégorie** d'un équipement
— ce qui décide du gabarit de certificat, de la compétence requise, des icônes, des replis de durée —
est un **enum Postgres figé par migration**, avec le vocabulaire de Mayer :

```
majordhome.equipment_category = pac_air_air | pac_air_eau | chaudiere_gaz | chaudiere_fioul
  | chaudiere_bois | vmc | climatisation | chauffe_eau_thermo | ballon_ecs | poele | autre
```

Une 2ᵉ entreprise qui entretient des adoucisseurs, des VMC double-flux ou des chaudières gaz à
condensation ne peut ni nommer ni ordonner ses catégories : chaque valeur nouvelle est un
`ALTER TYPE … ADD VALUE` (hors transaction, irréversible), et le lien type → catégorie est une
colonne texte **invisible dans l'interface**. Eric (2026-09-12) : « la table tarifaire dépend des
équipements, c'est une des premières choses faites, et c'est ce qui demande d'être repris pour le
côté scalable. La case compétence doit être associée à la table équipement. Les rôles peuvent être
Entretien + Pose, paramétrable pour plus tard. »

Trois façons de désigner « ce qu'est un équipement » coexistent aujourd'hui :

| Niveau | Où | Valeurs Mayer | Qui s'en sert |
|---|---|---|---|
| Famille tarifaire | `pricing_equipment_types.category` (text) | `poeles, chaudieres, climatisation, eau_chaude, energie` | optgroups des sélecteurs, éditeur de types, PDF fiche technique, mailing |
| Catégorie enum | `equipments.category` + `pricing_equipment_types.equipment_category` (text, nullable) | 7 valeurs utilisées sur 11 | certificat, compétences, filtres, icônes, replis de durée, portail |
| Type | `pricing_equipment_types.code` | 14 codes | prix, durée, site vitrine, icônes |

## 2. Ce que la vérification a établi (2026-09-12)

Requêtes en lecture seule sur `ejqqqwudmizqisdkxohw` (vues PostgREST + catalogues) et lecture des
deux dépôts (app + `C:\Dev\Landing Page - Mayer`).

### 2.1 L'enum : 11 valeurs, 7 utilisées, 4 objets dépendants

| Valeur | Équipements | Dont sans type | Sous contrat actif |
|---|---:|---:|---:|
| `poele` | 708 | 303 | 379 |
| `chaudiere_bois` | 69 | 24 | 36 |
| `pac_air_air` | 60 | 0 | 31 |
| `pac_air_eau` | 25 | 7 | 8 |
| `climatisation` | 24 | 11 | 11 |
| `chauffe_eau_thermo` | 16 | 1 | 7 |
| `autre` | 8 | 7 | 3 |
| **Total** | **910** | **353** | **475** |

`chaudiere_gaz`, `chaudiere_fioul`, `vmc`, `ballon_ecs` : 0 équipement. Tous les équipements sont
Mayer (org core `3c68193e…`).

Objets dépendant du type enum (`pg_depend`, tous schémas) : la colonne `equipments.category`
(NOT NULL, index `idx_equipments_category`), les vues `majordhome.v_planning` et
`majordhome.v_equipments_maintenance` (**mortes** : aucune vue, aucune fonction ne les lit), la vue
miroir `public.majordhome_equipments`. Une seule fonction cite l'enum : `process_web_entretien`
(site vitrine, `/api/entretien`). Le rôle `baikal_reader` a `SELECT` sur ces tables mais c'est un
vestige du dump : Baikal vit sur l'ancienne instance `odspcxgafcqxjzrarsqf`.

### 2.2 `pricing_equipment_types` est déjà le référentiel par org — avec deux catégories et un mapping caché

14 types Mayer, aucune autre org n'en a. Colonnes réelles (la vue publique n'en expose que 16) :
`id, code, label, category, equipment_category, has_unit_pricing, unit_label, included_units,
sort_order, is_active, created_at, updated_at, is_entretien, aide_type, icon, description, org_id,
duration_base_minutes, duration_per_extra_unit_minutes, unfavorable_months`. UNIQUE `(org_id, code)`.

| Code | Famille | `equipment_category` | Durée | Tarifs |
|---|---|---|---:|---:|
| poele_bois_insert, poele_granules_elec, poele_granules_sans_elec, poele_hydro | poeles | poele | 60/90/90/150 | 3 |
| chaudiere_bois, chaudiere_granules | chaudieres | chaudiere_bois | 150 | 3 |
| pac_air_air | climatisation | pac_air_air | 60 (+30/split) | 3 |
| gainable | climatisation | climatisation | 90 | 3 |
| pac_air_eau | climatisation | pac_air_eau | 90 | 3 |
| ballon_thermo, chauffe_eau_solaire | eau_chaude | chauffe_eau_thermo | 90 | 3 |
| panneau_photovoltaique | energie | **NULL** | 90 | 3 |
| TRAV_ELEC, prestation_diverses | energie | **NULL** | — | 0 |

36 tarifs = 12 types × 3 zones (HZ, Z1, Z2). FK entrantes : `contract_pricing_items`,
`equipments`, `leads`, `pricing_rates` (CASCADE). **L'éditeur de types (`PricingSettings.jsx`)
n'expose pas `equipment_category`** : un type créé par un admin n'a pas de catégorie, ses
équipements tombent en `autre` — pas de compétence, certificat générique, pas d'icône. Le mapping
est invisible et non éditable, à l'encontre de la règle « toute config org éditable dans /settings ».

### 2.3 Deux sources de mapping divergent déjà

`contracts.service._pricingCodeToEquipmentCategory('chauffe_eau_solaire')` renvoie `ballon_ecs` ;
la donnée (`pricing_equipment_types.equipment_category`) dit `chauffe_eau_thermo`.
`EquipmentFormModal` utilise la donnée avec repli `'autre'`, `createEquipmentsFromPricingItems`
utilise l'heuristique JS. Sur le parc, la catégorie des 557 équipements typés est égale à celle de
leur type dans **556 cas** ; le seul écart est le panneau photovoltaïque (`autre` ↔ type sans mapping).

### 2.4 Le parc : 353 équipements sans type

Sur 910 équipements, 353 n'ont pas d'`equipment_type_id` — dont **92 sous contrat actif (84
contrats)**, qui reçoivent aujourd'hui une durée de repli dans les tournées (`construireFallbacks`,
durée du type dominant de la catégorie). 423 contrats actifs Mayer, dont 7 sans aucun équipement.
Un équipement non typé n'a donc **que sa catégorie** comme information : toute cible qui supprime
la catégorie casse ces 353 lignes.

### 2.5 Compétences : 7 membres, tous vides

`majordhome.team_members` Mayer (org majordhome `7825fe43…`) : Ludovic Robert, Antoine Verloo,
Mohammed (`include_in_routing = false`) en `technician` ; Eric Pudebat `admin` ; Philippe Mazel,
Michel Rieutord, Mathis Daguts `commercial`. **`specialties = '{}'` sur les 7** : il n'y a aucune
donnée de compétence à reprendre. Écriture par `team_member_set_routing_settings(uuid, integer,
boolean, text[])` (signature unique en base), lecture par `chargerJournees` (front + copie Deno).

### 2.6 Ce qui dépend de l'enum côté application

- **Certificat d'entretien** : `SECTIONS_PAR_EQUIPEMENT[category]` (`certificat/constants.js`)
  choisit ramonage / F-Gaz / brûleur / cendres / libellé des mesures / TVA par défaut. 80 certificats
  stockent la valeur enum dans `certificats.equipement_type` (**text**) : poele 70, pac_air_air 4,
  chaudiere_bois 4, chauffe_eau_thermo 1, pac_air_eau 1.
- **Tournées** : `techniciensEligibles` (catégories du contrat ⊆ `specialties`, `autre` ignoré) ;
  `construireFallbacks` / `dureeContrat` (replis par catégorie) ; `chargerContrat` (catégories).
- **Icônes** : `equipmentIcons.js` — par **code de type** (codes Mayer en dur), repli par enum pour
  le froid.
- **Libellés** : 9 constantes locales dupliquées (`EQUIPMENT_CATEGORIES` ×2, `CATEGORY_LABELS` ×3,
  `EQUIPMENT_CATEGORY_LABELS` ×3, `specialtyLabels.js`), en deux vocabulaires (famille / enum).
- **Filtre clients** `equipmentCategory` (`clients.service.js`) : défini, **jamais branché** à un écran.
- **Portail client** (`src/apps/client`) : libellés depuis une constante locale.
- **Vues** exposant `pet.category` (famille) sous le nom `equipment_type_category` :
  `majordhome_leads`, `majordhome_chantiers`, `majordhome_contract_pricing_items`,
  `majordhome_pricing_rates` — **zéro lecteur** (grep app, site vitrine, scripts).

### 2.7 Consommateurs externes

Le site vitrine dépend des **codes de types** (`EQUIPMENT_CODE_MAP` dans `api/aide-request`,
`p_equipements[].type` dans `api/entretien` → `process_web_entretien`) et de la vue
`majordhome_pricing_equipment_types` (`id, org_id, code, is_active`). Il n'a aucune dépendance à
l'enum ni aux familles. Les codes de types restent stables : **rien à changer côté site**.

## 3. Décisions arrêtées

| Sujet | Décision | Motif |
|---|---|---|
| Remplacement de l'enum | **Table `majordhome.equipment_categories` par org** (approche A). Rejetées : B « types seuls » (6 faux types « non précisé » dans tous les sélecteurs, gabarit dupliqué sur 14 lignes, repli compétence tordu pour les 353 non typés) ; C « garder l'enum, exposer le mapping » (toute catégorie nouvelle reste une migration) | Chaque org nomme et ordonne ses catégories sans migration ; les non typés gardent leur catégorie |
| Niveaux | **Deux** : catégorie → type. La famille tarifaire texte disparaît comme concept ; le regroupement des sélecteurs se fait par catégorie | Trois vocabulaires → un seul |
| Grain de la compétence | **Par type de la grille** (Eric, Q1) | Décision produit |
| Forme de la compétence | **M1 direct** : `team_member_skills(team_member_id, equipment_type_id, role)`, cochée **comme des droits** par l'org_admin dans Settings → Équipe. Rejetée : M2 « qualifications nommées » (une table de plus à gérer et paramétrer — « on verra plus tard ») | Eric, Q2 |
| Sémantique de la case | **Coché = compétent ; rien coché = jamais proposé.** Fin de la règle « vide = polyvalent » de la tranche 1 | Eric, Q3 — lecture « droits », sans règle magique qui réapparaît en décochant la dernière case |
| Reprise des compétences | **Tout coché** à la migration, Entretien **et** Pose, pour les techniciens actifs de rôle `technician` | Eric, Q3 — le lendemain du déploiement, mêmes propositions qu'aujourd'hui |
| Rôles | `entretien`, `pose` : constante app `SKILL_ROLES` + CHECK DB. `pose` est stocké et éditable, **consommé par rien** pour l'instant | « Paramétrable pour plus tard » = remplacer le CHECK par une table ; le moteur ne bouge pas |
| Équipement non typé | Exige « au moins un type coché **dans sa catégorie** » | Ni fail-open (un poêle non typé proposé à un frigoriste), ni blocage de 84 contrats actifs |
| Équipement typé | Sa catégorie **est** celle de son type, dérivée par trigger | Une seule source de mapping ; les deux heuristiques JS disparaissent |
| `autre` | N'existe plus comme catégorie : `category_id IS NULL` = **non catégorisé**, affiché tel quel, sans exigence de compétence | La règle « `autre` n'est pas une compétence » rendue explicite |
| Gabarit de certificat | Colonne `certificate_profile` sur la catégorie, **liste fermée niveau app** (7 profils), select explicite dans Settings | Le gabarit est du comportement (ce que le wizard sait produire), le libellé est de la config ; un mapping implicite par nom de code aurait échoué en silence sur une org nommant sa catégorie autrement |
| TVA par défaut du certificat | Colonne `default_vat_rate` sur la catégorie | Aujourd'hui `tvaDefaut` dans le code, par valeur enum |
| Nom physique de `pricing_equipment_types` | **Conservé**, documenté comme référentiel des types | 4 FK, 6 vues, site vitrine : un renommage est du churn pur |
| Colonne `pricing_equipment_types.category` | **Conservée**, redéfinie dès M1 comme **code de catégorie dénormalisé** maintenu par trigger, jamais écrit par l'app | Elle est NOT NULL et 4 vues lourdes en dépendent (dont `majordhome_leads`), zéro lecteur ; la supprimer forcerait un DROP/CREATE de `majordhome_leads` pour rien, la laisser « famille » casserait la création de types dès que le front cesse de l'envoyer |
| Codes de catégorie | **Immuables après création** (trigger + UI en lecture seule) | Les certificats (`equipement_type`) et, pour les types, le site vitrine désignent par code |
| Certificats existants | `certificats.equipement_type` reste un snapshot **text du code** de catégorie | Un artefact remis au client lit les valeurs enregistrées ; les 80 existants restent valides sans migration |
| Vues `v_planning`, `v_equipments_maintenance` | **DROP** à la contraction | Mortes, et elles bloquent le `DROP TYPE` |
| Typage des 353 équipements | **Hors périmètre** ; tag « type à renseigner » dans la liste des équipements comme incitation | Chantier de données, pas de structure |

## 4. Modèle de données

Les tables `pricing_*`, `equipment_categories` et `equipments` (via `core.projects`) portent l'org
**core** (`3c68193e…`) ; `team_members` porte l'org **majordhome** (`7825fe43…`) — asymétrie connue
(cf. CLAUDE.md, `getGrandSecteurMaps`). Elle interdit une FK composite entre compétences et types :
la cohérence est vérifiée dans la RPC (§4.8).

### 4.1 `majordhome.equipment_categories` (nouvelle, par org)

| Colonne | Type | Contraintes / rôle |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `org_id` | uuid | NOT NULL → `core.organizations(id)` ON DELETE CASCADE |
| `code` | text | NOT NULL, CHECK `code ~ '^[a-z0-9_]+$'`, UNIQUE `(org_id, code)`, **immuable** (trigger BEFORE UPDATE : `NEW.code <> OLD.code` → RAISE `23514`) |
| `label` | text | NOT NULL |
| `sort_order` | integer | NOT NULL DEFAULT 0 |
| `is_active` | boolean | NOT NULL DEFAULT true |
| `certificate_profile` | text | NOT NULL DEFAULT `'generique'`, CHECK ∈ {`combustion_bois`, `combustion_fossile`, `pac`, `ecs_thermo`, `ecs`, `aeraulique`, `generique`} |
| `default_vat_rate` | numeric(4,2) | NOT NULL DEFAULT 20, CHECK `>= 0 AND < 100` (pas de liste fermée : 8,5 % et 2,1 % existent dans les DOM) |
| `created_at`, `updated_at` | timestamptz | NOT NULL DEFAULT now(), trigger `majordhome.handle_updated_at` |

Contrainte supplémentaire `UNIQUE (id, org_id)` : cible de la FK composite de §4.2.

Les 7 profils reprennent **exactement** `SECTIONS_PAR_EQUIPEMENT` d'aujourd'hui, regroupés :

| Profil | Ramonage | F-Gaz | Brûleur | Cendres | Mesures | Valeurs enum couvertes |
|---|:-:|:-:|:-:|:-:|---|---|
| `combustion_bois` | ✓ | | ✓ | ✓ | combustion | poele, chaudiere_bois |
| `combustion_fossile` | ✓ | | ✓ | | combustion | chaudiere_gaz, chaudiere_fioul |
| `pac` | | ✓ | | | pac | pac_air_air, pac_air_eau, climatisation |
| `ecs_thermo` | | ✓ | | | ecs | chauffe_eau_thermo |
| `ecs` | | | | | ecs | ballon_ecs |
| `aeraulique` | | | | | aeraulique | vmc |
| `generique` | | | | | combustion | autre, familles sans mapping |

### 4.2 `majordhome.pricing_equipment_types` = référentiel des types de l'org

- `+ category_id uuid NOT NULL`, FK **composite** `(category_id, org_id) REFERENCES
  equipment_categories(id, org_id)` ON DELETE RESTRICT : un type ne peut structurellement pas
  pointer une catégorie d'une autre org (même garde-fou que `sources` dans la spec du 2026-08-12).
- `category` (text NOT NULL, ex-famille) : **dès M1**, redéfinie = **code de la catégorie**
  (backfill `category := cat.code`, puis trigger BEFORE INSERT/UPDATE
  `pricing_equipment_types_sync_category_code` qui la recalcule depuis `category_id`), **jamais
  écrite par l'app** (documentée « dénormalisée, lecture seule »). Faite en M1 et non en M2 parce
  que la colonne est NOT NULL : dès que le nouveau front cesse d'envoyer la famille, un INSERT sans
  trigger échouerait. Les 4 vues qui l'exposent en `equipment_type_category` continuent de
  fonctionner, avec un code de catégorie au lieu d'une famille (zéro lecteur).
- `equipment_category` (text) : supprimée à la contraction (seule sa vue miroir en dépend).
- Inchangé : `code` (UNIQUE org — le site vitrine en dépend), `label`, unités, durées, mois
  défavorables, `sort_order`, `is_active`. `is_entretien`, `aide_type`, `icon`, `description` :
  colonnes existantes non exposées, hors périmètre.

### 4.3 `majordhome.equipments.category_id` + trigger

- `+ category_id uuid NULL` → `equipment_categories(id)` ON DELETE RESTRICT. **NULL = non
  catégorisé.**
- Trigger `equipments_sync_category` BEFORE INSERT OR UPDATE OF `equipment_type_id`,
  `category_id`, `project_id` :
  1. si `NEW.equipment_type_id IS NOT NULL` : `NEW.category_id :=` la catégorie du type ; RAISE
     `23514` si `pet.org_id ≠ core.projects.org_id` du projet (défense en profondeur, inexistante
     aujourd'hui) ;
  2. sinon, si `NEW.category_id IS NOT NULL` : RAISE si la catégorie n'est pas de l'org du projet ;
  3. **transition uniquement (retirée en M2)** : `NEW.category :=` le code de la catégorie s'il est
     une étiquette de l'enum, sinon `'autre'` — le front cesse d'écrire `category` dès le
     déploiement, l'ancien front qui l'envoie encore est écrasé par la valeur cohérente.
- Index `idx_equipments_category_id`. `idx_equipments_category` disparaît avec la colonne.

**Invariant** : un équipement typé a la catégorie de son type ; un non typé porte la sienne ; un
équipement sans les deux est non catégorisé. Contrôle : `SELECT count(*) FROM equipments e JOIN
pricing_equipment_types t ON t.id = e.equipment_type_id WHERE e.category_id IS DISTINCT FROM
t.category_id` = 0, toujours.

### 4.4 `majordhome.certificats.equipement_type`

Reste `text` = **code** de la catégorie de l'équipement au moment du certificat. Nouveaux certificats :
`category.code`. Résolution du gabarit : par `equipment.category_id` quand le wizard part d'un
équipement, par `code` dans les catégories de l'org pour un certificat existant ; code inconnu →
profil `generique` **et bandeau affiché** (jamais un repli silencieux). Aucune migration de données :
les codes Mayer sont les valeurs enum.

### 4.5 `majordhome.team_member_skills` (nouvelle)

| Colonne | Type | Contraintes |
|---|---|---|
| `team_member_id` | uuid | NOT NULL → `team_members(id)` ON DELETE CASCADE |
| `equipment_type_id` | uuid | NOT NULL → `pricing_equipment_types(id)` ON DELETE CASCADE |
| `role` | text | NOT NULL, CHECK ∈ {`entretien`, `pose`} |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

PK `(team_member_id, equipment_type_id, role)`. Index secondaire sur `equipment_type_id`. Une ligne
= une case cochée. La cohérence d'org (type ∈ org core du membre) est garantie par la RPC (§4.8),
seule voie d'écriture.

`team_members.specialties` : plus lue ni écrite après bascule du front, **DROP en M2**.

### 4.6 Vues publiques

Toutes `WITH (security_invoker = true)`, miroirs simples (donc auto-updatables), `GRANT SELECT ON
majordhome.<table> TO service_role` pour chaque table nouvelle (règle CLAUDE.md, régression
2026-05-27).

| Vue | Changement | Mode |
|---|---|---|
| `majordhome_equipment_categories` | **nouvelle**, miroir, écriture CRUD via RLS org_admin (comme `majordhome_pricing_zones`) | CREATE |
| `majordhome_team_member_skills` | **nouvelle**, miroir, lecture ; écriture par RPC seule | CREATE |
| `majordhome_pricing_equipment_types` | M1 : `+ category_id` **en fin de liste** ; M2 : `− equipment_category` | M1 `CREATE OR REPLACE`, M2 DROP/CREATE + re-GRANT |
| `majordhome_equipments` | M1 : `+ category_id` en fin de liste ; M2 : `− category` | idem |
| `majordhome_client_equipment_kinds` | `category` = `cat.code` via `LEFT JOIN equipment_categories` (lecture seule) | DROP/CREATE + re-GRANT (M1) |
| `majordhome_team_members` | M2 : `− specialties` | DROP/CREATE + re-GRANT |
| `majordhome.v_planning`, `majordhome.v_equipments_maintenance` | **DROP** (M2) | — |

Gotchas appliqués : `CREATE OR REPLACE VIEW` n'ajoute qu'en fin de liste ; un `DROP VIEW` perd les
GRANT (re-GRANT explicite à `authenticated` et `service_role`, sinon `42501` silencieux côté edge) ;
les privilèges par défaut du schéma `public` donnent `SELECT` à `anon` sur toute vue nouvelle →
`REVOKE ALL ON public.majordhome_equipment_categories, public.majordhome_team_member_skills FROM
anon` explicite (la RLS protégerait les lignes, la charte veut le REVOKE quand même).

### 4.7 RLS et droits

- `equipment_categories` : RLS ON ; policies copiées des tables `pricing_*` — SELECT `org_id IN
  (org_members de auth.uid())`, INSERT/UPDATE/DELETE idem `AND om.role = 'org_admin'`.
  GRANT SELECT/INSERT/UPDATE/DELETE à `authenticated` (écriture via la vue), SELECT à `service_role`.
- `team_member_skills` : RLS ON ; SELECT si `team_member_id IN (team_members des orgs majordhome
  dont l'org core ∈ org_members de auth.uid())` ; **aucune policy d'écriture** (deny by default,
  l'écriture passe par la RPC SECURITY DEFINER). GRANT SELECT à `authenticated` et `service_role`.
- Audit post-migration : `has_function_privilege('anon', 'public.team_member_set_skills(uuid, text,
  uuid[])', 'EXECUTE')` = false ; `has_table_privilege('service_role',
  'majordhome.equipment_categories', 'SELECT')` et idem `team_member_skills` = true.

### 4.8 RPC

**`public.team_member_set_skills(p_team_member_id uuid, p_role text, p_equipment_type_ids uuid[])`**
— SECURITY DEFINER, `SET search_path = majordhome, core, public`. Remplace **atomiquement**
l'ensemble des types cochés pour (membre × rôle) : cocher une case, décocher, « tout cocher »
passent par la même primitive (DELETE puis INSERT dans la transaction de la fonction). Gardes,
toutes en autorisation positive :
1. `IF auth.uid() IS NULL THEN RAISE '42501'` en première instruction ;
2. org core du membre = `majordhome.organizations.core_org_id` via `team_members.org_id` ;
   membre introuvable → `P0002` ;
3. `SELECT role … WHERE user_id = auth.uid() AND org_id = v_core_org_id` puis `IF v_role IS DISTINCT
   FROM 'org_admin' THEN RAISE '42501'` ;
4. `IF (p_role = ANY (ARRAY['entretien', 'pose'])) IS NOT TRUE THEN RAISE '22023'` (un rôle NULL
   est refusé, pas laissé passer) ;
5. **tout** id de `p_equipment_type_ids` doit appartenir à `pricing_equipment_types` de
   `v_core_org_id` ; un seul id étranger → RAISE `23514` (jamais de filtrage silencieux).
Retourne `SETOF uuid` (les types écrits). `REVOKE EXECUTE … FROM PUBLIC, anon ; GRANT … TO
authenticated`.

**`majordhome.process_web_entretien`** (+ wrapper `public.`) — réécrite en M1 : plus de variable
typée `equipment_category`, plus d'insertion de `category` ; l'INSERT n'envoie que
`equipment_type_id` (résolu par `(org, code)` comme aujourd'hui), le trigger dérive
`category_id` (type inconnu → non catégorisé). Signature et sémantique inchangées pour le site.

**`public.team_member_set_routing_settings`** — M2 : `DROP FUNCTION … (uuid, integer, boolean,
text[])` puis recréation à 3 paramètres (`REVOKE PUBLIC, anon` ; `GRANT authenticated`). Le DROP
explicite est obligatoire : PostgREST ne départage pas deux surcharges à défauts.

## 5. Règle d'éligibilité (moteur pur `src/lib/tournee/proposer-contrat.js`)

```js
// role ∈ SKILL_ROLES, OBLIGATOIRE : un appel sans rôle est une erreur, pas « entretien » implicite.
techniciensEligibles(contrat, techniciens, role)
```

- **Exigences du contrat** (`contrat.exigences`, calculées par `chargerContrat`) : pour chaque
  équipement, `{ typeId }` s'il est typé ; sinon `{ categoryId }` s'il est catégorisé ; sinon rien
  (non catégorisé = aucune exigence, déjà compté dans `typesNonRenseignes`).
- **Technicien** : `competences = { entretien: string[], pose: string[] }` (ids de types), chargé
  depuis `majordhome_team_member_skills` par `chargerJournees`. Le loader fournit aussi
  `typesParCategorie: Map<categoryId, typeId[]>` (types de l'org).
- **Éligible ssi** `competences[role].length > 0` **et** chaque `typeId` exigé ∈ `competences[role]`
  **et** pour chaque `categoryId` exigée, `typesParCategorie.get(categoryId)` ∩ `competences[role]`
  ≠ ∅.
- Contrat sans équipement (7 actifs) : aucune exigence → éligible pour tout technicien ayant au
  moins une case pour le rôle.
- `journeesCandidates` et `proposerPourContrat` reçoivent `role` et le propagent ; `slots-propose`
  passe `'entretien'`. Le motif `competence` (aucun technicien éligible) existe déjà et reste.
- Durées : `dureeContrat` / `construireFallbacks` inchangés dans leur logique ; clé `category_id`
  (uuid) au lieu de `category` (code enum). `contrat.categories` devient `[{ id, code, label }]`
  (affichage), distinct des exigences.

Constante partagée : `SKILL_ROLES = ['entretien', 'pose']` dans un module pur
(`src/lib/tournee/competences.js`, copié pour Deno par `npm run sync:tournee-engine`), reflétée par
le CHECK DB. Tests : `scripts/tournee/proposer-contrat.test.mjs` (rôle, exigence type, exigence
catégorie, technicien à zéro case, contrat sans équipement), `loaders.test.mjs` (vue skills),
`duree.test.mjs` (clés uuid), `sync-engine.test.mjs` (copies identiques).

## 6. Surfaces

### 6.1 Settings → Tarification (`/settings/pricing`, org_admin)

- Nouvel onglet **« Catégories »** avant « Types d'équipement », dans un fichier séparé
  (`pages/settings/pricing/CategoriesTab.jsx` — `PricingSettings.jsx` fait déjà 1055 LOC, on ne
  l'engraisse pas). Tableau : ordre · code · libellé · gabarit certificat · TVA · actif · nombre de
  types. Modale : **code saisi une fois, en lecture seule ensuite** ; libellé ; ordre ; gabarit =
  select des 7 profils avec une phrase en clair (« Combustion bois : ramonage, brûleur, cendres,
  mesures de combustion ») ; TVA (5,5 / 10 / 20) ; actif. Suppression refusée par la base si des
  types ou équipements pointent dessus (FK RESTRICT) → toast « des types/équipements l'utilisent,
  désactivez-la ».
- Onglet « Types d'équipement » : le select **« Famille » devient « Catégorie », obligatoire**,
  alimenté par les catégories actives de l'org ; colonne Catégorie dans le tableau ; la constante
  `EQUIPMENT_CATEGORIES` (familles) disparaît. Une org sans catégorie ne peut pas créer de type —
  l'écran le dit et pointe vers l'onglet Catégories.

### 6.2 Settings → Équipe (`/settings/team`, org_admin)

- Les chips `SpecialtiesEditor` sont remplacées par un bouton **« Compétences »** sur chaque
  membre de rôle planning `technician`, avec compteur sur la ligne (« Entretien 12/14 · Pose
  14/14 »). Les autres rôles (admin, commercial) n'ont pas de grille : `chargerJournees` ne les
  charge pas.
- Panneau `pages/settings/team/SkillsPanel.jsx` : **lignes = types actifs de l'org groupés par
  catégorie** (ordre des catégories puis des types), **colonnes = Entretien / Pose**, case « tout »
  par catégorie et par colonne. Chaque coche appelle `team_member_set_skills` avec l'ensemble
  recalculé (erreur → la case revient, toast). Zéro case en Entretien → avertissement sur la
  ligne du membre : « aucune compétence cochée : jamais proposé en tournée ». Colonne Pose :
  mention « pas encore utilisée par l'application (planification des installations à venir) ».
- Lecture seule pour un non-admin (même garde `isOrgAdmin` que la couleur et le budget journalier).

### 6.3 Fiche client → Équipements

- `EquipmentFormModal` : select des types **groupé par catégorie de l'org**, le formulaire n'envoie
  plus que `equipmentTypeId` ; plus de dérivation d'enum ni de repli `'autre'`.
- `EquipmentList` : « Catégorie · Type » via le référentiel chargé (résolution par id côté client,
  comme pour les types aujourd'hui) ; un équipement **sans type** porte un tag discret « type à
  renseigner » — l'édition (choisir un type) suffit, la catégorie suit par trigger.

### 6.4 Certificat d'entretien

- Gabarit = `certificate_profile` de la catégorie (via l'équipement, ou par code pour un certificat
  existant) ; TVA par défaut = `default_vat_rate`. `SECTIONS_PAR_EQUIPEMENT` devient
  `SECTIONS_PAR_PROFIL` (7 clés fermées, dans le code : c'est du comportement, pas de la config).
- `StepEquipementType` propose les **catégories de l'org** (libellés) au lieu de l'enum ; la
  valeur enregistrée reste le code.

### 6.5 Tournées / CTA « Trouver le créneau optimisé »

Aucun changement visible. Le panneau `CreneauxProposesPanel` affiche déjà le motif `competence` et
`typesNonRenseignes` ; les catégories du contrat s'affichent par libellé si besoin.

### 6.6 Un seul point de vocabulaire

- `usePricingData()` expose `categories` (actives) en plus de `equipmentTypes` ; `usePricingAdmin()`
  expose `categories` (toutes) + `createCategory` / `updateCategory` / `deleteCategory`. Clé
  `pricingKeys.categories(orgId)` ; toute mutation de catégorie invalide `pricingKeys.all(orgId)`.
- Helper pur `src/lib/equipmentReferential.js` (testé `scripts/equipment-referential.test.mjs`) :
  `indexReferentiel({ categories, equipmentTypes })` → maps id → libellé, `typesParCategorie`,
  `grouperTypesParCategorie()` pour les optgroups, `libelleEquipement(equipement, index)`.
- Les 9 constantes locales disparaissent ; consommateurs migrés : optgroups du pipeline
  (`LeadFormSections`, `CreateLeadFromQuoteModal`), `FicheTechniquePdf`, mailing (`resources.js`,
  `SegmentBuilderDrawer`), étiquettes (`TabInterventions`, `CertificatEquipmentRow`), portail client
  (`ClientEquipements`, `ClientContrat`), `PricingSettings`, `EquipmentFormModal`, `EquipmentList`.
- Le filtre `equipmentCategory` de `clients.service.js` / `useClients.js` n'est branché à aucun
  écran : **supprimé**, pas migré.

## 7. Migration et reprise

Deux migrations rejouables (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP … IF EXISTS`), séparées
par une fenêtre d'observation. Tous les chiffres ci-dessous sont comptés en prod le 2026-09-12 et
sont **re-comptés par la migration elle-même** (`RAISE NOTICE` des totaux) — pas présumés.

### 7.1 M1 — expansion (`20260913_1_referentiel_equipements_expansion.sql`)

Purement additive : compatible avec le front et l'edge en production au moment où elle passe.

1. `equipment_categories` : table, contraintes, triggers (`updated_at`, code immuable), RLS,
   policies, vue, GRANT.
2. **Semis dérivé des données, aucun UUID en dur.** Pour chaque org ayant des types (= Mayer) :
   une catégorie par valeur distincte de `COALESCE(pet.equipment_category, pet.category)`, avec
   libellé / profil / TVA lus dans une table de correspondance versionnée dans la migration
   (les 10 valeurs enum hors `autre` + les familles sans mapping → `generique`, TVA 20, libellé
   = famille capitalisée) ; `sort_order` = min du `sort_order` des types. Garde-fou : toute valeur
   enum portée par des équipements de l'org et absente de ses types crée aussi sa catégorie
   (Mayer : aucune). Résultat Mayer, **7 catégories** :

   | Code | Libellé | Profil | TVA | Types | Équipements après reprise |
   |---|---|---|---:|---:|---:|
   | `poele` | Poêle | combustion_bois | 5,5 | 4 | 708 |
   | `chaudiere_bois` | Chaudière bois | combustion_bois | 5,5 | 2 | 69 |
   | `pac_air_air` | PAC Air/Air | pac | 5,5 | 1 | 60 |
   | `pac_air_eau` | PAC Air/Eau | pac | 5,5 | 1 | 25 |
   | `climatisation` | Climatisation | pac | 20 | 1 | 24 |
   | `chauffe_eau_thermo` | Chauffe-eau thermodynamique | ecs_thermo | 10 | 2 | 16 |
   | `energie` | Énergie | generique | 20 | 3 | 1 |

3. `pricing_equipment_types.category_id` : ADD COLUMN, UPDATE par `(org_id, code)` de catégorie →
   **14/14** résolus, puis `SET NOT NULL` + FK composite. La migration échoue (pas de NOT NULL) si un
   type reste sans catégorie : échec fort, pas de repli. Puis `UPDATE pet SET category = cat.code`
   (la famille devient le code de catégorie, §4.2) + trigger
   `pricing_equipment_types_sync_category_code`.
4. `equipments.category_id` : ADD COLUMN ; **557 typés** ← catégorie de leur type (dont le panneau
   photovoltaïque `autre` → `energie`, seul écart, voulu : « le type gagne ») ; **346 non typés** ←
   catégorie de même code dans l'org du projet (poele 303, chaudiere_bois 24, climatisation 11,
   pac_air_eau 7, chauffe_eau_thermo 1) ; **7 `autre` non typés → NULL**. Bilan attendu : 903
   catégorisés, 7 non catégorisés, 0 violation de l'invariant §4.3. FK + index.
5. Trigger `equipments_sync_category` (avec branche legacy enum).
6. `team_member_skills` : table, RLS, vue, GRANT ; RPC `team_member_set_skills`.
7. **Semis « tout coché »** : pour chaque `majordhome.organizations` o, `team_members` de o avec
   `role = 'technician' AND is_active` × `pricing_equipment_types` de `o.core_org_id` avec
   `is_active` × `SKILL_ROLES` → Mayer **3 × 14 × 2 = 84 lignes** (Ludovic, Antoine, Mohammed —
   Mohammed reste hors tournées par `include_in_routing`, la grille ne change rien) ; Cimaj : 0 type
   → 0 ligne.
8. Vues : `majordhome_pricing_equipment_types` et `majordhome_equipments` reçoivent `category_id` en
   fin de liste (`CREATE OR REPLACE`) ; `majordhome_client_equipment_kinds` DROP/CREATE + re-GRANT.
9. `process_web_entretien` réécrite (§4.8).
10. `RAISE NOTICE` des 4 comptages (catégories, types résolus, équipements catégorisés / non,
    compétences) pour comparaison avec cette spec.

### 7.2 Déploiement front + moteur

- Front : services, hooks, écrans (§6), moteur pur (§5) ; `npm run sync:tournee-engine` ; tests.
- Edge `slots-propose` redéployée avec les copies `_shared/tournee` synchronisées (`role:
  'entretien'`).
- Pendant la fenêtre entre M1 et ce déploiement, l'ancien front et l'ancien edge continuent de
  fonctionner : `specialties` existe toujours (toutes vides = polyvalent), les vues ont seulement
  gagné une colonne, `category` est encore alimentée par le trigger. **Aucun instant sans CTA.**

### 7.3 Fenêtre d'observation (≥ 1 semaine)

- Contrat témoin (un poêle typé, un contrat avec équipement non typé) : mêmes créneaux avant / après
  (capture avant M1).
- Eric édite la grille de compétences ; création d'une catégorie + d'un type dans Cimaj **sans
  migration**.
- Contrôle SQL quotidien : invariant §4.3 = 0 ; aucun équipement inséré sans `category_id` alors
  qu'il a un type.

### 7.4 M2 — contraction (`20260920_1_referentiel_equipements_contraction.sql`)

1. `DROP VIEW IF EXISTS majordhome.v_planning, majordhome.v_equipments_maintenance`.
2. `equipments` : DROP du trigger `tr_equipments_sync_category` (sa liste `UPDATE OF … category` dépend
   de la colonne — trouvé à la répétition), DROP VIEW `majordhome_equipments`, `ALTER TABLE … DROP COLUMN
   category` (l'index suit), **`DROP TYPE majordhome.equipment_category`**, recréation de la vue (miroir +
   `category_id`) + re-GRANT ; trigger recréé sans branche legacy.
3. `pricing_equipment_types` : DROP VIEW `majordhome_pricing_equipment_types` ; `DROP COLUMN
   equipment_category` ; recréation de la vue (`category` = code dénormalisé depuis M1,
   `category_id`) + re-GRANT. Les 4 vues dépendantes (`majordhome_leads`, `_chantiers`,
   `_contract_pricing_items`, `_pricing_rates`) ne sont **pas touchées**.
4. `team_members` : DROP VIEW `majordhome_team_members`, `DROP COLUMN specialties`, recréation +
   re-GRANT ; `team_member_set_routing_settings` ramenée à 3 paramètres (§4.8).
5. **Pas de retour arrière après M2** (le type enum n'existe plus) — d'où la fenêtre.

### 7.5 Plan de retour

| Moment | Retour |
|---|---|
| Après M1 seule | Rien à faire : additif, l'ancien code ignore les colonnes nouvelles |
| Après le déploiement front + edge | Redéployer la version précédente du front et de l'edge : `specialties` et `category` (enum) sont toujours là, encore alimentés — c'est la raison d'être des deux temps |
| Après M2 | Aucun ; la fenêtre d'observation est le garde-fou |

### 7.6 Semis d'une nouvelle organisation

Aucun semis automatique : l'org_admin crée ses catégories puis ses types dans Settings (c'est le
critère de succès n° 6). Un éventuel « copier le référentiel de Mayer comme modèle » (pattern
`org_seed_permissions`) est une RPC de 30 lignes à décider à l'onboarding, pas maintenant.

## 8. Impacts fichier par fichier

### Base (`supabase/migrations/`)
- `20260913_1_referentiel_equipements_expansion.sql` — §7.1.
- `20260920_1_referentiel_equipements_contraction.sql` — §7.4.

### Moteur de tournées (pur, copié pour Deno)
- `src/lib/tournee/competences.js` — **nouveau** : `SKILL_ROLES`, `estRoleValide()`.
- `src/lib/tournee/proposer-contrat.js` — `techniciensEligibles(contrat, techniciens, role)`,
  `journeesCandidates` / `proposerPourContrat` propagent `role` ; exigences type / catégorie.
- `src/lib/tournee/loaders.js` — `chargerJournees` : lit `majordhome_team_member_skills` → `competences
  {entretien, pose}` ; `chargerContrat` : `category_id`, `exigences`, `categories [{id, code,
  label}]`, `typesParCategorie` ; replis par `category_id`.
- `src/lib/tournee/duree.js` — inchangé fonctionnellement (clé uuid) ; JSDoc.
- `supabase/functions/_shared/tournee/*` — copies (`npm run sync:tournee-engine`), jamais éditées.
- `supabase/functions/slots-propose/index.ts` — `role: 'entretien'` ; réponse `contrat.categories`
  en objets.
- Tests : `scripts/tournee/proposer-contrat.test.mjs`, `loaders.test.mjs`, `duree.test.mjs`,
  nouveau `competences.test.mjs` ; `sync-engine.test.mjs` inchangé.

### Services (`src/shared/services/`)
- `equipmentCategories.service.js` — **nouveau** : `getCategories(orgId, { activeOnly })`,
  `createCategory`, `updateCategory`, `deleteCategory` via `majordhome_equipment_categories`
  (`pricing.service.js` fait 796 LOC : on n'y ajoute pas un CRUD).
- `teamSkills.service.js` — **nouveau** : `getTeamMemberSkills(orgId)` (vue, filtrée par les membres
  de l'org), `setTeamMemberSkills(teamMemberId, role, equipmentTypeIds)` (RPC).
- `pricing.service.js` — payload des types : `category_id` (plus `category`) ; `getEquipmentTypes`
  inchangé (`select('*')`).
- `equipments.service.js` — `addEquipment` / `updateEquipment` n'écrivent plus `category` ;
  description d'activité par libellé ; `getEquipmentKindsByOrg` inchangé (vue recréée).
- `contracts.service.js` — **suppression** de `_pricingCodeToEquipmentCategory` ;
  `createEquipmentsFromPricingItems` n'envoie que `equipment_type_id`.
- `clients.service.js` — suppression de `EQUIPMENT_CATEGORIES` et du filtre `equipmentCategory`.
- `interventions.service.js` — enrichissement `equipment_category_id` (+ libellé côté écran).
- `appointments.service.js` — `setTeamMemberRoutingSettings` sans `specialties` (dès le front, avant
  M2 la RPC à 4 paramètres accepte l'omission) ; `getTeamMembers` fait `select('*')`, rien à changer.

### Hooks (`src/shared/hooks/`)
- `cacheKeys.js` — `pricingKeys.categories(orgId)` ; `teamSkillKeys = { all: (orgId) =>
  ['teamSkills', orgId] }`.
- `usePricing.js` — `usePricingData` (+ `categories`), `usePricingAdmin` (+ 3 mutations).
- `useTeamSkills.js` — **nouveau** : `useTeamSkills(orgId)`, `useSetTeamMemberSkills()`.
- `useAppointments.js` — mutation routing sans `specialties` (y compris la fusion optimiste du
  cache `useTeamMembers`, qui recopie `row.specialties` aujourd'hui).
- `useClients.js` — retrait de `equipmentCategory`.
- `components/planning/TechnicianSelect.jsx` — retrait de l'affichage `member.specialties`
  (chaîne brute héritée, sans lecteur métier) ; `SlotDraftList.jsx` : JSDoc seulement.

### Écrans (`src/apps/artisan/`)
- `pages/settings/pricing/CategoriesTab.jsx` — **nouveau** (§6.1).
- `pages/settings/PricingSettings.jsx` — onglet Catégories monté ; modale type : select Catégorie ;
  retrait de `EQUIPMENT_CATEGORIES`.
- `pages/settings/team/SkillsPanel.jsx` — **nouveau** (§6.2) ; **suppression** de
  `SpecialtiesEditor.jsx` et `specialtyLabels.js`.
- `pages/settings/TeamManagement.jsx` — colonne Compétences → bouton + compteur + avertissement.
- `components/clients/EquipmentFormModal.jsx`, `EquipmentList.jsx` — §6.3.
- `components/certificat/constants.js` (`SECTIONS_PAR_PROFIL`, retrait de
  `EQUIPMENT_CATEGORY_LABELS`), `CertificatWizard.jsx`, `steps/StepEquipementType.jsx`,
  `steps/StepInfosGenerales.jsx`, `steps/StepSignature.jsx`, `CertificatPDF.jsx`,
  `components/entretiens/CertificatEquipmentRow.jsx` — §6.4.
- `pages/client-detail/TabInterventions.jsx`, `components/pipeline/LeadStatusConfig.js` (retrait
  de `EQUIPMENT_CATEGORY_LABELS`), `LeadFormSections.jsx`, `components/devis/CreateLeadFromQuoteModal.jsx`,
  `components/pipeline/FicheTechniquePdf.jsx`, `components/mailing/resources.js`,
  `SegmentBuilderDrawer.jsx` — §6.6.
- `src/apps/client/constants.js` (retrait), `pages/ClientEquipements.jsx`, `pages/ClientContrat.jsx`.
- `src/lib/equipmentReferential.js` — **nouveau**, pur, testé.

### Documentation
- `docs/DATABASE.md` — `equipment_categories`, `team_member_skills`, colonnes `category_id`,
  disparition de l'enum et de `specialties`.
- `docs/MODULE_ENTRETIENS.md` — compétences par type × rôle, règle d'éligibilité.
- `CLAUDE.md` — section « Module Tarification » → « Référentiel équipements & Tarification » ;
  proposition déposée dans `.claude/proposed-updates.md` (PENDING), jamais intégrée sans accord.

### Hors dépôt
- Site vitrine : **rien** (codes de types stables, signature de `process_web_entretien` inchangée).
- N8N : aucun workflow connu ne lit `equipment_type_category` ni `specialties` ; à confirmer par grep
  des exports avant M2.

## 9. Périmètre

**Dans le périmètre** : tout ce qui précède, en trois tranches d'implémentation (plan à écrire) :
T1 = référentiel catégories (M1 + Settings Tarification + lecteurs) ; T2 = compétences (grille +
moteur + edge) ; T3 = contraction (M2). T1 et T2 peuvent être livrées ensemble ; M1 les précède.

**Hors périmètre, assumé** :
- Typer les 353 équipements sans type (chantier de données ; le tag « type à renseigner » est
  l'incitation).
- Consommer `pose` (assistant créneaux installation, `SectionAssignee`) — la colonne est prête.
- Icônes par type (`equipmentIcons.js` code en dur les codes Mayer ; la colonne `icon` existe sur
  les types — passage dédié).
- Renommage physique de `pricing_equipment_types` ; exposition de `is_entretien`, `aide_type`,
  `icon`, `description`.
- Référentiel de qualifications (M2 de la Q2) ; rôles par org (le CHECK suffit).
- Immuabilité du `code` des **types** (le site vitrine en dépend) — signalé, pas traité.

## 10. Critères de succès

Tous vérifiables par une commande ; aucun « ça a l'air bon ».

1. **Reprise** (SQL après M1) : 7 catégories Mayer ; `count(*) FROM pricing_equipment_types WHERE
   category_id IS NULL` = 0 ; équipements catégorisés = 903, non catégorisés = 7 ; invariant §4.3
   = 0 ; `count(*) FROM team_member_skills` = 84.
2. **Droits** : `has_function_privilege('anon', 'public.team_member_set_skills(uuid, text, uuid[])',
   'EXECUTE')` = false ; `has_table_privilege('service_role', 'majordhome.equipment_categories',
   'SELECT')` = true ; idem `team_member_skills` ; `anon` sans `SELECT` sur les deux vues nouvelles.
3. **Moteur** : `node --test scripts/tournee/*.test.mjs` vert (dont les 5 cas de §5) ;
   `scripts/tournee/sync-engine.test.mjs` vert après sync.
4. **Non-régression du CTA** : sur le contrat témoin, mêmes créneaux avant M1 et après déploiement ;
   sur un contrat dont l'unique technicien compétent est décoché → motif `competence`.
5. **Certificat** : un des 80 certificats existants rouvert → même gabarit (poêle : ramonage,
   brûleur, cendres) ; nouveau certificat sur un équipement PAC → F-Gaz, TVA 5,5.
6. **Multi-tenant sans migration** : dans Cimaj, créer une catégorie puis un type dans Settings ;
   le type apparaît groupé sous sa catégorie dans `EquipmentFormModal` d'un client Cimaj.
7. **Qualité** : `npm run build`, `npm run lint:errors`, `npm run audit:dead-code` (les 9 constantes
   et 2 fichiers supprimés ne laissent aucun orphelin nouveau ; `sequence.js` reste l'orphelin connu).
8. **Contraction** (après M2) : `SELECT 1 FROM pg_type WHERE typname = 'equipment_category'` vide ;
   `majordhome_team_members` sans `specialties` ; `team_member_set_routing_settings` à 3 paramètres ;
   site vitrine : une soumission `/api/entretien` de test crée l'équipement avec `category_id`.

## 11. Risques et gotchas

| Risque | Parade |
|---|---|
| `DROP VIEW` perd les GRANT → `42501` silencieux côté edge | Re-GRANT explicite (`authenticated`, `service_role`) dans chaque recréation ; audit `has_table_privilege` en fin de migration |
| `CREATE OR REPLACE VIEW` refuse une colonne ailleurs qu'en fin de liste | M1 n'ajoute qu'en fin ; M2 passe par DROP/CREATE |
| Surcharge PostgREST sur `team_member_set_routing_settings` | DROP explicite de la signature à 4 paramètres avant CREATE |
| Fenêtre M1 → déploiement : l'ancien `EquipmentFormModal` envoie encore `category` | Le trigger écrase `category` par la valeur dérivée de `category_id` : cohérent quoi qu'envoie le front |
| Fenêtre M1 → déploiement : l'ancien front lit `pet.category` comme une famille | Cosmétique : les optgroups affichent le code brut (`CATEGORY_LABELS[c] \|\| c`), le select « Famille » de l'ancienne modale de type est vide ; un enregistrement dans cette fenêtre est corrigé par le trigger. Déployer le front dans la foulée de M1 |
| Un type sans catégorie après reprise (org future avec `equipment_category` exotique) | `SET NOT NULL` fait échouer la migration : échec fort, correction humaine |
| Grille « tout décoché » par erreur sur un technicien | Avertissement rouge sur la ligne ; le CTA remonte `competence` ; rien n'est silencieux |
| `pose` cochée « pour rien » | Assumé (Eric) ; l'écran dit que la colonne n'est pas consommée |
| `equipment_type_category` (4 vues) change de sens famille → code | Zéro lecteur vérifié (app, site, scripts) ; grep N8N avant M2 |
| Codes de catégorie renommés après coup | Trigger d'immuabilité + UI en lecture seule ; les 80 certificats et le site dépendent des codes |
| Une catégorie supprimée sous un équipement | FK RESTRICT : la base refuse, l'écran explique « désactivez-la » |

## 12. Dette signalée, non embarquée

- `PricingSettings.jsx` (1055 LOC), `TeamManagement.jsx` (890), `pricing.service.js` (796),
  `appointments.service.js` (870), `clients.service.js` (1015) dépassent les seuils de CLAUDE.md :
  le nouveau code va dans des fichiers séparés, la décomposition est un passage dédié.
- `equipmentIcons.js` : codes Mayer en dur (`KIND_BY_TYPE_CODE`) — à basculer sur la colonne
  `icon` des types.
- `certificats.equipement_type` pourrait porter `category_id` en plus du code : inutile tant que
  les codes sont immuables.
- `src/lib/tournee/sequence.js` : orphelin connu de `audit:dead-code` (à supprimer ou allowlister).
