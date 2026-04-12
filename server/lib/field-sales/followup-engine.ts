/**
 * Follow-up Intelligence Engine
 *
 * Prioritizes:
 * - Unclosed quotes
 * - Inactive leads
 * - High-potential follow-ups
 * - Stale callbacks
 *
 * Returns ranked actions for each rep.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FollowUpAction {
  id: string;
  type: 'call_client' | 'reknock' | 'follow_up_quote' | 'follow_up_lead' | 'schedule_job';
  entity_type: string;
  entity_id: string;
  score: number;
  title: string;
  description: string;
  address?: string;
  client_name?: string;
  days_since_activity: number;
  pin_id?: string;
}

// ---------------------------------------------------------------------------
// Main: get follow-up recommendations for a rep
// ---------------------------------------------------------------------------

export async function getFollowUpRecommendations(
  admin: SupabaseClient,
  orgId: string,
  userId?: string,
  limit = 15
): Promise<FollowUpAction[]> {
  const actions: FollowUpAction[] = [];
  const now = new Date();

  // 1. Unclosed quotes (sent but not accepted/declined for > 2 days)
  const { data: quotes } = await admin
    .from('quotes')
    .select('id, title, client_id, status, sent_at, total_cents, clients!inner(first_name, last_name, address)')
    .eq('org_id', orgId)
    .in('status', ['sent', 'viewed'])
    .is('deleted_at', null)
    .order('sent_at', { ascending: true })
    .limit(20);

  for (const q of quotes ?? []) {
    const sentDate = q.sent_at ? new Date(q.sent_at) : now;
    const daysSince = Math.floor((now.getTime() - sentDate.getTime()) / 86400000);
    if (daysSince < 1) continue; // too fresh

    const client = (q as any).clients;
    const urgency = Math.min(daysSince * 5, 40) + ((q.total_cents ?? 0) > 50000 ? 30 : 15);

    actions.push({
      id: `quote-${q.id}`,
      type: 'follow_up_quote',
      entity_type: 'quote',
      entity_id: q.id,
      score: Math.min(100, urgency + 20),
      title: `Follow up on quote: ${q.title || 'Untitled'}`,
      description: `Quote sent ${daysSince} day${daysSince > 1 ? 's' : ''} ago to ${client?.first_name ?? 'client'} ${client?.last_name ?? ''}. $${((q.total_cents ?? 0) / 100).toFixed(0)} value.`,
      client_name: client ? `${client.first_name} ${client.last_name}` : undefined,
      address: client?.address,
      days_since_activity: daysSince,
    });
  }

  // 2. Stale leads (no activity in > 3 days)
  let leadsQuery = admin
    .from('leads')
    .select('id, first_name, last_name, status, value, updated_at, phone, email')
    .eq('org_id', orgId)
    .in('status', ['new', 'contacted', 'qualified', 'new_prospect'])
    .is('deleted_at', null)
    .order('updated_at', { ascending: true })
    .limit(20);

  if (userId) leadsQuery = leadsQuery.eq('assigned_to', userId);

  const { data: leads } = await leadsQuery;

  for (const lead of leads ?? []) {
    const updatedDate = lead.updated_at ? new Date(lead.updated_at) : now;
    const daysSince = Math.floor((now.getTime() - updatedDate.getTime()) / 86400000);
    if (daysSince < 2) continue;

    const urgency = Math.min(daysSince * 4, 35) + ((lead.value ?? 0) > 1000 ? 25 : 10);

    actions.push({
      id: `lead-${lead.id}`,
      type: 'follow_up_lead',
      entity_type: 'lead',
      entity_id: lead.id,
      score: Math.min(100, urgency + 15),
      title: `Follow up with ${lead.first_name ?? ''} ${lead.last_name ?? ''}`,
      description: `Lead inactive for ${daysSince} day${daysSince > 1 ? 's' : ''}. Status: ${lead.status}. ${lead.phone ? `Call ${lead.phone}` : lead.email ? `Email ${lead.email}` : ''}`,
      client_name: `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim(),
      days_since_activity: daysSince,
    });
  }

  // 3. Pins with callback/follow_up status that are overdue
  let pinsQuery = admin
    .from('field_house_profiles')
    .select('id, address, current_status, last_activity_at, reknock_priority_score, assigned_user_id')
    .eq('org_id', orgId)
    .in('current_status', ['callback', 'follow_up', 'no_answer', 'revisit'])
    .is('deleted_at', null)
    .order('reknock_priority_score', { ascending: false })
    .limit(20);

  if (userId) pinsQuery = pinsQuery.eq('assigned_user_id', userId);

  const { data: pins } = await pinsQuery;

  for (const pin of pins ?? []) {
    const lastActivity = pin.last_activity_at ? new Date(pin.last_activity_at) : now;
    const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / 86400000);

    const ACTION_TYPE_MAP: Record<string, FollowUpAction['type']> = {
      callback: 'call_client',
      follow_up: 'reknock',
      no_answer: 'reknock',
      revisit: 'reknock',
    };

    actions.push({
      id: `pin-${pin.id}`,
      type: ACTION_TYPE_MAP[pin.current_status] ?? 'reknock',
      entity_type: 'pin',
      entity_id: pin.id,
      score: pin.reknock_priority_score ?? Math.min(100, daysSince * 5 + 30),
      title: pin.current_status === 'callback'
        ? `Call back: ${pin.address}`
        : `Reknock: ${pin.address}`,
      description: `${pin.current_status === 'callback' ? 'Callback requested' : pin.current_status === 'no_answer' ? 'No one was home' : 'Follow up visit needed'}. Last activity ${daysSince} day${daysSince > 1 ? 's' : ''} ago.`,
      address: pin.address,
      days_since_activity: daysSince,
      pin_id: pin.id,
    });
  }

  // Sort by score descending
  actions.sort((a, b) => b.score - a.score);
  return actions.slice(0, limit);
}
