/**
 * Lecture à voix haute des réponses de Lumi — le jumeau natif de
 * `useSpeakReplies` du web.
 *
 * Le web utilise `window.speechSynthesis` (Web Speech API). Elle n'existe pas
 * en natif ; `expo-speech` en est l'équivalent EXACT : il pilote
 * `AVSpeechSynthesizer` (iOS) et `android.speech.tts.TextToSpeech` (Android),
 * c'est-à-dire les moteurs de l'OS que le navigateur utilisait déjà par en
 * dessous. Même fournisseur de fait, gratuit, hors ligne, aucun service tiers.
 *
 * Comme au web : lu SEULEMENT quand la question a été posée au micro,
 * désactivable, et le choix est mémorisé.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

const CLE = 'lume-lumi-lire-reponses';

/** Retire ce qui ne se lit pas : puces, gras, liens, tableaux. Copié du web. */
function pourLaVoix(texte: string): string {
  return texte
    .replace(/\|/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function useLectureVocale(language: 'fr' | 'en') {
  const [actif, setActifState] = useState(true);
  const [parle, setParle] = useState(false);
  const parleRef = useRef(false);
  // Recopié APRÈS le rendu : l'écouteur d'AppState le lit hors rendu.
  useEffect(() => {
    parleRef.current = parle;
  }, [parle]);

  useEffect(() => {
    AsyncStorage.getItem(CLE)
      .then((v) => {
        if (v === '0') setActifState(false);
      })
      .catch(() => {
        /* stockage indisponible : on lit par défaut, comme le web */
      });
  }, []);

  const arreter = useCallback(() => {
    Speech.stop().catch(() => {});
    setParle(false);
  }, []);

  const setActif = useCallback(
    (v: boolean) => {
      setActifState(v);
      AsyncStorage.setItem(CLE, v ? '1' : '0').catch((e) => console.error('[lumi] préférence de lecture non enregistrée', e));
      if (!v) arreter();
    },
    [arreter],
  );

  const lire = useCallback(
    (texte: string) => {
      if (!actif) return;
      const propre = pourLaVoix(texte);
      if (!propre) return;
      Speech.stop().catch(() => {});
      // Repasser la session audio en lecture : on sort d'un enregistrement, et
      // `playsInSilentMode` garde la voix audible quand l'iPhone est sur silencieux.
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      Speech.speak(propre, {
        language: language === 'fr' ? 'fr-CA' : 'en-US',
        rate: 1.02,
        onStart: () => setParle(true),
        onDone: () => setParle(false),
        onStopped: () => setParle(false),
        onError: () => setParle(false),
      });
    },
    [actif, language],
  );

  /* Appel entrant ou app en arrière-plan : on se tait. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && parleRef.current) arreter();
    });
    return () => sub.remove();
  }, [arreter]);

  useEffect(() => () => { Speech.stop().catch(() => {}); }, []);

  return { actif, setActif, lire, parle, arreter };
}
