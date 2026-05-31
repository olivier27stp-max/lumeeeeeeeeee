import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import en, { TranslationKeys } from './en';
import fr from './fr';

export type Language = 'en' | 'fr';

const translations: Record<Language, TranslationKeys> = { en, fr };

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
  t: en,
});

function getInitialLanguage(): Language {
  const stored = localStorage.getItem('lume-language');
  if (stored === 'fr' || stored === 'en') return stored;
  // Honor the browser's full ordered language list (Chrome/Safari/Firefox…),
  // not just the primary one — a user whose first choice is English but who
  // also lists French still lands on the language they actually read first.
  const browserLangs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language || ''];
  for (const lang of browserLangs) {
    if (lang.toLowerCase().startsWith('fr')) return 'fr';
    if (lang.toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('lume-language', lang);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(
    () => ({ language, setLanguage, t: translations[language] }),
    [language, setLanguage]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
