# SPEC — Plateforme SaaS métier pour artisans du bâtiment (CVC / ramonage)

> Document de spécification fonctionnelle et technique.
> Décrit une plateforme SaaS complète de gestion pour artisans du bâtiment (chauffage, ventilation, climatisation, ramonage, entretien) : CRM, planning, pipeline commercial, outil terrain, devis/contrats, mailing, SEO local, prospection.
> Objectif : permettre de reconstruire une plateforme suivant la même logique. Toutes les données propres à une entreprise (identité, secrets, intégrations spécifiques) sont paramétrables et **jamais codées en dur**.

---

## Table des matières

1. [Vision produit](#1-vision-produit)
2. [Stack technique](#2-stack-technique)
3. [Architecture applicative](#3-architecture-applicative)
4. [Modèle de données](#4-modèle-de-données)
5. [Sécurité multi-tenant (cœur de l'architecture)](#5-sécurité-multi-tenant)
6. [Rôles & permissions](#6-rôles--permissions)
7. [Conventions de code](#7-conventions-de-code)
8. [Modules fonctionnels](#8-modules-fonctionnels)
9. [Edge functions & intégrations serveur](#9-edge-functions--intégrations-serveur)
10. [Intégrations externes](#10-intégrations-externes)
11. [Outillage & qualité](#11-outillage--qualité)

---

## 1. Vision produit

Plateforme SaaS **multi-tenant** (plusieurs entreprises sur une seule instance) destinée aux artisans du bâtiment, en particulier le secteur CVC (chauffage / ventilation / climatisation) et le ramonage.

Elle couvre tout le cycle de vie commercial et opérationnel :

- **CRM** : base clients + parc d'équipements installés (chaudières, poêles, PAC, climatisations…).
- **Pipeline commercial** : leads en colonnes Kanban (Nouveau → Contacté → RDV → Devis envoyé → Gagné / Perdu).
- **Planning** : prise de rendez-vous, calendrier multi-techniciens, assistant de créneaux.
- **Chantiers** : suivi post-vente (commande matériel, planification installation, réception).
- **Entretiens & certificats** : contrats de maintenance récurrents, certificats d'entretien par équipement, SAV.
- **Devis & contrats** : configuration tarifaire, génération PDF, signature électronique.
- **Outil terrain** (tablette/mobile) : rapports d'intervention, photos, signature client.
- **Carte territoire** : visualisation géographique des clients et zones d'intervention.
- **Mailing** : campagnes email segmentées, automatisations, tracking ouvertures/clics, désabonnement RGPD.
- **SEO local** : suivi de positionnement Google Maps (geo-grid) + Search Console.
- **Prospection** : recherche d'entreprises cibles via registre public + scoring.
- **Portail client** : espace en lecture pour le client final (équipements, interventions, contrats).
- **PWA vocale** : mémos vocaux structurés depuis le terrain, transcrits et exploités par IA.

**Principe directeur** : une entreprise pilote sert de référence, mais tout est conçu pour accueillir une **2ᵉ, 3ᵉ entreprise** sur la même base de données sans fuite de données entre elles (isolation par `org_id`).

---

## 2. Stack technique

### Frontend
- **React 18** + **Vite 5** (build/dev) + **React Router 6** (routing, lazy-loading)
- **Tailwind CSS 3.4** (utility-first, pas de CSS modules ni styled-components) + **Radix UI** (primitives accessibles : dialog, popover, tabs, select, tooltip…)
- **TanStack React Query v5** (cache serveur, mutations, invalidation)
- **React Hook Form + Zod** (formulaires + validation schématique)
- **FullCalendar 6** (planning)
- **Recharts** (graphiques dashboard)
- **Mapbox GL JS** + `react-map-gl` + `@turf/turf` (carte territoire, calculs géo)
- **@react-pdf/renderer** (génération PDF côté client : devis, contrats, certificats)
- **react-signature-canvas** (signature électronique)
- **@hello-pangea/dnd** (drag & drop Kanban)
- **Sonner** (toasts), **Lucide React** (icônes), **date-fns** (dates)
- **exceljs** (export/import Excel — éviter `xlsx` pour raisons de sécurité)
- **vite-plugin-pwa** (service worker, installable, mode hors-ligne partiel)

### Backend / infra
- **Supabase** : PostgreSQL + Auth (JWT) + Storage + Edge Functions (Deno/TypeScript)
- **Hébergement frontend** : plateforme de déploiement statique avec preview branches (type Vercel/Netlify)
- **Outil d'automatisation no-code** (type n8n) : webhooks, crons, orchestration de workflows
- **pg_cron** (extension Postgres) : planification des jobs récurrents

### Choix structurants
- Tout l'**UI en français**, le **code en anglais**.
- **Pas de framework SSR** : SPA pure servie en statique, données via API REST PostgREST de Supabase.
- **Mono-instance Supabase partagée** entre plusieurs apps métier distinctes (décision de coût) → d'où l'importance capitale de l'isolation par schéma + `org_id`.

---

## 3. Architecture applicative

### Découpage en "apps" dans un seul frontend

Le frontend héberge **plusieurs applications** sous le même domaine, distinguées par layout et garde d'accès :

```
src/
├── main.jsx                 # Point d'entrée
├── App.jsx                  # Routes racine (publiques / protégées / portail / pwa)
├── lib/                     # supabaseClient, mapbox, helpers, constants, branding org…
├── contexts/AuthContext.jsx # Auth + organisation courante + rôles
├── pages/                   # Pages publiques (Login, ResetPassword, AuthCallback, NotFound…)
├── components/
│   ├── ProtectedRoute.jsx   # Gardes : ProtectedRoute, PublicOnlyRoute, ClientRoute
│   └── ui/                  # Primitives Radix (button, card, input, tabs, confirm-dialog…)
├── layouts/AppLayout.jsx    # Sidebar + header (app principale)
├── apps/
│   ├── artisan/             # APP PRINCIPALE (back-office entreprise)
│   │   ├── routes.jsx       # Routes lazy-loaded
│   │   ├── pages/           # Dashboard, Clients, Pipeline, Planning, Chantiers,
│   │   │                    # Entretiens, Territoire, Mailing, GeoGrid, Settings…
│   │   └── components/      # Composants par domaine (clients/, pipeline/, planning/…)
│   ├── client/              # PORTAIL CLIENT (espace lecture du client final)
│   │   ├── routes.jsx
│   │   ├── layouts/ClientLayout.jsx
│   │   └── pages/           # Dashboard, Équipements, Interventions, Contrat…
│   ├── voice/               # PWA VOCALE (mémos terrain)
│   │   ├── routes.jsx
│   │   ├── layouts/VoiceLayout.jsx  # fullscreen
│   │   └── pages/VoiceRecorder.jsx
│   └── prospection/         # MODULE PROSPECTION (recherche entreprises cibles)
│       ├── _shared/         # lib (API registre, scoring), hooks, composants
│       ├── cedants/         # Pipeline "cédants" (reprises d'entreprise)
│       └── commercial/      # Pipeline "commercial"
└── shared/
    ├── services/            # Couche d'accès données (1 fichier par domaine)
    └── hooks/               # React Query hooks + cacheKeys centralisées
```

### Gardes de routes (App.jsx)

- **Publiques** : `/login`, `/forgot-password`, `/reset-password`, `/auth/callback`.
- **Semi-protégées** (auth requise, pas d'org) : `/join-organization`, `/unauthorized`.
- **Portail client** (`/client/*`) : auth + enregistrement "client" lié → `ClientRoute`.
- **PWA vocale** (`/voice/*`) : auth + permission spécifique, layout fullscreen.
- **App principale** (`/*`) : auth + appartenance à une organisation → `AppLayout` + sidebar.

### Aliases de build (Vite)
`@` → `src/`, plus `@components`, `@pages`, `@layouts`, `@contexts`, `@lib`, `@services` → `src/shared/services`, `@hooks` → `src/shared/hooks`, `@apps`. Évite les imports relatifs profonds.

---

## 4. Modèle de données

### Schémas PostgreSQL
- **`core`** : entités transverses partagées entre toutes les apps cohabitantes — `profiles`, `organizations`, `organization_members`.
- **`metier`** (schéma applicatif dédié) : toutes les tables métier — `clients`, `equipments`, `interventions`, `leads`, `appointments`, `contracts`, etc.
- **`public`** : uniquement des **vues** qui exposent `core`/`metier` à l'API REST (PostgREST).

### Pattern d'accès frontend (crucial)

PostgREST **n'expose pas** le schéma applicatif métier directement (renvoie HTTP 406). Donc :

- **Lecture front** : créer une **vue publique** `public.metier_xxx` (avec `security_invoker=true`) et lire via `supabase.from('metier_xxx')`.
- **Écriture front** sur une table sans vue accessible en écriture : passer par une **RPC `SECURITY DEFINER`** dans `public` avec `SET search_path = metier, public`.
- **Toujours** filtrer explicitement par `org_id` côté requête : `.eq('org_id', orgId)` (défense en profondeur même si RLS s'applique).
- Préférer `.maybeSingle()` à `.single()` quand 0 ligne est un cas légitime (sinon 406).

### Tables métier principales
- `clients` (+ numéro client auto-incrémenté via **séquence DB**, jamais calculé manuellement), `equipments` (parc installé, FK client).
- `leads` (pipeline commercial — `status_id`, `chantier_status`, montants, dates).
- `appointments` (rendez-vous, FK `lead_id` **ou** `intervention_id`).
- `interventions` (terrain + entretiens ; modèle parent/enfant pour les certificats multi-équipements).
- `contracts` (contrats de maintenance, montant figé, zone tarifaire).
- `pricing_*` (zones, types d'équipement, matrice tarifaire, remises volume, options).
- `mail_campaigns`, `mail_segments`, `mailing_logs`, `mailing_events` (mailing).
- `role_permissions` (matrice rôle × ressource × action, par org).
- Tables SEO (`geogrid_scans`, `geogrid_results`, `geogrid_keyword_lists`, `geogrid_benchmarks`, `gsc_keyword_metrics`).
- Tables prospection (`prospects`, `prospect_interactions`).

### Vues publiques principales (toutes en `security_invoker=true`)
- `metier_clients` (+ `has_active_contract` calculé)
- `metier_contracts` (JOIN clients → `client_name`, `client_address`…)
- `metier_appointments` (+ champs client dénormalisés)
- `metier_chantiers` (leads filtrés `chantier_status IS NOT NULL` + JOIN équipement + intervention parente)
- `metier_kanban_cards` (cartes Kanban matérialisées — voir §8.2)
- `metier_entretien_sav`, `metier_interventions`, `metier_maintenance_visits`
- `metier_mailing_logs`, `metier_mailing_events`
- `metier_prospects`, `metier_prospect_interactions`
- `metier_geogrid_*`
- `profiles`, `organizations`, `organization_members` (vues core)

### Gotchas DB à respecter
- **Séquences** : ne jamais faire `SELECT MAX(col)+1`. Laisser le `DEFAULT nextval()` (atomique, anti-race-condition).
- **Vérifier `{ error }`** sur toute mutation `update/insert/delete` Supabase — triggers/RLS/contraintes peuvent échouer silencieusement.
- **Vue lue par une edge function** : comme les vues sont `security_invoker`, RLS ne suffit pas → ajouter `GRANT SELECT ON metier.<table> TO service_role` dans la migration, sinon `42501 permission denied` silencieux.
- **Ne jamais `DROP SCHEMA ... CASCADE`** sans avoir d'abord retiré le schéma de la liste "Exposed schemas" de l'API et attendu le reload PostgREST — sinon 503 sur toute l'API (impacte toutes les apps cohabitantes).
- **Tri chronologique d'entités d'un outil tiers** : trier sur l'ID interne incrémental du tiers, pas sur un montant ou une date dénormalisée.

---

## 5. Sécurité multi-tenant

> **C'est le cœur de l'architecture.** Plusieurs entreprises partagent la base ; une faille = fuite cross-org. Voici les règles à appliquer dès la conception (un audit a posteriori coûte cher).

### Les pièges structurels à éviter dès le départ

| Risque | Correctif |
|---|---|
| Fonction SQL d'exécution arbitraire (`exec_sql`) exécutable par un user authentifié → lecture totale de la DB depuis le navigateur | La passer en `SECURITY INVOKER` (droits du caller), ne jamais l'appeler depuis le front |
| Vues exposant le métier en `SECURITY DEFINER` par défaut → **bypass de RLS** (le filtre `.eq('org_id')` front devient la SEULE défense) | Créer **toutes** les vues avec `WITH (security_invoker=true)` → RLS s'applique sur chaque accès |
| RPC `SECURITY DEFINER` exposées au rôle `anon` | `REVOKE EXECUTE FROM anon` **immédiatement après création** |
| Tables métier sans RLS, ou policies `USING(true)` | RLS activée + policies `org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())` |
| Storage : policy `ALL` pour tout `authenticated` sans filtre | Préfixer les fichiers par `${orgId}/...` + policies `(storage.foldername(name))[1]::uuid IN (org_members)` |
| Crons / edge functions publiques (`verify_jwt:false`) invocables anonymement | Exiger un **secret partagé** en header `Authorization: Bearer <CRON_SECRET>`, comparaison **timing-safe** |
| State OAuth opaque (base64) → CSRF / replay / user-switch | State **signé HMAC-SHA256** liant `(orgId, userId, returnTo, nonce, exp)`, TTL court, revalidation au callback |
| Webhook public acceptant du **SQL brut** en paramètre → exfiltration cross-org si l'URL fuite | N'accepter que des **IDs** (`segment_id`, `client_id`) ; compiler le SQL côté serveur après check d'appartenance |

### Règles imposées (charte) — à graver dans le `CLAUDE.md`/doc du projet

1. **Toute mutation** Supabase filtre explicitement par `org_id`.
2. **Tout nouveau RPC `SECURITY DEFINER`** : `REVOKE EXECUTE FROM anon` immédiat. **Si le payload contient `org_id`** (au lieu de le dériver de `auth.uid()`) → `REVOKE FROM PUBLIC, anon, authenticated`, accessible **seulement à `service_role`**. Sinon un user authentifié forge un `org_id` arbitraire et écrit cross-org.
3. **Tout nouveau bucket Storage** : path `${orgId}/...` + policies par bucket avec filtre sur le 1ᵉʳ segment de path.
4. **Toute nouvelle table métier** : RLS activée + policies CRUD scopées `org_id` dès la création. **Si lue via une vue publique** → ajouter `GRANT SELECT ... TO service_role`.
5. **Toute nouvelle vue publique** : créée `WITH (security_invoker=true)`.
6. **Jamais de SQL dynamique construit côté frontend** pour un flux multi-tenant (mailing, segments…). Passer par une RPC qui vérifie `auth.uid() ∈ org_members` avant de compiler.
7. **Toute clause PostgREST `.or()` / `.ilike()` interpolant un input utilisateur** doit passer par un helper d'échappement (`escapePostgrestSearchTerm`) qui strip `,()*:%\` — empêche l'injection d'un filtre additionnel.
8. **Edge function `verify_jwt:false`** non-webhook tiers → exiger le secret partagé. **Edge function `verify_jwt:true`** → valider l'appartenance via un helper `requireOrgMembership`.
9. **Intégrations conditionnelles par org** : flag dans `organizations.settings` (ex. `{ integration_x: { enabled: true } }`), consommé côté requête.
10. **Toute clé `localStorage`** suffixée par `:${orgId}` (cache org-scoped) ou `:${userId}` (draft perso) pour éviter une fuite au switch d'organisation.
11. **Toute valeur de branding** (nom, adresse, SIRET, logo, couleur, certifications…) passe par `organizations.settings` + un helper `buildCompanyInfo(settings)` avec **fallback neutre** (« Votre entreprise », champs vides, couleur grise, pas de logo). Une org sans settings affiche du **neutre**, jamais les données d'une autre entreprise.
12. **Toute nouvelle valeur de config org** est éditable via l'UI Settings **avant** d'être consommée par le code (sinon les onboardings futurs restent bloqués).

### Helper d'auth edge functions partagé
Un module `_shared/auth.ts` centralise :
- `requireOrgMembership(req, { orgId?, requiredRole?, orgSettingsFilter? })` → valide JWT + appartenance, retourne `{ ok, userId, orgId, role, supabase }` ou une réponse 401/403 prête.
- `requireSharedSecret(req, secret, name)` → check Bearer timing-safe pour les crons.
- `buildCorsHeaders(req)` (whitelist d'origines via env CSV), `jsonResponse`, `sanitizeError` (strip stack/secrets en prod), `getAdminClient`, `timingSafeEqual`.

---

## 6. Rôles & permissions

Trois rôles d'organisation :

| Rôle | Permissions |
|------|-------------|
| `org_admin` | Tout gérer (incl. config, droits, suppressions destructives) |
| `team_leader` | Clients, planning, assignation |
| `user` (technicien) | Vue projets, rapports terrain |

- Un **rôle métier** complémentaire (ex. `business_role = 'Commercial'`) débloque l'accès au pipeline.
- Pattern : `const { isOrgAdmin, isTeamLeaderOrAbove, canAccessPipeline } = useAuth();`
- **Permissions granulaires** stockées en base (`role_permissions` : rôle × ressource × action × `allowed`), éditables via une UI "Droits d'accès" (`org_admin` only). `org_admin` bypasse tout.
- Pattern de garde composant : `const { can } = useCanAccess(); if (!can('resource','action')) return <AccessDenied />;`
- **Provisioning nouvelle org** : RPC qui copie les permissions d'une org template (idempotent, `service_role` only).

### "God mode" org_admin (hard delete avec cascade)
Pour les entités où soft-delete ne suffit pas (planning fantôme, doublons d'import) : bouton "Supprimer" rouge dans le footer de la modale d'édition (visible si `org_admin`), appelant une RPC `<entity>_hard_delete(p_id)` :
- `SECURITY DEFINER`, `REVOKE anon`, `search_path` explicite.
- Check `auth.uid() ∈ org_members WHERE role='org_admin' AND org_id = (entity.org_id)` sinon `RAISE EXCEPTION`.
- Purge les dépendances satellites sans FK CASCADE explicite, puis DELETE final (cascade DB).
- Retourne un JSON avec compteurs purgés pour le feedback UX.
- Côté front : `ConfirmDialog` destructif + preflight count + toast + invalidation cache croisée.

---

## 7. Conventions de code

### Services (`shared/services/`)
- Pattern : `export const xxxService = { async method() {...} }`.
- **Toujours retourner `{ data, error }`** (ou `{ data, count, error }`) — **jamais throw** au caller.
- Toujours destructurer `{ error }` sur les mutations Supabase.
- Wrapper les async via un helper `withErrorHandling()`.
- **Pas de service > ~700 LOC** sans décomposition en sous-modules (ex. `clients.service` délègue à `equipments.service`).

### Hooks (`shared/hooks/`)
- TanStack React Query v5. Retournent `{ data, isLoading, error, refetch, ...mutations }`.
- **Cache keys centralisées** dans un fichier unique `cacheKeys.js` — jamais de clé inline.
  - Convention : toutes les familles prennent `orgId` en **1ᵉʳ paramètre** : `all: (orgId) => [domain, orgId]`, sous-clés idem (défense en profondeur multi-tenant).
  - Familles : `clientKeys`, `contractKeys`, `leadKeys`, `appointmentKeys`, `interventionKeys`, `chantierKeys`, `prospectKeys`, `pricingKeys`, `mailingKeys`, `geogridKeys`, `orgSettingsKeys`, `kanbanCardKeys`…
- `enabled: !!orgId && ...` obligatoire sur les `useQuery` dépendant de l'org.
- Hooks génériques réutilisables : `usePaginatedList`, `useDebounce`.
- **Pas de `console.*` en prod** : utiliser un `logger` (no-op en prod sauf `logger.error`).

### Composants (`.jsx`, PascalCase)
- **Pas de composant > 500 LOC** sans découpage (orchestrateur + sections).
- **Pas de composant > 10 `useState`** sans envisager `useReducer`/state machine (>15 = refacto obligatoire).
- **Pas de logique business dans le JSX** : extraire en hooks ou helpers `lib/`.
- **Tailwind only**. Toasts : `toast.success()` / `toast.error()`.
- Composants formulaire partagés centralisés (`FormField`, `TextInput`, `PhoneInput`, `SelectInput`, `TextArea`, `SectionTitle`).
- Composants génériques partagés : `KanbanBoard` (DnD optionnel, colonnes configurables), `SearchBar`.

### Utilitaires partagés (`lib/`)
- Dates timezone-safe (`formatDateForInput`, `formatDateFR`, `formatDateShortFR`, `formatDateTimeFR`), `formatPhoneNumber`, `formatEuro`, `computeEndTime`, `computeDuration`.
- Branding multi-tenant (`buildCompanyInfo(settings)` + `formatFullAddress` + `buildLegalFooter`, fallback neutre).
- Config territoire (siège org, départements couverts) dérivée des settings.
- Constantes (`DEFAULT_PAGE_SIZE`, etc.).

### Dette technique
- **1 nouveau warning lint → fix immédiat** (le `--max-warnings` est figé au compte courant pour bloquer toute régression en CI).
- **Audit dead-code** (script détectant les fichiers jamais importés) avant chaque PR majeure. Un composant "partagé" doit être consommé dans le même commit que sa création.

---

## 8. Modules fonctionnels

### 8.1 CRM — Clients & Équipements
- Liste paginée, recherche (nom, téléphone, adresse) avec échappement des termes.
- Fiche client à onglets : **Info / Contrat / Équipements / Interventions / Timeline / Mailings** (+ Devis/Factures si intégration facturation active).
- **Parc d'équipements** par client (marque, modèle via saisie libre + suggestions `<datalist>`, type, date d'installation). Sert de base aux certificats d'entretien et au chaînage des visites annuelles.
- Numéro client via séquence DB. Catégorisation client (badge).
- Archivage soft (`is_archived`) ; god-mode hard-delete pour org_admin.

### 8.2 Pipeline commercial (Kanban leads)
- Colonnes : **Nouveau → Contacté → RDV planifié → Devis envoyé → Gagné / Perdu**.
- Drag & drop entre colonnes (met à jour `status_id`).
- **Cartes matérialisées** via une vue `metier_kanban_cards` : 1 lead peut produire 1-2 cartes selon le mix de statuts de ses devis. Placement piloté par l'état des devis (allowlists de statuts strictes : « Gagné » = accepté/facturé ; « Devis envoyé » = en attente/brouillon/expiré ; « Perdu » = refusé/annulé uniquement). Un statut inconnu reste invisible jusqu'à extension explicite de la vue.
- Carte : montant, date de RDV (puce gauche), tags source (origine du lead), badges mailing.
- Modale lead : sections formulaire, timeline d'activité, gestion devis.
- **Sémantique des montants** (si intégration facturation) : distinguer (1) somme des devis valides — affichée en colonne Gagné, (2) montant du dernier devis envoyé — affiché en amont, (3) devis effectivement signé. Les trois peuvent diverger.
- **Suivi long-terme** : un toggle "parking" sort un lead du flux principal vers une timeline isolée (devis à maturation lente), sans auto-bascule.

### 8.3 Planning / Prise de RDV ↔ Kanban

> **Principe unifié** : un RDV (`appointments`) planifie **une seule carte** déterminée par son **type**. Pas d'auto-création silencieuse de lead (cause historique de leads fantômes).

**Types → destination unique** :

| Type de RDV | Kanban cible | Work item |
|---|---|---|
| Visite technique (closing) | Pipeline | `leads` (`status_id`) |
| Installation | Chantier | `leads` (`chantier_status`) |
| Entretien (maintenance) | Entretien | `interventions` (entretien) |
| SAV (service) | Entretien | `interventions` (sav) |
| Autre | — (planning seul) | aucun (défaut non piégeux) |

- Lien `appointments.intervention_id` (miroir de `lead_id`, FK `ON DELETE SET NULL`). Un RDV pointe vers un lead **ou** une intervention **ou** rien. Multi-RDV par carte possible.
- **Dérivation, source unique = `appointments`** : les vues kanban exposent `next_rdv_date` (MIN des RDV actifs liés, filtré par type) + `has_active_rdv`, via `LEFT JOIN LATERAL`. Pas de champ dénormalisé (évite les désynchros).
- **Activation** (`appointmentActivation.service`) : rattache ou active la carte du client (dédup par client+type, jamais de doublon). Prospect = vrai formulaire réservé au **walk-in inconnu** (ni client ni lead lié).
- **Cycle de vie carte↔RDV** (unique writer = `appointments.service`) : à la prise, avance la carte en "planifié" **forward-only** (ne descend jamais, ne touche pas un état terminal) ; à l'annulation, recalcule "à planifier".
- **Assistant de créneaux** (Bloc B) : disponibilités par technicien, multi-créneaux multi-intervenants, sélection type+créneau sur une grille, objet auto-généré. VT → commerciaux, entretien/SAV → techniciens.
- Calendrier **FullCalendar** multi-techniciens, sélection multiple.
- **Gotcha** : une vue SQL avec JOIN/window n'est pas "updatable" → ne pas écrire dessus. Un backfill d'entretien doit cibler les **RDV à venir uniquement** (un RDV passé ≠ entretien non fait).

### 8.4 Chantiers (post-vente)
- Kanban dédié au suivi après signature : commande matériel → planification installation → réception.
- Carte chantier + modale détail, section interventions liées.
- Réception de chantier (PV de réception signé).
- Si intégration facturation : bloc devis attachés affiché sur carte + modale.

### 8.5 Entretiens & Certificats (multi-équipements)

> **1 certificat par équipement.** Modèle parent/enfant : le **parent** = carte Kanban (1 par contrat/client), les **enfants** = 1 intervention par équipement du contrat (`parent_id` + `equipment_id`).

- Vue Kanban entretiens filtrée `parent_id IS NULL` (enfants exclus du board et des stats).
- **Lazy create** : les enfants sont créés à la 1ʳᵉ ouverture de la modale si absents.
- Workflow : `à planifier → planifié → [remplir certificats par équipement] → réalisé → facturé (hors Kanban)`.
- Transition `réalisé` automatique quand tous les enfants sont traités (rempli ou marqué "néant").
- Clôture du parent → insère une **maintenance_visit** (chaînage annuel automatique).
- **Certificat PDF** : assistant multi-étapes (type d'équipement → nettoyage → ramonage → mesures → contrôles → F-Gaz selon équipement), logo + signature technicien (nom = user connecté), prochaine intervention en mois/année.
- **SAV** : sections devis + pièces remplacées, modales dédiées.
- Bouton "Ranger" (archive) sur cartes "à planifier" + toast undo.

### 8.6 Contrats (configuration, PDF, signature)

> **Source de vérité figée à la signature** : `contract.amount` et `contract.zone_id` sont **figés à la configuration**. L'écran de signature et le PDF ne recalculent **jamais** le total ni la zone depuis la grille courante.

- **Règle générale** : tout artefact contractuel signé/envoyé (devis, contrat, certificat) lit les valeurs **enregistrées**, jamais recalculées — sinon divergence config↔signature.
- Un resolver de zone partagé sert seulement de **fallback** si `zone_id` est NULL.
- Tout écart entre somme des lignes (grille × zone stockée) et `amount` s'affiche en **"Remise commerciale"** (traçabilité).
- **Forçage de prix par ligne** : le prix d'un équipement dans un contrat peut être forcé manuellement (admin). Scope = `(contract_id, equipment_id)`, **jamais global** : ne touche pas la grille tarifaire partagée. Le prix forcé substitue le prix grille de la ligne, la dégressivité reste appliquée en aval.
- Signature électronique (`react-signature-canvas`), génération PDF (`@react-pdf/renderer`).

### 8.7 Tarification (Settings → Pricing)
- CRUD per-org de la grille tarifaire, accès `org_admin`.
- 5 onglets : **Zones / Types d'équipement / Tarifs (matrice zone × type) / Remises volume / Options**.
- Tables `pricing_*` toutes scopées `org_id NOT NULL` + RLS + UNIQUE composites `(org_id, …)`.
- Hook admin (inclut inactifs, CRUD) vs hook prod (filtre `is_active=true` pour les formulaires contrat).
- `upsertRate` avec `onConflict: 'org_id,zone_id,equipment_type_id'`.

### 8.8 Territoire (carte)
- Carte **Mapbox** des clients géocodés + zones d'intervention dessinées (`@turf/turf`).
- Recherche d'adresse, popups, contrôles de calques.
- Géocodage des adresses (service dédié), calcul de durée de trajet depuis le **siège de l'org** (dérivé des settings, pas hardcodé) — si siège non configuré, l'affichage "depuis X" est masqué.
- Zones persistées en `localStorage` suffixé `:${orgId}`.

### 8.9 Mailing

Module complet d'emailing avec tracking et conformité RGPD.

**Architecture 3 onglets** : Envoi (tous rôles) / Segments (admin) / Éditeur (admin).
- **Envoi** : sélecteur campagne + segment + carte d'identité + preview + envoi.
- **Segments** : catalogue de ciblages réutilisables (presets + perso) via un **builder à facettes** 4 blocs (Population / Attributs / Historique mailing / Preview live avec count + table 20 destinataires). Chaque segment = un **DSL jsonb** compilé en SQL par une RPC serveur (jamais de SQL front).
- **Éditeur** : wizard 3 étapes (Identité + automatisation, Brief éditorial, Génération). V1 = copier-coller d'un prompt vers un LLM externe puis collage du HTML ; Vdef prévue = appel API direct.
- **Onglet fiche client** : historique mails + badges statut + timeline events + compteurs ouvertures/clics (polling).

**Tables** : `mail_campaigns` (subject, html_body, blocks jsonb, flags `is_automated`/`is_transactional`, cadence auto, `next_run_at`…), `mail_segments` (filters jsonb DSL, presets), `mailing_logs` (1 ligne/email envoyé), `mailing_events` (audit log webhook, dédupliqué par ID d'event unique).

**RPCs clés** (toutes `SECURITY DEFINER`, membership-checked) :
- `mail_segment_compile(filters, name, org_id)` → SELECT SQL depuis le DSL.
- `mail_fetch_recipients(segment_id?, client_id?, name?)` → compile + exécute, retourne les destinataires.
- `mail_segment_count` / `mail_segment_preview`.
- `mail_campaigns_due` / `mail_campaign_mark_run` (scheduler auto).

**Envoi** : edge function `mailing-send` — accepte `{ segment_id, campaign_id }` (broadcast) ou `{ client_id, campaign_id }` (transactionnel), **jamais de SQL**. Squelette HTML commun stocké dans les settings org, appliqué aux templates body-only ; placeholder `{{SALUTATION}}` remplacé.

**Tracking** (provider type Resend) : webhook signé (HMAC Svix) → RPC atomique `apply_webhook_event` :
- INSERT `mailing_events` (idempotent via ID unique → retries sans effet de bord).
- UPDATE `mailing_logs` avec priorité de statut : `sent(1) < delivered(2) < opened(3) < clicked(4)` ; `bounced/complained/failed(100)` terminal. Un event ne rétrograde jamais.
- `open_count`/`click_count` incrémentés. **Attention** : les "Safe Links" Outlook pré-fetchent les liens → `click_count` gonflé ; prévoir un "unique click" via `GROUP BY user_agent/ip`.

**Désabonnement RGPD (RFC 8058)** :
- Colonnes `email_unsubscribed_at` + `email_unsubscribe_reason` sur clients ET leads.
- Edge function `mailing-unsubscribe` : token **signé HMAC** (TTL 90j), GET = page de confirmation, POST = one-click silencieux.
- Headers `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` → bouton natif "Se désabonner" dans Gmail/Outlook/Yahoo/Apple Mail.
- **Auto-unsubscribe sur plainte spam** (event `complained`). **Auto-cleanup email sur hard bounce**.
- Tous les segments incluent `email_unsubscribed_at IS NULL AND email IS NOT NULL AND mail_optin=true`.

**Templates transactionnels** (`is_transactional=true`, déclenchés 1-à-1, exclus du broadcast) : confirmation de signature de contrat (avec PDF en pièce jointe), proposition de devis. Placeholders remplacés côté edge function ou frontend.

**Scheduler campagnes auto** : un workflow no-code (cron 10 min) appelle `mail_campaigns_due` → compile segment → envoie → `mail_campaign_mark_run`. Toute campagne `is_automated=true` + segment + cadence est éligible.

### 8.10 Intégration outil de facturation/comptabilité tiers

> Intégration **quote-driven** (pilotée par les devis) avec un outil de facturation externe (type Pennylane/Sellsy). Conditionnelle par org via `settings.integration.enabled`.

- **Table de liaison N:N** `lead_external_quotes` (leads ↔ devis externes) : `quote_status`, `amount`, `is_winning_quote`, `ejected_at`/`ejected_reason` (soft-detach), `pdf_url` (URL PDF stable du tiers).
- **Bridge canonique** : une fois un devis rattaché, l'outil tiers fait foi pour l'identité du lead (les champs contact deviennent **lecture seule** côté CRM, bandeau "à modifier dans l'outil tiers").
- **Proxy edge function** : toutes les requêtes vers l'API tierce passent par un proxy qui exige le JWT user + valide l'appartenance + whitelist de chemins. **Rate limiting** : wrapper tout batch par un `pLimit(N)` (l'API tierce limite ex. 25 req/5s).
- **Cron de sync** (15 min, `verify_jwt:false` + secret) : sync `quote_status` + `pdf_url`, éjecte les devis disparus (404), bascule les leads "Gagné" quand un devis est accepté (crée le chantier), auto-attache les nouveaux devis ≥ seuil, sync identité tiers → CRM (OVERWRITE quand le tiers a une valeur non vide, préserve sinon).
- **RPC canonique unique** "gagner un lead" : pose `is_winning_quote`, statut Gagné, date, crée le chantier, log d'activité. Appelée par le chemin manuel **et** le cron — ne jamais dupliquer la logique de gain ailleurs.
- **Cache write-through** des entités tierces (`external_customer_lookup`) alimenté fire-and-forget à chaque fetch.
- **Liens UI** : toujours utiliser l'URL PDF persistée fournie par le tiers, jamais reconstruire une URL à la main (404 en multi-compte).
- **Seuil pipeline** : devis < montant min exclus du rattachement (considérés SAV/entretien).
- **Gotchas API tierce** : les réponses single-GET retournent la ressource au root (pas wrappée) → helper défensif. Filtre natif par `customer_id` pour éviter le scan paginé global.

### 8.11 PWA vocale (mémos terrain)
- App PWA dédiée (`/voice/*`), layout fullscreen, accès par permission DB (`voice_recorder.use`).
- Enregistrement d'un mémo vocal (RDV terrain / réunion / note libre).
- Pipeline : transcription (Whisper) → **extraction structurée par LLM** (edge function `voice-extract-fieldreport`, prompt CVC) → insertion structurée (crée éventuellement leads/tâches).
- **Quota daily user × org** (table `voice_quotas` + RPC atomique `increment_voice_quota` avec `RAISE EXCEPTION` si dépassement).
- L'edge function d'extraction est `verify_jwt:false` + secret partagé ; la RPC d'écriture prend `org_id` dans son payload → `service_role` only.

### 8.12 SEO local — Geo-grid rank tracker
- Suivi de positionnement **Google Maps** via 2 modes : **grille** géographique N×N (5×5/7×7/9×9) autour d'un centre, ou **communes** (1 requête par ville d'un département, filtrable par population).
- **Edge function** `geogrid-scan` appelant l'API **Google Places (New)** `places:searchText` ; matching business par normalisation Unicode (lowercase + strip diacritiques).
- API communes via un service public gratuit (cache localStorage 7j).
- **Architecture 3 onglets** : Scan unique (ad-hoc 1 keyword) / Listes de keywords (CRUD réutilisables) / Benchmarks (run d'une liste = N scans, progress bar, estimation coût/durée, tableau consolidé groupé par famille de mots-clés via regex).
- **Garde-fou quota** : somme des points du mois en bornes UTC strictes ; bouton désactivé si projection > free tier (5000 req/mois) sauf override explicite.
- Place ID du business stocké dans `settings.google_place_id` par org.

### 8.13 SEO — Search Console
- 2ᵉ thermomètre SEO : positions/impressions/clics du site dans Google Search.
- **OAuth Google** : `refresh_token` stocké dans les settings org ; state signé HMAC.
- Edge functions `gsc-oauth-init` / `gsc-oauth-callback` / `gsc-sync` ; API Search Analytics paginée.
- Table `gsc_keyword_metrics` (UNIQUE `org_id+site_url+date+query+page`) + RPC d'upsert.
- UI : sélecteur de période, filtre famille, toggle "liste curée uniquement", KPIs + tableau agrégé par requête.

### 8.14 Prospection (recherche d'entreprises cibles)
- Recherche d'entreprises via **API publique du registre des entreprises** (ex. SIRENE en France) : filtres NAF, géo, taille.
- Deux pipelines : **cédants** (reprises d'entreprise) et **commercial**, chacun avec son **scoring** dédié.
- Composants : modale de recherche, table prospects, KPIs, filtres, drawer détail, sélecteur NAF + glossaire.
- Tables `prospects` + `prospect_interactions` (vues avec JOIN profiles pour `created_by_name`/`assigned_to_name`).

### 8.15 Portail client
- Espace en lecture pour le client final (`/client/*`, garde `ClientRoute`).
- Pages : Dashboard, Équipements, Interventions (+ détail), Contrat, changement de mot de passe.
- Invitation client via edge function `invite-client` ; reset password dédié.

### 8.16 Settings → Organization (config multi-tenant)
- Configuration de l'identité de l'org, `org_admin` only. **Source de vérité = `organizations.settings` (JSONB)**.
- 3 onglets :
  - **Identité** : nom commercial, raison sociale, forme juridique, capital, SIRET (auto-format), RCS, TVA intra (auto-format), assurance, certifications (chips).
  - **Coordonnées** : adresse, CP, ville, téléphone (auto-format), email d'envoi, reply-to, site web. `domain` calculé depuis l'email.
  - **Territoire** : siège (label + recherche adresse Mapbox + couleur + emoji), référence Google Business (`google_place_id`), département principal, antennes commerciales optionnelles.
- **Hook canonique `useOrgSettings()`** : lecture (SELECT direct sur vue `organizations`, RLS scope user→org) + écriture (RPC `org_update_settings`, `SECURITY DEFINER`, org_admin only, shallow merge JSONB). `onSuccess` invalide le cache + resync l'AuthContext.
- **Règle scale-ready** : tout nouveau code lisant/écrivant les settings passe par `useOrgSettings()`. Save par onglet (diff via `JSON.stringify`), bouton disabled si `!isDirty || !isValid || isSaving`.
- Consommateurs des settings : `buildCompanyInfo` (PDFs), centre de carte, siège pour trajets, départements couverts, ressources mailing.

---

## 9. Edge functions & intégrations serveur

Edge functions (Deno/TypeScript sur Supabase), classées par pattern d'auth :

| Type | Auth | Exemples |
|---|---|---|
| `verify_jwt:true` (frontend) | `requireOrgMembership` | proxy API tierce, oauth-init, sync manuel |
| `verify_jwt:false` (crons/jobs) | `requireSharedSecret(CRON_SECRET)` | crons de sync, extraction vocale, scheduler |
| Webhooks tiers | Signature propre (HMAC Svix / callback signé) | webhook email, callback OAuth |

**Liste indicative** : `mailing-send`, `mailing-scheduler`, `mailing-unsubscribe`, `email-webhook`, `contract-signed-notify`, proxy facturation + crons de sync devis + backfill, `voice-extract-fieldreport`, `geogrid-scan`, `gsc-oauth-init`/`gsc-oauth-callback`/`gsc-sync`, `invite-client`, `client-change-password`, `email-domain-onboard`.

**Règles edge functions** :
- Versionner le `verify_jwt` de chaque fonction dans un `config.toml` (évite le drift prod/repo lors d'un redéploiement).
- **Une edge function décrite comme un cron DOIT avoir une vraie entrée `cron.job` (pg_cron)** créée par migration — sinon elle ne tourne jamais (bug silencieux classique). Vérifier `SELECT jobname, schedule FROM cron.job`. Le secret du cron est lu depuis `vault.secrets` par le job pg_cron.
- **Namespace d'env vars** préfixé par l'app (ex. `APP_*`) pour isoler les variables partagées entre apps cohabitantes.
- `sanitizeError` strip stack/Bearer/JWT/`*_SECRET=` en prod ; pour les objets non-Error, `JSON.stringify` en dev (fallback générique en prod).
- CORS : whitelist d'origines via env CSV (fallback `*` en dev local).

---

## 10. Intégrations externes

Toutes **swappables** et **conditionnelles par org** (flag dans settings). Décrites par catégorie :

- **Backend / Auth / Storage / DB** : Supabase (PostgreSQL + Auth JWT + Storage + Edge Functions).
- **Cartographie & géocodage** : Mapbox GL (carte, recherche d'adresse, reverse geocoding).
- **Email transactionnel & marketing** : fournisseur type Resend/Postmark/SendGrid (envoi + webhooks de tracking signés + domaine vérifié).
- **Facturation / comptabilité** : outil tiers type Pennylane/Sellsy (devis/factures, API REST rate-limitée, intégration quote-driven via proxy).
- **SEO** : Google Places API (New) (geo-grid), Google Search Console API (positions/clics, OAuth).
- **Registre d'entreprises** : API publique type SIRENE (prospection).
- **Voix IA** : transcription (Whisper) + extraction structurée par LLM (type Claude/GPT-4o) ; téléphonie IA (type Vapi) prévue.
- **Calendrier** : sync one-way App→Google Calendar (fire-and-forget, edge functions + tables + service frontend).
- **Automatisation no-code** : type n8n (webhooks, crons, orchestration) — à terme remplaçable par des edge functions + pg_cron (réduit le couplage).
- **Publicité** : intégration Meta Ads (dashboard insights) prévue/partielle.

**Gestion des secrets** : tous les secrets (clés API, secrets de webhook, secrets de cron) vivent côté serveur (Supabase Edge Function Secrets / `vault.secrets`), **jamais dans le frontend**. Le frontend ne reçoit que la clé publishable Supabase et le token Mapbox public.

---

## 11. Outillage & qualité

### Commandes
```bash
npm run dev               # Dev server
npm run build             # Build production
npm run lint              # ESLint (--max-warnings figé au compte courant = guard anti-régression CI)
npm run lint:errors       # ESLint errors uniquement (--quiet)
npm run audit:dead-code   # Détecte les fichiers sources jamais importés
npm run audit:quality     # lint:errors + audit:dead-code (avant PR)
```

### Hook pre-commit
- `.githooks/pre-commit` lance `lint:errors` avant chaque commit, bloque si une erreur apparaît.
- Setup auto via `npm prepare` (`git config core.hooksPath .githooks`). Bypass d'urgence : `git commit --no-verify`.

### Discipline de PR
- `audit:quality` avant toute PR feature majeure.
- Un fichier identifié comme dette qu'on touche → en profiter pour le décomposer un peu.
- TODOs tolérés temporairement avec raison claire, pas plus d'un mois.

### Documentation projet
- Un fichier d'instructions racine (type `CLAUDE.md`/`AGENTS.md`) chargé à chaque session d'assistant IA : stack, conventions, gotchas DB, charte sécurité, état des modules. **C'est la mémoire vivante du projet** — à tenir à jour à chaque décision structurante.
- Specs & plans détaillés versionnés dans `docs/` (un fichier design + un fichier plan par chantier).

---

## Annexe — Check-list de démarrage (ordre conseillé)

1. **Socle multi-tenant d'abord** : schémas `core` + métier, `organizations` / `organization_members` / `profiles`, RLS + vues `security_invoker=true`, helper d'auth edge functions. **Ne pas remettre la sécurité à plus tard** — la rétro-fitter coûte 10×.
2. **Auth + AuthContext** (org courante + rôles) + gardes de routes.
3. **Settings → Organization** (avant tout branding) : sans config org éditable, impossible d'onboarder une 2ᵉ entreprise.
4. **CRM clients + équipements** (fondation de tout le reste).
5. **Pipeline + Planning unifié** (le couple lead↔RDV est central).
6. **Devis / Contrats / Tarification** (valeurs figées à la signature).
7. **Entretiens + Certificats** (récurrence = cœur du business artisan).
8. **Mailing** (acquisition/rétention).
9. **Intégrations** (facturation, SEO, voix) — toutes conditionnelles par org.
10. **Portail client** + **PWA terrain**.

> **Leçon transverse** : partir des **frictions d'usage réelles** des utilisateurs métier (pas de la prouesse technique). Chaque module ci-dessus est né d'un besoin terrain concret, pas d'un plan d'architecture descendant.
