// Tokens du jeu d'outils de chaque sous-agent (le préfixe mis en cache), avec et sans une liste d'outils.
// Le comptage est gratuit (messages.countTokens) : aucune inférence.
//   node --env-file=.env.local --import tsx scripts/qa/compter-tokens-sous-agents.mts [--sans a,b,c | --sans-lots]
import Anthropic from '@anthropic-ai/sdk';
import { outilsClaude } from '../../server/lib/lumi/orchestrateur';
import { TOPICS } from '../../server/lib/lumi/topics';
import { OUTILS_LOT_VENTES } from '../../server/lib/agent/tools-lot-ventes';
import { OUTILS_LOT_PAIE } from '../../server/lib/agent/tools-lot-paie';
import { OUTILS_LOT_ENTREPRISE } from '../../server/lib/agent/tools-lot-entreprise';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const lots = [...OUTILS_LOT_VENTES, ...OUTILS_LOT_PAIE, ...OUTILS_LOT_ENTREPRISE].map((t) => t.declaration.name);
const sans = new Set(process.argv.includes('--sans-lots') ? lots : arg('--sans') ? arg('--sans').split(',') : lots);

const c = new Anthropic();
const compter = async (tools: unknown[]) => (await c.messages.countTokens({ model: process.env.LUMI_MODELE || 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }], ...(tools.length ? { tools: tools as never } : {}) })).input_tokens;
const zero = await compter([]);

type Outil = { name: string; defer_loading?: boolean; cache_control?: unknown; type?: string };
const charges = (topic: string | null) => (outilsClaude(topic as never) as Outil[])
  .filter((t) => !t.type && !t.defer_loading)
  .map(({ defer_loading: _d, cache_control: _c, ...reste }) => reste as Outil);

console.log('sous-agent        outils avant → après     tokens avant → après      écart');
let totalAvant = 0; let totalApres = 0;
for (const topic of [...TOPICS.filter((t) => t.outils.length).map((t) => t.id), null]) {
  const apres = charges(topic);
  const avant = apres.filter((t) => !sans.has(t.name));
  const [ta, tp] = [avant.length ? await compter(avant) - zero : 0, apres.length ? await compter(apres) - zero : 0];
  totalAvant += ta; totalApres += tp;
  console.log(`${String(topic ?? '(jeu de base)').padEnd(16)}  ${String(avant.length).padStart(3)} → ${String(apres.length).padEnd(3)}            ${String(ta).padStart(6)} → ${String(tp).padEnd(6)}       ${tp - ta >= 0 ? '+' : ''}${tp - ta}${ta ? ` (${Math.round(((tp - ta) / ta) * 100)} %)` : ''}`);
}
console.log(`total                                    ${String(totalAvant).padStart(6)} → ${String(totalApres).padEnd(6)}       +${totalApres - totalAvant}`);
process.exit(0);
