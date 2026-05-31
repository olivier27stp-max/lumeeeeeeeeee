/* Custom React Flow Node — Checklist

   All interactive elements (inputs, buttons) use nodrag + stopPropagation
   to prevent React Flow from capturing those events.
*/

import React, { useState, memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { CheckSquare, Square, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ChecklistItem } from '../../types/noteBoard';

export interface ChecklistNodeData {
  content: string;
  color: string;
  locked: boolean;
  itemId: string;
  connectMode?: boolean;
  checklist: ChecklistItem[];
  onChecklistChange?: (id: string, checklist: ChecklistItem[]) => void;
  onContentChange?: (id: string, content: string) => void;
}

function ChecklistNode({ data, selected }: NodeProps & { data: ChecklistNodeData }) {
  const [newItem, setNewItem] = useState('');
  const items = data.checklist || [];

  const toggle = (itemId: string) => {
    if (data.locked) return;
    const updated = items.map((i) => i.id === itemId ? { ...i, checked: !i.checked } : i);
    data.onChecklistChange?.(data.itemId, updated);
  };

  const addItem = () => {
    if (!newItem.trim() || data.locked) return;
    const updated = [...items, { id: crypto.randomUUID(), text: newItem.trim(), checked: false }];
    data.onChecklistChange?.(data.itemId, updated);
    setNewItem('');
  };

  const removeItem = (itemId: string) => {
    if (data.locked) return;
    data.onChecklistChange?.(data.itemId, items.filter((i) => i.id !== itemId));
  };

  const done = items.filter((i) => i.checked).length;
  const total = items.length;

  // Stop propagation helper for interactive elements inside the node
  const stopDrag = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  const showHandles = selected || data.connectMode;
  const handleCn = cn(
    '!border-2 !border-white !rounded-full transition-all',
    showHandles
      ? '!w-3.5 !h-3.5 !bg-blue-500 !opacity-100 hover:!bg-blue-600 hover:!scale-125'
      : '!w-2.5 !h-2.5 !bg-gray-400 !opacity-0 hover:!opacity-100',
  );

  return (
    <>
    <NodeResizer
      isVisible={selected && !data.locked}
      minWidth={180}
      minHeight={100}
      lineClassName="!border-blue-400"
      handleClassName="!w-2.5 !h-2.5 !bg-white !border-2 !border-blue-500 !rounded-sm"
    />
    <div
      className={cn(
        'rounded-lg shadow-md min-w-[180px] bg-surface border border-outline transition-shadow',
        selected && 'shadow-lg',
      )}
      style={{ backgroundColor: data.color || undefined, width: '100%', height: '100%' }}
    >
      <Handle type="target" position={Position.Top} className={handleCn} />
      <Handle type="source" position={Position.Bottom} className={handleCn} />

      {/* Title */}
      <div className="px-3 pt-3 pb-1 border-b border-outline/50">
        <input
          value={data.content}
          onChange={(e) => data.onContentChange?.(data.itemId, e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={stopDrag}
          onMouseDown={stopDrag}
          disabled={data.locked}
          className="nodrag nowheel w-full bg-transparent text-[13px] font-semibold text-text-primary outline-none"
          placeholder="Checklist title..."
        />
        {total > 0 && (
          <div className="flex items-center gap-2 mt-1 mb-1">
            <div className="flex-1 h-1 rounded-full bg-outline overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-text-tertiary font-medium">{done}/{total}</span>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="nodrag nowheel px-3 py-2 space-y-1 max-h-[200px] overflow-y-auto" onPointerDown={stopDrag}>
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 group/item">
            <button
              onClick={() => toggle(item.id)}
              onPointerDown={stopDrag}
              className="shrink-0 text-text-tertiary hover:text-text-primary"
            >
              {item.checked ? <CheckSquare size={14} className="text-green-500" /> : <Square size={14} />}
            </button>
            <span className={cn('text-[12px] flex-1', item.checked && 'line-through text-text-tertiary')}>
              {item.text}
            </span>
            {!data.locked && (
              <button
                onClick={() => removeItem(item.id)}
                onPointerDown={stopDrag}
                className="opacity-0 group-hover/item:opacity-100 text-text-tertiary hover:text-red-500 transition-opacity"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add item */}
      {!data.locked && (
        <div className="px-3 pb-2 flex items-center gap-1">
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addItem();
              e.stopPropagation();
            }}
            onPointerDown={stopDrag}
            onMouseDown={stopDrag}
            placeholder="Ajouter un élément..."
            className="nodrag nowheel flex-1 text-[12px] bg-transparent border-none outline-none text-text-secondary placeholder:text-text-tertiary"
          />
          <button onClick={addItem} onPointerDown={stopDrag} className="text-text-tertiary hover:text-text-primary">
            <Plus size={12} />
          </button>
        </div>
      )}
    </div>
    </>
  );
}

export default memo(ChecklistNode);
