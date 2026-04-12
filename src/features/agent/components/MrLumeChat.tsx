import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Loader2, Plus, Clock, Trash2, ArrowRight, Network,
  Paperclip, Sparkles, ArrowUp,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import VoiceInput from './VoiceInput';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useTranslation } from '../../../i18n';
import AgentThinking from './AgentThinking';
import ScenarioExpansion from './ScenarioExpansion';
import ApprovalCard from './ApprovalCard';
import FeedbackButtons from './FeedbackButtons';
import { agentChat, agentHealthCheck, agentGetSessions, agentGetSessionMessages, agentDeleteSession } from '../lib/agentApi';
import type { UIAgentMessage, AgentSession, AgentStateLabel, ScenarioResult, ApprovalRequest, AgentSSEEvent } from '../types';
import RelationshipGraph from '../../../components/insights/RelationshipGraph';

/** Markdown renderer — bold, italic, inline code, code blocks, links, lists, headers */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  const result: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        result.push(
          <pre key={`code-${i}`} className="bg-[var(--color-surface-secondary)] rounded-lg p-3 text-xs font-mono overflow-x-auto my-1.5 border border-[var(--color-outline)]">
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) { codeBuffer.push(line); continue; }

    function formatInline(str: string): React.ReactNode[] {
      const regex = /(\*\*.*?\*\*|`[^`]+`|\[([^\]]+)\]\(([^)]+)\))/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let key = 0;
      while ((match = regex.exec(str)) !== null) {
        if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index));
        const m = match[0];
        if (m.startsWith('**')) {
          parts.push(<strong key={key++}>{m.slice(2, -2)}</strong>);
        } else if (m.startsWith('`')) {
          parts.push(<code key={key++} className="bg-[var(--color-surface-secondary)] px-1 py-0.5 rounded text-xs font-mono">{m.slice(1, -1)}</code>);
        } else if (m.startsWith('[')) {
          parts.push(<a key={key++} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] underline">{match[2]}</a>);
        }
        lastIndex = match.index + m.length;
      }
      if (lastIndex < str.length) parts.push(str.slice(lastIndex));
      return parts;
    }

    if (line.match(/^###\s/)) {
      result.push(<div key={i} className="font-bold text-sm mt-2 mb-0.5">{formatInline(line.replace(/^###\s/, ''))}</div>);
      continue;
    }
    if (line.match(/^##\s/)) {
      result.push(<div key={i} className="font-bold text-sm mt-2 mb-0.5">{formatInline(line.replace(/^##\s/, ''))}</div>);
      continue;
    }
    if (line.match(/^[\-\*]\s/)) {
      result.push(<div key={i} className="flex gap-1.5 ml-1"><span className="text-neutral-400">•</span><span>{formatInline(line.replace(/^[\-\*]\s/, ''))}</span></div>);
      continue;
    }
    if (line.match(/^\d+\.\s/)) {
      result.push(<div key={i} className="ml-1">{formatInline(line)}</div>);
      continue;
    }
    if (!line.trim()) { result.push(<div key={i} className="h-1" />); continue; }
    result.push(<div key={i}>{formatInline(line)}</div>);
  }

  if (inCodeBlock && codeBuffer.length) {
    result.push(<pre key="code-end" className="bg-[var(--color-surface-secondary)] rounded-lg p-3 text-xs font-mono overflow-x-auto my-1.5 border border-[var(--color-outline)]"><code>{codeBuffer.join('\n')}</code></pre>);
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   Lume Agent — AI Chat Page
   Premium minimal UI matching reference screenshot.
   All business logic preserved from original MrLumeChat.
   ═══════════════════════════════════════════════════════════════ */

export default function MrLumeChat() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const { isEnabled } = useFeatureFlags();
  const voiceEnabled = isEnabled('voice');

  /* ── State (preserved from original) ── */
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [messages, setMessages] = useState<UIAgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentState, setCurrentState] = useState<AgentStateLabel | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [graphData, setGraphData] = useState<{ scenario: ScenarioResult | null; question: string; entities: { type: string; label: string }[] } | null>(null);
  const [showRelationGraph, setShowRelationGraph] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const isInConversation = messages.length > 0;

  /* ── Mount: health check + load sessions ── */
  useEffect(() => {
    mountedRef.current = true;
    agentHealthCheck().then(h => { if (mountedRef.current) setConnectionStatus(h.ok ? 'connected' : 'disconnected'); });
    agentGetSessions().then(s => { if (mountedRef.current) setSessions(s); }).catch(() => {});
    return () => {
      mountedRef.current = false;
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const startNewChat = useCallback(() => {
    setMessages([]); setSessionId(null); setCurrentState(null); setShowHistory(false);
  }, []);

  async function loadSession(session: AgentSession) {
    setShowHistory(false); setSessionId(session.id);
    try {
      const msgs = await agentGetSessionMessages(session.id);
      setMessages(msgs.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
        id: m.id, role: m.role as 'user' | 'assistant', content: m.content,
        messageType: (m.message_type || 'text') as UIAgentMessage['messageType'],
        structuredData: m.structured_data ?? null,
      })));
    } catch { setMessages([]); }
  }

  async function handleDeleteSession(id: string) {
    await agentDeleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (sessionId === id) startNewChat();
  }

  /* ── Send message (all original logic preserved) ── */
  async function handleSend(text?: string) {
    const content = (text || input).trim();
    if (!content || isProcessing) return;

    if (connectionStatus === 'disconnected') {
      const userMsg: UIAgentMessage = { id: crypto.randomUUID(), role: 'user', content, messageType: 'text' };
      const errMsg: UIAgentMessage = {
        id: crypto.randomUUID(), role: 'assistant', content: fr
          ? 'Le service AI n\'est pas disponible pour le moment. Veuillez vérifier que le backend est en cours d\'exécution.'
          : 'AI service unavailable. Please make sure the backend is running.',
        messageType: 'text',
      };
      setMessages(prev => [...prev, userMsg, errMsg]);
      setInput('');
      return;
    }

    const userMsg: UIAgentMessage = { id: crypto.randomUUID(), role: 'user', content, messageType: 'text' };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsProcessing(true);
    setCurrentState('understand');
    setShowRelationGraph(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', messageType: 'text', isStreaming: true }]);
    abortRef.current = new AbortController();

    try {
      let gotSessionId = sessionId;
      let scenarioData: ScenarioResult | null = null;
      let approvalData: ApprovalRequest | null = null;

      await agentChat({
        message: content, sessionId, language: language as 'en' | 'fr',
        signal: abortRef.current.signal,
        onEvent: (event: AgentSSEEvent) => {
          if (!mountedRef.current) return;
          switch (event.type) {
            case 'state_change':
              setCurrentState(event.state as AgentStateLabel);
              if (event.state === 'scenario_engine' || event.state === 'decide') {
                setGraphData(prev => prev || { scenario: null, question: content, entities: [] });
                setShowRelationGraph(true);
              }
              break;
            case 'token':
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + event.content } : m));
              break;
            case 'scenario':
              scenarioData = event.data;
              const entities = (event.data.options || []).map((o: any) => ({ type: 'team', label: o.label }));
              setGraphData({ scenario: event.data, question: content, entities });
              setShowRelationGraph(true);
              break;
            case 'approval':
              approvalData = event.data;
              break;
            case 'done':
              if (event.sessionId) { gotSessionId = event.sessionId; setSessionId(event.sessionId); }
              const allText = (content).toLowerCase();
              const hasCrmContext = /\b(client|job|equipe|team|facture|invoice|lead|devis|quote|revenue|pipeline|deal|assign|schedul|planifi|overdue|retard|completion|performance|churn|conversion|relation|graph|analyse|overview|apercu|resume|reseau|network|portrait|montre|show|fais.*voir|donne)\b/i.test(allText);
              if (hasCrmContext && content.length > 80) setShowRelationGraph(true);
              break;
            case 'error':
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, content: m.content || (fr ? 'Une erreur est survenue.' : 'An error occurred.'), isStreaming: false } : m));
              break;
          }
        },
      });

      setMessages(prev => prev.map(m => {
        if (m.id !== assistantId) return m;
        return { ...m, content: m.content || (fr ? 'Je n\'ai pas pu générer de réponse.' : 'I couldn\'t generate a response.'), isStreaming: false };
      }));

      if (scenarioData) {
        setGraphData({ scenario: scenarioData, question: content, entities: [] });
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', messageType: 'scenario', structuredData: scenarioData }]);
      }
      if (approvalData) {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', messageType: 'approval_request', structuredData: approvalData }]);
      }
      agentGetSessions().then(setSessions).catch(() => {});

    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, content: fr ? 'Erreur de connexion.' : 'Connection error.', isStreaming: false } : m));
      }
    } finally {
      setIsProcessing(false); setCurrentState(null); abortRef.current = null;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    setInput(el.value);
  }

  /* ── Suggestions ── */
  const suggestions = fr
    ? ['Prépare-moi pour la journée', 'Y a-t-il des problèmes à régler?', 'Qui devrait faire le prochain job?', 'Résume mes clients actifs', 'Analyse mes revenus du mois']
    : ['Prepare me for the day', 'Any issues to address?', 'Who should handle the next job?', 'Summarize active clients', 'Analyze this month\'s revenue'];

  /* ── Disconnected inline banner ── */
  const disconnectedBanner = connectionStatus === 'disconnected' && (
    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[12px] mb-4 max-w-2xl mx-auto">
      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
      <span>{fr ? 'Backend non connecté — les réponses ne sont pas disponibles.' : 'Backend disconnected — responses unavailable.'}</span>
      <button
        onClick={() => { setConnectionStatus('checking'); agentHealthCheck().then(h => setConnectionStatus(h.ok ? 'connected' : 'disconnected')); }}
        className="ml-auto text-amber-600 dark:text-amber-400 font-medium hover:underline shrink-0"
      >
        {fr ? 'Réessayer' : 'Retry'}
      </button>
    </div>
  );

  /* ═══════════════════════════════════════════════════════════
     HISTORY VIEW
     ═══════════════════════════════════════════════════════════ */
  if (showHistory && !isInConversation) {
    return (
      <div className="flex flex-col h-[calc(100vh-8rem)]">
        {disconnectedBanner}
        <div className="max-w-2xl mx-auto w-full pt-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-[18px] font-semibold text-text-primary tracking-tight">
              {fr ? 'Conversations' : 'Conversations'}
            </h1>
            <button onClick={startNewChat}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-[12px] font-medium hover:opacity-90 transition-opacity">
              <Plus size={13} />{fr ? 'Nouveau' : 'New Chat'}
            </button>
          </div>
          <div className="space-y-1.5">
            {sessions.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/30 p-10 text-center">
                <p className="text-[13px] text-text-tertiary">{fr ? 'Aucune conversation' : 'No conversations yet'}</p>
              </div>
            ) : sessions.map(s => (
              <div key={s.id}
                className="group flex items-center gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/30 px-4 py-3.5 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all cursor-pointer"
                onClick={() => loadSession(s)}>
                <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-700 flex items-center justify-center shrink-0">
                  <Sparkles size={14} className="text-neutral-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate">{s.title || 'Untitled'}</p>
                  <p className="text-[11px] text-text-tertiary mt-0.5">{s.message_count} messages</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                  className="p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 opacity-0 group-hover:opacity-100 transition-all">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     EMPTY / IDLE STATE  — reproduces screenshot reference
     ═══════════════════════════════════════════════════════════ */
  if (!isInConversation && !showHistory) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        {disconnectedBanner}

        {/* Central input card — the hero of the page */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-[680px] px-4"
        >
          {/* Input card */}
          <div className="relative rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.2)] transition-all focus-within:shadow-[0_2px_20px_rgba(0,0,0,0.08)] dark:focus-within:shadow-[0_2px_20px_rgba(0,0,0,0.3)] focus-within:border-neutral-300 dark:focus-within:border-neutral-600">
            <textarea
              ref={inputRef}
              value={input}
              onChange={autoResize}
              onKeyDown={handleKeyDown}
              aria-label={fr ? 'Demandez quelque chose...' : 'Ask me anything...'}
              placeholder={fr ? 'Demandez quelque chose...' : 'Ask me anything...'}
              rows={1}
              className="w-full resize-none bg-transparent px-5 pt-5 pb-14 text-[14px] text-text-primary placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none leading-relaxed"
              style={{ maxHeight: 160 }}
            />
            {/* Bottom bar inside card */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 transition-colors" title={fr ? 'Joindre un fichier' : 'Attach file'}>
                  <Paperclip size={16} />
                </button>
                {voiceEnabled && <VoiceInput onTranscript={(txt) => setInput(prev => prev + txt)} language={language as 'en' | 'fr'} />}
              </div>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isProcessing}
                aria-label={fr ? 'Envoyer' : 'Send'}
                className="w-8 h-8 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-20 disabled:pointer-events-none"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Suggestion pills */}
          <div className="flex flex-wrap gap-2 mt-4 justify-center">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSend(s)}
                className="px-3.5 py-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/30 text-[12px] font-medium text-neutral-600 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-900 dark:hover:text-neutral-200 hover:shadow-sm transition-all"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Past sessions link */}
          {sessions.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex justify-center mt-6">
              <button
                onClick={() => setShowHistory(true)}
                className="flex items-center gap-2 text-[12px] font-medium text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
              >
                <Clock size={13} />
                {fr ? `${sessions.length} conversation${sessions.length > 1 ? 's' : ''} précédente${sessions.length > 1 ? 's' : ''}` : `${sessions.length} past conversation${sessions.length > 1 ? 's' : ''}`}
                <ArrowRight size={12} />
              </button>
            </motion.div>
          )}
        </motion.div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════
     CONVERSATION VIEW
     ═══════════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-[720px] mx-auto">
      {disconnectedBanner}

      {/* Compact header */}
      <div className="flex items-center justify-between py-3 px-1">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <Sparkles size={14} className="text-neutral-500" />
          </div>
          <span className="text-[13px] font-semibold text-text-primary">Lume Agent</span>
          {connectionStatus === 'connected' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
          {connectionStatus === 'disconnected' && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
        </div>
        <div className="flex items-center gap-1.5">
          {sessions.length > 0 && (
            <button onClick={() => { startNewChat(); setShowHistory(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-text-tertiary hover:text-text-primary hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all">
              <Clock size={12} />
              {fr ? 'Historique' : 'History'}
            </button>
          )}
          <button onClick={startNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-[11px] font-medium hover:opacity-90 transition-opacity">
            <Plus size={12} />{fr ? 'Nouveau' : 'New'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-5">
        <AnimatePresence initial={false}>
          {messages.map(msg => {
            if (msg.messageType === 'scenario' && msg.structuredData) {
              return (
                <React.Fragment key={msg.id}>
                  <ScenarioExpansion data={msg.structuredData as ScenarioResult} language={language as 'en' | 'fr'} />
                  <div className="flex justify-start pl-10 -mt-2">
                    <button onClick={() => setShowRelationGraph(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all">
                      <Network size={12} />{fr ? 'Voir les relations' : 'View relations'}
                    </button>
                  </div>
                </React.Fragment>
              );
            }
            if (msg.messageType === 'approval_request' && msg.structuredData) {
              return <ApprovalCard key={msg.id} data={msg.structuredData as ApprovalRequest} language={language as 'en' | 'fr'} />;
            }

            return (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'gap-3 items-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles size={13} className="text-neutral-500" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900'
                    : 'bg-neutral-50 dark:bg-neutral-800/50 text-text-primary border border-neutral-200 dark:border-neutral-700'
                }`}>
                  <div className="whitespace-pre-wrap">{msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}</div>
                  {msg.role === 'assistant' && !msg.isStreaming && msg.content && (
                    <div className="mt-2 pt-1.5 border-t border-neutral-200 dark:border-neutral-700/50">
                      <FeedbackButtons messageId={msg.id} sessionId={sessionId} language={language as 'en' | 'fr'} responseText={msg.content} domain={(msg as any).domain} />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Relationship Graph */}
        {showRelationGraph && !isProcessing && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm">
            <div style={{ height: 450 }}><RelationshipGraph /></div>
          </motion.div>
        )}

        {/* Thinking */}
        {isProcessing && currentState && (
          <AgentThinking currentState={currentState} language={language as 'en' | 'fr'} />
        )}
      </div>

      {/* Input */}
      <div className="py-3">
        <div className="relative rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/40 shadow-sm transition-all focus-within:shadow-md focus-within:border-neutral-300 dark:focus-within:border-neutral-600">
          <textarea
            ref={inputRef}
            value={input}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            aria-label={fr ? 'Votre message...' : 'Your message...'}
            placeholder={fr ? 'Votre message...' : 'Your message...'}
            rows={1}
            className="w-full resize-none bg-transparent px-5 pt-3.5 pb-12 text-[13px] text-text-primary placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none"
            style={{ maxHeight: 160 }}
          />
          <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
              {voiceEnabled && <VoiceInput onTranscript={(txt) => setInput(prev => prev + txt)} language={language as 'en' | 'fr'} disabled={isProcessing} />}
            </div>
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isProcessing}
              aria-label={fr ? 'Envoyer' : 'Send'}
              className="w-7 h-7 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-20 disabled:pointer-events-none"
            >
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} strokeWidth={2.5} />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 mt-2">
          <p className="text-[10px] text-neutral-400">Lume Agent</p>
          {isInConversation && (
            <button onClick={() => setShowRelationGraph((v) => !v)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-neutral-200 dark:border-neutral-700 text-[10px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all">
              <Network size={10} />{fr ? 'Graphe relations' : 'Relations graph'}
            </button>
          )}
        </div>
      </div>

      {/* Fullscreen Relationship Graph */}
      <AnimatePresence>
        {showRelationGraph && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] bg-white dark:bg-neutral-900">
            <div className="absolute top-3 right-3 z-[91]">
              <button onClick={() => setShowRelationGraph(false)}
                className="px-3.5 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-[12px] font-medium hover:opacity-90 transition-opacity">
                {fr ? 'Fermer' : 'Close'}
              </button>
            </div>
            <RelationshipGraph />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
