import { supabase } from '@lib/supabaseClient';

/**
 * Service voice memos.
 *
 * 2 étapes pour envoyer un mémo :
 *   1. uploadAudio(blob, ctx) → upload dans bucket Supabase Storage `project-recordings`,
 *      retourne { audio_path, audio_size_bytes, audio_mime_type }
 *   2. submitMemo({ audio_path, ... }) → POST vers webhook N8N qui orchestre
 *      Whisper → Claude → RPC record_voice_memo_extraction
 */

const N8N_WEBHOOK_VOICE = import.meta.env.VITE_N8N_WEBHOOK_VOICE || '';
const STORAGE_BUCKET = 'project-recordings';

function extFromMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg')) return 'mp3';
  return 'webm';
}

export const voiceMemosService = {
  /**
   * Upload audio blob into Supabase Storage.
   * Path pattern: {org_id}/voice-memos/{voice_memo_id}.{ext}
   * (org_id en premier pour respecter la policy RLS `recordings_insert_own_org`
   * qui filtre sur (storage.foldername(name))[1] = org_id du user)
   */
  async uploadAudio(blob, { orgId, voiceMemoId }) {
    if (!blob) throw new Error('Audio blob requis');
    if (!orgId) throw new Error('orgId requis');
    if (!voiceMemoId) throw new Error('voiceMemoId requis');

    const ext = extFromMime(blob.type);
    const path = `${orgId}/voice-memos/${voiceMemoId}.${ext}`;

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, blob, {
        contentType: blob.type || 'audio/webm',
        upsert: false,
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    return {
      audio_path: path,
      audio_size_bytes: blob.size,
      audio_mime_type: blob.type || 'audio/webm',
      bucket: STORAGE_BUCKET,
    };
  },

  /**
   * Get a signed URL for the uploaded audio (used by N8N to download via Whisper).
   */
  async getSignedUrl(path, expiresIn = 3600) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, expiresIn);

    if (error) throw new Error(`Signed URL failed: ${error.message}`);
    return data.signedUrl;
  },

  /**
   * Submit memo to N8N pipeline.
   * Payload describes the audio and metadata; N8N downloads, transcribes, extracts, persists.
   * Returns whatever N8N replies (typically { voice_memo_id, lead_id, client_id, status }).
   */
  async submitMemo({
    voiceMemoId,
    orgId,
    recordedBy,
    audioPath,
    audioSignedUrl,
    audioDurationSeconds,
    audioSizeBytes,
    audioMimeType,
    memoType = 'rdv_terrain',
    clientIdHint = null,
    appointmentId = null,
  }) {
    if (!N8N_WEBHOOK_VOICE) {
      throw new Error(
        'VITE_N8N_WEBHOOK_VOICE non configuré dans .env'
      );
    }

    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;

    const res = await fetch(N8N_WEBHOOK_VOICE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify({
        voice_memo_id: voiceMemoId,
        org_id: orgId,
        recorded_by: recordedBy,
        audio_path: audioPath,
        audio_signed_url: audioSignedUrl,
        audio_duration_seconds: audioDurationSeconds,
        audio_size_bytes: audioSizeBytes,
        audio_mime_type: audioMimeType,
        memo_type: memoType,
        client_id_hint: clientIdHint,
        appointment_id: appointmentId,
        submitted_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`N8N webhook ${res.status}: ${errText}`);
    }

    return res.json();
  },

  /**
   * Crée (ou matche) un client depuis les données prospect saisies en amont.
   * Utilisé quand Philippe a choisi "+ Nouveau prospect" — on a juste un nom + tel.
   * Returns the client_id à passer ensuite en client_id_hint.
   */
  async createOrMatchProspect({ orgId, lastName, firstName, phone, city }) {
    const { data, error } = await supabase.rpc('find_or_create_client', {
      p_org_id: orgId,
      p_last_name: lastName,
      p_first_name: firstName,
      p_phone: phone,
      p_city: city,
      p_client_category: 'particulier',
      p_source: 'voice_pwa_prospect',
    });
    if (error) throw new Error(`Création prospect échouée : ${error.message}`);
    return data; // { client_id, action, match_type, ... }
  },

  /**
   * Poll voice_memo status (alternative to webhook reply for long-running pipelines).
   */
  async getMemoStatus(voiceMemoId) {
    const { data, error } = await supabase
      .from('majordhome_voice_memos')
      .select('id, status, error_message, client_id, lead_id, transcript')
      .eq('id', voiceMemoId)
      .single();

    if (error) throw new Error(`Get memo failed: ${error.message}`);
    return data;
  },
};

export default voiceMemosService;
