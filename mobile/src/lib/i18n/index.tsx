// Same i18n API as the web (src/i18n): useTranslation() → { language, setLanguage, t }
// where `t` is the nested translation object (t.jobs.title, t.common.save, …).
// The en.ts / fr.ts dictionaries are copied verbatim from the web so keys match.
// Adapted for React Native: language persists in AsyncStorage (async), defaults to
// the device language.
//
// SYNCED WITH THE WEB: the chosen language also lives on the ACCOUNT
// (auth user_metadata.language, written by both platforms). On startup the
// account preference wins over the local one, so picking « Français » on the
// web makes the mobile app French too — like everything else in the CRM.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { deviceLanguage } from '@/lib/contact';
import { supabase } from '../supabase';
import en, { TranslationKeys } from './en';
import fr from './fr';

export type Language = 'en' | 'fr';
export type { TranslationKeys };

const translations: Record<Language, TranslationKeys> = { en, fr };
const STORAGE_KEY = 'lume-language';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'fr',
  setLanguage: () => {},
  t: fr,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Start on the device language; the stored preference then the ACCOUNT
  // preference (authoritative) load right after.
  const [language, setLanguageState] = useState<Language>(() => deviceLanguage());

  useEffect(() => {
    let mounted = true;
    const apply = (v: unknown) => {
      if (mounted && (v === 'fr' || v === 'en')) {
        setLanguageState(v);
        AsyncStorage.setItem(STORAGE_KEY, v).catch(() => {});
      }
    };

    // 1. Local preference (fast, offline) …
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (mounted && (v === 'fr' || v === 'en')) setLanguageState(v);
      })
      .catch(() => {})
      // 2. … then the account preference, fetched FRESH from the server so a
      // change made on the web is picked up at next app open.
      .then(() => supabase.auth.getUser())
      .then(({ data }) => apply(data.user?.user_metadata?.language))
      .catch(() => {});

    // Login / user refresh → re-apply the account preference.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user?.user_metadata?.language);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
    // Propagate to the account so the web follows (fire-and-forget; no-op when
    // signed out).
    supabase.auth.updateUser({ data: { language: lang } }).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, t: translations[language] }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  return useContext(LanguageContext);
}
