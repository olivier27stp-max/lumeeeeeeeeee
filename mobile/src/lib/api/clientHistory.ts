// Unified client history — EVERY action tied to a client, merged into one
// timeline: jobs (created/completed), scheduled visits, quotes, invoices,
// payments, SMS in/out, plus the shared activity_log events (lead lifecycle,
// review requests…). Same source tables as the web ClientDetails sections,
// interleaved by date instead of split into boxes.

import { supabase } from '../supabase';

import { ActivityLogEntry, activityLabel, listActivityLog } from './activity';

export type ClientHistoryKind =
  | 'job'
  | 'job_completed'
  | 'visit'
  | 'quote'
  | 'invoice'
  | 'payment'
  | 'message_in'
  | 'message_out'
  | 'activity';

export interface ClientHistoryItem {
  id: string;
  kind: ClientHistoryKind;
  date: string; // ISO
  title: string;
  subtitle?: string;
  amountCents?: number | null;
  /** Route to open when tapped (job / invoice / quote / conversation). */
  route?: string;
}

const ns = (v: string | null | undefined) => String(v || '').trim().toLowerCase();

export async function getClientHistory(
  orgId: string,
  clientId: string,
  lang: 'fr' | 'en',
): Promise<ClientHistoryItem[]> {
  const fr = lang === 'fr';

  const [jobsRes, quotesRes, invoicesRes, convsRes, activity] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, title, status, total_cents, created_at, completed_at')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .is('deleted_at', null),
    supabase
      .from('quotes')
      .select('id, quote_number, title, status, total_cents, created_at')
      .eq('org_id', orgId)
      .eq('client_id', clientId)
      .is('deleted_at', null),
    supabase
      .from('invoices')
      .select('id, invoice_number, status, total_cents, balance_cents, created_at')
      .eq('org_id', orgId)
      .eq('client_id', clientId),
    supabase.from('conversations').select('id').eq('org_id', orgId).eq('client_id', clientId),
    listActivityLog(orgId, 'client', clientId, 50).catch(() => [] as ActivityLogEntry[]),
  ]);

  const jobs = jobsRes.data ?? [];
  const quotes = quotesRes.data ?? [];
  const invoices = invoicesRes.data ?? [];
  const convIds = (convsRes.data ?? []).map((c: any) => c.id);

  // Dependent reads: visits (via the client's jobs), payments (via invoices),
  // messages (via conversations).
  const jobIds = jobs.map((j: any) => j.id);
  const invoiceIds = invoices.map((i: any) => i.id);
  const [eventsRes, paymentsRes, messagesRes] = await Promise.all([
    jobIds.length
      ? supabase
          .from('schedule_events')
          .select('id, job_id, start_at, status, created_at')
          .eq('org_id', orgId)
          .in('job_id', jobIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] as any[] }),
    invoiceIds.length
      ? supabase.from('payments').select('id, amount_cents, payment_date, method, created_at').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as any[] }),
    convIds.length
      ? supabase
          .from('messages')
          .select('id, direction, body, created_at, conversation_id')
          .in('conversation_id', convIds)
          .order('created_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const jobTitle = new Map<string, string>(jobs.map((j: any) => [j.id, j.title]));
  const items: ClientHistoryItem[] = [];

  for (const j of jobs as any[]) {
    items.push({
      id: `job-${j.id}`,
      kind: 'job',
      date: j.created_at,
      title: fr ? 'Job créée' : 'Job created',
      subtitle: j.title,
      amountCents: j.total_cents ?? null,
      route: `/(app)/jobs/${j.id}`,
    });
    if (j.completed_at) {
      items.push({
        id: `jobdone-${j.id}`,
        kind: 'job_completed',
        date: j.completed_at,
        title: fr ? 'Job complétée' : 'Job completed',
        subtitle: j.title,
        route: `/(app)/jobs/${j.id}`,
      });
    }
  }

  for (const e of (eventsRes.data ?? []) as any[]) {
    items.push({
      id: `visit-${e.id}`,
      kind: 'visit',
      date: e.start_at,
      title: fr ? 'Visite planifiée' : 'Visit scheduled',
      subtitle: jobTitle.get(e.job_id) ?? undefined,
      route: e.job_id ? `/(app)/jobs/${e.job_id}` : undefined,
    });
  }

  for (const q of quotes as any[]) {
    const st = ns(q.status);
    const stLabel =
      st === 'approved' || st === 'converted'
        ? fr
          ? 'acceptée'
          : 'accepted'
        : st === 'declined'
          ? fr
            ? 'refusée'
            : 'declined'
          : st === 'sent'
            ? fr
              ? 'envoyée'
              : 'sent'
            : st;
    items.push({
      id: `quote-${q.id}`,
      kind: 'quote',
      date: q.created_at,
      title: `${fr ? 'Soumission' : 'Quote'}${q.quote_number ? ` ${q.quote_number}` : ''}${stLabel ? ` · ${stLabel}` : ''}`,
      subtitle: q.title ?? undefined,
      amountCents: q.total_cents ?? null,
    });
  }

  for (const inv of invoices as any[]) {
    const paid = (inv.balance_cents ?? 0) <= 0 && ns(inv.status) !== 'draft';
    items.push({
      id: `inv-${inv.id}`,
      kind: 'invoice',
      date: inv.created_at,
      title: `${fr ? 'Facture' : 'Invoice'}${inv.invoice_number ? ` ${inv.invoice_number}` : ''}${paid ? (fr ? ' · payée' : ' · paid') : ''}`,
      amountCents: inv.total_cents ?? null,
    });
  }

  for (const p of (paymentsRes.data ?? []) as any[]) {
    items.push({
      id: `pay-${p.id}`,
      kind: 'payment',
      date: p.payment_date ?? p.created_at,
      title: fr ? 'Paiement reçu' : 'Payment received',
      subtitle: p.method ?? undefined,
      amountCents: p.amount_cents ?? null,
    });
  }

  for (const m of (messagesRes.data ?? []) as any[]) {
    const out = ns(m.direction) === 'outbound';
    items.push({
      id: `msg-${m.id}`,
      kind: out ? 'message_out' : 'message_in',
      date: m.created_at,
      title: out ? (fr ? 'SMS envoyé' : 'SMS sent') : fr ? 'SMS reçu' : 'SMS received',
      subtitle: typeof m.body === 'string' ? m.body.slice(0, 80) : undefined,
      route: `/(app)/conversation/${m.conversation_id}`,
    });
  }

  // Shared activity_log — skip event types already represented by real rows
  // above (job/invoice/appointment lifecycles), keep the rest (lead lifecycle,
  // review requests, follow-ups…).
  const covered = new Set([
    'job_created',
    'job_completed',
    'invoice_created',
    'invoice_paid',
    'appointment_created',
    'appointment_updated',
    'appointment_cancelled',
  ]);
  for (const a of activity) {
    if (covered.has(a.event_type)) continue;
    items.push({
      id: `act-${a.id}`,
      kind: 'activity',
      date: a.created_at,
      title: activityLabel(a.event_type, lang),
    });
  }

  return items
    .filter((i) => i.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
