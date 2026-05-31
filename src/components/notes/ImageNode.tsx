/* Custom React Flow Node — Image / File / PDF
   - Images: render the actual photo filling the node
   - PDFs: render an embedded iframe preview
   - Other files: render a file card with icon, name, size, download
   - NodeResizer for resizing
*/

import React, { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { FileIcon, Download, ExternalLink, FileText } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ImageNodeData {
  content: string;
  fileUrl: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  locked: boolean;
  itemId: string;
  isFile?: boolean;
  connectMode?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageNode({ data, selected }: NodeProps & { data: ImageNodeData }) {
  const isImage = data.fileType?.startsWith('image/') && !data.isFile;
  const isPdf = data.fileType === 'application/pdf' || data.fileName?.toLowerCase().endsWith('.pdf');

  const showHandles = selected || data.connectMode;
  const handleClass = cn(
    '!border-2 !border-white !rounded-full transition-all',
    showHandles
      ? '!w-3.5 !h-3.5 !bg-blue-500 !opacity-100 hover:!bg-blue-600 hover:!scale-125'
      : '!w-2 !h-2 !bg-gray-400 !opacity-0 hover:!opacity-100',
  );

  // ── Image: render the actual photo ──
  if (isImage && data.fileUrl) {
    return (
      <>
        <NodeResizer
          isVisible={selected && !data.locked}
          minWidth={100}
          minHeight={80}
          lineClassName="!border-blue-400"
          handleClassName="!w-2.5 !h-2.5 !bg-white !border-2 !border-blue-500 !rounded-sm"
        />
        <div
          className={cn(
            'rounded-lg shadow-md overflow-hidden bg-surface border border-outline transition-shadow w-full h-full',
            selected && 'ring-2 ring-blue-500 shadow-lg',
          )}
        >
          <Handle type="target" position={Position.Top} className={handleClass} />
          <Handle type="source" position={Position.Bottom} className={handleClass} />
          <Handle type="target" position={Position.Left} className={handleClass} id="left" />
          <Handle type="source" position={Position.Right} className={handleClass} id="right" />

          <div className="relative group w-full h-full">
            <img
              src={data.fileUrl}
              alt={data.fileName || 'Image'}
              className="w-full h-full object-cover"
              draggable={false}
            />
            {/* Overlay with open + filename on hover */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex flex-col items-center justify-center pointer-events-none">
              <a
                href={data.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pointer-events-auto opacity-0 group-hover:opacity-100 p-2.5 bg-white/90 rounded-full transition-opacity shadow-md"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} className="text-gray-700" />
              </a>
              {data.fileName && (
                <span className="opacity-0 group-hover:opacity-100 transition-opacity mt-2 px-2 py-0.5 bg-black/60 text-white text-[10px] rounded max-w-[90%] truncate">
                  {data.fileName}
                </span>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── PDF: render embedded iframe preview ──
  if (isPdf && data.fileUrl) {
    return (
      <>
        <NodeResizer
          isVisible={selected && !data.locked}
          minWidth={200}
          minHeight={200}
          lineClassName="!border-blue-400"
          handleClassName="!w-2.5 !h-2.5 !bg-white !border-2 !border-blue-500 !rounded-sm"
        />
        <div
          className={cn(
            'rounded-lg shadow-md overflow-hidden bg-surface border border-outline transition-shadow w-full h-full flex flex-col',
            selected && 'ring-2 ring-blue-500 shadow-lg',
          )}
        >
          <Handle type="target" position={Position.Top} className={handleClass} />
          <Handle type="source" position={Position.Bottom} className={handleClass} />
          <Handle type="target" position={Position.Left} className={handleClass} id="left" />
          <Handle type="source" position={Position.Right} className={handleClass} id="right" />

          {/* PDF header bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 border-b border-outline shrink-0">
            <FileText size={14} className="text-red-500 shrink-0" />
            <span className="text-[11px] font-medium text-text-primary truncate flex-1">
              {data.fileName || 'Document.pdf'}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {data.fileSize != null && (
                <span className="text-[10px] text-text-tertiary">{formatBytes(data.fileSize)}</span>
              )}
              <a
                href={data.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="nodrag p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                title="Ouvrir dans un nouvel onglet"
              >
                <ExternalLink size={12} />
              </a>
              <a
                href={data.fileUrl}
                download
                className="nodrag p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                title="Télécharger"
              >
                <Download size={12} />
              </a>
            </div>
          </div>

          {/* PDF iframe */}
          <div className="flex-1 min-h-0">
            <iframe
              src={`${data.fileUrl}#toolbar=0&navpanes=0`}
              className="nodrag nowheel w-full h-full border-0 bg-white"
              title={data.fileName || 'PDF preview'}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      </>
    );
  }

  // ── Other files: file card with icon ──
  return (
    <>
      <NodeResizer
        isVisible={selected && !data.locked}
        minWidth={180}
        minHeight={60}
        lineClassName="!border-blue-400"
        handleClassName="!w-2.5 !h-2.5 !bg-white !border-2 !border-blue-500 !rounded-sm"
      />
      <div
        className={cn(
          'rounded-lg shadow-md overflow-hidden bg-surface border border-outline min-w-[180px] transition-shadow w-full h-full',
          selected && 'ring-2 ring-blue-500 shadow-lg',
        )}
      >
        <Handle type="target" position={Position.Top} className={handleClass} />
        <Handle type="source" position={Position.Bottom} className={handleClass} />
        <Handle type="target" position={Position.Left} className={handleClass} id="left" />
        <Handle type="source" position={Position.Right} className={handleClass} id="right" />

        <div className="p-4 flex items-center gap-3 h-full">
          <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center shrink-0">
            <FileIcon size={18} className="text-text-tertiary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-text-primary truncate">{data.fileName || 'File'}</p>
            {data.fileSize != null && (
              <p className="text-[11px] text-text-tertiary">{formatBytes(data.fileSize)}</p>
            )}
          </div>
          {data.fileUrl && (
            <div className="flex items-center gap-1 shrink-0">
              <a
                href={data.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="nodrag p-1.5 text-text-tertiary hover:text-text-primary rounded hover:bg-surface-secondary transition-colors"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                title="Open"
              >
                <ExternalLink size={14} />
              </a>
              <a
                href={data.fileUrl}
                download
                className="nodrag p-1.5 text-text-tertiary hover:text-text-primary rounded hover:bg-surface-secondary transition-colors"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                title="Télécharger"
              >
                <Download size={14} />
              </a>
            </div>
          )}
        </div>

        {data.content && (
          <div className="px-3 py-2 border-t border-outline">
            <p className="text-[11px] text-text-tertiary">{data.content}</p>
          </div>
        )}
      </div>
    </>
  );
}

export default memo(ImageNode);
