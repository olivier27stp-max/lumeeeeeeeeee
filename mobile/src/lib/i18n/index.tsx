// Same i18n API as the web (src/i18n): useTranslation() → { language, setLanguage, t }
// where `t` is the nested translation object (t.jobs.title, t.common.save, …).
// The en.ts / fr.ts dictionaries are copied verbatim from the web so keys match.
// Adapted for React Native: language persists in AsyncStorage (async), defaults to
// the device language.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { deviceLanguage } from '@/lib/contact';
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
  // Start on the device language; load the stored preference (async) right after.
  const [language, setLanguageState] = useState<Language>(() => deviceLanguage());

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'fr' || v === 'en') setLanguageState(v);
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
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
