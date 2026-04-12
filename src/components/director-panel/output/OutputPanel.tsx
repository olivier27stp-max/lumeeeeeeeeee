import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Info,
  AlertTriangle,
  XCircle,
  Loader2,
  CheckCircle2,
  Circle,
  Save,
  FolderOpen,
  Link,
  Coins,
  ImageIcon,
  Film,
  X,
  Download,
  Copy,
  ExternalLink,
  Send,
  Bot,
  Sparkles,
} from 'lucide-react';
import { useFlowEditorStore } from '../../../lib/director-panel/store';
import { cn } from '../../../lib/utils';
import { streamMessageToAI, analyzeImageWithVision } from '../../../lib/aiApi';
import { trackUsageEvent } from '../../../lib/directorApi';
import { MODEL_CATALOG } from '../../../lib/director-panel/config/model-catalog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLAPSED_HEIGHT = 40;
const EXPANDED_HEIGHT = 380;

const TAB_ITEMS = [
  { key: 'logs', label: 'Logs' },
  { key: 'outputs', label: 'Outputs' },
  { key: 'costs', label: 'Costs' },
  { key: 'chat', label: 'LIA' },
] as const;

// ---------------------------------------------------------------------------
// Run status indicator
// ---------------------------------------------------------------------------

function RunStatusIndicator({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return (
        <div className="flex items-center gap-1.5 text-[12px] text-blue-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Running</span>
        </div>
      );
    case 'completed':
      return (
        <div className="flex items-center gap-1.5 text-[12px] text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Completed</span>
        </div>
      );
    case 'failed':
      return (
        <div className="flex items-center gap-1.5 text-[12px] text-red-400">
          <XCircle className="h-3.5 w-3.5" />
          <span>Failed</span>
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-1.5 text-[12px] text-[#666]">
          <Circle className="h-3.5 w-3.5" />
          <span>Idle</span>
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Logs tab
// ---------------------------------------------------------------------------

function LogsTab() {
  const logs = useFlowEditorStore((s) => s.runState.logs);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build a quick lookup for node names
  const nodeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.title);
    return map;
  }, [nodes]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  if (logs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[#555]">
        Run a flow to see logs
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-3 py-2">
      {logs.map((entry, i) => {
        const levelConfig = {
          info: { icon: Info, color: 'text-blue-400' },
          warn: { icon: AlertTriangle, color: 'text-amber-400' },
          error: { icon: XCircle, color: 'text-red-400' },
        }[entry.level] ?? { icon: Info, color: 'text-blue-400' };

        const LevelIcon = levelConfig.icon;
        const nodeName = entry.nodeId ? nodeNameMap.get(entry.nodeId) : undefined;

        return (
          <div
            key={i}
            className="flex items-start gap-2 border-b border-[#222] py-1.5 last:border-0"
          >
            <LevelIcon className={cn('mt-0.5 h-3 w-3 shrink-0', levelConfig.color)} />
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#555]">
              {formatTimestamp(entry.timestamp)}
            </span>
            {nodeName && (
              <span className="shrink-0 rounded bg-[#2a2a2a] px-1 py-0.5 text-[10px] font-medium text-purple-400">
                {nodeName}
              </span>
            )}
            <span className="min-w-0 flex-1 break-words font-mono text-[12px] text-[#ccc]">
              {entry.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ---------------------------------------------------------------------------
// Outputs tab
// ---------------------------------------------------------------------------

function OutputsTab() {
  const outputs = useFlowEditorStore((s) => s.runState.outputs);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (outputs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[#555]">
        No outputs yet
      </div>
    );
  }

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    // Track copy event
    const orgId = useFlowEditorStore.getState().flow?.org_id;
    if (orgId) trackUsageEvent(orgId, '', 'copy_prompt', { url }).catch(() => {});
  };

  const handleDownload = (url: string, idx: number, kind?: string) => {
    // Track download event
    const orgId = useFlowEditorStore.getState().flow?.org_id;
    if (orgId) trackUsageEvent(orgId, '', 'download', { url }).catch(() => {});
    const ext = kind === 'video' ? 'mp4' : 'png';
    const link = document.createElement('a');
    link.href = url;
    link.download = `output_${Date.now()}.${ext}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <div className="grid h-full auto-rows-min grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 overflow-y-auto px-3 py-2">
        {outputs.map((output, i) => {
          const isMedia = output.kind === 'image' || output.kind === 'video' || output.kind === 'audio';
          const isVideo = output.kind === 'video';
          const isAudio = output.kind === 'audio';
          const MediaIcon = isAudio ? Film : isVideo ? Film : ImageIcon;
          const providerInfo = output.metadata?.provider
            ? `${output.metadata.provider}${output.metadata?.model ? ' / ' + output.metadata.model : ''}`
            : undefined;

          return (
            <div
              key={i}
              className="group relative overflow-hidden rounded-lg border border-[#333] bg-[#222] transition-colors hover:border-[#555]"
            >
              {/* Thumbnail area */}
              <button
                type="button"
                onClick={() => setExpandedIdx(i)}
                className="relative aspect-square w-full"
              >
                {isMedia && output.url ? (
                  isAudio ? (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#1a1a1a]">
                      <Film className="h-6 w-6 text-purple-400" />
                      <audio src={output.url} controls className="w-[90%]" />
                    </div>
                  ) : isVideo ? (
                    <video
                      src={output.url}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={output.url}
                      alt={`Output ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <MediaIcon className="h-6 w-6 text-[#555]" />
                  </div>
                )}
                {/* Kind badge */}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium capitalize text-white">
                  {output.kind}
                </span>
              </button>

              {/* Info + actions */}
              <div className="border-t border-[#2a2a2a] px-1.5 py-1">
                {providerInfo && (
                  <p className="mb-1 truncate text-[9px] text-[#666]">{providerInfo}</p>
                )}
                <div className="flex items-center gap-0.5">
                  <OutputActionBtn
                    icon={Save}
                    label="Save to Assets"
                    onClick={() => {
                      if (!output.url) return;
                      const flowId = useFlowEditorStore.getState().flow?.id;
                      const orgId = useFlowEditorStore.getState().flow?.org_id;
                      if (!orgId) return;
                      import('../../../lib/directorApi').then(({ createGeneration }) => {
                        createGeneration({
                          org_id: orgId,
                          created_by: null,
                          flow_id: flowId || null,
                          run_id: null,
                          node_id: null,
                          template_id: null,
                          title: 'Saved Output',
                          prompt: null,
                          output_type: output.kind === 'video' ? 'video' : 'image',
                          output_url: output.url || null,
                          thumbnail_url: output.kind === 'image' ? output.url || null : null,
                          provider: output.metadata?.provider || null,
                          model: output.metadata?.model || null,
                          status: 'completed',
                          metadata: output.metadata || {},
                        }).then(() => {
                          import('sonner').then(({ toast }) => toast.success('Saved to assets'));
                        });
                      });
                    }}
                  />
                  {output.url && (
                    <>
                      <OutputActionBtn
                        icon={Download}
                        label="Download"
                        onClick={() => handleDownload(output.url!, i, output.kind)}
                      />
                      <OutputActionBtn
                        icon={Copy}
                        label="Copy URL"
                        onClick={() => handleCopyUrl(output.url!)}
                      />
                      {output.kind === 'image' && (
                        <OutputActionBtn
                          icon={Sparkles}
                          label="Analyze with LIA"
                          onClick={() => {
                            const url = output.url!;
                            // Switch to chat tab and auto-analyze
                            useFlowEditorStore.getState().setOutputPanelTab('chat');
                            // Dispatch custom event to trigger analysis in ChatTab
                            window.dispatchEvent(new CustomEvent('lia-analyze-output', { detail: { imageUrl: url } }));
                          }}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded preview overlay */}
      {expandedIdx !== null && outputs[expandedIdx] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setExpandedIdx(null)}
        >
          <div
            className="relative max-h-[80vh] max-w-[80vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setExpandedIdx(null)}
              className="absolute -right-3 -top-3 z-10 rounded-full bg-[#333] p-1 text-white transition-colors hover:bg-[#555]"
            >
              <X className="h-4 w-4" />
            </button>
            {outputs[expandedIdx].kind === 'video' && outputs[expandedIdx].url ? (
              <video
                src={outputs[expandedIdx].url}
                className="max-h-[80vh] rounded-lg"
                controls
                autoPlay
                muted
              />
            ) : outputs[expandedIdx].url ? (
              <img
                src={outputs[expandedIdx].url}
                alt={`Output ${expandedIdx + 1}`}
                className="max-h-[80vh] rounded-lg"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-[#222] text-[#666]">
                No preview available
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function OutputActionBtn({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="rounded p-1 text-[#666] transition-colors hover:bg-[#333] hover:text-[#e0e0e0]"
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Costs tab
// ---------------------------------------------------------------------------

function CostsTab() {
  const runState = useFlowEditorStore((s) => s.runState);
  const nodes = useFlowEditorStore((s) => s.nodes);

  const { estimated, actual } = runState.costs;
  const hasRun = runState.status !== 'idle';

  if (!hasRun && nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[#555]">
        Run a flow to see costs
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      {/* Summary row */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#333] bg-[#222] p-3">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-[#666]">
            Estimated
          </span>
          <div className="mt-1 flex items-baseline gap-1">
            <Coins className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[18px] font-bold tabular-nums text-[#e0e0e0]">
              {estimated.toFixed(1)}
            </span>
            <span className="text-[11px] text-[#666]">credits</span>
          </div>
        </div>
        <div className="rounded-lg border border-[#333] bg-[#222] p-3">
          <span className="block text-[10px] font-medium uppercase tracking-wider text-[#666]">
            Actual
          </span>
          <div className="mt-1 flex items-baseline gap-1">
            <Coins className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[18px] font-bold tabular-nums text-[#e0e0e0]">
              {actual.toFixed(1)}
            </span>
            <span className="text-[11px] text-[#666]">credits</span>
          </div>
        </div>
      </div>

      {/* Per-node breakdown */}
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-[#666]">
        Per-step breakdown
      </h4>
      {nodes.length === 0 ? (
        <p className="text-[12px] text-[#555]">No nodes in flow.</p>
      ) : (
        <div className="space-y-1">
          {nodes.map((node) => {
            const modelId = node.data_json?.model as string | undefined;
            const catalogEntry = modelId ? MODEL_CATALOG.find((m) => m.id === modelId) : undefined;
            const nodeCost = catalogEntry?.creditCost ?? node.data_json?.creditCost ?? 0;
            return (
              <div
                key={node.id}
                className="flex items-center justify-between rounded-md bg-[#222] px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-[12px] text-[#aaa]">{node.title}</span>
                <span className="ml-2 shrink-0 text-[12px] tabular-nums text-[#e0e0e0]">
                  {Number(nodeCost).toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat tab (LIA)
// ---------------------------------------------------------------------------

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

function ChatTab() {
  const nodes = useFlowEditorStore((s) => s.nodes);
  const flow = useFlowEditorStore((s) => s.flow);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hey! I'm LIA, your creative assistant. Ask me anything about your flow — I can help with prompts, node setup, or creative ideas.",
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const buildSystemPrompt = useCallback(() => {
    const nodesSummary = nodes
      .map((n) => `- ${n.title} (${n.type}/${n.category})`)
      .join('\n');
    const runState = useFlowEditorStore.getState().runState;
    const outputCount = runState.outputs.length;
    const runStatus = runState.status;
    return `You are LIA — an elite AI Marketing Director and Creative Director embedded in the Lume CRM workflow editor. You operate at the level of a top-tier agency combined with a Hollywood production director.

CURRENT FLOW: "${flow?.title || 'Untitled'}"
NODES (${nodes.length}):
${nodesSummary || '(no nodes yet)'}
RUN STATUS: ${runStatus} | OUTPUTS: ${outputCount}

YOUR ROLE IN THE WORKFLOW:
1. Craft and optimize prompts — every prompt MUST include: subject, environment, lighting (type + direction), camera (angle + lens + distance), mood, composition, texture. Minimum 50 words for images.
2. Diagnose flow issues — identify missing connections, wrong models, suboptimal node chains
3. Recommend the best model for each specific task (not defaults)
4. After a run completes, analyze the results and suggest specific prompt improvements
5. Suggest A/B variations with different emotional intensities
6. Challenge weak creative direction — push for specificity and conversion-focused visuals
7. For video nodes, ALWAYS separate: subject motion, camera motion, environment motion

PRODUCTION DIRECTOR MODE:
When helping with prompts, think like you're directing a real photoshoot or film set:
- Define the exact lighting setup (key light position, fill, rim, color temperature)
- Specify camera lens (35mm wide, 50mm standard, 85mm portrait, 200mm telephoto)
- Direct the subject (expression, body language, eye direction, gesture)
- Set the environment (specific materials, weather, time of day, atmospheric elements)
- Control the mood (what emotion should the viewer feel in the first 0.5 seconds?)

QUALITY ENFORCEMENT:
- Never accept vague prompts from the user — rewrite them with full detail
- If a prompt is under 30 words, expand it before suggesting execution
- If lighting is not specified, add professional lighting direction
- If camera is not specified, recommend the best angle for the subject matter

RESPONSE STYLE:
- Confident, precise, strategic, slightly demanding
- Lead with the solution, explain briefly why
- Use short focused paragraphs
- Always end with a concrete next action the user can take`;
  }, [nodes, flow]);

  // Listen for "analyze output" events from the Outputs tab
  useEffect(() => {
    const handler = async (e: Event) => {
      const imageUrl = (e as CustomEvent).detail?.imageUrl;
      if (!imageUrl || isStreaming) return;

      const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: '🔍 Analyze this output...' };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      const assistantId = `assistant-${Date.now()}`;
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

      try {
        await analyzeImageWithVision({
          imageUrl,
          prompt: `You are LIA, an elite AI Creative Director. Analyze this AI-generated image and provide:
1. QUALITY SCORE (1-10): Rate overall quality (sharpness, composition, lighting, realism)
2. STRENGTHS: What works well (be specific)
3. ISSUES: Any problems (blur, artifacts, bad anatomy, inconsistent lighting, etc.)
4. IMPROVEMENT: Specific prompt modifications to fix issues
5. NEXT STEPS: What to generate next for a complete campaign

Be concise, direct, and actionable. Use short bullet points.`,
          onToken: (token) => {
            setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + token } : m));
          },
        });
      } catch {
        setMessages((prev) => prev.map((m) => m.id === assistantId
          ? { ...m, content: 'Vision analysis requires LLaVA. Run: `ollama pull llava` then restart Ollama.' }
          : m));
      } finally {
        setIsStreaming(false);
      }
    };

    window.addEventListener('lia-analyze-output', handler);
    return () => window.removeEventListener('lia-analyze-output', handler);
  }, [isStreaming]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '' },
    ]);

    const history = [
      { role: 'system', content: buildSystemPrompt() },
      ...messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      await streamMessageToAI({
        conversationId: null,
        content: trimmed,
        history,
        dbReady: false,
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + token }
                : m,
            ),
          );
        },
      });
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:
                  "Sorry, I couldn't connect to the AI. Make sure Ollama is running locally.",
              }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, buildSystemPrompt]);

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex gap-2',
              msg.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {msg.role === 'assistant' && (
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-purple-500/20">
                <Sparkles className="h-3 w-3 text-purple-400" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[75%] rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed',
                msg.role === 'user'
                  ? 'bg-blue-500/20 text-blue-100'
                  : 'bg-[#252525] text-[#ccc]',
              )}
            >
              {msg.content || (
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#555]" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#555]" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#555]" style={{ animationDelay: '300ms' }} />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-[#2a2a2a] px-3 py-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask LIA something..."
          disabled={isStreaming}
          className="flex-1 rounded-md border border-[#333] bg-[#222] px-2.5 py-1.5 text-[12px] text-[#e0e0e0] placeholder-[#555] outline-none focus:border-purple-500/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md bg-purple-500/20 text-purple-400 transition-colors hover:bg-purple-500/30',
            (!input.trim() || isStreaming) && 'opacity-40 cursor-not-allowed',
          )}
        >
          {isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutputPanel - main export
// ---------------------------------------------------------------------------

function OutputPanelComponent() {
  const outputPanelOpen = useFlowEditorStore((s) => s.outputPanelOpen);
  const toggleOutputPanel = useFlowEditorStore((s) => s.toggleOutputPanel);
  const activeTab = useFlowEditorStore((s) => s.outputPanelTab);
  const setTab = useFlowEditorStore((s) => s.setOutputPanelTab);
  const runStatus = useFlowEditorStore((s) => s.runState.status);
  const outputs = useFlowEditorStore((s) => s.runState.outputs);

  const hasOutputs = outputs.length > 0;

  const handleTabClick = useCallback(
    (tab: 'logs' | 'outputs' | 'costs' | 'chat') => {
      setTab(tab);
      if (!outputPanelOpen) toggleOutputPanel();
    },
    [setTab, outputPanelOpen, toggleOutputPanel],
  );

  return (
    <div
      className="shrink-0 border-t border-[#2a2a2a] bg-[#1a1a1a] transition-[height] duration-200 ease-in-out"
      style={{ height: outputPanelOpen ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT }}
    >
      {/* Header / tab bar */}
      <div className="flex h-[40px] items-center border-b border-[#2a2a2a] px-3">
        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggleOutputPanel}
          className="mr-2 rounded p-1 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
          title={outputPanelOpen ? 'Collapse' : 'Expand'}
        >
          {outputPanelOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabClick(tab.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                activeTab === tab.key
                  ? tab.key === 'chat'
                    ? 'bg-purple-500/15 text-purple-400'
                    : 'bg-[#2a2a2a] text-[#e0e0e0]'
                  : tab.key === 'chat'
                    ? 'text-purple-400/50 hover:bg-purple-500/10 hover:text-purple-400'
                    : 'text-[#666] hover:bg-[#222] hover:text-[#aaa]',
              )}
            >
              {tab.key === 'chat' && <Sparkles className="mr-1 inline h-3 w-3" />}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Right side: status + actions */}
        <div className="ml-auto flex items-center gap-3">
          <RunStatusIndicator status={runStatus} />

          {outputPanelOpen && hasOutputs && (
            <div className="flex items-center gap-1">
              <HeaderActionButton icon={Save} label="Save All to Assets" onClick={() => {
                const outputs = useFlowEditorStore.getState().runState.outputs;
                if (outputs.length === 0) return;
                import('sonner').then(({ toast }) => {
                  const promises = outputs.filter(o => o.url).map(async (output) => {
                    try {
                      const { data: { session } } = await (await import('../../../lib/supabase')).supabase.auth.getSession();
                      await fetch('/api/director-panel/assets/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
                        body: JSON.stringify({ url: output.url, metadata: output.metadata }),
                      });
                    } catch { /* skip */ }
                  });
                  Promise.all(promises).then(() => toast.success(`${outputs.length} outputs saved to assets`));
                });
              }} />
              <HeaderActionButton icon={Link} label="Attach to Campaign" onClick={() => { import('sonner').then(({ toast }) => toast.info('Campaign linking coming soon')); }} />
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      {outputPanelOpen && (
        <div className="h-[calc(100%-40px)] overflow-hidden">
          {activeTab === 'logs' && <LogsTab />}
          {activeTab === 'outputs' && <OutputsTab />}
          {activeTab === 'costs' && <CostsTab />}
          {activeTab === 'chat' && <ChatTab />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header action button
// ---------------------------------------------------------------------------

function HeaderActionButton({
  icon: Icon,
  label,
  accent,
  onClick,
}: {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
        accent
          ? 'bg-purple-400/15 text-purple-400 hover:bg-purple-400/25'
          : 'text-[#888] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]',
      )}
    >
      <span className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        <span className="hidden xl:inline">{label}</span>
      </span>
    </button>
  );
}

const OutputPanel = React.memo(OutputPanelComponent);
OutputPanel.displayName = 'OutputPanel';

export default OutputPanel;
