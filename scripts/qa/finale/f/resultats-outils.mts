/* ═══════════════════════════════════════════════════════════════
   Agent F — taille réelle des résultats d'outils d'automatisation.

   Relit, dans la base LOCALE, les conversations que `mesurer.mts` vient de
   jouer (table `lumi_messages` du bureau A « f ») et compte en tokens chaque
   résultat d'outil TEL QU'IL A ÉTÉ DONNÉ AU MODÈLE (après masquage des
   identifiants et compaction). Comptage gratuit, aucune inférence.

     QA_AUTO_SUFFIXE=f npx tsx --env-file=.env.local scripts/qa/finale/f/resultats-outils.mts

   Sortie : D:/lume-final/sorties/f-resultats-outils.json.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync } from 'node:fs';
import { clientAnthropic } from '../../../../server/lib/lumi/llm';
import { adminStaging, assurerBureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';
import { exigerPileLocale, tableau, SORTIES } from './commun.mts';

exigerPileLocale();
const admin = adminStaging();
const { orgA } = await assurerBureauTest(admin);
const c = clientAnthropic();
const zero = (await c.messages.countTokens({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }] })).input_tokens;
const tokens = async (t: string) => (await c.messages.countTokens({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: t }] })).input_tokens - zero + 1;

const { data: convs } = await admin.from('lumi_conversations').select('id').eq('org_id', orgA);
const ids = (convs ?? []).map((x: { id: string }) => x.id);
const { data: messages, error } = await admin.from('lumi_messages').select('conversation_id, role, content, created_at').in('conversation_id', ids).order('created_at', { ascending: true });
if (error) throw new Error(error.message);

type Bloc = { type: string; id?: string; name?: string; tool_use_id?: string; content?: unknown; input?: unknown };
const nomDe = new Map<string, string>();
const argsDe = new Map<string, string>();
const lignes: Array<{ outil: string; caracteres: number; tokens: number; args_tokens: number; apercu: string }> = [];
for (const m of (messages ?? []) as Array<{ content: unknown }>) {
  const blocs = (Array.isArray(m.content) ? m.content : []) as Bloc[];
  for (const b of blocs) {
    if (b.type === 'tool_use' && b.id) { nomDe.set(b.id, String(b.name)); argsDe.set(b.id, JSON.stringify(b.input ?? {})); }
  }
  for (const b of blocs) {
    if (b.type !== 'tool_result' || !b.tool_use_id) continue;
    const outil = nomDe.get(b.tool_use_id) ?? '?';
    if (!/automation/.test(outil)) continue;
    const texte = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
    lignes.push({ outil, caracteres: texte.length, tokens: await tokens(texte), args_tokens: await tokens(argsDe.get(b.tool_use_id) ?? '{}'), apercu: texte.slice(0, 260) });
  }
}

const parOutil = new Map<string, typeof lignes>();
for (const l of lignes) parOutil.set(l.outil, [...(parOutil.get(l.outil) ?? []), l]);
const synthese = [...parOutil.entries()].map(([outil, ls]) => ({
  outil, appels: ls.length,
  tokens_min: Math.min(...ls.map((l) => l.tokens)), tokens_max: Math.max(...ls.map((l) => l.tokens)),
  tokens_moyens: Math.round(ls.reduce((s, l) => s + l.tokens, 0) / ls.length),
  arguments_tokens_moyens: Math.round(ls.reduce((s, l) => s + l.args_tokens, 0) / ls.length),
  exemple: ls[0].apercu,
})).sort((a, b) => b.tokens_max - a.tokens_max);

const { count: regles } = await admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', orgA).is('deleted_at', null);
writeFileSync(`${SORTIES}/f-resultats-outils.json`, JSON.stringify({ quand: new Date().toISOString(), automatisations_du_bureau: regles, synthese, lignes }, null, 1));
console.log(`Bureau A (f) : ${regles} automatisations non supprimées.`);
console.log(tableau(['Outil', 'Résultats vus', 'Tokens min', 'Tokens max', 'Tokens moyens', 'Arguments (tokens moy.)'], synthese.map((x) => [x.outil, x.appels, x.tokens_min, x.tokens_max, x.tokens_moyens, x.arguments_tokens_moyens])));
for (const x of synthese) console.log(`\n${x.outil} — exemple : ${x.exemple}`);
process.exit(0);
