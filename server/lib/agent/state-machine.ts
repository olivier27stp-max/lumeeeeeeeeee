/* ═══════════════════════════════════════════════════════════════
   Mr Lume Agent — State Machine Engine
   Functional state machine inspired by LangGraph patterns.
   No external dependencies.
   ═══════════════════════════════════════════════════════════════ */

import type { AgentState, AgentContext, StateHandler, AgentEvent } from './types';
import { STATE_LABELS } from './types';

const MAX_ITERATIONS = 20;

export function createAgentMachine(handlers: Map<AgentState, StateHandler>) {
  return async function* run(
    initialState: AgentState,
    initialContext: AgentContext
  ): AsyncGenerator<AgentEvent, AgentContext, undefined> {
    let currentState = initialState;
    let ctx = { ...initialContext, stateHistory: [initialState] };
    let iterations = 0;

    while (currentState !== 'done' && currentState !== 'error') {
      if (iterations++ >= MAX_ITERATIONS) {
        ctx.errors.push('Max iterations reached');
        ctx.response = ctx.language === 'fr'
          ? 'Désolé, le traitement a pris trop de temps. Veuillez reformuler votre demande.'
          : 'Sorry, processing took too long. Please try rephrasing your request.';
        yield { type: 'error', error: 'Max iterations reached' };
        return ctx;
      }

      // Emit state change event
      const labels = STATE_LABELS[currentState];
      yield {
        type: 'state_change',
        state: currentState,
        label: ctx.language === 'fr' ? labels.fr : labels.en,
      };

      // Get handler for current state
      const handler = handlers.get(currentState);
      if (!handler) {
        ctx.errors.push(`No handler for state: ${currentState}`);
        yield { type: 'error', error: `No handler for state: ${currentState}` };
        return ctx;
      }

      // Execute state handler
      try {
        const result = await handler(ctx);
        ctx = result.ctx;
        currentState = result.next;
        ctx.stateHistory.push(currentState);
      } catch (err: any) {
        const errorMsg = err?.message || 'Unknown state handler error';
        ctx.errors.push(errorMsg);
        console.error(`[agent] Error in state ${currentState}:`, errorMsg);

        // Try to recover by going to recommend with an error message
        if (currentState !== 'recommend' && currentState !== 'log') {
          ctx.response = ctx.language === 'fr'
            ? `Je n'ai pas pu compléter cette étape. ${errorMsg}`
            : `I couldn't complete this step. ${errorMsg}`;
          currentState = 'recommend';
          ctx.stateHistory.push(currentState);
        } else {
          yield { type: 'error', error: errorMsg };
          return ctx;
        }
      }
    }

    // Emit final state
    const finalLabels = STATE_LABELS[currentState];
    yield {
      type: 'state_change',
      state: currentState,
      label: ctx.language === 'fr' ? finalLabels.fr : finalLabels.en,
    };

    return ctx;
  };
}
