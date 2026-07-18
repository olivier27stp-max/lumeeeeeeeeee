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

  // La bannière de témoins est fixée en bas sur toute la largeur et recouvre ce
  // bouton : un nouveau visiteur ne peut donc pas cliquer dessus du tout. On
  // mesure la bannière vivante (plutôt que de relire l'état du consentement)
  // pour que le bouton redescende dès qu'elle est fermée, sans rechargement.
  const [bannerLift, setBannerLift] = useState(0);
  useEffect(() => {
    const measure = () => {
      const banner = document.querySelector<HTMLElement>('[data-cookie-banner]');
      if (!banner) { setBannerLift(0); return; }
      setBannerLift(banner.getBoundingClientRect().height + 12);
    };
    measure();
    const obs = new MutationObserver(measure);
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => { obs.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={isFr ? 'Aide et support' : 'Help and support'}
        aria-label={isFr ? 'Aide et support' : 'Help and support'}
        // Quand la bannière est là, elle dicte la position (elle recouvre tout
        // le bas de l'écran) ; sinon on garde les classes existantes.
        style={bannerLift ? { bottom: `${bannerLift}px` } : undefined}
        className={cn(
          'fixed right-5 z-50 w-12 h-12 rounded-full bg-primary text-white shadow-lg shadow-primary/25 flex items-center justify-center hover:scale-105 hover:shadow-xl transition-all',
          // Sur mobile, la carte SetupChecklist occupe le coin bas-droit :
          // on décale le FAB juste au-dessus de son en-tête (~4.5rem) pour ne
          // pas le chevaucher. Sur desktop (lg), la place est suffisante.
          bannerLift ? '' : checklistVisible ? 'bottom-5 max-lg:bottom-[4.5rem]' : 'bottom-5',
        )}
      >
        <LifeBuoy size={22} strokeWidth={2} />
      </button>

      <SupportDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
