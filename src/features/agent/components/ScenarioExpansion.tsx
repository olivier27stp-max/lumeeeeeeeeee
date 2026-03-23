import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp, Trophy, AlertTriangle, CheckCircle2, TrendingUp, Sparkles, Zap } from 'lucide-react';
import MrLumeAvatar from './MrLumeAvatar';
import type { ScenarioResult, ScenarioOption } from '../types';
import { useTranslation } from '../i18n';

interface ScenarioExpansionProps {
  data: ScenarioResult;
  language: 'en' | 'fr';
}

interface ScenarioCardProps {
  option: ScenarioOption;
  index: number;
  language: 'en' | 'fr';
  revealed: boolean;
}

/* ── Animated score ring ── */
function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? '#22c55e' : score >= 45 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke="currentColor" strokeWidth={3} className="text-surface-tertiary" />
        <motion.circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.span
          className="text-xs font-bold tabular-nums text-text-primary"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {score}
        </motion.span>
      </div>
    </div>
  );
}

/* ── Individual scenario card ── */
function ScenarioCard({ option, index, language, revealed }: ScenarioCardProps) {
  const [expanded, setExpanded] = useState(option.isWinner || false);
  const fr = language === 'fr';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={revealed ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{ duration: 0.4, delay: index * 0.2, ease: [0.23, 1, 0.32, 1] }}
      className={`rounded-xl border p-4 transition-all ${
        option.isWinner
          ? 'border-text-primary/30 bg-surface shadow-md ring-1 ring-text-primary/10'
          : 'border-outline-subtle bg-surface hover:border-outline'
      }`}
    >
      {/* Winner badge */}
      {option.isWinner && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.2 + 0.6 }}
          className="flex items-center gap-1.5 mb-3"
        >
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30">
            <Trophy size={10} className="text-amber-500" />
            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
              {t.agent.recommended}
            </span>
          </div>
        </motion.div>
      )}

      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${option.label} — score ${option.score}/100`}
        className="w-full flex items-center gap-3 text-left"
      >
        {/* Score ring */}
        <ScoreRing score={option.score} />

        {/* Label + confidence */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{option.label}</p>
          <p className="text-[10px] text-text-tertiary mt-0.5">
            {t.agent.confidence}: {Math.round(option.confidence * 100)}%
          </p>
        </div>

        {expanded ? <ChevronUp size={16} className="text-text-tertiary shrink-0" /> : <ChevronDown size={16} className="text-text-tertiary shrink-0" />}
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="pt-4 space-y-3 border-t border-outline-subtle mt-3">
              {/* Benefits */}
              {(option.benefits?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400 mb-1.5 flex items-center gap-1">
                    <CheckCircle2 size={10} />
                    {t.agent.benefits}
                  </p>
                  <div className="space-y-1">
                    {option.benefits.filter(Boolean).map((b, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-start gap-1.5"
                      >
                        <div className="w-1 h-1 rounded-full bg-green-400 mt-1.5 shrink-0" />
                        <span className="text-[11px] text-text-secondary leading-snug">{b}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Risks */}
              {(option.risks?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400 mb-1.5 flex items-center gap-1">
                    <AlertTriangle size={10} />
                    {t.agent.risks}
                  </p>
                  <div className="space-y-1">
                    {option.risks.filter(Boolean).map((r, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-start gap-1.5"
                      >
                        <div className="w-1 h-1 rounded-full bg-red-400 mt-1.5 shrink-0" />
                        <span className="text-[11px] text-text-secondary leading-snug">{r}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outcome */}
              {option.outcome && (
                <div className="rounded-lg bg-surface-secondary p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp size={10} className="text-text-tertiary" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
                      {t.agent.expectedOutcome}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">{option.outcome}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Main scenario expansion (MiroFish-inspired) ── */
export default function ScenarioExpansion({ data, language }: ScenarioExpansionProps) {
  const fr = language === 'fr';
  const [revealedCount, setRevealedCount] = useState(0);
  const allRevealed = revealedCount >= (data.options?.length || 0);

  // Sequential reveal — one card every 400ms
  useEffect(() => {
    if (!data.options?.length) return;
    const interval = setInterval(() => {
      setRevealedCount(prev => {
        if (prev >= data.options.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 400);
    return () => clearInterval(interval);
  }, [data.options?.length]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 items-start"
    >
      <MrLumeAvatar size="sm" />

      <div className="flex-1 max-w-[85%] space-y-3">
        {/* Header — simulation feel */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-outline-subtle bg-surface p-4"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <motion.div
                animate={!allRevealed ? { rotate: [0, 360] } : {}}
                transition={{ duration: 2, repeat: allRevealed ? 0 : Infinity, ease: 'linear' }}
              >
                <Zap size={14} className="text-text-primary" />
              </motion.div>
              <span className="text-xs font-bold text-text-primary">
                {t.agent.scenarioAnalysis}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-text-tertiary">
                {(data.durationMs / 1000).toFixed(1)}s
              </span>
              {allRevealed && (
                <motion.div
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-50 dark:bg-green-900/30"
                >
                  <CheckCircle2 size={10} className="text-green-500" />
                  <span className="text-[10px] font-medium text-green-600 dark:text-green-400">
                    {t.agent.complete}
                  </span>
                </motion.div>
              )}
            </div>
          </div>

          {/* Mini progress */}
          <div className="flex gap-1">
            {(data.options || []).map((_, i) => (
              <motion.div
                key={i}
                className={`h-0.5 flex-1 rounded-full ${i < revealedCount ? 'bg-text-primary' : 'bg-surface-tertiary'}`}
                animate={i < revealedCount ? { opacity: 1 } : { opacity: 0.3 }}
                transition={{ duration: 0.3 }}
              />
            ))}
          </div>

          <p className="text-[11px] text-text-tertiary mt-2">
            {allRevealed
              ? fr
                ? `${data.options.length} scenarios analyses — recommandation prete`
                : `${data.options.length} scenarios analyzed — recommendation ready`
              : fr
                ? `Analyse en cours... ${revealedCount}/${data.options?.length || 0}`
                : `Analyzing... ${revealedCount}/${data.options?.length || 0}`}
          </p>
        </motion.div>

        {/* Scenario cards — revealed one by one */}
        <div className="space-y-2.5">
          {data.options?.length ? data.options.map((option, i) => (
            <React.Fragment key={`${option.label}-${i}`}>
              <ScenarioCard option={option} index={i} language={language} revealed={i < revealedCount} />
            </React.Fragment>
          )) : (
            <div className="rounded-lg border border-outline-subtle bg-surface p-3 text-center">
              <p className="text-xs text-text-tertiary">
                {t.agent.noScenariosGenerated}
              </p>
            </div>
          )}
        </div>

        {/* Winner summary — appears after all revealed */}
        {allRevealed && data.options?.length > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="rounded-xl border border-text-primary/20 bg-surface p-3 flex items-center gap-3"
          >
            <Sparkles size={16} className="text-text-primary shrink-0" />
            <div>
              <p className="text-xs font-semibold text-text-primary">
                {t.agent.mrLumeRecommendation}
              </p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                {data.options.find(o => o.isWinner)?.label || data.options[0]?.label}
                {' — '}
                {t.agent.score} {data.options.find(o => o.isWinner)?.score || data.options[0]?.score}/100
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
