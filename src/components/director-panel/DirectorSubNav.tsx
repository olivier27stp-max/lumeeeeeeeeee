import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Workflow, Layout, FolderOpen, History, Settings, Palette, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';

const NAV_ITEMS = [
  { path: '/director-panel', label: 'Home', icon: Home, exact: true },
  { path: '/director-panel/flows', label: 'Flows', icon: Workflow },
  { path: '/director-panel/templates', label: 'Templates', icon: Layout },
  { path: '/director-panel/assets', label: 'Assets', icon: FolderOpen },
  { path: '/director-panel/runs', label: 'Runs', icon: History },
  { path: '/director-panel/styles', label: 'Styles', icon: Palette },
  { path: '/director-panel/training', label: 'Training', icon: Zap },
  { path: '/director-panel/settings', label: 'Settings', icon: Settings },
];

export default function DirectorSubNav() {
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show subnav on the flow editor page (fullscreen)
  if (location.pathname.includes('/flows/')) return null;

  return (
    <div className="flex items-center gap-1 mb-5 px-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
      {NAV_ITEMS.map((item) => {
        const isActive = item.exact
          ? location.pathname === item.path
          : location.pathname.startsWith(item.path);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors',
              isActive
                ? 'bg-primary text-white'
                : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary',
            )}
          >
            <item.icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
