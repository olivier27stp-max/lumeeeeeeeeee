/**
 * Lecture à voix haute des réponses de Lume Agent, avec la synthèse vocale du
 * navigateur (gratuite, hors ligne, disponible partout). Utilisée seulement
 * quand la question a été posée à la voix, et désactivable ; le choix est
 * mémorisé (localStorage).
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'lume-agent-speak-replies';

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Meilleure voix disponible pour la langue : locale exacte d'abord, puis la langue. */
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.slice(0, 2);
  const exact = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = exact.length ? exact : same;
  // Les voix « naturelles » ou « premium » sonnent mieux que les voix compactes.
  return pool.find((v) => /natural|premium|enhanced|neural|google/i.test(v.name)) ?? pool[0] ?? null;
}

/** Retire ce qui ne se lit pas : puces, gras, liens, tableaux. */
function toSpeech(text: string): string {
  return text
    .replace(/\|/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function useSpeakReplies(language: 'fr' | 'en') {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
  });
  const [speaking, setSpeaking] = useState(false);
  const supported = isSpeechSupported();

  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* stockage indisponible */ }
    if (!v && supported) window.speechSynthesis.cancel();
  };

  const stopSpeaking = useCallback(() => { if (supported) window.speechSynthesis.cancel(); setSpeaking(false); }, [supported]);

  const speak = useCallback((text: string) => {
    if (!supported || !enabled) return;
    const clean = toSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const lang = language === 'fr' ? 'fr-CA' : 'en-US';
    u.lang = lang;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    u.rate = 1.02;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [supported, enabled, language]);

  // Certains navigateurs chargent la liste des voix après coup.
  useEffect(() => {
    if (!supported) return;
    const load = () => { window.speechSynthesis.getVoices(); };
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    load();
    return () => { window.speechSynthesis.removeEventListener?.('voiceschanged', load); window.speechSynthesis.cancel(); };
  }, [supported]);

  return { supported, enabled, setEnabled, speak, speaking, stopSpeaking };
}
