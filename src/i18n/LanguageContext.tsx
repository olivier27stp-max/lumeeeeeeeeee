import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { supabase } from '../lib/supabase';
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
  // French is the default language across the app (Québec Law 25 — services
  // offered in Québec must be available in French by default). A visitor only
  // sees English if they have explicitly chosen it (stored preference) or if
  // their browser lists English *before* any French locale.
  const stored = localStorage.getItem('lume-language');
  if (stored === 'fr' || stored === 'en') return stored;
  const browserLangs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language || ''];
  for (const lang of browserLangs) {
    if (lang.toLowerCase().startsWith('fr')) return 'fr';
    if (lang.toLowerCase().startsWith('en')) return 'en';
  }
  // No explicit preference and no recognized locale → French by default.
  return 'fr';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  // SYNCED WITH MOBILE: the chosen language also lives on the ACCOUNT
  // (auth user_metadata.language, written by both platforms). On load the
  // account preference wins over localStorage, so picking « Français » on
  // mobile makes the web French too.
  useEffect(() => {
    let mounted = true;
    const apply = (v: unknown) => {
      if (mounted && (v === 'fr' || v === 'en')) {
        setLanguageState(v);
        localStorage.setItem('lume-language', v);
      }
    };
    supabase.auth
      .getUser()
      .then(({ data }) => apply(data.user?.user_metadata?.language))
      .catch(() => {});
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
    localStorage.setItem('lume-language', lang);
    // Propagate to the account so mobile follows (fire-and-forget; no-op when
    // signed out).
    supabase.auth.updateUser({ data: { language: lang } }).catch(() => {});
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
