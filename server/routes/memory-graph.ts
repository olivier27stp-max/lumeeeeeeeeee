/* ═══════════════════════════════════════════════════════════════
   Memory Graph — API Routes
   Endpoints for the memory graph visualization and management.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import { buildMemoryGraph } from '../lib/memory-graph/graph-builder';
import {
  detectStaleness,
  checkPromotionCandidates,
  detectDuplicates,
} from '../lib/memory-graph/memory-events';

const router = Router();

// ── POST /memory-graph/build — Trigger graph rebuild ──────
router.post('/memory-graph/build', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const supabase = getServiceClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Get org_id from memberships
    const { data: membership } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!membership) return res.status(403).json({ error: 'No org membership' });

    const result = await buildMemoryGraph(supabase, membership.org_id);
    res.json({ success: true, result });
  } catch (err: any) {
    console.error('[memory-graph] Build error:', err);
    res.status(500).json({ error: err.message || 'Build failed' });
  }
});

// ── POST /memory-graph/lint — Run memory health checks ────
router.post('/memory-graph/lint', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const supabase = getServiceClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const { data: membership } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!membership) return res.status(403).json({ error: 'No org membership' });

    const orgId = membership.org_id;

    const [staleCount, promotedCount, duplicateCount] = await Promise.all([
      detectStaleness(supabase, orgId),
      checkPromotionCandidates(supabase, orgId),
      detectDuplicates(supabase, orgId),
    ]);

    res.json({
      success: true,
      results: {
        stale_nodes_flagged: staleCount,
        nodes_promoted: promotedCount,
        duplicates_detected: duplicateCount,
      },
    });
  } catch (err: any) {
    console.error('[memory-graph] Lint error:', err);
    res.status(500).json({ error: err.message || 'Lint failed' });
  }
});

// ── POST /memory-graph/lint-node — Lint a specific node ───
router.post('/memory-graph/lint-node', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const supabase = getServiceClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ error: 'nodeId required' });

    const { data: node } = await supabase
      .from('memory_nodes')
      .select('*')
      .eq('id', nodeId)
      .single();

    if (!node) return res.status(404).json({ error: 'Node not found' });

    const issues: string[] = [];

    // Check staleness
    const daysSinceUpdate = (Date.now() - new Date(node.freshness_at).getTime()) / 86400000;
    if (daysSinceUpdate > 30) issues.push(`Stale: not updated in ${Math.round(daysSinceUpdate)} days`);

    // Check orphan status
    const { count: edgeCount } = await supabase
      .from('memory_edges')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', node.org_id)
      .or(`source_id.eq.${nodeId},target_id.eq.${nodeId}`);

    if (!edgeCount || edgeCount === 0) issues.push('Orphan: no connections');

    // Check low confidence
    if (Number(node.confidence) < 0.3) issues.push(`Low confidence: ${node.confidence}`);

    // Check for conflicts
    const { data: conflicts } = await supabase
      .from('memory_conflicts')
      .select('description')
      .eq('org_id', node.org_id)
      .eq('resolved', false)
      .or(`node_a_id.eq.${nodeId},node_b_id.eq.${nodeId}`);

    if (conflicts?.length) {
      issues.push(`${conflicts.length} unresolved conflict(s)`);
    }

    // Check for duplicates
    const { data: dupes } = await supabase
      .from('memory_edges')
      .select('target_id')
      .eq('org_id', node.org_id)
      .eq('source_id', nodeId)
      .eq('relation_type', 'duplicate_of');

    if (dupes?.length) {
      issues.push(`${dupes.length} potential duplicate(s)`);
    }

    // Check source count
    if (node.source_count === 0) issues.push('No sources — unverified memory');

    const health = issues.length === 0 ? 'healthy' : issues.length <= 2 ? 'warning' : 'critical';

    res.json({
      nodeId,
      health,
      issues,
      suggestions: issues.map(i => {
        if (i.includes('Stale')) return 'Refresh this memory by verifying the information is still current';
        if (i.includes('Orphan')) return 'Link this node to related entities to provide context';
        if (i.includes('Low confidence')) return 'Add more sources to increase confidence';
        if (i.includes('conflict')) return 'Review and resolve contradictions';
        if (i.includes('duplicate')) return 'Consider merging duplicate nodes';
        if (i.includes('No sources')) return 'Add source evidence to validate this memory';
        return 'Review and update this node';
      }),
    });
  } catch (err: any) {
    console.error('[memory-graph] Lint-node error:', err);
    res.status(500).json({ error: err.message || 'Lint failed' });
  }
});

export default router;
