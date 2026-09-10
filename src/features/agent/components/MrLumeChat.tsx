/* Lume Agent — interactive chat (Gemini-powered, org-scoped).
   READ questions answered from live CRM data; write actions
   (quote/invoice/job/SMS) are proposed and require confirmation. */

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUp, Loader2, AudioLines, AlertTriangle, CheckCircle2, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import {
  sendAgentMessage,
  executeProposedAction,
  type AgentMessage,
  type ProposedAction,
} from '../lib/agentApi';
import ActionConfirmCard from './ActionConfirmCard';
import { useVoiceInput, MAX_SECONDS } from '../hooks/useVoiceInput';
import { useSpeakReplies } from '../hooks/useSpeakReplies';

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
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* Vrai si la dernière question a été dite au micro : la réponse est alors lue. */
  const spokenRef = useRef(false);
  const pendingSpokenRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const speech = useSpeakReplies(lang);

  const nextId = () => idRef.current++;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, loading]);

  const placeholder = fr ? 'Pose-moi une question ou donne-moi une instruction…' : 'Ask a question or give an instruction…';

  const suggestions = fr
    ? ['Quelles sont nos dates à (city) ?', 'Combien de clients avons-nous ?', 'Montre les factures impayées', 'Soumissions envoyées récemment']
    : ['What are our dates in (city)?', 'How many clients do we have?', 'Show unpaid invoices', 'Recently sent quotes'];

  async function send(text: string, opts: { spoken?: boolean } = {}) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    spokenRef.current = !!opts.spoken || pendingSpokenRef.current;
    pendingSpokenRef.current = false;
    speech.stopSpeaking();

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
      if (spokenRef.current && res.reply) speech.speak(res.reply);
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

  /* Micro : enregistre, le serveur transcrit, le texte part comme un message
     et la réponse est lue à voix haute (désactivable). */
  const voice = useVoiceInput({
    language: lang,
    // Rien ne part tout seul : le texte va dans la zone, on relit, on envoie.
    onTranscript: (text) => {
      setInput((v) => (v.trim() ? `${v.trim()} ${text}` : text));
      pendingSpokenRef.current = true;
      requestAnimationFrame(() => { const el = inputRef.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); });
    },
    onError: (message) => setError(message),
  });
  const listening = voice.state === 'recording';
  const transcribing = voice.state === 'transcribing';
  function toggleVoice() {
    if (listening) voice.stop();
    else if (voice.state === 'idle') void voice.start();
  }
  const mm = String(Math.floor(voice.seconds / 60));
  const ss = String(voice.seconds % 60).padStart(2, '0');

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
              disabled={transcribing}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                listening ? 'bg-primary text-white animate-pulse' : 'bg-primary/10 text-primary hover:bg-primary/20'
              } disabled:opacity-60`}
            >
              {transcribing ? <Loader2 size={22} className="animate-spin" /> : <AudioLines size={22} strokeWidth={2.75} />}
            </button>
            {(listening || transcribing) && (
              <p className="text-[12px] font-medium text-primary -mt-2" aria-live="polite">
                {listening ? `${fr ? 'Je t\'écoute' : 'Listening'} · ${mm}:${ss}` : (fr ? 'Je transcris…' : 'Transcribing…')}
              </p>
            )}
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
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={placeholder}
            aria-label={fr ? 'Message à Lume' : 'Message to Lume'}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-[14px] text-text-primary placeholder:text-text-tertiary focus:outline-none leading-relaxed"
            style={{ maxHeight: 160 }}
          />
          <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5">
            {voice.supported && (
              <button
                type="button"
                onClick={toggleVoice}
                disabled={transcribing || loading}
                aria-label={listening ? (fr ? "Arrêter l'enregistrement" : 'Stop recording') : (fr ? 'Parler à Lume' : 'Talk to Lume')}
                title={listening ? (fr ? 'Arrêter' : 'Stop') : (fr ? 'Parler' : 'Talk')}
                className={`h-8 rounded-full flex items-center gap-2 px-2.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                  listening ? 'bg-danger text-white' : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
              >
                {transcribing ? <Loader2 size={15} className="animate-spin" /> : listening ? <Square size={13} fill="currentColor" /> : <Mic size={15} strokeWidth={2.5} />}
                {listening && <span className="tabular-nums" aria-live="polite">{mm}:{ss}</span>}
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
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  speech.speaking ? 'bg-primary text-white animate-pulse' : speech.enabled ? 'text-text-secondary hover:bg-surface-secondary' : 'text-text-tertiary hover:bg-surface-secondary'
                }`}
              >
                {speech.enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
            )}
          </div>
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
          {listening
            ? (fr ? `Parle ; à la fin, le texte apparaît dans la zone et tu l’envoies toi-même. ${MAX_SECONDS} s max.` : `Speak; when done, the text appears in the box and you send it yourself. ${MAX_SECONDS} s max.`)
            : fr
              ? "L'agent ne crée et n'envoie rien sans ta confirmation."
              : 'The agent never creates or sends anything without your confirmation.'}
        </p>
      </div>
    </div>
  );
}
