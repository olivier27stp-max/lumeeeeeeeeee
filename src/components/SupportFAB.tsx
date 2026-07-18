import React, { useState, useEffect } from 'react';
import { LifeBuoy } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import SupportDrawer from './SupportDrawer';

/**
 * Floating help button, bottom-right on every authenticated page.
 * Opens the side drawer: searchable FAQ first, contact form one click away.
 *
 * Se décale au-dessus de la carte SetupChecklist quand elle occupe le coin
 * bas-droit, pour ne pas la chevaucher (la carte émet lume:setup-visibility).
 */
export default function SupportFAB() {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [open, setOpen] = useState(false);
  const [checklistVisible, setChecklistVisible] = useState(() => {
    try { return localStorage.getItem('lume-setup-checklist-visible') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    const onVis = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setChecklistVisible(!!detail?.visible);
    };
    window.addEventListener('lume:setup-visibility', onVis);
    return () => window.removeEventListener('lume:setup-visibility', onVis);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={isFr ? 'Aide et support' : 'Help and support'}
        aria-label={isFr ? 'Aide et support' : 'Help and support'}
        className={cn(
          'fixed right-5 z-50 w-12 h-12 rounded-full bg-primary text-white shadow-lg shadow-primary/25 flex items-center justify-center hover:scale-105 hover:shadow-xl transition-all',
          // Sur mobile, la carte SetupChecklist occupe le coin bas-droit :
          // on décale le FAB juste au-dessus de son en-tête (~4.5rem) pour ne
          // pas le chevaucher. Sur desktop (lg), la place est suffisante.
          checklistVisible ? 'bottom-5 max-lg:bottom-[4.5rem]' : 'bottom-5',
        )}
      >
        <LifeBuoy size={22} strokeWidth={2} />
      </button>

      <SupportDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
