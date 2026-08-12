# Module Catalogue produit fabricant (FAB-DIS / ETIM)

> Référentiel produit mutualisé alimentant **Majord'home** (assemblage d'ouvrages, devis) et **Arpet.ai** (recherche sémantique, conseil technique).
> Source : cahier des charges « Spécifications techniques et architecture data : Arpet.ai & Majord'home », sections 2 à 5.
> **État : socle livré, catalogue non alimenté en données réelles** (cf. « Ce qui manque » en fin de document).

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
