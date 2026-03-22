import { supabase } from './supabase';

// In production (Railway), Ollama runs server-side — calls go through the backend proxy.
// In dev, can use direct Ollama or the proxy.
const OLLAMA_CHAT_URL = import.meta.env.PROD
  ? '/api/ai/chat'
  : (import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434') + '/api/chat';

const IS_PROXIED = import.meta.env.PROD || OLLAMA_CHAT_URL.startsWith('/');

async function getOllamaHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (IS_PROXIED) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  }
  return headers;
}

/* ═══════════════════════════════════════════════════════════════
   AI Conversations — Types
   ═══════════════════════════════════════════════════════════════ */

export type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'custom';
export type AIMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type AIConversationStatus = 'active' | 'archived' | 'deleted';

export interface AIConversation {
  id: string;
  org_id: string;
  created_by: string;
  client_id: string | null;
  title: string | null;
  model: string;
  provider: AIProvider;
  status: AIConversationStatus;
  last_message_preview: string | null;
  last_message_role: AIMessageRole | null;
  last_message_at: string | null;
  message_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_estimated_cost: number;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  id: string;
  org_id: string;
  conversation_id: string;
  created_by: string | null;
  role: AIMessageRole;
  content: string;
  model: string | null;
  provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost: number | null;
  duration_ms: number | null;
  raw_request: Record<string, any> | null;
  raw_response: Record<string, any> | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface AIMessageFile {
  id: string;
  org_id: string;
  message_id: string;
  conversation_id: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string;
  storage_bucket: string;
  extracted_text: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

/** Returned by rpc_ai_recent_conversations */
export interface AIConversationListItem {
  id: string;
  title: string | null;
  model: string;
  provider: string;
  status: string;
  client_id: string | null;
  client_name: string | null;
  last_message_preview: string | null;
  last_message_role: string | null;
  last_message_at: string | null;
  message_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_estimated_cost: number;
  created_at: string;
}

/* ═══════════════════════════════════════════════════════════════
   API Functions
   ═══════════════════════════════════════════════════════════════ */

/**
 * Create a new AI conversation
 */
export async function createConversation(opts: {
  title?: string;
  model?: string;
  provider?: AIProvider;
  clientId?: string | null;
  metadata?: Record<string, any>;
}): Promise<AIConversation> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({
      created_by: user.id,
      org_id: user.id, // enforced by trigger, but needed for RLS
      title: opts.title || null,
      model: opts.model || 'llama3.2',
      provider: opts.provider || 'ollama',
      client_id: opts.clientId || null,
      metadata: opts.metadata || {},
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Add a message to a conversation and return the inserted row
 */
export async function addMessage(opts: {
  conversationId: string;
  role: AIMessageRole;
  content: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  durationMs?: number;
  rawRequest?: Record<string, any>;
  rawResponse?: Record<string, any>;
  metadata?: Record<string, any>;
}): Promise<AIMessage> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('ai_messages')
    .insert({
      conversation_id: opts.conversationId,
      org_id: user?.id || '', // enforced by trigger
      created_by: user?.id || null,
      role: opts.role,
      content: opts.content,
      model: opts.model || null,
      provider: opts.provider || null,
      input_tokens: opts.inputTokens || null,
      output_tokens: opts.outputTokens || null,
      total_tokens: opts.totalTokens || null,
      estimated_cost: opts.estimatedCost || null,
      duration_ms: opts.durationMs || null,
      raw_request: opts.rawRequest || null,
      raw_response: opts.rawResponse || null,
      metadata: opts.metadata || {},
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Send a message to Ollama and save both user + assistant messages to DB
 */
export async function sendMessageToAI(opts: {
  conversationId: string;
  content: string;
  model?: string;
  history?: { role: string; content: string }[];
  clientId?: string | null;
}): Promise<{ userMessage: AIMessage; assistantMessage: AIMessage }> {
  const model = opts.model || 'llama3.2';

  // 1. Save user message
  const userMessage = await addMessage({
    conversationId: opts.conversationId,
    role: 'user',
    content: opts.content,
    model,
    provider: 'ollama',
  });

  // 2. Build message history for the model
  const messages = [
    ...(opts.history || []),
    { role: 'user', content: opts.content },
  ];

  // 3. Call Ollama (non-streaming)
  const startTime = Date.now();
  const ollamaHeaders = await getOllamaHeaders();
  const res = await fetch(OLLAMA_CHAT_URL, {
    method: 'POST',
    headers: ollamaHeaders,
    body: JSON.stringify({ model, messages, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
  }

  const rawResponse = await res.json();
  const durationMs = Date.now() - startTime;

  const assistantContent = rawResponse.message?.content || '';
  const inputTokens = rawResponse.prompt_eval_count || null;
  const outputTokens = rawResponse.eval_count || null;

  // 4. Save assistant message with token data
  const assistantMessage = await addMessage({
    conversationId: opts.conversationId,
    role: 'assistant',
    content: assistantContent,
    model,
    provider: 'ollama',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens && outputTokens ? inputTokens + outputTokens : null,
    estimatedCost: null, // Ollama is free / local
    durationMs,
    rawResponse,
  });

  return { userMessage, assistantMessage };
}

/**
 * Stream a message to Ollama — calls onToken for each chunk, then saves to DB.
 */
export async function streamMessageToAI(opts: {
  conversationId: string | null;
  content: string;
  model?: string;
  history?: { role: string; content: string }[];
  onToken: (token: string) => void;
  dbReady?: boolean;
  signal?: AbortSignal;
}): Promise<{ fullContent: string }> {
  const model = opts.model || 'llama3.2';

  // Save user message to DB if possible
  if (opts.conversationId && opts.dbReady !== false) {
    try {
      await addMessage({
        conversationId: opts.conversationId,
        role: 'user',
        content: opts.content,
        model,
        provider: 'ollama',
      });
    } catch {
      // DB not ready, continue anyway
    }
  }

  const messages = [
    ...(opts.history || []),
    { role: 'user', content: opts.content },
  ];

  const startTime = Date.now();
  const streamHeaders = await getOllamaHeaders();
  const res = await fetch(IS_PROXIED ? OLLAMA_CHAT_URL + '/stream' : OLLAMA_CHAT_URL, {
    method: 'POST',
    headers: streamHeaders,
    body: JSON.stringify({ model, messages, stream: true }),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullContent = '';
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        if (IS_PROXIED && trimmed.startsWith('data: ')) {
          // SSE format from backend proxy
          const json = trimmed.slice(6);
          const event = JSON.parse(json);
          if (event.type === 'token' && event.content) {
            fullContent += event.content;
            opts.onToken(event.content);
          } else if (event.type === 'done') {
            inputTokens = event.inputTokens || null;
            outputTokens = event.outputTokens || null;
          }
        } else {
          // NDJSON format from direct Ollama
          const chunk = JSON.parse(trimmed);
          if (chunk.message?.content) {
            fullContent += chunk.message.content;
            opts.onToken(chunk.message.content);
          }
          if (chunk.done) {
            inputTokens = chunk.prompt_eval_count || null;
            outputTokens = chunk.eval_count || null;
          }
        }
      } catch {
        // skip malformed line
      }
    }
  }

  const durationMs = Date.now() - startTime;

  // Save assistant message to DB if possible
  if (opts.conversationId && opts.dbReady !== false) {
    try {
      await addMessage({
        conversationId: opts.conversationId,
        role: 'assistant',
        content: fullContent,
        model,
        provider: 'ollama',
        inputTokens,
        outputTokens,
        totalTokens: inputTokens && outputTokens ? inputTokens + outputTokens : null,
        durationMs,
      });
    } catch {
      // DB not ready
    }
  }

  return { fullContent };
}

/**
 * Analyze an image using Ollama LLaVA (vision model).
 * Requires: ollama pull llava
 */
export async function analyzeImageWithVision(opts: {
  imageUrl: string;
  prompt: string;
  onToken?: (token: string) => void;
}): Promise<string> {
  // Convert URL to base64 for Ollama
  let imageBase64 = '';
  try {
    const imgRes = await fetch(opts.imageUrl);
    const blob = await imgRes.blob();
    const buffer = await blob.arrayBuffer();
    imageBase64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  } catch {
    return 'Could not fetch image for analysis.';
  }

  const visionHeaders = await getOllamaHeaders();
  const res = await fetch(OLLAMA_CHAT_URL, {
    method: 'POST',
    headers: visionHeaders,
    body: JSON.stringify({
      model: 'llava',
      messages: [
        {
          role: 'user',
          content: opts.prompt,
          images: [imageBase64],
        },
      ],
      stream: !!opts.onToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`LLaVA request failed: ${res.status}. Make sure you ran: ollama pull llava`);
  }

  if (opts.onToken && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.message?.content) {
            fullContent += chunk.message.content;
            opts.onToken(chunk.message.content);
          }
        } catch {}
      }
    }
    return fullContent;
  }

  const data = await res.json();
  return data.message?.content || '';
}

/**
 * Get recent conversations for the current user
 */
export async function getRecentConversations(
  limit = 20,
  offset = 0
): Promise<AIConversationListItem[]> {
  const { data, error } = await supabase.rpc('rpc_ai_recent_conversations', {
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  return data || [];
}

/**
 * Get all messages for a conversation
 */
export async function getConversationMessages(
  conversationId: string
): Promise<AIMessage[]> {
  const { data, error } = await supabase
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get a single conversation by ID
 */
export async function getConversation(id: string): Promise<AIConversation | null> {
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw error;
  }
  return data;
}

/**
 * Update conversation (title, status, client_id, etc.)
 */
export async function updateConversation(
  id: string,
  updates: Partial<Pick<AIConversation, 'title' | 'status' | 'client_id' | 'metadata'>>
): Promise<AIConversation> {
  const { data, error } = await supabase
    .from('ai_conversations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Soft-delete a conversation (set status to 'deleted')
 */
export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase
    .from('ai_conversations')
    .update({ status: 'deleted' })
    .eq('id', id);

  if (error) throw error;
}

/**
 * Archive a conversation
 */
export async function archiveConversation(id: string): Promise<void> {
  const { error } = await supabase
    .from('ai_conversations')
    .update({ status: 'archived' })
    .eq('id', id);

  if (error) throw error;
}
