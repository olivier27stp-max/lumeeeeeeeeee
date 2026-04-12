import React, { useEffect, useState } from 'react';
import { Mail, MessageSquare, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { fetchCommunications, type CommunicationMessage } from '../../lib/communicationsApi';
import StatusBadge from '../ui/StatusBadge';

interface CommunicationsTimelineProps {
  jobId?: string;
  clientId?: string;
  /** Increment to force re-fetch */
  refreshKey?: number;
}

export default function CommunicationsTimeline({ jobId, clientId, refreshKey }: CommunicationsTimelineProps) {
  const [messages, setMessages] = useState<CommunicationMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId && !clientId) { setLoading(false); return; }
    setLoading(true);
    fetchCommunications({ job_id: jobId, client_id: clientId, limit: 50 })
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [jobId, clientId, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-xl border border-outline bg-surface overflow-hidden">
        <div className="px-5 py-3.5 border-b border-outline-subtle">
          <h2 className="text-[13px] font-semibold text-text-primary">Communications</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="h-4 w-48 bg-surface-secondary rounded animate-pulse" />
          <div className="h-4 w-64 bg-surface-secondary rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline bg-surface overflow-hidden">
      <div className="px-5 py-3.5 border-b border-outline-subtle">
        <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
          <div className="icon-tile icon-tile-sm icon-tile-blue">
            <MessageSquare size={13} strokeWidth={2} />
          </div>
          Communications
          {messages.length > 0 && (
            <span className="text-[11px] font-bold text-text-tertiary bg-surface-tertiary rounded-full px-1.5 py-0.5">
              {messages.length}
            </span>
          )}
        </h2>
      </div>

      <div className="p-5">
        {messages.length === 0 ? (
          <p className="text-[13px] text-text-tertiary py-4 text-center">No communications yet</p>
        ) : (
          <div className="space-y-2.5">
            {messages.map((msg) => (
              <CommRow key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommRow({ message }: { message: CommunicationMessage; key?: string }) {
  const isInbound = message.direction === 'inbound';
  const isSms = message.channel_type === 'sms';
  const Icon = isSms ? MessageSquare : Mail;
  const DirectionIcon = isInbound ? ArrowDownLeft : ArrowUpRight;

  const preview = message.body_text
    ? message.body_text.length > 120
      ? message.body_text.slice(0, 120) + '…'
      : message.body_text
    : message.subject || '(no content)';

  const time = new Date(message.created_at);
  const timeStr = time.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
    + ' ' + time.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="rounded-lg border border-outline-subtle bg-surface-secondary p-3.5 flex items-start gap-3">
      {/* Icon */}
      <div className="icon-tile icon-tile-sm icon-tile-blue flex-shrink-0 mt-0.5">
        <Icon size={13} strokeWidth={2} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-semibold text-text-primary capitalize">
            {isSms ? 'SMS' : 'Email'}
          </span>
          <DirectionIcon size={11} className={cn('text-text-tertiary', isInbound && 'text-text-secondary')} />
          <span className="text-[11px] text-text-tertiary">
            {isInbound ? message.from_value : message.to_value}
          </span>
          <StatusBadge status={message.status} />
        </div>

        {message.subject && (
          <p className="text-[12px] font-medium text-text-secondary mt-0.5 truncate">{message.subject}</p>
        )}

        <p className="text-[12px] text-text-tertiary mt-0.5 line-clamp-2">{preview}</p>
      </div>

      {/* Timestamp */}
      <span className="text-[11px] text-text-tertiary whitespace-nowrap flex-shrink-0">
        {timeStr}
      </span>
    </div>
  );
}
