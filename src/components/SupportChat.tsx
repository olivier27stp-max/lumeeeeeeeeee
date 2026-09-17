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
import { useNavigate } from 'react-router-dom';
import { Loader2, Send, LifeBuoy, ArrowLeft, Plus, History, ThumbsUp, ThumbsDown, ImagePlus, X } from 'lucide-react';
import { normalizeImageForUpload } from '../lib/imageNormalize';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { captureClientException } from '../lib/sentry';
import SupportPanel from './SupportPanel';
import { ARTICLES } from './supportArticles';

/** Les mêmes questions classiques que le tiroir d'aide ; un clic = réponse fixe côté serveur (étage 0), sans modèle. */
const SUGGESTIONS_IDS = ['quote-to-invoice', 'get-paid', 'add-member', 'schedule-job', 'import-clients'];
import {
  chatSupport, sendSupportMessage, escalateSupportTicket, listSupportTickets, getSupportTicket, noterReponseSupport, televerserCaptureSupport,
  type SupportTicket, type SlaKey, type SupportRequestError,
} from '../lib/supportApi';

const SLA_KEYS: Record<SlaKey, 'sla4h' | 'sla1d' | 'sla2d'> = { '4h': 'sla4h', '1d': 'sla1d', '2d': 'sla2d' };

/** « Rafba » → « R », « William Hébert » → « WH ». */
function initiales(nom: string | null | undefined): string {
  const mots = (nom || '').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return 'L';
  return (mots.length === 1 ? mots[0].slice(0, 1) : mots[0].slice(0, 1) + mots[mots.length - 1].slice(0, 1)).toUpperCase();
}
/** « 14:32 » aujourd'hui, « 15 sept., 14:32 » avant. */
function heureCourte(iso: string, fr: boolean): string {
  const d = new Date(iso);
  const auj = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(fr ? 'fr-CA' : 'en-CA', auj ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const POLL_MS = 8000;
const MAX_CAPTURES = 3;

/** Les premiers segments des routes de l'app (src/App.tsx) : une route citée par Lumi devient un lien. */
const SEGMENTS_APP = 'day|dashboard|tasks|jobs|calendar|dispatch|clients|requests|quotes|messages|search|lumi|finances|invoices|payments|settings|commissions|timesheets|availability|courses|training|field-sales|pipeline|leaderboard|d2d-reports|d2d-dashboard|d2d-pipeline|reps|insights|automations|offices|account|apps|marketplace|leads';
const ROUTE_RE = new RegExp(`(/(?:${SEGMENTS_APP})(?:/[A-Za-z0-9_-]+)*)(?![A-Za-z0-9_:/-])`, 'g');

/**
 * Le texte d'une réponse, avec chaque route de l'app (« /settings/team ») en
 * lien : cliquer y va — depuis le tiroir, il se ferme d'abord. Une route avec
 * un paramètre (« /jobs/:id ») reste du texte.
 */
export function TexteAvecLiens({ texte, onNavigate }: { texte: string; onNavigate?: (path: string) => void }) {
  const morceaux: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  for (const m of texte.matchAll(ROUTE_RE)) {
    const route = m[1];
    const debut = m.index ?? 0;
    if (route.includes(':')) continue;
    if (debut > i) morceaux.push(texte.slice(i, debut));
    morceaux.push(
      <button key={`l${n++}`} type="button" onClick={() => onNavigate?.(route)} className="underline decoration-dotted underline-offset-2 text-primary hover:decoration-solid font-medium">
        {route}
      </button>,
    );
    i = debut + route.length;
  }
  if (i < texte.length) morceaux.push(texte.slice(i));
  return <>{morceaux}</>;
}

export default function SupportChat({ compact = false, initialTicketId, onNavigate }: { compact?: boolean; initialTicketId?: string | null; onNavigate?: (path: string) => void } = {}) {
  const navigate = useNavigate();
  const allerA = useCallback((path: string) => { if (onNavigate) onNavigate(path); else navigate(path); }, [onNavigate, navigate]);
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
  // Captures en attente d'envoi (réduites à 1 600 px), avec un aperçu local.
  const [captures, setCaptures] = useState<Array<{ fichier: File; apercu: string }>>([]);
  const listeRef = useRef<HTMLDivElement>(null);
  const fichierRef = useRef<HTMLInputElement>(null);
  const champId = useId();
  const fichierId = useId();

  async function ajouterCaptures(liste: FileList | null) {
    if (!liste?.length) return;
    if (captures.length + liste.length > MAX_CAPTURES) { toast.error(ts.screenshotTooMany); return; }
    const nouvelles: Array<{ fichier: File; apercu: string }> = [];
    for (const f of Array.from(liste)) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const reduit = await normalizeImageForUpload(f, { maxDim: 1600, quality: 0.85 });
        nouvelles.push({ fichier: reduit, apercu: URL.createObjectURL(reduit) });
      } catch (e) {
        captureClientException(e, { module: 'support', action: 'capture-reduire' });
        toast.error(ts.screenshotFailed);
      }
    }
    setCaptures((c) => [...c, ...nouvelles].slice(0, MAX_CAPTURES));
    if (fichierRef.current) fichierRef.current.value = '';
  }
  function retirerCapture(i: number) {
    setCaptures((c) => { URL.revokeObjectURL(c[i]?.apercu); return c.filter((_, j) => j !== i); });
  }
  /** Téléverse les captures en attente ; renvoie leurs chemins (vide si aucune). Lève si une échoue. */
  async function televerserCaptures(): Promise<Array<{ chemin: string; nom: string }>> {
    const chemins: Array<{ chemin: string; nom: string }> = [];
    for (const c of captures) {
      const { capture } = await televerserCaptureSupport(c.fichier, c.fichier.name || 'capture.jpg');
      chemins.push({ chemin: capture.chemin, nom: capture.nom });
    }
    return chemins;
  }

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
    const message = (suggestion ?? texte).trim() || (captures.length && !humain ? (fr ? '(capture d’écran)' : '(screenshot)') : '');
    if ((!message && !humain) || envoi) return;
    setEnvoi(true);
    try {
      const chemins = suggestion ? [] : await televerserCaptures();
      if (ticket && (ticket.status === 'open' || ticket.status === 'answered')) {
        const { ticket: maj } = await sendSupportMessage(ticket.id, message, chemins);
        setTicket(maj);
      } else if (humain && ticket) {
        const r = await escalateSupportTicket(ticket.id);
        setTicket(r.ticket);
        toast.success(ts.humanNotified.replace('{delay}', sla(r.slaKey)));
      } else {
        // La page courante part avec la question : Lumi dit où cliquer d'ici, pas depuis le menu.
        const page = typeof window !== 'undefined' && /^\/[A-Za-z0-9/_-]*$/.test(window.location.pathname) ? window.location.pathname.slice(0, 200) : undefined;
        const r = await chatSupport({ ticketId: ticket?.id, message: message || (fr ? 'Je veux parler à un humain.' : 'I want to talk to a human.'), humain, origine: suggestion ? 'suggestion' : 'texte', page, ...(chemins.length ? { captures: chemins } : {}) });
        setTicket(r.ticket);
        if (r.escalated) toast.success(ts.humanNotified.replace('{delay}', sla(r.slaKey)));
      }
      setTexte('');
      captures.forEach((c) => URL.revokeObjectURL(c.apercu));
      setCaptures([]);
    } catch (err) {
      erreur(err);
    } finally {
      setEnvoi(false);
    }
  }

  // 👍 / 👎 sur une réponse de Lumi : enregistré tout de suite, l'état local suit ; un 👎 invite à préciser ou à demander l'équipe.
  async function noter(messageId: string, avis: 'bon' | 'mauvais') {
    if (!ticket) return;
    const avant = ticket;
    setTicket({ ...ticket, messages: ticket.messages.map((m) => (m.id === messageId ? { ...m, avis } : m)) });
    try {
      await noterReponseSupport(ticket.id, messageId, avis);
      if (avis === 'mauvais') toast.message(ts.feedbackBad);
    } catch (e) {
      setTicket(avant);
      captureClientException(e, { module: 'support', action: 'avis' });
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
              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', r.status === 'closed' ? 'bg-surface-tertiary text-text-tertiary' : r.status === 'answered' ? 'border border-outline text-text-secondary' : 'bg-primary/10 text-primary')}>
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
        {/* Toujours visible : l'historique est un bouton, pas un lien qu'on cherche. */}
        <div className="mt-2 flex items-center justify-center gap-2">
          <button type="button" onClick={() => setShowList(true)} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-text-primary bg-surface border border-outline-subtle rounded-full px-3 py-1.5 hover:bg-surface-secondary transition-colors">
            <History size={13} aria-hidden="true" /> {ts.recentConversations}{recents.length > 0 ? ` (${recents.length})` : ''}
          </button>
          {ticket && (
              <button type="button" onClick={() => { setTicket(null); setTexte(''); }} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-text-secondary bg-surface border border-outline-subtle rounded-full px-3 py-1.5 hover:bg-surface-secondary transition-colors">
                <Plus size={13} aria-hidden="true" /> {ts.newConversation}
              </button>
            )}
        </div>
      </div>

      {/* Conversation */}
      <div ref={listeRef} role="log" aria-live="polite" aria-label={ts.title} className={cn('flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-surface-secondary/30', compact ? '' : 'max-h-[460px]')}>
        {messages.length === 0 && (
          <div className="bg-surface border border-outline-subtle rounded-2xl rounded-tl-sm px-3.5 py-3 text-[13.5px] leading-relaxed text-text-secondary max-w-[92%] shadow-sm">{ts.welcome}</div>
        )}
        {messages.map((m) => (
          m.author === 'user' ? (
            <div key={m.id} className="ml-auto max-w-[92%]">
              <div className="bg-gray-900 text-white dark:bg-white dark:text-gray-900 rounded-2xl rounded-tr-sm px-3.5 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap">{m.body}</div>
              {!!m.pieces?.length && (
                <div className="flex flex-wrap gap-1.5 justify-end mt-1.5">
                  {m.pieces.map((p) => (
                    <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden border border-outline-subtle">
                      <img src={p.url} alt={`${ts.screenshotOf} ${p.nom}`} className="h-20 w-auto object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ) : m.author === 'agent' ? (
            // Réponse d'une personne de l'équipe : avatar aux initiales, nom et
            // heure au-dessus, bulle soulignée d'un filet — sobre, pas de vert.
            <div key={m.id} className="flex items-end gap-2 max-w-[92%]">
              <span className="w-7 h-7 rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900 text-[11px] font-bold flex items-center justify-center shrink-0" aria-hidden="true">{initiales(m.authorName)}</span>
              <div className="min-w-0">
                <p className="text-[10.5px] text-text-tertiary mb-1 pl-1">
                  <span className="font-semibold text-text-primary">{m.authorName || ts.agentLabel}</span>
                  {m.authorName ? ` · ${ts.agentLabel}` : ''}{` · ${heureCourte(m.createdAt, fr)}`}
                </p>
                <div className="bg-surface border border-outline-subtle border-l-2 border-l-primary rounded-2xl rounded-tl-sm px-3.5 py-3 text-[13.5px] leading-relaxed text-text-primary shadow-sm whitespace-pre-wrap"><TexteAvecLiens texte={m.body} onNavigate={allerA} /></div>
              </div>
            </div>
          ) : (
            <div key={m.id} className="max-w-[92%]">
              <div className="bg-surface border border-outline-subtle rounded-2xl rounded-tl-sm px-3.5 py-3 text-[13.5px] leading-relaxed text-text-secondary shadow-sm whitespace-pre-wrap"><TexteAvecLiens texte={m.body} onNavigate={allerA} /></div>
              {/* 👍 / 👎 : un geste, pas un formulaire. Visible tant que la réponse n'est pas notée ; ensuite, seul le choix reste. */}
              <div className="flex items-center gap-1 mt-1 pl-1" aria-label={ts.feedbackQuestion}>
                {(!m.avis || m.avis === 'bon') && (
                  <button type="button" onClick={() => noter(m.id, 'bon')} disabled={!!m.avis} aria-label={ts.helpful} aria-pressed={m.avis === 'bon'} className={cn('p-1 rounded-full text-text-tertiary hover:text-primary hover:bg-surface-secondary', m.avis === 'bon' && 'text-primary')}>
                    <ThumbsUp size={13} aria-hidden="true" />
                  </button>
                )}
                {(!m.avis || m.avis === 'mauvais') && (
                  <button type="button" onClick={() => noter(m.id, 'mauvais')} disabled={!!m.avis} aria-label={ts.notHelpful} aria-pressed={m.avis === 'mauvais'} className={cn('p-1 rounded-full text-text-tertiary hover:text-danger hover:bg-surface-secondary', m.avis === 'mauvais' && 'text-danger')}>
                    <ThumbsDown size={13} aria-hidden="true" />
                  </button>
                )}
                {m.avis && <span className="text-[10.5px] text-text-tertiary">{m.avis === 'bon' ? ts.feedbackThanks : ts.feedbackBad}</span>}
              </div>
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

      {/* Saisie — aussi quand la conversation est fermée : écrire la rouvre. */}
      {(
        <form onSubmit={(e) => { e.preventDefault(); envoyer(false); }} className="shrink-0 border-t border-outline-subtle">
          {captures.length > 0 && (
            <div className="flex gap-2 px-3.5 pt-3">
              {captures.map((c, i) => (
                <div key={c.apercu} className="relative">
                  <img src={c.apercu} alt={`${ts.screenshotOf} ${c.fichier.name}`} className="h-14 w-auto rounded-lg border border-outline-subtle object-cover" />
                  <button type="button" onClick={() => retirerCapture(i)} aria-label={ts.removeScreenshot} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900 flex items-center justify-center">
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
            <label htmlFor={fichierId} className="sr-only">{ts.attachScreenshot}</label>
            <input id={fichierId} ref={fichierRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void ajouterCaptures(e.target.files)} />
            {!chezHumain || ticket ? (
              <button type="button" onClick={() => fichierRef.current?.click()} disabled={envoi || captures.length >= MAX_CAPTURES} aria-label={ts.attachScreenshot} className="w-9 h-9 rounded-full text-text-tertiary hover:text-text-primary hover:bg-surface-secondary flex items-center justify-center shrink-0 disabled:opacity-40">
                <ImagePlus size={17} aria-hidden="true" />
              </button>
            ) : null}
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
              disabled={envoi || (!texte.trim() && !captures.length)}
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
