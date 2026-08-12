# Sources et statuts : désignation par clé, sources par organisation

> Spec de design — 2026-08-12. Statut : **en attente de validation par Eric**.
> Dernier obstacle structurel côté web à l'onboarding d'une 2ᵉ entreprise.
> Touche aussi `C:\Dev\Landing Page - Mayer` (2ᵉ consommateur de la même base) et le workflow N8N Meta.

## 1. Problème

`majordhome.sources` et `majordhome.statuses` n'ont pas de colonne `org_id`. Une 2ᵉ entreprise
hérite donc des sources et des statuts de Mayer.

Ce n'est plus une hypothèse : **trois organisations ont déjà des leads** et partagent le même jeu.

| Org | Leads | Sources utilisées |
|---|---|---|
| Mayer Energie (`3c68193e…`) | 416 | 11 des 15 |
| Cimaj (`62cd2073…`) | 4 | Site Web ×2, Prospection directe ×1, aucune ×1 |
| H&E (`65aea930…`) | 1 | Bouche-à-oreille ×1 |

Mais l'absence d'`org_id` n'est que la moitié du problème. L'autre moitié, plus coûteuse :
**le libellé et la position d'un statut sont du code.** Trois façons concurrentes de désigner la
même étape coexistent dans 10 fonctions SQL, 8 vues et une douzaine de fichiers frontend.

| Fonction | position | libellé | drapeau |
|---|:---:|:---:|:---:|
| `enforce_devis_envoye_requires_quote` | ✓ | | |
| `lead_mark_won_with_quote` | ✓ | ✓ | |
| `lead_attach_quotes_and_send` | ✓ | ✓ | |
| `assign_pennylane_quote_to_lead` | ✓ | ✓ | |
| `pennylane_sync_auto_attach_quote` | ✓ | ✓ | |
| `mail_segment_compile` | | ✓ | |
| `promote_lead_to_gagne` | | | ✓ |
| `demote_lead_to_perdu` | | | ✓ |
| `process_pennylane_quote` | | | ✓ |

C'est ce qui a rendu 75 leads « Perdu » invisibles en juin, quand une migration a inséré une étape
au milieu du tunnel (documenté dans `CLAUDE.md`, § vue `majordhome_kanban_cards`).

## 2. Ce que la vérification a établi (2026-08-12)

Requêtes sur `ejqqqwudmizqisdkxohw` + lecture des deux dépôts.

### 2.1 Le drapeau, présenté comme le repère robuste, est celui qui casse le plus fort

```sql
-- promote_lead_to_gagne, demote_lead_to_perdu, process_pennylane_quote
SELECT id INTO v_status_won_id FROM majordhome.statuses WHERE is_won = true LIMIT 1;
```

Aucun filtre `org_id`, un `LIMIT 1`. Correct aujourd'hui parce qu'il n'existe qu'un seul jeu.
Le jour où `statuses` devient per-org, `promote_lead_to_gagne` sur un lead Cimaj peut poser le
« Gagné » de Mayer — sans erreur, sans trace. `is_won` / `is_final` sont la bonne **sémantique** ;
le code qui s'en sert est la pire **implémentation** des trois.

### 2.2 « Les sources sont libres, aucun code ne dépend de leur identité » est faux

**7 des 15 sources sont désignées par UUID depuis du code**, via variable d'environnement côté site
vitrine et en dur dans le node N8N :

| Source | Leads | Désignée par |
|---|---:|---|
| Meta Ads | 165 | workflow N8N → `create_lead_from_webhook` |
| Site Web | 68 | `SOURCE_SITE_WEB_ID` (`api/contact`, `api/aide-request`) |
| Tesla | 2 | `SOURCE_TESLA_ID` |
| Offre Combustible TotalEnergies | 1 | `SOURCE_OFFRE_COMBUSTIBLE_ID` |
| Web/PAC | 1 | `SOURCE_WEB_PAC_ID` |
| Bornes IRVE | 0 | `SOURCE_BORNES_IRVE_ID` (2 routes) |
| Offre Bricafeu | 0 | `SOURCE_OFFRE_BRICAFEU_ID` |

Les 8 autres (CBM, Client Existant, Bouche-à-oreille, Prospection directe, Salon / Foire,
Recommandation client, Google Ads, Urgence SAV Site Web) sont de vraies étiquettes libres.

### 2.3 La désignation par UUID est déjà défaillante

`app/api/borne-recharge/commande-pro/route.ts` passe `STATUS_A_PLANIFIER_ID`, de repli
`b7e6a3d2-4c0f-4e8a-9d21-3f5b8c7a1e90` — **ce statut n'existe pas** (l'« À planifier » de la
migration Webshop, revertée le 2026-06-15). L'erreur est avalée : *« Non bloquant : la commande
webshop reste la source de vérité »*. La commande est enregistrée, l'e-mail part, **le lead
disparaît en silence**. `majordhome.webshop_orders` contient une commande (2026-06-12) avec
`lead_id IS NULL` — un cas sur un, donc pas une preuve, mais cohérent.

### 2.4 Aucune contrainte n'interdit l'attribution cross-org

`create_website_lead` ne vérifie jamais que `p_source_id` / `p_status_id` appartiennent à
`p_org_id`. Elle insère tel quel.

### 2.5 Une partie de la moitié « org » est déjà faite côté site

Sur `origin/main` du site vitrine, `7424b4d` puis `d6b18cd` ont posé `lib/org.ts` (`getOrgId()`,
volontairement bruyant si `MAJORDHOME_ORG_ID` manque) et les 7 routes passent `p_org_id`.
Restent exactement les `SOURCE_*_ID` et `STATUS_*_ID` — ce que traite cette spec.

### 2.6 Droits en base

- `sources` et `statuses` : RLS activée, unique policy `SELECT USING (true)`, `anon` a le `SELECT`.
- `anon` et `authenticated` ont `INSERT, UPDATE, DELETE` sur `statuses` (inoffensif en pratique —
  la RLS n'a pas de policy pour ces verbes — mais les GRANT traînent).
- **Hors périmètre, signalé séparément** : `promote_lead_to_gagne` et `demote_lead_to_perdu` sont
  exécutables par `anon` sans aucune garde d'autorisation.

## 3. Décisions arrêtées

| Sujet | Décision | Motif |
|---|---|---|
| Forme du tunnel | **Non modifiable.** Ni ajout, ni suppression, ni réordonnancement | 3 des 6 étapes ne sont pas des étapes mais des points de jonction : supprimer « Devis envoyé » débranche Pennylane, supprimer « Gagné » supprime la création de chantier |
| `statuses` per-org | **Non.** Pas d'`org_id` | Le contenu ne varie pas ; le dupliquer paierait le coût du multi-tenant pour zéro liberté, et multiplierait les points à scoper |
| Renommer / recolorer un statut | **Pas en V1** | Vocabulaire CRM français standard, aucun besoin exprimé. Chaque override est du code à maintenir |
| `sources` per-org | **Oui**, `org_id NOT NULL` | Étiquettes réellement propres à chaque entreprise |
| Source d'un lead | **Attribut mutable.** Réaffecter réécrit l'historique | Une source est un classement, pas un fait mesuré : le corriger est le but. Une 2ᵉ colonne « d'origine » recréerait le piège de `leads.status_id` face au kanban |
| Fonctionnalité « scinder » | **Non construite** | Une scission n'a pas de règle : c'est un arbitrage humain lead par lead, donc un écran de réaffectation |
| Gardes qui varient par org | Via `core.organizations.settings` | Motif déjà en place et fonctionnel (cf. §4.4) |

### 3.1 Ce qui est du code et ce qui est de la config

Le trigger `enforce_devis_envoye_requires_quote` désarme déjà sa garde pour une org sans Pennylane :

```sql
SELECT COALESCE((settings->'pennylane'->>'enabled')::bool, false) INTO v_pl_enabled
FROM core.organizations WHERE id = NEW.org_id;
IF NOT COALESCE(v_pl_enabled, false) THEN RETURN NEW; END IF;
```

D'où la règle générale, à graver dans `CLAUDE.md` :

> **La forme du tunnel est du code. Les gardes posées dessus sont de la config.**
> Une valeur de référence se désigne par sa **clé**, jamais par son libellé ni par sa position.
> Les tables de référence partagées par toutes les orgs (`statuses`) n'ont pas d'`org_id`.
> Celles qui varient par org (`sources`) ont `org_id` **plus** une clé optionnelle pour les
> entrées qu'une intégration désigne.

### 3.2 Identité et rang : deux besoins distincts, deux repères

Une partie des usages sont des comparaisons **cumulatives** — `display_order >= 2` dans
`majordhome_meta_ads_leads_attribution`, `>= 3` quatre fois dans `useDashboardData.js`, `>= 4` dans
`LeadFormSections.jsx`. « A atteint au moins l'étape Contacté » ne s'exprime pas avec une clé.

| Usage | Repère | Sites approx. |
|---|---|---|
| **Identité** d'une étape (« c'est Devis envoyé ») | `key` | 8 |
| **Rang** dans l'entonnoir (« au moins Contacté ») | `display_order` | 8 |

Comparer des rangs n'est pas le défaut de juin : le défaut était qu'un rang pouvait être **inséré
au milieu**. On ferme cette porte structurellement (§4.1), ce qui rend `display_order` sûr pour
l'usage ordinal — et seulement pour lui.

## 4. Modèle de données

### 4.1 `majordhome.statuses` — clé sémantique, table verrouillée en écriture

```sql
ALTER TABLE majordhome.statuses ADD COLUMN key text;

UPDATE majordhome.statuses SET key = CASE display_order
  WHEN 1 THEN 'nouveau'  WHEN 2 THEN 'contacte' WHEN 3 THEN 'rdv_planifie'
  WHEN 4 THEN 'devis_envoye' WHEN 5 THEN 'gagne' WHEN 6 THEN 'perdu' END;

ALTER TABLE majordhome.statuses ALTER COLUMN key SET NOT NULL;
CREATE UNIQUE INDEX statuses_key_uniq ON majordhome.statuses (key);

REVOKE INSERT, UPDATE, DELETE ON majordhome.statuses FROM anon, authenticated, service_role;
```

Le `REVOKE` porte aussi sur `UPDATE` : aucun chemin applicatif n'écrit dans cette table, et le
renommage est écarté en V1. Si une V2 l'introduit, elle passera par une RPC `SECURITY DEFINER` —
qui s'exécute avec les droits du propriétaire et n'est donc pas bloquée par ce `REVOKE`. Le verrou
ferme l'écriture directe, pas l'évolution.

Ces six clés ne sont pas inventées : **elles existent déjà, en double.**
`majordhome_kanban_cards.column_key` les produit par un `CASE` sur `display_order`, et
`LeadKanban.jsx` les reconstruit par un dictionnaire libellé → clé. La migration ne fabrique pas un
vocabulaire, elle **supprime deux traductions** et pose l'original en base.

Après le `REVOKE`, `majordhome.statuses` n'est modifiable que par une migration — traduction en SQL
de la décision « le tunnel est du code : il se déploie, il ne s'édite pas ».

### 4.2 `majordhome.sources` — organisation + clé optionnelle

```sql
ALTER TABLE majordhome.sources
  ADD COLUMN org_id uuid REFERENCES core.organizations(id),
  ADD COLUMN key    text;                      -- NULL = étiquette libre

CREATE UNIQUE INDEX sources_org_key_uniq  ON majordhome.sources (org_id, key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX sources_org_name_uniq ON majordhome.sources (org_id, lower(name));
```

- `key` **non nulle** → source d'intégration. Renommable et recolorable, jamais supprimable ni
  archivable. La clé n'est pas montrée à l'utilisateur.
- `key` **nulle** → étiquette libre. Tout est permis.

Clés à poser sur les 7 sources Mayer concernées : `meta_ads`, `site_web`, `tesla`,
`offre_combustible`, `web_pac`, `bornes_irve`, `offre_bricafeu`.

### 4.3 Garde-fou structurel — clé étrangère composite

```sql
ALTER TABLE majordhome.sources
  ADD CONSTRAINT sources_org_id_id_key UNIQUE (org_id, id);

ALTER TABLE majordhome.leads
  ADD CONSTRAINT leads_source_same_org
  FOREIGN KEY (org_id, source_id) REFERENCES majordhome.sources (org_id, id);
```

Attribuer à un lead la source d'une autre organisation devient **impossible au niveau du moteur** —
pas « vérifié dans une RPC qu'il faudra penser à appeler ». C'est le seul endroit du design où on
paie une contrainte plutôt qu'une garde applicative, et c'est justifié : c'est exactement le trou du
§2.4.

`leads.source_id` reste nullable (3 leads sans source aujourd'hui, dont 1 chez Cimaj) : une clé
étrangère composite avec un membre NULL n'est pas contrôlée, ce qui est le comportement voulu.

### 4.4 Droits et RLS

| Table | SELECT | INSERT / UPDATE / DELETE | `anon` |
|---|---|---|---|
| `sources` | `org_id IN (org_members)` | `org_id IN (org_members WHERE role='org_admin')` | aucun droit |
| `statuses` | `USING (true)` — contenu global par construction | INSERT, UPDATE, DELETE révoqués — modifiable uniquement par migration | aucun droit |

Après ce chantier, plus aucun rôle non authentifié ne lit ces tables : le site vitrine passe
exclusivement par RPC.

## 5. Migration

Cinq étapes **purement additives**, puis la bascule des consommateurs. Aucune n'est destructive,
chacune se vérifie seule. Base de production partagée : c'est la contrainte qui dicte cette forme.

| # | Étape | Risque | Retour arrière |
|---|---|---|---|
| 1 | `statuses` : `key` + backfill + `NOT NULL UNIQUE` + `REVOKE INSERT, DELETE` | Nul — rien ne la lit | `DROP COLUMN` |
| 2 | `sources` : `org_id` + `key` nullables ; les 15 lignes → Mayer ; clés sur les 7 sources d'intégration | Nul — rien ne les lit | `DROP COLUMN` |
| 3 | Semer Cimaj et H&E (jeu neutre), repointer leurs 5 leads par correspondance de nom | Faible, 5 lignes | `UPDATE` de 5 lignes, listées nommément dans la migration |
| 4 | `sources.org_id NOT NULL` + clé étrangère composite | **La seule qui peut échouer** | `DROP CONSTRAINT` |
| 5 | Bascule des consommateurs | Progressive | `CREATE OR REPLACE`, corps précédent conservé en commentaire |

L'étape 4 échoue en **refusant de se poser** si un lead reste attribué hors de son organisation —
c'est le comportement voulu, pas un incident.

### 5.1 Ordre de bascule, du plus profond au plus visible

1. Les 3 `WHERE is_won = true LIMIT 1` → `WHERE key = 'gagne'` / `'perdu'`. **En premier : c'est la bombe.**
2. Les 5 fonctions Pennylane (`display_order = 4` / `= 5` → `key`).
3. `mail_segment_compile` (libellés → clés).
4. Les vues : `majordhome_kanban_cards` (le `CASE display_order` → `s.key`), `v_leads_pipeline`,
   `v_pipeline_stats`, `majordhome_meta_ads_leads_attribution`, `majordhome_leads`,
   `majordhome_lead_activities`, `majordhome_sources`, `majordhome_statuses`.
5. Le frontend : `LeadStatusConfig.js` (le graphe `ALLOWED_TRANSITIONS` est aujourd'hui **indexé par
   libellé français** — c'est la définition du tunnel, elle passe aux clés), `LeadKanban.jsx`
   (le dictionnaire disparaît), `LeadCard.jsx`, `LeadModal.jsx` (`PL_DRIVEN_STATUSES`),
   `LeadFormSections.jsx`, `SegmentBuilderDrawer.jsx`, `Dashboard.jsx`, `useDashboardData.js`,
   `ConversionFunnel.jsx`, `longTerm/LongTermLeadDrawer.jsx`, `leads.service.js`.

**Pendant toute la bascule, les deux façons de désigner un statut cohabitent et concordent** — le
jeu de 6 est intact et verrouillé depuis l'étape 1. Il n'y a pas de moment de vérité.

### 5.2 Semis d'une nouvelle organisation

RPC `public.org_seed_sources(p_org_id uuid)`, sur le modèle d'`org_seed_permissions` :
`SECURITY DEFINER`, `service_role` seul, idempotente.

Jeu neutre : Site Web (`site_web`) · Meta Ads (`meta_ads`) · Google Ads · Bouche-à-oreille ·
Recommandation client · Prospection directe · Salon / Foire · Client existant.

Seules `site_web` et `meta_ads` reçoivent une clé : ce sont les deux seules qu'une intégration
désignera. Google Ads n'est câblée à rien aujourd'hui — elle naît étiquette libre, et recevra une
clé le jour où une intégration la vise. **La règle est stricte : une clé se pose parce qu'un code
la désigne, jamais « au cas où ».** Une clé posée d'avance est une source qu'on rend non
supprimable sans raison.

**Pas de copie du jeu Mayer** : CBM, Tesla, Bricafeu et TotalEnergies sont des partenariats propres
à Mayer, ils n'ont rien à faire chez un autre artisan.

## 6. Surfaces

### 6.1 `/settings/sources`

Nouvelle tuile, `org_admin` (même posture que `/settings/pricing`). Pas un onglet
d'`OrganizationSettings` : celle-ci décrit l'identité de l'entreprise, une taxonomie CRM n'y a pas
sa place.

- Liste : nom, couleur, nombre de leads, badge « Intégration » sur les sources à clé.
- Renommer et recolorer en ligne.
- **Archiver** (bascule `is_active`) — c'est ça, « supprimer ». La suppression dure n'est proposée
  que si la source n'a jamais eu un seul lead.
- Une source à clé n'a ni bouton archiver ni bouton supprimer, avec la raison affichée :
  *« Utilisée par une intégration (site web) »*.
- Bouton **Réaffecter** → liste des leads de la source (nom, ville, date, statut), cases à cocher,
  source cible.

La scission « Salon / Foire » → « Salon » + « Foire » se fait là : créer les deux, cocher,
réaffecter, archiver l'ancienne. La fusion, c'est le même écran avec « tout sélectionner ».

### 6.2 RPC de réaffectation

```sql
public.source_reassign_leads(p_target_source_id uuid, p_lead_ids uuid[]) RETURNS integer
```

Pas de `p_org_id` en paramètre : l'organisation se **dérive** de la source cible. On vérifie ensuite
que `auth.uid()` en est `org_admin` et que tous les leads lui appartiennent — sinon refus **en bloc**,
jamais partiel.

- `SECURITY DEFINER`, `SET search_path = majordhome, public, core`
- `REVOKE EXECUTE FROM PUBLIC, anon` — le `PUBLIC` n'est pas optionnel
- `GRANT EXECUTE TO authenticated`
- Gardes en **autorisation positive** : `IF auth.uid() IS NULL THEN RAISE` en première instruction,
  puis `IF (…) IS NOT TRUE THEN RAISE` — jamais `IF NOT (…)`
- Effet vérifié par `has_function_privilege('anon', p.oid, 'EXECUTE')`, jamais en relisant la migration

### 6.3 Site vitrine

`create_website_lead` et `create_aide_lead` gagnent `p_source_key text` et `p_status_key text`, en
gardant `p_source_id` / `p_status_id` le temps de la bascule. Résolution en base : la clé source sur
`(p_org_id, key)`, la clé statut globalement.

**Une clé inconnue lève une exception nommée.** Pas de repli sur une valeur par défaut — c'est le
repli silencieux qui a produit la commande orpheline du §2.3.

Puis les 7 routes passent `p_source_key`, les variables `SOURCE_*_ID` et `STATUS_*_ID` disparaissent
des fichiers et du `.env`, et les paramètres UUID sont retirés des deux RPC. Un 2ᵉ site n'aura plus
qu'une variable d'organisation à poser : `MAJORDHOME_ORG_ID`.

**Point à trancher par Eric au passage** : `commande-pro` visait le statut « À planifier », qui
n'existe pas dans le tunnel de référence. La cartographie honnête est `nouveau` (une commande pro est
un lead entrant comme un autre). Si ce n'est pas l'intention, c'est le moment de le dire — pas de
créer une 7ᵉ étape.

### 6.4 Workflow N8N Meta

`create_lead_from_webhook` accepte `source_key` dans son payload `jsonb`, avec la même résolution et
la même erreur nommée. Le node passe `"source_key": "meta_ads"` au lieu de l'UUID.

## 7. Périmètre

**Dans ce chantier** : la base, les 10 fonctions, les 8 vues, la douzaine de fichiers frontend,
`/settings/sources`, la RPC de réaffectation, le semis, et l'ajout des paramètres `*_key` aux RPC.

**Hors de ce chantier, en étapes distinctes et après que la base soit posée** — parce qu'ils touchent
d'autres dépôts :

- Bascule des 7 routes du site vitrine et retrait des variables d'environnement.
- Bascule du node N8N Meta.
- Retrait des paramètres `p_source_id` / `p_status_id` des deux RPC (après les deux précédents).

**Hors sujet, signalé séparément** : la faille `anon` sur `promote_lead_to_gagne` /
`demote_lead_to_perdu` (§2.6), et la commande webshop orpheline du 2026-06-12 (§2.3).

## 8. Critères de succès

Chacun se vérifie par une commande, pas par une relecture.

| # | Critère | Vérification |
|---|---|---|
| 1 | Aucune fonction ni vue ne désigne un statut par libellé ou par position pour son **identité** | `pg_get_functiondef` / `pg_get_viewdef` : plus aucune occurrence de `'Devis envoyé'`, `'Gagné'`, `'Perdu'`, `display_order = N` ou `<> N`. Les comparaisons ordinales (`>=`) subsistent, elles sont légitimes |
| 2 | Aucun `LIMIT 1` sur `statuses` sans clé | Idem, grep sur `is_won = true` / `is_final = true` |
| 3 | Chaque source appartient à une organisation | `SELECT count(*) FROM majordhome.sources WHERE org_id IS NULL` = 0 |
| 4 | Aucun lead n'a la source d'une autre org | La contrainte `leads_source_same_org` est posée (son existence *est* la preuve) |
| 5 | `anon` ne lit plus les tables de référence | `has_table_privilege('anon', 'majordhome.sources', 'SELECT')` = false, idem `statuses` |
| 6 | `statuses` n'est plus modifiable par l'application | `has_table_privilege('authenticated', 'majordhome.statuses', 'INSERT')` = false, idem `UPDATE` et `DELETE`, idem `service_role` |
| 7 | La RPC de réaffectation n'est pas ouverte | `has_function_privilege('anon', …, 'EXECUTE')` = false |
| 8 | Le kanban affiche les mêmes cartes qu'avant | Comptage par `column_key` sur `majordhome_kanban_cards`, avant / après, sur les 3 orgs |
| 9 | Le build passe | `npx vite build` |

Le critère 8 est le filet : c'est exactement la mesure qui aurait détecté la régression de juin.

## 9. Plan de retour

Étapes 1-2 : `DROP COLUMN`. Étape 3 : les 5 leads repointés sont listés nommément dans la migration,
le retour est un `UPDATE` de 5 lignes. Étape 4 : `DROP CONSTRAINT`. Étape 5 : chaque fonction et
chaque vue est remplacée par `CREATE OR REPLACE`, le corps précédent conservé en commentaire dans le
fichier de migration.

Aucune étape ne supprime de donnée. Le seul geste qui modifie des lignes existantes est le
repointage des 5 leads de Cimaj et H&E.
