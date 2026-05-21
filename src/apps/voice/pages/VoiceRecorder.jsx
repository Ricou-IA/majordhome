import { useState, useCallback } from 'react';
import {
  Mic, Square, Loader2, CheckCircle2, AlertCircle, RotateCcw,
  ExternalLink, ChevronLeft, MapPin,
} from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import { useAudioRecording } from '../hooks/useAudioRecording';
import { useVoiceContextState } from '../hooks/useVoiceContext';
import { voiceMemosService } from '../services/voiceMemos.service';
import ContextSelector from '../components/ContextSelector';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function genUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function VoiceRecorder() {
  const { user, organization, profile } = useAuth();
  const {
    isRecording, isSupported, durationSeconds, audioBlob, audioUrl,
    error: recError, start, stop, reset,
  } = useAudioRecording();

  const {
    context,
    selectAppointment, selectExistingClient,
    selectNewProspect, selectNoteLibre, reset: resetContext,
  } = useVoiceContextState();

  // Sub-toggle 'reunion' vs 'note_libre' uniquement pour le mode 'note'
  const [noteSubType, setNoteSubType] = useState('note_libre');

  const [submitState, setSubmitState] = useState('idle'); // idle | uploading | submitting | success | error
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

  const handleStop = useCallback(async () => {
    await stop();
  }, [stop]);

  const handleSubmit = useCallback(async () => {
    if (!audioBlob) return;
    if (!organization?.id) {
      setSubmitError('Organisation non chargée');
      setSubmitState('error');
      return;
    }
    if (!context) {
      setSubmitError('Aucun contexte sélectionné');
      setSubmitState('error');
      return;
    }

    const voiceMemoId = genUUID();
    setSubmitError(null);
    setResult(null);

    try {
      // 1. Si prospect → créer client en base AVANT submit
      let clientIdHint = context.client_id;
      if (context.type === 'prospect' && context.prospect_data) {
        setSubmitState('uploading');
        const findResult = await voiceMemosService.createOrMatchProspect({
          orgId: organization.id,
          lastName: context.prospect_data.last_name,
          firstName: context.prospect_data.first_name,
          phone: context.prospect_data.phone,
          city: context.prospect_data.city,
        });
        clientIdHint = findResult?.client_id || null;
      }

      // 2. Upload audio dans Supabase Storage
      setSubmitState('uploading');
      const uploadResult = await voiceMemosService.uploadAudio(audioBlob, {
        orgId: organization.id,
        voiceMemoId,
      });

      // 3. Signed URL pour N8N
      const signedUrl = await voiceMemosService.getSignedUrl(uploadResult.audio_path, 3600);

      // 4. Submit au webhook N8N
      setSubmitState('submitting');
      const finalMemoType = context.type === 'note' ? noteSubType : context.memo_type;

      const reply = await voiceMemosService.submitMemo({
        voiceMemoId,
        orgId: organization.id,
        recordedBy: user.id,
        audioPath: uploadResult.audio_path,
        audioSignedUrl: signedUrl,
        audioDurationSeconds: durationSeconds,
        audioSizeBytes: uploadResult.audio_size_bytes,
        audioMimeType: uploadResult.audio_mime_type,
        memoType: finalMemoType,
        clientIdHint,
        appointmentId: context.appointment_id || null,
      });

      setResult({ ...reply, _client_id_hint: clientIdHint });
      setSubmitState('success');
    } catch (err) {
      setSubmitError(err?.message || 'Erreur inconnue');
      setSubmitState('error');
    }
  }, [audioBlob, durationSeconds, context, noteSubType, organization, user]);

  const handleReset = useCallback(() => {
    reset();
    resetContext();
    setSubmitState('idle');
    setSubmitError(null);
    setResult(null);
    setNoteSubType('note_libre');
  }, [reset, resetContext]);

  const handleChangeContext = useCallback(() => {
    reset();
    resetContext();
  }, [reset, resetContext]);

  // ---------------------------------------------------------------------------
  // RENDER STATES
  // ---------------------------------------------------------------------------

  if (!isSupported) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle className="w-12 h-12 text-orange-400 mb-4" />
        <h1 className="text-xl font-semibold mb-2">Navigateur incompatible</h1>
        <p className="text-secondary-300 max-w-sm">
          Ton navigateur ne supporte pas l'enregistrement audio. Utilise Safari (iOS), Chrome ou
          Firefox récent.
        </p>
      </div>
    );
  }

  // SUCCESS
  if (submitState === 'success') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <CheckCircle2 className="w-16 h-16 text-emerald-400 mb-6" />
        <h1 className="text-2xl font-semibold mb-2">Compte-rendu envoyé</h1>
        <p className="text-secondary-300 mb-1">
          {context?.label}
        </p>
        <p className="text-secondary-400 text-sm mb-8">
          {result?.lead_id
            ? 'Lead créé · client enrichi'
            : result?.status === 'pending_assignment'
              ? 'Mémo en attente d\'assignation'
              : 'Mémo enregistré'}
        </p>

        {result?.lead_id && (
          <a
            href={`/pipeline?lead=${result.lead_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 mb-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition"
          >
            Voir le lead <ExternalLink className="w-4 h-4" />
          </a>
        )}

        <button
          onClick={handleReset}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
        >
          <RotateCcw className="w-4 h-4" /> Nouveau compte-rendu
        </button>
      </div>
    );
  }

  // ERROR
  if (submitState === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle className="w-16 h-16 text-red-400 mb-6" />
        <h1 className="text-2xl font-semibold mb-2">Échec de l'envoi</h1>
        <p className="text-secondary-300 mb-2 max-w-md break-words">{submitError}</p>
        <p className="text-secondary-500 text-sm mb-8">
          L'enregistrement audio est conservé localement, tu peux retenter.
        </p>
        <button
          onClick={handleSubmit}
          className="inline-flex items-center gap-2 px-5 py-3 mb-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition"
        >
          Réessayer
        </button>
        <button
          onClick={handleReset}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
        >
          <RotateCcw className="w-4 h-4" /> Tout réinitialiser
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // STEP 1 — pas de contexte sélectionné → ContextSelector
  // ---------------------------------------------------------------------------

  if (!context) {
    return (
      <ContextSelector
        onSelectAppointment={selectAppointment}
        onSelectExistingClient={selectExistingClient}
        onSelectNewProspect={selectNewProspect}
        onSelectNoteLibre={selectNoteLibre}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // STEP 2 — contexte sélectionné → enregistreur
  // ---------------------------------------------------------------------------

  const isBusy = submitState === 'uploading' || submitState === 'submitting';

  return (
    <div className="flex-1 flex flex-col px-4 py-5 max-w-md mx-auto w-full">
      {/* Header avec contexte sélectionné */}
      <div className="mb-6">
        <button
          type="button"
          onClick={handleChangeContext}
          disabled={isRecording || isBusy}
          className="inline-flex items-center gap-1 text-secondary-400 text-xs mb-2 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Changer
        </button>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <div className="text-secondary-400 text-[10px] uppercase tracking-wide mb-1">
            {context.type === 'rdv' && 'RDV planifié'}
            {context.type === 'client' && 'Client existant'}
            {context.type === 'prospect' && 'Nouveau prospect'}
            {context.type === 'note' && 'Note / réunion'}
          </div>
          <div className="font-medium">{context.label}</div>
          {context.detail && (
            <div className="text-secondary-400 text-xs mt-0.5 flex items-center gap-1">
              {context.type === 'rdv' && <MapPin className="w-3 h-3" />}
              {context.detail}
            </div>
          )}
        </div>

        {/* Sub-toggle uniquement pour note libre vs réunion */}
        {context.type === 'note' && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            {[
              { value: 'note_libre', label: '📝 Note libre' },
              { value: 'reunion', label: '📋 Réunion' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setNoteSubType(opt.value)}
                disabled={isRecording || isBusy || !!audioBlob}
                className={`py-2 rounded-lg border text-sm transition disabled:opacity-50 ${
                  noteSubType === opt.value
                    ? 'bg-orange-500 border-orange-500 text-white'
                    : 'bg-white/5 border-white/10 text-secondary-200 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recording UI */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {!audioBlob && !isRecording && (
          <>
            <button
              onClick={start}
              disabled={isBusy}
              className="w-32 h-32 rounded-full bg-orange-500 hover:bg-orange-600 active:scale-95 transition flex items-center justify-center shadow-2xl shadow-orange-500/30 disabled:opacity-50"
            >
              <Mic className="w-12 h-12 text-white" />
            </button>
            <p className="mt-6 text-secondary-400 text-sm text-center px-6">
              Appuie pour enregistrer ton compte-rendu
            </p>
          </>
        )}

        {isRecording && (
          <>
            <button
              onClick={handleStop}
              className="w-32 h-32 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 transition flex items-center justify-center shadow-2xl shadow-red-500/40 animate-pulse"
            >
              <Square className="w-12 h-12 text-white fill-white" />
            </button>
            <p className="mt-6 text-3xl font-mono tabular-nums">
              {formatDuration(durationSeconds)}
            </p>
            <p className="mt-1 text-secondary-400 text-sm">Enregistrement en cours…</p>
          </>
        )}

        {audioBlob && !isRecording && submitState === 'idle' && (
          <div className="w-full">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
              <p className="text-xs text-secondary-400 mb-2">
                Durée : {formatDuration(durationSeconds)} · Taille : {(audioBlob.size / 1024).toFixed(0)} Ko
              </p>
              <audio src={audioUrl} controls className="w-full" />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => reset()}
                className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white transition flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" /> Refaire
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition"
              >
                Envoyer
              </button>
            </div>
          </div>
        )}

        {isBusy && (
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-orange-400 animate-spin mx-auto mb-4" />
            <p className="text-secondary-300">
              {submitState === 'uploading' ? 'Envoi de l\'audio…' : 'Traitement IA en cours…'}
            </p>
          </div>
        )}
      </div>

      {/* Errors mic */}
      {recError && (
        <div className="mt-6 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm">
          {recError}
        </div>
      )}
    </div>
  );
}
