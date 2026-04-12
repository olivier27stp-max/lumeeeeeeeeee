import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';
import type { TileColor } from './IconTile';

interface EmptyStateProps {
  icon?: LucideIcon;
  /** @deprecated iconColor is ignored */
  iconColor?: TileColor;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="mb-4">
        <Icon size={28} strokeWidth={1.5} className="text-text-tertiary mx-auto" />
      </div>
      <p className="text-[15px] font-bold text-text-primary">{title}</p>
      {description && (
        <p className="text-[13px] text-text-tertiary mt-1.5 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
