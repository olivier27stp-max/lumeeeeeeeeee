import React, { useCallback, useMemo, useState } from 'react';
import {
  X,
  Copy,
  Trash2,
  Settings,
  Link,
  Megaphone,
  Package,
  Palette,
  Coins,
  AlertTriangle,
  type LucideIcon,
  ImagePlus,
  Video,
  Type,
  Upload,
  Download,
  Eye,
  GitBranch,
  Sparkles,
  StickyNote,
  SlidersHorizontal,
  Layers,
  Hash,
  CirclePlay,
  HardDriveDownload,
  CheckCircle,
  UsersRound,
  FolderOpen,
  Clock,
} from 'lucide-react';
import { useFlowEditorStore } from '../../../lib/director-panel/store';
import { getNodeDef } from '../../../lib/director-panel/config/node-registry';
import { MODEL_CATALOG } from '../../../lib/director-panel/config/model-catalog';
import { validateGraph } from '../../../lib/director-panel/engine/graph-engine';
import type { InspectorField, NodeRegistryEntry } from '../../../types/director';
import { cn } from '../../../lib/utils';

// ---------------------------------------------------------------------------
// Icon resolver - maps icon name strings from the registry to Lucide icons
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  Type,
  Download,
  Upload,
  Eye,
  ImagePlus,
  Video,
  Sparkles,
  GitBranch,
  CirclePlay,
  StickyNote,
  SlidersHorizontal,
  Layers,
  Hash,
  Palette,
  Megaphone,
  Package,
  UsersRound,
  FolderOpen,
  HardDriveDownload,
  Link,
  CheckCircle,
};

function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return Type;
  return ICON_MAP[name] ?? Type;
}

// ---------------------------------------------------------------------------
// Provider / Model helpers driven by MODEL_CATALOG
// ---------------------------------------------------------------------------

/** Build the list of providers that have at least one active model. */
function getActiveProviders(): { label: string; value: string }[] {
  const providerSet = new Map<string, string>();
  for (const m of MODEL_CATALOG) {
    if (m.status === 'active' && !providerSet.has(m.provider)) {
      providerSet.set(m.provider, formatProviderLabel(m.provider));
    }
  }
  return Array.from(providerSet, ([value, label]) => ({ value, label }));
}

function formatProviderLabel(p: string): string {
  const map: Record<string, string> = {
    fal: 'Fal.ai',
    google: 'Google',
    runway: 'Runway',
    kling: 'Kling',
    openai: 'OpenAI',
    stability: 'Stability',
    luma: 'Luma',
    recraft: 'Recraft',
    ideogram: 'Ideogram',
    minimax: 'MiniMax',
    higgsfield: 'Higgsfield',
    topaz: 'Topaz',
    bria: 'Bria',
    nvidia: 'NVIDIA',
  };
  return map[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

/** Get active models for a given provider. */
function getActiveModelsForProvider(
  provider: string | undefined,
): { label: string; value: string; cost: number }[] {
  if (!provider) return [];
  return MODEL_CATALOG.filter((m) => m.provider === provider && m.status === 'active').map(
    (m) => ({
      label: m.displayName,
      value: m.id,
      cost: m.creditCost,
    }),
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-yellow-500/15 text-yellow-400',
  active: 'bg-emerald-500/15 text-emerald-400',
  archived: 'bg-zinc-500/15 text-zinc-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        STATUS_STYLES[status] ?? STATUS_STYLES.draft,
      )}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Individual field renderers
// ---------------------------------------------------------------------------

interface FieldProps {
  key?: React.Key;
  field: InspectorField;
  value: any;
  allValues: Record<string, any>;
  onChange: (key: string, val: any) => void;
}

const inputBase =
  'w-full rounded-md bg-[#222] px-2.5 py-1.5 text-[13px] text-[#e0e0e0] placeholder-[#555] outline-none border border-[#333] transition-colors focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20';

function TextField({ field, value, onChange }: FieldProps) {
  return (
    <input
      type="text"
      value={value ?? field.defaultValue ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      placeholder={field.label}
      className={inputBase}
    />
  );
}

function TextareaField({ field, value, onChange }: FieldProps) {
  return (
    <textarea
      value={value ?? field.defaultValue ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      placeholder={field.label}
      rows={3}
      className={cn(inputBase, 'resize-none leading-relaxed')}
    />
  );
}

function SelectField({ field, value, onChange }: FieldProps) {
  return (
    <select
      value={value ?? field.defaultValue ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      className={cn(inputBase, 'cursor-pointer appearance-none pr-8')}
    >
      <option value="" disabled>
        Select {field.label}
      </option>
      {field.options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function NumberField({ field, value, onChange }: FieldProps) {
  return (
    <input
      type="number"
      value={value ?? field.defaultValue ?? 0}
      onChange={(e) => onChange(field.key, Number(e.target.value))}
      min={field.min}
      max={field.max}
      step={field.step ?? 1}
      className={cn(inputBase, 'tabular-nums')}
    />
  );
}

function SliderField({ field, value, onChange }: FieldProps) {
  const current = value ?? field.defaultValue ?? field.min ?? 0;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={field.min ?? 0}
        max={field.max ?? 100}
        step={field.step ?? 1}
        value={current}
        onChange={(e) => onChange(field.key, Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[#333] accent-purple-400 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
      />
      <span className="min-w-[32px] text-right text-[12px] tabular-nums text-[#aaa]">
        {current}
      </span>
    </div>
  );
}

function ToggleField({ field, value, onChange }: FieldProps) {
  const checked = value ?? field.defaultValue ?? false;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(field.key, !checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        checked ? 'bg-purple-400' : 'bg-[#333]',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

function ProviderSelectField({ field, value, onChange }: FieldProps) {
  const providers = useMemo(() => getActiveProviders(), []);

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      className={cn(inputBase, 'cursor-pointer appearance-none pr-8')}
    >
      <option value="" disabled>
        Select provider
      </option>
      {providers.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

function ModelSelectField({ field, value, allValues, onChange }: FieldProps) {
  const provider = allValues.provider as string | undefined;
  const models = useMemo(() => getActiveModelsForProvider(provider), [provider]);

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      disabled={models.length === 0}
      className={cn(
        inputBase,
        'cursor-pointer appearance-none pr-8',
        models.length === 0 && 'cursor-not-allowed opacity-50',
      )}
    >
      <option value="" disabled>
        {models.length === 0 ? 'Select a provider first' : 'Select model'}
      </option>
      {models.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label} ({m.cost} cr)
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Field dispatcher
// ---------------------------------------------------------------------------

const FIELD_COMPONENTS: Record<string, React.FC<FieldProps>> = {
  text: TextField,
  textarea: TextareaField,
  select: SelectField,
  number: NumberField,
  slider: SliderField,
  toggle: ToggleField,
  provider_select: ProviderSelectField,
  model_select: ModelSelectField,
};

function InspectorFieldRenderer({ field, value, allValues, onChange }: FieldProps) {
  const Component = FIELD_COMPONENTS[field.type];
  if (!Component) return null;

  const isToggle = field.type === 'toggle';

  return (
    <div
      className={cn(
        'space-y-1',
        isToggle && 'flex items-center justify-between gap-2 space-y-0',
      )}
    >
      <label className="block text-[12px] font-medium text-[#888]">{field.label}</label>
      <Component field={field} value={value} allValues={allValues} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow metadata view (no node selected)
// ---------------------------------------------------------------------------

function FlowMetadataView() {
  const flow = useFlowEditorStore((s) => s.flow);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const runState = useFlowEditorStore((s) => s.runState);
  const updateFlowMeta = useFlowEditorStore((s) => s.updateFlowMeta);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Validation warnings
  const validationWarnings = useMemo(() => {
    if (nodes.length === 0) return [];
    return validateGraph(nodes, edges);
  }, [nodes, edges]);

  if (!flow) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-[#666]">
        No flow loaded
      </div>
    );
  }

  const handleTitleCommit = () => {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== flow.title) {
      updateFlowMeta({ title: trimmed });
    }
    setEditingTitle(false);
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Flow title + status */}
      <div className="space-y-3 border-b border-[#2a2a2a] px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          {editingTitle ? (
            <input
              autoFocus
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTitleCommit();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className={cn(inputBase, 'text-[14px] font-semibold')}
            />
          ) : (
            <h3
              className="min-w-0 cursor-pointer truncate text-[14px] font-semibold text-[#e0e0e0] hover:text-purple-400"
              onClick={() => {
                setTitleDraft(flow.title);
                setEditingTitle(true);
              }}
              title="Click to edit"
            >
              {flow.title}
            </h3>
          )}
          <StatusBadge status={flow.status} />
        </div>

        {/* Description (editable) */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#666]">Description</label>
          <textarea
            value={flow.description ?? ''}
            onChange={(e) => updateFlowMeta({ description: e.target.value })}
            placeholder="Add a description..."
            rows={2}
            className={cn(inputBase, 'resize-none text-[12px] leading-relaxed')}
          />
        </div>
      </div>

      {/* Linked entities */}
      <div className="space-y-2 border-b border-[#2a2a2a] px-4 py-4">
        <h4 className="text-xs font-medium uppercase tracking-wider text-[#666]">
          Linked Entities
        </h4>
        <LinkedEntity
          icon={Megaphone}
          label="Campaign"
          value={flow.linked_campaign_id}
          color="text-blue-400"
        />
        <LinkedEntity
          icon={Package}
          label="Product"
          value={flow.linked_product_id}
          color="text-amber-400"
        />
        <LinkedEntity
          icon={Palette}
          label="Brand"
          value={flow.linked_brand_profile_id}
          color="text-pink-400"
        />
      </div>

      {/* Estimated credits */}
      <div className="space-y-1 border-b border-[#2a2a2a] px-4 py-4">
        <h4 className="text-xs font-medium uppercase tracking-wider text-[#666]">
          Estimated Credits
        </h4>
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-amber-400" />
          <span className="text-[16px] font-semibold tabular-nums text-[#e0e0e0]">
            {runState.costs.estimated.toFixed(1)}
          </span>
          <span className="text-[12px] text-[#666]">credits</span>
        </div>
      </div>

      {/* Validation warnings */}
      {validationWarnings.length > 0 && (
        <div className="space-y-1.5 border-b border-[#2a2a2a] px-4 py-3">
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-[#666]">
            Validation
          </h4>
          {validationWarnings.map((w, i) => (
            <div
              key={i}
              className={cn(
                'flex items-start gap-2 text-[12px]',
                w.severity === 'error' ? 'text-red-400/90' : 'text-amber-400/80',
              )}
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar hint */}
      <div className="mt-auto px-4 py-4">
        <p className="text-center text-[11px] text-[#555]">
          Ctrl+S to save &middot; Ctrl+Enter to run
        </p>
      </div>
    </div>
  );
}

function LinkedEntity({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | undefined;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-[#222] px-2.5 py-2">
      <Icon className={cn('h-3.5 w-3.5', color)} />
      <span className="flex-1 text-[12px] text-[#aaa]">{label}</span>
      {value ? (
        <span className="max-w-[100px] truncate text-[11px] font-medium text-[#e0e0e0]">
          {value}
        </span>
      ) : (
        <span className="text-[11px] text-[#555]">None</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node inspector view (node selected)
// ---------------------------------------------------------------------------

function NodeInspectorView() {
  const selectedNodeId = useFlowEditorStore((s) => s.selectedNodeId);
  const nodes = useFlowEditorStore((s) => s.nodes);
  const edges = useFlowEditorStore((s) => s.edges);
  const updateNode = useFlowEditorStore((s) => s.updateNode);
  const removeNode = useFlowEditorStore((s) => s.removeNode);
  const addNode = useFlowEditorStore((s) => s.addNode);
  const selectNode = useFlowEditorStore((s) => s.selectNode);

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const nodeDef = useMemo(
    () => (node ? getNodeDef(node.type) : undefined),
    [node],
  );

  // Validation warnings scoped to this node
  const nodeWarnings = useMemo(() => {
    if (!node) return [];
    return validateGraph(nodes, edges).filter(
      (w) => w.nodeId === node.id,
    );
  }, [nodes, edges, node]);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!node) return;
      updateNode(node.id, { title: e.target.value });
    },
    [node, updateNode],
  );

  const handleFieldChange = useCallback(
    (key: string, value: any) => {
      if (!node) return;
      const updated: Record<string, any> = { ...node.data_json, [key]: value };

      // When provider changes, reset model selection so it does not remain stale
      if (key === 'provider') {
        updated.model = '';
      }

      updateNode(node.id, {
        data_json: updated,
      });
    },
    [node, updateNode],
  );

  const handleDuplicate = useCallback(() => {
    if (!node) return;
    const duplicate = {
      ...node,
      id: `${node.type}_${Date.now()}`,
      title: `${node.title} (copy)`,
      position_x: node.position_x + 40,
      position_y: node.position_y + 40,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    addNode(duplicate);
    selectNode(duplicate.id);
  }, [node, addNode, selectNode]);

  const handleDelete = useCallback(() => {
    if (!node) return;
    removeNode(node.id);
  }, [node, removeNode]);

  if (!node || !nodeDef) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-[#666]">
        Node not found
      </div>
    );
  }

  const IconComponent = resolveIcon(nodeDef.icon);
  const fields = nodeDef.inspectorFields ?? [];
  const data = node.data_json ?? {};

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Node type header */}
      <div className="flex items-center gap-2.5 border-b border-[#2a2a2a] px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-400/10">
          <IconComponent className="h-4 w-4 text-purple-400" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-[#e0e0e0]">
            {nodeDef.displayName}
          </span>
          <span className="block truncate text-[10px] capitalize text-[#555]">
            {nodeDef.category.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Coming soon badge */}
      {nodeDef.status === 'coming_soon' && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span className="text-[12px] leading-relaxed text-amber-400">
            Coming Soon — this node is not yet functional
          </span>
        </div>
      )}

      {/* Editable title */}
      <div className="border-b border-[#2a2a2a] px-4 py-3">
        <label className="mb-1 block text-[11px] font-medium text-[#666]">Title</label>
        <input
          type="text"
          value={node.title}
          onChange={handleTitleChange}
          className={cn(inputBase, 'font-medium')}
        />
      </div>

      {/* Dynamic fields */}
      {fields.length > 0 && (
        <div className="space-y-3 border-b border-[#2a2a2a] px-4 py-4">
          {fields.map((field) => (
            <InspectorFieldRenderer
              key={field.key}
              field={field}
              value={data[field.key]}
              allValues={data}
              onChange={handleFieldChange}
            />
          ))}
        </div>
      )}

      {/* Validation warnings for this node */}
      {nodeWarnings.length > 0 && (
        <div className="space-y-1.5 border-b border-[#2a2a2a] px-4 py-3">
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-[#666]">
            Validation
          </h4>
          {nodeWarnings.map((w, i) => (
            <div
              key={i}
              className={cn(
                'flex items-start gap-2 text-[12px]',
                w.severity === 'error' ? 'text-red-400/90' : 'text-amber-400/80',
              )}
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex gap-2 px-4 py-4">
        <button
          type="button"
          onClick={handleDuplicate}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#333] bg-[#222] px-3 py-2 text-[13px] text-[#e0e0e0] transition-colors hover:border-[#555] hover:bg-[#333]"
        >
          <Copy className="h-3.5 w-3.5" />
          Duplicate Node
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-400 transition-colors hover:border-red-500/40 hover:bg-red-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete Node
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectorPanel - main export
// ---------------------------------------------------------------------------

function InspectorPanelComponent() {
  const inspectorOpen = useFlowEditorStore((s) => s.inspectorOpen);
  const toggleInspector = useFlowEditorStore((s) => s.toggleInspector);
  const selectedNodeId = useFlowEditorStore((s) => s.selectedNodeId);
  const selectNode = useFlowEditorStore((s) => s.selectNode);

  if (!inspectorOpen) return null;

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-l border-[#2a2a2a] bg-[#1a1a1a]">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-[#2a2a2a] px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-[#e0e0e0]">
          {selectedNodeId ? 'Node Inspector' : 'Flow Details'}
        </h2>
        <div className="flex items-center gap-1">
          {selectedNodeId && (
            <button
              type="button"
              onClick={() => selectNode(null)}
              className="rounded p-1 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
              title="Deselect node"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleInspector}
            className="rounded p-1 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
            title="Close inspector"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {selectedNodeId ? <NodeInspectorView /> : <FlowMetadataView />}
    </aside>
  );
}

const InspectorPanel = React.memo(InspectorPanelComponent);
InspectorPanel.displayName = 'InspectorPanel';

export default InspectorPanel;
