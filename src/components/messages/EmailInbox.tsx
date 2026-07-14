/* ═══════════════════════════════════════════════════════════════
   EmailInbox — the "Email" channel inside the Messages page.

   Étape 1/3 behaviour: shows the connect screen (Gmail / Outlook) and
   the list of the owner's connected mailboxes. The real inbox (threads,
   reading, replying) is layered on in later steps. Kept in its own
   component so the SMS path in Messages.tsx stays untouched.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';
import { Mail, Plus, Loader2, CheckCircle2, AlertCircle, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '../../i18n';
import {
  listEmailAccounts,
  connectMailbox,
  disconnectMailbox,
  type EmailAccount,
  type EmailProviderSlug,
} from '../../lib/emailInboxApi';

// Official brand logos, inlined as SVG (no external assets → no CSP/network issue).
function ProviderGlyph({ provider }: { provider: EmailProviderSlug }) {
  if (provider === 'gmail') {
    return (
      <span className="w-9 h-9 rounded-lg grid place-items-center bg-white border border-border shrink-0">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-label="Gmail">
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
    <span className="w-9 h-9 rounded-lg grid place-items-center bg-white border border-border shrink-0">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-label="Outlook">
        <path fill="#0A2767" d="M23 12.2 13.6 7v10z" />
        <path fill="#0364B8" d="M13.6 7 23 12.2V6.4a1 1 0 0 0-1-1h-8.4z" />
        <path fill="#28A8EA" d="M13.6 7H5.2a1 1 0 0 0-1 1v9.4h9.4z" />
        <path fill="#0078D4" d="M4.2 8v9.4h9.4V7H5.2a1 1 0 0 0-1 1" opacity=".5" />
        <path fill="#14447D" d="M13.6 17H4.2v.6a1 1 0 0 0 1 1H22a1 1 0 0 0 1-1v-.4l-9.4-5.2z" opacity=".9" />
        <rect x="1" y="6" width="10" height="12" rx="1.4" fill="#0078D4" />
        <text x="6" y="15" font-size="8" font-family="Arial, sans-serif" font-weight="700" fill="#fff" text-anchor="middle">O</text>
      </svg>
    </span>
  );
}

function StatusBadge({ status }: { status: EmailAccount['status'] }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#22C55E]">
        <CheckCircle2 size={12} /> Connecté
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger">
      <AlertCircle size={12} /> Reconnexion requise
    </span>
  );
}

export default function EmailInbox() {
  const { language } = useTranslation();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<EmailProviderSlug | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listEmailAccounts();
      setAccounts(data);
    } catch (err: any) {
      // Silent on first load — the connect screen is still useful.
      console.error('Failed to load mailboxes:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleConnect = async (provider: EmailProviderSlug) => {
    setConnecting(provider);
    try {
      // Redirects the browser to Google/Microsoft. On return, /email/callback
      // brings the user back here.
      await connectMailbox(provider);
    } catch (err: any) {
      setConnecting(null);
      toast.error(
        err?.message ||
          (language === 'fr' ? 'Impossible de démarrer la connexion' : 'Could not start connection'),
      );
    }
  };

  const handleDisconnect = async (account: EmailAccount) => {
    try {
      await disconnectMailbox(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      toast.success(language === 'fr' ? 'Boîte déconnectée' : 'Mailbox disconnected');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to disconnect');
    }
  };

  const connectButtons = (
    <div className="flex flex-col gap-3 w-full max-w-[320px]">
      <button
        onClick={() => handleConnect('gmail')}
        disabled={connecting !== null}
        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface hover:bg-surface-secondary transition-colors disabled:opacity-50"
      >
        <ProviderGlyph provider="gmail" />
        <span className="text-[14px] font-semibold text-text-primary">
          {language === 'fr' ? 'Connecter Gmail' : 'Connect Gmail'}
        </span>
        {connecting === 'gmail' && <Loader2 size={16} className="ml-auto animate-spin text-text-tertiary" />}
      </button>

      <button
        onClick={() => handleConnect('outlook')}
        disabled={connecting !== null}
        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface hover:bg-surface-secondary transition-colors disabled:opacity-50"
      >
        <ProviderGlyph provider="outlook" />
        <span className="text-[14px] font-semibold text-text-primary">
          {language === 'fr' ? 'Connecter Outlook' : 'Connect Outlook'}
        </span>
        {connecting === 'outlook' && <Loader2 size={16} className="ml-auto animate-spin text-text-tertiary" />}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
      </div>
    );
  }

  // No mailbox yet → connect screen.
  if (accounts.length === 0) {
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
                ? 'Reliez votre Gmail ou Outlook pour lire et répondre à vos emails directement dans vos messages.'
                : 'Link your Gmail or Outlook to read and reply to your emails right here in messages.'}
            </p>
          </div>
          {connectButtons}
        </div>
      </div>
    );
  }

  // At least one mailbox connected → list + add another.
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-bold text-text-primary">
            {language === 'fr' ? 'Boîtes connectées' : 'Connected mailboxes'}
          </h3>
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-surface-secondary text-text-tertiary"
            title={language === 'fr' ? 'Actualiser' : 'Refresh'}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-2 mb-6">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface"
            >
              <ProviderGlyph provider={account.provider} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-text-primary truncate">
                  {account.email_address}
                </div>
                <StatusBadge status={account.status} />
              </div>
              <button
                onClick={() => handleDisconnect(account)}
                className="p-2 rounded-lg hover:bg-surface-secondary text-text-tertiary hover:text-danger transition-colors"
                title={language === 'fr' ? 'Déconnecter' : 'Disconnect'}
              >
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
            <button
              onClick={() => handleConnect('gmail')}
              disabled={connecting !== null}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-secondary text-[13px] font-semibold text-text-primary disabled:opacity-50"
            >
              <Plus size={14} /> Gmail
            </button>
            <button
              onClick={() => handleConnect('outlook')}
              disabled={connecting !== null}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-surface hover:bg-surface-secondary text-[13px] font-semibold text-text-primary disabled:opacity-50"
            >
              <Plus size={14} /> Outlook
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
