# Investigation bâtiment sur la fiche client — design

**Date** : 2026-08-12 · **Statut** : livré, en test · **Périmètre** : volontairement minimal

## Pourquoi

Interroger la donnée bâtiment publique française depuis la fiche client, pour savoir
ce qu'un logement porte comme équipement (chauffage et son ancienneté, ECS, clim,
isolation) sans se déplacer ni interroger le client.

Cible métier à terme : détecter les conduits (ramonage) et les équipements en fin de
vie (remplacement). **Cette version ne fait que montrer la donnée** — aucune
interprétation, aucun ciblage, aucune liste. On mesure d'abord si la donnée existe et
si elle est juste.

## Sources retenues

| Source | Rôle | Accès |
|---|---|---|
| **BAN** (`api-adresse.data.gouv.fr`) | adresse → `identifiant_ban` + coordonnées | sans clé, illimité |
| **DPE ADEME** (`data.ademe.fr`, dataset `meg-83tjwtg8dyz4vv7h1dqe`) | ~15,3 M de diagnostics, 230 champs | sans clé, CORS ouvert |

Réutilisation commerciale autorisée sous condition de mention (affichée en pied de
panneau). Les deux APIs sont appelées **directement depuis le navigateur** : CORS
vérifié le 2026-08-12, aucune edge function nécessaire.

**Écarté** : la BDNB du CSTB (`api.bdnb.io`) — 138 champs gratuits, PostgREST, et une
couverture bâtiment plus large, mais sa donnée chauffage dérive du DPE. Elle
n'apporterait que le bâti (matériau de toit, emprise au sol, potentiel solaire). À
reconsidérer si le taux de réponse du DPE seul est insuffisant.

**Écarté aussi** : la base documentaire du CSTB (Reef / Batipédia — DTU, normes).
Abonnement éditorial, pas d'API développeur publique, et sans usage depuis un CRM.

## Décisions structurantes

1. **Zéro écriture en base.** Pas de table, pas de colonne, pas de cache Supabase.
   Le résultat vit dans React Query. Abandonner la piste = supprimer 4 fichiers,
   sans trace en base ni migration à défaire.
2. **À la demande uniquement.** Aucune requête tant que le panneau n'est pas ouvert
   (`enabled: isOpen`). Pas de balayage, pas de cron, pas de préchargement.
3. **Une adresse = N logements.** Un immeuble porte plusieurs DPE (3 relevés sur
   *3 Rue Gaubil, Gaillac*). On les liste tous, on n'en élit aucun.
4. **Correspondance exacte uniquement. Le voisinage se demande.** `investigateAddress`
   ne cherche dans un rayon de 80 m que si `includeNearby` est passé — faux par défaut.
   La version initiale y repliait automatiquement : sur un client de Montauban, elle
   affichait le DPE du 6 Impasse des Gentianes (51 m) comme s'il était le sien, avec un
   simple bandeau pour nuancer. **Personne ne lit le bandeau.** Quand rien n'existe à
   l'adresse exacte, on répond `no_dpe` et l'UI propose d'élargir : geste explicite,
   résultat assumé comme tel (« Ce ne sont PAS les DPE de ce client »).
5. **Carte interactive du voisinage** (`DpeNeighbourhoodMap`, `mapbox-gl` en direct comme
   `TerritoireMap`) : adresse de la fiche en repère bleu, chaque DPE du rayon en repère
   ambre numéroté. **Cliquer un repère sélectionne le diagnostic** ; la fiche détaillée
   affichée dessous est celle du repère choisi (défaut : le plus proche). Plusieurs DPE
   peuvent cohabiter dans le rayon — on ne devine pas lequel concerne le client, il le
   désigne. En correspondance exacte, pas de carte : tous les logements sont à la même
   adresse, elle n'apprendrait rien.

### Rayon et ordre des résultats (corrigés le 2026-08-12)

Deux défauts trouvés en testant une adresse pavillonnaire de Pechbonnieu :

1. **80 m était trop serré.** Depuis le point BAN du client : 80 m → 1 DPE, 150 m → 13,
   300 m → 75. Le rayon est désormais choisi par l'utilisateur (`NEARBY_RADII_M` =
   150 / 300 / 600 m, défaut 150) et fait partie de la clé de cache.
2. **Le tri par date faisait rater les voisins.** Avec `sort=-date_etablissement_dpe`, le
   DPE à 79 m n'apparaissait pas dans les six premiers résultats — on remontait des
   diagnostics à 164, 277 et 290 m parce qu'ils étaient plus récents. Sur un rayon large
   avec un plafond, c'est le pire ordre possible. `_geo_distance` n'est **pas** triable
   explicitement (400) : la solution est de **n'imposer aucun `sort`**, data-fair ordonne
   alors par distance croissante. Un test verrouille l'absence de `sort` sur les requêtes
   géo, et sa présence sur la requête par identifiant BAN (où le plus récent prime).

Plafond porté à `MAX_NEARBY_RECORDS = 40` en voisinage (contre 12 à une adresse exacte), et
**tout écart entre `total` et le nombre affiché est écrit à l'écran** : « 75 diagnostics dans
300 m — les 40 plus proches sont affichés ». Une troncature muette laisse croire que le
secteur est vide alors qu'on n'en montre qu'un sixième.

### ⚠️ Le contour cadastral a été tenté, puis retiré

Première version : contour de la parcelle du DPE via `fetchParcelleAtPoint` (apicarto,
réutilisé du module Solaire). Un cas semblait le valider — Montauban, DPE sur **DI 0805**,
client sur **DI 0808**, deux propriétés distinctes.

**C'était une coïncidence.** À Pechbonnieu, la parcelle renvoyée était « AM 0078 · 2056 m² »
et le rendu montrait qu'elle dessinait **la rue elle-même**. Cause : les coordonnées d'un DPE
viennent de la BAN, donc de l'axe de la voie, pas du bâtiment — le point tombe fréquemment
sur la voirie, et la parcelle qui le contient est celle de la route. Vérifié : le point est
*strictement* contenu dans AM 0078, ce n'est pas un repli du buffer 15 m.

Une référence cadastrale a l'air officielle. En afficher une qui désigne le bitume est pire
que de n'en afficher aucune. **Pour identifier le bâti, il faut une emprise de BÂTIMENT**
(BDNB `batiment_groupe`, ou BD TOPO), pas une parcelle — piste non explorée.
5. **L'absence de donnée n'est pas une erreur.** Un logement n'est au fichier DPE que
   s'il en a fait établir un (vente, location, audit) : de l'ordre d'un sur deux.
   `no_dpe` a son propre écran, distinct de `error`.

## Architecture

```
src/lib/dpeApi.js                 module PUR (aucun import React/Supabase/alias)
  ├─ buildAddressQuery / parseBanFeature / mapDpeRecord / isDpeExpired   (pur, testé)
  └─ lookupBanAddress / fetchDpeByBanId / fetchDpeNearby / investigateAddress
                                    (réseau, `fetchImpl` injectable)

src/shared/hooks/useClientInvestigation.js     React Query + compteur de réponse
src/shared/hooks/cacheKeys.js                  famille `investigationKeys`
src/apps/artisan/components/clients/ClientInvestigationPanel.jsx
src/apps/artisan/pages/ClientDetail.jsx        bouton « Investiguer »
scripts/dpe-api.test.mjs                       19 tests, sans réseau
```

`investigateAddress` **ne lève jamais** (hors `AbortError`) : toute panne ressort en
`status: 'error'`, pour qu'une API tierce indisponible ne fasse pas tomber la fiche
client. Les cinq statuts — `ok` · `no_address` · `address_not_found` · `no_dpe` ·
`error` — ont chacun leur rendu.

### Divergence assumée avec `geocoding.service.js`

Ce module refait son propre appel BAN plutôt que de réutiliser `geocodeAddress()` :
celui-ci ne remonte pas `properties.id` (la clé de jointure avec le DPE) et renvoie
`null` sous un score de 0,3, ce qui efface l'information nécessaire à l'avertissement
« adresse incertaine ». Si un 3ᵉ appelant a besoin du `banId`, **étendre
`geocoding.service.js`** — ne pas recopier ce module une fois de plus.

## Le critère de décision

Le panneau affiche un **taux de réponse** (`sessionStorage`, suffixé `userId`, indexé
par adresse pour ne pas gonfler au re-render). C'est la mesure qui tranche :

- ~3 adresses sur 20 avec de la donnée → la piste est morte, on supprime les 4 fichiers.
- ~12 sur 20 → on généralise (liste filtrable, croisement sur la base installée).

## Vérification (2026-08-12)

- `node --test scripts/dpe-api.test.mjs` → 19/19
- `npm run lint:errors` → 0
- `npx vite build` → OK (1 min)
- Module exécuté contre les APIs réelles sur 4 adresses du Tarn : `ban_id` exact
  (3 logements), maison isolée (poêle à granulés / bois), lieu-dit → `no_dpe` +
  faible confiance, adresse vide → `no_address` sans appel réseau.

## Ce que le panneau expose (et ce qui reste dans le gisement)

Le dataset porte **230 champs** ; on en sélectionne ~40. Taux de remplissage mesurés
sur les 69 166 DPE du Tarn le 2026-08-12 :

| Donnée | Remplissage | Exposée |
|---|---|---|
| Énergie de chauffage, étiquette, coût total | 100 % | oui |
| **Bilan de déperditions** (7 postes + total) et `ubat_w_par_m2_k` | **100 %** | oui |
| **Coût annuel ventilé par usage** (chauffage / ECS / froid / éclairage / auxiliaires) | 100 % | oui |
| Ventilation | 94 % | oui |
| Année de construction | 50 % | oui |
| **Modèle et âge du générateur** | **30 % en moyenne, 98,7 % sur les DPE 2026** | oui |
| Détail générateurs n1/n2 par installation (18 champs) | variable | non |
| GES ventilés (16 champs) | 100 % | non |
| `surface_totale_capteurs_pv` | 1,7 % | non |

Le champ générateur monte de 7,3 % (DPE 2021) à 98,7 % (DPE 2026) : ce n'est pas une
lacune structurelle mais une montée en qualité du remplissage. **L'âge d'équipement
n'est donc exploitable que sur les DPE récents** — à ne pas promettre en général.

Piège relevé : `isolation_toiture` est un **booléen 0/1**, pas un libellé. Utiliser les
trois `qualite_isolation_plancher_haut_*` (mutuellement exclusifs). Un test de
régression le verrouille.

## Fiabilité du rattachement (vérifié le 2026-08-12)

**Deux géocodages indépendants sont en jeu, et les confondre est le piège principal :**
le nôtre (adresse de la fiche → identifiant BAN) et celui de l'ADEME, déjà figé dans le DPE
(`score_ban`), sur lequel on n'a aucune prise.

Mesures sur les 69 166 DPE du Tarn :

| Constat | Valeur |
|---|---|
| DPE portant un `identifiant_ban` | 100 % |
| `score_ban` inférieur à 0,5 | **23 %** |
| `statut_geocodage` = « à l'adresse » | 83,2 % |

Erreurs réelles observées à bas score : « 11 Impasse de **Laborie** » rattachée à
« 11 Impasse de **la Borie** » (rue différente, score 0,29) ; un lieu-dit « Sengre » rattaché
à la **commune entière** (identifiant `81251`, sans voie).

Traitement retenu :

1. **`adresse_brut` est exposée systématiquement** — l'adresse telle que le diagnostiqueur l'a
   écrite. C'est le seul élément qu'un humain compare d'un coup d'oeil, et il vaut mieux que
   n'importe quel score. Bénéfice constaté : l'immeuble du 3 rue Gaubil affiche désormais
   « app n°1 / n°4 / n°5 » au lieu de trois lignes anonymes.
2. **`assessMatch`** classe en `exact` ou `a_verifier` (score ADEME sous 0,5, statut de
   géocodage autre que « à l'adresse », ou repli par proximité). Le niveau `a_verifier`
   **avertit sans masquer** : la décision reste humaine.
3. Le seuil de 0,5 est calibré pour ne pas rejeter les bons cas : le DPE de RONCA a un
   `score_ban` de 0,54 alors que son rattachement est exact (identifiant identique des deux
   côtés, adresse brute concordante). Un test verrouille ce cas.
4. La synthèse PDF **cite l'adresse du diagnostic** en couverture, pour que le client constate
   lui-même qu'il s'agit bien de son logement.

## Cohérence interne des données (vérifiée sur 400 DPE)

- `deperditions_enveloppe` = somme des 7 postes : écart médian **0,000 %**, maximum 0,355 %
  (arrondis). Le total inclut bien le renouvellement d'air.
- `cout_total_5_usages` = somme des 5 usages : écart médian 0,000 %, **mais 2,2 % des DPE
  divergent** (+22 € environ, poste fixe non ventilé, sur de petites surfaces).
  `buildCostBreakdown` ajoute donc une ligne « Autres » pour le reliquat : sans elle, le client
  additionne la colonne et trouve un trou.
- Le schéma ADEME ne documente **aucune** de ces colonnes (`description` vide sur les 230
  champs) : toute hypothèse de sémantique doit être vérifiée statistiquement, jamais déduite du
  nom du champ.

## Le PDF du DPE

Pas de route publique : `/pub/dpe/{n}/pdf` → 404, `/api/dpe/{n}/pdf` → 403. L'ADEME
bloque par ailleurs les requêtes serveur (403 sans User-Agent navigateur), donc
rapatrier ou archiver le document automatiquement est hors de portée.

En revanche `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/{numero_dpe}` répond
200 dans un navigateur : le lien de la fiche client pointe désormais dessus, au lieu de
la page de recherche qui obligeait à re-saisir le numéro.

## La synthèse client (PDF)

Bouton « Synthèse client » par logement → PDF 3 pages brandé org. Chaîne :
`buildDpeReportModel` (PUR, testé) → `DpeSynthesePDF` → `dpeSyntheseExport` (point d'entrée
unique, import dynamique de `@react-pdf/renderer`).

Positionnement arbitré avec Eric le 2026-08-12 :

1. **Le document assume sa source.** N° de DPE et date d'établissement en couverture, mention
   « n'est pas un diagnostic réglementaire » en couverture ET en pied de page. Un DPE de 2022
   peut décrire une chaudière déjà remplacée : le dire protège l'artisan, et ouvre la
   conversation (« vérifions ensemble ce qui a changé »).
2. **Il n'imite pas la réglette officielle.** Étiquettes en dégradé bleu → ambre (palette
   deutan), pas le vert-rouge réglementaire.
3. **Aucun montant.** Sans métrés, un chiffrage serait un devis à l'aveugle ; un chiffre faux
   détruirait la confiance construite par les deux premières pages.
4. **Mayer ne vend ni isolation ni menuiseries.** Quand les murs dominent (62 % chez le cas
   test), la page 3 l'énonce en « En toute transparence » plutôt que de renvoyer vers une
   prestation non assurée, et positionne le chauffage comme rentable *malgré* des parois qu'on
   ne touche pas. `OUT_OF_SCOPE_POSTS` verrouille la règle ; un test vérifie qu'aucune
   recommandation ne mentionne isolation, menuiserie ou fenêtre.

Règles de recommandation (`buildRecommendations`, testées) : fioul → PAC ; gaz de plus de
15 ans → PAC ou condensation ; PAC d'avant 2015 → renouvellement ; bois → ramonage ; pas de
froid + étiquette E-G → clim réversible ; renouvellement d'air > 15 % des pertes → VMC ;
étiquette F-G → aides. **`isAgingGenerator` raisonne sur la borne haute de la période et ne
conclut jamais sans elle** : on préfère taire une recommandation qu'annoncer à un client que
son matériel neuf est à changer.

Socle graphique réutilisé depuis `@apps/thermique/components/etude/pdfShared` (palette,
formatters PDF-safe, cartouche). Son `Footer` n'est pas repris — texte propre à l'étude
thermique. **Si un 3ᵉ document réutilise ce socle, le promouvoir dans `src/lib/`** au lieu de
multiplier les imports inter-apps. Idem pour `downloadBlob`, dupliqué à dessein (importer
`rapportExport` tirerait le catalogue PAC dans le bundle artisan).

Vérification visuelle hors navigateur via le harness esbuild + `renderToStream` + PyMuPDF
(cf. mémoire `reference_react_pdf_render_harness`). Gotcha rencontré : sortie ESM + dépendance
CJS de react-pdf appelant `require('crypto')` → banner `createRequire`.

## Piste non explorée : les audits énergétiques

Second dataset ADEME (`ync2epx48x9azbdnggbygqp0`, 3,18 M d'enregistrements, 236 champs)
contenant les **scénarios de travaux** : `etape_travaux`, `categorie_scenario`,
`cout_travaux`, `couts_cumules_travaux`, `gain_financier_travaux`. C'est de
l'argumentaire de vente chiffré, déjà rédigé par un auditeur. Chantier distinct.

## Volontairement absent

Pas de tag « opportunité ramonage » ni de score : ce serait de l'interprétation avant
d'avoir vérifié que la donnée est juste. Le libellé brut (« Poêle à granulés flamme
verte installé à partir de 2020 ») se suffit pour l'instant.
