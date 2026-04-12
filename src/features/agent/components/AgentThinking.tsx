import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Database, Brain, BarChart3, Target, CheckCircle2, Sparkles } from 'lucide-react';
import MrLumeAvatar from './MrLumeAvatar';
import type { AgentStateLabel } from '../types';

interface AgentThinkingProps {
  currentState: AgentStateLabel;
  language: 'en' | 'fr';
}

const STEPS: { key: AgentStateLabel; icon: React.ElementType; en: string; fr: string }[] = [
  { key: 'understand', icon: Brain, en: 'Understanding request', fr: 'Analyse de la demande' },
  { key: 'fetch_context', icon: Database, en: 'Reading CRM data', fr: 'Lecture des donnees CRM' },
  { key: 'check_memory', icon: Brain, en: 'Checking memory', fr: 'Consultation memoire' },
  { key: 'decide', icon: Target, en: 'Making decision', fr: 'Prise de decision' },
  { key: 'scenario_engine', icon: BarChart3, en: 'Building scenarios', fr: 'Creation des scenarios' },
  { key: 'recommend', icon: Sparkles, en: 'Preparing answer', fr: 'Preparation de la reponse' },
];

const STATE_ORDER: AgentStateLabel[] = ['understand', 'fetch_context', 'check_memory', 'decide', 'scenario_engine', 'recommend'];

function getStepStatus(stepKey: AgentStateLabel, currentState: AgentStateLabel): 'pending' | 'active' | 'done' {
  const currentIdx = STATE_ORDER.indexOf(currentState);
  const stepIdx = STATE_ORDER.indexOf(stepKey);
  if (currentIdx < 0) return 'pending';
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

export default function AgentThinking({ currentState, language }: AgentThinkingProps) {
  const fr = language === 'fr';

  if (currentState === 'done' || currentState === 'error' || currentState === 'log') {
    return null;
  }

  const currentIdx = STATE_ORDER.indexOf(currentState);
  const progress = currentIdx >= 0 ? ((currentIdx + 1) / STEPS.length) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
      className="flex gap-3 items-start"
    >
      {/* Panda avatar with dramatic pulse */}
      <div className="relative">
        <MrLumeAvatar size="md" pulse />
        {/* Glow ring */}
        <motion.div
          className="absolute inset-0 rounded-xl border-2 border-text-primary/20"
          animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="flex-1 max-w-[85%]">
        {/* Header card */}
        <motion.div
          className="rounded-xl border border-outline-subtle bg-surface p-4 mb-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {/* Title */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-text-primary" />
              <span className="text-xs font-bold text-text-primary">
                {fr ? 'Mr Lume analyse...' : 'Mr Lume is analyzing...'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-text-tertiary tabular-nums">
              {Math.round(progress)}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1 rounded-full bg-surface-tertiary mb-4 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>

          {/* Steps timeline */}
          <div className="space-y-1.5">
            <AnimatePresence>
              {STEPS.map((step, i) => {
                const status = getStepStatus(step.key, currentState);

                // Hide scenario_engine step if we skipped it
                if (step.key === 'scenario_engine') {
                  const decideIdx = STATE_ORDER.indexOf('decide');
                  const scenarioIdx = STATE_ORDER.indexOf('scenario_engine');
                  const passedDecide = currentIdx >= 0 && currentIdx > decideIdx;
                  const inOrPastScenario = currentState === 'scenario_engine' || (currentIdx >= 0 && currentIdx > scenarioIdx);
                  if (passedDecide && !inOrPastScenario) return null;
                }

                return (
                  <motion.div
                    key={step.key}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.05 }}
                    className={`flex items-center gap-2.5 py-1 px-2 rounded-lg transition-colors ${
                      status === 'active' ? 'bg-surface-secondary' : ''
                    }`}
                  >
                    {/* Step indicator */}
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      status === 'active'
                        ? 'bg-primary text-white shadow-sm'
                        : status === 'done'
                          ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
                          : 'bg-surface-tertiary text-text-tertiary'
                    }`}>
                      {status === 'done' ? (
                        <CheckCircle2 size={11} />
                      ) : status === 'active' ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                        >
                          <step.icon size={10} />
                        </motion.div>
                      ) : (
                        <step.icon size={10} />
                      )}
                    </div>

                    {/* Step label */}
                    <span className={`text-[11px] transition-colors ${
                      status === 'active'
                        ? 'text-text-primary font-semibold'
                        : status === 'done'
                          ? 'text-text-tertiary'
                          : 'text-text-tertiary'
                    }`}>
                      {fr ? step.fr : step.en}
                    </span>

                    {/* Active dots */}
                    {status === 'active' && (
                      <div className="flex gap-0.5 ml-auto">
                        {[0, 1, 2].map(j => (
                          <motion.div
                            key={j}
                            className="w-1 h-1 rounded-full bg-primary"
                            animate={{ opacity: [0.2, 1, 0.2] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.15 }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Done checkmark */}
                    {status === 'done' && (
                      <motion.span
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-[10px] text-green-500 ml-auto"
                      >
                        ✓
                      </motion.span>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
