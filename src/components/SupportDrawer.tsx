import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, ChevronDown, LifeBuoy, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { Z } from '../lib/zIndex';
import { useTranslation } from '../i18n';
import SupportChat from './SupportChat';

/**
 * Side drawer for in-app help: searchable FAQ on top, support conversation
 * behind a button at the bottom (assistant first, then a human in Slack).
 * Answers live in `supportArticles.ts` (shared with the page and the
 * server-side assistant), so they must stay short and point at a real page.
 */

export { ARTICLES, type Article } from './supportArticles';
import { ARTICLES } from './supportArticles';

export default function SupportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const ts = t.support;
  // `isFr` reste nécessaire : les 12 articles ARTICLES sont bilingues en dur
  // dans ce fichier (question et réponse gardées côte à côte, cf. en-tête).
  const isFr = language === 'fr';
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  /** Élément focalisé avant l'ouverture — on lui rend le focus à la fermeture. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Reset to the browse view each time the drawer opens, so it never reopens
  // mid-form with stale state.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setExpanded(null);
    setShowForm(false);
    returnFocusRef.current = document.activeElement as HTMLElement | null;
  }, [open]);

  // Rend le focus au déclencheur (le FAB) à la fermeture : sans ça, un
  // utilisateur au clavier repart du début du document.
  useEffect(() => {
    if (open) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, [open]);

  // Escape ferme le formulaire d'abord, le tiroir ensuite. Tab est confiné au
  // panneau : `aria-modal="true"` annonce un modal, il faut donc que le focus
  // ne puisse pas s'échapper vers l'arrière-plan, qui reste focalisable.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showForm) setShowForm(false);
        else onClose();
        return;
      }
      if (e.key === 'Enter') return; // Entrée = envoyer dans la conversation, jamais piégée ici
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      // Le panneau se re-rend (recherche, formulaire) : on relit la liste à
      // chaque Tab plutôt que de la mémoriser.
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, showForm, onClose]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ARTICLES;
    // Match on question, answer and tags so a user's own wording still lands.
    return ARTICLES.filter((a) =>
      `${a.q_fr} ${a.q_en} ${a.a_fr} ${a.a_en} ${a.tags}`.toLowerCase().includes(q),
    );
  }, [query]);

  const goTo = (path: string) => { onClose(); navigate(path); };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ zIndex: Z.supportDrawerBackdrop }}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ts.title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            // Focus la recherche quand l'animation est réellement finie : un
            // spring n'a pas de durée fixe, un setTimeout calé à la main dessus
            // se désynchronise. `definition` distingue l'entrée de la sortie —
            // sans ce test, le panneau volerait le focus en se refermant et
            // écraserait la restauration vers le FAB.
            onAnimationComplete={(definition: unknown) => {
              const x = (definition as { x?: number | string })?.x;
              if (x === 0) searchRef.current?.focus();
            }}
            style={{ zIndex: Z.supportDrawer }}
            className="fixed top-0 right-0 bottom-0 w-full sm:w-[420px] bg-surface-elevated border-l border-outline shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-subtle shrink-0">
              <div className="flex items-center gap-2.5">
                {showForm && (
                  <button
                    onClick={() => setShowForm(false)}
                    aria-label={ts.back}
                    className="w-7 h-7 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-text-secondary transition-colors"
                  >
                    <ArrowLeft size={16} />
                  </button>
                )}
                <h2 className="text-[16px] font-bold text-text-primary">
                  {showForm
                    ? ts.contactTitle
                    : ts.needHand}
                </h2>
              </div>
              <button
                onClick={onClose}
                aria-label={ts.close}
                className="w-8 h-8 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {showForm ? (
              <div className="flex-1 overflow-hidden p-5 flex flex-col">
                <SupportChat compact />
              </div>
            ) : (
              <>
                {/* Search */}
                <div className="px-5 py-4 shrink-0">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); setExpanded(null); }}
                      placeholder={ts.searchPlaceholder}
                      aria-label={ts.searchPlaceholder}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface-secondary border border-outline-subtle text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
                    />
                  </div>
                </div>

                {/* Articles */}
                <div className="flex-1 overflow-y-auto px-5 pb-4">
                  <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider mb-2">
                    {query.trim()
                      ? `${results.length} ${results.length === 1 ? ts.resultCount : ts.resultCountPlural}`
                      : ts.commonQuestions}
                  </p>

                  {results.length === 0 ? (
                    <div className="py-10 text-center">
                      <p className="text-[13px] text-text-tertiary mb-4">
                        {ts.drawerNoMatch}
                      </p>
                      <button onClick={() => setShowForm(true)} className="glass-button-primary text-[13px]">
                        {ts.askSupport}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {results.map((a) => {
                        const isOpen = expanded === a.id;
                        return (
                          <div
                            key={a.id}
                            className={cn(
                              'rounded-xl border transition-colors',
                              isOpen ? 'border-outline bg-surface-secondary/40' : 'border-transparent hover:bg-surface-secondary/40',
                            )}
                          >
                            <button
                              onClick={() => setExpanded(isOpen ? null : a.id)}
                              aria-expanded={isOpen}
                              className="w-full flex items-start justify-between gap-3 px-3 py-2.5 text-left"
                            >
                              <span className="text-[13px] font-medium text-text-primary leading-snug">
                                {isFr ? a.q_fr : a.q_en}
                              </span>
                              <ChevronDown
                                size={15}
                                className={cn(
                                  'text-text-tertiary shrink-0 mt-0.5 transition-transform',
                                  isOpen && 'rotate-180',
                                )}
                              />
                            </button>

                            <AnimatePresence initial={false}>
                              {isOpen && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.18 }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-3 pb-3">
                                    <p className="text-[12.5px] text-text-secondary leading-relaxed">
                                      {isFr ? a.a_fr : a.a_en}
                                    </p>
                                    {a.path && (
                                      <button
                                        onClick={() => goTo(a.path!)}
                                        className="mt-2.5 text-[12px] font-semibold text-primary hover:underline"
                                      >
                                        {ts.goToPage}
                                      </button>
                                    )}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer CTA */}
                <div className="px-5 py-4 border-t border-outline-subtle shrink-0">
                  <p className="text-[11px] text-text-tertiary mb-2.5 leading-relaxed">
                    {ts.drawerCantFind}
                  </p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="w-full glass-button-primary inline-flex items-center justify-center gap-2 !py-2.5"
                  >
                    <LifeBuoy size={15} />
                    {ts.getSupport}
                  </button>
                </div>
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
