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
import { motion } from 'motion/react';
import { ArrowUp, AudioLines, AlertTriangle, ChevronDown, Copy, Download, FileText, History, Loader2, MessageSquarePlus, Mic, RotateCcw, Sparkles, Square, Trash2, Volume2, VolumeX, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useVoiceInput, MAX_SECONDS } from '../features/agent/hooks/useVoiceInput';
import { useSpeakReplies } from '../features/agent/hooks/useSpeakReplies';
import { toast } from 'sonner';
import PageHeader from '../components/ui/PageHeader';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import { confirmer } from '../components/ui/ConfirmDialog';
import {
  chargerConversationLumi, deciderPropositionLumi, envoyerMessageLumi, listerConversationsLumi, quotaLumi, supprimerConversationLumi,
  ErreurLumi, type BudgetLumi, type ConversationLumi, type EvenementFlux, type MessageLumi, type PropositionLumi, type RapportLumi,
} from '../lib/lumiApi';

interface Item extends MessageLumi {
  id: number;
  enCours?: boolean;
  outilsActifs?: string[];
  /** Début et durée (ms) de la réponse, pour « Réflexion · 3 s ». */
  debut?: number;
  duree?: number;
}

/** Page du CRM où vérifier ce qu'un outil a consulté (ligne « Sources »). */
const SOURCES_OUTILS: Record<string, [string, string, string]> = {
  search_clients: ['/clients', 'Clients', 'Clients'],
  search_leads: ['/pipeline', 'Pipeline', 'Pipeline'],
  list_jobs: ['/jobs', 'Jobs', 'Jobs'],
  get_job: ['/jobs', 'Jobs', 'Jobs'],
  query_schedule: ['/calendar', 'Calendrier', 'Calendar'],
  find_dates_in_location: ['/calendar', 'Calendrier', 'Calendar'],
  get_day_route: ['/dispatch', 'Carte de répartition', 'Dispatch map'],
  list_quotes: ['/quotes', 'Devis', 'Quotes'],
  list_invoices: ['/finances', 'Finances', 'Finances'],
  get_overdue_payments: ['/finances', 'Finances', 'Finances'],
  get_revenue_summary: ['/finances', 'Finances', 'Finances'],
  get_financial_overview: ['/finances', 'Finances', 'Finances'],
  get_team: ['/settings/team', 'Équipe', 'Team'],
  get_morning_briefing: ['/day', 'Accueil', 'Home'],
};

/* Réflexion et outils de message : le petit disque qui tourne, le libellé qui
   scintille, et les boutons copier / réessayer visibles au survol. */
const LUMI_CSS = `
.lumi-disc { width:14px; height:14px; border-radius:50%; border:2px solid rgba(63,175,151,.25); border-top-color:#3FAF97; flex:none; }
.lumi-disc.live { animation: lumi-spin .9s linear infinite; }
.lumi-disc.done { border-color:#3FAF97; background: radial-gradient(circle, #3FAF97 35%, transparent 40%); }
.lumi-shimmer { background: linear-gradient(90deg, currentColor 0%, #3FAF97 50%, currentColor 100%); background-size:200% 100%; -webkit-background-clip:text; background-clip:text; color:transparent; animation: lumi-shimmer 1.6s linear infinite; }
.lumi-halo { box-shadow: 0 0 0 0 rgba(63,175,151,.55); animation: lumi-halo 1.4s ease-out infinite; }
.lumi-msg .lumi-tools { opacity:0; transition: opacity .15s; }
.lumi-msg:hover .lumi-tools, .lumi-msg .lumi-tools:focus-within { opacity:1; }
.lumi-think > summary { list-style:none; }
.lumi-think > summary::-webkit-details-marker { display:none; }
.lumi-think .lumi-chev { transition: transform .2s; }
.lumi-think[open] .lumi-chev { transform: rotate(180deg); }
@keyframes lumi-spin { to { transform: rotate(360deg); } }
@keyframes lumi-shimmer { to { background-position: -200% 0; } }
@keyframes lumi-halo { to { box-shadow: 0 0 0 9px rgba(63,175,151,0); } }
@media (prefers-reduced-motion: reduce) { .lumi-disc.live, .lumi-shimmer, .lumi-halo { animation: none !important; } .lumi-shimmer { color: inherit; } }
`;

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
  build_report: ['Prépare le rapport', 'Building the report'],
};

function libelleOutil(name: string, fr: boolean): string {
  const l = LIBELLES_OUTILS[name];
  if (l) return fr ? l[0] : l[1];
  return name.replace(/_/g, ' ');
}

/**
 * Rendu du texte de Lumi : gras (**x**), puces (- x), titres (### x) et
 * tableaux Markdown (| a | b |), sans bibliothèque ni HTML injecté. Le modèle
 * écrit un peu de Markdown ; l'afficher brut (étoiles, dièses, barres |)
 * faisait « brouillon » — un tableau de forfaits ressortait en bouillie de |.
 */
function Gras({ texte }: { texte: string }) {
  const morceaux = texte.split(/\*\*(.+?)\*\*/g);
  return <>{morceaux.map((m, i) => (i % 2 === 1 ? <strong key={i} className="font-semibold">{m}</strong> : <React.Fragment key={i}>{m}</React.Fragment>))}</>;
}

/** Découpe une ligne de tableau Markdown en cellules, sans les | de bord. */
function cellulesTableau(ligne: string): string[] {
  return ligne.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

/** Une ligne est-elle un séparateur d'en-tête Markdown (|---|:--:|) ? */
function estSeparateurTableau(ligne: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(ligne);
}

function TableauLumi({ lignes }: { lignes: string[] }) {
  const entete = cellulesTableau(lignes[0]);
  const corps = lignes.slice(2).map(cellulesTableau);
  return (
    <div className="my-1 overflow-x-auto">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            {entete.map((c, i) => (
              <th key={i} className="border-b border-outline px-2 py-1.5 pl-0 text-left text-[12px] font-medium text-text-tertiary whitespace-nowrap"><Gras texte={c} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {corps.map((rangee, r) => (
            <tr key={r}>
              {rangee.map((c, i) => (
                <td key={i} className="border-b border-outline/50 px-2 py-1.5 pl-0 align-top"><Gras texte={c} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TexteLumi({ texte }: { texte: string }) {
  const lignes = texte.replace(/\r/g, '').split('\n');
  const blocs: React.ReactNode[] = [];
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];

    // Tableau Markdown : ligne | … | suivie d'un séparateur |---|---|.
    const estRangee = /^\s*\|.*\|\s*$/.test(l);
    if (estRangee && i + 1 < lignes.length && estSeparateurTableau(lignes[i + 1])) {
      const debut = i;
      let j = i + 2;
      while (j < lignes.length && /^\s*\|.*\|\s*$/.test(lignes[j])) j++;
      blocs.push(<TableauLumi key={`t${debut}`} lignes={lignes.slice(debut, j)} />);
      i = j - 1;
      continue;
    }

    const puce = /^\s*[-*•]\s+(.*)$/.exec(l);
    const titre = /^\s*#{1,4}\s+(.*)$/.exec(l);
    if (puce) {
      blocs.push(
        <span key={i} className="flex gap-2 pl-1">
          <span aria-hidden="true">•</span>
          <span className="flex-1"><Gras texte={puce[1]} /></span>
        </span>,
      );
    } else if (titre) {
      blocs.push(<span key={i} className="block font-semibold mt-1"><Gras texte={titre[1]} /></span>);
    } else {
      blocs.push(<span key={i} className="block min-h-[0.6em]"><Gras texte={l} /></span>);
    }
  }
  return <>{blocs}</>;
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
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* Vrai si la dernière question a été dite au micro : la réponse est alors lue. */
  const spokenRef = useRef(false);
  /* Le micro a rempli la zone de saisie ; au prochain envoi, on lira la réponse. */
  const pendingSpokenRef = useRef(false);
  /* Ce qu'il y avait dans la zone avant de parler : l'aperçu s'écrit à la suite. */
  const baseSaisieRef = useRef('');
  const speech = useSpeakReplies(lang);
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
        dernier = { id: nextId(), role: 'assistant', text: '', tools: [], enCours: true, outilsActifs: [], debut: Date.now() };
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
          // Le modèle propose parfois l'action sans un mot : on l'annonce.
          if (!dernier.text.trim()) dernier.text = fr ? "J'ai préparé l'action ci-dessous. Confirmez pour l'exécuter." : 'I prepared the action below. Confirm to run it.';
          break;
        case 'report':
          dernier.report = e.rapport;
          break;
        case 'done':
          dernier.enCours = false;
          dernier.outilsActifs = [];
          dernier.duree = Date.now() - (dernier.debut ?? Date.now());
          break;
        case 'error':
          dernier.enCours = false;
          dernier.duree = Date.now() - (dernier.debut ?? Date.now());
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
      if (spokenRef.current) {
        // Lire la réponse complète, seulement si la question a été dite au micro.
        setItems((prev) => {
          const dernier = [...prev].reverse().find((m) => m.role === 'assistant' && m.text);
          if (dernier?.text) speech.speak(dernier.text);
          return prev;
        });
      }
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

  async function envoyer(texte: string, opts: { spoken?: boolean } = {}) {
    const t = texte.trim();
    if (!t || enCours) return;
    setInput('');
    spokenRef.current = !!opts.spoken || pendingSpokenRef.current;
    pendingSpokenRef.current = false;
    speech.stopSpeaking();
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

  /* Micro : enregistre (MediaRecorder, tous navigateurs), le serveur transcrit,
     le texte part comme un message et la réponse est lue à voix haute. */
  const voice = useVoiceInput({
    language: lang,
    // Aperçu en direct : les mots s'écrivent pendant qu'on parle.
    onInterim: (text) => { const base = baseSaisieRef.current; setInput(base ? `${base} ${text}` : text); },
    // Rien ne part tout seul : le texte final remplace l'aperçu, on relit, on envoie.
    onTranscript: (text) => {
      const base = baseSaisieRef.current;
      setInput(base ? `${base} ${text}` : text);
      pendingSpokenRef.current = true;
      requestAnimationFrame(() => { const el = document.getElementById(`${uid}-lumi-input`) as HTMLTextAreaElement | null; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); });
    },
    onError: (message) => setErreur({ code: 'voix', message }),
  });
  const listening = voice.state === 'recording';
  const transcribing = voice.state === 'transcribing';
  function toggleVoice() {
    if (listening) voice.stop();
    else if (voice.state === 'idle') { baseSaisieRef.current = input.trim(); void voice.start(); }
  }
  const chrono = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, '0')}`;

  function copier(texte: string) {
    try { void navigator.clipboard?.writeText(texte); } catch { /* presse-papiers indisponible */ }
  }
  /** Relance la question qui a produit ce message. */
  function reessayer(itemId: number) {
    const idx = items.findIndex((m) => m.id === itemId);
    const question = [...items.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (question?.text) void envoyer(question.text);
  }

  const suggestions = fr
    ? ['Quel est mon chiffre du mois ?', 'Quelles factures sont en retard ?', 'Prépare ma journée de demain', 'Qui sont mes meilleurs clients ?']
    : ['What is my revenue this month?', 'Which invoices are overdue?', 'Prepare my day tomorrow', 'Who are my best clients?'];

  const bloque = budget && (!budget.includes_ai || budget.epuise || budget.configured === false);
  const pctBudget = budget && budget.budget_cents > 0 ? Math.min(100, Math.round((budget.depense_cents / budget.budget_cents) * 100)) : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <style>{LUMI_CSS}</style>
      {/* ── En-tête, comme toute page du CRM ── */}
      <PageHeader
        title="Lumi"
        subtitle={fr ? 'Votre assistant. Il connaît vos clients, vos jobs, vos devis et vos factures.' : 'Your assistant. It knows your clients, jobs, quotes and invoices.'}
      >
        {budget && budget.includes_ai && (
          <span
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] tabular-nums', pctBudget >= 90 ? 'border-danger/30 bg-danger/10 text-danger' : 'border-outline bg-surface text-text-secondary')}
            title={fr ? 'Budget IA du mois' : 'AI budget this month'}
          >
            <Sparkles size={12} className={pctBudget >= 90 ? 'text-danger' : 'text-primary'} />
            {fmtDollars(budget.depense_cents)} / {fmtDollars(budget.budget_cents)}
          </span>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setHistoriqueOuvert((v) => !v)}
            aria-expanded={historiqueOuvert}
            aria-haspopup="menu"
            aria-label={fr ? 'Historique des conversations' : 'Conversation history'}
            className="glass-button inline-flex items-center gap-1.5 text-[12px]"
          >
            <History size={13} /> <span className="hidden sm:inline">{fr ? 'Historique' : 'History'}</span>
          </button>
          {historiqueOuvert && (
            <>
              <div role="presentation" tabIndex={-1} className="fixed inset-0 z-20" onClick={() => setHistoriqueOuvert(false)} />
              <div role="menu" className="absolute right-0 z-30 mt-2 w-[300px] section-card p-1.5">
                {conversations.length === 0 && (
                  <p className="px-3 py-2 text-[12px] text-text-tertiary">{fr ? 'Aucune conversation encore.' : 'No conversations yet.'}</p>
                )}
                {conversations.map((c) => (
                  <div key={c.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setHistoriqueOuvert(false); void ouvrirConversation(c.id); }}
                      className={cn('flex-1 min-w-0 truncate rounded-lg px-3 py-2 text-left text-[12.5px] transition-colors', c.id === conversationId ? 'bg-surface-secondary text-text-primary font-medium' : 'text-text-secondary hover:bg-surface-secondary')}
                    >
                      {c.title || (fr ? 'Sans titre' : 'Untitled')}
                    </button>
                    <button
                      type="button"
                      onClick={() => supprimer(c.id)}
                      aria-label={fr ? 'Supprimer la conversation' : 'Delete conversation'}
                      className="p-1.5 rounded-md text-text-tertiary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger transition-opacity"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={nouvelleConversation} className="glass-button-primary inline-flex items-center gap-1.5 text-[12px]">
          <MessageSquarePlus size={13} /> <span className="hidden sm:inline">{fr ? 'Nouvelle conversation' : 'New conversation'}</span><span className="sm:hidden">{fr ? 'Nouvelle' : 'New'}</span>
        </button>
      </PageHeader>

      {/* ── La conversation, centrée comme avant ── */}
      <div className="flex flex-col flex-1 min-h-0 max-w-[820px] w-full mx-auto">
        <div ref={scrollRef} className="flex-1 overflow-y-auto py-2 space-y-4">
          {items.length === 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center text-center mt-[4vh] sm:mt-[10vh] gap-4">
              <button
                type="button"
                onClick={toggleVoice}
                disabled={!!bloque}
                aria-label={fr ? 'Parler à Lumi' : 'Talk to Lumi'}
                aria-pressed={listening}
                title={fr ? 'Parler à Lumi' : 'Talk to Lumi'}
                className={cn('w-12 h-12 rounded-2xl flex items-center justify-center transition-colors disabled:opacity-50', listening ? 'bg-primary text-white animate-pulse' : 'bg-primary/10 text-primary hover:bg-primary/20')}
              >
                {transcribing ? <Loader2 size={22} className="animate-spin" /> : <AudioLines size={22} strokeWidth={2.75} />}
              </button>
              {(listening || transcribing) && (
                <p className="text-[12px] font-medium text-primary -mt-2" aria-live="polite">
                  {listening ? `${fr ? 'Je t’écoute' : 'Listening'} · ${chrono}` : (fr ? 'Je transcris…' : 'Transcribing…')}
                </p>
              )}
              <div>
                <h2 className="text-[18px] font-semibold text-text-primary">Lumi</h2>
                <p className="text-[13px] text-text-tertiary mt-1 max-w-[420px]">
                  {fr
                    ? 'Je connais tout ton espace de travail. Pose une question, ou demande-moi de préparer un devis, une facture, une job ou un message : tu confirmes avant chaque action.'
                    : 'I know your whole workspace. Ask anything, or have me draft a quote, invoice, job or message: you confirm before every action.'}
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
            </motion.div>
          )}

          {items.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-surface-secondary border border-outline/50 px-4 py-2.5 text-[14px] text-text-primary whitespace-pre-wrap">{m.text}</div>
                </div>
              );
            }
            const actifs = m.outilsActifs ?? [];
            const reflechit = !!m.enCours && (!m.text || actifs.length > 0);
            const etapes = [...m.tools, ...actifs.filter((n) => !m.tools.includes(n))];
            const secondes = m.duree ? Math.max(1, Math.round(m.duree / 1000)) : null;
            const sources = Array.from(new Map(m.tools.filter((n) => SOURCES_OUTILS[n]).map((n) => [SOURCES_OUTILS[n][0], SOURCES_OUTILS[n]])).values());
            return (
              <div key={m.id} className="lumi-msg grid grid-cols-[28px_1fr] gap-3">
                <img src="/agent/lumi-poster.png" alt="" width={28} height={28} className={cn('mt-0.5 h-7 w-7 rounded-full bg-surface-secondary', reflechit && 'lumi-halo')} />
                <div className="min-w-0">
                  {(reflechit || etapes.length > 0) && (
                    <details className="lumi-think mb-2" open={reflechit}>
                      <summary className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-text-secondary">
                        <span className={cn('lumi-disc', reflechit ? 'live' : 'done')} aria-hidden="true" />
                        <span className={reflechit ? 'lumi-shimmer' : undefined}>
                          {reflechit
                            ? (fr ? 'Lumi réfléchit…' : 'Lumi is thinking…')
                            : `${fr ? 'Réflexion' : 'Thinking'}${secondes ? ` · ${secondes} s` : ''}`}
                        </span>
                        {etapes.length > 0 && <ChevronDown size={12} className="lumi-chev text-text-tertiary" />}
                      </summary>
                      {etapes.length > 0 && (
                        <ul className="ml-[22px] mt-1.5 border-l-2 border-outline pl-3 text-[12.5px] leading-relaxed text-text-tertiary">
                          {etapes.map((n) => (
                            <li key={n} className="flex items-center gap-2">
                              {actifs.includes(n) && <Loader2 size={10} className="animate-spin" />}
                              {libelleOutil(n, fr)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  )}
                  {m.text && (
                    <div className="text-[14.5px] leading-relaxed text-text-primary"><TexteLumi texte={m.text} /></div>
                  )}
                  {m.report && <RapportCarte rapport={m.report} fr={fr} />}
                  {m.proposal && (
                    <PropositionCarte proposition={m.proposal} fr={fr} busy={enCours} onDecision={(d) => decider(m.proposal!, d)} />
                  )}
                  {!m.enCours && sources.length > 0 && (
                    <p className="mt-2 text-[12.5px] text-text-tertiary">
                      <span className="mr-2">{fr ? 'Sources' : 'Sources'}</span>
                      {sources.map(([href, lfr, len], i) => (
                        <React.Fragment key={href}>
                          {i > 0 && <span className="mx-2 text-text-tertiary">·</span>}
                          <Link to={href} className="border-b border-outline text-text-secondary hover:text-text-primary">{fr ? lfr : len}</Link>
                        </React.Fragment>
                      ))}
                    </p>
                  )}
                  {!m.enCours && m.text && (
                    <div className="lumi-tools mt-1 -ml-1.5 flex gap-0.5">
                      <button type="button" onClick={() => copier(m.text)} title={fr ? 'Copier' : 'Copy'} aria-label={fr ? 'Copier la réponse' : 'Copy reply'} className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-secondary hover:text-text-primary"><Copy size={14} /></button>
                      <button type="button" onClick={() => reessayer(m.id)} disabled={enCours} title={fr ? 'Réessayer' : 'Retry'} aria-label={fr ? 'Reposer la question' : 'Ask again'} className="rounded-md p-1.5 text-text-tertiary hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"><RotateCcw size={14} /></button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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
                    ? (fr ? 'Lumi n’est pas encore activé sur ce serveur.' : 'Lumi is not enabled on this server yet.')
                    : erreur.message}
            </span>
            {erreur.code === 'plan_sans_lumi' && (
              <button type="button" onClick={() => navigate('/settings/billing')} className="ml-auto underline">{fr ? 'Voir les plans' : 'See plans'}</button>
            )}
          </div>
        )}

        {/* ── Champ de saisie, comme avant ── */}
        <div className="pb-4">
          <div className="relative rounded-2xl border border-outline bg-surface shadow-sm focus-within:border-primary/50 transition-colors">
            <label htmlFor={`${uid}-lumi-input`} className="sr-only">{fr ? 'Message à Lumi' : 'Message to Lumi'}</label>
            <textarea
              id={`${uid}-lumi-input`}
              rows={1}
              style={{ maxHeight: 160 }}
              value={input}
              disabled={!!bloque}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void envoyer(input); } }}
              placeholder={bloque
                ? (fr ? 'Lumi est indisponible pour le moment.' : 'Lumi is unavailable for now.')
                : (fr ? 'Pose-moi une question ou donne-moi une instruction…' : 'Ask a question or give an instruction…')}
              className="w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-0 leading-relaxed disabled:opacity-60"
            />
            <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5">
              {voice.supported && (
                <button
                  type="button"
                  onClick={toggleVoice}
                  disabled={!!bloque || transcribing || enCours}
                  aria-label={listening ? (fr ? "Arrêter l'enregistrement" : 'Stop recording') : (fr ? 'Parler à Lumi' : 'Talk to Lumi')}
                  aria-pressed={listening}
                  className={cn('h-8 rounded-full flex items-center gap-2 px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50', listening ? 'bg-danger text-white' : 'bg-primary/10 text-primary hover:bg-primary/20')}
                >
                  {transcribing ? <Loader2 size={15} className="animate-spin" /> : listening ? <Square size={13} fill="currentColor" /> : <Mic size={15} strokeWidth={2.5} />}
                  {listening && <span className="tabular-nums" aria-live="polite">{chrono}</span>}
                  {transcribing && <span>{fr ? 'Transcription…' : 'Transcribing…'}</span>}
                </button>
              )}
              {speech.supported && (
                <button
                  type="button"
                  onClick={() => { if (speech.speaking) speech.stopSpeaking(); else speech.setEnabled(!speech.enabled); }}
                  aria-pressed={speech.enabled}
                  aria-label={speech.enabled ? (fr ? 'Ne plus lire les réponses' : 'Stop reading replies aloud') : (fr ? 'Lire les réponses à voix haute' : 'Read replies aloud')}
                  title={speech.speaking ? (fr ? 'Arrêter la lecture' : 'Stop reading') : speech.enabled ? (fr ? 'Réponses lues quand tu parles' : 'Replies read aloud when you speak') : (fr ? 'Lecture désactivée' : 'Reading off')}
                  className={cn('w-8 h-8 rounded-full flex items-center justify-center transition-colors', speech.speaking ? 'bg-primary text-white animate-pulse' : speech.enabled ? 'text-text-secondary hover:bg-surface-secondary' : 'text-text-tertiary hover:bg-surface-secondary')}
                >
                  {speech.enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                </button>
              )}
            </div>
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
            {listening
              ? (fr ? `Parle ; à la fin, le texte apparaît dans la zone et tu l’envoies toi-même. ${MAX_SECONDS} s max.` : `Speak; when done, the text appears in the box and you send it yourself. ${MAX_SECONDS} s max.`)
              : (fr ? 'Lumi ne crée et n’envoie rien sans ta confirmation. Vérifie les montants avant d’agir.' : 'Lumi never creates or sends anything without your confirmation. Check amounts before acting.')}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Carte d'un rapport : titre, période, chiffres clés et bouton PDF. Le PDF
 * se rend côté client (jsPDF, chargé à la demande pour ne pas alourdir la page).
 */
function RapportCarte({ rapport, fr }: { rapport: RapportLumi; fr: boolean }) {
  const [enCours, setEnCours] = useState(false);
  const kpis = rapport.sections.flatMap((s) => s.kpis ?? []).slice(0, 6);
  const nbTableaux = rapport.sections.filter((s) => s.tableau && s.tableau.lignes.length > 0).length;
  async function telecharger() {
    setEnCours(true);
    try {
      const { telechargerRapportPdf } = await import('../lib/generateRapportPdf');
      telechargerRapportPdf(rapport);
    } catch (e) {
      console.error('[lumi] PDF du rapport', e);
      toast.error(fr ? 'Le PDF n’a pas pu être généré.' : 'The PDF could not be generated.');
    } finally {
      setEnCours(false);
    }
  }
  return (
    <div className="mt-2 section-card p-3.5 text-[13px]">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><FileText size={17} /></div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text-primary truncate">{rapport.titre}</p>
          <p className="text-[12px] text-text-tertiary">{rapport.sous_titre}</p>
        </div>
      </div>
      {kpis.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-lg bg-surface-secondary px-2.5 py-2">
              <dt className="text-[11px] text-text-tertiary truncate">{k.label}</dt>
              <dd className="text-[14px] font-semibold text-text-primary tabular-nums">{k.valeur}</dd>
              {k.detail && <dd className="text-[10.5px] text-text-tertiary truncate">{k.detail}</dd>}
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={telecharger} disabled={enCours} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {enCours ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {fr ? 'Télécharger le PDF' : 'Download PDF'}
        </button>
        <span className="text-[11.5px] text-text-tertiary">
          {rapport.sections.length} {fr ? 'sections' : 'sections'}{nbTableaux ? ` · ${nbTableaux} ${fr ? 'tableaux' : 'tables'}` : ''}
        </span>
      </div>
    </div>
  );
}

function PropositionCarte({ proposition, fr, busy, onDecision }: { proposition: PropositionLumi; fr: boolean; busy: boolean; onDecision: (d: 'confirm' | 'cancel') => void }) {
  const titre = proposition.capacite || proposition.tool.replace(/_/g, ' ');
  // Les identifiants techniques (UUID, réfs opaques) ne disent rien à l'utilisateur.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const entrees = Object.entries(proposition.args).filter(([k, v]) => v !== null && v !== undefined && v !== '' && !/(^|_)id$/.test(k) && !(typeof v === 'string' && UUID.test(v)));
  return (
    <div className="mt-3 rounded-2xl border border-outline bg-surface px-4 py-3.5 text-[13.5px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">{titre}</p>
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
        <div className="mt-3.5 flex gap-2">
          <button type="button" disabled={busy} onClick={() => onDecision('confirm')} className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {fr ? 'Confirmer' : 'Confirm'}
          </button>
          <button type="button" disabled={busy} onClick={() => onDecision('cancel')} className="rounded-lg border border-outline bg-surface px-3 py-1.5 text-[12.5px] font-medium text-text-secondary hover:bg-surface-secondary disabled:opacity-50">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
        </div>
      ) : (
        <p className={cn('mt-2.5 inline-flex items-center gap-2 text-[12px]', proposition.statut === 'confirmee' ? 'text-text-secondary' : proposition.statut === 'echouee' ? 'text-danger' : 'text-text-tertiary')}>
          {proposition.statut === 'confirmee' ? <span className="h-2 w-2 rounded-full bg-[#3FAF97]" aria-hidden="true" /> : <XCircle size={12} />}
          {proposition.statut === 'confirmee' ? (fr ? 'Exécutée' : 'Executed') : proposition.statut === 'echouee' ? (fr ? 'Échouée' : 'Failed') : (fr ? 'Annulée' : 'Cancelled')}
        </p>
      )}
    </div>
  );
}
