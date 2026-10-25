# Devis par chapitres, articles de stock, base d'articles fiabilisée, enrichissement IA — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Un devis se monte par chapitres typés (équipement, option, stock, main d'œuvre) avec la TVA de la famille ;
le matériel stocké est un article Mayer « par type » dont la marque se choisit dans le devis ; l'article porte ses
métadonnées (photo, fiches, caractéristiques) et peut être enrichi par l'IA depuis le web.

**Architecture:** prolonge les articles Majord'home (spec `2026-10-24-articles-majordhome-matrice-fournisseurs-design.md`,
§ 9 en vigueur). Familles de devis : `chapitres: [{ titre, type }]` (module pur `devisConfig.js`). Le picker de devis
reçoit le type du chapitre. Natures d'article (`catalog_items.product_kind`) : `main` (équipement), `accessory`
(option), `consumable`, `stock`, `main_oeuvre`. Documents d'article : `product_documents.catalog_item_id`.
Enrichissement : edge `catalog-item-enrich` (Claude + recherche web), proposition validée par l'admin.

**Spec (décisions d'Eric, conversation du 2026-10-24/25 — tient lieu de spec) :**
1. « pas d'usine à gaz » ; le devis ne choisit pas de fournisseur ; marge = prix d'achat le plus bas (spec articles § 9).
2. Chapitres type : **Équipement** (catégorie de la famille), **Option** (catégorie de la famille ; « on a le type option
   ou accessoire dans le produit fournisseur »), **Sécurité et accessoire** (matériel stocké, toutes familles),
   **Pose et mise en service** (articles internes de main d'œuvre).
3. Les articles doivent pouvoir être créés depuis le devis.
4. Matériel stocké : « ce sont des articles que j'ai déjà achetés, je vais les reprendre depuis la liste » ; « les
   disjoncteurs, j'aurai 4 marques, je vais les regrouper par type et on changera la marque dans le devis ».
5. « La TVA par défaut ne doit pas être portée par l'article, mais par la famille du devis » ; « on peut la changer dans
   le devis si besoin ».
6. « Rattacher une ligne fournisseur » doit **proposer** les correspondances.
7. À la fusion, photo et fiche technique sont des métadonnées de l'article, pas du fournisseur : on les regroupe.
8. L'enrichissement IA web se fait sur l'article (photos, fiches…).
9. Ordre validé : devis par chapitres (A), base d'articles (B), enrichissement IA (C).

## Global Constraints
- Charte multi-tenant `CLAUDE.md` (org_id, RLS, `security_invoker`, colonnes de vue en fin, REVOKE PUBLIC/anon,
  gardes positives, `{ error }` lu, `unwrapResult`, cache keys orgId en premier, `logger`).
- Édition / création d'article = **org_admin seul** (spec articles § 8). Un non-admin pose une ligne libre.
- Modules purs testés `node --test`, ajoutés à `audit:quality`. Migrations répétées sur le harnais (chaîne
  `20261025_2 → … → 20261026_3 → nouvelles`).
- Commits par chemins explicites ; pas de composant > 500 lignes.

## Review Focus
1. Un devis existant rouvert garde ses lignes, sa TVA ligne par ligne et ses titres de chapitre (aucune réécriture).
2. Une famille enregistrée avant ce chantier (`sections` texte) se lit avec des types déduits, sans perte.
3. Un article créé à la main sans offre fournisseur reste proposable au devis (main d'œuvre, stock vide).
4. Changer la marque d'une ligne de stock ne duplique pas la marque dans le libellé.
5. Un non-admin ne peut ni créer ni modifier un article (UI + base).

---

## Tranche A — devis par chapitres

### Task 1 : chapitres typés et TVA de famille (pur)
- Modify `src/lib/devisConfig.js`, test `scripts/devis-config.test.mjs`.
- Produces : `TYPES_CHAPITRE = ['equipement','option','stock','main_oeuvre','libre','fumisterie']`,
  `typeChapitreDeduit(titre)`, famille normalisée `{ …, tva: number, chapitres: [{ titre, type }], sections: string[] }`,
  `typeChapitre(config, famille, titre)`, `tvaFamille(config, famille)`, `TAUX_TVA = [20, 10, 5.5, 0]`.
- Défauts : chapitres d'Eric pour les familles d'équipement (`ÉQUIPEMENT` / `OPTIONS` / `SÉCURITÉ ET ACCESSOIRES` /
  `POSE ET MISE EN SERVICE`), poêles avec `FUMISTERIE`, Photovoltaïque garde ses titres (typés) ; TVA 5,5 % poêles et
  PAC, 10 % sinon (à vérifier par Eric).
- Tests : déduction (« SÉCURITÉ ET ACCESSOIRES » ⇒ stock avant option, « MAIN D'ŒUVRE » / « POSE » ⇒ main_oeuvre,
  « FUMISTERIE », « PRESTATIONS » ⇒ libre, défaut ⇒ equipement) ; famille legacy `sections` ⇒ chapitres déduits ;
  `chapitres` prime ; TVA invalide ⇒ défaut ; validation (type inconnu, TVA hors liste).

### Task 2 : migration `20261027_1_articles_natures_devis`
- `catalog_items.product_kind` CHECK (main, accessory, consumable, stock, main_oeuvre) ; INSERT org_admin (policy +
  GRANT, vue miroir insérable) ; `quote_lines.brand` (+ vues en fin) ; vue offres + `brand` ; vue `_list` +
  `recherche` (libellé, marque, gamme, clé, EAN, références des lignes, minuscules sans accents) en fin.
- Assert `assert-articles-natures-devis.sql`.

### Task 3 : marque d'une ligne de stock (pur) — `src/lib/catalogue/marqueLigne.js`
- `marquesDesOffres(offres)` → `[{ marque, prix }]` triées, prix = le plus bas de la marque ;
  `appliquerMarque(ligne, marque, offres)` → `{ …ligne, brand, purchase_price_ht, designation }` (suffixe « – Marque »
  remplacé, jamais doublé ; marque vide ⇒ retour au générique).

### Task 4 : devis — picker par type, création d'article, TVA du devis, marque
- `DevisStepLines` : type du chapitre, TVA du devis (défaut famille, appliquée à toutes les lignes au changement),
  ligne libre dans tout chapitre, sélecteur de marque sur une ligne dont l'article a ≥ 2 marques.
- `DevisProductPicker` : filtre de nature selon le type (« Équipements / Options / Stock / Main d'œuvre / Tout ») ;
  catégories de la famille pour équipement / option, aucune pour stock et main d'œuvre ; « Créer un article »
  (org_admin) ; articles sans offre proposables (`offres_total = 0`).

### Task 5 : Réglages et page Articles
- `FamillesEditor` : type par chapitre, TVA de la famille. `DevisSettings` sérialise `chapitres` (+ `sections`).
- Page Articles : « Nouvel article » (nature, libellé, unité, prix de vente, catégorie) et « Article de stock depuis
  mes achats » (recherche + coches de lignes fournisseur ⇒ article `stock` + rattachements). La fiche ne montre plus
  la TVA.

## Tranche B — base d'articles fiabilisée

### Task 6 : migration `20261027_2_articles_metadonnees`
- `product_documents.catalog_item_id` (supplier_product_id nullable, CHECK l'un des deux) + vues en fin ;
  `catalog_item_attach` / `merge_impl` recopient photo et caractéristiques manquantes ; clés modèle des lignes
  ECOSTAL depuis leur référence ; `catalog_item_proposals_propose` propose (jamais d'office) deux clés de même marque
  qui ne diffèrent que d'un suffixe de 1–2 lettres.

### Task 7 : suggestions, documents d'article, recherche, IA ciblée
- Pur `src/lib/catalogue/suggestions.js` (`scorerCandidat`, `suggestions`) + test ; modale « Rattacher » : suggestions
  classées avec la raison. Fiche article : une seule liste de documents (article + lignes, sans doublon), ajout sur
  l'article. Recherche par mots séparés, sans accents, sur `recherche`. `catalog-normalize` écarte la fumisterie.

## Tranche C — enrichissement IA web

### Task 8 : edge `catalog-item-enrich` + bouton « Enrichir » de la fiche article
- `verify_jwt:true`, `requireOrgMembership(org_admin)`, Claude + outil de recherche web : propose photo, fiche
  technique (URL), caractéristiques de la catégorie, page source ; action `apply` : télécharge la fiche (PDF vérifié)
  dans `product-documents/${org}/articles/${item}/`, pose la photo et fusionne les caractéristiques acceptées.

### Task 9 : livraison (migrations prod, edges, push, Vercel READY, relecture finale, mémoire, proposition CLAUDE.md)
