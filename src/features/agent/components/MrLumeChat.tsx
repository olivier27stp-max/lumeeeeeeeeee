/* Mr Lume Agent — Disabled vitrine (shadcn AI Chat style) */

import React from 'react';
import { motion } from 'motion/react';
import { ArrowUp, Paperclip, Info } from 'lucide-react';
import { useTranslation } from '../../../i18n';

export default function MrLumeChat() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const placeholder = fr ? 'Pose-moi une question…' : 'Ask me anything…';
  const bannerText = fr
    ? 'Lume Agent est temporairement indisponible.'
    : 'Lume Agent is temporarily unavailable.';

  const suggestions = fr
    ? [
        'Quelle est la dernière tendance tech ?',
        'Comment ça marche ?',
        "Génère une image d'un chat",
        'Génère une API REST avec Express.js',
        "Quelle est la meilleure UX d'onboarding ?",
      ]
    : [
        "What's the latest tech trend?",
        'How does this work?',
        'Generate an image of a cat',
        'Generate a REST API with Express.js',
        "What's the best UX for onboarding?",
      ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] px-4">
      <div
        role="status"
        className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-[12px] mb-8 max-w-[760px] w-full"
      >
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>{bannerText}</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-[760px]"
      >
        <div
          aria-disabled="true"
          className="relative rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm opacity-70 cursor-not-allowed"
        >
          <textarea
            disabled
            aria-label={placeholder}
            placeholder={placeholder}
            rows={2}
            className="w-full resize-none bg-transparent px-5 pt-4 pb-14 text-[14px] text-text-primary placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none leading-relaxed cursor-not-allowed"
            style={{ maxHeight: 160 }}
          />
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <button
              disabled
              className="p-2 rounded-lg text-neutral-400 opacity-50 cursor-not-allowed"
              aria-label={fr ? 'Joindre un fichier (désactivé)' : 'Attach file (disabled)'}
            >
              <Paperclip size={16} />
            </button>
            <button
              disabled
              aria-label={fr ? 'Envoyer (désactivé)' : 'Send (disabled)'}
              className="w-8 h-8 rounded-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 flex items-center justify-center opacity-50 cursor-not-allowed"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-3 mt-6">
          {suggestions.map((s) => (
            <button
              key={s}
              disabled
              className="px-4 py-2 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-[13px] text-neutral-600 dark:text-neutral-300 opacity-60 cursor-not-allowed"
            >
              {s}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
