import { cn } from '../../lib/utils';

type Status = 'new' | 'recall' | 'quote' | 'won' | 'lost';

interface StatusDotProps {
  status: Status;
  className?: string;
  pulse?: boolean;
}

const statusColors: Record<Status, string> = {
  new: 'bg-status-new',
  recall: 'bg-status-recall',
  quote: 'bg-status-quote',
  won: 'bg-status-won',
  lost: 'bg-status-lost',
};

const pulseColors: Record<Status, string> = {
  new: 'bg-status-new/40',
  recall: 'bg-status-recall/40',
  quote: 'bg-status-quote/40',
  won: 'bg-status-won/40',
  lost: 'bg-status-lost/40',
};

export function StatusDot({ status, className, pulse = false }: StatusDotProps) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <span
        className={cn('inline-block h-2 w-2 rounded-full', statusColors[status])}
      />
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
            pulseColors[status]
          )}
        />
      )}
    </span>
  );
}
