/* Canvas Toolbar — floating toolbar for adding items to the canvas
   Positioning and pointer-events passthrough handled by parent in NoteCanvas.
*/

import React, { useState } from 'react';
import {
  StickyNote, Type, CheckSquare, Image, FileUp, Link2,
  Square, Diamond, Circle, Triangle, Cloud,
  ZoomIn, ZoomOut, Maximize2,
  Lock, Unlock, Trash2, Copy, Palette, MousePointer2,
  MoveRight, Frame, Pen,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { STICKY_COLORS } from '../../types/noteBoard';
import type { NoteItemType, ShapeType } from '../../types/noteBoard';
import { useTranslation } from '../i18n';

export type ToolType = 'select' | 'connector' | 'draw' | NoteItemType;

interface CanvasToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  onAddItem: (type: NoteItemType, opts?: { shapeType?: ShapeType; color?: string }) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onToggleLock?: () => void;
  hasSelection: boolean;
  isLocked: boolean;
  language: string;
}

export default function CanvasToolbar({
  activeTool, onToolChange, onAddItem,
  onZoomIn, onZoomOut, onFitView,
  onDelete, onDuplicate, onToggleLock,
  hasSelection, isLocked, language,
}: CanvasToolbarProps) {
  const [showColors, setShowColors] = useState(false);
  const [showShapes, setShowShapes] = useState(false);

  const tools: { id: ToolType; icon: React.ElementType; label: string; labelFr: string }[] = [
    { id: 'select',      icon: MousePointer2, label: 'Select',    labelFr: 'Sélection' },
    { id: 'sticky_note', icon: StickyNote,    label: 'Sticky',    labelFr: 'Post-it' },
    { id: 'text',        icon: Type,          label: 'Text',      labelFr: 'Texte' },
    { id: 'checklist',   icon: CheckSquare,   label: 'Checklist', labelFr: 'Checklist' },
    { id: 'shape',       icon: Square,        label: 'Shape',     labelFr: 'Forme' },
    { id: 'connector',   icon: MoveRight,     label: 'Arrow',     labelFr: 'Flèche' },
    { id: 'frame',       icon: Frame,         label: 'Frame',     labelFr: 'Frame' },
    { id: 'draw',        icon: Pen,           label: 'Draw',      labelFr: 'Dessiner' },
    { id: 'image',       icon: Image,         label: 'Image',     labelFr: 'Image' },
    { id: 'file',        icon: FileUp,        label: 'File',      labelFr: 'Fichier' },
    { id: 'link',        icon: Link2,         label: 'Link',      labelFr: 'Lien' },
  ];

  const shapes: { type: ShapeType; icon: React.ElementType; label: string }[] = [
    { type: 'rectangle',   icon: Square,   label: 'Rectangle' },
    { type: 'ellipse',     icon: Circle,   label: 'Ellipse' },
    { type: 'diamond',     icon: Diamond,  label: 'Diamond' },
    { type: 'triangle',    icon: Triangle, label: 'Triangle' },
    { type: 'cloud',       icon: Cloud,    label: 'Cloud' },
  ];

  const closeMenus = () => { setShowShapes(false); setShowColors(false); };

  return (
    <div className="flex items-center gap-1">
      {/* Main tools */}
      <div className="flex items-center gap-0.5 bg-surface border border-outline rounded-xl shadow-lg px-1.5 py-1.5">
        {tools.map((tool) => (
          <div key={tool.id} className="relative">
            <button
              onClick={() => {
                if (tool.id === 'shape') {
                  setShowShapes(!showShapes);
                  setShowColors(false);
                } else if (tool.id === 'connector') {
                  closeMenus();
                  onToolChange(tool.id === activeTool ? 'select' : 'connector');
                } else if (tool.id === 'draw') {
                  closeMenus();
                  onToolChange(activeTool === 'draw' ? 'select' : 'draw');
                } else {
                  closeMenus();
                  onToolChange(tool.id);
                  if (tool.id !== 'select') {
                    onAddItem(tool.id as NoteItemType);
                    onToolChange('select');
                  }
                }
              }}
              className={cn(
                'p-2 rounded-lg transition-all text-text-tertiary hover:text-text-primary hover:bg-surface-secondary',
                activeTool === tool.id && 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
              )}
              title={language === 'fr' ? tool.labelFr : tool.label}
            >
              <tool.icon size={16} />
            </button>
            {/* Shape submenu */}
            {tool.id === 'shape' && showShapes && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-surface border border-outline rounded-lg shadow-lg p-1.5 flex gap-1">
                {shapes.map((s) => (
                  <button
                    key={s.type}
                    onClick={() => {
                      onAddItem('shape', { shapeType: s.type });
                      setShowShapes(false);
                      onToolChange('select');
                    }}
                    className="p-2 rounded-md hover:bg-surface-secondary text-text-tertiary hover:text-text-primary transition-colors"
                    title={s.label}
                  >
                    <s.icon size={16} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Divider */}
        <div className="w-px h-6 bg-outline mx-1" />

        {/* Color picker */}
        <div className="relative">
          <button
            onClick={() => { setShowColors(!showColors); setShowShapes(false); }}
            className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-all"
            title={t.advancedNotes.color}
          >
            <Palette size={16} />
          </button>
          {showColors && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-surface border border-outline rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1.5">
              {STICKY_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => {
                    onAddItem('sticky_note', { color: c.value });
                    setShowColors(false);
                    onToolChange('select');
                  }}
                  className="w-6 h-6 rounded-full border border-gray-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selection actions */}
      {hasSelection && (
        <div className="flex items-center gap-0.5 bg-surface border border-outline rounded-xl shadow-lg px-1.5 py-1.5">
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-all"
              title={t.invoiceDetails.duplicate}
            >
              <Copy size={16} />
            </button>
          )}
          <button
            onClick={onToggleLock}
            className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-all"
            title={isLocked ? 'Unlock' : 'Lock'}
          >
            {isLocked ? <Unlock size={16} /> : <Lock size={16} />}
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
            title={t.advancedNotes.delete}
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5 bg-surface border border-outline rounded-xl shadow-lg px-1.5 py-1.5">
        <button onClick={onZoomOut} className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-all" title="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button onClick={onZoomIn} className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-all" title="Zoom in">
          <ZoomIn size={16} />
        </button>
        <button onClick={onFitView} className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-all" title="Fit view">
          <Maximize2 size={16} />
        </button>
      </div>
    </div>
  );
}
