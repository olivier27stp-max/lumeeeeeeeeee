/* SetupChecklist — persistent floating widget shown to owner/admin
   after onboarding completes. Auto-checks items against DB state via
   GET /api/me/setup-status, and dismisses itself when everything is
   done (or manually via the X button — stored per-user in localStorage). */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, ChevronDown, X, Sparkles, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

type Status = {
  clients_count: number;
  quotes_count: number;
  stripe_connected: boolean;
  twilio_provisioned: boolean;
  members_count: number;
  setup_completed: boolean;
};

const DISMISS_KEY = 'lume-setup-dismissed';
const MANUAL_KEY = 'lume-setup-manual-checks';

type ManualChecks = { templates?: boolean; import?: boolean };

export default function SetupChecklist() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status | null>(null);
  // Repliée par défaut sur mobile (juste l'en-tête, ~44px) pour ne pas couvrir
  // le contenu / les save bars ; dépliée sur desktop où la place existe.
  const [expanded, setExpanded] = useState(() => {
    try { return window.matchMedia('(min-width: 1024px)').matches; } catch { return true; }
  });
  const [celebrated, setCelebrated] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
  });
  const [manual, setManual] = useState<ManualChecks>(() => {
    try { return JSON.parse(localStorage.getItem(MANUAL_KEY) || '{}'); } catch { return {}; }
  });

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch('/api/me/setup-status', {
        headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data);
    } catch (err) { console.warn('[SetupChecklist] load failed:', err); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const items = useMemo(() => {
    if (!status) return [];
    return [
      {
        key: 'clients',
        label: (t.setup as any).addFirstClient,
        done: status.clients_count > 0,
        path: '/clients?new=true',
      },
      {
        key: 'quotes',
        label: (t.setup as any).createFirstQuote,
        done: status.quotes_count > 0,
        path: '/quotes?new=true',
      },
      {
        key: 'stripe',
        label: (t.setup as any).connectStripe,
        done: status.stripe_connected,
        path: '/settings/payments',
      },
      {
        key: 'sms',
        label: (t.setup as any).configureSms,
        done: status.twilio_provisioned,
        path: '/settings/messaging',
      },
      {
        key: 'templates',
        label: (t.setup as any).customizeTemplates,
        done: !!manual.templates,
        path: '/quotes/templates',
        manual: true,
      },
      {
        key: 'team',
        label: (t.setup as any).inviteTeam,
        done: status.members_count > 1,
        path: '/settings/team',
      },
      {
        key: 'import',
        label: (t.setup as any).importClients,
        done: !!manual.import,
        path: '/clients?import=true',
        manual: true,
      },
    ];
  }, [status, manual, t]);

  const doneCount = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = total > 0 && doneCount === total;

  // When everything completes for the first time, celebrate then auto-hide
  useEffect(() => {
    if (!allDone || celebrated || dismissed) return;
    setCelebrated(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) {
          await fetch('/api/me/setup-completed', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'X-Requested-With': 'XMLHttpRequest',
              'Content-Type': 'application/json',
            },
          });
        }
      } catch (err) { console.warn('[SetupChecklist] mark complete failed:', err); }
    })();
    const id = setTimeout(() => handleDismiss(), 5000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, celebrated, dismissed]);

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch (err) { console.warn(err); }
    setDismissed(true);
  };

  const toggleManual = (key: 'templates' | 'import') => {
    const next = { ...manual, [key]: !manual[key] };
    setManual(next);
    try { localStorage.setItem(MANUAL_KEY, JSON.stringify(next)); } catch (err) { console.warn(err); }
  };

  // Don't render until we have status + not dismissed + not server-completed
  const hidden = dismissed || !status || !!status?.setup_completed || total === 0;

  // Signale au SupportFAB si la carte occupe le coin bas-droit, pour qu'il se
  // décale au-dessus au lieu de chevaucher (dispatché à chaque changement).
  useEffect(() => {
    try {
      localStorage.setItem('lume-setup-checklist-visible', hidden ? 'false' : 'true');
      window.dispatchEvent(new CustomEvent('lume:setup-visibility', { detail: { visible: !hidden } }));
    } catch { /* localStorage indispo */ }
  }, [hidden]);

  if (hidden) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[300px] max-w-[calc(100vw-2rem)] pointer-events-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-outline bg-surface-elevated shadow-lg overflow-hidden"
      >
        {allDone && celebrated ? (
          <div className="p-4 text-center">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <Sparkles size={20} className="text-primary" />
            </div>
            <p className="text-[14px] font-semibold text-text-primary">{(t.setup as any).complete}</p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-surface-secondary transition-colors"
            >
              <Sparkles size={14} className="text-primary" />
              <span className="text-[13px] font-semibold text-text-primary flex-1 text-left">
                {(t.setup as any).title}
              </span>
              <span className="text-[11px] text-text-tertiary font-medium">
                {doneCount} / {total} {(t.setup as any).progress}
              </span>
              <ChevronDown
                size={14}
                className={cn('text-text-tertiary transition-transform', !expanded && '-rotate-90')}
              />
              <span
                role="button"
                tabIndex={0}
                aria-label="dismiss"
                title={(t.setup as any).dismiss}
                onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleDismiss(); } }}
                className="p-0.5 -m-0.5 text-text-tertiary hover:text-text-primary cursor-pointer"
              >
                <X size={13} />
              </span>
            </button>

            {/* Progress bar */}
            <div className="px-3 -mt-1 pb-1">
              <div className="h-1 rounded-full bg-surface-secondary overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(doneCount / total) * 100}%` }}
                />
              </div>
            </div>

            <AnimatePresence initial={false}>
              {expanded && (
                <motion.ul
                  key="list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="divide-y divide-outline/60 overflow-hidden"
                >
                  {items.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-surface-secondary group"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          item.manual
                            ? toggleManual(item.key as 'templates' | 'import')
                            : null
                        }
                        disabled={!item.manual}
                        className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                          item.done
                            ? 'bg-primary border-primary'
                            : 'border-outline bg-transparent',
                          item.manual && 'cursor-pointer hover:border-primary',
                        )}
                        aria-label={item.label}
                      >
                        {item.done && <Check size={11} className="text-white" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(item.path)}
                        className={cn(
                          'flex-1 text-left text-[12.5px] truncate flex items-center gap-1 group/link',
                          item.done ? 'text-text-tertiary line-through' : 'text-text-secondary hover:text-text-primary',
                        )}
                      >
                        <span className="truncate">{item.label}</span>
                        <ChevronRight
                          size={12}
                          className="text-text-tertiary opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0"
                        />
                      </button>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </>
        )}
      </motion.div>
    </div>
  );
}
