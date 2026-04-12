/* Entity Badge — shows linked CRM entities on canvas nodes */

import React from 'react';
import { Contact, Users, Briefcase, FileText, CreditCard, UserCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { EntityType } from '../../types/noteBoard';

const entityMeta: Record<EntityType, { icon: React.ElementType; label: string; className: string }> = {
  lead:        { icon: Contact,      label: 'Lead',        className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  client:      { icon: Users,        label: 'Client',      className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  job:         { icon: Briefcase,    label: 'Job',         className: 'bg-surface-secondary text-text-secondary' },
  invoice:     { icon: FileText,     label: 'Invoice',     className: 'bg-surface-secondary text-text-secondary' },
  payment:     { icon: CreditCard,   label: 'Payment',     className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  team_member: { icon: UserCircle2,  label: 'Team Member', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
};

interface EntityBadgeProps {
  key?: React.Key;
  entityType: EntityType;
  label?: string;
  onRemove?: () => void;
}

export default function EntityBadge({ entityType, label, onRemove }: EntityBadgeProps) {
  const meta = entityMeta[entityType];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', meta.className)}>
      <Icon size={10} />
      {label || meta.label}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 hover:opacity-70">&times;</button>
      )}
    </span>
  );
}
