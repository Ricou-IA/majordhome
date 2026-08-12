# Module Catalogue produit fabricant (FAB-DIS / ETIM)

> Référentiel produit mutualisé alimentant **Majord'home** (assemblage d'ouvrages, devis) et **Arpet.ai** (recherche sémantique, conseil technique).
> Source : cahier des charges « Spécifications techniques et architecture data : Arpet.ai & Majord'home », sections 2 à 5.
> **État : socle livré, premier catalogue réel ingéré** — 6 269 articles Roth France (FAB-DIS 3.00), ingestion complète en 23 s, idempotence vérifiée. Reste bloquant : la traduction ETIM (cf. « Ce qui manque »).

## Ce que c'est, et ce que ce n'est pas

Le schéma `catalog` est un **référentiel fabricant**, pas un tarif d'artisan. La distinction commande toute l'architecture :

| | `catalog.*` | `majordhome.supplier_products` |
|---|---|---|
| Nature | donnée de référence fabricant | conditions négociées par l'artisan |
| Portée | **mutualisée**, toutes organisations | scopée `org_id` + RLS |
| Contenu | GTIN, libellés, ETIM, médias, prix **public** | prix d'achat, remise, compte comptable |
| Écriture | `service_role` (ETL) uniquement | l'artisan, via l'app |
| Jointure | ← `gtin` → | |

Une PAC Atlantic n'appartient à aucun artisan : ces tables n'ont donc **volontairement pas de colonne `org_id`**, contrairement à la règle qui vaut pour tout `majordhome.*`. Ce n'est pas un oubli. La contrepartie est stricte et vérifiée en base : lecture ouverte à `authenticated`, **aucune policy d'écriture**, `anon` sans le moindre privilège (ni schéma, ni table, ni vue).

## Schéma

`catalog.brands` · `catalog.products` · `catalog.product_prices` · `catalog.product_relations` · `catalog.business_rules`
Vues publiques (`security_invoker=true`) : `public.catalog_products`, `catalog_brands`, `catalog_product_relations`.

Migrations : `20260812_5_catalog_schema.sql`, `20260812_6_catalog_ingest_rpc.sql`.

### Règles qui mordent

- **`embedding` n'est jamais exposé par les vues.** 1536 flottants par ligne rendraient tout `SELECT *` inutilisable côté frontend. La recherche vectorielle passera par une RPC serveur dédiée.
- **Identité d'un produit = `gtin`, sinon `(brand_id, manufacturer_ref)`.** `gtin` est unique mais nullable, et en SQL `NULL <> NULL` : cette contrainte seule laisse passer autant de doublons que de ré-imports pour les articles sans GTIN. D'où l'index unique `(coalesce(brand_id,0), manufacturer_ref)` — le `coalesce` n'est pas cosmétique, sans lui les produits sans marque retombent dans le même trou.
- **Un GTIN est validé par sa clé de contrôle GS1** avant tout usage. Une référence interne glissée dans la colonne EAN créerait un produit fantôme et ferait échouer les relations qui pointent dessus.
- **`catalog_ingest_batch` est `service_role` only.** Elle écrit dans un référentiel partagé à partir d'un payload arbitraire sans rien dériver d'`auth.uid()` : `REVOKE ... FROM PUBLIC, anon, authenticated` (le `PUBLIC` n'est pas optionnel — sans lui le REVOKE ne retire rien).
- **Le prix n'entre jamais dans le texte d'embedding.** C'est ce qui permet à un changement de tarif de laisser `ai_description_hash` intact, donc de ne déclencher **aucun appel API** (section 4, « coût API IA : 0 € »). Vérifié en base dans les deux sens : prix modifié → 1 ligne de prix, 0 embedding invalidé ; caractéristique modifiée → 0 ligne de prix, 1 embedding invalidé.
- **`product_prices` est une table d'historique.** Une ligne n'est ajoutée que si le tarif a changé — sinon chaque passage du batch nocturne empilerait un doublon quotidien.

## Pipeline d'ingestion

```
fichier FAB-DIS .xlsx
   → scripts/fabdis/workbook.mjs    lecture (exceljs), rapport de couverture
   → scripts/fabdis/parser.mjs      parsing + assemblage        [PUR, testé]
   → scripts/fabdis-import.mjs      CLI, payload ou --apply
   → public.catalog_ingest_batch()  UPSERT idempotent
```

```bash
node scripts/fabdis/make-sample.mjs                  # regenere le jeu d'essai
node scripts/fabdis-import.mjs <fichier.xlsx> \
     --etim scripts/fabdis/etim-dictionary.json \
     --source "Tarif Atlantic 2026"                  # produit un payload JSON
node scripts/fabdis-import.mjs <fichier.xlsx> --limit 50 --apply   # premier essai prudent
node scripts/fabdis-import.mjs <fichier.xlsx> --apply # ingere (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
node --test scripts/fabdis.test.mjs                   # 18 tests
```

### ⚠️ Nommage des onglets : le cahier des charges diverge de la norme

Vérifié sur la norme FAB-DIS 3.0 le 2026-08-12 — **deux intitulés du document sont faux**, et l'un est piégeux :

| Cahier des charges | Norme FAB-DIS 3.0 |
|---|---|
| `B01_COMMERCE` | ✅ `B01_COMMERCE` |
| `B04_MEDIA` | ❌ **`B03_MEDIA`** — `B04` existe, mais c'est `B04_REGLEMENTAIRE` |
| `B05_ETIM` | ❌ **`C04_ETIM`** (`B05` n'existe pas) |
| `C02_CORRESPONDANCE` | ✅ correct |
| `C06_SUBSTITUTION` | ✅ correct |

Suivre le document aurait fait lire l'onglet **réglementaire** comme des médias, sans lever d'erreur. Le parser porte donc les noms de la norme, accepte les intitulés du document comme alias **non ambigus** (`b04 media` oui, `b04` nu non), et un test verrouille l'absence de l'alias dangereux ainsi que l'unicité des alias entre onglets.

Structure complète de la norme — 5 onglets obligatoires (`B00_CARTOUCHE`, `B01_COMMERCE`, `B02_LOGISTIQUE`, `B03_MEDIA`, `B04_REGLEMENTAIRE`) et des optionnels (`C01_EXTENSION`, `C02_CORRESPONDANCE`, `C03_VARIANTE`, `C04_ETIM`, `C05_ARRET`, `C06_SUBSTITUTION`, `F01_PYRAMIDE`).

**Non exploités à ce jour**, par ordre d'intérêt : `C05_ARRET` (fin de commercialisation → `is_active = false`), `B04_REGLEMENTAIRE` (matière du §6), `C03_VARIANTE` (déclinaisons taille/couleur), `B02_LOGISTIQUE` (conditionnements), `B00_CARTOUCHE`, `C01_EXTENSION`, `F01_PYRAMIDE`.

### Calage sur un fichier FAB-DIS 3.00 réel (2026-08-12)

Les alias ne sont plus des suppositions : ils sont relevés sur un **vrai fichier fabricant**, publié en libre accès par Roth France (`professionnels.roth-france.fr/fabdis/liste`) — 6 269 articles, les 12 onglets de la norme.

Colonnes réelles, par onglet :

| Onglet | Colonnes utiles |
|---|---|
| `B01_COMMERCE` | `MARQUE`, `REFCIALE`, `GTIN`, `LIBELLE40/80/240`, `TARIF`, `UB`, `GAMME` |
| `B03_MEDIA` | `REFCIALE`, `MTYP`, `MURL`, `MNOM` |
| `C04_ETIM` | `MARQUE`, `REFCIALE`, `ARTCLASSID`, `FEATUREID`, `FVALUE`, `ETIMV` |
| `C02_CORRESPONDANCE` | `REFCIALE`, `CORTYP`, `CORQ`, `REFCIALECOR`, `MARQUECOR` |
| `C06_SUBSTITUTION` | `MQEREFOLD`, `REFOLD`, `REFCIALESUB`, `MARQUESUB` |

Ce que ce fichier a corrigé, et qui n'était pas devinable :

1. **Les relations sont exprimées en RÉFÉRENCE, pas en GTIN** — alors que `catalog.product_relations` pointe sur des GTIN. `assembleProducts` résout donc `(marque, référence) → GTIN` depuis `B01`. Une référence portée par deux produits distincts est écartée de l'index : mieux vaut ne pas résoudre que résoudre vers le mauvais article.
2. **`MTYP` est un mot seul** (`FICHE`, `NOTICE`, `PHOTO`, `SCHEMA`, `ARGUC`, `PLUSPROD`, `VIDEO`, `VIDEOTU`, `PHOTOA`, `PHOTO3D`) — une regex qui attendait « fiche technique » ne captait rien.
3. **Trois colonnes de libellé coexistent** (`LIBELLE40/80/240`) et le format 40 arrive tronqué, sans espaces (« CuvefioulRothalen700 »). D'où l'arbitrage par **priorité d'alias** : la position dans `aliases` fait foi, pas l'ordre des colonnes.

Résultat sur ce fichier : **6 269/6 269 articles**, 31 731 médias, 63 substitutions résolues, 3 282 fiches techniques et 2 405 notices rattachées, 6 266 prix. Les 357 articles sans GTIN ont la colonne vide à la source — vérifié, la validation GS1 n'a produit aucun faux rejet. Insertion en base contrôlée sur un échantillon : accents, `Ø`, guillemets doubles et décimales intacts.

### Deux constats qui touchent au §5

- **`C04_ETIM` et `C02_CORRESPONDANCE` sont VIDES** dans ce fichier, pourtant complet et conforme. Un fabricant peut donc livrer un FAB-DIS 3.00 sans une seule caractéristique ETIM ni un seul lien d'accessoire. **La couche 2 du moteur d'assemblage ne peut pas reposer sur le seul FAB-DIS** : il faudra une saisie interne ou une autre source pour les accessoires obligatoires.
- **`C06` pointe majoritairement vers des références absentes de `B01`** (627 sur 690) : l'ancienne référence n'est plus commercialisée, elle vit dans `C05_ARRET`. Le rejet est correct, mais il confirme l'intérêt d'exploiter `C05_ARRET`.

### Unités de vente

`UB` porte un code UN/ECE. Sur le fichier de calage : `EA` (each) pour 6 240 articles, `PKI` pour 27, `MTK` (m²) pour 2.

**Seuls les codes unitaires sont convertis en `PCE`** (`EA`, `NAR`, `C62`, et les écritures déjà unitaires). Toute autre unité — surface, longueur, conditionnement — est **conservée telle quelle et signalée** par un avertissement agrégé. Convertir en « pièce » un article vendu au m² ferait facturer une quantité pour une autre, et la correspondance quantité/unité n'est pas dans les colonnes lues (elle vit dans `B02_LOGISTIQUE`, non exploité).

Attention en lisant un fichier à la main : `UB` (unité de base) et `UC` (unité de conditionnement) sont deux colonnes distinctes, et `UC` n'est renseignée que pour une minorité d'articles. Se fier au mapping par nom de colonne, jamais à une position.

### Le parser mappe par ALIAS, jamais par noms de colonnes figés

Les intitulés réels varient d'un fabricant à l'autre (accents, casse, abréviations, colonnes absentes). Chaque champ déclare une liste d'alias dans `SHEET_SPECS`, et le rapport de lecture remonte **les colonnes non reconnues** ainsi que **les colonnes requises manquantes**. Un onglet auquel il manque une colonne requise est rejeté **en bloc** : jamais d'import mutilé en silence.

**Adapter le parser à un nouveau fabricant = compléter `SHEET_SPECS`**, pas le réécrire.

### Ce qui refuse de deviner

Trois endroits préfèrent rejeter et signaler plutôt que produire une donnée fausse sur un devis client :

1. **GTIN invalide** → produit conservé sans GTIN, avertissement (pas de produit fantôme).
2. **Type de relation C02 inconnu** → ligne rejetée, **sans repli sur `OPTIONAL`**. Une dépendance obligatoire vue comme optionnelle produit un devis incomplet ; l'inverse facture au client une pièce inutile.
3. **Code ETIM absent du dictionnaire** → conservé brut, jamais traduit au jugé.

## Traduction ETIM

Le cahier des charges (§2.2) prévoit l'API REST ETIM International (OAuth2) pour traduire `EC…`/`EF…`/`EV…`/`EU…` en français. **Aucun compte n'est ouvert à ce jour.**

**Un compte ETIM est nécessaire, ce n'est pas un confort.** La norme FAB-DIS impose que l'onglet ETIM transporte **les codes des valeurs, jamais les libellés** : aucun fichier fabricant, si complet soit-il, ne contiendra les intitulés en clair. Sans dictionnaire, la caractéristique reste `EF000008 : 8 EU570448`.

Demande d'accès : courriel à `info@etim-international.com`, objet `Request_clientId`. Les identifiants (`client_id` / `client_secret`) sont envoyés manuellement par un membre de l'équipe ETIM — **le délai dépend de leur disponibilité**, d'où l'intérêt de lancer la demande tôt.

**Ce n'est pas bloquant pour ingérer.** On peut charger les fichiers dès maintenant : les codes sont conservés bruts. Quand le dictionnaire arrive, il suffit de relancer l'import avec `--etim` — les libellés se posent, `ai_description_hash` change, et les embeddings concernés sont invalidés pour recalcul. C'est exactement la mécanique vérifiée en base.

Point d'injection : l'option `resolveEtim` d'`assembleProducts(sheets, { resolveEtim })` — une fonction `code → { label, unit }`. En attendant, `--etim` accepte un dictionnaire JSON local.

L'enjeu est concret. Sans traduction, le texte soumis à l'embedding ressemble à :

> `Alfea Excellia A.I. 8 ATLANTIC. EF000008 : 8 EU570448. EF000199 : 111 EU570025`

Avec :

> `Alfea Excellia A.I. 8 ATLANTIC. Pompe a chaleur air/eau. Puissance calorifique : 8 kW. Efficacite energetique saisonniere (ETAS) : 111 %. Fluide frigorigene : R32`

Le premier est inexploitable en recherche sémantique. **L'ouverture du compte ETIM conditionne la qualité du RAG**, pas seulement le confort de lecture.

⚠️ `scripts/fabdis/etim-dictionary.json` est un **amorçage aligné sur le jeu d'essai fictif**. Ses libellés ne sont pas certifiés conformes au dictionnaire ETIM réel et ne doivent pas servir à interpréter un vrai fichier fabricant.

## Jeu d'essai

`node scripts/fabdis/make-sample.mjs` génère `docs/imports/fabdis-echantillon.xlsx` (non versionné, régénérable à l'identique) : 10 produits sur les 4 familles retenues (PAC air/eau, poêle granulés, fumisterie, climatisation), 9 médias, 9 caractéristiques ETIM, 6 correspondances, 1 substitution.

**Ce qu'il prouve** : la chaîne complète, de la lecture du classeur à l'assemblage requêtable en base.
**Ce qu'il ne prouve pas** : la compatibilité avec un vrai FAB-DIS. Les intitulés de colonnes y sont plausibles, **pas certifiés**. Les GTIN portent une clé de contrôle valide (pour exercer réellement la validation) mais n'identifient aucun article du commerce.

## Premier import réel (2026-08-12)

Catalogue Roth France COMPLET du 01/07/2026, via `--apply` :

| | |
|---|---:|
| Produits insérés | **6 269** |
| Lignes de prix | 6 216 |
| Fiches techniques rattachées | 3 282 |
| Notices d'installation | 2 407 |
| Articles avec au moins un média | 5 454 |
| Substitutions (C06) | 63 |
| Articles avec caractéristique ETIM | **0** |
| Durée, en 32 lots de 200 | **23 s** |

**Idempotence vérifiée en conditions réelles** : le ré-import du même fichier donne `products_inserted: 0`, `prices_added: 0`, `embeddings_invalidated: 0`. Un passage nocturne sans changement ne crée donc ni doublon, ni ligne de prix, ni le moindre appel d'API payante.

Le zéro sur la colonne ETIM n'est pas un défaut d'import : l'onglet `C04_ETIM` est vide dans le fichier source. C'est la démonstration la plus nette de ce que le compte ETIM apportera — et de ce qu'aucun pipeline ne peut fabriquer sans lui.

## Retirer un import

`source_name` identifie chaque passe : un import se défait sans toucher au reste du référentiel.

```sql
delete from catalog.product_relations r
 where exists (select 1 from catalog.products p
                where p.source_name = '<nom de la source>'
                  and (p.gtin = r.parent_gtin or p.gtin = r.child_gtin));
delete from catalog.product_prices where product_id in
  (select id from catalog.products where source_name = '<nom de la source>');
delete from catalog.products where source_name = '<nom de la source>';
delete from catalog.brands b
 where not exists (select 1 from catalog.products p where p.brand_id = b.id);
```

## Ce qui manque

| Manque | Conséquence | Débloqué par |
|---|---|---|
| **Fichiers FAB-DIS réels** | le catalogue reste à 10 produits fictifs | récupérer les fichiers auprès des fabricants |
| **Compte API ETIM** | caractéristiques en codes bruts, RAG dégradé | courriel `info@etim-international.com`, objet `Request_clientId` (délivrance manuelle) |
| **Embeddings** | `embedding` NULL partout, aucune recherche sémantique | brancher l'API d'embedding sur les lignes `ai_description IS NOT NULL AND embedding IS NULL` |
| **Règles métier** | `business_rules` vide : ni NF C 15-100, ni MaPrimeRénov' | §6 — à saisir après cadrage réglementaire |
| **Couche 3 de l'assemblage** | fournitures génériques et main-d'œuvre non calculées | §5 couche 3 |
| **Function Calling NLU** | pas d'entrée en langage naturel | §7 phase 1 |
| **Batch nocturne** | ingestion manuelle | `pg_cron` + edge function, une fois les sources stabilisées |

Le socle et le tuyau existent et sont vérifiés ; **c'est la matière première qui manque**.
