/* Quick Actions — floating action buttons for call/text/email
   Shows on client details, job details, lead drawer.
   One click = action (tel: link, SMS modal, email modal).
*/

import React, { memo } from 'react';
import { Phone, MessageSquare, Mail, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

interface QuickActionsProps {
  phone?: string | null;
  email?: string | null;
  className?: string;
  size?: 'sm' | 'md';
  onSms?: () => void;
  onEmail?: () => void;
}

function QuickActions({ phone, email, className, size = 'md', onSms, onEmail }: QuickActionsProps) {
  const iconSize = size === 'sm' ? 13 : 15;
  const btnClass = size === 'sm'
    ? 'p-1.5 rounded-lg'
    : 'p-2 rounded-lg';

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => {});
  };

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {phone && (
        <>
          <a
            href={`tel:${phone}`}
            className={cn(btnClass, 'text-text-tertiary hover:text-primary hover:bg-primary/10 transition-colors')}
            title={`Call ${phone}`}
          >
            <Phone size={iconSize} />
          </a>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (onSms) onSms();
              else copyToClipboard(phone, 'Phone');
            }}
            className={cn(btnClass, 'text-text-tertiary hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors')}
            title="SMS"
          >
            <MessageSquare size={iconSize} />
          </button>
        </>
      )}
      {email && (
        <a
          href={onEmail ? undefined : `mailto:${email}`}
          onClick={onEmail ? (e) => { e.preventDefault(); e.stopPropagation(); onEmail(); } : undefined}
          className={cn(btnClass, 'text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary dark:hover:bg-neutral-800/20 transition-colors')}
          title={`Email ${email}`}
        >
          <Mail size={iconSize} />
        </a>
      )}
      {(phone || email) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard(phone || email || '', phone ? 'Phone' : 'Email');
          }}
          className={cn(btnClass, 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors')}
          title="Copy"
        >
          <Copy size={iconSize} />
        </button>
      )}
    </div>
  );
}

export default memo(QuickActions);
