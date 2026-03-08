import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '../lib/utils';

export interface DashboardCardStat {
  label: string;
  value: string | number;
}

interface DashboardCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  stats?: DashboardCardStat[];
  to: string;
  badge?: string;
  className?: string;
}

export default function DashboardCard({ title, value, subtitle, stats = [], to, badge, className }: DashboardCardProps) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className={cn(
        'stat-card group w-full text-left transition-all hover:border-primary/30 hover:shadow-sm',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">{title}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-text-primary tabular-nums">{value}</p>
          {subtitle ? <p className="mt-0.5 text-[13px] text-text-secondary">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {badge ? (
            <span className="badge-neutral text-[10px] uppercase tracking-wider">
              {badge}
            </span>
          ) : null}
          <ArrowUpRight size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      {stats.length > 0 ? (
        <div className="mt-3 pt-3 border-t border-border space-y-1">
          {stats.map((stat) => (
            <div key={stat.label} className="flex items-center justify-between text-[13px]">
              <span className="text-text-secondary">{stat.label}</span>
              <span className="font-medium text-text-primary tabular-nums">{stat.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </button>
  );
}
