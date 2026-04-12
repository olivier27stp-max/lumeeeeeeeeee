import React from 'react';
import { PanelLeft, Search, Bell, Moon, Settings } from 'lucide-react';

interface ChatTopbarProps {
  onToggleSidebar?: () => void;
}

export default function ChatTopbar({ onToggleSidebar }: ChatTopbarProps) {
  return (
    <div className="h-[56px] bg-[#F7F7F8] border-b border-[#E5E7EB] flex items-center justify-between px-4 shrink-0">
      {/* Left section */}
      <div className="flex items-center gap-3">
        {/* Sidebar toggle */}
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg hover:bg-gray-200/60 transition-colors"
        >
          <PanelLeft size={18} className="text-[#6B7280]" />
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-[#E5E7EB]" />

        {/* Search bar */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            placeholder="Search..."
            className="h-[34px] w-[240px] pl-9 pr-14 rounded-full bg-surface-secondary border-0 text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-border"
          />
          {/* ⌘ K badge */}
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <kbd className="h-[20px] min-w-[20px] px-1 rounded bg-surface border border-[#D1D5DB] text-[10px] font-medium text-[#9CA3AF] flex items-center justify-center shadow-[0_1px_0_rgba(0,0,0,0.05)]">
              ⌘
            </kbd>
            <kbd className="h-[20px] min-w-[16px] px-1 rounded bg-surface border border-[#D1D5DB] text-[10px] font-medium text-[#9CA3AF] flex items-center justify-center shadow-[0_1px_0_rgba(0,0,0,0.05)]">
              K
            </kbd>
          </div>
        </div>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        {/* Get Pro */}
        <button className="text-[13px] font-semibold text-text-primary hover:text-text-primary transition-colors px-2 py-1">
          Get Pro
        </button>

        {/* Notification bell */}
        <button className="relative p-2 rounded-lg hover:bg-gray-200/60 transition-colors">
          <Bell size={18} className="text-[#6B7280]" />
          {/* Red notification dot */}
          <div className="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full bg-red-500" />
        </button>

        {/* Theme toggle (moon) */}
        <button className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors">
          <Moon size={18} className="text-[#6B7280]" />
        </button>

        {/* Settings */}
        <button className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors">
          <Settings size={18} className="text-[#6B7280]" />
        </button>

        {/* Avatar */}
        <div className="ml-1 w-[32px] h-[32px] rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center overflow-hidden">
          <div className="w-full h-full bg-gray-300 rounded-full" />
        </div>
      </div>
    </div>
  );
}
