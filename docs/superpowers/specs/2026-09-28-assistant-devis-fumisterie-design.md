# Assistant de devis fumisterie — design

**Date** : 2026-09-28 · **Statut** : validé par Eric (brainstorming du 2026-09-28) · **Pilote** : Mayer Énergie (Philippe).
**Sources** : `docs/devis-fumisterie/HANDOFF_devis_fumisterie.md`, `MAQUETTE_metre_svg.md`, `maquette_metre_ptr30.html`, `bibliotheque_configurations_modinox_v1.json`, `MAYER002.xlsx`.

## 1. Problème

Le devis de poêle avec fumisterie est le goulet d'étranglement commercial de Mayer. Philippe fait la visite, note sur son cahier, revient au bureau, choisit les éléments de mémoire, saisit le devis ligne à ligne, puis le retape dans Pennylane. Deux retranscriptions manuelles, et le choix des pièces repose sur une seule personne.

## 2. Cible

Philippe fait le devis **sur place, sur la tablette, pendant la visite**. L'écran remplace le cahier : il pose les questions de métré propres au projet, dessine la coupe cotée, contrôle la réglementation et chiffre les pièces en direct. En sortant de chez le client, un brouillon de devis complet existe dans Majord'home. Au bureau, Philippe relit, ajuste (marge visible), et envoie : le devis part dans Pennylane et se rattache au lead, sans ressaisie.

Décisions prises avec Eric :

- **V1 en formulaires guidés, Hermes en appui ; le langage naturel viendra ensuite.** Le cœur (configurations, règles, métré, chiffrage) est déterministe ; Hermes réutilisera ces mêmes outils.
- **Le devis se construit dans MDH et finit dans Pennylane.** Le pipeline (kanban, Gagné/Perdu, chantiers, facturation) continue de se lire sur les devis Pennylane : on ne casse rien.
- **Catalogue MODINOX / ALTEMA d'abord**, DINAK branché ensuite par une table de correspondance (les configurations parlent de composants génériques, jamais d'un fournisseur).
- **Le devis est complet** (appareil, fumisterie, sécurité, main d'œuvre) mais l'intelligence est sur la fumisterie ; le reste est un appel de catalogue.
- **Prix de vente = tarif public fournisseur. Prix d'achat = prix net Mayer** (« Prix pour client » du tarif, remises incluses, jamais recalculé). La marge est affichée par ligne et au total ; Philippe ajuste ensuite.
- **Tout couvrir (19 configurations) en partant de la maquette et ajuster à l'usage.** Les règles de quantité sont taguées *provisoire* et éditables sans code.
- **Réseau garanti** (clé 5G) : le brouillon local ne sert qu'à ne pas perdre la saisie en cours.

## 3. Ce que le repo a déjà (et qu'on réutilise)

- **Devis natif** (`src/apps/artisan/components/devis/`, `devis.service.js`, `useDevis.js`) : assistant `CreateDevisModal` en 3 étapes (client → lignes → récapitulatif), familles avec sections prédéfinies (`Poêle à Bois` → POÊLE / FUMISTERIE / ÉLÉMENTS SÉCURITÉ / MAIN D'ŒUVRE), `DevisProductPicker` sur le catalogue, devis types, `DevisPDF` (bucket `quotes` créé le 2026-08-27), calcul des totaux/TVA/remise. Abandonné de fait entre le 20/04 et le 01/05/2026 au profit des devis Pennylane, jamais retiré.
- **Catalogue** (`suppliers.service.js`, `useSuppliers.js`, Settings → Fournisseurs & catalogue) : `majordhome.supplier_products` (12 422 articles DINAK avec `gamme`, `diametre`, `tarif_public`, `taux_remise`, `purchase_price_ht`, `selling_price_ht`, `unit`, `specs` JSONB, `ledger_account_pl_id`), import Excel en masse.
- **Envoi vers Pennylane** : `pennylaneService.pushQuote(quote, lines, client, orgId)` (2026-04-15) construit un devis PL en lignes libres avec sections et `ledger_account_id`, et pose le mapping `pennylane_sync` `entity_type='quote'`. **Jamais appelé par un écran, jamais exercé en prod** : à vérifier avant de s'y appuyer.
- **Rattachement au lead** : RPC `lead_attach_quotes_and_send(p_org_id, p_lead_id, p_quotes)` via `pennylaneService.attachQuotesAndSendLead`.
- **Moteur pur partagé front + Deno** : montage du moteur de Tournées (`src/lib/tournee/*` copié par `scripts/sync-tournee-engine.mjs` vers `supabase/functions/_shared/`, test de synchro dans `audit:quality`).
- **Résultats figés** : pattern des études thermiques (`thermal_studies.results` + `engine_version`, bannière si la version diffère).
- **Config d'org** : `useOrgSettings()`, objet complet par clé (`settings.pv`, `settings.tournees`), tuile dans le registre `src/lib/modules.js`.

## 4. Architecture

Quatre blocs, découplés :

1. **Données** (Supabase, schéma `majordhome`) : articles + attributs fumisterie, configurations types, gabarits, règles, correspondances composant → article, métrés enregistrés.
2. **Moteur** (`src/lib/fumisterie/`, JavaScript pur, testé) : relevé + données → lignes chiffrées + alertes + géométrie. Aucune valeur en dur.
3. **Écran** (tablette, dans le flux devis existant) : qualification → relevé sur coupe cotée SVG → injection des lignes dans le devis.
4. **Sortie** : devis MDH complet → `pushQuote` → rattachement au lead. Plus tard : edge `fum-metre` pour Hermes, coupe dans le PDF.

### 4.1 Ce qui change par rapport au handoff

| Handoff | Décision | Pourquoi |
|---|---|---|
| `fum_articles` | Import dans `supplier_products` + table annexe `fum_article_attrs` | Un seul catalogue, le devis natif et le picker existent déjà dessus |
| `fum_parametres_defaut` | `settings.fumisterie` via `useOrgSettings()` + onglet Settings | Règle du projet : toute config d'org est éditable dans Settings, jamais en table ad hoc |
| Calcul en SQL / n8n | Moteur JS pur, copié pour Deno | Recalcul instantané à chaque cote ; un seul code écran + Hermes ; n8n abandonné pour les flux métier (décision 2026-08-10) |
| `fum_config_criteres` (table) | Critères en colonnes tableaux sur `fum_configurations` | Filtrage déterministe `@>` / `&&` sans jointures, vocabulaire contrôlé par CHECK |

### 4.2 Données

Toutes les tables : `org_id NOT NULL` FK `core.organizations`, RLS activée dès la création (SELECT membre, écritures `org_admin`), vue publique `majordhome_fum_*` en `security_invoker=true`, `GRANT SELECT … TO service_role`. Migrations versionnées dans `supabase/migrations/`, répétées sur `scripts/migration-rehearsal/` (étendre `snapshot.mjs`).

| Table | Rôle et colonnes clés |
|---|---|
| `fum_article_attrs` | 1-1 avec `supplier_products` (`supplier_product_id` PK). `type_piece` (élément droit, coude, chapeau, solin, collier, plaque…), `gamme_tarif` (nettoyée, sans espace parasite), `diametre_int`, `diametre_ext`, `longueur_mm`, `pente_min`, `pente_max`, `couleur` (inox / noir / blanc / RAL), `version`, `angle` (coudes), `sur_mesure` (bool : jamais chiffré automatiquement, signalé), `hors_perimetre` (bool : gaz, fioul, charbon, famille 22), `famille_n1..n4`, `parse_confidence` (0-1), `parse_notes` |
| `fum_gabarits` | `code` (G1…G6), `libelle`, `description`, `troncons` JSONB : liste ordonnée `{ type, parametres: [{ cle, libelle, unite, min, max, defaut, optionnel }] }` |
| `fum_configurations` | `code` (CFG-24-…), `titre`, `page_catalogue`, `index_image`, `statut` (catalogue / deduit / propose / a_completer), `gabarit_id`, `gamme_principale`, `principe`, `remarques`, `source_version` (`modinox_2026`). Critères : `projets text[]`, `appareils text[]`, `combustibles text[]`, `zones text[]` (vide = sans objet), `prise_air text[]`, `appareil_etanche_requis bool`, `conduit_existant text`, `condition_bloquante text`. CHECK sur le vocabulaire |
| `fum_config_composants` | `configuration_id`, `ordre`, `composant_code` (clé normalisée, ex. `chapeau_anti_refouleur`), `libelle` (texte catalogue), `chapitre`, `gammes text[]`, `troncon` (type de tronçon du gabarit), `repere` (numéro sur le schéma), `statut` (catalogue / implicite / provisoire), `groupe_alternative` + `option` (les « ou » : une seule option retenue), `regle_quantite` (code de règle du moteur, ex. `par_longueur_troncon`, `par_plancher`, `unitaire`), `note` |
| `fum_regles` | `code` (R-MFI-01…), `gamme`, `page`, `statut`, `texte`, `reference`, `consequence_devis`, `bloquante bool` |
| `fum_config_regles` | liaison configuration ↔ règle |
| `fum_appareils_valides` | `gamme` (MFI, PLA…), `marque`, `modele`, `configuration_id` nullable, `source`. Chaudières préconisées (CFG-48), fiches appareil MFI (R-MFI-01) |
| `fum_guide_choix` | `ligne` (bois poêle/chaudière, bois foyer/insert, granulés), `colonne` (type d'évacuation), `gammes text[]`, `page`. 27 lignes |
| `fum_composant_mapping` | `composant_code` × `gamme_catalogue` × `finition` (nullable) → `supplier_id`, `gamme_tarif`, `type_piece`, `quantite_par_unite` (un kit reconstitué = N lignes), `motif_code` (regex de secours sur la référence, ex. `^2PTIELDR{D}{LG}(NO)?$`), `priorite`, `statut`. Un second fournisseur = les mêmes lignes avec un autre `supplier_id` |
| `fum_metres` | `quote_id` FK, `lead_id`, `configuration_id`, `gabarit_id`, `diametre`, `finition`, `releve` JSONB, `resultat` JSONB (`lignes`, `alertes`, `geometrie`), `engine_version`, `created_by`. **Figé** : un devis rouvert relit `resultat`, bannière si `engine_version` diffère, recalcul = geste explicite |

Import du tarif : `scripts/fumisterie/import-tarif-modinox.mjs` (exceljs) lit `MAYER002.xlsx`, parse désignation + référence, exclut le hors périmètre, et produit un SQL d'upsert **rejouable** (`supplier_products` sous le fournisseur « MODINOX / ALTEMA » + `fum_article_attrs`). Il écrit un **rapport** : lignes non parsées, sur-mesure, et **couverture** = pour chaque configuration × Ø 80/100/130/150/180, composants résolus / manquants. La séquence des configurations est chargée depuis le JSON par un second script (`seed-configurations.mjs`), idempotent sur `code`.

### 4.3 Réglages d'org : `settings.fumisterie`

Objet complet sauvé via `useOrgSettings().save({ fumisterie })` (merge JSONB niveau 1), défauts mergés par `buildFumisterieConfig(settings)` :

- `fournisseur_id` (fournisseur de fumisterie actif), `finition_defaut` (noir / inox), `epaisseur_prh` (6/10, 8/10), `emaille` (ligne_plus / pellet / acier_peint), `polyperf_kit` (bool)
- `longueurs_elements_mm` ([1000, 500, 250]), `reglable` ({ min: 320, max: 500 }), `colliers_par_emboitement`, `supports_tous_les_m`, `marge_combles_m` (0,10), `haubanage_m` (3)
- `zone1` ({ pente_m: 0.40, plat_m: 1.20, pente_plat_deg: 15 })
- `tva_fournitures`, `tva_pose`

Onglet **Settings → Entretiens & Contrats → Fumisterie** (`entretiens/FumisterieTab.jsx`, tuile déclarée dans `src/lib/modules.js`, icône ajoutée à `ICONS`). C'est là que Philippe corrige les règles provisoires sans passer par le code.

### 4.4 Moteur `src/lib/fumisterie/`

Modules purs (aucun import React / Supabase / alias, JSDoc sur chaque export pour Deno), testés par `node --test "scripts/fumisterie/*.test.mjs"` (ajouté à `audit:quality`) :

- `gabarits/g1.js`, `g3.js`, `g4.js`, `g5.js`, `g6.js` : `geometrie(releve, config) → cotes dérivées` (niveaux, faîtage, minimum de zone, dévoiement, longueurs par tronçon). G1 est porté depuis `compute()` de la maquette, sans changement de règle.
- `compose.js` : longueur → combinaison 1000/500/250/réglable + surlongueur (porté de `compose()`).
- `controles.js` : zone 1, toit plat, dévoiement, haubanage, solin, buse, surlongueurs → `alertes[] { niveau: ok|info|warn, code, message, source }`.
- `nomenclature.js` : configuration + composants + mapping + attributs d'articles + relevé + réglages → `lignes[] { repere, composant_code, libelle, supplier_product_id, reference, quantite, prix_vente_ht, prix_achat_ht, tva, statut, troncon, sous_libelle }`. Une ligne dont l'article est introuvable ou sur-mesure sort avec `reference: null` et une alerte `article_manquant` : rien n'est avalé.
- `index.js` : `calculerMetre({ gabarit, configuration, composants, mapping, articles, reglages, releve }) → { geometrie, lignes, alertes, totaux }`, `ENGINE_VERSION`. Point d'entrée unique écran ↔ edge ↔ PDF.
- `chargement.js` (côté service, pas pur) : charge en une fois les données d'une configuration (composants, mapping, articles candidats) pour éviter N requêtes par cote.

Rendu : `src/apps/artisan/components/devis/metre/CoupeCotee.jsx` lit `geometrie` et dessine la coupe SVG (porté de `draw()`), cotes cliquables → focus du champ. Le SVG ne calcule rien.

### 4.5 Écran

Dans `CreateDevisModal`, étape Lignes, section FUMISTERIE : bouton **« Métré assisté »** → `MetreFumisterie` plein écran (tablette 1024 px forcée par `deviceViewport`) :

1. **Qualification** : projet, appareil, combustible, zone, prise d'air, conduit existant, appareil étanche. Filtrage déterministe → configurations compatibles (titre, image catalogue en référence visuelle, règles associées). Règle bloquante (MFI sans fiche appareil, chaudière hors liste) → configuration proposée mais verrouillée avec le motif. Zones 2/3 → bandeau « validation technicien obligatoire » tant que les conditions p.80-89 ne sont pas intégrées.
2. **Relevé** : formulaire du gabarit (tronçons du `troncons` JSONB) + `CoupeCotee` + contrôles + liste de pièces chiffrée avec marge. Choix par défaut préremplis depuis `settings.fumisterie`, modifiables. Bouton « Ajuster la sortie au minimum » comme dans la maquette. Brouillon `localStorage fum-metre-draft:${userId}` pour la saisie en cours.
3. **Valider** : `fum_metres` enregistré (relevé + résultat + version), lignes injectées dans la section FUMISTERIE (article, quantité, PU vente, `purchase_price_ht`, TVA, `sort_order`), repère et statut conservés en `description`. Lignes `article_manquant` injectées à 0 € avec mention « à chiffrer » : visibles, jamais perdues.

Le reste du devis reste l'existant : appareil et sécurité via `DevisProductPicker`, main d'œuvre = articles `line_type='labor'` du fournisseur interne « Mayer Énergie – prestations » (forfaits paramétrés dans le catalogue, préremplis via devis type). Marge : `DevisStepSummary` affiche Σ vente − Σ achat.

Palette de l'écran : jaune / bleu du projet (`primary-*` / `secondary-*`), jamais rouge/vert seuls, toujours couleur + icône + libellé.

### 4.6 Sortie Pennylane

`DevisModal` : bouton **« Envoyer dans Pennylane »** (org avec `settings.pennylane.enabled`) → `pushQuote` (vérifié et corrigé si besoin : API, sections, `ledger_account_id` depuis le plan comptable de gestion, unités, TVA) → `attachQuotesAndSendLead(orgId, leadId, [{ quote_pl_id, amount_ht, label, date, status }])` → le devis apparaît sur la carte du pipeline et le lead passe en « Devis envoyé ». Le devis MDH passe en `envoye` avec `pennylane_quote_id` renseigné. Idempotent : `pennylane_sync` type `quote` relu avant tout POST (un second clic met à jour, ne recrée pas). L'envoi au client reste un geste Pennylane.

### 4.7 Hermes (tranche dédiée)

`scripts/sync-fumisterie-engine.mjs` (ou extension du script de tournées) copie `src/lib/fumisterie/` vers `supabase/functions/_shared/fumisterie/` ; edge `fum-metre` (`verify_jwt:true`, `requireOrgMembership`) expose `configurations_compatibles(criteres)` et `calculer_metre(configuration, releve)`. Serveur MCP Majord'home (spec planification 2026-09-12) consommé par Hermes, d'abord en appui (questions ouvertes, justification par RAG réglementaire), puis en langage naturel.

## 5. Erreurs et garde-fous

- **Rien n'est avalé** : article introuvable, sur-mesure, solin hors plage, règle bloquante → ligne visible + alerte. Le total affiche « dont N lignes à chiffrer ».
- **Résultat figé** : un devis envoyé relit `fum_metres.resultat`, jamais un recalcul sur la grille courante (même règle que les contrats signés et les études thermiques).
- **Import** : le script échoue bruyamment sur une colonne manquante ou un prix vide ; les lignes non parsées sont listées, pas ignorées. Un article disparu du nouveau tarif passe `is_active=false`, jamais supprimé.
- **Pennylane** : `pushQuote` lit `{ error }` de chaque étape ; échec → toast + devis reste brouillon, rien n'est marqué envoyé.
- **Multi-tenant** : filtre `org_id` explicite sur chaque requête, RPC éventuelles `REVOKE FROM PUBLIC, anon`.

## 6. Tests

- Moteur : `scripts/fumisterie/compose.test.mjs`, `controles.test.mjs`, `g1.test.mjs` (cas de la maquette : Ø150, valeurs d'exemple → 14 lignes, ≈ 1 480 € HT, zone 1 respectée ; buse au plafond → alerte ; dévoiement trop grand → alerte ; pente 12° → toit plat), `nomenclature.test.mjs` (article manquant → alerte, kit → N lignes, alternative → une seule option).
- Import : `import-tarif.test.mjs` sur un extrait du tarif (désignations pièges : `PRH 6/10 ` avec espace, `RAL : XXXX`, unité ML, famille 22).
- Écran : `npx vite build` + lint ; vérification manuelle par Eric/Philippe sur un devis réel (critère de succès de la tranche 1).

## 7. Tranches

1. **G1 de bout en bout (CFG-24)** : migrations + import tarif + seed configurations + moteur G1 + `CoupeCotee` + `MetreFumisterie` + injection + Settings Fumisterie + `pushQuote` vérifié + rattachement au lead. **Preuve** : un devis réel de Philippe part dans Pennylane sans ressaisie et apparaît sur la carte du lead.
2. **G4 tubage** (CFG-26, 27, 30, 31, 34, 35, 37, 39) puis **G5 raccordement** (CFG-42, 43, 45).
3. **G3 façade** (CFG-25, 33), **G6 ventouse** (CFG-29), variantes MFI (CFG-40) et chaudière (CFG-48).
4. **Hermes** : sync moteur, edge `fum-metre`, outil MCP.
5. Coupe cotée dans `DevisPDF`, DINAK en second fournisseur, conditions zones 2/3 (p.80-89).

## 8. Hors périmètre

Gaz, fioul, charbon. RAG réglementaire (DTU 24.1) — tranche Hermes. Envoi e-mail du devis depuis MDH (geste Pennylane). Modification du pipeline Pennylane-driven.
