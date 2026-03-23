import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  ArrowRight,
  Calendar,
  Mail,
  BarChart3,
  FileText,
  Loader2,
  WifiOff,
  MessageSquare,
  Clock,
  Trash2,
  CheckCircle2,
  Users,
  DollarSign,
  Plus,
  Globe,
  Database,
  Wrench,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { useLocation } from 'react-router-dom';
import OllamaIcon from '../components/icons/OllamaIcon';
import { useFeatureFlags } from '../features/agent/hooks/useFeatureFlags';
import AgentErrorBoundary from '../features/agent/components/AgentErrorBoundary';

const mrLumeChatImport = () => import('../features/agent/components/MrLumeChat');
const MrLumeChat = React.lazy(mrLumeChatImport);
import {
  getRecentConversations,
  getConversationMessages,
  deleteConversation as apiDeleteConversation,
  type AIConversationListItem,
  type AIMessage,
} from '../lib/aiApi';
import { getDashboardData, type DashboardData } from '../lib/dashboardApi';
import { orchestrate, parseRouteEntity, type AIChatMode, type CRMContext } from '../lib/ai';
import { usePermissions } from '../hooks/usePermissions';
import { supabase } from '../lib/supabase';
import { getDefaultPermissions } from '../lib/permissions';

/* ── Types ── */
type UIMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

/* ── Helper: format currency ── */
function fmtMoney(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

/* ── Helper: format time from ISO ── */
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/* ── Build scene blocks from real dashboard data ── */
function buildSceneBlocks(data: DashboardData | null, lang: string) {
  const fr = lang === 'fr';

  // --- Block 1: Prepare me for the day ---
  const appts = data?.appointments.items.slice(0, 2) || [];
  const todayTotal = data?.appointments.total || 0;
  const overdueCount = data?.appointments.overdue || 0;
  const activeJobs = data?.workflow.jobs.active || 0;
  const actionRequired = data?.workflow.jobs.actionRequired || 0;

  const block1Scene = (
    <div className="space-y-2">
      {appts.length > 0 ? appts.map((a) => (
        <a key={a.id} href={`/jobs/${a.jobId}`} onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-2 rounded-lg bg-surface-secondary p-2.5 hover:bg-surface-secondary/80 transition-colors">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: a.teamColor || 'var(--color-text-tertiary)' }} />
          <span className="text-xs font-medium text-text-primary truncate">
            {fmtTime(a.startAt)} — {a.title}
          </span>
          {a.clientName && <span className="text-[10px] text-text-tertiary ml-auto shrink-0">{a.clientName}</span>}
        </a>
      )) : (
        <div className="flex items-center gap-2 rounded-lg bg-surface-secondary p-2.5">
          <Calendar size={12} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">{fr ? 'Aucun rendez-vous aujourd\'hui' : 'No appointments today'}</span>
        </div>
      )}
      <div className="flex items-center gap-2 rounded-lg border border-outline-subtle p-2.5">
        <CheckCircle2 size={12} className="text-text-tertiary" />
        <span className="text-xs text-text-secondary">
          {todayTotal} {t.aiHelper.appointments} · {activeJobs} {t.aiHelper.activeJobs}
          {overdueCount > 0 && <span className="text-amber-500"> · {overdueCount} {t.aiHelper.overdue}</span>}
          {actionRequired > 0 && <span className="text-amber-500"> · {actionRequired} {t.aiHelper.actionRequired}</span>}
        </span>
      </div>
    </div>
  );

  // --- Block 2: Write a follow-up (based on pipeline leads) ---
  const activeLeads = data?.workflow.quotes.activeLeads || 0;
  const quoteSent = data?.workflow.quotes.changesRequested || 0;
  const topClient = data?.appointments.items[0]?.clientName;

  const block2Scene = (
    <div className="rounded-lg border border-outline-subtle p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{t.aiHelper.pipeline}</span>
      </div>
      {activeLeads > 0 ? (
        <p className="text-xs text-text-secondary leading-relaxed">
          {fr
            ? `${activeLeads} lead${activeLeads > 1 ? 's' : ''} actif${activeLeads > 1 ? 's' : ''} dans le pipeline${quoteSent > 0 ? ` · ${quoteSent} devis envoyé${quoteSent > 1 ? 's' : ''}` : ''}${topClient ? `. Prochain RDV: ${topClient}` : ''}`
            : `${activeLeads} active lead${activeLeads > 1 ? 's' : ''} in pipeline${quoteSent > 0 ? ` · ${quoteSent} quote${quoteSent > 1 ? 's' : ''} sent` : ''}${topClient ? `. Next appointment: ${topClient}` : ''}`}
        </p>
      ) : (
        <p className="text-xs text-text-secondary leading-relaxed">
          {t.aiHelper.noActiveLeadsGoodTimeToProspect}
        </p>
      )}
      <div className="flex gap-1.5 pt-1">
        <a href="/pipeline" onClick={(e) => e.stopPropagation()} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-secondary text-text-tertiary font-medium hover:text-text-secondary transition-colors">
          {t.aiHelper.viewPipeline}
        </a>
        <a href="/leads" onClick={(e) => e.stopPropagation()} className="text-[10px] px-2 py-0.5 rounded-full bg-surface-secondary text-text-tertiary font-medium hover:text-text-secondary transition-colors">
          {t.aiHelper.viewQuotes}
        </a>
      </div>
    </div>
  );

  // --- Block 3: Summarize performance ---
  const revToday = data?.performance.revenue.today || 0;
  const newLeads = data?.performance.newLeadsToday || 0;
  const convRate = data?.performance.conversionRate || 0;

  const block3Scene = (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface-secondary p-2.5">
          <DollarSign size={12} className="text-text-tertiary mb-1" />
          <p className="text-sm font-bold text-text-primary">{fmtMoney(revToday)}</p>
          <p className="text-[10px] text-text-tertiary">
            {fr ? 'Revenus aujourd\'hui' : 'Revenue today'}
          </p>
        </div>
        <div className="rounded-lg bg-surface-secondary p-2.5">
          <Users size={12} className="text-text-tertiary mb-1" />
          <p className="text-sm font-bold text-text-primary">{newLeads}</p>
          <p className="text-[10px] text-text-tertiary">{t.aiHelper.newLeads}</p>
        </div>
      </div>
      <div className="rounded-lg border border-outline-subtle p-2.5">
        <p className="text-xs text-text-secondary">
          {t.aiHelper.conversionRateConvrate}
          {data?.performance.receivables.clientsOwing
            ? ` · ${data.performance.receivables.clientsOwing} ${t.aiHelper.clientsOwing}`
            : ''}
        </p>
      </div>
    </div>
  );

  // --- Block 4: Invoice / receivables summary ---
  const outstanding = (data?.performance.outstanding.totalCents || 0) / 100;
  const clientsOwing = data?.performance.receivables.clientsOwing || 0;
  const topClients = data?.performance.receivables.topClients || [];

  const block4Scene = (
    <div className="space-y-2">
      {topClients.length > 0 ? topClients.slice(0, 2).map((c, i) => (
        <div key={i} className="flex items-center justify-between rounded-lg bg-surface-secondary p-2.5">
          <span className="text-xs font-medium text-text-primary truncate">{c.clientName}</span>
          <span className="text-xs font-bold text-text-primary">{fmtMoney(c.balance)}</span>
        </div>
      )) : (
        <div className="flex items-center gap-2 rounded-lg bg-surface-secondary p-2.5">
          <CheckCircle2 size={12} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">{t.aiHelper.noOutstandingBalance}</span>
        </div>
      )}
      <div className="rounded-lg border border-outline-subtle p-2.5">
        <p className="text-xs text-text-secondary">
          {clientsOwing > 0
            ? `${clientsOwing} ${t.aiHelper.clients} · ${t.aiHelper.totalOutstanding}: ${fmtMoney(outstanding)}`
            : t.aiHelper.allCaughtUp}
        </p>
      </div>
    </div>
  );

  return [
    {
      id: '01',
      prompt: t.aiHelper.prepareMeForTheDay,
      description: fr
        ? 'Briefing du matin: rendez-vous, jobs urgents et leads à suivre.'
        : 'Morning brief with your schedule, urgent tasks, and deals needing attention.',
      icon: Calendar,
      scene: block1Scene,
    },
    {
      id: '02',
      prompt: t.aiHelper.writeAFollowupEmail,
      description: fr
        ? 'Rédige des suivis professionnels basés sur tes leads et jobs.'
        : 'Draft professional follow-ups from your pipeline and job context.',
      icon: Mail,
      scene: block2Scene,
    },
    {
      id: '03',
      prompt: t.aiHelper.summarizeMonthPerformance,
      description: fr
        ? 'Aperçu instantané: revenus, taux de conversion et productivité.'
        : 'Instant insights on revenue, conversion rates, and team productivity.',
      icon: BarChart3,
      scene: block3Scene,
    },
    {
      id: '04',
      prompt: t.aiHelper.generateAnInvoiceSummary,
      description: fr
        ? 'Soldes dus, clients en retard et prochaines étapes.'
        : 'Outstanding balances, overdue clients, and next steps.',
      icon: FileText,
      scene: block4Scene,
    },
  ];
}

export default function AIHelper() {
  const { language } = useTranslation();
  const location = useLocation();
  const { permissions, role } = usePermissions();
  const { isEnabled: isFeatureEnabled } = useFeatureFlags();
  const agentEnabled = isFeatureEnabled('agent');

  // Preload MrLumeChat when agent feature is enabled (avoids spinner on first click)
  // Reset to CRM mode if agent feature gets disabled while in agent mode
  useEffect(() => {
    if (agentEnabled) {
      mrLumeChatImport();
    } else {
      setChatMode((prev) => prev === 'agent' ? 'crm' : prev);
    }
  }, [agentEnabled]);

  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [conversations, setConversations] = useState<AIConversationListItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dbReady, setDbReady] = useState(true);
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [chatMode, setChatMode] = useState<AIChatMode>('crm');
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isInConversation = messages.length > 0;
  const sceneBlocks = buildSceneBlocks(dashData, language);

  /* ── Check Ollama connection + load dashboard data ── */
  useEffect(() => {
    checkConnection();
    loadConversations();
    getDashboardData().then(setDashData).catch(() => {});
  }, []);

  async function checkConnection() {
    setStatus('checking');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      const res = await fetch('/api/ai/health', {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      setStatus(res.ok ? 'connected' : 'disconnected');
    } catch {
      setStatus('disconnected');
    }
  }

  /* ── Load past conversations from Supabase ── */
  const loadConversations = useCallback(async () => {
    try {
      const convos = await getRecentConversations(30);
      setConversations(convos);
    } catch (err: any) {
      console.warn('AI conversations load failed:', err?.message || 'unknown');
      setDbReady(false);
    }
  }, []);

  /* ── Auto-scroll chat ── */
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /* ── Build CRM context for orchestrator ── */
  async function buildCrmContext(): Promise<CRMContext> {
    const { data: { user } } = await supabase.auth.getUser();
    const userName = dashData?.user?.fullName || user?.email || 'User';
    const orgName = dashData?.user?.organizationName || 'Organization';

    return {
      orgId: user?.id || '',
      userId: user?.id || '',
      userName,
      orgName,
      userRole: role || 'owner',
      permissions: permissions || getDefaultPermissions('owner'),
      language: language as 'fr' | 'en',
      currentRoute: location.pathname,
      activeEntity: parseRouteEntity(location.pathname),
    };
  }

  /* ── Send message ── */
  async function handleSend(text?: string) {
    const content = (text || input).trim();
    if (!content || isGenerating) return;

    // Optimistic UI: show user message immediately
    const tempUserMsg: UIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setInput('');
    setIsGenerating(true);

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Add an empty assistant message that will be filled by streaming tokens
    const assistantMsgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

    try {
      const crmContext = await buildCrmContext();
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const response = await orchestrate(
        {
          message: content,
          mode: chatMode,
          crmContext,
          history,
          conversationId: activeConversationId,
        },
        {
          onToken: (token) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: m.content + token } : m
              )
            );
          },
          onToolCall: (toolId, status) => {
            setActiveToolId(status === 'start' ? toolId : null);
          },
        },
        dbReady
      );

      // Update conversation ID if it was created by the orchestrator
      if (!activeConversationId && response.toolCalls.length > 0) {
        const convId = response.toolCalls[0]?.conversation_id;
        if (convId) setActiveConversationId(convId);
      }

      // Refresh conversation list
      if (dbReady) void loadConversations();
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: language === 'fr'
                  ? 'Impossible de se connecter à Ollama. Vérifiez que le serveur est en cours d\'exécution.'
                  : 'Could not connect to Ollama. Make sure the server is running on localhost:11434.',
              }
            : m
        )
      );
      setStatus('disconnected');
    } finally {
      setIsGenerating(false);
      setActiveToolId(null);
    }
  }

  function startNewChat() {
    setMessages([]);
    setActiveConversationId(null);
    setShowHistory(false);
  }

  async function loadConversation(conv: AIConversationListItem) {
    setShowHistory(false);
    setActiveConversationId(conv.id);

    try {
      const msgs = await getConversationMessages(conv.id);
      setMessages(msgs.map((m: AIMessage) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })));
    } catch {
      // Fallback
      setMessages([]);
    }
  }

  async function handleDeleteConversation(id: string) {
    try {
      await apiDeleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) startNewChat();
    } catch {
      // silent
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    setInput(el.value);
  }

  /* ── Disconnected state ── */
  if (status === 'disconnected') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-md"
        >
          <div className="w-14 h-14 rounded-2xl bg-surface-secondary flex items-center justify-center mx-auto mb-5">
            <WifiOff size={24} className="text-text-tertiary" />
          </div>
          <h1 className="text-xl font-bold text-text-primary mb-2">
            {language === 'fr' ? 'Ollama n\'est pas connecté' : 'Ollama is not connected'}
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed mb-6">
            {language === 'fr'
              ? 'Lume AI nécessite Ollama pour fonctionner localement. Installez-le et lancez le serveur pour commencer.'
              : 'Lume AI requires Ollama to run locally. Install it and start the server to get started.'}
          </p>
          <div className="rounded-xl bg-surface-secondary border border-outline-subtle p-4 mb-6 text-left">
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2.5">
              {t.aiHelper.quickStart}
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="text-[11px] font-bold text-text-tertiary mt-0.5">1</span>
                <div>
                  <p className="text-xs font-medium text-text-secondary">
                    {t.aiHelper.installOllama}
                  </p>
                  <code className="text-[11px] text-text-tertiary font-mono">curl -fsSL https://ollama.com/install.sh | sh</code>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-[11px] font-bold text-text-tertiary mt-0.5">2</span>
                <div>
                  <p className="text-xs font-medium text-text-secondary">
                    {t.aiHelper.pullAModel}
                  </p>
                  <code className="text-[11px] text-text-tertiary font-mono">ollama pull llama3.2</code>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-[11px] font-bold text-text-tertiary mt-0.5">3</span>
                <div>
                  <p className="text-xs font-medium text-text-secondary">
                    {t.aiHelper.startTheServer}
                  </p>
                  <code className="text-[11px] text-text-tertiary font-mono">ollama serve</code>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={checkConnection}
            className="px-5 py-2.5 rounded-lg bg-text-primary text-surface text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t.aiHelper.retryConnection}
          </button>
        </motion.div>
      </div>
    );
  }

  /* ── Checking state ── */
  if (status === 'checking') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh]">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Loader2 size={24} className="text-text-tertiary" />
        </motion.div>
        <p className="text-sm text-text-tertiary mt-3 font-medium">
          {t.aiHelper.connectingToOllama}
        </p>
      </div>
    );
  }

  /* ── Agent mode — delegate to MrLumeChat (empty state too) ── */
  if (chatMode === 'agent' && agentEnabled) {
    return (
      <AgentErrorBoundary language={language as 'en' | 'fr'} onReset={() => setChatMode('crm')}>
        <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><Loader2 size={24} className="text-text-tertiary animate-spin" /></div>}>
          <MrLumeChat />
        </Suspense>
      </AgentErrorBoundary>
    );
  }

  /* ── Empty state (hero + scene blocks) ── */
  if (!isInConversation && !showHistory) {
    return (
      <div className="flex flex-col items-center min-h-[70vh]">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          className="text-center max-w-2xl pt-8 pb-10"
        >
          <div className="w-16 h-16 rounded-2xl bg-surface-secondary border border-outline-subtle flex items-center justify-center mx-auto mb-6">
            <OllamaIcon size={28} className="text-text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary mb-3">
            {t.aiHelper.yourIntelligentCrmAssistant}
          </h1>
          <p className="text-sm text-text-tertiary leading-relaxed max-w-md mx-auto">
            {language === 'fr'
              ? 'Propulsé par Ollama. Posez des questions, obtenez des résumés, rédigez des emails — le tout sans quitter Lume.'
              : 'Powered by Ollama. Ask questions, get summaries, draft emails — all without leaving Lume.'}
          </p>

          {/* Status badge */}
          <div className="flex items-center justify-center gap-1.5 mt-4">
            <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
            <span className="text-[11px] font-medium text-text-tertiary">
              Ollama · {t.aiHelper.connected}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={startNewChat}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-text-primary text-surface text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <Plus size={16} />
              {t.aiHelper.newChat}
            </button>
            {agentEnabled && (
              <button
                onClick={() => setChatMode('agent')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-outline-subtle bg-surface text-sm font-medium text-text-secondary hover:border-outline hover:text-text-primary transition-all"
              >
                <img src="/lume-logo.png" alt="" className="w-4 h-4 object-contain" />
                Mr Lume
              </button>
            )}
          </div>
        </motion.div>

        {/* Chat input */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="w-full max-w-2xl mb-8"
        >
          <div className="relative rounded-xl border border-outline-subtle bg-surface shadow-sm transition-all focus-within:border-outline focus-within:shadow-md">
            <textarea
              ref={inputRef}
              value={input}
              onChange={autoResize}
              onKeyDown={handleKeyDown}
              placeholder={t.aiHelper.askLumeAiAnything}
              rows={1}
              className="w-full resize-none bg-transparent px-4 py-3.5 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
              style={{ maxHeight: 160 }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <Send size={16} />
            </button>
          </div>

          {/* Suggestions — based on real data */}
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            {sceneBlocks.map((b) => (
              <button
                key={b.id}
                onClick={() => handleSend(b.prompt)}
                className="px-3 py-1.5 rounded-lg border border-outline-subtle bg-surface text-xs font-medium text-text-secondary hover:border-outline hover:text-text-primary transition-all"
              >
                {b.prompt}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Past conversations toggle */}
        {conversations.length > 0 && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors mb-10"
          >
            <Clock size={13} />
            {language === 'fr'
              ? `${conversations.length} conversation${conversations.length > 1 ? 's' : ''} précédente${conversations.length > 1 ? 's' : ''}`
              : `${conversations.length} past conversation${conversations.length > 1 ? 's' : ''}`}
            <ArrowRight size={12} />
          </motion.button>
        )}

        {/* Scene blocks */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-4 pb-8"
        >
          {sceneBlocks.map((block) => (
            <button
              key={block.id}
              type="button"
              onClick={() => handleSend(block.prompt)}
              className="group rounded-xl border border-outline-subtle bg-surface p-5 text-left transition-all hover:border-outline hover:shadow-sm"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center">
                    <block.icon size={16} className="text-text-secondary" />
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">{block.id}</span>
                    <p className="text-sm font-semibold text-text-primary">{block.prompt}</p>
                  </div>
                </div>
                <ArrowRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
              </div>
              {/* Mock scene */}
              <div className="mb-3 pointer-events-none">{block.scene}</div>
              <p className="text-xs text-text-tertiary leading-relaxed">{block.description}</p>
            </button>
          ))}
        </motion.div>
      </div>
    );
  }

  /* ── History view ── */
  if (showHistory && !isInConversation) {
    return (
      <div className="max-w-2xl mx-auto pt-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold text-text-primary">
            {t.aiHelper.pastConversations}
          </h1>
          <button
            onClick={startNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-text-primary text-surface text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            {t.aiHelper.newChat}
          </button>
        </div>
        <div className="space-y-2">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className="group flex items-start gap-3 rounded-xl border border-outline-subtle bg-surface p-4 hover:border-outline transition-all cursor-pointer"
              onClick={() => loadConversation(conv)}
            >
              <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center shrink-0">
                <MessageSquare size={14} className="text-text-tertiary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{conv.title || 'Untitled'}</p>
                <p className="text-xs text-text-tertiary mt-0.5 truncate">{conv.last_message_preview}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConversation(conv.id);
                }}
                className="p-1.5 rounded-md text-text-tertiary hover:text-danger hover:bg-danger-light opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Agent mode — delegate to MrLumeChat ── */
  if (chatMode === 'agent' && agentEnabled) {
    return (
      <AgentErrorBoundary language={language as 'en' | 'fr'} onReset={() => setChatMode('crm')}>
        <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><Loader2 size={24} className="text-text-tertiary animate-spin" /></div>}>
          <MrLumeChat />
        </Suspense>
      </AgentErrorBoundary>
    );
  }

  /* ── Conversation view ── */
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-2xl mx-auto">
      {/* Chat header */}
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-surface-secondary flex items-center justify-center">
            <OllamaIcon size={14} className="text-text-primary" />
          </div>
          <span className="text-sm font-semibold text-text-primary">Lume AI</span>
          <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />

          {/* Mode toggle */}
          <div className="flex items-center ml-2 rounded-lg border border-outline-subtle bg-surface-secondary p-0.5">
            <button
              onClick={() => setChatMode('crm')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                chatMode === 'crm'
                  ? 'bg-surface shadow-sm text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <Database size={12} />
              CRM
            </button>
            <button
              onClick={() => setChatMode('web')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                chatMode === 'web'
                  ? 'bg-surface shadow-sm text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <Globe size={12} />
              Web
            </button>
            {agentEnabled && (
              <button
                onClick={() => setChatMode('agent')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
                  chatMode === 'agent'
                    ? 'bg-surface shadow-sm text-text-primary'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <img src="/lume-logo.png" alt="" className="w-3 h-3 object-contain" />
                Mr Lume
              </button>
            )}
          </div>
        </div>
        <button
          onClick={startNewChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-text-primary text-surface text-xs font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          {t.aiHelper.newChat}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 py-4">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-text-primary text-surface'
                    : 'bg-surface-secondary text-text-primary border border-outline-subtle'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Generating indicator */}
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="bg-surface-secondary border border-outline-subtle rounded-xl px-4 py-3 flex items-center gap-2">
              {activeToolId ? (
                <>
                  <Wrench size={14} className="text-text-tertiary animate-pulse" />
                  <span className="text-sm text-text-tertiary">
                    {t.aiHelper.toolActivetoolid}
                  </span>
                </>
              ) : (
                <>
                  <Loader2 size={14} className="text-text-tertiary animate-spin" />
                  <span className="text-sm text-text-tertiary">
                    {t.aiHelper.thinking}
                  </span>
                </>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="py-3">
        <div className="relative rounded-xl border border-outline-subtle bg-surface shadow-sm transition-all focus-within:border-outline focus-within:shadow-md">
          <textarea
            ref={inputRef}
            value={input}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            placeholder={t.agent.yourMessage}
            rows={1}
            className="w-full resize-none bg-transparent px-4 py-3.5 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            style={{ maxHeight: 160 }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isGenerating}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            {isGenerating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
        <p className="text-[10px] text-text-tertiary text-center mt-2">
          {language === 'fr'
            ? `Propulsé par Ollama · Mode ${chatMode === 'crm' ? 'CRM' : 'Web'} · Réponses générées localement`
            : `Powered by Ollama · ${chatMode === 'crm' ? 'CRM' : 'Web'} mode · Responses generated locally`}
        </p>
      </div>
    </div>
  );
}
