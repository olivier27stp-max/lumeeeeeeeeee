import React, { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import ChatItem, { type ChatItemData } from './ChatItem';

// TODO: Replace with real chat data from Supabase
const MOCK_CHATS: ChatItemData[] = [];

interface ChatSidebarProps {
  activeChatId?: string;
  onChatSelect?: (chatId: string) => void;
}

export default function ChatSidebar({ activeChatId, onChatSelect }: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChats = MOCK_CHATS.filter((chat) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      chat.name.toLowerCase().includes(q) ||
      chat.lastMessage.toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-[300px] border-r border-[#E5E7EB] flex flex-col bg-white shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="text-[20px] font-bold text-text-primary">Chats</h2>
        <button className="w-[30px] h-[30px] rounded-full border border-[#E5E7EB] flex items-center justify-center hover:bg-gray-50 transition-colors">
          <Plus size={16} className="text-[#6B7280]" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Chats search..."
            className="w-full h-[36px] pl-9 pr-3 rounded-lg bg-surface-secondary border-0 text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-border"
          />
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.map((chat) => (
          <ChatItem
            key={chat.id}
            chat={chat}
            isActive={activeChatId === chat.id}
            onClick={() => onChatSelect?.(chat.id)}
          />
        ))}
      </div>
    </div>
  );
}
