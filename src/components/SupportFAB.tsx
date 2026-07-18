import React, { useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { useTranslation } from '../i18n';
import SupportDrawer from './SupportDrawer';

/**
 * Floating help button, bottom-right on every authenticated page.
 * Opens the side drawer: searchable FAQ first, contact form one click away.
 */
export default function SupportFAB() {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={isFr ? 'Aide et support' : 'Help and support'}
        aria-label={isFr ? 'Aide et support' : 'Help and support'}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-primary text-white shadow-lg shadow-primary/25 flex items-center justify-center hover:scale-105 hover:shadow-xl transition-all"
      >
        <LifeBuoy size={22} strokeWidth={2} />
      </button>

      <SupportDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
