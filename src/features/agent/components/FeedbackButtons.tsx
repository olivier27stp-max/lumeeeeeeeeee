import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface FeedbackButtonsProps {
  messageId: string;
  sessionId: string | null;
  language: 'en' | 'fr';
}

export default function FeedbackButtons({ messageId, sessionId, language }: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const fr = language === 'fr';

  async function handleFeedback(type: 'up' | 'down') {
    setFeedback(type);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (!authSession?.access_token) return;

      await fetch('/api/agent/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession.access_token}`,
        },
        body: JSON.stringify({ messageId, sessionId, feedback: type }),
      });
    } catch { /* silent */ }
  }

  if (feedback) {
    return (
      <span className="text-[10px] text-text-tertiary">
        {feedback === 'up' ? (fr ? 'Merci!' : 'Thanks!') : (fr ? 'Note' : 'Noted')}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1">
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
    </div>
  );
}
