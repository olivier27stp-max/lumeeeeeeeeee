export { LanguageProvider, useTranslation } from './LanguageContext';
export type { Language } from './LanguageContext';
export type { TranslationKeys } from './en';

// Non-React helper for library files that receive language as a parameter
import en from './en';
import fr from './fr';
export function getTranslations(language: string) {
  return language === 'fr' ? fr : en;
}
