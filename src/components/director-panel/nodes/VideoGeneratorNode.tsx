import React, { useCallback } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import {
  Video,
  MoreHorizontal,
  Maximize2,
  Download,
  Settings,
  Play,
  Film,
  Loader2,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useFlowEditorStore } from '../../../lib/director-panel/store';
import { useTranslation } from '../../../i18n';

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

export interface VideoGeneratorNodeData {
  provider: string;
  model: string;
  duration: number;
  aspect_ratio: string;
  quality_preset: string;
  motion_strength: number;
  fps: number;
  previewUrl?: string;
  onChange?: (data: Record<string, unknown>) => void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Handle layout
// ---------------------------------------------------------------------------

const INPUT_HANDLES = [
  { id: 'prompt', label: 'Prompt*', required: true },
  { id: 'start_image', label: 'Start Image' },
  { id: 'reference_video', label: 'Ref Video' },
  { id: 'brand', label: 'Brand' },
  { id: 'campaign', label: 'Campaign' },
] as const;

const HANDLE_SPACING = 28;
const HANDLE_START_Y = 56;

// ---------------------------------------------------------------------------
// VideoGeneratorNode
// ---------------------------------------------------------------------------

const VideoGeneratorNodeComponent = ({ id, data, selected }: NodeProps) => {
  const nodeData = data as unknown as VideoGeneratorNodeData;
  const { updateNodeData } = useReactFlow();
  const { t } = useTranslation();

  const handleRun = useCallback(() => {
    import('sonner').then(({ toast }) => {
      toast.info(t.directorPanel.nodeRunButtonInfo);
    });
  }, [t]);

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
          <Video className={cn('h-4 w-4', isNodeRunning ? 'text-purple-400' : isNodeCompleted ? 'text-emerald-400' : 'text-[#c084fc]')} />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium leading-tight text-[#e0e0e0]">
              {nodeData.model || 'Video Generator'}
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
              <video
                src={nodeData.previewUrl}
                className="h-full w-full object-contain"
                controls
                muted
                loop
              />
              <div className="absolute top-2 right-2 opacity-0 group-hover/preview:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => updateNodeData(id, { previewUrl: undefined })}
                  className="px-2 py-0.5 rounded bg-black/60 text-[10px] font-medium text-white hover:bg-red-500/60 transition-colors"
                >
                  Clear
                </button>
              </div>
            </>
          ) : (
            <Film className="h-10 w-10 text-[#444]" />
          )}
        </div>
      </div>

      {/* ── Parameters bar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-[#393939] px-3 py-1.5">
        <span className="text-[11px] text-[#888]">
          {nodeData.duration ?? 5}s
        </span>
        <span className="text-[11px] text-[#888]">
          {nodeData.aspect_ratio ?? '16:9'}
        </span>
        <span className="text-[11px] text-[#888]">
          Motion {nodeData.motion_strength ?? 5}
        </span>
        <span className="text-[11px] text-[#888]">
          {nodeData.fps ?? 24} fps
        </span>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-[#393939] px-3 py-2">
        <span className="text-[11px] text-[#888]">
          {nodeData.quality_preset ?? 'standard'}
        </span>
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
        id="video"
        style={{ top: HANDLE_START_Y }}
        className="!h-[10px] !w-[10px] !rounded-full !border-none !bg-[#e879a0]"
      />
      <span
        className="pointer-events-none absolute right-4 text-[11px] text-[#888]"
        style={{ top: HANDLE_START_Y - 7 }}
      >
        Video
      </span>
    </div>
  );
};

const VideoGeneratorNode = React.memo(VideoGeneratorNodeComponent);
VideoGeneratorNode.displayName = 'VideoGeneratorNode';

export default VideoGeneratorNode;
