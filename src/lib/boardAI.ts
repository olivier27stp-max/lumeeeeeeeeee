/* ═══════════════════════════════════════════════════════════════
   Board AI — AI-powered features for the whiteboard canvas
   Uses Ollama (local llama3.2) for inference.
   ═══════════════════════════════════════════════════════════════ */

import type { NoteItem } from '../types/noteBoard';
import { useTranslation } from '../i18n';

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const MODEL = 'llama3.2';

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callOllama(messages: OllamaMessage[]): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed (${res.status}). Make sure Ollama is running.`);
  }

  const data = await res.json();
  return data?.message?.content || '';
}

function extractBoardText(items: NoteItem[]): string {
  return items
    .filter((i) => i.content?.trim())
    .map((i) => {
      const type = i.item_type.replace('_', ' ');
      const prefix = `[${type}]`;
      let text = `${prefix} ${i.content.trim()}`;
      if (i.rich_content?.checklist?.length) {
        const cl = i.rich_content.checklist
          .map((c) => `  ${c.checked ? '[x]' : '[ ]'} ${c.text}`)
          .join('\n');
        text += '\n' + cl;
      }
      return text;
    })
    .join('\n\n');
}

// ─── Cluster Notes ─────────────────────────────────────────────

export interface ClusterResult {
  clusters: Array<{
    theme: string;
    color: string;
    itemIds: string[];
  }>;
}

export async function clusterNotes(items: NoteItem[]): Promise<ClusterResult> {
  const stickyNotes = items.filter((i) => i.item_type === 'sticky_note' && i.content?.trim());
  if (stickyNotes.length < 2) {
    return { clusters: [{ theme: 'All', color: '#fef08a', itemIds: stickyNotes.map((n) => n.id) }] };
  }

  const notesList = stickyNotes.map((n, i) => `${i + 1}. "${n.content.trim()}" (id:${n.id})`).join('\n');

  const response = await callOllama([
    {
      role: 'system',
      content: `You are a brainstorming assistant. Group the following sticky notes into 2-5 thematic clusters.
Return ONLY valid JSON in this exact format, no other text:
{"clusters":[{"theme":"Theme Name","color":"#hex","itemIds":["id1","id2"]}]}

Use these colors: #fef08a (yellow), #93c5fd (blue), #86efac (green), #f9a8d4 (pink), #c4b5fd (purple), #fdba74 (orange), #fca5a5 (red), #5eead4 (teal).`,
    },
    {
      role: 'user',
      content: `Group these sticky notes into thematic clusters:\n\n${notesList}`,
    },
  ]);

  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed as ClusterResult;
  } catch {
    // Fallback: single cluster
    return { clusters: [{ theme: 'All Notes', color: '#fef08a', itemIds: stickyNotes.map((n) => n.id) }] };
  }
}

// ─── Generate Mind Map ─────────────────────────────────────────

export interface MindMapNode {
  label: string;
  children: MindMapNode[];
}

export interface MindMapResult {
  root: MindMapNode;
}

export async function generateMindMap(items: NoteItem[]): Promise<MindMapResult> {
  const boardText = extractBoardText(items);
  if (!boardText.trim()) {
    return { root: { label: 'Empty Board', children: [] } };
  }

  const response = await callOllama([
    {
      role: 'system',
      content: `You are a mind mapping assistant. Create a hierarchical mind map from board content.
Return ONLY valid JSON in this exact format, no other text:
{"root":{"label":"Central Topic","children":[{"label":"Branch 1","children":[{"label":"Sub-item","children":[]}]}]}}

Keep it to 2-3 levels deep with 3-6 branches.`,
    },
    {
      role: 'user',
      content: `Create a mind map from this board content:\n\n${boardText}`,
    },
  ]);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');
    return JSON.parse(jsonMatch[0]) as MindMapResult;
  } catch {
    return { root: { label: 'Board Summary', children: [{ label: 'Content', children: [] }] } };
  }
}

// ─── Summarize Board ───────────────────────────────────────────

export async function summarizeBoard(items: NoteItem[], language: string): Promise<string> {
  const boardText = extractBoardText(items);
  if (!boardText.trim()) return t.agent.theBoardIsEmpty;

  const lang = t.agent.english;

  const response = await callOllama([
    {
      role: 'system',
      content: `You are a meeting notes assistant. Summarize the following board content concisely in ${lang}.
Include: key topics, decisions, and open questions. Use bullet points. Keep it under 200 words.`,
    },
    {
      role: 'user',
      content: `Summarize this board:\n\n${boardText}`,
    },
  ]);

  return response.trim() || (t.agent.unableToGenerateSummary);
}

// ─── Extract Action Items ──────────────────────────────────────

export async function extractActionItems(items: NoteItem[], language: string): Promise<string> {
  const boardText = extractBoardText(items);
  if (!boardText.trim()) return t.agent.noContentToAnalyze;

  const lang = t.agent.english;

  const response = await callOllama([
    {
      role: 'system',
      content: `You are a productivity assistant. Extract all action items, tasks, and to-dos from the board content.
Respond in ${lang}. Format each as "- [ ] Action item description". Group by priority if possible.`,
    },
    {
      role: 'user',
      content: `Extract action items from this board:\n\n${boardText}`,
    },
  ]);

  return response.trim() || (t.agent.noActionItemsFound);
}

// ─── Expand Ideas ──────────────────────────────────────────────

export interface ExpandedIdea {
  text: string;
  color: string;
}

export async function expandIdeas(items: NoteItem[], language: string): Promise<ExpandedIdea[]> {
  const stickyNotes = items.filter((i) => i.item_type === 'sticky_note' && i.content?.trim());
  if (stickyNotes.length === 0) return [];

  const notesList = stickyNotes.map((n) => `- ${n.content.trim()}`).join('\n');
  const lang = t.agent.english;

  const response = await callOllama([
    {
      role: 'system',
      content: `You are a creative brainstorming assistant. Based on existing ideas, generate 4-6 new related ideas.
Respond in ${lang}. Return ONLY valid JSON array, no other text:
[{"text":"New idea 1","color":"#c4b5fd"},{"text":"New idea 2","color":"#86efac"}]

Use diverse colors: #fef08a, #93c5fd, #86efac, #f9a8d4, #c4b5fd, #fdba74.`,
    },
    {
      role: 'user',
      content: `Generate new ideas related to these existing ones:\n\n${notesList}`,
    },
  ]);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array');
    return JSON.parse(jsonMatch[0]) as ExpandedIdea[];
  } catch {
    return [{ text: t.agent.newIdea, color: '#c4b5fd' }];
  }
}

// ─── Improve Text ──────────────────────────────────────────────

export async function improveText(text: string, language: string): Promise<string> {
  if (!text.trim()) return text;

  const lang = t.agent.english;

  const response = await callOllama([
    {
      role: 'system',
      content: `You are a writing assistant. Improve the following text: make it clearer, more concise, and better structured.
Respond in ${lang}. Return ONLY the improved text, nothing else.`,
    },
    {
      role: 'user',
      content: text,
    },
  ]);

  return response.trim() || text;
}
