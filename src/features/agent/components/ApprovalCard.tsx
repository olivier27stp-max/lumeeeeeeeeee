import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ShieldCheck, X, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import MrLumeAvatar from './MrLumeAvatar';
import { agentApprove } from '../lib/agentApi';
import type { ApprovalRequest } from '../types';
import { useTranslation } from '../i18n';

interface ApprovalCardProps {
  data: ApprovalRequest;
  language: 'en' | 'fr';
  onResolved?: (decision: 'approve' | 'reject', result?: any) => void;
}

export default function ApprovalCard({ data, language, onResolved }: ApprovalCardProps) {
  const fr = language === 'fr';
  const [status, setStatus] = useState<'pending' | 'approving' | 'approved' | 'rejected'>('pending');
  const [result, setResult] = useState<string | null>(null);

  async function handleDecision(decision: 'approve' | 'reject') {
    const prevStatus = status;
    setStatus(decision === 'approve' ? 'approving' : 'rejected');

    try {
      const res = await agentApprove({ approvalId: data.approvalId, decision });

      if (decision === 'approve') {
        if (res.ok) {
          setStatus('approved');
          setResult(res.result?.summary || (t.agent.actionExecuted));
        } else {
          setStatus('pending'); // Revert — approval failed server-side
        }
      } else {
        // Rejection — verify server confirmed it
        if (!res.ok) {
          setStatus(prevStatus); // Revert if server rejected the rejection
        }
      }

      onResolved?.(decision, res);
    } catch {
      setStatus(prevStatus); // Revert on network error
    }
  }

  const isResolved = status === 'approved' || status === 'rejected';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-3 items-start"
    >
      <MrLumeAvatar size="sm" />

      <div className="flex-1 max-w-[85%]">
        <div className={`rounded-xl border p-4 transition-colors ${
          isResolved
            ? status === 'approved'
              ? 'border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-900/20'
              : 'border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/20'
            : 'border-outline-subtle bg-surface'
        }`}>
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={14} className="text-text-tertiary" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary">
              {t.agent.approvalRequired}
            </span>
          </div>

          {/* Action description */}
          <p className="text-xs text-text-secondary leading-relaxed mb-3">
            {data.description}
          </p>

          {/* Action details */}
          <div className="rounded-md bg-surface-secondary p-2.5 mb-3">
            <p className="text-[10px] font-medium text-text-tertiary mb-1">
              {t.agent.proposedAction}
            </p>
            <p className="text-xs font-medium text-text-primary">{data.actionType}</p>
            {data.expiresAt && (
              <p className="text-[10px] text-text-tertiary mt-1">
                {t.agent.expires}: {new Date(data.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
          </div>

          {/* Buttons or status */}
          {isResolved ? (
            <div className="flex items-center gap-2">
              {status === 'approved' ? (
                <>
                  <CheckCircle2 size={14} className="text-green-500" />
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">
                    {result || (t.agent.approved)}
                  </span>
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-red-400" />
                  <span className="text-xs font-medium text-red-500 dark:text-red-400">
                    {t.agent.rejected}
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDecision('approve')}
                disabled={status === 'approving'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-text-primary text-surface text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {status === 'approving' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={12} />
                )}
                {t.agent.approve}
              </button>
              <button
                onClick={() => handleDecision('reject')}
                disabled={status === 'approving'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-subtle text-text-secondary text-xs font-medium hover:border-outline hover:text-text-primary transition-all disabled:opacity-50"
              >
                <X size={12} />
                {t.agent.reject}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
