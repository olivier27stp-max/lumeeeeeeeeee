/**
 * Dictée de Lumi sur mobile — le jumeau natif de `useVoiceInput` du web.
 *
 * Même fournisseur, même modèle : l'audio part au MÊME endpoint serveur
 * (`POST /api/agent/transcribe`), qui le passe à Gemini. Aucune clé côté
 * client, aucun fournisseur de plus.
 *
 * Seul l'enregistrement change de moyen : le web encode du WAV 16 kHz avec la
 * Web Audio API, le mobile laisse `expo-audio` produire un .m4a (AAC) — que le
 * serveur accepte déjà sous `audio/mp4`, sans rien changer côté serveur.
 *
 * Mêmes règles qu'au web, volontairement : arrêt automatique après 2,5 s de
 * silence, plafond de 60 s, et RIEN NE PART TOUT SEUL — le texte remplit la
 * zone de saisie, l'utilisateur relit et envoie lui-même.
 */
import {
  AudioQuality,
  IOSOutputFormat,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { transcrireAudioLumi } from '../api/lumi';

export type EtatDictee = 'repos' | 'ecoute' | 'transcription';

/** Mêmes constantes que le web (src/features/agent/hooks/useVoiceInput.ts). */
export const MAX_SECONDES = 60;
const SILENCE_MS = 2_500;
/** Niveau (dBFS) en deçà duquel on considère que c'est du silence. */
const SILENCE_DB = -40;
/** En deçà, l'enregistrement est un faux départ (doigt qui glisse). */
const DUREE_MINIMALE_MS = 600;

/**
 * Parole, pas musique : mono, 16 kHz, 32 kb/s. 60 s pèsent ~240 ko (~320 ko en
 * base64), très loin de la limite de 6 Mo du serveur. `.m4a` des deux côtés
 * → un seul type MIME à déclarer. Surtout PAS le préréglage LOW_QUALITY :
 * il produit du `.3gp`/AMR sur Android, que le serveur refuse.
 */
const OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export interface OptionsDictee {
  language: 'fr' | 'en';
  /** Reçoit le texte transcrit (jamais vide). */
  onTranscript: (texte: string) => void;
  onError: (message: string) => void;
  /** Permission refusée : l'écran propose « Ouvrir les réglages ». */
  onPermissionRefusee: () => void;
}

export function useDictee(opts: OptionsDictee) {
  const { language, onTranscript, onError, onPermissionRefusee } = opts;
  const fr = language === 'fr';

  const enregistreur = useAudioRecorder(OPTIONS);
  const etatEnr = useAudioRecorderState(enregistreur, 100);

  const [etat, setEtat] = useState<EtatDictee>('repos');
  const [secondes, setSecondes] = useState(0);
  /** Niveau 0..1, pour animer le bouton. Dérivé du relevé : aucun état à tenir. */
  const niveau =
    etat === 'ecoute' && typeof etatEnr.metering === 'number'
      ? Math.max(0, Math.min(1, (etatEnr.metering + 60) / 60))
      : 0;

  const debutRef = useRef(0);
  const derniereVoixRef = useRef(0);
  const aEntenduRef = useRef(false);
  const arretEnCoursRef = useRef(false);
  const annuleRef = useRef(false);
  const etatRef = useRef<EtatDictee>('repos');
  /** `finir` est recréé à chaque rendu ; la minuterie doit toujours voir le dernier. */
  const finirRef = useRef<(() => Promise<void>) | null>(null);

  /** Arrête, transcrit, et rend le texte. */
  const finir = useCallback(async () => {
    if (arretEnCoursRef.current) return;
    arretEnCoursRef.current = true;

    const dureeMs = Date.now() - debutRef.current;
    let uri: string | null = null;
    try {
      await enregistreur.stop();
      uri = enregistreur.uri;
    } catch (e) {
      console.error('[lumi] arrêt de l’enregistrement', e);
    }

    const nettoyer = async () => {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    };

    // Faux départ, ou rien entendu : on le dit, on ne transcrit pas.
    if (annuleRef.current || dureeMs < DUREE_MINIMALE_MS || !aEntenduRef.current) {
      setEtat('repos');
      await nettoyer();
      if (!annuleRef.current && dureeMs >= DUREE_MINIMALE_MS) {
        onError(fr ? "Je n'ai rien entendu. Réessaie en parlant plus près du micro." : "I didn't hear anything. Try again closer to the microphone.");
      }
      return;
    }

    if (!uri) {
      setEtat('repos');
      onError(fr ? "L'enregistrement n'a pas pu être lu." : 'The recording could not be read.');
      return;
    }

    setEtat('transcription');
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const texte = await transcrireAudioLumi(base64, 'audio/mp4', language);
      // Annulé PENDANT la transcription : le texte ne doit pas revenir remplir la boîte.
      if (annuleRef.current) return;
      if (texte.trim()) onTranscript(texte.trim());
      else onError(fr ? "Je n'ai rien compris. Réessaie en parlant un peu plus fort." : "I couldn't make it out. Try again a little louder.");
    } catch (e) {
      const msg = (e as Error)?.message;
      onError(msg || (fr ? 'La transcription a échoué.' : 'Transcription failed.'));
    } finally {
      await nettoyer();
      setEtat('repos');
    }
  }, [enregistreur, fr, language, onError, onTranscript]);

  /* Recopiés APRÈS le rendu : la minuterie et les écouteurs d'AppState les
     lisent hors rendu, et écrire un ref pendant le rendu casse le compilateur. */
  useEffect(() => {
    etatRef.current = etat;
  }, [etat]);
  useEffect(() => {
    finirRef.current = finir;
  }, [finir]);

  const demarrer = useCallback(async () => {
    if (etatRef.current !== 'repos') return;

    // Déjà refusée et non redemandable : on n'insiste pas, on renvoie aux réglages.
    const actuelle = await getRecordingPermissionsAsync().catch(() => null);
    if (actuelle && !actuelle.granted && !actuelle.canAskAgain) {
      onPermissionRefusee();
      return;
    }
    const perm = actuelle?.granted ? actuelle : await requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      onPermissionRefusee();
      return;
    }

    try {
      // `playsInSilentMode` : sans lui, la lecture de la réponse resterait
      // muette quand l'iPhone est sur silencieux — le cas normal sur un chantier.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await enregistreur.prepareToRecordAsync(OPTIONS);
      enregistreur.record();
    } catch (e) {
      console.error('[lumi] démarrage du micro', e);
      onError(fr ? "Le micro n'a pas pu démarrer. Une autre application l'utilise peut-être." : 'The microphone could not start. Another app may be using it.');
      return;
    }

    annuleRef.current = false;
    arretEnCoursRef.current = false;
    aEntenduRef.current = false;
    debutRef.current = Date.now();
    derniereVoixRef.current = Date.now();
    setSecondes(0);
    setEtat('ecoute');
  }, [enregistreur, fr, onError, onPermissionRefusee]);

  const arreter = useCallback(() => {
    if (etatRef.current === 'ecoute') void finirRef.current?.();
  }, []);

  /** Abandonne l'enregistrement ET le résultat d'une transcription encore en vol. */
  const annuler = useCallback(() => {
    annuleRef.current = true;
    if (etatRef.current === 'ecoute') void finirRef.current?.();
  }, []);

  /* A-t-on entendu parler ? `metering` est en dBFS (0 = saturation). */
  useEffect(() => {
    if (etat !== 'ecoute') return;
    const db = etatEnr.metering;
    if (typeof db !== 'number') {
      // Sans mesure du niveau (appareil qui ne la fournit pas), on ne peut pas
      // distinguer le silence : on laisse l'utilisateur arrêter lui-même.
      aEntenduRef.current = true;
      return;
    }
    if (db > SILENCE_DB) {
      aEntenduRef.current = true;
      derniereVoixRef.current = Date.now();
    }
  }, [etat, etatEnr.metering]);

  useEffect(() => {
    if (etat !== 'ecoute') return;
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - debutRef.current) / 1000);
      setSecondes(s);
      if (aEntenduRef.current && Date.now() - derniereVoixRef.current > SILENCE_MS) void finirRef.current?.();
      else if (s >= MAX_SECONDES) void finirRef.current?.();
    }, 200);
    return () => clearInterval(id);
  }, [etat]);

  /* Appel entrant, ou app envoyée en arrière-plan : on arrête proprement.
     Ce qui a été dit jusque-là est transcrit ; rien n'est perdu. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && etatRef.current === 'ecoute') void finirRef.current?.();
    });
    return () => sub.remove();
  }, []);

  /* Démontage : ne jamais laisser le micro ouvert. */
  useEffect(
    () => () => {
      annuleRef.current = true;
      if (etatRef.current === 'ecoute') void finirRef.current?.();
    },
    [],
  );

  return {
    etat,
    secondes,
    niveau,
    demarrer,
    arreter,
    annuler,
    /** Ouvre les réglages du système, là où la permission se redonne. */
    ouvrirReglages: () => Linking.openSettings().catch(() => {}),
  };
}
