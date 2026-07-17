import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation, type Language } from '../../i18n';

export default function LanguageSettings() {
  const { t, language, setLanguage } = useTranslation();

  return (
    <div className="max-w-2xl">
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <p className="text-xs font-medium text-text-tertiary">{t.settings.languageLabel}</p>
        <p className="text-[13px] text-text-secondary leading-relaxed">{t.settings.languageDesc}</p>
        <div className="space-y-3">
          {([
            { code: 'en' as Language, label: 'English', flag: '🇬🇧' },
            { code: 'fr' as Language, label: 'Français', flag: '🇫🇷' },
          ]).map((lang) => (
            <button
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              className={cn(
                'w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left',
                language === lang.code ? 'border-primary bg-primary/5' : 'border-outline-subtle hover:border-outline hover:bg-surface-secondary/40'
              )}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-xl">{lang.flag}</span>
                <span className="text-[13px] font-semibold text-text-primary">{lang.label}</span>
              </div>
              {language === lang.code && (
                <span className="badge-info text-[10px]"><Check size={10} className="inline mr-0.5" />{t.settings.current}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
