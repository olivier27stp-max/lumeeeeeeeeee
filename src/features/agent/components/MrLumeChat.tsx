import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Loader2, Plus, Clock, Trash2, ArrowRight, Network } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import VoiceInput from './VoiceInput';
import PredictionGraph from './PredictionGraph';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { useTranslation } from '../../../i18n';
import MrLumeAvatar from './MrLumeAvatar';
import AgentThinking from './AgentThinking';
import ScenarioExpansion from './ScenarioExpansion';
import ApprovalCard from './ApprovalCard';
import FeedbackButtons from './FeedbackButtons';
import { agentChat, agentHealthCheck, agentGetSessions, agentGetSessionMessages, agentDeleteSession } from '../lib/agentApi';
import type { UIAgentMessage, AgentSession, AgentStateLabel, ScenarioResult, ApprovalRequest, AgentSSEEvent } from '../types';

/** Simple markdown renderer — bold, lists, links */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Bold
    let processed: React.ReactNode = line.replace(/\*\*(.*?)\*\*/g, '§BOLD§$1§/BOLD§');
    const parts = (processed as string).split(/(§BOLD§.*?§\/BOLD§)/g);
    const elements = parts.map((part, j) => {
      if (part.startsWith('§BOLD§')) {
        return <strong key={j}>{part.replace('§BOLD§', '').replace('§/BOLD§', '')}</strong>;
      }
      return part;
    });

    // List items
    if (line.match(/^[\-\*]\s/)) {
      return <div key={i} className="flex gap-1.5 ml-1"><span className="text-text-tertiary">•</span><span>{elements}</span></div>;
    }
    if (line.match(/^\d+\.\s/)) {
      return <div key={i} className="ml-1">{elements}</div>;
    }
    // Empty line
    if (!line.trim()) return <div key={i} className="h-1" />;
    return <div key={i}>{elements}</div>;
  });
}

export default function MrLumeChat() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const { isEnabled } = useFeatureFlags();
  const voiceEnabled = isEnabled('voice');

  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [messages, setMessages] = useState<UIAgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentState, setCurrentState] = useState<AgentStateLabel | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [graphData, setGraphData] = useState<{ scenario: ScenarioResult | null; question: string; entities: { type: string; label: string }[] } | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [welcomeSent, setWelcomeSent] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const isInConversation = messages.length > 0;

  // Check connection + load sessions on mount + cleanup abort on unmount
  useEffect(() => {
    mountedRef.current = true;

    agentHealthCheck().then(h => { if (mountedRef.current) setConnectionStatus(h.ok ? 'connected' : 'disconnected'); });
    agentGetSessions().then(s => { if (mountedRef.current) setSessions(s); }).catch(() => {});

    return () => {
      mountedRef.current = false;
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Auto-scroll only on new messages (not on state changes to avoid jarring)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setCurrentState(null);
    setShowHistory(false);
  }, []);

  async function loadSession(session: AgentSession) {
    setShowHistory(false);
    setSessionId(session.id);
    try {
      const msgs = await agentGetSessionMessages(session.id);
      setMessages(msgs
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          messageType: (m.message_type || 'text') as UIAgentMessage['messageType'],
          structuredData: m.structured_data ?? null,
        }))
      );
    } catch {
      setMessages([]);
    }
  }

  async function handleDeleteSession(id: string) {
    await agentDeleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (sessionId === id) startNewChat();
  }

  async function handleSend(text?: string) {
    const content = (text || input).trim();
    if (!content || isProcessing) return;

    // Add user message
    const userMsg: UIAgentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      messageType: 'text',
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsProcessing(true);
    setCurrentState('understand');

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Prepare assistant message placeholder
    const assistantId = crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      messageType: 'text',
      isStreaming: true,
    }]);

    abortRef.current = new AbortController();

    try {
      let gotSessionId = sessionId;
      let scenarioData: ScenarioResult | null = null;
      let approvalData: ApprovalRequest | null = null;

      await agentChat({
        message: content,
        sessionId,
        language: language as 'en' | 'fr',
        signal: abortRef.current.signal,
        onEvent: (event: AgentSSEEvent) => {
          if (!mountedRef.current) return;
          switch (event.type) {
            case 'state_change':
              setCurrentState(event.state as AgentStateLabel);
              // Auto-open graph when scenario engine starts
              if (event.state === 'scenario_engine' || event.state === 'decide') {
                setGraphData(prev => prev || { scenario: null, question: content, entities: [] });
                setGraphOpen(true);
              }
              break;

            case 'token':
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: m.content + event.content }
                  : m
              ));
              break;

            case 'scenario':
              scenarioData = event.data;
              // Build entity nodes from scenario labels
              const entities = (event.data.options || []).map((o: any) => ({
                type: 'team', label: o.label,
              }));
              setGraphData({ scenario: event.data, question: content, entities });
              setGraphOpen(true);
              break;

            case 'approval':
              approvalData = event.data;
              break;

            case 'done':
              if (event.sessionId) {
                gotSessionId = event.sessionId;
                setSessionId(event.sessionId);
              }
              break;

            case 'error':
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: m.content || (fr ? 'Une erreur est survenue.' : 'An error occurred.'), isStreaming: false }
                  : m
              ));
              break;
          }
        },
      });

      // Finalize assistant message — if still empty and no error, show fallback
      setMessages(prev => prev.map(m => {
        if (m.id !== assistantId) return m;
        const content = m.content || (fr ? 'Je n\'ai pas pu générer de réponse.' : 'I couldn\'t generate a response.');
        return { ...m, content, isStreaming: false };
      }));

      // Add scenario expansion if present + store for graph
      if (scenarioData) {
        setGraphData({ scenario: scenarioData, question: content });
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          messageType: 'scenario',
          structuredData: scenarioData,
        }]);
      }

      // Add approval card if present
      if (approvalData) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          messageType: 'approval_request',
          structuredData: approvalData,
        }]);
      }

      // Refresh sessions
      agentGetSessions().then(setSessions).catch(() => {});

    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: fr ? 'Erreur de connexion.' : 'Connection error.', isStreaming: false }
            : m
        ));
      }
    } finally {
      setIsProcessing(false);
      setCurrentState(null);
      abortRef.current = null;
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

  /* ── Checking state ── */
  if (connectionStatus === 'checking') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh]">
        <MrLumeAvatar size="lg" pulse className="mb-4" />
        <p className="text-sm text-text-tertiary font-medium">
          {fr ? 'Connexion à Mr Lume...' : 'Connecting to Mr Lume...'}
        </p>
      </div>
    );
  }

  /* ── Disconnected state ── */
  if (connectionStatus === 'disconnected') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
        <MrLumeAvatar size="lg" className="mb-5" />
        <h1 className="text-xl font-bold text-text-primary mb-2">
          {fr ? 'Mr Lume n\'est pas disponible' : 'Mr Lume is unavailable'}
        </h1>
        <p className="text-sm text-text-tertiary leading-relaxed mb-6 max-w-md">
          {fr
            ? 'Le serveur AI n\'est pas accessible. Vérifiez que le backend est en cours d\'exécution.'
            : 'The AI server is not reachable. Make sure the backend is running.'}
        </p>
        <button
          onClick={() => { setConnectionStatus('checking'); agentHealthCheck().then(h => setConnectionStatus(h.ok ? 'connected' : 'disconnected')); }}
          className="px-5 py-2.5 rounded-lg bg-text-primary text-surface text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {fr ? 'Réessayer' : 'Retry'}
        </button>
      </div>
    );
  }

  /* ── History view ── */
  if (showHistory && !isInConversation) {
    return (
      <div className="max-w-2xl mx-auto pt-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-lg font-bold text-text-primary">{fr ? 'Sessions Mr Lume' : 'Mr Lume Sessions'}</h1>
          <button onClick={startNewChat} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-text-primary text-surface text-xs font-medium hover:opacity-90 transition-opacity">
            <Plus size={14} />{fr ? 'Nouvelle session' : 'New session'}
          </button>
        </div>
        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-outline-subtle bg-surface-secondary p-8 text-center">
              <p className="text-sm text-text-tertiary">{fr ? 'Aucune session précédente' : 'No previous sessions'}</p>
            </div>
          ) : sessions.map(s => (
            <div key={s.id} className="group flex items-start gap-3 rounded-xl border border-outline-subtle bg-surface p-4 hover:border-outline transition-all cursor-pointer" onClick={() => loadSession(s)}>
              <MrLumeAvatar size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{s.title || 'Untitled'}</p>
                <p className="text-xs text-text-tertiary mt-0.5">{s.message_count} messages</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleDeleteSession(s.id); }}
                className="p-1.5 rounded-md text-text-tertiary hover:text-danger hover:bg-danger-light opacity-0 group-hover:opacity-100 transition-all">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Empty state ── */
  if (!isInConversation && !showHistory) {
    const suggestions = fr
      ? ['Prepare-moi pour la journee', 'Y a-t-il des problemes a regler?', 'Qui devrait faire le prochain job?', 'Resume mes clients actifs']
      : ['Prepare me for the day', 'Any issues to address?', 'Who should handle the next job?', 'Summarize my active clients'];

    return (
      <div className="flex flex-col items-center min-h-[70vh]">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="text-center max-w-2xl pt-8 pb-10">
          <MrLumeAvatar size="lg" className="mx-auto mb-6" />
          <h1 className="text-3xl font-bold tracking-tight text-text-primary mb-3">Mr Lume</h1>
          <p className="text-sm text-text-tertiary leading-relaxed max-w-md mx-auto">
            {fr
              ? 'Votre agent CRM intelligent. Posez des questions, obtenez des recommandations, et laissez Mr Lume analyser vos scénarios.'
              : 'Your intelligent CRM agent. Ask questions, get recommendations, and let Mr Lume analyze your scenarios.'}
          </p>
        </motion.div>

        {/* Input */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="w-full max-w-2xl mb-8">
          <div className="relative rounded-xl border border-outline-subtle bg-surface shadow-sm transition-all focus-within:border-outline focus-within:shadow-md">
            <textarea ref={inputRef} value={input} onChange={autoResize} onKeyDown={handleKeyDown}
              aria-label={fr ? 'Message pour Mr Lume' : 'Message for Mr Lume'}
              placeholder={fr ? 'Demandez à Mr Lume...' : 'Ask Mr Lume...'} rows={1}
              className="w-full resize-none bg-transparent px-4 py-3.5 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none" style={{ maxHeight: 160 }} />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {voiceEnabled && <VoiceInput onTranscript={(t) => setInput(prev => prev + t)} language={language as 'en' | 'fr'} />}
              <button onClick={() => handleSend()} disabled={!input.trim() || isProcessing}
                aria-label={fr ? 'Envoyer le message' : 'Send message'}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none">
                <Send size={16} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => handleSend(s)}
                className="px-3 py-1.5 rounded-lg border border-outline-subtle bg-surface text-xs font-medium text-text-secondary hover:border-outline hover:text-text-primary transition-all">
                {s}
              </button>
            ))}
          </div>
        </motion.div>

        {sessions.length > 0 && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-2 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors mb-10">
            <Clock size={13} />
            {fr ? `${sessions.length} session${sessions.length > 1 ? 's' : ''} précédente${sessions.length > 1 ? 's' : ''}` : `${sessions.length} past session${sessions.length > 1 ? 's' : ''}`}
            <ArrowRight size={12} />
          </motion.button>
        )}
      </div>
    );
  }

  /* ── Conversation view ── */
  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <MrLumeAvatar size="sm" />
          <span className="text-sm font-semibold text-text-primary">Mr Lume</span>
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
        </div>
        <button onClick={startNewChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-text-primary text-surface text-xs font-medium hover:opacity-90 transition-opacity">
          <Plus size={14} />{fr ? 'Nouvelle session' : 'New session'}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 py-4">
        <AnimatePresence initial={false}>
          {messages.map(msg => {
            // Scenario expansion + button to reopen graph
            if (msg.messageType === 'scenario' && msg.structuredData) {
              const scenData = msg.structuredData as ScenarioResult;
              return (
                <React.Fragment key={msg.id}>
                  <ScenarioExpansion
                    data={scenData}
                    language={language as 'en' | 'fr'}
                  />
                  <div className="flex justify-start pl-10 -mt-1">
                    <button
                      onClick={() => { setGraphData({ scenario: scenData, question: messages.find(m => m.role === 'user')?.content || '', entities: (scenData.options || []).map(o => ({ type: 'team', label: o.label })) }); setGraphOpen(true); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-subtle text-[11px] font-medium text-text-secondary hover:text-text-primary hover:border-outline transition-all"
                    >
                      <Network size={12} />
                      {fr ? 'Ouvrir le graphe' : 'Open graph'}
                    </button>
                  </div>
                </React.Fragment>
              );
            }

            // Approval card
            if (msg.messageType === 'approval_request' && msg.structuredData) {
              return (
                <React.Fragment key={msg.id}>
                  <ApprovalCard
                    data={msg.structuredData as ApprovalRequest}
                    language={language as 'en' | 'fr'}
                  />
                </React.Fragment>
              );
            }

            // Regular messages
            return (
              <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'gap-3 items-start'}`}>
                {msg.role === 'assistant' && <MrLumeAvatar size="sm" />}
                <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-text-primary text-surface'
                    : 'bg-surface-secondary text-text-primary border border-outline-subtle'
                }`}>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}</div>
                  {msg.role === 'assistant' && !msg.isStreaming && msg.content && (
                    <div className="mt-2 pt-1.5 border-t border-outline-subtle/50">
                      <FeedbackButtons messageId={msg.id} sessionId={sessionId} language={language as 'en' | 'fr'} />
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Thinking indicator */}
        {isProcessing && currentState && (
          <AgentThinking currentState={currentState} language={language as 'en' | 'fr'} />
        )}
      </div>

      {/* Input */}
      <div className="py-3">
        <div className="relative rounded-xl border border-outline-subtle bg-surface shadow-sm transition-all focus-within:border-outline focus-within:shadow-md">
          <textarea ref={inputRef} value={input} onChange={autoResize} onKeyDown={handleKeyDown}
            aria-label={fr ? 'Message pour Mr Lume' : 'Message for Mr Lume'}
            placeholder={fr ? 'Votre message...' : 'Your message...'} rows={1}
            className="w-full resize-none bg-transparent px-4 py-3.5 pr-12 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
            style={{ maxHeight: 160 }} />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {voiceEnabled && <VoiceInput onTranscript={(t) => setInput(prev => prev + t)} language={language as 'en' | 'fr'} disabled={isProcessing} />}
            <button onClick={() => handleSend()} disabled={!input.trim() || isProcessing}
              aria-label={fr ? 'Envoyer le message' : 'Send message'}
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors disabled:opacity-30 disabled:pointer-events-none">
              {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 mt-2">
          <p className="text-[10px] text-text-tertiary">
            Mr Lume · {fr ? 'Votre agent CRM intelligent' : 'Your intelligent CRM agent'}
          </p>
          {graphData?.scenario && (
            <button
              onClick={() => setGraphOpen(true)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-outline-subtle text-[10px] font-medium text-text-secondary hover:text-text-primary hover:border-outline transition-all"
            >
              <Network size={10} />
              {fr ? 'Voir graphe' : 'View graph'}
            </button>
          )}
        </div>
      </div>

      {/* Prediction Graph Panel — live during analysis */}
      <PredictionGraph
        open={graphOpen}
        onClose={() => setGraphOpen(false)}
        scenarioData={graphData?.scenario || null}
        question={graphData?.question || ''}
        currentState={isProcessing ? currentState : 'done'}
        crmEntities={graphData?.entities || []}
        language={language as 'en' | 'fr'}
      />
    </div>
  );
}
