import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface StatCardProps {
  icon?: React.ReactNode;
  label: string;
  value: string | number;
  change?: { value: string; direction: 'up' | 'down' };
  subtitle?: string;
  className?: string;
}

export function StatCard({ icon, label, value, change, subtitle, className }: StatCardProps) {
  return (
    <div className={cn('stat-card', className)}>
      {icon && (
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary text-text-secondary dark:bg-[rgba(255,255,255,0.06)] dark:text-text-secondary">
          {icon}
        </div>
      )}
      <p className="text-xs font-medium text-text-tertiary">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-xl font-semibold text-text-primary tracking-tight">{value}</p>
        {change && (
          <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium', change.direction === 'up' ? 'text-success' : 'text-error')}>
            {change.direction === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {change.value}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
    </div>
  );
}
