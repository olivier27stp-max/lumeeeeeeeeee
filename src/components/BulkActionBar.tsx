/* Bulk Action Bar — floating bar that appears when items are multi-selected
   Reusable across Leads, Jobs, Invoices, Clients.
*/

import React, { memo } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';

export interface BulkAction {
  id: string;
  label: string;
  icon: React.ElementType;
  variant?: 'default' | 'danger' | 'primary';
  loading?: boolean;
}

interface BulkActionBarProps {
  count: number;
  actions: BulkAction[];
  onAction: (actionId: string) => void;
  onClear: () => void;
  language: string;
}

function BulkActionBar({ count, actions, onAction, onClear, language }: BulkActionBarProps) {
  if (count === 0) return null;
  const fr = language === 'fr';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-2 bg-text-primary text-surface rounded-xl shadow-2xl px-4 py-2.5">
        {/* Count */}
        <span className="text-[13px] font-semibold tabular-nums mr-1">
          {count} {t.bulkActions.selected}{count > 1 ? 's' : ''}
        </span>

        {/* Divider */}
        <div className="w-px h-5 bg-surface/20" />

        {/* Actions */}
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => onAction(action.id)}
            disabled={action.loading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
              action.variant === 'danger'
                ? 'hover:bg-red-500/20 text-red-300'
                : action.variant === 'primary'
                  ? 'hover:bg-white/20 text-white'
                  : 'hover:bg-white/10 text-surface/80',
              action.loading && 'opacity-50 cursor-not-allowed',
            )}
          >
            <action.icon size={13} />
            {action.label}
          </button>
        ))}

        {/* Clear */}
        <div className="w-px h-5 bg-surface/20 ml-1" />
        <button
          onClick={onClear}
          className="p-1.5 rounded-lg hover:bg-white/10 text-surface/60 transition-colors"
          title={t.bulkActions.clearSelection}
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  );
}

export default memo(BulkActionBar);
