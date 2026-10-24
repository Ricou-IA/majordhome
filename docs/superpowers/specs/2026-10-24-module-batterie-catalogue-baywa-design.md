# Module Batterie — famille de devis « Batterie » et catalogue BayWa r.e.

**Date** : 2026-10-24 · **Statut** : en relecture (Eric).
**Contexte** : Mayer vend le stockage Tesla Powerwall 3 (et demain d'autres marques) acheté chez BayWa r.e.
(`solarshop.baywa-re.fr`). Le module devis natif ne connaît ni la famille, ni le fournisseur, ni les prix.

## 1. Intention

Philippe fait un devis « Batterie » comme il fait un devis Climatisation : il choisit la famille, pioche les
équipements dans le catalogue (prix d'achat BayWa, prix de vente pré-rempli au tarif public Tesla), ajoute une ligne
de matériel fourre-tout pour le câblage et une ligne de main d'œuvre « pose et mise en service ». Les prix du
catalogue viennent d'un balayage de la boutique BayWa, rejouable quand Eric veut rafraîchir.

Décisions d'Eric (chat du 2026-10-24) :
- Sections de la famille : **ÉQUIPEMENT · MATÉRIEL · MAIN D'ŒUVRE**. MATÉRIEL = une ligne fourre-tout (câblage).
- Prix de vente par défaut des équipements Tesla = **prix public Tesla, qui est HT** (capture du site Tesla :
  Powerwall 3 seule 5 500 € · avec Gateway 6 650 € · + 1 unité d'extension 10 280 € · avec Gateway + extension 11 430 €).
- Pas d'export BayWa : les prix sont **aspirés** depuis le site.

## 2. Objectifs · non-objectifs · anti-objectifs

**Objectifs**
- Une famille de devis « Batterie » disponible dans le module devis, avec ses trois chapitres.
- Un fournisseur « BAYWA R.E. » dans Settings → Fournisseurs, catégorie `batterie`, alimenté par un import
  rejouable : les batteries et accessoires de stockage de BayWa, toutes marques, plus les accessoires Tesla rangés
  ailleurs chez BayWa (coffrets Kamase pour onduleur hybride Tesla, compteurs, câbles).
- Prix d'achat HT = prix BayWa de la session Mayer ; prix de vente = tarif public Tesla pour les références Tesla
  connues, « à renseigner » (0) pour le reste, jamais écrasé par un ré-import.
- Un relevé reproductible du catalogue BayWa (fichier de données daté dans le dépôt), qu'Eric peut refaire seul.

**Non-objectifs (cette tranche)**
- Les 840 autres articles BayWa (modules PV, onduleurs, fixations, bornes) : ils sont dans le relevé brut mais ne
  sont pas importés. Ils attendront une catégorie `solaire` et une famille de devis photovoltaïque.
- Affichage du stock BayWa dans l'app : la quantité disponible est conservée dans le relevé et dans les specs de
  l'article (datée), aucune UI ne l'affiche.
- Dimensionnement (quelle capacité pour quel foyer) : hors périmètre, le calculateur Solaire garde le sien.

**Anti-objectifs**
- Un prix de vente écrasé en silence au ré-import (vécu Solipac : le prix de vente est saisi à la main et se garde).
- Un article BayWa « sur devis » importé avec son prix fictif (61 kits à 5 000 / 10 000 / 100 000 €).
- Des identifiants fournisseur dans `core.organizations.settings` (lisible par tout membre) ou dans le code : ils
  vivent dans le Vault, derrière des RPC (§ 7).
- Un contournement de protection anti-robot (Cloudflare Turnstile de Domos) : on ne le fait pas.

## 3. Ce qui existe déjà et qu'on réutilise

- Catalogue fournisseur `majordhome.supplier_products` (+ `suppliers`), import rejouable modèle **Solipac**
  (`scripts/clim/import-tarif-solipac.mjs` → SQL `DO $$` appliqué par `scripts/fumisterie/apply-sql.mjs`).
  La colonne `category` est du texte libre (aucune contrainte CHECK, vérifié en prod le 2026-10-24) : valeurs
  actuelles `poele` 163, `climatisation` 60, `fumisterie` 24 428, NULL 16.
- Liste des catégories côté front : `PRODUCT_CATEGORIES` (`suppliers.service.js`), `CATEGORIES_PRODUIT`
  (`src/lib/devisConfig.js`), `CATEGORIE_LABELS` (`settings/devis/FamillesEditor.jsx`), consommées aussi par
  `SupplierManagement.jsx` et `ProductDetailDrawer.jsx`.
- Familles de devis : `DEFAULT_FAMILLES` de `devisConfig.js`, surcharge `settings.devis.familles` (merge niveau 1,
  sauver l'objet `devis` COMPLET), éditeur Settings → Devis.
- Éditeur de lignes `DevisStepLines.jsx` : section MAIN D'ŒUVRE → bouton main d'œuvre ; sections « AUTRE » /
  « PRESTATIONS » → ligne libre ; autres sections → sélecteur catalogue filtré par `famille.categorie`.
- Drawer produit (Settings → Fournisseurs) : prix d'achat / prix de vente / marge, specs `canonical` éditables.

## 4. Données : le relevé BayWa

**Source** : l'API JSON de la boutique (NetSuite SuiteCommerce), `GET /api/items?…&q=&limit=100&offset=N`,
appelée **depuis le navigateur avec la session BayWa d'Eric ouverte** (sans session, le prix est masqué). Niveau de
prix de la session Mayer (`pricelevel=345`). Relevé du 2026-10-24 : 995 articles, enregistré dans
`scripts/catalogue/data/baywa-2026-10.json` (dossier `scripts/catalogue/` : un sous-ensemble par fournisseur).

**Forme d'un article du relevé** (sous-ensemble conservé) : `itemid` (référence BayWa, ex. `35-119503`),
`internalid`, `displayname`, `storedisplayname2` (libellé FR), `storedescription`, `urlcomponent`, `itemtype`,
`price` (HT, session), `ispurchasable`, `isbackorderable`, `quantityavailable`, `fields` (= `custitem_webshopjson`
parsé : `mpn` référence fabricant, `custitem_manufacturerfacet`, `cseg_itemcategory`, `custitem_itemtitle`,
énergie utile `custitem_usableenergy`, type `custitem_batterytype`, cellules `custitem_batterycelltechnology`,
garanties `custitem_productwarrantysc` / `custitem_perfwarrantysc`, dimensions `custitem_pacejetitem*`, `weight`…),
`docs` (fiches techniques FR/EN : `{ type, lang, url }`).

**Procédure de relevé (reproductible par Eric, sans Claude)** : un fichier `scripts/catalogue/dump-baywa.browser.js`
à coller dans la console du navigateur une fois connecté à BayWa ; il pagine l'API, construit le même JSON et
déclenche le téléchargement de `baywa-AAAA-MM.json`. Eric dépose le fichier dans `scripts/catalogue/data/` puis lance
l'import. L'en-tête du script d'import documente ces trois gestes. Le code exact qui a produit le relevé du
2026-10-24 est ci-dessous (exécuté dans la page `solarshop.baywa-re.fr` connectée) ; le fichier versionné en est la
mise au propre, avec le déclenchement du téléchargement en plus :

```js
const base = '/api/items?language=fr&currency=EUR&c=6376560&sitepath=%2Fsca-lux-2019-2%2FsearchApi.ssp&use_pcv=T&fieldset=search&n=4&custitem_frsy_purchasable_component=false&country=FR&pricelevel=345&q=&limit=100';
const items = []; let total = null;
for (let offset = 0; ; offset += 100) {
  const r = await fetch(base + '&offset=' + offset, { credentials: 'include' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' offset ' + offset);
  const j = await r.json(); total = j.total;
  for (const it of j.items) {
    let ws = null; try { ws = it.custitem_webshopjson ? JSON.parse(it.custitem_webshopjson) : null; } catch {}
    const docs = [];
    for (const g of (ws?.documents?.documents || [])) for (const x of (g.docs || [])) if (['FR', 'EN'].includes(x.language)) docs.push({ type: g.name, lang: x.language, url: x.url });
    items.push({ internalid: it.internalid, itemid: it.itemid, displayname: it.displayname, storedisplayname2: it.storedisplayname2,
      storedescription: it.storedescription, urlcomponent: it.urlcomponent, itemtype: it.itemtype,
      price: it.onlinecustomerprice, price_detail: it.onlinecustomerprice_detail, ispurchasable: it.ispurchasable,
      isbackorderable: it.isbackorderable, quantityavailable: it.quantityavailable,
      noprice_visible: it.custitem_frsy_noprice_visible, requiredsalesunit: it.custitem_frsy_requiredsalesunit,
      recommendedsalesunit: it.custitem_recommendedsalesunit, fields: ws?.fields ?? null, docs });
  }
  if (j.items.length < 100 || items.length >= total) break;
}
// → { source, fetched_at: new Date().toISOString(), total, items }
```
`docs` et `fields` viennent du champ `custitem_webshopjson` de chaque item (un seul appel par page, pas de second
appel). Les URLs de fiches sont relatives et signées (`/core/media/media.nl?…&h=…`) : préfixer par
`https://solarshop.baywa-re.fr`. Le `pricelevel` est celui de la session : un autre compte verrait d'autres prix.

## 5. L'import : `scripts/catalogue/import-releve.mjs`

Même squelette que Solipac (lecture du JSON → SQL `DO $$` rejouable dans `scripts/catalogue/out/`, appliqué par
`apply-sql.mjs`). Règles :

- **Fournisseur** : « BAYWA R.E. » (créé s'il manque, org Mayer par défaut, `--org` possible).
- **Périmètre importé** = `fields.cseg_itemcategory = 'Battery Storage'` **OU** fabricant `Tesla` **OU** libellé
  mentionnant `Tesla` / `Powerwall` (coffrets Kamase « pour onduleur hybride Tesla »). **Exclus** : `itemtype = 'Kit'`
  sans catégorie (les 61 « sur devis »), prix absent, `ispurchasable = false`. Le script affiche le décompte
  retenu / exclu et échoue bruyamment sur une référence en double ou un prix non numérique.
- **Clé** : `reference` = `itemid` BayWa (stable, propre à BayWa) ; `specs.canonical.mpn` = référence fabricant.
- **Kits** : tout article `itemtype = 'Kit'` est exclu, catégorisé ou non (relecture builder : 13 kits « Battery
  Storage » dont 8 sets SMA au prix fictif de 10 000 € ; les 5 sets à prix réel se recomposent depuis leurs composants,
  eux importés). Périmètre mesuré sur le relevé du 2026-10-24 : 100 articles avant exclusion des kits.
- **Désignation** (`name`) : aucun champ BayWa n'est fiable seul (`storedisplayname2` est en anglais pour 90 articles
  sur 100, `displayname` est un code SKU pour la moitié). Règle : `displayname` s'il ressemble à une phrase (contient
  une espace et n'est pas tout en capitales/tirets), sinon `storedisplayname2` ; par-dessus, une petite table de
  libellés FR dans le script pour les références Tesla principales (Powerwall 3, extension DC, Backup Gateway 2,
  Remote Meter mono/tri). **`name` est écrit à l'INSERT seulement** : une correction faite dans le drawer survit au
  ré-import (contrairement au squelette Solipac qui réécrit le libellé). Un reste en anglais se corrige dans le drawer.
- **Colonnes** : `category = 'batterie'`, `brand` = fabricant, `gamme` = sous-famille lisible dérivée (« Batterie »,
  « Stockage tertiaire » pour les systèmes ≥ 20 kWh, « Passerelle / Gateway », « Compteur », « Coffret », « Câble »,
  « Accessoire »), `unit = 'pièce'`, `product_kind = 'main'` pour une batterie (énergie utile renseignée) sinon
  `'accessory'`, `purchase_price_ht = price`, `default_tva_rate` : même valeur que l'import Solipac.
- **`specs.canonical`** (merge JSONB, les clés posées à la main dans le drawer sont conservées) : `mpn`, `fabricant`,
  `energie_utile_kwh`, `type_batterie`, `technologie_cellules`, `garantie_produit_ans`, `garantie_perf_ans`,
  `dimensions_cm` (L × l × H), `poids_kg`, `fiche_technique_fr` (URL BayWa, FR sinon EN), `baywa_internalid`,
  `stock_releve` = `{ qty, at }`, `source_version` (ex. `baywa_2026-10`).
- **Prix de vente** : écrit **à l'INSERT seulement**. Table des prix publics Tesla HT par préfixe de MPN, dans le
  script avec la date de relevé Tesla : Powerwall 3 (`1707000-…`) **5 500** ; Backup Gateway 2 (`1152100-…`)
  **1 150** (= 6 650 − 5 500) ; unité d'extension DC (`1807000-…`) **4 780** (= 10 280 − 5 500). Tout autre article
  part à **0** (« prix de vente à renseigner », comme Solipac). Un article existant garde son prix de vente, sauf
  s'il vaut encore 0 et qu'une entrée de la table Tesla le couvre (un Tesla inséré avant l'extension de la table ne
  reste pas à 0 pour toujours).
- **Article absent du relevé** → `is_active = false`, jamais supprimé.
- **Test** `scripts/catalogue/baywa.test.mjs` (`node --test`, ajouté à `audit:quality`) sur le relevé
  réel : nombre d'articles retenus, Powerwall 3 à 4 773,29 € d'achat / 5 500 € de vente, extension 3 969,76 / 4 780,
  Gateway V2 835,32 / 1 150, aucun kit « sur devis », aucun prix fictif ≥ 5 000 hors batteries ≥ 10 kWh.

## 6. Côté application

- **Catégorie `batterie`** ajoutée aux trois listes front (`PRODUCT_CATEGORIES`, `CATEGORIES_PRODUIT`,
  `CATEGORIE_LABELS`), libellé « Batterie ». Pas de migration.
- **Famille par défaut** dans `DEFAULT_FAMILLES` : `{ key: 'batterie', label: 'Batterie', actif: true,
  categorie: 'batterie', sections: ['ÉQUIPEMENT', 'MATÉRIEL', 'MAIN D\'ŒUVRE'] }`, placée après Chauffage/PAC.
  **Gotcha** : une org qui a déjà enregistré `settings.devis.familles` ne voit pas les nouveaux défauts
  (`buildDevisConfig` prend la liste enregistrée telle quelle). Le builder vérifie l'état de Mayer ; si une liste est
  enregistrée, la famille y est ajoutée via Settings → Devis (même geste que l'utilisateur, aucun SQL à la main).
- **Ligne libre dans MATÉRIEL** : `DevisStepLines.jsx` n'offre la ligne libre que pour « AUTRE » / « PRESTATIONS ».
  Mon choix : étendre la règle à « MATÉRIEL » (regex), la section garde en plus le sélecteur catalogue si Philippe
  veut y piocher un coffret ou un câble BayWa. La ligne libre part avec le prix d'achat vide et un prix de vente à
  saisir, comme aujourd'hui.
- MAIN D'ŒUVRE : rien à faire, le bouton main d'œuvre existe. Rien à faire non plus dans le PDF ni dans
  `devisDocumentModel` : une famille de plus suit le modèle existant.

## 7. Connexion fournisseur dans Settings → Fournisseurs (décision Eric, même jour)

Eric veut le relevé **automatique** pour BayWa (« on va faire ça, dans l'onglet fournisseurs du paramétrage ») et
ajoute un second fournisseur à relever : **Domos Industries** (`webshop.domosindustries.com`, WooCommerce). Vérifié
le 2026-10-24 : Domos est derrière un défi Cloudflare Turnstile ⇒ **aucune connexion serveur possible, et on ne
contourne pas une protection anti-robot** ; le relevé Domos se fait depuis le navigateur d'Eric, connecté. BayWa
(SuiteCommerce) se connecte par un appel `POST …/services/Account.Login.Service.ss` sans captcha visible ; la page
porte un cookie Akamai (`bm_sv`) : si la connexion serveur est refusée, l'app le dit et renvoie au relevé manuel.

**Deux modes de connexion**, portés par une colonne `suppliers.connector` (`NULL` · `'baywa'` · `'domos'`) :
- **automatique** (`baywa`) : identifiants saisis par un org_admin dans la fiche fournisseur, rangés dans le
  **Vault** (jamais dans `settings`), relevé lancé par un bouton « Actualiser le catalogue » et chaque nuit par un cron ;
- **manuel** (`domos`, et repli de `baywa`) : bouton « Importer un relevé » qui prend le fichier JSON produit par le
  script de console du fournisseur.

**Un seul écrivain du catalogue** : la RPC `public.supplier_catalog_upsert(p_org_id, p_supplier_id,
p_source_version, p_rows jsonb)` (SECURITY DEFINER, `service_role` seul car `org_id` est dans le payload) porte les
règles du § 5 (libellé et prix de vente à l'INSERT, prix Tesla ré-appliqué si 0, désactivation des absents) et
écrit `suppliers.catalog_sync_at` / `catalog_sync_result`. Le script Node (premier chargement, repli sans edge) et
l'edge `supplier-catalog-sync` (bouton, import de fichier, cron) l'appellent tous les deux. La transformation
relevé → lignes est un **module PUR par fournisseur** (`src/lib/catalogue/baywa.js`, copié pour Deno par
`sync:tournee-engine`), le même pour les deux chemins.

**Secrets par org** (première brique du « secrets par org » du plan SaaS) : RPC `org_secret_set(p_org_id, p_key,
p_value)` (org_admin par `auth.uid()`, `IF auth.uid() IS NULL THEN RAISE` en tête), `org_secret_status(p_org_id,
p_key)` (membre ; renvoie existence et date, jamais la valeur), `org_secret_read(p_org_id, p_key)` (`service_role`
seul). Nom Vault : `org:<org_id>:<key>`, clé `supplier:<supplier_id>:credentials`, valeur JSON `{ email, password }`.

**Domos** (relevé fait le 2026-10-24 via Claude in Chrome, session Eric) : l'API WooCommerce Store
(`/wp-json/wc/store/v1/products?per_page=100&page=N`, réservée aux comptes connectés, prix HT en **centimes** dans
`prices.price`, `currency_minor_unit = 2`) renvoie 761 articles, enregistrés dans `scripts/catalogue/data/domos-2026-10.json`
(`{ source, fetched_at, total, items, categories }`, `items[]` = sous-ensemble : `id, name, slug, sku, permalink, type,
prices, is_in_stock, is_purchasable, categories[{id,name,slug}], attributes[{name,terms}], short_description,
description, image`). **Périmètre importé** = articles dont une catégorie a pour slug `systeme-de-stockage`,
`batteries-ac`, `batteries-dc`, `accessoires-systeme-de-stockage`, `kits-de-stockage` ou `kit-batterie` ; **exclus** :
`type !== 'simple'` (156 bundles sans prix ni SKU), prix 0, SKU vide. Même catégorie `batterie` que BayWa (Domos vend
le même spectre : PV, onduleurs, fixation, stockage ; le reste attendra `solaire`). Référence = `sku` Domos ; marque =
premier segment du nom avant « – » (`ATMOCE – …`) ; `product_kind 'main'` si la catégorie est `batteries-ac` /
`batteries-dc` et que le nom porte une capacité en kWh, sinon `'accessory'` ; gamme : « Batterie AC », « Batterie DC »,
« Accessoire stockage », « Kit de stockage » ; aucun prix de vente par défaut (0). Le script de console
`scripts/catalogue/dump-domos.browser.js` reproduit ce relevé (pagination de l'API + téléchargement du fichier).

## 8. Laissé au builder

- Forme exacte du SQL, nom des gammes, ordre d'affichage, libellé du fournisseur si BayWa apparaît déjà
  sous un autre nom en base (vérifié : non, cinq fournisseurs Mayer aujourd'hui : DINAK, INTERSTOVE, INVICTA,
  MODINOX / ALTEMA, SOLIPAC).
- Heure du cron, texte des messages d'erreur, disposition du panneau dans la fiche fournisseur.
