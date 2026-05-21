import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook d'enregistrement audio via MediaRecorder API.
 *
 * Returns:
 *   isRecording: boolean — en train d'enregistrer
 *   isSupported: boolean — le navigateur supporte MediaRecorder
 *   durationSeconds: number — durée écoulée (s) pendant l'enregistrement
 *   audioBlob: Blob | null — disponible une fois stop() appelé
 *   audioUrl: string | null — blob URL pour preview/playback
 *   start(): Promise<void>
 *   stop(): Promise<Blob>
 *   reset(): void
 *   error: string | null
 */
export function useAudioRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startTimeRef = useRef(null);
  const tickerRef = useRef(null);

  const isSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined';

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickMimeType = () => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4', // Safari iOS
      'audio/ogg;codecs=opus',
    ];
    for (const mt of candidates) {
      if (window.MediaRecorder.isTypeSupported?.(mt)) return mt;
    }
    return ''; // browser default
  };

  const start = useCallback(async () => {
    if (!isSupported) {
      setError('Navigateur incompatible (MediaRecorder requis)');
      return;
    }
    setError(null);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setDurationSeconds(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };

      startTimeRef.current = Date.now();
      tickerRef.current = setInterval(() => {
        setDurationSeconds(
          Math.floor((Date.now() - startTimeRef.current) / 1000)
        );
      }, 250);

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setError(err?.message || "Permission micro refusée");
      setIsRecording(false);
    }
  }, [isSupported, audioUrl]);

  const stop = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      const handleStop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        resolve(blob);
      };
      recorder.addEventListener('stop', handleStop, { once: true });

      recorder.stop();
      setIsRecording(false);
      if (tickerRef.current) {
        clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    });
  }, []);

  const reset = useCallback(() => {
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setDurationSeconds(0);
    setError(null);
    chunksRef.current = [];
  }, [audioUrl]);

  return {
    isRecording,
    isSupported,
    durationSeconds,
    audioBlob,
    audioUrl,
    error,
    start,
    stop,
    reset,
  };
}

export default useAudioRecording;
