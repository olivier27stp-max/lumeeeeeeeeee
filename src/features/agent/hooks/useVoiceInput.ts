/**
 * Micro de Lume Agent et de Lumi.
 *
 * Capture le son en PCM brut (Web Audio, supporté partout) et l'encode en WAV
 * 16 kHz mono côté navigateur, puis l'envoie au serveur qui le transcrit.
 * Pourquoi WAV et pas MediaRecorder : Chrome enregistre en WebM/Opus, que le
 * transcripteur ne prend pas officiellement et transcrivait mal ou à moitié ;
 * le WAV est le format de référence et a donné des transcriptions exactes.
 *
 * États : idle → recording (compteur, niveau sonore, arrêt automatique après
 * un silence) → transcribing → idle. Arrêt forcé à MAX_SECONDS.
 *
 * Aperçu en direct : pendant l'enregistrement, la reconnaissance vocale du
 * navigateur (Chrome, Edge, Safari) écrit les mots au fur et à mesure
 * (onInterim). C'est un aperçu, moins juste ; le texte final vient toujours
 * du serveur et remplace l'aperçu. Sans reconnaissance (Firefox), pas d'aperçu.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribeAudio } from '../lib/agentApi';

export type VoiceState = 'idle' | 'recording' | 'transcribing';
export const MAX_SECONDS = 60;
/** Taux d'échantillonnage envoyé : suffisant pour la parole, léger (32 ko/s). */
const SAMPLE_RATE = 16_000;
/** Silence après la parole (ms) qui déclenche l'envoi tout seul. */
const SILENCE_MS = 2_500;
/** Niveau RMS en deçà duquel on considère que c'est du silence. */
const SILENCE_RMS = 0.012;

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
    && !!navigator.mediaDevices?.getUserMedia
    && (typeof AudioContext !== 'undefined' || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined');
}

/** Ramène un tampon Float32 au taux cible par moyenne des échantillons. */
function reechantillonner(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const debut = Math.floor(i * ratio);
    const fin = Math.min(input.length, Math.floor((i + 1) * ratio));
    let somme = 0;
    for (let j = debut; j < fin; j++) somme += input[j];
    out[i] = fin > debut ? somme / (fin - debut) : 0;
  }
  return out;
}

/** Encode des échantillons mono en WAV PCM 16 bits. */
function encoderWav(chunks: Float32Array[], sampleRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, total * 2, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, o += 2) {
      const x = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

type Reconnaissance = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
function reconnaissanceNavigateur(): (new () => Reconnaissance) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Reconnaissance; webkitSpeechRecognition?: new () => Reconnaissance };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceInput(opts: {
  language: 'fr' | 'en';
  /** Reçoit le texte transcrit (jamais vide). */
  onTranscript: (text: string) => void;
  /** Aperçu en direct pendant qu'on parle (mots provisoires, peuvent changer). */
  onInterim?: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [seconds, setSeconds] = useState(0);
  /** Niveau sonore 0..1, pour animer le bouton pendant l'enregistrement. */
  const [level, setLevel] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const heardVoiceRef = useRef(false);
  const stoppingRef = useRef(false);
  const cancelledRef = useRef(false);
  const recoRef = useRef<Reconnaissance | null>(null);
  const recoActifRef = useRef(false);
  const { language, onTranscript, onInterim, onError } = opts;
  const fr = language === 'fr';

  const arreterApercu = () => {
    recoActifRef.current = false;
    try { recoRef.current?.abort(); } catch { /* déjà arrêtée */ }
    recoRef.current = null;
  };

  /** Lance la reconnaissance du navigateur pour l'aperçu ; silencieuse si absente. */
  const demarrerApercu = () => {
    if (!onInterim) return;
    const Reco = reconnaissanceNavigateur();
    if (!Reco) return;
    let acquis = '';
    const lancer = () => {
      if (!recoActifRef.current) return;
      let reco: Reconnaissance;
      try { reco = new Reco(); } catch { return; }
      reco.lang = language === 'fr' ? 'fr-CA' : 'en-US';
      reco.continuous = true;
      reco.interimResults = true;
      reco.onresult = (e) => {
        let texte = '';
        for (let i = 0; i < e.results.length; i++) texte += e.results[i][0]?.transcript ?? '';
        dernierTexteRef.current = texte;
        onInterim((acquis + ' ' + texte).trim());
      };
      // Chrome coupe la reconnaissance après quelques secondes de silence :
      // on repart tant que l'enregistrement continue, en gardant l'acquis.
      reco.onend = () => {
        if (!recoActifRef.current) return;
        acquis = (acquis + ' ' + dernierTexteRef.current).trim();
        dernierTexteRef.current = '';
        lancer();
      };
      reco.onerror = () => { /* aperçu seulement : on laisse l'enregistrement continuer */ };
      recoRef.current = reco;
      try { reco.start(); } catch { /* déjà en cours */ }
    };
    recoActifRef.current = true;
    lancer();
  };
  const dernierTexteRef = useRef('');

  const liberer = () => {
    arreterApercu();
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    try { nodeRef.current?.disconnect(); } catch { /* déjà déconnecté */ }
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setLevel(0);
  };

  const finir = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const rate = ctxRef.current?.sampleRate ?? SAMPLE_RATE;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    liberer();
    const dureeMs = Date.now() - startedAtRef.current;
    if (cancelledRef.current || dureeMs < 600 || !heardVoiceRef.current) {
      setState('idle');
      if (!cancelledRef.current && dureeMs >= 600) onError(fr ? "Je n'ai rien entendu. Réessaie en parlant plus près du micro." : "I didn't hear anything. Try again closer to the microphone.");
      return;
    }
    setState('transcribing');
    try {
      const blob = encoderWav(chunks.map((c) => reechantillonner(c, rate, SAMPLE_RATE)), SAMPLE_RATE);
      const text = await transcribeAudio(blob, language);
      // Annulé PENDANT la transcription (l'utilisateur a déjà envoyé l'aperçu
      // en direct) : le texte final ne doit pas revenir remplir la boîte.
      if (cancelledRef.current) return;
      if (text.trim()) onTranscript(text.trim());
      else onError(fr ? "Je n'ai rien compris. Réessaie en parlant un peu plus fort." : "I couldn't make it out. Try again a little louder.");
    } catch (err) {
      onError(err instanceof Error ? err.message : (fr ? 'La transcription a échoué.' : 'Transcription failed.'));
    } finally {
      setState('idle');
    }
  }, [fr, language, onTranscript, onError]);

  const stop = useCallback(() => { if (state === 'recording') void finir(); }, [state, finir]);
  /** Abandonne l'enregistrement en cours ET le résultat d'une transcription encore en vol. */
  const cancel = useCallback(() => { cancelledRef.current = true; if (state === 'recording') void finir(); }, [state, finir]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    if (!isVoiceInputSupported()) {
      onError(fr ? "Ce navigateur n'a pas accès au micro. Essaie Chrome, Safari ou Edge." : 'This browser has no microphone access. Try Chrome, Safari or Edge.');
      return;
    }
    // Déjà bloqué pour ce site ? Le navigateur ne réaffiche pas l'invite : on
    // explique tout de suite comment débloquer.
    try {
      const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (st?.state === 'denied') { onError(messageMicro({ name: 'NotAllowedError' }, fr)); return; }
    } catch { /* API permissions absente (Safari) : on tente directement */ }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    } catch (err) {
      onError(messageMicro(err, fr));
      return;
    }
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    try { await ctx.resume(); } catch { /* certains navigateurs exigent un geste : c'en est un */ }
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor : déprécié mais présent partout, sans fichier de worklet
    // (la CSP du site n'autorise pas les workers blob:).
    const node = ctx.createScriptProcessor(4096, 1, 1);
    chunksRef.current = [];
    cancelledRef.current = false;
    stoppingRef.current = false;
    heardVoiceRef.current = false;
    startedAtRef.current = Date.now();
    lastVoiceRef.current = Date.now();
    node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      chunksRef.current.push(new Float32Array(data));
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i] * data[i];
      const rms = Math.sqrt(s / data.length);
      setLevel(Math.min(1, rms * 8));
      if (rms > SILENCE_RMS) { heardVoiceRef.current = true; lastVoiceRef.current = Date.now(); }
    };
    // Le nœud doit être relié à la sortie pour tourner, mais muet : on ne veut
    // pas renvoyer la voix dans les haut-parleurs.
    const muet = ctx.createGain();
    muet.gain.value = 0;
    source.connect(node);
    node.connect(muet);
    muet.connect(ctx.destination);
    ctxRef.current = ctx; streamRef.current = stream; nodeRef.current = node;
    setSeconds(0);
    setState('recording');
    dernierTexteRef.current = '';
    demarrerApercu();
    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(s);
      // Arrêt tout seul : on a entendu parler, puis silence.
      if (heardVoiceRef.current && Date.now() - lastVoiceRef.current > SILENCE_MS) void finir();
      else if (s >= MAX_SECONDS) void finir();
    }, 200);
  }, [state, fr, onError, finir]);

  // Démontage : libérer le micro.
  useEffect(() => () => { cancelledRef.current = true; liberer(); }, []);

  return { state, seconds, level, start, stop, cancel, supported: isVoiceInputSupported() };
}
