# Devis — référence interne, caractéristiques imprimées, détail des prix par chapitre, éditer l'article depuis la ligne

**Date** : 2026-10-26 · **Demandeur** : Eric · **Statut** : LIVRÉ le 2026-10-26 (plan exécuté par sous-agents, migrations `20261028_1..3` en prod). Écarts constatés : pages Réglages (Articles, Fournisseurs) restées org_admin, le team_leader édite depuis la ligne de devis ; longueur de description Pennylane non testée sur un brouillon réel ; GRANT UPDATE par colonne sur `catalog_items` et contrôle d'org de `product_documents.catalog_item_id` reportés à un durcissement dédié.
**Dépend de** : articles Majord'home (`docs/superpowers/specs/2026-10-24-articles-majordhome-matrice-fournisseurs-design.md`, migrations `20261026_1..3`, `20261027_1..8`) et du modèle de document (`2026-10-06-parametrage-devis-modele-document-design.md`).

## 1. Intention

La saisie d'un devis doit rester simple pour Philippe, et le document remis au client doit porter ce qui compte pour lui : les caractéristiques de l'équipement (notamment les valeurs écologiques exigées par les dossiers de primes), une description libre par ligne, et la possibilité de ne pas détailler les prix d'un chapitre (l'ensemble fumisterie du configurateur, par exemple) pour éviter « l'épicerie » et la négociation ligne par ligne. En parallèle, chaque article de la base reçoit sa référence interne, clé commune à terme entre fournisseurs, et un article présent dans un devis se corrige sans quitter le devis.

Quatre parts, livrables dans l'ordre ou séparément. Le picker d'articles par type de chapitre (équipements seuls dans un chapitre Équipement, produits types du stock dans Matériel, recherche par mots sans accents) est **déjà livré** le 2026-10-25 et n'est pas touché ici.

## 2. Objectifs · non-objectifs · anti-objectifs

**Objectifs**
1. Un article porte une **référence interne** (code de l'entreprise), unique par org, cherchable, imprimée dans la colonne Référence du devis quand la ligne vient d'un article.
2. Une ligne de devis peut imprimer les **caractéristiques** de son article et une **description libre** saisie dans l'éditeur.
3. Un chapitre peut **masquer ses prix** sur le document : lignes listées, prix unitaires et totaux de ligne absents, sous-total du chapitre conservé.
4. Depuis une ligne, **« Éditer l'article »** ouvre la fiche article par-dessus le devis ; la ligne se réaligne à la fermeture. L'écriture d'un article s'ouvre à `team_leader` et au-dessus (décision d'Eric, 2026-10-26).

**Non-objectifs**
- Pas de choix spec par spec dans le devis (on imprime toutes les specs renseignées ; une valeur indésirable se corrige sur l'article).
- Pas de génération automatique de la référence interne ; pas de migration des références fournisseur vers ce code.
- Pas de changement du picker, de la recherche ni de la règle de marge (prix d'achat le plus bas).
- Pas de masquage de prix ligne par ligne, seulement par chapitre.
- Le push Pennylane (bloc B) ne change pas de mécanique ; voir § 7 pour ce qu'il transporte.

**Anti-objectifs** (ce qui ferait de la livraison un échec)
- Écraser ou réutiliser la **référence fournisseur** des lignes fournisseur : le relevé nocturne ne retrouverait plus ses lignes. La référence interne vit sur l'article seulement.
- Un PDF qui relit l'article au moment de l'impression : les caractéristiques imprimées sont **figées dans la ligne** à l'enregistrement du devis, jamais relues de l'article à la génération du PDF (règle « un artefact remis au client lit les valeurs enregistrées », § Module Contrats). Un devis **envoyé reste modifiable** aujourd'hui (« Modifier » sur brouillon ou envoyé, le PDF archivé est régénéré au clic) : on ne change pas ce comportement, le figeage suit chaque enregistrement ; accepté / refusé restent figés.
- Un champ de ligne qui se perd en silence : `upsertQuoteLines` supprime puis réinsère toutes les lignes depuis l'état du front ; **tout nouveau champ doit être porté par l'état de ligne du front ET par la vue `_write`**, sinon il disparaît au second enregistrement (gotcha vécu avec `catalog_item_id`).
- Un bouton « Éditer l'article » visible mais dont l'enregistrement échoue en silence pour un `team_leader` : droits en base ET à l'écran, même verdict.

## 3. État actuel (vérifié le 2026-10-26)

- Une ligne de devis (`majordhome.quote_lines`) porte déjà `description` ; le modèle de document et `DevisPDF.jsx` l'impriment sous la désignation ; **l'éditeur (`DevisLineRow.jsx`) ne propose aucune saisie de description**.
- Les chapitres ne sont pas une entité : une ligne `line_type = 'section_title'` ouvre un chapitre ; `chapitres(lines)` dans `devisDocumentModel.js` regroupe. Chaque chapitre a un type (`typeChapitre(config, famille, titre)` : `equipement | option | stock | main_oeuvre | libre | fumisterie`).
- Réglages d'affichage d'org (`settings.devis.affichage` : `references`, `prix_unitaires`, `tva_par_ligne`, `detail_lignes`) : niveau document, pas par chapitre. Quand `detail_lignes` est faux, la ligne de titre imprime déjà le sous-total du chapitre — on réutilise ce rendu.
- La fiche technique PDF de chaque équipement est déjà jointe en annexe (`src/lib/devisAnnexes.js`), la brochure aussi.
- `majordhome.catalog_items` : `name, brand, model_key, code_ean, category, gamme, product_kind, unit, default_tva_rate, selling_price_ht, description, image_url, specs { canonical, extras[] }, is_active, …`. **Aucune référence interne.** La recherche du picker lit la colonne `recherche` de la vue `majordhome_catalog_items_list` (concat de `name, brand, gamme, model_key, code_ean` + refs et marques des lignes fournisseur, minuscules sans accents).
- Schémas de specs (`src/shared/specs/`) : `poele`, `batterie`, `photovoltaique` seulement ; chaque champ = `{ key, label, unit?, type: number|enum|boolean|text, options? }`. Les autres catégories n'ont que `specs.extras[] = { label, value, unit? }` (et un `canonical` posé par les imports sans schéma, ex. clim Solipac).
- Écriture d'un article : policy `catalog_items_update_admin` (**org_admin seul**), RPC `catalog_item_create_for_product` / `_attach` / `_detach` / `_merge` / `_proposals_decide` (`org_admin_required`), documents d'article (`product_documents.catalog_item_id` renseigné) org_admin seul (`20261027_6`). Côté écran : `ArticleDrawer` (`canEdit = isOrgAdmin`), bouton « Créer l'article » de la ligne libre et du picker (org_admin). Les articles ne sont **pas** dans le registre des droits (`permissionsRegistry.js`).
- Une ligne posée depuis un article n'a ni `supplier_id` ni `reference` (recadrage du 2026-10-24) ; une ligne posée par le configurateur fumisterie ou l'import d'offre porte `supplier_product_id` + `reference` fournisseur.
- Le PDF du devis est archivé à l'envoi (`uploadQuotePdf` → `quotes.quote_pdf_path`) ; le devis peut aussi être poussé dans Pennylane en lignes libres (bloc B).

## 4. Part 1 — Référence interne de l'article

**Base** (migration versionnée, répétée sur le harnais) :
- `ALTER TABLE majordhome.catalog_items ADD COLUMN code text` (nullable). Contrainte : trim non vide s'il est renseigné (`CHECK (code IS NULL OR btrim(code) <> '')`).
- Unicité **par org, insensible à la casse**, articles vivants seulement : index unique partiel sur `(org_id, lower(code)) WHERE code IS NOT NULL AND merged_into IS NULL`. Le conflit remonte `23505` ; le front le traduit en « Cette référence est déjà portée par un autre article » (le nom de l'autre article est un plus, pas une exigence).
- Vues : `majordhome_catalog_items` (miroir updatable, **colonne en fin de liste**), `majordhome_catalog_items_list` (en fin, et `code` ajouté au `concat_ws` de `recherche`), `majordhome_catalog_item_offers` si elle expose l'article (en fin). `CREATE OR REPLACE VIEW` n'accepte l'ajout qu'en fin.
- La fusion d'articles (`catalog_item_merge_impl`) : le survivant garde son code ; s'il n'en a pas, il hérite de celui de l'absorbé (l'absorbé passe `code = NULL` avant pour ne pas violer l'index). À écrire dans la fonction, pas à la main.
- `supplier_products.reference` n'est pas touchée. Aucune recopie, aucun backfill.

**Écran** :
- Fiche article (`ArticleDrawer`) : champ **« Référence interne »** (libellé neutre, l'org n'est pas toujours Mayer), en tête des champs humains, placeholder « ex. ME-POE-0042 ». Trim à l'enregistrement.
- Liste des articles (`ArticlesPage`) et picker du devis (`DevisProductPicker`) : la référence s'affiche en préfixe discret du libellé quand elle existe, et la recherche la trouve (par la colonne `recherche`).

**Devis** :
- Quand une ligne est posée depuis un article (picker, variante, création d'article depuis la ligne), `line.reference = item.code || ''`. La ligne garde `catalog_item_id`, pas de `supplier_id`. La colonne Référence du document imprime ce qu'il y a dans `reference` (rien à changer au modèle) : code interne pour une ligne d'article, référence fournisseur pour une ligne fournisseur. Une ligne fournisseur dont l'article porte aussi un code garde sa référence fournisseur (on ne remplace pas ce qui est renseigné).
- Un code posé sur l'article **après** la pose de la ligne ne se propage pas tout seul ; « Éditer l'article » (part 4) réaligne la ligne.

## 5. Part 2 — Caractéristiques et description par ligne

**Base** : `ALTER TABLE majordhome.quote_lines ADD COLUMN show_specs boolean NOT NULL DEFAULT false, ADD COLUMN caracteristiques text[] NOT NULL DEFAULT '{}'` ; colonnes **en fin** des vues `majordhome_quote_lines` et `majordhome_quote_lines_write` (la `_write` doit les porter, sinon l'insert les perd).

**Règle** (module PUR nouveau `src/lib/devisCaracteristiques.js`, testé, inclus dans `audit:quality`) :
- `lignesCaracteristiques(article, schema)` → `string[]` prêtes à imprimer, PDF-safe (espaces ordinaires, virgule décimale, pas de glyphe hors cp1252 : « ≥ » devient « >= », etc.).
  - Specs canoniques : seulement si un schéma existe pour `article.category` (`getSchemaForCategory`), dans **l'ordre du schéma**, valeurs renseignées uniquement. Rendu : `Libellé : valeur unité` ; `number` → virgule FR, unité du schéma ; `enum` → libellé de l'option si le schéma en fournit un, sinon la valeur ; `boolean` → « oui » / « non » (faux non imprimé sauf si le schéma marque le champ pertinent — par défaut on n'imprime que les vrais, choix du builder documenté dans le module) ; `text` tel quel.
  - Sans schéma pour la catégorie, `canonical` n'est **pas** imprimé (ses clés sont des identifiants machine) ; seuls les `extras` le sont.
  - Extras : `label : value unité`, après les canoniques, dans l'ordre saisi.
  - **Catégories sans schéma (clim, PAC, chauffe-eau…)** : aujourd'hui `ArticleDrawer` ne monte le formulaire de specs (`ProductSpecsForm`) que si un schéma existe, donc les extras n'y sont pas saisissables et rien ne s'imprimerait. On rend la partie **extras** du formulaire disponible pour toute catégorie (la partie canonique reste conditionnée au schéma). Les valeurs de primes d'une PAC (SCOP, ETAS) se saisissent donc en extras tant que ces catégories n'ont pas de schéma — l'ajout de schémas `clim` / `pac` est un travail à part, signalé, pas embarqué ici (mon choix).
- Les schémas (`src/shared/specs/*.schema.js`) sont du JS pur sans React : le module `src/lib` peut les importer. S'ils tirent une dépendance non pure à l'avenir, passer le schéma en paramètre (c'est déjà la signature).

**Devis / éditeur** (`DevisLineRow.jsx`, `DevisStepLines.jsx`) :
- Coche **« Caractéristiques »** visible seulement sur une ligne qui a un `catalog_item_id`. Posée à `true` par défaut quand la ligne est ajoutée dans un chapitre de type `equipement`, `false` ailleurs ; l'utilisateur peut la changer. Un compteur indique « 6 caractéristiques » (0 = coche grisée avec « aucune caractéristique renseignée sur l'article », lien vers « Éditer l'article »).
- **Description** : zone de texte multi-ligne sous la désignation, repliée tant qu'elle est vide (icône « + description » dans les actions de la ligne), dépliée si remplie. Elle est figée dans `quote_lines.description`, imprimée sous la désignation (déjà fait par le modèle).
- **Figeage** : à chaque enregistrement du devis (brouillon), `upsertQuoteLines` écrit `caracteristiques = show_specs ? lignesCaracteristiques(article courant) : []`. Les articles sont déjà chargés par l'éditeur pour les marques (`useCatalogItemOffers`) ; le builder étend la lecture à `category` + `specs` (une requête sur `majordhome_catalog_items` par ids, nouveau hook ou extension de `useCatalogItemsResume`). Un devis **envoyé** ne se ré-enregistre plus : ses caractéristiques restent celles du PDF archivé.
- Modèle de document (`buildDevisDocumentModel`) : chaque ligne du tableau porte `caracteristiques: string[]` (vide si `detail_lignes` faux). `DevisPDF.jsx` les imprime sous la description, en petit, une par ligne ; l'aperçu HTML de Settings → Devis aussi (`ApercuDevis.jsx`). `exempleDevis` ajoute deux caractéristiques à la ligne d'équipement pour que l'aperçu les montre. Ajouter une zone n'est pas nécessaire : c'est un enrichissement de la zone `tableau`.

## 6. Part 3 — Détail des prix par chapitre

**Base** : `ALTER TABLE majordhome.quote_lines ADD COLUMN hide_prices boolean NOT NULL DEFAULT false` (en fin des deux vues). Portée par la ligne `section_title` ; ignorée sur les autres lignes.

**Éditeur** : sur la ligne de titre de chapitre, coche **« Afficher le détail des prix »**, cochée par défaut (`hide_prices = false`). Décochée, les lignes du chapitre restent éditables normalement (prix, remise) : seul le document change. Un chapitre créé par le configurateur fumisterie ou l'import d'offre est créé coché ; décocher reste un geste de l'utilisateur (pas de défaut par type de chapitre — Eric n'a pas demandé de règle, on ne devine pas).

**Modèle** : `chapitres[].prix_masques: boolean`. Quand vrai : `prix_unitaire`, `remise` et `total` de chaque ligne du chapitre sont des chaînes vides ; la ligne de titre affiche le sous-total du chapitre (même rendu que le cas `detail_lignes = false` existant) ; `tva` reste. Les totaux du devis ne changent pas (HT, TVA, TTC se calculent sur toutes les lignes). Les en-têtes de colonnes restent (d'autres chapitres montrent leurs prix) ; si tous les chapitres masquent, les colonnes sont vides, ce qui est accepté. Aperçu HTML identique.

**Test** du modèle (`scripts/devis-document-model.test.mjs`) : un chapitre masqué garde son sous-total et ses lignes sans prix ; le total TTC du devis est inchangé.

## 7. Part 4 — « Éditer l'article » depuis la ligne, droits `team_leader`

**Geste** : sur une ligne avec `catalog_item_id`, bouton crayon « Éditer l'article ». Il ouvre `ArticleDrawer` (fiche existante, inchangée dans son contenu) **par-dessus la modale du devis** (empilement z-index à régler ; le drawer vit dans `pages/settings/catalogue/`, l'importer depuis `components/devis/` est acceptable, le déplacer dans `components/catalogue/` est le choix propre si le builder le préfère). Ouvert en édition si l'utilisateur a le droit `articles.edit`, en lecture sinon (le bouton reste utile pour voir les specs).

**Réalignement à la fermeture** : si l'article a changé (`updated_at` plus récent qu'à l'ouverture), la ligne reprend `designation = name`, `unit`, `reference = code`, `caracteristiques` recalculées ; `unit_price_ht` reprend `selling_price_ht` **seulement si la ligne portait encore l'ancien prix de vente de l'article** (un prix ajusté à la main dans le devis n'est pas écrasé). Quantité, remise, TVA, description, `show_specs` conservées. Toast « Ligne mise à jour depuis l'article ». Les autres lignes du devis qui portent le même article suivent la même règle.

**Droits** (décision d'Eric : édition des articles au niveau team_leader). On passe par la **mécanique canonique** du registre plutôt qu'un `role = 'team_leader'` en dur :
- Nouvelle ressource `articles` dans `src/lib/permissionsRegistry.js` : label « Articles (base du devis) », tables `{ catalog_items: 'org' }`, actions `view` d([1,1,1]), `create` d([1,0,0]), `edit` d([1,0,0]) ; **pas de `delete`** (un article ne se supprime pas, il se désactive ou se fusionne). Régénérer les défauts (`node scripts/gen-app-role-permissions-sql.mjs` → migration versionnée). L'éditeur Settings → Droits d'accès l'expose automatiquement ; une org peut donner `edit` à Commercial.
- Policies `catalog_items` : UPDATE sous `majordhome.role_can(org_id, 'articles', 'edit')` et **INSERT sous `role_can(org_id, 'articles', 'create')`** — la création directe existe (`catalogItems.service.createItem` insère dans le miroir sous `catalog_items_insert_admin`, `20261027_1`) et reste telle quelle, on ne la bascule pas sur une RPC. Pattern ADD en OR → vérifier par impersonation → DROP `catalog_items_update_admin` / `catalog_items_insert_admin`. `permissions-coherence.mjs` exige les deux dès que la table est gouvernée.
- RPC : les gardes passent toutes par le helper unique `majordhome.catalog_item_require_admin(org)` (10 appels). On ajoute un helper jumeau `majordhome.catalog_item_require_edit(org)` (`auth.uid() IS NULL` refusé en première instruction, puis `IF role_can(org, 'articles', 'edit') IS NOT TRUE THEN RAISE`) et on y bascule `catalog_item_create_for_product` (avec `'create'`), `catalog_item_attach`, `catalog_item_detach`. Les autres gardent `require_admin`.
- Documents d'article (`product_documents` avec `catalog_item_id`) : INSERT / UPDATE / DELETE sous `role_can(org, 'articles', 'edit')` (remplace l'org_admin de `20261027_6`).
- **Restent org_admin** : harmonisation (`catalog_item_merge`, `catalog_item_proposals_decide`), `catalog_items_ensure` et `catalog_item_proposals_propose` (service_role). Le bouton « Harmoniser les bases » reste admin.
- Edge `catalog-item-enrich` : elle porte sa propre garde `requiredRole: "org_admin"` (`index.ts:174`) et `requireOrgMembership` ne sait exprimer qu'une hiérarchie de membership, pas `role_can`. On expose une RPC `public.user_can(p_org_id, p_resource, p_action)` (SECURITY INVOKER, enveloppe de `majordhome.role_can`, `REVOKE FROM PUBLIC, anon`), l'edge passe à `requiredRole: "member"` puis appelle `user_can(org, 'articles', 'edit')` avec le jeton de l'utilisateur avant toute action, `propose` (appel IA payant) compris. Redéploiement de l'edge dans le lot. Ce helper sert à toute edge future qui doit suivre la grille des droits (mon choix).
- Front : `useCanAccess().can('articles', 'edit')` remplace `isOrgAdmin` dans `ArticleDrawer`, `ArticlesPage`, le bouton « Créer l'article » (`DevisLineRow`, `DevisProductPicker`, `DevisCreateArticleForm`), `ArticleDocuments`, `ArticleAttachModal`, `ArticleEnrichModal`. Aucun `isOrgAdmin` résiduel sur un geste d'article hors harmonisation.
- **Import d'une offre fournisseur** (`ImportOffreDevisModal` et `ImportOffreCatalogueModal`, `peutEcrire = isOrgAdmin`, edge `supplier-offer-import`) : **ouvert au `team_leader`** (décision d'Eric, 2026-10-26), sous le même droit `articles.edit`. L'action `apply` de l'edge écrit par `supplier_catalog_upsert` au `service_role` (aucune policy `supplier_products` à toucher) ; sa garde `requiredRole: "org_admin"` est remplacée par `user_can(org, 'articles', 'edit')` au jeton de l'utilisateur, comme `catalog-item-enrich`. Côté écran, `peutEcrire = can('articles', 'edit') && !!fournisseur` et le message « réservée à l'administrateur » devient « réservée aux responsables » quand le droit manque. Redéploiement de l'edge dans le lot.
- Mesure : `node scripts/permissions-coherence.mjs --env .env.local` vert (défauts DB = registre, `catalog_items` gouvernée par `role_can`, plus de policy legacy), `verify-permissions-registry.mjs` dans `audit:quality`.

**Push Pennylane (bloc B)** : Pennylane ne sait pas masquer les prix d'un chapitre ; si le devis est poussé alors qu'un chapitre masque ses prix, le front avertit (toast info « Pennylane affichera les prix de tous les chapitres ») et pousse quand même. La description de ligne envoyée à Pennylane = `description` + caractéristiques (une par ligne), pour que les valeurs utiles aux primes figurent aussi sur le devis Pennylane. Mon choix, pas une demande d'Eric. **Risque** : la longueur acceptée par Pennylane pour `description` n'est pas connue et un 422 refuse le devis entier (`pennylaneQuotePayload.js`). Le builder vérifie sur un brouillon réel avec une ligne à dix caractéristiques ; si Pennylane refuse, la description seule part et les caractéristiques ne vont pas à Pennylane (signalé dans le toast du push).

**Empilement** : l'éditeur de lignes vit dans `CreateDevisModal.jsx` (`z-50`), pas dans `DevisModal.jsx` ; le drawer article doit surplomber cette modale (`z-[60]` comme le picker).

## 8. Contraintes transverses

- Toute migration : `supabase/migrations/`, répétée sur `scripts/migration-rehearsal/` — **le harnais ne photographie aujourd'hui ni les vues `majordhome_catalog_items*` ni les fonctions `catalog_item_*`** : étendre `snapshot.mjs` avant la première répétition. Fichier d'assertions dédié (`assert-devis-reference-caracteristiques.sql` : colonnes, index unique insensible à la casse, vues `_write` portant les nouvelles colonnes, `has_function_privilege('anon', …)` faux sur les RPC touchées, `role_can` effectif par impersonation).
- Multi-tenant : toutes les requêtes du front filtrent `org_id` ; nouvelles colonnes exposées en fin de vue ; aucune valeur Mayer en dur (libellé « Référence interne »).
- Modules purs testés avant tout composant : `devisCaracteristiques.js` (nouveau), `devisDocumentModel.js` (chapitre masqué, caractéristiques), `devisCalculs.js` inchangé. Tests dans `audit:quality`.
- `DevisStepLines.jsx` est à 445 lignes et `DevisModal.jsx` à 504 : la part 4 ne doit pas les faire grossir au-delà de 500 ; extraire le réalignement de ligne dans un module pur (`src/lib/devisLigneArticle.js` : `realignerLigne(ligne, articleAvant, articleApres)`) testé.
- Sortie de la **gotcha `upsertQuoteLines`** : `show_specs`, `caracteristiques`, `hide_prices` lus depuis l'état du front à chaque enregistrement ; `getQuoteLines` les relit ; `duplicateQuote` et les modèles de devis (`quote_templates.lines`) les recopient.
- Rien n'est avalé : conflit de code → message ; article sans caractéristique → compteur à 0 visible ; échec du réalignement → toast d'erreur, ligne inchangée.

## 9. Livraison

Ordre proposé, chaque étape poussée et vérifiée (build + tests + `audit:quality`) avant la suivante :
1. Part 3 (détail par chapitre) : une colonne, le modèle, le PDF, l'aperçu — la plus courte, visible tout de suite.
2. Part 2 (description + caractéristiques) : module pur, colonnes, éditeur, figeage, PDF.
3. Part 1 (référence interne) : colonne, index, vues, fiche, picker, pose de ligne.
4. Part 4 (éditer l'article + droits) : registre, migration des droits, policies, RPC, drawer par-dessus le devis, réalignement.

Critère de fin : sur un devis poêle + fumisterie d'exemple, le PDF montre la référence interne du poêle, ses caractéristiques (puissance, rendement, émissions, Eco Design), une description saisie, et le chapitre Fumisterie listé sans prix de ligne avec son sous-total ; un `team_leader` corrige le libellé d'un article depuis la ligne et la ligne suit.

## 10. Relecture « builder » (2026-10-26) — ce qui a été tranché

Un relecteur sans accès à la conversation a lu la spec contre le code. Corrections intégrées ci-dessus : devis envoyé modifiable (figeage à chaque enregistrement, § 2 et § 5) ; création d'article par INSERT direct (policy INSERT sous `role_can`, § 7) ; garde `org_admin` propre à l'edge `catalog-item-enrich` (RPC `user_can`, § 7) ; `ImportOffreDevisModal` oublié de la liste des gates (reste admin, § 7) ; extras non saisissables sans schéma (formulaire extras ouvert à toute catégorie, § 5) ; helper unique de garde des RPC (§ 7) ; modale réelle à surplomber (§ 7) ; harnais sans les objets catalogue (§ 8) ; longueur de description Pennylane (§ 7).

## 11. Tranché par Eric (2026-10-26)

- L'import d'une offre fournisseur (depuis le devis ou le catalogue) est ouvert au `team_leader`, sous `articles.edit` (§ 7). Spec validée, passage au plan.

## 12. Laissé au builder

- Forme exacte de la zone description dans la ligne (repli / dépli) et de la coche « Caractéristiques » (position dans la ligne, qui est déjà dense).
- Empilement du drawer article au-dessus de la modale de devis (portal, z-index, fermeture par Échap qui ne ferme que le drawer).
- Extension du hook de lecture des articles pour l'éditeur (`category`, `specs`, `code`, `updated_at`).
- Où vit `ArticleDrawer` après ce travail.
- Présentation de la référence interne dans la liste et le picker (préfixe, badge).
