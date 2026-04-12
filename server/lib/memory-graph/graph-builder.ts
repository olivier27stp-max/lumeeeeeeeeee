/* ═══════════════════════════════════════════════════════════════
   Memory Graph — Graph Builder
   Hydrates the memory graph from real CRM data.

   This is the bridge between CRM entities and the memory graph.
   It scans clients, jobs, invoices, quotes, leads, teams,
   memory_entities, decision_logs, etc. and creates/updates
   memory_nodes and memory_edges accordingly.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';

interface BuildResult {
  nodesCreated: number;
  edgesCreated: number;
  nodesUpdated: number;
  orphansDetected: number;
  conflictsDetected: number;
}

/**
 * Full graph rebuild for an org.
 * Idempotent: uses upsert on (org_id, node_type, metadata->>'crm_id').
 * Should be called periodically or on-demand.
 */
export async function buildMemoryGraph(
  supabase: SupabaseClient,
  orgId: string,
): Promise<BuildResult> {
  const result: BuildResult = { nodesCreated: 0, edgesCreated: 0, nodesUpdated: 0, orphansDetected: 0, conflictsDetected: 0 };
  const nodeMap = new Map<string, string>(); // crm_key -> node_id

  // Helper: upsert a node and track it
  async function upsertNode(
    nodeType: string,
    label: string,
    description: string | null,
    crmId: string,
    opts: {
      confidence?: number;
      importance?: number;
      layer?: string;
      companyId?: string | null;
      clientId?: string | null;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<string> {
    const key = `${nodeType}:${crmId}`;
    if (nodeMap.has(key)) return nodeMap.get(key)!;

    // Check if node already exists
    const { data: existing } = await supabase
      .from('memory_nodes')
      .select('id')
      .eq('org_id', orgId)
      .eq('node_type', nodeType)
      .contains('metadata', { crm_id: crmId })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Update freshness
      await supabase.from('memory_nodes').update({
        label,
        description,
        freshness_at: new Date().toISOString(),
        confidence: opts.confidence ?? 0.8,
        importance: opts.importance ?? 0.5,
        company_id: opts.companyId || null,
        client_id: opts.clientId || null,
      }).eq('id', existing.id);
      nodeMap.set(key, existing.id);
      result.nodesUpdated++;
      return existing.id;
    }

    const { data: newNode, error } = await supabase.from('memory_nodes').insert({
      org_id: orgId,
      node_type: nodeType,
      label,
      description,
      confidence: opts.confidence ?? 0.8,
      importance: opts.importance ?? 0.5,
      memory_layer: opts.layer || 'company',
      company_id: opts.companyId || null,
      client_id: opts.clientId || null,
      metadata: { crm_id: crmId, ...(opts.metadata || {}) },
    }).select('id').single();

    if (error || !newNode) {
      console.warn(`[graph-builder] Failed to create node ${key}:`, error?.message);
      return '';
    }

    nodeMap.set(key, newNode.id);
    result.nodesCreated++;

    // Log the creation
    await supabase.from('memory_logs').insert({
      org_id: orgId,
      node_id: newNode.id,
      event_type: 'memory.created',
      description: `Node created: ${nodeType} "${label}"`,
      actor: 'graph_builder',
    });

    return newNode.id;
  }

  // Helper: create edge if not exists
  async function ensureEdge(
    sourceId: string,
    targetId: string,
    relationType: string,
    weight: number = 0.5,
  ): Promise<void> {
    if (!sourceId || !targetId) return;

    const { data: existing } = await supabase
      .from('memory_edges')
      .select('id')
      .eq('org_id', orgId)
      .eq('source_id', sourceId)
      .eq('target_id', targetId)
      .eq('relation_type', relationType)
      .limit(1)
      .maybeSingle();

    if (existing) return;

    await supabase.from('memory_edges').insert({
      org_id: orgId,
      source_id: sourceId,
      target_id: targetId,
      relation_type: relationType,
      weight,
      confidence: 0.9,
    });
    result.edgesCreated++;
  }

  // ═══ PHASE 1: Ingest CRM entities as nodes ═══

  // ── Clients ──
  try {
    const { data: clients } = await supabase.from('clients')
      .select('id, first_name, last_name, company, status, email, phone')
      .eq('org_id', orgId).is('deleted_at', null).limit(200);

    for (const c of clients || []) {
      const name = `${c.first_name} ${c.last_name}`.trim();
      await upsertNode('client', name, `Client — ${c.company || 'Individual'} — ${c.status}`, c.id, {
        importance: 0.7,
        confidence: 0.95,
        layer: 'client',
        metadata: { email: c.email, phone: c.phone, company: c.company, status: c.status },
      });
    }
  } catch { /* silent */ }

  // ── Jobs ──
  try {
    const { data: jobs } = await supabase.from('jobs')
      .select('id, title, status, client_id, client_name, team_id, total_cents, job_type, scheduled_at')
      .eq('org_id', orgId).is('deleted_at', null).limit(200);

    for (const j of jobs || []) {
      const nodeId = await upsertNode('job', j.title || 'Untitled Job', `${j.job_type || 'Job'} — ${j.status} — $${((j.total_cents || 0) / 100).toFixed(0)}`, j.id, {
        importance: j.status === 'in_progress' ? 0.8 : j.status === 'completed' ? 0.5 : 0.6,
        confidence: 0.95,
        layer: 'company',
        clientId: j.client_id,
        metadata: { status: j.status, total_cents: j.total_cents, job_type: j.job_type },
      });

      // Edge: job -> client
      if (j.client_id) {
        const clientNodeId = nodeMap.get(`client:${j.client_id}`);
        if (clientNodeId && nodeId) {
          await ensureEdge(nodeId, clientNodeId, 'belongs_to', 0.8);
        }
      }

      // Edge: job -> team
      if (j.team_id) {
        const teamNodeId = nodeMap.get(`team_member:${j.team_id}`);
        if (teamNodeId && nodeId) {
          await ensureEdge(nodeId, teamNodeId, 'assigned_to', 0.7);
        }
      }
    }
  } catch { /* silent */ }

  // ── Invoices ──
  try {
    const { data: invoices } = await supabase.from('invoices')
      .select('id, invoice_number, status, client_id, total_cents, due_date, job_id')
      .eq('org_id', orgId).is('deleted_at', null).limit(200);

    for (const inv of invoices || []) {
      const nodeId = await upsertNode('invoice', `Invoice ${inv.invoice_number || inv.id.slice(0, 8)}`, `${inv.status} — $${((inv.total_cents || 0) / 100).toFixed(0)}`, inv.id, {
        importance: inv.status === 'sent' ? 0.7 : inv.status === 'paid' ? 0.4 : 0.5,
        confidence: 0.95,
        layer: 'company',
        clientId: inv.client_id,
        metadata: { status: inv.status, total_cents: inv.total_cents },
      });

      if (inv.client_id) {
        const clientNodeId = nodeMap.get(`client:${inv.client_id}`);
        if (clientNodeId && nodeId) await ensureEdge(nodeId, clientNodeId, 'billed_to', 0.8);
      }
      if (inv.job_id) {
        const jobNodeId = nodeMap.get(`job:${inv.job_id}`);
        if (jobNodeId && nodeId) await ensureEdge(nodeId, jobNodeId, 'created_from', 0.9);
      }
    }
  } catch { /* silent */ }

  // ── Quotes ──
  try {
    const { data: quotes } = await supabase.from('quotes')
      .select('id, title, status, client_id, total_cents')
      .eq('org_id', orgId).is('deleted_at', null).limit(200);

    for (const q of quotes || []) {
      const nodeId = await upsertNode('quote', q.title || `Quote ${q.id.slice(0, 8)}`, `${q.status} — $${((q.total_cents || 0) / 100).toFixed(0)}`, q.id, {
        importance: q.status === 'sent' ? 0.7 : 0.4,
        confidence: 0.95,
        layer: 'company',
        clientId: q.client_id,
      });

      if (q.client_id) {
        const clientNodeId = nodeMap.get(`client:${q.client_id}`);
        if (clientNodeId && nodeId) await ensureEdge(nodeId, clientNodeId, 'sent_to', 0.7);
      }
    }
  } catch { /* silent */ }

  // ── Leads ──
  try {
    const { data: leads } = await supabase.from('leads')
      .select('id, first_name, last_name, status, value, source')
      .eq('org_id', orgId).is('deleted_at', null).in('status', ['new', 'contacted', 'qualified']).limit(100);

    for (const l of leads || []) {
      await upsertNode('lead', `${l.first_name} ${l.last_name}`, `Lead — ${l.status} — $${l.value || 0}`, l.id, {
        importance: l.status === 'qualified' ? 0.8 : 0.5,
        confidence: 0.7,
        layer: 'company',
        metadata: { status: l.status, value: l.value, source: l.source },
      });
    }
  } catch { /* silent */ }

  // ── Teams ──
  try {
    const { data: teams } = await supabase.from('teams')
      .select('id, name, description, is_active')
      .eq('org_id', orgId).is('deleted_at', null);

    for (const t of teams || []) {
      await upsertNode('team_member', t.name, t.description || 'Team', t.id, {
        importance: t.is_active ? 0.7 : 0.3,
        confidence: 0.95,
        layer: 'company',
      });
    }
  } catch { /* silent */ }

  // ── Memory entities (existing LIA memory) ──
  try {
    const { data: memEntities } = await supabase.from('memory_entities')
      .select('*')
      .eq('org_id', orgId).limit(200);

    for (const me of memEntities || []) {
      const nodeType = me.entity_type === 'org_pattern' ? 'learned_pattern'
        : me.entity_type === 'preference' ? 'memory_note'
        : 'concept';

      await upsertNode(nodeType, me.key, JSON.stringify(me.value).slice(0, 200), me.id, {
        importance: 0.6,
        confidence: Number(me.confidence) || 0.5,
        layer: 'agentic',
        metadata: { entity_type: me.entity_type, value: me.value },
      });
    }
  } catch { /* silent */ }

  // ── Decision logs (agentic memory) ──
  try {
    const { data: decisions } = await supabase.from('decision_logs')
      .select('id, decision_type, input_summary, chosen_option, confidence, reasoning')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);

    for (const d of decisions || []) {
      await upsertNode('learned_pattern', `Decision: ${d.decision_type}`, d.reasoning?.slice(0, 200) || d.chosen_option || '', d.id, {
        importance: 0.5,
        confidence: Number(d.confidence) || 0.5,
        layer: 'agentic',
        metadata: { decision_type: d.decision_type, chosen_option: d.chosen_option },
      });
    }
  } catch { /* silent */ }

  // ═══ PHASE 2: Detect orphans ═══
  try {
    const { data: allNodes } = await supabase
      .from('memory_nodes')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_archived', false);

    if (allNodes) {
      const nodeIds = allNodes.map(n => n.id);

      // Get all nodes that appear in edges
      const { data: connectedEdges } = await supabase
        .from('memory_edges')
        .select('source_id, target_id')
        .eq('org_id', orgId);

      const connectedIds = new Set<string>();
      (connectedEdges || []).forEach(e => {
        connectedIds.add(e.source_id);
        connectedIds.add(e.target_id);
      });

      const orphanIds = nodeIds.filter(id => !connectedIds.has(id));

      // Mark orphans
      if (orphanIds.length > 0) {
        await supabase.from('memory_nodes')
          .update({ is_orphan: true })
          .eq('org_id', orgId)
          .in('id', orphanIds);
        result.orphansDetected = orphanIds.length;
      }

      // Unmark non-orphans
      const nonOrphanIds = nodeIds.filter(id => connectedIds.has(id));
      if (nonOrphanIds.length > 0) {
        await supabase.from('memory_nodes')
          .update({ is_orphan: false })
          .eq('org_id', orgId)
          .in('id', nonOrphanIds);
      }
    }
  } catch { /* silent */ }

  // ═══ PHASE 3: Create memory snapshot ═══
  try {
    const [nodesCount, edgesCount, orphanCount, conflictCount] = await Promise.all([
      supabase.from('memory_nodes').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_archived', false),
      supabase.from('memory_edges').select('*', { count: 'exact', head: true }).eq('org_id', orgId),
      supabase.from('memory_nodes').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_orphan', true),
      supabase.from('memory_conflicts').select('*', { count: 'exact', head: true }).eq('org_id', orgId).eq('resolved', false),
    ]);

    await supabase.from('memory_snapshots').insert({
      org_id: orgId,
      total_nodes: nodesCount.count || 0,
      total_edges: edgesCount.count || 0,
      orphan_count: orphanCount.count || 0,
      conflict_count: conflictCount.count || 0,
    });
  } catch { /* silent */ }

  console.log(`[graph-builder] Build complete for ${orgId}: ${result.nodesCreated} created, ${result.nodesUpdated} updated, ${result.edgesCreated} edges, ${result.orphansDetected} orphans`);
  return result;
}
