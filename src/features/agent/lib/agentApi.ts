/* ═══════════════════════════════════════════════════════════════
   Lume Agent — Frontend API Client
   ─────────────────────────────────────────────────────────────
   - sendAgentMessage: one chat turn (server runs the Gemini tool loop).
   - executeProposedAction: runs a confirmed write action through the
     existing, battle-tested *Api.ts helpers (RLS + automations apply).
   The external-agent login flow (connectExternalAgent) is unchanged.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from '../../../lib/supabase';
import { createQuote } from '../../../lib/quotesApi';
import { createInvoiceDraft, saveInvoiceDraft } from '../../../lib/invoicesApi';
import { createJob } from '../../../lib/jobsApi';
import { sendSms } from '../../../lib/messagingApi';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ProposedActionType = 'create_quote' | 'create_invoice' | 'create_job' | 'send_sms';

export interface ProposedAction {
  type: ProposedActionType;
  payload: Record<string, any>;
}

export interface AgentChatResponse {
  reply: string;
  proposedAction: ProposedAction | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  // Office actif : Mr Lume ne doit voir QUE cet office (aucun mélange entre
  // offices). Le serveur scope dessus si l'utilisateur en est membre.
  try {
    const activeOrg = localStorage.getItem('lume-active-org');
    if (activeOrg) headers['x-org-id'] = activeOrg;
  } catch {}
  return headers;
}

/** Send one chat turn. `messages` is the running transcript (oldest → newest). */
export async function sendAgentMessage(
  messages: AgentMessage[],
  language: 'fr' | 'en',
): Promise<AgentChatResponse> {
  const res = await fetch('/api/agent/chat', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ messages, language }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Agent request failed (${res.status}).`);
  }
  return { reply: json.reply || '', proposedAction: json.proposedAction || null };
}

export interface ActionResult {
  reference: string; // e.g. quote/invoice/job number, or 'SMS'
}

/** Execute a user-confirmed write action via the existing client APIs. */
export async function executeProposedAction(action: ProposedAction): Promise<ActionResult> {
  const p = action.payload || {};

  switch (action.type) {
    case 'create_quote': {
      const lineItems = (p.line_items || []).map((li: any, i: number) => ({
        name: String(li.name || '').trim(),
        description: li.description ?? null,
        quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
        unit_price_cents: Math.round(Number(li.unit_price_cents) || 0),
        sort_order: i,
        item_type: 'service' as const,
      }));
      const detail = await createQuote({
        client_id: p.client_id || null,
        lead_id: p.lead_id || null,
        title: String(p.title || 'Quote'),
        context_type: p.client_id ? 'client' : 'lead',
        valid_days: Number(p.valid_days) > 0 ? Number(p.valid_days) : undefined,
        notes: p.notes ?? null,
        line_items: lineItems,
      });
      return { reference: detail?.quote?.quote_number || 'quote' };
    }

    case 'create_invoice': {
      if (!p.client_id) throw new Error('A client is required to create an invoice.');
      const draft = await createInvoiceDraft({
        clientId: String(p.client_id),
        subject: p.subject ?? null,
        dueDate: p.due_date ?? null,
      });
      const items = (p.items || []).map((it: any) => ({
        description: String(it.description || '').trim(),
        qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
        unit_price_cents: Math.round(Number(it.unit_price_cents) || 0),
      }));
      await saveInvoiceDraft({
        invoiceId: draft.id,
        subject: p.subject ?? null,
        dueDate: p.due_date ?? null,
        taxCents: Math.round(Number(p.tax_cents) || 0),
        items,
      });
      return { reference: draft.invoice_number || 'invoice' };
    }

    case 'create_job': {
      const lineItems = (p.line_items || []).map((li: any) => ({
        name: String(li.name || '').trim(),
        qty: Number(li.qty) > 0 ? Number(li.qty) : 1,
        unit_price_cents: Math.round(Number(li.unit_price_cents) || 0),
        included: true,
      }));
      const job: any = await createJob({
        title: String(p.title || 'Job'),
        client_id: p.client_id || null,
        property_address: p.property_address ?? null,
        scheduled_at: p.scheduled_at ?? null,
        description: p.description ?? null,
        status: 'draft',
        line_items: lineItems.length ? lineItems : undefined,
      });
      return { reference: job?.job_number || job?.title || 'job' };
    }

    case 'send_sms': {
      if (!p.phone_number) throw new Error('A phone number is required to send an SMS.');
      await sendSms({
        phone_number: String(p.phone_number),
        message_text: String(p.message_text || ''),
        client_id: p.client_id || undefined,
        client_name: p.client_name || undefined,
      });
      return { reference: 'SMS' };
    }

    default:
      throw new Error(`Unsupported action: ${(action as any).type}`);
  }
}

/**
 * Exchange an external-agent API token for a short-lived JWT.
 * The returned JWT authorises the external agent to POST messages
 * via /api/agent/webhook into the user's chat (RLS-scoped by org_id).
 */
export async function connectExternalAgent(token: string): Promise<
  | { ok: true; jwt: string; expiresIn: number }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch('/api/agent/connect', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ token }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.jwt) {
      return { ok: false, error: json?.error || `connect failed: ${res.status}` };
    }
    return { ok: true, jwt: json.jwt, expiresIn: json.expiresIn || 0 };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Connection error' };
  }
}
