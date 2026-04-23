/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — Disabled UI Vitrine
   ─────────────────────────────────────────────────────────────
   AI backend was removed (Phase 4.2 cleanup). This component
   preserves the chat page shell as a read-only vitrine. All user
   interactions (send, mic, history) are disabled. External agents
   connect via /api/agent/connect + /api/agent/webhook instead.
   ═══════════════════════════════════════════════════════════════ */

import React from 'react';
import { motion } from 'motion/react';
import { Sparkles, ArrowUp, Paperclip, Info } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import MrLumeAvatar from './MrLumeAvatar';

export default function MrLumeChat() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const bannerText = fr
    ? "Les fonctionnalités IA sont temporairement désactivées — les agents externes peuvent se connecter via l'API."
    : 'AI features temporarily disabled — external agents can connect via API.';

  const placeholder = fr ? 'IA désactivée' : 'AI disabled';

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
      {/* Banner */}
      <div
        role="status"
        className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-[12px] mb-6 max-w-[680px] w-full mx-4"
      >
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>{bannerText}</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-[680px] px-4"
      >
        <div className="flex items-center justify-center mb-4">
          <MrLumeAvatar size="md" />
        </div>

        {/* Input card — visually present but fully disabled */}
        <div
          aria-disabled="true"
          className="relative rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/30 opacity-60 cursor-not-allowed"
        >
          <textarea
            disabled
            aria-label={placeholder}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none bg-transparent px-5 pt-5 pb-14 text-[14px] text-text-primary placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none leading-relaxed cursor-not-allowed"
            style={{ maxHeight: 160 }}
          />
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                disabled
                className="p-2 rounded-lg text-neutral-400 opacity-50 cursor-not-allowed"
                aria-label={fr ? 'Joindre un fichier (désactivé)' : 'Attach file (disabled)'}
              >
                <Paperclip size={16} />
              </button>
              {/* Voice input button removed — VoiceInput component deleted in cleanup */}
            </div>
            <button
              disabled
              aria-label={fr ? 'Envoyer (désactivé)' : 'Send (disabled)'}
              className="w-8 h-8 rounded-full bg-neutral-400 dark:bg-neutral-600 text-white flex items-center justify-center opacity-50 cursor-not-allowed"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Info footer */}
        <div className="flex items-center justify-center gap-2 mt-6 text-[11px] text-neutral-400">
          <Sparkles size={12} />
          <span>{fr ? 'Lume Agent — vitrine' : 'Lume Agent — preview'}</span>
        </div>
      </motion.div>
    </div>
  );
}
