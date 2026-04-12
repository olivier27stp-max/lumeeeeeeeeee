import React from 'react';
import { Check, CheckCheck } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ChatItemData {
  id: string;
  name: string;
  avatar?: string;
  initials?: string;
  lastMessage: string;
  timestamp: string;
  unreadCount?: number;
  isOnline?: boolean;
  messageStatus?: 'sent' | 'delivered' | 'read';
}

interface ChatItemProps {
  chat: ChatItemData;
  isActive?: boolean;
  onClick?: () => void;
}

function StatusIcon({ status }: { status?: 'sent' | 'delivered' | 'read' }) {
  if (!status) return null;
  if (status === 'read') {
    return <CheckCheck size={14} className="text-emerald-500 shrink-0" />;
  }
  if (status === 'delivered') {
    return <CheckCheck size={14} className="text-gray-400 shrink-0" />;
  }
  return <Check size={14} className="text-gray-400 shrink-0" />;
}

export default function ChatItem({ chat, isActive, onClick }: ChatItemProps) {
  const hasUnread = (chat.unreadCount ?? 0) > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-[12px] transition-colors cursor-pointer text-left',
        isActive
          ? 'bg-gray-100'
          : 'bg-white hover:bg-gray-50'
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        {chat.avatar ? (
          <img
            src={chat.avatar}
            alt={chat.name}
            className="w-[40px] h-[40px] rounded-full object-cover"
          />
        ) : (
          <div className="w-[40px] h-[40px] rounded-full bg-gray-200 flex items-center justify-center text-[14px] font-semibold text-gray-600">
            {chat.initials || chat.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
        )}
        {/* Online indicator */}
        {chat.isOnline && (
          <div className="absolute bottom-0 right-0 w-[10px] h-[10px] rounded-full bg-emerald-500 border-[2px] border-white" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'text-[14px] truncate leading-tight',
              hasUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-900'
            )}
          >
            {chat.name}
          </span>
          <span className="text-[12px] text-gray-400 shrink-0 leading-tight">
            {chat.timestamp}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 mt-[3px]">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <StatusIcon status={chat.messageStatus} />
            <p
              className={cn(
                'text-[13px] truncate leading-tight',
                hasUnread ? 'text-gray-700 font-medium' : 'text-gray-500'
              )}
            >
              {chat.lastMessage}
            </p>
          </div>

          {hasUnread && (
            <span className="bg-emerald-500 text-white text-[11px] font-bold rounded-full min-w-[20px] h-[20px] flex items-center justify-center px-[6px] shrink-0">
              {chat.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
