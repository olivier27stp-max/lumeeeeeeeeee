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
import { Loader2, Send, LifeBuoy, ArrowLeft, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { captureClientException } from '../lib/sentry';
import SupportPanel from './SupportPanel';
import { ARTICLES } from './supportArticles';

/** Les mêmes questions classiques que le tiroir d'aide ; un clic = réponse fixe côté serveur (étage 0), sans modèle. */
const SUGGESTIONS_IDS = ['quote-to-invoice', 'get-paid', 'add-member', 'schedule-job', 'import-clients'];
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

  async function envoyer(humain = false, suggestion?: string) {
    const message = (suggestion ?? texte).trim();
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
        const r = await chatSupport({ ticketId: ticket?.id, message: message || (fr ? 'Je veux parler à un humain.' : 'I want to talk to a human.'), humain, origine: suggestion ? 'suggestion' : 'texte' });
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
  const suggestions = SUGGESTIONS_IDS.map((id) => ARTICLES.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);

  // Même interface que le widget Lumi du site (LumiAgent.tsx) : Lumi animé en
  // haut, bulles arrondies, questions suggérées, saisie ronde, avertissement IA.
  return (
    <div className={cn('flex flex-col bg-surface', compact ? 'h-full' : 'min-h-[520px] rounded-2xl border border-outline-subtle overflow-hidden')}>
      {/* Zone héro avec Lumi animé */}
      <div className="px-4 pt-3 pb-3 bg-gradient-to-br from-[#e8f0ff] to-[#f3ecff] dark:from-[#1c2434] dark:to-[#261f36] text-center shrink-0">
        <video className="w-[96px] h-[96px] object-cover rounded-2xl mx-auto" src="/agent/lumi.mp4" poster="/agent/lumi-poster.png" autoPlay loop muted playsInline aria-hidden="true" />
        <p className="mt-2 text-[11.5px] text-text-tertiary leading-snug">
          {ferme ? ts.closedNotice : chezHumain ? ts.humanNotified.replace('{delay}', sla(ticket?.slaKey)) : ts.chatIntro}
        </p>
        {(recents.length > 0 || ticket) && (
          <div className="mt-1.5 flex items-center justify-center gap-3">
            {recents.length > 0 && (
              <button type="button" onClick={() => setShowList(true)} className="text-[11px] font-semibold text-primary hover:underline">{ts.recentConversations}</button>
            )}
            {ticket && (
              <button type="button" onClick={() => { setTicket(null); setTexte(''); }} className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-secondary hover:text-text-primary">
                <Plus size={12} aria-hidden="true" /> {ts.newConversation}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Conversation */}
      <div ref={listeRef} role="log" aria-live="polite" aria-label={ts.title} className={cn('flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-surface-secondary/30', compact ? '' : 'max-h-[460px]')}>
        {messages.length === 0 && (
          <div className="bg-surface border border-outline-subtle rounded-2xl rounded-tl-sm px-3.5 py-3 text-[13.5px] leading-relaxed text-text-secondary max-w-[92%] shadow-sm">{ts.welcome}</div>
        )}
        {messages.map((m) => (
          m.author === 'user' ? (
            <div key={m.id} className="ml-auto bg-gray-900 text-white dark:bg-white dark:text-gray-900 rounded-2xl rounded-tr-sm px-3.5 py-3 text-[13.5px] leading-relaxed max-w-[92%] whitespace-pre-wrap">{m.body}</div>
          ) : (
            <div key={m.id} className="bg-surface border border-outline-subtle rounded-2xl rounded-tl-sm px-3.5 py-3 text-[13.5px] leading-relaxed text-text-secondary max-w-[92%] shadow-sm whitespace-pre-wrap">
              {m.author === 'agent' && (
                <p className="text-[10.5px] font-semibold text-green-700 dark:text-green-300 mb-1 inline-flex items-center gap-1"><LifeBuoy size={11} aria-hidden="true" /> {m.authorName || ts.agentLabel}</p>
              )}
              {m.body}
            </div>
          )
        ))}
        {envoi && (
          <div className="bg-surface border border-outline-subtle rounded-2xl rounded-tl-sm px-3.5 py-3 max-w-[60%] shadow-sm" aria-label={chezHumain ? ts.sending : ts.aiThinking}>
            <span className="inline-flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary animate-bounce" />
            </span>
          </div>
        )}
      </div>

      {/* Questions suggérées — comme le widget d'accueil ; un clic = réponse fixe, sans modèle */}
      {messages.length === 0 && !envoi && !ferme && (
        <div className="px-4 py-2.5 border-t border-outline-subtle shrink-0">
          <p className="text-[11px] text-text-tertiary mb-1.5">{ts.suggestionsIntro}</p>
          {suggestions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => envoyer(false, fr ? a.q_fr : a.q_en)}
              className="block w-full text-left text-[13px] text-text-secondary hover:text-text-primary py-2 border-b border-outline-subtle last:border-0"
            >
              {fr ? a.q_fr : a.q_en}
            </button>
          ))}
        </div>
      )}

      {/* Saisie */}
      {!ferme && (
        <form onSubmit={(e) => { e.preventDefault(); envoyer(false); }} className="shrink-0 border-t border-outline-subtle">
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
            <label htmlFor={champId} className="sr-only">{ts.chatPlaceholder}</label>
            <input
              id={champId}
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              maxLength={5000}
              placeholder={ts.chatPlaceholder}
              autoComplete="off"
              className="flex-1 h-10 rounded-full border border-outline-subtle bg-surface-secondary px-4 text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-outline focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <button
              type="submit"
              disabled={envoi || !texte.trim()}
              aria-label={ts.send}
              className="w-9 h-9 rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900 flex items-center justify-center shrink-0 disabled:opacity-40"
            >
              {envoi ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
          <div className="flex items-center justify-between px-3.5 pb-3">
            <span className="text-[10px] text-text-tertiary">{ts.aiDisclaimer}</span>
            {!chezHumain && (
              <button type="button" onClick={() => envoyer(true)} disabled={envoi} className="text-[11px] font-semibold text-text-secondary hover:text-primary inline-flex items-center gap-1">
                <LifeBuoy size={12} aria-hidden="true" /> {ts.talkToHuman}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
