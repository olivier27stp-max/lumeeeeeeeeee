/* Presence Bar — shows online users on the board as avatars */

import React, { memo } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../i18n';

export interface PresenceUser {
  userId: string;
  userName: string;
  color: string;
  isEditing?: string; // item ID being edited
}

interface PresenceBarProps {
  users: PresenceUser[];
  language: string;
}

function PresenceBar({ users, language }: PresenceBarProps) {
  if (users.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-text-tertiary mr-1">
        {users.length} {t.noteCanvas.online}
      </span>
      <div className="flex -space-x-1.5">
        {users.slice(0, 8).map((user) => (
          <div
            key={user.userId}
            className={cn(
              'w-6 h-6 rounded-full border-2 border-surface flex items-center justify-center text-[9px] font-bold text-white',
              user.isEditing && 'ring-2 ring-offset-1 ring-blue-400 animate-pulse',
            )}
            style={{ backgroundColor: user.color }}
            title={`${user.userName}${user.isEditing ? (t.noteCanvas.editing) : ''}`}
          >
            {user.userName.charAt(0).toUpperCase()}
          </div>
        ))}
        {users.length > 8 && (
          <div className="w-6 h-6 rounded-full border-2 border-surface bg-gray-400 flex items-center justify-center text-[9px] font-bold text-white">
            +{users.length - 8}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(PresenceBar);
