# Mailing — Segment Builder + Campagnes automatiques

> Plan d'implémentation — refonte du ciblage mailing (idéation 2026-04-19).
> Objectif : remplacer les 9 segments SQL figés de `src/apps/artisan/components/mailing/segments.js` par un **builder à facettes** alimentant un catalogue de segments nommés (`mail_segments`), réutilisables en envoi manuel et en campagne automatique planifiée via un cron N8n générique.

## 1. Vue d'ensemble

### Problème actuel
- 9 segments SQL hardcodés, non composables
- Exclusions via `ILIKE '%Contacté%'` → bloque toute 2ᵉ campagne sur un statut
- Pas de preview des destinataires avant envoi
- Données riches non exploitées : `mailing_logs` (opens/clicks), `meta_campaign_id`, `tags[]`, `dpe_rating`, `housing_type`, `lead_activities`…

### Solution
1. **Catalogue `mail_segments`** (jsonb filters) + **compiler SQL RPC**
2. **UI builder à facettes** (4 blocs) + onglet dédié "Segments"
3. **Campagnes automatiques** : `mail_campaigns` étendue (`is_automated`, `auto_segment_id`, `auto_cadence_days`, `last_run_at`, `next_run_at`) + 1 cron N8n unique
4. **`leads.status_changed_at`** : trigger pour connaître depuis quand un lead est dans son statut courant (reset à chaque transition)

### Objectifs fonctionnels
- Je compose un segment → je le sauvegarde → je l'utilise en envoi manuel OU je le branche sur une campagne auto cron
- Exemples cible : "Relance Devis J+7", "Relance Contacté J+7", "Bienvenue Nouveau lead" (existant), "Clients DPE E/F chauffage gaz"

## 2. Migration DDL

### 2.1. Table `majordhome.mail_segments`
```sql
CREATE TABLE majordhome.mail_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES core.organizations(id),
  name text NOT NULL,
  description text,
  audience text NOT NULL CHECK (audience IN ('clients', 'leads')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_archived boolean NOT NULL DEFAULT false,
  is_preset boolean NOT NULL DEFAULT false,  -- segments pré-chargés (non supprimables)
  created_by uuid REFERENCES core.profiles(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mail_segments_org ON majordhome.mail_segments(org_id) WHERE is_archived = false;
CREATE INDEX idx_mail_segments_audience ON majordhome.mail_segments(org_id, audience);

-- Vue publique exposée au frontend
CREATE VIEW public.majordhome_mail_segments AS
SELECT s.*, p.full_name AS created_by_name
FROM majordhome.mail_segments s
LEFT JOIN core.profiles p ON p.id = s.created_by;

GRANT SELECT ON public.majordhome_mail_segments TO authenticated;
```

RLS : `org_id = (auth.jwt() ->> 'org_id')::uuid` (pattern standard).

### 2.2. Extension `majordhome.mail_campaigns`
```sql
ALTER TABLE majordhome.mail_campaigns
  ADD COLUMN is_automated boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_segment_id uuid REFERENCES majordhome.mail_segments(id) ON DELETE SET NULL,
  ADD COLUMN auto_cadence_days integer,
  ADD COLUMN auto_time_of_day time NOT NULL DEFAULT '09:00',
  ADD COLUMN last_run_at timestamptz,
  ADD COLUMN next_run_at timestamptz;

CREATE INDEX idx_mail_campaigns_cron
  ON majordhome.mail_campaigns(next_run_at)
  WHERE is_automated = true AND next_run_at IS NOT NULL;
```

Pour `lead_bienvenue` existant (à créer une fois la migration appliquée) : `is_automated=true`, `auto_cadence_days=null` (cadence sous-jour, géré différemment), `next_run_at=NOW() + interval '10 min'`. Voir §6 pour la stratégie cron.

### 2.3. Colonne `majordhome.leads.status_changed_at`
```sql
ALTER TABLE majordhome.leads
  ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT NOW();

-- Trigger : mise à jour UNIQUEMENT sur changement de status_id
CREATE OR REPLACE FUNCTION majordhome.fn_leads_status_changed()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.status_changed_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leads_status_changed
  BEFORE UPDATE ON majordhome.leads
  FOR EACH ROW
  WHEN (OLD.status_id IS DISTINCT FROM NEW.status_id)
  EXECUTE FUNCTION majordhome.fn_leads_status_changed();

-- Backfill des leads existants (dernière transition vers le status courant)
UPDATE majordhome.leads l SET status_changed_at = COALESCE(
  (SELECT MAX(la.created_at)
   FROM majordhome.lead_activities la
   WHERE la.lead_id = l.id AND la.new_status_id = l.status_id),
  l.created_at
);

CREATE INDEX idx_leads_status_changed ON majordhome.leads(status_id, status_changed_at);
```

Comportement : seule la modification de `status_id` reset l'horodatage. Les corrections de nom/email/etc. n'y touchent pas.

### 2.4. Seed des 6 presets initiaux
```sql
INSERT INTO majordhome.mail_segments (org_id, name, description, audience, filters, is_preset) VALUES
(
  '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1',
  'Tous les clients',
  'Tous les clients actifs avec email valide et opt-in',
  'clients',
  '{"base":{"kind":"all"},"attributes":{},"mailing_history":{"exclude_current_campaign":true}}',
  true
),
(
  '3c68193e-...',
  'Clients avec contrat (actif ou clos)',
  'Clients ayant au moins un contrat, quelle que soit sa situation',
  'clients',
  '{"base":{"kind":"has_contract","statuses":["active","cancelled","archived"]},"attributes":{},"mailing_history":{"exclude_current_campaign":true}}',
  true
),
(
  '3c68193e-...',
  'Clients contrat actif',
  'Clients avec au moins un contrat en cours',
  'clients',
  '{"base":{"kind":"has_contract","statuses":["active"]},"attributes":{},"mailing_history":{"exclude_current_campaign":true}}',
  true
),
(
  '3c68193e-...',
  'Clients contrat clos',
  'Clients avec contrat cancelled/archived et aucun actif',
  'clients',
  '{"base":{"kind":"has_contract","statuses":["cancelled","archived"],"exclude_with_active":true}}',
  true
),
(
  '3c68193e-...',
  'Leads Devis envoyé — Relance',
  'Leads "Devis envoyé" dont le devis a été envoyé il y a 7 à 14 jours',
  'leads',
  '{"base":{"kind":"lead_status","status_ids":["47937391-5ffa-4804-9b5d-72f3fec6f4fe"],"days_since_quote_min":7,"days_since_quote_max":14},"mailing_history":{"exclude_current_campaign":true,"exclude_within_days":30}}',
  true
),
(
  '3c68193e-...',
  'Leads Contacté — Relance',
  'Leads "Contacté" depuis 7 à 14 jours',
  'leads',
  '{"base":{"kind":"lead_status","status_ids":["4b1b967d-1c70-4510-8095-60a27e20e244"],"days_in_status_min":7,"days_in_status_max":14},"mailing_history":{"exclude_current_campaign":true,"exclude_within_days":30}}',
  true
);
```

Migration des 3 segments spécifiques existants (`clients_offre_combustible`, `leads_nouveau` = pour lead_bienvenue, etc.) : à décider au cas par cas lors de l'implémentation.

## 3. DSL des filtres (jsonb)

```typescript
type SegmentFilters = {
  audience: 'clients' | 'leads';
  base: {
    // Clients
    kind?: 'all' | 'has_contract' | 'no_contract';
    statuses?: ('active' | 'cancelled' | 'archived')[];
    exclude_with_active?: boolean;
    // Leads
    kind?: 'lead_status';
    status_ids?: string[];                  // multi-statuts
    days_in_status_min?: number;            // via status_changed_at
    days_in_status_max?: number;
    days_since_quote_min?: number;          // via quote_sent_date
    days_since_quote_max?: number;
    days_since_appointment_min?: number;
    days_since_appointment_max?: number;
  };
  attributes?: {
    cities?: string[];
    postal_codes?: string[];
    zones?: string[];
    equipment_type_ids?: string[];          // via contract_equipments (clients) / leads.equipment_type_id
    housing_types?: ('maison'|'appartement'|'local_commercial'|'immeuble'|'autre')[];
    dpe_ratings?: ('A'|'B'|'C'|'D'|'E'|'F'|'G')[];
    surface_min?: number;
    construction_year_max?: number;
    lead_sources?: string[];
    source_ids?: string[];                  // leads
    meta_campaign_ids?: string[];           // leads — filtrer par pub Meta
    assigned_user_ids?: string[];           // leads
    estimated_revenue_min?: number;
    created_between?: { from?: string; to?: string };
    tags_any?: string[];                    // clients.tags ARRAY
    tags_all?: string[];
  };
  mailing_history?: {
    exclude_current_campaign?: boolean;     // default true
    exclude_campaigns?: string[];           // campaign_name[]
    exclude_within_days?: number;           // n'a pas reçu CES campagnes depuis N jours
    cooldown_any_campaign_days?: number;    // n'a rien reçu du tout depuis N jours
    include_opened_campaign?: string;       // a ouvert cette campagne
    include_clicked_campaign?: string;      // a cliqué cette campagne
  };
  limits?: {
    max?: number;
    order_by?: 'recency_desc' | 'recency_asc' | 'city' | 'random';
  };
};
```

## 4. RPC compiler

```sql
CREATE OR REPLACE FUNCTION public.mail_segment_compile(
  p_filters jsonb,
  p_campaign_name text DEFAULT NULL,
  p_org_id uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, majordhome
AS $$
DECLARE
  v_audience text;
  v_sql text;
  v_where text := '';
  -- ...
BEGIN
  v_audience := p_filters->>'audience';

  IF v_audience = 'clients' THEN
    v_sql := 'SELECT DISTINCT c.id, c.first_name, c.last_name, c.display_name, c.email '
          || 'FROM majordhome.clients c ';
    -- JOIN conditionnels (contracts, equipments, etc.) + WHERE composé depuis filters
  ELSIF v_audience = 'leads' THEN
    v_sql := 'SELECT DISTINCT l.id, l.first_name, l.last_name, l.first_name AS display_name, l.email '
          || 'FROM majordhome.leads l ';
  ELSE
    RAISE EXCEPTION 'Invalid audience: %', v_audience;
  END IF;

  -- Hard filters (systématiques)
  v_where := 'email_unsubscribed_at IS NULL AND email IS NOT NULL AND email != ''''';

  -- Composition dynamique depuis p_filters...
  -- (opt-in, is_archived, base, attributes, mailing_history)

  RETURN v_sql || 'WHERE ' || v_where || ' ORDER BY ...';
END;
$$;

GRANT EXECUTE ON FUNCTION public.mail_segment_compile(jsonb, text, uuid) TO authenticated, service_role;
```

**Principes** :
- Retourne une **string SQL** (pas d'exécution) → injectée dans webhook N8n `segment_sql`
- `p_campaign_name` substitué pour `exclude_current_campaign` (actuellement via `{{CAMPAIGN_NAME}}`)
- Signature idempotente → même input = même SQL
- Couverture complète de `SegmentFilters` (tests unitaires via `execute_sql`)

### RPC `mail_segment_count`
Variante qui exécute directement le COUNT(*) du segment compilé → remplace l'appel à `exec_sql` actuel pour le compteur UI.

```sql
CREATE FUNCTION public.mail_segment_count(p_filters jsonb, p_campaign_name text, p_org_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_sql text; v_count integer;
BEGIN
  v_sql := 'SELECT COUNT(*) FROM (' || public.mail_segment_compile(p_filters, p_campaign_name, p_org_id) || ') t';
  EXECUTE v_sql INTO v_count;
  RETURN v_count;
END; $$;
```

## 5. Frontend

### 5.1. Services
- **`src/shared/services/mailSegments.service.js`** (nouveau)
  - `list(orgId)`, `get(id)`, `create({name, description, audience, filters})`, `update(id, patch)`, `archive(id)`, `duplicate(id)`
  - `compile(filters, campaignName)` → appelle RPC `mail_segment_compile`
  - `count(filters, campaignName, orgId)` → appelle RPC `mail_segment_count`
  - `preview(filters, campaignName, orgId, limit=20)` → exécute la SQL compilée avec `LIMIT 20` + retourne liste destinataires (nom, ville, statut, dernière campagne, engagement)

### 5.2. Hooks
- **`src/shared/hooks/useMailSegments.js`** (nouveau)
  - `useMailSegments(orgId)` → React Query
  - Mutations : `useCreateSegment`, `useUpdateSegment`, `useArchiveSegment`, `useDuplicateSegment`
  - `useSegmentCount(filters, campaignName)` → count live debounced (300ms)
  - `useSegmentPreview(filters, campaignName)` → preview 20 destinataires
- **Cache keys** dans `cacheKeys.js` : `segmentKeys.list(orgId)`, `segmentKeys.detail(id)`

### 5.3. UI

#### Nouvel onglet "Segments" (admin only)
`src/apps/artisan/components/mailing/SegmentsTab.jsx` :
- Liste cards (nom, audience, destinataires estimés, is_preset badge, action "Utiliser/Éditer/Dupliquer/Archiver")
- CTA "Nouveau segment" → ouvre `SegmentBuilderDrawer`

#### Builder — composant central
`src/apps/artisan/components/mailing/SegmentBuilderDrawer.jsx` (4 blocs) :

| Bloc | Composants |
|------|-----------|
| **1. Population** | `AudienceRadio` (clients/leads) + `BasePopulationFields` (dépend audience) |
| **2. Attributs** | `AttributesAccordion` — sections repliables (Géo, Logement, Équipement, Source, Commercial, Dates, Tags) |
| **3. Historique mailing** | `MailingHistoryFields` — select campagnes existantes depuis `majordhome_mail_campaigns` |
| **4. Preview + save** | `SegmentPreviewTable` (live count + 20 premiers) + bouton "Sauvegarder" + bouton "Utiliser maintenant" (→ SendTab pré-rempli) |

Convention : tous les champs via `FormFields.jsx` (`SelectInput`, `TextInput`, etc.).

#### Intégration onglet Envoi
`SendTab.jsx` modifié :
- Le sélecteur de segment devient un **dropdown `mail_segments`** (presets + user-defined) au lieu d'une liste en dur
- Compte live + preview identiques via les nouvelles RPCs

#### Intégration onglet Éditeur — bloc "Automatisation"
`CampaignWizard.jsx` étape 4 (nouvelle) OU section dédiée dans étape 1 "Identité" :
- Toggle "Campagne automatique"
- Si activé : sélection `auto_segment_id` (dropdown segments), `auto_cadence_days` (int), `auto_time_of_day` (time)
- Affichage `last_run_at` / `next_run_at` en lecture seule

### 5.4. Routes / Menu
- `Mailing.jsx` wrapper : passer de 2 onglets à **3 onglets** (Envoi / Segments / Éditeur)
- Onglet Segments visible uniquement `org_admin`

## 6. N8n — Scheduler générique

### 6.1. Nouveau workflow "Mayer - Scheduler Campagnes Auto"
Pattern (hérite de `lead_bienvenue`) :
```
[Cron toutes les 10 min]
  ↓
[HTTP RPC GET /rest/v1/rpc/mail_campaigns_due]  — (nouvelle RPC : campagnes is_automated=true AND next_run_at <= NOW())
  ↓
[SplitInBatches par campagne]
  ↓ pour chaque campagne :
  [HTTP RPC POST /rest/v1/rpc/mail_segment_compile] (filters+campaign_name+org_id → SQL)
  ↓
  [HTTP POST /webhook/mayer-mailing] (workflow existant, payload : subject, html_body, segment_sql, campaign_name, org_id, recipient_type, batch_size=400)
  ↓
  [HTTP RPC POST /rest/v1/rpc/mail_campaign_mark_run] (campaign_id → UPDATE last_run_at=NOW(), next_run_at=last_run_at + auto_cadence_days * interval '1 day')
```

### 6.2. Migration `lead_bienvenue`
- Créer campagne `lead_bienvenue` dans `mail_campaigns` (si pas déjà) avec :
  - `is_automated = true`
  - `auto_segment_id` → preset "Leads Nouveau" (à ajouter au seed §2.4)
  - `auto_cadence_days` = NULL → cas spécial (passage toutes les 10 min)
  - Alternative : cadence exprimée en minutes via nouvelle colonne `auto_cadence_minutes` OU juste `next_run_at = NOW() + interval '10 min'` recalculé à chaque run
- Supprimer l'ancien cron N8n dédié à `lead_bienvenue` une fois le scheduler générique testé

### 6.3. RPC utilitaires N8n
- `public.mail_campaigns_due() RETURNS SETOF` — liste campagnes à exécuter
- `public.mail_campaign_mark_run(p_campaign_id uuid)` — update last_run_at/next_run_at en 1 appel

## 7. Plan d'exécution (ordre)

| # | Étape | Tests |
|---|-------|-------|
| 1 | Migration DDL complète (tables, trigger, backfill, seed) | Vérifier backfill `leads.status_changed_at` cohérent avec `lead_activities` |
| 2 | RPC `mail_segment_compile` + `mail_segment_count` + `mail_segments_preview` + RPC scheduler | Tests : chaque preset seed doit retourner un SQL qui s'exécute sans erreur, count cohérent avec ancienne implémentation |
| 3 | Service + hook frontend | Unit tests sur composition `filters → SQL` |
| 4 | UI onglet Segments + builder complet (4 blocs) | Valider UX sur les 6 presets + 1 segment custom |
| 5 | Intégration dans SendTab (remplacer dropdown hardcodé) | Envoi manuel avec preset fonctionne bout en bout |
| 6 | Bloc automatisation dans Éditeur de campagne | CRUD campagne avec flag is_automated |
| 7 | Workflow N8n "Scheduler Campagnes Auto" | Test en dry-run sur 1 campagne test |
| 8 | Migration `lead_bienvenue` vers nouveau scheduler | Désactiver ancien cron, valider que les bienvenue partent toujours |
| 9 | Nettoyage : suppression `src/apps/artisan/components/mailing/segments.js` | Grep final pour s'assurer plus aucun import |

## 8. Tests & validation

- **Non-régression** : les 6 presets doivent retourner les **mêmes destinataires** que les segments `segments.js` actuels (pour ceux qui ont un équivalent)
- **Trigger** : UPDATE lead name/email ne change PAS `status_changed_at`, UPDATE status_id oui
- **Cron** : pas de double-envoi si le scheduler tourne 2 fois avant que le webhook mailing ait fini (idempotence via `exclude_current_campaign` + `NOT IN mailing_logs`)
- **RLS** : un user non admin ne peut pas lister les segments (mais les presets restent utilisables en lecture via SendTab)

## 9. Hors-scope V1 (extensions futures)

- Tags clients : activer l'UI de gestion des tags dans la fiche client (colonne `tags[]` existe, vide aujourd'hui) — prévu comme optimisation post-V1
- Dashboard stats par segment (taux d'ouverture/clic comparés à la taille du segment)
- A/B test : scinder un segment en 2 au moment de l'envoi (50/50)
- Segments basés sur engagement croisé (`include_opened_campaign` + `include_clicked_campaign` combinés)
- UI pour éditer directement le jsonb filters en mode "expert" (JSON raw)
