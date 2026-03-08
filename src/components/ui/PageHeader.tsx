import React from 'react';
import { LucideIcon } from 'lucide-react';
import IconTile, { TileColor } from './IconTile';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: TileColor;
  children?: React.ReactNode;
}

export default function PageHeader({ title, subtitle, icon, iconColor = 'blue', children }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="flex items-center gap-3 min-w-0">
        {icon && <IconTile icon={icon} color={iconColor} size="lg" />}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-text-primary truncate">{title}</h1>
          {subtitle && (
            <p className="text-[13px] text-text-tertiary mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {children && (
        <div className="flex items-center gap-2 shrink-0">
          {children}
        </div>
      )}
    </div>
  );
}
