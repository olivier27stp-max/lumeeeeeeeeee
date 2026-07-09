/* Lume Agent — interactive chat (Gemini-powered, org-scoped).
   READ questions answered from live CRM data; write actions
   (quote/invoice/job/SMS) are proposed and require confirmation. */

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUp, Loader2, AudioLines, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import {
  sendAgentMessage,
  executeProposedAction,
  type AgentMessage,
  type ProposedAction,
} from '../lib/agentApi';
import ActionConfirmCard from './ActionConfirmCard';

interface ChatItem {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  action?: ProposedAction | null;
  status?: 'proposed' | 'confirmed' | 'cancelled';
}

export default function MrLumeChat() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const lang: 'fr' | 'en' = fr ? 'fr' : 'en';

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const nextId = () => idRef.current++;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, loading]);

  const placeholder = fr ? 'Pose-moi une question ou donne-moi une instruction…' : 'Ask a question or give an instruction…';

  const suggestions = fr
    ? ['Quelles sont nos dates à (city) ?', 'Combien de clients avons-nous ?', 'Montre les factures impayées', 'Soumissions envoyées récemment']
    : ['What are our dates in (city)?', 'How many clients do we have?', 'Show unpaid invoices', 'Recently sent quotes'];

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);

    const userItem: ChatItem = { id: nextId(), role: 'user', content: trimmed };
    const nextItems = [...items, userItem];
    setItems(nextItems);
    setInput('');
    setLoading(true);

    // Build transcript (text turns only) for the server.
    const transcript: AgentMessage[] = nextItems
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await sendAgentMessage(transcript, lang);
      setItems((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          content: res.reply || (res.proposedAction ? (fr ? "J'ai préparé l'action ci-dessous." : 'I prepared the action below.') : '…'),
          action: res.proposedAction,
          status: res.proposedAction ? 'proposed' : undefined,
        },
      ]);
    } catch (err: any) {
      setError(err?.message || (fr ? 'Erreur de connexion.' : 'Connection error.'));
    } finally {
      setLoading(false);
    }
  }

  /* Voice input — tap the wave logo, speak, transcript is sent on end of speech. */
  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError(fr ? "La reconnaissance vocale n'est pas supportée par ce navigateur." : 'Voice recognition is not supported in this browser.');
      return;
    }
    const rec = new SR();
    rec.lang = fr ? 'fr-CA' : 'en-US';
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results as ArrayLike<any>)
        .map((r) => r[0].transcript)
        .join('');
      setInput(text);
      if (e.results[e.results.length - 1].isFinal) {
        rec.stop();
        send(text);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function confirmAction(item: ChatItem) {
    if (!item.action || actionBusy) return;
    setActionBusy(true);
    setError(null);
    try {
      const result = await executeProposedAction(item.action);
      setItems((prev) =>
        prev.map((m): ChatItem => (m.id === item.id ? { ...m, status: 'confirmed' } : m)).concat({
          id: nextId(),
          role: 'assistant',
          content:
            item.action!.type === 'send_sms'
              ? fr ? '✅ SMS envoyé.' : '✅ SMS sent.'
              : fr
              ? `✅ Créé : ${result.reference}`
              : `✅ Created: ${result.reference}`,
        }),
      );
    } catch (err: any) {
      setError(err?.message || (fr ? "Échec de l'action." : 'Action failed.'));
    } finally {
      setActionBusy(false);
    }
  }

  function cancelAction(item: ChatItem) {
    setItems((prev) =>
      prev.map((m): ChatItem => (m.id === item.id ? { ...m, status: 'cancelled' } : m)).concat({
        id: nextId(),
        role: 'assistant',
        content: fr ? 'Action annulée.' : 'Action cancelled.',
      }),
    );
  }

  const empty = items.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-[820px] mx-auto px-4">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6 space-y-4">
        {empty && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center text-center mt-[12vh] gap-4"
          >
            <button
              onClick={toggleVoice}
              aria-label={fr ? 'Parler à Lume' : 'Talk to Lume'}
              title={fr ? 'Parler à Lume' : 'Talk to Lume'}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                listening ? 'bg-primary text-white animate-pulse' : 'bg-primary/10 text-primary hover:bg-primary/20'
              }`}
            >
              <AudioLines size={22} strokeWidth={2.75} />
            </button>
            <div>
              <h2 className="text-[18px] font-semibold text-text-primary">Lume Agent</h2>
              <p className="text-[13px] text-text-tertiary mt-1 max-w-[420px]">
                {fr
                  ? "Je connais tout ton workspace. Pose une question ou demande-moi de créer une soumission, une facture, une job ou d'envoyer un SMS — tu confirmes avant chaque action."
                  : 'I know your whole workspace. Ask anything, or have me draft a quote, invoice, job, or SMS — you confirm before every action.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="px-3.5 py-2 rounded-full border border-outline bg-surface text-[12.5px] text-text-secondary hover:bg-surface-secondary transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {items.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={m.role === 'user' ? 'max-w-[80%]' : 'max-w-[88%]'}>
              <div
                className={
                  m.role === 'user'
                    ? 'rounded-2xl rounded-br-md bg-primary text-white px-4 py-2.5 text-[13.5px] whitespace-pre-wrap'
                    : 'rounded-2xl rounded-bl-md bg-surface-secondary text-text-primary px-4 py-2.5 text-[13.5px] whitespace-pre-wrap'
                }
              >
                {m.content}
              </div>
              {m.action && m.status === 'proposed' && (
                <ActionConfirmCard
                  action={m.action}
                  fr={fr}
                  busy={actionBusy}
                  onConfirm={() => confirmAction(m)}
                  onCancel={() => cancelAction(m)}
                />
              )}
              {m.action && m.status === 'confirmed' && (
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] text-emerald-600">
                  <CheckCircle2 size={13} /> {fr ? 'Confirmé' : 'Confirmed'}
                </div>
              )}
              {m.action && m.status === 'cancelled' && (
                <div className="mt-1.5 text-[11.5px] text-text-tertiary">{fr ? 'Annulé' : 'Cancelled'}</div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-surface-secondary px-4 py-3 text-text-tertiary">
              <Loader2 size={16} className="animate-spin" />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-[12px]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Composer */}
      <div className="pb-4">
        <div className="relative rounded-2xl border border-outline bg-surface shadow-sm focus-within:border-primary/50 transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none leading-relaxed"
            style={{ maxHeight: 160 }}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            aria-label={fr ? 'Envoyer' : 'Send'}
            className="absolute bottom-2.5 right-2.5 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.5} />}
          </button>
        </div>
        <p className="text-[10.5px] text-text-tertiary text-center mt-2">
          {fr
            ? "L'agent ne crée et n'envoie rien sans ta confirmation."
            : 'The agent never creates or sends anything without your confirmation.'}
        </p>
      </div>
    </div>
  );
}
