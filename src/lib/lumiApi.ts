/**
 * Lumi — l'assistant IA dans l'application. Client de /api/lumi/*.
 *
 * Le chat est un flux SSE sur une requête POST (EventSource ne fait que du
 * GET) : on lit le corps en continu et on découpe les événements
 * `event: x\ndata: {...}\n\n`. L'interface ne renvoie JAMAIS l'historique :
 * le serveur le garde et le rejoue.
 */
import { supabase } from './supabase';
import { deviceTokenHeader } from './deviceToken';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch { /* stockage indisponible */ }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    'x-org-id': activeOrg,
    ...deviceTokenHeader(),
  };
}

export interface BudgetLumi {
  plan_slug: string | null;
  includes_ai: boolean;
  budget_cents: number;
  depense_cents: number;
  reste_cents: number;
  epuise: boolean;
  configured?: boolean;
}

export type StatutProposition = 'en_attente' | 'confirmee' | 'annulee' | 'echouee';

/** Une fiche du CRM touchée par Lumi (client, job, devis…) : l'interface en fait un lien vers la page exacte. */
export type TypeFiche = 'client' | 'lead' | 'job' | 'quote' | 'invoice' | 'task';
export interface FicheLumi {
  type: TypeFiche;
  id: string;
  label: string;
  href: string;
  montant_cents?: number;
}

/** Aperçu d'une écriture proposée, composé par le serveur (taxes de l'org incluses). */
export interface ApercuDocumentLumi {
  genre: 'quote' | 'invoice';
  client: { name: string; company: string | null; email: string | null; phone: string | null; address: string | null } | null;
  title: string;
  lignes: Array<{ name: string; description: string | null; quantity: number; unit_price_cents: number; total_cents: number }>;
  subtotal_cents: number;
  taxes: Array<{ label: string; rate: number; amount_cents: number }>;
  total_cents: number;
  valid_days: number | null;
  notes: string | null;
}
export interface ApercuMessageLumi {
  genre: 'sms' | 'email';
  to: string | null;
  subject: string | null;
  body: string;
}
export interface FicheClientApercuLumi { id: string; name: string; company: string | null; email: string | null; phone: string | null; address: string | null; since: string | null; jobs: number; quotes: number; invoices: number }
export interface ApercuFusionLumi { genre: 'fusion'; garder: FicheClientApercuLumi | null; absorber: FicheClientApercuLumi | null }
export type ApercuLumi = ApercuDocumentLumi | ApercuMessageLumi | ApercuFusionLumi;

export interface PropositionLumi {
  tool_use_id: string;
  tool: string;
  args: Record<string, unknown>;
  capacite: string | null;
  statut: StatutProposition;
  apercu?: ApercuLumi | null;
  /** Ce que l'action a créé (reçu) : « Devis Q-0043 », avec son lien. */
  fiche?: FicheLumi | null;
  /** Confirmée sans clic, parce que l'utilisateur a choisi « toujours confirmer » ce type d'action. */
  auto?: boolean;
  /** Plusieurs écritures proposées d'un coup : une carte, une confirmation ; chaque ligne a son état et son reçu. */
  groupe?: PropositionLumi[];
}

/** Rapport composé par le serveur (build_report) : déjà formaté, rendu en carte et en PDF côté client. */
export interface SectionRapportLumi {
  titre: string;
  kpis?: Array<{ label: string; valeur: string; detail?: string }>;
  tableau?: { colonnes: string[]; lignes: string[][]; alignements?: Array<'g' | 'd'> };
  note?: string;
}
export interface RapportLumi {
  type: 'financier' | 'retards' | 'jobs' | 'client';
  titre: string;
  sous_titre: string;
  periode: { du: string; au: string } | null;
  genere_le: string;
  langue: 'fr' | 'en';
  sections: SectionRapportLumi[];
}

export interface MessageLumi {
  role: 'user' | 'assistant';
  text: string;
  tools: string[];
  proposal?: PropositionLumi;
  report?: RapportLumi;
  fiches?: FicheLumi[];
}

export interface ConversationLumi {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export type EvenementFlux =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; statut: 'debut' | 'fin' | 'refus' }
  | { type: 'proposal'; tool_use_id: string; tool: string; args: Record<string, unknown>; capacite: string | null; apercu?: ApercuLumi | null; auto?: boolean; groupe?: Array<{ tool_use_id: string; tool: string; args: Record<string, unknown>; capacite: string | null; apercu?: ApercuLumi | null }> }
  | { type: 'fiches'; fiches: FicheLumi[] }
  | { type: 'executed'; tool_use_id: string; ok: boolean; fiche: FicheLumi | null; auto?: boolean }
  | { type: 'report'; tool_use_id: string; rapport: RapportLumi }
  | { type: 'usage'; model: string; cost_cents: number }
  | { type: 'done'; conversation_id: string; cost_cents: number; budget: BudgetLumi; proposal: { tool_use_id: string; tool: string; args: Record<string, unknown> } | null }
  | { type: 'error'; message: string };

export class ErreurLumi extends Error {
  code: string;
  budget?: BudgetLumi;
  constructor(code: string, message: string, budget?: BudgetLumi) {
    super(message);
    this.code = code;
    this.budget = budget;
  }
}

/** Lit un flux SSE et appelle `onEvent` pour chaque événement. */
async function lireFlux(res: Response, onEvent: (e: EvenementFlux) => void, signal?: AbortSignal): Promise<void> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ErreurLumi(body?.code || `http_${res.status}`, body?.error || `HTTP ${res.status}`, body?.budget);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new ErreurLumi('flux', 'No stream');
  const decoder = new TextDecoder();
  let tampon = '';
  for (;;) {
    if (signal?.aborted) { await reader.cancel(); return; }
    const { value, done } = await reader.read();
    if (done) break;
    tampon += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = tampon.indexOf('\n\n')) !== -1) {
      const brut = tampon.slice(0, sep);
      tampon = tampon.slice(sep + 2);
      let type = 'message';
      const donnees: string[] = [];
      for (const ligne of brut.split('\n')) {
        if (ligne.startsWith('event:')) type = ligne.slice(6).trim();
        else if (ligne.startsWith('data:')) donnees.push(ligne.slice(5).trim());
      }
      if (!donnees.length) continue;
      try {
        onEvent({ ...(JSON.parse(donnees.join('\n')) as object), type } as EvenementFlux);
      } catch { /* événement illisible : on continue */ }
    }
  }
}

export async function envoyerMessageLumi(
  params: { conversation_id: string | null; message: string; language: 'fr' | 'en' },
  onEvent: (e: EvenementFlux) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/lumi/chat`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  });
  await lireFlux(res, onEvent, signal);
}

export async function deciderPropositionLumi(
  params: { conversation_id: string; tool_use_id: string; decision: 'confirm' | 'cancel'; language: 'fr' | 'en' },
  onEvent: (e: EvenementFlux) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/lumi/execute`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(params),
    signal,
  });
  await lireFlux(res, onEvent, signal);
}

/** Outils d'écriture que l'utilisateur a choisi de ne plus confirmer (« toujours confirmer »), côté serveur. */
export async function listerAutorisationsLumi(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/lumi/autorisations`, { headers: await authHeaders() });
  if (!res.ok) throw new ErreurLumi(`http_${res.status}`, 'Unable to load authorizations');
  return ((await res.json()) as { tools: string[] }).tools;
}
export async function definirAutorisationLumi(tool: string, actif: boolean): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/lumi/autorisations`, { method: 'PUT', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, actif }) });
  if (!res.ok) throw new ErreurLumi(`http_${res.status}`, 'Unable to update authorizations');
  return ((await res.json()) as { tools: string[] }).tools;
}

export async function quotaLumi(): Promise<BudgetLumi> {
  const res = await fetch(`${API_BASE}/api/lumi/quota`, { headers: await authHeaders() });
  if (!res.ok) throw new ErreurLumi(`http_${res.status}`, 'quota');
  return res.json();
}

export async function listerConversationsLumi(): Promise<ConversationLumi[]> {
  const res = await fetch(`${API_BASE}/api/lumi/conversations`, { headers: await authHeaders() });
  if (!res.ok) throw new ErreurLumi(`http_${res.status}`, 'conversations');
  return (await res.json()).conversations ?? [];
}

export async function chargerConversationLumi(id: string): Promise<{ conversation: ConversationLumi; messages: MessageLumi[] }> {
  const res = await fetch(`${API_BASE}/api/lumi/conversations/${encodeURIComponent(id)}`, { headers: await authHeaders() });
  if (!res.ok) throw new ErreurLumi(`http_${res.status}`, 'conversation');
  return res.json();
}

export async function supprimerConversationLumi(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/lumi/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
  if (!res.ok) throw new ErreurLumi(`http_${res.status}`, 'suppression');
}
