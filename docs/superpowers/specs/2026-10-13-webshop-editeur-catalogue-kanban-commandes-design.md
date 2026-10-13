# Webshop — éditeur de catalogue + kanban des commandes

**Date** : 2026-10-13 · **Statut** : design validé en conversation (Eric), spec à relire
**Périmètre** : page `/webshop` de Majord'home (onglets « Produits & tarifs » et « Commandes »). L'onglet « Inscriptions » ne bouge pas.

## 1. Pourquoi

- Le site Mayer (`C:\Dev\Landing Page - Mayer`, boutique `/boutique`) lit en direct `majordhome_webshop_products` et `majordhome_webshop_categories` (clé service, filtre `org_id`). Il consomme : nom, marque, catégorie, descriptions courte/longue, prix TTC, TVA, stock, rupture autorisée, délai, colis/palette, emplacements palette, poids, **photos** (`images` jsonb = tableau d'URL), **caractéristiques** (`specs` jsonb clé → valeur), mis en avant, SEO. La page borne lit en plus les prix posés (`install_price_ttc`, `pro_install_price_ttc`, `install_vat_rate`).
- Majord'home ne sait éditer que 3 prix + la visibilité. Tout le reste (7 produits, 14 catégories) a été saisi en SQL ou par le script d'import Dixneuf du site.
- L'onglet Commandes lit l'ancien modèle « 1 commande = 1 produit » (`product_id`, `quantity`). Les commandes boutique ont maintenant N lignes (`webshop_order_items`), un paiement Stripe, une livraison palette sur créneau. Le statut `en_attente_paiement` (posé par le checkout du site) est inconnu de Majord'home.
- Le service `webshop.service.js` n'applique pas le filtre `org_id` sur ses mutations (règle multi-tenant).

**Succès** : un org_admin crée, modifie, masque un produit (photos comprises) depuis Majord'home et le voit sur le site sans intervention technique ; l'équipe suit les commandes boutique dans un kanban où chaque carte dit quoi expédier, à qui, comment.

## 2. Produits & tarifs

### 2.1 Liste
Une ligne par produit : miniature (1ʳᵉ photo ou pictogramme), nom + marque, catégorie, prix TTC, stock (badge ambre si 0 et rupture non autorisée), interrupteur **Visible**, étoile **Mis en avant**. Visible et Mis en avant s'enregistrent au clic (toast + rollback si erreur).
- Recherche texte (nom, marque, référence fournisseur) côté client — 7 produits, pas de pagination.
- Filtre par catégorie (catégories racines + sous-catégories, indentées).
- Bouton **Nouveau produit**, action **Dupliquer** (copie sans slug ni photos, nom suffixé « (copie) », masquée).
- Ordre d'affichage = `display_order` ; nouveau produit rangé en fin. Pas de glisser-déposer pour réordonner en V1.

### 2.2 Panneau d'édition (drawer à droite)
Un seul formulaire (React Hook Form + Zod), un bouton **Enregistrer** actif seulement si modifié et valide, **Annuler** qui ferme (confirmation si modifications non enregistrées).

Blocs, de haut en bas :
1. **L'essentiel** (ouvert) : nom*, marque, catégorie (select), description courte, prix TTC*, TVA* (select 5,5 / 10 / 20 %).
2. **Photos** (ouvert) : zone glisser-déposer + bouton parcourir, vignettes réordonnables (glisser), la 1ʳᵉ marquée « principale », suppression par vignette. Formats jpeg/png/webp, 8 Mo max par fichier.
3. **Caractéristiques** (ouvert) : lignes « libellé — valeur », ajouter / supprimer / réordonner. Stockées dans `specs` (objet JSON, ordre d'insertion conservé).
4. **Stock & livraison** : expédition* (colis / palette), emplacements palette (si palette), poids kg, stock, « vendre en rupture » (allow_backorder), délai (jours).
5. **Pose** (replié, ouvert s'il est renseigné) : prix posé particulier TTC, prix posé pro TTC, TVA pose.
6. **Achat** (replié) : fournisseur, référence fournisseur, EAN, prix d'achat HT ; **marge** affichée en lecture (prix TTC → HT via TVA − achat HT, en € et %).
7. **Avancé** (replié) : description longue (textarea), titre SEO, description SEO (compteurs 60 / 160 caractères), adresse de la page (slug).

En-tête du drawer : nom, badge Visible/Masqué, lien « Voir sur le site » (`https://mayer-energie.fr/boutique/p/{slug}` — base lue dans les settings d'org, cf. 2.5).

### 2.3 Règles
- **Slug** : calculé depuis le nom à la création (minuscules, sans accents, tirets), unique dans l'org (suffixe `-2`… si collision). **Figé ensuite** (URL et SEO) : affiché en lecture dans « Avancé », modifiable seulement via un bouton « Modifier l'adresse » qui avertit que l'ancienne URL cassera.
- **Pas de suppression** : un produit se masque (`is_active=false`). Les commandes passées le référencent (`order_items.product_id`).
- **Produit visible incomplet** : le site exclut les produits sans `shipping_kind` ; le formulaire l'exige donc. Un produit sans photo reste publiable (le site a un placeholder) mais la liste affiche un avertissement discret « sans photo ».
- Champs vides → `null` (jamais `''`) pour que le site retombe sur ses défauts.

### 2.4 Photos — stockage
- Bucket **`webshop`** existant (public, créé le 2026-10-12 par le script d'import du site, vide, **sans policy**). Chemin : `${orgId}/products/${productId}/${uuid}.webp`.
- Conversion côté navigateur en WebP (canvas, largeur max 1600 px, qualité 0,82) avant envoi — même format que le script d'import.
- `images` = tableau d'URL publiques (`getPublicUrl`). Les URL existantes (chemins `/images/boutique/...` du dépôt du site, URL Supabase de l'import) sont conservées telles quelles et affichées (préfixe `https://mayer-energie.fr` pour les chemins relatifs, via le même réglage que 2.5).
- Retirer une photo la retire du tableau ; le fichier n'est supprimé du bucket que s'il est sous `${orgId}/` (jamais un fichier de l'import ou du site).
- Le site autorise déjà `**.supabase.co` dans `next/image` : aucune modification du site.
- Migration : bucket `webshop` → `file_size_limit` 8 Mo, `allowed_mime_types` image/*, policies INSERT/UPDATE/DELETE `(storage.foldername(name))[1]::uuid` ∈ orgs dont l'utilisateur est **org_admin** ; lecture publique (bucket public).

### 2.5 Réglage d'org
`settings.webshop.site_url` (ex. `https://mayer-energie.fr`) — sert au lien « Voir sur le site » et à l'aperçu des images relatives. Éditable dans un petit encart en tête de l'onglet Produits (règle « pas de config sans UI ») ; absent → pas de lien, images relatives affichées en placeholder.

### 2.6 Droits
**org_admin uniquement** pour toute écriture catalogue (décision Eric 2026-10-13).
- Front : onglet Produits en lecture seule pour les autres (champs désactivés, pas de bouton Nouveau).
- Base : policies INSERT/UPDATE/DELETE de `majordhome.webshop_products` et `webshop_categories` restreintes à `org_admin` (SELECT inchangé, membre). Le site écrit/lit en service_role : non affecté. Pas de ressource `role_can` en V1 (à basculer si un autre rôle doit éditer).

### 2.7 Coexistence avec l'import Dixneuf (site)
`scripts/import-dixneuf.ts` met à jour les produits Dixneuf existants en écrasant tout **sauf** `slug, price_ttc, shipping_kind, pallet_slots, vat_rate` (et les images seulement si le CSV en fournit). Une description ou des caractéristiques modifiées dans Majord'home seront donc écrasées par un ré-import. **Hors périmètre** : le signaler dans le drawer des produits `supplier='dixneuf'` (« les textes peuvent être remplacés par un ré-import du catalogue fournisseur ») et noter la question pour plus tard.

## 3. Commandes — kanban

### 3.1 Colonnes
Nouvelle → Confirmée → Transmise fournisseur → Expédiée → Livrée, via le `KanbanBoard` partagé (DnD). « En attente de paiement » et « Annulée » sont deux colonnes **repliées** à droite (compteur visible, dépliables). Une commande en attente de paiement ne se déplace pas à la main (le webhook Stripe la fait passer en Nouvelle) ; seul « Annuler » est permis depuis le drawer.

### 3.2 Carte
Numéro + date, nom du client + ville, total TTC, résumé des lignes (« Pellets Premium ×2, Serviteur Arcadia ×1 », tronqué), pastilles : Palette (+ date du créneau) / Colis / Retrait, Pro, Vente + installation, alerte ambre **Planification manuelle** (`needs_manual_planning`) et **Créneau modifié** (`delivery_slot_changed`).

### 3.3 Glisser une carte
Change le statut. `shipped_at` / `delivered_at` posés automatiquement (comportement actuel du service). Passer en **Annulée** par glisser ouvre une confirmation avec motif (`cancel_reason`) ; retour arrière autorisé sauf depuis Annulée (réactiver = drawer, confirmation).

### 3.4 Drawer commande
Lignes de commande (`webshop_order_items` : produit, qté, PU, total, colis/palette), sous-total / livraison / total, ventilation TVA ; client et adresse (tél/email cliquables) ; livraison (mode palette/colis, créneau + secteur, point de retrait) ; paiement (payé le / session Stripe) ; concessionnaire (commandes pro) ; lead lié (lien vers la fiche) ; transporteur, n° de suivi, notes internes (enregistrer) ; statut (select).
Les commandes historiques sans lignes (`order_items` vides, ancien modèle borne) affichent leur produit unique (`product_id`, `quantity`, `unit_price_ttc`) — même rendu.

### 3.5 Filtres
Recherche (numéro, nom, ville, email), canal (particulier / pro), type (expédition / installation). Pas de filtre par statut : ce sont les colonnes.

## 4. Données & code

- **Vue** `majordhome_webshop_orders` : la recréer `security_invoker=true` en ajoutant en fin de liste les colonnes du nouveau modèle déjà présentes dans la table (`pallet_delivery_mode`, `parcel_delivery_mode`, `pickup_point_id`, `subtotal_ttc_cents`, `shipping_ttc_cents`, `total_ttc_cents`, `vat_breakdown`, `paid_at`, `cancel_reason`, `delivery_slot_id`, `delivery_slot_changed`, `needs_manual_planning`). Lignes lues par une 2ᵉ requête sur `majordhome_webshop_order_items` (`.in('order_id', ids)`), créneau / secteur / point de retrait par requêtes groupées, fusion en mémoire (pattern `getTeamDayAvailability`). Vérifier les autres consommateurs de la vue (site : n'utilise que `_write`).
- **Service** `webshop.service.js` : toutes les lectures et mutations prennent `orgId` et filtrent `.eq('org_id', orgId)` ; ajouts `createProduct`, `duplicateProduct`, `getCategories`, `uploadProductImage`, `deleteProductImage`, `getOrderDetails`. Retour `{ data, error }` via `withErrorHandling`. Si le fichier dépasse 700 LOC → `webshopProducts.service.js` + `webshopOrders.service.js`.
- **Hooks** `useWebshop.js` (nouveau) : `useWebshopProducts`, `useWebshopCategories`, `useWebshopOrders`, mutations via `unwrapResult()` ; cache keys `webshopKeys` dans `cacheKeys.js` (`all: (orgId) => ['webshop', orgId]`). La page actuelle (useState + appels directs) est remplacée.
- **Modules purs testés** `src/lib/webshop/` : `slugify` + désambiguïsation, `productFormToPayload` / `productToForm` (null pour vide, specs ordonnées), `margin(priceTtc, vatRate, purchaseHt)`, `orderLinesSummary(order, items)` (nouveau modèle + repli ancien), `columnForStatus`. Tests `node --test scripts/webshop-*.test.mjs`, ajoutés à `audit:quality`.
- **Composants** `src/apps/artisan/components/webshop/` : `ProductsTab`, `ProductList`, `ProductDrawer` (orchestrateur) + une section par bloc, `ProductImagesField`, `SpecsField` ; `OrdersKanban`, `OrderCard`, `OrderDrawer`. `Webshop.jsx` redevient un simple orchestrateur d'onglets (< 100 LOC). Aucun composant > 500 LOC.
- **Migration** `supabase/migrations/20261013_x_webshop_editeur.sql` : policies `org_admin` (2.6), bucket + policies storage (2.4), vue commandes (4). `REVOKE`/`GRANT SELECT … TO service_role` vérifiés sur les tables lues par la vue. Répétée sur `scripts/migration-rehearsal/` (étendre `snapshot.mjs` si les objets webshop n'y sont pas).

## 5. Hors périmètre (V1)
Édition des catégories, réordonnancement des produits par glisser, gestion des secteurs / créneaux / tarifs de livraison, emails client sur changement de statut, remboursement Stripe sur annulation, ressource `role_can` « webshop », réconciliation avec l'import Dixneuf.

## 6. Vérification
- Tests purs verts, `npx vite build`, `npm run lint` sans nouveau warning, `audit:quality`.
- En prod après migration : `has_table_privilege`/impersonation — un membre non admin ne peut pas UPDATE un produit ; upload d'une image dans `${orgId}/…` accepté pour l'admin, refusé hors de son préfixe.
- Bout en bout : modifier le prix et une caractéristique d'un produit, ajouter une photo, puis vérifier la page `/boutique/p/{slug}` du site.
