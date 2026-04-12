import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FilterBarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  className?: string;
}

export default function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  children,
  className,
}: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2.5', className)}>
      {onSearchChange && (
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={searchValue || ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="glass-input pl-9 pr-8 w-64"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ReactNode;
  className?: string;
}

export function FilterSelect({ value, onChange, options, icon, className }: FilterSelectProps) {
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-lg border border-outline bg-surface-card px-3 py-[7px] hover:border-outline-strong transition-colors',
      className
    )}>
      {icon && <span className="text-text-tertiary">{icon}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-[13px] font-medium text-text-primary focus:outline-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}

export function FilterChip({ label, active, onClick, count }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-[6px] text-[13px] font-medium transition-all',
        active
          ? 'border-primary bg-primary text-white shadow-sm'
          : 'border-outline bg-surface-card text-text-secondary hover:bg-surface-secondary hover:border-outline-strong'
      )}
    >
      {label}
      {count != null && (
        <span className={cn(
          'text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1 font-bold',
          active ? 'bg-white/20 text-white' : 'bg-surface-tertiary text-text-tertiary'
        )}>
          {count}
        </span>
      )}
    </button>
  );
}
