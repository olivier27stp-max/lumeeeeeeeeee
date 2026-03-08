import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';
import IconTile, { TileColor } from './IconTile';

interface EmptyStateProps {
  icon?: LucideIcon;
  iconColor?: TileColor;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon: Icon = Inbox, iconColor = 'blue', title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <IconTile icon={Icon} color={iconColor} size="lg" className="mb-4" />
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      {description && (
        <p className="text-[13px] text-text-tertiary mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
