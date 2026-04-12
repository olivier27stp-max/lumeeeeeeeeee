import React, { useState } from 'react';
import ChatTopbar from './ChatTopbar';
import ChatSidebar from './ChatSidebar';
import EmptyStateIllustration from './EmptyStateIllustration';

export default function ChatLayout() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();

  return (
    <div className="h-screen w-screen flex flex-col bg-surface-elevated overflow-hidden">
      {/* Top navbar */}
      <ChatTopbar onToggleSidebar={() => setSidebarVisible((v) => !v)} />

      {/* Body: sidebar + main */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebarVisible && (
          <ChatSidebar
            activeChatId={activeChatId}
            onChatSelect={(id) => setActiveChatId(id)}
          />
        )}

        {/* Main content — empty state */}
        <div className="flex-1 flex items-center justify-center bg-surface">
          <EmptyStateIllustration />
        </div>
      </div>
    </div>
  );
}
