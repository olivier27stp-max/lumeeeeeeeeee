import { supabase } from './supabase';

export type SupportCategory = 'question' | 'bug' | 'billing' | 'feature' | 'other';

export interface SupportRequestInput {
  subject: string;
  message: string;
  category?: SupportCategory;
}

/** Délai de première réponse, dérivé du forfait côté serveur. */
export type SlaKey = '4h' | '1d' | '2d';

export interface SupportRequestResult {
  ok: true;
  ticketId?: string;
  priority: 'priority' | 'normal';
  /** Libellé anglais, destiné à l'email interne. Préférer `slaKey` à l'écran. */
  sla: string;
  /** Absent des serveurs antérieurs à l'ajout de la clé — traiter comme optionnel. */
  slaKey?: SlaKey;
}

/** Erreur enrichie : `code` permet de traduire, `supportEmail` d'offrir un repli. */
export interface SupportRequestError extends Error {
  code?: 'mailer_unconfigured' | 'send_failed' | 'ai_unconfigured' | 'closed';
  supportEmail?: string;
  status?: number;
}

// ── Conversation (assistant IA, puis humain via Slack) ─────────
export type SupportTicketStatus = 'ai' | 'open' | 'answered' | 'closed';
export interface SupportMessage {
  id: string;
  author: 'user' | 'ai' | 'agent';
  authorName: string | null;
  body: string;
  createdAt: string;
}
export interface SupportTicket {
  id: string;
  subject: string;
  category: string | null;
  status: SupportTicketStatus;
  priority: 'priority' | 'normal';
  slaKey: SlaKey | null;
  createdAt: string;
  lastMessageAt: string;
  escalatedAt: string | null;
  closedAt: string | null;
  messages: SupportMessage[];
}
export interface SupportChatResult {
  ticket: SupportTicket;
  /** Réponse de l'assistant ; null quand le message est parti à un humain. */
  reply: string | null;
  escalated: boolean;
  slaKey: SlaKey;
  sla: string;
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
  };
}

async function appel<T>(chemin: string, init?: RequestInit): Promise<T> {
  const response = await fetch(chemin, { ...init, headers: { ...(await authHeaders()), ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Le message du serveur est anglais : on transporte `code` et
    // `supportEmail` pour que l'appelant le reformule dans la langue de l'UI.
    const err = new Error(data.error || 'Could not reach support.') as SupportRequestError;
    err.code = data.code;
    err.supportEmail = data.supportEmail;
    err.status = response.status;
    throw err;
  }
  return data as T;
}

export async function submitSupportRequest(input: SupportRequestInput): Promise<SupportRequestResult> {
  return appel<SupportRequestResult>('/api/support', { method: 'POST', body: JSON.stringify(input) });
}

/** Un tour avec l'assistant (ou un transfert direct à un humain avec `humain: true`). */
export async function chatSupport(input: { ticketId?: string; message: string; humain?: boolean; origine?: 'texte' | 'suggestion' }): Promise<SupportChatResult> {
  return appel<SupportChatResult>('/api/support/chat', { method: 'POST', body: JSON.stringify(input) });
}

export async function sendSupportMessage(ticketId: string, message: string): Promise<{ ticket: SupportTicket }> {
  return appel<{ ticket: SupportTicket }>(`/api/support/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
}

export async function escalateSupportTicket(ticketId: string, reason?: string): Promise<{ ticket: SupportTicket; slaKey: SlaKey; sla: string }> {
  return appel(`/api/support/${ticketId}/escalate`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function closeSupportTicket(ticketId: string): Promise<void> {
  await appel(`/api/support/${ticketId}/close`, { method: 'POST', body: '{}' });
}

export async function listSupportTickets(): Promise<{ tickets: SupportTicket[]; aiConfigured: boolean; humanChannel: 'slack' | 'email' | 'none' }> {
  return appel('/api/support/tickets');
}

export async function getSupportTicket(ticketId: string): Promise<{ ticket: SupportTicket }> {
  return appel(`/api/support/tickets/${ticketId}`);
}
