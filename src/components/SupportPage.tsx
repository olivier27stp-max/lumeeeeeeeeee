import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, LifeBuoy, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import SupportPanel from './SupportPanel';
import { ARTICLES } from './SupportDrawer';

/**
 * Full-page support view for Settings → Support.
 *
 * Shares its answers with the support drawer (single ARTICLES source), so the
 * two never drift apart. The page leads with self-serve help and keeps the
 * contact form below it — same order as the drawer, just laid out wide.
 */
export default function SupportPage() {
  const { t, language } = useTranslation();
  const ts = t.support;
  // `isFr` reste nécessaire : les 12 articles de FAQ sont bilingues en dur
  // dans SupportDrawer.tsx (question et réponse gardées côte à côte).
  const isFr = language === 'fr';
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ARTICLES;
    return ARTICLES.filter((a) =>
      `${a.q_fr} ${a.q_en} ${a.a_fr} ${a.a_en} ${a.tags}`.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Intro */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
          <LifeBuoy size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="text-[17px] font-bold text-text-primary">
            {ts.title}
          </h2>
          <p className="text-[13px] text-text-tertiary mt-0.5 leading-relaxed">
            {ts.pageIntro}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setExpanded(null); }}
          placeholder={ts.searchPlaceholder}
          className="w-full pl-10 pr-3 py-3 rounded-xl bg-surface-secondary border border-outline-subtle text-[13px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
        />
      </div>

      {/* Articles */}
      <div className="section-card p-5 space-y-3">
        <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
          {query.trim()
            ? `${results.length} ${results.length === 1 ? ts.resultCount : ts.resultCountPlural}`
            : ts.commonQuestions}
        </h3>

        {results.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-tertiary">
            {ts.noMatch}
          </p>
        ) : (
          <div className="space-y-1">
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
                    className="w-full flex items-start justify-between gap-3 px-3 py-3 text-left"
                  >
                    <span className="text-[13px] font-medium text-text-primary leading-snug">
                      {isFr ? a.q_fr : a.q_en}
                    </span>
                    <ChevronDown
                      size={15}
                      className={cn('text-text-tertiary shrink-0 mt-0.5 transition-transform', isOpen && 'rotate-180')}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3">
                      <p className="text-[12.5px] text-text-secondary leading-relaxed">
                        {isFr ? a.a_fr : a.a_en}
                      </p>
                      {a.path && (
                        <button
                          onClick={() => navigate(a.path!)}
                          className="mt-2.5 text-[12px] font-semibold text-primary hover:underline"
                        >
                          {ts.goToPage}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contact form */}
      <div className="section-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail size={15} className="text-text-tertiary" />
          <h3 className="text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
            {ts.writeUs}
          </h3>
        </div>
        <SupportPanel bare />
      </div>
    </div>
  );
}
