/* ═══════════════════════════════════════════════════════════════
   Token Optimizer — Maximum savings, zero waste
   ═══════════════════════════════════════════════════════════════ */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── 1. LOCAL INTENT DETECTION (zero tokens) ──────────────────
// Regex-based detection for common patterns — avoids calling Gemini entirely

export interface LocalIntent {
  type: 'query' | 'action' | 'scenario_request' | 'followup' | 'chat' | 'composite';
  domain: string;
  entities: Record<string, string>;
  confidence: number;
}

const GREETING_REGEX = /^(hi|hello|hey|bonjour|salut|allo|merci|thanks|ok|oui|non|yes|no|bye|ciao|yo|sup)\s*[.!?]*$/i;
const BRIEFING_REGEX = /\b(prepare|brief|resume|briefing|journee|day|overview|morning|comment.*va|how.*going|what.*new|quoi.*neuf)\b/i;
const STATUS_REGEX = /\b(status|statut|combien|how many|etat|state|progress)\b/i;
const ASSIGN_REGEX = /\b(assign|assigne|equipe|team|who should)\b/i;
const PRICE_REGEX = /\b(price|prix|quote|devis|combien.*coute|how much|estimate)\b/i;
const INVOICE_REGEX = /\b(invoice|facture|send.*invoice|envoie.*facture|bill)\b/i;
const SCHEDULE_REGEX = /\b(schedule|planifie|quand|when|book|reserve|disponible|available)\b/i;
const LEAD_REGEX = /\b(lead|prospect|convert|convertir)\b/i;
const PAYMENT_REGEX = /\b(payment|paiement|paid|paye|received|recu)\b/i;
const THANKS_REGEX = /^(merci|thanks|thank you|parfait|perfect|genial|great|awesome|nice|cool|bon|ok|d'accord|got it|noted)\s*[.!?]*$/i;

export function detectIntentLocally(message: string, hasHistory: boolean): LocalIntent | null {
  const msg = message.trim().toLowerCase();

  // Greetings & thanks — 100% local, zero tokens
  if (GREETING_REGEX.test(msg) || THANKS_REGEX.test(msg)) {
    return { type: 'chat', domain: 'general', entities: {}, confidence: 0.95 };
  }

  // Briefing — local detection, still needs brain data but no Gemini intent call
  if (BRIEFING_REGEX.test(msg)) {
    return { type: 'query', domain: 'general', entities: {}, confidence: 0.9 };
  }

  // Simple status queries
  if (STATUS_REGEX.test(msg) && !ASSIGN_REGEX.test(msg) && !PRICE_REGEX.test(msg)) {
    return { type: 'query', domain: 'general', entities: {}, confidence: 0.8 };
  }

  // Team assignment
  if (ASSIGN_REGEX.test(msg)) {
    return { type: 'scenario_request', domain: 'team_assignment', entities: {}, confidence: 0.75 };
  }

  // Pricing
  if (PRICE_REGEX.test(msg)) {
    return { type: 'query', domain: 'pricing', entities: {}, confidence: 0.75 };
  }

  // Invoice
  if (INVOICE_REGEX.test(msg)) {
    return { type: 'action', domain: 'invoicing', entities: {}, confidence: 0.75 };
  }

  // Scheduling
  if (SCHEDULE_REGEX.test(msg)) {
    return { type: 'query', domain: 'scheduling', entities: {}, confidence: 0.75 };
  }

  // Lead
  if (LEAD_REGEX.test(msg)) {
    return { type: 'query', domain: 'convert_lead', entities: {}, confidence: 0.7 };
  }

  // Payment
  if (PAYMENT_REGEX.test(msg)) {
    return { type: 'action', domain: 'record_payment', entities: {}, confidence: 0.7 };
  }

  // Short followup messages (< 30 chars, has history)
  if (msg.length < 30 && hasHistory) {
    return { type: 'followup', domain: 'general', entities: {}, confidence: 0.6 };
  }

  // Can't detect locally — need Gemini
  return null;
}

// ── 2. KNOWLEDGE SECTION SPLITTING ───────────────────────────
// Instead of sending 4000-token knowledge base, send only relevant sections

export type KnowledgeSection = 'identity' | 'entities' | 'rules' | 'decisions' | 'proactive' | 'learning';

const SECTION_BY_DOMAIN: Record<string, KnowledgeSection[]> = {
  team_assignment: ['identity', 'decisions'],
  pricing: ['identity', 'decisions'],
  scheduling: ['identity', 'entities'],
  invoicing: ['identity', 'rules'],
  followup: ['identity', 'proactive'],
  convert_lead: ['identity', 'rules'],
  send_invoice: ['identity', 'rules'],
  record_payment: ['identity', 'rules'],
  update_job_status: ['identity', 'rules'],
  update_lead_status: ['identity', 'rules'],
  general: ['identity', 'proactive'],
  reporting: ['identity'],
  client_info: ['identity'],
};

export function getRelevantSections(domain: string | undefined, intentType: string | undefined): KnowledgeSection[] {
  if (intentType === 'chat') return ['identity'];
  if (intentType === 'followup') return ['identity'];
  return SECTION_BY_DOMAIN[domain || 'general'] || ['identity', 'rules'];
}

// ── 3. SMART STATE SKIPPING ──────────────────────────────────

export type FastRoute = {
  startState: 'understand' | 'fetch_context' | 'check_memory' | 'recommend';
  skipBrain: boolean;
  skipMemory: boolean;
  maxOutputTokens: number;
};

export function determineFastRoute(
  intentType: string | undefined,
  confidence: number,
  messageLength: number,
): FastRoute {
  // Chat/greeting — skip everything, straight to recommend
  if (intentType === 'chat') {
    return { startState: 'recommend', skipBrain: true, skipMemory: true, maxOutputTokens: 200 };
  }

  // Followup with high confidence — skip understand + fetch, use existing context
  if (intentType === 'followup' && confidence >= 0.7) {
    return { startState: 'recommend', skipBrain: false, skipMemory: true, maxOutputTokens: 512 };
  }

  // Simple query (short message, high confidence) — skip memory + decide
  if (intentType === 'query' && confidence >= 0.8 && messageLength < 60) {
    return { startState: 'fetch_context', skipBrain: false, skipMemory: true, maxOutputTokens: 512 };
  }

  // Everything else — full pipeline
  return { startState: 'understand', skipBrain: false, skipMemory: false, maxOutputTokens: 1024 };
}

// ── 4. HISTORY COMPRESSION ───────────────────────────────────

export function compressHistory(
  history: { role: string; content: string }[],
  maxTokens: number = 800,
): { role: string; content: string }[] {
  if (history.length === 0) return [];

  const recent = history.slice(-4);
  const recentTokens = recent.reduce((s, m) => s + estimateTokens(m.content), 0);

  if (recentTokens <= maxTokens || history.length <= 4) return recent;

  // Aggressive compression: only last 2 messages + 1-line summary
  if (maxTokens <= 300) {
    const last2 = history.slice(-2);
    return [
      { role: 'user', content: `[${history.length - 2} prior messages]` },
      ...last2,
    ];
  }

  const older = history.slice(0, -4);
  const summary = older.map((m) => {
    const truncated = m.content.length > 50 ? m.content.slice(0, 50) + '...' : m.content;
    return `${m.role}: ${truncated}`;
  }).join(' | ');

  return [
    { role: 'user', content: `[Prior: ${summary}]` },
    ...recent,
  ];
}

// ── 5. BRAIN PRUNING ─────────────────────────────────────────

export function pruneBrain(
  brainSummary: string,
  domain: string | undefined,
  intentType: string | undefined,
): string {
  if (!brainSummary) return '';
  if (intentType === 'chat' || intentType === 'followup') return '';
  if (!domain || domain === 'general') return brainSummary.slice(0, 800);
  return brainSummary.slice(0, 1500);
}

// ── 6. CRM DATA PRUNING ─────────────────────────────────────

export function pruneCrmData(
  crmData: Record<string, unknown> | undefined,
  domain: string | undefined,
  maxChars: number = 1200,
): string {
  if (!crmData) return 'No CRM data.';

  const relevantKeys: Record<string, string[]> = {
    team_assignment: ['teams', 'jobs', 'stats'],
    pricing: ['quotes', 'stats'],
    scheduling: ['jobs', 'teams', 'stats'],
    invoicing: ['invoices', 'stats'],
    followup: ['clients', 'stats'],
    convert_lead: ['leads', 'stats'],
    general: ['stats'],
    reporting: ['stats'],
    client_info: ['clients'],
  };

  const keys = relevantKeys[domain || 'general'] || ['stats'];
  const filtered: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in crmData) {
      const val = crmData[key];
      if (Array.isArray(val)) {
        // Only keep essential fields per item
        filtered[key] = val.slice(0, 3).map((item: any) => {
          if (typeof item !== 'object' || !item) return item;
          const { id, name, title, status, total_cents, first_name, last_name, email, ...rest } = item;
          return { id, name: name || title || `${first_name || ''} ${last_name || ''}`.trim(), status, total_cents };
        });
      } else {
        filtered[key] = val;
      }
    }
  }

  return JSON.stringify(filtered, null, 0).slice(0, maxChars);
}

// ── 7. MEMORY PRUNING ────────────────────────────────────────

export function pruneMemory(
  memory: { entities: any[]; events: any[]; feedback?: any[]; pastDecisions?: any[] } | undefined,
  maxTokens: number = 300,
): string {
  if (!memory) return 'No prior memory.';

  const parts: string[] = [];

  if (memory.entities?.length) {
    parts.push(memory.entities.slice(0, 2).map((e) => `${e.key}:${typeof e.value === 'string' ? e.value.slice(0, 40) : JSON.stringify(e.value).slice(0, 40)}`).join(';'));
  }

  if (memory.feedback?.length) {
    parts.push(`Avoid: ${memory.feedback.slice(0, 1).map((f: any) => f.summary?.slice(0, 60)).join()}`);
  }

  if (memory.pastDecisions?.length) {
    parts.push(`Past: ${memory.pastDecisions.slice(0, 1).map((d: any) => `${d.input_summary?.slice(0, 30)}→${d.chosen_option?.slice(0, 20)}`).join()}`);
  }

  return parts.join('\n').slice(0, maxTokens * 4) || 'No prior memory.';
}

// ── 8. TOKEN BUDGET ──────────────────────────────────────────

interface OrgUsage { tokensUsed: number; resetAt: number; }
const orgBudgets = new Map<string, OrgUsage>();
const DEFAULT_DAILY_BUDGET = 300_000; // Lowered from 500K to 300K with optimizations

export function checkTokenBudget(orgId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let usage = orgBudgets.get(orgId);
  if (!usage || now > usage.resetAt) {
    usage = { tokensUsed: 0, resetAt: now + 24 * 60 * 60 * 1000 };
    orgBudgets.set(orgId, usage);
  }
  return { allowed: DEFAULT_DAILY_BUDGET - usage.tokensUsed > 0, remaining: DEFAULT_DAILY_BUDGET - usage.tokensUsed };
}

export function recordTokenUsage(orgId: string, tokens: number): void {
  const usage = orgBudgets.get(orgId);
  if (usage) usage.tokensUsed += tokens;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of orgBudgets) {
    if (now > val.resetAt) orgBudgets.delete(key);
  }
}, 60 * 60 * 1000);
