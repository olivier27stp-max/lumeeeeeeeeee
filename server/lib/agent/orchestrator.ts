/* ═══════════════════════════════════════════════════════════════
   Lume Agent — Orchestrator
   ─────────────────────────────────────────────────────────────
   Runs the Gemini function-calling loop:
   - READ tools are executed and fed back to the model.
   - The first WRITE tool call ends the turn and is surfaced as a
     `proposedAction` for the user to confirm (never auto-executed).
   ═══════════════════════════════════════════════════════════════ */

import { generateContent, type GeminiContent, type GeminiPart } from './gemini';
import { TOOLS_BY_NAME, TOOL_DECLARATIONS, type ToolContext } from './tools';

const MAX_STEPS = 6;

export interface ProposedAction {
  type: 'create_quote' | 'create_invoice' | 'create_job' | 'send_sms';
  payload: Record<string, any>;
}

export interface AgentResult {
  reply: string;
  proposedAction: ProposedAction | null;
}

const WRITE_TYPES = new Set(['create_quote', 'create_invoice', 'create_job', 'send_sms']);

export async function runAgent(opts: {
  ctx: ToolContext;
  systemPrompt: string;
  history: GeminiContent[];
}): Promise<AgentResult> {
  const contents: GeminiContent[] = [...opts.history];

  for (let step = 0; step < MAX_STEPS; step++) {
    const result = await generateContent({
      systemInstruction: opts.systemPrompt,
      contents,
      functionDeclarations: TOOL_DECLARATIONS,
    });

    // Record the model's turn (text + any function calls).
    contents.push({ role: 'model', parts: result.parts.length ? result.parts : [{ text: result.text }] });

    if (result.functionCalls.length === 0) {
      return { reply: result.text || '…', proposedAction: null };
    }

    // If the model wants to perform a WRITE, surface it as a proposal and stop.
    const writeCall = result.functionCalls.find((c) => WRITE_TYPES.has(c.name));
    if (writeCall) {
      return {
        reply: result.text || '',
        proposedAction: { type: writeCall.name as ProposedAction['type'], payload: writeCall.args || {} },
      };
    }

    // Otherwise execute all READ tools and feed the results back.
    const responseParts: GeminiPart[] = [];
    for (const call of result.functionCalls) {
      const tool = TOOLS_BY_NAME[call.name];
      let response: any;
      if (!tool || tool.kind !== 'read' || !tool.handler) {
        response = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          response = await tool.handler(call.args || {}, opts.ctx);
        } catch (err: any) {
          // Never leak raw error text (may contain DB internals) to the model.
          console.error(`[agent-orchestrator:${call.name}]`, err?.message || err);
          response = { error: 'Tool execution failed.' };
        }
      }
      responseParts.push({
        functionResponse: {
          name: call.name,
          id: call.id,
          response: response && typeof response === 'object' ? response : { result: response },
        },
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  // Safety valve: too many tool round-trips.
  return {
    reply:
      "I gathered a lot of data but couldn't finish in time. Could you narrow the request a bit?",
    proposedAction: null,
  };
}
