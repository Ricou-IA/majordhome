# Design — Planning unifié + sync Google Agenda

> **Date** : 2026-05-06
> **Auteur** : Eric Pudebat (validé en brainstorming avec Claude)
> **Statut** : Draft pour relecture utilisateur
> **Sprint cible** : 4 sprints (~25 jours-dev) à partir de la phase 0

---

## 1. Contexte et motivation

### 1.1. Bug déclencheur
La planification d'un chantier (jours d'intervention assignés à des techniciens via `ChantierModal`) ne remonte pas sur le planning équipe (`/planning`). Cause racine : les slots chantier vivent dans `majordhome.interventions` (enfants avec `parent_id != null`), tandis que le planning n'interroge que `majordhome.appointments`. Ce sont deux domaines disjoints qui se sont développés indépendamment.

### 1.2. Constat plus large
Au-delà du bug, la gestion du planning est fragmentée :

| Source | Volume actuel | Visible sur planning |
|---|---|---|
| `appointments` (RDV co, visite tech, install, entretien, SAV) | 84 | ✅ |
| `interventions` parent (chantier root) | 438 | ❌ (pas de date utile) |
| `interventions` slots (jours chantier) | 5 récents | ❌ |
| `maintenance_visits` (chaînage annuel) | 735 | ✅ via appointment lié |

Aucune absence (congé, formation, indispo perso) n'est gérée — donc les sur-bookings sont possibles. Aucune sync avec un agenda externe — les techs n'ont pas leur planning sur leur téléphone autrement qu'en se connectant à l'app.

### 1.3. Objectif
Refactor du planning pour devenir un **agenda professionnel complet** par membre d'équipe :
- Toutes les planifications métier (RDV, chantiers, entretiens, SAV) consolidées en une seule source
- Absences (congés, maladie, formation) gérées dans Majord'home
- Indisponibilités personnelles ad-hoc (RDV médecin, etc.) gérées côté Google Agenda du membre, importées en busy/free
- Sync bidirectionnelle avec le Google Agenda de chaque membre (push events Majord'home + pull busy blocks externes)

---

## 2. Décisions structurantes (récap brainstorming)

| # | Décision | Choix retenu |
|---|---|---|
| Q1 | Périmètre | Agenda pro complet (RDV métier + absences + indispos externes) |
| Q2 | Sync Google | Bidirectionnelle, OAuth par user (chaque membre connecte son agenda) |
| Q3 | Indispos non-métier | Mix : congés/formations dans Majord'home, RDV perso côté Google |
| Q4 | Modèle data | Consolidation : tout devient un `appointment` |
| Q5 | Vue planning | Resource view (colonnes par tech) — FullCalendar Premium |
| Q6a | Push Google | TOUT push (RDV + absences + slots chantier) |
| Q6b | Indispos Google entrantes | Privacy max → "🔒 Indispo" sans titre exposé |
| Q6c | Calendrier cible Google | Sous-calendrier dédié "Majord'home" créé au 1er OAuth |
| Q7a | Multi-tech sur slot | Event dupliqué dans chaque colonne (`resourceIds` natif) |
| Q7b | Drag cross-resource | Autorisé + toast Sonner "Annuler" actif 5s |

---

## 3. Architecture data

### 3.1. Vue d'ensemble
- **`appointments`** devient la source unique du planning (étendue avec nouveaux types et colonnes)
- **`interventions`** garde son rôle métier (workflow chantier, PV réception, statuts) MAIS perd la responsabilité de stocker les slots
- **`maintenance_visits`** inchangée (chaînage annuel — domaine métier orthogonal)
- **Nouvelle table** `team_member_google_credentials` (OAuth par user)
- **Nouvelle table** `external_calendar_busy_blocks` (busy blocks Google entrants, read-only)

### 3.2. Évolution `majordhome.appointments`

#### Nouveaux types dans l'enum `appointment_type`
```sql
ALTER TYPE majordhome.appointment_type ADD VALUE 'chantier_jour';
ALTER TYPE majordhome.appointment_type ADD VALUE 'absence_conge';
ALTER TYPE majordhome.appointment_type ADD VALUE 'absence_maladie';
ALTER TYPE majordhome.appointment_type ADD VALUE 'absence_formation';
```

#### Nouvelles colonnes
```sql
ALTER TABLE majordhome.appointments
  ADD COLUMN parent_chantier_id UUID REFERENCES majordhome.leads(id),
  ADD COLUMN is_all_day BOOLEAN DEFAULT false,
  ADD COLUMN end_date DATE,
  ADD COLUMN google_event_id TEXT,
  ADD COLUMN google_calendar_id TEXT,
  ADD COLUMN google_synced_at TIMESTAMPTZ,
  ADD COLUMN google_etag TEXT,
  ADD COLUMN created_by_google BOOLEAN DEFAULT false;

CREATE INDEX idx_appointments_parent_chantier ON majordhome.appointments(parent_chantier_id) WHERE parent_chantier_id IS NOT NULL;
CREATE INDEX idx_appointments_google_sync ON majordhome.appointments(google_synced_at) WHERE google_synced_at IS NULL OR updated_at > google_synced_at;
```

#### Mapping slots `interventions` → `appointments` (pour migration)
| Champ slot (`interventions`) | Champ cible (`appointments`) |
|---|---|
| `id` | nouveau UUID (pas le même) |
| `parent_id` (parent intervention) | (lookup parent.lead_id) → `parent_chantier_id` |
| `slot_date` | `scheduled_date` |
| `slot_start_time` | `scheduled_start` |
| `slot_end_time` | `scheduled_end` |
| `slot_notes` | `notes` |
| Lien `intervention_technicians` | Lien `appointment_technicians` |
| `lead.last_name` (lookup) | `client_name` |
| `lead.first_name` (lookup) | `client_first_name` |

→ `appointment_type = 'chantier_jour'`

### 3.3. Vue `majordhome_appointments` étendue

Ajout de joins pour exposer le contexte chantier et calculer dynamiquement le `day_index` (Jour X/N) :

```sql
CREATE OR REPLACE VIEW public.majordhome_appointments AS
SELECT a.*,
  -- Contexte chantier
  lc.last_name AS chantier_client_name,
  lc.first_name AS chantier_client_first_name,
  lc.address AS chantier_address,
  lc.postal_code AS chantier_postal_code,
  lc.city AS chantier_city,
  -- Day index (jour X/N) calculé pour les slots chantier
  CASE WHEN a.appointment_type = 'chantier_jour' THEN
    ROW_NUMBER() OVER (
      PARTITION BY a.parent_chantier_id
      ORDER BY a.scheduled_date, a.scheduled_start
    )
  END AS chantier_day_index,
  CASE WHEN a.appointment_type = 'chantier_jour' THEN
    COUNT(*) OVER (PARTITION BY a.parent_chantier_id)
  END AS chantier_total_days
FROM majordhome.appointments a
LEFT JOIN majordhome.leads lc ON lc.id = a.parent_chantier_id
-- (joins existants pour client/contract/etc. inchangés)
;
```

### 3.4. Nouvelle table `team_member_google_credentials`

```sql
CREATE TABLE majordhome.team_member_google_credentials (
  user_id UUID PRIMARY KEY REFERENCES core.profiles(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,         -- chiffré via pgsodium ou Vault
  access_token_expires_at TIMESTAMPTZ,
  majordhome_calendar_id TEXT,         -- ID du sous-calendrier dédié, créé au 1er OAuth
  sync_enabled BOOLEAN DEFAULT true,
  last_full_sync_at TIMESTAMPTZ,
  last_delta_sync_token TEXT,          -- nextSyncToken Google pour delta sync
  last_sync_error TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS strict : seul le user lit/modifie ses propres credentials côté frontend.
-- Les edge functions sync utilisent service_role (bypass RLS) pour push/pull sur tous les users.
ALTER TABLE majordhome.team_member_google_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_select_own" ON majordhome.team_member_google_credentials
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_update_own" ON majordhome.team_member_google_credentials
  FOR UPDATE USING (auth.uid() = user_id);
-- INSERT/DELETE : uniquement service_role (via edge function OAuth callback / disconnect)
```

### 3.5. Nouvelle table `external_calendar_busy_blocks`

Stocke les events Google externes (= venant des autres calendriers du user, pas le sous-calendrier Majord'home) en busy/free uniquement, sans titre.

```sql
CREATE TABLE majordhome.external_calendar_busy_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  google_calendar_id TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN DEFAULT false,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, google_event_id, google_calendar_id)
);

CREATE INDEX idx_external_busy_user_window ON majordhome.external_calendar_busy_blocks(user_id, start_at, end_at);
```

→ Vue publique `majordhome_team_busy_blocks` exposant uniquement les blocks (pas de titres, pas de descriptions).

### 3.6. Suppression progressive des slots `interventions`

- Migration des 5 slots existants → `appointments` (script SQL one-shot, voir §6)
- `useInterventionSlots` deprecated → remplacé par `useChantierAppointments(chantierId)` (filtre `parent_chantier_id`)
- Vue `majordhome_intervention_slots` conservée 30j en lecture (rétro-compat) puis supprimée
- Méthodes `interventions.createInterventionSlot` / `deleteInterventionSlot` deprecated puis supprimées

`majordhome.interventions` (parents) **reste intact** pour le workflow chantier.

---

## 4. Composants UI

### 4.1. `Planning.jsx` — refactor vue Resource

- **Plugin** : `@fullcalendar/resource-timegrid` (FullCalendar Premium)
- **Vues** :
  - `resourceTimeGridDay` — 1 jour, toutes colonnes (vue par défaut quand 5+ membres)
  - `resourceTimeGridWeek` — 7 jours × N colonnes (scroll horizontal sur mobile)
  - `dayGridMonth` — fallback agrégé sans resource (vue mois reste comme aujourd'hui)
- **Resources** = `teamList` existante (techs depuis `team_members` + commerciaux depuis `lead_commercials`)
- **Filtre "Équipe"** devient sélecteur de colonnes affichées (par défaut = membres avec `is_active=true`)
- **Filtre "Type"** inchangé, étendu aux nouveaux types (chantier_jour, absence_*)

### 4.2. `EventModal.jsx` — polymorphique selon `appointment_type`

| Type | Modale affichée |
|---|---|
| `rdv_agency`, `rdv_technical`, `installation`, `maintenance`, `service`, `other` | Modale actuelle (inchangée) |
| `chantier_jour` | Header "🔨 Chantier {client} J{X}/{N}" + lien "Ouvrir le chantier complet" (ferme modale → ouvre `ChantierModal` du `parent_chantier_id`). Champs éditables : date, heures, techs, notes. Suppression = supprimer ce slot uniquement (pas le chantier). |
| `absence_*` | Type absence (radio congé/maladie/formation), date début, date fin (multi-jour), notes. Membre concerné obligatoire. |

### 4.3. `ChantierModal.jsx` — section Intervention refactorée

- Lit/écrit via `appointmentsService` filtré sur `parent_chantier_id = chantier.id` (au lieu de `interventionsService.createInterventionSlot`)
- **Le bouton "Créer l'intervention" disparaît** : on peut directement ajouter des jours (le parent intervention reste pour le workflow mais n'est plus prérequis pour planifier)
- `useInterventionSlots` deprecated → remplacé par `useChantierAppointments(chantierId)`
- Composant `ChantierInterventionSection` continue d'exister mais alimenté différemment (props `appointments[]` au lieu de `slots[]`)

### 4.4. Nouveau composant `AbsenceModal.jsx`

- Accessible depuis :
  1. Bouton "Ajouter une absence" sur la fiche profil membre (page admin équipe ou Profile pour soi-même)
  2. Clic-glisser sur la colonne d'un membre dans la vue Resource
- Multi-jour natif via `is_all_day = true` + `scheduled_date` + `end_date`
- Membre concerné = pré-rempli si créé depuis la fiche profil ou la colonne resource

### 4.5. Nouvelle section dans `Profile.jsx` — Sync Google Agenda

- Bouton "Connecter mon Google Agenda" → ouvre OAuth flow (`google-calendar-oauth-init`)
- Si connecté :
  - Statut sync (vert/orange/rouge)
  - Dernière sync (timestamp)
  - Bouton "Forcer une sync"
  - Bouton "Déconnecter" (révoque token + supprime credentials)
  - Toggle "Activer/désactiver la sync" (`sync_enabled`)

---

## 5. Sync Google Agenda

### 5.1. OAuth flow (réutilise pattern GSC)

3 edge functions Supabase, mêmes patterns que `gsc-oauth-*` du module Search Console :

#### `google-calendar-oauth-init` (verify_jwt: true)
- Génère URL OAuth Google avec scopes :
  - `https://www.googleapis.com/auth/calendar.calendars` (créer le sous-calendrier)
  - `https://www.googleapis.com/auth/calendar.events` (push/pull events)
- State signé JWT (anti-CSRF) contenant `user_id` + `org_id`

#### `google-calendar-oauth-callback` (verify_jwt: false)
- Reçoit `code` + `state`, valide state JWT
- Échange code contre `refresh_token` Google
- Appelle Google Calendar API pour créer le sous-calendrier "Majord'home" (POST `/calendars`)
- Stocke dans `team_member_google_credentials` :
  - `refresh_token` (chiffré)
  - `majordhome_calendar_id` (ID du sous-calendrier créé)
- Redirect vers `/profil?google_agenda=connected`

#### `google-calendar-sync` (verify_jwt: true)
- Endpoint manuel pour forcer une sync depuis le profil user
- Délègue à `google-calendar-push` + `google-calendar-pull`

### 5.2. Push (Majord'home → Google)

#### Trigger
Trigger DB `AFTER INSERT/UPDATE/DELETE ON majordhome.appointments` qui marque `google_synced_at = NULL` quand un appointment est modifié.

#### Worker
Edge function `google-calendar-push` cronée toutes les 1 min :
1. Sélectionne les appointments avec `google_synced_at IS NULL OR updated_at > google_synced_at`
2. Pour chaque appointment, pour chaque tech assigné connecté Google :
   - Si pas de `google_event_id` → POST event sur le sous-calendrier Majord'home du tech
   - Sinon → PATCH event existant
   - Stocke `google_event_id` + `google_etag`
3. Marque `google_synced_at = NOW()`

#### Mapping appointment → Google Event
| Appointment field | Google Event field |
|---|---|
| Title selon type (cf. ci-dessous) | `summary` |
| `scheduled_date` + `scheduled_start/end` ou `is_all_day` | `start.dateTime/date` + `end.dateTime/date` |
| `notes` + deep-link `https://app.majordhome.fr/...` | `description` |
| Adresse client (si applicable) | `location` |
| `google_email` du tech | `attendees[]` |

#### Titres par type
- `rdv_agency` : "RDV Co — {client_name}"
- `rdv_technical` : "Visite Tech — {client_name}"
- `installation` : "Installation — {client_name}"
- `maintenance` : "Entretien — {client_name}"
- `service` : "SAV — {client_name}"
- `chantier_jour` : "🔨 Chantier {chantier_client_name} J{X}/{N}"
- `absence_conge` : "🌴 Congés"
- `absence_maladie` : "🏥 Arrêt maladie"
- `absence_formation` : "📚 Formation"

#### Push uniquement vers le sous-calendrier "Majord'home"
On ne touche jamais au calendrier principal du user — privacy + cleanup facile.

### 5.3. Pull (Google → Majord'home)

#### Trigger
Cron 1h (pas plus rapide pour ne pas spammer l'API Google).

#### Worker
Edge function `google-calendar-pull` :
1. Pour chaque user connecté avec `sync_enabled = true` :
   - Liste TOUS ses calendriers Google (`calendarList.list`)
   - **Exclut** le sous-calendrier `majordhome_calendar_id` (pour éviter d'importer ce qu'on a poussé)
   - Pour chaque autre calendrier : `events.list?syncToken={last_delta_sync_token}` (delta sync)
   - Pour chaque event reçu :
     - Si `start/end` dans la fenêtre [maintenant, +90j] → upsert dans `external_calendar_busy_blocks` (pas de titre stocké, juste les heures)
     - Si event supprimé → DELETE le block correspondant
2. Stocke `nextSyncToken` dans `last_delta_sync_token`

#### Affichage côté planning
- La vue `majordhome_team_busy_blocks` est lue par le planning au même titre que les appointments
- Rendu visuel : gris hachuré, label "🔒 Indispo", non-cliquable, non-droppable

#### Anti-conflit
Quand l'utilisateur tente de créer un appointment qui chevauche un busy block d'un tech assigné :
- Toast warning : "⚠️ {Nom du tech} a une indispo Google qui chevauche ce créneau"
- Bouton "Créer quand même" (force la création) ou "Annuler"

### 5.4. Fenêtre de sync

| Direction | Fenêtre |
|---|---|
| Push | -30j à +180j (passé court pour corrections, futur long pour planification) |
| Pull busy blocks | 0 à +90j (pas de passé pour les indispos) |

Au-delà : pas de sync (perf API Google + pas pertinent métier).

### 5.5. Gestion des conflits & cas limites

| Cas | Comportement |
|---|---|
| Tech modifie l'event Google poussé par Majord'home (heure, titre) | Au prochain push, on **PATCH force-overwrite** sur le `google_event_id` avec la version Majord'home (sans check d'etag — Majord'home = source de vérité pour les events poussés). Le manager n'est pas notifié. |
| Tech supprime l'event Google poussé par Majord'home | Au prochain pull on detect (pas de fail au push). On marque `status='cancelled'` côté appointment + log + notif manager (canal défini en Phase 6) |
| Tech révoque le token Google côté Google | Au prochain push/pull, l'API renvoie 401. On marque `sync_enabled=false` + `last_sync_error="token_revoked"` + email user "Reconnecte ton agenda" |
| Conflit de chevauchement à la création | Toast warning + confirmation explicite (cf. §5.3 Anti-conflit) |
| Tech change d'email Google | OAuth refait depuis le profil = remplace les credentials |

---

## 6. Migration data

### 6.1. Script SQL one-shot (idempotent)

```sql
BEGIN;

-- Étape 1 : Migrer les slots existants vers appointments
WITH slots_to_migrate AS (
  SELECT
    slot.id AS slot_id,
    slot.project_id,
    slot.slot_date,
    slot.slot_start_time,
    slot.slot_end_time,
    slot.slot_notes,
    slot.created_at,
    slot.created_by,
    parent.lead_id AS parent_lead_id,
    l.last_name,
    l.first_name,
    l.address,
    l.postal_code,
    l.city
    -- NOTE Phase 1 : vérifier la chaîne d'org_id avant exécution.
    -- Si appointments.org_id existe et est NOT NULL, JOIN core.projects + core.organizations
    -- pour le récupérer. Sinon utiliser parent.org_id directement si présent sur interventions.
    -- À auditer en début de migration.
  FROM majordhome.interventions slot
  JOIN majordhome.interventions parent ON parent.id = slot.parent_id
  JOIN majordhome.leads l ON l.id = parent.lead_id
  WHERE slot.parent_id IS NOT NULL
    AND slot.slot_date IS NOT NULL
    AND NOT EXISTS (
      -- idempotence : ne pas re-migrer si déjà fait
      SELECT 1 FROM majordhome.appointments a
      WHERE a.metadata @> jsonb_build_object('migrated_from_slot_id', slot.id::text)
    )
)
INSERT INTO majordhome.appointments (
  id, project_id, parent_chantier_id, appointment_type,
  scheduled_date, scheduled_start, scheduled_end,
  client_name, client_first_name, address, postal_code, city,
  notes, status, created_by, created_at, metadata
)
SELECT
  gen_random_uuid(),
  s.project_id,
  s.parent_lead_id,
  'chantier_jour'::majordhome.appointment_type,
  s.slot_date,
  s.slot_start_time,
  s.slot_end_time,
  s.last_name,
  s.first_name,
  s.address,
  s.postal_code,
  s.city,
  s.slot_notes,
  'scheduled'::majordhome.appointment_status,
  s.created_by,
  s.created_at,
  jsonb_build_object('migrated_from_slot_id', s.slot_id::text, 'migrated_at', NOW())
FROM slots_to_migrate s;

-- Étape 2 : Migrer les techniciens assignés
INSERT INTO majordhome.appointment_technicians (appointment_id, technician_id)
SELECT
  a.id AS appointment_id,
  it.technician_id
FROM majordhome.appointments a
JOIN majordhome.intervention_technicians it
  ON it.intervention_id = (a.metadata->>'migrated_from_slot_id')::uuid
WHERE a.metadata ? 'migrated_from_slot_id'
ON CONFLICT (appointment_id, technician_id) DO NOTHING;

-- Étape 3 : Marquer les slots originaux comme deprecated (pour rollback 30j)
UPDATE majordhome.interventions
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('deprecated_slot', true, 'deprecated_at', NOW())
WHERE parent_id IS NOT NULL AND slot_date IS NOT NULL;

COMMIT;
```

### 6.2. Plan de rollback

- **Backup full DB** avant migration (snapshot Supabase)
- **Vue `majordhome_intervention_slots` conservée 30j** en lecture, redirigée vers `appointments` filtrés `appointment_type='chantier_jour'` pour rétro-compat
- **Suppression réelle** des slots originaux après 30j de validation prod (script séparé)

### 6.3. Pas de migration nécessaire pour
- **`appointments` existants** (84) : juste ajout de colonnes nullables, données intactes
- **`interventions` parents** : intacts, on enlève juste leur rôle de "container de slots"
- **`maintenance_visits`** : intacts, orthogonaux

---

## 7. Roadmap par phases

| Phase | Livrable | Effort | Sprint |
|---|---|---|---|
| **Phase 0 — Quick fix** | Afficher les slots chantier sur le planning actuel sans refactor data (extension de `useAppointments` avec query parallèle sur la vue `majordhome_intervention_slots`, merge des events avec couleur teal et titre "🔨 Chantier J{X}/{N}") | **1 jour** | Cette semaine |
| **Phase 1 — Modèle data unifié** | Migration DB (nouveaux types enum, colonnes appointments, vue étendue, script migration des 5 slots, refactor ChantierModal vers `appointmentsService`, deprecation `useInterventionSlots`) | 3-4 jours | Sprint 1 |
| **Phase 2 — Vue Resource** | License FullCalendar Premium acquise, refactor `Planning.jsx` en `resourceTimeGridWeek`, EventModal polymorphique selon type, drag&drop cross-resource avec toast undo 5s | 4-5 jours | Sprint 2 |
| **Phase 3 — Absences** | Nouveaux types enum `absence_*`, `AbsenceModal`, multi-jour natif (`is_all_day` + `end_date`), intégration filtre planning, gestion sur fiche profil membre | 2-3 jours | Sprint 2 |
| **Phase 4 — Sync Google (push only)** | Tables `team_member_google_credentials`, edge functions OAuth (init/callback/sync), trigger DB sync_at, worker push cron 1 min, page profil "Connecter Google Agenda", création sous-calendrier | 5-6 jours | Sprint 3 |
| **Phase 5 — Sync Google (pull busy)** | Table `external_calendar_busy_blocks`, vue `majordhome_team_busy_blocks`, worker pull cron 1h, affichage 🔒 Indispo sur planning, anti-conflit toast à la création | 3-4 jours | Sprint 4 |
| **Phase 6 — Polish** | Notifications manager (event Google supprimé/conflit), gestion désinstallation OAuth, dashboard admin sync (statut par membre, dernières erreurs), monitoring quotas Google API | 2 jours | Sprint 4 |

**Total estimé : ~25 jours-dev** sur 4 sprints calendaires (≈ 1-2 mois selon charge parallèle).

**Important** : la **Phase 0 livre le bug fix immédiat** sans toucher au modèle data. Les phases 1-6 viennent ensuite, chacune indépendante et déployable séparément. La Phase 1 est la plus invasive (migration data) → **fenêtre de déploiement = soir, backup avant**.

---

## 8. Risques & open questions

### 8.1. Risques identifiés
| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Migration des 5 slots casse un chantier en cours | Faible | Moyen | Script idempotent + rollback 30j + tests sur staging avant |
| FullCalendar Premium License non budgétée (~480$/an) | Élevée | Bloquant Phase 2 | Décision budget AVANT Phase 2. Fallback : `react-big-calendar` (refactor plus lourd, ~2 jours en plus) |
| Quotas Google Calendar API (1M req/jour par projet GCP) | Faible | Moyen | 5 techs × 100 events/jour × 2 (push+pull) = 1000 req/jour, très en-dessous. À surveiller si l'org grandit. |
| Refresh token Google révoqué silencieusement (Google purge tokens 6 mois inactifs) | Moyenne | Moyen | Email user au 1er échec + UI claire pour reconnecter. Sync minimum hebdomadaire pour éviter expiration. |
| Conflits de fuseau horaire entre Majord'home (Europe/Paris) et Google (UTC) | Faible | Élevé si négligé | Stocker tout en TIMESTAMPTZ côté DB, conversion uniquement à l'affichage. Tests unitaires sur DST (passage heure d'été/hiver). |

### 8.2. Open questions (à résoudre pendant l'implé ou en relecture utilisateur)

- **Where do we store** le `refresh_token` chiffré ? → pgsodium si dispo sur le projet Supabase, sinon Supabase Vault. À confirmer en début de Phase 4.
- **Notifications manager** quand un tech supprime un event Google poussé : email ? toast in-app au prochain login ? slack ? → décision en Phase 6.
- **Permissions** sur la création d'absences : qui peut créer une absence pour qui ? `org_admin` pour tous, `team_leader` pour sa team, le membre lui-même pour soi ? → reuse `usePermissions` (Sprint 7), à modéliser en Phase 3.
- **Vue mobile** : la vue Resource scroll horizontal est-elle utilisable sur smartphone ? → tester en Phase 2, fallback vue agrégée filtrée si problème UX.
- **Granularité du push** : pousse-t-on AUSSI les RDV où le user est juste assigné mais pas créateur ? → oui par défaut (le RDV est "le sien" puisqu'il y est assigné).

---

## 9. Décisions explicitement non-retenues

Pour mémoire, voici ce qu'on a écarté pendant le brainstorming :

- **Vue SQL unifiée + écritures séparées** (Q4 Option 2) : non-disruptive mais conserve la dette technique. On préfère un refactor propre.
- **Multiplexage côté frontend** (Q4 Option 3) : 3 round-trips, complexité React Query. Rejeté.
- **Push-only Google** (Q2 Option A) : ne résout pas le problème des indispos personnelles. Rejeté au profit de bidirectionnel.
- **Agenda Google partagé d'org** (Q2 Option C) : pas d'agenda perso par tech. Rejeté.
- **Affichage des titres Google entrants** (Q6b Option B) : risque RGPD, pas pertinent métier. Rejeté au profit de privacy max.
- **Drag cross-resource interdit** (Q7b Option B) : trop frustrant en usage intensif manager. Rejeté au profit de "drag + undo 5s".
- **Toggle entre vue agrégée et resource** (Q5 Option C) : complexité UI sans valeur claire. Rejeté.

---

## 10. Validation

- [x] Brainstorming validé par utilisateur (2026-05-06)
- [ ] Spec relu par utilisateur
- [ ] Plan d'implémentation phase par phase écrit (skill `writing-plans`)
- [ ] Phase 0 livrée
- [ ] Phases 1-6 livrées au fil des sprints
