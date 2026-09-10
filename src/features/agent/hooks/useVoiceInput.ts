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

/** Navigateur courant, pour donner la bonne marche à suivre quand le micro est bloqué. */
function navigateur(): 'safari-ios' | 'safari-mac' | 'firefox' | 'chrome' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'safari-ios';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'safari-mac';
  return 'chrome';
}

/**
 * Message lisible selon la raison réelle du refus. Un lien direct vers les
 * réglages n'existe pas (les pages ne peuvent pas ouvrir chrome:// ni les
 * réglages du système) : on donne les étapes exactes pour ce navigateur.
 */
export function messageMicro(err: unknown, fr: boolean): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  const nav = navigateur();
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return fr ? 'Aucun micro détecté. Branche ou active un micro, puis réessaie.' : 'No microphone detected. Plug in or enable a microphone, then try again.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return fr ? "Le micro est utilisé par une autre application (Teams, Zoom, Discord…). Ferme-la, puis réessaie." : 'The microphone is in use by another app (Teams, Zoom, Discord…). Close it, then try again.';
  }
  if (name === 'SecurityError') {
    return fr ? "Le micro n'est pas permis dans ce contexte (page intégrée ou connexion non sécurisée). Ouvre lumecrm.net directement dans le navigateur." : 'The microphone is not allowed in this context (embedded page or insecure connection). Open lumecrm.net directly in the browser.';
  }
  // NotAllowedError : refusé par la personne, par le navigateur ou par le système.
  const etapes = {
    'chrome': fr
      ? "Clique sur l'icône à gauche de l'adresse (cadenas ou réglages), mets Microphone sur « Autoriser », puis recharge la page."
      : 'Click the icon left of the address (lock or settings), set Microphone to “Allow”, then reload the page.',
    'safari-ios': fr
      ? 'Touche « AA » à gauche de l\'adresse, puis Réglages du site web, et mets Microphone sur « Autoriser ».'
      : 'Tap “AA” left of the address, then Website Settings, and set Microphone to “Allow”.',
    'safari-mac': fr
      ? 'Menu Safari, Réglages pour lumecrm.net, puis Microphone sur « Autoriser ».'
      : 'Safari menu, Settings for lumecrm.net, then Microphone to “Allow”.',
    'firefox': fr
      ? "Clique sur le cadenas à gauche de l'adresse, retire le blocage du micro, puis réessaie."
      : 'Click the lock left of the address, remove the microphone block, then try again.',
  }[nav];
  const systeme = /Windows/.test(navigator.userAgent)
    ? (fr ? ' Si ça bloque encore : Paramètres Windows, Confidentialité, Microphone, et autorise le navigateur.' : ' If it still fails: Windows Settings, Privacy, Microphone, and allow the browser.')
    : /Mac OS/.test(navigator.userAgent)
      ? (fr ? ' Si ça bloque encore : Réglages Système, Confidentialité et sécurité, Microphone.' : ' If it still fails: System Settings, Privacy & Security, Microphone.')
      : '';
  return (fr ? 'Micro refusé. ' : 'Microphone denied. ') + etapes + systeme;
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
    // Déjà bloqué pour ce site ? Inutile de redemander : le navigateur ne
    // réaffiche pas l'invite. On explique tout de suite comment débloquer.
    try {
      const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (st?.state === 'denied') { onError(messageMicro({ name: 'NotAllowedError' }, fr)); return; }
    } catch { /* API permissions absente (Safari) : on tente directement */ }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      onError(messageMicro(err, fr));
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
