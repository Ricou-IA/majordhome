# DATABASE.md - Schéma Supabase Majord'home

> **Dernière MàJ** : 2026-03-10 — Sprint 6 Chantiers (colonnes leads, vues, intervention_technicians)
> Ce fichier documente toutes les tables du schéma `majordhome` et les tables clés de `core`.

## Organisation cible
- **Mayer Energie** : `org_id = 3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`

## Schémas

| Schéma | Rôle |
|--------|------|
| `core` | Auth multi-tenant (profiles, organizations, organization_members, projects) |
| `majordhome` | Tables métier artisan |
| `public` | Vues proxy vers core/majordhome (accès frontend simplifié) |

## Vues publiques

| Vue publique | Table source | Usage frontend |
|---|---|---|
| `public.majordhome_clients` | `majordhome.clients` | `supabase.from('majordhome_clients')` — inclut `has_active_contract` (calculé) et `client_number` |
| `public.majordhome_client_activities` | `majordhome.client_activities` | `supabase.from('majordhome_client_activities')` |
| `public.majordhome_equipments` | `majordhome.equipments` | `supabase.from('majordhome_equipments')` |
| `public.majordhome_interventions` | `majordhome.interventions` | `supabase.from('majordhome_interventions')` |
| `public.majordhome_contracts` | `majordhome.contracts` JOIN `majordhome.clients` | `supabase.from('majordhome_contracts')` — vue enrichie avec client_name, client_address, client_postal_code, client_city, client_phone, client_email, client_project_id |
| `public.majordhome_contract_equipments` | `majordhome.contract_equipments` | `supabase.from('majordhome_contract_equipments')` — pivot contrat↔équipement |
| `public.majordhome_chantiers` | `majordhome.leads` (filtrés) + JOINs | `supabase.from('majordhome_chantiers')` — leads avec chantier_status IS NOT NULL + equipment_type_label + intervention parent |
| `public.majordhome_intervention_slots` | `majordhome.interventions` (enfants) | `supabase.from('majordhome_intervention_slots')` — slots intervention + techniciens agrégés JSON |
| `public.majordhome_intervention_technicians` | `majordhome.intervention_technicians` | `supabase.from('majordhome_intervention_technicians')` — junction intervention↔team_members |
| `public.majordhome_maintenance_visits` | `majordhome.maintenance_visits` | `supabase.from('majordhome_maintenance_visits')` — visites de maintenance |
| `public.projects` | `core.projects` | Legacy — ne plus utiliser pour les clients |
| `public.profiles` | `core.profiles` | Profils utilisateurs |
| `public.organizations` | `core.organizations` | Organisations |

---

## Tables core

### core.profiles
Source de vérité pour les rôles utilisateurs.
- `id` (uuid, PK) — match auth.users.id
- `app_role` (text) — org_admin, team_leader, user
- `business_role` (text) — Commercial, Technicien, etc.
- `first_name`, `last_name`, `avatar_url`

### core.organizations
- `id` (uuid, PK)
- `name`, `slug` (unique)
- `owner_id` (uuid → auth.users)

### core.organization_members
Liaison users ↔ organizations.
- `org_id` (uuid → organizations) — ⚠️ PAS `organization_id`
- `user_id` (uuid → auth.users) — ⚠️ PAS `profile_id`
- `role` (text) — owner, admin, member

### core.projects
Legacy clients. Conservé pour les FK existantes (equipments, interventions, etc.).
- `id` (uuid, PK)
- `org_id` (uuid → organizations)
- `name` (text) — display_name du client
- `identity` (jsonb) — ancien stockage client (first_name, last_name, address, etc.)

---

## Tables majordhome — Clients (Sprint 1)

### majordhome.clients ⭐
Table principale des clients CRM. 3393 rows. RLS activé (4 policies).

| Colonne | Type | Nullable | Default | Notes |
|---------|------|----------|---------|-------|
| `id` | uuid | NO | gen_random_uuid() | PK |
| `project_id` | uuid | NO | — | FK → core.projects (UNIQUE, lien 1:1) |
| `org_id` | uuid | NO | — | FK → core.organizations |
| `first_name` | text | YES | — | |
| `last_name` | text | YES | — | |
| `display_name` | text | NO | — | Toujours rempli |
| `company_name` | text | YES | — | |
| `email` | text | YES | — | |
| `phone` | text | YES | — | |
| `phone_secondary` | text | YES | — | |
| `address` | text | YES | — | |
| `address_complement` | text | YES | — | |
| `postal_code` | text | YES | — | |
| `city` | text | YES | — | |
| `country` | text | YES | 'France' | |
| `housing_type` | ENUM housing_type | YES | — | maison, appartement, local_commercial, immeuble, autre |
| `surface` | numeric | YES | — | m² |
| `floor_count` | integer | YES | — | |
| `construction_year` | integer | YES | — | |
| `dpe_number` | text | YES | — | N° ADEME DPE |
| `dpe_rating` | char(1) | YES | — | A-G |
| `access_instructions` | text | YES | — | Instructions d'accès pour technicien |
| `client_category` | ENUM client_category | NO | 'particulier' | particulier, entreprise |
| `client_number` | text | NO | auto (CLI-XXXXX) | Numéro séquentiel unique, auto-généré |
| `lead_source` | text | YES | — | website, phone, walk_in, etc. |
| `tags` | text[] | YES | '{}' | Tags libres |
| `is_reliable` | boolean | YES | — | Client fiable |
| `import_source` | text | YES | — | Source d'import (ex: migration_projects) |
| `notes` | text | YES | — | Notes client visibles |
| `internal_notes` | text | YES | — | Notes internes (non client) |
| `siren` | varchar(20) | YES | — | Numéro SIREN (entreprises) |
| `created_by` | uuid | YES | — | FK → core.profiles |
| `created_at` | timestamptz | NO | now() | |
| `updated_at` | timestamptz | NO | now() | Trigger auto |
| `is_archived` | boolean | NO | false | |
| `archived_at` | timestamptz | YES | — | |

**Index** : org_id, project_id (unique), client_category, postal_code, city, client_number (unique), email, phone, **GIN full-text search** (french: display_name + email + phone + city)

**FK sortantes** : project_id → core.projects, org_id → core.organizations, created_by → core.profiles
**FK entrantes** : client_activities.client_id → clients.id

### majordhome.client_activities ⭐
Timeline auto-alimentée. 3393 rows (1 event `client_created` par client migré). RLS activé (3 policies).

| Colonne | Type | Nullable | Default | Notes |
|---------|------|----------|---------|-------|
| `id` | uuid | NO | gen_random_uuid() | PK |
| `client_id` | uuid | NO | — | FK → clients |
| `org_id` | uuid | NO | — | FK → organizations |
| `activity_type` | ENUM activity_type | NO | — | 20 valeurs (note, phone_call, email_sent, intervention_completed, etc.) |
| `title` | text | NO | — | |
| `description` | text | YES | — | |
| `reference_type` | text | YES | — | intervention, appointment, equipment, invoice, quote |
| `reference_id` | uuid | YES | — | UUID de l'entité liée |
| `metadata` | jsonb | YES | '{}' | Données complémentaires |
| `created_by` | uuid | YES | — | FK → core.profiles |
| `is_system` | boolean | NO | false | Événement auto vs manuel |
| `is_pinned` | boolean | NO | false | Épinglé en haut |
| `created_at` | timestamptz | NO | now() | |

**Index** : client_id, org_id, activity_type, created_at DESC, reference (type + id)

### majordhome.contracts ⭐
Table contrats d'entretien (1 client = max 1 contrat). RLS activé.

| Colonne | Type | Nullable | Default | Notes |
|---------|------|----------|---------|-------|
| `id` | uuid | NO | gen_random_uuid() | PK |
| `org_id` | uuid | NO | — | FK → core.organizations |
| `client_id` | uuid | NO | — | FK → majordhome.clients (UNIQUE, 1:1) |
| `contract_number` | text | NO | auto (CTR-XXXXX) | Numéro séquentiel unique |
| `status` | ENUM contract_status | NO | 'active' | active, pending, expired, cancelled |
| `frequency` | ENUM contract_frequency | YES | 'annuel' | mensuel, trimestriel, semestriel, annuel, biannuel |
| `start_date` | date | YES | — | |
| `end_date` | date | YES | — | |
| `renewal_date` | date | YES | — | |
| `next_maintenance_date` | date | YES | — | |
| `amount` | numeric(10,2) | YES | — | Montant du contrat |
| `notes` | text | YES | — | |
| `created_at` | timestamptz | NO | now() | |
| `updated_at` | timestamptz | NO | now() | |

**Index** : org_id, client_id (unique), status
**Séquence** : `majordhome.contract_number_seq` → format CTR-XXXXX (trigger `set_contract_number`)

### majordhome.contract_equipments
Table pivot contrats ↔ équipements. Un contrat couvre N équipements.

| Colonne | Type | Nullable | Default | Notes |
|---------|------|----------|---------|-------|
| `id` | uuid | NO | gen_random_uuid() | PK |
| `contract_id` | uuid | NO | — | FK → contracts (ON DELETE CASCADE) |
| `equipment_id` | uuid | NO | — | FK → equipments (ON DELETE CASCADE) |
| `created_at` | timestamptz | NO | now() | |

**Contrainte unique** : (contract_id, equipment_id)

### majordhome.maintenance_visits
Table visites de maintenance annuelles. 493 rows. Upsert sur (contract_id, visit_year).

| Colonne | Type | Nullable | Default | Notes |
|---------|------|----------|---------|-------|
| `id` | uuid | NO | gen_random_uuid() | PK |
| `contract_id` | uuid | YES | — | FK → contracts (ON DELETE CASCADE). Nouvelles visites utilisent cette colonne. |
| `legacy_contract_id_int` | integer | YES | — | Ancien FK integer vers pending_contracts (conservé pour audit, 493 rows legacy) |
| `org_id` | uuid | YES | — | FK → core.organizations |
| `visit_year` | integer | NO | — | Année de la visite |
| `visit_date` | date | YES | — | Date effective |
| `status` | text | YES | 'pending' | completed, pending, skipped, cancelled |
| `technician_id` | uuid | YES | — | FK → auth.users |
| `technician_name` | text | YES | — | |
| `notes` | text | YES | — | |
| `created_by` | uuid | YES | — | FK → auth.users |
| `created_at` | timestamptz | NO | now() | |
| `updated_at` | timestamptz | NO | now() | |

**Contrainte unique** : (contract_id, visit_year)
**Index** : contract_id, org_id

### Vue majordhome_contracts — Colonnes enrichies (JOIN clients)
La vue `public.majordhome_contracts` inclut toutes les colonnes de `contracts` plus des colonnes client JOINées :
```sql
-- Colonnes ajoutées par le JOIN
cl.display_name AS client_name,
cl.address AS client_address,
cl.postal_code AS client_postal_code,
cl.city AS client_city,
cl.phone AS client_phone,
cl.email AS client_email,
cl.project_id AS client_project_id
```

### Vue majordhome_clients — Colonne calculée has_active_contract
La vue `public.majordhome_clients` inclut une colonne calculée :
```sql
EXISTS (SELECT 1 FROM majordhome.contracts c WHERE c.client_id = clients.id AND c.status = 'active') AS has_active_contract
```

---

## Tables majordhome — Équipements & Interventions

### majordhome.equipments
897 rows. RLS activé. Parc équipements CVC des clients.

| Colonne clé | Type | Notes |
|-------------|------|-------|
| `id` | uuid | PK |
| `project_id` | uuid | FK → core.projects (⚠️ pas clients.id) |
| `category` | ENUM equipment_category | pac_air_air, pac_air_eau, chaudiere_gaz/fioul/bois, vmc, climatisation, chauffe_eau_thermo, ballon_ecs, poele, autre |
| `brand`, `model`, `serial_number` | text | Identité équipement |
| `install_date` | date | |
| `warranty_end_date` | date | |
| `maintenance_frequency_months` | int | Default 12 |
| `last_maintenance_date` | date | |
| `next_maintenance_due` | date | |
| `contract_type`, `contract_tarif`, `contract_start_date`, `contract_status` | mixed | Contrat entretien |
| `status` | ENUM equipment_status | active, maintenance_due, under_repair, decommissioned |
| `notes` | text | |

### majordhome.interventions
2411 rows. RLS activé. Historique interventions techniciens + interventions chantier (Sprint 6).

| Colonne clé | Type | Notes |
|-------------|------|-------|
| `id` | uuid | PK |
| `project_id` | uuid | FK → core.projects |
| `equipment_id` | uuid | FK → equipments (nullable) |
| `lead_id` | uuid | FK → leads (nullable, Sprint 6) — lien chantier |
| `parent_id` | uuid | FK → interventions self (nullable, Sprint 6) — slots enfants |
| `intervention_type` | ENUM | maintenance, repair, installation, diagnostic, urgent |
| `scheduled_date` | date | |
| `slot_date` | date | Date du slot (Sprint 6) |
| `slot_start_time` | time | Heure début slot (Sprint 6) |
| `slot_end_time` | time | Heure fin slot (Sprint 6) |
| `slot_notes` | text | Notes du slot (Sprint 6) |
| `technician_id` | uuid | FK → auth.users |
| `technician_name` | text | |
| `status` | ENUM | scheduled, in_progress, completed, cancelled, no_show |
| `report_notes`, `work_performed` | text | Rapport |
| `parts_replaced` | jsonb | [] |
| `photo_before_url`, `photo_after_url` | text | |
| `signature_url` | text | Signature client |
| `duration_minutes` | int | |

**Index Sprint 6** : `idx_interventions_parent_id` (parent_id), `idx_interventions_lead_id` (lead_id)

---

## Tables majordhome — Planning

### majordhome.appointments
0 rows. RLS activé avec 4 policies (SELECT/INSERT/UPDATE/DELETE org_member). 51 colonnes.

| Colonne clé | Type | Notes |
|-------------|------|-------|
| `id` | uuid | PK |
| `org_id` | uuid | FK → majordhome.organizations |
| `lead_id` | uuid | FK nullable → majordhome.leads (lien pipeline → planning) |
| `client_id` | uuid | FK nullable → majordhome.clients (lien direct client) |
| `client_name`, `client_phone`, `client_email` | text | Coordonnées dénormalisées |
| `address`, `postal_code`, `city` | text | Lieu |
| `scheduled_date` | date | |
| `scheduled_start`, `scheduled_end` | time | |
| `duration_minutes` | int | Default 60 |
| `appointment_type` | text | Default 'intervention' |
| `status` | text | Default 'scheduled' |
| `google_event_id`, `google_calendar_id`, `google_synced_at` | text/timestamptz | Sync Google Calendar |
| `slack_message_ts`, `slack_channel_id` | text | Notifications Slack |
| `is_recurring`, `recurrence_rule`, `parent_appointment_id` | mixed | Récurrence |

### majordhome.appointment_technicians
Table pivot appointments ↔ team_members.
- `appointment_id` → appointments, `technician_id` → team_members
- `google_event_id`, `notified`, `confirmed`, `actual_start/end_time`

### majordhome.intervention_technicians
Table pivot interventions ↔ team_members (Sprint 6 Chantiers).
- `id` (uuid, PK)
- `intervention_id` (uuid, FK → interventions ON DELETE CASCADE)
- `technician_id` (uuid, FK → team_members ON DELETE CASCADE)
- `created_at` (timestamptz)
- Contrainte UNIQUE (intervention_id, technician_id)
- RLS activé, 1 policy (`allow_authenticated`)

### majordhome.team_members
3 rows (1 désactivé). Techniciens de l'organisation.
- `org_id`, `first_name`, `last_name`, `display_name` (generated)
- `role` (default 'technician'), `specialties` (text[])
- `calendar_color`, `google_calendar_id`, `google_calendar_email`
- `default_availability` (jsonb) — horaires par jour
- `slack_user_id`

---

## Tables majordhome — Pipeline

### majordhome.leads
27 rows. Pipeline CRM + Chantiers post-vente.
- 30+ colonnes : identité, contact, adresse, source_id, status_id, assigned_user_id, project_id, client_id
- `order_amount_ht`, `estimated_revenue`, `probability` (0-100)
- `next_action`, `next_action_date`, `lost_reason`
- `appointment_id` uuid FK nullable → majordhome.appointments (lien retour RDV planifié)
- `appointment_date`, `quote_sent_date`, `won_date` (dates pipeline)
- `external_id/source/data` (intégrations N8N)
- **Colonnes chantier (Sprint 6)** :
  - `chantier_status` TEXT CHECK (gagne, commande_a_faire, commande_recue, planification, realise, facture)
  - `equipment_order_status` TEXT CHECK (na, commande, recu)
  - `materials_order_status` TEXT CHECK (na, commande, recu)
  - `estimated_date` DATE — date estimative pose
  - `planification_date` DATE — date passage en planification (auto-set)
  - `chantier_notes` TEXT
- Index : `idx_leads_chantier_status` (org_id, chantier_status) WHERE chantier_status IS NOT NULL

### majordhome.sources (8 rows)
id, name, description, color, is_active

### majordhome.statuses (8 rows)
id, label (unique), display_order, color, is_final, is_won

### majordhome.lead_activities
Historique activités leads (status_change, note, etc.)

### majordhome.monthly_source_costs
Coûts pub mensuels par source (ROI)

---

## Tables majordhome — Autres

### majordhome.service_requests (0 rows)
Tickets SAV. `project_id`, `equipment_id`, `request_type` (ENUM), `status` (ENUM), `priority` (ENUM)

### majordhome.pending_contracts — ❌ SUPPRIMÉE
Ancienne table contrats legacy importés. Remplacée par `majordhome.contracts` + `majordhome.contract_equipments`.
Les 789 clients qui avaient `has_contract=true` ont été migrés vers la table `contracts`.

### majordhome.home_details (3393 rows)
Details logement. `project_id` (PK), `property_type`, `qr_code_id` (unique), `qr_status`

---

## Migrations appliquées (Majord'home)

| Version | Nom | Date |
|---------|-----|------|
| 20260220034135 | create_clients_table | 2026-02-20 |
| 20260220034204 | create_client_activities_table | 2026-02-20 |
| 20260220034224 | migrate_clients_from_projects | 2026-02-20 |
| 20260220034238 | create_clients_public_view | 2026-02-20 |
| ... | client_category + is_archived | 2026-02-22 |
| ... | prepare_contracts_drop_view_and_columns | 2026-02-23 |
| ... | create_contracts_views_rls_and_client_view | 2026-02-23 |
| ... | enrich_contracts_view_with_client_info | 2026-02-23 |
| ... | fix_maintenance_visits_contract_id_to_uuid | 2026-02-23 |
| ... | create_maintenance_visits_view | 2026-02-23 |
| ... | add_chantier_columns_to_leads | 2026-03-10 |
| ... | add_intervention_chantier_columns | 2026-03-10 |
| ... | create_chantier_views | 2026-03-10 |
| ... | add_planification_date_to_leads | 2026-03-10 |

## Notes RLS

### Tables avec RLS + policies ✅
- `majordhome.clients` (4 policies : select, insert, update, delete via org_members)
- `majordhome.client_activities` (3 policies : select, insert, update via org_members)
- `majordhome.equipments`, `majordhome.interventions`
- `majordhome.leads`, `majordhome.sources`, `majordhome.statuses`

### Tables avec RLS SANS policies ⚠️
- `majordhome.appointments` — à traiter Sprint 2
- `majordhome.team_members` — à traiter Sprint 2
- `majordhome.organizations`

### Tables SANS RLS ❌
- `majordhome.service_requests`, `majordhome.conversations`, `majordhome.messages`
- `majordhome.home_details`, `majordhome.dpe_data`, `majordhome.project_access`
- `majordhome.appointment_technicians`, `majordhome.user_profiles`
