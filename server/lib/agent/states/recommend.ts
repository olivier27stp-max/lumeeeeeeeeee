/* State: recommend — Natural responses with few-shot learning, RAG, quality enforcement */

import type { AgentContext, AgentState } from '../types';
import { geminiChat, geminiStream } from '../../gemini';
import { buildKnowledge, loadOrgKnowledge } from '../knowledge';
import { compressHistory, pruneBrain, pruneCrmData, pruneMemory, recordTokenUsage, estimateTokens } from '../token-optimizer';
import { getCachedResponse, setCachedResponse } from '../response-cache';
import { getFewShotExamples, formatFewShot, findSimilarConversation } from '../training';
import { buildTrainingContext, getCalibrationFactor, calibrateConfidence } from '../training-engine';

export async function recommend(
  ctx: AgentContext,
  onToken?: (token: string) => void
): Promise<{ next: AgentState; ctx: AgentContext }> {
  const fr = ctx.language === 'fr';
  const isSimpleChat = ctx.intent?.type === 'chat' || (!ctx.intent && !ctx.crmData);
  const isFollowup = ctx.intent?.type === 'followup';
  const isQuery = ctx.intent?.type === 'query';

  // ── Cache check ────────────────────────────────────────────
  const cached = getCachedResponse(ctx.orgId, ctx.userMessage);
  if (cached) {
    ctx.response = cached.response;
    ctx.responseType = cached.responseType as any;
    if (onToken) onToken(cached.response);
    return { next: 'log', ctx };
  }

  // ── Training context: few-shot, corrections, calibration, user prefs ──
  let trainingBlock = '';
  if (!isSimpleChat) {
    try {
      trainingBlock = await buildTrainingContext(
        ctx.supabase, ctx.orgId, ctx.userId, ctx.intent?.domain || 'general'
      );
    } catch { /* training context is optional — don't break the flow */ }
  }

  // ── Legacy few-shot (fallback if training engine has no data yet) ──
  let fewShotBlock = '';
  if (!isSimpleChat && !trainingBlock.includes('GOOD RESPONSE EXAMPLES')) {
    const examples = await getFewShotExamples(ctx.supabase, ctx.orgId, ctx.intent?.domain, 2);
    fewShotBlock = formatFewShot(examples, ctx.language);
  }

  // ── RAG: find similar past conversation ────────────────────
  let ragHint = '';
  if (!isSimpleChat && !isFollowup && !trainingBlock.includes('SIMILAR')) {
    const similar = await findSimilarConversation(ctx.supabase, ctx.orgId, ctx.userMessage);
    if (similar) {
      ragHint = fr
        ? `\n## REPONSE SIMILAIRE PASSEE (inspire-toi du style)\n"${similar.slice(0, 200)}"`
        : `\n## SIMILAR PAST RESPONSE (use as style reference)\n"${similar.slice(0, 200)}"`;
    }
  }

  // ── Contextual greeting ────────────────────────────────────
  let greetingContext = '';
  if (isSimpleChat) {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? (fr ? 'matin' : 'morning') : hour < 17 ? (fr ? 'apres-midi' : 'afternoon') : (fr ? 'soir' : 'evening');

    // Inject alerts count if available from brain
    const alertMatch = ctx.brainSummary.match(/(\d+)\s*alert/i);
    const alertCount = alertMatch ? parseInt(alertMatch[1]) : 0;

    greetingContext = fr
      ? `C'est le ${timeOfDay}. ${alertCount > 0 ? `Il y a ${alertCount} alerte(s) a mentionner.` : 'Pas d\'alerte urgente.'} Reponds de facon chaleureuse et breve.`
      : `It's ${timeOfDay}. ${alertCount > 0 ? `There are ${alertCount} alert(s) to mention.` : 'No urgent alerts.'} Respond warmly and briefly.`;
  }

  // ── Smart context pruning ──────────────────────────────────
  const prunedBrain = pruneBrain(ctx.brainSummary, ctx.intent?.domain, ctx.intent?.type);
  const prunedCrm = pruneCrmData(ctx.crmData, ctx.intent?.domain);
  const prunedMemory = pruneMemory(ctx.memory);
  const compressedHistory = compressHistory(ctx.history, isSimpleChat ? 200 : 600);

  const feedbackWarning = ctx.memory?.feedback?.length
    ? `\n${fr ? '## ERREURS A EVITER' : '## MISTAKES TO AVOID'}\n${ctx.memory.feedback.slice(0, 2).map((f: any) => `- ${f.summary?.slice(0, 100)}`).join('\n')}`
    : '';

  const scenarioSummary = ctx.scenarios?.length
    ? `Scenarios: ${ctx.scenarios.map((s, i) => `${i + 1}. ${s.label} (${s.score}/100)`).join(', ')}. Winner: ${ctx.scenarios.find(s => s.isWinner)?.label || ctx.scenarios[0]?.label}`
    : '';

  // ── Knowledge (trimmed by complexity) ──────────────────────
  const fullKnowledge = (isSimpleChat || isFollowup) ? '' : buildKnowledge(ctx.language, ctx.orgProfile);
  const knowledge = isQuery ? fullKnowledge.slice(0, 2000) : fullKnowledge.slice(0, 4000);

  // ── Org-specific knowledge (from training page) ───────────
  let orgKnowledge = '';
  if (!isSimpleChat) {
    try {
      orgKnowledge = await loadOrgKnowledge(ctx.supabase, ctx.orgId, ctx.language);
    } catch { /* optional */ }
  }

  // ── System prompt assembly ─────────────────────────────────
  const systemPrompt = `${knowledge}

${fr ? '# COMMENT REPONDRE' : '# HOW TO RESPOND'}
${fr
  ? `Tu es Mr Lume, un collegue intelligent. Parle naturellement.
- JAMAIS de listes numerotees ni de headers markdown
- JAMAIS de "Recommandation:", "Confiance:" — c'est robotique
- 2-4 phrases max. Court et percutant.
- Gras **uniquement** pour les chiffres importants et noms
- Tutoie le user. Adapte ton ton a l'urgence.`
  : `You are Mr Lume, a smart colleague. Talk naturally.
- NEVER use numbered lists or markdown headers
- NEVER use "Recommendation:", "Confidence:" — that's robotic
- 2-4 sentences max. Short and punchy.
- Bold **only** for important numbers and names
- Match the user's tone. Adapt to urgency.`}

${greetingContext}
${ctx.intent?.type === 'action' ? (fr ? 'Demande confirmation naturellement.' : 'Ask for confirmation naturally.') : ''}
${scenarioSummary ? (fr ? 'Partage le resultat des scenarios naturellement.' : 'Share scenario results naturally.') : ''}

${orgKnowledge}
${trainingBlock ? `\n## LEARNED BEHAVIOR\n${trainingBlock}\n` : ''}
${fewShotBlock}
${ragHint}

${prunedBrain}
${prunedCrm !== 'No CRM data.' ? `${fr ? '## DONNEES' : '## DATA'}\n${prunedCrm}` : ''}
${prunedMemory !== 'No prior memory.' ? `${fr ? '## MEMOIRE' : '## MEMORY'}\n${prunedMemory}` : ''}
${feedbackWarning}
${scenarioSummary}`.trim();

  // ── Conversation for Gemini ────────────────────────────────
  const geminiHistory = compressedHistory.map(h => ({
    role: (h.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
    content: h.content,
  }));
  geminiHistory.push({ role: 'user', content: ctx.userMessage });

  const inputEstimate = estimateTokens(systemPrompt) + geminiHistory.reduce((s, m) => s + estimateTokens(m.content), 0);
  const maxOutput = isSimpleChat ? 150 : isQuery ? 400 : 800;

  try {
    if (onToken) {
      const result = await geminiStream(
        { systemPrompt, messages: geminiHistory, temperature: isSimpleChat ? 0.6 : 0.4, maxTokens: maxOutput, orgId: ctx.orgId, purpose: 'recommendation-stream' },
        onToken
      );
      ctx.response = result.content;
      recordTokenUsage(ctx.orgId, inputEstimate + estimateTokens(result.content));
    } else {
      const response = await geminiChat({
        systemPrompt,
        messages: geminiHistory,
        temperature: isSimpleChat ? 0.6 : 0.4,
        maxTokens: maxOutput,
        orgId: ctx.orgId,
        purpose: 'recommendation',
      });
      ctx.response = response.content || (fr ? 'Je n\'ai pas pu generer de reponse.' : 'I couldn\'t generate a response.');
      recordTokenUsage(ctx.orgId, response.inputTokens + response.outputTokens);
    }

    // ── Quality enforcement ────────────────────────────────────
    // Strip any numbered list formatting that Gemini might still produce
    ctx.response = ctx.response
      .replace(/^\d+\.\s+\*\*[A-Z][a-z]+\*\*:?\s*/gm, '') // "1. **Recommendation**: ..."
      .replace(/^#{1,3}\s+.+$/gm, '')                       // "## Headers"
      .replace(/\n{3,}/g, '\n\n')                            // Collapse excess newlines
      .trim();

    // ── Save to cache ──────────────────────────────────────────
    setCachedResponse(ctx.orgId, ctx.userMessage, ctx.response, ctx.responseType);

  } catch (err: any) {
    ctx.response = fr
      ? `Desole, une erreur est survenue: ${err?.message}`
      : `Sorry, an error occurred: ${err?.message}`;
    ctx.errors.push(`Recommend failed: ${err?.message}`);
    console.error('[agent/recommend] Error:', err?.message);
  }

  if (ctx.intent?.type === 'action' && ctx.decision?.type !== 'direct') {
    ctx.recommendation = {
      text: ctx.response,
      confidence: ctx.scenarios?.[0]?.confidence || 0.7,
      actionType: ctx.intent.domain || undefined,
      actionParams: ctx.intent.entities,
    };
    return { next: 'await_approval', ctx };
  }

  if (!ctx.scenarios?.length) ctx.responseType = 'text';
  return { next: 'log', ctx };
}
