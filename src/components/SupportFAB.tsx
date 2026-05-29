import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LifeBuoy, X } from 'lucide-react';
import { useTranslation } from '../i18n';
import SupportPanel from './SupportPanel';

/**
 * Floating support button, bottom-right on every authenticated page.
 * Opens a modal wrapping the shared SupportPanel form.
 */
export default function SupportFAB() {
  const { language } = useTranslation();
  const isFr = language === 'fr';
  const [open, setOpen] = useState(false);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={isFr ? 'Contacter le support' : 'Contact support'}
        aria-label={isFr ? 'Contacter le support' : 'Contact support'}
        className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-primary text-white shadow-lg shadow-primary/25 flex items-center justify-center hover:scale-105 hover:shadow-xl transition-all"
      >
        <LifeBuoy size={22} strokeWidth={2} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="relative w-full sm:max-w-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setOpen(false)}
                aria-label={isFr ? 'Fermer' : 'Close'}
                className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-surface border border-outline shadow flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
              >
                <X size={16} />
              </button>
              <SupportPanel onSent={() => setOpen(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
