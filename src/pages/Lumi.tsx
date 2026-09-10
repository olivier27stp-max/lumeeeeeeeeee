/**
 * Lumi — l'assistant IA dans l'application (Claude, outils Lume).
 *
 * Remplace la page « Lume Agent » cachée. Le serveur garde l'historique,
 * applique le plan (includes_ai), le budget mensuel en dollars et les
 * permissions par rôle ; cette page affiche le flux (SSE), les outils
 * consultés, et les PROPOSITIONS d'écriture à confirmer ou annuler.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, AudioLines, AlertTriangle, CheckCircle2, Loader2, MessageSquarePlus, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { confirmer } from '../components/ui/ConfirmDialog';
import {
  chargerConversationLumi, deciderPropositionLumi, envoyerMessageLumi, listerConversationsLumi, quotaLumi, supprimerConversationLumi,
  ErreurLumi, type BudgetLumi, type ConversationLumi, type EvenementFlux, type MessageLumi, type PropositionLumi,
} from '../lib/lumiApi';

interface Item extends MessageLumi {
  id: number;
  enCours?: boolean;
  outilsActifs?: string[];
}

const LIBELLES_OUTILS: Record<string, [string, string]> = {
  search_clients: ['Recherche des clients', 'Searching clients'],
  search_leads: ['Recherche des prospects', 'Searching leads'],
  list_jobs: ['Consulte les jobs', 'Checking jobs'],
  get_job: ['Consulte un job', 'Checking a job'],
  query_schedule: ["Consulte l'horaire", 'Checking the schedule'],
  find_dates_in_location: ['Cherche des dates', 'Finding dates'],
  list_quotes: ['Consulte les devis', 'Checking quotes'],
  list_invoices: ['Consulte les factures', 'Checking invoices'],
  get_overdue_payments: ['Consulte les paiements en retard', 'Checking overdue payments'],
  get_revenue_summary: ['Calcule les revenus', 'Computing revenue'],
  get_financial_overview: ['Consulte les finances', 'Checking finances'],
  get_day_route: ['Prépare la tournée', 'Preparing the route'],
  get_company_info: ["Consulte l'entreprise", 'Checking company info'],
  get_morning_briefing: ['Prépare le survol du jour', 'Preparing the daily brief'],
  get_team: ["Consulte l'équipe", 'Checking the team'],
  recall_notes: ['Se souvient', 'Recalling notes'],
};

function libelleOutil(name: string, fr: boolean): string {
  const l = LIBELLES_OUTILS[name];
  if (l) return fr ? l[0] : l[1];
  return name.replace(/_/g, ' ');
}

function fmtDollars(cents: number): string {
  return `${(cents / 100).toFixed(2)} $`;
}

export default function Lumi() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const lang: 'fr' | 'en' = fr ? 'fr' : 'en';
  const navigate = useNavigate();
  const uid = useId();

  const [conversations, setConversations] = useState<ConversationLumi[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<{ code: string; message: string } | null>(null);
  const [budget, setBudget] = useState<BudgetLumi | null>(null);
  const [listening, setListening] = useState(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = () => idRef.current++;

  useEffect(() => {
    quotaLumi().then((b) => {
      setBudget(b);
      // Dire tout de suite POURQUOI Lumi est indisponible, sans attendre un envoi.
      if (b.configured === false) setErreur({ code: 'lumi_not_configured', message: '' });
      else if (!b.includes_ai) setErreur({ code: 'plan_sans_lumi', message: '' });
      else if (b.epuise) setErreur({ code: 'quota_epuise', message: '' });
    }).catch(() => setBudget(null));
    listerConversationsLumi().then(setConversations).catch(() => setConversations([]));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, enCours]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ouvrirConversation = useCallback(async (id: string) => {
    setErreur(null);
    try {
      const { messages } = await chargerConversationLumi(id);
      setConversationId(id);
      setItems(messages.map((m) => ({ ...m, id: nextId() })));
    } catch {
      setErreur({ code: 'chargement', message: fr ? 'Impossible de charger cette conversation.' : 'Could not load this conversation.' });
    }
  }, [fr]);

  function nouvelleConversation() {
    abortRef.current?.abort();
    setConversationId(null);
    setItems([]);
    setErreur(null);
    setEnCours(false);
  }

  async function supprimer(id: string) {
    const ok = await confirmer({ message: fr ? 'Supprimer cette conversation ?' : 'Delete this conversation?', danger: true });
    if (!ok) return;
    await supprimerConversationLumi(id).catch(() => {});
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id) nouvelleConversation();
  }

  /** Applique un flux SSE sur le dernier élément assistant (créé si besoin). */
  function appliquerEvenement(e: EvenementFlux) {
    setItems((prev) => {
      const next = [...prev];
      let dernier = next[next.length - 1];
      if (!dernier || dernier.role !== 'assistant' || !dernier.enCours) {
        dernier = { id: nextId(), role: 'assistant', text: '', tools: [], enCours: true, outilsActifs: [] };
        next.push(dernier);
      } else {
        dernier = { ...dernier };
        next[next.length - 1] = dernier;
      }
      switch (e.type) {
        case 'text':
          dernier.text += e.delta;
          break;
        case 'tool':
          if (e.statut === 'debut') dernier.outilsActifs = [...(dernier.outilsActifs ?? []), e.name];
          else {
            dernier.outilsActifs = (dernier.outilsActifs ?? []).filter((n) => n !== e.name);
            if (e.statut === 'fin' && !dernier.tools.includes(e.name)) dernier.tools = [...dernier.tools, e.name];
          }
          break;
        case 'proposal':
          dernier.proposal = { tool_use_id: e.tool_use_id, tool: e.tool, args: e.args, capacite: e.capacite, statut: 'en_attente' };
          break;
        case 'done':
          dernier.enCours = false;
          dernier.outilsActifs = [];
          break;
        case 'error':
          dernier.enCours = false;
          if (!dernier.text) dernier.text = e.message === 'refusal'
            ? (fr ? 'Je ne peux pas répondre à cette demande.' : "I can't help with that request.")
            : (fr ? 'Désolé, je n’ai pas réussi à répondre. Réessayez.' : 'Sorry, I could not answer. Please try again.');
          break;
        default:
          break;
      }
      return next;
    });
    if (e.type === 'done') {
      setBudget(e.budget);
      if (!conversationId) {
        setConversationId(e.conversation_id);
        listerConversationsLumi().then(setConversations).catch(() => {});
      }
    }
  }

  async function lancer(action: (onEvent: (e: EvenementFlux) => void, signal: AbortSignal) => Promise<void>) {
    setErreur(null);
    setEnCours(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await action(appliquerEvenement, ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const e = err as ErreurLumi;
      setErreur({ code: e.code || 'reseau', message: e.message || (fr ? 'Erreur de connexion.' : 'Connection error.') });
      if (e.budget) setBudget(e.budget);
      setItems((prev) => prev.filter((m) => !(m.role === 'assistant' && m.enCours && !m.text)));
    } finally {
      setEnCours(false);
      setItems((prev) => prev.map((m) => (m.enCours ? { ...m, enCours: false, outilsActifs: [] } : m)));
    }
  }

  async function envoyer(texte: string) {
    const t = texte.trim();
    if (!t || enCours) return;
    setInput('');
    setItems((prev) => [
      ...prev.map((m) => (m.proposal?.statut === 'en_attente' ? { ...m, proposal: { ...m.proposal, statut: 'annulee' as const } } : m)),
      { id: nextId(), role: 'user', text: t, tools: [] },
    ]);
    await lancer((onEvent, signal) => envoyerMessageLumi({ conversation_id: conversationId, message: t, language: lang }, onEvent, signal));
  }

  async function decider(p: PropositionLumi, decision: 'confirm' | 'cancel') {
    if (!conversationId || enCours) return;
    setItems((prev) => prev.map((m) => (m.proposal?.tool_use_id === p.tool_use_id
      ? { ...m, proposal: { ...m.proposal, statut: decision === 'confirm' ? 'confirmee' : 'annulee' } }
      : m)));
    await lancer((onEvent, signal) => deciderPropositionLumi({ conversation_id: conversationId, tool_use_id: p.tool_use_id, decision, language: lang }, onEvent, signal));
  }

  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setErreur({ code: 'voix', message: fr ? "La reconnaissance vocale n'est pas supportée par ce navigateur." : 'Voice recognition is not supported in this browser.' });
      return;
    }
    const rec = new SR();
    rec.lang = fr ? 'fr-CA' : 'en-US';
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results as ArrayLike<any>).map((r) => r[0].transcript).join('');
      setInput(text);
      if (e.results[e.results.length - 1].isFinal) { rec.stop(); void envoyer(text); }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  const suggestions = fr
    ? ['Quel est mon chiffre du mois ?', 'Quelles factures sont en retard ?', 'Prépare ma journée de demain', 'Qui sont mes meilleurs clients ?']
    : ['What is my revenue this month?', 'Which invoices are overdue?', 'Prepare my day tomorrow', 'Who are my best clients?'];

  const bloque = budget && (!budget.includes_ai || budget.epuise || budget.configured === false);
  const pctBudget = budget && budget.budget_cents > 0 ? Math.min(100, Math.round((budget.depense_cents / budget.budget_cents) * 100)) : 0;

  return (
    <div className="flex h-[calc(100vh-7rem)] max-w-[1180px] mx-auto px-4 gap-4">
      {/* ── Conversations ── */}
      <aside className="hidden md:flex w-[240px] shrink-0 flex-col py-6">
        <button
          type="button"
          onClick={nouvelleConversation}
          className="inline-flex items-center gap-2 rounded-xl border border-outline bg-surface px-3 py-2 text-[13px] font-medium text-text-primary hover:bg-surface-secondary transition-colors"
        >
          <MessageSquarePlus size={15} /> {fr ? 'Nouvelle conversation' : 'New conversation'}
        </button>
        <ul className="mt-3 flex-1 overflow-y-auto space-y-1" aria-label={fr ? 'Conversations' : 'Conversations'}>
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => ouvrirConversation(c.id)}
                className={cn(
                  'flex-1 min-w-0 text-left truncate rounded-lg px-3 py-2 text-[12.5px] transition-colors',
                  c.id === conversationId ? 'bg-surface-secondary text-text-primary font-medium' : 'text-text-secondary hover:bg-surface-secondary',
                )}
              >
                {c.title || (fr ? 'Sans titre' : 'Untitled')}
              </button>
              <button
                type="button"
                onClick={() => supprimer(c.id)}
                aria-label={fr ? 'Supprimer la conversation' : 'Delete conversation'}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1.5 rounded-md text-text-tertiary hover:text-danger transition-opacity"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        {budget && budget.includes_ai && (
          <div className="mt-3 rounded-xl border border-outline bg-surface p-3">
            <div className="flex items-center justify-between text-[11px] text-text-tertiary">
              <span>{fr ? 'Budget IA du mois' : 'AI budget this month'}</span>
              <span className="tabular-nums">{fmtDollars(budget.depense_cents)} / {fmtDollars(budget.budget_cents)}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-surface-secondary overflow-hidden" role="progressbar" aria-valuenow={pctBudget} aria-valuemin={0} aria-valuemax={100} aria-label={fr ? 'Budget IA utilisé' : 'AI budget used'}>
              <div className={cn('h-full transition-all', pctBudget >= 90 ? 'bg-danger' : 'bg-primary')} style={{ width: `${pctBudget}%` }} />
            </div>
          </div>
        )}
      </aside>

      {/* ── Chat ── */}
      <div className="flex flex-col flex-1 min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-4">
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center mt-[10vh] gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles size={22} className="text-primary" />
              </div>
              <div>
                <h2 className="text-[18px] font-semibold text-text-primary">Lumi</h2>
                <p className="text-[13px] text-text-tertiary mt-1 max-w-[440px]">
                  {fr
                    ? 'Je connais vos clients, vos jobs, vos devis et vos factures. Posez une question, ou demandez-moi de préparer une action : rien ne part sans votre confirmation.'
                    : 'I know your clients, jobs, quotes and invoices. Ask a question, or have me prepare an action: nothing goes out without your confirmation.'}
                </p>
              </div>
              {!bloque && (
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => envoyer(s)} className="px-3.5 py-2 rounded-full border border-outline bg-surface text-[12.5px] text-text-secondary hover:bg-surface-secondary transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {items.map((m) => (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap',
                m.role === 'user' ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-surface-secondary text-text-primary',
              )}>
                {m.role === 'assistant' && (m.outilsActifs?.length ?? 0) > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {m.outilsActifs!.map((n) => (
                      <span key={n} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-text-tertiary">
                        <Loader2 size={10} className="animate-spin" /> {libelleOutil(n, fr)}…
                      </span>
                    ))}
                  </div>
                )}
                {m.role === 'assistant' && m.tools.length > 0 && !m.enCours && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {m.tools.map((n) => (
                      <span key={n} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-text-tertiary">
                        <CheckCircle2 size={10} /> {libelleOutil(n, fr)}
                      </span>
                    ))}
                  </div>
                )}
                {m.text || (m.enCours ? <Loader2 size={16} className="animate-spin text-text-tertiary" /> : null)}
                {m.proposal && (
                  <PropositionCarte
                    proposition={m.proposal}
                    fr={fr}
                    busy={enCours}
                    onDecision={(d) => decider(m.proposal!, d)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {erreur && (
          <div className="mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-[12px]" role="alert">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              {erreur.code === 'quota_epuise'
                ? (fr ? 'Le budget IA du mois est atteint. Lumi reprend le 1er du mois prochain.' : 'This month’s AI budget is reached. Lumi resumes on the 1st of next month.')
                : erreur.code === 'plan_sans_lumi'
                  ? (fr ? 'Lumi est inclus dans les plans Scale et Autopilot.' : 'Lumi is included in the Scale and Autopilot plans.')
                  : erreur.code === 'lumi_not_configured'
                    ? (fr ? "Lumi n'est pas encore activé sur ce serveur." : 'Lumi is not enabled on this server yet.')
                    : erreur.message}
            </span>
            {erreur.code === 'plan_sans_lumi' && (
              <button type="button" onClick={() => navigate('/settings/billing')} className="ml-auto underline">{fr ? 'Voir les plans' : 'See plans'}</button>
            )}
          </div>
        )}

        <div className="pb-4">
          <div className="relative rounded-2xl border border-outline bg-surface shadow-sm focus-within:border-primary/50 transition-colors">
            <label htmlFor={`${uid}-lumi-input`} className="sr-only">{fr ? 'Message à Lumi' : 'Message to Lumi'}</label>
            <textarea
              id={`${uid}-lumi-input`}
              rows={2}
              value={input}
              disabled={!!bloque}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void envoyer(input); } }}
              placeholder={bloque
                ? (fr ? 'Lumi est indisponible pour le moment.' : 'Lumi is unavailable for now.')
                : (fr ? 'Pose-moi une question ou donne-moi une instruction…' : 'Ask a question or give an instruction…')}
              className="w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-0 leading-relaxed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={toggleVoice}
              disabled={!!bloque}
              aria-label={listening ? (fr ? 'Arrêter la dictée' : 'Stop dictation') : (fr ? 'Dicter' : 'Dictate')}
              aria-pressed={listening}
              className={cn('absolute bottom-2.5 right-12 w-8 h-8 rounded-full flex items-center justify-center transition-colors', listening ? 'bg-danger/10 text-danger' : 'text-text-tertiary hover:bg-surface-secondary')}
            >
              <AudioLines size={16} />
            </button>
            <button
              type="button"
              onClick={() => envoyer(input)}
              disabled={enCours || !input.trim() || !!bloque}
              aria-label={fr ? 'Envoyer' : 'Send'}
              className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {enCours ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.5} />}
            </button>
          </div>
          <p className="text-[10.5px] text-text-tertiary text-center mt-2">
            {fr ? 'Lumi peut se tromper. Vérifiez les montants avant d’agir. Rien n’est créé ni envoyé sans votre confirmation.' : 'Lumi can make mistakes. Check amounts before acting. Nothing is created or sent without your confirmation.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function PropositionCarte({ proposition, fr, busy, onDecision }: { proposition: PropositionLumi; fr: boolean; busy: boolean; onDecision: (d: 'confirm' | 'cancel') => void }) {
  const titre = proposition.capacite
    ? (fr ? `Action proposée : ${proposition.capacite}` : `Proposed action: ${proposition.capacite}`)
    : (fr ? `Action proposée : ${proposition.tool.replace(/_/g, ' ')}` : `Proposed action: ${proposition.tool.replace(/_/g, ' ')}`);
  const entrees = Object.entries(proposition.args).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <div className="mt-3 rounded-xl border border-outline bg-surface p-3 text-[13px]">
      <p className="font-semibold text-text-primary">{titre}</p>
      {entrees.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {entrees.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-text-tertiary">{k.replace(/_/g, ' ')}</dt>
              <dd className="text-text-primary break-words">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {proposition.statut === 'en_attente' ? (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={() => onDecision('confirm')} className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {fr ? 'Confirmer' : 'Confirm'}
          </button>
          <button type="button" disabled={busy} onClick={() => onDecision('cancel')} className="rounded-lg border border-outline bg-surface px-3 py-1.5 text-[12.5px] font-medium text-text-secondary hover:bg-surface-secondary disabled:opacity-50">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
        </div>
      ) : (
        <p className={cn('mt-2 inline-flex items-center gap-1.5 text-[11.5px]', proposition.statut === 'confirmee' ? 'text-emerald-600' : proposition.statut === 'echouee' ? 'text-danger' : 'text-text-tertiary')}>
          {proposition.statut === 'confirmee' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {proposition.statut === 'confirmee' ? (fr ? 'Exécutée' : 'Executed') : proposition.statut === 'echouee' ? (fr ? 'Échouée' : 'Failed') : (fr ? 'Annulée' : 'Cancelled')}
        </p>
      )}
    </div>
  );
}
