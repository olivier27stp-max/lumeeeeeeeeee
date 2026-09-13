// Compte les tokens exacts des outils de base (chargés à chaque appel) : node --env-file=.env.local --import tsx scripts/qa/compter-tokens-outils.mts
import Anthropic from '@anthropic-ai/sdk';
import { outilsClaude } from '../../server/lib/lumi/orchestrateur';
const c = new Anthropic();
const n = async (p: any) => (await c.messages.countTokens({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }], ...p })).input_tokens;
const zero = await n({});
const tools = outilsClaude().filter((t: any) => !t.type).map((t: any) => { const { defer_loading, cache_control, ...r } = t; return { ...r, defer: !!defer_loading }; });
const base = tools.filter((t) => !t.defer).map(({ defer, ...t }) => t);
console.log(`outils de base (${base.length}) : ${await n({ tools: base }) - zero} tokens`);
process.exit(0);
