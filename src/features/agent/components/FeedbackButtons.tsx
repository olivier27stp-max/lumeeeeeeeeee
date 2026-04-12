import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, PenLine, X, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../../../lib/supabase';
import { toast } from 'sonner';

interface FeedbackButtonsProps {
  messageId: string;
  sessionId: string | null;
  language: 'en' | 'fr';
  responseText?: string;
  domain?: string;
}

const CORRECTION_TYPES = [
  { value: 'wrong_answer', en: 'Wrong answer', fr: 'Mauvaise réponse' },
  { value: 'wrong_tone', en: 'Wrong tone', fr: 'Mauvais ton' },
  { value: 'missing_context', en: 'Missing context', fr: 'Contexte manquant' },
  { value: 'hallucination', en: 'Made something up', fr: 'Invention' },
  { value: 'outdated', en: 'Outdated info', fr: 'Info obsolète' },
];

export default function FeedbackButtons({ messageId, sessionId, language, responseText, domain }: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionType, setCorrectionType] = useState('wrong_answer');
  const [correctionText, setCorrectionText] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fr = language === 'fr';

  async function getHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  }

  async function handleFeedback(type: 'up' | 'down') {
    setFeedback(type);
    try {
      const headers = await getHeaders();
      if (!headers) return;

      // Use training-aware endpoint
      await fetch('/api/agent/feedback-train', {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageId, isPositive: type === 'up', domain }),
      });

      // Also send to legacy endpoint for backward compat
      await fetch('/api/agent/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({ messageId, sessionId, feedback: type }),
      });
    } catch { /* silent */ }

    // On thumbs down, show correction form
    if (type === 'down') {
      setShowCorrection(true);
    }
  }

  async function submitCorrection() {
    if (!correctionText.trim()) return;
    setSubmitting(true);
    try {
      const headers = await getHeaders();
      if (!headers) return;

      await fetch('/api/agent/correction', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionId,
          messageId,
          originalResponse: responseText || '',
          domain,
          correctionType,
          correctionText: correctionText.trim(),
          correctAnswer: correctAnswer.trim() || undefined,
        }),
      });

      setShowCorrection(false);
      setCorrectionText('');
      setCorrectAnswer('');
      toast.success(fr ? 'Correction enregistrée — Mr Lume apprend!' : 'Correction recorded — Mr Lume is learning!');
    } catch {
      toast.error(fr ? 'Erreur' : 'Error');
    }
    setSubmitting(false);
  }

  return (
    <div className="inline-flex flex-col gap-1">
      {/* Feedback buttons */}
      <div className="flex items-center gap-1">
        {feedback === null ? (
          <>
            <button
              onClick={() => handleFeedback('up')}
              aria-label={fr ? 'Utile' : 'Helpful'}
              className="p-1 rounded text-text-tertiary hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
            >
              <ThumbsUp size={12} />
            </button>
            <button
              onClick={() => handleFeedback('down')}
              aria-label={fr ? 'Pas utile' : 'Not helpful'}
              className="p-1 rounded text-text-tertiary hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <ThumbsDown size={12} />
            </button>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-tertiary">
              {feedback === 'up' ? (fr ? 'Merci!' : 'Thanks!') : (fr ? 'Noté' : 'Noted')}
            </span>
            {feedback === 'down' && !showCorrection && (
              <button
                onClick={() => setShowCorrection(true)}
                className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
              >
                <PenLine size={10} />
                {fr ? 'Corriger' : 'Correct'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Correction form */}
      <AnimatePresence>
        {showCorrection && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-3 bg-surface-secondary rounded-xl border border-outline space-y-2 max-w-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-text-primary">
                  {fr ? 'Aidez Mr Lume à s\'améliorer' : 'Help Mr Lume improve'}
                </span>
                <button onClick={() => setShowCorrection(false)} className="p-0.5 rounded hover:bg-surface text-text-tertiary">
                  <X size={12} />
                </button>
              </div>

              {/* Correction type */}
              <div className="flex flex-wrap gap-1">
                {CORRECTION_TYPES.map((ct) => (
                  <button
                    key={ct.value}
                    onClick={() => setCorrectionType(ct.value)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                      correctionType === ct.value
                        ? 'bg-primary text-white'
                        : 'bg-surface text-text-tertiary hover:text-text-secondary'
                    }`}
                  >
                    {fr ? ct.fr : ct.en}
                  </button>
                ))}
              </div>

              {/* What was wrong */}
              <textarea
                value={correctionText}
                onChange={(e) => setCorrectionText(e.target.value)}
                placeholder={fr ? 'Qu\'est-ce qui n\'allait pas ?' : 'What was wrong?'}
                className="w-full px-2 py-1.5 text-[11px] rounded-lg bg-surface border border-outline text-text-primary placeholder:text-text-tertiary resize-none"
                rows={2}
              />

              {/* Correct answer (optional) */}
              <textarea
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
                placeholder={fr ? 'La bonne réponse serait... (optionnel)' : 'The correct answer would be... (optional)'}
                className="w-full px-2 py-1.5 text-[11px] rounded-lg bg-surface border border-outline text-text-primary placeholder:text-text-tertiary resize-none"
                rows={2}
              />

              <button
                onClick={submitCorrection}
                disabled={!correctionText.trim() || submitting}
                className="glass-button-primary text-[11px] px-3 py-1 flex items-center gap-1 disabled:opacity-50"
              >
                <Send size={10} />
                {submitting ? (fr ? 'Envoi...' : 'Sending...') : (fr ? 'Envoyer' : 'Submit')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
