// Compte les tokens exacts du prompt système de Lumi (API count_tokens) : node --env-file=.env.local --import tsx scripts/qa/compter-tokens-prompt.mts
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';
import { promptSystemeLumi } from '../../server/lib/lumi/orchestrateur';
const c = new Anthropic();
const blocs = promptSystemeLumi({ companyName: 'Coquin lavage', userName: 'Will', language: 'fr', todayIso: '2026-09-11' });
writeFileSync('prompt-lumi.txt', blocs.map((b) => b.text).join('\n\n=====\n\n'));
for (const [i, b] of blocs.entries()) {
  const r = await c.messages.countTokens({ model: 'claude-sonnet-5', system: b.text, messages: [{ role: 'user', content: 'x' }] });
  console.log(`bloc ${i}: ${b.text.length} car. → ${r.input_tokens} tokens`);
}
process.exit(0);
