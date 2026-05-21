# PWA Voice — Compte-rendu vocal Mayer Énergie

> **Phase 1 — M1** (2026-05-01) — Mémo vocal post-RDV terrain / réunion / note libre.
> Voir `docs/PHASE1_VOICE_AUDIT.md` et `docs/PHASE1_VOICE_MARKET_RESEARCH.md`.

## Pipeline

```
PWA (cette app)
  ↓ MediaRecorder (webm/opus | mp4 sur iOS)
  ↓ uploadAudio → Supabase Storage bucket `project-recordings/voice-memos/{org_id}/{uuid}.{ext}`
  ↓ getSignedUrl (1h)
  ↓ POST webhook N8N "Mayer - Voice Field Report"
       ├── transcribe-dictation (edge fn existante, Whisper FR)
       ├── voice-extract-fieldreport (edge fn à déployer, Claude + prompt CVC)
       └── RPC public.record_voice_memo_extraction
            ├── INSERT/UPDATE majordhome.voice_memos
            ├── find_or_create_client (RPC existante)
            └── INSERT majordhome.leads (si memo_type='rdv_terrain')
  ↓ HTTP reply { voice_memo_id, lead_id, client_id, status }
PWA affiche succès + lien vers le lead
```

## Variables d'environnement

À ajouter dans `.env.local` :

```
VITE_N8N_WEBHOOK_VOICE=https://n8n.srv1102213.hstgr.cloud/webhook/mayer-voice-field-report
```

(L'URL définitive sera fixée quand le workflow N8N sera créé.)

## Whitelist (M1)

Hardcodée dans `components/VoiceAccessGate.jsx` :
- Eric Pudebat (`8a4907a3-...`)
- Philippe Mazel (`69e365ef-...`)

À migrer vers une table `voice_memo_authorized_users` ou la permission system existante en M2.

## Installer la PWA sur iPhone (Philippe)

1. Ouvrir Safari sur `https://app.majordhome.fr/voice` (ou URL équivalente prod)
2. Se connecter avec ses identifiants Mayer
3. Appuyer sur le bouton **Partager** ↑ en bas de Safari
4. Sélectionner **Sur l'écran d'accueil**
5. Confirmer le nom (« Mayer Voice ») et appuyer **Ajouter**
6. L'icône Mayer apparaît sur l'écran d'accueil iPhone — démarre en plein écran sans la barre Safari

## Prochaines features (M2-M5)

- **M2** : sélecteur client en amont (combobox fuzzy) + toggle type appliquant des prompts différents
- **M3** : upload photos terrain + Claude Vision (lecture marque/modèle équipement)
- **M4** : brouillon email Gmail + tâches Google Calendar
- **M5** : liste des derniers vocaux + édition rapide + onglet "Vocaux" sur fiche client

## Structure

```
src/apps/voice/
├── routes.jsx              — Routes / (1 seule en M1)
├── layouts/
│   └── VoiceLayout.jsx     — Layout fullscreen mobile (pas AppLayout sidebar)
├── components/
│   └── VoiceAccessGate.jsx — Whitelist M1
├── pages/
│   └── VoiceRecorder.jsx   — Page principale : bouton + states
├── hooks/
│   └── useAudioRecording.js — Wrapper MediaRecorder API
├── services/
│   └── voiceMemos.service.js — Upload Storage + submit N8N + getMemoStatus
└── README.md               — ce fichier
```
