/* Custom React Flow Node — Link Preview */

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Link2, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface LinkNodeData {
  linkUrl: string;
  linkTitle: string | null;
  linkPreview: string | null;
  content: string;
  locked: boolean;
  itemId: string;
  connectMode?: boolean;
}

function LinkNode({ data, selected }: NodeProps & { data: LinkNodeData }) {
  const showHandles = selected || data.connectMode;
  const handleClass = cn(
    '!border-2 !border-white !rounded-full transition-all',
    showHandles
      ? '!w-3.5 !h-3.5 !bg-blue-500 !opacity-100 hover:!bg-blue-600 hover:!scale-125'
      : '!w-2 !h-2 !bg-gray-400 !opacity-0 hover:!opacity-100',
  );
  let hostname = '';
  try {
    hostname = new URL(data.linkUrl).hostname;
  } catch {
    hostname = data.linkUrl;
  }

  return (
    <div
      className={cn(
        'rounded-lg shadow-md overflow-hidden bg-surface border border-outline min-w-[200px] max-w-[280px] transition-shadow',
        selected && 'ring-2 ring-blue-500 shadow-lg',
      )}
    >
      <Handle type="target" position={Position.Top} className={handleClass} />
      <Handle type="source" position={Position.Bottom} className={handleClass} />

      <div className="p-3">
        <div className="flex items-start gap-2">
          <Link2 size={14} className="text-text-secondary shrink-0 mt-1.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-text-primary truncate">
              {data.linkTitle || data.linkUrl}
            </p>
            {data.linkPreview && (
              <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-2">{data.linkPreview}</p>
            )}
            <a
              href={data.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="nodrag inline-flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary mt-1"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ExternalLink size={10} />
              {hostname}
            </a>
          </div>
        </div>
        {data.content && (
          <p className="text-[11px] text-text-tertiary mt-2 border-t border-outline pt-2">{data.content}</p>
        )}
      </div>
    </div>
  );
}

export default memo(LinkNode);
