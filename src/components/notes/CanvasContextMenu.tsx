/* Canvas Context Menu — right-click menu for the canvas and nodes */

import React, { useEffect, useRef } from 'react';
import {
  Copy, Trash2, Lock, Unlock, Layers, ArrowUp, ArrowDown,
  StickyNote, Type, CheckSquare, Square, Image, Link2, Frame,
  Scissors, ClipboardPaste, MoveRight,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../i18n';

export interface ContextMenuAction {
  id: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  danger?: boolean;
  dividerBefore?: boolean;
  disabled?: boolean;
}

interface CanvasContextMenuProps {
  x: number;
  y: number;
  isNodeMenu: boolean;
  isLocked: boolean;
  language: string;
  onAction: (actionId: string) => void;
  onClose: () => void;
}

export default function CanvasContextMenu({
  x, y, isNodeMenu, isLocked, language, onAction, onClose,
}: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const fr = language === 'fr';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 400);

  const nodeActions: ContextMenuAction[] = [
    { id: 'duplicate', label: t.invoiceDetails.duplicate, icon: Copy, shortcut: 'Ctrl+D' },
    { id: 'cut', label: t.noteCanvas.cut, icon: Scissors, shortcut: 'Ctrl+X' },
    { id: 'copy', label: t.noteCanvas.copy, icon: Copy, shortcut: 'Ctrl+C' },
    { id: 'lock', label: isLocked ? (t.noteCanvas.unlock) : (t.noteCanvas.lock), icon: isLocked ? Unlock : Lock, dividerBefore: true },
    { id: 'bring-front', label: t.noteCanvas.bringToFront, icon: ArrowUp, dividerBefore: true },
    { id: 'send-back', label: t.noteCanvas.sendToBack, icon: ArrowDown },
    { id: 'connect', label: t.noteCanvas.connect, icon: MoveRight, dividerBefore: true },
    { id: 'delete', label: t.advancedNotes.delete, icon: Trash2, shortcut: 'Del', danger: true, dividerBefore: true },
  ];

  const canvasActions: ContextMenuAction[] = [
    { id: 'paste', label: t.noteCanvas.paste, icon: ClipboardPaste, shortcut: 'Ctrl+V' },
    { id: 'add-sticky', label: t.noteCanvas.stickyNote, icon: StickyNote, dividerBefore: true },
    { id: 'add-text', label: t.noteCanvas.text, icon: Type },
    { id: 'add-checklist', label: 'Checklist', icon: CheckSquare },
    { id: 'add-shape', label: t.noteCanvas.shape, icon: Square },
    { id: 'add-frame', label: 'Frame', icon: Frame },
    { id: 'add-image', label: 'Image', icon: Image },
    { id: 'add-link', label: t.invoiceDetails.link, icon: Link2 },
    { id: 'select-all', label: t.noteCanvas.selectAll, icon: Layers, shortcut: 'Ctrl+A', dividerBefore: true },
  ];

  const actions = isNodeMenu ? nodeActions : canvasActions;

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-surface border border-outline rounded-xl shadow-xl py-1 min-w-[200px] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {actions.map((action) => (
        <React.Fragment key={action.id}>
          {action.dividerBefore && <div className="h-px bg-outline my-1 mx-2" />}
          <button
            onClick={() => {
              onAction(action.id);
              onClose();
            }}
            disabled={action.disabled}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-1.5 text-[13px] transition-colors',
              action.danger
                ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                : 'text-text-primary hover:bg-surface-secondary',
              action.disabled && 'opacity-40 cursor-not-allowed',
            )}
          >
            <action.icon size={14} className={action.danger ? 'text-red-400' : 'text-text-tertiary'} />
            <span className="flex-1 text-left">{action.label}</span>
            {action.shortcut && (
              <span className="text-[11px] text-text-tertiary">{action.shortcut}</span>
            )}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
