import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import IconTile, { TileColor } from './IconTile';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: TileColor;
  trend?: { value: number; label?: string };
  onClick?: () => void;
  className?: string;
}

export default function StatCard({ label, value, subtitle, icon, iconColor = 'blue', trend, onClick, className }: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'stat-card text-left',
        onClick && 'cursor-pointer hover:border-primary transition-colors',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</p>
        {icon && <IconTile icon={icon} color={iconColor} size="sm" />}
      </div>
      <p className="text-2xl font-bold text-text-primary mt-2 tabular-nums">{value}</p>
      {(subtitle || trend) && (
        <div className="flex items-center gap-2 mt-1.5">
          {trend && (
            <span className={cn(
              'text-xs font-semibold',
              trend.value > 0 ? 'text-success' : trend.value < 0 ? 'text-danger' : 'text-text-tertiary'
            )}>
              {trend.value > 0 ? '+' : ''}{trend.value}%
            </span>
          )}
          {subtitle && <span className="text-xs text-text-tertiary">{subtitle}</span>}
        </div>
      )}
    </Comp>
  );
}
