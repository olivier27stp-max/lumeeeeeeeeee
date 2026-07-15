/* ═══════════════════════════════════════════════════════════════
   EmailInbox — the "Email" channel inside the Messages page.

   - No mailbox connected → connect screen (Gmail / Outlook).
   - Mailbox connected → Gmail-style inbox: thread list on the left,
     the opened email on the right. Kept in its own component so the
     SMS path in Messages.tsx stays untouched.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';
import {
  Mail, Plus, Loader2, CheckCircle2, AlertCircle, Trash2, RefreshCw,
  Search, Paperclip, ArrowLeft, ChevronLeft, Settings2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import {
  listEmailAccounts, connectMailbox, disconnectMailbox,
  syncMailbox, fetchThreads, fetchThread,
  type EmailAccount, type EmailProviderSlug,
  type EmailThread, type EmailMessage,
} from '../../lib/emailInboxApi';

// ── Brand logos (inline SVG, no external assets) ──────────────
function ProviderGlyph({ provider, size = 36 }: { provider: EmailProviderSlug; size?: number }) {
  const box = { width: size, height: size } as const;
  if (provider === 'gmail') {
    return (
      <span className="rounded-lg grid place-items-center bg-white border border-border shrink-0" style={box}>
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" aria-label="Gmail">
          <path fill="#4285F4" d="M22 5.5v13a1.5 1.5 0 0 1-1.5 1.5H18V9.75l-6 4.5-6-4.5V20H3.5A1.5 1.5 0 0 1 2 18.5v-13z" />
          <path fill="#34A853" d="M2 18.5v-8.75l4 3V20H3.5A1.5 1.5 0 0 1 2 18.5" />
          <path fill="#FBBC04" d="M2 5.5A1.5 1.5 0 0 1 3.5 4H6v5.75l-4-3z" />
          <path fill="#EA4335" d="M6 4h12l-6 4.5z" />
          <path fill="#C5221F" d="M18 4h2.5A1.5 1.5 0 0 1 22 5.5v1.25l-4 3z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="rounded-lg grid place-items-center bg-white border border-border shrink-0" style={box}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" aria-label="Outlook">
        <rect x="1" y="4" width="14" height="16" rx="1.4" fill="#0078D4" />
        <text x="8" y="16" fontSize="9" fontFamily="Arial, sans-serif" fontWeight="700" fill="#fff" textAnchor="middle">O</text>
        <path fill="#28A8EA" d="M15 8h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7z" />
        <path fill="#0A2767" d="M23 9.2 15.5 13V8H22a1 1 0 0 1 1 1z" opacity=".8" />
      </svg>
    </span>
  );
}

// ── Sender avatar: brand logo via domain favicon, fallback to initials ──
function SenderAvatar({ name, email, seed, size = 40 }: {
  name: string; email: string; seed: string; size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const domain = (email || '').split('@')[1] || '';
  // Google's public favicon service — allowed by CSP (img-src https:).
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : '';
  const box = { width: size, height: size } as const;

  if (faviconUrl && !failed) {
    return (
      <span className="rounded-full grid place-items-center bg-white border border-border shrink-0 overflow-hidden" style={box}>
        <img
          src={faviconUrl}
          alt={domain}
          width={size * 0.6}
          height={size * 0.6}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ objectFit: 'contain' }}
        />
      </span>
    );
  }
  return (
    <span className="rounded-full grid place-items-center text-white font-bold shrink-0"
      style={{ ...box, background: avatarColor(seed), fontSize: size * 0.35 }}>
      {initials(name, email)}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────
function initials(name: string, email: string): string {
  const base = (name || email || '?').trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}
function avatarColor(seed: string): string {
  const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}
function fmtListTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Hier';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtFullTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ═══════════════════════════════════════════════════════════════
//  Connect screen (no mailbox yet)
// ═══════════════════════════════════════════════════════════════
function ConnectScreen({ onConnect, connecting }: {
  onConnect: (p: EmailProviderSlug) => void;
  connecting: EmailProviderSlug | null;
}) {
  const { language } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center flex flex-col items-center gap-5 max-w-[420px]">
        <div className="w-14 h-14 rounded-2xl bg-surface-secondary grid place-items-center">
          <Mail size={26} className="text-text-secondary" />
        </div>
        <div>
          <h3 className="text-[17px] font-bold text-text-primary">
            {language === 'fr' ? 'Connectez votre boîte email' : 'Connect your mailbox'}
          </h3>
          <p className="mt-1.5 text-[13px] text-text-secondary leading-relaxed">
            {language === 'fr'
              ? 'Reliez votre Gmail ou Outlook pour lire et répondre à vos emails directement ici.'
              : 'Link your Gmail or Outlook to read and reply to your emails right here.'}
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-[320px]">
          {(['gmail', 'outlook'] as const).map((p) => (
            <button key={p} onClick={() => onConnect(p)} disabled={connecting !== null}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface hover:bg-surface-secondary transition-colors disabled:opacity-50">
              <ProviderGlyph provider={p} />
              <span className="text-[14px] font-semibold text-text-primary">
                {language === 'fr' ? 'Connecter ' : 'Connect '}{p === 'gmail' ? 'Gmail' : 'Outlook'}
              </span>
              {connecting === p && <Loader2 size={16} className="ml-auto animate-spin text-text-tertiary" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Manage mailboxes (small settings panel)
// ═══════════════════════════════════════════════════════════════
function ManagePanel({ accounts, onConnect, onDisconnect, connecting, onClose }: {
  accounts: EmailAccount[];
  onConnect: (p: EmailProviderSlug) => void;
  onDisconnect: (a: EmailAccount) => void;
  connecting: EmailProviderSlug | null;
  onClose: () => void;
}) {
  const { language } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[560px] mx-auto">
        <button onClick={onClose} className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary mb-4">
          <ChevronLeft size={15} /> {language === 'fr' ? 'Retour à l\'inbox' : 'Back to inbox'}
        </button>
        <h3 className="text-[15px] font-bold text-text-primary mb-4">
          {language === 'fr' ? 'Boîtes connectées' : 'Connected mailboxes'}
        </h3>
        <div className="flex flex-col gap-2 mb-6">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface">
              <ProviderGlyph provider={account.provider} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-text-primary truncate">{account.email_address}</div>
                {account.status === 'connected'
                  ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#22C55E]"><CheckCircle2 size={12} /> Connecté</span>
                  : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger"><AlertCircle size={12} /> Reconnexion requise</span>}
              </div>
              <button onClick={() => onDisconnect(account)} className="p-2 rounded-lg hover:bg-surface-secondary text-text-tertiary hover:text-danger" title="Déconnecter">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-5">
          <p className="text-[12px] font-semibold text-text-tertiary uppercase tracking-wide mb-3">
            {language === 'fr' ? 'Ajouter une boîte' : 'Add a mailbox'}
          </p>
          <div className="flex gap-2">
            {(['gmail', 'outlook'] as const).map((p) => (
              <button key={p} onClick={() => onConnect(p)} disabled={connecting !== null}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-secondary text-[13px] font-semibold text-text-primary disabled:opacity-50">
                <Plus size={14} /> {p === 'gmail' ? 'Gmail' : 'Outlook'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Main component
// ═══════════════════════════════════════════════════════════════
export default function EmailInbox() {
  const { language } = useTranslation();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<EmailProviderSlug | null>(null);
  const [managing, setManaging] = useState(false);

  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [threadSubject, setThreadSubject] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Load accounts on mount
  const loadAccounts = useCallback(async () => {
    try {
      const data = await listEmailAccounts();
      setAccounts(data);
      setActiveAccountId((prev) => prev || data[0]?.id || null);
    } catch (err) {
      console.error('Failed to load mailboxes:', err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // Load threads when an account becomes active
  const loadThreads = useCallback(async (accountId: string) => {
    setLoadingThreads(true);
    try {
      setThreads(await fetchThreads(accountId));
    } catch (err: any) {
      toast.error(err?.message || 'Erreur de chargement');
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  // When active account is set, load its threads; auto-sync if never synced.
  useEffect(() => {
    if (!activeAccountId) return;
    const acc = accounts.find((a) => a.id === activeAccountId);
    (async () => {
      await loadThreads(activeAccountId);
      if (acc && !acc.last_synced_at) {
        // First time → pull the inbox automatically.
        void handleSync(activeAccountId, true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId]);

  const handleConnect = async (provider: EmailProviderSlug) => {
    setConnecting(provider);
    try {
      await connectMailbox(provider); // redirects the browser
    } catch (err: any) {
      setConnecting(null);
      toast.error(err?.message || 'Connexion impossible');
    }
  };

  const handleDisconnect = async (account: EmailAccount) => {
    try {
      await disconnectMailbox(account.id);
      const next = accounts.filter((a) => a.id !== account.id);
      setAccounts(next);
      if (activeAccountId === account.id) {
        setActiveAccountId(next[0]?.id || null);
        setThreads([]);
        setSelectedThreadId(null);
      }
      toast.success(language === 'fr' ? 'Boîte déconnectée' : 'Mailbox disconnected');
    } catch (err: any) {
      toast.error(err?.message || 'Échec');
    }
  };

  const handleSync = async (accountId: string, silent = false) => {
    setSyncing(true);
    try {
      const n = await syncMailbox(accountId);
      await loadThreads(accountId);
      if (!silent) toast.success(language === 'fr' ? `${n} email(s) synchronisé(s)` : `${n} email(s) synced`);
    } catch (err: any) {
      if (!silent) toast.error(err?.message || 'Sync échouée');
    } finally {
      setSyncing(false);
    }
  };

  const openThread = async (threadId: string) => {
    setSelectedThreadId(threadId);
    setLoadingMessages(true);
    try {
      const { thread, messages } = await fetchThread(threadId);
      setThreadSubject(thread.subject || '(sans objet)');
      setMessages(messages);
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, is_read: true } : t)));
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setLoadingMessages(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────
  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-text-tertiary" /></div>;
  }
  if (accounts.length === 0) {
    return <ConnectScreen onConnect={handleConnect} connecting={connecting} />;
  }
  if (managing) {
    return <ManagePanel accounts={accounts} onConnect={handleConnect} onDisconnect={handleDisconnect} connecting={connecting} onClose={() => setManaging(false)} />;
  }

  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const filtered = threads.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.subject || '').toLowerCase().includes(q)
      || (t.snippet || '').toLowerCase().includes(q)
      || (t.from_name || '').toLowerCase().includes(q)
      || (t.from_email || '').toLowerCase().includes(q);
  });

  return (
    <div className="flex-1 flex min-w-0">
      {/* Scoped styles so email HTML (images, tables, logos) renders cleanly. */}
      <style>{`
        .email-html img { max-width: 100%; height: auto; }
        .email-html table { max-width: 100%; }
        .email-html a { color: #2563eb; text-decoration: underline; }
        .email-html * { max-width: 100%; box-sizing: border-box; }
      `}</style>
      {/* ── Thread list ── */}
      <div className={cn(
        'w-[320px] border-r border-border flex flex-col shrink-0 bg-surface',
        selectedThreadId ? 'hidden md:flex' : 'flex w-full md:w-[320px]'
      )}>
        {/* Account header */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          {activeAccount && <ProviderGlyph provider={activeAccount.provider} size={28} />}
          <span className="text-[13px] font-semibold text-text-primary truncate flex-1">
            {activeAccount?.email_address}
          </span>
          <button onClick={() => activeAccountId && handleSync(activeAccountId)} disabled={syncing}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary" title="Synchroniser">
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setManaging(true)} className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary" title="Gérer les boîtes">
            <Settings2 size={15} />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={language === 'fr' ? 'Rechercher…' : 'Search…'}
              className="w-full h-[36px] pl-9 pr-3 rounded-lg bg-surface-secondary border-0 text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-border" />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loadingThreads ? (
            <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin text-text-tertiary mx-auto" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-text-tertiary text-[13px]">
              {syncing ? (language === 'fr' ? 'Synchronisation…' : 'Syncing…') : (language === 'fr' ? 'Aucun email' : 'No emails')}
            </div>
          ) : (
            filtered.map((t) => (
              <button key={t.id} onClick={() => openThread(t.id)}
                className={cn('w-full flex gap-3 px-4 py-3 text-left border-l-2 transition-colors',
                  selectedThreadId === t.id ? 'bg-surface-secondary border-accent' : 'border-transparent hover:bg-surface-secondary')}>
                <SenderAvatar name={t.from_name || ''} email={t.from_email || ''} seed={t.from_email || t.subject || t.id} size={40} />
                <div className="flex-1 min-w-0">
                  {/* Line 1: sender name (like Gmail) + time */}
                  <div className="flex justify-between gap-2 items-baseline">
                    <span className={cn('text-[14px] truncate', t.is_read ? 'font-semibold text-text-primary' : 'font-extrabold text-text-primary')}>
                      {t.from_name || t.from_email || '(inconnu)'}
                    </span>
                    <span className="text-[11.5px] text-text-tertiary shrink-0">{fmtListTime(t.last_message_at)}</span>
                  </div>
                  {/* Line 2: subject */}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {t.has_attachments && <Paperclip size={12} className="text-text-tertiary shrink-0" />}
                    <span className={cn('text-[13px] truncate', t.is_read ? 'text-text-primary' : 'text-text-primary font-bold')}>
                      {t.subject || '(sans objet)'}
                    </span>
                    {!t.is_read && <span className="w-2 h-2 rounded-full bg-accent shrink-0 ml-auto" />}
                  </div>
                  {/* Line 3: preview */}
                  <p className="text-[12px] text-text-tertiary truncate mt-0.5">{t.snippet || '—'}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Reading pane ── */}
      <div className={cn('flex-1 flex flex-col bg-surface min-w-0', !selectedThreadId ? 'hidden md:flex' : 'flex')}>
        {!selectedThreadId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Mail size={40} className="text-text-tertiary mx-auto mb-3" />
              <p className="text-[14px] text-text-tertiary">{language === 'fr' ? 'Sélectionnez un email' : 'Select an email'}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Subject header */}
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-3 shrink-0">
              <button onClick={() => setSelectedThreadId(null)} className="md:hidden p-1 rounded-lg hover:bg-surface-secondary text-text-secondary">
                <ArrowLeft size={18} />
              </button>
              <h3 className="text-[16px] font-bold text-text-primary truncate flex-1">{threadSubject}</h3>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingMessages ? (
                <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-text-tertiary" /></div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="border border-border rounded-xl overflow-hidden bg-surface">
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                      <SenderAvatar name={m.from_name || ''} email={m.from_email || ''} seed={m.from_email || m.from_name || m.id} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-bold text-text-primary truncate">
                          {m.from_name || m.from_email}
                        </div>
                        <div className="text-[12px] text-text-tertiary truncate">
                          {language === 'fr' ? 'à' : 'to'} {m.to_emails.join(', ') || '—'}
                        </div>
                      </div>
                      <div className="text-[12px] text-text-tertiary shrink-0">{fmtFullTime(m.sent_at)}</div>
                    </div>

                    <div className="px-4 py-4">
                      {m.body_html ? (
                        <div className="email-html text-[14px] text-text-primary leading-relaxed break-words"
                          // Provider-sanitized content; rendered read-only.
                          dangerouslySetInnerHTML={{ __html: m.body_html }} />
                      ) : (
                        <p className="text-[14px] text-text-primary leading-relaxed whitespace-pre-wrap break-words">
                          {m.body_text || m.snippet || ''}
                        </p>
                      )}
                    </div>

                    {m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 px-4 pb-4">
                        {m.attachments.map((a, i) => (
                          <div key={i} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 text-[12.5px] bg-surface-secondary">
                            <Paperclip size={13} className="text-text-tertiary" />
                            <span className="text-text-primary truncate max-w-[160px]">{a.filename}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
