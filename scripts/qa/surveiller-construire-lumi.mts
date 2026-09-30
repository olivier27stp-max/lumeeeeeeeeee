/* ═══════════════════════════════════════════════════════════════
   « CONSTRUIRE AVEC LUMI » — surveiller les VRAIES conversations.
   LECTURE SEULE.

   La batterie `qa:construire-lumi` prouve ce qu'on a pensé à tester.
   Celle-ci lit ce que les clients ont vraiment écrit (colonne
   `automation_rules.lumi_conversation`) et sort les conversations qui
   ont mal tourné — c'est comme ça que « bah tu l'as même pas changé le
   message » (2026-09-30) aurait été vu sans qu'on nous le dise.

   Signaux (vérifiables, sans juge) :
     · deux réponses de Lumi IDENTIQUES de suite ;
     · une réponse d'erreur (« n'a pas compris », « coupée ») ;
     · un client frustré (« pas changé », « trop long » répété,
       « marche pas », « comprends pas »…).

   Usage : npm run qa:surveiller-construire-lumi [-- --prod] [-- --jours 7]
   ═══════════════════════════════════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const prod = process.argv.includes('--prod');
const jours = Number(process.argv[process.argv.indexOf('--jours') + 1]) || 7;
const url = prod ? process.env.SUPABASE_URL_PROD : process.env.VITE_SUPABASE_URL;
const cle = prod ? process.env.SUPABASE_SERVICE_ROLE_KEY_PROD : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !cle) { console.error('Variables Supabase manquantes (.env.local)'); process.exit(1); }
const db = createClient(url, cle, { auth: { persistSession: false } });

const FRUSTRATION = /pas chang|rien chang|m[eê]me pas|marche pas|fonctionne pas|comprends? (pas|rien)|n['’]importe quoi|de la marde|wtf|encore|trop l+o+n+g|pourquoi tu|t['’]as pas|didn['’]t change|still|not working|wrong/i;
const ERREUR = /n’a pas compris|n'a pas compris|a été coupée|did not understand|was cut off|n’a rien pu|could not/i;

type Tour = { role: 'user' | 'assistant'; content: string };
const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();
const { data, error } = await db
  .from('automation_rules')
  .select('id, name, org_id, updated_at, lumi_conversation, orgs(name)')
  .gte('updated_at', depuis)
  .not('lumi_conversation', 'is', null)
  .order('updated_at', { ascending: false })
  .limit(500);
if (error) { console.error(error.message); process.exit(1); }

const conversations = (data ?? []).filter((r) => Array.isArray(r.lumi_conversation) && r.lumi_conversation.length > 0);
let alertes = 0;
for (const r of conversations) {
  const tours = r.lumi_conversation as Tour[];
  const signaux: string[] = [];
  const reponses = tours.filter((t) => t.role === 'assistant').map((t) => String(t.content ?? '').split('\n')[0].trim());
  for (let i = 1; i < reponses.length; i++) if (reponses[i] && reponses[i] === reponses[i - 1]) { signaux.push('réponse répétée mot pour mot'); break; }
  if (tours.some((t) => t.role === 'assistant' && ERREUR.test(String(t.content)))) signaux.push('réponse d’erreur');
  const frustres = tours.filter((t) => t.role === 'user' && FRUSTRATION.test(String(t.content)));
  if (frustres.length) signaux.push(`client frustré : « ${String(frustres[0].content).slice(0, 80)} »`);
  if (!signaux.length) continue;
  alertes++;
  const bureau = (r as { orgs?: { name?: string } | null }).orgs?.name ?? r.org_id;
  console.log(`\n⚠ ${bureau} › ${r.name}  (${String(r.updated_at).slice(0, 16).replace('T', ' ')} UTC)\n   ${signaux.join(' · ')}`);
  for (const t of tours.slice(-6)) console.log(`   ${t.role === 'user' ? '👤' : '🤖'} ${String(t.content).split('\n')[0].slice(0, 140)}`);
}
console.log(`\n${conversations.length} conversation(s) sur ${jours} j (${prod ? 'PROD' : 'staging'}) · ${alertes} à regarder`);
