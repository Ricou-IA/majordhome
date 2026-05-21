# Phase 1 — Agent IA Terrain Post-RDV — Audit

> **Date** : 2026-05-01
> **Cible business** : Mayer Énergie (org pilote Majord'home, `org_id=3c68193e-783b-4aa9-bc0d-fb2ce21e99b1`)
> **Décision archi cadre** : intégration **dans Majord'home** (scénario A validé). Pas de repo séparé.
> **Statut** : audit lecture-seule ; **aucune modification DB ni code à ce stade**.

---

## TL;DR — Ce qui existe déjà fait gagner ~70% du périmètre

L'infra Majord'home contient déjà la majorité des briques nécessaires. La Phase 1 ne crée presque rien d'inédit : elle **assemble** des composants existants (transcription, extraction, Pennylane proxy, Calendar OAuth, sms_logs, RPCs CRUD) derrière **un nouveau workflow N8N orchestrateur** + **1 nouvelle table** (mémo vocal traçabilité) + **1 prompt Claude d'extraction** spécifique RDV terrain CVC.

**Ce qui change vs brief original** :
- ❌ Pas de nouveau repo GitHub → tout va dans `Ricou-IA/majordhome` (ce repo).
- ❌ Pas de table `automation_logs` à créer → on a déjà `client_activities`, `lead_activities`, `pennylane_sync.metadata`, `sms_logs`. On ajoute **une seule** table `voice_memos` pour la traçabilité brute audio→transcript→extraction.
- ❌ Pas de nouvelle edge function de transcription → réutilise `transcribe-dictation` v24 (Whisper FR, prêt en prod).
- ✅ Une nouvelle edge function `voice-extract-fieldreport` (Claude extraction structurée spécifique RDV terrain) — pattern hérité de `meeting-extract` v20.
- ✅ Un nouveau workflow N8N orchestrateur `Mayer - Voice Field Report` (équivalent du « Mayer - Contact Lead » mais avec audio en entrée).

---

## 1. État existant par brique

### 1.1 Supabase — Tables réutilisables

Toutes les tables clés sont déjà en place dans le schéma `majordhome` :

| Table | Lignes | Rôle pour Phase 1 |
|---|---|---|
| `clients` | 3391 | Cible pour upsert client (via RPC `find_or_create_client`) |
| `leads` | 147 | Cible pour création lead post-RDV (via RPC `create_majordhome_lead`) |
| `appointments` | 78 | RDV terrain — colonnes `client_id`/`lead_id`/`google_event_id` déjà branchées |
| `tasks` | 11 | **Tâches de suivi** — RPCs CRUD déjà en place |
| `task_notes` | 0 | Notes attachées aux tasks |
| `lead_activities` | 486 | Timeline lead (status_change, note, etc.) |
| `client_activities` | 161 | Timeline client (auto + manuel) |
| `sms_logs` | 37 | Envois SMS/WhatsApp (`channel='sms'\|'whatsapp'`) |
| `pennylane_sync` | 766 | Mapping local↔Pennylane (entity_type='client'\|'quote'\|'invoice') |
| `lead_pennylane_quotes` | 127 | N:N leads ↔ devis Pennylane |
| `google_calendar_tokens` | 2 | OAuth Google Calendar par user |
| `google_calendar_sync` | 4 | Mapping appointments ↔ Google Calendar events |
| `pricing_equipment_types` | 14 | Catalogue équipements (chaudieres, climatisation, eau_chaude, energie, poeles) — utilisé pour mapper `lead.equipment_type_id` |
| `sources` | 10 | Sources lead — il faut probablement **ajouter** une source `Compte-rendu vocal IA` (à valider) |
| `statuses` | 6 | `Nouveau` (default) → `Contacté` → `RDV planifié` → `Devis envoyé` → `Gagné`/`Perdu` |

**Gotcha** : `clients.project_id` est NOT NULL → toute création client passe par la RPC `find_or_create_client` qui gère déjà la création du `core.projects` parent.

**Schema `majordhome` non exposé via PostgREST** : toute écriture passe obligatoirement par RPC `SECURITY DEFINER` dans `public` (déjà documenté CLAUDE.md). Les RPCs existantes couvrent quasiment tous nos besoins (cf. §1.3).

### 1.2 Supabase — Edge Functions réutilisables

| Slug | Version | JWT | Rôle |
|---|---|---|---|
| `transcribe-dictation` | v24 | ✅ true | **Whisper FR**, multipart form `audio`, retourne `{ transcript, duration_seconds }`. Max 25 MB. Pas de stockage. → **Réutilisable tel quel** depuis le workflow N8N. |
| `meeting-extract` | v20 | ❌ false | Claude extraction JSON structuré (autre projet Baikal) → **pattern à cloner** dans `voice-extract-fieldreport` avec un prompt CVC. |
| `pennylane-proxy` | v7 | ✅ true | Proxy générique vers API Pennylane V2 avec retry 429. Body `{ method, path, body }`. → **Réutilisable** pour créer un devis DRAFT. |
| `pennylane-sync-cron` | v14 | ❌ false | Cron heure pour pull factures/devis (déjà en prod). |
| `pennylane-audit` | v29 | ❌ false | Audit miroir Pennylane. |
| `google-calendar-auth` | v21 | ❌ false | OAuth Google Calendar (init + callback). Refresh token par user dans `google_calendar_tokens`. |
| `google-calendar-sync` | v21 | ✅ true | Sync appointment ↔ event Calendar (create/update/delete). → **Réutilisable** pour créer les rappels et tâches. |
| `mailing-unsubscribe`, `resend-webhook` | — | — | Mail sortant déjà tracké end-to-end. |

### 1.3 Supabase — RPCs `public` réutilisables

Toutes en `SECURITY DEFINER` :

| RPC | Signature | Couvre |
|---|---|---|
| `find_or_create_client` | `(p_org_id, p_email, p_phone, p_first_name, p_last_name, p_display_name, p_company_name, p_address, p_postal_code, p_city, p_client_category, p_pennylane_account_number, p_source)` | Match par email + phone + nom, dedup auto via `dedup_candidates`, crée core.projects si nécessaire. **Idempotent.** |
| `create_majordhome_lead` | `(p_data jsonb) → SETOF leads` | Création lead générique |
| `update_majordhome_lead` | `(p_lead_id, p_updates jsonb)` | MAJ lead |
| `create_majordhome_lead_activity` | `(p_data jsonb)` | Push event timeline lead |
| `create_majordhome_lead_interaction` | `(p_data jsonb)` | Interaction (suivi MT/LT) |
| `create_majordhome_task` | `(p_data jsonb) → SETOF tasks` | Création tâche |
| `update_majordhome_task` / `delete_majordhome_task` | — | CRUD tâche |
| `create_majordhome_task_note` | `(p_task_id, p_content)` | Note attachée |
| `process_pennylane_quote` | `(p_org_id, p_customer_data, p_quote_data)` | Orchestre `find_or_create_client` + lookup/create lead + assign quote (pattern existant pour devis quote-driven) |
| `assign_pennylane_quote_to_lead` / `eject_pennylane_quote` | — | Tri manuel variantes devis ↔ lead |

**Conclusion** : pour le pipeline Phase 1, on a **zéro RPC à créer** côté CRUD client/lead/task/activity. On en ajoute potentiellement **1 seule** : `record_voice_memo_extraction(p_data jsonb)` qui orchestre voice_memo + lead + tasks + activities en une seule transaction (idempotent sur `voice_memo_id`).

### 1.4 Supabase — Storage

| Bucket | Public | Limite | MIME | Usage Phase 1 |
|---|---|---|---|---|
| `project-recordings` | ❌ | 500 MB | mp3/m4a/wav/ogg/webm | **Réutilisable** pour stocker les vocaux RDV terrain |
| `meeting-transcripts` | ❌ | 10 MB | text/plain, json | **Réutilisable** pour archiver les transcripts |
| `interventions` | ❌ | 10 MB | jpg/png/webp/pdf | (photos terrain optionnelles) |

→ Aucun nouveau bucket à créer.

### 1.5 N8N — Workflows

**Projet n8n** : Eric Pudebat (`c3Kg98SXmiDYGaGK`). Base URL : `https://n8n.srv1102213.hstgr.cloud/`.

11 workflows Mayer actifs :
- `Mayer - Contact Lead` — webhook formulaire site web → Slack #commercial + Gmail draft (**pattern modèle pour notre intake vocal**)
- `Mayer - Urgence SAV`, `Mayer - Entretien Contrat`, `Mayer Entretien Web - Souscription Contrat`
- `Mayer - SMS Avis Client` (channel SMS)
- `Mayer - Slack Interactions`
- `Mayer - Meta Ads Insights/Leads/Backfill` (3)
- `Mayer - Mailing` (envoi email générique via Resend)
- `Mayer - Scheduler Campagnes Auto` (cron 10 min, mail_campaigns_due)

Proxies Claude génériques actifs : `SQL Proxy - Claude`, `Gmail Proxy - Claude v2`, `GitHub Proxy - Claude`.

**Crédits & integrations confirmés** : Slack, Gmail (Workspace Mayer Énergie), Resend (emails), API Recherche Entreprises (SIRENE), Google Cloud (Places + GSC), Meta Graph API.

**Crédits à confirmer** :
- ⚠️ **Twilio** ou autre provider SMS — utilisé par `Mayer - SMS Avis Client` (à inspecter).
- ⚠️ **WhatsApp Business API** — pas évident dans la liste, à confirmer.
- ⚠️ **OpenAI Whisper API** — la clé `OPENAI_API_KEY` est déjà en secret Supabase Edge Functions (utilisée par `transcribe-dictation`, `meeting-transcribe`, etc.). **Pas besoin de re-provisionner.**

### 1.6 Pennylane — État Sprint 9

Sprint 9 est **en prod** (commit `7c8ecbe` 2026-04-30 : sync robuste anti-doublons + multi-devis par lead) :
- Push devis MDH → Pennylane **fonctionnel**
- Sync clients fonctionnelle
- Pull devis/factures via cron heure
- 766 mappings dans `pennylane_sync`, 127 devis liés à 90 leads via `lead_pennylane_quotes`
- Token Pennylane en secret Supabase (`PENNYLANE_API_TOKEN`)

→ Pour la Phase 1, **création d'un devis DRAFT** depuis le workflow vocal = appel `pennylane-proxy` avec `POST /quotes` (status=draft par défaut côté Pennylane). Pas de nouveau code Pennylane.

> Le doc `PROMPT_SPRINT_PENNYLANE_QUOTE_DRIVEN.md` (untracked) décrit un sprint d'arbitrage encore ouvert sur le tracking quote-driven. **Sans impact** pour la Phase 1 vocal — le push d'un devis draft fonctionne avec l'infra actuelle.

### 1.7 GitHub

Repo unique : `https://github.com/Ricou-IA/majordhome.git` (branche `main`).

→ **Pas de repo `mayer-energie-automation` à créer.** Tout vit ici. Les workflows N8N exportés iront dans `docs/n8n/workflows/` (cohérent avec `docs/n8n/META_ADS_INSIGHTS_SETUP.md`, etc.).

---

## 2. Architecture cible Phase 1

### 2.1 Vue d'ensemble

```
[Resp. Expl. après RDV]
        │ Mémo vocal (canal à choisir : voir Q1)
        ▼
┌──────────────────────────────────────────────────────────────┐
│  N8N : "Mayer - Voice Field Report" (NOUVEAU)                │
│  ┌──────────────┐                                            │
│  │ Webhook IN   │  POST /webhook/mayer-voice-field           │
│  └──────┬───────┘                                            │
│         ▼                                                    │
│  ┌──────────────┐  Upload audio dans bucket                  │
│  │ Storage      │  project-recordings/{org_id}/{uuid}.m4a    │
│  └──────┬───────┘                                            │
│         ▼                                                    │
│  ┌──────────────┐  POST /functions/v1/transcribe-dictation   │
│  │ Whisper      │  multipart "audio" → { transcript, durée } │
│  └──────┬───────┘  (RÉUTILISE l'edge fn existante)           │
│         ▼                                                    │
│  ┌──────────────┐  POST /functions/v1/voice-extract-…        │
│  │ Claude       │  Body: { transcript, context }             │
│  │ extraction   │  → JSON structuré (client/projet/etc.)     │
│  └──────┬───────┘  (NOUVELLE edge fn — clone meeting-extract)│
│         ▼                                                    │
│  ┌──────────────┐  POST /rpc/record_voice_memo_extraction    │
│  │ DB write     │  → upsert client + lead + activity + tasks │
│  └──┬─────┬─────┘  (NOUVELLE RPC orchestratrice)             │
│     │     │                                                  │
│     ▼     ▼                                                  │
│  Pennylane  Gmail                                            │
│  (proxy)    (draft)                                          │
│  Calendar   sms_logs                                         │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
[SMS/WhatsApp récap au resp. expl.]
```

### 2.2 Composants à créer (3 seulement)

| # | Composant | Type | Description |
|---|---|---|---|
| 1 | `voice-extract-fieldreport` | Edge Function | Clone allégé de `meeting-extract` v20 + prompt Claude FR spécifique RDV terrain CVC. Input `{ transcript, context: { resp_expl_id, source_audio_path } }`. Output JSON strict (cf. §2.4). |
| 2 | `record_voice_memo_extraction` | RPC public | Reçoit le JSON extrait + métadonnées audio → upsert client (via `find_or_create_client`) + create lead (via `create_majordhome_lead`) + push lead_activity + create tasks. Idempotent sur `voice_memo_id`. Retourne `{ client_id, lead_id, task_ids[], voice_memo_id }`. |
| 3 | `Mayer - Voice Field Report` | Workflow N8N | Webhook → upload audio → Whisper → Claude extract → RPC orchestratrice → Pennylane draft → Gmail draft → Calendar event → SMS récap. 8-10 nœuds max. |

### 2.3 Tables à créer (1 seule)

```sql
-- Traçabilité brute mémo vocal pour debug + retraitement
CREATE TABLE majordhome.voice_memos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES core.organizations(id),
  recorded_by UUID REFERENCES core.profiles(id),       -- resp. expl. qui a parlé
  audio_path TEXT NOT NULL,                            -- bucket project-recordings
  audio_duration_seconds INTEGER,
  audio_size_bytes INTEGER,
  transcript TEXT,                                     -- transcript Whisper brut
  extraction_json JSONB,                               -- output Claude
  client_id UUID REFERENCES majordhome.clients(id),    -- résultat upsert
  lead_id UUID REFERENCES majordhome.leads(id),        -- résultat create
  appointment_id UUID REFERENCES majordhome.appointments(id),
  pennylane_quote_id BIGINT,                           -- draft devis créé
  task_ids UUID[],                                     -- tasks créées
  status TEXT NOT NULL DEFAULT 'received',             -- received|transcribed|extracted|persisted|notified|error
  error_message TEXT,
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

→ **Une seule** table. Le reste des données vit dans les tables existantes (clients, leads, tasks, activities, sms_logs, pennylane_sync).

### 2.4 Schéma JSON de l'extraction Claude

Strict, compatible avec les RPCs existantes :

```json
{
  "voice_memo_meta": {
    "spoken_language": "fr-FR",
    "duration_seconds": 87,
    "confidence": "high|medium|low"
  },
  "client": {
    "first_name": "Jean", "last_name": "Martin",
    "phone": "0563...", "email": "...",
    "address": "...", "postal_code": "81000", "city": "Albi",
    "client_category": "particulier|entreprise"
  },
  "logement": {
    "housing_type": "maison|appartement|local_commercial",
    "construction_year": 1985, "surface_m2": 120,
    "energie_actuelle": "gaz|fioul|elec|bois",
    "isolation_etat": "string libre"
  },
  "projet": {
    "equipment_type_code": "pac_air_eau|poele_granules_elec|chaudiere_granules|...",
    "type_travaux": ["installation_pac", "depose_chaudiere"],
    "budget_evoque_eur": 12000,
    "urgence": "faible|moyenne|forte",
    "eligibilite_mpr": "oui|non|inconnu",
    "eligibilite_cee": "oui|non|inconnu"
  },
  "engagements": {
    "documents_a_envoyer": ["devis", "fiche_technique_pac"],
    "delai_devis_jours": 5,
    "rappel_a_prevoir": "true",
    "prochaine_etape": "string libre",
    "tasks": [
      { "title": "Envoyer devis PAC Daikin Altherma", "due_date": "2026-05-08", "is_urgent": false },
      { "title": "Relancer J+5 si pas de retour", "due_date": "2026-05-13", "is_urgent": false }
    ]
  },
  "notes_libres": "string verbatim non structuré",
  "champs_manquants": ["email", "construction_year"]
}
```

Les valeurs de `equipment_type_code` correspondent **exactement** aux 14 codes existants dans `pricing_equipment_types`. Le prompt Claude inclura cette liste fermée pour éviter les hallucinations.

### 2.5 Flux de validation humaine

Conformément au brief : **rien ne sort vers le client sans validation humaine**.
- ✅ Devis Pennylane : créé en `status=draft` (par défaut côté Pennylane).
- ✅ Email Gmail : créé en **draft** dans `Mayer - Voice Field Report` via le node Gmail (ne pas envoyer auto).
- ✅ Tâches Calendar : créées auto (visibles dans le calendrier, pas de visibilité externe au client).
- ✅ Notification SMS au resp. expl. : auto.
- ✅ Fiche client/lead Majord'home : créée auto (interne).

---

## 3. Gaps & risques

### 3.1 Décisions techniques en suspens

| # | Sujet | Options | Recommandation |
|---|---|---|---|
| G1 | Canal d'entrée vocal | (a) WhatsApp Business + Twilio webhook (b) Telegram bot (c) App PWA dédiée hébergée Vercel (d) Email avec pièce jointe vers `voice@mayer-energie.fr` | **(c) PWA dédiée** : accès rapide téléphone, contrôle UX, pas de coût Twilio/WA Business. Plus long à coder mais plus robuste. **(d) Email** est l'option « 30 minutes » si on veut tester avant. |
| G2 | Canal sortie SMS récap | (a) Twilio (déjà utilisé par `Mayer - SMS Avis Client`) (b) WhatsApp Business | (a) — réutilise infra existante |
| G3 | Storage RLS sur `voice_memos` & `project-recordings` | RLS strict org_id ou ouvert org_admin | RLS strict org_id (pattern Majord'home standard) |
| G4 | Idempotence | UUID client `voice_memo_id` côté webhook → contrainte UNIQUE en DB | Génération UUID dans le node N8N "Format" + check via `record_voice_memo_extraction` |

### 3.2 Risques

| Risque | Mitigation |
|---|---|
| **Hallucination Claude** sur les noms/adresses → mauvais client matché | (a) RPC `find_or_create_client` flag les fuzzy matches dans `dedup_candidates` (déjà en place) — Eric review hebdo. (b) Champ `champs_manquants[]` explicite dans l'extraction → l'IA reconnaît son ignorance plutôt que d'inventer. |
| **Doublons clients** si re-enregistrement du même RDV | UNIQUE sur `voice_memos.id` côté webhook + RPC idempotente. |
| **Audio corrompu / inaudible** | Whisper retourne erreur → `voice_memos.status='error'` + notification SMS au resp. expl. avec lien "ré-enregistrer". |
| **Quota OpenAI Whisper** | `transcribe-dictation` cap 25 MB. Mémo 1-2 min ≈ 1-2 MB → marge. Quota mensuel à monitorer. |
| **Prompt Claude qui dérive** sur les variantes équipement | Liste fermée `equipment_type_code` injectée + tests sur 3 vocaux réels avant prod. |
| **Pennylane draft mal pré-rempli** | Prompt extraction inclut `budget_evoque_eur` mais le devis est en draft → review humaine obligatoire dans Pennylane avant envoi. |
| **RGPD enregistrement client** | Mention explicite à intégrer dans (a) signature email Mayer (b) page d'accueil site web — texte à valider avec Eric. Audio conservé 90 jours puis supprimé via cron, transcript et fiche conservés selon politique RGPD entreprise. |

---

## 4. Décisions à prendre (à valider avec Eric)

### Q1. Canal d'entrée vocal
PWA dédiée ? Email avec pièce jointe ? WhatsApp Business ? Telegram ? **Recommandation : commencer par "email avec pièce jointe vers `voice@mayer-energie.fr`" pour tester en 1 semaine, puis migrer vers PWA si validation.**

### Q2. Identité du « responsable d'exploitation »
Profils Mayer actuels (cf. `core.profiles`) :
- **Eric Pudebat** (org_admin, business_role=`commercial`)
- **Philippe Mazel** (team_leader)
- **Antoine Verloo** (user)
- **Ludovic Robert** (user)
- **Michel Rieutord** (user, business_role=`Commercial`) — semble correspondre au profil "responsable d'exploitation terrain"

→ **Qui est précisément le resp. expl. ?** Et son téléphone perso pour la notif SMS sortie ?

### Q3. Source lead pour les RDV vocaux
Sources existantes : Bouche-à-oreille / Client Existant / Google Ads / Meta Ads / Offre Combustible / **Prospection directe** / Recommandation client / Salon-Foire / Site Web / Urgence SAV.

Options :
- (a) Ajouter une nouvelle source `Compte-rendu vocal IA` (traçabilité IA explicite)
- (b) Réutiliser `Prospection directe` (le RDV peut venir de pleins de sources, le vocal n'est qu'un compte-rendu)
- (c) Demander à l'IA de deviner la source depuis le vocal et fallback `Prospection directe`

→ **Recommandation : (a) pour traçabilité claire ("ces leads sont nés d'un mémo vocal").**

### Q4. Numéro Mayer Énergie pour signature email + mention RGPD
Numéro standard à afficher en signature ? Adresse postale du siège : déjà connue (26 Rue des Pyrénées, 81600 Gaillac, vu dans `Mayer - Contact Lead`). SIRET ? Mention RGE ?

### Q5. Templates devis Pennylane
Mayer a-t-il déjà un `quote_template_id` Pennylane par type de travaux (PAC / poêle / chaudière / etc.) ? Si oui : on l'utilise pour pré-remplir le brouillon. Sinon : on push un devis brut avec une seule ligne libellée par l'IA (le resp. expl. complète dans Pennylane).

### Q6. Politique de rétention RGPD
- Audio brut : suggestion 90 jours puis suppression auto via cron edge fn
- Transcript : 2 ans (legal, traçabilité commerciale)
- Fiche client/lead : politique générale Majord'home (à valider)
- Mention enregistrement IA en début de RDV : OUI/NON ? Texte à intégrer où ?

### Q7. Notification finale au resp. expl.
Format SMS proposé :
```
✅ RDV M. Martin (Albi) traité (1m32)
👤 Fiche : <link>
💼 Devis Pennylane (draft) : <link>
✉️ Email à valider : <link Gmail>
⏰ 2 tâches créées
🔄 Re-traiter : <link>
```
→ OK ou variante ?

### Q8. (Nouveau) Stratégie matching client existant
Quand le vocal mentionne un client déjà existant en DB :
- (a) Match strict par téléphone uniquement → maxi sécurité, peut louper si nouveau num
- (b) Match flou (téléphone OU email OU nom+ville) → flag dans `dedup_candidates` pour review

→ La RPC `find_or_create_client` actuelle fait déjà (b). **OK par défaut.**

### Q9. (Nouveau) Cas multi-projets sur un même client
Si M. Martin (déjà client) demande maintenant une PAC en plus de son contrat entretien existant : **créer un nouveau lead** ou enrichir lead existant ?
- Recommandation : **toujours créer un nouveau lead** (pattern `process_pennylane_quote` existant). Évite confusion entre projets.

### Q10. (Nouveau) Ordre de livraison
Le brief propose 7 modules. Vu l'existant, je propose **5 modules** avec milestones :
1. **M1 — Pipe vocale brute** (1-2j) : webhook + storage + Whisper + RPC orchestratrice minimaliste (juste create lead) + notif SMS récap. Test sur 3 vocaux réels. **Goal : démontrer le bout en bout E2E sur le strict minimum.**
2. **M2 — Extraction enrichie** (1j) : prompt Claude tuné avec `equipment_type_code` fermé + tests qualité champs.
3. **M3 — Pennylane draft** (1j) : appel `pennylane-proxy` POST /quotes avec lignes pré-remplies.
4. **M4 — Email Gmail draft + Calendar** (1j) : draft Gmail + 2 events Calendar (devis J+5, relance J+10).
5. **M5 — Tâches + UI fiche client** (1j) : tasks créées + onglet `Mailings` enrichi avec section "Vocaux RDV" sur fiche client + lecteur audio embarqué.

**Total : ~6 jours de dev** pour Phase 1 complète, en supposant les décisions Q1-Q9 prises.

---

## 5. Mesure (KPIs Phase 1)

Vue SQL simple sur `voice_memos` (à créer après M1) :

```sql
-- Nb vocaux traités / mois
SELECT date_trunc('month', created_at), COUNT(*), AVG(processing_time_ms)/1000 AS avg_seconds
FROM majordhome.voice_memos GROUP BY 1 ORDER BY 1;

-- Taux extraction réussie (% champs remplis)
SELECT
  AVG(jsonb_array_length(COALESCE(extraction_json->'champs_manquants', '[]')))::numeric AS avg_missing,
  COUNT(*) FILTER (WHERE status='persisted') * 100.0 / COUNT(*) AS pct_success
FROM majordhome.voice_memos
WHERE created_at >= NOW() - INTERVAL '30 days';
```

**Pas besoin d'un dashboard** dans la Phase 1 — vues SQL + un simple onglet "Vocaux" dans la fiche client suffisent. Dashboard à itérer plus tard.

---

## 6. Sécurité & RGPD

| Sujet | Approche |
|---|---|
| Token API Pennylane | Déjà en secret Supabase (`PENNYLANE_API_TOKEN`) |
| Token OpenAI | Déjà en secret Supabase (`OPENAI_API_KEY`) |
| Token Anthropic Claude | À ajouter en secret Supabase (`ANTHROPIC_API_KEY`) — clé Eric existante |
| RLS `voice_memos` | Strict `org_id = current_user.org_id` via JWT (pattern Majord'home standard) |
| RLS bucket `project-recordings` | À vérifier — Storage RLS déjà en place sur les autres buckets, à dupliquer |
| Région données | Supabase EU (`odspcxgafcqxjzrarsqf` → région à confirmer mais OK Supabase EU par défaut), OpenAI/Anthropic via API EU si dispo |
| Mention enregistrement | Texte à intégrer signature email + page web Mayer (cf. Q4 + Q6) |

---

## 7. Annexe — Mapping brief → existant

| Brief Phase 1 | Existant Majord'home | Action |
|---|---|---|
| Webhook n8n entrant audio | Pattern `Mayer - Contact Lead` | Cloner + remplacer Slack/Gmail par chaîne Whisper/Claude/RPC |
| Whisper API transcription | Edge fn `transcribe-dictation` v24 | Réutiliser tel quel |
| Claude extraction structurée | Edge fn `meeting-extract` v20 | Cloner en `voice-extract-fieldreport` avec prompt CVC |
| Création/MAJ fiche client Supabase | RPC `find_or_create_client` | Réutiliser tel quel |
| Création visite/lead | RPC `create_majordhome_lead` + `create_majordhome_lead_activity` | Réutiliser |
| Brouillon devis Pennylane | Edge fn `pennylane-proxy` v7 | Réutiliser (POST /quotes) |
| Email remerciement Gmail draft | Workflow N8N node Gmail (déjà utilisé) | Node Gmail Draft (pas Send) |
| Tâches & rappels Calendar | Edge fn `google-calendar-sync` v21 + RPC `create_majordhome_task` | Réutiliser |
| Notification finale resp. expl. | Workflow `Mayer - SMS Avis Client` (Twilio) + table `sms_logs` | Réutiliser pattern |
| Logs structurés | `voice_memos` + `lead_activities` + `client_activities` | Pas de table `automation_logs` |
| Repo GitHub | `Ricou-IA/majordhome` existant | Pas de nouveau repo |

---

## 8. Prochaine étape

**À faire par Eric** : répondre aux questions Q1-Q10 (10-15 min de lecture).

**Une fois validé** : je commence par **M1 (pipe vocale brute)** — webhook N8N + bucket + Whisper + RPC squelette + notif SMS, testé sur 3 vocaux réels. Aucune mutation Pennylane/Gmail/Calendar tant que M1 n'est pas validé.

**Branche git proposée** : `feat/phase1-voice-fieldreport` (ne pas merger sur main avant E2E validé).
