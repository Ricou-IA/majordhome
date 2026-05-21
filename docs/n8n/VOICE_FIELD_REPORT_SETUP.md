# Setup workflow N8N — `Mayer - Voice Field Report`

> Phase 1 voice agent — pipeline d'orchestration mémo vocal.
> **Prérequis** : migration `phase1_voice_memos_table_rpc` appliquée + edge function `voice-extract-fieldreport` v1 déployée.

## Vue d'ensemble

```
PWA /voice → POST /webhook/mayer-voice-field-report
   ├─ 1. Webhook (capture body + JWT user)
   ├─ 2. Validate Input (Code) — extract payload, check required fields
   ├─ 3. Download Audio (HTTP GET) — récupère le fichier audio depuis le signed URL Storage
   ├─ 4. Whisper Transcribe (HTTP POST OpenAI) — transcript FR
   ├─ 5. Voice Extract (HTTP POST edge function) — extraction JSON via Claude/GPT-4o
   ├─ 6. Persist RPC (HTTP POST /rest/v1/rpc/record_voice_memo_extraction) — DB write
   └─ 7. Respond Webhook — { voice_memo_id, lead_id, client_id, status }
```

## Variables d'environnement N8N

Dans **n8n → Settings → Variables** (ou via credentials génériques) :

| Variable | Valeur |
|---|---|
| `SUPABASE_URL` | `https://odspcxgafcqxjzrarsqf.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `<service_role_key>` (Supabase Dashboard → Settings → API) |

Si N8N bloque `$env.*` (cas de Mayer cf. CLAUDE.md), hardcode-les directement dans les nœuds HTTP (Eric a déjà ce pattern dans ses workflows).

## Credential N8N requis

| Nom | Type | Usage |
|---|---|---|
| `OpenAI` | OpenAI API | Node 4 (Whisper) — clé `sk-...` |

## Étapes de création

Dans `n8n.srv1102213.hstgr.cloud` → **+ New Workflow** → renommer `Mayer - Voice Field Report`.

---

### Node 1 — Webhook

- **Type** : `Webhook`
- **HTTP Method** : `POST`
- **Path** : `mayer-voice-field-report`
- **Response Mode** : **Using 'Respond to Webhook' Node**
- **Authentication** : `None`

→ URL produite : `https://n8n.srv1102213.hstgr.cloud/webhook/mayer-voice-field-report`

---

### Node 2 — Code "Validate Input"

- **Type** : `Code` (Javascript)
- **Mode** : `Run Once for All Items`

```javascript
// Extract payload from PWA
const input = $input.first().json;
const body = input.body || input;
const headers = input.headers || {};

const required = [
  'voice_memo_id', 'org_id', 'recorded_by',
  'audio_path', 'audio_signed_url', 'memo_type'
];
const missing = required.filter((k) => !body[k]);
if (missing.length > 0) {
  throw new Error(`Missing required fields: ${missing.join(', ')}`);
}

// Capture user JWT (PWA Philippe) — sent as Authorization: Bearer <jwt>
const authHeader = headers.authorization || headers.Authorization || '';
const userJwt = authHeader.replace(/^Bearer\s+/i, '');

return [{
  json: {
    voice_memo_id: body.voice_memo_id,
    org_id: body.org_id,
    recorded_by: body.recorded_by,
    audio_path: body.audio_path,
    audio_signed_url: body.audio_signed_url,
    audio_duration_seconds: body.audio_duration_seconds || null,
    audio_size_bytes: body.audio_size_bytes || null,
    audio_mime_type: body.audio_mime_type || 'audio/webm',
    memo_type: body.memo_type || 'rdv_terrain',
    client_id_hint: body.client_id_hint || null,
    user_jwt: userJwt, // pour propager si besoin
    submitted_at: body.submitted_at || new Date().toISOString(),
  }
}];
```

---

### Node 3 — HTTP Request "Download Audio"

- **Type** : `HTTP Request`
- **Method** : `GET`
- **URL** : `={{ $json.audio_signed_url }}`
- **Authentication** : `None` (le signed URL contient déjà le token)
- **Response → Response Format** : **File**
- **Response → Put Output File in Field** : `data` (default)
- **Options → Response → Include Response Headers and Status** : **off**

Le fichier audio est maintenant dans `binary.data`.

---

### Node 4 — HTTP Request "Whisper Transcribe"

- **Type** : `HTTP Request`
- **Method** : `POST`
- **URL** : `https://api.openai.com/v1/audio/transcriptions`
- **Authentication** : **Predefined Credential Type → OpenAI API** (utiliser le credential OpenAI déjà existant chez toi)
- **Body Content Type** : `multipart-form-data`
- **Body Parameters** :

| Name | Type | Value |
|---|---|---|
| `file` | **n8n Binary File** | Input Data Field Name : `data` |
| `model` | Form Data | `whisper-1` |
| `language` | Form Data | `fr` |
| `response_format` | Form Data | `verbose_json` |

→ Output : `{ text, duration, language, segments... }`

---

### Node 5 — HTTP Request "Voice Extract"

- **Type** : `HTTP Request`
- **Method** : `POST`
- **URL** : `https://odspcxgafcqxjzrarsqf.supabase.co/functions/v1/voice-extract-fieldreport`
- **Authentication** : `None` (l'edge function est en `verify_jwt: false`)
- **Send Headers** : ON
  - `Content-Type` : `application/json`
- **Send Body** : ON
- **Body Content Type** : `JSON`
- **JSON Body** :

```javascript
={{ JSON.stringify({
  transcript: $('Whisper Transcribe').item.json.text,
  memo_type: $('Validate Input').item.json.memo_type,
  duration_seconds: Math.round($('Whisper Transcribe').item.json.duration || 0)
}) }}
```

→ Output : `{ success, memo_type, extraction: {...}, model, processing_time_ms, tokens }`

---

### Node 6 — HTTP Request "Persist RPC"

- **Type** : `HTTP Request`
- **Method** : `POST`
- **URL** : `https://odspcxgafcqxjzrarsqf.supabase.co/rest/v1/rpc/record_voice_memo_extraction`
- **Authentication** : `None`
- **Send Headers** : ON
  - `apikey` : `<SUPABASE_SERVICE_ROLE_KEY>` (hardcode ici si `$env` bloqué)
  - `Authorization` : `Bearer <SUPABASE_SERVICE_ROLE_KEY>`
  - `Content-Type` : `application/json`
- **Send Body** : ON
- **Body Content Type** : `JSON`
- **JSON Body** :

```javascript
={{ JSON.stringify({
  p_data: {
    voice_memo_id: $('Validate Input').item.json.voice_memo_id,
    org_id: $('Validate Input').item.json.org_id,
    recorded_by: $('Validate Input').item.json.recorded_by,
    audio_path: $('Validate Input').item.json.audio_path,
    audio_duration_seconds: Math.round($('Whisper Transcribe').item.json.duration || $('Validate Input').item.json.audio_duration_seconds || 0),
    audio_size_bytes: $('Validate Input').item.json.audio_size_bytes,
    audio_mime_type: $('Validate Input').item.json.audio_mime_type,
    transcript: $('Whisper Transcribe').item.json.text,
    extraction_json: $('Voice Extract').item.json.extraction,
    memo_type: $('Validate Input').item.json.memo_type,
    processing_time_ms: $('Voice Extract').item.json.processing_time_ms
  }
}) }}
```

→ Output : `{ voice_memo_id, client_id, lead_id, status: 'persisted', client_action, memo_type }`

---

### Node 7 — Respond to Webhook

- **Type** : `Respond to Webhook`
- **Respond With** : `JSON`
- **Response Body** :

```javascript
={{ JSON.stringify({
  success: true,
  voice_memo_id: $('Validate Input').item.json.voice_memo_id,
  client_id: $json.client_id || null,
  lead_id: $json.lead_id || null,
  status: $json.status || 'persisted',
  client_action: $json.client_action || null,
  memo_type: $('Validate Input').item.json.memo_type,
  transcript_preview: ($('Whisper Transcribe').item.json.text || '').slice(0, 200)
}) }}
```

- **Response Code** : `200`

---

## Connexions

```
1. Webhook → 2. Validate Input → 3. Download Audio → 4. Whisper Transcribe
  → 5. Voice Extract → 6. Persist RPC → 7. Respond to Webhook
```

(linéaire, pas de branchement)

## Gestion d'erreurs (M1 minimal)

Pour M1, en cas d'erreur dans un nœud, l'exécution échoue et le webhook répond 500. La PWA affichera "Échec de l'envoi" et propose de réessayer.

À ajouter en M2 (optionnel) :
- Branche d'erreur `On Error → Set memo status='error'` pour tracer dans `voice_memos.error_message`
- Notification SMS Eric si plus de 3 erreurs consécutives

## Variables côté frontend

Dans `.env.local` du repo Frontend-Majordhome :

```
VITE_N8N_WEBHOOK_VOICE=https://n8n.srv1102213.hstgr.cloud/webhook/mayer-voice-field-report
```

## Test manuel rapide (avant test E2E PWA)

Une fois le workflow activé, teste avec curl :

```bash
# 1. Récupère un signed URL Supabase pour un audio test (uploade manuellement dans le bucket project-recordings d'abord)

# 2. POST au webhook
curl -X POST https://n8n.srv1102213.hstgr.cloud/webhook/mayer-voice-field-report \
  -H "Content-Type: application/json" \
  -d '{
    "voice_memo_id": "00000000-0000-0000-0000-000000000001",
    "org_id": "3c68193e-783b-4aa9-bc0d-fb2ce21e99b1",
    "recorded_by": "8a4907a3-f382-4707-bc38-2ff4832f873a",
    "audio_path": "voice-memos/3c68193e.../test.webm",
    "audio_signed_url": "https://...signed-url...",
    "audio_mime_type": "audio/webm",
    "memo_type": "rdv_terrain"
  }'
```

→ Réponse attendue (200) : `{ success: true, voice_memo_id, lead_id, client_id, status: 'persisted', transcript_preview }`

## Activation

Une fois testé : toggle **Active** sur le workflow. Le webhook passe de `/webhook-test/...` à `/webhook/...` (URL prod).

## Coûts estimés (Mayer)

- 10 vocaux/sem × 4 sem = **40/mois**
- Whisper : ~2 min/vocal × 40 × $0,006/min = **$0,48/mois**
- GPT-4o extraction : ~3000 tokens in + 1500 out × 40 = **$0,42/mois**
- Stockage audio : ~3 Mo/vocal × 40 = 120 Mo (négligeable)

→ **Total : ~€1/mois pour Mayer en run.**

## Évolutions prévues (M2-M5)

- **M2** : ajouter sélection client en amont (clientIdHint forcé) — l'IA n'a plus à deviner le matching
- **M3** : ajouter upload photos terrain → branche parallèle uploadant dans bucket `interventions` puis Claude Vision pour extraire marque/modèle équipement
- **M4** : ajouter génération brouillon email Gmail + création tâches Google Calendar dans le workflow
- **M5** : ajouter SMS récap Twilio (Sender ID `Mayer-SAV`) à Philippe à la fin
