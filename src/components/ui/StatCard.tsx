import React from 'react';
import { cn } from '../../lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: any;
  iconColor?: string;
  trend?: { value: number; label?: string };
  onClick?: () => void;
  className?: string;
}

export default function StatCard({ label, value, subtitle, trend, onClick, className }: StatCardProps) {
  const Comp = onClick ? 'button' : 'div';

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'text-left transition-colors',
        onClick && 'cursor-pointer group',
        className
      )}
    >
      <p className="text-[13px] text-text-tertiary leading-none">{label}</p>
      <p className="text-[22px] font-semibold text-text-primary mt-1.5 tabular-nums tracking-tight leading-none group-hover:text-primary transition-colors">{value}</p>
      {(subtitle || trend) && (
        <div className="flex items-center gap-1.5 mt-2">
          {trend && (
            <span className={cn(
              'text-[11px] font-medium',
              trend.value > 0 ? 'text-emerald-600' : trend.value < 0 ? 'text-red-600' : 'text-text-tertiary'
            )}>
              {trend.value > 0 ? '+' : ''}{trend.value}%
            </span>
          )}
          {subtitle && <span className="text-[12px] text-text-muted">{subtitle}</span>}
        </div>
      )}
    </Comp>
  );
}
