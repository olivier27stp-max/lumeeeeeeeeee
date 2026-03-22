/* State: recommend — Build final response, optionally streaming */

import type { AgentContext, AgentState } from '../types';
import { geminiChat, geminiStream } from '../../gemini';
import { buildKnowledge } from '../knowledge';

export async function recommend(
  ctx: AgentContext,
  onToken?: (token: string) => void
): Promise<{ next: AgentState; ctx: AgentContext }> {
  const fr = ctx.language === 'fr';

  const crmSummary = ctx.crmData ? JSON.stringify(ctx.crmData, null, 0).slice(0, 2000) : 'No CRM data.';
  const memorySummary = ctx.memory?.entities?.length
    ? ctx.memory.entities.slice(0, 5).map(e => `${e.key}: ${JSON.stringify(e.value)}`).join('; ')
    : 'No prior memory.';

  // Past negative feedback — learn from mistakes
  const feedbackWarning = ctx.memory?.feedback?.length
    ? `\n${fr ? '## FEEDBACK UTILISATEUR PASSE (ne repete pas ces erreurs)' : '## PAST USER FEEDBACK (avoid repeating these mistakes)'}\n${ctx.memory.feedback.map((f: any) => `- ${f.summary}`).join('\n')}`
    : '';

  // Past similar decisions — learn from history
  const pastDecisionContext = ctx.memory?.pastDecisions?.length
    ? `\n${fr ? '## DECISIONS SIMILAIRES PASSEES' : '## PAST SIMILAR DECISIONS'}\n${ctx.memory.pastDecisions.slice(0, 3).map((d: any) => `- ${d.input_summary} → ${d.chosen_option} (confiance ${d.confidence}, ${d.approved_at ? 'approuve' : 'non approuve'})`).join('\n')}`
    : '';
  const scenarioSummary = ctx.scenarios?.length
    ? `Scenarios analyzed:\n${ctx.scenarios.map((s, i) => `${i + 1}. ${s.label} (score: ${s.score}, confidence: ${s.confidence})`).join('\n')}\nWinner: ${ctx.scenarios.find(s => s.isWinner)?.label || ctx.scenarios[0]?.label}`
    : '';

  const knowledge = buildKnowledge(ctx.language);

  const systemPrompt = `${knowledge}

${fr ? '# CONTEXTE DE CETTE CONVERSATION' : '# CURRENT CONVERSATION CONTEXT'}

${fr ? '## FORMAT DE REPONSE' : '## RESPONSE FORMAT'}
${fr
  ? `1. Recommandation (1 phrase claire)
2. Raisonnement (2-3 phrases max)
3. Confiance (X% — basee sur la qualite des donnees)
4. Action suivante (ce que l'utilisateur devrait faire)
5. Limites (ce que tu ne sais pas, si pertinent)`
  : `1. Recommendation (1 clear sentence)
2. Reasoning (2-3 sentences max)
3. Confidence (X% — based on data quality)
4. Next action (what user should do)
5. Limitations (what you don't know, if relevant)`}

${scenarioSummary ? (fr ? 'Tu viens de faire une analyse de scenarios. Resume les resultats et recommande le gagnant avec son score.' : 'You just ran a scenario analysis. Summarize the results and recommend the winner with its score.') : ''}
${ctx.intent?.type === 'action' ? (fr ? 'C\'est une demande d\'ACTION. Demande confirmation avant d\'agir. Sois specifique sur ce qui va changer.' : 'This is an ACTION request. Ask for confirmation before proceeding. Be specific about what will change.') : ''}

${ctx.brainSummary}

${fr ? '## DONNEES SPECIFIQUES A CETTE REQUETE' : '## REQUEST-SPECIFIC DATA'}
${crmSummary}

${fr ? '## MEMOIRE' : '## MEMORY'}
${memorySummary}
${feedbackWarning}
${pastDecisionContext}

${scenarioSummary}`;

  // Build conversation history for Gemini (alternating user/model)
  const geminiHistory = ctx.history.slice(-6).map(h => ({
    role: (h.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    content: h.content,
  }));
  // Ensure last message is the user message
  geminiHistory.push({ role: 'user', content: ctx.userMessage });

  try {
    if (onToken) {
      const result = await geminiStream(
        { systemPrompt, messages: geminiHistory, temperature: 0.4, maxTokens: 1024 },
        onToken
      );
      ctx.response = result.content;
    } else {
      const response = await geminiChat({
        systemPrompt,
        messages: geminiHistory,
        temperature: 0.4,
        maxTokens: 1024,
      });
      ctx.response = response.content || (fr ? 'Je n\'ai pas pu generer de reponse.' : 'I couldn\'t generate a response.');
    }
  } catch (err: any) {
    ctx.response = fr
      ? `Desole, une erreur est survenue: ${err?.message}`
      : `Sorry, an error occurred: ${err?.message}`;
    ctx.errors.push(`Recommend failed: ${err?.message}`);
    console.error('[agent/recommend] Error:', err?.message);
  }

  // Check if this was an action intent that needs approval
  if (ctx.intent?.type === 'action' && ctx.decision?.type !== 'direct') {
    ctx.recommendation = {
      text: ctx.response,
      confidence: ctx.scenarios?.[0]?.confidence || 0.7,
      actionType: ctx.intent.domain || undefined,
      actionParams: ctx.intent.entities,
    };
    return { next: 'await_approval', ctx };
  }

  if (!ctx.scenarios?.length) {
    ctx.responseType = 'text';
  }

  return { next: 'log', ctx };
}
