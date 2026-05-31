import React, { useCallback } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import {
  ImagePlus,
  MoreHorizontal,
  Maximize2,
  Download,
  Settings,
  Play,
  ImageIcon,
  Loader2,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useFlowEditorStore } from '../../../lib/director-panel/store';
import { useTranslation } from '../../../i18n';

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

export interface ImageGeneratorNodeData {
  provider: string;
  model: string;
  aspect_ratio: string;
  quality_preset: string;
  num_outputs: number;
  seed: number;
  previewUrl?: string;
  onChange?: (data: Record<string, unknown>) => void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Handle layout helpers
// ---------------------------------------------------------------------------

const INPUT_HANDLES = [
  { id: 'prompt', label: 'Prompt*', required: true },
  { id: 'negative_prompt', label: 'Neg Prompt' },
  { id: 'reference_image', label: 'Ref Image' },
  { id: 'brand', label: 'Brand' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'product', label: 'Product' },
] as const;

const HANDLE_SPACING = 28;
const HANDLE_START_Y = 56;

// ---------------------------------------------------------------------------
// Aspect-ratio → resolution display
// ---------------------------------------------------------------------------

const RESOLUTION_MAP: Record<string, string> = {
  '1:1': '1024 x 1024',
  '16:9': '1344 x 768',
  '9:16': '768 x 1344',
  '4:3': '1152 x 896',
  '3:4': '896 x 1152',
  '3:2': '1216 x 832',
  '2:3': '832 x 1216',
  '21:9': '1536 x 640',
};

// ---------------------------------------------------------------------------
// ImageGeneratorNode
// ---------------------------------------------------------------------------

const ImageGeneratorNodeComponent = ({ id, data, selected }: NodeProps) => {
  const nodeData = data as unknown as ImageGeneratorNodeData;
  const { updateNodeData } = useReactFlow();
  const { t } = useTranslation();

  const handleRun = useCallback(() => {
    import('sonner').then(({ toast }) => {
      toast.info(t.directorPanel.nodeRunButtonInfo);
    });
  }, [t]);

  const resolution = RESOLUTION_MAP[nodeData.aspect_ratio] ?? '1024 x 1024';

  const nodeState = useFlowEditorStore((s) => s.runState.nodeStates[id]);
  const isNodeRunning = nodeState === 'running';
  const isNodeCompleted = nodeState === 'completed';

  return (
    <div
      className={cn(
        'relative w-[320px] rounded-xl border bg-[#2a2a2a] shadow-lg transition-all duration-300',
        selected ? 'border-[#c084fc] shadow-[0_0_12px_rgba(192,132,252,0.25)]' : 'border-[#444]',
        isNodeRunning && 'border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.4)] animate-pulse',
        isNodeCompleted && !isNodeRunning && 'border-emerald-500 shadow-[0_0_12px_rgba(34,197,94,0.2)]',
      )}
    >
      {isNodeRunning && (
        <div className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center shadow-lg animate-bounce">
          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
        </div>
      )}
      {isNodeCompleted && !isNodeRunning && (
        <div className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className={cn(
        'flex items-center justify-between border-b border-[#393939] px-3 py-2 transition-colors',
        isNodeRunning && 'bg-purple-500/10',
        isNodeCompleted && !isNodeRunning && 'bg-emerald-500/5',
      )}>
        <div className="flex items-center gap-2">
          <ImagePlus className={cn('h-4 w-4', isNodeRunning ? 'text-purple-400' : isNodeCompleted ? 'text-emerald-400' : 'text-[#c084fc]')} />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium leading-tight text-[#e0e0e0]">
              {nodeData.model || 'Image Generator'}
            </span>
            <span className="text-[11px] leading-tight text-[#888]">{nodeData.provider}</span>
          </div>
        </div>
        <button
          type="button"
          className="rounded p-0.5 text-[#888] transition-colors hover:bg-[#393939] hover:text-[#e0e0e0]"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* ── Action icons ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-[#393939] px-3 py-1.5">
        <button
          type="button"
          className="rounded p-1 text-[#888] transition-colors hover:bg-[#393939] hover:text-[#e0e0e0]"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-[#888] transition-colors hover:bg-[#393939] hover:text-[#e0e0e0]"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-[#888] transition-colors hover:bg-[#393939] hover:text-[#e0e0e0]"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Preview area ────────────────────────────────────────────────── */}
      <div className="px-3 py-2">
        <div className="relative flex h-[200px] items-center justify-center overflow-hidden rounded-lg bg-[#1e1e1e] group/preview">
          {nodeData.previewUrl ? (
            <>
              <img
                src={nodeData.previewUrl}
                alt="Generated preview"
                className="h-full w-full object-contain"
              />
              {/* Clear / Replace overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover/preview:bg-black/50 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover/preview:opacity-100">
                <button
                  type="button"
                  onClick={() => updateNodeData(id, { previewUrl: undefined })}
                  className="px-2.5 py-1 rounded-md bg-white/20 text-[10px] font-medium text-white hover:bg-red-500/60 transition-colors"
                >
                  Clear
                </button>
                <label className="px-2.5 py-1 rounded-md bg-white/20 text-[10px] font-medium text-white hover:bg-white/30 transition-colors cursor-pointer">
                  Replace
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const url = URL.createObjectURL(file);
                      updateNodeData(id, { previewUrl: url });
                    }}
                  />
                </label>
              </div>
            </>
          ) : (
            <ImageIcon className="h-10 w-10 text-[#444]" />
          )}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-[#393939] px-3 py-2">
        <span className="text-[11px] text-[#888]">{resolution}</span>
        <button
          type="button"
          onClick={handleRun}
          className="flex items-center gap-1.5 rounded-md bg-[#c084fc] px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-[#a855f7]"
        >
          <Play className="h-3 w-3" />
          Run Model
        </button>
      </div>

      {/* ── Input handles (left) ────────────────────────────────────────── */}
      {INPUT_HANDLES.map((h, i) => (
        <React.Fragment key={h.id}>
          <Handle
            type="target"
            position={Position.Left}
            id={h.id}
            style={{ top: HANDLE_START_Y + i * HANDLE_SPACING }}
            className="!h-[10px] !w-[10px] !rounded-full !border-none !bg-[#e879a0]"
          />
          <span
            className="pointer-events-none absolute left-4 text-[11px] text-[#888]"
            style={{ top: HANDLE_START_Y + i * HANDLE_SPACING - 7 }}
          >
            {h.label}
          </span>
        </React.Fragment>
      ))}

      {/* ── Output handle (right) ───────────────────────────────────────── */}
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{ top: HANDLE_START_Y }}
        className="!h-[10px] !w-[10px] !rounded-full !border-none !bg-[#e879a0]"
      />
      <span
        className="pointer-events-none absolute right-4 text-[11px] text-[#888]"
        style={{ top: HANDLE_START_Y - 7 }}
      >
        Image
      </span>
    </div>
  );
};

const ImageGeneratorNode = React.memo(ImageGeneratorNodeComponent);
ImageGeneratorNode.displayName = 'ImageGeneratorNode';

export default ImageGeneratorNode;
