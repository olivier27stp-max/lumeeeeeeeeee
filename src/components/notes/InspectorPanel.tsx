/* Inspector Panel — right sidebar to edit selected node properties
   Positioning and pointer-events passthrough handled by parent in NoteCanvas.
*/

import React, { useState } from 'react';
import {
  X, AlignLeft, AlignCenter, AlignRight, Palette,
  Type, Lock, Unlock, Link2, RotateCw,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { STICKY_COLORS } from '../../types/noteBoard';
import type { NoteItem, EntityType } from '../../types/noteBoard';
import EntityBadge from './EntityBadge';
import { useTranslation } from '../i18n';

interface InspectorPanelProps {
  item: NoteItem | null;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<NoteItem>) => void;
  onLinkEntity: (itemId: string, entityType: EntityType, entityId: string) => void;
  onUnlinkEntity: (linkId: string) => void;
  language: string;
}

export default function InspectorPanel({ item, onClose, onUpdate, onLinkEntity, onUnlinkEntity, language }: InspectorPanelProps) {
  const [linkType, setLinkType] = useState<EntityType>('lead');
  const [linkId, setLinkId] = useState('');

  if (!item) return null;

  const handleLinkEntity = () => {
    if (!linkId.trim()) return;
    onLinkEntity(item.id, linkType, linkId.trim());
    setLinkId('');
  };

  return (
    <div className="w-64 bg-surface border border-outline rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-outline">
        <span className="text-[12px] font-semibold text-text-primary">
          {t.noteCanvas.properties}
        </span>
        <button onClick={onClose} className="p-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors">
          <X size={12} />
        </button>
      </div>

      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {/* Color */}
        {(item.item_type === 'sticky_note' || item.item_type === 'shape') && (
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 flex items-center gap-1">
              <Palette size={11} /> {t.advancedNotes.color}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {STICKY_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => onUpdate(item.id, { color: c.value })}
                  className={cn(
                    'w-5 h-5 rounded-full border transition-transform hover:scale-110',
                    item.color === c.value ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300',
                  )}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                />
              ))}
            </div>
          </div>
        )}

        {/* Font size */}
        {['sticky_note', 'text', 'shape'].includes(item.item_type) && (
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 flex items-center gap-1">
              <Type size={11} /> {t.noteCanvas.fontSize}
            </label>
            <input
              type="range"
              min={10}
              max={32}
              value={item.font_size}
              onChange={(e) => onUpdate(item.id, { font_size: Number(e.target.value) })}
              className="w-full accent-blue-500"
            />
            <span className="text-[10px] text-text-tertiary">{item.font_size}px</span>
          </div>
        )}

        {/* Text align */}
        {['sticky_note', 'text', 'shape'].includes(item.item_type) && (
          <div>
            <label className="text-[11px] font-medium text-text-secondary mb-1.5 block">
              {t.noteCanvas.textAlign}
            </label>
            <div className="flex gap-1">
              {[
                { value: 'left', icon: AlignLeft },
                { value: 'center', icon: AlignCenter },
                { value: 'right', icon: AlignRight },
              ].map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => onUpdate(item.id, { text_align: value as any })}
                  className={cn(
                    'p-1.5 rounded-md border transition-colors',
                    item.text_align === value
                      ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/20'
                      : 'border-outline text-text-tertiary hover:text-text-primary',
                  )}
                >
                  <Icon size={12} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Rotation */}
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1.5 flex items-center gap-1">
            <RotateCw size={11} /> {t.noteCanvas.rotation}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={360}
              value={item.rotation || 0}
              onChange={(e) => onUpdate(item.id, { rotation: Number(e.target.value) } as any)}
              className="w-full accent-blue-500"
            />
            <span className="text-[10px] text-text-tertiary min-w-[28px] text-right">{item.rotation || 0}°</span>
          </div>
        </div>

        {/* Lock toggle */}
        <div>
          <button
            onClick={() => onUpdate(item.id, { locked: !item.locked })}
            className={cn(
              'flex items-center gap-2 w-full px-3 py-1.5 rounded-md border text-[12px] transition-colors',
              item.locked
                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                : 'border-outline text-text-secondary hover:bg-surface-secondary',
            )}
          >
            {item.locked ? <Lock size={12} /> : <Unlock size={12} />}
            {item.locked ? (t.noteCanvas.locked) : (t.noteCanvas.unlocked)}
          </button>
        </div>

        {/* Entity links */}
        <div>
          <label className="text-[11px] font-medium text-text-secondary mb-1.5 flex items-center gap-1">
            <Link2 size={11} /> {t.noteCanvas.crmLinks}
          </label>
          {item.entity_links && item.entity_links.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {item.entity_links.map((link) => (
                <EntityBadge
                  key={link.id}
                  entityType={link.entity_type}
                  label={link.entity_label}
                  onRemove={() => onUnlinkEntity(link.id)}
                />
              ))}
            </div>
          )}
          <div className="flex gap-1">
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as EntityType)}
              className="input-field text-[11px] py-1 flex-1"
            >
              <option value="lead">Lead</option>
              <option value="client">Client</option>
              <option value="job">Job</option>
              <option value="invoice">Invoice</option>
            </select>
            <input
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              placeholder="Entity ID"
              className="input-field text-[11px] py-1 flex-1"
            />
            <button onClick={handleLinkEntity} className="btn-primary text-[10px] px-2 py-1">+</button>
          </div>
        </div>
      </div>
    </div>
  );
}
