# CLAUDE.md - Majord'home Module Artisan

> **Dernière MàJ** : 2026-04-19 — Mailing : Segment Builder + Scheduler Campagnes Auto (catalogue `mail_segments` paramétrable + 1 cron N8n générique qui lit `mail_campaigns.is_automated`, `lead_bienvenue` migré comme 1ʳᵉ campagne). Docs : `docs/MAILING_SEGMENT_BUILDER.md` + `docs/n8n/MAILING_SCHEDULER_SETUP.md`.
> **Détails DB/composants/sprints** : `docs/DATABASE.md`, `docs/COMPONENTS.md`, `docs/SPRINT_LOG.md`

## Projet
Plateforme SaaS métier pour artisans du bâtiment (CVC). CRM, planning, pipeline commercial, outil terrain tablette, carte territoire. Pilote : **Mayer Énergie** (Gaillac, 81).

## Stack
- React 18 + Vite 5 + React Router 6
- Supabase (PostgreSQL + Auth + Storage)
- Tailwind CSS 3.4 + Radix UI
- TanStack React Query v5
- React Hook Form + Zod
- FullCalendar 6 (planning)
- Recharts (graphiques)
- Mapbox GL JS + react-map-gl + @turf/turf (carte territoire)
- Sonner (toasts), Lucide React (icons)
- N8N (webhooks, automatisations)

## Commandes
```bash
npm run dev      # Dev server (port 5173)
npm run build    # Build production
npm run lint     # ESLint
```

## Architecture
```
src/
├── main.jsx                    # Point d'entrée
├── App.jsx                     # Routes
├── lib/                        # supabaseClient, mapbox, territoire-config, serviceHelpers, phoneUtils, constants
├── contexts/AuthContext.jsx     # Auth + org + rôles
├── pages/                      # Pages publiques (Login, Reset)
├── components/
│   ├── ProtectedRoute.jsx
│   └── ui/                     # Radix UI (button, card, input, tabs, confirm-dialog...)
├── layouts/AppLayout.jsx       # Sidebar + header
├── hooks/pipeline/             # useDashboardData, useDashboardFilters
├── apps/artisan/
│   ├── routes.jsx              # Routes lazy-loaded (15 routes)
│   ├── pages/                  # Dashboard, Clients, ClientDetail (+ client-detail/Tab*.jsx), Pipeline, Planning, Chantiers, Entretiens, Territoire, InterventionDetail, Settings, Profile, Mailing
│   └── components/
│       ├── FormFields.jsx      # Composants formulaire partagés (FormField, TextInput, etc.)
│       ├── shared/             # KanbanBoard, SearchBar, ColumnHeader, CardSkeleton (composants génériques)
│       ├── clients/            # ClientModal+Tabs (4 onglets: Info/Contrat/Équipements/Historique), ClientCard, EquipmentList, EquipmentFormModal
│       # Note : ClientDetail a 6 onglets : Info/Contrat/Équipements/Interventions/Timeline/Mailings
│       ├── chantiers/          # ChantierKanban, ChantierCard, ChantierModal, ChantierOrderSection, ChantierInterventionSection
│       ├── entretiens/         # CreateContractModal+Steps, ContractModal, ContractsList, EntretiensDashboard
│       ├── pipeline/           # LeadModal+FormSections+StatusConfig, LeadKanban, LeadList, SchedulingPanel
│       ├── planning/           # EventModal+FormSections+Confirmations, TechnicianSelect, MiniWeekCalendar
│       └── territoire/         # TerritoireMap, MapControls, MapPopup, MapSearch, useMapZones, useTerritoireData
├── apps/prospection/
│   ├── _shared/
│   │   ├── lib/               # sireneApi, scoringCedants, scoringCommercial
│   │   ├── hooks/             # useSireneSearch
│   │   └── components/        # SearchSireneModal, ProspectTable, ProspectKPIs, ProspectFilters, ProspectDrawer
│   ├── cedants/               # config, CedantsPipeline
│   └── commercial/            # config, CommercialPipeline
└── shared/
    ├── services/               # auth, clients, contracts, chantiers, entretiens, geocoding, territoire, prospects, storage
    └── hooks/                  # cacheKeys, usePaginatedList, useDebounce, useModalManager + useClients, useContracts, useChantiers, useLeads, useAppointments, useProspects, etc.
```

## Aliases (vite.config.js)
`@` → `src/`, `@components`, `@pages`, `@layouts`, `@contexts`, `@lib`, `@services` → `src/shared/services`, `@hooks` → `src/shared/hooks`, `@hooksPipeline` → `src/hooks/pipeline`, `@apps`

## Base de Données (Supabase)

### Schémas
- **`core`** : profiles, organizations, organization_members
- **`majordhome`** : clients, equipments, interventions, leads, appointments, contracts, etc.
- **`public`** : vues qui exposent core/majordhome

### Pattern d'accès frontend
```javascript
// Tables avec vue publique → supabase.from('majordhome_clients')
// Tables sans vue → supabase.schema('majordhome').from('leads')
// TOUJOURS filtrer par org_id explicitement : .eq('org_id', orgId)
```

### Gotchas DB
- **Séquences PostgreSQL** : Ne JAMAIS calculer manuellement un ID/numéro via `SELECT MAX(col) + 1`. Toujours laisser le DEFAULT de la séquence DB (`nextval()`) générer la valeur — atomique, évite race conditions et désynchronisation. Exemple : `majordhome.client_number` utilise `majordhome.client_number_seq`, toute insertion doit omettre `client_number` pour que le DEFAULT s'applique.

### Vues publiques principales
- `majordhome_clients` → clients + has_active_contract calculé
- `majordhome_contracts` → contracts JOIN clients (client_name, client_address, etc.)
- `majordhome_appointments` → appointments + client_first_name, assigned_commercial_id
- `majordhome_chantiers` → leads filtrés (chantier_status IS NOT NULL) + JOIN equipment_type + intervention parent
- `majordhome_prospects` → prospects JOIN profiles (created_by_name, assigned_to_name)
- `majordhome_prospect_interactions` → interactions JOIN profiles (created_by_name)
- `majordhome_mailing_logs` → historique des emails envoyés par campagne (client_id, lead_id, campaign_name, subject, email_to, sent_at, status, provider_id, error_message, delivered_at, opened_at, clicked_at, bounced_at, complained_at, last_event_at, open_count, click_count)
- `majordhome_mailing_events` → audit log complet des events webhook Resend (1 ligne par event reçu, dédupliqué par svix_id)
- `majordhome_equipments`, `majordhome_interventions`, `majordhome_maintenance_visits`
- `profiles`, `organizations`, `organization_members` (vues core)

### Org cible
**Mayer Energie** : `org_id = 3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`

## Rôles & Permissions
| Rôle | Permissions |
|------|-------------|
| `org_admin` | Tout gérer |
| `team_leader` | Clients, planning, assignation |
| `user` (technicien) | Vue projets, rapports terrain |

```jsx
const { isOrgAdmin, isTeamLeaderOrAbove, canAccessPipeline } = useAuth();
// canAccessPipeline = isOrgAdmin OU business_role === 'Commercial'
```

## Conventions de Code

### Services (`src/shared/services/`)
- Pattern : `export const xxxService = { async method() {...} }`
- Retour : `{ data, error }` ou `{ data, count, error }`
- **`storage.service.js`** : Opérations Storage Supabase centralisées (`getSignedUrl`, `uploadFile`, `deleteFile`)
- **`serviceHelpers.js`** (`src/lib/`) : `withErrorHandling()`, `extractRpcResult()`, `getMajordhomeOrgId()`
- **`phoneUtils.js`** (`src/lib/`) : `cleanPhone()`, `formatPhoneForSearch()` (pour la recherche en base)

### Hooks (`src/shared/hooks/`)
- TanStack React Query v5
- **Cache keys centralisées** : `src/shared/hooks/cacheKeys.js` — source unique pour toutes les query keys
  - Import : `import { clientKeys } from '@/shared/hooks/cacheKeys'`
  - Familles : clientKeys, contractKeys, leadKeys, appointmentKeys, interventionKeys, chantierKeys, prospectKeys, pricingKeys, mailingKeys, pennylaneSyncKeys
  - Re-exports depuis chaque hook pour rétrocompatibilité
- **`usePaginatedList`** : Hook générique pour listes paginées (utilisé par useClients, useProspects)
- **`useDebounce`** : Hook utilitaire de debounce (remplace les implémentations manuelles)
- **`useModalManager`** : Gestion centralisée d'état de modales multiples
- **`usePennylaneSyncClient`** : Sync client MDH→Pennylane (fire-and-forget, ne bloque pas UX). Le code 411 Pennylane est récupéré et stocké dans `clients.pennylane_account_number`. Erreurs loggées silencieusement (`console.warn`). Cron `pennylane-sync-cron` : ne calcule JAMAIS `client_number` manuellement, laisse la séquence DB le générer (cf. Gotchas DB).
- Retournent : `{ data, isLoading, error, refetch, ...mutations }`

### Composants
- Fichiers .jsx, PascalCase
- Tailwind (pas de CSS modules)
- Toasts : `toast.success()`, `toast.error()`
- Routes lazy-loaded dans `src/apps/artisan/routes.jsx`
- **Composants formulaire partagés** : `src/apps/artisan/components/FormFields.jsx`
  - `FormField`, `TextInput`, `PhoneInput`, `SelectInput`, `TextArea`, `SectionTitle`
  - Exports : `inputClass`, `selectClass` (tokens `secondary-*`, `primary-*`)
- **Composants partagés** : `src/apps/artisan/components/shared/`
  - `KanbanBoard` : Board Kanban générique (DnD optionnel, colonnes configurables)
  - `SearchBar` : Barre de recherche avec icône et bouton clear
  - `ColumnHeader` : En-tête colonne Kanban (pastille + label + count + montant)
  - `CardSkeleton` : Skeleton de carte pour états de chargement
- **Utilitaires partagés** : `src/lib/utils.js`
  - `formatDateForInput` (Date|string → YYYY-MM-DD, timezone-safe)
  - `formatDateFR` (→ "1 janvier 2026"), `formatDateShortFR` (→ "1 janv. 2026")
  - `formatDateTimeFR`, `formatPhoneNumber`, `formatEuro`
  - `computeEndTime`, `computeDuration`
- **Constantes** : `src/lib/constants.js` — `DEFAULT_PAGE_SIZE`, `LARGE_PAGE_SIZE`, `KANBAN_PAGE_SIZE`

## Module Mailing

### Architecture
- **Page** : `src/apps/artisan/pages/Mailing.jsx` — Wrapper 3 onglets : **Envoi** (tous rôles) + **Segments** (admin only) + **Éditeur** (admin only)
- **Onglet Envoi** : `src/apps/artisan/components/mailing/SendTab.jsx` — sélecteur campagne + dropdown segment (depuis `mail_segments`) + carte d'identité + preview + envoi N8n
- **Onglet Segments** : `src/apps/artisan/components/mailing/SegmentsTab.jsx` — catalogue de segments réutilisables (presets + perso) avec CRUD via `SegmentBuilderDrawer.jsx`
- **Onglet Éditeur** : `src/apps/artisan/components/mailing/EditorTab.jsx` — liste cards + actions (Éditer / Dupliquer / Archiver) + wizard `CampaignWizard.jsx` (inclut bloc Automatisation)
- **Onglet client** : `src/apps/artisan/pages/client-detail/TabMailings.jsx` — Historique des mails + badges status + timeline events + compteurs opens/clics (polling 30s)
- **Tables** :
  - `majordhome.mail_campaigns` (key, label, subject, preheader, html_body, purpose, audience, tone, trigger_description, notes, blocks JSONB, tracking_type_value, **is_automated**, **auto_segment_id** FK, **auto_cadence_days**, **auto_cadence_minutes**, **auto_time_of_day**, **last_run_at**, **next_run_at**). Colonnes legacy `default_segment` / `allowed_segments` conservées (nullables) mais non utilisées par l'UI.
  - `majordhome.mail_segments` (catalogue de ciblages : name, description, audience='clients'|'leads', filters JSONB DSL, is_preset, is_archived). 7 presets seed : Tous / Contrat / Contrat actif / Contrat clos / Devis relance / Contacté relance / Nouveau bienvenue.
  - `majordhome.mailing_logs` (client_id, lead_id, org_id, campaign_name, subject, email_to, sent_at, status, provider_id, error_message, delivered_at, opened_at, clicked_at, bounced_at, complained_at, last_event_at, open_count, click_count)
  - `majordhome.mailing_events` (audit log complet, 1 ligne par event webhook reçu, dédupliqué par `svix_id` UNIQUE)
- **Colonne leads** : `status_changed_at` (timestamptz) — horodatage du passage dans le statut courant, mis à jour par trigger `WHEN (OLD.status_id IS DISTINCT FROM NEW.status_id)`. Reset à chaque changement de statut ; immuable sur correction de fiche (nom, email, etc.)
- **Vues** : `public.majordhome_mail_campaigns`, `public.majordhome_mail_segments`, `public.majordhome_mailing_logs`, `public.majordhome_mailing_events`
- **Services** : `mailCampaigns.service.js`, `mailSegments.service.js` (CRUD + compile/count/preview)
- **Hooks** : `useMailCampaigns`, `useMailSegments` (+ `useSegmentCount`, `useSegmentPreview`) via React Query
- **Cache keys** : `mailCampaignKeys`, `mailSegmentKeys`, `mailingKeys.byClient(clientId)`, `mailingKeys.byLead(leadId)`
- **RPCs** :
  - `public.mail_segment_compile(filters jsonb, campaign_name text, org_id uuid) RETURNS text` — compose le SELECT SQL depuis le DSL jsonb. SECURITY DEFINER, format() + quote_literal pour la safety.
  - `public.mail_segment_count(filters, campaign_name, org_id) RETURNS integer` — exécute COUNT(*) sur le SQL compilé
  - `public.mail_segment_preview(filters, campaign_name, org_id, limit) RETURNS TABLE(...)` — retourne les N premiers destinataires
  - `public.mail_campaigns_due() RETURNS TABLE(...)` — campagnes `is_automated=true AND next_run_at <= NOW()`, consommée par le scheduler N8n
  - `public.mail_campaign_mark_run(campaign_id) RETURNS timestamptz` — update `last_run_at=NOW()` + calcule `next_run_at` selon cadence
- **Constantes shared** :
  - `src/apps/artisan/components/mailing/segmentBuilder.constants.js` — audiences/housing/DPE/order_by + `buildEmptyFilters()` + `updateFilters()` (immutable path update)
  - `src/apps/artisan/components/mailing/resources.js` — 📌 caisse à outils URLs Mayer (CTA, services, blog, zones, contact). Source de vérité pour l'IA — à mettre à jour à chaque nouvelle ressource
- **Env** : `VITE_N8N_WEBHOOK_MAILING` → webhook N8n `POST /webhook/mayer-mailing`
- **Provider email** : Resend (API `https://api.resend.com/emails`) — bascule depuis Gmail le 2026-04-11
- **Edge function webhook** : `supabase/functions/resend-webhook/` (verify_jwt: false, Svix HMAC SHA256 via Web Crypto API, RPC atomique)
- **Edge function unsubscribe** : `supabase/functions/mailing-unsubscribe/` (verify_jwt: false, token HMAC SHA256 signé avec `RESEND_WEBHOOK_SECRET`, GET = page HTML confirmation + POST = one-click RFC 8058)
- **Edge function avis-redirect** : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/avis-redirect` — redirige vers fiche Google Reviews Mayer + tracke le clic via `?log_id=` (utilisée dans SMS et accessible aux mails)

### Segment Builder (onglet Segments)
Builder à facettes 4 blocs : **Population** (audience + base filters) / **Attributs** (géo, logement, équipement, source, Meta, tags, dates) / **Historique mailing** (exclure campagnes reçues, cooldown, engagement ouvert/cliqué) / **Preview** (count live + table 20 destinataires + tri/limite). Sauvegarde dans `mail_segments` avec jsonb filters. Voir DSL dans `docs/MAILING_SEGMENT_BUILDER.md` §3.

### Scheduler Campagnes Auto (workflow N8n générique)
1 workflow unique (toutes les 10 min) :
1. `HTTP POST /rpc/mail_campaigns_due` → liste campagnes éligibles
2. `Split In Batches` (1 à 1)
3. `HTTP POST /rpc/mail_segment_compile` → SQL dynamique du segment
4. `Code node` → build payload (+LIMIT 500 safety)
5. `HTTP POST /webhook/mayer-mailing` → workflow d'envoi existant
6. `HTTP POST /rpc/mail_campaign_mark_run` → update `last_run_at` + `next_run_at`

Setup complet : `docs/n8n/MAILING_SCHEDULER_SETUP.md`. `lead_bienvenue` est la 1ʳᵉ campagne branchée (cadence `auto_cadence_minutes=10`, ancien workflow dédié à désactiver après validation 24h).

### Éditeur de campagne (wizard 3 étapes)
1. **Identité** : libellé (clé technique auto-générée par slugify), Contexte (objectif, cible, notes), ton éditorial (5 choix + Autre), **bloc Automatisation** (toggle + choix `auto_segment_id` dans le catalogue + cadence jours OU minutes + heure d'envoi)
2. **Brief** : ligne éditoriale (textarea libre — l'IA structure les blocs elle-même), objet/preheader facultatifs (l'IA propose sinon)
3. **Génération** : prompt système copiable (inclut carte d'identité + brief + caisse à outils URLs + types de blocs disponibles + contraintes techniques) + JSON structuré + textarea HTML final + bouton Prévisualiser (iframe overlay)

**Workflow V1 (copier-coller)** : wizard → prompt copié → chat Claude → HTML généré → coller dans textarea (auto-extraction OBJET/PREHEADER depuis commentaire HTML en tête) → Sauvegarder. Validation : impossible de save/envoyer si subject vide.

**Vdef prévue** : remplacer l'étape 3 par appel API direct Anthropic au lieu du copier-coller.

### Workflow N8n : "Mayer - Mailing" (id: 1COgLUuiMtSq2sUq)
Moteur d'emailing générique piloté par webhook POST. Payload attendu :
```json
{
  "subject": "Objet du mail",
  "html_body": "<html>...{{SALUTATION}}...</html>",
  "segment_sql": "SELECT id, first_name, last_name, display_name, email FROM ...",
  "campaign_name": "Nom de la campagne",
  "org_id": "uuid",
  "recipient_type": "client|lead",
  "batch_size": 400,
  "test_email": "optionnel@test.fr"
}
```
- Le placeholder `{{SALUTATION}}` est remplacé par "Bonjour Prénom Nom," automatiquement
- En mode test (`test_email` rempli) : LIMIT 1 sur le SQL, envoi redirigé vers l'email de test
- `recipient_type` : `client` (défaut) ou `lead` — détermine si l'INSERT va dans `client_id` ou `lead_id`
- Noeud 6 `Resend Send` = HTTP Request POST `https://api.resend.com/emails` (credential `Header Auth` avec `Authorization: Bearer <RESEND_API_KEY>`), from = `Mayer Energie - Econ'Home <contact@mayer-energie.fr>`, reply_to identique
- Noeud 7 fait un INSERT dans `majordhome.mailing_logs` après chaque envoi, incluant `provider_id` (ID Resend) et `error_message` (si échec Resend). Si Resend renvoie un `id` → `status='sent'`, sinon `status='failed'`
- `onError: continueRegularOutput` sur le noeud 6 : la boucle ne casse pas en cas d'échec d'un destinataire, chaque échec est loggé avec son message

### Webhook Resend — tracking delivered / opened / clicked / bounced

Pipeline de tracking post-envoi alimenté par les events webhook Resend.

**Prérequis Resend Dashboard** :
- Domain `mayer-energie.fr` → Configuration → **Click Tracking** ON + **Open Tracking** ON
- Webhooks → Add Endpoint :
  - URL : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/resend-webhook`
  - Events : `email.sent`, `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`, `email.failed`, `email.delivery_delayed`
- Signing Secret `whsec_...` → Supabase → Edge Functions → Secrets → `RESEND_WEBHOOK_SECRET`

**Edge function `resend-webhook`** (`supabase/functions/resend-webhook/index.ts`) :
- `verify_jwt: false` — Resend ne passe pas de JWT, on valide par signature Svix
- **Vérification signature Svix** : HMAC SHA256 via Web Crypto API, format `{svix_id}.{svix_timestamp}.{body}`, tolérance timestamp 5 min (anti-replay), support rotation de secret (multiple v1 signatures)
- **Extraction timestamp event** : privilégie `data.open.timestamp` / `data.click.timestamp` / `data.bounce.timestamp` (date réelle de l'event) avant de fallback sur `data.created_at` (date d'envoi)
- Appelle la RPC `public.resend_apply_webhook_event(provider_id, event_type, event_at, svix_id, payload)` qui fait tout en 1 aller-retour DB

**RPC `public.resend_apply_webhook_event`** (PL/pgSQL, SECURITY DEFINER) :
- INSERT dans `mailing_events` (idempotent via `svix_id` UNIQUE → retries Resend sans effet de bord)
- UPDATE `mailing_logs` avec règles de priorité statut :
  - `sent` (1) < `delivered` (2) < `opened` (3) < `clicked` (4)
  - `bounced` / `complained` / `failed` = 100 (terminal, override tout)
  - Un event ne rétrograde jamais un statut supérieur
- `opened_at` / `clicked_at` via COALESCE (premier event seulement)
- `open_count` / `click_count` incrémentés à chaque event reçu
- `error_message` extrait de `payload->bounce->reason` / `payload->failed->reason`

**Flow complet** :
```
N8n (envoi) → INSERT mailing_logs (status='sent', provider_id)
              ↓
Resend      → email.sent, email.delivered (~1s)
              → webhook POST /functions/v1/resend-webhook
                → verify Svix signature
                → RPC resend_apply_webhook_event
                  → INSERT mailing_events (audit)
                  → UPDATE mailing_logs (status, delivered_at, last_event_at)
              ↓
User ouvre  → email.opened → opened_at, open_count++
User clique → email.clicked → clicked_at, click_count++
(ou Safe Links prefetch → counters peuvent être > 1 pour un seul vrai clic)
```

**Important — counters et Outlook/Hotmail** :
- Outlook/Hotmail Safe Links pré-fetch chaque lien pour scan de sécurité → chaque scan génère un `email.clicked`
- `click_count` peut atteindre 10-20+ pour un seul vrai clic utilisateur
- Afficher le compteur tel quel ou calculer un "unique click" via `mailing_events` (GROUP BY user agent / ip) selon le besoin
- Open Tracking marqué "Not Recommended" par Resend : faux négatifs (clients bloquant les images) + faux positifs (prefetching Apple Mail Privacy Protection)

**Idempotence** : chaque webhook Resend a un header `svix-id` UNIQUE stocké dans `mailing_events`. Les retries Resend (jusqu'à 5 tentatives sur 3 jours) sont dédupliqués naturellement.

### Désabonnement (opt-out RGPD)

Pipeline de désinscription conforme RFC 8058 avec plusieurs canaux.

**Colonnes DB** (sur `majordhome.clients` et `majordhome.leads`) :
- `email_unsubscribed_at TIMESTAMPTZ` — timestamp du désabonnement
- `email_unsubscribe_reason TEXT` — `user_request` | `list_unsubscribe_header` | `spam_complaint` | `manual`

**Edge function `mailing-unsubscribe`** (`supabase/functions/mailing-unsubscribe/index.ts`) :
- URL : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/mailing-unsubscribe`
- `verify_jwt: false`
- **GET `?token=xxx`** : page HTML de confirmation (design Mayer Énergie, responsive)
- **POST `?token=xxx`** : one-click RFC 8058 silencieux (body form-urlencoded supporté aussi)
- **Token signé HMAC SHA256** avec `RESEND_WEBHOOK_SECRET` (même secret que webhook, économie de config)
  - Format : `{rt}.{rid}.{exp}.{base64url_sig}` où `rt=c|l`, `rid=UUID`, `exp=epoch`
  - Expiration : 90 jours
  - Validation timestamp stricte pour éviter replay

**RPC `public.mailing_apply_unsubscribe(rt, rid, reason, ts)`** (PL/pgSQL, SECURITY DEFINER) :
- Update `clients.email_unsubscribed_at` (ou `leads.email_unsubscribed_at`)
- Idempotent : si déjà désabonné, retourne `already_unsubscribed=true` sans toucher au timestamp
- Retour JSON : `{ already_unsubscribed, rows_updated, recipient_type, recipient_id }`

**Workflow N8n** — génération du token dans le noeud `5. Personnaliser HTML` :
- Utilise `crypto.createHmac('sha256', keyBytes)` avec `$env.RESEND_WEBHOOK_SECRET` décodé depuis `whsec_<base64>`
- Remplace automatiquement le lien `mailto:?subject=Désabonnement` du footer HTML par l'URL edge function (regex sur les templates, aucune modif des templates)
- Expose `unsubscribeUrl` dans l'output pour le noeud 6

**Headers dans le noeud `6. Resend Send`** :
```json
"headers": {
  "List-Unsubscribe": "<https://.../mailing-unsubscribe?token=xxx>, <mailto:contact@mayer-energie.fr?subject=Désabonnement>",
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
}
```
→ Gmail / Outlook / Yahoo / Apple Mail affichent automatiquement le bouton natif "Se désabonner" en haut de l'email. Click = POST one-click vers l'edge function.

**Variable d'environnement N8n requise** : `RESEND_WEBHOOK_SECRET` (même valeur que le secret Supabase Edge Functions).

**Auto-unsubscribe sur spam complaint** : quand qqn clique "Signaler comme spam" dans Gmail/Outlook, Resend envoie `email.complained` → RPC `resend_apply_webhook_event` marque automatiquement `email_unsubscribed_at = NOW()` + `reason='spam_complaint'`. Respect immédiat du souhait utilisateur.

**Exclusion dans les segments** : les 7 segments de `Mailing.jsx` ont tous `AND email_unsubscribed_at IS NULL` (en plus du `mail_optin=true` manuel et du `email IS NOT NULL`). Triple filtre : opt-out manuel CRM + opt-out automatique webhook + email valide.

**UI fiche client** : bandeau orange "Client désabonné" en haut de `TabMailings.jsx` si `email_unsubscribed_at` est set. Affiche la date + la raison (lien, bouton natif, spam, manuel). Le client reste dans la base, juste exclu des campagnes.

### Templates campagnes (7)
| Template | Cible | Objet |
|----------|-------|-------|
| `mail_a` | Clients contrat actif | Information — Mayer Energie reprend le suivi |
| `mail_b` | Clients sans contrat | Offre Exclusive — reprise Econhome |
| `mail_c` | Clients contrat clos | Reconquête Info — ancien contrat |
| `mail_d` | Clients contrat clos | Offre Reconquête — retour client |
| `mail_e` | Leads Contacté | Relance Contacté — rappel à bon souvenir |
| `mail_f` | Leads Devis envoyé | Relance Devis — suivi devis + aides + prix |
| `mail_g` | Leads Perdu | Remerciement — ressources site web |

### Segments de ciblage (catalogue `mail_segments`, 8 presets seed)
| Segment preset | Audience | Description |
|----------------|----------|-------------|
| Tous les clients | clients | Tous actifs avec email + opt-in |
| Clients avec contrat (actif ou clos) | clients | ≥1 contrat `active` ou `cancelled` |
| Clients contrat actif | clients | ≥1 contrat `status='active'` |
| Clients contrat en attente | clients | ≥1 contrat `status='pending'` |
| Clients contrat clos | clients | `status='cancelled'` et aucun actif |
| Leads Devis envoyé — Relance | leads | Statut Devis envoyé, `quote_sent_date` entre 7-14j |
| Leads Contacté — Relance | leads | Statut Contacté, `status_changed_at` entre 7-14j |
| Leads Nouveau — Bienvenue | leads | Statut Nouveau (branché sur campagne `lead_bienvenue`) |

**Enum DB `contract_status`** : `active` / `pending` / `cancelled` (PAS d'`archived`).

Filtres par défaut sur tous les segments : `email_unsubscribed_at IS NULL`, `email IS NOT NULL`, `c.mail_optin=true` (clients), `c.is_archived=false` (clients), `l.is_deleted=false` (leads), `NOT IN mailing_logs WHERE campaign_name = <current>` (exclusion campagne courante).

L'utilisateur crée des segments personnalisés via **Mailing → Segments → Nouveau segment** (builder 4 blocs). Chaque segment est un jsonb DSL compilé en SQL par la RPC `mail_segment_compile`.

### Campagne automatique — Workflow générique
Toute campagne avec `is_automated = true` + `auto_segment_id` + cadence est déclenchée par le scheduler N8n "Mayer - Scheduler Campagnes Auto" (cron 10 min). `lead_bienvenue` est la 1ʳᵉ campagne (cadence `auto_cadence_minutes=10`, ancien workflow dédié à désactiver après validation 24h). Setup : `docs/n8n/MAILING_SCHEDULER_SETUP.md`.

### Tags mailing dans fiche lead
- Statut **Contacté** (display_order 2) : tag indigo "Mailing Relance" si campagne Contacté envoyée
- Statut **Devis envoyé** (display_order 4) : tag ambre "Mailing Relance Devis" si campagne Devis envoyée
- Tags en lecture seule, chargés depuis `mailing_logs` via `lead_id`
- La checkbox "Mail envoyé" reste manuelle (usage commercial)

### Compteur destinataires
Utilise la RPC `public.mail_segment_count(filters, campaign_name, org_id)` qui compile puis COUNT(*) en un seul aller-retour. Le résultat s'affiche en badge à côté du sélecteur de segment. Le toast et la confirmation utilisent le nombre réel de destinataires.

### Évolutions prévues
- ~~Migration Gmail → Resend~~ ✅ FAIT (2026-04-11)
- ~~Gestion erreurs/bounces dans mailing_logs~~ ✅ FAIT (colonnes `provider_id` + `error_message` + `status='failed'`)
- ~~Webhook Resend (ouvertures, clics, bounces, complaints)~~ ✅ FAIT (2026-04-11) — edge function `resend-webhook` + RPC atomique + table `mailing_events` + vérification Svix HMAC SHA256
- ~~TabMailings enrichi (badges, timeline, compteurs)~~ ✅ FAIT (2026-04-11) — 7 statuts avec icônes Lucide, timeline chronologique des events, stats header, polling 30s
- ~~Auto-cleanup email sur bounce Permanent~~ ✅ FAIT (2026-04-11) — RPC webhook vide `clients.email` sur hard bounce, ré-envois bloqués
- ~~Auto-archive clients injoignables~~ ✅ FAIT (2026-04-11) — si bounce Permanent + pas de phone + pas de contrat actif + pas d'intervention en cours
- ~~Désabonnement opt-out complet (List-Unsubscribe RFC 8058)~~ ✅ FAIT (2026-04-11) — edge function `mailing-unsubscribe`, bouton natif Gmail/Outlook, auto-unsubscribe sur spam complaint, bandeau UI fiche client
- Dashboard stats mailing (taux d'ouverture/clic/bounce par campagne) — nécessite requêtes d'agrégation sur `mailing_logs`
- "Unique click" : déduplication des clics via `mailing_events` (GROUP BY user_agent/ip) pour filtrer Safe Links Outlook
- Bouton "Désabonner manuellement" sur fiche client (UI-driven) — actuel : il faut passer par un UPDATE SQL ou attendre un event automatique
- Bouton "Réabonner" (undo) sur fiche client désabonnée — pour les cas où un client se désinscrit par erreur et veut revenir

## Module Certificats d'entretien (multi-équipements)

### Architecture
- **1 certificat par équipement** : interventions enfants (`parent_id` + `equipment_id`)
- **Parent** = carte Kanban (1 par contrat/client), **enfants** = 1 par équipement du contrat
- **Vue `majordhome_entretien_sav`** filtrée `parent_id IS NULL` (enfants exclus du Kanban et des stats)
- **Lazy create** : les enfants sont créés à la première ouverture de la modale si absents

### Composants
| Fichier | Rôle |
|---------|------|
| `CertificatsSection.jsx` | Section certificats extraite de EntretienSAVModal (equipments, lazy create, progress bar, liste) |
| `CertificatEquipmentRow.jsx` | Ligne équipement : statut (À faire/Rempli/Néant) + CTA Remplir/Voir/Néant |
| `useCertificatEntretien.js` | Hook React Query : `useCertificatChildren` + `useCertificatEntretienMutations` |

### Workflow
```
planifie → [Remplir certificats équipements] → realise → facture (hors Kanban)
```
- Transition `realise` automatique quand tous les enfants sont traités (rempli ou néant)
- `completeParentEntretien()` : transition parent + insert `maintenance_visit` (chaînage annuel)
- Bouton "Valider facturation" sur carte Kanban → carte disparaît
- `client_comment` (colonne `interventions`) : message pour le mail client

### PDF Certificat
- Logo Mayer Énergie + titre centré
- Signature technicien (nom = user connecté, non modifiable)
- TVA retirée, prochaine intervention en mois/année FR

### Fiche équipement
- Combobox marque/modèle : saisie libre + suggestions fournisseurs (`<input>` + `<datalist>`)

### Service methods (`sav.service.js`)
- `getChildInterventions(parentId)` — enfants + JOIN équipements
- `createChildInterventions(parentId, equipments, ctx)` — batch insert
- `markChildNeant(childId)` / `unmarkChildNeant(childId)` — NÉANT toggle
- `completeParentEntretien(parentId, orgId, reportNotes)` — clôture + maintenance_visit

## Module GeoGrid Rank Tracker

Suivi SEO local Google Maps via 2 modes de scan complémentaires :
- **Mode `grid`** : grille géographique régulière N×N (5×5/7×7/9×9) autour d'un centre — pour le maillage local fin (Gaillac et environs)
- **Mode `cities`** : 1 requête par commune du Tarn (filtrable par seuil population) — pour la visibilité départementale

### Stack
- **Edge function** : `supabase/functions/geogrid-scan/` (non versionnée localement, déployée seule via MCP). Accepte `mode: 'grid' | 'cities'` ; en mode cities reçoit un array `points: [{name, code, lat, lng}]`. Matching business utilise normalisation Unicode (lowercase + strip diacritiques)
- **API Google** : Places API (New) — `places.googleapis.com/v1/places:searchText`
- **Projet GCP** : `Towercontrol` (compte Google : `eric.pudebat@gmail.com`) — secret `GOOGLE_PLACES_API_KEY` côté Supabase Edge Functions
- **API communes Tarn** : `https://geo.api.gouv.fr/departements/81/communes` (gratuit, sans auth, INSEE) — cache LocalStorage 7 jours dans `communesService.js`
- **Free tier Google Places** : 5000 requêtes/mois UTC (reset 1er du mois 00:00 UTC). Au-delà : 27,75 €/1000 req (tranche 5k-100k)

### DB
- `majordhome.geogrid_scans` (colonnes : `scan_mode`, `keyword`, `business_name`, `place_id`, `center_lat/lng`, `radius_km`/`grid_size` nullables si mode='cities', `search_radius_m`, `stats` jsonb)
- `majordhome.geogrid_results` (1 ligne/point ; en mode cities : `point_label`=nom commune, `point_code`=code INSEE)
- Vue `public.majordhome_geogrid_scans` calcule `total_points` via COUNT des results — fonctionne quel que soit le mode

### Garde-fou app
`useGeoGridQuota(orgId)` calcule `SUM(total_points)` du mois courant en bornes UTC strictes (`Date.UTC(year, month, 1)`). Bouton "Lancer le scan" désactivé si projection > 5000 sauf override explicite via checkbox.

## Plan de Développement
| Sprint | Titre | Statut |
|--------|-------|--------|
| 0-5b | Auth, CRM, Planning, Terrain, Pipeline, Entretiens, Territoire | ✅ FAIT |
| 6 | Chantiers (Kanban post-vente, commandes, planification) + Dashboard réel + Planning multi-select | ✅ FAIT |
| 7 | Droits & Accès (permissions granulaires par rôle) | ✅ FAIT |
| P | Prospection (Cédants + Commercial, Screener SIRENE, Pipeline, Drawer) | ✅ FAIT |
| M | Mailing (Configurateur campagnes, mailing_logs, onglet Mailings fiche client) | ✅ FAIT |
| 8 | Portail Client | ⬜ À FAIRE |
| 9 | Intégration Pennylane (devis/factures) | ⬜ À FAIRE |
| 10 | N8N Avancé (Facebook Ads, Slack bidirectionnel) | ⬜ À FAIRE |
