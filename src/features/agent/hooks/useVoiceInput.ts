/**
 * Micro de Lume Agent : enregistre la voix avec MediaRecorder (supporté par
 * tous les navigateurs, contrairement à la reconnaissance vocale intégrée),
 * envoie l'audio au serveur qui le transcrit, et rend le texte.
 *
 * États : idle → recording (compteur de secondes) → transcribing → idle.
 * Arrêt automatique à MAX_SECONDS. Les erreurs sont des phrases lisibles
 * (micro refusé, navigateur sans micro, transcription vide).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../lib/agentApi';

export type VoiceState = 'idle' | 'recording' | 'transcribing';
export const MAX_SECONDS = 60;

/** Type audio que ce navigateur sait produire, dans l'ordre de préférence. */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function isVoiceInputSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
}

export function useVoiceInput(opts: {
  language: 'fr' | 'en';
  /** Reçoit le texte transcrit (jamais vide). */
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);
  const { language, onTranscript, onError } = opts;
  const fr = language === 'fr';

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
  };

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    if (!isVoiceInputSupported()) {
      onError(fr ? "Ce navigateur n'a pas accès au micro. Essaie Chrome, Safari ou Edge." : 'This browser has no microphone access. Try Chrome, Safari or Edge.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      onError(fr ? "Micro refusé. Autorise le micro dans les réglages du navigateur, puis réessaie." : 'Microphone denied. Allow the microphone in your browser settings, then try again.');
      return;
    }
    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      onError(fr ? "Impossible de démarrer l'enregistrement." : 'Could not start recording.');
      return;
    }
    chunksRef.current = [];
    cancelledRef.current = false;
    streamRef.current = stream;
    recorderRef.current = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onerror = () => { cleanupStream(); setState('idle'); onError(fr ? "L'enregistrement a échoué." : 'Recording failed.'); };
    rec.onstop = async () => {
      cleanupStream();
      const type = rec.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      const tooShort = Date.now() - startedAtRef.current < 600;
      if (cancelledRef.current || tooShort || blob.size < 1000) { setState('idle'); return; }
      setState('transcribing');
      try {
        const text = await transcribeAudio(blob, language);
        if (text.trim()) onTranscript(text.trim());
        else onError(fr ? "Je n'ai rien entendu. Réessaie en parlant plus près du micro." : "I didn't hear anything. Try again closer to the microphone.");
      } catch (err) {
        onError(err instanceof Error ? err.message : (fr ? 'La transcription a échoué.' : 'Transcription failed.'));
      } finally {
        setState('idle');
      }
    };
    startedAtRef.current = Date.now();
    setSeconds(0);
    setState('recording');
    rec.start(250);
    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
  }, [state, fr, language, onTranscript, onError, stop]);

  // Démontage : libérer le micro.
  useEffect(() => () => { cancelledRef.current = true; recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); cleanupStream(); }, []);

  return { state, seconds, start, stop, cancel, supported: isVoiceInputSupported() };
}
