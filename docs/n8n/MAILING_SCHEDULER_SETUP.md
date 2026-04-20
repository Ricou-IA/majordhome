# Mayer — Scheduler Campagnes Auto (Cron générique) — Guide d'installation

> Workflow N8n unique qui, toutes les 10 minutes, identifie toutes les campagnes mail automatisées prêtes à partir (`mail_campaigns.is_automated = true` + `next_run_at ≤ NOW()`), compile leur segment via RPC et déclenche l'envoi sur le workflow `Mayer - Mailing` existant.
>
> **Remplace** le cron dédié `lead_bienvenue` : celui-ci devient simplement une campagne automatique comme les autres, branchée sur le segment `Leads Nouveau — Bienvenue` avec cadence `auto_cadence_minutes = 10`.

## Principe

- **Source unique** : toute campagne `mail_campaigns` marquée `is_automated = true` avec un `auto_segment_id` + cadence apparaît dans la RPC `mail_campaigns_due()`.
- **Cadence** :
  - `auto_cadence_days` → envoi à l'heure `auto_time_of_day` tous les N jours.
  - `auto_cadence_minutes` → envoi toutes les N minutes (cas `lead_bienvenue`).
- **Idempotence** : le compiler SQL ajoute systématiquement le filtre `NOT IN mailing_logs WHERE campaign_name = <label>` (pas de doublon même si le cron tourne en parallèle).
- **Anti-flood** : le scheduler ordonne par `next_run_at ASC NULLS FIRST`, on peut limiter le batch dans un Split In Batches si plusieurs campagnes cumulent.
- **Skip silencieux** si campagne incomplète (subject/html_body vide) : la RPC `mail_campaigns_due()` filtre ces cas.

## Prérequis (déjà en place via migration)

- Table `majordhome.mail_segments` + 7 presets seed
- Colonnes ajoutées sur `majordhome.mail_campaigns` : `is_automated`, `auto_segment_id`, `auto_cadence_days`, `auto_cadence_minutes`, `auto_time_of_day`, `last_run_at`, `next_run_at`
- RPCs déployées :
  - `public.mail_campaigns_due() RETURNS TABLE(...)`
  - `public.mail_segment_compile(filters, campaign_name, org_id) RETURNS text`
  - `public.mail_campaign_mark_run(campaign_id) RETURNS timestamptz`

## Structure du workflow

```
[Schedule Trigger 10 min]
   │
   ▼
[HTTP POST — mail_campaigns_due]   (liste les campagnes à déclencher)
   │
   ▼
[Split In Batches 1]               (1 campagne à la fois)
   │
   ▼
[HTTP POST — mail_segment_compile] (compose la SQL du segment)
   │
   ▼
[Code — Build payload]             (merge segment_sql + campagne)
   │
   ▼
[HTTP POST — webhook Mayer-Mailing] (envoi via workflow existant)
   │
   ▼
[HTTP POST — mail_campaign_mark_run] (update last_run_at + next_run_at)
   │
   ▼
[End of loop]
```

## Noeuds détaillés

### 1. Schedule Trigger

- Type : **Schedule Trigger**
- Interval : `Every 10 Minutes`

### 2. HTTP Request — mail_campaigns_due

- Type : **HTTP Request**
- Method : `POST`
- URL : `https://odspcxgafcqxjzrarsqf.supabase.co/rest/v1/rpc/mail_campaigns_due`
- Authentication : `Header Auth` → credential « Supabase service_role » (`Authorization: Bearer <SERVICE_ROLE_JWT>`)
- Send Headers → Add Header :
  - `apikey` = **la service_role JWT en clair** (même valeur que dans le credential, sans préfixe `Bearer `)
  - `Accept` = `application/json`
  - `Content-Type` = `application/json`
- Body Content Type : `JSON`
- Specify Body : `Using JSON`
- JSON : `{}`
- **On Error** : `Stop Workflow`

### 3. Split In Batches

- Type : **Split In Batches**
- Batch Size : `1`
- On Error : `Continue Regular Output` (si une campagne échoue, les autres passent)

### 4. HTTP Request — mail_segment_compile

- Type : **HTTP Request**
- Method : `POST`
- URL : `https://odspcxgafcqxjzrarsqf.supabase.co/rest/v1/rpc/mail_segment_compile`
- Authentication + Headers : **identique au noeud 2** (credential + apikey)
- Body Content Type : `JSON`
- Specify Body : `Using JSON`
- JSON (expression) :
  ```json
  {
    "p_filters": {{ JSON.stringify($json.segment_filters) }},
    "p_campaign_name": {{ JSON.stringify($json.campaign_label) }},
    "p_org_id": {{ JSON.stringify($json.org_id) }}
  }
  ```
- Response Format : `JSON`
- **On Error** : `Continue Regular Output`

> ⚠️ `mail_segment_compile` retourne une **chaîne SQL** (type `text`). Supabase REST l'encapsule dans une string en quote — voir le code node suivant pour extraire.

### 5. Code node — Build payload

```javascript
const camp = $items('Split In Batches')[0].json; // Campagne courante
const compiledRaw = $json; // Output du noeud mail_segment_compile

// Supabase REST renvoie soit une string directe (type text), soit un objet wrappé
let segmentSql = '';
if (typeof compiledRaw === 'string') {
  segmentSql = compiledRaw;
} else if (compiledRaw && typeof compiledRaw === 'object') {
  // Certains déploiements REST Supabase wrappent dans { mail_segment_compile: "..." }
  segmentSql = compiledRaw.mail_segment_compile || compiledRaw[0] || '';
}

if (!segmentSql || !camp.subject || !camp.html_body) {
  return []; // skip silencieux
}

// LIMIT de sécurité : le scheduler part sur 500 destinataires max par run
// (évite de flooder Resend si 3000 clients éligibles d'un coup)
const safeSql = `${segmentSql.replace(/;?\s*$/, '')} LIMIT 500;`;

return [{
  json: {
    subject: camp.subject,
    html_body: camp.html_body,
    segment_sql: safeSql,
    campaign_name: camp.campaign_label,
    org_id: camp.org_id,
    recipient_type: camp.segment_audience === 'leads' ? 'lead' : 'client',
    batch_size: 50,
    campaign_id: camp.campaign_id, // utilisé par mark_run plus loin
  },
}];
```

### 6. HTTP Request — webhook Mayer-Mailing

- Type : **HTTP Request**
- Method : `POST`
- URL : **la Production URL du webhook du workflow `Mayer - Mailing`** (ex: `https://<ton-n8n>/webhook/mayer-mailing`)
- Body Content Type : `JSON`
- Specify Body : `Using JSON`
- JSON (expression) : `={{ JSON.stringify({subject: $json.subject, html_body: $json.html_body, segment_sql: $json.segment_sql, campaign_name: $json.campaign_name, org_id: $json.org_id, recipient_type: $json.recipient_type, batch_size: $json.batch_size}) }}`
- Send Headers : OFF (le webhook N8n ne valide rien côté header)
- **On Error** : `Continue Regular Output`

### 7. HTTP Request — mail_campaign_mark_run

- Type : **HTTP Request**
- Method : `POST`
- URL : `https://odspcxgafcqxjzrarsqf.supabase.co/rest/v1/rpc/mail_campaign_mark_run`
- Authentication + Headers : identique au noeud 2
- Body Content Type : `JSON`
- Specify Body : `Using JSON`
- JSON (expression) : `={{ JSON.stringify({ p_campaign_id: $json.campaign_id }) }}`
- **On Error** : `Continue Regular Output` (on veut quand même loopback pour les autres campagnes)

### 8. Loopback vers Split In Batches

- Connecter l'output du noeud `mail_campaign_mark_run` vers l'entrée `Done` de `Split In Batches` (permet de traiter les campagnes suivantes).

## Migration de `lead_bienvenue`

Une fois ce scheduler en place, il **remplace** l'ancien workflow dédié `lead_bienvenue`. Pour migrer :

1. **En DB** — mettre à jour la campagne `lead_bienvenue` pour la brancher sur le segment preset :
   ```sql
   UPDATE majordhome.mail_campaigns
     SET is_automated = true,
         auto_segment_id = (SELECT id FROM majordhome.mail_segments
                             WHERE name = 'Leads Nouveau — Bienvenue'
                               AND org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1'
                             LIMIT 1),
         auto_cadence_minutes = 10,
         auto_cadence_days = NULL,
         next_run_at = NOW()
   WHERE key = 'lead_bienvenue'
     AND org_id = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
   ```

2. **En N8n** — activer ce nouveau scheduler, puis **désactiver** le workflow `Mayer - Lead Bienvenue` (ancien cron dédié). Ne pas le supprimer tant qu'on n'a pas validé 24h de fonctionnement du nouveau.

3. **Validation** — après 24h, vérifier que les leads Nouveau reçoivent bien le mail via :
   ```sql
   SELECT lead_id, email_to, sent_at
   FROM public.majordhome_mailing_logs
   WHERE campaign_name = 'Campagne Onboarding Lead'
   ORDER BY sent_at DESC LIMIT 10;
   ```

## Ajouter une nouvelle campagne automatique (workflow utilisateur)

1. Créer un segment via **Mailing → Segments → Nouveau segment** (ou dupliquer un preset)
2. Créer une campagne via **Mailing → Éditeur → Nouvelle campagne**
3. Dans l'étape Identité, activer **Automatisation** et choisir :
   - le segment créé à l'étape 1
   - la cadence en jours + l'heure d'envoi
4. Sauvegarder → le scheduler prendra en charge l'envoi à la prochaine tick (≤ 10 min après `next_run_at`)

## Troubleshooting (patterns identiques à LEAD_BIENVENUE_CRON_SETUP.md)

- **`401 No API key found`** → l'en-tête `apikey` est vide. Coller la service_role JWT en clair, pas d'expression.
- **Supabase REST renvoie `null` au lieu du SQL** → vérifier les droits `GRANT EXECUTE ON FUNCTION ... TO service_role` (déjà fait par la migration).
- **Pas de déclenchement** → vérifier `SELECT * FROM public.mail_campaigns_due();` en SQL direct, qui doit retourner les campagnes éligibles.
- **Loop infini sur la même campagne** → vérifier que `mail_campaign_mark_run` est bien appelé (update `next_run_at`). Sans cet update, la campagne reste éligible à chaque tick.

## Évolutions possibles

- **Canary mode** : ajouter une colonne `auto_max_recipients_per_run` pour limiter au cas par cas (pour les premiers runs d'une grosse campagne)
- **Window d'envoi** : ne déclencher qu'entre 9h et 18h un jour ouvré (WHERE EXTRACT(hour FROM NOW()) BETWEEN 9 AND 18)
- **Alerting** : en cas d'échec webhook Mayer-Mailing, poster un message Slack via un noeud supplémentaire
