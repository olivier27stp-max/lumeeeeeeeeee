/**
 * HomeCard — shared shell for the Home page widgets.
 * Gives every widget one consistent frame: icon + title (+ optional subtitle)
 * on the left, an optional "see all →" action on the right, then the body.
 * Matches the app card language: bg-surface-card / border-border / rounded-xl.
 */
import type { ReactNode } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';

type HomeCardProps = {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export default function HomeCard({
  icon: Icon,
  title,
  subtitle,
  action,
  className = '',
  bodyClassName = '',
  children,
}: HomeCardProps) {
  return (
    <div className={`bg-surface-card border border-border rounded-xl p-5 flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={16} className="text-text-secondary shrink-0" />}
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold text-text-primary leading-tight truncate">{title}</h3>
          {subtitle && <p className="text-[12px] text-text-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
        {action && (
          <button
            onClick={action.onClick}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-text-muted hover:text-text-primary transition-colors shrink-0"
          >
            {action.label}
            <ArrowRight size={13} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
    </div>
  );
}
