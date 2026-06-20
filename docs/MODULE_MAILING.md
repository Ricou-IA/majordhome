# Module Mailing

> Déporté de CLAUDE.md (restructuration 2026-06-18). Pointeur + règles qui mordent : CLAUDE.md § Modules.

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
    - **⚠️ Filtre statut lead = placement Pennylane** : pour les statuts pilotés par les devis PL (Devis envoyé / Gagné / Perdu), `mail_segment_compile` dérive l'appartenance d'un segment leads de `public.majordhome_kanban_cards` (`column_key`, MT-LT inclus) et NON de `leads.status_id` (figé, ne suit pas la bascule accepted→Gagné / refused→Perdu). Statuts amont (Nouveau / Contacté / RDV planifié) restent sur `status_id`. Branche PL active seulement si `p_org_id` non NULL (sinon fallback `status_id` brut). Mapping label→column_key : Devis envoyé→`devis_envoye`, Gagné→`gagne`, Perdu→`perdu`. À étendre si un nouveau statut PL-driven est ajouté. Question ouverte : vérifier que `mail_segment_count`/`mail_segment_preview` héritent bien de cette RPC.
  - `public.mail_segment_compile_safe(segment_id uuid, campaign_name text) RETURNS text` (P0.8, 2026-05-21) — recharge filters depuis `mail_segments` côté serveur + check `auth.uid() ∈ org_members` + délègue à `mail_segment_compile`. Utilisée par `mailing-send` edge function.
  - `public.mail_single_client_sql(client_id uuid, campaign_name text) RETURNS text` (P0.8) — SQL pour 1 destinataire transactionnel, membership-checked.
  - `public.mail_fetch_recipients(segment_id?, client_id?, campaign_name?)` (P0.8 V2) — wrapper appelé par `mailing-send`, compile + exécute en 1 aller-retour, retourne directement les rows destinataires.
  - `public.mail_segment_count(filters, campaign_name, org_id) RETURNS integer` — COUNT(*) sur le SQL compilé
  - `public.mail_segment_preview(filters, campaign_name, org_id, limit) RETURNS TABLE(...)` — N premiers destinataires
  - `public.mail_campaigns_due() RETURNS TABLE(...)` — campagnes `is_automated=true AND next_run_at <= NOW()`, consommée par le scheduler N8n
  - `public.mail_campaign_mark_run(campaign_id) RETURNS timestamptz` — update `last_run_at=NOW()` + calcule `next_run_at` selon cadence
- **Constantes shared** :
  - `src/apps/artisan/components/mailing/segmentBuilder.constants.js` — audiences/housing/DPE/order_by + `buildEmptyFilters()` + `updateFilters()` (immutable path update)
  - `src/apps/artisan/components/mailing/resources.js` — 📌 caisse à outils URLs Mayer (CTA, services, blog, zones, contact). Source de vérité pour l'IA — à mettre à jour à chaque nouvelle ressource
- **Provider email** : Resend (API `https://api.resend.com/emails`) — bascule depuis Gmail le 2026-04-11
- **Edge function `mailing-send`** (P0.8 V2, 2026-05-21) : moteur d'envoi mailing pilote par le frontend / scheduler. Accepte `{ segment_id, campaign_id }` (broadcast) OU `{ client_id, campaign_id }` (transactionnel) — JAMAIS de SQL brut. RPC `mail_fetch_recipients(segment_id?, client_id?, campaign_name?)` membership-checked compile et exécute côté DB. Squelette HTML commun (`core.organizations.settings.email_skeleton_html`) appliqué automatiquement aux templates body-only.
- **Edge function `contract-signed-notify`** (P0.14 transactionnel, 2026-05-21) : envoi transactionnel "contrat signé" multi-tenant. Charge contract + org settings + template `contrat_signature_confirm` depuis DB, télécharge PDF, envoie via Resend avec PDF en attachement, log dans `mailing_logs`. Remplace l'ancien workflow N8N "Mayer - Entretien Contrat".
- **Edge function webhook Resend** : `supabase/functions/resend-webhook/` (verify_jwt: false, Svix HMAC SHA256 via Web Crypto API, RPC atomique)
- **Edge function unsubscribe** : `supabase/functions/mailing-unsubscribe/` (verify_jwt: false, token HMAC SHA256 signé avec `RESEND_WEBHOOK_SECRET`, GET = page HTML confirmation + POST = one-click RFC 8058)
- **Edge function avis-redirect** : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/avis-redirect` — redirige vers fiche Google Reviews Mayer + tracke le clic via `?log_id=` (utilisée dans SMS et accessible aux mails)
- **Ancien webhook N8n `mayer-mailing` (id `1COgLUuiMtSq2sUq`)** : **ARCHIVÉ depuis P0.8 V2** (2026-05-21). Acceptait `segment_sql` brut — vulnérabilité cross-org si URL fuite. Ne plus appeler.

### Segment Builder (onglet Segments)
Builder à facettes 4 blocs : **Population** (audience + base filters) / **Attributs** (géo, logement, équipement, source, Meta, tags, dates) / **Historique mailing** (exclure campagnes reçues, cooldown, engagement ouvert/cliqué) / **Preview** (count live + table 20 destinataires + tri/limite). Sauvegarde dans `mail_segments` avec jsonb filters. Voir DSL dans `docs/MAILING_SEGMENT_BUILDER.md` §3.

### Scheduler Campagnes Auto (edge `mailing-scheduler` — pg_cron, depuis 2026-06-02)
> ⚠️ Remplace l'ancien workflow N8n « Mayer - Scheduler Campagnes Auto ». **Régression vécue 21/05→02/06** : après l'archivage du webhook `mayer-mailing` (P0.8 V2), le scheduler N8n continuait d'appeler `mail_campaigns_due` + `mail_campaign_mark_run` (donc `last_run_at` avançait, masquant la panne) sans plus jamais envoyer → ~12 jours sans bienvenue ni relances.

- **Edge `mailing-scheduler`** (`verify_jwt:false`, protégée par `MDH_CRON_SECRET`), planifiée par `pg_cron` toutes les 10 min (migration `20260602_mailing_scheduler_cron.sql`, secret lu depuis `vault.decrypted_secrets`). App-level cross-org : 1 cron pour toutes les orgs, chaque campagne porte son `org_id`.
- Pour chaque campagne due (`mail_campaigns_due()`) : POST `mailing-send` mode bulk → `mail_campaign_mark_run` **UNIQUEMENT si HTTP 2xx** (self-healing : un échec gateway laisse la campagne due, pas de fenêtre consommée à vide). Body `{ dry_run: true }` supporté pour pré-vérif.
- **Règle** : une edge cron qui orchestre une autre edge doit conditionner son `mark_run`/`commit` à la réussite HTTP de l'edge appelée (sinon une panne gateway consomme la fenêtre sans effet).
- Workflow N8n scheduler **à archiver** côté N8n ; `docs/n8n/MAILING_SCHEDULER_SETUP.md` obsolète.

### Onboarding domaine Resend (multi-tenant, 2026-06-02)
Pour qu'une org envoie depuis `@<son-domaine>`, l'admin passe par **Settings → Organization → Coordonnées → « Domaine d'envoi (Resend) »** (`ResendDomainSection.jsx`, visible une fois `from_email` enregistré). Edge `resend-domain-onboard` (`verify_jwt:true`, `requireOrgMembership(requiredRole:'org_admin')`) = proxy mince vers l'API Domains Resend (région `eu-west-1` RGPD), actions `setup`/`status`/`verify`. **Archi app-level vs org-level** : le moteur Resend (clé API) est app-level (1 compte partagé entre orgs cohabitantes) ; le domaine est org-level, **strictement dérivé de `settings.from_email`** (pas d'input libre — un admin ne peut pas enregistrer un domaine arbitraire dans le compte partagé). Statut persisté dans `settings.resend` (cache d'affichage). Pattern à reprendre pour toute intégration tierce app-level : dériver la ressource org d'un setting déjà validé par l'UI.

### Éditeur de campagne (wizard 3 étapes)
1. **Identité** : libellé (clé technique auto-générée par slugify), Contexte (objectif, cible, notes), ton éditorial (5 choix + Autre), **bloc Automatisation** (toggle + choix `auto_segment_id` dans le catalogue + cadence jours OU minutes + heure d'envoi)
2. **Brief** : ligne éditoriale (textarea libre — l'IA structure les blocs elle-même), objet/preheader facultatifs (l'IA propose sinon)
3. **Génération** : prompt système copiable (inclut carte d'identité + brief + caisse à outils URLs + types de blocs disponibles + contraintes techniques) + JSON structuré + textarea HTML final + bouton Prévisualiser (iframe overlay)

**Workflow V1 (copier-coller)** : wizard → prompt copié → chat Claude → HTML généré → coller dans textarea (auto-extraction OBJET/PREHEADER depuis commentaire HTML en tête) → Sauvegarder. Validation : impossible de save/envoyer si subject vide.

**Vdef prévue** : remplacer l'étape 3 par appel API direct Anthropic au lieu du copier-coller.

### Edge function `mailing-send` (P0.8 V2 — remplace ancien workflow N8n)
Moteur d'envoi mailing centralisé. Le frontend appelle `supabase.functions.invoke('mailing-send', { body: {...} })`. Le scheduler N8n auto-campagnes appelle l'edge avec `service_role` au lieu d'un webhook public.

**Modes** :
- **Broadcast** : `{ campaign_id, segment_id, test_email? }` — RPC `mail_fetch_recipients(p_segment_id, ...)` compile + exécute le SQL membership-checked
- **Transactionnel** : `{ campaign_id, client_id }` (ou `lead_id`) — RPC `mail_fetch_recipients(p_client_id=...)` pour 1 destinataire

**Sécurité** :
- `verify_jwt:false` — auth interne via `requireSharedSecret(MDH_CRON_SECRET)` (appel du scheduler `mailing-scheduler`) OU validation JWT user en début de handler (frontend). ⚠️ **Gotcha clé `sb_secret`** : le projet utilise une clé service_role au format `sb_secret` (non-JWT, récent) → une edge `verify_jwt:true` ne peut PAS être appelée avec cette clé via le gateway. Conséquence : tout appel inter-edges doit être `verify_jwt:false` + secret partagé. ⚠️ **Drift repo/prod** : la v11+ prod (badge cron + INSERT via vue publique `majordhome_mailing_logs`) n'est pas resynchronisée dans le repo → faire `get_edge_function` avant toute modif de `mailing-send`.
- Le SQL n'est JAMAIS accepté du client — toujours compilé côté DB après check `auth.uid() ∈ org_members`
- `mail_campaigns.is_transactional=true` → exclu de l'onglet Envoi broadcast (sécurité UX)

**Templates** :
- Squelette HTML commun dans `core.organizations.settings.email_skeleton_html` (+ `secondary_color`, `email_tagline`) appliqué automatiquement aux templates body-only.
- Templates legacy `mail_a..g`, `lead_bienvenue`, etc. : détectés via heuristique `<!DOCTYPE>` et laissés intacts (migration progressive).
- Placeholder `{{SALUTATION}}` remplacé par "Bonjour Prénom Nom," dans le squelette.

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

### Templates campagnes broadcast (7)
| Template | Cible | Objet |
|----------|-------|-------|
| `mail_a` | Clients contrat actif | Information — Mayer Energie reprend le suivi |
| `mail_b` | Clients sans contrat | Offre Exclusive — reprise Econhome |
| `mail_c` | Clients contrat clos | Reconquête Info — ancien contrat |
| `mail_d` | Clients contrat clos | Offre Reconquête — retour client |
| `mail_e` | Leads Contacté | Relance Contacté — rappel à bon souvenir |
| `mail_f` | Leads Devis envoyé | Relance Devis — suivi devis + aides + prix |
| `mail_g` | Leads Perdu | Remerciement — ressources site web |

### Templates transactionnels (`mail_campaigns.is_transactional=true`)
Déclenchés 1-à-1 sur événement (pas envoyés en broadcast). Exclus de l'onglet Envoi.

| Template | Trigger | Placeholders custom | Lieu de remplacement |
|----------|---------|---------------------|---------------------|
| `contrat_signature_confirm` | Signature contrat | `{{CLIENT_NAME}}`, `{{BRAND_NAME}}`, `{{ORG_EMAIL}}`, `{{ORG_PHONE}}`, `{{ORG_ADDRESS}}`, `{{ORG_POSTAL_CODE}}`, `{{ORG_CITY}}`, `{{ACCENT_COLOR}}` | Edge function `contract-signed-notify` (charge `core.organizations.settings`) |
| `proposition_contrat` | Envoi devis depuis fiche client | `{{EQUIP_RECAP}}`, `{{TOTAL_AMOUNT}}`, `{{PDF_URL}}` | Frontend `ContractPdfSection.jsx:handleSendProposal` (replaceAll côté client) |

**Convention** : éditables via onglet Mailing → Éditeur. La colonne `mail_campaigns.is_transactional BOOLEAN` distingue les transactionnels des broadcast. Pour ajouter une 3ᵉ campagne transactionnelle, considérer centraliser le `replaceAll` dans `mailCampaignsService.renderTemplate(orgId, key, vars)` plutôt qu'inline.

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
Toute campagne avec `is_automated = true` + `auto_segment_id` + cadence est déclenchée par l'edge `mailing-scheduler` (pg_cron 10 min, cf. sous-section dédiée ci-dessus). `lead_bienvenue` est la 1ʳᵉ campagne (cadence `auto_cadence_minutes=10`).

### Tags mailing dans fiche lead
- Statut **Contacté** (display_order 2) : tag indigo "Mailing Relance" si campagne Contacté envoyée
- Statut **Devis envoyé** (display_order 4) : tag ambre "Mailing Relance Devis" si campagne Devis envoyée
- Tags en lecture seule, chargés depuis `mailing_logs` via `lead_id`
- La checkbox "Mail envoyé" reste manuelle (usage commercial)

### Compteur destinataires
Utilise la RPC `public.mail_segment_count(filters, campaign_name, org_id)` qui compile puis COUNT(*) en un seul aller-retour. Le résultat s'affiche en badge à côté du sélecteur de segment. Le toast et la confirmation utilisent le nombre réel de destinataires.

### SMS rappel entretien
2ème campagne SMS, distincte de l'avis post-entretien (`avis_j1`). Objectif : prévenir un client sous contrat que son entretien annuel est à programmer.
- **Déclenchement** : bulle SMS (`MessageSquare`→`Loader2`→`Check` vert) sur chaque ligne de l'onglet **Programmation** (`SectorGroupView`), **uniquement** sur les contrats « à planifier » (mêmes conditions que le bouton « Planifier » — jamais sur une ligne grisée). Permission = `can('entretiens','create')`.
- **Envoi** : `savService.sendEntretienReminder({contractId, clientId, clientFirstName, clientName, clientPhone, orgId})` → POST webhook N8N `VITE_N8N_WEBHOOK_SMS_RAPPEL` (à déclarer dans `.env` + Vercel, **redeploy obligatoire** car `VITE_*` figé au build). Mono-mobile, validation `isMobileFR` (`src/lib/phoneUtils.js`, partagé avec `sendAvisRequest`).
- **État « déjà relancé cet an »** = **option A** : dérivé de `majordhome_sms_logs` (`campaign_name='rappel_entretien'`, `sent_at ≥ 1er janvier`), **pas de colonne dédiée**. Reset implicite au 01/01. Cache key `smsKeys.remindedClients(orgId, year)`, invalidée après chaque envoi. Le log `sms_logs` (créé par N8N) est la **clé de voûte** : sans lui la bulle ne se fige pas et autorise les doublons.
- **N8N** : workflow dédié `mayer-sms-rappel-entretien` (dupliqué de l'avis puis simplifié **SMS seul**, branche WhatsApp supprimée). Compose le message (nom+prénom MAJUSCULES + `deburr` accents → SMS GSM-7 2 segments), log `sms_logs` (`campaign_name='rappel_entretien'`, `channel='sms'`). Pas de writeback intervention (contrairement à `avis_j1` qui pose `sms_avis_sent`).
- **Gotcha** : `sms_logs` n'a pas de `contract_id` → l'état est indexé par `client_id` ; un client multi-contrats voit ses lignes marquées « rappelé » après un seul envoi (acceptable V1, contrats < clients).

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

