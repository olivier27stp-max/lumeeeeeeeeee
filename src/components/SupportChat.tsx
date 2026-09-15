/**
 * Conversation de support : l'assistant répond d'abord ; « Parler à un
 * humain » (ou l'assistant lui-même) passe la main à l'équipe, qui répond
 * depuis Slack — la réponse apparaît ici, et par courriel.
 *
 * Utilisé par le tiroir d'aide (compact) et par la page Support. Sans clé
 * Claude côté serveur (503 `ai_unconfigured`), on retombe sur le formulaire
 * classique (SupportPanel), qui crée quand même un ticket.
 */
import React, { useEffect, useId, useRef, useState, useCallback } from 'react';
import { Loader2, Send, UserRound, Bot, LifeBuoy, ArrowLeft, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { captureClientException } from '../lib/sentry';
import SupportPanel from './SupportPanel';
import {
  chatSupport, sendSupportMessage, escalateSupportTicket, listSupportTickets, getSupportTicket,
  type SupportTicket, type SlaKey, type SupportRequestError,
} from '../lib/supportApi';

const SLA_KEYS: Record<SlaKey, 'sla4h' | 'sla1d' | 'sla2d'> = { '4h': 'sla4h', '1d': 'sla1d', '2d': 'sla2d' };
const POLL_MS = 8000;

export default function SupportChat({ compact = false, initialTicketId }: { compact?: boolean; initialTicketId?: string | null } = {}) {
  const { t, language } = useTranslation();
  const ts = t.support;
  const fr = language === 'fr';
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [recents, setRecents] = useState<SupportTicket[]>([]);
  const [showList, setShowList] = useState(false);
  const [texte, setTexte] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [fallbackForm, setFallbackForm] = useState(false);
  const [charge, setCharge] = useState(true);
  const listeRef = useRef<HTMLDivElement>(null);
  const champId = useId();

  const sla = (key: SlaKey | null | undefined) => (key ? ts[SLA_KEYS[key]] : ts.sla2d);

  // Conversations récentes ; on reprend la dernière encore ouverte.
  useEffect(() => {
    let vivant = true;
    (async () => {
      try {
        const r = await listSupportTickets();
        if (!vivant) return;
        setRecents(r.tickets);
        if (!r.aiConfigured && r.humanChannel === 'none') setFallbackForm(true);
        const cible = initialTicketId
          ? r.tickets.find((x) => x.id === initialTicketId)
          : r.tickets.find((x) => x.status !== 'closed' && Date.now() - new Date(x.lastMessageAt).getTime() < 7 * 86400_000);
        if (cible) {
          const { ticket: complet } = await getSupportTicket(cible.id);
          if (vivant) setTicket(complet);
        }
      } catch (e) {
        captureClientException(e, { module: 'support', action: 'list' });
      } finally {
        if (vivant) setCharge(false);
      }
    })();
    return () => { vivant = false; };
  }, [initialTicketId]);

  // Un humain peut répondre à tout moment : on relit la conversation pendant qu'elle est chez l'équipe.
  useEffect(() => {
    if (!ticket || (ticket.status !== 'open' && ticket.status !== 'answered')) return;
    const id = window.setInterval(async () => {
      try {
        const { ticket: maj } = await getSupportTicket(ticket.id);
        setTicket((actuel) => (actuel && actuel.id === maj.id && maj.messages.length !== actuel.messages.length ? maj : actuel && actuel.status !== maj.status ? maj : actuel));
      } catch (e) {
        captureClientException(e, { module: 'support', action: 'poll' });
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [ticket?.id, ticket?.status]);

  useEffect(() => {
    listeRef.current?.scrollTo({ top: listeRef.current.scrollHeight });
  }, [ticket?.messages.length, envoi]);

  const erreur = useCallback((err: unknown) => {
    const e = err as SupportRequestError;
    if (e?.code === 'ai_unconfigured') { setFallbackForm(true); return; }
    if (e?.code === 'closed') { toast.error(ts.closedNotice); return; }
    if (e?.code === 'send_failed' || e?.code === 'mailer_unconfigured') {
      toast.error(e.supportEmail ? ts.sendFailedWithEmail.replace('{email}', e.supportEmail) : ts.sendFailed);
      return;
    }
    toast.error(e?.message || ts.sendFailed);
  }, [ts]);

  async function envoyer(humain = false) {
    const message = texte.trim();
    if ((!message && !humain) || envoi) return;
    setEnvoi(true);
    try {
      if (ticket && (ticket.status === 'open' || ticket.status === 'answered')) {
        const { ticket: maj } = await sendSupportMessage(ticket.id, message);
        setTicket(maj);
      } else if (humain && ticket) {
        const r = await escalateSupportTicket(ticket.id);
        setTicket(r.ticket);
        toast.success(ts.humanNotified.replace('{delay}', sla(r.slaKey)));
      } else {
        const r = await chatSupport({ ticketId: ticket?.id, message: message || (fr ? 'Je veux parler à un humain.' : 'I want to talk to a human.'), humain });
        setTicket(r.ticket);
        if (r.escalated) toast.success(ts.humanNotified.replace('{delay}', sla(r.slaKey)));
      }
      setTexte('');
    } catch (err) {
      erreur(err);
    } finally {
      setEnvoi(false);
    }
  }

  if (fallbackForm) return <SupportPanel bare />;

  if (charge) {
    return <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-text-tertiary" /></div>;
  }

  if (showList) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setShowList(false)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline">
          <ArrowLeft size={13} /> {ts.back}
        </button>
        <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wider">{ts.recentConversations}</p>
        {recents.length === 0 && <p className="text-[13px] text-text-tertiary py-6 text-center">{ts.noConversations}</p>}
        {recents.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={async () => { const { ticket: complet } = await getSupportTicket(r.id).catch(() => ({ ticket: r })); setTicket(complet); setShowList(false); }}
            className="w-full text-left rounded-xl border border-outline-subtle hover:bg-surface-secondary/40 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-text-primary truncate">{r.subject}</span>
              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', r.status === 'closed' ? 'bg-surface-tertiary text-text-tertiary' : r.status === 'answered' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-primary/10 text-primary')}>
                {ts[`status_${r.status}` as const]}
              </span>
            </div>
            <p className="text-[11px] text-text-tertiary mt-0.5">{new Date(r.lastMessageAt).toLocaleString(fr ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </button>
        ))}
      </div>
    );
  }

  const chezHumain = ticket?.status === 'open' || ticket?.status === 'answered';
  const ferme = ticket?.status === 'closed';
  const messages = ticket?.messages || [];

  return (
    <div className={cn('flex flex-col', compact ? 'h-full' : 'min-h-[420px]')}>
      {/* Barre : état + conversations */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11.5px] text-text-tertiary leading-snug">
          {ferme ? ts.closedNotice : chezHumain ? ts.humanNotified.replace('{delay}', sla(ticket?.slaKey)) : ts.chatIntro}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {recents.length > 0 && (
            <button type="button" onClick={() => setShowList(true)} className="text-[11px] font-semibold text-primary hover:underline">{ts.recentConversations}</button>
          )}
          {ticket && (
            <button type="button" onClick={() => { setTicket(null); setTexte(''); }} aria-label={ts.newConversation} title={ts.newConversation} className="w-7 h-7 rounded-lg hover:bg-surface-secondary flex items-center justify-center text-text-tertiary">
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={listeRef} role="log" aria-live="polite" aria-label={ts.title} className={cn('flex-1 overflow-y-auto space-y-2.5 rounded-xl border border-outline-subtle bg-surface-secondary/30 p-3', compact ? '' : 'max-h-[460px]')}>
        {messages.length === 0 && (
          <div className="flex items-start gap-2">
            <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Bot size={13} className="text-primary" /></span>
            <p className="text-[12.5px] text-text-secondary leading-relaxed bg-surface rounded-xl px-3 py-2">{ts.welcome}</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex items-start gap-2', m.author === 'user' && 'flex-row-reverse')}>
            <span className={cn('w-6 h-6 rounded-full flex items-center justify-center shrink-0', m.author === 'user' ? 'bg-surface-tertiary' : m.author === 'agent' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-primary/10')} aria-hidden="true">
              {m.author === 'user' ? <UserRound size={13} className="text-text-secondary" /> : m.author === 'agent' ? <LifeBuoy size={13} className="text-green-700 dark:text-green-300" /> : <Bot size={13} className="text-primary" />}
            </span>
            <div className={cn('max-w-[85%]', m.author === 'user' && 'text-right')}>
              <p className="text-[10px] text-text-tertiary mb-0.5">
                {m.author === 'user' ? ts.youLabel : m.author === 'agent' ? (m.authorName || ts.agentLabel) : ts.aiLabel}
              </p>
              <p className={cn('text-[12.5px] leading-relaxed rounded-xl px-3 py-2 whitespace-pre-wrap text-left', m.author === 'user' ? 'bg-primary text-white' : 'bg-surface text-text-secondary')}>{m.body}</p>
            </div>
          </div>
        ))}
        {envoi && (
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary"><Loader2 size={12} className="animate-spin" /> {chezHumain ? ts.sending : ts.aiThinking}</div>
        )}
      </div>

      {/* Saisie */}
      {!ferme && (
        <form onSubmit={(e) => { e.preventDefault(); envoyer(false); }} className="mt-3 space-y-2">
          <label htmlFor={champId} className="sr-only">{ts.chatPlaceholder}</label>
          <textarea
            id={champId}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyer(false); } }}
            rows={2}
            maxLength={5000}
            placeholder={ts.chatPlaceholder}
            className="w-full px-3.5 py-2.5 rounded-xl border border-outline-subtle bg-surface text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none transition-colors resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            {!chezHumain ? (
              <button type="button" onClick={() => envoyer(true)} disabled={envoi} className="text-[12px] font-semibold text-text-secondary hover:text-primary inline-flex items-center gap-1.5">
                <LifeBuoy size={13} /> {ts.talkToHuman}
              </button>
            ) : <span />}
            <button
              type="submit"
              disabled={!texte.trim() || envoi}
              className={cn('inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all shrink-0', texte.trim() && !envoi ? 'bg-primary text-white hover:opacity-90' : 'bg-surface-secondary text-text-tertiary cursor-not-allowed')}
            >
              {envoi ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {ts.send}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
