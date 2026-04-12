/* ═══════════════════════════════════════════════════════════════
   Memory Graph — TypeScript Types
   Full type system for LIA's memory graph visualization.
   ═══════════════════════════════════════════════════════════════ */

// ── Node Types ────────────────────────────────────────────
export const MEMORY_NODE_TYPES = [
  'company', 'client', 'lead', 'conversation', 'message_thread',
  'job', 'quote', 'invoice', 'payment', 'schedule_item',
  'team_member', 'company_rule', 'service', 'pricing_rule',
  'escalation_rule', 'incident', 'memory_note', 'learned_pattern',
  'document', 'source', 'summary', 'concept', 'task', 'automation',
] as const;

export type MemoryNodeType = typeof MEMORY_NODE_TYPES[number];

// ── Edge Types ────────────────────────────────────────────
export const MEMORY_EDGE_TYPES = [
  'references', 'belongs_to', 'created_from', 'related_to',
  'contradicted_by', 'supports', 'derived_from', 'escalated_to',
  'learned_from', 'applied_to', 'triggered', 'assigned_to',
  'scheduled_with', 'sent_to', 'billed_to', 'paid_by',
  'linked_to_rule', 'summarized_into', 'source_for', 'duplicate_of',
] as const;

export type MemoryEdgeType = typeof MEMORY_EDGE_TYPES[number];

// ── Memory Layers ─────────────────────────────────────────
export const MEMORY_LAYERS = ['conversation', 'client', 'company', 'agentic'] as const;
export type MemoryLayer = typeof MEMORY_LAYERS[number];

// ── Memory Node ───────────────────────────────────────────
export interface MemoryNode {
  id: string;
  org_id: string;
  node_type: MemoryNodeType;
  label: string;
  description: string | null;
  confidence: number;
  importance: number;
  freshness_at: string;
  company_id: string | null;
  client_id: string | null;
  source_count: number;
  is_orphan: boolean;
  is_archived: boolean;
  memory_layer: MemoryLayer;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ── Memory Edge ───────────────────────────────────────────
export interface MemoryEdge {
  id: string;
  org_id: string;
  source_id: string;
  target_id: string;
  relation_type: MemoryEdgeType;
  weight: number;
  confidence: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Memory Log ────────────────────────────────────────────
export type MemoryEventType =
  | 'memory.created'
  | 'memory.updated'
  | 'memory.merged'
  | 'memory.archived'
  | 'memory.conflict_detected'
  | 'memory.promoted'
  | 'memory.demoted'
  | 'memory.linked'
  | 'memory.unlinked';

export interface MemoryLog {
  id: string;
  org_id: string;
  node_id: string | null;
  edge_id: string | null;
  event_type: MemoryEventType;
  description: string | null;
  actor: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Memory Source ─────────────────────────────────────────
export interface MemorySource {
  id: string;
  org_id: string;
  node_id: string;
  source_type: string;
  source_id: string | null;
  source_label: string | null;
  excerpt: string | null;
  created_at: string;
}

// ── Memory Conflict ───────────────────────────────────────
export interface MemoryConflict {
  id: string;
  org_id: string;
  node_a_id: string;
  node_b_id: string;
  conflict_type: string;
  description: string | null;
  severity: number;
  resolved: boolean;
  resolved_at: string | null;
  resolution: string | null;
  created_at: string;
}

// ── Memory Snapshot ───────────────────────────────────────
export interface MemorySnapshot {
  id: string;
  org_id: string;
  total_nodes: number;
  total_edges: number;
  orphan_count: number;
  conflict_count: number;
  avg_confidence: number;
  avg_importance: number;
  layer_counts: Record<string, number>;
  type_counts: Record<string, number>;
  created_at: string;
}

// ── Graph View Models ─────────────────────────────────────

/** Simulation node with physics position */
export interface SimNode extends MemoryNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  radius: number;
}

/** Graph data as returned from API */
export interface MemoryGraphData {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  stats: MemoryGraphStats;
}

export interface MemoryGraphStats {
  total_nodes: number;
  total_edges: number;
  orphan_count: number;
  conflict_count: number;
  avg_confidence: number;
  avg_importance: number;
  layer_counts: Record<string, number>;
  type_counts: Record<string, number>;
  top_hubs: { id: string; label: string; node_type: MemoryNodeType; degree: number }[];
  recent_conflicts: MemoryConflict[];
  stale_count: number;
}

/** Node detail with related data */
export interface MemoryNodeDetail extends MemoryNode {
  neighbors: { node: MemoryNode; edge: MemoryEdge; direction: 'incoming' | 'outgoing' }[];
  sources: MemorySource[];
  logs: MemoryLog[];
  conflicts: MemoryConflict[];
}

// ── Filter State ──────────────────────────────────────────
export type GraphViewMode =
  | 'global'
  | 'company'
  | 'client'
  | 'agentic'
  | 'contradictions'
  | 'orphans'
  | 'recent';

export interface MemoryGraphFilters {
  viewMode: GraphViewMode;
  nodeTypes: MemoryNodeType[];
  layers: MemoryLayer[];
  companyId: string | null;
  clientId: string | null;
  minConfidence: number;
  minImportance: number;
  freshnessRange: 'all' | '24h' | '7d' | '30d' | '90d';
  search: string;
  hideWeak: boolean;
  focusNodeId: string | null;
}

// ── Display Config ────────────────────────────────────────

export const NODE_TYPE_COLORS: Record<MemoryNodeType, string> = {
  company:         '#F97316', // orange
  client:          '#3B82F6', // blue
  lead:            '#A855F7', // purple
  conversation:    '#6366F1', // indigo
  message_thread:  '#8B5CF6', // violet
  job:             '#10B981', // emerald
  quote:           '#EC4899', // pink
  invoice:         '#EF4444', // red
  payment:         '#14B8A6', // teal
  schedule_item:   '#06B6D4', // cyan
  team_member:     '#84CC16', // lime
  company_rule:    '#F59E0B', // amber
  service:         '#0EA5E9', // sky
  pricing_rule:    '#D97706', // amber-dark
  escalation_rule: '#DC2626', // red-dark
  incident:        '#F43F5E', // rose
  memory_note:     '#8B5CF6', // violet
  learned_pattern: '#22D3EE', // cyan-bright
  document:        '#64748B', // slate
  source:          '#94A3B8', // slate-light
  summary:         '#7C3AED', // violet-dark
  concept:         '#2DD4BF', // teal-light
  task:            '#FB923C', // orange-light
  automation:      '#818CF8', // indigo-light
};

export const NODE_TYPE_LABELS: Record<MemoryNodeType, { en: string; fr: string }> = {
  company:         { en: 'Company',          fr: 'Entreprise' },
  client:          { en: 'Client',           fr: 'Client' },
  lead:            { en: 'Lead',             fr: 'Lead' },
  conversation:    { en: 'Conversation',     fr: 'Conversation' },
  message_thread:  { en: 'Message Thread',   fr: 'Fil de messages' },
  job:             { en: 'Job',              fr: 'Job' },
  quote:           { en: 'Quote',            fr: 'Devis' },
  invoice:         { en: 'Invoice',          fr: 'Facture' },
  payment:         { en: 'Payment',          fr: 'Paiement' },
  schedule_item:   { en: 'Schedule',         fr: 'Horaire' },
  team_member:     { en: 'Team Member',      fr: 'Membre équipe' },
  company_rule:    { en: 'Company Rule',     fr: 'Règle entreprise' },
  service:         { en: 'Service',          fr: 'Service' },
  pricing_rule:    { en: 'Pricing Rule',     fr: 'Règle de prix' },
  escalation_rule: { en: 'Escalation Rule',  fr: "Règle d'escalade" },
  incident:        { en: 'Incident',         fr: 'Incident' },
  memory_note:     { en: 'Memory Note',      fr: 'Note mémoire' },
  learned_pattern: { en: 'Learned Pattern',  fr: 'Patron appris' },
  document:        { en: 'Document',         fr: 'Document' },
  source:          { en: 'Source',           fr: 'Source' },
  summary:         { en: 'Summary',          fr: 'Résumé' },
  concept:         { en: 'Concept',          fr: 'Concept' },
  task:            { en: 'Task',             fr: 'Tâche' },
  automation:      { en: 'Automation',       fr: 'Automatisation' },
};

export const EDGE_TYPE_LABELS: Record<MemoryEdgeType, { en: string; fr: string }> = {
  references:       { en: 'References',       fr: 'Référence' },
  belongs_to:       { en: 'Belongs to',       fr: 'Appartient à' },
  created_from:     { en: 'Created from',     fr: 'Créé de' },
  related_to:       { en: 'Related to',       fr: 'Relié à' },
  contradicted_by:  { en: 'Contradicted by',  fr: 'Contredit par' },
  supports:         { en: 'Supports',         fr: 'Supporte' },
  derived_from:     { en: 'Derived from',     fr: 'Dérivé de' },
  escalated_to:     { en: 'Escalated to',     fr: 'Escaladé à' },
  learned_from:     { en: 'Learned from',     fr: 'Appris de' },
  applied_to:       { en: 'Applied to',       fr: 'Appliqué à' },
  triggered:        { en: 'Triggered',        fr: 'Déclenché' },
  assigned_to:      { en: 'Assigned to',      fr: 'Assigné à' },
  scheduled_with:   { en: 'Scheduled with',   fr: 'Planifié avec' },
  sent_to:          { en: 'Sent to',          fr: 'Envoyé à' },
  billed_to:        { en: 'Billed to',        fr: 'Facturé à' },
  paid_by:          { en: 'Paid by',          fr: 'Payé par' },
  linked_to_rule:   { en: 'Linked to rule',   fr: 'Lié à règle' },
  summarized_into:  { en: 'Summarized into',  fr: 'Résumé dans' },
  source_for:       { en: 'Source for',       fr: 'Source pour' },
  duplicate_of:     { en: 'Duplicate of',     fr: 'Doublon de' },
};

export const LAYER_LABELS: Record<MemoryLayer, { en: string; fr: string }> = {
  conversation: { en: 'Conversation',   fr: 'Conversation' },
  client:       { en: 'Client Memory',  fr: 'Mémoire client' },
  company:      { en: 'Company Memory', fr: 'Mémoire entreprise' },
  agentic:      { en: 'Agentic Memory', fr: 'Mémoire agentique' },
};

export const VIEW_MODE_LABELS: Record<GraphViewMode, { en: string; fr: string }> = {
  global:          { en: 'Global Memory',     fr: 'Mémoire globale' },
  company:         { en: 'Company Memory',    fr: 'Mémoire entreprise' },
  client:          { en: 'Client Memory',     fr: 'Mémoire client' },
  agentic:         { en: 'Agentic Learning',  fr: 'Apprentissage agentique' },
  contradictions:  { en: 'Contradictions',    fr: 'Contradictions' },
  orphans:         { en: 'Orphan Nodes',      fr: 'Nœuds orphelins' },
  recent:          { en: 'Recent Updates',    fr: 'Mises à jour récentes' },
};
