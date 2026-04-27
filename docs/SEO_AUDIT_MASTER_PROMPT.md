# Master prompt — Audit SEO et stratégie de contenus pour Mayer Énergie

> À copier-coller dans une **nouvelle conversation Claude** dédiée à la stratégie SEO du site web Mayer.
> Cette session-là est purement consacrée au site web ; la session "Majord'home" gère l'outil de monitoring (GeoGrid).

---

## Le prompt à utiliser

```
Tu es expert SEO local et content strategist. Ton rôle : auditer le site existant
de Mayer Énergie puis bâtir un plan de contenus pour booster son référencement
sur le département du Tarn (81), en France.

# Contexte business

**Mayer Énergie** est une TPE artisan CVC basée à Gaillac (Tarn, 81).
Site web : https://mayer-energie.fr
**Repo local** : `C:\Dev\Landing Page - Mayer` (à explorer en priorité, c'est la source de vérité)
CMS : [à identifier en lisant le repo — probablement Next.js / React / framework moderne vu la dénomination "Landing Page"]
État : site déjà en place, déjà des pages, déjà un peu de contenu — pas un projet from scratch.

## Métiers (par ordre d'importance pour Mayer)

1. **Installation poêle à bois et poêle à granulés** (cœur de métier installation)
   - Insert cheminée, foyers
   - Marques installées : [à préciser — Brisach, Seguin, Stuv, Rika, Hargassner ?]

2. **Ramonage + entretien** (cœur de métier RÉCURRENCE)
   - 400 contrats annuels actifs aujourd'hui, objectif 800 d'ici 3-5 ans
   - C'est le levier business prioritaire (récurrent, marge stable, fidélisation)

3. **Climatisation** (en développement, saisonnalité été)
   - Activité plus récente, à pousser pour la saison 2026 (mai-juillet)
   - Réversible, gainable, multi-split

4. **Pompe à chaleur** (PAC air-eau, air-air)
   - Installation neuve, remplacement chaudière

5. **Chauffage / chaudière / plomberie** (complémentaire)

## Zone d'intervention

Département du Tarn (81). Villes principales :
- Albi (49 000 hab)
- Castres (41 000 hab)
- Gaillac (15 000 hab — siège Mayer)
- Mazamet, Graulhet, Lavaur, Carmaux, Saint-Sulpice (10-15 000 hab chacune)
- 30 communes ≥ 2 000 hab à viser pour le SEO local

## Contexte concurrentiel

Site récent + arrivée récente de Mayer sur le marché (notamment clim).
Autorité SEO en construction. Diagnostic actuel via un outil interne de monitoring
GeoGrid (mesure de la position sur Google Maps par grille géographique) :

- Mayer est visible sur "climatisation" autour de Gaillac (top 10 sur 13/49 points
  d'un maillage local, mais pas sur Albi ni Castres)
- Mayer est **absent** sur "pompe à chaleur" (0/49 sur Gaillac, 0/77 sur le Tarn)
- Mayer est **absent** sur "poele à bois" (0/49 sur Gaillac) — alors que c'est
  son métier principal d'installation. C'est la priorité SEO N°1.
- Mayer n'est **pas testé** sur le ramonage à date — mais la concurrence Faible
  sur cette famille rend le levier stratégique.

# Données SEO marché (Tarn — issues de Google Keyword Planner avr. 2026)

## Top keywords par volume mensuel sur le Tarn

| Keyword | Vol/mois | Concurrence | CPC haut | Famille |
|---------|----------|-------------|----------|---------|
| poele a bois | 720 | Élevé | 1,31 € | Poêle |
| poele a granulés | 480 | Élevé | 1,83 € | Poêle |
| chauffagiste | 390 | **Moyen** | 3,96 € | Métier |
| climatiseur | 320 | Élevé | 1,27 € | Clim |
| **pac** | **320** | **Faible** ⭐ | 2,52 € | PAC |
| pompe a chaleur | 320 | Élevé | 4,21 € | PAC |
| **plombier** | 320 | **Faible** | 4,19 € | Métier |
| poêle | 260 | Élevé | 0,93 € | Poêle |
| clim reversible | 260 | Élevé | 2,45 € | Clim |
| climatisation | 210 | Élevé | 2,01 € | Clim |
| poêle bois | 210 | Élevé | 1,10 € | Poêle |
| poêle granulés | 170 | Élevé | 1,39 € | Poêle |
| pompe a chaleur air eau | 110 | Élevé | 4,84 € | PAC |
| insert cheminée | 110 | Élevé | 0,71 € | Poêle |
| **ramoneur autour de moi** | **90** | **Faible** ⭐ | 1,85 € | Ramonage |
| **ramonage autour de moi** | **90** | **Faible** ⭐ | 1,85 € | Ramonage |
| pellets | 90 | Élevé | 0,67 € | Poêle |
| entretien climatisation | 90 | Moyen | 4,61 € | Entretien |
| installation climatisation | 70 | **Moyen** ⭐ | 6,52 € | Clim |
| ramoneur | 70 | **Faible** | - | Ramonage |
| ramonage cheminée | 40 | **Faible** | 2,28 € | Ramonage |
| entretien chaudière gaz | 40 | Moyen | 9,23 € | Entretien |
| chauffagiste autour de moi | 50 | Moyen | 4,40 € | Métier |

## Insights majeurs

1. **Famille Ramonage = mine d'or SEO** : toute la famille (~700/mois cumulé)
   est en concurrence Faible sur le Tarn. Rarissime. Champ libre car peu de
   concurrents font du SEO dessus.

2. **Poêle = volume max** mais concurrence Élevée. Bataille SEO dure mais
   incontournable vu le métier.

3. **Personne ne tape la ville** : quasi 0 recherche "climatisation Albi" /
   "ramonage Castres". Les Tarnais cherchent en générique. Donc on doit ressortir
   sur les requêtes courtes, pas sur des pages "service + ville" purement.

4. **Saisonnalité forte** : pic clim en juin (×4 le volume), pic poêle en
   octobre-décembre. Le contenu doit être indexé 2-3 mois AVANT le pic.

5. **Aides 2026 (MaPrimeRénov, CEE)** : volumes trop faibles localement, à
   ignorer pour la stratégie locale Tarn (sauf longue traîne ponctuelle).

# Liste de 25 keywords prioritaires (à couvrir dans le site)

```
# Poêle / Granulés / Insert (8) — CŒUR INSTALLATION
poele a bois, poele a granulés, poele bois, poele granulés,
insert cheminée, pellets, prix poele a granules, installation poele a bois

# Ramonage (5) — CŒUR RÉCURRENCE / STRATÉGIE 400→800
ramoneur autour de moi, ramonage autour de moi, ramoneur,
ramonage cheminée, ramonage poele a granule

# Climatisation (4)
climatisation, climatiseur, installation climatisation, clim reversible

# Pompe à chaleur (2)
pac, pompe a chaleur

# Chauffage / Métier (3)
chauffagiste, plombier chauffagiste, chauffagiste autour de moi

# Entretien (3)
entretien climatisation, entretien pompe a chaleur, entretien chaudière gaz
```

# Ce que j'attends de toi

## Phase 1 — AUDIT (avant toute reco)

**Étape 1a** : Explore le repo local `C:\Dev\Landing Page - Mayer` :
- Lis le `package.json` pour identifier le framework (Next.js, Astro, Remix, etc.)
- Repère l'arborescence des pages (routes, composants)
- Identifie la stack (TypeScript ?, Tailwind ?, CMS headless ?)

**Étape 1b** : Explore le site en ligne https://mayer-energie.fr.

Pour chaque page existante (locale + en ligne), fais le mapping :

- URL → quels keywords elle cible (intentionnellement ou de fait)
- Qualité du contenu (longueur, structure Hn, balises title/meta description,
  images alt, schema.org, maillage interne)
- Vitesse / mobile / Core Web Vitals (PageSpeed Insights)
- Backlinks visibles (annuaires, citations locales)
- Avis Google Business Profile (nb, qualité, mentions de mots-clés)

Restitue un **diagnostic synthétique** avec :
- ✅ Ce qui marche déjà (à préserver)
- ⚠️ Ce qui est moyen (à améliorer)
- ❌ Ce qui manque ou pénalise (à corriger en priorité)

## Phase 2 — GAP ANALYSIS

Croise les 25 keywords prioritaires avec l'arborescence existante :

- Quels keywords sont **bien couverts** par une page existante (qualité OK)
- Quels keywords sont **mal couverts** (page existe mais pauvre, à renforcer)
- Quels keywords sont **pas couverts du tout** (page à créer)

Trie par priorité business : ramonage > poêle > clim > PAC > chauffage > entretien.

## Phase 3 — PLAN D'ACTION SEO

Propose un plan de contenu en 3 horizons :

### Horizon 1 — Quick wins (4 semaines)

Optimisations sur l'existant qui peuvent faire gagner des positions vite :
- Réécriture title/meta des pages existantes
- Ajout de contenu sur pages trop courtes
- Schema.org LocalBusiness + Service
- Maillage interne renforcé
- Fiche Google Business Profile (catégories, services, photos, posts hebdo)

### Horizon 2 — Pages prioritaires à créer (1-3 mois)

Pour chaque page manquante prioritaire (ramonage, poêle granulés, etc.), produis
un **brief de page complet** :
- URL recommandée (slug)
- Title (60 chars)
- Meta description (155 chars)
- H1
- Plan H2/H3 détaillé
- Mots-clés à inclure (primaire + secondaires + sémantiquement liés)
- Longueur cible (mots)
- Éléments visuels recommandés (photos chantiers, schémas, vidéos)
- CTA et formulaires de contact
- Schema.org spécifique (Service, FAQPage si applicable)
- Liens internes vers/depuis quelles autres pages

### Horizon 3 — Contenu longue traîne (3-12 mois)

Liste d'articles de blog à produire pour capter la longue traîne, organisée
par thématique avec :
- Question / mot-clé cible
- Volume estimé
- Brief court (200-300 mots de directives)

Exemples : "Quelle puissance de poêle pour 100m² ?", "Combien coûte un ramonage
en 2026 ?", "Faut-il choisir bois ou granulés ?", etc.

## Phase 4 — RECOMMANDATIONS TECHNIQUES SEO

- Schema.org (LocalBusiness, Service, FAQPage, BreadcrumbList...)
- Robots.txt / sitemap.xml
- Vitesse (images, lazy loading, CDN)
- Mobile-first
- Sécurité (HTTPS, headers)
- Performance Core Web Vitals (LCP, INP, CLS)

## Phase 5 — BACKLINKS & CITATIONS LOCALES

Liste des annuaires et citations locales à viser pour Mayer (volume + autorité) :
- Pages Jaunes, Yelp, OpenStreetMap
- Annuaires métier (ChambredesMétiers, FFB...)
- Annuaires Tarn locaux (Tarnpublication, Tarnactif, etc.)
- Stratégie de backlinks éditoriaux (presse locale, partenariats, témoignages)

## Phase 6 — PLAN DE MESURE

Propose les KPI à suivre mensuellement :
- Position moyenne par keyword (via l'outil GeoGrid interne ou GSC)
- Trafic organique total (Google Analytics 4)
- Impressions / clics / CTR par requête (Google Search Console)
- Conversions (formulaires de contact, appels)
- Avis Google Business Profile cumulés

# Format de livrable attendu

Un document Markdown structuré, qui peut être directement utilisé comme
roadmap de travail par Mayer ou un freelance SEO. Inclure :
- Résumé exécutif (1 page)
- Audit détaillé
- Gap analysis (tableau)
- Plan d'action priorisé (Quick wins / Pages / Articles)
- Briefs de pages (1 par page à créer/refondre)
- Recommandations techniques
- Plan de mesure

# Workflow attendu de la conversation

1. Tu explores le repo `C:\Dev\Landing Page - Mayer` (point de départ : package.json,
   pages/, app/, src/, README)
2. Tu fais l'audit (lecture des pages, analyse technique)
3. Tu me poses des questions de clarification si besoin (équipe, budget rédaction,
   marques de poêles installées, présence sur certains annuaires, etc.)
4. Tu produis le diagnostic
5. Tu enchaînes sur la gap analysis
6. Tu produis le plan d'action priorisé
7. On itère sur chaque page / article au fur et à mesure

Commence par explorer le repo `C:\Dev\Landing Page - Mayer`.
```

---

## Contexte d'utilisation de ce prompt

Ce prompt est destiné à une **conversation séparée** de la session principale
Majord'home. Il sert à séparer les responsabilités :

- **Session Majord'home** : développement de l'application + outil GeoGrid
  (le thermomètre de mesure)
- **Session SEO** : stratégie + plan de contenu + briefs de pages pour le site
  web Mayer (la cause / le moteur)

Les deux sessions sont complémentaires :
1. La session SEO produit du contenu sur le site
2. Google indexe (~1-3 mois)
3. La session Majord'home (via GeoGrid) mesure les progressions
4. Itération

## Mises à jour à apporter à ce prompt au fil du temps

Ce fichier doit être mis à jour quand :
- De nouvelles données Keyword Planner sont récupérées (volumes, concurrence)
- L'arborescence du site Mayer évolue
- La stratégie business pivote (nouveaux services, nouvelles villes ciblées)
- L'autorité SEO progresse (cas où certaines pages remontent → on ajuste les priorités)

Les benchmarks GeoGrid mensuels alimentent naturellement ce fichier (les
positions actuelles changent → la priorisation suit).
