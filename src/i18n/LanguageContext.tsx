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
  // French is the default language across the app, unconditionally (Québec
  // Law 25 / Charte de la langue française — a service offered in Québec must
  // be presented in French first). The browser locale is deliberately NOT
  // consulted: an English-configured Windows/Chrome is very common in Québec,
  // so following it would serve English to the majority of local visitors.
  // English is shown only to someone who explicitly picked it — a stored
  // preference here, or the account preference applied by the effect below.
  try {
    const stored = localStorage.getItem('lume-language');
    if (stored === 'fr' || stored === 'en') return stored;
  } catch {
    // Stockage indisponible (mode privé, cookies bloqués) → français.
  }
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
